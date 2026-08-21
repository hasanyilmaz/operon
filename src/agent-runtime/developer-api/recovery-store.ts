import type {
	MutationAcknowledgementV1,
	MutationAuthorizationV1,
} from '../contracts/v1/mutation';
import { decodeMutationApplyRequestV1 } from '../contracts/v1/decode';
import {
	decodeTaskWorkflowApplyRequestExtensionV1,
	type AdoptTaskSealedPlanV1,
	type PeriodicNoteCreateSealedPlanV1,
} from '../extensions/task-workflows-v1';
import {
	indexedDbRequestResultV1,
	indexedDbTransactionCompletionV1,
	safeAbortIndexedDbTransactionV1 as safeAbort,
	withIndexedDbOperationTimeoutV1,
} from '../internal/indexeddb-primitives';
import {
	RECOVERY_MAX_RECORDS_V1,
	RECOVERY_RETENTION_MS_V1,
} from '../internal/recovery-policy';
import type {
	DeveloperMutationSealedPlanV1,
	DeveloperPlanSecurityBindingV1,
} from './security';

export const DEVELOPER_RECOVERY_RETENTION_MS_V1 = RECOVERY_RETENTION_MS_V1;
export const DEVELOPER_RECOVERY_MAX_RECORDS_V1 = RECOVERY_MAX_RECORDS_V1;
export const DEVELOPER_RECOVERY_DATABASE_NAME_V1 =
	'operon-developer-api-recovery-v1';
export const DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1 = 'pending-recoveries';

export interface DeveloperMutationRecoveryRecordV1 {
	readonly contractVersion: 1;
	readonly recoveryRef: string;
	readonly consumerId: string;
	readonly planDigest: string;
	readonly sealed: DeveloperMutationSealedPlanV1;
	readonly binding: DeveloperPlanSecurityBindingV1;
	readonly idempotencyKey: string;
	readonly authorization: MutationAuthorizationV1;
	readonly acknowledgements: readonly MutationAcknowledgementV1[];
	readonly state: 'prepared' | 'dispatched' | 'terminal' | 'refused';
	readonly createdAt: string;
	readonly expiresAt: string;
}

export interface DeveloperMutationRecoveryStoreV1 {
	putPrepared(record: DeveloperMutationRecoveryRecordV1): Promise<void>;
	get(
		consumerId: string,
		recoveryRef: string,
	): Promise<DeveloperMutationRecoveryRecordV1 | undefined>;
	list(consumerId: string): Promise<readonly DeveloperMutationRecoveryRecordV1[]>;
	markDispatched(consumerId: string, recoveryRef: string): Promise<void>;
	markTerminal(consumerId: string, recoveryRef: string): Promise<void>;
	markRefused(consumerId: string, recoveryRef: string): Promise<void>;
	delete(consumerId: string, recoveryRef: string): Promise<void>;
}

export interface IndexedDbDeveloperMutationRecoveryStoreOptionsV1 {
	readonly indexedDBFactory?: IDBFactory | null;
	readonly databaseName?: string;
	readonly now?: () => number;
	readonly operationTimeoutMs?: number;
}

export class DeveloperMutationRecoveryStoreErrorV1 extends Error {
	constructor(
		public readonly code:
			| 'recovery-store-unavailable'
			| 'recovery-store-unhealthy'
			| 'recovery-store-full'
			| 'recovery-store-corrupt'
			| 'plan-expired',
		message: string,
	) {
		super(message);
		this.name = 'DeveloperMutationRecoveryStoreErrorV1';
	}
}

/**
 * Private Developer API continuation data. This uses a dedicated database so
 * sealed plans and host-owned credentials never enter the metadata-only audit
 * store or its migration/retention path.
 */
export class IndexedDbDeveloperMutationRecoveryStoreV1
implements DeveloperMutationRecoveryStoreV1 {
	private readonly indexedDBFactory: IDBFactory | null;
	private readonly databaseName: string;
	private readonly now: () => number;
	private readonly operationTimeoutMs: number;
	private databasePromise: Promise<IDBDatabase> | null = null;

	constructor(options: IndexedDbDeveloperMutationRecoveryStoreOptionsV1 = {}) {
		this.indexedDBFactory = options.indexedDBFactory === undefined
			? (typeof indexedDB === 'undefined' ? null : indexedDB)
			: options.indexedDBFactory;
		this.databaseName = options.databaseName?.trim()
			|| DEVELOPER_RECOVERY_DATABASE_NAME_V1;
		this.now = options.now ?? (() => Date.now());
		this.operationTimeoutMs = Math.max(100, options.operationTimeoutMs ?? 2_000);
	}

	async putPrepared(record: DeveloperMutationRecoveryRecordV1): Promise<void> {
		assertRecoveryRecord(record);
		if (record.state !== 'prepared') {
			throw new DeveloperMutationRecoveryStoreErrorV1(
				'recovery-store-corrupt',
				'New recovery records must begin in prepared state.',
			);
		}
		const database = await this.requireDatabase();
		const transaction = database.transaction(
			DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
			'readwrite',
		);
		const store = transaction.objectStore(DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1);
		try {
			const records = await this.withTimeout(
				requestResult(store.getAll() as IDBRequest<DeveloperMutationRecoveryRecordV1[]>),
				transaction,
			);
			for (const item of records) assertRecoveryRecord(item);
			const now = this.now();
			const expired = records.filter(item => Date.parse(item.expiresAt) <= now);
			for (const item of expired) store.delete(item.recoveryRef);
			const existing = records.find(item => item.recoveryRef === record.recoveryRef);
			const retainedCount = records.length - expired.length - (existing ? 1 : 0);
			if (!existing && retainedCount >= DEVELOPER_RECOVERY_MAX_RECORDS_V1) {
				transaction.abort();
				throw new DeveloperMutationRecoveryStoreErrorV1(
					'recovery-store-full',
					'The Developer API recovery store is full of protected records.',
				);
			}
			if (
				existing
				&& (
					existing.consumerId !== record.consumerId
					|| existing.planDigest !== record.planDigest
				)
			) {
				transaction.abort();
				throw new DeveloperMutationRecoveryStoreErrorV1(
					'recovery-store-corrupt',
					'The recovery reference is already bound to another plan.',
				);
			}
			store.put(cloneRecord(record));
			await this.withTimeout(transactionCompletion(transaction), transaction);
		} catch (error) {
			safeAbort(transaction);
			throw normalizeStoreError(error);
		}
	}

	async get(
		consumerId: string,
		recoveryRef: string,
	): Promise<DeveloperMutationRecoveryRecordV1 | undefined> {
		const record = await this.readRecord(recoveryRef);
		if (!record) return undefined;
		assertRecoveryRecord(record);
		if (record.consumerId !== consumerId) return undefined;
		if (Date.parse(record.expiresAt) <= this.now()) {
			await this.delete(consumerId, recoveryRef);
			throw new DeveloperMutationRecoveryStoreErrorV1(
				'plan-expired',
				'The Developer API recovery window has expired.',
			);
		}
		return record.state === 'dispatched' || record.state === 'terminal'
			? cloneRecord(record)
			: undefined;
	}

	async list(consumerId: string): Promise<readonly DeveloperMutationRecoveryRecordV1[]> {
		const database = await this.requireDatabase();
		const transaction = database.transaction(
			DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
			'readwrite',
		);
		const store = transaction.objectStore(DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1);
		try {
			const records = await this.withTimeout(
				requestResult(store.getAll() as IDBRequest<DeveloperMutationRecoveryRecordV1[]>),
				transaction,
			);
			const now = this.now();
			const result: DeveloperMutationRecoveryRecordV1[] = [];
			for (const record of records) {
				assertRecoveryRecord(record);
				if (Date.parse(record.expiresAt) <= now) {
					store.delete(record.recoveryRef);
					continue;
				}
				if (
					record.consumerId === consumerId
					&& record.state === 'dispatched'
				) result.push(cloneRecord(record));
			}
			await this.withTimeout(transactionCompletion(transaction), transaction);
			return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
		} catch (error) {
			safeAbort(transaction);
			throw normalizeStoreError(error);
		}
	}

	async markDispatched(consumerId: string, recoveryRef: string): Promise<void> {
		await this.markState(consumerId, recoveryRef, 'dispatched');
	}

	async markTerminal(consumerId: string, recoveryRef: string): Promise<void> {
		await this.markState(consumerId, recoveryRef, 'terminal');
	}

	async markRefused(consumerId: string, recoveryRef: string): Promise<void> {
		await this.markState(consumerId, recoveryRef, 'refused');
	}

	private async markState(
		consumerId: string,
		recoveryRef: string,
		state: DeveloperMutationRecoveryRecordV1['state'],
	): Promise<void> {
		const database = await this.requireDatabase();
		const transaction = database.transaction(
			DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
			'readwrite',
		);
		const store = transaction.objectStore(DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1);
		try {
			const record = await this.withTimeout(
				requestResult(store.get(recoveryRef) as IDBRequest<
					DeveloperMutationRecoveryRecordV1 | undefined
				>),
				transaction,
			);
			if (!record || record.consumerId !== consumerId) {
				transaction.abort();
				throw new DeveloperMutationRecoveryStoreErrorV1(
					'recovery-store-corrupt',
					'The recovery state transition target is unavailable.',
				);
			}
			assertRecoveryRecord(record);
			if (!isRecoveryStateTransitionAllowed(record.state, state)) {
				transaction.abort();
				throw new DeveloperMutationRecoveryStoreErrorV1(
					'recovery-store-corrupt',
					`Invalid recovery state transition: ${record.state} -> ${state}.`,
				);
			}
			store.put({ ...record, state });
			await this.withTimeout(transactionCompletion(transaction), transaction);
		} catch (error) {
			safeAbort(transaction);
			throw normalizeStoreError(error);
		}
	}

	async delete(consumerId: string, recoveryRef: string): Promise<void> {
		const database = await this.requireDatabase();
		const transaction = database.transaction(
			DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
			'readwrite',
		);
		const store = transaction.objectStore(DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1);
		try {
			const record = await this.withTimeout(
				requestResult(store.get(recoveryRef) as IDBRequest<
					DeveloperMutationRecoveryRecordV1 | undefined
				>),
				transaction,
			);
			if (record?.consumerId === consumerId) store.delete(recoveryRef);
			await this.withTimeout(transactionCompletion(transaction), transaction);
		} catch (error) {
			safeAbort(transaction);
			throw normalizeStoreError(error);
		}
	}

	private async readRecord(
		recoveryRef: string,
	): Promise<DeveloperMutationRecoveryRecordV1 | undefined> {
		const database = await this.requireDatabase();
		const transaction = database.transaction(
			DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
			'readonly',
		);
		try {
			const record = await this.withTimeout(
				requestResult(
					transaction.objectStore(DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1)
						.get(recoveryRef) as IDBRequest<DeveloperMutationRecoveryRecordV1 | undefined>,
				),
				transaction,
			);
			await this.withTimeout(transactionCompletion(transaction), transaction);
			return record;
		} catch (error) {
			throw normalizeStoreError(error);
		}
	}

	private requireDatabase(): Promise<IDBDatabase> {
		if (!this.indexedDBFactory) {
			return Promise.reject(new DeveloperMutationRecoveryStoreErrorV1(
				'recovery-store-unavailable',
				'IndexedDB is unavailable for Developer API recovery.',
			));
		}
		if (this.databasePromise) return this.databasePromise;
		let settled = false;
		const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
			let request: IDBOpenDBRequest;
			try {
				request = this.indexedDBFactory!.open(this.databaseName, 1);
			} catch (error) {
				reject(normalizeStoreError(error));
				return;
			}
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(
					DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
				)) {
					request.result.createObjectStore(
						DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
						{ keyPath: 'recoveryRef' },
					);
				}
			};
			request.onsuccess = () => {
				const database = request.result;
				if (settled) {
					database.close();
					return;
				}
				if (
					!database.objectStoreNames.contains(
						DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
					)
				) {
					database.close();
					settled = true;
					reject(new DeveloperMutationRecoveryStoreErrorV1(
						'recovery-store-corrupt',
						'The Developer API recovery object store is missing.',
					));
					return;
				}
				const transaction = database.transaction(
					DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
					'readonly',
				);
				if (
					transaction.objectStore(
						DEVELOPER_RECOVERY_OBJECT_STORE_NAME_V1,
					).keyPath !== 'recoveryRef'
				) {
					database.close();
					settled = true;
					reject(new DeveloperMutationRecoveryStoreErrorV1(
						'recovery-store-corrupt',
						'The Developer API recovery store has an invalid key path.',
					));
					return;
				}
				settled = true;
				resolve(database);
			};
			request.onerror = () => {
				if (settled) return;
				settled = true;
				reject(normalizeStoreError(request.error));
			};
			request.onblocked = () => {
				if (settled) return;
				settled = true;
				reject(new DeveloperMutationRecoveryStoreErrorV1(
					'recovery-store-unavailable',
					'The Developer API recovery database upgrade is blocked.',
				));
			};
		});
		this.databasePromise = withIndexedDbOperationTimeoutV1({
			promise: openPromise,
			timeoutMs: this.operationTimeoutMs,
			onTimeout: () => {
				settled = true;
			},
			timeoutError: () => new DeveloperMutationRecoveryStoreErrorV1(
				'recovery-store-unhealthy',
				'The Developer API recovery database open timed out.',
			),
		}).catch(error => {
			this.databasePromise = null;
			throw error;
		});
		return this.databasePromise;
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		transaction: IDBTransaction,
	): Promise<T> {
		return await withIndexedDbOperationTimeoutV1({
			promise,
			timeoutMs: this.operationTimeoutMs,
			transaction,
			timeoutError: () => new DeveloperMutationRecoveryStoreErrorV1(
				'recovery-store-unhealthy',
				'The Developer API recovery store operation timed out.',
			),
		});
	}
}

function isRecoveryStateTransitionAllowed(
	from: DeveloperMutationRecoveryRecordV1['state'],
	to: DeveloperMutationRecoveryRecordV1['state'],
): boolean {
	if (to === 'dispatched') return from === 'prepared' || from === 'dispatched';
	if (to === 'terminal') return from === 'prepared' || from === 'dispatched' || from === 'terminal';
	if (to === 'refused') return from === 'prepared' || from === 'dispatched' || from === 'refused';
	return false;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return indexedDbRequestResultV1(request, normalizeStoreError);
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
	return indexedDbTransactionCompletionV1(transaction, normalizeStoreError);
}

function normalizeStoreError(error: unknown): DeveloperMutationRecoveryStoreErrorV1 {
	if (error instanceof DeveloperMutationRecoveryStoreErrorV1) return error;
	return new DeveloperMutationRecoveryStoreErrorV1(
		'recovery-store-unhealthy',
		error instanceof Error
			? `The Developer API recovery store failed: ${error.message}`
			: 'The Developer API recovery store failed.',
	);
}

function cloneRecord(
	record: DeveloperMutationRecoveryRecordV1,
): DeveloperMutationRecoveryRecordV1 {
	return structuredClone(record);
}

function assertRecoveryRecord(record: DeveloperMutationRecoveryRecordV1): void {
	if (
		!record
		|| record.contractVersion !== 1
		|| !['prepared', 'dispatched', 'terminal', 'refused'].includes(record.state)
		|| !record.recoveryRef
		|| !/^dvr1_[0-9a-f]{48}$/u.test(record.recoveryRef)
		|| !record.consumerId
		|| record.planDigest !== record.sealed?.planHash
		|| record.binding.consumerId !== record.consumerId
		|| record.binding.planHash !== record.planDigest
		|| record.binding.targetDigest !== record.sealed.receiptTargetDigest
		|| !record.idempotencyKey
		|| !Number.isFinite(Date.parse(record.createdAt))
		|| !Number.isFinite(Date.parse(record.expiresAt))
		|| Date.parse(record.expiresAt) - Date.parse(record.createdAt)
			!== DEVELOPER_RECOVERY_RETENTION_MS_V1
	) {
		throw new DeveloperMutationRecoveryStoreErrorV1(
			'recovery-store-corrupt',
			'The Developer API recovery store contains an invalid record.',
		);
	}
	const decodedApply = isTaskWorkflowExtensionPlan(record.sealed)
		? decodeTaskWorkflowApplyRequestExtensionV1({
			contractVersion: 1,
			requestId: 'developer-recovery-validation',
			kind: 'mutation-apply',
			plan: record.sealed,
			authorization: record.authorization,
			idempotencyKey: record.idempotencyKey,
			acknowledgements: record.acknowledgements,
		})
		: decodeMutationApplyRequestV1({
			contractVersion: 1,
			requestId: 'developer-recovery-validation',
			kind: 'mutation-apply',
			plan: record.sealed,
			authorization: record.authorization,
			idempotencyKey: record.idempotencyKey,
			acknowledgements: record.acknowledgements,
		});
	if (
		!decodedApply.ok
		|| record.binding.instanceEpoch.length === 0
		|| record.binding.sessionId.length === 0
		|| !Number.isSafeInteger(record.binding.grantRevision)
		|| record.binding.grantRevision < 0
		|| record.binding.capability !== record.sealed.capability
	) {
		throw new DeveloperMutationRecoveryStoreErrorV1(
			'recovery-store-corrupt',
			'The Developer API recovery record failed canonical apply validation.',
		);
	}
}

function isTaskWorkflowExtensionPlan(
	plan: DeveloperMutationSealedPlanV1,
): plan is AdoptTaskSealedPlanV1 | PeriodicNoteCreateSealedPlanV1 {
	return (plan.mutationKind === 'task.adopt' && plan.capability === 'tasks.adopt.preview')
		|| (plan.mutationKind === 'task.create' && plan.capability === 'tasks.create.periodic-note.preview');
}
