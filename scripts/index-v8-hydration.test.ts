import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TFile, type App } from 'obsidian';
import type { IndexData, IndexedTask, IndexedTaskInstance } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { setOperonEnginePerfDebug } from '../src/core/engine-perf';
import { buildWorkflowStatusSemanticsSignature } from '../src/core/workflow-status-semantics';
import {
	OperonIndexer,
	type IndexV8ReadStore,
} from '../src/indexer/indexer';
import {
	buildIndexV8Snapshot,
	deriveIndexV8InstanceKey,
	getIndexV8CanonicalInstanceKeys,
	validateIndexV8Snapshot,
	type IndexV8SourceInput,
} from '../src/indexer/persistence/index-v8-codec';
import {
	buildIndexV8SemanticsSignature,
	hasIndexV8WorkflowSemanticsMismatch,
} from '../src/indexer/persistence/index-v8-semantics';
import { SecondaryIndexes } from '../src/indexer/secondary-indexes';
import type { IndexV8CoherenceBasis } from '../src/indexer/persistence/index-v8-contract';
import { IndexV8Store, type IndexV8LoadResult } from '../src/indexer/persistence/index-v8-store';
import type { IndexV8PersistenceCoordinator } from '../src/indexer/persistence/index-v8-persistence-coordinator';
import type { IndexV8FallbackReason } from '../src/indexer/persistence/index-v8-startup';
import { createSyntheticIndexData, createV8SourcesFromIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';

const COMMITTED_AT = '2026-01-02T03:04:05.000Z';
const FULL_SCAN_AT = '2026-01-02T03:00:00.000Z';
const PRIVATE_PATH = 'Private/Hydration Fixture.md';
const PRIVATE_DESCRIPTION = 'private hydration description';
const PRIVATE_ID = 'private-hydration-id';
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

function createIndexData(taskCount = 20): IndexData {
	const data = createSyntheticIndexData(taskCount);
	data.workflowStatusSemanticsSignature = buildWorkflowStatusSemanticsSignature(DEFAULT_SETTINGS.pipelines);
	return data;
}

function createDuplicateData(): IndexData {
	const data = createIndexData(20);
	const original = Object.values(data.taskInstances ?? {})[0];
	const duplicate = structuredClone(original);
	duplicate.primary.filePath = 'Synthetic/Duplicate.md';
	duplicate.primary.lineNumber = 42;
	duplicate.instanceKey = deriveIndexV8InstanceKey(
		duplicate.primary.filePath,
		duplicate.primary.lineNumber,
		duplicate.primary.format,
	);
	data.taskInstances![duplicate.instanceKey] = duplicate;
	return data;
}

async function createLoadedV8(
	data: IndexData,
	options: {
		basis?: IndexV8CoherenceBasis;
		semantics?: string;
		sources?: IndexV8SourceInput[];
	} = {},
): Promise<Extract<IndexV8LoadResult, { status: 'loaded' }>> {
	const snapshot = await buildIndexV8Snapshot({
		committedAt: COMMITTED_AT,
		lastFullScanAt: FULL_SCAN_AT,
		coherenceBasis: options.basis ?? 'verified-full-scan',
		indexSemanticsSignature: options.semantics ?? buildIndexV8SemanticsSignature(DEFAULT_SETTINGS),
		sources: options.sources ?? createV8SourcesFromIndexData(data),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	const validatedSnapshot = await validateIndexV8Snapshot(snapshot.manifestPayload, snapshot.shardPayloads);
	return {
		status: 'loaded',
		manifest: snapshot.manifest,
		manifestPayload: snapshot.manifestPayload,
		shards: snapshot.shards,
		validatedSnapshot,
		metrics: {
			manifestBytes: snapshot.manifestPayload.length,
			shardBytes: [...snapshot.shardPayloads.values()].reduce((total, payload) => total + payload.length, 0),
			shardsRead: 32,
			totalMs: 1,
		},
	};
}

function loadMetrics() {
	return { manifestBytes: 0, shardBytes: 0, shardsRead: 0, totalMs: 0 };
}

class FakeReadStore implements IndexV8ReadStore {
	loads = 0;
	constructor(public result: IndexV8LoadResult) {}
	async load(): Promise<IndexV8LoadResult> {
		this.loads += 1;
		return this.result;
	}
}

interface FakeFile extends TFile {
	stat: { ctime: number; mtime: number; size: number };
}

function makeFile(path: string, mtime: number, size: number): FakeFile {
	const FileConstructor = TFile as unknown as new (path: string) => TFile;
	const file = new FileConstructor(path) as FakeFile;
	file.stat = { ctime: mtime, mtime, size };
	return file;
}

function createApp(
	files: FakeFile[] = [],
	metadataTaskPaths: ReadonlySet<string> = new Set(),
	partialMetadataPaths: ReadonlySet<string> = new Set(),
): App {
	const byPath = new Map(files.map(file => [file.path, file]));
	return {
		vault: {
			getMarkdownFiles: () => [...byPath.values()],
			getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
			cachedRead: async () => '',
			read: async () => '',
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				if (partialMetadataPaths.has(file.path)) return {};
				return metadataTaskPaths.has(file.path)
					? { listItems: [{ task: ' ' }] }
					: { listItems: [] };
			},
		},
	} as unknown as App;
}

function filesFromLoaded(loaded: Extract<IndexV8LoadResult, { status: 'loaded' }>): FakeFile[] {
	return loaded.validatedSnapshot.shards.flatMap(shard => shard.sources.map(source => (
		makeFile(source.path, source.mtimeMs, source.sizeBytes)
	)));
}

function createStorage(settings = DEFAULT_SETTINGS) {
	return {
		getSettings: () => settings,
	};
}

function createPersistenceStub(disabledCodes: string[]) {
	return {
		disable: (code: string) => { disabledCodes.push(code); },
	};
}

type MutableIndexer = {
	tasks: Map<string, IndexedTask>;
	taskInstances: Map<string, IndexedTaskInstance>;
	fileMtimes: Map<string, number>;
	fileSizes: Map<string, number>;
	generation: number;
	lastSavedAt: number;
	lastDurableCommittedAt: string;
	lastFullScanAt: string;
	coherenceBasis: string;
	secondary: {
		byStatus: Map<string, Set<string>>;
		byDue: Array<{ operonId: string; dateDue: string }>;
		byParent: Map<string, Set<string>>;
		byFile: Map<string, Set<string>>;
		byWorkflowStatus: Map<string, Set<string>>;
		byPriority: Map<string, Set<string>>;
	};
};

function mutable(indexer: OperonIndexer): MutableIndexer {
	return indexer as unknown as MutableIndexer;
}

function normalizeSetMap(map: Map<string, Set<string>>): Array<[string, string[]]> {
	return [...map]
		.map(([key, values]): [string, string[]] => [key, [...values].sort()])
		.sort(([left], [right]) => left.localeCompare(right));
}

function normalizeTaskForHydrationParity(task: IndexedTask | IndexedTaskInstance): object {
	const fieldValues = { ...task.fieldValues };
	delete fieldValues.pinned;
	return {
		operonId: task.operonId,
		description: task.description,
		checkbox: task.checkbox,
		fieldValues,
		tags: task.tags,
		primary: task.primary,
		datetimeModified: task.datetimeModified,
		plainCheckboxProgress: task.plainCheckboxProgress,
	};
}

async function testVerifiedV8AuthorityAndParity(): Promise<void> {
	const data = createDuplicateData();
	for (const task of [...Object.values(data.tasks), ...Object.values(data.taskInstances ?? {})]) {
		task.fieldValues.pinned = 'true';
	}
	const oldDone = Object.values(data.taskInstances ?? {}).find(instance => instance.checkbox === 'done');
	check(oldDone);
	oldDone.fieldValues.dateCompleted = '2020-01-01';
	oldDone.tier = 'hot';
	data.tasks[oldDone.operonId].fieldValues.dateCompleted = '2020-01-01';
	data.tasks[oldDone.operonId].tier = 'hot';

	const loaded = await createLoadedV8(data);
	const store = new FakeReadStore(loaded);
	const disabledCodes: string[] = [];
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded)),
		createStorage() as never,
		createPersistenceStub(disabledCodes) as unknown as IndexV8PersistenceCoordinator,
		store,
	);
	const result = await indexer.loadCachedIndex();
	deepEqual(result, { status: 'loaded', source: 'v8', requiresFullReindex: false });
	const revision = indexer.getIndexRevisionSource();
	deepEqual(revision, {
		ramGeneration: 1,
		durable: {
			status: 'available',
			snapshotId: loaded.manifest.snapshotId,
			committedAt: COMMITTED_AT,
		},
	});
	check(Object.isFrozen(revision), 'index revision snapshots must be immutable');
	check(Object.isFrozen(revision.durable), 'durable revision snapshots must be immutable');
	equal(store.loads, 1);
	equal(indexer.getAllTasks().length, Object.keys(data.tasks).length);
	for (const [operonId, expectedTask] of Object.entries(data.tasks)) {
		const actualTask = indexer.getTask(operonId);
		check(actualTask, `missing hydrated canonical task ${operonId}`);
		deepEqual(normalizeTaskForHydrationParity(actualTask), normalizeTaskForHydrationParity(expectedTask));
	}
	equal(mutable(indexer).taskInstances.size, Object.keys(data.taskInstances ?? {}).length);
	for (const [instanceKey, expectedInstance] of Object.entries(data.taskInstances ?? {})) {
		const actualInstance = mutable(indexer).taskInstances.get(instanceKey);
		check(actualInstance, `missing hydrated task instance ${instanceKey}`);
		deepEqual(normalizeTaskForHydrationParity(actualInstance), normalizeTaskForHydrationParity(expectedInstance));
	}
	equal(indexer.getDuplicateRegistry().conflicts.length, 1);
	const conflict = indexer.getDuplicateRegistry().conflicts[0];
	const canonicalTask = data.tasks[conflict.operonId];
	equal(
		conflict.canonicalInstanceKey,
		deriveIndexV8InstanceKey(
			canonicalTask.primary.filePath,
			canonicalTask.primary.lineNumber,
			canonicalTask.primary.format,
		),
	);
	deepEqual(indexer.getTask(conflict.operonId)?.primary, canonicalTask.primary);
	check(indexer.getAllTasks().every(task => !('pinned' in task.fieldValues)));
	equal(indexer.getTask(oldDone.operonId)?.tier, 'cold');
	equal(mutable(indexer).generation, 1);
	equal(mutable(indexer).lastSavedAt, Date.parse(COMMITTED_AT));
	equal(mutable(indexer).lastDurableCommittedAt, COMMITTED_AT);
	equal(mutable(indexer).lastFullScanAt, FULL_SCAN_AT);
	equal(mutable(indexer).coherenceBasis, 'verified-full-scan');
	for (const shard of loaded.validatedSnapshot.shards) {
		for (const source of shard.sources) {
			equal(mutable(indexer).fileMtimes.get(source.path), source.mtimeMs);
			equal(mutable(indexer).fileSizes.get(source.path), source.sizeBytes);
		}
	}
	const expectedSecondary = new SecondaryIndexes();
	expectedSecondary.rebuild(new Map(indexer.getAllTasks().map(task => [task.operonId, task])));
	deepEqual(normalizeSetMap(mutable(indexer).secondary.byStatus), normalizeSetMap(expectedSecondary.byStatus));
	deepEqual(mutable(indexer).secondary.byDue, expectedSecondary.byDue);
	deepEqual(normalizeSetMap(mutable(indexer).secondary.byParent), normalizeSetMap(expectedSecondary.byParent));
	deepEqual(normalizeSetMap(mutable(indexer).secondary.byFile), normalizeSetMap(expectedSecondary.byFile));
	deepEqual(normalizeSetMap(mutable(indexer).secondary.byWorkflowStatus), normalizeSetMap(expectedSecondary.byWorkflowStatus));
	deepEqual(normalizeSetMap(mutable(indexer).secondary.byPriority), normalizeSetMap(expectedSecondary.byPriority));
	deepEqual(disabledCodes, []);
}

async function testEligibilityAndFallbackMatrix(): Promise<void> {
	const data = createIndexData();
	const verified = await createLoadedV8(data);
	const invalidProvenance = structuredClone(verified);
	invalidProvenance.validatedSnapshot.manifest.lastFullScanAt = '2026-01-02T04:00:00.000Z';
	const invalidMetadata = structuredClone(verified);
	const populatedShard = invalidMetadata.validatedSnapshot.shards.find(shard => shard.sources.length > 0);
	check(populatedShard);
	populatedShard.sources[0].mtimeMs = 0;
	const cases: Array<{
		name: string;
		load: IndexV8LoadResult;
		reason: IndexV8FallbackReason;
	}> = [
		{ name: 'missing', load: { status: 'missing', metrics: loadMetrics() }, reason: 'missing' },
		{
			name: 'incomplete',
			load: {
				status: 'incomplete', retryable: true, snapshotId: verified.manifest.snapshotId,
				manifest: verified.manifest, manifestPayload: verified.manifestPayload,
				missingShardIds: ['00'], metrics: loadMetrics(),
			},
			reason: 'incomplete',
		},
		{ name: 'io-error', load: { status: 'io-error', retryable: true, code: 'ADAPTER_IO', metrics: loadMetrics() }, reason: 'io-error' },
		{ name: 'invalid', load: { status: 'invalid', retryable: false, code: 'CHECKSUM', metrics: loadMetrics() }, reason: 'invalid' },
		{ name: 'unsupported', load: { status: 'unsupported', retryable: false, code: 'SCHEMA', metrics: loadMetrics() }, reason: 'unsupported' },
		{ name: 'invalid-provenance', load: invalidProvenance, reason: 'invalid' },
		{ name: 'invalid-metadata', load: invalidMetadata, reason: 'invalid' },
	];

	for (const testCase of cases) {
		const disabledCodes: string[] = [];
		const store = new FakeReadStore(testCase.load);
		const manifestBefore = testCase.load.status === 'loaded'
			? structuredClone(testCase.load.validatedSnapshot.manifest)
			: testCase.load.status === 'incomplete'
				? structuredClone(testCase.load.manifest)
				: null;
		const indexer = new OperonIndexer(
			createApp(),
			createStorage() as never,
			createPersistenceStub(disabledCodes) as unknown as IndexV8PersistenceCoordinator,
			store,
		);
		const result = await indexer.loadCachedIndex();
		deepEqual(result, { status: 'missing', fallbackReason: testCase.reason }, testCase.name);
		equal(disabledCodes.length, 0, testCase.name);
		if (manifestBefore && store.result.status === 'loaded') {
			deepEqual(store.result.validatedSnapshot.manifest, manifestBefore, `${testCase.name} must not mutate the V8 manifest`);
		} else if (manifestBefore && store.result.status === 'incomplete') {
			deepEqual(store.result.manifest, manifestBefore, `${testCase.name} must not mutate the V8 manifest`);
		}
	}
}

async function testSemanticsMismatchRequiresFullReindex(): Promise<void> {
	const data = createIndexData();
	const currentSemantics = JSON.parse(
		buildIndexV8SemanticsSignature(DEFAULT_SETTINGS),
	) as Record<string, unknown>;
	equal(currentSemantics.version, 2);
	const loaded = await createLoadedV8(data, {
		semantics: JSON.stringify({ ...currentSemantics, version: 1 }),
	});
	equal(hasIndexV8WorkflowSemanticsMismatch(
		buildIndexV8SemanticsSignature(DEFAULT_SETTINGS),
		loaded.validatedSnapshot.manifest.indexSemanticsSignature,
	), false);
	equal(hasIndexV8WorkflowSemanticsMismatch(
		buildIndexV8SemanticsSignature(DEFAULT_SETTINGS),
		JSON.stringify({ ...currentSemantics, workflow: { changed: true } }),
	), true);
	equal(hasIndexV8WorkflowSemanticsMismatch('invalid', 'invalid'), true);
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded)),
		createStorage() as never,
		null,
		new FakeReadStore(loaded),
	);
	const result = await indexer.loadCachedIndex();
	check(result.status === 'incompatible');
	if (result.status === 'incompatible') equal(result.reason, 'index-semantics');
	equal(indexer.getAllTasks().length, 0);

	const workflowLoaded = await createLoadedV8(data, {
		semantics: JSON.stringify({ ...currentSemantics, workflow: { changed: true } }),
	});
	const workflowIndexer = new OperonIndexer(
		createApp(filesFromLoaded(workflowLoaded)),
		createStorage() as never,
		null,
		new FakeReadStore(workflowLoaded),
	);
	const workflowResult = await workflowIndexer.loadCachedIndex();
	check(workflowResult.status === 'incompatible' && 'cachedSignature' in workflowResult);
	if (workflowResult.status === 'incompatible' && 'cachedSignature' in workflowResult) {
		equal(workflowResult.reason, 'index-semantics');
		equal(hasIndexV8WorkflowSemanticsMismatch(
			workflowResult.expectedSignature,
			workflowResult.cachedSignature ?? '',
		), true);
	}
}

async function testHydrationFailureIsAtomic(): Promise<void> {
	const data = createIndexData();
	const loaded = await createLoadedV8(data);
	const corrupted = structuredClone(loaded);
	const populatedShard = corrupted.validatedSnapshot.shards.find(shard => shard.sources.length > 0);
	check(populatedShard);
	check(populatedShard.sources[0].instances.length > 0);
	(populatedShard.sources[0].instances as unknown[])[0] = null;
	const disabledCodes: string[] = [];
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded)),
		createStorage() as never,
		createPersistenceStub(disabledCodes) as unknown as IndexV8PersistenceCoordinator,
		new FakeReadStore(corrupted),
	);
	const live = mutable(indexer);
	const sentinel = structuredClone(Object.values(data.tasks)[0]);
	sentinel.operonId = 'sentinel-live-task';
	live.tasks.set(sentinel.operonId, sentinel);
	const generationBefore = live.generation;
	const result = await indexer.loadCachedIndex();
	deepEqual(result, { status: 'missing', fallbackReason: 'hydration-failed' });
	equal(indexer.getTask(sentinel.operonId)?.operonId, sentinel.operonId);
	equal(live.generation, generationBefore);
	equal(disabledCodes.length, 0);
}

async function testStagedRebuildFailureFallsBackWithoutPartialCommit(): Promise<void> {
	const data = createIndexData();
	const loaded = await createLoadedV8(data);
	const disabledCodes: string[] = [];
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded)),
		createStorage() as never,
		createPersistenceStub(disabledCodes) as unknown as IndexV8PersistenceCoordinator,
		new FakeReadStore(loaded),
	);
	const originalRebuild = SecondaryIndexes.prototype.rebuild;
	let rebuildCalls = 0;
	SecondaryIndexes.prototype.rebuild = function rebuildWithOneFailure(tasks): void {
		rebuildCalls += 1;
		if (rebuildCalls === 1) throw new Error('controlled staged secondary rebuild failure');
		originalRebuild.call(this, tasks);
	};
	try {
		deepEqual(await indexer.loadCachedIndex(), { status: 'missing', fallbackReason: 'hydration-failed' });
	} finally {
		SecondaryIndexes.prototype.rebuild = originalRebuild;
	}
	equal(rebuildCalls, 1, 'V8 staged rebuild failure must return a Markdown full-scan decision');
	equal(mutable(indexer).generation, 0, 'failed staged state must never increment live generation');
	equal(indexer.getAllTasks().length, 0);
	equal(disabledCodes.length, 0);
}

async function testStartupReconciliationClassifiesSourcesOnce(): Promise<void> {
	const data = createIndexData(40);
	const loaded = await createLoadedV8(data);
	const sources = loaded.validatedSnapshot.shards.flatMap(shard => shard.sources);
	check(sources.length >= 3);
	const unchanged = sources[0];
	const changedMtime = sources[1];
	const changedSize = sources[2];
	const deleted = sources[3];
	check(deleted);
	const files = [
		makeFile(unchanged.path, unchanged.mtimeMs, unchanged.sizeBytes),
		makeFile(changedMtime.path, changedMtime.mtimeMs + 1, changedMtime.sizeBytes),
		makeFile(changedSize.path, changedSize.mtimeMs, changedSize.sizeBytes + 1),
		makeFile('Synthetic/Renamed-Source.md', deleted.mtimeMs, deleted.sizeBytes),
		makeFile('Synthetic/New-Source.md', Date.parse(COMMITTED_AT) + 1, 64),
		makeFile('Synthetic/Sync-Old-Timestamp.md', Date.parse(COMMITTED_AT) - 10_000, 96),
		makeFile('Synthetic/Sync-Partial-Cache.md', Date.parse(COMMITTED_AT) - 10_000, 80),
		makeFile('Synthetic/Old-Taskless.md', Date.parse(COMMITTED_AT) - 10_000, 32),
	];

	const indexer = new OperonIndexer(
		createApp(
			files,
			new Set(['Synthetic/Sync-Old-Timestamp.md']),
			new Set(['Synthetic/Sync-Partial-Cache.md']),
		),
		createStorage() as never,
		null,
		new FakeReadStore(loaded),
	);
	deepEqual(await indexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	const batches: string[][] = [];
	const internal = indexer as unknown as {
		doReindexFilesBatch(paths: string[]): Promise<void>;
	};
	internal.doReindexFilesBatch = async paths => { batches.push([...paths].sort()); };
	await (indexer as unknown as { reconcileV8StartupSources(): Promise<void> }).reconcileV8StartupSources();
	equal(batches.length, 1, 'reconciliation must use one batch/index operation');
	const expected = [
		changedMtime.path,
		changedSize.path,
		deleted.path,
		'Synthetic/Renamed-Source.md',
		'Synthetic/New-Source.md',
		'Synthetic/Sync-Old-Timestamp.md',
		'Synthetic/Sync-Partial-Cache.md',
	].sort();
	deepEqual(batches[0], expected);

	const cleanIndexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded)),
		createStorage() as never,
		null,
		new FakeReadStore(loaded),
	);
	deepEqual(await cleanIndexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	let cleanBatchCount = 0;
	(cleanIndexer as unknown as { doReindexFilesBatch(paths: string[]): Promise<void> }).doReindexFilesBatch = async () => {
		cleanBatchCount += 1;
	};
	await (cleanIndexer as unknown as { reconcileV8StartupSources(): Promise<void> }).reconcileV8StartupSources();
	equal(cleanBatchCount, 0, 'clean V8 startup must not schedule persistence work');

	const excludedSettings = structuredClone(DEFAULT_SETTINGS);
	excludedSettings.excludedFolders = ['Synthetic'];
	const excludedData = createIndexData(10);
	const excludedLoaded = await createLoadedV8(excludedData, {
		semantics: buildIndexV8SemanticsSignature(excludedSettings),
	});
	const excludedIndexer = new OperonIndexer(
		createApp(filesFromLoaded(excludedLoaded)),
		createStorage(excludedSettings) as never,
		null,
		new FakeReadStore(excludedLoaded),
	);
	deepEqual(await excludedIndexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	const excludedBatches: string[][] = [];
	(excludedIndexer as unknown as { doReindexFilesBatch(paths: string[]): Promise<void> }).doReindexFilesBatch = async paths => {
		excludedBatches.push([...paths].sort());
	};
	await (excludedIndexer as unknown as { reconcileV8StartupSources(): Promise<void> }).reconcileV8StartupSources();
	equal(excludedBatches.length, 1);
	deepEqual(
		excludedBatches[0],
		excludedLoaded.validatedSnapshot.shards.flatMap(shard => shard.sources.map(source => source.path)).sort(),
	);
}

async function testStartupReconciliationAppliesOneDurableBatch(): Promise<void> {
	const data = createIndexData(20);
	const loaded = await createLoadedV8(data);
	const removedSource = loaded.validatedSnapshot.shards
		.flatMap(shard => shard.sources)
		.find(source => source.instances.length > 0);
	check(removedSource);
	const files = filesFromLoaded(loaded).filter(file => file.path !== removedSource.path);
	const indexer = new OperonIndexer(
		createApp(files),
		createStorage() as never,
		null,
		new FakeReadStore(loaded),
	);
	deepEqual(await indexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	const initialGeneration = mutable(indexer).generation;
	await indexer.reconcileV8StartupSources();
	await indexer.flushPendingPersist();
	equal(mutable(indexer).generation, initialGeneration + 1);
	equal(mutable(indexer).secondary.byFile.has(removedSource.path), false);
	for (const persisted of removedSource.instances) {
		equal(indexer.getTask(persisted.operonId), undefined);
	}
}

async function testStartupReconciliationRemovesDeletedNonCanonicalDuplicate(): Promise<void> {
	const loaded = await createLoadedV8(createDuplicateData());
	const duplicateSource = loaded.validatedSnapshot.shards
		.flatMap(shard => shard.sources)
		.find(source => source.path === 'Synthetic/Duplicate.md');
	check(duplicateSource);
	const duplicateId = duplicateSource.instances[0]?.operonId;
	check(duplicateId);
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded).filter(file => file.path !== duplicateSource.path)),
		createStorage() as never,
		null,
		new FakeReadStore(loaded),
	);
	deepEqual(await indexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	check(indexer.hasDuplicateOperonIdConflict(duplicateId));
	const initialInstanceCount = mutable(indexer).taskInstances.size;
	await indexer.reconcileV8StartupSources();
	await indexer.flushPendingPersist();
	check(indexer.getTask(duplicateId), 'canonical duplicate instance must remain indexed');
	equal(indexer.hasDuplicateOperonIdConflict(duplicateId), false);
	equal(mutable(indexer).taskInstances.size, initialInstanceCount - 1);
	equal(
		[...mutable(indexer).taskInstances.values()].some(instance => instance.primary.filePath === duplicateSource.path),
		false,
	);
}

async function testStartupReconciliationPromotesDuplicateAfterCanonicalDeletion(): Promise<void> {
	const data = createDuplicateData();
	const loaded = await createLoadedV8(data);
	const duplicateSource = loaded.validatedSnapshot.shards
		.flatMap(shard => shard.sources)
		.find(source => source.path === 'Synthetic/Duplicate.md');
	check(duplicateSource);
	const duplicateId = duplicateSource.instances[0]?.operonId;
	check(duplicateId);
	const canonicalPath = data.tasks[duplicateId]?.primary.filePath;
	check(canonicalPath);
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(loaded).filter(file => file.path !== canonicalPath)),
		createStorage() as never,
		null,
		new FakeReadStore(loaded),
	);
	deepEqual(await indexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	check(indexer.hasDuplicateOperonIdConflict(duplicateId));
	await indexer.reconcileV8StartupSources();
	await indexer.flushPendingPersist();
	equal(indexer.hasDuplicateOperonIdConflict(duplicateId), false);
	equal(indexer.getTask(duplicateId)?.primary.filePath, duplicateSource.path);
	equal(mutable(indexer).secondary.byFile.has(canonicalPath), false);
	check(mutable(indexer).secondary.byFile.get(duplicateSource.path)?.has(duplicateId));
}

async function testTelemetryPrivacy(): Promise<void> {
	const data = createIndexData(20);
	const firstTask = Object.values(data.tasks)[0];
	const firstInstance = Object.values(data.taskInstances ?? {})[0];
	firstTask.operonId = PRIVATE_ID;
	firstTask.description = PRIVATE_DESCRIPTION;
	firstTask.primary.filePath = PRIVATE_PATH;
	firstInstance.operonId = PRIVATE_ID;
	firstInstance.description = PRIVATE_DESCRIPTION;
	firstInstance.primary.filePath = PRIVATE_PATH;
	firstInstance.instanceKey = deriveIndexV8InstanceKey(PRIVATE_PATH, firstInstance.primary.lineNumber, firstInstance.primary.format);
	data.taskInstances = Object.fromEntries(
		Object.values(data.taskInstances ?? {}).map(instance => [instance.instanceKey, instance]),
	);
	data.tasks = Object.fromEntries(Object.values(data.tasks).map(task => [task.operonId, task]));
	const loaded = await createLoadedV8(data);
	const lines: string[] = [];
	const originalDebug = console.debug;
	console.debug = (...args: unknown[]) => { lines.push(args.join(' ')); };
	setOperonEnginePerfDebug(true);
	try {
		const indexer = new OperonIndexer(
			createApp(filesFromLoaded(loaded)),
			createStorage() as never,
			null,
			new FakeReadStore(loaded),
		);
		deepEqual(await indexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	} finally {
		setOperonEnginePerfDebug(false);
		console.debug = originalDebug;
	}
	const payload = lines.join('\n');
	check(payload.includes('index.load.cached'));
	check(!payload.includes(PRIVATE_ID));
	check(!payload.includes(PRIVATE_DESCRIPTION));
	check(!payload.includes(PRIVATE_PATH));
}

async function testRealStoreStartupPipeline(): Promise<void> {
	const data = createIndexData(24);
	const snapshot = await buildIndexV8Snapshot({
		committedAt: COMMITTED_AT,
		lastFullScanAt: FULL_SCAN_AT,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: buildIndexV8SemanticsSignature(DEFAULT_SETTINGS),
		sources: createV8SourcesFromIndexData(data),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	const adapter = new IndexV8MemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian', 'operon-hydration-real-store').runtime.indexV8;
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit(snapshot);
	const probe = await store.load();
	check(probe.status === 'loaded');
	if (probe.status !== 'loaded') throw new Error('Expected real V8 store fixture to load');
	const indexer = new OperonIndexer(
		createApp(filesFromLoaded(probe)),
		createStorage() as never,
		null,
		store,
	);
	deepEqual(await indexer.loadCachedIndex(), { status: 'loaded', source: 'v8', requiresFullReindex: false });
	equal(indexer.getAllTasks().length, Object.keys(data.tasks).length);
	check(adapter.operations.some(operation => operation.startsWith('readBinary:')));
}

async function testMainStartupOrchestrationContract(): Promise<void> {
	const mainSource = await readFile('main.ts', 'utf8');
	check(mainSource.includes("const hasCached = cacheLoad.status === 'loaded';"));
	check(mainSource.includes("const requiresFullReindex = cacheLoad.status === 'loaded' && cacheLoad.requiresFullReindex;"));
	check(mainSource.includes("const requiresWorkflowStatsBackfill = cacheLoad.status === 'incompatible'"));
	check(!/requiresWorkflowStatsBackfill = cacheLoad\.status === 'incompatible'\s+&& cacheLoad\.reason/u.test(mainSource));
	check(/if \(!hasCached \|\| requiresFullReindex\) \{\s+await this\.indexer\.fullReindex\(\);/u.test(mainSource));
	check(/if \(requiresWorkflowStatsBackfill\) \{\s+await this\.runTaskStatsBackfill\(\{ force: true, source: 'workflow-semantics' \}\);/u.test(mainSource));
	check(/else \{\s+await this\.indexer\.reconcileV8StartupSources\(\);/u.test(mainSource));
	equal(DEFAULT_SETTINGS.fullReindexOnStartup, false, 'default verified V8 startup must not schedule a full scan');
}

async function run(): Promise<void> {
	await testVerifiedV8AuthorityAndParity();
	await testEligibilityAndFallbackMatrix();
	await testSemanticsMismatchRequiresFullReindex();
	await testHydrationFailureIsAtomic();
	await testStagedRebuildFailureFallsBackWithoutPartialCommit();
	await testStartupReconciliationClassifiesSourcesOnce();
	await testStartupReconciliationAppliesOneDurableBatch();
	await testStartupReconciliationRemovesDeletedNonCanonicalDuplicate();
	await testStartupReconciliationPromotesDuplicateAfterCanonicalDeletion();
	await testTelemetryPrivacy();
	await testRealStoreStartupPipeline();
	await testMainStartupOrchestrationContract();
	process.stdout.write(`${JSON.stringify({ ok: true, assertions })}\n`);
}

declare global {
	var __operonIndexV8HydrationTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8HydrationTestRun = run();
