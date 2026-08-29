import { ItemView, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import { getSchemePalette, isLightScheme } from '../appearance-schemes';
import { OperonIndexer } from '../../indexer/indexer';
import { PinnedCache } from '../../storage/pinned-cache';
import { IndexedTask } from '../../types/fields';
import {
	areKanbanLeafStatesEqual,
	KanbanCellActionContext,
	KanbanDropContext,
	KanbanLeafState,
	KanbanPreset,
	KanbanViewCallbacks,
	KANBAN_COLLAPSED_COLUMN_WIDTH_PX,
	buildKanbanLaneCollapseScopeKey,
	buildKanbanStatusCollapseScopeKey,
	hasManualKanbanSorting,
	normalizeKanbanLeafState,
	resolveKanbanEffectiveSorting,
} from '../../types/kanban';
import {
	resolveContextualMenu,
	type ContextualMenuActionId,
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
	TaskFinderDefaultScopeKey,
} from '../../types/settings';
import { getCurrentLang, t } from '../../core/i18n';
import { isSpecialDynamicFilterSet } from '../../core/dynamic-file-task-filter';
import {
	normalizeTaskFieldColor,
	resolveTaskColorSourceForTask,
	resolveTaskStatusIconColorForTask,
} from '../../core/task-color-source';
import { getConfiguredKeyMappingIcon } from '../../core/key-mapping-icons';
import { filterTasksForCalendar, stripFilterViewOnlyOptions } from '../../systems/calendar-filter-materialization';
import {
	buildKanbanTaskComparator,
	buildKanbanCellKey,
	isTaskInPipelineWithIndex,
	KanbanBoardData,
	KanbanColumn,
	KanbanLane,
	KANBAN_NO_VALUE_KEY,
	queryKanbanBoard,
} from '../../systems/kanban-query';
import {
	KanbanDragInteractionGate,
	KanbanDropPersistenceGate,
	classifyKanbanDropCallbackSettlement,
	moveKanbanKeyboardInsertionIndex,
	shouldSuppressKanbanGestureClick,
} from '../../systems/kanban-drag-interaction';
import {
	buildKanbanDropBoardSignature,
	buildKanbanDropFailureDiagnostic,
	collectKanbanInPlaceChangedCellKeys,
	KanbanCardOperationRegistry,
} from '../../systems/kanban-drop-transaction';
import {
	buildWorkflowStatusIdentityIndex,
	type WorkflowStatusIdentityIndex,
} from '../../core/workflow-status-identity';
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
	KANBAN_OPTIMISTIC_MOVE_TTL_MS,
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
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { renderRelatedViewsLauncher } from '../related-views';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { bindTaskTitleLinkPreview } from '../compact-chip-link-preview';
import { renderCompactTaskMarkdown } from '../compact-task-markdown-renderer';
import { isTaskSourceOpenModifierClick } from '../task-source-open-modifier';
import { showTaskNotePopover } from '../task-note-action';
import {
	buildKanbanTaskChipRow,
	getKanbanTaskChipLocationSignature,
} from './kanban-task-chips';
import {
	createCompactTaskLookup,
	type CompactTaskLookupContext,
} from '../compact-task-layout';
import {
	buildTaskProgressTracks,
	renderTaskProgressHorizontalTrack,
	resolveTaskProgressDescendantSummary,
	type TaskProgressDescendantSummary,
	type TaskProgressTrack,
} from '../task-progress-tracks';
import { getKanbanPresetPickerLabel, showKanbanPresetPicker } from './kanban-preset-picker';
import { getFavoriteKanbanPresets, resolveKanbanPresetPickerButtonState } from './kanban-preset-visibility';
import {
	buildPresetFilterUsageTooltip,
	createUniquePresetFilterName,
	showPresetFilterPopover,
} from '../preset-filter-popover';
import {
	applyTaskSearchBoxShortcutCommand,
	cloneTaskSearchBoxScopeState,
	getTaskSearchBoxRecentModifiedCutoff,
	isDefaultKanbanSearchBoxScope,
	KANBAN_SEARCH_BOX_DEFAULT_SCOPE,
	matchesTaskSearchBoxScope,
	resolveTaskSearchBoxTextQuery,
	TaskSearchBoxScopeState,
	toggleTaskSearchBoxScope,
} from '../task-search-box-integration';
import { getTableFilePropertyIndex } from '../table/table-file-property';
import { resolveKanbanCardImageReference } from '../../core/kanban-card-image-source';
import {
	SEARCH_SCOPE_CONTROL_GROUPS,
	hasTaskSearchScopeFilters,
	renderParentSearchDropdown,
	renderSearchScopePopover,
	syncSearchScopeControlWrapClasses,
	updateSearchParentHighlight,
	type SearchParentSelection,
	type SearchParentUiState,
	type SearchScopeControlClassNames,
} from '../search-scope-controls';
import { enginePerfLog, enginePerfNow } from '../../core/engine-perf';
import {
	buildKanbanTaskStableSignature,
	buildKanbanTaskVolatileSignature,
	KanbanTaskSignatureIndex,
	KANBAN_TRACKER_FIELD_KEYS,
} from '../../systems/kanban-render-signature';
import {
	estimateKanbanCellPlaceholderHeightPx,
	KanbanCellScrollAnchor,
	KanbanViewportContentAnchor,
	matchesKanbanProgrammaticScrollState,
	resolveKanbanCellAnchorScrollTop,
	resolveKanbanCellInitialRenderLimit,
	resolveKanbanCellScrollRestore,
	resolveKanbanDropLaneAnchorScroll,
	resolveKanbanViewportScrollCompensation,
	resolveKanbanViewportAnchorScroll,
	shouldReleaseKanbanViewportScrollCompensation,
	shouldMaterializeKanbanCell,
} from '../../systems/kanban-cell-materialization';

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
const KANBAN_CELL_SCROLL_RESTORE_TTL_MS = 2000;
const KANBAN_CELL_SCROLL_ANCHOR_MAX_CARDS = 4;
const KANBAN_VIEWPORT_ANCHOR_MAX_ITEMS = 3;
const KANBAN_VIEWPORT_ANCHOR_MIN_SETTLE_MS = 140;
const KANBAN_PROGRAMMATIC_SCROLL_EVENT_WINDOW_MS = 120;
const KANBAN_VIEWPORT_ANCHOR_STABLE_PASSES = 2;
const KANBAN_VIEWPORT_ANCHOR_TTL_MS = 2000;
const KANBAN_SEARCH_BOX_DISABLED_KEYS = new Set<TaskFinderDefaultScopeKey>();
const KANBAN_LANE_COLUMN_MIN_WIDTH_PX = 96;
const KANBAN_SEARCH_REFRESH_DEBOUNCE_MS = 150;
const KANBAN_CELL_MATERIALIZE_MARGIN_PX = 320;
const KANBAN_ESTIMATED_CARD_HEIGHT_PX = 72;
const KANBAN_ESTIMATED_CARD_GAP_PX = 8;
const KANBAN_LANE_COLUMN_MAX_WIDTH_PX = 192;
const KANBAN_SEARCH_SCOPE_GROUPS = SEARCH_SCOPE_CONTROL_GROUPS;
const KANBAN_SEARCH_SCOPE_CONTROL_CLASSES: SearchScopeControlClassNames = {
	popover: 'operon-kanban-search-scope-popover',
	tools: 'operon-kanban-search-scope-tools',
	group: 'operon-kanban-search-scope-group',
	button: 'operon-kanban-search-scope-button',
	selectedParent: 'operon-kanban-search-selected-parent',
	selectedParentLabel: 'operon-kanban-search-selected-parent-label',
	selectedParentClear: 'operon-kanban-search-selected-parent-clear',
	dropdown: 'operon-kanban-parent-search-dropdown',
	empty: 'operon-kanban-parent-search-empty',
	item: 'operon-kanban-parent-search-item',
	itemName: 'operon-kanban-parent-search-item-name',
	itemMeta: 'operon-kanban-parent-search-item-meta',
};

const isKanbanMobilePlatform = (): boolean => Platform.isMobile
	|| Platform.isMobileApp
	|| Platform.isPhone
	|| Platform.isTablet;

function clampKanbanLaneColumnWidth(widthPx: number): number {
	return Math.min(KANBAN_LANE_COLUMN_MAX_WIDTH_PX, Math.max(KANBAN_LANE_COLUMN_MIN_WIDTH_PX, widthPx));
}

function formatKanbanSwimlaneDisplayLabel(rawLabel: string): string {
	const trimmed = rawLabel.trim();
	const match = /^!?\[\[([^\]]+)\]\]$/u.exec(trimmed);
	if (!match) return rawLabel;
	const body = match[1]?.trim() ?? '';
	if (!body) return rawLabel;
	const pipeIndex = body.indexOf('|');
	if (pipeIndex >= 0) {
		const alias = body.slice(pipeIndex + 1).trim();
		if (alias) return alias;
	}
	const linkTarget = (pipeIndex >= 0 ? body.slice(0, pipeIndex) : body).trim();
	if (!linkTarget) return rawLabel;
	return formatKanbanWikiLinkTargetLabel(linkTarget) || rawLabel;
}

function renderKanbanSwimlaneTitle(title: HTMLElement, label: string): void {
	const ownerDocument = getOwnerDocument(title);
	let segmentStart = 0;
	for (let index = 0; index < label.length; index++) {
		if (label[index] !== '/') continue;
		title.appendChild(ownerDocument.createTextNode(label.slice(segmentStart, index + 1)));
		title.appendChild(ownerDocument.win.createEl('wbr'));
		segmentStart = index + 1;
	}
	if (segmentStart < label.length) {
		title.appendChild(ownerDocument.createTextNode(label.slice(segmentStart)));
	}
}

function formatKanbanWikiLinkTargetLabel(linkTarget: string): string {
	const lastSegment = linkTarget.split('/').pop()?.trim() ?? linkTarget.trim();
	return lastSegment.replace(/\.md(?=($|[#^]))/i, '');
}

const closestInteractiveKanbanChipRow = (target: HTMLElement): HTMLElement | null => {
	const chipRow = target.closest<HTMLElement>('.operon-kanban-card-chip-row');
	if (!chipRow || chipRow.classList.contains('is-read-only')) return null;
	if (chipRow.closest('.operon-kanban-board.is-mobile-layout')) return null;
	return chipRow;
};

const closestKanbanNotePreview = (target: HTMLElement): HTMLElement | null => (
	target.closest<HTMLElement>('.operon-kanban-card-note-preview')
);

const KANBAN_CARD_INTERACTIVE_SELECTOR = [
	'a',
	'button',
	'input',
	'textarea',
	'select',
	'[contenteditable]:not([contenteditable="false"])',
	'.operon-calendar-hover-menu',
	'.operon-kanban-card-chip-row',
	'.operon-kanban-card-note-preview',
	'.operon-kanban-descendant-toggle',
].join(', ');

const isKanbanCardInteractionTarget = (target: HTMLElement): boolean => Boolean(
	target.closest(KANBAN_CARD_INTERACTIVE_SELECTOR)
);

function isKanbanButtonElement(element: HTMLElement): element is HTMLButtonElement {
	const elementWithInstanceOf = element as HTMLElement & {
		instanceOf?: (constructor: typeof HTMLButtonElement) => boolean;
	};
	if (typeof elementWithInstanceOf.instanceOf === 'function') {
		return elementWithInstanceOf.instanceOf(HTMLButtonElement);
	}
	return element.tagName === 'BUTTON';
}

function bindKanbanNotePreviewDragShield(preview: HTMLElement): void {
	let restoreCard: HTMLElement | null = null;
	let restoreDraggable = false;

	const release = (): void => {
		if (restoreCard) {
			restoreCard.draggable = restoreDraggable;
			restoreCard = null;
		}
		const ownerWindow = getOwnerWindow(preview);
		ownerWindow.removeEventListener('pointerup', release, true);
		ownerWindow.removeEventListener('pointercancel', release, true);
		ownerWindow.removeEventListener('mouseup', release, true);
		ownerWindow.removeEventListener('dragend', release, true);
		ownerWindow.removeEventListener('blur', release, true);
	};

	const arm = (event: PointerEvent | MouseEvent): void => {
		if (event.button !== 0 || restoreCard) return;
		const card = preview.closest<HTMLElement>('.operon-kanban-card');
		if (!card || !card.draggable) return;
		restoreCard = card;
		restoreDraggable = card.draggable;
		card.draggable = false;
		const ownerWindow = getOwnerWindow(preview);
		ownerWindow.addEventListener('pointerup', release, true);
		ownerWindow.addEventListener('pointercancel', release, true);
		ownerWindow.addEventListener('mouseup', release, true);
		ownerWindow.addEventListener('dragend', release, true);
		ownerWindow.addEventListener('blur', release, true);
	};

	preview.addEventListener('pointerdown', arm, { capture: true });
	preview.addEventListener('mousedown', arm, { capture: true });
	preview.addEventListener('dragstart', event => {
		event.preventDefault();
		event.stopPropagation();
		release();
	}, { capture: true });
}

const isKanbanPhoneToolbarLayoutEligible = (settings: OperonSettings, toolbarWidth: number): boolean => (
	settings.kanbanMobileLayoutChromeEnabled === true
	&& toolbarWidth <= KANBAN_PHONE_TOOLBAR_MAX_WIDTH_PX
	&& (Platform.isPhone || Platform.isMobileApp)
);

interface KanbanScrollState {
	left: number;
	top: number;
}

interface KanbanViewportAnchor {
	state: KanbanScrollState;
	scope: string;
	laneAnchors: KanbanViewportContentAnchor[];
	columnAnchors: KanbanViewportContentAnchor[];
	expiresAt: number;
	settleAfter: number;
	stablePasses: number;
	lastAppliedState: KanbanScrollState | null;
	drop: {
		targetLaneAnchor: KanbanViewportContentAnchor;
		outcome: 'succeeded' | 'failed' | 'cancelled' | null;
	} | null;
}

interface KanbanMarkDirtyOptions {
	preserveViewport?: boolean;
}

interface KanbanBoardQueryResult {
	board: KanbanBoardData;
	searchActive: boolean;
}

interface KanbanSearchFocusState {
	selectionStart: number | null;
	selectionEnd: number | null;
}

type KanbanParentSearchMode = ProjectSearchMode;

type KanbanParentSearchSelection = SearchParentSelection;

type KanbanParentSearchCandidate = ProjectSearchCandidate;

type KanbanParentSearchUiState = SearchParentUiState;

interface DraggedKanbanCardContext extends Pick<KanbanDropContext, 'taskId' | 'sourceStatusId' | 'sourceStatusValue' | 'sourceLaneKey' | 'boardSignature'> {
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

interface KanbanDescendantSummary extends TaskProgressDescendantSummary {
	generation: number;
}

interface WorkspaceLeafTitleSyncOptions {
	setTabHeaderLabel?: boolean;
}

type WorkspaceLeafWithPrivateHeader = WorkspaceLeaf & {
	tabHeaderEl?: HTMLElement;
	tabHeaderInnerTitleEl?: HTMLElement;
};

function syncWorkspaceLeafTitle(leaf: WorkspaceLeaf, title: string, options: WorkspaceLeafTitleSyncOptions = {}): void {
	const leafWithHeader = leaf as WorkspaceLeafWithPrivateHeader;
	leafWithHeader.tabHeaderInnerTitleEl?.setText(title);
	if (options.setTabHeaderLabel && leafWithHeader.tabHeaderEl) {
		setAccessibleLabelWithoutTooltip(leafWithHeader.tabHeaderEl, title);
	}
}

interface KanbanCellRenderFinalizer {
	measure: () => void;
	commit: () => void;
}

interface KanbanDeferredCellEntry {
	cell: HTMLElement;
	materialize: () => KanbanCellRenderFinalizer;
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
	private activePresetPickerClose: (() => void) | null = null;
	private activeFilterPopoverClose: (() => void) | null = null;
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
	private readonly dragInteractionGate = new KanbanDragInteractionGate();
	private readonly mobileDropPersistenceGate = new KanbanDropPersistenceGate();
	private readonly cardOperations = new KanbanCardOperationRegistry();
	private manualDropIndicatorFrame: { win: Window; id: number } | null = null;
	private pendingManualDropIndicatorUpdate: { cell: HTMLElement; pointerY: number; preset: KanbanPreset } | null = null;
	private kanbanSearchRefreshTimer: { win: Window; id: number } | null = null;
	private optimisticMoveExpiryTimer: { win: Window; id: number } | null = null;
	private optimisticMoves = new Map<string, KanbanOptimisticMove>();
	private lastBoardScrollState: KanbanScrollState = { left: 0, top: 0 };
	private pendingViewportAnchor: KanbanViewportAnchor | null = null;
	private boardBottomScrollCompensationPx = 0;
	private boardBottomScrollCompensationScope: string | null = null;
	private preserveViewportOnNextRender = false;
	private boardViewportRestoreFrame: { win: Window; id: number } | null = null;
	private pendingProgrammaticBoardScroll: { state: KanbanScrollState; expiresAt: number } | null = null;
	private boardCompensationReleaseFrame: { win: Window; id: number } | null = null;
	private pendingCellScrollRestores = new Map<string, { top: number; anchors: KanbanCellScrollAnchor[]; expiresAt: number }>();
	private cellScrollRestoreScope: string | null = null;
	private pendingSearchFocusState: KanbanSearchFocusState | null = null;
	private temporarilyExpandedAutoCollapsedStatusTokens = new Set<string>();
	private temporarilyExpandedAutoCollapsedLaneTokens = new Set<string>();
	private searchScope: TaskSearchBoxScopeState = cloneTaskSearchBoxScopeState(KANBAN_SEARCH_BOX_DEFAULT_SCOPE);
	private parentSearchSelection: KanbanParentSearchSelection | null = null;
	private parentSearchHighlightedIndex = 0;
	private parentSearchDismissed = false;
	private descendantSummaryCache = new Map<string, KanbanDescendantSummary>();
	private lastDescendantSummaryCacheGeneration: number | null = null;
	private lastRenderSignature: string | null = null;
	private lastRenderedBoard: KanbanBoardData | null = null;
	private lastRenderedBoardScope: string | null = null;
	private lastRenderedBoardTaskSignatures: Map<string, string> | null = null;
	private readonly taskSignatureIndex = new KanbanTaskSignatureIndex();
	private pendingCellMaterializers = new Map<HTMLElement, () => KanbanCellRenderFinalizer>();
	private cellLazySentinelObservers = new WeakMap<HTMLElement, IntersectionObserver>();
	private readonly cellQuickAddCleanups = new WeakMap<HTMLElement, () => void>();
	private activeTaskNotePopoverClose: (() => void) | null = null;
	private activeTaskNotePopoverTaskId: string | null = null;
	private taskNoteShouldReturnFocus = true;
	private pendingTaskNoteOpen: {
		anchor: DOMRect;
		task: IndexedTask;
		openerSelector: string;
	} | null = null;
	private taskNoteScrollSuppressionFrame: { win: Window; id: number } | null = null;

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
		syncWorkspaceLeafTitle(this.leaf, title, { setTabHeaderLabel: true });
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
		const rawState = !this.containerEl.isConnected
			? { ...(state ?? {}), searchQuery: '' }
			: state;
		const nextState = this.normalizeState(
			rawState,
		);
		const prunedCollapseScopes = this.didPruneCollapseScopeState(rawState, nextState);
		const changed = !this.areLeafStatesEqual(this.state, nextState);
		const presetChanged = this.state?.presetId !== nextState.presetId;
		if (presetChanged) this.invalidateDropUiGeneration();
		if (changed) this.resetBoardViewportRetention();
		this.state = nextState;
		this.syncLeafTitle();
		if (changed && this.containerEl.isConnected) {
			this.markDirty();
		}
		if (prunedCollapseScopes) {
			this.scheduleLeafStatePersistence();
		}
	}

	async onOpen(): Promise<void> {
		this.temporarilyExpandedAutoCollapsedStatusTokens.clear();
		this.temporarilyExpandedAutoCollapsedLaneTokens.clear();
		this.resetKanbanSearchScope();
		this.resetBoardViewportRetention();
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
		const interactionWasActive = this.dragInteractionGate.isActive()
			|| this.mobileDropPersistenceGate.isActive();
		this.dragInteractionGate.reset();
		this.mobileDropPersistenceGate.reset();
		this.cardOperations.reset();
		this.optimisticMoves.clear();
		if (interactionWasActive) this.callbacks.onDragInteractionEnd?.();
		this.pendingTaskNoteOpen = null;
		this.requestActiveTaskNotePopoverClose(false);
		this.temporarilyExpandedAutoCollapsedStatusTokens.clear();
		this.temporarilyExpandedAutoCollapsedLaneTokens.clear();
		this.resetKanbanSearchScope();
		this.lastRenderSignature = null;
		this.closeActivePresetPicker();
		this.closeActiveFilterPopover();
		if (this.persistStateTimer !== null) {
			this.clearPersistStateTimer();
			this.app.workspace.requestSaveLayout();
		}
		this.clearRender();
		cleanupOperonHoverTooltips(this.contentEl);
		this.clearLaneColumnWidthFrame();
		this.clearBoardLayoutRefresh();
		this.clearToolbarLayout();
		this.clearKanbanSearchScopePopoverPositioning();
		this.clearKanbanMobileLayout();
		this.clearKanbanLazyObservers();
		this.cancelPendingManualDropIndicatorUpdate();
		this.clearKanbanSearchRefreshTimer();
		this.clearOptimisticMoveExpiryTimer();
		if (this.taskNoteScrollSuppressionFrame) {
			this.taskNoteScrollSuppressionFrame.win.cancelAnimationFrame(this.taskNoteScrollSuppressionFrame.id);
			this.taskNoteScrollSuppressionFrame = null;
		}
		this.resetBoardViewportRetention();
		this.hideHoverMenu(true);
	}

	markDirty(options: KanbanMarkDirtyOptions = {}): void {
		if (options.preserveViewport) {
			if (
				this.pendingViewportAnchor
				&& (
					this.pendingViewportAnchor.expiresAt < Date.now()
					|| this.pendingViewportAnchor.scope !== this.buildDropScrollAnchorScope()
				)
			) this.clearViewportAnchor();
			const board = this.contentEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
			if (board && !this.pendingViewportAnchor) {
				this.captureBoardViewportAnchor(board);
			} else if (!board) {
				this.preserveViewportOnNextRender = true;
			}
		}
		this.scheduleRender(false);
	}

	hasActiveKanbanDragInteraction(): boolean {
		return this.dragInteractionGate.isActive()
			|| this.mobileDropPersistenceGate.isActive();
	}

	private beginKanbanDragInteraction(): void {
		this.dragInteractionGate.begin();
	}

	private endKanbanDragInteraction(): void {
		if (!this.dragInteractionGate.isActive()) return;
		const renderPending = this.dragInteractionGate.end();
		this.callbacks.onDragInteractionEnd?.();
		if (renderPending) this.scheduleRender(false);
	}

	private render(): void {
		if (this.dragInteractionGate.deferRenderIfActive()) return;
		const preserveViewport = this.preserveViewportOnNextRender;
		const container = this.contentEl;
		const state = this.ensureState();
		const settings = this.getSettings();
		const preset = settings.kanbanPresets.find(entry => entry.id === state.presetId) ?? settings.kanbanPresets[0] ?? null;
		const pipeline = preset?.pipelineId
			? settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null
			: null;
		const currentFilter = preset ? this.resolveEditableKanbanFilter(preset, settings) : null;
		const filterSet = currentFilter ? stripFilterViewOnlyOptions(currentFilter) : null;
		const parentSearchUi = pipeline && preset
			? this.buildParentSearchUiState(state.searchQuery, pipeline, filterSet, settings, this.searchScope)
			: null;
		const nextSignature = this.buildRenderSignature(container, state, preset, pipeline, filterSet, settings, parentSearchUi);
		if (this.lastRenderSignature === nextSignature && container.classList.contains('operon-kanban-view')) {
			return;
		}
		this.preserveViewportOnNextRender = false;

		this.closeActivePresetPicker();
		this.closeActiveFilterPopover();
		this.hideHoverMenu(true);
		this.captureSearchFocusState(container);
		this.captureBoardScrollState(container, preserveViewport);
		this.clearKanbanSearchRefreshTimer();
		this.clearBoardLayoutRefresh();
		this.clearToolbarLayout();
		this.clearKanbanSearchScopePopoverPositioning();
		this.clearKanbanMobileLayout();
		this.clearKanbanLazyObservers();
		cleanupOperonHoverTooltips(container);
		container.empty();
		container.addClass('operon-kanban-view');

		const root = container.createDiv('operon-kanban-root');
		if (!preset) {
			root.createDiv({ text: t('notifications', 'kanbanPresetsMissing') });
			this.lastRenderSignature = nextSignature;
			return;
		}
		this.applyKanbanPresetTheme(root, preset);

		this.renderToolbar(root, state, preset, currentFilter, parentSearchUi);
		const content = root.createDiv('operon-kanban-content');
		const optimisticMoveCountBeforeBoardRender = this.optimisticMoves.size;
		this.renderBoardContent(content, state, preset, pipeline, filterSet, settings, parentSearchUi);
		this.restoreSearchFocus(root);
		this.lastRenderSignature = this.optimisticMoves.size === optimisticMoveCountBeforeBoardRender
			? nextSignature
			: this.buildRenderSignature(container, state, preset, pipeline, filterSet, settings, parentSearchUi);
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
		const includeTrackerFields = this.usesTrackerFields(preset, filterSet)
			|| this.usesTrackerFieldsInKanbanTaskChips(settings);
		const taskSignature = this.taskSignatureIndex.buildBoardSignature(
			this.indexer.getAllTasks(),
			includeTrackerFields,
			this.indexer.getGeneration(),
		);
		const includePinnedGeneration = this.filterSetUsesField(filterSet, 'pinned');
		const includePinnedActionState = settings.kanbanTaskShowPinAction;
		const pinnedGeneration = includePinnedGeneration || includePinnedActionState
			? (this.getPinnedCache()?.getGeneration() ?? 0)
			: 0;
		const trackingSignature = settings.kanbanTaskShowPlayAction
			? this.callbacks.getTrackingSignature?.() ?? ''
			: '';
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
			kanbanPresetFavorites: settings.presetFavorites.kanban,
			pipeline,
			pipelines: settings.pipelines,
			filterSet,
			priorities: settings.priorities,
			keyMappings: settings.keyMappings,
			projectSerialScopes: settings.projectSerialScopes,
			filePropertySignature: this.getFilePropertyContext(settings).signature,
			language: getCurrentLang(),
			timeFormat: settings.timeFormat,
			fallbackTaskIconSource: settings.fallbackTaskIconSource,
			taskStatusIconColorSource: settings.taskStatusIconColorSource,
			fallbackStateIcons: settings.fallbackStateIcons,
			kanbanTaskCompactChips: settings.kanbanTaskCompactChips,
			kanbanTaskShowPlayAction: settings.kanbanTaskShowPlayAction,
			kanbanTaskShowPinAction: settings.kanbanTaskShowPinAction,
			kanbanTaskShowNoteAction: settings.kanbanTaskShowNoteAction,
			kanbanTaskShowSubtaskAction: settings.kanbanTaskShowSubtaskAction,
			kanbanTaskShowPlainCheckboxAction: settings.kanbanTaskShowPlainCheckboxAction,
			kanbanTaskShowNotesPreview: settings.kanbanTaskShowNotesPreview,
			kanbanTaskShowSubtaskProgress: settings.kanbanTaskShowSubtaskProgress,
			kanbanTaskShowPlainCheckboxProgress: settings.kanbanTaskShowPlainCheckboxProgress,
			kanbanTaskTrackingSignature: trackingSignature,
			kanbanTaskChipLocationSignature: getKanbanTaskChipLocationSignature(this.app, settings),
			projectSerialSignature: this.callbacks.getProjectSerialSignature?.() ?? '',
			repeatSkipSignature: this.callbacks.getRepeatSkipSignature?.() ?? '',
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
				manualOrder: preset && hasManualKanbanSorting(preset) && preset.id
					? this.callbacks.getManualOrder?.(preset.id) ?? {}
					: null,
			tasks: taskSignature,
		});
	}

	private usesTrackerFieldsInKanbanTaskChips(settings: OperonSettings): boolean {
		return settings.kanbanTaskCompactChips.some(item => KANBAN_TRACKER_FIELD_KEYS.has(item.key));
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
		if (preset?.columnSortOverrides?.some(override => override.sortRules.some(rule => KANBAN_TRACKER_FIELD_KEYS.has(rule.field)))) return true;
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
			this.lastRenderedBoard = null;
			this.lastRenderedBoardScope = null;
			this.lastRenderedBoardTaskSignatures = null;
			this.renderEmptyState(container, t('notifications', 'kanbanChoosePipeline'));
			return;
		}
		const { board, searchActive } = this.queryKanbanBoardData(
			state,
			preset,
			pipeline,
			filterSet,
			settings,
			parentSearchUi,
		);
		this.lastRenderedBoard = board;
		this.lastRenderedBoardScope = this.buildDropScrollAnchorScope();
		this.lastRenderedBoardTaskSignatures = this.buildKanbanBoardTaskSignatures(board);
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

	private queryKanbanBoardData(
		state: KanbanLeafState,
		preset: KanbanPreset,
		pipeline: Pipeline,
		filterSet: FilterSet | null,
		settings: OperonSettings,
		parentSearchUi: KanbanParentSearchUiState | null,
	): KanbanBoardQueryResult {
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
			pipelines: settings.pipelines,
			filterSet,
			tasks: this.indexer.getAllTasks(),
			priorities: settings.priorities,
			searchQuery: activeSearchQuery,
			taskIdFilter,
			skippedStatusIds,
			skippedLaneKeys: searchActive || !hasVisibleSwimlanes ? undefined : state.collapsedLaneKeys,
			pinnedCache: this.getPinnedCache(),
			manualOrder: hasManualKanbanSorting(preset)
				? this.callbacks.getManualOrder?.(preset.id) ?? {}
				: undefined,
			keyMappings: settings.keyMappings,
			projectSerialScopes: settings.projectSerialScopes,
			getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay,
			filterEvaluationOptions: {
				filePropertyContext: this.getFilePropertyContext(settings),
			},
		});
		this.reconcileOptimisticMoves(board, pipeline, preset);
		this.applyOptimisticMoves(board, settings);
		return { board, searchActive };
	}

	private renderToolbar(
		container: HTMLElement,
		state: KanbanLeafState,
		preset: KanbanPreset,
		currentFilter: FilterSet | null,
		parentSearchUi: KanbanParentSearchUiState | null,
	): void {
		const toolbar = container.createDiv('operon-kanban-toolbar');
		const start = toolbar.createDiv('operon-kanban-toolbar-start');
		const center = toolbar.createDiv('operon-kanban-toolbar-center');
		const end = toolbar.createDiv('operon-kanban-toolbar-end');
		const kanbanPresets = this.getSettings().kanbanPresets;
		const title = start.createDiv('operon-kanban-toolbar-title');
		const titleIcon = title.createSpan('operon-kanban-toolbar-title-icon');
		setIcon(titleIcon, 'square-kanban');
		title.createDiv({
			text: t('commands', 'openKanban'),
			cls: 'operon-kanban-toolbar-title-main',
		});
		this.renderKanbanRelatedViewsButton(title, preset);
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

		for (const entry of getFavoriteKanbanPresets(kanbanPresets, this.getSettings().presetFavorites)) {
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

		this.renderKanbanPresetPickerButton(end, kanbanPresets, preset);
		this.renderKanbanFilterPopoverButton(end, preset, currentFilter);

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
				this.scheduleKanbanSearchRefresh(searchWrap);
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
			this.clearKanbanSearchRefreshTimer();
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
			cls: 'operon-kanban-toolbar-settings-button operon-kanban-toolbar-preset-settings-button',
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
			this.closeActivePresetPicker();
			this.closeActiveFilterPopover();
			void this.callbacks.onOpenPresetSettings?.(preset.id);
		});
		this.applyKanbanToolbarLayoutMode(toolbar, start, center, end);
	}

	private resolveEditableKanbanFilter(preset: KanbanPreset, settings: OperonSettings): FilterSet | null {
		if (!preset.filterSetId) return null;
		const filterSet = settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		return filterSet && !isSpecialDynamicFilterSet(filterSet) ? filterSet : null;
	}

	private renderKanbanFilterPopoverButton(
		container: HTMLElement,
		preset: KanbanPreset,
		currentFilter: FilterSet | null,
	): void {
		const host = container.createDiv('operon-kanban-filter-popover-host');
		const button = host.createEl('button', {
			cls: 'operon-kanban-toolbar-settings-button operon-kanban-filter-popover-button',
			attr: {
				type: 'button',
				'aria-haspopup': 'dialog',
				'aria-expanded': 'false',
			},
		});
		button.classList.toggle('is-active', currentFilter !== null);
		setIcon(button, 'funnel');
		setAccessibleLabelWithoutTooltip(button, t('table', 'filter'));
		bindOperonHoverTooltip(button, {
			content: t('table', 'filter'),
			taskColor: null,
			preferredVertical: 'above',
		});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.closeActivePresetPicker();
			this.closeActiveFilterPopover();
			this.openKanbanFilterPopover(host, button, preset, currentFilter);
		});
	}

	private openKanbanFilterPopover(
		host: HTMLElement,
		button: HTMLButtonElement,
		preset: KanbanPreset,
		currentFilter: FilterSet | null,
	): void {
		const settings = this.getSettings();
		const expectedPresetFilterSetId = preset.filterSetId;
		let closePopover: (() => void) | null = null;
		closePopover = showPresetFilterPopover({
			app: this.app,
			anchor: button,
			triggerHost: host,
			label: t('table', 'filter'),
			currentFilter,
			newFilterName: createUniquePresetFilterName(t('table', 'newFilterName'), settings.filterSets),
			keyMappings: settings.keyMappings,
			filterModalOptions: {
				getSettings: () => this.getSettings(),
				getProjectSerialScopeTasks: () => this.indexer.getAllTasks(),
				getFilePropertyDiscoveryTasks: () => this.indexer.getAllTasks(),
				getFilePropertySnapshot: tasks => getTableFilePropertyIndex(this.app).getSnapshot(
					tasks,
					this.indexer.getGeneration(),
					{ keyMappings: this.getSettings().keyMappings },
				),
			},
			countTasks: filterSet => filterTasksForCalendar(
				filterSet,
				this.indexer.getAllTasks(),
				this.getSettings().priorities,
				this.getPinnedCache(),
				{
					projectSerialScopes: this.getSettings().projectSerialScopes,
					projectSerialScopeTasks: this.indexer.getAllTasks(),
					dependencyTasks: this.indexer.getAllTasks(),
					pipelines: this.getSettings().pipelines,
					filePropertyContext: this.getFilePropertyContext(this.getSettings()),
				},
			).length,
			saveTooltip: currentFilter
				? buildPresetFilterUsageTooltip(settings, currentFilter.id)
				: undefined,
			classNames: ['operon-kanban-filter-popover'],
			onCommit: async (filterSet, sourceFilterSetId) => {
				if (!this.callbacks.onCommitPresetFilter) {
					throw new Error('Operon: Kanban filter save callback is unavailable.');
				}
				await this.callbacks.onCommitPresetFilter({
					presetId: preset.id,
					filterSet,
					sourceFilterSetId,
					expectedPresetFilterSetId,
				});
			},
			onCommitError: error => {
				console.error('Operon: failed to save Kanban filter popover draft', error);
				new Notice(t('table', 'presetActionFailed'));
			},
			onClose: close => {
				if (this.activeFilterPopoverClose === close) this.activeFilterPopoverClose = null;
			},
			resolveFallbackFocusTarget: () => this.contentEl.querySelector<HTMLButtonElement>(
				'button.operon-kanban-filter-popover-button',
			),
		});
		this.activeFilterPopoverClose = closePopover;
	}

	private renderKanbanRelatedViewsButton(container: HTMLElement, preset: KanbanPreset): void {
		renderRelatedViewsLauncher({
			container,
			settings: this.getSettings(),
			source: { type: 'kanban', preset },
			buttonClass: 'operon-kanban-related-views-button',
			closeBeforeOpen: () => {
				this.closeActivePresetPicker();
				this.closeActiveFilterPopover();
			},
			onOpenRelatedView: target => this.callbacks.onOpenRelatedView?.(target),
			onCreateRelatedView: target => this.callbacks.onCreateRelatedView?.(target),
		});
	}

	private renderKanbanPresetPickerButton(
		container: HTMLElement,
		presets: readonly KanbanPreset[],
		activePreset: KanbanPreset,
	): void {
		const button = container.createEl('button', {
			cls: 'operon-kanban-toolbar-settings-button operon-kanban-toolbar-preset-picker-button',
			attr: {
				type: 'button',
				'aria-haspopup': 'listbox',
				'aria-expanded': 'false',
			},
		});
		const activePresetIndex = Math.max(0, presets.findIndex(entry => entry.id === activePreset.id));
		const activeLabel = getKanbanPresetPickerLabel(activePreset, activePresetIndex);
		const buttonState = resolveKanbanPresetPickerButtonState(
			activePreset,
			this.getSettings().presetFavorites,
			t('tooltips', 'selectKanbanPreset'),
			activeLabel,
		);
		button.classList.toggle('has-active-nonfavorite-preset', buttonState.hasActiveNonFavoritePreset);
		setAccessibleLabelWithoutTooltip(button, `${t('tooltips', 'selectKanbanPreset')}: ${activeLabel}`);
		setIcon(button, 'square-kanban');
		bindOperonHoverTooltip(button, {
			content: buttonState.tooltip,
			taskColor: null,
			preferredVertical: 'above',
		});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.closeActivePresetPicker();
			this.closeActiveFilterPopover();
			button.setAttribute('aria-expanded', 'true');
			let closePicker: (() => void) | null = null;
			closePicker = showKanbanPresetPicker(button, {
				value: activePreset.id,
				presets,
				onSelect: presetId => {
					this.clearParentSearchState();
					void this.updateLeafState(this.buildStateForPresetSwitch(presetId));
				},
				onClose: () => {
					if (button.isConnected) button.setAttribute('aria-expanded', 'false');
					if (closePicker && this.activePresetPickerClose === closePicker) {
						this.activePresetPickerClose = null;
					}
				},
				floatingHost: container.ownerDocument.body,
				floatingScrollHost: container.ownerDocument.defaultView ?? window,
				matchWidth: 280,
			});
			this.activePresetPickerClose = closePicker;
		});
	}

	private closeActivePresetPicker(): void {
		const close = this.activePresetPickerClose;
		this.activePresetPickerClose = null;
		close?.();
	}

	private closeActiveFilterPopover(): void {
		const close = this.activeFilterPopoverClose;
		this.activeFilterPopoverClose = null;
		close?.();
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
				if (phonePresetDropdown) this.closeActivePresetPicker();
				const requiredWidth = this.measureKanbanToolbarGroupWidth(start)
					+ this.measureKanbanToolbarGroupWidth(center)
					+ this.measureKanbanToolbarGroupWidth(end)
					+ 24;
				toolbar.classList.toggle('is-compact', !phonePresetDropdown && requiredWidth > width);
			};

			this.clearToolbarLayout();

			updateLayout();
			window.requestAnimationFrame(updateLayout);
			const lateUpdateTimer = window.setTimeout(updateLayout, 120);

			const observer = new ResizeObserver(() => updateLayout());
			observer.observe(toolbar);
			observer.observe(start);
			observer.observe(center);
			observer.observe(end);
			this.toolbarLayoutCleanup = () => {
				observer.disconnect();
				window.clearTimeout(lateUpdateTimer);
			};
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
		syncSearchScopeControlWrapClasses({
			searchWrap,
			scope: this.searchScope,
			selection: this.parentSearchSelection,
			rawQuery,
			isDefaultScope: isDefaultKanbanSearchBoxScope,
		});
	}

	private isKanbanMobileLayoutEligible(gridViewport: HTMLElement): boolean {
		const settings = this.getSettings();
		const ownerWindow = getOwnerWindow(gridViewport);
		const coarsePointer = typeof ownerWindow.matchMedia === 'function'
			&& ownerWindow.matchMedia(KANBAN_MOBILE_LAYOUT_MEDIA_QUERY).matches;
		const viewportWidth = Math.ceil(
			gridViewport.getBoundingClientRect().width
			|| gridViewport.clientWidth
			|| gridViewport.parentElement?.getBoundingClientRect().width
			|| this.contentEl.getBoundingClientRect().width
			|| ownerWindow.innerWidth
			|| 0,
		);
		return settings.kanbanMobileLayoutChromeEnabled === true
			&& (coarsePointer || isKanbanMobilePlatform())
			&& viewportWidth <= settings.kanbanMobileLayoutMaxWidthPx;
	}

		private setSearchQueryState(searchQuery: string): void {
			this.state = this.normalizeState({
				...this.ensureState(),
				searchQuery,
			});
			this.lastRenderSignature = null;
		}

		private scheduleKanbanSearchRefresh(searchWrap: HTMLElement): void {
			this.clearKanbanSearchRefreshTimer();
			const ownerWindow = getOwnerWindow(searchWrap);
			this.kanbanSearchRefreshTimer = {
				win: ownerWindow,
				id: ownerWindow.setTimeout(() => {
					this.kanbanSearchRefreshTimer = null;
					if (!searchWrap.isConnected) return;
					this.refreshKanbanSearchResults(searchWrap);
				}, KANBAN_SEARCH_REFRESH_DEBOUNCE_MS),
			};
		}

		private clearKanbanSearchRefreshTimer(): void {
			if (this.kanbanSearchRefreshTimer === null) return;
			this.kanbanSearchRefreshTimer.win.clearTimeout(this.kanbanSearchRefreshTimer.id);
			this.kanbanSearchRefreshTimer = null;
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
			this.captureBoardScrollState(content);
			this.clearBoardLayoutRefresh();
			this.clearKanbanLazyObservers();
			cleanupOperonHoverTooltips(content);
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
			renderSearchScopePopover({
				searchWrap,
				scope: this.searchScope,
				settings: this.getSettings(),
				selectedParent: this.parentSearchSelection,
				classNames: KANBAN_SEARCH_SCOPE_CONTROL_CLASSES,
				groups: KANBAN_SEARCH_SCOPE_GROUPS,
				disabledKeys: KANBAN_SEARCH_BOX_DISABLED_KEYS,
				unavailableTooltip: t('modals', 'taskFinderScopeUnavailable'),
				onPopoverCreated: popover => this.bindKanbanSearchScopePopoverPositioning(searchWrap, popover),
				onToggle: key => {
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
				},
				onClearParent: () => {
					this.parentSearchSelection = null;
					this.parentSearchDismissed = false;
					this.parentSearchHighlightedIndex = 0;
					this.markDirty();
				},
				onRefocus: () => this.focusKanbanSearchInput(),
				selectedParentClearControl: { kind: 'text', text: '×' },
			});
		}

		private renderParentSearchDropdown(
			searchWrap: HTMLElement,
			parentSearchUi: KanbanParentSearchUiState | null,
		): void {
			renderParentSearchDropdown({
				searchWrap,
				parentSearchUi,
				highlightedIndex: this.parentSearchHighlightedIndex,
				classNames: KANBAN_SEARCH_SCOPE_CONTROL_CLASSES,
				noParentsText: t('notifications', 'kanbanParentSearchNoParents'),
				onSelect: candidate => {
					if (!parentSearchUi) return;
					this.selectParentSearchCandidate(parentSearchUi.mode, candidate);
				},
			});
		}

	private renderBoard(container: HTMLElement, board: KanbanBoardData, searchActive: boolean): void {
		const boardEl = container.createDiv('operon-kanban-board');
		boardEl.dataset.kanbanDropBoardSignature = buildKanbanDropBoardSignature(board.preset, board.pipeline);
		this.bindBoardDelegatedCardEvents(boardEl);
		const hasSwimlanes = board.preset.swimlaneBy !== null;
		boardEl.toggleClass('is-no-swimlanes', !hasSwimlanes);
		boardEl.toggleClass('is-manual-order', hasManualKanbanSorting(board.preset));
		boardEl.style.setProperty('--operon-kanban-column-width', `${this.getSettings().kanbanExpandedColumnWidthPx}px`);
		boardEl.style.setProperty('--operon-kanban-collapsed-width', `${KANBAN_COLLAPSED_COLUMN_WIDTH_PX}px`);
		boardEl.style.setProperty('--operon-kanban-lane-column-width', `${clampKanbanLaneColumnWidth(this.lastLaneColumnWidthPx ?? KANBAN_LANE_COLUMN_MIN_WIDTH_PX)}px`);
		const columns = board.columns;
		const state = this.ensureState();
		const allTasks = this.indexer.getAllTasks();
		const taskLookup = createCompactTaskLookup(allTasks);
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(this.getSettings().pipelines);
		const collapsedStatusIds = this.resolveCollapsedStatusIds(board, state, searchActive);
		const collapsedLaneKeys = this.resolveCollapsedLaneKeys(board, state, searchActive);
		const columnTemplate = this.buildColumnTemplate(columns, Array.from(collapsedStatusIds));

		const gridViewport = boardEl.createDiv('operon-kanban-grid-viewport');
		// One delegated listener replaces the former per-cell viewport scroll
		// listeners: hide any open quick-add overlay and clear the axis once.
		gridViewport.addEventListener('scroll', () => {
			this.hideCellQuickAdds(boardEl);
			boardEl.dispatchEvent(new Event('operon-kanban-axis-clear'));
			this.closeTaskNotePopoverForUserScroll();
		}, { passive: true });
		const gridContent = gridViewport.createDiv('operon-kanban-grid-content');
		this.restoreBoardBottomScrollCompensation(gridContent);
		const renderAsMobileLayout = this.isKanbanMobileLayoutEligible(gridViewport);
		boardEl.closest<HTMLElement>('.operon-kanban-root')?.classList.toggle('is-mobile-layout', renderAsMobileLayout);
		boardEl.classList.toggle('is-mobile-layout', renderAsMobileLayout);
		const fullColumnTemplate = hasSwimlanes
			? `var(--operon-kanban-active-lane-column-width, var(--operon-kanban-lane-column-width, 96px)) ${columnTemplate}`
			: columnTemplate;
		const headerRow = gridContent.createDiv('operon-kanban-header-row');
		headerRow.style.gridTemplateColumns = fullColumnTemplate;
		if (hasSwimlanes) {
			const corner = headerRow.createDiv('operon-kanban-corner-cell');
			this.renderCornerSummary(corner, board.relevantTasks.length);
		}
		const columnHeaderByStatusId = new Map<string, HTMLElement>();

		for (const column of columns) {
			const header = headerRow.createDiv('operon-kanban-column-header');
			header.dataset.kanbanStatusId = column.statusId;
			columnHeaderByStatusId.set(column.statusId, header);
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
				bindOperonHoverTooltip(toggle, {
					content: column.statusLabel,
					taskColor: column.color || null,
					tooltipClassName: 'operon-kanban-axis-tooltip',
				});
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
		const laneLabelByKey = new Map<string, HTMLElement>();
		const maxVisibleTasksPerCell = this.getSettings().kanbanMaxVisibleTasksPerCell;
		const deferredCells: KanbanDeferredCellEntry[] = [];

		for (const lane of board.lanes) {
			const row = gridContent.createDiv('operon-kanban-row');
			row.dataset.kanbanLaneKey = lane.key;
			row.style.gridTemplateColumns = fullColumnTemplate;
			const isLaneCollapsed = hasSwimlanes && collapsedLaneKeys.has(lane.key);
			row.classList.toggle('is-collapsed', isLaneCollapsed);
			let laneLabel: HTMLElement | null = null;
			if (hasSwimlanes) {
				laneLabel = row.createDiv('operon-kanban-lane-label');
				laneLabel.dataset.kanbanLaneKey = lane.key;
				laneLabelByKey.set(lane.key, laneLabel);
				laneLabel.classList.toggle('is-collapsed', isLaneCollapsed);
				laneLabel.classList.toggle('is-no-value', lane.isNoValue);
				if (lane.color) {
					laneLabel.style.setProperty('--operon-kanban-lane-color', lane.color);
				}
				const laneDisplayLabel = formatKanbanSwimlaneDisplayLabel(lane.label);
				const laneTitle = laneLabel.createDiv('operon-kanban-lane-title');
				renderKanbanSwimlaneTitle(laneTitle, laneDisplayLabel);
				const laneToggle = laneLabel.createEl('button', {
					cls: 'operon-kanban-lane-count-button',
					text: String(lane.count),
					attr: {
						type: 'button',
					},
				});
				setAccessibleLabelWithoutTooltip(laneToggle, isLaneCollapsed
					? t('tooltips', 'expandKanbanSwimlane', { name: laneDisplayLabel })
					: t('tooltips', 'collapseKanbanSwimlane', { name: laneDisplayLabel }));
				bindOperonHoverTooltip(laneToggle, {
					content: laneDisplayLabel,
					taskColor: lane.color || null,
					tooltipClassName: 'operon-kanban-axis-tooltip',
				});
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
				// The placeholder height must exist before restoreBoardScrollState
				// runs below, otherwise the restored scrollTop clamps against a
				// near-empty grid and the board jumps to the top after a drop.
				const estimatedHeightPx = estimateKanbanCellPlaceholderHeightPx({
					taskCount: tasks.length,
					maxVisibleTasks: maxVisibleTasksPerCell,
					renderBatchSize: KANBAN_CARD_RENDER_BATCH_SIZE,
					cardHeightPx: KANBAN_ESTIMATED_CARD_HEIGHT_PX,
					cardGapPx: KANBAN_ESTIMATED_CARD_GAP_PX,
				});
				if (estimatedHeightPx > 0) {
					cell.style.minHeight = `${estimatedHeightPx}px`;
				}
				deferredCells.push({
					cell,
					materialize: this.createKanbanCellMaterializer(
						cell,
						tasks,
						taskCount,
						board,
						column,
						lane,
						allTasks,
						taskLookup,
						workflowStatusIdentityIndex,
						renderAsMobileLayout,
					),
				});
			}

			if (laneLabel) laneLabelEls.push(laneLabel);
			gridRowEls.push(row);
		}

		this.bindBoardAxisHighlighting(boardEl, columnHeaderByStatusId, laneLabelByKey);
		this.bindBoardScrollStateTracking(gridViewport);
		this.restoreBoardScrollState(gridViewport);
		this.activateDeferredCellMaterialization(gridViewport, deferredCells);
		this.syncRowCellHeights(gridRowEls);
		if (hasSwimlanes) {
			this.syncLaneHeights(laneLabelEls, gridRowEls);
			this.refreshLaneColumnWidth(boardEl, laneTitleEls);
		}
		this.restoreBoardViewportAnchor(gridViewport);
		this.bindKanbanMobileLayout(boardEl, gridViewport, hasSwimlanes);
		this.bindBoardLayoutRefresh(boardEl, laneLabelEls, gridRowEls, laneTitleEls, hasSwimlanes);
	}

	private createKanbanCellMaterializer(
		cell: HTMLElement,
		tasks: IndexedTask[],
		taskCount: number,
		board: KanbanBoardData,
		column: KanbanColumn,
		lane: KanbanLane,
		allTasks: IndexedTask[],
		taskLookup: CompactTaskLookupContext,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
		readOnlyChips: boolean,
	): () => KanbanCellRenderFinalizer {
		return () => {
			cell.style.removeProperty('min-height');
			this.bindCellQuickAdd(cell, column, lane, board.preset);
			return this.renderInitialCellTasks(
				cell,
				tasks,
				taskCount,
				board.pipeline,
				board.preset,
				column.statusId,
				lane.key,
				allTasks,
				taskLookup,
				workflowStatusIdentityIndex,
				readOnlyChips,
			);
		};
	}

	private renderInitialCellTasks(
		cell: HTMLElement,
		tasks: IndexedTask[],
		totalTaskCount: number,
		pipeline: Pipeline | null,
		preset: KanbanPreset,
		statusId: string,
		laneKey: string,
		allTasks: IndexedTask[],
		taskLookup: CompactTaskLookupContext,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
		readOnlyChips: boolean,
	): KanbanCellRenderFinalizer {
		const maxVisibleTasks = this.getSettings().kanbanMaxVisibleTasksPerCell;
		const initialLimit = resolveKanbanCellInitialRenderLimit({
			taskCount: tasks.length,
			renderBatchSize: KANBAN_CARD_RENDER_BATCH_SIZE,
			maxVisibleTasks,
			savedScrollTopPx: this.getPendingCellScrollTop(statusId, laneKey),
			cardHeightPx: KANBAN_ESTIMATED_CARD_HEIGHT_PX,
			cardGapPx: KANBAN_ESTIMATED_CARD_GAP_PX,
		});
		this.renderTaskCardBatch(cell, tasks, 0, initialLimit, pipeline, preset, statusId, laneKey, allTasks, taskLookup, workflowStatusIdentityIndex, readOnlyChips, null);
		cell.dataset.kanbanVisibleCount = String(initialLimit);
		// Height limiting is split into measure/commit so batch materialization
		// can run all reads in one pass (single forced layout) before writing.
		let measuredHeightLimitPx: number | null = null;
		return {
			measure: () => {
				measuredHeightLimitPx = this.measureCellHeightLimitPx(cell, maxVisibleTasks, totalTaskCount);
			},
			commit: () => {
				this.commitCellHeightLimit(cell, measuredHeightLimitPx);
				if (tasks.length > initialLimit) {
					this.attachCellLazySentinel(cell, tasks, pipeline, preset, statusId, laneKey, maxVisibleTasks, allTasks, taskLookup, workflowStatusIdentityIndex, readOnlyChips);
				}
				this.restoreCellScrollIfPending(cell);
			},
		};
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
		allTasks: IndexedTask[],
		taskLookup: CompactTaskLookupContext,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
		readOnlyChips: boolean,
		beforeEl: HTMLElement | null,
	): void {
		for (let index = startIndex; index < endIndex; index++) {
			const task = tasks[index];
			if (!task) continue;
			const card = this.renderTaskCard(cell, task, pipeline, preset, statusId, laneKey, allTasks, taskLookup, workflowStatusIdentityIndex, readOnlyChips, false, 0);
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
		allTasks: IndexedTask[],
		taskLookup: CompactTaskLookupContext,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex,
		readOnlyChips: boolean,
	): void {
		this.clearCellLazySentinelObserver(cell);
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
				this.forgetKanbanLazyObserver(observer);
				if (this.cellLazySentinelObservers.get(cell) === observer) {
					this.cellLazySentinelObservers.delete(cell);
				}
				sentinel.remove();
				return;
			}
			const nextVisible = Math.min(tasks.length, currentVisible + KANBAN_CARD_RENDER_BATCH_SIZE);
			this.renderTaskCardBatch(cell, tasks, currentVisible, nextVisible, pipeline, preset, statusId, laneKey, allTasks, taskLookup, workflowStatusIdentityIndex, readOnlyChips, sentinel);
			cell.dataset.kanbanVisibleCount = String(nextVisible);
			setSentinelNextTaskId(nextVisible);
			this.applyCellHeightLimit(cell, maxVisibleTasks, tasks.length);
			this.scheduleBoardLayoutRefreshFromCell(cell);
			if (nextVisible >= tasks.length) {
				observer.disconnect();
				this.forgetKanbanLazyObserver(observer);
				if (this.cellLazySentinelObservers.get(cell) === observer) {
					this.cellLazySentinelObservers.delete(cell);
				}
				sentinel.remove();
			}
			this.restoreCellScrollIfPending(cell);
		}, { root: cell, rootMargin: '0px' });
		this.kanbanLazyObservers.push(observer);
		this.cellLazySentinelObservers.set(cell, observer);
		observer.observe(sentinel);
	}

	private activateDeferredCellMaterialization(
		gridViewport: HTMLElement,
		deferredCells: KanbanDeferredCellEntry[],
	): void {
		const viewportRect = gridViewport.getBoundingClientRect();
		const pendingCells: KanbanDeferredCellEntry[] = [];
		const finalizers: KanbanCellRenderFinalizer[] = [];
		// Phase 1: render cards for every near-viewport cell (DOM writes only).
		for (const entry of deferredCells) {
			if (shouldMaterializeKanbanCell(viewportRect, entry.cell.getBoundingClientRect(), KANBAN_CELL_MATERIALIZE_MARGIN_PX)) {
				finalizers.push(entry.materialize());
				continue;
			}
			pendingCells.push(entry);
		}
		// Phase 2: measure all height limits in one pass (single forced layout).
		for (const finalizer of finalizers) finalizer.measure();
		// Phase 3: commit limits and attach lazy sentinels (writes only).
		for (const finalizer of finalizers) finalizer.commit();
		if (pendingCells.length === 0) return;
		const observer = new IntersectionObserver(entries => {
			const cells: HTMLElement[] = [];
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				observer.unobserve(entry.target);
				const cell = asHTMLElement(entry.target, gridViewport);
				if (cell) cells.push(cell);
			}
			const firstCell = cells[0];
			if (firstCell && this.materializeKanbanCellsIfPending(cells)) {
				this.scheduleBoardLayoutRefreshFromCell(firstCell);
			}
		}, { root: gridViewport, rootMargin: `${KANBAN_CELL_MATERIALIZE_MARGIN_PX}px` });
		this.kanbanLazyObservers.push(observer);
		for (const entry of pendingCells) {
			this.pendingCellMaterializers.set(entry.cell, entry.materialize);
			observer.observe(entry.cell);
		}
	}

	private materializeKanbanCellIfPending(cell: HTMLElement | null): boolean {
		return cell ? this.materializeKanbanCellsIfPending([cell]) : false;
	}

	private materializeKanbanCellsIfPending(cells: readonly HTMLElement[]): boolean {
		const finalizers: KanbanCellRenderFinalizer[] = [];
		for (const cell of cells) {
			const materialize = this.pendingCellMaterializers.get(cell);
			if (!materialize) continue;
			this.pendingCellMaterializers.delete(cell);
			finalizers.push(materialize());
		}
		for (const finalizer of finalizers) finalizer.measure();
		for (const finalizer of finalizers) finalizer.commit();
		return finalizers.length > 0;
	}

	private bindBoardDelegatedCardEvents(boardEl: HTMLElement): void {
		this.bindBoardKeyboardCardMoves(boardEl);
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

			if (
				closestInteractiveKanbanChipRow(target)
				|| closestKanbanNotePreview(target)
				|| target.closest('.operon-calendar-status-button, .operon-calendar-hover-menu, a.internal-link')
			) return;
			const card = target.closest<HTMLElement>('.operon-kanban-card');
			const taskId = card?.dataset.operonTaskId;
			if (!card || !taskId || !boardEl.contains(card)) return;
			event.stopPropagation();
			if (isTaskSourceOpenModifierClick(event) && this.callbacks.onOpenTaskSource) {
				event.preventDefault();
				void Promise.resolve(this.callbacks.onOpenTaskSource(taskId)).catch(error => {
					console.error('Operon: failed to open Kanban task source', error);
				});
				return;
			}
			void this.callbacks.onItemAction?.(taskId, 'openEditor');
		});

		boardEl.addEventListener('dragstart', event => {
			const target = asHTMLElement(event.target, boardEl);
			if (target && isKanbanCardInteractionTarget(target)) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			const card = target?.closest<HTMLElement>('.operon-kanban-card');
			if (!card || card.dataset.kanbanPreview === 'true') return;
			if (boardEl.classList.contains('is-mobile-layout') && boardEl.dataset.kanbanMobileTouchPointerActive === 'true') {
				event.preventDefault();
				return;
			}
			const taskId = card.dataset.operonTaskId;
			const sourceLaneKey = card.dataset.kanbanLaneKey;
			const boardSignature = boardEl.dataset.kanbanDropBoardSignature;
			if (!taskId || !sourceLaneKey || !boardSignature) return;
			if (this.cardOperations.isTaskPending(taskId)) {
				event.preventDefault();
				return;
			}
			this.draggedCardContext = {
				taskId,
				sourceStatusId: card.dataset.kanbanStatusId ?? null,
				sourceStatusValue: card.dataset.kanbanStatusValue ?? '',
				sourceLaneKey,
				boardSignature,
				cardEl: card,
			};
			this.beginKanbanDragInteraction();
			this.requestActiveTaskNotePopoverClose(false);
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
			this.endKanbanDragInteraction();
		});
	}

	private bindBoardKeyboardCardMoves(boardEl: HTMLElement): void {
		const liveRegion = boardEl.createDiv({
			cls: 'operon-sr-only',
			attr: {
				role: 'status',
				'aria-live': 'polite',
				'aria-atomic': 'true',
			},
		});
		let keyboardMove: {
			dragged: DraggedKanbanCardContext;
			sourceCard: HTMLElement;
			targetCell: HTMLElement;
			insertionIndex: number;
			targetBeforeTaskId: string | null;
			wasDraggable: boolean;
		} | null = null;

		const announce = (message: string): void => {
			if (liveRegion.isConnected) liveRegion.setText(message);
		};
		const getCellCards = (cell: HTMLElement, excludedTaskId: string): HTMLElement[] => (
			Array.from(cell.querySelectorAll<HTMLElement>(':scope > .operon-kanban-card'))
				.filter(card => card.dataset.kanbanPreview !== 'true')
				.filter(card => card.dataset.operonTaskId !== excludedTaskId)
		);
		const describeCell = (cell: HTMLElement): string => {
			const preset = this.resolveCurrentPreset();
			const pipeline = this.getSettings().pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
			const statusId = cell.dataset.kanbanStatusId ?? '';
			const statusLabel = pipeline?.statuses.find(status => status.id === statusId)?.label ?? statusId;
			if (!preset.swimlaneBy) return statusLabel;
			const laneKey = cell.dataset.kanbanLaneKey ?? '';
			const laneLabel = boardEl.querySelector<HTMLElement>(
				`.operon-kanban-lane-label[data-kanban-lane-key="${CSS.escape(laneKey)}"]`,
			)?.textContent?.trim() ?? laneKey;
			return [statusLabel, laneLabel].filter(Boolean).join(' · ');
		};
		const setKeyboardTarget = (cell: HTMLElement, shouldAnnounce: boolean): void => {
			const move = keyboardMove;
			if (!move) return;
			if (move.targetCell !== cell) {
				move.targetCell.removeClass('is-drop-target');
				this.clearManualDropIndicator(move.targetCell);
			}
			this.materializeKanbanCellIfPending(cell);
			move.targetCell = cell;
			cell.addClass('is-drop-target');
			const preset = this.resolveCurrentPreset();
			const statusId = cell.dataset.kanbanStatusId ?? null;
			if (resolveKanbanEffectiveSorting(preset, statusId).sortMode === 'manual') {
				const cards = getCellCards(cell, move.dragged.taskId);
				move.insertionIndex = Math.max(0, Math.min(cards.length, move.insertionIndex));
				const beforeCard = cards[move.insertionIndex] ?? null;
				const sentinel = cell.querySelector<HTMLElement>(':scope > .operon-kanban-lazy-sentinel');
				const indicator = this.ensureManualDropIndicator(cell);
				if (beforeCard) {
					cell.insertBefore(indicator, beforeCard);
					move.targetBeforeTaskId = beforeCard.dataset.operonTaskId ?? null;
				} else if (sentinel) {
					cell.insertBefore(indicator, sentinel);
					move.targetBeforeTaskId = sentinel.dataset.kanbanNextTaskId ?? null;
				} else {
					cell.appendChild(indicator);
					move.targetBeforeTaskId = null;
				}
			} else {
				this.clearManualDropIndicator(cell);
				move.targetBeforeTaskId = null;
			}
			if (shouldAnnounce) announce(describeCell(cell));
		};
		const cancelKeyboardMove = (): void => {
			const move = keyboardMove;
			if (!move) return;
			move.targetCell.removeClass('is-drop-target');
			this.clearManualDropIndicator(move.targetCell);
			move.sourceCard.removeClass('is-dragging');
			move.sourceCard.setAttr('aria-grabbed', 'false');
			move.sourceCard.draggable = move.wasDraggable;
			if (this.draggedCardContext?.taskId === move.dragged.taskId) {
				this.draggedCardContext = null;
			}
			keyboardMove = null;
			this.endKanbanDragInteraction();
			announce(t('buttons', 'cancel'));
			if (move.sourceCard.isConnected) move.sourceCard.focus();
		};
		const startKeyboardMove = (card: HTMLElement): void => {
			const taskId = card.dataset.operonTaskId;
			const sourceLaneKey = card.dataset.kanbanLaneKey;
			const boardSignature = boardEl.dataset.kanbanDropBoardSignature;
			const sourceCell = card.closest<HTMLElement>('.operon-kanban-cell');
			if (
				!taskId
				|| !sourceLaneKey
				|| !boardSignature
				|| !sourceCell
				|| !this.callbacks.onCardDrop
				|| this.cardOperations.isTaskPending(taskId)
			) return;
			const dragged: DraggedKanbanCardContext = {
				taskId,
				sourceStatusId: card.dataset.kanbanStatusId ?? null,
				sourceStatusValue: card.dataset.kanbanStatusValue ?? '',
				sourceLaneKey,
				boardSignature,
				cardEl: card,
			};
			const sourceCards = Array.from(sourceCell.querySelectorAll<HTMLElement>(':scope > .operon-kanban-card'))
				.filter(candidate => candidate.dataset.kanbanPreview !== 'true');
			keyboardMove = {
				dragged,
				sourceCard: card,
				targetCell: sourceCell,
				insertionIndex: Math.max(0, sourceCards.indexOf(card)),
				targetBeforeTaskId: null,
				wasDraggable: card.draggable,
			};
			this.draggedCardContext = dragged;
			this.beginKanbanDragInteraction();
			this.requestActiveTaskNotePopoverClose(false);
			card.addClass('is-dragging');
			card.setAttr('aria-grabbed', 'true');
			card.draggable = false;
			setKeyboardTarget(sourceCell, true);
		};
		const dropKeyboardMove = (): void => {
			const move = keyboardMove;
			if (!move || !this.callbacks.onCardDrop) return;
			const targetStatusId = move.targetCell.dataset.kanbanStatusId;
			const targetLaneKey = move.targetCell.dataset.kanbanLaneKey;
			if (!targetStatusId || !targetLaneKey) {
				cancelKeyboardMove();
				return;
			}
			const targetLabel = describeCell(move.targetCell);
			move.sourceCard.setAttr('aria-grabbed', 'false');
			move.sourceCard.draggable = move.wasDraggable;
			keyboardMove = null;
			const preset = this.resolveCurrentPreset();
			const context: KanbanDropContext = {
				taskId: move.dragged.taskId,
				sourceStatusId: move.dragged.sourceStatusId,
				sourceStatusValue: move.dragged.sourceStatusValue,
				sourceLaneKey: move.dragged.sourceLaneKey,
				boardSignature: move.dragged.boardSignature,
				targetStatusId,
				targetLaneKey,
				swimlaneBy: preset.swimlaneBy,
				targetBeforeTaskId: move.targetBeforeTaskId,
			};
			this.completeKanbanCardDrop(
				move.targetCell,
				move.dragged,
				context,
				move.targetBeforeTaskId,
				preset,
				false,
				outcome => announce(outcome === 'cancelled'
					? t('buttons', 'cancel')
					: t(
						'notifications',
						outcome === 'succeeded' ? 'kanbanPlaced' : 'kanbanActionFailed',
						{ label: targetLabel },
					)),
			);
		};

		boardEl.addEventListener('keydown', event => {
			const target = asHTMLElement(event.target, boardEl);
			const card = target?.closest<HTMLElement>('.operon-kanban-card') ?? null;
			if (!target || !card || target !== card || card.dataset.kanbanPreview === 'true') return;
			if (event.key === 'Escape' && keyboardMove) {
				event.preventDefault();
				event.stopPropagation();
				cancelKeyboardMove();
				return;
			}
			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				if (keyboardMove) dropKeyboardMove();
				else startKeyboardMove(card);
				return;
			}
			const move = keyboardMove;
			if (!move || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				const laneCells = Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-cell'))
					.filter(cell => cell.dataset.kanbanLaneKey === move.dragged.sourceLaneKey);
				const currentIndex = laneCells.indexOf(move.targetCell);
				const nextIndex = Math.max(0, Math.min(
					laneCells.length - 1,
					currentIndex + (event.key === 'ArrowLeft' ? -1 : 1),
				));
				const nextCell = laneCells[nextIndex];
				if (!nextCell || nextCell === move.targetCell) return;
				move.insertionIndex = getCellCards(nextCell, move.dragged.taskId).length;
				setKeyboardTarget(nextCell, true);
				return;
			}
			const preset = this.resolveCurrentPreset();
			if (resolveKanbanEffectiveSorting(preset, move.targetCell.dataset.kanbanStatusId ?? null).sortMode !== 'manual') return;
			const cards = getCellCards(move.targetCell, move.dragged.taskId);
			move.insertionIndex = moveKanbanKeyboardInsertionIndex(
				move.insertionIndex,
				event.key === 'ArrowUp' ? -1 : 1,
				cards.length,
			);
			setKeyboardTarget(move.targetCell, true);
		});
		boardEl.addEventListener('focusout', event => {
			if (!keyboardMove) return;
			const nextTarget = asHTMLElement(event.relatedTarget, boardEl);
			if (nextTarget && boardEl.contains(nextTarget)) return;
			cancelKeyboardMove();
		});
	}

	private bindBoardAxisHighlighting(
		boardEl: HTMLElement,
		columnHeaderByStatusId: Map<string, HTMLElement>,
		laneLabelByKey: Map<string, HTMLElement>,
	): void {
		let activeColumnHeader: HTMLElement | null = null;
		let activeLaneLabel: HTMLElement | null = null;
		let lastTouchLikeAxisPointerAt = 0;

		const clearActiveAxis = (): void => {
			activeColumnHeader?.removeClass('is-axis-active');
			activeLaneLabel?.removeClass('is-axis-active');
			activeColumnHeader = null;
			activeLaneLabel = null;
		};

		const isTouchLikeAxisPointer = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';

		const resolveElementFromTarget = (target: unknown): Element | null => {
			if (typeof target !== 'object' || target === null) return null;
			const maybeElement = target as { closest?: unknown; nodeType?: number; ownerDocument?: Document | null };
			if (
				maybeElement.nodeType !== 1
				|| maybeElement.ownerDocument !== getOwnerDocument(boardEl)
				|| typeof maybeElement.closest !== 'function'
			) {
				return null;
			}
			return target as Element;
		};

		const resolveCellFromTarget = (target: unknown): HTMLElement | null => {
			const targetEl = resolveElementFromTarget(target);
			const cell = targetEl?.closest<HTMLElement>('.operon-kanban-cell') ?? null;
			if (!cell || !boardEl.contains(cell)) return null;
			return cell;
		};

		const activateCellAxis = (cell: HTMLElement | null): void => {
			if (!cell || boardEl.classList.contains('is-mobile-layout')) {
				clearActiveAxis();
				return;
			}
			const columnHeader = cell.dataset.kanbanStatusId
				? columnHeaderByStatusId.get(cell.dataset.kanbanStatusId) ?? null
				: null;
			const laneLabel = cell.dataset.kanbanLaneKey
				? laneLabelByKey.get(cell.dataset.kanbanLaneKey) ?? null
				: null;
			if (columnHeader === activeColumnHeader && laneLabel === activeLaneLabel) return;
			clearActiveAxis();
			activeColumnHeader = columnHeader;
			activeLaneLabel = laneLabel;
			activeColumnHeader?.addClass('is-axis-active');
			activeLaneLabel?.addClass('is-axis-active');
		};

		const isLeavingCell = (cell: HTMLElement, relatedTarget: EventTarget | null): boolean => {
			const relatedEl = resolveElementFromTarget(relatedTarget);
			return !relatedEl || !cell.contains(relatedEl);
		};

		const isPointerInsideCellRect = (event: PointerEvent, cell: HTMLElement): boolean => {
			const rect = cell.getBoundingClientRect();
			return event.clientX >= rect.left
				&& event.clientX <= rect.right
				&& event.clientY >= rect.top
				&& event.clientY <= rect.bottom;
		};

		const resolveCellFromPointer = (event: PointerEvent): HTMLElement | null => {
			const hoveredEl = boardEl.ownerDocument.elementFromPoint(event.clientX, event.clientY);
			return resolveCellFromTarget(hoveredEl);
		};

		const resolveCellFromDrag = (event: DragEvent): HTMLElement | null => {
			const targetCell = resolveCellFromTarget(event.target);
			if (targetCell) return targetCell;
			const hoveredEl = boardEl.ownerDocument.elementFromPoint(event.clientX, event.clientY);
			return resolveCellFromTarget(hoveredEl);
		};

		const shouldIgnoreFocusAxis = (): boolean => isKanbanMobilePlatform()
			|| (lastTouchLikeAxisPointerAt > 0 && Date.now() - lastTouchLikeAxisPointerAt < 800);

		boardEl.addEventListener('pointerdown', event => {
			if (isTouchLikeAxisPointer(event)) {
				lastTouchLikeAxisPointerAt = Date.now();
				clearActiveAxis();
				return;
			}
			lastTouchLikeAxisPointerAt = 0;
		}, { capture: true });
		boardEl.addEventListener('pointerover', event => {
			if (isTouchLikeAxisPointer(event)) return;
			activateCellAxis(resolveCellFromTarget(event.target));
		});
		boardEl.addEventListener('pointerout', event => {
			if (isTouchLikeAxisPointer(event)) return;
			const cell = resolveCellFromTarget(event.target);
			if (!cell || !isLeavingCell(cell, event.relatedTarget)) return;
			if (isPointerInsideCellRect(event, cell)) return;
			const nextCell = resolveCellFromTarget(event.relatedTarget) ?? resolveCellFromPointer(event);
			if (nextCell) {
				activateCellAxis(nextCell);
				return;
			}
			clearActiveAxis();
		});
		boardEl.addEventListener('operon-kanban-axis-activate', event => {
			const customEvent = event as CustomEvent<{ cell?: unknown }>;
			const cell = asHTMLElement(customEvent.detail?.cell, boardEl);
			activateCellAxis(cell && boardEl.contains(cell) ? cell : resolveCellFromTarget(event.target));
		});
		boardEl.addEventListener('focusin', event => {
			if (shouldIgnoreFocusAxis()) {
				clearActiveAxis();
				return;
			}
			activateCellAxis(resolveCellFromTarget(event.target));
		});
		boardEl.addEventListener('focusout', event => {
			const cell = resolveCellFromTarget(event.target);
			if (!cell || !isLeavingCell(cell, event.relatedTarget)) return;
			const nextCell = resolveCellFromTarget(event.relatedTarget);
			if (nextCell) {
				activateCellAxis(nextCell);
				return;
			}
			clearActiveAxis();
		});
		boardEl.addEventListener('dragstart', event => {
			if (event.defaultPrevented) {
				clearActiveAxis();
				return;
			}
			activateCellAxis(resolveCellFromDrag(event));
		});
		boardEl.addEventListener('dragover', event => {
			if (!this.draggedCardContext) return;
			const dragCell = resolveCellFromDrag(event);
			if (!dragCell) return;
			activateCellAxis(dragCell);
		});
		boardEl.addEventListener('dragend', clearActiveAxis);
		boardEl.addEventListener('drop', clearActiveAxis);
		boardEl.addEventListener('pointercancel', clearActiveAxis);
		boardEl.addEventListener('operon-kanban-axis-clear', clearActiveAxis);
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
		allTasks: IndexedTask[],
		taskLookup: CompactTaskLookupContext | undefined,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
		readOnlyChips: boolean,
		isPreview: boolean,
		depth: number,
	): HTMLElement {
		const card = container.createDiv('operon-kanban-card');
		const dropPending = !isPreview && this.cardOperations.isTaskPending(task.operonId);
		card.dataset.operonTaskId = task.operonId;
		card.dataset.kanbanLaneKey = laneKey;
		card.dataset.kanbanStatusValue = task.fieldValues['status'] ?? '';
		card.dataset.kanbanPreview = isPreview ? 'true' : 'false';
		if (statusId) {
			card.dataset.kanbanStatusId = statusId;
		}
		card.classList.toggle('is-readonly-preview', isPreview);
		card.classList.toggle('is-done', task.checkbox === 'done');
		card.classList.toggle('is-cancelled', task.checkbox === 'cancelled');
		card.classList.toggle('is-drop-pending', dropPending);
		if (dropPending) card.setAttr('aria-busy', 'true');
		card.style.setProperty('--operon-kanban-preview-depth', String(depth));
		this.applyTaskColor(card, task, preset, workflowStatusIdentityIndex);

		if (isPreview && depth > 0) {
			card.addClass('is-nested-preview');
		}
		if (!isPreview) {
			this.renderCardImage(card, task, preset);
		}

		const head = card.createDiv('operon-kanban-card-head');
		const hoverTrigger = head.createSpan('operon-calendar-hover-menu-trigger');
		this.renderStatusButton(
			hoverTrigger,
			task,
			pipeline,
			preset,
			statusId,
			laneKey,
			workflowStatusIdentityIndex,
		);
		const titleText = task.description || task.operonId;
		const titleEl = head.createSpan({
			cls: 'operon-kanban-card-title',
		});
		renderCompactTaskMarkdown(titleEl, {
			app: this.app,
			value: titleText,
			sourcePath: task.primary.filePath,
			mode: 'interactive',
			containerClassName: 'operon-task-description-markdown',
		});
		const hasInteractiveDescriptionLink = !!titleEl.querySelector('a.internal-link, a.external-link');
		if (!hasInteractiveDescriptionLink && task.primary.format === 'yaml') {
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
			this.renderCardNotePreview(card, task);
			const progressTracks = this.buildCardProgressTracks(task);
			this.renderCardProgressTracks(
				card,
				task,
				preset,
				pipeline,
				statusId,
				workflowStatusIdentityIndex,
				progressTracks,
				'subtasks',
				'is-body',
			);
			const chipRow = buildKanbanTaskChipRow(task, {
				app: this.app,
				getSettings: this.getSettings,
				onAction: this.callbacks.onItemAction,
				isTaskPinned: (operonId) => this.getPinnedCache()?.isPinned(operonId) ?? false,
				isTaskTracking: this.callbacks.isTaskTracking,
				toggleTimer: this.callbacks.toggleTimer,
				getProjectSerialDisplay: this.callbacks.getProjectSerialDisplay,
				getRepeatSkipDates: this.callbacks.getRepeatSkipDates,
				getRepeatSeriesInlineCompletionMode: this.callbacks.getRepeatSeriesInlineCompletionMode,
				updateRepeatSeriesInlineCompletionMode: this.callbacks.updateRepeatSeriesInlineCompletionMode,
				updateField: this.callbacks.updateField,
				updateFields: this.callbacks.updateFields,
				updateSubtasks: this.callbacks.updateSubtasks,
				updateDependencyField: this.callbacks.updateDependencyField,
				openEditor: (operonId) => this.callbacks.onItemAction?.(operonId, 'openEditor'),
				getTaskById: (operonId) => this.indexer.getTask(operonId),
				openNotePopover: (anchor, noteTask) => this.openTaskNotePopover(anchor, noteTask),
			}, {
				allTasks,
				taskLookup,
				workflowStatusIdentityIndex,
				owner: card,
				readOnly: readOnlyChips,
				mobileLayout: readOnlyChips,
				noteEditable: !!this.callbacks.updateFields || !!this.callbacks.updateField,
			});
			if (chipRow) card.appendChild(chipRow);
			this.renderCardProgressTracks(
				card,
				task,
				preset,
				pipeline,
				statusId,
				workflowStatusIdentityIndex,
				progressTracks,
				'checkboxes',
				'is-footer',
			);
		}

		if (!isPreview) {
			this.bindHoverMenuTarget(hoverTrigger, task);
			card.tabIndex = 0;
			card.setAttr('aria-grabbed', 'false');
			card.draggable = !dropPending;
			card.classList.toggle('is-draggable', !dropPending);
		}

		if (!isPreview && this.ensureState().expandedPreviewParentIds.includes(task.operonId)) {
			const preview = card.createDiv('operon-kanban-preview-tree');
			for (const child of this.getPreviewChildren(task.operonId)) {
				this.renderPreviewNode(
					preview,
					child,
					preset,
					pipeline,
					workflowStatusIdentityIndex,
					depth + 1,
				);
			}
		}
		return card;
	}

	private renderCardImage(card: HTMLElement, task: IndexedTask, preset: KanbanPreset): void {
		const resolved = resolveKanbanCardImageReference(task.fieldValues, preset.cardImageSource);
		if (!resolved?.target) return;

		let imageSource: string | null = null;
		if (resolved.kind === 'http-url') {
			imageSource = resolved.target;
		} else {
			const file = this.app.metadataCache.getFirstLinkpathDest(resolved.target, task.primary.filePath);
			if (file instanceof TFile) imageSource = this.app.vault.getResourcePath(file);
		}
		if (!imageSource) return;

		const imageWrap = card.createDiv('operon-kanban-card-image');
		const image = imageWrap.createEl('img', {
			attr: {
				alt: '',
				decoding: 'async',
				loading: 'lazy',
				referrerpolicy: 'no-referrer',
			},
		});
		image.draggable = false;
		const refreshSettledLayout = (): void => {
			const cell = card.closest<HTMLElement>('.operon-kanban-cell');
			if (cell) this.scheduleBoardLayoutRefreshFromCell(cell);
		};
		image.addEventListener('load', refreshSettledLayout, { once: true });
		image.addEventListener('error', () => {
			imageWrap.remove();
			refreshSettledLayout();
		}, { once: true });
		image.src = imageSource;
	}

	private renderCardNotePreview(card: HTMLElement, task: IndexedTask): void {
		const settings = this.getSettings();
		if (settings.kanbanTaskShowNotesPreview !== true) return;
		const noteValue = task.fieldValues['note']?.trim() ?? '';
		if (!noteValue) return;

		const preview = card.createEl('button', {
			cls: 'operon-kanban-card-note-preview',
			attr: { type: 'button' },
		});
		preview.draggable = false;
		bindKanbanNotePreviewDragShield(preview);
		const icon = preview.createSpan('operon-kanban-card-note-preview-icon');
		setIcon(icon, getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen');
		const noteText = preview.createSpan('operon-kanban-card-note-preview-text');
		renderCompactTaskMarkdown(noteText, {
			value: noteValue,
			mode: 'visual-only',
		});

		setAccessibleLabelWithoutTooltip(preview, `${t('taskEditor', 'notes')}: ${noteValue}`);
		const openPopover = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			this.openTaskNotePopover(preview, task);
		};

		preview.addEventListener('pointerdown', event => {
			event.stopPropagation();
		});
		preview.addEventListener('dragstart', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		preview.addEventListener('click', openPopover);
		preview.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'F2') return;
			openPopover(event);
		});
	}

	private openTaskNotePopover(
		anchor: HTMLElement | DOMRect,
		task: IndexedTask,
		openerSelector?: string,
	): void {
		const anchorEl = asHTMLElement(anchor);
		const resolvedOpenerSelector = openerSelector
			?? (anchorEl?.matches('.operon-kanban-card-note-preview')
				? '.operon-kanban-card-note-preview'
				: '.operon-kanban-card-action-chip.is-note-action');
		if (
			this.activeTaskNotePopoverClose
			&& this.activeTaskNotePopoverTaskId
			&& this.activeTaskNotePopoverTaskId !== task.operonId
		) {
			const rect = anchorEl ? anchorEl.getBoundingClientRect() : anchor as DOMRect;
			this.pendingTaskNoteOpen = { anchor: rect, task, openerSelector: resolvedOpenerSelector };
			this.requestActiveTaskNotePopoverClose(false);
			return;
		}
		this.taskNoteShouldReturnFocus = true;
		const closePopover = showTaskNotePopover({
			app: this.app,
			anchor,
			operonId: task.operonId,
			sourcePath: task.primary.filePath,
			lifecycleOwner: this.contentEl,
			initialValue: task.fieldValues['note'] ?? '',
			taskDescription: task.description,
			taskColor: normalizeTaskFieldColor(task.fieldValues['taskColor']),
			onCommit: nextValue => {
				if (this.callbacks.updateFields) {
					return this.callbacks.updateFields(task.operonId, { note: nextValue });
				}
				if (this.callbacks.updateField) {
					return this.callbacks.updateField(task.operonId, 'note', nextValue);
				}
				return false;
			},
			onFocusReturn: () => {
				if (this.activeTaskNotePopoverClose === closePopover) {
					this.activeTaskNotePopoverClose = null;
					this.activeTaskNotePopoverTaskId = null;
				}
				const pending = this.pendingTaskNoteOpen;
				this.pendingTaskNoteOpen = null;
				if (pending) {
					this.openTaskNotePopover(pending.anchor, pending.task, pending.openerSelector);
					return;
				}
				if (this.taskNoteShouldReturnFocus) {
					this.restoreTaskNoteTriggerFocus(task.operonId, resolvedOpenerSelector);
				}
				this.taskNoteShouldReturnFocus = true;
			},
		});
		this.activeTaskNotePopoverClose = closePopover;
		this.activeTaskNotePopoverTaskId = task.operonId;
	}

	private restoreTaskNoteTriggerFocus(operonId: string, openerSelector: string): void {
		const card = this.contentEl.querySelector<HTMLElement>(
			`.operon-kanban-card[data-operon-task-id="${CSS.escape(operonId)}"]`,
		);
		const trigger = card?.querySelector<HTMLElement>(openerSelector);
		if (trigger?.isConnected) {
			trigger.focus();
			return;
		}
		const board = this.contentEl.querySelector<HTMLElement>('.operon-kanban-board');
		if (!board) return;
		if (board.tabIndex < 0) board.tabIndex = -1;
		board.focus();
	}

	private closeTaskNotePopoverForUserScroll(): void {
		if (this.taskNoteScrollSuppressionFrame !== null) return;
		this.requestActiveTaskNotePopoverClose(false);
	}

	private requestActiveTaskNotePopoverClose(returnFocus: boolean): void {
		this.taskNoteShouldReturnFocus = returnFocus;
		this.activeTaskNotePopoverClose?.();
	}

	private suppressTaskNoteScrollCloseForFrame(owner: HTMLElement): void {
		const ownerWindow = getOwnerWindow(owner);
		const current = this.taskNoteScrollSuppressionFrame;
		if (current) current.win.cancelAnimationFrame(current.id);
		const id = ownerWindow.requestAnimationFrame(() => {
			if (this.taskNoteScrollSuppressionFrame?.id === id) {
				this.taskNoteScrollSuppressionFrame = null;
			}
		});
		this.taskNoteScrollSuppressionFrame = { win: ownerWindow, id };
	}

	private renderPreviewNode(
		container: HTMLElement,
		task: IndexedTask,
		preset: KanbanPreset,
		pipeline: Pipeline | null,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
		depth: number,
	): void {
		this.renderTaskCard(
			container,
			task,
			pipeline,
			preset,
			null,
			KANBAN_NO_VALUE_KEY,
			[],
			undefined,
			workflowStatusIdentityIndex,
			true,
			true,
			depth,
		);
		const children = this.getPreviewChildren(task.operonId);
		if (children.length === 0) return;
		const childrenWrap = container.createDiv('operon-kanban-preview-children');
		for (const child of children) {
			this.renderPreviewNode(
				childrenWrap,
				child,
				preset,
				pipeline,
				workflowStatusIdentityIndex,
				depth + 1,
			);
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

	private buildDescendantSummary(parentId: string): TaskProgressDescendantSummary {
		const generation = this.indexer.getGeneration();
		if (this.lastDescendantSummaryCacheGeneration !== generation) {
			this.descendantSummaryCache.clear();
			this.lastDescendantSummaryCacheGeneration = generation;
		}
		const cached = this.descendantSummaryCache.get(parentId);
		if (cached?.generation === generation) {
			return { done: cached.done, open: cached.open, total: cached.total };
		}
		const parentTask = this.indexer.getTask(parentId);
		const resolvedSummary = parentTask
			? resolveTaskProgressDescendantSummary(parentTask, {
				getTask: operonId => this.indexer.getTask(operonId),
				getAllDescendantIds: operonId => this.indexer.secondary.getAllDescendantIds(operonId),
			})
			: { done: 0, open: 0, total: 0 };
		const summary = { generation, ...resolvedSummary };
		this.descendantSummaryCache.set(parentId, summary);
		return { done: summary.done, open: summary.open, total: summary.total };
	}

	private renderCardProgressTracks(
		card: HTMLElement,
		task: IndexedTask,
		preset: KanbanPreset,
		pipeline: Pipeline | null,
		statusId: string | null,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
		tracks: TaskProgressTrack[],
		kind: TaskProgressTrack['kind'],
		placementClass: string,
	): void {
		const visibleTracks = tracks.filter(track => track.kind === kind);
		if (visibleTracks.length === 0) return;

		const wrap = card.createDiv('operon-kanban-card-progress');
		wrap.addClass(placementClass);
		const color = this.resolveCardProgressColor(
			task,
			preset,
			pipeline,
			statusId,
			workflowStatusIdentityIndex,
		);
		if (color) {
			wrap.style.setProperty('--operon-kanban-card-progress-color', color);
		}

		for (const track of visibleTracks) {
			this.renderCardProgressTrack(wrap, task, track, color);
		}
	}

	private buildCardProgressTracks(task: IndexedTask): TaskProgressTrack[] {
		const settings = this.getSettings();
		return buildTaskProgressTracks({
			includeSubtasks: settings.kanbanTaskShowSubtaskProgress,
			includeCheckboxes: settings.kanbanTaskShowPlainCheckboxProgress,
			descendantSummary: settings.kanbanTaskShowSubtaskProgress ? this.buildDescendantSummary(task.operonId) : null,
			plainCheckboxProgress: task.plainCheckboxProgress,
		});
	}

	private renderCardProgressTrack(
		container: HTMLElement,
		task: IndexedTask,
		track: TaskProgressTrack,
		taskColor: string | null,
	): void {
		const actionContext = this.resolveCardProgressActionContext(task, track);
		const actionable = !!actionContext;
		const el = renderTaskProgressHorizontalTrack(container, track, {
			className: 'operon-kanban-card-progress-track',
			interactive: actionable,
		});
		setAccessibleLabelWithoutTooltip(el, `${track.title}: ${track.tooltip}`);
		bindOperonHoverTooltip(el, {
			title: track.title,
			content: track.tooltip,
			taskColor,
		});

		if (!isKanbanButtonElement(el)) return;
		el.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		el.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			const context = this.resolveCardProgressActionContext(task, track);
			if (!context) return;
			void this.callbacks.onItemAction?.(task.operonId, this.getCardProgressActionId(track), context, {
				actionAnchor: el,
				actionAnchorRect: el.getBoundingClientRect(),
			});
		});
	}

	private resolveCardProgressActionContext(
		task: IndexedTask,
		track: TaskProgressTrack,
	): ContextualMenuContext | null {
		if (!this.callbacks.onItemAction) return null;
		if (track.kind === 'subtasks' && task.checkbox !== 'open') return null;
		const context = this.resolveHoverContext(task);
		const actionId = this.getCardProgressActionId(track);
		if (actionId === 'subtasks') context.hasSubtasks = true;
		return context;
	}

	private getCardProgressActionId(track: TaskProgressTrack): ContextualMenuActionId {
		return track.kind === 'subtasks' ? 'subtasks' : 'checkboxes';
	}

	private resolveCardProgressColor(
		task: IndexedTask,
		preset: KanbanPreset,
		pipeline: Pipeline | null,
		statusId: string | null,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
	): string | null {
		if (preset.colorSource === 'noColor') {
			return this.resolveCardProgressStatusColor(
				task,
				pipeline,
				statusId,
				workflowStatusIdentityIndex,
			);
		}
		return resolveTaskColorSourceForTask(
			task,
			preset.colorSource,
			this.getSettings(),
			workflowStatusIdentityIndex,
		);
	}

	private resolveCardProgressStatusColor(
		task: IndexedTask,
		pipeline: Pipeline | null,
		statusId: string | null,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
	): string | null {
		if (pipeline && statusId) {
			const status = pipeline.statuses.find(candidate => candidate.id === statusId);
			if (status?.color) return status.color;
		}
		return findStatusDef(
			this.getSettings().pipelines,
			task.fieldValues['status'] ?? '',
			workflowStatusIdentityIndex,
		)?.color ?? null;
	}

	private reconcileOptimisticMoves(board: KanbanBoardData, pipeline: Pipeline | null, preset: KanbanPreset): void {
		if (this.optimisticMoves.size === 0) {
			this.clearOptimisticMoveExpiryTimer();
			return;
		}
		const now = Date.now();
		const boardSignature = buildKanbanDropBoardSignature(board.preset, board.pipeline);
		for (const [taskId, move] of this.optimisticMoves) {
			if (Number.isFinite(move.expiresAt) && move.expiresAt < now) {
				this.optimisticMoves.delete(taskId);
				continue;
			}
			if (move.presetId && move.presetId !== preset.id) continue;
			if (move.boardSignature && move.boardSignature !== boardSignature) continue;
			const task = this.indexer.getTask(taskId);
			if (!task || !pipeline) {
				this.optimisticMoves.delete(taskId);
				continue;
			}
			if (isKanbanOptimisticMoveSatisfied(
				task,
				pipeline,
				preset,
				move,
				this.getSettings().keyMappings,
				this.getSettings().pipelines,
				this.getSettings().priorities,
			)) {
				this.optimisticMoves.delete(taskId);
			}
		}
		this.scheduleOptimisticMoveExpiryRender();
	}

	clearOptimisticMove(taskId: string, operationId?: string, renderImmediately = false): void {
		const move = this.optimisticMoves.get(taskId);
		if (operationId && move?.operationId !== operationId) return;
		if (!this.optimisticMoves.delete(taskId)) return;
		if (renderImmediately && this.containerEl.isConnected) {
			this.lastRenderSignature = null;
			this.render();
			return;
		}
		this.markDirty();
	}

	private scheduleOptimisticMoveExpiryRender(): void {
		this.clearOptimisticMoveExpiryTimer();
		let nextExpiresAt = Number.POSITIVE_INFINITY;
		for (const move of this.optimisticMoves.values()) {
			if (Number.isFinite(move.expiresAt)) {
				nextExpiresAt = Math.min(nextExpiresAt, move.expiresAt);
			}
		}
		if (!Number.isFinite(nextExpiresAt)) return;
		const ownerWindow = getOwnerWindow(this.contentEl);
		this.optimisticMoveExpiryTimer = {
			win: ownerWindow,
			id: ownerWindow.setTimeout(() => {
				this.optimisticMoveExpiryTimer = null;
				this.lastRenderSignature = null;
				this.markDirty();
			}, Math.max(0, nextExpiresAt - Date.now() + 1)),
		};
	}

	private clearOptimisticMoveExpiryTimer(): void {
		if (this.optimisticMoveExpiryTimer === null) return;
		this.optimisticMoveExpiryTimer.win.clearTimeout(this.optimisticMoveExpiryTimer.id);
		this.optimisticMoveExpiryTimer = null;
	}

	private applyOptimisticMoves(board: KanbanBoardData, settings: OperonSettings): void {
		const boardSignature = buildKanbanDropBoardSignature(board.preset, board.pipeline);
		const moves = Array.from(this.optimisticMoves.values())
			.filter(move => !move.presetId || move.presetId === board.preset.id)
			.filter(move => !move.boardSignature || move.boardSignature === boardSignature);
		applyKanbanOptimisticMovesToBoard(board, settings.priorities, moves, settings.keyMappings);
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
			this.materializeKanbanCellIfPending(cell);
			this.hideCellQuickAdd(cell);
			cell.addClass('is-drop-target');
			this.updateManualDropIndicator(cell, event, preset);
		});
		cell.addEventListener('dragover', event => {
			if (!this.draggedCardContext) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
			this.materializeKanbanCellIfPending(cell);
			this.hideCellQuickAdd(cell);
			cell.addClass('is-drop-target');
			this.updateManualDropIndicator(cell, event, preset);
		});
		cell.addEventListener('dragleave', event => {
			const related = asHTMLElement(event.relatedTarget, cell);
			if (related && cell.contains(related)) return;
			if (this.pendingManualDropIndicatorUpdate?.cell === cell) {
				this.pendingManualDropIndicatorUpdate = null;
			}
			cell.removeClass('is-drop-target');
			this.clearManualDropIndicator(cell);
		});
		cell.addEventListener('drop', event => {
			if (!this.draggedCardContext || !this.callbacks.onCardDrop) return;
			event.preventDefault();
			this.hideCellQuickAdd(cell);
			cell.removeClass('is-drop-target');
			const dragged = this.draggedCardContext;
			const targetBeforeTaskId = resolveKanbanEffectiveSorting(preset, column.statusId).sortMode === 'manual'
				? this.resolveManualDropBeforeTaskId(cell, event, preset)
				: null;
			const context: KanbanDropContext = {
				taskId: dragged.taskId,
				sourceStatusId: dragged.sourceStatusId,
				sourceStatusValue: dragged.sourceStatusValue,
				sourceLaneKey: dragged.sourceLaneKey,
				boardSignature: dragged.boardSignature,
				targetStatusId: column.statusId,
				targetLaneKey: lane.key,
				swimlaneBy: preset.swimlaneBy,
				targetBeforeTaskId,
			};
			this.completeKanbanCardDrop(cell, dragged, context, targetBeforeTaskId, preset);
		});
	}

	private updateManualDropIndicator(cell: HTMLElement, event: DragEvent, preset: KanbanPreset): void {
		// dragover fires far more often than frames paint; throttle the card
		// rect scans to one indicator update per animation frame.
		this.pendingManualDropIndicatorUpdate = { cell, pointerY: event.clientY, preset };
		if (this.manualDropIndicatorFrame !== null) return;
		const ownerWindow = getOwnerWindow(cell);
		this.manualDropIndicatorFrame = {
			win: ownerWindow,
			id: ownerWindow.requestAnimationFrame(() => {
				this.manualDropIndicatorFrame = null;
				const pending = this.pendingManualDropIndicatorUpdate;
				this.pendingManualDropIndicatorUpdate = null;
				if (!pending || !this.draggedCardContext || !pending.cell.isConnected) return;
				this.updateManualDropIndicatorAt(pending.cell, pending.pointerY, pending.preset);
			}),
		};
	}

	private cancelPendingManualDropIndicatorUpdate(): void {
		this.pendingManualDropIndicatorUpdate = null;
		if (this.manualDropIndicatorFrame === null) return;
		this.manualDropIndicatorFrame.win.cancelAnimationFrame(this.manualDropIndicatorFrame.id);
		this.manualDropIndicatorFrame = null;
	}

	private updateManualDropIndicatorAt(cell: HTMLElement, pointerY: number, preset: KanbanPreset): void {
		const statusId = cell.dataset.kanbanStatusId ?? null;
		if (resolveKanbanEffectiveSorting(preset, statusId).sortMode !== 'manual' || cell.classList.contains('is-collapsed')) {
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
		freezeRefreshUntilSettled = false,
		onSettled?: (outcome: 'succeeded' | 'failed' | 'cancelled') => void,
	): void {
		this.draggedCardContext = null;
		const dropBaseBoard = this.lastRenderedBoard;
		const dropBaseScope = this.lastRenderedBoardScope;
		const dropBaseTaskSignatures = this.lastRenderedBoardTaskSignatures;
		let settledInPlace = false;
		const notifySettlement = (outcome: 'succeeded' | 'failed' | 'cancelled'): void => {
			try {
				onSettled?.(outcome);
			} catch (error) {
				console.warn('Operon: Kanban drop settlement callback failed', error);
			}
		};
		const applyImmediateDrop = shouldApplyImmediateKanbanCardDrop(targetCell.classList.contains('is-collapsed'));
		const dropViewportAnchor = this.beginDropScrollAnchor(targetCell, context);
		this.materializeKanbanCellIfPending(targetCell);
		targetCell.removeClass('is-drop-target');
		this.clearManualDropIndicator(targetCell);
		if (
			resolveKanbanEffectiveSorting(preset, context.targetStatusId).sortMode !== 'manual'
			&& context.sourceStatusId === context.targetStatusId
			&& context.sourceLaneKey === context.targetLaneKey
		) {
			dragged.cardEl.removeClass('is-dragging');
			this.settleDropViewportAnchor(dropViewportAnchor, 'succeeded');
			this.endKanbanDragInteraction();
			notifySettlement('succeeded');
			return;
		}
		if (!this.callbacks.onCardDrop) {
			dragged.cardEl.removeClass('is-dragging');
			this.settleDropViewportAnchor(dropViewportAnchor, 'cancelled');
			this.endKanbanDragInteraction();
			notifySettlement('cancelled');
			return;
		}
		const operation = this.cardOperations.begin(
			context.taskId,
			preset.id,
			'drop',
			context.boardSignature ?? this.resolveKanbanDropBoardSignature(preset),
		);
		if (!operation) {
			dragged.cardEl.removeClass('is-dragging');
			this.settleDropViewportAnchor(dropViewportAnchor, 'cancelled');
			this.endKanbanDragInteraction();
			notifySettlement('cancelled');
			return;
		}
		const operationContext: KanbanDropContext = {
			...context,
			operationId: operation.id,
			presetId: preset.id,
			boardSignature: operation.boardSignature,
		};
		dragged.cardEl.addClass('is-drop-pending');
		dragged.cardEl.setAttr('aria-busy', 'true');
		dragged.cardEl.draggable = false;
		this.registerOptimisticMove(operationContext);
		if (applyImmediateDrop) {
			this.applyImmediateCardDrop(targetCell, dragged.cardEl, targetBeforeTaskId);
		} else {
			dragged.cardEl.removeClass('is-dragging');
		}
		if (freezeRefreshUntilSettled) this.mobileDropPersistenceGate.begin();
		void Promise.resolve()
			.then(() => this.callbacks.onCardDrop?.(operationContext))
			.then(result => {
				const outcome = classifyKanbanDropCallbackSettlement(result);
				const currentPreset = this.resolveCurrentPreset();
				if (this.cardOperations.isUiCurrent(
					operation,
					currentPreset.id,
					this.resolveKanbanDropBoardSignature(currentPreset),
				)) {
					settledInPlace = this.settleKanbanDropDomInPlace(
						dropBaseBoard,
						dropBaseScope,
						dropBaseTaskSignatures,
						operationContext,
						operation.id,
					);
				} else {
					this.deleteOptimisticMove(context.taskId, operation.id);
				}
				this.settleDropViewportAnchor(dropViewportAnchor, outcome);
				notifySettlement(outcome);
			})
			.catch(error => {
				if (!this.cardOperations.owns(operation)) return;
				const sourceSortMode = context.sourceStatusId
					? resolveKanbanEffectiveSorting(preset, context.sourceStatusId).sortMode
					: null;
				const targetSortMode = resolveKanbanEffectiveSorting(preset, context.targetStatusId).sortMode;
				console.error(
					'Operon: Kanban card drop failed',
					buildKanbanDropFailureDiagnostic({
						taskId: context.taskId,
						presetId: preset.id,
						sourceStatusId: context.sourceStatusId,
						targetStatusId: context.targetStatusId,
						sourceLaneKey: context.sourceLaneKey,
						targetLaneKey: context.targetLaneKey,
						sourceSortMode,
						targetSortMode,
						error,
					}),
					error,
				);
				const currentPreset = this.resolveCurrentPreset();
				if (this.cardOperations.isUiCurrent(
					operation,
					currentPreset.id,
					this.resolveKanbanDropBoardSignature(currentPreset),
				)) {
					settledInPlace = this.settleKanbanDropDomInPlace(
						dropBaseBoard,
						dropBaseScope,
						dropBaseTaskSignatures,
						operationContext,
						operation.id,
					);
					new Notice(t('notifications', 'kanbanActionFailed'));
				} else {
					this.deleteOptimisticMove(context.taskId, operation.id);
				}
				this.settleDropViewportAnchor(dropViewportAnchor, 'failed');
				notifySettlement('failed');
			})
			.finally(() => {
				const ended = this.cardOperations.end(operation);
				if (ended) this.clearDropPendingCardState(context.taskId);
				if (
					freezeRefreshUntilSettled
					&& this.mobileDropPersistenceGate.end()
				) this.callbacks.onDragInteractionEnd?.();
				if (ended && this.containerEl.isConnected && !settledInPlace) this.markDirty();
			});
		this.endKanbanDragInteraction();
	}

	private deleteOptimisticMove(taskId: string, operationId: string): boolean {
		const move = this.optimisticMoves.get(taskId);
		if (!move || move.operationId !== operationId) return false;
		this.optimisticMoves.delete(taskId);
		this.scheduleOptimisticMoveExpiryRender();
		return true;
	}

	private clearDropPendingCardState(taskId: string): void {
		for (const card of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.operon-kanban-card'))) {
			if (card.dataset.operonTaskId !== taskId) continue;
			card.removeClass('is-drop-pending', 'is-optimistic-move');
			card.removeAttribute('aria-busy');
			card.draggable = true;
		}
	}

	private settleKanbanDropDomInPlace(
		baseBoard: KanbanBoardData | null,
		baseScope: string | null,
		baseTaskSignatures: Map<string, string> | null,
		context: KanbanDropContext,
		operationId: string,
	): boolean {
		this.deleteOptimisticMove(context.taskId, operationId);
		if (!baseBoard || !baseScope || !baseTaskSignatures || baseScope !== this.buildDropScrollAnchorScope()) return false;
		const state = this.ensureState();
		const settings = this.getSettings();
		const preset = settings.kanbanPresets.find(entry => entry.id === state.presetId) ?? null;
		if (!preset || preset.id !== context.presetId || !preset.pipelineId) return false;
		const pipeline = settings.pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
		if (!pipeline || buildKanbanDropBoardSignature(preset, pipeline) !== context.boardSignature) return false;
		const boardEl = this.contentEl.querySelector<HTMLElement>('.operon-kanban-board');
		if (!boardEl || boardEl.dataset.kanbanDropBoardSignature !== context.boardSignature) return false;
		const currentFilter = this.resolveEditableKanbanFilter(preset, settings);
		const filterSet = currentFilter ? stripFilterViewOnlyOptions(currentFilter) : null;
		const parentSearchUi = this.buildParentSearchUiState(
			state.searchQuery,
			pipeline,
			filterSet,
			settings,
			this.searchScope,
		);
		const { board, searchActive } = this.queryKanbanBoardData(
			state,
			preset,
			pipeline,
			filterSet,
			settings,
			parentSearchUi,
		);
		const nextTaskSignatures = this.buildKanbanBoardTaskSignatures(board);
		if (!nextTaskSignatures) return false;
		if (!this.applyKanbanBoardPatchInPlace(
			boardEl,
			baseBoard,
			board,
			baseTaskSignatures,
			nextTaskSignatures,
			context,
			state,
			settings,
			searchActive,
		)) return false;
		this.lastRenderedBoard = board;
		this.lastRenderedBoardScope = baseScope;
		this.lastRenderedBoardTaskSignatures = nextTaskSignatures;
		this.lastRenderSignature = this.buildRenderSignature(
			this.contentEl,
			state,
			preset,
			pipeline,
			filterSet,
			settings,
			parentSearchUi,
		);
		return true;
	}

	private applyKanbanBoardPatchInPlace(
		boardEl: HTMLElement,
		previous: KanbanBoardData,
		next: KanbanBoardData,
		previousTaskSignatures: Map<string, string>,
		nextTaskSignatures: Map<string, string>,
		context: KanbanDropContext,
		state: KanbanLeafState,
		settings: OperonSettings,
		searchActive: boolean,
	): boolean {
		const previousColumnIds = previous.columns.map(column => column.statusId);
		const nextColumnIds = next.columns.map(column => column.statusId);
		if (!this.areStringArraysEqual(previousColumnIds, nextColumnIds)) return false;
		const previousLaneKeys = previous.lanes.map(lane => lane.key);
		const nextLaneKeys = next.lanes.map(lane => lane.key);
		const survivingPreviousLaneKeys = previousLaneKeys.filter(key => nextLaneKeys.includes(key));
		if (!this.areStringArraysEqual(survivingPreviousLaneKeys, nextLaneKeys)) return false;

		const gridViewport = boardEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
		if (!gridViewport) return false;
		this.captureCellScrollStates(gridViewport);
		const forcedCellKeys = [buildKanbanCellKey(context.targetStatusId, context.targetLaneKey)];
		if (context.sourceStatusId !== null) forcedCellKeys.push(buildKanbanCellKey(context.sourceStatusId, context.sourceLaneKey));
		const changedCellKeys = collectKanbanInPlaceChangedCellKeys({
			previousCellMap: previous.cellMap,
			nextCellMap: next.cellMap,
			previousCellCountMap: previous.cellCountMap,
			nextCellCountMap: next.cellCountMap,
			previousTaskSignatures,
			nextTaskSignatures,
			forcedCellKeys,
		});
		const nextLaneKeySet = new Set(nextLaneKeys);
		const nextColumns = new Map(next.columns.map(column => [column.statusId, column] as const));
		const nextLanes = new Map(next.lanes.map(lane => [lane.key, lane] as const));
		const collapsedStatusIds = this.resolveCollapsedStatusIds(next, state, searchActive);
		const collapsedLaneKeys = this.resolveCollapsedLaneKeys(next, state, searchActive);
		const allTasks = this.indexer.getAllTasks();
		const taskLookup = createCompactTaskLookup(allTasks);
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(settings.pipelines);
		const readOnlyChips = boardEl.classList.contains('is-mobile-layout');
		const finalizers: KanbanCellRenderFinalizer[] = [];
		const changedRows = new Set<HTMLElement>();

		for (const cellKey of changedCellKeys) {
			const separator = cellKey.indexOf('::');
			if (separator < 0) return false;
			const statusId = cellKey.slice(0, separator);
			const laneKey = cellKey.slice(separator + 2);
			if (!nextLaneKeySet.has(laneKey)) continue;
			const column = nextColumns.get(statusId);
			const lane = nextLanes.get(laneKey);
			const cell = this.findKanbanCell(boardEl, statusId, laneKey);
			if (!column || !lane || !cell) return false;
			const row = cell.closest<HTMLElement>('.operon-kanban-row');
			if (row) changedRows.add(row);
			const tasks = next.cellMap.get(cellKey) ?? [];
			const taskCount = next.cellCountMap.get(cellKey) ?? tasks.length;
			const isCollapsed = collapsedStatusIds.has(statusId)
				|| collapsedLaneKeys.has(laneKey)
				|| (searchActive && taskCount === 0);
			cell.classList.toggle('is-collapsed', isCollapsed);
			if (isCollapsed) {
				this.unobserveKanbanCellContent(cell);
				this.pendingCellMaterializers.delete(cell);
				this.clearCellQuickAdd(cell);
				cleanupOperonHoverTooltips(cell);
				this.renderCollapsedCellSummary(cell, taskCount);
				delete cell.dataset.kanbanVisibleCount;
				continue;
			}
			const materialize = this.createKanbanCellMaterializer(
				cell,
				tasks,
				taskCount,
				next,
				column,
				lane,
				allTasks,
				taskLookup,
				workflowStatusIdentityIndex,
				readOnlyChips,
			);
			if (this.pendingCellMaterializers.has(cell)) {
				this.pendingCellMaterializers.set(cell, materialize);
				const estimatedHeightPx = estimateKanbanCellPlaceholderHeightPx({
					taskCount: tasks.length,
					maxVisibleTasks: settings.kanbanMaxVisibleTasksPerCell,
					renderBatchSize: KANBAN_CARD_RENDER_BATCH_SIZE,
					cardHeightPx: KANBAN_ESTIMATED_CARD_HEIGHT_PX,
					cardGapPx: KANBAN_ESTIMATED_CARD_GAP_PX,
				});
				if (estimatedHeightPx > 0) {
					cell.style.minHeight = `${estimatedHeightPx}px`;
				} else {
					cell.style.removeProperty('min-height');
				}
				continue;
			}
			this.unobserveKanbanCellContent(cell);
			this.clearCellQuickAdd(cell);
			cleanupOperonHoverTooltips(cell);
			cell.empty();
			delete cell.dataset.kanbanVisibleCount;
			finalizers.push(materialize());
		}

		for (const finalizer of finalizers) finalizer.measure();
		for (const finalizer of finalizers) finalizer.commit();
		for (const laneKey of previousLaneKeys) {
			if (nextLaneKeySet.has(laneKey)) continue;
			const row = this.findKanbanRow(boardEl, laneKey);
			if (!row) continue;
			for (const cell of Array.from(row.querySelectorAll<HTMLElement>('.operon-kanban-cell'))) {
				this.unobserveKanbanCellContent(cell);
				this.pendingCellMaterializers.delete(cell);
				this.clearCellQuickAdd(cell);
			}
			cleanupOperonHoverTooltips(row);
			row.remove();
		}
		this.updateKanbanBoardCounts(boardEl, next, changedCellKeys);
		const connectedRows = Array.from(changedRows).filter(row => row.isConnected);
		if (connectedRows.length > 0) {
			this.syncRowCellHeights(connectedRows);
			const labels = connectedRows
				.map(row => row.querySelector<HTMLElement>(':scope > .operon-kanban-lane-label'))
				.filter((label): label is HTMLElement => label !== null);
			if (labels.length === connectedRows.length) this.syncLaneHeights(labels, connectedRows);
		}
		return true;
	}

	private buildKanbanBoardTaskSignatures(board: KanbanBoardData): Map<string, string> | null {
		const signatures = new Map<string, string>();
		for (const task of board.relevantTasks) {
			if (signatures.has(task.operonId)) return null;
			signatures.set(
				task.operonId,
				`${buildKanbanTaskStableSignature(task)}\u0001${buildKanbanTaskVolatileSignature(task, true)}`,
			);
		}
		return signatures;
	}

	private areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}

	private findKanbanRow(boardEl: HTMLElement, laneKey: string): HTMLElement | null {
		return Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-row[data-kanban-lane-key]'))
			.find(row => row.dataset.kanbanLaneKey === laneKey) ?? null;
	}

	private findKanbanCell(boardEl: HTMLElement, statusId: string, laneKey: string): HTMLElement | null {
		const row = this.findKanbanRow(boardEl, laneKey);
		return row
			? Array.from(row.querySelectorAll<HTMLElement>(':scope > .operon-kanban-cell'))
				.find(cell => cell.dataset.kanbanStatusId === statusId) ?? null
			: null;
	}

	private unobserveKanbanCellContent(cell: HTMLElement): void {
		this.clearCellLazySentinelObserver(cell);
		for (const observer of this.kanbanLazyObservers) {
			observer.unobserve(cell);
			for (const sentinel of Array.from(cell.querySelectorAll<HTMLElement>('.operon-kanban-lazy-sentinel'))) {
				observer.unobserve(sentinel);
			}
		}
	}

	private clearCellLazySentinelObserver(cell: HTMLElement): void {
		const observer = this.cellLazySentinelObservers.get(cell);
		if (!observer) return;
		observer.disconnect();
		this.forgetKanbanLazyObserver(observer);
		this.cellLazySentinelObservers.delete(cell);
	}

	private forgetKanbanLazyObserver(observer: IntersectionObserver): void {
		const index = this.kanbanLazyObservers.indexOf(observer);
		if (index >= 0) this.kanbanLazyObservers.splice(index, 1);
	}

	private updateKanbanBoardCounts(
		boardEl: HTMLElement,
		board: KanbanBoardData,
		changedCellKeys: ReadonlySet<string>,
	): void {
		const corner = boardEl.querySelector<HTMLElement>('.operon-kanban-corner-cell');
		if (corner) this.renderCornerSummary(corner, board.relevantTasks.length);
		const changedStatusIds = new Set<string>();
		const changedLaneKeys = new Set<string>();
		for (const cellKey of changedCellKeys) {
			const separator = cellKey.indexOf('::');
			if (separator < 0) continue;
			changedStatusIds.add(cellKey.slice(0, separator));
			changedLaneKeys.add(cellKey.slice(separator + 2));
		}
		const columns = new Map(board.columns.map(column => [column.statusId, column] as const));
		for (const header of Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-column-header'))) {
			const statusId = header.dataset.kanbanStatusId;
			const column = statusId && changedStatusIds.has(statusId) ? columns.get(statusId) : null;
			if (column) header.querySelector<HTMLElement>('.operon-kanban-column-count-button')?.setText(String(column.count));
		}
		const lanes = new Map(board.lanes.map(lane => [lane.key, lane] as const));
		for (const row of Array.from(boardEl.querySelectorAll<HTMLElement>('.operon-kanban-row[data-kanban-lane-key]'))) {
			const laneKey = row.dataset.kanbanLaneKey;
			const lane = laneKey !== undefined && changedLaneKeys.has(laneKey) ? lanes.get(laneKey) : null;
			if (lane) row.querySelector<HTMLElement>('.operon-kanban-lane-count-button')?.setText(String(lane.count));
		}
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
		this.cancelPendingManualDropIndicatorUpdate();
		for (const cell of Array.from(root.querySelectorAll<HTMLElement>('.operon-kanban-cell'))) {
			cell.removeClass('is-drop-target');
			this.clearManualDropIndicator(cell);
		}
	}

	private clearManualDropIndicator(cell: HTMLElement): void {
		cell.querySelector<HTMLElement>(':scope > .operon-kanban-drop-indicator')?.remove();
		delete cell.dataset.kanbanDropBeforeTaskId;
	}

	private applyImmediateCardDrop(targetCell: HTMLElement, cardEl: HTMLElement, beforeTaskId: string | null): void {
		if (!cardEl.isConnected) return;
		const sourceCell = cardEl.closest<HTMLElement>('.operon-kanban-cell');
		const sourceRow = sourceCell?.closest<HTMLElement>('.operon-kanban-row') ?? null;
		const targetRow = targetCell.closest<HTMLElement>('.operon-kanban-row');
		const targetStatusId = targetCell.dataset.kanbanStatusId;
		if (targetStatusId) {
			cardEl.dataset.kanbanStatusId = targetStatusId;
		} else {
			delete cardEl.dataset.kanbanStatusId;
		}
		const targetLaneKey = targetCell.dataset.kanbanLaneKey;
		if (targetLaneKey) {
			cardEl.dataset.kanbanLaneKey = targetLaneKey;
		}
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
		if (sourceCell && sourceCell !== targetCell) {
			const sourceCardCount = sourceCell.querySelectorAll(':scope > .operon-kanban-card').length;
			this.applyCellHeightLimit(sourceCell, this.getSettings().kanbanMaxVisibleTasksPerCell, sourceCardCount);
		}
		const boardEl = targetCell.closest<HTMLElement>('.operon-kanban-board');
		if (!boardEl) return;
		const affectedRows = Array.from(new Set([sourceRow, targetRow]))
			.filter((row): row is HTMLElement => row !== null && row.isConnected);
		this.syncRowCellHeights(affectedRows);
		const laneLabels = affectedRows
			.map(row => row.querySelector<HTMLElement>(':scope > .operon-kanban-lane-label'))
			.filter((label): label is HTMLElement => label !== null);
		if (laneLabels.length === affectedRows.length) this.syncLaneHeights(laneLabels, affectedRows);
		const gridViewport = boardEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
		if (gridViewport) this.scheduleBoardViewportAnchorRestore(gridViewport);
	}

	private registerOptimisticMove(context: KanbanDropContext): void {
		this.optimisticMoves.set(context.taskId, createKanbanDropOptimisticMove(context, {
			task: this.indexer.getTask(context.taskId),
			keyMappings: this.getSettings().keyMappings,
			priorities: this.getSettings().priorities,
		}));
		this.scheduleOptimisticMoveExpiryRender();
	}

	private bindCellQuickAdd(
		cell: HTMLElement,
		column: KanbanColumn,
		lane: KanbanLane,
		preset: KanbanPreset,
	): void {
		this.clearCellQuickAdd(cell);
		if (!this.getSettings().kanbanShowHoverAddButton) return;
		if (!this.callbacks.onCellAction) return;
		const overlay = cell.createDiv('operon-kanban-cell-add-overlay');
		const button = overlay.createEl('button', {
			cls: 'operon-kanban-cell-add-button',
			attr: {
				type: 'button',
			},
		});
		const desktopIcon = button.createSpan('operon-kanban-cell-add-icon is-desktop-icon');
		setIcon(desktopIcon, 'plus');
		if (!desktopIcon.querySelector('svg')) {
			desktopIcon.setText('+');
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
		const requestAxisHighlight = (): void => {
			const boardEl = cell.closest<HTMLElement>('.operon-kanban-board');
			if (!boardEl || boardEl.classList.contains('is-mobile-layout')) return;
			boardEl.dispatchEvent(new CustomEvent('operon-kanban-axis-activate', {
				bubbles: true,
				detail: { cell },
			}));
		};
		const clearAxisHighlight = (): void => {
			cell.closest<HTMLElement>('.operon-kanban-board')
				?.dispatchEvent(new Event('operon-kanban-axis-clear'));
		};
		button.addEventListener('pointerenter', event => {
			if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
			requestAxisHighlight();
		});
		button.addEventListener('focus', requestAxisHighlight);
		button.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			this.hideCellQuickAdd(cell);
			clearAxisHighlight();
			void this.callbacks.onCellAction?.(actionContext);
		});

		const setVisible = (nextVisible: boolean): void => {
			const isVisible = overlay.classList.contains('is-visible');
			if (isVisible === nextVisible) return;
			cell.classList.toggle('is-add-hotspot-active', nextVisible);
			overlay.classList.toggle('is-visible', nextVisible);
			if (nextVisible) {
				requestAxisHighlight();
			}
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

		const handlePointerLeave = (): void => setVisible(false);
		const handleScroll = (): void => {
			setVisible(false);
			clearAxisHighlight();
			this.closeTaskNotePopoverForUserScroll();
		};
		const handleDragStart = (): void => {
			setVisible(false);
			clearAxisHighlight();
		};
		const handleDrop = (): void => {
			setVisible(false);
			clearAxisHighlight();
		};
		cell.addEventListener('click', handleMobileCellClick);
		cell.addEventListener('pointermove', updateFromPointer);
		cell.addEventListener('pointerleave', handlePointerLeave);
		cell.addEventListener('scroll', handleScroll);
		cell.addEventListener('dragstart', handleDragStart);
		cell.addEventListener('drop', handleDrop);
		this.cellQuickAddCleanups.set(cell, () => {
			cell.removeEventListener('click', handleMobileCellClick);
			cell.removeEventListener('pointermove', updateFromPointer);
			cell.removeEventListener('pointerleave', handlePointerLeave);
			cell.removeEventListener('scroll', handleScroll);
			cell.removeEventListener('dragstart', handleDragStart);
			cell.removeEventListener('drop', handleDrop);
			overlay.remove();
			cell.classList.remove('is-add-hotspot-active');
		});
	}

	private clearCellQuickAdd(cell: HTMLElement): void {
		this.cellQuickAddCleanups.get(cell)?.();
		this.cellQuickAddCleanups.delete(cell);
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
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
	): void {
		if (!this.callbacks.onStatusIconClick) return;
		const button = container.createEl('button', {
			cls: 'operon-checkbox operon-calendar-status-button is-compact operon-kanban-status-button',
			attr: {
				type: 'button',
			},
		});
		const iconName = resolveTaskDisplayIcon(
			this.getSettings(),
			task.fieldValues,
			task.checkbox,
			workflowStatusIdentityIndex,
		);
		if (iconName) {
			setIcon(button, iconName);
		}
		setAccessibleLabelWithoutTooltip(button, t('tooltips', 'cycleTaskStatus'));
		const iconColor = resolveTaskStatusIconColorForTask(
			task,
			this.getSettings(),
			workflowStatusIdentityIndex,
		);
		if (iconColor) button.style.color = iconColor;
		else button.style.removeProperty('color');
		button.addEventListener('pointerdown', event => {
			event.preventDefault();
			event.stopPropagation();
		});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			const card = button.closest<HTMLElement>('.operon-kanban-card');
			const currentStatusId = card?.dataset.kanbanStatusId ?? statusId;
			const currentLaneKey = card?.dataset.kanbanLaneKey ?? laneKey;
			this.invokeKanbanStatusIconClick(task, pipeline, preset, currentStatusId, currentLaneKey);
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
		if (this.cardOperations.isTaskPending(task.operonId)) return;
		const startedAt = enginePerfNow();
		const plan = buildKanbanOptimisticStatusMovePlan({
			task,
			pipeline,
			preset,
			pipelines: this.getSettings().pipelines,
			keyMappings: this.getSettings().keyMappings,
			priorities: this.getSettings().priorities,
			sourceStatusId: statusId,
			sourceLaneKey: laneKey,
		});
		const operation = this.cardOperations.begin(
			task.operonId,
			preset.id,
			'status',
			buildKanbanDropBoardSignature(preset, pipeline),
		);
		if (!operation) return;
		const optimisticMove = plan.move;
		const applied = optimisticMove !== null;
		const fallbackReason = applied ? 'none' : plan.fallbackReason;
		if (optimisticMove) {
			const board = this.contentEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
			if (board) this.captureBoardViewportAnchor(board);
			this.optimisticMoves.set(task.operonId, {
				...optimisticMove,
				operationId: operation.id,
				presetId: preset.id,
				boardSignature: operation.boardSignature,
			});
			this.scheduleOptimisticMoveExpiryRender();
		}
		this.render();

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
				if (!this.cardOperations.owns(operation)) return;
				if (optimisticMove) {
					const freshTask = this.indexer.getTask(task.operonId);
					if (!freshTask || !pipeline || !isKanbanOptimisticMoveSatisfied(
						freshTask,
						pipeline,
						preset,
						optimisticMove,
						this.getSettings().keyMappings,
						this.getSettings().pipelines,
						this.getSettings().priorities,
					)) {
						this.clearOptimisticMove(task.operonId, operation.id);
					}
				}
			})
			.catch(error => {
				if (!this.cardOperations.owns(operation)) return;
				console.error('Operon: Kanban status click failed', error);
				const currentPreset = this.resolveCurrentPreset();
				if (this.cardOperations.isUiCurrent(
					operation,
					currentPreset.id,
					this.resolveKanbanDropBoardSignature(currentPreset),
				)) {
					new Notice(t('notifications', 'kanbanActionFailed'));
				}
				this.clearOptimisticMove(task.operonId, operation.id);
			})
			.finally(() => {
				const ended = this.cardOperations.end(operation);
				if (ended && this.containerEl.isConnected) this.markDirty();
			});
	}

	private applyTaskColor(
		element: HTMLElement,
		task: IndexedTask,
		preset: KanbanPreset,
		workflowStatusIdentityIndex: WorkflowStatusIdentityIndex | undefined,
	): void {
		if (preset.colorSource === 'noColor') {
			element.setCssProps({
				'--operon-calendar-accent': 'var(--background-modifier-border-hover, var(--background-modifier-border))',
			});
			element.style.removeProperty('--operon-kanban-card-chip-hover-accent');
			return;
		}
		const resolvedColor = resolveTaskColorSourceForTask(
			task,
			preset.colorSource,
			this.getSettings(),
			workflowStatusIdentityIndex,
		);
		if (!resolvedColor) {
			element.style.removeProperty('--operon-calendar-accent');
			element.style.removeProperty('--operon-kanban-card-chip-hover-accent');
			return;
		}
		element.style.setProperty('--operon-calendar-accent', resolvedColor);
		element.style.setProperty('--operon-kanban-card-chip-hover-accent', resolvedColor);
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
			settings.keyMappings,
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

	private measureLaneTitleNaturalWidths(titles: HTMLElement[]): number[] {
		const widths = new Array<number>(titles.length).fill(0);
		// Read phase: computed styles first, building detached measurers (no layout).
		const measurable: Array<{ index: number; measurer: HTMLElement }> = [];
		for (let index = 0; index < titles.length; index++) {
			const title = titles[index];
			const text = title?.textContent ?? '';
			if (!title || !text) continue;
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
			measurable.push({ index, measurer });
		}
		if (measurable.length === 0) return widths;
		// Write phase: attach all measurers at once.
		const body = getOwnerBody(titles[measurable[0].index]);
		for (const entry of measurable) {
			body.appendChild(entry.measurer);
		}
		// Read phase: one forced layout for every title width.
		for (const entry of measurable) {
			widths[entry.index] = entry.measurer.getBoundingClientRect().width;
		}
		for (const entry of measurable) {
			entry.measurer.remove();
		}
		return widths;
	}

	private refreshLaneColumnWidth(boardEl: HTMLElement, laneTitles: HTMLElement[]): void {
		if (boardEl.classList.contains('is-mobile-swimlane-overlay') && this.lastLaneColumnWidthPx !== null) {
			boardEl.style.setProperty('--operon-kanban-lane-column-width', `${clampKanbanLaneColumnWidth(this.lastLaneColumnWidthPx)}px`);
			return;
		}
		const firstLabel = boardEl.querySelector<HTMLElement>('.operon-kanban-lane-label');
		const countButton = boardEl.querySelector<HTMLElement>('.operon-kanban-lane-count-button');
		if (!firstLabel || !countButton || laneTitles.length === 0) {
			this.lastLaneColumnWidthPx = KANBAN_LANE_COLUMN_MIN_WIDTH_PX;
			boardEl.setCssProps({ '--operon-kanban-lane-column-width': `${KANBAN_LANE_COLUMN_MIN_WIDTH_PX}px` });
			return;
		}
		const computed = window.getComputedStyle(firstLabel);
		const countWidth = countButton.getBoundingClientRect().width;
		const laneMetrics = laneTitles.map(title => {
			const label = title.parentElement;
			const labelComputed = label ? window.getComputedStyle(label) : computed;
			return {
				collapsed: label?.classList.contains('is-collapsed') === true,
				gap: Number.parseFloat(labelComputed.columnGap || labelComputed.gap || '0') || 0,
				paddingInline:
					(Number.parseFloat(labelComputed.paddingLeft || '0') || 0) +
					(Number.parseFloat(labelComputed.paddingRight || '0') || 0),
			};
		});
		let requiredWidth = 0;
		for (const [index, titleWidth] of this.measureLaneTitleNaturalWidths(laneTitles).entries()) {
			const metrics = laneMetrics[index] ?? { collapsed: false, gap: 0, paddingInline: 0 };
			const contentWidth = metrics.collapsed
				? titleWidth + countWidth + metrics.gap
				: Math.max(titleWidth, countWidth);
			requiredWidth = Math.max(requiredWidth, contentWidth + metrics.paddingInline);
		}
		const widthPx = clampKanbanLaneColumnWidth(Math.ceil(requiredWidth));
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
			const connectedRows = gridRows.filter(row => row.isConnected);
			this.syncRowCellHeights(connectedRows);
			if (hasSwimlanes) {
				const connectedLaneLabels = laneLabels.filter(label => label.isConnected);
				if (connectedLaneLabels.length === connectedRows.length) {
					this.syncLaneHeights(connectedLaneLabels, connectedRows);
				}
				this.scheduleLaneColumnWidthRefresh(boardEl, laneTitles.filter(title => title.isConnected));
			}
			const gridViewport = boardEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
			if (gridViewport) this.scheduleBoardViewportAnchorRestore(gridViewport);
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

		let lastBoardWidth = boardEl.getBoundingClientRect().width;
		let lastParentWidth = boardEl.parentElement?.getBoundingClientRect().width ?? null;
		const observer = new ResizeObserver(entries => {
			let widthChanged = false;
			for (const entry of entries) {
				const width = entry.contentRect.width;
				if (entry.target === boardEl) {
					if (Math.abs(width - lastBoardWidth) > 0.5) widthChanged = true;
					lastBoardWidth = width;
					continue;
				}
				if (entry.target === boardEl.parentElement) {
					if (lastParentWidth === null || Math.abs(width - lastParentWidth) > 0.5) widthChanged = true;
					lastParentWidth = width;
				}
			}
			if (widthChanged) scheduleRefresh();
		});
		observer.observe(boardEl);
		if (boardEl.parentElement) observer.observe(boardEl.parentElement);
		this.boardLayoutRefreshCleanup = () => {
			observer.disconnect();
		};
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
		let lastMobileLayout: boolean | null = null;

		const dispatchAxisClear = (): void => {
			boardEl.dispatchEvent(new Event('operon-kanban-axis-clear'));
		};
		const applyState = (): void => {
			applyFrame = null;
			const settings = this.getSettings();
			boardEl.style.setProperty('--operon-kanban-mobile-lane-handle-width', `${settings.kanbanMobileCompactSwimlaneWidthPx}px`);
			const mobileLayout = this.isKanbanMobileLayoutEligible(gridViewport);
			const mobileLayoutChanged = lastMobileLayout !== null && lastMobileLayout !== mobileLayout;
			if (mobileLayout || mobileLayoutChanged) {
				dispatchAxisClear();
			}
			lastMobileLayout = mobileLayout;
			root.classList.toggle('is-mobile-layout', mobileLayout);
			boardEl.classList.toggle('is-mobile-layout', mobileLayout);
			if (mobileLayoutChanged) {
				this.markDirty();
				return;
			}

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
					|| !this.isKanbanMobileLayoutEligible(gridViewport)
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
			if (!verticalDragScrollActive || !this.draggedCardContext || !this.isKanbanMobileLayoutEligible(gridViewport)) {
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
			if (!this.draggedCardContext || !this.isKanbanMobileLayoutEligible(gridViewport)) {
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
		const resolveGestureCard = (target: HTMLElement | null): HTMLElement | null => {
			if (!target || isKanbanCardInteractionTarget(target)) return null;
			const card = target.closest<HTMLElement>('.operon-kanban-card');
			if (!card || card.dataset.kanbanPreview === 'true' || !boardEl.contains(card)) return null;
			return card;
		};
		const suppressNextMobileCardClick = (gesture: KanbanMobileCardGestureState): void => {
			if (gesture.clickSuppressed) return;
			const sourceTaskId = gesture.cardEl.dataset.operonTaskId ?? '';
			if (!sourceTaskId) return;
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
				const clickedTaskId = target.closest<HTMLElement>('.operon-kanban-card')?.dataset.operonTaskId ?? null;
				if (!shouldSuppressKanbanGestureClick(sourceTaskId, clickedTaskId)) return;
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
					|| !this.isKanbanMobileLayoutEligible(gridViewport)
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
			this.materializeKanbanCellIfPending(nextCell);
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
		const onMobileWindowScroll = (): void => {
			if (mobileGesture?.mode === 'pending') cleanupMobileCardGesture(true);
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
			gesture.ownerWindow.removeEventListener('scroll', onMobileWindowScroll, true);
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
				this.endKanbanDragInteraction();
			}
			mobileGesture = null;
			return gesture;
		};
		const startMobileCardDrag = (gesture: KanbanMobileCardGestureState): void => {
			const taskId = gesture.cardEl.dataset.operonTaskId;
			const sourceLaneKey = gesture.cardEl.dataset.kanbanLaneKey;
			const boardSignature = boardEl.dataset.kanbanDropBoardSignature;
			if (!taskId || !sourceLaneKey || !boardSignature) {
				cleanupMobileCardGesture(true);
				return;
			}
			clearMobileGestureTimer(gesture);
			gesture.mode = 'dragging';
			this.beginKanbanDragInteraction();
			this.requestActiveTaskNotePopoverClose(false);
			gesture.previousClientX = gesture.latestClientX;
			gesture.previousClientY = gesture.latestClientY;
			suppressNextMobileCardClick(gesture);
			setMobileTouchDragActiveClass();
			this.hideCellQuickAdds(boardEl);
			this.draggedCardContext = {
				taskId,
				sourceStatusId: gesture.cardEl.dataset.kanbanStatusId ?? null,
				sourceStatusValue: gesture.cardEl.dataset.kanbanStatusValue ?? '',
				sourceLaneKey,
				boardSignature,
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
			const targetCell = resolveMobileDropCell(event.clientX, event.clientY);
			if (targetCell) {
				this.materializeKanbanCellIfPending(targetCell);
				this.hideCellQuickAdd(targetCell);
			}
			const targetStatusId = targetCell?.dataset.kanbanStatusId ?? null;
			const targetLaneKey = targetCell?.dataset.kanbanLaneKey ?? null;
			const preset = this.resolveCurrentPreset();
			const targetBeforeTaskId = targetCell && resolveKanbanEffectiveSorting(preset, targetStatusId).sortMode === 'manual'
				? this.resolveManualDropBeforeTaskIdAt(targetCell, event.clientY, preset)
				: null;
			cleanupMobileCardGesture(false);
			if (!targetCell || !targetStatusId || !targetLaneKey) {
				this.draggedCardContext = null;
				dragged.cardEl.removeClass('is-dragging');
				this.clearManualDropIndicators(boardEl);
				this.endKanbanDragInteraction();
				return;
			}
			const context: KanbanDropContext = {
				taskId: dragged.taskId,
				sourceStatusId: dragged.sourceStatusId,
				sourceStatusValue: dragged.sourceStatusValue,
				sourceLaneKey: dragged.sourceLaneKey,
				boardSignature: dragged.boardSignature,
				targetStatusId,
				targetLaneKey,
				swimlaneBy: preset.swimlaneBy,
				targetBeforeTaskId,
			};
			this.completeKanbanCardDrop(targetCell, dragged, context, targetBeforeTaskId, preset, true);
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
				// Keep the preview glued to the finger; drop-target resolution
				// (elementFromPoint + indicator) is owned by the rAF drag loop.
				updateMobileDragPreview(gesture);
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
			if (event.button !== 0 || !isTouchLikePointer(event) || !this.isKanbanMobileLayoutEligible(gridViewport)) return;
			const target = asHTMLElement(event.target, boardEl);
			const card = resolveGestureCard(target);
			if (!card) return;
			const taskId = card.dataset.operonTaskId;
			if (!taskId || this.cardOperations.isTaskPending(taskId)) return;
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
			ownerWindow.addEventListener('scroll', onMobileWindowScroll, true);
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
			dispatchAxisClear();
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
		const row = cell.closest<HTMLElement>('.operon-kanban-row');
		if (!boardEl || !row || this.boardLayoutRefreshFrame !== null) return;
		this.boardLayoutRefreshFrame = window.requestAnimationFrame(() => {
			this.boardLayoutRefreshFrame = null;
			if (!boardEl.isConnected || !row.isConnected) return;
			this.syncRowCellHeights([row]);
			if (!boardEl.classList.contains('is-no-swimlanes')) {
				const laneLabel = row.querySelector<HTMLElement>(':scope > .operon-kanban-lane-label');
				if (laneLabel) this.syncLaneHeights([laneLabel], [row]);
			}
			const gridViewport = boardEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
			if (gridViewport) this.scheduleBoardViewportAnchorRestore(gridViewport);
		});
	}

	private clearKanbanLazyObservers(): void {
		for (const observer of this.kanbanLazyObservers) {
			observer.disconnect();
		}
		this.kanbanLazyObservers = [];
		this.cellLazySentinelObservers = new WeakMap<HTMLElement, IntersectionObserver>();
		this.pendingCellMaterializers.clear();
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

	private captureBoardScrollState(container: HTMLElement, preserveViewport = false): void {
		const board = asHTMLElement(container.querySelector('.operon-kanban-grid-viewport'), container);
		if (!board) return;
		this.captureCellScrollStates(board);
		const viewportAnchor = this.pendingViewportAnchor;
		if (
			viewportAnchor
			&& viewportAnchor.expiresAt >= Date.now()
			&& viewportAnchor.scope === this.buildDropScrollAnchorScope()
		) {
			this.lastBoardScrollState = { ...viewportAnchor.state };
			return;
		}
		this.lastBoardScrollState = {
			left: board.scrollLeft,
			top: board.scrollTop,
		};
		if (preserveViewport && !this.pendingViewportAnchor) {
			this.captureBoardViewportAnchor(board);
		}
	}

	private captureBoardViewportAnchor(board: HTMLElement): KanbanViewportAnchor {
		const viewportRect = board.getBoundingClientRect();
		const laneAnchors: KanbanViewportContentAnchor[] = [];
		const rows = board.querySelectorAll<HTMLElement>('.operon-kanban-row[data-kanban-lane-key]');
		for (const row of Array.from(rows)) {
			const rect = row.getBoundingClientRect();
			if (rect.bottom <= viewportRect.top || rect.top >= viewportRect.bottom) continue;
			const key = row.dataset.kanbanLaneKey;
			if (key === undefined) continue;
			laneAnchors.push({ key, viewportOffsetPx: rect.top - viewportRect.top });
			if (laneAnchors.length >= KANBAN_VIEWPORT_ANCHOR_MAX_ITEMS) break;
		}

		const columnAnchors: KanbanViewportContentAnchor[] = [];
		const headers = board.querySelectorAll<HTMLElement>('.operon-kanban-column-header[data-kanban-status-id]');
		for (const header of Array.from(headers)) {
			const rect = header.getBoundingClientRect();
			if (rect.right <= viewportRect.left || rect.left >= viewportRect.right) continue;
			const key = header.dataset.kanbanStatusId;
			if (!key) continue;
			columnAnchors.push({ key, viewportOffsetPx: rect.left - viewportRect.left });
			if (columnAnchors.length >= KANBAN_VIEWPORT_ANCHOR_MAX_ITEMS) break;
		}

		const now = Date.now();
		const anchor: KanbanViewportAnchor = {
			state: { left: board.scrollLeft, top: board.scrollTop },
			scope: this.buildDropScrollAnchorScope(),
			laneAnchors,
			columnAnchors,
			expiresAt: now + KANBAN_VIEWPORT_ANCHOR_TTL_MS,
			settleAfter: now + KANBAN_VIEWPORT_ANCHOR_MIN_SETTLE_MS,
			stablePasses: 0,
			lastAppliedState: null,
			drop: null,
		};
		this.pendingViewportAnchor = anchor;
		return anchor;
	}

	private restoreBoardScrollState(board: HTMLElement): void {
		const viewportAnchor = this.pendingViewportAnchor;
		const activeAnchor = viewportAnchor
			&& viewportAnchor.expiresAt >= Date.now()
			&& viewportAnchor.scope === this.buildDropScrollAnchorScope()
			? viewportAnchor
			: null;
		const { left, top } = activeAnchor?.state ?? this.lastBoardScrollState;
		if (!activeAnchor && left === 0 && top === 0) return;
		this.suppressTaskNoteScrollCloseForFrame(board);
		board.scrollLeft = left;
		board.scrollTop = top;
		this.markProgrammaticBoardScroll(board);
	}

	private restoreBoardViewportAnchor(board: HTMLElement): void {
		const anchor = this.pendingViewportAnchor;
		if (!anchor) return;
		if (anchor.scope !== this.buildDropScrollAnchorScope()) {
			this.clearViewportAnchor();
			this.clearBoardBottomScrollCompensation();
			return;
		}
		if (anchor.expiresAt < Date.now()) {
			this.clearViewportAnchor();
			return;
		}
		const viewportRect = board.getBoundingClientRect();
		const laneContentTops = new Map<string, number>();
		for (const row of Array.from(board.querySelectorAll<HTMLElement>('.operon-kanban-row[data-kanban-lane-key]'))) {
			const key = row.dataset.kanbanLaneKey;
			if (key === undefined || laneContentTops.has(key)) continue;
			laneContentTops.set(key, row.getBoundingClientRect().top - viewportRect.top + board.scrollTop);
		}
		const columnContentLefts = new Map<string, number>();
		for (const header of Array.from(board.querySelectorAll<HTMLElement>('.operon-kanban-column-header[data-kanban-status-id]'))) {
			const key = header.dataset.kanbanStatusId;
			if (!key || columnContentLefts.has(key)) continue;
			columnContentLefts.set(key, header.getBoundingClientRect().left - viewportRect.left + board.scrollLeft);
		}

		const dropAllowsTargetAnchor = anchor.drop?.outcome !== 'failed'
			&& anchor.drop?.outcome !== 'cancelled';
		const desiredScrollTop = resolveKanbanDropLaneAnchorScroll({
			anchors: anchor.laneAnchors,
			targetLaneAnchor: anchor.drop?.targetLaneAnchor ?? null,
			contentOffsets: laneContentTops,
			fallbackScroll: anchor.state.top,
			allowTargetAnchor: dropAllowsTargetAnchor,
		});
		const compensation = resolveKanbanViewportScrollCompensation({
			desiredScrollTop,
			naturalMaxScrollTop: Math.max(
				0,
				board.scrollHeight - board.clientHeight - this.getAppliedBoardBottomScrollCompensation(board),
			),
		});
		this.applyBoardBottomScrollCompensation(board, compensation.bottomCompensationPx);
		const targetState = {
			left: Math.min(
				Math.max(0, board.scrollWidth - board.clientWidth),
				resolveKanbanViewportAnchorScroll(anchor.columnAnchors, columnContentLefts, anchor.state.left),
			),
			top: Math.min(
				Math.max(0, board.scrollHeight - board.clientHeight),
				compensation.scrollTop,
			),
		};
		this.suppressTaskNoteScrollCloseForFrame(board);
		board.scrollLeft = targetState.left;
		board.scrollTop = targetState.top;
		this.markProgrammaticBoardScroll(board);

		const lastApplied = anchor.lastAppliedState;
		const stable = lastApplied !== null
			&& Math.abs(lastApplied.left - targetState.left) <= 1
			&& Math.abs(lastApplied.top - targetState.top) <= 1;
		const hasPendingImages = Array.from(board.querySelectorAll<HTMLImageElement>('.operon-kanban-card-image > img'))
			.some(image => !image.complete);
		anchor.lastAppliedState = targetState;
		anchor.stablePasses = !hasPendingImages && stable ? anchor.stablePasses + 1 : 0;
		if (
			anchor.stablePasses >= KANBAN_VIEWPORT_ANCHOR_STABLE_PASSES
			&& Date.now() >= anchor.settleAfter
			&& anchor.drop?.outcome !== null
		) {
			this.clearViewportAnchor();
		}
	}

	private scheduleBoardViewportAnchorRestore(board: HTMLElement): void {
		if (!this.pendingViewportAnchor) return;
		const ownerWindow = getOwnerWindow(board);
		if (this.boardViewportRestoreFrame) {
			this.boardViewportRestoreFrame.win.cancelAnimationFrame(this.boardViewportRestoreFrame.id);
		}
		const id = ownerWindow.requestAnimationFrame(() => {
			if (this.boardViewportRestoreFrame?.id !== id) return;
			this.boardViewportRestoreFrame = null;
			if (board.isConnected) this.restoreBoardViewportAnchor(board);
		});
		this.boardViewportRestoreFrame = { win: ownerWindow, id };
	}

	private clearViewportAnchor(): void {
		this.pendingViewportAnchor = null;
		if (!this.boardViewportRestoreFrame) return;
		this.boardViewportRestoreFrame.win.cancelAnimationFrame(this.boardViewportRestoreFrame.id);
		this.boardViewportRestoreFrame = null;
	}

	private markProgrammaticBoardScroll(board: HTMLElement): void {
		const state = { left: board.scrollLeft, top: board.scrollTop };
		this.lastBoardScrollState = state;
		this.pendingProgrammaticBoardScroll = {
			state,
			expiresAt: Date.now() + KANBAN_PROGRAMMATIC_SCROLL_EVENT_WINDOW_MS,
		};
	}

	private restoreBoardBottomScrollCompensation(gridContent: HTMLElement): void {
		if (
			this.boardBottomScrollCompensationPx <= 0
			|| this.boardBottomScrollCompensationScope !== this.buildDropScrollAnchorScope()
		) {
			this.boardBottomScrollCompensationPx = 0;
			this.boardBottomScrollCompensationScope = null;
			gridContent.style.removeProperty('padding-bottom');
			return;
		}
		gridContent.style.paddingBottom = `${this.boardBottomScrollCompensationPx}px`;
	}

	private getAppliedBoardBottomScrollCompensation(board: HTMLElement): number {
		if (this.boardBottomScrollCompensationScope !== this.buildDropScrollAnchorScope()) return 0;
		const gridContent = board.querySelector<HTMLElement>(':scope > .operon-kanban-grid-content');
		if (!gridContent || this.boardBottomScrollCompensationPx <= 0) return 0;
		return this.boardBottomScrollCompensationPx;
	}

	private applyBoardBottomScrollCompensation(board: HTMLElement, compensationPx: number): void {
		const gridContent = board.querySelector<HTMLElement>(':scope > .operon-kanban-grid-content');
		if (!gridContent) return;
		this.cancelBoardBottomScrollCompensationRelease();
		const nextCompensationPx = Math.max(0, compensationPx);
		this.boardBottomScrollCompensationPx = nextCompensationPx;
		this.boardBottomScrollCompensationScope = nextCompensationPx > 0
			? this.buildDropScrollAnchorScope()
			: null;
		if (nextCompensationPx > 0) {
			gridContent.style.paddingBottom = `${nextCompensationPx}px`;
		} else {
			gridContent.style.removeProperty('padding-bottom');
		}
	}

	private clearBoardBottomScrollCompensation(): void {
		this.cancelBoardBottomScrollCompensationRelease();
		this.boardBottomScrollCompensationPx = 0;
		this.boardBottomScrollCompensationScope = null;
		this.contentEl.querySelector<HTMLElement>('.operon-kanban-grid-content')
			?.style.removeProperty('padding-bottom');
	}

	private releaseBoardBottomScrollCompensationIfNatural(board: HTMLElement): void {
		const appliedCompensationPx = this.getAppliedBoardBottomScrollCompensation(board);
		if (appliedCompensationPx <= 0) return;
		const naturalMaxScrollTop = Math.max(
			0,
			board.scrollHeight - board.clientHeight - appliedCompensationPx,
		);
		if (shouldReleaseKanbanViewportScrollCompensation({
			scrollTop: board.scrollTop,
			naturalMaxScrollTop,
			bottomCompensationPx: appliedCompensationPx,
		})) {
			this.applyBoardBottomScrollCompensation(board, 0);
		}
	}

	private scheduleBoardBottomScrollCompensationRelease(board: HTMLElement): void {
		const appliedCompensationPx = this.getAppliedBoardBottomScrollCompensation(board);
		if (appliedCompensationPx <= 0) {
			this.cancelBoardBottomScrollCompensationRelease();
			return;
		}
		const naturalMaxScrollTop = Math.max(
			0,
			board.scrollHeight - board.clientHeight - appliedCompensationPx,
		);
		if (!shouldReleaseKanbanViewportScrollCompensation({
			scrollTop: board.scrollTop,
			naturalMaxScrollTop,
			bottomCompensationPx: appliedCompensationPx,
		})) {
			this.cancelBoardBottomScrollCompensationRelease();
			return;
		}
		this.cancelBoardBottomScrollCompensationRelease();
		const ownerWindow = getOwnerWindow(board);
		const id = ownerWindow.requestAnimationFrame(() => {
			if (this.boardCompensationReleaseFrame?.id !== id) return;
			this.boardCompensationReleaseFrame = null;
			if (board.isConnected) this.releaseBoardBottomScrollCompensationIfNatural(board);
		});
		this.boardCompensationReleaseFrame = { win: ownerWindow, id };
	}

	private cancelBoardBottomScrollCompensationRelease(): void {
		if (!this.boardCompensationReleaseFrame) return;
		this.boardCompensationReleaseFrame.win.cancelAnimationFrame(this.boardCompensationReleaseFrame.id);
		this.boardCompensationReleaseFrame = null;
	}

	private resetBoardViewportRetention(): void {
		this.preserveViewportOnNextRender = false;
		this.pendingProgrammaticBoardScroll = null;
		this.clearViewportAnchor();
		this.clearBoardBottomScrollCompensation();
	}

	private captureCellScrollStates(board: HTMLElement): void {
		const scope = this.buildDropScrollAnchorScope();
		if (this.cellScrollRestoreScope !== scope) {
			this.pendingCellScrollRestores.clear();
			this.cellScrollRestoreScope = scope;
		}
		const now = Date.now();
		for (const [key, entry] of this.pendingCellScrollRestores) {
			if (entry.expiresAt < now) this.pendingCellScrollRestores.delete(key);
		}
		const cells = board.querySelectorAll<HTMLElement>('.operon-kanban-cell.is-scroll-limited');
		for (const cell of Array.from(cells)) {
			const statusId = cell.dataset.kanbanStatusId;
			const laneKey = cell.dataset.kanbanLaneKey;
			if (!statusId || laneKey === undefined) continue;
			const top = cell.scrollTop;
			if (top <= 0) continue;
			const key = buildKanbanCellKey(statusId, laneKey);
			// A still-pending clamped restore holds a deeper position than the
			// interim DOM (lazy batches had not caught up yet); keep the deeper
			// target so a mid-restore rebuild does not shallow it.
			const pending = this.pendingCellScrollRestores.get(key);
			const anchors = this.collectCellScrollAnchors(cell);
			this.pendingCellScrollRestores.set(key, {
				top: pending ? Math.max(pending.top, top) : top,
				anchors: anchors.length > 0 ? anchors : (pending?.anchors ?? []),
				expiresAt: now + KANBAN_CELL_SCROLL_RESTORE_TTL_MS,
			});
		}
	}

	private getPendingCellScrollTop(statusId: string, laneKey: string): number {
		const key = buildKanbanCellKey(statusId, laneKey);
		const entry = this.pendingCellScrollRestores.get(key);
		if (!entry) return 0;
		if (entry.expiresAt < Date.now()) {
			this.pendingCellScrollRestores.delete(key);
			return 0;
		}
		return entry.top;
	}

	private collectCellScrollAnchors(cell: HTMLElement): KanbanCellScrollAnchor[] {
		const cellRect = cell.getBoundingClientRect();
		const anchors: KanbanCellScrollAnchor[] = [];
		const cards = cell.querySelectorAll<HTMLElement>(':scope > .operon-kanban-card');
		for (const card of Array.from(cards)) {
			const cardRect = card.getBoundingClientRect();
			if (cardRect.bottom <= cellRect.top) continue;
			const viewportOffsetPx = cardRect.top - cellRect.top;
			if (viewportOffsetPx >= cellRect.height) break;
			const taskId = card.dataset.operonTaskId;
			if (!taskId) continue;
			anchors.push({ taskId, viewportOffsetPx });
			if (anchors.length >= KANBAN_CELL_SCROLL_ANCHOR_MAX_CARDS) break;
		}
		return anchors;
	}

	private resolveCellAnchorScrollTop(cell: HTMLElement, entry: { top: number; anchors: KanbanCellScrollAnchor[] }): number {
		if (entry.anchors.length === 0) return entry.top;
		const cellRect = cell.getBoundingClientRect();
		const cardContentTops = new Map<string, number>();
		for (const anchor of entry.anchors) {
			if (cardContentTops.has(anchor.taskId)) continue;
			const card = cell.querySelector<HTMLElement>(`:scope > .operon-kanban-card[data-operon-task-id="${CSS.escape(anchor.taskId)}"]`);
			if (!card) continue;
			cardContentTops.set(anchor.taskId, card.getBoundingClientRect().top - cellRect.top + cell.scrollTop);
		}
		return resolveKanbanCellAnchorScrollTop(entry.anchors, cardContentTops, entry.top);
	}

	private restoreCellScrollIfPending(cell: HTMLElement): void {
		const statusId = cell.dataset.kanbanStatusId;
		const laneKey = cell.dataset.kanbanLaneKey;
		if (!statusId || laneKey === undefined) return;
		const key = buildKanbanCellKey(statusId, laneKey);
		const entry = this.pendingCellScrollRestores.get(key);
		if (!entry) return;
		const targetTop = this.resolveCellAnchorScrollTop(cell, entry);
		this.suppressTaskNoteScrollCloseForFrame(cell);
		cell.scrollTop = targetTop;
		const outcome = resolveKanbanCellScrollRestore({
			targetTop,
			achievedTop: cell.scrollTop,
			now: Date.now(),
			expiresAt: entry.expiresAt,
			// A clamped restore pushes the lazy sentinel into the cell's
			// viewport, so the IntersectionObserver renders the next batch and
			// re-invokes this restore until the saved depth is reachable.
			canGrow: cell.querySelector(':scope > .operon-kanban-lazy-sentinel') !== null,
		});
		if (outcome !== 'retry') this.pendingCellScrollRestores.delete(key);
	}

	private beginDropScrollAnchor(
		root: HTMLElement,
		context: KanbanDropContext,
	): KanbanViewportAnchor | null {
		const board = root.closest<HTMLElement>('.operon-kanban-grid-viewport')
			?? asHTMLElement(this.contentEl.querySelector('.operon-kanban-grid-viewport'), this.contentEl);
		if (!board) return null;
		const viewportAnchor = this.captureBoardViewportAnchor(board);
		const viewportRect = board.getBoundingClientRect();
		const targetRow = root.closest<HTMLElement>('.operon-kanban-row[data-kanban-lane-key]');
		viewportAnchor.drop = {
			targetLaneAnchor: {
				key: context.targetLaneKey,
				viewportOffsetPx: (targetRow ?? root).getBoundingClientRect().top - viewportRect.top,
			},
			outcome: null,
		};
		viewportAnchor.expiresAt = Date.now() + KANBAN_OPTIMISTIC_MOVE_TTL_MS;
		this.lastBoardScrollState = { ...viewportAnchor.state };
		return viewportAnchor;
	}

	private settleDropViewportAnchor(
		anchor: KanbanViewportAnchor | null,
		outcome: 'succeeded' | 'failed' | 'cancelled',
	): void {
		if (!anchor?.drop || this.pendingViewportAnchor !== anchor) return;
		anchor.drop.outcome = outcome;
		anchor.stablePasses = 0;
		anchor.lastAppliedState = null;
		anchor.settleAfter = Date.now() + KANBAN_VIEWPORT_ANCHOR_MIN_SETTLE_MS;
		const board = this.contentEl.querySelector<HTMLElement>('.operon-kanban-grid-viewport');
		if (board) this.scheduleBoardViewportAnchorRestore(board);
	}

	private buildDropScrollAnchorScope(): string {
		const state = this.ensureState();
		return JSON.stringify({
			presetId: state.presetId,
			searchQuery: state.searchQuery,
			collapsedStatusIds: state.collapsedStatusIds,
			collapsedLaneKeys: state.collapsedLaneKeys,
			parentSearchSelection: this.parentSearchSelection,
			searchScope: this.searchScope,
		});
	}

	private bindBoardScrollStateTracking(gridViewport: HTMLElement): void {
		const cancelViewportRestore = (): void => {
			this.pendingProgrammaticBoardScroll = null;
			this.clearViewportAnchor();
			this.preserveViewportOnNextRender = false;
		};
		gridViewport.addEventListener('wheel', cancelViewportRestore, { passive: true });
		gridViewport.addEventListener('pointerdown', cancelViewportRestore, { passive: true });
		gridViewport.addEventListener('touchstart', cancelViewportRestore, { passive: true });
		gridViewport.addEventListener('keydown', cancelViewportRestore);
		gridViewport.addEventListener('scroll', () => {
			const expected = this.pendingProgrammaticBoardScroll;
			if (
				expected
				&& expected.expiresAt >= Date.now()
				&& matchesKanbanProgrammaticScrollState(
					{ left: gridViewport.scrollLeft, top: gridViewport.scrollTop },
					expected.state,
				)
			) return;
			this.pendingProgrammaticBoardScroll = null;
			if (this.pendingViewportAnchor) {
				this.clearViewportAnchor();
				this.preserveViewportOnNextRender = false;
			}
			this.lastBoardScrollState = {
				left: gridViewport.scrollLeft,
				top: gridViewport.scrollTop,
			};
			this.scheduleBoardBottomScrollCompensationRelease(gridViewport);
		});
	}

	private syncLaneHeights(laneLabels: HTMLElement[], gridRows: HTMLElement[]): void {
		// Read phase: measure every row before mutating any label height.
		const rowHeights = gridRows.map(gridRow => Math.ceil(gridRow.getBoundingClientRect().height));
		for (let index = 0; index < laneLabels.length; index++) {
			const laneLabel = laneLabels[index];
			const rowHeight = rowHeights[index];
			if (!laneLabel || !gridRows[index] || rowHeight === undefined) continue;
			laneLabel.style.height = `${rowHeight}px`;
		}
	}

	private syncRowCellHeights(gridRows: HTMLElement[]): void {
		// Write phase: reset lane label heights so rows report natural content height.
		for (const gridRow of gridRows) {
			gridRow.querySelector<HTMLElement>(':scope > .operon-kanban-lane-label')?.style.removeProperty('height');
		}
		// Read phase: measure every row in one pass (single forced layout).
		const rowHeights = gridRows.map(gridRow => Math.ceil(gridRow.getBoundingClientRect().height));
		// Write phase: cap scroll-limited cells to their row height.
		for (let index = 0; index < gridRows.length; index++) {
			const gridRow = gridRows[index];
			const rowHeight = rowHeights[index] ?? 0;
			if (!gridRow || rowHeight <= 0) continue;
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
		this.commitCellHeightLimit(cell, this.measureCellHeightLimitPx(cell, maxVisibleTasks, totalTaskCount));
	}

	private measureCellHeightLimitPx(cell: HTMLElement, maxVisibleTasks: number, totalTaskCount: number): number | null {
		if (!Number.isFinite(maxVisibleTasks) || maxVisibleTasks < 1) return null;
		if (totalTaskCount <= maxVisibleTasks) return null;

		const topLevelCards = Array.from(cell.children)
			.map(child => asHTMLElement(child))
			.filter((child): child is HTMLElement => child !== null)
			.filter(child => child.classList.contains('operon-kanban-card'));
		if (topLevelCards.length === 0) return null;

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
		return Math.ceil(maxHeight);
	}

	private commitCellHeightLimit(cell: HTMLElement, maxHeightPx: number | null): void {
		if (maxHeightPx === null) {
			cell.classList.remove('is-scroll-limited');
			cell.style.removeProperty('max-height');
			return;
		}
		cell.style.maxHeight = `${maxHeightPx}px`;
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

	private resolveKanbanDropBoardSignature(preset: KanbanPreset): string {
		const pipeline = preset.pipelineId
			? this.getSettings().pipelines.find(entry => entry.id === preset.pipelineId) ?? null
			: null;
		return buildKanbanDropBoardSignature(preset, pipeline);
	}

	private invalidateDropUiGeneration(): void {
		this.cardOperations.invalidateUi();
		this.draggedCardContext = null;
		for (const [taskId, move] of this.optimisticMoves) {
			if (move.operationId) this.optimisticMoves.delete(taskId);
		}
		this.clearOptimisticMoveExpiryTimer();
		this.scheduleOptimisticMoveExpiryRender();
	}

	private normalizeState(state: Partial<KanbanLeafState> | null | undefined): KanbanLeafState {
		const settings = this.getSettings();
		const availablePresetIds = settings.kanbanPresets.map(entry => entry.id);
		const availableStatusCollapseScopeKeys = this.getAvailableStatusCollapseScopeKeys(settings);
		const availableLaneCollapseScopeKeys = this.getAvailableLaneCollapseScopeKeys(settings);
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
			availableStatusCollapseScopeKeys,
			availableLaneCollapseScopeKeys,
		});
	}

	private areLeafStatesEqual(left: KanbanLeafState | null, right: KanbanLeafState | null): boolean {
		return areKanbanLeafStatesEqual(left, right);
	}

	private async updateLeafState(nextState: KanbanLeafState): Promise<void> {
		const normalized = this.normalizeState(this.withCurrentPresetCollapseState(nextState));
		const changed = !this.areLeafStatesEqual(this.state, normalized);
		const presetChanged = this.state?.presetId !== normalized.presetId;
		if (presetChanged) this.invalidateDropUiGeneration();
		if (!changed) return;
		this.resetBoardViewportRetention();
		this.state = normalized;
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
		if (this.dragInteractionGate.deferRenderIfActive()) return;
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

	private getAvailableStatusCollapseScopeKeys(settings: OperonSettings): string[] {
		const pipelineIds = new Set(settings.pipelines.map(pipeline => pipeline.id));
		return settings.kanbanPresets
			.filter(preset => this.isKanbanPresetCollapseScopeAvailable(preset, pipelineIds))
			.map(preset => buildKanbanStatusCollapseScopeKey(preset.id, preset.pipelineId))
			.filter((scopeKey): scopeKey is string => scopeKey !== null);
	}

	private getAvailableLaneCollapseScopeKeys(settings: OperonSettings): string[] {
		const pipelineIds = new Set(settings.pipelines.map(pipeline => pipeline.id));
		return settings.kanbanPresets
			.filter(preset => this.isKanbanPresetCollapseScopeAvailable(preset, pipelineIds))
			.map(preset => buildKanbanLaneCollapseScopeKey(preset.id, preset.pipelineId, preset.swimlaneBy))
			.filter((scopeKey): scopeKey is string => scopeKey !== null);
	}

	private isKanbanPresetCollapseScopeAvailable(preset: KanbanPreset, pipelineIds: Set<string>): boolean {
		return !preset.pipelineId || pipelineIds.has(preset.pipelineId);
	}

	private didPruneCollapseScopeState(
		rawState: Partial<KanbanLeafState> | null | undefined,
		normalized: KanbanLeafState,
	): boolean {
		return this.didPruneCollapseScopeMap(rawState?.collapsedStatusIdsByScope, normalized.collapsedStatusIdsByScope)
			|| this.didPruneCollapseScopeMap(rawState?.collapsedLaneKeysByScope, normalized.collapsedLaneKeysByScope);
	}

	private didPruneCollapseScopeMap(rawMap: unknown, normalizedMap: Record<string, string[]>): boolean {
		if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return false;
		for (const [scopeKey, value] of Object.entries(rawMap as Record<string, unknown>)) {
			if (!scopeKey.trim() || !Array.isArray(value)) continue;
			if (!(scopeKey in normalizedMap)) return true;
		}
		return false;
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
		const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(settings.pipelines);
		return filterTasksForCalendar(
			filterSet,
			this.indexer.getAllTasks(),
			settings.priorities,
			this.getPinnedCache(),
			{
				projectSerialScopes: settings.projectSerialScopes,
				projectSerialScopeTasks: this.indexer.getAllTasks(),
				dependencyTasks: this.indexer.getAllTasks(),
				pipelines: settings.pipelines,
				filePropertyContext: this.getFilePropertyContext(settings),
			},
		).filter(task => isTaskInPipelineWithIndex(task, pipeline, workflowStatusIdentityIndex));
	}

	private getFilePropertyContext(settings: OperonSettings) {
		return getTableFilePropertyIndex(this.app).getSnapshot(
			this.indexer.getAllTasks(),
			this.indexer.getGeneration(),
			{ keyMappings: settings.keyMappings },
		);
	}

	private getCurrentSearchScopeTasks(
		filterSet: FilterSet | null,
		pipeline: Pipeline,
		settings: OperonSettings,
		scope: TaskSearchBoxScopeState,
	): IndexedTask[] {
		const recentModifiedCutoff = getTaskSearchBoxRecentModifiedCutoff(settings);
		return this.getCurrentScopeTasks(filterSet, pipeline, settings)
			.filter(task => matchesTaskSearchBoxScope(task, scope, { recentModifiedCutoff }));
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
		return hasTaskSearchScopeFilters(scope);
	}

	private resetKanbanSearchScope(): void {
		this.searchScope = cloneTaskSearchBoxScopeState(KANBAN_SEARCH_BOX_DEFAULT_SCOPE);
		this.clearParentSearchState();
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
		this.parentSearchHighlightedIndex = updateSearchParentHighlight({
			root: this.contentEl,
			itemSelector: '.operon-kanban-parent-search-item',
			currentIndex: this.parentSearchHighlightedIndex,
			nextIndex,
		});
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
