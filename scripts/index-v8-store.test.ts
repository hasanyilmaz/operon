import assert from 'node:assert/strict';
import {
	buildIndexV8Snapshot,
	sha256Hex,
	sha256HexBytes,
	stableCompactStringify,
} from '../src/indexer/persistence/index-v8-codec';
import {
	IndexV8StorageError,
	IndexV8Store,
} from '../src/indexer/persistence/index-v8-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { setOperonEnginePerfDebug } from '../src/core/engine-perf';
import { createSyntheticIndexData, createV8SourcesFromIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';

const FIRST_TIME = '2026-01-02T03:04:05.000Z';
const SECOND_TIME = '2026-01-02T03:05:05.000Z';
let assertions = 0;

function check(condition: unknown, message?: string): asserts condition {
	assert.ok(condition, message);
	assertions++;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.equal(actual, expected);
	else assert.equal(actual, expected, message);
	assertions++;
}

async function rejects(action: () => Promise<unknown>, code: string): Promise<void> {
	await assert.rejects(action, error => error instanceof IndexV8StorageError && error.code === code);
	assertions++;
}

async function snapshot(count: number, committedAt = FIRST_TIME) {
	const data = createSyntheticIndexData(count);
	return await buildIndexV8Snapshot({
		committedAt,
		lastFullScanAt: FIRST_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'store-test-v1',
		sources: createV8SourcesFromIndexData(data),
	});
}

async function changedSnapshot(base: Awaited<ReturnType<typeof snapshot>>) {
	const sources = base.shards.flatMap(shard => shard.sources.map(source => ({
		path: source.path,
		mtimeMs: source.mtimeMs,
		sizeBytes: source.sizeBytes,
		instances: source.instances.map(instance => ({
			...instance,
			instanceKey: `${instance.location.format}:${source.path}:${instance.location.lineNumber}`,
			primary: { filePath: source.path, ...instance.location },
			tier: 'hot' as const,
		})),
	})));
	sources[0].instances[0].description += ' changed';
	sources[0].mtimeMs += 1;
	return await buildIndexV8Snapshot({
		committedAt: SECOND_TIME,
		lastFullScanAt: FIRST_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'store-test-v1',
		sources,
	});
}

function changedShardPayloads(
	base: Awaited<ReturnType<typeof snapshot>>,
	candidate: Awaited<ReturnType<typeof snapshot>>,
): Map<string, string> {
	const payloads = new Map<string, string>();
	for (let index = 0; index < candidate.manifest.shards.length; index++) {
		const descriptor = candidate.manifest.shards[index];
		if (descriptor.sha256 === base.manifest.shards[index].sha256) continue;
		payloads.set(descriptor.shardId, candidate.shardPayloads.get(descriptor.shardId)!);
	}
	return payloads;
}

async function run(): Promise<void> {
	const paths = buildOperonStoragePaths('.obsidian', 'operon-store-test').runtime.indexV8;
	const firstFailureAdapter = new IndexV8MemoryAdapter();
	const firstFailureStore = new IndexV8Store(firstFailureAdapter.asDataAdapter(), paths);
	const firstFailureSnapshot = await snapshot(99, '2026-01-02T03:03:05.000Z');
	const firstFailureDescriptor = firstFailureSnapshot.manifest.shards[0];
	let firstPostflightCorrupted = false;
	firstFailureAdapter.afterRead = (path, data) => {
		if (firstPostflightCorrupted || path !== paths.manifestPath || data !== firstFailureSnapshot.manifestPayload) return;
		firstPostflightCorrupted = true;
		const shardPath = `${paths.shardsPath}/${firstFailureDescriptor.shardId}-${firstFailureDescriptor.sha256}.json`;
		firstFailureAdapter.setFile(shardPath, `${firstFailureAdapter.files.get(shardPath)!} `);
	};
	await rejects(() => firstFailureStore.commit(firstFailureSnapshot), 'SNAPSHOT_POSTFLIGHT_FAILED');
	firstFailureAdapter.afterRead = null;
	equal((await firstFailureStore.load()).status, 'invalid');
	check(firstFailureAdapter.files.has(paths.manifestPath));

	const incrementalAdapter = new IndexV8MemoryAdapter();
	const incrementalStore = new IndexV8Store(incrementalAdapter.asDataAdapter(), paths);
	const incrementalBase = await snapshot(64, '2026-01-02T03:02:05.000Z');
	const incrementalCandidate = await changedSnapshot(incrementalBase);
	await incrementalStore.commit(incrementalBase);
	const incrementalPayloads = changedShardPayloads(incrementalBase, incrementalCandidate);
	equal(incrementalPayloads.size, 1);
	const incrementalResult = await incrementalStore.commitIncremental({
		expectedBaseSnapshotId: incrementalBase.manifest.snapshotId,
		expectedBaseManifestPayload: incrementalBase.manifestPayload,
		manifestPayload: incrementalCandidate.manifestPayload,
		changedShardPayloads: incrementalPayloads,
	});
	equal(incrementalResult.status, 'committed');
	equal(incrementalResult.shardsWritten, 1);
	equal(incrementalResult.shardsReused, 31);
	equal(incrementalResult.manifestWritten, true);
	const incrementalLoaded = await incrementalStore.load();
	check(incrementalLoaded.status === 'loaded');
	if (incrementalLoaded.status === 'loaded') {
		equal(incrementalLoaded.manifest.snapshotId, incrementalCandidate.manifest.snapshotId);
	}
	await rejects(() => incrementalStore.commitIncremental({
		expectedBaseSnapshotId: incrementalBase.manifest.snapshotId,
		expectedBaseManifestPayload: incrementalBase.manifestPayload,
		manifestPayload: incrementalCandidate.manifestPayload,
		changedShardPayloads: incrementalPayloads,
	}), 'BASE_SNAPSHOT_CHANGED');
	equal(incrementalAdapter.files.get(paths.manifestPath), incrementalCandidate.manifestPayload);
	const unexpectedPayloads = new Map(incrementalPayloads);
	const unchangedDescriptor = incrementalCandidate.manifest.shards.find(descriptor => !incrementalPayloads.has(descriptor.shardId));
	check(unchangedDescriptor);
	unexpectedPayloads.set(unchangedDescriptor.shardId, incrementalCandidate.shardPayloads.get(unchangedDescriptor.shardId)!);
	await rejects(() => incrementalStore.commitIncremental({
		expectedBaseSnapshotId: incrementalCandidate.manifest.snapshotId,
		expectedBaseManifestPayload: incrementalCandidate.manifestPayload,
		manifestPayload: incrementalCandidate.manifestPayload,
		changedShardPayloads: unexpectedPayloads,
	}), 'INVALID_SNAPSHOT');

	const incrementalNext = await changedSnapshot(incrementalCandidate);
	const concurrentWinner = await snapshot(65, '2026-01-02T03:06:05.000Z');
	let installedConcurrentWinner = false;
	incrementalAdapter.beforeProcess = path => {
		if (installedConcurrentWinner || path !== paths.manifestPath) return;
		installedConcurrentWinner = true;
		for (const descriptor of concurrentWinner.manifest.shards) {
			incrementalAdapter.setFile(
				`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
				concurrentWinner.shardPayloads.get(descriptor.shardId)!,
			);
		}
		incrementalAdapter.setFile(paths.manifestPath, concurrentWinner.manifestPayload);
	};
	await rejects(() => incrementalStore.commitIncremental({
		expectedBaseSnapshotId: incrementalCandidate.manifest.snapshotId,
		expectedBaseManifestPayload: incrementalCandidate.manifestPayload,
		manifestPayload: incrementalNext.manifestPayload,
		changedShardPayloads: changedShardPayloads(incrementalCandidate, incrementalNext),
	}), 'BASE_SNAPSHOT_CHANGED');
	incrementalAdapter.beforeProcess = null;
	equal(incrementalAdapter.files.get(paths.manifestPath), concurrentWinner.manifestPayload);

	const fullCasAdapter = new IndexV8MemoryAdapter();
	const fullCasStore = new IndexV8Store(fullCasAdapter.asDataAdapter(), paths);
	const fullCasBase = await snapshot(80, '2026-01-02T03:01:05.000Z');
	const fullCasCandidate = await changedSnapshot(fullCasBase);
	const fullCasWinner = await snapshot(81, '2026-01-02T03:07:05.000Z');
	await fullCasStore.commit(fullCasBase);
	let fullCasWinnerInstalled = false;
	fullCasAdapter.beforeProcess = path => {
		if (fullCasWinnerInstalled || path !== paths.manifestPath) return;
		fullCasWinnerInstalled = true;
		for (const descriptor of fullCasWinner.manifest.shards) {
			fullCasAdapter.setFile(
				`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
				fullCasWinner.shardPayloads.get(descriptor.shardId)!,
			);
		}
		fullCasAdapter.setFile(paths.manifestPath, fullCasWinner.manifestPayload);
	};
	await rejects(() => fullCasStore.commit({
		manifestPayload: fullCasCandidate.manifestPayload,
		shardPayloads: fullCasCandidate.shardPayloads,
		expectedBaseSnapshotId: fullCasBase.manifest.snapshotId,
		expectedBaseManifestPayload: fullCasBase.manifestPayload,
	}), 'BASE_SNAPSHOT_CHANGED');
	fullCasAdapter.beforeProcess = null;
	equal(fullCasAdapter.files.get(paths.manifestPath), fullCasWinner.manifestPayload);

	const initialCasAdapter = new IndexV8MemoryAdapter();
	const initialCasStore = new IndexV8Store(initialCasAdapter.asDataAdapter(), paths);
	const initialCandidate = await snapshot(811, '2026-01-02T03:07:15.000Z');
	const initialWinner = await snapshot(812, '2026-01-02T03:07:16.000Z');
	let manifestExistsCount = 0;
	initialCasAdapter.failOperation = (operation, path) => {
		if (operation !== 'exists' || path !== paths.manifestPath) return false;
		manifestExistsCount++;
		if (manifestExistsCount !== 4) return false;
		for (const descriptor of initialWinner.manifest.shards) {
			initialCasAdapter.setFile(
				`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
				initialWinner.shardPayloads.get(descriptor.shardId)!,
			);
		}
		initialCasAdapter.setFile(paths.manifestPath, initialWinner.manifestPayload);
		return false;
	};
	await rejects(() => initialCasStore.commit({
		manifestPayload: initialCandidate.manifestPayload,
		shardPayloads: initialCandidate.shardPayloads,
		expectedBaseMissing: true,
	}), 'BASE_SNAPSHOT_CHANGED');
	initialCasAdapter.failOperation = null;
	equal(initialCasAdapter.files.get(paths.manifestPath), initialWinner.manifestPayload);

	const immutableAdapter = new IndexV8MemoryAdapter();
	const immutableStore = new IndexV8Store(immutableAdapter.asDataAdapter(), paths);
	const immutableSnapshot = await snapshot(82, '2026-01-02T03:08:05.000Z');
	const immutableDescriptor = immutableSnapshot.manifest.shards[0];
	const immutablePath = `${paths.shardsPath}/${immutableDescriptor.shardId}-${immutableDescriptor.sha256}.json`;
	let immutableConflictInstalled = false;
	immutableAdapter.failOperation = (operation, path) => {
		if (!immutableConflictInstalled && operation === 'write' && path.startsWith(`${immutablePath}.tmp-`)) {
			immutableConflictInstalled = true;
			immutableAdapter.setFile(immutablePath, 'sync-conflict-payload');
		}
		return false;
	};
	await rejects(() => immutableStore.commit(immutableSnapshot), 'CONTENT_ADDRESS_CONFLICT');
	immutableAdapter.failOperation = null;
	equal(immutableAdapter.files.get(immutablePath), 'sync-conflict-payload');
	check(!immutableAdapter.files.has(paths.manifestPath), 'immutable shard conflict must not activate a manifest');

	const reusedRaceAdapter = new IndexV8MemoryAdapter();
	const reusedRaceStore = new IndexV8Store(reusedRaceAdapter.asDataAdapter(), paths);
	const reusedRaceBase = await snapshot(83, '2026-01-02T03:09:05.000Z');
	const reusedRaceCandidate = await changedSnapshot(reusedRaceBase);
	await reusedRaceStore.commit(reusedRaceBase);
	const reusedRacePayloads = changedShardPayloads(reusedRaceBase, reusedRaceCandidate);
	const reusedRaceDescriptor = reusedRaceCandidate.manifest.shards.find(descriptor => !reusedRacePayloads.has(descriptor.shardId));
	check(reusedRaceDescriptor);
	const reusedRacePath = `${paths.shardsPath}/${reusedRaceDescriptor.shardId}-${reusedRaceDescriptor.sha256}.json`;
	let reusedRaceRemoved = false;
	reusedRaceAdapter.afterRead = (path, data) => {
		if (reusedRaceRemoved || path !== paths.manifestPath || data !== reusedRaceCandidate.manifestPayload) return;
		reusedRaceRemoved = true;
		reusedRaceAdapter.deleteFile(reusedRacePath);
	};
	await rejects(() => reusedRaceStore.commitIncremental({
		expectedBaseSnapshotId: reusedRaceBase.manifest.snapshotId,
		expectedBaseManifestPayload: reusedRaceBase.manifestPayload,
		manifestPayload: reusedRaceCandidate.manifestPayload,
		changedShardPayloads: reusedRacePayloads,
	}), 'SNAPSHOT_POSTFLIGHT_FAILED');
	reusedRaceAdapter.afterRead = null;
	equal(reusedRaceAdapter.files.get(paths.manifestPath), reusedRaceBase.manifestPayload);

	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths, { collectLoadMetrics: true });
	equal((await store.load()).status, 'missing');

	const first = await snapshot(100);
	const cold = await store.commit(first);
	equal(cold.status, 'committed');
	equal(cold.shardsWritten, 32);
	equal(cold.shardsReused, 0);
	equal(cold.manifestWritten, true);
	const manifestCommitIndex = adapter.operations.findLastIndex(operation => operation.includes(`->${paths.manifestPath}`));
	const lastShardCommitIndex = adapter.operations.findLastIndex(operation => operation.includes(`->${paths.shardsPath}/`));
	check(manifestCommitIndex > lastShardCommitIndex, 'manifest must be committed after every shard');

	const operationsBeforeLoad = adapter.operations.length;
	const loaded = await store.load();
	equal(loaded.status, 'loaded');
	if (loaded.status !== 'loaded') throw new Error('Expected loaded V8 snapshot');
	equal(loaded.manifest.snapshotId, first.manifest.snapshotId);
	equal(loaded.shards.length, 32);
	equal(loaded.metrics.manifestValidationPasses, 1);
	equal(loaded.metrics.shardValidationPasses, 32);
	equal(loaded.metrics.globalValidationPasses, 1);
	check((loaded.metrics.maxShardValidationConcurrency ?? 0) >= 1);
	check((loaded.metrics.maxShardValidationConcurrency ?? 0) <= 4);
	const loadOperations = adapter.operations.slice(operationsBeforeLoad);
	equal(loadOperations.filter(operation => operation === `read:${paths.manifestPath}`).length, 1);
	equal(loadOperations.filter(operation => operation.startsWith(`readBinary:${paths.shardsPath}/`)).length, 32);
	equal(loadOperations.filter(operation => operation.startsWith(`read:${paths.shardsPath}/`)).length, 0);
	const wideLoadStore = new IndexV8Store(adapter.asDataAdapter(), paths, {
		ioConcurrency: 8,
		collectLoadMetrics: true,
	});
	const wideLoaded = await wideLoadStore.load();
	check(wideLoaded.status === 'loaded');
	if (wideLoaded.status === 'loaded') {
		equal(wideLoaded.metrics.shardValidationPasses, 32);
		check((wideLoaded.metrics.maxShardValidationConcurrency ?? 0) <= 4);
	}

	const writesBeforeNoop = adapter.operations.filter(operation => operation.startsWith('write:') || operation.startsWith('process:')).length;
	const unchanged = await store.commit(first);
	equal(unchanged.status, 'unchanged');
	equal(unchanged.shardsWritten, 0);
	equal(unchanged.manifestWritten, false);
	equal(
		adapter.operations.filter(operation => operation.startsWith('write:') || operation.startsWith('process:')).length,
		writesBeforeNoop,
	);

	const second = await changedSnapshot(first);
	const incremental = await store.commit(second);
	equal(incremental.shardsWritten, 1);
	equal(incremental.shardsReused, 31);
	equal(incremental.manifestWritten, true);

	const concurrentThird = await snapshot(101, '2026-01-02T03:06:05.000Z');
	const concurrentFourth = await snapshot(102, '2026-01-02T03:07:05.000Z');
	const secondStore = new IndexV8Store(adapter.asDataAdapter(), paths);
	await Promise.all([store.commit(concurrentThird), secondStore.commit(concurrentFourth)]);
	const concurrentLoaded = await store.load();
	check(concurrentLoaded.status === 'loaded');
	if (concurrentLoaded.status === 'loaded') equal(concurrentLoaded.manifest.snapshotId, concurrentFourth.manifest.snapshotId);

	const callerOwnedPayloads = new Map(concurrentFourth.shardPayloads);
	const sealedCommit = store.commit({
		manifestPayload: concurrentFourth.manifestPayload,
		shardPayloads: callerOwnedPayloads,
	});
	callerOwnedPayloads.set(concurrentFourth.manifest.shards[0].shardId, 'caller mutation');
	equal((await sealedCommit).status, 'unchanged');
	equal((await store.load()).status, 'loaded');

	const stableManifest = adapter.files.get(paths.manifestPath)!;
	const shardFailureSnapshot = await changedSnapshot(concurrentFourth);
	adapter.failOperation = (operation, path) => operation === 'write' && path.startsWith(paths.shardsPath);
	await assert.rejects(() => store.commit(shardFailureSnapshot));
	assertions++;
	equal(adapter.files.get(paths.manifestPath), stableManifest);
	adapter.failOperation = null;

	const shardPostflightSnapshot = await changedSnapshot(concurrentFourth);
	adapter.corruptAfterRename = (path, data) => path.startsWith(paths.shardsPath) ? `${data} ` : null;
	await rejects(() => store.commit(shardPostflightSnapshot), 'SHARD_POSTFLIGHT_FAILED');
	adapter.corruptAfterRename = null;
	equal(adapter.files.get(paths.manifestPath), stableManifest);
	const afterShardPostflight = await store.load();
	check(afterShardPostflight.status === 'loaded');
	if (afterShardPostflight.status === 'loaded') equal(afterShardPostflight.manifest.snapshotId, concurrentFourth.manifest.snapshotId);

	const manifestFailureSnapshot = await snapshot(103, '2026-01-02T03:08:05.000Z');
	adapter.failOperation = (operation, path) => operation === 'process' && path === paths.manifestPath;
	await assert.rejects(() => store.commit(manifestFailureSnapshot));
	assertions++;
	equal(adapter.files.get(paths.manifestPath), stableManifest);
	adapter.failOperation = null;
	let manifestCorrupted = false;
	adapter.corruptAfterProcess = (path, data) => {
		if (path !== paths.manifestPath || manifestCorrupted) return null;
		manifestCorrupted = true;
		const corrupted = JSON.parse(data) as Record<string, unknown>;
		corrupted.snapshotId = '0'.repeat(64);
		return stableCompactStringify(corrupted);
	};
	await rejects(() => store.commit(manifestFailureSnapshot), 'MANIFEST_POSTFLIGHT_FAILED');
	adapter.corruptAfterProcess = null;
	const afterManifestPostflight = await store.load();
	check(afterManifestPostflight.status === 'loaded');
	if (afterManifestPostflight.status === 'loaded') equal(afterManifestPostflight.manifest.snapshotId, concurrentFourth.manifest.snapshotId);
	const snapshotPostflightFailure = await snapshot(104, '2026-01-02T03:09:05.000Z');
	const changedDescriptor = snapshotPostflightFailure.manifest.shards.find(descriptor => (
		concurrentFourth.manifest.shards.find(previous => previous.shardId === descriptor.shardId)?.sha256 !== descriptor.sha256
	));
	check(changedDescriptor, 'postflight fixture must introduce a newly addressed shard');
	let snapshotPostflightCorrupted = false;
	adapter.afterRead = (path, data) => {
		if (snapshotPostflightCorrupted || path !== paths.manifestPath || data !== snapshotPostflightFailure.manifestPayload) return;
		snapshotPostflightCorrupted = true;
		const shardPath = `${paths.shardsPath}/${changedDescriptor.shardId}-${changedDescriptor.sha256}.json`;
		adapter.setFile(shardPath, `${adapter.files.get(shardPath)!} `);
	};
	await rejects(() => store.commit(snapshotPostflightFailure), 'SNAPSHOT_POSTFLIGHT_FAILED');
	adapter.afterRead = null;
	const afterSnapshotPostflight = await store.load();
	check(afterSnapshotPostflight.status === 'loaded');
	if (afterSnapshotPostflight.status === 'loaded') equal(afterSnapshotPostflight.manifest.snapshotId, concurrentFourth.manifest.snapshotId);
	const concurrentSyncSnapshot = await snapshot(105, '2026-01-02T03:10:05.000Z');
	const attemptedBeforeSync = await snapshot(106, '2026-01-02T03:11:05.000Z');
	let concurrentSyncInstalled = false;
	adapter.afterRead = (path, data) => {
		if (concurrentSyncInstalled || path !== paths.manifestPath || data !== attemptedBeforeSync.manifestPayload) return;
		concurrentSyncInstalled = true;
		for (const descriptor of concurrentSyncSnapshot.manifest.shards) {
			const payload = concurrentSyncSnapshot.shardPayloads.get(descriptor.shardId)!;
			adapter.setFile(`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`, payload);
		}
		adapter.setFile(paths.manifestPath, concurrentSyncSnapshot.manifestPayload);
	};
	await rejects(() => store.commit(attemptedBeforeSync), 'SNAPSHOT_POSTFLIGHT_FAILED');
	adapter.afterRead = null;
	const afterConcurrentSync = await store.load();
	check(afterConcurrentSync.status === 'loaded');
	if (afterConcurrentSync.status === 'loaded') equal(afterConcurrentSync.manifest.snapshotId, concurrentSyncSnapshot.manifest.snapshotId);
	const incompleteSyncSnapshot = await snapshot(107, '2026-01-02T03:12:05.000Z');
	const attemptedBeforeIncompleteSync = await snapshot(108, '2026-01-02T03:13:05.000Z');
	const missingSyncDescriptor = incompleteSyncSnapshot.manifest.shards.find(descriptor => (
		concurrentSyncSnapshot.manifest.shards.find(previous => previous.shardId === descriptor.shardId)?.sha256 !== descriptor.sha256
	));
	check(missingSyncDescriptor, 'incomplete Sync fixture must introduce a new shard address');
	adapter.deleteFile(`${paths.shardsPath}/${missingSyncDescriptor.shardId}-${missingSyncDescriptor.sha256}.json`);
	let incompleteSyncInstalled = false;
	adapter.afterRead = (path, data) => {
		if (incompleteSyncInstalled || path !== paths.manifestPath || data !== attemptedBeforeIncompleteSync.manifestPayload) return;
		incompleteSyncInstalled = true;
		adapter.setFile(paths.manifestPath, incompleteSyncSnapshot.manifestPayload);
	};
	await rejects(() => store.commit(attemptedBeforeIncompleteSync), 'SNAPSHOT_POSTFLIGHT_FAILED');
	adapter.afterRead = null;
	const duringIncompleteSync = await store.load();
	check(duringIncompleteSync.status === 'incomplete');
	if (duringIncompleteSync.status === 'incomplete') equal(duringIncompleteSync.manifest.snapshotId, incompleteSyncSnapshot.manifest.snapshotId);
	for (const descriptor of incompleteSyncSnapshot.manifest.shards) {
		const payload = incompleteSyncSnapshot.shardPayloads.get(descriptor.shardId)!;
		adapter.setFile(`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`, payload);
	}
	const afterIncompleteSync = await store.load();
	check(afterIncompleteSync.status === 'loaded');
	if (afterIncompleteSync.status === 'loaded') equal(afterIncompleteSync.manifest.snapshotId, incompleteSyncSnapshot.manifest.snapshotId);
	const disappearingManifestSnapshot = await snapshot(109, '2026-01-02T03:14:05.000Z');
	let attemptedManifestRemoved = false;
	adapter.afterRead = (path, data) => {
		if (attemptedManifestRemoved || path !== paths.manifestPath || data !== disappearingManifestSnapshot.manifestPayload) return;
		attemptedManifestRemoved = true;
		adapter.deleteFile(paths.manifestPath);
	};
	await rejects(() => store.commit(disappearingManifestSnapshot), 'SNAPSHOT_POSTFLIGHT_FAILED');
	adapter.afterRead = null;
	equal((await store.load()).status, 'missing');
	adapter.setFile(paths.manifestPath, incompleteSyncSnapshot.manifestPayload);
	const rollbackRaceAttempt = await snapshot(110, '2026-01-02T03:15:05.000Z');
	const rollbackRaceWinner = await snapshot(111, '2026-01-02T03:16:05.000Z');
	const rollbackRaceDescriptor = rollbackRaceAttempt.manifest.shards.find(descriptor => (
		incompleteSyncSnapshot.manifest.shards.find(previous => previous.shardId === descriptor.shardId)?.sha256 !== descriptor.sha256
	));
	check(rollbackRaceDescriptor, 'rollback race fixture must introduce a new shard address');
	let rollbackRaceCorrupted = false;
	let manifestProcessCount = 0;
	adapter.afterRead = (path, data) => {
		if (rollbackRaceCorrupted || path !== paths.manifestPath || data !== rollbackRaceAttempt.manifestPayload) return;
		rollbackRaceCorrupted = true;
		const shardPath = `${paths.shardsPath}/${rollbackRaceDescriptor.shardId}-${rollbackRaceDescriptor.sha256}.json`;
		adapter.setFile(shardPath, `${adapter.files.get(shardPath)!} `);
	};
	adapter.beforeProcess = path => {
		if (path !== paths.manifestPath || ++manifestProcessCount !== 2) return;
		for (const descriptor of rollbackRaceWinner.manifest.shards) {
			const payload = rollbackRaceWinner.shardPayloads.get(descriptor.shardId)!;
			adapter.setFile(`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`, payload);
		}
		adapter.setFile(paths.manifestPath, rollbackRaceWinner.manifestPayload);
	};
	await rejects(() => store.commit(rollbackRaceAttempt), 'SNAPSHOT_POSTFLIGHT_FAILED');
	adapter.afterRead = null;
	adapter.beforeProcess = null;
	const afterRollbackRace = await store.load();
	check(afterRollbackRace.status === 'loaded');
	if (afterRollbackRace.status === 'loaded') equal(afterRollbackRace.manifest.snapshotId, rollbackRaceWinner.manifest.snapshotId);
	await store.commit(concurrentFourth);

	const missingDescriptor = concurrentFourth.manifest.shards[0];
	const missingPath = `${paths.shardsPath}/${missingDescriptor.shardId}-${missingDescriptor.sha256}.json`;
	const missingPayload = adapter.files.get(missingPath)!;
	adapter.deleteFile(missingPath);
	const incomplete = await store.load();
	equal(incomplete.status, 'incomplete');
	if (incomplete.status === 'incomplete') {
		equal(incomplete.retryable, true);
		check(incomplete.missingShardIds.includes(missingDescriptor.shardId));
		equal(incomplete.manifest.snapshotId, concurrentFourth.manifest.snapshotId);
	}
	const incompleteInspection = await store.inspect();
	equal(incompleteInspection.manifestStatus, 'incomplete');
	const presentActiveShardNames = concurrentFourth.manifest.shards
		.filter(descriptor => descriptor.shardId !== missingDescriptor.shardId)
		.map(descriptor => descriptor.path.slice('shards/'.length));
	check(presentActiveShardNames.every(name => incompleteInspection.entries.some(entry => entry.name === name && entry.kind === 'active-shard')));
	adapter.setFile(missingPath, missingPayload);

	adapter.setFile(missingPath, `${missingPayload} `);
	const byteMismatch = await store.load();
	check(byteMismatch.status === 'invalid');
	if (byteMismatch.status === 'invalid') {
		equal(byteMismatch.retryable, false);
		equal(byteMismatch.code, 'INVALID_SNAPSHOT');
	}
	const corruptInspection = await store.inspect();
	equal(corruptInspection.manifestStatus, 'invalid');
	const allActiveShardNames = concurrentFourth.manifest.shards.map(descriptor => descriptor.path.slice('shards/'.length));
	check(allActiveShardNames.every(name => corruptInspection.entries.some(entry => entry.name === name && entry.kind === 'active-shard')));
	await rejects(() => store.commit(concurrentFourth), 'CONTENT_ADDRESS_CONFLICT');
	adapter.setFile(missingPath, missingPayload);
	adapter.setFile(missingPath, 'x'.repeat(4_000_001));
	const oversizedShard = await store.load();
	check(oversizedShard.status === 'invalid');
	if (oversizedShard.status === 'invalid') equal(oversizedShard.code, 'INVALID_SNAPSHOT');
	adapter.setFile(missingPath, missingPayload);
	const sameByteChecksumPayload = `${missingPayload.slice(0, -1)} `;
	equal(new TextEncoder().encode(sameByteChecksumPayload).byteLength, missingDescriptor.bytes);
	adapter.setFile(missingPath, sameByteChecksumPayload);
	const checksumMismatch = await store.load();
	check(checksumMismatch.status === 'invalid');
	if (checksumMismatch.status === 'invalid') equal(checksumMismatch.code, 'INVALID_SNAPSHOT');
	adapter.setFile(missingPath, missingPayload);
	const secondDescriptor = concurrentFourth.manifest.shards[1];
	const secondPath = `${paths.shardsPath}/${secondDescriptor.shardId}-${secondDescriptor.sha256}.json`;
	const secondPayload = adapter.files.get(secondPath)!;
	adapter.deleteFile(missingPath);
	adapter.setFile(secondPath, `${secondPayload.slice(0, -1)} `);
	const mixedMissingAndCorrupt = await store.load();
	check(mixedMissingAndCorrupt.status === 'invalid');
	if (mixedMissingAndCorrupt.status === 'invalid') equal(mixedMissingAndCorrupt.code, 'INVALID_SNAPSHOT');
	adapter.setFile(missingPath, missingPayload);
	adapter.setFile(secondPath, secondPayload);
	adapter.setFile(secondPath, `${secondPayload.slice(0, -1)} `);
	adapter.failOperation = (operation, path) => operation === 'readBinary' && path === missingPath;
	const mixedIoAndCorrupt = await store.load();
	check(mixedIoAndCorrupt.status === 'invalid');
	if (mixedIoAndCorrupt.status === 'invalid') equal(mixedIoAndCorrupt.code, 'INVALID_SNAPSHOT');
	adapter.failOperation = null;
	adapter.setFile(secondPath, secondPayload);

	const unsafeManifest = structuredClone(concurrentFourth.manifest);
	unsafeManifest.shards[0].path = '../../outside.json';
	const { snapshotId: _snapshotId, ...unsafeBody } = unsafeManifest;
	unsafeManifest.snapshotId = await sha256Hex(stableCompactStringify(unsafeBody));
	adapter.setFile(paths.manifestPath, stableCompactStringify(unsafeManifest));
	const readsBeforeUnsafeLoad = adapter.operations.length;
	equal((await store.load()).status, 'invalid');
	check(!adapter.operations.slice(readsBeforeUnsafeLoad).some(operation => operation.includes('outside.json')));
	adapter.setFile(paths.manifestPath, concurrentFourth.manifestPayload);
	const unsupportedManifest = structuredClone(concurrentFourth.manifest) as unknown as Record<string, unknown>;
	unsupportedManifest.schemaVersion = 9;
	adapter.setFile(paths.manifestPath, stableCompactStringify(unsupportedManifest));
	const unsupported = await store.load();
	check(unsupported.status === 'unsupported');
	if (unsupported.status === 'unsupported') {
		equal(unsupported.retryable, false);
		equal(unsupported.code, 'UNSUPPORTED_CONTRACT');
	}
	adapter.setFile(paths.manifestPath, concurrentFourth.manifestPayload);
	const futureShardManifest = structuredClone(concurrentFourth.manifest);
	const futureShardDescriptor = futureShardManifest.shards[0];
	const currentShardPath = `${paths.shardsPath}/${futureShardDescriptor.shardId}-${futureShardDescriptor.sha256}.json`;
	const futureShard = JSON.parse(adapter.files.get(currentShardPath)!) as Record<string, unknown>;
	futureShard.schemaVersion = 9;
	const futureShardPayload = stableCompactStringify(futureShard);
	futureShardDescriptor.bytes = new TextEncoder().encode(futureShardPayload).byteLength;
	futureShardDescriptor.sha256 = await sha256Hex(futureShardPayload);
	futureShardDescriptor.path = `shards/${futureShardDescriptor.shardId}-${futureShardDescriptor.sha256}.json`;
	const { snapshotId: _futureShardSnapshotId, ...futureShardManifestBody } = futureShardManifest;
	futureShardManifest.snapshotId = await sha256Hex(stableCompactStringify(futureShardManifestBody));
	const futureShardPath = `${paths.shardsPath}/${futureShardDescriptor.shardId}-${futureShardDescriptor.sha256}.json`;
	adapter.setFile(futureShardPath, futureShardPayload);
	adapter.setFile(paths.manifestPath, stableCompactStringify(futureShardManifest));
	const unsupportedShard = await store.load();
	check(unsupportedShard.status === 'unsupported');
	if (unsupportedShard.status === 'unsupported') {
		equal(unsupportedShard.retryable, false);
		equal(unsupportedShard.code, 'UNSUPPORTED_CONTRACT');
	}
	adapter.deleteFile(futureShardPath);
	adapter.setFile(paths.manifestPath, concurrentFourth.manifestPayload);
	const invalidUtf8 = new Uint8Array([0xff]);
	const invalidUtf8Manifest = structuredClone(concurrentFourth.manifest);
	const invalidUtf8Descriptor = invalidUtf8Manifest.shards[0];
	invalidUtf8Descriptor.bytes = invalidUtf8.byteLength;
	invalidUtf8Descriptor.sha256 = await sha256HexBytes(
		invalidUtf8.buffer.slice(invalidUtf8.byteOffset, invalidUtf8.byteOffset + invalidUtf8.byteLength) as ArrayBuffer,
	);
	invalidUtf8Descriptor.path = `shards/${invalidUtf8Descriptor.shardId}-${invalidUtf8Descriptor.sha256}.json`;
	const { snapshotId: _invalidUtf8SnapshotId, ...invalidUtf8Body } = invalidUtf8Manifest;
	invalidUtf8Manifest.snapshotId = await sha256Hex(stableCompactStringify(invalidUtf8Body));
	const invalidUtf8Path = `${paths.shardsPath}/${invalidUtf8Descriptor.shardId}-${invalidUtf8Descriptor.sha256}.json`;
	adapter.setBinaryFile(invalidUtf8Path, invalidUtf8);
	adapter.setFile(paths.manifestPath, stableCompactStringify(invalidUtf8Manifest));
	const invalidUtf8Load = await store.load();
	check(invalidUtf8Load.status === 'invalid');
	if (invalidUtf8Load.status === 'invalid') {
		equal(invalidUtf8Load.retryable, false);
		equal(invalidUtf8Load.code, 'INVALID_SNAPSHOT');
	}
	adapter.deleteFile(invalidUtf8Path);
	adapter.setFile(paths.manifestPath, concurrentFourth.manifestPayload);
	adapter.failOperation = (operation, path) => operation === 'read' && path === paths.manifestPath;
	const ioFailure = await store.load();
	check(ioFailure.status === 'io-error');
	if (ioFailure.status === 'io-error') {
		equal(ioFailure.retryable, true);
		equal(ioFailure.code, 'ADAPTER_IO');
	}
	adapter.failOperation = null;
	adapter.setFile(paths.manifestPath, 'x'.repeat(256_001));
	const oversizedManifest = await store.load();
	check(oversizedManifest.status === 'invalid');
	if (oversizedManifest.status === 'invalid') equal(oversizedManifest.code, 'MANIFEST_TOO_LARGE');
	adapter.setFile(paths.manifestPath, concurrentFourth.manifestPayload);

	const debugLines: string[] = [];
	const originalDebug = console.debug;
	setOperonEnginePerfDebug(true);
	console.debug = (...args: unknown[]) => { debugLines.push(args.join(' ')); };
	try {
		equal((await store.load()).status, 'loaded');
	} finally {
		console.debug = originalDebug;
		setOperonEnginePerfDebug(false);
	}
	check(debugLines.some(line => line.includes('index.v8.storage.load')));
	check(debugLines.every(line => !line.toLowerCase().includes('synthetic') && !line.includes(paths.rootPath)));

	const orphanName = `00-${'a'.repeat(64)}.json`;
	const shardTempName = `00-${'b'.repeat(64)}.json.tmp-1700000000000-abc123`;
	const manifestTempName = 'manifest.json.tmp-1700000000000-def456';
	adapter.setFile(`${paths.shardsPath}/${orphanName}`, '{}');
	adapter.setFile(`${paths.shardsPath}/${shardTempName}`, 'temp');
	adapter.setFile(`${paths.shardsPath}/leftover.tmp-123`, 'foreign temp-like');
	adapter.setFile(`${paths.shardsPath}/00-conflict-copy.json`, 'conflict');
	adapter.setFile(`${paths.rootPath}/${manifestTempName}`, 'temp');
	adapter.setFile(`${paths.rootPath}/manifest (conflict copy).json`, concurrentThird.manifestPayload);
	const beforeInspect = new Map(adapter.files);
	const inspectOperationStart = adapter.operations.length;
	const inspection = await store.inspect();
	equal(inspection.manifestStatus, 'loaded');
	equal(inspection.activeSnapshotId, concurrentFourth.manifest.snapshotId);
	equal(inspection.activeManifestPayload, concurrentFourth.manifestPayload);
	check(inspection.entries.some(entry => entry.name === orphanName && entry.kind === 'orphan-shard'));
	check(inspection.entries.some(entry => entry.name === shardTempName && entry.kind === 'owned-temp'));
	check(inspection.entries.some(entry => entry.name === manifestTempName && entry.kind === 'owned-temp'));
	check(inspection.entries.some(entry => entry.name === 'leftover.tmp-123' && entry.kind === 'foreign'));
	check(inspection.entries.some(entry => entry.name === '00-conflict-copy.json' && entry.kind === 'foreign'));
	check(inspection.entries.some(entry => entry.name === 'manifest (conflict copy).json' && entry.kind === 'alternate-manifest'));
	const alternateOnlyDescriptor = concurrentThird.manifest.shards.find((descriptor, index) => (
		descriptor.sha256 !== concurrentFourth.manifest.shards[index].sha256
	));
	check(alternateOnlyDescriptor);
	check(!inspection.protectedShardNames.includes(alternateOnlyDescriptor.path.slice('shards/'.length)));
	check(!adapter.operations.slice(inspectOperationStart).some(operation => operation.startsWith('readBinary:')));
	assert.deepEqual(adapter.files, beforeInspect);
	assertions++;

	const boundedPlan = await store.planCleanup({ nowMs: 31 * 24 * 60 * 60 * 1_000, maxFiles: 1 });
	equal(boundedPlan.suppressedReasons.length, 0);
	equal(boundedPlan.candidates.length, 1);
	equal(boundedPlan.candidates[0].kind, 'alternate-manifest');
	equal(boundedPlan.hasMoreCandidates, true);
	const staleManifest = concurrentThird.manifestPayload;
	adapter.setFile(paths.manifestPath, staleManifest, 1);
	const staleCleanup = await store.applyCleanup(boundedPlan);
	equal(staleCleanup.status, 'stale');
	equal(staleCleanup.deletedCount, 0);
	adapter.setFile(paths.manifestPath, concurrentFourth.manifestPayload, 2);
	equal((await store.load()).status, 'loaded');
	const alternateCleanupPlan = await store.planCleanup({ nowMs: 31 * 24 * 60 * 60 * 1_000 });
	equal(alternateCleanupPlan.candidates.length, 1);
	equal(alternateCleanupPlan.candidates[0].kind, 'alternate-manifest');
	const alternateCleanup = await store.applyCleanup(alternateCleanupPlan);
	equal(alternateCleanup.status, 'applied');
	equal(alternateCleanup.backlogRemaining, true);
	check(!adapter.files.has(`${paths.rootPath}/manifest (conflict copy).json`));
	const cleanupPlan = await store.planCleanup({ nowMs: 31 * 24 * 60 * 60 * 1_000 });
	equal(cleanupPlan.suppressedReasons.length, 0);
	check(cleanupPlan.candidates.length >= 3);
	check(cleanupPlan.candidates.some(candidate => candidate.name === alternateOnlyDescriptor.path.slice('shards/'.length)));
	const cleanup = await store.applyCleanup(cleanupPlan);
	equal(cleanup.status, 'applied');
	check(cleanup.deletedCount >= 3);
	check(!adapter.files.has(`${paths.shardsPath}/${orphanName}`));
	check(!adapter.files.has(`${paths.shardsPath}/${shardTempName}`));
	check(!adapter.files.has(`${paths.rootPath}/${manifestTempName}`));
	check(adapter.files.has(`${paths.shardsPath}/leftover.tmp-123`));
	check(adapter.files.has(`${paths.shardsPath}/00-conflict-copy.json`));
	check(!adapter.files.has(`${paths.rootPath}/manifest (conflict copy).json`));

	const fingerprintAdapter = new IndexV8MemoryAdapter();
	const fingerprintStore = new IndexV8Store(fingerprintAdapter.asDataAdapter(), paths);
	const fingerprintBase = await snapshot(95, '2026-01-02T04:00:00.000Z');
	const fingerprintCandidate = await changedSnapshot(fingerprintBase);
	await fingerprintStore.commit(fingerprintBase);
	const fingerprintOperationsStart = fingerprintAdapter.operations.length;
	await fingerprintStore.commitIncremental({
		expectedBaseSnapshotId: fingerprintBase.manifest.snapshotId,
		expectedBaseManifestPayload: fingerprintBase.manifestPayload,
		manifestPayload: fingerprintCandidate.manifestPayload,
		changedShardPayloads: changedShardPayloads(fingerprintBase, fingerprintCandidate),
	});
	check(!fingerprintAdapter.operations.slice(fingerprintOperationsStart).some(operation => operation.startsWith('readBinary:')));
	const fingerprintNext = await changedSnapshot(fingerprintCandidate);
	const nextChangedIds = new Set(changedShardPayloads(fingerprintCandidate, fingerprintNext).keys());
	const mutatedDescriptor = fingerprintCandidate.manifest.shards.find(descriptor => !nextChangedIds.has(descriptor.shardId));
	check(mutatedDescriptor);
	const mutatedPath = `${paths.shardsPath}/${mutatedDescriptor.shardId}-${mutatedDescriptor.sha256}.json`;
	const validPayload = fingerprintAdapter.files.get(mutatedPath)!;
	const invalidSameSizePayload = `${validPayload.slice(0, -1)} `;
	equal(new TextEncoder().encode(invalidSameSizePayload).byteLength, mutatedDescriptor.bytes);
	fingerprintAdapter.setFile(mutatedPath, invalidSameSizePayload, Date.now() + 1_000);
	await rejects(() => fingerprintStore.commitIncremental({
		expectedBaseSnapshotId: fingerprintCandidate.manifest.snapshotId,
		expectedBaseManifestPayload: fingerprintCandidate.manifestPayload,
		manifestPayload: fingerprintNext.manifestPayload,
		changedShardPayloads: changedShardPayloads(fingerprintCandidate, fingerprintNext),
	}), 'BASE_SNAPSHOT_CHANGED');
	check(fingerprintAdapter.operations.some(operation => operation === `readBinary:${mutatedPath}`));

	check(!adapter.operations.some(operation => operation.includes('/runtime/index.json')));
	const custom = buildOperonStoragePaths('.config-dir', 'custom-operon').runtime.indexV8;
	equal(custom.rootPath, '.config-dir/plugins/custom-operon/runtime/index-v8');
	equal(custom.manifestPath, '.config-dir/plugins/custom-operon/runtime/index-v8/manifest.json');
	equal(custom.shardsPath, '.config-dir/plugins/custom-operon/runtime/index-v8/shards');

	console.log(JSON.stringify({ ok: true, assertions }, null, 2));
}

declare global {
	var __operonIndexV8StoreTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8StoreTestRun = run();
