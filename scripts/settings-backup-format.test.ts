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
import {
	OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT,
	OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION,
	validateOperonSettingsBackupTableManifestV1,
} from '../src/core/settings-backup-table-manifest';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import { sha256HexV1 } from '../src/agent-runtime/contracts/v1/canonical';
import { serializeOperonTableFile } from '../src/storage/table-file';
import { createDefaultTablePreset } from '../src/types/table';
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

	const includedTablesWithoutInventory = cloneBody(readBodyFixture('minimal-body.json'));
	includedTablesWithoutInventory.scope.tableFiles = 'included';
	assert.throws(() => serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(includedTablesWithoutInventory)));
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

test('logical Table manifest verifies paths, IDs, versions, bytes and hashes', () => {
	const preset = { ...createDefaultTablePreset(), id: 'table-client', name: 'Client table' };
	const tableText = serializeOperonTableFile(preset);
	const tableSha256 = sha256HexV1(tableText);
	const settingsBody = cloneBody(readBodyFixture('minimal-body.json'));
	settingsBody.scope.tableFiles = 'included';
	settingsBody.tableInventory = {
		mode: 'included',
		items: [{ id: preset.id, originalPath: 'Tables/Client.table', sha256: tableSha256 }],
	};
	const settingsText = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(settingsBody));
	const encoder = new TextEncoder();
	const settingsBytes = encoder.encode(settingsText);
	const tableBytes = encoder.encode(tableText);
	const manifest = {
		format: OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_FORMAT,
		manifestVersion: OPERON_SETTINGS_BACKUP_TABLE_MANIFEST_VERSION,
		settings: { path: 'settings.json', sha256: sha256HexV1(settingsText), bytes: settingsBytes.byteLength },
		tableFiles: [{
			id: preset.id,
			originalPath: 'Tables/Client.table',
			path: 'tables/001-client.table',
			formatVersion: 2,
			sha256: tableSha256,
			bytes: tableBytes.byteLength,
		}],
	};
	const entries = [
		{ path: 'settings.json', bytes: settingsBytes },
		{ path: 'tables/001-client.table', bytes: tableBytes },
	];
	assert.equal(validateOperonSettingsBackupTableManifestV1(manifest, entries).ok, true);

	const unsafe = structuredClone(manifest);
	unsafe.tableFiles[0].path = 'tables/../Client.table';
	assert.equal(validateOperonSettingsBackupTableManifestV1(unsafe, entries).ok, false);
	const wrongHash = structuredClone(manifest);
	wrongHash.tableFiles[0].sha256 = '0'.repeat(64);
	assert.equal(validateOperonSettingsBackupTableManifestV1(wrongHash, entries).ok, false);
	const unsupported = structuredClone(manifest);
	unsupported.tableFiles[0].formatVersion = 99;
	assert.equal(validateOperonSettingsBackupTableManifestV1(unsupported, entries).ok, false);
	const duplicate = structuredClone(manifest);
	duplicate.tableFiles.push({ ...duplicate.tableFiles[0], path: 'tables/002-client.table' });
	assert.equal(validateOperonSettingsBackupTableManifestV1(duplicate, entries).ok, false);

	const caseCollision = structuredClone(manifest);
	caseCollision.tableFiles.push({
		...caseCollision.tableFiles[0],
		id: 'table-client-copy',
		originalPath: 'tables/client.table',
		path: 'tables/002-client.table',
	});
	assert.equal(validateOperonSettingsBackupTableManifestV1(caseCollision, entries).ok, false);

	const drivePath = structuredClone(manifest);
	drivePath.tableFiles[0].originalPath = 'C:/Tables/Client.table';
	assert.equal(validateOperonSettingsBackupTableManifestV1(drivePath, entries).ok, false);
	for (const invalidWindowsPath of ['Tables/CON.table', 'Tables/Client .table', 'Tables/Client:Private.table', 'Tables/Client\u0001.table']) {
		const windowsInvalid = structuredClone(manifest);
		windowsInvalid.tableFiles[0].originalPath = invalidWindowsPath;
		assert.equal(validateOperonSettingsBackupTableManifestV1(windowsInvalid, entries).ok, false, invalidWindowsPath);
	}

	const inventoryMismatchBody = cloneBody(settingsBody);
	assert.equal(inventoryMismatchBody.tableInventory?.mode, 'included');
	if (inventoryMismatchBody.tableInventory?.mode === 'included') inventoryMismatchBody.tableInventory.items[0].sha256 = 'f'.repeat(64);
	const inventoryMismatchText = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(inventoryMismatchBody));
	const inventoryMismatchEntries = [
		{ path: 'settings.json', bytes: encoder.encode(inventoryMismatchText) },
		entries[1],
	];
	const inventoryMismatchManifest = structuredClone(manifest);
	inventoryMismatchManifest.settings = {
		path: 'settings.json',
		sha256: sha256HexV1(inventoryMismatchText),
		bytes: encoder.encode(inventoryMismatchText).byteLength,
	};
	assert.equal(validateOperonSettingsBackupTableManifestV1(inventoryMismatchManifest, inventoryMismatchEntries).ok, false);
});
