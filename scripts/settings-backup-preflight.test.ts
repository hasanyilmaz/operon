import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SETTINGS_BACKUP_GROUPS } from '../src/core/settings-backup-compatibility';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import {
	buildOperonSettingsBackupV1,
	serializeOperonSettingsBackupV1,
	type OperonSettingsBackupBodyV1,
} from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	createOperonSettingsBackupPreflightV1,
	preflightOperonSettingsBackupRestoreV1,
} from '../src/core/settings-backup-preflight';
import { DEFAULT_SETTINGS, migrateSettings, type OperonSettings } from '../src/types/settings';

const CREATED_AT = '2026-08-10T18:00:00.000Z';
const SECRET_SOURCE_URL = 'https://example.invalid/source-private-token.ics';
const SECRET_TARGET_URL = 'https://example.invalid/target-private-token.ics';
const FIXTURE_DIR = path.resolve('scripts/settings-backup-fixtures');

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze(value: unknown): void {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
}

function representativeSettings(): OperonSettings {
	const body = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'representative-body.json'), 'utf8')) as OperonSettingsBackupBodyV1;
	const decoded = validateOperonSettingsBackupGroupsV1(body.groups);
	assert.equal(decoded.ok, true);
	const payloads = decoded.payloads;
	const systemOverrides = new Map(payloads['system-key-mappings']?.overrides.map(item => [item.canonicalKey, item]) ?? []);
	const systemMappings = DEFAULT_SETTINGS.keyMappings
		.filter(mapping => mapping.isSystem !== false)
		.map(mapping => ({ ...mapping, ...(systemOverrides.get(mapping.canonicalKey) ?? {}) }));
	return migrateSettings({
		...DEFAULT_SETTINGS,
		...(payloads.general ?? {}),
		pipelines: payloads.pipelines?.pipelines,
		defaultPipelineName: payloads.pipelines?.defaultPipelineName,
		priorities: payloads.priorities?.priorities,
		defaultPriority: payloads.priorities?.defaultPriority,
		keyMappings: [...systemMappings, ...(payloads['custom-keys']?.customKeys ?? [])],
		filterSets: payloads.filters?.filterSets,
		calendarPresets: payloads.calendar?.calendarPresets,
		calendarDefaultPresetId: payloads.calendar?.calendarDefaultPresetId,
		calendarMobileDefaultSourcePresetId: payloads.calendar?.calendarMobileDefaultSourcePresetId,
		calendarMobileAgendaSourcePresetId: payloads.calendar?.calendarMobileAgendaSourcePresetId,
		calendarMobileDaySourcePresetId: payloads.calendar?.calendarMobileDaySourcePresetId,
		calendarMobileTwoDaySourcePresetId: payloads.calendar?.calendarMobileTwoDaySourcePresetId,
		calendarMobileThreeDaySourcePresetId: payloads.calendar?.calendarMobileThreeDaySourcePresetId,
		kanbanPresets: payloads.kanban?.kanbanPresets,
		kanbanDefaultPresetId: payloads.kanban?.kanbanDefaultPresetId,
		presetFavorites: payloads['preset-favorites']?.presetFavorites,
		...(payloads['table-global'] ?? {}),
		externalCalendars: payloads['external-calendars']?.externalCalendars,
		tablePresetOrderIds: ['table-target'],
		tablePresetFileBindings: [{ id: 'table-target', path: 'Tables/Target.table' }],
	});
}

function exportJson(settings: OperonSettings, includeExternalCalendarUrls = false): string {
	const result = exportOperonSettingsBackupJsonV1({
		settings,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: CREATED_AT,
		includeExternalCalendarUrls,
	});
	assert.equal(result.ok, true, result.diagnostics.map(item => item.message).join('\n'));
	if (!result.ok) throw new Error('Expected export to succeed.');
	return result.json;
}

function targetSnapshot(settings: OperonSettings, writesSuspended = false) {
	return {
		settings,
		dataPackageSchemaVersion: 2,
		settingsVersion: settings.settingsVersion,
		canonicalWritesSuspended: writesSuspended,
		canonicalWriteSuspensionReason: writesSuspended ? 'test suspension' : null,
	};
}

function selectedDefaultGroups() {
	return SETTINGS_BACKUP_GROUPS.filter(group => group.defaultSelected).map(group => group.id);
}

test('exact preview is deterministic, immutable and preserves excluded Table favorites', () => {
	const source = representativeSettings();
	const target = clone(source);
	source.tablePresetOrderIds = ['table-source'];
	source.tablePresetFileBindings = [{ id: 'table-source', path: 'Tables/Source.table' }];
	source.presetFavorites.table = ['table-source'];
	target.language = 'de';
	target.presetFavorites.table = ['table-target'];
	const targetBefore = JSON.stringify(target);
	deepFreeze(target);
	const input = { sourceJson: exportJson(source), targetSnapshot: targetSnapshot(target) };
	const first = preflightOperonSettingsBackupRestoreV1(input);
	const second = preflightOperonSettingsBackupRestoreV1(input);
	assert.equal(first.ok, true);
	assert.equal(second.ok, true);
	if (!first.ok || !second.ok) return;
	assert.equal(first.classification, 'ready');
	assert.equal(first.preview.identity.planId, second.preview.identity.planId);
	assert.deepEqual(first.preview, second.preview);
	assert.ok(first.restorePlan);
	assert.deepEqual(first.restorePlan?.candidateSettings.presetFavorites.table, ['table-target']);
	assert.equal(first.preview.summary.tableReferencesMatched, 0);
	assert.equal(first.preview.summary.tableReferencesUnmatched, 1);
	assert.equal(Object.isFrozen(first.restorePlan), true);
	assert.equal(Object.isFrozen(first.restorePlan?.candidateSettings), true);
	assert.equal(JSON.stringify(target), targetBefore);
});

test('vault references require field-level decisions without discarding other General settings', () => {
	const source = representativeSettings();
	const target = clone(source);
	source.fileTasksFolder = 'Source/Tasks';
	target.fileTasksFolder = 'Target/Tasks';
	source.checkForUpdatesOnStartup = !target.checkForUpdatesOnStartup;
	const sourceJson = exportJson(source);
	const pending = preflightOperonSettingsBackupRestoreV1({ sourceJson, targetSnapshot: targetSnapshot(target) });
	assert.equal(pending.ok, true);
	if (!pending.ok) return;
	assert.equal(pending.classification, 'decision-required');
	assert.equal(pending.restorePlan, null);
	assert.equal(pending.preview.summary.vaultReferencesPending, 1);

	const preserved = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		vaultReferenceDecisions: { fileTasksFolder: 'preserve-target' },
	});
	assert.equal(preserved.ok, true);
	if (!preserved.ok) return;
	assert.equal(preserved.classification, 'ready');
	assert.equal(preserved.restorePlan?.candidateSettings.fileTasksFolder, 'Target/Tasks');
	assert.equal(preserved.restorePlan?.candidateSettings.checkForUpdatesOnStartup, source.checkForUpdatesOnStartup);

	const applied = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		vaultReferenceDecisions: { fileTasksFolder: 'apply-source' },
	});
	assert.equal(applied.ok, true);
	if (!applied.ok) return;
	assert.equal(applied.restorePlan?.candidateSettings.fileTasksFolder, 'Source/Tasks');
	const validButUndecided = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		vaultReferenceChecks: { fileTasksFolder: { status: 'valid' } },
	});
	assert.equal(validButUndecided.ok, true);
	if (!validButUndecided.ok) return;
	assert.equal(validButUndecided.classification, 'decision-required');
	assert.equal(validButUndecided.restorePlan, null);
	const validButPreserved = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		vaultReferenceChecks: { fileTasksFolder: { status: 'valid' } },
		vaultReferenceDecisions: { fileTasksFolder: 'preserve-target' },
	});
	assert.equal(validButPreserved.ok, true);
	if (!validButPreserved.ok) return;
	assert.equal(validButPreserved.restorePlan?.candidateSettings.fileTasksFolder, 'Target/Tasks');

	const skipped = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		selectedGroups: [],
	});
	assert.equal(skipped.ok, true);
	if (!skipped.ok) return;
	const skippedGeneral = skipped.preview.groups.find(group => group.group === 'general');
	assert.ok(skippedGeneral?.counts.changed);
	assert.ok(skippedGeneral?.counts.skipped);
	assert.ok(skipped.preview.summary.skippedGroups > 0);
});

test('selection preserves target groups and reverse dependency breakage blocks the plan', () => {
	const source = representativeSettings();
	const target = migrateSettings({
		...source,
		pipelines: clone(DEFAULT_SETTINGS.pipelines),
		defaultPipelineName: DEFAULT_SETTINGS.defaultPipelineName,
		kanbanPresets: clone(DEFAULT_SETTINGS.kanbanPresets),
		kanbanDefaultPresetId: DEFAULT_SETTINGS.kanbanDefaultPresetId,
	});
	const blocked = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(source),
		targetSnapshot: targetSnapshot(target),
		selectedGroups: ['pipelines'],
	});
	assert.equal(blocked.ok, true);
	if (!blocked.ok) return;
	assert.equal(blocked.classification, 'blocked');
	assert.equal(blocked.restorePlan, null);
	assert.equal(blocked.preview.groups.find(group => group.group === 'kanban')?.status, 'blocked-dependency');

	const ready = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(source),
		targetSnapshot: targetSnapshot(target),
		selectedGroups: ['pipelines', 'kanban'],
	});
	assert.equal(ready.ok, true);
	if (!ready.ok) return;
	assert.equal(ready.classification, 'ready', JSON.stringify(ready.preview.issues, null, 2));
	assert.equal(ready.restorePlan?.candidateSettings.language, target.language);
});

test('Calendar visibility is target-preserved when sensitive sources are not selected', () => {
	const source = representativeSettings();
	const target = clone(source);
	const presetId = source.calendarPresets[0]?.id;
	assert.ok(presetId);
	target.calendarPresets[0].externalCalendarVisibility = { 'target-private-calendar': false };
	const result = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(source),
		targetSnapshot: targetSnapshot(target),
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.restorePlan?.candidateSettings.calendarPresets[0]?.externalCalendarVisibility, {
		'target-private-calendar': false,
	});
});

test('same-ID preset changes are normal diffs and nested vault conditions are explicit warnings', () => {
	const source = representativeSettings();
	const target = clone(source);
	const condition = source.filterSets[0]?.conditions[0];
	assert.ok(condition);
	condition.field = 'folders';
	condition.fieldType = 'folders';
	condition.operator = 'contains';
	condition.value = 'Source/Projects';
	const rootCondition = source.filterSets[0]?.rootGroup.children[0];
	assert.ok(rootCondition && !('children' in rootCondition));
	if (rootCondition && !('children' in rootCondition)) Object.assign(rootCondition, condition);
	source.filterSets[0].name = 'Changed filter name';
	const canonicalSource = migrateSettings(source);
	const result = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(canonicalSource),
		targetSnapshot: targetSnapshot(target),
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.classification, 'decision-required');
	assert.equal(result.restorePlan, null);
	assert.ok(result.preview.groups.find(group => group.group === 'filters')?.counts.changed);
	assert.ok(result.preview.issues.some(issue => issue.kind === 'vault-bound-preset' && issue.group === 'filters'));
	const acknowledged = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(canonicalSource),
		targetSnapshot: targetSnapshot(target),
		selectedGroups: selectedDefaultGroups(),
	});
	assert.equal(acknowledged.ok, true);
	if (!acknowledged.ok) return;
	assert.equal(acknowledged.classification, 'ready');
});

test('sensitive External Calendar changes are masked while explicit selection enables the group', () => {
	const source = representativeSettings();
	const target = clone(source);
	source.externalCalendars[0].url = SECRET_SOURCE_URL;
	target.externalCalendars[0].url = SECRET_TARGET_URL;
	const result = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(source, true),
		targetSnapshot: targetSnapshot(target),
		selectedGroups: [...selectedDefaultGroups(), 'external-calendars'],
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.classification, 'ready');
	assert.equal(result.preview.sensitiveExternalCalendarsSelected, true);
	assert.equal(JSON.stringify(result.preview).includes(SECRET_SOURCE_URL), false);
	assert.equal(JSON.stringify(result.preview).includes(SECRET_TARGET_URL), false);
	assert.equal(JSON.stringify(result.diagnostics).includes(SECRET_SOURCE_URL), false);
	assert.equal(result.restorePlan?.candidateSettings.externalCalendars[0]?.url, SECRET_SOURCE_URL);
});

test('provenance is advisory while future optional and foundational codecs are graded independently', () => {
	const source = representativeSettings();
	const exported = exportOperonSettingsBackupJsonV1({
		settings: source,
		source: { pluginVersion: '99.0.0', obsidianVersion: '9.0.0', dataPackageSchemaVersion: 999 },
		createdAt: CREATED_AT,
	});
	assert.equal(exported.ok, true);
	if (!exported.ok) return;
	const provenanceBody = clone(exported.backup.body);
	provenanceBody.source.settingsVersion = 999;
	const provenanceJson = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(provenanceBody));
	const provenance = preflightOperonSettingsBackupRestoreV1({
		sourceJson: provenanceJson,
		targetSnapshot: targetSnapshot(source),
	});
	assert.equal(provenance.ok, true);
	if (!provenance.ok) return;
	assert.equal(provenance.classification, 'ready');
	assert.ok(provenance.diagnostics.some(item => item.code === 'provenance-warning'));

	const futureOptionalBody = clone(exported.backup.body);
	if (futureOptionalBody.groups.filters) futureOptionalBody.groups.filters.codecVersion = 2;
	const futureOptional = preflightOperonSettingsBackupRestoreV1({
		sourceJson: serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(futureOptionalBody)),
		targetSnapshot: targetSnapshot(source),
	});
	assert.equal(futureOptional.ok, true);
	if (!futureOptional.ok) return;
	assert.equal(futureOptional.preview.compatibility, 'partial');
	assert.equal(futureOptional.preview.groups.find(group => group.group === 'filters')?.status, 'skipped-unsupported');
	assert.equal(futureOptional.classification, 'decision-required');
	assert.equal(futureOptional.restorePlan, null);

	const futureCoreBody = clone(exported.backup.body);
	futureCoreBody.groups.general.codecVersion = 2;
	const futureCore = preflightOperonSettingsBackupRestoreV1({
		sourceJson: serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(futureCoreBody)),
		targetSnapshot: targetSnapshot(source),
	});
	assert.equal(futureCore.ok, true);
	if (!futureCore.ok) return;
	assert.equal(futureCore.preview.groups.find(group => group.group === 'general')?.status, 'blocked-invalid');
	assert.equal(futureCore.classification, 'decision-required');
	assert.equal(futureCore.preview.compatibility, 'partial');
	assert.equal(futureCore.diagnostics.some(item => item.severity === 'error'), false);
	const partialAccepted = preflightOperonSettingsBackupRestoreV1({
		sourceJson: serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(futureCoreBody)),
		targetSnapshot: targetSnapshot(source),
		selectedGroups: selectedDefaultGroups().filter(group => group !== 'general'),
	});
	assert.equal(partialAccepted.ok, true);
	if (!partialAccepted.ok) return;
	assert.equal(partialAccepted.classification, 'ready');

	const sensitiveExport = exportOperonSettingsBackupJsonV1({
		settings: source,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: CREATED_AT,
		includeExternalCalendarUrls: true,
	});
	assert.equal(sensitiveExport.ok, true);
	if (!sensitiveExport.ok) return;
	const futureSensitiveBody = clone(sensitiveExport.backup.body);
	assert.ok(futureSensitiveBody.groups['external-calendars']);
	futureSensitiveBody.groups['external-calendars'].codecVersion = 2;
	const futureSensitive = preflightOperonSettingsBackupRestoreV1({
		sourceJson: serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(futureSensitiveBody)),
		targetSnapshot: targetSnapshot(source),
		selectedGroups: ['external-calendars'],
	});
	assert.equal(futureSensitive.ok, true);
	if (!futureSensitive.ok) return;
	assert.equal(futureSensitive.classification, 'decision-required');
	assert.equal(futureSensitive.restorePlan, null);
});

test('registered migrations are selected and isolated migration failures remain partial', () => {
	const source = representativeSettings();
	const exported = exportOperonSettingsBackupJsonV1({
		settings: source,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: CREATED_AT,
	});
	assert.equal(exported.ok, true);
	if (!exported.ok) return;
	const legacyGeneralBody = clone(exported.backup.body);
	legacyGeneralBody.groups.general.codecVersion = 0;
	const migrateGeneral = createOperonSettingsBackupPreflightV1([{
		group: 'general',
		fromCodecVersion: 0,
		toCodecVersion: 1,
		migrate: data => data,
	}]);
	const migrated = migrateGeneral({
		sourceJson: serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(legacyGeneralBody)),
		targetSnapshot: targetSnapshot(source),
	});
	assert.equal(migrated.ok, true);
	if (!migrated.ok) return;
	assert.equal(migrated.classification, 'ready');
	assert.equal(migrated.preview.groups.find(group => group.group === 'general')?.selectable, true);
	assert.equal(migrated.preview.groups.find(group => group.group === 'general')?.selected, true);
	assert.equal(migrated.preview.groups.find(group => group.group === 'general')?.counts.migrated, 1);

	const legacyFilterBody = clone(exported.backup.body);
	assert.ok(legacyFilterBody.groups.filters);
	legacyFilterBody.groups.filters.codecVersion = 0;
	const throwing = createOperonSettingsBackupPreflightV1([{
		group: 'filters',
		fromCodecVersion: 0,
		toCodecVersion: 1,
		migrate: () => { throw new Error(SECRET_SOURCE_URL); },
	}]);
	const failed = throwing({
		sourceJson: serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(legacyFilterBody)),
		targetSnapshot: targetSnapshot(source),
	});
	assert.equal(failed.ok, true);
	if (!failed.ok) return;
	assert.equal(failed.classification, 'decision-required');
	assert.equal(failed.restorePlan, null);
	assert.equal(failed.preview.compatibility, 'partial');
	assert.equal(JSON.stringify(failed).includes(SECRET_SOURCE_URL), false);
	assert.equal(failed.preview.groups.find(group => group.group === 'filters')?.status, 'blocked-invalid');
	assert.equal(failed.preview.groups.find(group => group.group === 'filters')?.counts.migrated, 0);
});

test('malformed, integrity failure and future envelope are terminal without partial artifacts', () => {
	const sourceJson = exportJson(representativeSettings());
	const malformed = preflightOperonSettingsBackupRestoreV1({
		sourceJson: '{',
		targetSnapshot: targetSnapshot(representativeSettings()),
	});
	assert.equal(malformed.ok, false);
	assert.equal(malformed.restorePlan, null);

	const tampered = JSON.parse(sourceJson) as Record<string, unknown>;
	(tampered.body as Record<string, unknown>).createdAt = '2026-08-10T19:00:00.000Z';
	const integrity = preflightOperonSettingsBackupRestoreV1({
		sourceJson: JSON.stringify(tampered),
		targetSnapshot: targetSnapshot(representativeSettings()),
	});
	assert.equal(integrity.ok, false);
	assert.equal(integrity.classification, 'integrity-failed');

	const future = JSON.parse(sourceJson) as Record<string, unknown>;
	future.formatVersion = 2;
	const unsupported = preflightOperonSettingsBackupRestoreV1({
		sourceJson: JSON.stringify(future),
		targetSnapshot: targetSnapshot(representativeSettings()),
	});
	assert.equal(unsupported.ok, false);
	assert.equal(unsupported.classification, 'unsupported');
});

test('fingerprints bind source, target and selection; warnings remain zero-write metadata', () => {
	const source = representativeSettings();
	const target = clone(source);
	const sourceJson = exportJson(source);
	const base = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target, true),
	});
	assert.equal(base.ok, true);
	if (!base.ok) return;
	assert.equal(base.preview.canonicalWritesSuspended, true);
	assert.ok(base.preview.issues.some(issue => issue.kind === 'writes-suspended'));
	assert.equal(base.classification, 'blocked');
	assert.equal(base.restorePlan, null);

	const changedTarget = clone(target);
	changedTarget.language = changedTarget.language === 'en' ? 'de' : 'en';
	const targetChanged = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(changedTarget),
	});
	const selectionChanged = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		selectedGroups: ['general'],
	});
	const referenceCheckChanged = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot: targetSnapshot(target),
		vaultReferenceChecks: { fileTasksFolder: { status: 'valid' } },
	});
	const changedSource = clone(source);
	changedSource.language = changedSource.language === 'en' ? 'de' : 'en';
	const sourceChanged = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exportJson(changedSource),
		targetSnapshot: targetSnapshot(target),
	});
	assert.equal(targetChanged.ok, true);
	assert.equal(selectionChanged.ok, true);
	assert.equal(referenceCheckChanged.ok, true);
	assert.equal(sourceChanged.ok, true);
	if (!targetChanged.ok || !selectionChanged.ok || !referenceCheckChanged.ok || !sourceChanged.ok) return;
	assert.notEqual(base.preview.identity.targetConfigurationFingerprint, targetChanged.preview.identity.targetConfigurationFingerprint);
	assert.notEqual(base.preview.identity.selectionFingerprint, selectionChanged.preview.identity.selectionFingerprint);
	assert.notEqual(base.preview.identity.selectionFingerprint, referenceCheckChanged.preview.identity.selectionFingerprint);
	assert.notEqual(base.preview.identity.sourceBodyChecksum, sourceChanged.preview.identity.sourceBodyChecksum);
	assert.notEqual(base.preview.identity.planId, targetChanged.preview.identity.planId);
});

test('preflight module preserves its host-independent zero-write boundary', () => {
	const source = readFileSync('src/core/settings-backup-preflight.ts', 'utf8');
	for (const forbidden of ["from 'obsidian'", '../storage/', 'OperonStorage', 'saveData(', '.adapter.', 'new Date(']) {
		assert.equal(source.includes(forbidden), false, `Preflight source must not contain ${forbidden}`);
	}
});
