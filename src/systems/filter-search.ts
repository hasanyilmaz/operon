import {
	GroupedFilterGroup,
	GroupedFilterResults,
	GroupedFilterSubgroup,
} from '../core/filter-evaluator';
import { parseListValue } from '../core/parser';
import { getManagedCustomFieldMappings, normalizeManagedFieldValue } from '../core/managed-task-fields';
import { resolveWorkflowStatus, Pipeline } from '../types/pipeline';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import { matchesTaskSearchQueryText } from './task-search';
import { IndexedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';

export interface FilterTreeScopeOptions {
	getIndexedTask: (id: string) => IndexedTask | undefined;
	getChildIds: (parentId: string) => string[];
	pipelines: Pipeline[];
	showOnlyOpenSubtasks: boolean;
}

export function isFilterSearchActive(query: string): boolean {
	return query.trim().length >= 2;
}

export function buildFilterTreeScope(
	rootTasks: IndexedTask[],
	options: FilterTreeScopeOptions,
): IndexedTask[] {
	const tasks: IndexedTask[] = [];
	const seen = new Set<string>();
	const stack = [...rootTasks].reverse();
	const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(options.pipelines);

	while (stack.length > 0) {
		const task = stack.pop()!;
		if (seen.has(task.operonId)) continue;
		seen.add(task.operonId);
		tasks.push(task);

		const childIds = options.getChildIds(task.operonId);
		for (let index = childIds.length - 1; index >= 0; index--) {
			const childId = childIds[index];
			if (childId === task.operonId || seen.has(childId)) continue;
			const childTask = options.getIndexedTask(childId);
			if (!childTask) continue;
			if (options.showOnlyOpenSubtasks && !isOpenSubtask(childTask, options.pipelines, workflowStatusIdentityIndex)) continue;
			stack.push(childTask);
		}
	}

	return tasks;
}

export function applyFilterSearch(
	tasks: IndexedTask[],
	query: string,
	keyMappings: readonly KeyMapping[] = [],
): IndexedTask[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return tasks;
	return tasks.filter(task => matchesTaskSearchQueryText(buildDirectTaskSearchText(task, keyMappings), normalizedQuery));
}

export function applyGroupedFilterSearch(
	grouped: GroupedFilterResults,
	query: string,
	keyMappings: readonly KeyMapping[] = [],
): GroupedFilterResults {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return grouped;
	if (grouped.groupingSuspended) {
		const ungroupedTasks = applyFilterSearch(grouped.ungroupedTasks ?? [], normalizedQuery, keyMappings);
		return {
			...grouped,
			totalCount: ungroupedTasks.length,
			groups: [],
			ungroupedTasks,
		};
	}

	const groups: GroupedFilterGroup[] = [];
	for (const group of grouped.groups) {
		if (group.subgroups?.length) {
			const subgroups: GroupedFilterSubgroup[] = group.subgroups
				.map(subgroup => {
					const tasks = applyFilterSearch(subgroup.tasks, normalizedQuery, keyMappings);
					return {
						...subgroup,
						count: tasks.length,
						tasks,
					};
				})
				.filter(subgroup => subgroup.count > 0);

			if (subgroups.length === 0) continue;

			const tasks = applyFilterSearch(group.tasks, normalizedQuery, keyMappings);
			groups.push({
				...group,
				count: subgroups.reduce((sum, subgroup) => sum + subgroup.count, 0),
				tasks,
				subgroups,
			});
			continue;
		}

		const tasks = applyFilterSearch(group.tasks, normalizedQuery, keyMappings);
		if (tasks.length === 0) continue;
		groups.push({
			...group,
			count: tasks.length,
			tasks,
		});
	}

	return {
		...grouped,
		totalCount: groups.reduce((sum, group) => sum + group.count, 0),
		groups,
	};
}

function buildDirectTaskSearchText(task: IndexedTask, keyMappings: readonly KeyMapping[]): string {
	const values = new Set<string>();
	const addValue = (value: string | null | undefined): void => {
		const normalized = (value ?? '').trim();
		if (normalized) values.add(normalized.toLocaleLowerCase());
	};
	const addValues = (entries: Iterable<string>): void => {
		for (const entry of entries) addValue(entry);
	};

	addValue(task.description);
	addValue(task.operonId);
	addValue(task.primary.filePath);
	addValue(task.fieldValues['note']);
	addValue(task.fieldValues['priority']);
	addValue(task.fieldValues['status']);
	for (const tag of task.tags) addValue(tag);
	addValues(parseListValue(task.fieldValues['contexts'] ?? ''));
	addValues(parseListValue(task.fieldValues['assignees'] ?? ''));
	for (const fieldKey of ['dateDue', 'dateScheduled', 'dateStarted', 'dateCompleted', 'dateCancelled'] as const) {
		addValue(task.fieldValues[fieldKey]);
	}
	for (const mapping of getManagedCustomFieldMappings(keyMappings)) {
		const rawValue = normalizeManagedFieldValue((task.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
		if (!rawValue) continue;
		if (mapping.type === 'list') {
			addValues(parseListValue(rawValue));
			continue;
		}
		addValue(rawValue);
	}

	return Array.from(values).join('\n');
}

function isOpenSubtask(
	task: IndexedTask,
	pipelines: Pipeline[],
	workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
): boolean {
	const workflow = resolveWorkflowStatus(pipelines, task.fieldValues['status'], workflowStatusIdentityIndex);
	if (workflow) return workflow.checkbox === 'open';
	if (task.checkbox === 'cancelled' || !!task.fieldValues['dateCancelled']?.trim()) return false;
	return task.checkbox !== 'done' && !task.fieldValues['dateCompleted']?.trim();
}
