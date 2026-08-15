import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildOperonDataPackageFromSettings } from '../src/storage/operon-data-package';
import { OperonDataPackageStore } from '../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../src/storage/operon-storage-paths';
import { discoverOperonTableFiles } from '../src/storage/table-file';
import {
	buildRecoveredTablePresetDataPackageV1,
	preflightTablePresetManifestRecoveryV1,
	readLooseTablePresetIdV1,
	type TablePresetManifestRecoveryFileEvidence,
} from '../src/storage/table-preset-manifest-recovery';
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
