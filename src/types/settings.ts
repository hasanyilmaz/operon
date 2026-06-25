/**
 * Operon plugin settings with versioned schema and migration.
 * Based on Spec Sections 5.4.6 - 5.4.7.
 */

import { clonePipeline, createPipelineId, createStatusId, findStatusDef, Pipeline, DEFAULT_PIPELINES, StatusDefinition } from './pipeline';
import { PriorityDefinition, DEFAULT_PRIORITIES, clonePriorityDefinition, createPriorityId } from './priority';
import { CANONICAL_KEYS } from './keys';
import {
	CALENDAR_MOBILE_VIEW_MODES,
	CalendarAppearanceMode,
	CalendarColorSource,
	CalendarMobileViewMode,
	CalendarPreset,
	CalendarSurfaceType,
	cloneDefaultCalendarPresets,
	createCalendarPresetId,
	normalizeBuiltInCalendarPreset,
	normalizeCalendarMobileViewMode,
} from './calendar';
import {
	CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS,
	CONTEXTUAL_MENU_SURFACES,
	type ContextualMenuActionId,
	type ContextualMenuSurface,
	type ContextualMenuSurfaceActionMatrix,
} from '../core/contextual-menu-engine';
import {
	KanbanAppearanceMode,
	KanbanPreset,
	KanbanSortField,
	KanbanSortMode,
	KanbanSortRule,
	cloneDefaultKanbanPresets,
	createDefaultKanbanSortRules,
	createKanbanPresetId,
	isBuiltInKanbanSortField,
	isBuiltInKanbanSwimlaneBy,
	normalizeKanbanCustomFieldReference,
	normalizeBuiltInKanbanPreset,
} from './kanban';
import {
	CALENDAR_TASK_COLOR_SOURCES,
	KANBAN_TASK_COLOR_SOURCES,
	PINNED_DOCK_TASK_COLOR_SOURCES,
	normalizeTaskColorSource,
	type PinnedDockTaskColorSource,
} from '../core/task-color-source';
import { normalizeMarkdownHeadingKeyword } from '../core/markdown-heading-insertion';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import {
	normalizeSettingsFolderPath,
	sanitizeExcludedFoldersForFileTasksFolder,
} from '../core/settings-folder-rules';
import {
	type ColorPaletteEntry,
	cloneDefaultColorPalette,
	normalizeColorPalette,
} from '../core/color-palette';
import {
	createProjectSerialScopeId,
	normalizeProjectSerialPrefix,
	normalizeProjectSerialScopes,
} from '../core/project-serials';

export const CURRENT_SETTINGS_VERSION = 99;
export const CURRENT_TASK_STATS_BACKFILL_VERSION = 2;
export const SUPPORTED_LANGUAGE_OPTIONS = ['auto', 'en', 'tr', 'de', 'fr', 'es', 'zh-CN', 'zh-TW'] as const;
export type OperonLanguage = typeof SUPPORTED_LANGUAGE_OPTIONS[number];
export const DEFAULT_CHILD_TASK_INHERITANCE_FIELDS = ['status', 'priority', 'taskIcon', 'taskColor'] as const;
export const CHILD_TASK_INHERITANCE_TAGS_KEY = 'tags';
export type ChildTaskInheritanceStatusPipelineSource = 'parent' | 'default';

export function isSupportedLanguage(value: string): value is OperonLanguage {
	return (SUPPORTED_LANGUAGE_OPTIONS as readonly string[]).includes(value);
}

export type FallbackTaskIconSource = 'pipelineStatusIcon' | 'priorityIcon' | 'stateIcon';
export type PinnedTasksDesktopSurface = 'floating' | 'sidebar';
export type PinnedTasksSidebarSide = 'left' | 'right';
export type DynamicFileTaskFilterPlacement = 'body-top' | 'body-bottom';
export const DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 40, 50] as const;
export type DynamicFileTaskFilterSubtaskAutoExpandLimit = typeof DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS[number];
export interface MobileGlobalTaskFabPosition {
	xRatio: number;
	yRatio: number;
}

export interface ProjectSerialScope {
	id: string;
	prefix: string;
	parentOperonId: string;
	createdAt: string;
	updatedAt: string;
}

const DEFAULT_CALENDAR_DEFAULT_PRESET_ID = 'calendar-preset-3day';
const DEFAULT_KANBAN_DEFAULT_PRESET_ID = 'kanban-preset-default';
const SPECIAL_DYNAMIC_FILTER_SET_IDS = new Set(['fs_dynamic_file_task', 'fs_dynamic_subtasks_filter']);
const CHILD_TASK_INHERITANCE_BLOCKED_FIELD_KEYS = new Set<string>([
	'operonId',
	'parentTask',
	'datetimeCreated',
	'datetimeModified',
	'blocking',
	'blockedBy',
	'duration',
	'totalEstimate',
	'totalDuration',
	'directSubtaskCount',
	'directDoneSubtaskCount',
	'directOpenSubtaskCount',
	'treeDescendantCount',
	'treeDoneDescendantCount',
	'treeOpenDescendantCount',
	'repeatSeriesId',
	'repeatOccurrenceDate',
	'reminders',
	'timezone',
	'trackers',
	'activeTracker',
	'related',
]);
const DEFAULT_CONTEXTUAL_MENU_ACTION_ALLOWLIST: ContextualMenuActionId[] = [
	'markDone',
	'startTimer',
	'setAsTracked',
	'pinToggle',
	'unschedule',
	'clearDueDate',
	'openEditor',
	'convertInlineToFileTask',
	'convertFileToInlineTask',
	'subtasks',
	'createSubtask',
	'checkboxes',
	'jumpToSource',
	'taskStatus',
	'cancelTask',
];
const DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS: ContextualMenuActionId[] = [
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
	'unschedule',
	'jumpToSource',
	'setAsTracked',
	'clearDueDate',
];
const DEFAULT_CONTEXTUAL_MENU_WITH_CANCEL_ACTIONS: ContextualMenuActionId[] = [
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
	'cancelTask',
	'unschedule',
	'jumpToSource',
	'setAsTracked',
	'clearDueDate',
];
const DEFAULT_CONTEXTUAL_MENU_TRACKER_ACTIONS: ContextualMenuActionId[] = [
	'markDone',
	'convertInlineToFileTask',
	'convertFileToInlineTask',
	'subtasks',
	'createSubtask',
	'checkboxes',
	'unschedule',
	'setAsTracked',
	'clearDueDate',
];
const DEFAULT_CONTEXTUAL_MENU_KANBAN_ACTIONS: ContextualMenuActionId[] = [
	'pinToggle',
	'startTimer',
	'markDone',
	'convertInlineToFileTask',
	'convertFileToInlineTask',
	'subtasks',
	'createSubtask',
	'checkboxes',
	'unschedule',
	'jumpToSource',
	'clearDueDate',
];
const LEGACY_FALLBACK_STATE_ICONS = {
	open: 'circle',
	done: 'square-check-big',
	cancelled: 'square-x',
} as const;
const V70_FALLBACK_STATE_ICONS = {
	open: 'obsidian',
	done: 'obsidian-new',
	cancelled: 'square-x',
} as const;
export const CALENDAR_TIME_GRID_SCALE_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const;
export const CALENDAR_AUTO_SCROLL_POSITION_OPTIONS = [0.1, 0.2, 0.3, 0.4, 0.5] as const;
export const CALENDAR_SIDEBAR_WIDTH_MIN = 240;
export const CALENDAR_SIDEBAR_WIDTH_MAX = 720;
export const CALENDAR_SIDEBAR_WIDTH_PX_OPTIONS = [240, 280, 320, 360, 400, 480, 560, 640, 720] as const;
export const CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MIN = 320;
export const CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MAX = 1200;
export const CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS = [15, 30, 60] as const;
export const CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS = [0, 3, 7, 14, 30] as const;
export const CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS = [7, 14, 21, 30, 60] as const;
export const CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS = ['all', 4, 5, 6, 7] as const;
export type CalendarMobileAgendaPastDays = typeof CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS[number];
export type CalendarMobileAgendaFutureDays = typeof CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS[number];
export type CalendarMobileAllDayVisibleTaskLimit = typeof CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS[number];
export type CalendarMobileSourcePresetSettingKey =
	| 'calendarMobileAgendaSourcePresetId'
	| 'calendarMobileDaySourcePresetId'
	| 'calendarMobileTwoDaySourcePresetId'
	| 'calendarMobileThreeDaySourcePresetId';
export const CALENDAR_MOBILE_SOURCE_PRESET_SETTING_BY_VIEW_MODE: Record<CalendarMobileViewMode, CalendarMobileSourcePresetSettingKey> = {
	agenda: 'calendarMobileAgendaSourcePresetId',
	day: 'calendarMobileDaySourcePresetId',
	twoDay: 'calendarMobileTwoDaySourcePresetId',
	threeDay: 'calendarMobileThreeDaySourcePresetId',
};

export type CalendarMobileViewModeEnabledSettingKey =
	| 'calendarMobileAgendaEnabled'
	| 'calendarMobileDayEnabled'
	| 'calendarMobileTwoDayEnabled'
	| 'calendarMobileThreeDayEnabled';

export const CALENDAR_MOBILE_VIEW_MODE_ENABLED_SETTING_BY_VIEW_MODE: Record<CalendarMobileViewMode, CalendarMobileViewModeEnabledSettingKey> = {
	agenda: 'calendarMobileAgendaEnabled',
	day: 'calendarMobileDayEnabled',
	twoDay: 'calendarMobileTwoDayEnabled',
	threeDay: 'calendarMobileThreeDayEnabled',
};

export function resolveEnabledCalendarMobileViewModes(settings: Pick<OperonSettings, CalendarMobileViewModeEnabledSettingKey>): CalendarMobileViewMode[] {
	const enabledModes = CALENDAR_MOBILE_VIEW_MODES.filter(mode => settings[CALENDAR_MOBILE_VIEW_MODE_ENABLED_SETTING_BY_VIEW_MODE[mode]] !== false);
	return enabledModes.length > 0 ? enabledModes : ['agenda'];
}
export type CalendarDayTitleAction = 'create-open-daily-note' | 'nothing';
const CONTEXTUAL_MENU_ACTION_ID_SET = new Set<ContextualMenuActionId>(
	CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS.map(action => action.id),
);
const CONTEXTUAL_MENU_SURFACE_ID_SET = new Set<ContextualMenuSurface>(CONTEXTUAL_MENU_SURFACES);
export const KANBAN_EXPANDED_COLUMN_WIDTH_MIN = 220;
export const KANBAN_EXPANDED_COLUMN_WIDTH_MAX = 520;
export const KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN = 1;
export const KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX = 30;
export const KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MIN = 600;
export const KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MAX = 1200;
export const KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MIN = 6;
export const KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MAX = 48;
export const DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS = [10, 30, 60, 120] as const;
export const TASK_EDITOR_AUTOSAVE_DELAY_SECONDS_OPTIONS = [10, 15, 30, 45, 60] as const;
export type TrackerTaskDescriptionClickAction = 'jumpToSource' | 'openTaskEditor';
export type FlowTimeMode = 'tracktime' | 'flowtime';
export type InlineTaskSaveMode = 'daily-notes' | 'specific-file' | 'active-file' | 'ask-every-time';
export type InlineTaskParentInlineTargetMode = 'default' | 'below-parent';
export type InlineTaskParentFileTargetMode = 'default' | 'inside-parent-file';
export type FileTaskParentInlineTargetMode = 'default' | 'same-folder';
export type FileTaskParentFileTargetMode = 'default' | 'same-folder';
export type WorkspaceTweaksPropertiesScope = 'operon-file-tasks' | 'all-notes';
export const FLOW_TIME_PAUSE_MINUTE_OPTIONS = [5, 10, 15] as const;
export const FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS = [15, 20, 25, 30, 45, 60, 75, 90] as const;

// ============================================================
// Filter Sets
// ============================================================

/** Field types available in filter conditions */
export type FilterFieldType = 'text' | 'number' | 'date' | 'datetime' | 'list' | 'checkbox' | 'tags' | 'pinned' | 'projectTree' | 'folders';

/** A single condition within a filter set */
export interface FilterSetCondition {
	id: string;
	/** canonical key name, OR 'checkbox' | 'tags' | 'description' */
	field: string;
	fieldType: FilterFieldType;
	operator: string;
	value?: string;
}

export type FilterGroupLogic = 'all' | 'any' | 'none';

export interface FilterGroup {
	id: string;
	logic: FilterGroupLogic;
	children: FilterNode[];
}

export type FilterNode = FilterGroup | FilterSetCondition;

export interface FilterSortSpec {
	field: string;
	order: 'asc' | 'desc';
}

export const DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS: FilterSortSpec[] = [
	{ field: 'checkbox', order: 'asc' },
	{ field: 'priority', order: 'asc' },
];

/** A named, user-defined filter set */
export interface FilterSet {
	id: string;
	name: string;
	icon?: string;
	rootGroup: FilterGroup;
	sorts: FilterSortSpec[];
	subgroupBy?: string;
	subgroupOrder?: 'asc' | 'desc';
	/** Flat condition mirrors kept in sync with rootGroup for evaluator/UI access */
	matchLogic: 'all' | 'any' | 'none';
	conditions: FilterSetCondition[];
	/** canonical key, 'checkbox', 'description', or undefined */
	sortBy?: string;
	sortOrder?: 'asc' | 'desc';
	/** canonical key, 'checkbox', 'description', or undefined — groups results before sorting */
	groupBy?: string;
	groupOrder?: 'asc' | 'desc';
}

function cloneFilterCondition(condition: FilterSetCondition): FilterSetCondition {
	return {
		id: condition.id,
		field: condition.field,
		fieldType: condition.fieldType,
		operator: condition.operator,
		...(condition.value !== undefined ? { value: condition.value } : {}),
	};
}

function cloneFilterNode(node: FilterNode): FilterNode {
	if ('children' in node) {
		return {
			id: node.id,
			logic: node.logic,
			children: node.children.map(cloneFilterNode),
		};
	}
	return cloneFilterCondition(node);
}

export function cloneFilterSet(filterSet: FilterSet): FilterSet {
	return {
		id: filterSet.id,
		name: filterSet.name,
		...(filterSet.icon !== undefined ? { icon: filterSet.icon } : {}),
		rootGroup: cloneFilterNode(filterSet.rootGroup) as FilterGroup,
		sorts: filterSet.sorts.map(sort => ({ field: sort.field, order: sort.order })),
		...(filterSet.subgroupBy !== undefined ? { subgroupBy: filterSet.subgroupBy } : {}),
		...(filterSet.subgroupOrder !== undefined ? { subgroupOrder: filterSet.subgroupOrder } : {}),
		matchLogic: filterSet.matchLogic,
		conditions: filterSet.conditions.map(cloneFilterCondition),
		...(filterSet.sortBy !== undefined ? { sortBy: filterSet.sortBy } : {}),
		...(filterSet.sortOrder !== undefined ? { sortOrder: filterSet.sortOrder } : {}),
		...(filterSet.groupBy !== undefined ? { groupBy: filterSet.groupBy } : {}),
		...(filterSet.groupOrder !== undefined ? { groupOrder: filterSet.groupOrder } : {}),
	};
}

/** Custom key mapping definition */
export interface KeyMapping {
	canonicalKey: string;
	visiblePropertyName: string;
	type: 'text' | 'number' | 'date' | 'datetime' | 'list' | 'checkbox';
	sync: 'yes' | 'no' | 'auto';
	/** Key mappings are always active. */
	enabled: boolean;
	/** Visual-only preference for hiding the property in rendered file-task metadata views. */
	hideInFileTaskView?: boolean;
	/** Optional centralized icon override for this canonical key. */
	icon?: string;
	/** True for the 32 built-in canonical keys; false for user-defined custom keys */
	isSystem: boolean;
	/** Hidden internal keys stay functional but are omitted from user-facing mapping UI. */
	isInternal?: boolean;
	/** Stable insertion order for user-defined custom keys. */
	customOrder?: number;
	/** Custom key surface flag for Task Editor metadata controls. */
	showInEditor?: boolean;
	/** Custom key surface flag for Task Creator metadata controls. */
	showInCreator?: boolean;
	/** Custom key surface flag for compact task chips. */
	showInChips?: boolean;
	/** Custom key surface flag for Kanban swimlane picker options. */
	showInKanbanSwimlane?: boolean;
	/** Optional user-facing description for custom fields. */
	description?: string;
}

type MigratingKeyMapping = Omit<KeyMapping, 'enabled' | 'hideInFileTaskView' | 'icon' | 'isSystem' | 'isInternal'> & Partial<Pick<KeyMapping, 'enabled' | 'hideInFileTaskView' | 'icon' | 'isSystem' | 'isInternal'>>;

const CANONICAL_KEY_ORDER_INDEX = new Map(CANONICAL_KEYS.map((key, index) => [key.name, index]));

export function normalizeKeyMappingComparableName(value: string): string {
	return value.trim().toLowerCase();
}

export function hasDuplicateKeyMappingCanonicalKey(
	canonicalKey: string,
	mappings: readonly KeyMapping[],
	exclude?: KeyMapping,
): boolean {
	const normalized = normalizeKeyMappingComparableName(canonicalKey);
	if (!normalized) return false;
	return mappings.some(mapping =>
		mapping !== exclude
		&& normalizeKeyMappingComparableName(mapping.canonicalKey) === normalized
	);
}

export function hasDuplicateKeyMappingVisiblePropertyName(
	visiblePropertyName: string,
	mappings: readonly KeyMapping[],
	exclude?: KeyMapping,
): boolean {
	const normalized = normalizeKeyMappingComparableName(visiblePropertyName);
	if (!normalized) return false;
	return mappings.some(mapping =>
		mapping !== exclude
		&& !isRetiredKeyMapping(mapping.canonicalKey)
		&& normalizeKeyMappingComparableName(mapping.visiblePropertyName) === normalized
	);
}

function normalizeCustomKeyMappingOrderValue(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
	return Math.floor(value);
}

export function getNextCustomKeyMappingOrder(mappings: readonly KeyMapping[]): number {
	let maxOrder = -1;
	for (const mapping of mappings) {
		if (mapping.isSystem !== false) continue;
		const normalizedOrder = normalizeCustomKeyMappingOrderValue(mapping.customOrder);
		if (normalizedOrder !== null) {
			maxOrder = Math.max(maxOrder, normalizedOrder);
		}
	}
	return maxOrder + 1;
}

function normalizeKeyMappingDescription(mapping: KeyMapping): void {
	if (typeof mapping.description !== 'string') {
		delete mapping.description;
		return;
	}
	const description = mapping.description.trim();
	if (description) {
		mapping.description = description;
	} else {
		delete mapping.description;
	}
}

function dedupeKeyMappingsByCanonicalKey(mappings: KeyMapping[]): KeyMapping[] {
	return mappings.filter((mapping, index, list) => {
		const normalizedCanonicalKey = normalizeKeyMappingComparableName(mapping.canonicalKey);
		const systemIndex = list.findIndex(candidate =>
			candidate.isSystem !== false
			&& normalizeKeyMappingComparableName(candidate.canonicalKey) === normalizedCanonicalKey
		);
		const firstIndex = systemIndex >= 0
			? systemIndex
			: list.findIndex(candidate => normalizeKeyMappingComparableName(candidate.canonicalKey) === normalizedCanonicalKey);
		return firstIndex === index;
	});
}

export function orderKeyMappingsForStorage(mappings: readonly KeyMapping[]): KeyMapping[] {
	return mappings
		.map((mapping, index) => ({ mapping, index }))
		.sort((left, right) => {
			const leftIsSystem = left.mapping.isSystem !== false;
			const rightIsSystem = right.mapping.isSystem !== false;
			if (leftIsSystem !== rightIsSystem) return leftIsSystem ? -1 : 1;
			if (leftIsSystem) {
				const leftIndex = CANONICAL_KEY_ORDER_INDEX.get(left.mapping.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
				const rightIndex = CANONICAL_KEY_ORDER_INDEX.get(right.mapping.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
				if (leftIndex !== rightIndex) return leftIndex - rightIndex;
				return left.mapping.canonicalKey.localeCompare(right.mapping.canonicalKey);
			}
			const leftOrder = normalizeCustomKeyMappingOrderValue(left.mapping.customOrder) ?? Number.MAX_SAFE_INTEGER;
			const rightOrder = normalizeCustomKeyMappingOrderValue(right.mapping.customOrder) ?? Number.MAX_SAFE_INTEGER;
			if (leftOrder !== rightOrder) return leftOrder - rightOrder;
			return left.index - right.index;
		})
		.map(entry => entry.mapping);
}

export function normalizeKeyMappingCollection(mappings: readonly KeyMapping[]): KeyMapping[] {
	const normalized = dedupeKeyMappingsByCanonicalKey(mappings.map(mapping => ({ ...mapping })));
	let nextCustomOrder = getNextCustomKeyMappingOrder(normalized);
	for (const mapping of normalized) {
		normalizeKeyMappingDescription(mapping);
		if (mapping.isSystem === false) {
			const customOrder = normalizeCustomKeyMappingOrderValue(mapping.customOrder);
			if (customOrder === null) {
				mapping.customOrder = nextCustomOrder;
				nextCustomOrder += 1;
			} else {
				mapping.customOrder = customOrder;
			}
			mapping.showInEditor = mapping.showInEditor !== false;
			mapping.showInCreator = mapping.showInCreator !== false;
			mapping.showInChips = mapping.showInChips === true;
			mapping.showInKanbanSwimlane = mapping.showInKanbanSwimlane === true;
		} else {
			delete mapping.customOrder;
			delete mapping.showInEditor;
			delete mapping.showInCreator;
			delete mapping.showInChips;
			delete mapping.showInKanbanSwimlane;
		}
	}
	return orderKeyMappingsForStorage(normalized);
}

export interface FileTaskTemplateDefinition {
	id: string;
	name: string;
	path: string;
}

export interface ExternalCalendarSource {
	id: string;
	type: 'ics';
	name: string;
	url: string;
	color: string;
	enabled: boolean;
	hideCreatedEvents: boolean;
	refreshIntervalHours: number;
}

export const TASK_CREATOR_TOOLBAR_FIELD_ORDER = [
	'taskIcon',
	'taskColor',
	'priority',
	'status',
	'parentTask',
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
	'pinned',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
	'repeat',
	'note',
	'subtasks',
	'blocking',
	'blockedBy',
	'assignees',
	'tags',
	'contexts',
	'location',
	'links',
] as const;

export type TaskCreatorToolbarFieldKey = typeof TASK_CREATOR_TOOLBAR_FIELD_ORDER[number];

export const TASK_EDITOR_WORKFLOW_PICKER_ORDER = [
	'contexts',
	'tags',
	'assignees',
	'location',
	'links',
	'parentTask',
	'subtasks',
	'blocking',
	'blockedBy',
] as const;

export type TaskEditorWorkflowPickerKey = typeof TASK_EDITOR_WORKFLOW_PICKER_ORDER[number];

export const TASK_EDITOR_MOBILE_CORE_TOOL_ORDER = [
	'goToSource',
	'play',
	'note',
	'taskIcon',
	'taskColor',
	'priority',
	'status',
	'blocking',
	'blockedBy',
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'datetimeStart',
	'estimate',
	'datetimeEnd',
	'repeat',
	'dateCompleted',
	'dateCancelled',
	'remove',
] as const;

export type TaskEditorMobileCoreToolKey = typeof TASK_EDITOR_MOBILE_CORE_TOOL_ORDER[number];

export const INLINE_TASK_COMPACT_CHIP_ORDER = [
	'priority',
	'status',
	'parentTask',
	'blocking',
	'blockedBy',
	'dateScheduled',
	'dateDue',
	'dateStarted',
	'dateCompleted',
	'dateCancelled',
	'datetimeStart',
	'datetimeEnd',
	'repeat',
	'assignees',
	'contexts',
	'location',
	'links',
	'duration',
	'totalDuration',
	'estimate',
	'totalEstimate',
	'tags',
] as const;

export type InlineTaskCompactChipKey = typeof INLINE_TASK_COMPACT_CHIP_ORDER[number];

export const INLINE_TASK_COMPACT_FALLBACK_ICONS: Record<InlineTaskCompactChipKey, string> = {
	priority: 'flag',
	status: 'circle-dot',
	parentTask: 'git-branch-plus',
	blocking: 'circle-stop',
	blockedBy: 'circle-pause',
	dateScheduled: 'calendar-clock',
	dateDue: 'calendar',
	dateStarted: 'play',
	dateCompleted: 'calendar-check',
	dateCancelled: 'calendar-x',
	datetimeStart: 'between-horizontal-start',
	datetimeEnd: 'between-horizontal-end',
	repeat: 'repeat-2',
	assignees: 'users',
	contexts: 'map-pinned',
	location: 'map-pin',
	links: 'link',
	duration: 'timer',
	totalDuration: 'timer-reset',
	estimate: 'hourglass',
	totalEstimate: 'hourglass',
	tags: 'tags',
};

export const TASK_CREATOR_FALLBACK_FIELD_ICONS: Record<TaskCreatorToolbarFieldKey, string> = {
	taskIcon: 'sparkles',
	taskColor: 'palette',
	priority: 'flag',
	status: 'circle-dot',
	parentTask: 'git-branch-plus',
	dateStarted: 'play',
	dateScheduled: 'calendar-clock',
	dateDue: 'calendar',
	dateCompleted: 'calendar-check',
	dateCancelled: 'calendar-x',
	pinned: 'pin',
	datetimeStart: 'clock-3',
	datetimeEnd: 'clock-9',
	estimate: 'hourglass',
	repeat: 'repeat-2',
	note: 'notebook-pen',
	subtasks: 'list-tree',
	blocking: 'circle-stop',
	blockedBy: 'circle-pause',
	assignees: 'users',
	tags: 'tags',
	contexts: 'map-pinned',
	location: 'map-pin',
	links: 'link',
};

export const TASK_EDITOR_MOBILE_CORE_FALLBACK_ICONS: Record<TaskEditorMobileCoreToolKey, string> = {
	goToSource: 'external-link',
	play: 'play',
	note: 'notebook-pen',
	taskIcon: 'shapes',
	taskColor: 'palette',
	priority: 'flag',
	status: 'circle-dot',
	blocking: 'circle-stop',
	blockedBy: 'circle-pause',
	dateStarted: 'plane-takeoff',
	dateScheduled: 'calendar-cog',
	dateDue: 'calendar-clock',
	datetimeStart: 'between-horizontal-start',
	estimate: 'equal-approximately',
	datetimeEnd: 'between-horizontal-end',
	repeat: 'repeat',
	dateCompleted: 'calendar-check',
	dateCancelled: 'calendar-x',
	remove: 'trash-2',
};

export interface TaskCreatorToolbarItem {
	key: string;
	visible: boolean;
}

export interface TaskEditorWorkflowPickerItem {
	key: string;
	visible: boolean;
}

export interface TaskEditorMobileCoreToolItem {
	key: string;
	visible: boolean;
}

export interface InlineTaskCompactChipItem {
	key: string;
	visible: boolean;
	iconOnly: boolean;
}

const CUSTOM_CANONICAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;

const ALL_BUILT_IN_SURFACE_KEYS = new Set<string>([
	...TASK_CREATOR_TOOLBAR_FIELD_ORDER,
	...TASK_EDITOR_WORKFLOW_PICKER_ORDER,
	...TASK_EDITOR_MOBILE_CORE_TOOL_ORDER,
	...INLINE_TASK_COMPACT_CHIP_ORDER,
]);

const BUILT_IN_CANONICAL_KEY_NAMES = new Set<string>(CANONICAL_KEYS.map(key => key.name));

export interface InlineExpandedTaskChips {
	priority: boolean;
	dateDue: boolean;
	dateScheduled: boolean;
	dateStarted: boolean;
	assignees: boolean;
	duration: boolean;
	estimate: boolean;
	tags: boolean;
	status: boolean;
}

export const DEFAULT_INLINE_EXPANDED_TASK_CHIPS: InlineExpandedTaskChips = {
	priority: true,
	dateDue: true,
	dateScheduled: false,
	dateStarted: false,
	assignees: true,
	duration: true,
	estimate: true,
	tags: true,
	status: false,
};

export const TASK_FINDER_DEFAULT_SCOPE_ORDER = [
	'projectTasks',
	'projectTree',
	'overdue',
	'happensToday',
	'recentModified',
	'includeInline',
	'includeFile',
	'includeCancelled',
	'includeFinished',
] as const;

export type TaskFinderDefaultScopeKey = typeof TASK_FINDER_DEFAULT_SCOPE_ORDER[number];

export const TASK_FINDER_DEFAULT_SCOPE_ICONS: Record<TaskFinderDefaultScopeKey, string> = {
	projectTasks: 'list-tree',
	projectTree: 'network',
	overdue: 'calendar-search',
	happensToday: 'zap',
	recentModified: 'monitor-cog',
	includeInline: 'list-todo',
	includeFile: 'scroll-text',
	includeCancelled: 'square-x',
	includeFinished: 'square-check-big',
};

export interface TaskFinderDefaultScopeItem {
	key: TaskFinderDefaultScopeKey;
	visible: boolean;
}

export interface TaskFinderShortcutItem {
	key: TaskFinderDefaultScopeKey;
	shortcut: string;
}

function buildDefaultInlineTaskCompactChipItems(): InlineTaskCompactChipItem[] {
	return [
		{ key: 'priority', visible: true, iconOnly: false },
		{ key: 'status', visible: true, iconOnly: true },
		{ key: 'parentTask', visible: true, iconOnly: true },
		{ key: 'blocking', visible: false, iconOnly: false },
		{ key: 'blockedBy', visible: false, iconOnly: false },
		{ key: 'dateStarted', visible: true, iconOnly: true },
		{ key: 'dateScheduled', visible: true, iconOnly: true },
		{ key: 'dateDue', visible: true, iconOnly: true },
		{ key: 'datetimeStart', visible: false, iconOnly: false },
		{ key: 'datetimeEnd', visible: false, iconOnly: false },
		{ key: 'repeat', visible: true, iconOnly: false },
		{ key: 'assignees', visible: true, iconOnly: false },
		{ key: 'contexts', visible: true, iconOnly: false },
		{ key: 'location', visible: true, iconOnly: false },
		{ key: 'links', visible: false, iconOnly: false },
		{ key: 'tags', visible: true, iconOnly: false },
		{ key: 'estimate', visible: true, iconOnly: false },
		{ key: 'duration', visible: true, iconOnly: false },
		{ key: 'dateCompleted', visible: true, iconOnly: true },
		{ key: 'dateCancelled', visible: true, iconOnly: true },
		{ key: 'totalDuration', visible: true, iconOnly: false },
		{ key: 'totalEstimate', visible: false, iconOnly: false },
	];
}

function buildDefaultTaskCreatorToolbarItems(): TaskCreatorToolbarItem[] {
	return [
		{ key: 'taskIcon', visible: true },
		{ key: 'taskColor', visible: true },
		{ key: 'priority', visible: true },
		{ key: 'status', visible: true },
		{ key: 'parentTask', visible: true },
		{ key: 'contexts', visible: true },
		{ key: 'location', visible: true },
		{ key: 'links', visible: false },
		{ key: 'dateStarted', visible: false },
		{ key: 'dateScheduled', visible: true },
		{ key: 'dateDue', visible: true },
		{ key: 'dateCompleted', visible: false },
		{ key: 'dateCancelled', visible: false },
		{ key: 'pinned', visible: true },
		{ key: 'datetimeStart', visible: false },
		{ key: 'datetimeEnd', visible: false },
		{ key: 'estimate', visible: true },
		{ key: 'repeat', visible: true },
		{ key: 'subtasks', visible: false },
		{ key: 'blocking', visible: false },
		{ key: 'blockedBy', visible: false },
		{ key: 'tags', visible: false },
		{ key: 'assignees', visible: true },
		{ key: 'note', visible: true },
	];
}

function buildDefaultTaskEditorWorkflowPickerItems(): TaskEditorWorkflowPickerItem[] {
	return [
		{ key: 'contexts', visible: true },
		{ key: 'tags', visible: true },
		{ key: 'assignees', visible: true },
		{ key: 'location', visible: true },
		{ key: 'links', visible: true },
		{ key: 'parentTask', visible: true },
		{ key: 'subtasks', visible: true },
		{ key: 'blocking', visible: false },
		{ key: 'blockedBy', visible: false },
	];
}

function buildDefaultTaskEditorMobileCoreToolItems(): TaskEditorMobileCoreToolItem[] {
	return TASK_EDITOR_MOBILE_CORE_TOOL_ORDER.map(key => ({
		key,
		visible: key !== 'blocking' && key !== 'blockedBy',
	}));
}

export function buildCompatibilityTaskEditorWorkflowPickerItems(): TaskEditorWorkflowPickerItem[] {
	return TASK_EDITOR_WORKFLOW_PICKER_ORDER.map(key => ({ key, visible: true }));
}

function buildDefaultFilterTaskCompactChipItems(): InlineTaskCompactChipItem[] {
	return [
		{ key: 'priority', visible: true, iconOnly: false },
		{ key: 'status', visible: true, iconOnly: true },
		{ key: 'parentTask', visible: true, iconOnly: true },
		{ key: 'blocking', visible: false, iconOnly: false },
		{ key: 'blockedBy', visible: false, iconOnly: false },
		{ key: 'dateScheduled', visible: true, iconOnly: true },
		{ key: 'dateDue', visible: true, iconOnly: true },
		{ key: 'dateStarted', visible: true, iconOnly: true },
		{ key: 'dateCompleted', visible: true, iconOnly: true },
		{ key: 'dateCancelled', visible: true, iconOnly: true },
		{ key: 'datetimeStart', visible: false, iconOnly: false },
		{ key: 'datetimeEnd', visible: false, iconOnly: false },
		{ key: 'repeat', visible: true, iconOnly: false },
		{ key: 'assignees', visible: true, iconOnly: false },
		{ key: 'contexts', visible: true, iconOnly: false },
		{ key: 'location', visible: true, iconOnly: false },
		{ key: 'links', visible: false, iconOnly: false },
		{ key: 'duration', visible: true, iconOnly: false },
		{ key: 'estimate', visible: true, iconOnly: true },
		{ key: 'tags', visible: false, iconOnly: false },
		{ key: 'totalDuration', visible: true, iconOnly: false },
		{ key: 'totalEstimate', visible: false, iconOnly: false },
	];
}

function buildDefaultTaskFinderCompactChipItems(): InlineTaskCompactChipItem[] {
	return [
		{ key: 'priority', visible: true, iconOnly: false },
		{ key: 'status', visible: false, iconOnly: false },
		{ key: 'parentTask', visible: true, iconOnly: false },
		{ key: 'blocking', visible: false, iconOnly: false },
		{ key: 'blockedBy', visible: false, iconOnly: false },
		{ key: 'dateScheduled', visible: false, iconOnly: false },
		{ key: 'dateDue', visible: false, iconOnly: false },
		{ key: 'dateStarted', visible: false, iconOnly: false },
		{ key: 'dateCompleted', visible: false, iconOnly: false },
		{ key: 'dateCancelled', visible: false, iconOnly: false },
		{ key: 'datetimeStart', visible: false, iconOnly: false },
		{ key: 'datetimeEnd', visible: false, iconOnly: false },
		{ key: 'repeat', visible: false, iconOnly: false },
		{ key: 'assignees', visible: false, iconOnly: false },
		{ key: 'contexts', visible: true, iconOnly: false },
		{ key: 'location', visible: true, iconOnly: false },
		{ key: 'links', visible: false, iconOnly: false },
		{ key: 'duration', visible: false, iconOnly: false },
		{ key: 'totalDuration', visible: false, iconOnly: false },
		{ key: 'estimate', visible: false, iconOnly: false },
		{ key: 'totalEstimate', visible: false, iconOnly: false },
		{ key: 'tags', visible: false, iconOnly: false },
	];
}

function buildDefaultOverlayTaskCompactChipItems(): InlineTaskCompactChipItem[] {
	return [
		{ key: 'priority', visible: false, iconOnly: false },
		{ key: 'status', visible: false, iconOnly: false },
		{ key: 'parentTask', visible: false, iconOnly: false },
		{ key: 'blocking', visible: false, iconOnly: false },
		{ key: 'blockedBy', visible: false, iconOnly: false },
		{ key: 'dateScheduled', visible: false, iconOnly: false },
		{ key: 'dateDue', visible: false, iconOnly: false },
		{ key: 'dateStarted', visible: false, iconOnly: false },
		{ key: 'dateCompleted', visible: false, iconOnly: false },
		{ key: 'dateCancelled', visible: false, iconOnly: false },
		{ key: 'datetimeStart', visible: false, iconOnly: false },
		{ key: 'datetimeEnd', visible: false, iconOnly: false },
		{ key: 'repeat', visible: false, iconOnly: false },
		{ key: 'assignees', visible: true, iconOnly: true },
		{ key: 'contexts', visible: false, iconOnly: false },
		{ key: 'location', visible: false, iconOnly: false },
		{ key: 'links', visible: false, iconOnly: false },
		{ key: 'duration', visible: true, iconOnly: true },
		{ key: 'totalDuration', visible: true, iconOnly: false },
		{ key: 'estimate', visible: false, iconOnly: false },
		{ key: 'totalEstimate', visible: false, iconOnly: false },
		{ key: 'tags', visible: false, iconOnly: false },
	];
}

function buildDefaultTaskFinderDefaultScopeItems(): TaskFinderDefaultScopeItem[] {
	return TASK_FINDER_DEFAULT_SCOPE_ORDER.map(key => ({
		key,
		visible: key === 'includeInline' || key === 'includeFile',
	}));
}

function buildDefaultTaskFinderShortcutItems(): TaskFinderShortcutItem[] {
	return TASK_FINDER_DEFAULT_SCOPE_ORDER.map((key, index) => ({
		key,
		shortcut: String(index + 1),
	}));
}

export function createExternalCalendarSourceId(): string {
	return `ecs_${Math.random().toString(36).slice(2, 9)}`;
}

const DEFAULT_KEY_MAPPING_ICONS: Record<string, string> = {
	operonId: 'fingerprint',
	status: 'align-start-horizontal',
	priority: 'flag',
	dateDue: 'calendar-clock',
	dateScheduled: 'calendar-cog',
	dateStarted: 'plane-takeoff',
	datetimeCreated: 'calendar-plus-2',
	dateCompleted: 'calendar-check',
	dateCancelled: 'calendar-x',
	datetimeStart: 'between-horizontal-start',
	datetimeEnd: 'between-horizontal-end',
	estimate: 'equal-approximately',
	duration: 'timer',
	totalEstimate: 'target',
	totalDuration: 'clipboard-clock',
	repeat: 'repeat',
	repeatSeriesId: '',
	repeatOccurrenceDate: '',
	datetimeRepeatEnd: 'calendar-off',
	parentTask: 'workflow',
	blocking: 'circle-stop',
	blockedBy: 'circle-pause',
	assignees: 'users',
	contexts: 'compass',
	progress: 'percent',
	directSubtaskCount: '',
	directDoneSubtaskCount: '',
	directOpenSubtaskCount: '',
	treeDescendantCount: '',
	treeDoneDescendantCount: '',
	treeOpenDescendantCount: '',
	reminders: 'bell-ring',
	timezone: 'globe-2',
	trackers: 'history',
	activeTracker: 'play',
	related: 'link-2',
	taskIcon: 'shapes',
	taskColor: 'palette',
	note: 'notebook-pen',
	location: 'map-pin',
	links: 'link',
	datetimeModified: 'file-cog',
};

// Retired canonical keys stay readable through legacy parsers, but must not
// participate in active key-mapping generation, migration, or visibility rules.
const RETIRED_KEY_MAPPING_KEYS = new Set<string>(['related']);

export function isRetiredKeyMapping(canonicalKey: string): boolean {
	return RETIRED_KEY_MAPPING_KEYS.has(canonicalKey);
}

export function isChildTaskInheritanceEligibleFieldKey(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[] | null | undefined,
): boolean {
	const normalizedKey = canonicalKey.trim();
	if (!normalizedKey || CHILD_TASK_INHERITANCE_BLOCKED_FIELD_KEYS.has(normalizedKey) || isRetiredKeyMapping(normalizedKey)) {
		return false;
	}
	if (normalizedKey === CHILD_TASK_INHERITANCE_TAGS_KEY) {
		return true;
	}
	const canonical = CANONICAL_KEYS.find(key => key.name === normalizedKey);
	if (canonical) {
		return canonical.internal !== true;
	}
	const mapping = keyMappings?.find(candidate => candidate.canonicalKey === normalizedKey);
	return !!mapping
		&& mapping.isSystem === false
		&& mapping.isInternal !== true
		&& !isRetiredKeyMapping(mapping.canonicalKey);
}

export function normalizeChildTaskInheritanceFields(
	raw: unknown,
	keyMappings: readonly KeyMapping[] | null | undefined,
): string[] {
	if (!Array.isArray(raw)) return [...DEFAULT_CHILD_TASK_INHERITANCE_FIELDS];
	const seen = new Set<string>();
	const fields: string[] = [];
	for (const value of raw) {
		if (typeof value !== 'string') continue;
		const key = value.trim();
		if (!isChildTaskInheritanceEligibleFieldKey(key, keyMappings) || seen.has(key)) continue;
		seen.add(key);
		fields.push(key);
	}
	return fields;
}

export function normalizeChildTaskInheritanceStatusPipelineSource(
	raw: unknown,
	fallback: ChildTaskInheritanceStatusPipelineSource = 'parent',
): ChildTaskInheritanceStatusPipelineSource {
	if (raw === 'parent' || raw === 'default') return raw;
	return fallback;
}

function getDefaultKeyMappingIcon(canonicalKey: string): string {
	return normalizeTaskIconValue(DEFAULT_KEY_MAPPING_ICONS[canonicalKey] ?? '');
}

const DEFAULT_KEY_MAPPING_VISIBLE_NAMES: Record<string, string> = {
	links: 'Links',
};

function getDefaultKeyMappingVisibleName(canonicalKey: string): string {
	return DEFAULT_KEY_MAPPING_VISIBLE_NAMES[canonicalKey] ?? canonicalKey;
}

/** Generate default key mappings from all canonical keys */
function buildDefaultKeyMappings(): KeyMapping[] {
	return CANONICAL_KEYS
		.filter(k => !isRetiredKeyMapping(k.name))
		.map(k => ({
			canonicalKey: k.name,
			visiblePropertyName: getDefaultKeyMappingVisibleName(k.name),
			type: k.type,
			sync: k.sync,
			enabled: true,
			hideInFileTaskView: k.internal === true,
			icon: getDefaultKeyMappingIcon(k.name),
			isSystem: true,
			isInternal: k.internal === true,
		}));
}

/** Complete Operon settings interface (v1) */
export interface OperonSettings {
	settingsVersion: number;

	// Pipeline configuration
	pipelines: Pipeline[];
	defaultPipelineName: string;

	// Priority configuration (ordered: index 0 = highest importance)
	priorities: PriorityDefinition[];
	/** Default priority for new tasks. Empty string = no default. */
	defaultPriority: string;

	// Key mappings
	keyMappings: KeyMapping[];

	// Filter sets (user-defined)
	filterSets: FilterSet[];

	/** Global presentation: expand parent tasks to reveal subtasks in all filter surfaces. */
	filterShowSubtasks: boolean;
	/** Global presentation: when showing subtasks, hide non-open ones under each parent. */
	filterShowOnlyOpenSubtasks: boolean;
	/** Automatically show the reserved dynamic filter inside YAML file task notes. */
	dynamicFileTaskFilterEnabled: boolean;
	/** Where the dynamic file task filter appears in the note body. */
	dynamicFileTaskFilterPlacement: DynamicFileTaskFilterPlacement;
	/** Dynamic filter presentation: auto-expand the visible subtask tree at or below this limit. */
	dynamicFileTaskFilterSubtaskAutoExpandLimit: DynamicFileTaskFilterSubtaskAutoExpandLimit;
	/** Dynamic filter presentation: hide non-open subtasks under each parent. */
	dynamicFileTaskFilterShowOnlyOpenSubtasks: boolean;
	/** Dynamic subtasks filter presentation: auto-expand the visible subtask tree at or below this limit. */
	dynamicSubtasksFilterSubtaskAutoExpandLimit: DynamicFileTaskFilterSubtaskAutoExpandLimit;
	/** Dynamic subtasks filter presentation: hide non-open subtasks under each parent. */
	dynamicSubtasksFilterShowOnlyOpenSubtasks: boolean;

	/** UI language override. 'auto' = detect from Obsidian locale. */
	language: OperonLanguage;
	timeFormat: '24h' | '12h';
	demoWorkspacePromptDismissed: boolean;
	releaseNotesShowOnUpdate: boolean;
	releaseNotesLastShownVersion: string;
	operonDocsAutoUpdateEnabled: boolean;
	/** User-customizable named colors used by Operon color pickers. */
	colorPalette: ColorPaletteEntry[];

	// Task creation
	taskCreateDebounceMs: number;
	taskDescriptionRequired: boolean;
	assigneesRequired: boolean;

	/** Default folder for new file tasks. Empty = vault root. */
	fileTasksFolder: string;
	/** If true, finished/cancelled file tasks are moved to the archive folder after a delay. */
	fileTaskAutoArchiveEnabled: boolean;
	/** Folder where finished/cancelled file tasks are moved. */
	fileTaskArchiveFolder: string;
	/** Seconds to wait before moving an eligible finished/cancelled file task. */
	fileTaskArchiveDelaySeconds: number;
	/** If true, only file tasks currently inside fileTasksFolder are auto-archived. */
	fileTaskArchiveOnlyFromFileTasksFolder: boolean;
	/** Where New Operon Task writes file tasks when the selected parent is an inline task. */
	fileTaskParentInlineTargetMode: FileTaskParentInlineTargetMode;
	/** Where New Operon Task writes file tasks when the selected parent is a file task. */
	fileTaskParentFileTargetMode: FileTaskParentFileTargetMode;
	/** If true, inline-to-file task conversion moves scoped plain checkboxes into the new file task. */
	inlineToFileTaskMovePlainCheckboxes: boolean;
	/** Where New Operon Task writes inline tasks by default. */
	inlineTaskSaveMode: InlineTaskSaveMode;
	/** Legacy daily-note toggle mirror for compatibility with older stores. */
	inlineTaskUseDailyNote: boolean;
	/** Optional fixed markdown file target used when inlineTaskUseDailyNote is false. */
	inlineTaskTargetFile: string;
	/** Markdown heading used as the insertion target for inline tasks created by New Operon Task. */
	inlineTaskHeading: string;
	/** Where New Operon Task writes inline tasks when the selected parent is an inline task. */
	inlineTaskParentInlineTargetMode: InlineTaskParentInlineTargetMode;
	/** Where New Operon Task writes inline tasks when the selected parent is a file task. */
	inlineTaskParentFileTargetMode: InlineTaskParentFileTargetMode;
	/** Keyword used to find or create a heading inside a file parent for new inline tasks. */
	inlineTaskParentFileHeadingKeyword: string;
	/** If true, new inline Operon tasks in Daily Notes auto-get dateStarted from the note date when blank. */
	inlineTaskDailyNoteAddStartDate: boolean;
	/** If true, new inline Operon tasks in Daily Notes auto-get dateScheduled from the note date when blank. */
	inlineTaskDailyNoteAddScheduledDate: boolean;
	/** If true, inline tasks created inside a file task file auto-get parentTask set to that file task. */
	autoParentFileTask: boolean;
	/** If true, linked file tasks created inside a file task file auto-get parentTask set to that file task. */
	autoParentLinkedFileSubtasks: boolean;
	/** Ordered list of parent fields copied or derived when creating child tasks. */
	childTaskInheritanceFields: string[];
	/** Pipeline source used when status is inherited into a child task. */
	childTaskInheritanceStatusPipelineSource: ChildTaskInheritanceStatusPipelineSource;
	/** Read-only visual serial scopes assigned to parent task trees. */
	projectSerialScopes: ProjectSerialScope[];
	/** If true, estimate reallocation is applied automatically on explicit estimate commits. */
	estimateAutoReallocation: boolean;
	/** Ordered, user-customizable visual controls for the New Operon Task toolbar. */
	taskCreatorToolbar: TaskCreatorToolbarItem[];
	/** If true, the Task Editor file body source panel shows source line numbers. */
	taskEditorShowLineNumbers: boolean;
	/** Seconds to wait after the last Task Editor edit before autosaving. */
	taskEditorAutosaveDelaySeconds: number;
	/** Ordered, user-customizable picker rows shown in the Task Editor workflow area. */
	taskEditorWorkflowPickers: TaskEditorWorkflowPickerItem[];
	/** Ordered, phone-only core action icons shown in the Task Editor compact toolbar. */
	taskEditorMobileCoreTools: TaskEditorMobileCoreToolItem[];
	/** Ordered, user-customizable compact inline-task chips used in live preview conceal and reading view. */
	inlineTaskCompactChips: InlineTaskCompactChipItem[];
	/** Ordered, user-customizable compact filter chips used by filter surfaces. */
	filterTaskCompactChips: InlineTaskCompactChipItem[];
	/** Ordered, user-customizable compact chips used by the Task Finder result rows. */
	taskFinderCompactChips: InlineTaskCompactChipItem[];
	/** Persisted last-used opening buttons for the normal Task Finder command. Hidden from the settings UI. */
	taskFinderDefaultScope: TaskFinderDefaultScopeItem[];
	/** Whether the normal Task Finder command reopens with the last-used scope buttons and project selection. */
	taskFinderRememberLastScopes: boolean;
	/** Persisted selected project/parent used when reopening the normal Task Finder command. */
	taskFinderSelectedProjectId: string;
	/** Dot-command shortcuts used inside Task Finder, stored without the leading dot. */
	taskFinderShortcuts: TaskFinderShortcutItem[];
	/** Whether Task Finder opens directly in recent modified mode. @deprecated use taskFinderDefaultScope */
	taskFinderShowRecentModifiedOnOpen: boolean;
	/** Number of days used by Task Finder recent modified mode. */
	taskFinderRecentModifiedDays: number;
	/** Number of Task Finder result rows visible before the list scrolls. */
	taskFinderVisibleResultCount: number;
	/** Ordered, user-customizable compact chips used by file task overlay mode. */
	overlayTaskCompactChips: InlineTaskCompactChipItem[];
	/** Whether file task overlay rows show the right-side timer action when the task is actionable. */
	overlayTaskShowPlayAction: boolean;
	/** Whether file task overlay rows show the right-side pin action when the task is actionable. */
	overlayTaskShowPinAction: boolean;
	/** Whether file task overlay rows show the note indicator when the task has a note. */
	overlayTaskShowNoteAction: boolean;
	/** Whether file task overlay rows show the right-side add subtask action. */
	overlayTaskShowSubtaskAction: boolean;
	/** Whether file task overlay rows show the plain checkbox editor action. */
	overlayTaskShowPlainCheckboxAction: boolean;
	/** Whether the compact inline row shows the right-side timer action when the task is actionable. */
	inlineTaskShowPlayAction: boolean;
	/** Whether the compact inline row shows the right-side pin action when the task is actionable. */
	inlineTaskShowPinAction: boolean;
	/** Whether the compact inline row shows the right-side add subtask action. */
	inlineTaskShowSubtaskAction: boolean;
	/** Whether classic Tasks emoji checkbox lines show a hover-only convert icon in Live Preview. */
	inlineTaskShowTasksEmojiConvertIcon: boolean;
	/** Whether plain checkbox lines show a hover-only convert icon in Live Preview. */
	inlineTaskShowPlainCheckboxConvertIcon: boolean;
	/** Whether filter rows show the right-side timer action when the task is actionable. */
	filterTaskShowPlayAction: boolean;
	/** Whether filter rows show the right-side pin action when the task is actionable. */
	filterTaskShowPinAction: boolean;
	/** Whether filter rows show the right-side add subtask action. */
	filterTaskShowSubtaskAction: boolean;
	/** Whether filter rows show the right-side plain checkbox progress action. */
	filterTaskShowPlainCheckboxAction: boolean;

	// Workspace tweaks
	/** If true, hide Obsidian workspace scrollbars while preserving scrolling. */
	workspaceTweaksHideScrollbars: boolean;
	/** If true, collapse Obsidian Properties when opening matching notes. */
	workspaceTweaksCollapseProperties: boolean;
	/** Which notes receive the Properties collapser tweak. */
	workspaceTweaksPropertiesScope: WorkspaceTweaksPropertiesScope;
	/** Vault folders whose notes always keep Properties open. */
	workspaceTweaksPropertiesExcludedFolders: string[];
	/** If true, compact side dock tab icon/header strips until hovered. */
	workspaceTweaksCompactSidebarTabIcons: boolean;

	// Location map
	locationMapsAlwaysLightMode: boolean;
	locationPlaceIconPropertyName: string;
	locationPlaceColorPropertyName: string;
	locationPickerMapDefaultCenter: string;
	locationPickerMapDefaultZoom: number;
	locationPreviewWidth: number;
	locationPreviewHeight: number;
	locationPreviewDefaultZoom: number;
	locationPreviewMinZoom: number;
	locationPreviewMaxZoom: number;

	// Floating UI
	dockHoverOpenDelayMs: number;
	floatingAutoCloseSec: number;

	// Inline rendering
	inlineRowWidth: number;
	inlineRowDefaultMode: 'compact' | 'expanded';
	inlineExpandedMetadataDensity: 'low' | 'medium' | 'high';
	inlineBackgroundIntensity: number;

	// Pinned tasks
	pinnedTasksDesktopSurface: PinnedTasksDesktopSurface;
	pinnedTasksSidebarSide: PinnedTasksSidebarSide;
	pinnedTaskItemWidth: number;
	pinnedDockPosition: 'bottom-center' | 'bottom-left' | 'bottom-right';
	pinnedDockX: number | null;
	pinnedDockY: number | null;
	pinnedDockVisible: boolean;
	pinnedDockCollapsed: boolean;
	pinnedDockLayout: 'horizontal' | 'vertical' | 'grid';
	pinnedDockGridCols: 2 | 3 | 4 | 5;
	pinnedDockDisableOnMobile: boolean;
	mobileGlobalTaskFabEnabled: boolean;
	mobileGlobalTaskFabHideInCalendar: boolean;
	mobileGlobalTaskFabHideInKanban: boolean;
	mobileGlobalTaskFabPosition: MobileGlobalTaskFabPosition | null;
	pinnedDockAutoCloseEnabled: boolean;
	pinnedDockAutoPin: boolean;
	pinnedDockAutoUnpinFinished: boolean;
	pinnedDockColorSource: PinnedDockTaskColorSource;

	// Rail views
	leftRailDefaultView: string;
	leftRailDefaultFilterViewId: string | null;
	leftRailMaxTabs: number;
	rightRailMaxTabs: number;
	leftRailViewOrder: string[];
	rightRailViewOrder: string[];

	// Calendar
	calendarPresets: CalendarPreset[];
	calendarDefaultPresetId: string | null;
	calendarWeekStart: 'monday' | 'sunday';
	externalCalendars: ExternalCalendarSource[];
	contextualMenuActionAllowlist: ContextualMenuActionId[];
	contextualMenuSurfaceActionMatrix: ContextualMenuSurfaceActionMatrix;
	contextualMenuOpenDelayMs: number;
	contextualMenuMobileEnabled: boolean;
	contextualMenuMobileLongPressMs: number;
	contextualMenuMobileTransitionGraceMs: number;
	contextualMenuMobileAutoHideMs: number;
	calendarInlineTaskHeading: string;
	calendarShowAllDayLane: boolean;
	calendarShowDueMarkers: boolean;
	calendarDefaultScrollHour: number;
	calendarInitialScrollMode: 'fixedHour' | 'autoNow';
	calendarDayTitleAction: CalendarDayTitleAction;
	calendarAutoScrollPastRatio: number;
	calendarTimeGridScale: number;
	calendarSidebarWidthPx: number;
	calendarSidebarCalendarsDefaultExpanded: boolean;
	calendarSidebarShowWeekNumbers: boolean;
	calendarShowWeekLabelOnFirstDay: boolean;
	calendarSidebarTaskPoolDefaultExpanded: boolean;
	calendarSidebarTaskPoolFollowPresetFilter: boolean;
	calendarSidebarFinishedTasksDefaultExpanded: boolean;
	calendarTouchTimeGridTaskMoveEnabled: boolean;
	calendarTouchDragLongPressMs: number;
	calendarTouchDragCancelDistancePx: number;
	calendarMobileEnabled: boolean;
	calendarMobileMaxWidthPx: number;
	calendarMobileDefaultView: CalendarMobileViewMode;
	calendarMobileDefaultSourcePresetId: string | null;
	calendarMobileAgendaEnabled: boolean;
	calendarMobileDayEnabled: boolean;
	calendarMobileTwoDayEnabled: boolean;
	calendarMobileThreeDayEnabled: boolean;
	calendarMobileAgendaSourcePresetId: string | null;
	calendarMobileDaySourcePresetId: string | null;
	calendarMobileTwoDaySourcePresetId: string | null;
	calendarMobileThreeDaySourcePresetId: string | null;
	calendarMobileSlotMinutes: number;
	calendarMobileShowProjectedOccurrences: boolean;
	calendarMobileShowExternalCalendars: boolean;
	calendarMobileColorSource: CalendarColorSource;
	calendarMobileShowDueMarkers: boolean;
	calendarMobileShowAllDayItems: boolean;
	calendarMobileAgendaPastDays: CalendarMobileAgendaPastDays;
	calendarMobileAgendaFutureDays: CalendarMobileAgendaFutureDays;
	calendarMobileAgendaShowCompletedItems: boolean;
	calendarMobileAllDayVisibleTaskLimit: CalendarMobileAllDayVisibleTaskLimit;
	calendarMobileShowCompletedItems: boolean;

	// Kanban
	kanbanPresets: KanbanPreset[];
	kanbanDefaultPresetId: string | null;
	kanbanExpandedColumnWidthPx: number;
	kanbanMaxVisibleTasksPerCell: number;
	kanbanMobileLayoutChromeEnabled: boolean;
	kanbanMobileLayoutMaxWidthPx: number;
	kanbanMobileCompactSwimlaneWidthPx: number;
	kanbanMobileSwimlaneRailAlwaysVisible: boolean;
	kanbanMobileHorizontalStatusSnapEnabled: boolean;

	// Indexer
	indexEventDebounceMs: number;
	fullReindexOnStartup: boolean;
	duplicateAlertAutoOpenManager: boolean;
	duplicateAlertDelaySeconds: number;
	taskStatsBackfillVersion: number;

	// File task creation defaults and templates
	/** If true, generic Task Creator opens with File Task selected. */
	taskCreatorDefaultToFileTask: boolean;
	/** Optional default template applied when Task Creator enters File Task mode. */
	taskCreatorDefaultFileTemplateId: string | null;
	/** Folder whose top-level markdown files are offered in the file-task template picker. */
	fileTaskTemplateFolder: string;
	/** Additional vault folders excluded from Operon's global task index. */
	excludedFolders: string[];
	/** If true, daily notes created by Operon are initialized as minimal Operon file tasks. */
	createDailyNotesAsOperonTask: boolean;
	/** Most recently used template for Create File Task picker ordering. */
	lastUsedFileTaskTemplateId: string | null;

	// Time tracking
	defaultEstimateMinutes: number;
	trackerHistoryDays: number;
	trackerShowStatusBarTimer: boolean;
	trackerSplitSessionsAtMidnight: boolean;
	trackerTaskDescriptionClickAction: TrackerTaskDescriptionClickAction;
	flowTimeMode: FlowTimeMode;
	flowTimeSessionMinutes: number;
	flowTimePauseMinutes: number;
	flowTimeUseLastSelectedDuration: boolean;
	flowTimeDefaultSessionMinutes: number;
	flowTimeShowNumericTimer: boolean;
	flowTimeNotifyOnTargetReached: boolean;

	// Recurrence
	newOccurrencePosition: 'above' | 'below';
	fileRepeatDestination: 'same-folder' | 'custom-folder';
	fileRepeatCustomFolder: string;

	// Parent automation
	autoCompleteParentWhenAllChildrenTerminal: boolean;
	cascadeCancelToDescendants: boolean;

	// Inline expanded task bar chip visibility
	inlineExpandedTaskChips: InlineExpandedTaskChips;
	/** Whether subtask lists are expanded by default */
	taskBarSubtasksDefaultExpanded: boolean;
	fallbackTaskIconSource: FallbackTaskIconSource;
	fallbackStateIcons: {
		open: string;
		done: string;
		cancelled: string;
	};

}

export type CalendarSidebarDefaultStateKey =
	| 'calendarSidebarCalendarsDefaultExpanded'
	| 'calendarSidebarTaskPoolDefaultExpanded';

export type CalendarSidebarDefaultExpansionState = Pick<
	OperonSettings,
	CalendarSidebarDefaultStateKey
>;

const CALENDAR_SIDEBAR_DEFAULT_STATE_KEYS: CalendarSidebarDefaultStateKey[] = [
	'calendarSidebarCalendarsDefaultExpanded',
	'calendarSidebarTaskPoolDefaultExpanded',
];

export function normalizeCalendarSidebarDefaultExpansionState(
	state: CalendarSidebarDefaultExpansionState,
	changedKey?: CalendarSidebarDefaultStateKey,
): CalendarSidebarDefaultExpansionState {
	const normalized: CalendarSidebarDefaultExpansionState = { ...state };
	const expandedKeys = CALENDAR_SIDEBAR_DEFAULT_STATE_KEYS.filter(key => normalized[key]);

	if (expandedKeys.length === 0) {
		const fallbackKey = CALENDAR_SIDEBAR_DEFAULT_STATE_KEYS.find(key => key !== changedKey)
			?? 'calendarSidebarCalendarsDefaultExpanded';
		normalized[fallbackKey] = true;
		return normalized;
	}

	if (expandedKeys.length > 2) {
		const keyToCollapse = CALENDAR_SIDEBAR_DEFAULT_STATE_KEYS.find(key => key !== changedKey && normalized[key])
			?? expandedKeys[0];
		normalized[keyToCollapse] = false;
	}

	return normalized;
}

/** Default settings values */
export const DEFAULT_INLINE_TASK_TARGET_FILE = 'Operon/Tasks/Operon Inbox.md';
export const DEFAULT_INLINE_TASK_HEADING_KEYWORD = 'New Todo';
export const DEFAULT_INLINE_TASK_PARENT_FILE_HEADING_KEYWORD = 'Backlog';
export function normalizeInlineTaskHeadingKeyword(raw: string): string {
	return normalizeMarkdownHeadingKeyword(raw, DEFAULT_INLINE_TASK_HEADING_KEYWORD);
}

export function normalizeInlineTaskParentFileHeadingKeyword(raw: string): string {
	return normalizeMarkdownHeadingKeyword(raw, DEFAULT_INLINE_TASK_PARENT_FILE_HEADING_KEYWORD);
}

function cloneDefaultFilterSets(): FilterSet[] {
	const filterSets: FilterSet[] = [
		{
			id: 'fs_3n8dail',
			name: 'Daily ToDo',
			icon: 'calendar-day',
			rootGroup: {
				id: 'fg_fs_3n8dail',
				logic: 'all',
				children: [
					{
						id: 'cond_4h2today',
						field: 'dateScheduled',
						fieldType: 'date',
						operator: 'isToday',
					},
					{
						id: 'grp_j7nolog',
						logic: 'all',
						children: [
							{
								id: 'cond_9z8nolog',
								field: 'status',
								fieldType: 'text',
								operator: 'notContains',
								value: 'log',
							},
						],
					},
				],
			},
			sorts: [
				{ field: 'checkbox', order: 'asc' },
				{ field: 'priority', order: 'asc' },
			],
			matchLogic: 'all',
			conditions: [
				{
					id: 'cond_4h2today',
					field: 'dateScheduled',
					fieldType: 'date',
					operator: 'isToday',
				},
				{
					id: 'cond_9z8nolog',
					field: 'status',
					fieldType: 'text',
					operator: 'notContains',
					value: 'log',
				},
			],
			sortBy: 'checkbox',
			sortOrder: 'asc',
			groupBy: 'dateScheduled',
			groupOrder: 'desc',
		},
		{
			id: 'fs_7dopen',
			name: 'Last Seven Days Open',
			icon: 'calendar-week',
			rootGroup: {
				id: 'fg_fs_7dopen',
				logic: 'all',
				children: [
					{
						id: 'cond_2xisopen',
						field: 'checkbox',
						fieldType: 'checkbox',
						operator: 'isOpen',
					},
					{
						id: 'cond_7daysago',
						field: 'dateScheduled',
						fieldType: 'date',
						operator: 'underDaysAgo',
						value: '7',
					},
				],
			},
			sorts: [{ field: 'priority', order: 'asc' }],
			matchLogic: 'all',
			conditions: [
				{
					id: 'cond_2xisopen',
					field: 'checkbox',
					fieldType: 'checkbox',
					operator: 'isOpen',
				},
				{
					id: 'cond_7daysago',
					field: 'dateScheduled',
					fieldType: 'date',
					operator: 'underDaysAgo',
					value: '7',
				},
			],
			sortBy: 'priority',
			sortOrder: 'asc',
			groupBy: 'happensOn',
			groupOrder: 'desc',
		},
	];
	return filterSets.map(cloneFilterSet);
}

export const DEFAULT_SETTINGS: OperonSettings = {
	settingsVersion: CURRENT_SETTINGS_VERSION,

	pipelines: DEFAULT_PIPELINES,
	defaultPipelineName: DEFAULT_PIPELINES[0]?.name ?? '',
	priorities: cloneDefaultPriorities(),
	defaultPriority: 'C',
	keyMappings: buildDefaultKeyMappings(),
	filterSets: cloneDefaultFilterSets(),

	filterShowSubtasks: true,
	filterShowOnlyOpenSubtasks: false,
	dynamicFileTaskFilterEnabled: true,
	dynamicFileTaskFilterPlacement: 'body-top',
	dynamicFileTaskFilterSubtaskAutoExpandLimit: 10,
	dynamicFileTaskFilterShowOnlyOpenSubtasks: false,
	dynamicSubtasksFilterSubtaskAutoExpandLimit: 10,
	dynamicSubtasksFilterShowOnlyOpenSubtasks: false,

	language: 'auto',
	timeFormat: '24h',
	demoWorkspacePromptDismissed: false,
	releaseNotesShowOnUpdate: true,
	releaseNotesLastShownVersion: '',
	operonDocsAutoUpdateEnabled: false,
	colorPalette: cloneDefaultColorPalette(),

	taskCreateDebounceMs: 750,
	taskDescriptionRequired: true,
	assigneesRequired: false,
	fileTasksFolder: 'Operon/Tasks',
	fileTaskAutoArchiveEnabled: false,
	fileTaskArchiveFolder: 'Operon/Archives',
	fileTaskArchiveDelaySeconds: 30,
	fileTaskArchiveOnlyFromFileTasksFolder: true,
	fileTaskParentInlineTargetMode: 'same-folder',
	fileTaskParentFileTargetMode: 'same-folder',
	inlineToFileTaskMovePlainCheckboxes: true,
	inlineTaskSaveMode: 'daily-notes',
	inlineTaskUseDailyNote: true,
	inlineTaskTargetFile: DEFAULT_INLINE_TASK_TARGET_FILE,
	inlineTaskHeading: '',
	inlineTaskParentInlineTargetMode: 'below-parent',
	inlineTaskParentFileTargetMode: 'inside-parent-file',
	inlineTaskParentFileHeadingKeyword: DEFAULT_INLINE_TASK_PARENT_FILE_HEADING_KEYWORD,
	inlineTaskDailyNoteAddStartDate: false,
	inlineTaskDailyNoteAddScheduledDate: false,
	autoParentFileTask: true,
	autoParentLinkedFileSubtasks: true,
	childTaskInheritanceFields: [...DEFAULT_CHILD_TASK_INHERITANCE_FIELDS],
	childTaskInheritanceStatusPipelineSource: 'parent',
	projectSerialScopes: [],
	estimateAutoReallocation: false,
	taskCreatorToolbar: buildDefaultTaskCreatorToolbarItems(),
	taskEditorShowLineNumbers: false,
	taskEditorAutosaveDelaySeconds: 60,
	taskEditorWorkflowPickers: buildDefaultTaskEditorWorkflowPickerItems(),
	taskEditorMobileCoreTools: buildDefaultTaskEditorMobileCoreToolItems(),
	inlineTaskCompactChips: buildDefaultInlineTaskCompactChipItems(),
	filterTaskCompactChips: buildDefaultFilterTaskCompactChipItems(),
	taskFinderCompactChips: buildDefaultTaskFinderCompactChipItems(),
	taskFinderDefaultScope: buildDefaultTaskFinderDefaultScopeItems(),
	taskFinderRememberLastScopes: true,
	taskFinderSelectedProjectId: '',
	taskFinderShortcuts: buildDefaultTaskFinderShortcutItems(),
	taskFinderShowRecentModifiedOnOpen: true,
	taskFinderRecentModifiedDays: 3,
	taskFinderVisibleResultCount: 5,
	overlayTaskCompactChips: buildDefaultOverlayTaskCompactChipItems(),
	overlayTaskShowPlayAction: false,
	overlayTaskShowPinAction: false,
	overlayTaskShowNoteAction: true,
	overlayTaskShowSubtaskAction: false,
	overlayTaskShowPlainCheckboxAction: true,
	inlineTaskShowPlayAction: true,
	inlineTaskShowPinAction: false,
	inlineTaskShowSubtaskAction: true,
	inlineTaskShowTasksEmojiConvertIcon: true,
	inlineTaskShowPlainCheckboxConvertIcon: true,
	filterTaskShowPlayAction: true,
	filterTaskShowPinAction: false,
	filterTaskShowSubtaskAction: true,
	filterTaskShowPlainCheckboxAction: true,

	workspaceTweaksHideScrollbars: false,
	workspaceTweaksCollapseProperties: false,
	workspaceTweaksPropertiesScope: 'operon-file-tasks',
	workspaceTweaksPropertiesExcludedFolders: [],
	workspaceTweaksCompactSidebarTabIcons: false,

	locationMapsAlwaysLightMode: true,
	locationPlaceIconPropertyName: '',
	locationPlaceColorPropertyName: '',
	locationPickerMapDefaultCenter: '',
	locationPickerMapDefaultZoom: 7,
	locationPreviewWidth: 600,
	locationPreviewHeight: 400,
	locationPreviewDefaultZoom: 15,
	locationPreviewMinZoom: 12,
	locationPreviewMaxZoom: 18,

	dockHoverOpenDelayMs: 200,
	floatingAutoCloseSec: 60,

	inlineRowWidth: 560,
	inlineRowDefaultMode: 'compact',
	inlineExpandedMetadataDensity: 'medium',
	inlineBackgroundIntensity: 0.18,

	pinnedTasksDesktopSurface: 'floating',
	pinnedTasksSidebarSide: 'left',
	pinnedTaskItemWidth: 240,
	pinnedDockPosition: 'bottom-center',
	pinnedDockX: null,
	pinnedDockY: null,
	pinnedDockVisible: false,
	pinnedDockCollapsed: false,
	pinnedDockLayout: 'vertical',
	pinnedDockGridCols: 2,
	pinnedDockDisableOnMobile: true,
	mobileGlobalTaskFabEnabled: true,
	mobileGlobalTaskFabHideInCalendar: false,
	mobileGlobalTaskFabHideInKanban: false,
	mobileGlobalTaskFabPosition: null,
	pinnedDockAutoCloseEnabled: true,
	pinnedDockAutoPin: true,
	pinnedDockAutoUnpinFinished: true,
	pinnedDockColorSource: 'noColor',

	leftRailDefaultView: 'filters',
	leftRailDefaultFilterViewId: null,
	leftRailMaxTabs: 5,
	rightRailMaxTabs: 5,
	leftRailViewOrder: [],
	rightRailViewOrder: [],

	calendarPresets: cloneDefaultCalendarPresets(),
	calendarDefaultPresetId: DEFAULT_CALENDAR_DEFAULT_PRESET_ID,
	calendarWeekStart: 'monday',
	externalCalendars: [],
	contextualMenuActionAllowlist: [...DEFAULT_CONTEXTUAL_MENU_ACTION_ALLOWLIST],
	contextualMenuSurfaceActionMatrix: buildDefaultContextualMenuSurfaceActionMatrix(),
	contextualMenuOpenDelayMs: 100,
	contextualMenuMobileEnabled: true,
	contextualMenuMobileLongPressMs: 320,
	contextualMenuMobileTransitionGraceMs: 450,
	contextualMenuMobileAutoHideMs: 7000,
	calendarInlineTaskHeading: '',
	calendarShowAllDayLane: true,
	calendarShowDueMarkers: true,
	calendarDefaultScrollHour: 8,
	calendarInitialScrollMode: 'autoNow',
	calendarDayTitleAction: 'create-open-daily-note',
	calendarAutoScrollPastRatio: 0.2,
	calendarTimeGridScale: 2,
	calendarSidebarWidthPx: 320,
	calendarSidebarCalendarsDefaultExpanded: true,
	calendarSidebarShowWeekNumbers: true,
	calendarShowWeekLabelOnFirstDay: true,
	calendarSidebarTaskPoolDefaultExpanded: true,
	calendarSidebarTaskPoolFollowPresetFilter: true,
	calendarSidebarFinishedTasksDefaultExpanded: false,
	calendarTouchTimeGridTaskMoveEnabled: true,
	calendarTouchDragLongPressMs: 260,
	calendarTouchDragCancelDistancePx: 10,
	calendarMobileEnabled: true,
	calendarMobileMaxWidthPx: 720,
	calendarMobileDefaultView: 'agenda',
	calendarMobileDefaultSourcePresetId: DEFAULT_CALENDAR_DEFAULT_PRESET_ID,
	calendarMobileAgendaEnabled: true,
	calendarMobileDayEnabled: true,
	calendarMobileTwoDayEnabled: true,
	calendarMobileThreeDayEnabled: true,
	calendarMobileAgendaSourcePresetId: DEFAULT_CALENDAR_DEFAULT_PRESET_ID,
	calendarMobileDaySourcePresetId: DEFAULT_CALENDAR_DEFAULT_PRESET_ID,
	calendarMobileTwoDaySourcePresetId: DEFAULT_CALENDAR_DEFAULT_PRESET_ID,
	calendarMobileThreeDaySourcePresetId: DEFAULT_CALENDAR_DEFAULT_PRESET_ID,
	calendarMobileSlotMinutes: 30,
	calendarMobileShowProjectedOccurrences: true,
	calendarMobileShowExternalCalendars: true,
	calendarMobileColorSource: 'taskColor',
	calendarMobileShowDueMarkers: true,
	calendarMobileShowAllDayItems: true,
	calendarMobileAgendaPastDays: 3,
	calendarMobileAgendaFutureDays: 14,
	calendarMobileAgendaShowCompletedItems: false,
	calendarMobileAllDayVisibleTaskLimit: 'all',
	calendarMobileShowCompletedItems: false,

	kanbanPresets: cloneDefaultKanbanPresets(),
	kanbanDefaultPresetId: DEFAULT_KANBAN_DEFAULT_PRESET_ID,
	kanbanExpandedColumnWidthPx: 320,
	kanbanMaxVisibleTasksPerCell: 7,
	kanbanMobileLayoutChromeEnabled: true,
	kanbanMobileLayoutMaxWidthPx: 900,
	kanbanMobileCompactSwimlaneWidthPx: 6,
	kanbanMobileSwimlaneRailAlwaysVisible: true,
	kanbanMobileHorizontalStatusSnapEnabled: true,

	indexEventDebounceMs: 250,
	fullReindexOnStartup: false,
	duplicateAlertAutoOpenManager: false,
	duplicateAlertDelaySeconds: 10,
	taskStatsBackfillVersion: 0,

	taskCreatorDefaultToFileTask: false,
	taskCreatorDefaultFileTemplateId: null,
	fileTaskTemplateFolder: '',
	excludedFolders: [],
	createDailyNotesAsOperonTask: false,
	lastUsedFileTaskTemplateId: null,

		defaultEstimateMinutes: 30,
		trackerHistoryDays: 7,
				trackerShowStatusBarTimer: true,
		trackerSplitSessionsAtMidnight: false,
				trackerTaskDescriptionClickAction: 'openTaskEditor',
				flowTimeMode: 'tracktime',
				flowTimeSessionMinutes: 25,
				flowTimePauseMinutes: 5,
					flowTimeUseLastSelectedDuration: false,
					flowTimeDefaultSessionMinutes: 25,
					flowTimeShowNumericTimer: true,
					flowTimeNotifyOnTargetReached: true,

	newOccurrencePosition: 'above',
	fileRepeatDestination: 'same-folder',
	fileRepeatCustomFolder: '',

	autoCompleteParentWhenAllChildrenTerminal: false,
	cascadeCancelToDescendants: true,

	inlineExpandedTaskChips: { ...DEFAULT_INLINE_EXPANDED_TASK_CHIPS },
	taskBarSubtasksDefaultExpanded: true,
	fallbackTaskIconSource: 'pipelineStatusIcon',
	fallbackStateIcons: {
		open: 'obsidian',
		done: 'circle-check-big',
		cancelled: 'square-x',
	},

};

/** Settings field constraints for validation */
export interface NumericConstraint {
	min: number;
	max?: number;
}

export const NUMERIC_CONSTRAINTS = {
	taskCreateDebounceMs: { min: 150, max: 3000 },
	dockHoverOpenDelayMs: { min: 0, max: 2000 },
	floatingAutoCloseSec: { min: 5, max: 600 },
	taskEditorAutosaveDelaySeconds: { min: 10, max: 60 },
	locationPickerMapDefaultZoom: { min: 1, max: 18 },
	locationPreviewWidth: { min: 240, max: 900 },
	locationPreviewHeight: { min: 180, max: 700 },
	locationPreviewDefaultZoom: { min: 1, max: 22 },
	locationPreviewMinZoom: { min: 0, max: 24 },
	locationPreviewMaxZoom: { min: 1, max: 24 },
	inlineRowWidth: { min: 320, max: 1400 },
	inlineBackgroundIntensity: { min: 0.05, max: 0.60 },
	pinnedTaskItemWidth: { min: 120, max: 800 },
	leftRailMaxTabs: { min: 1, max: 20 },
	rightRailMaxTabs: { min: 1, max: 20 },
	calendarDefaultScrollHour: { min: 0, max: 23 },
	calendarTouchDragLongPressMs: { min: 150, max: 600 },
	calendarTouchDragCancelDistancePx: { min: 4, max: 24 },
	contextualMenuMobileLongPressMs: { min: 200, max: 600 },
	contextualMenuMobileTransitionGraceMs: { min: 150, max: 1200 },
	contextualMenuMobileAutoHideMs: { min: 1000, max: 30000 },
	calendarMobileMaxWidthPx: { min: CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MIN, max: CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MAX },
	kanbanExpandedColumnWidthPx: { min: KANBAN_EXPANDED_COLUMN_WIDTH_MIN, max: KANBAN_EXPANDED_COLUMN_WIDTH_MAX },
	kanbanMaxVisibleTasksPerCell: { min: KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN, max: KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX },
	kanbanMobileLayoutMaxWidthPx: { min: KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MIN, max: KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MAX },
	kanbanMobileCompactSwimlaneWidthPx: { min: KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MIN, max: KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MAX },
	taskFinderRecentModifiedDays: { min: 1, max: 7 },
	taskFinderVisibleResultCount: { min: 3, max: 9 },
	fileTaskArchiveDelaySeconds: { min: 0, max: 3600 },
		indexEventDebounceMs: { min: 0, max: 2000 },
		defaultEstimateMinutes: { min: 5, max: 480 },
				trackerHistoryDays: { min: 1, max: 365 },
						flowTimeSessionMinutes: { min: 1 },
						flowTimePauseMinutes: { min: 5, max: 15 },
						flowTimeDefaultSessionMinutes: { min: 15, max: 90 },
					} satisfies Partial<Record<keyof OperonSettings, NumericConstraint>>;

export type NumericSettingKey = keyof typeof NUMERIC_CONSTRAINTS;

type NumericSettings = {
	[K in NumericSettingKey]: number;
};

export function isNumericSettingKey(key: string): key is NumericSettingKey {
	return key in NUMERIC_CONSTRAINTS;
}

export function getNumericConstraint(key: string): NumericConstraint | undefined {
	return isNumericSettingKey(key) ? NUMERIC_CONSTRAINTS[key] : undefined;
}

export function setNumericSetting(settings: OperonSettings, key: NumericSettingKey, value: number): void {
	(settings as OperonSettings & NumericSettings)[key] = value;
}

const FILTER_FIELD_TYPES = new Set<FilterFieldType>([
	'text',
	'number',
	'date',
	'datetime',
	'list',
	'checkbox',
	'tags',
	'pinned',
	'projectTree',
	'folders',
]);

function normalizeOptionalString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function normalizeFolderPath(value: unknown): string | null {
	const normalized = typeof value === 'string' ? normalizeSettingsFolderPath(value) : '';
	return normalized || null;
}

function normalizeFolderPathList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const folders: string[] = [];
	for (const item of value) {
		const normalized = normalizeFolderPath(item);
		if (!normalized) continue;
		const duplicateKey = normalized.toLowerCase();
		if (seen.has(duplicateKey)) continue;
		seen.add(duplicateKey);
		folders.push(normalized);
	}
	return folders;
}

function normalizeExternalCalendarColor(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : '#8ecae6';
}

function normalizeExternalCalendarRefreshIntervalHours(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(720, Math.round(value)));
}

function normalizeExternalCalendarSource(raw: unknown): ExternalCalendarSource | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	return {
		id: normalizeOptionalString(src.id) ?? createExternalCalendarSourceId(),
		type: 'ics',
		name: normalizeOptionalString(src.name) ?? '',
		url: normalizeOptionalString(src.url) ?? '',
		color: normalizeExternalCalendarColor(src.color),
		enabled: src.enabled !== false,
		hideCreatedEvents: src.hideCreatedEvents === true,
		refreshIntervalHours: normalizeExternalCalendarRefreshIntervalHours(src.refreshIntervalHours),
	};
}

function normalizeExternalCalendars(raw: unknown): ExternalCalendarSource[] {
	if (!Array.isArray(raw)) return [];
	const seenIds = new Set<string>();
	const next: ExternalCalendarSource[] = [];
	for (const entry of raw) {
		const normalized = normalizeExternalCalendarSource(entry);
		if (!normalized) continue;
		let id = normalized.id;
		if (!id || seenIds.has(id)) {
			id = createExternalCalendarSourceId();
		}
		seenIds.add(id);
		next.push({
			...normalized,
			id,
		});
	}
	return next;
}

function preserveDisabledExternalCalendarVisibility(
	presets: CalendarPreset[],
	sources: ExternalCalendarSource[],
): CalendarPreset[] {
	const disabledSourceIds = new Set(
		sources
			.filter(source => source.enabled === false)
			.map(source => source.id),
	);
	if (disabledSourceIds.size === 0) return presets;
	return presets.map(preset => {
		const externalCalendarVisibility = { ...preset.externalCalendarVisibility };
		for (const sourceId of disabledSourceIds) {
			if (externalCalendarVisibility[sourceId] === true) {
				externalCalendarVisibility[sourceId] = false;
			}
		}
		return {
			...preset,
			externalCalendarVisibility,
		};
	});
}

function normalizeFileTaskTemplateDefinition(raw: unknown): FileTaskTemplateDefinition | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const id = normalizeOptionalString(src.id);
	const name = normalizeOptionalString(src.name);
	const path = normalizeOptionalString(src.path);
	if (!id || !name || !path) return null;
	return { id, name, path };
}

function normalizeCalendarPresetDefinition(raw: unknown): CalendarPreset | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const name = normalizeOptionalString(src.name);
	if (!name) return null;
	const surfaceType = normalizeCalendarSurfaceType(src.surfaceType);
	const weekCountRaw = typeof src.weekCount === 'number' && Number.isFinite(src.weekCount) ? src.weekCount : 2;
	const weekCount = Math.max(1, Math.min(6, Math.round(weekCountRaw))) as 1 | 2 | 3 | 4 | 5 | 6;
	const focusedWeekNumberRaw = typeof src.focusedWeekNumber === 'number' && Number.isFinite(src.focusedWeekNumber)
		? src.focusedWeekNumber
		: 1;
	const focusedWeekNumber = Math.max(1, Math.min(weekCount, Math.round(focusedWeekNumberRaw))) as 1 | 2 | 3 | 4 | 5 | 6;

	const dayCountRaw = typeof src.dayCount === 'number' && Number.isFinite(src.dayCount) ? src.dayCount : 7;
	const todayPositionRaw = typeof src.todayPosition === 'number' && Number.isFinite(src.todayPosition) ? src.todayPosition : 1;
	const slotMinutesRaw = typeof src.slotMinutes === 'number' && Number.isFinite(src.slotMinutes) ? src.slotMinutes : 15;
	const hiddenTimeStart = normalizeCalendarHiddenTime(src.hiddenTimeStart, '00:00');
	const fallbackStartHour = typeof src.dayStartHour === 'number' && Number.isFinite(src.dayStartHour)
		? Math.max(0, Math.min(23, Math.round(src.dayStartHour)))
		: 6;
	const hiddenTimeEnd = normalizeCalendarHiddenTime(src.hiddenTimeEnd, `0${fallbackStartHour}:00`.slice(-5));
	const colorSource = normalizeTaskColorSource(
		src.colorSource,
		CALENDAR_TASK_COLOR_SOURCES,
		'taskColor',
	);
	const navigationMode = src.navigationMode === 'sidebar' || src.navigationMode === 'toolbar'
		? src.navigationMode
		: 'toolbar';
	const calendarAppearanceModes: string[] = ['theme', 'anupuccin-light', 'anupuccin-dark', 'catppuccin-dark', 'atom-light', 'atom-dark', 'flexoki-light', 'flexoki-dark'];
	const normalizeCalendarAppearance = (value: unknown): CalendarAppearanceMode =>
		typeof value === 'string' && calendarAppearanceModes.includes(value) ? value as CalendarAppearanceMode : 'theme';
	const appearanceModeLight = normalizeCalendarAppearance(src.appearanceModeLight);
	const appearanceModeDark = normalizeCalendarAppearance(src.appearanceModeDark);
	return {
		id: normalizeOptionalString(src.id) ?? createCalendarPresetId(),
		name,
		surfaceType,
		weekCount,
		focusedWeekNumber,
		dayCount: Math.max(1, Math.min(31, Math.round(dayCountRaw))),
		todayPosition: Math.max(1, Math.min(Math.max(1, Math.round(dayCountRaw)), Math.round(todayPositionRaw))),
		slotMinutes: Math.max(5, Math.min(180, Math.round(slotMinutesRaw / 5) * 5)),
		filterSetId: normalizeOptionalString(src.filterSetId) ?? null,
		navigationMode,
		showAllDayLane: src.showAllDayLane !== false,
		showDueMarkers: src.showDueMarkers !== false,
		showWeekends: src.showWeekends !== false,
		showProjectedOccurrences: src.showProjectedOccurrences !== false,
		showExternalCalendars: src.showExternalCalendars !== false,
		hiddenTimeStart,
		hiddenTimeEnd,
		colorSource,
		appearanceModeLight,
		appearanceModeDark,
		externalCalendarVisibility: (src.externalCalendarVisibility && typeof src.externalCalendarVisibility === 'object' && !Array.isArray(src.externalCalendarVisibility))
			? Object.fromEntries(
				Object.entries(src.externalCalendarVisibility as Record<string, unknown>)
					.filter(([, v]) => typeof v === 'boolean')
					.map(([k, v]) => [k, v as boolean])
			)
			: {},
	};
}

function normalizeCalendarSurfaceType(value: unknown): CalendarSurfaceType {
	if (value === 'multiWeek' || value === 'timeTrackerGrid') return value;
	return 'timeGrid';
}

function normalizeKanbanPresetDefinition(raw: unknown): KanbanPreset | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const name = normalizeOptionalString(src.name);
	if (!name) return null;

	const colorSource = normalizeTaskColorSource(
		src.colorSource,
		KANBAN_TASK_COLOR_SOURCES,
		'taskColor',
	);
	const kanbanAppearanceModes: string[] = ['theme', 'anupuccin-light', 'anupuccin-dark', 'catppuccin-dark', 'atom-light', 'atom-dark', 'flexoki-light', 'flexoki-dark'];
	const normalizeKanbanAppearance = (value: unknown): KanbanAppearanceMode =>
		typeof value === 'string' && kanbanAppearanceModes.includes(value) ? value as KanbanAppearanceMode : 'theme';
	const appearanceModeLight = normalizeKanbanAppearance(src.appearanceModeLight);
	const appearanceModeDark = normalizeKanbanAppearance(src.appearanceModeDark);
	const swimlaneBy = typeof src.swimlaneBy === 'string'
		? isBuiltInKanbanSwimlaneBy(src.swimlaneBy)
			? src.swimlaneBy
			: normalizeKanbanCustomFieldReference(src.swimlaneBy)
		: null;
	const collapseEmptyColumns = typeof src.collapseEmptyColumns === 'boolean'
		? src.collapseEmptyColumns
		: typeof src.showEmptyColumns === 'boolean'
			? !src.showEmptyColumns
			: true;
	const collapseEmptySwimlanes = typeof src.collapseEmptySwimlanes === 'boolean'
		? src.collapseEmptySwimlanes
		: typeof src.showEmptySwimlanes === 'boolean'
			? !src.showEmptySwimlanes
			: true;
	const autoCollapseFinishedColumns = typeof src.autoCollapseFinishedColumns === 'boolean'
		? src.autoCollapseFinishedColumns
		: typeof src.autoHideFinishedTasks === 'boolean'
			? src.autoHideFinishedTasks
			: false;
	const sortMode = normalizeKanbanSortMode(src.sortMode);
	const sortRules = normalizeKanbanSortRules(src.sortRules);

	return {
		id: normalizeOptionalString(src.id) ?? createKanbanPresetId(),
		name,
		pipelineId: normalizeOptionalString(src.pipelineId) ?? null,
		filterSetId: normalizeOptionalString(src.filterSetId) ?? null,
		swimlaneBy,
		colorSource,
		appearanceModeLight,
		appearanceModeDark,
		collapseEmptyColumns,
		collapseEmptySwimlanes,
		autoCollapseFinishedColumns,
		sortMode,
		sortRules,
	};
}

function normalizeKanbanSortMode(raw: unknown): KanbanSortMode {
	return raw === 'manual' ? 'manual' : 'automatic';
}

function normalizeKanbanSortRules(raw: unknown): KanbanSortRule[] {
	if (!Array.isArray(raw)) return createDefaultKanbanSortRules();
	const normalized = raw
		.map(entry => normalizeKanbanSortRule(entry))
		.filter((entry): entry is KanbanSortRule => !!entry);
	return normalized.length > 0 ? normalized : createDefaultKanbanSortRules();
}

function normalizeKanbanSortRule(raw: unknown): KanbanSortRule | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const field = normalizeKanbanSortField(src.field);
	if (!field) return null;
	const direction = src.direction === 'desc' ? 'desc' : 'asc';
	const empty = src.empty === 'first' ? 'first' : 'last';
	return {
		field,
		direction,
		empty,
	};
}

function normalizeKanbanSortField(raw: unknown): KanbanSortField | null {
	if (raw === 'dateCreated') {
		return 'datetimeCreated';
	}
	if (typeof raw !== 'string') return null;
	if (isBuiltInKanbanSortField(raw)) return raw;
	return normalizeKanbanCustomFieldReference(raw);
}

function normalizeCalendarTimeGridScale(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarTimeGridScale;
	}
	const rounded = Math.round(raw * 100) / 100;
	return CALENDAR_TIME_GRID_SCALE_OPTIONS.includes(rounded as typeof CALENDAR_TIME_GRID_SCALE_OPTIONS[number])
		? rounded
		: DEFAULT_SETTINGS.calendarTimeGridScale;
}

function normalizeCalendarSidebarWidthPx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarSidebarWidthPx;
	}
	return Math.max(
		CALENDAR_SIDEBAR_WIDTH_MIN,
		Math.min(CALENDAR_SIDEBAR_WIDTH_MAX, Math.round(raw)),
	);
}

function normalizeCalendarTouchDragLongPressMs(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarTouchDragLongPressMs;
	}
	return Math.max(150, Math.min(600, Math.round(raw)));
}

function normalizeCalendarTouchDragCancelDistancePx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarTouchDragCancelDistancePx;
	}
	return Math.max(4, Math.min(24, Math.round(raw)));
}

function normalizeMobileGlobalTaskFabPosition(raw: unknown): MobileGlobalTaskFabPosition | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	const xRatio = record.xRatio;
	const yRatio = record.yRatio;
	if (typeof xRatio !== 'number' || !Number.isFinite(xRatio)) return null;
	if (typeof yRatio !== 'number' || !Number.isFinite(yRatio)) return null;
	return {
		xRatio: Math.max(0, Math.min(1, xRatio)),
		yRatio: Math.max(0, Math.min(1, yRatio)),
	};
}

function normalizeCalendarMobileMaxWidthPx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarMobileMaxWidthPx;
	}
	return Math.max(
		CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MIN,
		Math.min(CALENDAR_MOBILE_LAYOUT_MAX_WIDTH_MAX, Math.round(raw)),
	);
}

function normalizeCalendarMobileSlotMinutes(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarMobileSlotMinutes;
	}
	const rounded = Math.round(raw);
	return CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS.includes(rounded as typeof CALENDAR_MOBILE_SLOT_MINUTES_OPTIONS[number])
		? rounded
		: DEFAULT_SETTINGS.calendarMobileSlotMinutes;
}

function normalizeCalendarMobileAgendaPastDays(raw: unknown): CalendarMobileAgendaPastDays {
	const parsed = typeof raw === 'string'
		? Number.parseInt(raw, 10)
		: raw;
	return CALENDAR_MOBILE_AGENDA_PAST_DAYS_OPTIONS.includes(parsed as CalendarMobileAgendaPastDays)
		? parsed as CalendarMobileAgendaPastDays
		: DEFAULT_SETTINGS.calendarMobileAgendaPastDays;
}

function normalizeCalendarMobileAgendaFutureDays(raw: unknown): CalendarMobileAgendaFutureDays {
	const parsed = typeof raw === 'string'
		? Number.parseInt(raw, 10)
		: raw;
	return CALENDAR_MOBILE_AGENDA_FUTURE_DAYS_OPTIONS.includes(parsed as CalendarMobileAgendaFutureDays)
		? parsed as CalendarMobileAgendaFutureDays
		: DEFAULT_SETTINGS.calendarMobileAgendaFutureDays;
}

function normalizeCalendarMobileAllDayVisibleTaskLimit(raw: unknown): CalendarMobileAllDayVisibleTaskLimit {
	if (raw === 'all') return 'all';
	const parsed = typeof raw === 'string'
		? Number.parseInt(raw, 10)
		: raw;
	return CALENDAR_MOBILE_ALL_DAY_VISIBLE_TASK_LIMIT_OPTIONS.includes(parsed as CalendarMobileAllDayVisibleTaskLimit)
		? parsed as CalendarMobileAllDayVisibleTaskLimit
		: DEFAULT_SETTINGS.calendarMobileAllDayVisibleTaskLimit;
}

function normalizeContextualMenuOpenDelayMs(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.contextualMenuOpenDelayMs;
	}
	return Math.max(0, Math.min(2000, Math.round(raw)));
}

function normalizeContextualMenuMobileEnabled(raw: unknown): boolean {
	if (typeof raw !== 'boolean') {
		return DEFAULT_SETTINGS.contextualMenuMobileEnabled;
	}
	return raw;
}

function normalizeContextualMenuMobileLongPressMs(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.contextualMenuMobileLongPressMs;
	}
	return Math.max(200, Math.min(600, Math.round(raw)));
}

function normalizeContextualMenuMobileTransitionGraceMs(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.contextualMenuMobileTransitionGraceMs;
	}
	return Math.max(150, Math.min(1200, Math.round(raw)));
}

function normalizeContextualMenuMobileAutoHideMs(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.contextualMenuMobileAutoHideMs;
	}
	return Math.max(1000, Math.min(30000, Math.round(raw)));
}

function normalizeKanbanExpandedColumnWidthPx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.kanbanExpandedColumnWidthPx;
	}
	return Math.max(
		KANBAN_EXPANDED_COLUMN_WIDTH_MIN,
		Math.min(KANBAN_EXPANDED_COLUMN_WIDTH_MAX, Math.round(raw)),
	);
}

function normalizeKanbanMaxVisibleTasksPerCell(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.kanbanMaxVisibleTasksPerCell;
	}
	return Math.max(
		KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MIN,
		Math.min(KANBAN_MAX_VISIBLE_TASKS_PER_CELL_MAX, Math.round(raw)),
	);
}

function normalizeKanbanMobileLayoutMaxWidthPx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.kanbanMobileLayoutMaxWidthPx;
	}
	return Math.max(
		KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MIN,
		Math.min(KANBAN_MOBILE_LAYOUT_MAX_WIDTH_MAX, Math.round(raw)),
	);
}

function normalizeKanbanMobileCompactSwimlaneWidthPx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.kanbanMobileCompactSwimlaneWidthPx;
	}
	return Math.max(
		KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MIN,
		Math.min(KANBAN_MOBILE_COMPACT_SWIMLANE_WIDTH_MAX, Math.round(raw)),
	);
}

function migrateCalendarSidebarWidthScaleToPx(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarSidebarWidthPx;
	}
	const rounded = Math.round(raw * 100) / 100;
	if (rounded === 0.75) return 280;
	if (rounded === 1) return 320;
	if (rounded === 1.25) return 360;
	if (rounded === 1.5) return 400;
	if (rounded === 2) return 480;
	return DEFAULT_SETTINGS.calendarSidebarWidthPx;
}

function normalizeCalendarInitialScrollMode(raw: unknown): 'fixedHour' | 'autoNow' {
	return raw === 'fixedHour' || raw === 'autoNow'
		? raw
		: DEFAULT_SETTINGS.calendarInitialScrollMode;
}

function normalizeCalendarDayTitleAction(raw: unknown): CalendarDayTitleAction {
	return raw === 'nothing' || raw === 'create-open-daily-note'
		? raw
		: DEFAULT_SETTINGS.calendarDayTitleAction;
}

function normalizeCalendarAutoScrollPastRatio(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.calendarAutoScrollPastRatio;
	}
	const rounded = Math.round(raw * 100) / 100;
	return CALENDAR_AUTO_SCROLL_POSITION_OPTIONS.includes(rounded as typeof CALENDAR_AUTO_SCROLL_POSITION_OPTIONS[number])
		? rounded
		: DEFAULT_SETTINGS.calendarAutoScrollPastRatio;
}

function normalizeCalendarHiddenTime(raw: unknown, fallback: string): string {
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (/^\d{2}:\d{2}$/.test(trimmed)) {
			const [hour, minute] = trimmed.split(':').map(part => Number.parseInt(part, 10));
			if (
				Number.isFinite(hour)
				&& Number.isFinite(minute)
				&& hour >= 0
				&& hour <= 23
				&& minute >= 0
				&& minute <= 59
			) {
				const roundedMinute = Math.round(minute / 15) * 15;
				const normalizedMinute = roundedMinute >= 60 ? 45 : roundedMinute;
				return `${String(hour).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
			}
		}
	}
	return fallback;
}

function normalizeCalendarPresets(raw: unknown): CalendarPreset[] {
	const fallback = cloneDefaultCalendarPresets();
	const source = Array.isArray(raw)
		? raw
			.map(preset => normalizeCalendarPresetDefinition(preset))
			.filter((preset): preset is CalendarPreset => !!preset)
		: [];
	const presets = source.length > 0 ? source : fallback;
	const seenIds = new Set<string>();
	const normalized = presets.map((preset, index) => {
		let id = preset.id;
		if (!id || seenIds.has(id)) {
			id = fallback[index]?.id ?? createCalendarPresetId();
		}
		seenIds.add(id);
		return normalizeBuiltInCalendarPreset({
			...preset,
			id,
		});
	});
	if (source.length === 0) return normalized;

	const defaultIds = new Set(normalized.map(preset => preset.id));
	const hasDefaultBuiltins = defaultIds.has('calendar-preset-1day')
		&& defaultIds.has('calendar-preset-7day')
		&& defaultIds.has('calendar-preset-10day');
	if (!hasDefaultBuiltins || normalized.length > 3) return normalized;

	for (const builtin of fallback) {
		if (defaultIds.has(builtin.id)) continue;
		normalized.push({ ...builtin });
		defaultIds.add(builtin.id);
	}
	return normalized;
}

function normalizeKanbanPresets(raw: unknown): KanbanPreset[] {
	const fallback = cloneDefaultKanbanPresets();
	const source = Array.isArray(raw)
		? raw
			.map(preset => normalizeKanbanPresetDefinition(preset))
			.filter((preset): preset is KanbanPreset => !!preset)
		: [];
	const presets = source.length > 0 ? source : fallback;
	const seenIds = new Set<string>();
	return presets.map((preset, index) => {
		let id = preset.id;
		if (!id || seenIds.has(id)) {
			id = fallback[index]?.id ?? createKanbanPresetId();
		}
		seenIds.add(id);
		return normalizeBuiltInKanbanPreset({
			...preset,
			id,
		});
	});
}

function normalizeContextualMenuActionAllowlist(raw: unknown): ContextualMenuActionId[] {
	if (!Array.isArray(raw)) return [...DEFAULT_CONTEXTUAL_MENU_ACTION_ALLOWLIST];
	return raw.filter((value): value is ContextualMenuActionId =>
		typeof value === 'string' && CONTEXTUAL_MENU_ACTION_ID_SET.has(value as ContextualMenuActionId));
}

function insertContextualMenuActionAfter(
	actionIds: ContextualMenuActionId[],
	actionId: ContextualMenuActionId,
	afterActionId: ContextualMenuActionId,
): ContextualMenuActionId[] {
	if (actionIds.includes(actionId)) return actionIds;
	const afterIndex = actionIds.indexOf(afterActionId);
	const insertAt = afterIndex >= 0 ? afterIndex + 1 : actionIds.length;
	return [
		...actionIds.slice(0, insertAt),
		actionId,
		...actionIds.slice(insertAt),
	];
}

function insertContextualMenuActionAfterAny(
	actionIds: ContextualMenuActionId[],
	actionId: ContextualMenuActionId,
	afterActionIds: ContextualMenuActionId[],
): ContextualMenuActionId[] {
	if (actionIds.includes(actionId)) return actionIds;
	const afterIndex = afterActionIds
		.map(candidate => actionIds.indexOf(candidate))
		.find(index => index >= 0);
	if (afterIndex === undefined) return actionIds;
	return [
		...actionIds.slice(0, afterIndex + 1),
		actionId,
		...actionIds.slice(afterIndex + 1),
	];
}

function insertContextualMenuActionAfterOrBefore(
	actionIds: ContextualMenuActionId[],
	actionId: ContextualMenuActionId,
	afterActionId: ContextualMenuActionId,
	beforeActionId: ContextualMenuActionId,
): ContextualMenuActionId[] {
	if (actionIds.includes(actionId)) return actionIds;
	const afterIndex = actionIds.indexOf(afterActionId);
	if (afterIndex >= 0) {
		return [
			...actionIds.slice(0, afterIndex + 1),
			actionId,
			...actionIds.slice(afterIndex + 1),
		];
	}
	const beforeIndex = actionIds.indexOf(beforeActionId);
	if (beforeIndex >= 0) {
		return [
			...actionIds.slice(0, beforeIndex),
			actionId,
			...actionIds.slice(beforeIndex),
		];
	}
	return [...actionIds, actionId];
}

function backfillContextualMenuSurfaceAction(
	matrix: ContextualMenuSurfaceActionMatrix,
	actionId: ContextualMenuActionId,
	afterActionId: ContextualMenuActionId,
): ContextualMenuSurfaceActionMatrix {
	const next: ContextualMenuSurfaceActionMatrix = { ...matrix };
	for (const surface of CONTEXTUAL_MENU_SURFACES) {
		if (surface === 'calendarProjectedOccurrence' || surface === 'calendarExternalItem') continue;
		const actionIds = next[surface];
		if (!Array.isArray(actionIds) || !actionIds.includes(afterActionId)) continue;
		next[surface] = insertContextualMenuActionAfter(actionIds, actionId, afterActionId);
	}
	return next;
}

function backfillContextualMenuSurfaceActionAfterAny(
	matrix: ContextualMenuSurfaceActionMatrix,
	actionId: ContextualMenuActionId,
	afterActionIds: ContextualMenuActionId[],
): ContextualMenuSurfaceActionMatrix {
	const next: ContextualMenuSurfaceActionMatrix = { ...matrix };
	for (const surface of CONTEXTUAL_MENU_SURFACES) {
		if (surface === 'calendarProjectedOccurrence' || surface === 'calendarExternalItem') continue;
		const actionIds = next[surface];
		if (!Array.isArray(actionIds) || !afterActionIds.some(anchor => actionIds.includes(anchor))) continue;
		next[surface] = insertContextualMenuActionAfterAny(actionIds, actionId, afterActionIds);
	}
	return next;
}

function backfillContextualMenuSurfaceActionAfterOrBefore(
	matrix: ContextualMenuSurfaceActionMatrix,
	actionId: ContextualMenuActionId,
	afterActionId: ContextualMenuActionId,
	beforeActionId: ContextualMenuActionId,
): ContextualMenuSurfaceActionMatrix {
	const next: ContextualMenuSurfaceActionMatrix = { ...matrix };
	for (const surface of CONTEXTUAL_MENU_SURFACES) {
		if (surface === 'calendarProjectedOccurrence' || surface === 'calendarExternalItem') continue;
		const actionIds = next[surface];
		if (!Array.isArray(actionIds) || (!actionIds.includes(afterActionId) && !actionIds.includes(beforeActionId))) continue;
		next[surface] = insertContextualMenuActionAfterOrBefore(actionIds, actionId, afterActionId, beforeActionId);
	}
	return next;
}

export function buildDefaultContextualMenuSurfaceActionMatrix(): ContextualMenuSurfaceActionMatrix {
	return {
		readingRow: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		livePreviewTask: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		taskWikilinkOverlay: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		pinnedTask: [...DEFAULT_CONTEXTUAL_MENU_WITH_CANCEL_ACTIONS],
		trackerTask: [...DEFAULT_CONTEXTUAL_MENU_TRACKER_ACTIONS],
		flowTimeTask: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		filterTask: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		kanbanCard: [...DEFAULT_CONTEXTUAL_MENU_KANBAN_ACTIONS],
		calendarTimedItem: [...DEFAULT_CONTEXTUAL_MENU_WITH_CANCEL_ACTIONS],
		calendarAllDayScheduledItem: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		calendarDueMarker: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		calendarFinishedMarker: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		calendarSidebarTaskPoolTask: [...DEFAULT_CONTEXTUAL_MENU_WITH_CANCEL_ACTIONS],
		calendarProjectedOccurrence: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
		calendarExternalItem: [...DEFAULT_CONTEXTUAL_MENU_COMMON_SURFACE_ACTIONS],
	};
}

function normalizeContextualMenuSurfaceActionMatrix(raw: unknown): ContextualMenuSurfaceActionMatrix {
	const matrix = buildDefaultContextualMenuSurfaceActionMatrix();
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return matrix;
	const src = raw as Record<string, unknown>;
	for (const [surface, value] of Object.entries(src)) {
		if (!CONTEXTUAL_MENU_SURFACE_ID_SET.has(surface as ContextualMenuSurface) || !Array.isArray(value)) continue;
		matrix[surface as ContextualMenuSurface] = value.filter((actionId): actionId is ContextualMenuActionId =>
			typeof actionId === 'string' && CONTEXTUAL_MENU_ACTION_ID_SET.has(actionId as ContextualMenuActionId));
	}
	return matrix;
}

function cloneDefaultPipelines(): Pipeline[] {
	return DEFAULT_PIPELINES.map(pipeline => clonePipeline(pipeline));
}

function cloneDefaultPriorities(): PriorityDefinition[] {
	return DEFAULT_PRIORITIES.map(priority => clonePriorityDefinition(priority));
}

function createLegacyPriorityId(label: string, index: number): string {
	const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
	return normalized ? `pr_${normalized}` : `pr_legacy_${index}`;
}

function normalizePriorityDefinition(raw: unknown, index: number): PriorityDefinition | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const label = normalizeOptionalString(src.label);
	const color = normalizeOptionalString(src.color);
	const description = normalizeOptionalString(src.description);
	if (!label || !color) return null;
	const priorityIcon = normalizeTaskIconValue(
		typeof src.priorityIcon === 'string' ? src.priorityIcon : '',
	);

	const priority: PriorityDefinition = {
		id: normalizeOptionalString(src.id) ?? createLegacyPriorityId(label, index),
		label,
		color,
	};
	if (priorityIcon) {
		priority.priorityIcon = priorityIcon;
	}
	if (description) {
		priority.description = description;
	}
	return priority;
}

function normalizePriorityIds(priorities: PriorityDefinition[]): PriorityDefinition[] {
	const seenIds = new Set<string>();

	return priorities.map((priority, index) => {
		let priorityId = priority.id;
		if (!priorityId || seenIds.has(priorityId)) {
			const candidateId = createLegacyPriorityId(priority.label, index);
			priorityId = seenIds.has(candidateId) ? createPriorityId() : candidateId;
		}
		seenIds.add(priorityId);
		return {
			...priority,
			id: priorityId,
		};
	});
}

function normalizePipelineStatusDefinition(raw: unknown): StatusDefinition | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const label = normalizeOptionalString(src.label);
	const color = normalizeOptionalString(src.color);
	if (!label || !color) return null;
	const pipelineStatusIcon = normalizeTaskIconValue(
		typeof src.pipelineStatusIcon === 'string' ? src.pipelineStatusIcon : '',
	);

	const status: StatusDefinition = {
		id: normalizeOptionalString(src.id) ?? createStatusId(),
		label,
		color,
		isFinished: src.isFinished === true,
		isCancelled: src.isCancelled === true,
		isScheduledTarget: src.isScheduledTarget === true,
		isTrackingTarget: src.isTrackingTarget === true,
		propertyMapping: typeof src.propertyMapping === 'string' ? src.propertyMapping : null,
	};
	if (pipelineStatusIcon) {
		status.pipelineStatusIcon = pipelineStatusIcon;
	}
	return status;
}

function normalizePipelineStatuses(statuses: StatusDefinition[]): StatusDefinition[] {
	let hasFinished = false;
	let hasCancelled = false;
	let hasScheduledTarget = false;
	let hasTrackingTarget = false;

	return statuses.map(status => {
		const requestedFinished = status.isFinished === true;
		const requestedCancelled = requestedFinished ? false : status.isCancelled === true;
		const requestedTerminal = requestedFinished || requestedCancelled;

		const next: StatusDefinition = {
			...status,
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
		};

		if (requestedFinished && !hasFinished) {
			next.isFinished = true;
			hasFinished = true;
			return next;
		}

		if (requestedCancelled && !hasCancelled) {
			next.isCancelled = true;
			hasCancelled = true;
			return next;
		}

		if (!requestedTerminal && status.isScheduledTarget === true && !hasScheduledTarget) {
			next.isScheduledTarget = true;
			hasScheduledTarget = true;
		}

		if (!requestedTerminal && status.isTrackingTarget === true && !hasTrackingTarget) {
			next.isTrackingTarget = true;
			hasTrackingTarget = true;
		}

		return next;
	});
}

function normalizePipelineDefinition(raw: unknown): Pipeline | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const id = normalizeOptionalString(src.id) ?? createPipelineId();
	const name = normalizeOptionalString(src.name);
	const description = normalizeOptionalString(src.description);
	if (!name) return null;

	const statuses = Array.isArray(src.statuses)
		? src.statuses
			.map(status => normalizePipelineStatusDefinition(status))
			.filter((status): status is StatusDefinition => !!status)
		: [];
	if (statuses.length === 0) return null;

	const pipeline: Pipeline = { id, name, statuses: normalizePipelineStatuses(statuses) };
	if (description) {
		pipeline.description = description;
	}
	return pipeline;
}

function normalizePipelineIds(pipelines: Pipeline[]): Pipeline[] {
	const seenPipelineIds = new Set<string>();
	const seenStatusIds = new Set<string>();

	return pipelines.map(pipeline => {
		let pipelineId = pipeline.id;
		if (!pipelineId || seenPipelineIds.has(pipelineId)) {
			pipelineId = createPipelineId();
		}
		seenPipelineIds.add(pipelineId);

		const statuses = pipeline.statuses.map(status => {
			let statusId = status.id;
			if (!statusId || seenStatusIds.has(statusId)) {
				statusId = createStatusId();
			}
			seenStatusIds.add(statusId);
			return {
				...status,
				id: statusId,
			};
		});

		return {
			...pipeline,
			id: pipelineId,
			statuses: normalizePipelineStatuses(statuses),
		};
	});
}

function getParentFolderFromPath(path: string | null | undefined): string {
	const normalized = normalizeOptionalString(path);
	if (!normalized) return '';
	const slashIndex = normalized.lastIndexOf('/');
	if (slashIndex <= 0) return '';
	return normalized.slice(0, slashIndex).trim();
}

function resolveFileTaskTemplateFolder(src: Record<string, unknown>): string {
	const configuredFolder = normalizeOptionalString(src.fileTaskTemplateFolder);
	if (configuredFolder) return configuredFolder;

	const legacyTemplatePath = normalizeOptionalString(src.yamlTaskTemplateFile);
	if (legacyTemplatePath) return getParentFolderFromPath(legacyTemplatePath);

	const legacyTemplates = Array.isArray(src.fileTaskTemplates)
		? src.fileTaskTemplates
			.map(template => normalizeFileTaskTemplateDefinition(template))
			.filter((template): template is FileTaskTemplateDefinition => !!template)
		: [];
	if (legacyTemplates.length === 1) {
		return getParentFolderFromPath(legacyTemplates[0].path);
	}

	return '';
}

function normalizeFilterFieldType(field: string, rawType: unknown): FilterFieldType {
	if (typeof rawType === 'string' && FILTER_FIELD_TYPES.has(rawType as FilterFieldType)) {
		return rawType as FilterFieldType;
	}
	if (field === 'checkbox') return 'checkbox';
	if (field === 'tags') return 'tags';
	if (field === 'pinned') return 'pinned';
	if (field === 'projectTree') return 'projectTree';
	if (field === 'folders') return 'folders';
	if (field === 'happensOn') return 'date';
	return 'text';
}

function normalizeFilterCondition(raw: unknown): FilterSetCondition | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const id = normalizeOptionalString(src.id);
	const field = normalizeOptionalString(src.field);
	const operator = normalizeOptionalString(src.operator);
	if (!id || !field || !operator) return null;
	const value = typeof src.value === 'string' ? src.value : undefined;
	return {
		id,
		field,
		fieldType: normalizeFilterFieldType(field, src.fieldType),
		operator,
		value,
	};
}

export function normalizeFilterSet(raw: unknown): FilterSet | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const id = normalizeOptionalString(src.id) ?? null;
	if (!id) return null;

	const name = typeof src.name === 'string' && src.name.trim()
		? src.name.trim()
		: 'Untitled Filter';
	const matchLogic = src.matchLogic === 'any' || src.matchLogic === 'none'
		? src.matchLogic
		: 'all';
	const conditions = Array.isArray(src.conditions)
		? src.conditions
			.map(condition => normalizeFilterCondition(condition))
			.filter((condition): condition is FilterSetCondition => !!condition)
		: [];
	const icon = normalizeOptionalString(src.icon);
	const sortBy = normalizeOptionalString(src.sortBy);
	const sortOrder = src.sortOrder === 'asc' || src.sortOrder === 'desc'
		? src.sortOrder
		: undefined;
	const groupBy = normalizeOptionalString(src.groupBy);
	const groupOrder = src.groupOrder === 'asc' || src.groupOrder === 'desc'
		? src.groupOrder
		: undefined;
	const subgroupBy = normalizeOptionalString(src.subgroupBy);
	const subgroupOrder = src.subgroupOrder === 'asc' || src.subgroupOrder === 'desc'
		? src.subgroupOrder
		: undefined;
	const rootGroup = normalizeFilterGroup(src.rootGroup) ?? {
		id: `fg_${id}`,
		logic: matchLogic,
		children: conditions.map(condition => ({ ...condition })),
	};
	const sorts = normalizeFilterSorts(src.sorts)
		?? (sortBy ? [{ field: sortBy, order: sortOrder ?? 'asc' }] : []);
	const mirroredConditions = conditions.length > 0
		? conditions
		: rootGroup.children.every(isFilterCondition)
			? rootGroup.children.map(condition => ({ ...condition }))
			: [];
	const mirroredMatchLogic = mirroredConditions.length > 0
		? rootGroup.logic
		: matchLogic;
	const effectiveGroupBy = groupBy;
	const effectiveSubgroupBy = subgroupBy && subgroupBy !== effectiveGroupBy
		? subgroupBy
		: undefined;
	const primarySort = sorts[0];
	const mirroredSortBy = sortBy ?? primarySort?.field;
	const mirroredSortOrder = mirroredSortBy
		? (sortOrder ?? primarySort?.order ?? 'asc')
		: undefined;

	return {
		id,
		name,
		icon,
		rootGroup,
		sorts,
		subgroupBy: effectiveSubgroupBy,
		subgroupOrder: effectiveSubgroupBy ? (subgroupOrder ?? 'asc') : undefined,
		matchLogic: mirroredMatchLogic,
		conditions: mirroredConditions,
		sortBy: mirroredSortBy,
		sortOrder: mirroredSortOrder,
		groupBy: effectiveGroupBy,
		groupOrder: effectiveGroupBy ? (groupOrder ?? 'asc') : undefined,
	};
}

function isFilterCondition(value: unknown): value is FilterSetCondition {
	return !!normalizeFilterCondition(value);
}

function normalizeFilterNode(raw: unknown): FilterNode | null {
	const condition = normalizeFilterCondition(raw);
	if (condition) {
		return condition;
	}
	return normalizeFilterGroup(raw);
}

function normalizeFilterGroup(raw: unknown): FilterGroup | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const id = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : null;
	if (!id) return null;
	const logic: FilterGroupLogic = src.logic === 'any' || src.logic === 'none' ? src.logic : 'all';
	const childrenRaw = Array.isArray(src.children) ? src.children : [];
	const children = childrenRaw
		.map(child => normalizeFilterNode(child))
		.filter((child): child is FilterNode => !!child);
	return { id, logic, children };
}

function normalizeFilterSorts(raw: unknown): FilterSortSpec[] | null {
	if (!Array.isArray(raw)) return null;
	const seen = new Set<string>();
	return raw
		.map(sort => {
			if (!sort || typeof sort !== 'object') return null;
			const src = sort as Record<string, unknown>;
			const field = normalizeOptionalString(src.field);
			if (!field || seen.has(field)) return null;
			seen.add(field);
			const order = src.order === 'desc' ? 'desc' : 'asc';
			return { field, order };
		})
		.filter((sort): sort is FilterSortSpec => !!sort);
}

function cloneFilterSorts(sorts: readonly FilterSortSpec[]): FilterSortSpec[] {
	return sorts.map(sort => ({ ...sort }));
}

/**
 * Clamp a number to its constraint range.
 */
function clamp(value: number, key: string): number {
	const c = getNumericConstraint(key);
	if (!c) return value;
	const maxClamped = typeof c.max === 'number' ? Math.min(c.max, value) : value;
	return Math.max(c.min, maxClamped);
}

function normalizeClampedNumber(raw: unknown, fallback: number, key: string): number {
	const parsed = typeof raw === 'number'
		? raw
		: typeof raw === 'string'
			? Number.parseFloat(raw)
			: NaN;
	const finite = Number.isFinite(parsed) ? parsed : fallback;
	return Math.round(clamp(finite, key));
}

function normalizeAllowedNumber(value: number, allowed: readonly number[], fallback: number): number {
	return allowed.includes(value) ? value : fallback;
}

function normalizeTaskStatsBackfillVersion(raw: unknown): number {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return DEFAULT_SETTINGS.taskStatsBackfillVersion;
	}
	return Math.max(0, Math.min(CURRENT_TASK_STATS_BACKFILL_VERSION, Math.floor(raw)));
}

function normalizeInlineTaskSaveMode(raw: unknown, fallback: InlineTaskSaveMode): InlineTaskSaveMode {
	return raw === 'daily-notes'
		|| raw === 'specific-file'
		|| raw === 'active-file'
		|| raw === 'ask-every-time'
		? raw
		: fallback;
}

export function normalizeFallbackTaskIconSource(value: unknown): FallbackTaskIconSource {
	return value === 'stateIcon' || value === 'priorityIcon' ? value : 'pipelineStatusIcon';
}

/**
 * Migrate and normalize raw settings data to current schema version.
 * Handles missing keys, invalid types, and out-of-range values.
 */
export function migrateSettings(raw: unknown): OperonSettings {
	const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	const sourceSettingsVersion = typeof src.settingsVersion === 'number' && Number.isFinite(src.settingsVersion)
		? Math.floor(src.settingsVersion)
		: 0;
	const out = { ...DEFAULT_SETTINGS };

	// Copy known keys, validate types
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof OperonSettings)[]) {
		if (key === 'settingsVersion') continue;
		if (!(key in src)) continue;

		const defaultVal = DEFAULT_SETTINGS[key];
		const srcVal = src[key];

		if (typeof defaultVal === 'number' && typeof srcVal === 'number') {
			(out as Record<string, unknown>)[key] = clamp(srcVal, key);
		} else if (typeof defaultVal === 'boolean' && typeof srcVal === 'boolean') {
			(out as Record<string, unknown>)[key] = srcVal;
		} else if (typeof defaultVal === 'string' && typeof srcVal === 'string') {
			(out as Record<string, unknown>)[key] = srcVal;
		} else if (Array.isArray(defaultVal) && Array.isArray(srcVal)) {
			(out as Record<string, unknown>)[key] = srcVal;
		} else if (defaultVal === null && (srcVal === null || typeof srcVal === 'string' || typeof srcVal === 'number')) {
			(out as Record<string, unknown>)[key] = srcVal;
		}
		// Invalid type → keep default (already set)
	}

	if (!Array.isArray(src.filterSets) && 'leftRailDefaultFilterViewId' in src) {
		out.filterSets = [];
	}

	// Validate enum fields
	if (!isSupportedLanguage(out.language)) {
		out.language = DEFAULT_SETTINGS.language;
	}
	if (!['24h', '12h'].includes(out.timeFormat)) {
		out.timeFormat = DEFAULT_SETTINGS.timeFormat;
	}
	out.releaseNotesLastShownVersion = out.releaseNotesLastShownVersion.trim();
	out.colorPalette = normalizeColorPalette(src.colorPalette);
	if (!['body-top', 'body-bottom'].includes(out.dynamicFileTaskFilterPlacement)) {
		out.dynamicFileTaskFilterPlacement = DEFAULT_SETTINGS.dynamicFileTaskFilterPlacement;
	}
	out.dynamicFileTaskFilterSubtaskAutoExpandLimit = typeof src.dynamicFileTaskFilterSubtaskAutoExpandLimit === 'number'
		? normalizeAllowedNumber(
			Math.round(src.dynamicFileTaskFilterSubtaskAutoExpandLimit),
			DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS,
			DEFAULT_SETTINGS.dynamicFileTaskFilterSubtaskAutoExpandLimit,
		) as DynamicFileTaskFilterSubtaskAutoExpandLimit
		: src.dynamicFileTaskFilterShowSubtasks === false
			? 0
			: DEFAULT_SETTINGS.dynamicFileTaskFilterSubtaskAutoExpandLimit;
	out.dynamicSubtasksFilterSubtaskAutoExpandLimit = typeof src.dynamicSubtasksFilterSubtaskAutoExpandLimit === 'number'
		? normalizeAllowedNumber(
			Math.round(src.dynamicSubtasksFilterSubtaskAutoExpandLimit),
			DYNAMIC_FILE_TASK_FILTER_SUBTASK_AUTO_EXPAND_LIMIT_OPTIONS,
			DEFAULT_SETTINGS.dynamicSubtasksFilterSubtaskAutoExpandLimit,
		) as DynamicFileTaskFilterSubtaskAutoExpandLimit
		: out.dynamicFileTaskFilterSubtaskAutoExpandLimit;
	out.dynamicSubtasksFilterShowOnlyOpenSubtasks = typeof src.dynamicSubtasksFilterShowOnlyOpenSubtasks === 'boolean'
		? src.dynamicSubtasksFilterShowOnlyOpenSubtasks
		: out.dynamicFileTaskFilterShowOnlyOpenSubtasks;
	if (!['tracktime', 'flowtime'].includes(out.flowTimeMode)) {
		out.flowTimeMode = DEFAULT_SETTINGS.flowTimeMode;
	}
	if (!['compact', 'expanded'].includes(out.inlineRowDefaultMode)) {
		out.inlineRowDefaultMode = DEFAULT_SETTINGS.inlineRowDefaultMode;
	}
	if (!['low', 'medium', 'high'].includes(out.inlineExpandedMetadataDensity)) {
		out.inlineExpandedMetadataDensity = DEFAULT_SETTINGS.inlineExpandedMetadataDensity;
	}
	if (!['bottom-center', 'bottom-left', 'bottom-right'].includes(out.pinnedDockPosition)) {
		out.pinnedDockPosition = DEFAULT_SETTINGS.pinnedDockPosition;
	}
	if (!['floating', 'sidebar'].includes(out.pinnedTasksDesktopSurface)) {
		out.pinnedTasksDesktopSurface = DEFAULT_SETTINGS.pinnedTasksDesktopSurface;
	}
	if (!['left', 'right'].includes(out.pinnedTasksSidebarSide)) {
		out.pinnedTasksSidebarSide = DEFAULT_SETTINGS.pinnedTasksSidebarSide;
	}
	out.pinnedDockColorSource = normalizeTaskColorSource(
		out.pinnedDockColorSource,
		PINNED_DOCK_TASK_COLOR_SOURCES,
		DEFAULT_SETTINGS.pinnedDockColorSource,
	);
	out.mobileGlobalTaskFabEnabled = src.mobileGlobalTaskFabEnabled !== false;
	out.mobileGlobalTaskFabHideInCalendar = src.mobileGlobalTaskFabHideInCalendar === true;
	out.mobileGlobalTaskFabHideInKanban = src.mobileGlobalTaskFabHideInKanban === true;
	out.mobileGlobalTaskFabPosition = normalizeMobileGlobalTaskFabPosition(src.mobileGlobalTaskFabPosition);
	if (!['monday', 'sunday'].includes(out.calendarWeekStart)) {
		out.calendarWeekStart = DEFAULT_SETTINGS.calendarWeekStart;
	}
	if (!['above', 'below'].includes(out.newOccurrencePosition)) {
		out.newOccurrencePosition = DEFAULT_SETTINGS.newOccurrencePosition;
	}
	if (!['same-folder', 'custom-folder'].includes(out.fileRepeatDestination)) {
		out.fileRepeatDestination = DEFAULT_SETTINGS.fileRepeatDestination;
	}
			out.taskFinderRecentModifiedDays = Math.round(clamp(out.taskFinderRecentModifiedDays, 'taskFinderRecentModifiedDays'));
			out.taskFinderVisibleResultCount = Math.round(clamp(out.taskFinderVisibleResultCount, 'taskFinderVisibleResultCount'));
			out.flowTimeSessionMinutes = Math.round(clamp(out.flowTimeSessionMinutes, 'flowTimeSessionMinutes'));
			out.flowTimePauseMinutes = normalizeAllowedNumber(
				Math.round(clamp(out.flowTimePauseMinutes, 'flowTimePauseMinutes')),
				FLOW_TIME_PAUSE_MINUTE_OPTIONS,
				DEFAULT_SETTINGS.flowTimePauseMinutes,
			);
				out.flowTimeDefaultSessionMinutes = normalizeAllowedNumber(
					Math.round(clamp(out.flowTimeDefaultSessionMinutes, 'flowTimeDefaultSessionMinutes')),
					FLOW_TIME_DEFAULT_SESSION_MINUTE_OPTIONS,
					DEFAULT_SETTINGS.flowTimeDefaultSessionMinutes,
				);

	out.inlineExpandedTaskChips = normalizeInlineExpandedTaskChips(
		src.inlineExpandedTaskChips ?? src.taskBarChips,
	);
	out.fallbackTaskIconSource = normalizeFallbackTaskIconSource(src.fallbackTaskIconSource);

	if (src.fallbackStateIcons && typeof src.fallbackStateIcons === 'object' && !Array.isArray(src.fallbackStateIcons)) {
		const saved = src.fallbackStateIcons as Record<string, unknown>;
		const merged = { ...DEFAULT_SETTINGS.fallbackStateIcons };
		for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
			if (typeof saved[key] === 'string' && (saved[key] as string).trim()) {
				merged[key] = normalizeTaskIconValue(saved[key] as string);
			}
		}
		if (sourceSettingsVersion < 70) {
			for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
				if (merged[key] === LEGACY_FALLBACK_STATE_ICONS[key]) {
					merged[key] = DEFAULT_SETTINGS.fallbackStateIcons[key];
				}
			}
		}
		if (sourceSettingsVersion < 71) {
			for (const key of Object.keys(merged) as (keyof typeof merged)[]) {
				if (merged[key] === V70_FALLBACK_STATE_ICONS[key]) {
					merged[key] = DEFAULT_SETTINGS.fallbackStateIcons[key];
				}
			}
		}
		out.fallbackStateIcons = merged;
	}

	out.calendarPresets = normalizeCalendarPresets(src.calendarPresets);
	out.contextualMenuActionAllowlist = normalizeContextualMenuActionAllowlist(
		src.contextualMenuActionAllowlist ?? src.calendarHoverActionAllowlist,
	);
	out.contextualMenuSurfaceActionMatrix = normalizeContextualMenuSurfaceActionMatrix(src.contextualMenuSurfaceActionMatrix);
	if (sourceSettingsVersion < 93) {
		out.contextualMenuActionAllowlist = insertContextualMenuActionAfterOrBefore(
			out.contextualMenuActionAllowlist,
			'createSubtask',
			'openEditor',
			'jumpToSource',
		);
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceActionAfterOrBefore(
			out.contextualMenuSurfaceActionMatrix,
			'createSubtask',
			'openEditor',
			'jumpToSource',
		);
		out.contextualMenuActionAllowlist = insertContextualMenuActionAfter(
			out.contextualMenuActionAllowlist,
			'checkboxes',
			'createSubtask',
		);
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceAction(
			out.contextualMenuSurfaceActionMatrix,
			'checkboxes',
			'createSubtask',
		);
	}
	if (sourceSettingsVersion < 94) {
		out.contextualMenuActionAllowlist = insertContextualMenuActionAfterOrBefore(
			out.contextualMenuActionAllowlist,
			'subtasks',
			'openEditor',
			'createSubtask',
		);
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceActionAfterOrBefore(
			out.contextualMenuSurfaceActionMatrix,
			'subtasks',
			'openEditor',
			'createSubtask',
		);
	}
	if (sourceSettingsVersion < 97) {
		out.contextualMenuActionAllowlist = insertContextualMenuActionAfter(
			out.contextualMenuActionAllowlist,
			'convertFileToInlineTask',
			'openEditor',
		);
		out.contextualMenuActionAllowlist = insertContextualMenuActionAfter(
			out.contextualMenuActionAllowlist,
			'convertInlineToFileTask',
			'openEditor',
		);
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceAction(
			out.contextualMenuSurfaceActionMatrix,
			'convertFileToInlineTask',
			'openEditor',
		);
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceAction(
			out.contextualMenuSurfaceActionMatrix,
			'convertInlineToFileTask',
			'openEditor',
		);
	}
	if (sourceSettingsVersion < 98) {
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceActionAfterAny(
			out.contextualMenuSurfaceActionMatrix,
			'convertFileToInlineTask',
			['openEditor', 'markDone'],
		);
		out.contextualMenuSurfaceActionMatrix = backfillContextualMenuSurfaceActionAfterAny(
			out.contextualMenuSurfaceActionMatrix,
			'convertInlineToFileTask',
			['openEditor', 'markDone'],
		);
	}
	out.contextualMenuOpenDelayMs = normalizeContextualMenuOpenDelayMs(
		src.contextualMenuOpenDelayMs ?? src.calendarHoverMenuOpenDelayMs,
	);
	out.contextualMenuMobileEnabled = normalizeContextualMenuMobileEnabled(src.contextualMenuMobileEnabled);
	out.contextualMenuMobileLongPressMs = normalizeContextualMenuMobileLongPressMs(src.contextualMenuMobileLongPressMs);
	out.contextualMenuMobileTransitionGraceMs = normalizeContextualMenuMobileTransitionGraceMs(src.contextualMenuMobileTransitionGraceMs);
	out.contextualMenuMobileAutoHideMs = normalizeContextualMenuMobileAutoHideMs(src.contextualMenuMobileAutoHideMs);
	out.externalCalendars = normalizeExternalCalendars(src.externalCalendars);
	out.calendarPresets = preserveDisabledExternalCalendarVisibility(out.calendarPresets, out.externalCalendars);
	const legacyCalendarInlineTaskHeading = typeof src.calendarInlineTaskHeading === 'string'
		? src.calendarInlineTaskHeading.trim()
		: '';
	const sourceInlineTaskHeading = typeof src.inlineTaskHeading === 'string'
		? src.inlineTaskHeading.trim()
		: '';
	out.calendarInlineTaskHeading = legacyCalendarInlineTaskHeading
		? legacyCalendarInlineTaskHeading
		: DEFAULT_SETTINGS.calendarInlineTaskHeading;
	out.inlineTaskTargetFile = typeof src.inlineTaskTargetFile === 'string'
		? src.inlineTaskTargetFile.trim()
		: DEFAULT_SETTINGS.inlineTaskTargetFile;
	const legacyInlineTaskSaveMode = src.inlineTaskUseDailyNote === false
		? 'specific-file'
		: DEFAULT_SETTINGS.inlineTaskSaveMode;
	out.inlineTaskSaveMode = normalizeInlineTaskSaveMode(src.inlineTaskSaveMode, legacyInlineTaskSaveMode);
	out.inlineTaskUseDailyNote = out.inlineTaskSaveMode === 'daily-notes';
	out.inlineTaskHeading = sourceInlineTaskHeading
		? normalizeInlineTaskHeadingKeyword(sourceInlineTaskHeading)
		: DEFAULT_SETTINGS.inlineTaskHeading;
	if (
		legacyCalendarInlineTaskHeading
		&& (!sourceInlineTaskHeading || normalizeInlineTaskHeadingKeyword(sourceInlineTaskHeading) === DEFAULT_INLINE_TASK_HEADING_KEYWORD)
	) {
		out.inlineTaskHeading = normalizeInlineTaskHeadingKeyword(legacyCalendarInlineTaskHeading);
	}
	if (!['default', 'same-folder'].includes(out.fileTaskParentInlineTargetMode)) {
		out.fileTaskParentInlineTargetMode = DEFAULT_SETTINGS.fileTaskParentInlineTargetMode;
	}
	if (!['default', 'same-folder'].includes(out.fileTaskParentFileTargetMode)) {
		out.fileTaskParentFileTargetMode = DEFAULT_SETTINGS.fileTaskParentFileTargetMode;
	}
	if (!['default', 'below-parent'].includes(out.inlineTaskParentInlineTargetMode)) {
		out.inlineTaskParentInlineTargetMode = DEFAULT_SETTINGS.inlineTaskParentInlineTargetMode;
	}
	if (!['default', 'inside-parent-file'].includes(out.inlineTaskParentFileTargetMode)) {
		out.inlineTaskParentFileTargetMode = DEFAULT_SETTINGS.inlineTaskParentFileTargetMode;
	}
	out.inlineTaskParentFileHeadingKeyword = typeof src.inlineTaskParentFileHeadingKeyword === 'string'
		? normalizeInlineTaskParentFileHeadingKeyword(src.inlineTaskParentFileHeadingKeyword)
		: DEFAULT_SETTINGS.inlineTaskParentFileHeadingKeyword;
	out.inlineTaskDailyNoteAddStartDate = typeof src.inlineTaskDailyNoteAddStartDate === 'boolean'
		? src.inlineTaskDailyNoteAddStartDate
		: DEFAULT_SETTINGS.inlineTaskDailyNoteAddStartDate;
	out.inlineTaskDailyNoteAddScheduledDate = typeof src.inlineTaskDailyNoteAddScheduledDate === 'boolean'
		? src.inlineTaskDailyNoteAddScheduledDate
		: DEFAULT_SETTINGS.inlineTaskDailyNoteAddScheduledDate;
	out.taskCreatorToolbar = normalizeTaskCreatorToolbar(src.taskCreatorToolbar);
	out.taskEditorShowLineNumbers = typeof src.taskEditorShowLineNumbers === 'boolean'
		? src.taskEditorShowLineNumbers
		: Object.keys(src).length === 0
			? DEFAULT_SETTINGS.taskEditorShowLineNumbers
			: true;
	out.taskEditorAutosaveDelaySeconds = normalizeAllowedNumber(
		typeof src.taskEditorAutosaveDelaySeconds === 'number'
			? Math.round(src.taskEditorAutosaveDelaySeconds)
			: DEFAULT_SETTINGS.taskEditorAutosaveDelaySeconds,
		TASK_EDITOR_AUTOSAVE_DELAY_SECONDS_OPTIONS,
		DEFAULT_SETTINGS.taskEditorAutosaveDelaySeconds,
	);
	out.taskEditorWorkflowPickers = normalizeTaskEditorWorkflowPickers(
		src.taskEditorWorkflowPickers,
		'taskEditorWorkflowPickers' in src || Object.keys(src).length === 0
			? DEFAULT_SETTINGS.taskEditorWorkflowPickers
			: buildCompatibilityTaskEditorWorkflowPickerItems(),
	);
	out.taskEditorMobileCoreTools = normalizeTaskEditorMobileCoreTools(src.taskEditorMobileCoreTools);
	out.inlineTaskCompactChips = normalizeInlineTaskCompactChips(src.inlineTaskCompactChips);
	out.filterTaskCompactChips = normalizeFilterTaskCompactChips(src);
	out.taskFinderCompactChips = normalizeTaskFinderCompactChips(src.taskFinderCompactChips);
	out.taskFinderDefaultScope = normalizeTaskFinderDefaultScope(src.taskFinderDefaultScope);
	out.taskFinderRememberLastScopes = typeof src.taskFinderRememberLastScopes === 'boolean'
		? src.taskFinderRememberLastScopes
		: DEFAULT_SETTINGS.taskFinderRememberLastScopes;
	out.taskFinderSelectedProjectId = typeof src.taskFinderSelectedProjectId === 'string'
		? src.taskFinderSelectedProjectId.trim()
		: DEFAULT_SETTINGS.taskFinderSelectedProjectId;
	if (!out.taskFinderRememberLastScopes) {
		out.taskFinderDefaultScope = buildDefaultTaskFinderDefaultScopeItems();
		out.taskFinderSelectedProjectId = '';
	}
	out.taskFinderShortcuts = normalizeTaskFinderShortcuts(src.taskFinderShortcuts);
	out.overlayTaskCompactChips = normalizeOverlayTaskCompactChips(src.overlayTaskCompactChips);
	out.overlayTaskShowPlayAction = typeof src.overlayTaskShowPlayAction === 'boolean'
		? src.overlayTaskShowPlayAction
		: DEFAULT_SETTINGS.overlayTaskShowPlayAction;
	out.overlayTaskShowPinAction = typeof src.overlayTaskShowPinAction === 'boolean'
		? src.overlayTaskShowPinAction
		: DEFAULT_SETTINGS.overlayTaskShowPinAction;
	out.overlayTaskShowNoteAction = typeof src.overlayTaskShowNoteAction === 'boolean'
		? src.overlayTaskShowNoteAction
		: DEFAULT_SETTINGS.overlayTaskShowNoteAction;
	out.overlayTaskShowSubtaskAction = typeof src.overlayTaskShowSubtaskAction === 'boolean'
		? src.overlayTaskShowSubtaskAction
		: DEFAULT_SETTINGS.overlayTaskShowSubtaskAction;
	out.overlayTaskShowPlainCheckboxAction = typeof src.overlayTaskShowPlainCheckboxAction === 'boolean'
		? src.overlayTaskShowPlainCheckboxAction
		: DEFAULT_SETTINGS.overlayTaskShowPlainCheckboxAction;
	out.inlineTaskShowPlayAction = typeof src.inlineTaskShowPlayAction === 'boolean'
		? src.inlineTaskShowPlayAction
		: DEFAULT_SETTINGS.inlineTaskShowPlayAction;
	out.inlineTaskShowPinAction = typeof src.inlineTaskShowPinAction === 'boolean'
		? src.inlineTaskShowPinAction
		: DEFAULT_SETTINGS.inlineTaskShowPinAction;
	out.inlineTaskShowSubtaskAction = typeof src.inlineTaskShowSubtaskAction === 'boolean'
		? src.inlineTaskShowSubtaskAction
		: DEFAULT_SETTINGS.inlineTaskShowSubtaskAction;
	out.inlineTaskShowTasksEmojiConvertIcon = typeof src.inlineTaskShowTasksEmojiConvertIcon === 'boolean'
		? src.inlineTaskShowTasksEmojiConvertIcon
		: DEFAULT_SETTINGS.inlineTaskShowTasksEmojiConvertIcon;
	out.inlineTaskShowPlainCheckboxConvertIcon = typeof src.inlineTaskShowPlainCheckboxConvertIcon === 'boolean'
		? src.inlineTaskShowPlainCheckboxConvertIcon
		: DEFAULT_SETTINGS.inlineTaskShowPlainCheckboxConvertIcon;
	out.filterTaskShowPlayAction = typeof src.filterTaskShowPlayAction === 'boolean'
		? src.filterTaskShowPlayAction
		: DEFAULT_SETTINGS.filterTaskShowPlayAction;
	out.filterTaskShowPinAction = typeof src.filterTaskShowPinAction === 'boolean'
		? src.filterTaskShowPinAction
		: DEFAULT_SETTINGS.filterTaskShowPinAction;
	out.filterTaskShowSubtaskAction = typeof src.filterTaskShowSubtaskAction === 'boolean'
		? src.filterTaskShowSubtaskAction
		: DEFAULT_SETTINGS.filterTaskShowSubtaskAction;
	out.filterTaskShowPlainCheckboxAction = typeof src.filterTaskShowPlainCheckboxAction === 'boolean'
		? src.filterTaskShowPlainCheckboxAction
		: DEFAULT_SETTINGS.filterTaskShowPlainCheckboxAction;
	out.workspaceTweaksHideScrollbars = typeof src.workspaceTweaksHideScrollbars === 'boolean'
		? src.workspaceTweaksHideScrollbars
		: DEFAULT_SETTINGS.workspaceTweaksHideScrollbars;
	out.workspaceTweaksCollapseProperties = typeof src.workspaceTweaksCollapseProperties === 'boolean'
		? src.workspaceTweaksCollapseProperties
		: DEFAULT_SETTINGS.workspaceTweaksCollapseProperties;
	out.workspaceTweaksPropertiesScope = src.workspaceTweaksPropertiesScope === 'all-notes'
		? 'all-notes'
		: DEFAULT_SETTINGS.workspaceTweaksPropertiesScope;
	out.workspaceTweaksPropertiesExcludedFolders = normalizeFolderPathList(src.workspaceTweaksPropertiesExcludedFolders);
	out.workspaceTweaksCompactSidebarTabIcons = typeof src.workspaceTweaksCompactSidebarTabIcons === 'boolean'
		? src.workspaceTweaksCompactSidebarTabIcons
		: DEFAULT_SETTINGS.workspaceTweaksCompactSidebarTabIcons;
	out.calendarShowAllDayLane = typeof src.calendarShowAllDayLane === 'boolean'
		? src.calendarShowAllDayLane
		: DEFAULT_SETTINGS.calendarShowAllDayLane;
	out.calendarShowDueMarkers = typeof src.calendarShowDueMarkers === 'boolean'
		? src.calendarShowDueMarkers
		: DEFAULT_SETTINGS.calendarShowDueMarkers;
	out.calendarInitialScrollMode = normalizeCalendarInitialScrollMode(src.calendarInitialScrollMode);
	out.calendarDayTitleAction = normalizeCalendarDayTitleAction(src.calendarDayTitleAction);
	out.calendarAutoScrollPastRatio = normalizeCalendarAutoScrollPastRatio(src.calendarAutoScrollPastRatio);
	out.calendarTimeGridScale = normalizeCalendarTimeGridScale(src.calendarTimeGridScale);
	out.calendarSidebarWidthPx = 'calendarSidebarWidthPx' in src
		? normalizeCalendarSidebarWidthPx(src.calendarSidebarWidthPx)
		: migrateCalendarSidebarWidthScaleToPx(src.calendarSidebarWidthScale);
	out.calendarSidebarCalendarsDefaultExpanded = typeof src.calendarSidebarCalendarsDefaultExpanded === 'boolean'
		? src.calendarSidebarCalendarsDefaultExpanded
		: DEFAULT_SETTINGS.calendarSidebarCalendarsDefaultExpanded;
	out.calendarSidebarShowWeekNumbers = typeof src.calendarSidebarShowWeekNumbers === 'boolean'
		? src.calendarSidebarShowWeekNumbers
		: DEFAULT_SETTINGS.calendarSidebarShowWeekNumbers;
	out.calendarShowWeekLabelOnFirstDay = typeof src.calendarShowWeekLabelOnFirstDay === 'boolean'
		? src.calendarShowWeekLabelOnFirstDay
		: DEFAULT_SETTINGS.calendarShowWeekLabelOnFirstDay;
	out.calendarSidebarTaskPoolDefaultExpanded = typeof src.calendarSidebarTaskPoolDefaultExpanded === 'boolean'
		? src.calendarSidebarTaskPoolDefaultExpanded
		: DEFAULT_SETTINGS.calendarSidebarTaskPoolDefaultExpanded;
	out.calendarSidebarTaskPoolFollowPresetFilter = typeof src.calendarSidebarTaskPoolFollowPresetFilter === 'boolean'
		? src.calendarSidebarTaskPoolFollowPresetFilter
		: false;
	if (src.calendarSidebarFinishedTasksDefaultExpanded === true && !out.calendarSidebarTaskPoolDefaultExpanded) {
		out.calendarSidebarTaskPoolDefaultExpanded = true;
	}
	out.calendarSidebarFinishedTasksDefaultExpanded = false;
	out.calendarTouchTimeGridTaskMoveEnabled = typeof src.calendarTouchTimeGridTaskMoveEnabled === 'boolean'
		? src.calendarTouchTimeGridTaskMoveEnabled
		: DEFAULT_SETTINGS.calendarTouchTimeGridTaskMoveEnabled;
	out.calendarTouchDragLongPressMs = normalizeCalendarTouchDragLongPressMs(src.calendarTouchDragLongPressMs);
	out.calendarTouchDragCancelDistancePx = normalizeCalendarTouchDragCancelDistancePx(src.calendarTouchDragCancelDistancePx);
	const normalizedCalendarSidebarDefaults = normalizeCalendarSidebarDefaultExpansionState({
		calendarSidebarCalendarsDefaultExpanded: out.calendarSidebarCalendarsDefaultExpanded,
		calendarSidebarTaskPoolDefaultExpanded: out.calendarSidebarTaskPoolDefaultExpanded,
	});
	out.calendarSidebarCalendarsDefaultExpanded = normalizedCalendarSidebarDefaults.calendarSidebarCalendarsDefaultExpanded;
	out.calendarSidebarTaskPoolDefaultExpanded = normalizedCalendarSidebarDefaults.calendarSidebarTaskPoolDefaultExpanded;
	if (Array.isArray(src.calendarPresets)) {
		if (
			typeof src.calendarDefaultPresetId === 'string'
			&& out.calendarPresets.some(preset => preset.id === src.calendarDefaultPresetId)
		) {
			out.calendarDefaultPresetId = src.calendarDefaultPresetId;
		} else {
			out.calendarDefaultPresetId = out.calendarPresets.find(preset => preset.id === DEFAULT_CALENDAR_DEFAULT_PRESET_ID)?.id
				?? out.calendarPresets[0]?.id
				?? null;
		}
	} else {
		out.calendarDefaultPresetId = normalizeOptionalString(src.calendarDefaultPresetId) ?? null;
	}
	out.calendarMobileEnabled = src.calendarMobileEnabled !== false;
	out.calendarMobileMaxWidthPx = normalizeCalendarMobileMaxWidthPx(src.calendarMobileMaxWidthPx);
	out.calendarMobileDefaultView = normalizeCalendarMobileViewMode(
		src.calendarMobileDefaultView,
		DEFAULT_SETTINGS.calendarMobileDefaultView,
	);
	out.calendarMobileAgendaEnabled = src.calendarMobileAgendaEnabled !== false;
	out.calendarMobileDayEnabled = src.calendarMobileDayEnabled !== false;
	out.calendarMobileTwoDayEnabled = src.calendarMobileTwoDayEnabled !== false;
	out.calendarMobileThreeDayEnabled = src.calendarMobileThreeDayEnabled !== false;
	if (CALENDAR_MOBILE_VIEW_MODES.every(mode => out[CALENDAR_MOBILE_VIEW_MODE_ENABLED_SETTING_BY_VIEW_MODE[mode]] === false)) {
		const fallbackMode = CALENDAR_MOBILE_VIEW_MODES.includes(out.calendarMobileDefaultView)
			? out.calendarMobileDefaultView
			: 'agenda';
		out[CALENDAR_MOBILE_VIEW_MODE_ENABLED_SETTING_BY_VIEW_MODE[fallbackMode]] = true;
	}
	const fallbackMobileSourcePresetId = out.calendarDefaultPresetId && out.calendarPresets.some(preset => preset.id === out.calendarDefaultPresetId)
		? out.calendarDefaultPresetId
		: out.calendarPresets[0]?.id ?? null;
	const normalizeMobileSourcePresetId = (raw: unknown, fallback: string | null): string | null => {
		const presetId = typeof raw === 'string' && raw.trim()
			? raw
			: null;
		return presetId && out.calendarPresets.some(preset => preset.id === presetId)
			? presetId
			: fallback;
	};
	const legacyMobileSourcePresetId = normalizeMobileSourcePresetId(
		src.calendarMobileDefaultSourcePresetId,
		fallbackMobileSourcePresetId,
	);
	out.calendarMobileDefaultSourcePresetId = legacyMobileSourcePresetId;
	out.calendarMobileAgendaSourcePresetId = normalizeMobileSourcePresetId(src.calendarMobileAgendaSourcePresetId, legacyMobileSourcePresetId);
	out.calendarMobileDaySourcePresetId = normalizeMobileSourcePresetId(src.calendarMobileDaySourcePresetId, legacyMobileSourcePresetId);
	out.calendarMobileTwoDaySourcePresetId = normalizeMobileSourcePresetId(src.calendarMobileTwoDaySourcePresetId, legacyMobileSourcePresetId);
	out.calendarMobileThreeDaySourcePresetId = normalizeMobileSourcePresetId(src.calendarMobileThreeDaySourcePresetId, legacyMobileSourcePresetId);
	out.calendarMobileSlotMinutes = normalizeCalendarMobileSlotMinutes(src.calendarMobileSlotMinutes);
	out.calendarMobileShowProjectedOccurrences = src.calendarMobileShowProjectedOccurrences !== false;
	out.calendarMobileShowExternalCalendars = src.calendarMobileShowExternalCalendars !== false;
	out.calendarMobileColorSource = normalizeTaskColorSource(
		src.calendarMobileColorSource,
		CALENDAR_TASK_COLOR_SOURCES,
		DEFAULT_SETTINGS.calendarMobileColorSource,
	);
	out.calendarMobileShowDueMarkers = src.calendarMobileShowDueMarkers !== false;
	out.calendarMobileShowAllDayItems = src.calendarMobileShowAllDayItems !== false;
	out.calendarMobileAgendaPastDays = normalizeCalendarMobileAgendaPastDays(src.calendarMobileAgendaPastDays);
	out.calendarMobileAgendaFutureDays = normalizeCalendarMobileAgendaFutureDays(src.calendarMobileAgendaFutureDays);
	out.calendarMobileAgendaShowCompletedItems = typeof src.calendarMobileAgendaShowCompletedItems === 'boolean'
		? src.calendarMobileAgendaShowCompletedItems
		: DEFAULT_SETTINGS.calendarMobileAgendaShowCompletedItems;
	out.calendarMobileAllDayVisibleTaskLimit = normalizeCalendarMobileAllDayVisibleTaskLimit(src.calendarMobileAllDayVisibleTaskLimit);
	out.calendarMobileShowCompletedItems = typeof src.calendarMobileShowCompletedItems === 'boolean'
		? src.calendarMobileShowCompletedItems
		: DEFAULT_SETTINGS.calendarMobileShowCompletedItems;
	out.kanbanPresets = normalizeKanbanPresets(src.kanbanPresets);
	out.kanbanExpandedColumnWidthPx = normalizeKanbanExpandedColumnWidthPx(src.kanbanExpandedColumnWidthPx);
	out.kanbanMaxVisibleTasksPerCell = normalizeKanbanMaxVisibleTasksPerCell(src.kanbanMaxVisibleTasksPerCell);
	out.kanbanMobileLayoutChromeEnabled = src.kanbanMobileLayoutChromeEnabled !== false;
	out.kanbanMobileLayoutMaxWidthPx = normalizeKanbanMobileLayoutMaxWidthPx(src.kanbanMobileLayoutMaxWidthPx);
	out.kanbanMobileCompactSwimlaneWidthPx = normalizeKanbanMobileCompactSwimlaneWidthPx(src.kanbanMobileCompactSwimlaneWidthPx);
	out.kanbanMobileSwimlaneRailAlwaysVisible = src.kanbanMobileSwimlaneRailAlwaysVisible !== false;
	out.kanbanMobileHorizontalStatusSnapEnabled = src.kanbanMobileHorizontalStatusSnapEnabled !== false;
	if (Array.isArray(src.kanbanPresets)) {
		if (
			typeof src.kanbanDefaultPresetId === 'string'
			&& out.kanbanPresets.some(preset => preset.id === src.kanbanDefaultPresetId)
		) {
			out.kanbanDefaultPresetId = src.kanbanDefaultPresetId;
		} else {
			out.kanbanDefaultPresetId = out.kanbanPresets.find(preset => preset.id === DEFAULT_KANBAN_DEFAULT_PRESET_ID)?.id
				?? out.kanbanPresets[0]?.id
				?? null;
		}
	} else {
		out.kanbanDefaultPresetId = normalizeOptionalString(src.kanbanDefaultPresetId) ?? null;
	}

	out.filterSets = out.filterSets
		.map(filterSet => normalizeFilterSet(filterSet))
		.filter((filterSet): filterSet is FilterSet => !!filterSet);
	if (sourceSettingsVersion < 88) {
		out.filterSets = out.filterSets.map(filterSet => {
			if (filterSet.id !== 'fs_dynamic_file_task' || filterSet.sorts.length > 0) return filterSet;
			const sorts = cloneFilterSorts(DYNAMIC_FILE_TASK_FILTER_DEFAULT_SORTS);
			return normalizeFilterSet({
				...filterSet,
				sorts,
				sortBy: sorts[0]?.field,
				sortOrder: sorts[0]?.order,
			}) ?? filterSet;
		});
	}
	if (
		Array.isArray(src.filterSets)
		&& out.leftRailDefaultFilterViewId
		&& !out.filterSets.some(filterSet => filterSet.id === out.leftRailDefaultFilterViewId)
	) {
		out.leftRailDefaultFilterViewId = out.filterSets[0]?.id ?? null;
	}
	if (SPECIAL_DYNAMIC_FILTER_SET_IDS.has(out.leftRailDefaultFilterViewId ?? '')) {
		out.leftRailDefaultFilterViewId = out.filterSets.find(filterSet => !SPECIAL_DYNAMIC_FILTER_SET_IDS.has(filterSet.id))?.id ?? null;
	}

	if (!Array.isArray(src.pipelines) || src.pipelines.length === 0) {
		out.pipelines = cloneDefaultPipelines();
	} else {
		out.pipelines = src.pipelines
			.map(pipeline => normalizePipelineDefinition(pipeline))
			.filter((pipeline): pipeline is Pipeline => !!pipeline);
		if (out.pipelines.length === 0) {
			out.pipelines = cloneDefaultPipelines();
		}
	}
	out.pipelines = normalizePipelineIds(out.pipelines);

	if (!Array.isArray(src.priorities) || src.priorities.length === 0) {
		out.priorities = cloneDefaultPriorities();
	} else {
		out.priorities = src.priorities
			.map((priority, index) => normalizePriorityDefinition(priority, index))
			.filter((priority): priority is PriorityDefinition => !!priority);
		if (out.priorities.length === 0) {
			out.priorities = cloneDefaultPriorities();
		}
	}
	out.priorities = normalizePriorityIds(out.priorities);
	const normalizedDefaultPriority = normalizeOptionalString(out.defaultPriority) ?? '';
	out.defaultPriority = Array.isArray(src.priorities)
		? normalizedDefaultPriority
			&& out.priorities.some(priority => priority.label === normalizedDefaultPriority)
			? normalizedDefaultPriority
			: ''
		: normalizedDefaultPriority;

	if (Array.isArray(src.pipelines)) {
		if (
			typeof out.defaultPipelineName !== 'string'
			|| !out.defaultPipelineName
			|| !out.pipelines.some(pipeline => pipeline.name === out.defaultPipelineName)
		) {
			out.defaultPipelineName = out.pipelines[0]?.name ?? '';
		}
	} else {
		out.defaultPipelineName = normalizeOptionalString(src.defaultPipelineName) ?? DEFAULT_SETTINGS.defaultPipelineName;
	}

	// Ensure key mappings include all canonical keys.
	if (out.keyMappings.length === 0) {
		out.keyMappings = buildDefaultKeyMappings();
	} else {
		// Backfill missing mapping metadata on older settings files.
		for (const m of out.keyMappings) {
			const mapping = m as MigratingKeyMapping;
			if (m.canonicalKey === 'dateCreated') {
				m.canonicalKey = 'datetimeCreated';
				m.type = 'datetime';
				if (m.visiblePropertyName === 'dateCreated') {
					m.visiblePropertyName = 'datetimeCreated';
				}
			}
			const canonical = CANONICAL_KEYS.find(k => k.name === m.canonicalKey);
			if (canonical && m.isSystem !== false) {
				m.type = canonical.type;
				m.sync = canonical.sync;
				m.isSystem = true;
				m.isInternal = canonical.internal === true;
			}
			mapping.enabled = true;
			if (canonical?.internal === true) {
				mapping.hideInFileTaskView = true;
			} else if (mapping.hideInFileTaskView !== true) {
				mapping.hideInFileTaskView = false;
			}
			if (typeof mapping.icon !== 'string') {
				mapping.icon = getDefaultKeyMappingIcon(m.canonicalKey);
			} else if (!mapping.icon && mapping.isSystem !== false && sourceSettingsVersion < 69) {
				mapping.icon = getDefaultKeyMappingIcon(m.canonicalKey);
			}
			mapping.icon = normalizeTaskIconValue(mapping.icon);
			if (mapping.isSystem === undefined) {
				const isCanonical = CANONICAL_KEYS.some(k => k.name === m.canonicalKey);
				mapping.isSystem = isCanonical;
			}
			if (mapping.isInternal === undefined) {
				mapping.isInternal = canonical?.internal === true;
			}
		}
		// Prune retired mappings from every origin, plus stale system keys that no
		// longer exist in CANONICAL_KEYS (e.g. 'icon' and 'color' were renamed).
		out.keyMappings = out.keyMappings.filter(m =>
			!isRetiredKeyMapping(m.canonicalKey)
			&& (!m.isSystem || CANONICAL_KEYS.some(k => k.name === m.canonicalKey))
		);
		out.keyMappings = dedupeKeyMappingsByCanonicalKey(out.keyMappings);
		// Add any new canonical keys not yet in mappings
		for (const k of CANONICAL_KEYS) {
			if (isRetiredKeyMapping(k.name)) continue;
			if (!out.keyMappings.some(m => m.isSystem !== false && m.canonicalKey === k.name)) {
				out.keyMappings.push({
					canonicalKey: k.name,
					visiblePropertyName: getDefaultKeyMappingVisibleName(k.name),
					type: k.type,
					sync: k.sync,
					enabled: true,
					hideInFileTaskView: k.internal === true,
					icon: getDefaultKeyMappingIcon(k.name),
					isSystem: true,
					isInternal: k.internal === true,
				});
			}
		}
		out.keyMappings = dedupeKeyMappingsByCanonicalKey(out.keyMappings);
	}
	out.keyMappings = normalizeKeyMappingCollection(out.keyMappings);
	out.childTaskInheritanceFields = normalizeChildTaskInheritanceFields(src.childTaskInheritanceFields, out.keyMappings);
	out.childTaskInheritanceStatusPipelineSource = normalizeChildTaskInheritanceStatusPipelineSource(
		src.childTaskInheritanceStatusPipelineSource,
	);
	out.projectSerialScopes = normalizeSettingsProjectSerialScopes(src.projectSerialScopes);
	normalizeSurfaceOrderingSettings(out, src);

	out.fileTasksFolder = normalizeSettingsFolderPath(out.fileTasksFolder);
	out.fileTaskArchiveFolder = normalizeSettingsFolderPath(out.fileTaskArchiveFolder);
	if (!out.fileTaskArchiveFolder) {
		out.fileTaskArchiveFolder = DEFAULT_SETTINGS.fileTaskArchiveFolder;
	}
	out.fileTaskArchiveDelaySeconds = Math.round(clamp(out.fileTaskArchiveDelaySeconds, 'fileTaskArchiveDelaySeconds'));
	out.taskCreatorDefaultFileTemplateId = normalizeOptionalString(src.taskCreatorDefaultFileTemplateId) || null;
	out.fileTaskTemplateFolder = resolveFileTaskTemplateFolder(src);
	out.excludedFolders = sanitizeExcludedFoldersForFileTasksFolder(
		normalizeFolderPathList(src.excludedFolders),
		out.fileTasksFolder,
	);
	out.locationPickerMapDefaultCenter = typeof src.locationPickerMapDefaultCenter === 'string'
		? src.locationPickerMapDefaultCenter.trim()
		: DEFAULT_SETTINGS.locationPickerMapDefaultCenter;
	out.locationMapsAlwaysLightMode = typeof src.locationMapsAlwaysLightMode === 'boolean'
		? src.locationMapsAlwaysLightMode
		: DEFAULT_SETTINGS.locationMapsAlwaysLightMode;
	out.locationPlaceIconPropertyName = typeof src.locationPlaceIconPropertyName === 'string'
		? src.locationPlaceIconPropertyName.trim()
		: DEFAULT_SETTINGS.locationPlaceIconPropertyName;
	out.locationPlaceColorPropertyName = typeof src.locationPlaceColorPropertyName === 'string'
		? src.locationPlaceColorPropertyName.trim()
		: DEFAULT_SETTINGS.locationPlaceColorPropertyName;
	out.locationPickerMapDefaultZoom = normalizeClampedNumber(
		src.locationPickerMapDefaultZoom,
		DEFAULT_SETTINGS.locationPickerMapDefaultZoom,
		'locationPickerMapDefaultZoom',
	);
	out.locationPreviewWidth = normalizeClampedNumber(
		src.locationPreviewWidth,
		DEFAULT_SETTINGS.locationPreviewWidth,
		'locationPreviewWidth',
	);
	out.locationPreviewHeight = normalizeClampedNumber(
		src.locationPreviewHeight,
		DEFAULT_SETTINGS.locationPreviewHeight,
		'locationPreviewHeight',
	);
	out.locationPreviewMinZoom = normalizeClampedNumber(
		src.locationPreviewMinZoom,
		DEFAULT_SETTINGS.locationPreviewMinZoom,
		'locationPreviewMinZoom',
	);
	out.locationPreviewMaxZoom = normalizeClampedNumber(
		src.locationPreviewMaxZoom,
		DEFAULT_SETTINGS.locationPreviewMaxZoom,
		'locationPreviewMaxZoom',
	);
	if (out.locationPreviewMinZoom > out.locationPreviewMaxZoom) {
		out.locationPreviewMinZoom = DEFAULT_SETTINGS.locationPreviewMinZoom;
		out.locationPreviewMaxZoom = DEFAULT_SETTINGS.locationPreviewMaxZoom;
	}
	out.locationPreviewDefaultZoom = Math.min(
		Math.max(
			normalizeClampedNumber(
				src.locationPreviewDefaultZoom,
				DEFAULT_SETTINGS.locationPreviewDefaultZoom,
				'locationPreviewDefaultZoom',
			),
			out.locationPreviewMinZoom,
		),
		out.locationPreviewMaxZoom,
	);
	out.createDailyNotesAsOperonTask = src.createDailyNotesAsOperonTask === true;
	out.trackerTaskDescriptionClickAction = src.trackerTaskDescriptionClickAction === 'openTaskEditor'
		? 'openTaskEditor'
		: DEFAULT_SETTINGS.trackerTaskDescriptionClickAction;
	out.flowTimeMode = src.flowTimeMode === 'flowtime'
		? 'flowtime'
		: DEFAULT_SETTINGS.flowTimeMode;
	out.duplicateAlertDelaySeconds = normalizeAllowedNumber(
		Math.floor(out.duplicateAlertDelaySeconds),
		DUPLICATE_ALERT_DELAY_SECONDS_OPTIONS,
		DEFAULT_SETTINGS.duplicateAlertDelaySeconds,
	);
	out.taskStatsBackfillVersion = normalizeTaskStatsBackfillVersion(src.taskStatsBackfillVersion);

	out.settingsVersion = CURRENT_SETTINGS_VERSION;
	return out;
}

function normalizeSurfaceOrderingSettings(out: OperonSettings, src: Record<string, unknown>): void {
	out.taskCreatorToolbar = normalizeTaskCreatorToolbar(src.taskCreatorToolbar, out.keyMappings);
	out.taskEditorWorkflowPickers = normalizeTaskEditorWorkflowPickers(
		src.taskEditorWorkflowPickers,
		'taskEditorWorkflowPickers' in src || Object.keys(src).length === 0
			? DEFAULT_SETTINGS.taskEditorWorkflowPickers
			: buildCompatibilityTaskEditorWorkflowPickerItems(),
		out.keyMappings,
	);
	out.taskEditorMobileCoreTools = normalizeTaskEditorMobileCoreTools(
		src.taskEditorMobileCoreTools,
		DEFAULT_SETTINGS.taskEditorMobileCoreTools,
		out.keyMappings,
	);
	out.inlineTaskCompactChips = normalizeInlineTaskCompactChips(src.inlineTaskCompactChips, out.keyMappings);
	out.filterTaskCompactChips = normalizeFilterTaskCompactChips(src, out.keyMappings);
	out.taskFinderCompactChips = normalizeTaskFinderCompactChips(src.taskFinderCompactChips, out.keyMappings);
	out.overlayTaskCompactChips = normalizeOverlayTaskCompactChips(src.overlayTaskCompactChips, out.keyMappings);
}

export function normalizeSettingsProjectSerialScopes(raw: unknown): ProjectSerialScope[] {
	const normalized = normalizeProjectSerialScopes(raw);
	const scopes: ProjectSerialScope[] = [];
	const seenIds = new Set<string>();
	const seenParentIds = new Set<string>();
	for (const scope of normalized) {
		const id = scope.id.trim() || createProjectSerialScopeId(seenIds);
		const prefix = normalizeProjectSerialPrefix(scope.prefix);
		const parentOperonId = scope.parentOperonId.trim();
		if (!prefix || !parentOperonId || seenIds.has(id) || seenParentIds.has(parentOperonId)) continue;
		scopes.push({
			id,
			prefix,
			parentOperonId,
			createdAt: scope.createdAt.trim(),
			updatedAt: scope.updatedAt.trim(),
		});
		seenIds.add(id);
		seenParentIds.add(parentOperonId);
	}
	return scopes;
}

function isProjectableCustomSurfaceMapping(mapping: KeyMapping): boolean {
	return mapping.isSystem === false
		&& mapping.isInternal !== true
		&& mapping.type !== 'checkbox'
		&& !isRetiredKeyMapping(mapping.canonicalKey);
}

function getProjectableCustomSurfaceMappings(keyMappings: readonly KeyMapping[] | undefined): KeyMapping[] {
	return (keyMappings ?? [])
		.filter(isProjectableCustomSurfaceMapping)
		.sort((left, right) => {
			const leftOrder = typeof left.customOrder === 'number' && Number.isFinite(left.customOrder)
				? left.customOrder
				: Number.MAX_SAFE_INTEGER;
			const rightOrder = typeof right.customOrder === 'number' && Number.isFinite(right.customOrder)
				? right.customOrder
				: Number.MAX_SAFE_INTEGER;
			if (leftOrder !== rightOrder) return leftOrder - rightOrder;
			return left.canonicalKey.localeCompare(right.canonicalKey);
		});
}

function isPreservedOrphanSurfaceKey(key: string, keyMappings: readonly KeyMapping[] | undefined): boolean {
	if (!CUSTOM_CANONICAL_KEY_PATTERN.test(key)) return false;
	if (ALL_BUILT_IN_SURFACE_KEYS.has(key)) return false;
	if (BUILT_IN_CANONICAL_KEY_NAMES.has(key)) return false;
	if (isRetiredKeyMapping(key)) return false;
	return !(keyMappings ?? []).some(mapping => mapping.canonicalKey === key);
}

function normalizeTaskCreatorToolbar(raw: unknown, keyMappings?: readonly KeyMapping[]): TaskCreatorToolbarItem[] {
	const defaults = buildDefaultTaskCreatorToolbarItems();
	return normalizeSurfaceItems(raw, defaults, TASK_CREATOR_TOOLBAR_FIELD_ORDER, keyMappings, mapping => mapping.showInCreator !== false);
}

export function normalizeTaskEditorWorkflowPickers(
	raw: unknown,
	fallback: TaskEditorWorkflowPickerItem[] = buildDefaultTaskEditorWorkflowPickerItems(),
	keyMappings?: readonly KeyMapping[],
): TaskEditorWorkflowPickerItem[] {
	return normalizeSurfaceItems(raw, fallback, TASK_EDITOR_WORKFLOW_PICKER_ORDER, keyMappings, mapping => mapping.showInEditor !== false);
}

export function normalizeTaskEditorMobileCoreTools(
	raw: unknown,
	fallback: TaskEditorMobileCoreToolItem[] = buildDefaultTaskEditorMobileCoreToolItems(),
	keyMappings?: readonly KeyMapping[],
): TaskEditorMobileCoreToolItem[] {
	return orderTaskEditorMobileCoreTools(
		normalizeSurfaceItems(raw, fallback, TASK_EDITOR_MOBILE_CORE_TOOL_ORDER, keyMappings, mapping => mapping.showInEditor !== false),
	);
}

function orderTaskEditorMobileCoreTools(items: TaskEditorMobileCoreToolItem[]): TaskEditorMobileCoreToolItem[] {
	const first = items.find(item => item.key === 'goToSource');
	const last = items.find(item => item.key === 'remove');
	const middle = items.filter(item => item.key !== 'goToSource' && item.key !== 'remove');
	return [
		...(first ? [first] : []),
		...middle,
		...(last ? [last] : []),
	];
}

function normalizeInlineTaskCompactChips(raw: unknown, keyMappings?: readonly KeyMapping[]): InlineTaskCompactChipItem[] {
	return normalizeCompactChipItems(raw, buildDefaultInlineTaskCompactChipItems(), keyMappings);
}

function normalizeCompactChipItems(
	raw: unknown,
	defaults: InlineTaskCompactChipItem[],
	keyMappings?: readonly KeyMapping[],
): InlineTaskCompactChipItem[] {
	return normalizeSurfaceItems(raw, defaults, INLINE_TASK_COMPACT_CHIP_ORDER, keyMappings, mapping => mapping.showInChips === true);
}

function normalizeSurfaceItems<T extends { key: string; visible: boolean; iconOnly?: boolean }>(
	raw: unknown,
	defaults: T[],
	builtInOrder: readonly string[],
	keyMappings: readonly KeyMapping[] | undefined,
	getCustomVisible: (mapping: KeyMapping) => boolean,
): T[] {
	const allowedBuiltIns = new Set<string>(builtInOrder);
	const customMappings = getProjectableCustomSurfaceMappings(keyMappings);
	const customByKey = new Map(customMappings.map(mapping => [mapping.canonicalKey, mapping] as const));
	const normalized: T[] = [];
	const seen = new Set<string>();
	const rawItems = Array.isArray(raw) ? raw : defaults;
	const hasIconOnly = defaults.some(item => 'iconOnly' in item);

	for (const rawItem of rawItems) {
		if (!rawItem || typeof rawItem !== 'object') continue;
		const record = rawItem as Record<string, unknown>;
		const key = record.key;
		if (typeof key !== 'string') continue;
		const isAllowed = allowedBuiltIns.has(key)
			|| customByKey.has(key)
			|| isPreservedOrphanSurfaceKey(key, keyMappings);
		if (!isAllowed || seen.has(key)) continue;
		seen.add(key);
		const defaultItem = defaults.find(candidate => candidate.key === key);
		const customMapping = customByKey.get(key);
		const visible = typeof record.visible === 'boolean'
			? record.visible
			: customMapping
				? getCustomVisible(customMapping)
				: defaultItem?.visible ?? false;
		const nextItem = {
			...(defaultItem ?? {}),
			key,
			visible,
		} as T;
		if (hasIconOnly) {
			(nextItem as T & { iconOnly: boolean }).iconOnly = typeof record.iconOnly === 'boolean'
				? record.iconOnly
				: defaultItem?.iconOnly ?? false;
		}
		normalized.push(nextItem);
	}

	for (const item of defaults) {
		if (seen.has(item.key)) continue;
		seen.add(item.key);
		insertMissingOrderedItem(normalized, { ...item }, builtInOrder);
	}

	for (const mapping of customMappings) {
		if (seen.has(mapping.canonicalKey)) continue;
		seen.add(mapping.canonicalKey);
		normalized.push({
			key: mapping.canonicalKey,
			visible: getCustomVisible(mapping),
			...(hasIconOnly ? { iconOnly: false } : {}),
		} as T);
	}

	return normalized;
}

function normalizeInlineExpandedTaskChips(raw: unknown): InlineExpandedTaskChips {
	const merged = { ...DEFAULT_INLINE_EXPANDED_TASK_CHIPS };
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return merged;
	}

	const saved = raw as Record<string, unknown>;
	for (const chip of Object.keys(merged) as (keyof InlineExpandedTaskChips)[]) {
		if (typeof saved[chip] === 'boolean') {
			merged[chip] = saved[chip] as boolean;
		}
	}
	return merged;
}

function normalizeFilterTaskCompactChips(src: Record<string, unknown>, keyMappings?: readonly KeyMapping[]): InlineTaskCompactChipItem[] {
	if (Array.isArray(src.filterTaskCompactChips)) {
		return normalizeCompactChipItems(src.filterTaskCompactChips, buildDefaultFilterTaskCompactChipItems(), keyMappings);
	}

	const defaults = buildDefaultFilterTaskCompactChipItems();
	if (!src.taskBarChips || typeof src.taskBarChips !== 'object' || Array.isArray(src.taskBarChips)) {
		return defaults;
	}

	const saved = src.taskBarChips as Record<string, unknown>;
	const visibilityMap: Partial<Record<InlineTaskCompactChipKey, boolean>> = {
		priority: typeof saved.priority === 'boolean' ? saved.priority : undefined,
		status: typeof saved.status === 'boolean' ? saved.status : undefined,
		dateDue: typeof saved.dateDue === 'boolean' ? saved.dateDue : undefined,
		dateScheduled: typeof saved.dateScheduled === 'boolean' ? saved.dateScheduled : undefined,
		dateStarted: typeof saved.dateStarted === 'boolean' ? saved.dateStarted : undefined,
		assignees: typeof saved.assignees === 'boolean' ? saved.assignees : undefined,
		duration: typeof saved.duration === 'boolean' ? saved.duration : undefined,
		estimate: typeof saved.estimate === 'boolean' ? saved.estimate : undefined,
		tags: typeof saved.tags === 'boolean' ? saved.tags : undefined,
	};

	return defaults.map(item => {
		const savedVisible = (INLINE_TASK_COMPACT_CHIP_ORDER as readonly string[]).includes(item.key)
			? visibilityMap[item.key as InlineTaskCompactChipKey]
			: undefined;
		return typeof savedVisible === 'boolean'
			? { ...item, visible: savedVisible }
			: item;
	});
}

function normalizeTaskFinderCompactChips(raw: unknown, keyMappings?: readonly KeyMapping[]): InlineTaskCompactChipItem[] {
	return normalizeCompactChipItems(raw, buildDefaultTaskFinderCompactChipItems(), keyMappings).map(item => ({
		...item,
		iconOnly: false,
	}));
}

function normalizeTaskFinderDefaultScope(raw: unknown): TaskFinderDefaultScopeItem[] {
	const defaults = buildDefaultTaskFinderDefaultScopeItems();
	if (!Array.isArray(raw)) {
		return defaults;
	}

	const allowed = new Set<TaskFinderDefaultScopeKey>(TASK_FINDER_DEFAULT_SCOPE_ORDER);
	const normalized: TaskFinderDefaultScopeItem[] = [];
	const seen = new Set<TaskFinderDefaultScopeKey>();

	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const key = (item as Record<string, unknown>).key;
		const visible = (item as Record<string, unknown>).visible;
		if (typeof key !== 'string' || !allowed.has(key as TaskFinderDefaultScopeKey)) continue;
		const typedKey = key as TaskFinderDefaultScopeKey;
		if (seen.has(typedKey)) continue;
		seen.add(typedKey);
		normalized.push({
			key: typedKey,
			visible: typeof visible === 'boolean' ? visible : defaults.find(entry => entry.key === typedKey)?.visible ?? false,
		});
	}

	for (const item of defaults) {
		if (seen.has(item.key)) continue;
		normalized.push(item);
	}

	const byKey = new Map(normalized.map(item => [item.key, item] as const));
	if (byKey.get('projectTasks')?.visible && byKey.get('projectTree')?.visible) {
		byKey.get('projectTree')!.visible = false;
	}
	if (!byKey.get('includeInline')?.visible && !byKey.get('includeFile')?.visible) {
		byKey.get('includeInline')!.visible = true;
		byKey.get('includeFile')!.visible = true;
	}
	if (byKey.get('overdue')?.visible || byKey.get('happensToday')?.visible) {
		byKey.get('includeCancelled')!.visible = false;
		byKey.get('includeFinished')!.visible = false;
	}
	if (byKey.get('overdue')?.visible && byKey.get('happensToday')?.visible) {
		byKey.get('happensToday')!.visible = false;
	}

	return normalized;
}

export function normalizeTaskFinderShortcutValue(value: unknown): string {
	if (typeof value !== 'string') return '';
	const normalized = value.trim().toLocaleLowerCase();
	if (!/^[a-z0-9]{1,3}$/u.test(normalized)) return '';
	return normalized;
}

function normalizeTaskFinderShortcuts(raw: unknown): TaskFinderShortcutItem[] {
	const defaults = buildDefaultTaskFinderShortcutItems();
	if (!Array.isArray(raw)) {
		return defaults;
	}

	const allowed = new Set<TaskFinderDefaultScopeKey>(TASK_FINDER_DEFAULT_SCOPE_ORDER);
	const byKey = new Map<TaskFinderDefaultScopeKey, string>();
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const key = (item as Record<string, unknown>).key;
		if (typeof key !== 'string' || !allowed.has(key as TaskFinderDefaultScopeKey)) continue;
		const typedKey = key as TaskFinderDefaultScopeKey;
		if (byKey.has(typedKey)) continue;
		byKey.set(typedKey, normalizeTaskFinderShortcutValue((item as Record<string, unknown>).shortcut));
	}

	const used = new Set<string>();
	return TASK_FINDER_DEFAULT_SCOPE_ORDER.map(key => {
		const defaultShortcut = defaults.find(item => item.key === key)?.shortcut ?? '';
		const shortcut = byKey.has(key) ? byKey.get(key)! : defaultShortcut;
		if (!shortcut || used.has(shortcut)) return { key, shortcut: '' };
		used.add(shortcut);
		return { key, shortcut };
	});
}

function normalizeOverlayTaskCompactChips(raw: unknown, keyMappings?: readonly KeyMapping[]): InlineTaskCompactChipItem[] {
	const defaults = buildDefaultOverlayTaskCompactChipItems();
	return normalizeCompactChipItems(raw, defaults, keyMappings);
}

function insertMissingOrderedItem<T extends { key: string }>(
	items: T[],
	item: T,
	order: readonly string[],
): void {
	const targetOrderIndex = order.indexOf(item.key);
	if (targetOrderIndex < 0) {
		items.push(item);
		return;
	}
	for (let orderIndex = targetOrderIndex - 1; orderIndex >= 0; orderIndex--) {
		const previousKey = order[orderIndex];
		const existingIndex = items.findIndex(candidate => candidate.key === previousKey);
		if (existingIndex >= 0) {
			items.splice(existingIndex + 1, 0, item);
			return;
		}
	}
	items.unshift(item);
}

export function getFallbackStateIcon(
	settings: Pick<OperonSettings, 'fallbackStateIcons'>,
	checkbox: string,
): string {
	if (checkbox === 'done') return normalizeTaskIconValue(settings.fallbackStateIcons.done);
	if (checkbox === 'cancelled') return normalizeTaskIconValue(settings.fallbackStateIcons.cancelled);
	return normalizeTaskIconValue(settings.fallbackStateIcons.open);
}

export function resolveTaskDisplayIcon(
	settings: Pick<OperonSettings, 'fallbackStateIcons' | 'fallbackTaskIconSource' | 'pipelines' | 'priorities'>,
	fieldValues: Record<string, string | undefined>,
	checkbox: string,
): string {
	const taskIcon = normalizeTaskIconValue(fieldValues['taskIcon']);
	if (taskIcon) return taskIcon;

	if (settings.fallbackTaskIconSource === 'pipelineStatusIcon') {
		const pipelineStatusIcon = normalizeTaskIconValue(
			findStatusDef(settings.pipelines, fieldValues['status'] ?? '')?.pipelineStatusIcon,
		);
		if (pipelineStatusIcon) return pipelineStatusIcon;
	}

	if (settings.fallbackTaskIconSource === 'priorityIcon') {
		const priorityIcon = normalizeTaskIconValue(
			settings.priorities.find(priority => priority.label === fieldValues['priority'])?.priorityIcon,
		);
		if (priorityIcon) return priorityIcon;
	}

	return getFallbackStateIcon(settings, checkbox);
}
