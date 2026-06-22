import { ItemView, Notice, Platform, setIcon, WorkspaceLeaf } from 'obsidian';
import { getSchemePalette, isLightScheme } from '../appearance-schemes';
import { OperonIndexer } from '../../indexer/indexer';
import { PinnedCache } from '../../storage/pinned-cache';
import { IndexedTask } from '../../types/fields';
import {
	KanbanCellActionContext,
	KanbanDropContext,
	KanbanLeafState,
	KanbanPreset,
	KanbanViewCallbacks,
	KANBAN_COLLAPSED_COLUMN_WIDTH_PX,
	buildKanbanLaneCollapseScopeKey,
	buildKanbanStatusCollapseScopeKey,
	normalizeKanbanLeafState,
} from '../../types/kanban';
import {
	resolveContextualMenu,
	type ContextualMenuContext,
	type ResolvedContextualMenuAction,
} from '../../core/contextual-menu-engine';
import { bindContextualHoverMenuTrigger, ContextualHoverMenuController } from '../contextual-hover-menu';
import { resolveContextualHoverMenuPosition } from '../contextual-hover-menu-position';
import { findStatusDef, Pipeline } from '../../types/pipeline';
import {
	FilterSet,
	OperonSettings,
	resolveTaskDisplayIcon,
	TASK_FINDER_DEFAULT_SCOPE_ICONS,
	TaskFinderDefaultScopeKey,
} from '../../types/settings';
import { t } from '../../core/i18n';
import { isSpecialDynamicFilterSet } from '../../core/dynamic-file-task-filter';
import { resolveTaskColorSourceForTask } from '../../core/task-color-source';
import { filterTasksForCalendar, stripFilterViewOnlyOptions } from '../../systems/calendar-filter-materialization';
import {
	buildKanbanTaskComparator,
	buildKanbanCellKey,
	isTaskInPipeline,
	KanbanBoardData,
	KanbanColumn,
	KanbanLane,
	KANBAN_NO_VALUE_KEY,
	queryKanbanBoard,
} from '../../systems/kanban-query';
import {
	resolveAutoCollapsedKanbanLaneKeys,
	resolveAutoCollapsedKanbanStatusIds,
	resolveCollapsedKanbanLaneKeys,
	resolveCollapsedKanbanStatusIds,
	resolveSkippedKanbanStatusMaterializationIds,
} from '../../systems/kanban-collapse-policy';
import {
	applyKanbanOptimisticMovesToBoard,
	buildKanbanOptimisticStatusMovePlan,
	createKanbanDropOptimisticMove,
	isKanbanOptimisticMoveSatisfied,
	KanbanOptimisticMove,
	shouldApplyImmediateKanbanCardDrop,
} from '../../systems/kanban-optimistic-move';
import {
	buildProjectSearchCandidates,
	ProjectSearchCandidate,
	ProjectSearchMode,
	resolveProjectSearchVisibleTaskIds,
} from '../../systems/task-search';
import { asHTMLElement, createOwnerElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../../core/dom-compat';
import { localNow } from '../../core/local-time';
import { resolveKanbanDescendantSummaryFromStats } from '../../core/task-stats-read-model';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { bindTaskTitleLinkPreview } from '../compact-chip-link-preview';
import { renderTaskDescriptionWikilinks } from '../task-description-wikilinks';
import {
	applyTaskSearchBoxShortcutCommand,
	cloneTaskSearchBoxScopeState,
	getTaskSearchBoxShortcutLabel,
	isDefaultKanbanSearchBoxScope,
	KANBAN_SEARCH_BOX_DEFAULT_SCOPE,
	matchesTaskSearchBoxScope,
	resolveTaskSearchBoxTextQuery,
	TaskSearchBoxScopeState,
	toggleTaskSearchBoxScope,
} from '../task-search-box-integration';
import { enginePerfLog, enginePerfNow } from '../../core/engine-perf';

export const KANBAN_VIEW_TYPE = 'operon-kanban-view';
const KANBAN_CARD_RENDER_BATCH_SIZE = 10;
const KANBAN_SEARCH_MIN_QUERY_LENGTH = 2;
const KANBAN_MOBILE_LAYOUT_MEDIA_QUERY = '(hover: none) and (pointer: coarse)';
const KANBAN_MOBILE_SWIMLANE_SCROLL_LEFT_THRESHOLD_PX = 8;
const KANBAN_PHONE_TOOLBAR_MAX_WIDTH_PX = 720;
const KANBAN_MOBILE_DRAG_EDGE_SNAP_ZONE_PX = 56;
const KANBAN_MOBILE_DRAG_EDGE_SNAP_COOLDOWN_MS = 420;
const KANBAN_MOBILE_DRAG_EDGE_SNAP_EPSILON_PX = 12;
const KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_EDGE_PX = 64;
const KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_MIN_STEP_PX = 4;
const KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_MAX_STEP_PX = 18;
const KANBAN_MOBILE_CARD_LONG_PRESS_MS = 260;
const KANBAN_MOBILE_CARD_SCROLL_INTENT_PX = 10;
const KANBAN_MOBILE_CARD_HORIZONTAL_SCROLL_INTENT_PX = 5;
const KANBAN_MOBILE_CARD_CLICK_SUPPRESSION_MS = 350;
const KANBAN_MOBILE_CARD_SCROLL_SNAP_SETTLE_MS = 420;
const KANBAN_SEARCH_BOX_DISABLED_KEYS = new Set<TaskFinderDefaultScopeKey>(['recentModified']);
const KANBAN_TRACKER_FIELD_KEYS = new Set(['activeTracker', 'datetimeModified', 'duration', 'totalDuration', 'trackers']);
const KANBAN_SEARCH_SCOPE_GROUPS: TaskFinderDefaultScopeKey[][] = [
	['projectTasks', 'projectTree'],
	['overdue', 'happensToday', 'recentModified'],
	['includeInline', 'includeFile'],
	['includeCancelled', 'includeFinished'],
];

const isKanbanMobilePlatform = (): boolean => Platform.isMobile
	|| Platform.isMobileApp
	|| Platform.isPhone
	|| Platform.isTablet;

const isKanbanPhoneToolbarLayoutEligible = (settings: OperonSettings, toolbarWidth: number): boolean => (
	settings.kanbanMobileLayoutChromeEnabled === true
	&& toolbarWidth <= KANBAN_PHONE_TOOLBAR_MAX_WIDTH_PX
	&& (Platform.isPhone || Platform.isMobileApp)
);

interface KanbanScrollState {
	left: number;
	top: number;
}

interface KanbanSearchFocusState {
	selectionStart: number | null;
	selectionEnd: number | null;
}

type KanbanParentSearchMode = ProjectSearchMode;

interface KanbanParentSearchSelection {
	mode: KanbanParentSearchMode;
	parentId: string;
	parentName: string;
}

type KanbanParentSearchCandidate = ProjectSearchCandidate;

interface KanbanParentSearchUiState {
	mode: KanbanParentSearchMode;
	query: string;
	candidates: KanbanParentSearchCandidate[];
	selectedParentId: string | null;
	dropdownVisible: boolean;
}

interface DraggedKanbanCardContext extends Pick<KanbanDropContext, 'taskId' | 'sourceStatusId' | 'sourceLaneKey'> {
	cardEl: HTMLElement;
}

type KanbanMobileCardGestureMode = 'pending' | 'scrolling' | 'dragging';
type KanbanMobileCardScrollAxis = 'x' | 'y';

interface KanbanMobileCardGestureState {
	pointerId: number;
	mode: KanbanMobileCardGestureMode;
	cardEl: HTMLElement;
	startCell: HTMLElement | null;
	ownerWindow: Window;
	timerId: ReturnType<Window['setTimeout']> | null;
	initialClientX: number;
	initialClientY: number;
	previousClientX: number;
	previousClientY: number;
	latestClientX: number;
	latestClientY: number;
	dragOffsetX: number;
	dragOffsetY: number;
	previewEl: HTMLElement | null;
	activeDropCell: HTMLElement | null;
	clickSuppressed: boolean;
	wasDraggable: boolean;
	horizontalScrollDistance: number;
	scrollAxis: KanbanMobileCardScrollAxis | null;
}

interface KanbanDescendantSummary {
	generation: number;
	open: number;
	total: number;
}

export class KanbanView extends ItemView {
	private readonly indexer: OperonIndexer;
	private readonly getSettings: () => OperonSettings;
	private readonly getPinnedCache: () => PinnedCache | null;
	private readonly callbacks: KanbanViewCallbacks;
	private state: KanbanLeafState | null = null;
	private persistStateTimer: number | null = null;
	private renderFrame: number | null = null;
	private laneColumnWidthFrame: number | null = null;
	private boardLayoutRefreshFrame: number | null = null;
	private boardLayoutRefreshCleanup: (() => void) | null = null;
	private toolbarLayoutCleanup: (() => void) | null = null;
	private kanbanSearchScopePopoverCleanup: (() => void) | null = null;
	private kanbanMobileLayoutCleanup: (() => void) | null = null;
	private kanbanLazyObservers: IntersectionObserver[] = [];
	private lastLaneColumnWidthPx: number | null = null;
	private readonly hoverMenu = new ContextualHoverMenuController({
		getDelayMs: () => this.getSettings().contextualMenuOpenDelayMs,
		getHost: () => this.contentEl,
		positionMenu: (anchorRect, menu) => this.positionHoverMenu(anchorRect, menu),
	});
	private draggedCardContext: DraggedKanbanCardContext | null = null;
	private optimisticMoves = new Map<string, KanbanOptimisticMove>();
	private lastBoardScrollState: KanbanScrollState = { left: 0, top: 0 };
	private pendingSearchFocusState: KanbanSearchFocusState | null = null;
	private temporarilyExpandedAutoCollapsedStatusTokens = new Set<string>();
	private temporarilyExpandedAutoCollapsedLaneTokens = new Set<string>();
	private searchScope: TaskSearchBoxScopeState = cloneTaskSearchBoxScopeState(KANBAN_SEARCH_BOX_DEFAULT_SCOPE);
	private parentSearchSelection: KanbanParentSearchSelection | null = null;
	private parentSearchHighlightedIndex = 0;
	private parentSearchDismissed = false;
	private descendantSummaryCache = new Map<string, KanbanDescendantSummary>();
	private lastRenderSignature: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		indexer: OperonIndexer,
		getSettings: () => OperonSettings,
		getPinnedCache: () => PinnedCache | null,
		callbacks: KanbanViewCallbacks = {},
	) {
		super(leaf);
		this.indexer = indexer;
		this.getSettings = getSettings;
		this.getPinnedCache = getPinnedCache;
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return KANBAN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.getCurrentPresetTitle();
	}

	private getCurrentPresetTitle(): string {
		const settings = this.getSettings();
		const state = this.state;
		return settings.kanbanPresets.find(entry => entry.id === state?.presetId)?.name ?? t('commands', 'openKanban');
	}

	private syncLeafTitle(): void {
		const title = this.getCurrentPresetTitle();
		const leafWithHeader = this.leaf as WorkspaceLeaf & {
			tabHeaderInnerTitleEl?: HTMLElement;
		};
		leafWithHeader.tabHeaderInnerTitleEl?.setText(title);
	}

	getIcon(): string {
		return 'square-kanban';
	}

	getState(): Record<string, unknown> {
		return {
			...this.ensureState(),
			searchQuery: '',
		};
	}

	async setState(state: Partial<KanbanLeafState> | null | undefined, _result: unknown): Promise<void> {
		const nextState = this.normalizeState(
			!this.containerEl.isConnected
				? { ...(state ?? {}), searchQuery: '' }
				: state,
		);
		const changed = !this.areLeafStatesEqual(this.state, nextState);
		this.state = nextState;
		this.syncLeafTitle();
		if (changed && this.containerEl.isConnected) {
			this.markDirty();
		}
	}

	async onOpen(): Promise<void> {
		this.temporarilyExpandedAutoCollapsedStatusTokens.clear();
		this.temporarilyExpandedAutoCollapsedLaneTokens.clear();
		this.resetKanbanSearchScope();
		this.lastRenderSignature = null;
		this.state = {
			...this.ensureState(),
			searchQuery: '',
		};
		this.syncLeafTitle();
		this.registerEvent(this.app.workspace.on('css-change', () => { this.render(); }));
		this.render();
	}

	async onClose(): Promise<void> {
		this.temporarilyExpandedAutoCollapsedStatusTokens.clear();
		this.temporarilyExpandedAutoCollapsedLaneTokens.clear();
		this.resetKanbanSearchScope();
		this.lastRenderSignature = null;
		if (this.persistStateTimer !== null) {
			this.clearPersistStateTimer();
			this.app.workspace.requestSaveLayout();
		}
		this.clearRender();
		this.clearLaneColumnWidthFrame();
		this.clearBoardLayoutRefresh();
		this.clearToolbarLayout();
		this.clearKanbanMobileLayout();
		this.clearKanbanLazyObservers();
		this.hideHoverMenu(true);
	}

	markDirty(): void {
		this.scheduleRender(true);
	}

	private render(): void {
		const container = this.contentEl;
		const state = this.ensureState();
		const settings = this.getSettings();
		const preset = settings.kanbanPresets.find(entry => entry.id === state.presetId) ?? settings.kanbanPresets[0] ?? null;
		const pipeline = preset?.pipelineId
			? settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
			: null;
		const filterSet = (() => {
			const raw = preset?.filterSetId
				? settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null
				: null;
			if (raw && isSpecialDynamicFilterSet(raw)) return null;
			return raw ? stripFilterViewOnlyOptions(raw) : null;
		})();
		const parentSearchUi = pipeline && preset
			? this.buildParentSearchUiState(state.searchQuery, pipeline, filterSet, settings, this.searchScope)
			: null;
		const nextSignature = this.buildRenderSignature(container, state, preset, pipeline, filterSet, settings, parentSearchUi);
		if (this.lastRenderSignature === nextSignature && container.classList.contains('operon-kanban-view')) {
			return;
		}

		this.hideHoverMenu(true);
		this.clearBoardLayoutRefresh();
		this.clearToolbarLayout();
		this.clearKanbanSearchScopePopoverPositioning();
		this.clearKanbanMobileLayout();
		this.clearKanbanLazyObservers();
		this.captureSearchFocusState(container);
		this.captureBoardScrollState(container);
		container.empty();
		container.addClass('operon-kanban-view');

		const root = container.createDiv('operon-kanban-root');
		if (!preset) {
			root.createDiv({ text: t('notifications', 'kanbanPresetsMissing') });
			this.lastRenderSignature = nextSignature;
			return;
		}
		this.applyKanbanPresetTheme(root, preset);

		this.renderToolbar(root, state, preset, parentSearchUi);
		const content = root.createDiv('operon-kanban-content');
		this.renderBoardContent(content, state, preset, pipeline, filterSet, settings, parentSearchUi);
		this.restoreSearchFocus(root);
		this.lastRenderSignature = nextSignature;
	}

	private buildRenderSignature(
		container: HTMLElement,
		state: KanbanLeafState,
		preset: KanbanPreset | null,
		pipeline: Pipeline | null,
		filterSet: FilterSet | null,
		settings: OperonSettings,
		parentSearchUi: KanbanParentSearchUiState | null,
	): string {
		const includeTrackerFields = this.usesTrackerFields(preset, filterSet);
		const taskSignature = this.indexer.getAllTasks()
			.map(task => this.buildTaskRenderSignature(task, includeTrackerFields))
			.sort();
		const includePinnedGeneration = this.filterSetUsesField(filterSet, 'pinned');
		const pinnedGeneration = includePinnedGeneration ? (this.getPinnedCache()?.getGeneration() ?? 0) : 0;
		const activeAppearanceMode = preset
			? (getOwnerBody(container).classList.contains('theme-dark') ? preset.appearanceModeDark : preset.appearanceModeLight)
			: 'theme';

		return JSON.stringify({
			appearance: activeAppearanceMode,
			state,
			searchScope: this.searchScope,
			parentSearchSelection: this.parentSearchSelection,
			parentSearchDismissed: this.parentSearchDismissed,
			parentSearchHighlightedIndex: this.parentSearchHighlightedIndex,
			parentSearchUi: this.buildParentSearchUiSignature(parentSearchUi),
			kanbanPresets: settings.kanbanPresets,
			pipeline,
			pipelines: settings.pipelines,
			filterSet,
			priorities: settings.priorities,
			fallbackTaskIconSource: settings.fallbackTaskIconSource,
			fallbackStateIcons: settings.fallbackStateIcons,
			maxVisibleTasksPerCell: settings.kanbanMaxVisibleTasksPerCell,
			kanbanMobileLayoutChromeEnabled: settings.kanbanMobileLayoutChromeEnabled,
			kanbanMobileLayoutMaxWidthPx: settings.kanbanMobileLayoutMaxWidthPx,
			kanbanMobileCompactSwimlaneWidthPx: settings.kanbanMobileCompactSwimlaneWidthPx,
			kanbanMobileSwimlaneRailAlwaysVisible: settings.kanbanMobileSwimlaneRailAlwaysVisible,
			kanbanMobileHorizontalStatusSnapEnabled: settings.kanbanMobileHorizontalStatusSnapEnabled,
			taskFinderShortcuts: settings.taskFinderShortcuts,
			pinnedGeneration,
				optimisticMoves: Array.from(this.optimisticMoves.entries())
					.map(([taskId, move]) => ({ taskId, move }))
					.sort((left, right) => left.taskId.localeCompare(right.taskId)),
				temporaryAutoCollapsedStatusTokens: Array.from(this.temporarilyExpandedAutoCollapsedStatusTokens).sort(),
				temporaryAutoCollapsedLaneTokens: Array.from(this.temporarilyExpandedAutoCollapsedLaneTokens).sort(),
				manualOrder: preset?.sortMode === 'manual' && preset.id
					? this.callbacks.getManualOrder?.(preset.id) ?? {}
					: null,
			tasks: taskSignature,
		});
	}

	private buildTaskRenderSignature(task: IndexedTask, includeTrackerFields: boolean): string {
		const fieldEntries = Object.entries(task.fieldValues)
			.filter(([key]) => includeTrackerFields || !KANBAN_TRACKER_FIELD_KEYS.has(key))
			.sort(([left], [right]) => left.localeCompare(right));
		return JSON.stringify({
			id: task.operonId,
			description: task.description,
			checkbox: task.checkbox,
			tags: [...task.tags].sort(),
			primary: task.primary,
			datetimeModified: includeTrackerFields ? task.datetimeModified : '',
			fields: fieldEntries,
		});
	}

	private buildParentSearchUiSignature(parentSearchUi: KanbanParentSearchUiState | null): unknown {
		if (!parentSearchUi) return null;
		return {
			mode: parentSearchUi.mode,
			query: parentSearchUi.query,
			selectedParentId: parentSearchUi.selectedParentId,
			dropdownVisible: parentSearchUi.dropdownVisible,
			candidates: parentSearchUi.candidates.map(candidate => ({
				taskId: candidate.task.operonId,
				taskName: candidate.task.description,
				directVisibleCount: candidate.directVisibleCount,
				treeVisibleCount: candidate.treeVisibleCount,
			})),
		};
	}

	private usesTrackerFields(preset: KanbanPreset | null, filterSet: FilterSet | null): boolean {
		if (preset?.sortRules.some(rule => KANBAN_TRACKER_FIELD_KEYS.has(rule.field))) return true;
		if (this.filterSetUsesTrackerFields(filterSet)) return true;
		return false;
	}

	private filterSetUsesTrackerFields(filterSet: FilterSet | null): boolean {
		return Array.from(KANBAN_TRACKER_FIELD_KEYS).some(field => this.filterSetUsesField(filterSet, field));
	}

	private filterSetUsesField(filterSet: FilterSet | null, field: string): boolean {
		if (!filterSet) return false;
		for (const condition of filterSet.conditions) {
			if (condition.field === field) return true;
		}
		if (filterSet.sorts.some(sort => sort.field === field)) return true;
		for (const key of [filterSet.sortBy, filterSet.groupBy, filterSet.subgroupBy]) {
			if (key === field) return true;
		}
		return this.filterNodeUsesField(filterSet.rootGroup, field);
	}

	private filterNodeUsesField(node: FilterSet['rootGroup'], field: string): boolean {
		for (const child of node.children) {
			if ('children' in child) {
				if (this.filterNodeUsesField(child, field)) return true;
				continue;
			}
			if (child.field === field) return true;
		}
		return false;
	}

	private renderBoardContent(
		container: HTMLElement,
		state: KanbanLeafState,
		preset: KanbanPreset,
		pipeline: Pipeline | null,
		filterSet: FilterSet | null,
		settings: OperonSettings,
		parentSearchUi: KanbanParentSearchUiState | null,
	): void {
		if (!pipeline) {
			this.renderEmptyState(container, t('notifications', 'kanbanChoosePipeline'));
			return;
		}

		const activeSearchQuery = this.getActiveSearchQuery(state.searchQuery, parentSearchUi);
		const taskIdFilter = this.resolveKanbanSearchTaskIdFilter(this.searchScope, filterSet, pipeline, settings, parentSearchUi);
		const searchActive = !!activeSearchQuery
			|| !!parentSearchUi?.selectedParentId
			|| this.hasKanbanSearchScopeFilters(this.searchScope);
		const hasVisibleSwimlanes = preset.swimlaneBy !== null;
		const skippedStatusIds = searchActive
			? new Set<string>()
			: this.resolveSkippedStatusMaterializationIds(pipeline, preset, state);
		const board = queryKanbanBoard({
			preset,
			pipeline,
			filterSet,
			tasks: this.indexer.getAllTasks(),
			priorities: settings.priorities,
			searchQuery: activeSearchQuery,
			taskIdFilter,
			skippedStatusIds,
			skippedLaneKeys: searchActive || !hasVisibleSwimlanes ? undefined : state.collapsedLaneKeys,
			pinnedCache: this.getPinnedCache(),
			manualOrder: preset.sortMode === 'manual'
				? this.callbacks.getManualOrder?.(preset.id) ?? {}
				: undefined,
			keyMappings: settings.keyMappings,
		});
		this.reconcileOptimisticMoves(board, pipeline, preset);
		this.applyOptimisticMoves(board, settings);
		if (board.columns.length === 0) {
			this.renderEmptyState(container, t('notifications', 'kanbanNoColumns'));
			return;
		}
		if (board.lanes.length === 0) {
			this.renderEmptyState(container, t('notifications', 'kanbanNoTasks'));
			return;
		}

		this.renderBoard(container, board, searchActive);
	}

	private renderToolbar(
		container: HTMLElement,
		state: KanbanLeafState,
		preset: KanbanPreset,
		parentSearchUi: KanbanParentSearchUiState | null,
	): void {
		const toolbar = container.createDiv('operon-kanban-toolbar');
		const start = toolbar.createDiv('operon-kanban-toolbar-start');
		const center = toolbar.createDiv('operon-kanban-toolbar-center');
		const end = toolbar.createDiv('operon-kanban-toolbar-end');
		const kanbanPresets = this.getSettings().kanbanPresets;
		const title = start.createDiv('operon-kanban-toolbar-title');
		title.createDiv({
			text: t('commands', 'openKanban'),
			cls: 'operon-kanban-toolbar-title-main',
		});
		const mobilePresetSelect = start.createEl('select', {
			cls: 'operon-kanban-toolbar-mobile-preset-select',
		});
		setAccessibleLabelWithoutTooltip(mobilePresetSelect, t('tooltips', 'selectKanbanPreset'));
		for (const entry of kanbanPresets) {
			const option = mobilePresetSelect.createEl('option', {
				text: entry.name,
				value: entry.id,
			});
			option.selected = entry.id === preset.id;
		}
		mobilePresetSelect.value = preset.id;
		mobilePresetSelect.addEventListener('change', () => {
			const nextPresetId = mobilePresetSelect.value;
			const nextPreset = kanbanPresets.find(entry => entry.id === nextPresetId);
			if (!nextPreset) {
				mobilePresetSelect.value = preset.id;
				return;
			}
			if (nextPreset.id === preset.id) return;
			this.clearParentSearchState();
			void this.updateLeafState(this.buildStateForPresetSwitch(nextPreset.id));
		});

		for (const entry of kanbanPresets) {
			const button = center.createEl('button', {
				text: entry.name,
				cls: 'operon-kanban-toolbar-preset-button',
				attr: { type: 'button' },
			});
			button.classList.toggle('is-active', entry.id === preset.id);
			button.addEventListener('click', () => {
				this.clearParentSearchState();
				void this.updateLeafState(this.buildStateForPresetSwitch(entry.id));
			});
		}

		const searchWrap = end.createDiv('operon-kanban-toolbar-search-wrap');
		this.syncKanbanSearchWrapClasses(searchWrap, state.searchQuery);
		searchWrap.addClass('has-scope-popover');
		const searchIcon = searchWrap.createSpan('operon-kanban-toolbar-search-icon');
		searchIcon.setAttribute('aria-hidden', 'true');
		setIcon(searchIcon, 'scan-search');
		if (!searchIcon.querySelector('svg')) {
			setIcon(searchIcon, 'search');
		}
		const searchInput = searchWrap.createEl('input', {
			cls: 'operon-kanban-toolbar-search',
			attr: {
				type: 'search',
				placeholder: '',
			},
		});
		setAccessibleLabelWithoutTooltip(searchInput, t('tooltips', 'searchTasksInKanban', { name: preset.name }));
		searchInput.value = state.searchQuery;
		searchInput.addEventListener('input', () => {
			const previousSearchQuery = this.ensureState().searchQuery;
			const shortcutResult = applyTaskSearchBoxShortcutCommand(
				searchInput.value,
				this.searchScope,
				this.getSettings(),
				{
					disabledKeys: KANBAN_SEARCH_BOX_DISABLED_KEYS,
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
			}
			this.parentSearchDismissed = false;
			this.parentSearchHighlightedIndex = 0;
			if (this.searchScope.projectMode !== this.parentSearchSelection?.mode) {
				this.parentSearchSelection = null;
			}
			this.setSearchQueryState(nextSearchQuery);
			if (shortcutResult.handled) {
				if (nextSearchQuery === previousSearchQuery) {
					this.markDirty();
				} else {
					this.render();
				}
			} else {
				this.syncKanbanSearchWrapClasses(searchWrap, nextSearchQuery);
				this.refreshKanbanSearchResults(searchWrap);
			}
		});
		searchInput.addEventListener('keydown', event => {
			const currentParentSearchUi = this.resolveCurrentParentSearchUi();
			if (!currentParentSearchUi || !currentParentSearchUi.dropdownVisible || currentParentSearchUi.candidates.length === 0) {
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.updateParentSearchHighlight(Math.min(
					currentParentSearchUi.candidates.length - 1,
					this.parentSearchHighlightedIndex + 1,
				));
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.updateParentSearchHighlight(Math.max(0, this.parentSearchHighlightedIndex - 1));
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				const candidate = currentParentSearchUi.candidates[this.parentSearchHighlightedIndex] ?? currentParentSearchUi.candidates[0];
				if (candidate) {
					this.selectParentSearchCandidate(currentParentSearchUi.mode, candidate);
				}
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this.parentSearchDismissed = true;
				this.render();
			}
		});
		const clearButton = searchWrap.createEl('button', {
			cls: 'operon-kanban-toolbar-search-clear',
			text: '×',
			attr: {
				type: 'button',
			},
		});
		setAccessibleLabelWithoutTooltip(clearButton, t('tooltips', 'clearSearch'));
		clearButton.addEventListener('pointerdown', event => {
			event.preventDefault();
		});
		clearButton.addEventListener('click', () => {
			const previousSearchQuery = this.ensureState().searchQuery;
			this.resetKanbanSearchScope();
			searchInput.value = '';
			this.syncKanbanSearchWrapClasses(searchWrap, '');
			searchInput.focus({ preventScroll: true });
			void this.updateLeafState({
				...this.ensureState(),
				searchQuery: '',
			});
			if (!previousSearchQuery) {
				this.markDirty();
			}
		});
		this.renderKanbanSearchScopeToolbar(searchWrap);
		this.renderParentSearchDropdown(searchWrap, parentSearchUi);

		const settingsButton = end.createEl('button', {
			cls: 'operon-kanban-toolbar-settings-button',
			attr: { type: 'button' },
		});
		setIcon(settingsButton, 'settings-2');
		setAccessibleLabelWithoutTooltip(settingsButton, t('tooltips', 'editKanbanPreset', { name: preset.name }));
		bindOperonHoverTooltip(settingsButton, {
			content: t('tooltips', 'editKanbanPreset', { name: preset.name }),
			taskColor: null,
		});
		settingsButton.addEventListener('click', () => {
			if (!preset.id) return;
			void this.callbacks.onOpenPresetSettings?.(preset.id);
		});
		this.applyKanbanToolbarLayoutMode(toolbar, start, center, end);
	}

		private applyKanbanToolbarLayoutMode(
			toolbar: HTMLElement,
			start: HTMLElement,
			center: HTMLElement,
			end: HTMLElement,
		): void {
			const updateLayout = (): void => {
				const width = toolbar.clientWidth;
				if (width <= 0) return;
				const phonePresetDropdown = isKanbanPhoneToolbarLayoutEligible(this.getSettings(), width);
				toolbar.classList.toggle('is-phone-preset-dropdown', phonePresetDropdown);
				const requiredWidth = this.measureKanbanToolbarGroupWidth(start)
					+ this.measureKanbanToolbarGroupWidth(center)
					+ this.measureKanbanToolbarGroupWidth(end)
					+ 24;
				toolbar.classList.toggle('is-compact', !phonePresetDropdown && requiredWidth > width);
			};

			this.clearToolbarLayout();

			updateLayout();
			window.requestAnimationFrame(updateLayout);
			window.requestAnimationFrame(() => window.requestAnimationFrame(updateLayout));
			window.setTimeout(updateLayout, 0);
			window.setTimeout(updateLayout, 120);

			const observer = new ResizeObserver(() => updateLayout());
			observer.observe(toolbar);
			observer.observe(start);
			observer.observe(center);
			observer.observe(end);
			this.toolbarLayoutCleanup = () => observer.disconnect();
		}

		private measureKanbanToolbarGroupWidth(group: HTMLElement): number {
			const children = Array.from(group.children) as HTMLElement[];
			if (children.length === 0) return 0;
			let total = 0;
			for (const child of children) {
				const rectWidth = Math.ceil(child.getBoundingClientRect().width);
				const naturalWidth = Math.ceil(child.scrollWidth || 0);
				total += Math.max(rectWidth, naturalWidth);
			}
			return total + Math.max(0, children.length - 1) * 8;
		}

		private clearToolbarLayout(): void {
			this.toolbarLayoutCleanup?.();
			this.toolbarLayoutCleanup = null;
		}

		private clearKanbanSearchScopePopoverPositioning(): void {
			this.kanbanSearchScopePopoverCleanup?.();
			this.kanbanSearchScopePopoverCleanup = null;
		}

		private syncKanbanSearchWrapClasses(searchWrap: HTMLElement, rawQuery: string): void {
			const hasSearchQuery = !!rawQuery.trim();
			const hasActiveSearchScope = !isDefaultKanbanSearchBoxScope(this.searchScope) || !!this.parentSearchSelection;
			searchWrap.classList.toggle('has-value', hasSearchQuery || hasActiveSearchScope);
			searchWrap.classList.toggle('has-search-query', hasSearchQuery);
			searchWrap.classList.toggle('has-active-scope', hasActiveSearchScope);
		}

		private setSearchQueryState(searchQuery: string): void {
			this.state = this.normalizeState({
				...this.ensureState(),
				searchQuery,
			});
			this.lastRenderSignature = null;
		}

		private refreshKanbanSearchResults(searchWrap: HTMLElement): void {
			const root = this.contentEl.querySelector<HTMLElement>('.operon-kanban-root');
			const content = root?.querySelector<HTMLElement>('.operon-kanban-content');
			if (!root || !content) {
				this.render();
				return;
			}
			const state = this.ensureState();
			const settings = this.getSettings();
			const preset = settings.kanbanPresets.find(entry => entry.id === state.presetId) ?? settings.kanbanPresets[0] ?? null;
			if (!preset) {
				this.render();
				return;
			}
			const pipeline = preset.pipelineId
				? settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
				: null;
			const filterSet = (() => {
				const raw = preset.filterSetId
					? settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null
					: null;
				if (raw && isSpecialDynamicFilterSet(raw)) return null;
				return raw ? stripFilterViewOnlyOptions(raw) : null;
			})();
			const parentSearchUi = pipeline
				? this.buildParentSearchUiState(state.searchQuery, pipeline, filterSet, settings, this.searchScope)
				: null;
			this.renderParentSearchDropdown(searchWrap, parentSearchUi);
			this.hideHoverMenu(true);
			this.clearBoardLayoutRefresh();
			this.clearKanbanLazyObservers();
			this.captureBoardScrollState(content);
			content.empty();
			this.renderBoardContent(content, state, preset, pipeline, filterSet, settings, parentSearchUi);
		}

		private bindKanbanSearchScopePopoverPositioning(searchWrap: HTMLElement, popover: HTMLElement): void {
			this.clearKanbanSearchScopePopoverPositioning();
			const ownerWindow = getOwnerWindow(searchWrap);
			const ownerDocument = getOwnerDocument(searchWrap);
			const clearPosition = (): void => {
				popover.style.removeProperty('--operon-kanban-search-scope-left');
				popover.style.removeProperty('--operon-kanban-search-scope-top');
				popover.style.removeProperty('--operon-kanban-search-scope-width');
			};
			const updatePosition = (): void => {
				const root = searchWrap.closest<HTMLElement>('.operon-kanban-root');
				if (!root?.classList.contains('is-mobile-layout')) {
					clearPosition();
					return;
				}
				const viewportWidth = ownerWindow.innerWidth || ownerDocument.documentElement.clientWidth;
				if (viewportWidth <= 0) return;
				const margin = 10;
				const width = Math.max(0, Math.min(336, viewportWidth - (margin * 2)));
				const rect = searchWrap.getBoundingClientRect();
				const left = Math.max(margin, Math.min(viewportWidth - margin - width, rect.right - width));
				const top = Math.max(margin, rect.bottom + 8);
				popover.style.setProperty('--operon-kanban-search-scope-left', `${Math.round(left)}px`);
				popover.style.setProperty('--operon-kanban-search-scope-top', `${Math.round(top)}px`);
				popover.style.setProperty('--operon-kanban-search-scope-width', `${Math.round(width)}px`);
			};
			const updateWhenOpen = (): void => {
				if (searchWrap.matches(':focus-within')) {
					updatePosition();
				}
			};
			const resizeObserver = new ResizeObserver(updateWhenOpen);
			resizeObserver.observe(searchWrap);
			ownerWindow.addEventListener('resize', updateWhenOpen);
			ownerWindow.addEventListener('orientationchange', updateWhenOpen);
			searchWrap.addEventListener('focusin', updatePosition);
			searchWrap.addEventListener('pointerdown', updatePosition);
			this.kanbanSearchScopePopoverCleanup = () => {
				resizeObserver.disconnect();
				ownerWindow.removeEventListener('resize', updateWhenOpen);
				ownerWindow.removeEventListener('orientationchange', updateWhenOpen);
				searchWrap.removeEventListener('focusin', updatePosition);
				searchWrap.removeEventListener('pointerdown', updatePosition);
				clearPosition();
			};
		}

		private resolveCurrentParentSearchUi(): KanbanParentSearchUiState | null {
			const state = this.ensureState();
			const settings = this.getSettings();
			const preset = settings.kanbanPresets.find(entry => entry.id === state.presetId) ?? settings.kanbanPresets[0] ?? null;
			if (!preset) return null;
			const pipeline = preset.pipelineId
				? settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
				: null;
			if (!pipeline) return null;
			const filterSet = (() => {
				const raw = preset.filterSetId
					? settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null
					: null;
				if (raw && isSpecialDynamicFilterSet(raw)) return null;
				return raw ? stripFilterViewOnlyOptions(raw) : null;
			})();
			return this.buildParentSearchUiState(state.searchQuery, pipeline, filterSet, settings, this.searchScope);
		}

		private renderKanbanSearchScopeToolbar(searchWrap: HTMLElement): void {
			const popover = searchWrap.createDiv('operon-kanban-search-scope-popover');
			this.bindKanbanSearchScopePopoverPositioning(searchWrap, popover);
			const tools = popover.createDiv('operon-task-finder-tools operon-kanban-search-scope-tools');
			for (const group of KANBAN_SEARCH_SCOPE_GROUPS) {
				const groupEl = tools.createDiv('operon-task-finder-tool-group operon-kanban-search-scope-group');
				for (const key of group) {
					const isDisabled = KANBAN_SEARCH_BOX_DISABLED_KEYS.has(key);
					const button = groupEl.createEl('button', {
						cls: 'operon-task-finder-tool operon-kanban-search-scope-button',
						attr: {
							type: 'button',
						},
					});
					button.classList.toggle('is-active', this.isKanbanSearchScopeKeyActive(key));
					button.classList.toggle('is-disabled', isDisabled);
					if (isDisabled) {
						button.setAttribute('aria-disabled', 'true');
					}
					button.addEventListener('pointerdown', event => event.preventDefault());
					button.addEventListener('click', () => {
						if (!isDisabled) {
							const previousProjectMode = this.searchScope.projectMode;
							this.searchScope = toggleTaskSearchBoxScope(this.searchScope, key, {
								preserveTerminalStateScopes: true,
							});
							if (previousProjectMode !== this.searchScope.projectMode) {
								this.parentSearchSelection = null;
							}
							this.parentSearchDismissed = false;
							this.parentSearchHighlightedIndex = 0;
							this.markDirty();
						}
						this.focusKanbanSearchInput();
					});
					const icon = button.createSpan('operon-task-finder-tool-icon');
					setIcon(icon, TASK_FINDER_DEFAULT_SCOPE_ICONS[key]);
					setAccessibleLabelWithoutTooltip(button, this.getSearchScopeButtonLabel(key));
					const shortcut = getTaskSearchBoxShortcutLabel(this.getSettings(), key);
					const tooltip = shortcut
						? `${this.getSearchScopeButtonLabel(key)} ${shortcut}`
						: this.getSearchScopeButtonLabel(key);
					bindOperonHoverTooltip(button, { content: tooltip, taskColor: null });
				}
			}
			if (this.parentSearchSelection) {
				const selectedParent = popover.createDiv('operon-kanban-search-selected-parent');
				selectedParent.createSpan({
					cls: 'operon-kanban-search-selected-parent-label',
					text: this.parentSearchSelection.parentName,
				});
				const clearButton = selectedParent.createEl('button', {
					cls: 'operon-kanban-search-selected-parent-clear',
					text: '×',
					attr: { type: 'button' },
				});
				setAccessibleLabelWithoutTooltip(clearButton, t('tooltips', 'clearSearch'));
				clearButton.addEventListener('pointerdown', event => event.preventDefault());
				clearButton.addEventListener('click', () => {
					this.parentSearchSelection = null;
					this.parentSearchDismissed = false;
					this.parentSearchHighlightedIndex = 0;
					this.markDirty();
					this.focusKanbanSearchInput();
				});
			}
		}

		private renderParentSearchDropdown(
			searchWrap: HTMLElement,
			parentSearchUi: KanbanParentSearchUiState | null,
		): void {
			searchWrap.querySelector<HTMLElement>('.operon-kanban-parent-search-dropdown')?.remove();
			if (!parentSearchUi?.dropdownVisible) return;
			const dropdown = searchWrap.createDiv('operon-kanban-parent-search-dropdown');
			if (parentSearchUi.candidates.length === 0) {
				dropdown.createDiv({
					cls: 'operon-kanban-parent-search-empty',
					text: t('notifications', 'kanbanParentSearchNoParents'),
				});
				return;
			}
			parentSearchUi.candidates.forEach((candidate, index) => {
				const item = dropdown.createEl('button', {
					cls: 'operon-kanban-parent-search-item',
					attr: { type: 'button' },
				});
				item.classList.toggle('is-active', index === this.parentSearchHighlightedIndex);
				item.addEventListener('pointerdown', event => event.preventDefault());
				item.addEventListener('click', () => {
					this.selectParentSearchCandidate(parentSearchUi.mode, candidate);
				});
				item.createDiv({
					cls: 'operon-kanban-parent-search-item-name',
					text: candidate.task.description,
				});
				item.createDiv({
					cls: 'operon-kanban-parent-search-item-meta',
					text: parentSearchUi.mode === 'pc'
						? String(candidate.directVisibleCount)
						: String(candidate.treeVisibleCount),
				});
			});
		}

	private renderBoard(container: HTMLElement, board: KanbanBoardData, searchActive: boolean): void {
		const boardEl = container.createDiv('operon-kanban-board');
		this.bindBoardDelegatedCardEvents(boardEl);
		const hasSwimlanes = board.preset.swimlaneBy !== null;
		boardEl.toggleClass('is-no-swimlanes', !hasSwimlanes);
		boardEl.toggleClass('is-manual-order', board.preset.sortMode === 'manual');
		boardEl.style.setProperty('--operon-kanban-column-width', `${this.getSettings().kanbanExpandedColumnWidthPx}px`);
		boardEl.style.setProperty('--operon-kanban-collapsed-width', `${KANBAN_COLLAPSED_COLUMN_WIDTH_PX}px`);
		boardEl.style.setProperty('--operon-kanban-lane-column-width', `${this.lastLaneColumnWidthPx ?? 96}px`);
		const columns = board.columns;
		const state = this.ensureState();
		const collapsedStatusIds = this.resolveCollapsedStatusIds(board, state, searchActive);
		const collapsedLaneKeys = this.resolveCollapsedLaneKeys(board, state, searchActive);
		const columnTemplate = this.buildColumnTemplate(columns, Array.from(collapsedStatusIds));

		const gridViewport = boardEl.createDiv('operon-kanban-grid-viewport');
		const gridContent = gridViewport.createDiv('operon-kanban-grid-content');
		const fullColumnTemplate = hasSwimlanes
			? `var(--operon-kanban-active-lane-column-width, var(--operon-kanban-lane-column-width, 96px)) ${columnTemplate}`
			: columnTemplate;
		const headerRow = gridContent.createDiv('operon-kanban-header-row');
		headerRow.style.gridTemplateColumns = fullColumnTemplate;
		if (hasSwimlanes) {
			const corner = headerRow.createDiv('operon-kanban-corner-cell');
			this.renderCornerSummary(corner, board.relevantTasks.length);
		}

		for (const column of columns) {
			const header = headerRow.createDiv('operon-kanban-column-header');
			const isCollapsed = collapsedStatusIds.has(column.statusId);
			header.classList.toggle('is-collapsed', isCollapsed);
			if (column.color) {
				header.style.setProperty('--operon-kanban-status-color', column.color);
			}
			const title = header.createDiv('operon-kanban-column-header-title');
			title.setText(column.statusLabel);
				const toggle = header.createEl('button', {
					cls: 'operon-kanban-column-count-button',
					text: String(column.count),
					attr: {
						type: 'button',
					},
				});
				setAccessibleLabelWithoutTooltip(toggle, isCollapsed
					? t('tooltips', 'expandKanbanColumn', { name: column.statusLabel })
					: t('tooltips', 'collapseKanbanColumn', { name: column.statusLabel }));
				bindOperonHoverTooltip(toggle, { content: column.statusLabel, taskColor: column.color || null });
				toggle.addEventListener('click', () => {
					if (this.isStatusAutoCollapsed(board, column)) {
						const state = this.ensureState();
						const statusToken = this.buildStatusCollapseToken(board.preset, column.statusId);
						const isTemporarilyExpanded = this.temporarilyExpandedAutoCollapsedStatusTokens.has(statusToken);
						const isManuallyCollapsed = state.collapsedStatusIds.includes(column.statusId);
						if (collapsedStatusIds.has(column.statusId)) {
							this.temporarilyExpandedAutoCollapsedStatusTokens.add(statusToken);
							if (isManuallyCollapsed) {
								const nextCollapsed = new Set(state.collapsedStatusIds);
								nextCollapsed.delete(column.statusId);
							void this.updateLeafState(this.withCurrentPresetCollapseState({
								collapsedStatusIds: Array.from(nextCollapsed),
							}));
							return;
						}
						this.render();
							return;
						}
						if (isTemporarilyExpanded) {
							this.temporarilyExpandedAutoCollapsedStatusTokens.delete(statusToken);
							this.render();
							return;
						}
				}
				const nextCollapsed = new Set(this.ensureState().collapsedStatusIds);
				if (nextCollapsed.has(column.statusId)) {
					nextCollapsed.delete(column.statusId);
				} else {
					nextCollapsed.add(column.statusId);
				}
				void this.updateLeafState(this.withCurrentPresetCollapseState({
					collapsedStatusIds: Array.from(nextCollapsed),
				}));
			});
		}

		const laneLabelEls: HTMLElement[] = [];
		const laneTitleEls: HTMLElement[] = [];
		const gridRowEls: HTMLElement[] = [];

		for (const lane of board.lanes) {
			const row = gridContent.createDiv('operon-kanban-row');
			row.style.gridTemplateColumns = fullColumnTemplate;
			const isLaneCollapsed = hasSwimlanes && collapsedLaneKeys.has(lane.key);
			row.classList.toggle('is-collapsed', isLaneCollapsed);
			let laneLabel: HTMLElement | null = null;
			if (hasSwimlanes) {
				laneLabel = row.createDiv('operon-kanban-lane-label');
				laneLabel.classList.toggle('is-collapsed', isLaneCollapsed);
				laneLabel.classList.toggle('is-no-value', lane.isNoValue);
				if (lane.color) {
					laneLabel.style.setProperty('--operon-kanban-lane-color', lane.color);
				}
				const laneTitle = laneLabel.createDiv({ text: lane.label, cls: 'operon-kanban-lane-title' });
				const laneToggle = laneLabel.createEl('button', {
					cls: 'operon-kanban-lane-count-button',
					text: String(lane.count),
					attr: {
						type: 'button',
					},
				});
				setAccessibleLabelWithoutTooltip(laneToggle, isLaneCollapsed
					? t('tooltips', 'expandKanbanSwimlane', { name: lane.label })
					: t('tooltips', 'collapseKanbanSwimlane', { name: lane.label }));
				bindOperonHoverTooltip(laneToggle, { content: lane.label, taskColor: lane.color || null });
				laneTitleEls.push(laneTitle);
					laneToggle.addEventListener('click', () => {
						if (this.isLaneAutoCollapsed(board, lane)) {
							const state = this.ensureState();
							const laneToken = this.buildLaneCollapseToken(board.preset, lane.key);
							const isTemporarilyExpanded = this.temporarilyExpandedAutoCollapsedLaneTokens.has(laneToken);
							const isManuallyCollapsed = state.collapsedLaneKeys.includes(lane.key);
							if (collapsedLaneKeys.has(lane.key)) {
								this.temporarilyExpandedAutoCollapsedLaneTokens.add(laneToken);
								if (isManuallyCollapsed) {
									const nextCollapsed = new Set(state.collapsedLaneKeys);
									nextCollapsed.delete(lane.key);
								void this.updateLeafState(this.withCurrentPresetCollapseState({
									collapsedLaneKeys: Array.from(nextCollapsed),
								}));
								return;
							}
							this.render();
								return;
							}
							if (isTemporarilyExpanded) {
								this.temporarilyExpandedAutoCollapsedLaneTokens.delete(laneToken);
								this.render();
								return;
							}
					}
					const nextCollapsed = new Set(this.ensureState().collapsedLaneKeys);
					if (nextCollapsed.has(lane.key)) {
						nextCollapsed.delete(lane.key);
					} else {
						nextCollapsed.add(lane.key);
					}
					void this.updateLeafState(this.withCurrentPresetCollapseState({
						collapsedLaneKeys: Array.from(nextCollapsed),
					}));
				});
			}

			for (const column of columns) {
				const cell = row.createDiv('operon-kanban-cell');
				cell.dataset.kanbanStatusId = column.statusId;
				cell.dataset.kanbanLaneKey = lane.key;
				const cellKey = buildKanbanCellKey(column.statusId, lane.key);
				const tasks = board.cellMap.get(cellKey) ?? [];
				const taskCount = board.cellCountMap.get(cellKey) ?? tasks.length;
				const isColumnCollapsed = collapsedStatusIds.has(column.statusId);
				const isSearchCollapsed = searchActive && taskCount === 0;
				const isCollapsed = isColumnCollapsed || isLaneCollapsed || isSearchCollapsed;
				cell.classList.toggle('is-collapsed', isCollapsed);
				if (column.color) {
					cell.style.setProperty('--operon-kanban-status-color', column.color);
				}
				if (lane.color) {
					cell.style.setProperty('--operon-kanban-lane-color', lane.color);
				}
				this.bindCellDropTarget(cell, column, lane, board.preset);
				if (isCollapsed) {
					this.renderCollapsedCellSummary(cell, taskCount);
					continue;
				}
				this.bindCellQuickAdd(cell, column, lane, board.preset, gridViewport);
				this.renderInitialCellTasks(cell, tasks, taskCount, board.pipeline, board.preset, column.statusId, lane.key);
			}

			if (laneLabel) laneLabelEls.push(laneLabel);
			gridRowEls.push(row);
		}

		this.bindBoardScrollStateTracking(gridViewport);
		this.restoreBoardScrollState(gridViewport);
		this.syncRowCellHeights(gridRowEls);
		if (hasSwimlanes) {
			this.syncLaneHeights(laneLabelEls, gridRowEls);
			this.refreshLaneColumnWidth(boardEl, laneTitleEls);
		}
		this.bindKanbanMobileLayout(boardEl, gridViewport, hasSwimlanes);
		this.bindBoardLayoutRefresh(boardEl, laneLabelEls, gridRowEls, laneTitleEls, hasSwimlanes);
	}

	private renderInitialCellTasks(
		cell: HTMLElement,
		tasks: IndexedTask[],
		totalTaskCount: number,
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string,
		laneKey: string,
	): void {
		const maxVisibleTasks = this.getSettings().kanbanMaxVisibleTasksPerCell;
		const initialLimit = Math.min(tasks.length, Math.max(KANBAN_CARD_RENDER_BATCH_SIZE, maxVisibleTasks));
		this.renderTaskCardBatch(cell, tasks, 0, initialLimit, pipeline, preset, statusId, laneKey, null);
		cell.dataset.kanbanVisibleCount = String(initialLimit);
		this.applyCellHeightLimit(cell, maxVisibleTasks, totalTaskCount);
		if (tasks.length <= initialLimit) return;
		this.attachCellLazySentinel(cell, tasks, pipeline, preset, statusId, laneKey, maxVisibleTasks);
	}

	private renderTaskCardBatch(
		cell: HTMLElement,
		tasks: IndexedTask[],
		startIndex: number,
		endIndex: number,
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string,
		laneKey: string,
		beforeEl: HTMLElement | null,
	): void {
		for (let index = startIndex; index < endIndex; index++) {
			const task = tasks[index];
			if (!task) continue;
			const card = this.renderTaskCard(cell, task, pipeline, preset, statusId, laneKey, false, 0);
			if (beforeEl) {
				cell.insertBefore(card, beforeEl);
			}
		}
	}

	private attachCellLazySentinel(
		cell: HTMLElement,
		tasks: IndexedTask[],
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string,
		laneKey: string,
		maxVisibleTasks: number,
	): void {
		const sentinel = cell.createDiv('operon-kanban-lazy-sentinel');
		sentinel.setAttr('aria-hidden', 'true');
		const setSentinelNextTaskId = (visibleCount: number): void => {
			const nextTaskId = tasks[visibleCount]?.operonId ?? '';
			if (nextTaskId) {
				sentinel.dataset.kanbanNextTaskId = nextTaskId;
			} else {
				delete sentinel.dataset.kanbanNextTaskId;
			}
		};
		setSentinelNextTaskId(Number(cell.dataset.kanbanVisibleCount ?? '0') || 0);
		let observer: IntersectionObserver;
		observer = new IntersectionObserver((entries) => {
			if (!entries.some(entry => entry.isIntersecting)) return;
			const currentVisible = Number(cell.dataset.kanbanVisibleCount ?? '0') || 0;
			if (currentVisible >= tasks.length) {
				observer.disconnect();
				sentinel.remove();
				return;
			}
			const nextVisible = Math.min(tasks.length, currentVisible + KANBAN_CARD_RENDER_BATCH_SIZE);
			this.renderTaskCardBatch(cell, tasks, currentVisible, nextVisible, pipeline, preset, statusId, laneKey, sentinel);
			cell.dataset.kanbanVisibleCount = String(nextVisible);
			setSentinelNextTaskId(nextVisible);
			this.applyCellHeightLimit(cell, maxVisibleTasks, tasks.length);
			this.scheduleBoardLayoutRefreshFromCell(cell);
			if (nextVisible >= tasks.length) {
				observer.disconnect();
				sentinel.remove();
			}
		}, { root: cell, rootMargin: '0px' });
		this.kanbanLazyObservers.push(observer);
		observer.observe(sentinel);
	}

	private bindBoardDelegatedCardEvents(boardEl: HTMLElement): void {
		boardEl.addEventListener('click', event => {
			const target = asHTMLElement(event.target, boardEl);
			if (!target) return;

			const descendantToggle = target.closest<HTMLButtonElement>('.operon-kanban-descendant-toggle');
			if (descendantToggle && !descendantToggle.disabled) {
				const card = descendantToggle.closest<HTMLElement>('.operon-kanban-card');
				const taskId = card?.dataset.operonTaskId;
				if (!taskId) return;
				event.preventDefault();
				event.stopPropagation();
				this.toggleDescendantPreview(taskId);
				return;
			}

			if (target.closest('.operon-calendar-status-button, .operon-calendar-hover-menu, a.internal-link')) return;
			const card = target.closest<HTMLElement>('.operon-kanban-card');
			const taskId = card?.dataset.operonTaskId;
			if (!card || !taskId || !boardEl.contains(card)) return;
			if ((event.metaKey || event.ctrlKey) && this.callbacks.onOpenTaskInNewTab) {
				event.preventDefault();
				event.stopPropagation();
				void this.callbacks.onOpenTaskInNewTab(taskId);
				return;
			}
			event.stopPropagation();
			void this.callbacks.onItemAction?.(taskId, 'openEditor');
		});

		boardEl.addEventListener('auxclick', event => {
			if (event.button !== 1) return;
			const target = asHTMLElement(event.target, boardEl);
			if (!target) return;
			if (target.closest('.operon-calendar-status-button, .operon-calendar-hover-menu, a.internal-link, .operon-kanban-descendant-toggle, button, input, textarea, select, [contenteditable="true"]')) return;
			const card = target.closest<HTMLElement>('.operon-kanban-card');
			const taskId = card?.dataset.operonTaskId;
			if (!card || !taskId || !boardEl.contains(card)) return;
			if (!this.callbacks.onOpenTaskInNewTab) return;
			event.preventDefault();
			event.stopPropagation();
			void this.callbacks.onOpenTaskInNewTab(taskId);
		});

		boardEl.addEventListener('dragstart', event => {
			const target = asHTMLElement(event.target, boardEl);
			const card = target?.closest<HTMLElement>('.operon-kanban-card');
			if (!card || card.dataset.kanbanPreview === 'true') return;
			if (boardEl.classList.contains('is-mobile-layout') && boardEl.dataset.kanbanMobileTouchPointerActive === 'true') {
				event.preventDefault();
				return;
			}
			const taskId = card.dataset.operonTaskId;
			const sourceLaneKey = card.dataset.kanbanLaneKey;
			if (!taskId || !sourceLaneKey) return;
			this.draggedCardContext = {
				taskId,
				sourceStatusId: card.dataset.kanbanStatusId ?? null,
				sourceLaneKey,
				cardEl: card,
			};
			event.dataTransfer?.setData('text/plain', taskId);
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
			}
			card.addClass('is-dragging');
		});

		boardEl.addEventListener('dragend', event => {
			const target = asHTMLElement(event.target, boardEl);
			const card = target?.closest<HTMLElement>('.operon-kanban-card');
			this.draggedCardContext = null;
			this.clearManualDropIndicators(boardEl);
			card?.removeClass('is-dragging');
			card?.removeClass('is-mobile-touch-dragging');
		});
	}

	private toggleDescendantPreview(taskId: string): void {
		const expanded = new Set(this.ensureState().expandedPreviewParentIds);
		if (expanded.has(taskId)) {
			expanded.delete(taskId);
		} else {
			expanded.add(taskId);
		}
		void this.updateLeafState({
			...this.ensureState(),
			expandedPreviewParentIds: Array.from(expanded),
		});
	}

	private renderTaskCard(
		container: HTMLElement,
		task: IndexedTask,
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string | null,
		laneKey: string,
		isPreview: boolean,
		depth: number,
	): HTMLElement {
		const card = container.createDiv('operon-kanban-card');
		card.dataset.operonTaskId = task.operonId;
		card.dataset.kanbanLaneKey = laneKey;
		card.dataset.kanbanPreview = isPreview ? 'true' : 'false';
		if (statusId) {
			card.dataset.kanbanStatusId = statusId;
		}
		card.classList.toggle('is-readonly-preview', isPreview);
		card.classList.toggle('is-done', task.checkbox === 'done');
		card.classList.toggle('is-cancelled', task.checkbox === 'cancelled');
		card.style.setProperty('--operon-kanban-preview-depth', String(depth));
		this.applyTaskColor(card, task, preset);

		if (isPreview && depth > 0) {
			card.addClass('is-nested-preview');
		}

		const head = card.createDiv('operon-kanban-card-head');
		const hoverTrigger = head.createSpan('operon-calendar-hover-menu-trigger');
		this.renderStatusButton(hoverTrigger, task, pipeline, preset, statusId, laneKey);
		const titleText = task.description || task.operonId;
		const titleEl = head.createSpan({
			cls: 'operon-kanban-card-title',
		});
		const renderedWikilinks = renderTaskDescriptionWikilinks(titleEl, {
			app: this.app,
			description: titleText,
			sourcePath: task.primary.filePath,
		});
		if (!renderedWikilinks) {
			titleEl.textContent = titleText;
		}
		if (!renderedWikilinks && task.primary.format === 'yaml') {
			bindTaskTitleLinkPreview(this.app, titleEl, task.primary.filePath, task.primary.filePath);
		}

		const descendantSummary = this.buildDescendantSummary(task.operonId);
		if (descendantSummary.total > 0) {
			const button = head.createEl('button', {
				text: `${descendantSummary.open}/${descendantSummary.total}`,
				cls: 'operon-kanban-descendant-toggle',
				attr: { type: 'button' },
			});
			setAccessibleLabelWithoutTooltip(button, t('tooltips', 'toggleDescendantPreview'));
			if (isPreview) {
				button.disabled = true;
			} else {
				button.classList.toggle('is-expanded', this.ensureState().expandedPreviewParentIds.includes(task.operonId));
			}
		}

		if (!isPreview) {
			this.bindHoverMenuTarget(hoverTrigger, task);
			card.draggable = true;
			card.addClass('is-draggable');
		}

		if (!isPreview && this.ensureState().expandedPreviewParentIds.includes(task.operonId)) {
			const preview = card.createDiv('operon-kanban-preview-tree');
			for (const child of this.getPreviewChildren(task.operonId)) {
				this.renderPreviewNode(preview, child, preset, pipeline, depth + 1);
			}
		}
		return card;
	}

	private renderPreviewNode(
		container: HTMLElement,
		task: IndexedTask,
		preset: KanbanPreset,
		pipeline: Pipeline | null,
		depth: number,
	): void {
		this.renderTaskCard(container, task, pipeline, preset, null, KANBAN_NO_VALUE_KEY, true, depth);
		const children = this.getPreviewChildren(task.operonId);
		if (children.length === 0) return;
		const childrenWrap = container.createDiv('operon-kanban-preview-children');
		for (const child of children) {
			this.renderPreviewNode(childrenWrap, child, preset, pipeline, depth + 1);
		}
	}

	private getPreviewChildren(parentId: string): IndexedTask[] {
		const comparator = buildKanbanTaskComparator({
			preset: this.resolveCurrentPreset(),
			priorities: this.getSettings().priorities,
			keyMappings: this.getSettings().keyMappings,
		});
		return [...this.indexer.secondary.getChildIds(parentId)]
			.map(childId => this.indexer.getTask(childId))
			.filter((task): task is IndexedTask => !!task)
			.sort((left, right) => {
				const stateCompare = this.getPreviewChildStateBucket(left) - this.getPreviewChildStateBucket(right);
				if (stateCompare !== 0) return stateCompare;
				return comparator(left, right);
			});
	}

	private getPreviewChildStateBucket(task: IndexedTask): number {
		if (task.checkbox === 'open') return 0;
		if (task.checkbox === 'done') return 1;
		return 2;
	}

	private buildDescendantSummary(parentId: string): { open: number; total: number } {
		const generation = this.indexer.getGeneration();
		const cached = this.descendantSummaryCache.get(parentId);
		if (cached?.generation === generation) {
			return { open: cached.open, total: cached.total };
		}
		const parentTask = this.indexer.getTask(parentId);
		const statsSummary = parentTask ? resolveKanbanDescendantSummaryFromStats(parentTask.fieldValues) : null;
		if (statsSummary) {
			const summary = { generation, open: statsSummary.open, total: statsSummary.total };
			this.descendantSummaryCache.set(parentId, summary);
			return { open: summary.open, total: summary.total };
		}
		const descendantIds = [...this.indexer.secondary.getAllDescendantIds(parentId)];
		let open = 0;
		for (const descendantId of descendantIds) {
			const task = this.indexer.getTask(descendantId);
			if (task?.checkbox === 'open') open += 1;
		}
		const summary = { generation, open, total: descendantIds.length };
		this.descendantSummaryCache.set(parentId, summary);
		return { open: summary.open, total: summary.total };
	}

	private reconcileOptimisticMoves(_board: KanbanBoardData, pipeline: Pipeline | null, preset: KanbanPreset): void {
		if (this.optimisticMoves.size === 0) return;
		const now = Date.now();
		for (const [taskId, move] of this.optimisticMoves) {
			if (Number.isFinite(move.expiresAt) && move.expiresAt < now) {
				this.optimisticMoves.delete(taskId);
				continue;
			}
			const task = this.indexer.getTask(taskId);
			if (!task || !pipeline) {
				this.optimisticMoves.delete(taskId);
				continue;
			}
			if (isKanbanOptimisticMoveSatisfied(task, pipeline, preset, move, this.getSettings().keyMappings)) {
				this.optimisticMoves.delete(taskId);
			}
		}
	}

	clearOptimisticMove(taskId: string): void {
		this.optimisticMoves.delete(taskId);
		this.markDirty();
	}

	private applyOptimisticMoves(board: KanbanBoardData, settings: OperonSettings): void {
		applyKanbanOptimisticMovesToBoard(board, settings.priorities, this.optimisticMoves.values(), settings.keyMappings);
	}

	private bindCellDropTarget(
		cell: HTMLElement,
		column: KanbanColumn,
		lane: KanbanLane,
		preset: KanbanPreset,
	): void {
		cell.addEventListener('dragenter', event => {
			if (!this.draggedCardContext) return;
			event.preventDefault();
			this.hideCellQuickAdd(cell);
			cell.addClass('is-drop-target');
			this.updateManualDropIndicator(cell, event, preset);
		});
		cell.addEventListener('dragover', event => {
			if (!this.draggedCardContext) return;
			event.preventDefault();
			event.dataTransfer!.dropEffect = 'move';
			this.hideCellQuickAdd(cell);
			cell.addClass('is-drop-target');
			this.updateManualDropIndicator(cell, event, preset);
		});
		cell.addEventListener('dragleave', event => {
			const related = event.relatedTarget;
			if (related instanceof Node && cell.contains(related)) return;
			cell.removeClass('is-drop-target');
			this.clearManualDropIndicator(cell);
		});
		cell.addEventListener('drop', event => {
			if (!this.draggedCardContext || !this.callbacks.onCardDrop) return;
			event.preventDefault();
			this.hideCellQuickAdd(cell);
			cell.removeClass('is-drop-target');
			const dragged = this.draggedCardContext;
			const targetBeforeTaskId = preset.sortMode === 'manual'
				? this.resolveManualDropBeforeTaskId(cell, event, preset)
				: null;
			const context: KanbanDropContext = {
				taskId: dragged.taskId,
				sourceStatusId: dragged.sourceStatusId,
				sourceLaneKey: dragged.sourceLaneKey,
				targetStatusId: column.statusId,
				targetLaneKey: lane.key,
				swimlaneBy: preset.swimlaneBy,
				targetBeforeTaskId,
			};
			this.completeKanbanCardDrop(cell, dragged, context, targetBeforeTaskId, preset);
		});
	}

	private updateManualDropIndicator(cell: HTMLElement, event: DragEvent, preset: KanbanPreset): void {
		this.updateManualDropIndicatorAt(cell, event.clientY, preset);
	}

	private updateManualDropIndicatorAt(cell: HTMLElement, pointerY: number, preset: KanbanPreset): void {
		if (preset.sortMode !== 'manual' || cell.classList.contains('is-collapsed')) {
			this.clearManualDropIndicator(cell);
			return;
		}
		const beforeCard = this.findManualDropBeforeCard(cell, pointerY);
		const indicator = this.ensureManualDropIndicator(cell);
		let beforeTaskId = beforeCard?.dataset.operonTaskId ?? '';
		if (beforeCard) {
			cell.insertBefore(indicator, beforeCard);
		} else {
			const sentinel = cell.querySelector<HTMLElement>(':scope > .operon-kanban-lazy-sentinel');
			if (sentinel) {
				cell.insertBefore(indicator, sentinel);
				beforeTaskId = sentinel.dataset.kanbanNextTaskId ?? '';
			} else {
				cell.appendChild(indicator);
			}
		}
		cell.dataset.kanbanDropBeforeTaskId = beforeTaskId;
	}

	private resolveManualDropBeforeTaskId(cell: HTMLElement, event: DragEvent, preset: KanbanPreset): string | null {
		return this.resolveManualDropBeforeTaskIdAt(cell, event.clientY, preset);
	}

	private resolveManualDropBeforeTaskIdAt(cell: HTMLElement, pointerY: number, preset: KanbanPreset): string | null {
		this.updateManualDropIndicatorAt(cell, pointerY, preset);
		const beforeTaskId = cell.dataset.kanbanDropBeforeTaskId ?? '';
		return beforeTaskId || null;
	}

	private completeKanbanCardDrop(
		targetCell: HTMLElement,
		dragged: DraggedKanbanCardContext,
		context: KanbanDropContext,
		targetBeforeTaskId: string | null,
		preset: KanbanPreset,
	): void {
		this.draggedCardContext = null;
		targetCell.removeClass('is-drop-target');
		this.clearManualDropIndicator(targetCell);
		if (
			preset.sortMode !== 'manual'
			&& context.sourceStatusId === context.targetStatusId
			&& context.sourceLaneKey === context.targetLaneKey
		) {
			dragged.cardEl.removeClass('is-dragging');
			return;
		}
		if (!this.callbacks.onCardDrop) {
			dragged.cardEl.removeClass('is-dragging');
			return;
		}

		this.registerOptimisticMove(context);
		if (shouldApplyImmediateKanbanCardDrop(targetCell.classList.contains('is-collapsed'))) {
			this.applyImmediateCardDrop(targetCell, dragged.cardEl, targetBeforeTaskId);
		} else {
			dragged.cardEl.removeClass('is-dragging');
			this.render();
		}
		void Promise.resolve(this.callbacks.onCardDrop(context))
			.then(() => {
				this.markDirty();
			})
			.catch(error => {
				console.error('Operon: Kanban card drop failed', error);
				new Notice(t('notifications', 'kanbanActionFailed'));
				this.optimisticMoves.delete(context.taskId);
				this.markDirty();
			});
	}

	private ensureManualDropIndicator(cell: HTMLElement): HTMLElement {
		const existing = cell.querySelector<HTMLElement>(':scope > .operon-kanban-drop-indicator');
		if (existing) return existing;
		const indicator = cell.createDiv('operon-kanban-drop-indicator');
		indicator.setAttr('aria-hidden', 'true');
		return indicator;
	}

	private findManualDropBeforeCard(cell: HTMLElement, pointerY: number): HTMLElement | null {
		const cards = Array.from(cell.querySelectorAll<HTMLElement>(':scope > .operon-kanban-card'))
			.filter(card => card.dataset.kanbanPreview !== 'true')
			.filter(card => !card.classList.contains('is-dragging'));
		return cards.find(card => {
			const rect = card.getBoundingClientRect();
			return pointerY < rect.top + rect.height / 2;
		}) ?? null;
	}

	private clearManualDropIndicators(root: HTMLElement): void {
		for (const cell of Array.from(root.querySelectorAll<HTMLElement>('.operon-kanban-cell'))) {
			this.clearManualDropIndicator(cell);
		}
	}

	private clearManualDropIndicator(cell: HTMLElement): void {
		cell.querySelector<HTMLElement>(':scope > .operon-kanban-drop-indicator')?.remove();
		delete cell.dataset.kanbanDropBeforeTaskId;
	}

	private applyImmediateCardDrop(targetCell: HTMLElement, cardEl: HTMLElement, beforeTaskId: string | null): void {
		if (!cardEl.isConnected) return;
		cardEl.removeClass('is-dragging');
		cardEl.addClass('is-optimistic-move');
		const beforeCard = beforeTaskId
			? Array.from(targetCell.querySelectorAll<HTMLElement>(':scope > .operon-kanban-card'))
				.find(card => card.dataset.operonTaskId === beforeTaskId && card !== cardEl) ?? null
			: null;
		const sentinel = targetCell.querySelector<HTMLElement>(':scope > .operon-kanban-lazy-sentinel');
		if (beforeCard) {
			targetCell.insertBefore(cardEl, beforeCard);
		} else if (sentinel) {
			targetCell.insertBefore(cardEl, sentinel);
		} else {
			targetCell.appendChild(cardEl);
		}
		const cardCount = targetCell.querySelectorAll(':scope > .operon-kanban-card').length;
		this.applyCellHeightLimit(targetCell, this.getSettings().kanbanMaxVisibleTasksPerCell, cardCount);
		const boardEl = targetCell.closest<HTMLElement>('.operon-kanban-board');
		if (!boardEl) return;
		const laneLabels = Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-lane-label'));
		const gridRows = Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-row'));
		this.syncRowCellHeights(gridRows);
		this.syncLaneHeights(laneLabels, gridRows);
	}

	private registerOptimisticMove(context: KanbanDropContext): void {
		this.optimisticMoves.set(context.taskId, createKanbanDropOptimisticMove(context, {
			task: this.indexer.getTask(context.taskId),
			keyMappings: this.getSettings().keyMappings,
		}));
	}

	private bindCellQuickAdd(
		cell: HTMLElement,
		column: KanbanColumn,
		lane: KanbanLane,
		preset: KanbanPreset,
		gridViewport: HTMLElement,
	): void {
		if (!this.callbacks.onCellAction) return;
		const overlay = cell.createDiv('operon-kanban-cell-add-overlay');
		const button = overlay.createEl('button', {
			cls: 'operon-kanban-cell-add-button',
			attr: {
				type: 'button',
			},
		});
		const desktopIcon = button.createSpan('operon-kanban-cell-add-icon is-desktop-icon');
		setIcon(desktopIcon, 'list-plus');
		if (!desktopIcon.querySelector('svg')) {
			setIcon(desktopIcon, 'list');
		}
		const mobileIcon = button.createSpan('operon-kanban-cell-add-icon is-mobile-icon');
		setIcon(mobileIcon, 'plus');
		if (!mobileIcon.querySelector('svg')) {
			mobileIcon.setText('+');
		}
		setAccessibleLabelWithoutTooltip(button, preset.swimlaneBy
			? t('tooltips', 'addTaskToKanbanCell', {
				status: column.statusLabel,
				lane: lane.label,
			})
			: t('tooltips', 'addTaskToKanbanStatus', {
				status: column.statusLabel,
			}));
		const actionContext: KanbanCellActionContext = {
			targetStatusId: column.statusId,
			targetStatusLabel: column.statusLabel,
			targetLaneKey: lane.key,
			targetLaneLabel: lane.label,
			swimlaneBy: preset.swimlaneBy,
			pipelineId: preset.pipelineId,
		};
		button.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.hideCellQuickAdd(cell);
			void this.callbacks.onCellAction?.(actionContext);
		});

		const setVisible = (nextVisible: boolean): void => {
			const isVisible = overlay.classList.contains('is-visible');
			if (isVisible === nextVisible) return;
			cell.classList.toggle('is-add-hotspot-active', nextVisible);
			overlay.classList.toggle('is-visible', nextVisible);
		};
		const isMobileQuickAddLayout = (): boolean => {
			const boardEl = cell.closest<HTMLElement>('.operon-kanban-board');
			return boardEl?.classList.contains('is-mobile-layout') === true;
		};
		const handleMobileCellClick = (event: MouseEvent): void => {
			if (!isMobileQuickAddLayout() || this.draggedCardContext) return;
			const target = asHTMLElement(event.target, cell);
			if (!target) return;
			if (target.closest('.operon-kanban-cell-add-button')) return;
			this.hideCellQuickAdds(cell, cell);
			if (target.closest('.operon-kanban-card, button, input, textarea, select, a, .operon-calendar-hover-menu')) {
				setVisible(false);
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (overlay.classList.contains('is-visible')) {
				setVisible(false);
				return;
			}
			setVisible(true);
		};
		const updateFromPointer = (event: PointerEvent): void => {
			if (isMobileQuickAddLayout()) return;
			if (this.draggedCardContext) {
				setVisible(false);
				return;
			}
			const rect = cell.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				setVisible(false);
				return;
			}
			const xRatio = (event.clientX - rect.left) / rect.width;
			const yRatio = (event.clientY - rect.top) / rect.height;
			const isWithinCenter = xRatio >= 0.375 && xRatio <= 0.625
				&& yRatio >= 0.375 && yRatio <= 0.625;
			setVisible(isWithinCenter);
		};

		cell.addEventListener('click', handleMobileCellClick);
		cell.addEventListener('pointermove', updateFromPointer);
		cell.addEventListener('pointerleave', () => setVisible(false));
		cell.addEventListener('scroll', () => setVisible(false));
		gridViewport.addEventListener('scroll', () => setVisible(false));
		cell.addEventListener('dragstart', () => setVisible(false));
		cell.addEventListener('drop', () => setVisible(false));
	}

	private hideCellQuickAdds(container: HTMLElement, exceptCell?: HTMLElement): void {
		const boardEl = container.closest<HTMLElement>('.operon-kanban-board');
		const root = boardEl ?? container;
		const visibleCells = Array.from(root.querySelectorAll('.operon-kanban-cell.is-add-hotspot-active'))
			.map(element => asHTMLElement(element, root))
			.filter((element): element is HTMLElement => element !== null);
		for (const cell of visibleCells) {
			if (cell === exceptCell) continue;
			this.hideCellQuickAdd(cell);
		}
	}

	private hideCellQuickAdd(cell: HTMLElement): void {
		cell.classList.remove('is-add-hotspot-active');
		const overlay = cell.querySelector<HTMLElement>('.operon-kanban-cell-add-overlay');
		overlay?.classList.remove('is-visible');
	}

	private renderStatusButton(
		container: HTMLElement,
		task: IndexedTask,
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string | null,
		laneKey: string,
	): void {
		if (!this.callbacks.onStatusIconClick) return;
			const button = container.createEl('button', {
				cls: 'operon-checkbox operon-calendar-status-button is-compact',
				attr: {
					type: 'button',
				},
			});
		const iconName = resolveTaskDisplayIcon(this.getSettings(), task.fieldValues, task.checkbox);
			if (iconName) {
				setIcon(button, iconName);
			}
			setAccessibleLabelWithoutTooltip(button, t('tooltips', 'cycleTaskStatus'));
		const statusDef = findStatusDef(this.getSettings().pipelines, task.fieldValues['status'] ?? '');
		if (statusDef?.color) {
			button.style.color = statusDef.color;
		}
		button.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.invokeKanbanStatusIconClick(task, pipeline, preset, statusId, laneKey);
		});
	}

	private invokeKanbanStatusIconClick(
		task: IndexedTask,
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string | null,
		laneKey: string,
	): void {
		if (!this.callbacks.onStatusIconClick) return;
		const startedAt = enginePerfNow();
		const plan = buildKanbanOptimisticStatusMovePlan({
			task,
			pipeline,
			preset,
			pipelines: this.getSettings().pipelines,
			keyMappings: this.getSettings().keyMappings,
			sourceStatusId: statusId,
			sourceLaneKey: laneKey,
		});
		const applied = plan.move !== null;
		const fallbackReason = applied ? 'none' : plan.fallbackReason;
		if (applied) {
			this.optimisticMoves.set(task.operonId, plan.move);
			this.render();
		}

		enginePerfLog(
			'kanban.optimisticStatus',
			`taskId=${task.operonId}`,
			`applied=${String(applied)}`,
			`nextStatus=${applied ? plan.nextStatus : 'none'}`,
			`nextCheckbox=${applied ? plan.nextCheckbox : 'none'}`,
			`sourceLanes=${applied ? plan.sourceLaneKeys.join(',') : 'none'}`,
			`targetStatusId=${applied ? plan.targetStatusId : 'none'}`,
			`renderMs=${Math.round(enginePerfNow() - startedAt)}`,
			`fallbackReason=${fallbackReason}`,
		);

			void Promise.resolve(this.callbacks.onStatusIconClick(task.operonId))
				.then(() => {
					if (applied) {
						const freshTask = this.indexer.getTask(task.operonId);
						if (!freshTask || !pipeline || !isKanbanOptimisticMoveSatisfied(freshTask, pipeline, preset, plan.move, this.getSettings().keyMappings)) {
							this.optimisticMoves.delete(task.operonId);
						}
						this.markDirty();
					}
				})
			.catch(error => {
				console.error('Operon: Kanban status click failed', error);
				new Notice(t('notifications', 'kanbanActionFailed'));
				this.optimisticMoves.delete(task.operonId);
				this.markDirty();
			});
	}

	private applyTaskColor(element: HTMLElement, task: IndexedTask, preset: KanbanPreset): void {
		if (preset.colorSource === 'noColor') {
			element.setCssProps({ '--operon-calendar-accent': 'transparent' });
			return;
		}
		const resolvedColor = resolveTaskColorSourceForTask(task, preset.colorSource, this.getSettings());
		if (!resolvedColor) {
			element.style.removeProperty('--operon-calendar-accent');
			return;
		}
		element.style.setProperty('--operon-calendar-accent', resolvedColor);
	}

	private bindHoverMenuTarget(triggerEl: HTMLElement, task: IndexedTask): void {
		if (!this.callbacks.onItemAction) return;
		bindContextualHoverMenuTrigger({
			controller: this.hoverMenu,
			triggerEl,
			menuKey: task.operonId,
			getSettings: () => this.getSettings(),
			openMenu: ({ mobile }) => {
				const context = this.resolveHoverContext(task);
				const actions = this.resolveHoverActions(context);
				if (actions.length === 0) return false;
				return this.showHoverMenu(triggerEl, task.operonId, actions, context, mobile);
			},
		});
	}

	private resolveHoverContext(task: IndexedTask): ContextualMenuContext {
		return {
			surface: 'kanbanCard',
			taskId: task.operonId,
			task,
			now: localNow(),
			isPinned: this.getPinnedCache()?.isPinned(task.operonId) ?? false,
			hasSubtasks: this.indexer.secondary.getChildIds(task.operonId).size > 0,
		};
	}

	private resolveHoverActions(context: ContextualMenuContext): ResolvedContextualMenuAction[] {
		const settings = this.getSettings();
		return resolveContextualMenu(
			context,
			settings.contextualMenuActionAllowlist,
			settings.contextualMenuSurfaceActionMatrix,
		);
	}

	private showHoverMenu(
		anchorEl: HTMLElement,
		taskId: string,
		actions: ResolvedContextualMenuAction[],
		context: ContextualMenuContext,
		mobileInteraction = false,
	): boolean {
		if (actions.length === 0 || !this.callbacks.onItemAction) return false;
		return this.hoverMenu.show({
			key: taskId,
			taskId,
			actions,
			anchorRect: anchorEl.getBoundingClientRect(),
			context,
			onAction: this.callbacks.onItemAction,
			mobileInteraction: mobileInteraction
				? {
					transitionGraceMs: this.getSettings().contextualMenuMobileTransitionGraceMs,
					autoHideMs: this.getSettings().contextualMenuMobileAutoHideMs,
					guardTargets: [anchorEl],
				}
				: undefined,
		});
	}

	private positionHoverMenu(anchorRect: DOMRect, menu: HTMLElement): boolean {
		const host = this.contentEl;
		const hostRect = host.getBoundingClientRect();
		const position = resolveContextualHoverMenuPosition(
			anchorRect,
			hostRect,
			menu.getBoundingClientRect(),
		);
		if (!position) return false;
		menu.style.left = `${position.left - hostRect.left}px`;
		menu.style.top = `${position.top - hostRect.top}px`;
		menu.style.width = `${position.width}px`;
		menu.style.maxHeight = `${Math.floor(position.maxHeight)}px`;
		return true;
	}

	private hideHoverMenu(immediate = true): void {
		this.hoverMenu.hide(immediate);
	}

	private buildColumnTemplate(columns: KanbanColumn[], collapsedStatusIds: string[]): string {
		return columns.map(column => collapsedStatusIds.includes(column.statusId)
			? 'var(--operon-kanban-collapsed-width)'
			: 'var(--operon-kanban-column-width)')
			.join(' ');
	}

	private renderCornerSummary(container: HTMLElement, totalTasks: number): void {
		container.empty();
		container.createDiv({
			text: String(totalTasks),
			cls: 'operon-kanban-corner-total',
		});
	}

	private renderCollapsedCellSummary(container: HTMLElement, count: number): void {
		container.empty();
		const summary = container.createDiv('operon-kanban-collapsed-cell-summary');
		summary.setText(String(count));
	}

	private scheduleLaneColumnWidthRefresh(boardEl: HTMLElement, laneTitles: HTMLElement[]): void {
		this.clearLaneColumnWidthFrame();
		this.laneColumnWidthFrame = window.requestAnimationFrame(() => {
			this.laneColumnWidthFrame = null;
			this.refreshLaneColumnWidth(boardEl, laneTitles);
		});
	}

	private measureLaneTitleNaturalWidth(title: HTMLElement): number {
		const text = title.textContent ?? '';
		if (!text) return 0;
		const computed = getOwnerWindow(title).getComputedStyle(title);
		const measurer = createOwnerElement(title, 'span');
		measurer.addClass('operon-kanban-lane-measurer');
		measurer.textContent = text;
		measurer.style.font = computed.font;
		measurer.style.fontWeight = computed.fontWeight;
		measurer.style.fontSize = computed.fontSize;
		measurer.style.fontFamily = computed.fontFamily;
		measurer.style.letterSpacing = computed.letterSpacing;
		measurer.style.textTransform = computed.textTransform;
		getOwnerBody(title).appendChild(measurer);
		const width = measurer.getBoundingClientRect().width;
		measurer.remove();
		return width;
	}

	private refreshLaneColumnWidth(boardEl: HTMLElement, laneTitles: HTMLElement[]): void {
		if (boardEl.classList.contains('is-mobile-swimlane-overlay') && this.lastLaneColumnWidthPx !== null) {
			boardEl.style.setProperty('--operon-kanban-lane-column-width', `${this.lastLaneColumnWidthPx}px`);
			return;
		}
		const firstLabel = boardEl.querySelector<HTMLElement>('.operon-kanban-lane-label');
		const countButton = boardEl.querySelector<HTMLElement>('.operon-kanban-lane-count-button');
		if (!firstLabel || !countButton || laneTitles.length === 0) {
			this.lastLaneColumnWidthPx = 96;
			boardEl.setCssProps({ '--operon-kanban-lane-column-width': '96px' });
			return;
		}
		const computed = window.getComputedStyle(firstLabel);
		const gap = Number.parseFloat(computed.columnGap || computed.gap || '0') || 0;
		const paddingInline =
			(Number.parseFloat(computed.paddingLeft || '0') || 0) +
			(Number.parseFloat(computed.paddingRight || '0') || 0);
		const countWidth = countButton.getBoundingClientRect().width;
		let maxTitleWidth = 0;
		for (const title of laneTitles) {
			maxTitleWidth = Math.max(maxTitleWidth, this.measureLaneTitleNaturalWidth(title));
		}
		const widthPx = Math.max(96, Math.ceil(maxTitleWidth + countWidth + gap + paddingInline));
		this.lastLaneColumnWidthPx = widthPx;
		boardEl.style.setProperty('--operon-kanban-lane-column-width', `${widthPx}px`);
	}

	private clearLaneColumnWidthFrame(): void {
		if (this.laneColumnWidthFrame === null) return;
		window.cancelAnimationFrame(this.laneColumnWidthFrame);
		this.laneColumnWidthFrame = null;
	}

	private bindBoardLayoutRefresh(
		boardEl: HTMLElement,
		laneLabels: HTMLElement[],
		gridRows: HTMLElement[],
		laneTitles: HTMLElement[],
		hasSwimlanes: boolean,
	): void {
		const refresh = (): void => {
			if (!boardEl.isConnected || boardEl.getBoundingClientRect().width <= 0) return;
			this.syncRowCellHeights(gridRows);
			if (hasSwimlanes) {
				this.syncLaneHeights(laneLabels, gridRows);
				this.scheduleLaneColumnWidthRefresh(boardEl, laneTitles);
			}
		};
		const scheduleRefresh = (): void => {
			if (this.boardLayoutRefreshFrame !== null) return;
			this.boardLayoutRefreshFrame = window.requestAnimationFrame(() => {
				this.boardLayoutRefreshFrame = null;
				refresh();
			});
		};

		this.clearBoardLayoutRefresh();
		scheduleRefresh();
		window.requestAnimationFrame(scheduleRefresh);
		window.requestAnimationFrame(() => window.requestAnimationFrame(scheduleRefresh));
		window.setTimeout(scheduleRefresh, 0);
		window.setTimeout(scheduleRefresh, 120);

		const observer = new ResizeObserver(() => scheduleRefresh());
		observer.observe(boardEl);
		if (boardEl.parentElement) observer.observe(boardEl.parentElement);
		for (const gridRow of gridRows) {
			observer.observe(gridRow);
		}
		this.boardLayoutRefreshCleanup = () => observer.disconnect();
	}

	private clearBoardLayoutRefresh(): void {
		if (this.boardLayoutRefreshFrame !== null) {
			window.cancelAnimationFrame(this.boardLayoutRefreshFrame);
			this.boardLayoutRefreshFrame = null;
		}
		this.boardLayoutRefreshCleanup?.();
		this.boardLayoutRefreshCleanup = null;
	}

	private bindKanbanMobileLayout(boardEl: HTMLElement, gridViewport: HTMLElement, hasSwimlanes: boolean): void {
		this.clearKanbanMobileLayout();
		const root = boardEl.closest<HTMLElement>('.operon-kanban-root');
		if (!root) return;

		const ownerWindow = getOwnerWindow(gridViewport);
		const mediaQuery = ownerWindow.matchMedia(KANBAN_MOBILE_LAYOUT_MEDIA_QUERY);
		let applyFrame: number | null = null;
		let lastDragEdgeSnapAt = 0;
		let verticalDragScrollFrame: number | null = null;
		let verticalDragScrollClientX = 0;
		let verticalDragScrollClientY = 0;
		let verticalDragScrollActive = false;

		const isMobileLayoutEligible = (): boolean => {
			const settings = this.getSettings();
			return settings.kanbanMobileLayoutChromeEnabled === true
				&& (mediaQuery.matches || isKanbanMobilePlatform())
				&& gridViewport.clientWidth <= settings.kanbanMobileLayoutMaxWidthPx;
		};
		const applyState = (): void => {
			applyFrame = null;
			const settings = this.getSettings();
			boardEl.style.setProperty('--operon-kanban-mobile-lane-handle-width', `${settings.kanbanMobileCompactSwimlaneWidthPx}px`);
			const mobileLayout = isMobileLayoutEligible();
			root.classList.toggle('is-mobile-layout', mobileLayout);
			boardEl.classList.toggle('is-mobile-layout', mobileLayout);

			if (!mobileLayout) {
				clearMobileCardHorizontalSettle();
				root.classList.remove('is-mobile-chrome-hidden', 'is-mobile-status-rail', 'is-mobile-status-snap', 'is-mobile-swimlane-overlay');
				boardEl.classList.remove('is-mobile-chrome-hidden', 'is-mobile-status-rail', 'is-mobile-status-snap', 'is-mobile-swimlane-overlay');
				return;
			}

			const swimlaneOverlay = hasSwimlanes
				&& (
					settings.kanbanMobileSwimlaneRailAlwaysVisible === true
					|| gridViewport.scrollLeft > KANBAN_MOBILE_SWIMLANE_SCROLL_LEFT_THRESHOLD_PX
				);
			const statusSnap = settings.kanbanMobileHorizontalStatusSnapEnabled === true;
			root.classList.toggle('is-mobile-swimlane-overlay', swimlaneOverlay);
			boardEl.classList.toggle('is-mobile-swimlane-overlay', swimlaneOverlay);
			root.classList.toggle('is-mobile-status-snap', statusSnap);
			boardEl.classList.toggle('is-mobile-status-snap', statusSnap);
		};
		const clearMobileCardHorizontalSettle = (): void => {
			if (mobileCardHorizontalSettleTimer !== null) {
				ownerWindow.clearTimeout(mobileCardHorizontalSettleTimer);
				mobileCardHorizontalSettleTimer = null;
			}
			boardEl.removeClass('is-mobile-card-scroll-active');
		};
		const resolveStatusSnapScrollLeftTargets = (): number[] => {
			const viewportRect = gridViewport.getBoundingClientRect();
			const maxScrollLeft = Math.max(0, gridViewport.scrollWidth - gridViewport.clientWidth);
			if (maxScrollLeft <= 0) return [];
			const currentLeft = gridViewport.scrollLeft;
			const computed = ownerWindow.getComputedStyle(gridViewport);
			const scrollPaddingLeft = Number.parseFloat(computed.scrollPaddingLeft || '0') || 0;
			return Array.from(gridViewport.querySelectorAll<HTMLElement>('.operon-kanban-column-header'))
				.map(header => {
					const rect = header.getBoundingClientRect();
					return Math.round(currentLeft + rect.left - viewportRect.left - scrollPaddingLeft);
				})
				.map(left => Math.max(0, Math.min(maxScrollLeft, left)))
				.filter((left, index, allTargets) => index === 0 || left !== allTargets[index - 1]);
		};
		const resolveAdjacentSnapScrollLeft = (direction: -1 | 1): number | null => {
			const currentLeft = gridViewport.scrollLeft;
			const targets = resolveStatusSnapScrollLeftTargets();
			if (direction > 0) {
				return targets.find(left => left > currentLeft + KANBAN_MOBILE_DRAG_EDGE_SNAP_EPSILON_PX) ?? null;
			}
			for (let index = targets.length - 1; index >= 0; index--) {
				const left = targets[index];
				if (left < currentLeft - KANBAN_MOBILE_DRAG_EDGE_SNAP_EPSILON_PX) return left;
			}
			return null;
		};
		const resolveNearestSnapScrollLeft = (): number | null => {
			const targets = resolveStatusSnapScrollLeftTargets();
			if (targets.length === 0) return null;
			const currentLeft = gridViewport.scrollLeft;
			let nearest = targets[0];
			let nearestDistance = Math.abs(nearest - currentLeft);
			for (const target of targets.slice(1)) {
				const distance = Math.abs(target - currentLeft);
				if (distance < nearestDistance) {
					nearest = target;
					nearestDistance = distance;
				}
			}
			return nearest;
		};
		const maybeSnapDragToAdjacentStatus = (clientX: number): void => {
			const settings = this.getSettings();
			if (
				!this.draggedCardContext
				|| settings.kanbanMobileHorizontalStatusSnapEnabled !== true
				|| !isMobileLayoutEligible()
			) {
				return;
			}
			const viewportRect = gridViewport.getBoundingClientRect();
			if (viewportRect.width <= 0) return;
			let direction: -1 | 1 | null = null;
			if (clientX <= viewportRect.left + KANBAN_MOBILE_DRAG_EDGE_SNAP_ZONE_PX) {
				direction = -1;
			} else if (clientX >= viewportRect.right - KANBAN_MOBILE_DRAG_EDGE_SNAP_ZONE_PX) {
				direction = 1;
			}
			if (direction === null) return;
			const now = ownerWindow.performance.now();
			if (now - lastDragEdgeSnapAt < KANBAN_MOBILE_DRAG_EDGE_SNAP_COOLDOWN_MS) return;
			const targetLeft = resolveAdjacentSnapScrollLeft(direction);
			if (targetLeft === null) return;
			lastDragEdgeSnapAt = now;
			gridViewport.scrollTo({ left: targetLeft, behavior: 'smooth' });
			scheduleApplyState();
		};
		const canScrollVertically = (element: HTMLElement, direction: -1 | 1): boolean => {
			const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
			if (maxScrollTop <= 0) return false;
			return direction < 0
				? element.scrollTop > 0
				: element.scrollTop < maxScrollTop - 1;
		};
		const resolveVerticalScrollDirection = (rect: DOMRect, clientY: number, edgeSize: number): -1 | 1 | null => {
			if (clientY <= rect.top + edgeSize) return -1;
			if (clientY >= rect.bottom - edgeSize) return 1;
			return null;
		};
		const resolveVerticalScrollStep = (rect: DOMRect, clientY: number, direction: -1 | 1, edgeSize: number): number => {
			const edgeDistance = direction < 0
				? Math.max(0, edgeSize - (clientY - rect.top))
				: Math.max(0, edgeSize - (rect.bottom - clientY));
			const ratio = Math.max(0, Math.min(1, edgeDistance / edgeSize));
			return Math.round(
				KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_MIN_STEP_PX
				+ ((KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_MAX_STEP_PX - KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_MIN_STEP_PX) * ratio),
			);
		};
		const resolveVerticalDragScroll = (clientX: number, clientY: number): {
			direction: -1 | 1;
			step: number;
			target: HTMLElement;
		} | null => {
			const pointElement = asHTMLElement(getOwnerDocument(gridViewport).elementFromPoint(clientX, clientY), gridViewport);
			const scrollCell = pointElement?.closest<HTMLElement>('.operon-kanban-cell.is-scroll-limited') ?? null;
			if (scrollCell && gridViewport.contains(scrollCell)) {
				const cellRect = scrollCell.getBoundingClientRect();
				const cellEdgeSize = Math.max(24, Math.min(KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_EDGE_PX, cellRect.height / 3));
				const cellDirection = resolveVerticalScrollDirection(cellRect, clientY, cellEdgeSize);
				if (cellDirection !== null && canScrollVertically(scrollCell, cellDirection)) {
					return {
						direction: cellDirection,
						step: resolveVerticalScrollStep(cellRect, clientY, cellDirection, cellEdgeSize),
						target: scrollCell,
					};
				}
			}

			const viewportRect = gridViewport.getBoundingClientRect();
			const viewportDirection = resolveVerticalScrollDirection(
				viewportRect,
				clientY,
				KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_EDGE_PX,
			);
			if (viewportDirection === null || !canScrollVertically(gridViewport, viewportDirection)) return null;
			return {
				direction: viewportDirection,
				step: resolveVerticalScrollStep(
					viewportRect,
					clientY,
					viewportDirection,
					KANBAN_MOBILE_DRAG_VERTICAL_SCROLL_EDGE_PX,
				),
				target: gridViewport,
			};
		};
		const stopVerticalDragAutoScroll = (): void => {
			verticalDragScrollActive = false;
			if (verticalDragScrollFrame !== null) {
				ownerWindow.cancelAnimationFrame(verticalDragScrollFrame);
				verticalDragScrollFrame = null;
			}
		};
		const runVerticalDragAutoScroll = (): void => {
			verticalDragScrollFrame = null;
			if (!verticalDragScrollActive || !this.draggedCardContext || !isMobileLayoutEligible()) {
				stopVerticalDragAutoScroll();
				return;
			}
			const scroll = resolveVerticalDragScroll(verticalDragScrollClientX, verticalDragScrollClientY);
			if (scroll === null) {
				stopVerticalDragAutoScroll();
				return;
			}
			const maxScrollTop = Math.max(0, scroll.target.scrollHeight - scroll.target.clientHeight);
			const nextTop = Math.max(0, Math.min(maxScrollTop, scroll.target.scrollTop + (scroll.step * scroll.direction)));
			if (nextTop === scroll.target.scrollTop) {
				stopVerticalDragAutoScroll();
				return;
			}
			scroll.target.scrollTop = nextTop;
			if (scroll.target === gridViewport) scheduleApplyState();
			verticalDragScrollFrame = ownerWindow.requestAnimationFrame(runVerticalDragAutoScroll);
		};
		const maybeAutoScrollDragVertically = (clientX: number, clientY: number): void => {
			if (!this.draggedCardContext || !isMobileLayoutEligible()) {
				stopVerticalDragAutoScroll();
				return;
			}
			verticalDragScrollClientX = clientX;
			verticalDragScrollClientY = clientY;
			if (resolveVerticalDragScroll(verticalDragScrollClientX, verticalDragScrollClientY) === null) {
				stopVerticalDragAutoScroll();
				return;
			}
			verticalDragScrollActive = true;
			if (verticalDragScrollFrame === null) {
				verticalDragScrollFrame = ownerWindow.requestAnimationFrame(runVerticalDragAutoScroll);
			}
		};
		const handleMobileDragOver = (event: DragEvent): void => {
			maybeSnapDragToAdjacentStatus(event.clientX);
			maybeAutoScrollDragVertically(event.clientX, event.clientY);
		};
		let mobileGesture: KanbanMobileCardGestureState | null = null;
		let mobileDragFrame: number | null = null;
		let mobileClickSuppressionCleanup: (() => void) | null = null;
		let mobileTouchDragActiveBody: HTMLElement | null = null;
		let mobileCardHorizontalSettleTimer: ReturnType<Window['setTimeout']> | null = null;

		const isTouchLikePointer = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';
		const isInteractiveCardGestureTarget = (target: HTMLElement): boolean => Boolean(target.closest(
			'.operon-calendar-status-button, .operon-calendar-hover-menu, .operon-kanban-descendant-toggle, button, input, textarea, select, a, [contenteditable="true"]',
		));
		const resolveGestureCard = (target: HTMLElement | null): HTMLElement | null => {
			if (!target || isInteractiveCardGestureTarget(target)) return null;
			const card = target.closest<HTMLElement>('.operon-kanban-card');
			if (!card || card.dataset.kanbanPreview === 'true' || !boardEl.contains(card)) return null;
			return card;
		};
		const suppressNextMobileCardClick = (gesture: KanbanMobileCardGestureState): void => {
			if (gesture.clickSuppressed) return;
			gesture.clickSuppressed = true;
			mobileClickSuppressionCleanup?.();
			let cleanupTimer: ReturnType<Window['setTimeout']> | null = null;
			const cleanup = (): void => {
				gesture.ownerWindow.removeEventListener('click', onClick, true);
				if (cleanupTimer !== null) {
					gesture.ownerWindow.clearTimeout(cleanupTimer);
					cleanupTimer = null;
				}
				if (mobileClickSuppressionCleanup === cleanup) {
					mobileClickSuppressionCleanup = null;
				}
			};
			const onClick = (clickEvent: MouseEvent): void => {
				const target = asHTMLElement(clickEvent.target, boardEl);
				if (!target || !boardEl.contains(target)) return;
				clickEvent.preventDefault();
				clickEvent.stopPropagation();
				clickEvent.stopImmediatePropagation();
				cleanup();
			};
			gesture.ownerWindow.addEventListener('click', onClick, true);
			cleanupTimer = gesture.ownerWindow.setTimeout(cleanup, KANBAN_MOBILE_CARD_CLICK_SUPPRESSION_MS);
			mobileClickSuppressionCleanup = cleanup;
		};
		const scrollElementBy = (element: HTMLElement, delta: number): number => {
			if (Math.abs(delta) < 0.01) return 0;
			const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
			if (maxScroll <= 0) return delta;
			const start = element.scrollTop;
			const next = Math.max(0, Math.min(maxScroll, start + delta));
			element.scrollTop = next;
			return delta - (next - start);
		};
		const scrollViewportHorizontally = (delta: number): number => {
			if (Math.abs(delta) < 0.01) return 0;
			boardEl.addClass('is-mobile-card-scroll-active');
			const maxScroll = Math.max(0, gridViewport.scrollWidth - gridViewport.clientWidth);
			const start = gridViewport.scrollLeft;
			const next = Math.max(0, Math.min(maxScroll, gridViewport.scrollLeft + delta));
			gridViewport.scrollLeft = next;
			return next - start;
		};
		const settleMobileCardHorizontalScroll = (gesture: KanbanMobileCardGestureState): void => {
			const settings = this.getSettings();
			if (
				gesture.horizontalScrollDistance < 1
				|| settings.kanbanMobileHorizontalStatusSnapEnabled !== true
				|| !isMobileLayoutEligible()
			) {
				clearMobileCardHorizontalSettle();
				return;
			}
			const targetLeft = resolveNearestSnapScrollLeft();
			if (targetLeft === null) {
				clearMobileCardHorizontalSettle();
				return;
			}
			if (mobileCardHorizontalSettleTimer !== null) {
				ownerWindow.clearTimeout(mobileCardHorizontalSettleTimer);
			}
			boardEl.addClass('is-mobile-card-scroll-active');
			gridViewport.scrollTo({ left: targetLeft, behavior: 'smooth' });
			scheduleApplyState();
			mobileCardHorizontalSettleTimer = ownerWindow.setTimeout(() => {
				mobileCardHorizontalSettleTimer = null;
				boardEl.removeClass('is-mobile-card-scroll-active');
				scheduleApplyState();
			}, KANBAN_MOBILE_CARD_SCROLL_SNAP_SETTLE_MS);
		};
		const applyMobileCardScroll = (gesture: KanbanMobileCardGestureState, event: PointerEvent): void => {
			const deltaX = gesture.previousClientX - event.clientX;
			const deltaY = gesture.previousClientY - event.clientY;
			if (gesture.scrollAxis === 'x') {
				const horizontalDelta = scrollViewportHorizontally(deltaX);
				gesture.horizontalScrollDistance += Math.abs(horizontalDelta);
			} else {
				let remainingY = deltaY;
				if (gesture.startCell?.classList.contains('is-scroll-limited') && gridViewport.contains(gesture.startCell)) {
					remainingY = scrollElementBy(gesture.startCell, remainingY);
				}
				if (Math.abs(remainingY) >= 0.01) {
					scrollElementBy(gridViewport, remainingY);
				}
			}
			gesture.previousClientX = event.clientX;
			gesture.previousClientY = event.clientY;
			gesture.latestClientX = event.clientX;
			gesture.latestClientY = event.clientY;
			this.hideCellQuickAdds(boardEl);
			scheduleApplyState();
		};
		const resolveMobileDropCell = (clientX: number, clientY: number): HTMLElement | null => {
			const pointElement = asHTMLElement(getOwnerDocument(gridViewport).elementFromPoint(clientX, clientY), gridViewport);
			const cell = pointElement?.closest<HTMLElement>('.operon-kanban-cell') ?? null;
			return cell && boardEl.contains(cell) ? cell : null;
		};
		const clearMobileDropTarget = (gesture: KanbanMobileCardGestureState): void => {
			gesture.activeDropCell?.removeClass('is-drop-target');
			if (gesture.activeDropCell) {
				this.clearManualDropIndicator(gesture.activeDropCell);
			}
			gesture.activeDropCell = null;
		};
		const updateMobileDropTarget = (gesture: KanbanMobileCardGestureState): void => {
			const nextCell = resolveMobileDropCell(gesture.latestClientX, gesture.latestClientY);
			if (gesture.activeDropCell && gesture.activeDropCell !== nextCell) {
				gesture.activeDropCell.removeClass('is-drop-target');
				this.clearManualDropIndicator(gesture.activeDropCell);
				gesture.activeDropCell = null;
			}
			if (!nextCell) return;
			this.hideCellQuickAdd(nextCell);
			nextCell.addClass('is-drop-target');
			this.updateManualDropIndicatorAt(nextCell, gesture.latestClientY, this.resolveCurrentPreset());
			gesture.activeDropCell = nextCell;
		};
		const updateMobileDragPreview = (gesture: KanbanMobileCardGestureState): void => {
			if (!gesture.previewEl) return;
			const left = Math.round(gesture.latestClientX - gesture.dragOffsetX);
			const top = Math.round(gesture.latestClientY - gesture.dragOffsetY);
			gesture.previewEl.style.transform = `translate3d(${left}px, ${top}px, 0)`;
		};
		const createMobileDragPreview = (gesture: KanbanMobileCardGestureState): void => {
			const rect = gesture.cardEl.getBoundingClientRect();
			const preview = gesture.cardEl.cloneNode(true) as HTMLElement;
			preview.removeAttribute('draggable');
			preview.setAttr('aria-hidden', 'true');
			preview.removeClass('is-dragging');
			preview.removeClass('is-mobile-touch-dragging');
			preview.addClass('operon-kanban-mobile-drag-preview');
			preview.style.width = `${Math.max(1, rect.width)}px`;
			preview.style.height = `${Math.max(1, rect.height)}px`;
			gesture.previewEl = preview;
			getOwnerBody(gridViewport).appendChild(preview);
			updateMobileDragPreview(gesture);
		};
		const setMobileTouchDragActiveClass = (): void => {
			const body = getOwnerBody(gridViewport);
			if (mobileTouchDragActiveBody && mobileTouchDragActiveBody !== body) {
				mobileTouchDragActiveBody.classList.remove('operon-kanban-touch-drag-active');
			}
			mobileTouchDragActiveBody = body;
			mobileTouchDragActiveBody.classList.add('operon-kanban-touch-drag-active');
		};
		const clearMobileTouchDragActiveClass = (): void => {
			mobileTouchDragActiveBody?.classList.remove('operon-kanban-touch-drag-active');
			mobileTouchDragActiveBody = null;
		};
		const stopMobileDragLoop = (): void => {
			if (mobileDragFrame !== null) {
				ownerWindow.cancelAnimationFrame(mobileDragFrame);
				mobileDragFrame = null;
			}
		};
		const runMobileDragLoop = (): void => {
			mobileDragFrame = null;
			const gesture = mobileGesture;
			if (!gesture || gesture.mode !== 'dragging') return;
			maybeSnapDragToAdjacentStatus(gesture.latestClientX);
			maybeAutoScrollDragVertically(gesture.latestClientX, gesture.latestClientY);
			updateMobileDropTarget(gesture);
			mobileDragFrame = ownerWindow.requestAnimationFrame(runMobileDragLoop);
		};
		const startMobileDragLoop = (): void => {
			if (mobileDragFrame !== null) return;
			mobileDragFrame = ownerWindow.requestAnimationFrame(runMobileDragLoop);
		};
		const clearMobileGestureTimer = (gesture: KanbanMobileCardGestureState): void => {
			if (gesture.timerId === null) return;
			gesture.ownerWindow.clearTimeout(gesture.timerId);
			gesture.timerId = null;
		};
		const cleanupMobileCardGesture = (
			clearDraggedContext: boolean,
			keepHorizontalScrollSettle = false,
		): KanbanMobileCardGestureState | null => {
			const gesture = mobileGesture;
			if (!gesture) return null;
			clearMobileGestureTimer(gesture);
			gesture.ownerWindow.removeEventListener('pointermove', onMobileCardPointerMove, true);
			gesture.ownerWindow.removeEventListener('pointerup', onMobileCardPointerUp, true);
			gesture.ownerWindow.removeEventListener('pointercancel', onMobileCardPointerCancel, true);
			gesture.ownerWindow.removeEventListener('blur', onMobileWindowBlur, true);
			stopMobileDragLoop();
			stopVerticalDragAutoScroll();
			clearMobileTouchDragActiveClass();
			clearMobileDropTarget(gesture);
			gesture.previewEl?.remove();
			gesture.previewEl = null;
			gesture.cardEl.draggable = gesture.wasDraggable;
			gesture.cardEl.removeClass('is-mobile-touch-dragging');
			gesture.cardEl.removeClass('is-dragging');
			try {
				gesture.cardEl.releasePointerCapture?.(gesture.pointerId);
			} catch {
				// Pointer capture is best-effort in mobile WebViews.
			}
			delete boardEl.dataset.kanbanMobileTouchPointerActive;
			if (!keepHorizontalScrollSettle) {
				clearMobileCardHorizontalSettle();
			}
			if (clearDraggedContext) {
				this.draggedCardContext = null;
				this.clearManualDropIndicators(boardEl);
			}
			mobileGesture = null;
			return gesture;
		};
		const startMobileCardDrag = (gesture: KanbanMobileCardGestureState): void => {
			const taskId = gesture.cardEl.dataset.operonTaskId;
			const sourceLaneKey = gesture.cardEl.dataset.kanbanLaneKey;
			if (!taskId || !sourceLaneKey) {
				cleanupMobileCardGesture(true);
				return;
			}
			clearMobileGestureTimer(gesture);
			gesture.mode = 'dragging';
			gesture.previousClientX = gesture.latestClientX;
			gesture.previousClientY = gesture.latestClientY;
			suppressNextMobileCardClick(gesture);
			setMobileTouchDragActiveClass();
			this.hideCellQuickAdds(boardEl);
			this.draggedCardContext = {
				taskId,
				sourceStatusId: gesture.cardEl.dataset.kanbanStatusId ?? null,
				sourceLaneKey,
				cardEl: gesture.cardEl,
			};
			gesture.cardEl.addClass('is-dragging');
			gesture.cardEl.addClass('is-mobile-touch-dragging');
			createMobileDragPreview(gesture);
			updateMobileDropTarget(gesture);
			startMobileDragLoop();
		};
		const commitMobileCardDrag = (event: PointerEvent): void => {
			const gesture = mobileGesture;
			const dragged = this.draggedCardContext;
			if (!gesture || gesture.mode !== 'dragging' || !dragged) {
				cleanupMobileCardGesture(true);
				return;
			}
			gesture.latestClientX = event.clientX;
			gesture.latestClientY = event.clientY;
			const targetCell = gesture.activeDropCell ?? resolveMobileDropCell(event.clientX, event.clientY);
			const targetStatusId = targetCell?.dataset.kanbanStatusId ?? null;
			const targetLaneKey = targetCell?.dataset.kanbanLaneKey ?? null;
			const preset = this.resolveCurrentPreset();
			const targetBeforeTaskId = targetCell && preset.sortMode === 'manual'
				? this.resolveManualDropBeforeTaskIdAt(targetCell, event.clientY, preset)
				: null;
			cleanupMobileCardGesture(false);
			if (!targetCell || !targetStatusId || !targetLaneKey) {
				this.draggedCardContext = null;
				dragged.cardEl.removeClass('is-dragging');
				this.clearManualDropIndicators(boardEl);
				return;
			}
			const context: KanbanDropContext = {
				taskId: dragged.taskId,
				sourceStatusId: dragged.sourceStatusId,
				sourceLaneKey: dragged.sourceLaneKey,
				targetStatusId,
				targetLaneKey,
				swimlaneBy: preset.swimlaneBy,
				targetBeforeTaskId,
			};
			this.completeKanbanCardDrop(targetCell, dragged, context, targetBeforeTaskId, preset);
		};
		const onMobileCardPointerMove = (event: PointerEvent): void => {
			const gesture = mobileGesture;
			if (!gesture || event.pointerId !== gesture.pointerId) return;
			const intentDeltaX = Math.abs(event.clientX - gesture.initialClientX);
			const intentDeltaY = Math.abs(event.clientY - gesture.initialClientY);
			const hasHorizontalScrollIntent = intentDeltaX > KANBAN_MOBILE_CARD_HORIZONTAL_SCROLL_INTENT_PX
				&& intentDeltaX >= intentDeltaY;
			const hasGeneralScrollIntent = Math.hypot(intentDeltaX, intentDeltaY) > KANBAN_MOBILE_CARD_SCROLL_INTENT_PX;
			if (gesture.mode === 'pending' && (hasHorizontalScrollIntent || hasGeneralScrollIntent)) {
				clearMobileGestureTimer(gesture);
				gesture.scrollAxis = hasHorizontalScrollIntent ? 'x' : 'y';
				gesture.mode = 'scrolling';
				suppressNextMobileCardClick(gesture);
			}
			if (gesture.mode === 'scrolling') {
				event.preventDefault();
				event.stopPropagation();
				applyMobileCardScroll(gesture, event);
				return;
			}
			gesture.latestClientX = event.clientX;
			gesture.latestClientY = event.clientY;
			if (gesture.mode === 'dragging') {
				event.preventDefault();
				event.stopPropagation();
				updateMobileDragPreview(gesture);
				updateMobileDropTarget(gesture);
			}
		};
		const onMobileCardPointerUp = (event: PointerEvent): void => {
			const gesture = mobileGesture;
			if (!gesture || event.pointerId !== gesture.pointerId) return;
			if (gesture.mode === 'dragging') {
				event.preventDefault();
				event.stopPropagation();
				commitMobileCardDrag(event);
				return;
			}
			if (gesture.mode === 'scrolling') {
				event.preventDefault();
				event.stopPropagation();
				const completedGesture = cleanupMobileCardGesture(true, true);
				if (completedGesture) {
					settleMobileCardHorizontalScroll(completedGesture);
				}
				return;
			}
			cleanupMobileCardGesture(true);
		};
		const onMobileCardPointerCancel = (event: PointerEvent): void => {
			if (!mobileGesture || event.pointerId !== mobileGesture.pointerId) return;
			event.preventDefault();
			cleanupMobileCardGesture(true);
		};
		const onMobileWindowBlur = (): void => {
			cleanupMobileCardGesture(true);
		};
		const handleMobileCardPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0 || !isTouchLikePointer(event) || !isMobileLayoutEligible()) return;
			const target = asHTMLElement(event.target, boardEl);
			const card = resolveGestureCard(target);
			if (!card) return;
			clearMobileCardHorizontalSettle();
			cleanupMobileCardGesture(true);
			boardEl.dataset.kanbanMobileTouchPointerActive = 'true';
			const rect = card.getBoundingClientRect();
			const gesture: KanbanMobileCardGestureState = {
				pointerId: event.pointerId,
				mode: 'pending',
				cardEl: card,
				startCell: card.closest<HTMLElement>('.operon-kanban-cell'),
				ownerWindow,
				timerId: null,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				previousClientX: event.clientX,
				previousClientY: event.clientY,
				latestClientX: event.clientX,
				latestClientY: event.clientY,
				dragOffsetX: event.clientX - rect.left,
				dragOffsetY: event.clientY - rect.top,
				previewEl: null,
				activeDropCell: null,
				clickSuppressed: false,
				wasDraggable: card.draggable,
				horizontalScrollDistance: 0,
				scrollAxis: null,
			};
			card.draggable = false;
			gesture.timerId = ownerWindow.setTimeout(() => {
				if (mobileGesture !== gesture || gesture.mode !== 'pending') return;
				startMobileCardDrag(gesture);
			}, KANBAN_MOBILE_CARD_LONG_PRESS_MS);
			mobileGesture = gesture;
			try {
				card.setPointerCapture?.(event.pointerId);
			} catch {
				// Pointer capture is best-effort in mobile WebViews.
			}
			ownerWindow.addEventListener('pointermove', onMobileCardPointerMove, { capture: true, passive: false });
			ownerWindow.addEventListener('pointerup', onMobileCardPointerUp, true);
			ownerWindow.addEventListener('pointercancel', onMobileCardPointerCancel, true);
			ownerWindow.addEventListener('blur', onMobileWindowBlur, true);
		};
		const scheduleApplyState = (): void => {
			if (applyFrame !== null) return;
			applyFrame = ownerWindow.requestAnimationFrame(applyState);
		};
		const handleEnvironmentChange = (): void => {
			scheduleApplyState();
		};

		gridViewport.addEventListener('scroll', scheduleApplyState, { passive: true });
		gridViewport.addEventListener('dragover', handleMobileDragOver);
		boardEl.addEventListener('pointerdown', handleMobileCardPointerDown);
		mediaQuery.addEventListener('change', handleEnvironmentChange);
		const resizeObserver = new ResizeObserver(handleEnvironmentChange);
		resizeObserver.observe(gridViewport);

		this.kanbanMobileLayoutCleanup = () => {
			cleanupMobileCardGesture(true);
			clearMobileCardHorizontalSettle();
			mobileClickSuppressionCleanup?.();
			mobileClickSuppressionCleanup = null;
			stopVerticalDragAutoScroll();
			gridViewport.removeEventListener('scroll', scheduleApplyState);
			gridViewport.removeEventListener('dragover', handleMobileDragOver);
			boardEl.removeEventListener('pointerdown', handleMobileCardPointerDown);
			mediaQuery.removeEventListener('change', handleEnvironmentChange);
			resizeObserver.disconnect();
			if (applyFrame !== null) {
				ownerWindow.cancelAnimationFrame(applyFrame);
				applyFrame = null;
			}
			root.classList.remove('is-mobile-layout', 'is-mobile-chrome-hidden', 'is-mobile-status-rail', 'is-mobile-status-snap', 'is-mobile-swimlane-overlay');
			boardEl.classList.remove('is-mobile-layout', 'is-mobile-chrome-hidden', 'is-mobile-status-rail', 'is-mobile-status-snap', 'is-mobile-swimlane-overlay', 'is-mobile-card-scroll-active');
			boardEl.style.removeProperty('--operon-kanban-mobile-lane-handle-width');
		};

		applyState();
	}

	private clearKanbanMobileLayout(): void {
		this.kanbanMobileLayoutCleanup?.();
		this.kanbanMobileLayoutCleanup = null;
	}

	private scheduleBoardLayoutRefreshFromCell(cell: HTMLElement): void {
		const boardEl = cell.closest<HTMLElement>('.operon-kanban-board');
		if (!boardEl || this.boardLayoutRefreshFrame !== null) return;
		this.boardLayoutRefreshFrame = window.requestAnimationFrame(() => {
			this.boardLayoutRefreshFrame = null;
			if (!boardEl.isConnected) return;
			const laneLabels = Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-lane-label'));
			const gridRows = Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-row'));
			const laneTitles = Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-lane-title'));
			this.syncRowCellHeights(gridRows);
			if (!boardEl.classList.contains('is-no-swimlanes')) {
				this.syncLaneHeights(laneLabels, gridRows);
				this.scheduleLaneColumnWidthRefresh(boardEl, laneTitles);
			}
		});
	}

	private clearKanbanLazyObservers(): void {
		for (const observer of this.kanbanLazyObservers) {
			observer.disconnect();
		}
		this.kanbanLazyObservers = [];
	}

	private renderEmptyState(container: HTMLElement, text: string): void {
		const empty = container.createDiv('operon-kanban-empty-state');
		empty.setText(text);
	}

	private resolveCollapsedStatusIds(board: KanbanBoardData, state: KanbanLeafState, searchActive: boolean): Set<string> {
		return resolveCollapsedKanbanStatusIds({
			preset: board.preset,
			columns: board.columns,
			manuallyCollapsedStatusIds: state.collapsedStatusIds,
			temporarilyExpandedAutoCollapsedStatusIds: this.getTemporarilyExpandedStatusIds(board.preset),
			searchActive,
		});
	}

	private resolveSkippedStatusMaterializationIds(
		pipeline: Pipeline,
		preset: KanbanPreset,
		state: KanbanLeafState,
	): Set<string> {
		return resolveSkippedKanbanStatusMaterializationIds({
			pipeline,
			preset,
			manuallyCollapsedStatusIds: state.collapsedStatusIds,
			temporarilyExpandedAutoCollapsedStatusIds: this.getTemporarilyExpandedStatusIds(preset),
		});
	}

	private resolveCollapsedLaneKeys(board: KanbanBoardData, state: KanbanLeafState, searchActive: boolean): Set<string> {
		return resolveCollapsedKanbanLaneKeys({
			preset: board.preset,
			columns: board.columns,
			lanes: board.lanes,
			cellCountMap: board.cellCountMap,
			autoCollapsedStatusIds: resolveAutoCollapsedKanbanStatusIds({
				preset: board.preset,
				columns: board.columns,
				temporarilyExpandedAutoCollapsedStatusIds: this.getTemporarilyExpandedStatusIds(board.preset),
			}),
			manuallyCollapsedLaneKeys: state.collapsedLaneKeys,
			temporarilyExpandedAutoCollapsedLaneKeys: this.getTemporarilyExpandedLaneKeys(board.preset),
			searchActive,
		});
	}

	private captureBoardScrollState(container: HTMLElement): void {
		const board = asHTMLElement(container.querySelector('.operon-kanban-grid-viewport'), container);
		if (!board) return;
		this.lastBoardScrollState = {
			left: board.scrollLeft,
			top: board.scrollTop,
		};
	}

	private restoreBoardScrollState(board: HTMLElement): void {
		const { left, top } = this.lastBoardScrollState;
		if (left === 0 && top === 0) return;
		board.scrollLeft = left;
		board.scrollTop = top;
	}

	private bindBoardScrollStateTracking(gridViewport: HTMLElement): void {
		gridViewport.addEventListener('scroll', () => {
			this.lastBoardScrollState = {
				left: gridViewport.scrollLeft,
				top: gridViewport.scrollTop,
			};
		});
	}

	private syncLaneHeights(laneLabels: HTMLElement[], gridRows: HTMLElement[]): void {
		for (let index = 0; index < laneLabels.length; index++) {
			const laneLabel = laneLabels[index];
			const gridRow = gridRows[index];
			if (!laneLabel || !gridRow) continue;
			laneLabel.style.height = `${Math.ceil(gridRow.getBoundingClientRect().height)}px`;
		}
	}

	private syncRowCellHeights(gridRows: HTMLElement[]): void {
		for (const gridRow of gridRows) {
			gridRow.querySelector<HTMLElement>(':scope > .operon-kanban-lane-label')?.style.removeProperty('height');
			const rowHeight = Math.ceil(gridRow.getBoundingClientRect().height);
			if (rowHeight <= 0) continue;
			const cells = Array.from(gridRow.children)
				.map(child => asHTMLElement(child))
				.filter((child): child is HTMLElement => child !== null)
				.filter(child => child.classList.contains('operon-kanban-cell'));
			for (const cell of cells) {
				if (
					cell.classList.contains('is-scroll-limited')
					&& !cell.classList.contains('is-collapsed')
				) {
					cell.style.maxHeight = `${rowHeight}px`;
				}
			}
		}
	}

	private applyCellHeightLimit(cell: HTMLElement, maxVisibleTasks: number, totalTaskCount: number): void {
		cell.classList.remove('is-scroll-limited');
		cell.style.removeProperty('max-height');
		if (!Number.isFinite(maxVisibleTasks) || maxVisibleTasks < 1) return;
		if (totalTaskCount <= maxVisibleTasks) return;

		const topLevelCards = Array.from(cell.children)
			.map(child => asHTMLElement(child))
			.filter((child): child is HTMLElement => child !== null)
			.filter(child => child.classList.contains('operon-kanban-card'));
		if (topLevelCards.length === 0) return;

		const styles = window.getComputedStyle(cell);
		const gap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
		const paddingTop = Number.parseFloat(styles.paddingTop || '0') || 0;
		const paddingBottom = Number.parseFloat(styles.paddingBottom || '0') || 0;
		const borderTop = Number.parseFloat(styles.borderTopWidth || '0') || 0;
		const borderBottom = Number.parseFloat(styles.borderBottomWidth || '0') || 0;

		let maxHeight = paddingTop + paddingBottom + borderTop + borderBottom;
		for (let index = 0; index < maxVisibleTasks; index++) {
			const card = topLevelCards[index];
			if (!card) break;
			maxHeight += card.offsetHeight;
			if (index > 0) {
				maxHeight += gap;
			}
		}

		cell.style.maxHeight = `${Math.ceil(maxHeight)}px`;
		cell.classList.add('is-scroll-limited');
	}

	private ensureState(): KanbanLeafState {
		if (this.state) return this.state;
		const nextState = this.normalizeState(null);
		this.state = nextState;
		return nextState;
	}

	private resolveCurrentPreset(): KanbanPreset {
		const settings = this.getSettings();
		const state = this.ensureState();
		const fallbackPreset = settings.kanbanPresets.find(entry => entry.id === settings.kanbanDefaultPresetId)
			?? settings.kanbanPresets[0];
		return settings.kanbanPresets.find(entry => entry.id === state.presetId)
			?? fallbackPreset;
	}

	private normalizeState(state: Partial<KanbanLeafState> | null | undefined): KanbanLeafState {
		const settings = this.getSettings();
		const availablePresetIds = settings.kanbanPresets.map(entry => entry.id);
		const fallbackPresetId = settings.kanbanDefaultPresetId ?? settings.kanbanPresets[0]?.id ?? null;
		const requestedPresetId = typeof state?.presetId === 'string' && state.presetId.trim()
			? state.presetId
			: fallbackPresetId;
		const preset = settings.kanbanPresets.find(entry => entry.id === requestedPresetId)
			?? settings.kanbanPresets.find(entry => entry.id === fallbackPresetId)
			?? settings.kanbanPresets[0]
			?? null;
		const pipeline = preset?.pipelineId
			? settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
			: null;
		return normalizeKanbanLeafState(state, {
			availablePresetIds,
			availableStatusIds: pipeline?.statuses.map(status => status.id) ?? [],
			defaultPresetId: fallbackPresetId,
			statusCollapseScopeKey: this.getStatusCollapseScopeKey(preset),
			laneCollapseScopeKey: this.getLaneCollapseScopeKey(preset),
		});
	}

	private areLeafStatesEqual(left: KanbanLeafState | null, right: KanbanLeafState | null): boolean {
		if (!left || !right) return left === right;
		return left.presetId === right.presetId
			&& left.searchQuery === right.searchQuery
			&& left.collapsedStatusIds.join('||') === right.collapsedStatusIds.join('||')
			&& left.collapsedLaneKeys.join('||') === right.collapsedLaneKeys.join('||')
			&& JSON.stringify(left.collapsedStatusIdsByPreset) === JSON.stringify(right.collapsedStatusIdsByPreset)
			&& JSON.stringify(left.collapsedLaneKeysByPreset) === JSON.stringify(right.collapsedLaneKeysByPreset)
			&& JSON.stringify(left.collapsedStatusIdsByScope) === JSON.stringify(right.collapsedStatusIdsByScope)
			&& JSON.stringify(left.collapsedLaneKeysByScope) === JSON.stringify(right.collapsedLaneKeysByScope)
			&& left.expandedPreviewParentIds.join('||') === right.expandedPreviewParentIds.join('||');
	}

	private async updateLeafState(nextState: KanbanLeafState): Promise<void> {
		const normalized = this.normalizeState(this.withCurrentPresetCollapseState(nextState));
		const changed = !this.areLeafStatesEqual(this.state, normalized);
		const presetChanged = this.state?.presetId !== normalized.presetId;
		this.state = normalized;
		if (!changed) return;
		if (presetChanged) {
			this.temporarilyExpandedAutoCollapsedStatusTokens.clear();
			this.temporarilyExpandedAutoCollapsedLaneTokens.clear();
			this.clearParentSearchState();
			this.syncLeafTitle();
		}
		this.render();
		this.scheduleLeafStatePersistence();
	}

	private scheduleRender(resetTemporaryExpandedFinishedColumns: boolean): void {
		if (resetTemporaryExpandedFinishedColumns) {
			this.temporarilyExpandedAutoCollapsedStatusTokens.clear();
			this.temporarilyExpandedAutoCollapsedLaneTokens.clear();
		}
		if (this.renderFrame !== null) return;
		this.renderFrame = window.requestAnimationFrame(() => {
			this.renderFrame = null;
			this.render();
		});
	}

	private isStatusAutoCollapsed(board: KanbanBoardData, column: KanbanColumn): boolean {
		return resolveAutoCollapsedKanbanStatusIds({
			preset: board.preset,
			columns: board.columns,
			temporarilyExpandedAutoCollapsedStatusIds: this.getTemporarilyExpandedStatusIds(board.preset),
		}).has(column.statusId);
	}

	private isLaneAutoCollapsed(board: KanbanBoardData, lane: KanbanLane): boolean {
		const autoCollapsedStatusIds = resolveAutoCollapsedKanbanStatusIds({
			preset: board.preset,
			columns: board.columns,
			temporarilyExpandedAutoCollapsedStatusIds: this.getTemporarilyExpandedStatusIds(board.preset),
		});
		return resolveAutoCollapsedKanbanLaneKeys({
			preset: board.preset,
			columns: board.columns,
			lanes: board.lanes,
			cellCountMap: board.cellCountMap,
			autoCollapsedStatusIds,
			temporarilyExpandedAutoCollapsedLaneKeys: this.getTemporarilyExpandedLaneKeys(board.preset),
		}).has(lane.key);
	}

	private buildStatusCollapseToken(preset: KanbanPreset, statusId: string): string {
		return `${this.getStatusCollapseScopeKey(preset) ?? 'none'}::${statusId}`;
	}

	private buildLaneCollapseToken(preset: KanbanPreset, laneKey: string): string {
		return `${this.getLaneCollapseScopeKey(preset) ?? 'none'}::${laneKey}`;
	}

	private getTemporarilyExpandedStatusIds(preset: KanbanPreset): string[] {
		return this.getTemporarilyExpandedScopedIds(
			this.temporarilyExpandedAutoCollapsedStatusTokens,
			this.getStatusCollapseScopeKey(preset),
		);
	}

	private getTemporarilyExpandedLaneKeys(preset: KanbanPreset): string[] {
		return this.getTemporarilyExpandedScopedIds(
			this.temporarilyExpandedAutoCollapsedLaneTokens,
			this.getLaneCollapseScopeKey(preset),
		);
	}

	private getTemporarilyExpandedScopedIds(tokens: Set<string>, scopeKey: string | null): string[] {
		if (!scopeKey) return [];
		const prefix = `${scopeKey}::`;
		return Array.from(tokens)
			.filter(token => token.startsWith(prefix))
			.map(token => token.slice(prefix.length));
	}

	private getStatusCollapseScopeKey(preset: KanbanPreset | null): string | null {
		return buildKanbanStatusCollapseScopeKey(preset?.id ?? null, preset?.pipelineId ?? null);
	}

	private getLaneCollapseScopeKey(preset: KanbanPreset | null): string | null {
		return buildKanbanLaneCollapseScopeKey(preset?.id ?? null, preset?.pipelineId ?? null, preset?.swimlaneBy ?? null);
	}

	private withCurrentPresetCollapseState(
		nextState: Partial<KanbanLeafState>,
	): KanbanLeafState {
		const current = this.state ?? this.normalizeState(null);
		const merged: KanbanLeafState = {
			...current,
			...nextState,
			collapsedStatusIdsByPreset: {
				...current.collapsedStatusIdsByPreset,
				...(nextState.collapsedStatusIdsByPreset ?? {}),
			},
			collapsedLaneKeysByPreset: {
				...current.collapsedLaneKeysByPreset,
				...(nextState.collapsedLaneKeysByPreset ?? {}),
			},
			collapsedStatusIdsByScope: {
				...current.collapsedStatusIdsByScope,
				...(nextState.collapsedStatusIdsByScope ?? {}),
			},
			collapsedLaneKeysByScope: {
				...current.collapsedLaneKeysByScope,
				...(nextState.collapsedLaneKeysByScope ?? {}),
			},
		};
		const preset = this.getSettings().kanbanPresets.find(entry => entry.id === merged.presetId) ?? null;
		const statusScopeKey = this.getStatusCollapseScopeKey(preset);
		const laneScopeKey = this.getLaneCollapseScopeKey(preset);
		if (statusScopeKey) {
			merged.collapsedStatusIdsByScope[statusScopeKey] = Array.from(new Set(merged.collapsedStatusIds));
		}
		if (laneScopeKey) {
			merged.collapsedLaneKeysByScope[laneScopeKey] = Array.from(new Set(merged.collapsedLaneKeys));
		}
		return merged;
	}

	private buildStateForPresetSwitch(targetPresetId: string): KanbanLeafState {
		const persisted = this.withCurrentPresetCollapseState({});
		return this.normalizeState({
			...persisted,
			presetId: targetPresetId,
			collapsedStatusIds: [],
			collapsedLaneKeys: [],
		});
	}

	private getActiveSearchQuery(rawQuery: string, parentSearchUi: KanbanParentSearchUiState | null): string {
		if (parentSearchUi && !parentSearchUi.selectedParentId) return '';
		return resolveTaskSearchBoxTextQuery(rawQuery, KANBAN_SEARCH_MIN_QUERY_LENGTH);
	}

	private buildParentSearchUiState(
		rawQuery: string,
		pipeline: Pipeline,
		filterSet: FilterSet | null,
		settings: OperonSettings,
		scope: TaskSearchBoxScopeState,
	): KanbanParentSearchUiState | null {
		const mode = scope.projectMode;
		if (!mode) return null;
		const scopedTasks = this.getCurrentSearchScopeTasks(filterSet, pipeline, settings, scope);
		const trimmedQuery = rawQuery.trim();
		const queryMeetsThreshold = !trimmedQuery || trimmedQuery.length >= KANBAN_SEARCH_MIN_QUERY_LENGTH;
		const normalizedQuery = queryMeetsThreshold ? trimmedQuery.toLocaleLowerCase() : '';
		const candidates = queryMeetsThreshold
			? this.buildParentSearchCandidates(scopedTasks, normalizedQuery)
			: [];
		const selectedParentId = this.parentSearchSelection?.mode === mode
			&& scopedTasks.some(task => task.operonId === this.parentSearchSelection?.parentId)
			? this.parentSearchSelection.parentId
			: null;
		if (!selectedParentId) {
			this.parentSearchSelection = null;
		}
		this.parentSearchHighlightedIndex = Math.min(
			Math.max(this.parentSearchHighlightedIndex, 0),
			Math.max(0, candidates.length - 1),
		);
		return {
			mode,
			query: normalizedQuery,
			candidates,
			selectedParentId,
			dropdownVisible: !this.parentSearchDismissed && !selectedParentId,
		};
	}

	private getCurrentScopeTasks(
		filterSet: FilterSet | null,
		pipeline: Pipeline,
		settings: OperonSettings,
	): IndexedTask[] {
		return filterTasksForCalendar(
			filterSet,
			this.indexer.getAllTasks(),
			settings.priorities,
			this.getPinnedCache(),
			).filter(task => isTaskInPipeline(task, pipeline));
	}

	private getCurrentSearchScopeTasks(
		filterSet: FilterSet | null,
		pipeline: Pipeline,
		settings: OperonSettings,
		scope: TaskSearchBoxScopeState,
	): IndexedTask[] {
		return this.getCurrentScopeTasks(filterSet, pipeline, settings)
			.filter(task => matchesTaskSearchBoxScope(task, scope));
	}

	private resolveKanbanSearchTaskIdFilter(
		scope: TaskSearchBoxScopeState,
		filterSet: FilterSet | null,
		pipeline: Pipeline,
		settings: OperonSettings,
		parentSearchUi: KanbanParentSearchUiState | null,
	): Set<string> | undefined {
		if (!this.hasKanbanSearchScopeFilters(scope) && !parentSearchUi?.selectedParentId) {
			return undefined;
		}
		const scopedTasks = this.getCurrentSearchScopeTasks(filterSet, pipeline, settings, scope);
		if (parentSearchUi?.selectedParentId) {
			return this.resolveParentSearchVisibleTaskIds(parentSearchUi.selectedParentId, parentSearchUi.mode, scopedTasks);
		}
		return new Set(scopedTasks.map(task => task.operonId));
	}

	private hasKanbanSearchScopeFilters(scope: TaskSearchBoxScopeState): boolean {
		return scope.showOverdue
			|| scope.showHappensToday
			|| !scope.includeInline
			|| !scope.includeFile
			|| !scope.includeCancelled
			|| !scope.includeFinished;
	}

	private resetKanbanSearchScope(): void {
		this.searchScope = cloneTaskSearchBoxScopeState(KANBAN_SEARCH_BOX_DEFAULT_SCOPE);
		this.clearParentSearchState();
	}

	private isKanbanSearchScopeKeyActive(key: TaskFinderDefaultScopeKey): boolean {
		switch (key) {
			case 'projectTasks':
				return this.searchScope.projectMode === 'pc';
			case 'projectTree':
				return this.searchScope.projectMode === 'pt';
			case 'overdue':
				return this.searchScope.showOverdue;
			case 'happensToday':
				return this.searchScope.showHappensToday;
			case 'recentModified':
				return false;
			case 'includeInline':
				return this.searchScope.includeInline;
			case 'includeFile':
				return this.searchScope.includeFile;
			case 'includeCancelled':
				return this.searchScope.includeCancelled;
			case 'includeFinished':
				return this.searchScope.includeFinished;
		}
	}

	private getSearchScopeButtonLabel(key: TaskFinderDefaultScopeKey): string {
		switch (key) {
			case 'projectTasks':
				return t('modals', 'taskFinderProjectTasks');
			case 'projectTree':
				return t('modals', 'taskFinderProjectTree');
			case 'overdue':
				return t('modals', 'taskFinderOverdue');
			case 'happensToday':
				return t('modals', 'taskFinderHappensToday');
			case 'recentModified':
				return t('modals', 'taskFinderRecentModified');
			case 'includeInline':
				return t('modals', 'taskFinderIncludeInline');
			case 'includeFile':
				return t('modals', 'taskFinderIncludeFile');
			case 'includeCancelled':
				return t('modals', 'taskFinderIncludeCancelled');
			case 'includeFinished':
				return t('modals', 'taskFinderIncludeFinished');
		}
	}

	private buildParentSearchCandidates(
		scopedTasks: IndexedTask[],
		normalizedQuery: string,
	): KanbanParentSearchCandidate[] {
		return buildProjectSearchCandidates(scopedTasks, normalizedQuery, {
			getChildIds: parentId => this.indexer.secondary.getChildIds(parentId),
			getAllDescendantIds: parentId => this.indexer.secondary.getAllDescendantIds(parentId),
		}, { keyMappings: this.getSettings().keyMappings });
	}

	private resolveParentSearchVisibleTaskIds(
		selectedParentId: string,
		mode: KanbanParentSearchMode,
		scopedTasks: IndexedTask[],
	): Set<string> {
		return resolveProjectSearchVisibleTaskIds(
			selectedParentId,
			mode,
			scopedTasks,
			{
				getChildIds: parentId => this.indexer.secondary.getChildIds(parentId),
				getAllDescendantIds: parentId => this.indexer.secondary.getAllDescendantIds(parentId),
			},
		);
	}

	private selectParentSearchCandidate(mode: KanbanParentSearchMode, candidate: KanbanParentSearchCandidate): void {
		this.parentSearchSelection = {
			mode,
			parentId: candidate.task.operonId,
			parentName: candidate.task.description,
		};
		this.parentSearchDismissed = true;
		this.parentSearchHighlightedIndex = 0;
		this.state = this.normalizeState({
			...this.ensureState(),
			searchQuery: '',
		});
		this.markDirty();
		this.focusKanbanSearchInput();
	}

	private updateParentSearchHighlight(nextIndex: number): void {
		const rows = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.operon-kanban-parent-search-item'));
		if (rows.length === 0) {
			this.parentSearchHighlightedIndex = nextIndex;
			return;
		}
		const clampedIndex = Math.max(0, Math.min(nextIndex, rows.length - 1));
		if (clampedIndex === this.parentSearchHighlightedIndex) return;
		const previousRow = rows[this.parentSearchHighlightedIndex];
		const nextRow = rows[clampedIndex];
		this.parentSearchHighlightedIndex = clampedIndex;
		previousRow?.removeClass('is-active');
		nextRow?.addClass('is-active');
		nextRow?.scrollIntoView({ block: 'nearest' });
	}

	private clearParentSearchState(): void {
		this.searchScope = {
			...this.searchScope,
			projectMode: null,
		};
		this.parentSearchSelection = null;
		this.parentSearchHighlightedIndex = 0;
		this.parentSearchDismissed = false;
	}

	private captureSearchFocusState(container: HTMLElement): void {
		const searchInput = container.querySelector<HTMLInputElement>('.operon-kanban-toolbar-search');
		if (!searchInput || getOwnerDocument(container).activeElement !== searchInput) {
			this.pendingSearchFocusState = null;
			return;
		}
		this.pendingSearchFocusState = {
			selectionStart: searchInput.selectionStart,
			selectionEnd: searchInput.selectionEnd,
		};
	}

	private restoreSearchFocus(root: HTMLElement): void {
		const focusState = this.pendingSearchFocusState;
		this.pendingSearchFocusState = null;
		if (!focusState) return;
		const searchInput = root.querySelector<HTMLInputElement>('.operon-kanban-toolbar-search');
		if (!searchInput) return;
		searchInput.focus({ preventScroll: true });
		if (focusState.selectionStart !== null || focusState.selectionEnd !== null) {
			searchInput.setSelectionRange(
				focusState.selectionStart ?? searchInput.value.length,
				focusState.selectionEnd ?? focusState.selectionStart ?? searchInput.value.length,
			);
		}
	}

	private focusKanbanSearchInput(): void {
		window.requestAnimationFrame(() => {
			const searchInput = this.contentEl.querySelector<HTMLInputElement>('.operon-kanban-toolbar-search');
			searchInput?.focus({ preventScroll: true });
		});
	}

	private scheduleLeafStatePersistence(): void {
		this.clearPersistStateTimer();
		this.persistStateTimer = window.setTimeout(() => {
			this.persistStateTimer = null;
			void this.app.workspace.requestSaveLayout();
		}, 80);
	}

	private clearPersistStateTimer(): void {
		if (!this.persistStateTimer) return;
		window.clearTimeout(this.persistStateTimer);
		this.persistStateTimer = null;
	}

	private clearRender(): void {
		if (this.renderFrame === null) return;
		window.cancelAnimationFrame(this.renderFrame);
		this.renderFrame = null;
	}

	private applyKanbanPresetTheme(root: HTMLElement, preset: KanbanPreset): void {
		root.removeClass('is-background-themed');
		root.removeClass('is-background-tinted');
		root.removeClass('is-background-custom');
		root.removeClass('is-appearance-light');
		root.removeClass('is-appearance-dark');
		root.style.removeProperty('color-scheme');
		root.style.removeProperty('--operon-kanban-background-color');
		root.style.removeProperty('--operon-kanban-background-strong');
		root.style.removeProperty('--operon-kanban-background-soft');
		root.style.removeProperty('--background-primary');
		root.style.removeProperty('--background-secondary');
		root.style.removeProperty('--background-modifier-border');
		root.style.removeProperty('--background-modifier-hover');
		root.style.removeProperty('--text-normal');
		root.style.removeProperty('--text-muted');
		root.style.removeProperty('--interactive-normal');

		const obsidianDark = getOwnerBody(root).classList.contains('theme-dark');
		const activeAppearanceMode = obsidianDark ? preset.appearanceModeDark : preset.appearanceModeLight;
		if (activeAppearanceMode !== 'theme') {
			const light = isLightScheme(activeAppearanceMode);
			root.addClass(light ? 'is-appearance-light' : 'is-appearance-dark');
			root.style.setProperty('color-scheme', light ? 'light' : 'dark');
			const palette = getSchemePalette(activeAppearanceMode);
			root.style.setProperty('--background-primary', palette.backgroundPrimary);
			root.style.setProperty('--background-secondary', palette.backgroundSecondary);
			root.style.setProperty('--background-modifier-border', palette.borderColor);
			root.style.setProperty('--background-modifier-hover', palette.hoverColor);
			root.style.setProperty('--text-normal', palette.textNormal);
			root.style.setProperty('--text-muted', palette.textMuted);
			root.style.setProperty('--interactive-normal', palette.interactiveNormal);
		}

	}

}
