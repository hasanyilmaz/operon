import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	DEFAULT_SETTINGS,
	migrateSettings,
} from '../src/types/settings';
import {
	adoptMobileNotificationsIntegration,
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	createEmptyMobileNotificationsIntegration,
	getNextMobileNotificationsGeneratedAtEpochMs,
	mergeOperonDataPackage,
	normalizeMobileNotificationsIntegration,
} from '../src/storage/operon-data-package';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';

const VAULT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VAULT_ID = '22222222-2222-4222-8222-222222222222';

test('mobile notification snapshot remains opt-in and lives in the integrations package', () => {
	assert.equal(DEFAULT_SETTINGS.mobileNotificationsSnapshotEnabled, false);
	assert.equal(migrateSettings({ mobileNotificationsSnapshotEnabled: 'true' }).mobileNotificationsSnapshotEnabled, false);
	assert.equal(migrateSettings({ mobileNotificationsSnapshotEnabled: true }).mobileNotificationsSnapshotEnabled, true);

	const dataPackage = buildOperonDataPackageFromSettings(migrateSettings({
		mobileNotificationsSnapshotEnabled: true,
	}));
	assert.equal(dataPackage.integrations.mobileNotifications.snapshotEnabled, true);
	assert.equal(dataPackage.integrations.mobileNotifications.cancelPending, false);
	assert.equal(dataPackage.integrations.mobileNotifications.vaultId, null);
	assert.equal(dataPackage.integrations.mobileNotifications.lastGeneratedAtEpochMs, null);
	assert.equal(
		Object.prototype.hasOwnProperty.call(dataPackage.settings, 'mobileNotificationsSnapshotEnabled'),
		false,
	);
	assert.equal(
		composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).mobileNotificationsSnapshotEnabled,
		true,
	);
});

test('mobile notification snapshot is exposed through declarative Settings Search', () => {
	const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(candidate => (
		candidate.key === 'mobileNotificationsSnapshotEnabled'
	));
	assert.equal(entry?.id, 'integrations.mobileNotificationsSnapshotEnabled');
	assert.equal(entry?.tabId, 'tasksReminders');
	assert.equal(entry?.control, 'toggle');
});

test('mobile notification snapshot controls are desktop-only in both settings renderers', () => {
	const source = readFileSync('src/ui/settings-tab.ts', 'utf8');
	const declarativeStart = source.indexOf('\tprivate buildReminderSettingsItems(');
	const declarativeEnd = source.indexOf('\tprivate buildReminderNotificationTestsDefinitions(', declarativeStart);
	const declarative = source.slice(declarativeStart, declarativeEnd);
	assert.match(
		declarative,
		/Platform\.isDesktopApp\s*\? this\.buildSettingsSearchSettingDefinition\(entries, 'mobileNotificationsSnapshotEnabled'\)\s*:\s*null/u,
		'declarative Settings omits the snapshot toggle outside desktop Obsidian',
	);

	const fallbackStart = source.indexOf('\tprivate renderTasksRemindersTab(');
	const fallbackEnd = source.indexOf('\tprivate configureReminderInAppPreviewSetting(', fallbackStart);
	const fallback = source.slice(fallbackStart, fallbackEnd);
	assert.match(
		fallback,
		/if \(Platform\.isDesktopApp\) \{[\s\S]*?'mobileNotificationsSnapshotEnabled'[\s\S]*?\n\t\t\}/u,
		'fallback Settings omits the snapshot toggle outside desktop Obsidian',
	);
});

test('legacy root toggle migrates without losing integration defaults', () => {
	const fallback = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	const legacy = {
		...fallback,
		settings: {
			...fallback.settings,
			mobileNotificationsSnapshotEnabled: true,
		} as typeof fallback.settings,
		integrations: {
			externalCalendarSources: fallback.integrations.externalCalendarSources,
		},
	};
	const merged = mergeOperonDataPackage(legacy as unknown as Partial<typeof fallback>, fallback);
	assert.equal(merged.integrations.mobileNotifications.snapshotEnabled, true);
	assert.equal(merged.integrations.mobileNotifications.vaultId, null);
});

test('integration normalization fails closed for invalid identity and watermark data', () => {
	assert.deepEqual(normalizeMobileNotificationsIntegration({
		version: 99,
		snapshotEnabled: 'true',
		vaultId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
		lastGeneratedAtEpochMs: -1,
	}), createEmptyMobileNotificationsIntegration());
});

test('snapshot adoption keeps established identity and advances only the watermark', () => {
	const adopted = adoptMobileNotificationsIntegration({
		version: 1,
		snapshotEnabled: true,
		vaultId: VAULT_ID,
		lastGeneratedAtEpochMs: 200,
	}, {
		vaultId: OTHER_VAULT_ID,
		lastGeneratedAtEpochMs: 300,
	});
	assert.equal(adopted.vaultId, VAULT_ID);
	assert.equal(adopted.lastGeneratedAtEpochMs, 300);
	assert.equal(adopted.snapshotEnabled, true);

	const recovered = adoptMobileNotificationsIntegration(createEmptyMobileNotificationsIntegration(), {
		vaultId: OTHER_VAULT_ID,
		lastGeneratedAtEpochMs: 100,
	});
	assert.equal(recovered.vaultId, OTHER_VAULT_ID);
	assert.equal(recovered.lastGeneratedAtEpochMs, 100);
});

test('watermark reservation is monotonic and validates its clock input', () => {
	assert.equal(getNextMobileNotificationsGeneratedAtEpochMs({
		version: 1,
		snapshotEnabled: true,
		vaultId: VAULT_ID,
		lastGeneratedAtEpochMs: 500,
	}, 400), 501);
	assert.equal(getNextMobileNotificationsGeneratedAtEpochMs(createEmptyMobileNotificationsIntegration(), 400, 450), 451);
	assert.equal(getNextMobileNotificationsGeneratedAtEpochMs(createEmptyMobileNotificationsIntegration(), 400), 400);
	assert.throws(() => getNextMobileNotificationsGeneratedAtEpochMs({}, -1));
	assert.throws(() => getNextMobileNotificationsGeneratedAtEpochMs({}, 400, 400 + 5 * 60 * 1000));
});
