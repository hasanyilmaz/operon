import type { ProjectSearchMode } from '../systems/task-search';
import {
	GANTT_SCALES,
	GANTT_UNIT_WIDTH_MULTIPLIERS,
	type GanttScale,
	type GanttUnitWidthMultiplier,
} from './gantt';
import type { FilterSet } from './settings';

export const OPERON_TABLE_VIEW_TYPE = 'operon-table-view';
export const OPERON_TABLE_FILE_VIEW_TYPE = 'operon-table-file-view';
export const DEFAULT_TABLE_PRESET_ID = 'table-preset-my-first-table';
export const TABLE_LINE_NUMBER_COLUMN_KEY = '__lineNumber';
export const TABLE_TASK_ICON_COLUMN_KEY = '__taskIcon';
export const TABLE_TASK_DATA_TYPE_COLUMN_KEY = '__taskDataType';
export const TABLE_TASK_TREE_COLUMN_KEY = '__taskTree';

export type TableColumnKind = 'task' | 'admin';
export type TableAdminColumnKey =
	| typeof TABLE_LINE_NUMBER_COLUMN_KEY
	| typeof TABLE_TASK_ICON_COLUMN_KEY
	| typeof TABLE_TASK_DATA_TYPE_COLUMN_KEY;
export type TableColumnAlignment = 'left' | 'center' | 'right';
export type TableColumnColorMode = 'noColor' | 'taskColor' | 'statusColor' | 'priorityColor' | 'randomColors';
export type TableDurationDisplayMode = 'sessions' | 'total';
export type TableColumnDisplayMode = 'details' | 'icon';
export type TableSortDirection = 'asc' | 'desc';
export type TableSortEmptyPlacement = 'first' | 'last';
export type TableDensity = 'compact' | 'comfortable';
export type TableGanttVisibility = 'inherit' | 'show' | 'hide';
export type TableGanttOneDayClickBehavior = 'scheduled' | 'dateRange';
export type TableGanttBarClickAction = 'none' | 'openTaskEditor' | 'goToSource' | 'contextMenu';
export const TABLE_GANTT_VISIBILITIES: readonly TableGanttVisibility[] = ['inherit', 'show', 'hide'];
export const TABLE_GANTT_SPLIT_OPTIONS = [50, 60, 70, 80] as const;

export interface TableGanttSettings {
	enabled: boolean;
	splitPercent: number;
	scale: GanttScale;
	unitWidthMultiplier: GanttUnitWidthMultiplier;
	barColorMode: TableColumnColorMode;
	todayVisibility: TableGanttVisibility;
	weekendVisibility: TableGanttVisibility;
}

export interface TableGanttGlobalDefaults {
	splitPercent: number;
	scale: GanttScale;
	unitWidthMultiplier: GanttUnitWidthMultiplier;
	barColorMode: TableColumnColorMode;
}
export const TABLE_EMBED_VISIBLE_ROW_OPTIONS = [10, 20, 30, 40, 50, 75, 100] as const;
export type TableEmbedVisibleRows = typeof TABLE_EMBED_VISIBLE_ROW_OPTIONS[number];
export const DEFAULT_TABLE_EMBED_VISIBLE_ROWS: TableEmbedVisibleRows = 20;
export function isTableEmbedVisibleRows(value: number): value is TableEmbedVisibleRows {
	return TABLE_EMBED_VISIBLE_ROW_OPTIONS.includes(value as TableEmbedVisibleRows);
}
export const TABLE_EMBED_DEFAULT_WIDTH_PERCENT_OPTIONS = [50, 75, 100, 125, 150, 175, 200, 225, 250] as const;
export type TableEmbedDefaultWidthPercent = typeof TABLE_EMBED_DEFAULT_WIDTH_PERCENT_OPTIONS[number];
export const DEFAULT_TABLE_EMBED_DEFAULT_WIDTH_PERCENT: TableEmbedDefaultWidthPercent = 175;
export function isTableEmbedDefaultWidthPercent(value: number): value is TableEmbedDefaultWidthPercent {
	return TABLE_EMBED_DEFAULT_WIDTH_PERCENT_OPTIONS.includes(value as TableEmbedDefaultWidthPercent);
}
export type TableSummaryFunction =
	| 'Count'
	| 'Filled'
	| 'Empty'
	| 'Unique'
	| 'Sum'
	| 'Average'
	| 'Median'
	| 'Min'
	| 'Max'
	| 'Range'
	| 'Stddev'
	| 'Earliest'
	| 'Latest'
	| 'OpenCount'
	| 'FinishedCount'
	| 'CancelledCount'
	| 'TerminalCount'
	| 'CompletionRate'
	| 'TopValues'
	| 'ListItemCount';

export interface TableColumn {
	key: string;
	kind: TableColumnKind;
	label?: string;
	widthPx?: number;
	hidden?: boolean;
	align?: TableColumnAlignment;
	pinned?: boolean;
	colorMode?: TableColumnColorMode;
	durationDisplayMode?: TableDurationDisplayMode;
	displayMode?: TableColumnDisplayMode;
}

export const TABLE_COLUMN_COLOR_MODES: readonly TableColumnColorMode[] = [
	'noColor',
	'taskColor',
	'statusColor',
	'priorityColor',
	'randomColors',
];

export interface TableSortRule {
	key: string;
	direction: TableSortDirection;
	empty: TableSortEmptyPlacement;
}

export interface TableSummaryRule {
	key: string;
	function: TableSummaryFunction;
}

export interface TableDisplayOptions {
	showSource: boolean;
	density: TableDensity;
}

export interface TablePresetSearchScope {
	projectMode: ProjectSearchMode | null;
	showOverdue: boolean;
	showHappensToday: boolean;
	showRecentModified: boolean;
	includeInline: boolean;
	includeFile: boolean;
	includeCancelled: boolean;
	includeFinished: boolean;
}

export interface TablePresetSearchParent {
	mode: ProjectSearchMode;
	parentId: string;
	parentName?: string;
}

export interface TablePresetSearchState {
	scope: TablePresetSearchScope;
	parent: TablePresetSearchParent | null;
}

export interface TablePresetFileBinding {
	id: string;
	path: string;
}

export interface TablePreset {
	id: string;
	name: string;
	filterSetId: string | null;
	columns: TableColumn[];
	sortRules: TableSortRule[];
	groupBy: string | null;
	groupOrder: TableSortDirection;
	subgroupBy: string | null;
	subgroupOrder: TableSortDirection;
	collapsedGroupKeys: string[];
	expandedTaskTreeIds: string[];
	summaries: TableSummaryRule[];
	display: TableDisplayOptions;
	search: TablePresetSearchState;
	gantt: TableGanttSettings;
}

export interface TablePresetPatch {
	id: string;
	name?: string;
	filterSetId?: string | null;
	columns?: TableColumn[];
	sortRules?: TableSortRule[];
	groupBy?: string | null;
	groupOrder?: TableSortDirection;
	subgroupBy?: string | null;
	subgroupOrder?: TableSortDirection;
	collapsedGroupKeys?: string[];
	expandedTaskTreeIds?: string[];
	summaries?: TableSummaryRule[];
	display?: TableDisplayOptions;
	search?: TablePresetSearchState;
	gantt?: TableGanttSettings;
}

export interface TableLeafState {
	presetId: string | null;
	searchQuery: string;
	scrollTop: number;
	scrollLeft: number;
}

export interface TablePresetNormalizationOptions {
	availableFilterSetIds: readonly string[];
}

export interface TablePresetProjectionSettings {
	tablePresets: TablePreset[];
	tablePresetOrderIds?: string[];
	tablePresetFileBindings?: TablePresetFileBinding[];
	tablePresetFileInitialized: boolean;
	tableDefaultPresetId: string | null;
	tableDefaultFolder: string;
	tableEmbedVisibleRows: TableEmbedVisibleRows;
	tableEmbedDefaultWidthPercent: TableEmbedDefaultWidthPercent;
	tableShowLineNumbers: boolean;
	tableShowTaskIcon: boolean;
	tableShowTaskDataTypeIcon: boolean;
}

export interface TablePresetPackageSettings {
	presetIds?: string[];
	fileBindings?: TablePresetFileBinding[];
	initialized?: boolean;
	tableDefaultPresetId: string | null;
	tableDefaultFolder?: string;
	tableEmbedVisibleRows: TableEmbedVisibleRows;
	/** Optional so Table manifests written before this preference remain readable. */
	tableEmbedDefaultWidthPercent?: TableEmbedDefaultWidthPercent;
	tableShowLineNumbers: boolean;
	tableShowTaskIcon: boolean;
	tableShowTaskDataTypeIcon: boolean;
}

export const DEFAULT_TABLE_COLUMN_KEYS = [
	TABLE_TASK_DATA_TYPE_COLUMN_KEY,
	'taskIcon',
	'taskColor',
	'description',
	'note',
	'priority',
	'status',
	'progress',
	'dateScheduled',
	'dateDue',
	'totalDuration',
	'duration',
	'estimate',
	'checkboxProgress',
	'location',
	'parentTask',
	'source',
	'trackers',
	'totalEstimate',
	'tags',
	'sourceFormat',
	'sourceLine',
	'checkbox',
] as const;

const DEFAULT_TABLE_PRESET_COLUMNS: readonly TableColumn[] = [
	{ key: TABLE_TASK_DATA_TYPE_COLUMN_KEY, kind: 'task', align: 'center', displayMode: 'icon' },
	{ key: 'taskIcon', kind: 'task', align: 'center', displayMode: 'icon' },
	{ key: 'taskColor', kind: 'task', align: 'center', displayMode: 'icon' },
	{ key: 'description', kind: 'task', widthPx: 296 },
	{ key: 'note', kind: 'task', displayMode: 'icon' },
	{ key: 'priority', kind: 'task', widthPx: 100, align: 'center' },
	{ key: 'status', kind: 'task', widthPx: 201 },
	{ key: 'progress', kind: 'task', widthPx: 177, align: 'center' },
	{ key: 'dateScheduled', kind: 'task', align: 'center' },
	{ key: 'dateDue', kind: 'task', align: 'center' },
	{ key: 'totalDuration', kind: 'task', hidden: true, align: 'right' },
	{ key: 'duration', kind: 'task', widthPx: 145, hidden: true, align: 'right' },
	{ key: 'estimate', kind: 'task', widthPx: 177, hidden: true, align: 'right' },
	{ key: 'checkboxProgress', kind: 'task', widthPx: 179, hidden: true, align: 'center' },
	{ key: 'location', kind: 'task', widthPx: 237, hidden: true, colorMode: 'taskColor' },
	{ key: 'parentTask', kind: 'task', widthPx: 290, hidden: true },
	{ key: 'source', kind: 'task', hidden: true },
	{ key: 'trackers', kind: 'task', widthPx: 369, hidden: true },
	{ key: 'totalEstimate', kind: 'task', hidden: true, align: 'right' },
	{ key: 'tags', kind: 'task', widthPx: 229, hidden: true, colorMode: 'randomColors' },
	{ key: 'sourceFormat', kind: 'task', hidden: true },
	{ key: 'sourceLine', kind: 'task', hidden: true, align: 'right' },
	{ key: 'checkbox', kind: 'task', hidden: true, align: 'center', displayMode: 'icon' },
];

export function getDefaultTableColumnAlignment(key: string): TableColumnAlignment {
	if (key === 'sourceLine'
		|| key === 'estimate'
		|| key === 'duration'
		|| key === 'totalEstimate'
		|| key === 'totalDuration'
		|| key === 'directSubtaskCount'
		|| key === 'directDoneSubtaskCount'
		|| key === 'directOpenSubtaskCount'
		|| key === 'treeDescendantCount'
		|| key === 'treeDoneDescendantCount'
		|| key === 'treeOpenDescendantCount') {
		return 'right';
	}
	if (key === TABLE_LINE_NUMBER_COLUMN_KEY
		|| key === TABLE_TASK_ICON_COLUMN_KEY
		|| key === TABLE_TASK_DATA_TYPE_COLUMN_KEY
		|| key === 'checkbox'
		|| key === 'checkboxProgress'
		|| key === 'priority'
		|| key === 'dateDue'
		|| key === 'dateScheduled'
		|| key === 'dateStarted'
		|| key === 'datetimeCreated'
		|| key === 'dateCompleted'
		|| key === 'dateCancelled'
		|| key === 'datetimeStart'
		|| key === 'datetimeEnd'
		|| key === 'datetimeRepeatEnd'
		|| key === 'progress'
		|| key === 'taskIcon'
		|| key === 'taskColor'
		|| key === 'datetimeModified') {
		return 'center';
	}
	return 'left';
}

export function createDefaultTableColumn(key: string): TableColumn {
	const align = getDefaultTableColumnAlignment(key);
	return align === 'left'
		? { key, kind: 'task' }
		: { key, kind: 'task', align };
}

export function createDefaultTableGanttSettings(
	defaults: Partial<TableGanttGlobalDefaults> = {},
): TableGanttSettings {
	return {
		enabled: false,
		splitPercent: normalizeTableGanttSplitPercent(defaults.splitPercent, 70),
		scale: normalizeTableGanttScale(defaults.scale, 'week'),
		unitWidthMultiplier: normalizeTableGanttUnitWidthMultiplier(defaults.unitWidthMultiplier, 1),
		barColorMode: normalizeTableGanttBarColorMode(defaults.barColorMode, 'noColor'),
		todayVisibility: 'inherit',
		weekendVisibility: 'inherit',
	};
}

export function normalizeTableGanttSettings(
	value: unknown,
	fallback: TableGanttSettings = createDefaultTableGanttSettings(),
): TableGanttSettings {
	const src = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		enabled: typeof src.enabled === 'boolean' ? src.enabled : fallback.enabled,
		splitPercent: normalizeTableGanttSplitPercent(src.splitPercent, fallback.splitPercent),
		scale: normalizeTableGanttScale(src.scale, fallback.scale),
		unitWidthMultiplier: normalizeTableGanttUnitWidthMultiplier(src.unitWidthMultiplier, fallback.unitWidthMultiplier),
		barColorMode: normalizeTableGanttBarColorMode(src.barColorMode, fallback.barColorMode),
		todayVisibility: normalizeTableGanttVisibility(src.todayVisibility, fallback.todayVisibility),
		weekendVisibility: normalizeTableGanttVisibility(src.weekendVisibility, fallback.weekendVisibility),
	};
}

export function normalizeTableGanttSplitPercent(value: unknown, fallback = 70): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim()
			? Number(value.trim())
			: Number.NaN;
	if (!Number.isFinite(parsed)) return fallback;
	return Math.round(Math.min(80, Math.max(20, parsed)) * 100) / 100;
}

export function resolveTableGanttVisibility(value: TableGanttVisibility, globalValue: boolean): boolean {
	if (value === 'show') return true;
	if (value === 'hide') return false;
	return globalValue;
}

function normalizeTableGanttScale(value: unknown, fallback: GanttScale): GanttScale {
	return GANTT_SCALES.includes(value as GanttScale) ? value as GanttScale : fallback;
}

function normalizeTableGanttUnitWidthMultiplier(
	value: unknown,
	fallback: GanttUnitWidthMultiplier,
): GanttUnitWidthMultiplier {
	return GANTT_UNIT_WIDTH_MULTIPLIERS.includes(value as GanttUnitWidthMultiplier)
		? value as GanttUnitWidthMultiplier
		: fallback;
}

function normalizeTableGanttBarColorMode(value: unknown, fallback: TableColumnColorMode): TableColumnColorMode {
	return TABLE_COLUMN_COLOR_MODES.includes(value as TableColumnColorMode)
		? value as TableColumnColorMode
		: fallback;
}

function normalizeTableGanttVisibility(value: unknown, fallback: TableGanttVisibility): TableGanttVisibility {
	return TABLE_GANTT_VISIBILITIES.includes(value as TableGanttVisibility)
		? value as TableGanttVisibility
		: fallback;
}

export function createDefaultTablePreset(ganttDefaults: Partial<TableGanttGlobalDefaults> = {}): TablePreset {
	return {
		id: DEFAULT_TABLE_PRESET_ID,
		name: 'My First Table',
		filterSetId: null,
		columns: DEFAULT_TABLE_PRESET_COLUMNS.map(column => ({ ...column })),
		sortRules: [],
		groupBy: null,
		groupOrder: 'asc',
		subgroupBy: null,
		subgroupOrder: 'asc',
		collapsedGroupKeys: [],
		expandedTaskTreeIds: [],
		summaries: [],
		display: {
			showSource: true,
			density: 'compact',
		},
		search: createDefaultTablePresetSearchState(),
		gantt: createDefaultTableGanttSettings(ganttDefaults),
	};
}

export function cloneDefaultTablePresets(): TablePreset[] {
	return [cloneTablePreset(createDefaultTablePreset())];
}

export function normalizeTableEmbedVisibleRows(value: unknown, fallback: TableEmbedVisibleRows = DEFAULT_TABLE_EMBED_VISIBLE_ROWS): TableEmbedVisibleRows {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim()
			? Number(value.trim())
			: Number.NaN;
	return isTableEmbedVisibleRows(parsed)
		? parsed
		: fallback;
}

export function normalizeTableEmbedDefaultWidthPercent(
	value: unknown,
	fallback: TableEmbedDefaultWidthPercent = DEFAULT_TABLE_EMBED_DEFAULT_WIDTH_PERCENT,
): TableEmbedDefaultWidthPercent {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim()
			? Number(value.trim())
			: Number.NaN;
	return isTableEmbedDefaultWidthPercent(parsed)
		? parsed
		: fallback;
}

export function createTablePresetId(): string {
	return `tp_${Math.random().toString(36).slice(2, 9)}`;
}

export function cloneTablePreset(preset: TablePreset): TablePreset {
	return {
		...preset,
		columns: preset.columns.map(column => ({ ...column })),
		sortRules: preset.sortRules.map(rule => ({ ...rule })),
		collapsedGroupKeys: [...preset.collapsedGroupKeys],
		expandedTaskTreeIds: [...preset.expandedTaskTreeIds],
		summaries: preset.summaries.map(summary => ({ ...summary })),
		display: { ...preset.display },
		search: cloneTablePresetSearchState(preset.search),
		gantt: { ...preset.gantt },
	};
}

export function createDefaultTablePresetSearchState(): TablePresetSearchState {
	return {
		scope: {
			projectMode: null,
			showOverdue: false,
			showHappensToday: false,
			showRecentModified: false,
			includeInline: true,
			includeFile: true,
			includeCancelled: true,
			includeFinished: true,
		},
		parent: null,
	};
}

export function cloneTablePresetSearchState(search: TablePresetSearchState): TablePresetSearchState {
	return {
		scope: { ...search.scope },
		parent: search.parent
			? { ...search.parent }
			: null,
	};
}

export function normalizeTablePreset(
	raw: unknown,
	options: TablePresetNormalizationOptions,
): TablePreset | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const src = raw as Record<string, unknown>;
	const fallback = createDefaultTablePreset();
	const id = readNonEmptyString(src.id) ?? createTablePresetId();
	const name = readNonEmptyString(src.name) ?? fallback.name;
	const requestedFilterSetId = readNonEmptyString(src.filterSetId);
	const filterSetId = requestedFilterSetId && options.availableFilterSetIds.includes(requestedFilterSetId)
		? requestedFilterSetId
		: null;
	const requestedGroupBy = readNonEmptyString(src.groupBy);
	const groupBy = requestedGroupBy && requestedGroupBy !== TABLE_TASK_TREE_COLUMN_KEY && !isTablePersistedColumnReservedKey(requestedGroupBy) ? requestedGroupBy : null;
	const requestedSubgroupBy = readNonEmptyString(src.subgroupBy);
	const subgroupBy = groupBy && requestedSubgroupBy && requestedSubgroupBy !== TABLE_TASK_TREE_COLUMN_KEY && requestedSubgroupBy !== groupBy && !isTablePersistedColumnReservedKey(requestedSubgroupBy)
		? requestedSubgroupBy
		: null;

	return {
		id,
		name,
		filterSetId,
		columns: normalizeTableColumns(src.columns),
		sortRules: normalizeTableSortRules(src.sortRules),
		groupBy,
		groupOrder: groupBy ? normalizeTableSortDirection(src.groupOrder) : 'asc',
		subgroupBy,
		subgroupOrder: subgroupBy ? normalizeTableSortDirection(src.subgroupOrder) : 'asc',
		collapsedGroupKeys: normalizeTableCollapsedGroupKeys(src.collapsedGroupKeys),
		expandedTaskTreeIds: normalizeTableExpandedTaskTreeIds(src.expandedTaskTreeIds),
		summaries: normalizeTableSummaries(src.summaries),
		display: normalizeTableDisplayOptions(src.display),
		search: normalizeTablePresetSearchState(src.search),
		gantt: normalizeTableGanttSettings(src.gantt, fallback.gantt),
	};
}

export function normalizeTableCollapsedGroupKeys(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return Array.from(new Set(
		value
			.filter((key): key is string => typeof key === 'string')
			.map(key => key.trim())
			.filter(Boolean),
	)).sort();
}

export function normalizeTableExpandedTaskTreeIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return Array.from(new Set(
		value
			.filter((id): id is string => typeof id === 'string')
			.map(id => id.trim())
			.filter(Boolean),
	)).sort();
}

export function normalizeTablePresets(
	raw: unknown,
	options: TablePresetNormalizationOptions,
): TablePreset[] {
	if (!Array.isArray(raw)) return cloneDefaultTablePresets();
	const normalized = raw
		.map(entry => normalizeTablePreset(entry, options))
		.filter((preset): preset is TablePreset => !!preset);
	const seen = new Set<string>();
	const presets = normalized.map(preset => {
		if (isSafeTablePresetId(preset.id) && !seen.has(preset.id)) {
			seen.add(preset.id);
			return preset;
		}
		const id = createUniqueTablePresetId(seen);
		seen.add(id);
		return { ...preset, id };
	});
	return presets.length > 0 ? presets : cloneDefaultTablePresets();
}

function createUniqueTablePresetId(seen: ReadonlySet<string>): string {
	let id = createTablePresetId();
	while (seen.has(id) || !isSafeTablePresetId(id)) {
		id = createTablePresetId();
	}
	return id;
}

export function isSafeTablePresetId(id: string): boolean {
	return id.trim().length > 0 && !/["\\\r\n`]/u.test(id);
}

export function resolveTablePresetFilterSet(
	preset: TablePreset,
	filterSets: readonly FilterSet[],
): FilterSet | null {
	if (!preset.filterSetId) return null;
	return filterSets.find(filterSet => filterSet.id === preset.filterSetId) ?? null;
}

export function isTableAdminColumnKey(key: string): key is TableAdminColumnKey {
	return key === TABLE_LINE_NUMBER_COLUMN_KEY
		|| key === TABLE_TASK_ICON_COLUMN_KEY
		|| key === TABLE_TASK_DATA_TYPE_COLUMN_KEY;
}

/**
 * The two host-only columns are never persisted in a Table preset. Task Data
 * Type may also be injected as an admin column, but remains a persisted,
 * read-only synthetic field when a user selects it in a Table preset.
 */
export function isTablePersistedColumnReservedKey(key: string): boolean {
	return key === TABLE_LINE_NUMBER_COLUMN_KEY
		|| key === TABLE_TASK_ICON_COLUMN_KEY;
}

function normalizeTableColumns(value: unknown): TableColumn[] {
	if (!Array.isArray(value)) return createDefaultTablePreset().columns;
	const columns: TableColumn[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		const column = normalizeTableColumn(entry);
		if (!column || seen.has(column.key)) continue;
		seen.add(column.key);
		columns.push(column);
	}
	return columns.length > 0 ? columns : createDefaultTablePreset().columns;
}

function normalizeTableColumn(value: unknown): TableColumn | null {
	if (typeof value === 'string') {
		const key = value.trim();
		return key && !isTablePersistedColumnReservedKey(key) ? { key, kind: 'task' } : null;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const src = value as Record<string, unknown>;
	const key = readNonEmptyString(src.key);
	if (!key || isTablePersistedColumnReservedKey(key)) return null;
	const column: TableColumn = {
		key,
		kind: 'task',
		label: readNonEmptyString(src.label) ?? undefined,
		widthPx: normalizeColumnWidth(src.widthPx),
		hidden: typeof src.hidden === 'boolean' ? src.hidden : undefined,
		align: normalizeTableColumnAlignment(src.align),
	};
	if (src.pinned === true) {
		column.pinned = true;
	}
	const colorMode = normalizeTableColumnColorMode(src.colorMode, key);
	if (colorMode) {
		column.colorMode = colorMode;
	}
	const durationDisplayMode = normalizeTableDurationDisplayMode(src.durationDisplayMode, key);
	if (durationDisplayMode) {
		column.durationDisplayMode = durationDisplayMode;
	}
	const displayMode = normalizeTableColumnDisplayMode(src.displayMode)
		?? normalizeLegacyTableNoteDisplayMode(src.noteDisplayMode, key);
	if (displayMode) {
		column.displayMode = displayMode;
	}
	return column;
}

function normalizeTableColumnAlignment(value: unknown): TableColumnAlignment | undefined {
	return value === 'center' || value === 'right' ? value : undefined;
}

export function getDefaultTableColumnColorMode(key: string): TableColumnColorMode {
	if (key === 'status') return 'statusColor';
	if (key === 'priority') return 'priorityColor';
	if (key === 'taskColor') return 'taskColor';
	if (key === 'progress' || key === 'checkboxProgress') return 'taskColor';
	return 'noColor';
}

export function isTableColumnColorModeLocked(key: string): boolean {
	return key === 'taskColor';
}

export function normalizeTableColumnColorMode(value: unknown, key: string): TableColumnColorMode | undefined {
	if (typeof value !== 'string') return undefined;
	if (!TABLE_COLUMN_COLOR_MODES.includes(value as TableColumnColorMode)) return undefined;
	const colorMode = value as TableColumnColorMode;
	return colorMode === getDefaultTableColumnColorMode(key) ? undefined : colorMode;
}

export function resolveTableDurationDisplayMode(
	column: Pick<TableColumn, 'key' | 'durationDisplayMode'>,
): TableDurationDisplayMode {
	return column.key === 'duration' && column.durationDisplayMode === 'total' ? 'total' : 'sessions';
}

export function normalizeTableDurationDisplayMode(value: unknown, key: string): TableDurationDisplayMode | undefined {
	return key === 'duration' && value === 'total' ? 'total' : undefined;
}

export function resolveTableColumnDisplayMode(
	column: Pick<TableColumn, 'displayMode'>,
): TableColumnDisplayMode {
	return column.displayMode === 'icon' ? 'icon' : 'details';
}

export function normalizeTableColumnDisplayMode(value: unknown): TableColumnDisplayMode | undefined {
	return value === 'icon' ? 'icon' : undefined;
}

function normalizeLegacyTableNoteDisplayMode(value: unknown, key: string): TableColumnDisplayMode | undefined {
	return key === 'note' && value === 'icon' ? 'icon' : undefined;
}

function normalizeTableSortRules(value: unknown): TableSortRule[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(entry => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
			const src = entry as Record<string, unknown>;
			const key = readNonEmptyString(src.key);
			if (!key || key === TABLE_TASK_TREE_COLUMN_KEY || isTablePersistedColumnReservedKey(key)) return null;
			return {
				key,
				direction: src.direction === 'desc' ? 'desc' : 'asc',
				empty: src.empty === 'first' ? 'first' : 'last',
			} satisfies TableSortRule;
		})
		.filter((rule): rule is TableSortRule => !!rule);
}

function normalizeTableSortDirection(value: unknown): TableSortDirection {
	return value === 'desc' ? 'desc' : 'asc';
}

function normalizeTableSummaries(value: unknown): TableSummaryRule[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(entry => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
			const src = entry as Record<string, unknown>;
			const key = readNonEmptyString(src.key);
			const summaryFunction = readNonEmptyString(src.function);
			if (!key || key === TABLE_TASK_TREE_COLUMN_KEY || isTablePersistedColumnReservedKey(key) || !summaryFunction || !isTableSummaryFunction(summaryFunction)) return null;
			return { key, function: summaryFunction } satisfies TableSummaryRule;
		})
		.filter((summary): summary is TableSummaryRule => !!summary);
}

function normalizeTableDisplayOptions(value: unknown): TableDisplayOptions {
	const src = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		showSource: typeof src.showSource === 'boolean' ? src.showSource : true,
		density: src.density === 'comfortable' ? 'comfortable' : 'compact',
	};
}

export function normalizeTablePresetSearchState(value: unknown): TablePresetSearchState {
	const src = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const scope = normalizeTablePresetSearchScope(src.scope);
	const parent = normalizeTablePresetSearchParent(src.parent);
	if (parent) {
		scope.projectMode = parent.mode;
	}
	return { scope, parent };
}

function normalizeTablePresetSearchScope(value: unknown): TablePresetSearchScope {
	const src = value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const showOverdue = src.showOverdue === true;
	const showHappensToday = src.showHappensToday === true && !showOverdue;
	let includeInline = src.includeInline === false ? false : true;
	let includeFile = src.includeFile === false ? false : true;
	if (!includeInline && !includeFile) {
		includeInline = true;
		includeFile = true;
	}
	return {
		projectMode: normalizeProjectSearchMode(src.projectMode),
		showOverdue,
		showHappensToday,
		showRecentModified: src.showRecentModified === true,
		includeInline,
		includeFile,
		includeCancelled: src.includeCancelled === false ? false : true,
		includeFinished: src.includeFinished === false ? false : true,
	};
}

function normalizeTablePresetSearchParent(value: unknown): TablePresetSearchParent | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const src = value as Record<string, unknown>;
	const parentId = readNonEmptyString(src.parentId);
	const mode = normalizeProjectSearchMode(src.mode);
	if (!parentId || !mode) return null;
	const parentName = readNonEmptyString(src.parentName) ?? readNonEmptyString(src.label);
	return {
		mode,
		parentId,
		...(parentName ? { parentName } : {}),
	};
}

function normalizeProjectSearchMode(value: unknown): ProjectSearchMode | null {
	return value === 'pc' || value === 'pt' ? value : null;
}

function normalizeColumnWidth(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return Math.max(80, Math.min(640, Math.round(value)));
}

function isTableSummaryFunction(value: string): value is TableSummaryFunction {
	return [
		'Count',
		'Filled',
		'Empty',
		'Unique',
		'Sum',
		'Average',
		'Median',
		'Min',
		'Max',
		'Range',
		'Stddev',
		'Earliest',
		'Latest',
		'OpenCount',
		'FinishedCount',
		'CancelledCount',
		'TerminalCount',
		'CompletionRate',
		'TopValues',
		'ListItemCount',
	].includes(value);
}

function readNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
