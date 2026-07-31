import assert from 'node:assert/strict';
import type { IndexedTaskInstance } from '../src/types/fields';
import {
	buildIndexV8Snapshot,
	decodeIndexV8Manifest,
	deriveIndexV8InstanceKey,
	finalizeValidatedIndexV8Snapshot,
	hydrateIndexV8Shards,
	hydrateValidatedIndexV8Snapshot,
	selectCanonicalIndexV8InstanceKey,
	stableCompactStringify,
	utf8ByteLength,
	validateIndexV8Manifest,
	validateIndexV8ShardPayload,
	validateIndexV8Snapshot,
	type IndexV8SourceInput,
} from '../src/indexer/persistence/index-v8-codec';
import {
	INDEX_V8_LAYOUT_VERSION,
	INDEX_V8_MAX_MANIFEST_BYTES,
	INDEX_V8_MAX_SHARD_BYTES,
	INDEX_V8_SCHEMA_VERSION,
	INDEX_V8_SHARD_COUNT,
} from '../src/indexer/persistence/index-v8-contract';
import {
	fnv1a32Utf8Nfc,
	getAllIndexV8ShardIds,
	getIndexV8ShardId,
	normalizeIndexV8SourcePath,
} from '../src/indexer/persistence/index-v8-partition';
import { createSyntheticIndexData, createV8SourcesFromIndexData } from './index-v8-fixtures';
import { buildIndexV8SemanticsSignature } from '../src/indexer/persistence/index-v8-semantics';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import {
	enginePerfLog,
	formatEnginePerfTraceMetadata,
	setOperonEnginePerfDebug,
} from '../src/core/engine-perf';

const FIXED_TIME = '2026-01-02T03:04:05.000Z';
let assertions = 0;

function check(condition: unknown, message?: string): asserts condition {
	assert.ok(condition, message);
	assertions++;
}

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions++;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions++;
}

async function rejects(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
	await assert.rejects(async () => await action(), pattern);
	assertions++;
}

function snapshotInput(sources: IndexV8SourceInput[], canonicalInstanceKeys?: ReadonlySet<string>) {
	return {
		committedAt: FIXED_TIME,
		lastFullScanAt: FIXED_TIME,
		coherenceBasis: 'verified-full-scan' as const,
		indexSemanticsSignature: 'test-semantics-v1',
		sources,
		...(canonicalInstanceKeys ? { canonicalInstanceKeys } : {}),
	};
}

function makeDuplicateSources(): IndexV8SourceInput[] {
	const data = createSyntheticIndexData(2);
	const instances = Object.values(data.taskInstances ?? {});
	const first = instances[0];
	const second: IndexedTaskInstance = {
		...instances[1],
		operonId: first.operonId,
		primary: { filePath: 'Duplicates/Second.md', lineNumber: 0, format: 'inline' },
		instanceKey: deriveIndexV8InstanceKey('Duplicates/Second.md', 0, 'inline'),
	};
	const firstMoved: IndexedTaskInstance = {
		...first,
		primary: { filePath: 'Duplicates/First.md', lineNumber: 0, format: 'inline' },
		instanceKey: deriveIndexV8InstanceKey('Duplicates/First.md', 0, 'inline'),
	};
	return [
		{ path: 'Duplicates/First.md', mtimeMs: 1, sizeBytes: 100, instances: [firstMoved] },
		{ path: 'Duplicates/Second.md', mtimeMs: 2, sizeBytes: 100, instances: [second] },
	];
}

function distribution(snapshot: Awaited<ReturnType<typeof buildIndexV8Snapshot>>) {
	const bytes = snapshot.manifest.shards.map(shard => shard.bytes);
	const total = bytes.reduce((sum, value) => sum + value, 0);
	const average = total / bytes.length;
	return { total, average, max: Math.max(...bytes), maxToAverage: Math.max(...bytes) / average };
}

function assertNoForbiddenPersistedKeys(value: unknown): void {
	if (Array.isArray(value)) {
		for (const entry of value) assertNoForbiddenPersistedKeys(entry);
		return;
	}
	if (typeof value !== 'object' || value === null) return;
	for (const [key, entry] of Object.entries(value)) {
		check(!['tasks', 'pinned', 'instanceKey', 'filePath', 'primary', 'tier'].includes(key), `forbidden persisted key: ${key}`);
		assertNoForbiddenPersistedKeys(entry);
	}
}

async function run(): Promise<void> {
	const debugLines: string[] = [];
	const originalDebug = console.debug;
	console.debug = (...args: unknown[]) => { debugLines.push(args.join(' ')); };
	try {
		setOperonEnginePerfDebug(false);
		enginePerfLog('disabled-probe', 'must-not-appear');
		equal(debugLines.length, 0);
		setOperonEnginePerfDebug(true);
		enginePerfLog('enabled-probe', ...formatEnginePerfTraceMetadata({
			traceId: 'trace-1',
			taskId: 'task-1',
			format: 'inline',
			filePath: 'Private/Path.md',
			changedKeys: ['status', 'priority'],
			reason: 'test',
		}));
		equal(debugLines.length, 1);
		check(!debugLines[0].includes('Private/Path.md'));
		check(debugLines[0].includes('changedKeys=status,priority'));
	} finally {
		setOperonEnginePerfDebug(false);
		console.debug = originalDebug;
	}

	deepEqual(getAllIndexV8ShardIds(), Array.from({ length: 32 }, (_unused, index) => index.toString(16).padStart(2, '0')));
	equal(INDEX_V8_SHARD_COUNT, 32);
	equal(INDEX_V8_MAX_MANIFEST_BYTES, 256_000);
	equal(getAllIndexV8ShardIds()[0], '00');
	equal(getAllIndexV8ShardIds()[31], '1f');

	equal(normalizeIndexV8SourcePath('Folder\\Cafe\u0301.md'), 'Folder/Café.md');
	equal(normalizeIndexV8SourcePath('Folder/Task.md'), 'Folder/Task.md');
	equal(normalizeIndexV8SourcePath('folder/Task.md'), 'folder/Task.md');
	equal(fnv1a32Utf8Nfc('a'), 0xe40c292c);
	equal(getIndexV8ShardId('Folder/Cafe\u0301.md'), getIndexV8ShardId('Folder/Café.md'));
	equal(
		selectCanonicalIndexV8InstanceKey(['inline:Tasks/é.md:0', 'inline:Tasks/A.md:0', 'inline:Tasks/a.md:0']),
		'inline:Tasks/A.md:0',
	);
	for (const unsafe of ['/absolute.md', '../outside.md', 'Folder/../outside.md', 'Folder//Task.md', 'C:/Task.md', 'Folder/./Task.md', 'Folder/Task\u0000.md']) {
		await rejects(() => Promise.resolve(normalizeIndexV8SourcePath(unsafe)), /safe|unsafe/);
	}

	const sourceData = createSyntheticIndexData(100);
	const sources = createV8SourcesFromIndexData(sourceData);
	const forward = await buildIndexV8Snapshot(snapshotInput(sources));
	const reversed = await buildIndexV8Snapshot(snapshotInput([...sources].reverse().map(source => ({
		...source,
		instances: [...source.instances].reverse(),
	}))));
	equal(forward.manifestPayload, reversed.manifestPayload);
	deepEqual([...forward.shardPayloads], [...reversed.shardPayloads]);
	equal(forward.manifest.coherenceBasis, 'verified-full-scan');
	await rejects(
		() => buildIndexV8Snapshot({
			...snapshotInput(sources),
			coherenceBasis: undefined,
		} as unknown as Parameters<typeof buildIndexV8Snapshot>[0]),
		/coherence basis/i,
	);
	await rejects(
		() => buildIndexV8Snapshot({
			...snapshotInput(sources),
			coherenceBasis: 'future-basis',
		} as unknown as Parameters<typeof buildIndexV8Snapshot>[0]),
		/coherence basis/i,
	);
	equal(forward.manifest.shards.length, 32);
	equal(forward.manifest.schemaVersion, INDEX_V8_SCHEMA_VERSION);
	equal(forward.manifest.layoutVersion, INDEX_V8_LAYOUT_VERSION);
	equal(forward.manifest.totals.sourceCount, sources.length);
	equal(forward.manifest.totals.taskInstanceCount, 100);
	for (const descriptor of forward.manifest.shards) {
		check(descriptor.path === `shards/${descriptor.shardId}-${descriptor.sha256}.json`);
		equal(descriptor.bytes, utf8ByteLength(forward.shardPayloads.get(descriptor.shardId)!));
	}

	const validated = await validateIndexV8Snapshot(forward.manifestPayload, forward.shardPayloads);
	const hydrated = hydrateIndexV8Shards(validated.shards);
	deepEqual(hydrateValidatedIndexV8Snapshot(validated), hydrated);
	const postValidationMutation = structuredClone(validated);
	const mutableSource = postValidationMutation.shards.flatMap(shard => shard.sources)[0];
	check(mutableSource.instances.length > 0);
	mutableSource.instances.push(structuredClone(mutableSource.instances[0]));
	await rejects(
		() => Promise.resolve(hydrateValidatedIndexV8Snapshot(postValidationMutation)),
		/Duplicate task instance key/,
	);
	const independentlyValidatedManifest = await validateIndexV8Manifest(forward.manifestPayload);
	const independentlyValidatedParts = await Promise.all(independentlyValidatedManifest.shards.map(async descriptor => (
		await validateIndexV8ShardPayload(descriptor, forward.shardPayloads.get(descriptor.shardId)!)
	)));
	await rejects(
		() => Promise.resolve(finalizeValidatedIndexV8Snapshot(validated.manifest, independentlyValidatedParts)),
		/descriptor mismatch/,
	);
	equal(hydrated.taskInstances.size, 100);
	equal(hydrated.tasks.size, 100);
	for (const original of Object.values(sourceData.taskInstances ?? {})) {
		const roundTrip = hydrated.taskInstances.get(original.instanceKey);
		deepEqual(roundTrip, original);
	}

	const duplicateSources = makeDuplicateSources();
	const duplicateCanonicalKey = deriveIndexV8InstanceKey('Duplicates/Second.md', 0, 'inline');
	const duplicateSnapshot = await buildIndexV8Snapshot(snapshotInput(
		duplicateSources,
		new Set([duplicateCanonicalKey]),
	));
	const duplicateValidated = await validateIndexV8Snapshot(duplicateSnapshot.manifestPayload, duplicateSnapshot.shardPayloads);
	const duplicateHydrated = hydrateIndexV8Shards(duplicateValidated.shards);
	equal(duplicateHydrated.taskInstances.size, 2);
	equal(duplicateHydrated.tasks.size, 1);
	check(duplicateHydrated.duplicateOperonIds.size === 1);
	equal(duplicateHydrated.tasks.values().next().value?.primary.filePath, 'Duplicates/Second.md');
	await rejects(
		() => buildIndexV8Snapshot(snapshotInput(duplicateSources)),
		/requires exactly one canonical instance/,
	);
	const decomposedDuplicateSources = makeDuplicateSources();
	const decomposedPath = 'Duplicates/Cafe\u0301.md';
	decomposedDuplicateSources[0].path = decomposedPath;
	decomposedDuplicateSources[0].instances[0].primary.filePath = decomposedPath;
	decomposedDuplicateSources[0].instances[0].instanceKey = `inline:${decomposedPath}:0`;
	const decomposedCanonicalKey = deriveIndexV8InstanceKey(decomposedPath, 0, 'inline');
	const decomposedSnapshot = await buildIndexV8Snapshot(snapshotInput(
		decomposedDuplicateSources,
		new Set([decomposedCanonicalKey]),
	));
	equal(
		hydrateIndexV8Shards(decomposedSnapshot.shards).tasks.values().next().value?.primary.filePath,
		'Duplicates/Café.md',
	);
	const tierData = createSyntheticIndexData(1);
	const tierInstance = Object.values(tierData.taskInstances ?? {})[0];
	tierInstance.checkbox = 'done';
	tierInstance.fieldValues.dateCompleted = '2026-01-01';
	tierInstance.tier = 'cold';
	const tierSnapshot = await buildIndexV8Snapshot(snapshotInput(createV8SourcesFromIndexData(tierData)));
	const tierValidated = await validateIndexV8Snapshot(tierSnapshot.manifestPayload, tierSnapshot.shardPayloads);
	equal(hydrateIndexV8Shards(tierValidated.shards, Date.parse('2026-02-01T00:00:00Z')).tasks.get(tierInstance.operonId)?.tier, 'warm');
	equal(hydrateIndexV8Shards(tierValidated.shards, Date.parse('2026-05-01T00:00:00Z')).tasks.get(tierInstance.operonId)?.tier, 'cold');
	const compactOffsetData = createSyntheticIndexData(1);
	const compactOffsetInstance = Object.values(compactOffsetData.taskInstances ?? {})[0];
	compactOffsetInstance.datetimeModified = '2026-01-02T03:04:05+0200';
	const compactOffsetSnapshot = await buildIndexV8Snapshot(snapshotInput(createV8SourcesFromIndexData(compactOffsetData)));
	equal(
		hydrateIndexV8Shards(compactOffsetSnapshot.shards).tasks.get(compactOffsetInstance.operonId)?.datetimeModified,
		compactOffsetInstance.datetimeModified,
	);
	for (const rawTimestamp of ['2026-01-02T03:04', 'manually-authored-value']) {
		const rawTimestampData = createSyntheticIndexData(1);
		const rawTimestampInstance = Object.values(rawTimestampData.taskInstances ?? {})[0];
		rawTimestampInstance.datetimeModified = rawTimestamp;
		const rawTimestampSnapshot = await buildIndexV8Snapshot(snapshotInput(createV8SourcesFromIndexData(rawTimestampData)));
		equal(
			hydrateIndexV8Shards(rawTimestampSnapshot.shards).tasks.get(rawTimestampInstance.operonId)?.datetimeModified,
			rawTimestamp,
		);
	}

	const persisted = JSON.parse(forward.manifestPayload) as unknown;
	assertNoForbiddenPersistedKeys(persisted);
	for (const payload of forward.shardPayloads.values()) assertNoForbiddenPersistedKeys(JSON.parse(payload) as unknown);

	await rejects(() => Promise.resolve(decodeIndexV8Manifest('{broken')), /Invalid manifest JSON/);
	const wrongSchema = JSON.parse(forward.manifestPayload) as Record<string, unknown>;
	wrongSchema.schemaVersion = 9;
	await rejects(() => Promise.resolve(decodeIndexV8Manifest(stableCompactStringify(wrongSchema))), /schema/);
	const wrongLayout = JSON.parse(forward.manifestPayload) as Record<string, unknown>;
	wrongLayout.layoutVersion = 2;
	await rejects(() => Promise.resolve(decodeIndexV8Manifest(stableCompactStringify(wrongLayout))), /layout/);
	const missingCoherenceBasis = JSON.parse(forward.manifestPayload) as Record<string, unknown>;
	delete missingCoherenceBasis.coherenceBasis;
	await rejects(
		() => Promise.resolve(decodeIndexV8Manifest(stableCompactStringify(missingCoherenceBasis))),
		/coherence basis/i,
	);
	const invalidCoherenceBasis = JSON.parse(forward.manifestPayload) as Record<string, unknown>;
	invalidCoherenceBasis.coherenceBasis = 'future-basis';
	await rejects(
		() => Promise.resolve(decodeIndexV8Manifest(stableCompactStringify(invalidCoherenceBasis))),
		/coherence basis/i,
	);
	const tamperedShards = new Map(forward.shardPayloads);
	const tamperedId = forward.manifest.shards.find(descriptor => descriptor.sourceCount > 0)!.shardId;
	tamperedShards.set(tamperedId, `${tamperedShards.get(tamperedId)!} `);
	await rejects(() => validateIndexV8Snapshot(forward.manifestPayload, tamperedShards), /byte count|checksum/);
	const shortManifest = structuredClone(forward.manifest);
	shortManifest.shards.pop();
	await rejects(
		() => validateIndexV8Snapshot(stableCompactStringify(shortManifest), forward.shardPayloads),
		/exactly 32/,
	);
	const changedCommitTime = structuredClone(forward.manifest);
	changedCommitTime.committedAt = '2026-01-02T03:04:06.000Z';
	await rejects(
		() => validateIndexV8Snapshot(stableCompactStringify(changedCommitTime), forward.shardPayloads),
		/snapshot ID/,
	);

	await rejects(
		() => buildIndexV8Snapshot(snapshotInput([sources[0], sources[0]])),
		/Duplicate source path/,
	);
	const duplicateLocation = structuredClone(sources[0]);
	duplicateLocation.instances.push(structuredClone(duplicateLocation.instances[0]));
	await rejects(
		() => buildIndexV8Snapshot(snapshotInput([duplicateLocation])),
		/Duplicate task instance location/,
	);
	const invalidMtimeShard = structuredClone(forward.shards[0]);
	invalidMtimeShard.sources = [{ ...structuredClone(sources[0]), mtimeMs: -1 }].map(source => ({
		path: source.path,
		mtimeMs: source.mtimeMs,
		sizeBytes: source.sizeBytes,
		instances: [],
	}));
	await rejects(
		() => Promise.resolve(hydrateIndexV8Shards([invalidMtimeShard])),
		/Invalid source record/,
	);
	const canonicalStringShard = structuredClone(forward.shards.find(shard => shard.sources.length > 0)!);
	(canonicalStringShard.sources[0].instances[0] as unknown as { canonical: string }).canonical = 'yes';
	await rejects(
		() => Promise.resolve(hydrateIndexV8Shards([canonicalStringShard])),
		/Invalid source record/,
	);
	const uniqueCanonicalShard = structuredClone(forward.shards.find(shard => shard.sources.length > 0)!);
	uniqueCanonicalShard.sources[0].instances[0].canonical = true;
	await rejects(
		() => Promise.resolve(hydrateIndexV8Shards([uniqueCanonicalShard])),
		/Unique operonId must not carry a canonical marker/,
	);
	const giantSource = structuredClone(sources[0]);
	giantSource.instances = [structuredClone(giantSource.instances[0])];
	giantSource.instances[0].description = 'x'.repeat(INDEX_V8_MAX_SHARD_BYTES);
	await rejects(
		() => buildIndexV8Snapshot(snapshotInput([giantSource])),
		/exceeds the 4000000-byte contract limit/,
	);

	const semanticsBase = structuredClone(DEFAULT_SETTINGS);
	const baseSignature = buildIndexV8SemanticsSignature(semanticsBase);
	const workflowChanged = structuredClone(semanticsBase);
	workflowChanged.pipelines[0].statuses[0].isFinished = !workflowChanged.pipelines[0].statuses[0].isFinished;
	check(buildIndexV8SemanticsSignature(workflowChanged) !== baseSignature);
	const mappingChanged = structuredClone(semanticsBase);
	mappingChanged.keyMappings[0].visiblePropertyName = `${mappingChanged.keyMappings[0].visiblePropertyName} Changed`;
	check(buildIndexV8SemanticsSignature(mappingChanged) !== baseSignature);
	const exclusionChanged = structuredClone(semanticsBase);
	exclusionChanged.excludedFolders = ['Private'];
	check(buildIndexV8SemanticsSignature(exclusionChanged) !== baseSignature);
	const templateFolderChanged = structuredClone(semanticsBase);
	templateFolderChanged.fileTaskTemplateFolder = 'Templates/Tasks';
	check(buildIndexV8SemanticsSignature(templateFolderChanged) !== baseSignature);
	const uiOnlyChanged = structuredClone(semanticsBase);
	uiOnlyChanged.kanbanTaskShowNoteAction = !uiOnlyChanged.kanbanTaskShowNoteAction;
	equal(buildIndexV8SemanticsSignature(uiOnlyChanged), baseSignature);

	for (const count of [5_300, 25_000]) {
		const data = createSyntheticIndexData(count);
		const snapshot = await buildIndexV8Snapshot(snapshotInput(createV8SourcesFromIndexData(data)));
		const stats = distribution(snapshot);
		equal(snapshot.manifest.shards.length, 32);
		check(stats.maxToAverage <= 3, `${count} distribution ratio was ${stats.maxToAverage}`);
		check(stats.max < (count === 5_300 ? 1_000_000 : 4_000_000), `${count} max shard was ${stats.max}`);
	}

	process.stdout.write(`${JSON.stringify({ ok: true, assertions })}\n`);
}

declare global {
	var __operonIndexV8ContractTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8ContractTestRun = run();
