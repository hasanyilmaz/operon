import { parseLocalTimestamp } from '../../core/local-time';
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

export const TABLE_NO_GROUP_VALUE_KEY = '__table_no_value__';

type TableValueCacheSettings = Pick<OperonSettings, 'keyMappings'>;
export type TableSortValueKind = 'priority' | 'numeric' | 'date' | 'text';
export type TableCachedSortValue = string | number | null;

export interface TableCachedGroupValue {
	rawValue: string;
	isNoValue: boolean;
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

export interface TableValueResolver {
	readonly taskLookup: TableTaskLookup;
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
): TableValueResolver {
	const taskLookup = createTableTaskLookup(tasks);
	const progressLookup = createTaskProgressLookup(tasks);
	const rawValues = new Map<string, string>();
	const displayValues = new Map<string, string>();
	const sortValues = new Map<string, TableCachedSortValue>();
	const groupValues = new Map<string, TableCachedGroupValue>();
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
		getRawValue(task, key) {
			const cacheKey = buildTaskFieldCacheKey(task, key);
			const cached = rawValues.get(cacheKey);
			if (cached !== undefined) {
				stats.rawHits++;
				return cached;
			}
			stats.rawMisses++;
			const value = progressLookup.resolveRawValue(task, key) ?? getTableTaskRawValue(task, key);
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
			const value = resolveCachedSortValue(resolver.getRawValue(task, key), kind, priorityRank);
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
			const rawValue = resolver.getRawValue(task, groupBy).trim();
			const isNoValue = rawValue.length === 0;
			const valueKey = isNoValue ? TABLE_NO_GROUP_VALUE_KEY : rawValue.toLocaleLowerCase();
			const groupValue: TableCachedGroupValue = {
				rawValue,
				isNoValue,
				valueKey,
				groupKey: `${groupBy}:${valueKey}`,
				label: isNoValue ? '' : resolver.getDisplayValue(task, groupBy) || rawValue,
			};
			groupValues.set(cacheKey, groupValue);
			return groupValue;
		},
		getStats() {
			return { ...stats };
		},
	};
	return resolver;
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
		const value = trimmed.toLocaleLowerCase();
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
