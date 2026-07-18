import { GroupedFilterResults } from '../core/filter-evaluator';
import { IndexedTask } from '../types/fields';

export const FILTER_RENDER_BATCH_SIZE = 25;

export function getVisibleFilterTasks(tasks: IndexedTask[], visibleLimit: number): IndexedTask[] {
	return tasks.length > visibleLimit ? tasks.slice(0, visibleLimit) : tasks;
}

export function getVisibleGroupedFilterResults(
	grouped: GroupedFilterResults,
	visibleLimit: number,
): GroupedFilterResults {
	if (grouped.groupingSuspended) {
		return {
			...grouped,
			groups: [],
			ungroupedTasks: (grouped.ungroupedTasks ?? []).slice(0, visibleLimit),
		};
	}
	let remaining = visibleLimit;
	const groups: GroupedFilterResults['groups'] = [];

	for (const group of grouped.groups) {
		if (remaining <= 0) break;

		if (group.subgroups?.length) {
			const subgroups: NonNullable<GroupedFilterResults['groups'][number]['subgroups']> = [];
			for (const subgroup of group.subgroups) {
				if (remaining <= 0) break;
				const tasks = subgroup.tasks.slice(0, remaining);
				if (tasks.length === 0) continue;
				remaining -= tasks.length;
				subgroups.push({ ...subgroup, tasks });
			}
			if (subgroups.length > 0) {
				groups.push({ ...group, subgroups });
			}
			continue;
		}

		const tasks = group.tasks.slice(0, remaining);
		if (tasks.length === 0) continue;
		remaining -= tasks.length;
		groups.push({ ...group, tasks });
	}

	return { ...grouped, groups };
}
