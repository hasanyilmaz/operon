export interface OperonStoragePaths {
	pluginDir: string;
	dataPackagePath: string;
	state: {
		repeatSeriesPath: string;
		activeTrackersPath: string;
		pinnedTasksPath: string;
		projectSerialsPath: string;
		storageMigrationPath: string;
	};
	runtime: {
		indexPath: string;
	};
	cache: {
		externalCalendarsPath: string;
	};
	legacy: OperonLegacyStoragePaths;
}

export interface OperonLegacyStoragePaths {
	dataFolder: string;
	settingsPath: string;
	indexPath: string;
	cacheFolder: string;
	filtersFolder: string;
	filtersIndexPath: string;
	keyMappingsPath: string;
	prioritiesPath: string;
	pipelinesPath: string;
	calendarPresetsPath: string;
	kanbanPresetsPath: string;
	kanbanOrderPath: string;
	externalCalendarSourcesPath: string;
	contextualMenuPath: string;
	taskUiPreferencesPath: string;
	taskCreationProfilePath: string;
	taskAutomationPolicyPath: string;
	activeTrackersPath: string;
	repeatSeriesPath: string;
	pinnedCachePath: string;
	externalCalendarsCachePath: string;
	filterPath: (filterId: string) => string;
}

const LEGACY_DATA_FOLDER = '.operon';

export function buildOperonStoragePaths(
	configDir: string,
	pluginId = 'operon',
): OperonStoragePaths {
	const pluginDir = joinVaultPath(configDir, 'plugins', pluginId);
	const legacyCacheFolder = joinVaultPath(LEGACY_DATA_FOLDER, 'cache');
	const legacyFiltersFolder = joinVaultPath(LEGACY_DATA_FOLDER, 'filters');

	return {
		pluginDir,
		dataPackagePath: joinVaultPath(pluginDir, 'data.json'),
		state: {
			repeatSeriesPath: joinVaultPath(pluginDir, 'state', 'repeat-series.json'),
			activeTrackersPath: joinVaultPath(pluginDir, 'state', 'active-trackers.json'),
			pinnedTasksPath: joinVaultPath(pluginDir, 'state', 'pinned-tasks.json'),
			projectSerialsPath: joinVaultPath(pluginDir, 'state', 'project-serials.json'),
			storageMigrationPath: joinVaultPath(pluginDir, 'state', 'storage-migration.json'),
		},
		runtime: {
			indexPath: joinVaultPath(pluginDir, 'runtime', 'index.json'),
		},
		cache: {
			externalCalendarsPath: joinVaultPath(pluginDir, 'cache', 'external-calendars.json'),
		},
		legacy: {
			dataFolder: LEGACY_DATA_FOLDER,
			settingsPath: joinVaultPath(LEGACY_DATA_FOLDER, 'settings.json'),
			indexPath: joinVaultPath(LEGACY_DATA_FOLDER, 'index.json'),
			cacheFolder: legacyCacheFolder,
			filtersFolder: legacyFiltersFolder,
			filtersIndexPath: joinVaultPath(legacyFiltersFolder, 'index.json'),
			keyMappingsPath: joinVaultPath(LEGACY_DATA_FOLDER, 'key-mappings.json'),
			prioritiesPath: joinVaultPath(LEGACY_DATA_FOLDER, 'priorities.json'),
			pipelinesPath: joinVaultPath(LEGACY_DATA_FOLDER, 'pipelines.json'),
			calendarPresetsPath: joinVaultPath(LEGACY_DATA_FOLDER, 'calendar-presets.json'),
			kanbanPresetsPath: joinVaultPath(LEGACY_DATA_FOLDER, 'kanban-presets.json'),
			kanbanOrderPath: joinVaultPath(LEGACY_DATA_FOLDER, 'kanban-order.json'),
			externalCalendarSourcesPath: joinVaultPath(LEGACY_DATA_FOLDER, 'external-calendar-sources.json'),
			contextualMenuPath: joinVaultPath(LEGACY_DATA_FOLDER, 'contextual-menu.json'),
			taskUiPreferencesPath: joinVaultPath(LEGACY_DATA_FOLDER, 'task-ui-preferences.json'),
			taskCreationProfilePath: joinVaultPath(LEGACY_DATA_FOLDER, 'task-creation-profile.json'),
			taskAutomationPolicyPath: joinVaultPath(LEGACY_DATA_FOLDER, 'task-automation-policy.json'),
			activeTrackersPath: joinVaultPath(LEGACY_DATA_FOLDER, 'active-trackers.json'),
			repeatSeriesPath: joinVaultPath(LEGACY_DATA_FOLDER, 'repeat-series.json'),
			pinnedCachePath: joinVaultPath(legacyCacheFolder, 'pinned-cache.json'),
			externalCalendarsCachePath: joinVaultPath(legacyCacheFolder, 'external-calendars.json'),
			filterPath: (filterId: string) => joinVaultPath(legacyFiltersFolder, `${filterId}.json`),
		},
	};
}

function joinVaultPath(...parts: string[]): string {
	return parts
		.map(part => part.trim().replace(/^\/+|\/+$/gu, ''))
		.filter(Boolean)
		.join('/');
}
