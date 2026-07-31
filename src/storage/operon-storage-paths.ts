export interface OperonStoragePaths {
	pluginDir: string;
	dataPackagePath: string;
	state: {
		reminderDeliveriesRootPath: string;
		repeatSeriesPath: string;
		activeTrackersPath: string;
		pinnedTasksPath: string;
		projectSerialsPath: string;
		fieldRenameJournalPath: string;
	};
	runtime: {
		indexV8RecoveryRequiredPath: string;
		locales: {
			rootPath: string;
			manifestPath: string;
			packsPath: string;
		};
		indexV8: {
			rootPath: string;
			manifestPath: string;
			shardsPath: string;
		};
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
			reminderDeliveriesRootPath: joinVaultPath(pluginDir, 'state', 'reminder-deliveries'),
			repeatSeriesPath: joinVaultPath(pluginDir, 'state', 'repeat-series.json'),
			activeTrackersPath: joinVaultPath(pluginDir, 'state', 'active-trackers.json'),
			pinnedTasksPath: joinVaultPath(pluginDir, 'state', 'pinned-tasks.json'),
			projectSerialsPath: joinVaultPath(pluginDir, 'state', 'project-serials.json'),
			fieldRenameJournalPath: joinVaultPath(pluginDir, 'state', 'field-rename-journal.json'),
		},
		runtime: {
			indexV8RecoveryRequiredPath: joinVaultPath(pluginDir, 'runtime', 'index-v8-recovery-required.json'),
			locales: {
				rootPath: joinVaultPath(pluginDir, 'runtime', 'locales'),
				manifestPath: joinVaultPath(pluginDir, 'runtime', 'locales', 'manifest.json'),
				packsPath: joinVaultPath(pluginDir, 'runtime', 'locales', 'packs'),
			},
			indexV8: {
				rootPath: joinVaultPath(pluginDir, 'runtime', 'index-v8'),
				manifestPath: joinVaultPath(pluginDir, 'runtime', 'index-v8', 'manifest.json'),
				shardsPath: joinVaultPath(pluginDir, 'runtime', 'index-v8', 'shards'),
			},
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
