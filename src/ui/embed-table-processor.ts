import { MarkdownRenderChild, Notice, Platform, setIcon, TFile, type App, type MarkdownPostProcessorContext } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import type { PinnedCache } from '../storage/pinned-cache';
import type { ProjectSerialDisplay } from '../core/project-serials';
import type { IndexedTask } from '../types/fields';
import { cloneFilterSet, type FilterSet, type OperonSettings, type TaskFinderDefaultScopeKey } from '../types/settings';
import type { TrackerSession } from '../types/tracker';
import {
	TABLE_LINE_NUMBER_COLUMN_KEY,
	TABLE_TASK_ICON_COLUMN_KEY,
	TABLE_TASK_TYPE_COLUMN_KEY,
	cloneTablePreset,
	cloneTablePresetSearchState,
	normalizeTableEmbedVisibleRows,
	resolveTableDurationDisplayMode,
	resolveTablePresetFilterSet,
	type TableColumn,
	type TablePreset,
	type TablePresetPatch,
	type TablePresetSearchState,
	type TableSummaryFunction,
} from '../types/table';
import { evaluateTableQuerySummaries, queryTableRows, type TableQueryGroup, type TableQueryResult, type TableQuerySubgroup } from '../systems/table-query';
import { filterTasksForCalendar } from '../systems/calendar-filter-materialization';
import { t } from '../core/i18n';
import { localNow } from '../core/local-time';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { PROJECT_SERIAL_TABLE_FIELD_KEY, getTableTaskField, getTableTaskFieldLabel, isEditableTableTaskFieldKey } from './table/table-field-catalog';
import {
	formatTableTaskSource,
} from './table/table-value-adapter';
import { renderTableCellChips } from './table/table-cell-chip';
import { resolveTableColumnCellAccent, resolveTableIconOnlyCellAccent } from './table/table-column-color';
import { renderTableDescriptionCellContent, type TableInlineEditSession } from './table/table-description-cell';
import { bindMobileTableViewport, isMobileTableTextInputFocused } from './table/mobile-table-viewport';
import {
	formatTableIconOnlyTooltipContent,
	renderTableIconOnlyCell,
	resolveTableIconOnlyCellIcon,
	resolveTableValueCellIcon,
} from './table/table-icon-only-cell';
import {
	buildTableGroupSortPresetPatch,
	resolveTableEditingPreset,
	type TableGroupSortPresetPatchScope,
} from './table/table-preset-model';
import { resolveTablePresetSearchSaveFailureRecovery } from './table/table-preset-search-recovery';
import { isTableProgressColumnKey, renderTableProgressCell } from './table/table-progress-cell';
import { formatTableValueCacheStats, type TableValueResolver } from './table/table-value-cache';
import {
	TABLE_SEARCH_PREWARM_CHUNK_DELAY_MS,
	TABLE_SEARCH_PREWARM_DELAY_MS,
	TABLE_SEARCH_PREWARM_MAX_TASKS_PER_CHUNK,
	TABLE_SEARCH_PREWARM_TIME_BUDGET_MS,
	TABLE_SEARCH_DEBOUNCE_MS,
	buildTableNoSearchResultCacheKey,
	buildTableSearchCacheScopeKey,
	buildTableTaskSearchMatcherSignature,
	createTableTaskSearchMatcherCache,
	isTableSearchNarrowingSafe,
	type TableTaskSearchMatcherCache,
} from './table/table-search';
import { buildTableRelevantSettingsSignature } from './table/table-signature';
import { bindTableActiveCellHighlight } from './table/table-active-cell-highlight';
import {
	TABLE_SEARCH_BOX_DEFAULT_SCOPE,
	TABLE_SEARCH_BOX_DISABLED_KEYS,
	TABLE_PARENT_SEARCH_MAX_CANDIDATES,
	TABLE_SEARCH_MAX_QUERY_LENGTH,
	TABLE_SEARCH_PARENT_MIN_QUERY_LENGTH,
	buildTableParentSearchCandidates,
	clampTableSearchQuery,
	cloneTableSearchBoxScopeState,
	getTableActiveTextSearchQuery,
	getTableNormalTextSearchQuery,
	isTableSearchScopeActive,
	isTableActiveTextSearchClearing,
	renderTableParentSearchDropdown,
	renderTableSearchIcon,
	renderTableSearchScopePopover,
	resolveTableSearchBaseScopeTasks,
	resolveTableParentSearchSelection,
	resolveTableParentSearchVisibleTaskIds,
	syncTableSearchWrapClasses,
	type TableParentSearchSelection,
	type TableParentSearchUiState,
} from './table/table-search-scope';
import { getTableSummaryIdleDelayMs, type TableSummaryCell } from './table/table-summary';
import {
	TABLE_DEFAULT_BODY_HEIGHT,
	TABLE_OVERSCAN_ROWS,
	applyTableColumnAlignmentClass,
	applyTableColumnGeometryClass,
	buildTableColumnGeometry,
	buildTableEditableCellKey,
	buildTableRenderItems,
	buildTableTaskOrdinalMap,
	formatTableTaskCount,
	formatTableSearchPlaceholder,
	hasVisibleTableSummaryRule,
	isTableAdminColumn,
	measureTableScrollbarGutterPx,
	resolveTableGroupDisplayLabel,
	resolveTableColumns,
	resolveTableRowHeight,
	truncateTableSubgroupParentLabel,
	type TableColumnGeometry,
	type TableRenderItem,
} from './table/table-surface';
import {
	applyInteractiveTableColumnTemplate,
	cleanupTableHeaderActiveResize,
	createTableHeaderInteractionState,
	renderInteractiveTableHeaderCell,
	shouldUseTableIconOnlyColumn,
	type TableHeaderInteractionState,
	type TableHeaderPresetPatchScope,
} from './table/table-header-interactions';
import {
	getExcludedTablePickerTaskIds,
	getTableManualDatePickerOptions,
	normalizeTablePickerPayload,
} from './table/table-editing';
import { openTaskFieldPicker } from './task-field-picker-dispatch';
import { showTextFieldPopover } from './text-field-popover';
import { buildTrackerSessionEditContext, TrackerSessionEditModal } from './tracker-session-edit-modal';
import { formatDurationHuman } from '../systems/tracker-utils';
import { closeFloatingPanelsForRoot, snapshotFloatingRectAnchor } from './field-pickers/common';
import { closeIconOnlyChipPreviewsForRoot } from './icon-only-chip-preview';
import { getOwnerDocument, getOwnerWindow } from '../core/dom-compat';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import {
	applyTaskSearchBoxShortcutCommand,
	getTaskSearchBoxRecentModifiedCutoff,
	matchesTaskSearchBoxScope,
	toggleTaskSearchBoxScope,
	type TaskSearchBoxScopeState,
} from './task-search-box-integration';
import { updateSearchParentHighlight } from './search-scope-controls';
import type { ProjectSearchCandidate, ProjectSearchMode, ProjectSearchResolvers } from '../systems/task-search';
import { enginePerfLog, enginePerfNow } from '../core/engine-perf';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { bindTableTaskContextualHoverMenu, renderTableTaskIconButton } from './table/table-task-icon-button';
import { bindTableTaskTypeEditorOpen, renderTableTaskTypeButton } from './table/table-task-type-button';
import { showTableGroupSortPopover } from './table/table-group-sort-popover';
import { getTablePresetPickerLabel, showTablePresetPicker } from './table/table-preset-picker';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { FilterSetModal } from './filter-set-modal';
import {
	buildTableLocationCellIndexSignature,
	getTableLocationCellResolver,
	resolveTableLocationCellVisual,
	type TableLocationCellResolver,
	type TableLocationCellVisual,
} from './table/table-location-cell';
import { showLocationMapPreview } from './location-map-preview';

export interface EmbedTableDeps {
	app: App;
	indexer: OperonIndexer;
	getSettings: () => OperonSettings;
	getPinnedCache: () => PinnedCache | null;
	openTaskEditor: (operonId: string) => void;
	openTaskSource: (operonId: string) => void;
	allowWrites?: boolean;
	updateTaskFields?: (operonId: string, payload: Record<string, string>) => void | Promise<boolean>;
	getTaskSessions?: (operonId: string) => readonly TrackerSession[];
	addTaskSession?: (operonId: string, start: string, end: string) => void | Promise<boolean>;
	editTaskSession?: (session: TrackerSession, start: string, end: string) => void | Promise<boolean>;
	deleteTaskSession?: (session: TrackerSession) => void | Promise<boolean>;
	onStatusIconClick?: (taskId: string) => void | Promise<void>;
	onContextualAction?: ContextualMenuActionHandler;
	onOpenPresetSettings?: (presetId: string) => void;
	onSavePresetPatch?: (patch: TablePresetPatch) => Promise<void>;
	onSaveFilterSet?: (filterSet: FilterSet) => Promise<void>;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getProjectSerialSignature?: () => string;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
}

interface EmbedTableInstance {
	el: HTMLElement;
	presetId: string;
	visibleRowsOverride: TableEmbedVisibleRowsOverride | null;
	sourceContext: TableEmbedSourceContext | null;
	sourceContextResolver: (() => TableEmbedSourceContext | null) | null;
	lastQuerySignature: string | null;
	lastRenderSignature: string | null;
	lastRenderedRangeKey: string | null;
	searchQuery: string;
	pendingSearchQuery: string | null;
	searchScope: TaskSearchBoxScopeState;
	parentSearchSelection: TableParentSearchSelection | null;
	parentSearchHighlightedIndex: number;
	parentSearchDismissed: boolean;
	pendingSearchFocus: { start: number; end: number } | null;
	activeMobileInlineEdit: TableInlineEditSession | null;
	pendingMobileTextInputRender: boolean;
	mobileViewportCleanup: (() => void) | null;
	mobileScrollGestureUntil: number;
	appliedPresetSearchSignature: string | null;
	pendingPresetSearchSignature: string | null;
	searchDebounceTimer: number | null;
	isSearchComposing: boolean;
	scrollTop: number;
	scrollLeft: number;
	collapsedGroupKeys: Set<string>;
	visibleRowsFrame: number | null;
	resizeObserverCleanup: (() => void) | null;
	horizontalScrollerEl: HTMLElement | null;
	bodyScrollerEl: HTMLElement | null;
	bodyCanvasEl: HTMLElement | null;
	currentRenderState: EmbeddedTableRenderState | null;
	activePickerClose: (() => void) | null;
	keepActivePickerOnRender: boolean;
	suppressActivePickerCloseOnScrollToken: number;
	headerInteractionState: TableHeaderInteractionState;
	pendingCellKey: string | null;
	pendingFocusKey: string | null;
	searchMatcherCache: TableTaskSearchMatcherCache;
	incrementalSearchCache: EmbeddedTableIncrementalSearchCache | null;
	sortedRowsCache: EmbeddedTableSortedRowsCache | null;
	noSearchResultCache: EmbeddedTableNoSearchResultCache | null;
	searchPrewarmTimer: number | null;
	searchPrewarmChunkTimer: number | null;
	searchPrewarmKey: string | null;
	completedSearchPrewarmKey: string | null;
	searchPrewarmIndex: number;
	deferSummariesForSearch: boolean;
	summaryIdleTimer: number | null;
	summaryRefreshToken: number;
}

interface EmbeddedTableRenderState {
	preset: TablePreset;
	columns: TableColumn[];
	taskColumns: TableColumn[];
	rows: IndexedTask[];
	groups: TableQueryGroup[];
	items: TableRenderItem[];
	taskOrdinals: Map<string, number>;
	summaries: Map<string, TableSummaryCell>;
	groupSummaries: Map<string, Map<string, TableSummaryCell>>;
	summariesCalculating: boolean;
	settings: OperonSettings;
	allTasks: IndexedTask[];
	valueResolver: TableValueResolver;
	locationResolver: TableLocationCellResolver | null;
	locationIndexSignature: string;
	rowHeight: number;
	tableWidthPx: number;
	columnGeometry: TableColumnGeometry;
	scrollbarGutterPx: number;
	noSearchResultCacheKey: string | null;
}

interface EmbedTableResizeObserverLike {
	observe(target: Element): void;
	disconnect(): void;
}

type TableEmbedVisibleRowsOverride = number;

type EmbedTableResizeObserverConstructor = new (callback: () => void) => EmbedTableResizeObserverLike;

interface EmbeddedTableSearchContext {
	parentSearchUi: TableParentSearchUiState | null;
	activeSearchQuery: string;
	scopedTasks: IndexedTask[];
	scopeFilteredTasks: IndexedTask[];
	taskIdFilter?: Set<string>;
	scopeKey: string;
}

interface EmbeddedTableIncrementalSearchCache {
	scopeKey: string;
	query: string;
	rows: IndexedTask[];
}

interface EmbeddedTableSortedRowsCache {
	key: string;
	rows: IndexedTask[];
}

interface EmbeddedTableNoSearchResultCache {
	key: string;
	result: TableQueryResult;
	summariesEvaluated: boolean;
}

export interface TableEmbedReference {
	presetId: string;
	rows: TableEmbedVisibleRowsOverride | null;
}

export interface TableEmbedSourceContext {
	sourcePath: string;
	lineStart: number;
	lineEnd: number;
}

const activeTableEmbeds: Set<EmbedTableInstance> = new Set();
export const TABLE_EMBED_HEADER_HEIGHT = 34;
export const TABLE_EMBED_MIN_BODY_HEIGHT = 180;

class TableEmbedPresetSourceUpdateSkippedError extends Error {
	constructor() {
		super('Embedded table source no longer matches the active preset reference.');
		this.name = 'TableEmbedPresetSourceUpdateSkippedError';
	}
}

function generateEmbedTableFilterSetId(): string {
	return 'fs_' + Math.random().toString(36).slice(2, 9);
}

function generateEmbedTableFilterGroupId(): string {
	return 'fg_' + Math.random().toString(36).slice(2, 10);
}

function generateEmbedTableFilterPopoverId(): string {
	return 'operon-table-filter-popover-' + Math.random().toString(36).slice(2, 10);
}

function createEmptyEmbedTableFilterSet(name: string): FilterSet {
	return {
		id: generateEmbedTableFilterSetId(),
		name,
		icon: 'filter',
		rootGroup: {
			id: generateEmbedTableFilterGroupId(),
			logic: 'all',
			children: [],
		},
		sorts: [],
		matchLogic: 'all',
		conditions: [],
	};
}

export function parseTableEmbedReference(source: string): TableEmbedReference | null {
	let presetId: string | null = null;
	let rows: TableEmbedVisibleRowsOverride | null = null;
	for (const line of source.split('\n')) {
		const trimmed = line.trim();
		const idMatch = trimmed.match(/^presetId:\s*(.+?)\s*$/i);
		if (idMatch) presetId = parseTableEmbedPresetIdValue(idMatch[1]);
		const rowsMatch = trimmed.match(/^rows:\s*(.+?)\s*$/i);
		if (rowsMatch) rows = parseTableEmbedRowsValue(rowsMatch[1]);
	}
	return presetId ? { presetId, rows } : null;
}

function parseTableEmbedPresetIdValue(value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null;
		} catch {
			return null;
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		const parsed = trimmed.slice(1, -1).trim();
		return parsed || null;
	}
	return trimmed;
}

function parseTableEmbedRowsValue(value: string | undefined): TableEmbedVisibleRowsOverride | null {
	const parsed = parseTableEmbedScalarValue(value);
	if (typeof parsed === 'number') {
		return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
	}
	if (typeof parsed !== 'string') return null;
	const trimmed = parsed.trim();
	if (!/^[1-9]\d*$/u.test(trimmed)) return null;
	const numeric = Number(trimmed);
	return Number.isSafeInteger(numeric) ? numeric : null;
}

function parseTableEmbedScalarValue(value: string | undefined): string | number | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			return typeof parsed === 'string' || typeof parsed === 'number' ? parsed : null;
		} catch {
			return null;
		}
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

export function resolveTableEmbedShellHeightPx(itemCount: number, rowHeight: number, visibleRows: number): number {
	const finiteItemCount = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
	const finiteRowHeight = Number.isFinite(rowHeight) ? Math.max(1, Math.floor(rowHeight)) : 1;
	const finiteVisibleRows = Number.isFinite(visibleRows) ? Math.max(1, Math.floor(visibleRows)) : 1;
	const visibleItemCount = Math.min(finiteItemCount, finiteVisibleRows);
	return Math.max(TABLE_EMBED_MIN_BODY_HEIGHT, TABLE_EMBED_HEADER_HEIGHT + visibleItemCount * finiteRowHeight);
}

export function updateTableEmbedPresetIdInMarkdown(
	content: string,
	context: TableEmbedSourceContext,
	expectedPresetId: string,
	nextPresetId: string,
): string | null {
	if (!nextPresetId.trim()) return null;
	const lines = content.split('\n');
	if (
		!Number.isInteger(context.lineStart)
		|| !Number.isInteger(context.lineEnd)
		|| context.lineStart < 0
		|| context.lineEnd < context.lineStart
		|| context.lineEnd >= lines.length
	) {
		return null;
	}

	const rangeLines = lines.slice(context.lineStart, context.lineEnd + 1);
	const openFenceIndex = rangeLines.findIndex(line => line.trim().toLowerCase().startsWith('```operon-table'));
	if (openFenceIndex === -1) return null;
	const closeFenceIndex = rangeLines.findIndex((line, index) => index > openFenceIndex && line.trim().startsWith('```'));
	if (closeFenceIndex === -1) return null;

	const innerSource = rangeLines.slice(openFenceIndex + 1, closeFenceIndex).join('\n');
	const currentRef = parseTableEmbedReference(innerSource);
	if (!currentRef || currentRef.presetId !== expectedPresetId) return null;

	const presetLineIndices = rangeLines
		.map((line, index) => ({ line, index }))
		.filter(({ line, index }) => (
			index > openFenceIndex
			&& index < closeFenceIndex
			&& /^\s*presetId\s*:/iu.test(line)
		))
		.map(({ index }) => index);
	if (presetLineIndices.length !== 1) return null;
	const presetLineIndex = presetLineIndices[0];
	if (presetLineIndex === undefined) return null;

	const presetLine = rangeLines[presetLineIndex] ?? '';
	const indent = presetLine.match(/^(\s*)presetId\s*:/iu)?.[1] ?? '';
	const updatedLines = [...lines];
	updatedLines[context.lineStart + presetLineIndex] = `${indent}presetId: ${JSON.stringify(nextPresetId)}`;
	return updatedLines.join('\n');
}

export function registerEmbedTableProcessor(
	registerFn: (lang: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>) => void,
	deps: EmbedTableDeps,
): void {
	registerFn('operon-table', (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		const tableRef = parseTableEmbedReference(source);
		if (!tableRef) {
			renderTableEmbedError(el, t('table', 'embedInvalidSyntax'));
			return;
		}

		const sourceContextResolver = (): TableEmbedSourceContext | null => resolveTableEmbedSourceContext(el, ctx);
		const instance = createEmbedTableInstance(el, tableRef.presetId, tableRef.rows, sourceContextResolver);
		activeTableEmbeds.add(instance);
		ctx.addChild(new EmbedTableRenderChild(el, instance));
		renderEmbedTable(instance, deps);
	});
}

function resolveTableEmbedSourceContext(el: HTMLElement, ctx: MarkdownPostProcessorContext): TableEmbedSourceContext | null {
	const sectionInfo = typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(el) : null;
	if (!sectionInfo || !ctx.sourcePath) return null;
	return {
		sourcePath: ctx.sourcePath,
		lineStart: sectionInfo.lineStart,
		lineEnd: sectionInfo.lineEnd,
	};
}

export function refreshEmbedTables(deps: EmbedTableDeps): void {
	for (const instance of activeTableEmbeds) {
		if (!instance.el.isConnected) {
			destroyEmbedTableInstance(instance);
			activeTableEmbeds.delete(instance);
			continue;
		}
		if (instance.el.offsetParent === null) {
			closeEmbedTableTransientUi(instance.el);
			closeEmbedTableActivePicker(instance);
			cleanupTableHeaderActiveResize(instance.headerInteractionState);
			cleanupEmbedMobileViewport(instance);
			instance.lastQuerySignature = null;
			instance.lastRenderSignature = null;
			continue;
		}
		renderEmbedTable(instance, deps);
	}
}

function createEmbedTableInstance(
	el: HTMLElement,
	presetId: string,
	visibleRowsOverride: TableEmbedVisibleRowsOverride | null,
	sourceContextResolver: (() => TableEmbedSourceContext | null) | null,
): EmbedTableInstance {
	return {
		el,
		presetId,
		visibleRowsOverride,
		sourceContext: sourceContextResolver?.() ?? null,
		sourceContextResolver,
		lastQuerySignature: null,
		lastRenderSignature: null,
		lastRenderedRangeKey: null,
		searchQuery: '',
		pendingSearchQuery: null,
		searchScope: cloneTableSearchBoxScopeState(TABLE_SEARCH_BOX_DEFAULT_SCOPE),
		parentSearchSelection: null,
		parentSearchHighlightedIndex: 0,
		parentSearchDismissed: false,
		pendingSearchFocus: null,
		activeMobileInlineEdit: null,
		pendingMobileTextInputRender: false,
		mobileViewportCleanup: null,
		mobileScrollGestureUntil: 0,
		appliedPresetSearchSignature: null,
		pendingPresetSearchSignature: null,
		searchDebounceTimer: null,
		isSearchComposing: false,
		scrollTop: 0,
		scrollLeft: 0,
		collapsedGroupKeys: new Set<string>(),
		visibleRowsFrame: null,
		resizeObserverCleanup: null,
		horizontalScrollerEl: null,
		bodyScrollerEl: null,
		bodyCanvasEl: null,
		currentRenderState: null,
		activePickerClose: null,
		keepActivePickerOnRender: false,
		suppressActivePickerCloseOnScrollToken: 0,
		headerInteractionState: createTableHeaderInteractionState(),
		pendingCellKey: null,
		pendingFocusKey: null,
		searchMatcherCache: createTableTaskSearchMatcherCache(),
		incrementalSearchCache: null,
		sortedRowsCache: null,
		noSearchResultCache: null,
		searchPrewarmTimer: null,
		searchPrewarmChunkTimer: null,
		searchPrewarmKey: null,
		completedSearchPrewarmKey: null,
		searchPrewarmIndex: 0,
		deferSummariesForSearch: false,
		summaryIdleTimer: null,
		summaryRefreshToken: 0,
	};
}

function destroyEmbedTableInstance(instance: EmbedTableInstance): void {
	instance.pendingMobileTextInputRender = false;
	instance.mobileScrollGestureUntil = 0;
	finishEmbedTableMobileInlineEdit(instance, false);
	instance.activeMobileInlineEdit = null;
	closeEmbedTableTransientUi(instance.el);
	closeEmbedTableActivePicker(instance);
	cancelEmbedTableSearchDebounce(instance);
	cancelEmbedTableSummaryIdle(instance);
	cancelEmbedTableSearchPrewarm(instance);
	cleanupTableHeaderActiveResize(instance.headerInteractionState);
	instance.searchMatcherCache.clear();
	instance.incrementalSearchCache = null;
	instance.sortedRowsCache = null;
	instance.noSearchResultCache = null;
	cleanupEmbedTableResizeObserver(instance);
	cleanupEmbedMobileViewport(instance);
	cleanupOperonHoverTooltips(instance.el);
	if (instance.visibleRowsFrame !== null) {
		window.cancelAnimationFrame(instance.visibleRowsFrame);
		instance.visibleRowsFrame = null;
	}
	resetEmbedTableRenderState(instance);
}

// Once the embed's DOM is torn down, every cached render artifact must go with it:
// a surviving lastQuerySignature/currentRenderState pair satisfies the early-return
// in renderEmbedTable and would freeze whatever is currently on screen.
function resetEmbedTableRenderState(instance: EmbedTableInstance): void {
	instance.horizontalScrollerEl = null;
	instance.bodyScrollerEl = null;
	instance.bodyCanvasEl = null;
	instance.currentRenderState = null;
	instance.lastQuerySignature = null;
	instance.lastRenderSignature = null;
}

class EmbedTableRenderChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly instance: EmbedTableInstance,
	) {
		super(containerEl);
	}

	onunload(): void {
		destroyEmbedTableInstance(this.instance);
		activeTableEmbeds.delete(this.instance);
	}
}

function renderEmbedTable(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	finishEmbedTableMobileInlineEdit(instance, true);
	const renderStartedAt = enginePerfNow();
	const settings = deps.getSettings();
	const preset = settings.tablePresets.find(entry => entry.id === instance.presetId) ?? null;
	if (!preset) {
		closeEmbedTableTransientUi(instance.el);
		closeEmbedTableActivePicker(instance);
		cleanupEmbedTableResizeObserver(instance);
		cleanupEmbedMobileViewport(instance);
		cleanupOperonHoverTooltips(instance.el);
		instance.el.empty();
		resetEmbedTableRenderState(instance);
		renderTableEmbedError(instance.el, t('table', 'embedPresetNotFound', { presetId: instance.presetId }));
		return;
	}

	syncEmbedTableSearchStateFromPreset(instance, preset);
	const activeInput = instance.el.querySelector<HTMLInputElement>('.operon-table-search-input');
	const restoreSearchFocus = instance.el.ownerDocument.activeElement === activeInput;
	const searchSelectionStart = activeInput?.selectionStart ?? null;
	const searchSelectionEnd = activeInput?.selectionEnd ?? null;
	const resolvedColumns = resolveTableColumns(preset, settings);
	const taskColumns = resolvedColumns.taskColumns.map(column => ({ ...column }));
	const columns = resolvedColumns.renderColumns.map(column => ({ ...column }));
	const locationResolver = getTableLocationCellResolver(deps.app, settings, columns);
	const locationIndexSignature = buildTableLocationCellIndexSignature(deps.app, settings, columns);
	const allTasks = deps.indexer.getAllTasks();
	const querySignature = buildEmbedTableQuerySignature(instance, deps, preset, settings, allTasks, locationIndexSignature);
	if (querySignature === instance.lastQuerySignature && instance.currentRenderState) {
		restoreEmbedTableSearchFocus(instance, activeInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
		return;
	}

	const filterSet = resolveTablePresetFilterSet(preset, settings.filterSets);
	const searchContext = resolveEmbedTableSearchContext(instance, deps, filterSet, allTasks, settings);
	const searchContextResolvedAt = enginePerfNow();
	const normalizedSearchQuery = searchContext.activeSearchQuery.trim().toLocaleLowerCase();
	const searchCacheScopeKey = buildTableSearchCacheScopeKey(searchContext.scopeKey, taskColumns, preset.sortRules);
	const noSearchResultCacheKey = buildTableNoSearchResultCacheKey(searchContext.scopeKey, taskColumns, preset);
	const cachedNoSearchResult = !normalizedSearchQuery
		&& instance.noSearchResultCache?.key === noSearchResultCacheKey
		&& instance.noSearchResultCache.summariesEvaluated
		? instance.noSearchResultCache
		: null;
	const searchMatcher = normalizedSearchQuery
		? instance.searchMatcherCache.getMatcher({
			tasks: allTasks,
			settings,
			generation: deps.indexer.getGeneration(),
			columns: taskColumns,
			valueResolverOptions: { getProjectSerialDisplay: deps.getProjectSerialDisplay },
			valueResolverSignature: deps.getProjectSerialSignature?.() ?? '',
		})
		: undefined;
	const matcherResolvedAt = enginePerfNow();
	const sortedSearchBaseRows = normalizedSearchQuery
		? resolveEmbedTableSortedSearchBaseRows(instance, deps, {
			preset,
			filterSet,
			tasks: allTasks,
			settings,
			searchContext,
			columns: taskColumns,
			cacheKey: searchCacheScopeKey,
		})
		: null;
	const precomputedSearchedTasks = normalizedSearchQuery && searchMatcher
		? resolveEmbedTableIncrementalSearchedTasks(
			instance,
			sortedSearchBaseRows ?? searchContext.scopeFilteredTasks,
			normalizedSearchQuery,
			searchMatcher,
			searchCacheScopeKey,
		)
		: undefined;
	const cachedEmptySearchRows = !normalizedSearchQuery && instance.sortedRowsCache?.key === searchCacheScopeKey
		? instance.sortedRowsCache.rows
		: undefined;
	const precomputedRowsForQuery = precomputedSearchedTasks ?? cachedEmptySearchRows;
	if (!normalizedSearchQuery) {
		instance.incrementalSearchCache = null;
	}
	const hasSummaryRow = hasVisibleTableSummaryRule(preset.summaries, taskColumns);
	const shouldDeferSummaries = !cachedNoSearchResult && instance.deferSummariesForSearch && hasSummaryRow;
	if (cachedNoSearchResult) {
		instance.deferSummariesForSearch = false;
	}
	const result = cachedNoSearchResult?.result ?? queryTableRows({
		preset,
		filterSet,
		tasks: allTasks,
		priorities: settings.priorities,
		pinnedCache: deps.getPinnedCache(),
		settings,
		searchQuery: searchContext.activeSearchQuery,
		searchMatcher,
		precomputedScopedTasks: searchContext.scopedTasks,
		precomputedScopeFilteredTasks: searchContext.scopeFilteredTasks,
		precomputedSearchedTasks,
		precomputedRows: precomputedRowsForQuery,
		taskIdFilter: searchContext.taskIdFilter,
		summaryMode: shouldDeferSummaries ? 'skip' : 'evaluate',
		valueResolverOptions: { getProjectSerialDisplay: deps.getProjectSerialDisplay },
	});
	const queryResolvedAt = enginePerfNow();
	if (!normalizedSearchQuery && !cachedNoSearchResult) {
		instance.noSearchResultCache = {
			key: noSearchResultCacheKey,
			result,
			summariesEvaluated: !shouldDeferSummaries,
		};
	}
	const rowHeight = resolveTableRowHeight(result.preset);
	const columnGeometry = buildTableColumnGeometry(columns);
	const tableWidthPx = columnGeometry.tableWidthPx;
	const scrollbarGutterPx = measureTableScrollbarGutterPx(instance.el.ownerDocument);
	const collapsedGroupKeys = Array.from(instance.collapsedGroupKeys);
	const items = buildTableRenderItems(
		result.rows,
		result.groups,
		collapsedGroupKeys,
		hasSummaryRow,
	);
	const ordinalItems = collapsedGroupKeys.length === 0
		? items
		: buildTableRenderItems(result.rows, result.groups, [], hasSummaryRow);
	const renderSignature = buildEmbedTableRenderSignature(
		instance,
		deps,
		result.preset,
		columns,
		columnGeometry,
		result.rows,
		result.groups,
		items,
		locationIndexSignature,
	);
	instance.lastQuerySignature = querySignature;
	if (renderSignature === instance.lastRenderSignature) {
		restoreEmbedTableSearchFocus(instance, activeInput, restoreSearchFocus, searchSelectionStart, searchSelectionEnd);
		return;
	}
	instance.lastRenderSignature = renderSignature;
	instance.lastRenderedRangeKey = null;
	instance.currentRenderState = {
		preset: result.preset,
		columns,
		taskColumns,
		rows: result.rows,
		groups: result.groups,
		items,
		taskOrdinals: buildTableTaskOrdinalMap(ordinalItems),
		summaries: result.summaries,
		groupSummaries: result.groupSummaries,
		summariesCalculating: shouldDeferSummaries,
		settings,
		allTasks,
		valueResolver: result.valueResolver,
		locationResolver,
		locationIndexSignature,
		rowHeight,
		tableWidthPx,
		columnGeometry,
		scrollbarGutterPx,
		noSearchResultCacheKey: normalizedSearchQuery ? null : noSearchResultCacheKey,
	};
	if (shouldDeferSummaries) {
		scheduleEmbedTableDeferredSummaryRefresh(instance, deps);
	}
	scheduleEmbedTableSearchPrewarm(instance, deps, allTasks, searchContext.scopeFilteredTasks, settings, taskColumns, normalizedSearchQuery);

	closeEmbedTableTransientUi(instance.el);
	// The group & sort popover saves on every change, which re-renders this embed;
	// it floats on document.body and must survive the render (operon-table-view
	// guards its render() the same way).
	if (!instance.keepActivePickerOnRender) {
		closeEmbedTableActivePicker(instance);
	}
	cleanupEmbedTableResizeObserver(instance);
	cleanupEmbedMobileViewport(instance);
	cleanupOperonHoverTooltips(instance.el);
	instance.el.empty();
	const root = instance.el.createDiv('operon-table-embed operon-table-root operon-task-chip-surface');
	bindEmbedMobileViewport(instance, deps, root);
	root.addClass(`operon-table-density-${result.preset.display.density}`);
	root.style.setProperty('--operon-table-row-height', `${rowHeight}px`);
	root.style.setProperty('--operon-table-embed-shell-height', `${resolveTableEmbedShellHeightPx(
		items.length,
		rowHeight,
		resolveEmbedTableVisibleRows(instance, settings),
	)}px`);
	const toolbar = renderEmbedTableToolbar(root, instance, result.preset, result.counts.final, deps, searchContext.parentSearchUi);
	updateEmbedTableToolbarHeight(root, toolbar);
	renderEmbedTableShell(root, instance, columns, rowHeight, deps, toolbar);
	if (result.rows.length === 0) {
		renderEmbedTableEmptyState(root, result.counts.scoped > 0 && isTableSearchScopeActive(instance.searchScope, instance.parentSearchSelection, instance.searchQuery));
	}
	suppressEmbedTableActivePickerCloseForProgrammaticScroll(instance);
	if (instance.horizontalScrollerEl) {
		instance.horizontalScrollerEl.scrollLeft = instance.scrollLeft;
	}
	if (instance.bodyScrollerEl) {
		instance.bodyScrollerEl.scrollTop = instance.scrollTop;
		renderEmbedTableVisibleRows(instance, deps, true);
	}
	restoreEmbedTablePendingCellFocus(instance);
	restoreEmbedTableSearchFocus(
		instance,
		instance.el.querySelector<HTMLInputElement>('.operon-table-search-input'),
		restoreSearchFocus,
		searchSelectionStart,
		searchSelectionEnd,
	);
	enginePerfLog(
		'table.embed.render',
		`${Math.round(enginePerfNow() - renderStartedAt)}ms`,
		`tasks=${allTasks.length}`,
		`rows=${result.rows.length}`,
		`stages=scope:${Math.round(searchContextResolvedAt - renderStartedAt)},matcher:${Math.round(matcherResolvedAt - searchContextResolvedAt)},query:${Math.round(queryResolvedAt - matcherResolvedAt)},dom:${Math.round(enginePerfNow() - queryResolvedAt)}`,
	);
}

function buildEmbedTableRenderSignature(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	preset: TablePreset,
	columns: readonly TableColumn[],
	columnGeometry: TableColumnGeometry,
	rows: readonly IndexedTask[],
	groups: readonly TableQueryGroup[],
	items: readonly TableRenderItem[],
	locationIndexSignature: string,
): string {
	return [
		deps.indexer.getGeneration(),
		deps.getPinnedCache()?.getGeneration() ?? 0,
		instance.presetId,
		instance.searchQuery.trim().toLocaleLowerCase(),
		JSON.stringify(instance.searchScope),
		instance.parentSearchSelection ? `${instance.parentSearchSelection.mode}:${instance.parentSearchSelection.parentId}` : '',
		Array.from(instance.collapsedGroupKeys).sort().join('\u0000'),
		JSON.stringify(preset),
		columnGeometry.signature,
		columns.map(column => `${column.key}:${column.widthPx ?? ''}:${column.hidden === true ? 'hidden' : 'visible'}:${column.pinned === true ? 'pinned' : 'unpinned'}`).join(','),
		rows.map(task => task.operonId).join(','),
		buildEmbedTableSessionSignature(deps, rows),
		groups.map(group => `${group.key}:${group.count}`).join(','),
		items.map(item => item.kind === 'task'
			? item.task.operonId
			: item.kind === 'group' || item.kind === 'groupSummary'
				? `${item.kind}:${item.groupKey}:${item.depth}`
				: 'summary').join(','),
		locationIndexSignature,
		deps.getProjectSerialSignature?.() ?? '',
		buildTableRelevantSettingsSignature(deps.getSettings()),
		canWriteEmbedTable(deps) ? 'write' : 'readonly',
	].join('|');
}

function buildEmbedTableQuerySignature(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	preset: TablePreset,
	settings: OperonSettings,
	tasks: readonly IndexedTask[],
	locationIndexSignature: string,
): string {
	return [
		deps.indexer.getGeneration(),
		deps.getPinnedCache()?.getGeneration() ?? 0,
		buildEmbedTableSessionSignature(deps, tasks),
		instance.presetId,
		instance.searchQuery.trim().toLocaleLowerCase(),
		JSON.stringify(instance.searchScope),
		instance.parentSearchSelection ? `${instance.parentSearchSelection.mode}:${instance.parentSearchSelection.parentId}` : '',
		Array.from(instance.collapsedGroupKeys).sort().join('\u0000'),
		JSON.stringify(preset),
		locationIndexSignature,
		deps.getProjectSerialSignature?.() ?? '',
		buildTableRelevantSettingsSignature(settings),
		canWriteEmbedTable(deps) ? 'write' : 'readonly',
	].join('|');
}

function canWriteEmbedTable(deps: EmbedTableDeps): boolean {
	return deps.allowWrites !== false && !!deps.updateTaskFields;
}

function resolveEmbedTableVisibleRows(instance: EmbedTableInstance, settings: OperonSettings): number {
	return instance.visibleRowsOverride ?? normalizeTableEmbedVisibleRows(settings.tableEmbedVisibleRows);
}

function buildEmbedTableSessionSignature(deps: EmbedTableDeps, tasks: readonly IndexedTask[]): string {
	if (!deps.getTaskSessions) return '';
	return tasks.map(task => {
		const sessions = deps.getTaskSessions?.(task.operonId) ?? [];
		if (sessions.length === 0) return '';
		return `${task.operonId}:${sessions.map(session => `${session.start}>${session.end}`).join(',')}`;
	}).filter(Boolean).join('|');
}

function renderEmbedTableToolbar(
	root: HTMLElement,
	instance: EmbedTableInstance,
	preset: TablePreset,
	taskCount: number,
	deps: EmbedTableDeps,
	parentSearchUi: TableParentSearchUiState | null,
): HTMLElement {
	const toolbar = root.createDiv('operon-table-toolbar operon-table-embed-toolbar');
	const titleWrap = toolbar.createDiv('operon-table-title-wrap');
	const iconEl = titleWrap.createSpan('operon-table-title-icon');
	setIcon(iconEl, 'table-2');
	titleWrap.createSpan({ cls: 'operon-table-title', text: preset.name.trim() || t('table', 'title') });
	const controls = toolbar.createDiv('operon-table-toolbar-controls');
	const settings = deps.getSettings();
	const displaySearchQuery = instance.pendingSearchQuery ?? instance.searchQuery;
	renderEmbedTablePresetPickerButton(controls, instance, preset, deps);
	renderEmbedTableGroupSortPopoverButton(controls, instance, preset, deps);
	renderEmbedTableFilterPopoverButton(controls, instance, preset, deps);
	renderEmbedTablePresetSettingsButton(controls, preset, deps);
	const searchWrap = controls.createDiv('operon-table-search-wrap');
	syncTableSearchWrapClasses(searchWrap, instance.searchScope, instance.parentSearchSelection, displaySearchQuery);
	searchWrap.classList.toggle('has-parent-search-dropdown', !!parentSearchUi?.dropdownVisible);
	renderTableSearchIcon(searchWrap);
	const searchPlaceholder = formatTableSearchPlaceholder(taskCount);
	const searchInput = searchWrap.createEl('input', {
		cls: 'operon-table-search-input',
		attr: {
			type: 'search',
			placeholder: searchPlaceholder,
			autocomplete: 'off',
			spellcheck: 'false',
			maxlength: String(TABLE_SEARCH_MAX_QUERY_LENGTH),
		},
	});
	setAccessibleLabelWithoutTooltip(searchInput, searchPlaceholder);
	searchInput.value = displaySearchQuery;
	searchInput.addEventListener('compositionstart', () => {
		instance.isSearchComposing = true;
	});
	searchInput.addEventListener('compositionend', () => {
		instance.isSearchComposing = false;
		handleEmbedTableSearchInput(instance, searchInput, deps, true);
	});
	searchInput.addEventListener('input', () => {
		if (instance.isSearchComposing) return;
		handleEmbedTableSearchInput(instance, searchInput, deps, false);
	});
	searchInput.addEventListener('keydown', event => {
		if (!parentSearchUi?.dropdownVisible || parentSearchUi.candidates.length === 0) return;
		const visibleCandidateCount = Math.min(parentSearchUi.candidates.length, TABLE_PARENT_SEARCH_MAX_CANDIDATES);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			updateEmbedTableParentSearchHighlight(instance, Math.min(visibleCandidateCount - 1, instance.parentSearchHighlightedIndex + 1));
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			updateEmbedTableParentSearchHighlight(instance, Math.max(0, instance.parentSearchHighlightedIndex - 1));
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const candidate = parentSearchUi.candidates[Math.min(instance.parentSearchHighlightedIndex, visibleCandidateCount - 1)] ?? parentSearchUi.candidates[0];
			if (candidate) selectEmbedTableParentSearchCandidate(instance, parentSearchUi.mode, candidate, deps);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			instance.parentSearchDismissed = true;
			instance.lastQuerySignature = null;
			instance.lastRenderSignature = null;
			renderEmbedTable(instance, deps);
		}
	});
	if (isTableSearchScopeActive(instance.searchScope, instance.parentSearchSelection, displaySearchQuery)) {
		const clearButton = searchWrap.createEl('button', {
			cls: 'operon-table-search-clear',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(clearButton, t('table', 'clearSearch'));
		setIcon(clearButton, 'x');
		clearButton.addEventListener('click', event => {
			event.preventDefault();
			clearEmbedTableSearchState(instance, deps);
		});
	}
	renderTableSearchScopePopover({
		searchWrap,
		scope: instance.searchScope,
		settings,
		selectedParent: instance.parentSearchSelection,
		onToggle: key => toggleEmbedTableSearchScopeKey(instance, key, deps),
		onClearParent: () => clearEmbedTableParentSearchState(instance, deps),
		onRefocus: () => focusEmbedTableSearchInput(instance),
	});
	renderTableParentSearchDropdown({
		searchWrap,
		parentSearchUi,
		highlightedIndex: instance.parentSearchHighlightedIndex,
		onSelect: candidate => selectEmbedTableParentSearchCandidate(instance, parentSearchUi?.mode ?? 'pc', candidate, deps),
	});
	return toolbar;
}

function renderEmbedTablePresetPickerButton(
	controls: HTMLElement,
	instance: EmbedTableInstance,
	preset: TablePreset,
	deps: EmbedTableDeps,
): void {
	const settings = deps.getSettings();
	if (settings.tablePresets.length === 0) return;
	const activeLabel = getTablePresetPickerLabel(preset);
	const button = controls.createEl('button', {
		cls: 'operon-table-toolbar-icon-button operon-table-preset-switcher-button operon-table-embed-toolbar-action',
		attr: {
			type: 'button',
			'aria-haspopup': 'listbox',
			'aria-expanded': 'false',
		},
	});
	setAccessibleLabelWithoutTooltip(button, `${t('table', 'selectPreset')}: ${activeLabel}`);
	setIcon(button.createSpan('operon-table-preset-switcher-button-icon'), 'table-2');
	bindOperonHoverTooltip(button, {
		content: t('table', 'selectPreset'),
		taskColor: null,
		preferredVertical: 'above',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		closeEmbedTableActivePicker(instance);
		button.setAttribute('aria-expanded', 'true');
		let closePicker: (() => void) | null = null;
		closePicker = showTablePresetPicker(button, {
			value: preset.id,
			presets: settings.tablePresets,
			onSelect: presetId => {
				void switchEmbedTablePreset(instance, deps, presetId);
			},
			onClose: () => {
				if (button.isConnected) button.setAttribute('aria-expanded', 'false');
				if (closePicker && instance.activePickerClose === closePicker) {
					instance.activePickerClose = null;
				}
				instance.keepActivePickerOnRender = false;
			},
			floatingHost: controls.ownerDocument.body,
			floatingScrollHost: controls.ownerDocument.defaultView ?? window,
			matchWidth: 280,
		});
		instance.activePickerClose = closePicker;
	});
}

function renderEmbedTablePresetSettingsButton(controls: HTMLElement, preset: TablePreset, deps: EmbedTableDeps): void {
	if (!deps.onOpenPresetSettings) return;
	const button = controls.createEl('button', {
		cls: 'operon-table-toolbar-icon-button',
		attr: {
			type: 'button',
		},
	});
	setAccessibleLabelWithoutTooltip(button, t('table', 'editPreset'));
	setIcon(button, 'settings-2');
	bindOperonHoverTooltip(button, {
		content: t('table', 'editPreset'),
		taskColor: null,
		preferredVertical: 'above',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		deps.onOpenPresetSettings?.(preset.id);
	});
}

function renderEmbedTableFilterPopoverButton(
	controls: HTMLElement,
	instance: EmbedTableInstance,
	preset: TablePreset,
	deps: EmbedTableDeps,
): void {
	if (!deps.onSavePresetPatch || !deps.onSaveFilterSet) return;
	const host = controls.createDiv('operon-table-filter-popover-host');
	const button = host.createEl('button', {
		cls: 'operon-table-toolbar-icon-button operon-table-filter-popover-button',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
		},
	});
	setAccessibleLabelWithoutTooltip(button, t('table', 'filter'));
	button.toggleClass('is-active', !!preset.filterSetId);
	setIcon(button, 'funnel');
	bindOperonHoverTooltip(button, {
		content: t('table', 'filter'),
		taskColor: null,
		preferredVertical: 'above',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		openEmbedTableFilterPopover(host, button, instance, preset, deps);
	});
}

function renderEmbedTableGroupSortPopoverButton(
	controls: HTMLElement,
	instance: EmbedTableInstance,
	preset: TablePreset,
	deps: EmbedTableDeps,
): void {
	if (!deps.onSavePresetPatch) return;
	const button = controls.createEl('button', {
		cls: 'operon-table-toolbar-icon-button operon-table-group-sort-button operon-table-embed-toolbar-action',
		attr: {
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': 'false',
		},
	});
	setAccessibleLabelWithoutTooltip(button, t('table', 'groupSort'));
	button.toggleClass('is-active', !!preset.groupBy || !!preset.subgroupBy || preset.sortRules.length > 0);
	setIcon(button, 'arrow-up-down');
	bindOperonHoverTooltip(button, {
		content: t('table', 'groupSort'),
		taskColor: null,
		preferredVertical: 'above',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		openEmbedTableGroupSortPopover(button, instance, preset, deps);
	});
}

function openEmbedTableGroupSortPopover(
	button: HTMLButtonElement,
	instance: EmbedTableInstance,
	preset: TablePreset,
	deps: EmbedTableDeps,
): void {
	closeEmbedTableActivePicker(instance);
	button.setAttribute('aria-expanded', 'true');
	const editingPreset = getCurrentEmbedTablePreset(instance, deps);
	let closePopover: (() => void) | null = null;
	closePopover = showTableGroupSortPopover({
		anchor: button.getBoundingClientRect(),
		floatingHost: button.ownerDocument.body,
		floatingScrollHost: getOwnerWindow(button),
		preset: editingPreset.id === preset.id ? editingPreset : preset,
		settings: deps.getSettings(),
		onChange: (updatedPreset, scope) => saveEmbedTableGroupSortPresetPatch(instance, deps, updatedPreset, scope),
		onClose: () => {
			button.setAttribute('aria-expanded', 'false');
			if (closePopover && instance.activePickerClose === closePopover) {
				instance.activePickerClose = null;
				instance.keepActivePickerOnRender = false;
			}
			const ownerWindow = getOwnerWindow(button);
			ownerWindow.requestAnimationFrame(() => {
				const focusTarget = button.isConnected
					? button
					: instance.el.querySelector<HTMLButtonElement>('button.operon-table-group-sort-button');
				if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
			});
		},
	});
	instance.keepActivePickerOnRender = true;
	instance.activePickerClose = closePopover;
}

function openEmbedTableFilterPopover(
	host: HTMLElement,
	button: HTMLButtonElement,
	instance: EmbedTableInstance,
	preset: TablePreset,
	deps: EmbedTableDeps,
): void {
	closeEmbedTableActivePicker(instance);
	const settings = deps.getSettings();
	const currentFilter = resolveTablePresetFilterSet(preset, settings.filterSets);
	const draft = currentFilter
		? cloneFilterSet(currentFilter)
		: createEmptyEmbedTableFilterSet(createUniqueEmbedTableFilterName(settings));
	const sourceFilterSetId = currentFilter?.id ?? null;
	const ownerDocument = getOwnerDocument(host);
	const ownerWindow = ownerDocument.defaultView ?? window;
	const popover = ownerDocument.body.createDiv('operon-table-filter-popover');
	const popoverId = generateEmbedTableFilterPopoverId();
	let editor: FilterSetModal | null = null;
	let isClosed = false;
	popover.id = popoverId;
	popover.setAttribute('role', 'dialog');
	setAccessibleLabelWithoutTooltip(popover, t('table', 'filter'));
	button.setAttribute('aria-expanded', 'true');
	button.setAttribute('aria-controls', popoverId);

	const close = (): void => {
		if (isClosed) return;
		isClosed = true;
		if (instance.activePickerClose === close) {
			instance.activePickerClose = null;
			instance.keepActivePickerOnRender = false;
		}
		ownerDocument.removeEventListener('pointerdown', handleDocumentPointerDown, true);
		ownerDocument.removeEventListener('keydown', handleDocumentKeyDown, true);
		ownerWindow.removeEventListener('resize', close);
		editor?.destroyInlineConditionEditor();
		button.setAttribute('aria-expanded', 'false');
		button.removeAttribute('aria-controls');
		popover.remove();
	};
	const handleDocumentPointerDown = (event: PointerEvent): void => {
		const target = event.target;
		if (target && typeof (target as Node).nodeType === 'number' && host.contains(target as Node)) return;
		if (editor?.isInlineEditorTarget(target)) return;
		close();
	};
	const handleDocumentKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		if (editor?.isInlineEditorFloatingTarget(event.target)) return;
		event.preventDefault();
		close();
	};

	editor = new FilterSetModal(
		deps.app,
		draft,
		settings.keyMappings,
		() => undefined,
	);
	editor.renderInlineConditionEditor(popover, {
		onCancel: close,
		onSave: updated => {
			void saveEmbedTableFilterPopoverDraft(instance, deps, updated, sourceFilterSetId, close);
		},
		countTasks: filterSet => filterTasksForCalendar(
			filterSet,
			deps.indexer.getAllTasks(),
			deps.getSettings().priorities,
			deps.getPinnedCache(),
		).length,
		saveTooltip: sourceFilterSetId
			? buildEmbedTableFilterUsageTooltip(sourceFilterSetId, deps)
			: undefined,
	});
	positionEmbedTableFilterPopover(popover, button);

	instance.keepActivePickerOnRender = true;
	instance.activePickerClose = close;
	ownerDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
	ownerDocument.addEventListener('keydown', handleDocumentKeyDown, true);
	ownerWindow.addEventListener('resize', close);
}

function positionEmbedTableFilterPopover(popover: HTMLElement, button: HTMLElement): void {
	const rect = button.getBoundingClientRect();
	const ownerDocument = getOwnerDocument(button);
	const ownerWindow = ownerDocument.defaultView ?? window;
	const margin = 12;
	const gap = 6;
	const availableWidth = Math.max(240, ownerWindow.innerWidth - margin * 2);
	const width = Math.min(760, availableWidth);
	const left = Math.max(margin, Math.min(rect.right - width, ownerWindow.innerWidth - width - margin));
	const top = Math.max(margin, rect.bottom + gap);
	const maxHeight = Math.max(240, ownerWindow.innerHeight - top - margin);
	popover.style.width = `${Math.round(width)}px`;
	popover.style.left = `${Math.round(left)}px`;
	popover.style.top = `${Math.round(top)}px`;
	popover.style.maxHeight = `${Math.round(maxHeight)}px`;
}

function createUniqueEmbedTableFilterName(settings: OperonSettings): string {
	const baseName = t('table', 'newFilterName');
	const existingNames = new Set(
		settings.filterSets.map(filterSet => filterSet.name.trim().toLocaleLowerCase()),
	);
	if (!existingNames.has(baseName.toLocaleLowerCase())) return baseName;
	let suffix = 2;
	while (existingNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) {
		suffix += 1;
	}
	return `${baseName} ${suffix}`;
}

function buildEmbedTableFilterUsageTooltip(filterSetId: string, deps: EmbedTableDeps): { title: string; content: string } | undefined {
	const settings = deps.getSettings();
	const lines: string[] = [];
	const calendarPresets = settings.calendarPresets
		.filter(entry => entry.filterSetId === filterSetId)
		.map(entry => entry.name.trim() || entry.id);
	const kanbanPresets = settings.kanbanPresets
		.filter(entry => entry.filterSetId === filterSetId)
		.map(entry => entry.name.trim() || entry.id);
	const tablePresets = settings.tablePresets
		.filter(entry => entry.filterSetId === filterSetId)
		.map(entry => entry.name.trim() || entry.id);
	if (calendarPresets.length > 0) {
		lines.push(`${t('filterSets', 'usedByCalendar')}: ${calendarPresets.join(', ')}`);
	}
	if (kanbanPresets.length > 0) {
		lines.push(`${t('filterSets', 'usedByKanban')}: ${kanbanPresets.join(', ')}`);
	}
	if (tablePresets.length > 0) {
		lines.push(`${t('filterSets', 'usedByTable')}: ${tablePresets.join(', ')}`);
	}
	if (lines.length === 0) return undefined;
	return {
		title: t('filterSets', 'usedByTitle'),
		content: lines.join(' · '),
	};
}

async function saveEmbedTableFilterPopoverDraft(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	filterSet: FilterSet,
	sourceFilterSetId: string | null,
	close: () => void,
): Promise<void> {
	if (!deps.onSaveFilterSet) {
		new Notice(t('table', 'presetActionFailed'));
		return;
	}
	try {
		await deps.onSaveFilterSet(filterSet);
		if (!sourceFilterSetId) {
			await deps.onSavePresetPatch?.({
				id: getCurrentEmbedTablePreset(instance, deps).id,
				filterSetId: filterSet.id,
			});
		}
		close();
	} catch (error) {
		console.error('Operon: failed to save embedded table filter popover draft', error);
		new Notice(t('table', 'presetActionFailed'));
	}
}

function renderEmbedTableShell(
	root: HTMLElement,
	instance: EmbedTableInstance,
	columns: TableColumn[],
	rowHeight: number,
	deps: EmbedTableDeps,
	toolbar: HTMLElement,
): void {
	const shell = root.createDiv('operon-table-shell');
	shell.setAttribute('role', 'grid');
	shell.setAttribute('aria-rowcount', String((instance.currentRenderState?.items.length ?? 0) + 1));
	shell.setAttribute('aria-colcount', String(columns.length));
	let activeCellHighlight: ReturnType<typeof bindTableActiveCellHighlight> | null = null;
	const horizontalScroller = shell.createDiv('operon-table-horizontal-scroll');
	const columnGeometry = instance.currentRenderState?.columnGeometry ?? buildTableColumnGeometry(columns);
	const columnTemplate = columnGeometry.columnTemplate;
	const tableWidthPx = columnGeometry.tableWidthPx;
	const surfaceWidthPx = tableWidthPx + (instance.currentRenderState?.scrollbarGutterPx ?? 0);
	const tableWidth = `${tableWidthPx}px`;
	const surfaceWidth = `${surfaceWidthPx}px`;

	const bodyScroller = horizontalScroller.createDiv('operon-table-body-scroller');
	bodyScroller.tabIndex = 0;
	const header = bodyScroller.createDiv('operon-table-header');
	header.setAttribute('role', 'row');
	header.setAttribute('aria-rowindex', '1');
	header.style.gridTemplateColumns = columnTemplate;
	header.style.width = surfaceWidth;
	header.style.minWidth = surfaceWidth;
	for (const [index, column] of columns.entries()) {
		renderInteractiveTableHeaderCell(header, column, index, {
			root: instance.el,
			state: instance.headerInteractionState,
			getRenderState: () => instance.currentRenderState,
			getCurrentPreset: () => getCurrentEmbedTablePreset(instance, deps),
			savePreset: (updatedPreset, scope) => saveEmbedTablePresetFromHeader(instance, deps, updatedPreset, scope),
			applyColumnTemplate: nextColumns => applyEmbedTableColumnTemplate(instance, nextColumns),
			closeActivePicker: () => closeEmbedTableActivePicker(instance),
			getActivePickerClose: () => instance.activePickerClose,
			setActivePickerClose: close => {
				instance.activePickerClose = close;
			},
			...(deps.onOpenPresetSettings
				? { onOpenPresetSettings: deps.onOpenPresetSettings }
				: {}),
		});
	}

	const canvas = bodyScroller.createDiv('operon-table-body-canvas');
	canvas.setAttribute('role', 'rowgroup');
	canvas.style.width = tableWidth;
	canvas.style.minWidth = tableWidth;
	canvas.style.setProperty('--operon-table-group-scroll-left', `${instance.scrollLeft}px`);
	canvas.style.height = `${(instance.currentRenderState?.items.length ?? 0) * rowHeight}px`;
	activeCellHighlight = bindTableActiveCellHighlight(canvas);
	instance.horizontalScrollerEl = bodyScroller;
	instance.bodyScrollerEl = bodyScroller;
	instance.bodyCanvasEl = canvas;
	observeEmbedTableBodyResize(instance, deps, root, shell, bodyScroller, toolbar);
	bodyScroller.addEventListener('pointermove', event => {
		if (!Platform.isPhone || event.pointerType === 'mouse') return;
		instance.mobileScrollGestureUntil = Date.now() + 900;
	}, { passive: true });
	bodyScroller.addEventListener('scroll', () => {
		activeCellHighlight?.clear();
		closeEmbedTableTransientUi(instance.el);
		if (instance.suppressActivePickerCloseOnScrollToken === 0) {
			closeEmbedTableActivePicker(instance);
		} else {
			instance.suppressActivePickerCloseOnScrollToken = 0;
		}
		canvas.style.setProperty('--operon-table-group-scroll-left', `${bodyScroller.scrollLeft}px`);
		instance.scrollTop = bodyScroller.scrollTop;
		instance.scrollLeft = bodyScroller.scrollLeft;
		if (!Platform.isPhone || Date.now() < instance.mobileScrollGestureUntil) {
			finishEmbedTableMobileInlineEdit(instance, true);
		}
		scheduleEmbedTableVisibleRowsRender(instance, deps);
	});
}

function suppressEmbedTableActivePickerCloseForProgrammaticScroll(instance: EmbedTableInstance): void {
	if (!instance.keepActivePickerOnRender || !instance.activePickerClose || !instance.bodyScrollerEl) return;
	const token = instance.suppressActivePickerCloseOnScrollToken + 1;
	instance.suppressActivePickerCloseOnScrollToken = token;
	getOwnerWindow(instance.bodyScrollerEl).setTimeout(() => {
		if (instance.suppressActivePickerCloseOnScrollToken === token) {
			instance.suppressActivePickerCloseOnScrollToken = 0;
		}
	}, 160);
}

function getCurrentEmbedTablePreset(instance: EmbedTableInstance, deps: EmbedTableDeps): TablePreset {
	const settings = deps.getSettings();
	const storedPreset = settings.tablePresets.find(preset => preset.id === instance.presetId)
		?? settings.tablePresets[0]
		?? null;
	return resolveTableEditingPreset(storedPreset, instance.currentRenderState?.preset ?? null);
}

function syncEmbedTableSearchStateFromPreset(
	instance: EmbedTableInstance,
	preset: TablePreset,
	options: { force?: boolean } = {},
): void {
	const signature = buildEmbedTablePresetSearchSignature(preset.id, preset.search);
	if (!options.force) {
		if (signature === instance.appliedPresetSearchSignature) {
			if (instance.pendingPresetSearchSignature === signature) {
				instance.pendingPresetSearchSignature = null;
			}
			return;
		}
		if (instance.pendingPresetSearchSignature && signature !== instance.pendingPresetSearchSignature) return;
	}
	const search = cloneTablePresetSearchState(preset.search);
	instance.searchScope = cloneTableSearchBoxScopeState(search.scope);
	instance.parentSearchSelection = search.parent
		? {
			mode: search.parent.mode,
			parentId: search.parent.parentId,
			parentName: search.parent.parentName ?? search.parent.parentId,
		}
		: null;
	instance.parentSearchHighlightedIndex = 0;
	instance.parentSearchDismissed = false;
	instance.appliedPresetSearchSignature = signature;
	if (instance.pendingPresetSearchSignature === signature) {
		instance.pendingPresetSearchSignature = null;
	}
	resetEmbedTableSearchPerformanceState(instance);
}

function buildEmbedTableCurrentPresetSearchState(instance: EmbedTableInstance): TablePresetSearchState {
	return {
		scope: cloneTableSearchBoxScopeState(instance.searchScope),
		parent: instance.parentSearchSelection && instance.parentSearchSelection.mode === instance.searchScope.projectMode
			? { ...instance.parentSearchSelection }
			: null,
	};
}

function saveEmbedTableCurrentPresetSearchState(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	const settings = deps.getSettings();
	const currentPreset = settings.tablePresets.find(preset => preset.id === instance.presetId) ?? null;
	if (!currentPreset) return;
	const search = buildEmbedTableCurrentPresetSearchState(instance);
	const signature = buildEmbedTablePresetSearchSignature(currentPreset.id, search);
	instance.appliedPresetSearchSignature = signature;
	instance.pendingPresetSearchSignature = signature;
	if (instance.currentRenderState?.preset.id === currentPreset.id) {
		instance.currentRenderState = {
			...instance.currentRenderState,
			preset: {
				...cloneTablePreset(instance.currentRenderState.preset),
				search,
			},
		};
	}
	if (!deps.onSavePresetPatch) return;
	deps.onSavePresetPatch({
		id: currentPreset.id,
		search,
	}).then(() => {
		if (instance.pendingPresetSearchSignature === signature) {
			instance.pendingPresetSearchSignature = null;
		}
	}).catch(error => {
		console.error('Operon: failed to save embedded table preset search scope', error);
		recoverEmbedTablePresetSearchStateAfterFailedSave(instance, deps, signature);
		new Notice(t('table', 'presetActionFailed'));
	});
}

function buildEmbedTablePresetSearchSignature(presetId: string, search: TablePresetSearchState): string {
	return `${presetId}:${JSON.stringify(search)}`;
}

function recoverEmbedTablePresetSearchStateAfterFailedSave(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	signature: string,
): void {
	const recovery = resolveTablePresetSearchSaveFailureRecovery(instance.pendingPresetSearchSignature, signature);
	instance.pendingPresetSearchSignature = recovery.pendingPresetSearchSignature;
	if (!recovery.shouldRecover) return;
	const currentPreset = deps.getSettings().tablePresets.find(preset => preset.id === instance.presetId) ?? null;
	if (!currentPreset) return;
	syncEmbedTableSearchStateFromPreset(instance, currentPreset, { force: true });
	if (instance.el.isConnected) {
		renderEmbedTable(instance, deps);
	}
}

async function switchEmbedTablePreset(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	nextPresetId: string,
): Promise<void> {
	if (nextPresetId === instance.presetId) return;
	const nextPreset = deps.getSettings().tablePresets.find(preset => preset.id === nextPresetId) ?? null;
	if (!nextPreset) {
		new Notice(t('table', 'presetActionFailed'));
		return;
	}

	closeEmbedTableActivePicker(instance);
	const updated = await updateEmbedTableSourcePresetId(instance, deps, nextPresetId);
	if (!updated || !instance.el.isConnected) return;
	applyEmbedTablePresetSwitch(instance, nextPreset);
	renderEmbedTable(instance, deps);
}

async function updateEmbedTableSourcePresetId(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	nextPresetId: string,
): Promise<boolean> {
	const sourceContext = resolveCurrentEmbedTableSourceContext(instance);
	if (!sourceContext) {
		new Notice(t('table', 'presetActionFailed'));
		return false;
	}

	const file = deps.app.vault.getAbstractFileByPath(sourceContext.sourcePath);
	if (!(file instanceof TFile)) {
		new Notice(t('table', 'presetActionFailed'));
		return false;
	}

	try {
		await deps.app.vault.process(file, content => {
			const updatedContent = updateTableEmbedPresetIdInMarkdown(content, sourceContext, instance.presetId, nextPresetId);
			if (!updatedContent || updatedContent === content) {
				throw new TableEmbedPresetSourceUpdateSkippedError();
			}
			return updatedContent;
		});
		return true;
	} catch (error) {
		if (error instanceof TableEmbedPresetSourceUpdateSkippedError) {
			new Notice(t('table', 'presetActionFailed'));
			return false;
		}
		console.error('Operon: failed to update embedded table preset reference', error);
		new Notice(t('table', 'presetActionFailed'));
		return false;
	}
}

function resolveCurrentEmbedTableSourceContext(instance: EmbedTableInstance): TableEmbedSourceContext | null {
	const sourceContext = instance.sourceContextResolver?.() ?? null;
	instance.sourceContext = sourceContext;
	return sourceContext;
}

function applyEmbedTablePresetSwitch(instance: EmbedTableInstance, nextPreset: TablePreset): void {
	instance.presetId = nextPreset.id;
	instance.searchQuery = '';
	instance.pendingSearchQuery = null;
	instance.pendingSearchFocus = null;
	instance.parentSearchSelection = null;
	instance.parentSearchHighlightedIndex = 0;
	instance.parentSearchDismissed = false;
	instance.appliedPresetSearchSignature = null;
	instance.pendingPresetSearchSignature = null;
	instance.scrollTop = 0;
	instance.scrollLeft = 0;
	instance.collapsedGroupKeys.clear();
	instance.lastRenderedRangeKey = null;
	resetEmbedTableSearchPerformanceState(instance);
	resetEmbedTableRenderState(instance);
	syncEmbedTableSearchStateFromPreset(instance, nextPreset, { force: true });
}

function buildEmbedTableHeaderPresetPatch(updatedPreset: TablePreset, scope: TableHeaderPresetPatchScope): TablePresetPatch {
	if (scope === 'columns') {
		return {
			id: updatedPreset.id,
			columns: updatedPreset.columns.map(column => ({ ...column })),
		};
	}
	if (scope === 'summaries') {
		return {
			id: updatedPreset.id,
			summaries: updatedPreset.summaries.map(summary => ({ ...summary })),
		};
	}
	return {
		id: updatedPreset.id,
		sortRules: updatedPreset.sortRules.map(rule => ({ ...rule })),
	};
}

function saveEmbedTablePresetPatch(deps: EmbedTableDeps, patch: TablePresetPatch, context: string): void {
	if (!deps.onSavePresetPatch) return;
	deps.onSavePresetPatch(patch).catch(error => {
		console.error(context, error);
		new Notice(t('table', 'presetActionFailed'));
	});
}

function saveEmbedTableGroupSortPresetPatch(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	updatedPreset: TablePreset,
	scope: TableGroupSortPresetPatchScope,
): void {
	if (scope === 'grouping' && updatedPreset.id === instance.presetId) {
		instance.collapsedGroupKeys.clear();
		instance.lastRenderedRangeKey = null;
	}
	saveEmbedTablePresetPatch(
		deps,
		buildTableGroupSortPresetPatch(updatedPreset, scope),
		'Operon: failed to save embedded table group sort preset patch',
	);
}

function saveEmbedTablePresetFromHeader(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	updatedPreset: TablePreset,
	scope: TableHeaderPresetPatchScope,
): void {
	if (updatedPreset.id === instance.presetId) {
		instance.lastRenderedRangeKey = null;
	}
	saveEmbedTablePresetPatch(
		deps,
		buildEmbedTableHeaderPresetPatch(updatedPreset, scope),
		'Operon: failed to save embedded table preset patch',
	);
}

function applyEmbedTableColumnTemplate(instance: EmbedTableInstance, columns: readonly TableColumn[]): void {
	const columnGeometry = applyInteractiveTableColumnTemplate(instance.el, instance.currentRenderState, columns);
	if (instance.currentRenderState) {
		instance.currentRenderState = {
			...instance.currentRenderState,
			tableWidthPx: columnGeometry.tableWidthPx,
			columnGeometry,
		};
	}
	instance.lastRenderedRangeKey = null;
}

function renderEmbedTableVisibleRows(instance: EmbedTableInstance, deps: EmbedTableDeps, force = false): void {
	const startedAt = enginePerfNow();
	if (force && hasActiveEmbedTableMobileInlineEdit(instance)) {
		finishEmbedTableMobileInlineEdit(instance, true);
	}
	const renderState = instance.currentRenderState;
	const scroller = instance.bodyScrollerEl;
	const canvas = instance.bodyCanvasEl;
	if (!renderState || !scroller || !canvas) return;

	const items = renderState.items;
	const viewportHeight = scroller.clientHeight || TABLE_DEFAULT_BODY_HEIGHT;
	const scrollTop = scroller.scrollTop;
	const rowHeight = renderState.rowHeight;
	const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - TABLE_OVERSCAN_ROWS);
	const endIndex = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + TABLE_OVERSCAN_ROWS);
	const rangeKey = [
		startIndex,
		endIndex,
		items.length,
		renderState.columns.length,
		rowHeight,
		renderState.preset.groupBy ?? '',
		renderState.preset.groupOrder,
		renderState.preset.subgroupBy ?? '',
		renderState.preset.subgroupOrder,
		Array.from(instance.collapsedGroupKeys).join('\u0000'),
	].join(':');
	if (rangeKey === instance.lastRenderedRangeKey) return;
	if (!force && shouldDeferEmbedMobileVisibleRows(instance)) {
		instance.pendingMobileTextInputRender = true;
		return;
	}
	instance.lastRenderedRangeKey = rangeKey;
	cleanupOperonHoverTooltips(canvas);
	canvas.empty();
	canvas.style.width = `${renderState.tableWidthPx}px`;
	canvas.style.minWidth = `${renderState.tableWidthPx}px`;
	canvas.style.height = `${items.length * rowHeight}px`;
	canvas.style.setProperty('--operon-table-group-scroll-left', `${instance.bodyScrollerEl?.scrollLeft ?? instance.scrollLeft}px`);
	const columnTemplate = renderState.columnGeometry.columnTemplate;

	for (let index = startIndex; index < endIndex; index++) {
		const item = items[index];
		if (!item) continue;
		if (item.kind === 'group') {
			renderEmbedTableGroupRow(canvas, instance, item.group, item.groupKey, item.depth, index, renderState, deps, item.parentGroup);
		} else if (item.kind === 'summary') {
			renderEmbedTableSummaryRow(canvas, index, columnTemplate, renderState, renderState.summaries, false);
		} else if (item.kind === 'groupSummary') {
			renderEmbedTableSummaryRow(
				canvas,
				index,
				columnTemplate,
				renderState,
				renderState.groupSummaries.get(item.groupKey) ?? new Map<string, TableSummaryCell>(),
				true,
			);
		} else {
			renderEmbedTableTaskRow(canvas, item.task, index, columnTemplate, renderState, deps, renderState.taskOrdinals.get(item.ordinalKey) ?? null);
		}
	}
	enginePerfLog(
		'table.embed.visibleRows',
		`${Math.round(enginePerfNow() - startedAt)}ms`,
		`range=${startIndex}-${endIndex}`,
		`items=${items.length}`,
		`cache=${formatTableValueCacheStats(renderState.valueResolver.getStats())}`,
	);
}

function renderEmbedTableGroupRow(
	canvas: HTMLElement,
	instance: EmbedTableInstance,
	group: TableQueryGroup | TableQuerySubgroup,
	groupKey: string,
	depth: number,
	index: number,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
	parentGroup?: TableQueryGroup,
): void {
	const row = canvas.createDiv('operon-table-group-row');
	row.classList.toggle('is-subgroup', depth > 0);
	row.setAttribute('role', 'row');
	row.setAttribute('aria-rowindex', String(index + 2));
	row.style.width = `${renderState.tableWidthPx}px`;
	row.style.transform = `translateY(${index * renderState.rowHeight}px)`;
	const groupLeadingOffset = renderState.columnGeometry.pinnedBoundaryPx;
	row.style.setProperty('--operon-table-group-leading-offset', `${groupLeadingOffset}px`);
	row.style.setProperty('--operon-table-group-depth', String(depth));
	row.style.setProperty('--operon-table-group-indent', `${depth * 18}px`);
	const collapsed = instance.collapsedGroupKeys.has(groupKey);
	const groupLabel = resolveTableGroupDisplayLabel(group);
	const parentLabel = parentGroup ? resolveTableGroupDisplayLabel(parentGroup) : null;
	const accessibleGroupLabel = parentLabel ? `${parentLabel} > ${groupLabel}` : groupLabel;
	const groupToggleLabel = `${t('table', collapsed ? 'expandGroup' : 'collapseGroup')}: ${accessibleGroupLabel} (${formatTableTaskCount(group.count)})`;
	const button = row.createEl('button', {
		cls: 'operon-table-group-toggle',
		attr: {
			type: 'button',
			'aria-expanded': String(!collapsed),
		},
	});
	setAccessibleLabelWithoutTooltip(button, groupToggleLabel);
	const iconEl = button.createSpan('operon-table-group-icon');
	setIcon(iconEl, collapsed ? 'chevron-right' : 'chevron-down');
	renderEmbedTableGroupLabelContent(button, groupLabel, parentLabel);
	button.createSpan({
		cls: 'operon-table-group-count',
		text: formatTableTaskCount(group.count),
	});
	if (collapsed) {
		renderEmbedTableGroupSummaryHints(button, groupKey, renderState);
	}
	button.addEventListener('click', event => {
		event.preventDefault();
		if (instance.collapsedGroupKeys.has(groupKey)) {
			instance.collapsedGroupKeys.delete(groupKey);
		} else {
			instance.collapsedGroupKeys.add(groupKey);
		}
		instance.lastQuerySignature = null;
		instance.lastRenderSignature = null;
		renderEmbedTable(instance, deps);
	});
}

function renderEmbedTableGroupLabelContent(button: HTMLElement, groupLabel: string, parentLabel: string | null): void {
	if (!parentLabel) {
		button.createSpan({
			cls: 'operon-table-group-label',
			text: groupLabel,
		});
		return;
	}
	button.createSpan({
		cls: 'operon-table-group-parent-label',
		text: truncateTableSubgroupParentLabel(parentLabel),
	});
	const breadcrumbIcon = button.createSpan('operon-table-group-breadcrumb-icon');
	setIcon(breadcrumbIcon, 'chevron-right');
	button.createSpan({
		cls: 'operon-table-group-label',
		text: groupLabel,
	});
}

function renderEmbedTableGroupSummaryHints(
	container: HTMLElement,
	groupKey: string,
	renderState: EmbeddedTableRenderState,
): void {
	const summaries = renderState.groupSummaries.get(groupKey);
	if (!summaries || summaries.size === 0) return;
	const parts: string[] = [];
	for (const column of renderState.columns) {
		const summary = summaries.get(column.key);
		if (!summary?.value.trim()) continue;
		const fieldLabel = column.label?.trim() || getTableTaskFieldLabel(column.key, renderState.settings);
		parts.push(`${fieldLabel} ${t('table', `summary${summary.function}`)} ${summary.value}`);
	}
	if (parts.length === 0) return;
	const visibleParts = parts.slice(0, 3);
	container.createSpan({
		cls: 'operon-table-group-summary-hints',
		text: visibleParts.join(' · ') + (parts.length > visibleParts.length ? ' · ...' : ''),
	});
}

function resolveEmbedTableSearchContext(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	filterSet: ReturnType<typeof resolveTablePresetFilterSet>,
	tasks: IndexedTask[],
	settings: OperonSettings,
): EmbeddedTableSearchContext {
	const filterScopedTasks = resolveTableSearchBaseScopeTasks({
		filterSet,
		tasks,
		priorities: settings.priorities,
		pinnedCache: deps.getPinnedCache(),
	});
	const recentModifiedCutoff = getTaskSearchBoxRecentModifiedCutoff(settings);
	const scopedTasks = filterScopedTasks.filter(task => matchesTaskSearchBoxScope(task, instance.searchScope, { recentModifiedCutoff }));
	const parentSearchUi = buildEmbedTableParentSearchUiState(instance, deps, scopedTasks, filterScopedTasks, settings);
	const taskIdFilter = parentSearchUi?.selectedParentId
		? resolveTableParentSearchVisibleTaskIds(
			parentSearchUi.selectedParentId,
			parentSearchUi.mode,
			scopedTasks,
			getEmbedTableParentSearchResolvers(deps),
		)
		: undefined;
	const scopeFilteredTasks = taskIdFilter
		? scopedTasks.filter(task => taskIdFilter.has(task.operonId))
		: scopedTasks;
	const activeSearchQuery = getTableActiveTextSearchQuery(instance.searchQuery, parentSearchUi);
	return {
		parentSearchUi,
		activeSearchQuery,
		scopedTasks,
		scopeFilteredTasks,
		taskIdFilter,
		scopeKey: buildEmbedTableSearchScopeKey(instance, deps, JSON.stringify(filterSet ?? null), scopedTasks, scopeFilteredTasks, settings, recentModifiedCutoff),
	};
}

function buildEmbedTableSearchScopeKey(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	filterSetSignature: string,
	scopedTasks: readonly IndexedTask[],
	scopeFilteredTasks: readonly IndexedTask[],
	settings: OperonSettings,
	recentModifiedCutoff: number,
): string {
	return [
		deps.indexer.getGeneration(),
		deps.getPinnedCache()?.getGeneration() ?? 0,
		instance.presetId,
		filterSetSignature,
		buildTableRelevantSettingsSignature(settings),
		deps.getProjectSerialSignature?.() ?? '',
		JSON.stringify(instance.searchScope),
		instance.searchScope.showRecentModified ? `recentModifiedCutoff=${recentModifiedCutoff}` : '',
		instance.parentSearchSelection ? `${instance.parentSearchSelection.mode}:${instance.parentSearchSelection.parentId}` : '',
		`scoped=${scopedTasks.length}`,
		`scopeFiltered=${scopeFilteredTasks.length}`,
	].join('|');
}

function resolveEmbedTableSortedSearchBaseRows(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	input: {
		preset: TablePreset;
		filterSet: ReturnType<typeof resolveTablePresetFilterSet>;
		tasks: IndexedTask[];
		settings: OperonSettings;
		searchContext: EmbeddedTableSearchContext;
		columns: readonly TableColumn[];
		cacheKey: string;
	},
): IndexedTask[] {
	if (instance.sortedRowsCache?.key === input.cacheKey) return instance.sortedRowsCache.rows;
	const sortedPreset: TablePreset = {
		...input.preset,
		groupBy: null,
		summaries: [],
	};
	const result = queryTableRows({
		preset: sortedPreset,
		filterSet: input.filterSet,
		tasks: input.tasks,
		priorities: input.settings.priorities,
		pinnedCache: deps.getPinnedCache(),
		settings: input.settings,
		precomputedScopedTasks: input.searchContext.scopedTasks,
		precomputedScopeFilteredTasks: input.searchContext.scopeFilteredTasks,
		summaryMode: 'skip',
		valueResolverOptions: { getProjectSerialDisplay: deps.getProjectSerialDisplay },
	});
	instance.sortedRowsCache = {
		key: input.cacheKey,
		rows: result.rows,
	};
	return result.rows;
}

function resolveEmbedTableIncrementalSearchedTasks(
	instance: EmbedTableInstance,
	scopeFilteredTasks: readonly IndexedTask[],
	normalizedQuery: string,
	searchMatcher: (task: IndexedTask, normalizedQuery: string) => boolean,
	scopeKey: string,
): IndexedTask[] {
	const previous = instance.incrementalSearchCache;
	const canNarrowPrevious = !!previous
		&& previous.scopeKey === scopeKey
		&& previous.query.length > 0
		&& isTableSearchNarrowingSafe(previous.query, normalizedQuery);
	const searchBase = canNarrowPrevious ? previous.rows : scopeFilteredTasks;
	const rows = searchBase.filter(task => searchMatcher(task, normalizedQuery));
	instance.incrementalSearchCache = { scopeKey, query: normalizedQuery, rows };
	return rows;
}

function buildEmbedTableParentSearchUiState(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	scopedTasks: IndexedTask[],
	candidateTasks: IndexedTask[],
	settings: OperonSettings,
): TableParentSearchUiState | null {
	const mode = instance.searchScope.projectMode;
	if (!mode) {
		instance.parentSearchSelection = null;
		return null;
	}
	const trimmedQuery = instance.searchQuery.trim();
	const queryMeetsThreshold = !trimmedQuery || trimmedQuery.length >= TABLE_SEARCH_PARENT_MIN_QUERY_LENGTH;
	const normalizedQuery = queryMeetsThreshold ? trimmedQuery.toLocaleLowerCase() : '';
	const candidates = queryMeetsThreshold
		? buildTableParentSearchCandidates({
			scopedTasks,
			candidateTasks,
			mode,
			normalizedQuery,
			resolvers: getEmbedTableParentSearchResolvers(deps),
			settings,
		})
		: [];
	const retainedSelection = resolveTableParentSearchSelection(instance.parentSearchSelection, mode);
	instance.parentSearchSelection = retainedSelection;
	const selectedParentId = retainedSelection?.parentId ?? null;
	instance.parentSearchHighlightedIndex = Math.min(
		Math.max(instance.parentSearchHighlightedIndex, 0),
		Math.max(0, Math.min(candidates.length, TABLE_PARENT_SEARCH_MAX_CANDIDATES) - 1),
	);
	return {
		mode,
		query: normalizedQuery,
		candidates,
		selectedParentId,
		dropdownVisible: !instance.parentSearchDismissed && !selectedParentId,
	};
}

function getEmbedTableParentSearchResolvers(deps: EmbedTableDeps): ProjectSearchResolvers {
	return {
		getChildIds: parentId => deps.indexer.secondary.getChildIds(parentId),
		getAllDescendantIds: parentId => deps.indexer.secondary.getAllDescendantIds(parentId),
	};
}

function handleEmbedTableSearchInput(
	instance: EmbedTableInstance,
	searchInput: HTMLInputElement,
	deps: EmbedTableDeps,
	immediate: boolean,
): void {
	const shortcutResult = applyTaskSearchBoxShortcutCommand(
		searchInput.value,
		instance.searchScope,
		deps.getSettings(),
		{
			disabledKeys: TABLE_SEARCH_BOX_DISABLED_KEYS,
			preserveTerminalStateScopes: true,
		},
	);
	let nextSearchQuery = searchInput.value;
	if (shortcutResult.handled) {
		nextSearchQuery = shortcutResult.query;
		searchInput.value = nextSearchQuery;
		const previousProjectMode = instance.searchScope.projectMode;
		instance.searchScope = shortcutResult.scope;
		if (previousProjectMode !== instance.searchScope.projectMode) {
			instance.parentSearchSelection = null;
		}
		instance.parentSearchDismissed = false;
		instance.parentSearchHighlightedIndex = 0;
		saveEmbedTableCurrentPresetSearchState(instance, deps);
		immediate = true;
	}
	const currentDisplaySearchQuery = instance.pendingSearchQuery ?? instance.searchQuery;
	if (instance.searchScope.projectMode && nextSearchQuery !== currentDisplaySearchQuery) {
		instance.parentSearchDismissed = false;
	}
	if (instance.searchScope.projectMode !== instance.parentSearchSelection?.mode) {
		instance.parentSearchSelection = null;
	}
	queueEmbedTableSearch(instance, nextSearchQuery, deps, shortcutResult.handled || immediate);
}

function queueEmbedTableSearch(
	instance: EmbedTableInstance,
	rawValue: string,
	deps: EmbedTableDeps,
	forceRender = false,
): void {
	const nextQuery = clampTableSearchQuery(rawValue);
	const currentQueuedQuery = instance.pendingSearchQuery ?? instance.searchQuery;
	if (!forceRender && nextQuery === currentQueuedQuery) return;
	const currentActiveQuery = resolveEmbedTableNormalTextSearchQueryForRender(instance.searchQuery);
	const nextActiveQuery = resolveEmbedTableNormalTextSearchQueryForRender(nextQuery);
	const isClearingActiveSearch = isTableActiveTextSearchClearing(instance.searchQuery, nextQuery);
	const canSkipRender = !forceRender
		&& !instance.searchScope.projectMode
		&& instance.scrollTop === 0
		&& currentActiveQuery === nextActiveQuery;
	cancelEmbedTableSearchDebounce(instance);
	cancelEmbedTableSearchPrewarm(instance);
	if (canSkipRender) {
		instance.pendingSearchQuery = null;
		instance.searchQuery = nextQuery;
		return;
	}
	if (forceRender || isClearingActiveSearch) {
		applyEmbedTableSearchQuery(instance, nextQuery, deps, forceRender);
		return;
	}
	instance.pendingSearchQuery = nextQuery;
	instance.searchDebounceTimer = window.setTimeout(() => {
		instance.searchDebounceTimer = null;
		const queuedQuery = instance.pendingSearchQuery;
		if (queuedQuery === null) return;
		applyEmbedTableSearchQuery(instance, queuedQuery, deps);
	}, TABLE_SEARCH_DEBOUNCE_MS);
}

function applyEmbedTableSearchQuery(
	instance: EmbedTableInstance,
	nextQuery: string,
	deps: EmbedTableDeps,
	forceRender = false,
): void {
	const currentActiveQuery = resolveEmbedTableNormalTextSearchQueryForRender(instance.searchQuery);
	const nextActiveQuery = resolveEmbedTableNormalTextSearchQueryForRender(nextQuery);
	const isClearingActiveSearch = isTableActiveTextSearchClearing(instance.searchQuery, nextQuery);
	const canSkipRender = !forceRender
		&& !instance.searchScope.projectMode
		&& instance.scrollTop === 0
		&& currentActiveQuery === nextActiveQuery;
	instance.pendingSearchQuery = null;
	instance.searchQuery = nextQuery;
	if (canSkipRender) return;
	instance.scrollTop = 0;
	instance.scrollLeft = 0;
	if (instance.horizontalScrollerEl) {
		instance.horizontalScrollerEl.scrollLeft = 0;
	}
	instance.summaryRefreshToken++;
	cancelEmbedTableSummaryIdle(instance);
	instance.deferSummariesForSearch = nextActiveQuery.length > 0 || isClearingActiveSearch;
	if (!instance.deferSummariesForSearch) {
		instance.incrementalSearchCache = null;
	}
	instance.lastQuerySignature = null;
	instance.lastRenderSignature = null;
	if (!instance.el.isConnected) return;
	renderEmbedTable(instance, deps);
}

function resolveEmbedTableNormalTextSearchQueryForRender(rawQuery: string): string {
	return getTableNormalTextSearchQuery(rawQuery);
}

function toggleEmbedTableSearchScopeKey(
	instance: EmbedTableInstance,
	key: TaskFinderDefaultScopeKey,
	deps: EmbedTableDeps,
): void {
	closeEmbedTableActivePicker(instance);
	resetEmbedTableSearchPerformanceState(instance);
	const previousProjectMode = instance.searchScope.projectMode;
	instance.searchScope = toggleTaskSearchBoxScope(instance.searchScope, key, {
		preserveTerminalStateScopes: true,
	});
	if (previousProjectMode !== instance.searchScope.projectMode) {
		instance.parentSearchSelection = null;
	}
	instance.parentSearchDismissed = false;
	instance.parentSearchHighlightedIndex = 0;
	saveEmbedTableCurrentPresetSearchState(instance, deps);
	instance.scrollTop = 0;
	instance.scrollLeft = 0;
	if (instance.horizontalScrollerEl) {
		instance.horizontalScrollerEl.scrollLeft = 0;
	}
	instance.lastQuerySignature = null;
	instance.lastRenderSignature = null;
	renderEmbedTable(instance, deps);
}

function clearEmbedTableSearchState(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	resetEmbedTableSearchPerformanceState(instance, { preserveNoSearchResultCache: true, preserveSortedRowsCache: true });
	instance.searchScope = cloneTableSearchBoxScopeState(TABLE_SEARCH_BOX_DEFAULT_SCOPE);
	instance.parentSearchSelection = null;
	instance.parentSearchHighlightedIndex = 0;
	instance.parentSearchDismissed = false;
	saveEmbedTableCurrentPresetSearchState(instance, deps);
	queueEmbedTableSearch(instance, '', deps, true);
}

function clearEmbedTableParentSearchState(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	resetEmbedTableSearchPerformanceState(instance);
	instance.searchScope = {
		...instance.searchScope,
		projectMode: null,
	};
	instance.parentSearchSelection = null;
	instance.parentSearchHighlightedIndex = 0;
	instance.parentSearchDismissed = false;
	saveEmbedTableCurrentPresetSearchState(instance, deps);
	instance.scrollTop = 0;
	instance.scrollLeft = 0;
	if (instance.horizontalScrollerEl) {
		instance.horizontalScrollerEl.scrollLeft = 0;
	}
	if (instance.bodyScrollerEl) {
		instance.bodyScrollerEl.scrollTop = 0;
	}
	instance.lastQuerySignature = null;
	instance.lastRenderSignature = null;
	renderEmbedTable(instance, deps);
}

function selectEmbedTableParentSearchCandidate(
	instance: EmbedTableInstance,
	mode: ProjectSearchMode,
	candidate: ProjectSearchCandidate,
	deps: EmbedTableDeps,
): void {
	resetEmbedTableSearchPerformanceState(instance);
	instance.parentSearchSelection = {
		mode,
		parentId: candidate.task.operonId,
		parentName: candidate.task.description,
	};
	instance.parentSearchDismissed = true;
	instance.parentSearchHighlightedIndex = 0;
	saveEmbedTableCurrentPresetSearchState(instance, deps);
	queueEmbedTableSearch(instance, '', deps, true);
	focusEmbedTableSearchInput(instance);
}

function updateEmbedTableParentSearchHighlight(instance: EmbedTableInstance, nextIndex: number): void {
	instance.parentSearchHighlightedIndex = updateSearchParentHighlight({
		root: instance.el,
		itemSelector: '.operon-table-parent-search-item',
		currentIndex: instance.parentSearchHighlightedIndex,
		nextIndex,
	});
}

function focusEmbedTableSearchInput(instance: EmbedTableInstance): void {
	const input = instance.el.querySelector<HTMLInputElement>('.operon-table-search-input');
	const fallbackPosition = input?.value.length ?? (instance.pendingSearchQuery ?? instance.searchQuery).length;
	instance.pendingSearchFocus = {
		start: input?.selectionStart ?? fallbackPosition,
		end: input?.selectionEnd ?? fallbackPosition,
	};
	window.requestAnimationFrame(() => {
		restoreEmbedTableSearchFocus(instance, input, true, null, null);
	});
}

function cancelEmbedTableSearchDebounce(instance: EmbedTableInstance): void {
	instance.pendingSearchQuery = null;
	if (instance.searchDebounceTimer === null) return;
	window.clearTimeout(instance.searchDebounceTimer);
	instance.searchDebounceTimer = null;
}

function cancelEmbedTableSummaryIdle(instance: EmbedTableInstance): void {
	if (instance.summaryIdleTimer === null) return;
	window.clearTimeout(instance.summaryIdleTimer);
	instance.summaryIdleTimer = null;
}

function cancelEmbedTableSearchPrewarm(instance: EmbedTableInstance): void {
	if (instance.searchPrewarmTimer !== null) {
		window.clearTimeout(instance.searchPrewarmTimer);
		instance.searchPrewarmTimer = null;
	}
	if (instance.searchPrewarmChunkTimer !== null) {
		window.clearTimeout(instance.searchPrewarmChunkTimer);
		instance.searchPrewarmChunkTimer = null;
	}
	instance.searchPrewarmKey = null;
	instance.searchPrewarmIndex = 0;
}

function resetEmbedTableSearchPerformanceState(
	instance: EmbedTableInstance,
	options: { preserveNoSearchResultCache?: boolean; preserveSortedRowsCache?: boolean } = {},
): void {
	cancelEmbedTableSearchDebounce(instance);
	instance.incrementalSearchCache = null;
	if (!options.preserveSortedRowsCache) {
		instance.sortedRowsCache = null;
	}
	if (!options.preserveNoSearchResultCache) {
		instance.noSearchResultCache = null;
	}
	instance.completedSearchPrewarmKey = null;
	cancelEmbedTableSearchPrewarm(instance);
	instance.deferSummariesForSearch = false;
	instance.summaryRefreshToken++;
	cancelEmbedTableSummaryIdle(instance);
}

function scheduleEmbedTableSearchPrewarm(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	tasks: readonly IndexedTask[],
	tasksToPrewarm: readonly IndexedTask[],
	settings: OperonSettings,
	columns: readonly TableColumn[],
	normalizedSearchQuery: string,
): void {
	if (normalizedSearchQuery.length > 0 || tasks.length === 0 || tasksToPrewarm.length === 0 || columns.length === 0) {
		cancelEmbedTableSearchPrewarm(instance);
		return;
	}
	if (!instance.el.isConnected || instance.el.offsetParent === null) {
		cancelEmbedTableSearchPrewarm(instance);
		return;
	}
	const generation = deps.indexer.getGeneration();
	const projectSerialSignature = deps.getProjectSerialSignature?.() ?? '';
	const prewarmKey = buildTableTaskSearchMatcherSignature(tasks, settings, generation, columns, projectSerialSignature);
	if (instance.completedSearchPrewarmKey === prewarmKey || instance.searchPrewarmKey === prewarmKey) return;
	cancelEmbedTableSearchPrewarm(instance);
	instance.searchPrewarmKey = prewarmKey;
	instance.searchPrewarmIndex = 0;
	instance.searchPrewarmTimer = window.setTimeout(() => {
		instance.searchPrewarmTimer = null;
		runEmbedTableSearchPrewarmChunk(instance, deps, prewarmKey, tasks, tasksToPrewarm, settings, generation, columns);
	}, TABLE_SEARCH_PREWARM_DELAY_MS);
}

function runEmbedTableSearchPrewarmChunk(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	prewarmKey: string,
	tasks: readonly IndexedTask[],
	tasksToPrewarm: readonly IndexedTask[],
	settings: OperonSettings,
	generation: number | string,
	columns: readonly TableColumn[],
): void {
	if (instance.searchPrewarmKey !== prewarmKey) return;
	if (!instance.el.isConnected || instance.el.offsetParent === null || deps.indexer.getGeneration() !== generation) {
		cancelEmbedTableSearchPrewarm(instance);
		return;
	}
	if (resolveEmbedTableNormalTextSearchQueryForRender(instance.searchQuery).length > 0) {
		cancelEmbedTableSearchPrewarm(instance);
		return;
	}
	const startedAt = enginePerfNow();
	const result = instance.searchMatcherCache.prewarm({
		tasks,
		settings,
		generation,
		columns,
		valueResolverOptions: { getProjectSerialDisplay: deps.getProjectSerialDisplay },
		valueResolverSignature: deps.getProjectSerialSignature?.() ?? '',
	}, {
		startIndex: instance.searchPrewarmIndex,
		timeBudgetMs: TABLE_SEARCH_PREWARM_TIME_BUDGET_MS,
		maxTasks: TABLE_SEARCH_PREWARM_MAX_TASKS_PER_CHUNK,
		tasksToWarm: tasksToPrewarm,
	});
	instance.searchPrewarmIndex = result.nextIndex;
	if (result.done) {
		instance.completedSearchPrewarmKey = prewarmKey;
		instance.searchPrewarmKey = null;
		instance.searchPrewarmIndex = 0;
		enginePerfLog(
			'table.embed.search.prewarm',
			`${Math.round(enginePerfNow() - startedAt)}ms`,
			`tasks=${tasksToPrewarm.length}`,
			`status=complete`,
		);
		return;
	}
	instance.searchPrewarmChunkTimer = window.setTimeout(() => {
		instance.searchPrewarmChunkTimer = null;
		runEmbedTableSearchPrewarmChunk(instance, deps, prewarmKey, tasks, tasksToPrewarm, settings, generation, columns);
	}, TABLE_SEARCH_PREWARM_CHUNK_DELAY_MS);
}

function scheduleEmbedTableDeferredSummaryRefresh(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	cancelEmbedTableSummaryIdle(instance);
	const token = ++instance.summaryRefreshToken;
	const delayMs = getTableSummaryIdleDelayMs(instance.currentRenderState?.rows.length ?? 0);
	instance.summaryIdleTimer = window.setTimeout(() => {
		instance.summaryIdleTimer = null;
		const renderState = instance.currentRenderState;
		if (!renderState || !renderState.summariesCalculating || token !== instance.summaryRefreshToken) return;
		const startedAt = enginePerfNow();
		const evaluated = evaluateTableQuerySummaries({
			rows: renderState.rows,
			groups: renderState.groups,
			rules: renderState.preset.summaries,
			allTasks: renderState.allTasks,
			settings: renderState.settings,
			valueResolver: renderState.valueResolver,
		});
		if (token !== instance.summaryRefreshToken) return;
		instance.deferSummariesForSearch = false;
		if (renderState.noSearchResultCacheKey
			&& instance.noSearchResultCache?.key === renderState.noSearchResultCacheKey) {
			instance.noSearchResultCache = {
				key: renderState.noSearchResultCacheKey,
				result: {
					...instance.noSearchResultCache.result,
					summaries: evaluated.summaries,
					groupSummaries: evaluated.groupSummaries,
				},
				summariesEvaluated: true,
			};
		}
		instance.currentRenderState = {
			...renderState,
			summaries: evaluated.summaries,
			groupSummaries: evaluated.groupSummaries,
			summariesCalculating: false,
		};
		instance.lastRenderedRangeKey = null;
		renderEmbedTableVisibleRows(instance, deps, true);
		enginePerfLog(
			'table.embed.summaries.deferred',
			`${Math.round(enginePerfNow() - startedAt)}ms`,
			`rows=${renderState.rows.length}`,
			`groups=${renderState.groups.length}`,
		);
	}, delayMs);
}

function renderEmbedTableTaskRow(
	canvas: HTMLElement,
	task: IndexedTask,
	index: number,
	columnTemplate: string,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
	rowOrdinal: number | null,
): void {
	const row = canvas.createDiv('operon-table-row');
	row.setAttribute('role', 'row');
	row.setAttribute('aria-rowindex', String(index + 2));
	row.style.gridTemplateColumns = columnTemplate;
	row.style.width = `${renderState.tableWidthPx}px`;
	row.style.transform = `translateY(${index * renderState.rowHeight}px)`;
	row.dataset.operonId = task.operonId;
	row.addEventListener('dblclick', () => {
		deps.openTaskEditor(task.operonId);
	});

	for (const [columnIndex, column] of renderState.columns.entries()) {
		renderEmbedTableCell(row, task, column, renderState, columnIndex, deps, rowOrdinal);
	}
}

function renderEmbedTableSummaryRow(
	canvas: HTMLElement,
	index: number,
	columnTemplate: string,
	renderState: EmbeddedTableRenderState,
	summaries: Map<string, TableSummaryCell>,
	isGroupSummary: boolean,
): void {
	const row = canvas.createDiv('operon-table-summary-row');
	row.classList.toggle('operon-table-group-summary-row', isGroupSummary);
	row.classList.toggle('operon-table-total-summary-row', !isGroupSummary);
	row.setAttribute('role', 'row');
	row.setAttribute('aria-rowindex', String(index + 2));
	row.style.gridTemplateColumns = columnTemplate;
	row.style.width = `${renderState.tableWidthPx}px`;
	row.style.transform = `translateY(${index * renderState.rowHeight}px)`;
	for (const [columnIndex, column] of renderState.columns.entries()) {
		const cell = row.createDiv('operon-table-summary-cell');
		cell.setAttribute('role', 'gridcell');
		cell.setAttribute('aria-colindex', String(columnIndex + 1));
		applyTableColumnGeometryClass(cell, renderState.columnGeometry.entries[columnIndex]);
		if (isTableAdminColumn(column)) {
			cell.addClass('operon-table-admin-cell');
			continue;
		}
		applyTableColumnAlignmentClass(cell, column);
		const summary = summaries.get(column.key);
		const fallbackFunction = getEmbedTableConfiguredSummaryFunction(column.key, renderState);
		if (!summary && renderState.summariesCalculating && fallbackFunction) {
			cell.addClass('is-calculating');
			cell.createSpan({
				cls: 'operon-table-summary-label',
				text: t('table', `summary${fallbackFunction}`),
			});
			cell.createSpan({
				cls: 'operon-table-summary-value',
				text: t('table', 'summaryCalculating'),
			});
			continue;
		}
		if (!summary) {
			cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
			continue;
		}
		cell.createSpan({
			cls: 'operon-table-summary-label',
			text: t('table', `summary${summary.function}`),
		});
		if (summary.value.trim()) {
			cell.createSpan({
				cls: 'operon-table-summary-value',
				text: summary.value,
			});
		} else {
			cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
		}
	}
}

function getEmbedTableConfiguredSummaryFunction(
	columnKey: string,
	renderState: EmbeddedTableRenderState,
): TableSummaryFunction | null {
	return renderState.preset.summaries.find(rule => rule.key === columnKey)?.function ?? null;
}

function renderEmbedTableCell(
	row: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	renderState: EmbeddedTableRenderState,
	columnIndex: number,
	deps: EmbedTableDeps,
	rowOrdinal: number | null,
): void {
	const cell = row.createDiv('operon-table-cell');
	cell.setAttribute('role', 'gridcell');
	cell.setAttribute('aria-colindex', String(columnIndex + 1));
	cell.dataset.column = column.key;
	applyTableColumnGeometryClass(cell, renderState.columnGeometry.entries[columnIndex]);
	if (isTableAdminColumn(column)) {
		renderEmbedTableAdminCell(cell, task, column, renderState, deps, rowOrdinal);
		return;
	}
	applyTableColumnAlignmentClass(cell, column);
	const displayValue = renderState.valueResolver.getDisplayValue(task, column.key);

	if (column.key === 'description' || column.key === 'note') {
		renderEmbedTableInlineTextCell(cell, task, column, displayValue, renderState, deps);
		return;
	}
	if (column.key === 'source') {
		renderEmbedTableSourceCell(cell, task, column, displayValue, renderState, deps);
		return;
	}
	if (column.key === 'duration') {
		renderEmbedTableDurationCell(cell, task, column, displayValue, renderState, deps);
		return;
	}
	if (isTableProgressColumnKey(column.key)) {
		renderTableProgressCell(cell, {
			task,
			column,
			settings: renderState.settings,
			valueResolver: renderState.valueResolver,
			iconOnly: shouldUseEmbedTableIconOnlyColumn(column, renderState.settings),
			onActivate: canWriteEmbedTable(deps) && deps.onContextualAction
				? ({ task: progressTask, track, trigger, actionAnchorRect }) => deps.onContextualAction?.(
					progressTask.operonId,
					track.kind === 'subtasks' ? 'subtasks' : 'checkboxes',
					{
						surface: 'tableTask',
						taskId: progressTask.operonId,
						task: progressTask,
						now: localNow(),
						isPinned: deps.isTaskPinned?.(progressTask.operonId) === true,
						hasSubtasks: track.kind === 'subtasks'
							? true
							: deps.hasSubtasks?.(progressTask.operonId) === true,
					},
					{
						actionAnchor: trigger,
						actionAnchorRect,
					},
				)
				: undefined,
		});
		return;
	}
	if (column.key === PROJECT_SERIAL_TABLE_FIELD_KEY && !displayValue.trim()) {
		return;
	}
	const editable = isEditableTableTaskFieldKey(column.key, renderState.settings);
	decorateEmbedTableEditableTaskCell(cell, task, column.key, displayValue, renderState, deps, editable);
	if (shouldUseEmbedTableIconOnlyColumn(column, renderState.settings)) {
		renderEmbedTableIconOnlyCell(cell, task, column, displayValue, renderState, deps, { focusable: !editable });
		return;
	}
	if (!displayValue.trim()) {
		cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
		return;
	}
	const chipClass = editable ? 'operon-table-editable-chip' : 'operon-chip-readonly';
	renderTableCellChips(cell, column.key, displayValue, {
		chipClassName: `operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip ${chipClass}`,
		column,
		task,
		settings: renderState.settings,
		workflowStatusIdentityIndex: renderState.valueResolver.workflowStatusIdentityIndex,
		locationResolver: renderState.locationResolver,
		onLocationPreview: (trigger, visual) => openEmbedTableLocationMapPreview(deps, trigger, task, visual, renderState),
	});
}

function shouldUseEmbedTableIconOnlyColumn(column: TableColumn, settings: Pick<OperonSettings, 'keyMappings'>): boolean {
	return shouldUseTableIconOnlyColumn(column, settings);
}

function renderEmbedTableIconOnlyCell(
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	value: string,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
	options: { focusable?: boolean } = {},
): void {
	if (!value.trim()) return;
	const fieldLabel = getTableTaskFieldLabel(column.key, renderState.settings);
	const locationVisual = resolveTableLocationCellVisual(column.key, value, {
		settings: renderState.settings,
		task,
		locationResolver: renderState.locationResolver,
	});
	const content = locationVisual?.label ?? formatTableIconOnlyTooltipContent(value);
	const fallbackIcon = getTableTaskField(column.key, renderState.settings)?.icon ?? 'text';
	const isTaskIconColumn = column.key === 'taskIcon';
	const isTaskTypeColumn = column.key === 'taskType';
	const icon = renderTableIconOnlyCell(cell, {
		icon: locationVisual?.icon ?? resolveTableIconOnlyCellIcon(
			column.key,
			value,
			resolveTableValueCellIcon(
				column.key,
				value,
				renderState.settings,
				fallbackIcon,
				renderState.valueResolver.workflowStatusIdentityIndex,
			),
		),
		title: fieldLabel,
		content,
		ariaLabel: `${fieldLabel}: ${content}`,
		color: resolveTableIconOnlyCellAccent(column, value, {
			task,
			settings: renderState.settings,
			workflowStatusIdentityIndex: renderState.valueResolver.workflowStatusIdentityIndex,
		}),
		focusable: options.focusable,
		showTooltip: !isTaskIconColumn && !isTaskTypeColumn,
	});
	if (locationVisual) {
		bindEmbedTableLocationMapPreviewTrigger(icon, deps, task, locationVisual, renderState);
	}
	if (isTaskIconColumn && canWriteEmbedTable(deps) && deps.onContextualAction) {
		bindTableTaskContextualHoverMenu(icon, {
			task,
			settings: renderState.settings,
			onContextualAction: deps.onContextualAction,
			isPinned: deps.isTaskPinned,
			hasSubtasks: deps.hasSubtasks,
		});
	}
	if (isTaskTypeColumn) {
		bindTableTaskTypeEditorOpen(icon, {
			task,
			onOpenTaskEditor: deps.openTaskEditor,
			onOpenTaskSource: deps.openTaskSource,
		});
	}
}

function bindEmbedTableLocationMapPreviewTrigger(
	trigger: HTMLElement,
	deps: EmbedTableDeps,
	task: IndexedTask,
	visual: TableLocationCellVisual,
	renderState: EmbeddedTableRenderState,
): void {
	const openPreview = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		openEmbedTableLocationMapPreview(deps, trigger, task, visual, renderState);
	};
	trigger.addEventListener('click', openPreview);
	trigger.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		openPreview(event);
	});
}

function openEmbedTableLocationMapPreview(
	deps: EmbedTableDeps,
	anchor: HTMLElement,
	task: IndexedTask,
	visual: TableLocationCellVisual,
	renderState: EmbeddedTableRenderState,
): void {
	const instance = findEmbedTableInstance(anchor);
	if (instance) {
		closeEmbedTableActivePicker(instance);
	}
	showLocationMapPreview(
		deps.app,
		anchor,
		renderState.settings,
		visual.coordinate,
		task.primary.filePath,
		visual.taskColor,
		visual.markerIcon,
		visual.markerColor,
		visual.path,
		task.description,
	);
}

function renderEmbedTableAdminCell(
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
	rowOrdinal: number | null,
): void {
	cell.addClass('operon-table-admin-cell');
	if (column.key === TABLE_LINE_NUMBER_COLUMN_KEY) {
		cell.addClass('operon-table-line-number-cell');
		cell.createSpan({
			cls: 'operon-table-line-number',
			text: rowOrdinal === null ? '' : String(rowOrdinal),
		});
		return;
	}
	if (column.key === TABLE_TASK_ICON_COLUMN_KEY) {
		const canWrite = canWriteEmbedTable(deps);
		cell.addClass('operon-table-task-icon-cell');
		renderTableTaskIconButton(cell, {
			task,
			settings: renderState.settings,
			workflowStatusIdentityIndex: renderState.valueResolver.workflowStatusIdentityIndex,
			readOnly: !canWrite,
			onStatusIconClick: canWrite ? deps.onStatusIconClick : undefined,
			onContextualAction: canWrite ? deps.onContextualAction : undefined,
			isPinned: deps.isTaskPinned,
			hasSubtasks: deps.hasSubtasks,
		});
		return;
	}
	if (column.key === TABLE_TASK_TYPE_COLUMN_KEY) {
		cell.addClass('operon-table-task-type-cell');
		renderTableTaskTypeButton(cell, {
			task,
			onOpenTaskEditor: deps.openTaskEditor,
			onOpenTaskSource: deps.openTaskSource,
		});
	}
}

function renderEmbedTableDurationCell(
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	value: string,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
): void {
	const sessions = deps.getTaskSessions?.(task.operonId) ?? [];
	const canEditSessions = canWriteEmbedTable(deps) && !!deps.addTaskSession && !!deps.editTaskSession;
	const cellKey = buildTableEditableCellKey(task, 'duration');
	const iconOnly = shouldUseEmbedTableIconOnlyColumn(column, renderState.settings);
	cell.addClass('operon-table-duration-cell');
	if (!canEditSessions) {
		cell.setAttribute('aria-readonly', 'true');
		if (iconOnly) {
			renderEmbedTableIconOnlyCell(cell, task, column, value, renderState, deps);
			return;
		}
		renderEmbedTableDurationFallbackValue(cell, value, renderState);
		return;
	}
	cell.addClass('is-editable');
	cell.dataset.editCellKey = cellKey;
	cell.tabIndex = 0;
	setAccessibleLabelWithoutTooltip(cell, `${getTableTaskFieldLabel('duration', renderState.settings)}. ${t('taskEditor', 'addSession')}`);
	syncEmbedTablePendingCellState(cell, cellKey, findEmbedTableInstance(cell));
	const openAdd = () => {
		const instance = findEmbedTableInstance(cell);
		if (!instance || instance.pendingCellKey !== null) return;
		closeEmbedTableActivePicker(instance);
		openEmbedTableAddTaskSessionModal(instance, deps, cell, task, cellKey);
	};
	cell.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		openAdd();
	});
	cell.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		openAdd();
	});
	if (iconOnly) {
		renderEmbedTableIconOnlyCell(cell, task, column, value, renderState, deps, { focusable: false });
		return;
	}
	if (resolveTableDurationDisplayMode(column) === 'total') {
		renderEmbedTableDurationFallbackValue(cell, value, renderState);
		return;
	}
	if (sessions.length === 0) {
		renderEmbedTableDurationFallbackValue(cell, value, renderState);
	} else {
		const list = cell.createDiv('operon-table-duration-session-list');
		for (const session of sessions) {
			renderEmbedTableDurationSessionChip(list, cell, task, session, cellKey, deps);
		}
	}
}

function renderEmbedTableDurationFallbackValue(
	cell: HTMLElement,
	value: string,
	renderState: EmbeddedTableRenderState,
): void {
	if (!value.trim()) {
		cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
		return;
	}
	const chip = cell.createSpan('operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip operon-chip-readonly');
	chip.setText(value);
}

function renderEmbedTableDurationSessionChip(
	container: HTMLElement,
	cell: HTMLElement,
	task: IndexedTask,
	session: TrackerSession,
	cellKey: string,
	deps: EmbedTableDeps,
): void {
	const chip = container.createEl('button', {
		cls: 'operon-table-duration-session-chip operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip operon-table-editable-chip',
		attr: {
			type: 'button',
		},
	});
	setAccessibleLabelWithoutTooltip(chip, t('taskEditor', 'editSession'));
	chip.setText(formatDurationHuman(session.durationSeconds));
	chip.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		const instance = findEmbedTableInstance(cell);
		if (!instance || instance.pendingCellKey !== null) return;
		closeEmbedTableActivePicker(instance);
		openEmbedTableEditTaskSessionModal(instance, deps, cell, task, session, cellKey);
	});
}

function decorateEmbedTableEditableTaskCell(
	cell: HTMLElement,
	task: IndexedTask,
	key: string,
	value: string,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
	editable: boolean,
): void {
	if (!editable || !canWriteEmbedTable(deps)) {
		cell.setAttribute('aria-readonly', 'true');
		return;
	}
	const instance = findEmbedTableInstance(cell);
	const cellKey = buildTableEditableCellKey(task, key);
	cell.addClass('is-editable');
	cell.dataset.editCellKey = cellKey;
	cell.tabIndex = 0;
	const fieldLabel = getTableTaskFieldLabel(key, renderState.settings);
	const valueLabel = value.trim();
	const editCellLabel = t('table', 'editCellAria');
	setAccessibleLabelWithoutTooltip(
		cell,
		valueLabel ? `${fieldLabel}: ${valueLabel}. ${editCellLabel}` : `${fieldLabel}. ${editCellLabel}`,
	);
	syncEmbedTablePendingCellState(cell, cellKey, instance);
	const openPicker = () => {
		const activeInstance = findEmbedTableInstance(cell);
		if (!activeInstance || activeInstance.pendingCellKey !== null) return;
		closeEmbedTableActivePicker(activeInstance);
		const allTasks = deps.indexer.getAllTasks();
		const closePicker = openTaskFieldPicker({
			app: deps.app,
			settings: renderState.settings,
			allTasks,
			canonicalKey: key,
			anchor: snapshotFloatingRectAnchor(cell),
			currentFieldValues: task.fieldValues,
			currentTags: task.tags,
			currentTaskId: task.operonId,
			excludedTaskIds: getExcludedTablePickerTaskIds(key, task, allTasks),
			sourcePath: task.primary.filePath,
			taskFormat: task.primary.format,
			manualDatePicker: getTableManualDatePickerOptions(key, renderState.settings),
			onCommit: payload => {
				const normalizedPayload = normalizeTablePickerPayload(payload);
				if (Object.keys(normalizedPayload).length === 0) return;
				void commitEmbedTableCellUpdate(activeInstance, deps, cell, task, key, cellKey, normalizedPayload);
			},
			onOpenNote: () => {
				deps.openTaskEditor(task.operonId);
			},
			onClose: () => {
				if (activeInstance.activePickerClose === closePicker) {
					activeInstance.activePickerClose = null;
					activeInstance.keepActivePickerOnRender = false;
				}
			},
		});
		if (!closePicker) return;
		activeInstance.keepActivePickerOnRender = true;
		activeInstance.activePickerClose = closePicker;
	};
	let suppressPointerClick = false;
	let suppressPointerClickToken = 0;
	cell.addEventListener('pointerdown', event => {
		if (event.button !== 0) return;
		suppressPointerClick = true;
		const token = suppressPointerClickToken + 1;
		suppressPointerClickToken = token;
		event.preventDefault();
		event.stopPropagation();
		openPicker();
		getOwnerWindow(cell).setTimeout(() => {
			if (suppressPointerClickToken === token) {
				suppressPointerClick = false;
			}
		}, 2000);
	});
	cell.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		if (suppressPointerClick && event.detail > 0) {
			suppressPointerClick = false;
			suppressPointerClickToken++;
			return;
		}
		suppressPointerClick = false;
		suppressPointerClickToken++;
		openPicker();
	});
	cell.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		openPicker();
	});
}

async function commitEmbedTableCellUpdate(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	cell: HTMLElement,
	task: IndexedTask,
	key: string,
	cellKey: string,
	payload: Record<string, string>,
	options: { showFailureNotice?: boolean } = {},
): Promise<boolean> {
	const showFailureNotice = options.showFailureNotice !== false;
	if (!canWriteEmbedTable(deps)) return false;
	if (instance.pendingCellKey !== null) return false;
	instance.pendingCellKey = cellKey;
	instance.pendingFocusKey = cellKey;
	syncEmbedTablePendingCellState(cell, cellKey, instance);
	closeEmbedTableActivePicker(instance);
	let success = false;
	try {
		const wrote = await deps.updateTaskFields?.(task.operonId, payload);
		if (wrote === false) {
			if (showFailureNotice) new Notice(t('notifications', 'taskSaveFailed'));
		} else {
			success = true;
		}
	} catch (error: unknown) {
		console.error('Operon: failed to update embedded table task cell', {
			operonId: task.operonId,
			key,
			error: error instanceof Error ? error.message : String(error),
		});
		if (showFailureNotice) new Notice(t('notifications', 'taskSaveFailed'));
	} finally {
		if (instance.pendingCellKey === cellKey) {
			instance.pendingCellKey = null;
		}
		clearRenderedEmbedTablePendingCellState(instance, cellKey);
		queueEmbedTablePendingCellFocusRestore(instance);
	}
	return success;
}

function openEmbedTableAddTaskSessionModal(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	cell: HTMLElement,
	task: IndexedTask,
	cellKey: string,
): void {
	new TrackerSessionEditModal(deps.app, {
		title: t('taskEditor', 'addSession'),
		contextTitle: task.description || task.operonId,
		onSave: async (start, end) => {
			await commitEmbedTableSessionCellUpdate(instance, deps, cell, cellKey, async () => {
				const wrote = await deps.addTaskSession?.(task.operonId, start, end);
				return wrote !== false;
			});
		},
	}).open();
}

function openEmbedTableEditTaskSessionModal(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	cell: HTMLElement,
	task: IndexedTask,
	session: TrackerSession,
	cellKey: string,
): void {
	new TrackerSessionEditModal(deps.app, {
		title: t('taskEditor', 'editSession'),
		...buildTrackerSessionEditContext({
			taskLabel: task.description || session.task.description || session.operonId,
			start: session.start,
			end: session.end,
		}),
		initialStart: session.start,
		initialEnd: session.end,
		onSave: async (start, end) => {
			await commitEmbedTableSessionCellUpdate(instance, deps, cell, cellKey, async () => {
				const wrote = await deps.editTaskSession?.(session, start, end);
				return wrote !== false;
			});
		},
		onDelete: deps.deleteTaskSession
			? async () => {
				await commitEmbedTableSessionCellUpdate(instance, deps, cell, cellKey, async () => {
					const deleted = await deps.deleteTaskSession?.(session);
					return deleted !== false;
				});
			}
			: undefined,
	}).open();
}

async function commitEmbedTableSessionCellUpdate(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	cell: HTMLElement,
	cellKey: string,
	operation: () => Promise<boolean>,
): Promise<void> {
	if (!canWriteEmbedTable(deps)) return;
	if (instance.pendingCellKey !== null) return;
	instance.pendingCellKey = cellKey;
	instance.pendingFocusKey = cellKey;
	syncEmbedTablePendingCellState(cell, cellKey, instance);
	try {
		const wrote = await operation();
		if (wrote === false) {
			new Notice(t('notifications', 'taskSaveFailed'));
		}
	} catch (error: unknown) {
		console.error('Operon: failed to update embedded table tracker session', {
			error: error instanceof Error ? error.message : String(error),
		});
		new Notice(t('notifications', 'taskSaveFailed'));
	} finally {
		if (instance.pendingCellKey === cellKey) {
			instance.pendingCellKey = null;
		}
		clearRenderedEmbedTablePendingCellState(instance, cellKey);
		queueEmbedTablePendingCellFocusRestore(instance);
	}
}

function syncEmbedTablePendingCellState(
	cell: HTMLElement,
	cellKey: string,
	instance: EmbedTableInstance | null,
): void {
	const pending = instance?.pendingCellKey === cellKey;
	cell.classList.toggle('is-pending', pending);
	if (pending) {
		cell.setAttribute('aria-busy', 'true');
		cell.setAttribute('aria-disabled', 'true');
		return;
	}
	cell.removeAttribute('aria-busy');
	cell.removeAttribute('aria-disabled');
}

function clearRenderedEmbedTablePendingCellState(instance: EmbedTableInstance, cellKey: string): void {
	for (const cell of Array.from(instance.el.querySelectorAll<HTMLElement>('.operon-table-cell.is-pending'))) {
		if (cell.dataset.editCellKey !== cellKey) continue;
		cell.classList.remove('is-pending');
		cell.removeAttribute('aria-busy');
		cell.removeAttribute('aria-disabled');
	}
}

function restoreEmbedTablePendingCellFocus(instance: EmbedTableInstance): void {
	const cellKey = instance.pendingFocusKey;
	if (!cellKey) return;
	instance.pendingFocusKey = null;
	const cell = Array.from(instance.el.querySelectorAll<HTMLElement>('.operon-table-cell.is-editable'))
		.find(candidate => candidate.dataset.editCellKey === cellKey);
	(cell ?? instance.bodyScrollerEl)?.focus();
}

function queueEmbedTablePendingCellFocusRestore(instance: EmbedTableInstance): void {
	window.requestAnimationFrame(() => {
		restoreEmbedTablePendingCellFocus(instance);
	});
}

function closeEmbedTableActivePicker(instance: EmbedTableInstance): void {
	const close = instance.activePickerClose;
	instance.activePickerClose = null;
	instance.keepActivePickerOnRender = false;
	close?.();
}

function findEmbedTableInstance(element: HTMLElement): EmbedTableInstance | null {
	for (const instance of activeTableEmbeds) {
		if (instance.el.contains(element)) return instance;
	}
	return null;
}

function renderEmbedTableInlineTextCell(
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	value: string,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
): void {
	const key = column.key;
	const editable = isEditableTableTaskFieldKey(key, renderState.settings) && canWriteEmbedTable(deps);
	const instance = findEmbedTableInstance(cell);
	const cellKey = buildTableEditableCellKey(task, key);
	const payloadKey = key === 'description' ? '_description' : key;
	const showIconOnly = shouldUseEmbedTableIconOnlyColumn(column, renderState.settings);
	const canOpenIconOnlyTextPopover = editable && showIconOnly && !!instance;
	if ((editable && !showIconOnly) || canOpenIconOnlyTextPopover) {
		cell.addClass('is-editable');
		cell.dataset.editCellKey = cellKey;
		cell.tabIndex = 0;
		syncEmbedTablePendingCellState(cell, cellKey, instance);
	} else {
		cell.removeClass('is-editable');
		delete cell.dataset.editCellKey;
		cell.removeAttribute('tabindex');
	}
	const fieldLabel = getTableTaskFieldLabel(key, renderState.settings);
	const iconColor = showIconOnly
		? resolveTableColumnCellAccent(column, value, {
			task,
			settings: renderState.settings,
			workflowStatusIdentityIndex: renderState.valueResolver.workflowStatusIdentityIndex,
		})
		: null;
	const iconContent = formatTableIconOnlyTooltipContent(value);
	renderTableDescriptionCellContent(cell, {
		value,
		editable: editable && !showIconOnly,
		fieldLabel,
		editLabel: t('table', 'editCellAria'),
		...(key === 'note' ? { cellClassName: 'operon-table-note-cell' } : {}),
		...(showIconOnly
			? {
				iconOnly: {
					icon: getTableTaskField(key, renderState.settings)?.icon ?? 'text',
					color: iconColor,
					title: fieldLabel,
					content: iconContent,
					ariaLabel: `${fieldLabel}: ${iconContent}`,
				},
			}
			: {}),
		wikilinks: {
			app: deps.app,
			sourcePath: task.primary.filePath,
		},
		onIconOnlyOpen: canOpenIconOnlyTextPopover && instance
			? () => openEmbedTableInlineTextPopover(instance, deps, cell, task, column, value, fieldLabel, cellKey, payloadKey)
			: undefined,
		onCommit: editable && !showIconOnly && instance
			? nextValue => commitEmbedTableCellUpdate(instance, deps, cell, task, key, cellKey, { [payloadKey]: nextValue })
			: undefined,
		...(Platform.isPhone && instance
			? {
				onInlineEditStart: (session: TableInlineEditSession) => beginEmbedTableMobileInlineEdit(instance, session),
				onInlineEditFinish: (session: TableInlineEditSession) => endEmbedTableMobileInlineEdit(instance, session, deps),
			}
			: {}),
	});
}

function openEmbedTableInlineTextPopover(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	value: string,
	fieldLabel: string,
	cellKey: string,
	payloadKey: string,
): void {
	if (instance.pendingCellKey !== null) return;
	closeEmbedTableActivePicker(instance);
	let closeTextPopover: (() => void) | null = null;
	closeTextPopover = showTextFieldPopover({
		app: deps.app,
		anchor: cell,
		title: fieldLabel,
		subtitle: task.description || formatTableTaskSource(task),
		initialValue: value,
		taskColor: normalizeTaskFieldColor(task.fieldValues['taskColor']),
		sessionKey: `embed-table-text:${task.operonId}:${column.key}`,
		normalizeValue: normalizeEmbedTableTextFieldPopoverValue,
		onCommit: async nextValue => {
			if (instance.activePickerClose === closeTextPopover) {
				instance.activePickerClose = null;
			}
				const success = await commitEmbedTableCellUpdate(instance, deps, cell, task, column.key, cellKey, { [payloadKey]: nextValue }, {
					showFailureNotice: false,
				});
			if (success === false && closeTextPopover) {
				instance.activePickerClose = closeTextPopover;
			}
			return success;
		},
		onClose: () => {
			if (instance.activePickerClose === closeTextPopover) {
				instance.activePickerClose = null;
			}
		},
	});
	instance.activePickerClose = closeTextPopover;
}

function renderEmbedTableSourceCell(
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	value: string,
	renderState: EmbeddedTableRenderState,
	deps: EmbedTableDeps,
): void {
	const fullSource = formatTableTaskSource(task);
	if (shouldUseEmbedTableIconOnlyColumn(column, renderState.settings)) {
		cell.addClass('is-editable');
		cell.tabIndex = 0;
		setAccessibleLabelWithoutTooltip(cell, t('table', 'openSource', { source: fullSource }));
		renderEmbedTableIconOnlyCell(cell, task, column, fullSource, renderState, deps, { focusable: false });
		const openSource = (): void => deps.openTaskSource(task.operonId);
		cell.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			openSource();
		});
		cell.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			openSource();
		});
		return;
	}
	const button = cell.createEl('button', {
		cls: 'operon-table-source-button',
		attr: { type: 'button' },
	});
	setAccessibleLabelWithoutTooltip(button, t('table', 'openSource', { source: fullSource }));
	const iconEl = button.createSpan('operon-table-source-icon');
	setIcon(iconEl, task.primary.format === 'inline' ? 'text-cursor-input' : 'file-text');
	button.createSpan({ cls: 'operon-table-source-label', text: value || '--' });
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		deps.openTaskSource(task.operonId);
	});
}

function renderEmbedTableEmptyState(root: HTMLElement, searchEmpty: boolean): void {
	const empty = root.createDiv('operon-table-empty');
	empty.createDiv({
		cls: 'operon-table-empty-title',
		text: t('table', searchEmpty ? 'searchEmptyTitle' : 'emptyTitle'),
	});
	empty.createDiv({
		cls: 'operon-table-empty-description',
		text: t('table', searchEmpty ? 'searchEmptyDescription' : 'emptyDescription'),
	});
}

function scheduleEmbedTableVisibleRowsRender(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	if (instance.visibleRowsFrame !== null) return;
	instance.visibleRowsFrame = window.requestAnimationFrame(() => {
		instance.visibleRowsFrame = null;
		renderEmbedTableVisibleRows(instance, deps);
	});
}

function hasActiveEmbedTableMobileInlineEdit(instance: EmbedTableInstance): boolean {
	return Platform.isPhone && instance.activeMobileInlineEdit !== null;
}

function shouldDeferEmbedMobileVisibleRows(instance: EmbedTableInstance): boolean {
	return hasActiveEmbedTableMobileInlineEdit(instance)
		|| isMobileTableTextInputFocused(instance.el);
}

function beginEmbedTableMobileInlineEdit(instance: EmbedTableInstance, session: TableInlineEditSession): void {
	if (!Platform.isPhone) return;
	finishEmbedTableMobileInlineEdit(instance, true);
	instance.activeMobileInlineEdit = session;
	instance.pendingSearchFocus = null;
}

function endEmbedTableMobileInlineEdit(
	instance: EmbedTableInstance,
	session: TableInlineEditSession,
	deps: EmbedTableDeps,
): void {
	if (instance.activeMobileInlineEdit !== session) return;
	instance.activeMobileInlineEdit = null;
	flushEmbedMobileDeferredVisibleRows(instance, deps);
}

function finishEmbedTableMobileInlineEdit(instance: EmbedTableInstance, commit: boolean): void {
	const session = instance.activeMobileInlineEdit;
	if (!session) return;
	session.finish(commit);
}

function bindEmbedMobileViewport(instance: EmbedTableInstance, deps: EmbedTableDeps, root: HTMLElement): void {
	cleanupEmbedMobileViewport(instance);
	instance.mobileViewportCleanup = bindMobileTableViewport(root, () => {
		if (!instance.el.isConnected || instance.el.offsetParent === null) return;
		instance.lastRenderedRangeKey = null;
		if (shouldDeferEmbedMobileVisibleRows(instance)) {
			instance.pendingMobileTextInputRender = true;
			return;
		}
		flushEmbedMobileDeferredVisibleRows(instance, deps);
		scheduleEmbedTableVisibleRowsRender(instance, deps);
	});
}

function cleanupEmbedMobileViewport(instance: EmbedTableInstance): void {
	instance.mobileViewportCleanup?.();
	instance.mobileViewportCleanup = null;
}

function flushEmbedMobileDeferredVisibleRows(instance: EmbedTableInstance, deps: EmbedTableDeps): void {
	if (shouldDeferEmbedMobileVisibleRows(instance)) return;
	const shouldRender = instance.pendingMobileTextInputRender
		&& !!instance.bodyCanvasEl?.isConnected
		&& instance.el.isConnected;
	instance.pendingMobileTextInputRender = false;
	if (!shouldRender) return;
	instance.lastRenderedRangeKey = null;
	scheduleEmbedTableVisibleRowsRender(instance, deps);
}

function updateEmbedTableToolbarHeight(root: HTMLElement, toolbar: HTMLElement): void {
	const toolbarRectHeight = toolbar.getBoundingClientRect().height;
	const toolbarHeight = Math.ceil(toolbarRectHeight || toolbar.offsetHeight || 44);
	root.style.setProperty('--operon-table-embed-toolbar-height', `${toolbarHeight}px`);
}

function observeEmbedTableBodyResize(
	instance: EmbedTableInstance,
	deps: EmbedTableDeps,
	root: HTMLElement,
	shell: HTMLElement,
	bodyScroller: HTMLElement,
	toolbar: HTMLElement,
): void {
	cleanupEmbedTableResizeObserver(instance);
	const ownerWindow = getOwnerWindow(bodyScroller) as unknown as { ResizeObserver?: EmbedTableResizeObserverConstructor };
	const ResizeObserverCtor = ownerWindow.ResizeObserver;
	if (!ResizeObserverCtor) return;
	const observer = new ResizeObserverCtor(() => {
		updateEmbedTableToolbarHeight(root, toolbar);
		instance.lastRenderedRangeKey = null;
		scheduleEmbedTableVisibleRowsRender(instance, deps);
	});
	observer.observe(toolbar);
	observer.observe(shell);
	observer.observe(bodyScroller);
	instance.resizeObserverCleanup = () => {
		observer.disconnect();
	};
}

function cleanupEmbedTableResizeObserver(instance: EmbedTableInstance): void {
	instance.resizeObserverCleanup?.();
	instance.resizeObserverCleanup = null;
}

function restoreEmbedTableSearchFocus(
	instance: EmbedTableInstance,
	input: HTMLInputElement | null | undefined,
	shouldRestore: boolean,
	selectionStart: number | null,
	selectionEnd: number | null,
): void {
	if (hasActiveEmbedTableMobileInlineEdit(instance)) {
		instance.pendingSearchFocus = null;
		return;
	}
	const pending = instance.pendingSearchFocus;
	if (!shouldRestore && !pending) return;
	const searchInput = input?.isConnected
		? input
		: instance.el.querySelector<HTMLInputElement>('.operon-table-search-input');
	if (!searchInput) return;
	const start = pending?.start ?? selectionStart;
	const end = pending?.end ?? selectionEnd;
	instance.pendingSearchFocus = null;
	searchInput.focus({ preventScroll: true });
	if (start === null || end === null) return;
	try {
		searchInput.setSelectionRange(start, end);
	} catch {
		// Search focus is enough when a browser/theme rejects selection restoration.
	}
}

function normalizeEmbedTableTextFieldPopoverValue(value: string): string {
	return value.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(Boolean)
		.join(' ')
		.trim();
}

function closeEmbedTableTransientUi(root: HTMLElement): void {
	const input = root.querySelector<HTMLInputElement>('.operon-table-search-input');
	if (input && root.ownerDocument.activeElement === input) {
		input.blur();
	}
	closeFloatingPanelsForRoot(root);
	closeIconOnlyChipPreviewsForRoot(root);
}

function renderTableEmbedError(el: HTMLElement, message: string): void {
	el.empty();
	const root = el.createDiv('operon-table-embed-error');
	const iconEl = root.createSpan('operon-table-title-icon');
	setIcon(iconEl, 'triangle-alert');
	root.createSpan({ text: message });
}
