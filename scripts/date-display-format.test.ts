import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { computeContextSettingsFingerprintV1 } from '../src/agent-runtime/runtime/settings-fingerprint';
import {
	SETTINGS_BACKUP_COMPATIBILITY_BY_KEY,
	SETTINGS_BACKUP_GROUPS,
} from '../src/core/settings-backup-compatibility';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import { preflightOperonSettingsBackupRestoreV1 } from '../src/core/settings-backup-preflight';
import {
	DATE_DISPLAY_FORMAT_OPTIONS,
	formatUiDate,
	formatUiDatePart,
	getDateDisplayFormatDropdownOptions,
} from '../src/core/ui-date-format';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';
import {
	CURRENT_SETTINGS_VERSION,
	DEFAULT_SETTINGS,
	normalizeDateDisplayFormat,
	migrateSettings,
} from '../src/types/settings';

const CREATED_AT = '2026-09-03T12:00:00.000Z';

test('date display formatter supports all fixed formats without Date parsing', () => {
	assert.equal(formatUiDate('2026-09-03', { dateDisplayFormat: 'YYYY-MM-DD' }), '2026-09-03');
	assert.equal(formatUiDate('2026-09-03', { dateDisplayFormat: 'DD/MM/YYYY' }), '03/09/2026');
	assert.equal(formatUiDate('2026-09-03', { dateDisplayFormat: 'MM/DD/YYYY' }), '09/03/2026');
	assert.equal(formatUiDate('2024-02-29', { dateDisplayFormat: 'DD/MM/YYYY' }), '29/02/2024');
	assert.equal(formatUiDate('2026-12-31', { dateDisplayFormat: 'MM/DD/YYYY' }), '12/31/2026');
	assert.equal(formatUiDate('2027-01-01', { dateDisplayFormat: 'DD/MM/YYYY' }), '01/01/2027');
});

test('invalid and non-canonical dates remain byte-for-byte unchanged', () => {
	for (const value of ['2023-02-29', '2026-13-01', '2026-04-31', '0000-01-01', '2026-9-3', ' 2026-09-03 ']) {
		assert.equal(formatUiDate(value, { dateDisplayFormat: 'DD/MM/YYYY' }), value);
	}
});

test('datetime formatting isolates the validated date prefix and is timezone-independent', () => {
	assert.equal(formatUiDatePart('2026-09-03T23:30:00+14:00', { dateDisplayFormat: 'DD/MM/YYYY' }), '03/09/2026');
	assert.equal(formatUiDatePart('2026-09-03 00:15', { dateDisplayFormat: 'MM/DD/YYYY' }), '09/03/2026');
	assert.equal(formatUiDatePart('2023-02-29T10:00', { dateDisplayFormat: 'DD/MM/YYYY' }), '2023-02-29T10:00');
	assert.equal(formatUiDatePart('Sep 3, 2026', { dateDisplayFormat: 'DD/MM/YYYY' }), 'Sep 3, 2026');
});

test('settings default and normalization preserve the additive no-migration contract', () => {
	assert.equal(CURRENT_SETTINGS_VERSION, 115);
	assert.equal(DEFAULT_SETTINGS.dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({}).dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({ timeFormat: '12h' }).dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({ dateDisplayFormat: 'free-form' }).dateDisplayFormat, 'YYYY-MM-DD');
	assert.equal(migrateSettings({ dateDisplayFormat: 'DD/MM/YYYY' }).dateDisplayFormat, 'DD/MM/YYYY');
	assert.equal(normalizeDateDisplayFormat('MM/DD/YYYY'), 'MM/DD/YYYY');
	assert.equal(normalizeDateDisplayFormat(null), 'YYYY-MM-DD');
});

test('date display preference stays outside the Runtime V1 settings fingerprint', () => {
	const isoSettings = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'YYYY-MM-DD' });
	const localizedSettings = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'DD/MM/YYYY' });
	assert.equal(
		computeContextSettingsFingerprintV1(localizedSettings),
		computeContextSettingsFingerprintV1(isoSettings),
	);
});

test('General Settings and Settings Search share one fixed dropdown contract', () => {
	assert.deepEqual(DATE_DISPLAY_FORMAT_OPTIONS, [
		{ value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-09-03' },
		{ value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 03/09/2026' },
		{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY — 09/03/2026' },
	]);
	assert.deepEqual(getDateDisplayFormatDropdownOptions(), {
		'YYYY-MM-DD': 'YYYY-MM-DD — 2026-09-03',
		'DD/MM/YYYY': 'DD/MM/YYYY — 03/09/2026',
		'MM/DD/YYYY': 'MM/DD/YYYY — 09/03/2026',
	});
	const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(candidate => candidate.key === 'dateDisplayFormat');
	assert.equal(entry?.id, 'settings.dateDisplayFormat');
	assert.equal(entry?.control, 'dropdown');
	assert.ok(entry?.aliases?.includes('date format'));

	const settingsTabSource = readFileSync('src/ui/settings-tab.ts', 'utf8');
	const timeIndex = settingsTabSource.indexOf("t('settings', 'timeFormat')", settingsTabSource.indexOf('private renderGeneralBasicsTab'));
	const dateIndex = settingsTabSource.indexOf("t('settings', 'dateDisplayFormat')", timeIndex);
	const demoIndex = settingsTabSource.indexOf("t('settings', 'demoWorkspace')", dateIndex);
	assert.ok(timeIndex >= 0 && dateIndex > timeIndex && demoIndex > dateIndex);
	assert.ok(settingsTabSource.includes("'timeFormat',\n\t'dateDisplayFormat',"));
});

test('settings backup exports and restores date display format through portable general settings', () => {
	assert.deepEqual(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.dateDisplayFormat, {
		support: 'portable',
		groups: ['general'],
	});
	assert.ok(SETTINGS_BACKUP_GROUPS.find(group => group.id === 'general')?.settingKeys.includes('dateDisplayFormat'));

	const source = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'DD/MM/YYYY' });
	const exported = exportOperonSettingsBackupJsonV1({
		settings: source,
		source: { pluginVersion: '3.6.2', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: CREATED_AT,
	});
	assert.equal(exported.ok, true, exported.diagnostics.map(item => item.message).join('\n'));
	if (!exported.ok) return;
	const decoded = validateOperonSettingsBackupGroupsV1(exported.backup.body.groups);
	assert.equal(decoded.ok, true);
	assert.equal(decoded.payloads.general?.dateDisplayFormat, 'DD/MM/YYYY');

	const target = migrateSettings({ ...DEFAULT_SETTINGS, dateDisplayFormat: 'MM/DD/YYYY' });
	const restored = preflightOperonSettingsBackupRestoreV1({
		sourceJson: exported.json,
		targetSnapshot: {
			settings: target,
			dataPackageSchemaVersion: 2,
			settingsVersion: target.settingsVersion,
			canonicalWritesSuspended: false,
			canonicalWriteSuspensionReason: null,
		},
		selectedGroups: ['general'],
	});
	assert.equal(restored.ok, true);
	assert.equal(restored.restorePlan?.candidateSettings.dateDisplayFormat, 'DD/MM/YYYY');
});
