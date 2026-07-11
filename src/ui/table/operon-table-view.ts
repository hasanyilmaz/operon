import { ItemView, Notice, Platform, WorkspaceLeaf, setIcon } from 'obsidian';
import type { OperonIndexer } from '../../indexer/indexer';
import type { PinnedCache } from '../../storage/pinned-cache';
import type { ProjectSerialDisplay } from '../../core/project-serials';
import type { IndexedTask } from '../../types/fields';
import { cloneFilterSet, type FilterSet, type OperonSettings } from '../../types/settings';
import type { TaskFinderDefaultScopeKey } from '../../types/settings';
import type { TrackerSession } from '../../types/tracker';
import {
	OPERON_TABLE_VIEW_TYPE,
	TABLE_LINE_NUMBER_COLUMN_KEY,
	TABLE_TASK_ICON_COLUMN_KEY,
	TABLE_TASK_TYPE_COLUMN_KEY,
	type TableColumn,
	type TableLeafState,
	type TablePreset,
	type TablePresetPatch,
	type TablePresetSearchState,
	type TableSummaryFunction,
	createDefaultTablePreset,
	cloneTablePreset,
	cloneTablePresetSearchState,
	resolveTablePresetFilterSet,
	resolveTableDurationDisplayMode,
} from '../../types/table';
import { evaluateTableQuerySummaries, queryTableRows, type TableQueryGroup, type TableQueryResult, type TableQuerySubgroup } from '../../systems/table-query';
import { filterTasksForCalendar } from '../../systems/calendar-filter-materialization';
import { t } from '../../core/i18n';
import { localNow } from '../../core/local-time';
import { normalizeTaskFieldColor } from '../../core/task-color-source';
import { PROJECT_SERIAL_TABLE_FIELD_KEY, buildTableTaskFieldCatalog, getTableTaskField, getTableTaskFieldLabel, isEditableTableTaskFieldKey } from './table-field-catalog';
import {
	formatTableTaskSource,
} from './table-value-adapter';
import { renderTableCellChips } from './table-cell-chip';
import { resolveTableColumnCellAccent, resolveTableIconOnlyCellAccent } from './table-column-color';
import { renderTableDescriptionCellContent, type TableInlineEditSession } from './table-description-cell';
import { bindMobileTableViewport, isMobileTableTextInputFocused } from './mobile-table-viewport';
import { formatTableValueCacheStats, type TableValueResolver } from './table-value-cache';
import {
	TABLE_DEFAULT_BODY_HEIGHT,
	TABLE_OVERSCAN_ROWS,
	applyTableColumnAlignmentClass,
	applyTableColumnGeometryClass,
	buildTableColumnGeometry,
	buildTableColumnTemplate,
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
} from './table-surface';
import {
	buildTableGroupSortPresetPatch,
	clearTablePresetSummary,
	resolveTableEditingPreset,
	setTablePresetSummary,
	type TableGroupSortPresetPatchScope,
} from './table-preset-model';
import {
	TABLE_SEARCH_PREWARM_CHUNK_DELAY_MS,
	TABLE_SEARCH_PREWARM_DELAY_MS,
	TABLE_SEARCH_PREWARM_MAX_TASKS_PER_CHUNK,
	TABLE_SEARCH_PREWARM_TIME_BUDGET_MS,
	TABLE_SEARCH_DEBOUNCE_MS,
	buildTableNoSearchResultCacheKey,
	buildTableSearchCacheScopeKey,
	buildTableSearchVisibleColumnSignature,
	buildTableTaskSearchMatcherSignature,
	createTableTaskSearchMatcherCache,
	isTableSearchNarrowingSafe,
} from './table-search';
import { buildTableRelevantSettingsSignature } from './table-signature';
import { bindTableActiveCellHighlight } from './table-active-cell-highlight';
import { isTableProgressColumnKey, renderTableProgressCell } from './table-progress-cell';
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
	renderTableSearchQuickScopeButtons,
	renderTableSearchScopePopover,
	resolveTableSearchBaseScopeTasks,
	resolveTableParentSearchSelection,
	resolveTableParentSearchVisibleTaskIds,
	syncTableSearchWrapClasses,
	type TableParentSearchSelection,
	type TableParentSearchUiState,
} from './table-search-scope';
import { getTableSummaryIdleDelayMs, type TableSummaryCell } from './table-summary';
import { showTableSummaryPicker } from './table-summary-picker';
import {
	getExcludedTablePickerTaskIds,
	getTableManualDatePickerOptions,
	normalizeTablePickerPayload,
} from './table-editing';
import { openTaskFieldPicker } from '../task-field-picker-dispatch';
import { showTextFieldPopover } from '../text-field-popover';
import { buildTrackerSessionEditContext, TrackerSessionEditModal } from '../tracker-session-edit-modal';
import { formatDurationHuman } from '../../systems/tracker-utils';
import { getOwnerDocument, getOwnerWindow } from '../../core/dom-compat';
import type { ContextualMenuActionHandler } from '../../core/contextual-menu-engine';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { snapshotFloatingRectAnchor } from '../field-pickers/common';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { FilterSetModal } from '../filter-set-modal';
import { bindTableTaskContextualHoverMenu, renderTableTaskIconButton } from './table-task-icon-button';
import { bindTableTaskTypeEditorOpen, renderTableTaskTypeButton } from './table-task-type-button';
import {
	formatTableIconOnlyTooltipContent,
	renderTableIconOnlyCell,
	resolveTableIconOnlyCellIcon,
	resolveTableValueCellIcon,
} from './table-icon-only-cell';
import { showTableExportMenu } from './table-export-menu';
import { showTableGroupSortPopover } from './table-group-sort-popover';
import { getTablePresetPickerLabel, showTablePresetPicker } from './table-preset-picker';
import {
	applyInteractiveTableColumnTemplate,
	cleanupTableHeaderActiveResize,
	createTableHeaderInteractionState,
	renderInteractiveTableHeaderCell,
	shouldUseTableIconOnlyColumn,
	type TableHeaderInteractionState,
	type TableHeaderPresetPatchScope,
} from './table-header-interactions';
import { renderRelatedViewsLauncher } from '../related-views';
import type { RelatedViewCreateTarget, RelatedViewOpenTarget } from '../../types/related-views';
import {
	applyTaskSearchBoxShortcutCommand,
	getTaskSearchBoxRecentModifiedCutoff,
	matchesTaskSearchBoxScope,
	toggleTaskSearchBoxScope,
	type TaskSearchBoxScopeState,
} from '../task-search-box-integration';
import { updateSearchParentHighlight } from '../search-scope-controls';
import type { ProjectSearchCandidate, ProjectSearchMode } from '../../systems/task-search';
import { enginePerfLog, enginePerfNow } from '../../core/engine-perf';
import {
	buildTableLocationCellIndexSignature,
	getTableLocationCellResolver,
	resolveTableLocationCellVisual,
	type TableLocationCellResolver,
	type TableLocationCellVisual,
} from './table-location-cell';
import { showLocationMapPreview } from '../location-map-preview';
import { resolveTablePresetSearchSaveFailureRecovery } from './table-preset-search-recovery';

interface OperonTableCallbacks {
	onOpenTaskSource?: (operonId: string) => void;
	onOpenTaskEditor?: (operonId: string) => void;
	onOpenPresetSettings?: (presetId: string) => void;
	onSavePresetPatch?: (patch: TablePresetPatch) => Promise<void>;
	onSaveFilterSet?: (filterSet: FilterSet) => Promise<void>;
	onUpdateTaskFields?: (operonId: string, payload: Record<string, string>) => void | Promise<boolean>;
	getTaskSessions?: (operonId: string) => readonly TrackerSession[];
	onAddTaskSession?: (operonId: string, start: string, end: string) => void | Promise<boolean>;
	onEditTaskSession?: (session: TrackerSession, start: string, end: string) => void | Promise<boolean>;
	onDeleteTaskSession?: (session: TrackerSession) => void | Promise<boolean>;
	onStatusIconClick?: (taskId: string) => void | Promise<void>;
	onContextualAction?: ContextualMenuActionHandler;
	onOpenRelatedView?: (target: RelatedViewOpenTarget) => void | Promise<void>;
	onCreateRelatedView?: (target: RelatedViewCreateTarget) => void | Promise<void>;
	getProjectSerialDisplay?: (operonId: string, task?: IndexedTask) => ProjectSerialDisplay | null;
	getProjectSerialSignature?: () => string;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
}

interface TableRenderState {
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
	scopedTaskCount: number;
	searchedTaskCount: number;
	settings: OperonSettings;
	allTasks: IndexedTask[];
	valueResolver: TableValueResolver;
	locationResolver: TableLocationCellResolver | null;
	locationIndexSignature: string;
	rowHeight: number;
	tableWidthPx: number;
	columnGeometry: TableColumnGeometry;
	scrollbarGutterPx: number;
	normalizedSearchQuery: string;
	searchControlSignature: string;
	shellReuseSignature: string;
	noSearchResultCacheKey: string | null;
}

interface TableResizeObserverLike {
	observe(target: Element): void;
	disconnect(): void;
}

type TableResizeObserverConstructor = new (callback: () => void) => TableResizeObserverLike;

interface TableSearchContext {
	parentSearchUi: TableParentSearchUiState | null;
	activeSearchQuery: string;
	scopedTasks: IndexedTask[];
	scopeFilteredTasks: IndexedTask[];
	taskIdFilter?: Set<string>;
	scopeKey: string;
}

interface TableIncrementalSearchCache {
	scopeKey: string;
	query: string;
	rows: IndexedTask[];
}

interface TableSortedRowsCache {
	key: string;
	rows: IndexedTask[];
}

interface TableNoSearchResultCache {
	key: string;
	result: TableQueryResult;
	summariesEvaluated: boolean;
}

function generateTableFilterSetId(): string {
	return 'fs_' + Math.random().toString(36).slice(2, 9);
}

function generateTableFilterGroupId(): string {
	return 'fg_' + Math.random().toString(36).slice(2, 10);
}

function generateTableFilterPopoverId(): string {
	return 'operon-table-filter-popover-' + Math.random().toString(36).slice(2, 10);
}

function createEmptyTableFilterSet(name: string): FilterSet {
	return {
		id: generateTableFilterSetId(),
		name,
		icon: 'filter',
		rootGroup: {
			id: generateTableFilterGroupId(),
			logic: 'all',
			children: [],
		},
		sorts: [],
		matchLogic: 'all',
		conditions: [],
	};
}

export class OperonTableView extends ItemView {
	private state: TableLeafState = {
		presetId: null,
		searchQuery: '',
		scrollTop: 0,
		scrollLeft: 0,
		collapsedGroupKeys: [],
	};
	private renderFrame: number | null = null;
	private visibleRowsFrame: number | null = null;
	private horizontalScrollerEl: HTMLElement | null = null;
	private bodyScrollerEl: HTMLElement | null = null;
	private bodyCanvasEl: HTMLElement | null = null;
	private currentRenderState: TableRenderState | null = null;
	private lastRenderedRangeKey: string | null = null;
	private persistStateTimer: number | null = null;
	private searchDebounceTimer: number | null = null;
	private tableResizeObserverCleanup: (() => void) | null = null;
	private activePickerClose: (() => void) | null = null;
	private keepActivePickerOnRender = false;
	private suppressActivePickerCloseOnScrollToken = 0;
	private readonly headerInteractionState: TableHeaderInteractionState = createTableHeaderInteractionState();
	private pendingCellKey: string | null = null;
	private pendingFocusKey: string | null = null;
	private pendingSearchFocus: { start: number; end: number } | null = null;
	private activeMobileInlineEdit: TableInlineEditSession | null = null;
	private pendingMobileTextInputRender = false;
	private mobileViewportCleanup: (() => void) | null = null;
	private mobileScrollGestureUntil = 0;
	private lastGroupStateKey: string | null = null;
	private isSearchComposing = false;
	private searchScope: TaskSearchBoxScopeState = cloneTableSearchBoxScopeState(TABLE_SEARCH_BOX_DEFAULT_SCOPE);
	private parentSearchSelection: TableParentSearchSelection | null = null;
	private parentSearchHighlightedIndex = 0;
	private parentSearchDismissed = false;
	private appliedPresetSearchSignature: string | null = null;
	private pendingPresetSearchSignature: string | null = null;
	private readonly searchMatcherCache = createTableTaskSearchMatcherCache();
	private incrementalSearchCache: TableIncrementalSearchCache | null = null;
	private sortedRowsCache: TableSortedRowsCache | null = null;
	private noSearchResultCache: TableNoSearchResultCache | null = null;
	private searchPrewarmTimer: number | null = null;
	private searchPrewarmChunkTimer: number | null = null;
	private searchPrewarmKey: string | null = null;
	private completedSearchPrewarmKey: string | null = null;
	private searchPrewarmIndex = 0;
	private lastRenderedSearchActive = false;
	private deferSummariesForSearch = false;
	private summaryIdleTimer: number | null = null;
	private summaryRefreshToken = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly indexer: OperonIndexer,
		private readonly getSettings: () => OperonSettings,
		private readonly getPinnedCache: () => PinnedCache | null,
		private readonly callbacks: OperonTableCallbacks = {},
	) {
		super(leaf);
	}

	getViewType(): string {
		return OPERON_TABLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.getCurrentPreset()?.name ?? t('table', 'title');
	}

	getIcon(): string {
		return 'table-2';
	}

	getState(): Record<string, unknown> {
		return {
			...this.ensureState(),
			scrollTop: this.bodyScrollerEl?.scrollTop ?? this.state.scrollTop,
			scrollLeft: this.horizontalScrollerEl?.scrollLeft ?? this.state.scrollLeft,
		};
	}

	async setState(state: Partial<TableLeafState> | null | undefined, _result: unknown): Promise<void> {
		const previousPresetId = this.state.presetId;
		const nextState = this.normalizeState(state);
		const changed = !areTableLeafStatesEqual(this.state, nextState);
		this.state = nextState;
		if (previousPresetId !== nextState.presetId) {
			this.syncTableSearchStateFromPreset(this.getCurrentPreset(), { force: true });
		}
		this.syncLeafTitle();
		if (changed && this.containerEl.isConnected) {
			this.markDirty();
		}
	}

	async onOpen(): Promise<void> {
		this.state = this.ensureState();
		this.syncTableSearchStateFromPreset(this.getCurrentPreset(), { force: true });
		this.syncLeafTitle();
		this.registerEvent(this.app.workspace.on('css-change', () => { this.markDirty(); }));
		this.registerDomEvent(window, 'resize', () => {
			this.closeActivePicker();
			this.scheduleVisibleRowsRender();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		this.closeActivePicker();
		this.pendingMobileTextInputRender = false;
		this.mobileScrollGestureUntil = 0;
		this.finishMobileInlineEdit(false);
		this.activeMobileInlineEdit = null;
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}
		if (this.visibleRowsFrame !== null) {
			window.cancelAnimationFrame(this.visibleRowsFrame);
			this.visibleRowsFrame = null;
		}
		if (this.persistStateTimer !== null) {
			window.clearTimeout(this.persistStateTimer);
			this.persistStateTimer = null;
		}
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = null;
		}
		if (this.summaryIdleTimer !== null) {
			window.clearTimeout(this.summaryIdleTimer);
			this.summaryIdleTimer = null;
		}
		this.cancelSearchPrewarm();
		this.cleanupActiveResize();
		this.cleanupTableResizeObserver();
		this.cleanupMobileViewport();
		this.searchMatcherCache.clear();
		this.incrementalSearchCache = null;
		this.noSearchResultCache = null;
		this.horizontalScrollerEl = null;
		this.bodyScrollerEl = null;
		this.bodyCanvasEl = null;
		this.currentRenderState = null;
		this.lastRenderedRangeKey = null;
		this.lastGroupStateKey = null;
		cleanupOperonHoverTooltips(this.contentEl);
		this.contentEl.empty();
	}

	markDirty(): void {
		this.scheduleRender();
	}

	renderIfVisibleOrInvalidate(): void {
		if (!this.containerEl.isConnected || this.containerEl.offsetParent === null) {
			this.closeActivePicker();
			this.cleanupActiveResize();
			this.currentRenderState = null;
			return;
		}
		this.render();
	}

	render(): void {
		this.finishMobileInlineEdit(true);
		if (!this.keepActivePickerOnRender) {
			this.closeActivePicker();
		}
		const renderStartedAt = enginePerfNow();
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}
		this.state = this.ensureState();
		this.syncLeafTitle();
		const previousRenderState = this.currentRenderState;
		const activeElement = this.contentEl.ownerDocument.activeElement;
		const activeSearchInput = activeElement instanceof HTMLInputElement
			&& activeElement.matches('.operon-table-search-input')
			&& this.contentEl.contains(activeElement)
			? activeElement
			: null;
		if (activeSearchInput) {
			this.pendingSearchFocus = {
				start: activeSearchInput.selectionStart ?? activeSearchInput.value.length,
				end: activeSearchInput.selectionEnd ?? activeSearchInput.value.length,
			};
		}

		const settings = this.getSettings();
		const projectSerialSignature = this.callbacks.getProjectSerialSignature?.() ?? '';
		const preset = this.getCurrentPreset() ?? settings.tablePresets[0] ?? createDefaultTablePreset();
		this.syncTableSearchStateFromPreset(preset);
		const filterSet = preset ? resolveTablePresetFilterSet(preset, settings.filterSets) : null;
		const tasks = this.indexer.getAllTasks();
		const tasksResolvedAt = enginePerfNow();
		const searchContext = this.resolveTableSearchContext(filterSet, tasks, settings);
		const searchContextResolvedAt = enginePerfNow();
		const resolvedColumns = resolveTableColumns(preset, settings);
		const taskColumns = resolvedColumns.taskColumns.map(column => ({ ...column }));
		const columns = resolvedColumns.renderColumns.map(column => ({ ...column }));
		const locationResolver = getTableLocationCellResolver(this.app, settings, columns);
		const locationIndexSignature = buildTableLocationCellIndexSignature(this.app, settings, columns);
		const normalizedSearchQuery = searchContext.activeSearchQuery.trim().toLocaleLowerCase();
		const searchCacheScopeKey = buildTableSearchCacheScopeKey(searchContext.scopeKey, taskColumns, preset.sortRules);
		const noSearchResultCacheKey = buildTableNoSearchResultCacheKey(searchContext.scopeKey, taskColumns, preset);
		const cachedNoSearchResult = !normalizedSearchQuery
			&& this.noSearchResultCache?.key === noSearchResultCacheKey
			&& this.noSearchResultCache.summariesEvaluated
			? this.noSearchResultCache
			: null;
		const searchMatcher = normalizedSearchQuery
			? this.searchMatcherCache.getMatcher({
				tasks,
				settings,
				generation: this.indexer.getGeneration(),
				columns: taskColumns,
				valueResolverOptions: { getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay },
				valueResolverSignature: projectSerialSignature,
			})
			: undefined;
		const matcherResolvedAt = enginePerfNow();
		const sortedSearchBaseRows = normalizedSearchQuery
			? this.resolveSortedSearchBaseRows({
				preset,
				filterSet,
				tasks,
				settings,
				searchContext,
				columns: taskColumns,
				cacheKey: searchCacheScopeKey,
			})
			: null;
		const precomputedSearchedTasks = normalizedSearchQuery && searchMatcher
			? this.resolveIncrementalSearchedTasks(
				sortedSearchBaseRows ?? searchContext.scopeFilteredTasks,
				normalizedSearchQuery,
				searchMatcher,
				searchCacheScopeKey,
			)
			: undefined;
		const cachedEmptySearchRows = !normalizedSearchQuery && this.sortedRowsCache?.key === searchCacheScopeKey
			? this.sortedRowsCache.rows
			: undefined;
		const precomputedRowsForQuery = precomputedSearchedTasks ?? cachedEmptySearchRows;
		if (!normalizedSearchQuery) {
			this.incrementalSearchCache = null;
		}
		const hasSummaryRow = hasVisibleTableSummaryRule(preset.summaries, taskColumns);
		const shouldDeferSummaries = !cachedNoSearchResult && this.deferSummariesForSearch && hasSummaryRow;
		if (cachedNoSearchResult) {
			this.deferSummariesForSearch = false;
		}
		const result = cachedNoSearchResult?.result ?? queryTableRows({
			preset,
			filterSet,
			tasks,
			priorities: settings.priorities,
			pinnedCache: this.getPinnedCache(),
			settings,
			searchQuery: searchContext.activeSearchQuery,
			searchMatcher,
			precomputedScopedTasks: searchContext.scopedTasks,
			precomputedScopeFilteredTasks: searchContext.scopeFilteredTasks,
			precomputedSearchedTasks,
			precomputedRows: precomputedRowsForQuery,
			taskIdFilter: searchContext.taskIdFilter,
			summaryMode: shouldDeferSummaries ? 'skip' : 'evaluate',
			valueResolverOptions: { getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay },
		});
		const queryResolvedAt = enginePerfNow();
		if (!normalizedSearchQuery && !cachedNoSearchResult) {
			this.noSearchResultCache = {
				key: noSearchResultCacheKey,
				result,
				summariesEvaluated: !shouldDeferSummaries,
			};
		}
		this.resetCollapsedGroupsWhenGroupChanges(result.preset);
		const rowHeight = resolveTableRowHeight(result.preset);
		const columnGeometry = buildTableColumnGeometry(columns);
		const tableWidthPx = columnGeometry.tableWidthPx;
		const scrollbarGutterPx = measureTableScrollbarGutterPx(this.contentEl.ownerDocument);
		const searchControlSignature = this.buildSearchControlSignature(searchContext.parentSearchUi);
		const items = buildTableRenderItems(
			result.rows,
			result.groups,
			this.state.collapsedGroupKeys,
			hasSummaryRow,
		);
		const ordinalItems = this.state.collapsedGroupKeys.length === 0
			? items
			: buildTableRenderItems(result.rows, result.groups, [], hasSummaryRow);
		this.currentRenderState = {
			preset: result.preset,
			columns,
			taskColumns,
			rows: result.rows,
			groups: result.groups,
			items,
			taskOrdinals: buildTableTaskOrdinalMap(ordinalItems),
			summaries: result.summaries,
			groupSummaries: result.groupSummaries,
			scopedTaskCount: result.counts.scoped,
			searchedTaskCount: result.counts.searched,
			settings,
			allTasks: tasks,
			valueResolver: result.valueResolver,
			locationResolver,
			locationIndexSignature,
			summariesCalculating: shouldDeferSummaries,
			rowHeight,
			tableWidthPx,
			columnGeometry,
			scrollbarGutterPx,
			normalizedSearchQuery,
			searchControlSignature,
			noSearchResultCacheKey: normalizedSearchQuery ? null : noSearchResultCacheKey,
			shellReuseSignature: this.buildTableShellReuseSignature({
				preset: result.preset,
				columns,
				settings,
				rowHeight,
				tableWidthPx,
				columnGeometry,
				scrollbarGutterPx,
				searchControlSignature,
				locationIndexSignature,
				projectSerialSignature,
			}),
		};
		this.lastRenderedRangeKey = null;
		if (shouldDeferSummaries) {
			this.scheduleDeferredSummaryRefresh();
		}
		this.scheduleSearchPrewarm(tasks, searchContext.scopeFilteredTasks, settings, taskColumns, normalizedSearchQuery);

		if (this.canReuseTableShell(previousRenderState, this.currentRenderState, normalizedSearchQuery, searchContext.parentSearchUi)) {
			this.updateExistingTableShell(result.counts.final, this.isSearchEmpty(result.counts.scoped));
			this.lastRenderedRangeKey = null;
			this.suppressActivePickerCloseForProgrammaticScroll();
			if (this.horizontalScrollerEl) {
				this.horizontalScrollerEl.scrollLeft = this.state.scrollLeft;
			}
			if (this.bodyScrollerEl) {
				this.bodyScrollerEl.scrollTop = this.state.scrollTop;
				this.renderVisibleRows(true);
			}
			this.restoreSearchFocus();
			this.lastRenderedSearchActive = true;
			enginePerfLog(
				'table.render',
				`${Math.round(enginePerfNow() - renderStartedAt)}ms`,
				`tasks=${tasks.length}`,
				`rows=${result.rows.length}`,
				`shell=reuse`,
				`stages=tasks:${Math.round(tasksResolvedAt - renderStartedAt)},scope:${Math.round(searchContextResolvedAt - tasksResolvedAt)},matcher:${Math.round(matcherResolvedAt - searchContextResolvedAt)},query:${Math.round(queryResolvedAt - matcherResolvedAt)},dom:${Math.round(enginePerfNow() - queryResolvedAt)}`,
			);
			return;
		}

		this.cleanupTableResizeObserver();
		this.cleanupMobileViewport();
		cleanupOperonHoverTooltips(this.contentEl);
		this.contentEl.empty();
		this.contentEl.addClass('operon-table-view');
		const root = this.contentEl.createDiv('operon-table-root operon-task-chip-surface');
		this.bindMobileViewport(root);
		root.addClass(`operon-table-density-${result.preset.display.density}`);
		root.style.setProperty('--operon-table-row-height', `${rowHeight}px`);
		this.renderToolbar(root, result.preset, result.counts.final, this.state.searchQuery, searchContext.parentSearchUi);
		this.renderTable(root, columns, rowHeight);
		if (result.rows.length === 0) {
			this.renderEmptyState(root, this.isSearchEmpty(result.counts.scoped));
		}
		this.suppressActivePickerCloseForProgrammaticScroll();
		if (this.horizontalScrollerEl) {
			this.horizontalScrollerEl.scrollLeft = this.state.scrollLeft;
		}
		if (this.bodyScrollerEl) {
			this.bodyScrollerEl.scrollTop = this.state.scrollTop;
			this.renderVisibleRows(true);
		}
		this.restorePendingCellFocus();
		this.restoreSearchFocus();
		this.lastRenderedSearchActive = normalizedSearchQuery.length > 0;
		enginePerfLog(
			'table.render',
			`${Math.round(enginePerfNow() - renderStartedAt)}ms`,
			`tasks=${tasks.length}`,
			`rows=${result.rows.length}`,
			`stages=tasks:${Math.round(tasksResolvedAt - renderStartedAt)},scope:${Math.round(searchContextResolvedAt - tasksResolvedAt)},matcher:${Math.round(matcherResolvedAt - searchContextResolvedAt)},query:${Math.round(queryResolvedAt - matcherResolvedAt)},dom:${Math.round(enginePerfNow() - queryResolvedAt)}`,
		);
	}

	private scheduleRender(): void {
		if (this.renderFrame !== null) return;
		this.renderFrame = window.requestAnimationFrame(() => {
			this.renderFrame = null;
			this.render();
		});
	}

	private suppressActivePickerCloseForProgrammaticScroll(): void {
		if (!this.keepActivePickerOnRender || !this.activePickerClose || !this.bodyScrollerEl) return;
		const token = this.suppressActivePickerCloseOnScrollToken + 1;
		this.suppressActivePickerCloseOnScrollToken = token;
		getOwnerWindow(this.bodyScrollerEl).setTimeout(() => {
			if (this.suppressActivePickerCloseOnScrollToken === token) {
				this.suppressActivePickerCloseOnScrollToken = 0;
			}
		}, 160);
	}

	private canReuseTableShell(
		previous: TableRenderState | null,
		next: TableRenderState | null,
		normalizedSearchQuery: string,
		parentSearchUi: TableParentSearchUiState | null,
	): boolean {
		if (!previous || !next || !this.bodyScrollerEl || !this.bodyCanvasEl) return false;
		if (!this.lastRenderedSearchActive || normalizedSearchQuery.length === 0) return false;
		if (parentSearchUi?.dropdownVisible) return false;
		if (previous.preset.id !== next.preset.id) return false;
		if (previous.preset.groupBy !== next.preset.groupBy) return false;
		if (previous.preset.groupOrder !== next.preset.groupOrder) return false;
		if (previous.preset.subgroupBy !== next.preset.subgroupBy) return false;
		if (previous.preset.subgroupOrder !== next.preset.subgroupOrder) return false;
		if (previous.preset.display.density !== next.preset.display.density) return false;
		if (previous.rowHeight !== next.rowHeight) return false;
		if (previous.tableWidthPx !== next.tableWidthPx || previous.scrollbarGutterPx !== next.scrollbarGutterPx) return false;
		if (previous.columnGeometry.signature !== next.columnGeometry.signature) return false;
		if (previous.searchControlSignature !== next.searchControlSignature) return false;
		if (previous.shellReuseSignature !== next.shellReuseSignature) return false;
		if (previous.normalizedSearchQuery === next.normalizedSearchQuery) return false;
		return buildTableColumnTemplate(previous.columns) === buildTableColumnTemplate(next.columns)
			&& buildTableSearchVisibleColumnSignature(previous.columns) === buildTableSearchVisibleColumnSignature(next.columns);
	}

	private buildSearchControlSignature(parentSearchUi: TableParentSearchUiState | null): string {
		const searchQuery = this.ensureState().searchQuery;
		return [
			isTableSearchScopeActive(this.searchScope, this.parentSearchSelection, searchQuery) ? 'active' : 'inactive',
			JSON.stringify(this.searchScope),
			this.parentSearchSelection
				? `${this.parentSearchSelection.mode}:${this.parentSearchSelection.parentId}:${this.parentSearchSelection.parentName}`
				: '',
			parentSearchUi
				? `${parentSearchUi.mode}:${parentSearchUi.selectedParentId ?? ''}:${parentSearchUi.dropdownVisible ? 'open' : 'closed'}`
				: '',
		].join('|');
	}

	private buildTableShellReuseSignature(input: {
		preset: TablePreset;
		columns: readonly TableColumn[];
		settings: OperonSettings;
		rowHeight: number;
		tableWidthPx: number;
		columnGeometry: TableColumnGeometry;
		scrollbarGutterPx: number;
		searchControlSignature: string;
		locationIndexSignature: string;
		projectSerialSignature: string;
	}): string {
		return [
			JSON.stringify(input.preset),
			input.rowHeight,
			input.tableWidthPx,
			input.scrollbarGutterPx,
			input.columnGeometry.signature,
			buildTableColumnTemplate(input.columns),
			buildTableSearchVisibleColumnSignature(input.columns),
			input.searchControlSignature,
			input.locationIndexSignature,
			input.projectSerialSignature,
			JSON.stringify(input.settings.tablePresets.map(preset => [preset.id, preset.name])),
			buildTableRelevantSettingsSignature(input.settings),
		].join('|');
	}

	private updateExistingTableShell(taskCount: number, searchEmpty: boolean): void {
		const searchPlaceholder = formatTableSearchPlaceholder(taskCount);
		const searchInput = this.contentEl.querySelector<HTMLInputElement>('.operon-table-search-input');
		if (searchInput) {
			searchInput.placeholder = searchPlaceholder;
			setAccessibleLabelWithoutTooltip(searchInput, searchPlaceholder);
			if (searchInput.value !== this.state.searchQuery) {
				searchInput.value = this.state.searchQuery;
			}
		}
		this.contentEl.querySelector<HTMLElement>('.operon-table-shell')?.setAttribute(
			'aria-rowcount',
			String((this.currentRenderState?.items.length ?? 0) + 1),
		);
		const root = this.contentEl.querySelector<HTMLElement>('.operon-table-root');
		if (!root) return;
		root.querySelector<HTMLElement>('.operon-table-empty')?.remove();
		if (taskCount === 0) {
			this.renderEmptyState(root, searchEmpty);
		}
	}

	private renderToolbar(
		root: HTMLElement,
		preset: TablePreset,
		taskCount: number,
		searchQuery: string,
		parentSearchUi: TableParentSearchUiState | null,
	): void {
		const settings = this.getSettings();
		const toolbar = root.createDiv('operon-table-toolbar');
		const titleWrap = toolbar.createDiv('operon-table-title-wrap');
		const iconEl = titleWrap.createSpan('operon-table-title-icon');
		setIcon(iconEl, 'table-2');
		titleWrap.createSpan({ cls: 'operon-table-title', text: t('table', 'title') });
		this.renderTableRelatedViewsButton(titleWrap, preset);
		const controls = toolbar.createDiv('operon-table-toolbar-controls');
		this.renderTablePresetPicker(controls, settings.tablePresets, preset);
		this.renderTableGroupSortPopoverButton(controls, preset);
		this.renderTableFilterPopoverButton(controls, preset);
		const editButton = controls.createEl('button', {
			cls: 'operon-table-toolbar-icon-button',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(editButton, t('table', 'editPreset'));
		setIcon(editButton, 'settings-2');
		editButton.addEventListener('click', () => {
			this.callbacks.onOpenPresetSettings?.(preset.id);
		});
		renderTableSearchQuickScopeButtons({
			container: controls,
			scope: this.searchScope,
			settings,
			onToggle: key => this.toggleSearchScopeKey(key),
			onRefocus: () => this.focusTableSearchInput(),
		});
		const searchWrap = controls.createDiv('operon-table-search-wrap');
		syncTableSearchWrapClasses(searchWrap, this.searchScope, this.parentSearchSelection, searchQuery);
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
		searchInput.value = searchQuery;
		searchInput.addEventListener('compositionstart', () => {
			this.isSearchComposing = true;
		});
		searchInput.addEventListener('compositionend', () => {
			this.isSearchComposing = false;
			this.pendingSearchFocus = {
				start: searchInput.selectionStart ?? searchInput.value.length,
				end: searchInput.selectionEnd ?? searchInput.value.length,
			};
			this.handleTableSearchInput(searchInput, true);
		});
		searchInput.addEventListener('input', () => {
			this.pendingSearchFocus = {
				start: searchInput.selectionStart ?? searchInput.value.length,
				end: searchInput.selectionEnd ?? searchInput.value.length,
			};
			if (!this.isSearchComposing) {
				this.handleTableSearchInput(searchInput, false);
			}
		});
		searchInput.addEventListener('keydown', event => {
			if (!parentSearchUi?.dropdownVisible || parentSearchUi.candidates.length === 0) return;
			const visibleCandidateCount = Math.min(parentSearchUi.candidates.length, TABLE_PARENT_SEARCH_MAX_CANDIDATES);
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.updateParentSearchHighlight(Math.min(visibleCandidateCount - 1, this.parentSearchHighlightedIndex + 1));
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.updateParentSearchHighlight(Math.max(0, this.parentSearchHighlightedIndex - 1));
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				const candidate = parentSearchUi.candidates[Math.min(this.parentSearchHighlightedIndex, visibleCandidateCount - 1)] ?? parentSearchUi.candidates[0];
				if (candidate) this.selectParentSearchCandidate(parentSearchUi.mode, candidate);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this.parentSearchDismissed = true;
				this.scheduleRender();
			}
		});
		if (isTableSearchScopeActive(this.searchScope, this.parentSearchSelection, searchQuery)) {
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
				this.pendingSearchFocus = { start: 0, end: 0 };
				this.clearTableSearchState();
			});
		}
		renderTableSearchScopePopover({
			searchWrap,
			scope: this.searchScope,
			settings,
			selectedParent: this.parentSearchSelection,
			onToggle: key => this.toggleSearchScopeKey(key),
			onClearParent: () => this.clearParentSearchState(),
			onRefocus: () => this.focusTableSearchInput(),
		});
		renderTableParentSearchDropdown({
			searchWrap,
			parentSearchUi,
			highlightedIndex: this.parentSearchHighlightedIndex,
			onSelect: candidate => this.selectParentSearchCandidate(parentSearchUi?.mode ?? 'pc', candidate),
		});
		this.renderTableExportButton(controls);
	}

	private renderTableRelatedViewsButton(titleWrap: HTMLElement, preset: TablePreset): void {
		renderRelatedViewsLauncher({
			container: titleWrap,
			settings: this.getSettings(),
			source: { type: 'table', preset },
			buttonClass: 'operon-table-toolbar-icon-button',
			closeBeforeOpen: () => this.closeActivePicker(),
			onOpenRelatedView: target => this.callbacks.onOpenRelatedView?.(target),
			onCreateRelatedView: target => this.callbacks.onCreateRelatedView?.(target),
		});
	}

	private renderTablePresetPicker(
		container: HTMLElement,
		presets: readonly TablePreset[],
		activePreset: TablePreset,
	): void {
		const button = container.createEl('button', {
			cls: 'operon-table-preset-select operon-field-picker-trigger operon-table-field-picker-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'listbox',
				'aria-expanded': 'false',
			},
		});
		const activeLabel = getTablePresetPickerLabel(activePreset);
		setAccessibleLabelWithoutTooltip(button, `${t('table', 'selectPreset')}: ${activeLabel}`);
		button.createSpan({ cls: 'operon-field-picker-trigger-label', text: activeLabel });
		const iconEl = button.createSpan('operon-field-picker-trigger-icon');
		setIcon(iconEl, 'chevron-down');
		button.addEventListener('click', event => {
			event.preventDefault();
			this.closeActivePicker();
			button.setAttribute('aria-expanded', 'true');
			let closePicker: (() => void) | null = null;
			closePicker = showTablePresetPicker(button, {
				value: activePreset.id,
				presets,
				onSelect: presetId => {
					void this.switchPreset(presetId);
				},
				onClose: () => {
					if (button.isConnected) button.setAttribute('aria-expanded', 'false');
					if (closePicker && this.activePickerClose === closePicker) {
						this.activePickerClose = null;
					}
				},
				floatingHost: container.ownerDocument.body,
				floatingScrollHost: container.ownerDocument.defaultView ?? window,
				matchWidth: Math.max(button.getBoundingClientRect().width, 280),
			});
			this.activePickerClose = closePicker;
		});
	}

	private renderTableGroupSortPopoverButton(controls: HTMLElement, preset: TablePreset): void {
		const button = controls.createEl('button', {
			cls: 'operon-table-group-sort-button',
			attr: {
				type: 'button',
				'aria-haspopup': 'dialog',
				'aria-expanded': 'false',
			},
		});
		setAccessibleLabelWithoutTooltip(button, t('table', 'groupSort'));
		button.toggleClass('is-active', !!preset.groupBy || !!preset.subgroupBy || preset.sortRules.length > 0);
		setIcon(button.createSpan('operon-table-group-sort-button-icon'), 'arrow-up-down');
		button.createSpan({ cls: 'operon-table-group-sort-button-label', text: t('table', 'groupSort') });
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.openTableGroupSortPopover(button, preset);
		});
	}

	private openTableGroupSortPopover(button: HTMLButtonElement, preset: TablePreset): void {
		this.closeActivePicker();
		button.setAttribute('aria-expanded', 'true');
		const editingPreset = this.getCurrentEditingPreset();
		let closePopover: (() => void) | null = null;
		closePopover = showTableGroupSortPopover({
			anchor: button.getBoundingClientRect(),
			floatingHost: button.ownerDocument.body,
			floatingScrollHost: getOwnerWindow(button),
			preset: editingPreset.id === preset.id ? editingPreset : preset,
			settings: this.getSettings(),
			onChange: (updatedPreset, scope) => this.savePresetGroupSortDraft(updatedPreset, scope),
			onClose: () => {
				button.setAttribute('aria-expanded', 'false');
				if (closePopover && this.activePickerClose === closePopover) {
					this.activePickerClose = null;
					this.keepActivePickerOnRender = false;
				}
				const ownerWindow = getOwnerWindow(button);
				ownerWindow.requestAnimationFrame(() => {
					const focusTarget = button.isConnected
						? button
						: this.contentEl.querySelector<HTMLButtonElement>('button.operon-table-group-sort-button');
					if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
				});
			},
		});
		this.keepActivePickerOnRender = true;
		this.activePickerClose = closePopover;
	}

	private renderTableFilterPopoverButton(controls: HTMLElement, preset: TablePreset): void {
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
			this.openTableFilterPopover(host, button, preset);
		});
	}

	private openTableFilterPopover(host: HTMLElement, button: HTMLButtonElement, preset: TablePreset): void {
		this.closeActivePicker();
		const settings = this.getSettings();
		const currentFilter = resolveTablePresetFilterSet(preset, settings.filterSets);
		const draft = currentFilter
			? cloneFilterSet(currentFilter)
			: createEmptyTableFilterSet(this.createUniqueTableFilterName());
		const sourceFilterSetId = currentFilter?.id ?? null;
		const ownerDocument = getOwnerDocument(host);
		const ownerWindow = ownerDocument.defaultView ?? window;
		const popover = ownerDocument.body.createDiv('operon-table-filter-popover');
		const popoverId = generateTableFilterPopoverId();
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
			if (this.activePickerClose === close) {
				this.activePickerClose = null;
				this.keepActivePickerOnRender = false;
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
			this.app,
			draft,
			settings.keyMappings,
			() => undefined,
		);
		editor.renderInlineConditionEditor(popover, {
			onCancel: close,
			onSave: updated => {
				void this.saveTableFilterPopoverDraft(updated, sourceFilterSetId, preset, close);
			},
				countTasks: filterSet => filterTasksForCalendar(
					filterSet,
					this.indexer.getAllTasks(),
					this.getSettings().priorities,
					this.getPinnedCache(),
				).length,
				saveTooltip: sourceFilterSetId
					? this.buildFilterUsageTooltip(sourceFilterSetId)
					: undefined,
			});
		this.positionTableFilterPopover(popover, button);

		this.keepActivePickerOnRender = true;
		this.activePickerClose = close;
		ownerDocument.addEventListener('pointerdown', handleDocumentPointerDown, true);
		ownerDocument.addEventListener('keydown', handleDocumentKeyDown, true);
		ownerWindow.addEventListener('resize', close);
	}

	private positionTableFilterPopover(popover: HTMLElement, button: HTMLElement): void {
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

	private createUniqueTableFilterName(): string {
		const baseName = t('table', 'newFilterName');
		const existingNames = new Set(
			this.getSettings().filterSets.map(filterSet => filterSet.name.trim().toLocaleLowerCase()),
		);
		if (!existingNames.has(baseName.toLocaleLowerCase())) return baseName;
		let suffix = 2;
		while (existingNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) {
			suffix += 1;
		}
		return `${baseName} ${suffix}`;
	}

	private buildFilterUsageTooltip(filterSetId: string): { title: string; content: string } | undefined {
		const settings = this.getSettings();
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

	private async saveTableFilterPopoverDraft(
		filterSet: FilterSet,
		sourceFilterSetId: string | null,
		preset: TablePreset,
		close: () => void,
	): Promise<void> {
		if (!this.callbacks.onSaveFilterSet) {
			new Notice(t('table', 'presetActionFailed'));
			return;
		}
		try {
			await this.callbacks.onSaveFilterSet(filterSet);
			if (!sourceFilterSetId) {
				await this.callbacks.onSavePresetPatch?.({
					id: preset.id,
					filterSetId: filterSet.id,
				});
			}
			close();
		} catch (error) {
			console.error('Operon: failed to save table filter popover draft', error);
			new Notice(t('table', 'presetActionFailed'));
		}
	}

	private renderTableExportButton(controls: HTMLElement): void {
		const button = controls.createEl('button', {
			cls: 'operon-table-toolbar-icon-button',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(button, t('table', 'exportMenuLabel'));
		setIcon(button, 'file-down');
		button.addEventListener('click', event => {
			event.preventDefault();
			const renderState = this.currentRenderState;
			if (!renderState) return;
			showTableExportMenu({
				anchor: button,
				event,
				preset: renderState.preset,
				source: renderState,
			});
		});
	}

	private renderTable(root: HTMLElement, columns: TableColumn[], rowHeight: number): void {
		const shell = root.createDiv('operon-table-shell');
		shell.setAttribute('role', 'grid');
		shell.setAttribute('aria-rowcount', String((this.currentRenderState?.items.length ?? 0) + 1));
		shell.setAttribute('aria-colcount', String(columns.length));
		let activeCellHighlight: ReturnType<typeof bindTableActiveCellHighlight> | null = null;
		const horizontalScroller = shell.createDiv('operon-table-horizontal-scroll');
		const columnGeometry = this.currentRenderState?.columnGeometry ?? buildTableColumnGeometry(columns);
		const columnTemplate = columnGeometry.columnTemplate;
		const tableWidthPx = columnGeometry.tableWidthPx;
		const surfaceWidthPx = tableWidthPx + (this.currentRenderState?.scrollbarGutterPx ?? 0);
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
			this.renderHeaderCell(header, column, index);
		}

		const canvas = bodyScroller.createDiv('operon-table-body-canvas');
		canvas.setAttribute('role', 'rowgroup');
		canvas.style.width = tableWidth;
		canvas.style.minWidth = tableWidth;
		canvas.style.height = `${(this.currentRenderState?.items.length ?? 0) * rowHeight}px`;
		canvas.style.setProperty('--operon-table-group-scroll-left', `${this.state.scrollLeft}px`);
		activeCellHighlight = bindTableActiveCellHighlight(canvas);
		this.horizontalScrollerEl = bodyScroller;
		this.bodyScrollerEl = bodyScroller;
		this.bodyCanvasEl = canvas;
		this.observeTableBodyResize(shell, bodyScroller);
		bodyScroller.addEventListener('pointermove', event => {
			if (!Platform.isPhone || event.pointerType === 'mouse') return;
			this.mobileScrollGestureUntil = Date.now() + 900;
		}, { passive: true });
		bodyScroller.addEventListener('scroll', () => {
			activeCellHighlight?.clear();
			this.closeSearchTransientUi();
			if (this.suppressActivePickerCloseOnScrollToken === 0) {
				this.closeActivePicker();
			} else {
				this.suppressActivePickerCloseOnScrollToken = 0;
			}
			canvas.style.setProperty('--operon-table-group-scroll-left', `${bodyScroller.scrollLeft}px`);
			this.state = {
				...this.ensureState(),
				scrollTop: bodyScroller.scrollTop,
				scrollLeft: bodyScroller.scrollLeft,
			};
			if (!Platform.isPhone || Date.now() < this.mobileScrollGestureUntil) {
				this.finishMobileInlineEdit(true);
			}
			this.scheduleVisibleRowsRender();
			this.scheduleLeafStatePersistence();
		});
	}

	private renderHeaderCell(header: HTMLElement, column: TableColumn, columnIndex: number): void {
		renderInteractiveTableHeaderCell(header, column, columnIndex, {
			root: this.contentEl,
			state: this.headerInteractionState,
			getRenderState: () => this.currentRenderState,
			getCurrentPreset: () => this.getCurrentEditingPreset(),
			savePreset: (updatedPreset, scope) => this.savePresetFromHeader(updatedPreset, scope),
			applyColumnTemplate: columns => this.applyColumnTemplate(columns),
			closeActivePicker: () => this.closeActivePicker(),
			getActivePickerClose: () => this.activePickerClose,
			setActivePickerClose: close => {
				this.activePickerClose = close;
			},
			...(this.callbacks.onOpenPresetSettings
				? { onOpenPresetSettings: this.callbacks.onOpenPresetSettings }
				: {}),
		});
	}

	private shouldUseIconOnlyColumn(column: TableColumn, settings: Pick<OperonSettings, 'keyMappings'>): boolean {
		return shouldUseTableIconOnlyColumn(column, settings);
	}

	private renderVisibleRows(force = false): void {
		const startedAt = enginePerfNow();
		if (force && this.hasActiveMobileInlineEdit()) {
			this.finishMobileInlineEdit(true);
		}
		const renderState = this.currentRenderState;
		const scroller = this.bodyScrollerEl;
		const canvas = this.bodyCanvasEl;
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
			this.state.collapsedGroupKeys.join('\u0000'),
		].join(':');
		if (rangeKey === this.lastRenderedRangeKey) return;
		if (!force && this.shouldDeferMobileVisibleRowsRender()) {
			this.pendingMobileTextInputRender = true;
			return;
		}
		this.lastRenderedRangeKey = rangeKey;
		cleanupOperonHoverTooltips(canvas);
		canvas.empty();
		canvas.style.width = `${renderState.tableWidthPx}px`;
		canvas.style.minWidth = `${renderState.tableWidthPx}px`;
		canvas.style.height = `${items.length * rowHeight}px`;
		canvas.style.setProperty('--operon-table-group-scroll-left', `${this.bodyScrollerEl?.scrollLeft ?? this.state.scrollLeft}px`);
		const columnTemplate = renderState.columnGeometry.columnTemplate;

		for (let index = startIndex; index < endIndex; index++) {
			const item = items[index];
			if (!item) continue;
			this.renderVirtualRow(canvas, item, index, columnTemplate, renderState);
		}
		enginePerfLog(
			'table.visibleRows',
			`${Math.round(enginePerfNow() - startedAt)}ms`,
			`range=${startIndex}-${endIndex}`,
			`items=${items.length}`,
			`cache=${formatTableValueCacheStats(renderState.valueResolver.getStats())}`,
		);
	}

	private renderVirtualRow(
		canvas: HTMLElement,
		item: TableRenderItem,
		index: number,
		columnTemplate: string,
		renderState: TableRenderState,
	): void {
		if (item.kind === 'group') {
			this.renderGroupRow(canvas, item.group, item.groupKey, item.depth, index, renderState, item.parentGroup);
			return;
		}
		if (item.kind === 'summary') {
			this.renderSummaryRow(canvas, index, columnTemplate, renderState, renderState.summaries, false, renderState.rows);
			return;
		}
		if (item.kind === 'groupSummary') {
			this.renderSummaryRow(
				canvas,
				index,
				columnTemplate,
				renderState,
				renderState.groupSummaries.get(item.groupKey) ?? new Map<string, TableSummaryCell>(),
				true,
				item.group.rows,
			);
			return;
		}
		this.renderRow(canvas, item.task, index, columnTemplate, renderState, renderState.taskOrdinals.get(item.ordinalKey) ?? null);
	}

	private renderGroupRow(
		canvas: HTMLElement,
		group: TableQueryGroup | TableQuerySubgroup,
		groupKey: string,
		depth: number,
		index: number,
		renderState: TableRenderState,
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
		const collapsed = this.isGroupCollapsed(groupKey);
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
		this.renderGroupLabelContent(button, groupLabel, parentLabel);
		button.createSpan({
			cls: 'operon-table-group-count',
			text: formatTableTaskCount(group.count),
		});
		if (collapsed) {
			this.renderGroupSummaryHints(button, groupKey, renderState);
		}
		button.addEventListener('click', event => {
			event.preventDefault();
			this.toggleGroupCollapsed(groupKey);
		});
	}

	private renderGroupLabelContent(button: HTMLElement, groupLabel: string, parentLabel: string | null): void {
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

	private renderGroupSummaryHints(
		container: HTMLElement,
		groupKey: string,
		renderState: TableRenderState,
	): void {
		const summaries = renderState.groupSummaries.get(groupKey);
		if (!summaries || summaries.size === 0) return;
		const parts: string[] = [];
		for (const column of renderState.columns) {
			const summary = summaries.get(column.key);
			if (!summary?.value.trim()) continue;
			const fieldLabel = column.label?.trim() || getTableTaskFieldLabel(column.key, renderState.settings);
			parts.push(`${fieldLabel} ${getTableSummaryFunctionLabel(summary.function)} ${summary.value}`);
		}
		if (parts.length === 0) return;
		const visibleParts = parts.slice(0, 3);
		container.createSpan({
			cls: 'operon-table-group-summary-hints',
			text: visibleParts.join(' · ') + (parts.length > visibleParts.length ? ' · ...' : ''),
		});
	}

	private renderRow(
		canvas: HTMLElement,
		task: IndexedTask,
		index: number,
		columnTemplate: string,
		renderState: TableRenderState,
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
			this.callbacks.onOpenTaskEditor?.(task.operonId);
		});

		for (const [columnIndex, column] of renderState.columns.entries()) {
			this.renderCell(row, task, column, renderState, columnIndex, rowOrdinal);
		}
	}

	private renderSummaryRow(
		canvas: HTMLElement,
		index: number,
		columnTemplate: string,
		renderState: TableRenderState,
		summaries: Map<string, TableSummaryCell>,
		isGroupSummary: boolean,
		summaryRows: readonly IndexedTask[],
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
			const fallbackFunction = this.getConfiguredSummaryFunction(column.key, renderState);
			this.decorateSummaryCell(cell, column, renderState, summaryRows, summary?.function ?? fallbackFunction);
			if (!summary && renderState.summariesCalculating && fallbackFunction) {
				cell.addClass('is-calculating');
				cell.createSpan({
					cls: 'operon-table-summary-label',
					text: getTableSummaryFunctionLabel(fallbackFunction),
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
				text: getTableSummaryFunctionLabel(summary.function),
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

	private getConfiguredSummaryFunction(
		columnKey: string,
		renderState: TableRenderState,
	): TableSummaryFunction | null {
		return renderState.preset.summaries.find(rule => rule.key === columnKey)?.function ?? null;
	}

	private decorateSummaryCell(
		cell: HTMLElement,
		column: TableColumn,
		renderState: TableRenderState,
		summaryRows: readonly IndexedTask[],
		currentFunction: TableSummaryFunction | null,
	): void {
		if (renderState.summariesCalculating) return;
		const fieldLabel = getTableTaskFieldLabel(column.key, renderState.settings);
		cell.addClass('is-interactive');
		cell.tabIndex = 0;
		cell.dataset.summaryColumnKey = column.key;
		setAccessibleLabelWithoutTooltip(cell, t('table', 'summaryPickerAria', { field: fieldLabel }));
		const openPicker = () => this.openSummaryPicker(cell, column, summaryRows, currentFunction);
		cell.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
		cell.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			openPicker();
		});
	}

	private openSummaryPicker(
		cell: HTMLElement,
		column: TableColumn,
		summaryRows: readonly IndexedTask[],
		currentFunction: TableSummaryFunction | null,
	): void {
		const renderState = this.currentRenderState;
		if (!renderState) return;
		this.closeActivePicker();
		const supportedKeys = new Set(buildTableTaskFieldCatalog(renderState.settings).map(field => field.key));
		let closePicker: (() => void) | null = null;
		closePicker = showTableSummaryPicker({
			anchor: cell,
			fieldKey: column.key,
			rows: summaryRows,
			allTasks: this.indexer.getAllTasks(),
			settings: renderState.settings,
			valueResolver: renderState.valueResolver,
			currentFunction,
			onSelect: summaryFunction => {
				this.savePresetFromHeader(setTablePresetSummary(this.getCurrentEditingPreset(), column.key, summaryFunction, supportedKeys), 'summaries');
			},
			onClear: () => {
				this.savePresetFromHeader(clearTablePresetSummary(this.getCurrentEditingPreset(), column.key), 'summaries');
			},
			onClose: () => {
				if (closePicker && this.activePickerClose === closePicker) {
					this.activePickerClose = null;
				}
			},
		});
		this.activePickerClose = closePicker;
	}

	private renderCell(
		row: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		renderState: TableRenderState,
		columnIndex: number,
		rowOrdinal: number | null,
	): void {
		const cell = row.createDiv('operon-table-cell');
		cell.setAttribute('role', 'gridcell');
		cell.setAttribute('aria-colindex', String(columnIndex + 1));
		cell.dataset.column = column.key;
		applyTableColumnGeometryClass(cell, renderState.columnGeometry.entries[columnIndex]);
		if (isTableAdminColumn(column)) {
			this.renderAdminCell(cell, task, column, renderState, rowOrdinal);
			return;
		}
		applyTableColumnAlignmentClass(cell, column);
		const displayValue = renderState.valueResolver.getDisplayValue(task, column.key);

		if (column.key === 'description' || column.key === 'note') {
			this.renderInlineTextCell(cell, task, column, displayValue, renderState);
			return;
		}
		if (column.key === 'source') {
			this.renderSourceCell(cell, task, column, displayValue, renderState);
			return;
		}
		this.renderValueCell(cell, task, column, displayValue, renderState);
	}

	private renderAdminCell(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		renderState: TableRenderState,
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
			cell.addClass('operon-table-task-icon-cell');
			renderTableTaskIconButton(cell, {
				task,
				settings: renderState.settings,
				workflowStatusIdentityIndex: renderState.valueResolver.workflowStatusIdentityIndex,
				onStatusIconClick: this.callbacks.onStatusIconClick,
				onContextualAction: this.callbacks.onContextualAction,
				isPinned: this.callbacks.isTaskPinned,
				hasSubtasks: this.callbacks.hasSubtasks,
			});
			return;
		}
		if (column.key === TABLE_TASK_TYPE_COLUMN_KEY) {
			cell.addClass('operon-table-task-type-cell');
			renderTableTaskTypeButton(cell, {
				task,
				onOpenTaskEditor: this.callbacks.onOpenTaskEditor,
				onOpenTaskSource: this.callbacks.onOpenTaskSource,
			});
		}
	}

	private renderInlineTextCell(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		value: string,
		renderState: TableRenderState,
	): void {
		const key = column.key;
		const editable = this.isEditableTaskCell(key, renderState);
		const cellKey = buildTableEditableCellKey(task, key);
		const payloadKey = key === 'description' ? '_description' : key;
		const showIconOnly = this.shouldUseIconOnlyColumn(column, renderState.settings);
		const canOpenIconOnlyTextPopover = editable && showIconOnly && !!this.callbacks.onUpdateTaskFields;
		if ((editable && !showIconOnly) || canOpenIconOnlyTextPopover) {
			cell.addClass('is-editable');
			cell.dataset.editCellKey = cellKey;
			cell.tabIndex = 0;
			this.syncPendingCellState(cell, cellKey);
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
				app: this.app,
				sourcePath: task.primary.filePath,
			},
			onIconOnlyOpen: canOpenIconOnlyTextPopover
				? () => this.openInlineTextPopover(cell, task, column, value, fieldLabel, cellKey, payloadKey)
				: undefined,
			onCommit: editable && !showIconOnly
				? nextValue => this.commitTaskCellUpdate(cell, task, key, cellKey, { [payloadKey]: nextValue })
				: undefined,
			...(Platform.isPhone
				? {
					onInlineEditStart: (session: TableInlineEditSession) => this.beginMobileInlineEdit(session),
					onInlineEditFinish: (session: TableInlineEditSession) => this.endMobileInlineEdit(session),
				}
				: {}),
		});
	}

	private renderIconOnlyCell(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		value: string,
		renderState: TableRenderState,
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
			this.bindLocationMapPreviewTrigger(icon, task, locationVisual, renderState);
		}
		if (isTaskIconColumn && this.callbacks.onContextualAction) {
			bindTableTaskContextualHoverMenu(icon, {
				task,
				settings: renderState.settings,
				onContextualAction: this.callbacks.onContextualAction,
				isPinned: this.callbacks.isTaskPinned,
				hasSubtasks: this.callbacks.hasSubtasks,
			});
		}
		if (isTaskTypeColumn) {
			bindTableTaskTypeEditorOpen(icon, {
				task,
				onOpenTaskEditor: this.callbacks.onOpenTaskEditor,
				onOpenTaskSource: this.callbacks.onOpenTaskSource,
			});
		}
	}

	private openInlineTextPopover(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		value: string,
		fieldLabel: string,
		cellKey: string,
		payloadKey: string,
	): void {
		if (this.pendingCellKey !== null) return;
		this.closeActivePicker();
		let closeTextPopover: (() => void) | null = null;
		closeTextPopover = showTextFieldPopover({
			app: this.app,
			anchor: cell,
			title: fieldLabel,
			subtitle: task.description || formatTableTaskSource(task),
			initialValue: value,
			taskColor: normalizeTaskFieldColor(task.fieldValues['taskColor']),
			sessionKey: `table-text:${task.operonId}:${column.key}`,
			normalizeValue: normalizeTableTextFieldPopoverValue,
			onCommit: async nextValue => {
				if (this.activePickerClose === closeTextPopover) {
					this.activePickerClose = null;
				}
				const success = await this.commitTaskCellUpdate(cell, task, column.key, cellKey, { [payloadKey]: nextValue }, {
					showFailureNotice: false,
				});
				if (success === false && closeTextPopover) {
					this.activePickerClose = closeTextPopover;
				}
				return success;
			},
			onClose: () => {
				if (this.activePickerClose === closeTextPopover) {
					this.activePickerClose = null;
				}
			},
		});
		this.activePickerClose = closeTextPopover;
	}

	private renderSourceCell(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		value: string,
		renderState: TableRenderState,
	): void {
		const fullSource = formatTableTaskSource(task);
		if (this.shouldUseIconOnlyColumn(column, renderState.settings)) {
			cell.addClass('is-editable');
			cell.tabIndex = 0;
			setAccessibleLabelWithoutTooltip(cell, t('table', 'openSource', { source: fullSource }));
			this.renderIconOnlyCell(cell, task, column, fullSource, renderState, { focusable: false });
			const openSource = (): void => {
				this.callbacks.onOpenTaskSource?.(task.operonId);
			};
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
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.onOpenTaskSource?.(task.operonId);
		});
	}

	private renderValueCell(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		value: string,
		renderState: TableRenderState,
	): void {
		if (isTableProgressColumnKey(column.key)) {
			renderTableProgressCell(cell, {
				task,
				column,
				settings: renderState.settings,
				valueResolver: renderState.valueResolver,
				iconOnly: this.shouldUseIconOnlyColumn(column, renderState.settings),
				onActivate: this.callbacks.onContextualAction
					? ({ task: progressTask, track, trigger, actionAnchorRect }) => this.callbacks.onContextualAction?.(
						progressTask.operonId,
						track.kind === 'subtasks' ? 'subtasks' : 'checkboxes',
						{
							surface: 'tableTask',
							taskId: progressTask.operonId,
							task: progressTask,
							now: localNow(),
							isPinned: this.callbacks.isTaskPinned?.(progressTask.operonId) === true,
							hasSubtasks: track.kind === 'subtasks'
								? true
								: this.callbacks.hasSubtasks?.(progressTask.operonId) === true,
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
		if (column.key === 'duration') {
			this.renderDurationCell(cell, task, column, value, renderState);
			return;
		}
		if (column.key === PROJECT_SERIAL_TABLE_FIELD_KEY && !value.trim()) {
			return;
		}
		const editable = this.isEditableTaskCell(column.key, renderState);
		this.decorateEditableTaskCell(cell, task, column.key, value, renderState, editable);
		if (this.shouldUseIconOnlyColumn(column, renderState.settings)) {
			this.renderIconOnlyCell(cell, task, column, value, renderState, { focusable: !editable });
			return;
		}
		if (!value.trim()) {
			cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
			return;
		}
		renderTableCellChips(cell, column.key, value, {
			chipClassName: `operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip${editable ? ' operon-table-editable-chip' : ' operon-chip-readonly'}`,
			column,
			task,
			settings: renderState.settings,
			workflowStatusIdentityIndex: renderState.valueResolver.workflowStatusIdentityIndex,
			locationResolver: renderState.locationResolver,
			onLocationPreview: (trigger, visual) => this.openLocationMapPreview(trigger, task, visual, renderState),
		});
	}

	private bindLocationMapPreviewTrigger(
		trigger: HTMLElement,
		task: IndexedTask,
		visual: TableLocationCellVisual,
		renderState: TableRenderState,
	): void {
		const openPreview = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			this.openLocationMapPreview(trigger, task, visual, renderState);
		};
		trigger.addEventListener('click', openPreview);
		trigger.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			openPreview(event);
		});
	}

	private openLocationMapPreview(
		anchor: HTMLElement,
		task: IndexedTask,
		visual: TableLocationCellVisual,
		renderState: TableRenderState,
	): void {
		this.closeActivePicker();
		showLocationMapPreview(
			this.app,
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

	private renderDurationCell(
		cell: HTMLElement,
		task: IndexedTask,
		column: TableColumn,
		value: string,
		renderState: TableRenderState,
	): void {
		const sessions = this.callbacks.getTaskSessions?.(task.operonId) ?? [];
		const canEditSessions = !!this.callbacks.onAddTaskSession && !!this.callbacks.onEditTaskSession;
		const cellKey = buildTableEditableCellKey(task, 'duration');
		const iconOnly = this.shouldUseIconOnlyColumn(column, renderState.settings);
		cell.addClass('operon-table-duration-cell');
		if (!canEditSessions) {
			cell.setAttribute('aria-readonly', 'true');
			if (iconOnly) {
				this.renderIconOnlyCell(cell, task, column, value, renderState);
				return;
			}
			this.renderDurationFallbackValue(cell, value, renderState);
			return;
		}
		cell.addClass('is-editable');
		cell.dataset.editCellKey = cellKey;
		cell.tabIndex = 0;
		setAccessibleLabelWithoutTooltip(cell, `${getTableTaskFieldLabel('duration', renderState.settings)}. ${t('taskEditor', 'addSession')}`);
		this.syncPendingCellState(cell, cellKey);
		const openAdd = () => {
			if (this.pendingCellKey !== null) return;
			this.closeActivePicker();
			this.openAddTaskSessionModal(cell, task, cellKey);
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
			this.renderIconOnlyCell(cell, task, column, value, renderState, { focusable: false });
			return;
		}
		if (resolveTableDurationDisplayMode(column) === 'total') {
			this.renderDurationFallbackValue(cell, value, renderState);
			return;
		}
		if (sessions.length === 0) {
			this.renderDurationFallbackValue(cell, value, renderState);
		} else {
			const list = cell.createDiv('operon-table-duration-session-list');
			for (const session of sessions) {
				this.renderDurationSessionChip(list, cell, task, session, cellKey);
			}
		}
	}

	private renderDurationFallbackValue(cell: HTMLElement, value: string, renderState: TableRenderState): void {
		if (!value.trim()) {
			cell.createSpan({ cls: 'operon-table-empty-value', text: '--' });
			return;
		}
		const chip = cell.createSpan('operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip operon-chip-readonly');
		chip.setText(value);
	}

	private renderDurationSessionChip(
		container: HTMLElement,
		cell: HTMLElement,
		task: IndexedTask,
		session: TrackerSession,
		cellKey: string,
	): void {
		const chip = container.createEl('button', {
			cls: 'operon-table-duration-session-chip operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip operon-table-editable-chip',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(chip, t('taskEditor', 'editSession'));
		const label = formatDurationHuman(session.durationSeconds);
		chip.setText(label);
		chip.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			if (this.pendingCellKey !== null) return;
			this.closeActivePicker();
			this.openEditTaskSessionModal(cell, task, session, cellKey);
		});
	}

	private openAddTaskSessionModal(cell: HTMLElement, task: IndexedTask, cellKey: string): void {
		new TrackerSessionEditModal(this.app, {
			title: t('taskEditor', 'addSession'),
			contextTitle: task.description || task.operonId,
			onSave: async (start, end) => {
				await this.commitTaskSessionCellUpdate(cell, cellKey, async () => {
					const wrote = await this.callbacks.onAddTaskSession?.(task.operonId, start, end);
					return wrote !== false;
				});
			},
		}).open();
	}

	private openEditTaskSessionModal(cell: HTMLElement, task: IndexedTask, session: TrackerSession, cellKey: string): void {
		new TrackerSessionEditModal(this.app, {
			title: t('taskEditor', 'editSession'),
			...buildTrackerSessionEditContext({
				taskLabel: task.description || session.task.description || session.operonId,
				start: session.start,
				end: session.end,
			}),
			initialStart: session.start,
			initialEnd: session.end,
			onSave: async (start, end) => {
				await this.commitTaskSessionCellUpdate(cell, cellKey, async () => {
					const wrote = await this.callbacks.onEditTaskSession?.(session, start, end);
					return wrote !== false;
				});
			},
			onDelete: this.callbacks.onDeleteTaskSession
				? async () => {
					await this.commitTaskSessionCellUpdate(cell, cellKey, async () => {
						const deleted = await this.callbacks.onDeleteTaskSession?.(session);
						return deleted !== false;
					});
				}
				: undefined,
		}).open();
	}

	private async commitTaskSessionCellUpdate(
		cell: HTMLElement,
		cellKey: string,
		operation: () => Promise<boolean>,
	): Promise<void> {
		if (this.pendingCellKey !== null) return;
		this.pendingCellKey = cellKey;
		this.pendingFocusKey = cellKey;
		this.syncPendingCellState(cell, cellKey);
		try {
			const wrote = await operation();
			if (wrote === false) {
				new Notice(t('notifications', 'taskSaveFailed'));
			}
		} catch (error: unknown) {
			console.error('Operon: failed to update table tracker session', {
				error: error instanceof Error ? error.message : String(error),
			});
			new Notice(t('notifications', 'taskSaveFailed'));
		} finally {
			if (this.pendingCellKey === cellKey) {
				this.pendingCellKey = null;
			}
			this.clearRenderedPendingCellState(cellKey);
			this.queuePendingCellFocusRestore();
		}
	}

	private decorateEditableTaskCell(
		cell: HTMLElement,
		task: IndexedTask,
		key: string,
		value: string,
		renderState: TableRenderState,
		editable: boolean,
	): void {
		if (!editable || !this.callbacks.onUpdateTaskFields) {
			cell.setAttribute('aria-readonly', 'true');
			return;
		}
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
		this.syncPendingCellState(cell, cellKey);
		const openPicker = () => {
			if (this.pendingCellKey !== null) return;
			this.closeActivePicker();
			const allTasks = this.indexer.getAllTasks();
			const closePicker = openTaskFieldPicker({
				app: this.app,
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
					void this.commitTaskCellUpdate(cell, task, key, cellKey, normalizedPayload);
				},
				onOpenNote: () => {
					this.callbacks.onOpenTaskEditor?.(task.operonId);
				},
				onClose: () => {
					if (this.activePickerClose === closePicker) {
						this.activePickerClose = null;
						this.keepActivePickerOnRender = false;
					}
				},
			});
			if (!closePicker) return;
			this.keepActivePickerOnRender = true;
			this.activePickerClose = closePicker;
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

	private async commitTaskCellUpdate(
		cell: HTMLElement,
		task: IndexedTask,
		key: string,
		cellKey: string,
		payload: Record<string, string>,
		options: { showFailureNotice?: boolean } = {},
	): Promise<boolean> {
		const showFailureNotice = options.showFailureNotice !== false;
		if (this.pendingCellKey !== null) return false;
		this.pendingCellKey = cellKey;
		this.pendingFocusKey = cellKey;
		this.syncPendingCellState(cell, cellKey);
		this.closeActivePicker();
		let success = false;
		try {
			const wrote = await this.callbacks.onUpdateTaskFields?.(task.operonId, payload);
			if (wrote === false) {
				if (showFailureNotice) new Notice(t('notifications', 'taskSaveFailed'));
			} else {
				success = true;
			}
		} catch (error: unknown) {
			console.error('Operon: failed to update table task cell', {
				operonId: task.operonId,
				key,
				error: error instanceof Error ? error.message : String(error),
			});
			if (showFailureNotice) new Notice(t('notifications', 'taskSaveFailed'));
		} finally {
			if (this.pendingCellKey === cellKey) {
				this.pendingCellKey = null;
			}
			this.clearRenderedPendingCellState(cellKey);
			this.queuePendingCellFocusRestore();
		}
		return success;
	}

	private syncPendingCellState(cell: HTMLElement, cellKey: string): void {
		const pending = this.pendingCellKey === cellKey;
		cell.classList.toggle('is-pending', pending);
		if (pending) {
			cell.setAttribute('aria-busy', 'true');
			cell.setAttribute('aria-disabled', 'true');
			return;
		}
		cell.removeAttribute('aria-busy');
		cell.removeAttribute('aria-disabled');
	}

	private clearRenderedPendingCellState(cellKey: string): void {
		for (const cell of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.operon-table-cell.is-pending'))) {
			if (cell.dataset.editCellKey !== cellKey) continue;
			cell.classList.remove('is-pending');
			cell.removeAttribute('aria-busy');
			cell.removeAttribute('aria-disabled');
		}
	}

	private restorePendingCellFocus(): void {
		const cellKey = this.pendingFocusKey;
		if (!cellKey) return;
		this.pendingFocusKey = null;
		const cell = this.findRenderedEditableCell(cellKey);
		(cell ?? this.bodyScrollerEl)?.focus();
	}

	private queuePendingCellFocusRestore(): void {
		window.requestAnimationFrame(() => {
			this.restorePendingCellFocus();
		});
	}

	private findRenderedEditableCell(cellKey: string): HTMLElement | null {
		return Array.from(this.contentEl.querySelectorAll<HTMLElement>('.operon-table-cell.is-editable'))
			.find(candidate => candidate.dataset.editCellKey === cellKey) ?? null;
	}

	private closeActivePicker(): void {
		const close = this.activePickerClose;
		this.activePickerClose = null;
		this.keepActivePickerOnRender = false;
		close?.();
	}

	private closeSearchTransientUi(): void {
		const input = this.contentEl.querySelector<HTMLInputElement>('.operon-table-search-input');
		if (input && this.contentEl.ownerDocument.activeElement === input) {
			input.blur();
		}
	}

	private isEditableTaskCell(key: string, renderState: TableRenderState): boolean {
		return isEditableTableTaskFieldKey(key, renderState.settings);
	}

	private renderEmptyState(root: HTMLElement, searchEmpty: boolean): void {
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

	private scheduleVisibleRowsRender(): void {
		if (this.visibleRowsFrame !== null) return;
		this.visibleRowsFrame = window.requestAnimationFrame(() => {
			this.visibleRowsFrame = null;
			this.renderVisibleRows();
		});
	}

	private hasActiveMobileInlineEdit(): boolean {
		return Platform.isPhone && this.activeMobileInlineEdit !== null;
	}

	private shouldDeferMobileVisibleRowsRender(): boolean {
		return this.hasActiveMobileInlineEdit()
			|| isMobileTableTextInputFocused(this.contentEl);
	}

	private beginMobileInlineEdit(session: TableInlineEditSession): void {
		if (!Platform.isPhone) return;
		this.finishMobileInlineEdit(true);
		this.activeMobileInlineEdit = session;
		this.pendingSearchFocus = null;
	}

	private endMobileInlineEdit(session: TableInlineEditSession): void {
		if (this.activeMobileInlineEdit !== session) return;
		this.activeMobileInlineEdit = null;
		this.flushMobileDeferredVisibleRows();
	}

	private finishMobileInlineEdit(commit: boolean): void {
		const session = this.activeMobileInlineEdit;
		if (!session) return;
		session.finish(commit);
	}

	private bindMobileViewport(root: HTMLElement): void {
		this.cleanupMobileViewport();
		this.mobileViewportCleanup = bindMobileTableViewport(root, () => {
			this.lastRenderedRangeKey = null;
			if (this.shouldDeferMobileVisibleRowsRender()) {
				this.pendingMobileTextInputRender = true;
				return;
			}
			this.flushMobileDeferredVisibleRows();
			this.scheduleVisibleRowsRender();
		});
	}

	private cleanupMobileViewport(): void {
		this.mobileViewportCleanup?.();
		this.mobileViewportCleanup = null;
	}

	private flushMobileDeferredVisibleRows(): void {
		if (this.shouldDeferMobileVisibleRowsRender()) return;
		const shouldRender = this.pendingMobileTextInputRender && !!this.bodyCanvasEl?.isConnected;
		this.pendingMobileTextInputRender = false;
		if (!shouldRender) return;
		this.lastRenderedRangeKey = null;
		this.scheduleVisibleRowsRender();
	}

	private observeTableBodyResize(shell: HTMLElement, bodyScroller: HTMLElement): void {
		this.cleanupTableResizeObserver();
		const ownerWindow = getOwnerWindow(bodyScroller) as unknown as { ResizeObserver?: TableResizeObserverConstructor };
		const ResizeObserverCtor = ownerWindow.ResizeObserver;
		if (!ResizeObserverCtor) return;
		const observer = new ResizeObserverCtor(() => {
			this.lastRenderedRangeKey = null;
			this.scheduleVisibleRowsRender();
		});
		observer.observe(shell);
		observer.observe(bodyScroller);
		this.tableResizeObserverCleanup = () => {
			observer.disconnect();
		};
	}

	private cleanupTableResizeObserver(): void {
		this.tableResizeObserverCleanup?.();
		this.tableResizeObserverCleanup = null;
	}

	private scheduleDeferredSummaryRefresh(): void {
		if (this.summaryIdleTimer !== null) {
			window.clearTimeout(this.summaryIdleTimer);
			this.summaryIdleTimer = null;
		}
		const token = ++this.summaryRefreshToken;
		const delayMs = getTableSummaryIdleDelayMs(this.currentRenderState?.rows.length ?? 0);
		this.summaryIdleTimer = window.setTimeout(() => {
			this.summaryIdleTimer = null;
			const renderState = this.currentRenderState;
			if (!renderState || !renderState.summariesCalculating || token !== this.summaryRefreshToken) return;
			const startedAt = enginePerfNow();
			const evaluated = evaluateTableQuerySummaries({
				rows: renderState.rows,
				groups: renderState.groups,
				rules: renderState.preset.summaries,
				allTasks: renderState.allTasks,
				settings: renderState.settings,
				valueResolver: renderState.valueResolver,
			});
			if (token !== this.summaryRefreshToken) return;
			this.deferSummariesForSearch = false;
			if (renderState.noSearchResultCacheKey
				&& this.noSearchResultCache?.key === renderState.noSearchResultCacheKey) {
				this.noSearchResultCache = {
					key: renderState.noSearchResultCacheKey,
					result: {
						...this.noSearchResultCache.result,
						summaries: evaluated.summaries,
						groupSummaries: evaluated.groupSummaries,
					},
					summariesEvaluated: true,
				};
			}
			this.currentRenderState = {
				...renderState,
				summaries: evaluated.summaries,
				groupSummaries: evaluated.groupSummaries,
				summariesCalculating: false,
			};
			this.lastRenderedRangeKey = null;
			this.renderVisibleRows(true);
			enginePerfLog(
				'table.summaries.deferred',
				`${Math.round(enginePerfNow() - startedAt)}ms`,
				`rows=${renderState.rows.length}`,
				`groups=${renderState.groups.length}`,
			);
		}, delayMs);
	}

	private scheduleSearchPrewarm(
		tasks: readonly IndexedTask[],
		tasksToPrewarm: readonly IndexedTask[],
		settings: OperonSettings,
		columns: readonly TableColumn[],
		normalizedSearchQuery: string,
	): void {
		if (normalizedSearchQuery.length > 0 || tasks.length === 0 || tasksToPrewarm.length === 0 || columns.length === 0) {
			this.cancelSearchPrewarm();
			return;
		}
		if (!this.containerEl.isConnected || this.containerEl.offsetParent === null) {
			this.cancelSearchPrewarm();
			return;
		}
		const generation = this.indexer.getGeneration();
		const projectSerialSignature = this.callbacks.getProjectSerialSignature?.() ?? '';
		const prewarmKey = buildTableTaskSearchMatcherSignature(tasks, settings, generation, columns, projectSerialSignature);
		if (this.completedSearchPrewarmKey === prewarmKey || this.searchPrewarmKey === prewarmKey) return;
		this.cancelSearchPrewarm();
		this.searchPrewarmKey = prewarmKey;
		this.searchPrewarmIndex = 0;
		this.searchPrewarmTimer = window.setTimeout(() => {
			this.searchPrewarmTimer = null;
			this.runSearchPrewarmChunk(prewarmKey, tasks, tasksToPrewarm, settings, generation, columns);
		}, TABLE_SEARCH_PREWARM_DELAY_MS);
	}

	private runSearchPrewarmChunk(
		prewarmKey: string,
		tasks: readonly IndexedTask[],
		tasksToPrewarm: readonly IndexedTask[],
		settings: OperonSettings,
		generation: number | string,
		columns: readonly TableColumn[],
	): void {
		if (this.searchPrewarmKey !== prewarmKey) return;
		if (!this.containerEl.isConnected || this.containerEl.offsetParent === null || this.indexer.getGeneration() !== generation) {
			this.cancelSearchPrewarm();
			return;
		}
		if (this.resolveNormalTextSearchQueryForRender(this.state.searchQuery).length > 0) {
			this.cancelSearchPrewarm();
			return;
		}
		const startedAt = enginePerfNow();
		const result = this.searchMatcherCache.prewarm({
			tasks,
			settings,
			generation,
			columns,
			valueResolverOptions: { getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay },
			valueResolverSignature: this.callbacks.getProjectSerialSignature?.() ?? '',
		}, {
			startIndex: this.searchPrewarmIndex,
			timeBudgetMs: TABLE_SEARCH_PREWARM_TIME_BUDGET_MS,
			maxTasks: TABLE_SEARCH_PREWARM_MAX_TASKS_PER_CHUNK,
			tasksToWarm: tasksToPrewarm,
		});
		this.searchPrewarmIndex = result.nextIndex;
		if (result.done) {
			this.completedSearchPrewarmKey = prewarmKey;
			this.searchPrewarmKey = null;
			this.searchPrewarmIndex = 0;
			enginePerfLog(
				'table.search.prewarm',
				`${Math.round(enginePerfNow() - startedAt)}ms`,
				`tasks=${tasksToPrewarm.length}`,
				`status=complete`,
			);
			return;
		}
		this.searchPrewarmChunkTimer = window.setTimeout(() => {
			this.searchPrewarmChunkTimer = null;
			this.runSearchPrewarmChunk(prewarmKey, tasks, tasksToPrewarm, settings, generation, columns);
		}, TABLE_SEARCH_PREWARM_CHUNK_DELAY_MS);
	}

	private cancelSearchPrewarm(): void {
		if (this.searchPrewarmTimer !== null) {
			window.clearTimeout(this.searchPrewarmTimer);
			this.searchPrewarmTimer = null;
		}
		if (this.searchPrewarmChunkTimer !== null) {
			window.clearTimeout(this.searchPrewarmChunkTimer);
			this.searchPrewarmChunkTimer = null;
		}
		this.searchPrewarmKey = null;
		this.searchPrewarmIndex = 0;
	}

	private getCurrentPreset(): TablePreset | null {
		const settings = this.getSettings();
		const state = this.ensureState();
		const requestedPresetId = state.presetId ?? settings.tableDefaultPresetId;
		return settings.tablePresets.find(preset => preset.id === requestedPresetId)
			?? settings.tablePresets.find(preset => preset.id === settings.tableDefaultPresetId)
			?? settings.tablePresets[0]
			?? null;
	}

	private getCurrentEditingPreset(): TablePreset {
		return resolveTableEditingPreset(this.getCurrentPreset(), this.currentRenderState?.preset ?? null);
	}

	private resolveTableSearchContext(
		filterSet: ReturnType<typeof resolveTablePresetFilterSet>,
		tasks: IndexedTask[],
		settings: OperonSettings,
	): TableSearchContext {
		const filterScopedTasks = resolveTableSearchBaseScopeTasks({
			filterSet,
			tasks,
			priorities: settings.priorities,
			pinnedCache: this.getPinnedCache(),
		});
		const recentModifiedCutoff = getTaskSearchBoxRecentModifiedCutoff(settings);
		const scopedTasks = filterScopedTasks.filter(task => matchesTaskSearchBoxScope(task, this.searchScope, { recentModifiedCutoff }));
		const parentSearchUi = this.buildParentSearchUiState(this.state.searchQuery, scopedTasks, filterScopedTasks, settings);
		const taskIdFilter = parentSearchUi?.selectedParentId
			? resolveTableParentSearchVisibleTaskIds(
				parentSearchUi.selectedParentId,
				parentSearchUi.mode,
				scopedTasks,
				this.getParentSearchResolvers(),
			)
			: undefined;
		const scopeFilteredTasks = taskIdFilter
			? scopedTasks.filter(task => taskIdFilter.has(task.operonId))
			: scopedTasks;
		const activeSearchQuery = getTableActiveTextSearchQuery(this.state.searchQuery, parentSearchUi);
		return {
			parentSearchUi,
			activeSearchQuery,
			scopedTasks,
			scopeFilteredTasks,
			taskIdFilter,
			scopeKey: this.buildSearchScopeKey(JSON.stringify(filterSet ?? null), scopedTasks, scopeFilteredTasks, settings, recentModifiedCutoff),
		};
	}

	private buildSearchScopeKey(
		filterSetSignature: string,
		scopedTasks: readonly IndexedTask[],
		scopeFilteredTasks: readonly IndexedTask[],
		settings: OperonSettings,
		recentModifiedCutoff: number,
	): string {
		return [
			this.indexer.getGeneration(),
			this.getPinnedCache()?.getGeneration() ?? 0,
			this.state.presetId ?? '',
			filterSetSignature,
			buildTableRelevantSettingsSignature(settings),
			this.callbacks.getProjectSerialSignature?.() ?? '',
			JSON.stringify(this.searchScope),
			this.searchScope.showRecentModified ? `recentModifiedCutoff=${recentModifiedCutoff}` : '',
			this.parentSearchSelection ? `${this.parentSearchSelection.mode}:${this.parentSearchSelection.parentId}` : '',
			`scoped=${scopedTasks.length}`,
			`scopeFiltered=${scopeFilteredTasks.length}`,
		].join('|');
	}

	private resolveSortedSearchBaseRows(input: {
		preset: TablePreset;
		filterSet: ReturnType<typeof resolveTablePresetFilterSet>;
		tasks: IndexedTask[];
		settings: OperonSettings;
		searchContext: TableSearchContext;
		columns: readonly TableColumn[];
		cacheKey: string;
	}): IndexedTask[] {
		if (this.sortedRowsCache?.key === input.cacheKey) return this.sortedRowsCache.rows;
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
			pinnedCache: this.getPinnedCache(),
			settings: input.settings,
			precomputedScopedTasks: input.searchContext.scopedTasks,
			precomputedScopeFilteredTasks: input.searchContext.scopeFilteredTasks,
			summaryMode: 'skip',
			valueResolverOptions: { getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay },
		});
		this.sortedRowsCache = {
			key: input.cacheKey,
			rows: result.rows,
		};
		return result.rows;
	}

	private resolveIncrementalSearchedTasks(
		scopeFilteredTasks: readonly IndexedTask[],
		normalizedQuery: string,
		searchMatcher: (task: IndexedTask, normalizedQuery: string) => boolean,
		scopeKey: string,
	): IndexedTask[] {
		const previous = this.incrementalSearchCache;
		const canNarrowPrevious = !!previous
			&& previous.scopeKey === scopeKey
			&& previous.query.length > 0
			&& isTableSearchNarrowingSafe(previous.query, normalizedQuery);
		const searchBase = canNarrowPrevious ? previous.rows : scopeFilteredTasks;
		const rows = searchBase.filter(task => searchMatcher(task, normalizedQuery));
		this.incrementalSearchCache = { scopeKey, query: normalizedQuery, rows };
		return rows;
	}

	private buildParentSearchUiState(
		rawQuery: string,
		scopedTasks: IndexedTask[],
		candidateTasks: IndexedTask[],
		settings: OperonSettings,
	): TableParentSearchUiState | null {
		const mode = this.searchScope.projectMode;
		if (!mode) {
			this.parentSearchSelection = null;
			return null;
		}
		const trimmedQuery = rawQuery.trim();
		const queryMeetsThreshold = !trimmedQuery || trimmedQuery.length >= TABLE_SEARCH_PARENT_MIN_QUERY_LENGTH;
		const normalizedQuery = queryMeetsThreshold ? trimmedQuery.toLocaleLowerCase() : '';
		const candidates = queryMeetsThreshold
			? buildTableParentSearchCandidates({
				scopedTasks,
				candidateTasks,
				mode,
				normalizedQuery,
				resolvers: this.getParentSearchResolvers(),
				settings,
			})
			: [];
		const retainedSelection = resolveTableParentSearchSelection(this.parentSearchSelection, mode);
		this.parentSearchSelection = retainedSelection;
		const selectedParentId = retainedSelection?.parentId ?? null;
		this.parentSearchHighlightedIndex = Math.min(
			Math.max(this.parentSearchHighlightedIndex, 0),
			Math.max(0, Math.min(candidates.length, TABLE_PARENT_SEARCH_MAX_CANDIDATES) - 1),
		);
		return {
			mode,
			query: normalizedQuery,
			candidates,
			selectedParentId,
			dropdownVisible: !this.parentSearchDismissed && !selectedParentId,
		};
	}

	private getParentSearchResolvers(): {
		getChildIds: (parentId: string) => Iterable<string>;
		getAllDescendantIds: (parentId: string) => Iterable<string>;
	} {
		return {
			getChildIds: parentId => this.indexer.secondary.getChildIds(parentId),
			getAllDescendantIds: parentId => this.indexer.secondary.getAllDescendantIds(parentId),
		};
	}

	private async switchPreset(presetId: string): Promise<void> {
		this.closeActivePicker();
		this.resetSearchPerformanceState();
		const nextState = this.normalizeState({
			...this.ensureState(),
			presetId,
			scrollTop: 0,
			scrollLeft: 0,
			collapsedGroupKeys: [],
		});
		if (areTableLeafStatesEqual(this.state, nextState)) return;
		this.state = nextState;
		this.syncTableSearchStateFromPreset(this.getCurrentPreset(), { force: true });
		this.render();
		this.scheduleLeafStatePersistence();
	}

	private handleTableSearchInput(searchInput: HTMLInputElement, immediate: boolean): void {
		const shortcutResult = applyTaskSearchBoxShortcutCommand(
			searchInput.value,
			this.searchScope,
			this.getSettings(),
			{
				disabledKeys: TABLE_SEARCH_BOX_DISABLED_KEYS,
				preserveTerminalStateScopes: true,
			},
		);
		let nextSearchQuery = searchInput.value;
		if (shortcutResult.handled) {
			nextSearchQuery = shortcutResult.query;
			searchInput.value = nextSearchQuery;
			const previousProjectMode = this.searchScope.projectMode;
			this.searchScope = shortcutResult.scope;
			if (previousProjectMode !== this.searchScope.projectMode) {
				this.parentSearchSelection = null;
			}
			this.parentSearchDismissed = false;
			this.parentSearchHighlightedIndex = 0;
			this.saveCurrentTablePresetSearchState();
			immediate = true;
		}
		if (this.searchScope.projectMode && nextSearchQuery !== this.state.searchQuery) {
			this.parentSearchDismissed = false;
		}
		if (this.searchScope.projectMode !== this.parentSearchSelection?.mode) {
			this.parentSearchSelection = null;
		}
		if (immediate) {
			this.setSearchQuery(nextSearchQuery, shortcutResult.handled);
		} else {
			this.queueSearchQuery(nextSearchQuery);
		}
	}

	private toggleSearchScopeKey(key: TaskFinderDefaultScopeKey): void {
		this.closeActivePicker();
		this.resetSearchPerformanceState();
		const previousProjectMode = this.searchScope.projectMode;
		this.searchScope = toggleTaskSearchBoxScope(this.searchScope, key, {
			preserveTerminalStateScopes: true,
		});
		if (previousProjectMode !== this.searchScope.projectMode) {
			this.parentSearchSelection = null;
		}
		this.parentSearchDismissed = false;
		this.parentSearchHighlightedIndex = 0;
		this.saveCurrentTablePresetSearchState();
		this.state = this.normalizeState({
			...this.ensureState(),
			scrollTop: 0,
			scrollLeft: 0,
		});
		if (this.horizontalScrollerEl) {
			this.horizontalScrollerEl.scrollLeft = 0;
		}
		if (this.bodyScrollerEl) {
			this.bodyScrollerEl.scrollTop = 0;
		}
		this.scheduleRender();
		this.scheduleLeafStatePersistence();
	}

	private resetTableSearchScope(options: { preserveNoSearchResultCache?: boolean; preserveSortedRowsCache?: boolean } = {}): void {
		this.searchScope = cloneTableSearchBoxScopeState(TABLE_SEARCH_BOX_DEFAULT_SCOPE);
		this.parentSearchSelection = null;
		this.parentSearchHighlightedIndex = 0;
		this.parentSearchDismissed = false;
		this.resetSearchPerformanceState(options);
	}

	private clearTableSearchState(): void {
		this.resetTableSearchScope({ preserveNoSearchResultCache: true, preserveSortedRowsCache: true });
		this.saveCurrentTablePresetSearchState();
		this.setSearchQuery('', true);
	}

	private clearParentSearchState(): void {
		this.resetSearchPerformanceState();
		this.searchScope = {
			...this.searchScope,
			projectMode: null,
		};
		this.parentSearchSelection = null;
		this.parentSearchHighlightedIndex = 0;
		this.parentSearchDismissed = false;
		this.saveCurrentTablePresetSearchState();
		this.state = this.normalizeState({
			...this.ensureState(),
			scrollTop: 0,
			scrollLeft: 0,
		});
		if (this.horizontalScrollerEl) {
			this.horizontalScrollerEl.scrollLeft = 0;
		}
		if (this.bodyScrollerEl) {
			this.bodyScrollerEl.scrollTop = 0;
		}
		this.scheduleRender();
		this.scheduleLeafStatePersistence();
	}

	private selectParentSearchCandidate(mode: ProjectSearchMode, candidate: ProjectSearchCandidate): void {
		this.resetSearchPerformanceState();
		this.parentSearchSelection = {
			mode,
			parentId: candidate.task.operonId,
			parentName: candidate.task.description,
		};
		this.parentSearchDismissed = true;
		this.parentSearchHighlightedIndex = 0;
		this.saveCurrentTablePresetSearchState();
		this.state = this.normalizeState({
			...this.ensureState(),
			searchQuery: '',
			scrollTop: 0,
			scrollLeft: 0,
		});
		if (this.horizontalScrollerEl) {
			this.horizontalScrollerEl.scrollLeft = 0;
		}
		if (this.bodyScrollerEl) {
			this.bodyScrollerEl.scrollTop = 0;
		}
		this.scheduleRender();
		this.scheduleLeafStatePersistence();
		this.focusTableSearchInput();
	}

	private updateParentSearchHighlight(nextIndex: number): void {
		this.parentSearchHighlightedIndex = updateSearchParentHighlight({
			root: this.contentEl,
			itemSelector: '.operon-table-parent-search-item',
			currentIndex: this.parentSearchHighlightedIndex,
			nextIndex,
		});
	}

	private focusTableSearchInput(): void {
		const input = this.contentEl.querySelector<HTMLInputElement>('.operon-table-search-input');
		const fallbackPosition = input?.value.length ?? this.ensureState().searchQuery.length;
		this.pendingSearchFocus = {
			start: input?.selectionStart ?? fallbackPosition,
			end: input?.selectionEnd ?? fallbackPosition,
		};
		window.requestAnimationFrame(() => {
			this.restoreSearchFocus();
		});
	}

	private setSearchQuery(searchQuery: string, forceRender = false): void {
		this.closeActivePicker();
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
			this.searchDebounceTimer = null;
		}
		const normalizedQuery = clampTableSearchQuery(searchQuery);
		const current = this.ensureState();
		if (!forceRender && current.searchQuery === normalizedQuery && current.scrollTop === 0) return;
		const currentActiveQuery = this.resolveNormalTextSearchQueryForRender(current.searchQuery);
		const nextActiveQuery = this.resolveNormalTextSearchQueryForRender(normalizedQuery);
		const isClearingActiveSearch = currentActiveQuery.length > 0 && nextActiveQuery.length === 0;
		const canSkipRender = !forceRender
			&& !this.searchScope.projectMode
			&& current.scrollTop === 0
			&& currentActiveQuery === nextActiveQuery;
		this.summaryRefreshToken++;
		if (this.summaryIdleTimer !== null) {
			window.clearTimeout(this.summaryIdleTimer);
			this.summaryIdleTimer = null;
		}
		this.deferSummariesForSearch = nextActiveQuery.length > 0 || isClearingActiveSearch;
		if (!this.deferSummariesForSearch) {
			this.incrementalSearchCache = null;
		}
		this.cancelSearchPrewarm();
		this.state = this.normalizeState({
			...current,
			searchQuery: normalizedQuery,
			scrollTop: canSkipRender ? current.scrollTop : 0,
			scrollLeft: canSkipRender ? current.scrollLeft : 0,
		});
		if (canSkipRender) {
			this.scheduleLeafStatePersistence();
			return;
		}
		if (this.bodyScrollerEl) {
			this.bodyScrollerEl.scrollTop = 0;
		}
		if (this.horizontalScrollerEl) {
			this.horizontalScrollerEl.scrollLeft = 0;
		}
		this.scheduleRender();
		this.scheduleLeafStatePersistence();
	}

	private resolveNormalTextSearchQueryForRender(rawQuery: string): string {
		return getTableNormalTextSearchQuery(rawQuery);
	}

	private queueSearchQuery(searchQuery: string): void {
		if (isTableActiveTextSearchClearing(this.ensureState().searchQuery, searchQuery)) {
			this.setSearchQuery(searchQuery);
			return;
		}
		if (this.searchDebounceTimer !== null) {
			window.clearTimeout(this.searchDebounceTimer);
		}
		this.searchDebounceTimer = window.setTimeout(() => {
			this.searchDebounceTimer = null;
			this.setSearchQuery(searchQuery);
		}, TABLE_SEARCH_DEBOUNCE_MS);
	}

	private resetSearchPerformanceState(options: { preserveNoSearchResultCache?: boolean; preserveSortedRowsCache?: boolean } = {}): void {
		this.incrementalSearchCache = null;
		if (!options.preserveSortedRowsCache) {
			this.sortedRowsCache = null;
		}
		if (!options.preserveNoSearchResultCache) {
			this.noSearchResultCache = null;
		}
		this.deferSummariesForSearch = false;
		this.summaryRefreshToken++;
		this.completedSearchPrewarmKey = null;
		this.cancelSearchPrewarm();
		if (this.summaryIdleTimer !== null) {
			window.clearTimeout(this.summaryIdleTimer);
			this.summaryIdleTimer = null;
		}
	}

	private resetCollapsedGroupsWhenGroupChanges(preset: TablePreset): void {
		const groupStateKey = `${preset.id}:${preset.groupBy ?? ''}:${preset.groupOrder}:${preset.subgroupBy ?? ''}:${preset.subgroupOrder}`;
		if (this.lastGroupStateKey !== null
			&& this.lastGroupStateKey !== groupStateKey
			&& this.state.collapsedGroupKeys.length > 0) {
			this.state = this.normalizeState({
				...this.ensureState(),
				collapsedGroupKeys: [],
			});
			this.scheduleLeafStatePersistence();
		}
		this.lastGroupStateKey = groupStateKey;
	}

	private buildHeaderPresetPatch(updatedPreset: TablePreset, scope: TableHeaderPresetPatchScope): TablePresetPatch {
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

	private savePresetPatch(patch: TablePresetPatch, context: string): void {
		if (!this.callbacks.onSavePresetPatch) return;
		this.callbacks.onSavePresetPatch(patch).catch(error => {
			console.error(context, error);
			new Notice(t('table', 'presetActionFailed'));
		});
	}

	private savePresetGroupSortDraft(updatedPreset: TablePreset, scope: TableGroupSortPresetPatchScope): void {
		const currentPreset = this.getCurrentEditingPreset();
		const groupingChanged = (updatedPreset.groupBy ?? null) !== (currentPreset.groupBy ?? null)
			|| updatedPreset.groupOrder !== currentPreset.groupOrder
			|| (updatedPreset.subgroupBy ?? null) !== (currentPreset.subgroupBy ?? null)
			|| updatedPreset.subgroupOrder !== currentPreset.subgroupOrder;
		if (scope === 'grouping' && groupingChanged) {
			this.state = this.normalizeState({
				...this.ensureState(),
				scrollTop: 0,
				scrollLeft: 0,
				collapsedGroupKeys: [],
			});
			if (this.horizontalScrollerEl) {
				this.horizontalScrollerEl.scrollLeft = 0;
			}
			if (this.bodyScrollerEl) {
				this.bodyScrollerEl.scrollTop = 0;
			}
			this.scheduleLeafStatePersistence();
		}
		this.savePresetPatch(buildTableGroupSortPresetPatch(updatedPreset, scope), 'Operon: failed to save table group sort preset patch');
	}

	private toggleGroupCollapsed(groupKey: string): void {
		this.closeActivePicker();
		this.finishMobileInlineEdit(true);
		const current = this.ensureState();
		const collapsed = new Set(current.collapsedGroupKeys);
		if (collapsed.has(groupKey)) {
			collapsed.delete(groupKey);
		} else {
			collapsed.add(groupKey);
		}
		const nextCollapsedGroupKeys = Array.from(collapsed);
		this.state = this.normalizeState({
			...current,
			collapsedGroupKeys: nextCollapsedGroupKeys,
		});
		if (this.currentRenderState) {
			const hasSummaryRow = hasVisibleTableSummaryRule(this.currentRenderState.preset.summaries, this.currentRenderState.taskColumns);
			const items = buildTableRenderItems(
				this.currentRenderState.rows,
				this.currentRenderState.groups,
				nextCollapsedGroupKeys,
				hasSummaryRow,
			);
			const ordinalItems = nextCollapsedGroupKeys.length === 0
				? items
				: buildTableRenderItems(this.currentRenderState.rows, this.currentRenderState.groups, [], hasSummaryRow);
			this.currentRenderState = {
				...this.currentRenderState,
				items,
				taskOrdinals: buildTableTaskOrdinalMap(ordinalItems),
			};
		}
		this.contentEl.querySelector<HTMLElement>('.operon-table-shell')?.setAttribute(
			'aria-rowcount',
			String((this.currentRenderState?.items.length ?? 0) + 1),
		);
		this.lastRenderedRangeKey = null;
		this.renderVisibleRows(true);
		this.scheduleLeafStatePersistence();
	}

	private isGroupCollapsed(groupKey: string): boolean {
		return this.state.collapsedGroupKeys.includes(groupKey);
	}

	private restoreSearchFocus(): void {
		if (this.hasActiveMobileInlineEdit()) {
			this.pendingSearchFocus = null;
			return;
		}
		const pending = this.pendingSearchFocus;
		if (!pending) return;
		const input = this.contentEl.querySelector<HTMLInputElement>('.operon-table-search-input');
		if (!input) return;
		this.pendingSearchFocus = null;
		input.focus({ preventScroll: true });
		try {
			input.setSelectionRange(pending.start, pending.end);
		} catch {
			// Some input types/themes may reject programmatic selection; focus restoration is enough.
		}
	}

	private isSearchEmpty(scopedTaskCount: number): boolean {
		return scopedTaskCount > 0
			&& isTableSearchScopeActive(this.searchScope, this.parentSearchSelection, this.ensureState().searchQuery);
	}

	private scheduleLeafStatePersistence(): void {
		if (this.persistStateTimer !== null) {
			window.clearTimeout(this.persistStateTimer);
		}
		this.persistStateTimer = window.setTimeout(() => {
			this.persistStateTimer = null;
			void this.app.workspace.requestSaveLayout();
		}, 80);
	}

	private syncTableSearchStateFromPreset(
		preset: TablePreset | null,
		options: { force?: boolean } = {},
	): void {
		if (!preset) return;
		const signature = this.buildPresetSearchSignature(preset.id, preset.search);
		if (!options.force) {
			if (signature === this.appliedPresetSearchSignature) {
				if (this.pendingPresetSearchSignature === signature) {
					this.pendingPresetSearchSignature = null;
				}
				return;
			}
			if (this.pendingPresetSearchSignature && signature !== this.pendingPresetSearchSignature) return;
		}
		const search = cloneTablePresetSearchState(preset.search);
		this.searchScope = cloneTableSearchBoxScopeState(search.scope);
		this.parentSearchSelection = search.parent
			? {
				mode: search.parent.mode,
				parentId: search.parent.parentId,
				parentName: search.parent.parentName ?? search.parent.parentId,
			}
			: null;
		this.parentSearchHighlightedIndex = 0;
		this.parentSearchDismissed = false;
		this.appliedPresetSearchSignature = signature;
		if (this.pendingPresetSearchSignature === signature) {
			this.pendingPresetSearchSignature = null;
		}
		this.resetSearchPerformanceState();
	}

	private buildCurrentTablePresetSearchState(): TablePresetSearchState {
		return {
			scope: cloneTableSearchBoxScopeState(this.searchScope),
			parent: this.parentSearchSelection && this.parentSearchSelection.mode === this.searchScope.projectMode
				? { ...this.parentSearchSelection }
				: null,
		};
	}

	private saveCurrentTablePresetSearchState(): void {
		const currentPreset = this.getCurrentPreset();
		if (!currentPreset) return;
		const search = this.buildCurrentTablePresetSearchState();
		const signature = this.buildPresetSearchSignature(currentPreset.id, search);
		this.appliedPresetSearchSignature = signature;
		this.pendingPresetSearchSignature = signature;
		if (this.currentRenderState?.preset.id === currentPreset.id) {
			this.currentRenderState = {
				...this.currentRenderState,
				preset: {
					...cloneTablePreset(this.currentRenderState.preset),
					search,
				},
			};
		}
		if (!this.callbacks.onSavePresetPatch) return;
		this.callbacks.onSavePresetPatch({
			id: currentPreset.id,
			search,
		}).then(() => {
			if (this.pendingPresetSearchSignature === signature) {
				this.pendingPresetSearchSignature = null;
			}
		}).catch(error => {
			console.error('Operon: failed to save table preset search scope', error);
			this.recoverTablePresetSearchStateAfterFailedSave(signature);
			new Notice(t('table', 'presetActionFailed'));
		});
	}

	private buildPresetSearchSignature(presetId: string, search: TablePresetSearchState): string {
		return `${presetId}:${JSON.stringify(search)}`;
	}

	private recoverTablePresetSearchStateAfterFailedSave(signature: string): void {
		const recovery = resolveTablePresetSearchSaveFailureRecovery(this.pendingPresetSearchSignature, signature);
		this.pendingPresetSearchSignature = recovery.pendingPresetSearchSignature;
		if (!recovery.shouldRecover) return;
		this.syncTableSearchStateFromPreset(this.getCurrentPreset(), { force: true });
		this.scheduleRender();
	}

	private savePresetFromHeader(updatedPreset: TablePreset, scope: TableHeaderPresetPatchScope): void {
		this.savePresetPatch(this.buildHeaderPresetPatch(updatedPreset, scope), 'Operon: failed to save table preset patch');
	}

	private cleanupActiveResize(): void {
		cleanupTableHeaderActiveResize(this.headerInteractionState);
	}

	private applyColumnTemplate(columns: readonly TableColumn[]): void {
		const columnGeometry = applyInteractiveTableColumnTemplate(this.contentEl, this.currentRenderState, columns);
		if (this.currentRenderState) {
			this.currentRenderState = {
				...this.currentRenderState,
				tableWidthPx: columnGeometry.tableWidthPx,
				columnGeometry,
			};
		}
	}

	private ensureState(): TableLeafState {
		this.state = this.normalizeState(this.state);
		return this.state;
	}

	private normalizeState(raw: Partial<TableLeafState> | null | undefined): TableLeafState {
		const settings = this.getSettings();
		const availablePresetIds = settings.tablePresets.map(preset => preset.id);
		const fallbackPresetId = settings.tableDefaultPresetId && availablePresetIds.includes(settings.tableDefaultPresetId)
			? settings.tableDefaultPresetId
			: availablePresetIds[0] ?? null;
		const requestedPresetId = typeof raw?.presetId === 'string' && availablePresetIds.includes(raw.presetId)
			? raw.presetId
			: fallbackPresetId;
		return {
			presetId: requestedPresetId,
			searchQuery: typeof raw?.searchQuery === 'string' ? clampTableSearchQuery(raw.searchQuery) : '',
			scrollTop: typeof raw?.scrollTop === 'number' && Number.isFinite(raw.scrollTop)
				? Math.max(0, raw.scrollTop)
				: 0,
			scrollLeft: typeof raw?.scrollLeft === 'number' && Number.isFinite(raw.scrollLeft)
				? Math.max(0, raw.scrollLeft)
				: 0,
			collapsedGroupKeys: Array.isArray(raw?.collapsedGroupKeys)
				? raw.collapsedGroupKeys.filter((key): key is string => typeof key === 'string')
				: [],
		};
	}

	private syncLeafTitle(): void {
		const title = this.getCurrentPreset()?.name ?? t('table', 'title');
		const leafWithHeader = this.leaf as WorkspaceLeaf & {
			tabHeaderInnerTitleEl?: HTMLElement;
			tabHeaderInnerIconEl?: HTMLElement;
		};
		leafWithHeader.tabHeaderInnerTitleEl?.setText(title);
		if (leafWithHeader.tabHeaderInnerIconEl) {
			leafWithHeader.tabHeaderInnerIconEl.empty();
			setIcon(leafWithHeader.tabHeaderInnerIconEl, 'table-2');
		}
	}
}

function getTableSummaryFunctionLabel(summaryFunction: string): string {
	return t('table', `summary${summaryFunction}`);
}

function normalizeTableTextFieldPopoverValue(value: string): string {
	return value.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(Boolean)
		.join(' ')
		.trim();
}

function areTableLeafStatesEqual(left: TableLeafState, right: TableLeafState): boolean {
	return left.presetId === right.presetId
		&& left.searchQuery === right.searchQuery
		&& left.scrollTop === right.scrollTop
		&& left.scrollLeft === right.scrollLeft
		&& left.collapsedGroupKeys.join('\u0000') === right.collapsedGroupKeys.join('\u0000');
}
