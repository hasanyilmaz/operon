import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { buildIndexV8Snapshot } from '../src/indexer/persistence/index-v8-codec';
import { IndexV8Store } from '../src/indexer/persistence/index-v8-store';
import { IndexV8PersistenceCoordinator } from '../src/indexer/persistence/index-v8-persistence-coordinator';
import { OperonIndexer } from '../src/indexer/indexer';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { createSyntheticIndexData, createV8SourcesFromIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';

const paths = buildOperonStoragePaths('.obsidian', 'operon').runtime;

async function buildSnapshot(count: number) {
	return await buildIndexV8Snapshot({
		committedAt: '2026-07-16T10:00:00.000Z',
		lastFullScanAt: '2026-07-16T10:00:00.000Z',
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: 'maintenance-test-v1',
		sources: createV8SourcesFromIndexData(createSyntheticIndexData(count)),
	});
}

async function testResetSealsUnreadableManifestAndMarkerRace(): Promise<void> {
	const oversizedAdapter = new IndexV8MemoryAdapter();
	const oversizedStore = new IndexV8Store(oversizedAdapter.asDataAdapter(), paths.indexV8, {
		recoveryRequiredPath: paths.indexV8RecoveryRequiredPath,
	});
	oversizedAdapter.folders.add(paths.indexV8.rootPath);
	oversizedAdapter.folders.add(paths.indexV8.shardsPath);
	oversizedAdapter.setFile(paths.indexV8.manifestPath, 'x'.repeat(300_000), 10);
	const oversizedPlan = await oversizedStore.planCanonicalV8Reset();
	assert.ok(oversizedPlan.suppressedReasons.some(reason => reason.startsWith('canonical-manifest-unsealed-')));
	assert.equal((await oversizedStore.applyCanonicalV8Reset(oversizedPlan)).status, 'suppressed');
	assert.equal(oversizedAdapter.files.has(paths.indexV8.manifestPath), true);

	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths.indexV8, {
		recoveryRequiredPath: paths.indexV8RecoveryRequiredPath,
	});
	const snapshot = await buildSnapshot(67);
	await store.commit({ ...snapshot, expectedBaseMissing: true });
	const plan = await store.planCanonicalV8Reset();
	const concurrentMarker = '{"version":2,"required":true}';
	adapter.failOperation = (operation, path) => {
		if (operation === 'copy' && path.endsWith(`->${paths.indexV8RecoveryRequiredPath}`)) {
			adapter.setFile(paths.indexV8RecoveryRequiredPath, concurrentMarker, 99);
		}
		return false;
	};
	assert.equal((await store.applyCanonicalV8Reset(plan)).status, 'stale');
	assert.equal(adapter.files.get(paths.indexV8RecoveryRequiredPath), concurrentMarker);
	assert.equal(adapter.files.get(paths.indexV8.manifestPath), snapshot.manifestPayload);

	const manifestRaceAdapter = new IndexV8MemoryAdapter();
	const manifestRaceStore = new IndexV8Store(manifestRaceAdapter.asDataAdapter(), paths.indexV8, {
		recoveryRequiredPath: paths.indexV8RecoveryRequiredPath,
	});
	await manifestRaceStore.commit({ ...snapshot, expectedBaseMissing: true });
	const manifestRacePlan = await manifestRaceStore.planCanonicalV8Reset();
	const remoteManifest = '{"remote":"canonical"}';
	manifestRaceAdapter.failOperation = (operation, path) => {
		if (operation === 'rename' && path.startsWith(`${paths.indexV8.manifestPath}->`)) {
			manifestRaceAdapter.setFile(paths.indexV8.manifestPath, remoteManifest, 101);
		}
		return false;
	};
	assert.equal((await manifestRaceStore.applyCanonicalV8Reset(manifestRacePlan)).status, 'partial');
	assert.equal(manifestRaceAdapter.files.get(paths.indexV8.manifestPath), remoteManifest);
}

async function testCleanupDefersRacingAlternateManifestToNextPlan(): Promise<void> {
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths.indexV8);
	const active = await buildSnapshot(68);
	const alternate = await buildSnapshot(69);
	await store.commit({ ...active, expectedBaseMissing: true });
	const activeNames = new Set(active.manifest.shards.map(descriptor => `${descriptor.shardId}-${descriptor.sha256}.json`));
	const orphan = alternate.manifest.shards.find(descriptor => !activeNames.has(`${descriptor.shardId}-${descriptor.sha256}.json`));
	assert.ok(orphan);
	const orphanPath = `${paths.indexV8.shardsPath}/${orphan.shardId}-${orphan.sha256}.json`;
	adapter.setFile(orphanPath, alternate.shardPayloads.get(orphan.shardId)!, 0);
	const plan = await store.planCleanup({ nowMs: 31 * 24 * 60 * 60 * 1_000 });
	assert.ok(plan.candidates.some(candidate => candidate.path === orphanPath));
	const alternatePath = `${paths.indexV8.rootPath}/manifest (racing conflict).json`;
	adapter.failOperation = (operation, path) => {
		if (operation === 'rename' && path.startsWith(`${orphanPath}->`)) {
			adapter.setFile(alternatePath, alternate.manifestPayload, 1);
		}
		return false;
	};
	const result = await store.applyCleanup(plan);
	assert.equal(result.status, 'applied');
	assert.equal(adapter.files.has(orphanPath), false);
	assert.equal(adapter.files.has(alternatePath), true);
	const followup = await store.planCleanup();
	assert.ok(followup.candidates.some(candidate => candidate.path === alternatePath));
}

async function testCanonicalResetPreservesNonCanonicalArtifacts(): Promise<void> {
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths.indexV8, {
		recoveryRequiredPath: paths.indexV8RecoveryRequiredPath,
	});
	const snapshot = await buildSnapshot(65);
	await store.commit({ ...snapshot, expectedBaseMissing: true });
	const alternatePath = `${paths.indexV8.rootPath}/manifest (conflict copy).json`;
	const foreignPath = `${paths.indexV8.rootPath}/user-notes.json`;
	adapter.setFile(alternatePath, snapshot.manifestPayload, 300);
	adapter.setFile(foreignPath, '{}', 300);
	const activeShardPaths = snapshot.manifest.shards.map(descriptor => (
		`${paths.indexV8.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`
	));

	const plan = await store.planCanonicalV8Reset(undefined, 789);
	assert.deepEqual(plan.suppressedReasons, []);
	const result = await store.applyCanonicalV8Reset(plan);
	assert.equal(result.status, 'applied');
	assert.equal(result.recoveryMarkerCreated, true);
	assert.equal(result.manifestRemoved, true);
	assert.equal(adapter.files.has(paths.indexV8.manifestPath), false);
	assert.equal(adapter.files.get(paths.indexV8RecoveryRequiredPath), '{"version":1,"required":true}');
	assert.equal(adapter.files.has(alternatePath), true);
	assert.equal(adapter.files.has(foreignPath), true);
	assert.ok(activeShardPaths.every(path => adapter.files.has(path)));
}

async function testCanonicalResetRemovesOnlyConflictingDesiredShard(): Promise<void> {
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths.indexV8, {
		recoveryRequiredPath: paths.indexV8RecoveryRequiredPath,
	});
	const snapshot = await buildSnapshot(66);
	await store.commit({ ...snapshot, expectedBaseMissing: true });
	const descriptor = snapshot.manifest.shards.find(candidate => candidate.sourceCount > 0);
	assert.ok(descriptor);
	const shardPath = `${paths.indexV8.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`;
	const original = adapter.files.get(shardPath);
	assert.ok(original);
	const replacement = `${original.slice(0, -1)}${original.endsWith('}') ? ']' : '}'}`;
	assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
	adapter.setFile(shardPath, replacement, 900);
	const foreignPath = `${paths.indexV8.shardsPath}/foreign.json`;
	adapter.setFile(foreignPath, '{}', 900);

	const plan = await store.planCanonicalV8Reset(snapshot.shardPayloads, 901);
	assert.equal(plan.conflictingShards.length, 1);
	assert.equal(plan.conflictingShards[0].path, shardPath);
	const result = await store.applyCanonicalV8Reset(plan);
	assert.equal(result.status, 'applied');
	assert.equal(result.conflictingShardsRemoved, 1);
	assert.equal(adapter.files.has(shardPath), false);
	assert.equal(adapter.files.has(foreignPath), true);
}

async function testIndexerRepairRebuildsFromMarkdownAndClearsMarker(): Promise<void> {
	const adapter = new IndexV8MemoryAdapter();
	const store = new IndexV8Store(adapter.asDataAdapter(), paths.indexV8, {
		recoveryRequiredPath: paths.indexV8RecoveryRequiredPath,
	});
	const snapshot = await buildSnapshot(10);
	await store.commit({ ...snapshot, expectedBaseMissing: true });
	adapter.setFile(paths.indexV8.manifestPath, '{invalid-json', 1_000);
	const app = {
		vault: {
			adapter: adapter.asDataAdapter(),
			getMarkdownFiles: () => [],
			getAbstractFileByPath: () => null,
		},
		metadataCache: { getFileCache: () => null },
	} as unknown as App;
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
		markIndexV8RecoveryRequired: async () => {
			await adapter.asDataAdapter().write(paths.indexV8RecoveryRequiredPath, '{"version":1,"required":true}');
		},
		clearIndexV8RecoveryRequired: async () => {
			if (await adapter.asDataAdapter().exists(paths.indexV8RecoveryRequiredPath)) {
				await adapter.asDataAdapter().remove(paths.indexV8RecoveryRequiredPath);
			}
		},
	};
	const coordinator = new IndexV8PersistenceCoordinator(store);
	const indexer = new OperonIndexer(app, storage as never, coordinator, store);
	const result = await indexer.repairIndexV8FromMarkdown();
	assert.equal(result.status, 'applied');
	assert.equal(adapter.files.has(paths.indexV8RecoveryRequiredPath), false);
	const repaired = await store.load();
	assert.equal(repaired.status, 'loaded');
	if (repaired.status === 'loaded') assert.equal(repaired.manifest.totals.taskInstanceCount, 0);
	assert.equal(indexer.taskCount, 0);
}

async function main(): Promise<void> {
	await testCanonicalResetPreservesNonCanonicalArtifacts();
	await testCanonicalResetRemovesOnlyConflictingDesiredShard();
	await testResetSealsUnreadableManifestAndMarkerRace();
	await testCleanupDefersRacingAlternateManifestToNextPlan();
	await testIndexerRepairRebuildsFromMarkdownAndClearsMarker();
	console.log(JSON.stringify({ ok: true, suite: 'index-v8-maintenance' }));
}

declare global {
	var __operonIndexV8MaintenanceTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8MaintenanceTestRun = main();
