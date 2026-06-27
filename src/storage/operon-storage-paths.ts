export interface OperonStoragePaths {
	pluginDir: string;
	dataPackagePath: string;
	state: {
		repeatSeriesPath: string;
		activeTrackersPath: string;
		pinnedTasksPath: string;
		projectSerialsPath: string;
	};
	runtime: {
		indexPath: string;
	};
	cache: {
		externalCalendarsPath: string;
	};
}

export function buildOperonStoragePaths(
	configDir: string,
	pluginId = 'operon',
): OperonStoragePaths {
	const pluginDir = joinVaultPath(configDir, 'plugins', pluginId);

	return {
		pluginDir,
		dataPackagePath: joinVaultPath(pluginDir, 'data.json'),
		state: {
			repeatSeriesPath: joinVaultPath(pluginDir, 'state', 'repeat-series.json'),
			activeTrackersPath: joinVaultPath(pluginDir, 'state', 'active-trackers.json'),
			pinnedTasksPath: joinVaultPath(pluginDir, 'state', 'pinned-tasks.json'),
			projectSerialsPath: joinVaultPath(pluginDir, 'state', 'project-serials.json'),
		},
		runtime: {
			indexPath: joinVaultPath(pluginDir, 'runtime', 'index.json'),
		},
		cache: {
			externalCalendarsPath: joinVaultPath(pluginDir, 'cache', 'external-calendars.json'),
		},
	};
}

export function buildOperonPluginStoragePath(configDir: string, ...parts: string[]): string {
	return joinVaultPath(configDir, 'plugins', 'operon', ...parts);
}

export function joinVaultPath(...parts: string[]): string {
	return parts
		.map(part => part.trim().replace(/^\/+|\/+$/gu, ''))
		.filter(Boolean)
		.join('/');
}
