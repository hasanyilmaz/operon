import {
	MUTATION_KINDS_V1,
	type MutationKindV1,
} from '../../contracts/v1/capabilities';
import { sha256HexV1 } from '../../contracts/v1/canonical';
import type { MutationReceiptV1 } from '../../contracts/v1/mutation';
import {
	indexedDbRequestResultV1 as requestResult,
	indexedDbTransactionCompletionV1 as transactionCompletion,
	normalizeIndexedDbTimeoutV1,
	safeAbortIndexedDbTransactionV1 as safeAbort,
	withIndexedDbOperationTimeoutV1,
} from '../../internal/indexeddb-primitives';
import {
	RECOVERY_MAX_RECORDS_V1,
	RECOVERY_RETENTION_MS_V1,
} from '../../internal/recovery-policy';
import { planExpiringRecordRetentionV1 } from '../../internal/retention';
import {
	GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1,
	GRAPH_TRANSACTION_JOURNAL_LEASE_MS_V1,
	GRAPH_TRANSACTION_JOURNAL_MAX_STEPS_V1,
	graphJournalMatchesReceiptV1,
	graphJournalScopeV1,
	type GraphTransactionJournalPhaseV1,
	type GraphTransactionJournalV1,
	type GraphTransactionResourceStateV1,
} from './graph-transaction-journal';
import type {
	RuntimeTimingSinkV1,
	RuntimeTimingSpanNameV1,
} from '../timing-probe';
import {
	AGENT_RUNTIME_DATABASE_VERSION_V1,
	AGENT_RUNTIME_DEFAULT_DATABASE_NAME_V1,
	JOURNAL_OBJECT_STORE_NAME_V1,
	RECEIPT_METADATA_OBJECT_STORE_NAME_V1,
	RECEIPT_OBJECT_STORE_NAME_V1,
	RECEIPT_GENERATION_KEY_V1,
	SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
	ensureAgentRuntimeObjectStoresV1,
	hasAgentRuntimeObjectStoresV1,
} from './indexeddb-schema';
import {
	assertValidSecurityAuditEventV1,
	createStoredSecurityAuditEventV1,
	planSecurityAuditPruneV1,
	type SecurityAuditEventV1,
	type StoredSecurityAuditEventV1,
} from './indexeddb-security-audit-store';

declare const OPERON_AGENT_RUNTIME_PROBE_ENABLED: boolean;
const DATABASE_VERSION = AGENT_RUNTIME_DATABASE_VERSION_V1;
const RECEIPT_OBJECT_STORE_NAME = RECEIPT_OBJECT_STORE_NAME_V1;
const JOURNAL_OBJECT_STORE_NAME = JOURNAL_OBJECT_STORE_NAME_V1;
const METADATA_OBJECT_STORE_NAME = RECEIPT_METADATA_OBJECT_STORE_NAME_V1;
const RECEIPT_GENERATION_KEY = RECEIPT_GENERATION_KEY_V1;
const METADATA_HEALTH_PROBE_KEY = 'receipt-health-probe';
const DEFAULT_DATABASE_NAME = AGENT_RUNTIME_DEFAULT_DATABASE_NAME_V1;
const DEFAULT_OPERATION_TIMEOUT_MS = 2_000;
const HEALTH_PROBE_KEY = '0'.repeat(64);
// The Stage 4 comparison build rewrites this single constant to false. That
// build keeps the v4 schema and every safety fence identical while measuring
// the former terminal full-scan path against generation-CAS.
const RECEIPT_ADMISSION_FAST_PATH_ENABLED = true;

export const MUTATION_RECEIPT_TTL_MS_V1 = RECOVERY_RETENTION_MS_V1;
export const MUTATION_RECEIPT_MAX_RECORDS_V1 = RECOVERY_MAX_RECORDS_V1;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TERMINAL_OUTCOMES = new Set<MutationReceiptV1['terminalOutcome']>([
	'applied',
	'already-applied',
	'outcome-unknown',
]);
const MUTATION_KINDS = new Set<MutationKindV1>(MUTATION_KINDS_V1);

export interface MutationReceiptScopeV1 {
	vaultIdentityHash: string;
	clientInstanceId: string;
	idempotencyKeyHash: string;
	mutationKind: MutationKindV1;
}

export type MutationReceiptStoreHealthStatusV1 =
	| 'healthy'
	| 'unavailable'
	| 'unhealthy'
	| 'closed';

export interface MutationReceiptStoreHealthV1 {
	healthy: boolean;
	status: MutationReceiptStoreHealthStatusV1;
	reason:
		| 'ready'
		| 'indexeddb-unavailable'
		| 'database-open-failed'
		| 'database-schema-invalid'
		| 'database-version-changed'
		| 'operation-failed'
		| 'operation-timeout'
		| 'store-closed';
}

export interface MutationReceiptPruneResultV1 {
	expiredDeleted: number;
	overflowDeleted: number;
	retained: number;
}

export interface MutationReceiptApplyAdmissionV1 {
	health: MutationReceiptStoreHealthV1;
	receipt: MutationReceiptV1 | null;
	journal: GraphTransactionJournalV1 | null;
	admissionToken: MutationReceiptApplyAdmissionTokenV1 | null;
}

declare const MUTATION_RECEIPT_APPLY_ADMISSION_TOKEN_V1: unique symbol;

/**
 * An internal, store-authenticated performance capability. It is not mutation
 * authority and cannot replace the sealed plan, receipt, or recovery journal.
 */
export interface MutationReceiptApplyAdmissionTokenV1 {
	readonly [MUTATION_RECEIPT_APPLY_ADMISSION_TOKEN_V1]: true;
}

export interface IndexedDbMutationReceiptStoreOptionsV1 {
	indexedDBFactory?: IDBFactory | null;
	now?: () => number;
	databaseName?: string;
	operationTimeoutMs?: number;
}

export interface MutationReceiptApplyDiagnosticContextV1 {
	requestId: string;
	timingSink: RuntimeTimingSinkV1;
	timingNow: () => number;
}

interface StoredMutationReceiptV1 {
	key: string;
	completedAtMs: number;
	expiresAtMs: number;
	receipt: MutationReceiptV1;
}

interface StoredGraphTransactionJournalV1 {
	key: string;
	updatedAtMs: number;
	leaseOwner: string;
	leaseExpiresAtMs: number;
	journal: GraphTransactionJournalV1;
}

interface StoredReceiptMetadataV1 {
	key: typeof RECEIPT_GENERATION_KEY;
	databaseEpoch: string;
	generation: number;
}

interface ReceiptAdmissionClaimV1 {
	scopeKey: string;
	databaseEpoch: string;
	connectionEpoch: number;
	generation: number;
	records: readonly StoredMutationReceiptV1[];
	timingRequestId?: string;
	timingSink?: RuntimeTimingSinkV1;
	timingNow?: () => number;
}

interface ReceiptTimingRecordV1 {
	span: RuntimeTimingSpanNameV1;
	durationMs: number;
}

type StoreHealthReasonV1 = MutationReceiptStoreHealthV1['reason'];

export class MutationReceiptStoreErrorV1 extends Error {
	constructor(
		public readonly code:
			| 'receipt-store-unavailable'
			| 'receipt-store-unhealthy'
			| 'receipt-store-closed'
			| 'receipt-store-invalid-scope'
			| 'receipt-store-invalid-receipt'
			| 'receipt-store-corrupt',
		message: string,
	) {
		super(message);
		this.name = 'MutationReceiptStoreErrorV1';
	}
}

export class IndexedDbMutationReceiptStoreV1 {
	private readonly indexedDBFactory: IDBFactory | null;
	private readonly now: () => number;
	private readonly databaseName: string;
	private readonly operationTimeoutMs: number;
	private databasePromise: Promise<IDBDatabase> | null = null;
	private database: IDBDatabase | null = null;
	private healthState: MutationReceiptStoreHealthV1 | null = null;
	private connectionEpoch = 0;
	private readonly admissionClaims = new WeakMap<
		MutationReceiptApplyAdmissionTokenV1,
		ReceiptAdmissionClaimV1
	>();
	private closed = false;

	constructor(options: IndexedDbMutationReceiptStoreOptionsV1 = {}) {
		this.indexedDBFactory = options.indexedDBFactory === undefined
			? (typeof indexedDB === 'undefined' ? null : indexedDB)
			: options.indexedDBFactory;
		this.now = options.now ?? (() => Date.now());
		this.databaseName = options.databaseName?.trim() || DEFAULT_DATABASE_NAME;
		this.operationTimeoutMs = normalizeTimeout(options.operationTimeoutMs);
	}

	async health(force: boolean = false): Promise<MutationReceiptStoreHealthV1> {
		if (this.closed) return this.setHealth(false, 'closed', 'store-closed');
		if (!this.indexedDBFactory) return this.setHealth(false, 'unavailable', 'indexeddb-unavailable');
		if (!force && this.healthState?.healthy) return { ...this.healthState };

		let transaction: IDBTransaction | null = null;
		try {
			const database = await this.openDatabase();
			if (!isExpectedDatabaseSchema(database)) {
				this.closeDatabase();
				return this.setHealth(false, 'unhealthy', 'database-schema-invalid');
			}
			transaction = database.transaction(
				[
					RECEIPT_OBJECT_STORE_NAME,
					JOURNAL_OBJECT_STORE_NAME,
					METADATA_OBJECT_STORE_NAME,
					SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
				],
				'readwrite',
			);
			const store = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const journalStore = transaction.objectStore(JOURNAL_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const auditStore = transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1);
			if (
				store.keyPath !== 'key'
				|| journalStore.keyPath !== 'key'
				|| metadataStore.keyPath !== 'key'
				|| auditStore.keyPath !== 'key'
			) {
				safeAbort(transaction);
				this.closeDatabase();
				return this.setHealth(false, 'unhealthy', 'database-schema-invalid');
			}
			const completion = transactionCompletion(transaction);
			const putRequest = store.put({ key: HEALTH_PROBE_KEY });
			const deleteRequest = store.delete(HEALTH_PROBE_KEY);
			const journalPutRequest = journalStore.put({ key: HEALTH_PROBE_KEY });
			const journalDeleteRequest = journalStore.delete(HEALTH_PROBE_KEY);
			const metadataProbePut = metadataStore.put({ key: METADATA_HEALTH_PROBE_KEY });
			const metadataProbeDelete = metadataStore.delete(METADATA_HEALTH_PROBE_KEY);
			const auditProbePut = auditStore.put({ key: HEALTH_PROBE_KEY });
			const auditProbeDelete = auditStore.delete(HEALTH_PROBE_KEY);
			const metadataRequest = metadataStore.get(RECEIPT_GENERATION_KEY);
			const allRequest = store.getAll();
			const [, , , , , , , , metadata, records] = await this.withOperationTimeout(
				Promise.all([
					requestResult(putRequest),
					requestResult(deleteRequest),
					requestResult(journalPutRequest),
					requestResult(journalDeleteRequest),
					requestResult(metadataProbePut),
					requestResult(metadataProbeDelete),
					requestResult(auditProbePut),
					requestResult(auditProbeDelete),
					requestResult(
						metadataRequest as IDBRequest<StoredReceiptMetadataV1 | undefined>,
					),
					requestResult(allRequest as IDBRequest<StoredMutationReceiptV1[]>),
				]),
				transaction,
			);
			assertValidReceiptMetadata(metadata);
			const prune = planPrune(records, this.now());
			const deletes = prune.keysToDelete.map(recordKey => requestResult(store.delete(recordKey)));
			const generationWrite = deletes.length > 0
				? [requestResult(metadataStore.put(incrementReceiptGeneration(metadata)))]
				: [];
			await this.withOperationTimeout(
				Promise.all([...deletes, ...generationWrite, completion]),
				transaction,
			);
			return this.setHealth(true, 'healthy', 'ready');
			} catch (error) {
				if (transaction) safeAbort(transaction);
				const reason = error instanceof ReceiptStoreOperationTimeoutError
				? 'operation-timeout'
				: this.database ? 'operation-failed' : 'database-open-failed';
			this.closeDatabase();
			return this.setHealth(false, 'unhealthy', reason);
		}
	}

	async lookup(scope: MutationReceiptScopeV1): Promise<MutationReceiptV1 | null> {
		assertValidScope(scope);
		const database = await this.requireHealthyDatabase();
		const key = await opaqueScopeKey(scope);
		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(
				[RECEIPT_OBJECT_STORE_NAME, METADATA_OBJECT_STORE_NAME],
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const [stored, metadata] = await this.withOperationTimeout(
				Promise.all([
					requestResult(
						store.get(key) as IDBRequest<StoredMutationReceiptV1 | undefined>,
					),
					requestResult(
						metadataStore.get(RECEIPT_GENERATION_KEY) as IDBRequest<
							StoredReceiptMetadataV1 | undefined
						>,
					),
				]),
				transaction,
			);
			assertValidReceiptMetadata(metadata);
			if (!stored) {
				await this.withOperationTimeout(completion, transaction);
				return null;
			}
			if (!isStoredReceiptValid(stored) || !receiptMatchesScope(stored.receipt, scope)) {
				this.markUnhealthy('operation-failed');
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-corrupt',
					'The receipt store returned a record that failed strict metadata validation.',
				);
			}
			if (stored.expiresAtMs <= this.now()) {
				const deleteRequest = store.delete(key);
				const generationRequest = metadataStore.put(incrementReceiptGeneration(metadata));
				await this.withOperationTimeout(
					Promise.all([
						requestResult(deleteRequest),
						requestResult(generationRequest),
						completion,
					]),
					transaction,
				);
				return null;
			}
			await this.withOperationTimeout(completion, transaction);
			return cloneReceipt(stored.receipt);
		} catch (error) {
			this.rethrowOperationFailure(error);
		}
	}

	/**
	 * Performs the apply admission fence in one forced readwrite transaction.
	 * Global receipt validation, both-store write probes, pruning, scoped receipt
	 * replay, and the scoped graph journal snapshot must all succeed before the
	 * Runtime is allowed to prepare or commit a vault mutation.
	 */
	async lookupForApplyAdmission(
		scope: MutationReceiptScopeV1,
		diagnosticContext?: MutationReceiptApplyDiagnosticContextV1,
	): Promise<MutationReceiptApplyAdmissionV1> {
		assertValidScope(scope);
		if (this.closed) {
			return {
				health: this.setHealth(false, 'closed', 'store-closed'),
				receipt: null,
				journal: null,
				admissionToken: null,
			};
		}
		if (!this.indexedDBFactory) {
			return {
				health: this.setHealth(false, 'unavailable', 'indexeddb-unavailable'),
				receipt: null,
				journal: null,
				admissionToken: null,
			};
		}
		const key = await opaqueScopeKey(scope);
		const timingSink = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			? diagnosticContext?.timingSink
			: undefined;
		const timingNow = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			? (diagnosticContext?.timingNow ?? defaultReceiptTimingNowV1)
			: defaultReceiptTimingNowV1;
		const timingRecords = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			&& timingSink
			&& diagnosticContext?.requestId
			? [] as ReceiptTimingRecordV1[]
			: null;

		let transaction: IDBTransaction | null = null;
		try {
			const openStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const database = await this.openDatabase();
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-admission-open',
					openStartedAt,
					timingNow,
				);
			}
			if (!isExpectedDatabaseSchema(database)) {
				this.closeDatabase();
				return {
					health: this.setHealth(false, 'unhealthy', 'database-schema-invalid'),
					receipt: null,
					journal: null,
					admissionToken: null,
				};
			}
			transaction = database.transaction(
				[
					RECEIPT_OBJECT_STORE_NAME,
					JOURNAL_OBJECT_STORE_NAME,
					METADATA_OBJECT_STORE_NAME,
					SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
				],
				'readwrite',
			);
			const receiptStore = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const journalStore = transaction.objectStore(JOURNAL_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const auditStore = transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1);
			if (
				receiptStore.keyPath !== 'key'
				|| journalStore.keyPath !== 'key'
				|| metadataStore.keyPath !== 'key'
				|| auditStore.keyPath !== 'key'
			) {
				safeAbort(transaction);
				this.closeDatabase();
				return {
					health: this.setHealth(false, 'unhealthy', 'database-schema-invalid'),
					receipt: null,
					journal: null,
					admissionToken: null,
				};
			}

			const completion = transactionCompletion(transaction);
			const receiptProbePut = receiptStore.put({ key: HEALTH_PROBE_KEY });
			const receiptProbeDelete = receiptStore.delete(HEALTH_PROBE_KEY);
			const journalProbePut = journalStore.put({ key: HEALTH_PROBE_KEY });
			const journalProbeDelete = journalStore.delete(HEALTH_PROBE_KEY);
			const metadataProbePut = metadataStore.put({ key: METADATA_HEALTH_PROBE_KEY });
			const metadataProbeDelete = metadataStore.delete(METADATA_HEALTH_PROBE_KEY);
			const auditProbePut = auditStore.put({ key: HEALTH_PROBE_KEY });
			const auditProbeDelete = auditStore.delete(HEALTH_PROBE_KEY);
			const metadataRequest = metadataStore.get(RECEIPT_GENERATION_KEY);
			const allReceiptsRequest = receiptStore.getAll();
			const journalRequest = journalStore.get(key);
			const snapshotStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const [
				,
				,
				,
				,
				,
				,
				,
				,
				metadata,
				records,
				storedJournal,
			] = await this.withOperationTimeout(
				Promise.all([
					requestResult(receiptProbePut),
					requestResult(receiptProbeDelete),
					requestResult(journalProbePut),
					requestResult(journalProbeDelete),
					requestResult(metadataProbePut),
					requestResult(metadataProbeDelete),
					requestResult(auditProbePut),
					requestResult(auditProbeDelete),
					requestResult(
						metadataRequest as IDBRequest<StoredReceiptMetadataV1 | undefined>,
					),
					requestResult(
						allReceiptsRequest as IDBRequest<StoredMutationReceiptV1[]>,
					),
					requestResult(
						journalRequest as IDBRequest<
							StoredGraphTransactionJournalV1 | undefined
						>,
					),
				]),
				transaction,
			);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-admission-probe-snapshot',
					snapshotStartedAt,
					timingNow,
				);
			}
			const validationStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			assertValidReceiptMetadata(metadata);
			const prune = planPrune(records, this.now());
			const keysToDelete = new Set(prune.keysToDelete);
			const storedReceipt = records.find(record => record.key === key);
			if (
				storedReceipt
				&& !receiptMatchesScope(storedReceipt.receipt, scope)
			) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-corrupt',
					'The receipt store returned a record bound to the wrong scope.',
				);
			}
			if (
				storedJournal
				&& (
					!isStoredJournalValid(storedJournal)
					|| !scopeMatches(scope, graphJournalScopeV1(storedJournal.journal))
				)
			) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-corrupt',
					'The graph transaction journal failed strict metadata validation.',
				);
			}
			const deletes = prune.keysToDelete.map(
				recordKey => requestResult(receiptStore.delete(recordKey)),
			);
			const finalMetadata = deletes.length > 0
				? incrementReceiptGeneration(metadata)
				: metadata;
			const generationWrite = deletes.length > 0
				? [requestResult(metadataStore.put(finalMetadata))]
				: [];
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-admission-validate-prune',
					validationStartedAt,
					timingNow,
				);
			}
			const commitStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			await this.withOperationTimeout(
				Promise.all([...deletes, ...generationWrite, completion]),
				transaction,
			);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-admission-commit',
					commitStartedAt,
					timingNow,
				);
			}
			const cloneStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const retainedRecords = records
				.filter(record => !keysToDelete.has(record.key))
				.map(record => cloneStoredReceipt(record));
			const admissionToken = Object.freeze(
				{},
			) as MutationReceiptApplyAdmissionTokenV1;
			this.admissionClaims.set(admissionToken, {
				scopeKey: key,
				databaseEpoch: finalMetadata.databaseEpoch,
				connectionEpoch: this.connectionEpoch,
				generation: finalMetadata.generation,
				records: retainedRecords,
				...(OPERON_AGENT_RUNTIME_PROBE_ENABLED && diagnosticContext?.requestId
					? {
						timingRequestId: diagnosticContext.requestId,
						timingSink: diagnosticContext.timingSink,
						timingNow: diagnosticContext.timingNow,
					}
					: {}),
			});
			const result = {
				health: this.setHealth(true, 'healthy', 'ready'),
				receipt: storedReceipt && !keysToDelete.has(key)
					? cloneReceipt(storedReceipt.receipt)
					: null,
				journal: storedJournal ? cloneJournal(storedJournal.journal) : null,
				admissionToken,
			};
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-admission-clone',
					cloneStartedAt,
					timingNow,
				);
				flushReceiptTimingV1(
					timingSink,
					diagnosticContext?.requestId,
					timingRecords,
				);
			}
			return result;
		} catch (error) {
			if (transaction) safeAbort(transaction);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				flushReceiptTimingV1(
					timingSink,
					diagnosticContext?.requestId,
					timingRecords,
				);
			}
			const reason = error instanceof ReceiptStoreOperationTimeoutError
					? 'operation-timeout'
					: this.database ? 'operation-failed' : 'database-open-failed';
			this.closeDatabase();
			return {
				health: this.setHealth(false, 'unhealthy', reason),
				receipt: null,
				journal: null,
				admissionToken: null,
			};
		}
	}

	async persist(receipt: MutationReceiptV1): Promise<MutationReceiptPruneResultV1> {
		return await this.persistReceipt(receipt, null);
	}

	async persistAfterApplyAdmission(
		receipt: MutationReceiptV1,
		admissionToken: MutationReceiptApplyAdmissionTokenV1,
	): Promise<MutationReceiptPruneResultV1> {
		return await this.persistReceipt(receipt, admissionToken);
	}

	/**
	 * Atomically completes the terminal receipt and its redacted terminal audit
	 * event. A failure in either write aborts both, forcing same-plan recovery.
	 */
	async persistWithSecurityAuditAfterApplyAdmission(
		receipt: MutationReceiptV1,
		auditEvent: SecurityAuditEventV1,
		admissionToken: MutationReceiptApplyAdmissionTokenV1,
	): Promise<MutationReceiptPruneResultV1> {
		return await this.persistReceipt(receipt, admissionToken, auditEvent);
	}

	private async persistReceipt(
		receipt: MutationReceiptV1,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		auditEvent: SecurityAuditEventV1 | null = null,
	): Promise<MutationReceiptPruneResultV1> {
		const now = this.now();
		assertValidReceipt(receipt, now);
		if (auditEvent) assertValidSecurityAuditEventV1(auditEvent);
		const database = await this.requireHealthyDatabase();
		const scope = scopeFromReceipt(receipt);
		const key = await opaqueScopeKey(scope);
		const stored = createStoredReceipt(key, receipt);
		const claim = this.consumeAdmissionClaim(admissionToken, key);
		const timingSink = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			? claim?.timingSink
			: undefined;
		const timingNow = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			? (claim?.timingNow ?? defaultReceiptTimingNowV1)
			: defaultReceiptTimingNowV1;
		const timingRecords = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			&& timingSink
			&& claim?.timingRequestId
			? [] as ReceiptTimingRecordV1[]
			: null;

		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(
				[
					RECEIPT_OBJECT_STORE_NAME,
					METADATA_OBJECT_STORE_NAME,
					...(auditEvent ? [SECURITY_AUDIT_OBJECT_STORE_NAME_V1] : []),
				],
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const auditStore = auditEvent
				? transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1)
				: null;
			const auditRecordsPromise = auditStore
				? requestResult(
					auditStore.getAll() as IDBRequest<StoredSecurityAuditEventV1[]>,
				)
				: null;
			const metadataStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const metadata = await this.withOperationTimeout(
				requestResult(
					metadataStore.get(RECEIPT_GENERATION_KEY) as IDBRequest<
						StoredReceiptMetadataV1 | undefined
					>,
				),
				transaction,
			);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-metadata-journal',
					metadataStartedAt,
					timingNow,
				);
			}
			assertValidReceiptMetadata(metadata);
			// Generation is the cross-window fence for every supported writer,
			// all of which mutate receipts through this store and bump metadata in
			// the same transaction. Out-of-protocol raw IndexedDB edits are not an
			// admitted writer; the next forced admission scan will fail closed.
			const generationPlanStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const useFastPath = RECEIPT_ADMISSION_FAST_PATH_ENABLED
				&& claim !== null
				&& claim.databaseEpoch === metadata.databaseEpoch
				&& claim.generation === metadata.generation;
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-generation-plan',
					generationPlanStartedAt,
					timingNow,
				);
			}
			const fallbackStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED && !useFastPath
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const records: StoredMutationReceiptV1[] = useFastPath && claim
				? replaceStoredReceipt(claim.records, stored)
				: await this.withOperationTimeout(
					Promise.all([
						requestResult(store.put(stored)),
						requestResult(store.getAll() as IDBRequest<StoredMutationReceiptV1[]>),
					]).then(([, allRecords]) => allRecords),
					transaction,
				);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED && !useFastPath) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-fallback-scan',
					fallbackStartedAt,
					timingNow,
				);
			}
			const auditRecords = auditRecordsPromise
				? await this.withOperationTimeout(auditRecordsPromise, transaction)
				: [];
			const putRequest = useFastPath ? store.put(stored) : null;
			const pruneStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const prune = useFastPath
				? planPruneValidatedAdmissionSnapshot(records, now)
				: planPrune(records, now);
			const deletes = prune.keysToDelete.map(recordKey => requestResult(store.delete(recordKey)));
			const generationRequest = metadataStore.put(incrementReceiptGeneration(metadata));
			const storedAudit = auditEvent
				? createStoredSecurityAuditEventV1(auditEvent)
				: null;
			if (storedAudit && auditRecords.some(record => record.key === storedAudit.key)) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-invalid-receipt',
					'The terminal audit event ID has already been used.',
				);
			}
			const auditPrune = auditStore && storedAudit
				? planSecurityAuditPruneV1([...auditRecords, storedAudit], now)
				: null;
			const auditPut = auditStore && storedAudit
				? auditStore.put(storedAudit)
				: null;
			const auditDeletes = auditStore && auditPrune
				? auditPrune.keysToDelete.map(recordKey => requestResult(auditStore.delete(recordKey)))
				: [];
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-validate-prune',
					pruneStartedAt,
					timingNow,
				);
			}
			const commitStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			await this.withOperationTimeout(
				Promise.all([
					...(putRequest ? [requestResult(putRequest)] : []),
					...deletes,
					...(auditPut ? [requestResult(auditPut)] : []),
					...auditDeletes,
					requestResult(generationRequest),
					completion,
				]),
				transaction,
			);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-commit',
					commitStartedAt,
					timingNow,
				);
				flushReceiptTimingV1(
					timingSink,
					claim?.timingRequestId,
					timingRecords,
				);
			}
			return prune.result;
		} catch (error) {
			if (transaction) safeAbort(transaction);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				flushReceiptTimingV1(
					timingSink,
					claim?.timingRequestId,
					timingRecords,
				);
			}
			this.rethrowOperationFailure(error);
		}
	}

	async lookupJournal(
		scope: MutationReceiptScopeV1,
	): Promise<GraphTransactionJournalV1 | null> {
		assertValidScope(scope);
		return await this.updateJournal(scope, async (stored, _key, _store, completion) => {
			if (!stored) {
				await this.withOperationTimeout(completion);
				return null;
			}
			if (
				!isStoredJournalValid(stored)
				|| !scopeMatches(scope, graphJournalScopeV1(stored.journal))
			) {
				this.markUnhealthy('operation-failed');
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-corrupt',
					'The graph transaction journal failed strict metadata validation.',
				);
			}
			await this.withOperationTimeout(completion);
			return cloneJournal(stored.journal);
		});
	}

	async hasUnresolvedGraphTransaction(): Promise<boolean> {
		const database = await this.requireHealthyDatabase();
		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(JOURNAL_OBJECT_STORE_NAME, 'readonly');
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(JOURNAL_OBJECT_STORE_NAME);
			const count = await this.withOperationTimeout(
				requestResult(store.count()),
				transaction,
			);
			await this.withOperationTimeout(completion, transaction);
			return count > 0;
		} catch (error) {
			if (transaction) safeAbort(transaction);
			this.rethrowOperationFailure(error);
		}
	}

	async acquireJournal(
		journal: GraphTransactionJournalV1,
		leaseOwner: string,
	): Promise<boolean> {
		const now = this.now();
		assertValidJournal(journal);
		assertValidLeaseOwner(leaseOwner);
		return await this.updateJournal(
			graphJournalScopeV1(journal),
			async (existing, key, store, completion, transaction) => {
			if (existing) {
				if (!isStoredJournalValid(existing)) {
					throw new MutationReceiptStoreErrorV1(
						'receipt-store-corrupt',
						'Graph journal is corrupt.',
					);
				}
				await this.withOperationTimeout(completion, transaction);
				return false;
			}
			const putRequest = store.put(createStoredJournal(key, journal, now, leaseOwner));
			await this.withOperationTimeout(
				Promise.all([requestResult(putRequest), completion]),
				transaction,
			);
			return true;
			},
		);
	}

	async claimJournal(
		scope: MutationReceiptScopeV1,
		expected: GraphTransactionJournalV1,
		leaseOwner: string,
	): Promise<boolean> {
		assertValidScope(scope);
		assertValidJournal(expected);
		assertValidLeaseOwner(leaseOwner);
		const now = this.now();
		return await this.updateJournal(scope, async (
			existing,
			_key,
			store,
			completion,
			transaction,
		) => {
			if (
				!existing
				|| !isStoredJournalValid(existing)
				|| !journalsEqual(existing.journal, expected)
				|| (
					existing.leaseOwner !== leaseOwner
					&& existing.leaseExpiresAtMs > now
				)
			) {
				await this.withOperationTimeout(completion, transaction);
				return false;
			}
			const putRequest = store.put({
				...existing,
				updatedAtMs: now,
				leaseOwner,
				leaseExpiresAtMs: now + GRAPH_TRANSACTION_JOURNAL_LEASE_MS_V1,
			});
			await this.withOperationTimeout(
				Promise.all([requestResult(putRequest), completion]),
				transaction,
			);
			return true;
		});
	}

	async persistJournal(
		journal: GraphTransactionJournalV1,
		leaseOwner: string,
	): Promise<void> {
		const now = this.now();
		assertValidJournal(journal);
		assertValidLeaseOwner(leaseOwner);
		await this.updateJournal(
			graphJournalScopeV1(journal),
			async (existing, key, store, completion, transaction) => {
			if (!existing || !isStoredJournalValid(existing)) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-corrupt',
					'Graph journal fence is missing.',
				);
			}
			if (existing.leaseOwner !== leaseOwner) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-invalid-receipt',
					'Graph journal lease is held.',
				);
			}
			assertJournalUpdate(existing.journal, journal);
			const putRequest = store.put(createStoredJournal(key, journal, now, leaseOwner));
			await this.withOperationTimeout(
				Promise.all([requestResult(putRequest), completion]),
				transaction,
			);
			},
		);
	}

	async deleteJournal(
		scope: MutationReceiptScopeV1,
		expected: GraphTransactionJournalV1,
		leaseOwner: string,
	): Promise<boolean> {
		assertValidScope(scope);
		assertValidJournal(expected);
		assertValidLeaseOwner(leaseOwner);
		return await this.updateJournal(scope, async (
			existing,
			key,
			store,
			completion,
			transaction,
		) => {
			if (
				!existing
				|| !isStoredJournalValid(existing)
				|| existing.leaseOwner !== leaseOwner
				|| !journalsEqual(existing.journal, expected)
			) {
				await this.withOperationTimeout(completion, transaction);
				return false;
			}
			await this.withOperationTimeout(
				Promise.all([requestResult(store.delete(key)), completion]),
				transaction,
			);
			return true;
		});
	}

	/**
	 * Makes successful completion crash-safe: a terminal receipt cannot become
	 * visible while its recovery fence remains visible, or vice versa.
	 */
	async finalizeReceipt(
		receipt: MutationReceiptV1,
		expectedJournal: GraphTransactionJournalV1,
		leaseOwner: string,
	): Promise<MutationReceiptPruneResultV1> {
		return await this.finalizeStoredReceipt(
			receipt,
			expectedJournal,
			leaseOwner,
			null,
		);
	}

	async finalizeReceiptAfterApplyAdmission(
		receipt: MutationReceiptV1,
		expectedJournal: GraphTransactionJournalV1,
		leaseOwner: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1,
	): Promise<MutationReceiptPruneResultV1> {
		return await this.finalizeStoredReceipt(
			receipt,
			expectedJournal,
			leaseOwner,
			admissionToken,
		);
	}

	async finalizeReceiptWithSecurityAuditAfterApplyAdmission(
		receipt: MutationReceiptV1,
		expectedJournal: GraphTransactionJournalV1,
		leaseOwner: string,
		auditEvent: SecurityAuditEventV1,
		admissionToken: MutationReceiptApplyAdmissionTokenV1,
	): Promise<MutationReceiptPruneResultV1> {
		return await this.finalizeStoredReceipt(
			receipt,
			expectedJournal,
			leaseOwner,
			admissionToken,
			auditEvent,
		);
	}

	private async finalizeStoredReceipt(
		receipt: MutationReceiptV1,
		expectedJournal: GraphTransactionJournalV1,
		leaseOwner: string,
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		auditEvent: SecurityAuditEventV1 | null = null,
	): Promise<MutationReceiptPruneResultV1> {
		const now = this.now();
		assertValidReceipt(receipt, now);
		assertValidJournal(expectedJournal);
		assertValidLeaseOwner(leaseOwner);
		if (auditEvent) assertValidSecurityAuditEventV1(auditEvent);
		const database = await this.requireHealthyDatabase();
		const scope = scopeFromReceipt(receipt);
		const key = await opaqueScopeKey(scope);
		const claim = this.consumeAdmissionClaim(admissionToken, key);
		const timingSink = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			? claim?.timingSink
			: undefined;
		const timingNow = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			? (claim?.timingNow ?? defaultReceiptTimingNowV1)
			: defaultReceiptTimingNowV1;
		const timingRecords = OPERON_AGENT_RUNTIME_PROBE_ENABLED
			&& timingSink
			&& claim?.timingRequestId
			? [] as ReceiptTimingRecordV1[]
			: null;
		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(
				[
					RECEIPT_OBJECT_STORE_NAME,
					JOURNAL_OBJECT_STORE_NAME,
					METADATA_OBJECT_STORE_NAME,
					...(auditEvent ? [SECURITY_AUDIT_OBJECT_STORE_NAME_V1] : []),
				],
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const receiptStore = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const journalStore = transaction.objectStore(JOURNAL_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const auditStore = auditEvent
				? transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1)
				: null;
			const metadataStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const [existingJournal, metadata, auditRecords] = await this.withOperationTimeout(
				Promise.all([
					requestResult(
						journalStore.get(key) as IDBRequest<
							StoredGraphTransactionJournalV1 | undefined
						>,
					),
					requestResult(
						metadataStore.get(RECEIPT_GENERATION_KEY) as IDBRequest<
							StoredReceiptMetadataV1 | undefined
						>,
					),
					auditStore
						? requestResult(
							auditStore.getAll() as IDBRequest<StoredSecurityAuditEventV1[]>,
						)
						: Promise.resolve([] as StoredSecurityAuditEventV1[]),
				]),
				transaction,
			);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-metadata-journal',
					metadataStartedAt,
					timingNow,
				);
			}
			assertValidReceiptMetadata(metadata);
			if (
				!existingJournal
				|| !isStoredJournalValid(existingJournal)
				|| existingJournal.leaseOwner !== leaseOwner
				|| !journalsEqual(existingJournal.journal, expectedJournal)
				|| !graphJournalMatchesReceiptV1(existingJournal.journal, receipt)
			) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-invalid-receipt',
					'Receipt does not match graph journal.',
				);
			}
			const storedReceipt = createStoredReceipt(key, receipt);
			const storedAudit = auditEvent
				? createStoredSecurityAuditEventV1(auditEvent)
				: null;
			if (storedAudit && auditRecords.some(record => record.key === storedAudit.key)) {
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-invalid-receipt',
					'The terminal audit event ID has already been used.',
				);
			}
			const auditPrune = auditStore && storedAudit
				? planSecurityAuditPruneV1([...auditRecords, storedAudit], now)
				: null;
			// See persistReceipt: supported concurrent writers participate in this
			// generation CAS. Raw same-origin database tampering is outside the
			// receipt-store writer contract and is caught by the next admission.
			const generationPlanStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const useFastPath = RECEIPT_ADMISSION_FAST_PATH_ENABLED
				&& claim !== null
				&& claim.databaseEpoch === metadata.databaseEpoch
				&& claim.generation === metadata.generation;
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-generation-plan',
					generationPlanStartedAt,
					timingNow,
				);
			}
			const putPromise = requestResult(receiptStore.put(storedReceipt));
			const deleteJournalPromise = requestResult(journalStore.delete(key));
			const auditPutPromise = auditStore && storedAudit
				? requestResult(auditStore.put(storedAudit))
				: null;
			const auditDeletes = auditStore && auditPrune
				? auditPrune.keysToDelete.map(
					recordKey => requestResult(auditStore.delete(recordKey)),
				)
				: [];
			const fallbackStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED && !useFastPath
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const records = useFastPath
				? replaceStoredReceipt(claim.records, storedReceipt)
				: await this.withOperationTimeout(
					requestResult(
						receiptStore.getAll() as IDBRequest<StoredMutationReceiptV1[]>,
					),
					transaction,
				);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED && !useFastPath) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-fallback-scan',
					fallbackStartedAt,
					timingNow,
				);
			}
			const pruneStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			const prune = useFastPath
				? planPruneValidatedAdmissionSnapshot(records, now)
				: planPrune(records, now);
			const deletes = prune.keysToDelete.map(
				recordKey => requestResult(receiptStore.delete(recordKey)),
			);
			const generationRequest = metadataStore.put(incrementReceiptGeneration(metadata));
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-validate-prune',
					pruneStartedAt,
					timingNow,
				);
			}
			const commitStartedAt = OPERON_AGENT_RUNTIME_PROBE_ENABLED
				? receiptTimingNowV1(timingRecords, timingNow)
				: null;
			await this.withOperationTimeout(
				Promise.all([
					putPromise,
					deleteJournalPromise,
					...(auditPutPromise ? [auditPutPromise] : []),
					...auditDeletes,
					...deletes,
					requestResult(generationRequest),
					completion,
				]),
				transaction,
			);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				recordReceiptTimingV1(
					timingRecords,
					'receipt-terminal-commit',
					commitStartedAt,
					timingNow,
				);
				flushReceiptTimingV1(
					timingSink,
					claim?.timingRequestId,
					timingRecords,
				);
			}
			return prune.result;
		} catch (error) {
			if (transaction) safeAbort(transaction);
			if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
				flushReceiptTimingV1(
					timingSink,
					claim?.timingRequestId,
					timingRecords,
				);
			}
			this.rethrowOperationFailure(error);
		}
	}

	async delete(scope: MutationReceiptScopeV1): Promise<boolean> {
		assertValidScope(scope);
		const database = await this.requireHealthyDatabase();
		const key = await opaqueScopeKey(scope);
		try {
			const transaction = database.transaction(
				[RECEIPT_OBJECT_STORE_NAME, METADATA_OBJECT_STORE_NAME],
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const [existing, metadata] = await this.withOperationTimeout(
				Promise.all([
					requestResult<IDBValidKey | undefined>(store.getKey(key)),
					requestResult(
						metadataStore.get(RECEIPT_GENERATION_KEY) as IDBRequest<
							StoredReceiptMetadataV1 | undefined
						>,
					),
				]),
				transaction,
			);
			assertValidReceiptMetadata(metadata);
			if (existing === undefined) {
				await this.withOperationTimeout(completion, transaction);
				return false;
			}
			const deleteRequest = store.delete(key);
			const generationRequest = metadataStore.put(incrementReceiptGeneration(metadata));
			await this.withOperationTimeout(
				Promise.all([
					requestResult(deleteRequest),
					requestResult(generationRequest),
					completion,
				]),
				transaction,
			);
			return true;
		} catch (error) {
			this.rethrowOperationFailure(error);
		}
	}

	async prune(): Promise<MutationReceiptPruneResultV1> {
		const database = await this.requireHealthyDatabase();
		try {
			const transaction = database.transaction(
				[RECEIPT_OBJECT_STORE_NAME, METADATA_OBJECT_STORE_NAME],
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(RECEIPT_OBJECT_STORE_NAME);
			const metadataStore = transaction.objectStore(METADATA_OBJECT_STORE_NAME);
			const [records, metadata] = await this.withOperationTimeout(
				Promise.all([
					requestResult(store.getAll() as IDBRequest<StoredMutationReceiptV1[]>),
					requestResult(
						metadataStore.get(RECEIPT_GENERATION_KEY) as IDBRequest<
							StoredReceiptMetadataV1 | undefined
						>,
					),
				]),
				transaction,
			);
			assertValidReceiptMetadata(metadata);
			if (records.some(record => !isStoredReceiptValid(record))) {
				safeAbort(transaction);
				this.markUnhealthy('operation-failed');
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-corrupt',
					'The receipt store contains a record that failed strict metadata validation.',
				);
			}
			const prune = planPrune(records, this.now());
			const deletes = prune.keysToDelete.map(recordKey => requestResult(store.delete(recordKey)));
			const generationWrite = deletes.length > 0
				? [requestResult(metadataStore.put(incrementReceiptGeneration(metadata)))]
				: [];
			await this.withOperationTimeout(
				Promise.all([...deletes, ...generationWrite, completion]),
				transaction,
			);
			return prune.result;
		} catch (error) {
			this.rethrowOperationFailure(error);
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.closeDatabase();
		this.setHealth(false, 'closed', 'store-closed');
	}

	private async updateJournal<T>(
		scope: MutationReceiptScopeV1,
		operation: (
			existing: StoredGraphTransactionJournalV1 | undefined,
			key: string,
			store: IDBObjectStore,
			completion: Promise<void>,
			transaction: IDBTransaction,
		) => Promise<T>,
	): Promise<T> {
		const database = await this.requireHealthyDatabase();
		const key = await opaqueScopeKey(scope);
		const transaction = database.transaction(JOURNAL_OBJECT_STORE_NAME, 'readwrite');
		try {
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(JOURNAL_OBJECT_STORE_NAME);
			const existing = await this.withOperationTimeout(
				requestResult(
					store.get(key) as IDBRequest<StoredGraphTransactionJournalV1 | undefined>,
				),
				transaction,
			);
			return await operation(existing, key, store, completion, transaction);
		} catch (error) {
			safeAbort(transaction);
			this.rethrowOperationFailure(error);
		}
	}

	private async requireHealthyDatabase(): Promise<IDBDatabase> {
		if (this.closed) {
			throw new MutationReceiptStoreErrorV1(
				'receipt-store-closed',
				'The receipt store has been closed.',
			);
		}
		const health = await this.health();
		if (!health.healthy) {
			throw new MutationReceiptStoreErrorV1(
				health.status === 'unavailable'
					? 'receipt-store-unavailable'
					: 'receipt-store-unhealthy',
				`The receipt store is not healthy: ${health.reason}.`,
			);
		}
		return await this.openDatabase();
	}

	private consumeAdmissionClaim(
		admissionToken: MutationReceiptApplyAdmissionTokenV1 | null,
		scopeKey: string,
	): ReceiptAdmissionClaimV1 | null {
		if (!admissionToken) return null;
		const claim = this.admissionClaims.get(admissionToken);
		this.admissionClaims.delete(admissionToken);
		if (
			!claim
			|| claim.scopeKey !== scopeKey
			|| claim.connectionEpoch !== this.connectionEpoch
		) {
			return null;
		}
		return claim;
	}

	private async openDatabase(): Promise<IDBDatabase> {
		if (this.closed) {
			throw new MutationReceiptStoreErrorV1(
				'receipt-store-closed',
				'The receipt store has been closed.',
			);
		}
		if (this.database) return this.database;
		if (this.databasePromise) return await this.databasePromise;
		if (!this.indexedDBFactory) {
			throw new MutationReceiptStoreErrorV1(
				'receipt-store-unavailable',
				'IndexedDB is unavailable in this Runtime.',
			);
		}

		let acceptLateOpen = true;
		this.databasePromise = this.withOperationTimeout(new Promise<IDBDatabase>((resolve, reject) => {
			const request = this.indexedDBFactory?.open(this.databaseName, DATABASE_VERSION);
			if (!request) {
				reject(new Error('IndexedDB factory did not return an open request.'));
				return;
			}
			request.onupgradeneeded = () => ensureAgentRuntimeObjectStoresV1(request.result);
			request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
			// A blocked upgrade request remains pending and can still succeed after
			// the blocker closes. The operation timeout owns rejection; any success
			// delivered after that timeout must close its otherwise orphaned handle.
			request.onblocked = () => undefined;
			request.onsuccess = () => {
				if (!acceptLateOpen) {
					request.result.close();
					return;
				}
				resolve(request.result);
			};
		}), undefined, () => {
			acceptLateOpen = false;
		});

		try {
			const database = await this.databasePromise;
			if (this.closed) {
				database.close();
				throw new MutationReceiptStoreErrorV1(
					'receipt-store-closed',
					'The receipt store was closed while IndexedDB was opening.',
				);
			}
			database.onversionchange = () => {
				database.close();
				this.connectionEpoch += 1;
				if (this.database === database) this.database = null;
				this.databasePromise = null;
				this.markUnhealthy('database-version-changed');
			};
			this.database = database;
			this.connectionEpoch += 1;
			return database;
		} catch (error) {
			this.databasePromise = null;
			throw error;
		}
	}

	private async withOperationTimeout<T>(
		promise: Promise<T>,
		transaction?: IDBTransaction,
		onTimeout?: () => void,
	): Promise<T> {
		return await withIndexedDbOperationTimeoutV1({
			promise,
			timeoutMs: this.operationTimeoutMs,
			transaction,
			onTimeout,
			timeoutError: () => new ReceiptStoreOperationTimeoutError(),
		});
	}

	private rethrowOperationFailure(error: unknown): never {
		if (error instanceof MutationReceiptStoreErrorV1) throw error;
		const reason = error instanceof ReceiptStoreOperationTimeoutError
			? 'operation-timeout'
			: 'operation-failed';
		this.markUnhealthy(reason);
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-unhealthy',
			`The receipt store operation failed: ${errorMessage(error)}.`,
		);
	}

	private markUnhealthy(reason: StoreHealthReasonV1): void {
		if (this.closed) return;
		this.setHealth(false, 'unhealthy', reason);
	}

	private closeDatabase(): void {
		this.database?.close();
		if (this.database || this.databasePromise) this.connectionEpoch += 1;
		this.database = null;
		this.databasePromise = null;
	}

	private setHealth(
		healthy: boolean,
		status: MutationReceiptStoreHealthStatusV1,
		reason: StoreHealthReasonV1,
	): MutationReceiptStoreHealthV1 {
		this.healthState = { healthy, status, reason };
		return { ...this.healthState };
	}
}

class ReceiptStoreOperationTimeoutError extends Error {
	constructor() {
		super('The IndexedDB receipt-store operation timed out.');
		this.name = 'ReceiptStoreOperationTimeoutError';
	}
}

function normalizeTimeout(value: number | undefined): number {
	return normalizeIndexedDbTimeoutV1(value, DEFAULT_OPERATION_TIMEOUT_MS);
}

function isExpectedDatabaseSchema(database: IDBDatabase): boolean {
	return hasAgentRuntimeObjectStoresV1(database);
}

function assertValidReceiptMetadata(
	value: StoredReceiptMetadataV1 | undefined,
): asserts value is StoredReceiptMetadataV1 {
	if (
		!value
		|| !isPlainObject(value)
		|| !hasExactKeys(value, ['key', 'databaseEpoch', 'generation'])
		|| value.key !== RECEIPT_GENERATION_KEY
		|| !/^[a-f0-9]{32}$/.test(value.databaseEpoch)
		|| !Number.isSafeInteger(value.generation)
		|| value.generation < 0
	) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-corrupt',
			'The receipt generation metadata is missing or invalid.',
		);
	}
}

function incrementReceiptGeneration(
	metadata: StoredReceiptMetadataV1,
): StoredReceiptMetadataV1 {
	assertValidReceiptMetadata(metadata);
	if (metadata.generation >= Number.MAX_SAFE_INTEGER) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-corrupt',
			'The receipt generation counter cannot advance safely.',
		);
	}
	return {
		...metadata,
		generation: metadata.generation + 1,
	};
}

function replaceStoredReceipt(
	records: readonly StoredMutationReceiptV1[],
	stored: StoredMutationReceiptV1,
): StoredMutationReceiptV1[] {
	return [
		...records
			.filter(record => record.key !== stored.key)
			.map(record => cloneStoredReceipt(record)),
		cloneStoredReceipt(stored),
	];
}

function cloneStoredReceipt(
	stored: StoredMutationReceiptV1,
): StoredMutationReceiptV1 {
	return {
		key: stored.key,
		completedAtMs: stored.completedAtMs,
		expiresAtMs: stored.expiresAtMs,
		receipt: cloneReceipt(stored.receipt),
	};
}

function assertValidScope(scope: MutationReceiptScopeV1): void {
	if (
		!isSha256(scope.vaultIdentityHash)
		|| !isSha256(scope.idempotencyKeyHash)
		|| !isBoundedClientInstanceId(scope.clientInstanceId)
		|| !MUTATION_KINDS.has(scope.mutationKind)
	) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-invalid-scope',
			'The receipt lookup scope is invalid.',
		);
	}
}

function assertValidReceipt(receipt: MutationReceiptV1, now: number): void {
	if (!isReceiptValid(receipt) || Date.parse(receipt.expiresAt) <= now) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-invalid-receipt',
			'The receipt is invalid or already expired.',
		);
	}
}

function isReceiptValid(receipt: MutationReceiptV1): boolean {
	if (!isPlainObject(receipt)) return false;
	if (!hasExactKeys(receipt, [
		'contractVersion',
		'vaultIdentityHash',
		'clientInstanceId',
		'idempotencyKeyHash',
		'planHash',
		'mutationKind',
		'targetDigest',
		'terminalOutcome',
		'effectiveAt',
		'completedAt',
		'expiresAt',
	])) return false;
	if (receipt.contractVersion !== 1) return false;
	if (
		!isSha256(receipt.vaultIdentityHash)
		|| !isSha256(receipt.idempotencyKeyHash)
		|| !isSha256(receipt.planHash)
		|| !isSha256(receipt.targetDigest)
		|| !isBoundedClientInstanceId(receipt.clientInstanceId)
		|| !MUTATION_KINDS.has(receipt.mutationKind)
		|| !TERMINAL_OUTCOMES.has(receipt.terminalOutcome)
	) return false;
	if (
		!isUtcTimestamp(receipt.effectiveAt)
		|| !isUtcTimestamp(receipt.completedAt)
		|| !isUtcTimestamp(receipt.expiresAt)
	) return false;
	const effectiveAtMs = Date.parse(receipt.effectiveAt);
	const completedAtMs = Date.parse(receipt.completedAt);
	const expiresAtMs = Date.parse(receipt.expiresAt);
	return effectiveAtMs <= completedAtMs
		&& expiresAtMs > completedAtMs
		&& expiresAtMs - completedAtMs <= MUTATION_RECEIPT_TTL_MS_V1;
}

function createStoredReceipt(key: string, receipt: MutationReceiptV1): StoredMutationReceiptV1 {
	return {
		key,
		completedAtMs: Date.parse(receipt.completedAt),
		expiresAtMs: Date.parse(receipt.expiresAt),
		receipt: cloneReceipt(receipt),
	};
}

function assertValidJournal(journal: GraphTransactionJournalV1): void {
	if (!isJournalValid(journal)) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-invalid-receipt',
			'Graph journal is invalid.',
		);
	}
	const bytes = new TextEncoder().encode(JSON.stringify(journal)).byteLength;
	if (bytes > GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-invalid-receipt',
			`Graph journal exceeds ${GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1} bytes.`,
		);
	}
}

function isJournalValid(journal: GraphTransactionJournalV1): boolean {
	if (!isPlainObject(journal)) return false;
	if (!hasExactKeys(journal, [
		'contractVersion',
		'vaultIdentityHash',
		'clientInstanceId',
		'idempotencyKeyHash',
		'mutationKind',
		'planHash',
		'targetDigest',
		'planId',
		'effectiveAt',
		'createdAt',
		'phase',
		'completedStepCount',
		'steps',
	])) return false;
	if (
		journal.contractVersion !== 1
		|| !isSha256(journal.vaultIdentityHash)
		|| !isSha256(journal.idempotencyKeyHash)
		|| !isSha256(journal.planHash)
		|| !isSha256(journal.targetDigest)
		|| !isBoundedClientInstanceId(journal.clientInstanceId)
		|| !MUTATION_KINDS.has(journal.mutationKind)
		|| !isBoundedJournalText(journal.planId, 128)
		|| !isUtcTimestamp(journal.effectiveAt)
		|| !isUtcTimestamp(journal.createdAt)
		|| !isJournalPhase(journal.phase)
		|| !Number.isSafeInteger(journal.completedStepCount)
		|| !Array.isArray(journal.steps)
		|| journal.steps.length < 1
		|| journal.steps.length > GRAPH_TRANSACTION_JOURNAL_MAX_STEPS_V1
		|| journal.completedStepCount < 0
		|| journal.completedStepCount > journal.steps.length
	) return false;
	if (journal.phase === 'prepared' && journal.completedStepCount !== 0) return false;
	if (
		journal.phase === 'postflight'
		&& journal.completedStepCount !== journal.steps.length
	) return false;
	const createdAtMs = Date.parse(journal.createdAt);
	const effectiveAtMs = Date.parse(journal.effectiveAt);
	if (effectiveAtMs < createdAtMs) return false;
	const ids = new Set<string>();
	return journal.steps.every(step => {
		if (!isPlainObject(step) || !hasExactKeys(step, [
			'stepId',
			'groupId',
			'resourceKind',
			'resourceKey',
			'operation',
			'before',
			'after',
		])) return false;
		if (
			!isBoundedJournalText(step.stepId, 128)
			|| !isBoundedJournalText(step.groupId, 128)
			|| !isBoundedJournalText(step.resourceKey, 4_096)
			|| ![
				'task-source',
				'repeat-series',
				'pinned',
				'active-tracker',
				'semantic-transition',
			].includes(step.resourceKind)
			|| !['create', 'modify', 'delete'].includes(step.operation)
			|| !isResourceStateValid(step.before)
			|| !isResourceStateValid(step.after)
			|| ids.has(step.stepId)
		) return false;
		ids.add(step.stepId);
		if (
			step.operation === 'create'
			&& (step.before.state !== 'absent' || step.after.state !== 'present')
		) return false;
		if (
			step.operation === 'delete'
			&& (step.before.state !== 'present' || step.after.state !== 'absent')
		) return false;
		if (
			step.operation === 'modify'
			&& (step.before.state !== 'present' || step.after.state !== 'present')
		) return false;
		if (
			(
				step.resourceKind === 'pinned'
				|| step.resourceKind === 'active-tracker'
				|| step.resourceKind === 'semantic-transition'
			)
			&& step.operation !== 'modify'
		) return false;
		return true;
	});
}

function isResourceStateValid(value: GraphTransactionResourceStateV1): boolean {
	if (!isPlainObject(value) || !hasExactKeys(value, ['state', 'digest', 'content'])) return false;
	if (
		(value.state !== 'absent' && value.state !== 'present')
		|| !isSha256(value.digest)
	) return false;
	if (value.state === 'absent' && value.content !== null) return false;
	if (value.state === 'present' && typeof value.content !== 'string') return false;
	return value.digest === sha256HexV1(value.content ?? '');
}

function isJournalPhase(value: unknown): value is GraphTransactionJournalPhaseV1 {
	return value === 'prepared'
		|| value === 'committing'
		|| value === 'compensating'
		|| value === 'postflight';
}

function isBoundedJournalText(value: unknown, maxLength: number): value is string {
	return typeof value === 'string'
		&& value.length >= 1
		&& value.length <= maxLength
		&& value === value.normalize('NFC')
		&& Array.from(value).every(character => {
			const codePoint = character.codePointAt(0);
			return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
		});
}

function createStoredJournal(
	key: string,
	journal: GraphTransactionJournalV1,
	now: number,
	leaseOwner: string,
): StoredGraphTransactionJournalV1 {
	return {
		key,
		updatedAtMs: now,
		leaseOwner,
		leaseExpiresAtMs: now + GRAPH_TRANSACTION_JOURNAL_LEASE_MS_V1,
		journal: cloneJournal(journal),
	};
}

function isStoredJournalValid(value: unknown): value is StoredGraphTransactionJournalV1 {
	if (!isPlainObject(value)) return false;
	if (!hasExactKeys(value, [
		'key',
		'updatedAtMs',
		'leaseOwner',
		'leaseExpiresAtMs',
		'journal',
	])) return false;
	let journalBytes = 0;
	try {
		journalBytes = new TextEncoder().encode(JSON.stringify(value.journal)).byteLength;
	} catch {
		return false;
	}
	if (journalBytes > GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1) return false;
	const updatedAtMs = value.updatedAtMs;
	const leaseExpiresAtMs = value.leaseExpiresAtMs;
	if (
		!isSha256(value.key)
		|| typeof updatedAtMs !== 'number'
		|| !Number.isSafeInteger(updatedAtMs)
		|| !isValidLeaseOwner(value.leaseOwner)
		|| typeof leaseExpiresAtMs !== 'number'
		|| !Number.isSafeInteger(leaseExpiresAtMs)
		|| leaseExpiresAtMs !== updatedAtMs + GRAPH_TRANSACTION_JOURNAL_LEASE_MS_V1
		|| !isJournalValid(value.journal as GraphTransactionJournalV1)
	) return false;
	return true;
}

function assertValidLeaseOwner(value: string): void {
	if (!isValidLeaseOwner(value)) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-invalid-scope',
			'The graph transaction lease owner is invalid.',
		);
	}
}

function isValidLeaseOwner(value: unknown): value is string {
	return isBoundedJournalText(value, 128);
}

function journalsEqual(
	left: GraphTransactionJournalV1,
	right: GraphTransactionJournalV1,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function assertJournalUpdate(
	before: GraphTransactionJournalV1,
	after: GraphTransactionJournalV1,
): void {
	if (
		before.vaultIdentityHash !== after.vaultIdentityHash
		|| before.clientInstanceId !== after.clientInstanceId
		|| before.idempotencyKeyHash !== after.idempotencyKeyHash
		|| before.mutationKind !== after.mutationKind
		|| before.planHash !== after.planHash
		|| before.targetDigest !== after.targetDigest
		|| before.planId !== after.planId
		|| before.effectiveAt !== after.effectiveAt
		|| before.createdAt !== after.createdAt
		|| JSON.stringify(before.steps) !== JSON.stringify(after.steps)
		|| after.completedStepCount < before.completedStepCount
		|| !journalPhaseCanAdvance(before.phase, after.phase)
	) {
		throw new MutationReceiptStoreErrorV1(
			'receipt-store-invalid-receipt',
			'The graph transaction journal update changed its sealed binding or moved backward.',
		);
	}
}

function journalPhaseCanAdvance(
	before: GraphTransactionJournalPhaseV1,
	after: GraphTransactionJournalPhaseV1,
): boolean {
	if (before === after) return true;
	if (before === 'prepared') return after === 'committing' || after === 'compensating';
	if (before === 'committing') return after === 'postflight' || after === 'compensating';
	if (before === 'postflight') return after === 'compensating';
	return false;
}

function cloneJournal(journal: GraphTransactionJournalV1): GraphTransactionJournalV1 {
	return {
		...journal,
		steps: journal.steps.map(step => ({
			...step,
			before: { ...step.before },
			after: { ...step.after },
		})),
	};
}

function isStoredReceiptValid(value: unknown): value is StoredMutationReceiptV1 {
	if (!isPlainObject(value)) return false;
	if (!hasExactKeys(value, ['key', 'completedAtMs', 'expiresAtMs', 'receipt'])) return false;
	if (!isSha256(value.key)) return false;
	if (!Number.isSafeInteger(value.completedAtMs) || !Number.isSafeInteger(value.expiresAtMs)) return false;
	if (!isReceiptValid(value.receipt as MutationReceiptV1)) return false;
	const receipt = value.receipt as MutationReceiptV1;
	return value.completedAtMs === Date.parse(receipt.completedAt)
		&& value.expiresAtMs === Date.parse(receipt.expiresAt);
}

function scopeFromReceipt(receipt: MutationReceiptV1): MutationReceiptScopeV1 {
	return {
		vaultIdentityHash: receipt.vaultIdentityHash,
		clientInstanceId: receipt.clientInstanceId,
		idempotencyKeyHash: receipt.idempotencyKeyHash,
		mutationKind: receipt.mutationKind,
	};
}

function receiptMatchesScope(receipt: MutationReceiptV1, scope: MutationReceiptScopeV1): boolean {
	return scopeMatches(scopeFromReceipt(receipt), scope);
}

function scopeMatches(left: MutationReceiptScopeV1, right: MutationReceiptScopeV1): boolean {
	return left.vaultIdentityHash === right.vaultIdentityHash
		&& left.clientInstanceId === right.clientInstanceId
		&& left.idempotencyKeyHash === right.idempotencyKeyHash
		&& left.mutationKind === right.mutationKind;
}

function cloneReceipt(receipt: MutationReceiptV1): MutationReceiptV1 {
	return {
		contractVersion: 1,
		vaultIdentityHash: receipt.vaultIdentityHash,
		clientInstanceId: receipt.clientInstanceId,
		idempotencyKeyHash: receipt.idempotencyKeyHash,
		planHash: receipt.planHash,
		mutationKind: receipt.mutationKind,
		targetDigest: receipt.targetDigest,
		terminalOutcome: receipt.terminalOutcome,
		effectiveAt: receipt.effectiveAt,
		completedAt: receipt.completedAt,
		expiresAt: receipt.expiresAt,
	};
}

function planPrune(
	records: StoredMutationReceiptV1[],
	now: number,
): { keysToDelete: string[]; result: MutationReceiptPruneResultV1 } {
	return planPruneRecords(records, now, true);
}

/**
 * Admission already validated and privately cloned these records. The terminal
 * generation fence proves that no supported receipt writer changed the
 * snapshot, while the newly inserted receipt was validated before this call.
 */
function planPruneValidatedAdmissionSnapshot(
	records: StoredMutationReceiptV1[],
	now: number,
): { keysToDelete: string[]; result: MutationReceiptPruneResultV1 } {
	return planPruneRecords(records, now, false);
}

function planPruneRecords(
	records: StoredMutationReceiptV1[],
	now: number,
	validate: boolean,
): { keysToDelete: string[]; result: MutationReceiptPruneResultV1 } {
	const plan = planExpiringRecordRetentionV1({
		records,
		now,
		maximumRecords: MUTATION_RECEIPT_MAX_RECORDS_V1,
		key: record => record.key,
		expiresAt: record => record.expiresAtMs,
		compareNewestFirst: (left, right) => (
			right.completedAtMs - left.completedAtMs
			|| left.key.localeCompare(right.key)
		),
		...(validate ? {
			validate: (record: StoredMutationReceiptV1) => {
				if (!isStoredReceiptValid(record)) {
					throw new MutationReceiptStoreErrorV1(
						'receipt-store-corrupt',
						'The receipt store contains invalid metadata.',
					);
				}
			},
		} : {}),
	});
	return {
		keysToDelete: plan.keysToDelete,
		result: {
			expiredDeleted: plan.expiredDeleted,
			overflowDeleted: plan.overflowDeleted,
			retained: plan.retained,
		},
	};
}

async function opaqueScopeKey(scope: MutationReceiptScopeV1): Promise<string> {
	const canonicalScope = JSON.stringify([
		scope.vaultIdentityHash,
		scope.clientInstanceId.normalize('NFC'),
		scope.idempotencyKeyHash,
		scope.mutationKind,
	]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalScope));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isBoundedClientInstanceId(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length >= 1
		&& value.length <= 128
		&& value === value.normalize('NFC')
		&& Array.from(value).every(character => {
			const codePoint = character.codePointAt(0);
			return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
		});
}

function isUtcTimestamp(value: unknown): value is string {
	return typeof value === 'string'
		&& ISO_UTC_PATTERN.test(value)
		&& Number.isFinite(Date.parse(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length
		&& actual.every((key, index) => key === expected[index]);
}

function defaultReceiptTimingNowV1(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function receiptTimingNowV1(
	records: ReceiptTimingRecordV1[] | null,
	now: () => number,
): number | null {
	if (!records) return null;
	try {
		const value = now();
		return Number.isFinite(value) ? value : null;
	} catch {
		return null;
	}
}

function recordReceiptTimingV1(
	records: ReceiptTimingRecordV1[] | null,
	span: RuntimeTimingSpanNameV1,
	startedAt: number | null,
	now: () => number,
): void {
	if (!records || startedAt === null) return;
	const endedAt = receiptTimingNowV1(records, now);
	if (endedAt === null) return;
	records.push({
		span,
		durationMs: Math.max(0, endedAt - startedAt),
	});
}

function flushReceiptTimingV1(
	sink: RuntimeTimingSinkV1 | undefined,
	requestId: string | undefined,
	records: ReceiptTimingRecordV1[] | null,
): void {
	if (!sink || !requestId || !records) return;
	for (const record of records) {
		try {
			sink.emit({
				requestId,
				flow: 'mutation-apply',
				span: record.span,
				durationMs: record.durationMs,
			});
		} catch {
			// Development diagnostics must never affect receipt durability.
		}
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return 'Unknown IndexedDB failure';
}
