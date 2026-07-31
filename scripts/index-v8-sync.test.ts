import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { App } from 'obsidian';
import type { IndexData } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { OperonIndexer } from '../src/indexer/indexer';
import { buildIndexV8SemanticsSignature } from '../src/indexer/persistence/index-v8-semantics';
import { buildWorkflowStatusSemanticsSignature } from '../src/core/workflow-status-semantics';
import { startIndexV8CleanupMaintenance } from '../src/indexer/persistence/index-v8-maintenance-scheduler';
import { setOperonEnginePerfDebug } from '../src/core/engine-perf';
import {
	buildIndexV8Snapshot,
	getIndexV8CanonicalInstanceKeys,
	projectIndexDataToV8Sources,
	validateIndexV8Snapshot,
	type IndexV8SourceStat,
} from '../src/indexer/persistence/index-v8-codec';
import { getIndexV8ShardId } from '../src/indexer/persistence/index-v8-partition';
import {
	IndexV8StorageError,
	IndexV8Store,
} from '../src/indexer/persistence/index-v8-store';
import { IndexV8PersistenceCoordinator } from '../src/indexer/persistence/index-v8-persistence-coordinator';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { createSyntheticIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';

const BASE_TIME = '2026-01-02T03:04:05.000Z';
const DEVICE_A_TIME = '2026-01-02T03:05:05.000Z';
const DEVICE_B_TIME = '2026-01-02T03:06:05.000Z';
const SEMANTICS = 'sync-test-v1';
const paths = buildOperonStoragePaths('.obsidian', 'operon-sync-test').runtime.indexV8;
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

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.deepEqual(actual, expected);
	else assert.deepEqual(actual, expected, message);
	assertions++;
}

async function rejectsBaseChange(action: () => Promise<unknown>): Promise<void> {
	await assert.rejects(action, error => (
		error instanceof IndexV8StorageError && error.code === 'BASE_SNAPSHOT_CHANGED'
	));
	assertions++;
}

function sourceStats(data: Readonly<IndexData>): Map<string, IndexV8SourceStat> {
	return new Map(Object.values(data.taskInstances ?? {}).map(instance => [instance.primary.filePath, {
		mtimeMs: Date.parse(BASE_TIME),
		sizeBytes: Math.max(1, instance.primary.filePath.length * 32),
	}]));
}

async function snapshot(data: Readonly<IndexData>, committedAt: string) {
	return await buildIndexV8Snapshot({
		committedAt,
		lastFullScanAt: BASE_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: SEMANTICS,
		sources: projectIndexDataToV8Sources(data, sourceStats(data)),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
}

function mutateSource(data: IndexData, path: string, marker: string): void {
	for (const instance of Object.values(data.taskInstances ?? {})) {
		if (instance.primary.filePath !== path) continue;
		instance.description += marker;
		const canonical = data.tasks[instance.operonId];
		if (canonical) canonical.description = instance.description;
	}
}

function changedShardPayloads(
	base: Awaited<ReturnType<typeof snapshot>>,
	candidate: Awaited<ReturnType<typeof snapshot>>,
): Map<string, string> {
	const changed = new Map<string, string>();
	for (let index = 0; index < candidate.manifest.shards.length; index++) {
		const descriptor = candidate.manifest.shards[index];
		if (descriptor.sha256 === base.manifest.shards[index].sha256) continue;
		changed.set(descriptor.shardId, candidate.shardPayloads.get(descriptor.shardId)!);
	}
	return changed;
}

function findSourcePair(data: Readonly<IndexData>, sameShard: boolean): [string, string] {
	const paths = [...new Set(Object.values(data.taskInstances ?? {}).map(instance => instance.primary.filePath))];
	for (let left = 0; left < paths.length; left++) {
		for (let right = left + 1; right < paths.length; right++) {
			if ((getIndexV8ShardId(paths[left]) === getIndexV8ShardId(paths[right])) === sameShard) {
				return [paths[left], paths[right]];
			}
		}
	}
	throw new Error(`Synthetic fixture lacks a ${sameShard ? 'same' : 'cross'}-shard source pair`);
}

async function testTwoDevicesConvergeThroughCanonicalCas(sameShard: boolean): Promise<void> {
	const original = createSyntheticIndexData(1_024);
	const [deviceAPath, deviceBPath] = findSourcePair(original, sameShard);
	const base = await snapshot(structuredClone(original), BASE_TIME);
	const deviceAData = structuredClone(original);
	const deviceBData = structuredClone(original);
	mutateSource(deviceAData, deviceAPath, ' device-a');
	mutateSource(deviceBData, deviceBPath, ' device-b');
	const deviceA = await snapshot(deviceAData, DEVICE_A_TIME);
	const deviceB = await snapshot(deviceBData, DEVICE_B_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const firstStore = new IndexV8Store(adapter.asDataAdapter(), paths);
	const secondStore = new IndexV8Store(adapter.asDataAdapter(), paths);
	await firstStore.commit({ ...base, expectedBaseMissing: true });
	const winner = await firstStore.commit({
		...deviceA,
		expectedBaseSnapshotId: base.manifest.snapshotId,
		expectedBaseManifestPayload: base.manifestPayload,
	});
	equal(winner.snapshotId, deviceA.manifest.snapshotId);
	await rejectsBaseChange(() => secondStore.commit({
		...deviceB,
		expectedBaseSnapshotId: base.manifest.snapshotId,
		expectedBaseManifestPayload: base.manifestPayload,
	}));
	const loaded = await secondStore.load();
	check(loaded.status === 'loaded');
	if (loaded.status === 'loaded') equal(loaded.manifest.snapshotId, deviceA.manifest.snapshotId);
}

async function testManifestActivationRacePreservesRemoteWinner(): Promise<void> {
	const data = createSyntheticIndexData(256);
	const base = await snapshot(structuredClone(data), BASE_TIME);
	const localData = structuredClone(data);
	const remoteData = structuredClone(data);
	const [localPath, remotePath] = findSourcePair(data, false);
	mutateSource(localData, localPath, ' local');
	mutateSource(remoteData, remotePath, ' remote');
	const local = await snapshot(localData, DEVICE_A_TIME);
	const remote = await snapshot(remoteData, DEVICE_B_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit({ ...base, expectedBaseMissing: true });
	let raced = false;
	adapter.beforeProcess = path => {
		if (raced || path !== paths.manifestPath) return;
		raced = true;
		for (const descriptor of remote.manifest.shards) {
			adapter.setFile(
				`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
				remote.shardPayloads.get(descriptor.shardId)!,
			);
		}
		adapter.setFile(paths.manifestPath, remote.manifestPayload);
	};
	await rejectsBaseChange(() => store.commit({
		...local,
		expectedBaseSnapshotId: base.manifest.snapshotId,
		expectedBaseManifestPayload: base.manifestPayload,
	}));
	adapter.beforeProcess = null;
	equal(adapter.files.get(paths.manifestPath), remote.manifestPayload);
	const loaded = await store.load();
	check(loaded.status === 'loaded');
	if (loaded.status === 'loaded') equal(loaded.manifest.snapshotId, remote.manifest.snapshotId);
}

async function testIncompleteSnapshotProgression(): Promise<void> {
	const built = await snapshot(createSyntheticIndexData(128), BASE_TIME);
	const adapter = new IndexV8MemoryAdapter();
	adapter.folders.add(paths.rootPath);
	adapter.folders.add(paths.shardsPath);
	adapter.setFile(paths.manifestPath, built.manifestPayload);
	const install = (count: number): void => {
		for (const descriptor of built.manifest.shards.slice(0, count)) {
			adapter.setFile(
				`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
				built.shardPayloads.get(descriptor.shardId)!,
			);
		}
	};
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	install(1);
	const one = await store.load();
	check(one.status === 'incomplete');
	if (one.status === 'incomplete') equal(one.missingShardIds.length, 31);
	install(31);
	const thirtyOne = await store.load();
	check(thirtyOne.status === 'incomplete');
	if (thirtyOne.status === 'incomplete') equal(thirtyOne.missingShardIds.length, 1);
	install(32);
	const complete = await store.load();
	check(complete.status === 'loaded');
	if (complete.status === 'loaded') equal(complete.manifest.snapshotId, built.manifest.snapshotId);
}

async function testConflictCopyNeverBecomesAuthority(): Promise<void> {
	const canonical = await snapshot(createSyntheticIndexData(64), BASE_TIME);
	const conflict = await snapshot(createSyntheticIndexData(65), DEVICE_B_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit({ ...canonical, expectedBaseMissing: true });
	adapter.setFile(`${paths.rootPath}/manifest (conflict copy).json`, conflict.manifestPayload);
	const loaded = await store.load();
	check(loaded.status === 'loaded');
	if (loaded.status === 'loaded') equal(loaded.manifest.snapshotId, canonical.manifest.snapshotId);
	equal(adapter.files.get(paths.manifestPath), canonical.manifestPayload);
}

async function testTelemetryDoesNotExposeTaskContent(): Promise<void> {
	const data = createSyntheticIndexData(32);
	const first = Object.values(data.taskInstances ?? {})[0];
	check(first);
	first.description = 'SYNC-SECRET-DESCRIPTION';
	const built = await snapshot(data, BASE_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	const lines: string[] = [];
	const originalDebug = console.debug;
	console.debug = (...args: unknown[]) => { lines.push(args.join(' ')); };
	try {
		setOperonEnginePerfDebug(true);
		await store.commit({ ...built, expectedBaseMissing: true });
	} finally {
		setOperonEnginePerfDebug(false);
		console.debug = originalDebug;
	}
	check(lines.some(line => line.includes('index.v8.storage.commit')));
	check(lines.every(line => !line.includes(first.operonId)));
	check(lines.every(line => !line.includes(first.description)));
	check(lines.every(line => !line.includes(first.primary.filePath)));
}

async function testMetadataInventoryAndCleanupSafety(): Promise<void> {
	const now = Date.now();
	const day = 24 * 60 * 60 * 1_000;
	const active = await snapshot(createSyntheticIndexData(96), BASE_TIME);
	const alternate = await snapshot(createSyntheticIndexData(97), DEVICE_B_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit({ ...active, expectedBaseMissing: true });
	const protectedDescriptor = alternate.manifest.shards.find(descriptor => (
		!active.manifest.shards.some(activeDescriptor => activeDescriptor.sha256 === descriptor.sha256)
	));
	check(protectedDescriptor);
	const protectedName = `${protectedDescriptor.shardId}-${protectedDescriptor.sha256}.json`;
	adapter.setFile(
		`${paths.shardsPath}/${protectedName}`,
		alternate.shardPayloads.get(protectedDescriptor.shardId)!,
		now - 40 * day,
	);
	adapter.setFile(`${paths.rootPath}/manifest (conflict copy).json`, alternate.manifestPayload, now);
	const oldOrphanName = `00-${'a'.repeat(64)}.json`;
	const youngOrphanName = `01-${'b'.repeat(64)}.json`;
	const oldTempName = `manifest.json.tmp-${now - 25 * 60 * 60 * 1_000}-abcdef`;
	const rootShardTempName = `00-${'c'.repeat(64)}.json.tmp-${now - 25 * 60 * 60 * 1_000}-abcdef`;
	const shardManifestTempName = `manifest.json.tmp-${now - 25 * 60 * 60 * 1_000}-ghijkl`;
	adapter.setFile(`${paths.shardsPath}/${oldOrphanName}`, '{}', now - 31 * day);
	adapter.setFile(`${paths.shardsPath}/${youngOrphanName}`, '{}', now - 29 * day);
	adapter.setFile(`${paths.rootPath}/${oldTempName}`, 'temporary', now - 25 * 60 * 60 * 1_000);
	adapter.setFile(`${paths.rootPath}/${rootShardTempName}`, 'wrong-directory', now - 25 * 60 * 60 * 1_000);
	adapter.setFile(`${paths.shardsPath}/${shardManifestTempName}`, 'wrong-directory', now - 25 * 60 * 60 * 1_000);
	adapter.setFile(`${paths.rootPath}/manifest.json.tmp-user-copy`, 'foreign', now - 40 * day);
	adapter.setFile(`${paths.rootPath}/manifest-notes.json`, 'foreign', now - 40 * day);
	const operationStart = adapter.operations.length;
	const inspection = await store.inspect();
	const inventoryOperations = adapter.operations.slice(operationStart);
	equal(inspection.manifestStatus, 'loaded');
	check(!inspection.protectedShardNames.includes(protectedName));
	equal(inspection.entries.find(entry => entry.name === oldOrphanName)?.kind, 'orphan-shard');
	equal(inspection.entries.find(entry => entry.name === oldTempName)?.kind, 'owned-temp');
	equal(inspection.entries.find(entry => entry.path.endsWith(rootShardTempName))?.kind, 'foreign');
	equal(inspection.entries.find(entry => entry.path.endsWith(shardManifestTempName))?.kind, 'foreign');
	equal(inspection.entries.find(entry => entry.name === 'manifest.json.tmp-user-copy')?.kind, 'foreign');
	equal(inspection.entries.find(entry => entry.name === 'manifest-notes.json')?.kind, 'foreign');
	check(inventoryOperations.every(operation => !operation.startsWith('readBinary:')), 'inventory must not read shard payloads');
	check(inventoryOperations.every(operation => (
		!operation.startsWith(`read:${paths.shardsPath}/`)
	)), 'inventory must remain metadata-only for shards');

	const plan = await store.planCleanup({ nowMs: now });
	equal(plan.suppressedReasons.length, 0);
	equal(plan.candidates.length, 1);
	equal(plan.candidates[0].kind, 'alternate-manifest');
	const result = await store.applyCleanup(plan);
	equal(result.status, 'applied');
	equal(result.deletedCount, 1);
	equal(result.backlogRemaining, true);
	const orphanPlan = await store.planCleanup({ nowMs: now });
	check(orphanPlan.candidates.some(candidate => candidate.name === oldOrphanName));
	check(orphanPlan.candidates.some(candidate => candidate.name === oldTempName));
	check(orphanPlan.candidates.some(candidate => candidate.name === youngOrphanName));
	check(orphanPlan.candidates.some(candidate => candidate.name === protectedName));
	const orphanResult = await store.applyCleanup(orphanPlan);
	equal(orphanResult.status, 'applied');
	equal(orphanResult.deletedCount, 4);
	check(!adapter.files.has(`${paths.shardsPath}/${youngOrphanName}`));
	check(!adapter.files.has(`${paths.shardsPath}/${protectedName}`));
	check(adapter.files.has(`${paths.rootPath}/manifest.json.tmp-user-copy`));
	check(adapter.files.has(`${paths.rootPath}/manifest-notes.json`));
	check(adapter.files.has(`${paths.rootPath}/${rootShardTempName}`));
	check(adapter.files.has(`${paths.shardsPath}/${shardManifestTempName}`));
}

async function testCleanupPlanSealingAndBudgets(): Promise<void> {
	const now = Date.now();
	const active = await snapshot(createSyntheticIndexData(80), BASE_TIME);
	const remote = await snapshot(createSyntheticIndexData(81), DEVICE_B_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit({ ...active, expectedBaseMissing: true });
	for (let index = 0; index < 40; index++) {
		const shardId = (index % 32).toString(16).padStart(2, '0');
		adapter.setFile(
			`${paths.shardsPath}/${shardId}-${index.toString(16).padStart(64, '0')}.json`,
			'x'.repeat(1_000_000),
			now - 40 * 24 * 60 * 60 * 1_000 - index,
		);
	}
	const bounded = await store.planCleanup({ nowMs: now });
	check(bounded.candidates.length <= 32);
	check(bounded.candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0) <= 16_000_000);
	const sealedCandidateNames = bounded.candidates.map(candidate => candidate.name);
	bounded.candidates.push({
		name: `00-${'f'.repeat(64)}.json`,
		kind: 'orphan-shard',
		path: `${paths.shardsPath}/00-${'f'.repeat(64)}.json`,
		sizeBytes: 1,
		mtimeMs: 0,
	});
	for (const descriptor of remote.manifest.shards) {
		adapter.setFile(
			`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
			remote.shardPayloads.get(descriptor.shardId)!,
		);
	}
	adapter.setFile(paths.manifestPath, remote.manifestPayload);
	const stale = await store.applyCleanup(bounded);
	equal(stale.status, 'stale');
	equal(stale.deletedCount, 0);
	check(sealedCandidateNames.every(name => adapter.files.has(`${paths.shardsPath}/${name}`)));

	const oversizedAdapter = new IndexV8MemoryAdapter();
	const oversizedStore = new IndexV8Store(oversizedAdapter.asDataAdapter(), paths);
	await oversizedStore.commit({ ...active, expectedBaseMissing: true });
	oversizedAdapter.setFile(`${paths.rootPath}/manifest (conflict oversized).json`, 'x'.repeat(16_000_001), 0);
	const progressName = `00-${'c'.repeat(64)}.json`;
	oversizedAdapter.setFile(`${paths.shardsPath}/${progressName}`, '{}', 0);
	const oversizedPlan = await oversizedStore.planCleanup({ nowMs: now });
	equal(oversizedPlan.candidates.length, 1);
	equal(oversizedPlan.candidates[0].name, 'manifest (conflict oversized).json');
	equal(oversizedPlan.hasMoreCandidates, true);
	equal((await oversizedStore.applyCleanup(oversizedPlan)).status, 'applied');
	const postOversizedPlan = await oversizedStore.planCleanup({ nowMs: now });
	equal(postOversizedPlan.candidates[0]?.name, progressName, 'oversized alternate removal must advance to owned files');
}

async function testCleanupSuppressionAndPartialStop(): Promise<void> {
	const now = Date.now();
	const active = await snapshot(createSyntheticIndexData(72), BASE_TIME);
	const remote = await snapshot(createSyntheticIndexData(73), DEVICE_B_TIME);
	const suppressedAdapter = new IndexV8MemoryAdapter();
	const suppressedStore = new IndexV8Store(suppressedAdapter.asDataAdapter(), paths);
	await suppressedStore.commit({ ...active, expectedBaseMissing: true });
	suppressedAdapter.setFile(`${paths.shardsPath}/00-${'d'.repeat(64)}.json`, '{}', 0);
	suppressedAdapter.setFile(`${paths.rootPath}/manifest (conflict invalid).json`, '{invalid', 0);
	const suppressedPlan = await suppressedStore.planCleanup({ nowMs: now });
	equal(suppressedPlan.suppressedReasons.length, 0);
	equal(suppressedPlan.candidates.length, 1);
	equal(suppressedPlan.candidates[0].kind, 'alternate-manifest');
	const suppressedResult = await suppressedStore.applyCleanup(suppressedPlan);
	equal(suppressedResult.status, 'applied');
	check(suppressedAdapter.files.has(`${paths.shardsPath}/00-${'d'.repeat(64)}.json`));

	const partialAdapter = new IndexV8MemoryAdapter();
	const partialStore = new IndexV8Store(partialAdapter.asDataAdapter(), paths);
	await partialStore.commit({ ...active, expectedBaseMissing: true });
	const activeShardNames = new Set(active.manifest.shards.map(descriptor => descriptor.path.slice('shards/'.length)));
	const remoteOnlyDescriptor = remote.manifest.shards.find(descriptor => !activeShardNames.has(descriptor.path.slice('shards/'.length)));
	check(remoteOnlyDescriptor);
	const remoteOnlyPath = `${paths.rootPath}/${remoteOnlyDescriptor.path}`;
	partialAdapter.setFile(remoteOnlyPath, remote.shardPayloads.get(remoteOnlyDescriptor.shardId)!, 0);
	const partialPlan = await partialStore.planCleanup({ nowMs: now });
	equal(partialPlan.candidates.length, 1);
	let manifestChanged = false;
	partialAdapter.failOperation = (operation, path) => {
		if (!manifestChanged && operation === 'remove' && path.includes('.cleanup-')) {
			manifestChanged = true;
			partialAdapter.setFile(paths.manifestPath, remote.manifestPayload);
		}
		return false;
	};
	const partialResult = await partialStore.applyCleanup(partialPlan);
	partialAdapter.failOperation = null;
	equal(partialResult.status, 'stale');
	equal(partialResult.deletedCount, 0);
	equal(partialResult.skippedCount, 1);
	check(partialAdapter.files.has(remoteOnlyPath), 'a shard activated during removal must be restored');

	const backupRaceAdapter = new IndexV8MemoryAdapter();
	const backupRaceStore = new IndexV8Store(backupRaceAdapter.asDataAdapter(), paths);
	await backupRaceStore.commit({ ...active, expectedBaseMissing: true });
	backupRaceAdapter.setFile(remoteOnlyPath, remote.shardPayloads.get(remoteOnlyDescriptor.shardId)!, 0);
	const backupRacePlan = await backupRaceStore.planCleanup({ nowMs: now });
	let changedDuringBackupDelete = false;
	backupRaceAdapter.failOperation = (operation, path) => {
		if (!changedDuringBackupDelete && operation === 'remove' && path.includes('.json.tmp-')) {
			changedDuringBackupDelete = true;
			backupRaceAdapter.setFile(paths.manifestPath, remote.manifestPayload);
		}
		return false;
	};
	const backupRaceResult = await backupRaceStore.applyCleanup(backupRacePlan);
	backupRaceAdapter.failOperation = null;
	equal(backupRaceResult.status, 'stale');
	equal(backupRaceResult.deletedCount, 0);
	check(backupRaceAdapter.files.has(remoteOnlyPath), 'a shard activated during backup deletion must be restored from memory');

	const unloadRaceAdapter = new IndexV8MemoryAdapter();
	const unloadRaceStore = new IndexV8Store(unloadRaceAdapter.asDataAdapter(), paths);
	await unloadRaceStore.commit({ ...active, expectedBaseMissing: true });
	const unloadRaceName = `00-${'6'.repeat(64)}.json`;
	const unloadRacePath = `${paths.shardsPath}/${unloadRaceName}`;
	unloadRaceAdapter.setFile(unloadRacePath, '{}', 0);
	const unloadRacePlan = await unloadRaceStore.planCleanup({ nowMs: now });
	let cleanupActive = true;
	unloadRaceAdapter.afterRead = path => {
		if (path === paths.manifestPath) cleanupActive = false;
	};
	const unloadRaceResult = await unloadRaceStore.applyCleanup(unloadRacePlan, () => cleanupActive);
	unloadRaceAdapter.afterRead = null;
	equal(unloadRaceResult.status, 'stale');
	check(unloadRaceAdapter.files.has(unloadRacePath), 'unload during authority validation must prevent a new claim');

	const preRemoveRaceAdapter = new IndexV8MemoryAdapter();
	const preRemoveRaceStore = new IndexV8Store(preRemoveRaceAdapter.asDataAdapter(), paths);
	await preRemoveRaceStore.commit({ ...active, expectedBaseMissing: true });
	const raceName = `00-${'9'.repeat(64)}.json`;
	const racePath = `${paths.shardsPath}/${raceName}`;
	preRemoveRaceAdapter.setFile(racePath, '{}', 0);
	const racePlan = await preRemoveRaceStore.planCleanup({ nowMs: now });
	let changedBeforeRemove = false;
	preRemoveRaceAdapter.failOperation = (operation, path) => {
		if (!changedBeforeRemove && operation === 'stat' && path === racePath) {
			changedBeforeRemove = true;
			preRemoveRaceAdapter.setFile(paths.manifestPath, remote.manifestPayload);
		}
		return false;
	};
	const raceResult = await preRemoveRaceStore.applyCleanup(racePlan);
	preRemoveRaceAdapter.failOperation = null;
	equal(raceResult.status, 'stale');
	equal(raceResult.deletedCount, 0);
	check(preRemoveRaceAdapter.files.has(racePath), 'a shard activated during validation must not be removed');

	const validationFailureAdapter = new IndexV8MemoryAdapter();
	const validationFailureStore = new IndexV8Store(validationFailureAdapter.asDataAdapter(), paths);
	await validationFailureStore.commit({ ...active, expectedBaseMissing: true });
	const failureNames = ['7', '8'].map(suffix => `00-${suffix.repeat(64)}.json`);
	for (const name of failureNames) validationFailureAdapter.setFile(`${paths.shardsPath}/${name}`, '{}', 0);
	const validationFailurePlan = await validationFailureStore.planCleanup({ nowMs: now });
	validationFailureAdapter.failOperation = (operation, path) => (
		operation === 'stat' && path.endsWith(failureNames[1])
	);
	const validationFailureResult = await validationFailureStore.applyCleanup(validationFailurePlan);
	validationFailureAdapter.failOperation = null;
	equal(validationFailureResult.status, 'partial');
	equal(validationFailureResult.deletedCount, 1);
	equal(validationFailureResult.skippedCount, 1);
	check(validationFailureResult.errorCodes.includes('CLEANUP_IO_FAILED'));
}

async function testReusedShardFingerprintCache(): Promise<void> {
	const original = createSyntheticIndexData(512);
	const [changedPath] = findSourcePair(original, false);
	const base = await snapshot(structuredClone(original), BASE_TIME);
	const firstData = structuredClone(original);
	mutateSource(firstData, changedPath, ' first');
	const first = await snapshot(firstData, DEVICE_A_TIME);
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit({ ...base, expectedBaseMissing: true });
	const operationStart = adapter.operations.length;
	await store.commitIncremental({
		expectedBaseSnapshotId: base.manifest.snapshotId,
		expectedBaseManifestPayload: base.manifestPayload,
		manifestPayload: first.manifestPayload,
		changedShardPayloads: changedShardPayloads(base, first),
	});
	const normalReuseOperations = adapter.operations.slice(operationStart);
	equal(normalReuseOperations.filter(operation => operation.startsWith('readBinary:')).length, 0);

	const secondData = structuredClone(firstData);
	mutateSource(secondData, changedPath, ' second');
	const second = await snapshot(secondData, DEVICE_B_TIME);
	const secondChanges = changedShardPayloads(first, second);
	const reused = first.manifest.shards.find(descriptor => !secondChanges.has(descriptor.shardId));
	check(reused);
	const reusedPath = `${paths.shardsPath}/${reused.shardId}-${reused.sha256}.json`;
	const payload = adapter.files.get(reusedPath);
	check(payload);
	const corrupted = `${payload.slice(0, -1)}${payload.endsWith('}') ? ']' : '}'}`;
	equal(corrupted.length, payload.length);
	adapter.setFile(reusedPath, corrupted, (adapter.mtimes.get(reusedPath) ?? 0) + 1);
	const fingerprintOperationStart = adapter.operations.length;
	await rejectsBaseChange(() => store.commitIncremental({
		expectedBaseSnapshotId: first.manifest.snapshotId,
		expectedBaseManifestPayload: first.manifestPayload,
		manifestPayload: second.manifestPayload,
		changedShardPayloads: secondChanges,
	}));
	check(adapter.operations.slice(fingerprintOperationStart).some(operation => operation === `readBinary:${reusedPath}`));
	equal(adapter.files.get(paths.manifestPath), first.manifestPayload);
}

function testCoordinatorRuntimePhases(): void {
	const coordinator = new IndexV8PersistenceCoordinator({
		commit: async () => { throw new Error('not used'); },
	}, {
		scheduler: {
			now: () => 0,
			setTimeout: () => 0,
			clearTimeout: () => {},
			delay: async () => {},
		},
	});
	equal(coordinator.getRuntimePhase(), 'idle');
	coordinator.setRuntimePhase('sync-settling');
	equal(coordinator.getRuntimePhase(), 'sync-settling');
	coordinator.setRuntimePhase('rebasing');
	equal(coordinator.getRuntimePhase(), 'rebasing');
	coordinator.setRuntimePhase('recovery-required');
	equal(coordinator.getRuntimePhase(), 'recovery-required');
	coordinator.setRuntimePhase('idle');
	equal(coordinator.getRuntimePhase(), 'recovery-required', 'recovery-required mode must be terminal for the session');
}

async function testBoundedSettleAndVerifiedPersistence(): Promise<void> {
	const stable = await snapshot(createSyntheticIndexData(8), BASE_TIME);
	const loaded = {
		status: 'loaded' as const,
		manifest: stable.manifest,
		manifestPayload: stable.manifestPayload,
		shards: stable.shards,
		validatedSnapshot: await validateIndexV8Snapshot(stable.manifestPayload, stable.shardPayloads),
		metrics: { manifestBytes: 1, shardBytes: 1, shardsRead: 32, totalMs: 1 },
	};
	const results = [
		{ status: 'incomplete' as const, retryable: true as const, snapshotId: stable.manifest.snapshotId, manifest: stable.manifest, manifestPayload: stable.manifestPayload, missingShardIds: ['00' as const], metrics: loaded.metrics },
		{ status: 'incomplete' as const, retryable: true as const, snapshotId: stable.manifest.snapshotId, manifest: stable.manifest, manifestPayload: stable.manifestPayload, missingShardIds: ['00' as const], metrics: loaded.metrics },
		{ status: 'incomplete' as const, retryable: true as const, snapshotId: stable.manifest.snapshotId, manifest: stable.manifest, manifestPayload: stable.manifestPayload, missingShardIds: ['00' as const], metrics: loaded.metrics },
		loaded,
		loaded,
	];
	let loadIndex = 0;
	const store = { load: async () => results[Math.min(loadIndex++, results.length - 1)] };
	let phase: 'idle' | 'sync-settling' | 'rebasing' | 'recovery-required' = 'idle';
	let primaryPersists = 0;
	const persistence = {
		getRuntimePhase: () => phase,
		setRuntimePhase: (next: typeof phase) => { phase = next; },
		isVerifiedBaseline: () => false,
		adoptVerifiedBaseline: () => {},
		persistPrimary: async (input: { sequence: number; committedAt: string }) => {
			primaryPersists += 1;
			return {
				status: 'committed' as const,
				mode: 'full' as const,
				sequence: input.sequence,
				snapshotId: `rebase-${input.sequence}`,
				committedAt: input.committedAt,
				dirtyShardCount: 32,
				shardsWritten: 32,
				shardsReused: 0,
				bytesWritten: 1,
			};
		},
		drain: async () => {},
		disable: () => {},
	};
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
	};
	const app = {
		vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
		metadataCache: { getFileCache: () => null },
	} as unknown as App;
	let now = 10_000;
	const delays: number[] = [];
	let indexer!: OperonIndexer;
	const recoveryDirtyBatches: Array<{ paths: string[]; ids: string[] }> = [];
	persistence.persistPrimary = async (input: { sequence: number; committedAt: string }, dirty?: { dirtySourcePaths: ReadonlySet<string>; affectedOperonIds: ReadonlySet<string> }) => {
		primaryPersists += 1;
		if (dirty) recoveryDirtyBatches.push({ paths: [...dirty.dirtySourcePaths].sort(), ids: [...dirty.affectedOperonIds].sort() });
		return {
			status: 'committed' as const, mode: 'full' as const, sequence: input.sequence,
			snapshotId: `rebase-${input.sequence}`, committedAt: input.committedAt,
			dirtyShardCount: 32, shardsWritten: 32, shardsReused: 0, bytesWritten: 1,
		};
	};
	indexer = new OperonIndexer(
		app,
		storage as never,
		persistence as never,
		store as never,
		{
			now: () => now,
			delay: async delayMs => {
				delays.push(delayMs);
				now += delayMs;
				if (delays.length <= 2) {
					await (indexer as unknown as { persistIndex(options: object): Promise<void> }).persistIndex({
						dirtySourcePaths: [`Recovery-${delays.length}.md`],
						affectedOperonIds: [`recovery-${delays.length}`],
					});
				}
			},
		},
	);
	const recoveryMutable = indexer as unknown as {
		coherentWorkflowStatusSemanticsSignature: string;
		coherentIndexV8SemanticsSignature: string;
		coherenceBasis: 'unverified' | 'verified-full-scan';
		lastFullScanAt: string;
	};
	recoveryMutable.coherentWorkflowStatusSemanticsSignature = createSyntheticIndexData(1).workflowStatusSemanticsSignature;
	recoveryMutable.coherentIndexV8SemanticsSignature = buildIndexV8SemanticsSignature(DEFAULT_SETTINGS);
	recoveryMutable.coherenceBasis = 'verified-full-scan';
	recoveryMutable.lastFullScanAt = BASE_TIME;
	await indexer.observeIndexV8ManifestChange();
	deepEqual(delays, [1_000, 3_000, 7_000, 3_000]);
	equal(indexer.getIndexV8RuntimePhase(), 'idle');
	check(primaryPersists >= 1, 'stable settle must rebase current Markdown authority');
	check(recoveryDirtyBatches.some(batch => (
		batch.paths.includes('Recovery-1.md')
		&& batch.paths.includes('Recovery-2.md')
		&& batch.ids.includes('recovery-1')
		&& batch.ids.includes('recovery-2')
	)), 'recovery rebase must union changes received while settling');
}

async function testSecondCasLossWritesOneRecoveryMarker(): Promise<void> {
	const stable = await snapshot(createSyntheticIndexData(8), BASE_TIME);
	const loaded = {
		status: 'loaded' as const,
		manifest: stable.manifest,
		manifestPayload: stable.manifestPayload,
		shards: stable.shards,
		validatedSnapshot: await validateIndexV8Snapshot(stable.manifestPayload, stable.shardPayloads),
		metrics: { manifestBytes: 1, shardBytes: 1, shardsRead: 32, totalMs: 1 },
	};
	let phase: 'idle' | 'sync-settling' | 'rebasing' | 'recovery-required' = 'idle';
	let casLosses = 0;
	const persistence = {
		getRuntimePhase: () => phase,
		setRuntimePhase: (next: typeof phase) => { phase = next; },
		isVerifiedBaseline: () => false,
		adoptVerifiedBaseline: () => {},
		persistPrimary: async () => {
			casLosses += 1;
			throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'fixture second CAS loss');
		},
		disable: () => {},
	};
	const emergencyWrites: IndexData[] = [];
	let recoveryMarkerWrites = 0;
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
		loadIndex: async () => null,
		saveIndex: async (data: IndexData) => {
			emergencyWrites.push(structuredClone(data));
			return { jsonBytes: 1, stringifyMs: 0, writeMs: 0, queueWaitMs: 0, totalMs: 0 };
		},
		markIndexV8RecoveryRequired: async () => { recoveryMarkerWrites += 1; },
	};
	const app = {
		vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
		metadataCache: { getFileCache: () => null },
	} as unknown as App;
	let now = 10_000;
	const indexer = new OperonIndexer(
		app,
		storage as never,
		persistence as never,
		{ load: async () => loaded } as never,
		{ now: () => now, delay: async delayMs => { now += delayMs; } },
	);
	await indexer.observeIndexV8ManifestChange();
	equal(casLosses, 2, 'recovery must stop after the second CAS loss');
	equal(indexer.getIndexV8RuntimePhase(), 'recovery-required');
	equal(emergencyWrites.length, 0, 'second CAS loss must not write an emergency cache snapshot');
	equal(recoveryMarkerWrites, 1, 'second CAS loss must seal one durable recovery marker');
}

async function testPreCoherentRecoveryAndUnloadCasAreFailSafe(): Promise<void> {
	let phase: 'idle' | 'sync-settling' | 'rebasing' | 'recovery-required' = 'idle';
	let loadCount = 0;
	const metrics = { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 };
	const store = {
		load: async () => loadCount++ === 0
			? { status: 'incomplete' as const, retryable: true as const, snapshotId: 'fixture', manifest: null, manifestPayload: '', missingShardIds: ['00' as const], metrics }
			: { status: 'invalid' as const, retryable: false as const, code: 'INVALID_SNAPSHOT' as const, metrics },
	};
	const persistence = {
		getRuntimePhase: () => phase,
		setRuntimePhase: (next: typeof phase) => { phase = next; },
		disable: () => {},
		drain: async () => {},
	};
	const storage = { getSettings: () => DEFAULT_SETTINGS };
	const app = {
		vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
		metadataCache: { getFileCache: () => null },
	} as unknown as App;
	const preCoherent = new OperonIndexer(
		app,
		storage as never,
		persistence as never,
		store as never,
		{ now: () => 0, delay: async () => {} },
	);
	await preCoherent.observeIndexV8ManifestChange();
	equal(preCoherent.getIndexV8RuntimePhase(), 'idle', 'pre-coherent recovery failure must release sync-settling');

	phase = 'idle';
	let markerWrites = 0;
	const unloadPersistence = {
		...persistence,
		persistPrimary: async () => { throw new IndexV8StorageError('BASE_SNAPSHOT_CHANGED', 'unload CAS fixture'); },
	};
	const unloadStorage = {
		getSettings: () => DEFAULT_SETTINGS,
		markIndexV8RecoveryRequired: async () => {
			markerWrites += 1;
			throw new Error('fixture marker write failure');
		},
	};
	const unloadIndexer = new OperonIndexer(app, unloadStorage as never, unloadPersistence as never, store as never);
	const unloadMutable = unloadIndexer as unknown as {
		coherentWorkflowStatusSemanticsSignature: string;
		coherentIndexV8SemanticsSignature: string;
		coherenceBasis: 'unverified' | 'verified-full-scan';
		lastFullScanAt: string;
		persistIndex(options?: object): Promise<void>;
		pendingPersistData: unknown;
	};
	unloadMutable.coherentWorkflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(DEFAULT_SETTINGS.pipelines);
	unloadMutable.coherentIndexV8SemanticsSignature = buildIndexV8SemanticsSignature(DEFAULT_SETTINGS);
	unloadMutable.coherenceBasis = 'verified-full-scan';
	unloadMutable.lastFullScanAt = BASE_TIME;
	await unloadMutable.persistIndex({ dirtySourcePaths: ['Unload.md'] });
	await unloadIndexer.prepareForUnload();
	equal(markerWrites, 1);
	equal(unloadIndexer.getIndexV8RuntimePhase(), 'recovery-required', 'marker I/O failure must still seal the session terminal');
	equal(unloadMutable.pendingPersistData, null, 'unload must consume the pending snapshot');
}

async function testProductionCleanupIsBackgroundAndUnloadSafe(): Promise<void> {
	const callbacks = new Map<number, () => void>();
	const delays: number[] = [];
	const cleared: number[] = [];
	let nextHandle = 1;
	let runs = 0;
	const maintenance = startIndexV8CleanupMaintenance({
		run: async () => ++runs > 1 ? 'complete' : 'backlog',
		isActive: () => true,
		setTimeout: (callback, delayMs) => {
			const handle = nextHandle++;
			callbacks.set(handle, callback);
			delays.push(delayMs);
			return handle;
		},
		clearTimeout: handle => {
			cleared.push(handle);
			callbacks.delete(handle);
		},
		onError: error => { throw error; },
	});
	deepEqual(delays, [30_000]);
	callbacks.get(1)?.();
	await Promise.resolve();
	await Promise.resolve();
	deepEqual(delays, [30_000, 250]);
	callbacks.get(2)?.();
	await Promise.resolve();
	await Promise.resolve();
	equal(runs, 2);
	equal(callbacks.size, 2, 'executed timer records remain test-owned but no third timer is scheduled');
	maintenance.cancel();
	await maintenance.drain();

	const activityCallbacks = new Map<number, () => void>();
	const activityDelays: number[] = [];
	let activityHandle = 200;
	let activityRuns = 0;
	let activityMaintenance!: ReturnType<typeof startIndexV8CleanupMaintenance<number>>;
	activityMaintenance = startIndexV8CleanupMaintenance({
		run: async () => {
			activityRuns += 1;
			activityMaintenance.request();
			return 'backlog';
		},
		isActive: () => true,
		setTimeout: (callback, delayMs) => {
			const handle = activityHandle++;
			activityCallbacks.set(handle, callback);
			activityDelays.push(delayMs);
			return handle;
		},
		clearTimeout: handle => { activityCallbacks.delete(handle); },
		onError: error => { throw error; },
	});
	activityCallbacks.get(200)?.();
	await Promise.resolve();
	await Promise.resolve();
	deepEqual(activityDelays, [30_000, 30_000], 'activity during cleanup must restart quiet time before another batch');
	equal(activityRuns, 1);
	activityMaintenance.cancel();
	await activityMaintenance.drain();

	const cancelCallbacks = new Map<number, () => void>();
	const cancelBeforeRun = startIndexV8CleanupMaintenance({
		run: async () => 'complete',
		isActive: () => true,
		setTimeout: callback => {
			cancelCallbacks.set(99, callback);
			return 99;
		},
		clearTimeout: handle => {
			cleared.push(handle);
			cancelCallbacks.delete(handle);
		},
		onError: error => { throw error; },
	});
	cancelBeforeRun.cancel();
	await cancelBeforeRun.drain();
	check(cleared.includes(99));
	equal(cancelCallbacks.size, 0);

	let resolveActive!: () => void;
	const activeCallbacks = new Map<number, () => void>();
	const activeMaintenance = startIndexV8CleanupMaintenance({
		run: async () => {
			await new Promise<void>(resolve => { resolveActive = resolve; });
			return 'complete';
		},
		isActive: () => true,
		setTimeout: callback => {
			activeCallbacks.set(101, callback);
			return 101;
		},
		clearTimeout: handle => { activeCallbacks.delete(handle); },
		onError: error => { throw error; },
	});
	activeCallbacks.get(101)?.();
	activeMaintenance.cancel();
	let drained = false;
	const draining = activeMaintenance.drain().then(() => { drained = true; });
	await Promise.resolve();
	equal(drained, false, 'unload drain must wait for an in-flight cleanup');
	resolveActive();
	await draining;
	equal(drained, true);

	const mainSource = await readFile('main.ts', 'utf8');
	check(mainSource.includes('startIndexV8CleanupMaintenance({'));
	check(mainSource.includes('run: () => this.indexer.runIndexV8CleanupMaintenance()'));
	const indexerSource = await readFile('src/indexer/indexer.ts', 'utf8');
	check(indexerSource.includes("'index.v8.cleanup'"));
	check(mainSource.includes('await this.indexV8CleanupMaintenance?.drain();'));
	check(mainSource.includes('this.indexer.onIndexV8Persisted = () =>'));
	check(mainSource.indexOf('this.indexV8CleanupMaintenance?.cancel();')
		< mainSource.indexOf('await this.externalCalendarService?.destroy();'));
	const schedulerSource = await readFile('src/indexer/persistence/index-v8-maintenance-scheduler.ts', 'utf8');
	check(schedulerSource.includes('const MAX_BATCHES_PER_ACTIVATION = 8;'));
	check(schedulerSource.includes("result === 'restart-quiet'"));
	check(schedulerSource.includes('schedule(BACKLOG_CONTINUATION_MS)'));
}

async function run(): Promise<void> {
	await testTwoDevicesConvergeThroughCanonicalCas(true);
	await testTwoDevicesConvergeThroughCanonicalCas(false);
	await testManifestActivationRacePreservesRemoteWinner();
	await testIncompleteSnapshotProgression();
	await testConflictCopyNeverBecomesAuthority();
	await testTelemetryDoesNotExposeTaskContent();
	await testMetadataInventoryAndCleanupSafety();
	await testCleanupPlanSealingAndBudgets();
	await testCleanupSuppressionAndPartialStop();
	await testReusedShardFingerprintCache();
	testCoordinatorRuntimePhases();
	await testBoundedSettleAndVerifiedPersistence();
	await testSecondCasLossWritesOneRecoveryMarker();
	await testPreCoherentRecoveryAndUnloadCasAreFailSafe();
	await testProductionCleanupIsBackgroundAndUnloadSafe();
	console.log(JSON.stringify({
		ok: true,
		assertions,
		coverage: [
			'same-shard-cas-race',
			'cross-shard-cas-race',
			'manifest-activation-race',
			'incomplete-1-31-32-progression',
			'conflict-copy-not-authority',
			'telemetry-content-redaction',
			'metadata-only-inventory',
			'active-snapshot-only-alternate-cleanup',
			'sealed-cleanup-and-budgets',
			'invalid-manifest-cleanup-suppression',
			'cleanup-partial-stop-on-manifest-change',
			'mtime-gated-reused-shard-fingerprint',
			'runtime-phase-terminal-emergency',
			'bounded-settle-and-markdown-rebase',
			'verified-persistence-only',
			'dirty-journal-union-during-recovery',
			'second-cas-loss-single-recovery-marker',
			'pre-coherent-and-unload-fail-safe',
			'background-cleanup-production-wiring',
		],
	}, null, 2));
}

declare global {
	var __operonIndexV8SyncTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8SyncTestRun = run();
