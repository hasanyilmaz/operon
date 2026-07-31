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
	mergeOperonDataPackage,
	normalizeMobileNotificationsIntegration,
} from '../src/storage/operon-data-package';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';

const VAULT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_VAULT_ID = '22222222-2222-4222-8222-222222222222';

test('mobile notification snapshots are automatic and no longer a user setting', () => {
	assert.equal(
		Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, 'mobileNotificationsSnapshotEnabled'),
		false,
	);
	assert.equal(
		Object.prototype.hasOwnProperty.call(
			migrateSettings({ mobileNotificationsSnapshotEnabled: false }),
			'mobileNotificationsSnapshotEnabled',
		),
		false,
	);

	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	assert.deepEqual(dataPackage.integrations.mobileNotifications, {
		version: 1,
		snapshotEnabled: true,
		cancelPending: false,
		vaultId: null,
		lastGeneratedAtEpochMs: null,
	});
	assert.equal(
		Object.prototype.hasOwnProperty.call(
			composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS),
			'mobileNotificationsSnapshotEnabled',
		),
		false,
	);
});

test('mobile notification snapshot controls are absent from Settings Search and both renderers', () => {
	assert.equal(
		OPERON_SETTINGS_SEARCH_REGISTRY.some(candidate => (
			String(candidate.key) === 'mobileNotificationsSnapshotEnabled'
		)),
		false,
	);

	const source = readFileSync('src/ui/settings-tab.ts', 'utf8');
	assert.equal(source.includes('mobileNotificationsSnapshotEnabled'), false);
	assert.equal(source.includes('mobileNotificationsSnapshotDesc'), false);

	const mainSource = readFileSync('main.ts', 'utf8');
	assert.equal(
		mainSource.includes('canProduce: () => Platform.isMobile || Platform.isMobileApp'),
		true,
		'production wiring must remain mobile-only',
	);
	const exporterWiring = mainSource.slice(
		mainSource.indexOf('this.mobileNotificationsExporter = new MobileNotificationsExporter'),
		mainSource.indexOf('setExistingIdsProvider'),
	);
	assert.equal(exporterWiring.includes('Platform.isDesktopApp'), false);
});

test('legacy toggle and integration state canonicalize to automatic behavior while preserving vault identity', () => {
	const fallback = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	const legacy = {
		...fallback,
		settings: {
			...fallback.settings,
			mobileNotificationsSnapshotEnabled: false,
		},
		integrations: {
			...fallback.integrations,
			mobileNotifications: {
				version: 1,
				snapshotEnabled: false,
				cancelPending: true,
				vaultId: VAULT_ID,
				lastGeneratedAtEpochMs: 500,
			},
		},
	};
	const merged = mergeOperonDataPackage(legacy as Partial<typeof fallback>, fallback);
	assert.deepEqual(merged.integrations.mobileNotifications, {
		version: 1,
		snapshotEnabled: true,
		cancelPending: false,
		vaultId: VAULT_ID,
		lastGeneratedAtEpochMs: null,
	});
	assert.equal(
		Object.prototype.hasOwnProperty.call(merged.settings, 'mobileNotificationsSnapshotEnabled'),
		false,
	);
});

test('integration normalization ignores retired state and fails closed for invalid identity', () => {
	assert.deepEqual(normalizeMobileNotificationsIntegration({
		version: 99,
		snapshotEnabled: false,
		cancelPending: true,
		vaultId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'.toUpperCase(),
		lastGeneratedAtEpochMs: 500,
	}), createEmptyMobileNotificationsIntegration());
});

test('snapshot adoption keeps an established identity and ignores the retired watermark', () => {
	const adopted = adoptMobileNotificationsIntegration({
		version: 1,
		snapshotEnabled: false,
		cancelPending: true,
		vaultId: VAULT_ID,
		lastGeneratedAtEpochMs: 200,
	}, {
		vaultId: OTHER_VAULT_ID,
	});
	assert.deepEqual(adopted, {
		version: 1,
		snapshotEnabled: true,
		cancelPending: false,
		vaultId: VAULT_ID,
		lastGeneratedAtEpochMs: null,
	});

	const recovered = adoptMobileNotificationsIntegration(createEmptyMobileNotificationsIntegration(), {
		vaultId: OTHER_VAULT_ID,
	});
	assert.equal(recovered.vaultId, OTHER_VAULT_ID);
});
