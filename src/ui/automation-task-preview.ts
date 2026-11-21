import { sortTasksBySpecs, type GroupedFilterResults } from '../core/filter-display';
import type { AutomationPreviewTaskIds } from '../core/automation-change-plan';
import { parseLocalTimestamp, toLocalDate } from '../core/local-time';
import type { IndexedTask } from '../types/fields';
import type { FilterSortSpec } from '../types/settings';

export interface AutomationTaskPreview {
	name: string;
	section: keyof AutomationPreviewTaskIds;
	/** Undefined while the editor recalculates, null for an unavailable result. */
	taskIds: readonly string[] | null | undefined;
}

export const automationPreviewSorts: FilterSortSpec[] = [
	{ field: 'priority', order: 'asc' },
	{ field: 'description', order: 'asc' },
];

/** Resolve exactly the planner's root membership. Subtasks are expanded by the row renderer. */
export function groupAutomationPreviewTasks(
	taskIds: AutomationTaskPreview['taskIds'],
	getTask: (id: string) => IndexedTask | undefined,
	priorities: { label: string }[],
): GroupedFilterResults | null {
	if (!taskIds) return null;
	const tasks: IndexedTask[] = [];
	for (const id of new Set(taskIds)) {
		const task = getTask(id);
		if (!task) return null;
		tasks.push(task);
	}
	const days = new Map<string, IndexedTask[]>();
	for (const task of sortTasksBySpecs(tasks, automationPreviewSorts, { priorities })) {
		const time = parseLocalTimestamp(task.datetimeModified);
		const day = time === null ? '' : toLocalDate(new Date(time));
		const group = days.get(day);
		if (group) group.push(task);
		else days.set(day, [task]);
	}
	return {
		totalCount: tasks.length,
		groups: [...days].sort(([a], [b]) => b.localeCompare(a))
			.map(([day, members]) => ({ key: day, label: day, tasks: members, count: members.length })),
	};
}
