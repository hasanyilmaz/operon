import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import {
	chmodSync,
	lstatSync,
	fstatSync,
	fsyncSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	closeSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationResultV1,
	SealedMutationPlanV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	decodeMutationApplyRequestV1,
	decodeMutationResultV1,
	decodeSealedMutationPlanV1,
} from '../../../src/agent-runtime/contracts/v1/decode';
import {
	ensureOwnerOnlyDirectory,
	operonCliConfigRootV1,
	writeJsonAtomic,
} from './config';
import { assertSecureFileV1 } from './secure-storage';

const PLAN_REF_PATTERN_V1 = /^[A-Za-z0-9_-]{32}$/u;
export const MUTATION_RECOVERY_RETENTION_MS_V1 = 24 * 60 * 60 * 1_000;
export const MUTATION_RECOVERY_RECORD_LIMIT_V1 = 256;
const DISPATCH_CAPACITY_LOCK_WAIT_MS_V1 = 5_000;
const DISPATCH_CAPACITY_LOCK_STALE_MS_V1 = 30_000;
const DISPATCH_CAPACITY_LOCK_POLL_MS_V1 = 10;
const DISPATCH_CAPACITY_LOCK_NAME_V1 = '.dispatch-capacity.lock';
const DISPATCH_CAPACITY_LOCK_SLEEP_V1 = new Int32Array(new SharedArrayBuffer(4));
const WINDOWS_DISPATCH_MUTEX_HELPER_V1 = String.raw`
const fs = require('node:fs');
const net = require('node:net');
const [pipe, statusPath, expectedParent, token] = process.argv.slice(1);
let reported = false;
const report = state => {
	if (reported) return;
	reported = true;
	const temporaryStatusPath = statusPath + '.' + process.pid + '.' + token + '.tmp';
	try {
		fs.writeFileSync(temporaryStatusPath, JSON.stringify({ state, token }), { flag: 'wx' });
		fs.renameSync(temporaryStatusPath, statusPath);
	} catch {
		try {
			fs.unlinkSync(temporaryStatusPath);
		} catch {
			// The status was either published atomically or never created.
		}
		process.exit(72);
	}
};
const server = net.createServer(socket => socket.destroy());
server.once('error', () => {
	report('busy');
	process.exit(73);
});
server.listen(pipe, () => report('ready'));
const timer = setInterval(() => {
	const parentPid = Number(expectedParent);
	if (process.ppid !== parentPid) {
		clearInterval(timer);
		server.close(() => process.exit(0));
		return;
	}
	try {
		process.kill(parentPid, 0);
	} catch {
		clearInterval(timer);
		server.close(() => process.exit(0));
	}
}, 100);
const close = () => {
	clearInterval(timer);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 250).unref();
};
process.once('SIGTERM', close);
process.once('SIGINT', close);
`;

export interface StoredMutationPlanV1 {
	version: 1;
	planRef: string;
	vaultPath: string;
	vaultSha256: string;
	profile?: string;
	clientInstanceId: string;
	idempotencyKey: string;
	plan: SealedMutationPlanV1;
	createdAt: string;
	expiresAt: string;
	applyRequest?: MutationApplyRequestV1;
	recoveryStartedAt?: string;
	recoveryExpiresAt?: string;
	lastOutcome?: Pick<
		MutationResultV1,
		'status' | 'mutationMayHaveApplied' | 'retryAllowed' | 'ambiguitySource'
	>;
	terminalResult?: MutationResultV1;
}

export function storeMutationPlanV1(
	input: {
		vaultPath: string;
		vaultSha256: string;
		profile?: string;
		request: MutationPreviewRequestV1;
		plan: SealedMutationPlanV1;
	},
	root: string = operonCliConfigRootV1(),
): StoredMutationPlanV1 {
	const decodedPlan = decodeSealedMutationPlanV1(input.plan);
	if (!decodedPlan.ok) throw new Error('PLAN_MALFORMED');
	pruneExpiredMutationPlansV1(root);
	const record: StoredMutationPlanV1 = {
		version: 1,
		planRef: `p${randomBytes(23).toString('base64url')}`,
		vaultPath: input.vaultPath,
		vaultSha256: input.vaultSha256,
		...(input.profile ? { profile: input.profile } : {}),
		clientInstanceId: input.plan.clientInstanceId,
		idempotencyKey: input.request.idempotencyKey,
		plan: decodedPlan.value,
		createdAt: new Date().toISOString(),
		expiresAt: input.plan.expiresAt,
	};
	writeStoredPlan(record, root);
	return record;
}

export function pruneExpiredMutationPlansV1(
	root: string = operonCliConfigRootV1(),
	now = Date.now(),
): number {
	const plansRoot = join(root, 'plans');
	let names: string[];
	try {
		names = readdirSync(plansRoot);
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return 0;
		throw error;
	}
	let removed = 0;
	for (const name of names) {
		const match = /^([A-Za-z0-9_-]{32})\.json$/u.exec(name);
		if (!match) continue;
		try {
			readMutationPlanV1(match[1], root, { allowExpired: true, now });
		} catch (error) {
			if (error instanceof Error && error.message === 'PLAN_EXPIRED') removed += 1;
			else throw error;
		}
	}
	return removed;
}

export function readMutationPlanV1(
	planRef: string,
	root: string = operonCliConfigRootV1(),
	options: { allowExpired?: boolean; now?: number } = {},
): StoredMutationPlanV1 {
	validatePlanRef(planRef);
	const path = planPath(planRef, root);
	assertSecureFileV1(path);
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PLAN_NOT_SECURE');
	if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
		throw new Error('PLAN_WRONG_OWNER');
	}
	if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
		throw new Error('PLAN_WRONG_MODE');
	}
	const record = decodeStoredPlan(JSON.parse(readFileSync(path, 'utf8')));
	const now = options.now ?? Date.now();
	if (isProtectedRecoveryRecord(record)) {
		if (now >= recoveryExpiryMs(record)) {
			unlinkSync(path);
			throw new Error('PLAN_EXPIRED');
		}
		if (!options.allowExpired && now >= Date.parse(record.expiresAt)) {
			throw new Error('PLAN_RECOVERY_REQUIRED');
		}
	} else if (!options.allowExpired && now >= Date.parse(record.expiresAt)) {
		unlinkSync(path);
		throw new Error('PLAN_EXPIRED');
	}
	return record;
}

export function writeStoredPlanV1(
	record: StoredMutationPlanV1,
	root: string = operonCliConfigRootV1(),
): void {
	writeStoredPlan(decodeStoredPlan(record), root);
}

export function markMutationPlanDispatchedV1(
	record: StoredMutationPlanV1,
	applyRequest: MutationApplyRequestV1,
	root: string = operonCliConfigRootV1(),
	now = Date.now(),
): StoredMutationPlanV1 {
	if (record.applyRequest) return record;
	return withDispatchCapacityLockV1(root, () => {
		const current = readMutationPlanV1(record.planRef, root, { allowExpired: true, now });
		if (current.applyRequest) return current;
		if (now >= Date.parse(current.expiresAt)) {
			removeMutationPlanFile(current.planRef, root);
			throw new Error('PLAN_EXPIRED');
		}
		if (
			current.plan.planHash !== record.plan.planHash
			|| current.idempotencyKey !== record.idempotencyKey
		) {
			throw new Error('PLAN_MALFORMED');
		}
		pruneExpiredMutationPlansV1(root, now);
		if (
			countProtectedRecoveryRecordsV1(root, record.planRef, now)
			>= MUTATION_RECOVERY_RECORD_LIMIT_V1
		) {
			throw new Error('RECOVERY_STORE_UNAVAILABLE');
		}
		const recoveryStartedAt = new Date(now).toISOString();
		const dispatched = {
			...current,
			applyRequest,
			recoveryStartedAt,
			recoveryExpiresAt: new Date(now + MUTATION_RECOVERY_RETENTION_MS_V1).toISOString(),
		};
		writeStoredPlanV1(dispatched, root);
		return dispatched;
	});
}

export function restoreMutationPlanBeforeDispatchV1(
	record: StoredMutationPlanV1,
	applyRequest: MutationApplyRequestV1,
	root: string = operonCliConfigRootV1(),
): StoredMutationPlanV1 {
	return withDispatchCapacityLockV1(root, () => {
		const current = readMutationPlanV1(record.planRef, root, { allowExpired: true });
		if (
			current.lastOutcome
			|| current.terminalResult
			|| current.applyRequest?.requestId !== applyRequest.requestId
			|| current.plan.planHash !== applyRequest.plan.planHash
		) {
			throw new Error('PLAN_RECOVERY_REQUIRED');
		}
		const {
			applyRequest: _applyRequest,
			recoveryStartedAt: _recoveryStartedAt,
			recoveryExpiresAt: _recoveryExpiresAt,
			...prepared
		} = current;
		writeStoredPlanV1(prepared, root);
		return prepared;
	});
}

export function discardMutationPlanV1(
	planRef: string,
	root: string = operonCliConfigRootV1(),
): boolean {
	let record: StoredMutationPlanV1;
	try {
		record = readMutationPlanV1(planRef, root, { allowExpired: true });
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return false;
		throw error;
	}
	if (record.applyRequest || record.lastOutcome) throw new Error('PLAN_RECOVERY_REQUIRED');
	return removeMutationPlanFile(planRef, root);
}

export function listRecoverableMutationPlansV1(
	root: string = operonCliConfigRootV1(),
	limit = 100,
): StoredMutationPlanV1[] {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new Error('INVALID_PLAN_LIST_LIMIT');
	}
	const plansRoot = join(root, 'plans');
	let names: string[];
	try {
		names = readdirSync(plansRoot);
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return [];
		throw error;
	}
	return names
		.filter(name => /^[A-Za-z0-9_-]{32}\.json$/u.test(name))
		.flatMap(name => {
			try {
				return [readMutationPlanV1(name.slice(0, -5), root, { allowExpired: true })];
			} catch (error) {
				if (error instanceof Error && error.message === 'PLAN_EXPIRED') return [];
				throw error;
			}
		})
		.filter(record => record.applyRequest !== undefined || record.lastOutcome !== undefined)
		.sort((left, right) => (
			right.createdAt.localeCompare(left.createdAt)
			|| left.planRef.localeCompare(right.planRef)
		))
		.slice(0, limit);
}

export function abandonRecoverableMutationPlanV1(
	planRef: string,
	confirmation: string,
	root: string = operonCliConfigRootV1(),
): boolean {
	if (confirmation !== 'ABANDON') throw new Error('PLAN_ABANDON_CONFIRMATION_REQUIRED');
	const record = readMutationPlanV1(planRef, root, { allowExpired: true });
	if (!record.applyRequest && !record.lastOutcome) throw new Error('RECOVERY_REQUEST_REQUIRED');
	return removeMutationPlanFile(planRef, root);
}

function removeMutationPlanFile(planRef: string, root: string): boolean {
	validatePlanRef(planRef);
	try {
		unlinkSync(planPath(planRef, root));
		return true;
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return false;
		throw error;
	}
}

export function buildMutationApplyRequestV1(
	record: StoredMutationPlanV1,
	input: {
		confirmationToken?: string;
		now?: string;
	},
): MutationApplyRequestV1 {
	if (record.applyRequest) return record.applyRequest;
	const confirmationRequired = record.plan.riskLevel === 'destructive'
		|| record.plan.requiresConfirmation
		|| record.plan.requiredAcknowledgements.length > 0;
	if (
		confirmationRequired
		&& input.confirmationToken !== confirmationTokenForPlanV1(record.plan)
	) {
		throw new Error('PLAN_CONFIRMATION_REQUIRED');
	}
	const acknowledgedAt = input.now ?? new Date().toISOString();
	const acknowledgementTargetDigest = record.plan.targets[0]?.targetDigest;
	if (record.plan.requiredAcknowledgements.length > 0 && !acknowledgementTargetDigest) {
		throw new Error('PLAN_MALFORMED');
	}
	return {
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'mutation-apply',
		plan: record.plan,
		authorization: {
			basis: confirmationRequired ? 'user-explicit-confirmation' : 'user-explicit-request',
			reason: confirmationRequired
				? 'The user explicitly confirmed the exact sealed target impact.'
				: 'The user explicitly requested this mutation.',
		},
		idempotencyKey: record.idempotencyKey,
		acknowledgements: record.plan.requiredAcknowledgements.map(code => ({
			code,
			planHash: record.plan.planHash,
			targetDigest: acknowledgementTargetDigest,
			acknowledgedAt,
		})),
	};
}

export function confirmationTokenForPlanV1(plan: SealedMutationPlanV1): string {
	return createHash('sha256')
		.update(`operon-confirm-v1\0${plan.planHash}\0${plan.receiptTargetDigest}`, 'utf8')
		.digest('hex');
}

export function recordMutationOutcomeV1(
	record: StoredMutationPlanV1,
	applyRequest: MutationApplyRequestV1,
	result: MutationResultV1,
	root: string = operonCliConfigRootV1(),
): 'discarded' | 'retained' {
	if (result.status === 'applied' || result.status === 'already-applied') {
		const recoveryStartedAt = record.recoveryStartedAt ?? new Date().toISOString();
		writeStoredPlanV1({
			...record,
			applyRequest,
			recoveryStartedAt,
			recoveryExpiresAt: record.recoveryExpiresAt ?? new Date(
				Date.parse(recoveryStartedAt) + MUTATION_RECOVERY_RETENTION_MS_V1,
			).toISOString(),
			lastOutcome: {
				status: result.status,
				mutationMayHaveApplied: result.mutationMayHaveApplied,
				retryAllowed: result.retryAllowed,
				...(result.ambiguitySource ? { ambiguitySource: result.ambiguitySource } : {}),
			},
			terminalResult: result,
		}, root);
		return 'retained';
	}
	const shouldRetain = result.status === 'outcome-unknown'
		|| result.status === 'partial'
		|| result.mutationMayHaveApplied;
	if (!shouldRetain) {
		removeMutationPlanFile(record.planRef, root);
		return 'discarded';
	}
	writeStoredPlanV1({
		...record,
		applyRequest,
		recoveryStartedAt: record.recoveryStartedAt ?? new Date().toISOString(),
		recoveryExpiresAt: record.recoveryExpiresAt ?? new Date(
			Date.now() + MUTATION_RECOVERY_RETENTION_MS_V1,
		).toISOString(),
		lastOutcome: {
			status: result.status,
			mutationMayHaveApplied: result.mutationMayHaveApplied,
			retryAllowed: result.retryAllowed,
			...(result.ambiguitySource ? { ambiguitySource: result.ambiguitySource } : {}),
		},
	}, root);
	return 'retained';
}

function writeStoredPlan(record: StoredMutationPlanV1, root: string): void {
	validatePlanRef(record.planRef);
	const plansRoot = join(root, 'plans');
	ensureOwnerOnlyDirectory(plansRoot);
	writeJsonAtomic(planPath(record.planRef, root), record);
	if (process.platform !== 'win32') chmodSync(planPath(record.planRef, root), 0o600);
}

function planPath(planRef: string, root: string): string {
	validatePlanRef(planRef);
	return join(root, 'plans', `${planRef}.json`);
}

function validatePlanRef(planRef: string): void {
	if (!PLAN_REF_PATTERN_V1.test(planRef)) throw new Error('INVALID_PLAN_REF');
}

function decodeStoredPlan(value: unknown): StoredMutationPlanV1 {
	if (!isPlainRecord(value)) throw new Error('PLAN_MALFORMED');
	const allowed = new Set([
		'version',
		'planRef',
		'vaultPath',
		'vaultSha256',
		'profile',
		'clientInstanceId',
		'idempotencyKey',
		'plan',
		'createdAt',
		'expiresAt',
		'applyRequest',
		'recoveryStartedAt',
		'recoveryExpiresAt',
		'lastOutcome',
		'terminalResult',
	]);
	if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('PLAN_UNKNOWN_FIELD');
	if (
		value.version !== 1
		|| typeof value.planRef !== 'string'
		|| !PLAN_REF_PATTERN_V1.test(value.planRef)
		|| typeof value.vaultPath !== 'string'
		|| !/^[a-f0-9]{64}$/u.test(String(value.vaultSha256))
		|| typeof value.clientInstanceId !== 'string'
		|| typeof value.idempotencyKey !== 'string'
		|| !isPlainRecord(value.plan)
		|| typeof value.createdAt !== 'string'
		|| typeof value.expiresAt !== 'string'
		|| (value.profile !== undefined && typeof value.profile !== 'string')
		|| (value.applyRequest !== undefined && !isPlainRecord(value.applyRequest))
		|| (value.recoveryStartedAt !== undefined && typeof value.recoveryStartedAt !== 'string')
		|| (value.recoveryExpiresAt !== undefined && typeof value.recoveryExpiresAt !== 'string')
		|| (value.lastOutcome !== undefined && !isPlainRecord(value.lastOutcome))
		|| (value.terminalResult !== undefined && !isPlainRecord(value.terminalResult))
	) throw new Error('PLAN_MALFORMED');
	const decodedPlan = decodeSealedMutationPlanV1(value.plan);
	if (!decodedPlan.ok) throw new Error('PLAN_MALFORMED');
	if (value.applyRequest !== undefined && !decodeMutationApplyRequestV1(value.applyRequest).ok) {
		throw new Error('PLAN_MALFORMED');
	}
	if (
		(value.recoveryStartedAt === undefined) !== (value.recoveryExpiresAt === undefined)
		|| (value.recoveryStartedAt !== undefined && value.applyRequest === undefined)
		|| (value.recoveryStartedAt !== undefined && !isFiniteIsoDate(value.recoveryStartedAt))
		|| (value.recoveryExpiresAt !== undefined && !isFiniteIsoDate(value.recoveryExpiresAt))
		|| (
			value.recoveryStartedAt !== undefined
			&& value.recoveryExpiresAt !== undefined
			&& (
				Date.parse(value.recoveryExpiresAt) - Date.parse(value.recoveryStartedAt)
				!== MUTATION_RECOVERY_RETENTION_MS_V1
			)
		)
	) throw new Error('PLAN_MALFORMED');
	if (value.terminalResult !== undefined) {
		const decodedResult = decodeMutationResultV1(value.terminalResult);
		if (
			!decodedResult.ok
			|| value.applyRequest === undefined
			|| (
				decodedResult.value.status !== 'applied'
				&& decodedResult.value.status !== 'already-applied'
			)
		) throw new Error('PLAN_MALFORMED');
		if (
			!isPlainRecord(value.lastOutcome)
			|| value.lastOutcome.status !== decodedResult.value.status
		) throw new Error('PLAN_MALFORMED');
	}
	return {
		...(value as unknown as StoredMutationPlanV1),
		plan: decodedPlan.value,
	};
}

function countProtectedRecoveryRecordsV1(
	root: string,
	excludedPlanRef: string,
	now: number,
): number {
	const plansRoot = join(root, 'plans');
	let names: string[];
	try {
		names = readdirSync(plansRoot);
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return 0;
		throw error;
	}
	let count = 0;
	for (const name of names) {
		const match = /^([A-Za-z0-9_-]{32})\.json$/u.exec(name);
		if (!match || match[1] === excludedPlanRef) continue;
		let candidate: StoredMutationPlanV1;
		try {
			candidate = readMutationPlanV1(match[1], root, { allowExpired: true, now });
		} catch (error) {
			if (error instanceof Error && error.message === 'PLAN_EXPIRED') continue;
			throw error;
		}
		if (isProtectedRecoveryRecord(candidate)) count += 1;
	}
	return count;
}

interface DispatchCapacityLockV1 {
	descriptor: number;
	dev: number;
	ino: number;
	path: string;
	token: string;
}

function withDispatchCapacityLockV1<T>(root: string, action: () => T): T {
	if (process.platform === 'win32') {
		const mutex = acquireWindowsDispatchCapacityMutexV1(root);
		try {
			return action();
		} finally {
			releaseWindowsDispatchCapacityMutexV1(mutex);
		}
	}
	const lock = acquireDispatchCapacityLockV1(root);
	try {
		return action();
	} finally {
		releaseDispatchCapacityLockV1(lock);
	}
}

interface WindowsDispatchCapacityMutexV1 {
	child: ChildProcess;
	statusPath: string;
}

function acquireWindowsDispatchCapacityMutexV1(
	root: string,
): WindowsDispatchCapacityMutexV1 {
	ensureOwnerOnlyDirectory(join(root, 'plans'));
	const rootDigest = createHash('sha256')
		.update(root.normalize('NFC').toLocaleLowerCase('en-US'), 'utf8')
		.digest('hex')
		.slice(0, 40);
	const pipe = `\\\\.\\pipe\\operon-dispatch-capacity-${rootDigest}`;
	const deadline = Date.now() + DISPATCH_CAPACITY_LOCK_WAIT_MS_V1;
	while (Date.now() < deadline) {
		const token = randomUUID();
		const statusPath = join(
			tmpdir(),
			`operon-dispatch-mutex-${process.pid}-${token}.json`,
		);
		const child = spawn(process.execPath, [
			'-e',
			WINDOWS_DISPATCH_MUTEX_HELPER_V1,
			pipe,
			statusPath,
			String(process.pid),
			token,
		], {
			stdio: 'ignore',
			windowsHide: true,
			shell: false,
		});
		let state: 'ready' | 'busy' | null = null;
		while (Date.now() < deadline && state === null) {
			try {
				const stat = lstatSync(statusPath);
				if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256) {
					throw new Error('RECOVERY_STORE_UNAVAILABLE');
				}
				const value = JSON.parse(readFileSync(statusPath, 'utf8')) as unknown;
				if (
					isPlainRecord(value)
					&& value.token === token
					&& (value.state === 'ready' || value.state === 'busy')
				) state = value.state;
				else throw new Error('RECOVERY_STORE_UNAVAILABLE');
			} catch (error) {
				if (!hasErrorCode(error, 'ENOENT')) {
					child.kill();
					try {
						unlinkSync(statusPath);
					} catch {
						// Preserve the validation failure.
					}
					throw error;
				}
				Atomics.wait(DISPATCH_CAPACITY_LOCK_SLEEP_V1, 0, 0, DISPATCH_CAPACITY_LOCK_POLL_MS_V1);
			}
		}
		try {
			unlinkSync(statusPath);
		} catch (error) {
			if (!hasErrorCode(error, 'ENOENT')) {
				child.kill();
				throw new Error('RECOVERY_STORE_UNAVAILABLE');
			}
		}
		if (state === 'ready') return { child, statusPath };
		child.kill();
		Atomics.wait(DISPATCH_CAPACITY_LOCK_SLEEP_V1, 0, 0, DISPATCH_CAPACITY_LOCK_POLL_MS_V1);
	}
	throw new Error('RECOVERY_STORE_UNAVAILABLE');
}

function releaseWindowsDispatchCapacityMutexV1(
	mutex: WindowsDispatchCapacityMutexV1,
): void {
	mutex.child.kill();
	try {
		unlinkSync(mutex.statusPath);
	} catch (error) {
		if (!hasErrorCode(error, 'ENOENT')) throw new Error('RECOVERY_STORE_UNAVAILABLE');
	}
}

function acquireDispatchCapacityLockV1(root: string): DispatchCapacityLockV1 {
	const plansRoot = join(root, 'plans');
	ensureOwnerOnlyDirectory(plansRoot);
	const path = join(plansRoot, DISPATCH_CAPACITY_LOCK_NAME_V1);
	const deadline = Date.now() + DISPATCH_CAPACITY_LOCK_WAIT_MS_V1;
	while (true) {
		const token = randomUUID();
		let descriptor: number | null = null;
		try {
			descriptor = openSync(path, 'wx', 0o600);
			const createdAt = new Date().toISOString();
			writeFileSync(descriptor, `${JSON.stringify({
				version: 1,
				pid: process.pid,
				token,
				createdAt,
			})}\n`, 'utf8');
			fsyncSync(descriptor);
			const stat = fstatSync(descriptor);
			if (
				!stat.isFile()
				|| (typeof process.getuid === 'function' && stat.uid !== process.getuid())
				|| (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
			) {
				throw new Error('RECOVERY_STORE_UNAVAILABLE');
			}
			const current = lstatSync(path);
			if (
				current.isSymbolicLink()
				|| !current.isFile()
				|| current.dev !== stat.dev
				|| current.ino !== stat.ino
			) {
				throw new Error('RECOVERY_STORE_UNAVAILABLE');
			}
			return {
				descriptor,
				dev: stat.dev,
				ino: stat.ino,
				path,
				token,
			};
		} catch (error) {
			if (descriptor !== null) {
				closeSync(descriptor);
				descriptor = null;
			}
			if (!hasErrorCode(error, 'EEXIST')) {
				throw error instanceof Error && error.message === 'RECOVERY_STORE_UNAVAILABLE'
					? error
					: new Error('RECOVERY_STORE_UNAVAILABLE');
			}
			tryRecoverStaleDispatchCapacityLockV1(path);
			if (Date.now() >= deadline) throw new Error('RECOVERY_STORE_UNAVAILABLE');
			Atomics.wait(
				DISPATCH_CAPACITY_LOCK_SLEEP_V1,
				0,
				0,
				Math.min(DISPATCH_CAPACITY_LOCK_POLL_MS_V1, Math.max(1, deadline - Date.now())),
			);
		}
	}
}

function releaseDispatchCapacityLockV1(lock: DispatchCapacityLockV1): void {
	closeSync(lock.descriptor);
	try {
		const current = lstatSync(lock.path);
		if (
			current.isFile()
			&& !current.isSymbolicLink()
			&& current.dev === lock.dev
			&& current.ino === lock.ino
		) {
			unlinkSync(lock.path);
		}
	} catch (error) {
		if (!hasErrorCode(error, 'ENOENT')) throw error;
	}
}

function tryRecoverStaleDispatchCapacityLockV1(path: string): void {
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(path);
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return;
		throw new Error('RECOVERY_STORE_UNAVAILABLE');
	}
	if (
		!stat.isFile()
		|| stat.isSymbolicLink()
		|| (typeof process.getuid === 'function' && stat.uid !== process.getuid())
		|| (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
	) {
		throw new Error('RECOVERY_STORE_UNAVAILABLE');
	}
	if (Date.now() - stat.mtimeMs < DISPATCH_CAPACITY_LOCK_STALE_MS_V1) return;
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		throw new Error('RECOVERY_STORE_UNAVAILABLE');
	}
	if (
		!isPlainRecord(value)
		|| value.version !== 1
		|| !Number.isSafeInteger(value.pid)
		|| (value.pid as number) < 1
		|| typeof value.token !== 'string'
		|| value.token.length < 1
		|| typeof value.createdAt !== 'string'
		|| !isFiniteIsoDate(value.createdAt)
		|| isProcessAliveV1(value.pid as number)
	) return;
	const quarantine = `${path}.stale.${process.pid}.${randomUUID()}`;
	try {
		renameSync(path, quarantine);
		const moved = lstatSync(quarantine);
		if (moved.dev !== stat.dev || moved.ino !== stat.ino) {
			throw new Error('RECOVERY_STORE_UNAVAILABLE');
		}
		unlinkSync(quarantine);
	} catch (error) {
		try {
			unlinkSync(quarantine);
		} catch {
			// Another contender may already have recovered the stale lock.
		}
		if (!hasErrorCode(error, 'ENOENT')) throw new Error('RECOVERY_STORE_UNAVAILABLE');
	}
}

function isProcessAliveV1(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !hasErrorCode(error, 'ESRCH');
	}
}

function isProtectedRecoveryRecord(record: StoredMutationPlanV1): boolean {
	return record.applyRequest !== undefined
		|| record.lastOutcome !== undefined
		|| record.terminalResult !== undefined;
}

function recoveryExpiryMs(record: StoredMutationPlanV1): number {
	if (record.recoveryExpiresAt) return Date.parse(record.recoveryExpiresAt);
	return Date.parse(record.createdAt) + MUTATION_RECOVERY_RETENTION_MS_V1;
}

function isFiniteIsoDate(value: string): boolean {
	return Number.isFinite(Date.parse(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasErrorCode(error: unknown, code: string): boolean {
	return !!error && typeof error === 'object' && (error as Record<string, unknown>).code === code;
}
