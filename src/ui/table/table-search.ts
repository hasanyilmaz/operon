import { tokenizeTaskSearchText } from '../../systems/task-search';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn, TablePreset, TableSortRule } from '../../types/table';
import { formatTableTaskValueForDisplay } from './table-display';
import {
	formatCompactTableTaskSource,
	formatTableTaskSource,
} from './table-value-adapter';
import { createTableValueResolver, type TableValueResolverOptions } from './table-value-cache';
import {
	isTableFilePropertyColumnKey,
	type TableFilePropertyCellValue,
} from './table-file-property';

type TableSearchSettings = Pick<OperonSettings, 'keyMappings'>;
type TableTaskSearchMatcher = (task: IndexedTask, normalizedQuery: string) => boolean;

export interface TableFilePropertySearchContext {
	getCell(task: IndexedTask, columnKey: string): TableFilePropertyCellValue;
}

export interface TableTaskSearchMatcherCache {
	getMatcher(input: {
		tasks: readonly IndexedTask[];
		settings: TableSearchSettings;
		generation: number | string;
		columns: readonly TableColumn[];
		valueResolverOptions?: TableValueResolverOptions;
		valueResolverSignature?: string;
		filePropertyContext?: TableFilePropertySearchContext;
	}): TableTaskSearchMatcher;
	prewarm(input: {
		tasks: readonly IndexedTask[];
		settings: TableSearchSettings;
		generation: number | string;
		columns: readonly TableColumn[];
		valueResolverOptions?: TableValueResolverOptions;
		valueResolverSignature?: string;
		filePropertyContext?: TableFilePropertySearchContext;
	}, options: {
		startIndex: number;
		timeBudgetMs: number;
		maxTasks: number;
		tasksToWarm?: readonly IndexedTask[];
	}): TableTaskSearchPrewarmResult;
	clear(): void;
}

export interface TableTaskSearchPrewarmResult {
	nextIndex: number;
	warmed: number;
	done: boolean;
}

interface TableTaskSearchMatcherBundle {
	matcher: TableTaskSearchMatcher;
	prewarmTask: (task: IndexedTask) => void;
}

export const TABLE_SEARCH_PREWARM_DELAY_MS = 3000;
export const TABLE_SEARCH_PREWARM_CHUNK_DELAY_MS = 16;
export const TABLE_SEARCH_PREWARM_TIME_BUDGET_MS = 8;
export const TABLE_SEARCH_PREWARM_MAX_TASKS_PER_CHUNK = 120;
export const TABLE_SEARCH_DEBOUNCE_MS = 150;

export function createTableTaskSearchMatcherCache(): TableTaskSearchMatcherCache {
	let cachedSignature = '';
	let cachedBundle: TableTaskSearchMatcherBundle | null = null;
	const getBundle = (input: {
		tasks: readonly IndexedTask[];
		settings: TableSearchSettings;
		generation: number | string;
		columns: readonly TableColumn[];
		valueResolverOptions?: TableValueResolverOptions;
		valueResolverSignature?: string;
		filePropertyContext?: TableFilePropertySearchContext;
	}): TableTaskSearchMatcherBundle => {
		const signature = buildTableTaskSearchMatcherSignature(input.tasks, input.settings, input.generation, input.columns, input.valueResolverSignature);
		if (cachedBundle && cachedSignature === signature) return cachedBundle;
		cachedSignature = signature;
		cachedBundle = buildTableTaskSearchMatcherBundle(
			input.tasks,
			input.settings,
			input.columns,
			input.valueResolverOptions,
			input.filePropertyContext,
		);
		return cachedBundle;
	};
	return {
		getMatcher(input) {
			return getBundle(input).matcher;
		},
		prewarm(input, options) {
			const bundle = getBundle(input);
			const tasksToWarm = options.tasksToWarm ?? input.tasks;
			const startedAt = Date.now();
			let index = Math.max(0, options.startIndex);
			let warmed = 0;
			while (index < tasksToWarm.length && warmed < options.maxTasks) {
				const task = tasksToWarm[index];
				if (!task) break;
				bundle.prewarmTask(task);
				index++;
				warmed++;
				if (Date.now() - startedAt >= options.timeBudgetMs) break;
			}
			return {
				nextIndex: index,
				warmed,
				done: index >= tasksToWarm.length,
			};
		},
		clear() {
			cachedSignature = '';
			cachedBundle = null;
		},
	};
}

export function buildTableTaskSearchMatcher(
	tasks: readonly IndexedTask[],
	settings: TableSearchSettings,
	columns: readonly TableColumn[],
	valueResolverOptions?: TableValueResolverOptions,
	filePropertyContext?: TableFilePropertySearchContext,
): TableTaskSearchMatcher {
	return buildTableTaskSearchMatcherBundle(
		tasks,
		settings,
		columns,
		valueResolverOptions,
		filePropertyContext,
	).matcher;
}

function buildTableTaskSearchMatcherBundle(
	tasks: readonly IndexedTask[],
	settings: TableSearchSettings,
	columns: readonly TableColumn[],
	valueResolverOptions?: TableValueResolverOptions,
	filePropertyContext?: TableFilePropertySearchContext,
): TableTaskSearchMatcherBundle {
	const allTasks = [...tasks];
	const valueResolver = createTableValueResolver(allTasks, settings, valueResolverOptions);
	const visibleColumnKeys = columns.filter(column => column.hidden !== true).map(column => column.key);
	const documentCache = new Map<string, { text: string; tokens: string[] }>();
	let cachedQuery = '';
	let cachedQueryTerms: string[] = [];

	const buildSearchDocument = (task: IndexedTask): { text: string; tokens: string[] } => {
		const cached = documentCache.get(task.operonId);
		if (cached !== undefined) return cached;
		const values = new Set<string>();
		const addValue = (value: string | null | undefined): void => {
			const normalized = (value ?? '').trim();
			if (normalized) values.add(normalized.toLocaleLowerCase());
		};

		for (const key of visibleColumnKeys) {
			if (isTableFilePropertyColumnKey(key)) {
				const cell = filePropertyContext?.getCell(task, key);
				if (cell) {
					for (const value of getTableFilePropertySearchValues(cell)) addValue(value);
				}
				continue;
			}
			const rawValue = valueResolver.getRawValue(task, key);
			addValue(rawValue);
			if (key === 'source') {
				addValue(formatCompactTableTaskSource(task));
				addValue(formatTableTaskSource(task));
				continue;
			}
			addValue(formatTableTaskValueForDisplay(key, rawValue, { settings, taskLookup: valueResolver.taskLookup }));
		}

		const text = Array.from(values).join('\n');
		const document = {
			text,
			tokens: tokenizeTaskSearchText(text),
		};
		documentCache.set(task.operonId, document);
		return document;
	};

	return {
		matcher(task: IndexedTask, normalizedQuery: string): boolean {
			if (!normalizedQuery.trim()) return true;
			if (cachedQuery !== normalizedQuery) {
				cachedQuery = normalizedQuery;
				cachedQueryTerms = tokenizeTaskSearchText(normalizedQuery);
			}
			if (cachedQueryTerms.length === 0) return true;
			return cachedQueryTerms.every(term => matchesTableSearchTerm(buildSearchDocument(task).tokens, term));
		},
		prewarmTask(task: IndexedTask): void {
			buildSearchDocument(task);
		},
	};
}

export function getTableFilePropertySearchValues(
	cell: Pick<TableFilePropertyCellValue, 'present' | 'rawValue'>,
): readonly string[] {
	if (!cell.present) return [];
	const values: string[] = [];
	const addScalar = (value: unknown): void => {
		if (typeof value === 'string') {
			const normalized = value.trim();
			if (normalized) values.push(normalized);
			return;
		}
		if (typeof value === 'number') {
			if (Number.isFinite(value)) values.push(String(value));
			return;
		}
		if (typeof value === 'boolean') values.push(String(value));
	};
	if (Array.isArray(cell.rawValue)) {
		for (const item of cell.rawValue) addScalar(item);
	} else {
		addScalar(cell.rawValue);
	}
	return values;
}

export function buildTableTaskSearchMatcherSignature(
	tasks: readonly IndexedTask[],
	settings: TableSearchSettings,
	generation: number | string,
	columns: readonly TableColumn[],
	valueResolverSignature = '',
): string {
	return [
		String(generation),
		valueResolverSignature,
		String(tasks.length),
		buildTableSearchVisibleColumnSignature(columns),
		buildTableSearchKeyMappingSignature(settings),
	].join('|');
}

export function buildTableSearchVisibleColumnSignature(columns: readonly TableColumn[]): string {
	return columns
		.filter(column => column.hidden !== true)
		.map(column => column.key)
		.join('|');
}

// The incremental search cache reuses previously matched rows in their cached order,
// and queryTableRows skips sorting entirely for precomputed rows — so this key must
// change whenever the sort rules do, or changing the sort while a query is active
// silently keeps the old row order.
export function buildTableSearchCacheScopeKey(
	scopeKey: string,
	columns: readonly TableColumn[],
	sortRules: readonly TableSortRule[],
): string {
	return `${scopeKey}|columns=${buildTableSearchVisibleColumnSignature(columns)}|sort=${JSON.stringify(sortRules)}`;
}

export function buildTableNoSearchResultCacheKey(
	scopeKey: string,
	columns: readonly TableColumn[],
	preset: TablePreset,
): string {
	return [
		scopeKey,
		`columns=${buildTableSearchVisibleColumnSignature(columns)}`,
		`sort=${JSON.stringify(preset.sortRules)}`,
		`group=${JSON.stringify({
			groupBy: preset.groupBy,
			groupOrder: preset.groupOrder,
			subgroupBy: preset.subgroupBy,
			subgroupOrder: preset.subgroupOrder,
			collapsedGroupKeys: preset.collapsedGroupKeys,
		})}`,
		`summaries=${JSON.stringify(preset.summaries)}`,
		`display=${JSON.stringify(preset.display)}`,
	].join('|');
}

export function buildTableSearchKeyMappingSignature(settings: TableSearchSettings): string {
	return settings.keyMappings
		.map(mapping => [
			mapping.canonicalKey,
			mapping.visiblePropertyName,
			mapping.type,
			mapping.enabled === false ? '0' : '1',
			mapping.isInternal === true ? 'internal' : 'managed',
			].join(':'))
			.join('|');
}

function matchesTableSearchTerm(tokens: readonly string[], term: string): boolean {
	if (/^\d+$/.test(term)) {
		return tokens.includes(term);
	}
	return tokens.some(token => token.startsWith(term));
}

const TABLE_SEARCH_TERM_CHAR = /[\p{L}\p{N}]/u;

// Incremental narrowing filters the previously matched rows instead of the full scope,
// which is only sound when extending the query can never match a task the previous
// query rejected. Prefix-matched terms are monotone under extension, but numeric terms
// match tokens EXACTLY (see matchesTableSearchTerm): continuing a trailing numeric term
// ("12" -> "123" or "12" -> "12a") targets different tokens than the exact match that
// just excluded rows from the cache, so those extensions require a full rescan.
export function isTableSearchNarrowingSafe(previousQuery: string, nextQuery: string): boolean {
	if (!previousQuery || !nextQuery.startsWith(previousQuery)) return false;
	if (nextQuery.length === previousQuery.length) return true;
	const previousTerms = tokenizeTaskSearchText(previousQuery);
	const lastTerm = previousTerms[previousTerms.length - 1];
	if (!lastTerm || !/^\d+$/.test(lastTerm)) return true;
	// The trailing numeric term survives intact only when the boundary starts a new term.
	const lastPreviousChar = previousQuery[previousQuery.length - 1] ?? '';
	const firstAppendedChar = nextQuery[previousQuery.length] ?? '';
	return !TABLE_SEARCH_TERM_CHAR.test(lastPreviousChar) || !TABLE_SEARCH_TERM_CHAR.test(firstAppendedChar);
}
