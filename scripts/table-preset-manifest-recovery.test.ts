import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	buildOperonDataPackageFromSettings,
	type OperonDataPackageV1,
} from '../src/storage/operon-data-package';
import { OperonDataPackageStore } from '../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { buildTablePresetAuthorityDataPackage } from '../src/storage/table-preset-authority-package';
import {
	buildRecoveredTablePresetDataPackageV1,
	preflightTablePresetManifestRecoveryV1,
} from '../src/storage/table-preset-manifest-recovery';
import {
	reconcileTablePresetFileAuthority,
	resolveTablePresetBootstrapAction,
} from '../src/storage/table-preset-manifest';
import { discoverOperonTableFiles, serializeOperonTableFile } from '../src/storage/table-file';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { createDefaultTablePreset } from '../src/types/table';

class MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly readPaths: string[] = [];
	processCalls = 0;
	processChangedWrites = 0;

	async exists(path: string): Promise<boolean> { return this.files.has(path); }
	async read(path: string): Promise<string> {
		this.readPaths.push(path);
		const value = this.files.get(path);
		if (value === undefined) throw new Error(`Missing file: ${path}`);
		return value;
	}
	async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
	async remove(path: string): Promise<void> { this.files.delete(path); }
	async rename(oldPath: string, newPath: string): Promise<void> {
		const source = await this.read(oldPath);
		this.files.set(newPath, source);
		this.files.delete(oldPath);
	}
	async process(path: string, callback: (source: string) => string): Promise<void> {
		this.processCalls += 1;
		const source = await this.read(path);
		const candidate = callback(source);
		if (candidate !== source) this.processChangedWrites += 1;
		this.files.set(path, candidate);
	}
}

test('current v4 Table manifests require no recovery', () => {
	const current = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(current, []), {
		status: 'not-needed',
		reason: 'current',
	});
});

test('legacy embedded Settings presets are rejected without a conversion path', () => {
	const source = legacyManifestPackage();
	(source.settings as unknown as Record<string, unknown>).tablePresets = [{ id: 'settings-only' }];
	assert.deepEqual(preflightTablePresetManifestRecoveryV1(source, []), {
		status: 'blocked',
		code: 'embedded-legacy-presets',
	});
});

test('v2 manifests recover bindings only from existing usable .table files', () => {
	const source = legacyManifestPackage();
	const evidence = [{
		path: 'Tables/One.table',
		status: 'loaded' as const,
		presetId: 'table-one',
		claimedPresetId: 'table-one',
	}];
	const preflight = preflightTablePresetManifestRecoveryV1(source, evidence);
	assert.equal(preflight.status, 'recoverable');
	if (preflight.status !== 'recoverable') return;
	assert.deepEqual(preflight.bindings, [{ id: 'table-one', path: 'Tables/One.table' }]);
	const candidate = buildRecoveredTablePresetDataPackageV1(source, preflight);
	assert.deepEqual(candidate.views.tablePresets.presetIds, ['table-one']);
	assert.deepEqual(candidate.views.tablePresets.fileBindings, [{ id: 'table-one', path: 'Tables/One.table' }]);
});

test('canonical authority silently drops missing and settings-only ids', () => {
	const authority = reconcileTablePresetFileAuthority({
		currentPresetIds: ['missing', 'table-b', 'settings-only', 'table-a'],
		currentDefaultPresetId: 'missing',
		currentInitialized: true,
		availableFiles: [
			{ id: 'table-c', path: 'Tables/Zulu.table' },
			{ id: 'table-a', path: 'Tables/Alpha.table' },
			{ id: 'table-b', path: 'Tables/Beta.table' },
		],
	});
	assert.deepEqual(authority, {
		presetIds: ['table-b', 'table-a', 'table-c'],
		fileBindings: [
			{ id: 'table-b', path: 'Tables/Beta.table' },
			{ id: 'table-a', path: 'Tables/Alpha.table' },
			{ id: 'table-c', path: 'Tables/Zulu.table' },
		],
		tableDefaultPresetId: 'table-b',
		initialized: true,
	});
	assert.deepEqual(reconcileTablePresetFileAuthority({
		currentPresetIds: authority.presetIds,
		currentDefaultPresetId: authority.tableDefaultPresetId,
		currentInitialized: authority.initialized,
		availableFiles: [
			{ id: 'table-b', path: 'Tables/Beta.table' },
			{ id: 'table-c', path: 'Tables/Zulu.table' },
			{ id: 'table-a', path: 'Tables/Alpha.table' },
		],
	}), authority, 'second reconciliation must be semantically idempotent');
});

test('only a genuinely fresh empty Table authority selects default bootstrap', () => {
	const freshAuthority = reconcileTablePresetFileAuthority({
		currentPresetIds: ['settings-only'],
		currentDefaultPresetId: 'settings-only',
		currentInitialized: false,
		availableFiles: [],
	});
	assert.deepEqual(freshAuthority, {
		presetIds: [],
		fileBindings: [],
		tableDefaultPresetId: null,
		initialized: false,
	});
	assert.equal(resolveTablePresetBootstrapAction({
		initialized: freshAuthority.initialized,
		registryEntryCount: 0,
		bindingCount: freshAuthority.fileBindings.length,
	}), 'seed-default');

	const previouslyInitializedAuthority = reconcileTablePresetFileAuthority({
		currentPresetIds: ['deleted-table'],
		currentDefaultPresetId: 'deleted-table',
		currentInitialized: true,
		availableFiles: [],
	});
	assert.deepEqual(previouslyInitializedAuthority, {
		presetIds: [],
		fileBindings: [],
		tableDefaultPresetId: null,
		initialized: true,
	});
	assert.equal(resolveTablePresetBootstrapAction({
		initialized: previouslyInitializedAuthority.initialized,
		registryEntryCount: 0,
		bindingCount: previouslyInitializedAuthority.fileBindings.length,
	}), 'none', 'external deletion or a transient move gap must not recreate the default Table');
});

test('disposable vault discovery adopts valid external files and isolates invalid or duplicate ids', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'operon-table-authority-'));
	try {
		const alpha = { ...createDefaultTablePreset(), id: 'table-alpha', name: 'Alpha' };
		const duplicate = { ...createDefaultTablePreset(), id: 'table-duplicate', name: 'Duplicate' };
		const fixtures = [
			{ path: 'Tables/Alpha.table', source: serializeOperonTableFile(alpha) },
			{ path: 'Tables/Duplicate A.table', source: serializeOperonTableFile(duplicate) },
			{ path: 'Tables/Duplicate B.table', source: serializeOperonTableFile({ ...duplicate, name: 'Duplicate B' }) },
			{ path: 'Tables/Invalid.table', source: '{"version":3,"id":"broken"}' },
		];
		for (const fixture of fixtures) await writeFile(path.join(root, fixture.path.split('/').join('-')), fixture.source);
		const discovery = await discoverOperonTableFiles(
			fixtures.map(fixture => ({ path: fixture.path })),
			descriptor => readFile(path.join(root, descriptor.path.split('/').join('-')), 'utf8'),
		);
		const authority = reconcileTablePresetFileAuthority({
			currentPresetIds: ['stale-binding'],
			currentDefaultPresetId: 'stale-binding',
			currentInitialized: true,
			availableFiles: discovery.files.flatMap(file => file.status === 'loaded' && file.preset
				? [{ id: file.preset.id, path: file.path }]
				: []),
		});
		assert.deepEqual(authority.presetIds, ['table-alpha']);
		assert.deepEqual(authority.fileBindings, [{ id: 'table-alpha', path: 'Tables/Alpha.table' }]);
		assert.equal(discovery.diagnostics.some(entry => entry.code === 'duplicate-id'), true);
		assert.equal(discovery.diagnostics.some(entry => entry.path === 'Tables/Invalid.table'), true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('canonical package cleanup removes embedded Table residue and stale favorites idempotently', () => {
	const source = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	const rootSettings = source.settings as unknown as Record<string, unknown>;
	rootSettings.tablePresets = [{ id: 'settings-only' }];
	rootSettings.tablePresetOrderIds = ['settings-only'];
	rootSettings.tablePresetFileBindings = [{ id: 'missing', path: 'Tables/Missing.table' }];
	rootSettings.tableDefaultPresetId = 'settings-only';
	source.ui.presetFavorites = {
		version: 1,
		table: ['settings-only', 'table-valid'],
		calendar: ['calendar-one'],
		kanban: ['kanban-one'],
		filter: ['filter-one'],
	};
	const authority = reconcileTablePresetFileAuthority({
		currentPresetIds: ['settings-only', 'table-valid'],
		currentDefaultPresetId: 'settings-only',
		currentInitialized: true,
		availableFiles: [{ id: 'table-valid', path: 'Tables/Valid.table' }],
	});
	const favorites = {
		table: ['table-valid'],
		calendar: ['calendar-one'],
		kanban: ['kanban-one'],
		filter: ['filter-one'],
	};
	const candidate = buildTablePresetAuthorityDataPackage(source, authority, DEFAULT_SETTINGS, favorites);
	for (const key of ['tablePresets', 'tablePresetOrderIds', 'tablePresetFileBindings', 'tableDefaultPresetId']) {
		assert.equal(Object.prototype.hasOwnProperty.call(candidate.settings, key), false, `${key} must be removed from root Settings`);
	}
	assert.deepEqual(candidate.views.tablePresets.presetIds, ['table-valid']);
	assert.deepEqual(candidate.views.tablePresets.fileBindings, [{ id: 'table-valid', path: 'Tables/Valid.table' }]);
	assert.equal(candidate.views.tablePresets.tableDefaultPresetId, 'table-valid');
	assert.deepEqual(candidate.ui.presetFavorites, { version: 1, ...favorites });
	assert.deepEqual(
		buildTablePresetAuthorityDataPackage(candidate, authority, DEFAULT_SETTINGS, favorites),
		candidate,
		'second startup must produce the same canonical package',
	);
});

test('obsolete sidecar markers are ignored without reading sidecars or changing canonical data', async () => {
	const paths = buildOperonStoragePaths('.obsidian');
	const adapter = new MemoryAdapter();
	const source = legacyManifestPackage();
	const raw = JSON.stringify(source, null, '\t');
	adapter.files.set(paths.dataPackagePath, raw);
	adapter.files.set(paths.tableManifestV2RecoveryPath, JSON.stringify({
		version: 2,
		strategy: 'retire-legacy-sidecar-authority',
		phase: 'prepared',
		sourceSha256: 'a'.repeat(64),
		candidateSha256: 'b'.repeat(64),
		backupPath: 'obsolete-backup.json',
		legacySidecars: {
			index: { path: 'data/table-presets/index.json', sha256: 'c'.repeat(64) },
			presets: [],
		},
	}));
	const result = await new OperonDataPackageStore(
		adapter as never,
		paths,
		null,
		async () => [],
	).initialize(DEFAULT_SETTINGS);
	assert.equal(result.tablePresetRecovery.code, 'marker-invalid');
	assert.equal(adapter.files.get(paths.dataPackagePath), raw);
	assert.equal(adapter.readPaths.some(path => path.includes('/data/table-presets/')), false);
});

test('canonical CAS is write-free for an identical candidate and rejects external drift', async () => {
	const paths = buildOperonStoragePaths('.obsidian');
	const adapter = new MemoryAdapter();
	const source = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	const raw = JSON.stringify(source, null, '\t');
	adapter.files.set(paths.dataPackagePath, raw);
	const store = new OperonDataPackageStore(adapter as never, paths, null, async () => []);
	await store.initialize(DEFAULT_SETTINGS);
	await store.updateDataPackageCas(current => current);
	assert.equal(adapter.processChangedWrites, 0);
	assert.equal(adapter.files.get(paths.dataPackagePath), raw);
	adapter.files.set(paths.dataPackagePath, JSON.stringify({ ...source, externalDrift: true }, null, '\t'));
	await assert.rejects(
		store.updateDataPackageCas(current => current),
		/Canonical data package changed before the degraded settings save/u,
	);
});

test('Table Settings exposes healthy controls without a domain-wide read-only gate', async () => {
	const [mainSource, settingsSource] = await Promise.all([
		readFile(path.resolve('main.ts'), 'utf8'),
		readFile(path.resolve('src/ui/settings-tab.ts'), 'utf8'),
	]);
	assert.equal(settingsSource.includes('isDomainReadOnly'), false);
	assert.equal(settingsSource.includes('isReadOnly?: () => boolean'), false);
	assert.equal(settingsSource.includes("readOnlyRoots.flatMap(root => Array.from(root.querySelectorAll('input, button, select, textarea')))"), false);
	assert.ok(settingsSource.includes("createSettingsAddButton(addRowEl, t('settings', 'tableAddPresetButton'))"));
	assert.ok(mainSource.includes('listUnavailableSources: () => []'));
	assert.ok(mainSource.includes('await this.storage.reconcileTablePresetFileAuthority({'));
	assert.ok(mainSource.includes('createdByOperon && createdFile instanceof TFile'));
	assert.ok(mainSource.includes('await this.app.vault.read(createdFile) === serialized'));
	assert.ok(mainSource.includes('await this.app.fileManager.trashFile(createdFile)'));
});

function legacyManifestPackage(): OperonDataPackageV1 {
	const source = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	source.views.tablePresets = {
		version: 2,
		presetIds: ['table-one'],
		fileBindings: [],
		initialized: false,
		tableDefaultPresetId: 'table-one',
		tableDefaultFolder: 'Operon/Tables',
		tableEmbedVisibleRows: 20,
		tableEmbedDefaultWidthPercent: 100,
		tableShowLineNumbers: true,
		tableShowTaskIcon: true,
		tableShowTaskTypeIcon: true,
	} as unknown as OperonDataPackageV1['views']['tablePresets'];
	return source;
}
