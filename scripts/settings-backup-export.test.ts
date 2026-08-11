import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { App } from 'obsidian';
import {
	exportOperonSettingsBackupJsonV1,
	suggestOperonSettingsBackupFileNameV1,
} from '../src/core/settings-backup-export';
import { parseOperonSettingsBackupV1, type OperonSettingsBackupBodyV1 } from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	buildOperonDataPackageFromSettings,
	type OperonDataPackageV1,
} from '../src/storage/operon-data-package';
import { OperonDataPackageStore } from '../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { OperonStorage } from '../src/storage/operon-storage';
import { DEFAULT_SETTINGS, migrateSettings, type OperonSettings } from '../src/types/settings';

const CREATED_AT = '2026-08-11T09:30:45.000Z';
const SECRET_URL = 'https://example.invalid/private-token.ics';
const SECRET_VAULT_ID = 'SECRET_VAULT_ID';
const SECRET_PINNED_ID = 'SECRET_PINNED_ID';
const SECRET_CONSUMER_ID = 'SECRET_CONSUMER_ID';
const FIXTURE_DIR = path.resolve('scripts/settings-backup-fixtures');

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
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
		tablePresetOrderIds: ['table-second', 'table-first'],
		tablePresetFileBindings: [
			{ id: 'table-first', path: 'Tables/First.table' },
			{ id: 'table-second', path: 'Tables/Second.table' },
		],
		releaseNotesLastShownVersion: 'private-update-cursor',
		lastNotifiedReleaseVersion: 'private-notification-cursor',
	});
}

function exportInput(settings: OperonSettings, includeExternalCalendarUrls = false) {
	return {
		settings,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: CREATED_AT,
		includeExternalCalendarUrls,
	};
}

function deepFreeze(value: unknown): void {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 3000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

test('export is deterministic, parseable and does not mutate its committed snapshot', () => {
	const settings = representativeSettings();
	settings.filterSets.push({ ...clone(settings.filterSets[0]), id: 'fs_dynamic_file_task' });
	deepFreeze(settings);
	const first = exportOperonSettingsBackupJsonV1(exportInput(settings));
	const second = exportOperonSettingsBackupJsonV1(exportInput(settings));
	assert.equal(first.ok, true, first.diagnostics.map(item => `${item.path}: ${item.message}`).join('\n'));
	assert.equal(second.ok, true);
	if (!first.ok || !second.ok) return;
	assert.equal(first.json, second.json);
	assert.equal(first.bodyChecksum, second.bodyChecksum);
	assert.equal(first.suggestedFileName, 'operon-settings-backup-20260811T093045Z.json');
	assert.equal(parseOperonSettingsBackupV1(first.json).ok, true);
	assert.equal(first.backup.body.groups['external-calendars'], undefined);
	const decoded = validateOperonSettingsBackupGroupsV1(first.backup.body.groups);
	assert.equal(decoded.ok, true);
	assert.equal(decoded.payloads['custom-keys']?.customKeys[0]?.canonicalKey, 'client');
	assert.equal(decoded.payloads.filters?.filterSets[0]?.id, 'filter-client');
	assert.equal(decoded.payloads.calendar?.calendarDefaultPresetId, 'calendar-client');
	assert.equal(decoded.payloads.kanban?.kanbanDefaultPresetId, 'kanban-client');
	assert.equal(first.json.includes('fs_dynamic_file_task'), false);
	assert.equal(first.json.includes('private-update-cursor'), false);
	assert.equal(first.json.includes('private-notification-cursor'), false);
	assert.equal(first.report.recordCounts.customKeys, 1);
	assert.equal(first.report.recordCounts.filters, 1);
	assert.equal(first.report.recordCounts.reservedFiltersOmitted, 1);
});

test('export filename helper uses the exact UTC stamp and a safe fallback', () => {
	assert.equal(
		suggestOperonSettingsBackupFileNameV1('2026-08-11T09:30:45.000Z'),
		'operon-settings-backup-20260811T093045Z.json',
	);
	assert.equal(suggestOperonSettingsBackupFileNameV1('not-a-timestamp'), 'operon-settings-backup.json');
});

test('external calendar URLs are absent by default and included only by explicit opt-in', () => {
	const settings = representativeSettings();
	assert.equal(settings.externalCalendars[0]?.url, SECRET_URL);
	if (settings.externalCalendars[0]) settings.externalCalendars[0].id = SECRET_URL;
	if (settings.calendarPresets[0]) settings.calendarPresets[0].externalCalendarVisibility = { [SECRET_URL]: true };
	const excluded = exportOperonSettingsBackupJsonV1(exportInput(settings));
	assert.equal(excluded.ok, true);
	if (!excluded.ok) return;
	assert.equal(excluded.json.includes(SECRET_URL), false);
	assert.equal(JSON.stringify(excluded.report).includes(SECRET_URL), false);
	assert.equal(JSON.stringify(excluded.diagnostics).includes(SECRET_URL), false);
	assert.deepEqual(excluded.report.externalCalendars, {
		included: false,
		sourceCount: 1,
		includedUrlCount: 0,
		maskedUrlCount: 1,
	});

	const included = exportOperonSettingsBackupJsonV1(exportInput(settings, true));
	assert.equal(included.ok, true);
	if (!included.ok) return;
	assert.equal(included.json.includes(SECRET_URL), true);
	assert.equal(included.backup.body.groups['external-calendars']?.codecVersion, 1);
});

test('Table file authority is omitted and never blocks configuration export', () => {
	const settings = representativeSettings();
	settings.tablePresetFileBindings.push(
		{ id: 'table-first', path: 'tables/first.table' },
		{ id: 'unsafe', path: 'Tables/CON.table' },
	);
	const result = exportOperonSettingsBackupJsonV1(exportInput(settings));
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(Object.prototype.hasOwnProperty.call(result.backup.body, 'tableInventory'), false);
	assert.equal(Object.prototype.hasOwnProperty.call(result.report, 'tableFiles'), false);
	assert.equal(result.json.includes('tablePresets'), false);
	assert.equal(result.json.includes('tablePresetFileBindings'), false);
	assert.equal(result.json.includes('tablePresetOrderIds'), false);
	assert.equal(result.json.includes('tableDefaultPresetId'), false);
	assert.deepEqual(
		result.backup.body.groups['preset-favorites']?.data,
		{
			presetFavorites: {
				calendar: ['calendar-client'],
				filter: ['filter-client'],
				kanban: ['kanban-client'],
				table: [],
			},
		},
	);

	const malformedAuthority = representativeSettings() as unknown as Record<string, unknown>;
	malformedAuthority.tablePresetFileBindings = null;
	const malformedResult = exportOperonSettingsBackupJsonV1(
		exportInput(malformedAuthority as unknown as OperonSettings),
	);
	assert.equal(malformedResult.ok, true);
	if (malformedResult.ok) assert.equal(malformedResult.json.includes('tablePresetFileBindings'), false);
});

test('validation failures never return a partial JSON artifact', () => {
	const invalidTimestamp = exportOperonSettingsBackupJsonV1({
		...exportInput(representativeSettings()),
		createdAt: 'not-a-time',
	});
	assert.equal(invalidTimestamp.ok, false);
	assert.equal(invalidTimestamp.json, null);
	assert.equal(invalidTimestamp.backup, null);

	const cyclic = representativeSettings() as OperonSettings & { cycle?: unknown };
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	cyclic.colorPalette = cycle as never;
	const cyclicResult = exportOperonSettingsBackupJsonV1(exportInput(cyclic));
	assert.equal(cyclicResult.ok, false);
	assert.equal(cyclicResult.json, null);

	const oversized = representativeSettings();
	oversized.fileTasksFolder = 'x'.repeat(11 * 1024 * 1024);
	const oversizedResult = exportOperonSettingsBackupJsonV1(exportInput(oversized));
	assert.equal(oversizedResult.ok, false);
	assert.equal(oversizedResult.json, null);

});

class MemoryAdapter {
	readonly folders = new Set(['.obsidian']);
	readonly files = new Map<string, string>();
	writeCount = 0;

	async exists(pathValue: string): Promise<boolean> { return this.folders.has(pathValue) || this.files.has(pathValue); }
	async mkdir(pathValue: string): Promise<void> { this.folders.add(pathValue); }
	async read(pathValue: string): Promise<string> {
		const value = this.files.get(pathValue);
		if (value === undefined) throw new Error(`Missing file: ${pathValue}`);
		return value;
	}
	async write(pathValue: string, data: string): Promise<void> { this.writeCount += 1; this.files.set(pathValue, data); }
	async remove(pathValue: string): Promise<void> { this.files.delete(pathValue); }
	async rename(from: string, to: string): Promise<void> {
		const value = await this.read(from);
		this.files.set(to, value);
		this.files.delete(from);
	}
}

test('committed package capture waits for prior publication and performs no extra write', async () => {
	const adapter = new MemoryAdapter();
	let committed = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let releaseSave!: () => void;
	let signalStarted!: () => void;
	const saveStarted = new Promise<void>(resolve => { signalStarted = resolve; });
	const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
	let saveCount = 0;
	const store = new OperonDataPackageStore(adapter, buildOperonStoragePaths('.obsidian', 'operon'), {
		loadData: async () => clone(committed),
		saveData: async raw => {
			saveCount += 1;
			signalStarted();
			await saveGate;
			committed = clone(raw as OperonDataPackageV1);
		},
	});
	await store.initialize(DEFAULT_SETTINGS, 'en');
	const update = store.updateDataPackage(current => ({
		...current,
		settings: { ...current.settings, language: 'tr' },
	}));
	await withTimeout(saveStarted, 'package save start');
	let captureSettled = false;
	const capture = store.captureCommittedSettingsSnapshot(DEFAULT_SETTINGS).then(snapshot => {
		captureSettled = true;
		return snapshot;
	});
	await Promise.resolve();
	assert.equal(captureSettled, false);
	releaseSave();
	await withTimeout(update, 'package update');
	const snapshot = await withTimeout(capture, 'package committed snapshot capture');
	assert.equal(snapshot.settings.language, 'tr');
	assert.equal(saveCount, 1);
	snapshot.settings.language = 'de';
	assert.equal(store.getDataPackage().settings.language, 'tr');
});

test('OperonStorage committed snapshot capture is zero-write and reports suspension safely', async () => {
	const adapter = new MemoryAdapter();
	let committed = buildOperonDataPackageFromSettings(representativeSettings());
	committed.integrations.mobileNotifications.vaultId = SECRET_VAULT_ID;
	committed.state.pinnedTasks = {
		version: 1,
		itemsById: {
			[SECRET_PINNED_ID]: { pinned: true, updatedAt: CREATED_AT },
		},
		manualOrder: { operonIds: [SECRET_PINNED_ID], updatedAt: CREATED_AT },
	};
	committed.integrations.developerApi = {
		version: 1,
		consumersById: {
			[SECRET_CONSUMER_ID]: {
				consumerId: SECRET_CONSUMER_ID,
				consumerName: 'Private consumer',
				consumerVersion: '1.0.0',
				approvedMajorVersion: 1,
				state: 'active',
				revision: 1,
				grantedCapabilities: ['tasks.read'],
				pendingCapabilities: [],
				createdAt: CREATED_AT,
				updatedAt: CREATED_AT,
			},
		},
	};
	let saveCount = 0;
	let failNextSave = false;
	let waitForSave: Promise<void> | null = null;
	let signalSaveStarted: (() => void) | null = null;
	const app = {
		locale: 'en',
		vault: { configDir: '.obsidian', adapter },
	} as unknown as App;
	const storage = new OperonStorage(app, {
		loadData: async () => clone(committed),
		saveData: async raw => {
			saveCount += 1;
			signalSaveStarted?.();
			if (waitForSave) await waitForSave;
			if (failNextSave) {
				failNextSave = false;
				throw new Error('Injected settings save failure');
			}
			committed = clone(raw as OperonDataPackageV1);
		},
	});
	await storage.initialize();
	let releaseSave!: () => void;
	let startSave!: () => void;
	waitForSave = new Promise<void>(resolve => { releaseSave = resolve; });
	const saveStarted = new Promise<void>(resolve => { startSave = resolve; });
	signalSaveStarted = startSave;
	const update = storage.updateSettings({ language: 'de' });
	await withTimeout(saveStarted, 'settings save start');
	let captureSettled = false;
	const capture = storage.captureCommittedSettingsBackupSnapshot().then(value => {
		captureSettled = true;
		return value;
	});
	await Promise.resolve();
	assert.equal(captureSettled, false);
	releaseSave();
	await withTimeout(update, 'settings update');
	const snapshot = await withTimeout(capture, 'settings committed snapshot capture');
	assert.equal(snapshot.settings.language, 'de');
	assert.equal(snapshot.settings.calendarDefaultPresetId, 'calendar-client');
	assert.equal(snapshot.settings.tablePresets.length, 0);
	assert.equal(snapshot.canonicalWritesSuspended, false);
	failNextSave = true;
	waitForSave = null;
	signalSaveStarted = null;
	await assert.rejects(storage.updateSettings({ language: 'fr' }), /Injected settings save failure/);
	const afterFailedSave = saveCount;
	const afterFailure = await withTimeout(
		storage.captureCommittedSettingsBackupSnapshot(),
		'post-failure committed snapshot capture',
	);
	assert.equal(afterFailure.settings.language, 'de');
	assert.equal(saveCount, afterFailedSave);
	storage.suspendCanonicalSettingsWrites('test suspension');
	const suspended = await withTimeout(
		storage.captureCommittedSettingsBackupSnapshot(),
		'suspended committed snapshot capture',
	);
	assert.equal(saveCount, afterFailedSave);
	assert.equal(suspended.canonicalWritesSuspended, true);
	assert.equal(suspended.canonicalWriteSuspensionReason, 'test suspension');
	const exported = exportOperonSettingsBackupJsonV1({
		...exportInput(suspended.settings),
		canonicalWritesSuspended: suspended.canonicalWritesSuspended,
	});
	assert.equal(exported.report.canonicalStorage.writesSuspended, true);
	assert.equal(exported.ok, true);
	if (!exported.ok) return;
	assert.equal(exported.json.includes(SECRET_VAULT_ID), false);
	assert.equal(exported.json.includes(SECRET_PINNED_ID), false);
	assert.equal(exported.json.includes(SECRET_CONSUMER_ID), false);
});
