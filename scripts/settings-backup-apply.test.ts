import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { App } from 'obsidian';
import { sha256HexV1 } from '../src/agent-runtime/contracts/v1/canonical';
import {
	computeOperonSettingsBackupApplyPlanIdV1,
	computeOperonSettingsBackupSettingsFingerprintV1,
	createOperonSettingsBackupApplyAcknowledgementV1,
	projectOperonSettingsBackupApplyDataPackageV1,
} from '../src/core/settings-backup-apply';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import {
	canonicalizeOperonSettingsBackupJson,
	type OperonSettingsBackupBodyV1,
} from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	preflightOperonSettingsBackupRestoreV1,
	type OperonSettingsBackupRestorePlanV1,
} from '../src/core/settings-backup-preflight';
import {
	DYNAMIC_FILE_TASK_FILTER_ID,
	DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER,
	DYNAMIC_SUBTASKS_FILTER_ID,
	DYNAMIC_SUBTASKS_FILTER_OPERON_ID_PLACEHOLDER,
	createDefaultDynamicFileTaskFilterSet,
	createDefaultDynamicSubtasksFilterSet,
} from '../src/core/dynamic-file-task-filter';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	type OperonDataPackageV1,
} from '../src/storage/operon-data-package';
import { OperonStorage } from '../src/storage/operon-storage';
import { DEFAULT_SETTINGS, migrateSettings, type FilterSet, type OperonSettings } from '../src/types/settings';

const FIXTURE_DIR = path.resolve('scripts/settings-backup-fixtures');
const EXPORTED_AT = '2026-08-10T18:00:00.000Z';
const APPLIED_AT = '2026-08-10T20:00:00.000Z';
const SECRET_URL = 'https://example.invalid/apply-secret-token.ics';
const SECRET_VAULT_ID = 'apply-secret-vault-id';
const SECRET_TASK_ID = 'apply-secret-task-id';
const SECRET_CONSUMER_ID = 'apply-secret-consumer-id';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function changeLanguage(settings: OperonSettings): void {
	settings.language = settings.language === 'de' ? 'en' : 'de';
	if (settings.language !== 'en' && !settings.languagePackSubscriptions.includes(settings.language)) {
		settings.languagePackSubscriptions = [...settings.languagePackSubscriptions, settings.language];
	}
}

function dynamicTemplate(settings: OperonSettings, id: string): FilterSet {
	const template = settings.filterSets.find(filterSet => filterSet.id === id);
	assert.ok(template, `Missing dynamic filter template: ${id}`);
	return template;
}

function dynamicTemplatePresentation(filterSet: FilterSet) {
	return {
		id: filterSet.id,
		name: filterSet.name,
		icon: filterSet.icon,
		sorts: clone(filterSet.sorts),
		groupBy: filterSet.groupBy,
		groupOrder: filterSet.groupOrder,
		subgroupBy: filterSet.subgroupBy,
		subgroupOrder: filterSet.subgroupOrder,
	};
}

function addCustomizedDynamicTemplates(settings: OperonSettings, label: string): void {
	const fileTask = createDefaultDynamicFileTaskFilterSet();
	fileTask.name = `${label} file-task template`;
	fileTask.icon = 'file-key';
	fileTask.sorts = [{ field: 'priority', order: 'desc' }];
	fileTask.sortBy = 'priority';
	fileTask.sortOrder = 'desc';
	fileTask.groupBy = 'dateDue';
	fileTask.groupOrder = 'desc';
	fileTask.subgroupBy = 'priority';
	fileTask.subgroupOrder = 'asc';

	const subtasks = createDefaultDynamicSubtasksFilterSet();
	subtasks.name = `${label} subtasks template`;
	subtasks.icon = 'list-checks';
	subtasks.sorts = [{ field: 'checkbox', order: 'desc' }, { field: 'priority', order: 'asc' }];
	subtasks.sortBy = 'checkbox';
	subtasks.sortOrder = 'desc';
	subtasks.groupBy = 'priority';
	subtasks.groupOrder = 'asc';
	subtasks.subgroupBy = 'dateDue';
	subtasks.subgroupOrder = 'desc';

	settings.filterSets = [
		...settings.filterSets.filter(filterSet => (
			filterSet.id !== DYNAMIC_FILE_TASK_FILTER_ID && filterSet.id !== DYNAMIC_SUBTASKS_FILTER_ID
		)),
		fileTask,
		subtasks,
	];
}

function assertCanonicalDynamicLock(filterSet: FilterSet, placeholder: string): void {
	assert.equal(filterSet.matchLogic, 'all');
	assert.deepEqual(filterSet.rootGroup, {
		id: 'fg_dynamic_file_task_root',
		logic: 'all',
		children: [{
			id: 'cond_dynamic_file_task_operon_id',
			field: 'operonId',
			fieldType: 'text',
			operator: 'is',
			value: placeholder,
		}],
	});
	assert.deepEqual(filterSet.conditions, [{
		id: 'cond_dynamic_file_task_operon_id',
		field: 'operonId',
		fieldType: 'text',
		operator: 'is',
		value: placeholder,
	}]);
}

function baselineSettings(): OperonSettings {
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

function canonicalPackage(settings: OperonSettings): OperonDataPackageV1 {
	let current = clone(settings);
	for (let index = 0; index < 4; index += 1) {
		current = migrateSettings(composeOperonSettingsFromDataPackage(
			buildOperonDataPackageFromSettings(current),
			DEFAULT_SETTINGS,
		));
	}
	return buildOperonDataPackageFromSettings(current);
}

class MemoryAdapter {
	readonly folders = new Set(['.obsidian']);
	readonly files = new Map<string, string>();
	mutations = 0;

	async exists(value: string): Promise<boolean> { return this.folders.has(value) || this.files.has(value); }
	async mkdir(value: string): Promise<void> { this.mutations += 1; this.folders.add(value); }
	async read(value: string): Promise<string> {
		const data = this.files.get(value);
		if (data === undefined) throw new Error(`Missing file: ${value}`);
		return data;
	}
	async write(value: string, data: string): Promise<void> { this.mutations += 1; this.files.set(value, data); }
	async remove(value: string): Promise<void> { this.mutations += 1; this.files.delete(value); }
	async rename(from: string, to: string): Promise<void> {
		const data = await this.read(from);
		this.mutations += 1;
		this.files.set(to, data);
		this.files.delete(from);
	}
}

type SaveMode = 'normal' | 'fail-clean' | 'commit-then-error' | 'unknown';

class ControlledPluginData {
	committed: OperonDataPackageV1;
	saveAttempts = 0;
	saveSuccesses = 0;
	mode: SaveMode = 'normal';
	private gate: Promise<void> | null = null;
	private releaseGate: (() => void) | null = null;
	private started: (() => void) | null = null;
	private startedPromise: Promise<void> | null = null;

	constructor(initial: OperonDataPackageV1) { this.committed = clone(initial); }

	reset(): void { this.saveAttempts = 0; this.saveSuccesses = 0; this.mode = 'normal'; }

	gateNextSave(): { started: Promise<void>; release: () => void } {
		this.startedPromise = new Promise(resolve => { this.started = resolve; });
		this.gate = new Promise(resolve => { this.releaseGate = resolve; });
		return { started: this.startedPromise, release: () => this.releaseGate?.() };
	}

	loadData = async (): Promise<OperonDataPackageV1> => clone(this.committed);

	saveData = async (raw: unknown): Promise<void> => {
		this.saveAttempts += 1;
		this.started?.();
		if (this.gate) await this.gate;
		this.gate = null;
		this.releaseGate = null;
		this.started = null;
		const candidate = clone(raw as OperonDataPackageV1);
		if (this.mode === 'fail-clean') throw new Error('injected clean rejection');
		if (this.mode === 'commit-then-error') {
			this.committed = candidate;
			this.saveSuccesses += 1;
			throw new Error('injected acknowledgement loss');
		}
		if (this.mode === 'unknown') {
			const divergent = clone(this.committed);
			divergent.settings.language = 'fr';
			this.committed = divergent;
			throw new Error('injected ambiguous rejection');
		}
		this.committed = candidate;
		this.saveSuccesses += 1;
	};
}

interface Harness {
	storage: OperonStorage;
	data: ControlledPluginData;
	adapter: MemoryAdapter;
}

async function createHarness(initial: OperonDataPackageV1): Promise<Harness> {
	const adapter = new MemoryAdapter();
	const data = new ControlledPluginData(initial);
	const app = { locale: 'en', vault: { configDir: '.obsidian', adapter } } as unknown as App;
	const storage = new OperonStorage(app, { loadData: data.loadData, saveData: data.saveData });
	await storage.initialize();
	data.reset();
	adapter.mutations = 0;
	return { storage, data, adapter };
}

function exportJson(
	settings: OperonSettings,
	createdAt = EXPORTED_AT,
): string {
	const result = exportOperonSettingsBackupJsonV1({
		settings,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt,
	});
	assert.equal(result.ok, true, result.diagnostics.map(item => item.message).join('\n'));
	if (!result.ok) throw new Error('Expected export to succeed.');
	return result.json;
}

async function createPlan(
	storage: OperonStorage,
	source: OperonSettings,
	selectedGroups: readonly ('general' | 'filters' | 'preset-favorites' | 'table-global')[] = ['general'],
): Promise<{
	sourceJson: string;
	plan: OperonSettingsBackupRestorePlanV1;
}> {
	const target = await storage.captureCommittedSettingsBackupSnapshot();
	const sourceJson = exportJson(source);
	const preflight = preflightOperonSettingsBackupRestoreV1({ sourceJson, targetSnapshot: target, selectedGroups });
	assert.equal(preflight.ok, true);
	if (!preflight.ok) throw new Error('Expected valid preflight.');
	assert.equal(preflight.classification, 'ready', JSON.stringify(preflight.preview.issues, null, 2));
	assert.ok(preflight.restorePlan);
	return { sourceJson, plan: preflight.restorePlan as OperonSettingsBackupRestorePlanV1 };
}

function applyInput(sourceJson: string, plan: OperonSettingsBackupRestorePlanV1, appliedAt = APPLIED_AT) {
	return {
		sourceJson,
		restorePlan: plan,
		acknowledgement: createOperonSettingsBackupApplyAcknowledgementV1(plan),
		appliedAt,
		refreshedVaultReferenceChecks: plan.vaultReferenceChecks,
	};
}

function protectedProjection(dataPackage: OperonDataPackageV1) {
	return {
		developerApi: dataPackage.integrations.developerApi,
		mobileNotifications: dataPackage.integrations.mobileNotifications,
		state: dataPackage.state,
		kanbanOrder: dataPackage.views.kanbanOrder,
		tableFavorites: dataPackage.ui.presetFavorites?.table,
		tableFiles: {
			presetIds: dataPackage.views.tablePresets.presetIds,
			fileBindings: dataPackage.views.tablePresets.fileBindings,
			initialized: dataPackage.views.tablePresets.initialized,
			tableDefaultPresetId: dataPackage.views.tablePresets.tableDefaultPresetId,
		},
	};
}

test('plugin coordinator source boundary keeps apply and recovery receipt-owned and fully settled', () => {
	const source = readFileSync(path.resolve('main.ts'), 'utf8');
	const section = (start: string, end: string): string => {
		const startIndex = source.indexOf(start);
		const endIndex = source.indexOf(end, startIndex + start.length);
		assert.ok(startIndex >= 0, `Missing coordinator boundary: ${start}`);
		assert.ok(endIndex > startIndex, `Missing coordinator boundary: ${end}`);
		return source.slice(startIndex, endIndex);
	};
	const settle = section(
		'private async settleSettingsBackupRuntimeRefresh(',
		'async applySettingsBackupRestorePlanV1(',
	);
	const publicApply = section(
		'async applySettingsBackupRestorePlanV1(',
		'private async applySettingsBackupRestorePlanUnlockedV1(',
	);
	const apply = section(
		'private async applySettingsBackupRestorePlanUnlockedV1(',
		'async resolveSettingsBackupRestoreRecoveryV1(',
	);
	const publicRecovery = section(
		'async resolveSettingsBackupRestoreRecoveryV1(',
		'private async resolveSettingsBackupRestoreRecoveryUnlockedV1(',
	);
	const recovery = section(
		'private async resolveSettingsBackupRestoreRecoveryUnlockedV1(',
		'private async reloadSettingsBackupCanonicalRuntime(',
	);
	const retry = section(
		'private async retrySettingsBackupRuntimeRefresh(',
		'private keepSettingsBackupRestore(',
	);

	assert.match(publicApply, /return this\.enqueueSettingsBackupRestoreOperation\(/);
	assert.match(publicRecovery, /return this\.enqueueSettingsBackupRestoreOperation\(/);
	assert.match(source, /const run = this\.settingsBackupRestoreQueue\.then\(operation\)/);
	assert.match(apply, /if \(this\.pendingSettingsBackupRuntimeRecovery\)/);
	assert.match(apply, /blockedReason: 'user-decision-required'/);
	assert.match(recovery, /pending\.receiptId !== input\.receiptId/);
	assert.match(recovery, /pending\.undoTokenId !== input\.undoTokenId/);
	assert.match(recovery, /undoSettingsBackupRestoreV1\(input\.undoTokenId, input\.receiptId\)/);

	assert.match(settle, /this\.synchronizeLanguagePacksAfterLayoutStrict\(\)/);
	assert.match(settle, /this\.refreshAgentRuntimeSettingsBoundaryStrict\(\)/);
	assert.match(settle, /this\.awaitAgentRuntimeSettlement\(\{ mutationOwnedMaintenance: true \}\)/);
	assert.match(retry, /this\.synchronizeLanguagePacksAfterLayoutStrict\(\)/);
	assert.match(retry, /this\.refreshAgentRuntimeSettingsBoundaryStrict\(\)/);
	assert.match(
		retry,
		/if \(retrySteps\.has\('reindex'\)\) \{[\s\S]*?if \(reindexReason\) \{[\s\S]*?scheduleSettingsReindex[\s\S]*?\}[\s\S]*?awaitAgentRuntimeSettlement\(\{ mutationOwnedMaintenance: true \}\)/,
	);
	assert.match(source, /private async settleSettingsBackupRuntimeRefresh\(/);
	assert.match(source, /private async retrySettingsBackupRuntimeRefresh\(/);
	assert.match(source, /private keepSettingsBackupRestore\(\)/);
});

test('apply commits portable groups once, preserves protected domains, and redacts receipts', async () => {
	const target = baselineSettings();
	const initial = canonicalPackage(target);
	initial.integrations.mobileNotifications.vaultId = SECRET_VAULT_ID;
	initial.integrations.developerApi = {
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
				createdAt: APPLIED_AT,
				updatedAt: APPLIED_AT,
			},
		},
	};
	initial.state.pinnedTasks.itemsById[SECRET_TASK_ID] = { pinned: true, updatedAt: '2026-08-10T19:00:00.000Z' };
	initial.views.kanbanOrder.boards['private-board'] = { columns: [] };
	const { storage, data, adapter } = await createHarness(initial);
	const current = (await storage.captureCommittedSettingsBackupSnapshot()).settings;
	const protectedBefore = clone(protectedProjection(data.committed));
	const source = clone(current);
	changeLanguage(source);
	assert.ok(source.filterSets[0]);
	source.filterSets[0].name = 'Imported filter';
	source.tableShowLineNumbers = !current.tableShowLineNumbers;
	assert.ok(source.externalCalendars[0]);
	source.externalCalendars = [{ ...source.externalCalendars[0], url: SECRET_URL }];
	const { sourceJson, plan } = await createPlan(storage, source, ['general', 'filters', 'table-global']);

	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(result.status === 'success' || result.status === 'success-with-migrations');
	assert.ok(result.receipt);
	assert.equal(data.saveAttempts, 1);
	assert.equal(data.saveSuccesses, 1);
	assert.equal(adapter.mutations, 0);
	const committed = await storage.captureCommittedSettingsBackupSnapshot();
	assert.equal(committed.settings.language, source.language);
	assert.equal(committed.settings.filterSets[0]?.name, 'Imported filter');
	assert.equal(committed.settings.tableShowLineNumbers, source.tableShowLineNumbers);
	assert.deepEqual(protectedProjection(data.committed), protectedBefore);
	const serialized = JSON.stringify(result);
	assert.equal(serialized.includes(SECRET_URL), false);
	assert.equal(serialized.includes(SECRET_VAULT_ID), false);
	assert.equal(serialized.includes(SECRET_TASK_ID), false);
	assert.equal(serialized.includes(SECRET_CONSUMER_ID), false);
});

test('selected Filters restore and session Undo round-trip safe dynamic templates while preserving locked and protected state', async () => {
	const target = baselineSettings();
	addCustomizedDynamicTemplates(target, 'Target');
	const initial = canonicalPackage(target);
	initial.integrations.mobileNotifications.vaultId = SECRET_VAULT_ID;
	initial.state.pinnedTasks.itemsById[SECRET_TASK_ID] = { pinned: true, updatedAt: APPLIED_AT };
	initial.views.kanbanOrder.boards['private-board'] = { columns: [] };
	initial.views.tablePresets.fileBindings = [{ id: 'table-private', path: 'Tables/Private.table' }];
	initial.views.tablePresets.presetIds = ['table-private'];
	initial.views.tablePresets.initialized = true;
	initial.views.tablePresets.tableDefaultPresetId = 'table-private';
	initial.ui.presetFavorites = {
		...initial.ui.presetFavorites!,
		table: ['table-private'],
	};
	const harness = await createHarness(initial);
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const targetFileTask = dynamicTemplatePresentation(dynamicTemplate(current, DYNAMIC_FILE_TASK_FILTER_ID));
	const targetSubtasks = dynamicTemplatePresentation(dynamicTemplate(current, DYNAMIC_SUBTASKS_FILTER_ID));
	const protectedBefore = clone(protectedProjection(harness.data.committed));

	const source = clone(current);
	addCustomizedDynamicTemplates(source, 'Source');
	const sourceFileTask = dynamicTemplate(source, DYNAMIC_FILE_TASK_FILTER_ID);
	const sourceSubtasks = dynamicTemplate(source, DYNAMIC_SUBTASKS_FILTER_ID);
	const sourceFilePresentation = dynamicTemplatePresentation(sourceFileTask);
	const sourceSubtasksPresentation = dynamicTemplatePresentation(sourceSubtasks);
	// The portable projection must never trust source-controlled locked conditions.
	sourceFileTask.matchLogic = 'any';
	sourceFileTask.rootGroup.children[0] = {
		id: 'attacker-condition',
		field: 'description',
		fieldType: 'text',
		operator: 'contains',
		value: 'attacker',
	};
	sourceFileTask.conditions = [clone(sourceFileTask.rootGroup.children[0])];
	sourceSubtasks.rootGroup.children[0] = {
		id: 'attacker-condition-2',
		field: 'description',
		fieldType: 'text',
		operator: 'contains',
		value: 'attacker',
	};
	sourceSubtasks.conditions = [clone(sourceSubtasks.rootGroup.children[0])];

	const { sourceJson, plan } = await createPlan(harness.storage, source, ['filters']);
	const candidateFileTask = dynamicTemplate(plan.candidateSettings, DYNAMIC_FILE_TASK_FILTER_ID);
	const candidateSubtasks = dynamicTemplate(plan.candidateSettings, DYNAMIC_SUBTASKS_FILTER_ID);
	assert.deepEqual(dynamicTemplatePresentation(candidateFileTask), sourceFilePresentation);
	assert.deepEqual(dynamicTemplatePresentation(candidateSubtasks), sourceSubtasksPresentation);
	assertCanonicalDynamicLock(candidateFileTask, DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER);
	assertCanonicalDynamicLock(candidateSubtasks, DYNAMIC_SUBTASKS_FILTER_OPERON_ID_PLACEHOLDER);

	const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(applied.status === 'success' || applied.status === 'success-with-migrations');
	assert.ok(applied.receipt);
	const committed = await harness.storage.captureCommittedSettingsBackupSnapshot();
	const committedFileTask = dynamicTemplate(committed.settings, DYNAMIC_FILE_TASK_FILTER_ID);
	const committedSubtasks = dynamicTemplate(committed.settings, DYNAMIC_SUBTASKS_FILTER_ID);
	assert.deepEqual(dynamicTemplatePresentation(committedFileTask), sourceFilePresentation);
	assert.deepEqual(dynamicTemplatePresentation(committedSubtasks), sourceSubtasksPresentation);
	assertCanonicalDynamicLock(committedFileTask, DYNAMIC_FILE_TASK_FILTER_OPERON_ID_PLACEHOLDER);
	assertCanonicalDynamicLock(committedSubtasks, DYNAMIC_SUBTASKS_FILTER_OPERON_ID_PLACEHOLDER);
	assert.deepEqual(protectedProjection(harness.data.committed), protectedBefore);

	const token = applied.receipt.recovery.undoTokenId;
	assert.ok(token);
	const undone = await harness.storage.undoSettingsBackupRestoreV1(token as string, applied.receipt.receiptId);
	assert.equal(undone.status, 'success');
	const restored = await harness.storage.captureCommittedSettingsBackupSnapshot();
	assert.deepEqual(
		dynamicTemplatePresentation(dynamicTemplate(restored.settings, DYNAMIC_FILE_TASK_FILTER_ID)),
		targetFileTask,
	);
	assert.deepEqual(
		dynamicTemplatePresentation(dynamicTemplate(restored.settings, DYNAMIC_SUBTASKS_FILTER_ID)),
		targetSubtasks,
	);
	assert.deepEqual(protectedProjection(harness.data.committed), protectedBefore);
});

test('staging failure returns a structured stage failure and performs zero writes', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const before = clone(harness.data.committed);
	const stageOwner = harness.storage as unknown as {
		stageCanonicalDataPackageReload: (dataPackage: OperonDataPackageV1) => never;
	};
	stageOwner.stageCanonicalDataPackageReload = () => { throw new Error('injected staging failure'); };

	const result = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'failed');
	assert.equal(result.failurePhase, 'stage');
	assert.equal(result.receipt, null);
	assert.equal(harness.data.saveAttempts, 0);
	assert.deepEqual(harness.data.committed, before);
	assert.equal(harness.storage.getSettings().language, current.language);
});

test('invalid acknowledgement, invalid timestamp, and suspended writes are zero-write admissions', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const before = clone(harness.data.committed);
	const invalidAck = applyInput(sourceJson, plan);
	invalidAck.acknowledgement = { ...invalidAck.acknowledgement, planId: 'tampered' };
	const rejected = await harness.storage.applySettingsBackupRestorePlanV1(invalidAck);
	assert.equal(rejected.status, 'blocked');
	assert.equal(rejected.blockedReason, 'acknowledgement-mismatch');
	const invalidTime = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan, 'not-a-time'));
	assert.equal(invalidTime.status, 'blocked');
	assert.equal(invalidTime.blockedReason, 'invalid-applied-at');
	const refreshFailed = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(sourceJson, plan),
		async () => { throw new Error('injected Vault admission failure'); },
	);
	assert.equal(refreshFailed.status, 'blocked');
	assert.equal(refreshFailed.blockedReason, 'vault-reference-changed');
	harness.storage.suspendCanonicalSettingsWrites('test suspension');
	const suspended = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(suspended.status, 'blocked');
	assert.equal(suspended.blockedReason, 'writes-suspended');
	assert.equal(harness.data.saveAttempts, 0);
	assert.deepEqual(harness.data.committed, before);
});

test('reapplying the same plan is idempotent and performs no second write', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const first = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(first.receipt);
	assert.equal(harness.data.saveAttempts, 1);
	const second = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan, '2026-08-10T20:01:00.000Z'));
	assert.ok(second.receipt);
	assert.equal(second.receipt?.alreadyApplied, true);
	assert.equal(second.receipt?.canonicalWrite, 'not-attempted');
	assert.equal(second.receipt?.currentTargetFingerprint, plan.candidateFingerprint);
	assert.equal(harness.data.saveAttempts, 1);
});

test('exact-plan retry remains idempotent after an unselected target setting changes', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source, ['general']);
	const first = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(first.receipt);
	assert.equal(harness.data.saveAttempts, 1);

	await harness.storage.updateSettings({ tableShowLineNumbers: !current.tableShowLineNumbers });
	assert.equal(harness.data.saveAttempts, 2);
	const beforeRetry = clone(harness.data.committed);
	const currentAfterUnselectedChange = await harness.storage.captureCommittedSettingsBackupSnapshot();
	const expectedCurrentFingerprint = computeOperonSettingsBackupSettingsFingerprintV1(
		currentAfterUnselectedChange.settings,
	);

	const retry = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(sourceJson, plan, '2026-08-10T20:01:00.000Z'),
	);
	assert.ok(retry.receipt);
	assert.equal(retry.receipt?.alreadyApplied, true);
	assert.equal(retry.receipt?.canonicalWrite, 'not-attempted');
	assert.equal(retry.receipt?.currentTargetFingerprint, expectedCurrentFingerprint);
	assert.notEqual(retry.receipt?.currentTargetFingerprint, plan.candidateFingerprint);
	assert.equal(harness.data.saveAttempts, 2);
	assert.deepEqual(harness.data.committed, beforeRetry);
});

test('exact-plan retry remains idempotent after target-preserved Table favorites change inside a selected group', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source, ['general', 'preset-favorites']);
	const first = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(first.receipt);
	assert.equal(harness.data.saveAttempts, 1);

	await harness.storage.updateSettings({
		presetFavorites: { ...source.presetFavorites, table: ['table-local'] },
	});
	assert.equal(harness.data.saveAttempts, 2);
	const beforeRetry = clone(harness.data.committed);

	const retry = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(sourceJson, plan, '2026-08-10T20:02:00.000Z'),
	);
	assert.ok(retry.receipt);
	assert.equal(retry.receipt?.alreadyApplied, true);
	assert.equal(retry.receipt?.canonicalWrite, 'not-attempted');
	assert.notEqual(retry.receipt?.planId, plan.planId);
	assert.equal(harness.data.saveAttempts, 2);
	assert.deepEqual(harness.data.committed, beforeRetry);
});

test('already-applied admission rejects an equivalent swapped source and changed refreshed Vault checks without writing', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const first = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(first.receipt);
	assert.equal(harness.data.saveAttempts, 1);
	const committed = clone(harness.data.committed);

	const equivalentSwappedSource = exportJson(source, '2026-08-10T18:00:01.000Z');
	const swapped = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(equivalentSwappedSource, plan, '2026-08-10T20:01:00.000Z'),
	);
	assert.equal(swapped.status, 'blocked');
	assert.equal(swapped.blockedReason, 'source-mismatch');

	const changedChecksInput = applyInput(sourceJson, plan, '2026-08-10T20:02:00.000Z');
	changedChecksInput.refreshedVaultReferenceChecks = {
		...plan.vaultReferenceChecks,
		fileTasksFolder: { status: 'valid' },
	};
	const changedChecks = await harness.storage.applySettingsBackupRestorePlanV1(changedChecksInput);
	assert.equal(changedChecks.status, 'blocked');
	assert.equal(changedChecks.blockedReason, 'vault-reference-changed');
	assert.equal(harness.data.saveAttempts, 1);
	assert.deepEqual(harness.data.committed, committed);
});

test('already-applied admission canonicalizes a recomputed plan with a tampered selected candidate without writing', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source, ['general']);
	const first = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(first.receipt);
	assert.equal(harness.data.saveAttempts, 1);
	const committed = clone(harness.data.committed);
	const freshCanonicalPlan = (await createPlan(harness.storage, source, ['general'])).plan;

	const tamperedCandidate = clone(plan.candidateSettings);
	changeLanguage(tamperedCandidate);
	const tamperedPlan: OperonSettingsBackupRestorePlanV1 = {
		...plan,
		candidateSettings: tamperedCandidate,
		candidateFingerprint: computeOperonSettingsBackupSettingsFingerprintV1(tamperedCandidate),
	};
	tamperedPlan.planId = computeOperonSettingsBackupApplyPlanIdV1(tamperedPlan);
	const tampered = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(sourceJson, tamperedPlan, '2026-08-10T20:03:00.000Z'),
	);
	assert.ok(tampered.receipt);
	assert.equal(tampered.receipt?.alreadyApplied, true);
	assert.equal(tampered.receipt?.canonicalWrite, 'not-attempted');
	assert.equal(tampered.receipt?.planId, freshCanonicalPlan.planId);
	assert.equal(tampered.receipt?.candidateFingerprint, first.receipt?.candidateFingerprint);
	assert.notEqual(tampered.receipt?.planId, tamperedPlan.planId);
	assert.notEqual(tampered.receipt?.candidateFingerprint, tamperedPlan.candidateFingerprint);
	assert.equal(harness.data.saveAttempts, 1);
	assert.deepEqual(harness.data.committed, committed);
});

test('clean persistence rejection returns failed without publishing candidate state', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const before = clone(harness.data.committed);
	harness.data.mode = 'fail-clean';
	const result = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'failed');
	assert.equal(result.failurePhase, 'persist');
	assert.equal(result.receipt, null);
	assert.equal(harness.data.saveAttempts, 1);
	assert.equal(harness.data.saveSuccesses, 0);
	assert.deepEqual(harness.data.committed, before);
	const snapshot = await harness.storage.captureCommittedSettingsBackupSnapshot();
	assert.equal(snapshot.settings.language, current.language);
});

test('commit acknowledgement loss is verified as success and publishes canonical and runtime candidates', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	harness.data.mode = 'commit-then-error';

	const result = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(result.status === 'success' || result.status === 'success-with-migrations');
	assert.equal(result.receipt.canonicalWrite, 'committed-after-error');
	assert.equal(result.receipt.alreadyApplied, false);
	assert.equal(harness.data.saveAttempts, 1);
	assert.equal(harness.data.saveSuccesses, 1);
	assert.equal(harness.data.committed.settings.language, source.language);
	assert.equal(harness.storage.getSettings().language, source.language);
	assert.equal((await harness.storage.captureCommittedSettingsBackupSnapshot()).settings.language, source.language);
});

test('reset-style apply commits without creating or advertising session Undo', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);

	const result = await harness.storage.applySettingsBackupRestorePlanV1({
		...applyInput(sourceJson, plan),
		retainSessionUndo: false,
	});

	assert.ok(result.status === 'success' || result.status === 'success-with-migrations');
	assert.ok(result.receipt);
	assert.equal(result.receipt.recovery.mode, 'none');
	assert.equal(result.receipt.recovery.undoTokenId, null);
	assert.equal(result.receipt.recovery.keepAvailable, false);
	assert.equal(result.receipt.recovery.retryRuntimeRefreshAvailable, false);
	assert.equal(result.receipt.recovery.undoAvailable, false);
	assert.equal(harness.data.saveAttempts, 1);
	assert.equal(harness.data.saveSuccesses, 1);
	assert.equal(harness.data.committed.settings.language, source.language);
});

test('ambiguous persistence failure suspends writes, returns a redacted decision receipt, and never retries', async () => {
	const target = baselineSettings();
	const initial = canonicalPackage(target);
	initial.integrations.mobileNotifications.vaultId = SECRET_VAULT_ID;
	const harness = await createHarness(initial);
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	assert.ok(source.externalCalendars[0]);
	source.externalCalendars = [{ ...source.externalCalendars[0], url: SECRET_URL }];
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	harness.data.mode = 'unknown';
	const result = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'partial-user-decision-required');
	assert.equal(result.failurePhase, 'commit-state-unknown');
	assert.equal(result.receipt?.canonicalWrite, 'state-unknown');
	assert.equal(result.receipt?.currentTargetFingerprint, null);
	assert.equal(harness.data.saveAttempts, 1);
	const after = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(after.status, 'blocked');
	assert.equal(after.blockedReason, 'writes-suspended');
	assert.equal(harness.data.saveAttempts, 1);
	const serialized = JSON.stringify(result);
	assert.equal(serialized.includes(SECRET_URL), false);
	assert.equal(serialized.includes(SECRET_VAULT_ID), false);
});

test('settings mutex rebases admission after a concurrent committed settings update', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const gate = harness.data.gateNextSave();
	const priorUpdate = harness.storage.updateSettings({ checkForUpdatesOnStartup: !current.checkForUpdatesOnStartup });
	await gate.started;
	const apply = harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	gate.release();
	await priorUpdate;
	const result = await apply;
	assert.equal(result.status, 'blocked');
	assert.equal(result.blockedReason, 'stale-target');
	assert.equal(harness.data.saveAttempts, 1);
	assert.equal(harness.data.committed.settings.checkForUpdatesOnStartup, !current.checkForUpdatesOnStartup);
});

test('a later settings update waits for a gated apply and preserves both committed changes', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const gate = harness.data.gateNextSave();
	const apply = harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	await gate.started;
	const laterUpdate = harness.storage.updateSettings({
		checkForUpdatesOnStartup: !current.checkForUpdatesOnStartup,
	});
	assert.equal(harness.data.saveAttempts, 1);
	gate.release();
	const [applyResult] = await Promise.all([apply, laterUpdate]);

	assert.ok(applyResult.status === 'success' || applyResult.status === 'success-with-migrations');
	assert.equal(harness.data.saveAttempts, 2);
	assert.equal(harness.data.saveSuccesses, 2);
	const committed = await harness.storage.captureCommittedSettingsBackupSnapshot();
	assert.equal(committed.settings.language, source.language);
	assert.equal(committed.settings.checkForUpdatesOnStartup, !current.checkForUpdatesOnStartup);
	assert.equal(harness.storage.getSettings().language, source.language);
	assert.equal(harness.storage.getSettings().checkForUpdatesOnStartup, !current.checkForUpdatesOnStartup);
});

test('clean undo failure retains its token for a later successful retry', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	const token = applied.receipt?.recovery.undoTokenId;
	const receiptId = applied.receipt?.receiptId;
	assert.ok(token);
	assert.ok(receiptId);
	harness.data.mode = 'fail-clean';
	const failed = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(failed.status, 'failed');
	assert.equal(harness.storage.getSettings().language, source.language);
	const attemptsAfterFailure = harness.data.saveAttempts;

	harness.data.mode = 'normal';
	const retried = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(retried.status, 'success');
	assert.equal(retried.receiptId, failed.receiptId);
	assert.equal(harness.data.saveAttempts, attemptsAfterFailure + 1);
	assert.equal(harness.storage.getSettings().language, current.language);
	assert.equal((await harness.storage.captureCommittedSettingsBackupSnapshot()).settings.language, current.language);
});

test('undo receipt mismatch is zero-write and leaves the token usable by its owning receipt', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	const token = applied.receipt?.recovery.undoTokenId;
	const receiptId = applied.receipt?.receiptId;
	assert.ok(token);
	assert.ok(receiptId);
	const attemptsBeforeMismatch = harness.data.saveAttempts;

	const mismatched = await harness.storage.undoSettingsBackupRestoreV1(token as string, 'wrong-receipt-id');
	assert.equal(mismatched.status, 'blocked');
	assert.equal(mismatched.blockedReason, 'not-available');
	assert.equal(mismatched.receiptId, 'wrong-receipt-id');
	assert.equal(harness.data.saveAttempts, attemptsBeforeMismatch);
	assert.equal(harness.storage.getSettings().language, source.language);

	const owned = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(owned.status, 'success');
	assert.equal(owned.receiptId, receiptId);
	assert.equal(harness.data.saveAttempts, attemptsBeforeMismatch + 1);
	assert.equal(harness.storage.getSettings().language, current.language);
});

test('ambiguous undo suspends writes, requires a user decision, and invalidates its retry token', async () => {
	const harness = await createHarness(canonicalPackage(baselineSettings()));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	const token = applied.receipt?.recovery.undoTokenId;
	const receiptId = applied.receipt?.receiptId;
	assert.ok(token);
	assert.ok(receiptId);
	harness.data.mode = 'unknown';
	const attemptsBeforeUndo = harness.data.saveAttempts;

	const ambiguous = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(ambiguous.status, 'partial-user-decision-required');
	assert.equal(ambiguous.receiptId, receiptId);
	assert.equal(ambiguous.failurePhase, 'commit-state-unknown');
	assert.equal(harness.data.saveAttempts, attemptsBeforeUndo + 1);
	const suspended = await harness.storage.captureCommittedSettingsBackupSnapshot();
	assert.equal(suspended.canonicalWritesSuspended, true);
	const attemptsBeforeRetry = harness.data.saveAttempts;
	const retry = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(retry.status, 'blocked');
	assert.equal(retry.blockedReason, 'not-available');
	assert.equal(harness.data.saveAttempts, attemptsBeforeRetry);
});

test('session undo restores selected groups once and rejects stale-target undo without writing', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	changeLanguage(source);
	const { sourceJson, plan } = await createPlan(harness.storage, source);
	const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	const token = applied.receipt?.recovery.undoTokenId;
	const receiptId = applied.receipt?.receiptId;
	assert.ok(token);
	assert.ok(receiptId);
	const undone = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(undone.status, 'success');
	assert.equal((await harness.storage.captureCommittedSettingsBackupSnapshot()).settings.language, current.language);
	const second = await harness.storage.undoSettingsBackupRestoreV1(token as string, receiptId as string);
	assert.equal(second.status, 'blocked');
	assert.equal(second.blockedReason, 'not-available');

	const nextSource = clone(current);
	changeLanguage(nextSource);
	const next = await createPlan(harness.storage, nextSource);
	const nextApplied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(next.sourceJson, next.plan, '2026-08-10T20:02:00.000Z'));
	const staleToken = nextApplied.receipt?.recovery.undoTokenId;
	const staleReceiptId = nextApplied.receipt?.receiptId;
	assert.ok(staleToken);
	assert.ok(staleReceiptId);
	await harness.storage.updateSettings({ checkForUpdatesOnStartup: !current.checkForUpdatesOnStartup });
	const attemptsBeforeUndo = harness.data.saveAttempts;
	const staleUndo = await harness.storage.undoSettingsBackupRestoreV1(staleToken as string, staleReceiptId as string);
	assert.equal(staleUndo.status, 'blocked');
	assert.equal(staleUndo.blockedReason, 'stale-target');
	assert.equal(harness.data.saveAttempts, attemptsBeforeUndo);
	assert.equal(JSON.stringify(staleUndo).includes(SECRET_URL), false);
});

test('JSON projection preserves Table authority while applying four global preferences', () => {
	const current = canonicalPackage(baselineSettings());
	const candidate = composeOperonSettingsFromDataPackage(current, DEFAULT_SETTINGS);
	changeLanguage(candidate);
	candidate.tablePresetFileBindings = [{ id: 'table-imported', path: 'Tables/Imported.table' }];
	candidate.tablePresetOrderIds = ['table-imported'];
	candidate.tableDefaultPresetId = 'table-imported';
	candidate.tablePresetFileInitialized = true;
	candidate.tablePresets = [];
	candidate.presetFavorites = { ...candidate.presetFavorites, table: ['table-imported'] };
	candidate.tableEmbedVisibleRows = candidate.tableEmbedVisibleRows === 20 ? 30 : 20;
	candidate.tableShowLineNumbers = !candidate.tableShowLineNumbers;
	candidate.tableShowTaskIcon = !candidate.tableShowTaskIcon;
	candidate.tableShowTaskTypeIcon = !candidate.tableShowTaskTypeIcon;
	const jsonOnly = projectOperonSettingsBackupApplyDataPackageV1(current, candidate);
	assert.deepEqual(jsonOnly.views.tablePresets, {
		...current.views.tablePresets,
		tableEmbedVisibleRows: candidate.tableEmbedVisibleRows,
		tableShowLineNumbers: candidate.tableShowLineNumbers,
		tableShowTaskIcon: candidate.tableShowTaskIcon,
		tableShowTaskTypeIcon: candidate.tableShowTaskTypeIcon,
	});
	assert.deepEqual(jsonOnly.ui.presetFavorites?.table, current.ui.presetFavorites?.table);
	assert.deepEqual(jsonOnly.state, current.state);
	assert.deepEqual(jsonOnly.integrations.developerApi, current.integrations.developerApi);
});
