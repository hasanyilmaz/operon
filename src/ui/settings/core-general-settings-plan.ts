export type CoreGeneralSettingsGroupId = 'operonDocs' | 'duplicateIdAlerts';

export type CoreGeneralSettingsPlanItem =
	| { type: 'entry'; entryId: string }
	| { type: 'group'; groupId: CoreGeneralSettingsGroupId; entryIds: string[] };

const CORE_GENERAL_SETTINGS_GROUPS: ReadonlyArray<{
	groupId: CoreGeneralSettingsGroupId;
	entryIds: readonly string[];
}> = [
	{
		groupId: 'operonDocs',
		entryIds: [
			'settings.operonDocs',
			'settings.operonDocsFolder',
			'settings.operonDocsAutoUpdateEnabled',
		],
	},
	{
		groupId: 'duplicateIdAlerts',
		entryIds: [
			'settings.duplicateAlertAutoOpenManager',
			'settings.duplicateAlertDelaySeconds',
		],
	},
];

const CORE_GENERAL_SETTINGS_GROUP_BY_ENTRY_ID = new Map(
	CORE_GENERAL_SETTINGS_GROUPS.flatMap(group => group.entryIds.map(entryId => [entryId, group] as const)),
);

export function buildCoreGeneralSettingsPlan(entryIds: readonly string[]): CoreGeneralSettingsPlanItem[] {
	const availableEntryIds = new Set(entryIds);
	const emittedEntryIds = new Set<string>();
	const emittedGroupIds = new Set<CoreGeneralSettingsGroupId>();
	const plan: CoreGeneralSettingsPlanItem[] = [];

	for (const entryId of entryIds) {
		if (emittedEntryIds.has(entryId)) continue;
		const group = CORE_GENERAL_SETTINGS_GROUP_BY_ENTRY_ID.get(entryId);
		if (!group) {
			emittedEntryIds.add(entryId);
			plan.push({ type: 'entry', entryId });
			continue;
		}
		if (emittedGroupIds.has(group.groupId)) continue;

		const groupEntryIds = group.entryIds.filter(candidate => availableEntryIds.has(candidate));
		for (const groupEntryId of groupEntryIds) emittedEntryIds.add(groupEntryId);
		emittedGroupIds.add(group.groupId);
		if (groupEntryIds.length > 0) {
			plan.push({ type: 'group', groupId: group.groupId, entryIds: groupEntryIds });
		}
	}

	return plan;
}
