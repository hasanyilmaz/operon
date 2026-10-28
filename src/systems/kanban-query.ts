import { kanbanListIsTyped, kanbanListLaneKeys } from './kanban-list-values';
import type { InlinePropertyDefinitions } from '../core/inline-property-definitions';
import { getTimeScopedFieldValues } from '../core/time-scope-values';
import { parseListValue } from '../core/parser';
import { matchesTaskSearchQueryText } from './task-search';
import { IndexedTask } from '../types/fields';
import { Pipeline, StatusDefinition } from '../types/pipeline';
import { KanbanEffectiveSorting, KanbanPreset, KanbanSortField, KanbanSortRule, KanbanSwimlaneBy } from '../types/kanban';
import { FilterSet, KeyMapping } from '../types/settings';
import { t } from '../core/i18n';
import { buildPriorityRankMap, normalizePriorityValue } from '../core/priority-rank';
import { getManagedCustomFieldOptionMapping, normalizeManagedFieldValue } from '../core/managed-task-fields';
import { parseLocalTimestamp } from '../core/local-time';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredStatusIdentity,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import type { ProjectSerialDisplay } from '../core/project-serials';

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
 inlinePropertyDefinitions?: InlinePropertyDefinitions;
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
	sorting?: KanbanEffectiveSorting;
	priorities: { label: string; color?: string }[];
	keyMappings?: readonly KeyMapping[];
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
}): (left: IndexedTask, right: IndexedTask) => number {
	const priorityRank = buildPriorityRankMap(options.priorities);
	const keyMappings = options.keyMappings ?? [];
	const configuredRules = options.sorting?.sortRules ?? options.preset.sortRules;
	const rules = configuredRules.length > 0
		? configuredRules
		: [{ field: 'alphabetical', direction: 'asc', empty: 'last' } as KanbanSortRule];

	return (left: IndexedTask, right: IndexedTask): number => {
		for (const rule of rules) {
			const comparison = compareByKanbanSortRule(
				left,
				right,
				rule,
				priorityRank,
				keyMappings,
				options.getProjectSerialDisplay,
			);
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
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null,
): number {
	const leftValue = resolveKanbanSortValue(left, rule.field, priorityRank, keyMappings, getProjectSerialDisplay);
	const rightValue = resolveKanbanSortValue(right, rule.field, priorityRank, keyMappings, getProjectSerialDisplay);
	const leftEmpty = leftValue === null;
	const rightEmpty = rightValue === null;
	if (leftEmpty || rightEmpty) {
		if (leftEmpty && rightEmpty) return 0;
		const emptyOrder = rule.empty === 'first' ? -1 : 1;
		return leftEmpty ? emptyOrder : -emptyOrder;
	}
	let comparison = 0;
	if (isKanbanProjectSerialSortValue(leftValue) && isKanbanProjectSerialSortValue(rightValue)) {
		comparison = leftValue.prefix.localeCompare(rightValue.prefix, undefined, { sensitivity: 'base' })
			|| leftValue.number - rightValue.number;
	} else if (typeof leftValue === 'number' && typeof rightValue === 'number') {
		comparison = leftValue - rightValue;
	} else if (typeof leftValue === 'string' && typeof rightValue === 'string') {
		comparison = leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' });
	}
	if (comparison === 0) return 0;
	return rule.direction === 'desc' ? (comparison > 0 ? -1 : 1) : (comparison > 0 ? 1 : -1);
}

function resolveKanbanSortValue(
	task: IndexedTask,
	field: KanbanSortField,
	priorityRank: Map<string, number>,
	keyMappings: readonly KeyMapping[],
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null,
): KanbanSortValue {
	if (field === 'alphabetical') {
		const value = task.description.trim().toLocaleLowerCase();
		return value || null;
	}
	if (field === 'priority') {
		const value = normalizePriorityValue(task.fieldValues['priority'] ?? '');
		return value ? (priorityRank.get(value) ?? Number.MAX_SAFE_INTEGER) : null;
	}
	if (field === 'estimate' || field === 'progress') {
		return parseNumericSortValue(getTimeScopedFieldValues(task.fieldValues)[field]);
	}
	if (field === 'duration' || field === 'totalDuration' || field === 'totalEstimate') {
		return parseNumericSortValue(getTimeScopedFieldValues(task.fieldValues)[field]);
	}
	if (field === 'datetimeModified') {
		return parseDateTimeSortValue(task.datetimeModified || task.fieldValues['datetimeModified'] || '');
	}
	if (field === 'datetimeCreated') {
		return parseDateTimeSortValue(task.fieldValues['datetimeCreated'] || '');
	}
	if (field === 'projectSerial') {
		const display = getProjectSerialDisplay?.(task.operonId, task) ?? null;
		if (!display) return null;
		const prefix = display.scopePrefix.trim();
		return prefix && Number.isFinite(display.number) && display.number > 0
			? { kind: 'projectSerial', prefix, number: Math.floor(display.number) }
			: null;
	}
	const customMapping = getManagedCustomFieldOptionMapping(field, keyMappings);
	if (customMapping) {
		return resolveCustomKanbanSortValue(task, customMapping);
	}
	if (!isBuiltInKanbanDateSortField(field)) return null;
	return parseDateSortValue(getTimeScopedFieldValues(task.fieldValues)[field] ?? '');
}

interface KanbanProjectSerialSortValue {
	kind: 'projectSerial';
	prefix: string;
	number: number;
}

type KanbanSortValue = string | number | KanbanProjectSerialSortValue | null;

function isKanbanProjectSerialSortValue(value: KanbanSortValue): value is KanbanProjectSerialSortValue {
	return typeof value === 'object' && value?.kind === 'projectSerial';
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
		|| field === 'dateCancelled';
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
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/u.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hours = Number(match[4] ?? 0);
	const minutes = Number(match[5] ?? 0);
	const seconds = Number(match[6] ?? 0);
	const fraction = match[7] ?? '';
	const timezone = match[8] ?? '';
	const timezoneMatch = /^([+-])(\d{2}):(\d{2})$/u.exec(timezone);
	const daysInMonth = new Date(year, month, 0).getDate();
	if (
		month < 1
		|| month > 12
		|| day < 1
		|| day > daysInMonth
		|| hours > 23
		|| minutes > 59
		|| seconds > 59
		|| (fraction && match[6] === undefined)
		|| (timezone && match[4] === undefined)
		|| (timezoneMatch && (Number(timezoneMatch[2]) > 23 || Number(timezoneMatch[3]) > 59))
	) return null;
	return parseLocalTimestamp(value);
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
	return statusId.startsWith('[') ? JSON.stringify([statusId, laneKey]) : `${statusId}::${laneKey}`;
}

export function parseKanbanCellKey(key: string): [string, string] | null {
	if (key.startsWith('[')) {
		try { const value: unknown = JSON.parse(key); return Array.isArray(value) && value.length === 2 && value.every(part => typeof part === 'string') ? value as [string, string] : null; }
		catch { return null; }
	}
	const separator = key.indexOf('::');
	return separator < 0 ? null : [key.slice(0, separator), key.slice(separator + 2)];
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
 inlinePropertyDefinitions?: InlinePropertyDefinitions,
): string[] {
	if (!swimlaneBy) return [KANBAN_NO_VALUE_KEY];

	if (swimlaneBy === 'tags') {
		return task.tags.length > 0
			? Array.from(new Set(task.tags.map(value => value.trim()).filter(Boolean)))
			: [KANBAN_NO_VALUE_KEY];
	}

	if (swimlaneBy === 'contexts' || swimlaneBy === 'assignees') {
		const values = parseListValue(getTimeScopedFieldValues(task.fieldValues)[swimlaneBy] ?? '');
		return values.length > 0 ? Array.from(new Set(values)) : [KANBAN_NO_VALUE_KEY];
	}

	const customMapping = getManagedCustomFieldOptionMapping(swimlaneBy, keyMappings);
	if (customMapping) {
		const rawValue = normalizeManagedFieldValue((task.fieldValues as Record<string, unknown>)[customMapping.canonicalKey]);
		if (customMapping.type === 'list') {
			let values: string[];
   try { values = kanbanListLaneKeys(rawValue, kanbanListIsTyped(customMapping, keyMappings, inlinePropertyDefinitions)); } catch { return []; }
			return values.length > 0 ? Array.from(new Set(values)) : [KANBAN_NO_VALUE_KEY];
		}
		const value = rawValue;
		return value ? [value] : [KANBAN_NO_VALUE_KEY];
	}

	if (!isBuiltInKanbanScalarSwimlane(swimlaneBy)) return [KANBAN_NO_VALUE_KEY];

	const rawValue = (getTimeScopedFieldValues(task.fieldValues)[swimlaneBy] ?? '').trim();
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
