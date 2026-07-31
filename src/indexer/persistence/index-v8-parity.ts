import type { IndexedTask, IndexedTaskInstance, IndexData } from '../../types/fields';
import { SecondaryIndexes } from '../secondary-indexes';
import {
	deriveIndexV8InstanceKey,
	hydrateIndexV8Shards,
	sha256Hex,
	stableCompactStringify,
	validateIndexV8Snapshot,
	type IndexV8SourceStat,
} from './index-v8-codec';
import type { IndexV8Snapshot } from './index-v8-contract';
import { normalizeIndexV8SourcePath } from './index-v8-partition';

export type IndexV8ParityDimension =
	| 'manifest-totals'
	| 'source-membership'
	| 'source-metadata'
	| 'task-instances'
	| 'operon-id-membership'
	| 'duplicate-membership'
	| 'canonical-selections'
	| 'canonical-tasks'
	| 'secondary-by-status'
	| 'secondary-by-due'
	| 'secondary-by-parent'
	| 'secondary-by-file'
	| 'secondary-by-workflow-status'
	| 'secondary-by-priority';

export interface IndexV8ParityMismatch {
	dimension: IndexV8ParityDimension;
	leftCount: number;
	rightCount: number;
	leftDigest: string;
	rightDigest: string;
}

export type IndexV8ParityResult =
	| {
		ok: true;
		checkedDimensions: number;
		mismatches: [];
	}
	| {
		ok: false;
		checkedDimensions: number;
		mismatches: IndexV8ParityMismatch[];
	};

export type IndexV8ParityErrorCode = 'PARITY_MISMATCH' | 'PARITY_NORMALIZATION_COLLISION';

export class IndexV8ParityError extends Error {
	constructor(
		public readonly code: IndexV8ParityErrorCode,
		public readonly mismatches: readonly IndexV8ParityMismatch[],
	) {
		super(code === 'PARITY_MISMATCH'
			? `V8 parity mismatch in ${mismatches.length} dimension(s)`
			: 'V8 parity projection contains a normalized location collision');
		this.name = 'IndexV8ParityError';
	}
}

interface ParityProjection {
	dimension: IndexV8ParityDimension;
	left: unknown;
	right: unknown;
	leftCount: number;
	rightCount: number;
}

interface NormalizedIndexState {
	tasks: Map<string, IndexedTask>;
	taskProjection: unknown[];
	instanceProjection: unknown[];
	operonIdMembership: unknown[];
	duplicateMembership: string[];
	canonicalSelections: unknown[];
	sourceMembership: string[];
}

export interface IndexV8IncrementalParityProjection {
	canonicalTasks: unknown[];
	secondaryByStatus: unknown[];
	secondaryByDue: unknown[];
	secondaryByParent: unknown[];
	secondaryByFile: unknown[];
	secondaryByWorkflowStatus: unknown[];
	secondaryByPriority: unknown[];
}

/**
 * Seal the canonical-task and live secondary-index view at mutation snapshot time.
 * The projection is compared with an independently rebuilt view before an
 * incremental manifest can become active.
 */
export function projectIndexV8IncrementalParity(
	tasks: ReadonlyMap<string, IndexedTask>,
	secondary: SecondaryIndexes,
): IndexV8IncrementalParityProjection {
	const normalized = normalizeIndexState(tasks, []);
	const secondaryProjection = projectSecondaryIndexes(secondary);
	return {
		canonicalTasks: normalized.taskProjection,
		secondaryByStatus: secondaryProjection.byStatus,
		secondaryByDue: secondaryProjection.byDue,
		secondaryByParent: secondaryProjection.byParent,
		secondaryByFile: secondaryProjection.byFile,
		secondaryByWorkflowStatus: secondaryProjection.byWorkflowStatus,
		secondaryByPriority: secondaryProjection.byPriority,
	};
}

/** Fail closed if the sealed live indexes diverge from the persisted authority snapshot. */
export async function assertIndexV8IncrementalParity(
	authority: IndexData,
	sealedProjection: IndexV8IncrementalParityProjection,
): Promise<void> {
	const tasks = new Map(Object.entries(authority.tasks));
	const rebuilt = new SecondaryIndexes();
	rebuilt.rebuild(tasks);
	const expected = projectIndexV8IncrementalParity(tasks, rebuilt);
	const checks: ParityProjection[] = [
		projection('canonical-tasks', expected.canonicalTasks, sealedProjection.canonicalTasks),
		projection('secondary-by-status', expected.secondaryByStatus, sealedProjection.secondaryByStatus),
		projection('secondary-by-due', expected.secondaryByDue, sealedProjection.secondaryByDue),
		projection('secondary-by-parent', expected.secondaryByParent, sealedProjection.secondaryByParent),
		projection('secondary-by-file', expected.secondaryByFile, sealedProjection.secondaryByFile),
		projection(
			'secondary-by-workflow-status',
			expected.secondaryByWorkflowStatus,
			sealedProjection.secondaryByWorkflowStatus,
		),
		projection('secondary-by-priority', expected.secondaryByPriority, sealedProjection.secondaryByPriority),
	];
	const mismatches = (await Promise.all(checks.map(compareProjection)))
		.filter((result): result is IndexV8ParityMismatch => result !== null);
	if (mismatches.length > 0) throw new IndexV8ParityError('PARITY_MISMATCH', mismatches);
}

/**
 * Compare a sealed in-memory authority snapshot with a fully validated persisted snapshot.
 * The result intentionally exposes only aggregate counts and opaque digests.
 */
export async function compareIndexV8Parity(
	authority: IndexData,
	snapshot: IndexV8Snapshot,
	nowMs: number = Date.now(),
	sourceStats: ReadonlyMap<string, IndexV8SourceStat> = new Map(),
): Promise<IndexV8ParityResult> {
	const validated = await validateIndexV8Snapshot(snapshot.manifestPayload, snapshot.shardPayloads);
	const hydrated = hydrateIndexV8Shards(validated.shards, nowMs);
	const left = normalizeIndexState(
		new Map(Object.entries(authority.tasks)),
		getAuthorityInstances(authority),
	);
	const right = normalizeIndexState(hydrated.tasks, hydrated.taskInstances.values());
	const leftSecondary = buildSecondaryProjection(left.tasks);
	const rightSecondary = buildSecondaryProjection(right.tasks);
	const manifestLeft = {
		sourceCount: left.sourceMembership.length,
		taskInstanceCount: left.instanceProjection.length,
	};
	const manifestRight = {
		sourceCount: validated.manifest.totals.sourceCount,
		taskInstanceCount: validated.manifest.totals.taskInstanceCount,
	};
	const normalizedSourceStats = new Map<string, IndexV8SourceStat>();
	for (const [path, stat] of sourceStats) {
		normalizedSourceStats.set(normalizeIndexV8SourcePath(path), stat);
	}
	const leftSourceMetadata = left.sourceMembership.map(path => {
		const stat = normalizedSourceStats.get(path);
		return [path, stat?.mtimeMs ?? 0, stat?.sizeBytes ?? 0];
	});
	const rightSourceMetadata = validated.shards
		.flatMap(shard => shard.sources.map(source => [source.path, source.mtimeMs, source.sizeBytes]))
		.sort(compareTupleKey);
	const projections: ParityProjection[] = [
		projection('manifest-totals', manifestLeft, manifestRight, 2, 2),
		projection('source-membership', left.sourceMembership, right.sourceMembership),
		projection('source-metadata', leftSourceMetadata, rightSourceMetadata),
		projection('task-instances', left.instanceProjection, right.instanceProjection),
		projection('operon-id-membership', left.operonIdMembership, right.operonIdMembership),
		projection('duplicate-membership', left.duplicateMembership, right.duplicateMembership),
		projection('canonical-selections', left.canonicalSelections, right.canonicalSelections),
		projection('canonical-tasks', left.taskProjection, right.taskProjection),
		projection('secondary-by-status', leftSecondary.byStatus, rightSecondary.byStatus),
		projection('secondary-by-due', leftSecondary.byDue, rightSecondary.byDue),
		projection('secondary-by-parent', leftSecondary.byParent, rightSecondary.byParent),
		projection('secondary-by-file', leftSecondary.byFile, rightSecondary.byFile),
		projection(
			'secondary-by-workflow-status',
			leftSecondary.byWorkflowStatus,
			rightSecondary.byWorkflowStatus,
		),
		projection('secondary-by-priority', leftSecondary.byPriority, rightSecondary.byPriority),
	];
	const mismatches = (await Promise.all(projections.map(compareProjection)))
		.filter((result): result is IndexV8ParityMismatch => result !== null);
	return mismatches.length === 0
		? { ok: true, checkedDimensions: projections.length, mismatches: [] }
		: { ok: false, checkedDimensions: projections.length, mismatches };
}

export async function assertIndexV8Parity(
	authority: IndexData,
	snapshot: IndexV8Snapshot,
	nowMs: number = Date.now(),
	sourceStats: ReadonlyMap<string, IndexV8SourceStat> = new Map(),
): Promise<void> {
	const result = await compareIndexV8Parity(authority, snapshot, nowMs, sourceStats);
	if (!result.ok) throw new IndexV8ParityError('PARITY_MISMATCH', result.mismatches);
}

function getAuthorityInstances(authority: IndexData): IndexedTaskInstance[] {
	const persisted = Object.values(authority.taskInstances ?? {});
	if (persisted.length > 0) return persisted;
	return Object.values(authority.tasks).map(task => ({
		...task,
		instanceKey: deriveIndexV8InstanceKey(
			task.primary.filePath,
			task.primary.lineNumber,
			task.primary.format,
		),
	}));
}

function normalizeIndexState(
	tasks: ReadonlyMap<string, IndexedTask>,
	instances: Iterable<IndexedTaskInstance>,
): NormalizedIndexState {
	const normalizedTasks = new Map<string, IndexedTask>();
	const taskProjection: unknown[] = [];
	for (const [taskMapKey, task] of tasks) {
		const normalized = normalizeTask(task);
		normalizedTasks.set(taskMapKey, normalized.task);
		taskProjection.push([taskMapKey, normalized.projection]);
	}
	taskProjection.sort(compareTupleKey);

	const instanceByKey = new Map<string, unknown>();
	const membership = new Map<string, Set<string>>();
	const sources = new Set<string>();
	for (const instance of instances) {
		const normalized = normalizeTask(instance);
		const instanceKey = deriveIndexV8InstanceKey(
			normalized.task.primary.filePath,
			normalized.task.primary.lineNumber,
			normalized.task.primary.format,
		);
		if (instanceByKey.has(instanceKey)) {
			throw new IndexV8ParityError('PARITY_NORMALIZATION_COLLISION', []);
		}
		instanceByKey.set(instanceKey, normalized.projection);
		sources.add(normalized.task.primary.filePath);
		const keys = membership.get(normalized.task.operonId) ?? new Set<string>();
		keys.add(instanceKey);
		membership.set(normalized.task.operonId, keys);
	}
	const instanceProjection = Array.from(instanceByKey, ([key, value]) => [key, value])
		.sort(compareTupleKey);
	const operonIdMembership = Array.from(membership, ([operonId, keys]) => [
		operonId,
		[...keys].sort(compareText),
	]).sort(compareTupleKey);
	const duplicateMembership = Array.from(membership)
		.filter(([, keys]) => keys.size > 1)
		.map(([operonId]) => operonId)
		.sort(compareText);
	const canonicalSelections = Array.from(tasks, ([operonId, task]) => [
		operonId,
		deriveIndexV8InstanceKey(task.primary.filePath, task.primary.lineNumber, task.primary.format),
	]).sort(compareTupleKey);
	return {
		tasks: normalizedTasks,
		taskProjection,
		instanceProjection,
		operonIdMembership,
		duplicateMembership,
		canonicalSelections,
		sourceMembership: [...sources].sort(compareText),
	};
}

function normalizeTask(task: IndexedTask): { task: IndexedTask; projection: unknown } {
	const filePath = normalizeIndexV8SourcePath(task.primary.filePath);
	const fieldValues = Object.fromEntries(
		Object.entries(task.fieldValues)
			.filter(([key]) => key !== 'pinned')
			.sort(([left], [right]) => compareText(left, right)),
	);
	const primary = {
		filePath,
		lineNumber: task.primary.lineNumber,
		format: task.primary.format,
	};
	const normalizedTask: IndexedTask = {
		...task,
		fieldValues,
		tags: [...task.tags],
		primary,
		...(task.plainCheckboxProgress ? {
			plainCheckboxProgress: { ...task.plainCheckboxProgress },
		} : {}),
	};
	const projection = {
		operonId: task.operonId,
		description: task.description,
		checkbox: task.checkbox,
		fieldValues,
		tags: [...task.tags],
		primary,
		datetimeModified: task.datetimeModified,
		...(task.plainCheckboxProgress ? {
			plainCheckboxProgress: { ...task.plainCheckboxProgress },
		} : {}),
	};
	return { task: normalizedTask, projection };
}

function buildSecondaryProjection(tasks: Map<string, IndexedTask>) {
	const indexes = new SecondaryIndexes();
	indexes.rebuild(tasks);
	return projectSecondaryIndexes(indexes);
}

function projectSecondaryIndexes(indexes: SecondaryIndexes) {
	return {
		byStatus: projectSetMap(indexes.byStatus),
		byDue: indexes.byDue
			.map(entry => [entry.dateDue, entry.operonId])
			.sort(compareDueTuple),
		byParent: projectSetMap(indexes.byParent),
		byFile: projectSetMap(indexes.byFile, normalizeIndexV8SourcePath),
		byWorkflowStatus: projectSetMap(indexes.byWorkflowStatus),
		byPriority: projectSetMap(indexes.byPriority),
	};
}

function projectSetMap(
	map: ReadonlyMap<string, ReadonlySet<string>>,
	normalizeKey: (key: string) => string = key => key,
): unknown[] {
	const merged = new Map<string, Set<string>>();
	for (const [rawKey, values] of map) {
		const key = normalizeKey(rawKey);
		const bucket = merged.get(key) ?? new Set<string>();
		for (const value of values) bucket.add(value);
		merged.set(key, bucket);
	}
	return Array.from(merged, ([key, values]) => [key, [...values].sort(compareText)])
		.sort(compareTupleKey);
}

function projection(
	dimension: IndexV8ParityDimension,
	left: unknown,
	right: unknown,
	leftCount: number = Array.isArray(left) ? left.length : 1,
	rightCount: number = Array.isArray(right) ? right.length : 1,
): ParityProjection {
	return { dimension, left, right, leftCount, rightCount };
}

async function compareProjection(value: ParityProjection): Promise<IndexV8ParityMismatch | null> {
	const leftPayload = stableCompactStringify(value.left);
	const rightPayload = stableCompactStringify(value.right);
	if (leftPayload === rightPayload) return null;
	const [leftDigest, rightDigest] = await Promise.all([
		sha256Hex(leftPayload),
		sha256Hex(rightPayload),
	]);
	return {
		dimension: value.dimension,
		leftCount: value.leftCount,
		rightCount: value.rightCount,
		leftDigest,
		rightDigest,
	};
}

function compareTupleKey(left: unknown[], right: unknown[]): number {
	const leftKey = typeof left[0] === 'string' ? left[0] : '';
	const rightKey = typeof right[0] === 'string' ? right[0] : '';
	return compareText(leftKey, rightKey);
}

function compareDueTuple(left: string[], right: string[]): number {
	const date = compareText(left[0] ?? '', right[0] ?? '');
	return date !== 0 ? date : compareText(left[1] ?? '', right[1] ?? '');
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
