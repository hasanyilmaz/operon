import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import { canonicalizeOperonSettingsBackupJson } from './settings-backup-format';
import {
	computeOperonSettingsBackupTableResourcePlanIdV1,
	type OperonSettingsBackupTableResourceRestorePlanV1,
} from './settings-backup-table-resource-preflight';

export type OperonSettingsBackupTableResourceDecisionV1 = 'reuse' | 'create' | 'skip';

export interface OperonSettingsBackupTableResourcePlanItemV1 {
	id: string;
	path: string;
	sha256: string;
	bytes: Uint8Array;
	decision: OperonSettingsBackupTableResourceDecisionV1;
}

export interface OperonSettingsBackupInstalledTableResourceV1 {
	id: string;
	path: string;
	sha256: string;
	disposition: 'reused' | 'created';
}

export type OperonSettingsBackupCanonicalTableWriteResultV1 =
	| {
		state: 'committed' | 'committed-after-error';
		currentFingerprint: string;
		canonicalUndoStateId: string;
	}
	| { state: 'failed-clean' }
	| { state: 'state-unknown' };

export interface OperonSettingsBackupTableResourceApplyDependenciesV1 {
	readFile(path: string): Promise<Uint8Array | null>;
	/** Must fail when the target already exists and must never overwrite it. */
	createFileExclusive(path: string, bytes: Uint8Array): Promise<void>;
	/** Must compare again in the same serialized mutation before removing. */
	removeFileIfUnchanged(
		path: string,
		expectedBytes: Uint8Array,
		expectedSha256: string,
	): Promise<'removed' | 'missing' | 'changed'>;
	digestBytes(bytes: Uint8Array): Promise<string> | string;
	commitCanonical(
		installed: readonly OperonSettingsBackupInstalledTableResourceV1[],
		plan: OperonSettingsBackupTableResourceRestorePlanV1,
	): Promise<OperonSettingsBackupCanonicalTableWriteResultV1>;
	settleRuntime?(): Promise<void>;
}

export interface OperonSettingsBackupTableResourceCleanupSummaryV1 {
	removed: number;
	alreadyMissing: number;
	retainedChanged: number;
	retainedReferenced: number;
	retainedUnknown: number;
	failed: number;
}

export interface OperonSettingsBackupTableResourceReceiptV1 {
	version: 1;
	receiptId: string;
	status: 'success' | 'runtime-degraded' | 'failed' | 'commit-state-unknown';
	planId: string;
	appliedAt: string;
	counts: {
		created: number;
		reused: number;
		skipped: number;
	};
	canonicalWrite: 'not-attempted' | 'committed' | 'committed-after-error' | 'failed-clean' | 'state-unknown';
	runtimeSettlement: 'not-started' | 'settled' | 'degraded';
	cleanup: OperonSettingsBackupTableResourceCleanupSummaryV1;
	recovery: {
		mode: 'none' | 'session-conditional-undo' | 'manual-backup-required';
		undoAvailable: boolean;
		undoTokenId: string | null;
	};
	failureCode: OperonSettingsBackupTableResourceFailureCodeV1 | null;
}

export type OperonSettingsBackupTableResourceFailureCodeV1 =
	| 'invalid-plan'
	| 'source-integrity-failed'
	| 'reuse-mismatch'
	| 'create-conflict'
	| 'resource-write-failed'
	| 'resource-verification-failed'
	| 'canonical-write-failed'
	| 'canonical-state-unknown';

export interface OperonSettingsBackupTableResourceSessionUndoV1 {
	version: 1;
	receiptId: string;
	undoTokenId: string;
	canonicalUndoStateId: string;
	expectedCurrentFingerprint: string;
	created: readonly Readonly<{
		path: string;
		sha256: string;
		bytes: Uint8Array;
	}>[];
}

export interface OperonSettingsBackupTableResourceApplyResultV1 {
	receipt: OperonSettingsBackupTableResourceReceiptV1;
	installed: readonly OperonSettingsBackupInstalledTableResourceV1[];
	sessionUndo: OperonSettingsBackupTableResourceSessionUndoV1 | null;
}

export interface OperonSettingsBackupTableResourceApplyInputV1 {
	plan: OperonSettingsBackupTableResourceRestorePlanV1;
	appliedAt: string;
	items: readonly OperonSettingsBackupTableResourcePlanItemV1[];
}

interface CreatedResourceV1 {
	path: string;
	sha256: string;
	bytes: Uint8Array;
}

const EMPTY_CLEANUP: OperonSettingsBackupTableResourceCleanupSummaryV1 = Object.freeze({
	removed: 0,
	alreadyMissing: 0,
	retainedChanged: 0,
	retainedReferenced: 0,
	retainedUnknown: 0,
	failed: 0,
});

/**
 * Install verified Table bytes before committing canonical settings. The
 * coordinator owns no filesystem implementation and never overwrites a file.
 */
export async function applyOperonSettingsBackupTableResourcesV1(
	input: OperonSettingsBackupTableResourceApplyInputV1,
	dependencies: OperonSettingsBackupTableResourceApplyDependenciesV1,
): Promise<OperonSettingsBackupTableResourceApplyResultV1> {
	const stableInput = snapshotInput(input);
	const planFailure = await validatePlan(stableInput, dependencies);
	if (planFailure) return failedResult(stableInput, planFailure, 'not-attempted', EMPTY_CLEANUP, []);

	const installed: OperonSettingsBackupInstalledTableResourceV1[] = [];
	const created: CreatedResourceV1[] = [];
	let failureCode: OperonSettingsBackupTableResourceFailureCodeV1 | null = null;
	let uncertainCreates = 0;

	for (const item of stableInput.items) {
		if (item.decision === 'skip') continue;
		if (item.decision === 'reuse') {
			const current = await safelyRead(dependencies, item.path);
			if (!current || !(await matchesExpected(current, item, dependencies))) {
				failureCode = 'reuse-mismatch';
				break;
			}
			installed.push(installedItem(item, 'reused'));
			continue;
		}

		try {
			await dependencies.createFileExclusive(item.path, cloneBytes(item.bytes));
		} catch {
			uncertainCreates++;
			failureCode = 'resource-write-failed';
			break;
		}
		created.push({ path: item.path, sha256: item.sha256, bytes: cloneBytes(item.bytes) });
		const current = await safelyRead(dependencies, item.path);
		if (!current || !(await matchesExpected(current, item, dependencies))) {
			failureCode = 'resource-verification-failed';
			break;
		}
		installed.push(installedItem(item, 'created'));
	}

	if (failureCode) {
		const cleanup = await cleanupCreated(created, dependencies);
		cleanup.retainedUnknown += uncertainCreates;
		return failedResult(stableInput, failureCode, 'not-attempted', cleanup, installed);
	}

	let canonical: OperonSettingsBackupCanonicalTableWriteResultV1;
	try {
		canonical = await dependencies.commitCanonical(freezeInstalled(installed), stableInput.plan);
	} catch {
		canonical = { state: 'state-unknown' };
	}
	if (canonical.state === 'state-unknown') {
		return result(stableInput, installed, null, {
			status: 'commit-state-unknown',
			canonicalWrite: 'state-unknown',
			runtimeSettlement: 'not-started',
			cleanup: EMPTY_CLEANUP,
			recoveryMode: 'manual-backup-required',
			failureCode: 'canonical-state-unknown',
		});
	}
	if (canonical.state === 'failed-clean') {
		const cleanup = await cleanupCreated(created, dependencies);
		return failedResult(stableInput, 'canonical-write-failed', 'failed-clean', cleanup, installed);
	}

	let runtimeSettlement: 'settled' | 'degraded' = 'settled';
	try {
		await dependencies.settleRuntime?.();
	} catch {
		runtimeSettlement = 'degraded';
	}
	const receiptSeed = buildReceipt(stableInput, installed, {
		status: runtimeSettlement === 'settled' ? 'success' : 'runtime-degraded',
		canonicalWrite: canonical.state,
		runtimeSettlement,
		cleanup: EMPTY_CLEANUP,
		recoveryMode: 'session-conditional-undo',
		failureCode: null,
	}, null);
	const receiptId = fingerprint(receiptSeed);
	const undoTokenId = fingerprint({
		receiptId,
		canonicalUndoStateId: canonical.canonicalUndoStateId,
		expectedCurrentFingerprint: canonical.currentFingerprint,
		created: created.map(item => ({ path: item.path, sha256: item.sha256 })),
	});
	const receipt = deepFreeze({
		...receiptSeed,
		receiptId,
		recovery: { mode: 'session-conditional-undo' as const, undoAvailable: true, undoTokenId },
	});
	return {
		receipt,
		installed: freezeInstalled(installed),
		sessionUndo: deepFreeze({
			version: 1 as const,
			receiptId,
			undoTokenId,
			canonicalUndoStateId: canonical.canonicalUndoStateId,
			expectedCurrentFingerprint: canonical.currentFingerprint,
			created: created.map(item => ({ ...item, bytes: cloneBytes(item.bytes) })),
		}),
	};
}

export interface OperonSettingsBackupTableResourceUndoDependenciesV1
	extends Pick<
		OperonSettingsBackupTableResourceApplyDependenciesV1,
		'readFile' | 'removeFileIfUnchanged' | 'digestBytes'
	> {
	undoCanonical(input: {
		canonicalUndoStateId: string;
		expectedCurrentFingerprint: string;
	}): Promise<'committed' | 'failed-clean' | 'state-unknown'>;
	isPathReferenced(path: string): Promise<boolean>;
}

export type OperonSettingsBackupTableResourceUndoResultV1 =
	| { status: 'success'; cleanup: OperonSettingsBackupTableResourceCleanupSummaryV1 }
	| { status: 'blocked'; reason: 'receipt-mismatch' | 'token-mismatch' | 'canonical-undo-failed' }
	| { status: 'manual-recovery-required'; reason: 'canonical-state-unknown'; cleanup?: never }
	| { status: 'manual-recovery-required'; reason: 'resource-cleanup-incomplete'; cleanup: OperonSettingsBackupTableResourceCleanupSummaryV1 };

/** Restore canonical settings first, then conditionally remove created files. */
export async function undoOperonSettingsBackupTableResourcesV1(
	session: OperonSettingsBackupTableResourceSessionUndoV1,
	request: { receiptId: string; undoTokenId: string },
	dependencies: OperonSettingsBackupTableResourceUndoDependenciesV1,
): Promise<OperonSettingsBackupTableResourceUndoResultV1> {
	if (request.receiptId !== session.receiptId) return { status: 'blocked', reason: 'receipt-mismatch' };
	if (request.undoTokenId !== session.undoTokenId) return { status: 'blocked', reason: 'token-mismatch' };
	let canonical: 'committed' | 'failed-clean' | 'state-unknown';
	try {
		canonical = await dependencies.undoCanonical({
			canonicalUndoStateId: session.canonicalUndoStateId,
			expectedCurrentFingerprint: session.expectedCurrentFingerprint,
		});
	} catch {
		canonical = 'state-unknown';
	}
	if (canonical === 'state-unknown') {
		return { status: 'manual-recovery-required', reason: 'canonical-state-unknown' };
	}
	if (canonical === 'failed-clean') return { status: 'blocked', reason: 'canonical-undo-failed' };
	const cleanup = await cleanupCreated(
		session.created,
		dependencies,
		path => dependencies.isPathReferenced(path),
	);
	if (cleanup.retainedChanged || cleanup.retainedReferenced || cleanup.retainedUnknown || cleanup.failed) {
		return { status: 'manual-recovery-required', reason: 'resource-cleanup-incomplete', cleanup };
	}
	return { status: 'success', cleanup };
}

async function validatePlan(
	input: OperonSettingsBackupTableResourceApplyInputV1,
	dependencies: OperonSettingsBackupTableResourceApplyDependenciesV1,
): Promise<OperonSettingsBackupTableResourceFailureCodeV1 | null> {
	const { planId, ...planMaterial } = input.plan;
	if (planId !== computeOperonSettingsBackupTableResourcePlanIdV1(planMaterial)
		|| !input.appliedAt || !Number.isFinite(Date.parse(input.appliedAt))) return 'invalid-plan';
	if (input.plan.actions.length !== input.items.length) return 'invalid-plan';
	for (const [index, item] of input.items.entries()) {
		const action = input.plan.actions[index];
		if (!action || action.id !== item.id || action.path !== item.path
			|| action.sha256 !== item.sha256 || action.kind !== item.decision) return 'invalid-plan';
	}
	const ids = new Set<string>();
	const paths = new Set<string>();
	for (const item of input.items) {
		const portablePath = portablePathKey(item.path);
		if (
			!item.id
			|| !isSafeTableResourcePath(item.path)
			|| !portablePath
			|| ids.has(item.id)
			|| paths.has(portablePath)
			|| !['reuse', 'create', 'skip'].includes(item.decision)
		) return 'invalid-plan';
		ids.add(item.id);
		paths.add(portablePath);
	}
	for (const item of input.items) {
		if (!/^[a-f0-9]{64}$/.test(item.sha256)) return 'invalid-plan';
		if (await dependencies.digestBytes(item.bytes) !== item.sha256) return 'source-integrity-failed';
		if (item.decision === 'skip') continue;
		const current = await safelyRead(dependencies, item.path);
		if (item.decision === 'reuse' && (!current || !(await matchesExpected(current, item, dependencies)))) {
			return 'reuse-mismatch';
		}
		if (item.decision === 'create' && current !== null) return 'create-conflict';
	}
	return null;
}

async function cleanupCreated(
	created: readonly CreatedResourceV1[],
	dependencies: Pick<
		OperonSettingsBackupTableResourceApplyDependenciesV1,
		'readFile' | 'removeFileIfUnchanged' | 'digestBytes'
	>,
	isReferenced?: (path: string) => Promise<boolean>,
): Promise<OperonSettingsBackupTableResourceCleanupSummaryV1> {
	const summary: OperonSettingsBackupTableResourceCleanupSummaryV1 = {
		removed: 0,
		alreadyMissing: 0,
		retainedChanged: 0,
		retainedReferenced: 0,
		retainedUnknown: 0,
		failed: 0,
	};
	for (const item of [...created].reverse()) {
		try {
			const current = await dependencies.readFile(item.path);
			if (!current) {
				summary.alreadyMissing++;
				continue;
			}
			if (!(await matchesCreated(current, item, dependencies.digestBytes))) {
				summary.retainedChanged++;
				continue;
			}
			if (isReferenced && await isReferenced(item.path)) {
				summary.retainedReferenced++;
				continue;
			}
			const removal = await dependencies.removeFileIfUnchanged(
				item.path,
				cloneBytes(item.bytes),
				item.sha256,
			);
			if (removal === 'removed') summary.removed++;
			else if (removal === 'missing') summary.alreadyMissing++;
			else summary.retainedChanged++;
		} catch {
			summary.failed++;
		}
	}
	return summary;
}

async function matchesExpected(
	actual: Uint8Array,
	expected: Pick<OperonSettingsBackupTableResourcePlanItemV1, 'bytes' | 'sha256'>,
	dependencies: Pick<OperonSettingsBackupTableResourceApplyDependenciesV1, 'digestBytes'>,
): Promise<boolean> {
	return matchesCreated(actual, expected, dependencies.digestBytes);
}

async function matchesCreated(
	actual: Uint8Array,
	expected: Pick<CreatedResourceV1, 'bytes' | 'sha256'>,
	digestBytes: (bytes: Uint8Array) => Promise<string> | string,
): Promise<boolean> {
	if (!equalBytes(actual, expected.bytes)) return false;
	return await digestBytes(actual) === expected.sha256;
}

async function safelyRead(
	dependencies: Pick<OperonSettingsBackupTableResourceApplyDependenciesV1, 'readFile'>,
	path: string,
): Promise<Uint8Array | null> {
	try {
		return await dependencies.readFile(path);
	} catch {
		return null;
	}
}

function failedResult(
	input: OperonSettingsBackupTableResourceApplyInputV1,
	failureCode: OperonSettingsBackupTableResourceFailureCodeV1,
	canonicalWrite: OperonSettingsBackupTableResourceReceiptV1['canonicalWrite'],
	cleanup: OperonSettingsBackupTableResourceCleanupSummaryV1,
	installed: readonly OperonSettingsBackupInstalledTableResourceV1[],
): OperonSettingsBackupTableResourceApplyResultV1 {
	return result(input, installed, null, {
		status: 'failed',
		canonicalWrite,
		runtimeSettlement: 'not-started',
		cleanup,
		recoveryMode: cleanup.retainedUnknown || cleanup.retainedChanged || cleanup.retainedReferenced || cleanup.failed
			? 'manual-backup-required'
			: 'none',
		failureCode,
	});
}

function result(
	input: OperonSettingsBackupTableResourceApplyInputV1,
	installed: readonly OperonSettingsBackupInstalledTableResourceV1[],
	sessionUndo: OperonSettingsBackupTableResourceSessionUndoV1 | null,
	state: ReceiptStateV1,
): OperonSettingsBackupTableResourceApplyResultV1 {
	const receiptBody = buildReceipt(input, installed, state, null);
	const receipt = deepFreeze({ ...receiptBody, receiptId: fingerprint(receiptBody) });
	return { receipt, installed: freezeInstalled(installed), sessionUndo };
}

interface ReceiptStateV1 {
	status: OperonSettingsBackupTableResourceReceiptV1['status'];
	canonicalWrite: OperonSettingsBackupTableResourceReceiptV1['canonicalWrite'];
	runtimeSettlement: OperonSettingsBackupTableResourceReceiptV1['runtimeSettlement'];
	cleanup: OperonSettingsBackupTableResourceCleanupSummaryV1;
	recoveryMode: OperonSettingsBackupTableResourceReceiptV1['recovery']['mode'];
	failureCode: OperonSettingsBackupTableResourceFailureCodeV1 | null;
}

function buildReceipt(
	input: OperonSettingsBackupTableResourceApplyInputV1,
	installed: readonly OperonSettingsBackupInstalledTableResourceV1[],
	state: ReceiptStateV1,
	undoTokenId: string | null,
): Omit<OperonSettingsBackupTableResourceReceiptV1, 'receiptId'> {
	return {
		version: 1,
		status: state.status,
		planId: input.plan.planId,
		appliedAt: input.appliedAt,
		counts: {
			created: installed.filter(item => item.disposition === 'created').length,
			reused: installed.filter(item => item.disposition === 'reused').length,
			skipped: input.items.filter(item => item.decision === 'skip').length,
		},
		canonicalWrite: state.canonicalWrite,
		runtimeSettlement: state.runtimeSettlement,
		cleanup: { ...state.cleanup },
		recovery: {
			mode: state.recoveryMode,
			undoAvailable: state.recoveryMode === 'session-conditional-undo',
			undoTokenId,
		},
		failureCode: state.failureCode,
	};
}

function installedItem(
	item: OperonSettingsBackupTableResourcePlanItemV1,
	disposition: OperonSettingsBackupInstalledTableResourceV1['disposition'],
): OperonSettingsBackupInstalledTableResourceV1 {
	return { id: item.id, path: item.path, sha256: item.sha256, disposition };
}

function freezeInstalled(
	items: readonly OperonSettingsBackupInstalledTableResourceV1[],
): readonly OperonSettingsBackupInstalledTableResourceV1[] {
	return deepFreeze(items.map(item => ({ ...item })));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

function snapshotInput(
	input: OperonSettingsBackupTableResourceApplyInputV1,
): OperonSettingsBackupTableResourceApplyInputV1 {
	return {
		plan: deepFreeze({ ...input.plan, actions: input.plan.actions.map(item => ({ ...item })) }),
		appliedAt: input.appliedAt,
		items: input.items.map(item => ({ ...item, bytes: cloneBytes(item.bytes) })),
	};
}

function isSafeTableResourcePath(path: string): boolean {
	if (!path || path.includes('\\') || hasControlCharacter(path)) return false;
	if (path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:/.test(path)) return false;
	if (!path.toLowerCase().endsWith('.table')) return false;
	const segments = path.split('/');
	return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

function portablePathKey(path: string): string | null {
	try {
		const segments = path.normalize('NFC').split('/').map(segment => segment.replace(/[. ]+$/g, ''));
		if (segments.some(segment => !segment || isWindowsDeviceName(segment))) return null;
		return segments.join('/').toLowerCase();
	} catch {
		return null;
	}
}

function isWindowsDeviceName(segment: string): boolean {
	const stem = segment.split('.')[0].toLowerCase();
	return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem);
}

function fingerprint(value: unknown): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(value));
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	if (value instanceof Uint8Array) return value;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return value;
}
