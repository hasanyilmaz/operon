import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	applyOperonSettingsBackupTableResourcesV1,
	undoOperonSettingsBackupTableResourcesV1,
	type OperonSettingsBackupTableResourceApplyDependenciesV1,
	type OperonSettingsBackupTableResourcePlanItemV1,
} from '../src/core/settings-backup-table-resource-apply';
import { canonicalizeOperonSettingsBackupJson } from '../src/core/settings-backup-format';
import { computeOperonSettingsBackupTableResourcePlanIdV1 } from '../src/core/settings-backup-table-resource-preflight';

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
	return encoder.encode(value);
}

function digest(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function item(
	id: string,
	path: string,
	content: string,
	decision: OperonSettingsBackupTableResourcePlanItemV1['decision'],
): OperonSettingsBackupTableResourcePlanItemV1 {
	const contentBytes = bytes(content);
	return { id, path, bytes: contentBytes, sha256: digest(contentBytes), decision };
}

function input(items: readonly OperonSettingsBackupTableResourcePlanItemV1[]) {
	const planMaterial = {
		version: 1 as const,
		archiveSha256: 'a'.repeat(64), sourceBodyChecksum: 'b'.repeat(64),
		targetFingerprint: 'c'.repeat(64), decisionFingerprint: 'd'.repeat(64),
		actions: items.map(value => ({
			id: value.id, path: value.path, sha256: value.sha256,
			archivePath: `tables/${value.id}.table`, kind: value.decision,
		})),
		projection: {
			tablePresetFileBindings: [], tablePresetOrderIds: [], tableDefaultPresetId: null,
			tablePresetFileInitialized: false, tableFavoriteIds: [],
		},
	};
	const plan = { ...planMaterial, planId: computeOperonSettingsBackupTableResourcePlanIdV1(planMaterial) };
	return { plan, appliedAt: '2026-08-10T20:00:00.000Z', items };
}

function harness(initial: Readonly<Record<string, Uint8Array>> = {}) {
	const files = new Map<string, Uint8Array>(
		Object.entries(initial).map(([path, value]) => [path, new Uint8Array(value)]),
	);
	const events: string[] = [];
	const directories = new Set<string>();
	let canonicalResult: Awaited<ReturnType<OperonSettingsBackupTableResourceApplyDependenciesV1['commitCanonical']>> = {
		state: 'committed',
		currentFingerprint: 'current-fingerprint',
		canonicalUndoStateId: 'canonical-undo-state',
	};
	const dependencies: OperonSettingsBackupTableResourceApplyDependenciesV1 = {
		async readFile(path) {
			events.push(`read:${path}`);
			const value = files.get(path);
			return value ? new Uint8Array(value) : null;
		},
		async ensureParentDirectories(path) {
			const slash = path.lastIndexOf('/');
			const parent = slash < 0 ? '' : path.slice(0, slash);
			if (!parent) return [];
			const created: string[] = [];
			let current = '';
			for (const segment of parent.split('/')) {
				current = current ? `${current}/${segment}` : segment;
				if (directories.has(current)) continue;
				directories.add(current);
				created.push(current);
			}
			return created;
		},
		async createFileExclusive(path, value) {
			events.push(`create:${path}`);
			if (files.has(path)) throw new Error('exists');
			files.set(path, new Uint8Array(value));
		},
		async removeFileIfUnchanged(path, expectedBytes, expectedSha256) {
			events.push(`remove:${path}`);
			const current = files.get(path);
			if (!current) return 'missing';
			if (
				digest(current) !== expectedSha256
				|| digest(expectedBytes) !== expectedSha256
				|| current.some((value, index) => value !== expectedBytes[index])
			) return 'changed';
			files.delete(path);
			return 'removed';
		},
		async removeDirectoryIfEmpty(path) {
			if (!directories.has(path)) return 'missing';
			if ([...files.keys()].some(file => file.startsWith(`${path}/`))
				|| [...directories].some(directory => directory !== path && directory.startsWith(`${path}/`))) {
				return 'not-empty';
			}
			events.push(`remove-dir:${path}`);
			directories.delete(path);
			return 'removed';
		},
		digestBytes: digest,
		async commitCanonical(installed) {
			events.push(`canonical:${installed.map(value => value.id).join(',')}`);
			return canonicalResult;
		},
		async settleRuntime() {
			events.push('runtime');
		},
	};
	return {
		dependencies,
		events,
		files,
		directories,
		setCanonicalResult(value: typeof canonicalResult) {
			canonicalResult = value;
		},
	};
}

test('installs exact reuse/create resources before canonical settings and omits skipped resources', async () => {
	const reused = item('reused', 'Tables/Reused.table', 'reused-bytes', 'reuse');
	const created = item('created', 'Tables/Created.table', 'created-bytes', 'create');
	const skipped = item('skipped', 'Tables/Skipped.table', 'skipped-bytes', 'skip');
	const state = harness({ [reused.path]: reused.bytes });
	const result = await applyOperonSettingsBackupTableResourcesV1(
		input([reused, created, skipped]),
		state.dependencies,
	);

	assert.equal(result.receipt.status, 'success');
	assert.deepEqual(result.receipt.counts, { created: 1, reused: 1, skipped: 1 });
	assert.deepEqual(result.installed.map(value => [value.id, value.disposition]), [
		['reused', 'reused'],
		['created', 'created'],
	]);
	assert.ok(state.events.indexOf(`create:${created.path}`) < state.events.indexOf('canonical:reused,created'));
	assert.ok(state.events.indexOf(`read:${created.path}`) < state.events.indexOf('canonical:reused,created'));
	assert.equal(state.files.has(skipped.path), false);
	assert.ok(result.sessionUndo);
	assert.equal(result.sessionUndo?.receiptId, result.receipt.receiptId);
	assert.equal(result.sessionUndo?.undoTokenId, result.receipt.recovery.undoTokenId);
	const { receiptId, ...receiptBody } = result.receipt;
	assert.equal(receiptId, digest(bytes(canonicalizeOperonSettingsBackupJson(receiptBody))));
});

test('rejects a create conflict before any resource or canonical write', async () => {
	const planned = item('created', 'Tables/Exists.table', 'source', 'create');
	const state = harness({ [planned.path]: bytes('target') });
	const result = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);

	assert.equal(result.receipt.status, 'failed');
	assert.equal(result.receipt.failureCode, 'create-conflict');
	assert.equal(result.receipt.canonicalWrite, 'not-attempted');
	assert.equal(state.events.some(value => value.startsWith('create:') || value.startsWith('canonical:')), false);
});

test('rejects traversal and portable path collisions before writes', async () => {
	const state = harness();
	const traversal = item('unsafe', '../Unsafe.table', 'unsafe', 'create');
	const collisionA = item('a', 'Tables/Café.table', 'a', 'create');
	const collisionB = item('b', 'tables/Café.table', 'b', 'create');
	for (const items of [[traversal], [collisionA, collisionB]]) {
		const result = await applyOperonSettingsBackupTableResourcesV1(input(items), state.dependencies);
		assert.equal(result.receipt.failureCode, 'invalid-plan');
	}
	assert.equal(state.events.some(value => value.startsWith('create:') || value.startsWith('canonical:')), false);
});

test('a create exception is treated as an uncertain retained write and never cleaned up', async () => {
	const planned = item('uncertain', 'Tables/Uncertain.table', 'uncertain', 'create');
	const state = harness();
	state.dependencies.createFileExclusive = async (path, value) => {
		state.files.set(path, new Uint8Array(value));
		throw new Error('transport outcome unknown');
	};
	const result = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);

	assert.equal(result.receipt.failureCode, 'resource-write-failed');
	assert.equal(result.receipt.cleanup.retainedUnknown, 1);
	assert.equal(result.receipt.cleanup.removed, 0);
	assert.equal(state.files.has(planned.path), true);
});

test('failed-clean canonical write conditionally removes files created by this apply', async () => {
	const planned = item('created', 'Imported/Nested/New.table', 'new', 'create');
	const state = harness();
	state.setCanonicalResult({ state: 'failed-clean' });
	const result = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);

	assert.equal(result.receipt.status, 'failed');
	assert.equal(result.receipt.canonicalWrite, 'failed-clean');
	assert.equal(result.receipt.cleanup.removed, 1);
	assert.equal(result.receipt.cleanup.removedDirectories, 2);
	assert.deepEqual(state.events.filter(value => value.startsWith('remove-dir:')), [
		'remove-dir:Imported/Nested',
		'remove-dir:Imported',
	]);
	assert.equal(state.files.has(planned.path), false);
	assert.equal(state.directories.size, 0);
});

test('changed created file is preserved when failed-clean canonical write triggers cleanup', async () => {
	const planned = item('created', 'Tables/Changed.table', 'original', 'create');
	const state = harness();
	state.dependencies.commitCanonical = async () => {
		state.files.set(planned.path, bytes('changed-after-create'));
		return { state: 'failed-clean' };
	};
	const result = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);

	assert.equal(result.receipt.cleanup.removed, 0);
	assert.equal(result.receipt.cleanup.retainedChanged, 1);
	assert.equal(result.receipt.cleanup.retainedNonEmptyDirectories, 1);
	assert.equal(result.receipt.recovery.mode, 'manual-backup-required');
	assert.equal(new TextDecoder().decode(state.files.get(planned.path)), 'changed-after-create');
});

test('unknown canonical state preserves created files and requires manual recovery', async () => {
	const planned = item('created', 'Tables/Unknown.table', 'unknown', 'create');
	const state = harness();
	state.setCanonicalResult({ state: 'state-unknown' });
	const result = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);

	assert.equal(result.receipt.status, 'commit-state-unknown');
	assert.equal(result.receipt.canonicalWrite, 'state-unknown');
	assert.equal(result.receipt.recovery.mode, 'manual-backup-required');
	assert.equal(result.receipt.cleanup.removed, 0);
	assert.equal(state.files.has(planned.path), true);
});

test('runtime settlement failure keeps committed resources and returns a degraded receipt', async () => {
	const planned = item('created', 'Tables/Runtime.table', 'runtime', 'create');
	const state = harness();
	state.dependencies.settleRuntime = async () => {
		throw new Error('runtime refresh failed');
	};
	const result = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);

	assert.equal(result.receipt.status, 'runtime-degraded');
	assert.equal(result.receipt.canonicalWrite, 'committed');
	assert.equal(result.receipt.runtimeSettlement, 'degraded');
	assert.equal(state.files.has(planned.path), true);
});

test('session undo is receipt-bound and removes only unchanged, unreferenced created resources', async () => {
	const first = item('first', 'Tables/First.table', 'first', 'create');
	const second = item('second', 'Tables/Second.table', 'second', 'create');
	const third = item('third', 'Tables/Third.table', 'third', 'create');
	const state = harness();
	const applied = await applyOperonSettingsBackupTableResourcesV1(input([first, second, third]), state.dependencies);
	assert.ok(applied.sessionUndo);
	let undoCalls = 0;
	const undoDependencies = {
		readFile: state.dependencies.readFile,
		removeFileIfUnchanged: state.dependencies.removeFileIfUnchanged,
		removeDirectoryIfEmpty: state.dependencies.removeDirectoryIfEmpty,
		digestBytes: digest,
		async undoCanonical() {
			undoCalls++;
			return 'committed' as const;
		},
		async isPathReferenced(path: string) {
			return path === third.path;
		},
	};
	const mismatch = await undoOperonSettingsBackupTableResourcesV1(
		applied.sessionUndo!,
		{ receiptId: 'wrong', undoTokenId: applied.sessionUndo!.undoTokenId },
		undoDependencies,
	);
	assert.deepEqual(mismatch, { status: 'blocked', reason: 'receipt-mismatch' });
	assert.equal(undoCalls, 0);

	state.files.set(second.path, bytes('user-change'));
	const undone = await undoOperonSettingsBackupTableResourcesV1(
		applied.sessionUndo!,
		{ receiptId: applied.receipt.receiptId, undoTokenId: applied.sessionUndo!.undoTokenId },
		undoDependencies,
	);
	assert.equal(undone.status, 'manual-recovery-required');
	assert.equal(undone.status === 'manual-recovery-required' ? undone.reason : null, 'resource-cleanup-incomplete');
	assert.deepEqual(undone.status === 'manual-recovery-required' ? undone.cleanup : null, {
		removed: 1,
		alreadyMissing: 0,
		retainedChanged: 1,
		retainedReferenced: 1,
		retainedUnknown: 0,
		failed: 0,
		removedDirectories: 0,
		alreadyMissingDirectories: 0,
		retainedNonEmptyDirectories: 1,
		failedDirectories: 0,
	});
	assert.equal(state.files.has(first.path), false);
	assert.equal(state.files.has(second.path), true);
	assert.equal(state.files.has(third.path), true);
});

test('unknown canonical undo state never removes Table files', async () => {
	const planned = item('created', 'Tables/UndoUnknown.table', 'undo', 'create');
	const state = harness();
	const applied = await applyOperonSettingsBackupTableResourcesV1(input([planned]), state.dependencies);
	const result = await undoOperonSettingsBackupTableResourcesV1(
		applied.sessionUndo!,
		{ receiptId: applied.receipt.receiptId, undoTokenId: applied.sessionUndo!.undoTokenId },
		{
			readFile: state.dependencies.readFile,
			removeFileIfUnchanged: state.dependencies.removeFileIfUnchanged,
			removeDirectoryIfEmpty: state.dependencies.removeDirectoryIfEmpty,
			digestBytes: digest,
			async undoCanonical() {
				return 'state-unknown';
			},
			async isPathReferenced() {
				return false;
			},
		},
	);
	assert.deepEqual(result, { status: 'manual-recovery-required', reason: 'canonical-state-unknown' });
	assert.equal(state.files.has(planned.path), true);
});
