import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import type { IndexData } from '../src/types/fields';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { setOperonEnginePerfDebug } from '../src/core/engine-perf';
import { OperonIndexer } from '../src/indexer/indexer';
import {
	buildIndexV8Snapshot,
	decodeIndexV8Manifest,
	getIndexV8CanonicalInstanceKeys,
	projectIndexDataToV8Sources,
	type IndexV8SourceStat,
} from '../src/indexer/persistence/index-v8-codec';
import { compareIndexV8Parity } from '../src/indexer/persistence/index-v8-parity';
import {
	IndexV8PersistenceCoordinator,
	sealIndexData,
	type IndexV8PersistenceInput,
	type IndexV8PersistenceScheduler,
	type IndexV8PersistenceStore,
} from '../src/indexer/persistence/index-v8-persistence-coordinator';
import {
	IndexV8StorageError,
	IndexV8Store,
	type IndexV8CommitResult,
	type IndexV8SnapshotPayloads,
} from '../src/indexer/persistence/index-v8-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { createSyntheticIndexData } from './index-v8-fixtures';
import { IndexV8MemoryAdapter } from './index-v8-memory-adapter';

const BASE_TIME_MS = Date.parse('2026-01-02T03:04:05.000Z');
const FULL_SCAN_TIME = '2026-01-02T03:00:00.000Z';
const PRIVATE_DESCRIPTION = 'private persistence description';
const PRIVATE_PATH = 'Private/Persistence Fixture.md';
const PRIVATE_ID = 'private-persistence-id';
let assertions = 0;

function check(condition: unknown, message?: string): asserts condition {
	assert.ok(condition, message);
	assertions++;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions++;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.deepEqual(actual, expected);
	else assert.deepEqual(actual, expected, message);
	assertions++;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

class ManualPersistenceScheduler implements IndexV8PersistenceScheduler {
	private currentMs = 0;
	private nextId = 1;
	private readonly timers = new Map<number, { dueMs: number; callback: () => void }>();

	now(): number { return this.currentMs; }

	setTimeout(callback: () => void, delayMs: number): unknown {
		const id = this.nextId++;
		this.timers.set(id, { dueMs: this.currentMs + Math.max(0, delayMs), callback });
		return id;
	}

	clearTimeout(handle: unknown): void {
		if (typeof handle === 'number') this.timers.delete(handle);
	}

	delay(delayMs: number): Promise<void> {
		return new Promise(resolve => { this.setTimeout(resolve, delayMs); });
	}

	get pendingTimerCount(): number { return this.timers.size; }

	async advanceBy(delayMs: number): Promise<void> {
		const targetMs = this.currentMs + delayMs;
		while (true) {
			const next = [...this.timers.entries()]
				.filter(([, timer]) => timer.dueMs <= targetMs)
				.sort((left, right) => left[1].dueMs - right[1].dueMs || left[0] - right[0])[0];
			if (!next) break;
			this.currentMs = next[1].dueMs;
			this.timers.delete(next[0]);
			next[1].callback();
			await settleMicrotasks();
		}
		this.currentMs = targetMs;
		await settleMicrotasks();
	}
}

class FakePersistenceStore implements IndexV8PersistenceStore {
	readonly commits: IndexV8SnapshotPayloads[] = [];
	commitImpl: ((snapshot: IndexV8SnapshotPayloads, call: number) => Promise<IndexV8CommitResult>) | null = null;

	async commit(snapshot: IndexV8SnapshotPayloads): Promise<IndexV8CommitResult> {
		this.commits.push(snapshot);
		if (this.commitImpl) return await this.commitImpl(snapshot, this.commits.length);
		return commitResult(snapshot);
	}
}

function commitResult(snapshot: IndexV8SnapshotPayloads): IndexV8CommitResult {
	const manifest = decodeIndexV8Manifest(snapshot.manifestPayload);
	return {
		status: 'committed',
		snapshotId: manifest.snapshotId,
		shardsWritten: 32,
		shardsReused: 0,
		bytesWritten: manifest.shards.reduce((total, descriptor) => total + descriptor.bytes, 0),
		manifestWritten: true,
		ioConcurrency: 4,
		metrics: {
			preflightMs: 0,
			transactionQueueWaitMs: 0,
			ensureFoldersMs: 0,
			shardPhaseMs: 0,
			shardExistsMs: 0,
			shardReadMs: 0,
			shardWriteMs: 0,
			shardVerifyMs: 0,
			manifestWriteMs: 0,
			manifestVerifyMs: 0,
			postflightMs: 0,
			totalMs: 0,
		},
	};
}

function makeInput(sequence: number, data: IndexData = createSyntheticIndexData(100)): IndexV8PersistenceInput {
	const sourceStats = new Map<string, IndexV8SourceStat>();
	for (const task of Object.values(data.taskInstances ?? data.tasks)) {
		sourceStats.set(task.primary.filePath, {
			mtimeMs: BASE_TIME_MS,
			sizeBytes: Math.max(1, task.primary.filePath.length * 10),
		});
	}
	return {
		sequence,
		indexData: data,
		sourceStats,
		committedAt: new Date(BASE_TIME_MS + sequence * 1_000).toISOString(),
		lastFullScanAt: FULL_SCAN_TIME,
		indexSemanticsSignature: 'persistence-test-semantics-v1',
		coherenceBasis: 'verified-full-scan',
	};
}

async function buildSnapshot(data: IndexData, basis: IndexV8PersistenceInput['coherenceBasis'] = 'verified-full-scan') {
	return await buildIndexV8Snapshot({
		committedAt: new Date(BASE_TIME_MS).toISOString(),
		lastFullScanAt: FULL_SCAN_TIME,
		coherenceBasis: basis,
		indexSemanticsSignature: 'persistence-test-semantics-v1',
		sources: projectIndexDataToV8Sources(data),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
}

async function settleMicrotasks(): Promise<void> {
	for (let count = 0; count < 8; count++) await Promise.resolve();
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
	for (let count = 0; count < 100; count++) {
		if (predicate()) return;
		await settleMicrotasks();
		await new Promise(resolve => globalThis.setTimeout(resolve, 0));
	}
	throw new Error(`Timed out waiting for ${label}`);
}

async function testParityAndPrivacy(): Promise<void> {
	const data = createSyntheticIndexData(120);
	const snapshot = await buildSnapshot(data);
	const parity = await compareIndexV8Parity(data, snapshot, BASE_TIME_MS);
	check(parity.ok);
	if (parity.ok) equal(parity.checkedDimensions, 14);

	const ignored = structuredClone(data);
	for (const task of [...Object.values(ignored.tasks), ...Object.values(ignored.taskInstances ?? {})]) {
		task.tier = task.tier === 'cold' ? 'hot' : 'cold';
		task.fieldValues.pinned = 'true';
	}
	check((await compareIndexV8Parity(ignored, snapshot, BASE_TIME_MS)).ok, 'tier and pinned must not affect parity');

	const privateData = structuredClone(data);
	const firstTask = Object.values(privateData.tasks)[0];
	const firstInstance = Object.values(privateData.taskInstances ?? {})[0];
	firstTask.description = PRIVATE_DESCRIPTION;
	firstTask.operonId = PRIVATE_ID;
	firstTask.primary.filePath = PRIVATE_PATH;
	firstInstance.description = PRIVATE_DESCRIPTION;
	firstInstance.operonId = PRIVATE_ID;
	firstInstance.primary.filePath = PRIVATE_PATH;
	const mismatch = await compareIndexV8Parity(privateData, snapshot, BASE_TIME_MS);
	check(!mismatch.ok);
	if (!mismatch.ok) {
		check(mismatch.mismatches.length > 0);
		const serialized = JSON.stringify(mismatch);
		check(!serialized.includes(PRIVATE_DESCRIPTION));
		check(!serialized.includes(PRIVATE_PATH));
		check(!serialized.includes(PRIVATE_ID));
		check(mismatch.mismatches.every(item => /^[a-f0-9]{64}$/u.test(item.leftDigest)));
		check(mismatch.mismatches.every(item => /^[a-f0-9]{64}$/u.test(item.rightDigest)));
	}

	const sourceInput = makeInput(1, data);
	const metadataSnapshot = await buildIndexV8Snapshot({
		committedAt: sourceInput.committedAt,
		lastFullScanAt: sourceInput.lastFullScanAt,
		coherenceBasis: sourceInput.coherenceBasis,
		indexSemanticsSignature: sourceInput.indexSemanticsSignature,
		sources: projectIndexDataToV8Sources(data, sourceInput.sourceStats),
		canonicalInstanceKeys: getIndexV8CanonicalInstanceKeys(data),
	});
	check((await compareIndexV8Parity(data, metadataSnapshot, BASE_TIME_MS, sourceInput.sourceStats)).ok, 'metadata parity');
	const changedStats = new Map(sourceInput.sourceStats);
	const [changedPath, changedStat] = changedStats.entries().next().value!;
	changedStats.set(changedPath, { ...changedStat, sizeBytes: changedStat.sizeBytes + 1 });
	const metadataMismatch = await compareIndexV8Parity(data, metadataSnapshot, BASE_TIME_MS, changedStats);
	check(!metadataMismatch.ok, 'metadata mismatch');
	if (!metadataMismatch.ok) {
		deepEqual(metadataMismatch.mismatches.map(item => item.dimension), ['source-metadata']);
	}

	const secondaryCases: Array<{
		dimension: 'secondary-by-status' | 'secondary-by-due' | 'secondary-by-parent'
			| 'secondary-by-file' | 'secondary-by-workflow-status' | 'secondary-by-priority';
		mutate(task: IndexData['tasks'][string]): void;
	}> = [
		{ dimension: 'secondary-by-status', mutate: task => { task.checkbox = task.checkbox === 'open' ? 'done' : 'open'; } },
		{ dimension: 'secondary-by-due', mutate: task => { task.fieldValues.dateDue = '2099-12-31'; } },
		{ dimension: 'secondary-by-parent', mutate: task => { task.fieldValues.parentTask = 'fixture-parent'; } },
		{ dimension: 'secondary-by-file', mutate: task => { task.primary.filePath = 'Changed/Fixture.md'; } },
		{ dimension: 'secondary-by-workflow-status', mutate: task => { task.fieldValues.status = 'Fixture.Changed'; } },
		{ dimension: 'secondary-by-priority', mutate: task => { task.fieldValues.priority = 'Fixture-Priority'; } },
	];
	for (const testCase of secondaryCases) {
		const changed = structuredClone(data);
		const first = Object.values(changed.tasks)[0];
		const matchingInstance = Object.values(changed.taskInstances ?? {})
			.find(instance => instance.operonId === first.operonId)!;
		testCase.mutate(first);
		testCase.mutate(matchingInstance);
		const result = await compareIndexV8Parity(changed, snapshot, BASE_TIME_MS);
		check(!result.ok, `Expected ${testCase.dimension} mismatch`);
		if (!result.ok) check(
			result.mismatches.some(item => item.dimension === testCase.dimension),
			`Missing ${testCase.dimension} in parity result`,
		);
	}

	const duplicateData = structuredClone(createSyntheticIndexData(2));
	const original = Object.values(duplicateData.taskInstances ?? {})[0];
	const duplicate = structuredClone(original);
	duplicate.primary.filePath = 'Duplicate/Fixture.md';
	duplicate.primary.lineNumber += 10;
	duplicate.instanceKey = `${duplicate.primary.filePath}:${duplicate.primary.lineNumber}:${duplicate.primary.format}`;
	duplicateData.taskInstances![duplicate.instanceKey] = duplicate;
	const duplicateSnapshot = await buildSnapshot(duplicateData);
	check((await compareIndexV8Parity(duplicateData, duplicateSnapshot, BASE_TIME_MS)).ok, 'duplicate parity');
	const changedCanonical = structuredClone(duplicateData);
	changedCanonical.tasks[original.operonId].primary = { ...duplicate.primary };
	const canonicalMismatch = await compareIndexV8Parity(changedCanonical, duplicateSnapshot, BASE_TIME_MS);
	check(!canonicalMismatch.ok, 'canonical mismatch');
	if (!canonicalMismatch.ok) {
		check(canonicalMismatch.mismatches.some(item => item.dimension === 'canonical-selections'));
	}
}

async function testIndexerV8PrimaryOrderingAndSealedSnapshot(): Promise<void> {
	const data = createSyntheticIndexData(2);
	const order: string[] = [];
	const persistenceInputs: IndexV8PersistenceInput[] = [];
	const dirtyBatches: Array<{
		sequence: number;
		dirtySourcePaths: ReadonlySet<string>;
		affectedOperonIds: ReadonlySet<string>;
		forceFull: boolean;
	}> = [];
	let failPrimary = false;
	let primaryStatus: 'committed' | 'unchanged' = 'committed';
	let recoveryMarkerCount = 0;
	const storage = {
		getSettings: () => DEFAULT_SETTINGS,
		markIndexV8RecoveryRequired: async () => { recoveryMarkerCount += 1; },
	};
	const persistence = {
		persistPrimary: async (input: IndexV8PersistenceInput, dirty: typeof dirtyBatches[number]) => {
			order.push('v8-primary');
			if (failPrimary) throw new IndexV8StorageError('INVALID_SNAPSHOT', 'fixture primary failure');
			persistenceInputs.push(input);
			dirtyBatches.push({
				...dirty,
				dirtySourcePaths: new Set(dirty.dirtySourcePaths),
				affectedOperonIds: new Set(dirty.affectedOperonIds),
			});
			return {
				status: primaryStatus,
				mode: dirty.forceFull ? 'full' as const : 'incremental' as const,
				sequence: input.sequence,
				snapshotId: `fixture-${input.sequence}`,
				committedAt: input.committedAt,
				dirtyShardCount: dirty.dirtySourcePaths.size,
				shardsWritten: dirty.dirtySourcePaths.size,
				shardsReused: 32 - dirty.dirtySourcePaths.size,
				bytesWritten: 1,
			};
		},
		disable: (code: string) => { order.push(`v8-disable:${code}`); },
	};
	const app = {
		vault: { getAbstractFileByPath: () => null },
	} as unknown as App;
	const indexer = new OperonIndexer(
		app,
		storage as never,
		persistence as unknown as IndexV8PersistenceCoordinator,
	);
	const mutable = indexer as unknown as {
		tasks: Map<string, IndexData['tasks'][string]>;
		taskInstances: Map<string, NonNullable<IndexData['taskInstances']>[string]>;
		fileMtimes: Map<string, number>;
		fileSizes: Map<string, number>;
		coherentWorkflowStatusSemanticsSignature: string;
		coherenceBasis: 'verified-full-scan';
		lastFullScanAt: string;
		persistIndex(options: {
			immediate?: boolean;
			dirtySourcePaths?: Iterable<string>;
			affectedOperonIds?: Iterable<string>;
			forceFull?: boolean;
		}): Promise<void>;
		flushPendingPersist(): Promise<void>;
	};
	mutable.tasks = new Map(Object.entries(data.tasks));
	mutable.taskInstances = new Map(Object.entries(data.taskInstances ?? {}));
	mutable.fileMtimes = new Map(Array.from(mutable.taskInstances.values(), task => [task.primary.filePath, 123]));
	mutable.fileSizes = new Map(Array.from(mutable.taskInstances.values(), task => [task.primary.filePath, 456]));
	mutable.coherentWorkflowStatusSemanticsSignature = data.workflowStatusSemanticsSignature;
	mutable.coherenceBasis = 'verified-full-scan';
	mutable.lastFullScanAt = FULL_SCAN_TIME;

	await mutable.persistIndex({ immediate: true });
	deepEqual(order, ['v8-primary']);
	deepEqual(indexer.getIndexRevisionSource(), {
		ramGeneration: 0,
		durable: {
			status: 'available',
			snapshotId: 'fixture-1',
			committedAt: persistenceInputs[0].committedAt,
		},
	});
	check(Object.isFrozen(indexer.getIndexRevisionSource()));
	equal(persistenceInputs.length, 1);
	const sealedDescription = Object.values(persistenceInputs[0].indexData.taskInstances ?? {})[0].description;
	Object.values(data.taskInstances ?? {})[0].description = 'mutated live state';
	equal(Object.values(persistenceInputs[0].indexData.taskInstances ?? {})[0].description, sealedDescription);
	check(Array.from(persistenceInputs[0].sourceStats.values()).every(stat => stat.mtimeMs === 123 && stat.sizeBytes === 456));

	order.length = 0;
	await mutable.persistIndex({ dirtySourcePaths: ['A.md'], affectedOperonIds: ['a'] });
	await mutable.persistIndex({ dirtySourcePaths: ['B.md'], affectedOperonIds: ['b'] });
	await mutable.flushPendingPersist();
	deepEqual(order, ['v8-primary']);
	equal(dirtyBatches.length, 2);
	deepEqual([...dirtyBatches[1].dirtySourcePaths].sort(), ['A.md', 'B.md']);
	deepEqual([...dirtyBatches[1].affectedOperonIds].sort(), ['a', 'b']);

	order.length = 0;
	const primaryBeforeBurst = persistenceInputs.length;
	for (let index = 0; index < 1_000; index++) {
		await mutable.persistIndex({
			dirtySourcePaths: [`Burst-${index}.md`],
			affectedOperonIds: [`burst-${index}`],
		});
	}
	equal(persistenceInputs.length, primaryBeforeBurst, 'pending burst must not start more than one persistence job');
	await mutable.flushPendingPersist();
	equal(persistenceInputs.length, primaryBeforeBurst + 1);
	equal(dirtyBatches.at(-1)?.dirtySourcePaths.size, 1_000);
	equal(dirtyBatches.at(-1)?.affectedOperonIds.size, 1_000);

	order.length = 0;
	await mutable.persistIndex({ immediate: true, forceFull: true });
	deepEqual(order, ['v8-primary']);
	equal(dirtyBatches.at(-1)?.forceFull, true);

	order.length = 0;
	primaryStatus = 'unchanged';
	await mutable.persistIndex({ immediate: true, dirtySourcePaths: ['Unchanged.md'] });
	const unchangedInput = persistenceInputs.at(-1);
	check(unchangedInput);
	deepEqual(indexer.getIndexRevisionSource(), {
		ramGeneration: 0,
		durable: {
			status: 'available',
			snapshotId: `fixture-${unchangedInput.sequence}`,
			committedAt: unchangedInput.committedAt,
		},
	});

	order.length = 0;
	primaryStatus = 'committed';
	failPrimary = true;
	await mutable.persistIndex({ immediate: true, dirtySourcePaths: ['Failure.md'] });
	deepEqual(order, [
		'v8-primary',
		'v8-disable:PRIMARY_INVALID_SNAPSHOT',
	]);
	equal(recoveryMarkerCount, 1, 'non-retryable V8 failure must create one durable recovery marker');
	const recoveryRevision = indexer.getIndexRevisionSource();
	deepEqual(recoveryRevision.durable, { status: 'recovery-required' });
}

async function testIndexerRamSettlementSeam(): Promise<void> {
	const indexer = new OperonIndexer(
		{ vault: { getAbstractFileByPath: () => null } } as unknown as App,
		{ getSettings: () => DEFAULT_SETTINGS } as never,
	);
	const mutable = indexer as unknown as {
		enqueueIndexOperation<T>(
			operation: () => Promise<T>,
			options?: { affectsRam?: boolean },
		): Promise<T>;
	};

	const ramGate = deferred<void>();
	let ramStarted = false;
	const ramOperation = mutable.enqueueIndexOperation(async () => {
		ramStarted = true;
		await ramGate.promise;
	});
	await waitFor(() => ramStarted, 'RAM operation to start');
	let ramSettled = false;
	const settlement = indexer.awaitRamSettlement().then(snapshot => {
		ramSettled = true;
		return snapshot;
	});
	await settleMicrotasks();
	equal(ramSettled, false, 'RAM settlement must wait for active RAM work');
	ramGate.resolve();
	await ramOperation;
	const settledSnapshot = await settlement;
	deepEqual(settledSnapshot, { state: 'settled', ramGeneration: 0 });
	check(Object.isFrozen(settledSnapshot), 'RAM settlement snapshots must be immutable');

	const persistenceGate = deferred<void>();
	let persistenceStarted = false;
	const persistenceOperation = mutable.enqueueIndexOperation(async () => {
		persistenceStarted = true;
		await persistenceGate.promise;
	}, { affectsRam: false });
	await waitFor(() => persistenceStarted, 'persistence-only operation to start');
	const persistenceIndependent = await Promise.race([
		indexer.awaitRamSettlement(),
		new Promise<never>((_resolve, reject) => {
			globalThis.setTimeout(() => reject(new Error('RAM settlement waited for persistence-only work')), 100);
		}),
	]);
	deepEqual(persistenceIndependent, { state: 'settled', ramGeneration: 0 });
	persistenceGate.resolve();
	await persistenceOperation;

	indexer.destroy();
	deepEqual(await indexer.awaitRamSettlement(), { state: 'unloading', ramGeneration: 0 });

	const fullPersistGate = deferred<void>();
	let fullPersistStarted = false;
	const fullPersistPersistence = {
		persistPrimary: async (input: IndexV8PersistenceInput) => {
			fullPersistStarted = true;
			await fullPersistGate.promise;
			return {
				status: 'committed' as const,
				mode: 'full' as const,
				sequence: input.sequence,
				snapshotId: `full-${input.sequence}`,
				committedAt: input.committedAt,
				dirtyShardCount: 0,
				shardsWritten: 0,
				shardsReused: 32,
				bytesWritten: 0,
			};
		},
	};
	const fullIndexer = new OperonIndexer(
		{ vault: { getMarkdownFiles: () => [] } } as unknown as App,
		{ getSettings: () => DEFAULT_SETTINGS } as never,
		fullPersistPersistence as unknown as IndexV8PersistenceCoordinator,
	);
	let fullCompleted = false;
	const fullReindex = fullIndexer.fullReindex().then(() => { fullCompleted = true; });
	await waitFor(() => fullPersistStarted, 'full-reindex persistence to start');
	const settledBeforePersistence = await indexerTimeout(
		fullIndexer.awaitRamSettlement(),
		'RAM settlement waited for full-reindex persistence',
	);
	deepEqual(settledBeforePersistence, { state: 'settled', ramGeneration: 1 });
	equal(fullCompleted, false, 'full reindex persistence must still be in flight');
	fullPersistGate.resolve();
	await fullReindex;

	const flushIndexer = new OperonIndexer(
		{ vault: { getAbstractFileByPath: () => null } } as unknown as App,
		{ getSettings: () => DEFAULT_SETTINGS } as never,
	);
	const flushMutable = flushIndexer as unknown as {
		forceReindexFilePathAfterMutation(filePath: string): Promise<void>;
	};
	const flushedPaths: string[] = [];
	flushMutable.forceReindexFilePathAfterMutation = async filePath => {
		flushedPaths.push(filePath);
		if (filePath === 'First.md') flushIndexer.scheduleReindex('Follow-up.md');
	};
	flushIndexer.scheduleReindex('First.md');
	equal(
		await flushIndexer.flushPendingRamReindexNow(),
		2,
		'mutation-owned flush must drain the pending file and a follow-up event',
	);
	deepEqual(flushedPaths, ['First.md', 'Follow-up.md']);
	deepEqual(await flushIndexer.awaitRamSettlement(), { state: 'settled', ramGeneration: 0 });
	flushIndexer.destroy();

	const overlapIndexer = new OperonIndexer(
		{ vault: { getAbstractFileByPath: () => null } } as unknown as App,
		{ getSettings: () => DEFAULT_SETTINGS } as never,
	);
	const overlapMutable = overlapIndexer as unknown as {
		doReindexFilePath(filePath: string): Promise<void>;
	};
	const firstScanGate = deferred<void>();
	let overlapScanCount = 0;
	overlapMutable.doReindexFilePath = async filePath => {
		equal(filePath, 'Overlap.md');
		overlapScanCount += 1;
		if (overlapScanCount === 1) await firstScanGate.promise;
	};
	const firstOverlapScan = overlapIndexer.reindexFilePath('Overlap.md');
	await waitFor(() => overlapScanCount === 1, 'overlapping RAM scan to start');
	overlapIndexer.scheduleReindex('Overlap.md');
	const overlapFlush = overlapIndexer.flushPendingRamReindexNow();
	firstScanGate.resolve();
	await firstOverlapScan;
	equal(await overlapFlush, 1);
	equal(
		overlapScanCount,
		2,
		'a pending follow-up for an in-flight path must run a second exact scan',
	);
	deepEqual(await overlapIndexer.awaitRamSettlement(), { state: 'settled', ramGeneration: 0 });
	overlapIndexer.destroy();
}

async function indexerTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
	return await Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			globalThis.setTimeout(() => reject(new Error(message)), 100);
		}),
	]);
}

async function testSchedulingAndSealing(): Promise<void> {
	const scheduler = new ManualPersistenceScheduler();
	const store = new FakePersistenceStore();
	const writer = new IndexV8PersistenceCoordinator(store, { scheduler });
	const input = makeInput(1);
	const originalDescription = Object.values(input.indexData.tasks)[0].description;
	writer.enqueue(input);
	equal(writer.getStatus().phase, 'scheduled');
	await scheduler.advanceBy(1_999);
	equal(store.commits.length, 0);
	Object.values(input.indexData.tasks)[0].description = 'mutated after enqueue';
	Object.values(input.indexData.taskInstances ?? {})[0].description = 'mutated after enqueue';
	input.sourceStats.values().next().value!.mtimeMs = 999;
	await scheduler.advanceBy(1);
	await writer.drain();
	equal(store.commits.length, 1);
	const committed = store.commits[0];
	const manifest = decodeIndexV8Manifest(committed.manifestPayload);
	const committedSources = manifest.shards.flatMap(descriptor => {
		const shard = JSON.parse(committed.shardPayloads.get(descriptor.shardId)!) as {
			sources: Array<{ instances: Array<{ description: string }>; mtimeMs: number }>;
		};
		return shard.sources;
	});
	check(committedSources.some(source => source.instances.some(task => task.description === originalDescription)));
	check(committedSources.every(source => source.mtimeMs !== 999));
	equal(writer.getStatus().succeeded, 1);
	equal(writer.getStatus().phase, 'idle');

}

async function testLatestWinsAndRetry(): Promise<void> {
	const reverseScheduler = new ManualPersistenceScheduler();
	const reverseStore = new FakePersistenceStore();
	const reverseWriter = new IndexV8PersistenceCoordinator(reverseStore, { scheduler: reverseScheduler });
	reverseWriter.enqueue(makeInput(2));
	reverseWriter.enqueue(makeInput(1));
	await reverseScheduler.advanceBy(2_000);
	await reverseWriter.drain();
	equal(reverseStore.commits.length, 1);
	equal(decodeIndexV8Manifest(reverseStore.commits[0].manifestPayload).committedAt, makeInput(2).committedAt);

	const scheduler = new ManualPersistenceScheduler();
	const store = new FakePersistenceStore();
	const first = deferred<IndexV8CommitResult>();
	store.commitImpl = async (snapshot, call) => call === 1 ? await first.promise : commitResult(snapshot);
	const writer = new IndexV8PersistenceCoordinator(store, { scheduler });
	writer.enqueue(makeInput(1), { immediate: true });
	await waitFor(() => store.commits.length === 1, 'first persistence commit');
	for (let sequence = 2; sequence <= 100; sequence++) writer.enqueue(makeInput(sequence), { immediate: true });
	equal(writer.getStatus().pendingDepth, 1);
	equal(writer.getStatus().coalesced, 98);
	first.resolve(commitResult(store.commits[0]));
	await waitFor(() => store.commits.length === 2, 'latest persistence commit');
	await writer.drain();
	const finalManifest = decodeIndexV8Manifest(store.commits[1].manifestPayload);
	equal(finalManifest.committedAt, makeInput(100).committedAt);
	equal(writer.getStatus().attempted, 2);
	equal(writer.getStatus().succeeded, 2);
	equal(writer.getStatus().pendingDepth, 0);

	const retryScheduler = new ManualPersistenceScheduler();
	const retryStore = new FakePersistenceStore();
	retryStore.commitImpl = async (snapshot, call) => {
		if (call === 1) {
			const error = new Error('transient I/O');
			error.name = 'IndexV8TransientIoError';
			throw error;
		}
		return commitResult(snapshot);
	};
	const retryWriter = new IndexV8PersistenceCoordinator(retryStore, { scheduler: retryScheduler });
	retryWriter.enqueue(makeInput(1), { immediate: true });
	await waitFor(() => retryStore.commits.length === 1 && retryWriter.getStatus().phase === 'retrying', 'retry schedule');
	await retryScheduler.advanceBy(4_999);
	equal(retryStore.commits.length, 1);
	await retryScheduler.advanceBy(1);
	await retryWriter.drain();
	equal(retryStore.commits.length, 2);
	equal(retryWriter.getStatus().attempted, 2);
	equal(retryWriter.getStatus().failed, 1);
	equal(retryWriter.getStatus().succeeded, 1);
}

async function testParityBlocksCommitAndMetadataGate(): Promise<void> {
	const parityStore = new FakePersistenceStore();
	const parityWriter = new IndexV8PersistenceCoordinator(parityStore, { scheduler: new ManualPersistenceScheduler() });
	const inconsistent = createSyntheticIndexData(2);
	const [taskMapKey, task] = Object.entries(inconsistent.tasks)[0];
	task.operonId = `${taskMapKey}-inconsistent`;
	parityWriter.enqueue(makeInput(1, inconsistent), { immediate: true });
	await parityWriter.drain();
	equal(parityStore.commits.length, 0);
	equal(parityWriter.getStatus().lastErrorCode, 'PARITY_MISMATCH');

	const metadataStore = new FakePersistenceStore();
	const metadataWriter = new IndexV8PersistenceCoordinator(metadataStore, { scheduler: new ManualPersistenceScheduler() });
	const missingMetadata = makeInput(1);
	const firstPath = missingMetadata.sourceStats.keys().next().value!;
	const incompleteStats = new Map(missingMetadata.sourceStats);
	incompleteStats.set(firstPath, { mtimeMs: 0, sizeBytes: 0 });
	missingMetadata.sourceStats = incompleteStats;
	metadataWriter.enqueue(missingMetadata, { immediate: true });
	await metadataWriter.drain();
	equal(metadataStore.commits.length, 0);
	equal(metadataWriter.getStatus().phase, 'disabled');
	equal(metadataWriter.getStatus().lastErrorCode, 'CODEC_INVALID');

}

async function testRealStoreAndTelemetryPrivacy(): Promise<void> {
	const adapter = new IndexV8MemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian', 'operon-persistence-test').runtime.indexV8;
	const writer = new IndexV8PersistenceCoordinator(new IndexV8Store(adapter.asDataAdapter(), paths), {
		scheduler: new ManualPersistenceScheduler(),
	});
	const debugLines: string[] = [];
	const originalDebug = console.debug;
	console.debug = (...args: unknown[]) => { debugLines.push(args.join(' ')); };
	setOperonEnginePerfDebug(true);
	try {
		const firstData = createSyntheticIndexData(100);
		const firstTask = Object.values(firstData.tasks)[0];
		const firstInstance = Object.values(firstData.taskInstances ?? {})[0];
		firstTask.description = PRIVATE_DESCRIPTION;
		firstInstance.description = PRIVATE_DESCRIPTION;
		writer.enqueue(makeInput(1, firstData), { immediate: true });
		await writer.drain();
		const firstLoad = await new IndexV8Store(adapter.asDataAdapter(), paths).load();
		check(firstLoad.status === 'loaded');
		if (firstLoad.status !== 'loaded') throw new Error('Expected first real persistence snapshot');
		equal(firstLoad.manifest.shards.length, 32);
		const shardNamesAfterFirst = new Set(
			[...adapter.files.keys()].filter(path => path.startsWith(`${paths.shardsPath}/`)),
		);

		writer.enqueue(makeInput(2, firstData), { immediate: true });
		await writer.drain();
		const shardNamesAfterNoop = new Set(
			[...adapter.files.keys()].filter(path => path.startsWith(`${paths.shardsPath}/`)),
		);
		deepEqual(shardNamesAfterNoop, shardNamesAfterFirst);

		const changedData = structuredClone(firstData);
		Object.values(changedData.tasks)[0].description += ' changed';
		Object.values(changedData.taskInstances ?? {})[0].description += ' changed';
		writer.enqueue(makeInput(3, changedData), { immediate: true });
		await writer.drain();
		const shardNamesAfterChange = new Set(
			[...adapter.files.keys()].filter(path => path.startsWith(`${paths.shardsPath}/`)),
		);
		const changedLoad = await new IndexV8Store(adapter.asDataAdapter(), paths).load();
		check(changedLoad.status === 'loaded');
		if (changedLoad.status !== 'loaded') throw new Error('Expected changed persistence snapshot');
		const changedDescriptorCount = firstLoad.manifest.shards.filter((descriptor, index) => (
			descriptor.sha256 !== changedLoad.manifest.shards[index].sha256
		)).length;
		equal(changedDescriptorCount, 1);
		equal(shardNamesAfterChange.size, shardNamesAfterFirst.size + 1);
	} finally {
		setOperonEnginePerfDebug(false);
		console.debug = originalDebug;
	}
	const logPayload = debugLines.join('\n');
	check(logPayload.includes('index.v8.persistence'));
	check(!logPayload.includes(PRIVATE_DESCRIPTION));
	check(!logPayload.includes(PRIVATE_PATH));
	check(!logPayload.includes(PRIVATE_ID));
	check(!adapter.operations.some(operation => operation.includes('/runtime/index.json')));
}

async function run(): Promise<void> {
	await testParityAndPrivacy();
	await testIndexerV8PrimaryOrderingAndSealedSnapshot();
	await testIndexerRamSettlementSeam();
	await testSchedulingAndSealing();
	await testLatestWinsAndRetry();
	await testParityBlocksCommitAndMetadataGate();
	await testRealStoreAndTelemetryPrivacy();
	process.stdout.write(`${JSON.stringify({ ok: true, assertions })}\n`);
}

declare global {
	var __operonIndexV8PersistenceTestRun: Promise<void> | undefined;
}

globalThis.__operonIndexV8PersistenceTestRun = run();
