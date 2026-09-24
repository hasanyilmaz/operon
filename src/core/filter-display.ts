import type { IndexedTask } from '../types/fields';
import type { FilterSet } from '../types/settings';
import type { Pipeline } from '../types/pipeline';
import type { PinnedCache } from '../storage/pinned-cache';
import { evaluateFilterSetWithTimeScope, groupFilterTasks, type FilterEvaluationOptions } from './filter-evaluator';
import { withTaskTimeScope } from './time-scope-values';
export * from './filter-evaluator';

/** Presentation adapter: never used by Runtime hydration or persisted task writers. */
export function evaluateFilterSet(filterSet: FilterSet, tasks: IndexedTask[], priorities?: { label: string }[], pinnedCache?: PinnedCache | null, pipelines?: readonly Pipeline[], options?: FilterEvaluationOptions): IndexedTask[] {
	const result = evaluateFilterSetWithTimeScope(filterSet, tasks, priorities, pinnedCache, pipelines, options);
	return result.tasks.map(task => {
		const time = result.timeScope?.get(task.operonId);
		return time ? withTaskTimeScope(task, time) : task;
	});
}

export function evaluateFilterSetGrouped(filterSet: FilterSet, tasks: IndexedTask[], priorities?: { label: string }[], pinnedCache?: PinnedCache | null, pipelines?: readonly Pipeline[], options?: FilterEvaluationOptions) {
	const matchedTasks = evaluateFilterSet(filterSet, tasks, priorities, pinnedCache, pipelines, options);
	return { ...groupFilterTasks(filterSet, matchedTasks, priorities, pinnedCache, pipelines, options), matchedTasks };
}

export function filterTasksForDisplay(filterSet: FilterSet | null, tasks: IndexedTask[], priorities?: { label: string }[], pinnedCache?: PinnedCache | null, options?: FilterEvaluationOptions): IndexedTask[] {
	if (!filterSet) return tasks;
	// View-specific ordering is applied later by each query engine.
	return evaluateFilterSet({ ...filterSet, sorts: [], sortBy: undefined }, tasks, priorities, pinnedCache, options?.pipelines, options);
}
