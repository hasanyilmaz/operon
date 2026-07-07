import { IndexedTask } from '../types/fields';

/**
 * Fields whose values churn with time tracking. They are excluded from the
 * board render signature unless the board actually displays or sorts by
 * them, so tracker ticks do not force full board re-renders.
 */
export const KANBAN_TRACKER_FIELD_KEYS: ReadonlySet<string> = new Set([
	'activeTracker',
	'datetimeModified',
	'duration',
	'totalDuration',
	'trackers',
]);

/**
 * Fields that aggregate systems (progress calculator, total-duration
 * calculator, dependency manager, indexer aggregate patches) may mutate IN
 * PLACE on cached IndexedTask objects without replacing the object. The
 * per-object stable signature cache must exclude them; they are re-read live
 * on every signature build. All other task content only changes when a file
 * rescan replaces the task object, which makes object identity a safe cache
 * key for the stable part.
 */
export const KANBAN_VOLATILE_TASK_FIELD_KEYS: ReadonlySet<string> = new Set([
	'progress',
	'directSubtaskCount',
	'directDoneSubtaskCount',
	'directOpenSubtaskCount',
	'treeDescendantCount',
	'treeDoneDescendantCount',
	'treeOpenDescendantCount',
	'totalEstimate',
	'blocking',
	'blockedBy',
	...KANBAN_TRACKER_FIELD_KEYS,
]);

export function buildKanbanTaskStableSignature(task: IndexedTask): string {
	const fieldEntries = Object.entries(task.fieldValues)
		.filter(([key]) => !KANBAN_VOLATILE_TASK_FIELD_KEYS.has(key))
		.sort(([left], [right]) => left.localeCompare(right));
	return JSON.stringify({
		id: task.operonId,
		description: task.description,
		checkbox: task.checkbox,
		tags: [...task.tags].sort(),
		primary: task.primary,
		fields: fieldEntries,
	});
}

export function buildKanbanTaskVolatileSignature(task: IndexedTask, includeTrackerFields: boolean): string {
	const parts: string[] = [task.operonId];
	if (includeTrackerFields) {
		parts.push(task.datetimeModified ?? '');
	}
	for (const key of KANBAN_VOLATILE_TASK_FIELD_KEYS) {
		if (!includeTrackerFields && KANBAN_TRACKER_FIELD_KEYS.has(key)) continue;
		const value = task.fieldValues[key];
		if (value !== undefined && value !== '') {
			parts.push(`${key}=${value}`);
		}
	}
	return parts.join('|');
}

/**
 * Incremental render signature for the kanban task set. Replaces the former
 * per-render full-index JSON serialization: the expensive stable part of each
 * task is cached by object identity (tasks are replaced on file rescan), the
 * joined stable board string is memoized by indexer generation, and only the
 * small set of volatile in-place-mutable fields is re-read on every build.
 */
export class KanbanTaskSignatureIndex {
	private readonly stableByTask = new WeakMap<IndexedTask, string>();
	private lastStableBoard: { generation: number; value: string } | null = null;

	buildBoardSignature(tasks: IndexedTask[], includeTrackerFields: boolean, generation: number): string {
		return `${this.resolveStableBoardSignature(tasks, generation)}\u0001${this.buildVolatileBoardSignature(tasks, includeTrackerFields)}`;
	}

	private resolveStableBoardSignature(tasks: IndexedTask[], generation: number): string {
		const cached = this.lastStableBoard;
		if (cached && cached.generation === generation) return cached.value;
		const parts = tasks.map(task => this.resolveStableTaskSignature(task));
		parts.sort();
		const value = parts.join('\n');
		this.lastStableBoard = { generation, value };
		return value;
	}

	private resolveStableTaskSignature(task: IndexedTask): string {
		const cached = this.stableByTask.get(task);
		if (cached !== undefined) return cached;
		const value = buildKanbanTaskStableSignature(task);
		this.stableByTask.set(task, value);
		return value;
	}

	private buildVolatileBoardSignature(tasks: IndexedTask[], includeTrackerFields: boolean): string {
		const parts = new Array<string>(tasks.length);
		for (let index = 0; index < tasks.length; index++) {
			parts[index] = buildKanbanTaskVolatileSignature(tasks[index], includeTrackerFields);
		}
		return parts.join('\n');
	}
}
