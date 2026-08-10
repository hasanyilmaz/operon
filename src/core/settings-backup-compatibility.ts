import type { KeyMapping, OperonSettings } from '../types/settings';

export const SETTINGS_BACKUP_GROUP_CODEC_VERSION = 1;

export type SettingsBackupSupportClass =
	| 'portable'
	| 'vault-reference'
	| 'sensitive-opt-in'
	| 'device-local-excluded'
	| 'operational-excluded'
	| 'external-resource'
	| 'security-excluded';

export type SettingsBackupProfileGroupId =
	| 'general'
	| 'pipelines'
	| 'priorities'
	| 'system-key-mappings'
	| 'custom-keys'
	| 'filters'
	| 'calendar'
	| 'kanban'
	| 'preset-favorites'
	| 'table-global'
	| 'external-calendars';

export type SettingsBackupCompatibilityBucketId = SettingsBackupProfileGroupId | 'excluded';

export type SettingsBackupMergeStrategy = 'replace' | 'merge-by-id' | 'merge-system-overrides' | 'preserve-current';

export interface SettingsBackupGroupDefinition {
	readonly id: SettingsBackupProfileGroupId;
	readonly codecVersion: typeof SETTINGS_BACKUP_GROUP_CODEC_VERSION;
	readonly settingKeys: readonly (keyof OperonSettings)[];
	/**
	 * Reference dependencies are validation contexts, not automatic selection rules.
	 * A dependency may be satisfied by either the imported profile or the target vault.
	 */
	readonly dependencies: readonly SettingsBackupProfileGroupId[];
	readonly mergeStrategy: SettingsBackupMergeStrategy;
	readonly defaultSelected: boolean;
}

export interface SettingsBackupKeyCompatibility {
	readonly support: SettingsBackupSupportClass;
	readonly groups: readonly SettingsBackupCompatibilityBucketId[];
}

/**
 * System mappings retain the current canonical type, sync policy and internal
 * status. Only these user-owned presentation overrides are portable.
 */
export const SETTINGS_BACKUP_SYSTEM_KEY_OVERRIDE_FIELDS = [
	'visiblePropertyName',
	'hideInFileTaskView',
	'icon',
] as const satisfies readonly (keyof KeyMapping)[];

/**
 * This list intentionally names every logical setting. The type assertion below
 * makes adding an OperonSettings property without classifying it a compile error.
 */
export const ALL_OPERON_SETTINGS_BACKUP_KEYS = [
	'settingsVersion',
	'pipelines',
	'defaultPipelineName',
	'priorities',
	'defaultPriority',
	'keyMappings',
	'filterSets',
	'filterShowSubtasks',
	'filterSubtaskAutoExpandLimit',
	'filterShowOnlyOpenSubtasks',
	'dynamicFileTaskFilterEnabled',
	'dynamicFileTaskFilterPlacement',
	'dynamicFileTaskFilterSubtaskAutoExpandLimit',
	'dynamicFileTaskFilterShowOnlyOpenSubtasks',
	'dynamicSubtasksFilterSubtaskAutoExpandLimit',
	'dynamicSubtasksFilterShowOnlyOpenSubtasks',
	'language',
	'languagePackSubscriptions',
	'timeFormat',
	'demoWorkspacePromptDismissed',
	'releaseNotesShowOnUpdate',
	'releaseNotesLastShownVersion',
	'checkForUpdatesOnStartup',
	'lastNotifiedReleaseVersion',
	'operonDocsFolder',
	'operonDocsAutoUpdateEnabled',
	'operonDocsLastAutoUpdateVersion',
	'colorPalette',
	'taskCreateDebounceMs',
	'taskDescriptionRequired',
	'assigneesRequired',
	'fileTasksFolder',
	'fileTaskAutoArchiveEnabled',
	'fileTaskArchiveFolder',
	'fileTaskArchiveDelaySeconds',
	'fileTaskArchiveOnlyFromFileTasksFolder',
	'fileTaskParentInlineTargetMode',
	'fileTaskParentFileTargetMode',
	'inlineToFileTaskMovePlainCheckboxes',
	'inlineTaskSaveMode',
	'inlineTaskUseDailyNote',
	'inlineTaskTargetFile',
	'inlineTaskHeading',
	'inlineTaskParentInlineTargetMode',
	'inlineTaskParentFileTargetMode',
	'inlineTaskParentFileHeadingKeyword',
	'inlineTaskDailyNoteAddStartDate',
	'inlineTaskDailyNoteAddScheduledDate',
	'autoParentFileTask',
	'autoParentLinkedFileSubtasks',
	'childTaskInheritanceFields',
	'childTaskInheritanceStatusPipelineSource',
	'projectSerialScopes',
	'estimateAutoReallocation',
	'taskCreatorToolbar',
	'taskEditorShowLineNumbers',
	'taskEditorWorkflowPickers',
	'taskEditorMobileCoreTools',
	'inlineTaskCompactChips',
	'filterTaskCompactChips',
	'kanbanTaskCompactChips',
	'kanbanTaskShowPlayAction',
	'kanbanTaskShowPinAction',
	'kanbanTaskShowNoteAction',
	'kanbanTaskShowSubtaskAction',
	'kanbanTaskShowPlainCheckboxAction',
	'taskFinderCompactChips',
	'taskFinderDefaultScope',
	'taskFinderRememberLastScopes',
	'taskFinderSelectedProjectId',
	'taskFinderShortcuts',
	'taskFinderShowRecentModifiedOnOpen',
	'taskFinderRecentModifiedDays',
	'taskFinderVisibleResultCount',
	'taskWikilinkOverlayCompactChips',
	'taskWikilinkOverlayShowPlayAction',
	'taskWikilinkOverlayShowPinAction',
	'taskWikilinkOverlayShowNoteAction',
	'taskWikilinkOverlayShowSubtaskAction',
	'taskWikilinkOverlayShowPlainCheckboxAction',
	'inlineTaskShowPlayAction',
	'inlineTaskShowPinAction',
	'inlineTaskShowNoteAction',
	'inlineTaskShowSubtaskAction',
	'inlineTaskShowTasksEmojiConvertIcon',
	'inlineTaskShowPlainCheckboxConvertIcon',
	'filterTaskShowPlayAction',
	'filterTaskShowPinAction',
	'filterTaskShowNoteAction',
	'filterTaskShowSubtaskAction',
	'filterTaskShowPlainCheckboxAction',
	'workspaceTweaksHideScrollbars',
	'workspaceTweaksCollapseProperties',
	'workspaceTweaksPropertiesScope',
	'workspaceTweaksPropertiesExcludedFolders',
	'workspaceTweaksCompactSidebarTabIcons',
	'locationMapsAlwaysLightMode',
	'locationPlaceIconPropertyName',
	'locationPlaceColorPropertyName',
	'locationPickerMapDefaultCenter',
	'locationPickerMapDefaultZoom',
	'locationPreviewWidth',
	'locationPreviewHeight',
	'locationPreviewDefaultZoom',
	'locationPreviewMinZoom',
	'locationPreviewMaxZoom',
	'dockHoverOpenDelayMs',
	'floatingAutoCloseSec',
	'inlineRowWidth',
	'inlineRowDefaultMode',
	'inlineExpandedMetadataDensity',
	'inlineBackgroundIntensity',
	'pinnedTasksDesktopSurface',
	'pinnedTasksSidebarSide',
	'pinnedTaskSortMode',
	'pinnedTaskItemWidth',
	'pinnedDockPosition',
	'pinnedDockX',
	'pinnedDockY',
	'pinnedDockVisible',
	'pinnedDockCollapsed',
	'pinnedDockLayout',
	'pinnedDockGridCols',
	'pinnedDockDisableOnMobile',
	'mobileGlobalTaskFabEnabled',
	'mobileGlobalTaskFabHideInCalendar',
	'mobileGlobalTaskFabHideInKanban',
	'mobileGlobalTaskFabPosition',
	'pinnedDockAutoCloseEnabled',
	'pinnedDockAutoPin',
	'pinnedDockAutoUnpinFinished',
	'pinnedDockColorSource',
	'leftRailDefaultView',
	'leftRailDefaultFilterViewId',
	'leftRailMaxTabs',
	'rightRailMaxTabs',
	'leftRailViewOrder',
	'rightRailViewOrder',
	'presetFavorites',
	'calendarPresets',
	'calendarDefaultPresetId',
	'calendarWeekStart',
	'externalCalendars',
	'contextualMenuActionAllowlist',
	'contextualMenuSurfaceActionMatrix',
	'contextualMenuOpenDelayMs',
	'contextualMenuMobileEnabled',
	'contextualMenuMobileLongPressMs',
	'contextualMenuMobileTransitionGraceMs',
	'contextualMenuMobileAutoHideMs',
	'calendarInlineTaskHeading',
	'calendarShowHoverAddButton',
	'calendarShowAllDayLane',
	'calendarShowDueMarkers',
	'calendarDefaultScrollHour',
	'calendarInitialScrollMode',
	'calendarDayTitleAction',
	'calendarAutoScrollPastRatio',
	'calendarTimeGridScale',
	'calendarSidebarWidthPx',
	'calendarSidebarCalendarsDefaultExpanded',
	'calendarSidebarShowWeekNumbers',
	'calendarShowWeekLabelOnFirstDay',
	'calendarSidebarTaskPoolDefaultExpanded',
	'calendarSidebarFinishedTasksDefaultExpanded',
	'calendarTouchTimeGridTaskMoveEnabled',
	'calendarTouchDragLongPressMs',
	'calendarTouchDragCancelDistancePx',
	'calendarMobileEnabled',
	'calendarMobileMaxWidthPx',
	'calendarMobileDefaultView',
	'calendarMobileDefaultSourcePresetId',
	'calendarMobileAgendaEnabled',
	'calendarMobileDayEnabled',
	'calendarMobileTwoDayEnabled',
	'calendarMobileThreeDayEnabled',
	'calendarMobileAgendaSourcePresetId',
	'calendarMobileDaySourcePresetId',
	'calendarMobileTwoDaySourcePresetId',
	'calendarMobileThreeDaySourcePresetId',
	'calendarMobileSlotMinutes',
	'calendarMobileShowProjectedOccurrences',
	'calendarMobileShowExternalCalendars',
	'calendarMobileColorSource',
	'calendarMobileShowDueMarkers',
	'calendarMobileShowAllDayItems',
	'calendarMobileAgendaPastDays',
	'calendarMobileAgendaFutureDays',
	'calendarMobileAgendaShowCompletedItems',
	'calendarMobileAllDayVisibleTaskLimit',
	'calendarMobileShowCompletedItems',
	'kanbanPresets',
	'kanbanDefaultPresetId',
	'kanbanExpandedColumnWidthPx',
	'kanbanMaxVisibleTasksPerCell',
	'kanbanShowHoverAddButton',
	'kanbanTaskShowNotesPreview',
	'kanbanTaskShowSubtaskProgress',
	'kanbanTaskShowPlainCheckboxProgress',
	'kanbanMobileLayoutChromeEnabled',
	'kanbanMobileLayoutMaxWidthPx',
	'kanbanMobileCompactSwimlaneWidthPx',
	'kanbanMobileSwimlaneRailAlwaysVisible',
	'kanbanMobileHorizontalStatusSnapEnabled',
	'tablePresets',
	'tablePresetOrderIds',
	'tablePresetFileBindings',
	'tablePresetFileInitialized',
	'tableDefaultPresetId',
	'tableEmbedVisibleRows',
	'tableShowLineNumbers',
	'tableShowTaskIcon',
	'tableShowTaskTypeIcon',
	'indexEventDebounceMs',
	'fullReindexOnStartup',
	'duplicateAlertAutoOpenManager',
	'duplicateAlertDelaySeconds',
	'taskStatsBackfillVersion',
	'taskCreatorDefaultToFileTask',
	'taskCreatorDefaultFileTemplateId',
	'fileTaskTemplateFolder',
	'excludedFolders',
	'createDailyNotesAsOperonTask',
	'lastUsedFileTaskTemplateId',
	'defaultEstimateMinutes',
	'trackerHistoryDays',
	'trackerShowStatusBarTimer',
	'trackerSplitSessionsAtMidnight',
	'trackerTaskDescriptionClickAction',
	'flowTimeMode',
	'flowTimeSessionMinutes',
	'flowTimePauseMinutes',
	'flowTimeUseLastSelectedDuration',
	'flowTimeDefaultSessionMinutes',
	'flowTimeShowNumericTimer',
	'flowTimeNotifyOnTargetReached',
	'newOccurrencePosition',
	'fileRepeatDestination',
	'fileRepeatCustomFolder',
	'autoCompleteParentWhenAllChildrenTerminal',
	'cascadeCancelToDescendants',
	'reminderCatchUpWindowMinutes',
	'reminderNoticeDurationSeconds',
	'reminderAutoPinDueTasks',
	'reminderSystemNotificationsEnabled',
	'reminderSoundFilePath',
	'inlineExpandedTaskChips',
	'taskBarSubtasksDefaultExpanded',
	'fallbackTaskIconSource',
	'taskStatusIconColorSource',
	'fallbackStateIcons',
] as const satisfies readonly (keyof OperonSettings)[];

type DeclaredOperonSettingsBackupKey = typeof ALL_OPERON_SETTINGS_BACKUP_KEYS[number];
export type UndeclaredOperonSettingsBackupKey = Exclude<keyof OperonSettings, DeclaredOperonSettingsBackupKey>;
export const OPERON_SETTINGS_BACKUP_KEY_DECLARATION_IS_EXHAUSTIVE:
	[UndeclaredOperonSettingsBackupKey] extends [never] ? true : never = true;

const NON_PORTABLE_SUPPORT_BY_KEY = {
	settingsVersion: 'operational-excluded',
	demoWorkspacePromptDismissed: 'operational-excluded',
	releaseNotesLastShownVersion: 'operational-excluded',
	lastNotifiedReleaseVersion: 'operational-excluded',
	operonDocsLastAutoUpdateVersion: 'operational-excluded',
	taskFinderSelectedProjectId: 'vault-reference',
	pinnedDockX: 'device-local-excluded',
	pinnedDockY: 'device-local-excluded',
	pinnedDockVisible: 'device-local-excluded',
	pinnedDockCollapsed: 'device-local-excluded',
	mobileGlobalTaskFabPosition: 'device-local-excluded',
	externalCalendars: 'sensitive-opt-in',
	tablePresets: 'external-resource',
	tablePresetOrderIds: 'external-resource',
	tablePresetFileBindings: 'external-resource',
	tablePresetFileInitialized: 'external-resource',
	tableDefaultPresetId: 'external-resource',
	taskStatsBackfillVersion: 'operational-excluded',
	lastUsedFileTaskTemplateId: 'operational-excluded',
	operonDocsFolder: 'vault-reference',
	fileTasksFolder: 'vault-reference',
	fileTaskArchiveFolder: 'vault-reference',
	inlineTaskTargetFile: 'vault-reference',
	projectSerialScopes: 'vault-reference',
	workspaceTweaksPropertiesExcludedFolders: 'vault-reference',
	taskCreatorDefaultFileTemplateId: 'vault-reference',
	fileTaskTemplateFolder: 'vault-reference',
	excludedFolders: 'vault-reference',
	fileRepeatCustomFolder: 'vault-reference',
	reminderSoundFilePath: 'vault-reference',
} as const satisfies Partial<Record<keyof OperonSettings, SettingsBackupSupportClass>>;

const PIPELINE_KEYS = ['pipelines', 'defaultPipelineName'] as const satisfies readonly (keyof OperonSettings)[];
const PRIORITY_KEYS = ['priorities', 'defaultPriority'] as const satisfies readonly (keyof OperonSettings)[];
const KEY_MAPPING_KEYS = ['keyMappings'] as const satisfies readonly (keyof OperonSettings)[];
const FILTER_KEYS = ['filterSets'] as const satisfies readonly (keyof OperonSettings)[];
const FAVORITE_KEYS = ['presetFavorites'] as const satisfies readonly (keyof OperonSettings)[];
const TABLE_GLOBAL_KEYS = [
	'tableEmbedVisibleRows',
	'tableShowLineNumbers',
	'tableShowTaskIcon',
	'tableShowTaskTypeIcon',
] as const satisfies readonly (keyof OperonSettings)[];
const CALENDAR_KEYS = [
	'calendarPresets',
	'calendarDefaultPresetId',
	'calendarMobileDefaultSourcePresetId',
	'calendarMobileAgendaSourcePresetId',
	'calendarMobileDaySourcePresetId',
	'calendarMobileTwoDaySourcePresetId',
	'calendarMobileThreeDaySourcePresetId',
] as const satisfies readonly (keyof OperonSettings)[];
const KANBAN_KEYS = ['kanbanPresets', 'kanbanDefaultPresetId'] as const satisfies readonly (keyof OperonSettings)[];
const EXTERNAL_CALENDAR_KEYS = ['externalCalendars'] as const satisfies readonly (keyof OperonSettings)[];

const STRUCTURED_GROUP_KEYS = new Set<keyof OperonSettings>([
	...PIPELINE_KEYS,
	...PRIORITY_KEYS,
	...KEY_MAPPING_KEYS,
	...FILTER_KEYS,
	...CALENDAR_KEYS,
	...KANBAN_KEYS,
	...FAVORITE_KEYS,
	...TABLE_GLOBAL_KEYS,
	...EXTERNAL_CALENDAR_KEYS,
]);

function supportForKey(key: keyof OperonSettings): SettingsBackupSupportClass {
	return NON_PORTABLE_SUPPORT_BY_KEY[key as keyof typeof NON_PORTABLE_SUPPORT_BY_KEY] ?? 'portable';
}

function isExcludedSupport(support: SettingsBackupSupportClass): boolean {
	return support === 'device-local-excluded'
		|| support === 'operational-excluded'
		|| support === 'external-resource'
		|| support === 'security-excluded';
}

const EXCLUDED_KEYS = ALL_OPERON_SETTINGS_BACKUP_KEYS.filter(key => isExcludedSupport(supportForKey(key)));
const GENERAL_KEYS = ALL_OPERON_SETTINGS_BACKUP_KEYS.filter(key =>
	!STRUCTURED_GROUP_KEYS.has(key) && !EXCLUDED_KEYS.includes(key)
);

function defineGroup(
	id: SettingsBackupProfileGroupId,
	settingKeys: readonly (keyof OperonSettings)[],
	dependencies: readonly SettingsBackupProfileGroupId[],
	mergeStrategy: SettingsBackupMergeStrategy,
	options: { defaultSelected?: boolean } = {},
): SettingsBackupGroupDefinition {
	return Object.freeze({
		id,
		codecVersion: SETTINGS_BACKUP_GROUP_CODEC_VERSION,
		settingKeys: Object.freeze([...settingKeys]),
		dependencies: Object.freeze([...dependencies]),
		mergeStrategy,
		defaultSelected: options.defaultSelected ?? true,
	});
}

export const SETTINGS_BACKUP_GROUPS = [
	defineGroup('general', GENERAL_KEYS, ['pipelines', 'priorities', 'system-key-mappings', 'custom-keys', 'filters'], 'replace'),
	defineGroup('pipelines', PIPELINE_KEYS, [], 'replace'),
	defineGroup('priorities', PRIORITY_KEYS, [], 'replace'),
	defineGroup('system-key-mappings', KEY_MAPPING_KEYS, [], 'merge-system-overrides'),
	defineGroup('custom-keys', KEY_MAPPING_KEYS, ['system-key-mappings'], 'replace'),
	defineGroup('filters', FILTER_KEYS, ['system-key-mappings', 'custom-keys'], 'replace'),
	defineGroup('calendar', CALENDAR_KEYS, ['filters'], 'replace'),
	defineGroup('kanban', KANBAN_KEYS, ['pipelines', 'filters', 'system-key-mappings', 'custom-keys'], 'replace'),
	defineGroup('preset-favorites', FAVORITE_KEYS, ['filters', 'calendar', 'kanban'], 'replace'),
	defineGroup('table-global', TABLE_GLOBAL_KEYS, [], 'replace'),
	defineGroup('external-calendars', EXTERNAL_CALENDAR_KEYS, [], 'replace', { defaultSelected: false }),
] as const satisfies readonly SettingsBackupGroupDefinition[];

/** Keys that a portable profile must preserve from the target unchanged. */
export const SETTINGS_BACKUP_EXCLUDED_BUCKET = Object.freeze({
	id: 'excluded' as const,
	settingKeys: Object.freeze([...EXCLUDED_KEYS]),
	mergeStrategy: 'preserve-current' as const,
});

const GROUPS_BY_SETTING_KEY = buildGroupsBySettingKey();

export const SETTINGS_BACKUP_COMPATIBILITY_BY_KEY = Object.freeze(
	Object.fromEntries(ALL_OPERON_SETTINGS_BACKUP_KEYS.map(key => [
		key,
		Object.freeze({
			support: supportForKey(key),
			groups: Object.freeze(GROUPS_BY_SETTING_KEY.get(key) ?? []),
		}),
	])) as Record<keyof OperonSettings, SettingsBackupKeyCompatibility>,
);

function buildGroupsBySettingKey(): Map<keyof OperonSettings, SettingsBackupCompatibilityBucketId[]> {
	const groupsByKey = new Map<keyof OperonSettings, SettingsBackupCompatibilityBucketId[]>();
	for (const group of SETTINGS_BACKUP_GROUPS) {
		for (const key of group.settingKeys) {
			const groupIds = groupsByKey.get(key) ?? [];
			if (!groupIds.includes(group.id)) groupIds.push(group.id);
			groupsByKey.set(key, groupIds);
		}
	}
	for (const key of SETTINGS_BACKUP_EXCLUDED_BUCKET.settingKeys) {
		const groupIds = groupsByKey.get(key) ?? [];
		groupIds.push(SETTINGS_BACKUP_EXCLUDED_BUCKET.id);
		groupsByKey.set(key, groupIds);
	}
	return groupsByKey;
}

export function getSettingsBackupCompatibilityForKey(
	key: keyof OperonSettings,
): SettingsBackupKeyCompatibility {
	return SETTINGS_BACKUP_COMPATIBILITY_BY_KEY[key];
}

/**
 * Runtime guard for schema drift and hand-edited registries. This should run in
 * focused tests and may also be called before export/import preflight.
 */
export function assertSettingsBackupCompatibilityRegistryExhaustive(settings: OperonSettings): void {
	const declared = new Set<keyof OperonSettings>();
	for (const key of ALL_OPERON_SETTINGS_BACKUP_KEYS) {
		if (declared.has(key)) throw new Error(`Duplicate settings backup compatibility key: ${key}`);
		declared.add(key);
		if (!(key in settings)) throw new Error(`Runtime settings are missing compatibility key: ${key}`);
		const compatibility = SETTINGS_BACKUP_COMPATIBILITY_BY_KEY[key];
		if (!compatibility || compatibility.groups.length === 0) {
			throw new Error(`Unclassified settings backup compatibility key: ${key}`);
		}
	}

	for (const runtimeKey of Object.keys(settings)) {
		if (!declared.has(runtimeKey as keyof OperonSettings)) {
			throw new Error(`Missing settings backup compatibility key: ${runtimeKey}`);
		}
	}

	const groupIds = new Set<SettingsBackupProfileGroupId>();
	for (const group of SETTINGS_BACKUP_GROUPS) {
		if (groupIds.has(group.id)) throw new Error(`Duplicate settings backup group: ${group.id}`);
		groupIds.add(group.id);
	}
}
