import { parseLocalTimestamp } from '../../core/local-time';
import { normalizePriorityValue } from '../../core/priority-rank';
import type { ProjectSerialDisplay } from '../../core/project-serials';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import { formatTableTaskValueForDisplay } from './table-display';
import {
	createTableTaskLookup,
	formatCompactTableTaskSource,
	getTableTaskRawValue,
	type TableTaskLookup,
} from './table-value-adapter';
import { createTaskProgressLookup, type TaskProgressTrack, type TaskProgressTrackKind } from '../task-progress-tracks';
import { PROJECT_SERIAL_TABLE_FIELD_KEY, TABLE_WORKFLOW_PIPELINE_FIELD_KEY } from './table-field-catalog';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../../core/workflow-status-identity';
import {
	classifyTableFilePropertyCell,
	type TableFilePropertyCellValue,
	type TableFilePropertyField,
	type TableFilePropertyQueryContext,
	type TableFilePropertyValueState,
} from './table-file-property';

export const TABLE_NO_GROUP_VALUE_KEY = '__table_no_value__';
export const TABLE_UNSUPPORTED_GROUP_VALUE_KEY = '__table_unsupported_value__';

type TableValueCacheSettings = Pick<OperonSettings, 'keyMappings'> & Partial<Pick<OperonSettings, 'pipelines'>>;
export type TableSortValueKind = 'priority' | 'numeric' | 'date' | 'text';
export type TableCachedSortValue = string | number | null;

export interface TableCachedGroupValue {
	rawValue: string;
	isNoValue: boolean;
	isUnsupportedValue: boolean;
	valueKey: string;
	groupKey: string;
	label: string;
}

export interface TableValueCacheStats {
	rawHits: number;
	rawMisses: number;
	displayHits: number;
	displayMisses: number;
	sortHits: number;
	sortMisses: number;
	groupHits: number;
	groupMisses: number;
}

export interface TableValueResolverOptions {
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getFilePropertyValue?: (task: IndexedTask, key: string) => string | null;
	filePropertyContext?: TableFilePropertyQueryContext;
}

export interface TableValueResolver {
	readonly taskLookup: TableTaskLookup;
	readonly workflowStatusIdentityIndex: WorkflowStatusIdentityIndex;
	getFilePropertyField(key: string): TableFilePropertyField | null;
	getFilePropertyCell(task: IndexedTask, key: string): TableFilePropertyCellValue | null;
	getFilePropertyValueState(task: IndexedTask, key: string): TableFilePropertyValueState | null;
	getRawValue(task: IndexedTask, key: string): string;
	getDisplayValue(task: IndexedTask, key: string): string;
	getProgressTrack(task: IndexedTask, kind: TaskProgressTrackKind): TaskProgressTrack | null;
	getSortValue(
		task: IndexedTask,
		key: string,
		kind: TableSortValueKind,
		priorityRank: ReadonlyMap<string, number>,
	): TableCachedSortValue;
	getGroupValue(task: IndexedTask, groupBy: string): TableCachedGroupValue;
	getStats(): TableValueCacheStats;
}

export function createTableValueResolver(
	tasks: readonly IndexedTask[],
	settings?: TableValueCacheSettings,
	options: TableValueResolverOptions = {},
): TableValueResolver {
	const taskLookup = createTableTaskLookup(tasks);
	const progressLookup = createTaskProgressLookup(tasks);
	const pipelines = settings?.pipelines ?? [];
	const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const rawValues = new Map<string, string>();
	const displayValues = new Map<string, string>();
	const sortValues = new Map<string, TableCachedSortValue>();
	const groupValues = new Map<string, TableCachedGroupValue>();
	const filePropertyCells = new Map<string, TableFilePropertyCellValue>();
	const filePropertyStates = new Map<string, TableFilePropertyValueState>();
	const filePropertyFields = new Map((options.filePropertyContext?.fields ?? []).map(field => [field.key, field] as const));
	const projectSerialDisplays = new Map<string, ProjectSerialDisplay | null>();
	const stats: TableValueCacheStats = {
		rawHits: 0,
		rawMisses: 0,
		displayHits: 0,
		displayMisses: 0,
		sortHits: 0,
		sortMisses: 0,
		groupHits: 0,
		groupMisses: 0,
	};
	const resolver: TableValueResolver = {
		taskLookup,
		workflowStatusIdentityIndex,
		getFilePropertyField(key) {
			return filePropertyFields.get(key) ?? null;
		},
		getFilePropertyCell(task, key) {
			const field = filePropertyFields.get(key);
			if (!field || !options.filePropertyContext) return null;
			const cacheKey = buildTaskFieldCacheKey(task, key);
			const cached = filePropertyCells.get(cacheKey);
			if (cached) return cached;
			const cell = options.filePropertyContext.getCell(task, key);
			filePropertyCells.set(cacheKey, cell);
			return cell;
		},
		getFilePropertyValueState(task, key) {
			const field = filePropertyFields.get(key);
			if (!field) return null;
			const cacheKey = buildTaskFieldCacheKey(task, key);
			const cached = filePropertyStates.get(cacheKey);
			if (cached) return cached;
			const cell = resolver.getFilePropertyCell(task, key);
			if (!cell) return null;
			const state = classifyTableFilePropertyCell(field, cell);
			filePropertyStates.set(cacheKey, state);
			return state;
		},
		getRawValue(task, key) {
			const cacheKey = buildTaskFieldCacheKey(task, key);
			const cached = rawValues.get(cacheKey);
			if (cached !== undefined) {
				stats.rawHits++;
				return cached;
			}
			stats.rawMisses++;
			const filePropertyCell = resolver.getFilePropertyCell(task, key);
			const filePropertyValue = filePropertyCell?.normalizedValue
				?? options.getFilePropertyValue?.(task, key)
				?? null;
			const value = filePropertyValue !== null
				? filePropertyValue
				: key === PROJECT_SERIAL_TABLE_FIELD_KEY
					? resolveProjectSerialDisplay(task)?.label ?? ''
					: progressLookup.resolveRawValue(task, key) ?? getTableTaskRawValue(
						task,
						key,
						pipelines,
						workflowStatusIdentityIndex,
					);
			rawValues.set(cacheKey, value);
			return value;
		},
		getDisplayValue(task, key) {
			const cacheKey = buildTaskFieldCacheKey(task, key);
			const cached = displayValues.get(cacheKey);
			if (cached !== undefined) {
				stats.displayHits++;
				return cached;
			}
			stats.displayMisses++;
			const rawValue = resolver.getRawValue(task, key);
			const value = key === 'source'
				? formatCompactTableTaskSource(task)
				: settings
					? formatTableTaskValueForDisplay(key, rawValue, { settings, taskLookup })
					: rawValue;
			displayValues.set(cacheKey, value);
			return value;
		},
		getProgressTrack(task, kind) {
			return progressLookup.resolveTrack(task, kind);
		},
		getSortValue(task, key, kind, priorityRank) {
			const cacheKey = `${buildTaskFieldCacheKey(task, key)}\u0000${kind}`;
			const cached = sortValues.get(cacheKey);
			if (sortValues.has(cacheKey)) {
				stats.sortHits++;
				return cached ?? null;
			}
			stats.sortMisses++;
			const projectSerial = key === PROJECT_SERIAL_TABLE_FIELD_KEY
				? resolveProjectSerialDisplay(task)
				: null;
			const value = projectSerial && Number.isFinite(projectSerial.number)
				? projectSerial.number
				: resolveCachedSortValue(resolver.getRawValue(task, key), kind, priorityRank);
			sortValues.set(cacheKey, value);
			return value;
		},
		getGroupValue(task, groupBy) {
			const cacheKey = buildTaskFieldCacheKey(task, groupBy);
			const cached = groupValues.get(cacheKey);
			if (cached) {
				stats.groupHits++;
				return cached;
			}
			stats.groupMisses++;
			const filePropertyState = resolver.getFilePropertyValueState(task, groupBy);
			if (filePropertyState) {
				const groupValue = createFilePropertyGroupValue(groupBy, filePropertyState);
				groupValues.set(cacheKey, groupValue);
				return groupValue;
			}
			const projectSerial = groupBy === PROJECT_SERIAL_TABLE_FIELD_KEY
				? resolveProjectSerialDisplay(task)
				: null;
			const rawValue = projectSerial
				? projectSerial.scopePrefix.trim()
				: resolver.getRawValue(task, groupBy).trim();
			const isNoValue = rawValue.length === 0;
			const valueKey = isNoValue
				? TABLE_NO_GROUP_VALUE_KEY
				: groupBy === TABLE_WORKFLOW_PIPELINE_FIELD_KEY || groupBy === 'status'
					? rawValue
					: rawValue.toLocaleLowerCase();
			const groupValue: TableCachedGroupValue = {
				rawValue,
				isNoValue,
				isUnsupportedValue: false,
				valueKey,
				groupKey: `${groupBy}:${valueKey}`,
				label: isNoValue
					? ''
					: projectSerial
						? rawValue
						: resolver.getDisplayValue(task, groupBy) || rawValue,
			};
			groupValues.set(cacheKey, groupValue);
			return groupValue;
		},
		getStats() {
			return { ...stats };
		},
	};

	function resolveProjectSerialDisplay(task: IndexedTask): ProjectSerialDisplay | null {
		const cached = projectSerialDisplays.get(task.operonId);
		if (cached !== undefined) return cached;
		const display = options.getProjectSerialDisplay?.(task.operonId, task) ?? null;
		projectSerialDisplays.set(task.operonId, display);
		return display;
	}

	return resolver;
}

function createFilePropertyGroupValue(
	key: string,
	state: TableFilePropertyValueState,
): TableCachedGroupValue {
	if (state.kind === 'empty') {
		return {
			rawValue: '',
			isNoValue: true,
			isUnsupportedValue: false,
			valueKey: TABLE_NO_GROUP_VALUE_KEY,
			groupKey: `${key}:${TABLE_NO_GROUP_VALUE_KEY}`,
			label: '',
		};
	}
	if (state.kind === 'unsupported') {
		return {
			rawValue: '',
			isNoValue: false,
			isUnsupportedValue: true,
			valueKey: TABLE_UNSUPPORTED_GROUP_VALUE_KEY,
			groupKey: `${key}:${TABLE_UNSUPPORTED_GROUP_VALUE_KEY}`,
			label: '',
		};
	}
	const rawValue = formatRawFilePropertyScalar(state.value);
	const valueKey = rawValue.toLocaleLowerCase();
	return {
		rawValue,
		isNoValue: false,
		isUnsupportedValue: false,
		valueKey,
		groupKey: `${key}:${valueKey}`,
		label: rawValue,
	};
}

function formatRawFilePropertyScalar(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

export function formatTableValueCacheStats(stats: TableValueCacheStats): string {
	return [
		`raw:${stats.rawHits}/${stats.rawMisses}`,
		`display:${stats.displayHits}/${stats.displayMisses}`,
		`sort:${stats.sortHits}/${stats.sortMisses}`,
		`group:${stats.groupHits}/${stats.groupMisses}`,
	].join(',');
}

function buildTaskFieldCacheKey(task: IndexedTask, key: string): string {
	return `${task.operonId}\u0000${key}`;
}

function resolveCachedSortValue(
	rawValue: string,
	kind: TableSortValueKind,
	priorityRank: ReadonlyMap<string, number>,
): TableCachedSortValue {
	const trimmed = rawValue.trim();
	if (!trimmed) return null;
	if (kind === 'priority') {
		const value = normalizePriorityValue(trimmed);
		return priorityRank.get(value) ?? Number.MAX_SAFE_INTEGER;
	}
	if (kind === 'numeric') {
		const numericValue = Number(trimmed);
		return Number.isFinite(numericValue) ? numericValue : null;
	}
	if (kind === 'date') {
		return parseLocalTimestamp(trimmed) ?? trimmed;
	}
	return trimmed;
}
