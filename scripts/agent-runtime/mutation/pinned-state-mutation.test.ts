import assert from 'node:assert/strict';
import test from 'node:test';
import type { MutationPreviewRequestV1 } from '../../../src/agent-runtime/contracts/v1';
import {
	pinnedEntryRevisionV1,
	prepareRuntimePinnedStateMutationV1,
	type RuntimePinnedStateMutationPreparationV1,
} from '../../../src/agent-runtime/runtime/pinned-state-mutation';
import {
	createEmptyPinnedTasksPackage,
	type OperonPinnedTasksPackageV1,
} from '../../../src/storage/operon-data-package';
import {
	PinnedCache,
	type PinnedCacheEntrySnapshot,
} from '../../../src/storage/pinned-cache';

const locator = {
	representation: 'inline' as const,
	filePath: 'Tasks.md',
	lineNumber: 3,
};

function request(
	pinned: boolean,
	expected?: { pinned: boolean; revision: string },
): MutationPreviewRequestV1 {
	return {
		contractVersion: 1,
		requestId: 'pin-request',
		kind: 'mutation-preview',
		clientInstanceId: 'test',
		idempotencyKey: 'pin-idempotency',
		capability: 'tasks.pinned.preview',
		mutationKind: 'task.pinned-state',
		target: { operonId: 'abc1234', locator },
		spec: {
			operation: 'set-pinned',
			pinned,
			...(expected
				? {
					expectedPinned: expected.pinned,
					expectedEntryRevision: expected.revision,
				}
				: {}),
		},
		authorization: { basis: 'user-explicit-request' },
	};
}

test('pinned-state preparation seals the exact entry and one pinned resource', () => {
	const entry = { pinned: false, updatedAt: '2026-07-27T10:00:00.000Z' };
	const result = prepareRuntimePinnedStateMutationV1(request(true), '2026-07-27T11:00:00.000Z', {
		getTask: () => ({ operonId: 'abc1234', locator, duplicate: false }),
		getPinnedEntry: () => entry,
		canPersist: () => true,
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.value.sealedSpec, {
		operation: 'set-pinned',
		pinned: true,
		expectedPinned: false,
		expectedEntryRevision: pinnedEntryRevisionV1('abc1234', entry),
		effectiveAt: '2026-07-27T11:00:00.000Z',
	});
	assert.deepEqual(result.value.affectedResources, [{
		resourceKind: 'pinned',
		resourceKey: 'abc1234',
		revision: pinnedEntryRevisionV1('abc1234', entry),
	}]);
	assert.equal((result.value.token as RuntimePinnedStateMutationPreparationV1).noChange, false);
});

test('pinned-state preparation rejects stale sealed state and duplicate tasks', () => {
	const entry = { pinned: true, updatedAt: '2026-07-27T10:00:00.000Z' };
	const stale = prepareRuntimePinnedStateMutationV1(
		request(false, { pinned: false, revision: pinnedEntryRevisionV1('abc1234', null) }),
		'2026-07-27T11:00:00.000Z',
		{
			getTask: () => ({ operonId: 'abc1234', locator, duplicate: false }),
			getPinnedEntry: () => entry,
			canPersist: () => true,
		},
	);
	assert.deepEqual(stale.ok ? null : stale.code, 'stale-context');
	const duplicate = prepareRuntimePinnedStateMutationV1(request(false), '2026-07-27T11:00:00.000Z', {
		getTask: () => ({ operonId: 'abc1234', locator, duplicate: true }),
		getPinnedEntry: () => entry,
		canPersist: () => true,
	});
	assert.deepEqual(duplicate.ok ? null : duplicate.code, 'duplicate-operon-id');
});

test('PinnedCache compare-and-set commits exact state and preserves unrelated package data', async () => {
	const cache = new PinnedCache(null, null);
	let packageData: OperonPinnedTasksPackageV1 = {
		...createEmptyPinnedTasksPackage(),
		itemsById: {
			other01: { pinned: true, updatedAt: '2026-07-27T09:00:00.000Z' },
		},
		manualOrder: {
			operonIds: ['other01'],
			updatedAt: '2026-07-27T09:00:00.000Z',
		},
	};
	cache.setPackagePersistence({
		getPackage: () => packageData,
		updatePackage: async mutator => {
			packageData = mutator(packageData);
			return packageData;
		},
		canPersist: () => true,
	});
	await cache.load({ preferPackage: true });
	const result = await cache.compareAndSetPinned(
		'abc1234',
		null,
		true,
		'2026-07-27T11:00:00.000Z',
	);
	assert.equal(result.outcome, 'committed');
	assert.deepEqual(cache.getEntry('abc1234'), {
		pinned: true,
		updatedAt: '2026-07-27T11:00:00.000Z',
	});
	assert.equal(cache.isPinned('other01'), true);
	assert.deepEqual(cache.getManualOrderIds(), ['other01']);
	assert.equal(cache.getGeneration(), 1);
	const replay = await cache.compareAndSetPinned(
		'abc1234',
		null,
		true,
		'2026-07-27T11:00:00.000Z',
	);
	assert.equal(replay.outcome, 'already-applied');
	assert.equal(cache.getGeneration(), 1);
});

test('PinnedCache compare-and-set fails closed on conflict and unavailable persistence', async () => {
	const liveEntry = { pinned: true, updatedAt: '2026-07-27T11:00:00.000Z' };
	const cache = new PinnedCache(null, null);
	let packageData: OperonPinnedTasksPackageV1 = {
		...createEmptyPinnedTasksPackage(),
		itemsById: { abc1234: liveEntry },
	};
	let persistent = true;
	cache.setPackagePersistence({
		getPackage: () => packageData,
		updatePackage: async mutator => {
			packageData = mutator(packageData);
			return packageData;
		},
		canPersist: () => persistent,
	});
	await cache.load({ preferPackage: true });
	const staleExpected: PinnedCacheEntrySnapshot = {
		pinned: false,
		updatedAt: '2026-07-27T10:00:00.000Z',
	};
	const conflict = await cache.compareAndSetPinned(
		'abc1234',
		staleExpected,
		false,
		'2026-07-27T12:00:00.000Z',
	);
	assert.equal(conflict.outcome, 'conflict');
	assert.deepEqual(cache.getEntry('abc1234'), liveEntry);
	persistent = false;
	await assert.rejects(
		cache.compareAndSetPinned('abc1234', liveEntry, false, '2026-07-27T12:00:00.000Z'),
		/Canonical pinned task persistence is unavailable/u,
	);
});

test('PinnedCache compare-and-set pins a false tombstone and unpins an exact true entry', async () => {
	const cache = new PinnedCache(null, null);
	let packageData: OperonPinnedTasksPackageV1 = {
		...createEmptyPinnedTasksPackage(),
		itemsById: {
			abc1234: { pinned: false, updatedAt: '2026-07-27T09:00:00.000Z' },
		},
	};
	cache.setPackagePersistence({
		getPackage: () => packageData,
		updatePackage: async mutator => {
			packageData = mutator(packageData);
			return packageData;
		},
		canPersist: () => true,
	});
	await cache.load({ preferPackage: true });
	const tombstone = cache.getCanonicalEntry('abc1234');
	const pinned = await cache.compareAndSetPinned(
		'abc1234',
		tombstone,
		true,
		'2026-07-27T10:00:00.000Z',
	);
	assert.equal(pinned.outcome, 'committed');
	assert.equal(cache.isPinned('abc1234'), true);
	const live = cache.getCanonicalEntry('abc1234');
	const unpinned = await cache.compareAndSetPinned(
		'abc1234',
		live,
		false,
		'2026-07-27T11:00:00.000Z',
	);
	assert.equal(unpinned.outcome, 'committed');
	assert.equal(cache.isPinned('abc1234'), false);
	assert.deepEqual(cache.getCanonicalEntry('abc1234'), {
		pinned: false,
		updatedAt: '2026-07-27T11:00:00.000Z',
	});
});

test('PinnedCache compare-and-set uses the canonical package without flushing divergent cache state', async () => {
	const cache = new PinnedCache(null, null);
	let packageData: OperonPinnedTasksPackageV1 = {
		...createEmptyPinnedTasksPackage(),
		itemsById: {
			stale01: { pinned: true, updatedAt: '2026-07-27T08:00:00.000Z' },
		},
		manualOrder: {
			operonIds: ['stale01'],
			updatedAt: '2026-07-27T08:00:00.000Z',
		},
	};
	cache.setPackagePersistence({
		getPackage: () => packageData,
		updatePackage: async mutator => {
			packageData = mutator(packageData);
			return packageData;
		},
		canPersist: () => true,
	});
	await cache.load({ preferPackage: true });
	packageData = {
		...createEmptyPinnedTasksPackage(),
		itemsById: {
			fresh01: { pinned: true, updatedAt: '2026-07-27T09:00:00.000Z' },
		},
		manualOrder: {
			operonIds: ['fresh01'],
			updatedAt: '2026-07-27T09:00:00.000Z',
		},
	};
	const result = await cache.compareAndSetPinned(
		'abc1234',
		null,
		true,
		'2026-07-27T10:00:00.000Z',
	);
	assert.equal(result.outcome, 'committed');
	assert.equal(packageData.itemsById.stale01, undefined);
	assert.equal(packageData.itemsById.fresh01?.pinned, true);
	assert.deepEqual(packageData.manualOrder?.operonIds, ['fresh01']);
	assert.equal(cache.isPinned('stale01'), false);
	assert.equal(cache.isPinned('fresh01'), true);

	const beforeConflict = JSON.stringify(packageData);
	packageData = {
		...packageData,
		itemsById: {
			...packageData.itemsById,
			raced01: { pinned: true, updatedAt: '2026-07-27T10:30:00.000Z' },
		},
	};
	const racedCanonical = JSON.stringify(packageData);
	const conflict = await cache.compareAndSetPinned(
		'raced01',
		null,
		false,
		'2026-07-27T11:00:00.000Z',
	);
	assert.equal(conflict.outcome, 'conflict');
	assert.equal(JSON.stringify(packageData), racedCanonical);
	assert.notEqual(JSON.stringify(packageData), beforeConflict);
});

test('PinnedCache compare-and-set recovers an exact persisted after-state after save uncertainty', async () => {
	const cache = new PinnedCache(null, null);
	let packageData = createEmptyPinnedTasksPackage();
	let changedWrites = 0;
	let failAfterFirstWrite = true;
	cache.setPackagePersistence({
		getPackage: () => packageData,
		updatePackage: async mutator => {
			const before = JSON.stringify(packageData);
			const next = mutator(packageData);
			if (JSON.stringify(next) !== before) changedWrites += 1;
			packageData = next;
			if (failAfterFirstWrite) {
				failAfterFirstWrite = false;
				throw new Error('simulated save acknowledgement loss');
			}
			return packageData;
		},
		canPersist: () => true,
	});
	await cache.load({ preferPackage: true });
	await assert.rejects(
		cache.compareAndSetPinned('abc1234', null, true, '2026-07-27T11:00:00.000Z'),
		/simulated save acknowledgement loss/u,
	);
	assert.deepEqual(cache.getCanonicalEntry('abc1234'), {
		pinned: true,
		updatedAt: '2026-07-27T11:00:00.000Z',
	});
	assert.equal(cache.isPinned('abc1234'), true);
	const replay = await cache.compareAndSetPinned(
		'abc1234',
		null,
		true,
		'2026-07-27T11:00:00.000Z',
	);
	assert.equal(replay.outcome, 'already-applied');
	assert.equal(changedWrites, 1);
});
