import {
	MUTATION_KINDS_V1,
	type MutationKindV1,
} from '../../contracts/v1/capabilities';
import type { RiskLevelV1 } from '../../contracts/v1/mutation';
import {
	indexedDbRequestResultV1 as requestResult,
	indexedDbTransactionCompletionV1 as transactionCompletion,
	normalizeIndexedDbTimeoutV1,
	safeAbortIndexedDbTransactionV1 as safeAbort,
	withIndexedDbOperationTimeoutV1,
} from '../../internal/indexeddb-primitives';
import {
	AGENT_RUNTIME_DATABASE_VERSION_V1,
	AGENT_RUNTIME_DEFAULT_DATABASE_NAME_V1,
	SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
	ensureAgentRuntimeObjectStoresV1,
	hasAgentRuntimeObjectStoresV1,
} from './indexeddb-schema';

export const SECURITY_AUDIT_RETENTION_MS_V1 = 30 * 24 * 60 * 60 * 1_000;
export const SECURITY_AUDIT_MAX_RECORDS_V1 = 2_048;

const DEFAULT_OPERATION_TIMEOUT_MS = 2_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EVENT_KINDS = new Set<SecurityAuditEventKindV1>([
	'grant-requested',
	'grant-approved',
	'grant-denied',
	'grant-suspended',
	'grant-revoked',
	'preview-admitted',
	'consent-approved',
	'consent-denied',
	'apply-dispatched',
	'apply-completed',
	'recovery-dispatched',
	'recovery-completed',
	'audit-cleared',
]);
const CHANNELS = new Set<SecurityAuditChannelV1>(['cli', 'developer-api']);
const CONSENT_STATES = new Set<SecurityAuditConsentStateV1>([
	'not-required',
	'pending',
	'approved',
	'denied',
]);
const ADMISSION_STATES = new Set<SecurityAuditAdmissionStateV1>([
	'requested',
	'admitted',
	'refused',
	'dispatched',
	'completed',
]);
const OUTCOMES = new Set<SecurityAuditOutcomeV1>([
	'pending',
	'succeeded',
	'refused',
	'failed',
	'outcome-unknown',
]);
const MUTATION_KINDS = new Set<string>([...MUTATION_KINDS_V1, 'task.adopt']);
const RISKS = new Set<RiskLevelV1>([
	'none',
	'routine',
	'elevated',
	'destructive',
]);
const EVENT_KEYS = [
	'contractVersion',
	'eventId',
	'event',
	'channel',
	'consumerIdentityHash',
	'grantRevision',
	'capability',
	'mutationKind',
	'risk',
	'planDigest',
	'targetDigest',
	'vaultIdentityHash',
	'consent',
	'admission',
	'outcome',
	'errorCode',
	'occurredAt',
	'correlationHash',
] as const;

export type SecurityAuditEventKindV1 =
	| 'grant-requested'
	| 'grant-approved'
	| 'grant-denied'
	| 'grant-suspended'
	| 'grant-revoked'
	| 'preview-admitted'
	| 'consent-approved'
	| 'consent-denied'
	| 'apply-dispatched'
	| 'apply-completed'
	| 'recovery-dispatched'
	| 'recovery-completed'
	| 'audit-cleared';

export type SecurityAuditChannelV1 = 'cli' | 'developer-api';
export type SecurityAuditConsentStateV1 =
	| 'not-required'
	| 'pending'
	| 'approved'
	| 'denied';
export type SecurityAuditAdmissionStateV1 =
	| 'requested'
	| 'admitted'
	| 'refused'
	| 'dispatched'
	| 'completed';
export type SecurityAuditOutcomeV1 =
	| 'pending'
	| 'succeeded'
	| 'refused'
	| 'failed'
	| 'outcome-unknown';

/**
 * Redacted, metadata-only security record. Nullable fields are intentional:
 * every durable record has one closed shape, which prevents arbitrary payloads
 * or source content from being smuggled into the audit store.
 */
export interface SecurityAuditEventV1 {
	contractVersion: 1;
	eventId: string;
	event: SecurityAuditEventKindV1;
	channel: SecurityAuditChannelV1;
	consumerIdentityHash: string;
	grantRevision: number;
	capability: string | null;
	mutationKind: MutationKindV1 | 'task.adopt' | null;
	risk: RiskLevelV1 | null;
	planDigest: string | null;
	targetDigest: string | null;
	vaultIdentityHash: string | null;
	consent: SecurityAuditConsentStateV1;
	admission: SecurityAuditAdmissionStateV1;
	outcome: SecurityAuditOutcomeV1;
	errorCode: string | null;
	occurredAt: string;
	correlationHash: string;
}

export interface SecurityAuditPruneResultV1 {
	expiredDeleted: number;
	overflowDeleted: number;
	retained: number;
}

export interface IncompleteDeveloperGrantAuditTransitionV1 {
	readonly vaultIdentityHash: string | null;
	readonly consumerIdentityHash: string;
	readonly revision: number;
}

export interface IndexedDbSecurityAuditStoreOptionsV1 {
	indexedDBFactory?: IDBFactory | null;
	now?: () => number;
	databaseName?: string;
	operationTimeoutMs?: number;
}

export interface StoredSecurityAuditEventV1 {
	key: string;
	occurredAtMs: number;
	expiresAtMs: number;
	event: SecurityAuditEventV1;
}

export class SecurityAuditStoreErrorV1 extends Error {
	constructor(
		public readonly code:
			| 'audit-store-unavailable'
			| 'audit-store-unhealthy'
			| 'audit-store-closed'
			| 'audit-store-invalid-event'
			| 'audit-store-corrupt',
		message: string,
	) {
		super(message);
		this.name = 'SecurityAuditStoreErrorV1';
	}
}

export class IndexedDbSecurityAuditStoreV1 {
	private readonly indexedDBFactory: IDBFactory | null;
	private readonly now: () => number;
	private readonly databaseName: string;
	private readonly operationTimeoutMs: number;
	private databasePromise: Promise<IDBDatabase> | null = null;
	private database: IDBDatabase | null = null;
	private closed = false;

	constructor(options: IndexedDbSecurityAuditStoreOptionsV1 = {}) {
		this.indexedDBFactory = options.indexedDBFactory === undefined
			? (typeof indexedDB === 'undefined' ? null : indexedDB)
			: options.indexedDBFactory;
		this.now = options.now ?? (() => Date.now());
		this.databaseName = options.databaseName?.trim()
			|| AGENT_RUNTIME_DEFAULT_DATABASE_NAME_V1;
		this.operationTimeoutMs = normalizeTimeout(options.operationTimeoutMs);
	}

	async health(): Promise<boolean> {
		try {
			const database = await this.requireDatabase();
			const transaction = database.transaction(
				SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
				'readonly',
			);
			const completion = transactionCompletion(transaction);
				const records = await this.withOperationTimeout(
					requestResult(
						transaction.objectStore(
							SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
						).getAll() as IDBRequest<StoredSecurityAuditEventV1[]>,
					),
				transaction,
			);
			planSecurityAuditPruneV1(records, this.now());
			await this.withOperationTimeout(completion, transaction);
			return true;
		} catch {
			this.closeDatabase();
			return false;
		}
	}

	async append(event: SecurityAuditEventV1): Promise<SecurityAuditPruneResultV1> {
		assertValidSecurityAuditEventV1(event);
		const database = await this.requireDatabase();
	const stored = createStoredSecurityAuditEventV1(event);
		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(
				SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1);
			const records = await this.withOperationTimeout(
				requestResult(store.getAll() as IDBRequest<StoredSecurityAuditEventV1[]>),
				transaction,
			);
			if (records.some(record => record.key === stored.key)) {
				throw new SecurityAuditStoreErrorV1(
					'audit-store-invalid-event',
					'The audit event ID has already been used.',
				);
			}
			const allRecords = [...records, stored];
			const prune = planSecurityAuditPruneV1(allRecords, this.now());
			const put = store.put(stored);
			const deletes = prune.keysToDelete.map(key => requestResult(store.delete(key)));
			await this.withOperationTimeout(
				Promise.all([requestResult(put), ...deletes, completion]),
				transaction,
			);
			return prune.result;
		} catch (error) {
			if (transaction) safeAbort(transaction);
			this.rethrow(error);
		}
	}

	async list(): Promise<readonly SecurityAuditEventV1[]> {
		const database = await this.requireDatabase();
		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(
				SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1);
			const records = await this.withOperationTimeout(
				requestResult(store.getAll() as IDBRequest<StoredSecurityAuditEventV1[]>),
				transaction,
			);
			const prune = planSecurityAuditPruneV1(records, this.now());
			const deletes = prune.keysToDelete.map(key => requestResult(store.delete(key)));
			await this.withOperationTimeout(
				Promise.all([...deletes, completion]),
				transaction,
			);
			const deleted = new Set(prune.keysToDelete);
			return records
				.filter(record => !deleted.has(record.key))
				.sort(compareStoredEventsNewestFirst)
				.map(record => structuredClone(record.event));
		} catch (error) {
			if (transaction) safeAbort(transaction);
			this.rethrow(error);
		}
	}

	async clear(marker: SecurityAuditEventV1): Promise<void> {
		assertValidSecurityAuditEventV1(marker);
		if (marker.event !== 'audit-cleared') {
			throw new SecurityAuditStoreErrorV1(
				'audit-store-invalid-event',
				'Clearing the audit log requires an audit-cleared marker.',
			);
		}
		const database = await this.requireDatabase();
		let transaction: IDBTransaction | null = null;
		try {
			transaction = database.transaction(
				SECURITY_AUDIT_OBJECT_STORE_NAME_V1,
				'readwrite',
			);
			const completion = transactionCompletion(transaction);
			const store = transaction.objectStore(SECURITY_AUDIT_OBJECT_STORE_NAME_V1);
			const records = await this.withOperationTimeout(
				requestResult(store.getAll() as IDBRequest<StoredSecurityAuditEventV1[]>),
				transaction,
			);
			const protectedIntentKeys = incompleteDeveloperGrantIntentEventIdsV1(
				records.map(record => record.event),
			);
			if (records.some(record => record.key === marker.eventId)) {
				throw new SecurityAuditStoreErrorV1(
					'audit-store-invalid-event',
					'The audit event ID has already been used.',
				);
			}
			if (protectedIntentKeys.size + 1 > SECURITY_AUDIT_MAX_RECORDS_V1) {
				throw new SecurityAuditStoreErrorV1(
					'audit-store-unhealthy',
					'Incomplete grant recovery evidence reached the audit retention limit.',
				);
			}
			const deletes = records
				.filter(record => !protectedIntentKeys.has(record.key))
				.map(record => requestResult(store.delete(record.key)));
			await this.withOperationTimeout(
				Promise.all([
					...deletes,
					requestResult(store.put(createStoredSecurityAuditEventV1(marker))),
					completion,
				]),
				transaction,
			);
		} catch (error) {
			if (transaction) safeAbort(transaction);
			this.rethrow(error);
		}
	}

	close(): void {
		this.closed = true;
		this.closeDatabase();
	}

	private async requireDatabase(): Promise<IDBDatabase> {
		if (this.closed) {
			throw new SecurityAuditStoreErrorV1(
				'audit-store-closed',
				'The security audit store has been closed.',
			);
		}
		if (!this.indexedDBFactory) {
			throw new SecurityAuditStoreErrorV1(
				'audit-store-unavailable',
				'IndexedDB is unavailable, so write admission must fail closed.',
			);
		}
		if (this.database) return this.database;
		if (this.databasePromise) return await this.databasePromise;

		let acceptLateOpen = true;
		this.databasePromise = this.withOperationTimeout(new Promise<IDBDatabase>((resolve, reject) => {
			const request = this.indexedDBFactory?.open(
				this.databaseName,
				AGENT_RUNTIME_DATABASE_VERSION_V1,
			);
			if (!request) {
				reject(new Error('IndexedDB factory did not return an open request.'));
				return;
			}
			request.onupgradeneeded = () => ensureAgentRuntimeObjectStoresV1(request.result);
			request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
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
			if (!hasAgentRuntimeObjectStoresV1(database)) {
				database.close();
				throw new SecurityAuditStoreErrorV1(
					'audit-store-unhealthy',
					'The agent Runtime IndexedDB schema is incomplete.',
				);
			}
			database.onversionchange = () => {
				database.close();
				if (this.database === database) this.database = null;
				this.databasePromise = null;
			};
			this.database = database;
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
			timeoutError: () => new Error('Security audit store operation timed out.'),
		});
	}

	private rethrow(error: unknown): never {
		if (error instanceof SecurityAuditStoreErrorV1) throw error;
		this.closeDatabase();
		throw new SecurityAuditStoreErrorV1(
			'audit-store-unhealthy',
			`The security audit store operation failed: ${errorMessage(error)}.`,
		);
	}

	private closeDatabase(): void {
		this.database?.close();
		this.database = null;
		this.databasePromise = null;
	}
}

export function assertValidSecurityAuditEventV1(
	value: SecurityAuditEventV1,
): asserts value is SecurityAuditEventV1 {
	if (
		!isPlainObject(value)
		|| !hasExactKeys(value, EVENT_KEYS)
		|| value.contractVersion !== 1
		|| !SHA256_PATTERN.test(value.eventId)
		|| !EVENT_KINDS.has(value.event)
		|| !CHANNELS.has(value.channel)
		|| !SHA256_PATTERN.test(value.consumerIdentityHash)
		|| !Number.isSafeInteger(value.grantRevision)
		|| value.grantRevision < 0
		|| !isNullablePattern(value.capability, CAPABILITY_PATTERN)
		|| !isNullableSetMember(value.mutationKind, MUTATION_KINDS)
		|| !isNullableSetMember(value.risk, RISKS)
		|| !isNullableDigest(value.planDigest)
		|| !isNullableDigest(value.targetDigest)
		|| !isNullableDigest(value.vaultIdentityHash)
		|| !CONSENT_STATES.has(value.consent)
		|| !ADMISSION_STATES.has(value.admission)
		|| !OUTCOMES.has(value.outcome)
		|| !isNullablePattern(value.errorCode, ERROR_CODE_PATTERN)
		|| !isCanonicalIso(value.occurredAt)
		|| !SHA256_PATTERN.test(value.correlationHash)
	) {
		throw new SecurityAuditStoreErrorV1(
			'audit-store-invalid-event',
			'Security audit events must match the closed metadata-only V1 shape.',
		);
	}
}

export function planSecurityAuditPruneV1(
	records: readonly StoredSecurityAuditEventV1[],
	now: number,
): {
	keysToDelete: string[];
	result: SecurityAuditPruneResultV1;
} {
	const seen = new Set<string>();
	for (const record of records) {
		if (!isStoredEventValid(record) || seen.has(record.key)) {
			throw new SecurityAuditStoreErrorV1(
				'audit-store-corrupt',
				'The security audit store contains invalid metadata.',
			);
		}
		seen.add(record.key);
	}
	const protectedIntentKeys = incompleteDeveloperGrantIntentEventIdsV1(
		records.map(record => record.event),
	);
	if (protectedIntentKeys.size > SECURITY_AUDIT_MAX_RECORDS_V1) {
		throw new SecurityAuditStoreErrorV1(
			'audit-store-unhealthy',
			'Incomplete grant recovery evidence reached the audit retention limit.',
		);
	}
	const expired = records.filter(record => (
		record.expiresAtMs <= now && !protectedIntentKeys.has(record.key)
	));
	const live = records
		.filter(record => record.expiresAtMs > now || protectedIntentKeys.has(record.key))
		.sort(compareStoredEventsNewestFirst);
	const correlationPhases = new Map<string, {
		intent: boolean;
		completion: boolean;
		occurredAtMs: number;
		sameTime: boolean;
	}>();
	for (const record of live) {
		const correlationKey = developerGrantCorrelationKey(record);
		if (!correlationKey) continue;
		const phases = correlationPhases.get(correlationKey) ?? {
			intent: false,
			completion: false,
			occurredAtMs: record.occurredAtMs,
			sameTime: true,
		};
		if (grantAuditRetentionPriority(record.event) === 1) phases.intent = true;
		if (record.event.admission === 'completed') phases.completion = true;
		if (phases.occurredAtMs !== record.occurredAtMs) phases.sameTime = false;
		correlationPhases.set(correlationKey, phases);
	}
	const grantGroups = new Map<string, StoredSecurityAuditEventV1[]>();
	for (const record of live) {
		const correlationKey = developerGrantCorrelationKey(record);
		const phases = correlationKey ? correlationPhases.get(correlationKey) : undefined;
		const groupKey = protectedIntentKeys.has(record.key)
			? `recovery\0${record.key}`
			: correlationKey && phases?.intent && phases.completion && phases.sameTime
				? correlationKey
				: `event\0${record.key}`;
		const group = grantGroups.get(groupKey) ?? [];
		group.push(record);
		grantGroups.set(groupKey, group);
	}
	const orderedGroups = [...grantGroups.entries()]
		.map(([key, groupRecords]) => ({ key, records: groupRecords }))
		.sort((left, right) => (
			Number(right.records.some(record => protectedIntentKeys.has(record.key)))
			- Number(left.records.some(record => protectedIntentKeys.has(record.key)))
			|| Math.max(...right.records.map(record => record.occurredAtMs))
			- Math.max(...left.records.map(record => record.occurredAtMs))
			|| developerGrantGroupPriority(right.records) - developerGrantGroupPriority(left.records)
			|| compareStoredEventsNewestFirst(left.records[0], right.records[0])
		));
	const retainedKeys = new Set<string>();
	let retained = 0;
	for (const group of orderedGroups.map(entry => entry.records)) {
		if (retained + group.length > SECURITY_AUDIT_MAX_RECORDS_V1) continue;
		for (const member of group) retainedKeys.add(member.key);
		retained += group.length;
	}
	const overflow = live.filter(record => !retainedKeys.has(record.key));
	return {
		keysToDelete: [...expired, ...overflow].map(record => record.key),
		result: {
			expiredDeleted: expired.length,
			overflowDeleted: overflow.length,
			retained,
		},
	};
}

export function findIncompleteDeveloperGrantAuditTransitionsV1(
	events: readonly SecurityAuditEventV1[],
): readonly IncompleteDeveloperGrantAuditTransitionV1[] {
	const incompleteIntentIds = incompleteDeveloperGrantIntentEventIdsV1(events);
	const unique = new Map<string, IncompleteDeveloperGrantAuditTransitionV1>();
	for (const event of events) {
		if (!incompleteIntentIds.has(event.eventId)) continue;
		const transition = {
			vaultIdentityHash: event.vaultIdentityHash,
			consumerIdentityHash: event.consumerIdentityHash,
			revision: event.grantRevision,
		};
		const key = `${transition.vaultIdentityHash ?? ''}\0${transition.consumerIdentityHash}\0${transition.revision}`;
		unique.set(key, transition);
	}
	return [...unique.values()].sort((left, right) => (
		(left.vaultIdentityHash ?? '').localeCompare(right.vaultIdentityHash ?? '')
		|| left.consumerIdentityHash.localeCompare(right.consumerIdentityHash)
		|| left.revision - right.revision
	));
}

export function findIncompleteDeveloperGrantAuditTransitionsForVaultV1(
	events: readonly SecurityAuditEventV1[],
	vaultIdentityHash: string,
): readonly IncompleteDeveloperGrantAuditTransitionV1[] {
	if (!SHA256_PATTERN.test(vaultIdentityHash)) {
		throw new SecurityAuditStoreErrorV1(
			'audit-store-invalid-event',
			'Startup grant reconciliation requires an exact vault identity.',
		);
	}
	return findIncompleteDeveloperGrantAuditTransitionsV1(events).filter(transition => (
		transition.vaultIdentityHash === vaultIdentityHash
	));
}

function incompleteDeveloperGrantIntentEventIdsV1(
	events: readonly SecurityAuditEventV1[],
): ReadonlySet<string> {
	const transitions = new Map<string, Map<number, {
		intents: Array<{ eventId: string; correlationHash: string }>;
		completions: string[];
	}>>();
	for (const event of events) {
		if (
			event.channel !== 'developer-api'
			|| !event.event.startsWith('grant-')
			|| event.grantRevision < 1
		) continue;
		const key = [
			event.vaultIdentityHash ?? '',
			event.event,
			event.consumerIdentityHash,
			event.grantRevision,
			event.capability ?? '',
		].join('\0');
		const occurredAtMs = Date.parse(event.occurredAt);
		const byTime = transitions.get(key) ?? new Map<number, {
			intents: Array<{ eventId: string; correlationHash: string }>;
			completions: string[];
		}>();
		const atTime = byTime.get(occurredAtMs) ?? { intents: [], completions: [] };
		if (event.admission === 'requested' && event.outcome === 'pending') {
			atTime.intents.push({ eventId: event.eventId, correlationHash: event.correlationHash });
		} else if (event.admission === 'completed') {
			atTime.completions.push(event.correlationHash);
		}
		byTime.set(occurredAtMs, atTime);
		transitions.set(key, byTime);
	}
	const incompleteIntentIds = new Set<string>();
	for (const byTime of transitions.values()) {
		const pending: Array<{ eventId: string; correlationHash: string }> = [];
		for (const occurredAtMs of [...byTime.keys()].sort((left, right) => left - right)) {
			const atTime = byTime.get(occurredAtMs)!;
			pending.push(...atTime.intents.sort((left, right) => left.eventId.localeCompare(right.eventId)));
			for (const correlationHash of atTime.completions.sort((left, right) => left.localeCompare(right))) {
				const exactIndex = pending.findIndex(intent => intent.correlationHash === correlationHash);
				if (exactIndex >= 0) pending.splice(exactIndex, 1);
				else if (pending.length > 0) pending.shift();
			}
		}
		for (const intent of pending) incompleteIntentIds.add(intent.eventId);
	}
	return incompleteIntentIds;
}

export function createStoredSecurityAuditEventV1(
	event: SecurityAuditEventV1,
): StoredSecurityAuditEventV1 {
	const occurredAtMs = Date.parse(event.occurredAt);
	return {
		key: event.eventId,
		occurredAtMs,
		expiresAtMs: occurredAtMs + SECURITY_AUDIT_RETENTION_MS_V1,
		event: structuredClone(event),
	};
}

function isStoredEventValid(value: unknown): value is StoredSecurityAuditEventV1 {
	if (
		!isPlainObject(value)
		|| !hasExactKeys(value, ['key', 'occurredAtMs', 'expiresAtMs', 'event'])
		|| typeof value.key !== 'string'
		|| !SHA256_PATTERN.test(value.key)
		|| typeof value.occurredAtMs !== 'number'
		|| !Number.isSafeInteger(value.occurredAtMs)
		|| typeof value.expiresAtMs !== 'number'
		|| !Number.isSafeInteger(value.expiresAtMs)
		|| value.expiresAtMs !== value.occurredAtMs + SECURITY_AUDIT_RETENTION_MS_V1
		|| !isPlainObject(value.event)
	) return false;
	try {
		const event = value.event as unknown as SecurityAuditEventV1;
		assertValidSecurityAuditEventV1(event);
		return value.key === event.eventId
			&& value.occurredAtMs === Date.parse(event.occurredAt);
	} catch {
		return false;
	}
}

function compareStoredEventsNewestFirst(
	left: StoredSecurityAuditEventV1,
	right: StoredSecurityAuditEventV1,
): number {
	return right.occurredAtMs - left.occurredAtMs
		|| grantAuditRetentionPriority(right.event) - grantAuditRetentionPriority(left.event)
		|| right.key.localeCompare(left.key);
}

function grantAuditRetentionPriority(event: SecurityAuditEventV1): number {
	return event.channel === 'developer-api'
		&& event.event.startsWith('grant-')
		&& event.admission === 'requested'
		&& event.outcome === 'pending'
		? 1
		: 0;
}

function developerGrantCorrelationKey(record: StoredSecurityAuditEventV1): string | null {
	const event = record.event;
	// Current grant phases share one host-minted correlation. One-phase buckets,
	// including legacy phase-specific hashes, stay per-record and fail closed by intent priority.
	return event.channel === 'developer-api' && event.event.startsWith('grant-')
		? `grant\0${event.vaultIdentityHash ?? ''}\0${event.correlationHash}`
		: null;
}

function developerGrantGroupPriority(records: readonly StoredSecurityAuditEventV1[]): number {
	const intents = records.filter(record => grantAuditRetentionPriority(record.event) === 1).length;
	const completions = records.filter(record => record.event.admission === 'completed').length;
	return intents > completions ? 2 : intents > 0 || completions > 0 ? 1 : 0;
}

function isCanonicalIso(value: unknown): value is string {
	if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) return false;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNullableDigest(value: unknown): value is string | null {
	return value === null || (typeof value === 'string' && SHA256_PATTERN.test(value));
}

function isNullablePattern(value: unknown, pattern: RegExp): value is string | null {
	return value === null || (typeof value === 'string' && pattern.test(value));
}

function isNullableSetMember<T>(value: unknown, values: ReadonlySet<T>): value is T | null {
	return value === null || values.has(value as T);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length
		&& actual.every((key, index) => key === wanted[index]);
}

function normalizeTimeout(value: number | undefined): number {
	return normalizeIndexedDbTimeoutV1(value, DEFAULT_OPERATION_TIMEOUT_MS);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
