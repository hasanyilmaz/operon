import assert from 'node:assert/strict';
import test from 'node:test';
import {
	indexedDbRequestResultV1,
	indexedDbTransactionCompletionV1,
	safeAbortIndexedDbTransactionV1,
} from '../../../src/agent-runtime/internal/indexeddb-primitives';
import {
	RECOVERY_MAX_RECORDS_V1,
	RECOVERY_RETENTION_MS_V1,
} from '../../../src/agent-runtime/internal/recovery-policy';
import { planExpiringRecordRetentionV1 } from '../../../src/agent-runtime/internal/retention';
import {
	ensureAgentRuntimeObjectStoresV1,
	hasAgentRuntimeObjectStoresV1,
} from '../../../src/agent-runtime/runtime/receipts/indexeddb-schema';

test('shared recovery policy remains fixed at 24 hours and 256 records', () => {
	assert.equal(RECOVERY_RETENTION_MS_V1, 24 * 60 * 60 * 1_000);
	assert.equal(RECOVERY_MAX_RECORDS_V1, 256);
});

test('shared retention planner deletes expired records before deterministic overflow', () => {
	const plan = planExpiringRecordRetentionV1({
		records: [
			{ key: 'expired', expiresAt: 10, order: 99 },
			{ key: 'older', expiresAt: 20, order: 1 },
			{ key: 'newer', expiresAt: 20, order: 2 },
		],
		now: 10,
		maximumRecords: 1,
		key: record => record.key,
		expiresAt: record => record.expiresAt,
		compareNewestFirst: (left, right) => right.order - left.order,
	});
	assert.deepEqual(plan, {
		keysToDelete: ['expired', 'older'],
		expiredDeleted: 1,
		overflowDeleted: 1,
		retained: 1,
	});
});

test('shared IndexedDB request and transaction helpers preserve errors and safe aborts', async () => {
	const request = {
		error: new Error('request-failed'),
		onsuccess: null,
		onerror: null,
	} as unknown as IDBRequest<string>;
	const requestPromise = indexedDbRequestResultV1(request);
	request.onerror?.call(request, new Event('error'));
	await assert.rejects(requestPromise, /request-failed/u);

	let aborts = 0;
	const transaction = {
		error: new Error('transaction-aborted'),
		oncomplete: null,
		onabort: null,
		onerror: null,
		abort: () => { aborts += 1; },
	} as unknown as IDBTransaction;
	const completion = indexedDbTransactionCompletionV1(transaction);
	transaction.onabort?.call(transaction, new Event('abort'));
	await assert.rejects(completion, /transaction-aborted/u);
	safeAbortIndexedDbTransactionV1(transaction);
	assert.equal(aborts, 1);
});

test('transaction completion is handled before callers await it', async () => {
	let unhandled = 0;
	const onUnhandled = (): void => {
		unhandled += 1;
	};
	process.on('unhandledRejection', onUnhandled);
	try {
		const transaction = {
			error: new Error('early-transaction-abort'),
			oncomplete: null,
			onabort: null,
			onerror: null,
		} as unknown as IDBTransaction;
		const completion = indexedDbTransactionCompletionV1(transaction);
		transaction.onabort?.call(transaction, new Event('abort'));
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(unhandled, 0);
		await assert.rejects(completion, /early-transaction-abort/u);
	} finally {
		process.off('unhandledRejection', onUnhandled);
	}
});

test('shared Agent Runtime schema initializer creates every store and one generation record', () => {
	const names = new Set<string>();
	const keyPaths = new Map<string, string>();
	const metadata: unknown[] = [];
	const database = {
		version: 4,
		objectStoreNames: {
			contains: (name: string) => names.has(name),
		},
		createObjectStore: (name: string, options?: IDBObjectStoreParameters) => {
			names.add(name);
			keyPaths.set(name, String(options?.keyPath ?? ''));
			return { put: (value: unknown) => metadata.push(value) };
		},
		transaction: (storeNames: string[]) => ({
			objectStore: (name: string) => {
				if (!storeNames.includes(name)) throw new Error('Store is outside the transaction.');
				return { keyPath: keyPaths.get(name) };
			},
		}),
	} as unknown as IDBDatabase;
	ensureAgentRuntimeObjectStoresV1(database);
	assert.equal(hasAgentRuntimeObjectStoresV1(database), true);
	assert.equal(metadata.length, 1);
	assert.match(
		(metadata[0] as { databaseEpoch: string }).databaseEpoch,
		/^[a-f0-9]{32}$/u,
	);
	ensureAgentRuntimeObjectStoresV1(database);
	assert.equal(metadata.length, 1);
});

test('shared Agent Runtime schema rejects a wrong keyPath in every store', () => {
	const storeNames = [
		'receipts',
		'graph-transaction-journals',
		'receipt-metadata',
		'security-audit-events',
	];
	for (const wrongStore of storeNames) {
		const database = {
			version: 4,
			objectStoreNames: {
				contains: (name: string) => storeNames.includes(name),
			},
			transaction: () => ({
				objectStore: (name: string) => ({
					keyPath: name === wrongStore ? 'wrong-key' : 'key',
				}),
			}),
		} as unknown as IDBDatabase;
		assert.equal(
			hasAgentRuntimeObjectStoresV1(database),
			false,
			`${wrongStore} accepted the wrong keyPath`,
		);
	}
});
