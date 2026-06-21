import { ItemView, Platform, prepareFuzzySearch, setIcon, WorkspaceLeaf } from 'obsidian';
import { getSchemePalette, isLightScheme } from '../appearance-schemes';
import { formatUiMinuteOfDay, formatUiTime } from '../../core/ui-time-format';
import { localNow, localToday, toLocalDatetime } from '../../core/local-time';
import { OperonIndexer } from '../../indexer/indexer';
import { buildVisibleCalendarDates, queryCalendarItems, queryCalendarItemsForVisibleDates, shiftCalendarDateKey } from '../../systems/calendar-query';
import { filterTasksForCalendar, stripFilterViewOnlyOptions } from '../../systems/calendar-filter-materialization';
import {
	buildCalendarSidebarTaskPoolSearchText,
	CALENDAR_SIDEBAR_TASK_POOL_INITIAL_LIMIT,
	CALENDAR_SIDEBAR_TASK_POOL_SEARCH_LIMIT,
	collectCalendarSidebarTaskPoolCandidates,
} from '../../systems/calendar-sidebar-task-pool';
import {
	buildAllDayCalendarWritebackPlan,
	buildAllDayMoveWritebackPlan,
	buildAllDayResizeRightWritebackPlan,
	buildAllDaySlotSelection,
	buildTimedCalendarWritebackPlan,
	buildTimedCalendarWritebackPlanForExistingCalendarAssignment,
	buildTimedSlotSelection,
	CALENDAR_TIMED_SNAP_MINUTES,
} from '../../systems/calendar-writeback';
import { parseLocalDatetime } from '../../systems/tracker-utils';
import { getConfiguredKeyMappingIcon } from '../../core/key-mapping-icons';
import { t } from '../../core/i18n';
import { getAppLocale } from '../../core/obsidian-app';
import { getNormalFilterSets, isSpecialDynamicFilterSet } from '../../core/dynamic-file-task-filter';
import { findStatusDef } from '../../types/pipeline';
import {
	CalendarItem,
	ExternalCalendarTaskSeed,
	CalendarLeafState,
	CalendarMobileViewMode,
	CalendarSidebarTaskPoolMode,
	normalizeCalendarLeafState,
	CalendarPreset,
	CalendarSlotSelection,
	buildCalendarRenderSnapshot,
} from '../../types/calendar';
import { IndexedTask } from '../../types/fields';
import type { ActiveTrackerState, TrackerSession } from '../../types/tracker';
import {
	CALENDAR_MOBILE_SOURCE_PRESET_SETTING_BY_VIEW_MODE,
	FilterSet,
	INLINE_TASK_COMPACT_FALLBACK_ICONS,
	OperonSettings,
	resolveEnabledCalendarMobileViewModes,
	resolveTaskDisplayIcon,
	type CalendarMobileSourcePresetSettingKey,
} from '../../types/settings';
import type { PinnedCache } from '../../storage/pinned-cache';
import type { RepeatSeriesEntry } from '../../storage/repeat-series-store';
import {
	getContextualMenuSurfaceForCalendarItem,
	resolveContextualMenu,
	type ContextualMenuActionId,
	type ContextualMenuActionHandler,
	type ContextualMenuContext,
	type ResolvedContextualMenuAction,
} from '../../core/contextual-menu-engine';
import {
	CALENDAR_TASK_COLOR_SOURCES,
	getNextTaskColorSource,
	getTaskColorSourceIcon,
	getTaskColorSourceLabel,
	normalizeTaskColorSource,
	resolveTaskColorSource,
} from '../../core/task-color-source';
import { bindContextualHoverMenuTrigger, ContextualHoverMenuController } from '../contextual-hover-menu';
import {
	resolveContextualHoverMenuPosition,
	resolveVisibleContextualHoverAnchorRect,
} from '../contextual-hover-menu-position';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { bindTaskTitleLinkPreview } from '../compact-chip-link-preview';
import { closeFloatingPanelsForRoot } from '../field-pickers/common';
import { closeIconOnlyChipPreviewsForRoot } from '../icon-only-chip-preview';
import { renderTaskDescriptionWikilinks } from '../task-description-wikilinks';
import { asHTMLElement, getOwnerBody, getOwnerDocument, getOwnerWindow } from '../../core/dom-compat';
import { enginePerfLog, enginePerfNow } from '../../core/engine-perf';
import {
	applyOptimisticRenderPatch,
	buildOptimisticStatusPatch,
	isOptimisticTaskPatchPersisted,
	normalizeOptimisticFieldValues,
	type OptimisticStatusPatchResult,
	type OptimisticTaskPatchInput,
} from '../../systems/optimistic-status-patch';
import {
	buildTimedGridVisualLayout,
	type TimedGridVisualLayer,
	type TimedGridVisualLayout,
	type TimedGridVisualLayoutPlacement,
} from './timed-grid-visual-layout';
import {
	resolveTimedHorizontalOffsetBounds,
	resolveTimedHorizontalVisibleStartIndex,
} from './timed-horizontal-window';

export const CALENDAR_VIEW_TYPE = 'operon-calendar-view';
const CALENDAR_SIDEBAR_SECTION_ORDER = ['calendars', 'taskPool'] as const;
const CALENDAR_MOBILE_SIDEBAR_MEDIA_QUERY = [
	'(max-width: 720px) and (hover: none)',
	'(max-width: 720px) and (pointer: coarse)',
].join(', ');
const CALENDAR_MOBILE_DATE_STRIP_WEEK_OFFSETS = [-1, 0, 1] as const;
const CALENDAR_MOBILE_TIME_GRID_MINUTES_PER_DAY = 24 * 60;
const CALENDAR_MOBILE_TIME_GRID_SCALE = 1.35;
const CALENDAR_MOBILE_TIME_GRID_DEFAULT_SCROLL_MINUTE = 8 * 60;
const CALENDAR_MOBILE_TIME_GRID_BUFFER_DAYS_PER_SIDE = 3;
const CALENDAR_MOBILE_TOUCH_INTENT_DISTANCE_PX = 8;
const CALENDAR_MOBILE_TOUCH_CANCEL_DISTANCE_PX = 10;
const CALENDAR_MOBILE_EMPTY_SWIPE_OWNERSHIP_DISTANCE_PX = 5;
const CALENDAR_MOBILE_EMPTY_SWIPE_OWNERSHIP_DOMINANCE_RATIO = 1;
const CALENDAR_MOBILE_EMPTY_SWIPE_DISTANCE_PX = 36;
const CALENDAR_MOBILE_EMPTY_SWIPE_DOMINANCE_RATIO = 1.35;
const CALENDAR_MOBILE_EMPTY_SWIPE_ANIMATION_MS = 120;
const CALENDAR_MOBILE_EMPTY_SELECTION_LONG_PRESS_MS = 260;
const CALENDAR_MOBILE_SLOT_CREATE_SCROLL_RESTORE_WINDOW_MS = 4000;
const CALENDAR_MOBILE_SCROLL_RESTORE_STABILIZATION_DELAYS_MS = [60, 180, 360, 720] as const;
const CALENDAR_MOBILE_TASK_PRESS_DRAG_MS = 120;
const CALENDAR_MOBILE_TASK_LONG_PRESS_MS = 260;
const CALENDAR_TOUCH_TAP_EDITOR_DELAY_MS = 80;
const CALENDAR_TOUCH_CLICK_SUPPRESSION_MS = 800;
const CALENDAR_TRACKED_SESSION_DESKTOP_DRAG_INTENT_DISTANCE_PX = 4;

export type CalendarMobileTimedTaskGestureIntent = 'pending' | 'scroll' | 'drag';
export type CalendarMobileEmptyAreaSwipeIntent = 'pending' | 'previous' | 'next';
export type CalendarTrackedSessionPointerDragIntent = 'pending' | 'drag';

export function resolveCalendarMobileTimedTaskGestureIntent(input: {
	deltaX: number;
	deltaY: number;
	elapsedMs: number;
	intentDistancePx: number;
	pressDragMs: number;
}): CalendarMobileTimedTaskGestureIntent {
	const absX = Math.abs(input.deltaX);
	const absY = Math.abs(input.deltaY);
	const distance = Math.hypot(input.deltaX, input.deltaY);
	const intentDistance = Math.max(1, input.intentDistancePx);
	const pressDragMs = Math.max(0, input.pressDragMs);
	const quickVerticalScroll = absY > intentDistance
		&& absY > absX * 1.15
		&& input.elapsedMs < pressDragMs;
	if (quickVerticalScroll) return 'scroll';
	const horizontalDragIntent = absX >= intentDistance && absX > absY * 1.05;
	const pressDragIntent = input.elapsedMs >= pressDragMs && distance >= intentDistance;
	return input.elapsedMs >= pressDragMs && (horizontalDragIntent || pressDragIntent)
		? 'drag'
		: 'pending';
}

export function resolveCalendarMobileEmptyAreaSwipeIntent(input: {
	deltaX: number;
	deltaY: number;
	swipeDistancePx: number;
	dominanceRatio: number;
}): CalendarMobileEmptyAreaSwipeIntent {
	const absX = Math.abs(input.deltaX);
	const absY = Math.abs(input.deltaY);
	const distance = Math.max(1, input.swipeDistancePx);
	const dominanceRatio = Math.max(1, input.dominanceRatio);
	if (absX < distance || absX <= absY * dominanceRatio) return 'pending';
	return input.deltaX < 0 ? 'next' : 'previous';
}

export function resolveCalendarTrackedSessionPointerDragIntent(input: {
	deltaX: number;
	deltaY: number;
	intentDistancePx: number;
}): CalendarTrackedSessionPointerDragIntent {
	const distance = Math.hypot(input.deltaX, input.deltaY);
	const intentDistance = Math.max(1, input.intentDistancePx);
	return distance >= intentDistance ? 'drag' : 'pending';
}

export function shouldOwnCalendarMobileEmptyAreaHorizontalSwipe(input: {
	deltaX: number;
	deltaY: number;
	ownershipDistancePx: number;
	dominanceRatio: number;
}): boolean {
	const absX = Math.abs(input.deltaX);
	const absY = Math.abs(input.deltaY);
	const distance = Math.max(1, input.ownershipDistancePx);
	const dominanceRatio = Math.max(1, input.dominanceRatio);
	return absX > distance && absX > absY * dominanceRatio;
}

function parseCalendarMobileDateKey(dateKey: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
		? date
		: null;
}

function formatCalendarMobileDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function buildCalendarMobileWeekDates(anchorDate: string, weekOffset = 0): string[] {
	const anchor = parseCalendarMobileDateKey(anchorDate) ?? parseCalendarMobileDateKey(localToday());
	if (!anchor) return [];
	const dayOfWeek = anchor.getDay();
	const mondayDelta = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	const monday = new Date(anchor);
	monday.setDate(anchor.getDate() + mondayDelta + (Math.round(weekOffset) * 7));
	return Array.from({ length: 7 }, (_, index) => {
		const date = new Date(monday);
		date.setDate(monday.getDate() + index);
		return formatCalendarMobileDateKey(date);
	});
}

export function shiftCalendarMobileWeekAnchor(anchorDate: string, weekDelta: number): string {
	const anchor = parseCalendarMobileDateKey(anchorDate);
	if (!anchor) return anchorDate;
	const next = new Date(anchor);
	next.setDate(anchor.getDate() + (Math.round(weekDelta) * 7));
	return formatCalendarMobileDateKey(next);
}

interface AllDayPlacement {
	item: CalendarItem;
	lane: number;
	laneCount: number;
	startColumn: number;
	endColumn: number;
}

interface TimedSegmentPlacement {
	item: CalendarItem;
	dayIndex: number;
	lane: number;
	laneCount: number;
	startMinutes: number;
	endMinutes: number;
	visualLayer: TimedGridVisualLayer;
}

type TimedGridVisualPlacement = TimedGridVisualLayoutPlacement<TimedSegmentPlacement>;

export type TimeGridLaneId = 'planned' | 'external';
export type TimeTrackerGridLaneId = TimeGridLaneId | 'tracked';

export function resolveTimeGridLaneIds(options: {
	showExternal: boolean;
}): TimeGridLaneId[] {
	return options.showExternal ? ['planned', 'external'] : ['planned'];
}

export function resolveTimeTrackerGridLaneIdsForDate(options: {
	dateKey?: string;
	today: string;
	showExternal: boolean;
}): TimeTrackerGridLaneId[] {
	const isFuture = options.dateKey ? options.dateKey > options.today : false;
	return isFuture
		? (options.showExternal ? ['planned', 'external'] : ['planned'])
		: (options.showExternal ? ['planned', 'external', 'tracked'] : ['planned', 'tracked']);
}

export function buildTimeTrackerGridLaneFractions(laneCounts: number[]): number[][] {
	return laneCounts.map(laneCount => {
		const safeLaneCount = Math.max(1, Math.floor(laneCount));
		const fraction = 1 / safeLaneCount;
		return Array.from({ length: safeLaneCount }, () => fraction);
	});
}

export interface TimeTrackerGridSummaryRange {
	start?: string | null;
	end?: string | null;
	isActive?: boolean;
}

export interface TimeTrackerGridDailySummary {
	dateKey: string;
	plannedSeconds: number;
	externalSeconds: number;
	trackedCompletedSeconds: number;
	trackedActiveSeconds: number;
	trackedTotalSeconds: number;
	deltaSeconds: number;
	hasActiveTrackedTime: boolean;
}

interface TimeTrackerGridLane {
	id: TimeTrackerGridLaneId;
	semanticIndex: number;
	label: string;
}

interface TimeTrackerGridLaneModel {
	semanticLanes: TimeTrackerGridLane[];
	plannedLane: TimeTrackerGridLane;
	trackedLane: TimeTrackerGridLane | null;
	externalLane: TimeTrackerGridLane | null;
	semanticLaneCount: number;
}

interface TimeTrackerGridDayLaneModel extends TimeTrackerGridLaneModel {
	dateKey: string;
	dayIndex: number;
	isFuture: boolean;
}

interface TimeTrackerGridLaneColumnRef {
	element: HTMLElement;
	dateKey: string;
	dayIndex: number;
}

type TimeTrackerGridLaneColumns = Record<TimeTrackerGridLaneId, TimeTrackerGridLaneColumnRef[]>;

export function clipTimeTrackerGridRangeToDateSeconds(
	startValue: string | null | undefined,
	endValue: string | null | undefined,
	dateKey: string,
): number {
	if (!startValue || !endValue) return 0;
	const start = parseLocalDatetime(startValue);
	const end = parseLocalDatetime(endValue);
	const dayStart = parseLocalDatetime(`${dateKey}T00:00:00`);
	if (!start || !end || !dayStart || end.getTime() <= start.getTime()) return 0;
	const dayEnd = new Date(dayStart.getTime());
	dayEnd.setDate(dayEnd.getDate() + 1);
	const clippedStart = Math.max(start.getTime(), dayStart.getTime());
	const clippedEnd = Math.min(end.getTime(), dayEnd.getTime());
	return Math.max(0, Math.floor((clippedEnd - clippedStart) / 1000));
}

export function buildTimeTrackerGridDailySummaries(options: {
	visibleDates: string[];
	plannedRanges: TimeTrackerGridSummaryRange[];
	externalRanges: TimeTrackerGridSummaryRange[];
	trackedRanges: TimeTrackerGridSummaryRange[];
}): TimeTrackerGridDailySummary[] {
	const summaries = options.visibleDates.map((dateKey): TimeTrackerGridDailySummary => ({
		dateKey,
		plannedSeconds: 0,
		externalSeconds: 0,
		trackedCompletedSeconds: 0,
		trackedActiveSeconds: 0,
		trackedTotalSeconds: 0,
		deltaSeconds: 0,
		hasActiveTrackedTime: false,
	}));

	const addRanges = (
		ranges: TimeTrackerGridSummaryRange[],
		apply: (summary: TimeTrackerGridDailySummary, seconds: number, range: TimeTrackerGridSummaryRange) => void,
	) => {
		for (const range of ranges) {
			for (const summary of summaries) {
				const seconds = clipTimeTrackerGridRangeToDateSeconds(range.start, range.end, summary.dateKey);
				if (seconds <= 0) continue;
				apply(summary, seconds, range);
			}
		}
	};

	addRanges(options.plannedRanges, (summary, seconds) => {
		summary.plannedSeconds += seconds;
	});
	addRanges(options.externalRanges, (summary, seconds) => {
		summary.externalSeconds += seconds;
	});
	addRanges(options.trackedRanges, (summary, seconds, range) => {
		if (range.isActive) {
			summary.trackedActiveSeconds += seconds;
			summary.hasActiveTrackedTime = true;
		} else {
			summary.trackedCompletedSeconds += seconds;
		}
	});

	for (const summary of summaries) {
		summary.trackedTotalSeconds = summary.trackedCompletedSeconds;
		summary.deltaSeconds = summary.trackedTotalSeconds - summary.plannedSeconds;
	}

	return summaries;
}

export function formatTimeTrackerGridCompactDurationSeconds(seconds: number): string {
	const totalMinutes = Math.max(0, Math.round(seconds / 60));
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${hours}h`;
}

export const TIME_TRACKER_GRID_TRACKED_CONTEXT_MENU_ACTION_IDS: readonly ContextualMenuActionId[] = [
	'taskStatus',
	'pinToggle',
	'openEditor',
	'convertInlineToFileTask',
	'convertFileToInlineTask',
	'subtasks',
	'createSubtask',
	'checkboxes',
	'startTimer',
	'markDone',
	'jumpToSource',
];

const TIME_TRACKER_GRID_TRACKED_CONTEXT_MENU_ACTION_ID_SET = new Set<ContextualMenuActionId>(
	TIME_TRACKER_GRID_TRACKED_CONTEXT_MENU_ACTION_IDS,
);

export function filterTimeTrackerGridTrackedContextMenuActionIds(
	actionIds: readonly ContextualMenuActionId[],
): ContextualMenuActionId[] {
	return actionIds.filter(actionId => TIME_TRACKER_GRID_TRACKED_CONTEXT_MENU_ACTION_ID_SET.has(actionId));
}

export interface CalendarTrackedSessionRef {
	operonId: string;
	sessionIndex?: number;
	start: string;
	end: string;
}

interface CalendarTrackedSessionGridItem {
	ref: CalendarTrackedSessionRef;
	start: string;
	end: string;
	task: IndexedTask | null;
	durationSeconds: number;
	isActive: boolean;
	isUnassigned: boolean;
}

interface TrackedSessionSegmentPlacement {
	session: CalendarTrackedSessionGridItem;
	dayIndex: number;
	startMinutes: number;
	endMinutes: number;
	visualLayer: TimedGridVisualLayer;
}

type TrackedSessionVisualPlacement = TimedGridVisualLayoutPlacement<TrackedSessionSegmentPlacement>;

interface CalendarResolvedColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

interface CalendarAllDayDropContext {
	body: HTMLElement;
	overlay: HTMLElement;
	visibleDates: string[];
	laneHeight: number;
	previewLane: number;
	cells?: HTMLElement[];
	activeColumn?: number | null;
	isMobile?: boolean;
}

interface CalendarTimedDropContext {
	section: HTMLElement;
	gutter: HTMLElement;
	daysGrid: HTMLElement;
	previewOverlay?: HTMLElement;
	hoverGuideOverlay: HTMLElement;
	visibleDates: string[];
	metrics: CalendarTimedMetrics;
	preset: CalendarPreset;
	settings: OperonSettings;
	isMobile?: boolean;
	resolvePosition?: (clientX: number, clientY: number) => { dayIndex: number; minuteOfDay: number } | null;
	applyTransferPreviewStyle?: (element: HTMLElement, dayIndex: number, startMinutes: number, endMinutes: number) => void;
}

interface CalendarMultiWeekInDayDropContext {
	body: HTMLElement;
	dayLists: HTMLElement[];
	visibleDates: string[];
	preset: CalendarPreset;
	settings: OperonSettings;
}

interface CalendarMultiWeekGroup {
	visibleDates: string[];
}

interface CalendarHiddenTimeRange {
	enabled: boolean;
	startMinutes: number;
	endMinutes: number;
}

interface CalendarTimedMetrics {
	hiddenRange: CalendarHiddenTimeRange;
	isHiddenExpanded: boolean;
	scale: number;
	collapsedBandHeight: number;
	gridHeight: number;
}

type CalendarWheelAxisLock = 'horizontal' | 'vertical' | null;
type CalendarSidebarSectionId = typeof CALENDAR_SIDEBAR_SECTION_ORDER[number];

interface TimedHorizontalGestureState {
	axisLock: CalendarWheelAxisLock;
	offsetPx: number;
	lastWheelTs: number;
	snapTimer: number | null;
	resetTimer: number | null;
}

interface TimedHorizontalRenderWindow {
	anchorDate: string;
	visibleDates: string[];
	bufferedDates: string[];
	visibleStartBufferIndex: number;
	bufferDaysBefore: number;
	bufferDaysAfter: number;
}

interface CalendarMobileTimeGridRenderWindow {
	anchorDate: string;
	visibleDates: string[];
	bufferedDates: string[];
	visibleStartBufferIndex: number;
	bufferDaysBefore: number;
	bufferDaysAfter: number;
}

type CalendarDragEndReason = 'commit' | 'cancel' | 'abort';

interface CalendarActiveDragSession {
	pointerId: number;
	finish: (reason: CalendarDragEndReason, event?: PointerEvent | null, flushPendingRender?: boolean) => void;
}

interface CalendarOptimisticTaskPatch {
	fieldValues: Record<string, string>;
	checkbox?: IndexedTask['checkbox'];
	expiresAt: number;
	renderSignature?: string[];
	source?: 'drop' | 'status-sidebar' | 'status-surface';
}

interface CalendarStatusDomPatchResult {
	patchedCount: number;
	fallbackReason: string;
}

interface CalendarStatusCycleTrace {
	traceId?: string;
	taskId: string;
}

type CalendarMobileQuickSettingsPatch = Partial<Pick<
	OperonSettings,
	| 'calendarMobileShowProjectedOccurrences'
	| 'calendarMobileShowExternalCalendars'
	| 'calendarMobileColorSource'
	| CalendarMobileSourcePresetSettingKey
>>;
type CalendarDropSourcePayload = Record<string, string | undefined>;
type CalendarDropCallbackResult = void | boolean;

interface MobileTimeGridScrollPreserveOptions {
	minRenderBudget?: number;
	restoreWindowMs?: number;
}

export interface CalendarViewCallbacks {
	getExternalCalendarItems?: (rangeStart: string, rangeEnd: string, presetId?: string, showExternalCalendarsOverride?: boolean) => CalendarItem[];
	getTrackedSessions?: (rangeStart: string, rangeEnd: string) => TrackerSession[];
	getActiveTrackerState?: () => ActiveTrackerState | null;
	onTimedSlotSelection?: (selection: CalendarSlotSelection) => void | Promise<void>;
	onTrackedSlotSelection?: (selection: CalendarSlotSelection) => void | Promise<void>;
	onMobileTimedSlotCreate?: (selection: CalendarSlotSelection) => void | Promise<void>;
	onTimedItemMove?: (taskId: string, selection: CalendarSlotSelection, sourcePayload?: CalendarDropSourcePayload) => CalendarDropCallbackResult | Promise<CalendarDropCallbackResult>;
	onTimedItemResizeStart?: (taskId: string, selection: CalendarSlotSelection, sourcePayload?: CalendarDropSourcePayload) => CalendarDropCallbackResult | Promise<CalendarDropCallbackResult>;
	onTimedItemResizeEnd?: (taskId: string, selection: CalendarSlotSelection, sourcePayload?: CalendarDropSourcePayload) => CalendarDropCallbackResult | Promise<CalendarDropCallbackResult>;
	onTrackedSessionMove?: (session: CalendarTrackedSessionRef, selection: CalendarSlotSelection) => void | Promise<void>;
	onTrackedSessionResize?: (session: CalendarTrackedSessionRef, selection: CalendarSlotSelection) => void | Promise<void>;
	onTrackedSessionOpen?: (session: CalendarTrackedSessionRef) => void | Promise<void>;
	onAllDaySlotSelection?: (selection: CalendarSlotSelection) => void | Promise<void>;
	onAllDayScheduledMove?: (taskId: string, selection: CalendarSlotSelection) => void | Promise<void>;
	onAllDayScheduledResizeRight?: (taskId: string, selection: CalendarSlotSelection) => void | Promise<void>;
	onTimedItemDropToAllDay?: (taskId: string, selection: CalendarSlotSelection) => void | Promise<void>;
	onAllDayItemDropToTimed?: (taskId: string, selection: CalendarSlotSelection, sourcePayload?: CalendarDropSourcePayload) => CalendarDropCallbackResult | Promise<CalendarDropCallbackResult>;
	onItemAction?: ContextualMenuActionHandler;
	onStatusIconClick?: (taskId: string) => void | Promise<void>;
	onOpenPresetSettings?: (presetId: string) => void | Promise<void>;
	onSidebarTaskDropToTimed?: (taskId: string, selection: CalendarSlotSelection) => void | Promise<void>;
	onSidebarTaskDropToAllDay?: (taskId: string, selection: CalendarSlotSelection) => void | Promise<void>;
	onSidebarWidthChange?: (widthPx: number) => void | Promise<void>;
	onOpenDailyNote?: (dateKey: string) => void | Promise<void>;
	onToggleAllDayLaneVisibility?: (nextValue: boolean) => void | Promise<void>;
	onToggleDueLaneVisibility?: (nextValue: boolean) => void | Promise<void>;
	onToggleProjectedOccurrences?: (presetId: string, nextValue: boolean) => void | Promise<void>;
	onToggleExternalCalendars?: (presetId: string, nextValue: boolean) => void | Promise<void>;
	onCycleTaskColorSource?: (presetId: string, nextSource: CalendarPreset['colorSource']) => void | Promise<void>;
	onMobileCalendarSettingsChange?: (patch: CalendarMobileQuickSettingsPatch) => void | Promise<void>;
	onSyncExternalCalendars?: () => void | Promise<void>;
	onExternalItemCreateTask?: (seed: ExternalCalendarTaskSeed) => void | Promise<void>;
	onCalendarDragInteractionEnd?: () => void | Promise<void>;
	hasEditableFocus?: () => boolean;
}

export class CalendarView extends ItemView {
	private readonly indexer: OperonIndexer;
	private readonly getSettings: () => OperonSettings;
	private readonly getPinnedCache: () => PinnedCache | null;
	private readonly getRepeatSeriesEntries: () => RepeatSeriesEntry[];
	private readonly getExternalCalendarItems: (rangeStart: string, rangeEnd: string, presetId?: string, showExternalCalendarsOverride?: boolean) => CalendarItem[];
	private readonly callbacks: CalendarViewCallbacks;
	private state: CalendarLeafState | null = null;
	private timedScrollEl: HTMLElement | null = null;
	private surfaceScrollEl: HTMLElement | null = null;
	private lastAppliedScrollSignature: string | null = null;
	private nowIndicatorTimer: number | null = null;
	private nowIndicatorEntries: Array<{
		lineEl: HTMLElement;
		labelEl: HTMLElement | null;
		metrics: CalendarTimedMetrics;
	}> = [];
	private persistStateTimer: number | null = null;
	private renderFrame: number | null = null;
	private preserveScrollOnNextRender = false;
	private allDayDropContext: CalendarAllDayDropContext | null = null;
	private timedDropContext: CalendarTimedDropContext | null = null;
	private multiWeekAllDayDropContexts: CalendarAllDayDropContext[] = [];
	private multiWeekInDayDropContexts: CalendarMultiWeekInDayDropContext[] = [];
	private expandedHiddenTimeKey: string | null = null;
	private lastRenderPresetKey: string | null = null;
	private taskPoolQuery = '';
	private sidebarOpenSectionOrder: CalendarSidebarSectionId[] = [];
	private sidebarWidthOverridePx: number | null = null;
	private sidebarResizeCleanup: (() => void) | null = null;
	private sidebarSectionsLayoutCleanup: (() => void) | null = null;
	private toolbarLayoutCleanup: (() => void) | null = null;
	private layoutRefreshCleanup: (() => void) | null = null;
	private layoutRefreshFrame: number | null = null;
	private calendarNavigationKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private calendarNavigationDocument: Document | null = null;
	private readonly hoverMenu = new ContextualHoverMenuController({
		getDelayMs: () => this.getSettings().contextualMenuOpenDelayMs,
		getHost: () => this.contentEl,
		positionMenu: (anchorRect, menu) => this.positionCalendarHoverMenu(anchorRect, menu),
	});
	private restoreScrollOnNextRender = false;
	private restoreSurfaceScrollOnNextRender = false;
	private lastSurfaceScrollTop = 0;
	private timedHorizontalGesture: TimedHorizontalGestureState = {
		axisLock: null,
		offsetPx: 0,
		lastWheelTs: 0,
		snapTimer: null,
		resetTimer: null,
	};
	private timedHorizontalRenderWindow: TimedHorizontalRenderWindow | null = null;
	private timedHorizontalStripEl: HTMLElement | null = null;
	private timedHorizontalLabelStripEl: HTMLElement | null = null;
	private timedHorizontalClipEl: HTMLElement | null = null;
	private timedHorizontalDayWidthPx = 0;
	private lastTimedGridUserScrollInteractionAt = 0;
	private mobileTimeGridScrollEl: HTMLElement | null = null;
	private lastMobileTimeGridScrollTop = 0;
	private mobileTimeGridScrollRestoreTargetTop: number | null = null;
	private readonly mobileTimeGridOuterScrollRestoreTargets = new Map<HTMLElement, number>();
	private restoreMobileTimeGridScrollOnNextRender = false;
	private mobileTimeGridScrollRestoreBudget = 0;
	private mobileTimeGridScrollRestoreUntil = 0;
	private forceMobileTimeGridSmartScrollOnNextRender = false;
	private isMobileAllDayRailCollapsed = false;
	private lastMobileAgendaFocusKey: string | null = null;
	private activeCalendarDragSession: CalendarActiveDragSession | null = null;
	private pendingRenderAfterCalendarDrag = false;
	private pendingRenderAfterEditableFocus = false;
	private editableFocusRenderRetryTimer: number | null = null;
	private readonly calendarDragGhosts = new Set<HTMLElement>();
	private readonly optimisticTaskPatches = new Map<string, CalendarOptimisticTaskPatch>();
	private optimisticPatchCleanupTimer: number | null = null;
	private mobileDateStripScrollTimer: number | null = null;
	private renderGeneration = 0;
	private readonly renderAnimationFrames = new Set<number>();
	private readonly renderTimeouts = new Set<number>();
	private suppressTimedScrollPersistenceUntil = 0;
	private suppressTimedScrollPersistenceStartedAt = 0;

	constructor(
		leaf: WorkspaceLeaf,
		indexer: OperonIndexer,
		getSettings: () => OperonSettings,
		getPinnedCache: () => PinnedCache | null,
		getRepeatSeriesEntries: () => RepeatSeriesEntry[],
		getExternalCalendarItems: ((rangeStart: string, rangeEnd: string, presetId?: string, showExternalCalendarsOverride?: boolean) => CalendarItem[]) | undefined,
		callbacks: CalendarViewCallbacks = {},
	) {
		super(leaf);
		this.indexer = indexer;
		this.getSettings = getSettings;
		this.getPinnedCache = getPinnedCache;
		this.getRepeatSeriesEntries = getRepeatSeriesEntries;
		this.getExternalCalendarItems = getExternalCalendarItems ?? (() => []);
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.getCurrentPresetTitle();
	}

	getIcon(): string {
		return 'calendar';
	}

	getState(): Record<string, unknown> {
		return { ...this.ensureState() };
	}

		async setState(state: Partial<CalendarLeafState> | null | undefined, _result: unknown): Promise<void> {
			const nextState = this.syncSidebarOpenSections(this.normalizeState(state));
			const changed = !this.areLeafStatesEqual(this.state, nextState);
			this.state = nextState;
			this.syncLeafTitle();
			if (changed && this.containerEl.isConnected) {
				this.captureActiveMultiWeekSurfaceScroll();
				this.clearScheduledRender();
				this.preserveScrollOnNextRender = false;
				if (this.hasActiveCalendarDragInteraction()) {
					this.pendingRenderAfterCalendarDrag = true;
					return;
				}
				this.render();
			}
		}

	async onOpen(): Promise<void> {
		const persistedLeafState = this.leaf.getViewState().state as Partial<CalendarLeafState> | undefined;
		const shouldOpenFinishedTaskPoolMode = persistedLeafState?.finishedTasksOpen === true
			|| this.state?.finishedTasksOpen === true;
		const openingState: Partial<CalendarLeafState> = {
			...(persistedLeafState ?? {}),
			...(this.state ?? {}),
		};
		if (shouldOpenFinishedTaskPoolMode) {
			openingState.finishedTasksOpen = true;
			openingState.taskPoolMode = 'finished';
		}
		this.state = this.syncSidebarOpenSections(this.normalizeState(openingState));
		this.taskPoolQuery = '';
		this.preserveScrollOnNextRender = false;
		this.bindCalendarNavigationKeys();
		this.syncLeafTitle();
		this.registerEvent(this.app.workspace.on('css-change', () => { this.markDirty(); }));
		this.render();
	}

	async onClose(): Promise<void> {
		this.finishActiveCalendarDragSession('abort', null, false);
		await this.flushPendingLeafStatePersistence();
		this.invalidateRenderGeneration();
		this.pendingRenderAfterCalendarDrag = false;
		this.pendingRenderAfterEditableFocus = false;
		this.clearEditableFocusRenderRetryTimer();
		this.clearCalendarDragGhosts();
		this.clearOptimisticTaskPatches();
		this.clearRenderTimers();
		this.clearScheduledRender();
		this.clearPersistStateTimer();
		this.clearTimedHorizontalGestureTimers();
		this.clearSidebarResizeDrag();
		this.hideCalendarHoverMenu(true);
		closeFloatingPanelsForRoot(this.contentEl);
		closeIconOnlyChipPreviewsForRoot(this.contentEl);
		this.expandedHiddenTimeKey = null;
		this.lastRenderPresetKey = null;
		this.taskPoolQuery = '';
		this.sidebarWidthOverridePx = null;
		this.unbindCalendarNavigationKeys();
	}

	preserveMobileTimeGridScrollForNextRender(options: MobileTimeGridScrollPreserveOptions = {}): void {
		if (this.hasPendingMobileTimeGridScrollRestore()) {
			this.extendMobileTimeGridScrollRestore(options);
			return;
		}
		this.captureMobileTimeGridScrollForRender(options);
	}

	preserveMobileTimeGridScrollForTaskCreate(): void {
		this.preserveMobileTimeGridScrollForNextRender({
			minRenderBudget: 6,
			restoreWindowMs: CALENDAR_MOBILE_SLOT_CREATE_SCROLL_RESTORE_WINDOW_MS,
		});
	}

	markDirty(): void {
		if (this.hasActiveCalendarDragInteraction()) {
			this.pendingRenderAfterCalendarDrag = true;
			return;
		}
		if (this.hasActiveEditableFocus()) {
			this.deferPassiveRenderUntilEditableFocusClears();
			return;
		}
		if (this.renderFrame !== null) return;
		this.captureActiveCalendarScrollForRender();
		this.preserveScrollOnNextRender = true;
		this.renderFrame = window.requestAnimationFrame(() => {
			this.renderFrame = null;
			this.render();
		});
	}

		markDirtyForStatusCycle(trace: CalendarStatusCycleTrace): boolean {
			const startedAt = enginePerfNow();
			const patch = this.optimisticTaskPatches.get(trace.taskId);
			const logResult = (
				action: 'dom-reconcile' | 'full-render',
				reason: string,
				signatureChanged: boolean,
				patchedCount = 0,
			): void => {
				enginePerfLog(
					'calendar.statusReconcile',
					`traceId=${trace.traceId ?? 'none'}`,
					`taskId=${trace.taskId}`,
					`action=${action}`,
					`reason=${reason}`,
					`signatureChanged=${String(signatureChanged)}`,
					`domPatched=${patchedCount}`,
					`reconcileMs=${Math.round(enginePerfNow() - startedAt)}`,
				);
			};
		if (!patch) {
			logResult('full-render', 'no-optimistic-patch', false);
			return false;
		}
		if (patch.source !== 'status-surface') {
			logResult('full-render', patch.source ? `source-${patch.source}` : 'source-unknown', false);
			return false;
		}
		if (this.shouldFullRenderMobileStatusPatch(patch)) {
			logResult('full-render', 'mobile-completed-visibility', false);
			return false;
		}
		const task = this.indexer.getTask(trace.taskId);
		if (!task || !isOptimisticTaskPatchPersisted(task, patch)) {
			logResult('full-render', task ? 'not-persisted' : 'task-missing', false);
			return false;
		}
			const nextSignature = this.buildRenderedCalendarTaskSignature(trace.taskId);
			const signatureChanged = !this.areCalendarTaskRenderSignaturesEqual(patch.renderSignature ?? [], nextSignature);
			if (signatureChanged) {
				logResult('full-render', 'signature-changed', true);
				return false;
			}
			const domPatch = this.applyCalendarStatusDomPatch(trace.taskId, patch);
			if (domPatch.patchedCount === 0 && nextSignature.length > 0) {
				logResult('full-render', domPatch.fallbackReason, false);
				return false;
			}
			this.optimisticTaskPatches.delete(trace.taskId);
			this.scheduleOptimisticTaskPatchCleanup();
			logResult('dom-reconcile', domPatch.fallbackReason, false, domPatch.patchedCount);
			return true;
		}

		private beginCalendarDragSession(
			targetEl: HTMLElement,
			pointerId: number,
			onEnd: (reason: CalendarDragEndReason, event: PointerEvent | null) => void,
		): void {
			this.finishActiveCalendarDragSession('abort', null, false);
			if (this.renderFrame !== null) {
				this.clearScheduledRender();
				this.pendingRenderAfterCalendarDrag = true;
			}

			let session: CalendarActiveDragSession;
			const ownerWindow = getOwnerWindow(targetEl);
			const finish = (
				reason: CalendarDragEndReason,
				event: PointerEvent | null = null,
				flushPendingRender = true,
			): void => {
				if (event && event.pointerId !== pointerId) return;
				if (this.activeCalendarDragSession !== session) return;
				ownerWindow.removeEventListener('pointerup', onPointerUp, true);
				ownerWindow.removeEventListener('pointercancel', onPointerCancel, true);
				ownerWindow.removeEventListener('blur', onWindowBlur, true);
				targetEl.removeEventListener('lostpointercapture', onLostPointerCapture);
				this.activeCalendarDragSession = null;
				onEnd(reason, event);
				if (flushPendingRender) {
					this.flushPendingCalendarDragRender();
				}
			};
			const onPointerUp = (event: PointerEvent): void => finish('commit', event);
			const onPointerCancel = (event: PointerEvent): void => finish('cancel', event);
			const onWindowBlur = (): void => finish('abort', null);
			const onLostPointerCapture = (event: PointerEvent): void => finish('abort', event);

			session = { pointerId, finish };
			this.activeCalendarDragSession = session;
			ownerWindow.addEventListener('pointerup', onPointerUp, true);
			ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
			ownerWindow.addEventListener('blur', onWindowBlur, true);
			targetEl.addEventListener('lostpointercapture', onLostPointerCapture);
		}

		private finishActiveCalendarDragSession(
			reason: CalendarDragEndReason,
			event: PointerEvent | null = null,
			flushPendingRender = true,
		): void {
			this.activeCalendarDragSession?.finish(reason, event, flushPendingRender);
		}

	private flushPendingCalendarDragRender(): void {
		if (this.hasActiveCalendarDragInteraction()) return;
		const shouldRender = this.pendingRenderAfterCalendarDrag;
		this.pendingRenderAfterCalendarDrag = false;
		if (shouldRender) {
			this.markDirty();
		}
		void this.callbacks.onCalendarDragInteractionEnd?.();
	}

	private hasActiveEditableFocus(): boolean {
		return this.callbacks.hasEditableFocus?.() === true;
	}

	private deferPassiveRenderUntilEditableFocusClears(): void {
		this.pendingRenderAfterEditableFocus = true;
		this.updateNowIndicators();
		this.scheduleEditableFocusRenderRetry();
	}

	private scheduleEditableFocusRenderRetry(delayMs = 240): void {
		if (this.editableFocusRenderRetryTimer !== null) return;
		this.editableFocusRenderRetryTimer = window.setTimeout(() => {
			this.editableFocusRenderRetryTimer = null;
			this.flushPendingEditableFocusRender();
		}, delayMs);
	}

	private flushPendingEditableFocusRender(): void {
		if (!this.pendingRenderAfterEditableFocus) return;
		if (this.hasActiveEditableFocus()) {
			this.updateNowIndicators();
			this.scheduleEditableFocusRenderRetry();
			return;
		}
		this.pendingRenderAfterEditableFocus = false;
		if (this.hasActiveCalendarDragInteraction()) {
			this.pendingRenderAfterCalendarDrag = true;
			return;
		}
		this.markDirty();
	}

	private releaseCalendarPointerCapture(targetEl: HTMLElement, pointerId: number): void {
		try {
			if (targetEl.hasPointerCapture?.(pointerId)) {
				targetEl.releasePointerCapture(pointerId);
			}
		} catch {
			// Pointer capture can already be gone after window-level abort paths.
		}
	}

		private getOptimisticCalendarTasksForRender(): IndexedTask[] {
			this.pruneOptimisticTaskPatches();
			const tasks = this.indexer.getAllTasks();
			if (this.optimisticTaskPatches.size === 0) return tasks;
			return tasks.map(task => {
				const patch = this.optimisticTaskPatches.get(task.operonId);
				if (!patch) return task;
				return applyOptimisticRenderPatch(task, patch);
			});
		}

		private applyOptimisticTaskPatch(taskId: string, patchInput: OptimisticTaskPatchInput): boolean {
			const task = this.indexer.getTask(taskId);
			if (!task) return false;
			const normalized = normalizeOptimisticFieldValues(patchInput.fieldValues);
			if (Object.keys(normalized).length === 0 && !patchInput.checkbox) return false;

			this.optimisticTaskPatches.set(taskId, {
				fieldValues: normalized,
				checkbox: patchInput.checkbox,
				expiresAt: Date.now() + 10000,
				source: 'drop',
			});
			this.scheduleOptimisticTaskPatchCleanup();
			this.captureActiveCalendarScrollForRender();
			this.preserveScrollOnNextRender = true;
			this.render();
			return true;
		}

		private applyOptimisticStatusTaskPatch(
			taskId: string,
			patchInput: OptimisticTaskPatchInput,
			source: 'status-sidebar' | 'status-surface',
		): {
			applied: boolean;
			domPatched: number;
			fallbackReason: string;
			renderMode: 'dom' | 'full';
		} {
			const task = this.indexer.getTask(taskId);
			if (!task) {
				return { applied: false, domPatched: 0, fallbackReason: 'task-missing', renderMode: 'dom' };
			}
			const normalized = normalizeOptimisticFieldValues(patchInput.fieldValues);
			if (Object.keys(normalized).length === 0 && !patchInput.checkbox) {
				return { applied: false, domPatched: 0, fallbackReason: 'patch-empty', renderMode: 'dom' };
			}
		const patch: CalendarOptimisticTaskPatch = {
			fieldValues: normalized,
			checkbox: patchInput.checkbox,
			expiresAt: Date.now() + 10000,
			renderSignature: this.buildRenderedCalendarTaskSignature(taskId),
			source,
		};
		this.optimisticTaskPatches.set(taskId, patch);
		this.scheduleOptimisticTaskPatchCleanup();
		if (this.shouldFullRenderMobileStatusPatch(patch)) {
			this.captureActiveCalendarScrollForRender();
			this.preserveScrollOnNextRender = true;
			this.render();
			return {
				applied: true,
				domPatched: 0,
				fallbackReason: 'mobile-completed-visibility',
				renderMode: 'full',
			};
		}
		const domPatch = this.applyCalendarStatusDomPatch(taskId, patch);
		if (domPatch.patchedCount === 0) {
			this.captureActiveCalendarScrollForRender();
			this.preserveScrollOnNextRender = true;
			this.render();
			return {
				applied: true,
					domPatched: 0,
					fallbackReason: domPatch.fallbackReason,
				renderMode: 'full',
			};
		}
		return {
			applied: true,
			domPatched: domPatch.patchedCount,
			fallbackReason: domPatch.fallbackReason,
			renderMode: 'dom',
		};
	}

	private shouldFullRenderMobileStatusPatch(patch: CalendarOptimisticTaskPatch): boolean {
		if (!this.isMobileCalendarCurrentlyRendered()) return false;
		const patchedCheckbox = patch.checkbox ?? patch.fieldValues['_checkbox'];
		if (patchedCheckbox !== 'done' && patchedCheckbox !== 'cancelled') return false;
		const settings = this.getSettings();
		const viewMode = this.resolveMobileCalendarViewMode(this.ensureState(), settings);
		return viewMode === 'agenda'
			? settings.calendarMobileAgendaShowCompletedItems !== true
			: settings.calendarMobileShowCompletedItems !== true;
	}

	private buildOptimisticStatusPatch(taskId: string): OptimisticStatusPatchResult | null {
		const task = this.indexer.getTask(taskId);
		if (!task) return null;
		return buildOptimisticStatusPatch(task, this.getSettings());
	}

		private applyCalendarStatusDomPatch(
			taskId: string,
			patch: OptimisticTaskPatchInput,
		): CalendarStatusDomPatchResult {
			const task = this.indexer.getTask(taskId);
			if (!task) return { patchedCount: 0, fallbackReason: 'task-missing' };
			const host = this.contentEl;
			const renderedTask = applyOptimisticRenderPatch(task, patch);
			const settings = this.getSettings();
			const iconName = this.resolveStatusButtonIcon(
				renderedTask.fieldValues,
				renderedTask.checkbox,
				settings,
			);
			const statusColor = this.resolveCalendarStatusColorFromFieldValues(renderedTask.fieldValues, settings);
			const buttons = Array.from(host.querySelectorAll<HTMLElement>('.operon-calendar-status-button'))
				.filter(button => button.dataset.operonId === taskId);
			if (buttons.length === 0) return { patchedCount: 0, fallbackReason: 'dom-miss' };
			const patchedRoots = new Set<HTMLElement>();
			for (const button of buttons) {
				button.empty();
				if (iconName) setIcon(button, iconName);
				if (statusColor) {
					button.style.color = statusColor;
				} else {
					button.style.removeProperty('color');
				}
				const root = button.closest<HTMLElement>(
					'.operon-calendar-timed-item, .operon-calendar-all-day-item, .operon-calendar-mobile-item, .operon-calendar-sidebar-task-pool-row',
				);
				if (root) patchedRoots.add(root);
			}
			const preset = this.resolveCurrentCalendarPreset(settings);
			for (const root of patchedRoots) {
				this.applyCalendarCheckboxClass(root, renderedTask.checkbox);
				if (
					preset
					&& (
						root.hasClass('operon-calendar-timed-item')
						|| root.hasClass('operon-calendar-all-day-item')
						|| root.hasClass('operon-calendar-mobile-item')
					)
				) {
					this.applyCalendarTaskFieldColor(root, renderedTask.fieldValues, preset, settings);
				}
			}
			return { patchedCount: buttons.length, fallbackReason: 'none' };
		}

		private buildRenderedCalendarTaskSignature(taskId: string): string[] {
			const settings = this.getSettings();
			const state = this.ensureState();
			const preset = this.resolveCurrentCalendarPreset(settings);
			const task = this.indexer.getTask(taskId);
			if (!preset || !task) return [];
			const activeFilter = (() => {
				const raw = settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
				if (raw && isSpecialDynamicFilterSet(raw)) return null;
				return raw ? stripFilterViewOnlyOptions(raw) : null;
			})();
			const scopedTasks = filterTasksForCalendar(
				activeFilter,
				[task],
				settings.priorities,
				this.getPinnedCache(),
			);
			const queryAnchorDate = preset.surfaceType === 'multiWeek'
				? this.resolveMultiWeekRangeStart(state.anchorDate, preset, settings.calendarWeekStart)
				: state.anchorDate;
			const queryPreset = preset.surfaceType === 'multiWeek'
				? {
					dayCount: this.getMultiWeekVisibleDayCount(preset),
					showWeekends: preset.showWeekends,
					todayPosition: 1,
					showProjectedOccurrences: preset.showProjectedOccurrences,
				}
				: preset;
			const query = queryCalendarItems(
				scopedTasks,
				queryAnchorDate,
				queryPreset,
				this.getRepeatSeriesEntries(),
			);
			const timedRenderWindow = this.isTimeGridCompatibleSurface(preset)
				? this.buildTimedHorizontalRenderWindow(state.anchorDate, preset, query.visibleDates)
				: null;
			const timedQuery = timedRenderWindow
				? queryCalendarItems(
					scopedTasks,
					state.anchorDate,
					{
						dayCount: timedRenderWindow.bufferedDates.length,
						showWeekends: preset.showWeekends,
						todayPosition: timedRenderWindow.bufferDaysBefore + 1,
						showProjectedOccurrences: preset.showProjectedOccurrences,
					},
					this.getRepeatSeriesEntries(),
				)
				: query;
			const signature: string[] = [];
			for (const item of query.items) {
				if (item.taskId === taskId && item.kind !== 'timed') {
					signature.push(this.buildCalendarItemSignature(item));
				}
			}
			for (const item of timedQuery.items) {
				if (item.taskId === taskId && item.kind === 'timed') {
					signature.push(this.buildCalendarItemSignature(item));
				}
			}
			if (state.navigationMode === 'sidebar') {
				const tasks = this.indexer.getAllTasks();
				signature.push(...this.buildSidebarTaskSignature(taskId, tasks, state));
			}
			return signature.sort();
		}

		private buildCalendarItemSignature(item: CalendarItem): string {
			return [
				'surface',
				item.kind,
				item.startDate,
				item.endDate,
				item.startDateTime ?? '',
				item.endDateTime ?? '',
				item.origin,
			].join('|');
		}

		private buildSidebarTaskSignature(
			taskId: string,
			tasks: IndexedTask[],
			state: CalendarLeafState,
		): string[] {
			const signature: string[] = [];
			if (state.taskPoolOpen) {
				const taskPoolMode = state.taskPoolMode;
				const candidates = collectCalendarSidebarTaskPoolCandidates(tasks, taskPoolMode, {
					finishedDate: state.anchorDate,
				});
				const query = this.taskPoolQuery.trim();
					const allMatches = !query
						? candidates
						: this.rankSidebarTaskPoolMatches(candidates, query);
							const visibleMatches = allMatches.slice(0, this.getSidebarTaskPoolVisibleLimit(query));
						const index = visibleMatches.findIndex(task => task.operonId === taskId);
						if (index >= 0) signature.push(`sidebar|pool|${taskPoolMode}|${index}`);
					}
					return signature;
				}

				private getSidebarTaskPoolVisibleLimit(query: string): number {
					return query
						? CALENDAR_SIDEBAR_TASK_POOL_SEARCH_LIMIT
						: CALENDAR_SIDEBAR_TASK_POOL_INITIAL_LIMIT;
				}

		private areCalendarTaskRenderSignaturesEqual(left: string[], right: string[]): boolean {
			if (left.length !== right.length) return false;
			return left.every((value, index) => value === right[index]);
		}

		private invokeCalendarDropCallback(
			taskId: string,
			fieldValues: CalendarDropSourcePayload,
			callback: (() => CalendarDropCallbackResult | Promise<CalendarDropCallbackResult>) | undefined,
			options: { verifyOptimisticPatchAfterWrite?: boolean } = {},
		): void {
			this.applyOptimisticTaskPatch(taskId, { fieldValues });
			if (!callback) return;
			void Promise.resolve(callback())
				.then(result => {
					if (!options.verifyOptimisticPatchAfterWrite) return;
					this.verifyOptimisticDropPatchAfterWrite(taskId, fieldValues, result);
				})
				.catch(error => {
					console.error('Operon: calendar drop writeback failed', error);
					this.optimisticTaskPatches.delete(taskId);
					this.markDirty();
				});
		}

		private verifyOptimisticDropPatchAfterWrite(
			taskId: string,
			fieldValues: CalendarDropSourcePayload,
			result: CalendarDropCallbackResult,
		): void {
			if (!this.optimisticTaskPatches.has(taskId)) return;
			const task = this.indexer.getTask(taskId);
			const persisted = !!task && isOptimisticTaskPatchPersisted(task, { fieldValues });
			if (result === false || !persisted) {
				this.optimisticTaskPatches.delete(taskId);
				this.markDirty();
				return;
			}
			this.optimisticTaskPatches.delete(taskId);
			this.scheduleOptimisticTaskPatchCleanup();
		}

		private invokeCalendarStatusClickCallback(
			taskId: string,
			source: 'status-sidebar' | 'status-surface',
		): void {
			const startedAt = enginePerfNow();
			const optimistic = this.buildOptimisticStatusPatch(taskId);
			let fallbackReason = 'none';
			let applied = false;
			let domPatched = 0;
			let renderMode: 'dom' | 'full' | 'none' = 'none';
			if (optimistic) {
				const result = this.applyOptimisticStatusTaskPatch(taskId, optimistic.patch, source);
				applied = result.applied;
				domPatched = result.domPatched;
				renderMode = result.renderMode;
				if (!applied || result.fallbackReason !== 'none') fallbackReason = result.fallbackReason;
			} else {
				fallbackReason = this.indexer.getTask(taskId) ? 'next-status-unavailable' : 'task-missing';
			}
			enginePerfLog(
				'calendar.optimisticStatus',
				`taskId=${taskId}`,
				`applied=${String(applied)}`,
				`nextStatus=${optimistic?.nextStatus ?? 'none'}`,
				`nextCheckbox=${optimistic?.nextCheckbox ?? 'none'}`,
				`renderMode=${renderMode}`,
				`domPatched=${domPatched}`,
				`renderMs=${Math.round(enginePerfNow() - startedAt)}`,
				`fallbackReason=${fallbackReason}`,
			);
			if (!this.callbacks.onStatusIconClick) return;
			void Promise.resolve(this.callbacks.onStatusIconClick(taskId)).catch(error => {
				console.error('Operon: calendar status click failed', error);
				this.optimisticTaskPatches.delete(taskId);
				this.markDirty();
			});
		}

		private pruneOptimisticTaskPatches(now = Date.now()): void {
			let changed = false;
			for (const [taskId, patch] of this.optimisticTaskPatches.entries()) {
				const task = this.indexer.getTask(taskId);
				const isExpired = now >= patch.expiresAt;
				const isPersisted = !!task && isOptimisticTaskPatchPersisted(task, patch);
				if (!task || isExpired || isPersisted) {
					this.optimisticTaskPatches.delete(taskId);
					changed = true;
				}
			}
			if (changed) {
				this.scheduleOptimisticTaskPatchCleanup();
			}
		}

		private scheduleOptimisticTaskPatchCleanup(): void {
			if (this.optimisticPatchCleanupTimer !== null) {
				window.clearTimeout(this.optimisticPatchCleanupTimer);
				this.optimisticPatchCleanupTimer = null;
			}
			if (this.optimisticTaskPatches.size === 0) return;

			const nextExpiry = Math.min(...Array.from(this.optimisticTaskPatches.values()).map(patch => patch.expiresAt));
			const delay = Math.max(0, nextExpiry - Date.now());
			this.optimisticPatchCleanupTimer = window.setTimeout(() => {
				this.optimisticPatchCleanupTimer = null;
				this.pruneOptimisticTaskPatches();
				this.markDirty();
			}, delay);
		}

		private clearOptimisticTaskPatches(): void {
			this.optimisticTaskPatches.clear();
			if (this.optimisticPatchCleanupTimer !== null) {
				window.clearTimeout(this.optimisticPatchCleanupTimer);
				this.optimisticPatchCleanupTimer = null;
			}
		}

	render(): void {
		this.finishActiveCalendarDragSession('abort', null, false);
		this.invalidateRenderGeneration();
		const renderGeneration = this.renderGeneration;
		this.pendingRenderAfterCalendarDrag = false;
		this.pendingRenderAfterEditableFocus = false;
		this.clearEditableFocusRenderRetryTimer();
		this.clearCalendarDragGhosts();
		this.clearRenderTimers();
		this.hideCalendarHoverMenu(true);
		const container = this.contentEl;
		closeFloatingPanelsForRoot(container);
		closeIconOnlyChipPreviewsForRoot(container);
		this.surfaceScrollEl = null;
		this.mobileTimeGridScrollEl = null;
		this.allDayDropContext = null;
		this.timedDropContext = null;
		this.multiWeekAllDayDropContexts = [];
		this.multiWeekInDayDropContexts = [];
		const settings = this.getSettings();
		const state = this.ensureState();
		const useMobileCalendar = this.isMobileCalendarLayoutEligible(container, settings);
		const mobileViewMode = this.resolveMobileCalendarViewMode(state, settings);
		const mobileAnchorDate = this.resolveMobileCalendarAnchorDate(state);
		const sourcePreset = useMobileCalendar
			? this.resolveMobileCalendarSourcePreset(settings, mobileViewMode, state)
			: settings.calendarPresets.find(entry => entry.id === state.presetId) ?? settings.calendarPresets[0];
		const preset = sourcePreset && useMobileCalendar
			? this.buildMobileCalendarRenderPreset(sourcePreset, settings)
			: sourcePreset;
		this.syncLeafTitle(useMobileCalendar && preset
			? `${this.getMobileCalendarViewLabel(mobileViewMode)} · ${preset.name}`
			: preset?.name);
		if (!preset) {
			container.empty();
			container.addClass('operon-calendar-view');
			container.createDiv({ text: t('calendar', 'presetsNotConfigured') });
			return;
		}
		const activeFilter = (() => {
			const raw = settings.filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
			if (raw && isSpecialDynamicFilterSet(raw)) return null;
			return raw ? stripFilterViewOnlyOptions(raw) : null;
		})();
		const queryAnchorDate = useMobileCalendar
			? mobileAnchorDate
			: preset.surfaceType === 'multiWeek'
			? this.resolveMultiWeekRangeStart(state.anchorDate, preset, settings.calendarWeekStart)
			: state.anchorDate;
		const renderPresetKey = useMobileCalendar
			? `mobile|${preset.id}|${mobileViewMode}|${queryAnchorDate}`
			: `${preset.id}|${queryAnchorDate}`;
		const preserveScroll = this.restoreScrollOnNextRender
			|| (!useMobileCalendar && this.preserveScrollOnNextRender && this.lastRenderPresetKey === renderPresetKey);
		this.preserveScrollOnNextRender = false;
		this.restoreScrollOnNextRender = false;
		if (this.lastRenderPresetKey && this.lastRenderPresetKey !== renderPresetKey) {
			this.expandedHiddenTimeKey = null;
		}
		this.lastRenderPresetKey = renderPresetKey;
		const renderTasks = this.getOptimisticCalendarTasksForRender();
		const scopedTasks = filterTasksForCalendar(
			activeFilter,
			renderTasks,
			settings.priorities,
			this.getPinnedCache(),
		);
		const queryPreset = useMobileCalendar
			? this.buildMobileCalendarQueryPreset(preset, mobileViewMode, settings)
			: preset.surfaceType === 'multiWeek'
			? {
				dayCount: this.getMultiWeekVisibleDayCount(preset),
				showWeekends: preset.showWeekends,
				todayPosition: 1,
				showProjectedOccurrences: preset.showProjectedOccurrences,
			}
			: preset;
			const mobileAgendaDates = useMobileCalendar && mobileViewMode === 'agenda'
				? this.buildMobileAgendaFixedDates(queryAnchorDate, settings)
				: null;
			const mobileTimeGridRenderWindow = useMobileCalendar && mobileViewMode !== 'agenda'
				? this.buildMobileTimeGridRenderWindow(
					queryAnchorDate,
					buildVisibleCalendarDates(queryAnchorDate, queryPreset.dayCount, true, 1),
				)
				: null;
			const query = mobileAgendaDates
				? queryCalendarItemsForVisibleDates(
					scopedTasks,
					mobileAgendaDates,
					queryPreset,
					this.getRepeatSeriesEntries(),
				)
				: mobileTimeGridRenderWindow
				? queryCalendarItemsForVisibleDates(
					scopedTasks,
					mobileTimeGridRenderWindow.bufferedDates,
					queryPreset,
					this.getRepeatSeriesEntries(),
				)
				: queryCalendarItems(
					scopedTasks,
					queryAnchorDate,
					queryPreset,
					this.getRepeatSeriesEntries(),
			);
		const timedRenderWindow = !useMobileCalendar && this.isTimeGridCompatibleSurface(preset)
			? this.buildTimedHorizontalRenderWindow(state.anchorDate, preset, query.visibleDates)
			: null;
		const timedQuery = timedRenderWindow
			? queryCalendarItems(
				scopedTasks,
				state.anchorDate,
				{
					dayCount: timedRenderWindow.bufferedDates.length,
					showWeekends: preset.showWeekends,
					todayPosition: timedRenderWindow.bufferDaysBefore + 1,
					showProjectedOccurrences: preset.showProjectedOccurrences,
				},
				this.getRepeatSeriesEntries(),
			)
			: query;
		let externalItems = this.getExternalCalendarItems(
			query.rangeStart <= timedQuery.rangeStart ? query.rangeStart : timedQuery.rangeStart,
			query.rangeEnd >= timedQuery.rangeEnd ? query.rangeEnd : timedQuery.rangeEnd,
			preset.id,
			useMobileCalendar ? settings.calendarMobileShowExternalCalendars : undefined,
		);
		if (externalItems.length > 0) {
			const createdTaskKeys = this.buildCreatedExternalEventTaskKeySet(scopedTasks);
			const hiddenSourceIds = new Set(
				this.getSettings().externalCalendars
					.filter((source) => source.hideCreatedEvents)
					.map((source) => source.id),
			);
			externalItems = externalItems.filter(item => {
				if (!item.externalRef || !hiddenSourceIds.has(item.externalRef.sourceId)) return true;
				const key = this.buildExternalEventTaskMatchKey(item.renderSnapshot.description, item.startDate);
				return !key || !createdTaskKeys.has(key);
			});
		}
		const scheduledItems = [
			...query.items.filter(item => item.kind === 'allDayScheduled'),
			...externalItems.filter(item => item.kind === 'allDayScheduled'),
		];
		const dueItems = query.items.filter(item => item.kind === 'dueMarker');
		const finishedItems = query.items.filter(item => item.kind === 'finishedMarker');
		const timedItems = [
			...timedQuery.items.filter(item => item.kind === 'timed'),
			...externalItems.filter(item => item.kind === 'timed'),
		];
		const mobileAgendaFocusKey = useMobileCalendar && mobileViewMode === 'agenda'
			? this.buildMobileAgendaFocusKey(mobileAnchorDate, settings)
			: null;
		const shouldFocusMobileAgendaAnchor = mobileAgendaFocusKey !== null
			&& this.lastMobileAgendaFocusKey !== mobileAgendaFocusKey;
		const mobileAgendaScrollTop = mobileAgendaFocusKey !== null && !shouldFocusMobileAgendaAnchor
			? this.captureRenderedMobileAgendaScrollTop()
			: null;
		if (mobileAgendaFocusKey === null) {
			this.lastMobileAgendaFocusKey = null;
		}

		container.empty();
		container.addClass('operon-calendar-view');
		this.timedHorizontalStripEl = null;
		this.timedHorizontalLabelStripEl = null;
		this.timedHorizontalClipEl = null;
		this.timedHorizontalRenderWindow = timedRenderWindow;
		this.timedHorizontalDayWidthPx = 0;

		const root = container.createDiv('operon-calendar-root');
		root.tabIndex = 0;
		root.classList.toggle('is-surface-time-grid', this.isTimeGridCompatibleSurface(preset));
		root.classList.toggle('is-surface-time-tracker-grid', preset.surfaceType === 'timeTrackerGrid');
		root.classList.toggle('is-time-grid-semantic-lanes', preset.surfaceType === 'timeGrid' && !useMobileCalendar);
		root.classList.toggle('is-surface-multi-week', preset.surfaceType === 'multiWeek');
		this.applyCalendarPresetTheme(root, preset);
		if (useMobileCalendar) {
			root.addClass('operon-calendar-mobile-root');
			root.classList.toggle('is-mobile-agenda', mobileViewMode === 'agenda');
			root.classList.toggle('is-mobile-day', mobileViewMode === 'day');
			root.classList.toggle('is-mobile-two-day', mobileViewMode === 'twoDay');
			root.classList.toggle('is-mobile-three-day', mobileViewMode === 'threeDay');
			if (mobileAgendaFocusKey !== null) {
				this.lastMobileAgendaFocusKey = mobileAgendaFocusKey;
			}
			this.renderMobileCalendarSurface(
				root,
				state,
				preset,
				settings,
				mobileViewMode,
				mobileAnchorDate,
				query.visibleDates,
				scheduledItems,
				dueItems,
				finishedItems,
				timedItems,
				activeFilter,
					scopedTasks.length,
					shouldFocusMobileAgendaAnchor,
					mobileAgendaScrollTop,
					mobileTimeGridRenderWindow,
				);
			this.restoreSurfaceScrollOnNextRender = false;
				this.bindLayoutRefresh(root);
				return;
			}
			this.clearMobileTimeGridScrollRenderIntents();
			let contentContainer: HTMLElement;
		if (state.navigationMode === 'sidebar') {
			contentContainer = this.renderSidebarShell(root, state, preset, query.visibleDates);
		} else {
			this.renderToolbar(root, state, preset, query.visibleDates);
			contentContainer = this.renderSurfaceScrollShell(root);
		}
		this.renderFilterEmptyState(contentContainer, activeFilter, scopedTasks.length, query.items.length + externalItems.length);
		if (preset.surfaceType === 'multiWeek') {
			this.renderMultiWeekSurface(
				contentContainer,
				query.visibleDates,
				scheduledItems,
				dueItems,
				finishedItems,
				timedItems,
				preset,
				settings,
				state,
			);
			if (preserveScroll || this.restoreSurfaceScrollOnNextRender) {
				this.restoreMultiWeekSurfaceScroll(renderGeneration);
			}
		} else if (timedRenderWindow && preset.surfaceType === 'timeTrackerGrid') {
			this.renderTimeTrackerGridSurface(
				contentContainer,
				query.visibleDates,
				scheduledItems,
				dueItems,
				finishedItems,
				timedItems,
				timedRenderWindow,
				preset,
				settings,
				state,
			);
		} else if (timedRenderWindow) {
			this.renderTimeGridSurface(
				contentContainer,
				query.visibleDates,
				scheduledItems,
				dueItems,
				finishedItems,
				timedItems,
				timedRenderWindow,
				preset,
				settings,
				state,
			);
		}
		this.restoreSurfaceScrollOnNextRender = false;
		this.bindLayoutRefresh(root);
		if (this.isTimeGridCompatibleSurface(preset) && preserveScroll) {
			this.restoreScrollPosition(state, preset);
		} else if (this.isTimeGridCompatibleSurface(preset)) {
			this.scheduleInitialScroll(state, preset, renderGeneration);
		}
	}

	private getCurrentPresetTitle(): string {
		const settings = this.getSettings();
		const state = this.ensureState();
		return settings.calendarPresets.find(entry => entry.id === state.presetId)?.name ?? 'Operon Calendar';
	}

	private syncLeafTitle(title = this.getCurrentPresetTitle()): void {
		const leafWithHeader = this.leaf as WorkspaceLeaf & {
			tabHeaderInnerTitleEl?: HTMLElement;
			tabHeaderEl?: HTMLElement;
		};
		leafWithHeader.tabHeaderInnerTitleEl?.setText(title);
		if (leafWithHeader.tabHeaderEl) {
			setAccessibleLabelWithoutTooltip(leafWithHeader.tabHeaderEl, title);
		}
	}

	private isMobileCalendarLayoutEligible(container: HTMLElement, settings: OperonSettings): boolean {
		if (settings.calendarMobileEnabled !== true) return false;
		if (!Platform.isPhone) return false;
		const ownerWindow = getOwnerWindow(container);
		const width = Math.max(
			1,
			Math.round(container.clientWidth || container.getBoundingClientRect().width || ownerWindow.innerWidth),
		);
		return width <= settings.calendarMobileMaxWidthPx;
	}

	private resolveMobileCalendarViewMode(
		state: CalendarLeafState,
		settings: OperonSettings,
	): CalendarMobileViewMode {
		const enabledModes = resolveEnabledCalendarMobileViewModes(settings);
		const requestedMode = state.mobileViewMode ?? settings.calendarMobileDefaultView;
		if (enabledModes.includes(requestedMode)) return requestedMode;
		if (enabledModes.includes(settings.calendarMobileDefaultView)) return settings.calendarMobileDefaultView;
		return enabledModes[0] ?? 'agenda';
	}

	private resolveMobileCalendarAnchorDate(state: CalendarLeafState): string {
		return state.mobileAnchorDate || state.anchorDate || localToday();
	}

	private resolveMobileCalendarSourcePreset(
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
		state?: CalendarLeafState,
	): CalendarPreset | null {
		const sourcePresetSettingKey = CALENDAR_MOBILE_SOURCE_PRESET_SETTING_BY_VIEW_MODE[viewMode];
		const candidatePresetIds = [
			settings[sourcePresetSettingKey],
			state?.mobileSourcePresetId,
			settings.calendarMobileDefaultSourcePresetId,
			settings.calendarDefaultPresetId,
		];
		for (const presetId of candidatePresetIds) {
			const preset = presetId
				? settings.calendarPresets.find(entry => entry.id === presetId)
				: null;
			if (preset) return preset;
		}
		return settings.calendarPresets[0] ?? null;
	}

	private buildMobileCalendarRenderPreset(preset: CalendarPreset, settings: OperonSettings): CalendarPreset {
		return {
			...preset,
			showProjectedOccurrences: settings.calendarMobileShowProjectedOccurrences,
			showExternalCalendars: settings.calendarMobileShowExternalCalendars,
			colorSource: settings.calendarMobileColorSource,
		};
	}

	private buildMobileCalendarQueryPreset(
		_preset: CalendarPreset,
		viewMode: CalendarMobileViewMode,
		settings: OperonSettings,
	): Pick<CalendarPreset, 'dayCount' | 'showWeekends' | 'todayPosition' | 'showProjectedOccurrences'> {
		const dayCount = viewMode === 'threeDay'
			? 3
			: viewMode === 'twoDay'
				? 2
				: viewMode === 'day'
					? 1
					: settings.calendarMobileAgendaPastDays + settings.calendarMobileAgendaFutureDays + 1;
		return {
			dayCount,
			showWeekends: true,
			todayPosition: 1,
			showProjectedOccurrences: settings.calendarMobileShowProjectedOccurrences,
		};
	}

	private buildMobileTimeGridRenderWindow(anchorDate: string, visibleDates: string[]): CalendarMobileTimeGridRenderWindow {
		const visibleDayCount = Math.max(1, visibleDates.length || 1);
		const bufferDaysPerSide = CALENDAR_MOBILE_TIME_GRID_BUFFER_DAYS_PER_SIDE;
		const bufferedDates = buildVisibleCalendarDates(
			anchorDate,
			visibleDayCount + (bufferDaysPerSide * 2),
			true,
			bufferDaysPerSide + 1,
		);
		const visibleStartBufferIndex = resolveTimedHorizontalVisibleStartIndex(
			bufferedDates,
			visibleDates,
			anchorDate,
			bufferDaysPerSide,
		);
		return {
			anchorDate,
			visibleDates: [...visibleDates],
			bufferedDates,
			visibleStartBufferIndex,
			bufferDaysBefore: bufferDaysPerSide,
			bufferDaysAfter: bufferDaysPerSide,
		};
	}

	private buildMobileAgendaFixedDates(anchorDate: string, settings: OperonSettings): string[] {
		const startDate = shiftCalendarDateKey(anchorDate, -settings.calendarMobileAgendaPastDays);
		const endDate = shiftCalendarDateKey(anchorDate, settings.calendarMobileAgendaFutureDays);
		const dates: string[] = [];
		let cursor = startDate;
		while (cursor && cursor <= endDate) {
			dates.push(cursor);
			const next = shiftCalendarDateKey(cursor, 1);
			if (next === cursor) break;
			cursor = next;
		}
		return dates;
	}

	private buildMobileAgendaFocusKey(anchorDate: string, settings: OperonSettings): string {
		return [
			anchorDate,
			settings.calendarMobileAgendaPastDays,
			settings.calendarMobileAgendaFutureDays,
		].join('|');
	}

	private captureRenderedMobileAgendaScrollTop(): number | null {
		const scrollEl = this.contentEl.querySelector<HTMLElement>(
			'.operon-calendar-mobile-root.is-mobile-agenda .operon-calendar-mobile-content',
		);
		return scrollEl
			? Math.max(0, Math.round(scrollEl.scrollTop))
			: null;
	}

	private getMobileCalendarViewLabel(viewMode: CalendarMobileViewMode): string {
		if (viewMode === 'threeDay') return t('calendar', 'mobileViewThreeDay');
		if (viewMode === 'twoDay') return t('calendar', 'mobileViewTwoDay');
		if (viewMode === 'day') return t('calendar', 'mobileViewDay');
		return t('calendar', 'mobileViewAgenda');
	}

	private renderMobileCalendarSurface(
		root: HTMLElement,
		state: CalendarLeafState,
		preset: CalendarPreset,
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
		anchorDate: string,
		visibleDates: string[],
		scheduledItems: CalendarItem[],
		dueItems: CalendarItem[],
		finishedItems: CalendarItem[],
		timedItems: CalendarItem[],
		activeFilter: FilterSet | null,
			scopedTaskCount: number,
			shouldFocusAgendaAnchor: boolean,
			agendaScrollTop: number | null,
			mobileTimeGridRenderWindow: CalendarMobileTimeGridRenderWindow | null,
		): void {
		this.renderMobileCalendarHeader(root, state, preset, settings, viewMode, anchorDate);
		const content = root.createDiv('operon-calendar-mobile-content');
		content.classList.toggle('is-timegrid', viewMode !== 'agenda');
		const visibleBuckets = this.buildMobileCalendarVisibleBuckets(
			scheduledItems,
			dueItems,
			finishedItems,
			timedItems,
			settings,
			viewMode,
		);
			const visibleItemCount = visibleBuckets.scheduled.length
				+ visibleBuckets.due.length
				+ visibleBuckets.finished.length
				+ visibleBuckets.timed.length;
			if (viewMode === 'agenda') {
				this.clearMobileTimeGridScrollRenderIntents();
				this.renderMobileAgenda(content, visibleDates, visibleBuckets, preset, settings, anchorDate, {
					focusAnchor: shouldFocusAgendaAnchor,
					restoreScrollTop: agendaScrollTop,
				});
				if (visibleItemCount === 0 && activeFilter && scopedTaskCount === 0) {
				content.createDiv({
					cls: 'operon-calendar-mobile-agenda-filter-empty',
					text: t('calendar', 'noCalendarFilterMatches'),
				});
			}
			} else if (mobileTimeGridRenderWindow) {
				this.renderMobileTimeGrid(content, mobileTimeGridRenderWindow, visibleBuckets, preset, settings, viewMode);
			}
		}

	private buildMobileCalendarVisibleBuckets(
		scheduledItems: CalendarItem[],
		dueItems: CalendarItem[],
		finishedItems: CalendarItem[],
		timedItems: CalendarItem[],
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
	): {
		scheduled: CalendarItem[];
		due: CalendarItem[];
		finished: CalendarItem[];
		timed: CalendarItem[];
	} {
		const showCompleted = viewMode === 'agenda'
			? settings.calendarMobileAgendaShowCompletedItems
			: settings.calendarMobileShowCompletedItems;
		return {
			scheduled: settings.calendarMobileShowAllDayItems
				? this.filterMobileCalendarCompletedItems(scheduledItems, showCompleted)
				: [],
			due: settings.calendarMobileShowDueMarkers
				? this.filterMobileCalendarCompletedItems(dueItems, showCompleted)
				: [],
			finished: showCompleted
				? finishedItems
				: [],
			timed: this.filterMobileCalendarCompletedItems(timedItems, showCompleted),
		};
	}

	private filterMobileCalendarCompletedItems(items: CalendarItem[], showCompleted: boolean): CalendarItem[] {
		if (showCompleted) return items;
		return items.filter(item => item.origin === 'external' || item.renderSnapshot.checkbox === 'open');
	}

	private renderMobileCalendarHeader(
		root: HTMLElement,
		state: CalendarLeafState,
		preset: CalendarPreset,
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
		anchorDate: string,
	): void {
		const header = root.createDiv('operon-calendar-mobile-header');
		this.renderMobileDateStrip(header, state, anchorDate);
		this.renderMobileCalendarActionStrip(header, state, preset, settings, viewMode, anchorDate);
	}

	private renderMobileCalendarActionStrip(
		container: HTMLElement,
		state: CalendarLeafState,
		preset: CalendarPreset,
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
		anchorDate: string,
	): void {
		const actions = container.createDiv('operon-calendar-mobile-action-strip');
		const today = localToday();
		const showProjectedOccurrences = settings.calendarMobileShowProjectedOccurrences !== false;
		const projectedLabel = showProjectedOccurrences
			? t('calendar', 'hideFutureOccurrences')
			: t('calendar', 'showFutureOccurrences');
		this.renderMobileCalendarActionButton(actions, {
			icon: showProjectedOccurrences ? 'eye' : 'eye-off',
			label: projectedLabel,
			isOn: showProjectedOccurrences,
			onClick: () => {
				void this.callbacks.onMobileCalendarSettingsChange?.({
					calendarMobileShowProjectedOccurrences: !showProjectedOccurrences,
				});
			},
		});

		const hasSelectedExternalCalendars = this.hasSelectedExternalCalendars(preset, settings);
		const showExternalCalendars = settings.calendarMobileShowExternalCalendars !== false;
		const externalCalendarsLabel = hasSelectedExternalCalendars
			? showExternalCalendars
				? t('calendar', 'hideExternalCalendars')
				: t('calendar', 'showExternalCalendars')
			: t('calendar', 'noExternalCalendarsSelectedForPreset');
		this.renderMobileCalendarActionButton(actions, {
			icon: showExternalCalendars && hasSelectedExternalCalendars ? 'calendar-check' : 'calendar-off',
			label: externalCalendarsLabel,
			isOn: showExternalCalendars && hasSelectedExternalCalendars,
			disabled: !hasSelectedExternalCalendars,
			onClick: () => {
				if (!hasSelectedExternalCalendars) return;
				void this.callbacks.onMobileCalendarSettingsChange?.({
					calendarMobileShowExternalCalendars: !showExternalCalendars,
				});
			},
		});

		const currentColorSource = normalizeTaskColorSource(settings.calendarMobileColorSource, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
		const nextColorSource = getNextTaskColorSource(currentColorSource, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
		const colorSourceLabel = t('calendar', 'cycleTaskColorSourceTooltip', {
			current: getTaskColorSourceLabel(currentColorSource),
			next: getTaskColorSourceLabel(nextColorSource),
		});
		this.renderMobileCalendarActionButton(actions, {
			icon: getTaskColorSourceIcon(currentColorSource),
			label: colorSourceLabel,
			onClick: () => {
				void this.callbacks.onMobileCalendarSettingsChange?.({
					calendarMobileColorSource: nextColorSource,
				});
			},
		});

		const syncExternalCalendarsLabel = t('commands', 'updateExternalCalendars');
		this.renderMobileCalendarActionButton(actions, {
			icon: 'calendar-sync',
			label: syncExternalCalendarsLabel,
			onClick: () => {
				void this.callbacks.onSyncExternalCalendars?.();
			},
		});

		this.renderMobileCalendarViewCycleButton(actions, state, viewMode, settings);
		this.renderMobileCalendarSourcePresetButton(actions, preset, settings, viewMode);
		this.renderMobileCalendarActionButton(actions, {
			icon: 'calendar-arrow-down',
			label: t('calendar', 'mobileGoToToday'),
			isOn: anchorDate === today,
			onClick: () => {
				if (viewMode === 'agenda' && anchorDate === today && this.scrollRenderedMobileAgendaToDate(today)) {
					return;
				}
				if (viewMode !== 'agenda') {
					this.requestMobileTimeGridSmartScrollOnNextRender();
					if (anchorDate === today) {
						this.render();
						return;
					}
				}
				void this.updateLeafState({
					...state,
					mobileAnchorDate: today,
				});
			},
		});
	}

	private getNextMobileCalendarViewMode(
		viewMode: CalendarMobileViewMode,
		settings: OperonSettings,
	): CalendarMobileViewMode {
		const enabledModes = resolveEnabledCalendarMobileViewModes(settings);
		if (enabledModes.length <= 1) return viewMode;
		const currentIndex = enabledModes.indexOf(viewMode);
		const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
		return enabledModes[nextIndex % enabledModes.length] ?? enabledModes[0] ?? 'agenda';
	}

	private renderMobileCalendarViewCycleButton(
		container: HTMLElement,
		state: CalendarLeafState,
		viewMode: CalendarMobileViewMode,
		settings: OperonSettings,
	): void {
		const enabledModes = resolveEnabledCalendarMobileViewModes(settings);
		const hasMultipleModes = enabledModes.length > 1;
		const nextViewMode = hasMultipleModes
			? this.getNextMobileCalendarViewMode(viewMode, settings)
			: viewMode;
		const currentLabel = this.getMobileCalendarViewLabel(viewMode);
		const nextLabel = this.getMobileCalendarViewLabel(nextViewMode);
		const label = hasMultipleModes
			? t('calendar', 'mobileCycleView', {
				current: currentLabel,
				next: nextLabel,
			})
			: t('calendar', 'mobileCycleViewSingle', {
				current: currentLabel,
			});
		const button = container.createEl('button', {
			text: currentLabel,
			cls: 'operon-calendar-mobile-icon-button operon-calendar-mobile-action-button operon-calendar-mobile-view-cycle-button is-on',
			attr: {
				type: 'button',
			},
		});
		button.disabled = !hasMultipleModes;
		button.classList.toggle('is-disabled', !hasMultipleModes);
		setAccessibleLabelWithoutTooltip(button, label);
		bindOperonHoverTooltip(button, { content: label, taskColor: null });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			if (!hasMultipleModes) return;
			void this.updateLeafState({
				...state,
				mobileViewMode: nextViewMode,
			});
		});
	}

	private renderMobileCalendarActionButton(
		container: HTMLElement,
		options: {
			icon: string;
			label: string;
			isOn?: boolean;
			disabled?: boolean;
			onClick: () => void;
		},
	): HTMLButtonElement {
		const attr: Record<string, string> = { type: 'button' };
		if (typeof options.isOn === 'boolean') attr['aria-pressed'] = String(options.isOn);
		if (options.disabled) attr['aria-disabled'] = 'true';
		const button = container.createEl('button', {
			cls: 'operon-calendar-mobile-icon-button operon-calendar-mobile-action-button',
			attr,
		});
		button.classList.toggle('is-on', options.isOn === true);
		button.classList.toggle('is-off', options.isOn === false);
		button.classList.toggle('is-disabled', options.disabled === true);
		setIcon(button, options.icon);
		setAccessibleLabelWithoutTooltip(button, options.label);
		bindOperonHoverTooltip(button, { content: options.label, taskColor: null });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			if (options.disabled) return;
			options.onClick();
		});
		return button;
	}

	private renderMobileCalendarSourcePresetButton(
		container: HTMLElement,
		preset: CalendarPreset,
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
	): void {
		const wrapper = container.createDiv('operon-calendar-mobile-source-select-wrap');
		const trigger = wrapper.createDiv('operon-calendar-mobile-icon-button operon-calendar-mobile-source-select-trigger');
		setIcon(trigger, 'calendar-days');
		const presetSelect = wrapper.createEl('select', {
			cls: 'operon-calendar-mobile-source-select',
		});
		for (const entry of settings.calendarPresets) {
			const option = presetSelect.createEl('option', { text: entry.name });
			option.value = entry.id;
			option.selected = entry.id === preset.id;
		}
		setAccessibleLabelWithoutTooltip(presetSelect, t('calendar', 'mobileSourcePreset'));
		presetSelect.addEventListener('change', () => {
			const sourcePresetSettingKey = CALENDAR_MOBILE_SOURCE_PRESET_SETTING_BY_VIEW_MODE[viewMode];
			void this.callbacks.onMobileCalendarSettingsChange?.({
				[sourcePresetSettingKey]: presetSelect.value,
			});
		});
	}

	private renderMobileDateStrip(
		container: HTMLElement,
		state: CalendarLeafState,
		anchorDate: string,
	): void {
		const weekPages = this.buildMobileDateStripWeekPages(anchorDate);
		const strip = container.createDiv('operon-calendar-mobile-date-strip');
		for (const page of weekPages) {
			const weekEl = strip.createDiv('operon-calendar-mobile-date-week');
			weekEl.dataset.weekOffset = String(page.offset);
			weekEl.classList.toggle('is-current', page.offset === 0);
			for (const dateKey of page.dates) {
				const button = weekEl.createEl('button', {
					cls: 'operon-calendar-mobile-date-button',
					attr: {
						type: 'button',
						'aria-pressed': String(dateKey === anchorDate),
					},
				});
				button.dataset.dateKey = dateKey;
					button.classList.toggle('is-active', dateKey === anchorDate);
					button.classList.toggle('is-today', dateKey === localToday());
					button.createSpan({
						text: this.formatMobileMonthLabel(dateKey),
						cls: 'operon-calendar-mobile-date-month',
					});
					button.createSpan({
						text: this.formatMobileDateNumber(dateKey),
						cls: 'operon-calendar-mobile-date-number',
				});
				button.addEventListener('click', () => {
					void this.updateLeafState({
						...state,
						mobileAnchorDate: dateKey,
					});
				});
			}
		}
		this.bindMobileDateStripScroll(strip, anchorDate);
	}

	private buildMobileDateStripWeekPages(anchorDate: string): Array<{ offset: number; dates: string[] }> {
		return CALENDAR_MOBILE_DATE_STRIP_WEEK_OFFSETS.map(offset => ({
			offset,
			dates: buildCalendarMobileWeekDates(anchorDate, offset),
		}));
	}

	private bindMobileDateStripScroll(strip: HTMLElement, anchorDate: string): void {
		let isProgrammaticScroll = true;
		const generation = this.renderGeneration;
		this.requestRenderAnimationFrame(generation, () => {
			const currentWeek = strip.querySelector<HTMLElement>('.operon-calendar-mobile-date-week.is-current');
			currentWeek?.scrollIntoView({ block: 'nearest', inline: 'center' });
			this.setRenderTimeout(generation, () => {
				isProgrammaticScroll = false;
			}, 140);
		});

		strip.addEventListener('scroll', () => {
			if (isProgrammaticScroll) return;
			if (this.mobileDateStripScrollTimer !== null) {
				window.clearTimeout(this.mobileDateStripScrollTimer);
				this.renderTimeouts.delete(this.mobileDateStripScrollTimer);
				this.mobileDateStripScrollTimer = null;
			}
			this.mobileDateStripScrollTimer = this.setRenderTimeout(generation, () => {
				this.mobileDateStripScrollTimer = null;
				const weekOffset = this.findCenteredMobileDateStripWeekOffset(strip);
				if (!weekOffset) return;
				const currentState = this.ensureState();
				const currentAnchorDate = this.resolveMobileCalendarAnchorDate(currentState);
				const targetDate = shiftCalendarMobileWeekAnchor(currentAnchorDate, weekOffset);
				if (targetDate === currentAnchorDate) return;
				void this.updateLeafState({
					...currentState,
					mobileAnchorDate: targetDate,
				});
			}, 180);
		}, { passive: true });
	}

	private findCenteredMobileDateStripWeekOffset(strip: HTMLElement): number | null {
		const stripRect = strip.getBoundingClientRect();
		if (stripRect.width <= 0) return null;
		const centerX = stripRect.left + (stripRect.width / 2);
		let closestOffset: number | null = null;
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const week of Array.from(strip.querySelectorAll<HTMLElement>('.operon-calendar-mobile-date-week'))) {
			const rawOffset = week.dataset.weekOffset;
			if (!rawOffset) continue;
			const offset = Number(rawOffset);
			if (!Number.isFinite(offset)) continue;
			const rect = week.getBoundingClientRect();
			const distance = Math.abs((rect.left + (rect.width / 2)) - centerX);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestOffset = Math.round(offset);
			}
		}
		return closestOffset;
	}

	private renderMobileAgenda(
		container: HTMLElement,
		visibleDates: string[],
		buckets: {
			scheduled: CalendarItem[];
			due: CalendarItem[];
			finished: CalendarItem[];
			timed: CalendarItem[];
		},
			preset: CalendarPreset,
			settings: OperonSettings,
			anchorDate: string,
			options: {
				focusAnchor: boolean;
				restoreScrollTop: number | null;
			},
		): void {
		const list = container.createDiv('operon-calendar-mobile-agenda');
		for (const dateKey of visibleDates) {
			const dayItems = this.collectMobileCalendarItemsForDate(dateKey, buckets);
			const group = list.createDiv('operon-calendar-mobile-agenda-day');
			group.dataset.dateKey = dateKey;
			group.classList.toggle('is-empty', dayItems.length === 0);
			group.classList.toggle('is-anchor', dateKey === anchorDate);
			this.renderMobileDayHeading(group, dateKey);
			if (dayItems.length === 0) {
				group.createDiv({
					cls: 'operon-calendar-mobile-agenda-empty-day',
					text: t('calendar', 'mobileAgendaEmptyDay'),
				});
			} else {
				const itemsEl = group.createDiv('operon-calendar-mobile-item-list');
				for (const entry of dayItems) {
					this.renderMobileCalendarItem(itemsEl, entry.item, preset, settings, entry.kind);
				}
				}
			}
			if (options.focusAnchor) {
				this.focusMobileAgendaAnchorDate(container, anchorDate);
			} else if (options.restoreScrollTop !== null) {
				this.restoreMobileAgendaScrollTop(container, options.restoreScrollTop);
			}
		}

	private focusMobileAgendaAnchorDate(scrollEl: HTMLElement, anchorDate: string): void {
		const generation = this.renderGeneration;
		this.requestRenderAnimationFrame(generation, () => {
			if (!scrollEl.isConnected) return;
			const anchorEl = scrollEl.querySelector<HTMLElement>(
				`.operon-calendar-mobile-agenda-day[data-date-key="${anchorDate}"]`,
			);
			if (!anchorEl) return;
			const scrollRect = scrollEl.getBoundingClientRect();
			const anchorRect = anchorEl.getBoundingClientRect();
			const offset = anchorRect.top - scrollRect.top;
			scrollEl.scrollTop = Math.max(0, Math.round(scrollEl.scrollTop + offset - 4));
		});
	}

	private restoreMobileAgendaScrollTop(scrollEl: HTMLElement, scrollTop: number): void {
		const generation = this.renderGeneration;
		this.requestRenderAnimationFrame(generation, () => {
			if (!scrollEl.isConnected) return;
			const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
			scrollEl.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop));
		});
	}

	private scrollRenderedMobileAgendaToDate(dateKey: string): boolean {
		const scrollEl = this.contentEl.querySelector<HTMLElement>(
			'.operon-calendar-mobile-root.is-mobile-agenda .operon-calendar-mobile-content',
		);
		if (!scrollEl) return false;
		if (!scrollEl.querySelector(`.operon-calendar-mobile-agenda-day[data-date-key="${dateKey}"]`)) {
			return false;
		}
		this.focusMobileAgendaAnchorDate(scrollEl, dateKey);
		return true;
	}

	private renderMobileTimeGrid(
		container: HTMLElement,
		renderWindow: CalendarMobileTimeGridRenderWindow,
		buckets: {
			scheduled: CalendarItem[];
			due: CalendarItem[];
			finished: CalendarItem[];
			timed: CalendarItem[];
		},
		preset: CalendarPreset,
		settings: OperonSettings,
		viewMode: CalendarMobileViewMode,
	): void {
		const metrics = this.buildMobileTimeGridMetrics();
		const visibleDates = renderWindow.visibleDates;
		const bufferedDates = renderWindow.bufferedDates;
		const isTimeTrackerGrid = preset.surfaceType === 'timeTrackerGrid';
		const isTimeGridSemanticLanes = preset.surfaceType === 'timeGrid';
		const timeGrid = container.createDiv('operon-calendar-mobile-timegrid');
		timeGrid.classList.toggle('is-three-day', viewMode === 'threeDay');
		timeGrid.classList.toggle('is-time-tracker-grid', isTimeTrackerGrid);
		timeGrid.classList.toggle('is-time-grid-semantic-lanes', isTimeGridSemanticLanes);
		timeGrid.classList.toggle('is-all-day-collapsed', this.isMobileAllDayRailCollapsed);
		timeGrid.style.setProperty('--operon-calendar-mobile-timegrid-days', String(Math.max(1, visibleDates.length)));
		timeGrid.style.setProperty('--operon-calendar-mobile-timegrid-buffered-days', String(Math.max(1, bufferedDates.length)));
		this.renderMobileTimeGridHeader(timeGrid, renderWindow, preset, buckets.timed);
		if (!this.isMobileAllDayRailCollapsed) {
			this.renderMobileTimeGridAllDayRail(timeGrid, renderWindow, buckets, preset, settings);
		}

		const viewport = timeGrid.createDiv('operon-calendar-mobile-timegrid-viewport');
		this.mobileTimeGridScrollEl = viewport;
		viewport.addEventListener('scroll', () => {
			this.hideCalendarHoverMenu(true);
			this.lastMobileTimeGridScrollTop = Math.max(0, Math.round(viewport.scrollTop));
		}, { passive: true });
		const cancelRestoreForUserScroll = (): void => {
			if (!this.hasPendingMobileTimeGridScrollRestore()) return;
			this.clearMobileTimeGridScrollRestoreIntent();
			this.lastMobileTimeGridScrollTop = Math.max(0, Math.round(viewport.scrollTop));
		};
		viewport.addEventListener('pointerdown', cancelRestoreForUserScroll, { capture: true, passive: true });
		viewport.addEventListener('wheel', cancelRestoreForUserScroll, { capture: true, passive: true });
		const section = viewport.createDiv('operon-calendar-mobile-timegrid-section');
		const gutter = section.createDiv('operon-calendar-mobile-timegrid-gutter');
		gutter.style.height = `${metrics.gridHeight}px`;
		this.renderMobileTimeGridGutterLabels(gutter, visibleDates[0] ?? localToday(), metrics, settings);

		const daysClip = section.createDiv('operon-calendar-mobile-timegrid-days-clip');
		const daysGrid = daysClip.createDiv('operon-calendar-mobile-timegrid-days-grid operon-calendar-mobile-timegrid-buffer-track');
		this.applyMobileTimeGridBufferedTrackStyle(daysGrid, renderWindow);
		daysGrid.style.height = `${metrics.gridHeight}px`;
		const hoverGuideOverlay = section.createDiv('operon-calendar-hover-guide-overlay operon-calendar-mobile-hover-guide-overlay');
		this.renderMobileTimeGridDayColumns(daysGrid, bufferedDates, metrics, settings, section, gutter, hoverGuideOverlay, timeGrid, visibleDates.length, preset);
		if (isTimeTrackerGrid) {
			this.renderMobileTimeTrackerGridItems(daysGrid, bufferedDates, buckets.timed, preset, settings, metrics, section, gutter, hoverGuideOverlay);
		} else if (isTimeGridSemanticLanes) {
			this.renderMobileTimeGridSemanticItems(daysGrid, bufferedDates, buckets.timed, preset, settings, metrics, section, gutter, hoverGuideOverlay);
		} else {
			this.renderMobileTimeGridItems(daysGrid, bufferedDates, buckets.timed, preset, settings, metrics, section, gutter, hoverGuideOverlay);
		}
		this.scheduleMobileTimeGridInitialScroll(viewport, visibleDates, buckets.timed, metrics);
	}

	private applyMobileTimeGridBufferedTrackStyle(track: HTMLElement, renderWindow: CalendarMobileTimeGridRenderWindow): void {
		const visibleDayCount = Math.max(1, renderWindow.visibleDates.length);
		const bufferedDayCount = Math.max(visibleDayCount, renderWindow.bufferedDates.length);
		const visibleStart = Math.max(0, Math.min(bufferedDayCount - visibleDayCount, renderWindow.visibleStartBufferIndex));
		track.style.gridTemplateColumns = `repeat(${bufferedDayCount}, minmax(0, 1fr))`;
		track.style.width = `${(bufferedDayCount / visibleDayCount) * 100}%`;
		track.setCssProps({
			'--operon-calendar-mobile-buffer-base-x': `${-(visibleStart / bufferedDayCount) * 100}%`,
			'--operon-calendar-mobile-buffer-swipe-x': '0px',
		});
	}

	private resolveMobileTimeGridBufferedSwipeDayWidth(timeGrid: HTMLElement, visibleDayCount: number): number {
		const clip = timeGrid.querySelector<HTMLElement>('.operon-calendar-mobile-timegrid-days-clip')
			?? timeGrid.querySelector<HTMLElement>('.operon-calendar-mobile-timegrid-header-clip');
		const clipWidth = clip?.getBoundingClientRect().width ?? 0;
		return clipWidth > 0
			? clipWidth / Math.max(1, visibleDayCount)
			: 48;
	}

	private renderMobileDayHeading(container: HTMLElement, dateKey: string): void {
		const heading = container.createDiv('operon-calendar-mobile-day-heading');
		heading.classList.toggle('is-today', dateKey === localToday());
		heading.createDiv({
			text: this.formatDayLabel(dateKey),
			cls: 'operon-calendar-mobile-day-heading-date',
		});
		heading.createDiv({
			text: this.formatMobileAgendaWeekdayLabel(dateKey),
			cls: 'operon-calendar-mobile-day-heading-weekday',
		});
	}

	private buildMobileTimeGridMetrics(): CalendarTimedMetrics {
		return {
			hiddenRange: {
				enabled: false,
				startMinutes: 0,
				endMinutes: 0,
			},
			isHiddenExpanded: true,
			scale: CALENDAR_MOBILE_TIME_GRID_SCALE,
			collapsedBandHeight: 0,
			gridHeight: Math.round(CALENDAR_MOBILE_TIME_GRID_MINUTES_PER_DAY * CALENDAR_MOBILE_TIME_GRID_SCALE),
		};
	}

	private renderMobileTimeGridHeader(
		container: HTMLElement,
		renderWindow: CalendarMobileTimeGridRenderWindow,
		preset: CalendarPreset,
		timedItems: CalendarItem[] = [],
	): void {
		const header = container.createDiv('operon-calendar-mobile-timegrid-header');
		const gutterSpacer = header.createDiv('operon-calendar-mobile-timegrid-gutter-spacer');
		this.renderMobileAllDayRailToggleButton(gutterSpacer);
		const clip = header.createDiv('operon-calendar-mobile-timegrid-header-clip');
		const days = clip.createDiv('operon-calendar-mobile-timegrid-header-days operon-calendar-mobile-timegrid-buffer-track');
		this.applyMobileTimeGridBufferedTrackStyle(days, renderWindow);
		const opensDailyNote = this.getSettings().calendarDayTitleAction === 'create-open-daily-note';
		const dayModels = preset.surfaceType === 'timeTrackerGrid'
			? this.resolveTimeTrackerGridDayLaneModels(preset, renderWindow.bufferedDates)
			: preset.surfaceType === 'timeGrid'
				? this.resolveTimeGridDayLaneModels(preset, renderWindow.bufferedDates)
				: [];
		const firstBufferedDate = renderWindow.bufferedDates[0] ?? localToday();
		const lastBufferedDate = renderWindow.bufferedDates[renderWindow.bufferedDates.length - 1] ?? localToday();
		const trackedSessions = preset.surfaceType === 'timeTrackerGrid' && dayModels.length > 0
			? this.buildTimeTrackerGridSessionItems(firstBufferedDate, lastBufferedDate)
			: [];
		const summaryByDate = dayModels.length > 0
			? this.buildTimeTrackerGridSummaryByDate(renderWindow.bufferedDates, timedItems, trackedSessions)
			: null;
		for (const dateKey of renderWindow.bufferedDates) {
			const day = opensDailyNote
				? days.createEl('button', {
					cls: 'operon-calendar-mobile-timegrid-day-header',
					attr: { type: 'button' },
				})
				: days.createDiv('operon-calendar-mobile-timegrid-day-header');
			day.classList.toggle('is-today', dateKey === localToday());
			day.createSpan({
				text: this.formatWeekdayLabel(dateKey),
				cls: 'operon-calendar-mobile-timegrid-day-weekday',
			});
			day.createSpan({
				text: this.formatMobileDateNumber(dateKey),
				cls: 'operon-calendar-mobile-timegrid-day-number',
			});
			if (opensDailyNote) {
				day.addEventListener('click', () => {
					void this.callbacks.onOpenDailyNote?.(dateKey);
				});
			}
		}
		if (dayModels.length > 0) {
			header.createDiv('operon-calendar-mobile-timegrid-lane-gutter');
			const laneClip = header.createDiv('operon-calendar-mobile-timegrid-lane-header-clip');
			const laneTrack = laneClip.createDiv('operon-calendar-mobile-timegrid-lane-header-track operon-calendar-mobile-timegrid-buffer-track');
			this.applyMobileTimeGridBufferedTrackStyle(laneTrack, renderWindow);
			this.renderTimeTrackerGridLaneLabelStrip(
				laneTrack,
				dayModels,
				'operon-calendar-mobile-timegrid-day-lanes',
				summaryByDate,
			);
		}
	}

	private renderMobileAllDayRailToggleButton(container: HTMLElement): void {
		const isCollapsed = this.isMobileAllDayRailCollapsed;
		const label = isCollapsed
			? t('calendar', 'expandMobileAllDayRow')
			: t('calendar', 'collapseMobileAllDayRow');
		const button = container.createEl('button', {
			cls: 'operon-calendar-mobile-all-day-toggle-button',
			attr: {
				type: 'button',
				'aria-pressed': String(!isCollapsed),
			},
		});
		setIcon(button, isCollapsed ? 'panel-top-open' : 'panel-top-close');
		setAccessibleLabelWithoutTooltip(button, label);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			this.captureMobileTimeGridScrollForRender();
			this.isMobileAllDayRailCollapsed = !this.isMobileAllDayRailCollapsed;
			this.render();
		});
	}

	private renderMobileTimeGridAllDayRail(
		container: HTMLElement,
		renderWindow: CalendarMobileTimeGridRenderWindow,
		buckets: {
			scheduled: CalendarItem[];
			due: CalendarItem[];
			finished: CalendarItem[];
			timed: CalendarItem[];
		},
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		const rail = container.createDiv('operon-calendar-mobile-timegrid-all-day');
		const entriesByDate = new Map<string, Array<{ item: CalendarItem; kind: 'allDay' | 'due' | 'finished' }>>();
		const getEntries = (dateKey: string): Array<{ item: CalendarItem; kind: 'allDay' | 'due' | 'finished' }> => {
			const existing = entriesByDate.get(dateKey);
			if (existing) return existing;
			const entries = this.resolveMobileTimeGridAllDayEntries(dateKey, buckets);
			entriesByDate.set(dateKey, entries);
			return entries;
		};
		const visibleEntryCount = renderWindow.visibleDates.reduce((maxCount, dateKey) => Math.max(maxCount, getEntries(dateKey).length), 0);
		rail.style.setProperty('--operon-calendar-mobile-all-day-rail-height', `${this.resolveMobileAllDayRailHeight(settings, visibleEntryCount)}px`);
		const maxVisibleHeight = this.resolveMobileAllDayVisibleTaskHeight(settings);
		if (maxVisibleHeight !== null) {
			rail.style.setProperty('--operon-calendar-mobile-all-day-max-height', `${maxVisibleHeight}px`);
		}
		rail.createDiv({
			text: t('calendar', 'allDay'),
			cls: 'operon-calendar-mobile-timegrid-all-day-label',
		});
		const clip = rail.createDiv('operon-calendar-mobile-timegrid-all-day-clip');
		const days = clip.createDiv('operon-calendar-mobile-timegrid-all-day-days operon-calendar-mobile-timegrid-buffer-track');
		this.applyMobileTimeGridBufferedTrackStyle(days, renderWindow);
		const cells: HTMLElement[] = [];
		for (const dateKey of renderWindow.bufferedDates) {
			const cell = days.createDiv('operon-calendar-mobile-timegrid-all-day-cell');
			cell.dataset.dateKey = dateKey;
			cells.push(cell);
			for (const entry of getEntries(dateKey)) {
				this.renderMobileTimeGridPill(cell, entry.item, preset, settings, entry.kind);
			}
		}
		const overlay = days.createDiv('operon-calendar-mobile-timegrid-all-day-overlay');
		this.allDayDropContext = {
			body: days,
			overlay,
			visibleDates: [...renderWindow.bufferedDates],
			laneHeight: 28,
			previewLane: 0,
			cells,
			activeColumn: null,
			isMobile: true,
		};
	}

	private resolveMobileTimeGridAllDayEntries(
		dateKey: string,
		buckets: {
			scheduled: CalendarItem[];
			due: CalendarItem[];
			finished: CalendarItem[];
		},
	): Array<{ item: CalendarItem; kind: 'allDay' | 'due' | 'finished' }> {
		return this.sortMobileCalendarEntries([
			...this.getItemsIntersectingDate(buckets.scheduled, dateKey).map(item => ({ item, kind: 'allDay' as const })),
			...this.getItemsIntersectingDate(buckets.due, dateKey).map(item => ({ item, kind: 'due' as const })),
			...this.getItemsIntersectingDate(buckets.finished, dateKey).map(item => ({ item, kind: 'finished' as const })),
		]);
	}

	private resolveMobileAllDayRailHeight(settings: OperonSettings, visibleTaskCount: number): number {
		const limit = settings.calendarMobileAllDayVisibleTaskLimit;
		const visibleRows = limit === 'all'
			? visibleTaskCount
			: Math.min(visibleTaskCount, limit);
		return Math.max(34, (visibleRows * 28) + 10);
	}

	private resolveMobileAllDayVisibleTaskHeight(settings: OperonSettings): number | null {
		const limit = settings.calendarMobileAllDayVisibleTaskLimit;
		if (limit === 'all') return null;
		return Math.max(44, (limit * 28) + 10);
	}

	private renderMobileTimeGridPill(
		container: HTMLElement,
		item: CalendarItem,
		preset: CalendarPreset,
		settings: OperonSettings,
		kind: 'allDay' | 'due' | 'finished',
	): void {
		const itemEl = container.createDiv(`operon-calendar-mobile-timegrid-pill operon-calendar-mobile-item is-${kind}`);
		itemEl.dataset.operonId = item.taskId;
		itemEl.addClass(`is-${item.renderSnapshot.checkbox}`);
		this.applyCalendarProjectionClasses(itemEl, item);
		if (item.origin === 'external') itemEl.addClass('is-external');
		this.applyCalendarItemColor(itemEl, item, preset, settings);
		const hoverTrigger = this.renderCalendarItemLabel(itemEl, item, settings, true);
		this.bindPrimaryItemClick(itemEl, item);
		if (hoverTrigger) {
			this.bindHoverMenuTarget(hoverTrigger, item);
		}
		if (kind === 'allDay' && this.canEditCalendarItemPlacement(item)) {
			itemEl.addClass('is-draggable');
			this.bindMobileAllDayPillInteraction(itemEl, item, settings);
		} else if (kind === 'allDay') {
			itemEl.addClass('is-read-only');
		}
	}

	private bindMobileAllDayPillInteraction(
		itemEl: HTMLElement,
		item: CalendarItem,
		settings: OperonSettings,
	): void {
				let pendingTouchDrag: {
					pointerId: number;
					initialClientX: number;
					initialClientY: number;
					latestClientX: number;
					latestClientY: number;
					previousClientY: number;
					mode: 'pending' | 'scrolling';
					timerId: ReturnType<Window['setTimeout']>;
					ownerWindow: Window;
					onPointerMove: (event: PointerEvent) => void;
					onPointerUp: (event: PointerEvent) => void;
				onPointerCancel: (event: PointerEvent) => void;
				onWindowBlur: () => void;
			} | null = null;
			let activeMoveCleanup: (() => void) | null = null;
			let dragState: {
				pointerId: number;
				timedSelection: CalendarSlotSelection | null;
				timedPreviewEl: HTMLElement | null;
				dragGhostEl: HTMLElement | null;
				suppressClickOnFinish: boolean;
			} | null = null;
			let touchDragActiveBody: HTMLElement | null = null;

				const isTouchPointer = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';
				const resolveTouchTapDistancePx = (): number => CALENDAR_MOBILE_TOUCH_CANCEL_DISTANCE_PX;
				const resolveMobileSlotMinutes = (): number => Math.max(15, Math.round(settings.calendarMobileSlotMinutes || 30));

				const suppressNextTouchClick = (): void => {
					const ownerWindow = getOwnerWindow(itemEl);
					itemEl.dataset.suppressCalendarClick = 'true';
					ownerWindow.setTimeout(() => {
						if (itemEl.dataset.suppressCalendarClick === 'true') {
							delete itemEl.dataset.suppressCalendarClick;
						}
					}, CALENDAR_TOUCH_CLICK_SUPPRESSION_MS);
				};

				const suppressNextTouchClickAtWindow = (ownerWindow: Window): void => {
					let cleanupTimer: ReturnType<Window['setTimeout']> | null = null;
					const cleanup = (): void => {
						ownerWindow.removeEventListener('click', onClick, true);
						if (cleanupTimer !== null) {
							ownerWindow.clearTimeout(cleanupTimer);
							cleanupTimer = null;
						}
					};
					const onClick = (clickEvent: MouseEvent): void => {
						const target = asHTMLElement(clickEvent.target, itemEl);
						if (!target || !itemEl.contains(target)) return;
						clickEvent.preventDefault();
						clickEvent.stopPropagation();
						clickEvent.stopImmediatePropagation();
						cleanup();
					};
					ownerWindow.addEventListener('click', onClick, true);
					cleanupTimer = ownerWindow.setTimeout(cleanup, CALENDAR_TOUCH_CLICK_SUPPRESSION_MS);
				};

				const setTouchDragActiveClass = (): void => {
					const body = getOwnerBody(itemEl);
					if (touchDragActiveBody && touchDragActiveBody !== body) {
						touchDragActiveBody.classList.remove('operon-calendar-touch-drag-active');
					}
				touchDragActiveBody = body;
				touchDragActiveBody.classList.add('operon-calendar-touch-drag-active');
			};

			const clearTouchDragActiveClass = (): void => {
				touchDragActiveBody?.classList.remove('operon-calendar-touch-drag-active');
				touchDragActiveBody = null;
			};

			const clearActiveMove = (): void => {
				activeMoveCleanup?.();
				activeMoveCleanup = null;
			};

			const clearPendingTouchDrag = (): void => {
				if (!pendingTouchDrag) return;
				const pending = pendingTouchDrag;
				pending.ownerWindow.clearTimeout(pending.timerId);
				pending.ownerWindow.removeEventListener('pointermove', pending.onPointerMove, true);
				pending.ownerWindow.removeEventListener('pointerup', pending.onPointerUp, true);
				pending.ownerWindow.removeEventListener('pointercancel', pending.onPointerCancel, true);
				pending.ownerWindow.removeEventListener('blur', pending.onWindowBlur, true);
					itemEl.removeClass('is-touch-drag-pending');
					pendingTouchDrag = null;
				};

				const getPendingDistance = (clientX: number, clientY: number, pending = pendingTouchDrag): number => {
					if (!pending) return Number.POSITIVE_INFINITY;
					return Math.hypot(clientX - pending.initialClientX, clientY - pending.initialClientY);
				};

				const scrollMobileAllDayRailBy = (deltaY: number): void => {
					if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
					const viewport = itemEl.closest<HTMLElement>('.operon-calendar-mobile-timegrid-all-day-days');
					if (!viewport) return;
					const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
					viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop + deltaY));
				};

				const openEditorFromTouchTap = (): void => {
					if (!this.callbacks.onItemAction) return;
					const ownerWindow = getOwnerWindow(itemEl);
					suppressNextTouchClick();
					suppressNextTouchClickAtWindow(ownerWindow);
					ownerWindow.setTimeout(() => {
						if (!itemEl.isConnected) return;
						void this.callbacks.onItemAction?.(item.taskId, 'openEditor');
					}, CALENDAR_TOUCH_TAP_EDITOR_DELAY_MS);
				};

				const clearTimedPreview = (): void => {
					if (!dragState) return;
					dragState.timedSelection = null;
					dragState.timedPreviewEl?.remove();
					dragState.timedPreviewEl = null;
				this.timedDropContext?.hoverGuideOverlay.empty();
			};

			const updateFromPointer = (clientX: number, clientY: number): void => {
				if (!dragState) return;
				this.updateCalendarDragGhostPosition(dragState.dragGhostEl, clientX, clientY);
				const context = this.timedDropContext;
				if (!context?.isMobile) {
					clearTimedPreview();
					return;
				}
				const timedRect = context.daysGrid.getBoundingClientRect();
				const insideTimed = clientX >= timedRect.left
					&& clientX <= timedRect.right
					&& clientY >= timedRect.top
					&& clientY <= timedRect.bottom;
				if (!insideTimed) {
					clearTimedPreview();
					return;
				}
				const position = context.resolvePosition?.(clientX, clientY) ?? this.resolveTimedGridPosition(
					context.daysGrid,
					context.visibleDates,
					context.metrics,
					clientX,
					clientY,
				);
				if (!position) {
					clearTimedPreview();
					return;
				}
				const dateKey = context.visibleDates[position.dayIndex] ?? item.startDate;
				const mobileSlotMinutes = resolveMobileSlotMinutes();
				const duration = this.resolveCalendarTaskDurationMinutes(item, mobileSlotMinutes);
				const endMinute = Math.min(24 * 60, position.minuteOfDay + duration);
				const selection = buildTimedSlotSelection(
					dateKey,
					position.minuteOfDay,
					endMinute,
					CALENDAR_TIMED_SNAP_MINUTES,
				);
				selection.slotMinutes = mobileSlotMinutes;
				dragState.timedSelection = selection;
				if (!dragState.timedPreviewEl) {
					dragState.timedPreviewEl = (context.previewOverlay ?? context.daysGrid).createDiv('operon-calendar-timed-transfer-preview operon-calendar-mobile-timed-transfer-preview');
				}
				const previewStart = this.extractMinuteOfDay(selection.start);
				const previewEnd = Math.min(24 * 60, previewStart + duration);
				if (context.applyTransferPreviewStyle) {
					context.applyTransferPreviewStyle(dragState.timedPreviewEl, position.dayIndex, previewStart, previewEnd);
				} else {
					this.applyTimedPlacementStyle(
						dragState.timedPreviewEl,
						position.dayIndex,
						0,
						1,
						previewStart,
						previewEnd,
						context.visibleDates.length,
						context.metrics,
					);
				}
				context.hoverGuideOverlay.empty();
				this.renderTimedSelectionGuides(
					context.section,
					context.gutter,
					context.daysGrid,
					context.hoverGuideOverlay,
					dateKey,
					previewStart,
					previewEnd,
					context.metrics,
					'var(--interactive-accent)',
					context.settings,
					position.dayIndex,
					context.visibleDates.length,
				);
			};

			const clearDragState = (): void => {
				if (!dragState) return;
				this.releaseCalendarPointerCapture(itemEl, dragState.pointerId);
				itemEl.removeClass('is-dragging');
				itemEl.removeClass('operon-calendar-drag-source-hidden');
				this.removeCalendarDragGhost(dragState.dragGhostEl);
				dragState.timedPreviewEl?.remove();
				this.timedDropContext?.hoverGuideOverlay.empty();
				clearActiveMove();
				clearTouchDragActiveClass();
			};

			const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
				if (!dragState) return;
				if (event && event.pointerId !== dragState.pointerId) return;
				clearPendingTouchDrag();
				if (event) {
					updateFromPointer(event.clientX, event.clientY);
				}
				const selection = dragState.timedSelection;
				const suppressClickOnFinish = dragState.suppressClickOnFinish;
				clearDragState();
				dragState = null;
				if (suppressClickOnFinish) {
					itemEl.dataset.suppressCalendarClick = 'true';
				}
				if (reason !== 'commit' || !selection) return;
				const writebackPlan = buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
					selection,
					item.renderSnapshot.fieldValues,
					{ preserveExistingDuration: true },
				);
				this.captureMobileTimeGridScrollForRender();
				this.invokeCalendarDropCallback(
					item.taskId,
					writebackPlan.payload,
					() => this.callbacks.onAllDayItemDropToTimed?.(item.taskId, selection, writebackPlan.payload),
					{ verifyOptimisticPatchAfterWrite: true },
				);
			};

			const bindActiveMove = (pointerId: number, ownerWindow: Window): void => {
				clearActiveMove();
				const onPointerMove = (event: PointerEvent): void => {
					if (event.pointerId !== pointerId) return;
					event.preventDefault();
					event.stopPropagation();
					updateFromPointer(event.clientX, event.clientY);
				};
				ownerWindow.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
				activeMoveCleanup = () => ownerWindow.removeEventListener('pointermove', onPointerMove, true);
			};

			const startDrag = (
				pointerId: number,
				clientX: number,
				clientY: number,
				ownerWindow: Window,
				suppressClickOnFinish: boolean,
			): void => {
				clearPendingTouchDrag();
				this.hideCalendarHoverMenu(true);
				itemEl.addClass('is-dragging');
				itemEl.addClass('operon-calendar-drag-source-hidden');
				setTouchDragActiveClass();
				dragState = {
					pointerId,
					timedSelection: null,
					timedPreviewEl: null,
					dragGhostEl: this.createCalendarDragGhost(itemEl, 'operon-calendar-mobile-all-day-drag-ghost'),
					suppressClickOnFinish,
				};
				this.beginCalendarDragSession(itemEl, pointerId, finishDrag);
				try {
					itemEl.setPointerCapture?.(pointerId);
				} catch {
					// Pointer capture is best-effort in mobile WebViews.
				}
				bindActiveMove(pointerId, ownerWindow);
				updateFromPointer(clientX, clientY);
			};

				const startPendingTouchDrag = (event: PointerEvent): void => {
					clearPendingTouchDrag();
					event.preventDefault();
					event.stopPropagation();
					const ownerWindow = getOwnerWindow(itemEl);
					const pointerId = event.pointerId;
					try {
						itemEl.setPointerCapture?.(pointerId);
					} catch {
						// Pointer capture is best-effort in mobile WebViews.
					}
					const onPointerMove = (moveEvent: PointerEvent): void => {
						const pending = pendingTouchDrag;
						if (!pending || moveEvent.pointerId !== pointerId) return;
						moveEvent.preventDefault();
						moveEvent.stopPropagation();
						pending.latestClientX = moveEvent.clientX;
						pending.latestClientY = moveEvent.clientY;
						if (pending.mode === 'scrolling') {
							scrollMobileAllDayRailBy(pending.previousClientY - moveEvent.clientY);
							pending.previousClientY = moveEvent.clientY;
							return;
						}
						if (getPendingDistance(moveEvent.clientX, moveEvent.clientY, pending) > resolveTouchTapDistancePx()) {
							pending.mode = 'scrolling';
							pending.ownerWindow.clearTimeout(pending.timerId);
							itemEl.removeClass('is-touch-drag-pending');
							scrollMobileAllDayRailBy(pending.previousClientY - moveEvent.clientY);
							pending.previousClientY = moveEvent.clientY;
						}
					};
					const onPointerUp = (upEvent: PointerEvent): void => {
						const pending = pendingTouchDrag;
						if (!pending || upEvent.pointerId !== pointerId) return;
						upEvent.preventDefault();
						upEvent.stopPropagation();
						if (pending.mode === 'scrolling') {
							clearPendingTouchDrag();
							this.releaseCalendarPointerCapture(itemEl, pointerId);
							return;
						}
						const shouldOpenEditor = getPendingDistance(upEvent.clientX, upEvent.clientY, pending) <= resolveTouchTapDistancePx();
						clearPendingTouchDrag();
						this.releaseCalendarPointerCapture(itemEl, pointerId);
						if (shouldOpenEditor) {
							openEditorFromTouchTap();
						}
					};
					const onPointerCancel = (cancelEvent: PointerEvent): void => {
						if (!pendingTouchDrag || cancelEvent.pointerId !== pointerId) return;
						cancelEvent.preventDefault();
						clearPendingTouchDrag();
						this.releaseCalendarPointerCapture(itemEl, pointerId);
					};
					const onWindowBlur = (): void => clearPendingTouchDrag();
					const timerId = ownerWindow.setTimeout(() => {
						const pending = pendingTouchDrag;
						if (!pending || pending.pointerId !== pointerId) return;
					startDrag(pointerId, pending.latestClientX, pending.latestClientY, ownerWindow, true);
				}, CALENDAR_MOBILE_TASK_LONG_PRESS_MS);
				pendingTouchDrag = {
					pointerId,
					initialClientX: event.clientX,
						initialClientY: event.clientY,
						latestClientX: event.clientX,
						latestClientY: event.clientY,
						previousClientY: event.clientY,
						mode: 'pending',
						timerId,
						ownerWindow,
						onPointerMove,
						onPointerUp,
					onPointerCancel,
					onWindowBlur,
				};
				itemEl.addClass('is-touch-drag-pending');
				ownerWindow.addEventListener('pointermove', onPointerMove, true);
				ownerWindow.addEventListener('pointerup', onPointerUp, true);
				ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
				ownerWindow.addEventListener('blur', onWindowBlur, true);
			};

			itemEl.addEventListener('pointerdown', (event: PointerEvent) => {
				if (event.button !== 0) return;
				const target = asHTMLElement(event.target, itemEl);
				if (target?.closest('.operon-calendar-item-action-button, .operon-calendar-status-button, a.internal-link')) return;
				if (isTouchPointer(event)) {
					startPendingTouchDrag(event);
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				startDrag(event.pointerId, event.clientX, event.clientY, getOwnerWindow(itemEl), false);
			});

			itemEl.addEventListener('pointerup', (event: PointerEvent) => this.finishActiveCalendarDragSession('commit', event));
			itemEl.addEventListener('pointercancel', (event: PointerEvent) => this.finishActiveCalendarDragSession('cancel', event));
		}

	private renderMobileTimeGridGutterLabels(
		gutter: HTMLElement,
		dateKey: string,
		metrics: CalendarTimedMetrics,
		settings: OperonSettings,
	): void {
		for (let hour = 0; hour <= 24; hour++) {
			const label = gutter.createDiv('operon-calendar-mobile-timegrid-time-label');
			label.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : this.minuteToGridOffset(hour * 60, metrics)}px`;
			label.createSpan({ text: formatUiMinuteOfDay(this.app, settings, dateKey, hour * 60) });
			if (hour === 0) label.addClass('is-first');
			if (hour === 24) label.addClass('is-last');
		}
	}

	private renderMobileTimeGridDayColumns(
		daysGrid: HTMLElement,
		visibleDates: string[],
		metrics: CalendarTimedMetrics,
		settings: OperonSettings,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		timeGrid: HTMLElement,
		visibleDayCount: number,
		preset: CalendarPreset,
	): void {
		const slotMinutes = Math.max(15, this.getSettings().calendarMobileSlotMinutes || 30);
		const dayModels = preset.surfaceType === 'timeTrackerGrid'
			? this.resolveTimeTrackerGridDayLaneModels(preset, visibleDates)
			: preset.surfaceType === 'timeGrid'
				? this.resolveTimeGridDayLaneModels(preset, visibleDates)
				: [];
		const dayModelByDate = new Map(dayModels.map(dayModel => [dayModel.dateKey, dayModel]));
		if (dayModels.length > 0) {
			daysGrid.style.gridTemplateColumns = this.buildTimeTrackerGridLaneGridTemplate(dayModels);
			daysGrid.style.removeProperty('--operon-calendar-mobile-tracker-lane-count');
		} else {
			daysGrid.style.gridTemplateColumns = `repeat(${Math.max(1, visibleDates.length)}, minmax(0, 1fr))`;
			daysGrid.style.removeProperty('--operon-calendar-mobile-tracker-lane-count');
		}
		for (let dayIndex = 0; dayIndex < visibleDates.length; dayIndex++) {
			const dateKey = visibleDates[dayIndex];
			const dayModel = dayModelByDate.get(dateKey) ?? null;
			const lanes = dayModel?.semanticLanes ?? [{ id: 'planned' as const, semanticIndex: 0 }];
			for (const lane of lanes) {
				const column = daysGrid.createDiv('operon-calendar-mobile-timegrid-day-column');
				column.dataset.dateKey = dateKey;
				column.dataset.dayIndex = String(dayIndex);
				if (dayModel) {
					column.dataset.semanticLane = lane.id;
					column.addClass('operon-calendar-mobile-time-tracker-grid-column', `is-${lane.id}-lane`);
					column.classList.toggle('is-semantic-lane-end', lane.semanticIndex === dayModel.semanticLaneCount - 1);
				}
				column.classList.toggle('is-today', dateKey === localToday());
				const dayDate = this.parseDateKey(dateKey);
				column.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
				for (let minute = 0; minute <= CALENDAR_MOBILE_TIME_GRID_MINUTES_PER_DAY; minute += slotMinutes) {
					const line = column.createDiv('operon-calendar-mobile-timegrid-line');
					line.classList.toggle('is-hour', minute % 60 === 0);
					line.style.top = `${minute === CALENDAR_MOBILE_TIME_GRID_MINUTES_PER_DAY
						? Math.max(0, metrics.gridHeight - 1)
						: this.minuteToGridOffset(minute, metrics)}px`;
				}
				if (dateKey === localToday()) {
					this.attachNowIndicator(column, metrics, dayModel
						? {
							showLabel: lane.semanticIndex === 0,
							labelSpan: dayModel.semanticLaneCount,
						}
						: undefined);
				}
				if (lane.id === 'planned') {
					this.bindMobileTimeGridSelection(column, dateKey, settings, metrics, section, gutter, hoverGuideOverlay, timeGrid, visibleDayCount);
				} else if (lane.id === 'tracked') {
					this.bindMobileTimeGridSelection(
						column,
						dateKey,
						settings,
						metrics,
						section,
						gutter,
						hoverGuideOverlay,
						timeGrid,
						visibleDayCount,
						this.callbacks.onTrackedSlotSelection ?? null,
					);
				}
			}
		}
	}

	private collectMobileTimeGridLaneColumns(
		daysGrid: HTMLElement,
		visibleDates: string[],
	): TimeTrackerGridLaneColumns {
		const laneColumns: TimeTrackerGridLaneColumns = {
			planned: [],
			external: [],
			tracked: [],
		};
		for (const column of Array.from(daysGrid.querySelectorAll<HTMLElement>('.operon-calendar-mobile-time-tracker-grid-column'))) {
			const laneId = column.dataset.semanticLane as TimeTrackerGridLaneId | undefined;
			if (laneId === 'planned' || laneId === 'external' || laneId === 'tracked') {
				const fallbackDayIndex = visibleDates.indexOf(column.dataset.dateKey ?? '');
				const parsedDayIndex = Number(column.dataset.dayIndex);
				laneColumns[laneId].push({
					element: column,
					dateKey: column.dataset.dateKey ?? '',
					dayIndex: Number.isFinite(parsedDayIndex) ? parsedDayIndex : Math.max(0, fallbackDayIndex),
				});
			}
		}
		return laneColumns;
	}

	private bindMobileTimeGridSelection(
		column: HTMLElement,
		dateKey: string,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		timeGrid: HTMLElement,
		renderedDayCount: number,
		onSelect?: ((selection: CalendarSlotSelection) => void | Promise<void>) | null,
	): void {
		let selectionState: {
			pointerId: number;
			anchorMinute: number;
			currentMinute: number;
			selectionEl: HTMLElement;
			activeCleanup: (() => void) | null;
		} | null = null;
		type PendingMobileTouchSelection = {
			pointerId: number;
			initialClientX: number;
			initialClientY: number;
			latestClientY: number;
			mode: 'pending' | 'swiping';
			swipeIntent: Exclude<CalendarMobileEmptyAreaSwipeIntent, 'pending'> | null;
			timerId: ReturnType<Window['setTimeout']>;
			ownerWindow: Window;
			cleanup: () => void;
		};
		let pendingTouchSelection: PendingMobileTouchSelection | null = null;

		const isTouchPointer = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';
		const resolveLongPressMs = (): number => CALENDAR_MOBILE_EMPTY_SELECTION_LONG_PRESS_MS;
		const resolveCancelDistancePx = (): number => CALENDAR_MOBILE_TOUCH_CANCEL_DISTANCE_PX;
		const generation = this.renderGeneration;
		const isBlockedMobileEmptyAreaGestureTarget = (target: HTMLElement | null): boolean => Boolean(target?.closest(
			'.operon-calendar-mobile-timegrid-item, .operon-calendar-mobile-item, .operon-calendar-item-action-button, .operon-calendar-status-button',
		));

			const clearMobileSwipeVisual = (): void => {
				timeGrid.removeClass('is-mobile-empty-swipe-active');
				timeGrid.removeClass('is-mobile-empty-swipe-snapping');
				timeGrid.setCssProps({ '--operon-calendar-mobile-buffer-swipe-x': '0px' });
			};

		const clearPendingTouchSelection = (): void => {
			if (!pendingTouchSelection) return;
			const pending = pendingTouchSelection;
			pending.ownerWindow.clearTimeout(pending.timerId);
			pending.cleanup();
			this.releaseCalendarPointerCapture(column, pending.pointerId);
			pendingTouchSelection = null;
			clearMobileSwipeVisual();
		};

		const buildSingleSlotSelection = (clientY: number): CalendarSlotSelection => {
			const startMinute = this.resolveTimedMinuteOffset(column, clientY, metrics);
			return buildTimedSlotSelection(
				dateKey,
				startMinute,
				startMinute + settings.calendarMobileSlotMinutes,
				settings.calendarMobileSlotMinutes,
			);
		};

		const clearSelectionState = (): void => {
			if (!selectionState) return;
			selectionState.activeCleanup?.();
			selectionState.selectionEl.remove();
			hoverGuideOverlay.empty();
			getOwnerBody(column).classList.remove('operon-calendar-touch-drag-active');
			column.removeClass('is-selecting');
			selectionState = null;
		};

		const renderSelection = (): CalendarSlotSelection | null => {
			if (!selectionState) return null;
			const selection = buildTimedSlotSelection(
				dateKey,
				selectionState.anchorMinute,
				selectionState.currentMinute,
				settings.calendarMobileSlotMinutes,
			);
			const startMinutes = this.extractMinuteOfDay(selection.start);
			const endMinutes = this.extractMinuteOfDay(selection.end);
			const top = this.minuteToGridOffset(startMinutes, metrics);
			const height = Math.max(1, this.minuteToGridOffset(endMinutes, metrics) - top);
			selectionState.selectionEl.style.top = `${Math.max(0, top)}px`;
			selectionState.selectionEl.style.height = `${height}px`;
			this.renderTimedSelectionGuides(
				section,
				gutter,
				column,
				hoverGuideOverlay,
				dateKey,
				startMinutes,
				endMinutes,
				metrics,
				'var(--interactive-accent)',
				settings,
			);
			return selection;
		};

		const updateSelectionFromY = (clientY: number): CalendarSlotSelection | null => {
			if (!selectionState) return null;
			selectionState.currentMinute = this.resolveTimedMinuteOffset(column, clientY, metrics);
			return renderSelection();
		};

		const invokeMobileSlotCreate = (selection: CalendarSlotSelection): void => {
			const callback = onSelect === null
				? undefined
				: onSelect ?? this.callbacks.onMobileTimedSlotCreate ?? this.callbacks.onTimedSlotSelection;
			if (!callback) return;
			this.preserveMobileTimeGridScrollForTaskCreate();
			void callback(selection);
		};

			const setMobileSwipeVisualOffset = (deltaX: number): void => {
				const dayWidth = this.resolveMobileTimeGridBufferedSwipeDayWidth(timeGrid, renderedDayCount);
				const maxOffset = Math.max(24, dayWidth * 0.82);
				const offset = Math.max(-maxOffset, Math.min(maxOffset, deltaX));
				timeGrid.addClass('is-mobile-empty-swipe-active');
				timeGrid.removeClass('is-mobile-empty-swipe-snapping');
				timeGrid.setCssProps({ '--operon-calendar-mobile-buffer-swipe-x': `${offset}px` });
			};

		const commitMobileSwipe = (intent: Exclude<CalendarMobileEmptyAreaSwipeIntent, 'pending'>): void => {
				const dayDelta = intent === 'next' ? 1 : -1;
				const dayWidth = this.resolveMobileTimeGridBufferedSwipeDayWidth(timeGrid, renderedDayCount);
				this.captureMobileTimeGridScrollForRender();
				timeGrid.addClass('is-mobile-empty-swipe-active');
				timeGrid.addClass('is-mobile-empty-swipe-snapping');
				timeGrid.setCssProps({ '--operon-calendar-mobile-buffer-swipe-x': `${dayDelta > 0 ? -dayWidth : dayWidth}px` });
				this.setRenderTimeout(generation, () => {
					void this.shiftMobileCalendarAnchorByDays(dayDelta).finally(clearMobileSwipeVisual);
				}, CALENDAR_MOBILE_EMPTY_SWIPE_ANIMATION_MS);
		};

		const stopMobileHorizontalSwipeEvent = (event: Event): void => {
			if (event.cancelable) {
				event.preventDefault();
			}
			event.stopPropagation();
			event.stopImmediatePropagation();
		};

		const applyMobileHorizontalSwipeMove = (
			event: Event,
			pending: PendingMobileTouchSelection,
			deltaX: number,
			deltaY: number,
		): boolean => {
			const swipeIntent = resolveCalendarMobileEmptyAreaSwipeIntent({
				deltaX,
				deltaY,
				swipeDistancePx: CALENDAR_MOBILE_EMPTY_SWIPE_DISTANCE_PX,
				dominanceRatio: CALENDAR_MOBILE_EMPTY_SWIPE_DOMINANCE_RATIO,
			});
			const ownsHorizontalSwipe = shouldOwnCalendarMobileEmptyAreaHorizontalSwipe({
				deltaX,
				deltaY,
				ownershipDistancePx: CALENDAR_MOBILE_EMPTY_SWIPE_OWNERSHIP_DISTANCE_PX,
				dominanceRatio: CALENDAR_MOBILE_EMPTY_SWIPE_OWNERSHIP_DOMINANCE_RATIO,
			});
			if (pending.mode === 'swiping' || swipeIntent !== 'pending') {
				stopMobileHorizontalSwipeEvent(event);
				pending.mode = 'swiping';
				pending.swipeIntent = swipeIntent !== 'pending'
					? swipeIntent
					: pending.swipeIntent;
				pending.ownerWindow.clearTimeout(pending.timerId);
				setMobileSwipeVisualOffset(deltaX);
				return true;
			}
			if (ownsHorizontalSwipe) {
				stopMobileHorizontalSwipeEvent(event);
				pending.ownerWindow.clearTimeout(pending.timerId);
				return true;
			}
			return false;
		};

		const finishSelection = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
			if (!selectionState) return;
			const pointerId = selectionState.pointerId;
			if (event && event.pointerId !== pointerId) return;
			const selection = event ? updateSelectionFromY(event.clientY) : renderSelection();
			this.releaseCalendarPointerCapture(column, pointerId);
			clearSelectionState();
			if (reason !== 'commit' || !selection) return;
			invokeMobileSlotCreate(selection);
		};

		const bindActiveSelectionWindowEvents = (pointerId: number, ownerWindow: Window): (() => void) => {
			const onPointerMove = (event: PointerEvent): void => {
				if (event.pointerId !== pointerId) return;
				event.preventDefault();
				updateSelectionFromY(event.clientY);
			};
			const onPointerUp = (event: PointerEvent): void => {
				if (event.pointerId !== pointerId) return;
				event.preventDefault();
				this.finishActiveCalendarDragSession('commit', event);
			};
			const onPointerCancel = (event: PointerEvent): void => {
				if (event.pointerId !== pointerId) return;
				this.finishActiveCalendarDragSession('cancel', event);
			};
			const onBlur = (): void => this.finishActiveCalendarDragSession('cancel', null);
			ownerWindow.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
			ownerWindow.addEventListener('pointerup', onPointerUp, true);
			ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
			ownerWindow.addEventListener('blur', onBlur, true);
			return () => {
				ownerWindow.removeEventListener('pointermove', onPointerMove, true);
				ownerWindow.removeEventListener('pointerup', onPointerUp, true);
				ownerWindow.removeEventListener('pointercancel', onPointerCancel, true);
				ownerWindow.removeEventListener('blur', onBlur, true);
			};
		};

		const startSelection = (pointerId: number, clientY: number, ownerWindow: Window): void => {
			clearPendingTouchSelection();
			this.hideCalendarHoverMenu(true);
			const anchorMinute = this.resolveTimedMinuteOffset(column, clientY, metrics);
			const selectionEl = column.createDiv('operon-calendar-timed-selection operon-calendar-mobile-timegrid-selection');
			column.addClass('is-selecting');
			getOwnerBody(column).classList.add('operon-calendar-touch-drag-active');
			selectionState = {
				pointerId,
				anchorMinute,
				currentMinute: anchorMinute,
				selectionEl,
				activeCleanup: null,
			};
			selectionState.activeCleanup = bindActiveSelectionWindowEvents(pointerId, ownerWindow);
			this.beginCalendarDragSession(column, pointerId, finishSelection);
			try {
				column.setPointerCapture?.(pointerId);
			} catch {
				// Pointer capture can be unavailable in embedded mobile WebViews.
			}
			renderSelection();
		};

		const startPendingTouchSelection = (event: PointerEvent): void => {
			clearPendingTouchSelection();
			const ownerWindow = getOwnerWindow(column);
			const pointerId = event.pointerId;
			let latestClientY = event.clientY;
			const cleanupFns: Array<() => void> = [];
			const cleanup = (): void => {
				for (const fn of cleanupFns) fn();
				cleanupFns.length = 0;
			};
			const cancelIfMovedTooFar = (clientX: number, clientY: number): boolean => {
				const pending = pendingTouchSelection;
				if (!pending) return true;
				const distance = Math.hypot(clientX - pending.initialClientX, clientY - pending.initialClientY);
				if (distance <= resolveCancelDistancePx()) return false;
				clearPendingTouchSelection();
				return true;
			};
			const onPointerMove = (moveEvent: PointerEvent): void => {
				if (moveEvent.pointerId !== pointerId) return;
				latestClientY = moveEvent.clientY;
				if (pendingTouchSelection) {
					pendingTouchSelection.latestClientY = moveEvent.clientY;
				}
				const pending = pendingTouchSelection;
				if (!pending) return;
				const deltaX = moveEvent.clientX - pending.initialClientX;
				const deltaY = moveEvent.clientY - pending.initialClientY;
				if (applyMobileHorizontalSwipeMove(moveEvent, pending, deltaX, deltaY)) {
					return;
				}
				cancelIfMovedTooFar(moveEvent.clientX, moveEvent.clientY);
			};
			const onTouchMove = (touchEvent: TouchEvent): void => {
				const pending = pendingTouchSelection;
				if (!pending) return;
				const touch = touchEvent.touches.item(0) ?? touchEvent.changedTouches.item(0);
				if (!touch) return;
				latestClientY = touch.clientY;
				pending.latestClientY = touch.clientY;
				const deltaX = touch.clientX - pending.initialClientX;
				const deltaY = touch.clientY - pending.initialClientY;
				if (applyMobileHorizontalSwipeMove(touchEvent, pending, deltaX, deltaY)) {
					return;
				}
			};
			const onPointerUp = (upEvent: PointerEvent): void => {
				const pending = pendingTouchSelection;
				if (!pending || upEvent.pointerId !== pointerId) return;
				upEvent.preventDefault();
				upEvent.stopPropagation();
				upEvent.stopImmediatePropagation();
				if (pending.mode === 'swiping') {
					const swipeIntent = pending.swipeIntent;
					clearPendingTouchSelection();
					if (swipeIntent) {
						commitMobileSwipe(swipeIntent);
					}
					return;
				}
				const shouldCreateSingleSlot = Math.hypot(
					upEvent.clientX - pending.initialClientX,
					upEvent.clientY - pending.initialClientY,
				) <= resolveCancelDistancePx();
				clearPendingTouchSelection();
				if (!shouldCreateSingleSlot) return;
				invokeMobileSlotCreate(buildSingleSlotSelection(upEvent.clientY));
			};
			const onPointerCancel = (cancelEvent: PointerEvent): void => {
				if (cancelEvent.pointerId !== pointerId) return;
				clearPendingTouchSelection();
			};
			const onBlur = (): void => clearPendingTouchSelection();
			const timerId = ownerWindow.setTimeout(() => {
				if (!pendingTouchSelection || pendingTouchSelection.pointerId !== pointerId) return;
				clearPendingTouchSelection();
				startSelection(pointerId, latestClientY, ownerWindow);
			}, resolveLongPressMs());

			pendingTouchSelection = {
				pointerId,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				latestClientY,
				mode: 'pending',
				swipeIntent: null,
				timerId,
				ownerWindow,
				cleanup,
			};
			try {
				column.setPointerCapture?.(pointerId);
			} catch {
				// Pointer capture is best-effort in embedded mobile WebViews.
			}
			ownerWindow.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
			ownerWindow.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
			ownerWindow.addEventListener('pointerup', onPointerUp, true);
			ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
			ownerWindow.addEventListener('blur', onBlur, true);
			cleanupFns.push(
				() => ownerWindow.removeEventListener('pointermove', onPointerMove, true),
				() => ownerWindow.removeEventListener('touchmove', onTouchMove, true),
				() => ownerWindow.removeEventListener('pointerup', onPointerUp, true),
				() => ownerWindow.removeEventListener('pointercancel', onPointerCancel, true),
				() => ownerWindow.removeEventListener('blur', onBlur, true),
			);
		};

		column.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, column);
			if (isBlockedMobileEmptyAreaGestureTarget(target)) return;
			if (isTouchPointer(event)) {
				event.stopPropagation();
				startPendingTouchSelection(event);
				return;
			}
			event.preventDefault();
			startSelection(event.pointerId, event.clientY, getOwnerWindow(column));
		});

		column.addEventListener('pointermove', (event: PointerEvent) => {
			if (!selectionState || selectionState.pointerId !== event.pointerId) return;
			updateSelectionFromY(event.clientY);
		});

		column.addEventListener('touchstart', (event: TouchEvent) => {
			const target = asHTMLElement(event.target, column);
			if (isBlockedMobileEmptyAreaGestureTarget(target)) return;
			event.stopPropagation();
		}, { capture: true, passive: true });

		column.addEventListener('pointerup', (event: PointerEvent) => this.finishActiveCalendarDragSession('commit', event));
		column.addEventListener('pointercancel', (event: PointerEvent) => this.finishActiveCalendarDragSession('cancel', event));
	}

	private renderMobileTimeGridItems(
		daysGrid: HTMLElement,
		visibleDates: string[],
		timedItems: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
	): void {
		const overlay = daysGrid.createDiv('operon-calendar-mobile-timegrid-overlay');
		overlay.style.height = `${metrics.gridHeight}px`;
		this.timedDropContext = {
			section,
			gutter,
			daysGrid,
			hoverGuideOverlay,
			visibleDates: [...visibleDates],
			metrics,
			preset,
			settings,
			isMobile: true,
		};
		const placements = this.buildTimedGridVisualPlacements(timedItems, visibleDates);
		for (const placement of placements) {
			this.renderMobileTimeGridItem(overlay, daysGrid, placement, visibleDates, preset, settings, metrics, section, gutter, hoverGuideOverlay);
		}
		this.updateNowIndicators();
		if (this.nowIndicatorEntries.length > 0) {
			this.nowIndicatorTimer = window.setInterval(() => this.updateNowIndicators(), 30000);
		}
	}

	private renderMobileTimeGridSemanticItems(
		daysGrid: HTMLElement,
		visibleDates: string[],
		timedItems: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
	): void {
		const dayModels = this.resolveTimeGridDayLaneModels(preset, visibleDates);
		const overlay = daysGrid.createDiv('operon-calendar-mobile-timegrid-overlay operon-calendar-mobile-time-grid-semantic-overlay');
		overlay.style.height = `${metrics.gridHeight}px`;
		const laneColumns = this.collectMobileTimeGridLaneColumns(daysGrid, visibleDates);
		this.timedDropContext = {
			section,
			gutter,
			daysGrid,
			previewOverlay: overlay,
			hoverGuideOverlay,
			visibleDates: [...visibleDates],
			metrics,
			preset,
			settings,
			isMobile: true,
			resolvePosition: (clientX, clientY) => this.resolveTimeTrackerGridLanePosition(laneColumns.planned, metrics, clientX, clientY),
			applyTransferPreviewStyle: (element, dayIndex, startMinutes, endMinutes) => {
				const dayModel = dayModels[dayIndex];
				const plannedLane = dayModel?.plannedLane;
				if (!dayModel || !plannedLane) return;
				this.applyTimeTrackerGridTimedPlacementStyle(
					element,
					dayIndex,
					plannedLane.semanticIndex,
					dayModel.semanticLaneCount,
					0,
					1,
					startMinutes,
					endMinutes,
					visibleDates.length,
					metrics,
				);
			},
		};

		this.renderMobileTimeTrackerGridCalendarLaneItems(
			overlay,
			daysGrid,
			laneColumns.planned,
			'planned',
			dayModels,
			timedItems.filter(item => item.origin !== 'external'),
			visibleDates,
			preset,
			settings,
			metrics,
			section,
			gutter,
			hoverGuideOverlay,
			true,
		);
		if (dayModels.some(dayModel => dayModel.externalLane)) {
			this.renderMobileTimeTrackerGridCalendarLaneItems(
				overlay,
				daysGrid,
				laneColumns.external,
				'external',
				dayModels,
				timedItems.filter(item => item.origin === 'external'),
				visibleDates,
				preset,
				settings,
				metrics,
				section,
				gutter,
				hoverGuideOverlay,
				false,
			);
		}
		this.updateNowIndicators();
		if (this.nowIndicatorEntries.length > 0) {
			this.nowIndicatorTimer = window.setInterval(() => this.updateNowIndicators(), 30000);
		}
	}

	private renderMobileTimeTrackerGridItems(
		daysGrid: HTMLElement,
		visibleDates: string[],
		timedItems: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
	): void {
		const dayModels = this.resolveTimeTrackerGridDayLaneModels(preset, visibleDates);
		const overlay = daysGrid.createDiv('operon-calendar-mobile-timegrid-overlay operon-calendar-mobile-time-tracker-grid-overlay');
		overlay.style.height = `${metrics.gridHeight}px`;
		const laneColumns = this.collectMobileTimeGridLaneColumns(daysGrid, visibleDates);
		this.timedDropContext = {
			section,
			gutter,
			daysGrid,
			previewOverlay: overlay,
			hoverGuideOverlay,
			visibleDates: [...visibleDates],
			metrics,
			preset,
			settings,
			isMobile: true,
			resolvePosition: (clientX, clientY) => this.resolveTimeTrackerGridLanePosition(laneColumns.planned, metrics, clientX, clientY),
			applyTransferPreviewStyle: (element, dayIndex, startMinutes, endMinutes) => {
				const dayModel = dayModels[dayIndex];
				const plannedLane = dayModel?.plannedLane;
				if (!dayModel || !plannedLane) return;
				this.applyTimeTrackerGridTimedPlacementStyle(
					element,
					dayIndex,
					plannedLane.semanticIndex,
					dayModel.semanticLaneCount,
					0,
					1,
					startMinutes,
					endMinutes,
					visibleDates.length,
					metrics,
				);
			},
		};

		this.renderMobileTimeTrackerGridCalendarLaneItems(
			overlay,
			daysGrid,
			laneColumns.planned,
			'planned',
			dayModels,
			timedItems.filter(item => item.origin !== 'external'),
			visibleDates,
			preset,
			settings,
			metrics,
			section,
			gutter,
			hoverGuideOverlay,
			true,
		);
		if (dayModels.some(dayModel => dayModel.externalLane)) {
			this.renderMobileTimeTrackerGridCalendarLaneItems(
				overlay,
				daysGrid,
				laneColumns.external,
				'external',
				dayModels,
				timedItems.filter(item => item.origin === 'external'),
				visibleDates,
				preset,
				settings,
				metrics,
				section,
				gutter,
				hoverGuideOverlay,
				false,
			);
		}
		const trackedSessions = this.buildTimeTrackerGridSessionItems(visibleDates[0] ?? localToday(), visibleDates[visibleDates.length - 1] ?? localToday());
		const hasActiveTrackedSession = trackedSessions.some(session => session.isActive);
		this.renderMobileTimeTrackerGridTrackedLaneItems(
			overlay,
			laneColumns.tracked,
			dayModels,
			trackedSessions,
			visibleDates,
			preset,
			settings,
			metrics,
			section,
			gutter,
			hoverGuideOverlay,
		);
		this.updateNowIndicators();
		if (hasActiveTrackedSession) {
			this.nowIndicatorTimer = window.setInterval(() => this.refreshActiveTimeTrackerGridRender(), 30000);
		} else if (this.nowIndicatorEntries.length > 0) {
			this.nowIndicatorTimer = window.setInterval(() => this.updateNowIndicators(), 30000);
		}
	}

	private renderMobileTimeTrackerGridCalendarLaneItems(
		container: HTMLElement,
		daysGrid: HTMLElement,
		laneColumns: TimeTrackerGridLaneColumnRef[],
		laneId: TimeTrackerGridLaneId,
		dayModels: TimeTrackerGridDayLaneModel[],
		items: CalendarItem[],
		visibleDates: string[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		editable: boolean,
	): void {
		const placements = this.buildTimedGridVisualPlacements(items, visibleDates);
		for (const placement of placements) {
			const dayModel = dayModels[placement.dayIndex];
			const lane = dayModel?.semanticLanes.find(candidate => candidate.id === laneId) ?? null;
			if (!dayModel || !lane) continue;
			this.renderMobileTimeGridItem(container, daysGrid, placement, visibleDates, preset, settings, metrics, section, gutter, hoverGuideOverlay, {
				lane,
				laneColumns,
				dayModels,
				editable,
			});
		}
	}

	private renderMobileTimeTrackerGridTrackedLaneItems(
		container: HTMLElement,
		laneColumns: TimeTrackerGridLaneColumnRef[],
		dayModels: TimeTrackerGridDayLaneModel[],
		sessions: CalendarTrackedSessionGridItem[],
		visibleDates: string[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
	): void {
		const placements = this.buildTrackedSessionVisualPlacements(sessions, visibleDates);
		for (const placement of placements) {
			const dayModel = dayModels[placement.dayIndex];
			const lane = dayModel?.trackedLane ?? null;
			if (!dayModel || !lane) continue;
			const block = container.createDiv('operon-calendar-mobile-timegrid-item operon-calendar-mobile-item operon-calendar-time-tracker-grid-item operon-calendar-tracked-session-item');
			block.dataset.semanticLane = lane.id;
			if (placement.session.ref.operonId) {
				block.dataset.operonId = placement.session.ref.operonId;
			}
			block.addClass('is-tracked-lane');
			if (placement.session.task) {
				block.addClass(`is-${placement.session.task.checkbox}`);
				this.applyCalendarTaskFieldColor(block, placement.session.task.fieldValues, preset, settings);
			} else {
				block.addClass('is-open');
				block.setCssProps({ '--operon-calendar-accent': 'var(--text-muted)' });
			}
			if (placement.visualOverlapGroupSize > 1) block.addClass('has-overlap');
			if (placement.visualStackIndex > 1) block.addClass('is-overlap-layer');
			if (placement.visualInsetLevel > 0) block.addClass('is-indented-overlap');
			if (placement.visualHoverRaiseEligible) block.addClass('can-hover-raise');
			if (placement.session.isActive) {
				block.addClass('is-active-tracker', 'is-dashed', 'is-read-only');
			}
			if (placement.session.isUnassigned) {
				block.addClass('is-unassigned-tracker');
			}
			this.bindTrackedSessionReadOnlyAffordance(block, placement.session);
			this.applyTimeTrackerGridTimedPlacementStyle(
				block,
				placement.dayIndex,
				lane.semanticIndex,
				dayModel.semanticLaneCount,
				placement.visualLeftRatio,
				placement.visualWidthRatio,
				placement.startMinutes,
				placement.endMinutes,
				visibleDates.length,
				metrics,
				placement,
			);
			const content = block.createDiv('operon-calendar-mobile-timegrid-item-content');
			const title = content.createDiv('operon-calendar-mobile-timegrid-item-title');
			const fakeItem = this.buildCalendarItemForTrackedSession(placement.session);
			let hoverTrigger: HTMLElement | null = null;
			if (fakeItem) {
				hoverTrigger = this.renderCalendarItemLabel(title, fakeItem, settings, true);
			} else {
				const label = title.createDiv('operon-calendar-item-label is-compact');
				label.createSpan({
					cls: 'operon-calendar-all-day-text',
					text: t('taskEditor', 'unassignedTracker'),
				});
			}
			content.createDiv({
				text: `${formatUiTime(this.app, settings, placement.session.start)} - ${formatUiTime(this.app, settings, placement.session.end)}`,
				cls: 'operon-calendar-mobile-timegrid-item-time',
			});
			block.createDiv('operon-calendar-timed-drag-label');
			this.bindTimedHoverGuides(
				block,
				hoverGuideOverlay,
				section,
				gutter,
				visibleDates[placement.dayIndex] ?? '',
				placement.startMinutes,
				placement.endMinutes,
				metrics,
				settings,
			);
			this.bindTrackedSessionPrimaryClick(block, placement.session);
			if (hoverTrigger) {
				this.bindTrackedSessionHoverMenuTarget(hoverTrigger, placement.session);
			}
			if (!placement.session.isActive && !placement.session.isUnassigned) {
				block.addClass('is-draggable');
				this.createTimedResizeRailHandles(block, false, {
					start: this.isTrackedSessionSegmentStart(placement, visibleDates),
					end: this.isTrackedSessionSegmentEnd(placement, visibleDates),
				});
				this.bindTrackedSessionInteraction(
					block,
					placement,
					visibleDates,
					laneColumns,
					dayModels,
					metrics,
					settings,
					section,
					gutter,
					hoverGuideOverlay,
				);
			}
		}
	}

	private renderMobileTimeGridItem(
		container: HTMLElement,
		daysGrid: HTMLElement,
		placement: TimedGridVisualPlacement,
		visibleDates: string[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		options: {
			lane?: TimeTrackerGridLane;
			laneColumns?: TimeTrackerGridLaneColumnRef[];
			dayModels?: TimeTrackerGridDayLaneModel[];
			editable?: boolean;
		} = {},
	): void {
		const totalDays = visibleDates.length;
		const block = container.createDiv('operon-calendar-mobile-timegrid-item operon-calendar-mobile-item');
		block.dataset.operonId = placement.item.taskId;
		if (options.lane) {
			block.dataset.semanticLane = options.lane.id;
			block.addClass('operon-calendar-time-tracker-grid-item', `is-${options.lane.id}-lane`);
		}
		block.addClass(`is-${placement.item.renderSnapshot.checkbox}`);
		this.applyCalendarProjectionClasses(block, placement.item);
		if (placement.item.origin === 'external') block.addClass('is-external');
		if (placement.visualAvailabilityLayer) block.addClass('is-availability-layer');
		if (placement.visualOverlapGroupSize > 1) block.addClass('has-overlap');
		if (placement.visualInsetLevel > 0) block.addClass('is-indented-overlap');
		if (options.lane) {
			const dayModel = options.dayModels?.[placement.dayIndex] ?? null;
			this.applyTimeTrackerGridTimedPlacementStyle(
				block,
				placement.dayIndex,
				options.lane.semanticIndex,
				dayModel?.semanticLaneCount ?? 1,
				placement.visualLeftRatio,
				placement.visualWidthRatio,
				placement.startMinutes,
				placement.endMinutes,
				totalDays,
				metrics,
				placement,
			);
		} else {
			this.applyTimedPlacementStyle(
				block,
				placement.dayIndex,
				placement.lane,
				placement.laneCount,
				placement.startMinutes,
				placement.endMinutes,
				totalDays,
				metrics,
				placement,
			);
		}
		this.applyCalendarItemColor(block, placement.item, preset, settings);
		if (placement.visualAvailabilityLayer || placement.item.origin === 'external') {
			this.bindAvailabilityLayerExternalTooltip(block, placement.item, settings);
		}
		const content = block.createDiv('operon-calendar-mobile-timegrid-item-content');
		const title = content.createDiv('operon-calendar-mobile-timegrid-item-title');
		const hoverTrigger = this.renderCalendarItemLabel(title, placement.item, settings, true);
		content.createDiv({
			text: this.formatTimedRange(placement.item, settings),
			cls: 'operon-calendar-mobile-timegrid-item-time',
		});
		block.createDiv('operon-calendar-timed-drag-label');
		this.bindPrimaryItemClick(block, placement.item);
		if (hoverTrigger) {
			this.bindHoverMenuTarget(hoverTrigger, placement.item);
		}
		const isEditable = options.editable ?? this.canEditCalendarItemPlacement(placement.item);
		if (isEditable && this.canEditCalendarItemPlacement(placement.item)) {
			block.addClass('is-draggable');
			this.bindTimedItemInteraction(
				block,
				daysGrid,
				placement,
				visibleDates,
				metrics,
				settings,
				section,
				gutter,
				hoverGuideOverlay,
				options.lane && options.laneColumns
					? {
						resolveGridPosition: (clientX, clientY) => this.resolveTimeTrackerGridLanePosition(options.laneColumns ?? [], metrics, clientX, clientY),
						applyPlacementStyle: (element, dayIndex, startMinutes, endMinutes, visualLayout) => {
							const dayModel = options.dayModels?.[dayIndex] ?? null;
							const lane = dayModel?.semanticLanes.find(candidate => candidate.id === options.lane?.id) ?? null;
							if (!dayModel || !lane) return;
							this.applyTimeTrackerGridTimedPlacementStyle(
								element,
								dayIndex,
								lane.semanticIndex,
								dayModel.semanticLaneCount,
								visualLayout?.visualLeftRatio ?? placement.visualLeftRatio,
								visualLayout?.visualWidthRatio ?? placement.visualWidthRatio,
								startMinutes,
								endMinutes,
								totalDays,
								metrics,
								visualLayout,
							);
						},
					}
					: {},
			);
		} else {
			block.addClass('is-read-only');
		}
	}

	private scheduleMobileTimeGridInitialScroll(
		viewport: HTMLElement,
		visibleDates: string[],
		timedItems: CalendarItem[],
		metrics: CalendarTimedMetrics,
	): void {
		const generation = this.renderGeneration;
		this.requestRenderAnimationFrame(generation, () => {
			if (this.forceMobileTimeGridSmartScrollOnNextRender) {
				this.forceMobileTimeGridSmartScrollOnNextRender = false;
				this.clearMobileTimeGridScrollRestoreIntent();
			} else if (
				this.restoreMobileTimeGridScrollOnNextRender
				|| this.mobileTimeGridScrollRestoreBudget > 0
				|| Date.now() <= this.mobileTimeGridScrollRestoreUntil
			) {
				const restoreTop = this.getMobileTimeGridScrollRestoreTargetTop();
				this.applyMobileTimeGridScrollTop(viewport, restoreTop);
				this.applyMobileTimeGridOuterScrollTargets();
				this.scheduleMobileTimeGridScrollRestoreStabilization(viewport, generation, restoreTop);
				this.restoreMobileTimeGridScrollOnNextRender = false;
				if (Date.now() > this.mobileTimeGridScrollRestoreUntil) {
					this.mobileTimeGridScrollRestoreBudget = Math.max(0, this.mobileTimeGridScrollRestoreBudget - 1);
				}
				return;
			}
			const minute = this.resolveMobileTimeGridInitialScrollMinute(visibleDates, timedItems);
			viewport.scrollTop = Math.max(0, this.minuteToGridOffset(minute, metrics) - 72);
		});
	}

	private resolveMobileTimeGridInitialScrollMinute(visibleDates: string[], timedItems: CalendarItem[]): number {
		if (visibleDates.includes(localToday())) {
			const now = new Date();
			return Math.max(0, (now.getHours() * 60) + now.getMinutes() - 90);
		}
		const placements = this.buildTimedPlacements(timedItems, visibleDates);
		const firstPlacement = placements.sort((left, right) => left.startMinutes - right.startMinutes)[0];
		if (firstPlacement) {
			return Math.max(0, firstPlacement.startMinutes - 60);
		}
		return CALENDAR_MOBILE_TIME_GRID_DEFAULT_SCROLL_MINUTE;
	}

	private renderMobileCalendarItem(
		container: HTMLElement,
		item: CalendarItem,
		preset: CalendarPreset,
		settings: OperonSettings,
		kind: 'timed' | 'allDay' | 'due' | 'finished',
	): void {
		const itemEl = container.createDiv(`operon-calendar-mobile-item is-${kind}`);
		itemEl.addClass(`is-${item.renderSnapshot.checkbox}`);
		this.applyCalendarProjectionClasses(itemEl, item);
		if (item.origin === 'external') itemEl.addClass('is-external');
		this.applyCalendarItemColor(itemEl, item, preset, settings);
		const main = itemEl.createDiv('operon-calendar-mobile-item-main');
		const hoverTrigger = this.renderCalendarItemLabel(main, item, settings, true);
		const meta = itemEl.createDiv('operon-calendar-mobile-item-meta');
		const metaLabel = kind === 'timed'
			? this.formatTimedRange(item, settings)
			: this.getMobileCalendarItemKindLabel(kind);
		meta.setText(metaLabel);
		this.bindPrimaryItemClick(itemEl, item);
		if (hoverTrigger) {
			this.bindHoverMenuTarget(hoverTrigger, item);
		}
	}

	private async shiftMobileCalendarAnchorByDays(dayDelta: number): Promise<void> {
		if (!dayDelta) return;
		const state = this.ensureState();
		await this.updateLeafState({
			...state,
			mobileAnchorDate: shiftCalendarDateKey(this.resolveMobileCalendarAnchorDate(state), dayDelta),
		});
	}

	private collectMobileCalendarItemsForDate(
		dateKey: string,
		buckets: {
			scheduled: CalendarItem[];
			due: CalendarItem[];
			finished: CalendarItem[];
			timed: CalendarItem[];
		},
	): Array<{ item: CalendarItem; kind: 'timed' | 'allDay' | 'due' | 'finished' }> {
		return this.sortMobileCalendarEntries([
			...this.getItemsIntersectingDate(buckets.scheduled, dateKey).map(item => ({ item, kind: 'allDay' as const })),
			...this.getItemsIntersectingDate(buckets.due, dateKey).map(item => ({ item, kind: 'due' as const })),
			...this.getItemsIntersectingDate(buckets.finished, dateKey).map(item => ({ item, kind: 'finished' as const })),
			...this.getItemsIntersectingDate(buckets.timed, dateKey).map(item => ({ item, kind: 'timed' as const })),
		]);
	}

	private sortMobileCalendarEntries<T extends { item: CalendarItem }>(entries: T[]): T[] {
		return [...entries].sort((left, right) => this.compareMobileCalendarItems(left.item, right.item));
	}

	private compareMobileCalendarItems(left: CalendarItem, right: CalendarItem): number {
		const leftKindRank = this.getMobileCalendarKindRank(left.kind);
		const rightKindRank = this.getMobileCalendarKindRank(right.kind);
		if (leftKindRank !== rightKindRank) return leftKindRank - rightKindRank;
		const leftTime = left.startDateTime ?? '';
		const rightTime = right.startDateTime ?? '';
		if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
		return (left.renderSnapshot.description || left.taskId).localeCompare(right.renderSnapshot.description || right.taskId);
	}

	private getMobileCalendarKindRank(kind: CalendarItem['kind']): number {
		if (kind === 'allDayScheduled') return 0;
		if (kind === 'dueMarker') return 1;
		if (kind === 'timed') return 2;
		return 3;
	}

	private getItemsIntersectingDate(items: CalendarItem[], dateKey: string): CalendarItem[] {
		return items.filter(item => item.startDate <= dateKey && item.endDate >= dateKey);
	}

	private getMobileCalendarItemKindLabel(kind: 'timed' | 'allDay' | 'due' | 'finished'): string {
		if (kind === 'allDay') return t('calendar', 'allDay');
		if (kind === 'due') return t('calendar', 'due');
		if (kind === 'finished') return t('calendar', 'finished');
		return t('calendar', 'mobileTimed');
	}

	private formatMobileDateNumber(dateKey: string): string {
		const date = this.parseDateKey(dateKey);
		if (!date) return dateKey.slice(-2);
		return new Intl.DateTimeFormat(getAppLocale(this.app), { day: 'numeric' }).format(date);
	}

	private formatMobileMonthLabel(dateKey: string): string {
		const date = this.parseDateKey(dateKey);
		if (!date) return dateKey.slice(5, 7);
		const locale = getAppLocale(this.app);
		return new Intl.DateTimeFormat(locale, {
			month: 'short',
		}).format(date).replace(/\.$/, '').toLocaleUpperCase(locale);
	}

	private formatMobileAgendaWeekdayLabel(dateKey: string): string {
		const date = this.parseDateKey(dateKey);
		if (!date) return dateKey;
		return new Intl.DateTimeFormat(getAppLocale(this.app), {
			weekday: 'long',
		}).format(date);
	}

	private renderTimeGridSurface(
		container: HTMLElement,
		visibleDates: string[],
		scheduledItems: CalendarItem[],
		dueItems: CalendarItem[],
		finishedItems: CalendarItem[],
		timedItems: CalendarItem[],
		renderWindow: TimedHorizontalRenderWindow,
		preset: CalendarPreset,
		settings: OperonSettings,
		state: CalendarLeafState,
	): void {
		this.renderDayHeaders(container, visibleDates, state.showAllDayLane, state.showDueMarkers);
		if (state.showAllDayLane || state.showDueMarkers) {
			this.renderAllDaySection(
				container,
				visibleDates,
				scheduledItems,
				dueItems,
				finishedItems,
				preset,
				settings,
				state.showAllDayLane,
				state.showDueMarkers,
				false,
			);
		}
		this.renderTimeGridSemanticTimedSection(container, renderWindow, timedItems, preset, settings);
	}

	private renderTimeGridSemanticTimedSection(
		container: HTMLElement,
		renderWindow: TimedHorizontalRenderWindow,
		items: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		const visibleDates = renderWindow.bufferedDates;
		const dayModels = this.resolveTimeGridDayLaneModels(preset, visibleDates);
		const summaryByDate = this.buildTimeTrackerGridSummaryByDate(visibleDates, items, []);

		const viewport = container.createDiv('operon-calendar-timed-viewport operon-calendar-time-grid-semantic-viewport');
		this.timedScrollEl = viewport;
		const hiddenTimeKey = `${preset.id}|${this.ensureState().anchorDate}`;
		const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
		viewport.addEventListener('scroll', () => {
			this.hideCalendarHoverMenu(true);
			if (this.shouldSuppressTimedScrollPersistence()) return;
			if (!this.state) return;
			this.state = {
				...this.ensureState(),
				scrollMinutes: this.gridOffsetToMinute(Math.max(0, Math.round(viewport.scrollTop)), metrics),
			};
			this.scheduleLeafStatePersistence();
		});
		viewport.addEventListener('wheel', (event: WheelEvent) => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
			this.handleTimedHorizontalWheel(event);
		}, { passive: false });
		viewport.addEventListener('pointerdown', () => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
		});
		viewport.addEventListener('keydown', () => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
		});

		const section = viewport.createDiv('operon-calendar-timed-section operon-calendar-time-tracker-grid-section operon-calendar-time-grid-semantic-section');
		const labelGutter = section.createDiv('operon-calendar-time-tracker-grid-label-gutter operon-calendar-time-grid-semantic-label-gutter');
		labelGutter.setAttribute('aria-hidden', 'true');
		const labelClip = section.createDiv('operon-calendar-time-tracker-grid-label-clip operon-calendar-time-grid-semantic-label-clip');
		const labelStrip = labelClip.createDiv('operon-calendar-time-tracker-grid-label-strip operon-calendar-time-grid-semantic-label-strip');
		labelStrip.style.width = `${(visibleDates.length / Math.max(1, renderWindow.visibleDates.length)) * 100}%`;
		this.renderTimeTrackerGridLaneLabelStrip(
			labelStrip,
			dayModels,
			'operon-calendar-time-grid-lane-labels',
			summaryByDate,
		);
		const gutter = section.createDiv('operon-calendar-time-gutter');
		gutter.style.height = `${metrics.gridHeight}px`;
		const clip = section.createDiv('operon-calendar-timed-clip');
		const strip = clip.createDiv('operon-calendar-timed-strip');
		strip.style.width = `${(visibleDates.length / Math.max(1, renderWindow.visibleDates.length)) * 100}%`;
		const daysGrid = strip.createDiv('operon-calendar-timed-grid operon-calendar-time-tracker-grid operon-calendar-time-grid-semantic-grid');
		daysGrid.style.gridTemplateColumns = this.buildTimeTrackerGridLaneGridTemplate(dayModels);
		daysGrid.style.height = `${metrics.gridHeight}px`;
		const hoverGuideOverlay = section.createDiv('operon-calendar-hover-guide-overlay');
		const itemOverlay = daysGrid.createDiv('operon-calendar-timed-overlay operon-calendar-time-tracker-grid-overlay operon-calendar-time-grid-semantic-overlay');
		itemOverlay.style.height = `${metrics.gridHeight}px`;
		this.timedHorizontalClipEl = clip;
		this.timedHorizontalStripEl = strip;
		this.timedHorizontalLabelStripEl = labelStrip;

		for (let hour = 0; hour <= 24; hour++) {
			if (hour < 24 && this.isHiddenMinute(hour * 60, metrics.hiddenRange) && !metrics.isHiddenExpanded) {
				continue;
			}
			const label = gutter.createDiv('operon-calendar-time-label');
			if (hour === 0) label.addClass('is-first');
			if (hour === 24) label.addClass('is-last');
			const offset = this.minuteToGridOffset(hour * 60, metrics);
			label.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : offset}px`;
			label.createSpan({
				text: formatUiMinuteOfDay(this.app, settings, visibleDates[0] ?? localToday(), hour * 60),
			});
		}

		if (metrics.hiddenRange.enabled && !metrics.isHiddenExpanded) {
			const bandTop = this.minuteToGridOffset(metrics.hiddenRange.startMinutes, metrics);
			const band = strip.createDiv('operon-calendar-hidden-time-band');
			band.style.top = `${bandTop}px`;
			band.style.height = `${metrics.collapsedBandHeight}px`;
			const button = band.createEl('button', {
				text: t('calendar', 'showHiddenTime'),
				cls: 'operon-calendar-hidden-time-button',
				attr: { type: 'button' },
			});
			button.addEventListener('click', () => {
				this.expandedHiddenTimeKey = hiddenTimeKey;
				this.render();
			});
		}

		const laneColumns: TimeTrackerGridLaneColumns = {
			planned: [],
			external: [],
			tracked: [],
		};
		for (const dayModel of dayModels) {
			for (const lane of dayModel.semanticLanes) {
				const column = daysGrid.createDiv(`operon-calendar-timed-day operon-calendar-time-tracker-grid-column operon-calendar-time-grid-semantic-column is-${lane.id}-lane`);
				column.dataset.dateKey = dayModel.dateKey;
				column.dataset.dayIndex = String(dayModel.dayIndex);
				column.dataset.semanticLane = lane.id;
				const dayDate = this.parseDateKey(dayModel.dateKey);
				column.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
				column.classList.toggle('is-semantic-lane-end', lane.semanticIndex === dayModel.semanticLaneCount - 1);
				if (dayModel.dateKey === localToday()) {
					column.addClass('is-today');
					this.attachNowIndicator(column, metrics, {
						showLabel: lane.semanticIndex === 0,
						labelSpan: dayModel.semanticLaneCount,
					});
				}
				for (let hour = 0; hour <= 24; hour++) {
					if (hour < 24 && this.isHiddenMinute(hour * 60, metrics.hiddenRange) && !metrics.isHiddenExpanded) {
						continue;
					}
					const line = column.createDiv('operon-calendar-hour-line');
					const offset = this.minuteToGridOffset(hour * 60, metrics);
					line.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : offset}px`;
				}
				laneColumns[lane.id].push({
					element: column,
					dateKey: dayModel.dateKey,
					dayIndex: dayModel.dayIndex,
				});
				if (lane.id === 'planned') {
					this.bindTimedSelection(column, dayModel.dateKey, preset, metrics, section, gutter, hoverGuideOverlay, settings);
				}
			}
		}

		this.timedDropContext = {
			section,
			gutter,
			daysGrid,
			previewOverlay: itemOverlay,
			hoverGuideOverlay,
			visibleDates: [...visibleDates],
			metrics,
			preset,
			settings,
			resolvePosition: (clientX, clientY) => this.resolveTimeTrackerGridLanePosition(laneColumns.planned, metrics, clientX, clientY),
			applyTransferPreviewStyle: (element, dayIndex, startMinutes, endMinutes) => {
				const dayModel = dayModels[dayIndex];
				const plannedLane = dayModel?.plannedLane;
				if (!dayModel || !plannedLane) return;
				this.applyTimeTrackerGridTimedPlacementStyle(
					element,
					dayIndex,
					plannedLane.semanticIndex,
					dayModel.semanticLaneCount,
					0,
					1,
					startMinutes,
					endMinutes,
					visibleDates.length,
					metrics,
				);
			},
		};

		this.syncTimedHorizontalPanMetrics();
		this.applyTimedHorizontalPanTransform(false);

		this.renderTimeTrackerGridCalendarLaneItems(
			itemOverlay,
			daysGrid,
			laneColumns.planned,
			'planned',
			dayModels,
			items.filter(item => item.origin !== 'external'),
			visibleDates,
			preset,
			settings,
			metrics,
			section,
			gutter,
			hoverGuideOverlay,
			true,
		);
		if (dayModels.some(dayModel => dayModel.externalLane)) {
			this.renderTimeTrackerGridCalendarLaneItems(
				itemOverlay,
				daysGrid,
				laneColumns.external,
				'external',
				dayModels,
				items.filter(item => item.origin === 'external'),
				visibleDates,
				preset,
				settings,
				metrics,
				section,
				gutter,
				hoverGuideOverlay,
				false,
			);
		}

		this.updateNowIndicators();
		if (this.nowIndicatorEntries.length > 0) {
			this.nowIndicatorTimer = window.setInterval(() => this.updateNowIndicators(), 30000);
		}
	}

	private renderTimeTrackerGridSurface(
		container: HTMLElement,
		visibleDates: string[],
		scheduledItems: CalendarItem[],
		dueItems: CalendarItem[],
		finishedItems: CalendarItem[],
		timedItems: CalendarItem[],
		renderWindow: TimedHorizontalRenderWindow,
		preset: CalendarPreset,
		settings: OperonSettings,
		state: CalendarLeafState,
	): void {
		this.renderDayHeaders(container, visibleDates, state.showAllDayLane, state.showDueMarkers);
		if (state.showAllDayLane || state.showDueMarkers) {
			this.renderAllDaySection(
				container,
				visibleDates,
				scheduledItems,
				dueItems,
				finishedItems,
				preset,
				settings,
				state.showAllDayLane,
				state.showDueMarkers,
				false,
			);
		}
		this.renderTimeTrackerGridTimedSection(container, renderWindow, timedItems, preset, settings);
	}

	private renderTimeTrackerGridTimedSection(
		container: HTMLElement,
		renderWindow: TimedHorizontalRenderWindow,
		items: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		const visibleDates = renderWindow.bufferedDates;
		const dayModels = this.resolveTimeTrackerGridDayLaneModels(preset, visibleDates);
		const trackedSessions = this.buildTimeTrackerGridSessionItems(visibleDates[0] ?? localToday(), visibleDates[visibleDates.length - 1] ?? localToday());
		const hasActiveTrackedSession = trackedSessions.some(session => session.isActive);
		const summaryByDate = this.buildTimeTrackerGridSummaryByDate(visibleDates, items, trackedSessions);

		const viewport = container.createDiv('operon-calendar-timed-viewport operon-calendar-time-tracker-grid-viewport');
		this.timedScrollEl = viewport;
		const hiddenTimeKey = `${preset.id}|${this.ensureState().anchorDate}`;
		const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
		viewport.addEventListener('scroll', () => {
			this.hideCalendarHoverMenu(true);
			if (this.shouldSuppressTimedScrollPersistence()) return;
			if (!this.state) return;
			this.state = {
				...this.ensureState(),
				scrollMinutes: this.gridOffsetToMinute(Math.max(0, Math.round(viewport.scrollTop)), metrics),
			};
			this.scheduleLeafStatePersistence();
		});
		viewport.addEventListener('wheel', (event: WheelEvent) => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
			this.handleTimedHorizontalWheel(event);
		}, { passive: false });
		viewport.addEventListener('pointerdown', () => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
		});
		viewport.addEventListener('keydown', () => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
		});

		const section = viewport.createDiv('operon-calendar-timed-section operon-calendar-time-tracker-grid-section');
		const labelGutter = section.createDiv('operon-calendar-time-tracker-grid-label-gutter');
		labelGutter.setAttribute('aria-hidden', 'true');
		const labelClip = section.createDiv('operon-calendar-time-tracker-grid-label-clip');
		const labelStrip = labelClip.createDiv('operon-calendar-time-tracker-grid-label-strip');
		labelStrip.style.width = `${(visibleDates.length / Math.max(1, renderWindow.visibleDates.length)) * 100}%`;
		this.renderTimeTrackerGridLaneLabelStrip(
			labelStrip,
			dayModels,
			'operon-calendar-time-tracker-grid-lane-labels',
			summaryByDate,
		);
		const gutter = section.createDiv('operon-calendar-time-gutter');
		gutter.style.height = `${metrics.gridHeight}px`;
		const clip = section.createDiv('operon-calendar-timed-clip');
		const strip = clip.createDiv('operon-calendar-timed-strip');
		strip.style.width = `${(visibleDates.length / Math.max(1, renderWindow.visibleDates.length)) * 100}%`;
		const daysGrid = strip.createDiv('operon-calendar-timed-grid operon-calendar-time-tracker-grid');
		daysGrid.style.gridTemplateColumns = this.buildTimeTrackerGridLaneGridTemplate(dayModels);
		daysGrid.style.height = `${metrics.gridHeight}px`;
		daysGrid.style.removeProperty('--operon-calendar-tracker-lane-count');
		const hoverGuideOverlay = section.createDiv('operon-calendar-hover-guide-overlay');
		const itemOverlay = daysGrid.createDiv('operon-calendar-timed-overlay operon-calendar-time-tracker-grid-overlay');
		itemOverlay.style.height = `${metrics.gridHeight}px`;
		this.timedHorizontalClipEl = clip;
		this.timedHorizontalStripEl = strip;
		this.timedHorizontalLabelStripEl = labelStrip;

		for (let hour = 0; hour <= 24; hour++) {
			if (hour < 24 && this.isHiddenMinute(hour * 60, metrics.hiddenRange) && !metrics.isHiddenExpanded) {
				continue;
			}
			const label = gutter.createDiv('operon-calendar-time-label');
			if (hour === 0) label.addClass('is-first');
			if (hour === 24) label.addClass('is-last');
			const offset = this.minuteToGridOffset(hour * 60, metrics);
			label.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : offset}px`;
			label.createSpan({
				text: formatUiMinuteOfDay(this.app, settings, visibleDates[0] ?? localToday(), hour * 60),
			});
		}

		if (metrics.hiddenRange.enabled && !metrics.isHiddenExpanded) {
			const bandTop = this.minuteToGridOffset(metrics.hiddenRange.startMinutes, metrics);
			const band = strip.createDiv('operon-calendar-hidden-time-band');
			band.style.top = `${bandTop}px`;
			band.style.height = `${metrics.collapsedBandHeight}px`;
			const button = band.createEl('button', {
				text: t('calendar', 'showHiddenTime'),
				cls: 'operon-calendar-hidden-time-button',
				attr: { type: 'button' },
			});
			button.addEventListener('click', () => {
				this.expandedHiddenTimeKey = hiddenTimeKey;
				this.render();
			});
		}

		const laneColumns: TimeTrackerGridLaneColumns = {
			planned: [],
			external: [],
			tracked: [],
		};
		for (const dayModel of dayModels) {
			for (const lane of dayModel.semanticLanes) {
				const column = daysGrid.createDiv(`operon-calendar-timed-day operon-calendar-time-tracker-grid-column is-${lane.id}-lane`);
				column.dataset.dateKey = dayModel.dateKey;
				column.dataset.dayIndex = String(dayModel.dayIndex);
				column.dataset.semanticLane = lane.id;
				const dayDate = this.parseDateKey(dayModel.dateKey);
				column.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
				column.classList.toggle('is-semantic-lane-end', lane.semanticIndex === dayModel.semanticLaneCount - 1);
				if (dayModel.dateKey === localToday()) {
					column.addClass('is-today');
					this.attachNowIndicator(column, metrics, {
						showLabel: lane.semanticIndex === 0,
						labelSpan: dayModel.semanticLaneCount,
					});
				}
				for (let hour = 0; hour <= 24; hour++) {
					if (hour < 24 && this.isHiddenMinute(hour * 60, metrics.hiddenRange) && !metrics.isHiddenExpanded) {
						continue;
					}
					const line = column.createDiv('operon-calendar-hour-line');
					const offset = this.minuteToGridOffset(hour * 60, metrics);
					line.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : offset}px`;
				}
				laneColumns[lane.id].push({
					element: column,
					dateKey: dayModel.dateKey,
					dayIndex: dayModel.dayIndex,
				});
				if (lane.id === 'planned') {
					this.bindTimedSelection(column, dayModel.dateKey, preset, metrics, section, gutter, hoverGuideOverlay, settings);
				} else if (lane.id === 'tracked') {
					this.bindTimedSelection(
						column,
						dayModel.dateKey,
						preset,
						metrics,
						section,
						gutter,
						hoverGuideOverlay,
						settings,
						this.callbacks.onTrackedSlotSelection,
					);
				}
			}
		}

		this.timedDropContext = {
			section,
			gutter,
			daysGrid,
			previewOverlay: itemOverlay,
			hoverGuideOverlay,
			visibleDates: [...visibleDates],
			metrics,
			preset,
			settings,
			resolvePosition: (clientX, clientY) => this.resolveTimeTrackerGridLanePosition(laneColumns.planned, metrics, clientX, clientY),
			applyTransferPreviewStyle: (element, dayIndex, startMinutes, endMinutes) => {
				const dayModel = dayModels[dayIndex];
				const plannedLane = dayModel?.plannedLane;
				if (!dayModel || !plannedLane) return;
				this.applyTimeTrackerGridTimedPlacementStyle(
					element,
					dayIndex,
					plannedLane.semanticIndex,
					dayModel.semanticLaneCount,
					0,
					1,
					startMinutes,
					endMinutes,
					visibleDates.length,
					metrics,
				);
			},
		};

		this.syncTimedHorizontalPanMetrics();
		this.applyTimedHorizontalPanTransform(false);

		this.renderTimeTrackerGridCalendarLaneItems(
			itemOverlay,
			daysGrid,
			laneColumns.planned,
			'planned',
			dayModels,
			items.filter(item => item.origin !== 'external'),
			visibleDates,
			preset,
			settings,
			metrics,
			section,
			gutter,
			hoverGuideOverlay,
			true,
		);
		if (dayModels.some(dayModel => dayModel.externalLane)) {
			this.renderTimeTrackerGridCalendarLaneItems(
				itemOverlay,
				daysGrid,
				laneColumns.external,
				'external',
				dayModels,
				items.filter(item => item.origin === 'external'),
				visibleDates,
				preset,
				settings,
				metrics,
				section,
				gutter,
				hoverGuideOverlay,
				false,
			);
		}

		this.renderTimeTrackerGridTrackedLaneItems(
			itemOverlay,
			laneColumns.tracked,
			dayModels,
			trackedSessions,
			visibleDates,
			preset,
			settings,
			metrics,
			section,
			gutter,
			hoverGuideOverlay,
		);

		this.updateNowIndicators();
		if (hasActiveTrackedSession) {
			this.nowIndicatorTimer = window.setInterval(() => this.refreshActiveTimeTrackerGridRender(), 30000);
		} else if (this.nowIndicatorEntries.length > 0) {
			this.nowIndicatorTimer = window.setInterval(() => this.updateNowIndicators(), 30000);
		}
	}

	private refreshActiveTimeTrackerGridRender(): void {
		if (this.hasActiveCalendarDragInteraction()) {
			this.pendingRenderAfterCalendarDrag = true;
			return;
		}
		if (this.hasActiveEditableFocus()) {
			this.deferPassiveRenderUntilEditableFocusClears();
			return;
		}
		this.captureActiveCalendarScrollForRender();
		this.preserveScrollOnNextRender = true;
		this.render();
	}

	private resolveTimeGridLanes(preset: CalendarPreset): TimeTrackerGridLane[] {
		const ids = resolveTimeGridLaneIds({
			showExternal: this.shouldRenderTimeGridExternalLane(preset),
		});
		return ids.map((id, semanticIndex) => ({
			id,
			semanticIndex,
			...this.resolveTimeTrackerGridLaneCopy(id),
		}));
	}

	private resolveTimeGridDayLaneModels(
		preset: CalendarPreset,
		visibleDates: string[],
	): TimeTrackerGridDayLaneModel[] {
		return visibleDates.map((dateKey, dayIndex) => ({
			...this.buildTimeTrackerGridLaneModel(this.resolveTimeGridLanes(preset)),
			dateKey,
			dayIndex,
			isFuture: false,
		}));
	}

	private shouldRenderTimeGridExternalLane(preset: CalendarPreset): boolean {
		return preset.showExternalCalendars !== false && this.hasSelectedExternalCalendars(preset);
	}

	private resolveTimeTrackerGridLanes(preset: CalendarPreset, dateKey?: string): TimeTrackerGridLane[] {
		const showExternal = this.shouldRenderTimeTrackerGridExternalLane(preset);
		const ids = resolveTimeTrackerGridLaneIdsForDate({
			dateKey,
			today: localToday(),
			showExternal,
		});
		return ids.map((id, semanticIndex) => ({
			id,
			semanticIndex,
			...this.resolveTimeTrackerGridLaneCopy(id),
		}));
	}

	private isTimeTrackerGridFutureDate(dateKey: string): boolean {
		return dateKey > localToday();
	}

	private hasSelectedExternalCalendars(
		preset: Pick<CalendarPreset, 'externalCalendarVisibility'>,
		settings: Pick<OperonSettings, 'externalCalendars'> = this.getSettings(),
	): boolean {
		return settings.externalCalendars.some(source =>
			source.enabled && preset.externalCalendarVisibility[source.id] === true,
		);
	}

	private shouldRenderTimeTrackerGridExternalLane(preset: CalendarPreset): boolean {
		return preset.showExternalCalendars !== false && this.hasSelectedExternalCalendars(preset);
	}

	private resolveTimeTrackerGridLaneCopy(id: TimeTrackerGridLaneId): Pick<TimeTrackerGridLane, 'label'> {
		return {
			label: t('calendar', `timeTrackerGridLane_${id}`),
		};
	}

	private buildTimeTrackerGridLaneModel(semanticLanes: TimeTrackerGridLane[]): TimeTrackerGridLaneModel {
		const plannedLane = semanticLanes.find(lane => lane.id === 'planned') ?? semanticLanes[0];
		const trackedLane = semanticLanes.find(lane => lane.id === 'tracked') ?? null;
		const externalLane = semanticLanes.find(lane => lane.id === 'external') ?? null;
		return {
			semanticLanes,
			plannedLane,
			trackedLane,
			externalLane,
			semanticLaneCount: Math.max(1, semanticLanes.length),
		};
	}

	private resolveTimeTrackerGridDayLaneModel(
		preset: CalendarPreset,
		dateKey: string,
		dayIndex: number,
	): TimeTrackerGridDayLaneModel {
		const isFuture = this.isTimeTrackerGridFutureDate(dateKey);
		return {
			...this.buildTimeTrackerGridLaneModel(this.resolveTimeTrackerGridLanes(preset, dateKey)),
			dateKey,
			dayIndex,
			isFuture,
		};
	}

	private resolveTimeTrackerGridDayLaneModels(
		preset: CalendarPreset,
		visibleDates: string[],
	): TimeTrackerGridDayLaneModel[] {
		return visibleDates.map((dateKey, dayIndex) =>
			this.resolveTimeTrackerGridDayLaneModel(preset, dateKey, dayIndex),
		);
	}

	private buildTimeTrackerGridLaneGridTemplate(dayModels: TimeTrackerGridDayLaneModel[]): string {
		const columns = buildTimeTrackerGridLaneFractions(dayModels.map(dayModel => dayModel.semanticLaneCount))
			.flatMap(dayFractions =>
				dayFractions.map(fraction => `minmax(0, ${Number(fraction.toFixed(6))}fr)`),
			);
		return columns.length > 0 ? columns.join(' ') : 'minmax(0, 1fr)';
	}

	private renderTimeTrackerGridLaneLabelStrip(
		container: HTMLElement,
		dayModels: TimeTrackerGridDayLaneModel[],
		className: string,
		summaryByDate?: Map<string, TimeTrackerGridDailySummary> | null,
	): void {
		container.addClass(className);
		container.style.gridTemplateColumns = this.buildTimeTrackerGridLaneGridTemplate(dayModels);
		const todayKey = localToday();
		for (const dayModel of dayModels) {
			for (const lane of dayModel.semanticLanes) {
				const summary = summaryByDate?.get(dayModel.dateKey) ?? null;
				const label = container.createDiv(`operon-calendar-time-tracker-grid-lane-label is-${lane.id}-lane`);
				label.dataset.dateKey = dayModel.dateKey;
				label.dataset.semanticLane = lane.id;
				label.classList.toggle('is-semantic-lane-end', lane.semanticIndex === dayModel.semanticLaneCount - 1);
				label.classList.toggle('is-today', dayModel.dateKey === todayKey);
				label.createSpan({
					text: lane.label,
					cls: 'operon-calendar-time-tracker-grid-lane-title',
				});
				const summaryText = summary ? this.formatTimeTrackerGridLaneSummaryText(lane.id, summary) : '';
				if (summaryText) {
					const summaryEl = label.createSpan({
						text: summaryText,
						cls: 'operon-calendar-time-tracker-grid-lane-summary',
					});
					if (lane.id === 'tracked' && summary) {
						summaryEl.classList.toggle('is-over-planned', summary.trackedCompletedSeconds > summary.plannedSeconds);
						summaryEl.classList.toggle('is-within-planned', summary.trackedCompletedSeconds <= summary.plannedSeconds);
					}
				}
				setAccessibleLabelWithoutTooltip(label, summaryText ? `${lane.label}: ${summaryText}` : lane.label);
			}
		}
	}

	private buildTimeTrackerGridSummaryByDate(
		visibleDates: string[],
		items: CalendarItem[],
		trackedSessions: CalendarTrackedSessionGridItem[],
	): Map<string, TimeTrackerGridDailySummary> {
		const summaries = buildTimeTrackerGridDailySummaries({
			visibleDates,
			plannedRanges: items
				.filter(item => item.origin !== 'external')
				.map(item => ({ start: item.startDateTime, end: item.endDateTime })),
			externalRanges: items
				.filter(item => item.origin === 'external')
				.map(item => ({ start: item.startDateTime, end: item.endDateTime })),
			trackedRanges: trackedSessions.map(session => ({
				start: session.start,
				end: session.end,
				isActive: session.isActive,
			})),
		});
		return new Map(summaries.map(summary => [summary.dateKey, summary]));
	}

	private formatTimeTrackerGridLaneSummaryText(
		laneId: TimeTrackerGridLaneId,
		summary: TimeTrackerGridDailySummary,
	): string {
		if (laneId === 'planned') {
			return formatTimeTrackerGridCompactDurationSeconds(summary.plannedSeconds);
		}
		if (laneId === 'external') {
			return formatTimeTrackerGridCompactDurationSeconds(summary.externalSeconds);
		}
		return formatTimeTrackerGridCompactDurationSeconds(summary.trackedCompletedSeconds);
	}

	private resolveTimeTrackerGridLaneModel(preset: CalendarPreset): TimeTrackerGridLaneModel {
		return this.buildTimeTrackerGridLaneModel(this.resolveTimeTrackerGridLanes(preset));
	}

	private renderTimeTrackerGridCalendarLaneItems(
		itemOverlay: HTMLElement,
		daysGrid: HTMLElement,
		laneColumns: TimeTrackerGridLaneColumnRef[],
		laneId: TimeTrackerGridLaneId,
		dayModels: TimeTrackerGridDayLaneModel[],
		items: CalendarItem[],
		visibleDates: string[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		editable: boolean,
	): void {
		const placements = this.buildTimedGridVisualPlacements(items, visibleDates);
		for (const segment of placements) {
			const dayModel = dayModels[segment.dayIndex];
			const lane = dayModel?.semanticLanes.find(candidate => candidate.id === laneId) ?? null;
			if (!dayModel || !lane) continue;
			const block = itemOverlay.createDiv('operon-calendar-timed-item operon-calendar-time-tracker-grid-item');
			block.dataset.operonId = segment.item.taskId;
			block.dataset.semanticLane = lane.id;
			block.addClass(`is-${segment.item.renderSnapshot.checkbox}`);
			block.addClass(`is-${lane.id}-lane`);
			this.applyCalendarProjectionClasses(block, segment.item);
			if (segment.item.origin === 'external') block.addClass('is-external');
			if (segment.visualAvailabilityLayer) block.addClass('is-availability-layer');
			if (segment.visualOverlapGroupSize > 1) block.addClass('has-overlap');
			if (segment.visualStackIndex > 1) block.addClass('is-overlap-layer');
			if (segment.visualInsetLevel > 0) block.addClass('is-indented-overlap');
			if (segment.visualHoverRaiseEligible) block.addClass('can-hover-raise');
			this.applyTimeTrackerGridTimedPlacementStyle(
				block,
				segment.dayIndex,
				lane.semanticIndex,
				dayModel.semanticLaneCount,
				segment.visualLeftRatio,
				segment.visualWidthRatio,
				segment.startMinutes,
				segment.endMinutes,
				visibleDates.length,
				metrics,
				segment,
			);
			this.applyCalendarItemColor(block, segment.item, preset, settings);
			if (segment.visualAvailabilityLayer || segment.item.origin === 'external') {
				this.bindAvailabilityLayerExternalTooltip(block, segment.item, settings);
			}

			const content = block.createDiv('operon-calendar-timed-content');
			const hoverTrigger = this.renderCalendarItemLabel(content, segment.item, settings, true);
			block.createDiv('operon-calendar-timed-drag-label');
			this.bindTimedHoverGuides(
				block,
				hoverGuideOverlay,
				section,
				gutter,
				visibleDates[segment.dayIndex] ?? '',
				segment.startMinutes,
				segment.endMinutes,
				metrics,
				settings,
			);
			this.bindPrimaryItemClick(block, segment.item);
			if (hoverTrigger) {
				this.bindHoverMenuTarget(hoverTrigger, segment.item);
			}
			if (editable && this.canEditCalendarItemPlacement(segment.item)) {
				block.addClass('is-draggable');
				this.createTimedResizeRailHandles(block);
				this.bindTimedItemInteraction(
					block,
					daysGrid,
					segment,
					visibleDates,
					metrics,
					settings,
					section,
					gutter,
					hoverGuideOverlay,
					{
						resolveGridPosition: (clientX, clientY) => this.resolveTimeTrackerGridLanePosition(laneColumns, metrics, clientX, clientY),
						applyPlacementStyle: (element, dayIndex, startMinutes, endMinutes, visualLayout) => {
							const targetDayModel = dayModels[dayIndex];
							const targetLane = targetDayModel?.semanticLanes.find(candidate => candidate.id === lane.id) ?? null;
							if (!targetDayModel || !targetLane) return;
							this.applyTimeTrackerGridTimedPlacementStyle(
								element,
								dayIndex,
								targetLane.semanticIndex,
								targetDayModel.semanticLaneCount,
								visualLayout?.visualLeftRatio ?? segment.visualLeftRatio,
								visualLayout?.visualWidthRatio ?? segment.visualWidthRatio,
								startMinutes,
								endMinutes,
								visibleDates.length,
								metrics,
								visualLayout,
							);
						},
					},
				);
			} else {
				block.addClass('is-read-only');
				if (this.isDoneRollingProjection(segment.item)) {
					this.createTimedResizeRailHandles(block, true);
				}
			}
		}
	}

	private renderTimeTrackerGridTrackedLaneItems(
		itemOverlay: HTMLElement,
		laneColumns: TimeTrackerGridLaneColumnRef[],
		dayModels: TimeTrackerGridDayLaneModel[],
		sessions: CalendarTrackedSessionGridItem[],
		visibleDates: string[],
		preset: CalendarPreset,
		settings: OperonSettings,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
	): void {
		const placements = this.buildTrackedSessionVisualPlacements(sessions, visibleDates);
		for (const placement of placements) {
			const dayModel = dayModels[placement.dayIndex];
			const lane = dayModel?.trackedLane ?? null;
			if (!dayModel || !lane) continue;
			const block = itemOverlay.createDiv('operon-calendar-timed-item operon-calendar-time-tracker-grid-item operon-calendar-tracked-session-item');
			block.dataset.semanticLane = lane.id;
			if (placement.session.ref.operonId) {
				block.dataset.operonId = placement.session.ref.operonId;
			}
			block.addClass('is-tracked-lane');
				if (placement.session.task) {
					block.addClass(`is-${placement.session.task.checkbox}`);
					this.applyCalendarTaskFieldColor(block, placement.session.task.fieldValues, preset, settings);
				} else {
					block.addClass('is-open');
					block.setCssProps({ '--operon-calendar-accent': 'var(--text-muted)' });
				}
			if (placement.visualOverlapGroupSize > 1) block.addClass('has-overlap');
			if (placement.visualStackIndex > 1) block.addClass('is-overlap-layer');
			if (placement.visualInsetLevel > 0) block.addClass('is-indented-overlap');
			if (placement.visualHoverRaiseEligible) block.addClass('can-hover-raise');
			if (placement.session.isActive) {
				block.addClass('is-active-tracker', 'is-dashed', 'is-read-only');
			}
			if (placement.session.isUnassigned) {
				block.addClass('is-unassigned-tracker');
			}
			this.bindTrackedSessionReadOnlyAffordance(block, placement.session);
			this.applyTimeTrackerGridTimedPlacementStyle(
				block,
				placement.dayIndex,
				lane.semanticIndex,
				dayModel.semanticLaneCount,
				placement.visualLeftRatio,
				placement.visualWidthRatio,
				placement.startMinutes,
				placement.endMinutes,
				visibleDates.length,
				metrics,
				placement,
			);
			const content = block.createDiv('operon-calendar-timed-content');
			const fakeItem = this.buildCalendarItemForTrackedSession(placement.session);
			let hoverTrigger: HTMLElement | null = null;
			if (fakeItem) {
				hoverTrigger = this.renderCalendarItemLabel(content, fakeItem, settings, true);
			} else {
				const label = content.createDiv('operon-calendar-item-label is-compact');
				const title = label.createSpan({
					cls: 'operon-calendar-all-day-text',
					text: t('taskEditor', 'unassignedTracker'),
				});
				setAccessibleLabelWithoutTooltip(title, t('taskEditor', 'unassignedTracker'));
			}
			block.createDiv('operon-calendar-timed-drag-label');
			this.bindTimedHoverGuides(
				block,
				hoverGuideOverlay,
				section,
				gutter,
				visibleDates[placement.dayIndex] ?? '',
				placement.startMinutes,
				placement.endMinutes,
				metrics,
				settings,
			);
			this.bindTrackedSessionPrimaryClick(block, placement.session);
			if (hoverTrigger) {
				this.bindTrackedSessionHoverMenuTarget(hoverTrigger, placement.session);
			}
			if (!placement.session.isActive && !placement.session.isUnassigned) {
				block.addClass('is-draggable');
				this.createTimedResizeRailHandles(block, false, {
					start: this.isTrackedSessionSegmentStart(placement, visibleDates),
					end: this.isTrackedSessionSegmentEnd(placement, visibleDates),
				});
				this.bindTrackedSessionInteraction(
					block,
					placement,
					visibleDates,
					laneColumns,
					dayModels,
					metrics,
					settings,
					section,
					gutter,
					hoverGuideOverlay,
				);
			}
		}
	}

	private buildTimeTrackerGridSessionItems(rangeStartDate: string, rangeEndDate: string): CalendarTrackedSessionGridItem[] {
		const sessions = this.callbacks.getTrackedSessions?.(rangeStartDate, rangeEndDate) ?? [];
		const items: CalendarTrackedSessionGridItem[] = sessions.map(session => ({
			ref: {
				operonId: session.operonId,
				sessionIndex: session.sessionIndex,
				start: session.start,
				end: session.end,
			},
			start: session.start,
			end: session.end,
			task: session.task,
			durationSeconds: session.durationSeconds,
			isActive: false,
			isUnassigned: false,
		}));
		const active = this.callbacks.getActiveTrackerState?.() ?? null;
		if (active) {
			const activeStart = active.start;
			const activeEnd = localNow();
			if (this.doesDateTimeRangeIntersectDateRange(activeStart, activeEnd, rangeStartDate, rangeEndDate)) {
				items.push({
					ref: {
						operonId: active.operonId ?? '',
						start: activeStart,
						end: activeEnd,
					},
					start: activeStart,
					end: activeEnd,
					task: active.task,
					durationSeconds: active.elapsedSeconds,
					isActive: true,
					isUnassigned: active.isUnassigned,
				});
			}
		}
		return items;
	}

	private buildTrackedSessionVisualPlacements(
		sessions: CalendarTrackedSessionGridItem[],
		visibleDates: string[],
	): TrackedSessionVisualPlacement[] {
		const segments: TrackedSessionSegmentPlacement[] = [];
		for (const session of sessions) {
			const start = parseLocalDatetime(session.start);
			const end = parseLocalDatetime(session.end);
			if (!start || !end || end.getTime() <= start.getTime()) continue;
			const startDate = session.start.substring(0, 10);
			const endDate = session.end.substring(0, 10);
			for (let dayIndex = 0; dayIndex < visibleDates.length; dayIndex++) {
				const dayKey = visibleDates[dayIndex];
				if (dayKey < startDate || dayKey > endDate) continue;
				const startMinutes = dayKey === startDate
					? this.extractMinuteOfDay(session.start)
					: 0;
				const endMinutes = dayKey === endDate
					? this.extractMinuteOfDay(session.end)
					: 24 * 60;
				if (endMinutes <= startMinutes) continue;
				segments.push({
					session,
					dayIndex,
					startMinutes,
					endMinutes,
					visualLayer: 'primary',
				});
			}
		}
		return buildTimedGridVisualLayout(segments);
	}

	private buildCalendarItemForTrackedSession(session: CalendarTrackedSessionGridItem): CalendarItem | null {
		if (!session.task) return null;
		const startDate = session.start.substring(0, 10);
		const endDate = session.end.substring(0, 10);
		return {
			taskId: session.task.operonId,
			kind: 'timed',
			startDate,
			endDate,
			startDateTime: session.start,
			endDateTime: session.end,
			isDashed: session.isActive,
			isReadOnly: session.isActive,
			isStatusReadOnly: session.isActive,
			origin: 'materialized',
			repeatRef: null,
			externalRef: null,
			sourceTask: session.task,
			renderSnapshot: buildCalendarRenderSnapshot(session.task),
		};
	}

	private bindTrackedSessionReadOnlyAffordance(block: HTMLElement, session: CalendarTrackedSessionGridItem): void {
		if (!session.isActive && !session.isUnassigned) return;
		const taskLabel = session.task?.description || session.task?.operonId || session.ref.operonId;
		const label = session.isUnassigned
			? t('taskEditor', 'unassignedTrackerReadOnly')
			: t('taskEditor', 'activeTrackerReadOnly', { task: taskLabel });
		setAccessibleLabelWithoutTooltip(block, label);
		bindOperonHoverTooltip(block, {
			title: label,
			taskColor: null,
			preferredVertical: 'above',
		});
	}

	private bindTrackedSessionPrimaryClick(block: HTMLElement, session: CalendarTrackedSessionGridItem): void {
		if (!session.isActive && !session.isUnassigned && this.callbacks.onTrackedSessionOpen) {
			block.tabIndex = 0;
			block.addClass('is-clickable');
		}
		block.addEventListener('click', (event) => {
			if (block.dataset.suppressCalendarClick === 'true') {
				delete block.dataset.suppressCalendarClick;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			const target = asHTMLElement(event.target, block);
			if (target?.closest('.operon-calendar-status-button, a.internal-link')) return;
			event.preventDefault();
			event.stopPropagation();
			if (session.isActive || session.isUnassigned) return;
			void this.callbacks.onTrackedSessionOpen?.(session.ref);
		});
		block.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			if (session.isActive || session.isUnassigned || !this.callbacks.onTrackedSessionOpen) return;
			event.preventDefault();
			void this.callbacks.onTrackedSessionOpen(session.ref);
		});
	}

	private bindTrackedSessionHoverMenuTarget(triggerEl: HTMLElement, session: CalendarTrackedSessionGridItem): void {
		if (!this.callbacks.onItemAction || session.isActive || session.isUnassigned || !session.task) return;
		const item = this.buildCalendarItemForTrackedSession(session);
		if (!item) return;
		const menuKey = `tracked:${session.ref.operonId || session.task.operonId}:${session.start}:${session.end}`;
		bindContextualHoverMenuTrigger({
			controller: this.hoverMenu,
			triggerEl,
			menuKey,
			getSettings: () => this.getSettings(),
			openMenu: ({ mobile }) => this.showTrackedSessionHoverMenu(triggerEl, item, menuKey, mobile),
		});
	}

	private showTrackedSessionHoverMenu(
		anchorEl: HTMLElement,
		item: CalendarItem,
		menuKey: string,
		mobileInteraction = false,
	): boolean {
		if (this.timedHorizontalGesture.axisLock === 'horizontal' || Math.abs(this.timedHorizontalGesture.offsetPx) > 0.5) {
			return false;
		}
		const context: ContextualMenuContext = {
			surface: 'calendarTimedItem',
			taskId: item.taskId,
			task: item.sourceTask ?? item.renderSnapshot,
			now: localNow(),
			isPinned: this.getPinnedCache()?.isPinned(item.taskId) ?? false,
			hasSubtasks: item.sourceTask
				? this.indexer.secondary.getChildIds(item.sourceTask.operonId).size > 0
				: false,
			calendarItem: item,
			projectedRef: null,
		};
		const settings = this.getSettings();
		const actionAllowlist = filterTimeTrackerGridTrackedContextMenuActionIds(settings.contextualMenuActionAllowlist);
		const actions = resolveContextualMenu(
			context,
			actionAllowlist,
			settings.contextualMenuSurfaceActionMatrix,
		);
		if (actions.length === 0 || !this.callbacks.onItemAction) {
			if (this.hoverMenu.isActive(menuKey)) {
				this.hideCalendarHoverMenu(true);
			}
			return false;
		}
		return this.showHoverMenuForActions(
			anchorEl,
			item.taskId,
			actions,
			this.resolveCalendarHoverMenuAnchorRect(anchorEl, item),
			context,
			mobileInteraction,
			menuKey,
		);
	}

	private isTrackedSessionSegmentStart(placement: TrackedSessionVisualPlacement, visibleDates: string[]): boolean {
		const dayKey = visibleDates[placement.dayIndex];
		if (!dayKey) return false;
		const sessionStart = parseLocalDatetime(placement.session.start);
		const segmentStart = this.buildTrackedSegmentBoundaryDate(dayKey, placement.startMinutes);
		return this.isSameLocalMinute(sessionStart, segmentStart);
	}

	private isTrackedSessionSegmentEnd(placement: TrackedSessionVisualPlacement, visibleDates: string[]): boolean {
		const dayKey = visibleDates[placement.dayIndex];
		if (!dayKey) return false;
		const sessionEnd = parseLocalDatetime(placement.session.end);
		const segmentEnd = this.buildTrackedSegmentBoundaryDate(dayKey, placement.endMinutes);
		return this.isSameLocalMinute(sessionEnd, segmentEnd);
	}

	private buildTrackedSegmentBoundaryDate(dayKey: string, minuteOfDay: number): Date | null {
		if (minuteOfDay >= 24 * 60) {
			return parseLocalDatetime(`${shiftCalendarDateKey(dayKey, 1)}T00:00:00`);
		}
		return parseLocalDatetime(this.buildDateMinuteValue(dayKey, minuteOfDay));
	}

	private isSameLocalMinute(left: Date | null, right: Date | null): boolean {
		if (!left || !right) return false;
		return Math.floor(left.getTime() / 60000) === Math.floor(right.getTime() / 60000);
	}

	private buildTrackedSessionDragSelection(
		placement: TrackedSessionVisualPlacement,
		visibleDates: string[],
		dayIndex: number,
		startMinutes: number,
		endMinutes: number,
		mode: 'move' | 'resize-start' | 'resize-end',
	): CalendarSlotSelection | null {
		const dateKey = visibleDates[dayIndex];
		if (!dateKey) return null;
		const originalStart = parseLocalDatetime(placement.session.start);
		const originalEnd = parseLocalDatetime(placement.session.end);
		if (!originalStart || !originalEnd || originalEnd.getTime() <= originalStart.getTime()) return null;

		let nextStart = originalStart;
		let nextEnd = originalEnd;
		if (mode === 'move') {
			const originalSegmentStart = this.buildTrackedSegmentBoundaryDate(
				visibleDates[placement.dayIndex] ?? '',
				placement.startMinutes,
			);
			const nextSegmentStart = this.buildTrackedSegmentBoundaryDate(dateKey, startMinutes);
			if (!originalSegmentStart || !nextSegmentStart) return null;
			const deltaMs = nextSegmentStart.getTime() - originalSegmentStart.getTime();
			nextStart = new Date(originalStart.getTime() + deltaMs);
			nextEnd = new Date(originalEnd.getTime() + deltaMs);
		} else if (mode === 'resize-start') {
			if (!this.isTrackedSessionSegmentStart(placement, visibleDates)) return null;
			const resizedStart = this.buildTrackedSegmentBoundaryDate(dateKey, startMinutes);
			if (!resizedStart) return null;
			nextStart = resizedStart;
		} else {
			if (!this.isTrackedSessionSegmentEnd(placement, visibleDates)) return null;
			const resizedEnd = this.buildTrackedSegmentBoundaryDate(dateKey, endMinutes);
			if (!resizedEnd) return null;
			nextEnd = resizedEnd;
		}
		if (nextEnd.getTime() <= nextStart.getTime()) return null;

		const start = toLocalDatetime(nextStart);
		const end = toLocalDatetime(nextEnd);
		return {
			mode: 'timed',
			start,
			end,
			startDate: start.substring(0, 10),
			endDate: end.substring(0, 10),
			isAllDay: false,
			slotMinutes: CALENDAR_TIMED_SNAP_MINUTES,
		};
	}

	private bindTrackedSessionInteraction(
		block: HTMLElement,
		placement: TrackedSessionVisualPlacement,
		visibleDates: string[],
		laneColumns: TimeTrackerGridLaneColumnRef[],
		dayModels: TimeTrackerGridDayLaneModel[],
		metrics: CalendarTimedMetrics,
		settings: OperonSettings,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
	): void {
		type TrackedDragMode = 'move' | 'resize-start' | 'resize-end';
		let dragState: {
			pointerId: number;
			mode: TrackedDragMode;
				anchorOffsetMinutes: number;
				currentDayIndex: number;
				currentStartMinutes: number;
				currentEndMinutes: number;
				hasValidTarget: boolean;
				suppressClickOnFinish: boolean;
			} | null = null;
			const dragLabel = block.querySelector<HTMLElement>('.operon-calendar-timed-drag-label');
			const isMobileTimeGridItem = block.hasClass('operon-calendar-mobile-timegrid-item');
			let pendingPointerDrag: {
				pointerId: number;
				initialClientX: number;
				initialClientY: number;
				dragMode: TrackedDragMode;
			} | null = null;
			let pendingTouchDrag: {
				pointerId: number;
				initialClientX: number;
				initialClientY: number;
				latestClientX: number;
				latestClientY: number;
				previousClientY: number;
				startedAtMs: number;
				mode: 'pending' | 'scrolling';
				dragMode: TrackedDragMode;
				timerId: ReturnType<Window['setTimeout']>;
				ownerWindow: Window;
				onPointerMove: (event: PointerEvent) => void;
				onPointerUp: (event: PointerEvent) => void;
				onPointerCancel: (event: PointerEvent) => void;
				onWindowBlur: () => void;
			} | null = null;
			let activeTouchWindowMoveCleanup: (() => void) | null = null;
			let touchDragActiveBody: HTMLElement | null = null;

			const isTouchDragPointer = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';

			const clearPendingPointerDrag = (releaseCapture: boolean): void => {
				if (!pendingPointerDrag) return;
				const pointerId = pendingPointerDrag.pointerId;
				pendingPointerDrag = null;
				if (releaseCapture) {
					this.releaseCalendarPointerCapture(block, pointerId);
				}
			};

			const setTrackedTouchDragActiveClass = (): void => {
				const body = getOwnerBody(block);
				if (touchDragActiveBody && touchDragActiveBody !== body) {
					touchDragActiveBody.classList.remove('operon-calendar-touch-drag-active');
				}
				touchDragActiveBody = body;
				touchDragActiveBody.classList.add('operon-calendar-touch-drag-active');
				block.addClass('is-touch-dragging');
			};

			const clearTrackedTouchDragActiveClass = (): void => {
				touchDragActiveBody?.classList.remove('operon-calendar-touch-drag-active');
				touchDragActiveBody = null;
				block.removeClass('is-touch-dragging');
			};

			const clearActiveTouchWindowMove = (): void => {
				activeTouchWindowMoveCleanup?.();
				activeTouchWindowMoveCleanup = null;
			};

			const bindActiveTouchWindowMove = (pointerId: number, ownerWindow: Window): void => {
				clearActiveTouchWindowMove();
				const onPointerMove = (event: PointerEvent): void => {
					if (event.pointerId !== pointerId) return;
					event.preventDefault();
					updateFromPointer(event.clientX, event.clientY);
				};
				ownerWindow.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
				activeTouchWindowMoveCleanup = () => ownerWindow.removeEventListener('pointermove', onPointerMove, true);
			};

			const clearPendingTouchDrag = (releaseCapture: boolean): void => {
				if (!pendingTouchDrag) return;
				const pending = pendingTouchDrag;
				pending.ownerWindow.clearTimeout(pending.timerId);
				pending.ownerWindow.removeEventListener('pointermove', pending.onPointerMove, true);
				pending.ownerWindow.removeEventListener('pointerup', pending.onPointerUp, true);
				pending.ownerWindow.removeEventListener('pointercancel', pending.onPointerCancel, true);
				pending.ownerWindow.removeEventListener('blur', pending.onWindowBlur, true);
				if (releaseCapture) {
					this.releaseCalendarPointerCapture(block, pending.pointerId);
				}
				block.removeClass('is-touch-drag-pending');
				pendingTouchDrag = null;
			};

			const getTouchPendingDistance = (clientX: number, clientY: number, pending = pendingTouchDrag): number => {
				if (!pending) return Number.POSITIVE_INFINITY;
				return Math.hypot(clientX - pending.initialClientX, clientY - pending.initialClientY);
			};

			const scrollMobileTimeGridBy = (deltaY: number): void => {
				if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
				const viewport = this.mobileTimeGridScrollEl?.isConnected
					? this.mobileTimeGridScrollEl
					: block.closest<HTMLElement>('.operon-calendar-mobile-timegrid-viewport');
				if (!viewport) return;
				const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
				viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop + deltaY));
				this.lastMobileTimeGridScrollTop = Math.max(0, Math.round(viewport.scrollTop));
			};

			const openTrackedSessionFromTouchTap = (): void => {
				if (placement.session.isActive || placement.session.isUnassigned || !this.callbacks.onTrackedSessionOpen) return;
				const ownerWindow = getOwnerWindow(block);
				block.dataset.suppressCalendarClick = 'true';
				ownerWindow.setTimeout(() => {
					if (!block.isConnected) return;
					void this.callbacks.onTrackedSessionOpen?.(placement.session.ref);
				}, CALENDAR_TOUCH_TAP_EDITOR_DELAY_MS);
			};

		const renderPlacement = (): void => {
			const nextDayIndex = dragState?.currentDayIndex ?? placement.dayIndex;
			const nextStart = dragState?.currentStartMinutes ?? placement.startMinutes;
			const nextEnd = dragState?.currentEndMinutes ?? placement.endMinutes;
			const dayModel = dayModels[nextDayIndex];
			const lane = dayModel?.trackedLane ?? null;
			if (!dayModel || !lane) return;
			this.applyTimeTrackerGridTimedPlacementStyle(
				block,
				nextDayIndex,
				lane.semanticIndex,
				dayModel.semanticLaneCount,
				placement.visualLeftRatio,
				placement.visualWidthRatio,
				nextStart,
				nextEnd,
				visibleDates.length,
				metrics,
				placement,
			);
			if (dragLabel) {
				const dateKey = visibleDates[nextDayIndex] ?? visibleDates[placement.dayIndex] ?? '';
				dragLabel.setText(this.formatTimedDragLabel(dateKey, nextStart, nextEnd, settings));
			}
			if (dragState) {
				this.renderTimedSelectionGuides(
					section,
					gutter,
					block,
					hoverGuideOverlay,
					visibleDates[nextDayIndex] ?? '',
					nextStart,
					nextEnd,
					metrics,
					this.resolveCalendarHoverGuideAccent(block),
					settings,
					0,
					1,
				);
			}
		};

		const buildSelection = (): CalendarSlotSelection | null => {
			if (!dragState) return null;
			if (!dragState.hasValidTarget || !dayModels[dragState.currentDayIndex]?.trackedLane) return null;
			return this.buildTrackedSessionDragSelection(
				placement,
				visibleDates,
				dragState.currentDayIndex,
				dragState.currentStartMinutes,
				dragState.currentEndMinutes,
				dragState.mode,
			);
		};

		const updateFromPointer = (clientX: number, clientY: number): void => {
			if (!dragState) return;
			const position = this.resolveTimeTrackerGridLanePosition(laneColumns, metrics, clientX, clientY);
			if (!position || !dayModels[position.dayIndex]?.trackedLane) {
				dragState.hasValidTarget = false;
				hoverGuideOverlay.empty();
				return;
			}
			dragState.hasValidTarget = true;
			const duration = Math.max(CALENDAR_TIMED_SNAP_MINUTES, placement.endMinutes - placement.startMinutes);
			if (dragState.mode === 'move') {
				let nextStart = position.minuteOfDay - dragState.anchorOffsetMinutes;
				nextStart = Math.round(nextStart / CALENDAR_TIMED_SNAP_MINUTES) * CALENDAR_TIMED_SNAP_MINUTES;
				nextStart = Math.max(0, Math.min(24 * 60 - duration, nextStart));
				dragState.currentDayIndex = position.dayIndex;
				dragState.currentStartMinutes = nextStart;
				dragState.currentEndMinutes = Math.min(24 * 60, nextStart + duration);
			} else if (dragState.mode === 'resize-start') {
				let nextStart = Math.round(position.minuteOfDay / CALENDAR_TIMED_SNAP_MINUTES) * CALENDAR_TIMED_SNAP_MINUTES;
				nextStart = Math.max(0, Math.min(dragState.currentEndMinutes - CALENDAR_TIMED_SNAP_MINUTES, nextStart));
				dragState.currentStartMinutes = nextStart;
			} else {
				let nextEnd = Math.round(position.minuteOfDay / CALENDAR_TIMED_SNAP_MINUTES) * CALENDAR_TIMED_SNAP_MINUTES;
				nextEnd = Math.max(dragState.currentStartMinutes + CALENDAR_TIMED_SNAP_MINUTES, Math.min(24 * 60, nextEnd));
				dragState.currentEndMinutes = nextEnd;
			}
			renderPlacement();
		};

			const startDragFromPointer = (
				pointerId: number,
				clientX: number,
				clientY: number,
				mode: TrackedDragMode,
				suppressClickOnFinish = false,
			): boolean => {
				clearPendingPointerDrag(false);
				this.hideCalendarHoverMenu(true);
				const position = this.resolveTimeTrackerGridLanePosition(laneColumns, metrics, clientX, clientY);
				if (!position) return false;
				block.addClass('is-dragging', 'is-live-editing');
				dragState = {
					pointerId,
					mode,
					anchorOffsetMinutes: Math.max(0, position.minuteOfDay - placement.startMinutes),
					currentDayIndex: placement.dayIndex,
					currentStartMinutes: placement.startMinutes,
					currentEndMinutes: placement.endMinutes,
					hasValidTarget: true,
					suppressClickOnFinish,
				};
				this.beginCalendarDragSession(block, pointerId, finishDrag);
				block.setPointerCapture?.(pointerId);
				renderPlacement();
				return true;
			};

			const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
				if (!dragState) return;
				const pointerId = dragState.pointerId;
				if (event && pointerId !== event.pointerId) return;
				clearPendingPointerDrag(true);
				clearPendingTouchDrag(true);
				clearActiveTouchWindowMove();
				clearTrackedTouchDragActiveClass();
				if (event) updateFromPointer(event.clientX, event.clientY);
				const selection = buildSelection();
				const changed = dragState.currentDayIndex !== placement.dayIndex
					|| dragState.currentStartMinutes !== placement.startMinutes
					|| dragState.currentEndMinutes !== placement.endMinutes;
				const mode = dragState.mode;
				const suppressClickOnFinish = dragState.suppressClickOnFinish;
				this.releaseCalendarPointerCapture(block, pointerId);
				block.removeClass('is-dragging', 'is-live-editing');
				hoverGuideOverlay.empty();
				dragState = null;
				if (suppressClickOnFinish) {
					block.dataset.suppressCalendarClick = 'true';
				}
				if (reason !== 'commit' || !changed || !selection) {
					renderPlacement();
					return;
			}
			block.dataset.suppressCalendarClick = 'true';
			if (mode === 'move') {
				void this.callbacks.onTrackedSessionMove?.(placement.session.ref, selection);
				return;
			}
			void this.callbacks.onTrackedSessionResize?.(placement.session.ref, selection);
		};

		const startTrackedPendingTouchDrag = (event: PointerEvent, mode: TrackedDragMode): void => {
			clearPendingTouchDrag(true);
			this.hideCalendarHoverMenu(true);
			event.preventDefault();
			event.stopPropagation();
			const ownerWindow = getOwnerWindow(block);
			const pointerId = event.pointerId;
			try {
				block.setPointerCapture?.(pointerId);
			} catch {
				// Pointer capture is best-effort in embedded mobile WebViews.
			}
			const onPointerMove = (moveEvent: PointerEvent): void => {
				const pending = pendingTouchDrag;
				if (!pending || moveEvent.pointerId !== pointerId) return;
				pending.latestClientX = moveEvent.clientX;
				pending.latestClientY = moveEvent.clientY;
				const deltaX = moveEvent.clientX - pending.initialClientX;
				const deltaY = moveEvent.clientY - pending.initialClientY;
				moveEvent.preventDefault();
				moveEvent.stopPropagation();
				if (pending.mode === 'scrolling') {
					scrollMobileTimeGridBy(pending.previousClientY - moveEvent.clientY);
					pending.previousClientY = moveEvent.clientY;
					return;
				}
				const elapsedMs = pending.ownerWindow.performance.now() - pending.startedAtMs;
				const intent = resolveCalendarMobileTimedTaskGestureIntent({
					deltaX,
					deltaY,
					elapsedMs,
					intentDistancePx: CALENDAR_MOBILE_TOUCH_INTENT_DISTANCE_PX,
					pressDragMs: CALENDAR_MOBILE_TASK_PRESS_DRAG_MS,
				});
				if (intent === 'scroll') {
					pending.mode = 'scrolling';
					block.removeClass('is-touch-drag-pending');
					pending.ownerWindow.clearTimeout(pending.timerId);
					scrollMobileTimeGridBy(pending.previousClientY - moveEvent.clientY);
					pending.previousClientY = moveEvent.clientY;
					return;
				}
				if (intent === 'drag') {
					clearPendingTouchDrag(false);
					if (startDragFromPointer(pointerId, moveEvent.clientX, moveEvent.clientY, pending.dragMode, true)) {
						setTrackedTouchDragActiveClass();
						bindActiveTouchWindowMove(pointerId, ownerWindow);
						updateFromPointer(moveEvent.clientX, moveEvent.clientY);
					} else {
						this.releaseCalendarPointerCapture(block, pointerId);
					}
				}
			};
			const onPointerUp = (upEvent: PointerEvent): void => {
				const pending = pendingTouchDrag;
				if (!pending || upEvent.pointerId !== pointerId) return;
				upEvent.preventDefault();
				upEvent.stopPropagation();
				if (pending.mode === 'scrolling') {
					clearPendingTouchDrag(true);
					return;
				}
				const shouldOpenEditor = getTouchPendingDistance(upEvent.clientX, upEvent.clientY, pending) <= CALENDAR_MOBILE_TOUCH_CANCEL_DISTANCE_PX;
				clearPendingTouchDrag(true);
				if (shouldOpenEditor) {
					openTrackedSessionFromTouchTap();
				}
			};
			const onPointerCancel = (cancelEvent: PointerEvent): void => {
				if (!pendingTouchDrag || cancelEvent.pointerId !== pointerId) return;
				cancelEvent.preventDefault();
				clearPendingTouchDrag(true);
			};
			const onWindowBlur = (): void => clearPendingTouchDrag(true);
			const timerId = ownerWindow.setTimeout(() => {
				const pending = pendingTouchDrag;
				if (!pending || pending.pointerId !== pointerId) return;
				clearPendingTouchDrag(false);
				if (startDragFromPointer(pointerId, pending.latestClientX, pending.latestClientY, pending.dragMode, true)) {
					setTrackedTouchDragActiveClass();
					bindActiveTouchWindowMove(pointerId, ownerWindow);
				} else {
					this.releaseCalendarPointerCapture(block, pointerId);
				}
			}, CALENDAR_MOBILE_TASK_LONG_PRESS_MS);

			pendingTouchDrag = {
				pointerId,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				latestClientX: event.clientX,
				latestClientY: event.clientY,
				previousClientY: event.clientY,
				startedAtMs: ownerWindow.performance.now(),
				mode: 'pending',
				dragMode: mode,
				timerId,
				ownerWindow,
				onPointerMove,
				onPointerUp,
				onPointerCancel,
				onWindowBlur,
			};
			block.addClass('is-touch-drag-pending');
			ownerWindow.addEventListener('pointermove', onPointerMove, true);
			ownerWindow.addEventListener('pointerup', onPointerUp, true);
			ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
			ownerWindow.addEventListener('blur', onWindowBlur, true);
		};

		const startTrackedPendingPointerDrag = (event: PointerEvent, mode: TrackedDragMode): void => {
			clearPendingPointerDrag(true);
			event.preventDefault();
			event.stopPropagation();
			const pointerId = event.pointerId;
			try {
				block.setPointerCapture?.(pointerId);
			} catch {
				// Pointer capture is best-effort in embedded panes.
			}
			pendingPointerDrag = {
				pointerId,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				dragMode: mode,
			};
		};

		block.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, block);
			if (target?.closest('.operon-calendar-item-action-button, .operon-calendar-status-button, a.internal-link')) return;
			const mode = target?.closest('.operon-calendar-timed-resize-handle.is-start')
				? 'resize-start'
				: target?.closest('.operon-calendar-timed-resize-handle.is-end')
					? 'resize-end'
					: 'move';
			if (isMobileTimeGridItem && isTouchDragPointer(event)) {
				startTrackedPendingTouchDrag(event, mode);
				return;
			}
			startTrackedPendingPointerDrag(event, mode);
		});
		block.addEventListener('pointermove', (event: PointerEvent) => {
			const pending = pendingPointerDrag;
			if (pending && pending.pointerId === event.pointerId && !dragState) {
				const intent = resolveCalendarTrackedSessionPointerDragIntent({
					deltaX: event.clientX - pending.initialClientX,
					deltaY: event.clientY - pending.initialClientY,
					intentDistancePx: CALENDAR_TRACKED_SESSION_DESKTOP_DRAG_INTENT_DISTANCE_PX,
				});
				if (intent === 'pending') return;
				event.preventDefault();
				event.stopPropagation();
				if (startDragFromPointer(event.pointerId, event.clientX, event.clientY, pending.dragMode)) {
					updateFromPointer(event.clientX, event.clientY);
				} else {
					this.releaseCalendarPointerCapture(block, event.pointerId);
				}
				return;
			}
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			updateFromPointer(event.clientX, event.clientY);
		});
		block.addEventListener('pointerup', (event: PointerEvent) => {
			if (pendingPointerDrag?.pointerId === event.pointerId) {
				clearPendingPointerDrag(true);
				return;
			}
			this.finishActiveCalendarDragSession('commit', event);
		});
		block.addEventListener('pointercancel', (event: PointerEvent) => {
			if (pendingPointerDrag?.pointerId === event.pointerId) {
				clearPendingPointerDrag(true);
				return;
			}
			this.finishActiveCalendarDragSession('cancel', event);
		});
	}

	private resolveTimeTrackerGridLanePosition(
		laneColumns: TimeTrackerGridLaneColumnRef[],
		metrics: CalendarTimedMetrics,
		clientX: number,
		clientY: number,
	): { dayIndex: number; minuteOfDay: number } | null {
		for (const columnRef of laneColumns) {
			const rect = columnRef.element.getBoundingClientRect();
			const inside = clientX >= rect.left
				&& clientX <= rect.right
				&& clientY >= rect.top
				&& clientY <= rect.bottom;
			if (!inside) continue;
			const relativeY = Math.max(0, Math.min(metrics.gridHeight, clientY - rect.top));
			return {
				dayIndex: columnRef.dayIndex,
				minuteOfDay: Math.max(0, Math.min(24 * 60, this.gridOffsetToMinute(relativeY, metrics))),
			};
		}
		return null;
	}

	private applyTimeTrackerGridTimedPlacementStyle(
		element: HTMLElement,
		dayIndex: number,
		semanticIndex: number,
		semanticLaneCount: number,
		leftRatio: number,
		widthRatio: number,
		startMinutes: number,
		endMinutes: number,
		totalDays: number,
		metrics: CalendarTimedMetrics,
		visualLayout?: TimedGridVisualLayout,
	): void {
		const safeLaneCount = Math.max(1, semanticLaneCount);
		const safeTotalDays = Math.max(1, totalDays);
		const top = this.minuteToGridOffset(startMinutes, metrics);
		const height = Math.max(1, this.minuteToGridOffset(endMinutes, metrics) - top);
		const slotHeight = Math.max(1, CALENDAR_TIMED_SNAP_MINUTES * metrics.scale);
		const visibleLineCount = Math.max(1, Math.floor(height / slotHeight));
		const dayOffset = Math.max(0, dayIndex) + ((semanticIndex + leftRatio) / safeLaneCount);
		element.style.top = `${Math.max(0, top)}px`;
		element.style.height = `${height}px`;
		element.style.left = `${(dayOffset / safeTotalDays) * 100}%`;
		element.style.width = `${(widthRatio / safeLaneCount / safeTotalDays) * 100}%`;
		element.style.removeProperty('--operon-calendar-availability-width');
		element.style.setProperty('--operon-calendar-day-width', `${(1 / safeTotalDays) * 100}%`);
		element.style.setProperty('--operon-calendar-slot-height', `${slotHeight}px`);
		element.style.setProperty('--operon-calendar-visible-lines', String(visibleLineCount));
		if (visualLayout) {
			element.style.setProperty('--operon-calendar-stack-index', String(Math.max(1, visualLayout.visualStackIndex)));
		} else {
			element.style.removeProperty('--operon-calendar-stack-index');
		}
		element.classList.toggle('is-compact-height', height < 42);
		element.classList.toggle('is-micro-height', height < 26);
		element.classList.toggle('is-clipped-top', startMinutes <= 0);
		element.classList.toggle('is-clipped-bottom', endMinutes >= 24 * 60);
		if (visualLayout?.visualEndOccluded) {
			element.addClass('is-end-occluded');
		} else {
			element.removeClass('is-end-occluded');
		}
	}

	private doesDateTimeRangeIntersectDateRange(
		startValue: string,
		endValue: string,
		rangeStartDate: string,
		rangeEndDate: string,
	): boolean {
		const start = parseLocalDatetime(startValue);
		const end = parseLocalDatetime(endValue);
		const rangeStart = parseLocalDatetime(`${rangeStartDate}T00:00:00`);
		const rangeEnd = parseLocalDatetime(`${rangeEndDate}T23:59:59`);
		if (!start || !end || !rangeStart || !rangeEnd || end.getTime() <= start.getTime()) return false;
		return end.getTime() >= rangeStart.getTime() && start.getTime() <= rangeEnd.getTime();
	}

	private renderMultiWeekSurface(
		container: HTMLElement,
		visibleDates: string[],
		scheduledItems: CalendarItem[],
		dueItems: CalendarItem[],
		finishedItems: CalendarItem[],
		timedItems: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
		state: CalendarLeafState,
	): void {
		const groups = this.buildMultiWeekGroups(visibleDates, preset);
		for (const group of groups) {
			const weekGroup = container.createDiv('operon-calendar-multi-week-group');
			this.renderMultiWeekWeekHeader(weekGroup, group.visibleDates, state);
			if (state.showAllDayLane || state.showDueMarkers) {
				this.renderAllDaySection(
					weekGroup,
					group.visibleDates,
					scheduledItems,
					dueItems,
					[],
					preset,
					settings,
					state.showAllDayLane,
					state.showDueMarkers,
					false,
					'multiWeek',
				);
			}
			if (state.showInDayLane) {
				this.renderMultiWeekInDaySection(weekGroup, group.visibleDates, timedItems, preset, settings);
			}
			if (state.showFinishedLane) {
				this.renderAllDaySection(
					weekGroup,
					group.visibleDates,
					[],
					[],
					finishedItems,
					preset,
					settings,
					false,
					false,
					true,
					'multiWeek',
				);
			}
		}
	}

	private renderMultiWeekWeekHeader(
		container: HTMLElement,
		visibleDates: string[],
		state: CalendarLeafState,
	): void {
		const headerRow = container.createDiv('operon-calendar-day-header-row operon-calendar-multi-week-header-row');
		const gutterSpacer = headerRow.createDiv('operon-calendar-gutter-spacer');
			if (!state.showAllDayLane || !state.showDueMarkers || !state.showInDayLane || !state.showFinishedLane) {
			const hiddenStack = gutterSpacer.createDiv('operon-calendar-hidden-lane-toggle-stack');
			if (!state.showAllDayLane) {
					this.renderLaneToggleButton(hiddenStack, t('calendar', 'allDay'), false, () => {
					void this.updateLeafState({
						...this.ensureState(),
						showAllDayLane: true,
					});
				}, true);
			}
			if (!state.showDueMarkers) {
					this.renderLaneToggleButton(hiddenStack, t('calendar', 'due'), false, () => {
					void this.updateLeafState({
						...this.ensureState(),
						showDueMarkers: true,
					});
				}, true);
			}
			if (!state.showInDayLane) {
					this.renderLaneToggleButton(hiddenStack, t('calendar', 'inDay'), false, () => {
					void this.updateLeafState({
						...this.ensureState(),
						showInDayLane: true,
					});
				}, true);
			}
			if (!state.showFinishedLane) {
					this.renderLaneToggleButton(hiddenStack, t('calendar', 'finished'), false, () => {
					void this.updateLeafState({
						...this.ensureState(),
						showFinishedLane: true,
					});
				}, true);
			}
		}

		const daysGrid = headerRow.createDiv('operon-calendar-day-header-grid');
		daysGrid.style.gridTemplateColumns = `repeat(${Math.max(1, visibleDates.length)}, minmax(0, 1fr))`;
		const opensDailyNote = this.getSettings().calendarDayTitleAction === 'create-open-daily-note';
		for (const dateKey of visibleDates) {
			const cell = daysGrid.createDiv('operon-calendar-day-header-cell');
			const dayDate = this.parseDateKey(dateKey);
			cell.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
			if (dateKey === localToday()) {
				cell.addClass('is-today');
			}
			if (opensDailyNote) {
				cell.addClass('is-clickable');
				cell.tabIndex = 0;
				cell.addEventListener('click', () => {
					void this.callbacks.onOpenDailyNote?.(dateKey);
				});
				cell.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					void this.callbacks.onOpenDailyNote?.(dateKey);
				});
			}
			const topLine = cell.createDiv('operon-calendar-day-header-topline');
			topLine.createDiv({
				text: this.formatWeekdayLabel(dateKey),
				cls: 'operon-calendar-day-header-weekday',
			});
			this.renderWeekLabelForDayHeader(topLine, dateKey);
			cell.createDiv({
				text: this.formatDayLabel(dateKey),
				cls: 'operon-calendar-day-header-date',
			});
		}
	}

	private renderMultiWeekInDaySection(
		container: HTMLElement,
		visibleDates: string[],
		timedItems: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		const row = container.createDiv('operon-calendar-multi-week-inday-row');
		const labelEl = row.createDiv('operon-calendar-row-label');
		this.renderLaneToggleButton(labelEl, t('calendar', 'inDay'), true, () => {
			void this.updateLeafState({
				...this.ensureState(),
				showInDayLane: false,
			});
		});

		const body = row.createDiv('operon-calendar-multi-week-inday-body');
		const dayLists: HTMLElement[] = [];
		this.multiWeekInDayDropContexts.push({
			body,
			dayLists,
			visibleDates: [...visibleDates],
			preset,
			settings,
		});
		const grid = body.createDiv('operon-calendar-multi-week-inday-grid');
		grid.style.gridTemplateColumns = `repeat(${Math.max(1, visibleDates.length)}, minmax(0, 1fr))`;
		const timedPlacements = this.buildTimedPlacements(timedItems, visibleDates);
		const placementsByDay = new Map<number, TimedSegmentPlacement[]>();
		for (const placement of timedPlacements) {
			const list = placementsByDay.get(placement.dayIndex) ?? [];
			list.push(placement);
			placementsByDay.set(placement.dayIndex, list);
		}

		for (let dayIndex = 0; dayIndex < visibleDates.length; dayIndex++) {
			const dateKey = visibleDates[dayIndex];
			const cell = grid.createDiv('operon-calendar-multi-week-inday-cell');
			const dayDate = this.parseDateKey(dateKey);
			cell.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
			if (dateKey === localToday()) {
				cell.addClass('is-today');
			}
			this.bindCalendarCellQuickAdd(cell, dateKey, () => {
				void this.callbacks.onAllDaySlotSelection?.(buildAllDaySlotSelection(dateKey, dateKey));
			});
			const listEl = cell.createDiv('operon-calendar-multi-week-inday-list');
			dayLists.push(listEl);
			const dayPlacements = (placementsByDay.get(dayIndex) ?? []).sort((left, right) => {
				if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
				if (left.endMinutes !== right.endMinutes) return left.endMinutes - right.endMinutes;
				return (left.item.renderSnapshot.description || left.item.taskId).localeCompare(
					right.item.renderSnapshot.description || right.item.taskId,
				);
			});
			for (const placement of dayPlacements) {
				this.renderMultiWeekInDayItem(listEl, placement, visibleDates, preset, settings);
			}
		}
	}

	private renderMultiWeekInDayItem(
		container: HTMLElement,
		placement: TimedSegmentPlacement,
		visibleDates: string[],
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		const itemEl = container.createDiv('operon-calendar-multi-week-inday-item');
		itemEl.addClass(`is-${placement.item.renderSnapshot.checkbox}`);
		this.applyCalendarProjectionClasses(itemEl, placement.item);
		if (placement.item.origin === 'external') itemEl.addClass('is-external');
		this.applyCalendarItemColor(itemEl, placement.item, preset, settings);

		const content = itemEl.createDiv('operon-calendar-multi-week-inday-item-content');
		const mainRow = content.createDiv('operon-calendar-multi-week-inday-main-row');
		const hoverTrigger = this.renderCalendarItemLabel(mainRow, placement.item, settings, true);
		const metaRow = content.createDiv('operon-calendar-multi-week-inday-meta-row');
		const chips = metaRow.createDiv('operon-calendar-multi-week-inday-time-chips');
		const dateKey = visibleDates[placement.dayIndex] ?? placement.item.startDate;
		this.renderMultiWeekTimeChip(chips, 'datetimeStart', dateKey, placement.startMinutes, settings);
		this.renderMultiWeekTimeChip(chips, 'datetimeEnd', dateKey, placement.endMinutes, settings);
		this.bindPrimaryItemClick(itemEl, placement.item);
		if (hoverTrigger) {
			this.bindHoverMenuTarget(hoverTrigger, placement.item);
		}
		if (this.canEditCalendarItemPlacement(placement.item)) {
			itemEl.addClass('is-draggable');
			this.bindMultiWeekInDayItemInteraction(itemEl, placement, visibleDates, preset, settings);
		} else {
			itemEl.addClass('is-read-only');
		}
	}

	private renderSidebarShell(
		root: HTMLElement,
		state: CalendarLeafState,
		preset: CalendarPreset,
		visibleDates: string[],
	): HTMLElement {
		root.addClass('is-sidebar-mode');
		const layout = root.createDiv('operon-calendar-sidebar-layout');
		layout.style.setProperty('--operon-calendar-sidebar-width', `${this.resolveSidebarWidthPx()}px`);
		const sidebar = layout.createDiv('operon-calendar-sidebar');
		const resizeHandle = layout.createDiv('operon-calendar-sidebar-resize-handle');
		const surfaceScroll = layout.createDiv('operon-calendar-surface-scroll');
		this.surfaceScrollEl = surfaceScroll;
		const surface = surfaceScroll.createDiv('operon-calendar-surface');
		this.renderSidebar(sidebar, state, preset, visibleDates);
		this.bindSidebarResizeHandle(resizeHandle, layout);
		return surface;
	}

	private renderSurfaceScrollShell(container: HTMLElement): HTMLElement {
		const scroll = container.createDiv('operon-calendar-surface-scroll');
		this.surfaceScrollEl = scroll;
		return scroll.createDiv('operon-calendar-surface');
	}

	private renderCalendarQuickActions(
		container: HTMLElement,
		preset: CalendarPreset,
		placement: 'toolbar' | 'sidebar',
	): HTMLElement {
		const actions = container.createDiv(`operon-calendar-quick-actions is-${placement}`);
		const showProjectedOccurrences = preset.showProjectedOccurrences !== false;
		const projectedLabel = showProjectedOccurrences
			? t('calendar', 'hideFutureOccurrences')
			: t('calendar', 'showFutureOccurrences');
		const projectedButton = actions.createEl('button', {
			cls: 'operon-calendar-quick-action-button',
			attr: {
				type: 'button',
				'aria-pressed': String(showProjectedOccurrences),
			},
		});
		projectedButton.classList.toggle('is-on', showProjectedOccurrences);
		projectedButton.classList.toggle('is-off', !showProjectedOccurrences);
		setIcon(projectedButton, showProjectedOccurrences ? 'eye' : 'eye-off');
		setAccessibleLabelWithoutTooltip(projectedButton, projectedLabel);
		bindOperonHoverTooltip(projectedButton, { content: projectedLabel, taskColor: null });
		projectedButton.addEventListener('click', (event) => {
			event.preventDefault();
			void this.callbacks.onToggleProjectedOccurrences?.(preset.id, !showProjectedOccurrences);
		});

		const hasSelectedExternalCalendars = this.hasSelectedExternalCalendars(preset);
		const showExternalCalendars = preset.showExternalCalendars !== false;
		const externalCalendarsLabel = hasSelectedExternalCalendars
			? showExternalCalendars
				? t('calendar', 'hideExternalCalendars')
				: t('calendar', 'showExternalCalendars')
			: t('calendar', 'noExternalCalendarsSelectedForPreset');
		const externalCalendarsButton = actions.createEl('button', {
			cls: 'operon-calendar-quick-action-button',
			attr: {
				type: 'button',
				'aria-pressed': String(showExternalCalendars && hasSelectedExternalCalendars),
				'aria-disabled': String(!hasSelectedExternalCalendars),
			},
		});
		externalCalendarsButton.classList.toggle('is-on', showExternalCalendars && hasSelectedExternalCalendars);
		externalCalendarsButton.classList.toggle('is-off', !showExternalCalendars || !hasSelectedExternalCalendars);
		externalCalendarsButton.classList.toggle('is-disabled', !hasSelectedExternalCalendars);
		setIcon(externalCalendarsButton, showExternalCalendars && hasSelectedExternalCalendars ? 'calendar-check' : 'calendar-off');
		setAccessibleLabelWithoutTooltip(externalCalendarsButton, externalCalendarsLabel);
		bindOperonHoverTooltip(externalCalendarsButton, { content: externalCalendarsLabel, taskColor: null });
		externalCalendarsButton.addEventListener('click', (event) => {
			event.preventDefault();
			if (!hasSelectedExternalCalendars) return;
			void this.callbacks.onToggleExternalCalendars?.(preset.id, !showExternalCalendars);
		});

		const currentColorSource = normalizeTaskColorSource(preset.colorSource, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
		const nextColorSource = getNextTaskColorSource(currentColorSource, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
		const colorSourceLabel = t('calendar', 'cycleTaskColorSourceTooltip', {
			current: getTaskColorSourceLabel(currentColorSource),
			next: getTaskColorSourceLabel(nextColorSource),
		});
		const colorSourceButton = actions.createEl('button', {
			cls: 'operon-calendar-quick-action-button',
			attr: { type: 'button' },
		});
		setIcon(colorSourceButton, getTaskColorSourceIcon(currentColorSource));
		setAccessibleLabelWithoutTooltip(colorSourceButton, colorSourceLabel);
		bindOperonHoverTooltip(colorSourceButton, { content: colorSourceLabel, taskColor: null });
		colorSourceButton.addEventListener('click', (event) => {
			event.preventDefault();
			void this.callbacks.onCycleTaskColorSource?.(preset.id, nextColorSource);
		});

		const syncExternalCalendarsLabel = t('commands', 'updateExternalCalendars');
		const syncExternalCalendarsButton = actions.createEl('button', {
			cls: 'operon-calendar-quick-action-button',
			attr: { type: 'button' },
		});
		setIcon(syncExternalCalendarsButton, 'calendar-sync');
		setAccessibleLabelWithoutTooltip(syncExternalCalendarsButton, syncExternalCalendarsLabel);
		bindOperonHoverTooltip(syncExternalCalendarsButton, { content: syncExternalCalendarsLabel, taskColor: null });
		syncExternalCalendarsButton.addEventListener('click', (event) => {
			event.preventDefault();
			void this.callbacks.onSyncExternalCalendars?.();
		});

		const settingsButton = actions.createEl('button', {
			cls: 'operon-calendar-quick-action-button',
			attr: { type: 'button' },
		});
		setIcon(settingsButton, 'settings-2');
		setAccessibleLabelWithoutTooltip(settingsButton, t('calendar', 'editCurrentCalendarPreset'));
		bindOperonHoverTooltip(settingsButton, { content: t('calendar', 'editCurrentCalendarPreset'), taskColor: null });
		settingsButton.addEventListener('click', (event) => {
			event.preventDefault();
			void this.callbacks.onOpenPresetSettings?.(preset.id);
		});
		return actions;
	}

	private renderSidebar(
		container: HTMLElement,
		state: CalendarLeafState,
		preset: CalendarPreset,
		visibleDates: string[],
	): void {
		const header = container.createDiv('operon-calendar-sidebar-header');
		this.createToolbarIconButton(
			header,
			['panel-left'],
			() => {
				void this.updateLeafState({
					...state,
					navigationMode: 'toolbar',
				});
			},
				t('calendar', 'toggleToToolbar'),
				t('calendar', 'toggleToToolbar'),
				'operon-calendar-sidebar-toggle-button',
			);
			header.createDiv({
				text: t('calendar', 'title'),
				cls: 'operon-calendar-sidebar-header-title',
			});

		this.renderMiniMonth(container, state, preset);
		this.renderCalendarQuickActions(container, preset, 'sidebar');

		const sectionsWrapper = container.createDiv('operon-calendar-sidebar-pools-wrapper');
		const presetSection = sectionsWrapper.createDiv('operon-calendar-sidebar-section operon-calendar-sidebar-calendars-section operon-calendar-sidebar-managed-section');
		presetSection.classList.toggle('is-open', state.calendarsOpen);
		const presetToggle = presetSection.createEl('button', {
			cls: 'operon-calendar-sidebar-task-pool-toggle',
			attr: { type: 'button', 'aria-expanded': String(state.calendarsOpen) },
		});
		presetToggle.createSpan({ text: t('calendar', 'calendars') });
		const presetToggleIcon = presetToggle.createSpan('operon-calendar-sidebar-task-pool-toggle-icon');
		setIcon(presetToggleIcon, state.calendarsOpen ? 'chevron-down' : 'chevron-right');
		presetToggle.addEventListener('click', () => {
			void this.toggleSidebarSection('calendars');
		});
		if (state.calendarsOpen) {
			const presetList = presetSection.createDiv('operon-calendar-sidebar-preset-list operon-calendar-sidebar-section-scroll');
			const visiblePresets = this.getSettings().calendarPresets;
			for (const entry of visiblePresets) {
				const row = presetList.createDiv('operon-calendar-sidebar-preset-row');
				row.classList.toggle('is-active', entry.id === preset.id);

				const button = row.createEl('button', {
					text: entry.name,
					cls: 'operon-calendar-sidebar-preset-button',
					attr: { type: 'button' },
				});
				button.addEventListener('click', () => {
					void this.updateLeafState({
						...state,
						presetId: entry.id,
					});
				});

				button.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					void this.updateLeafState({
						...state,
						presetId: entry.id,
					});
				});
			}
		}

			this.renderSidebarTaskPool(sectionsWrapper, preset, visibleDates);
			this.bindSidebarSectionLayout(sectionsWrapper);
		}

		private bindSidebarSectionLayout(wrapper: HTMLElement): void {
			this.sidebarSectionsLayoutCleanup?.();
			const generation = this.renderGeneration;
			let frameScheduled = false;
			const schedule = (): void => {
				if (frameScheduled) return;
				frameScheduled = true;
				this.requestRenderAnimationFrame(generation, () => {
					this.resetSidebarSectionMaxHeights(wrapper);
					this.requestRenderAnimationFrame(generation, () => {
						frameScheduled = false;
						this.adjustSidebarSectionHeights(wrapper);
					});
				});
			};
			schedule();
			const observer = new ResizeObserver(() => schedule());
			observer.observe(wrapper);
			this.sidebarSectionsLayoutCleanup = () => observer.disconnect();
		}

		private scheduleSidebarSectionLayoutRefresh(wrapper: HTMLElement): void {
			const generation = this.renderGeneration;
			this.requestRenderAnimationFrame(generation, () => {
				this.resetSidebarSectionMaxHeights(wrapper);
				this.requestRenderAnimationFrame(generation, () => {
					this.adjustSidebarSectionHeights(wrapper);
				});
			});
		}

		private resetSidebarSectionMaxHeights(wrapper: HTMLElement): void {
			for (const section of Array.from(wrapper.querySelectorAll<HTMLElement>('.operon-calendar-sidebar-managed-section'))) {
				this.setSidebarSectionMaxHeight(section, null);
			}
		}

		private adjustSidebarSectionHeights(wrapper: HTMLElement): void {
			const sections = Array.from(wrapper.querySelectorAll<HTMLElement>('.operon-calendar-sidebar-managed-section'));
			if (sections.length === 0) return;

		if (getOwnerWindow(wrapper).matchMedia(CALENDAR_MOBILE_SIDEBAR_MEDIA_QUERY).matches) {
			for (const section of sections) {
				this.setSidebarSectionMaxHeight(section, null);
			}
			return;
		}

		const wrapperHeight = wrapper.clientHeight;
		if (wrapperHeight <= 0) return;

		const gapValue = Number.parseFloat(getComputedStyle(wrapper).rowGap || getComputedStyle(wrapper).gap || '0') || 0;
		const totalGap = Math.max(0, sections.length - 1) * gapValue;
		for (const section of sections) {
			if (!section.classList.contains('is-open')) {
				this.setSidebarSectionMaxHeight(section, null);
			}
		}
		const closedHeight = sections
			.filter(section => !section.classList.contains('is-open'))
			.reduce((sum, section) => sum + section.offsetHeight, 0);
		const openSections = sections.filter(section => section.classList.contains('is-open'));
		if (openSections.length === 0) return;

		const availableForOpen = Math.max(0, wrapperHeight - totalGap - closedHeight);
		if (openSections.length === 1) {
			this.setSidebarSectionMaxHeight(openSections[0], availableForOpen);
			return;
		}

		const [first, second] = openSections;
		const half = Math.floor(availableForOpen / 2);
		const firstNatural = first.scrollHeight;
		const secondNatural = second.scrollHeight;

		let firstHeight = half;
		let secondHeight = availableForOpen - half;

		if (firstNatural <= half && secondNatural > half) {
			firstHeight = firstNatural;
			secondHeight = availableForOpen - firstHeight;
		} else if (secondNatural <= half && firstNatural > half) {
			secondHeight = secondNatural;
			firstHeight = availableForOpen - secondHeight;
		} else if (firstNatural <= half && secondNatural <= half) {
			if (firstNatural <= secondNatural) {
				firstHeight = firstNatural;
				secondHeight = availableForOpen - firstHeight;
			} else {
				secondHeight = secondNatural;
				firstHeight = availableForOpen - secondHeight;
			}
		}

			this.setSidebarSectionMaxHeight(first, firstHeight);
			this.setSidebarSectionMaxHeight(second, secondHeight);
		}

	private setSidebarSectionMaxHeight(section: HTMLElement, heightPx: number | null): void {
		if (heightPx === null) {
			if (section.style.maxHeight) {
				section.style.removeProperty('max-height');
			}
			return;
		}
		const nextValue = `${Math.max(0, Math.floor(heightPx))}px`;
		if (section.style.maxHeight === nextValue) return;
		section.style.maxHeight = nextValue;
	}

	private renderMiniMonth(container: HTMLElement, state: CalendarLeafState, preset: CalendarPreset): void {
		const monthCard = container.createDiv('operon-calendar-sidebar-month');
		const anchorDate = state.anchorDate;
		const anchorDateObject = this.parseDateKey(anchorDate) ?? this.parseDateKey(localToday()) ?? new Date();
		monthCard.createDiv({
			text: new Intl.DateTimeFormat(getAppLocale(this.app), {
				month: 'long',
				year: 'numeric',
			}).format(anchorDateObject),
			cls: 'operon-calendar-sidebar-month-title',
		});
		const navRow = monthCard.createDiv('operon-calendar-sidebar-month-nav');
		const shiftAnchorMonth = (delta: number): void => {
			const base = this.parseDateKey(this.ensureState().anchorDate) ?? this.parseDateKey(localToday()) ?? new Date();
			const year = base.getFullYear();
			const month = base.getMonth();
			const day = base.getDate();
			const targetMonthBase = new Date(year, month + delta, 1, 12, 0, 0, 0);
			const targetMonthLastDay = new Date(targetMonthBase.getFullYear(), targetMonthBase.getMonth() + 1, 0).getDate();
			const nextAnchor = new Date(targetMonthBase.getFullYear(), targetMonthBase.getMonth(), Math.min(day, targetMonthLastDay), 12, 0, 0, 0);
			void this.updateLeafState({
				...this.ensureState(),
				anchorDate: this.formatDateKey(nextAnchor),
			});
		};
		this.createToolbarIconButton(
			navRow,
			['step-back'],
			() => shiftAnchorMonth(-1),
			t('calendar', 'previousMonth'),
			t('calendar', 'previousMonth'),
			'operon-calendar-sidebar-month-nav-button',
		);
		this.createToolbarButton(
			navRow,
			this.formatFocusedDateButtonLabel(state.anchorDate),
			() => {
				void this.handleTodayButtonClick(state, preset);
			},
			undefined,
			'operon-calendar-sidebar-month-nav-today',
		);
		this.createToolbarIconButton(
			navRow,
			['step-forward'],
			() => shiftAnchorMonth(1),
			t('calendar', 'nextMonth'),
			t('calendar', 'nextMonth'),
			'operon-calendar-sidebar-month-nav-button',
		);

		const settings = this.getSettings();
		const showWeekNumbers = settings.calendarSidebarShowWeekNumbers;
		const weekdayRow = monthCard.createDiv('operon-calendar-sidebar-month-weekdays');
		weekdayRow.classList.toggle('has-week-numbers', showWeekNumbers);
		if (showWeekNumbers) {
			weekdayRow.createDiv({
				text: 'W',
				cls: 'operon-calendar-sidebar-month-weeknum-header',
			});
		}
		const weekdayFormatter = new Intl.DateTimeFormat(getAppLocale(this.app), { weekday: 'short' });
		const weekdayOrder = settings.calendarWeekStart === 'sunday'
			? [0, 1, 2, 3, 4, 5, 6]
			: [1, 2, 3, 4, 5, 6, 0];
		for (const weekdayIndex of weekdayOrder) {
			const weekdayDate = new Date(2026, 2, 1 + weekdayIndex);
			const weekdayLabel = weekdayFormatter.format(weekdayDate).replace('.', '');
			const normalizedWeekdayLabel = weekdayLabel
				? weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1).toLowerCase()
				: weekdayLabel;
			const weekdayEl = weekdayRow.createDiv({
				text: normalizedWeekdayLabel,
				cls: 'operon-calendar-sidebar-month-weekday',
			});
			weekdayEl.classList.toggle('is-weekend', weekdayIndex === 0 || weekdayIndex === 6);
		}

		const grid = monthCard.createDiv('operon-calendar-sidebar-month-grid');
		grid.classList.toggle('has-week-numbers', showWeekNumbers);
		const monthStart = new Date(anchorDateObject.getFullYear(), anchorDateObject.getMonth(), 1, 12, 0, 0, 0);
		const monthStartWeekday = monthStart.getDay();
		const weekStartOffset = settings.calendarWeekStart === 'sunday'
			? monthStartWeekday
			: (monthStartWeekday + 6) % 7;
		const gridStart = new Date(monthStart);
		gridStart.setDate(gridStart.getDate() - weekStartOffset);
		const today = localToday();

		for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
				const weekStartDate = new Date(gridStart);
				weekStartDate.setDate(gridStart.getDate() + weekIndex * 7);
				if (showWeekNumbers) {
					grid.createDiv({
						text: String(this.getCalendarWeekNumber(weekStartDate, settings.calendarWeekStart)),
						cls: 'operon-calendar-sidebar-month-weeknum',
					});
			}
			for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
				const current = new Date(weekStartDate);
				current.setDate(weekStartDate.getDate() + dayOffset);
				const dateKey = this.formatDateKey(current);
				const button = grid.createEl('button', {
					text: String(current.getDate()),
					cls: 'operon-calendar-sidebar-month-day',
					attr: { type: 'button' },
				});
				button.classList.toggle('is-weekend', current.getDay() === 0 || current.getDay() === 6);
				button.classList.toggle('is-outside-month', current.getMonth() !== anchorDateObject.getMonth());
				button.classList.toggle('is-anchor', dateKey === anchorDate);
				button.classList.toggle('is-today', dateKey === today);
				button.addEventListener('click', () => {
					void this.updateLeafState({
						...this.ensureState(),
						anchorDate: dateKey,
					});
				});
			}
		}
	}

	private getCalendarWeekNumber(date: Date, weekStart: 'monday' | 'sunday'): number {
		if (weekStart === 'monday') {
			const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
			const day = current.getUTCDay() || 7;
			current.setUTCDate(current.getUTCDate() + 4 - day);
			const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
			return Math.ceil((((current.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
		}
		const current = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
		const yearStart = new Date(current.getFullYear(), 0, 1, 12, 0, 0, 0);
		const offset = yearStart.getDay();
		const firstWeekStart = new Date(yearStart);
		firstWeekStart.setDate(yearStart.getDate() - offset);
		return Math.floor((current.getTime() - firstWeekStart.getTime()) / (7 * 86400000)) + 1;
	}

	private renderWeekLabelForDayHeader(container: HTMLElement, dateKey: string): void {
		const settings = this.getSettings();
		if (!settings.calendarShowWeekLabelOnFirstDay) return;
		const date = this.parseDateKey(dateKey);
		if (!date || !this.isCalendarWeekStartDate(date, settings.calendarWeekStart)) return;
		container.createDiv({
			text: `W${this.getCalendarWeekNumber(date, settings.calendarWeekStart)}`,
			cls: 'operon-calendar-day-header-week-label',
		});
	}

	private isCalendarWeekStartDate(date: Date, weekStart: 'monday' | 'sunday'): boolean {
		return weekStart === 'sunday' ? date.getDay() === 0 : date.getDay() === 1;
	}

	private createCalendarDragGhost(sourceEl: HTMLElement, extraClass: string): HTMLElement {
		const ghost = sourceEl.cloneNode(true) as HTMLElement;
		ghost.classList.remove('is-dragging', 'operon-calendar-drag-source-hidden');
		ghost.classList.add('operon-calendar-drag-ghost', extraClass);
		ghost.style.width = `${Math.ceil(sourceEl.getBoundingClientRect().width)}px`;
		getOwnerBody(sourceEl).appendChild(ghost);
		this.calendarDragGhosts.add(ghost);
		return ghost;
	}

		private removeCalendarDragGhost(ghostEl: HTMLElement | null | undefined): void {
			if (!ghostEl) return;
			ghostEl.remove();
			this.calendarDragGhosts.delete(ghostEl);
		}

		private clearCalendarDragGhosts(): void {
			for (const ghostEl of Array.from(this.calendarDragGhosts)) {
				ghostEl.remove();
			}
			this.calendarDragGhosts.clear();
		}

		private updateCalendarDragGhostPosition(ghostEl: HTMLElement | null, clientX: number, clientY: number): void {
			if (!ghostEl) return;
			ghostEl.style.left = `${Math.round(clientX + 14)}px`;
		ghostEl.style.top = `${Math.round(clientY + 14)}px`;
	}

	private bindCalendarCellQuickAdd(
		cell: HTMLElement,
		dateKey: string,
		onChoose: () => void,
	): void {
		if (!this.callbacks.onAllDaySlotSelection) return;
		const overlay = cell.createDiv('operon-calendar-cell-add-overlay');
		const button = overlay.createEl('button', {
				cls: 'operon-calendar-cell-add-button',
					attr: {
						type: 'button',
					},
				});
			setIcon(button, 'list-plus');
			if (!button.querySelector('svg')) {
				setIcon(button, 'list');
			}
			setAccessibleLabelWithoutTooltip(button, t('calendar', 'addTaskToDate', { date: dateKey }));
			button.addEventListener('pointerdown', event => {
				event.preventDefault();
			});
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			cell.classList.remove('is-add-hotspot-active');
			overlay.classList.remove('is-visible');
			onChoose();
		});

		let isVisible = false;
		const setVisible = (nextVisible: boolean): void => {
			if (isVisible === nextVisible) return;
			isVisible = nextVisible;
			cell.classList.toggle('is-add-hotspot-active', nextVisible);
			overlay.classList.toggle('is-visible', nextVisible);
		};

		const updateFromPointer = (event: PointerEvent): void => {
			const rect = cell.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				setVisible(false);
				return;
			}
			const xRatio = (event.clientX - rect.left) / rect.width;
			const yRatio = (event.clientY - rect.top) / rect.height;
			const isWithinCenter = xRatio >= 0.34 && xRatio <= 0.66
				&& yRatio >= 0.30 && yRatio <= 0.70;
			setVisible(isWithinCenter);
		};

		cell.addEventListener('pointermove', updateFromPointer);
		cell.addEventListener('pointerleave', () => setVisible(false));
		cell.addEventListener('scroll', () => setVisible(false));
			cell.addEventListener('drop', () => setVisible(false));
			cell.addEventListener('dragstart', () => setVisible(false));
		}

		private formatSidebarDateLabel(dateKey: string): string {
			const date = this.parseDateKey(dateKey);
			if (!date) return dateKey;
			return new Intl.DateTimeFormat(getAppLocale(this.app), {
				month: 'short',
				day: 'numeric',
			}).format(date);
		}

		private renderSidebarTaskPool(
			container: HTMLElement,
			preset: CalendarPreset,
			visibleDates: string[],
		): void {
			const section = container.createDiv('operon-calendar-sidebar-section operon-calendar-sidebar-task-pool-section operon-calendar-sidebar-managed-section');
			section.classList.toggle('is-open', this.ensureState().taskPoolOpen);
			const toggleButton = section.createEl('button', {
				cls: 'operon-calendar-sidebar-task-pool-toggle',
				attr: { type: 'button', 'aria-expanded': String(this.ensureState().taskPoolOpen) },
			});
			toggleButton.createSpan({ text: t('calendar', 'taskPool') });
			const toggleIcon = toggleButton.createSpan('operon-calendar-sidebar-task-pool-toggle-icon');
			setIcon(toggleIcon, this.ensureState().taskPoolOpen ? 'chevron-down' : 'chevron-right');
			toggleButton.addEventListener('click', () => {
				void this.toggleSidebarSection('taskPool');
			});

			if (!this.ensureState().taskPoolOpen) return;
			const taskPoolMode = this.ensureState().taskPoolMode;

			const modeRow = section.createDiv('operon-calendar-sidebar-task-pool-modes');
			const createModeButton = (
				mode: CalendarSidebarTaskPoolMode,
				label: string,
			): void => {
				const button = modeRow.createEl('button', {
					text: label,
					cls: 'operon-calendar-sidebar-task-pool-mode-button',
					attr: { type: 'button', 'aria-pressed': String(taskPoolMode === mode) },
				});
				button.classList.toggle('is-active', taskPoolMode === mode);
				button.addEventListener('click', () => {
					if (this.ensureState().taskPoolMode === mode) return;
					void this.updateLeafState({
						...this.ensureState(),
						taskPoolMode: mode,
					});
				});
			};
			createModeButton('overdue', t('calendar', 'overdue'));
			createModeButton('unscheduled', t('calendar', 'unscheduled'));
			createModeButton('all', t('calendar', 'all'));
			createModeButton('finished', t('calendar', 'finished'));

			const controls = section.createDiv('operon-calendar-sidebar-task-pool-controls');
			const searchWrap = controls.createDiv('operon-calendar-sidebar-task-pool-search-wrap');
			const searchInput = searchWrap.createEl('input', {
				cls: 'operon-calendar-sidebar-task-pool-search',
				attr: {
					type: 'search',
					spellcheck: 'false',
				},
			});
			searchInput.value = this.taskPoolQuery;
			const clearSearchButton = searchWrap.createEl('button', {
				cls: 'operon-calendar-sidebar-task-pool-search-clear',
				text: '×',
				attr: {
					type: 'button',
				},
			});
			setAccessibleLabelWithoutTooltip(clearSearchButton, t('tooltips', 'clearSearch'));

			const getSearchLabel = (): string => taskPoolMode === 'overdue'
				? t('calendar', 'searchOverdueTasks')
				: taskPoolMode === 'all'
					? t('calendar', 'searchAllTasks')
					: taskPoolMode === 'finished'
						? t('calendar', 'searchFinishedTasks')
						: t('calendar', 'searchUnscheduledTasks');
			const updateSearchPlaceholder = (): void => {
				const searchLabel = getSearchLabel();
				searchInput.placeholder = searchLabel;
				setAccessibleLabelWithoutTooltip(searchInput, searchLabel);
			};
			const updateSearchState = (): void => {
				const hasQuery = !!this.taskPoolQuery.trim();
				searchWrap.classList.toggle('has-search-query', hasQuery);
				searchWrap.classList.toggle('has-value', hasQuery);
				clearSearchButton.disabled = !hasQuery;
				clearSearchButton.tabIndex = hasQuery ? 0 : -1;
			};

			const list = section.createDiv('operon-calendar-sidebar-task-pool-list operon-calendar-sidebar-section-scroll');
			const summary = section.createDiv('operon-calendar-sidebar-task-pool-summary');
			const updateList = (): void => {
				list.empty();
				const state = this.ensureState();
				const currentTaskPoolMode = state.taskPoolMode;
				const candidates = collectCalendarSidebarTaskPoolCandidates(this.getOptimisticCalendarTasksForRender(), currentTaskPoolMode, {
					finishedDate: state.anchorDate,
				});
				const query = this.taskPoolQuery.trim();
				const allMatches = !query
					? candidates
					: this.rankSidebarTaskPoolMatches(candidates, query);
				const visibleLimit = this.getSidebarTaskPoolVisibleLimit(query);
				const visibleMatches = allMatches.slice(0, visibleLimit);
				const modeLabel = currentTaskPoolMode === 'overdue'
					? t('calendar', 'overdue')
					: currentTaskPoolMode === 'all'
						? t('calendar', 'open')
						: currentTaskPoolMode === 'finished'
							? t('calendar', 'finished')
							: t('calendar', 'unscheduled');
				const summaryText = currentTaskPoolMode === 'finished'
					? t('calendar', 'taskPoolFinishedSummary', {
						visible: String(visibleMatches.length),
						total: String(allMatches.length),
						date: this.formatSidebarDateLabel(state.anchorDate),
						taskWord: this.getCalendarTaskWord(allMatches.length),
					})
					: t('calendar', 'taskPoolSummary', {
						visible: String(visibleMatches.length),
						total: String(allMatches.length),
						mode: modeLabel,
						taskWord: this.getCalendarTaskWord(allMatches.length),
					});
				summary.setText(summaryText);
				if (visibleMatches.length === 0) {
					list.createDiv({
						text: query
							? t('calendar', 'noSearchMatches')
							: currentTaskPoolMode === 'finished'
								? t('calendar', 'noFinishedTasksForDay')
								: t('calendar', 'noOpenTasksForList'),
						cls: 'operon-calendar-sidebar-task-pool-empty',
					});
					this.scheduleSidebarSectionLayoutRefresh(container);
					return;
				}
				for (const task of visibleMatches) {
					const row = list.createDiv('operon-calendar-sidebar-task-pool-row');
					this.renderSidebarTaskPoolRow(row, task, preset, visibleDates, currentTaskPoolMode === 'finished' ? 'finished' : 'pool');
				}
				this.scheduleSidebarSectionLayoutRefresh(container);
			};

			searchInput.addEventListener('input', () => {
				this.taskPoolQuery = searchInput.value;
				updateSearchState();
				updateList();
			});
			clearSearchButton.addEventListener('pointerdown', event => {
				event.preventDefault();
			});
			clearSearchButton.addEventListener('click', () => {
				if (!this.taskPoolQuery) return;
				this.taskPoolQuery = '';
				searchInput.value = '';
				updateSearchState();
				updateList();
				searchInput.focus({ preventScroll: true });
			});

			updateSearchPlaceholder();
			updateSearchState();
			updateList();
		}

		private rankSidebarTaskPoolMatches(tasks: IndexedTask[], query: string): IndexedTask[] {
		const normalizedQuery = query.trim().toLowerCase();
		const fuzzySearch = prepareFuzzySearch(query.trim());
		return tasks
			.map((task, index) => {
				const containsRank = this.getSidebarTaskPoolContainsRank(task, normalizedQuery);
				const descriptionFuzzyMatch = fuzzySearch(task.description || '');
				const globalFuzzyMatch = fuzzySearch(buildCalendarSidebarTaskPoolSearchText(task));
				if (containsRank === null && !descriptionFuzzyMatch && !globalFuzzyMatch) return null;
				return {
					task,
					containsRank,
					descriptionFuzzyScore: descriptionFuzzyMatch?.score ?? Number.POSITIVE_INFINITY,
					globalFuzzyScore: globalFuzzyMatch?.score ?? Number.POSITIVE_INFINITY,
					sortRank: index,
				};
			})
			.filter((entry): entry is {
				task: IndexedTask;
				containsRank: number | null;
				descriptionFuzzyScore: number;
				globalFuzzyScore: number;
				sortRank: number;
			} => !!entry)
			.sort((left, right) => {
				const leftTier = left.containsRank ?? 100;
				const rightTier = right.containsRank ?? 100;
				if (leftTier !== rightTier) return leftTier - rightTier;
				if (left.descriptionFuzzyScore !== right.descriptionFuzzyScore) {
					return left.descriptionFuzzyScore - right.descriptionFuzzyScore;
				}
				if (left.globalFuzzyScore !== right.globalFuzzyScore) {
					return left.globalFuzzyScore - right.globalFuzzyScore;
				}
				return left.sortRank - right.sortRank;
			})
			.map(entry => entry.task);
	}

	private getCalendarTaskWord(count: number): string {
		return count === 1
			? t('calendar', 'taskSingular')
			: t('calendar', 'taskPlural');
	}

	private getSidebarTaskPoolContainsRank(task: IndexedTask, query: string): number | null {
		if (!query) return 0;
		const description = (task.description || '').toLowerCase();
		if (description.startsWith(query)) return 0;
		if (description.includes(query)) return 1;
		const containsFields = [
			task.tags.join(' ').toLowerCase(),
			(task.fieldValues['contexts'] ?? '').toLowerCase(),
			(task.fieldValues['related'] ?? '').toLowerCase(),
			(task.fieldValues['note'] ?? '').toLowerCase(),
		];
		return containsFields.some(value => value.includes(query)) ? 2 : null;
	}

		private renderSidebarTaskPoolRow(
			container: HTMLElement,
			task: IndexedTask,
			preset: CalendarPreset,
			visibleDates: string[],
			mode: 'pool' | 'finished' = 'pool',
		): void {
			container.dataset.operonId = task.operonId;
			this.applyCalendarCheckboxClass(container, task.checkbox);
			const priorityColor = this.resolveSidebarTaskPoolPriorityColor(task, this.getSettings());
			if (priorityColor) {
				container.style.setProperty('--operon-calendar-accent', priorityColor);
			} else {
			container.style.removeProperty('--operon-calendar-accent');
		}
		container.tabIndex = 0;
		const head = container.createDiv('operon-calendar-sidebar-task-pool-row-head');
		const hoverTrigger = head.createSpan('operon-calendar-hover-menu-trigger');
		this.renderSidebarTaskPoolStatusButton(hoverTrigger, task);

		const titleText = task.description || task.operonId;
		const title = head.createSpan({
			cls: 'operon-calendar-sidebar-task-pool-row-title',
		});
		const renderedWikilinks = renderTaskDescriptionWikilinks(title, {
			app: this.app,
			description: titleText,
			sourcePath: task.primary.filePath,
		});
		if (!renderedWikilinks) {
			title.textContent = titleText;
		}
		if (!renderedWikilinks && task.primary.format === 'yaml') {
			bindTaskTitleLinkPreview(this.app, title, task.primary.filePath, task.primary.filePath);
		}

		this.renderSidebarTaskPoolDateIndicators(head, task, mode);

		this.bindSidebarTaskPoolHoverMenuTarget(hoverTrigger, task);
		this.bindSidebarTaskPoolRowDrag(container, task, preset, visibleDates);
		container.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			void this.callbacks.onItemAction?.(task.operonId, 'openEditor');
		});
	}

	private resolveSidebarTaskPoolPriorityColor(task: IndexedTask, settings: OperonSettings): string | null {
		const priorityLabel = (task.fieldValues['priority'] ?? '').trim();
		if (!priorityLabel) return null;
		return settings.priorities.find(priority => priority.label === priorityLabel)?.color?.trim() || null;
	}

	private renderSidebarTaskPoolDateIndicators(
		container: HTMLElement,
		task: IndexedTask,
		mode: 'pool' | 'finished' = 'pool',
	): void {
		if (mode === 'finished') {
			const durationSecs = parseInt(task.fieldValues['duration'] ?? '0', 10);
			const totalDurationSecs = parseInt(task.fieldValues['totalDuration'] ?? '0', 10);
			const noteValue = (task.fieldValues['note'] ?? '').trim();
			if (!durationSecs && !totalDurationSecs && !noteValue) return;
			const meta = container.createSpan('operon-calendar-sidebar-task-pool-meta');
			if (durationSecs > 0) {
				this.renderSidebarTaskPoolDurationIndicator(meta, 'duration', durationSecs);
			}
			if (totalDurationSecs > 0) {
				this.renderSidebarTaskPoolDurationIndicator(meta, 'totalDuration', totalDurationSecs);
			}
			if (noteValue) {
				this.renderSidebarTaskPoolNoteIndicator(meta, noteValue);
			}
			return;
		}
		const scheduled = (task.fieldValues['dateScheduled'] ?? '').trim();
		const due = (task.fieldValues['dateDue'] ?? '').trim();
		const noteValue = (task.fieldValues['note'] ?? '').trim();
		if (!scheduled && !due && !noteValue) return;

		const meta = container.createSpan('operon-calendar-sidebar-task-pool-meta');
		if (scheduled) {
			this.renderSidebarTaskPoolDateIndicator(meta, 'dateScheduled', scheduled);
		}
		if (due) {
			this.renderSidebarTaskPoolDateIndicator(meta, 'dateDue', due);
		}
		if (noteValue) {
			this.renderSidebarTaskPoolNoteIndicator(meta, noteValue);
		}
	}

	private renderSidebarTaskPoolDateIndicator(
		container: HTMLElement,
		fieldKey: 'dateScheduled' | 'dateDue' | 'dateCompleted',
		fieldValue: string,
	): void {
		const settings = this.getSettings();
		const label = settings.keyMappings.find(mapping => mapping.canonicalKey === fieldKey)?.visiblePropertyName?.trim() || fieldKey;
		const iconName = getConfiguredKeyMappingIcon(fieldKey, settings.keyMappings) || INLINE_TASK_COMPACT_FALLBACK_ICONS[fieldKey];
		const indicator = container.createSpan('operon-calendar-sidebar-task-pool-date-indicator');
		bindOperonHoverTooltip(indicator, {
			content: `${label} ${fieldValue}`,
			taskColor: null,
		});
		if (iconName) {
			setIcon(indicator, iconName);
		}
		setAccessibleLabelWithoutTooltip(indicator, `${label} ${fieldValue}`);
	}

	private renderSidebarTaskPoolDurationIndicator(
		container: HTMLElement,
		fieldKey: 'duration' | 'totalDuration',
		seconds: number,
	): void {
		const settings = this.getSettings();
		const label = settings.keyMappings.find(mapping => mapping.canonicalKey === fieldKey)?.visiblePropertyName?.trim() || fieldKey;
		const iconName = getConfiguredKeyMappingIcon(fieldKey, settings.keyMappings) || INLINE_TASK_COMPACT_FALLBACK_ICONS[fieldKey];
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const formatted = h > 0 ? `${h}h ${m}m` : `${m}m`;
		const indicator = container.createSpan('operon-calendar-sidebar-task-pool-date-indicator');
		bindOperonHoverTooltip(indicator, {
			content: `${label} ${formatted}`,
			taskColor: null,
		});
		if (iconName) {
			setIcon(indicator, iconName);
		}
		setAccessibleLabelWithoutTooltip(indicator, `${label} ${formatted}`);
	}

	private renderSidebarTaskPoolNoteIndicator(container: HTMLElement, noteValue: string): void {
		const settings = this.getSettings();
		const indicator = container.createSpan('operon-calendar-sidebar-task-pool-date-indicator');
		bindOperonHoverTooltip(indicator, {
			title: t('calendar', 'notes'),
			content: noteValue,
			taskColor: null,
			preferredHorizontal: 'right',
		});
		setIcon(indicator, getConfiguredKeyMappingIcon('note', settings.keyMappings) || 'notebook-pen');
		setAccessibleLabelWithoutTooltip(indicator, t('calendar', 'notes'));
	}

	private bindSidebarTaskPoolHoverMenuTarget(triggerEl: HTMLElement, task: IndexedTask): void {
		if (!this.callbacks.onItemAction) return;
		bindContextualHoverMenuTrigger({
			controller: this.hoverMenu,
			triggerEl,
			menuKey: task.operonId,
			getSettings: () => this.getSettings(),
			openMenu: ({ mobile }) => {
				const context: ContextualMenuContext = {
					surface: 'calendarSidebarTaskPoolTask',
					taskId: task.operonId,
					task,
					now: localNow(),
					isPinned: this.getPinnedCache()?.isPinned(task.operonId) ?? false,
					hasSubtasks: this.indexer.secondary.getChildIds(task.operonId).size > 0,
				};
				const settings = this.getSettings();
				const actions = resolveContextualMenu(
					context,
					settings.contextualMenuActionAllowlist,
					settings.contextualMenuSurfaceActionMatrix,
				);
				return this.showHoverMenuForActions(triggerEl, task.operonId, actions, undefined, context, mobile);
			},
		});
	}

		private renderSidebarTaskPoolStatusButton(container: HTMLElement, task: IndexedTask): void {
			if (!this.callbacks.onStatusIconClick) return;
			const button = container.createEl('button', {
				cls: 'operon-checkbox operon-calendar-status-button is-compact operon-calendar-sidebar-task-pool-status',
					attr: {
						type: 'button',
						},
					});
			button.dataset.operonId = task.operonId;
			const settings = this.getSettings();
			const iconName = this.resolveStatusButtonIcon(task.fieldValues, task.checkbox, settings);
				if (iconName) {
					setIcon(button, iconName);
				}
				setAccessibleLabelWithoutTooltip(button, t('tooltips', 'cycleTaskStatus'));
			const statusColor = this.resolveCalendarStatusColorFromFieldValues(task.fieldValues, settings);
			if (statusColor) {
				button.style.color = statusColor;
			}
			button.addEventListener('pointerdown', event => {
				event.preventDefault();
			});
			button.addEventListener('click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.invokeCalendarStatusClickCallback(task.operonId, 'status-sidebar');
			});
		}

	private bindSidebarTaskPoolRowDrag(
		row: HTMLElement,
		task: IndexedTask,
		preset: CalendarPreset,
		visibleDates: string[],
	): void {
		const dragThresholdPx = 6;
		let dragState: {
			pointerId: number;
			initialClientX: number;
			initialClientY: number;
			activated: boolean;
			dropTarget: 'none' | 'timed' | 'allDay';
			timedSelection: CalendarSlotSelection | null;
			allDaySelection: CalendarSlotSelection | null;
			timedPreviewEl: HTMLElement | null;
			allDayPreviewEl: HTMLElement | null;
			dragGhostEl: HTMLElement | null;
		} | null = null;

		const clearPreviews = (): void => {
			dragState?.timedPreviewEl?.remove();
			dragState?.allDayPreviewEl?.remove();
			if (this.timedDropContext) {
				this.timedDropContext.hoverGuideOverlay.empty();
			}
			if (dragState) {
				dragState.timedPreviewEl = null;
				dragState.allDayPreviewEl = null;
			}
		};

		const clearDragArtifacts = (): void => {
			clearPreviews();
			this.removeCalendarDragGhost(dragState?.dragGhostEl);
			if (dragState) {
				dragState.dragGhostEl = null;
			}
		};

		const hasThreshold = (clientX: number, clientY: number): boolean => {
			if (!dragState) return false;
			return Math.hypot(clientX - dragState.initialClientX, clientY - dragState.initialClientY) >= dragThresholdPx;
		};

		const updateFromPointer = (clientX: number, clientY: number): void => {
			if (!dragState) return;
			if (!dragState.activated) {
				if (!hasThreshold(clientX, clientY)) return;
				dragState.activated = true;
				row.addClass('is-dragging');
				dragState.dragGhostEl = this.createCalendarDragGhost(row, 'operon-calendar-sidebar-task-pool-drag-ghost');
			}
			this.updateCalendarDragGhostPosition(dragState.dragGhostEl, clientX, clientY);

			dragState.dropTarget = 'none';
			dragState.timedSelection = null;
			dragState.allDaySelection = null;
			clearPreviews();

			if (this.allDayDropContext) {
				const allDayRect = this.allDayDropContext.body.getBoundingClientRect();
				const insideAllDay = clientX >= allDayRect.left
					&& clientX <= allDayRect.right
					&& clientY >= allDayRect.top
					&& clientY <= allDayRect.bottom;
					if (insideAllDay) {
					const column = this.resolveAllDayColumnIndex(this.allDayDropContext.body, clientX, this.allDayDropContext.visibleDates.length);
					const dateKey = this.allDayDropContext.visibleDates[column];
					if (dateKey) {
						dragState.dropTarget = 'allDay';
						dragState.allDaySelection = buildAllDaySlotSelection(dateKey, dateKey);
						dragState.allDayPreviewEl = this.allDayDropContext.overlay.createDiv('operon-calendar-all-day-transfer-preview');
						this.applyAllDayPlacementStyle(
							dragState.allDayPreviewEl,
							column,
							column,
							this.allDayDropContext.previewLane,
							this.allDayDropContext.laneHeight,
							this.allDayDropContext.visibleDates.length,
						);
						return;
					}
				}
			}
			const multiWeekAllDayTarget = this.resolveMultiWeekAllDayDropTarget(clientX, clientY);
			if (multiWeekAllDayTarget) {
				dragState.dropTarget = 'allDay';
				dragState.allDaySelection = buildAllDaySlotSelection(multiWeekAllDayTarget.dateKey, multiWeekAllDayTarget.dateKey);
				dragState.allDayPreviewEl = multiWeekAllDayTarget.context.overlay.createDiv('operon-calendar-all-day-transfer-preview');
				this.applyAllDayPlacementStyle(
					dragState.allDayPreviewEl,
					multiWeekAllDayTarget.column,
					multiWeekAllDayTarget.column,
					multiWeekAllDayTarget.context.previewLane,
					multiWeekAllDayTarget.context.laneHeight,
					multiWeekAllDayTarget.context.visibleDates.length,
				);
				return;
			}

			if (this.timedDropContext) {
				const timedRect = this.timedDropContext.daysGrid.getBoundingClientRect();
				const insideTimed = clientX >= timedRect.left
					&& clientX <= timedRect.right
					&& clientY >= timedRect.top
					&& clientY <= timedRect.bottom;
				if (insideTimed) {
					const position = this.timedDropContext.resolvePosition?.(clientX, clientY) ?? this.resolveTimedGridPosition(
							this.timedDropContext.daysGrid,
							this.timedDropContext.visibleDates,
							this.timedDropContext.metrics,
							clientX,
							clientY,
						);
					if (!position) return;
					const duration = this.resolveIndexedTaskDurationMinutes(task, preset.slotMinutes);
					const dateKey = this.timedDropContext.visibleDates[position.dayIndex] ?? visibleDates[position.dayIndex] ?? localToday();
					const timedSelection = buildTimedSlotSelection(
						dateKey,
						position.minuteOfDay,
						Math.min(24 * 60, position.minuteOfDay + duration),
						CALENDAR_TIMED_SNAP_MINUTES,
					);
					const previewStart = this.extractMinuteOfDay(timedSelection.start);
					const previewEnd = Math.min(24 * 60, previewStart + duration);
					dragState.dropTarget = 'timed';
					dragState.timedSelection = timedSelection;
					dragState.timedPreviewEl = (this.timedDropContext.previewOverlay ?? this.timedDropContext.daysGrid).createDiv('operon-calendar-timed-transfer-preview');
					if (this.timedDropContext.applyTransferPreviewStyle) {
						this.timedDropContext.applyTransferPreviewStyle(dragState.timedPreviewEl, position.dayIndex, previewStart, previewEnd);
					} else {
						this.applyTimedPlacementStyle(
							dragState.timedPreviewEl,
							position.dayIndex,
							0,
							1,
							previewStart,
							previewEnd,
							this.timedDropContext.visibleDates.length,
							this.timedDropContext.metrics,
						);
					}
					this.renderTimedSelectionGuides(
						this.timedDropContext.section,
						this.timedDropContext.gutter,
						this.timedDropContext.daysGrid,
						this.timedDropContext.hoverGuideOverlay,
						dateKey,
						previewStart,
						previewEnd,
						this.timedDropContext.metrics,
						'var(--interactive-accent)',
						this.timedDropContext.settings,
						position.dayIndex,
						this.timedDropContext.visibleDates.length,
					);
				}
			}
			const multiWeekInDayTarget = this.resolveMultiWeekInDayDropTarget(clientX, clientY);
			if (multiWeekInDayTarget) {
				const duration = this.resolveIndexedTaskDurationMinutes(task, preset.slotMinutes);
				const rawStart = (task.fieldValues['datetimeStart'] ?? '').trim();
				const startMinute = rawStart
					? this.extractMinuteOfDay(rawStart)
					: this.getSettings().calendarDefaultScrollHour * 60;
				const timedSelection = buildTimedSlotSelection(
					multiWeekInDayTarget.dateKey,
					startMinute,
					Math.min(24 * 60, startMinute + duration),
					CALENDAR_TIMED_SNAP_MINUTES,
				);
				dragState.dropTarget = 'timed';
				dragState.timedSelection = timedSelection;
				return;
			}
		};

		row.addEventListener('pointerdown', event => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, row);
			if (target?.closest('.operon-calendar-sidebar-task-pool-status, a.internal-link')) return;
			this.hideCalendarHoverMenu(true);
			dragState = {
				pointerId: event.pointerId,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				activated: false,
				dropTarget: 'none',
				timedSelection: null,
				allDaySelection: null,
				timedPreviewEl: null,
				allDayPreviewEl: null,
				dragGhostEl: null,
			};
			this.beginCalendarDragSession(row, event.pointerId, finishDrag);
			row.setPointerCapture?.(event.pointerId);
		});

		row.addEventListener('pointermove', event => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			updateFromPointer(event.clientX, event.clientY);
		});

		const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
			if (!dragState) return;
			const pointerId = dragState.pointerId;
			if (event && pointerId !== event.pointerId) return;
			if (event) {
				updateFromPointer(event.clientX, event.clientY);
			}
			const wasActivated = dragState.activated;
			const dropTarget = dragState.dropTarget;
			const timedSelection = dragState.timedSelection;
			const allDaySelection = dragState.allDaySelection;
			this.releaseCalendarPointerCapture(row, pointerId);
			row.removeClass('is-dragging');
			clearDragArtifacts();
			dragState = null;
			if (reason !== 'commit') return;
			if (!wasActivated) {
				void this.callbacks.onItemAction?.(task.operonId, 'openEditor');
				return;
			}
			if (dropTarget === 'timed' && timedSelection) {
				const writebackPlan = buildTimedCalendarWritebackPlanForExistingCalendarAssignment(timedSelection, task.fieldValues);
				this.invokeCalendarDropCallback(
					task.operonId,
					writebackPlan.payload,
					() => this.callbacks.onSidebarTaskDropToTimed?.(task.operonId, timedSelection),
				);
				return;
			}
			if (dropTarget === 'allDay' && allDaySelection) {
				this.invokeCalendarDropCallback(
					task.operonId,
					buildAllDayCalendarWritebackPlan(allDaySelection).payload,
					() => this.callbacks.onSidebarTaskDropToAllDay?.(task.operonId, allDaySelection),
				);
			}
		};

		row.addEventListener('pointerup', event => this.finishActiveCalendarDragSession('commit', event));
		row.addEventListener('pointercancel', event => this.finishActiveCalendarDragSession('cancel', event));
	}

	private resolveSidebarWidthPx(): number {
		const base = this.sidebarWidthOverridePx ?? this.getSettings().calendarSidebarWidthPx;
		return Math.max(240, Math.min(720, Math.round(base || 320)));
	}

	private bindSidebarResizeHandle(handle: HTMLElement, layout: HTMLElement): void {
		handle.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			this.clearSidebarResizeDrag();
			const updateWidth = (clientX: number): number => {
				const rect = layout.getBoundingClientRect();
				const nextWidth = Math.max(240, Math.min(720, Math.round(clientX - rect.left)));
				this.sidebarWidthOverridePx = nextWidth;
				layout.style.setProperty('--operon-calendar-sidebar-width', `${nextWidth}px`);
				return nextWidth;
			};
			let lastWidth = updateWidth(event.clientX);
			const ownerWindow = getOwnerWindow(layout);
			const ownerBody = getOwnerBody(layout);
			ownerBody.classList.add('operon-calendar-sidebar-is-resizing');
			const onPointerMove = (moveEvent: PointerEvent): void => {
				lastWidth = updateWidth(moveEvent.clientX);
			};
			const finalize = (doneEvent?: PointerEvent): void => {
				if (doneEvent) {
					lastWidth = updateWidth(doneEvent.clientX);
				}
				this.clearSidebarResizeDrag();
				const persistedWidth = Math.max(240, Math.min(720, Math.round(lastWidth)));
				this.sidebarWidthOverridePx = null;
				void this.callbacks.onSidebarWidthChange?.(persistedWidth);
			};
			const onPointerUp = (upEvent: PointerEvent): void => finalize(upEvent);
			const onPointerCancel = (): void => finalize();
			ownerWindow.addEventListener('pointermove', onPointerMove);
			ownerWindow.addEventListener('pointerup', onPointerUp, { once: true });
			ownerWindow.addEventListener('pointercancel', onPointerCancel, { once: true });
			this.sidebarResizeCleanup = () => {
				ownerWindow.removeEventListener('pointermove', onPointerMove);
				ownerWindow.removeEventListener('pointerup', onPointerUp);
				ownerWindow.removeEventListener('pointercancel', onPointerCancel);
				ownerBody.classList.remove('operon-calendar-sidebar-is-resizing');
				this.sidebarResizeCleanup = null;
			};
		});
	}

	private clearSidebarResizeDrag(): void {
		this.sidebarResizeCleanup?.();
	}

	private renderToolbar(
		container: HTMLElement,
		state: CalendarLeafState,
		preset: CalendarPreset,
		visibleDates: string[],
	): void {
		const toolbar = container.createDiv('operon-calendar-toolbar');
		const titleGroup = toolbar.createDiv('operon-calendar-toolbar-start');
		const navGroup = toolbar.createDiv('operon-calendar-toolbar-center');
		const controlsGroup = toolbar.createDiv('operon-calendar-toolbar-end');

		this.createToolbarIconButton(
			titleGroup,
			['panel-left'],
			() => {
				void this.updateLeafState({
					...state,
					navigationMode: 'sidebar',
				});
			},
				t('calendar', 'toggleToSidebar'),
				t('calendar', 'toggleToSidebar'),
				'operon-calendar-toolbar-toggle-button',
			);

		const titleBlock = titleGroup.createDiv('operon-calendar-toolbar-title');
		bindOperonHoverTooltip(titleBlock, { content: this.formatRangeLabel(visibleDates), taskColor: null });
			titleBlock.createDiv({
				text: t('calendar', 'title'),
				cls: 'operon-calendar-toolbar-title-main',
			});

		const presetSpanDays = preset.surfaceType === 'multiWeek'
			? Math.max(7, Math.max(1, preset.weekCount || 2) * 7)
			: Math.max(1, preset.dayCount);
			this.createToolbarIconButton(navGroup, ['step-back', 'step-back'], () => {
				void this.shiftCalendarAnchorByDays(-presetSpanDays);
			}, t('calendar', 'previousSpan'), t('calendar', 'previousSpanTooltip'));
			this.createToolbarIconButton(navGroup, ['step-back'], () => {
				void this.shiftCalendarAnchorByDays(-1);
			}, t('calendar', 'previousDay'), t('calendar', 'previousDayTooltip'));
		this.createToolbarButton(navGroup, this.formatFocusedDateButtonLabel(state.anchorDate), () => {
			void this.handleTodayButtonClick(state, preset);
		});
			this.createToolbarIconButton(navGroup, ['step-forward'], () => {
				void this.shiftCalendarAnchorByDays(1);
			}, t('calendar', 'nextDay'), t('calendar', 'nextDayTooltip'));
			this.createToolbarIconButton(navGroup, ['step-forward', 'step-forward'], () => {
				void this.shiftCalendarAnchorByDays(presetSpanDays);
			}, t('calendar', 'nextSpan'), t('calendar', 'nextSpanTooltip'));

		const presetSelect = controlsGroup.createEl('select', { cls: 'operon-calendar-preset-select' });
		for (const entry of this.getSettings().calendarPresets) {
			const option = presetSelect.createEl('option', { text: entry.name });
			option.value = entry.id;
			option.selected = entry.id === preset.id;
		}
		presetSelect.addEventListener('change', () => {
			void this.updateLeafState({
				...state,
				presetId: presetSelect.value,
			});
		});
		this.renderCalendarQuickActions(controlsGroup, preset, 'toolbar');

		this.applyToolbarLayoutMode(toolbar, titleGroup, navGroup, controlsGroup);
	}

	private applyToolbarLayoutMode(
		toolbar: HTMLElement,
		titleGroup: HTMLElement,
		navGroup: HTMLElement,
		controlsGroup: HTMLElement,
	): void {
		const updateLayout = (): void => {
			const width = toolbar.clientWidth;
			if (width <= 0) return;
			const requiredWidth = this.measureToolbarGroupWidth(titleGroup)
				+ this.measureToolbarGroupWidth(navGroup)
				+ this.measureToolbarGroupWidth(controlsGroup)
				+ 20;
			toolbar.classList.toggle('is-compact', requiredWidth > width);
		};

		this.toolbarLayoutCleanup?.();
		this.toolbarLayoutCleanup = null;

		updateLayout();
		const generation = this.renderGeneration;
		this.requestRenderAnimationFrame(generation, updateLayout);
		this.requestRenderAnimationFrame(generation, () => this.requestRenderAnimationFrame(generation, updateLayout));
		this.setRenderTimeout(generation, updateLayout, 0);
		this.setRenderTimeout(generation, updateLayout, 120);

		const observer = new ResizeObserver(() => updateLayout());
		observer.observe(toolbar);
		observer.observe(titleGroup);
		observer.observe(navGroup);
		observer.observe(controlsGroup);
		this.toolbarLayoutCleanup = () => observer.disconnect();
	}

	private measureToolbarGroupWidth(group: HTMLElement): number {
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

	private createToolbarIconButton(
		container: HTMLElement,
		icons: string[],
		onClick: () => void,
		ariaLabel: string,
		title?: string,
		extraClass?: string,
	): HTMLButtonElement {
			const button = container.createEl('button', {
				cls: `operon-calendar-toolbar-button is-icon-only${extraClass ? ` ${extraClass}` : ''}`,
				attr: {
					type: 'button',
				},
			});
		for (const iconName of icons) {
			const iconWrap = button.createSpan({ cls: 'operon-calendar-toolbar-icon' });
				setIcon(iconWrap, iconName);
			}
			setAccessibleLabelWithoutTooltip(button, ariaLabel);
			if (title) bindOperonHoverTooltip(button, { content: title, taskColor: null });
		button.addEventListener('click', onClick);
		return button;
	}

	private renderDayHeaders(
		container: HTMLElement,
		visibleDates: string[],
		showAllDayLane: boolean,
		showDueMarkers: boolean,
	): void {
		const headerRow = container.createDiv('operon-calendar-day-header-row');
		const gutterSpacer = headerRow.createDiv('operon-calendar-gutter-spacer');
		if (!showAllDayLane || !showDueMarkers) {
			const hiddenStack = gutterSpacer.createDiv('operon-calendar-hidden-lane-toggle-stack');
			if (!showAllDayLane) {
				this.renderLaneToggleButton(hiddenStack, t('calendar', 'allDay'), false, () => {
					void this.updateLeafState({
						...this.ensureState(),
						showAllDayLane: true,
					});
				}, true);
			}
			if (!showDueMarkers) {
				this.renderLaneToggleButton(hiddenStack, t('calendar', 'due'), false, () => {
					void this.updateLeafState({
						...this.ensureState(),
						showDueMarkers: true,
					});
				}, true);
			}
		}

		const daysGrid = headerRow.createDiv('operon-calendar-day-header-grid');
		daysGrid.style.gridTemplateColumns = `repeat(${Math.max(1, visibleDates.length)}, minmax(0, 1fr))`;
		const opensDailyNote = this.getSettings().calendarDayTitleAction === 'create-open-daily-note';

		for (const dateKey of visibleDates) {
			const cell = daysGrid.createDiv('operon-calendar-day-header-cell');
			const dayDate = this.parseDateKey(dateKey);
			cell.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
			if (dateKey === localToday()) {
				cell.addClass('is-today');
			}
			if (opensDailyNote) {
				cell.addClass('is-clickable');
				cell.tabIndex = 0;
				cell.addEventListener('click', () => {
					void this.callbacks.onOpenDailyNote?.(dateKey);
				});
				cell.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					void this.callbacks.onOpenDailyNote?.(dateKey);
				});
			}
			const topLine = cell.createDiv('operon-calendar-day-header-topline');
			topLine.createDiv({
				text: this.formatWeekdayLabel(dateKey),
				cls: 'operon-calendar-day-header-weekday',
			});
			this.renderWeekLabelForDayHeader(topLine, dateKey);
			cell.createDiv({
				text: this.formatDayLabel(dateKey),
				cls: 'operon-calendar-day-header-date',
			});
		}
	}

	private renderLaneToggleButton(
		container: HTMLElement,
		label: string,
		isVisible: boolean,
		onClick: () => void,
		compact = false,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			text: label,
			cls: 'operon-calendar-lane-toggle-button',
			attr: { type: 'button' },
		});
		button.classList.toggle('is-compact', compact);
		button.classList.toggle('is-on', isVisible);
		button.classList.toggle('is-off', !isVisible);
		button.addEventListener('click', onClick);
		return button;
	}

	private renderAllDaySection(
		container: HTMLElement,
		visibleDates: string[],
		scheduledItems: CalendarItem[],
		dueItems: CalendarItem[],
		finishedItems: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
		showAllDayLane: boolean,
		showDueMarkers: boolean,
		showFinishedLane: boolean,
		dropContextMode: 'timeGrid' | 'multiWeek' = 'timeGrid',
	): void {
		const section = container.createDiv('operon-calendar-all-day-section');
		if (showAllDayLane) {
			this.renderAllDayTrack(section, t('calendar', 'allDay'), 'allDay', visibleDates, scheduledItems, false, preset, settings, dropContextMode);
		}
		if (showDueMarkers) {
			this.renderAllDayTrack(section, t('calendar', 'due'), 'due', visibleDates, dueItems, true, preset, settings, dropContextMode);
		}
		if (showFinishedLane) {
			this.renderAllDayTrack(section, t('calendar', 'finished'), 'finished', visibleDates, finishedItems, true, preset, settings, dropContextMode);
		}
	}

	private renderAllDayTrack(
		container: HTMLElement,
		label: string,
		trackKind: 'allDay' | 'due' | 'finished',
		visibleDates: string[],
		items: CalendarItem[],
		isDueTrack: boolean,
		preset: CalendarPreset,
		settings: OperonSettings,
		dropContextMode: 'timeGrid' | 'multiWeek' = 'timeGrid',
	): void {
		const placements = this.buildAllDayPlacements(items, visibleDates);
		const row = container.createDiv('operon-calendar-all-day-row');
		const labelEl = row.createDiv('operon-calendar-row-label');
		this.renderLaneToggleButton(labelEl, label, true, () => {
			if (trackKind === 'due') {
				void this.updateLeafState({
					...this.ensureState(),
					showDueMarkers: false,
				});
				return;
			}
			if (trackKind === 'finished') {
				void this.updateLeafState({
					...this.ensureState(),
					showFinishedLane: false,
				});
				return;
			}
			void this.updateLeafState({
				...this.ensureState(),
				showAllDayLane: false,
			});
		});

		const body = row.createDiv('operon-calendar-all-day-body');
		const laneHeight = 31;
		const usedLaneCount = Math.max(0, placements[0]?.laneCount ?? 0);
		const totalLaneCount = Math.max(1, usedLaneCount);
		body.style.height = `${totalLaneCount * laneHeight}px`;

		const grid = body.createDiv('operon-calendar-all-day-grid');
		grid.style.gridTemplateColumns = `repeat(${Math.max(1, visibleDates.length)}, minmax(0, 1fr))`;
		for (const dateKey of visibleDates) {
			const cell = grid.createDiv('operon-calendar-all-day-cell');
			const dayDate = this.parseDateKey(dateKey);
			cell.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
			if (dateKey === localToday()) {
				cell.addClass('is-today');
			}
			if (!isDueTrack) {
				this.bindCalendarCellQuickAdd(cell, dateKey, () => {
					void this.callbacks.onAllDaySlotSelection?.(buildAllDaySlotSelection(dateKey, dateKey));
				});
			}
		}

		const overlay = body.createDiv('operon-calendar-all-day-overlay');
		if (!isDueTrack) {
			const dropContext = {
				body,
				overlay,
				visibleDates: [...visibleDates],
				laneHeight,
				previewLane: totalLaneCount - 1,
			};
			if (dropContextMode === 'multiWeek') {
				this.multiWeekAllDayDropContexts.push(dropContext);
			} else {
				this.allDayDropContext = dropContext;
			}
		}
				for (const placement of placements) {
					const itemEl = overlay.createDiv('operon-calendar-all-day-item');
					itemEl.dataset.operonId = placement.item.taskId;
					itemEl.addClass(`is-${placement.item.kind}`);
					itemEl.addClass(`is-${placement.item.renderSnapshot.checkbox}`);
				this.applyCalendarProjectionClasses(itemEl, placement.item);
				if (placement.item.origin === 'external') itemEl.addClass('is-external');
				this.applyAllDayPlacementStyle(itemEl, placement.startColumn, placement.endColumn, placement.lane, laneHeight, visibleDates.length);
				this.applyCalendarItemColor(itemEl, placement.item, preset, settings);
				const hoverTrigger = this.renderCalendarItemLabel(itemEl, placement.item, settings, true);
				if (hoverTrigger) {
					this.bindHoverMenuTarget(hoverTrigger, placement.item);
				}
				if (!isDueTrack) {
					if (!this.canEditCalendarItemPlacement(placement.item)) {
						itemEl.addClass('is-read-only');
						this.bindPrimaryItemClick(itemEl, placement.item);
					} else {
						itemEl.addClass('is-draggable');
						itemEl.createDiv('operon-calendar-all-day-resize-handle');
						this.bindScheduledAllDayItemInteraction(
							itemEl,
							body,
							overlay,
							placement,
							visibleDates,
							laneHeight,
							dropContextMode,
						);
					}
				} else {
					itemEl.addClass('is-read-only');
					this.bindPrimaryItemClick(itemEl, placement.item);
				}
			}
	}

	private renderTimedSection(
		container: HTMLElement,
		renderWindow: TimedHorizontalRenderWindow,
		items: CalendarItem[],
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		const visibleDates = renderWindow.bufferedDates;
		const viewport = container.createDiv('operon-calendar-timed-viewport');
		this.timedScrollEl = viewport;
		const hiddenTimeKey = `${preset.id}|${this.ensureState().anchorDate}`;
		const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
		viewport.addEventListener('scroll', () => {
			this.hideCalendarHoverMenu(true);
			if (this.shouldSuppressTimedScrollPersistence()) return;
			if (!this.state) return;
			this.state = {
				...this.ensureState(),
				scrollMinutes: this.gridOffsetToMinute(Math.max(0, Math.round(viewport.scrollTop)), metrics),
			};
			this.scheduleLeafStatePersistence();
		});
		viewport.addEventListener('wheel', (event: WheelEvent) => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
			this.handleTimedHorizontalWheel(event);
		}, { passive: false });
		viewport.addEventListener('pointerdown', () => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
		});
		viewport.addEventListener('keydown', () => {
			this.lastTimedGridUserScrollInteractionAt = Date.now();
		});

		const section = viewport.createDiv('operon-calendar-timed-section');
		const gutter = section.createDiv('operon-calendar-time-gutter');
		gutter.style.height = `${metrics.gridHeight}px`;
		const clip = section.createDiv('operon-calendar-timed-clip');
		const strip = clip.createDiv('operon-calendar-timed-strip');
		strip.style.width = `${(visibleDates.length / Math.max(1, renderWindow.visibleDates.length)) * 100}%`;
		const daysGrid = strip.createDiv('operon-calendar-timed-grid');
		daysGrid.style.gridTemplateColumns = `repeat(${Math.max(1, visibleDates.length)}, minmax(0, 1fr))`;
		daysGrid.style.height = `${metrics.gridHeight}px`;
		const hoverGuideOverlay = section.createDiv('operon-calendar-hover-guide-overlay');
		const itemOverlay = daysGrid.createDiv('operon-calendar-timed-overlay');
		itemOverlay.style.height = `${metrics.gridHeight}px`;
		this.timedHorizontalClipEl = clip;
		this.timedHorizontalStripEl = strip;
		this.timedDropContext = {
			section,
			gutter,
			daysGrid,
			hoverGuideOverlay,
			visibleDates: [...visibleDates],
			metrics,
			preset,
			settings,
		};

		for (let hour = 0; hour <= 24; hour++) {
			if (hour < 24 && this.isHiddenMinute(hour * 60, metrics.hiddenRange) && !metrics.isHiddenExpanded) {
				continue;
			}
			const label = gutter.createDiv('operon-calendar-time-label');
			if (hour === 0) label.addClass('is-first');
			if (hour === 24) label.addClass('is-last');
			const offset = this.minuteToGridOffset(hour * 60, metrics);
			label.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : offset}px`;
			label.createSpan({
				text: formatUiMinuteOfDay(this.app, settings, visibleDates[0] ?? localToday(), hour * 60),
			});
		}

		if (metrics.hiddenRange.enabled && !metrics.isHiddenExpanded) {
			const bandTop = this.minuteToGridOffset(metrics.hiddenRange.startMinutes, metrics);
			const band = strip.createDiv('operon-calendar-hidden-time-band');
			band.style.top = `${bandTop}px`;
			band.style.height = `${metrics.collapsedBandHeight}px`;
			const button = band.createEl('button', {
				text: t('calendar', 'showHiddenTime'),
				cls: 'operon-calendar-hidden-time-button',
				attr: { type: 'button' },
			});
			button.addEventListener('click', () => {
				this.expandedHiddenTimeKey = hiddenTimeKey;
				this.render();
			});
		}
		this.syncTimedHorizontalPanMetrics();
		this.applyTimedHorizontalPanTransform(false);

		const placements = this.buildTimedGridVisualPlacements(items, visibleDates);
		for (let dayIndex = 0; dayIndex < visibleDates.length; dayIndex++) {
			const column = daysGrid.createDiv('operon-calendar-timed-day');
			const dayDate = this.parseDateKey(visibleDates[dayIndex]);
			column.classList.toggle('is-weekend', dayDate?.getDay() === 0 || dayDate?.getDay() === 6);
			if (visibleDates[dayIndex] === localToday()) {
				column.addClass('is-today');
				this.attachNowIndicator(column, metrics);
			}

			for (let hour = 0; hour <= 24; hour++) {
				if (hour < 24 && this.isHiddenMinute(hour * 60, metrics.hiddenRange) && !metrics.isHiddenExpanded) {
					continue;
				}
				const line = column.createDiv('operon-calendar-hour-line');
				const offset = this.minuteToGridOffset(hour * 60, metrics);
				line.style.top = `${hour === 24 ? Math.max(0, metrics.gridHeight - 1) : offset}px`;
			}

			this.bindTimedSelection(column, visibleDates[dayIndex], preset, metrics, section, gutter, hoverGuideOverlay, settings);
		}

			for (const segment of placements) {
				const block = itemOverlay.createDiv('operon-calendar-timed-item');
				block.dataset.operonId = segment.item.taskId;
				block.addClass(`is-${segment.item.renderSnapshot.checkbox}`);
			this.applyCalendarProjectionClasses(block, segment.item);
			if (segment.item.origin === 'external') block.addClass('is-external');
			if (segment.visualAvailabilityLayer) block.addClass('is-availability-layer');
			if (segment.visualOverlapGroupSize > 1) block.addClass('has-overlap');
			if (segment.visualStackIndex > 1) block.addClass('is-overlap-layer');
			if (segment.visualInsetLevel > 0) block.addClass('is-indented-overlap');
			if (segment.visualHoverRaiseEligible) block.addClass('can-hover-raise');
			this.applyTimedPlacementStyle(
				block,
				segment.dayIndex,
				segment.lane,
				segment.laneCount,
				segment.startMinutes,
				segment.endMinutes,
				visibleDates.length,
				metrics,
				segment,
			);
			this.applyCalendarItemColor(block, segment.item, preset, settings);
			if (segment.visualAvailabilityLayer) {
				this.bindAvailabilityLayerExternalTooltip(block, segment.item, settings);
			}

			const content = block.createDiv('operon-calendar-timed-content');
			const hoverTrigger = this.renderCalendarItemLabel(content, segment.item, settings, true);
			block.createDiv('operon-calendar-timed-drag-label');
			this.bindTimedHoverGuides(
				block,
				hoverGuideOverlay,
				section,
				gutter,
				visibleDates[segment.dayIndex] ?? '',
				segment.startMinutes,
				segment.endMinutes,
				metrics,
				settings,
			);
			this.bindPrimaryItemClick(block, segment.item);
			if (hoverTrigger) {
				this.bindHoverMenuTarget(hoverTrigger, segment.item);
			}
			if (this.canEditCalendarItemPlacement(segment.item)) {
				block.addClass('is-draggable');
				this.createTimedResizeRailHandles(block);
				this.bindTimedItemInteraction(block, daysGrid, segment, visibleDates, metrics, settings, section, gutter, hoverGuideOverlay);
			} else {
				block.addClass('is-read-only');
				if (this.isDoneRollingProjection(segment.item)) {
					this.createTimedResizeRailHandles(block, true);
				}
			}
		}
		this.updateNowIndicators();
		if (this.nowIndicatorEntries.length > 0) {
			this.nowIndicatorTimer = window.setInterval(() => this.updateNowIndicators(), 30000);
		}
	}

	private bindTimedSelection(
		column: HTMLElement,
		dateKey: string,
		preset: CalendarPreset,
		metrics: CalendarTimedMetrics,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		settings: OperonSettings,
		onSelect: ((selection: CalendarSlotSelection) => void | Promise<void>) | undefined = this.callbacks.onTimedSlotSelection,
	): void {
		let dragState: {
			pointerId: number;
			anchorMinute: number;
			currentMinute: number;
			selectionEl: HTMLElement;
		} | null = null;

		const clearDragState = (): void => {
			if (!dragState) return;
			dragState.selectionEl.remove();
			hoverGuideOverlay.empty();
			dragState = null;
			column.removeClass('is-selecting');
		};

		const renderSelectionGuides = (startMinutes: number, endMinutes: number): void => {
			this.renderTimedSelectionGuides(
				section,
				gutter,
				column,
				hoverGuideOverlay,
				dateKey,
				startMinutes,
				endMinutes,
				metrics,
				'var(--interactive-accent)',
				settings,
			);
		};

		const renderSelection = (): CalendarSlotSelection | null => {
			if (!dragState) return null;
			const selection = buildTimedSlotSelection(
				dateKey,
				dragState.anchorMinute,
				dragState.currentMinute,
				preset.slotMinutes,
			);
			const startMinutes = this.extractMinuteOfDay(selection.start);
			const endMinutes = this.extractMinuteOfDay(selection.end);
			const top = this.minuteToGridOffset(startMinutes, metrics);
			const height = Math.max(1, this.minuteToGridOffset(endMinutes, metrics) - top);
			dragState.selectionEl.style.top = `${Math.max(0, top)}px`;
			dragState.selectionEl.style.height = `${height}px`;
			renderSelectionGuides(startMinutes, endMinutes);
			return selection;
		};

		const updateCurrentMinute = (clientY: number): CalendarSlotSelection | null => {
			if (!dragState) return null;
			dragState.currentMinute = this.resolveTimedMinuteOffset(column, clientY, metrics);
			return renderSelection();
		};

		column.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, column);
			if (target?.closest('.operon-calendar-timed-item')) return;

			event.preventDefault();
			column.addClass('is-selecting');
			const anchorMinute = this.resolveTimedMinuteOffset(column, event.clientY, metrics);
			const selectionEl = column.createDiv('operon-calendar-timed-selection');
			dragState = {
				pointerId: event.pointerId,
				anchorMinute,
				currentMinute: anchorMinute,
				selectionEl,
			};
			this.beginCalendarDragSession(column, event.pointerId, finishDrag);
			column.setPointerCapture?.(event.pointerId);
			renderSelection();
		});

		column.addEventListener('pointermove', (event: PointerEvent) => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			updateCurrentMinute(event.clientY);
		});

		const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
			if (!dragState) return;
			const pointerId = dragState.pointerId;
			if (event && pointerId !== event.pointerId) return;
			const selection = event ? updateCurrentMinute(event.clientY) : null;
			this.releaseCalendarPointerCapture(column, pointerId);
			clearDragState();
			if (reason !== 'commit' || !selection || !onSelect) return;
			void onSelect(selection);
		};

		column.addEventListener('pointerup', (event: PointerEvent) => this.finishActiveCalendarDragSession('commit', event));
		column.addEventListener('pointercancel', (event: PointerEvent) => this.finishActiveCalendarDragSession('cancel', event));
	}

	private bindTimedItemInteraction(
		block: HTMLElement,
		daysGrid: HTMLElement,
		segment: TimedGridVisualPlacement,
		visibleDates: string[],
		metrics: CalendarTimedMetrics,
		settings: OperonSettings,
		section: HTMLElement,
		gutter: HTMLElement,
		hoverGuideOverlay: HTMLElement,
		options: {
			resolveGridPosition?: (clientX: number, clientY: number) => { dayIndex: number; minuteOfDay: number } | null;
			applyPlacementStyle?: (element: HTMLElement, dayIndex: number, startMinutes: number, endMinutes: number, visualLayout?: TimedGridVisualLayout) => void;
			guideTargetGrid?: HTMLElement;
		} = {},
	): void {
		type TimedItemDragMode = 'move' | 'resize-start' | 'resize-end';
		type TimedItemDragOptions = {
			allowAllDayDrop?: boolean;
			suppressClickOnFinish?: boolean;
		};
		let dragState: {
			pointerId: number;
			mode: TimedItemDragMode;
			anchorOffsetMinutes: number;
			currentDayIndex: number;
			currentStartMinutes: number;
			currentEndMinutes: number;
			dropTarget: 'timed' | 'allDay';
			allDayDate: string | null;
			allDayPreviewEl: HTMLElement | null;
			allowAllDayDrop: boolean;
			suppressClickOnFinish: boolean;
		} | null = null;
		let pendingTouchDrag: {
			pointerId: number;
			initialClientX: number;
			initialClientY: number;
			latestClientX: number;
			latestClientY: number;
			previousClientY: number;
			startedAtMs: number;
			mode: 'pending' | 'scrolling';
			timerId: ReturnType<Window['setTimeout']>;
			ownerWindow: Window;
			onPointerMove: (event: PointerEvent) => void;
			onPointerUp: (event: PointerEvent) => void;
			onPointerCancel: (event: PointerEvent) => void;
			onWindowBlur: () => void;
		} | null = null;
		let activeTouchWindowMoveCleanup: (() => void) | null = null;
		let touchDragActiveBody: HTMLElement | null = null;
		const dragLabel = block.querySelector<HTMLElement>('.operon-calendar-timed-drag-label');
		const isMobileTimeGridItem = block.hasClass('operon-calendar-mobile-timegrid-item');

		const isTouchDragPointer = (event: PointerEvent): boolean => event.pointerType === 'touch' || event.pointerType === 'pen';

		const resolveTouchLongPressMs = (): number => {
			const raw = settings.calendarTouchDragLongPressMs;
			if (typeof raw !== 'number' || !Number.isFinite(raw)) return 260;
			return Math.max(150, Math.min(600, Math.round(raw)));
		};

		const resolveTouchCancelDistancePx = (): number => {
			const raw = settings.calendarTouchDragCancelDistancePx;
			if (typeof raw !== 'number' || !Number.isFinite(raw)) return 10;
			return Math.max(4, Math.min(24, Math.round(raw)));
		};

		const resolvePressDragMs = (): number => CALENDAR_MOBILE_TASK_PRESS_DRAG_MS;
		const resolveTouchDragTimerMs = (): number => isMobileTimeGridItem
			? CALENDAR_MOBILE_TASK_LONG_PRESS_MS
			: resolveTouchLongPressMs();
		const resolveTouchTapDistancePx = (): number => isMobileTimeGridItem
			? CALENDAR_MOBILE_TOUCH_CANCEL_DISTANCE_PX
			: resolveTouchCancelDistancePx();

		const suppressNextTouchClick = (): void => {
			const ownerWindow = getOwnerWindow(block);
			block.dataset.suppressCalendarClick = 'true';
			ownerWindow.setTimeout(() => {
				if (block.dataset.suppressCalendarClick === 'true') {
					delete block.dataset.suppressCalendarClick;
				}
			}, CALENDAR_TOUCH_CLICK_SUPPRESSION_MS);
		};

		const suppressNextTouchClickAtWindow = (ownerWindow: Window): void => {
			let cleanupTimer: ReturnType<Window['setTimeout']> | null = null;
			const cleanup = (): void => {
				ownerWindow.removeEventListener('click', onClick, true);
				if (cleanupTimer !== null) {
					ownerWindow.clearTimeout(cleanupTimer);
					cleanupTimer = null;
				}
			};
			const onClick = (clickEvent: MouseEvent): void => {
				const target = asHTMLElement(clickEvent.target, block);
				if (!target || !block.contains(target)) return;
				clickEvent.preventDefault();
				clickEvent.stopPropagation();
				clickEvent.stopImmediatePropagation();
				cleanup();
			};
			ownerWindow.addEventListener('click', onClick, true);
			cleanupTimer = ownerWindow.setTimeout(cleanup, CALENDAR_TOUCH_CLICK_SUPPRESSION_MS);
		};

		const setTouchDragActiveClass = (): void => {
			const body = getOwnerBody(block);
			if (touchDragActiveBody && touchDragActiveBody !== body) {
				touchDragActiveBody.classList.remove('operon-calendar-touch-drag-active');
			}
			touchDragActiveBody = body;
			touchDragActiveBody.classList.add('operon-calendar-touch-drag-active');
			block.addClass('is-touch-dragging');
		};

		const clearTouchDragActiveClass = (): void => {
			touchDragActiveBody?.classList.remove('operon-calendar-touch-drag-active');
			touchDragActiveBody = null;
			block.removeClass('is-touch-dragging');
		};

		const clearActiveTouchWindowMove = (): void => {
			activeTouchWindowMoveCleanup?.();
			activeTouchWindowMoveCleanup = null;
		};

		const bindActiveTouchWindowMove = (pointerId: number, ownerWindow: Window): void => {
			clearActiveTouchWindowMove();
			const onPointerMove = (event: PointerEvent): void => {
				if (event.pointerId !== pointerId) return;
				event.preventDefault();
				updateFromPointer(event.clientX, event.clientY);
			};
			ownerWindow.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
			activeTouchWindowMoveCleanup = () => ownerWindow.removeEventListener('pointermove', onPointerMove, true);
		};

		const clearPendingTouchDrag = (releaseCapture: boolean): void => {
			if (!pendingTouchDrag) return;
			const pending = pendingTouchDrag;
			pending.ownerWindow.clearTimeout(pending.timerId);
			pending.ownerWindow.removeEventListener('pointermove', pending.onPointerMove, true);
			pending.ownerWindow.removeEventListener('pointerup', pending.onPointerUp, true);
			pending.ownerWindow.removeEventListener('pointercancel', pending.onPointerCancel, true);
			pending.ownerWindow.removeEventListener('blur', pending.onWindowBlur, true);
			if (releaseCapture) {
				this.releaseCalendarPointerCapture(block, pending.pointerId);
			}
			block.removeClass('is-touch-drag-pending');
			pendingTouchDrag = null;
		};

		const getTouchPendingDistance = (clientX: number, clientY: number, pending = pendingTouchDrag): number => {
			if (!pending) return Number.POSITIVE_INFINITY;
			return Math.hypot(clientX - pending.initialClientX, clientY - pending.initialClientY);
		};

		const scrollMobileTimeGridBy = (deltaY: number): void => {
			if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.5) return;
			const viewport = this.mobileTimeGridScrollEl?.isConnected
				? this.mobileTimeGridScrollEl
				: block.closest<HTMLElement>('.operon-calendar-mobile-timegrid-viewport');
			if (!viewport) return;
			const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
			viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, viewport.scrollTop + deltaY));
			this.lastMobileTimeGridScrollTop = Math.max(0, Math.round(viewport.scrollTop));
		};

			const startTouchMoveDragFromPending = (
				pending: NonNullable<typeof pendingTouchDrag>,
				clientX: number,
				clientY: number,
			): void => {
				clearPendingTouchDrag(false);
				startDragFromPointer(pending.pointerId, clientX, clientY, 'move', {
					allowAllDayDrop: isMobileTimeGridItem,
					suppressClickOnFinish: true,
				});
				setTouchDragActiveClass();
				bindActiveTouchWindowMove(pending.pointerId, pending.ownerWindow);
				updateFromPointer(clientX, clientY);
			};

		const renderEditGuides = (dayIndex: number, startMinutes: number, endMinutes: number): void => {
			const dateKey = visibleDates[dayIndex] ?? visibleDates[segment.dayIndex] ?? '';
			const sectionRect = section.getBoundingClientRect();
			const gutterRect = gutter.getBoundingClientRect();
			const guideGrid = options.guideTargetGrid ?? daysGrid;
			const gridRect = guideGrid.getBoundingClientRect();
			const left = Math.max(0, gutterRect.right - sectionRect.left);
			const dayWidth = gridRect.width / Math.max(1, visibleDates.length);
			const blockLeft = (gridRect.left - sectionRect.left) + (dayIndex * dayWidth);
			const right = Math.max(left, blockLeft);
			const width = Math.max(0, right - left);
			const accent = this.resolveCalendarHoverGuideAccent(block);

			hoverGuideOverlay.empty();
			const createGuide = (minuteOfDay: number, labelSide: 'start' | 'end'): void => {
				const guide = hoverGuideOverlay.createDiv('operon-calendar-hover-guide is-edit-guide');
				const top = (gridRect.top - sectionRect.top) + this.minuteToGridOffset(minuteOfDay, metrics);
				const currentBlockRect = block.getBoundingClientRect();
				const labelCenter = Math.max(0, (currentBlockRect.left - sectionRect.left) + (currentBlockRect.width / 2) - left);
				guide.style.top = `${Math.max(0, top)}px`;
				guide.style.left = `${left}px`;
				guide.style.width = `${width}px`;
				guide.style.setProperty('--operon-calendar-guide-color', accent);
				const labelEl = guide.createSpan({
					text: this.formatTimedGuideLabel(dateKey, minuteOfDay, settings),
					cls: `operon-calendar-hover-guide-label is-${labelSide}`,
				});
				labelEl.style.left = `${labelCenter}px`;
			};

			createGuide(startMinutes, 'start');
			createGuide(endMinutes, 'end');
		};

		const renderPlacement = (): void => {
			const nextDayIndex = dragState?.currentDayIndex ?? segment.dayIndex;
			const nextStart = dragState?.currentStartMinutes ?? segment.startMinutes;
			const nextEnd = dragState?.currentEndMinutes ?? segment.endMinutes;
			if (options.applyPlacementStyle) {
				options.applyPlacementStyle(block, nextDayIndex, nextStart, nextEnd, segment);
			} else {
				this.applyTimedPlacementStyle(
					block,
					nextDayIndex,
					segment.lane,
					segment.laneCount,
					nextStart,
					nextEnd,
					visibleDates.length,
					metrics,
					segment,
				);
			}
			if (dragLabel) {
				const dateKey = visibleDates[nextDayIndex] ?? visibleDates[segment.dayIndex] ?? '';
				dragLabel.setText(this.formatTimedDragLabel(dateKey, nextStart, nextEnd, settings));
			}
			if (dragState) {
				renderEditGuides(nextDayIndex, nextStart, nextEnd);
			}
		};

		const buildSelection = (): CalendarSlotSelection | null => {
			if (!dragState) return null;
			if (dragState.dropTarget === 'allDay' && dragState.allDayDate) {
				return buildAllDaySlotSelection(dragState.allDayDate, dragState.allDayDate);
			}
			const dateKey = visibleDates[dragState.currentDayIndex];
			if (!dateKey) return null;
			return buildTimedSlotSelection(
				dateKey,
				dragState.currentStartMinutes,
				dragState.currentEndMinutes,
				CALENDAR_TIMED_SNAP_MINUTES,
			);
		};

		const resolveDefaultGridPosition = (clientX: number, clientY: number): { dayIndex: number; minuteOfDay: number } => {
			const rect = daysGrid.getBoundingClientRect();
			const width = Math.max(1, rect.width);
			const relativeX = Math.max(0, Math.min(width - 1, clientX - rect.left));
			const relativeY = Math.max(0, Math.min(metrics.gridHeight, clientY - rect.top));
			const minuteOfDay = this.gridOffsetToMinute(relativeY, metrics);
			return {
				dayIndex: Math.max(0, Math.min(
					visibleDates.length - 1,
					Math.floor((relativeX / width) * visibleDates.length),
				)),
				minuteOfDay: Math.max(0, Math.min(24 * 60, minuteOfDay)),
			};
		};
		const resolveGridPosition = (clientX: number, clientY: number): { dayIndex: number; minuteOfDay: number } | null => {
			if (options.resolveGridPosition) {
				return options.resolveGridPosition(clientX, clientY);
			}
			return resolveDefaultGridPosition(clientX, clientY);
		};

		const updateFromPointer = (clientX: number, clientY: number): void => {
			if (!dragState) return;
			if (dragState.mode === 'move' && dragState.allowAllDayDrop && this.allDayDropContext) {
				const allDayRect = this.allDayDropContext.body.getBoundingClientRect();
				const insideAllDay = clientX >= allDayRect.left
					&& clientX <= allDayRect.right
					&& clientY >= allDayRect.top
					&& clientY <= allDayRect.bottom;
				if (insideAllDay) {
					const nextColumn = this.resolveAllDayColumnIndex(this.allDayDropContext.body, clientX, this.allDayDropContext.visibleDates.length);
					const nextDate = this.allDayDropContext.visibleDates[nextColumn] ?? null;
					dragState.dropTarget = 'allDay';
					dragState.allDayDate = nextDate;
					this.setMobileAllDayDropHighlight(this.allDayDropContext, nextColumn);
					block.addClass('operon-calendar-drag-source-hidden');
					hoverGuideOverlay.empty();
					if (!dragState.allDayPreviewEl) {
						dragState.allDayPreviewEl = this.allDayDropContext.overlay.createDiv('operon-calendar-all-day-transfer-preview');
						if (this.allDayDropContext.isMobile) {
							dragState.allDayPreviewEl.addClass('operon-calendar-mobile-all-day-transfer-preview');
						}
					}
					if (nextDate) {
						this.applyAllDayPlacementStyle(
							dragState.allDayPreviewEl,
							nextColumn,
							nextColumn,
							this.allDayDropContext.previewLane,
							this.allDayDropContext.laneHeight,
							this.allDayDropContext.visibleDates.length,
						);
					}
					return;
				}
			}
			dragState.dropTarget = 'timed';
			dragState.allDayDate = null;
			this.clearMobileAllDayDropHighlight(this.allDayDropContext);
			if (dragState.allDayPreviewEl) {
				dragState.allDayPreviewEl.remove();
				dragState.allDayPreviewEl = null;
			}
			block.removeClass('operon-calendar-drag-source-hidden');
			const position = resolveGridPosition(clientX, clientY);
			if (!position) return;
			const duration = Math.max(CALENDAR_TIMED_SNAP_MINUTES, segment.endMinutes - segment.startMinutes);

			if (dragState.mode === 'move') {
				let nextStart = position.minuteOfDay - dragState.anchorOffsetMinutes;
				nextStart = Math.round(nextStart / CALENDAR_TIMED_SNAP_MINUTES) * CALENDAR_TIMED_SNAP_MINUTES;
				nextStart = Math.max(0, Math.min(24 * 60 - duration, nextStart));
				dragState.currentDayIndex = position.dayIndex;
				dragState.currentStartMinutes = nextStart;
				dragState.currentEndMinutes = Math.min(24 * 60, nextStart + duration);
			} else if (dragState.mode === 'resize-start') {
				let nextStart = Math.round(position.minuteOfDay / CALENDAR_TIMED_SNAP_MINUTES) * CALENDAR_TIMED_SNAP_MINUTES;
				nextStart = Math.max(0, Math.min(dragState.currentEndMinutes - CALENDAR_TIMED_SNAP_MINUTES, nextStart));
				dragState.currentStartMinutes = nextStart;
			} else {
				let nextEnd = Math.round(position.minuteOfDay / CALENDAR_TIMED_SNAP_MINUTES) * CALENDAR_TIMED_SNAP_MINUTES;
				nextEnd = Math.max(dragState.currentStartMinutes + CALENDAR_TIMED_SNAP_MINUTES, Math.min(24 * 60, nextEnd));
				dragState.currentEndMinutes = nextEnd;
			}
			renderPlacement();
		};

		const startDragFromPointer = (
			pointerId: number,
			clientX: number,
			clientY: number,
			mode: TimedItemDragMode,
			options: TimedItemDragOptions = {},
		): void => {
			this.hideCalendarHoverMenu(true);
			const position = resolveGridPosition(clientX, clientY);
			if (!position) return;
			block.addClass('is-dragging');
			dragState = {
				pointerId,
				mode,
				anchorOffsetMinutes: Math.max(0, position.minuteOfDay - segment.startMinutes),
				currentDayIndex: segment.dayIndex,
				currentStartMinutes: segment.startMinutes,
				currentEndMinutes: segment.endMinutes,
				dropTarget: 'timed',
				allDayDate: null,
				allDayPreviewEl: null,
				allowAllDayDrop: options.allowAllDayDrop ?? true,
				suppressClickOnFinish: options.suppressClickOnFinish ?? false,
			};
			this.beginCalendarDragSession(block, pointerId, finishDrag);
			try {
				block.setPointerCapture?.(pointerId);
			} catch {
				// Pointer capture is best-effort in mobile WebViews.
			}
			block.classList.add('is-live-editing');
			renderPlacement();
		};

		const startDrag = (event: PointerEvent, mode: TimedItemDragMode): void => {
			event.preventDefault();
			event.stopPropagation();
			startDragFromPointer(event.pointerId, event.clientX, event.clientY, mode);
		};

		const openEditorFromTouchTap = (): void => {
			const ownerWindow = getOwnerWindow(block);
			suppressNextTouchClick();
			suppressNextTouchClickAtWindow(ownerWindow);
			ownerWindow.setTimeout(() => {
				if (!block.isConnected) return;
				void this.callbacks.onItemAction?.(segment.item.taskId, 'openEditor');
			}, CALENDAR_TOUCH_TAP_EDITOR_DELAY_MS);
		};

		const startPendingTouchDrag = (event: PointerEvent): void => {
			clearPendingTouchDrag(true);
			this.hideCalendarHoverMenu(true);
			const ownerWindow = getOwnerWindow(block);
			const pointerId = event.pointerId;
			if (isMobileTimeGridItem) {
				event.preventDefault();
				event.stopPropagation();
				try {
					block.setPointerCapture?.(pointerId);
				} catch {
					// Pointer capture is best-effort in mobile WebViews.
				}
			}
			const onPointerMove = (moveEvent: PointerEvent): void => {
				const pending = pendingTouchDrag;
				if (!pending || moveEvent.pointerId !== pointerId) return;
				pending.latestClientX = moveEvent.clientX;
				pending.latestClientY = moveEvent.clientY;
				const deltaX = moveEvent.clientX - pending.initialClientX;
				const deltaY = moveEvent.clientY - pending.initialClientY;
				const distance = Math.hypot(deltaX, deltaY);
				if (!isMobileTimeGridItem) {
					if (distance > resolveTouchCancelDistancePx()) {
						clearPendingTouchDrag(true);
					}
					return;
				}
				moveEvent.preventDefault();
				moveEvent.stopPropagation();
				if (pending.mode === 'scrolling') {
					scrollMobileTimeGridBy(pending.previousClientY - moveEvent.clientY);
					pending.previousClientY = moveEvent.clientY;
					return;
				}
				const elapsedMs = pending.ownerWindow.performance.now() - pending.startedAtMs;
				const intent = resolveCalendarMobileTimedTaskGestureIntent({
					deltaX,
					deltaY,
					elapsedMs,
					intentDistancePx: CALENDAR_MOBILE_TOUCH_INTENT_DISTANCE_PX,
					pressDragMs: resolvePressDragMs(),
				});
				if (intent === 'scroll') {
					pending.mode = 'scrolling';
					block.removeClass('is-touch-drag-pending');
					pending.ownerWindow.clearTimeout(pending.timerId);
					scrollMobileTimeGridBy(pending.previousClientY - moveEvent.clientY);
					pending.previousClientY = moveEvent.clientY;
					return;
				}
				if (intent === 'drag') {
					startTouchMoveDragFromPending(pending, moveEvent.clientX, moveEvent.clientY);
				}
			};
			const onPointerUp = (upEvent: PointerEvent): void => {
				const pending = pendingTouchDrag;
				if (!pending || upEvent.pointerId !== pointerId) return;
				upEvent.preventDefault();
				upEvent.stopPropagation();
				if (pending.mode === 'scrolling') {
					clearPendingTouchDrag(true);
					return;
				}
				const shouldOpenEditor = getTouchPendingDistance(upEvent.clientX, upEvent.clientY, pending) <= resolveTouchTapDistancePx();
				clearPendingTouchDrag(true);
				if (shouldOpenEditor) {
					openEditorFromTouchTap();
				}
			};
			const onPointerCancel = (cancelEvent: PointerEvent): void => {
				if (!pendingTouchDrag || cancelEvent.pointerId !== pointerId) return;
				cancelEvent.preventDefault();
				clearPendingTouchDrag(true);
			};
				const onWindowBlur = (): void => clearPendingTouchDrag(true);
				const timerId = ownerWindow.setTimeout(() => {
					const pending = pendingTouchDrag;
					if (!pending || pending.pointerId !== pointerId) return;
					clearPendingTouchDrag(false);
					startDragFromPointer(pointerId, pending.latestClientX, pending.latestClientY, 'move', {
						allowAllDayDrop: isMobileTimeGridItem,
						suppressClickOnFinish: true,
					});
					setTouchDragActiveClass();
					bindActiveTouchWindowMove(pointerId, ownerWindow);
				}, resolveTouchDragTimerMs());

			pendingTouchDrag = {
				pointerId,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				latestClientX: event.clientX,
				latestClientY: event.clientY,
				previousClientY: event.clientY,
				startedAtMs: ownerWindow.performance.now(),
				mode: 'pending',
				timerId,
				ownerWindow,
				onPointerMove,
				onPointerUp,
				onPointerCancel,
				onWindowBlur,
			};
			block.addClass('is-touch-drag-pending');
			ownerWindow.addEventListener('pointermove', onPointerMove, true);
			ownerWindow.addEventListener('pointerup', onPointerUp, true);
			ownerWindow.addEventListener('pointercancel', onPointerCancel, true);
			ownerWindow.addEventListener('blur', onWindowBlur, true);
		};

		block.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, block);
			if (target?.closest('.operon-calendar-item-action-button, .operon-calendar-status-button, a.internal-link')) return;
			if (isTouchDragPointer(event)) {
				if (isMobileTimeGridItem || settings.calendarTouchTimeGridTaskMoveEnabled !== false) {
					startPendingTouchDrag(event);
				}
				return;
			}
			const mode = target?.closest('.operon-calendar-timed-resize-handle.is-start')
				? 'resize-start'
				: target?.closest('.operon-calendar-timed-resize-handle.is-end')
					? 'resize-end'
					: 'move';
			startDrag(event, mode);
		});

		block.addEventListener('pointermove', (event: PointerEvent) => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			updateFromPointer(event.clientX, event.clientY);
		});

		const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
			if (!dragState) return;
			const pointerId = dragState.pointerId;
			if (event && pointerId !== event.pointerId) return;
			clearPendingTouchDrag(true);
			clearActiveTouchWindowMove();
			clearTouchDragActiveClass();
			if (event) {
				updateFromPointer(event.clientX, event.clientY);
			}
			const selection = buildSelection();
			const changed = dragState.currentDayIndex !== segment.dayIndex
				|| dragState.currentStartMinutes !== segment.startMinutes
				|| dragState.currentEndMinutes !== segment.endMinutes
				|| dragState.dropTarget === 'allDay';
			const mode = dragState.mode;
			const suppressClickOnFinish = dragState.suppressClickOnFinish;
			this.releaseCalendarPointerCapture(block, pointerId);
				block.removeClass('is-dragging');
				block.classList.remove('is-live-editing');
				block.removeClass('operon-calendar-drag-source-hidden');
				this.clearMobileAllDayDropHighlight(this.allDayDropContext);
				dragState.allDayPreviewEl?.remove();
				hoverGuideOverlay.empty();
			const dropTarget = dragState.dropTarget;
			dragState = null;
			if (suppressClickOnFinish) {
				block.dataset.suppressCalendarClick = 'true';
			}
			if (reason !== 'commit' || !changed || !selection) {
				renderPlacement();
				return;
			}
			block.dataset.suppressCalendarClick = 'true';
			if (dropTarget === 'allDay') {
				this.invokeCalendarDropCallback(
					segment.item.taskId,
					buildAllDayCalendarWritebackPlan(selection).payload,
					() => this.callbacks.onTimedItemDropToAllDay?.(segment.item.taskId, selection),
				);
				return;
			}
			const writebackPlan = mode === 'move'
				? buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
					selection,
					segment.item.renderSnapshot.fieldValues,
					{ preserveExistingDuration: true },
				)
				: buildTimedCalendarWritebackPlan(selection);
			if (mode !== 'move') writebackPlan.payload.dateStarted = '';
			if (isMobileTimeGridItem) {
				this.captureMobileTimeGridScrollForRender();
			}
			if (mode === 'move') {
				this.invokeCalendarDropCallback(
					segment.item.taskId,
					writebackPlan.payload,
					() => this.callbacks.onTimedItemMove?.(
						segment.item.taskId,
						selection,
						isMobileTimeGridItem ? writebackPlan.payload : undefined,
					),
					{ verifyOptimisticPatchAfterWrite: isMobileTimeGridItem },
				);
				return;
			}
			if (mode === 'resize-start') {
				this.invokeCalendarDropCallback(
					segment.item.taskId,
					writebackPlan.payload,
					() => this.callbacks.onTimedItemResizeStart?.(
						segment.item.taskId,
						selection,
						isMobileTimeGridItem ? writebackPlan.payload : undefined,
					),
					{ verifyOptimisticPatchAfterWrite: isMobileTimeGridItem },
				);
				return;
			}
			this.invokeCalendarDropCallback(
				segment.item.taskId,
				writebackPlan.payload,
				() => this.callbacks.onTimedItemResizeEnd?.(
					segment.item.taskId,
					selection,
					isMobileTimeGridItem ? writebackPlan.payload : undefined,
				),
				{ verifyOptimisticPatchAfterWrite: isMobileTimeGridItem },
			);
		};

		block.addEventListener('pointerup', (event: PointerEvent) => this.finishActiveCalendarDragSession('commit', event));
		block.addEventListener('pointercancel', (event: PointerEvent) => this.finishActiveCalendarDragSession('cancel', event));
	}

	private bindMultiWeekInDayItemInteraction(
		itemEl: HTMLElement,
		placement: TimedSegmentPlacement,
		visibleDates: string[],
		_preset: CalendarPreset,
		_settings: OperonSettings,
	): void {
		const dragThresholdPx = 6;
		let dragState: {
			pointerId: number;
			activated: boolean;
			initialClientX: number;
			initialClientY: number;
			currentDayIndex: number;
			dropTarget: 'inDay' | 'allDay' | 'none';
			allDayDate: string | null;
			allDayPreviewEl: HTMLElement | null;
			inDayPreviewEl: HTMLElement | null;
			dragGhostEl: HTMLElement | null;
		} | null = null;

		const clearDropPreview = (): void => {
			dragState?.allDayPreviewEl?.remove();
			dragState?.inDayPreviewEl?.remove();
			if (dragState) {
				dragState.allDayPreviewEl = null;
				dragState.inDayPreviewEl = null;
			}
		};

		const clearDragArtifacts = (): void => {
			clearDropPreview();
			this.removeCalendarDragGhost(dragState?.dragGhostEl);
			if (dragState) {
				dragState.dragGhostEl = null;
			}
		};

		const updateDragGhostPosition = (clientX: number, clientY: number): void => {
			this.updateCalendarDragGhostPosition(dragState?.dragGhostEl ?? null, clientX, clientY);
		};

		const ensureDragGhost = (clientX: number, clientY: number): void => {
			if (!dragState || dragState.dragGhostEl) return;
			dragState.dragGhostEl = this.createCalendarDragGhost(itemEl, 'operon-calendar-multi-week-inday-drag-ghost');
			updateDragGhostPosition(clientX, clientY);
		};

		const renderInDayPreview = (context: CalendarMultiWeekInDayDropContext, dayIndex: number): void => {
			if (!dragState) return;
			const targetList = context.dayLists[dayIndex];
			if (!targetList) return;
			const preview = itemEl.cloneNode(true) as HTMLElement;
			preview.classList.remove('is-dragging', 'is-draggable', 'is-read-only', 'operon-calendar-drag-source-hidden');
			preview.classList.add('operon-calendar-multi-week-inday-transfer-preview');
			targetList.appendChild(preview);
			dragState.inDayPreviewEl = preview;
		};

		const buildSelection = (): CalendarSlotSelection | null => {
			if (!dragState) return null;
			if (dragState.dropTarget === 'allDay' && dragState.allDayDate) {
				return buildAllDaySlotSelection(dragState.allDayDate, dragState.allDayDate);
			}
			const dateKey = visibleDates[dragState.currentDayIndex];
			if (!dateKey) return null;
			return buildTimedSlotSelection(
				dateKey,
				placement.startMinutes,
				placement.endMinutes,
				CALENDAR_TIMED_SNAP_MINUTES,
			);
		};

		const hasReachedThreshold = (clientX: number, clientY: number): boolean => {
			if (!dragState) return false;
			return Math.hypot(clientX - dragState.initialClientX, clientY - dragState.initialClientY) >= dragThresholdPx;
		};

		const updateFromPointer = (clientX: number, clientY: number): void => {
			if (!dragState) return;
				if (!dragState.activated) {
					if (!hasReachedThreshold(clientX, clientY)) return;
					dragState.activated = true;
					itemEl.addClass('is-dragging');
					itemEl.addClass('operon-calendar-drag-source-hidden');
					ensureDragGhost(clientX, clientY);
				}
			updateDragGhostPosition(clientX, clientY);

			const allDayTarget = this.resolveMultiWeekAllDayDropTarget(clientX, clientY);
			if (allDayTarget) {
				dragState.dropTarget = 'allDay';
				dragState.allDayDate = allDayTarget.dateKey;
				if (!dragState.allDayPreviewEl) {
					dragState.allDayPreviewEl = allDayTarget.context.overlay.createDiv('operon-calendar-all-day-transfer-preview');
				}
				this.applyAllDayPlacementStyle(
					dragState.allDayPreviewEl,
					allDayTarget.column,
					allDayTarget.column,
					allDayTarget.context.previewLane,
					allDayTarget.context.laneHeight,
					allDayTarget.context.visibleDates.length,
				);
				return;
			}

			dragState.dropTarget = 'none';
			dragState.allDayDate = null;
			clearDropPreview();
			ensureDragGhost(clientX, clientY);

			const inDayTarget = this.resolveMultiWeekInDayDropTarget(clientX, clientY);
			if (!inDayTarget) return;
			dragState.dropTarget = 'inDay';
			dragState.currentDayIndex = inDayTarget.dayIndex;
			renderInDayPreview(inDayTarget.context, inDayTarget.dayIndex);
		};

		itemEl.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, itemEl);
			if (target?.closest('.operon-calendar-item-action-button, .operon-calendar-status-button, .operon-calendar-multi-week-time-chip, a.internal-link')) return;
			dragState = {
				pointerId: event.pointerId,
				activated: false,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				currentDayIndex: placement.dayIndex,
				dropTarget: 'none',
				allDayDate: null,
				allDayPreviewEl: null,
				inDayPreviewEl: null,
				dragGhostEl: null,
			};
			this.beginCalendarDragSession(itemEl, event.pointerId, finishDrag);
			itemEl.setPointerCapture?.(event.pointerId);
		});

		itemEl.addEventListener('pointermove', (event: PointerEvent) => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			updateFromPointer(event.clientX, event.clientY);
		});

		const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
			if (!dragState) return;
			const pointerId = dragState.pointerId;
			if (event && pointerId !== event.pointerId) return;
			if (event) {
				updateFromPointer(event.clientX, event.clientY);
			}
			const selection = buildSelection();
			const changed = dragState.currentDayIndex !== placement.dayIndex || dragState.dropTarget === 'allDay';
			const dropTarget = dragState.dropTarget;
				this.releaseCalendarPointerCapture(itemEl, pointerId);
				itemEl.removeClass('is-dragging');
				itemEl.removeClass('operon-calendar-drag-source-hidden');
				clearDragArtifacts();
			dragState = null;
			if (reason !== 'commit' || !selection || !changed) return;
			itemEl.dataset.suppressCalendarClick = 'true';
			if (dropTarget === 'allDay') {
				this.invokeCalendarDropCallback(
					placement.item.taskId,
					buildAllDayCalendarWritebackPlan(selection).payload,
					() => this.callbacks.onTimedItemDropToAllDay?.(placement.item.taskId, selection),
				);
				return;
			}
			const writebackPlan = buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
				selection,
				placement.item.renderSnapshot.fieldValues,
				{ preserveExistingDuration: true },
			);
			this.invokeCalendarDropCallback(
				placement.item.taskId,
				writebackPlan.payload,
				() => this.callbacks.onTimedItemMove?.(placement.item.taskId, selection),
			);
		};

		itemEl.addEventListener('pointerup', (event: PointerEvent) => this.finishActiveCalendarDragSession('commit', event));
		itemEl.addEventListener('pointercancel', (event: PointerEvent) => this.finishActiveCalendarDragSession('cancel', event));
	}

	private applyTimedPlacementStyle(
		element: HTMLElement,
		dayIndex: number,
		lane: number,
		laneCount: number,
		startMinutes: number,
		endMinutes: number,
		totalDays: number,
		metrics: CalendarTimedMetrics,
		visualLayout?: TimedGridVisualLayout,
	): void {
		const safeLaneCount = Math.max(1, laneCount);
		const leftRatio = visualLayout?.visualLeftRatio ?? (lane / safeLaneCount);
		const widthRatio = visualLayout?.visualWidthRatio ?? (1 / safeLaneCount);
		const top = this.minuteToGridOffset(startMinutes, metrics);
		const height = Math.max(1, this.minuteToGridOffset(endMinutes, metrics) - top);
		const slotHeight = Math.max(1, CALENDAR_TIMED_SNAP_MINUTES * metrics.scale);
		const visibleLineCount = Math.max(1, Math.floor(height / slotHeight));
		element.style.top = `${Math.max(0, top)}px`;
		element.style.height = `${height}px`;
		element.style.left = `${((dayIndex + leftRatio) / Math.max(1, totalDays)) * 100}%`;
		const widthValue = `${(widthRatio / Math.max(1, totalDays)) * 100}%`;
		if (visualLayout?.visualAvailabilityLayer) {
			element.style.removeProperty('width');
			element.style.setProperty('--operon-calendar-availability-width', widthValue);
		} else {
			element.style.width = widthValue;
			element.style.removeProperty('--operon-calendar-availability-width');
		}
		element.style.setProperty('--operon-calendar-day-width', `${(1 / Math.max(1, totalDays)) * 100}%`);
		if (visualLayout) {
			element.style.setProperty('--operon-calendar-stack-index', String(Math.max(1, visualLayout.visualStackIndex)));
		} else {
			element.style.removeProperty('--operon-calendar-stack-index');
		}
		element.style.setProperty('--operon-calendar-slot-height', `${slotHeight}px`);
		element.style.setProperty('--operon-calendar-visible-lines', String(visibleLineCount));
		element.classList.toggle('is-compact-height', height < 42);
		element.classList.toggle('is-micro-height', height < 30);
	}

	private bindScheduledAllDayItemInteraction(
		itemEl: HTMLElement,
		body: HTMLElement,
		_overlay: HTMLElement,
		placement: AllDayPlacement,
		visibleDates: string[],
		laneHeight: number,
		dropContextMode: 'timeGrid' | 'multiWeek' = 'timeGrid',
	): void {
		const dragThresholdPx = 6;
		let dragState: {
			pointerId: number;
			mode: 'move' | 'resize-right';
			activated: boolean;
			anchorColumn: number;
			anchorDate: string;
			initialClientX: number;
			initialClientY: number;
			currentStartColumn: number;
			currentEndColumn: number;
			currentStartDate: string;
			currentEndDate: string;
			dropTarget: 'allDay' | 'timed';
			timedSelection: CalendarSlotSelection | null;
			timedPreviewEl: HTMLElement | null;
			dragGhostEl: HTMLElement | null;
		} | null = null;

		const commitSelection = (): CalendarSlotSelection => {
			if (dragState?.dropTarget === 'timed' && dragState.timedSelection) {
				return dragState.timedSelection;
			}
			const startDate = dragState?.currentStartDate ?? placement.item.startDate;
			const endDate = dragState?.currentEndDate ?? placement.item.endDate;
			return buildAllDaySlotSelection(startDate, endDate);
		};

		const renderPlacement = (): void => {
			this.applyAllDayPlacementStyle(
				itemEl,
				dragState?.currentStartColumn ?? placement.startColumn,
				dragState?.currentEndColumn ?? placement.endColumn,
				placement.lane,
				laneHeight,
				visibleDates.length,
			);
		};

		const hasDragThresholdBeenReached = (clientX: number, clientY: number): boolean => {
			if (!dragState) return false;
			const deltaX = clientX - dragState.initialClientX;
			const deltaY = clientY - dragState.initialClientY;
			return Math.hypot(deltaX, deltaY) >= dragThresholdPx;
		};

		const updateFromClient = (clientX: number, clientY: number): void => {
			if (!dragState) return;
			if (!dragState.activated) {
				if (!hasDragThresholdBeenReached(clientX, clientY)) return;
				dragState.activated = true;
				itemEl.addClass('is-dragging');
					if (dragState.mode === 'move') {
						dragState.dragGhostEl = this.createCalendarDragGhost(itemEl, 'operon-calendar-all-day-drag-ghost');
						itemEl.addClass('operon-calendar-drag-source-hidden');
					}
			}
			if (dragState.mode === 'move') {
				this.updateCalendarDragGhostPosition(dragState.dragGhostEl, clientX, clientY);
			}
			if (dragState.mode === 'move') {
				if (this.timedDropContext) {
					const allDayRect = body.getBoundingClientRect();
					const timedRect = this.timedDropContext.daysGrid.getBoundingClientRect();
					const insideTimed = clientX >= timedRect.left && clientX <= timedRect.right;
					const minTimedTransferY = Math.max(timedRect.top + 8, allDayRect.bottom + 8);
						if (insideTimed && clientY >= minTimedTransferY && clientY <= timedRect.bottom) {
							const position = this.timedDropContext.resolvePosition?.(clientX, clientY) ?? this.resolveTimedGridPosition(
									this.timedDropContext.daysGrid,
									this.timedDropContext.visibleDates,
									this.timedDropContext.metrics,
									clientX,
									clientY,
								);
							if (!position) {
								dragState.dropTarget = 'allDay';
								dragState.timedSelection = null;
								dragState.timedPreviewEl?.remove();
								dragState.timedPreviewEl = null;
								dragState.currentStartColumn = placement.startColumn;
								dragState.currentEndColumn = placement.endColumn;
								dragState.currentStartDate = placement.item.startDate;
								dragState.currentEndDate = placement.item.endDate;
								this.timedDropContext.hoverGuideOverlay.empty();
								renderPlacement();
								return;
							}
							const duration = this.resolveCalendarTaskDurationMinutes(
								placement.item,
								this.timedDropContext.preset.slotMinutes,
						);
						const endMinute = Math.min(24 * 60, position.minuteOfDay + duration);
						const selection = buildTimedSlotSelection(
							this.timedDropContext.visibleDates[position.dayIndex] ?? visibleDates[placement.startColumn],
							position.minuteOfDay,
							endMinute,
							CALENDAR_TIMED_SNAP_MINUTES,
						);
							dragState.dropTarget = 'timed';
							dragState.timedSelection = selection;
							if (!dragState.timedPreviewEl) {
								dragState.timedPreviewEl = (this.timedDropContext.previewOverlay ?? this.timedDropContext.daysGrid).createDiv('operon-calendar-timed-transfer-preview');
							}
							const previewStart = this.extractMinuteOfDay(selection.start);
							const previewEnd = Math.min(24 * 60, previewStart + duration);
							if (this.timedDropContext.applyTransferPreviewStyle) {
								this.timedDropContext.applyTransferPreviewStyle(dragState.timedPreviewEl, position.dayIndex, previewStart, previewEnd);
							} else {
								this.applyTimedPlacementStyle(
									dragState.timedPreviewEl,
									position.dayIndex,
									0,
									1,
									previewStart,
									previewEnd,
									this.timedDropContext.visibleDates.length,
									this.timedDropContext.metrics,
								);
							}
						this.timedDropContext.hoverGuideOverlay.empty();
						this.renderTimedSelectionGuides(
							this.timedDropContext.section,
							this.timedDropContext.gutter,
							this.timedDropContext.daysGrid,
							this.timedDropContext.hoverGuideOverlay,
							this.timedDropContext.visibleDates[position.dayIndex] ?? '',
							previewStart,
							previewEnd,
							this.timedDropContext.metrics,
							'var(--interactive-accent)',
							this.timedDropContext.settings,
							position.dayIndex,
							this.timedDropContext.visibleDates.length,
						);
						return;
					}
				}
				dragState.dropTarget = 'allDay';
				dragState.timedSelection = null;
				dragState.timedPreviewEl?.remove();
				dragState.timedPreviewEl = null;
				this.timedDropContext?.hoverGuideOverlay.empty();
				if (dropContextMode === 'multiWeek') {
					const allDayTarget = this.resolveMultiWeekAllDayDropTarget(clientX, clientY);
					if (allDayTarget?.dateKey) {
						const deltaDays = this.diffCalendarDateKeys(dragState.anchorDate, allDayTarget.dateKey);
						dragState.currentStartDate = shiftCalendarDateKey(placement.item.startDate, deltaDays);
						dragState.currentEndDate = shiftCalendarDateKey(placement.item.endDate, deltaDays);
					}
				} else {
					const column = this.resolveAllDayColumnIndex(body, clientX, visibleDates.length);
					const span = placement.endColumn - placement.startColumn;
					const delta = column - dragState.anchorColumn;
					const maxStart = Math.max(0, visibleDates.length - span - 1);
					const nextStart = Math.max(0, Math.min(maxStart, placement.startColumn + delta));
					dragState.currentStartColumn = nextStart;
					dragState.currentEndColumn = nextStart + span;
					dragState.currentStartDate = visibleDates[nextStart] ?? placement.item.startDate;
					dragState.currentEndDate = visibleDates[nextStart + span] ?? placement.item.endDate;
				}
			} else {
				if (dropContextMode === 'multiWeek') {
					const allDayTarget = this.resolveMultiWeekAllDayDropTarget(clientX, clientY);
					if (allDayTarget?.dateKey) {
						dragState.currentStartDate = placement.item.startDate;
						dragState.currentEndDate = allDayTarget.dateKey < placement.item.startDate
							? placement.item.startDate
							: allDayTarget.dateKey;
					}
				} else {
					const column = this.resolveAllDayColumnIndex(body, clientX, visibleDates.length);
					dragState.currentStartColumn = placement.startColumn;
					dragState.currentEndColumn = Math.max(placement.startColumn, column);
					dragState.currentStartDate = visibleDates[placement.startColumn] ?? placement.item.startDate;
					dragState.currentEndDate = visibleDates[Math.max(placement.startColumn, column)] ?? placement.item.endDate;
				}
			}
			renderPlacement();
		};

		const startDrag = (event: PointerEvent, mode: 'move' | 'resize-right'): void => {
			event.stopPropagation();
			this.hideCalendarHoverMenu(true);
			dragState = {
				pointerId: event.pointerId,
				mode,
				activated: false,
				anchorColumn: this.resolveAllDayColumnIndex(body, event.clientX, visibleDates.length),
				anchorDate: visibleDates[this.resolveAllDayColumnIndex(body, event.clientX, visibleDates.length)] ?? placement.item.startDate,
				initialClientX: event.clientX,
				initialClientY: event.clientY,
				currentStartColumn: placement.startColumn,
				currentEndColumn: placement.endColumn,
				currentStartDate: placement.item.startDate,
				currentEndDate: placement.item.endDate,
				dropTarget: 'allDay',
				timedSelection: null,
				timedPreviewEl: null,
				dragGhostEl: null,
			};
			this.beginCalendarDragSession(itemEl, event.pointerId, finishDrag);
			itemEl.setPointerCapture?.(event.pointerId);
		};

		itemEl.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) return;
			const target = asHTMLElement(event.target, itemEl);
			if (target?.closest('a.internal-link')) return;
			const mode = target?.closest('.operon-calendar-all-day-resize-handle')
				? 'resize-right'
				: 'move';
			startDrag(event, mode);
		});

		itemEl.addEventListener('pointermove', (event: PointerEvent) => {
			if (!dragState || dragState.pointerId !== event.pointerId) return;
			updateFromClient(event.clientX, event.clientY);
		});

		const finishDrag = (reason: CalendarDragEndReason, event: PointerEvent | null): void => {
			if (!dragState) return;
			const pointerId = dragState.pointerId;
			if (event && pointerId !== event.pointerId) return;
			if (event) {
				updateFromClient(event.clientX, event.clientY);
			}
			const wasActivated = dragState.activated;
			const wasMove = dragState.mode === 'move';
			const selection = commitSelection();
			const changed = dragState.currentStartDate !== placement.item.startDate
				|| dragState.currentEndDate !== placement.item.endDate
				|| dragState.dropTarget === 'timed';
				this.releaseCalendarPointerCapture(itemEl, pointerId);
				itemEl.removeClass('is-dragging');
				this.removeCalendarDragGhost(dragState.dragGhostEl);
				itemEl.removeClass('operon-calendar-drag-source-hidden');
			dragState.timedPreviewEl?.remove();
			this.timedDropContext?.hoverGuideOverlay.empty();
			const dropTarget = dragState.dropTarget;
			dragState = null;
			if (reason !== 'commit') {
				renderPlacement();
				return;
			}
			if (!wasActivated) {
				void this.callbacks.onItemAction?.(placement.item.taskId, 'openEditor');
				return;
			}
			if (!changed) {
				renderPlacement();
				return;
			}
			itemEl.dataset.suppressCalendarClick = 'true';
			if (dropTarget === 'timed') {
				const writebackPlan = buildTimedCalendarWritebackPlanForExistingCalendarAssignment(
					selection,
					placement.item.renderSnapshot.fieldValues,
					{ preserveExistingDuration: true },
				);
				this.invokeCalendarDropCallback(
					placement.item.taskId,
					writebackPlan.payload,
					() => this.callbacks.onAllDayItemDropToTimed?.(placement.item.taskId, selection),
				);
				return;
			}
			if (wasMove) {
				this.invokeCalendarDropCallback(
					placement.item.taskId,
					buildAllDayMoveWritebackPlan(placement.item.renderSnapshot.fieldValues, selection.startDate).payload,
					() => this.callbacks.onAllDayScheduledMove?.(placement.item.taskId, selection),
				);
				return;
			}
			this.invokeCalendarDropCallback(
				placement.item.taskId,
				buildAllDayResizeRightWritebackPlan(placement.item.renderSnapshot.fieldValues, selection.endDate).payload,
				() => this.callbacks.onAllDayScheduledResizeRight?.(placement.item.taskId, selection),
			);
		};

		itemEl.addEventListener('pointerup', (event: PointerEvent) => this.finishActiveCalendarDragSession('commit', event));
		itemEl.addEventListener('pointercancel', (event: PointerEvent) => this.finishActiveCalendarDragSession('cancel', event));
	}

	private buildAllDayPlacements(items: CalendarItem[], visibleDates: string[]): AllDayPlacement[] {
		const ranges = items
			.map(item => {
				const indices = this.resolveVisibleRangeIndices(item.startDate, item.endDate, visibleDates);
				if (!indices) return null;
				return {
					item,
					startColumn: indices.startColumn,
					endColumn: indices.endColumn,
				};
			})
			.filter((entry): entry is { item: CalendarItem; startColumn: number; endColumn: number } => !!entry)
			.sort((left, right) => {
				if (left.startColumn !== right.startColumn) return left.startColumn - right.startColumn;
				return right.endColumn - left.endColumn;
			});

		const laneEndColumns: number[] = [];
		const placements: Array<AllDayPlacement & { laneCount: number }> = [];

		for (const range of ranges) {
			let lane = 0;
			while (lane < laneEndColumns.length && laneEndColumns[lane] >= range.startColumn) {
				lane += 1;
			}
			if (lane === laneEndColumns.length) {
				laneEndColumns.push(range.endColumn);
			} else {
				laneEndColumns[lane] = range.endColumn;
			}
			placements.push({
				...range,
				lane,
				laneCount: 1,
			});
		}

		const laneCount = Math.max(1, laneEndColumns.length);
		return placements.map(placement => ({
			...placement,
			laneCount,
		}));
	}

	private buildTimedPlacements(items: CalendarItem[], visibleDates: string[]): TimedSegmentPlacement[] {
		const perDay = new Map<number, TimedSegmentPlacement[]>();

		for (const item of items) {
			if (!item.startDateTime || !item.endDateTime) continue;
			const start = parseLocalDatetime(item.startDateTime);
			const end = parseLocalDatetime(item.endDateTime);
			if (!start || !end || end.getTime() <= start.getTime()) continue;

			for (let dayIndex = 0; dayIndex < visibleDates.length; dayIndex++) {
				const dayKey = visibleDates[dayIndex];
				if (dayKey < item.startDate || dayKey > item.endDate) continue;

				const startMinutes = dayKey === item.startDate
					? this.extractMinuteOfDay(item.startDateTime)
					: 0;
				const endMinutes = dayKey === item.endDate
					? this.extractMinuteOfDay(item.endDateTime)
					: 24 * 60;
				if (endMinutes <= startMinutes) continue;

				const list = perDay.get(dayIndex) ?? [];
				list.push({
					item,
					dayIndex,
					lane: 0,
					laneCount: 1,
					startMinutes,
					endMinutes,
					visualLayer: item.origin === 'external' ? 'availability' : 'primary',
				});
				perDay.set(dayIndex, list);
			}
		}

		const placements: TimedSegmentPlacement[] = [];
		for (const [dayIndex, segments] of perDay.entries()) {
			placements.push(...this.layoutTimedDay(dayIndex, segments));
		}

		return placements;
	}

	private buildTimedGridVisualPlacements(items: CalendarItem[], visibleDates: string[]): TimedGridVisualPlacement[] {
		return buildTimedGridVisualLayout(this.buildTimedPlacements(items, visibleDates));
	}

	private layoutTimedDay(dayIndex: number, segments: TimedSegmentPlacement[]): TimedSegmentPlacement[] {
		const sorted = [...segments].sort((left, right) => {
			if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
			return left.endMinutes - right.endMinutes;
		});

		const laidOut: TimedSegmentPlacement[] = [];
		let cluster: TimedSegmentPlacement[] = [];
		let clusterMaxEnd = -1;

		const flushCluster = () => {
			if (cluster.length === 0) return;
			const laneEnds: number[] = [];
			const clusterPlacements: TimedSegmentPlacement[] = [];
			for (const segment of cluster) {
				let lane = 0;
				while (lane < laneEnds.length && laneEnds[lane] > segment.startMinutes) {
					lane += 1;
				}
				if (lane === laneEnds.length) {
					laneEnds.push(segment.endMinutes);
				} else {
					laneEnds[lane] = segment.endMinutes;
				}
				clusterPlacements.push({
					...segment,
					dayIndex,
					lane,
					laneCount: 1,
				});
			}

			const laneCount = Math.max(1, laneEnds.length);
			for (const placement of clusterPlacements) {
				laidOut.push({
					...placement,
					laneCount,
				});
			}
			cluster = [];
			clusterMaxEnd = -1;
		};

		for (const segment of sorted) {
			if (cluster.length > 0 && segment.startMinutes >= clusterMaxEnd) {
				flushCluster();
			}
			cluster.push(segment);
			clusterMaxEnd = Math.max(clusterMaxEnd, segment.endMinutes);
		}
		flushCluster();
		return laidOut;
	}

	private resolveVisibleRangeIndices(
		startDate: string,
		endDate: string,
		visibleDates: string[],
	): { startColumn: number; endColumn: number } | null {
		let startColumn = -1;
		let endColumn = -1;
		for (let index = 0; index < visibleDates.length; index++) {
			if (visibleDates[index] < startDate || visibleDates[index] > endDate) continue;
			if (startColumn === -1) startColumn = index;
			endColumn = index;
		}
		return startColumn === -1 || endColumn === -1
			? null
			: { startColumn, endColumn };
	}

	private bindHoverMenuTarget(triggerEl: HTMLElement, item: CalendarItem): void {
		if (!this.callbacks.onItemAction) return;
		bindContextualHoverMenuTrigger({
			controller: this.hoverMenu,
			triggerEl,
			menuKey: item.taskId,
			getSettings: () => this.getSettings(),
			openMenu: ({ mobile }) => this.showCalendarHoverMenu(triggerEl, item, mobile),
		});
	}

	private showCalendarHoverMenu(
		anchorEl: HTMLElement,
		item: CalendarItem,
		mobileInteraction = false,
	): boolean {
		if (this.timedHorizontalGesture.axisLock === 'horizontal' || Math.abs(this.timedHorizontalGesture.offsetPx) > 0.5) {
			return false;
		}
		const context: ContextualMenuContext = {
			surface: getContextualMenuSurfaceForCalendarItem(item),
			taskId: item.taskId,
			task: item.sourceTask ?? item.renderSnapshot,
			now: localNow(),
			isPinned: this.getPinnedCache()?.isPinned(item.taskId) ?? false,
			hasSubtasks: item.sourceTask
				? this.indexer.secondary.getChildIds(item.sourceTask.operonId).size > 0
				: false,
			calendarItem: item,
			projectedRef: item.origin === 'projected' && item.repeatRef
				? {
					seriesId: item.repeatRef.seriesId,
					occurrenceDate: item.repeatRef.occurrenceDate,
					projectionKind: item.repeatRef.projectionKind,
				}
				: null,
		};
		const actions = resolveContextualMenu(
			context,
			this.getSettings().contextualMenuActionAllowlist,
			this.getSettings().contextualMenuSurfaceActionMatrix,
		);
		if (actions.length === 0 || !this.callbacks.onItemAction) {
			if (this.hoverMenu.isActive(item.taskId)) {
				this.hideCalendarHoverMenu(true);
			}
			return false;
		}
		return this.showHoverMenuForActions(
			anchorEl,
			item.taskId,
			actions,
			this.resolveCalendarHoverMenuAnchorRect(anchorEl, item),
			context,
			mobileInteraction,
		);
	}

	private showHoverMenuForActions(
		anchorEl: HTMLElement,
		taskId: string,
		actions: ResolvedContextualMenuAction[],
		anchorRect = anchorEl.getBoundingClientRect(),
		context?: ContextualMenuContext,
		mobileInteraction = false,
		menuKey = taskId,
	): boolean {
		if (actions.length === 0 || !this.callbacks.onItemAction) {
			if (this.hoverMenu.isActive(menuKey)) {
				this.hideCalendarHoverMenu(true);
			}
			return false;
		}
		return this.hoverMenu.show({
			key: menuKey,
			taskId,
			actions,
			anchorRect,
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

	private resolveCalendarHoverMenuAnchorRect(
		anchorEl: HTMLElement,
		item: CalendarItem | null,
	): DOMRect {
		const anchorTarget = anchorEl.querySelector<HTMLElement>('.operon-calendar-status-button') ?? anchorEl;
		const baseRect = anchorTarget.getBoundingClientRect();
		if (item?.kind !== 'timed' || !this.timedScrollEl) {
			return baseRect;
		}

		const visibleRect = resolveVisibleContextualHoverAnchorRect(
			baseRect,
			baseRect,
			this.timedScrollEl.getBoundingClientRect(),
		);
		return new DOMRect(visibleRect.left, visibleRect.top, visibleRect.width, visibleRect.height);
	}

	private positionCalendarHoverMenu(anchorRect: DOMRect, menu: HTMLElement): boolean {
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

	private hideCalendarHoverMenu(immediate = true): void {
		this.hoverMenu.hide(immediate);
	}

	private bindCalendarNavigationKeys(): void {
		if (this.calendarNavigationKeydownHandler) return;
		this.calendarNavigationKeydownHandler = (event: KeyboardEvent) => {
			if (this.app.workspace.getMostRecentLeaf()?.view !== this) return;
			if (this.shouldIgnoreCalendarArrowNavigation(event.target)) return;
			const delta = event.key === 'ArrowLeft'
				? -1
				: event.key === 'ArrowRight'
					? 1
					: event.key === 'ArrowUp'
						? -7
						: event.key === 'ArrowDown'
							? 7
							: null;
			if (delta === null) return;
			event.preventDefault();
			event.stopPropagation();
			this.hideCalendarHoverMenu(true);
			if (this.isMobileCalendarCurrentlyRendered()) {
				void this.shiftMobileCalendarAnchorByDays(delta);
				return;
			}
			void this.shiftCalendarAnchorByDays(delta, true);
		};
		this.calendarNavigationDocument = getOwnerDocument(this.containerEl);
		this.calendarNavigationDocument.addEventListener('keydown', this.calendarNavigationKeydownHandler, true);
	}

	private isMobileCalendarCurrentlyRendered(): boolean {
		return !!this.contentEl.querySelector('.operon-calendar-mobile-root');
	}

	private unbindCalendarNavigationKeys(): void {
		if (!this.calendarNavigationKeydownHandler) return;
		this.calendarNavigationDocument?.removeEventListener('keydown', this.calendarNavigationKeydownHandler, true);
		this.calendarNavigationKeydownHandler = null;
		this.calendarNavigationDocument = null;
	}

	private shouldIgnoreCalendarArrowNavigation(target: EventTarget | null): boolean {
		const targetEl = asHTMLElement(target, this.containerEl);
		if (!targetEl) return false;
		if (targetEl.closest('input, textarea, select')) return true;
		if (targetEl.isContentEditable) return true;
		return !!targetEl.closest('[contenteditable="true"]');
	}

	private renderCalendarItemLabel(
		container: HTMLElement,
		item: CalendarItem,
		settings: OperonSettings,
		compact: boolean,
	): HTMLElement | null {
		const wrapper = container.createDiv(compact ? 'operon-calendar-item-label is-compact' : 'operon-calendar-item-label');
		if (item.origin === 'external') {
			wrapper.addClass('is-external');
			wrapper.createSpan({
				text: item.renderSnapshot.description || item.taskId,
				cls: compact ? 'operon-calendar-all-day-text' : 'operon-calendar-timed-title',
			});
			return null;
		}
		const hoverTrigger = wrapper.createSpan('operon-calendar-hover-menu-trigger');
		this.renderCalendarStatusButton(hoverTrigger, item, settings, compact);
		const titleText = item.renderSnapshot.description || item.taskId;
		const titleEl = wrapper.createSpan({
			cls: compact ? 'operon-calendar-all-day-text' : 'operon-calendar-timed-title',
		});
		const renderedWikilinks = item.origin === 'materialized' && item.sourceTask
			? renderTaskDescriptionWikilinks(titleEl, {
				app: this.app,
				description: titleText,
				sourcePath: item.sourceTask.primary.filePath,
			})
			: false;
		if (!renderedWikilinks) {
			titleEl.textContent = titleText;
		}
		if (!renderedWikilinks && item.sourceTask?.primary.format === 'yaml') {
			bindTaskTitleLinkPreview(
				this.app,
				titleEl,
				item.sourceTask.primary.filePath,
				item.sourceTask.primary.filePath,
			);
		}
		return hoverTrigger;
	}

	private bindAvailabilityLayerExternalTooltip(block: HTMLElement, item: CalendarItem, settings: OperonSettings): void {
		if (item.origin !== 'external' || !item.externalRef) return;
		const sourceName = item.externalRef.sourceName || t('calendar', 'externalCalendarsSection');
		const title = item.renderSnapshot.description || item.taskId;
		const range = this.formatTimedRange(item, settings);
		const content = range ? `${title} · ${range}` : title;
		const accessibleLabel = [sourceName, title, range].filter(Boolean).join(', ');
		setAccessibleLabelWithoutTooltip(block, accessibleLabel);
		const accent = block.style.getPropertyValue('--operon-calendar-accent').trim();
		bindOperonHoverTooltip(block, {
			title: sourceName,
			content,
			taskColor: accent && accent !== 'transparent' ? accent : null,
		});
	}

		private renderCalendarStatusButton(
			container: HTMLElement,
			item: CalendarItem,
			settings: OperonSettings,
			compact: boolean,
		): void {
			const button = container.createEl('button', {
				cls: compact
					? 'operon-checkbox operon-calendar-status-button is-compact'
					: 'operon-checkbox operon-calendar-status-button',
				attr: {
					type: 'button',
						},
					});
			button.dataset.operonId = item.taskId;
			const iconName = this.resolveStatusButtonIcon(
				item.renderSnapshot.fieldValues,
				item.renderSnapshot.checkbox,
				settings,
			);
			if (iconName) {
				setIcon(button, iconName);
		}
		setAccessibleLabelWithoutTooltip(button, t('tooltips', 'cycleTaskStatus'));

		const statusColor = this.resolveCalendarStatusColor(item, settings);
		if (statusColor) button.style.color = statusColor;
		if (item.origin === 'projected' || item.isStatusReadOnly || !this.callbacks.onStatusIconClick) {
			button.disabled = true;
			return;
		}

			button.addEventListener('pointerdown', (event) => {
				event.preventDefault();
			});
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.invokeCalendarStatusClickCallback(item.taskId, 'status-surface');
			});
		}

	private applyCalendarItemColor(
		element: HTMLElement,
		item: CalendarItem,
		preset: CalendarPreset,
		settings: OperonSettings,
		): void {
			if (preset.colorSource === 'noColor') {
				element.setCssProps({ '--operon-calendar-accent': 'transparent' });
				return;
			}
		const resolvedColor = resolveTaskColorSource(
			item.renderSnapshot.fieldValues,
			preset.colorSource,
			settings,
			{ externalColor: item.origin === 'external' ? item.externalRef?.sourceColor : null },
			);
			if (!resolvedColor) {
				element.setCssProps({ '--operon-calendar-accent': 'transparent' });
				return;
			}
			element.setCssProps({ '--operon-calendar-accent': resolvedColor });
	}

	private applyCalendarProjectionClasses(element: HTMLElement, item: CalendarItem): void {
		if (item.isDashed || item.origin === 'projected') element.addClass('is-dashed');
		if (item.origin !== 'projected') return;
		element.addClass('is-projected');
		if (this.isDoneRollingProjection(item)) {
			element.addClass('is-done-rolling-projection');
		}
	}

	private isDoneRollingProjection(item: CalendarItem): boolean {
		return item.origin === 'projected'
			&& item.repeatRef?.projectionKind === 'doneRolling';
	}

	private createTimedResizeRailHandles(block: HTMLElement, visualOnly = false, edges: { start?: boolean; end?: boolean } = {}): void {
		const includeStart = edges.start !== false;
		const includeEnd = edges.end !== false;
		const startHandle = includeStart
			? block.createDiv('operon-calendar-timed-resize-handle is-start')
			: null;
		const endHandle = includeEnd
			? block.createDiv('operon-calendar-timed-resize-handle is-end')
			: null;
		if (!visualOnly) return;
		startHandle?.addClass('is-visual-only');
		endHandle?.addClass('is-visual-only');
	}

	private resolveCalendarHoverGuideAccent(element: HTMLElement): string {
		const accent = element.style.getPropertyValue('--operon-calendar-accent').trim();
		return accent && accent !== 'transparent'
			? accent
			: 'var(--interactive-accent)';
	}

	private resolveCalendarStatusColor(item: CalendarItem, settings: OperonSettings): string | null {
		return this.resolveCalendarStatusColorFromFieldValues(item.renderSnapshot.fieldValues, settings);
	}

	private resolveCalendarStatusColorFromFieldValues(
		fieldValues: Record<string, string>,
		settings: OperonSettings,
	): string | null {
		const statusDef = findStatusDef(settings.pipelines, fieldValues['status'] ?? '');
		return statusDef?.color?.trim() || null;
	}

	private resolveStatusButtonIcon(
		fieldValues: Record<string, string>,
		checkbox: IndexedTask['checkbox'],
		settings: OperonSettings,
	): string {
		return resolveTaskDisplayIcon(settings, fieldValues, checkbox);
	}

	private resolveCurrentCalendarPreset(settings = this.getSettings()): CalendarPreset | null {
		const state = this.ensureState();
		const host = this.containerEl?.children?.[1] as HTMLElement | undefined;
		if (host?.querySelector('.operon-calendar-mobile-root')) {
			const viewMode = this.resolveMobileCalendarViewMode(state, settings);
			const sourcePreset = this.resolveMobileCalendarSourcePreset(settings, viewMode, state);
			return sourcePreset
				? this.buildMobileCalendarRenderPreset(sourcePreset, settings)
				: null;
		}
		return settings.calendarPresets.find(entry => entry.id === state.presetId)
			?? settings.calendarPresets[0]
			?? null;
	}

	private isTimeGridCompatibleSurface(preset: Pick<CalendarPreset, 'surfaceType'> | null | undefined): boolean {
		return preset?.surfaceType === 'timeGrid' || preset?.surfaceType === 'timeTrackerGrid';
	}

	private applyCalendarCheckboxClass(element: HTMLElement, checkbox: IndexedTask['checkbox']): void {
		element.removeClass('is-open', 'is-done', 'is-cancelled');
		element.addClass(`is-${checkbox}`);
	}

	private applyCalendarTaskFieldColor(
		element: HTMLElement,
		fieldValues: Record<string, string>,
		preset: CalendarPreset,
		settings: OperonSettings,
	): void {
		if (preset.colorSource === 'noColor') {
			element.setCssProps({ '--operon-calendar-accent': 'transparent' });
			return;
		}
		const resolvedColor = resolveTaskColorSource(
			fieldValues,
			preset.colorSource,
			settings,
			{ externalColor: null },
		);
		element.setCssProps({ '--operon-calendar-accent': resolvedColor || 'transparent' });
	}

		private bindTimedHoverGuides(
		block: HTMLElement,
		overlay: HTMLElement,
		section: HTMLElement,
		gutter: HTMLElement,
		dateKey: string,
		startMinutes: number,
		endMinutes: number,
		_metrics: CalendarTimedMetrics,
		settings: OperonSettings,
	): void {
		let visible = false;

		const hideGuides = (): void => {
			if (!visible) return;
			overlay.empty();
			visible = false;
		};

		const createGuide = (top: number, label: string, accent: string, labelSide: 'start' | 'end'): void => {
			const sectionRect = section.getBoundingClientRect();
			const gutterRect = gutter.getBoundingClientRect();
			const blockRect = block.getBoundingClientRect();
			const left = Math.max(0, gutterRect.right - sectionRect.left);
			const right = Math.max(left, blockRect.left - sectionRect.left);
			const width = Math.max(0, right - left);
			const labelCenter = Math.max(0, (blockRect.left - sectionRect.left) + (blockRect.width / 2) - left);
			const guide = overlay.createDiv('operon-calendar-hover-guide is-hover-guide');
			guide.style.top = `${top}px`;
			guide.style.left = `${left}px`;
			guide.style.width = `${width}px`;
			guide.style.setProperty('--operon-calendar-guide-color', accent);
			const labelEl = guide.createSpan({
				text: label,
				cls: `operon-calendar-hover-guide-label is-${labelSide}`,
			});
			labelEl.style.left = `${labelCenter}px`;
		};

		const showGuides = (): void => {
			const accent = this.resolveCalendarHoverGuideAccent(block);
			const sectionRect = section.getBoundingClientRect();
			const blockRect = block.getBoundingClientRect();
			const top = Math.max(0, blockRect.top - sectionRect.top);
			const bottom = Math.max(0, blockRect.bottom - sectionRect.top);
			overlay.empty();
			createGuide(
				top,
				this.formatTimedGuideLabel(dateKey, startMinutes, settings),
				accent,
				'start',
			);
			createGuide(
				bottom,
				this.formatTimedGuideLabel(dateKey, endMinutes, settings),
				accent,
				'end',
			);
			visible = true;
		};

		block.addEventListener('mouseenter', showGuides);
		block.addEventListener('mouseleave', () => {
			if (block.matches(':focus-within')) return;
			hideGuides();
		});
		block.addEventListener('focusin', showGuides);
		block.addEventListener('focusout', () => {
			if (block.matches(':hover')) return;
			hideGuides();
		});
		block.addEventListener('pointerdown', hideGuides);
	}

	private applyCalendarPresetTheme(root: HTMLElement, preset: CalendarPreset): void {
		root.removeClass('is-background-themed');
		root.removeClass('is-background-tinted');
		root.removeClass('is-background-custom');
		root.removeClass('is-appearance-light');
		root.removeClass('is-appearance-dark');
		root.style.removeProperty('color-scheme');
		root.style.removeProperty('--operon-calendar-background-color');
		root.style.removeProperty('--operon-calendar-background-strong');
		root.style.removeProperty('--operon-calendar-background-soft');
		root.style.removeProperty('--operon-calendar-background-gutter');
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


	private resolveCalendarThemeColor(styles: CSSStyleDeclaration, variable: string, fallback: string): CalendarResolvedColor {
		return this.parseCalendarColor(styles.getPropertyValue(variable)) ?? this.parseCalendarColor(fallback) ?? { r: 0, g: 0, b: 0, a: 1 };
	}

	private parseCalendarColor(raw: string | null | undefined): CalendarResolvedColor | null {
		const value = (raw ?? '').trim();
		if (!value) return null;

		const hex = value.replace(/^#/, '');
		if (/^[0-9a-fA-F]{3}$/.test(hex)) {
			return {
				r: Number.parseInt(hex[0] + hex[0], 16),
				g: Number.parseInt(hex[1] + hex[1], 16),
				b: Number.parseInt(hex[2] + hex[2], 16),
				a: 1,
			};
		}
		if (/^[0-9a-fA-F]{6}$/.test(hex)) {
			return {
				r: Number.parseInt(hex.slice(0, 2), 16),
				g: Number.parseInt(hex.slice(2, 4), 16),
				b: Number.parseInt(hex.slice(4, 6), 16),
				a: 1,
			};
		}
		const rgbMatch = value.match(/^rgba?\((.+)\)$/i);
		if (!rgbMatch) return null;
		const parts = rgbMatch[1].split(',').map(part => part.trim());
		if (parts.length < 3) return null;
		const r = Number.parseFloat(parts[0]);
		const g = Number.parseFloat(parts[1]);
		const b = Number.parseFloat(parts[2]);
		const a = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
		if (![r, g, b, a].every(Number.isFinite)) return null;
		return {
			r: Math.max(0, Math.min(255, Math.round(r))),
			g: Math.max(0, Math.min(255, Math.round(g))),
			b: Math.max(0, Math.min(255, Math.round(b))),
			a: Math.max(0, Math.min(1, a)),
		};
	}

	private mixCalendarColors(from: CalendarResolvedColor, to: CalendarResolvedColor, amount: number): CalendarResolvedColor {
		const weight = Math.max(0, Math.min(1, amount));
		return {
			r: Math.round(from.r + (to.r - from.r) * weight),
			g: Math.round(from.g + (to.g - from.g) * weight),
			b: Math.round(from.b + (to.b - from.b) * weight),
			a: from.a + (to.a - from.a) * weight,
		};
	}

	private withCalendarAlpha(color: CalendarResolvedColor, alpha: number): CalendarResolvedColor {
		return {
			...color,
			a: Math.max(0, Math.min(1, alpha)),
		};
	}

	private serializeCalendarColor(color: CalendarResolvedColor): string {
		if (Math.abs(color.a - 1) < 0.001) {
			return `rgb(${color.r}, ${color.g}, ${color.b})`;
		}
		return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`;
	}

	private getCalendarColorLuminance(color: CalendarResolvedColor): number {
		const convert = (value: number): number => {
			const normalized = value / 255;
			return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
		};
		return (0.2126 * convert(color.r)) + (0.7152 * convert(color.g)) + (0.0722 * convert(color.b));
	}

	private formatTimedRange(item: CalendarItem, settings: OperonSettings): string {
		if (!item.startDateTime || !item.endDateTime) return '';
		return `${formatUiTime(this.app, settings, item.startDateTime)} - ${formatUiTime(this.app, settings, item.endDateTime)}`;
	}

	private formatTimedGuideLabel(dateKey: string, minuteOfDay: number, settings: OperonSettings): string {
		return formatUiTime(this.app, settings, this.buildDateMinuteValue(dateKey, minuteOfDay));
	}

	private formatTimedDragLabel(
		dateKey: string,
		startMinutes: number,
		endMinutes: number,
		settings: OperonSettings,
	): string {
		const startValue = this.buildDateMinuteValue(dateKey, startMinutes);
		const endValue = this.buildDateMinuteValue(dateKey, endMinutes);
		const dayLabel = this.formatDayLabel(dateKey);
		return `${dayLabel} ${formatUiTime(this.app, settings, startValue)} - ${formatUiTime(this.app, settings, endValue)}`;
	}

	private formatRangeLabel(visibleDates: string[]): string {
		if (visibleDates.length === 0) return '';
		const start = this.parseDateKey(visibleDates[0]);
		const end = this.parseDateKey(visibleDates[visibleDates.length - 1]);
		if (!start || !end) return visibleDates[0];

		const locale = getAppLocale(this.app);
		const sameYear = start.getFullYear() === end.getFullYear();
		const sameMonth = sameYear && start.getMonth() === end.getMonth();
		const startFormatter = new Intl.DateTimeFormat(locale, {
			month: 'short',
			day: 'numeric',
		});
		const endFormatter = new Intl.DateTimeFormat(locale, {
			month: sameMonth ? undefined : 'short',
			day: 'numeric',
			year: sameYear ? undefined : 'numeric',
		});
		return visibleDates.length === 1
			? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(start)
			: `${startFormatter.format(start)} - ${endFormatter.format(end)}`;
	}

	private getMultiWeekVisibleDaySpan(preset: CalendarPreset): number {
		return preset.showWeekends ? 7 : 5;
	}

	private getMultiWeekVisibleDayCount(preset: CalendarPreset): number {
		return this.getMultiWeekVisibleDaySpan(preset) * Math.max(1, preset.weekCount || 2);
	}

	private buildMultiWeekGroups(visibleDates: string[], preset: CalendarPreset): CalendarMultiWeekGroup[] {
		const groupSize = Math.max(1, this.getMultiWeekVisibleDaySpan(preset));
		const groups: CalendarMultiWeekGroup[] = [];
		for (let index = 0; index < visibleDates.length; index += groupSize) {
			groups.push({
				visibleDates: visibleDates.slice(index, index + groupSize),
			});
		}
		return groups;
	}

	private getMultiWeekFocusedWeekNumber(preset: CalendarPreset): 1 | 2 | 3 | 4 | 5 | 6 {
		const safeWeekCount = Math.max(1, Math.min(6, preset.weekCount || 2)) as 1 | 2 | 3 | 4 | 5 | 6;
		const focused = preset.focusedWeekNumber ?? 1;
		return Math.max(1, Math.min(safeWeekCount, focused)) as 1 | 2 | 3 | 4 | 5 | 6;
	}

	private alignCalendarDateToWeekStart(dateKey: string, weekStart: 'monday' | 'sunday'): string {
		const parsed = this.parseDateKey(dateKey);
		if (!parsed) return dateKey;
		const currentDay = parsed.getDay();
		const offset = weekStart === 'sunday'
			? currentDay
			: (currentDay + 6) % 7;
		const aligned = new Date(parsed);
		aligned.setDate(aligned.getDate() - offset);
		return this.formatDateKey(aligned);
	}

	private resolveMultiWeekRangeStart(
		anchorDate: string,
		preset: CalendarPreset,
		weekStart: 'monday' | 'sunday',
	): string {
		const focusedWeekStart = this.alignCalendarDateToWeekStart(anchorDate, weekStart);
		const weeksBefore = this.getMultiWeekFocusedWeekNumber(preset) - 1;
		return shiftCalendarDateKey(focusedWeekStart, -(weeksBefore * 7));
	}

	private resolveCalendarFieldLabel(fieldKey: string): string {
		return this.getSettings().keyMappings.find(mapping => mapping.canonicalKey === fieldKey)?.visiblePropertyName?.trim() || fieldKey;
	}

	private renderMultiWeekTimeChip(
		container: HTMLElement,
		fieldKey: 'datetimeStart' | 'datetimeEnd',
		dateKey: string,
		minuteOfDay: number,
		settings: OperonSettings,
	): void {
		const chip = container.createSpan('operon-calendar-multi-week-time-chip');
		const iconName = getConfiguredKeyMappingIcon(fieldKey, settings.keyMappings);
		if (iconName) {
			const iconWrap = chip.createSpan('operon-calendar-multi-week-time-chip-icon');
			setIcon(iconWrap, iconName);
		}
		const label = this.resolveCalendarFieldLabel(fieldKey);
		const value = formatUiTime(this.app, settings, this.buildDateMinuteValue(dateKey, minuteOfDay));
		bindOperonHoverTooltip(chip, {
			content: `${label} ${value}`,
			taskColor: null,
		});
		setAccessibleLabelWithoutTooltip(chip, `${label} ${value}`);
		chip.createSpan({
			text: value,
			cls: 'operon-calendar-multi-week-time-chip-label',
		});
	}

	private resolveMultiWeekAllDayDropTarget(
		clientX: number,
		clientY: number,
	): { context: CalendarAllDayDropContext; column: number; dateKey: string } | null {
		for (const context of this.multiWeekAllDayDropContexts) {
			const rect = context.body.getBoundingClientRect();
			const inside = clientX >= rect.left
				&& clientX <= rect.right
				&& clientY >= rect.top
				&& clientY <= rect.bottom;
			if (!inside) continue;
			const column = this.resolveAllDayColumnIndex(context.body, clientX, context.visibleDates.length);
			const dateKey = context.visibleDates[column];
			if (!dateKey) continue;
			return { context, column, dateKey };
		}
		return null;
	}

	private setMobileAllDayDropHighlight(context: CalendarAllDayDropContext | null, column: number): void {
		if (!context?.isMobile || !context.cells) return;
		const safeColumn = Math.max(0, Math.min(context.cells.length - 1, column));
		if (context.activeColumn === safeColumn) return;
		this.clearMobileAllDayDropHighlight(context);
		context.activeColumn = safeColumn;
		context.cells[safeColumn]?.addClass('is-drop-target');
	}

	private clearMobileAllDayDropHighlight(context: CalendarAllDayDropContext | null): void {
		if (!context?.isMobile || !context.cells) return;
		for (const cell of context.cells) {
			cell.removeClass('is-drop-target');
		}
		context.activeColumn = null;
	}

	private resolveMultiWeekInDayDropTarget(
		clientX: number,
		clientY: number,
	): { context: CalendarMultiWeekInDayDropContext; dayIndex: number; dateKey: string } | null {
		for (const context of this.multiWeekInDayDropContexts) {
			const rect = context.body.getBoundingClientRect();
			const inside = clientX >= rect.left
				&& clientX <= rect.right
				&& clientY >= rect.top
				&& clientY <= rect.bottom;
			if (!inside) continue;
			const dayIndex = this.resolveAllDayColumnIndex(context.body, clientX, context.visibleDates.length);
			const dateKey = context.visibleDates[dayIndex];
			if (!dateKey) continue;
			return { context, dayIndex, dateKey };
		}
		return null;
	}

	private formatFocusedDateButtonLabel(dateKey: string): string {
		const date = this.parseDateKey(dateKey) ?? this.parseDateKey(localToday()) ?? new Date();
		return new Intl.DateTimeFormat(undefined, {
			day: 'numeric',
			month: 'long',
		}).format(date);
	}

	private formatWeekdayLabel(dateKey: string): string {
		const date = this.parseDateKey(dateKey);
		if (!date) return dateKey;
		return new Intl.DateTimeFormat(getAppLocale(this.app), {
			weekday: 'short',
		}).format(date);
	}

	private formatDayLabel(dateKey: string): string {
		const date = this.parseDateKey(dateKey);
		if (!date) return dateKey;
		return new Intl.DateTimeFormat(getAppLocale(this.app), {
			month: 'short',
			day: 'numeric',
		}).format(date);
	}

	private buildTimedMetrics(preset: CalendarPreset, isHiddenExpanded: boolean): CalendarTimedMetrics {
		const hiddenRange = this.resolveHiddenTimeRange(preset);
		const scale = Math.max(0.5, Math.min(4, this.getSettings().calendarTimeGridScale || 2));
		const collapsedBandHeight = hiddenRange.enabled && !isHiddenExpanded
			? Math.max(16, Math.round(32 * scale))
			: 0;
		const hiddenMinutes = hiddenRange.enabled && !isHiddenExpanded
			? hiddenRange.endMinutes - hiddenRange.startMinutes
			: 0;
		return {
			hiddenRange,
			isHiddenExpanded,
			scale,
			collapsedBandHeight,
			gridHeight: Math.max(240, Math.round(((24 * 60) - hiddenMinutes) * scale) + collapsedBandHeight),
		};
	}

	private resolveHiddenTimeRange(preset: CalendarPreset): CalendarHiddenTimeRange {
		const startMinutes = this.parseClockMinutes(preset.hiddenTimeStart);
		const endMinutes = this.parseClockMinutes(preset.hiddenTimeEnd);
		if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
			return { enabled: false, startMinutes: 0, endMinutes: 0 };
		}
		return { enabled: true, startMinutes, endMinutes };
	}

	private parseClockMinutes(value: string | null | undefined): number | null {
		const match = /^(\d{2}):(\d{2})$/.exec((value ?? '').trim());
		if (!match) return null;
		const hour = Number.parseInt(match[1], 10);
		const minute = Number.parseInt(match[2], 10);
		if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
			return null;
		}
		return (hour * 60) + minute;
	}

	private isHiddenMinute(minuteOfDay: number, range: CalendarHiddenTimeRange): boolean {
		return range.enabled && minuteOfDay > range.startMinutes && minuteOfDay < range.endMinutes;
	}

	private minuteToGridOffset(minuteOfDay: number, metrics: CalendarTimedMetrics): number {
		const clamped = Math.max(0, Math.min(24 * 60, Math.round(minuteOfDay)));
		if (!metrics.hiddenRange.enabled || metrics.isHiddenExpanded) return clamped * metrics.scale;
		if (clamped <= metrics.hiddenRange.startMinutes) return clamped * metrics.scale;
		if (clamped >= metrics.hiddenRange.endMinutes) {
			return (metrics.hiddenRange.startMinutes * metrics.scale) + metrics.collapsedBandHeight + ((clamped - metrics.hiddenRange.endMinutes) * metrics.scale);
		}
		const hiddenDuration = Math.max(1, metrics.hiddenRange.endMinutes - metrics.hiddenRange.startMinutes);
		const ratio = (clamped - metrics.hiddenRange.startMinutes) / hiddenDuration;
		return (metrics.hiddenRange.startMinutes * metrics.scale) + (metrics.collapsedBandHeight * ratio);
	}

	private gridOffsetToMinute(offset: number, metrics: CalendarTimedMetrics): number {
		const clamped = Math.max(0, Math.min(metrics.gridHeight, Math.round(offset)));
		if (!metrics.hiddenRange.enabled || metrics.isHiddenExpanded) {
			return Math.round(clamped / metrics.scale);
		}
		const bandStart = metrics.hiddenRange.startMinutes * metrics.scale;
		const bandEnd = bandStart + metrics.collapsedBandHeight;
		if (clamped <= bandStart) return Math.round(clamped / metrics.scale);
		if (clamped >= bandEnd) {
			return Math.round(metrics.hiddenRange.endMinutes + ((clamped - bandEnd) / metrics.scale));
		}
		return clamped - bandStart <= bandEnd - clamped
			? metrics.hiddenRange.startMinutes
			: metrics.hiddenRange.endMinutes;
	}

	private parseDateKey(dateKey: string): Date | null {
		const [year, month, day] = dateKey.split('-').map(part => Number.parseInt(part, 10));
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
		return new Date(year, month - 1, day, 12, 0, 0, 0);
	}

	private diffCalendarDateKeys(fromDate: string, toDate: string): number {
		const from = this.parseDateKey(fromDate);
		const to = this.parseDateKey(toDate);
		if (!from || !to) return 0;
		return Math.round((to.getTime() - from.getTime()) / 86400000);
	}

	private formatDateKey(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	private resolveTimedMinuteOffset(column: HTMLElement, clientY: number, metrics: CalendarTimedMetrics): number {
		const rect = column.getBoundingClientRect();
		if (rect.height <= 0) return 0;
		const relativeY = Math.max(0, Math.min(metrics.gridHeight, clientY - rect.top));
		return this.gridOffsetToMinute(relativeY, metrics);
	}

	private resolveTimedGridPosition(
		daysGrid: HTMLElement,
		visibleDates: string[],
		metrics: CalendarTimedMetrics,
		clientX: number,
		clientY: number,
	): { dayIndex: number; minuteOfDay: number } {
		const rect = daysGrid.getBoundingClientRect();
		const width = Math.max(1, rect.width);
		const relativeX = Math.max(0, Math.min(width - 1, clientX - rect.left));
		const relativeY = Math.max(0, Math.min(metrics.gridHeight, clientY - rect.top));
		return {
			dayIndex: Math.max(0, Math.min(
				visibleDates.length - 1,
				Math.floor((relativeX / width) * visibleDates.length),
			)),
			minuteOfDay: Math.max(0, Math.min(24 * 60, this.gridOffsetToMinute(relativeY, metrics))),
		};
	}

	private renderTimedSelectionGuides(
		section: HTMLElement,
		gutter: HTMLElement,
		targetGrid: HTMLElement,
		overlay: HTMLElement,
		dateKey: string,
		startMinutes: number,
		endMinutes: number,
		metrics: CalendarTimedMetrics,
		accent: string,
		settings: OperonSettings,
		dayIndex = 0,
		totalDays = 1,
	): void {
		const sectionRect = section.getBoundingClientRect();
		const gutterRect = gutter.getBoundingClientRect();
		const gridRect = targetGrid.getBoundingClientRect();
		const left = Math.max(0, gutterRect.right - sectionRect.left);
		const dayWidth = gridRect.width / Math.max(1, totalDays);
		const blockLeft = (gridRect.left - sectionRect.left) + (dayIndex * dayWidth);
		const right = Math.max(left, blockLeft);
		const width = Math.max(0, right - left);
		overlay.empty();

		const createGuide = (minuteOfDay: number, labelSide: 'start' | 'end'): void => {
			const guide = overlay.createDiv('operon-calendar-hover-guide is-edit-guide');
			const top = (gridRect.top - sectionRect.top) + this.minuteToGridOffset(minuteOfDay, metrics);
			const labelCenter = Math.max(0, blockLeft + (dayWidth / 2) - left);
			guide.style.top = `${Math.max(0, top)}px`;
			guide.style.left = `${left}px`;
			guide.style.width = `${width}px`;
			guide.style.setProperty('--operon-calendar-guide-color', accent);
			const labelEl = guide.createSpan({
				text: this.formatTimedGuideLabel(dateKey, minuteOfDay, settings),
				cls: `operon-calendar-hover-guide-label is-${labelSide}`,
			});
			labelEl.style.left = `${labelCenter}px`;
		};

		createGuide(startMinutes, 'start');
		createGuide(endMinutes, 'end');
	}

	private resolveCalendarTaskDurationMinutes(item: CalendarItem, fallbackSlotMinutes: number): number {
		const timedDuration = item.startDateTime && item.endDateTime
			? Math.max(CALENDAR_TIMED_SNAP_MINUTES, this.extractMinuteOfDay(item.endDateTime) - this.extractMinuteOfDay(item.startDateTime))
			: 0;
		if (timedDuration > 0) return timedDuration;
		const estimateRaw = Number.parseInt((item.renderSnapshot.fieldValues['estimate'] ?? '').trim(), 10);
		if (Number.isFinite(estimateRaw) && estimateRaw > 0) {
			return Math.max(CALENDAR_TIMED_SNAP_MINUTES, estimateRaw / 60);
		}
		return Math.max(CALENDAR_TIMED_SNAP_MINUTES, fallbackSlotMinutes);
	}

	private resolveIndexedTaskDurationMinutes(task: IndexedTask, fallbackSlotMinutes: number): number {
		const datetimeStart = (task.fieldValues['datetimeStart'] ?? '').trim();
		const datetimeEnd = (task.fieldValues['datetimeEnd'] ?? '').trim();
		if (datetimeStart && datetimeEnd) {
			return Math.max(
				CALENDAR_TIMED_SNAP_MINUTES,
				this.extractMinuteOfDay(datetimeEnd) - this.extractMinuteOfDay(datetimeStart),
			);
		}
		const estimateRaw = Number.parseInt((task.fieldValues['estimate'] ?? '').trim(), 10);
		if (Number.isFinite(estimateRaw) && estimateRaw > 0) {
			return Math.max(CALENDAR_TIMED_SNAP_MINUTES, estimateRaw / 60);
		}
		return Math.max(CALENDAR_TIMED_SNAP_MINUTES, fallbackSlotMinutes);
	}

	private resolveAllDayColumnIndex(container: HTMLElement, clientX: number, columnCount: number): number {
		const rect = container.getBoundingClientRect();
		if (rect.width <= 0 || columnCount <= 1) return 0;
		const relativeX = Math.max(0, Math.min(rect.width - 1, clientX - rect.left));
		return Math.max(0, Math.min(columnCount - 1, Math.floor((relativeX / rect.width) * columnCount)));
	}

	private applyAllDayPlacementStyle(
		element: HTMLElement,
		startColumn: number,
		endColumn: number,
		lane: number,
		laneHeight: number,
		totalColumns: number,
	): void {
		element.style.top = `${lane * laneHeight + 2}px`;
		element.style.left = `${(startColumn / totalColumns) * 100}%`;
		element.style.width = `${((endColumn - startColumn + 1) / totalColumns) * 100}%`;
		element.style.height = `${laneHeight - 4}px`;
	}

	private attachNowIndicator(
		column: HTMLElement,
		metrics: CalendarTimedMetrics,
		options: { showLabel?: boolean; labelSpan?: number } = {},
	): void {
		const lineEl = column.createDiv('operon-calendar-now-line');
		const showLabel = options.showLabel !== false;
		const labelSpan = Math.max(1, options.labelSpan ?? 1);
		let labelEl: HTMLElement | null = null;
		if (showLabel) {
			labelEl = lineEl.createDiv('operon-calendar-now-label');
			if (labelSpan > 1) {
				lineEl.addClass('is-shared-day-label');
				lineEl.style.setProperty('--operon-calendar-now-label-span', String(labelSpan));
			}
		} else {
			lineEl.addClass('is-label-suppressed');
		}
		this.nowIndicatorEntries.push({
			lineEl,
			labelEl,
			metrics,
		});
	}

	private updateNowIndicators(): void {
		if (this.nowIndicatorEntries.length === 0) return;
		const now = new Date();
		const minuteOfDay = now.getHours() * 60 + now.getMinutes();
		const label = formatUiMinuteOfDay(this.app, this.getSettings(), localToday(), minuteOfDay);

		for (const entry of this.nowIndicatorEntries) {
			entry.lineEl.style.top = `${this.minuteToGridOffset(minuteOfDay, entry.metrics)}px`;
			entry.labelEl?.setText(label);
		}
	}

	private extractMinuteOfDay(datetimeValue: string): number {
		const hour = Number.parseInt(datetimeValue.slice(11, 13), 10);
		const minute = Number.parseInt(datetimeValue.slice(14, 16), 10);
		if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
		return Math.max(0, Math.min(24 * 60, hour * 60 + minute));
	}

	private buildDateMinuteValue(dateKey: string, minuteOfDay: number): string {
		const clamped = Math.max(0, Math.min(24 * 60, Math.round(minuteOfDay)));
		if (clamped >= 24 * 60) {
			return `${dateKey}T23:59:00`;
		}
		const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
		const minutes = String(clamped % 60).padStart(2, '0');
		return `${dateKey}T${hours}:${minutes}:00`;
	}

	private canEditCalendarItemPlacement(item: CalendarItem): boolean {
		return item.origin !== 'external'
			&& item.repeatRef?.projectionKind !== 'doneRolling'
			&& item.startDate === item.endDate;
	}

	private bindPrimaryItemClick(container: HTMLElement, item: CalendarItem): void {
		if (item.origin !== 'external' && !this.callbacks.onItemAction) return;
		if (item.origin === 'external' && !this.callbacks.onExternalItemCreateTask) return;
		container.tabIndex = 0;
		container.addClass('is-clickable');
		container.addEventListener('click', (event) => {
			const target = asHTMLElement(event.target, container);
			if (target?.closest('.operon-calendar-hover-menu')) return;
			if (target?.closest('a.internal-link')) return;
			if (container.dataset.suppressCalendarClick === 'true') {
				delete container.dataset.suppressCalendarClick;
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (item.origin === 'external') {
				const seed = this.buildExternalItemCreateSeed(item);
				if (!seed) return;
				void this.callbacks.onExternalItemCreateTask?.(seed);
				return;
			}
			void this.callbacks.onItemAction?.(item.taskId, 'openEditor');
		});
		container.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			if (item.origin === 'external') {
				const seed = this.buildExternalItemCreateSeed(item);
				if (!seed) return;
				void this.callbacks.onExternalItemCreateTask?.(seed);
				return;
			}
			void this.callbacks.onItemAction?.(item.taskId, 'openEditor');
		});
	}

	private buildExternalItemCreateSeed(item: CalendarItem): ExternalCalendarTaskSeed | null {
		if (item.origin !== 'external' || !item.externalRef) return null;
		const title = item.renderSnapshot.description || item.taskId;
		if (item.kind === 'timed' && item.startDateTime && item.endDateTime) {
			return {
				itemId: item.taskId,
				title,
				externalRef: item.externalRef,
				selection: {
					mode: 'timed',
					start: item.startDateTime,
					end: item.endDateTime,
					startDate: item.startDate,
					endDate: item.endDate,
					isAllDay: false,
					slotMinutes: undefined,
				},
			};
		}
		return {
			itemId: item.taskId,
			title,
			externalRef: item.externalRef,
			selection: buildAllDaySlotSelection(item.startDate, item.endDate),
		};
	}

	private buildCreatedExternalEventTaskKeySet(tasks: IndexedTask[]): Set<string> {
		const keys = new Set<string>();
		for (const task of tasks) {
			const key = this.buildExternalEventTaskMatchKey(task.description, task.fieldValues['dateScheduled'] ?? '');
			if (key) keys.add(key);
		}
		return keys;
	}

	private buildExternalEventTaskMatchKey(description: string, dateKey: string): string | null {
		const normalizedDate = dateKey.trim();
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalizedDate)) return null;
		const normalizedDescription = description
			.trim()
			.toLocaleLowerCase()
			.replace(/\s+/gu, ' ');
		if (!normalizedDescription) return null;
		return `${normalizedDate}::${normalizedDescription}`;
	}

	private createToolbarButton(
		container: HTMLElement,
		label: string,
		onClick: () => void,
		title?: string,
		extraClass?: string,
	): void {
		const button = container.createEl('button', {
			text: label,
			cls: `operon-calendar-toolbar-button${extraClass ? ` ${extraClass}` : ''}`,
		});
		if (title) bindOperonHoverTooltip(button, { content: title, taskColor: null });
		button.addEventListener('click', onClick);
	}

	private async handleTodayButtonClick(state: CalendarLeafState, preset: CalendarPreset): Promise<void> {
		const today = localToday();
		if (state.anchorDate !== today) {
			await this.updateLeafState({ ...state, anchorDate: today });
			return;
		}
		if (!this.isTimeGridCompatibleSurface(preset)) {
			return;
		}

		this.lastAppliedScrollSignature = null;
		this.scheduleInitialScroll({ ...state, anchorDate: today }, preset, this.renderGeneration, true);
	}

	private buildTimedHorizontalRenderWindow(
		anchorDate: string,
		preset: Pick<CalendarPreset, 'dayCount' | 'showWeekends' | 'todayPosition'>,
		visibleDates: string[],
	): TimedHorizontalRenderWindow {
		const visibleDayCount = Math.max(1, visibleDates.length || preset.dayCount || 1);
		const bufferDaysPerSide = Math.max(visibleDayCount, 3);
		const bufferedDates = buildVisibleCalendarDates(
			anchorDate,
			visibleDayCount + (bufferDaysPerSide * 2),
			preset.showWeekends,
			bufferDaysPerSide + 1,
		);
		const visibleStartBufferIndex = resolveTimedHorizontalVisibleStartIndex(
			bufferedDates,
			visibleDates,
			anchorDate,
			bufferDaysPerSide,
		);
		return {
			anchorDate,
			visibleDates: [...visibleDates],
			bufferedDates,
			visibleStartBufferIndex,
			bufferDaysBefore: bufferDaysPerSide,
			bufferDaysAfter: bufferDaysPerSide,
		};
	}

	private handleTimedHorizontalWheel(event: WheelEvent): void {
		if (!this.timedHorizontalRenderWindow || !this.timedHorizontalStripEl || !this.timedHorizontalClipEl) return;
		if (this.hasActiveTimedHorizontalEditInteraction()) return;
		const horizontal = Math.abs(event.deltaX);
		const vertical = Math.abs(event.deltaY);
		if (horizontal < 1 && vertical < 1) return;
		const dominanceRatio = 1.2;
		const nowTs = Date.now();
		this.timedHorizontalGesture.lastWheelTs = nowTs;
		if (!this.timedHorizontalGesture.axisLock) {
			if (horizontal >= 4 && horizontal >= vertical * dominanceRatio) {
				this.timedHorizontalGesture.axisLock = 'horizontal';
			} else if (vertical >= horizontal * dominanceRatio) {
				this.timedHorizontalGesture.axisLock = 'vertical';
			} else {
				return;
			}
		}
		this.scheduleTimedHorizontalGestureReset();
		if (this.timedHorizontalGesture.axisLock !== 'horizontal') {
			return;
		}

		event.preventDefault();
		this.hideCalendarHoverMenu(true);
		this.timedDropContext?.hoverGuideOverlay.empty();
		this.clearTimedHorizontalSnapTimer();
		this.syncTimedHorizontalPanMetrics();
		const dampingFactor = 0.55;
		this.timedHorizontalGesture.offsetPx = this.clampTimedHorizontalOffset(
			this.timedHorizontalGesture.offsetPx + (event.deltaX * dampingFactor),
		);
		this.applyTimedHorizontalPanTransform(false);
		this.scheduleTimedHorizontalSnapFinalize();
	}

	private async shiftCalendarAnchorByDays(dayDelta: number, preserveScroll = false): Promise<void> {
		if (!dayDelta) return;
		const state = this.ensureState();
		const nextState: Partial<CalendarLeafState> = {
			...state,
			anchorDate: shiftCalendarDateKey(state.anchorDate, dayDelta),
		};
		if (preserveScroll && this.timedScrollEl) {
			const preset = this.getSettings().calendarPresets.find(entry => entry.id === state.presetId) ?? this.getSettings().calendarPresets[0];
			if (preset) {
				const hiddenTimeKey = `${preset.id}|${state.anchorDate}`;
				const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
				nextState.scrollMinutes = this.gridOffsetToMinute(Math.max(0, Math.round(this.timedScrollEl.scrollTop)), metrics);
				this.restoreScrollOnNextRender = true;
			}
		}
		await this.updateLeafState(nextState);
	}

		private hasActiveTimedHorizontalEditInteraction(): boolean {
			const section = this.timedDropContext?.section;
			if (!section) return false;
			return !!section.querySelector('.operon-calendar-timed-item.is-live-editing, .operon-calendar-timed-day.is-selecting');
		}

		hasActiveCalendarDragInteraction(): boolean {
			return !!this.activeCalendarDragSession || this.hasActiveTimedHorizontalEditInteraction();
		}

		private scheduleTimedHorizontalGestureReset(): void {
			if (this.timedHorizontalGesture.resetTimer) {
				window.clearTimeout(this.timedHorizontalGesture.resetTimer);
		}
		this.timedHorizontalGesture.resetTimer = window.setTimeout(() => {
			this.timedHorizontalGesture.resetTimer = null;
			this.timedHorizontalGesture.axisLock = null;
		}, 120);
	}

	private scheduleTimedHorizontalSnapFinalize(): void {
		this.clearTimedHorizontalSnapTimer();
		this.timedHorizontalGesture.snapTimer = window.setTimeout(() => {
			this.timedHorizontalGesture.snapTimer = null;
			void this.finalizeTimedHorizontalSnap();
		}, 140);
	}

	private clearTimedHorizontalSnapTimer(): void {
		if (!this.timedHorizontalGesture.snapTimer) return;
		window.clearTimeout(this.timedHorizontalGesture.snapTimer);
		this.timedHorizontalGesture.snapTimer = null;
	}

	private clearTimedHorizontalGestureTimers(): void {
		this.clearTimedHorizontalSnapTimer();
		if (this.timedHorizontalGesture.resetTimer) {
			window.clearTimeout(this.timedHorizontalGesture.resetTimer);
			this.timedHorizontalGesture.resetTimer = null;
		}
	}

	private bindLayoutRefresh(root: HTMLElement): void {
		const generation = this.renderGeneration;
		const refresh = (): void => {
			const clipWidth = this.timedHorizontalClipEl?.getBoundingClientRect().width ?? 0;
			if (!root.isConnected || clipWidth <= 0) return;
			this.syncTimedHorizontalPanMetrics();
			this.applyTimedHorizontalPanTransform(false);
		};
		const scheduleRefresh = (): void => {
			if (this.layoutRefreshFrame !== null) return;
			this.layoutRefreshFrame = this.requestRenderAnimationFrame(generation, () => {
				this.layoutRefreshFrame = null;
				refresh();
			});
		};

		this.layoutRefreshCleanup?.();
		this.layoutRefreshCleanup = null;
		scheduleRefresh();
		this.requestRenderAnimationFrame(generation, scheduleRefresh);
		this.requestRenderAnimationFrame(generation, () => this.requestRenderAnimationFrame(generation, scheduleRefresh));
		this.setRenderTimeout(generation, scheduleRefresh, 0);
		this.setRenderTimeout(generation, scheduleRefresh, 120);

		const observer = new ResizeObserver(() => scheduleRefresh());
		observer.observe(root);
		if (this.timedHorizontalClipEl) observer.observe(this.timedHorizontalClipEl);
		this.layoutRefreshCleanup = () => observer.disconnect();
	}

	private syncTimedHorizontalPanMetrics(): void {
		if (!this.timedHorizontalRenderWindow || !this.timedHorizontalClipEl) return;
		const visibleDayCount = Math.max(1, this.timedHorizontalRenderWindow.visibleDates.length);
		const clipWidth = this.timedHorizontalClipEl.getBoundingClientRect().width;
		this.timedHorizontalDayWidthPx = clipWidth > 0
			? clipWidth / visibleDayCount
			: 0;
	}

	private clampTimedHorizontalOffset(offsetPx: number): number {
		if (!this.timedHorizontalRenderWindow || this.timedHorizontalDayWidthPx <= 0) return offsetPx;
		const { minOffset, maxOffset } = resolveTimedHorizontalOffsetBounds(
			this.timedHorizontalRenderWindow.bufferedDates.length,
			this.timedHorizontalRenderWindow.visibleDates.length,
			this.timedHorizontalRenderWindow.visibleStartBufferIndex,
			this.timedHorizontalDayWidthPx,
		);
		return Math.max(minOffset, Math.min(maxOffset, offsetPx));
	}

	private applyTimedHorizontalPanTransform(withSnapAnimation: boolean): void {
		if (!this.timedHorizontalRenderWindow || !this.timedHorizontalStripEl) return;
		this.syncTimedHorizontalPanMetrics();
		const baseOffsetPx = this.timedHorizontalRenderWindow.visibleStartBufferIndex * this.timedHorizontalDayWidthPx;
		const translatePx = -(baseOffsetPx + this.timedHorizontalGesture.offsetPx);
		this.timedHorizontalStripEl.classList.toggle('is-horizontal-snapping', withSnapAnimation);
		this.timedHorizontalStripEl.style.transform = `translate3d(${translatePx}px, 0, 0)`;
		this.timedHorizontalLabelStripEl?.classList.toggle('is-horizontal-snapping', withSnapAnimation);
		if (this.timedHorizontalLabelStripEl) {
			this.timedHorizontalLabelStripEl.style.transform = `translate3d(${translatePx}px, 0, 0)`;
		}
	}

	private async finalizeTimedHorizontalSnap(): Promise<void> {
		if (!this.timedHorizontalRenderWindow || !this.timedHorizontalStripEl) return;
		this.syncTimedHorizontalPanMetrics();
		if (this.timedHorizontalDayWidthPx <= 0) {
			this.timedHorizontalGesture.axisLock = null;
			this.timedHorizontalGesture.offsetPx = 0;
			return;
		}
		const snappedDayDelta = Math.round(this.timedHorizontalGesture.offsetPx / this.timedHorizontalDayWidthPx);
		this.timedHorizontalGesture.offsetPx = snappedDayDelta * this.timedHorizontalDayWidthPx;
		this.applyTimedHorizontalPanTransform(true);
		await new Promise(resolve => window.setTimeout(resolve, 140));
		this.timedHorizontalGesture.axisLock = null;
		this.timedHorizontalGesture.offsetPx = 0;
		if (snappedDayDelta === 0) {
			this.applyTimedHorizontalPanTransform(false);
			return;
		}
		await this.shiftCalendarAnchorByDays(snappedDayDelta, true);
	}

	private scheduleInitialScroll(state: CalendarLeafState, preset: CalendarPreset, generation: number, force = false): void {
		this.lastAppliedScrollSignature = null;
		const scheduledAt = Date.now();
		this.requestRenderAnimationFrame(generation, () => {
			this.requestRenderAnimationFrame(generation, () => {
				this.setRenderTimeout(generation, () => this.applyInitialScroll(state, preset, generation, 0, scheduledAt, force), 0);
			});
		});
	}

	private applyInitialScroll(state: CalendarLeafState, preset: CalendarPreset, generation: number, attempt = 0, scheduledAt = 0, force = false): void {
		if (!this.isRenderGenerationActive(generation)) return;
		if (!this.timedScrollEl) return;
		if (!force && this.lastTimedGridUserScrollInteractionAt >= scheduledAt) return;
		const settings = this.getSettings();
		const viewportHeight = Math.max(0, Math.round(this.timedScrollEl.clientHeight));
		const hiddenTimeKey = `${preset.id}|${state.anchorDate}`;
		const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
		const shouldAutoScroll = settings.calendarInitialScrollMode === 'autoNow';
		const signature = shouldAutoScroll
			? [
				state.presetId ?? 'none',
				state.anchorDate,
				'autoNow',
				settings.calendarAutoScrollPastRatio,
				settings.calendarTimeGridScale,
				viewportHeight,
				this.expandedHiddenTimeKey === hiddenTimeKey ? 'expanded' : 'collapsed',
			].join('|')
			: [
				state.presetId ?? 'none',
				state.anchorDate,
				'fixedHour',
				settings.calendarDefaultScrollHour,
				settings.calendarTimeGridScale,
				viewportHeight,
				this.expandedHiddenTimeKey === hiddenTimeKey ? 'expanded' : 'collapsed',
			].join('|');
		const nextScrollTop = shouldAutoScroll
			? this.computeAutoScrollTopFromBottom(metrics, settings.calendarAutoScrollPastRatio)
			: this.minuteToGridOffset(Math.max(0, Math.min(24 * 60, Math.round(settings.calendarDefaultScrollHour) * 60)), metrics);
		const maxScrollTop = Math.max(0, this.timedScrollEl.scrollHeight - this.timedScrollEl.clientHeight);
		const clampedScrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
		const layoutNotReady = viewportHeight <= 0 || (maxScrollTop <= 0 && clampedScrollTop > 0);
		if (layoutNotReady) {
			if (attempt < 8) {
				this.requestRenderAnimationFrame(generation, () => this.applyInitialScroll(state, preset, generation, attempt + 1, scheduledAt, force));
			}
			return;
		}
		const currentScrollTop = Math.max(0, Math.round(this.timedScrollEl.scrollTop));
		if (this.lastAppliedScrollSignature === signature && Math.abs(currentScrollTop - clampedScrollTop) <= 2) return;
		this.suppressTimedScrollPersistenceForProgrammaticScroll();
		this.timedScrollEl.scrollTop = clampedScrollTop;
		this.lastAppliedScrollSignature = signature;
	}

	private restoreScrollPosition(state: CalendarLeafState, preset: CalendarPreset): void {
		if (!this.timedScrollEl) return;
		const hiddenTimeKey = `${preset.id}|${state.anchorDate}`;
		const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
		const nextScrollTop = this.minuteToGridOffset(
			Math.max(0, Math.min(24 * 60, Math.round(state.scrollMinutes))),
			metrics,
		);
		const maxScrollTop = Math.max(0, this.timedScrollEl.scrollHeight - this.timedScrollEl.clientHeight);
		this.suppressTimedScrollPersistenceForProgrammaticScroll();
		this.timedScrollEl.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
	}

	private suppressTimedScrollPersistenceForProgrammaticScroll(): void {
		const now = Date.now();
		this.suppressTimedScrollPersistenceStartedAt = now;
		this.suppressTimedScrollPersistenceUntil = now + 120;
	}

	private shouldSuppressTimedScrollPersistence(): boolean {
		return Date.now() <= this.suppressTimedScrollPersistenceUntil
			&& this.lastTimedGridUserScrollInteractionAt < this.suppressTimedScrollPersistenceStartedAt;
	}

	private captureMultiWeekSurfaceScroll(): void {
		if (!this.surfaceScrollEl) return;
		this.lastSurfaceScrollTop = Math.max(0, Math.round(this.surfaceScrollEl.scrollTop));
		this.restoreSurfaceScrollOnNextRender = true;
	}

	private captureMobileTimeGridScrollForRender(options: MobileTimeGridScrollPreserveOptions = {}): void {
		if (!this.mobileTimeGridScrollEl || !this.mobileTimeGridScrollEl.isConnected) return;
		this.lastMobileTimeGridScrollTop = Math.max(0, Math.round(this.mobileTimeGridScrollEl.scrollTop));
		this.mobileTimeGridScrollRestoreTargetTop = this.lastMobileTimeGridScrollTop;
		this.captureMobileTimeGridOuterScrollTargets();
		this.extendMobileTimeGridScrollRestore(options);
	}

	private getMobileTimeGridScrollRestoreTargetTop(): number {
		return Math.max(0, this.mobileTimeGridScrollRestoreTargetTop ?? this.lastMobileTimeGridScrollTop);
	}

	private applyMobileTimeGridScrollTop(viewport: HTMLElement, scrollTop: number): void {
		const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
		viewport.scrollTop = Math.max(0, Math.min(maxScrollTop, Math.round(scrollTop)));
	}

	private getMobileTimeGridOuterScrollElements(): HTMLElement[] {
		const elements: HTMLElement[] = [];
		const addElement = (element: HTMLElement | null | undefined): void => {
			if (!element || elements.includes(element)) return;
			elements.push(element);
		};
		addElement(this.contentEl);
		let ancestor = this.contentEl.parentElement;
		while (ancestor) {
			if (ancestor.scrollTop > 0 || ancestor.scrollHeight > ancestor.clientHeight + 1) {
				addElement(ancestor);
			}
			ancestor = ancestor.parentElement;
		}
		const scrollingElement = asHTMLElement(getOwnerDocument(this.contentEl).scrollingElement);
		if (scrollingElement) addElement(scrollingElement);
		return elements;
	}

	private captureMobileTimeGridOuterScrollTargets(): void {
		this.mobileTimeGridOuterScrollRestoreTargets.clear();
		for (const element of this.getMobileTimeGridOuterScrollElements()) {
			this.mobileTimeGridOuterScrollRestoreTargets.set(element, Math.max(0, Math.round(element.scrollTop)));
		}
	}

	private applyMobileTimeGridOuterScrollTargets(): void {
		for (const [element, scrollTop] of this.mobileTimeGridOuterScrollRestoreTargets.entries()) {
			if (!element.isConnected) {
				this.mobileTimeGridOuterScrollRestoreTargets.delete(element);
				continue;
			}
			const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
			element.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollTop));
		}
	}

	private scheduleMobileTimeGridScrollRestoreStabilization(
		viewport: HTMLElement,
		generation: number,
		scrollTop: number,
	): void {
		const applyScroll = (): void => {
			if (!this.isRenderGenerationActive(generation)) return;
			if (!viewport.isConnected) return;
			if (!this.hasPendingMobileTimeGridScrollRestore()) return;
			this.applyMobileTimeGridScrollTop(viewport, scrollTop);
			this.applyMobileTimeGridOuterScrollTargets();
		};
		this.requestRenderAnimationFrame(generation, () => {
			applyScroll();
			this.requestRenderAnimationFrame(generation, applyScroll);
		});
		for (const delay of CALENDAR_MOBILE_SCROLL_RESTORE_STABILIZATION_DELAYS_MS) {
			this.setRenderTimeout(generation, applyScroll, delay);
		}
	}

	private hasPendingMobileTimeGridScrollRestore(): boolean {
		return this.restoreMobileTimeGridScrollOnNextRender
			|| this.mobileTimeGridScrollRestoreBudget > 0
			|| Date.now() <= this.mobileTimeGridScrollRestoreUntil;
	}

	private extendMobileTimeGridScrollRestore(options: MobileTimeGridScrollPreserveOptions = {}): void {
		this.restoreMobileTimeGridScrollOnNextRender = true;
		const minRenderBudget = Math.max(2, Math.round(options.minRenderBudget ?? 2));
		this.mobileTimeGridScrollRestoreBudget = Math.max(this.mobileTimeGridScrollRestoreBudget, minRenderBudget);
		if (options.restoreWindowMs && options.restoreWindowMs > 0) {
			this.mobileTimeGridScrollRestoreUntil = Math.max(
				this.mobileTimeGridScrollRestoreUntil,
				Date.now() + Math.round(options.restoreWindowMs),
			);
		}
	}

	private clearMobileTimeGridScrollRestoreIntent(): void {
		this.restoreMobileTimeGridScrollOnNextRender = false;
		this.mobileTimeGridScrollRestoreBudget = 0;
		this.mobileTimeGridScrollRestoreUntil = 0;
		this.mobileTimeGridScrollRestoreTargetTop = null;
		this.mobileTimeGridOuterScrollRestoreTargets.clear();
	}

	private clearMobileTimeGridScrollRenderIntents(): void {
		this.forceMobileTimeGridSmartScrollOnNextRender = false;
		this.clearMobileTimeGridScrollRestoreIntent();
	}

	private requestMobileTimeGridSmartScrollOnNextRender(): void {
		this.forceMobileTimeGridSmartScrollOnNextRender = true;
		this.clearMobileTimeGridScrollRestoreIntent();
	}

	private captureActiveMultiWeekSurfaceScroll(): void {
		const state = this.state;
		if (!state) return;
		const preset = this.getSettings().calendarPresets.find(entry => entry.id === state.presetId) ?? this.getSettings().calendarPresets[0];
		if (preset?.surfaceType !== 'multiWeek') return;
		this.captureMultiWeekSurfaceScroll();
	}

	private captureActiveCalendarScrollForRender(): void {
		if (this.mobileTimeGridScrollEl?.isConnected) {
			this.preserveMobileTimeGridScrollForNextRender();
			return;
		}
		const state = this.state;
		if (!state) return;
		const preset = this.getSettings().calendarPresets.find(entry => entry.id === state.presetId) ?? this.getSettings().calendarPresets[0];
		if (preset?.surfaceType === 'multiWeek') {
			this.captureMultiWeekSurfaceScroll();
			return;
		}
		if (!this.isTimeGridCompatibleSurface(preset) || !this.timedScrollEl) return;
		const hiddenTimeKey = `${preset.id}|${state.anchorDate}`;
		const metrics = this.buildTimedMetrics(preset, this.expandedHiddenTimeKey === hiddenTimeKey);
		this.state = {
			...this.ensureState(),
			scrollMinutes: this.gridOffsetToMinute(Math.max(0, Math.round(this.timedScrollEl.scrollTop)), metrics),
		};
	}

	private restoreMultiWeekSurfaceScroll(generation: number): void {
		if (!this.surfaceScrollEl) return;
		const applyScroll = (): void => {
			if (!this.isRenderGenerationActive(generation)) return;
			if (!this.surfaceScrollEl) return;
			const maxScrollTop = Math.max(0, this.surfaceScrollEl.scrollHeight - this.surfaceScrollEl.clientHeight);
			this.surfaceScrollEl.scrollTop = Math.max(0, Math.min(maxScrollTop, this.lastSurfaceScrollTop));
		};
		applyScroll();
		this.requestRenderAnimationFrame(generation, () => {
			applyScroll();
			this.requestRenderAnimationFrame(generation, applyScroll);
		});
	}

	private computeAutoScrollTopFromBottom(metrics: CalendarTimedMetrics, pastRatio: number): number {
		if (!this.timedScrollEl) return 0;
		const clampedRatio = Math.max(0, Math.min(1, pastRatio));
		const futureRatio = 1 - clampedRatio;
		const now = new Date();
		const minuteOfDay = now.getHours() * 60 + now.getMinutes();
		const nowOffset = this.minuteToGridOffset(minuteOfDay, metrics);
		const viewportHeight = Math.max(0, this.timedScrollEl.clientHeight);
		const bottomVisibleMinutesHeight = viewportHeight * futureRatio;
		return nowOffset - (viewportHeight - bottomVisibleMinutesHeight);
	}

	private ensureState(): CalendarLeafState {
		this.state = this.syncSidebarOpenSections(this.normalizeState(this.state));
		return this.state;
	}

	private scheduleLeafStatePersistence(): void {
		this.clearPersistStateTimer();
		this.persistStateTimer = window.setTimeout(() => {
			this.persistStateTimer = null;
			void this.persistLeafState();
		}, 240);
	}

	private async updateLeafState(state: Partial<CalendarLeafState>): Promise<void> {
		const previousState = this.state;
		const nextState = this.syncSidebarOpenSections(this.normalizeState({
			...(previousState ?? {}),
			...state,
		}));
		const changed = !this.areLeafStatesEqual(previousState, nextState);
		const activePreset = this.getSettings().calendarPresets.find(entry => entry.id === nextState.presetId) ?? this.getSettings().calendarPresets[0];
		if (changed && this.mobileTimeGridScrollEl?.isConnected) {
			this.captureMobileTimeGridScrollForRender();
		}
		if (changed && activePreset?.surfaceType === 'multiWeek') {
			this.captureMultiWeekSurfaceScroll();
		}
		this.state = nextState;
		this.syncLeafTitle();
		await this.leaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			active: true,
			state: nextState as unknown as Record<string, unknown>,
		});
		if (changed) {
			this.clearScheduledRender();
			this.preserveScrollOnNextRender = false;
			if (this.hasActiveCalendarDragInteraction()) {
				this.pendingRenderAfterCalendarDrag = true;
				return;
			}
			this.render();
		}
	}

	private async persistLeafState(): Promise<void> {
		const nextState = this.ensureState();
		this.syncLeafTitle();
		await this.leaf.setViewState({
			type: CALENDAR_VIEW_TYPE,
			state: nextState as unknown as Record<string, unknown>,
		});
	}

	private async flushPendingLeafStatePersistence(): Promise<void> {
		this.clearPersistStateTimer();
		this.captureActiveCalendarScrollForRender();
		if (!this.state) return;
		await this.persistLeafState();
	}

	private normalizeState(state: Partial<CalendarLeafState> | null | undefined): CalendarLeafState {
		const settings = this.getSettings();
		return normalizeCalendarLeafState(state, {
			availablePresetIds: settings.calendarPresets.map(entry => entry.id),
			availableFilterSetIds: getNormalFilterSets(settings.filterSets).map(entry => entry.id),
			defaultPresetId: settings.calendarDefaultPresetId ?? settings.calendarPresets[0]?.id ?? null,
			defaultScrollHour: settings.calendarDefaultScrollHour,
				fallbackAnchorDate: localToday(),
				defaultCalendarsOpen: settings.calendarSidebarCalendarsDefaultExpanded,
				defaultTaskPoolOpen: settings.calendarSidebarTaskPoolDefaultExpanded,
				defaultFinishedTasksOpen: false,
				defaultShowAllDayLane: settings.calendarShowAllDayLane,
			defaultShowDueMarkers: settings.calendarShowDueMarkers,
			defaultShowInDayLane: true,
			defaultShowFinishedLane: true,
			defaultMobileViewMode: settings.calendarMobileDefaultView,
			defaultMobileSourcePresetId: settings.calendarMobileDefaultSourcePresetId ?? settings.calendarDefaultPresetId ?? settings.calendarPresets[0]?.id ?? null,
		});
	}

		private isSidebarSectionOpen(state: CalendarLeafState, sectionId: CalendarSidebarSectionId): boolean {
			if (sectionId === 'calendars') return state.calendarsOpen;
			return state.taskPoolOpen;
		}

		private deriveSidebarOpenSectionOrder(
			state: Partial<CalendarLeafState> | null | undefined,
			preferredOrder: CalendarSidebarSectionId[] = this.sidebarOpenSectionOrder,
		): CalendarSidebarSectionId[] {
			const openSections = new Set<CalendarSidebarSectionId>();
			if (state?.calendarsOpen) openSections.add('calendars');
			if (state?.taskPoolOpen) openSections.add('taskPool');

			const order: CalendarSidebarSectionId[] = [];
			for (const sectionId of preferredOrder) {
				if (!CALENDAR_SIDEBAR_SECTION_ORDER.includes(sectionId)) continue;
				if (!openSections.has(sectionId) || order.includes(sectionId)) continue;
				order.push(sectionId);
			}
			for (const sectionId of CALENDAR_SIDEBAR_SECTION_ORDER) {
				if (!openSections.has(sectionId) || order.includes(sectionId)) continue;
				order.push(sectionId);
			}
			return order.slice(-2);
		}

	private applySidebarOpenSectionOrder(
		state: CalendarLeafState,
		order: CalendarSidebarSectionId[],
	): CalendarLeafState {
		const normalizedOrder = order
			.filter((sectionId, index) => CALENDAR_SIDEBAR_SECTION_ORDER.includes(sectionId) && order.indexOf(sectionId) === index)
			.slice(-2);
		return {
			...state,
			calendarsOpen: normalizedOrder.includes('calendars'),
			taskPoolOpen: normalizedOrder.includes('taskPool'),
			finishedTasksOpen: false,
		};
	}

	private syncSidebarOpenSections(state: CalendarLeafState): CalendarLeafState {
		const shouldMigrateFinishedTasks = state.finishedTasksOpen === true;
		const migratedState = shouldMigrateFinishedTasks
			? {
				...state,
				taskPoolOpen: true,
			}
			: state;
		const normalizedOrder = this.deriveSidebarOpenSectionOrder(migratedState);
		this.sidebarOpenSectionOrder = normalizedOrder;
		return this.applySidebarOpenSectionOrder(migratedState, normalizedOrder);
	}

	private async toggleSidebarSection(sectionId: CalendarSidebarSectionId): Promise<void> {
		const state = this.ensureState();
		let nextOrder = this.deriveSidebarOpenSectionOrder(state);
		if (this.isSidebarSectionOpen(state, sectionId)) {
			nextOrder = nextOrder.filter(id => id !== sectionId);
		} else {
			nextOrder = nextOrder.filter(id => id !== sectionId);
			nextOrder.push(sectionId);
			nextOrder = nextOrder.slice(-2);
		}
		this.sidebarOpenSectionOrder = nextOrder;
		await this.updateLeafState(this.applySidebarOpenSectionOrder(state, nextOrder));
	}

	private areLeafStatesEqual(left: CalendarLeafState | null, right: CalendarLeafState | null): boolean {
		if (!left || !right) return left === right;
		return left.presetId === right.presetId
			&& left.anchorDate === right.anchorDate
			&& left.scrollMinutes === right.scrollMinutes
			&& left.filterSetId === right.filterSetId
			&& left.navigationMode === right.navigationMode
			&& left.calendarsOpen === right.calendarsOpen
			&& left.taskPoolOpen === right.taskPoolOpen
			&& left.taskPoolMode === right.taskPoolMode
			&& left.finishedTasksOpen === right.finishedTasksOpen
			&& left.showAllDayLane === right.showAllDayLane
			&& left.showDueMarkers === right.showDueMarkers
			&& left.showInDayLane === right.showInDayLane
			&& left.showFinishedLane === right.showFinishedLane
			&& left.mobileViewMode === right.mobileViewMode
			&& left.mobileSourcePresetId === right.mobileSourcePresetId
			&& left.mobileAnchorDate === right.mobileAnchorDate;
	}

	private renderFilterEmptyState(
		container: HTMLElement,
		activeFilter: FilterSet | null,
		filteredTaskCount: number,
		visibleItemCount: number,
	): void {
		if (!activeFilter || visibleItemCount > 0) return;
			container.createDiv({
				cls: 'operon-calendar-filter-empty-state',
				text: filteredTaskCount === 0
					? t('calendar', 'noCalendarFilterMatches')
					: t('calendar', 'noFilteredTasksVisible'),
			});
	}

	private clearPersistStateTimer(): void {
		if (!this.persistStateTimer) return;
		window.clearTimeout(this.persistStateTimer);
		this.persistStateTimer = null;
	}

	private invalidateRenderGeneration(): void {
		this.renderGeneration += 1;
	}

	private isRenderGenerationActive(generation: number): boolean {
		return generation === this.renderGeneration && this.containerEl.isConnected;
	}

	private requestRenderAnimationFrame(generation: number, callback: () => void): number {
		const frame = window.requestAnimationFrame(() => {
			this.renderAnimationFrames.delete(frame);
			if (!this.isRenderGenerationActive(generation)) return;
			callback();
		});
		this.renderAnimationFrames.add(frame);
		return frame;
	}

	private setRenderTimeout(generation: number, callback: () => void, delay: number): number {
		const timer = window.setTimeout(() => {
			this.renderTimeouts.delete(timer);
			if (!this.isRenderGenerationActive(generation)) return;
			callback();
		}, delay);
		this.renderTimeouts.add(timer);
		return timer;
	}

	private clearRenderTimers(): void {
		this.hideCalendarHoverMenu(true);
		this.clearEditableFocusRenderRetryTimer();
		this.sidebarSectionsLayoutCleanup?.();
		this.sidebarSectionsLayoutCleanup = null;
		this.toolbarLayoutCleanup?.();
		this.toolbarLayoutCleanup = null;
		if (this.layoutRefreshFrame !== null) {
			window.cancelAnimationFrame(this.layoutRefreshFrame);
			this.renderAnimationFrames.delete(this.layoutRefreshFrame);
			this.layoutRefreshFrame = null;
		}
		for (const frame of Array.from(this.renderAnimationFrames)) {
			window.cancelAnimationFrame(frame);
		}
		this.renderAnimationFrames.clear();
		for (const timer of Array.from(this.renderTimeouts)) {
			window.clearTimeout(timer);
		}
		this.renderTimeouts.clear();
		this.mobileDateStripScrollTimer = null;
		this.layoutRefreshCleanup?.();
		this.layoutRefreshCleanup = null;
		if (this.nowIndicatorTimer) {
			window.clearInterval(this.nowIndicatorTimer);
			this.nowIndicatorTimer = null;
		}
		this.nowIndicatorEntries = [];
	}

	private clearScheduledRender(): void {
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}
	}

	private clearEditableFocusRenderRetryTimer(): void {
		if (this.editableFocusRenderRetryTimer === null) return;
		window.clearTimeout(this.editableFocusRenderRetryTimer);
		this.editableFocusRenderRetryTimer = null;
	}
}
