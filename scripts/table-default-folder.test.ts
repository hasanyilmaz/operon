import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { projectOperonSettingsBackupApplyDataPackageV1 } from '../src/core/settings-backup-apply';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
} from '../src/storage/operon-data-package';
import {
	buildUniqueOperonTableFilePath,
	resolveOperonTableCreationFolder,
} from '../src/storage/table-file';
import { DEFAULT_SETTINGS, migrateSettings, type OperonSettings } from '../src/types/settings';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function settingsWith(overrides: Record<string, unknown>): OperonSettings {
	return migrateSettings({ ...clone(DEFAULT_SETTINGS), ...overrides });
}

test('new Table files retain the historical Operon/Tables default when the setting is absent', () => {
	const legacy = clone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
	delete legacy.tableDefaultFolder;
	const settings = migrateSettings(legacy);
	const dataPackage = buildOperonDataPackageFromSettings(settings);

	assert.equal(settings.tableDefaultFolder, 'Operon/Tables');
	assert.equal(dataPackage.views.tablePresets.tableDefaultFolder, 'Operon/Tables');
	assert.equal(
		buildUniqueOperonTableFilePath(resolveOperonTableCreationFolder(settings.tableDefaultFolder), 'Daily', []),
		'Operon/Tables/Daily.table',
	);
	assert.equal(
		composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).tableDefaultFolder,
		'Operon/Tables',
	);
});

test('custom and vault-root Table destinations are normalized without changing file names', () => {
	const custom = settingsWith({ tableDefaultFolder: ' /Projects/Tables/ ' });
	assert.equal(custom.tableDefaultFolder, 'Projects/Tables');
	assert.equal(resolveOperonTableCreationFolder(custom.tableDefaultFolder), 'Projects/Tables');
	assert.equal(buildUniqueOperonTableFilePath(custom.tableDefaultFolder, 'Roadmap', []), 'Projects/Tables/Roadmap.table');

	const root = settingsWith({ tableDefaultFolder: '' });
	assert.equal(root.tableDefaultFolder, '');
	assert.equal(resolveOperonTableCreationFolder(root.tableDefaultFolder), '');
	assert.equal(buildUniqueOperonTableFilePath(root.tableDefaultFolder, 'Roadmap', []), 'Roadmap.table');
});

test('unsafe Table destinations fail closed after settings-path normalization', () => {
	assert.throws(() => resolveOperonTableCreationFolder('../outside'), /canonical vault-relative path/u);
	assert.throws(() => resolveOperonTableCreationFolder('Tables//nested'), /canonical vault-relative path/u);
	assert.throws(() => resolveOperonTableCreationFolder('C:/Tables'), /canonical vault-relative path/u);
	assert.throws(() => resolveOperonTableCreationFolder('Tables\\nested'), /canonical vault-relative path/u);
});

test('Table-global backup projection changes the destination but preserves existing Table bindings', () => {
	const currentSettings = settingsWith({
		tableDefaultFolder: 'Operon/Tables',
		tablePresetOrderIds: ['table-existing'],
		tablePresetFileBindings: [{ id: 'table-existing', path: 'Existing/Bound.table' }],
		tablePresetFileInitialized: true,
	});
	const current = buildOperonDataPackageFromSettings(currentSettings);
	const candidate = settingsWith({
		...currentSettings,
		tableDefaultFolder: 'Projects/New tables',
		tablePresetOrderIds: ['table-imported'],
		tablePresetFileBindings: [{ id: 'table-imported', path: 'Imported/Unrelated.table' }],
		tablePresetFileInitialized: true,
	});
	const projected = projectOperonSettingsBackupApplyDataPackageV1(current, candidate);

	assert.equal(projected.views.tablePresets.tableDefaultFolder, 'Projects/New tables');
	assert.deepEqual(projected.views.tablePresets.fileBindings, current.views.tablePresets.fileBindings);
	assert.deepEqual(projected.views.tablePresets.presetIds, current.views.tablePresets.presetIds);
	assert.equal(projected.views.tablePresets.initialized, current.views.tablePresets.initialized);
});

test('all Table creation entrypoints route through the shared, explicitly invoked creator flow', () => {
	const source = readFileSync(path.resolve('main.ts'), 'utf8');
	const settingsSource = readFileSync(path.resolve('src/ui/settings-tab.ts'), 'utf8');
	const start = source.indexOf('\tprivate async addTablePresetAndRefresh(');
	const end = source.indexOf('\n\tprivate buildTablePresetSettings', start);
	const settingsStart = settingsSource.indexOf('\tprivate renderTablesTab(');
	const settingsEnd = settingsSource.indexOf('\n\tprivate renderTablePresetRow(', settingsStart);
	assert.ok(start >= 0, 'shared Table creation flow must exist');
	assert.ok(end > start, 'shared Table creation flow must have a bounded body');
	assert.ok(settingsStart >= 0, 'Table settings renderer must exist');
	assert.ok(settingsEnd > settingsStart, 'Table settings renderer must have a bounded body');
	const creator = source.slice(start, end);
	const tableSettings = settingsSource.slice(settingsStart, settingsEnd);

	assert.match(creator, /resolveOperonTableCreationFolder\(this\.settings\.tableDefaultFolder\)/u);
	assert.match(creator, /await this\.ensureVaultFolder\(folder\)/u);
	assert.match(creator, /buildUniqueOperonTableFilePath\(\s*folder,/u);
	assert.doesNotMatch(creator, /Operon\/Tables/u);
	assert.match(source, /await this\.addTablePresetAndRefresh\(preset\);/u);
	assert.match(source, /createPreset: \(preset, context\) => this\.addTablePresetAndRefresh\(/u);
	assert.match(source, /onCreate: \(created\) => this\.addTablePresetAndRefresh\(created, resolveLeaf\(\)\)/u);
	assert.match(source, /onDuplicate: \(created\) => this\.addTablePresetAndRefresh\(created, resolveLeaf\(\), presetId\)/u);
	assert.match(tableSettings, /new FolderSuggest\(this\.app, text\.inputEl/u);
	assert.doesNotMatch(tableSettings, /ensureVaultFolder|createFolder/u);
});
