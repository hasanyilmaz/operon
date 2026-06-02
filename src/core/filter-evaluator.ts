/**
 * Filter evaluator for Operon filter sets.
 * Pure TypeScript — no Obsidian API dependencies.
 * Evaluation logic adapted from FileTransport plugin (same vault, same author).
 */

import { FilterFieldType, FilterGroup, FilterNode, FilterSet, FilterSetCondition, FilterSortSpec } from '../types/settings';
import { IndexedTask } from '../types/fields';
import { localToday } from './local-time';
import { PinnedCache } from '../storage/pinned-cache';

export interface GroupedFilterSubgroup {
	key: string;
	label: string;
	count: number;
	tasks: IndexedTask[];
}

export interface GroupedFilterGroup {
	key: string;
	label: string;
	count: number;
	tasks: IndexedTask[];
	subgroups?: GroupedFilterSubgroup[];
}

export interface GroupedFilterResults {
	totalCount: number;
	groups: GroupedFilterGroup[];
}

interface EvalContext {
	today: string;
	priorityRankMap: Record<string, number> | null;
	pinnedCache: PinnedCache | null;
	taskById: Map<string, IndexedTask>;
	childIdsByParentId: Map<string, string[]>;
	projectTreeMatchCache: Map<string, Set<string>>;
	folderTreeMatchCache: Map<string, Set<string>>;
}

// ============================================================
// Operator definitions by field type
// ============================================================

export const TEXT_OPERATORS = [
	{ id: 'contains', label: 'contains' },
	{ id: 'notContains', label: 'does not contain' },
	{ id: 'is', label: 'is' },
	{ id: 'isNot', label: 'is not' },
	{ id: 'startsWith', label: 'starts with' },
	{ id: 'endsWith', label: 'ends with' },
	{ id: 'hasAnyValue', label: 'has any value' },
	{ id: 'hasNoValue', label: 'has no value' },
	{ id: 'propPresent', label: 'property is present' },
	{ id: 'propMissing', label: 'property is missing' },
] as const;

export const NUMBER_OPERATORS = [
	{ id: 'eq', label: 'equals' },
	{ id: 'neq', label: 'does not equal' },
	{ id: 'lt', label: 'less than' },
	{ id: 'gt', label: 'more than' },
	{ id: 'lte', label: 'not less than' },
	{ id: 'gte', label: 'not more than' },
	{ id: 'divisible', label: 'divisible by' },
	{ id: 'notDivisible', label: 'not divisible by' },
	{ id: 'hasAnyValue', label: 'has any value' },
	{ id: 'hasNoValue', label: 'has no value' },
	{ id: 'propPresent', label: 'property is present' },
	{ id: 'propMissing', label: 'property is missing' },
] as const;

export const DATE_OPERATORS = [
	{ id: 'dateIs', label: 'date is' },
	{ id: 'before', label: 'before' },
	{ id: 'after', label: 'after' },
	{ id: 'isToday', label: 'is today' },
	{ id: 'notToday', label: 'not today' },
	{ id: 'beforeToday', label: 'before today' },
	{ id: 'afterToday', label: 'after today' },
	{ id: 'exactlyDaysAgo', label: 'exactly X days ago' },
	{ id: 'exactlyDaysAway', label: 'exactly X days away' },
	{ id: 'underDaysAgo', label: 'under X days ago' },
	{ id: 'underDaysAway', label: 'under X days away' },
	{ id: 'overDaysAgo', label: 'over X days ago' },
	{ id: 'overDaysAway', label: 'over X days away' },
	{ id: 'thisWeek', label: 'this week' },
	{ id: 'lastWeek', label: 'last week' },
	{ id: 'nextWeek', label: 'next week' },
	{ id: 'thisMonth', label: 'this month' },
	{ id: 'lastMonth', label: 'last month' },
	{ id: 'nextMonth', label: 'next month' },
	{ id: 'dayOfWeekIs', label: 'day of week is' },
	{ id: 'dayOfWeekNot', label: 'day of week is not' },
	{ id: 'monthIs', label: 'month is' },
	{ id: 'monthNot', label: 'month is not' },
	{ id: 'hasAnyValue', label: 'has any value' },
	{ id: 'hasNoValue', label: 'has no value' },
] as const;

// datetime uses the same operators as date for filtering purposes
export const DATETIME_OPERATORS = DATE_OPERATORS;

export const LIST_OPERATORS = [
	{ id: 'anyContains', label: 'any item contains' },
	{ id: 'anyStartsWith', label: 'any item starts with' },
	{ id: 'anyEndsWith', label: 'any item ends with' },
	{ id: 'noneContain', label: 'no item contains' },
	{ id: 'noneStartWith', label: 'no item starts with' },
	{ id: 'noneEndWith', label: 'no item ends with' },
	{ id: 'allAre', label: 'all items are' },
	{ id: 'allContain', label: 'all items contain' },
	{ id: 'countIs', label: 'count is' },
	{ id: 'countNot', label: 'count is not' },
	{ id: 'countLt', label: 'count less than' },
	{ id: 'countGt', label: 'count more than' },
	{ id: 'hasAnyValue', label: 'has any value' },
	{ id: 'hasNoValue', label: 'has no value' },
] as const;

export const CHECKBOX_OPERATORS = [
	{ id: 'isOpen', label: 'is open' },
	{ id: 'isDone', label: 'is done' },
	{ id: 'isCancelled', label: 'is cancelled' },
] as const;

export const PINNED_OPERATORS = [
	{ id: 'isPinned', label: 'is pinned' },
] as const;

export const PROJECT_TREE_OPERATORS = [
	{ id: 'matchesTree', label: 'matches task tree' },
] as const;

export const FOLDER_OPERATORS = [
	{ id: 'isInFolderTree', label: 'is in folder tree' },
] as const;

/** Operators that require no value input */
export const NO_VALUE_OPERATORS = new Set([
	'hasAnyValue', 'hasNoValue', 'propPresent', 'propMissing',
	'isToday', 'notToday', 'beforeToday', 'afterToday',
	'thisWeek', 'lastWeek', 'nextWeek',
	'thisMonth', 'lastMonth', 'nextMonth',
	'isOpen', 'isDone', 'isCancelled',
	'isPinned',
]);

/**
 * Date operators that need a numeric value input (days count, day-of-week, month number)
 * instead of a date picker. Used by the UI to select the correct input type.
 */
export const NUMERIC_INPUT_DATE_OPERATORS = new Set([
	'exactlyDaysAgo', 'exactlyDaysAway',
	'underDaysAgo', 'underDaysAway',
	'overDaysAgo', 'overDaysAway',
	'dayOfWeekIs', 'dayOfWeekNot',
	'monthIs', 'monthNot',
]);

/** Get the operator list for a given field type */
export function getOperatorsForType(type: FilterFieldType): readonly { id: string; label: string }[] {
	switch (type) {
		case 'text': return TEXT_OPERATORS;
		case 'number': return NUMBER_OPERATORS;
		case 'date': return DATE_OPERATORS;
		case 'datetime': return DATETIME_OPERATORS;
		case 'list': return LIST_OPERATORS;
		case 'tags': return LIST_OPERATORS;
		case 'checkbox': return CHECKBOX_OPERATORS;
		case 'pinned': return PINNED_OPERATORS;
		case 'projectTree': return PROJECT_TREE_OPERATORS;
		case 'folders': return FOLDER_OPERATORS;
		default: return TEXT_OPERATORS;
	}
}

// ============================================================
// Main evaluation entry point
// ============================================================

/** Filter and sort an array of tasks using a FilterSet definition */
export function evaluateFilterSet(
	filterSet: FilterSet,
	tasks: IndexedTask[],
	priorities?: { label: string }[],
	pinnedCache?: PinnedCache | null,
): IndexedTask[] {
	const context = createEvalContext(tasks, priorities, pinnedCache);
	const result = tasks.filter(task => matchesFilterSet(filterSet, task, context));
	return sortTasks(result, getSortSpecs(filterSet), context.priorityRankMap, context.pinnedCache);
}

/** Sort a task list using a FilterSet definition without re-applying conditions. */
export function sortFilterTasks(
	filterSet: FilterSet,
	tasks: IndexedTask[],
	priorities?: { label: string }[],
	pinnedCache?: PinnedCache | null,
): IndexedTask[] {
	const context = createEvalContext(tasks, priorities, pinnedCache);
	return sortTasks(tasks, getSortSpecs(filterSet), context.priorityRankMap, context.pinnedCache);
}

/** Filter tasks using filter-set matching only, preserving the original input order. */
export function filterTasksOnly(
	filterSet: FilterSet,
	tasks: IndexedTask[],
	priorities?: { label: string }[],
	pinnedCache?: PinnedCache | null,
): IndexedTask[] {
	const context = createEvalContext(tasks, priorities, pinnedCache);
	return tasks.filter(task => matchesFilterSet(filterSet, task, context));
}

/**
 * Filter, multi-sort, then build grouped results.
 * Tasks with no value for group keys land in the '' (empty) group, rendered last.
 */
export function evaluateFilterSetGrouped(
	filterSet: FilterSet,
	tasks: IndexedTask[],
	priorities?: { label: string }[],
	pinnedCache?: PinnedCache | null,
): GroupedFilterResults {
	const context = createEvalContext(tasks, priorities, pinnedCache);
	const groupBy = filterSet.groupBy!;
	const subgroupBy = filterSet.subgroupBy;
	const sortedTasks = sortTasks(
		tasks.filter(task => matchesFilterSet(filterSet, task, context)),
		getSortSpecs(filterSet),
		context.priorityRankMap,
		context.pinnedCache,
	);
	const groupMap = new Map<string, IndexedTask[]>();
	const subgroupMaps = new Map<string, Map<string, IndexedTask[]>>();

	for (const task of sortedTasks) {
		const groupKey = getGroupKey(task, groupBy, context.pinnedCache);
		if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
		groupMap.get(groupKey)!.push(task);

		if (subgroupBy) {
			if (!subgroupMaps.has(groupKey)) subgroupMaps.set(groupKey, new Map());
			const subgroupKey = getGroupKey(task, subgroupBy, context.pinnedCache);
			const subgroupMap = subgroupMaps.get(groupKey)!;
			if (!subgroupMap.has(subgroupKey)) subgroupMap.set(subgroupKey, []);
			subgroupMap.get(subgroupKey)!.push(task);
		}
	}

	const groups = [...groupMap.entries()]
		.sort(([a], [b]) => compareGroupKeys(a, b, groupBy, filterSet.groupOrder, context.priorityRankMap))
		.map(([key, groupTasks]) => {
			const subgroups = subgroupBy
				? [...(subgroupMaps.get(key)?.entries() ?? [])]
					.sort(([a], [b]) => compareGroupKeys(a, b, subgroupBy, filterSet.subgroupOrder, context.priorityRankMap))
					.map(([subgroupKey, subgroupTasks]) => ({
						key: subgroupKey,
						label: subgroupKey || '(no value)',
						count: subgroupTasks.length,
						tasks: subgroupTasks,
					}))
				: undefined;

			return {
				key,
				label: key || '(no value)',
				count: groupTasks.length,
				tasks: groupTasks,
				subgroups,
			};
		});

	return {
		totalCount: sortedTasks.length,
		groups,
	};
}

function getGroupKey(task: IndexedTask, groupBy: string, pinnedCache?: PinnedCache | null): string {
	if (groupBy === 'checkbox') return task.checkbox;
	if (groupBy === 'description') return task.description;
	if (groupBy === 'pinned') return pinnedCache?.isPinned(task.operonId) ? 'true' : '';
	if (groupBy === 'happensOn') return getPrimaryHappensOnDateValue(task);
	return task.fieldValues[groupBy] ?? '';
}

function matchesFilterSet(filterSet: FilterSet, task: IndexedTask, context: EvalContext): boolean {
	const rootGroup = getRootGroup(filterSet);
	if (rootGroup.children.length === 0) return true;
	return matchesFilterGroup(rootGroup, task, context);
}

function getRootGroup(filterSet: FilterSet): FilterGroup {
	if (filterSet.rootGroup?.children) return filterSet.rootGroup;
	return {
		id: `derived_${filterSet.id}`,
		logic: filterSet.matchLogic,
		children: filterSet.conditions,
	};
}

function matchesFilterNode(node: FilterNode, task: IndexedTask, context: EvalContext): boolean {
	if (isFilterGroup(node)) return matchesFilterGroup(node, task, context);
	return evaluateCondition(node, task, context);
}

function matchesFilterGroup(group: FilterGroup, task: IndexedTask, context: EvalContext): boolean {
	if (group.children.length === 0) return true;
	const orderedChildren = [...group.children].sort(compareFilterNodeCost);

	switch (group.logic) {
		case 'all':
			for (const child of orderedChildren) {
				if (!matchesFilterNode(child, task, context)) return false;
			}
			return true;
		case 'any':
			for (const child of orderedChildren) {
				if (matchesFilterNode(child, task, context)) return true;
			}
			return false;
		case 'none':
			for (const child of orderedChildren) {
				if (matchesFilterNode(child, task, context)) return false;
			}
			return true;
		default: return true;
	}
}

function isFilterGroup(node: FilterNode): node is FilterGroup {
	return !!node && typeof node === 'object' && Array.isArray((node as FilterGroup).children);
}

function compareFilterNodeCost(a: FilterNode, b: FilterNode): number {
	return getFilterNodeCost(a) - getFilterNodeCost(b);
}

function getFilterNodeCost(node: FilterNode): number {
	if (isFilterGroup(node)) return 4;
	if (node.field === 'pinned' || node.fieldType === 'pinned') return 0;
	if (node.fieldType === 'checkbox') return 0;
	if (node.fieldType === 'date' || node.fieldType === 'datetime') return 1;
	if (node.fieldType === 'number') return 2;
	if (node.fieldType === 'list' || node.fieldType === 'tags') return 3;
	if (node.fieldType === 'projectTree') return 6;
	if (node.fieldType === 'folders') return 6;
	return 5;
}

function getSortSpecs(filterSet: FilterSet): FilterSortSpec[] {
	if (filterSet.sorts.length > 0) return filterSet.sorts;
	if (filterSet.sortBy) {
		return [{
			field: filterSet.sortBy,
			order: filterSet.sortOrder ?? 'asc',
		}];
	}
	return [];
}

// ============================================================
// Condition evaluation
// ============================================================

function evaluateCondition(cond: FilterSetCondition, task: IndexedTask, context: EvalContext): boolean {
	const isDescriptionField = cond.field === 'description';
	const rawFieldValue = isDescriptionField ? task.description : task.fieldValues[cond.field];
	const hasProperty = isDescriptionField
		? true
		: Object.prototype.hasOwnProperty.call(task.fieldValues, cond.field) === true;

	switch (cond.fieldType) {
		case 'date':
		case 'datetime':
			if (cond.field === 'happensOn') {
				return evaluateDateSetCondition(
					cond.operator,
					getHappensOnDateValues(task),
					cond.value ?? '',
					context.today,
				);
			}
			return evaluateDateCondition(
				cond.operator,
				rawFieldValue ?? '',
				cond.value ?? '',
				context.today,
			);

		case 'pinned':
			return evaluatePinnedCondition(cond.operator, task, context.pinnedCache);

		case 'projectTree':
			return evaluateProjectTreeCondition(
				cond.operator,
				task,
				cond.value ?? '',
				context,
			);

		case 'folders':
			return evaluateFolderCondition(
				cond.operator,
				task,
				cond.value ?? '',
				context,
			);

		case 'checkbox':
			return evaluateCheckboxCondition(cond.operator, task.checkbox);

		case 'text':
			return evaluateTextCondition(
				cond.operator,
				rawFieldValue,
				cond.value ?? '',
				hasProperty,
			);

		case 'number':
			return evaluateNumberCondition(
				cond.operator,
				rawFieldValue,
				cond.value ?? '',
				hasProperty,
			);

		case 'list':
			return evaluateListCondition(
				cond.operator,
				parseListValue(task.fieldValues[cond.field] ?? ''),
				cond.value ?? '',
			);

		case 'tags':
			return evaluateListCondition(
				cond.operator,
				task.tags,
				cond.value ?? '',
			);

		default:
			if (cond.field === 'pinned') return evaluatePinnedCondition(cond.operator, task, context.pinnedCache);
			return true;
	}
}

// ============================================================
// Type-specific evaluators
// ============================================================

function evaluateCheckboxCondition(op: string, checkbox: string): boolean {
	switch (op) {
		case 'isOpen': return checkbox === 'open';
		case 'isDone': return checkbox === 'done';
		case 'isCancelled': return checkbox === 'cancelled';
		default: return false;
	}
}

function evaluatePinnedCondition(op: string, task: IndexedTask, pinnedCache?: PinnedCache | null): boolean {
	switch (op) {
		case 'isPinned':
			return pinnedCache?.isPinned(task.operonId) ?? false;
		default:
			return false;
	}
}

function evaluateProjectTreeCondition(op: string, task: IndexedTask, target: string, context: EvalContext): boolean {
	switch (op) {
		case 'matchesTree':
			return resolveProjectTreeMatches(target, context).has(task.operonId);
		default:
			return false;
	}
}

function evaluateFolderCondition(op: string, task: IndexedTask, target: string, context: EvalContext): boolean {
	switch (op) {
		case 'isInFolderTree':
			return resolveFolderTreeMatches(target, context).has(task.operonId);
		default:
			return false;
	}
}

function resolveProjectTreeMatches(query: string, context: EvalContext): Set<string> {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return new Set<string>();

	const cached = context.projectTreeMatchCache.get(normalizedQuery);
	if (cached) return cached;

	const exactIdRoots: string[] = [];
	const partialRoots: string[] = [];
	for (const task of context.taskById.values()) {
		const taskId = task.operonId.toLowerCase();
		const description = task.description.toLowerCase();
		if (taskId === normalizedQuery) {
			exactIdRoots.push(task.operonId);
			continue;
		}
		if (taskId.includes(normalizedQuery) || description.includes(normalizedQuery)) {
			partialRoots.push(task.operonId);
		}
	}

	const rootIds = exactIdRoots.length > 0 ? exactIdRoots : partialRoots;
	const matches = new Set<string>();
	for (const rootId of rootIds) {
		matches.add(rootId);
		for (const descendantId of collectDescendantIds(rootId, context.childIdsByParentId)) {
			matches.add(descendantId);
		}
	}

	context.projectTreeMatchCache.set(normalizedQuery, matches);
	return matches;
}

function collectDescendantIds(rootId: string, childIdsByParentId: Map<string, string[]>): Set<string> {
	const descendants = new Set<string>();
	const stack = [...(childIdsByParentId.get(rootId) ?? [])];

	while (stack.length > 0) {
		const currentId = stack.pop()!;
		if (descendants.has(currentId)) continue;
		descendants.add(currentId);
		const childIds = childIdsByParentId.get(currentId) ?? [];
		for (const childId of childIds) {
			if (!descendants.has(childId)) stack.push(childId);
		}
	}

	return descendants;
}

function resolveFolderTreeMatches(query: string, context: EvalContext): Set<string> {
	const normalizedQuery = normalizeFolderQuery(query);
	if (!normalizedQuery) return new Set<string>();

	const cached = context.folderTreeMatchCache.get(normalizedQuery);
	if (cached) return cached;

	const matches = new Set<string>();
	for (const task of context.taskById.values()) {
		const folderPath = getFolderPath(task.primary.filePath);
		if (isFolderTreeMatch(folderPath, normalizedQuery)) {
			matches.add(task.operonId);
		}
	}

	context.folderTreeMatchCache.set(normalizedQuery, matches);
	return matches;
}

function normalizeFolderQuery(query: string): string {
	return query
		.replace(/\\/g, '/')
		.trim()
		.replace(/^\/+|\/+$/g, '')
		.toLowerCase();
}

function getFolderPath(filePath: string): string {
	const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	const lastSlashIndex = normalizedPath.lastIndexOf('/');
	if (lastSlashIndex === -1) return '';
	return normalizedPath.slice(0, lastSlashIndex).toLowerCase();
}

function isFolderTreeMatch(folderPath: string, normalizedQuery: string): boolean {
	if (!folderPath) return false;
	if (folderPath === normalizedQuery) return true;

	const queryLooksLikePath = normalizedQuery.includes('/');
	const segments = folderPath.split('/').filter(Boolean);
	let currentPath = '';

	for (const segment of segments) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		if (queryLooksLikePath) {
			if (currentPath === normalizedQuery || currentPath.endsWith(`/${normalizedQuery}`)) {
				return true;
			}
			continue;
		}

		if (segment === normalizedQuery) return true;
	}

	return false;
}

function evaluateTextCondition(op: string, value: string | undefined, target: string, hasProperty: boolean): boolean {
	const rawValue = value ?? '';
	const v = rawValue.toLowerCase();
	const t = target.toLowerCase();
	switch (op) {
		case 'contains': return v.includes(t);
		case 'notContains': return !v.includes(t);
		case 'is': return v === t;
		case 'isNot': return v !== t;
		case 'startsWith': return v.startsWith(t);
		case 'endsWith': return v.endsWith(t);
		case 'hasAnyValue': return rawValue.trim() !== '';
		case 'hasNoValue': return rawValue.trim() === '';
		case 'propPresent': return hasProperty;
		case 'propMissing': return !hasProperty;
		default: return true;
	}
}

function evaluateNumberCondition(op: string, rawValue: string | undefined, target: string, hasProperty: boolean): boolean {
	const normalizedValue = rawValue ?? '';
	const hasValue = normalizedValue.trim() !== '';
	const num = parseFloat(normalizedValue);
	const tgt = parseFloat(target);

	switch (op) {
		case 'hasAnyValue': return hasValue;
		case 'hasNoValue': return !hasValue;
		case 'propPresent': return hasProperty;
		case 'propMissing': return !hasProperty;
		case 'eq': return hasValue && !isNaN(tgt) && num === tgt;
		case 'neq': return hasValue && !isNaN(tgt) && num !== tgt;
		case 'lt': return hasValue && !isNaN(tgt) && num < tgt;
		case 'gt': return hasValue && !isNaN(tgt) && num > tgt;
		case 'lte': return hasValue && !isNaN(tgt) && num >= tgt;
		case 'gte': return hasValue && !isNaN(tgt) && num <= tgt;
		case 'divisible': return hasValue && !isNaN(tgt) && tgt !== 0 && num % tgt === 0;
		case 'notDivisible': return hasValue && !isNaN(tgt) && tgt !== 0 && num % tgt !== 0;
		default: return true;
	}
}

function evaluateDateCondition(op: string, value: string, target: string, today: string): boolean {
	const hasValue = value.trim() !== '';

	switch (op) {
		case 'hasAnyValue': return hasValue;
		case 'hasNoValue': return !hasValue;
		case 'isToday': return value === today;
		case 'notToday': return hasValue && value !== today;
		case 'beforeToday': return hasValue && value < today;
		case 'afterToday': return hasValue && value > today;
		case 'dateIs': return value === target;
		case 'before': return hasValue && value < target;
		case 'after': return hasValue && value > target;
		case 'exactlyDaysAgo': {
			const n = parseInt(target, 10);
			if (isNaN(n) || !hasValue) return false;
			return value === offsetDate(today, -n);
		}
		case 'exactlyDaysAway': {
			const n = parseInt(target, 10);
			if (isNaN(n) || !hasValue) return false;
			return value === offsetDate(today, n);
		}
		case 'underDaysAgo': {
			const n = parseInt(target, 10);
			if (isNaN(n) || !hasValue) return false;
			const threshold = offsetDate(today, -n);
			return value >= threshold && value < today;
		}
		case 'underDaysAway': {
			const n = parseInt(target, 10);
			if (isNaN(n) || !hasValue) return false;
			const threshold = offsetDate(today, n);
			return value > today && value <= threshold;
		}
		case 'overDaysAgo': {
			const n = parseInt(target, 10);
			if (isNaN(n) || !hasValue) return false;
			return value < offsetDate(today, -n);
		}
		case 'overDaysAway': {
			const n = parseInt(target, 10);
			if (isNaN(n) || !hasValue) return false;
			return value > offsetDate(today, n);
		}
		case 'thisWeek': {
			if (!hasValue) return false;
			const { start, end } = getWeekRange(today, 0);
			const dateOnly = value.slice(0, 10); // handle datetime values
			return dateOnly >= start && dateOnly <= end;
		}
		case 'lastWeek': {
			if (!hasValue) return false;
			const { start, end } = getWeekRange(today, -1);
			const dateOnly = value.slice(0, 10);
			return dateOnly >= start && dateOnly <= end;
		}
		case 'nextWeek': {
			if (!hasValue) return false;
			const { start, end } = getWeekRange(today, 1);
			const dateOnly = value.slice(0, 10);
			return dateOnly >= start && dateOnly <= end;
		}
		case 'thisMonth': {
			if (!hasValue) return false;
			const dateOnly = value.slice(0, 10);
			return dateOnly.slice(0, 7) === today.slice(0, 7);
		}
		case 'lastMonth': {
			if (!hasValue) return false;
			const { ym } = getMonthOffset(today, -1);
			return value.slice(0, 7) === ym;
		}
		case 'nextMonth': {
			if (!hasValue) return false;
			const { ym } = getMonthOffset(today, 1);
			return value.slice(0, 7) === ym;
		}
		case 'dayOfWeekIs': {
			if (!hasValue) return false;
			const d = new Date(value + 'T00:00:00');
			return d.getDay() === parseInt(target, 10);
		}
		case 'dayOfWeekNot': {
			if (!hasValue) return false;
			const d = new Date(value + 'T00:00:00');
			return d.getDay() !== parseInt(target, 10);
		}
		case 'monthIs': {
			if (!hasValue) return false;
			const d = new Date(value + 'T00:00:00');
			return (d.getMonth() + 1) === parseInt(target, 10);
		}
		case 'monthNot': {
			if (!hasValue) return false;
			const d = new Date(value + 'T00:00:00');
			return (d.getMonth() + 1) !== parseInt(target, 10);
		}
		default: return true;
	}
}

function evaluateDateSetCondition(op: string, values: string[], target: string, today: string): boolean {
	const normalizedValues = values
		.map(value => value.trim())
		.filter(Boolean);
	const hasAnyValue = normalizedValues.length > 0;

	switch (op) {
		case 'hasAnyValue': return hasAnyValue;
		case 'hasNoValue': return !hasAnyValue;
		case 'notToday':
		case 'dayOfWeekNot':
		case 'monthNot':
			return hasAnyValue && normalizedValues.every(value =>
				!evaluateDateCondition(getPositiveDateOperatorForNegative(op), value, target, today),
			);
		default:
			return normalizedValues.some(value => evaluateDateCondition(op, value, target, today));
	}
}

function getPositiveDateOperatorForNegative(op: string): string {
	switch (op) {
		case 'notToday': return 'isToday';
		case 'dayOfWeekNot': return 'dayOfWeekIs';
		case 'monthNot': return 'monthIs';
		default: return op;
	}
}

function getHappensOnDateValues(task: IndexedTask): string[] {
	return [
		task.fieldValues['dateStarted'] ?? '',
		task.fieldValues['dateScheduled'] ?? '',
		task.fieldValues['dateDue'] ?? '',
	];
}

function getPrimaryHappensOnDateValue(task: IndexedTask): string {
	return (task.fieldValues['dateScheduled'] ?? '').trim()
		|| (task.fieldValues['dateDue'] ?? '').trim()
		|| (task.fieldValues['dateStarted'] ?? '').trim();
}

function evaluateListCondition(op: string, items: string[], target: string): boolean {
	const t = target.toLowerCase();
	const count = items.length;

	switch (op) {
		case 'anyContains': return items.some(i => i.toLowerCase().includes(t));
		case 'anyStartsWith': return items.some(i => i.toLowerCase().startsWith(t));
		case 'anyEndsWith': return items.some(i => i.toLowerCase().endsWith(t));
		case 'noneContain': return items.every(i => !i.toLowerCase().includes(t));
		case 'noneStartWith': return items.every(i => !i.toLowerCase().startsWith(t));
		case 'noneEndWith': return items.every(i => !i.toLowerCase().endsWith(t));
		case 'allAre': return count > 0 && items.every(i => i.toLowerCase() === t);
		case 'allContain': return count > 0 && items.every(i => i.toLowerCase().includes(t));
		case 'countIs': return count === parseInt(target, 10);
		case 'countNot': return count !== parseInt(target, 10);
		case 'countLt': return count < parseInt(target, 10);
		case 'countGt': return count > parseInt(target, 10);
		case 'hasAnyValue': return count > 0;
		case 'hasNoValue': return count === 0;
		default: return true;
	}
}

// ============================================================
// Sort
// ============================================================

function sortTasks(
	tasks: IndexedTask[],
	sorts: FilterSortSpec[],
	priorityRankMap?: Record<string, number> | null,
	pinnedCache?: PinnedCache | null,
): IndexedTask[] {
	if (sorts.length === 0) return tasks;

	return [...tasks].sort((a, b) => {
		for (const sort of sorts) {
			const cmp = compareTaskBySortSpec(a, b, sort, priorityRankMap, pinnedCache);
			if (cmp !== 0) return cmp;
		}
		return 0;
	});
}

function compareTaskBySortSpec(
	a: IndexedTask,
	b: IndexedTask,
	sort: FilterSortSpec,
	priorityRankMap?: Record<string, number> | null,
	pinnedCache?: PinnedCache | null,
): number {
	const asc = sort.order !== 'desc';
	let cmp = 0;

	if (sort.field === 'checkbox') {
		const order: Record<string, number> = { open: 0, done: 1, cancelled: 2 };
		cmp = (order[a.checkbox] ?? 0) - (order[b.checkbox] ?? 0);
	} else if (sort.field === 'description') {
		cmp = a.description.localeCompare(b.description, undefined, { sensitivity: 'base' });
	} else if (sort.field === 'pinned') {
		const aPinned = pinnedCache?.isPinned(a.operonId) ? 0 : 1;
		const bPinned = pinnedCache?.isPinned(b.operonId) ? 0 : 1;
		cmp = aPinned - bPinned;
	} else if (sort.field === 'priority' && priorityRankMap) {
		const aRank = priorityRankMap[a.fieldValues['priority'] ?? ''] ?? 999;
		const bRank = priorityRankMap[b.fieldValues['priority'] ?? ''] ?? 999;
		cmp = aRank - bRank;
	} else {
		const aVal = a.fieldValues[sort.field] ?? '';
		const bVal = b.fieldValues[sort.field] ?? '';
		cmp = aVal.localeCompare(bVal);
	}

	return asc ? cmp : -cmp;
}

function compareGroupKeys(
	a: string,
	b: string,
	field: string,
	order: 'asc' | 'desc' | undefined,
	priorityRankMap?: Record<string, number> | null,
): number {
	if (a === '') return 1;
	if (b === '') return -1;
	let cmp: number;
	if (field === 'priority' && priorityRankMap) {
		cmp = (priorityRankMap[a] ?? 999) - (priorityRankMap[b] ?? 999);
	} else if (field === 'pinned') {
		const aPinned = a === 'true' ? 0 : 1;
		const bPinned = b === 'true' ? 0 : 1;
		cmp = aPinned - bPinned;
	} else {
		cmp = a.localeCompare(b);
	}
	return order === 'desc' ? -cmp : cmp;
}

// ============================================================
// Helpers
// ============================================================

/** Split a semicolon-separated list value string into individual items */
function parseListValue(raw: string): string[] {
	if (!raw.trim()) return [];
	return raw.split(';').map(s => s.trim()).filter(s => s.length > 0);
}

/** Offset a YYYY-MM-DD date string by N days */
function offsetDate(dateStr: string, days: number): string {
	const d = new Date(dateStr + 'T00:00:00');
	d.setDate(d.getDate() + days);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Get Monday–Sunday range for a week offset from today (0 = this week, -1 = last, +1 = next) */
function getWeekRange(today: string, weekOffset: number): { start: string; end: string } {
	const d = new Date(today + 'T00:00:00');
	// Monday-based week: getDay() returns 0 for Sunday, adjust to 1-based Monday start
	const dayOfWeek = d.getDay();
	const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	d.setDate(d.getDate() + mondayOffset + (weekOffset * 7));
	const start = offsetDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 0);
	const end = offsetDate(start, 6);
	return { start, end };
}

/** Get YYYY-MM string for a month offset from today (0 = this month, -1 = last, +1 = next) */
function getMonthOffset(today: string, monthOffset: number): { ym: string } {
	const d = new Date(today + 'T00:00:00');
	d.setMonth(d.getMonth() + monthOffset);
	const pad = (n: number) => String(n).padStart(2, '0');
	return { ym: `${d.getFullYear()}-${pad(d.getMonth() + 1)}` };
}

function createEvalContext(
	tasks: IndexedTask[],
	priorities?: { label: string }[],
	pinnedCache?: PinnedCache | null,
): EvalContext {
	const taskById = new Map<string, IndexedTask>();
	const childIdsByParentId = new Map<string, string[]>();
	for (const task of tasks) {
		taskById.set(task.operonId, task);
		const parentId = (task.fieldValues['parentTask'] ?? '').trim();
		if (!parentId) continue;
		const existing = childIdsByParentId.get(parentId);
		if (existing) {
			existing.push(task.operonId);
		} else {
			childIdsByParentId.set(parentId, [task.operonId]);
		}
	}

	return {
		today: localToday(),
		priorityRankMap: buildPriorityRankMap(priorities),
		pinnedCache: pinnedCache ?? null,
		taskById,
		childIdsByParentId,
		projectTreeMatchCache: new Map<string, Set<string>>(),
		folderTreeMatchCache: new Map<string, Set<string>>(),
	};
}

function buildPriorityRankMap(priorities?: { label: string }[]): Record<string, number> | null {
	if (!priorities || priorities.length === 0) return null;
	const priorityRankMap: Record<string, number> = {};
	priorities.forEach((priority, index) => {
		priorityRankMap[priority.label] = index;
	});
	return priorityRankMap;
}
