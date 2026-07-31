import { Platform, requireApiVersion, type Plugin } from 'obsidian';
import type { RuntimeTimingSpanV1 } from './runtime/timing-probe';

export const TRANSPORT_PROBE_COMMAND = 'operon:transport-probe';
export const TRANSPORT_PROBE_VERSION = 1;
export const TRANSPORT_PROBE_MAX_INPUT_BYTES = 1024 * 1024;
export const TRANSPORT_PROBE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const TRANSPORT_PROBE_MAX_REQUEST_FILE_BYTES = 2 * 1024 * 1024;

export type TransportProbePhase =
	| 'loading'
	| 'plugin-loaded'
	| 'layout-ready'
	| 'startup-reconciled'
	| 'load-failed'
	| 'unloading';

export type TransportProbeOperation = 'health' | 'digest' | 'delay' | 'generate' | 'timings';
export type TransportProbeInputChannel = 'argv' | 'request-file';

export interface TransportProbeResultV1 {
	probeVersion: 1;
	requestId: string;
	ok: boolean;
	operation: TransportProbeOperation;
	phase: TransportProbePhase;
	vaultIdentity: {
		expectedMatch: boolean | null;
	};
	input: {
		channel: TransportProbeInputChannel;
		bytes: number;
		sha256: string;
	};
	output: {
		bytes: number;
		sha256: string;
	};
	handlerMs: number;
	generatedPayload?: string;
	runtimeTimings?: RuntimeTimingSpanV1[];
	error?: {
		code: string;
		reason: string;
	};
}

type CliDataLike = Record<string, string>;
type CliHandlerLike = (params: CliDataLike) => string | Promise<string>;
type CliFlagsLike = Record<string, {
	value?: string;
	description: string;
	required?: boolean;
}>;

type RegisterCliHandlerLike = (
	command: string,
	description: string,
	flags: CliFlagsLike | null,
	handler: CliHandlerLike,
) => void;

interface ProbeFileStat {
	dev: number;
	ino: number;
	mode: number;
	size: number;
	uid: number;
	isDirectory(): boolean;
	isFile(): boolean;
	isSymbolicLink(): boolean;
}

interface ProbeFileHandle {
	stat(): Promise<ProbeFileStat>;
	readFile(): Promise<Uint8Array>;
	close(): Promise<void>;
}

interface DesktopNodeApi {
	createHash(value: Uint8Array): string;
	fileOpenReadOnlyNoFollow: number;
	lstat(path: string): Promise<ProbeFileStat>;
	mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
	open(path: string, flags: number): Promise<ProbeFileHandle>;
	realpath(path: string): Promise<string>;
	unlink(path: string): Promise<void>;
	tmpdir(): string;
	dirname(path: string): string;
	join(...parts: string[]): string;
	resolve(...parts: string[]): string;
	getuid(): number | null;
	decodeBase64url(value: string): Uint8Array;
	encodeBase64url(value: Uint8Array): string;
	utf8(value: string): Uint8Array;
	decodeUtf8(value: Uint8Array): string;
	delay(milliseconds: number): Promise<void>;
}

export interface TransportProbeOptionsV1 {
	drainRuntimeTimings?: () => RuntimeTimingSpanV1[];
}

const PHASE_RANK: Record<Exclude<TransportProbePhase, 'load-failed' | 'unloading'>, number> = {
	'loading': 0,
	'plugin-loaded': 1,
	'layout-ready': 2,
	'startup-reconciled': 3,
};
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const REQUEST_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[a-zA-Z0-9_-]*$/u;

let currentPhase: TransportProbePhase = 'loading';

export function resetTransportProbePhase(): void {
	currentPhase = 'loading';
}

export function setTransportProbePhase(nextPhase: TransportProbePhase): void {
	if (nextPhase === 'load-failed' || nextPhase === 'unloading') {
		currentPhase = nextPhase;
		return;
	}
	if (currentPhase === 'load-failed' || currentPhase === 'unloading') return;
	if (PHASE_RANK[nextPhase] > PHASE_RANK[currentPhase]) currentPhase = nextPhase;
}

export function getTransportProbePhase(): TransportProbePhase {
	return currentPhase;
}

export function registerTransportProbe(
	plugin: Plugin,
	options: TransportProbeOptionsV1 = {},
): boolean {
	if (!Platform.isDesktopApp || !requireApiVersion('1.12.2')) return false;
	const methodName = ['register', 'Cli', 'Handler'].join('');
	const registerCliHandler = (plugin as unknown as Record<string, unknown>)[methodName];
	if (typeof registerCliHandler !== 'function') return false;

	resetTransportProbePhase();
	(registerCliHandler as RegisterCliHandlerLike).call(
		plugin,
		TRANSPORT_PROBE_COMMAND,
		'Development-only Operon transport feasibility probe.',
		{
			operation: {
				value: '<health|digest|delay|generate|timings>',
				description: 'Synthetic probe operation.',
			},
			requestId: {
				value: '<request-id>',
				description: 'Caller-generated correlation identifier.',
			},
			probeVersion: {
				value: '<version>',
				description: 'Development probe protocol version.',
			},
			channel: {
				value: '<argv|request-file>',
				description: 'Synthetic input transport channel.',
			},
			payload: {
				value: '<base64url>',
				description: 'Non-sensitive synthetic argv payload.',
			},
			inputBytes: {
				value: '<bytes>',
				description: 'Expected decoded argv payload byte count.',
			},
			inputSha256: {
				value: '<sha256>',
				description: 'Expected decoded argv payload SHA-256.',
			},
			requestToken: {
				value: '<token>',
				description: 'Token for an owner-only one-shot request file.',
			},
			expectedVaultSha256: {
				value: '<sha256>',
				description: 'SHA-256 of the caller canonical vault real path.',
			},
			delayMs: {
				value: '<milliseconds>',
				description: 'Bounded synthetic async delay.',
			},
			outputBytes: {
				value: '<bytes>',
				description: 'Bounded generated response payload size.',
			},
		},
		(params: CliDataLike) => handleTransportProbe(plugin, params, options),
	);
	return true;
}

export async function handleTransportProbe(
	plugin: Pick<Plugin, 'app'>,
	params: CliDataLike,
	options: TransportProbeOptionsV1 = {},
): Promise<string> {
	const startedAt = performance.now();
	const channel = params['channel'] === 'request-file' ? 'request-file' : 'argv';
	let stage = 'node-api';
	let input: Uint8Array = new Uint8Array(0);
	let nodeApi: DesktopNodeApi | null = null;
	let request: NormalizedProbeRequest = {
		requestId: readBoundedString(params['requestId'], 128) || 'missing',
		operation: 'health',
		expectedVaultSha256: null,
		payload: new Uint8Array(0),
		outputBytes: 0,
		delayMs: 0,
	};

	try {
		nodeApi = await loadDesktopNodeApi();
		stage = 'request';
		request = channel === 'request-file'
			? await readAndConsumeRequestFile(nodeApi, params['requestToken'])
			: readArgvRequest(nodeApi, params);
		const operation = request.operation;
		input = request.payload;

		stage = 'vault-identity';
		const expectedMatch = await compareVaultIdentity(nodeApi, plugin, request.expectedVaultSha256);
		if (expectedMatch === false) throw new ProbeError('VAULT_MISMATCH', 'canonical-realpath-hash-mismatch');

		stage = 'operation';
		const delayMs = request.delayMs;
		if (operation === 'delay' && delayMs > 0) {
			await nodeApi.delay(delayMs);
		}

		const runtimeTimings = operation === 'timings'
			? (options.drainRuntimeTimings?.() ?? [])
			: undefined;
		const timingPayload = runtimeTimings === undefined
			? new Uint8Array(0)
			: nodeApi.utf8(JSON.stringify(runtimeTimings));
		if (timingPayload.byteLength > TRANSPORT_PROBE_MAX_OUTPUT_BYTES) {
			throw new ProbeError('PAYLOAD_TOO_LARGE', 'timing-output-exceeds-probe-limit');
		}
		const outputBytes = operation === 'generate' ? request.outputBytes : 0;
		const generatedPayload = outputBytes > 0 ? 'x'.repeat(outputBytes) : '';
		const generatedPayloadBuffer = nodeApi.utf8(generatedPayload);
		const outputPayload = runtimeTimings === undefined
			? generatedPayloadBuffer
			: timingPayload;
		stage = 'result';
		const result: TransportProbeResultV1 = {
			probeVersion: TRANSPORT_PROBE_VERSION,
			requestId: request.requestId,
			ok: true,
			operation,
			phase: getTransportProbePhase(),
			vaultIdentity: { expectedMatch },
			input: {
				channel,
				bytes: input.byteLength,
				sha256: nodeApi.createHash(input),
			},
			output: {
				bytes: outputPayload.byteLength,
				sha256: outputPayload.byteLength > 0 ? nodeApi.createHash(outputPayload) : EMPTY_SHA256,
			},
			handlerMs: elapsedMilliseconds(startedAt),
			...(generatedPayload ? { generatedPayload: nodeApi.encodeBase64url(generatedPayloadBuffer) } : {}),
			...(runtimeTimings === undefined ? {} : { runtimeTimings }),
		};
		return JSON.stringify(result);
	} catch (error) {
		const probeError = error instanceof ProbeError
			? error
			: new ProbeError('PROBE_FAILED', `unexpected-${stage}-error`);
		const result: TransportProbeResultV1 = {
			probeVersion: TRANSPORT_PROBE_VERSION,
			requestId: request.requestId,
			ok: false,
			operation: request.operation,
			phase: getTransportProbePhase(),
			vaultIdentity: { expectedMatch: probeError.code === 'VAULT_MISMATCH' ? false : null },
			input: {
				channel,
				bytes: input.byteLength,
				sha256: input.byteLength > 0 && nodeApi ? nodeApi.createHash(input) : EMPTY_SHA256,
			},
			output: {
				bytes: 0,
				sha256: EMPTY_SHA256,
			},
			handlerMs: elapsedMilliseconds(startedAt),
			error: {
				code: probeError.code,
				reason: probeError.reason,
			},
		};
		return JSON.stringify(result);
	}
}

async function compareVaultIdentity(
	nodeApi: DesktopNodeApi,
	plugin: Pick<Plugin, 'app'>,
	expectedValue: string | null,
): Promise<boolean | null> {
	if (expectedValue === null) return null;
	const expected = expectedValue.toLowerCase();
	if (!SHA256_PATTERN.test(expected)) throw new ProbeError('INVALID_REQUEST', 'invalid-vault-sha256');
	const adapter = plugin.app.vault.adapter as unknown as { getFullPath?: (normalizedPath: string) => string };
	if (typeof adapter.getFullPath !== 'function') {
		throw new ProbeError('PROBE_UNAVAILABLE', 'filesystem-adapter-required');
	}
	const adapterPath = adapter.getFullPath('');
	const canonicalVaultPath = await nodeApi.realpath(adapterPath);
	return nodeApi.createHash(nodeApi.utf8(canonicalVaultPath)) === expected;
}

interface NormalizedProbeRequest {
	requestId: string;
	operation: TransportProbeOperation;
	expectedVaultSha256: string | null;
	payload: Uint8Array;
	outputBytes: number;
	delayMs: number;
}

function readArgvRequest(nodeApi: DesktopNodeApi, params: CliDataLike): NormalizedProbeRequest {
	const probeVersion = params['probeVersion'];
	if (probeVersion !== undefined && probeVersion !== String(TRANSPORT_PROBE_VERSION)) {
		throw new ProbeError('INVALID_REQUEST', 'unsupported-probe-version');
	}
	const requestId = readBoundedString(params['requestId'], 128) || 'missing';
	const operation = readOperation(params['operation']);
	const payload = readArgvPayload(nodeApi, params['payload']);
	validateInputDigestFlags(nodeApi, params, payload);
	return {
		requestId,
		operation,
		expectedVaultSha256: readOptionalVaultSha256(params['expectedVaultSha256']),
		payload,
		outputBytes: readBoundedInteger(params['outputBytes'], 0, TRANSPORT_PROBE_MAX_OUTPUT_BYTES, 0),
		delayMs: readBoundedInteger(params['delayMs'], 0, 5_000, 0),
	};
}

function readArgvPayload(nodeApi: DesktopNodeApi, value: string | undefined): Uint8Array {
	if (value === undefined) return new Uint8Array(0);
	if (!BASE64URL_PATTERN.test(value)) {
		throw new ProbeError('INVALID_REQUEST', 'invalid-base64url-payload');
	}
	const decoded = nodeApi.decodeBase64url(value);
	if (decoded.byteLength > TRANSPORT_PROBE_MAX_INPUT_BYTES) {
		throw new ProbeError('PAYLOAD_TOO_LARGE', 'input-exceeds-probe-limit');
	}
	return decoded;
}

async function readAndConsumeRequestFile(
	nodeApi: DesktopNodeApi,
	tokenValue: string | undefined,
): Promise<NormalizedProbeRequest> {
	const token = tokenValue ?? '';
	if (!REQUEST_TOKEN_PATTERN.test(token)) throw new ProbeError('INVALID_REQUEST', 'invalid-request-token');

	const requestRoot = getTransportProbeRequestRoot(nodeApi);
	await nodeApi.mkdir(requestRoot, { recursive: true, mode: 0o700 });
	const rootStat = await nodeApi.lstat(requestRoot);
	if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
		throw new ProbeError('REQUEST_FILE_INVALID', 'request-root-not-secure');
	}
	const currentUid = nodeApi.getuid();
	if (currentUid !== null && rootStat.uid !== currentUid) {
		throw new ProbeError('REQUEST_FILE_INVALID', 'request-root-owner-mismatch');
	}
	if ((rootStat.mode & 0o777) !== 0o700) {
		throw new ProbeError('REQUEST_FILE_INVALID', 'request-root-permissions-not-owner-only');
	}

	const rootPath = await nodeApi.realpath(requestRoot);
	const requestPath = nodeApi.resolve(rootPath, `${token}.request.json`);
	if (nodeApi.dirname(requestPath) !== rootPath) throw new ProbeError('INVALID_REQUEST', 'request-path-escape');

	let handle: ProbeFileHandle | null = null;
	let consumedIdentity: { dev: number; ino: number } | null = null;
	try {
		const pathStat = await nodeApi.lstat(requestPath);
		if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
			throw new ProbeError('REQUEST_FILE_INVALID', 'request-not-regular-file');
		}
		handle = await nodeApi.open(requestPath, nodeApi.fileOpenReadOnlyNoFollow);
		const requestStat = await handle.stat();
		if (!requestStat.isFile()) throw new ProbeError('REQUEST_FILE_INVALID', 'request-not-regular-file');
		if (currentUid !== null && requestStat.uid !== currentUid) {
			throw new ProbeError('REQUEST_FILE_INVALID', 'request-owner-mismatch');
		}
		if ((requestStat.mode & 0o777) !== 0o600) {
			throw new ProbeError('REQUEST_FILE_INVALID', 'request-permissions-not-owner-only');
		}
		if (requestStat.dev !== pathStat.dev || requestStat.ino !== pathStat.ino) {
			throw new ProbeError('REQUEST_FILE_INVALID', 'request-file-changed');
		}
		consumedIdentity = { dev: requestStat.dev, ino: requestStat.ino };
		if (requestStat.size > TRANSPORT_PROBE_MAX_REQUEST_FILE_BYTES) {
			throw new ProbeError('PAYLOAD_TOO_LARGE', 'request-file-exceeds-probe-limit');
		}
		const canonicalRequestPath = await nodeApi.realpath(requestPath);
		if (nodeApi.dirname(canonicalRequestPath) !== rootPath) {
			throw new ProbeError('REQUEST_FILE_INVALID', 'request-realpath-escape');
		}
		const requestBytes = await handle.readFile();
		return parseRequestFile(nodeApi, requestBytes);
	} catch (error) {
		if (error instanceof ProbeError) throw error;
		throw new ProbeError('REQUEST_FILE_INVALID', 'request-file-unavailable');
	} finally {
		await handle?.close().catch(() => undefined);
		if (consumedIdentity) {
			const currentStat = await nodeApi.lstat(requestPath).catch(() => null);
			if (
				currentStat
				&& !currentStat.isSymbolicLink()
				&& currentStat.isFile()
				&& currentStat.dev === consumedIdentity.dev
				&& currentStat.ino === consumedIdentity.ino
			) {
				await nodeApi.unlink(requestPath).catch(() => undefined);
			}
		}
	}
}

function parseRequestFile(nodeApi: DesktopNodeApi, value: Uint8Array): NormalizedProbeRequest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(nodeApi.decodeUtf8(value)) as unknown;
	} catch {
		throw new ProbeError('INVALID_REQUEST', 'request-file-json-invalid');
	}
	if (!isRecord(parsed) || parsed['probeVersion'] !== TRANSPORT_PROBE_VERSION) {
		throw new ProbeError('INVALID_REQUEST', 'request-file-version-unsupported');
	}
	const requestId = typeof parsed['requestId'] === 'string'
		? parsed['requestId'].trim().slice(0, 128)
		: '';
	const operation = readOperation(typeof parsed['operation'] === 'string' ? parsed['operation'] : undefined);
	const payloadBase64 = typeof parsed['payloadBase64'] === 'string' ? parsed['payloadBase64'] : '';
	const payload = readArgvPayload(nodeApi, payloadBase64);
	return {
		requestId: requestId || 'missing',
		operation,
		expectedVaultSha256: readOptionalVaultSha256(
			typeof parsed['expectedVaultSha256'] === 'string' ? parsed['expectedVaultSha256'] : undefined,
		),
		payload,
		outputBytes: readJsonBoundedInteger(
			parsed['outputBytes'],
			0,
			TRANSPORT_PROBE_MAX_OUTPUT_BYTES,
			0,
		),
		delayMs: readJsonBoundedInteger(parsed['delayMs'], 0, 5_000, 0),
	};
}

function readOperation(value: string | undefined): TransportProbeOperation {
	if (
		value === 'health'
		|| value === 'digest'
		|| value === 'delay'
		|| value === 'generate'
		|| value === 'timings'
	) return value;
	throw new ProbeError('INVALID_REQUEST', 'unsupported-operation');
}

function readBoundedString(value: string | undefined, maxLength: number): string {
	if (value === undefined || value === 'true') return '';
	return value.trim().slice(0, maxLength);
}

function readBoundedInteger(
	value: string | undefined,
	minimum: number,
	maximum: number,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	if (value === 'true' || !/^\d+$/u.test(value)) throw new ProbeError('INVALID_REQUEST', 'invalid-integer-flag');
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new ProbeError('INVALID_REQUEST', 'integer-flag-out-of-range');
	}
	return parsed;
}

function readJsonBoundedInteger(
	value: unknown,
	minimum: number,
	maximum: number,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new ProbeError('INVALID_REQUEST', 'integer-flag-out-of-range');
	}
	return value as number;
}

function readOptionalVaultSha256(value: string | undefined): string | null {
	if (value === undefined || value === 'true' || value === '') return null;
	if (!SHA256_PATTERN.test(value.toLowerCase())) {
		throw new ProbeError('INVALID_REQUEST', 'invalid-vault-sha256');
	}
	return value.toLowerCase();
}

function validateInputDigestFlags(
	nodeApi: DesktopNodeApi,
	params: CliDataLike,
	payload: Uint8Array,
): void {
	const expectedBytes = params['inputBytes'];
	if (expectedBytes !== undefined) {
		const bytes = readBoundedInteger(expectedBytes, 0, TRANSPORT_PROBE_MAX_INPUT_BYTES, 0);
		if (bytes !== payload.byteLength) throw new ProbeError('INVALID_REQUEST', 'input-byte-count-mismatch');
	}
	const expectedSha256 = params['inputSha256'];
	if (expectedSha256 !== undefined && expectedSha256 !== 'true') {
		if (!SHA256_PATTERN.test(expectedSha256) || nodeApi.createHash(payload) !== expectedSha256) {
			throw new ProbeError('INVALID_REQUEST', 'input-sha256-mismatch');
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTransportProbeRequestRoot(nodeApi: DesktopNodeApi): string {
	const uid = nodeApi.getuid();
	return nodeApi.join(
		nodeApi.tmpdir(),
		`operon-agent-runtime-${uid === null ? 'uid-unavailable' : `uid-${uid}`}`,
	);
}

async function loadDesktopNodeApi(): Promise<DesktopNodeApi> {
	if (Platform.isDesktop) {
		const runtimeRequire = (window as unknown as {
			require?: (moduleId: string) => unknown;
		}).require;
		if (typeof runtimeRequire !== 'function') {
			throw new ProbeError('PROBE_UNAVAILABLE', 'desktop-require-unavailable');
		}
		const cryptoModule = runtimeRequire('node:crypto') as {
			createHash(algorithm: string): {
				update(value: Uint8Array): { digest(encoding: 'hex'): string };
			};
		};
		const fileSystemModule = runtimeRequire('node:fs') as {
			constants: { O_RDONLY: number; O_NOFOLLOW?: number };
		};
		const fileSystemPromisesModule = runtimeRequire('node:fs/promises') as {
			lstat(path: string): Promise<ProbeFileStat>;
			mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
			open(path: string, flags: number): Promise<ProbeFileHandle>;
			realpath(path: string): Promise<string>;
			unlink(path: string): Promise<void>;
		};
		const operatingSystemModule = runtimeRequire('node:os') as { tmpdir(): string };
		const pathModule = runtimeRequire('node:path') as {
			dirname(path: string): string;
			join(...parts: string[]): string;
			resolve(...parts: string[]): string;
		};
		const bufferModule = runtimeRequire('node:buffer') as {
			Buffer: {
				from(value: string | Uint8Array, encoding?: 'base64url' | 'utf8'): Uint8Array & {
					toString(encoding: 'base64url' | 'utf8'): string;
				};
			};
		};
		const processModule = runtimeRequire('node:process') as { getuid?: () => number };
		const runtimeGetuid = processModule.getuid;
		const getuid = typeof runtimeGetuid === 'function'
			? () => runtimeGetuid()
			: () => null;
		return {
			createHash: value => cryptoModule.createHash('sha256').update(value).digest('hex'),
			fileOpenReadOnlyNoFollow: fileSystemModule.constants.O_RDONLY
				| (fileSystemModule.constants.O_NOFOLLOW ?? 0),
			lstat: path => fileSystemPromisesModule.lstat(path),
			mkdir: (path, options) => fileSystemPromisesModule.mkdir(path, options),
			open: async (path, flags) => await fileSystemPromisesModule.open(path, flags),
			realpath: path => fileSystemPromisesModule.realpath(path),
			unlink: path => fileSystemPromisesModule.unlink(path),
			tmpdir: () => operatingSystemModule.tmpdir(),
			dirname: path => pathModule.dirname(path),
			join: (...parts) => pathModule.join(...parts),
			resolve: (...parts) => pathModule.resolve(...parts),
			getuid,
			decodeBase64url: value => bufferModule.Buffer.from(value, 'base64url'),
			encodeBase64url: value => bufferModule.Buffer.from(value).toString('base64url'),
			utf8: value => bufferModule.Buffer.from(value, 'utf8'),
			decodeUtf8: value => bufferModule.Buffer.from(value).toString('utf8'),
			delay: milliseconds => new Promise<void>(resolveDelay => {
				window.setTimeout(resolveDelay, milliseconds);
			}),
		};
	}
	throw new ProbeError('PROBE_UNAVAILABLE', 'desktop-runtime-required');
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.round((performance.now() - startedAt) * 1_000) / 1_000;
}

class ProbeError extends Error {
	constructor(
		readonly code: string,
		readonly reason: string,
	) {
		super(`${code}: ${reason}`);
	}
}
