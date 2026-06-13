import type { IndexedTask } from './fields';
import type { CalendarTaskColorSource } from '../core/task-color-source';
export {
	CONTEXTUAL_MENU_ACTIONS,
	getContextualMenuActionDescription,
	getContextualMenuActionLabel,
	type ContextualMenuActionDefinition,
	type ContextualMenuActionId,
} from '../core/contextual-menu-engine';

export type CalendarColorSource = CalendarTaskColorSource;
export type CalendarAppearanceMode = 'theme' | 'anupuccin-light' | 'anupuccin-dark' | 'catppuccin-dark' | 'atom-light' | 'atom-dark' | 'flexoki-light' | 'flexoki-dark';
export type CalendarNavigationMode = 'toolbar' | 'sidebar';
export type CalendarSurfaceType = 'timeGrid' | 'multiWeek';
export const CALENDAR_MOBILE_VIEW_MODES = ['agenda', 'day', 'threeDay'] as const;
export type CalendarMobileViewMode = typeof CALENDAR_MOBILE_VIEW_MODES[number];
export const CALENDAR_SIDEBAR_TASK_POOL_MODES = ['overdue', 'unscheduled', 'all', 'finished'] as const;
export type CalendarSidebarTaskPoolMode = typeof CALENDAR_SIDEBAR_TASK_POOL_MODES[number];

export interface CalendarPreset {
	id: string;
	name: string;
	surfaceType: CalendarSurfaceType;
	weekCount: 1 | 2 | 3 | 4 | 5 | 6;
	focusedWeekNumber: 1 | 2 | 3 | 4 | 5 | 6;
	dayCount: number;
	todayPosition: number;
	slotMinutes: number;
	filterSetId: string | null;
	navigationMode: CalendarNavigationMode;
	showAllDayLane: boolean;
	showDueMarkers: boolean;
	showWeekends: boolean;
	showProjectedOccurrences: boolean;
	showExternalCalendars: boolean;
	hiddenTimeStart: string;
	hiddenTimeEnd: string;
	colorSource: CalendarColorSource;
	appearanceModeLight: CalendarAppearanceMode;
	appearanceModeDark: CalendarAppearanceMode;
	externalCalendarVisibility: Record<string, boolean>;
}

export interface CalendarLeafState {
	presetId: string | null;
	anchorDate: string;
	scrollMinutes: number;
	filterSetId: string | null;
	navigationMode: CalendarNavigationMode;
	calendarsOpen: boolean;
	taskPoolOpen: boolean;
	taskPoolMode: CalendarSidebarTaskPoolMode;
	finishedTasksOpen: boolean;
	showAllDayLane: boolean;
	showDueMarkers: boolean;
	showInDayLane: boolean;
	showFinishedLane: boolean;
	mobileViewMode: CalendarMobileViewMode;
	mobileSourcePresetId: string | null;
	mobileAnchorDate: string;
}

export interface CalendarLeafStateNormalizationOptions {
	availablePresetIds: string[];
	availableFilterSetIds: string[];
	defaultPresetId: string | null;
	defaultScrollHour: number;
	fallbackAnchorDate: string;
	defaultCalendarsOpen: boolean;
	defaultTaskPoolOpen: boolean;
	defaultFinishedTasksOpen?: boolean;
	defaultShowAllDayLane: boolean;
	defaultShowDueMarkers: boolean;
	defaultShowInDayLane: boolean;
	defaultShowFinishedLane: boolean;
	defaultMobileViewMode: CalendarMobileViewMode;
	defaultMobileSourcePresetId: string | null;
}

export function normalizeCalendarSidebarTaskPoolMode(value: unknown): CalendarSidebarTaskPoolMode {
	return typeof value === 'string' && CALENDAR_SIDEBAR_TASK_POOL_MODES.includes(value as CalendarSidebarTaskPoolMode)
		? value as CalendarSidebarTaskPoolMode
		: 'overdue';
}

export type CalendarItemKind = 'timed' | 'allDayScheduled' | 'dueMarker' | 'finishedMarker';
export type CalendarItemOrigin = 'materialized' | 'projected' | 'external';
export type CalendarProjectionKind = 'scheduled' | 'doneRolling';

export interface CalendarRenderSnapshot {
	description: string;
	checkbox: IndexedTask['checkbox'];
	fieldValues: Record<string, string>;
	tags: string[];
}

export type CalendarRenderTaskSnapshot = CalendarRenderSnapshot;

export interface CalendarRepeatOccurrenceRef {
	seriesId: string;
	occurrenceDate: string;
	isLatestMaterialized: boolean;
	isProjected: boolean;
	projectionKind?: CalendarProjectionKind;
}

export interface CalendarExternalEventRef {
	sourceId: string;
	sourceName: string;
	sourceColor: string;
	eventId: string;
	uid: string;
	recurrenceId: string | null;
	url: string;
}

export interface CalendarItem {
	taskId: string;
	kind: CalendarItemKind;
	startDate: string;
	endDate: string;
	startDateTime: string | null;
	endDateTime: string | null;
	isDashed: boolean;
	isReadOnly: boolean;
	origin: CalendarItemOrigin;
	repeatRef: CalendarRepeatOccurrenceRef | null;
	externalRef: CalendarExternalEventRef | null;
	sourceTask: IndexedTask | null;
	renderSnapshot: CalendarRenderSnapshot;
}

export type CalendarSlotSelectionMode = 'timed' | 'allDay';

export interface CalendarSlotSelection {
	mode: CalendarSlotSelectionMode;
	start: string;
	end: string;
	startDate: string;
	endDate: string;
	isAllDay: boolean;
	slotMinutes?: number;
}

export interface ExternalCalendarTaskSeed {
	itemId: string;
	title: string;
	selection: CalendarSlotSelection;
	externalRef: CalendarExternalEventRef;
}

export type CalendarWritableField =
	| 'dateScheduled'
	| 'dateStarted'
	| 'dateDue'
	| 'datetimeStart'
	| 'datetimeEnd'
	| 'estimate';

export interface CalendarWritebackPlan {
	payload: Partial<Record<CalendarWritableField, string>>;
}

export type CalendarFilterMaterializationOutcome =
	| 'fullyMaterializable'
	| 'partiallyMaterializable'
	| 'unsupportedOnly'
	| 'alreadyCompatible'
	| 'noFilter';

export interface CalendarFilterFieldChange {
	key: string;
	label: string;
	changeKind: 'add' | 'update';
	currentValue: string | null;
	nextValue: string;
}

export interface CalendarUnsupportedFilterCondition {
	conditionId: string;
	summary: string;
	reason: string;
}

export interface CalendarFilterMaterializationPlan {
	filterSetId: string;
	filterSetName: string;
	outcome: CalendarFilterMaterializationOutcome;
	fieldChanges: CalendarFilterFieldChange[];
	unsupportedConditions: CalendarUnsupportedFilterCondition[];
	matchesFilterBefore: boolean;
	matchesFilterAfterSupportedChanges: boolean;
}


export function buildCalendarRenderSnapshot(task: IndexedTask): CalendarRenderSnapshot {
	return {
		description: task.description,
		checkbox: task.checkbox,
		fieldValues: { ...task.fieldValues },
		tags: [...task.tags],
	};
}

export const DEFAULT_CALENDAR_PRESETS: CalendarPreset[] = [
	{
		id: 'calendar-preset-1day',
		name: '1 Day',
		surfaceType: 'timeGrid',
		weekCount: 2,
		focusedWeekNumber: 1,
		dayCount: 1,
		todayPosition: 1,
		slotMinutes: 15,
		filterSetId: null,
		navigationMode: 'toolbar',
		showAllDayLane: true,
		showDueMarkers: true,
		showWeekends: true,
		showProjectedOccurrences: true,
		showExternalCalendars: true,
		hiddenTimeStart: '00:00',
		hiddenTimeEnd: '06:00',
		colorSource: 'taskColor',
		appearanceModeLight: 'theme',
		appearanceModeDark: 'theme',
		externalCalendarVisibility: {},
	},
	{
		id: 'calendar-preset-3day',
		name: '3 Days',
		surfaceType: 'timeGrid',
		weekCount: 2,
		focusedWeekNumber: 1,
		dayCount: 3,
		todayPosition: 1,
		slotMinutes: 15,
		filterSetId: null,
		navigationMode: 'toolbar',
		showAllDayLane: true,
		showDueMarkers: true,
		showWeekends: true,
		showProjectedOccurrences: true,
		showExternalCalendars: true,
		hiddenTimeStart: '00:00',
		hiddenTimeEnd: '06:00',
		colorSource: 'taskColor',
		appearanceModeLight: 'theme',
		appearanceModeDark: 'theme',
		externalCalendarVisibility: {},
	},
	{
		id: 'calendar-preset-7day',
		name: '7 Days Multi Week',
		surfaceType: 'multiWeek',
		weekCount: 4,
		focusedWeekNumber: 1,
		dayCount: 7,
		todayPosition: 1,
		slotMinutes: 15,
		filterSetId: null,
		navigationMode: 'toolbar',
		showAllDayLane: true,
		showDueMarkers: true,
		showWeekends: true,
		showProjectedOccurrences: true,
		showExternalCalendars: true,
		hiddenTimeStart: '00:00',
		hiddenTimeEnd: '06:00',
		colorSource: 'taskColor',
		appearanceModeLight: 'theme',
		appearanceModeDark: 'theme',
		externalCalendarVisibility: {},
	},
	{
		id: 'calendar-preset-10day',
		name: '10 Days',
		surfaceType: 'timeGrid',
		weekCount: 2,
		focusedWeekNumber: 1,
		dayCount: 10,
		todayPosition: 1,
		slotMinutes: 15,
		filterSetId: null,
		navigationMode: 'toolbar',
		showAllDayLane: true,
		showDueMarkers: true,
		showWeekends: true,
		showProjectedOccurrences: true,
		showExternalCalendars: true,
		hiddenTimeStart: '00:00',
		hiddenTimeEnd: '06:00',
		colorSource: 'taskColor',
		appearanceModeLight: 'theme',
		appearanceModeDark: 'theme',
		externalCalendarVisibility: {},
	},
];

const BUILTIN_CALENDAR_PRESET_NAME_MIGRATIONS: Record<string, { from: string; to: string }> = {
	'calendar-preset-3day': { from: '3 Day', to: '3 Days' },
	'calendar-preset-7day': { from: '7 Day', to: '7 Days' },
	'calendar-preset-10day': { from: '10 Day', to: '10 Days' },
};

function isPreviousBuiltIn7DaysTimeGridPreset(preset: CalendarPreset): boolean {
	return preset.id === 'calendar-preset-7day'
		&& (preset.name === '7 Day' || preset.name === '7 Days')
		&& preset.surfaceType === 'timeGrid'
		&& preset.weekCount === 2
		&& preset.focusedWeekNumber === 1
		&& preset.dayCount === 7
		&& preset.todayPosition === 1
		&& preset.slotMinutes === 15
		&& preset.filterSetId === null
		&& preset.navigationMode === 'toolbar'
		&& preset.showAllDayLane === true
		&& preset.showDueMarkers === true
		&& preset.showWeekends === true
		&& preset.showProjectedOccurrences === true
		&& preset.showExternalCalendars === true
		&& preset.hiddenTimeStart === '00:00'
		&& preset.hiddenTimeEnd === '06:00'
		&& preset.colorSource === 'taskColor'
		&& preset.appearanceModeLight === 'theme'
		&& preset.appearanceModeDark === 'theme'
		&& Object.keys(preset.externalCalendarVisibility).length === 0;
}

export function normalizeBuiltInCalendarPreset(preset: CalendarPreset): CalendarPreset {
	const normalizedPreset = {
		...preset,
		showProjectedOccurrences: preset.showProjectedOccurrences !== false,
		showExternalCalendars: preset.showExternalCalendars !== false,
	};
	if (isPreviousBuiltIn7DaysTimeGridPreset(normalizedPreset)) {
		return {
			...normalizedPreset,
			name: '7 Days Multi Week',
			surfaceType: 'multiWeek',
			weekCount: 4,
			focusedWeekNumber: 1,
		};
	}
	const migration = BUILTIN_CALENDAR_PRESET_NAME_MIGRATIONS[normalizedPreset.id];
	if (!migration || normalizedPreset.name !== migration.from) return normalizedPreset;
	return {
		...normalizedPreset,
		name: migration.to,
	};
}

export function cloneDefaultCalendarPresets(): CalendarPreset[] {
	return DEFAULT_CALENDAR_PRESETS.map(preset => ({ ...preset }));
}

export function createCalendarPresetId(): string {
	return `cp_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeCalendarMobileViewMode(
	value: unknown,
	fallback: CalendarMobileViewMode = 'agenda',
): CalendarMobileViewMode {
	return CALENDAR_MOBILE_VIEW_MODES.includes(value as CalendarMobileViewMode)
		? value as CalendarMobileViewMode
		: fallback;
}

export function normalizeCalendarLeafState(
	state: Partial<CalendarLeafState> | null | undefined,
	options: CalendarLeafStateNormalizationOptions,
): CalendarLeafState {
	const fallbackPresetId = options.defaultPresetId && options.availablePresetIds.includes(options.defaultPresetId)
		? options.defaultPresetId
		: options.availablePresetIds[0] ?? null;
	const requestedPresetId = typeof state?.presetId === 'string' && state.presetId.trim()
		? state.presetId
		: fallbackPresetId;
	const presetId = requestedPresetId && options.availablePresetIds.includes(requestedPresetId)
		? requestedPresetId
		: fallbackPresetId;
	const anchorDate = typeof state?.anchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.anchorDate)
		? state.anchorDate
		: options.fallbackAnchorDate;
	const fallbackScrollMinutes = Math.max(0, Math.min(24 * 60, Math.round(options.defaultScrollHour) * 60));
	const scrollMinutes = typeof state?.scrollMinutes === 'number' && Number.isFinite(state.scrollMinutes)
		? Math.max(0, Math.min(24 * 60, Math.round(state.scrollMinutes)))
		: fallbackScrollMinutes;
	const requestedFilterSetId = typeof state?.filterSetId === 'string' && state.filterSetId.trim().length > 0
		? state.filterSetId
		: null;
	const filterSetId = requestedFilterSetId && options.availableFilterSetIds.includes(requestedFilterSetId)
		? requestedFilterSetId
		: null;
	const navigationMode = state?.navigationMode === 'toolbar' ? 'toolbar' : 'sidebar';
	const calendarsOpen = typeof state?.calendarsOpen === 'boolean'
		? state.calendarsOpen
		: options.defaultCalendarsOpen;
	const legacyFinishedTasksOpen = state?.finishedTasksOpen === true;
	const taskPoolOpen = legacyFinishedTasksOpen
		? true
		: (typeof state?.taskPoolOpen === 'boolean'
			? state.taskPoolOpen
			: options.defaultTaskPoolOpen);
	const taskPoolMode = legacyFinishedTasksOpen
		? 'finished'
		: normalizeCalendarSidebarTaskPoolMode(state?.taskPoolMode);
	const finishedTasksOpen = false;
	const showAllDayLane = typeof state?.showAllDayLane === 'boolean'
		? state.showAllDayLane
		: options.defaultShowAllDayLane;
	const showDueMarkers = typeof state?.showDueMarkers === 'boolean'
		? state.showDueMarkers
		: options.defaultShowDueMarkers;
	const showInDayLane = typeof state?.showInDayLane === 'boolean'
		? state.showInDayLane
		: options.defaultShowInDayLane;
	const showFinishedLane = typeof state?.showFinishedLane === 'boolean'
		? state.showFinishedLane
		: options.defaultShowFinishedLane;
	const mobileViewMode = normalizeCalendarMobileViewMode(state?.mobileViewMode, options.defaultMobileViewMode);
	const fallbackMobileSourcePresetId = options.defaultMobileSourcePresetId && options.availablePresetIds.includes(options.defaultMobileSourcePresetId)
		? options.defaultMobileSourcePresetId
		: fallbackPresetId;
	const requestedMobileSourcePresetId = typeof state?.mobileSourcePresetId === 'string' && state.mobileSourcePresetId.trim()
		? state.mobileSourcePresetId
		: fallbackMobileSourcePresetId;
	const mobileSourcePresetId = requestedMobileSourcePresetId && options.availablePresetIds.includes(requestedMobileSourcePresetId)
		? requestedMobileSourcePresetId
		: fallbackMobileSourcePresetId;
	const mobileAnchorDate = typeof state?.mobileAnchorDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.mobileAnchorDate)
		? state.mobileAnchorDate
		: anchorDate;

	return {
		presetId,
		anchorDate,
		scrollMinutes,
		filterSetId,
		navigationMode,
		calendarsOpen,
		taskPoolOpen,
		taskPoolMode,
		finishedTasksOpen,
		showAllDayLane,
		showDueMarkers,
		showInDayLane,
		showFinishedLane,
		mobileViewMode,
		mobileSourcePresetId,
		mobileAnchorDate,
	};
}
