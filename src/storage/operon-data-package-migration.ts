import {
	OPERON_DATA_PACKAGE_SCHEMA_VERSION,
	type OperonDataPackageSettings,
	type OperonDataPackageV1,
	type OperonExternalCalendarSourcesPackageV1,
	type OperonFiltersPackageV1,
	type OperonKanbanOrderPackageV1,
	type OperonKeyMappingsPackageV1,
	type VersionedStoreSlice,
} from './operon-data-package';
import type { OperonLegacyStoragePaths } from './operon-storage-paths';
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
	type FilterSet,
	type KeyMapping,
	type OperonSettings,
	migrateSettings,
	normalizeFilterSet,
} from '../types/settings';

export interface LegacyOperonStorageAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export interface LegacyJsonFileSnapshot {
	path: string;
	exists: boolean;
	parsed: unknown;
	malformed: boolean;
	errorMessage?: string;
}

export interface LegacyOperonStorageSnapshot {
	stores: Record<LegacyOperonStoreKey, LegacyJsonFileSnapshot>;
	filtersIndex: LegacyJsonFileSnapshot;
	filterFiles: Record<string, LegacyJsonFileSnapshot>;
	filtersFolderExists: boolean;
	listedFilterIds: string[];
}

export interface OperonDataPackageMigrationDiagnostics {
	missingLegacyPaths: string[];
	malformedLegacyPaths: string[];
	warnings: string[];
}

export interface OperonDataPackageMigrationResult {
	dataPackage: OperonDataPackageV1;
	diagnostics: OperonDataPackageMigrationDiagnostics;
}

export type LegacyOperonStoreKey =
	| 'settings'
	| 'keyMappings'
	| 'priorities'
	| 'pipelines'
	| 'calendarPresets'
	| 'kanbanPresets'
	| 'kanbanOrder'
	| 'externalCalendarSources'
	| 'contextualMenu'
	| 'taskUiPreferences'
	| 'taskCreationProfile'
	| 'taskAutomationPolicy';

const LEGACY_STORE_PATH_KEYS = {
	settings: 'settingsPath',
	keyMappings: 'keyMappingsPath',
	priorities: 'prioritiesPath',
	pipelines: 'pipelinesPath',
	calendarPresets: 'calendarPresetsPath',
	kanbanPresets: 'kanbanPresetsPath',
	kanbanOrder: 'kanbanOrderPath',
	externalCalendarSources: 'externalCalendarSourcesPath',
	contextualMenu: 'contextualMenuPath',
	taskUiPreferences: 'taskUiPreferencesPath',
	taskCreationProfile: 'taskCreationProfilePath',
	taskAutomationPolicy: 'taskAutomationPolicyPath',
} as const satisfies Record<LegacyOperonStoreKey, keyof OperonLegacyStoragePaths>;

const DATA_PACKAGE_OWNED_SETTINGS_KEYS = [
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
	'taskEditorShowLineNumbers',
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
] as const satisfies readonly (keyof OperonSettings)[];

const TASK_UI_PREFERENCE_KEYS = [
	'taskCreatorToolbar',
	'taskEditorShowLineNumbers',
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
] as const satisfies readonly (keyof TaskUiPreferenceStoreSettings)[];

const TASK_CREATION_PROFILE_KEYS = [
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
] as const satisfies readonly (keyof TaskCreationProfileStoreSettings)[];

const TASK_AUTOMATION_POLICY_KEYS = [
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
] as const satisfies readonly (keyof TaskAutomationPolicyStoreSettings)[];

export async function readLegacyOperonStorageSnapshot(
	adapter: LegacyOperonStorageAdapter,
	legacyPaths: OperonLegacyStoragePaths,
): Promise<LegacyOperonStorageSnapshot> {
	const stores = {} as Record<LegacyOperonStoreKey, LegacyJsonFileSnapshot>;
	for (const [storeKey, pathKey] of Object.entries(LEGACY_STORE_PATH_KEYS) as [LegacyOperonStoreKey, keyof OperonLegacyStoragePaths][]) {
		stores[storeKey] = await readJsonFile(adapter, legacyPaths[pathKey] as string);
	}

	const filtersIndex = await readJsonFile(adapter, legacyPaths.filtersIndexPath);
	const filtersFolderExists = await adapter.exists(legacyPaths.filtersFolder);
	const listedFilterIds = filtersFolderExists
		? (await adapter.list(legacyPaths.filtersFolder)).files
			.map(path => path.split('/').pop() ?? '')
			.filter(name => name.endsWith('.json') && name !== 'index.json')
			.map(name => name.replace(/\.json$/u, ''))
			.filter(Boolean)
			.sort((left, right) => left.localeCompare(right))
		: [];
	const indexedFilterIds = normalizeFilterIdsFromIndex(filtersIndex.parsed);
	const candidateFilterIds = mergeOrderedIds(indexedFilterIds, listedFilterIds);
	const filterFiles: Record<string, LegacyJsonFileSnapshot> = {};
	for (const filterId of candidateFilterIds) {
		filterFiles[filterId] = await readJsonFile(adapter, legacyPaths.filterPath(filterId));
	}

	return {
		stores,
		filtersIndex,
		filterFiles,
		filtersFolderExists,
		listedFilterIds,
	};
}

export function buildOperonDataPackageFromLegacySnapshot(
	snapshot: LegacyOperonStorageSnapshot,
	defaults: OperonSettings,
): OperonDataPackageMigrationResult {
	const diagnostics = createDiagnostics(snapshot);
	const settingsSource = snapshot.stores.settings.parsed ?? defaults;
	const rawSettings = isRecord(settingsSource) ? settingsSource : {};
	const migratedSettings = migrateSettings(settingsSource);

	const dataPackage: OperonDataPackageV1 = {
		schemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
		settings: buildSettingsPackage(migratedSettings),
		taxonomy: {
			keyMappings: buildKeyMappingsPackage(snapshot.stores.keyMappings, migratedSettings),
			priorities: buildPrioritiesPackage(snapshot.stores.priorities, migratedSettings),
			pipelines: buildPipelinesPackage(snapshot.stores.pipelines, migratedSettings),
		},
		views: {
			filters: buildFiltersPackage(snapshot, migratedSettings, diagnostics),
			calendarPresets: buildCalendarPresetsPackage(snapshot.stores.calendarPresets, migratedSettings),
			kanbanPresets: buildKanbanPresetsPackage(snapshot.stores.kanbanPresets, migratedSettings),
			kanbanOrder: buildKanbanOrderPackage(snapshot.stores.kanbanOrder),
		},
		ui: {
			contextualMenu: buildContextualMenuPackage(
				snapshot.stores.contextualMenu,
				pickMalformedFallbackSettings(
					snapshot.stores.contextualMenu,
					rawSettings,
					migratedSettings,
					defaults,
					['contextualMenuActionAllowlist', 'contextualMenuSurfaceActionMatrix', 'contextualMenuOpenDelayMs'],
				),
			),
			taskUiPreferences: buildPickedSettingsPackage(
				snapshot.stores.taskUiPreferences,
				pickMalformedFallbackSettings(
					snapshot.stores.taskUiPreferences,
					rawSettings,
					migratedSettings,
					defaults,
					[...TASK_UI_PREFERENCE_KEYS, 'taskBarChips'],
				),
				TASK_UI_PREFERENCE_KEYS,
			),
			taskCreationProfile: buildPickedSettingsPackage(
				snapshot.stores.taskCreationProfile,
				pickMalformedFallbackSettings(
					snapshot.stores.taskCreationProfile,
					rawSettings,
					migratedSettings,
					defaults,
					TASK_CREATION_PROFILE_KEYS,
				),
				TASK_CREATION_PROFILE_KEYS,
			),
		},
		automation: {
			taskAutomationPolicy: buildPickedSettingsPackage(
				snapshot.stores.taskAutomationPolicy,
				pickMalformedFallbackSettings(
					snapshot.stores.taskAutomationPolicy,
					rawSettings,
					migratedSettings,
					defaults,
					TASK_AUTOMATION_POLICY_KEYS,
				),
				TASK_AUTOMATION_POLICY_KEYS,
			),
		},
		integrations: {
			externalCalendarSources: buildExternalCalendarSourcesPackage(
				snapshot.stores.externalCalendarSources,
				pickMalformedFallbackSettings(
					snapshot.stores.externalCalendarSources,
					rawSettings,
					migratedSettings,
					defaults,
					['externalCalendars'],
				),
			),
		},
	};

	return { dataPackage, diagnostics };
}

export function mergeOperonDataPackage(
	existing: Partial<OperonDataPackageV1> | null | undefined,
	legacy: OperonDataPackageV1,
): OperonDataPackageV1 {
	return {
		schemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
		settings: cloneExistingDomain(existing?.settings, legacy.settings),
		taxonomy: cloneExistingDomain(existing?.taxonomy, legacy.taxonomy, isTaxonomyDomain),
		views: cloneExistingDomain(existing?.views, legacy.views, isViewsDomain),
		ui: cloneExistingDomain(existing?.ui, legacy.ui, isUiDomain),
		automation: cloneExistingDomain(existing?.automation, legacy.automation, isAutomationDomain),
		integrations: cloneExistingDomain(existing?.integrations, legacy.integrations, isIntegrationsDomain),
	};
}

async function readJsonFile(
	adapter: LegacyOperonStorageAdapter,
	path: string,
): Promise<LegacyJsonFileSnapshot> {
	if (!(await adapter.exists(path))) {
		return { path, exists: false, parsed: null, malformed: false };
	}

	try {
		const raw = await adapter.read(path);
		return { path, exists: true, parsed: JSON.parse(raw), malformed: false };
	} catch (error) {
		return {
			path,
			exists: true,
			parsed: null,
			malformed: true,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

function createDiagnostics(snapshot: LegacyOperonStorageSnapshot): OperonDataPackageMigrationDiagnostics {
	const diagnostics: OperonDataPackageMigrationDiagnostics = {
		missingLegacyPaths: [],
		malformedLegacyPaths: [],
		warnings: [],
	};

	for (const entry of [
		...Object.values(snapshot.stores),
		snapshot.filtersIndex,
		...Object.values(snapshot.filterFiles),
	]) {
		if (!entry.exists) {
			diagnostics.missingLegacyPaths.push(entry.path);
		}
		if (entry.malformed) {
			diagnostics.malformedLegacyPaths.push(entry.path);
		}
	}
	if (!snapshot.filtersFolderExists) {
		diagnostics.missingLegacyPaths.push('.operon/filters');
	}
	return diagnostics;
}

function buildSettingsPackage(settings: OperonSettings): OperonDataPackageSettings {
	const packageSettings = { ...settings } as Partial<OperonSettings>;
	for (const key of DATA_PACKAGE_OWNED_SETTINGS_KEYS) {
		delete packageSettings[key];
	}
	return packageSettings as OperonDataPackageSettings;
}

function pickMalformedFallbackSettings(
	entry: LegacyJsonFileSnapshot,
	rawSettings: Record<string, unknown>,
	migratedSettings: OperonSettings,
	defaults: OperonSettings,
	keys: readonly string[],
): OperonSettings {
	if (!entry.malformed) return migratedSettings;
	return keys.some(key => Object.prototype.hasOwnProperty.call(rawSettings, key))
		? migratedSettings
		: defaults;
}

function buildKeyMappingsPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): OperonKeyMappingsPackageV1 {
	if (isRecord(entry.parsed)) {
		return {
			version: readVersion(entry.parsed),
			system: readArray(entry.parsed.system, []).filter(isKeyMapping),
			custom: readArray(entry.parsed.custom, []).filter(isKeyMapping),
		};
	}

	const system: KeyMapping[] = [];
	const custom: KeyMapping[] = [];
	for (const mapping of settings.keyMappings) {
		if (mapping.isSystem) {
			system.push(cloneJson(mapping));
		} else {
			custom.push(cloneJson(mapping));
		}
	}
	return { version: 1, system, custom };
}

function buildPrioritiesPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): VersionedStoreSlice<PriorityStoreSettings> {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	return {
		version: readVersion(parsed),
		priorities: readArray(parsed.priorities, settings.priorities),
		defaultPriority: readString(parsed.defaultPriority, settings.defaultPriority),
	};
}

function buildPipelinesPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): VersionedStoreSlice<PipelineStoreSettings> {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	return {
		version: readVersion(parsed),
		pipelines: readArray(parsed.pipelines, settings.pipelines),
		defaultPipelineName: readString(parsed.defaultPipelineName, settings.defaultPipelineName),
	};
}

function buildCalendarPresetsPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): VersionedStoreSlice<CalendarPresetStoreSettings> {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	const rawDefault = parsed.defaultPresetId;
	return {
		version: readVersion(parsed),
		calendarPresets: readArray(parsed.presets, settings.calendarPresets),
		calendarDefaultPresetId: typeof rawDefault === 'string' || rawDefault === null
			? rawDefault
			: settings.calendarDefaultPresetId,
	};
}

function buildKanbanPresetsPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): VersionedStoreSlice<KanbanPresetStoreSettings> {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	const rawDefault = parsed.defaultPresetId;
	return {
		version: readVersion(parsed),
		kanbanPresets: readArray(parsed.presets, settings.kanbanPresets),
		kanbanDefaultPresetId: typeof rawDefault === 'string' || rawDefault === null
			? rawDefault
			: settings.kanbanDefaultPresetId,
	};
}

function buildKanbanOrderPackage(entry: LegacyJsonFileSnapshot): OperonKanbanOrderPackageV1 {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	return {
		version: readVersion(parsed),
		boards: normalizeKanbanOrderBoards(parsed.boards),
	};
}

function buildFiltersPackage(
	snapshot: LegacyOperonStorageSnapshot,
	settings: OperonSettings,
	diagnostics: OperonDataPackageMigrationDiagnostics,
): OperonFiltersPackageV1 {
	const indexedIds = normalizeFilterIdsFromIndex(snapshot.filtersIndex.parsed);
	const orderCandidates = indexedIds.length > 0
		? mergeOrderedIds(indexedIds, snapshot.listedFilterIds)
		: snapshot.listedFilterIds;
	const itemsById: Record<string, FilterSet> = {};
	const filterIds: string[] = [];

	for (const filterId of orderCandidates) {
		const entry = snapshot.filterFiles[filterId];
		if (!entry?.exists) {
			diagnostics.warnings.push(`Missing legacy filter file skipped: ${filterId}`);
			continue;
		}
		if (entry.malformed) {
			diagnostics.warnings.push(`Malformed legacy filter file skipped: ${entry.path}`);
			continue;
		}
		const normalized = normalizeFilterSet(entry.parsed);
		if (!normalized) {
			diagnostics.warnings.push(`Invalid legacy filter file skipped: ${entry.path}`);
			continue;
		}
		itemsById[normalized.id] = cloneJson(normalized);
		filterIds.push(normalized.id);
	}

	if (filterIds.length === 0 && settings.filterSets.length > 0) {
		for (const filterSet of settings.filterSets) {
			const normalized = normalizeFilterSet(filterSet);
			if (!normalized || itemsById[normalized.id]) continue;
			itemsById[normalized.id] = cloneJson(normalized);
			filterIds.push(normalized.id);
		}
	}

	return {
		version: 1,
		filterIds,
		itemsById,
	};
}

function buildContextualMenuPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): VersionedStoreSlice<ContextualMenuStoreSettings> {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	return {
		version: readVersion(parsed),
		contextualMenuActionAllowlist: readArray(parsed.actionAllowlist, settings.contextualMenuActionAllowlist),
		contextualMenuSurfaceActionMatrix: isRecord(parsed.surfaceActionMatrix)
			? cloneJson<ContextualMenuStoreSettings['contextualMenuSurfaceActionMatrix']>(parsed.surfaceActionMatrix)
			: cloneJson(settings.contextualMenuSurfaceActionMatrix),
		contextualMenuOpenDelayMs: readNumber(parsed.openDelayMs, settings.contextualMenuOpenDelayMs),
	};
}

function buildPickedSettingsPackage<T extends object, K extends keyof T>(
	entry: LegacyJsonFileSnapshot,
	settings: T,
	keys: readonly K[],
): VersionedStoreSlice<Pick<T, K>> {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	const result: Record<string, unknown> = { version: readVersion(parsed) };
	for (const key of keys) {
		const rawKey = String(key);
		const value = Object.prototype.hasOwnProperty.call(parsed, rawKey)
				? parsed[key as string]
				: settings[key];
		result[rawKey] = cloneUnknown(value);
	}
	return result as VersionedStoreSlice<Pick<T, K>>;
}

function buildExternalCalendarSourcesPackage(
	entry: LegacyJsonFileSnapshot,
	settings: OperonSettings,
): OperonExternalCalendarSourcesPackageV1 {
	const parsed = isRecord(entry.parsed) ? entry.parsed : {};
	return {
		version: readVersion(parsed),
		sources: readArray(parsed.sources, settings.externalCalendars),
	};
}

function normalizeFilterIdsFromIndex(raw: unknown): string[] {
	if (!isRecord(raw) || !Array.isArray(raw.filterIds)) return [];
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const value of raw.filterIds) {
		const id = typeof value === 'string' ? value.trim() : '';
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}

function normalizeKanbanOrderBoards(raw: unknown): Record<string, KanbanManualOrderBoard> {
	if (!isRecord(raw)) return {};
	const boards: Record<string, KanbanManualOrderBoard> = {};
	for (const [presetId, boardRaw] of Object.entries(raw)) {
		if (!presetId.trim() || !isRecord(boardRaw)) continue;
		const board: KanbanManualOrderBoard = {};
		for (const [cellKey, taskIdsRaw] of Object.entries(boardRaw)) {
			if (!cellKey.trim() || !Array.isArray(taskIdsRaw)) continue;
			const taskIds = taskIdsRaw
				.map(value => typeof value === 'string' ? value.trim() : '')
				.filter(Boolean);
			if (taskIds.length > 0) {
				board[cellKey] = taskIds;
			}
		}
		if (Object.keys(board).length > 0) {
			boards[presetId] = board;
		}
	}
	return boards;
}

function mergeOrderedIds(primary: string[], secondary: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const id of [...primary, ...secondary]) {
		const trimmed = id.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function readVersion(raw: Record<string, unknown>): number {
	return readNumber(raw.version, 1);
}

function readArray<T>(value: unknown, fallback: T[]): T[] {
	return cloneUnknown(Array.isArray(value) ? value : fallback);
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
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

function cloneJson<T>(value: T): T {
	return cloneUnknown(value);
}

function isTaxonomyDomain(value: unknown): boolean {
	return isRecord(value)
		&& isRecord(value.keyMappings)
		&& isRecord(value.priorities)
		&& isRecord(value.pipelines);
}

function isViewsDomain(value: unknown): boolean {
	return isRecord(value)
		&& isRecord(value.filters)
		&& isRecord(value.calendarPresets)
		&& isRecord(value.kanbanPresets)
		&& isRecord(value.kanbanOrder);
}

function isUiDomain(value: unknown): boolean {
	return isRecord(value)
		&& isRecord(value.contextualMenu)
		&& isRecord(value.taskUiPreferences)
		&& isRecord(value.taskCreationProfile);
}

function isAutomationDomain(value: unknown): boolean {
	return isRecord(value) && isRecord(value.taskAutomationPolicy);
}

function isIntegrationsDomain(value: unknown): boolean {
	return isRecord(value) && isRecord(value.externalCalendarSources);
}

function cloneUnknown<T>(value: unknown): T {
	const parsed: unknown = JSON.parse(JSON.stringify(value));
	return parsed as T;
}
