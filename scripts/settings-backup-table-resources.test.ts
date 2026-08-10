import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256HexV1 } from '../src/agent-runtime/contracts/v1/canonical';
import {
	createOperonSettingsBackupTableBundleArchiveV1,
	exportOperonSettingsBackupTableBundleV1,
	readOperonSettingsBackupTableBundleArchiveV1,
} from '../src/core/settings-backup-table-bundle';
import { preflightOperonSettingsBackupTableResourcesV1 } from '../src/core/settings-backup-table-resource-preflight';
import { coordinateOperonSettingsBackupTableResourceApplyV1 } from '../src/core/settings-backup-table-resource-coordinator';
import { buildOperonSettingsBackupV1, serializeOperonSettingsBackupV1 } from '../src/core/settings-backup-format';
import { validateOperonSettingsBackupTableManifestV1 } from '../src/core/settings-backup-table-manifest';
import { serializeOperonTableFile } from '../src/storage/table-file';
import { createDefaultTablePreset } from '../src/types/table';
import { DEFAULT_SETTINGS, type OperonSettings } from '../src/types/settings';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function sourceSettings(): { settings: OperonSettings; files: Array<{ path: string; text: string }> } {
	const first = { ...createDefaultTablePreset(), id: 'table-first', name: 'First' };
	const second = { ...createDefaultTablePreset(), id: 'table-second', name: 'Second' };
	const settings = clone(DEFAULT_SETTINGS);
	settings.filterSets = [];
	settings.tablePresets = [];
	settings.tablePresetFileInitialized = true;
	settings.tablePresetFileBindings = [
		{ id: first.id, path: 'Tables/First.table' },
		{ id: second.id, path: 'Tables/Second.table' },
	];
	settings.tablePresetOrderIds = [second.id, first.id];
	settings.tableDefaultPresetId = second.id;
	settings.presetFavorites.table = [second.id];
	return {
		settings,
		files: [
			{ path: 'Tables/First.table', text: serializeOperonTableFile(first) },
			{ path: 'Tables/Second.table', text: serializeOperonTableFile(second) },
		],
	};
}

function buildBundle() {
	const source = sourceSettings();
	const result = exportOperonSettingsBackupTableBundleV1({
		settings: source.settings,
		tableFiles: source.files,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: '2026-08-10T16:30:00.000Z',
	});
	assert.equal(result.ok, true, result.diagnostics.map(item => item.message).join('\n'));
	if (!result.ok) throw new Error('bundle failed');
	return result.bundle;
}

test('included bundle export binds deterministic order, default, hashes and logical entries', () => {
	const first = buildBundle();
	const second = buildBundle();
	assert.equal(first.settingsJson, second.settingsJson);
	assert.equal(first.manifestJson, second.manifestJson);
	assert.deepEqual(first.manifest.tableFiles.map(item => item.id), ['table-second', 'table-first']);
	assert.equal(first.manifest.defaultPresetId, 'table-second');
	assert.equal(first.backup.body.tableInventory?.defaultPresetId, 'table-second');
	assert.equal(first.suggestedFileName.endsWith('.zip'), true);
	const logical = first.entries.filter(item => item.path !== 'manifest.json');
	assert.equal(validateOperonSettingsBackupTableManifestV1(first.manifest, logical).ok, true);
	const reorderedBody = clone(first.backup.body);
	assert.ok(reorderedBody.tableInventory);
	if (!reorderedBody.tableInventory) return;
	reorderedBody.tableInventory.items.reverse();
	const reorderedSettings = serializeOperonSettingsBackupV1(buildOperonSettingsBackupV1(reorderedBody));
	const reorderedBytes = new TextEncoder().encode(reorderedSettings);
	const reorderedManifest = {
		...first.manifest,
		settings: {
			path: 'settings.json' as const,
			sha256: sha256HexV1(reorderedSettings),
			bytes: reorderedBytes.byteLength,
		},
	};
	assert.equal(validateOperonSettingsBackupTableManifestV1(reorderedManifest, [
		{ path: 'settings.json', bytes: reorderedBytes },
		...logical.filter(item => item.path !== 'settings.json'),
	]).ok, false);
	assert.equal(validateOperonSettingsBackupTableManifestV1(
		{ ...first.manifest, defaultPresetId: 'table-first' },
		logical,
	).ok, false);
});

test('logical bundle round-trips through the strict deterministic ZIP boundary', async () => {
	const bundle = buildBundle();
	const first = await createOperonSettingsBackupTableBundleArchiveV1(bundle);
	const second = await createOperonSettingsBackupTableBundleArchiveV1(bundle);
	assert.deepEqual(first, second);
	const opened = await readOperonSettingsBackupTableBundleArchiveV1(first);
	assert.equal(opened.settingsText, bundle.settingsJson);
	assert.deepEqual(opened.manifest, bundle.manifest);
	assert.deepEqual(opened.tableFiles.map(item => item.descriptor.id), ['table-second', 'table-first']);
	assert.match(opened.archiveSha256, /^[a-f0-9]{64}$/u);
});

test('included bundle export fails closed for missing, malformed and ID-mismatched bound files', () => {
	const source = sourceSettings();
	const input = {
		settings: source.settings,
		source: { pluginVersion: '3.2.1', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: '2026-08-10T16:30:00.000Z',
	};
	assert.equal(exportOperonSettingsBackupTableBundleV1({ ...input, tableFiles: source.files.slice(0, 1) }).ok, false);
	assert.equal(exportOperonSettingsBackupTableBundleV1({
		...input,
		tableFiles: [{ ...source.files[0], text: '{broken' }, source.files[1]],
	}).ok, false);
	const wrong = { ...createDefaultTablePreset(), id: 'wrong-id' };
	assert.equal(exportOperonSettingsBackupTableBundleV1({
		...input,
		tableFiles: [{ ...source.files[0], text: serializeOperonTableFile(wrong) }, source.files[1]],
	}).ok, false);
});

test('resource preflight produces fingerprint-bound create/reuse plans and requires explicit conflict decisions', () => {
	const bundle = buildBundle();
	const validated = validateOperonSettingsBackupTableManifestV1(
		bundle.manifest,
		bundle.entries.filter(item => item.path !== 'manifest.json'),
	);
	assert.equal(validated.ok, true);
	if (!validated.ok) return;
	const archiveSha256 = sha256HexV1('exact archive bytes stand-in');
	const baseInput = {
		bundle: { ...validated, archiveSha256 },
		availableFilterSetIds: [] as string[],
		includeSourceTableFavorites: true,
		target: {
			paths: [],
			bindings: [],
			orderIds: [],
			defaultPresetId: null,
			initialized: false,
			tableFavoriteIds: [],
		},
	};
	const creates = preflightOperonSettingsBackupTableResourcesV1(baseInput);
	assert.equal(creates.classification, 'ready');
	assert.deepEqual(creates.actions.map(item => item.kind), ['create', 'create']);
	assert.deepEqual(creates.plan?.projection.tablePresetOrderIds, ['table-second', 'table-first']);
	assert.equal(creates.plan?.projection.tableDefaultPresetId, 'table-second');
	assert.deepEqual(creates.plan?.projection.tableFavoriteIds, ['table-second']);

	const firstDescriptor = bundle.manifest.tableFiles[0];
	const exactTarget = {
		...baseInput.target,
		paths: [{
			path: firstDescriptor.originalPath,
			kind: 'file' as const,
			id: firstDescriptor.id,
			sha256: firstDescriptor.sha256,
		}],
		bindings: [{ id: firstDescriptor.id, path: firstDescriptor.originalPath }],
		orderIds: [firstDescriptor.id],
	};
	const reuse = preflightOperonSettingsBackupTableResourcesV1({ ...baseInput, target: exactTarget });
	assert.equal(reuse.classification, 'ready');
	assert.equal(reuse.actions[0]?.kind, 'reuse');

	const conflictTarget = {
		...baseInput.target,
		paths: [{ path: firstDescriptor.originalPath, kind: 'file' as const, id: 'other', sha256: 'f'.repeat(64) }],
	};
	const pending = preflightOperonSettingsBackupTableResourcesV1({ ...baseInput, target: conflictTarget });
	assert.equal(pending.classification, 'decision-required');
	assert.equal(pending.plan, null);
	const skipped = preflightOperonSettingsBackupTableResourcesV1({
		...baseInput,
		target: conflictTarget,
		conflictDecisions: { [`table:${firstDescriptor.id}`]: 'skip' },
	});
	assert.equal(skipped.classification, 'ready');
	assert.equal(skipped.actions[0]?.kind, 'skip');
	assert.equal(skipped.plan?.projection.tableDefaultPresetId, null);
	const canceled = preflightOperonSettingsBackupTableResourcesV1({
		...baseInput,
		target: conflictTarget,
		conflictDecisions: { [`table:${firstDescriptor.id}`]: 'cancel' },
	});
	assert.equal(canceled.classification, 'canceled');
	assert.equal(canceled.plan, null);
});

test('coordinator re-preflights under one mutation lane and commits the sealed projection last', async () => {
	const exported = buildBundle();
	const validated = validateOperonSettingsBackupTableManifestV1(
		exported.manifest, exported.entries.filter(item => item.path !== 'manifest.json'),
	);
	assert.equal(validated.ok, true);
	if (!validated.ok) return;
	const preflightInput = {
		bundle: { ...validated, archiveSha256: 'a'.repeat(64) },
		availableFilterSetIds: [] as string[],
		includeSourceTableFavorites: true,
		target: { paths: [], bindings: [], orderIds: [], defaultPresetId: null, initialized: false, tableFavoriteIds: [] },
	};
	const approved = preflightOperonSettingsBackupTableResourcesV1(preflightInput).plan;
	assert.ok(approved);
	const files = new Map<string, Uint8Array>();
	const events: string[] = [];
	const result = await coordinateOperonSettingsBackupTableResourceApplyV1({
		...preflightInput, approvedPlan: approved!, appliedAt: '2026-08-10T20:00:00.000Z',
	}, {
		async runExclusive(operation) { events.push('lock'); return operation(); },
		async captureAdmission() {
			return { target: preflightInput.target, availableFilterSetIds: preflightInput.availableFilterSetIds };
		},
		async readFile(path) { return files.get(path) ?? null; },
		async createFileExclusive(path, value) { events.push(`create:${path}`); files.set(path, value); },
		async removeFileIfUnchanged() { return 'removed'; },
		digestBytes(value) { return sha256HexV1(new TextDecoder().decode(value)); },
		async commitCanonical(_installed, plan) {
			events.push(`canonical:${plan.projection.tablePresetOrderIds.join(',')}`);
			return { state: 'committed', currentFingerprint: 'current', canonicalUndoStateId: 'undo' };
		},
	});
	assert.equal(result.status, 'applied');
	assert.equal(events[0], 'lock');
	assert.equal(events.at(-1), 'canonical:table-second,table-first');

	const staleEvents: string[] = [];
	const stale = await coordinateOperonSettingsBackupTableResourceApplyV1({
		...preflightInput, approvedPlan: approved!, appliedAt: '2026-08-10T20:01:00.000Z',
	}, {
		async runExclusive(operation) { return operation(); },
		async captureAdmission() {
			return {
				availableFilterSetIds: [],
				target: {
					...preflightInput.target,
					paths: [{ path: 'Tables/First.table', kind: 'file', id: 'other', sha256: 'f'.repeat(64) }],
				},
			};
		},
		async readFile() { return null; },
		async createFileExclusive() { staleEvents.push('create'); },
		async removeFileIfUnchanged() { return 'removed'; },
		digestBytes(value) { return sha256HexV1(new TextDecoder().decode(value)); },
		async commitCanonical() {
			staleEvents.push('canonical');
			return { state: 'committed', currentFingerprint: 'current', canonicalUndoStateId: 'undo' };
		},
	});
	assert.equal(stale.status, 'stale-plan');
	assert.deepEqual(staleEvents, []);
});
