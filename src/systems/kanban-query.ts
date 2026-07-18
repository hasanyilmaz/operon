import { parseListValue } from '../core/parser';
import { filterTasksForCalendar } from './calendar-filter-materialization';
import { buildTaskSearchMatcher, matchesTaskSearchQueryText } from './task-search';
import { IndexedTask } from '../types/fields';
import { composeStatusValue, Pipeline, StatusDefinition } from '../types/pipeline';
import { PinnedCache } from '../storage/pinned-cache';
import { KanbanPreset, KanbanSortField, KanbanSortRule, KanbanSwimlaneBy } from '../types/kanban';
import { FilterSet, KeyMapping, ProjectSerialScope } from '../types/settings';
import { t } from '../core/i18n';
import { buildPriorityRankMap, normalizePriorityValue } from '../core/priority-rank';
import { getManagedCustomFieldOptionMapping, normalizeManagedFieldValue } from '../core/managed-task-fields';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredStatusIdentity,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import type { FilterEvaluationOptions } from '../core/filter-evaluator';

export const KANBAN_NO_VALUE_KEY = '__kanban_no_value__';
export function getKanbanNoValueLabel(): string {
	return t('buttons', 'kanbanNoValue');
}

export interface KanbanColumn {
	statusId: string;
	statusLabel: string;
	statusValue: string;
	isFinished: boolean;
	color: string | null;
	count: number;
}

export interface KanbanLane {
	key: string;
	label: string;
	value: string;
	isNoValue: boolean;
	count: number;
	color: string | null;
}

export interface KanbanBoardData {
	preset: KanbanPreset;
	pipeline: Pipeline | null;
	filterSet: FilterSet | null;
	scopedTasks: IndexedTask[];
	relevantTasks: IndexedTask[];
	columns: KanbanColumn[];
	lanes: KanbanLane[];
	cellCountMap: Map<string, number>;
	cellMap: Map<string, IndexedTask[]>;
}

export function queryKanbanBoard(options: {
	preset: KanbanPreset;
	pipeline: Pipeline | null;
	pipelines?: readonly Pipeline[];
	filterSet: FilterSet | null;
	tasks: IndexedTask[];
	priorities: { label: string; color?: string }[];
	searchQuery?: string | null;
	taskIdFilter?: Iterable<string>;
	skippedStatusIds?: Iterable<string>;
	skippedLaneKeys?: Iterable<string>;
	pinnedCache?: PinnedCache | null;
	manualOrder?: Record<string, string[]>;
	keyMappings?: readonly KeyMapping[];
	projectSerialScopes?: readonly ProjectSerialScope[];
	filterEvaluationOptions?: FilterEvaluationOptions;
}): KanbanBoardData {
	const { preset, pipeline, filterSet, priorities, pinnedCache } = options;
	const keyMappings = options.keyMappings ?? [];
	const normalizedSearchQuery = (options.searchQuery ?? '').trim().toLocaleLowerCase();
	const allowedTaskIds = options.taskIdFilter ? new Set(options.taskIdFilter) : null;
	const searchMatcher = normalizedSearchQuery ? buildTaskSearchMatcher(options.tasks, keyMappings) : null;
	const scopedTasks = filterTasksForCalendar(filterSet, options.tasks, priorities, pinnedCache ?? null, {
		...options.filterEvaluationOptions,
		projectSerialScopes: options.projectSerialScopes,
		projectSerialScopeTasks: options.tasks,
	});
	const identityIndex = buildWorkflowStatusIdentityIndex(
		options.pipelines ?? (pipeline ? [pipeline] : []),
	);
	const relevantTasks = pipeline
		? scopedTasks
			.filter(task => isTaskInPipelineWithIndex(task, pipeline, identityIndex))
			.filter(task => !allowedTaskIds || allowedTaskIds.has(task.operonId))
			.filter(task => !searchMatcher || searchMatcher(task, normalizedSearchQuery))
		: [];
	const lanes = buildKanbanLanes(relevantTasks, preset.swimlaneBy, priorities, keyMappings);
	const skippedStatusIds = new Set(options.skippedStatusIds ?? []);
	const skippedLaneKeys = new Set(options.skippedLaneKeys ?? []);
	const statusTaskCounts = new Map<string, number>();
	const cellCountMap = new Map<string, number>();
	const cellMap = new Map<string, IndexedTask[]>();
	const taskComparator = buildKanbanTaskComparator({ preset, priorities, keyMappings });

	for (const task of relevantTasks) {
		const status = pipeline ? resolveTaskStatusDefinitionWithIndex(task, pipeline, identityIndex) : null;
		if (!status) continue;
		const statusId = status.id;
		statusTaskCounts.set(statusId, (statusTaskCounts.get(statusId) ?? 0) + 1);
		for (const laneKey of extractLaneKeys(task, preset.swimlaneBy, keyMappings, priorities)) {
			const cellKey = buildKanbanCellKey(statusId, laneKey);
			cellCountMap.set(cellKey, (cellCountMap.get(cellKey) ?? 0) + 1);
			if (skippedStatusIds.has(statusId)) continue;
			if (skippedLaneKeys.has(laneKey)) continue;
			if (!cellMap.has(cellKey)) cellMap.set(cellKey, []);
			cellMap.get(cellKey)!.push(task);
		}
	}

	const columns = pipeline
		? pipeline.statuses
			.map(status => ({
				statusId: status.id,
				statusLabel: status.label,
				statusValue: composeStatusValue(pipeline.name, status.label),
				isFinished: status.isFinished,
				color: status.color?.trim() || null,
				count: statusTaskCounts.get(status.id) ?? 0,
			}))
		: [];

	for (const [cellKey, tasks] of cellMap.entries()) {
		if (preset.sortMode === 'manual') {
			applyManualKanbanTaskOrder(tasks, options.manualOrder?.[cellKey] ?? []);
		} else {
			tasks.sort(taskComparator);
		}
	}

	return {
		preset,
		pipeline,
		filterSet,
		scopedTasks,
		relevantTasks,
		columns,
		lanes,
		cellCountMap,
		cellMap,
	};
}

export function applyManualKanbanTaskOrder(
	tasks: IndexedTask[],
	taskIds: string[],
): void {
	const manualRank = new Map<string, number>();
	for (const taskId of taskIds) {
		if (!manualRank.has(taskId)) {
			manualRank.set(taskId, manualRank.size);
		}
	}
	const originalRank = new Map(tasks.map((task, index) => [task.operonId, index] as const));

	tasks.sort((left, right) => {
		const leftRank = manualRank.get(left.operonId);
		const rightRank = manualRank.get(right.operonId);
		if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
		if (leftRank !== undefined) return -1;
		if (rightRank !== undefined) return 1;
		return (originalRank.get(left.operonId) ?? 0) - (originalRank.get(right.operonId) ?? 0);
	});
}

export function buildKanbanTaskComparator(options: {
	preset: KanbanPreset;
	priorities: { label: string; color?: string }[];
	keyMappings?: readonly KeyMapping[];
}): (left: IndexedTask, right: IndexedTask) => number {
	const priorityRank = buildPriorityRankMap(options.priorities);
	const keyMappings = options.keyMappings ?? [];
	const rules = options.preset.sortRules.length > 0
		? options.preset.sortRules
		: [{ field: 'alphabetical', direction: 'asc', empty: 'last' } as KanbanSortRule];

	return (left: IndexedTask, right: IndexedTask): number => {
		for (const rule of rules) {
			const comparison = compareByKanbanSortRule(left, right, rule, priorityRank, keyMappings);
			if (comparison !== 0) return comparison;
		}
		return left.description.localeCompare(right.description, undefined, { sensitivity: 'base' })
			|| left.operonId.localeCompare(right.operonId, undefined, { sensitivity: 'base' });
	};
}

export function matchesKanbanSearchQueryText(text: string, normalizedQuery: string): boolean {
	return matchesTaskSearchQueryText(text, normalizedQuery);
}

function compareByKanbanSortRule(
	left: IndexedTask,
	right: IndexedTask,
	rule: KanbanSortRule,
	priorityRank: Map<string, number>,
	keyMappings: readonly KeyMapping[],
): number {
	const leftValue = resolveKanbanSortValue(left, rule.field, priorityRank, keyMappings);
	const rightValue = resolveKanbanSortValue(right, rule.field, priorityRank, keyMappings);
	const leftEmpty = leftValue === null;
	const rightEmpty = rightValue === null;
	if (leftEmpty || rightEmpty) {
		if (leftEmpty && rightEmpty) return 0;
		const emptyOrder = rule.empty === 'first' ? -1 : 1;
		return leftEmpty ? emptyOrder : -emptyOrder;
	}
	let comparison = 0;
	if (typeof leftValue === 'number' && typeof rightValue === 'number') {
		comparison = leftValue - rightValue;
	} else {
		comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' });
	}
	if (comparison === 0) return 0;
	return rule.direction === 'desc' ? (comparison > 0 ? -1 : 1) : (comparison > 0 ? 1 : -1);
}

function resolveKanbanSortValue(
	task: IndexedTask,
	field: KanbanSortField,
	priorityRank: Map<string, number>,
	keyMappings: readonly KeyMapping[],
): string | number | null {
	if (field === 'alphabetical') {
		const value = task.description.trim().toLocaleLowerCase();
		return value || null;
	}
	if (field === 'priority') {
		const value = normalizePriorityValue(task.fieldValues['priority'] ?? '');
		return value ? (priorityRank.get(value) ?? Number.MAX_SAFE_INTEGER) : null;
	}
	if (field === 'estimate' || field === 'progress') {
		return parseNumericSortValue(task.fieldValues[field]);
	}
	if (field === 'duration' || field === 'totalDuration' || field === 'totalEstimate') {
		return parseNumericSortValue(task.fieldValues[field]);
	}
	if (field === 'datetimeModified') {
		return parseDateSortValue(task.datetimeModified || task.fieldValues['datetimeModified'] || '');
	}
	const customMapping = getManagedCustomFieldOptionMapping(field, keyMappings);
	if (customMapping) {
		return resolveCustomKanbanSortValue(task, customMapping);
	}
	if (!isBuiltInKanbanDateSortField(field)) return null;
	return parseDateSortValue(task.fieldValues[field] ?? '');
}

function resolveCustomKanbanSortValue(task: IndexedTask, mapping: KeyMapping): string | number | null {
	const value = normalizeManagedFieldValue((task.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
	if (!value) return null;
	if (mapping.type === 'number') return parseNumericSortValue(value);
	if (mapping.type === 'date') return parseDateSortValue(value);
	if (mapping.type === 'datetime') return parseDateTimeSortValue(value);
	if (mapping.type === 'list') {
		const listValue = parseListValue(value).join('; ').trim();
		return listValue || null;
	}
	return value.toLocaleLowerCase();
}

function isBuiltInKanbanDateSortField(field: KanbanSortField): boolean {
	return field === 'dateDue'
		|| field === 'dateScheduled'
		|| field === 'dateStarted'
		|| field === 'dateCompleted'
		|| field === 'dateCancelled'
		|| field === 'datetimeCreated';
}

function parseNumericSortValue(raw: string | undefined): number | null {
	const value = (raw ?? '').trim();
	if (!value) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseDateSortValue(raw: string | undefined): number | null {
	const value = (raw ?? '').trim();
	if (!value) return null;
	const dateOnly = extractDateOnlyValue(value);
	const parsed = Date.parse(dateOnly);
	return Number.isFinite(parsed) ? parsed : null;
}

function parseDateTimeSortValue(raw: string | undefined): number | null {
	const value = (raw ?? '').trim();
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function extractDateOnlyValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/u);
	if (match) return match[1];
	if (trimmed.includes('T')) return trimmed.split('T')[0];
	if (trimmed.includes(' ')) return trimmed.split(' ')[0];
	return trimmed;
}

export function buildKanbanCellKey(statusId: string, laneKey: string): string {
	return `${statusId}::${laneKey}`;
}

export function isTaskInPipeline(
	task: IndexedTask,
	pipeline: Pipeline,
	pipelines: readonly Pipeline[] = [pipeline],
): boolean {
	return isTaskInPipelineWithIndex(
		task,
		pipeline,
		buildWorkflowStatusIdentityIndex(pipelines),
	);
}

export function resolveTaskStatusDefinition(
	task: IndexedTask,
	pipeline: Pipeline,
	pipelines: readonly Pipeline[] = [pipeline],
): StatusDefinition | null {
	return resolveTaskStatusDefinitionWithIndex(
		task,
		pipeline,
		buildWorkflowStatusIdentityIndex(pipelines),
	);
}

export function isTaskInPipelineWithIndex(
	task: IndexedTask,
	pipeline: Pipeline,
	identityIndex: WorkflowStatusIdentityIndex,
): boolean {
	return resolveTaskStatusDefinitionWithIndex(task, pipeline, identityIndex) !== null;
}

function resolveTaskStatusDefinitionWithIndex(
	task: IndexedTask,
	pipeline: Pipeline,
	identityIndex: WorkflowStatusIdentityIndex,
): StatusDefinition | null {
	const identity = resolveConfiguredStatusIdentity(task.fieldValues['status'], identityIndex);
	if (identity.kind !== 'configured') return null;
	const uniqueStableIdMatch = !!pipeline.id
		&& identity.pipeline.id === pipeline.id
		&& identityIndex.pipelineCountById.get(pipeline.id) === 1;
	if (identity.pipeline !== pipeline && !uniqueStableIdMatch) return null;
	return identity.status;
}

export function extractLaneKeys(
	task: IndexedTask,
	swimlaneBy: KanbanSwimlaneBy | null,
	keyMappings: readonly KeyMapping[] = [],
	priorities: readonly { label: string }[] = [],
): string[] {
	if (!swimlaneBy) return [KANBAN_NO_VALUE_KEY];

	if (swimlaneBy === 'tags') {
		return task.tags.length > 0
			? Array.from(new Set(task.tags.map(value => value.trim()).filter(Boolean)))
			: [KANBAN_NO_VALUE_KEY];
	}

	if (swimlaneBy === 'contexts' || swimlaneBy === 'assignees') {
		const values = parseListValue(task.fieldValues[swimlaneBy] ?? '');
		return values.length > 0 ? Array.from(new Set(values)) : [KANBAN_NO_VALUE_KEY];
	}

	const customMapping = getManagedCustomFieldOptionMapping(swimlaneBy, keyMappings);
	if (customMapping) {
		const rawValue = normalizeManagedFieldValue((task.fieldValues as Record<string, unknown>)[customMapping.canonicalKey]);
		if (customMapping.type === 'list') {
			const values = parseListValue(rawValue);
			return values.length > 0 ? Array.from(new Set(values)) : [KANBAN_NO_VALUE_KEY];
		}
		const value = rawValue;
		return value ? [value] : [KANBAN_NO_VALUE_KEY];
	}

	if (!isBuiltInKanbanScalarSwimlane(swimlaneBy)) return [KANBAN_NO_VALUE_KEY];

	const rawValue = (task.fieldValues[swimlaneBy] ?? '').trim();
	if (!rawValue) return [KANBAN_NO_VALUE_KEY];
	// Priority matches leniently but keys on the CANONICAL label, so a task written
	// `priority:: s` buckets into the configured `S` lane while lane keys and drop
	// writeback stay the exact label (see priority-rank / Policy A). Dates stay verbatim.
	if (swimlaneBy === 'priority') {
		return [resolveCanonicalPriorityLaneKey(rawValue, priorities)];
	}
	return [rawValue];
}

function resolveCanonicalPriorityLaneKey(
	rawValue: string,
	priorities: readonly { label: string }[],
): string {
	const normalized = normalizePriorityValue(rawValue);
	const match = priorities.find(priority => normalizePriorityValue(priority.label) === normalized);
	return match ? match.label : rawValue;
}

function isBuiltInKanbanScalarSwimlane(swimlaneBy: KanbanSwimlaneBy): boolean {
	return swimlaneBy === 'priority' || swimlaneBy === 'dateDue' || swimlaneBy === 'dateScheduled';
}

function buildKanbanLanes(
	tasks: IndexedTask[],
	swimlaneBy: KanbanSwimlaneBy | null,
	priorities: { label: string; color?: string }[],
	keyMappings: readonly KeyMapping[],
): KanbanLane[] {
	if (!swimlaneBy) {
		return [{
			key: KANBAN_NO_VALUE_KEY,
			label: getKanbanNoValueLabel(),
			value: '',
			isNoValue: true,
			count: tasks.length,
			color: null,
		}];
	}

	const laneCounts = new Map<string, number>();
	for (const task of tasks) {
		for (const key of extractLaneKeys(task, swimlaneBy, keyMappings, priorities)) {
			laneCounts.set(key, (laneCounts.get(key) ?? 0) + 1);
		}
	}

	const lanes: KanbanLane[] = [];
	if (swimlaneBy === 'priority') {
		for (const priority of priorities) {
			const count = laneCounts.get(priority.label) ?? 0;
			lanes.push({
				key: priority.label,
				label: priority.label,
				value: priority.label,
				isNoValue: false,
				count,
				color: priority.color?.trim() || null,
			});
		}
	} else {
		const customMapping = getManagedCustomFieldOptionMapping(swimlaneBy, keyMappings);
		const compareLaneValues = customMapping?.type === 'number'
			? compareNumericKanbanLaneValues
			: compareTextKanbanLaneValues;
		const values = Array.from(laneCounts.keys())
			.filter(value => value !== KANBAN_NO_VALUE_KEY)
			.sort(compareLaneValues);
		for (const value of values) {
			lanes.push({
				key: value,
				label: value,
				value,
				isNoValue: false,
				count: laneCounts.get(value) ?? 0,
				color: null,
			});
		}
	}

	if (laneCounts.has(KANBAN_NO_VALUE_KEY)) {
		lanes.push({
			key: KANBAN_NO_VALUE_KEY,
			label: getKanbanNoValueLabel(),
			value: '',
			isNoValue: true,
			count: laneCounts.get(KANBAN_NO_VALUE_KEY) ?? 0,
			color: null,
		});
	}

	return lanes;
}

function compareNumericKanbanLaneValues(left: string, right: string): number {
	const leftValue = parseNumericSortValue(left);
	const rightValue = parseNumericSortValue(right);
	if (leftValue !== null && rightValue !== null) {
		const comparison = leftValue - rightValue;
		if (comparison !== 0) return comparison;
	}
	if (leftValue === null || rightValue === null) {
		if (leftValue === null && rightValue !== null) return 1;
		if (leftValue !== null && rightValue === null) return -1;
	}
	const textComparison = compareTextKanbanLaneValues(left, right);
	if (textComparison !== 0) return textComparison;
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareTextKanbanLaneValues(left: string, right: string): number {
	return left.localeCompare(right, undefined, { sensitivity: 'base' });
}
