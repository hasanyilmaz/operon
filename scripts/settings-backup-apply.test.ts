import { createAutomationActionId, createAutomationRule, createAutomationRuleId, migrateAutomationRuleIds, readAutomationRules } from '../src/core/automation-rules';
import { normalizeTaskEditorSections } from '../src/types/task-editor-sections';
import { connectPluginDataAdapter } from './test-support/plugin-data-adapter';
import { defaultPropertyPoolPreferences } from '../src/core/property-value-pool';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { App } from 'obsidian';
import { sha256HexV1 } from '../src/agent-runtime/contracts/v1/canonical';
import type { JsonValue } from '../src/agent-runtime/contracts/v1/primitives';
import {
	computeOperonSettingsBackupApplyPlanIdV1,
	computeOperonSettingsBackupSettingsFingerprintV1,
	createOperonSettingsBackupApplyAcknowledgementV1,
	projectOperonSettingsBackupApplyDataPackageV1,
} from '../src/core/settings-backup-apply';
import { exportOperonSettingsBackupJsonV1 } from '../src/core/settings-backup-export';
import {
	buildOperonSettingsBackupV1,
	canonicalizeOperonSettingsBackupJson,
	serializeOperonSettingsBackupV1,
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
import { serializeOperonTableFile } from '../src/storage/table-file';
import { createDefaultTablePreset } from '../src/types/table';
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
		tablePresetFileInitialized: true,
		tableDefaultPresetId: 'table-target',
		tablePresets: DEFAULT_SETTINGS.tablePresets.map(preset => ({ ...preset, id: 'table-target' })),
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

async function createHarness(initial: OperonDataPackageV1, observeBoot?: (data: ControlledPluginData) => void,
	beforeBoot?: (data: ControlledPluginData, adapter: MemoryAdapter) => void): Promise<Harness> {
	const adapter = new MemoryAdapter();
	const data = new ControlledPluginData(initial);
	const tableSources = new Map((initial.views.tablePresets.fileBindings ?? []).map(binding => {
		const preset = createDefaultTablePreset();
		preset.id = binding.id;
		return [binding.path, serializeOperonTableFile(preset)] as const;
	}));
	const tableFiles = [...tableSources.keys()].map((filePath, index) => ({
		path: filePath,
		extension: 'table',
		name: path.basename(filePath),
		basename: path.basename(filePath, '.table'),
		stat: { mtime: index + 1, ctime: index + 1, size: tableSources.get(filePath)?.length ?? 0 },
	}));
	const app = {
		locale: 'en',
		vault: {
			configDir: '.obsidian',
			adapter,
			getFiles: () => tableFiles,
			read: async (file: { path: string }) => tableSources.get(file.path) ?? '',
		},
	} as unknown as App;
	const storage = new OperonStorage(app, connectPluginDataAdapter(adapter, { loadData: data.loadData, saveData: data.saveData }));
	beforeBoot?.(data, adapter);
	await storage.initialize();
	observeBoot?.(data);
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

function exportLegacyArchiveJson(settings: OperonSettings): string {
	const current = JSON.parse(exportJson(settings)) as { body: OperonSettingsBackupBodyV1 };
	const general = current.body.groups.general;
	assert.ok(general, 'current backup must contain its General group');
	const generalData = general.data as Record<string, JsonValue>;
	return serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1({
		...current.body,
		source: { ...current.body.source, settingsVersion: 113 },
		groups: {
			...current.body.groups,
			general: {
				...general,
				data: {
					...generalData,
					fileTaskAutoArchiveEnabled: false,
					fileTaskArchiveFolder: 'Legacy/Archive',
					fileTaskArchivePipelineLocations: [{ pipelineId: 'legacy-pipeline', folder: 'Legacy/Pipeline archive' }] as JsonValue,
					fileTaskArchiveDelaySeconds: 1,
					fileTaskArchiveOnlyFromFileTasksFolder: true,
				},
			},
		},
	}));
}

async function createPlan(
	storage: OperonStorage,
	source: OperonSettings,
	selectedGroups: readonly ('general' | 'automations' | 'kanban' | 'calendar' | 'filters' | 'preset-favorites' | 'table-global' | 'priorities')[] = ['general'],
): Promise<{
	sourceJson: string;
	plan: OperonSettingsBackupRestorePlanV1;
}> {
	const target = await storage.captureCommittedSettingsBackupSnapshot();
	const sourceJson = exportJson(source);
	const preflight = preflightOperonSettingsBackupRestoreV1({ sourceJson, targetSnapshot: target, selectedGroups });
	assert.equal(preflight.ok, true, JSON.stringify(preflight.ok ? [] : preflight.diagnostics, null, 2));
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

test('new and duplicate automation rule IDs avoid existing IDs', () => {
	const random = Math.random;
	try {
		Math.random = () => 0;
		const first = createAutomationRule('First');
		assert.equal(first.id, 'ar_0000000');
		assert.deepEqual([first.scope.id, first.target.id], ['fg_00000000', 'fg_00000001']);
		const used = new Set(['act_00000000']);
		assert.equal(createAutomationActionId(used), 'act_00000001');
		assert.equal(createAutomationActionId(used), 'act_00000002');
		const second = createAutomationRule('Second', [first]);
		assert.equal(second.id, 'ar_0000001');
		assert.equal(createAutomationRuleId([first, second]), 'ar_0000002');
	} finally {
		Math.random = random;
	}
});

test('nested ID migration reserves existing nodes and actions and keeps rule contents intact', () => {
	const rule = createAutomationRule('Example');
	rule.scope.id = 'scope-00000000';
	rule.target.id = 'fg_00000001';
	rule.scope.children.push({ id: 'fg_00000000', logic: 'all', children: [] });
	rule.actions = ['old-00000000', 'act_00000000', 'other-00000000'].map(id => (
		{ id, field: 'tags', operation: 'add', value: ['review'] }
	));
	const settings = { ...readAutomationRules(undefined), rules: [rule] };
	const expected = clone(settings);
	expected.rules[0].scope.id = 'fg_00000002';
	expected.rules[0].actions[0].id = 'act_00000001';
	expected.rules[0].actions[2].id = 'act_00000002';
	const migrated = migrateAutomationRuleIds(settings);
	assert.deepEqual(migrated, expected);
	assert.equal(migrateAutomationRuleIds(migrated), migrated);
	const both = clone(settings);
	both.rules[0].target.id = both.rules[0].scope.id;
	const [converted] = migrateAutomationRuleIds(both).rules;
	assert.match(converted.target.id, /^fg_[0-9a-z]{8}$/u);
	assert.notEqual(converted.scope.id, converted.target.id);
});

for (const schema of [2, 3] as const) {
	test('legacy automation rule IDs migrate once with a recoverable preimage on schema ' + schema, async () => {
		const defaults = clone(DEFAULT_SETTINGS);
		defaults.filterSets.push(createDefaultDynamicFileTaskFilterSet(), createDefaultDynamicSubtasksFilterSet());
		const initial = canonicalPackage(defaults);
		initial.schemaVersion = schema;
		if (schema === 3) initial.taxonomy.inlinePropertyDefinitions = { version: 1, entries: [] };
		const ids = ['old-a123456', 'ar_a123456', 'legacy-a123456', '!!!'];
		const rules = ids.map(id => ({ ...createAutomationRule(id), id, active: true }));
		rules[0].scope.id = 'old-scope';
		rules[0].target.id = 'old-target';
		rules[0].actions.push({ id: 'old-action', operation: 'remove', field: 'tags', value: ['review'] });
		const original = { ...readAutomationRules(undefined), rules };
		initial.automation.ruleSettings = original;
		const migrated = migrateAutomationRuleIds(original);
		assert.deepEqual(migrated.rules.map(rule => rule.id), ['ar_a123458', 'ar_a123456', 'ar_a123457', 'ar_0000000']);
		assert.deepEqual(migrated.rules, migrateAutomationRuleIds({ ...original, rules: [...rules].reverse() }).rules.reverse());
		assert.equal(migrateAutomationRuleIds(migrated), migrated);
		const expected = clone(initial);
		expected.automation.ruleSettings = migrated;
		const first = await createHarness(initial, data => assert.equal(data.saveSuccesses, 1));
		assert.deepEqual(first.data.committed, expected);
		assert.ok([...first.adapter.files].some(([name, value]) => name.includes('.bak') && JSON.stringify(JSON.parse(value)) === JSON.stringify(initial)));
		first.storage.destroy();
		const second = await createHarness(expected, data => assert.equal(data.saveAttempts, 0));
		second.data.committed = clone(initial);
		await second.storage.reloadCanonicalSettingsPackage();
		assert.deepEqual(second.data.committed, expected);
		assert.equal(second.data.saveSuccesses, 1);
		await second.storage.reloadCanonicalSettingsPackage();
		assert.equal(second.data.saveAttempts, 1);
		second.storage.destroy();
	});
}

for (const schema of [2, 3] as const) {
	test('automation drafts survive reload without initializing absent rules on schema ' + schema, async () => {
		const defaultsWithFilters = clone(DEFAULT_SETTINGS);
		defaultsWithFilters.filterSets.push(createDefaultDynamicFileTaskFilterSet(), createDefaultDynamicSubtasksFilterSet());
		const initial = canonicalPackage(defaultsWithFilters);
		initial.schemaVersion = schema;
		if (schema === 3) initial.taxonomy.inlinePropertyDefinitions = { version: 1, entries: [] };
		const observe = (data: ControlledPluginData): void => {
			assert.equal(data.saveAttempts, 0, 'opening an existing package must not save settings');
		};
		const first = await createHarness(initial, observe);
		const second = await createHarness(first.data.committed, observe);
		first.storage.destroy();
		const { storage, data } = second;
		const draft = createAutomationRule(' Example ');
		const defaults = readAutomationRules(storage.getSettings().automationRules);
		assert.deepEqual(defaults, { version: 1, confirmation: 'always', rules: [] });
		assert.equal(draft.name, 'Example');
		assert.deepEqual([draft.mode, draft.active, draft.scope.children, draft.target.children, draft.actions], ['manual', false, [], [], []]);
		assert.notEqual(draft.scope.id, draft.target.id);
		const next = { ...defaults, confirmation: 10 as const, rules: [draft] };
		const changes: unknown[] = [];
		const unsubscribe = storage.subscribeAutomationRules(() => changes.push(storage.getSettings().automationRules));
		const before = clone(data.committed);
		await storage.saveAutomationRules(undefined, next);
		assert.deepEqual(data.committed, { ...before, automation: { ...before.automation, ruleSettings: next } });
		assert.equal(data.saveSuccesses, 1);
		await assert.rejects(storage.saveAutomationRules(undefined, defaults));
		assert.equal(data.saveSuccesses, 1);
		data.mode = 'fail-clean';
		await assert.rejects(storage.saveAutomationRules(next, defaults));
		assert.deepEqual(storage.getSettings().automationRules, next);
		assert.deepEqual(data.committed.automation.ruleSettings, next);
		assert.deepEqual(changes, [next], 'stale and failed saves must stay silent');
		data.mode = 'normal';
		unsubscribe();
		await storage.saveAutomationRules(next, { ...next, rules: [{ ...draft, active: true }] });
		assert.deepEqual(changes, [next]);
		const restarted = await createHarness(data.committed, observe);
		assert.equal(readAutomationRules(restarted.storage.getSettings().automationRules).rules[0].active, true);
		storage.destroy();
		restarted.storage.destroy();
	});
}

test('automation ID migration recovers after backup failure, write rejection and acknowledgement loss', async () => {
	const defaults = clone(DEFAULT_SETTINGS);
	defaults.filterSets.push(createDefaultDynamicFileTaskFilterSet(), createDefaultDynamicSubtasksFilterSet());
	const original = { ...readAutomationRules(undefined), rules: [{ ...createAutomationRule('Existing'), id: 'legacy-rule' }] };
	const initial = canonicalPackage({ ...defaults, automationRules: original });
	const expected = clone(initial);
	expected.automation.ruleSettings = migrateAutomationRuleIds(original);
	for (const failure of ['backup', 'fail-clean', 'commit-then-error'] as const) {
		const committed = failure === 'commit-then-error';
		const first = await createHarness(initial, data => assert.equal(data.saveAttempts, failure === 'backup' ? 0 : 1), (data, adapter) => {
			if (failure === 'backup') adapter.write = async () => { throw new Error('Injected backup failure'); };
			else data.mode = failure;
		});
		assert.deepEqual(first.data.committed, committed ? expected : initial);
		assert.equal(Boolean(first.storage.getCanonicalSettingsWriteSuspensionReason()), !committed);
		first.storage.destroy();
		const restart = await createHarness(first.data.committed, data => assert.equal(data.saveAttempts, committed ? 0 : 1));
		assert.deepEqual(restart.data.committed, expected);
		restart.storage.destroy();
	}
});

test('Kanban command names follow committed saves, Restore, Undo and canonical reload', async () => {
	const { storage, data } = await createHarness(canonicalPackage(clone(DEFAULT_SETTINGS)));
	const before = clone(storage.getSettings().kanbanPresets);
	const source = { ...storage.getSettings(), kanbanPresets: before.map(preset => ({ ...preset, name: 'Restored ' + preset.name })) };
	const changes: string[][] = [];
	const names = () => storage.getSettings().kanbanPresets.map(p => p.name);
	const unsubscribe = storage.subscribeViewPresets(() => changes.push(names()));
	const { sourceJson, plan } = await createPlan(storage, source, ['kanban']);
	data.mode = 'fail-clean';
	assert.equal((await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan))).status, 'failed');
	assert.deepEqual(changes, []);
	data.mode = 'normal';
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'success');
	assert.deepEqual(changes, [source.kanbanPresets.map(p => p.name)]);
	const restored = clone(data.committed);
	const token = result.receipt?.recovery.undoTokenId;
	assert.ok(token && result.receipt);
	assert.equal((await storage.undoSettingsBackupRestoreV1(token, result.receipt.receiptId)).status, 'success');
	assert.deepEqual(changes[1], before.map(p => p.name));
	data.committed = restored;
	await storage.reloadCanonicalSettingsPackage();
	await storage.reloadCanonicalSettingsPackage();
	assert.deepEqual(changes, [source.kanbanPresets.map(p => p.name), before.map(p => p.name), source.kanbanPresets.map(p => p.name)]);
	unsubscribe();
	storage.destroy();
});

test('Calendar and saved Filter commands observe successful saves, Restore and Undo', async () => {
	const { storage } = await createHarness(canonicalPackage(clone(DEFAULT_SETTINGS)));
	const settings = storage.getSettings();
	const filter = settings.filterSets.find(item => item.id !== DYNAMIC_FILE_TASK_FILTER_ID && item.id !== DYNAMIC_SUBTASKS_FILTER_ID)!;
	const calendar = settings.calendarPresets[0]!;
	const names = () => [settings.calendarPresets.find(item => item.id === calendar.id)?.name,
		settings.filterSets.find(item => item.id === filter.id)?.name];
	const changes: ReturnType<typeof names>[] = [];
	const unsubscribe = storage.subscribeViewPresets(() => changes.push(names()));
	await storage.filters.upsert({ ...filter, name: 'Saved filter' });
	assert.deepEqual(changes.at(-1), [calendar.name, 'Saved filter']);
	await storage.updateSettings({calendarPresets: settings.calendarPresets.map(item =>
		item.id === calendar.id ? { ...item, name: 'Saved calendar' } : item)});
	assert.deepEqual(changes.at(-1), ['Saved calendar', 'Saved filter']);
	const source = { ...settings,
		calendarPresets: settings.calendarPresets.map(item => item.id === calendar.id ? {...item,name:'Restored calendar'} : item),
		filterSets: settings.filterSets.map(item => item.id === filter.id ? {...item,name:'Restored filter'} : item) };
	const {sourceJson, plan} = await createPlan(storage, source, ['calendar','filters']);
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'success');
	assert.deepEqual(changes.at(-1), ['Restored calendar','Restored filter']);
	const token = result.receipt?.recovery.undoTokenId;
	assert.ok(token && result.receipt);
	assert.equal((await storage.undoSettingsBackupRestoreV1(token, result.receipt.receiptId)).status, 'success');
	assert.deepEqual(changes.at(-1), ['Saved calendar','Saved filter']);
	unsubscribe();
	storage.destroy();
});

test('selected automation restore deactivates all imported rules and Undo restores the exact preimage', async () => {
	const activeRule = { ...createAutomationRule('Existing'), active: true, mode: 'auto' as const };
	const previous = { ...readAutomationRules(undefined), rules: [activeRule] };
	const harness = await createHarness(canonicalPackage({ ...clone(DEFAULT_SETTINGS), automationRules: previous }));
	const { storage, data } = harness;
	const imported = [createAutomationRule('First'), { ...createAutomationRule('Second'), id: 'legacy-rule', active: true }];
	imported[1].actions.push({ id: 'action', field: 'tags', operation: 'add', value: 'review' });
	const source = { ...storage.getSettings(), automationRules: { ...previous, confirmation: 25, rules: imported } };
	const { sourceJson, plan } = await createPlan(storage, source, ['automations']);
	assert.deepEqual(JSON.parse(sourceJson).body.groups.automations.data.rules.map((rule: { active: boolean }) => rule.active), [false, true]);
	const expected = { ...source.automationRules, rules: imported.map(rule => ({ ...rule, active: false })) };
	expected.rules[1] = { ...expected.rules[1], id: 'ar_acyrule', actions: [{ ...imported[1].actions[0], id: 'act_00action' }] };
	assert.deepEqual(plan.candidateSettings.automationRules, expected);
	const changes: unknown[] = [];
	storage.subscribeAutomationRules(() => changes.push(storage.getSettings().automationRules));
	const before = clone(data.committed);
	data.mode = 'fail-clean';
	assert.equal((await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan))).status, 'failed');
	assert.deepEqual(changes, []);
	data.mode = 'normal';
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'success');
	assert.deepEqual(changes, [expected]);
	assert.deepEqual(data.committed, { ...before, automation: { ...before.automation, ruleSettings: expected } });
	const token = result.receipt?.recovery.undoTokenId;
	assert.ok(token && result.receipt);
	data.mode = 'fail-clean';
	assert.equal((await storage.undoSettingsBackupRestoreV1(token, result.receipt.receiptId)).status, 'failed');
	assert.deepEqual(changes, [expected]);
	data.mode = 'normal';
	assert.equal((await storage.undoSettingsBackupRestoreV1(token, result.receipt.receiptId)).status, 'success');
	assert.deepEqual(data.committed, before);
	await storage.reloadCanonicalSettingsPackage();
	assert.deepEqual(changes, [expected, previous], 'Undo publishes its preimage once, identical reload stays silent');
	const unselected = await createPlan(storage, source, ['general']);
	assert.deepEqual(unselected.plan.candidateSettings.automationRules, previous);
	const body = JSON.parse(sourceJson).body as OperonSettingsBackupBodyV1;
	delete body.groups.automations;
	const legacy = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(body));
	const legacyPlan = preflightOperonSettingsBackupRestoreV1({ sourceJson: legacy, targetSnapshot: await storage.captureCommittedSettingsBackupSnapshot(), selectedGroups: ['general'] });
	assert.ok(legacyPlan.ok && legacyPlan.restorePlan);
	assert.deepEqual(legacyPlan.restorePlan.candidateSettings.automationRules, previous);
	storage.destroy();
});

test('unreadable stored automation rules survive unrelated saves, reload and restore', async () => {
	const future = { version: 2, rules: ['future format'] };
	const harness = await createHarness(canonicalPackage({ ...clone(DEFAULT_SETTINGS), automationRules: future }));
	const { storage, data } = harness;
	const source = { ...storage.getSettings(), automationRules: readAutomationRules(undefined) };
	await assert.rejects(storage.saveAutomationRules(future, source.automationRules));
	await assert.rejects(storage.updateSettings({ automationRules: source.automationRules }));
	await storage.updateSettings({ language: 'de' });
	assert.deepEqual(data.committed.automation.ruleSettings, future);
	const sourceJson = exportJson(source);
	const snapshot = await storage.captureCommittedSettingsBackupSnapshot();
	const blocked = preflightOperonSettingsBackupRestoreV1({ sourceJson, targetSnapshot: snapshot, selectedGroups: ['automations'] });
	assert.ok(blocked.ok && !blocked.restorePlan);
	const unrelated = await createPlan(storage, source, ['general']);
	assert.deepEqual(unrelated.plan.candidateSettings.automationRules, future);
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(unrelated.sourceJson, unrelated.plan));
	assert.equal(result.status, 'success');
	assert.deepEqual(data.committed.automation.ruleSettings, future);
	storage.destroy();
});

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

test('property pool backup roundtrip and Undo restore the absent-section preimage', async () => {
	const { storage, data } = await createHarness(canonicalPackage(baselineSettings()));
	const source = clone((await storage.captureCommittedSettingsBackupSnapshot()).settings);
	assert.equal(source.propertyValuePool, undefined);
	let poolChanges = 0;
	const unsubscribe = storage.onPropertyValuePoolChange(() => { poolChanges++; });
	const preferences = defaultPropertyPoolPreferences();
	preferences.favorites.push({ key: 'tags', type: 'list', value: 'work', label: '#work' });
	source.propertyValuePool = preferences;
	const { sourceJson, plan } = await createPlan(storage, source, ['general']);
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'success');
	assert.deepEqual(data.committed.ui.propertyValuePool, preferences);
	assert.equal(poolChanges, 1);
	assert.ok(result.receipt?.recovery.undoTokenId);
	const undone = await storage.undoSettingsBackupRestoreV1(result.receipt.recovery.undoTokenId, result.receipt.receiptId);
	assert.equal(undone.status, 'success');
	assert.equal('propertyValuePool' in data.committed.ui, false);
	assert.equal(storage.getSettings().propertyValuePool, undefined);
	await storage.saveSettings();
	assert.equal('propertyValuePool' in data.committed.ui, false);
	assert.equal(poolChanges, 2);
	unsubscribe();
});

test('dock click preference backup Undo restores the absent memory default and survives the next save', async () => {
	const { storage, data } = await createHarness(canonicalPackage(baselineSettings()));
	const source = clone((await storage.captureCommittedSettingsBackupSnapshot()).settings);
	assert.equal(source.statusDockClickAction, undefined); source.statusDockClickAction = 'editor';
	const { sourceJson, plan } = await createPlan(storage, source, ['general']);
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'success'); assert.equal(data.committed.ui.statusDock?.clickAction, 'editor');
	assert.ok(result.receipt?.recovery.undoTokenId);
	const undone = await storage.undoSettingsBackupRestoreV1(result.receipt.recovery.undoTokenId, result.receipt.receiptId);
	assert.equal(undone.status, 'success'); assert.equal(data.committed.ui.statusDock?.clickAction, undefined);
	assert.equal(storage.getSettings().statusDockClickAction, undefined);
	await storage.saveSettings(); assert.equal(data.committed.ui.statusDock?.clickAction, undefined);
});

test('selected General backup round-trips custom editor groups, removed defaults and command order through Undo', async () => {
 const { storage, data } = await createHarness(canonicalPackage(baselineSettings()));
 const source = clone((await storage.captureCommittedSettingsBackupSnapshot()).settings);
 const baseline = clone(source.taskEditorSections);
 source.taskEditorSections = normalizeTaskEditorSections([
  { id: 'custom:references', name: 'References', properties: [{ kind: 'mapped', key: 'contexts' }, { kind: 'vault', name: 'Reading Count' }] },
  ...baseline.map(section => section.id === 'connections' ? { id: section.id, name: '', removed: true }
   : section.id === 'commands' ? { ...section, commandOrder: ['pin', 'tracker', 'scrollbars', 'checkboxes', 'subtask', 'inlineSubtask', 'remove'] } : section),
 ]);
 const { sourceJson, plan } = await createPlan(storage, source, ['general']);
 const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
 assert.equal(result.status, 'success');
 assert.deepEqual(data.committed.ui.taskUiPreferences.taskEditorSections, source.taskEditorSections);
 assert.deepEqual(storage.getSettings().taskEditorSections, source.taskEditorSections);
 assert.ok(result.receipt?.recovery.undoTokenId);
 const undo = await storage.undoSettingsBackupRestoreV1(result.receipt.recovery.undoTokenId, result.receipt.receiptId);
 assert.equal(undo.status, 'success');
 assert.deepEqual(data.committed.ui.taskUiPreferences.taskEditorSections, baseline);
 assert.deepEqual(storage.getSettings().taskEditorSections, baseline);
});

test('taxonomy-only restore publishes pool changes only after successful runtime recovery', async () => {
	const { storage, data } = await createHarness(canonicalPackage(baselineSettings()));
	const source = clone(storage.getSettings());
	const previousLabel = source.priorities[0].label;
	source.priorities[0].label = 'Renamed priority';
	if (source.defaultPriority === previousLabel) source.defaultPriority = 'Renamed priority';
	const { sourceJson, plan } = await createPlan(storage, source, ['priorities']);
	const stageOwner = storage as unknown as {
		stageCanonicalDataPackageReload: (dataPackage: OperonDataPackageV1) => { changed: boolean; commit: () => void; rollback: () => void };
	};
	const original = stageOwner.stageCanonicalDataPackageReload.bind(storage);
	stageOwner.stageCanonicalDataPackageReload = candidate => {
		const stage = original(candidate);
		return { ...stage, commit: () => { stage.commit(); throw new Error('injected runtime commit failure'); } };
	};
	const observed: string[] = [];
	const unsubscribe = storage.onPropertyValuePoolChange(() => { observed.push(storage.getSettings().priorities[0].label); });
	const result = await storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.failurePhase, 'runtime-commit');
	assert.equal(data.committed.taxonomy.priorities.priorities[0].label, 'Renamed priority');
	assert.equal(storage.getSettings().priorities[0].label, previousLabel);
	assert.deepEqual(observed, []);
	stageOwner.stageCanonicalDataPackageReload = original;
	await storage.reloadCanonicalSettingsPackage();
	assert.deepEqual(observed, ['Renamed priority']);
	await storage.reloadCanonicalSettingsPackage();
	assert.equal(observed.length, 1);
	unsubscribe();
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
	source.language = 'pt-BR';
	source.languagePackSubscriptions = ['pt-BR'];
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
	assert.deepEqual(committed.settings.languagePackSubscriptions, ['pt-BR']);
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

test('periodic and pipeline-location settings export, preflight, and apply all twelve fields with typed Vault references idempotently', async () => {
	const target = baselineSettings();
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	const source = clone(current);
	const pipelineId = source.pipelines[0]?.id;
	assert.ok(pipelineId, 'backup fixture must retain one stable pipeline ID');
	Object.assign(source, {
		manageDailyNotesWithOperon: true,
		dailyNoteFormat: 'YYYY/MM/DD',
		dailyNoteTemplate: 'Templates/Periodic/Daily.md',
		dailyNoteFolder: 'Journal/Daily',
		createDailyNotesAsOperonTask: true,
		manageWeeklyNotesWithOperon: true,
		weeklyNoteFormat: 'GGGG/[W]WW',
		weeklyNoteTemplate: 'Templates/Periodic/Weekly.md',
		weeklyNoteFolder: 'Journal/Weekly',
		createWeeklyNotesAsOperonTask: true,
		fileTaskPipelineLocations: [{ pipelineId, folder: 'Projects/Tasks' }],
		moveConvertedNotesToPipelineLocation: true,
	});

	const sourceJson = exportJson(source);
	const exported = JSON.parse(sourceJson) as {
		body: { groups: { general: { data: Partial<OperonSettings> } } };
	};
	const periodicKeys = [
		'manageDailyNotesWithOperon', 'dailyNoteFormat', 'dailyNoteTemplate', 'dailyNoteFolder',
		'createDailyNotesAsOperonTask', 'manageWeeklyNotesWithOperon', 'weeklyNoteFormat',
		'weeklyNoteTemplate', 'weeklyNoteFolder', 'createWeeklyNotesAsOperonTask',
		'fileTaskPipelineLocations', 'moveConvertedNotesToPipelineLocation',
	] as const;
	for (const key of periodicKeys) {
		assert.deepEqual(exported.body.groups.general.data[key], source[key], `export must include ${key}`);
	}

	const targetSnapshot = await harness.storage.captureCommittedSettingsBackupSnapshot();
	const vaultReferenceChecks = {
		dailyNoteTemplate: { status: 'valid' as const },
		dailyNoteFolder: { status: 'valid' as const },
		weeklyNoteTemplate: { status: 'valid' as const },
		weeklyNoteFolder: { status: 'valid' as const },
		fileTaskPipelineLocations: { status: 'valid' as const },
	};
	const vaultReferenceDecisions = {
		dailyNoteTemplate: 'apply-source' as const,
		dailyNoteFolder: 'apply-source' as const,
		weeklyNoteTemplate: 'apply-source' as const,
		weeklyNoteFolder: 'apply-source' as const,
		fileTaskPipelineLocations: 'apply-source' as const,
	};
	const preflight = preflightOperonSettingsBackupRestoreV1({
		sourceJson,
		targetSnapshot,
		selectedGroups: ['general'],
		vaultReferenceChecks,
		vaultReferenceDecisions,
	});
	assert.equal(preflight.ok, true);
	if (!preflight.ok) throw new Error('Expected periodic settings preflight to succeed.');
	assert.equal(preflight.classification, 'ready', JSON.stringify(preflight.preview.issues, null, 2));
	assert.ok(preflight.restorePlan);
	const plan = preflight.restorePlan as OperonSettingsBackupRestorePlanV1;
	assert.deepEqual(plan.vaultReferenceChecks, vaultReferenceChecks);
	assert.deepEqual(plan.vaultReferenceDecisions, vaultReferenceDecisions);
	for (const key of periodicKeys) {
		assert.deepEqual(plan.candidateSettings[key], source[key], `preflight candidate must include ${key}`);
	}

	const first = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.ok(first.status === 'success' || first.status === 'success-with-migrations');
	assert.equal(harness.data.saveAttempts, 1);
	const committed = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	for (const key of periodicKeys) {
		assert.deepEqual(committed[key], source[key], `apply must commit ${key}`);
	}

	const second = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(sourceJson, plan, '2026-08-10T20:01:00.000Z'),
	);
	assert.equal(second.receipt?.alreadyApplied, true);
	assert.equal(second.receipt?.canonicalWrite, 'not-attempted');
	assert.equal(harness.data.saveAttempts, 1, 'second apply must not write again');
});

test('legacy archive backups preserve the target policy while v114 backups carry pipeline archive rules', async () => {
	const target = baselineSettings();
	const pipelineId = target.pipelines[0]?.id;
	assert.ok(pipelineId, 'backup fixture must retain one stable pipeline ID');
	Object.assign(target, {
		fileTaskArchiveFolder: 'Target/Archive',
		fileTaskArchivePipelineLocations: [{ pipelineId, folder: 'Target/Pipeline archive' }],
		fileTaskAutoArchiveEnabled: true,
		fileTaskArchiveDelaySeconds: 5,
		fileTaskArchiveOnlyFromFileTasksFolder: false,
	});
	const harness = await createHarness(canonicalPackage(target));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;

	const legacy = clone(current);
	legacy.language = 'de';
	const legacyJson = exportLegacyArchiveJson(legacy);
	const legacyPreflight = preflightOperonSettingsBackupRestoreV1({
		sourceJson: legacyJson,
		targetSnapshot: await harness.storage.captureCommittedSettingsBackupSnapshot(),
		selectedGroups: ['general'],
	});
	assert.equal(legacyPreflight.ok, true);
	if (!legacyPreflight.ok || !legacyPreflight.restorePlan) throw new Error('Expected legacy archive backup preflight to succeed.');
	assert.equal(legacyPreflight.classification, 'ready');
	assert.equal(legacyPreflight.restorePlan.candidateSettings.fileTaskArchiveFolder, current.fileTaskArchiveFolder);
	assert.deepEqual(legacyPreflight.restorePlan.candidateSettings.fileTaskArchivePipelineLocations, current.fileTaskArchivePipelineLocations);
	assert.equal(legacyPreflight.restorePlan.candidateSettings.fileTaskAutoArchiveEnabled, true);
	assert.equal(legacyPreflight.restorePlan.candidateSettings.fileTaskArchiveDelaySeconds, 5);
	assert.equal(legacyPreflight.restorePlan.candidateSettings.fileTaskArchiveOnlyFromFileTasksFolder, false);
	const legacyApplied = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(legacyJson, legacyPreflight.restorePlan),
	);
	assert.ok(legacyApplied.status === 'success' || legacyApplied.status === 'success-with-migrations');
	const afterLegacy = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	assert.equal(afterLegacy.language, 'de');
	assert.equal(afterLegacy.fileTaskArchiveFolder, current.fileTaskArchiveFolder);
	assert.deepEqual(afterLegacy.fileTaskArchivePipelineLocations, current.fileTaskArchivePipelineLocations);

	const sourcePipeline = clone(afterLegacy.pipelines[0]);
	assert.ok(sourcePipeline, 'backup fixture must retain a source pipeline');
	sourcePipeline.id = 'legacy-only-pipeline';
	sourcePipeline.name = 'Legacy-only pipeline';
	const legacyBody = JSON.parse(exportLegacyArchiveJson(afterLegacy)) as { body: OperonSettingsBackupBodyV1 };
	const legacyPipelineGroup = legacyBody.body.groups.pipelines;
	assert.ok(legacyPipelineGroup, 'legacy backup fixture must include its Pipelines group');
	const legacyPipelineJson = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1({
		...legacyBody.body,
		groups: {
			...legacyBody.body.groups,
			pipelines: {
				...legacyPipelineGroup,
				data: {
					...(legacyPipelineGroup.data as Record<string, JsonValue>),
					pipelines: [sourcePipeline] as unknown as JsonValue,
					defaultPipelineName: sourcePipeline.name,
				},
			},
		},
	}));
	const legacyPipelinePreflight = preflightOperonSettingsBackupRestoreV1({
		sourceJson: legacyPipelineJson,
		targetSnapshot: await harness.storage.captureCommittedSettingsBackupSnapshot(),
		selectedGroups: ['pipelines'],
	});
	assert.equal(legacyPipelinePreflight.ok, true);
	if (!legacyPipelinePreflight.ok) throw new Error('Expected legacy pipeline preflight to parse.');
	assert.equal(legacyPipelinePreflight.classification, 'blocked');
	assert.equal(legacyPipelinePreflight.restorePlan, null);
	assert.ok(legacyPipelinePreflight.preview.issues.some(issue => (
		issue.id === 'legacy-archive-pipeline-conflict'
		&& issue.group === 'pipelines'
		&& issue.severity === 'error'
	)), 'legacy Pipelines must be blocked before they can silently drop the current archive route');
	const afterBlockedLegacyPipeline = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	assert.deepEqual(
		afterBlockedLegacyPipeline.fileTaskArchivePipelineLocations,
		current.fileTaskArchivePipelineLocations,
		'blocked legacy pipeline restore must preserve the current archive routing policy',
	);

	const v114 = clone(afterLegacy);
	Object.assign(v114, {
		language: 'fr',
		languagePackSubscriptions: ['fr'],
		fileTaskArchiveFolder: 'Imported/Archive',
		fileTaskArchivePipelineLocations: [{ pipelineId, folder: 'Imported/Pipeline archive' }],
		fileTaskAutoArchiveEnabled: true,
		fileTaskArchiveDelaySeconds: 5,
		fileTaskArchiveOnlyFromFileTasksFolder: false,
	});
	const v114Json = exportJson(v114, '2026-08-10T18:01:00.000Z');
	const v114Preflight = preflightOperonSettingsBackupRestoreV1({
		sourceJson: v114Json,
		targetSnapshot: await harness.storage.captureCommittedSettingsBackupSnapshot(),
		selectedGroups: ['general'],
		vaultReferenceChecks: {
			fileTaskArchiveFolder: { status: 'valid' },
			fileTaskArchivePipelineLocations: { status: 'valid' },
		},
		vaultReferenceDecisions: {
			fileTaskArchiveFolder: 'apply-source',
			fileTaskArchivePipelineLocations: 'apply-source',
		},
	});
	assert.equal(v114Preflight.ok, true);
	if (!v114Preflight.ok || !v114Preflight.restorePlan) throw new Error('Expected v114 archive backup preflight to succeed.');
	assert.equal(v114Preflight.classification, 'ready');
	assert.equal(v114Preflight.restorePlan.candidateSettings.fileTaskArchiveFolder, 'Imported/Archive');
	assert.deepEqual(v114Preflight.restorePlan.candidateSettings.fileTaskArchivePipelineLocations, [{
		pipelineId,
		folder: 'Imported/Pipeline archive',
	}]);
	const v114Applied = await harness.storage.applySettingsBackupRestorePlanV1(
		applyInput(v114Json, v114Preflight.restorePlan, '2026-08-10T20:02:00.000Z'),
	);
	assert.ok(v114Applied.status === 'success' || v114Applied.status === 'success-with-migrations');
	const afterV114 = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	assert.equal(afterV114.language, 'fr');
	assert.equal(afterV114.fileTaskArchiveFolder, 'Imported/Archive');
	assert.deepEqual(afterV114.fileTaskArchivePipelineLocations, [{ pipelineId, folder: 'Imported/Pipeline archive' }]);
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

test('JSON projection preserves Table authority while applying Table-global preferences', () => {
	const current = canonicalPackage(baselineSettings());
	const candidate = composeOperonSettingsFromDataPackage(current, DEFAULT_SETTINGS);
	changeLanguage(candidate);
	candidate.tablePresetFileBindings = [{ id: 'table-imported', path: 'Tables/Imported.table' }];
	candidate.tablePresetOrderIds = ['table-imported'];
	candidate.tableDefaultPresetId = 'table-imported';
	candidate.tablePresetFileInitialized = true;
	candidate.tablePresets = [];
	candidate.presetFavorites = { ...candidate.presetFavorites, table: ['table-imported'] };
	candidate.tableDefaultFolder = 'Imported/Tables';
	candidate.tableEmbedVisibleRows = candidate.tableEmbedVisibleRows === 20 ? 30 : 20;
	candidate.tableShowLineNumbers = !candidate.tableShowLineNumbers;
	candidate.tableShowTaskIcon = !candidate.tableShowTaskIcon;
	candidate.tableShowTaskDataTypeIcon = !candidate.tableShowTaskDataTypeIcon;
	const jsonOnly = projectOperonSettingsBackupApplyDataPackageV1(current, candidate);
	assert.deepEqual(jsonOnly.views.tablePresets, {
		...current.views.tablePresets,
		tableDefaultFolder: candidate.tableDefaultFolder,
		tableEmbedVisibleRows: candidate.tableEmbedVisibleRows,
		tableShowLineNumbers: candidate.tableShowLineNumbers,
		tableShowTaskIcon: candidate.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: candidate.tableShowTaskDataTypeIcon,
	});
	assert.deepEqual(jsonOnly.ui.presetFavorites?.table, current.ui.presetFavorites?.table);
	assert.deepEqual(jsonOnly.state, current.state);
	assert.deepEqual(jsonOnly.integrations.developerApi, current.integrations.developerApi);
});

test('inline default template export/import preserves selection and reset removes it', async () => {
 const harness = await createHarness(canonicalPackage(clone(DEFAULT_SETTINGS)));
 const source = clone((await harness.storage.captureCommittedSettingsBackupSnapshot()).settings);
 source.defaultInlineTaskTemplateId = 'folder-file-task-template:Templates/Inline.md';
 const sourceJson = exportJson(source);
 const preflight = preflightOperonSettingsBackupRestoreV1({
  sourceJson, targetSnapshot: await harness.storage.captureCommittedSettingsBackupSnapshot(), selectedGroups: ['general'],
  vaultReferenceChecks: { defaultInlineTaskTemplateId: { status: 'unchecked' } },
  vaultReferenceDecisions: { defaultInlineTaskTemplateId: 'apply-source' },
 });
 assert.ok(preflight.ok && preflight.restorePlan);
 const result = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, preflight.restorePlan));
 assert.ok(result.status === 'success' || result.status === 'success-with-migrations');
 assert.equal(harness.storage.getSettings().defaultInlineTaskTemplateId, source.defaultInlineTaskTemplateId);
 await harness.storage.updateSettings({ defaultInlineTaskTemplateId: null });
 const saved = await harness.storage.captureCommittedSettingsBackupSnapshot();
 assert.equal(saved.settings.defaultInlineTaskTemplateId, null);
});

test('Mini Calendar preference follows other view preferences in General backup and undo restores an absent value', async () => {
 const harness = await createHarness(canonicalPackage(clone(DEFAULT_SETTINGS)));
 const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
 assert.equal(current.miniCalendarClickAction, undefined);
 const source = clone(current); source.miniCalendarClickAction = 'editor'; source.miniCalendarViewMode = 'month';
 const { sourceJson, plan } = await createPlan(harness.storage, source, ['general']);
 const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
 assert.ok(applied.status === 'success' || applied.status === 'success-with-migrations');
 assert.equal(harness.storage.getSettings().miniCalendarClickAction, 'editor');
 assert.equal(harness.storage.getSettings().miniCalendarViewMode, 'month');
 const token = applied.receipt?.recovery.undoTokenId;
 const receipt = applied.receipt?.receiptId;
 assert.ok(token && receipt);
 const undone = await harness.storage.undoSettingsBackupRestoreV1(token, receipt);
 assert.equal(undone.status, 'success');
 assert.equal(harness.storage.getSettings().miniCalendarClickAction, undefined);
 const snapshot = await harness.storage.captureCommittedSettingsBackupSnapshot();
 assert.equal(Object.prototype.hasOwnProperty.call(snapshot.settings, 'miniCalendarClickAction'), false);
 assert.equal(Object.prototype.hasOwnProperty.call(snapshot.settings, 'miniCalendarViewMode'), false);
 assert.equal(snapshot.settings.language, current.language);
 harness.storage.destroy();
});

test('vault icons round-trip in General, and undo restores the absence of a preference', async () => {
	const harness = await createHarness(canonicalPackage(clone(DEFAULT_SETTINGS)));
	const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
	assert.equal(current.vaultPropertyIcons, undefined);
	const source = { ...current, vaultPropertyIcons: { 'reading count': 'book-open' } };
	const { sourceJson, plan } = await createPlan(harness.storage, source, ['general']);
	const result = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
	assert.equal(result.status, 'success');
	assert.deepEqual(harness.storage.getSettings().vaultPropertyIcons, source.vaultPropertyIcons);
	const token = result.receipt?.recovery.undoTokenId;
	const receipt = result.receipt?.receiptId;
	assert.ok(token && receipt);
	assert.equal((await harness.storage.undoSettingsBackupRestoreV1(token, receipt)).status, 'success');
	assert.equal(harness.storage.getSettings().vaultPropertyIcons, undefined);
	assert.equal((await harness.storage.captureCommittedSettingsBackupSnapshot()).settings.vaultPropertyIcons, undefined);
	harness.storage.destroy();
});

test('General backups distinguish an absent legacy vault icon field from an explicit empty record', async () => {
	const current = { ...clone(DEFAULT_SETTINGS), vaultPropertyIcons: { 'reading count': 'book-open' } };
	const harness = await createHarness(canonicalPackage(current));
	const targetSnapshot = await harness.storage.captureCommittedSettingsBackupSnapshot();
	const source = { ...targetSnapshot.settings, vaultPropertyIcons: undefined };
	const currentExport = exportJson(source);
	const envelope = JSON.parse(currentExport) as { body: OperonSettingsBackupBodyV1 };
	const general = envelope.body.groups.general?.data as Record<string, JsonValue> | undefined;
	assert.ok(general);
	assert.deepEqual(general.vaultPropertyIcons, {});
	delete general.vaultPropertyIcons;
	const legacy = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(envelope.body));
	const candidateIcons = (sourceJson: string) => {
		const preflight = preflightOperonSettingsBackupRestoreV1({ sourceJson, targetSnapshot, selectedGroups: ['general'] });
		assert.equal(preflight.ok, true);
		if (!preflight.ok || !preflight.restorePlan) throw new Error('Missing restore plan');
		return preflight.restorePlan.candidateSettings.vaultPropertyIcons;
	};
	assert.deepEqual(candidateIcons(legacy), current.vaultPropertyIcons);
	assert.deepEqual(candidateIcons(currentExport), {});
	harness.storage.destroy();
});

test('General backup restores and undoes a Specific File heading independently of the general inline heading', async () => {
	const harness = await createHarness(canonicalPackage({ ...clone(DEFAULT_SETTINGS), inlineTaskHeading: 'New Todo' }));
	try {
		const current = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
		const { sourceJson, plan } = await createPlan(harness.storage, { ...current, inlineTaskSpecificFileHeading: 'Minor Tasks' }, ['general']);
		const applied = await harness.storage.applySettingsBackupRestorePlanV1(applyInput(sourceJson, plan));
		assert.equal(applied.status, 'success');
		assert.equal(harness.storage.getSettings().inlineTaskSpecificFileHeading, 'Minor Tasks');
		const receipt = applied.receipt;
		assert.ok(receipt?.recovery.undoTokenId);
		const undone = await harness.storage.undoSettingsBackupRestoreV1(receipt.recovery.undoTokenId, receipt.receiptId);
		assert.equal(undone.status, 'success');
		const restored = (await harness.storage.captureCommittedSettingsBackupSnapshot()).settings;
		assert.equal(restored.inlineTaskSpecificFileHeading, '');
		assert.equal(restored.inlineTaskHeading, 'New Todo');
	} finally {
		harness.storage.destroy();
	}
});
