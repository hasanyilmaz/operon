export type CoreGeneralSettingsGroupId = 'languageFormats' | 'updates' | 'demoWorkspace' | 'operonDocs' | 'taskIndexing' | 'duplicateIdAlerts' | 'uriBuilder' | 'developerApi';

export type CoreGeneralSettingsPlanItem =
	| { type: 'entry'; entryId: string }
	| { type: 'group'; groupId: CoreGeneralSettingsGroupId; entryIds: string[] };

const CORE_GENERAL_SETTINGS_GROUPS: ReadonlyArray<{ groupId: CoreGeneralSettingsGroupId; entryIds: readonly string[] }> = [
	{ groupId: 'languageFormats', entryIds: ['settings.language', 'settings.timeFormat', 'settings.dateDisplayFormat', 'settings.calendarWeekStart'] },
	{ groupId: 'updates', entryIds: ['settings.checkForUpdatesOnStartup', 'settings.releaseNotesShowOnUpdate'] },
	{ groupId: 'demoWorkspace', entryIds: ['settings.demoWorkspace'] },
	{ groupId: 'operonDocs', entryIds: ['settings.operonDocsFolder', 'settings.operonDocsAutoUpdateEnabled', 'settings.operonDocs'] },
	{ groupId: 'taskIndexing', entryIds: ['settings.indexEventDebounceMs', 'settings.fullReindexOnStartup'] },
	{ groupId: 'duplicateIdAlerts', entryIds: ['settings.duplicateAlertDelaySeconds', 'settings.duplicateAlertAutoOpenManager'] },
	{ groupId: 'uriBuilder', entryIds: ['settings.uriBuilder'] },
	{ groupId: 'developerApi', entryIds: ['integrations.developerApi'] },
];

export function buildCoreGeneralSettingsPlan(entryIds: readonly string[]): CoreGeneralSettingsPlanItem[] {
	const remaining = new Set(entryIds);
	const plan: CoreGeneralSettingsPlanItem[] = [];
	for (const group of CORE_GENERAL_SETTINGS_GROUPS) {
		const ids = group.entryIds.filter(id => remaining.delete(id));
		if (ids.length) plan.push({ type: 'group', groupId: group.groupId, entryIds: ids });
	}
	for (const entryId of remaining) plan.push({ type: 'entry', entryId });
	return plan;
}
