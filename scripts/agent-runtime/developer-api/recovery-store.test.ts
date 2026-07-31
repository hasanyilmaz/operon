import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
	type SealedMutationPlanV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	DEVELOPER_RECOVERY_MAX_RECORDS_V1,
	DEVELOPER_RECOVERY_RETENTION_MS_V1,
	DeveloperMutationRecoveryStoreErrorV1,
	IndexedDbDeveloperMutationRecoveryStoreV1,
	type DeveloperMutationRecoveryRecordV1,
} from '../../../src/agent-runtime/developer-api';

if (typeof window === 'undefined') {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: globalThis,
	});
}

const BASE_TIME = Date.parse('2026-07-29T10:00:00.000Z');

test('production recovery store persists, isolates, lists, and retains terminal tombstones', async () => {
	await Promise.resolve();
	const factory = new FakeIndexedDbFactory();
	const store = createStore(factory);
	const record = recoveryRecord(1);
	await store.putPrepared(record);
	assert.equal(await store.get(record.consumerId, record.recoveryRef), undefined);
	await store.markDispatched(record.consumerId, record.recoveryRef);
	const dispatched = { ...record, state: 'dispatched' as const };

	assert.deepEqual(await store.get(record.consumerId, record.recoveryRef), dispatched);
	assert.equal(await store.get('another.consumer', record.recoveryRef), undefined);
	assert.deepEqual(await store.list(record.consumerId), [dispatched]);
	const restartedStore = createStore(factory);
	assert.deepEqual(
		await restartedStore.get(record.consumerId, record.recoveryRef),
		dispatched,
	);
	assert.deepEqual(await restartedStore.list(record.consumerId), [dispatched]);

	await store.markTerminal(record.consumerId, record.recoveryRef);
	assert.deepEqual(await store.list(record.consumerId), []);
	assert.equal(
		(await store.get(record.consumerId, record.recoveryRef))?.state,
		'terminal',
	);

	await store.delete('another.consumer', record.recoveryRef);
	assert.notEqual(await store.get(record.consumerId, record.recoveryRef), undefined);
	await store.delete(record.consumerId, record.recoveryRef);
	assert.equal(await store.get(record.consumerId, record.recoveryRef), undefined);

	const refused = recoveryRecord(2);
	await store.putPrepared(refused);
	await store.markDispatched(refused.consumerId, refused.recoveryRef);
	await store.markRefused(refused.consumerId, refused.recoveryRef);
	assert.equal(await store.get(refused.consumerId, refused.recoveryRef), undefined);
	assert.deepEqual(await store.list(refused.consumerId), []);
});

test('production recovery store prunes expired records and protects 256 live records', async () => {
	let now = BASE_TIME;
	const factory = new FakeIndexedDbFactory();
	const store = createStore(factory, () => now);
	const expired = recoveryRecord(1, now);
	await store.putPrepared(expired);
	now += DEVELOPER_RECOVERY_RETENTION_MS_V1;
	assert.deepEqual(await store.list(expired.consumerId), []);
	assert.equal(factory.records.size, 0);

	for (let index = 0; index < DEVELOPER_RECOVERY_MAX_RECORDS_V1; index++) {
		await store.putPrepared(recoveryRecord(index + 10, now));
	}
	await assert.rejects(
		store.putPrepared(recoveryRecord(999, now)),
		(error: unknown) => (
			error instanceof DeveloperMutationRecoveryStoreErrorV1
			&& error.code === 'recovery-store-full'
		),
	);
	assert.equal(factory.records.size, DEVELOPER_RECOVERY_MAX_RECORDS_V1);
});

test('production recovery store fails closed on corrupt existing records', async () => {
	const factory = new FakeIndexedDbFactory();
	const corrupt = {
		...recoveryRecord(1),
		consumerId: 'forged.consumer',
	};
	factory.records.set(corrupt.recoveryRef, corrupt);
	const store = createStore(factory);
	await assert.rejects(
		store.putPrepared(recoveryRecord(2)),
		(error: unknown) => (
			error instanceof DeveloperMutationRecoveryStoreErrorV1
			&& error.code === 'recovery-store-corrupt'
		),
	);
});

test('production recovery store rejects an existing database with the wrong keyPath', async () => {
	const factory = new FakeIndexedDbFactory({ existingKeyPath: 'wrong-key' });
	const store = createStore(factory);
	await assert.rejects(
		store.list('consumer.test'),
		(error: unknown) => (
			error instanceof DeveloperMutationRecoveryStoreErrorV1
			&& error.code === 'recovery-store-corrupt'
		),
	);
	assert.equal(factory.databaseClosed, true);
});

test('production recovery store rejects blocked open and closes a late database', async () => {
	const factory = new FakeIndexedDbFactory({ blocked: true });
	const store = createStore(factory);
	await assert.rejects(
		store.list('consumer.test'),
		(error: unknown) => (
			error instanceof DeveloperMutationRecoveryStoreErrorV1
			&& error.code === 'recovery-store-unavailable'
		),
	);
	factory.releaseBlockedOpen();
	await Promise.resolve();
	assert.equal(factory.databaseClosed, true);
});

test('production recovery store times out a silent open, closes its late handle, and retries', async () => {
	const factory = new FakeIndexedDbFactory({ hangingOpenCount: 1 });
	const store = new IndexedDbDeveloperMutationRecoveryStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		databaseName: 'developer-recovery-open-timeout-test',
		now: () => BASE_TIME,
		operationTimeoutMs: 100,
	});
	await assert.rejects(
		store.list('consumer.test'),
		(error: unknown) => (
			error instanceof DeveloperMutationRecoveryStoreErrorV1
			&& error.code === 'recovery-store-unhealthy'
		),
	);
	factory.releaseHangingOpen();
	await Promise.resolve();
	assert.equal(factory.databaseClosed, true);
	assert.deepEqual(await store.list('consumer.test'), []);
	assert.equal(factory.openCount, 2);
});

test('production recovery store aborts and fails closed on operation timeout', async () => {
	const factory = new FakeIndexedDbFactory({ hangGetAll: true });
	const store = new IndexedDbDeveloperMutationRecoveryStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		databaseName: 'developer-recovery-timeout-test',
		now: () => BASE_TIME,
		operationTimeoutMs: 100,
	});
	await assert.rejects(
		store.list('consumer.test'),
		(error: unknown) => (
			error instanceof DeveloperMutationRecoveryStoreErrorV1
			&& error.code === 'recovery-store-unhealthy'
		),
	);
	assert.equal(factory.abortCount, 1);
});

function createStore(
	factory: FakeIndexedDbFactory,
	now: () => number = () => BASE_TIME,
): IndexedDbDeveloperMutationRecoveryStoreV1 {
	return new IndexedDbDeveloperMutationRecoveryStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		databaseName: 'developer-recovery-test',
		now,
		operationTimeoutMs: 1_000,
	});
}

function recoveryRecord(
	id: number,
	createdAtMs: number = BASE_TIME,
): DeveloperMutationRecoveryRecordV1 {
	const idempotencyKey = `developer-recovery-idempotency-${id}`;
	const plan = sealedPlan(id, createdAtMs, idempotencyKey);
	return {
		contractVersion: 1,
		recoveryRef: `dvr1_${id.toString(16).padStart(48, '0')}`,
		consumerId: 'consumer.test',
		planDigest: plan.planHash,
		sealed: plan,
		binding: {
			consumerId: 'consumer.test',
			instanceEpoch: 'instance-1',
			sessionId: 'session-1',
			grantRevision: 1,
			capability: plan.capability,
			planHash: plan.planHash,
			targetDigest: plan.receiptTargetDigest,
		},
		idempotencyKey,
		authorization: { basis: 'user-standing-instruction' },
		acknowledgements: [],
		state: 'prepared',
		createdAt: new Date(createdAtMs).toISOString(),
		expiresAt: new Date(
			createdAtMs + DEVELOPER_RECOVERY_RETENTION_MS_V1,
		).toISOString(),
	};
}

function sealedPlan(
	id: number,
	createdAtMs: number,
	idempotencyKey: string,
): SealedMutationPlanV1 {
	const plan: SealedMutationPlanV1 = {
		contractVersion: 1,
		planId: `developer-recovery-plan-${id}`,
		planHash: '',
		clientInstanceId: 'developer-api:consumer.test:instance-1',
		correlationId: `developer-recovery-correlation-${id}`,
		idempotencyKeyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
		receiptTargetDigest: '',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		createdAt: new Date(createdAtMs).toISOString(),
		expiresAt: new Date(createdAtMs + 60_000).toISOString(),
		targets: [{
			operonId: 'abc1234',
			locator: {
				representation: 'inline' as const,
				filePath: 'Tasks.md',
				lineNumber: 0,
			},
			targetDigest: createHash('sha256').update(`target-${id}`).digest('hex'),
		}],
		contextRevision: {
			index: {
				sessionId: 'developer-recovery',
				ramGeneration: 1,
				durable: { status: 'missing' as const },
			},
			settingsFingerprint: '5'.repeat(64),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: '6'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			revision: '8'.repeat(64),
		}],
		atomicGroups: [{
			groupId: 'task-source:Tasks.md',
			order: 0,
			resources: [{ resourceKind: 'task-source' as const, resourceKey: 'Tasks.md' }],
		}],
		predictedEffects: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			action: 'update' as const,
			summary: 'Update the exact task source.',
		}],
		riskLevel: 'routine' as const,
		requiresConfirmation: false,
		requiredAcknowledgements: [],
		warnings: [],
		spec: {
			operation: 'update' as const,
			changes: [{ field: 'description', valueType: 'text' as const, value: `Task ${id}` }],
		},
	};
	plan.receiptTargetDigest = computeReceiptTargetDigestV1(plan.targets);
	plan.planHash = computeSealedMutationPlanHashV1(plan);
	return plan;
}

interface FakeIndexedDbOptions {
	readonly existingKeyPath?: string;
	readonly blocked?: boolean;
	readonly hangGetAll?: boolean;
	readonly hangingOpenCount?: number;
}

class FakeIndexedDbFactory {
	readonly records = new Map<string, unknown>();
	readonly hangGetAll: boolean;
	databaseClosed = false;
	abortCount = 0;
	openCount = 0;
	private readonly blocked: boolean;
	private hangingOpenCount: number;
	private database: FakeDatabase | null = null;
	private blockedRequest: FakeOpenRequest | null = null;
	private hangingRequest: FakeOpenRequest | null = null;

	constructor(options: FakeIndexedDbOptions = {}) {
		this.blocked = options.blocked ?? false;
		this.hangingOpenCount = options.hangingOpenCount ?? 0;
		this.hangGetAll = options.hangGetAll ?? false;
		if (options.existingKeyPath !== undefined) {
			this.database = new FakeDatabase(this, options.existingKeyPath);
		}
	}

	open(_name: string, _version: number): IDBOpenDBRequest {
		this.openCount += 1;
		const request = new FakeOpenRequest();
		if (this.hangingOpenCount > 0) {
			this.hangingOpenCount -= 1;
			this.hangingRequest = request;
			return request as unknown as IDBOpenDBRequest;
		}
		if (this.blocked) {
			this.blockedRequest = request;
			queueMicrotask(() => request.onblocked?.call(
				request as unknown as IDBOpenDBRequest,
				new Event('blocked') as IDBVersionChangeEvent,
			));
			return request as unknown as IDBOpenDBRequest;
		}
		queueMicrotask(() => {
			const upgrade = this.database === null;
			this.database ??= new FakeDatabase(this);
			request.result = this.database as unknown as IDBDatabase;
			if (upgrade) {
				request.onupgradeneeded?.call(
					request as unknown as IDBOpenDBRequest,
					new Event('upgradeneeded') as IDBVersionChangeEvent,
				);
			}
			request.onsuccess?.call(
				request as unknown as IDBRequest<IDBDatabase>,
				new Event('success'),
			);
		});
		return request as unknown as IDBOpenDBRequest;
	}

	releaseHangingOpen(): void {
		if (!this.hangingRequest) throw new Error('No hanging open request.');
		this.database ??= new FakeDatabase(this);
		this.hangingRequest.result = this.database as unknown as IDBDatabase;
		this.hangingRequest.onupgradeneeded?.call(
			this.hangingRequest as unknown as IDBOpenDBRequest,
			new Event('upgradeneeded') as IDBVersionChangeEvent,
		);
		this.hangingRequest.onsuccess?.call(
			this.hangingRequest as unknown as IDBRequest<IDBDatabase>,
			new Event('success'),
		);
		this.hangingRequest = null;
	}

	releaseBlockedOpen(): void {
		if (!this.blockedRequest) throw new Error('No blocked open request.');
		this.database ??= new FakeDatabase(this);
		this.blockedRequest.result = this.database as unknown as IDBDatabase;
		this.blockedRequest.onsuccess?.call(
			this.blockedRequest as unknown as IDBRequest<IDBDatabase>,
			new Event('success'),
		);
	}
}

class FakeDatabase {
	readonly objectStoreNames = {
		contains: (name: string) => (
			name === 'pending-recoveries' && this.storeCreated
		),
	} as DOMStringList;
	private storeCreated: boolean;
	private keyPath: string;

	constructor(
		private readonly factory: FakeIndexedDbFactory,
		existingKeyPath?: string,
	) {
		this.storeCreated = existingKeyPath !== undefined;
		this.keyPath = existingKeyPath ?? 'recoveryRef';
	}

	createObjectStore(
		name: string,
		options?: IDBObjectStoreParameters,
	): IDBObjectStore {
		if (name !== 'pending-recoveries') throw new Error(`Unexpected store: ${name}`);
		this.storeCreated = true;
		this.keyPath = String(options?.keyPath ?? '');
		return new FakeObjectStore(
			new FakeTransaction(this.factory),
			this.keyPath,
		) as unknown as IDBObjectStore;
	}

	transaction(name: string): IDBTransaction {
		if (name !== 'pending-recoveries' || !this.storeCreated) {
			throw new Error('Recovery store is missing.');
		}
		return new FakeTransaction(this.factory, this.keyPath) as unknown as IDBTransaction;
	}

	close(): void {
		this.factory.databaseClosed = true;
	}
}

class FakeRequest<T> {
	result!: T;
	error: DOMException | null = null;
	onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
	onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
}

class FakeOpenRequest extends FakeRequest<IDBDatabase> {
	onupgradeneeded:
		| ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown)
		| null = null;
	onblocked:
		| ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown)
		| null = null;
}

class FakeTransaction {
	error: DOMException | null = null;
	oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
	onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
	onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
	private pending = 0;
	private completionScheduled = false;
	private finished = false;
	private aborted = false;

	constructor(
		private readonly factory: FakeIndexedDbFactory,
		private readonly keyPath: string = 'recoveryRef',
	) {}

	objectStore(name: string): IDBObjectStore {
		if (name !== 'pending-recoveries') throw new Error(`Unexpected store: ${name}`);
		return new FakeObjectStore(this, this.keyPath) as unknown as IDBObjectStore;
	}

	abort(): void {
		if (this.aborted || this.finished) return;
		this.factory.abortCount += 1;
		this.aborted = true;
		this.finished = true;
		queueMicrotask(() => this.onabort?.call(
			this as unknown as IDBTransaction,
			new Event('abort'),
		));
	}

	request<T>(operation: () => T): IDBRequest<T> {
		const request = new FakeRequest<T>();
		this.pending += 1;
		queueMicrotask(() => {
			if (this.aborted) return;
			try {
				request.result = operation();
				request.onsuccess?.call(
					request as unknown as IDBRequest<T>,
					new Event('success'),
				);
			} catch (error) {
				request.error = new DOMException(String(error), 'UnknownError');
				request.onerror?.call(
					request as unknown as IDBRequest<T>,
					new Event('error'),
				);
				this.abort();
			} finally {
				this.pending -= 1;
				this.scheduleCompletion();
			}
		});
		return request as unknown as IDBRequest<T>;
	}

	hangingRequest<T>(): IDBRequest<T> {
		this.pending += 1;
		return new FakeRequest<T>() as unknown as IDBRequest<T>;
	}

	private scheduleCompletion(): void {
		if (this.completionScheduled || this.finished || this.pending !== 0) return;
		this.completionScheduled = true;
		window.setTimeout(() => {
			this.completionScheduled = false;
			if (this.finished || this.pending !== 0) return;
			this.finished = true;
			this.oncomplete?.call(
				this as unknown as IDBTransaction,
				new Event('complete'),
			);
		}, 0);
	}
}

class FakeObjectStore {
	constructor(
		private readonly transaction: FakeTransaction,
		readonly keyPath: string,
	) {}

	get(key: IDBValidKey): IDBRequest<unknown> {
		return this.transaction.request(() => {
			const value = this.records.get(String(key));
			return value === undefined ? undefined : structuredClone(value);
		});
	}

	getAll(): IDBRequest<unknown[]> {
		if (this.factory.hangGetAll) return this.transaction.hangingRequest<unknown[]>();
		return this.transaction.request(() => (
			[...this.records.values()].map(value => structuredClone(value))
		));
	}

	put(value: Record<string, unknown>): IDBRequest<IDBValidKey> {
		return this.transaction.request(() => {
			const key = String(value[this.keyPath]);
			this.records.set(key, structuredClone(value));
			return key;
		});
	}

	delete(key: IDBValidKey): IDBRequest<undefined> {
		return this.transaction.request(() => {
			this.records.delete(String(key));
			return undefined;
		});
	}

	private get factory(): FakeIndexedDbFactory {
		return (
			this.transaction as unknown as { factory: FakeIndexedDbFactory }
		).factory;
	}

	private get records(): Map<string, unknown> {
		return this.factory.records;
	}
}
