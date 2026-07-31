import assert from 'node:assert/strict';
import type { IndexedTaskInstance, IndexData } from '../src/types/fields';
import {
	buildIndexV8Snapshot,
	deriveIndexV8InstanceKey,
	getIndexV8CanonicalInstanceKeys,
	projectIndexDataToV8Sources,
	validateIndexV8Snapshot,
	type IndexV8SourceStat,
} from '../src/indexer/persistence/index-v8-codec';
import {
	buildIndexV8BaselineMembership,
	buildIndexV8RamSourceIndexes,
	collectIndexV8DirtyClosure,
	compileIndexV8Incremental,
	IndexV8IncrementalCompileError,
	type CompileIndexV8IncrementalInput,
	type IndexV8DirtyBatch,
} from '../src/indexer/persistence/index-v8-incremental-compiler';
import {
	assertIndexV8IncrementalParity,
	compareIndexV8Parity,
	IndexV8ParityError,
	projectIndexV8IncrementalParity,
} from '../src/indexer/persistence/index-v8-parity';
import { getIndexV8ShardId } from '../src/indexer/persistence/index-v8-partition';
import { IndexV8StorageError, IndexV8Store } from '../src/indexer/persistence/index-v8-store';
import {
	IndexV8PersistenceCoordinator,
	type IndexV8PersistenceInput,
} from '../src/indexer/persistence/index-v8-persistence-coordinator';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { createSyntheticIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';
import { SecondaryIndexes } from '../src/indexer/secondary-indexes';

const FIRST_TIME = '2026-01-02T03:04:05.000Z';
const SECOND_TIME = '2026-01-02T03:05:05.000Z';
const THIRD_TIME = '2026-01-02T03:06:05.000Z';
const SEMANTICS = 'incremental-test-v1';
let assertions = 0;
const baselineMembershipByManifest = new Map<string, ReturnType<typeof buildIndexV8BaselineMembership>>();

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

function sourceStats(data: Readonly<IndexData>): Map<string, IndexV8SourceStat> {
	const paths = new Set(Object.values(data.taskInstances ?? {}).map(instance => instance.primary.filePath));
	return new Map(Array.from(paths, path => [path, {
		mtimeMs: Date.parse(FIRST_TIME),
		sizeBytes: Math.max(1, path.length * 32),
	}]));
}

async function fullSnapshot(data: Readonly<IndexData>, stats: ReadonlyMap<string, IndexV8SourceStat>, committedAt = FIRST_TIME) {
	const result = await buildIndexV8Snapshot({
		committedAt,
		lastFullScanAt: FIRST_TIME,
		coherenceBasis: 'verified-full-scan',
		indexSemanticsSignature: SEMANTICS,
		sources: projectIndexDataToV8Sources(data, stats),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	baselineMembershipByManifest.set(result.manifestPayload, buildIndexV8BaselineMembership(data));
	return result;
}

function compileInput(
	data: Readonly<IndexData>,
	stats: ReadonlyMap<string, IndexV8SourceStat>,
	dirtyBatch: IndexV8DirtyBatch,
	baseManifestPayload?: string,
	committedAt = SECOND_TIME,
): CompileIndexV8IncrementalInput {
	return {
		baseManifestPayload,
		...(baseManifestPayload && baselineMembershipByManifest.has(baseManifestPayload)
			? { baseMembership: baselineMembershipByManifest.get(baseManifestPayload)! }
			: {}),
		indexData: data,
		sourceStats: stats,
		dirtyBatch,
		committedAt,
		lastFullScanAt: FIRST_TIME,
		indexSemanticsSignature: SEMANTICS,
		coherenceBasis: 'verified-full-scan',
	};
}

function changeFirstTask(data: IndexData, suffix = ' changed'): { operonId: string; path: string } {
	const instance = Object.values(data.taskInstances ?? {})[0];
	if (!instance) throw new Error('Synthetic fixture has no task instance');
	instance.description += suffix;
	const canonical = data.tasks[instance.operonId];
	if (!canonical) throw new Error('Synthetic fixture has no canonical task');
	canonical.description = instance.description;
	return { operonId: instance.operonId, path: instance.primary.filePath };
}

function removeSource(data: IndexData, path: string): string[] {
	const removedIds: string[] = [];
	for (const [instanceKey, instance] of Object.entries(data.taskInstances ?? {})) {
		if (instance.primary.filePath !== path) continue;
		removedIds.push(instance.operonId);
		delete data.taskInstances![instanceKey];
		delete data.tasks[instance.operonId];
	}
	return removedIds;
}

function findPathInDifferentShard(path: string): string {
	const current = getIndexV8ShardId(path);
	for (let index = 0; index < 10_000; index++) {
		const candidate = `Synthetic/Renamed-${index.toString(36)}.md`;
		if (getIndexV8ShardId(candidate) !== current) return candidate;
	}
	throw new Error('Could not find a cross-shard rename fixture');
}

function renameSource(data: IndexData, oldPath: string, newPath: string): string[] {
	const affectedIds: string[] = [];
	const replacements: Array<[string, string, IndexedTaskInstance]> = [];
	for (const [instanceKey, instance] of Object.entries(data.taskInstances ?? {})) {
		if (instance.primary.filePath !== oldPath) continue;
		const updated: IndexedTaskInstance = {
			...instance,
			primary: { ...instance.primary, filePath: newPath },
			instanceKey: deriveIndexV8InstanceKey(newPath, instance.primary.lineNumber, instance.primary.format),
		};
		replacements.push([instanceKey, updated.instanceKey, updated]);
		affectedIds.push(instance.operonId);
		data.tasks[instance.operonId] = { ...data.tasks[instance.operonId], primary: { ...updated.primary } };
	}
	for (const [oldKey, newKey, updated] of replacements) {
		delete data.taskInstances![oldKey];
		data.taskInstances![newKey] = updated;
	}
	return affectedIds;
}

async function assertMatchesFullCompile(
	data: Readonly<IndexData>,
	stats: ReadonlyMap<string, IndexV8SourceStat>,
	base: Awaited<ReturnType<typeof fullSnapshot>>,
	result: Awaited<ReturnType<typeof compileIndexV8Incremental>>,
	committedAt = SECOND_TIME,
): Promise<void> {
	const payloads = new Map(base.shardPayloads);
	for (const [shardId, payload] of result.changedShardPayloads) payloads.set(shardId, payload);
	await validateIndexV8Snapshot(result.manifestPayload, payloads);
	assertions++;
	const expected = await fullSnapshot(data, stats, committedAt);
	equal(result.manifestPayload, expected.manifestPayload, 'incremental manifest must match an independent full compile');
	for (const descriptor of result.manifest.shards) {
		equal(payloads.get(descriptor.shardId), expected.shardPayloads.get(descriptor.shardId));
	}
	const parity = await compareIndexV8Parity(data, {
		manifest: result.manifest,
		manifestPayload: result.manifestPayload,
		shards: expected.shards,
		shardPayloads: payloads,
	}, Date.parse(committedAt), stats);
	check(parity.ok, 'incremental snapshot must preserve all parity dimensions');
}

async function testSourceIndexesAndDirtyClosure(): Promise<void> {
	const data = createSyntheticIndexData(30);
	const instances = Object.values(data.taskInstances ?? {});
	const first = instances[0];
	const duplicatePath = 'Synthetic/Duplicate-Cross-Shard.md';
	const duplicateKey = deriveIndexV8InstanceKey(duplicatePath, 0, 'inline');
	data.taskInstances![duplicateKey] = {
		...first,
		instanceKey: duplicateKey,
		primary: { filePath: duplicatePath, lineNumber: 0, format: 'inline' },
	};
	const indexes = buildIndexV8RamSourceIndexes(data);
	equal(indexes.sourceInstanceKeys.size, 4);
	check(indexes.sourcePathsByShard.size > 0 && indexes.sourcePathsByShard.size <= 32);
	check(Array.from(indexes.sourcePathsByShard.values()).every(paths => paths.size > 0));
	const closure = collectIndexV8DirtyClosure(data, indexes, {
		sequence: 1,
		dirtySourcePaths: new Set([first.primary.filePath]),
		affectedOperonIds: new Set([first.operonId]),
		forceFull: false,
	});
	check(closure.sourcePaths.has(first.primary.filePath));
	check(closure.sourcePaths.has(duplicatePath), 'duplicate canonical closure must include every member source');
	check(closure.shardIds.has(getIndexV8ShardId(first.primary.filePath)));
	check(closure.shardIds.has(getIndexV8ShardId(duplicatePath)));
	assert.throws(
		() => collectIndexV8DirtyClosure(data, indexes, {
			sequence: 0,
			dirtySourcePaths: new Set(),
			affectedOperonIds: new Set(),
			forceFull: false,
		}),
		error => error instanceof IndexV8IncrementalCompileError && error.code === 'INVALID_DIRTY_BATCH',
	);
	assertions++;
}

async function testSingleShardNoopDeleteAndRename(): Promise<void> {
	const original = createSyntheticIndexData(320);
	const originalStats = sourceStats(original);
	const base = await fullSnapshot(original, originalStats);

	const changed = structuredClone(original);
	const changedStats = new Map(originalStats);
	const changedTask = changeFirstTask(changed);
	changedStats.set(changedTask.path, { ...changedStats.get(changedTask.path)!, mtimeMs: Date.parse(SECOND_TIME) });
	const single = await compileIndexV8Incremental(compileInput(changed, changedStats, {
		sequence: 1,
		dirtySourcePaths: new Set([changedTask.path]),
		affectedOperonIds: new Set([changedTask.operonId]),
		forceFull: false,
	}, base.manifestPayload));
	equal(single.status, 'changed');
	equal(single.mode, 'incremental');
	equal(single.dirtyShardIds.length, 1);
	equal(single.shardsWritten, 1);
	equal(single.shardsReused, 31);
	equal(single.changedShardPayloads.size, 1);
	await assertMatchesFullCompile(changed, changedStats, base, single);

	const noOp = await compileIndexV8Incremental(compileInput(original, originalStats, {
		sequence: 2,
		dirtySourcePaths: new Set([changedTask.path]),
		affectedOperonIds: new Set([changedTask.operonId]),
		forceFull: false,
	}, base.manifestPayload, THIRD_TIME));
	equal(noOp.status, 'unchanged');
	equal(noOp.manifestPayload, base.manifestPayload);
	equal(noOp.changedShardPayloads.size, 0);
	equal(noOp.shardsWritten, 0);
	equal(noOp.manifest.committedAt, FIRST_TIME, 'no-op compile must not advance committedAt');

	const deleted = structuredClone(original);
	const deletedStats = new Map(originalStats);
	const deletePath = Object.values(deleted.taskInstances ?? {})[0].primary.filePath;
	const removedIds = removeSource(deleted, deletePath);
	deletedStats.delete(deletePath);
	const deletion = await compileIndexV8Incremental(compileInput(deleted, deletedStats, {
		sequence: 3,
		dirtySourcePaths: new Set([deletePath]),
		affectedOperonIds: new Set(removedIds),
		forceFull: false,
	}, base.manifestPayload));
	equal(deletion.mode, 'incremental');
	equal(deletion.shardsWritten, 1);
	equal(deletion.manifest.totals.sourceCount, base.manifest.totals.sourceCount - 1);
	await assertMatchesFullCompile(deleted, deletedStats, base, deletion);

	const renamed = structuredClone(original);
	const renamedStats = new Map(originalStats);
	const oldPath = Object.values(renamed.taskInstances ?? {})[0].primary.filePath;
	const newPath = findPathInDifferentShard(oldPath);
	const renamedIds = renameSource(renamed, oldPath, newPath);
	const oldStat = renamedStats.get(oldPath)!;
	renamedStats.delete(oldPath);
	renamedStats.set(newPath, { ...oldStat, mtimeMs: Date.parse(SECOND_TIME) });
	const rename = await compileIndexV8Incremental(compileInput(renamed, renamedStats, {
		sequence: 4,
		dirtySourcePaths: new Set([oldPath, newPath]),
		affectedOperonIds: new Set(renamedIds),
		forceFull: false,
	}, base.manifestPayload));
	equal(rename.mode, 'incremental');
	equal(rename.dirtyShardIds.length, 2);
	equal(rename.shardsWritten, 2);
	await assertMatchesFullCompile(renamed, renamedStats, base, rename);

	const caseRenamed = structuredClone(original);
	const caseStats = new Map(originalStats);
	const caseOldPath = Object.values(caseRenamed.taskInstances ?? {})[0].primary.filePath;
	const caseNewPath = caseOldPath.replace(/^Synthetic/u, 'synthetic');
	const caseIds = renameSource(caseRenamed, caseOldPath, caseNewPath);
	const caseStat = caseStats.get(caseOldPath)!;
	caseStats.delete(caseOldPath);
	caseStats.set(caseNewPath, { ...caseStat, mtimeMs: Date.parse(SECOND_TIME) });
	const caseOnly = await compileIndexV8Incremental(compileInput(caseRenamed, caseStats, {
		sequence: 5,
		dirtySourcePaths: new Set([caseOldPath, caseNewPath]),
		affectedOperonIds: new Set(caseIds),
		forceFull: false,
	}, base.manifestPayload));
	equal(caseOnly.mode, 'incremental');
	check(caseOnly.dirtyShardIds.length >= 1 && caseOnly.dirtyShardIds.length <= 2);
	await assertMatchesFullCompile(caseRenamed, caseStats, base, caseOnly);

	const excludedPayloads = new Map(base.shardPayloads);
	for (const [shardId, payload] of deletion.changedShardPayloads) excludedPayloads.set(shardId, payload);
	const reIncluded = await compileIndexV8Incremental({
		...compileInput(original, originalStats, {
			sequence: 6,
			dirtySourcePaths: new Set([deletePath]),
			affectedOperonIds: new Set(removedIds),
			forceFull: false,
		}, deletion.manifestPayload, THIRD_TIME),
		baseMembership: buildIndexV8BaselineMembership(deleted),
	});
	equal(reIncluded.mode, 'incremental');
	check(reIncluded.dirtyShardIds.includes(getIndexV8ShardId(deletePath)));
	await assertMatchesFullCompile(original, originalStats, {
		...base,
		manifest: deletion.manifest,
		manifestPayload: deletion.manifestPayload,
		shardPayloads: excludedPayloads,
	}, reIncluded, THIRD_TIME);
}

async function testAddSameShardBatchAndDuplicateCanonicalMove(): Promise<void> {
	const original = createSyntheticIndexData(320);
	const originalStats = sourceStats(original);
	const base = await fullSnapshot(original, originalStats);

	const added = structuredClone(original);
	const addedStats = new Map(originalStats);
	const seed = Object.values(added.taskInstances ?? {})[0];
	const addedPath = 'Synthetic/New-Source.md';
	const addedId = 'synthetic-added-task';
	const addedKey = deriveIndexV8InstanceKey(addedPath, 0, 'inline');
	const addedInstance: IndexedTaskInstance = {
		...seed,
		instanceKey: addedKey,
		operonId: addedId,
		description: 'Synthetic added task',
		primary: { filePath: addedPath, lineNumber: 0, format: 'inline' },
	};
	added.taskInstances![addedKey] = addedInstance;
	const addedCanonical = { ...addedInstance };
	delete (addedCanonical as { instanceKey?: string }).instanceKey;
	added.tasks[addedId] = addedCanonical;
	addedStats.set(addedPath, { mtimeMs: Date.parse(SECOND_TIME), sizeBytes: 512 });
	const addition = await compileIndexV8Incremental(compileInput(added, addedStats, {
		sequence: 10,
		dirtySourcePaths: new Set([addedPath]),
		affectedOperonIds: new Set([addedId]),
		forceFull: false,
	}, base.manifestPayload));
	equal(addition.mode, 'incremental');
	equal(addition.shardsWritten, 1);
	equal(addition.manifest.totals.sourceCount, base.manifest.totals.sourceCount + 1);
	await assertMatchesFullCompile(added, addedStats, base, addition);

	const sameShard = structuredClone(original);
	const sameShardStats = new Map(originalStats);
	const pathsByShard = new Map<string, string[]>();
	for (const path of originalStats.keys()) {
		const shardId = getIndexV8ShardId(path);
		const paths = pathsByShard.get(shardId) ?? [];
		paths.push(path);
		pathsByShard.set(shardId, paths);
	}
	const sameShardPaths = [...pathsByShard.values()].find(paths => paths.length >= 2)?.slice(0, 2);
	check(sameShardPaths, 'Synthetic fixture must provide two sources in one shard');
	const sameShardSet = new Set(sameShardPaths);
	const sameShardIds = new Set<string>();
	for (const instance of Object.values(sameShard.taskInstances ?? {})) {
		if (!sameShardSet.has(instance.primary.filePath)) continue;
		instance.description += ' same-shard batch';
		sameShard.tasks[instance.operonId].description = instance.description;
		sameShardIds.add(instance.operonId);
	}
	for (const path of sameShardSet) {
		sameShardStats.set(path, { ...sameShardStats.get(path)!, mtimeMs: Date.parse(SECOND_TIME) });
	}
	const batch = await compileIndexV8Incremental(compileInput(sameShard, sameShardStats, {
		sequence: 11,
		dirtySourcePaths: sameShardSet,
		affectedOperonIds: sameShardIds,
		forceFull: false,
	}, base.manifestPayload));
	equal(batch.dirtyShardIds.length, 1);
	equal(batch.shardsWritten, 1, 'multiple dirty sources in one shard must serialize once');
	await assertMatchesFullCompile(sameShard, sameShardStats, base, batch);

	const duplicateBaseData = structuredClone(original);
	const duplicateSeed = Object.values(duplicateBaseData.taskInstances ?? {})[0];
	const duplicatePath = findPathInDifferentShard(duplicateSeed.primary.filePath);
	const duplicateKey = deriveIndexV8InstanceKey(duplicatePath, 0, 'inline');
	const duplicateInstance: IndexedTaskInstance = {
		...duplicateSeed,
		instanceKey: duplicateKey,
		description: `${duplicateSeed.description} duplicate`,
		primary: { filePath: duplicatePath, lineNumber: 0, format: 'inline' },
	};
	duplicateBaseData.taskInstances![duplicateKey] = duplicateInstance;
	const duplicateStats = sourceStats(duplicateBaseData);
	const duplicateBase = await fullSnapshot(duplicateBaseData, duplicateStats);
	const canonicalMoved = structuredClone(duplicateBaseData);
	const nextCanonical = { ...canonicalMoved.taskInstances![duplicateKey] };
	delete (nextCanonical as { instanceKey?: string }).instanceKey;
	canonicalMoved.tasks[duplicateSeed.operonId] = nextCanonical;
	const canonicalMove = await compileIndexV8Incremental(compileInput(canonicalMoved, duplicateStats, {
		sequence: 12,
		dirtySourcePaths: new Set(),
		affectedOperonIds: new Set([duplicateSeed.operonId]),
		forceFull: false,
	}, duplicateBase.manifestPayload));
	equal(canonicalMove.dirtyShardIds.length, 2);
	equal(canonicalMove.shardsWritten, 2, 'cross-shard canonical markers must move atomically');
	await assertMatchesFullCompile(canonicalMoved, duplicateStats, duplicateBase, canonicalMove);

	const omittedAffectedIds = await compileIndexV8Incremental(compileInput(canonicalMoved, duplicateStats, {
		sequence: 13,
		dirtySourcePaths: new Set([duplicateSeed.primary.filePath]),
		affectedOperonIds: new Set(),
		forceFull: false,
	}, duplicateBase.manifestPayload, THIRD_TIME));
	equal(omittedAffectedIds.mode, 'incremental');
	equal(omittedAffectedIds.dirtyShardIds.length, 2, 'baseline membership must close omitted duplicate IDs');
	equal(omittedAffectedIds.shardsWritten, 2, 'candidate overlay must update both canonical-marker shards');
	await assertMatchesFullCompile(canonicalMoved, duplicateStats, duplicateBase, omittedAffectedIds, THIRD_TIME);
}

async function testFullFallbackAndAuthorityGuards(): Promise<void> {
	const data = createSyntheticIndexData(100);
	const stats = sourceStats(data);
	const base = await fullSnapshot(data, stats);
	const staleIndexes = buildIndexV8RamSourceIndexes(data);
	const changed = changeFirstTask(data);
	const changedStats = new Map(stats);
	changedStats.set(changed.path, { ...changedStats.get(changed.path)!, mtimeMs: Date.parse(SECOND_TIME) });
	const staleIndexResult = await compileIndexV8Incremental({
		...compileInput(data, changedStats, {
			sequence: 5,
			dirtySourcePaths: new Set([changed.path]),
			affectedOperonIds: new Set([changed.operonId]),
			forceFull: false,
		}, base.manifestPayload),
		sourceIndexes: staleIndexes,
	});
	equal(staleIndexResult.mode, 'incremental', 'content-only changes keep source membership indexes valid');

	const validMembership = buildIndexV8RamSourceIndexes(data);
	const wrongMembership = {
		sourceInstanceKeys: new Map(Array.from(validMembership.sourceInstanceKeys, ([path, keys]) => [path, new Set(keys)])),
		sourcePathsByShard: validMembership.sourcePathsByShard,
	};
	const sourceEntries = [...wrongMembership.sourceInstanceKeys.entries()];
	check(sourceEntries.length >= 2);
	const [firstPath, firstKeys] = sourceEntries[0];
	const [secondPath, secondKeys] = sourceEntries[1];
	const firstKey = [...firstKeys][0];
	const secondKey = [...secondKeys][0];
	firstKeys.delete(firstKey);
	firstKeys.add(secondKey);
	secondKeys.delete(secondKey);
	secondKeys.add(firstKey);
	const wrongMembershipResult = await compileIndexV8Incremental({
		...compileInput(data, changedStats, {
			sequence: 51,
			dirtySourcePaths: new Set([firstPath, secondPath]),
			affectedOperonIds: new Set([changed.operonId]),
			forceFull: false,
		}, base.manifestPayload),
		sourceIndexes: wrongMembership,
	});
	equal(wrongMembershipResult.mode, 'full', 'wrong source membership must fail closed to a full compile');

	const tasks = new Map(Object.entries(data.tasks));
	const secondary = new SecondaryIndexes();
	secondary.rebuild(tasks);
	const parityProjection = projectIndexV8IncrementalParity(tasks, secondary);
	await assertIndexV8IncrementalParity(data, parityProjection);
	assertions++;
	parityProjection.secondaryByStatus = [];
	await assert.rejects(
		() => assertIndexV8IncrementalParity(data, parityProjection),
		error => error instanceof IndexV8ParityError && error.code === 'PARITY_MISMATCH',
	);
	assertions++;

	const malformed = structuredClone(data);
	const [instanceKey, instance] = Object.entries(malformed.taskInstances ?? {})[0];
	delete malformed.taskInstances![instanceKey];
	malformed.taskInstances!['wrong-instance-key'] = instance;
	await assert.rejects(
		() => compileIndexV8Incremental(compileInput(malformed, changedStats, {
			sequence: 6,
			dirtySourcePaths: new Set([changed.path]),
			affectedOperonIds: new Set([changed.operonId]),
			forceFull: false,
		}, base.manifestPayload)),
		error => error instanceof IndexV8IncrementalCompileError && error.code === 'AUTHORITY_INCONSISTENT',
	);
	assertions++;

	const forced = await compileIndexV8Incremental(compileInput(data, changedStats, {
		sequence: 7,
		dirtySourcePaths: new Set([changed.path]),
		affectedOperonIds: new Set([changed.operonId]),
		forceFull: true,
	}, base.manifestPayload));
	equal(forced.mode, 'full');
	equal(forced.dirtyShardIds.length, 32);
	equal(forced.changedShardPayloads.size, 32, 'full store commit requires all shard payloads');
}

async function testCompilerStoreIntegrationAndCas(): Promise<void> {
	const data = createSyntheticIndexData(320);
	const stats = sourceStats(data);
	const base = await fullSnapshot(data, stats);
	const adapter = new IndexV8MemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian', 'operon-incremental-test').runtime.indexV8;
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit(base);
	const changed = structuredClone(data);
	const changedStats = new Map(stats);
	const changedTask = changeFirstTask(changed);
	changedStats.set(changedTask.path, { ...changedStats.get(changedTask.path)!, mtimeMs: Date.parse(SECOND_TIME) });
	const compiled = await compileIndexV8Incremental(compileInput(changed, changedStats, {
		sequence: 8,
		dirtySourcePaths: new Set([changedTask.path]),
		affectedOperonIds: new Set([changedTask.operonId]),
		forceFull: false,
	}, base.manifestPayload));
	check(compiled.expectedBaseSnapshotId);
	check(compiled.expectedBaseManifestPayload);
	const operationsBefore = adapter.operations.length;
	const committed = await store.commitIncremental({
		expectedBaseSnapshotId: compiled.expectedBaseSnapshotId,
		expectedBaseManifestPayload: compiled.expectedBaseManifestPayload,
		manifestPayload: compiled.manifestPayload,
		changedShardPayloads: compiled.changedShardPayloads,
	});
	equal(committed.status, 'committed');
	equal(committed.shardsWritten, 1);
	equal(committed.shardsReused, 31);
	const operations = adapter.operations.slice(operationsBefore);
	equal(operations.filter(operation => operation.startsWith(`write:${paths.shardsPath}/`)).length, 1);
	equal(operations.filter(operation => operation.startsWith(`process:${paths.manifestPath}`)).length, 1);
	const loaded = await store.load();
	check(loaded.status === 'loaded');
	if (loaded.status === 'loaded') equal(loaded.manifest.snapshotId, compiled.manifest.snapshotId);

	const next = structuredClone(changed);
	const nextStats = new Map(changedStats);
	const nextTask = changeFirstTask(next, ' again');
	nextStats.set(nextTask.path, { ...nextStats.get(nextTask.path)!, mtimeMs: Date.parse(THIRD_TIME) });
	const staleCandidate = await compileIndexV8Incremental(compileInput(next, nextStats, {
		sequence: 9,
		dirtySourcePaths: new Set([nextTask.path]),
		affectedOperonIds: new Set([nextTask.operonId]),
		forceFull: false,
	}, base.manifestPayload, THIRD_TIME));
	await assert.rejects(
		() => store.commitIncremental({
			expectedBaseSnapshotId: staleCandidate.expectedBaseSnapshotId!,
			expectedBaseManifestPayload: staleCandidate.expectedBaseManifestPayload!,
			manifestPayload: staleCandidate.manifestPayload,
			changedShardPayloads: staleCandidate.changedShardPayloads,
		}),
		error => error instanceof IndexV8StorageError && error.code === 'BASE_SNAPSHOT_CHANGED',
	);
	assertions++;
	const afterStale = await store.load();
	check(afterStale.status === 'loaded');
	if (afterStale.status === 'loaded') equal(afterStale.manifest.snapshotId, compiled.manifest.snapshotId);
}

async function testPersistenceCoordinatorParityGate(): Promise<void> {
	const original = createSyntheticIndexData(320);
	const originalStats = sourceStats(original);
	const base = await fullSnapshot(original, originalStats);
	const adapter = new IndexV8MemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian', 'operon-primary-parity-test').runtime.indexV8;
	const store = new IndexV8Store(adapter.asDataAdapter(), paths);
	await store.commit(base);
	const writer = new IndexV8PersistenceCoordinator(store, {
		scheduler: {
			now: () => Date.now(),
			setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
			clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
			delay: delayMs => new Promise(resolve => globalThis.setTimeout(resolve, delayMs)),
		},
	});
	writer.adoptVerifiedBaseline(base.manifestPayload, original);

	const changed = structuredClone(original);
	const changedStats = new Map(originalStats);
	const changedTask = changeFirstTask(changed);
	changedStats.set(changedTask.path, { ...changedStats.get(changedTask.path)!, mtimeMs: Date.parse(SECOND_TIME) });
	const tasks = new Map(Object.entries(changed.tasks));
	const secondary = new SecondaryIndexes();
	secondary.rebuild(tasks);
	const input: IndexV8PersistenceInput = {
		sequence: 20,
		indexData: changed,
		sourceStats: changedStats,
		committedAt: SECOND_TIME,
		lastFullScanAt: FIRST_TIME,
		indexSemanticsSignature: SEMANTICS,
		coherenceBasis: 'verified-full-scan',
		incrementalParityProjection: projectIndexV8IncrementalParity(tasks, secondary),
	};
	const committed = await writer.persistPrimary(input, {
		sequence: 20,
		dirtySourcePaths: new Set([changedTask.path]),
		affectedOperonIds: new Set([changedTask.operonId]),
		forceFull: false,
	}, buildIndexV8RamSourceIndexes(changed));
	equal(committed.status, 'committed');
	equal(committed.mode, 'incremental');
	equal(committed.shardsWritten, 1);

	const next = structuredClone(changed);
	const nextStats = new Map(changedStats);
	const nextTask = changeFirstTask(next, ' parity-blocked');
	nextStats.set(nextTask.path, { ...nextStats.get(nextTask.path)!, mtimeMs: Date.parse(THIRD_TIME) });
	const nextTasks = new Map(Object.entries(next.tasks));
	const nextSecondary = new SecondaryIndexes();
	nextSecondary.rebuild(nextTasks);
	const invalidProjection = projectIndexV8IncrementalParity(nextTasks, nextSecondary);
	invalidProjection.secondaryByPriority = [['__corrupt__', ['hidden-task']]];
	await assert.rejects(
		() => writer.persistPrimary({
			...input,
			sequence: 21,
			indexData: next,
			sourceStats: nextStats,
			committedAt: THIRD_TIME,
			incrementalParityProjection: invalidProjection,
		}, {
			sequence: 21,
			dirtySourcePaths: new Set([nextTask.path]),
			affectedOperonIds: new Set([nextTask.operonId]),
			forceFull: false,
		}, buildIndexV8RamSourceIndexes(next)),
		error => error instanceof IndexV8ParityError && error.code === 'PARITY_MISMATCH',
	);
	assertions++;
	const loaded = await store.load();
	check(loaded.status === 'loaded');
	if (loaded.status === 'loaded') equal(loaded.manifest.snapshotId, committed.snapshotId);

	const forceFullCandidate = structuredClone(changed);
	const forceFullStats = new Map(changedStats);
	const forceFullTask = changeFirstTask(forceFullCandidate, ' full-cas-candidate');
	forceFullStats.set(forceFullTask.path, {
		...forceFullStats.get(forceFullTask.path)!,
		mtimeMs: Date.parse(THIRD_TIME),
	});
	const winnerData = structuredClone(changed);
	const winnerStats = new Map(changedStats);
	const winnerTask = changeFirstTask(winnerData, ' full-cas-winner');
	winnerStats.set(winnerTask.path, { ...winnerStats.get(winnerTask.path)!, mtimeMs: Date.parse(THIRD_TIME) });
	const winner = await fullSnapshot(winnerData, winnerStats, THIRD_TIME);
	let installedWinner = false;
	adapter.beforeProcess = path => {
		if (installedWinner || path !== paths.manifestPath) return;
		installedWinner = true;
		for (const descriptor of winner.manifest.shards) {
			adapter.setFile(
				`${paths.shardsPath}/${descriptor.shardId}-${descriptor.sha256}.json`,
				winner.shardPayloads.get(descriptor.shardId)!,
			);
		}
		adapter.setFile(paths.manifestPath, winner.manifestPayload);
	};
	const forceFullTasks = new Map(Object.entries(forceFullCandidate.tasks));
	const forceFullSecondary = new SecondaryIndexes();
	forceFullSecondary.rebuild(forceFullTasks);
	await assert.rejects(
		() => writer.persistPrimary({
			...input,
			sequence: 22,
			indexData: forceFullCandidate,
			sourceStats: forceFullStats,
			committedAt: THIRD_TIME,
			incrementalParityProjection: projectIndexV8IncrementalParity(forceFullTasks, forceFullSecondary),
		}, {
			sequence: 22,
			dirtySourcePaths: new Set([forceFullTask.path]),
			affectedOperonIds: new Set([forceFullTask.operonId]),
			forceFull: true,
		}, buildIndexV8RamSourceIndexes(forceFullCandidate)),
		error => error instanceof IndexV8StorageError && error.code === 'BASE_SNAPSHOT_CHANGED',
	);
	assertions++;
	adapter.beforeProcess = null;
	equal(adapter.files.get(paths.manifestPath), winner.manifestPayload, 'full compile must preserve an interleaving winner');
}

async function run(): Promise<void> {
	await testSourceIndexesAndDirtyClosure();
	await testSingleShardNoopDeleteAndRename();
	await testAddSameShardBatchAndDuplicateCanonicalMove();
	await testFullFallbackAndAuthorityGuards();
	await testCompilerStoreIntegrationAndCas();
	await testPersistenceCoordinatorParityGate();
	process.stdout.write(`${JSON.stringify({ ok: true, assertions })}\n`);
}

declare global {
	var __operonIndexV8IncrementalTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8IncrementalTestRun = run();
