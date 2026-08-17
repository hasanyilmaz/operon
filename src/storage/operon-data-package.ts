import type { KanbanManualOrderBoard } from './kanban-order-store';
import type { CalendarPresetStoreSettings } from './calendar-preset-store';
import type { ContextualMenuStoreSettings } from './contextual-menu-store';
import type { KanbanPresetStoreSettings } from './kanban-preset-store';
import type { TablePresetPackageSettings, TablePresetProjectionSettings } from '../types/table';
import type { PipelineStoreSettings } from './pipeline-store';
import type { PriorityStoreSettings } from './priority-store';
import type { TaskAutomationPolicyStoreSettings } from './task-automation-policy-store';
import type { TaskCreationProfileStoreSettings } from './task-creation-profile-store';
import type { TaskUiPreferenceStoreSettings } from './task-ui-preference-store';
import { buildTablePresetPackageManifest } from './table-preset-manifest';
import {
	type ExternalCalendarSource,
	type FilterSet,
	type KeyMapping,
	type OperonSettings,
	migrateSettings,
	normalizeFilterSet,
	normalizeKeyMappingCollection,
} from '../types/settings';
import { CANONICAL_KEYS } from '../types/keys';
import type { PresetFavorites } from '../core/preset-favorites';
import {
	createEmptyDeveloperApiGrantPackage,
	normalizeDeveloperApiGrantPackage,
	type DeveloperApiGrantPackageV1,
} from '../agent-runtime/developer-api/grants';

export const OPERON_DATA_PACKAGE_SCHEMA_VERSION = 2;
export const OPERON_PINNED_TASKS_PACKAGE_VERSION = 2;
export const OPERON_MOBILE_NOTIFICATIONS_INTEGRATION_VERSION = 1;
export const OPERON_PINNED_TASK_TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RETIRED_DATA_PACKAGE_SETTINGS_KEYS = [
	'calendarSidebarTaskPoolFollowPresetFilter',
	'mobileNotificationsSnapshotEnabled',
] as const;
const CANONICAL_KEY_ORDER = new Map(CANONICAL_KEYS.map((key, index) => [key.name, index]));
const LOWERCASE_UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type VersionedStoreSlice<T> = T & {
	version: number;
};

export type WorkspaceTweaksPackageSettings = Pick<
	OperonSettings,
	| 'workspaceTweaksHideScrollbars'
	| 'workspaceTweaksCollapseProperties'
	| 'workspaceTweaksPropertiesScope'
	| 'workspaceTweaksPropertiesExcludedFolders'
	| 'workspaceTweaksCompactSidebarTabIcons'
>;

export type OperonDataPackageOwnedSettingsKey =
	| 'keyMappings'
	| 'filterSets'
	| 'externalCalendars'
	| keyof PipelineStoreSettings
	| keyof PriorityStoreSettings
	| keyof CalendarPresetStoreSettings
	| keyof KanbanPresetStoreSettings
	| keyof TablePresetProjectionSettings
	| keyof ContextualMenuStoreSettings
	| keyof TaskUiPreferenceStoreSettings
	| keyof TaskCreationProfileStoreSettings
	| keyof WorkspaceTweaksPackageSettings
	| 'presetFavorites'
	| keyof TaskAutomationPolicyStoreSettings;

export const OPERON_DATA_PACKAGE_OWNED_SETTINGS_KEYS = [
	'keyMappings',
	'filterSets',
	'externalCalendars',
	'pipelines',
	'defaultPipelineName',
	'priorities',
	'defaultPriority',
	'calendarPresets',
	'calendarDefaultPresetId',
	'kanbanPresets',
	'kanbanDefaultPresetId',
	'tablePresets',
	'tablePresetOrderIds',
	'tablePresetFileBindings',
	'tablePresetFileInitialized',
	'tableDefaultPresetId',
	'tableDefaultFolder',
	'tableEmbedVisibleRows',
	'tableEmbedDefaultWidthPercent',
	'tableShowLineNumbers',
	'tableShowTaskIcon',
	'tableShowTaskTypeIcon',
	'presetFavorites',
	'contextualMenuActionAllowlist',
	'contextualMenuSurfaceActionMatrix',
	'contextualMenuOpenDelayMs',
	'contextualMenuMobileEnabled',
	'contextualMenuMobileLongPressMs',
	'contextualMenuMobileTransitionGraceMs',
	'contextualMenuMobileAutoHideMs',
	'taskCreatorToolbar',
	'taskEditorShowLineNumbers',
	'taskEditorWorkflowPickers',
	'taskEditorMobileCoreTools',
	'inlineExpandedTaskChips',
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
	'taskDescriptionRequired',
	'assigneesRequired',
	'fileTasksFolder',
	'inlineTaskSaveMode',
	'inlineTaskUseDailyNote',
	'inlineTaskTargetFile',
	'inlineTaskHeading',
	'fileTaskParentInlineTargetMode',
	'fileTaskParentFileTargetMode',
	'inlineToFileTaskMovePlainCheckboxes',
	'inlineTaskParentInlineTargetMode',
	'inlineTaskParentFileTargetMode',
	'inlineTaskParentFileHeadingKeyword',
	'inlineTaskDailyNoteAddStartDate',
	'inlineTaskDailyNoteAddScheduledDate',
	'calendarInlineTaskHeading',
	'autoParentFileTask',
	'autoParentLinkedFileSubtasks',
	'childTaskInheritanceFields',
	'childTaskInheritanceStatusPipelineSource',
	'taskCreatorDefaultToFileTask',
	'taskCreatorDefaultFileTemplateId',
	'fileTaskTemplateFolder',
	'createDailyNotesAsOperonTask',
	'defaultEstimateMinutes',
	'autoCompleteParentWhenAllChildrenTerminal',
	'cascadeCancelToDescendants',
	'newOccurrencePosition',
	'fileTaskAutoArchiveEnabled',
	'fileTaskArchiveFolder',
	'fileTaskArchiveDelaySeconds',
	'fileTaskArchiveOnlyFromFileTasksFolder',
	'fileRepeatDestination',
	'fileRepeatCustomFolder',
	'estimateAutoReallocation',
	'trackerSplitSessionsAtMidnight',
	'reminderCatchUpWindowMinutes',
	'reminderNoticeDurationSeconds',
	'reminderAutoPinDueTasks',
	'reminderSystemNotificationsEnabled',
	'reminderSoundFilePath',
] as const satisfies readonly OperonDataPackageOwnedSettingsKey[];

const TASK_UI_PREFERENCE_PACKAGE_KEYS = [
	'taskCreatorToolbar',
	'taskEditorShowLineNumbers',
	'taskEditorWorkflowPickers',
	'taskEditorMobileCoreTools',
	'inlineExpandedTaskChips',
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
	'filterTaskShowPlayAction',
	'filterTaskShowPinAction',
	'filterTaskShowNoteAction',
	'filterTaskShowSubtaskAction',
	'filterTaskShowPlainCheckboxAction',
] as const satisfies readonly (keyof TaskUiPreferenceStoreSettings)[];

export type OperonDataPackageSettings = Omit<
	OperonSettings,
	OperonDataPackageOwnedSettingsKey
>;

export interface OperonKeyMappingsPackageV1 {
	version: number;
	system: KeyMapping[];
	custom: KeyMapping[];
}

export interface OperonFiltersPackageV1 {
	version: number;
	filterIds: string[];
	itemsById: Record<string, FilterSet>;
}

export interface OperonKanbanOrderPackageV1 {
	version: number;
	boards: Record<string, KanbanManualOrderBoard>;
}

export interface OperonExternalCalendarSourcesPackageV1 {
	version: number;
	sources: ExternalCalendarSource[];
}

export interface OperonMobileNotificationsIntegrationV1 {
	version: typeof OPERON_MOBILE_NOTIFICATIONS_INTEGRATION_VERSION;
	snapshotEnabled: boolean;
	cancelPending: boolean;
	vaultId: string | null;
	lastGeneratedAtEpochMs: number | null;
}

export interface OperonMobileNotificationsIntegrationAdoption {
	vaultId?: string | null;
}

export interface OperonPinnedTaskPackageEntry {
	pinned: boolean;
	updatedAt: string;
}

export interface OperonPinnedTaskManualOrder {
	operonIds: string[];
	updatedAt: string;
}

export interface OperonPinnedTasksPackageV1 {
	version: number;
	itemsById: Record<string, OperonPinnedTaskPackageEntry>;
	manualOrder?: OperonPinnedTaskManualOrder;
}

export interface OperonTaxonomyPackageV1 {
	keyMappings: OperonKeyMappingsPackageV1;
	priorities: VersionedStoreSlice<PriorityStoreSettings>;
	pipelines: VersionedStoreSlice<PipelineStoreSettings>;
}

export interface OperonViewsPackageV1 {
	filters: OperonFiltersPackageV1;
	calendarPresets: VersionedStoreSlice<CalendarPresetStoreSettings>;
	kanbanPresets: VersionedStoreSlice<KanbanPresetStoreSettings>;
	tablePresets: VersionedStoreSlice<TablePresetPackageSettings>;
	kanbanOrder: OperonKanbanOrderPackageV1;
}

export interface OperonUiPackageV1 {
	contextualMenu: VersionedStoreSlice<ContextualMenuStoreSettings>;
	taskUiPreferences: VersionedStoreSlice<TaskUiPreferenceStoreSettings>;
	taskCreationProfile: VersionedStoreSlice<TaskCreationProfileStoreSettings>;
	workspaceTweaks: VersionedStoreSlice<WorkspaceTweaksPackageSettings>;
	presetFavorites?: VersionedStoreSlice<PresetFavorites>;
}

export interface OperonAutomationPackageV1 {
	taskAutomationPolicy: VersionedStoreSlice<TaskAutomationPolicyStoreSettings>;
}

export interface OperonIntegrationsPackageV1 {
	externalCalendarSources: OperonExternalCalendarSourcesPackageV1;
	mobileNotifications: OperonMobileNotificationsIntegrationV1;
	developerApi: DeveloperApiGrantPackageV1;
}

export interface OperonStatePackageV1 {
	pinnedTasks: OperonPinnedTasksPackageV1;
}

export interface OperonDataPackageV1 {
	schemaVersion: typeof OPERON_DATA_PACKAGE_SCHEMA_VERSION;
	settings: OperonDataPackageSettings;
	taxonomy: OperonTaxonomyPackageV1;
	views: OperonViewsPackageV1;
	ui: OperonUiPackageV1;
	automation: OperonAutomationPackageV1;
	integrations: OperonIntegrationsPackageV1;
	state: OperonStatePackageV1;
}

export interface BuildOperonDataPackageOptions {
	filterSets?: FilterSet[];
	kanbanOrderBoards?: Record<string, KanbanManualOrderBoard>;
	pinnedTasks?: OperonPinnedTasksPackageV1;
	developerApiGrants?: DeveloperApiGrantPackageV1;
}

export function composeOperonSettingsFromDataPackage(
	dataPackage: OperonDataPackageV1,
	defaults: OperonSettings,
): OperonSettings {
	const packageSettings = cloneUnknown<Partial<OperonSettings>>(dataPackage.settings);
	const keyMappings = [
		...readArray(dataPackage.taxonomy.keyMappings.system, []),
		...readArray(dataPackage.taxonomy.keyMappings.custom, []),
	].filter(isKeyMapping);
	const filterSets = dataPackage.views.filters.filterIds
		.map(filterId => dataPackage.views.filters.itemsById[filterId])
		.map(filterSet => normalizeFilterSet(filterSet))
		.filter((filterSet): filterSet is FilterSet => !!filterSet);
	const tablePresetPackage = dataPackage.views.tablePresets;
	const hasFileBackedTablePresetAuthority = readArray(tablePresetPackage?.fileBindings, []).length > 0
		|| readNumber(tablePresetPackage?.version, 0) >= 3
		|| tablePresetPackage?.initialized === true;
	return migrateSettings({
		...defaults,
		...packageSettings,
		keyMappings: keyMappings.length > 0 ? keyMappings : defaults.keyMappings,
		filterSets,
		priorities: readArray(dataPackage.taxonomy.priorities.priorities, defaults.priorities),
		defaultPriority: readString(dataPackage.taxonomy.priorities.defaultPriority, defaults.defaultPriority),
		pipelines: readArray(dataPackage.taxonomy.pipelines.pipelines, defaults.pipelines),
		defaultPipelineName: readString(dataPackage.taxonomy.pipelines.defaultPipelineName, defaults.defaultPipelineName),
		calendarPresets: readArray(dataPackage.views.calendarPresets.calendarPresets, defaults.calendarPresets),
		calendarDefaultPresetId: readNullableString(
			dataPackage.views.calendarPresets.calendarDefaultPresetId,
			defaults.calendarDefaultPresetId,
		),
		kanbanPresets: readArray(dataPackage.views.kanbanPresets.kanbanPresets, defaults.kanbanPresets),
		kanbanDefaultPresetId: readNullableString(
			dataPackage.views.kanbanPresets.kanbanDefaultPresetId,
			defaults.kanbanDefaultPresetId,
		),
		tablePresets: [],
		tablePresetOrderIds: readArray(
			dataPackage.views.tablePresets?.presetIds,
			[],
		),
		tablePresetFileBindings: readArray(
			dataPackage.views.tablePresets?.fileBindings,
			defaults.tablePresetFileBindings,
		),
		tablePresetFileInitialized: typeof tablePresetPackage?.initialized === 'boolean'
			? tablePresetPackage.initialized
			: hasFileBackedTablePresetAuthority,
		tableDefaultPresetId: readNullableString(
			dataPackage.views.tablePresets?.tableDefaultPresetId,
			defaults.tableDefaultPresetId,
		),
		tableDefaultFolder: readString(
			dataPackage.views.tablePresets?.tableDefaultFolder,
			defaults.tableDefaultFolder,
		),
		tableEmbedVisibleRows: readNumber(
			dataPackage.views.tablePresets?.tableEmbedVisibleRows,
			defaults.tableEmbedVisibleRows,
		),
		tableEmbedDefaultWidthPercent: readNumber(
			dataPackage.views.tablePresets?.tableEmbedDefaultWidthPercent,
			defaults.tableEmbedDefaultWidthPercent,
		),
		tableShowLineNumbers: readBoolean(
			dataPackage.views.tablePresets?.tableShowLineNumbers,
			defaults.tableShowLineNumbers,
		),
		tableShowTaskIcon: readBoolean(
			dataPackage.views.tablePresets?.tableShowTaskIcon,
			defaults.tableShowTaskIcon,
		),
		tableShowTaskTypeIcon: readBoolean(
			dataPackage.views.tablePresets?.tableShowTaskTypeIcon,
			defaults.tableShowTaskTypeIcon,
		),
		contextualMenuActionAllowlist: readArray(
			dataPackage.ui.contextualMenu.contextualMenuActionAllowlist,
			defaults.contextualMenuActionAllowlist,
		),
		contextualMenuSurfaceActionMatrix: isRecord(dataPackage.ui.contextualMenu.contextualMenuSurfaceActionMatrix)
			? cloneUnknown(dataPackage.ui.contextualMenu.contextualMenuSurfaceActionMatrix)
			: defaults.contextualMenuSurfaceActionMatrix,
		contextualMenuOpenDelayMs: readNumber(
			dataPackage.ui.contextualMenu.contextualMenuOpenDelayMs,
			defaults.contextualMenuOpenDelayMs,
		),
		contextualMenuMobileEnabled: readBoolean(
			dataPackage.ui.contextualMenu.contextualMenuMobileEnabled,
			defaults.contextualMenuMobileEnabled,
		),
		contextualMenuMobileLongPressMs: readNumber(
			dataPackage.ui.contextualMenu.contextualMenuMobileLongPressMs,
			defaults.contextualMenuMobileLongPressMs,
		),
		contextualMenuMobileTransitionGraceMs: readNumber(
			dataPackage.ui.contextualMenu.contextualMenuMobileTransitionGraceMs,
			defaults.contextualMenuMobileTransitionGraceMs,
		),
		contextualMenuMobileAutoHideMs: readNumber(
			dataPackage.ui.contextualMenu.contextualMenuMobileAutoHideMs,
			defaults.contextualMenuMobileAutoHideMs,
		),
		...cloneUnknown<Partial<OperonSettings>>(dataPackage.ui.taskUiPreferences),
		...cloneUnknown<Partial<OperonSettings>>(dataPackage.ui.taskCreationProfile),
		...cloneUnknown<Partial<OperonSettings>>(dataPackage.ui.workspaceTweaks),
		presetFavorites: isRecord(dataPackage.ui.presetFavorites)
			? cloneUnknown(dataPackage.ui.presetFavorites)
			: undefined,
		...cloneUnknown<Partial<OperonSettings>>(dataPackage.automation.taskAutomationPolicy),
		externalCalendars: readArray(dataPackage.integrations.externalCalendarSources.sources, defaults.externalCalendars),
	});
}

export function isUnsupportedTablePresetPackage(dataPackage: Partial<OperonDataPackageV1>): boolean {
	const tablePackage = dataPackage.views?.tablePresets;
	const version = readNumber(tablePackage?.version, 0);
	if (version === 3) return false;
	if (version > 3) return true;
	if (readArray(tablePackage?.fileBindings, []).length > 0) return false;
	return true;
}

export function buildOperonDataPackageFromSettings(
	settings: OperonSettings,
	options: BuildOperonDataPackageOptions = {},
): OperonDataPackageV1 {
	const normalized = migrateSettings(settings);
	const filterSets = options.filterSets ?? normalized.filterSets;
	const filters = buildFiltersPackage(filterSets);
	const keyMappings = splitKeyMappings(normalized.keyMappings);
	return {
		schemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
		settings: buildSettingsPackage(normalized),
		taxonomy: {
			keyMappings,
			priorities: {
				version: 1,
				priorities: cloneUnknown(normalized.priorities),
				defaultPriority: normalized.defaultPriority,
			},
			pipelines: {
				version: 1,
				pipelines: cloneUnknown(normalized.pipelines),
				defaultPipelineName: normalized.defaultPipelineName,
			},
		},
		views: {
			filters,
			calendarPresets: {
				version: 1,
				calendarPresets: cloneUnknown(normalized.calendarPresets),
				calendarDefaultPresetId: normalized.calendarDefaultPresetId,
			},
			kanbanPresets: {
				version: 1,
				kanbanPresets: cloneUnknown(normalized.kanbanPresets),
				kanbanDefaultPresetId: normalized.kanbanDefaultPresetId,
			},
			tablePresets: {
				...buildTablePresetPackageManifest(normalized),
			},
			kanbanOrder: {
				version: 1,
				boards: cloneUnknown(options.kanbanOrderBoards ?? {}),
			},
		},
		ui: {
			contextualMenu: {
				version: 1,
				contextualMenuActionAllowlist: cloneUnknown(normalized.contextualMenuActionAllowlist),
				contextualMenuSurfaceActionMatrix: cloneUnknown(normalized.contextualMenuSurfaceActionMatrix),
				contextualMenuOpenDelayMs: normalized.contextualMenuOpenDelayMs,
				contextualMenuMobileEnabled: normalized.contextualMenuMobileEnabled,
				contextualMenuMobileLongPressMs: normalized.contextualMenuMobileLongPressMs,
				contextualMenuMobileTransitionGraceMs: normalized.contextualMenuMobileTransitionGraceMs,
				contextualMenuMobileAutoHideMs: normalized.contextualMenuMobileAutoHideMs,
			},
			taskUiPreferences: {
				version: 1,
				taskCreatorToolbar: cloneUnknown(normalized.taskCreatorToolbar),
				taskEditorShowLineNumbers: normalized.taskEditorShowLineNumbers,
				taskEditorWorkflowPickers: cloneUnknown(normalized.taskEditorWorkflowPickers),
				taskEditorMobileCoreTools: cloneUnknown(normalized.taskEditorMobileCoreTools),
				inlineExpandedTaskChips: cloneUnknown(normalized.inlineExpandedTaskChips),
				inlineTaskCompactChips: cloneUnknown(normalized.inlineTaskCompactChips),
				filterTaskCompactChips: cloneUnknown(normalized.filterTaskCompactChips),
				kanbanTaskCompactChips: cloneUnknown(normalized.kanbanTaskCompactChips),
				kanbanTaskShowPlayAction: normalized.kanbanTaskShowPlayAction,
				kanbanTaskShowPinAction: normalized.kanbanTaskShowPinAction,
				kanbanTaskShowNoteAction: normalized.kanbanTaskShowNoteAction,
				kanbanTaskShowSubtaskAction: normalized.kanbanTaskShowSubtaskAction,
				kanbanTaskShowPlainCheckboxAction: normalized.kanbanTaskShowPlainCheckboxAction,
				taskFinderCompactChips: cloneUnknown(normalized.taskFinderCompactChips),
				taskFinderDefaultScope: normalized.taskFinderDefaultScope,
				taskFinderRememberLastScopes: normalized.taskFinderRememberLastScopes,
				taskFinderSelectedProjectId: normalized.taskFinderSelectedProjectId,
				taskFinderShortcuts: cloneUnknown(normalized.taskFinderShortcuts),
				taskWikilinkOverlayCompactChips: cloneUnknown(normalized.taskWikilinkOverlayCompactChips),
				taskWikilinkOverlayShowPlayAction: normalized.taskWikilinkOverlayShowPlayAction,
				taskWikilinkOverlayShowPinAction: normalized.taskWikilinkOverlayShowPinAction,
				taskWikilinkOverlayShowNoteAction: normalized.taskWikilinkOverlayShowNoteAction,
				taskWikilinkOverlayShowSubtaskAction: normalized.taskWikilinkOverlayShowSubtaskAction,
				taskWikilinkOverlayShowPlainCheckboxAction: normalized.taskWikilinkOverlayShowPlainCheckboxAction,
				inlineTaskShowPlayAction: normalized.inlineTaskShowPlayAction,
				inlineTaskShowPinAction: normalized.inlineTaskShowPinAction,
				inlineTaskShowNoteAction: normalized.inlineTaskShowNoteAction,
				inlineTaskShowSubtaskAction: normalized.inlineTaskShowSubtaskAction,
				filterTaskShowPlayAction: normalized.filterTaskShowPlayAction,
				filterTaskShowPinAction: normalized.filterTaskShowPinAction,
				filterTaskShowNoteAction: normalized.filterTaskShowNoteAction,
				filterTaskShowSubtaskAction: normalized.filterTaskShowSubtaskAction,
				filterTaskShowPlainCheckboxAction: normalized.filterTaskShowPlainCheckboxAction,
			},
			taskCreationProfile: {
				version: 1,
				taskDescriptionRequired: normalized.taskDescriptionRequired,
				assigneesRequired: normalized.assigneesRequired,
				fileTasksFolder: normalized.fileTasksFolder,
				inlineTaskSaveMode: normalized.inlineTaskSaveMode,
				inlineTaskUseDailyNote: normalized.inlineTaskUseDailyNote,
				inlineTaskTargetFile: normalized.inlineTaskTargetFile,
				inlineTaskHeading: normalized.inlineTaskHeading,
				fileTaskParentInlineTargetMode: normalized.fileTaskParentInlineTargetMode,
				fileTaskParentFileTargetMode: normalized.fileTaskParentFileTargetMode,
				inlineToFileTaskMovePlainCheckboxes: normalized.inlineToFileTaskMovePlainCheckboxes,
				inlineTaskParentInlineTargetMode: normalized.inlineTaskParentInlineTargetMode,
				inlineTaskParentFileTargetMode: normalized.inlineTaskParentFileTargetMode,
				inlineTaskParentFileHeadingKeyword: normalized.inlineTaskParentFileHeadingKeyword,
				inlineTaskDailyNoteAddStartDate: normalized.inlineTaskDailyNoteAddStartDate,
				inlineTaskDailyNoteAddScheduledDate: normalized.inlineTaskDailyNoteAddScheduledDate,
				calendarInlineTaskHeading: normalized.calendarInlineTaskHeading,
				autoParentFileTask: normalized.autoParentFileTask,
				autoParentLinkedFileSubtasks: normalized.autoParentLinkedFileSubtasks,
				childTaskInheritanceFields: [...normalized.childTaskInheritanceFields],
				childTaskInheritanceStatusPipelineSource: normalized.childTaskInheritanceStatusPipelineSource,
				taskCreatorDefaultToFileTask: normalized.taskCreatorDefaultToFileTask,
				taskCreatorDefaultFileTemplateId: normalized.taskCreatorDefaultFileTemplateId,
				fileTaskTemplateFolder: normalized.fileTaskTemplateFolder,
				createDailyNotesAsOperonTask: normalized.createDailyNotesAsOperonTask,
				defaultEstimateMinutes: normalized.defaultEstimateMinutes,
			},
			workspaceTweaks: {
				version: 1,
				workspaceTweaksHideScrollbars: normalized.workspaceTweaksHideScrollbars,
				workspaceTweaksCollapseProperties: normalized.workspaceTweaksCollapseProperties,
				workspaceTweaksPropertiesScope: normalized.workspaceTweaksPropertiesScope,
				workspaceTweaksPropertiesExcludedFolders: cloneUnknown(normalized.workspaceTweaksPropertiesExcludedFolders),
				workspaceTweaksCompactSidebarTabIcons: normalized.workspaceTweaksCompactSidebarTabIcons,
			},
			presetFavorites: {
				version: 1,
				...cloneUnknown<PresetFavorites>(normalized.presetFavorites),
			},
		},
		automation: {
			taskAutomationPolicy: {
				version: 1,
				autoCompleteParentWhenAllChildrenTerminal: normalized.autoCompleteParentWhenAllChildrenTerminal,
				cascadeCancelToDescendants: normalized.cascadeCancelToDescendants,
				newOccurrencePosition: normalized.newOccurrencePosition,
				fileTaskAutoArchiveEnabled: normalized.fileTaskAutoArchiveEnabled,
				fileTaskArchiveFolder: normalized.fileTaskArchiveFolder,
				fileTaskArchiveDelaySeconds: normalized.fileTaskArchiveDelaySeconds,
				fileTaskArchiveOnlyFromFileTasksFolder: normalized.fileTaskArchiveOnlyFromFileTasksFolder,
				fileRepeatDestination: normalized.fileRepeatDestination,
				fileRepeatCustomFolder: normalized.fileRepeatCustomFolder,
				estimateAutoReallocation: false,
				trackerSplitSessionsAtMidnight: normalized.trackerSplitSessionsAtMidnight,
				reminderCatchUpWindowMinutes: normalized.reminderCatchUpWindowMinutes,
				reminderNoticeDurationSeconds: normalized.reminderNoticeDurationSeconds,
				reminderAutoPinDueTasks: normalized.reminderAutoPinDueTasks,
				reminderSystemNotificationsEnabled: normalized.reminderSystemNotificationsEnabled,
				reminderSoundFilePath: normalized.reminderSoundFilePath,
			},
		},
		integrations: {
			externalCalendarSources: {
				version: 1,
				sources: cloneUnknown(normalized.externalCalendars),
			},
			mobileNotifications: {
				version: OPERON_MOBILE_NOTIFICATIONS_INTEGRATION_VERSION,
				snapshotEnabled: true,
				cancelPending: false,
				vaultId: null,
				lastGeneratedAtEpochMs: null,
			},
			developerApi: normalizeDeveloperApiGrantPackage(
				options.developerApiGrants ?? createEmptyDeveloperApiGrantPackage(),
			),
		},
		state: {
			pinnedTasks: normalizePinnedTasksPackage(options.pinnedTasks),
		},
	};
}

export function mergeOperonDataPackage(
	existing: Partial<OperonDataPackageV1> | null | undefined,
	fallback: OperonDataPackageV1,
): OperonDataPackageV1 {
	const ui = mergeUiPackage(existing?.ui, fallback.ui, existing?.settings);
	if (existing && (!isRecord(existing.ui) || !isRecord(existing.ui.presetFavorites))) {
		delete ui.presetFavorites;
	}
	return {
		schemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
		settings: cloneSettingsPackageWithoutRetiredKeys(existing?.settings, fallback.settings),
		taxonomy: mergeTaxonomyPackage(existing?.taxonomy, fallback.taxonomy),
		views: cloneExistingDomain(existing?.views, fallback.views, isViewsDomain),
		ui,
		automation: cloneExistingDomain(existing?.automation, fallback.automation, isAutomationDomain),
		integrations: mergeIntegrationsPackage(existing?.integrations, fallback.integrations),
		state: buildStatePackage(existing?.state, fallback.state),
	};
}

export function hasRetiredOperonDataPackageSettings(
	dataPackage: Partial<OperonDataPackageV1> | null | undefined,
): boolean {
	if (!isRecord(dataPackage?.settings)) return false;
	return RETIRED_DATA_PACKAGE_SETTINGS_KEYS.some(key => Object.prototype.hasOwnProperty.call(dataPackage.settings, key));
}

export function removeRetiredOperonDataPackageSettings<T>(settings: T): T {
	const cleaned = cloneUnknown<T>(settings);
	if (!isRecord(cleaned)) return cleaned;
	for (const key of RETIRED_DATA_PACKAGE_SETTINGS_KEYS) delete cleaned[key];
	return cleaned;
}

export function createEmptyPinnedTasksPackage(): OperonPinnedTasksPackageV1 {
	return {
		version: OPERON_PINNED_TASKS_PACKAGE_VERSION,
		itemsById: {},
	};
}

export function createPinnedTasksPackageFromIds(
	operonIds: Iterable<string>,
	updatedAt: string,
): OperonPinnedTasksPackageV1 {
	const itemsById: Record<string, OperonPinnedTaskPackageEntry> = {};
	for (const rawId of operonIds) {
		const operonId = rawId.trim();
		if (!operonId) continue;
		itemsById[operonId] = { pinned: true, updatedAt };
	}
	return {
		version: OPERON_PINNED_TASKS_PACKAGE_VERSION,
		itemsById: sortPinnedTaskEntries(itemsById),
	};
}

export function hasPinnedTasksPackage(value: unknown): boolean {
	return isRecord(value)
		&& isRecord(value.state)
		&& isRecord(value.state.pinnedTasks);
}

export function normalizePinnedTasksPackage(value: unknown): OperonPinnedTasksPackageV1 {
	if (!isRecord(value) || !isRecord(value.itemsById)) {
		return createEmptyPinnedTasksPackage();
	}
	const itemsById: Record<string, OperonPinnedTaskPackageEntry> = {};
	for (const [rawId, rawEntry] of Object.entries(value.itemsById)) {
		const operonId = rawId.trim();
		if (!operonId || !isRecord(rawEntry) || typeof rawEntry.pinned !== 'boolean') continue;
		itemsById[operonId] = {
			pinned: rawEntry.pinned,
			updatedAt: typeof rawEntry.updatedAt === 'string' ? rawEntry.updatedAt : '',
		};
	}
	const manualOrder = normalizePinnedTaskManualOrder(value.manualOrder);
	return {
		version: OPERON_PINNED_TASKS_PACKAGE_VERSION,
		itemsById: sortPinnedTaskEntries(itemsById),
		...(manualOrder ? { manualOrder } : {}),
	};
}

export function mergePinnedTasksPackages(
	primary: unknown,
	fallback: unknown,
): OperonPinnedTasksPackageV1 {
	const primaryPackage = normalizePinnedTasksPackage(primary);
	const fallbackPackage = normalizePinnedTasksPackage(fallback);
	const itemsById: Record<string, OperonPinnedTaskPackageEntry> = {
		...fallbackPackage.itemsById,
	};
	for (const [operonId, primaryEntry] of Object.entries(primaryPackage.itemsById)) {
		const fallbackEntry = itemsById[operonId];
		itemsById[operonId] = pickNewerPinnedTaskEntry(primaryEntry, fallbackEntry);
	}
	const manualOrder = pickNewerPinnedTaskManualOrder(
		primaryPackage.manualOrder,
		fallbackPackage.manualOrder,
	);
	return {
		version: OPERON_PINNED_TASKS_PACKAGE_VERSION,
		itemsById: sortPinnedTaskEntries(itemsById),
		...(manualOrder ? { manualOrder } : {}),
	};
}

export function prunePinnedTaskTombstones(
	value: unknown,
	nowIso: string,
	retentionMs: number,
): OperonPinnedTasksPackageV1 {
	const data = normalizePinnedTasksPackage(value);
	const cutoffMs = Date.parse(nowIso) - retentionMs;
	const itemsById: Record<string, OperonPinnedTaskPackageEntry> = {};
	for (const [operonId, entry] of Object.entries(data.itemsById)) {
		if (!entry.pinned) {
			const entryMs = parsePinnedTaskTimestamp(entry.updatedAt);
			if (entryMs <= cutoffMs) continue;
		}
		itemsById[operonId] = entry;
	}
	return {
		version: OPERON_PINNED_TASKS_PACKAGE_VERSION,
		itemsById: sortPinnedTaskEntries(itemsById),
		...(data.manualOrder ? { manualOrder: clonePinnedTaskManualOrder(data.manualOrder) } : {}),
	};
}

function normalizePinnedTaskManualOrder(value: unknown): OperonPinnedTaskManualOrder | undefined {
	if (!isRecord(value) || !Array.isArray(value.operonIds)) return undefined;
	if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return undefined;
	const seen = new Set<string>();
	const operonIds: string[] = [];
	for (const rawId of value.operonIds) {
		if (typeof rawId !== 'string') continue;
		const operonId = rawId.trim();
		if (!operonId || seen.has(operonId)) continue;
		seen.add(operonId);
		operonIds.push(operonId);
	}
	return {
		operonIds,
		updatedAt: value.updatedAt,
	};
}

function pickNewerPinnedTaskManualOrder(
	primary: OperonPinnedTaskManualOrder | undefined,
	fallback: OperonPinnedTaskManualOrder | undefined,
): OperonPinnedTaskManualOrder | undefined {
	if (!primary) return fallback ? clonePinnedTaskManualOrder(fallback) : undefined;
	if (!fallback) return clonePinnedTaskManualOrder(primary);
	const primaryMs = parsePinnedTaskTimestamp(primary.updatedAt);
	const fallbackMs = parsePinnedTaskTimestamp(fallback.updatedAt);
	if (primaryMs > fallbackMs) return clonePinnedTaskManualOrder(primary);
	if (fallbackMs > primaryMs) return clonePinnedTaskManualOrder(fallback);

	// Equal timestamps must converge independently of merge direction. The
	// canonical sequence signature provides a deterministic final tie-break.
	const primarySignature = JSON.stringify(primary.operonIds);
	const fallbackSignature = JSON.stringify(fallback.operonIds);
	return clonePinnedTaskManualOrder(
		primarySignature >= fallbackSignature ? primary : fallback,
	);
}

function clonePinnedTaskManualOrder(
	manualOrder: OperonPinnedTaskManualOrder,
): OperonPinnedTaskManualOrder {
	return {
		operonIds: [...manualOrder.operonIds],
		updatedAt: manualOrder.updatedAt,
	};
}

function pickNewerPinnedTaskEntry(
	primary: OperonPinnedTaskPackageEntry,
	fallback: OperonPinnedTaskPackageEntry | undefined,
): OperonPinnedTaskPackageEntry {
	if (!fallback) return { ...primary };
	const primaryMs = parsePinnedTaskTimestamp(primary.updatedAt);
	const fallbackMs = parsePinnedTaskTimestamp(fallback.updatedAt);
	if (primaryMs > fallbackMs) return { ...primary };
	if (fallbackMs > primaryMs) return { ...fallback };
	if (primary.pinned && !fallback.pinned) return { ...primary };
	if (fallback.pinned && !primary.pinned) return { ...fallback };
	return { ...primary };
}

function parsePinnedTaskTimestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sortPinnedTaskEntries(
	itemsById: Record<string, OperonPinnedTaskPackageEntry>,
): Record<string, OperonPinnedTaskPackageEntry> {
	const sorted: Record<string, OperonPinnedTaskPackageEntry> = {};
	for (const operonId of Object.keys(itemsById).sort((left, right) => left.localeCompare(right))) {
		sorted[operonId] = {
			pinned: itemsById[operonId].pinned,
			updatedAt: itemsById[operonId].updatedAt,
		};
	}
	return sorted;
}

function buildSettingsPackage(settings: OperonSettings): OperonDataPackageSettings {
	const packageSettings = { ...settings } as Partial<OperonSettings>;
	for (const key of OPERON_DATA_PACKAGE_OWNED_SETTINGS_KEYS) {
		delete packageSettings[key];
	}
	delete (packageSettings as Record<string, unknown>).taskBarChips;
	delete (packageSettings as Record<string, unknown>).draftDiscardIfEmpty;
	delete (packageSettings as Record<string, unknown>).inlineParentDefaultExpanded;
	delete (packageSettings as Record<string, unknown>).inlineQuickActionsEnabled;
	delete (packageSettings as Record<string, unknown>).inlineQuickActionAllowlist;
	delete (packageSettings as Record<string, unknown>).agentAllowlistFields;
	delete (packageSettings as Record<string, unknown>).agentDenylistFields;
	delete (packageSettings as Record<string, unknown>).agentExportFormat;
	return packageSettings as OperonDataPackageSettings;
}

function buildFiltersPackage(filterSets: FilterSet[]): OperonFiltersPackageV1 {
	const filterIds: string[] = [];
	const itemsById: Record<string, FilterSet> = {};
	for (const rawFilterSet of filterSets) {
		const filterSet = normalizeFilterSet(rawFilterSet);
		if (!filterSet || itemsById[filterSet.id]) continue;
		filterIds.push(filterSet.id);
		itemsById[filterSet.id] = cloneUnknown(filterSet);
	}
	return {
		version: 1,
		filterIds,
		itemsById,
	};
}

function splitKeyMappings(keyMappings: KeyMapping[]): OperonKeyMappingsPackageV1 {
	const system: KeyMapping[] = [];
	const custom: KeyMapping[] = [];
	for (const mapping of normalizeKeyMappingCollection(keyMappings)) {
		if (mapping.isSystem) {
			system.push(cloneUnknown(mapping));
		} else {
			custom.push(cloneUnknown(mapping));
		}
	}
	system.sort((left, right) => {
		const leftIndex = CANONICAL_KEY_ORDER.get(left.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex = CANONICAL_KEY_ORDER.get(right.canonicalKey) ?? Number.MAX_SAFE_INTEGER;
		if (leftIndex !== rightIndex) return leftIndex - rightIndex;
		return left.canonicalKey.localeCompare(right.canonicalKey);
	});
	return { version: 1, system, custom };
}

function readArray<T>(value: unknown, fallback: T[]): T[] {
	return cloneUnknown(Array.isArray(value) ? value : fallback);
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function readNullableString(value: unknown, fallback: string | null): string | null {
	return typeof value === 'string' || value === null ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isKeyMapping(value: unknown): value is KeyMapping {
	return isRecord(value)
		&& typeof value.canonicalKey === 'string'
		&& value.canonicalKey.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneExistingDomain<T>(
	existing: unknown,
	fallback: T,
	isValid: (value: unknown) => boolean = isRecord,
): T {
	return cloneUnknown(isValid(existing) ? existing : fallback);
}

function cloneSettingsPackageWithoutRetiredKeys(
	existing: unknown,
	fallback: OperonDataPackageSettings,
): OperonDataPackageSettings {
	return removeRetiredOperonDataPackageSettings(cloneExistingDomain(existing, fallback));
}

function buildStatePackage(
	existing: Partial<OperonDataPackageV1['state']> | null | undefined,
	fallback: OperonDataPackageV1['state'],
): OperonDataPackageV1['state'] {
	return {
		pinnedTasks: mergePinnedTasksPackages(existing?.pinnedTasks, fallback.pinnedTasks),
	};
}

function mergeTaxonomyPackage(
	existing: Partial<OperonTaxonomyPackageV1> | null | undefined,
	fallback: OperonTaxonomyPackageV1,
): OperonTaxonomyPackageV1 {
	const source = isRecord(existing) ? existing : {};
	return {
		keyMappings: cloneExistingDomain(source.keyMappings, fallback.keyMappings),
		priorities: cloneExistingDomain(source.priorities, fallback.priorities),
		pipelines: cloneExistingDomain(source.pipelines, fallback.pipelines),
	};
}

function isViewsDomain(value: unknown): boolean {
	return isRecord(value)
		&& isRecord(value.filters)
		&& isRecord(value.calendarPresets)
		&& isRecord(value.kanbanPresets)
		&& (!Object.prototype.hasOwnProperty.call(value, 'tablePresets') || isRecord(value.tablePresets))
		&& isRecord(value.kanbanOrder);
}

function mergeUiPackage(
	existing: Partial<OperonDataPackageV1['ui']> | null | undefined,
	fallback: OperonDataPackageV1['ui'],
	legacySettings?: Partial<OperonDataPackageV1['settings']> | null,
): OperonDataPackageV1['ui'] {
	const fallbackPackage = cloneUnknown<OperonDataPackageV1['ui']>(fallback);
	if (!existing || !isRecord(existing)) {
		return {
			...fallbackPackage,
			taskUiPreferences: mergeTaskUiPreferencesWithLegacyRoot(
				fallbackPackage.taskUiPreferences,
				legacySettings,
				true,
			),
		};
	}
	const hasTaskUiPreferences = isRecord(existing.taskUiPreferences);
	return {
		contextualMenu: isRecord(existing.contextualMenu)
			? cloneUnknown(existing.contextualMenu)
			: fallbackPackage.contextualMenu,
		taskUiPreferences: mergeTaskUiPreferencesWithLegacyRoot(
			hasTaskUiPreferences ? cloneUnknown(existing.taskUiPreferences) : fallbackPackage.taskUiPreferences,
			legacySettings,
			!hasTaskUiPreferences,
		),
		taskCreationProfile: isRecord(existing.taskCreationProfile)
			? cloneUnknown(existing.taskCreationProfile)
			: fallbackPackage.taskCreationProfile,
		workspaceTweaks: isRecord(existing.workspaceTweaks)
			? cloneUnknown(existing.workspaceTweaks)
			: fallbackPackage.workspaceTweaks,
		presetFavorites: isRecord(existing.presetFavorites)
			? cloneUnknown(existing.presetFavorites)
			: undefined,
	};
}

function mergeTaskUiPreferencesWithLegacyRoot(
	taskUiPreferences: OperonDataPackageV1['ui']['taskUiPreferences'],
	legacySettings: Partial<OperonDataPackageV1['settings']> | null | undefined,
	preferLegacyOverFallback: boolean,
): OperonDataPackageV1['ui']['taskUiPreferences'] {
	const merged = cloneUnknown<OperonDataPackageV1['ui']['taskUiPreferences']>(taskUiPreferences);
	if (!legacySettings || !isRecord(legacySettings)) return merged;
	const legacyRecord = legacySettings as Record<string, unknown>;
	const mergedRecord = merged as Record<string, unknown>;
	for (const key of TASK_UI_PREFERENCE_PACKAGE_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(legacyRecord, key)) continue;
		if (!preferLegacyOverFallback && Object.prototype.hasOwnProperty.call(mergedRecord, key)) continue;
		mergedRecord[key] = cloneUnknown(legacyRecord[key]);
	}
	return merged;
}

function isAutomationDomain(value: unknown): boolean {
	return isRecord(value) && isRecord(value.taskAutomationPolicy);
}

function mergeIntegrationsPackage(
	existing: Partial<OperonIntegrationsPackageV1> | null | undefined,
	fallback: OperonIntegrationsPackageV1,
): OperonIntegrationsPackageV1 {
	return {
		externalCalendarSources: cloneExistingDomain(
			existing?.externalCalendarSources,
			fallback.externalCalendarSources,
		),
		mobileNotifications: normalizeMobileNotificationsIntegration(
			existing?.mobileNotifications,
			fallback.mobileNotifications,
		),
		developerApi: normalizeDeveloperApiGrantPackage(
			existing?.developerApi ?? fallback.developerApi,
		),
	};
}

export function normalizeMobileNotificationsIntegration(
	value: unknown,
	fallback: OperonMobileNotificationsIntegrationV1 = createEmptyMobileNotificationsIntegration(),
): OperonMobileNotificationsIntegrationV1 {
	const source = isRecord(value) ? value : {};
	return {
		version: OPERON_MOBILE_NOTIFICATIONS_INTEGRATION_VERSION,
		snapshotEnabled: true,
		cancelPending: false,
		vaultId: normalizeMobileNotificationsVaultId(source.vaultId) ?? fallback.vaultId,
		lastGeneratedAtEpochMs: null,
	};
}

export function adoptMobileNotificationsIntegration(
	current: unknown,
	candidate: OperonMobileNotificationsIntegrationAdoption,
): OperonMobileNotificationsIntegrationV1 {
	const normalized = normalizeMobileNotificationsIntegration(current);
	const candidateVaultId = normalizeMobileNotificationsVaultId(candidate.vaultId);
	return {
		...normalized,
		vaultId: normalized.vaultId ?? candidateVaultId,
	};
}

export function createEmptyMobileNotificationsIntegration(): OperonMobileNotificationsIntegrationV1 {
	return {
		version: OPERON_MOBILE_NOTIFICATIONS_INTEGRATION_VERSION,
		snapshotEnabled: true,
		cancelPending: false,
		vaultId: null,
		lastGeneratedAtEpochMs: null,
	};
}

function normalizeMobileNotificationsVaultId(value: unknown): string | null {
	return typeof value === 'string' && LOWERCASE_UUID_V4_RE.test(value) ? value : null;
}


function cloneUnknown<T>(value: unknown): T {
	const parsed: unknown = JSON.parse(JSON.stringify(value));
	return parsed as T;
}
