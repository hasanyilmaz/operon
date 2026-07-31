import { createHash, randomBytes } from 'node:crypto';
import {
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTRACT_LIMITS_V1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import {
	normalizeCanonicalVaultPathForIdentityV1,
} from '../../../src/agent-runtime/transport/vault-path-identity';

export const REQUEST_TOKEN_PATTERN_V1 = /^[A-Za-z0-9_-]{32}$/;
export const REQUEST_FILE_SUFFIX_V1 = '.request.json';
export const REQUEST_ROOT_PREFIX_V1 = 'operon-agent-runtime-';
export const CLI_MAX_CAPTURE_BYTES_V1 = CONTRACT_LIMITS_V1.transportResultBytes;

export type CliBenchmarkSpanSinkV1 = (span: string, durationMs: number) => void;

export function assertLiveTransportPlatformV1(
	platform: NodeJS.Platform = process.platform,
): void {
	if (liveTransportPlatformStatusV1(platform) === 'unsupported') {
		throw new Error('PLATFORM_UNSUPPORTED');
	}
}

export function liveTransportPlatformStatusV1(
	platform: NodeJS.Platform = process.platform,
	environment: NodeJS.ProcessEnv = process.env,
	osRelease: string = release(),
): 'supported' | 'acceptance-required' | 'unsupported' {
	if (platform === 'darwin') return 'supported';
	if (
		platform === 'linux'
		&& !environment['WSL_DISTRO_NAME']
		&& !environment['WSL_INTEROP']
		&& !osRelease.toLowerCase().includes('microsoft')
	) return 'acceptance-required';
	if (platform === 'win32') return 'acceptance-required';
	return 'unsupported';
}

export interface SecureRequestFileV1 {
	token: string;
	path: string;
	bytes: number;
	fileIdentity: {
		dev: number;
		ino: number;
		size: number;
		ctimeMs: number;
	};
}

function currentUid(): number | null {
	return typeof process.getuid === 'function' ? process.getuid() : null;
}

function permissions(mode: number): number {
	return mode & 0o777;
}

export function sha256HexNodeV1(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}

export function canonicalVaultIdentityV1(vaultPath: string): {
	canonicalPath: string;
	sha256: string;
} {
	const canonicalPath = realpathSync(vaultPath);
	return {
		canonicalPath,
		sha256: sha256HexNodeV1(Buffer.from(
			normalizeCanonicalVaultPathForIdentityV1(canonicalPath, process.platform),
			'utf8',
		)),
	};
}

export interface CanonicalVaultFenceV1 {
	canonicalPath: string;
	sha256: string;
	dev: number;
	ino: number;
}

export function createCanonicalVaultFenceV1(vaultPath: string): CanonicalVaultFenceV1 {
	const identity = canonicalVaultIdentityV1(vaultPath);
	const stat = lstatSync(identity.canonicalPath);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('VAULT_NOT_DIRECTORY');
	return {
		canonicalPath: identity.canonicalPath,
		sha256: identity.sha256,
		dev: stat.dev,
		ino: stat.ino,
	};
}

export function assertCanonicalVaultFenceV1(fence: CanonicalVaultFenceV1): void {
	try {
		const stat = lstatSync(fence.canonicalPath);
		if (
			!stat.isDirectory()
			|| stat.isSymbolicLink()
			|| stat.dev !== fence.dev
			|| stat.ino !== fence.ino
			|| realpathSync(fence.canonicalPath) !== fence.canonicalPath
			|| sha256HexNodeV1(Buffer.from(fence.canonicalPath, 'utf8')) !== fence.sha256
		) {
			throw new Error('VAULT_TARGET_CHANGED');
		}
	} catch (error) {
		if (error instanceof Error && error.message === 'VAULT_TARGET_CHANGED') throw error;
		throw new Error('VAULT_TARGET_CHANGED');
	}
}

export function fixedRequestRootV1(): string {
	const uid = currentUid();
	const userSegment = uid === null ? 'uid-unavailable' : `uid-${uid}`;
	return join(tmpdir(), `${REQUEST_ROOT_PREFIX_V1}${userSegment}`);
}

export function createRequestTokenV1(): string {
	return randomBytes(24).toString('base64url');
}

export function validateRequestTokenV1(token: string): string {
	if (!REQUEST_TOKEN_PATTERN_V1.test(token)) throw new Error('INVALID_REQUEST_TOKEN');
	return token;
}

export function requestPathForTokenV1(
	token: string,
	root: string = fixedRequestRootV1(),
): string {
	validateRequestTokenV1(token);
	return join(root, `${token}${REQUEST_FILE_SUFFIX_V1}`);
}

export function ensureSecureRequestRootV1(root: string = fixedRequestRootV1()): string {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const stat = lstatSync(root);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('REQUEST_ROOT_NOT_SECURE');
	const uid = currentUid();
	if (uid !== null && stat.uid !== uid) throw new Error('REQUEST_ROOT_WRONG_OWNER');
	if (permissions(stat.mode) !== 0o700) throw new Error('REQUEST_ROOT_WRONG_MODE');
	return root;
}

export function writeSecureInvocationV1(
	invocation: unknown,
	options: {
		root?: string;
		token?: string;
		benchmarkSpan?: CliBenchmarkSpanSinkV1;
	} = {},
): SecureRequestFileV1 {
	const root = ensureSecureRequestRootV1(options.root);
	const token = validateRequestTokenV1(options.token ?? createRequestTokenV1());
	const targetPath = requestPathForTokenV1(token, root);
	const tempPath = join(root, `.${token}.${randomBytes(8).toString('hex')}.tmp`);
	const serializationStartedAt = performance.now();
	const body = Buffer.from(JSON.stringify(invocation), 'utf8');
	options.benchmarkSpan?.(
		'request-serialization',
		Math.max(0, performance.now() - serializationStartedAt),
	);
	if (body.byteLength > CONTRACT_LIMITS_V1.transportInputBytes) {
		throw new Error('REQUEST_FILE_TOO_LARGE');
	}

	let descriptor: number | null = null;
	let published = false;
	let fileIdentity: SecureRequestFileV1['fileIdentity'] | null = null;
	try {
		const writeStartedAt = performance.now();
		descriptor = openSync(
			tempPath,
			fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
			0o600,
		);
		fchmodSync(descriptor, 0o600);
		writeFileSync(descriptor, body);
		options.benchmarkSpan?.('request-write', Math.max(0, performance.now() - writeStartedAt));
		const fsyncStartedAt = performance.now();
		fsyncSync(descriptor);
		options.benchmarkSpan?.('request-fsync', Math.max(0, performance.now() - fsyncStartedAt));
		const writtenStat = fstatSync(descriptor);
		const writtenFileIdentity = captureFileIdentityV1(writtenStat);

		const linkStartedAt = performance.now();
		linkSync(tempPath, targetPath);
		published = true;
		unlinkSync(tempPath);
		options.benchmarkSpan?.('request-link', Math.max(0, performance.now() - linkStartedAt));
		const verificationStartedAt = performance.now();
		const targetStat = assertSecureRequestFileV1(targetPath);
		if (
			targetStat.dev !== writtenFileIdentity.dev
			|| targetStat.ino !== writtenFileIdentity.ino
		) {
			throw new Error('REQUEST_FILE_CHANGED');
		}
		fileIdentity = captureFileIdentityV1(targetStat);
		closeSync(descriptor);
		descriptor = null;
		options.benchmarkSpan?.(
			'request-verification',
			Math.max(0, performance.now() - verificationStartedAt),
		);
		return {
			token,
			path: targetPath,
			bytes: body.byteLength,
			fileIdentity,
		};
	} catch (error) {
		if (descriptor !== null) {
			try {
				closeSync(descriptor);
			} catch {
				// Preserve the original publication error.
			}
		}
		try {
			unlinkSync(tempPath);
		} catch {
			// Temp may already have been removed after publication.
		}
		if (published && fileIdentity) {
			try {
				cleanupSecureInvocationV1(token, { root, fileIdentity });
			} catch {
				// Preserve the original publication error.
			}
		}
		throw error;
	}
}

export function cleanupSecureInvocationV1(
	token: string,
	options: {
		root?: string;
		fileIdentity?: SecureRequestFileV1['fileIdentity'];
	} = {},
): boolean {
	const filePath = requestPathForTokenV1(token, options.root);
	try {
		if (options.fileIdentity) {
			const stat = lstatSync(filePath);
			if (
				stat.isSymbolicLink()
				|| !stat.isFile()
				|| !fileIdentityMatchesV1(options.fileIdentity, stat)
			) return false;
		}
		unlinkSync(filePath);
		return true;
	} catch (error) {
		if (isErrnoCode(error, 'ENOENT')) return false;
		throw error;
	}
}

export function readInputFileSafelyV1(filePath: string): Buffer {
	const pathStat = lstatSync(filePath);
	if (pathStat.isSymbolicLink() || !pathStat.isFile()) throw new Error('INPUT_FILE_NOT_REGULAR');
	if (pathStat.size > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('INPUT_TOO_LARGE');
	const descriptor = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
	try {
		const openedStat = fstatSync(descriptor);
		if (
			!openedStat.isFile()
			|| openedStat.dev !== pathStat.dev
			|| openedStat.ino !== pathStat.ino
		) throw new Error('INPUT_FILE_CHANGED');
		const input = readFileSync(descriptor);
		if (input.byteLength > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('INPUT_TOO_LARGE');
		return input;
	} finally {
		closeSync(descriptor);
	}
}

function assertSecureRequestFileV1(filePath: string) {
	const stat = lstatSync(filePath);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('REQUEST_FILE_NOT_REGULAR');
	const uid = currentUid();
	if (uid !== null && stat.uid !== uid) throw new Error('REQUEST_FILE_WRONG_OWNER');
	if (permissions(stat.mode) !== 0o600) throw new Error('REQUEST_FILE_WRONG_MODE');
	if (stat.size > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('REQUEST_FILE_TOO_LARGE');
	return stat;
}

function captureFileIdentityV1(stat: {
	dev: number;
	ino: number;
	size: number;
	ctimeMs: number;
}): SecureRequestFileV1['fileIdentity'] {
	return {
		dev: stat.dev,
		ino: stat.ino,
		size: stat.size,
		ctimeMs: stat.ctimeMs,
	};
}

function fileIdentityMatchesV1(
	expected: SecureRequestFileV1['fileIdentity'],
	actual: { dev: number; ino: number; size: number; ctimeMs: number },
): boolean {
	return expected.dev === actual.dev
		&& expected.ino === actual.ino
		&& expected.size === actual.size
		&& expected.ctimeMs === actual.ctimeMs;
}

function isErrnoCode(error: unknown, code: string): boolean {
	return error instanceof Error && 'code' in error && error.code === code;
}
