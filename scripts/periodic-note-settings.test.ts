import assert from 'node:assert/strict';
import {
	DEFAULT_SETTINGS,
	CURRENT_SETTINGS_VERSION,
	migrateSettings,
} from '../src/types/settings';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	mergeTaskCreationProfilePreservingUnknownV1,
	type OperonDataPackageV1,
} from '../src/storage/operon-data-package';
import { OperonDataPackageStore } from '../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import {
	SETTINGS_BACKUP_COMPATIBILITY_BY_KEY,
	SETTINGS_BACKUP_VAULT_REFERENCE_KEYS,
} from '../src/core/settings-backup-compatibility';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryPluginData {
	value: unknown;
	loadCalls = 0;
	saveCalls = 0;
	loadMode: 'normal' | 'throw' = 'normal';
	throwOnLoadCall: number | null = null;
	saveMode: 'normal' | 'throw-before' | 'commit-then-throw' | 'ambiguous' | 'resolve-without-write' = 'normal';

	constructor(value: unknown) {
		this.value = clone(value);
	}

	async loadData(): Promise<unknown> {
		this.loadCalls += 1;
		if (this.loadMode === 'throw' || this.loadCalls === this.throwOnLoadCall) {
			throw new Error('INJECTED_CANONICAL_READ_FAILURE');
		}
		return clone(this.value);
	}

	async saveData(value: unknown): Promise<void> {
		this.saveCalls += 1;
		if (this.saveMode === 'throw-before') {
			this.saveMode = 'normal';
			throw new Error('INJECTED_CANONICAL_WRITE_FAILURE');
		}
		if (this.saveMode === 'ambiguous') {
			this.saveMode = 'normal';
			this.value = { partial: true };
			throw new Error('INJECTED_AMBIGUOUS_CANONICAL_WRITE_FAILURE');
		}
		if (this.saveMode === 'commit-then-throw') {
			this.saveMode = 'normal';
			this.value = clone(value);
			throw new Error('INJECTED_ACKNOWLEDGEMENT_LOSS');
		}
		if (this.saveMode === 'resolve-without-write') return;
		this.value = clone(value);
	}
}

class MemoryStorageAdapter {
	readonly files = new Map<string, string>();
	failBackupWrite = false;
	corruptBackupRead = false;

	async exists(path: string): Promise<boolean> { return this.files.has(path); }
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error('MISSING');
		if (this.corruptBackupRead && path.includes('.bak')) return `${value}\nCORRUPTED`;
		return value;
	}
	async write(path: string, value: string): Promise<void> {
		if (this.failBackupWrite && path.includes('.bak')) {
			throw new Error('INJECTED_BACKUP_FAILURE');
		}
		this.files.set(path, value);
	}
	async remove(path: string): Promise<void> { this.files.delete(path); }
	async rename(from: string, to: string): Promise<void> {
		const value = this.files.get(from);
		if (value === undefined) throw new Error('MISSING_RENAME_SOURCE');
		this.files.set(to, value);
		this.files.delete(from);
	}

	backupEntries(): Array<[string, string]> {
		return [...this.files.entries()].filter(([path]) => (
			path.includes('.invalid-') || (path.includes('.task-creation-profile-v2-') && path.endsWith('.bak'))
		));
	}
}

function legacyPeriodicSettingsPackage(): OperonDataPackageV1 {
	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	dataPackage.settings.settingsVersion = 111;
	Object.assign(dataPackage.automation.taskAutomationPolicy, {
		fileTaskAutoArchiveEnabled: true,
		fileTaskArchiveFolder: 'Legacy/Archive',
		fileTaskArchivePipelineLocations: [{ pipelineId: 'legacy-pipeline', folder: 'Legacy/Pipeline archive' }],
		fileTaskArchiveDelaySeconds: 45,
		fileTaskArchiveOnlyFromFileTasksFolder: true,
	});
	dataPackage.ui.taskCreationProfile.version = 1;
	for (const key of [
		'manageDailyNotesWithOperon', 'dailyNoteFormat', 'dailyNoteTemplate', 'dailyNoteFolder',
		'manageWeeklyNotesWithOperon', 'weeklyNoteFormat', 'weeklyNoteTemplate', 'weeklyNoteFolder',
		'createWeeklyNotesAsOperonTask',
	] as const) {
		delete (dataPackage.ui.taskCreationProfile as unknown as Record<string, unknown>)[key];
	}
	return dataPackage;
}

function legacyArchiveVersionGatedPackage(): OperonDataPackageV1 {
	const dataPackage = legacyPeriodicSettingsPackage();
	dataPackage.settings.settingsVersion = 100;
	dataPackage.ui.contextualMenu.contextualMenuActionAllowlist = dataPackage.ui.contextualMenu.contextualMenuActionAllowlist
		.filter(actionId => actionId !== 'fixedReminder' && actionId !== 'relativeReminder');
	const legacyReminderMapping = dataPackage.taxonomy.keyMappings.system
		.find(mapping => mapping.canonicalKey === 'reminderDatetimes');
	if (!legacyReminderMapping) throw new Error('Legacy fixture needs the reminderDatetimes system mapping.');
	legacyReminderMapping.hideInFileTaskView = true;
	return dataPackage;
}

function legacyArchiveOnlyPackage(): OperonDataPackageV1 {
	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	dataPackage.settings.settingsVersion = 113;
	Object.assign(dataPackage.automation.taskAutomationPolicy, {
		fileTaskAutoArchiveEnabled: true,
		fileTaskArchiveFolder: 'Legacy/Archive',
		fileTaskArchivePipelineLocations: [{ pipelineId: 'pl_project', folder: 'Legacy/Project archive' }],
		fileTaskArchiveDelaySeconds: 45,
		fileTaskArchiveOnlyFromFileTasksFolder: true,
	});
	return dataPackage;
}

function assertArchiveRoutingMigrated(packageValue: unknown): void {
	const dataPackage = packageValue as OperonDataPackageV1;
	assert.equal(dataPackage.settings.settingsVersion, 114);
	assert.equal(dataPackage.automation.taskAutomationPolicy.fileTaskArchiveFolder, '');
	assert.deepEqual(dataPackage.automation.taskAutomationPolicy.fileTaskArchivePipelineLocations, []);
	assert.equal(dataPackage.automation.taskAutomationPolicy.fileTaskAutoArchiveEnabled, false);
	assert.equal(dataPackage.automation.taskAutomationPolicy.fileTaskArchiveDelaySeconds, 5);
	assert.equal(dataPackage.automation.taskAutomationPolicy.fileTaskArchiveOnlyFromFileTasksFolder, false);
}

async function assertArchiveOnlyStartupMigrationFailureMatrix(): Promise<void> {
	const paths = buildOperonStoragePaths('.obsidian');
	const source = legacyArchiveOnlyPackage();
	const previousWarn = console.warn;
	console.warn = () => {};
	try {
	const pluginData = new MemoryPluginData(source);
	const adapter = new MemoryStorageAdapter();
	const firstStore = new OperonDataPackageStore(adapter, paths, pluginData);
	await firstStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(pluginData.saveCalls, 1, 'direct v113 archive migration must publish one canonical candidate');
	assert.equal(adapter.backupEntries().length, 1, 'direct archive migration must retain one immutable source backup');
	assert.deepEqual(JSON.parse(adapter.backupEntries()[0][1]), source, 'archive-only backup must retain the exact v113 source');
	assertArchiveRoutingMigrated(pluginData.value);
	const firstCanonical = clone(pluginData.value);
	const secondStore = new OperonDataPackageStore(adapter, paths, pluginData);
	await secondStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(pluginData.saveCalls, 1, 'v114 archive migration must be idempotent on the second ordinary startup');
	assert.deepEqual(pluginData.value, firstCanonical, 'second ordinary startup must preserve the v114 archive policy');

	const backupFailureData = new MemoryPluginData(source);
	const backupFailureAdapter = new MemoryStorageAdapter();
	backupFailureAdapter.failBackupWrite = true;
	const backupFailureStore = new OperonDataPackageStore(backupFailureAdapter, paths, backupFailureData);
	await backupFailureStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(backupFailureData.saveCalls, 0, 'archive backup failure must prevent its canonical write');
	assert.equal(backupFailureStore.canPersist(), false, 'archive backup failure must fail closed');
	assert.deepEqual(backupFailureData.value, source);

	const backupVerifyFailureData = new MemoryPluginData(source);
	const backupVerifyFailureAdapter = new MemoryStorageAdapter();
	backupVerifyFailureAdapter.corruptBackupRead = true;
	const backupVerifyFailureStore = new OperonDataPackageStore(backupVerifyFailureAdapter, paths, backupVerifyFailureData);
	await backupVerifyFailureStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(backupVerifyFailureData.saveCalls, 0, 'archive backup readback failure must prevent its canonical write');
	assert.equal(backupVerifyFailureStore.canPersist(), false, 'archive backup readback failure must fail closed');
	assert.deepEqual(backupVerifyFailureData.value, source);

	for (const saveMode of ['throw-before', 'resolve-without-write'] as const) {
		const failedData = new MemoryPluginData(source);
		failedData.saveMode = saveMode;
		const failedAdapter = new MemoryStorageAdapter();
		const failedStore = new OperonDataPackageStore(failedAdapter, paths, failedData);
		await failedStore.initialize(DEFAULT_SETTINGS, 'en');
		assert.equal(failedData.saveCalls, 1, `${saveMode} archive write must be attempted once after backup`);
		assert.equal(failedStore.canPersist(), false, `${saveMode} archive write must fail closed`);
		assert.deepEqual(failedData.value, source, `${saveMode} archive write must preserve the old canonical source`);
		assert.equal(failedAdapter.backupEntries().length, 1, `${saveMode} archive write must retain exact recovery evidence`);
	}

	const acknowledgedLossData = new MemoryPluginData(source);
	acknowledgedLossData.saveMode = 'commit-then-throw';
	const acknowledgedLossAdapter = new MemoryStorageAdapter();
	const acknowledgedLossStore = new OperonDataPackageStore(acknowledgedLossAdapter, paths, acknowledgedLossData);
	await acknowledgedLossStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(acknowledgedLossStore.canPersist(), true, 'observed archive candidate survives acknowledgement loss');
	assertArchiveRoutingMigrated(acknowledgedLossData.value);
	await new OperonDataPackageStore(acknowledgedLossAdapter, paths, acknowledgedLossData).initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(acknowledgedLossData.saveCalls, 1, 'observed archive candidate is idempotent on the second startup');

	const observationFailureData = new MemoryPluginData(source);
	observationFailureData.throwOnLoadCall = 2;
	const observationFailureAdapter = new MemoryStorageAdapter();
	const observationFailureStore = new OperonDataPackageStore(observationFailureAdapter, paths, observationFailureData);
	await observationFailureStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(observationFailureStore.canPersist(), false, 'unreadable post-write archive candidate must fail closed in the first process');
	assert.match(observationFailureStore.getWriteSuspensionReason() ?? '', /could not be verified/u);
	assert.equal(observationFailureData.saveCalls, 1, 'unreadable post-write observation must not replay its canonical write');
	assertArchiveRoutingMigrated(observationFailureData.value);
	observationFailureData.throwOnLoadCall = null;
	const observationFailureRestart = new OperonDataPackageStore(observationFailureAdapter, paths, observationFailureData);
	await observationFailureRestart.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(observationFailureRestart.canPersist(), true, 'restart must observe the already committed v114 archive candidate');
	assert.equal(observationFailureData.saveCalls, 1, 'restart must not duplicate an already committed archive migration write');
	assertArchiveRoutingMigrated(observationFailureData.value);

	const ambiguousData = new MemoryPluginData(source);
	ambiguousData.saveMode = 'ambiguous';
	const ambiguousAdapter = new MemoryStorageAdapter();
	const ambiguousStore = new OperonDataPackageStore(ambiguousAdapter, paths, ambiguousData);
	await ambiguousStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(ambiguousStore.canPersist(), false, 'partial archive write must retain fail-closed recovery evidence');
	assert.equal(ambiguousAdapter.backupEntries().length, 1, 'partial archive write must retain its immutable source backup');
	const ambiguousRestart = new OperonDataPackageStore(ambiguousAdapter, paths, ambiguousData);
	await ambiguousRestart.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(ambiguousRestart.canPersist(), false, 'partial archive write must remain fail-closed after restart');
	assert.equal(ambiguousData.saveCalls, 1, 'partial archive restart must not replace ambiguous canonical data');
	} finally {
		console.warn = previousWarn;
	}
}

async function assertStartupMigrationLane(): Promise<void> {
	const paths = buildOperonStoragePaths('.obsidian');
	const legacy = legacyPeriodicSettingsPackage();
	(legacy.ui.taskCreationProfile as unknown as Record<string, unknown>).unknownLegacyProfileField = {
		preserved: true,
		nested: ['alpha', { beta: 2 }],
	};
	legacy.integrations.developerApi = {
		version: 1,
		consumersById: {
			'periodic-test-consumer': {
				consumerId: 'periodic-test-consumer',
				consumerName: 'Periodic test consumer',
				consumerVersion: '1.0.0',
				approvedMajorVersion: 1,
				state: 'active',
				revision: 3,
				grantedCapabilities: ['tasks.read'],
				pendingCapabilities: [],
				createdAt: '2026-08-17T08:00:00.000Z',
				updatedAt: '2026-08-17T09:00:00.000Z',
			},
		},
	};
	legacy.integrations.mobileNotifications = {
		version: 1,
		snapshotEnabled: false,
		cancelPending: true,
		vaultId: 'periodic-migration-vault',
		lastGeneratedAtEpochMs: 1_786_953_600_000,
	};
	legacy.state.pinnedTasks = {
		version: 1,
		itemsById: {
			'op-pinned': { pinned: true, updatedAt: '2026-08-17T09:30:00.000Z' },
		},
		manualOrder: { operonIds: ['op-pinned'], updatedAt: '2026-08-17T09:31:00.000Z' },
	};
	(legacy.state.pinnedTasks as unknown as Record<string, unknown>).tombstonesById = {
		'op-removed': { removedAt: '2026-08-17T09:32:00.000Z' },
	};
	const preservedOutsideProfile = clone(legacy) as unknown as Record<string, unknown>;
	delete (preservedOutsideProfile.settings as Record<string, unknown>).settingsVersion;
	delete (preservedOutsideProfile.ui as Record<string, unknown>).taskCreationProfile;
	for (const key of [
		'fileTaskAutoArchiveEnabled',
		'fileTaskArchiveFolder',
		'fileTaskArchivePipelineLocations',
		'fileTaskArchiveDelaySeconds',
		'fileTaskArchiveOnlyFromFileTasksFolder',
	]) delete ((preservedOutsideProfile.automation as Record<string, unknown>).taskAutomationPolicy as Record<string, unknown>)[key];
	const pluginData = new MemoryPluginData(legacy);
	const adapter = new MemoryStorageAdapter();
	const firstStore = new OperonDataPackageStore(adapter, paths, pluginData);
	await firstStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(pluginData.saveCalls, 1, 'first startup must publish one canonical migration');
	assert.equal(adapter.backupEntries().length, 1, 'first startup must write one immutable backup');
	assert.deepEqual(
		JSON.parse(adapter.backupEntries()[0][1]),
		legacy,
		'backup must contain the exact pre-migration package',
	);
	const firstCanonical = clone(pluginData.value) as OperonDataPackageV1;
	assert.equal(firstCanonical.settings.settingsVersion, 114);
	assert.equal(firstCanonical.automation.taskAutomationPolicy.fileTaskArchiveFolder, '');
	assert.deepEqual(firstCanonical.automation.taskAutomationPolicy.fileTaskArchivePipelineLocations, []);
	assert.equal(firstCanonical.automation.taskAutomationPolicy.fileTaskAutoArchiveEnabled, false);
	assert.equal(firstCanonical.automation.taskAutomationPolicy.fileTaskArchiveDelaySeconds, 5);
	assert.equal(firstCanonical.automation.taskAutomationPolicy.fileTaskArchiveOnlyFromFileTasksFolder, false);
	assert.equal(firstCanonical.ui.taskCreationProfile.version, 3);
	assert.equal(firstCanonical.ui.taskCreationProfile.manageDailyNotesWithOperon, false);
	assert.equal(firstCanonical.ui.taskCreationProfile.weeklyNoteFormat, 'GGGG-[W]WW');
	assert.deepEqual(
		(firstCanonical.ui.taskCreationProfile as unknown as Record<string, unknown>).unknownLegacyProfileField,
		{ preserved: true, nested: ['alpha', { beta: 2 }] },
		'first migration must preserve unknown legacy profile keys while normalized v2 fields win',
	);
	const unrelatedSettingsSave = composeOperonSettingsFromDataPackage(firstCanonical, DEFAULT_SETTINGS);
	unrelatedSettingsSave.language = 'de';
	const unrelatedSaveCandidate = buildOperonDataPackageFromSettings(unrelatedSettingsSave);
	unrelatedSaveCandidate.ui.taskCreationProfile = mergeTaskCreationProfilePreservingUnknownV1(
		firstCanonical.ui.taskCreationProfile,
		unrelatedSaveCandidate.ui.taskCreationProfile,
	);
	assert.deepEqual(
		(unrelatedSaveCandidate.ui.taskCreationProfile as unknown as Record<string, unknown>).unknownLegacyProfileField,
		{ preserved: true, nested: ['alpha', { beta: 2 }] },
		'an unrelated ordinary settings save must retain unknown migrated profile keys',
	);
	const canonicalOutsideProfile = clone(firstCanonical) as unknown as Record<string, unknown>;
	delete (canonicalOutsideProfile.settings as Record<string, unknown>).settingsVersion;
	delete (canonicalOutsideProfile.ui as Record<string, unknown>).taskCreationProfile;
	for (const key of [
		'fileTaskAutoArchiveEnabled',
		'fileTaskArchiveFolder',
		'fileTaskArchivePipelineLocations',
		'fileTaskArchiveDelaySeconds',
		'fileTaskArchiveOnlyFromFileTasksFolder',
	]) delete ((canonicalOutsideProfile.automation as Record<string, unknown>).taskAutomationPolicy as Record<string, unknown>)[key];
	assert.deepEqual(
		canonicalOutsideProfile,
		preservedOutsideProfile,
		'migration must preserve grants, mobile state, pins, tombstones, taxonomy, views, and every other domain',
	);

	const secondStore = new OperonDataPackageStore(adapter, paths, pluginData);
	await secondStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(pluginData.saveCalls, 1, 'second startup must not write the canonical package again');
	assert.equal(adapter.backupEntries().length, 1, 'second startup must not create another migration backup');
	assert.deepEqual(pluginData.value, firstCanonical, 'second startup must be byte-shape stable');

	const markerResumeLegacy = legacyPeriodicSettingsPackage();
	(markerResumeLegacy.ui.taskCreationProfile as unknown as Record<string, unknown>).unknownLegacyProfileField = {
		preservedAcrossMarkerRestart: true,
	};
	const failingData = new MemoryPluginData(markerResumeLegacy);
	failingData.saveMode = 'throw-before';
	const failingAdapter = new MemoryStorageAdapter();
	const failingStore = new OperonDataPackageStore(failingAdapter, paths, failingData);
	const previousCanonical = clone(failingData.value);
	await failingStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.deepEqual(failingData.value, previousCanonical, 'failed write must leave canonical data unchanged');
	assert.equal(failingStore.canPersist(), false, 'failed startup migration must suspend later writes');
	assert.equal(failingAdapter.backupEntries().length, 1, 'failed clean write must retain its recovery backup');
	assert.equal(
		failingStore.getDataPackage().ui.taskCreationProfile.version,
		1,
		'failed write must not publish the candidate in memory',
	);
	assert.equal(
		JSON.parse(failingAdapter.files.get(paths.taskCreationProfileV2RecoveryPath) ?? '{}').phase,
		'prepared',
		'clean failure must leave a durable prepared marker',
	);
	failingData.saveMode = 'normal';
	const resumedBeforeWriteStore = new OperonDataPackageStore(failingAdapter, paths, failingData);
	await resumedBeforeWriteStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(
		(resumedBeforeWriteStore.getDataPackage().ui.taskCreationProfile.version),
		3,
		'restart must safely resume a prepared transaction whose canonical package is still old',
	);
	assert.deepEqual(
		(resumedBeforeWriteStore.getDataPackage().ui.taskCreationProfile as unknown as Record<string, unknown>)
			.unknownLegacyProfileField,
		{ preservedAcrossMarkerRestart: true },
		'prepared marker candidate must retain unknown profile keys across restart resume',
	);
	assert.equal(failingAdapter.files.has(paths.taskCreationProfileV2RecoveryPath), false);

	const postWriteCrashData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	postWriteCrashData.throwOnLoadCall = 2;
	const postWriteCrashAdapter = new MemoryStorageAdapter();
	const postWriteCrashStore = new OperonDataPackageStore(postWriteCrashAdapter, paths, postWriteCrashData);
	await postWriteCrashStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(postWriteCrashStore.canPersist(), false, 'unobserved committed write must suspend this process');
	assert.equal((postWriteCrashData.value as OperonDataPackageV1).ui.taskCreationProfile.version, 3);
	assert.equal(
		JSON.parse(postWriteCrashAdapter.files.get(paths.taskCreationProfileV2RecoveryPath) ?? '{}').phase,
		'prepared',
	);
	postWriteCrashData.throwOnLoadCall = null;
	const resumedPostWriteStore = new OperonDataPackageStore(postWriteCrashAdapter, paths, postWriteCrashData);
	await resumedPostWriteStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(resumedPostWriteStore.canPersist(), true);
	assert.equal(postWriteCrashData.saveCalls, 1, 'restart must finalize an already committed candidate without rewriting it');
	assert.equal(postWriteCrashAdapter.files.has(paths.taskCreationProfileV2RecoveryPath), false);

	const falseSuccessData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	falseSuccessData.saveMode = 'resolve-without-write';
	const falseSuccessAdapter = new MemoryStorageAdapter();
	const falseSuccessStore = new OperonDataPackageStore(falseSuccessAdapter, paths, falseSuccessData);
	await falseSuccessStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(falseSuccessData.saveCalls, 1, 'reported success must still be observed exactly once');
	assert.equal(falseSuccessStore.canPersist(), false, 'success without a canonical write must suspend writes');
	assert.match(falseSuccessStore.getWriteSuspensionReason() ?? '', /failed cleanly/u);
	assert.equal(falseSuccessAdapter.backupEntries().length, 1, 'false success must retain its recovery backup');
	assert.equal(falseSuccessStore.getDataPackage().ui.taskCreationProfile.version, 1);

	const backupFailureData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	const backupFailureAdapter = new MemoryStorageAdapter();
	backupFailureAdapter.failBackupWrite = true;
	const backupFailureStore = new OperonDataPackageStore(backupFailureAdapter, paths, backupFailureData);
	await backupFailureStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(backupFailureData.saveCalls, 0, 'backup failure must prevent the canonical migration write');
	assert.equal(backupFailureStore.canPersist(), false, 'backup failure must suspend writes');
	assert.deepEqual(backupFailureData.value, legacyPeriodicSettingsPackage());

	const ambiguousData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	ambiguousData.saveMode = 'ambiguous';
	const ambiguousAdapter = new MemoryStorageAdapter();
	const ambiguousStore = new OperonDataPackageStore(ambiguousAdapter, paths, ambiguousData);
	await ambiguousStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(ambiguousStore.canPersist(), false, 'ambiguous migration state must suspend writes');
	assert.match(ambiguousStore.getWriteSuspensionReason() ?? '', /manual recovery/u);
	assert.equal(ambiguousAdapter.backupEntries().length, 1, 'ambiguous write must retain an exact recovery backup');
	assert.equal(ambiguousStore.getDataPackage().ui.taskCreationProfile.version, 1);
	const ambiguousRestart = new OperonDataPackageStore(ambiguousAdapter, paths, ambiguousData);
	await ambiguousRestart.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(ambiguousRestart.canPersist(), false, 'other canonical state must remain fail-closed after restart');
	assert.match(ambiguousRestart.getWriteSuspensionReason() ?? '', /does not match the transaction/u);
	const exactRecoverySource = JSON.parse(ambiguousAdapter.backupEntries()[0][1]) as OperonDataPackageV1;
	ambiguousData.value = exactRecoverySource;
	const restoredRestart = new OperonDataPackageStore(ambiguousAdapter, paths, ambiguousData);
	await restoredRestart.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(restoredRestart.canPersist(), true, 'restoring the exact verified backup must permit deterministic resume');
	assert.equal(restoredRestart.getDataPackage().ui.taskCreationProfile.version, 3);

	const missingBackupData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	missingBackupData.saveMode = 'throw-before';
	const missingBackupAdapter = new MemoryStorageAdapter();
	const missingBackupStore = new OperonDataPackageStore(missingBackupAdapter, paths, missingBackupData);
	await missingBackupStore.initialize(DEFAULT_SETTINGS, 'en');
	for (const [path] of missingBackupAdapter.backupEntries()) missingBackupAdapter.files.delete(path);
	missingBackupData.saveMode = 'normal';
	const missingBackupRestart = new OperonDataPackageStore(missingBackupAdapter, paths, missingBackupData);
	await missingBackupRestart.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(missingBackupRestart.canPersist(), false);
	assert.match(missingBackupRestart.getWriteSuspensionReason() ?? '', /backup is unavailable or invalid/u);
	const invalidMarkerData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	const invalidMarkerAdapter = new MemoryStorageAdapter();
	invalidMarkerAdapter.files.set(paths.taskCreationProfileV2RecoveryPath, '{"version":99}');
	const invalidMarkerStore = new OperonDataPackageStore(invalidMarkerAdapter, paths, invalidMarkerData);
	await invalidMarkerStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(invalidMarkerStore.canPersist(), false);
	assert.match(invalidMarkerStore.getWriteSuspensionReason() ?? '', /recovery marker is invalid/u);
	assert.equal(invalidMarkerData.saveCalls, 0);

	const futureMarkerData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	futureMarkerData.saveMode = 'throw-before';
	const futureMarkerAdapter = new MemoryStorageAdapter();
	const futureMarkerPreparation = new OperonDataPackageStore(futureMarkerAdapter, paths, futureMarkerData);
	await futureMarkerPreparation.initialize(DEFAULT_SETTINGS, 'en');
	const futurePreparedMarker = JSON.parse(
		futureMarkerAdapter.files.get(paths.taskCreationProfileV2RecoveryPath) ?? '{}',
	) as { candidate: OperonDataPackageV1 };
	futurePreparedMarker.candidate.ui.taskCreationProfile.version = 4;
	(futurePreparedMarker.candidate.ui.taskCreationProfile as unknown as Record<string, unknown>).futureOnly = true;
	futureMarkerAdapter.files.set(paths.taskCreationProfileV2RecoveryPath, JSON.stringify(futurePreparedMarker));
	futureMarkerData.saveCalls = 0;
	futureMarkerData.saveMode = 'normal';
	const futureMarkerRestart = new OperonDataPackageStore(futureMarkerAdapter, paths, futureMarkerData);
	await futureMarkerRestart.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(futureMarkerRestart.canPersist(), false);
	assert.match(futureMarkerRestart.getWriteSuspensionReason() ?? '', /Unsupported future Task Creation Profile/u);
	assert.equal(futureMarkerData.saveCalls, 0, 'a prepared future-profile candidate must be rejected before canonical write');
	assert.equal(
		(futureMarkerData.value as OperonDataPackageV1).ui.taskCreationProfile.version,
		1,
		'the existing canonical profile must remain unchanged',
	);

	const unreadablePreparedData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	unreadablePreparedData.saveMode = 'throw-before';
	const unreadablePreparedAdapter = new MemoryStorageAdapter();
	const unreadablePreparedStore = new OperonDataPackageStore(unreadablePreparedAdapter, paths, unreadablePreparedData);
	await unreadablePreparedStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(unreadablePreparedAdapter.files.has(paths.taskCreationProfileV2RecoveryPath), true);
	unreadablePreparedData.loadMode = 'throw';
	const unreadablePreparedRestart = new OperonDataPackageStore(
		unreadablePreparedAdapter,
		paths,
		unreadablePreparedData,
	);
	const preparedReadWarnings: unknown[][] = [];
	const warnBeforePreparedRead = console.warn;
	console.warn = (...args: unknown[]): void => { preparedReadWarnings.push(args); };
	try {
		await unreadablePreparedRestart.initialize(DEFAULT_SETTINGS, 'en');
	} finally {
		console.warn = warnBeforePreparedRead;
	}
	assert.equal(unreadablePreparedRestart.canPersist(), false, 'unreadable canonical with a prepared marker needs manual recovery');
	assert.match(unreadablePreparedRestart.getWriteSuspensionReason() ?? '', /could not be read safely/u);
	assert.equal(unreadablePreparedAdapter.files.has(paths.taskCreationProfileV2RecoveryPath), true);

	const restartReadFailureData = new MemoryPluginData(legacyPeriodicSettingsPackage());
	restartReadFailureData.loadMode = 'throw';
	const restartReadFailureStore = new OperonDataPackageStore(
		new MemoryStorageAdapter(),
		paths,
		restartReadFailureData,
	);
	const readFailureWarnings: unknown[][] = [];
	const warnBeforeReadFailure = console.warn;
	console.warn = (...args: unknown[]): void => { readFailureWarnings.push(args); };
	try {
		await restartReadFailureStore.initialize(DEFAULT_SETTINGS, 'en');
	} finally {
		console.warn = warnBeforeReadFailure;
	}
	assert.match(String(readFailureWarnings[0]?.[0] ?? ''), /Failed to load data\.json/u);
	assert.equal(restartReadFailureStore.canPersist(), false, 'restart read failure must suspend writes');
	assert.equal(restartReadFailureData.saveCalls, 0, 'restart read failure must not rewrite canonical data');

	const future = legacyPeriodicSettingsPackage();
	future.ui.taskCreationProfile.version = 4;
	(future.ui.taskCreationProfile as unknown as Record<string, unknown>).futureOnly = { untouched: true };
	const futureData = new MemoryPluginData(future);
	const futureAdapter = new MemoryStorageAdapter();
	const futureStore = new OperonDataPackageStore(futureAdapter, paths, futureData);
	await futureStore.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(futureStore.canPersist(), false, 'future profile version must suspend writes');
	assert.match(futureStore.getWriteSuspensionReason() ?? '', /Unsupported future Task Creation Profile/u);
	assert.equal(futureData.saveCalls, 0, 'future profile version must never be rewritten');
	assert.equal(futureAdapter.backupEntries().length, 0, 'future profile is preserved, not migrated');
	assert.deepEqual(
		futureStore.getDataPackage().ui.taskCreationProfile,
		future.ui.taskCreationProfile,
		'future profile and unknown fields must be preserved exactly',
	);
	await futureStore.backupCanonicalDataPackage(future);
	assert.equal(futureStore.canPersist(), false, 'backup must not clear the future-profile guard');
	futureStore.resumeWrites();
	assert.equal(futureStore.canPersist(), false, 'manual resume must not clear the future-profile guard');
	await assert.rejects(
		futureStore.updateDataPackage(dataPackage => ({
			...dataPackage,
			settings: { ...dataPackage.settings, language: 'de' },
		})),
		/Unsupported future Task Creation Profile/u,
	);
	await futureStore.reloadCanonicalDataPackage(DEFAULT_SETTINGS);
	assert.equal(futureStore.canPersist(), false, 'reload must not clear the future-profile guard');
	assert.equal(futureData.saveCalls, 0, 'destructive resume attempts must never rewrite a future profile');
}

async function assertLegacyArchiveVersionMigrationLane(): Promise<void> {
	const pluginData = new MemoryPluginData(legacyArchiveVersionGatedPackage());
	const store = new OperonDataPackageStore(new MemoryStorageAdapter(), buildOperonStoragePaths('.obsidian'), pluginData);
	await store.initialize(DEFAULT_SETTINGS, 'en');
	const migrated = clone(pluginData.value) as OperonDataPackageV1;
	assert.equal(migrated.settings.settingsVersion, 114);
	assert.equal(migrated.automation.taskAutomationPolicy.fileTaskArchiveFolder, '');
	assert.deepEqual(migrated.automation.taskAutomationPolicy.fileTaskArchivePipelineLocations, []);
	assert.equal(
		migrated.ui.contextualMenu.contextualMenuActionAllowlist.includes('fixedReminder'),
		true,
		'a v100 source must still receive the v111 contextual-menu migration before it is stamped v114',
	);
	assert.equal(
		migrated.taxonomy.keyMappings.system.find(mapping => mapping.canonicalKey === 'reminderDatetimes')?.hideInFileTaskView,
		false,
		'a v100 source must still receive the v108 reminder visibility migration before it is stamped v114',
	);
	const writesAfterFirstStartup = pluginData.saveCalls;
	await new OperonDataPackageStore(new MemoryStorageAdapter(), buildOperonStoragePaths('.obsidian'), pluginData)
		.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(pluginData.saveCalls, writesAfterFirstStartup, 'the normalized v114 candidate must not rerun legacy migration');
}

async function assertLegacyArchiveReloadMigrationLane(): Promise<void> {
	const pipelineId = DEFAULT_SETTINGS.pipelines[0]?.id;
	assert.ok(pipelineId, 'reload fixture requires a default pipeline ID');
	const currentSettings = migrateSettings({
		...DEFAULT_SETTINGS,
		fileTaskArchiveFolder: 'Current/Archive',
		fileTaskArchivePipelineLocations: [{ pipelineId, folder: 'Current/Pipeline archive' }],
	});
	const currentPackage = buildOperonDataPackageFromSettings(currentSettings);
	const pluginData = new MemoryPluginData(currentPackage);
	const store = new OperonDataPackageStore(new MemoryStorageAdapter(), buildOperonStoragePaths('.obsidian'), pluginData);
	await store.initialize(DEFAULT_SETTINGS, 'en');
	assert.equal(pluginData.saveCalls, 0, 'a current fixture must not write before the delayed reload');

	const delayedLegacyPackage = legacyArchiveVersionGatedPackage();
	pluginData.value = clone(delayedLegacyPackage);
	const result = await store.reloadCanonicalDataPackage(DEFAULT_SETTINGS);
	assert.equal(result.changed, true, 'the delayed legacy package must publish one normalized canonical candidate');
	assert.equal(pluginData.saveCalls, 1, 'the delayed legacy package must be canonicalized exactly once');
	const reloaded = clone(pluginData.value) as OperonDataPackageV1;
	assert.equal(reloaded.settings.settingsVersion, 114);
	assert.equal(reloaded.automation.taskAutomationPolicy.fileTaskArchiveFolder, 'Current/Archive');
	assert.deepEqual(
		reloaded.automation.taskAutomationPolicy.fileTaskArchivePipelineLocations,
		[{ pipelineId, folder: 'Current/Pipeline archive' }],
		'a delayed pre-v114 package must preserve the current v114 archive policy',
	);
	assert.equal(
		reloaded.ui.contextualMenu.contextualMenuActionAllowlist.includes('fixedReminder'),
		true,
		'a delayed v100 package must receive the v111 contextual-menu migration before archive policy restoration',
	);
	assert.equal(
		reloaded.taxonomy.keyMappings.system.find(mapping => mapping.canonicalKey === 'reminderDatetimes')?.hideInFileTaskView,
		false,
		'a delayed v100 package must receive the v108 reminder visibility migration before archive policy restoration',
	);
	const runtimeSettings = store.getSettings(DEFAULT_SETTINGS);
	assert.equal(runtimeSettings.fileTaskArchiveFolder, 'Current/Archive');
	assert.deepEqual(runtimeSettings.fileTaskArchivePipelineLocations, [{ pipelineId, folder: 'Current/Pipeline archive' }]);
}

async function run(): Promise<void> {
	assert.equal(CURRENT_SETTINGS_VERSION, 114);
	assert.deepEqual({
		fileTaskPipelineLocations: DEFAULT_SETTINGS.fileTaskPipelineLocations,
		fileTaskArchiveFolder: DEFAULT_SETTINGS.fileTaskArchiveFolder,
		fileTaskArchivePipelineLocations: DEFAULT_SETTINGS.fileTaskArchivePipelineLocations,
		fileTaskArchiveDelaySeconds: DEFAULT_SETTINGS.fileTaskArchiveDelaySeconds,
		moveConvertedNotesToPipelineLocation: DEFAULT_SETTINGS.moveConvertedNotesToPipelineLocation,
		manageDailyNotesWithOperon: DEFAULT_SETTINGS.manageDailyNotesWithOperon,
		dailyNoteFormat: DEFAULT_SETTINGS.dailyNoteFormat,
		dailyNoteTemplate: DEFAULT_SETTINGS.dailyNoteTemplate,
		dailyNoteFolder: DEFAULT_SETTINGS.dailyNoteFolder,
		createDailyNotesAsOperonTask: DEFAULT_SETTINGS.createDailyNotesAsOperonTask,
		manageWeeklyNotesWithOperon: DEFAULT_SETTINGS.manageWeeklyNotesWithOperon,
		weeklyNoteFormat: DEFAULT_SETTINGS.weeklyNoteFormat,
		weeklyNoteTemplate: DEFAULT_SETTINGS.weeklyNoteTemplate,
		weeklyNoteFolder: DEFAULT_SETTINGS.weeklyNoteFolder,
		createWeeklyNotesAsOperonTask: DEFAULT_SETTINGS.createWeeklyNotesAsOperonTask,
	}, {
		fileTaskPipelineLocations: [],
		fileTaskArchiveFolder: '',
		fileTaskArchivePipelineLocations: [],
		fileTaskArchiveDelaySeconds: 5,
		moveConvertedNotesToPipelineLocation: false,
		manageDailyNotesWithOperon: false,
		dailyNoteFormat: 'YYYY-MM-DD',
		dailyNoteTemplate: '',
		dailyNoteFolder: '',
		createDailyNotesAsOperonTask: false,
		manageWeeklyNotesWithOperon: false,
		weeklyNoteFormat: 'GGGG-[W]WW',
		weeklyNoteTemplate: '',
		weeklyNoteFolder: '',
		createWeeklyNotesAsOperonTask: false,
	});

	const migratedLegacy = migrateSettings({ settingsVersion: 111 });
	assert.equal(migratedLegacy.settingsVersion, 114);
	assert.equal(migratedLegacy.fileTaskArchiveFolder, '');
	assert.deepEqual(migratedLegacy.fileTaskArchivePipelineLocations, []);
	assert.equal(migratedLegacy.fileTaskAutoArchiveEnabled, false);
	assert.equal(migratedLegacy.fileTaskArchiveDelaySeconds, 5);
	assert.equal(migratedLegacy.fileTaskArchiveOnlyFromFileTasksFolder, false);
	assert.equal(migratedLegacy.manageDailyNotesWithOperon, false);
	assert.equal(migratedLegacy.dailyNoteFormat, 'YYYY-MM-DD');
	assert.equal(migratedLegacy.manageWeeklyNotesWithOperon, false);
	assert.equal(migratedLegacy.weeklyNoteFormat, 'GGGG-[W]WW');

	const configured = migrateSettings({
		...DEFAULT_SETTINGS,
		settingsVersion: 111,
		inlineTaskSaveMode: 'weekly-notes',
		manageDailyNotesWithOperon: true,
		dailyNoteFormat: ' YYYY/MM/DD ',
		dailyNoteTemplate: ' Templates/Daily.md ',
		dailyNoteFolder: ' Journal/Daily ',
		createDailyNotesAsOperonTask: true,
		manageWeeklyNotesWithOperon: true,
		weeklyNoteFormat: ' gggg-[W]ww ',
		weeklyNoteTemplate: ' Templates/Weekly.md ',
		weeklyNoteFolder: ' Journal/Weekly ',
		createWeeklyNotesAsOperonTask: true,
		fileTaskPipelineLocations: [
			{ pipelineId: 'pl_project', folder: ' Projects/Tasks ' },
			{ pipelineId: 'pl_project', folder: ' Duplicate/Ignore ' },
			{ pipelineId: 'missing', folder: ' Missing/Ignore ' },
		],
		moveConvertedNotesToPipelineLocation: true,
	});
	assert.equal(configured.dailyNoteFormat, 'YYYY/MM/DD');
	assert.equal(configured.dailyNoteTemplate, 'Templates/Daily.md');
	assert.equal(configured.dailyNoteFolder, 'Journal/Daily');
	assert.equal(configured.weeklyNoteFormat, 'gggg-[W]ww');
	assert.equal(configured.weeklyNoteTemplate, 'Templates/Weekly.md');
	assert.equal(configured.weeklyNoteFolder, 'Journal/Weekly');
	assert.equal(configured.inlineTaskSaveMode, 'weekly-notes');
	assert.deepEqual(configured.fileTaskPipelineLocations, [{ pipelineId: 'pl_project', folder: 'Projects/Tasks' }]);
	assert.equal(configured.moveConvertedNotesToPipelineLocation, true);

	const unsafe = migrateSettings({
		settingsVersion: 111,
		manageDailyNotesWithOperon: true,
		dailyNoteFolder: '../outside',
		dailyNoteTemplate: '/absolute/template.md',
		manageWeeklyNotesWithOperon: true,
		weeklyNoteFolder: 'C:\\Weekly',
		weeklyNoteTemplate: '..\\template.md',
	});
	assert.equal(unsafe.dailyNoteFolder, '../outside');
	assert.equal(unsafe.dailyNoteTemplate, '/absolute/template.md');
	assert.equal(unsafe.weeklyNoteFolder, 'C:\\Weekly');
	assert.equal(unsafe.weeklyNoteTemplate, '..\\template.md');
	assert.equal(unsafe.manageDailyNotesWithOperon, true);
	assert.equal(unsafe.manageWeeklyNotesWithOperon, true);

	const dataPackage = buildOperonDataPackageFromSettings(configured);
	assert.equal(dataPackage.schemaVersion, 2);
	assert.equal(dataPackage.ui.taskCreationProfile.version, 3);
	assert.equal(dataPackage.ui.taskCreationProfile.inlineTaskSaveMode, 'weekly-notes');
	assert.equal(dataPackage.ui.taskCreationProfile.manageDailyNotesWithOperon, true);
	assert.equal(dataPackage.ui.taskCreationProfile.weeklyNoteFormat, 'gggg-[W]ww');
	assert.deepEqual(dataPackage.ui.taskCreationProfile.fileTaskPipelineLocations, [{ pipelineId: 'pl_project', folder: 'Projects/Tasks' }]);
	assert.equal(dataPackage.ui.taskCreationProfile.moveConvertedNotesToPipelineLocation, true);
	const roundTripped = composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS);
	for (const key of [
		'inlineTaskSaveMode',
		'manageDailyNotesWithOperon', 'dailyNoteFormat', 'dailyNoteTemplate', 'dailyNoteFolder',
		'createDailyNotesAsOperonTask', 'manageWeeklyNotesWithOperon', 'weeklyNoteFormat',
		'weeklyNoteTemplate', 'weeklyNoteFolder', 'createWeeklyNotesAsOperonTask',
		'fileTaskPipelineLocations', 'moveConvertedNotesToPipelineLocation',
	] as const) {
		assert.deepEqual(roundTripped[key], configured[key], `round trip must preserve ${key}`);
	}

	const legacyPackage = clone(dataPackage);
	legacyPackage.ui.taskCreationProfile.version = 1;
	for (const key of [
		'manageDailyNotesWithOperon', 'dailyNoteFormat', 'dailyNoteTemplate', 'dailyNoteFolder',
		'manageWeeklyNotesWithOperon', 'weeklyNoteFormat', 'weeklyNoteTemplate', 'weeklyNoteFolder',
		'createWeeklyNotesAsOperonTask',
	] as const) {
		delete (legacyPackage.ui.taskCreationProfile as unknown as Record<string, unknown>)[key];
	}
	const legacyComposed = composeOperonSettingsFromDataPackage(legacyPackage, DEFAULT_SETTINGS);
	assert.equal(legacyComposed.manageDailyNotesWithOperon, false);
	assert.equal(legacyComposed.dailyNoteFormat, 'YYYY-MM-DD');
	assert.equal(legacyComposed.createDailyNotesAsOperonTask, true);
	assert.equal(legacyComposed.manageWeeklyNotesWithOperon, false);
	assert.equal(legacyComposed.weeklyNoteFormat, 'GGGG-[W]WW');
	assert.equal(legacyComposed.createWeeklyNotesAsOperonTask, false);

	const vaultReferenceKeys = new Set(SETTINGS_BACKUP_VAULT_REFERENCE_KEYS);
	for (const key of ['dailyNoteTemplate', 'dailyNoteFolder', 'weeklyNoteTemplate', 'weeklyNoteFolder', 'fileTaskPipelineLocations'] as const) {
		assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY[key].support, 'vault-reference');
		assert.equal(vaultReferenceKeys.has(key), true);
	}
	for (const key of [
		'inlineTaskSaveMode',
		'manageDailyNotesWithOperon', 'dailyNoteFormat', 'createDailyNotesAsOperonTask',
		'manageWeeklyNotesWithOperon', 'weeklyNoteFormat', 'createWeeklyNotesAsOperonTask',
	] as const) {
		assert.equal(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY[key].support, 'portable');
	}

	await assertStartupMigrationLane();
	await assertArchiveOnlyStartupMigrationFailureMatrix();
	await assertLegacyArchiveVersionMigrationLane();
	await assertLegacyArchiveReloadMigrationLane();

	console.log('Periodic Note settings persistence: passed');
}

declare global {
	var __operonPeriodicNoteSettingsTestRun: Promise<void> | undefined;
}

globalThis.__operonPeriodicNoteSettingsTestRun = run();
