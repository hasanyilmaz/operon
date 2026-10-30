import assert from 'node:assert/strict';
import { defaultPropertyPoolPreferences } from '../src/core/property-value-pool';
import test from 'node:test';
import { projectOperonSettingsBackupApplyDataPackageV1 } from '../src/core/settings-backup-apply';
import {
	SETTINGS_BACKUP_GROUPS,
	SETTINGS_BACKUP_VAULT_REFERENCE_KEYS,
} from '../src/core/settings-backup-compatibility';
import {
	DYNAMIC_FILE_TASK_FILTER_ID,
	DYNAMIC_SUBTASKS_FILTER_ID,
	createDefaultDynamicFileTaskFilterSet,
	createDefaultDynamicSubtasksFilterSet,
	projectDynamicFilterTemplatePreferences,
} from '../src/core/dynamic-file-task-filter';
import { parseOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import {
	createOperonSettingsResetDefaultProfileV1,
	OPERON_SETTINGS_RESET_DEFAULT_GROUPS_V1,
	OPERON_SETTINGS_RESET_DEFAULT_VAULT_REFERENCE_DECISIONS_V1,
	preflightOperonSettingsResetDefaultsV1,
} from '../src/core/settings-reset-default-profile';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	OPERON_DATA_PACKAGE_SCHEMA_VERSION,
} from '../src/storage/operon-data-package';
import {
	CURRENT_SETTINGS_VERSION,
	DEFAULT_SETTINGS,
	migrateSettings,
	type OperonSettings,
} from '../src/types/settings';

const CREATED_AT = '2026-08-11T12:34:56.000Z';
const SOURCE = {
	pluginVersion: '3.2.1',
	obsidianVersion: '1.13.0',
	dataPackageSchemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
};

test('explicit reset replaces customized or future property pool preferences with empty defaults', () => {
	for (const raw of [{ version: 99, keep: true }, { ...defaultPropertyPoolPreferences(), favorites: [{ key: 'tags', type: 'list', value: 'work', label: '#work' }] }]) {
		const target = migrateSettings({ ...DEFAULT_SETTINGS, propertyValuePool: raw });
		const result = preflightOperonSettingsResetDefaultsV1({ source: SOURCE, createdAt: CREATED_AT, targetSnapshot: {
			settings: target, dataPackageSchemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION, settingsVersion: CURRENT_SETTINGS_VERSION,
			canonicalWritesSuspended: false, canonicalWriteSuspensionReason: null,
		} });
		assert.ok(result.preflight?.restorePlan);
		assert.deepEqual(result.preflight.restorePlan.candidateSettings.propertyValuePool, defaultPropertyPoolPreferences());
	}
});

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function customizedDynamicTemplates() {
	const fileTask = createDefaultDynamicFileTaskFilterSet();
	fileTask.name = 'Private file-task template';
	fileTask.icon = 'file-key';
	fileTask.sorts = [{ field: 'priority', order: 'desc' }];
	fileTask.sortBy = 'priority';
	fileTask.sortOrder = 'desc';
	fileTask.groupBy = 'dateDue';
	fileTask.groupOrder = 'desc';
	fileTask.subgroupBy = 'priority';
	fileTask.subgroupOrder = 'asc';

	const subtasks = createDefaultDynamicSubtasksFilterSet();
	subtasks.name = 'Private subtasks template';
	subtasks.icon = 'list-checks';
	subtasks.sorts = [{ field: 'checkbox', order: 'desc' }];
	subtasks.sortBy = 'checkbox';
	subtasks.sortOrder = 'desc';
	subtasks.groupBy = 'priority';
	subtasks.groupOrder = 'asc';
	return [fileTask, subtasks];
}

function defaultDynamicTemplatePreferences() {
	return projectDynamicFilterTemplatePreferences([
		createDefaultDynamicFileTaskFilterSet(),
		createDefaultDynamicSubtasksFilterSet(),
	]);
}

function changedTarget(): OperonSettings {
	return migrateSettings({
		...clone(DEFAULT_SETTINGS),
		filterSets: [...clone(DEFAULT_SETTINGS.filterSets), ...customizedDynamicTemplates()],
		language: 'de',
		operonDocsFolder: 'Private/Docs',
		fileTasksFolder: 'Private/Tasks',
		inlineTaskTargetFile: 'Private/Inbox.md',
		defaultInlineTaskTemplateId: 'folder-file-task-template:Templates/Inline.md',
		externalCalendars: [{
			id: 'private-calendar',
			name: 'Private calendar',
			url: 'https://example.invalid/private.ics',
			color: '#123456',
			enabled: true,
		}],
		tablePresetOrderIds: ['table-private'],
		tablePresetFileBindings: [{ id: 'table-private', path: 'Tables/Private.table' }],
		tablePresetFileInitialized: true,
		tableDefaultPresetId: 'table-private',
		presetFavorites: {
			...clone(DEFAULT_SETTINGS.presetFavorites),
			table: ['table-private'],
		},
	});
}

test('default reset profile is deterministic, valid and leaves DEFAULT_SETTINGS immutable', () => {
	const before = JSON.stringify(DEFAULT_SETTINGS);
	const first = createOperonSettingsResetDefaultProfileV1({ source: SOURCE, createdAt: CREATED_AT });
	const second = createOperonSettingsResetDefaultProfileV1({ source: SOURCE, createdAt: CREATED_AT });
	assert.equal(first.ok, true, first.diagnostics.map(item => `${item.path}: ${item.message}`).join('\n'));
	assert.equal(second.ok, true);
	assert.equal(JSON.stringify(DEFAULT_SETTINGS), before);
	if (!first.ok || !second.ok) return;
	assert.equal(first.json, second.json);
	assert.equal(first.bodyChecksum, second.bodyChecksum);
	assert.equal(parseOperonSettingsBackupV1(first.json).ok, true);
	assert.equal(first.backup.body.source.settingsVersion, CURRENT_SETTINGS_VERSION);
	assert.equal(first.backup.body.scope.externalCalendarUrls, 'included');
	assert.equal(first.backup.body.scope.tableFiles, 'excluded');
	assert.deepEqual(
		Object.keys(first.backup.body.groups).sort(),
		SETTINGS_BACKUP_GROUPS.map(group => group.id).sort(),
	);
});

test('reset preflight selects every group and applies default vault-bound and external Calendar values', () => {
	const target = changedTarget();
	const result = preflightOperonSettingsResetDefaultsV1({
		source: SOURCE,
		createdAt: CREATED_AT,
		targetSnapshot: {
			settings: target,
			dataPackageSchemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
			settingsVersion: CURRENT_SETTINGS_VERSION,
			canonicalWritesSuspended: false,
			canonicalWriteSuspensionReason: null,
		},
	});
	assert.equal(result.profile.ok, true);
	assert.ok(result.preflight?.ok);
	assert.equal(result.preflight?.classification, 'ready');
	const plan = result.preflight?.restorePlan;
	assert.ok(plan);
	assert.deepEqual(plan.selectedGroups, [...OPERON_SETTINGS_RESET_DEFAULT_GROUPS_V1].sort());
	for (const key of SETTINGS_BACKUP_VAULT_REFERENCE_KEYS) {
		assert.equal(plan.vaultReferenceDecisions[key], 'apply-source');
		assert.deepEqual(plan.candidateSettings[key], DEFAULT_SETTINGS[key]);
	}
	assert.deepEqual(plan.candidateSettings.externalCalendars, DEFAULT_SETTINGS.externalCalendars);
	assert.deepEqual(
		projectDynamicFilterTemplatePreferences(plan.candidateSettings.filterSets),
		defaultDynamicTemplatePreferences(),
	);
	assert.notDeepEqual(
		projectDynamicFilterTemplatePreferences(plan.candidateSettings.filterSets),
		projectDynamicFilterTemplatePreferences(target.filterSets),
	);
	assert.ok(plan.candidateSettings.filterSets.some(filterSet => filterSet.id === DYNAMIC_FILE_TASK_FILTER_ID));
	assert.ok(plan.candidateSettings.filterSets.some(filterSet => filterSet.id === DYNAMIC_SUBTASKS_FILTER_ID));
	assert.deepEqual(plan.candidateSettings.tablePresetFileBindings, target.tablePresetFileBindings);
	assert.deepEqual(plan.candidateSettings.tablePresetOrderIds, target.tablePresetOrderIds);
	assert.equal(plan.candidateSettings.tableDefaultPresetId, target.tableDefaultPresetId);
	assert.deepEqual(plan.candidateSettings.presetFavorites.table, target.presetFavorites.table);
	assert.equal(
		Object.keys(OPERON_SETTINGS_RESET_DEFAULT_VAULT_REFERENCE_DECISIONS_V1).length,
		SETTINGS_BACKUP_VAULT_REFERENCE_KEYS.length,
	);
});

test('existing JSON projection retains protected package authority for a reset candidate', () => {
	const target = changedTarget();
	const preflight = preflightOperonSettingsResetDefaultsV1({
		source: SOURCE,
		createdAt: CREATED_AT,
		targetSnapshot: {
			settings: target,
			dataPackageSchemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION,
			settingsVersion: CURRENT_SETTINGS_VERSION,
			canonicalWritesSuspended: false,
			canonicalWriteSuspensionReason: null,
		},
	}).preflight;
	assert.ok(preflight?.restorePlan);
	if (!preflight?.restorePlan) return;
	const current = buildOperonDataPackageFromSettings(target);
	current.views.kanbanOrder.boards = { private: { backlog: ['task-private'] } };
	current.integrations.mobileNotifications.vaultId = 'private-vault-id';
	current.integrations.developerApi = {
		...current.integrations.developerApi,
		consumersById: {
			'private-consumer': {
				consumerId: 'private-consumer',
				consumerName: 'Private consumer',
				consumerVersion: '1.0.0',
				approvedMajorVersion: 1,
				state: 'active',
				revision: 1,
				grantedCapabilities: [],
				pendingCapabilities: [],
				createdAt: CREATED_AT,
				updatedAt: CREATED_AT,
			},
		},
	};
	current.state.pinnedTasks.itemsById['task-private'] = { pinned: true, updatedAt: CREATED_AT };
	const projected = projectOperonSettingsBackupApplyDataPackageV1(
		current,
		clone(preflight.restorePlan.candidateSettings) as OperonSettings,
	);
	assert.deepEqual(projected.views.kanbanOrder, current.views.kanbanOrder);
	assert.deepEqual(projected.views.tablePresets.fileBindings, current.views.tablePresets.fileBindings);
	assert.deepEqual(projected.views.tablePresets.presetIds, current.views.tablePresets.presetIds);
	assert.deepEqual(projected.ui.presetFavorites?.table, current.ui.presetFavorites?.table);
	assert.deepEqual(projected.integrations.mobileNotifications, current.integrations.mobileNotifications);
	assert.deepEqual(projected.integrations.developerApi, current.integrations.developerApi);
	assert.deepEqual(projected.state, current.state);
	assert.deepEqual(
		projectDynamicFilterTemplatePreferences(
			Object.values(projected.views.filters.itemsById),
		),
		defaultDynamicTemplatePreferences(),
	);
});


test('explicit defaults reset disables phone mobile layout and restores existing defaults', () => {
 const target = migrateSettings({ ...DEFAULT_SETTINGS, taskEditorUseMobileLayout: true });
 const result = preflightOperonSettingsResetDefaultsV1({ source: SOURCE, createdAt: CREATED_AT, targetSnapshot: {
  settings: target, dataPackageSchemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION, settingsVersion: CURRENT_SETTINGS_VERSION,
  canonicalWritesSuspended: false, canonicalWriteSuspensionReason: null,
 } });
 assert.ok(result.preflight?.restorePlan);
 assert.equal(result.preflight.restorePlan.candidateSettings.taskEditorUseMobileLayout, false);
 assert.deepEqual(result.preflight.restorePlan.candidateSettings.taskEditorMobileCoreTools, DEFAULT_SETTINGS.taskEditorMobileCoreTools);
 assert.deepEqual(result.preflight.restorePlan.candidateSettings.taskEditorSections, DEFAULT_SETTINGS.taskEditorSections);
});


test('explicit reset uses the agreed first-install chips without mutating the existing target', () => {
 const target = changedTarget();
 const before = structuredClone(target);
 const result = preflightOperonSettingsResetDefaultsV1({ source: SOURCE, createdAt: CREATED_AT, targetSnapshot: {
  settings: target, dataPackageSchemaVersion: OPERON_DATA_PACKAGE_SCHEMA_VERSION, settingsVersion: CURRENT_SETTINGS_VERSION,
  canonicalWritesSuspended: false, canonicalWriteSuspensionReason: null,
 } });
 assert.ok(result.preflight?.restorePlan);
 const reset = result.preflight.restorePlan.candidateSettings;
 const reloaded = composeOperonSettingsFromDataPackage(
  JSON.parse(JSON.stringify(projectOperonSettingsBackupApplyDataPackageV1(buildOperonDataPackageFromSettings(target), reset))),
  DEFAULT_SETTINGS,
 );
 const expected = {
  taskCreatorToolbar: ['taskIcon', 'taskColor', 'taskType', 'priority', 'status', 'note'],
  inlineTaskCompactChips: ['priority', 'status', 'parentTask', 'dateScheduled', 'dateDue', 'repeat', 'tags', 'taskInfo.projectSerial'],
  taskFinderCompactChips: ['taskType', 'priority', 'parentTask', 'assignees', 'taskInfo.projectSerial'],
  filterTaskCompactChips: ['priority', 'status', 'parentTask', 'dateScheduled', 'dateDue', 'repeat', 'tags', 'assignees', 'taskInfo.projectSerial'],
  kanbanTaskCompactChips: ['taskImage', 'priority', 'dateScheduled', 'dateDue', 'assignees', 'taskInfo.projectSerial'],
  taskWikilinkOverlayCompactChips: ['priority', 'dateDue', 'assignees', 'taskInfo.projectSerial'],
  taskCardCompactChips: ['taskImage', 'priority', 'status', 'dateScheduled', 'dateDue', 'assignees', 'taskInfo.projectSerial'],
 };
 for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
  assert.deepEqual(reset[key].filter(item => item.visible).map(item => item.key).sort(), expected[key].sort(), key);
  assert.deepEqual(reloaded[key], reset[key], `${key} must survive package serialization and reload`);
  assert.deepEqual(reset[key].map(item => item.key), DEFAULT_SETTINGS[key].map(item => item.key), `${key} order/options`);
  if (key !== 'taskCreatorToolbar') assert.deepEqual(reset[key].filter(item => item.iconOnly).map(item => item.key),
   ['inlineTaskCompactChips', 'filterTaskCompactChips', 'taskCardCompactChips'].includes(key) ? ['status'] : [], key);
 }
 for (const prefix of ['inlineTask', 'filterTask', 'kanbanTask', 'taskWikilinkOverlay', 'taskCard'] as const) {
  assert.equal(reset[`${prefix}ShowPlayAction`], false);
  assert.equal(reset[`${prefix}ShowSubtaskAction`], false);
  assert.equal(reset[`${prefix}ShowPinAction`], false);
  assert.equal(reset[`${prefix}ShowNoteAction`], true);
 }
 assert.deepEqual(target, before, 'Previewing Reset must leave existing preferences intact');
});
