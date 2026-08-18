import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
	type OperonDataPackageV1,
} from '../src/storage/operon-data-package';
import { OperonDataPackageStore } from '../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { discoverOperonTableFiles, serializeOperonTableFile } from '../src/storage/table-file';
import { TablePresetRegistry } from '../src/storage/table-preset-registry';
import {
	buildRetiredLegacyTablePresetDataPackageV1,
	buildRecoveredTablePresetDataPackageV1,
	preflightLegacyTablePresetSidecarRetirementV1,
	preflightTablePresetManifestRecoveryV1,
	readLooseTablePresetIdV1,
	type TablePresetLegacySidecarEvidenceV1,
	type TablePresetManifestRecoveryFileEvidence,
} from '../src/storage/table-preset-manifest-recovery';
import {
	resolveTablePresetBootstrapAction,
	resolveTablePresetDefaultAfterRegistrySync,
} from '../src/storage/table-preset-manifest';
import { createDefaultTablePreset } from '../src/types/table';
import { DEFAULT_SETTINGS } from '../src/types/settings';

class RecoveryMemoryAdapter {
	readonly files = new Map<string, string>();
	readonly writePaths: string[] = [];
	processMode: 'normal' | 'throw-before' | 'commit-then-throw' | 'unknown' | 'partial-unknown' = 'normal';
	failBackupWrite = false;
	markerRenameMode: 'normal' | 'throw-before' | 'commit-then-throw' = 'normal';
	canonicalProcessCalls = 0;

	async exists(path: string): Promise<boolean> { return this.files.has(path); }
	async read(path: string): Promise<string> {
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing file: ${path}`);
		return value;
	}
	async write(path: string, data: string): Promise<void> {
		if (this.failBackupWrite && path.includes('table-manifest-v2-') && !data.includes('"phase"')) {
			throw new Error('BACKUP_WRITE_FAILED');
		}
		this.writePaths.push(path);
		this.files.set(path, data);
	}
	async remove(path: string): Promise<void> { this.files.delete(path); }
	async rename(path: string, nextPath: string): Promise<void> {
		if (nextPath.endsWith('data.json.table-manifest-v2-recovery.json')) {
			if (this.markerRenameMode === 'throw-before') throw new Error('MARKER_WRITE_FAILED');
			const value = await this.read(path);
			this.files.set(nextPath, value);
			this.files.delete(path);
			if (this.markerRenameMode === 'commit-then-throw') throw new Error('MARKER_ACK_LOST');
			return;
		}
		const value = await this.read(path);
		this.files.set(nextPath, value);
		this.files.delete(path);
	}
	async process(path: string, change: (source: string) => string): Promise<string> {
		this.canonicalProcessCalls += 1;
		const current = await this.read(path);
		if (this.processMode === 'throw-before') throw new Error('WRITE_BEFORE');
		if (this.processMode === 'unknown') {
			this.files.set(path, JSON.stringify({ unexpected: true }));
			throw new Error('WRITE_UNKNOWN');
		}
		const next = change(current);
		if (this.processMode === 'partial-unknown') {
			const partial = JSON.parse(next);
			partial.taxonomy = { corrupted: true };
			this.files.set(path, JSON.stringify(partial));
			throw new Error('WRITE_PARTIAL_UNKNOWN');
		}
		this.files.set(path, next);
		if (this.processMode === 'commit-then-throw') throw new Error('ACK_LOST');
		return next;
	}
}

class RecoveryDiskAdapter {
	readonly mutations: Array<{ operation: 'write' | 'remove' | 'rename' | 'process'; path: string; nextPath?: string }> = [];
	constructor(private readonly root: string) {}
	private path(path: string): string { return `${this.root}/${path}`; }
	async exists(path: string): Promise<boolean> {
		try { await readFile(this.path(path)); return true; } catch { return false; }
	}
	async read(path: string): Promise<string> { return await readFile(this.path(path), 'utf8'); }
	async write(path: string, data: string): Promise<void> {
		this.mutations.push({ operation: 'write', path });
		const target = this.path(path);
		await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
		await writeFile(target, data, 'utf8');
	}
	async remove(path: string): Promise<void> {
		this.mutations.push({ operation: 'remove', path });
		await unlink(this.path(path));
	}
	async rename(path: string, nextPath: string): Promise<void> {
		this.mutations.push({ operation: 'rename', path, nextPath });
		const target = this.path(nextPath);
		await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
		await rename(this.path(path), target);
	}
	async process(path: string, change: (source: string) => string): Promise<string> {
		this.mutations.push({ operation: 'process', path });
		const next = change(await this.read(path));
		await writeFile(this.path(path), next, 'utf8');
		return next;
	}
}

function packageV2(ids = ['table-one'], bindings: Array<{ id: string; path: string }> = []) {
	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS) as unknown as Record<string, any>;
	dataPackage.views.tablePresets = {
		...dataPackage.views.tablePresets,
		version: 2,
		presetIds: ids,
		fileBindings: bindings,
		fileMigrationVersion: 1,
		fileMigrationFinalizedVersion: 1,
		unknownLegacyValue: { preserved: true },
		tableDefaultPresetId: ids[0] ?? null,
	};
	return dataPackage;
}

function loaded(id: string, path: string): TablePresetManifestRecoveryFileEvidence {
	return { path, status: 'loaded', presetId: id, claimedPresetId: id };
}

function buildLegacySidecarEvidence(
	dataPackage: Record<string, any>,
	options: { indexSource?: string | null; presetSources?: Record<string, string | null> } = {},
): TablePresetLegacySidecarEvidenceV1 {
	const manifest = dataPackage.views.tablePresets;
	const root = '.obsidian/plugins/operon/data/table-presets';
	const index = {
		version: 1,
		presetIds: [...manifest.presetIds],
		tableDefaultPresetId: manifest.tableDefaultPresetId,
		tableEmbedVisibleRows: manifest.tableEmbedVisibleRows,
		tableShowLineNumbers: manifest.tableShowLineNumbers,
		tableShowTaskIcon: manifest.tableShowTaskIcon,
		tableShowTaskTypeIcon: manifest.tableShowTaskTypeIcon,
	};
	return {
		index: {
			path: `${root}/index.json`,
			source: options.indexSource === undefined ? JSON.stringify(index) : options.indexSource,
		},
		presets: manifest.presetIds.map((id: string) => ({
			id,
			path: `${root}/${encodeURIComponent(id)}.json`,
			source: options.presetSources?.[id] === undefined
				? JSON.stringify({ version: 1, id, name: `Historical ${id}` })
				: options.presetSources[id],
		})),
	};
}

async function installLegacySidecars(
	adapter: RecoveryMemoryAdapter | RecoveryDiskAdapter,
	evidence: TablePresetLegacySidecarEvidenceV1,
): Promise<void> {
	await Promise.all([
		adapter.write(evidence.index.path, evidence.index.source ?? ''),
		...evidence.presets.map(preset => adapter.write(preset.path, preset.source ?? '')),
	]);
}

test('current v3 manifests require no migration', () => {
	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(dataPackage, []), {
		status: 'not-needed',
		reason: 'current',
	});
});

test('issue-shaped v2 manifests derive exact bindings from current Table files', () => {
	const dataPackage = packageV2();
	const result = preflightTablePresetManifestRecoveryV1(dataPackage, [loaded('table-one', 'Tables/One.table')]);
	assert.deepEqual(result, {
		status: 'recoverable',
		presetIds: ['table-one'],
		bindings: [{ id: 'table-one', path: 'Tables/One.table' }],
	});
	if (result.status !== 'recoverable') return;
	const recovered = buildRecoveredTablePresetDataPackageV1(dataPackage, result) as Record<string, any>;
	assert.equal(recovered.views.tablePresets.version, 3);
	assert.equal(recovered.views.tablePresets.initialized, true);
	assert.deepEqual(recovered.views.tablePresets.fileBindings, result.bindings);
	assert.deepEqual(recovered.views.tablePresets.unknownLegacyValue, { preserved: true });
	assert.equal('fileMigrationVersion' in recovered.views.tablePresets, false);
	assert.equal('fileMigrationFinalizedVersion' in recovered.views.tablePresets, false);
	assert.deepEqual(recovered.taxonomy, dataPackage.taxonomy);
	assert.deepEqual(recovered.integrations, dataPackage.integrations);
});

test('multiple presets retain declared order and case-normalized paths', () => {
	const dataPackage = packageV2(['table-two', 'table-one']);
	const result = preflightTablePresetManifestRecoveryV1(dataPackage, [
		loaded('table-one', 'Tables\\One.table'),
		loaded('table-two', 'Tables/Two.table'),
	]);
	assert.equal(result.status, 'recoverable');
	if (result.status !== 'recoverable') return;
	assert.deepEqual(result.bindings, [
		{ id: 'table-two', path: 'Tables/Two.table' },
		{ id: 'table-one', path: 'Tables/One.table' },
	]);
});

test('complete legacy bindings must match discovered paths exactly', () => {
	const dataPackage = packageV2(['table-one'], [{ id: 'table-one', path: 'Tables/One.table' }]);
	assert.equal(
		preflightTablePresetManifestRecoveryV1(dataPackage, [loaded('table-one', 'tables/ONE.table')]).status,
		'recoverable',
	);
	const mismatch = packageV2(['table-one'], [{ id: 'table-one', path: 'Tables/Other.table' }]);
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(mismatch, [loaded('table-one', 'Tables/One.table')]), {
		status: 'blocked',
		code: 'binding-path-mismatch',
	});
});

test('missing, invalid, and duplicate Table evidence fail closed', () => {
	const dataPackage = packageV2();
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(dataPackage, []), {
		status: 'blocked', code: 'table-file-missing',
	});
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(dataPackage, [{
		path: 'Tables/One.table', status: 'invalid', presetId: null, claimedPresetId: 'table-one',
	}]), { status: 'blocked', code: 'table-file-invalid' });
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(dataPackage, [
		{ ...loaded('table-one', 'Tables/One.table'), status: 'conflict' },
		{ ...loaded('table-one', 'Archive/One.table'), status: 'conflict' },
	]), { status: 'blocked', code: 'table-file-duplicate' });
});

test('partial bindings and ambiguous empty or embedded states fail closed', () => {
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(
		packageV2(['table-one', 'table-two'], [{ id: 'table-one', path: 'Tables/One.table' }]),
		[loaded('table-one', 'Tables/One.table'), loaded('table-two', 'Tables/Two.table')],
	), { status: 'blocked', code: 'binding-partial' });
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(packageV2([]), []), {
		status: 'blocked', code: 'preset-ids-empty',
	});
	const embedded = packageV2();
	embedded.views.tablePresets.tablePresets = [{ id: 'table-one' }];
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(embedded, [loaded('table-one', 'Tables/One.table')]), {
		status: 'blocked', code: 'embedded-legacy-presets',
	});
});

test('malformed, old, and future manifest versions remain unsupported', () => {
	for (const [version, code] of [[1, 'manifest-version-unsupported'], [4, 'manifest-version-future']] as const) {
		const dataPackage = packageV2();
		dataPackage.views.tablePresets.version = version;
		assert.deepEqual(preflightTablePresetManifestRecoveryV1(dataPackage, []), { status: 'blocked', code });
	}
	const malformed = packageV2();
	malformed.views.tablePresets.version = '2';
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(malformed, []), {
		status: 'blocked', code: 'manifest-malformed',
	});
});

test('missing or invalid v2 Table preferences fail closed instead of adopting defaults', () => {
	for (const mutate of [
		(manifest: Record<string, unknown>) => { delete manifest.tableDefaultPresetId; },
		(manifest: Record<string, unknown>) => { manifest.tableEmbedVisibleRows = 999; },
		(manifest: Record<string, unknown>) => { manifest.tableShowLineNumbers = 'true'; },
		(manifest: Record<string, unknown>) => { delete manifest.tableShowTaskIcon; },
		(manifest: Record<string, unknown>) => { manifest.tableShowTaskTypeIcon = null; },
	]) {
		const dataPackage = packageV2();
		mutate(dataPackage.views.tablePresets);
		assert.equal(preflightTablePresetManifestRecoveryV1(
			dataPackage,
			[loaded('table-one', 'Tables/One.table')],
		).status, 'blocked');
	}
});

test('exact historical V1 sidecars permit authority retirement without migrating preset bodies', () => {
	const source = packageV2(['table-one', 'table-two']);
	delete source.views.tablePresets.tableEmbedDefaultWidthPercent;
	source.ui.presetFavorites = {
		version: 1,
		table: ['table-two', 'unrelated-table'],
		calendar: ['calendar-keep'],
		kanban: ['kanban-keep'],
		filter: ['filter-keep'],
	};
	const evidence = buildLegacySidecarEvidence(source);
	const preflight = preflightLegacyTablePresetSidecarRetirementV1(source, evidence);
	assert.equal(preflight.status, 'recoverable');
	if (preflight.status !== 'recoverable') return;
	const candidate = buildRetiredLegacyTablePresetDataPackageV1(source, preflight) as Record<string, any>;
	assert.deepEqual(candidate.views.tablePresets, {
		version: 3,
		presetIds: [],
		fileBindings: [],
		initialized: false,
		tableDefaultPresetId: null,
		tableEmbedVisibleRows: source.views.tablePresets.tableEmbedVisibleRows,
		tableEmbedDefaultWidthPercent: 175,
		tableShowLineNumbers: source.views.tablePresets.tableShowLineNumbers,
		tableShowTaskIcon: source.views.tablePresets.tableShowTaskIcon,
		tableShowTaskTypeIcon: source.views.tablePresets.tableShowTaskTypeIcon,
		tableDefaultFolder: source.views.tablePresets.tableDefaultFolder,
	});
	assert.deepEqual(candidate.ui.presetFavorites.table, ['unrelated-table']);
	assert.deepEqual(candidate.ui.presetFavorites.calendar, ['calendar-keep']);
	assert.deepEqual(candidate.taxonomy, source.taxonomy);
	assert.equal('unknownLegacyValue' in candidate.views.tablePresets, false);
	assert.deepEqual(evidence, buildLegacySidecarEvidence(source));
});

test('legacy-sidecar authority retirement fails closed unless index and every sidecar exactly match', () => {
	const source = packageV2(['table-one', 'table-two']);
	const cases: Array<[string, TablePresetLegacySidecarEvidenceV1, string]> = [
		['missing index', buildLegacySidecarEvidence(source, { indexSource: null }), 'legacy-sidecar-index-missing'],
		['malformed index', buildLegacySidecarEvidence(source, { indexSource: '{' }), 'legacy-sidecar-index-invalid'],
		['index mismatch', buildLegacySidecarEvidence(source, {
			indexSource: JSON.stringify({ version: 1, presetIds: ['table-two', 'table-one'], tableDefaultPresetId: 'table-one', tableEmbedVisibleRows: 20, tableShowLineNumbers: true, tableShowTaskIcon: false, tableShowTaskTypeIcon: false }),
		}), 'legacy-sidecar-index-mismatch'],
		['missing sidecar', buildLegacySidecarEvidence(source, { presetSources: { 'table-one': null } }), 'legacy-sidecar-file-missing'],
		['invalid sidecar', buildLegacySidecarEvidence(source, { presetSources: { 'table-one': '{' } }), 'legacy-sidecar-file-invalid'],
		['wrong sidecar identity', buildLegacySidecarEvidence(source, { presetSources: { 'table-one': JSON.stringify({ version: 1, id: 'table-other' }) } }), 'legacy-sidecar-id-mismatch'],
	];
	for (const [_name, evidence, code] of cases) {
		assert.deepEqual(preflightLegacyTablePresetSidecarRetirementV1(source, evidence), { status: 'blocked', code });
	}
	const bound = packageV2(['table-one'], [{ id: 'table-one', path: 'Tables/One.table' }]);
	assert.deepEqual(preflightLegacyTablePresetSidecarRetirementV1(bound, buildLegacySidecarEvidence(bound)), {
		status: 'blocked', code: 'legacy-sidecar-bindings-nonempty',
	});
});

test('legacy-sidecar retirement requires a structurally complete package and an exact present Table folder', () => {
	for (const mutate of [
		(source: Record<string, any>) => { source.taxonomy.keyMappings = null; },
		(source: Record<string, any>) => { source.views.filters = null; },
		(source: Record<string, any>) => { source.ui.taskCreationProfile = null; },
		(source: Record<string, any>) => { source.automation.taskAutomationPolicy = null; },
		(source: Record<string, any>) => { source.integrations.externalCalendarSources = null; },
		(source: Record<string, any>) => { source.state.pinnedTasks = null; },
	] as const) {
		const source = packageV2();
		mutate(source);
		assert.deepEqual(preflightLegacyTablePresetSidecarRetirementV1(source, buildLegacySidecarEvidence(source)), {
			status: 'blocked', code: 'data-package-invalid',
		});
	}

	const missingFolder = packageV2();
	delete missingFolder.views.tablePresets.tableDefaultFolder;
	const recoverable = preflightLegacyTablePresetSidecarRetirementV1(
		missingFolder,
		buildLegacySidecarEvidence(missingFolder),
	);
	assert.equal(recoverable.status, 'recoverable');
	if (recoverable.status === 'recoverable') {
		const candidate = buildRetiredLegacyTablePresetDataPackageV1(missingFolder, recoverable) as Record<string, any>;
		assert.equal(Object.prototype.hasOwnProperty.call(candidate.views.tablePresets, 'tableDefaultFolder'), false);
		assert.equal(
			composeOperonSettingsFromDataPackage(candidate as OperonDataPackageV1, DEFAULT_SETTINGS).tableDefaultFolder,
			DEFAULT_SETTINGS.tableDefaultFolder,
		);
	}

	for (const malformedFolder of [' ../Tables', '../Tables', '/absolute', 'Tables/../Archive', 7] as const) {
		const source = packageV2();
		source.views.tablePresets.tableDefaultFolder = malformedFolder;
		assert.deepEqual(preflightLegacyTablePresetSidecarRetirementV1(source, buildLegacySidecarEvidence(source)), {
			status: 'blocked', code: 'manifest-malformed',
		}, String(malformedFolder));
	}
});

test('registry adoption selects the first canonical Table when retiring authority leaves no default', () => {
	assert.equal(resolveTablePresetDefaultAfterRegistrySync(null, ['table-b', 'table-a'], ['table-b', 'table-a']), 'table-b');
	assert.equal(resolveTablePresetDefaultAfterRegistrySync('table-a', ['table-b', 'table-a'], ['table-b', 'table-a']), 'table-a');
	assert.equal(resolveTablePresetDefaultAfterRegistrySync('retired-id', ['table-b'], ['table-b', 'table-a']), 'table-b');
	assert.equal(resolveTablePresetDefaultAfterRegistrySync(null, [], []), null);
});

test('canonical empty v3 Table authority stays empty until registry bootstrap', () => {
	const source = packageV2();
	const preflight = preflightLegacyTablePresetSidecarRetirementV1(source, buildLegacySidecarEvidence(source));
	assert.equal(preflight.status, 'recoverable');
	if (preflight.status !== 'recoverable') return;
	const retired = buildRetiredLegacyTablePresetDataPackageV1(source, preflight);
	const settings = composeOperonSettingsFromDataPackage(retired as OperonDataPackageV1, DEFAULT_SETTINGS);
	assert.deepEqual(settings.tablePresets, []);
	assert.deepEqual(settings.tablePresetOrderIds, []);
	assert.equal(settings.tablePresetFileInitialized, false);
	assert.equal(settings.tableDefaultPresetId, null);
	const roundTrip = buildOperonDataPackageFromSettings(settings);
	assert.deepEqual(roundTrip.views.tablePresets.presetIds, []);
	assert.deepEqual(roundTrip.views.tablePresets.fileBindings, []);
	assert.equal(roundTrip.views.tablePresets.initialized, false);
	assert.equal(roundTrip.views.tablePresets.tableDefaultPresetId, null);
});

test('Issue #162 registry startup adopts files without overwrite, seeds exactly once, and tolerates delayed discovery', async () => {
	const adoptedPreset = { ...createDefaultTablePreset(), id: 'tp_adopted', name: 'Adopted' };
	const adoptedSource = serializeOperonTableFile(adoptedPreset);
	const adoptedBindings: Array<{ id: string; path: string }> = [];
	const adoptedRegistry = new TablePresetRegistry({
		loadFileBindings: () => adoptedBindings.map(binding => ({ ...binding })),
		listTableFiles: () => [{ path: 'Tables/Adopted.table', source: adoptedSource }],
		readTableFile: descriptor => descriptor.source,
		applyPatch: (preset, patch) => ({ ...preset, ...patch, id: preset.id }),
	});
	await adoptedRegistry.refresh();
	for (const entry of adoptedRegistry.getSnapshot().entries.values()) {
		if (entry.status !== 'available' || entry.source.bound || !entry.source.path) continue;
		adoptedBindings.push({ id: entry.id, path: entry.source.path });
	}
	assert.deepEqual(adoptedBindings, [{ id: 'tp_adopted', path: 'Tables/Adopted.table' }]);
	assert.equal(resolveTablePresetBootstrapAction({
		initialized: false,
		registryEntryCount: adoptedRegistry.getSnapshot().entries.size,
		bindingCount: adoptedBindings.length,
	}), 'adopt-existing');
	assert.equal(
		resolveTablePresetDefaultAfterRegistrySync(null, ['tp_adopted'], ['tp_adopted']),
		'tp_adopted',
	);
	assert.equal(adoptedSource, serializeOperonTableFile(adoptedPreset), 'adoption must not overwrite an existing .table file');

	const seededFiles: Array<{ path: string; source: string }> = [];
	const seededRegistry = new TablePresetRegistry({
		loadFileBindings: () => [],
		listTableFiles: () => seededFiles,
		readTableFile: descriptor => descriptor.source,
		applyPatch: (preset, patch) => ({ ...preset, ...patch, id: preset.id }),
	});
	await seededRegistry.refresh();
	assert.equal(resolveTablePresetBootstrapAction({
		initialized: false,
		registryEntryCount: seededRegistry.getSnapshot().entries.size,
		bindingCount: 0,
	}), 'seed-default');
	const seededPreset = { ...createDefaultTablePreset(), name: 'Default table' };
	seededFiles.push({ path: 'Operon/Tables/Default table.table', source: serializeOperonTableFile(seededPreset) });
	await seededRegistry.refresh();
	assert.equal(seededFiles.length, 1);
	assert.equal(resolveTablePresetBootstrapAction({
		initialized: true,
		registryEntryCount: seededRegistry.getSnapshot().entries.size,
		bindingCount: 1,
	}), 'none');

	const latePreset = { ...createDefaultTablePreset(), id: 'tp_late', name: 'Late arrival' };
	const lateSource = serializeOperonTableFile(latePreset);
	let lateFiles: Array<{ path: string; source: string }> = [];
	const lateRegistry = new TablePresetRegistry({
		loadFileBindings: () => [{ id: 'tp_late', path: 'Tables/Late.table' }],
		listTableFiles: () => lateFiles,
		readTableFile: descriptor => descriptor.source,
		applyPatch: (preset, patch) => ({ ...preset, ...patch, id: preset.id }),
	});
	await lateRegistry.refresh();
	assert.equal(lateRegistry.get('tp_late')?.status, 'missing');
	assert.equal(resolveTablePresetBootstrapAction({ initialized: false, registryEntryCount: 1, bindingCount: 1 }), 'adopt-existing');
	lateFiles = [{ path: 'Tables/Late.table', source: lateSource }];
	await lateRegistry.refresh();
	assert.equal(lateRegistry.get('tp_late')?.status, 'available');
	assert.equal(lateRegistry.getPreset('tp_late')?.name, 'Late arrival');
	assert.equal(lateSource, serializeOperonTableFile(latePreset), 'late discovery must preserve the .table source');
});

test('Issue #162 retirement transaction preserves sidecars, cleans only Table authority, and is write-free on second startup', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	const source = packageV2(['table-one', 'table-two']);
	source.ui.presetFavorites = {
		version: 1,
		table: ['table-one', 'table-two', 'unrelated-table'],
		calendar: ['calendar-keep'], kanban: ['kanban-keep'], filter: ['filter-keep'],
	};
	const raw = JSON.stringify(source, null, '\t');
	const evidence = buildLegacySidecarEvidence(source);
	adapter.files.set(paths.dataPackagePath, raw);
	await installLegacySidecars(adapter, evidence);
	const originalSidecars = new Map<string, string>([
		[evidence.index.path, adapter.files.get(evidence.index.path)!],
		...evidence.presets.map((entry): [string, string] => [entry.path, adapter.files.get(entry.path)!]),
	]);
	const first = await new OperonDataPackageStore(adapter as never, paths, null, async () => [loaded('other-file', 'Tables/Other.table')])
		.initialize(DEFAULT_SETTINGS);
	assert.equal(first.unsupportedTablePresetPackage, false);
	assert.equal(first.tablePresetRecovery.status, 'recovered');
	assert.equal(first.tablePresetRecovery.strategy, 'retire-legacy-sidecar-authority');
	assert.equal(first.tablePresetRecovery.completedLegacySidecarRetirementThisStartup, true);
	assert.equal(adapter.files.get(first.tablePresetRecovery.backupPath!), raw);
	const marker = JSON.parse(adapter.files.get(paths.tableManifestV2RecoveryPath) ?? '{}');
	assert.equal(marker.version, 2);
	assert.equal(marker.strategy, 'retire-legacy-sidecar-authority');
	assert.equal(marker.phase, 'committed');
	const retired = JSON.parse(adapter.files.get(paths.dataPackagePath) ?? '{}');
	assert.deepEqual(retired.views.tablePresets.presetIds, []);
	assert.deepEqual(retired.views.tablePresets.fileBindings, []);
	assert.equal(retired.views.tablePresets.initialized, false);
	assert.equal(retired.views.tablePresets.tableDefaultPresetId, null);
	assert.deepEqual(retired.ui.presetFavorites.table, ['unrelated-table']);
	assert.deepEqual(retired.ui.presetFavorites.calendar, ['calendar-keep']);
	for (const [path, contents] of originalSidecars) assert.equal(adapter.files.get(path), contents, `sidecar changed: ${path}`);
	const canonicalProcessCalls = adapter.canonicalProcessCalls;
	adapter.writePaths.length = 0;
	const second = await new OperonDataPackageStore(adapter as never, paths, null, async () => {
		throw new Error('DISCOVERY_MUST_NOT_RUN_AFTER_RETIREMENT');
	}).initialize(DEFAULT_SETTINGS);
	assert.equal(second.tablePresetRecovery.status, 'recovered');
	assert.equal(second.tablePresetRecovery.strategy, 'retire-legacy-sidecar-authority');
	assert.equal(second.tablePresetRecovery.completedLegacySidecarRetirementThisStartup, false);
	assert.equal(adapter.canonicalProcessCalls, canonicalProcessCalls);
	assert.deepEqual(adapter.writePaths, []);
});

test('an incomplete nested domain blocks legacy-sidecar retirement before backup, marker, or canonical writes', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	const source = packageV2();
	source.integrations.externalCalendarSources = null;
	const raw = JSON.stringify(source, null, '\t');
	const evidence = buildLegacySidecarEvidence(source);
	adapter.files.set(paths.dataPackagePath, raw);
	await installLegacySidecars(adapter, evidence);
	adapter.canonicalProcessCalls = 0;
	adapter.writePaths.length = 0;

	const result = await new OperonDataPackageStore(adapter as never, paths, null, async () => [])
		.initialize(DEFAULT_SETTINGS);
	assert.equal(result.unsupportedTablePresetPackage, true);
	assert.equal(result.tablePresetRecovery.status, 'blocked');
	assert.equal(result.tablePresetRecovery.code, 'data-package-invalid');
	assert.equal(adapter.canonicalProcessCalls, 0);
	assert.deepEqual(adapter.writePaths, []);
	assert.equal(adapter.files.get(paths.dataPackagePath), raw);
	assert.equal(adapter.files.has(paths.tableManifestV2RecoveryPath), false);
});

test('Issue #162 prepared marker resumes once and acknowledgement loss finalizes without a second retirement write', async () => {
	for (const [mode, expectedCalls] of [['throw-before', 2], ['commit-then-throw', 1]] as const) {
		const adapter = new RecoveryMemoryAdapter();
		const paths = buildOperonStoragePaths('.obsidian');
		const source = packageV2();
		const evidence = buildLegacySidecarEvidence(source);
		adapter.files.set(paths.dataPackagePath, JSON.stringify(source, null, '\t'));
		await installLegacySidecars(adapter, evidence);
		adapter.processMode = mode;
		const first = await new OperonDataPackageStore(adapter as never, paths, null, async () => [])
			.initialize(DEFAULT_SETTINGS);
		if (mode === 'throw-before') {
			assert.equal(first.tablePresetRecovery.status, 'failed-clean');
			assert.equal(JSON.parse(adapter.files.get(paths.tableManifestV2RecoveryPath) ?? '{}').version, 2);
			adapter.processMode = 'normal';
			const resumed = await new OperonDataPackageStore(adapter as never, paths, null, async () => [])
				.initialize(DEFAULT_SETTINGS);
			assert.equal(resumed.tablePresetRecovery.status, 'recovered');
			assert.equal(resumed.tablePresetRecovery.strategy, 'retire-legacy-sidecar-authority');
			assert.equal(resumed.tablePresetRecovery.completedLegacySidecarRetirementThisStartup, true);
		} else {
			assert.equal(first.tablePresetRecovery.status, 'recovered');
			assert.equal(first.tablePresetRecovery.strategy, 'retire-legacy-sidecar-authority');
			assert.equal(first.tablePresetRecovery.completedLegacySidecarRetirementThisStartup, true);
		}
		assert.equal(adapter.canonicalProcessCalls, expectedCalls);
	}
});

test('non-exact legacy-sidecar states remain fatal and perform zero canonical writes', async () => {
	for (const [name, mutate] of [
		['missing-index', (source: Record<string, any>, evidence: TablePresetLegacySidecarEvidenceV1) => {
			evidence.index.source = null;
		}],
		['mismatched-index', (source: Record<string, any>, evidence: TablePresetLegacySidecarEvidenceV1) => {
			evidence.index.source = JSON.stringify({ version: 1, presetIds: ['other'], tableDefaultPresetId: null, tableEmbedVisibleRows: 20, tableShowLineNumbers: true, tableShowTaskIcon: false, tableShowTaskTypeIcon: false });
		}],
		['partial-binding', (source: Record<string, any>) => {
			source.views.tablePresets.presetIds = ['table-one', 'table-two'];
			source.views.tablePresets.fileBindings = [{ id: 'table-one', path: 'Tables/One.table' }];
		}],
		['embedded-authority', (source: Record<string, any>) => {
			source.views.tablePresets.tablePresets = [{ id: 'table-one' }];
		}],
		['future-manifest', (source: Record<string, any>) => {
			source.views.tablePresets.version = 4;
		}],
	] as const) {
		const adapter = new RecoveryMemoryAdapter();
		const paths = buildOperonStoragePaths('.obsidian');
		const source = packageV2();
		const evidence = buildLegacySidecarEvidence(source);
		mutate(source, evidence);
		const raw = JSON.stringify(source, null, '\t');
		adapter.files.set(paths.dataPackagePath, raw);
		await installLegacySidecars(adapter, evidence);
		adapter.canonicalProcessCalls = 0;
		const result = await new OperonDataPackageStore(adapter as never, paths, null, async () => [])
			.initialize(DEFAULT_SETTINGS);
		assert.equal(result.unsupportedTablePresetPackage, true, name);
		assert.equal(result.tablePresetRecovery.status, 'blocked', name);
		assert.equal(adapter.canonicalProcessCalls, 0, name);
		assert.equal(adapter.files.get(paths.dataPackagePath), raw, name);
	}
});

test('historical Issue #162 fixture runs only against a disposable disk vault and leaves retired sidecars byte-for-byte intact', async () => {
	const root = await mkdtemp(resolve(tmpdir(), 'operon-table-sidecar-retirement-'));
	try {
		const adapter = new RecoveryDiskAdapter(root);
		const paths = buildOperonStoragePaths('.obsidian');
		const source = packageV2(['table-one']);
		const raw = JSON.stringify(source, null, '\t');
		const evidence = buildLegacySidecarEvidence(source);
		await adapter.write(paths.dataPackagePath, raw);
		await installLegacySidecars(adapter, evidence);
		const beforeIndex = await adapter.read(evidence.index.path);
		const beforePreset = await adapter.read(evidence.presets[0]!.path);
		adapter.mutations.length = 0;
		const result = await new OperonDataPackageStore(adapter as never, paths, null, async () => [])
			.initialize(DEFAULT_SETTINGS);
		assert.equal(result.tablePresetRecovery.strategy, 'retire-legacy-sidecar-authority');
		assert.equal(await adapter.read(evidence.index.path), beforeIndex);
		assert.equal(await adapter.read(evidence.presets[0]!.path), beforePreset);
		assert.equal(adapter.mutations.some(mutation => mutation.path === evidence.index.path || mutation.path === evidence.presets[0]!.path), false);
		assert.equal(JSON.parse(await adapter.read(paths.dataPackagePath)).views.tablePresets.version, 3);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('startup transaction writes exact backup, committed marker, and an idempotent v3 candidate', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	const source = packageV2();
	source.settings.calendarSidebarTaskPoolFollowPresetFilter = false;
	source.settings.unknownRecoverySetting = { preserved: true };
	const raw = JSON.stringify(source, null, '\t');
	adapter.files.set(paths.dataPackagePath, raw);
	const discovery = async () => [loaded('table-one', 'Tables/One.table')];
	const first = new OperonDataPackageStore(adapter as never, paths, null, discovery);
	const initialized = await first.initialize(DEFAULT_SETTINGS);
	assert.equal(initialized.unsupportedTablePresetPackage, false);
	assert.equal(initialized.tablePresetRecovery.status, 'recovered');
	assert.ok(initialized.tablePresetRecovery.backupPath);
	assert.equal(adapter.files.get(initialized.tablePresetRecovery.backupPath!), raw);
	assert.equal(JSON.parse(adapter.files.get(paths.tableManifestV2RecoveryPath) ?? '{}').phase, 'committed');
	const canonicalManifest = JSON.parse(adapter.files.get(paths.dataPackagePath) ?? '{}').views.tablePresets;
	assert.equal(canonicalManifest.version, 3);
	assert.equal('fileMigrationVersion' in canonicalManifest, false);
	assert.equal('fileMigrationFinalizedVersion' in canonicalManifest, false);
	const canonicalPackage = JSON.parse(adapter.files.get(paths.dataPackagePath) ?? '{}');
	assert.equal('calendarSidebarTaskPoolFollowPresetFilter' in canonicalPackage.settings, false);
	assert.deepEqual(canonicalPackage.settings.unknownRecoverySetting, { preserved: true });
	assert.equal(adapter.canonicalProcessCalls, 2);

	const evolved = JSON.parse(adapter.files.get(paths.dataPackagePath) ?? '{}');
	evolved.views.tablePresets.presetIds = ['table-one', 'table-later'];
	evolved.views.tablePresets.fileBindings = [
		{ id: 'table-one', path: 'Tables/One.table' },
		{ id: 'table-later', path: 'Tables/Later.table' },
	];
	adapter.files.set(paths.dataPackagePath, JSON.stringify(evolved, null, '\t'));
	adapter.writePaths.length = 0;
	const second = new OperonDataPackageStore(adapter as never, paths, null, discovery);
	const reloaded = await second.initialize(DEFAULT_SETTINGS);
	assert.equal(reloaded.tablePresetRecovery.status, 'recovered');
	assert.equal(adapter.canonicalProcessCalls, 2);
	assert.deepEqual(adapter.writePaths, []);
});

test('failed-clean canonical acknowledgement is not replayed and restart resumes from the prepared marker', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	const raw = JSON.stringify(packageV2(), null, '\t');
	adapter.files.set(paths.dataPackagePath, raw);
	adapter.processMode = 'throw-before';
	const discovery = async () => [loaded('table-one', 'Tables/One.table')];
	const failedStore = new OperonDataPackageStore(adapter as never, paths, null, discovery);
	const failed = await failedStore.initialize(DEFAULT_SETTINGS);
	assert.equal(failed.tablePresetRecovery.status, 'failed-clean');
	assert.equal(failed.unsupportedTablePresetPackage, true);
	assert.equal(failedStore.canPersist(), false);
	assert.equal(adapter.files.get(paths.dataPackagePath), raw);
	assert.equal(adapter.canonicalProcessCalls, 1);
	assert.equal(JSON.parse(adapter.files.get(paths.tableManifestV2RecoveryPath) ?? '{}').phase, 'prepared');

	adapter.processMode = 'normal';
	const resumed = await new OperonDataPackageStore(adapter as never, paths, null, discovery).initialize(DEFAULT_SETTINGS);
	assert.equal(resumed.tablePresetRecovery.status, 'recovered');
	assert.equal(adapter.canonicalProcessCalls, 2);
	assert.equal(JSON.parse(adapter.files.get(paths.tableManifestV2RecoveryPath) ?? '{}').phase, 'committed');
});

test('previously supported v2 bindings remain read-only and do not enter recovery discovery', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	const raw = JSON.stringify(packageV2(['table-one'], [{ id: 'table-one', path: 'Tables/One.table' }]), null, '\t');
	adapter.files.set(paths.dataPackagePath, raw);
	let discoveryCalls = 0;
	const store = new OperonDataPackageStore(adapter as never, paths, null, async () => {
		discoveryCalls += 1;
		throw new Error('DISCOVERY_MUST_NOT_RUN');
	});
	const result = await store.initialize(DEFAULT_SETTINGS);
	assert.equal(result.tablePresetRecovery.status, 'not-needed');
	assert.equal(result.unsupportedTablePresetPackage, false);
	assert.equal(discoveryCalls, 0);
	assert.equal(adapter.canonicalProcessCalls, 0);
	assert.equal(adapter.files.get(paths.dataPackagePath), raw);
});

test('future Developer API authority blocks Table migration before discovery or storage writes', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	const dataPackage = packageV2();
	dataPackage.integrations.developerApi = { version: 2, consumersById: {} };
	const raw = JSON.stringify(dataPackage, null, '\t');
	adapter.files.set(paths.dataPackagePath, raw);
	let discoveryCalls = 0;
	const store = new OperonDataPackageStore(adapter as never, paths, null, async () => {
		discoveryCalls += 1;
		return [loaded('table-one', 'Tables/One.table')];
	});
	const result = await store.initialize(DEFAULT_SETTINGS);
	assert.equal(result.tablePresetRecovery.status, 'not-needed');
	assert.equal(discoveryCalls, 0);
	assert.equal(adapter.canonicalProcessCalls, 0);
	assert.equal(adapter.files.get(paths.dataPackagePath), raw);
	assert.equal(store.canPersist(), false);
	assert.equal(adapter.files.has(paths.tableManifestV2RecoveryPath), false);
});

test('acknowledgement loss accepts an observed candidate without replay while unknown state suspends writes', async () => {
	for (const [mode, expectedStatus, expectedUnsupported] of [
		['commit-then-throw', 'recovered', false],
		['unknown', 'commit-state-unknown', true],
	] as const) {
		const adapter = new RecoveryMemoryAdapter();
		const paths = buildOperonStoragePaths('.obsidian');
		adapter.files.set(paths.dataPackagePath, JSON.stringify(packageV2(), null, '\t'));
		adapter.processMode = mode;
		const store = new OperonDataPackageStore(
			adapter as never,
			paths,
			null,
			async () => [loaded('table-one', 'Tables/One.table')],
		);
		const result = await store.initialize(DEFAULT_SETTINGS);
		assert.equal(result.tablePresetRecovery.status, expectedStatus);
		assert.equal(result.unsupportedTablePresetPackage, expectedUnsupported);
		assert.equal(adapter.canonicalProcessCalls, 1);
		assert.equal(store.canPersist(), mode !== 'unknown');
	}
});

test('restart refuses a partial candidate that preserved only the recovered Table authority', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	adapter.files.set(paths.dataPackagePath, JSON.stringify(packageV2(), null, '\t'));
	adapter.processMode = 'partial-unknown';
	const discover = async () => [loaded('table-one', 'Tables/One.table')];
	const firstStore = new OperonDataPackageStore(adapter as never, paths, null, discover);
	const first = await firstStore.initialize(DEFAULT_SETTINGS);
	assert.equal(first.tablePresetRecovery.status, 'commit-state-unknown');
	assert.equal(firstStore.canPersist(), false);
	adapter.processMode = 'normal';
	const restarted = new OperonDataPackageStore(adapter as never, paths, null, discover);
	const second = await restarted.initialize(DEFAULT_SETTINGS);
	assert.equal(second.tablePresetRecovery.status, 'commit-state-unknown');
	assert.equal(adapter.canonicalProcessCalls, 1);
	assert.equal(restarted.canPersist(), false);
});

test('backup and marker failures leave canonical data untouched and never dispatch the migration write', async () => {
	for (const failure of ['backup', 'marker-before'] as const) {
		const adapter = new RecoveryMemoryAdapter();
		const paths = buildOperonStoragePaths('.obsidian');
		const raw = JSON.stringify(packageV2(), null, '\t');
		adapter.files.set(paths.dataPackagePath, raw);
		adapter.failBackupWrite = failure === 'backup';
		adapter.markerRenameMode = failure === 'marker-before' ? 'throw-before' : 'normal';
		const result = await new OperonDataPackageStore(
			adapter as never, paths, null, async () => [loaded('table-one', 'Tables/One.table')],
		).initialize(DEFAULT_SETTINGS);
		assert.equal(result.tablePresetRecovery.code, failure === 'backup' ? 'backup-failed' : 'marker-write-failed');
		assert.equal(adapter.files.get(paths.dataPackagePath), raw);
		assert.equal(adapter.canonicalProcessCalls, 0);
		assert.equal(adapter.files.has(paths.tableManifestV2RecoveryPath), false);
	}
});

test('an exact marker committed before acknowledgement loss is observed and not replayed', async () => {
	const adapter = new RecoveryMemoryAdapter();
	const paths = buildOperonStoragePaths('.obsidian');
	adapter.files.set(paths.dataPackagePath, JSON.stringify(packageV2(), null, '\t'));
	adapter.markerRenameMode = 'commit-then-throw';
	const result = await new OperonDataPackageStore(
		adapter as never, paths, null, async () => [loaded('table-one', 'Tables/One.table')],
	).initialize(DEFAULT_SETTINGS);
	assert.equal(result.tablePresetRecovery.status, 'recovered');
	assert.equal(adapter.canonicalProcessCalls, 1);
	assert.equal(JSON.parse(adapter.files.get(paths.tableManifestV2RecoveryPath) ?? '{}').phase, 'committed');
});

test('invalid or divergent prepared recovery state suspends writes without replay', async () => {
	const paths = buildOperonStoragePaths('.obsidian');
	const invalid = new RecoveryMemoryAdapter();
	invalid.files.set(paths.dataPackagePath, JSON.stringify(packageV2(), null, '\t'));
	invalid.files.set(paths.tableManifestV2RecoveryPath, '{"version":99}');
	const invalidStore = new OperonDataPackageStore(invalid as never, paths, null, async () => []);
	const invalidResult = await invalidStore.initialize(DEFAULT_SETTINGS);
	assert.equal(invalidResult.tablePresetRecovery.code, 'marker-invalid');
	assert.equal(invalid.canonicalProcessCalls, 0);
	assert.equal(invalidStore.canPersist(), false);

	const divergent = new RecoveryMemoryAdapter();
	const original = JSON.stringify(packageV2(), null, '\t');
	divergent.files.set(paths.dataPackagePath, original);
	divergent.processMode = 'throw-before';
	await new OperonDataPackageStore(
		divergent as never, paths, null, async () => [loaded('table-one', 'Tables/One.table')],
	).initialize(DEFAULT_SETTINGS);
	divergent.files.set(paths.dataPackagePath, JSON.stringify({ ...packageV2(), unrelatedDrift: true }, null, '\t'));
	divergent.processMode = 'normal';
	const divergentStore = new OperonDataPackageStore(
		divergent as never, paths, null, async () => [loaded('table-one', 'Tables/One.table')],
	);
	const divergentResult = await divergentStore.initialize(DEFAULT_SETTINGS);
	assert.equal(divergentResult.tablePresetRecovery.status, 'commit-state-unknown');
	assert.equal(divergent.canonicalProcessCalls, 1);
	assert.equal(divergentStore.canPersist(), false);
});

test('sealed 2.6.0 private-tmp fixture migrates once, preserves bytes, and restores the source snapshot', async () => {
	const root = await mkdtemp(resolve(tmpdir(), 'operon-table-v2-recovery-'));
	try {
		const adapter = new RecoveryDiskAdapter(root);
		const paths = buildOperonStoragePaths('.obsidian');
		const fixtureRoot = resolve(
			process.cwd(),
			'scripts/fixtures/table-manifest-v2-recovery/2.6.0-issue-state',
		);
		const fixtureManifest = JSON.parse(await readFile(`${fixtureRoot}/fixture-manifest.json`, 'utf8'));
		const source = await readFile(`${fixtureRoot}/source-v2.json`, 'utf8');
		const expectedCandidate = await readFile(`${fixtureRoot}/expected-migration-candidate.json`, 'utf8');
		const expectedFinal = await readFile(`${fixtureRoot}/expected-final-v3.json`, 'utf8');
		const tableSource = await readFile(`${fixtureRoot}/Default.table`, 'utf8');
		const sourceHash = fixtureManifest.files['source-v2.json'].sha256;
		const presetId = fixtureManifest.presetId;
		const tablePath = fixtureManifest.tablePath;
		assert.equal(fixtureManifest.fixtureKind, 'synthetic-issue-shaped-reproduction');
		assert.equal(fixtureManifest.sourceRelease, '2.6.0');
		assert.equal(fixtureManifest.sourceCommit, '66308fe992890373765d50d17aeed1a8bc32b227');
		assert.equal(sha256(source), sourceHash);
		assert.equal(Buffer.byteLength(source), fixtureManifest.files['source-v2.json'].bytes);
		assert.equal(sha256(tableSource), fixtureManifest.files['Default.table'].sha256);
		assert.equal(Buffer.byteLength(tableSource), fixtureManifest.files['Default.table'].bytes);
		assert.equal(sha256(expectedCandidate), fixtureManifest.files['expected-migration-candidate.json'].sha256);
		assert.equal(Buffer.byteLength(expectedCandidate), fixtureManifest.files['expected-migration-candidate.json'].bytes);
		assert.equal(sha256(expectedFinal), fixtureManifest.files['expected-final-v3.json'].sha256);
		assert.equal(Buffer.byteLength(expectedFinal), fixtureManifest.files['expected-final-v3.json'].bytes);
		const discovery = await discoverOperonTableFiles([{ path: tablePath }], async () => tableSource);
		const evidence = discovery.files.map(file => ({
			path: file.path,
			status: file.status,
			presetId: file.preset?.id ?? null,
			claimedPresetId: readLooseTablePresetIdV1(tableSource),
		}));
		const preflight = preflightTablePresetManifestRecoveryV1(JSON.parse(source), evidence);
		assert.equal(preflight.status, 'recoverable');
		if (preflight.status !== 'recoverable') return;
		const projected = `${JSON.stringify(buildRecoveredTablePresetDataPackageV1(JSON.parse(source), preflight), null, 2)}\n`;
		assert.equal(projected, expectedCandidate);
		await adapter.write(paths.dataPackagePath, source);
		await adapter.write(tablePath, tableSource);
		adapter.mutations.length = 0;
		const discover = async () => evidence;
		const first = await new OperonDataPackageStore(adapter as never, paths, null, discover).initialize(DEFAULT_SETTINGS);
		assert.equal(first.tablePresetRecovery.status, 'recovered');
		assert.equal(await adapter.read(first.tablePresetRecovery.backupPath!), source);
		assert.equal(await adapter.read(tablePath), tableSource);
		const candidate = await adapter.read(paths.dataPackagePath);
		assert.notEqual(sha256(candidate), sourceHash);
		assert.equal(candidate, expectedFinal);
		const parsedCandidate = JSON.parse(candidate);
		assert.equal(parsedCandidate.views.tablePresets.version, 3);
		assert.deepEqual(parsedCandidate.views.tablePresets.presetIds, [presetId]);
		assert.deepEqual(parsedCandidate.views.tablePresets.fileBindings, [{ id: presetId, path: tablePath }]);
		assert.equal(parsedCandidate.views.tablePresets.initialized, true);
		const allowedDurableWrites = new Set<string>(fixtureManifest.allowedDurableWrites.map((path: string) => (
			path.replace('<source-sha256>', sourceHash)
		)));
		for (const mutation of adapter.mutations) {
			for (const path of [mutation.path, mutation.nextPath].filter((value): value is string => Boolean(value))) {
				assert.notEqual(path, tablePath, `Migration must not mutate ${tablePath}.`);
				if (!path.includes('.tmp-')) assert.equal(allowedDurableWrites.has(path), true, `Unexpected durable mutation: ${path}`);
			}
		}
		adapter.mutations.length = 0;
		const second = await new OperonDataPackageStore(adapter as never, paths, null, discover).initialize(DEFAULT_SETTINGS);
		assert.equal(second.tablePresetRecovery.status, 'recovered');
		assert.equal(await adapter.read(paths.dataPackagePath), expectedFinal);
		assert.deepEqual(adapter.mutations, []);
		assert.deepEqual(await listRelativeFiles(root), [
			'.obsidian/plugins/operon/data.json',
			`.obsidian/plugins/operon/data.json.table-manifest-v2-${sourceHash}.bak`,
			'.obsidian/plugins/operon/data.json.table-manifest-v2-recovery.json',
			'Tables/Default.table',
		]);
		await adapter.write(paths.dataPackagePath, await adapter.read(first.tablePresetRecovery.backupPath!));
		assert.equal(sha256(await adapter.read(paths.dataPackagePath)), sourceHash);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function sha256(source: string): string {
	return createHash('sha256').update(source).digest('hex');
}

async function listRelativeFiles(root: string, relative = ''): Promise<string[]> {
	const directory = relative ? `${root}/${relative}` : root;
	const entries = await readdir(directory);
	const files: string[] = [];
	for (const entry of entries) {
		const next = relative ? `${relative}/${entry}` : entry;
		if ((await stat(`${root}/${next}`)).isDirectory()) files.push(...await listRelativeFiles(root, next));
		else files.push(next);
	}
	return files.sort();
}
