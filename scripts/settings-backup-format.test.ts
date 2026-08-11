import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	ALL_OPERON_SETTINGS_BACKUP_KEYS,
	SETTINGS_BACKUP_COMPATIBILITY_BY_KEY,
	SETTINGS_BACKUP_GROUPS,
	SETTINGS_BACKUP_SYSTEM_KEY_OVERRIDE_FIELDS,
	assertSettingsBackupCompatibilityRegistryExhaustive,
} from '../src/core/settings-backup-compatibility';
import {
	OPERON_SETTINGS_BACKUP_GROUP_NAMES,
	OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES,
	buildOperonSettingsBackupV1,
	canonicalizeOperonSettingsBackupJson,
	classifyOperonSettingsBackupV1,
	parseOperonSettingsBackupV1,
	serializeOperonSettingsBackupV1,
	type OperonSettingsBackupBodyV1,
	type OperonSettingsBackupCompatibilitySupport,
} from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import { CURRENT_SETTINGS_VERSION, DEFAULT_SETTINGS } from '../src/types/settings';

const FIXTURE_DIR = path.resolve('scripts/settings-backup-fixtures');

function readFixture(name: string): string {
	return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

function readBodyFixture(name: string): OperonSettingsBackupBodyV1 {
	return JSON.parse(readFixture(name)) as OperonSettingsBackupBodyV1;
}

function currentSupport(): OperonSettingsBackupCompatibilitySupport {
	return {
		dataPackageSchemaVersions: [1, 2],
		currentSettingsVersion: CURRENT_SETTINGS_VERSION,
		minimumSettingsVersion: 1,
		groupCodecVersions: Object.fromEntries(
			OPERON_SETTINGS_BACKUP_GROUP_NAMES.map(group => [group, 1]),
		) as OperonSettingsBackupCompatibilitySupport['groupCodecVersions'],
	};
}

function cloneBody(body: OperonSettingsBackupBodyV1): OperonSettingsBackupBodyV1 {
	return JSON.parse(JSON.stringify(body)) as OperonSettingsBackupBodyV1;
}

test('immutable fixture catalog matches every tracked fixture byte-for-byte', () => {
	const manifest = JSON.parse(readFixture('manifest.json')) as {
		version: number;
		algorithm: string;
		files: Record<string, string>;
	};
	assert.equal(manifest.version, 1);
	assert.equal(manifest.algorithm, 'sha256');
	for (const [name, expected] of Object.entries(manifest.files)) {
		const actual = createHash('sha256').update(readFileSync(path.join(FIXTURE_DIR, name))).digest('hex');
		assert.equal(actual, expected, `${name} fixture drifted without a manifest update`);
	}
});

test('current minimal and representative profiles deterministically round-trip', () => {
	for (const fixture of ['minimal-body.json', 'representative-body.json']) {
		const backup = buildOperonSettingsBackupV1(readBodyFixture(fixture));
		const first = serializeOperonSettingsBackupV1(backup);
		const parsed = parseOperonSettingsBackupV1(first);
		assert.equal(parsed.ok, true, fixture);
		if (!parsed.ok) continue;
		assert.equal(serializeOperonSettingsBackupV1(parsed.value), first);
		assert.equal(classifyOperonSettingsBackupV1(parsed.value, currentSupport()).classification, 'exact');
	}
});

test('canonical JSON preserves user string code points and normalizes only negative zero', () => {
	assert.notEqual(
		canonicalizeOperonSettingsBackupJson({ value: 'é' }),
		canonicalizeOperonSettingsBackupJson({ value: 'e\u0301' }),
	);
	assert.equal(canonicalizeOperonSettingsBackupJson({ value: -0 }), '{"value":0}');
	assert.throws(() => canonicalizeOperonSettingsBackupJson({ value: Number.NaN }));
	const sparse = new Array<unknown>(1);
	assert.throws(() => canonicalizeOperonSettingsBackupJson(sparse));
	assert.throws(() => canonicalizeOperonSettingsBackupJson(JSON.parse('{"__proto__":true}')));
});

test('semantic checksum ignores display whitespace and key order but detects body changes', () => {
	const backup = buildOperonSettingsBackupV1(readBodyFixture('minimal-body.json'));
	const compact = JSON.stringify(backup);
	const pretty = serializeOperonSettingsBackupV1(backup);
	assert.equal(parseOperonSettingsBackupV1(compact).ok, true);
	assert.equal(parseOperonSettingsBackupV1(pretty).ok, true);

	const tampered = JSON.parse(compact) as Record<string, unknown>;
	(tampered.body as Record<string, unknown>).createdAt = '2026-08-10T17:00:00.000Z';
	const parsed = parseOperonSettingsBackupV1(JSON.stringify(tampered));
	assert.equal(parsed.ok, false);
	assert.equal(parsed.classification, 'integrity-failed');
});

test('parser rejects malformed, future container, unknown fields and oversized source', () => {
	assert.equal(parseOperonSettingsBackupV1(readFixture('malformed.json')).classification, 'invalid');
	assert.equal(parseOperonSettingsBackupV1(readFixture('future-format.json')).classification, 'unsupported');

	const backup = buildOperonSettingsBackupV1(readBodyFixture('minimal-body.json'));
	const unknown = { ...backup, typo: true };
	assert.equal(parseOperonSettingsBackupV1(JSON.stringify(unknown)).classification, 'invalid');
	assert.equal(
		parseOperonSettingsBackupV1(' '.repeat(OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES + 1)).classification,
		'invalid',
	);
});

test('compatibility is graded for old, missing, future optional and future foundational groups', () => {
	const base = readBodyFixture('minimal-body.json');
	const old = cloneBody(base);
	old.source.settingsVersion -= 1;
	old.source.dataPackageSchemaVersion = 1;
	assert.equal(classifyOperonSettingsBackupV1(buildOperonSettingsBackupV1(old), currentSupport()).classification, 'exact');

	const missingOptional = cloneBody(base);
	delete missingOptional.groups.filters;
	const missingParsed = parseOperonSettingsBackupV1(serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(missingOptional)));
	assert.equal(missingParsed.ok, true);
	if (missingParsed.ok) {
		const compatibility = classifyOperonSettingsBackupV1(missingParsed.value, currentSupport());
		assert.equal(compatibility.classification, 'exact');
		assert.equal(compatibility.groups.find(group => group.group === 'filters')?.classification, 'not-included');
	}

	const futureOptional = cloneBody(base);
	const filters = futureOptional.groups.filters;
	assert.ok(filters);
	filters.codecVersion = 2;
	assert.equal(classifyOperonSettingsBackupV1(buildOperonSettingsBackupV1(futureOptional), currentSupport()).classification, 'partial');

	const futureCore = cloneBody(base);
	futureCore.groups.general.codecVersion = 2;
	assert.equal(classifyOperonSettingsBackupV1(buildOperonSettingsBackupV1(futureCore), currentSupport()).classification, 'blocked');

	const unknownLegacyOptional = cloneBody(base);
	assert.ok(unknownLegacyOptional.groups.filters);
	unknownLegacyOptional.groups.filters.codecVersion = 0;
	assert.equal(classifyOperonSettingsBackupV1(buildOperonSettingsBackupV1(unknownLegacyOptional), currentSupport()).classification, 'partial');
	const withRegisteredMigration = currentSupport();
	withRegisteredMigration.groupMigrationSourceCodecVersions = { filters: [0] };
	assert.equal(classifyOperonSettingsBackupV1(buildOperonSettingsBackupV1(unknownLegacyOptional), withRegisteredMigration).classification, 'migration-required');

	const unknownLegacyCore = cloneBody(base);
	unknownLegacyCore.groups.general.codecVersion = 0;
	assert.equal(classifyOperonSettingsBackupV1(buildOperonSettingsBackupV1(unknownLegacyCore), currentSupport()).classification, 'blocked');
});

test('scope declarations authoritatively match sensitive and external-resource groups', () => {
	const excludedWithSensitiveGroup = cloneBody(readBodyFixture('minimal-body.json'));
	excludedWithSensitiveGroup.groups['external-calendars'] = { codecVersion: 1, data: { externalCalendars: [] } };
	assert.throws(() => serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(excludedWithSensitiveGroup)));

	const includedWithoutSensitiveGroup = cloneBody(readBodyFixture('minimal-body.json'));
	includedWithoutSensitiveGroup.scope.externalCalendarUrls = 'included';
	assert.throws(() => serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(includedWithoutSensitiveGroup)));

	const includedTables = structuredClone(readBodyFixture('minimal-body.json')) as unknown as Record<string, unknown>;
	(includedTables.scope as Record<string, unknown>).tableFiles = 'included';
	assert.equal(parseOperonSettingsBackupV1(JSON.stringify({
		...buildOperonSettingsBackupV1(readBodyFixture('minimal-body.json')),
		body: includedTables,
	})).classification, 'invalid');

	const legacyInventory = structuredClone(readBodyFixture('minimal-body.json')) as unknown as Record<string, unknown>;
	legacyInventory.tableInventory = { mode: 'excluded', items: [] };
	assert.throws(() => serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(
		legacyInventory as unknown as OperonSettingsBackupBodyV1,
	)));
});

test('compatibility registry is exhaustive and preserves approved portability boundaries', () => {
	assert.equal(new Set(ALL_OPERON_SETTINGS_BACKUP_KEYS).size, ALL_OPERON_SETTINGS_BACKUP_KEYS.length);
	assert.equal(ALL_OPERON_SETTINGS_BACKUP_KEYS.length, Object.keys(DEFAULT_SETTINGS).length);
	assertSettingsBackupCompatibilityRegistryExhaustive(DEFAULT_SETTINGS);
	assert.equal(SETTINGS_BACKUP_GROUPS.length, 11);
	assert.deepEqual(SETTINGS_BACKUP_SYSTEM_KEY_OVERRIDE_FIELDS, [
		'visiblePropertyName',
		'hideInFileTaskView',
		'icon',
	]);
	assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.fileTasksFolder.support, 'vault-reference');
	assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.taskFinderSelectedProjectId.support, 'vault-reference');
	assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.externalCalendars.support, 'sensitive-opt-in');
	assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.tablePresets.support, 'external-resource');
	assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.settingsVersion.support, 'operational-excluded');
	assert.equal(SETTINGS_BACKUP_GROUPS.find(group => group.id === 'external-calendars')?.defaultSelected, false);
	assert.deepEqual(
		SETTINGS_BACKUP_GROUPS.filter(group => group.id !== 'system-key-mappings').map(group => group.mergeStrategy),
		Array(10).fill('replace'),
	);
});

test('representative group payload preserves Custom Key, Filter, Calendar, Kanban and favorite dependencies', () => {
	const body = readBodyFixture('representative-body.json');
	const result = validateOperonSettingsBackupGroupsV1(body.groups);
	assert.equal(result.ok, true, result.diagnostics.map(item => `${item.path}: ${item.message}`).join('\n'));
	assert.deepEqual(
		Object.keys(result.payloads['system-key-mappings']?.overrides[0] ?? {}).sort(),
		['canonicalKey', 'hideInFileTaskView', 'icon', 'visiblePropertyName'],
	);
	assert.equal(result.payloads['custom-keys']?.customKeys[0]?.canonicalKey, 'client');
	assert.equal(result.payloads.filters?.filterSets[0]?.conditions[0]?.field, 'client');
	assert.equal(result.payloads.calendar?.calendarPresets[0]?.filterSetId, 'filter-client');
	assert.equal(result.payloads.kanban?.kanbanPresets[0]?.swimlaneBy, 'client');
});

test('group codecs reject duplicates, reserved filters, unknown fields and dangling references', () => {
	const duplicate = cloneBody(readBodyFixture('representative-body.json'));
	const customData = duplicate.groups['custom-keys'].data as { customKeys: unknown[] };
	customData.customKeys.push(structuredClone(customData.customKeys[0]));
	let result = validateOperonSettingsBackupGroupsV1(duplicate.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.message.includes('Duplicate canonical key')));

	const reserved = cloneBody(readBodyFixture('representative-body.json'));
	const filterData = reserved.groups.filters?.data as { filterSets: Array<Record<string, unknown>> };
	filterData.filterSets[0].id = 'fs_dynamic_file_task';
	result = validateOperonSettingsBackupGroupsV1(reserved.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.message.includes('Reserved dynamic filter')));

	const dynamicTemplates = cloneBody(readBodyFixture('representative-body.json'));
	const dynamicFilterData = dynamicTemplates.groups.filters?.data as {
		filterSets: Array<Record<string, unknown>>;
		dynamicTemplates?: Record<string, unknown>;
	};
	dynamicFilterData.dynamicTemplates = {
		fileTask: {
			name: 'File tasks', icon: 'file-check', sorts: [{ field: 'priority', order: 'desc' }],
			groupBy: 'status', groupOrder: 'desc',
		},
		subtasks: {
			name: 'Subtasks', icon: 'list-checks', sorts: [{ field: 'dateDue', order: 'asc' }],
			subgroupBy: 'status', subgroupOrder: 'asc',
		},
	};
	result = validateOperonSettingsBackupGroupsV1(dynamicTemplates.groups);
	assert.equal(result.ok, true, result.diagnostics.map(item => item.message).join('\n'));

	for (const [field, value] of Object.entries({
		id: 'fs_dynamic_file_task',
		rootGroup: {},
		conditions: [],
		matchLogic: 'all',
		sortBy: 'priority',
		sortOrder: 'asc',
	})) {
		const lockedDynamicField = cloneBody(dynamicTemplates);
		const lockedPreferences = (
			(lockedDynamicField.groups.filters?.data as { dynamicTemplates: { fileTask: Record<string, unknown> } })
				.dynamicTemplates.fileTask
		);
		lockedPreferences[field] = value;
		result = validateOperonSettingsBackupGroupsV1(lockedDynamicField.groups);
		assert.equal(result.ok, false, field);
		assert.ok(result.diagnostics.some(item => (
			item.path.endsWith(`.dynamicTemplates.fileTask.${field}`) && item.code === 'unknown-field'
		)), field);
	}

	const incompleteDynamicTemplates = cloneBody(dynamicTemplates);
	delete (
		(incompleteDynamicTemplates.groups.filters?.data as { dynamicTemplates: Record<string, unknown> })
			.dynamicTemplates.subtasks
	);
	result = validateOperonSettingsBackupGroupsV1(incompleteDynamicTemplates.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.path.endsWith('.dynamicTemplates.subtasks') && item.code === 'required'));

	const dangling = cloneBody(readBodyFixture('representative-body.json'));
	(dangling.groups['custom-keys'].data as { customKeys: unknown[] }).customKeys = [];
	result = validateOperonSettingsBackupGroupsV1(dangling.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.message.includes('missing Custom Key')));

	const unknown = cloneBody(readBodyFixture('representative-body.json'));
	(unknown.groups['system-key-mappings'].data as Record<string, unknown>).type = 'text';
	result = validateOperonSettingsBackupGroupsV1(unknown.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.code === 'unknown-field'));

	const malformedCustomKey = cloneBody(readBodyFixture('representative-body.json'));
	(malformedCustomKey.groups['custom-keys'].data as { customKeys: Array<Record<string, unknown>> }).customKeys[0].canonicalKey = 42;
	assert.doesNotThrow(() => validateOperonSettingsBackupGroupsV1(malformedCustomKey.groups));
	result = validateOperonSettingsBackupGroupsV1(malformedCustomKey.groups);
	assert.equal(result.ok, false);

	const canonicalCollision = cloneBody(readBodyFixture('representative-body.json'));
	(canonicalCollision.groups['system-key-mappings'].data as { overrides: unknown[] }).overrides = [];
	(canonicalCollision.groups['custom-keys'].data as { customKeys: Array<Record<string, unknown>> }).customKeys[0].canonicalKey = 'dateDue';
	result = validateOperonSettingsBackupGroupsV1(canonicalCollision.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.message.includes('collides with a system key')));

	const wrongGeneralType = cloneBody(readBodyFixture('representative-body.json'));
	(wrongGeneralType.groups.general.data as Record<string, unknown>).language = 42;
	result = validateOperonSettingsBackupGroupsV1(wrongGeneralType.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.path.endsWith('.language')));

	const invalidCustomEnum = cloneBody(readBodyFixture('representative-body.json'));
	(invalidCustomEnum.groups['custom-keys'].data as { customKeys: Array<Record<string, unknown>> }).customKeys[0].sync = 'sometimes';
	result = validateOperonSettingsBackupGroupsV1(invalidCustomEnum.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.path.includes('custom-keys')));

	const invalidKanbanEnum = cloneBody(readBodyFixture('representative-body.json'));
	(invalidKanbanEnum.groups.kanban?.data as { kanbanPresets: Array<{ sortRules: Array<Record<string, unknown>> }> }).kanbanPresets[0].sortRules[0].direction = 'sideways';
	result = validateOperonSettingsBackupGroupsV1(invalidKanbanEnum.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.path.includes('kanban')));

	const missingDependencyAuthority = cloneBody(readBodyFixture('representative-body.json'));
	delete missingDependencyAuthority.groups.filters;
	result = validateOperonSettingsBackupGroupsV1(missingDependencyAuthority.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.code === 'required' && item.message.includes('target settings context')));

	const missingCustomKeyAuthority = cloneBody(readBodyFixture('representative-body.json'));
	Reflect.deleteProperty(missingCustomKeyAuthority.groups, 'custom-keys');
	result = validateOperonSettingsBackupGroupsV1(missingCustomKeyAuthority.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.code === 'required' && item.message.includes('Custom Key reference')));

	const missingFavoriteAuthority = cloneBody(readBodyFixture('representative-body.json'));
	delete missingFavoriteAuthority.groups.calendar;
	result = validateOperonSettingsBackupGroupsV1(missingFavoriteAuthority.groups);
	assert.equal(result.ok, false);
	assert.ok(result.diagnostics.some(item => item.code === 'required' && item.message.includes('Favorite references')));
});
