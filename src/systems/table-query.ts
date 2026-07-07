import { filterTasksForCalendar } from './calendar-filter-materialization';
import type { PinnedCache } from '../storage/pinned-cache';
import type { IndexedTask } from '../types/fields';
import type { TablePreset, TableSortDirection, TableSortRule, TableSummaryRule } from '../types/table';
import type { FilterSet, OperonSettings } from '../types/settings';
import { parseListValue } from '../core/parser';
import { getTableTaskField, normalizeTableTaskFieldKey } from '../ui/table/table-field-catalog';
import { evaluateTableSummaries, filterCompatibleTableSummaryRules, type TableSummaryCell } from '../ui/table/table-summary';
import { compareTableSourceOrder } from '../ui/table/table-value-adapter';
import { CHECKBOX_PROGRESS_COLUMN_KEY } from '../ui/task-progress-tracks';
import {
	createTableValueResolver,
	formatTableValueCacheStats,
	TABLE_NO_GROUP_VALUE_KEY,
	type TableCachedGroupValue,
	type TableCachedSortValue,
	type TableSortValueKind,
	type TableValueResolver,
} from '../ui/table/table-value-cache';
import { enginePerfLog, enginePerfNow } from '../core/engine-perf';

type TableQuerySettings = Pick<OperonSettings, 'keyMappings' | 'pipelines'>;

interface TableQueryBucket {
	key: string;
	fieldKey: string;
	value: string;
	label: string;
	isNoValue: boolean;
	sortValue: TableCachedSortValue;
	count: number;
	rows: IndexedTask[];
}

export type TableQuerySubgroup = TableQueryBucket;

export interface TableQueryGroup extends TableQueryBucket {
	subgroups?: TableQuerySubgroup[];
}

export interface TableQueryResult {
	preset: TablePreset;
	filterSet: FilterSet | null;
	scopedTasks: IndexedTask[];
	scopeFilteredTasks: IndexedTask[];
	searchedTasks: IndexedTask[];
	rows: IndexedTask[];
	groups: TableQueryGroup[];
	valueResolver: TableValueResolver;
	summaries: Map<string, TableSummaryCell>;
	groupSummaries: Map<string, Map<string, TableSummaryCell>>;
	counts: {
		scoped: number;
		scopeFiltered: number;
		searched: number;
		final: number;
	};
}

export type TableQuerySummaryMode = 'evaluate' | 'skip';

export function evaluateTableQuerySummaries(options: {
	rows: readonly IndexedTask[];
	groups: readonly TableQueryGroup[];
	rules: readonly TableSummaryRule[];
	allTasks: readonly IndexedTask[];
	settings: TableQuerySettings;
	valueResolver: TableValueResolver;
}): {
	summaries: Map<string, TableSummaryCell>;
	groupSummaries: Map<string, Map<string, TableSummaryCell>>;
} {
	return {
		summaries: evaluateTableSummaries({
			rows: options.rows,
			rules: options.rules,
			allTasks: options.allTasks,
			settings: options.settings,
			valueResolver: options.valueResolver,
		}),
		groupSummaries: evaluateTableGroupSummaries(
			options.groups,
			options.rules,
			options.allTasks,
			options.settings,
			options.valueResolver,
		),
	};
}

export function queryTableRows(options: {
	preset: TablePreset;
	filterSet: FilterSet | null;
	tasks: IndexedTask[];
	priorities: { label: string; color?: string }[];
	pinnedCache?: PinnedCache | null;
	settings?: TableQuerySettings;
	searchQuery?: string | null;
	searchMatcher?: (task: IndexedTask, normalizedQuery: string) => boolean;
	taskScopeFilter?: (task: IndexedTask) => boolean;
	taskIdFilter?: Iterable<string>;
	precomputedScopedTasks?: readonly IndexedTask[];
	precomputedScopeFilteredTasks?: readonly IndexedTask[];
	precomputedSearchedTasks?: readonly IndexedTask[];
	precomputedRows?: readonly IndexedTask[];
	summaryMode?: TableQuerySummaryMode;
}): TableQueryResult {
	const startedAt = enginePerfNow();
	const { preset, filterSet, tasks, priorities, pinnedCache } = options;
	const scopedTasks = options.precomputedScopedTasks
		? [...options.precomputedScopedTasks]
		: filterTasksForCalendar(filterSet, tasks, priorities, pinnedCache ?? null);
	const scopedAt = enginePerfNow();
	const allowedTaskIds = options.taskIdFilter ? new Set(options.taskIdFilter) : null;
	const scopeFilteredTasks = options.precomputedScopeFilteredTasks
		? [...options.precomputedScopeFilteredTasks]
		: scopedTasks
			.filter(task => options.taskScopeFilter?.(task) ?? true)
			.filter(task => !allowedTaskIds || allowedTaskIds.has(task.operonId));
	const scopeFilteredAt = enginePerfNow();
	const normalizedSearchQuery = (options.searchQuery ?? '').trim().toLocaleLowerCase();
	const searchedTasks = options.precomputedSearchedTasks
		? [...options.precomputedSearchedTasks]
		: normalizedSearchQuery
		? scopeFilteredTasks.filter(task => options.searchMatcher?.(task, normalizedSearchQuery) ?? true)
		: scopeFilteredTasks;
	const searchedAt = enginePerfNow();
	const valueResolver = createTableValueResolver(tasks, options.settings);
	const priorityRank = buildTablePriorityRank(priorities);
	const rows = options.precomputedRows
		? [...options.precomputedRows]
		: sortTableRows(searchedTasks, preset.sortRules, valueResolver, priorityRank, options.settings);
	const sortedAt = enginePerfNow();
	const groupBy = resolveTableGroupBy(preset.groupBy, options.settings);
	const subgroupBy = groupBy ? resolveTableGroupBy(preset.subgroupBy, options.settings) : null;
	const resolvedSubgroupBy = subgroupBy && subgroupBy !== groupBy ? subgroupBy : null;
	const summaries = options.settings ? filterCompatibleTableSummaryRules(preset.summaries, options.settings) : preset.summaries;
	const resolvedGroupOrder = groupBy ? preset.groupOrder : 'asc';
	const resolvedSubgroupOrder = resolvedSubgroupBy ? preset.subgroupOrder : 'asc';
	const resolvedPreset = groupBy === preset.groupBy
		&& resolvedGroupOrder === preset.groupOrder
		&& resolvedSubgroupBy === preset.subgroupBy
		&& resolvedSubgroupOrder === preset.subgroupOrder
		&& summaries === preset.summaries
		? preset
		: { ...preset, groupBy, groupOrder: resolvedGroupOrder, subgroupBy: resolvedSubgroupBy, subgroupOrder: resolvedSubgroupOrder, summaries };
	const groups = groupBy
		? buildTableGroups(
			rows,
			{
				groupBy,
				groupOrder: resolvedGroupOrder,
				subgroupBy: resolvedSubgroupBy,
				subgroupOrder: resolvedSubgroupOrder,
			},
			valueResolver,
			priorityRank,
			options.settings,
		)
		: [];
	const groupedAt = enginePerfNow();
	const shouldEvaluateSummaries = options.summaryMode !== 'skip';
	const evaluatedSummaries = options.settings && shouldEvaluateSummaries
		? evaluateTableQuerySummaries({
			rows,
			groups,
			rules: summaries,
			allTasks: tasks,
			settings: options.settings,
			valueResolver,
		})
		: null;
	const summaryCells = evaluatedSummaries?.summaries ?? new Map<string, TableSummaryCell>();
	const groupSummaryCells = evaluatedSummaries?.groupSummaries ?? new Map<string, Map<string, TableSummaryCell>>();
	const summarizedAt = enginePerfNow();
	enginePerfLog(
		'table.query',
		`${Math.round(summarizedAt - startedAt)}ms`,
		`tasks=${tasks.length}`,
		`rows=${rows.length}`,
		`summaries=${shouldEvaluateSummaries ? 'evaluate' : 'skip'}`,
		`stages=scope:${Math.round(scopedAt - startedAt)},taskScope:${Math.round(scopeFilteredAt - scopedAt)},search:${Math.round(searchedAt - scopeFilteredAt)},sort:${Math.round(sortedAt - searchedAt)},group:${Math.round(groupedAt - sortedAt)},summary:${Math.round(summarizedAt - groupedAt)}`,
		`cache=${formatTableValueCacheStats(valueResolver.getStats())}`,
	);
	return {
		preset: resolvedPreset,
		filterSet,
		scopedTasks,
		scopeFilteredTasks,
		searchedTasks,
		rows,
		groups,
		valueResolver,
		summaries: summaryCells,
		groupSummaries: groupSummaryCells,
		counts: {
			scoped: scopedTasks.length,
			scopeFiltered: scopeFilteredTasks.length,
			searched: searchedTasks.length,
			final: rows.length,
		},
	};
}

function evaluateTableGroupSummaries(
	groups: readonly TableQueryGroup[],
	rules: readonly TableSummaryRule[],
	allTasks: readonly IndexedTask[],
	settings: TableQuerySettings,
	valueResolver: TableValueResolver,
): Map<string, Map<string, TableSummaryCell>> {
	const result = new Map<string, Map<string, TableSummaryCell>>();
	if (rules.length === 0 || groups.length === 0) return result;
	for (const group of groups) {
		for (const subgroup of group.subgroups ?? []) {
			result.set(createTableGroupPathKey(group.key, subgroup.key), evaluateTableSummaries({
				rows: subgroup.rows,
				rules,
				allTasks,
				settings,
				valueResolver,
			}));
		}
		// Collapsed top-level group headers look their summary hints up by the plain
		// group key, so subgrouped groups need a whole-group aggregate alongside the
		// per-subgroup path entries.
		result.set(group.key, evaluateTableSummaries({
			rows: group.rows,
			rules,
			allTasks,
			settings,
			valueResolver,
		}));
	}
	return result;
}

function resolveTableGroupBy(
	groupBy: string | null | undefined,
	settings: TableQuerySettings | undefined,
): string | null {
	const trimmed = groupBy?.trim();
	if (!trimmed) return null;
	return settings ? normalizeTableTaskFieldKey(trimmed, settings) : trimmed;
}

function buildTableGroups(
	rows: readonly IndexedTask[],
	options: {
		groupBy: string;
		groupOrder: TableSortDirection;
		subgroupBy: string | null;
		subgroupOrder: TableSortDirection;
	},
	valueResolver: TableValueResolver,
	priorityRank: ReadonlyMap<string, number>,
	settings: TableQuerySettings | undefined,
): TableQueryGroup[] {
	const groupsByValue = new Map<string, TableQueryGroup>();
	const subgroupsByGroupValue = new Map<string, Map<string, TableQuerySubgroup>>();
	const { groupBy, groupOrder, subgroupBy, subgroupOrder } = options;
	const sortKind = getTableSortValueKind(groupBy, settings);
	const subgroupSortKind = subgroupBy ? getTableSortValueKind(subgroupBy, settings) : null;
	for (const task of rows) {
		const groupValues = resolveTableGroupValues(task, groupBy, valueResolver, settings);
		for (const groupValue of groupValues) {
			let group = groupsByValue.get(groupValue.groupKey);
			if (!group) {
				const sortValue = groupValue.isNoValue
					? null
					: resolveTableGroupSortValue(task, groupBy, groupValue.rawValue, sortKind, priorityRank, valueResolver);
				group = {
					key: groupValue.groupKey,
					fieldKey: groupBy,
					value: groupValue.rawValue,
					label: groupValue.label,
					isNoValue: groupValue.isNoValue,
					sortValue,
					count: 0,
					rows: [],
				};
				groupsByValue.set(groupValue.groupKey, group);
			}
			group.rows.push(task);
			group.count++;
			if (!subgroupBy || !subgroupSortKind) continue;
			let subgroupsByValue = subgroupsByGroupValue.get(group.key);
			if (!subgroupsByValue) {
				subgroupsByValue = new Map<string, TableQuerySubgroup>();
				subgroupsByGroupValue.set(group.key, subgroupsByValue);
			}
			const subgroupValues = resolveTableGroupValues(task, subgroupBy, valueResolver, settings);
			for (const subgroupValue of subgroupValues) {
				let subgroup = subgroupsByValue.get(subgroupValue.groupKey);
				if (!subgroup) {
					const sortValue = subgroupValue.isNoValue
						? null
						: resolveTableGroupSortValue(task, subgroupBy, subgroupValue.rawValue, subgroupSortKind, priorityRank, valueResolver);
					subgroup = {
						key: subgroupValue.groupKey,
						fieldKey: subgroupBy,
						value: subgroupValue.rawValue,
						label: subgroupValue.label,
						isNoValue: subgroupValue.isNoValue,
						sortValue,
						count: 0,
						rows: [],
					};
					subgroupsByValue.set(subgroupValue.groupKey, subgroup);
				}
				subgroup.rows.push(task);
				subgroup.count++;
			}
		}
	}
	const groups = Array.from(groupsByValue.values()).sort((left, right) => compareTableGroups(left, right, groupOrder));
	if (subgroupBy) {
		for (const group of groups) {
			const subgroups = subgroupsByGroupValue.get(group.key);
			if (!subgroups) continue;
			group.subgroups = Array.from(subgroups.values()).sort((left, right) => compareTableGroups(left, right, subgroupOrder));
		}
	}
	return groups;
}

function resolveTableGroupValues(
	task: IndexedTask,
	groupBy: string,
	valueResolver: TableValueResolver,
	settings: TableQuerySettings | undefined,
): TableCachedGroupValue[] {
	if (!settings || !isListLikeTableGroupField(groupBy, settings)) {
		return [valueResolver.getGroupValue(task, groupBy)];
	}
	const rawValue = valueResolver.getRawValue(task, groupBy).trim();
	const values = parseListValue(rawValue)
		.map(value => value.trim())
		.filter(value => value.length > 0);
	if (values.length === 0) {
		return rawValue.length === 0
			? [valueResolver.getGroupValue(task, groupBy)]
			: [createNoValueTableGroupValue(groupBy)];
	}
	const seen = new Set<string>();
	return values.flatMap(value => {
		const valueKey = value.toLocaleLowerCase();
		if (seen.has(valueKey)) return [];
		seen.add(valueKey);
		return [{
			rawValue: value,
			isNoValue: false,
			valueKey,
			groupKey: `${groupBy}:${valueKey}`,
			label: value,
		}];
	});
}

function createNoValueTableGroupValue(groupBy: string): TableCachedGroupValue {
	return {
		rawValue: '',
		isNoValue: true,
		valueKey: TABLE_NO_GROUP_VALUE_KEY,
		groupKey: `${groupBy}:${TABLE_NO_GROUP_VALUE_KEY}`,
		label: '',
	};
}

function resolveTableGroupSortValue(
	task: IndexedTask,
	groupBy: string,
	rawValue: string,
	sortKind: TableSortValueKind,
	priorityRank: ReadonlyMap<string, number>,
	valueResolver: TableValueResolver,
): TableCachedSortValue {
	if (sortKind === 'text' && rawValue.trim()) return rawValue.trim();
	return valueResolver.getSortValue(task, groupBy, sortKind, priorityRank);
}

function isListLikeTableGroupField(
	key: string,
	settings: TableQuerySettings,
): boolean {
	const field = getTableTaskField(key, settings);
	return field?.type === 'list' || field?.type === 'tags';
}

export function createTableGroupPathKey(groupKey: string, subgroupKey: string): string {
	return `${groupKey}\u0001${subgroupKey}`;
}

function compareTableGroups(left: TableQueryBucket, right: TableQueryBucket, direction: TableSortDirection): number {
	if (left.isNoValue || right.isNoValue) {
		if (left.isNoValue && right.isNoValue) return 0;
		return left.isNoValue ? 1 : -1;
	}
	const leftValue = left.sortValue ?? left.label;
	const rightValue = right.sortValue ?? right.label;
	if (typeof leftValue === 'number' && typeof rightValue === 'number') {
		const comparison = leftValue - rightValue;
		if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
	}
	const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
	if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
	const labelComparison = left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' });
	return direction === 'desc' ? -labelComparison : labelComparison;
}

function sortTableRows(
	tasks: readonly IndexedTask[],
	sortRules: readonly TableSortRule[],
	valueResolver: TableValueResolver,
	priorityRank: ReadonlyMap<string, number>,
	settings: TableQuerySettings | undefined,
): IndexedTask[] {
	const rows = [...tasks];
	if (sortRules.length === 0) return rows.sort(compareTableSourceOrder);
	return rows.sort((left, right) => {
		for (const rule of sortRules) {
			const comparison = compareTableSortRule(left, right, rule, priorityRank, valueResolver, settings);
			if (comparison !== 0) return comparison;
		}
		return compareTableSourceOrder(left, right);
	});
}

function buildTablePriorityRank(
	priorities: readonly { label: string; color?: string }[],
): Map<string, number> {
	return new Map(priorities.map((priority, index) => [priority.label.trim().toLocaleLowerCase(), index] as const));
}

function compareTableSortRule(
	left: IndexedTask,
	right: IndexedTask,
	rule: TableSortRule,
	priorityRank: ReadonlyMap<string, number>,
	valueResolver: TableValueResolver,
	settings: TableQuerySettings | undefined,
): number {
	const sortKind = getTableSortValueKind(rule.key, settings);
	const leftValue = valueResolver.getSortValue(left, rule.key, sortKind, priorityRank);
	const rightValue = valueResolver.getSortValue(right, rule.key, sortKind, priorityRank);
	const leftEmpty = leftValue === null;
	const rightEmpty = rightValue === null;
	if (leftEmpty || rightEmpty) {
		if (leftEmpty && rightEmpty) return 0;
		const emptyOrder = rule.empty === 'first' ? -1 : 1;
		return leftEmpty ? emptyOrder : -emptyOrder;
	}

	const leftIsNumber = typeof leftValue === 'number';
	const rightIsNumber = typeof rightValue === 'number';
	// Mixed types only occur in date columns (parsed timestamps vs unparseable text);
	// comparing epoch digits against text lexically is meaningless, so parsed dates
	// order chronologically before the text values.
	const comparison = leftIsNumber && rightIsNumber
		? leftValue - rightValue
		: leftIsNumber !== rightIsNumber
			? (leftIsNumber ? -1 : 1)
			: String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
	if (comparison === 0) return 0;
	const normalized = comparison > 0 ? 1 : -1;
	return rule.direction === 'desc' ? -normalized : normalized;
}

function getTableSortValueKind(key: string, settings: TableQuerySettings | undefined): TableSortValueKind {
	if (key === 'priority') return 'priority';
	if (settings) {
		const field = getTableTaskField(key, settings);
		if (field?.type === 'number') return 'numeric';
		if (field?.type === 'date' || field?.type === 'datetime') return 'date';
	}
	if (isNumericTableSortField(key)) return 'numeric';
	if (isDateLikeTableSortField(key)) return 'date';
	return 'text';
}

function isNumericTableSortField(key: string): boolean {
	return key === 'estimate'
		|| key === 'duration'
		|| key === 'totalEstimate'
		|| key === 'totalDuration'
		|| key === 'progress'
		|| key === CHECKBOX_PROGRESS_COLUMN_KEY
		|| key === 'sourceLine'
		|| key.endsWith('Count');
}

function isDateLikeTableSortField(key: string): boolean {
	return key.startsWith('date') || key.startsWith('datetime');
}
