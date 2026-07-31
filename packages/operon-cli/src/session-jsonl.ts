import {
	CONTRACT_LIMITS_V1,
	structuredErrorV1,
} from '../../../src/agent-runtime/contracts/v1';
import path from 'node:path';
import {
	type PublicCommandPortsV1,
	runPublicCommandLineV1,
} from './command-line';
import {
	type PersistentReadTransportEvidenceV1,
	type PersistentReadTransportV1,
} from './persistent-read-client';
import {
	OPERON_CLI_PERSISTENT_READ_ENABLED_V1,
	createPersistentReadTransportV1,
} from './persistent-read-feature';
import { getOrCreateOperonCliClientIdV1 } from './client-identity';
import {
	type ResolvedVaultCommandScopeV1,
	createResolvedVaultCommandScopeV1,
	loadOperonCliConfigV1,
	operonCliConfigRootV1,
	resolveVaultV1,
} from './config';
import { canonicalVaultIdentityV1 } from './protocol';
import {
	createSessionFrameClockV1,
	type JsonlSessionFrameTimingBatchV1,
	type JsonlSessionFrameTimingV1,
	type SessionFrameClockV1,
} from './session-frame-timing';

const SESSION_EXIT_USAGE = 2;
const SESSION_EXIT_INTERNAL = 70;
const SESSION_EXIT_RECOVERY_REQUIRED = 5;
const SESSION_EXIT_ABORTED = 130;
const SESSION_ID_MAX_BYTES = 256;
const SESSION_ARGV_MAX_ITEMS = 128;
const SESSION_ARG_MAX_BYTES = 16 * 1024;
const SESSION_ARGV_MAX_BYTES = 64 * 1024;
const SESSION_FRAME_OVERHEAD_BYTES = 64 * 1024;
const SESSION_JSON_STRING_EXPANSION = 6;
const SESSION_READ_GROUP_MIN = 2;
const SESSION_READ_GROUP_MAX = 8;

export const SESSION_JSONL_LIMITS_V1 = Object.freeze({
	lineBytes:
		CONTRACT_LIMITS_V1.transportInputBytes * SESSION_JSON_STRING_EXPANSION
		+ SESSION_FRAME_OVERHEAD_BYTES,
	inputBytes: CONTRACT_LIMITS_V1.transportInputBytes,
	argvItems: SESSION_ARGV_MAX_ITEMS,
	argumentBytes: SESSION_ARG_MAX_BYTES,
	argvBytes: SESSION_ARGV_MAX_BYTES,
});

export type SessionRequestIdV1 = string | number;

export interface SessionRequestV1 {
	id: SessionRequestIdV1;
	argv: string[];
	input?: unknown;
}

export interface SessionReadGroupV1 {
	id: SessionRequestIdV1;
	reads: SessionRequestV1[];
	target: ResolvedVaultCommandScopeV1;
}

interface SessionLimitsV1 {
	lineBytes: number;
	inputBytes: number;
	argvItems: number;
	argumentBytes: number;
	argvBytes: number;
}

type SessionInputV1 = AsyncIterable<Uint8Array | string>;

type SessionCommandPortsV1 = Omit<PublicCommandPortsV1, 'input' | 'interactive' | 'signal'> & {
	/** Internal hint: JSONL serializes the envelope and never consumes human text. */
	outputMode?: 'envelope-only';
};

interface SessionOutputV1 {
	write(chunk: string): boolean;
	once(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void): unknown;
	removeListener(event: 'drain' | 'close' | 'error', listener: (error?: Error) => void): unknown;
}

export interface JsonlSessionOptionsV1 {
	input: SessionInputV1;
	output: SessionOutputV1;
	commandPorts?: SessionCommandPortsV1;
	runCommand?: typeof runPublicCommandLineV1;
	signal?: AbortSignal;
	limits?: Partial<SessionLimitsV1>;
	/** Benchmark-only full-frame timing sink; never serialized to session output. */
	frameTiming?: (batch: JsonlSessionFrameTimingBatchV1) => void | Promise<void>;
	/** Benchmark-only selected transport evidence; never serialized to session output. */
	persistentTransportEvidence?: (evidence: PersistentReadTransportEvidenceV1) => void;
}

export type { JsonlSessionFrameTimingBatchV1, JsonlSessionFrameTimingV1 };

export function isJsonlSessionArgsV1(argv: readonly string[]): boolean {
	return argv.length === 2 && argv[0] === 'session' && argv[1] === '--jsonl';
}

export async function runJsonlSessionV1(options: JsonlSessionOptionsV1): Promise<number> {
	const limits = normalizeLimits(options.limits);
	const runCommand = options.runCommand ?? runPublicCommandLineV1;
	let pending = Buffer.alloc(0);
	let discardingOversizedLine = false;
	const frameClock = createSessionFrameClockV1(options);
	const persistentDisabled = !OPERON_CLI_PERSISTENT_READ_ENABLED_V1
		|| process.env.OPERON_CLI_STAGE51_DISABLE_PERSISTENT === '1';
	const ownsPersistentTransport = !persistentDisabled
		&& !options.commandPorts?._persistentReadTransport;
	const persistentReadTransport = persistentDisabled
		? undefined
		: options.commandPorts?._persistentReadTransport
			?? createPersistentReadTransportV1(options.persistentTransportEvidence);
	if (options.signal?.aborted) return SESSION_EXIT_ABORTED;
	try {
		for await (const sourceChunk of options.input) {
			if (options.signal?.aborted) return SESSION_EXIT_ABORTED;
			const chunk = typeof sourceChunk === 'string'
				? Buffer.from(sourceChunk, 'utf8')
				: Buffer.from(sourceChunk);
			let offset = 0;
			while (offset < chunk.byteLength) {
				const lineEnd = chunk.indexOf(0x0a, offset);
				const segmentEnd = lineEnd < 0 ? chunk.byteLength : lineEnd;
				const segment = chunk.subarray(offset, segmentEnd);
				if (!discardingOversizedLine) {
					if (pending.byteLength + segment.byteLength > limits.lineBytes) {
						pending = Buffer.alloc(0);
						discardingOversizedLine = true;
					} else {
						pending = pending.byteLength === 0
							? Buffer.from(segment)
							: Buffer.concat([pending, segment]);
					}
				}
				if (lineEnd < 0) break;
				if (discardingOversizedLine) {
					await writeSessionResponse(options.output, sessionError(
						null,
						SESSION_EXIT_USAGE,
						'session-line-too-large',
						'The JSONL session frame exceeds the byte limit.',
					), options.signal);
					discardingOversizedLine = false;
				} else {
					if (options.signal?.aborted) return SESSION_EXIT_ABORTED;
					const submittedMs = frameClock.submit();
					await processSessionLine(
						pending,
						options,
						runCommand,
						limits,
						submittedMs,
						frameClock,
						persistentReadTransport,
					);
					pending = Buffer.alloc(0);
				}
				offset = lineEnd + 1;
				if (options.signal?.aborted) return SESSION_EXIT_ABORTED;
			}
		}
		if (options.signal?.aborted) return SESSION_EXIT_ABORTED;
		if (discardingOversizedLine) {
			await writeSessionResponse(options.output, sessionError(
				null,
				SESSION_EXIT_USAGE,
				'session-line-too-large',
				'The JSONL session frame exceeds the byte limit.',
			), options.signal);
		} else if (pending.byteLength > 0) {
			if (options.signal?.aborted) return SESSION_EXIT_ABORTED;
			const submittedMs = frameClock.submit();
			await processSessionLine(
				pending,
				options,
				runCommand,
				limits,
				submittedMs,
				frameClock,
				persistentReadTransport,
			);
		}
		return 0;
	} catch (error) {
		if (error instanceof SessionPostDispatchInterruptedError) {
			return SESSION_EXIT_RECOVERY_REQUIRED;
		}
		return options.signal?.aborted ? SESSION_EXIT_ABORTED : SESSION_EXIT_INTERNAL;
	} finally {
		if (ownsPersistentTransport) persistentReadTransport?.close();
		try {
			await frameClock.flush();
		} catch {
			// Benchmark-only telemetry must never change the public session outcome.
		}
	}
}

async function processSessionLine(
	rawLine: Buffer,
	options: JsonlSessionOptionsV1,
	runCommand: typeof runPublicCommandLineV1,
	limits: SessionLimitsV1,
	submittedMs: number,
	frameClock: SessionFrameClockV1,
	persistentReadTransport: PersistentReadTransportV1 | undefined,
): Promise<void> {
	const timingFrame = frameClock.begin(submittedMs);
	let timingId: SessionRequestIdV1 | null = null;
	const writeResponse = async (response: Record<string, unknown>): Promise<void> => {
		await writeSessionResponse(options.output, response, options.signal);
		frameClock.complete(
			timingFrame,
			timingId,
			persistentReadTransport?.consumeLastEvidence() ?? 'one-shot',
		);
	};
	if (options.signal?.aborted) throw new SessionAbortedError();
	const line = rawLine.at(-1) === 0x0d ? rawLine.subarray(0, -1) : rawLine;
	let requestValue: unknown;
	try {
		requestValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
	} catch {
		await writeResponse(sessionError(
			null,
			SESSION_EXIT_USAGE,
			'session-frame-invalid',
			'The JSONL session frame is not valid UTF-8 JSON.',
		));
		return;
	}
	let request: SessionRequestV1;
	let input: Buffer | undefined;
	try {
		if (isPlainRecord(requestValue) && hasOwn(requestValue, 'reads')) {
			const group = decodeSessionReadGroup(requestValue, limits, options);
			timingId = group.id;
			if (!persistentReadTransport) throw new Error('session-read-group-persistent-required');
			persistentReadTransport.beginBatch(group.reads.length);
			const responses = group.reads.map(read => (
				executeSessionRequest(
					read,
					options,
					runCommand,
					limits,
					persistentReadTransport,
					group.target,
				)
			));
			await writeOrderedReadGroupResponses(responses, options.output, options.signal);
			frameClock.complete(
				timingFrame,
				timingId,
				persistentReadTransport.consumeLastEvidence() ?? 'one-shot',
			);
			return;
		}
		request = decodeSessionRequest(requestValue, limits);
		timingId = request.id;
		input = encodeSessionInput(request, limits);
	} catch (error) {
		const id = readRequestId(requestValue);
		timingId = id;
		await writeResponse(sessionError(
			id,
			SESSION_EXIT_USAGE,
			error instanceof Error ? error.message : 'session-frame-invalid',
			'The JSONL session request is invalid.',
		));
		return;
	}
	if (options.signal?.aborted) throw new SessionAbortedError();
	let outcome: Awaited<ReturnType<typeof runPublicCommandLineV1>>;
	try {
		const commandPorts: PublicCommandPortsV1 & { outputMode: 'envelope-only' } = {
			...options.commandPorts,
			...(persistentReadTransport
				? { _persistentReadTransport: persistentReadTransport }
				: {}),
			outputMode: 'envelope-only',
			...(input ? { input } : {}),
			...(options.signal ? { signal: options.signal } : {}),
		};
		outcome = await runCommand(request.argv, commandPorts);
	} catch {
		const planRef = uncertainApplyPlanRef(request.argv);
		await writeResponse(
			planRef
				? uncertainApplyResponse(request.id, planRef)
				: sessionError(
					request.id,
					SESSION_EXIT_INTERNAL,
					'session-command-failed',
					'The Operon command failed unexpectedly.',
				),
		);
		return;
	}
	if (outcome._recoveryPlanRef) {
		const response = uncertainApplyResponse(request.id, outcome._recoveryPlanRef);
		if (options.signal?.aborted) {
			// The apply has crossed the dispatch boundary. Honor output
			// backpressure for one bounded recovery frame while shutting down.
			await writePostDispatchRecoveryResponse(options.output, response)
				.catch(() => undefined);
			throw new SessionPostDispatchInterruptedError();
		}
		await writeResponse(response);
		return;
	}
	await writeResponse({
		id: request.id,
		exitCode: outcome.exitCode,
		result: outcome.envelope,
	});
}

async function executeSessionRequest(
	request: SessionRequestV1,
	options: JsonlSessionOptionsV1,
	runCommand: typeof runPublicCommandLineV1,
	limits: SessionLimitsV1,
	persistentReadTransport: PersistentReadTransportV1,
	target: ResolvedVaultCommandScopeV1,
): Promise<Record<string, unknown>> {
	const input = encodeSessionInput(request, limits);
	try {
		const outcome = await runCommand(request.argv, {
			...options.commandPorts,
			_resolvedTarget: target,
			_persistentReadTransport: persistentReadTransport,
			outputMode: 'envelope-only',
			...(input ? { input } : {}),
			...(options.signal ? { signal: options.signal } : {}),
		});
		if (outcome._recoveryPlanRef) {
			return uncertainApplyResponse(request.id, outcome._recoveryPlanRef);
		}
		return { id: request.id, exitCode: outcome.exitCode, result: outcome.envelope };
	} catch {
		return sessionError(
			request.id,
			SESSION_EXIT_INTERNAL,
			'session-command-failed',
			'The Operon command failed unexpectedly.',
		);
	}
}

function uncertainApplyResponse(
	id: SessionRequestIdV1,
	planRef: string,
): Record<string, unknown> {
	return {
		id,
		exitCode: 5,
		error: structuredErrorV1(
			'outcome-unknown',
			'Apply may have started. Recover only the same stored plan reference.',
			{
				retryable: false,
				action: 'recover-same-plan',
				details: { reasonCode: 'session-apply-outcome-unknown' },
			},
		),
		recovery: {
			required: true,
			planRef,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
		},
	};
}

function decodeSessionRequest(value: unknown, limits: SessionLimitsV1): SessionRequestV1 {
	if (!isPlainRecord(value)) throw new Error('session-frame-invalid');
	const keys = Object.keys(value);
	if (keys.some(key => !['id', 'argv', 'input'].includes(key))) {
		throw new Error('session-frame-invalid');
	}
	const id = readRequestId(value);
	if (id === null) throw new Error('session-id-invalid');
	if (!Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > limits.argvItems) {
		throw new Error('session-argv-invalid');
	}
	const argv: string[] = [];
	let argvBytes = 0;
	for (const argument of value.argv) {
		if (typeof argument !== 'string') throw new Error('session-argv-invalid');
		const bytes = Buffer.byteLength(argument, 'utf8');
		if (bytes > limits.argumentBytes) throw new Error('session-argument-too-large');
		argvBytes += bytes;
		if (argvBytes > limits.argvBytes) throw new Error('session-argv-too-large');
		argv.push(argument);
	}
	if (argv[0] === 'session') throw new Error('session-recursion-disabled');
	const inputFlagIndexes = argv
		.map((argument, index) => argument === '--input' ? index : -1)
		.filter(index => index >= 0);
	if (inputFlagIndexes.length > 1) throw new Error('session-input-invalid');
	const inputFlagIndex = inputFlagIndexes[0];
	const usesFramedInput = inputFlagIndex !== undefined && argv[inputFlagIndex + 1] === '-';
	const hasInput = hasOwn(value, 'input');
	if (usesFramedInput !== hasInput) throw new Error('session-input-isolation-required');
	return {
		id,
		argv,
		...(hasInput ? { input: value.input } : {}),
	};
}

function decodeSessionReadGroup(
	value: Record<string, unknown>,
	limits: SessionLimitsV1,
	options: JsonlSessionOptionsV1,
): SessionReadGroupV1 {
	if (
		Object.keys(value).some(key => !['id', 'reads'].includes(key))
		|| !Array.isArray(value.reads)
		|| value.reads.length < SESSION_READ_GROUP_MIN
		|| value.reads.length > SESSION_READ_GROUP_MAX
	) throw new Error('session-read-group-invalid');
	const id = readRequestId(value);
	if (id === null) throw new Error('session-id-invalid');
	const reads = value.reads.map(read => decodeSessionRequest(read, limits));
	const ids = new Set(reads.map(read => String(read.id)));
	if (ids.size !== reads.length || ids.has(String(id))) {
		throw new Error('session-read-group-id-invalid');
	}
	let aggregateInputBytes = 0;
	for (const read of reads) {
		if (!isGroupedReadArgv(read.argv)) throw new Error('session-read-group-command-not-allowed');
		aggregateInputBytes += encodeSessionInput(read, limits)?.byteLength ?? 0;
		if (aggregateInputBytes > limits.inputBytes) {
			throw new Error('session-read-group-input-too-large');
		}
	}
	const configRoot = options.commandPorts?.configRoot ?? operonCliConfigRootV1();
	const config = loadOperonCliConfigV1(configRoot);
	const firstInput = targetInput(reads[0].argv, options.commandPorts?.cwd);
	const target = createResolvedVaultCommandScopeV1(firstInput, configRoot);
	for (const read of reads) {
		const resolved = resolveVaultV1(config, targetInput(read.argv, options.commandPorts?.cwd));
		const identity = canonicalVaultIdentityV1(resolved.canonicalPath);
		if (
			identity.canonicalPath !== target.canonicalPath
			|| identity.sha256 !== target.vaultSha256
		) throw new Error('session-read-group-target-mismatch');
		read.argv = bindTarget(read.argv, target.canonicalPath);
	}
	getOrCreateOperonCliClientIdV1(path.join(configRoot, 'client-v1.json'));
	return { id, reads, target };
}

function isGroupedReadArgv(argv: readonly string[]): boolean {
	return argv[0] === 'health'
		|| argv[0] === 'query'
		|| (argv[0] === 'task' && argv[1] === 'get')
		|| argv[0] === 'context';
}

function targetInput(
	argv: readonly string[],
	cwd?: string,
): { explicitVault?: string; explicitProfile?: string; cwd?: string } {
	const vaultIndex = argv.indexOf('--vault');
	const profileIndex = argv.indexOf('--profile');
	return {
		...(vaultIndex >= 0 ? { explicitVault: argv[vaultIndex + 1] ?? '' } : {}),
		...(profileIndex >= 0 ? { explicitProfile: argv[profileIndex + 1] ?? '' } : {}),
		...(cwd ? { cwd } : {}),
	};
}

function bindTarget(argv: readonly string[], canonicalPath: string): string[] {
	const result: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--vault' || argv[index] === '--profile') {
			index += 1;
			continue;
		}
		result.push(argv[index]);
	}
	return [...result, '--vault', canonicalPath];
}

function encodeSessionInput(request: SessionRequestV1, limits: SessionLimitsV1): Buffer | undefined {
	if (!hasOwn(request, 'input')) return undefined;
	let serialized: string;
	try {
		serialized = typeof request.input === 'string'
			? request.input
			: JSON.stringify(request.input);
	} catch {
		throw new Error('session-input-invalid');
	}
	if (serialized === undefined) throw new Error('session-input-invalid');
	const input = Buffer.from(serialized, 'utf8');
	if (input.byteLength > limits.inputBytes) throw new Error('session-input-too-large');
	return input;
}

function readRequestId(value: unknown): SessionRequestIdV1 | null {
	if (!isPlainRecord(value)) return null;
	if (typeof value.id === 'string') {
		const bytes = Buffer.byteLength(value.id, 'utf8');
		return bytes > 0 && bytes <= SESSION_ID_MAX_BYTES ? value.id : null;
	}
	return Number.isSafeInteger(value.id) && Number(value.id) >= 0
		? Number(value.id)
		: null;
}

async function writeSessionResponse(
	output: SessionOutputV1,
	response: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) throw new SessionAbortedError();
	const accepted = output.write(`${JSON.stringify(response)}\n`);
	if (!accepted) {
		await waitForOutputDrain(output, signal);
	}
}

async function writePostDispatchRecoveryResponse(
	output: SessionOutputV1,
	response: Record<string, unknown>,
): Promise<void> {
	if (output.write(`${JSON.stringify(response)}\n`)) return;
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			output.removeListener('drain', onDrain);
			output.removeListener('close', onClose);
			output.removeListener('error', onError);
		};
		const settle = (error?: Error) => {
			cleanup();
			if (error) reject(error);
			else resolve();
		};
		const onDrain = () => settle();
		const onClose = () => settle(new Error('SESSION_OUTPUT_CLOSED'));
		const onError = (error?: Error) => settle(error ?? new Error('SESSION_OUTPUT_FAILED'));
		const timer = setTimeout(
			() => settle(new Error('SESSION_RECOVERY_OUTPUT_TIMEOUT')),
			1_000,
		);
		output.once('drain', onDrain);
		output.once('close', onClose);
		output.once('error', onError);
	});
}

async function writeOrderedReadGroupResponses(
	responses: readonly Promise<Record<string, unknown>>[],
	output: SessionOutputV1,
	signal?: AbortSignal,
): Promise<void> {
	if (
		responses.length < SESSION_READ_GROUP_MIN
		|| responses.length > SESSION_READ_GROUP_MAX
	) {
		throw new Error('SESSION_READ_GROUP_BOUNDS_INVALID');
	}
	const ready = responses.map(
		(): Record<string, unknown> | undefined => undefined,
	);
	let nextExpectedIndex = 0;
	let writeChain = Promise.resolve();
	await Promise.all(responses.map((responsePromise, index) => responsePromise.then(response => {
		if (ready[index] !== undefined || index < nextExpectedIndex) {
			throw new Error('SESSION_READ_GROUP_DUPLICATE_COMPLETION');
		}
		ready[index] = response;
		writeChain = writeChain.then(async () => {
			while (nextExpectedIndex < ready.length) {
				const current = ready[nextExpectedIndex];
				if (current === undefined) break;
				ready[nextExpectedIndex] = undefined;
				nextExpectedIndex += 1;
				await writeSessionResponse(output, current, signal);
			}
		});
		return writeChain;
	})));
	if (nextExpectedIndex !== responses.length) {
		throw new Error('SESSION_READ_GROUP_INCOMPLETE');
	}
}

async function waitForOutputDrain(output: SessionOutputV1, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) throw new SessionAbortedError();
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			output.removeListener('drain', onDrain);
			output.removeListener('close', onClose);
			output.removeListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
		};
		const settle = (error?: Error) => {
			cleanup();
			if (error) reject(error);
			else resolve();
		};
		const onDrain = () => settle();
		const onClose = () => settle(new Error('SESSION_OUTPUT_CLOSED'));
		const onError = (error?: Error) => settle(error ?? new Error('SESSION_OUTPUT_FAILED'));
		const onAbort = () => settle(new SessionAbortedError());
		output.once('drain', onDrain);
		output.once('close', onClose);
		output.once('error', onError);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

function uncertainApplyPlanRef(argv: readonly string[]): string | null {
	if (
		argv[0] === 'plan'
		&& (argv[1] === 'apply' || argv[1] === 'recover')
		&& typeof argv[2] === 'string'
		&& argv[2].length > 0
		&& !argv[2].startsWith('-')
	) return argv[2];
	if (argv[0] === 'mutation' && argv[1] === 'apply') {
		const flagIndex = argv.indexOf('--plan-ref');
		const planRef = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
		if (typeof planRef === 'string' && planRef.length > 0) return planRef;
	}
	return null;
}

function sessionError(
	id: SessionRequestIdV1 | null,
	exitCode: number,
	code: string,
	reason: string,
): Record<string, unknown> {
	return {
		id,
		exitCode,
		error: structuredErrorV1(
			exitCode === 2
				? 'invalid-request'
				: exitCode === 3
					? 'transport-unavailable'
					: exitCode === 4
						? 'capability-unavailable'
						: exitCode === 5
							? 'outcome-unknown'
							: 'internal-error',
			reason,
			{ details: { reasonCode: code } },
		),
	};
}

function normalizeLimits(overrides: Partial<SessionLimitsV1> = {}): SessionLimitsV1 {
	const limits = { ...SESSION_JSONL_LIMITS_V1, ...overrides };
	for (const value of Object.values(limits)) {
		if (!Number.isSafeInteger(value) || value < 1) throw new Error('SESSION_LIMIT_INVALID');
	}
	return limits;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: string): boolean {
	return Object.keys(value).includes(key);
}

class SessionAbortedError extends Error {
	constructor() {
		super('SESSION_ABORTED');
		this.name = 'SessionAbortedError';
	}
}

class SessionPostDispatchInterruptedError extends Error {
	constructor() {
		super('SESSION_POST_DISPATCH_INTERRUPTED');
		this.name = 'SessionPostDispatchInterruptedError';
	}
}
