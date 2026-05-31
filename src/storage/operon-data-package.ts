import type { KanbanManualOrderBoard } from './kanban-order-store';
import type { CalendarPresetStoreSettings } from './calendar-preset-store';
import type { ContextualMenuStoreSettings } from './contextual-menu-store';
import type { KanbanPresetStoreSettings } from './kanban-preset-store';
import type { PipelineStoreSettings } from './pipeline-store';
import type { PriorityStoreSettings } from './priority-store';
import type { TaskAutomationPolicyStoreSettings } from './task-automation-policy-store';
import type { TaskCreationProfileStoreSettings } from './task-creation-profile-store';
import type { TaskUiPreferenceStoreSettings } from './task-ui-preference-store';
import {
	type ExternalCalendarSource,
	type FilterSet,
	type KeyMapping,
	type OperonSettings,
	migrateSettings,
	normalizeFilterSet,
} from '../types/settings';
import { CANONICAL_KEYS } from '../types/keys';

export const OPERON_DATA_PACKAGE_SCHEMA_VERSION = 1;
const CANONICAL_KEY_ORDER = new Map(CANONICAL_KEYS.map((key, index) => [key.name, index]));

export type VersionedStoreSlice<T> = T & {
	version: number;
};

export type OperonDataPackageOwnedSettingsKey =
	| 'keyMappings'
	| 'filterSets'
	| 'externalCalendars'
	| keyof PipelineStoreSettings
	| keyof PriorityStoreSettings
	| keyof CalendarPresetStoreSettings
	| keyof KanbanPresetStoreSettings
	| keyof ContextualMenuStoreSettings
	| keyof TaskUiPreferenceStoreSettings
	| keyof TaskCreationProfileStoreSettings
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
	'contextualMenuActionAllowlist',
	'contextualMenuSurfaceActionMatrix',
	'contextualMenuOpenDelayMs',
	'taskCreatorToolbar',
	'taskEditorWorkflowPickers',
	'inlineExpandedTaskChips',
	'inlineTaskCompactChips',
	'filterTaskCompactChips',
	'taskFinderCompactChips',
	'taskFinderDefaultScope',
	'taskFinderRememberLastScopes',
	'taskFinderSelectedProjectId',
	'taskFinderShortcuts',
	'overlayTaskCompactChips',
	'overlayTaskShowPlayAction',
	'overlayTaskShowPinAction',
	'overlayTaskShowNoteAction',
	'overlayTaskShowSubtaskAction',
	'inlineTaskShowPlayAction',
	'inlineTaskShowPinAction',
	'inlineTaskShowSubtaskAction',
	'filterTaskShowPlayAction',
	'filterTaskShowPinAction',
	'filterTaskShowSubtaskAction',
	'taskDescriptionRequired',
	'assigneesRequired',
	'fileTasksFolder',
	'inlineTaskSaveMode',
	'inlineTaskUseDailyNote',
	'inlineTaskTargetFile',
	'inlineTaskHeading',
	'fileTaskParentInlineTargetMode',
	'fileTaskParentFileTargetMode',
	'inlineTaskParentInlineTargetMode',
	'inlineTaskParentFileTargetMode',
	'inlineTaskParentFileHeadingKeyword',
	'calendarInlineTaskHeading',
	'autoParentFileTask',
	'autoParentLinkedFileSubtasks',
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
] as const satisfies readonly OperonDataPackageOwnedSettingsKey[];

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

export interface OperonTaxonomyPackageV1 {
	keyMappings: OperonKeyMappingsPackageV1;
	priorities: VersionedStoreSlice<PriorityStoreSettings>;
	pipelines: VersionedStoreSlice<PipelineStoreSettings>;
}

export interface OperonViewsPackageV1 {
	filters: OperonFiltersPackageV1;
	calendarPresets: VersionedStoreSlice<CalendarPresetStoreSettings>;
	kanbanPresets: VersionedStoreSlice<KanbanPresetStoreSettings>;
	kanbanOrder: OperonKanbanOrderPackageV1;
}

export interface OperonUiPackageV1 {
	contextualMenu: VersionedStoreSlice<ContextualMenuStoreSettings>;
	taskUiPreferences: VersionedStoreSlice<TaskUiPreferenceStoreSettings>;
	taskCreationProfile: VersionedStoreSlice<TaskCreationProfileStoreSettings>;
}

export interface OperonAutomationPackageV1 {
	taskAutomationPolicy: VersionedStoreSlice<TaskAutomationPolicyStoreSettings>;
}

export interface OperonIntegrationsPackageV1 {
	externalCalendarSources: OperonExternalCalendarSourcesPackageV1;
}

export interface OperonDataPackageV1 {
	schemaVersion: typeof OPERON_DATA_PACKAGE_SCHEMA_VERSION;
	settings: OperonDataPackageSettings;
	taxonomy: OperonTaxonomyPackageV1;
	views: OperonViewsPackageV1;
	ui: OperonUiPackageV1;
	automation: OperonAutomationPackageV1;
	integrations: OperonIntegrationsPackageV1;
}

export interface BuildOperonDataPackageOptions {
	filterSets?: FilterSet[];
	kanbanOrderBoards?: Record<string, KanbanManualOrderBoard>;
}

export function composeOperonSettingsFromDataPackage(
	dataPackage: OperonDataPackageV1,
	defaults: OperonSettings,
): OperonSettings {
	const keyMappings = [
		...readArray(dataPackage.taxonomy.keyMappings.system, []),
		...readArray(dataPackage.taxonomy.keyMappings.custom, []),
	].filter(isKeyMapping);
	const filterSets = dataPackage.views.filters.filterIds
		.map(filterId => dataPackage.views.filters.itemsById[filterId])
		.map(filterSet => normalizeFilterSet(filterSet))
		.filter((filterSet): filterSet is FilterSet => !!filterSet);
	return migrateSettings({
		...defaults,
			...cloneUnknown<Partial<OperonSettings>>(dataPackage.settings),
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
			...cloneUnknown<Partial<OperonSettings>>(dataPackage.ui.taskUiPreferences),
			...cloneUnknown<Partial<OperonSettings>>(dataPackage.ui.taskCreationProfile),
			...cloneUnknown<Partial<OperonSettings>>(dataPackage.automation.taskAutomationPolicy),
		externalCalendars: readArray(dataPackage.integrations.externalCalendarSources.sources, defaults.externalCalendars),
	});
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
			},
			taskUiPreferences: {
				version: 1,
				taskCreatorToolbar: cloneUnknown(normalized.taskCreatorToolbar),
				taskEditorWorkflowPickers: cloneUnknown(normalized.taskEditorWorkflowPickers),
				inlineExpandedTaskChips: cloneUnknown(normalized.inlineExpandedTaskChips),
				inlineTaskCompactChips: cloneUnknown(normalized.inlineTaskCompactChips),
				filterTaskCompactChips: cloneUnknown(normalized.filterTaskCompactChips),
				taskFinderCompactChips: cloneUnknown(normalized.taskFinderCompactChips),
				taskFinderDefaultScope: normalized.taskFinderDefaultScope,
				taskFinderRememberLastScopes: normalized.taskFinderRememberLastScopes,
				taskFinderSelectedProjectId: normalized.taskFinderSelectedProjectId,
				taskFinderShortcuts: cloneUnknown(normalized.taskFinderShortcuts),
				overlayTaskCompactChips: cloneUnknown(normalized.overlayTaskCompactChips),
				overlayTaskShowPlayAction: normalized.overlayTaskShowPlayAction,
				overlayTaskShowPinAction: normalized.overlayTaskShowPinAction,
				overlayTaskShowNoteAction: normalized.overlayTaskShowNoteAction,
				overlayTaskShowSubtaskAction: normalized.overlayTaskShowSubtaskAction,
				inlineTaskShowPlayAction: normalized.inlineTaskShowPlayAction,
				inlineTaskShowPinAction: normalized.inlineTaskShowPinAction,
				inlineTaskShowSubtaskAction: normalized.inlineTaskShowSubtaskAction,
				filterTaskShowPlayAction: normalized.filterTaskShowPlayAction,
				filterTaskShowPinAction: normalized.filterTaskShowPinAction,
				filterTaskShowSubtaskAction: normalized.filterTaskShowSubtaskAction,
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
				inlineTaskParentInlineTargetMode: normalized.inlineTaskParentInlineTargetMode,
				inlineTaskParentFileTargetMode: normalized.inlineTaskParentFileTargetMode,
				inlineTaskParentFileHeadingKeyword: normalized.inlineTaskParentFileHeadingKeyword,
				calendarInlineTaskHeading: normalized.calendarInlineTaskHeading,
				autoParentFileTask: normalized.autoParentFileTask,
				autoParentLinkedFileSubtasks: normalized.autoParentLinkedFileSubtasks,
				fileTaskTemplateFolder: normalized.fileTaskTemplateFolder,
				createDailyNotesAsOperonTask: normalized.createDailyNotesAsOperonTask,
				defaultEstimateMinutes: normalized.defaultEstimateMinutes,
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
				estimateAutoReallocation: normalized.estimateAutoReallocation,
				trackerSplitSessionsAtMidnight: normalized.trackerSplitSessionsAtMidnight,
			},
		},
		integrations: {
			externalCalendarSources: {
				version: 1,
				sources: cloneUnknown(normalized.externalCalendars),
			},
		},
	};
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
	for (const mapping of keyMappings) {
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

function cloneUnknown<T>(value: unknown): T {
	const parsed: unknown = JSON.parse(JSON.stringify(value));
	return parsed as T;
}
