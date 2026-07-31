import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import path from 'node:path';

import {
	CLI_COMMAND_HANDLER_V1,
	CLI_DEFAULT_READINESS_TIMEOUT_MS_V1,
	CLI_EXIT_CODES_V1,
	CLI_MAX_READINESS_TIMEOUT_MS_V1,
	type CliClientErrorEnvelopeV1,
	type CliCommandV1,
	type CliInvocationV1,
	type CliResultEnvelopeV1,
	type CliRuntimeRequestV1,
	admitMutationResultV1,
	decodeCliInvocationV1,
	decodeCliResultEnvelopeV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	CONTRACT_LIMITS_V1,
	type JsonValue,
	structuredErrorV1,
} from '../../../src/agent-runtime/contracts/v1/primitives';
import {
	type CanonicalVaultFenceV1,
	type CliBenchmarkSpanSinkV1,
	assertCanonicalVaultFenceV1,
	canonicalVaultIdentityV1,
	cleanupSecureInvocationV1,
	CLI_MAX_CAPTURE_BYTES_V1,
	assertLiveTransportPlatformV1,
	readInputFileSafelyV1,
	type SecureRequestFileV1,
	writeSecureInvocationV1,
} from './protocol';
import { getOrCreateOperonCliClientIdV1 } from './client-identity';
import {
	renderRootHelpV1,
	resolveCommandDefinitionV1,
} from './command-registry';
import {
	PersistentReadTransportErrorV1,
	type PersistentReadTransportV1,
	createWindowsBrokerClientV1,
} from './persistent-read-client';
import {
	resolveObsidianExecutableV1,
	terminateProcessTreeV1,
} from './process-platform';
import { sanitizeProcessDiagnosticV1 } from './terminal-text';
export { renderHumanV1 } from './human-renderer';
export {
	sanitizeProcessDiagnosticV1,
	sanitizeTerminalTextV1,
} from './terminal-text';

declare const __OPERON_CLI_VERSION__: string;
export const OPERON_CLI_VERSION = typeof __OPERON_CLI_VERSION__ === 'string'
	? __OPERON_CLI_VERSION__
	: '0.0.0-development';

export interface CliOptionsV1 {
	command: CliCommandV1;
	vaultPath: string;
	json: boolean;
	inputPath?: string;
	operonId?: string;
	consistency: 'live-verified' | 'best-effort';
	readinessTimeoutMs: number;
	requestId?: string;
	obsidianBin: string;
}

export interface ProcessResultV1 {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: Buffer;
	stderr: Buffer;
	totalMs: number;
	timedOut: boolean;
	overflow: boolean;
	spawnErrorCode?: string;
}

export type ProcessRunnerV1 = (
	executable: string,
	args: string[],
	options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<ProcessResultV1>;

export interface WindowsBrokerClientPortV1 {
	stage(invocation: CliInvocationV1): Promise<{ requestToken: string; stagingReceipt: string }>;
	status(requestToken: string): Promise<{
		state: 'staged' | 'consumed' | 'dispatch-started' | 'unknown';
	}>;
	cancel(requestToken: string): Promise<{
		cancelled: boolean;
		state: 'staged' | 'consumed' | 'dispatch-started' | 'unknown';
	}>;
	close(): void;
}

export type ApplyDispatchEvidenceV1 = 'not-started' | 'may-have-started';

export interface CliExecutionOutcomeV1 {
	envelope: CliResultEnvelopeV1;
	exitCode: number;
	invocation?: CliInvocationV1;
	/** Internal plan-store handoff; never serialized in a public result. */
	_applyDispatchEvidence?: ApplyDispatchEvidenceV1;
}

export function usageV1(): string {
	return renderRootHelpV1();
}

export function parseCliArgsV1(argv: string[]): CliOptionsV1 {
	const { command, consumed } = parseCliCommandV1(argv);
	const options: Partial<CliOptionsV1> = {
		command,
		json: false,
		consistency: 'live-verified',
		readinessTimeoutMs: CLI_DEFAULT_READINESS_TIMEOUT_MS_V1,
		obsidianBin: 'obsidian',
	};
	const seen = new Set<string>();
	const valueFlags: Readonly<Record<string, keyof CliOptionsV1>> = {
		'--vault': 'vaultPath',
		'--input': 'inputPath',
		'--id': 'operonId',
		'--consistency': 'consistency',
		'--timeout-ms': 'readinessTimeoutMs',
		'--request-id': 'requestId',
		'--obsidian-bin': 'obsidianBin',
	};
	for (let index = consumed; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === '--json') {
			if (seen.has(flag)) throw new Error('DUPLICATE_FLAG:--json');
			seen.add(flag);
			options.json = true;
			continue;
		}
		const field = valueFlags[flag];
		if (!field) throw new Error(`UNKNOWN_FLAG:${flag}`);
		if (seen.has(flag)) throw new Error(`DUPLICATE_FLAG:${flag}`);
		const value = argv[index + 1];
		if (value === undefined) throw new Error(`MISSING_VALUE:${flag}`);
		seen.add(flag);
		(options as Record<string, unknown>)[field] = value;
		index += 1;
	}
	if (!options.vaultPath) throw new Error('VAULT_REQUIRED');
	if (typeof options.readinessTimeoutMs === 'string') {
		options.readinessTimeoutMs = parsePositiveInteger(
			options.readinessTimeoutMs,
			'--timeout-ms',
		);
	}
	if (
		options.readinessTimeoutMs === undefined
		|| options.readinessTimeoutMs > CLI_MAX_READINESS_TIMEOUT_MS_V1
	) throw new Error('READINESS_TIMEOUT_OUT_OF_RANGE');
	if (options.consistency !== 'live-verified' && options.consistency !== 'best-effort') {
		throw new Error('INVALID_CONSISTENCY');
	}
	validateInputOptions(options as CliOptionsV1);
	return options as CliOptionsV1;
}

export async function buildInvocationV1(
	options: CliOptionsV1,
	input?: Buffer,
	resolvedVaultFence?: CanonicalVaultFenceV1,
	clientIdentityPath?: string,
): Promise<{ invocation: CliInvocationV1; canonicalVaultPath: string }> {
	let vault: ReturnType<typeof canonicalVaultIdentityV1>;
	try {
		if (resolvedVaultFence) {
			assertCanonicalVaultFenceV1(resolvedVaultFence);
			if (options.vaultPath !== resolvedVaultFence.canonicalPath) {
				throw new Error('VAULT_TARGET_CHANGED');
			}
			vault = {
				canonicalPath: resolvedVaultFence.canonicalPath,
				sha256: resolvedVaultFence.sha256,
			};
		} else {
			vault = canonicalVaultIdentityV1(options.vaultPath);
			const vaultStat = lstatSync(vault.canonicalPath);
			if (!vaultStat.isDirectory()) throw new Error('VAULT_NOT_DIRECTORY');
		}
	} catch (error) {
		if (
			error instanceof Error
			&& (error.message === 'VAULT_NOT_DIRECTORY' || error.message === 'VAULT_TARGET_CHANGED')
		) throw error;
		throw new Error('VAULT_PATH_UNAVAILABLE');
	}
	let request: CliRuntimeRequestV1 | undefined;
	if (options.inputPath) {
		const rawInput = input ?? await loadInputV1(options.inputPath);
		request = parseRuntimeRequest(rawInput);
		if ('consistency' in request && request.consistency === 'offline-unverified') {
			throw new Error('OFFLINE_MODE_UNSUPPORTED');
		}
		if (options.command === 'mutation.preview' && request.kind === 'mutation-preview') {
			if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
				throw new Error('IDEMPOTENCY_KEY_REQUIRED');
			}
			const clientInstanceId = getOrCreateOperonCliClientIdV1(clientIdentityPath);
			request = {
				...request,
				clientInstanceId,
			};
		}
		if (
			options.command === 'mutation.apply'
			&& request.kind === 'mutation-apply'
			&& request.plan.clientInstanceId !== getOrCreateOperonCliClientIdV1(clientIdentityPath)
		) {
			throw new Error('CLIENT_INSTANCE_MISMATCH');
		}
		if (options.requestId && request.requestId !== options.requestId) {
			throw new Error('REQUEST_ID_MISMATCH');
		}
	} else {
		const requestId = options.requestId ?? randomUUID();
			if (options.command === 'catalog') {
				request = {
					contractVersion: 1,
					requestId,
					kind: 'catalog',
					consistency: options.consistency,
				};
			} else if (options.command === 'timers.read') {
				request = {
					contractVersion: 1,
					requestId,
					kind: 'timer-read',
					consistency: options.consistency,
				};
			} else if (options.command === 'task.get' && options.operonId) {
			request = {
				contractVersion: 1,
				requestId,
				kind: 'task-get',
				selector: { kind: 'operon-id', operonId: options.operonId },
				consistency: options.consistency,
			};
		}
	}
	const invocation: CliInvocationV1 = {
		contractVersion: 1,
		kind: 'cli-invocation',
		requestId: request?.requestId ?? options.requestId ?? randomUUID(),
		command: options.command,
		mode: 'live',
		clientVersion: OPERON_CLI_VERSION,
		compatibility: {
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
		},
		cliContract: { min: 1, max: 1 },
		expectedVaultSha256: vault.sha256,
		readinessTimeoutMs: options.readinessTimeoutMs,
		...(request ? { request } : {}),
	};
	const decoded = decodeCliInvocationV1(invocation);
	if (!decoded.ok) throw new Error(`INVALID_INVOCATION:${formatDecodeIssues(decoded.issues)}`);
	return { invocation: decoded.value, canonicalVaultPath: vault.canonicalPath };
}

export async function executeCliV1(
	options: CliOptionsV1,
	ports: {
		runProcess?: ProcessRunnerV1;
		input?: Buffer;
		signal?: AbortSignal;
		requestRoot?: string;
		platform?: NodeJS.Platform;
		resolvedVaultFence?: CanonicalVaultFenceV1;
		clientIdentityPath?: string;
		benchmarkSpan?: CliBenchmarkSpanSinkV1;
		persistentReadTransport?: PersistentReadTransportV1;
		windowsBrokerClient?: WindowsBrokerClientPortV1;
	} = {},
): Promise<CliExecutionOutcomeV1> {
	const startedAt = performance.now();
	let requestFile: SecureRequestFileV1 | null = null;
	let invocation: CliInvocationV1 | null = null;
	let windowsBroker: WindowsBrokerClientPortV1 | null = null;
	let windowsRequestToken: string | null = null;
	let inputBytes = 0;
	let applyDispatched = false;
	let persistentFallbackAttempted = false;
	try {
		if (ports.signal?.aborted) throw new Error('CLI_ABORTED');
		const platform = ports.platform ?? process.platform;
		assertLiveTransportPlatformV1(platform);
		const invocationStartedAt = performance.now();
		const built = await buildInvocationV1(
			options,
			ports.input,
			ports.resolvedVaultFence,
			ports.clientIdentityPath,
		);
		ports.benchmarkSpan?.(
			'invocation-build',
			Math.max(0, performance.now() - invocationStartedAt),
		);
		invocation = built.invocation;
		if (platform === 'win32') {
			windowsBroker = ports.windowsBrokerClient ?? await createWindowsBrokerClientV1({
				vaultSha256: invocation.expectedVaultSha256,
			});
			const staged = await windowsBroker.stage(invocation);
			windowsRequestToken = staged.requestToken;
			inputBytes = Buffer.byteLength(JSON.stringify(invocation), 'utf8');
		} else {
			requestFile = writeSecureInvocationV1(invocation, {
				root: ports.requestRoot,
				...(ports.benchmarkSpan ? { benchmarkSpan: ports.benchmarkSpan } : {}),
			});
			inputBytes = requestFile.bytes;
		}
		let requestToken = windowsRequestToken ?? requestFile?.token;
		if (!requestToken) throw new Error('TRANSPORT_STAGING_FAILED');
		const handler = CLI_COMMAND_HANDLER_V1[options.command];
		const spawnStartedAt = performance.now();
		let processResult: ProcessResultV1;
		let usedSpawnTransport = true;
		if (
			ports.persistentReadTransport
			&& ports.resolvedVaultFence
			&& isPersistentReadCommandV1(options.command)
		) {
			try {
				const persistentResult = await ports.persistentReadTransport.invoke({
					requestId: invocation.requestId,
					command: options.command,
					requestToken,
					vaultFence: ports.resolvedVaultFence,
					...(ports.signal ? { signal: ports.signal } : {}),
				});
				processResult = {
					exitCode: 0,
					signal: null,
					stdout: persistentResult.result,
					stderr: Buffer.alloc(0),
					totalMs: persistentResult.totalMs,
					timedOut: false,
					overflow: false,
				};
				usedSpawnTransport = false;
				ports.benchmarkSpan?.('persistent-read', persistentResult.totalMs);
			} catch (error) {
				if (ports.signal?.aborted) throw new Error('CLI_ABORTED');
				persistentFallbackAttempted = true;
				ports.persistentReadTransport.noteFallback({
					requestId: invocation.requestId,
					command: options.command,
					requestToken,
					vaultFence: ports.resolvedVaultFence,
					...(ports.signal ? { signal: ports.signal } : {}),
				});
				const frameSent = error instanceof PersistentReadTransportErrorV1
					&& error.frameSent;
				ports.benchmarkSpan?.(
					frameSent ? 'persistent-read-duplicate-fallback' : 'persistent-read-preflight-fallback',
					Math.max(0, performance.now() - spawnStartedAt),
				);
				if (frameSent) {
					if (windowsBroker) {
						const restaged = await windowsBroker.stage(invocation);
						windowsRequestToken = restaged.requestToken;
						requestToken = restaged.requestToken;
					} else if (requestFile) {
						try {
							cleanupSecureInvocationV1(requestFile.token, {
								root: ports.requestRoot,
								fileIdentity: requestFile.fileIdentity,
							});
						} catch {
							// The server may already have consumed the first read token.
						}
						requestFile = writeSecureInvocationV1(invocation, {
							root: ports.requestRoot,
							...(ports.benchmarkSpan ? { benchmarkSpan: ports.benchmarkSpan } : {}),
						});
						requestToken = requestFile.token;
					}
				}
				processResult = await runSpawnTransport(
					options,
					built.canonicalVaultPath,
					handler,
					requestToken,
					ports,
				);
			}
		} else {
			processResult = await runSpawnTransport(
				options,
				built.canonicalVaultPath,
				handler,
				requestToken,
				ports,
			);
		}
		if (usedSpawnTransport) {
			ports.benchmarkSpan?.(
				'obsidian-spawn-to-close',
				Math.max(0, performance.now() - spawnStartedAt),
			);
		}
		const totalMs = Math.max(0, performance.now() - startedAt);
		applyDispatched = invocation.command === 'mutation.apply'
			&& await mutationDispatchMayHaveStartedV1(
				windowsBroker,
				windowsRequestToken,
				requestFile,
				ports.requestRoot,
			);
		const transportRetryable = options.command !== 'mutation.apply';
		if (processResult.timedOut) {
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'readiness',
				'live-settling',
				transportRetryable
					? 'Operon Runtime did not answer before the CLI deadline.'
					: applyDispatched
						? 'Apply outcome is uncertain; recover the same stored plan.'
						: 'Apply was not dispatched before the CLI deadline; retry the same stored plan.',
				transportRetryable || !applyDispatched,
				applyDispatched,
				{
					reasonCode: 'obsidian-cli-deadline-exceeded',
					...(persistentFallbackAttempted ? { persistentFallbackAttempted: true } : {}),
				},
				ports.signal?.aborted === true,
			);
		}
		if (processResult.overflow) {
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'internal',
				'result-too-large',
				'Obsidian CLI output exceeded the V1 result limit.',
				false,
				applyDispatched,
				{
					reasonCode: 'obsidian-cli-output-too-large',
					...(persistentFallbackAttempted ? { persistentFallbackAttempted: true } : {}),
				},
			);
		}
		if (processResult.spawnErrorCode || processResult.exitCode !== 0) {
			const failureDetails = processFailureDetailsV1(
				processResult,
				persistentFallbackAttempted,
			);
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'transport',
				'transport-unavailable',
				transportRetryable
					? 'The Obsidian CLI transport is unavailable.'
					: applyDispatched
						? 'Apply transport failed; recover the same stored plan.'
						: 'Apply was not dispatched; retry the same stored plan.',
				transportRetryable || !applyDispatched,
				applyDispatched,
				failureDetails,
				ports.signal?.aborted === true,
			);
		}
		const resultDecodeStartedAt = performance.now();
		let parsed: unknown;
		try {
			parsed = JSON.parse(processResult.stdout.toString('utf8').trim());
		} catch {
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'transport',
				'transport-unavailable',
				transportRetryable
					? 'The Obsidian CLI did not return an Operon Runtime handler response.'
					: applyDispatched
						? 'Apply response is uncertain; recover the same stored plan.'
						: 'Apply was not dispatched; retry the same stored plan.',
				transportRetryable || !applyDispatched,
				applyDispatched,
				responseFailureDetailsV1(
					processResult.stdout,
					persistentFallbackAttempted,
					usedSpawnTransport,
				),
			);
		}
		if (!isPlainRecord(parsed) || !isPlainRecord(parsed.timing)) {
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'internal',
				'internal-error',
				'The Obsidian CLI handler returned an invalid result envelope.',
				false,
				applyDispatched,
			);
		}
		const completed = {
			...parsed,
			timing: { ...parsed.timing, totalMs },
		};
		const serialized = JSON.stringify(completed);
		if (Buffer.byteLength(serialized, 'utf8') > CONTRACT_LIMITS_V1.transportResultBytes) {
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'internal',
				'result-too-large',
				'The completed CLI envelope exceeds the V1 result limit.',
				false,
				applyDispatched,
			);
		}
		const decoded = decodeCliResultEnvelopeV1(completed);
		if (!decoded.ok) {
			const issueSummary = decoded.issues
				.slice(0, 3)
				.map(issue => `${issue.path || '/'} ${issue.message}`)
				.join('; ');
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'internal',
				'internal-error',
				`The Obsidian CLI handler result does not match the V1 contract${
					issueSummary ? `: ${issueSummary}` : '.'
				}`,
				false,
				applyDispatched,
			);
		}
		if (
			decoded.value.requestId !== invocation.requestId
			|| decoded.value.command !== invocation.command
		) {
			return clientFailure(
				invocation,
				inputBytes,
				totalMs,
				'internal',
				'internal-error',
				'The Obsidian CLI handler response did not match the originating request.',
				false,
				applyDispatched,
			);
		}
		if (!validateCliMutationApplyResultBindingV1(invocation, decoded.value)) {
				return clientFailure(
					invocation,
					inputBytes,
					totalMs,
					'internal',
					'internal-error',
					'The mutation result was not bound to the submitted plan and local Runtime scope.',
					false,
					applyDispatched,
				);
		}
		ports.benchmarkSpan?.(
			'result-decode-admission',
			Math.max(0, performance.now() - resultDecodeStartedAt),
		);
		return {
			envelope: decoded.value,
			exitCode: exitCodeForEnvelopeV1(decoded.value),
			invocation,
			...(invocation.command === 'mutation.apply'
				? { _applyDispatchEvidence: 'may-have-started' as const }
				: {}),
		};
	} catch (error) {
		const fallbackInvocation = invocation ?? fallbackInvocationV1(options);
		if (fallbackInvocation.command === 'mutation.apply' && !applyDispatched) {
			applyDispatched = await mutationDispatchMayHaveStartedV1(
				windowsBroker,
				windowsRequestToken,
				requestFile,
				ports.requestRoot,
			);
		}
		const classification = classifyClientExecutionError(error);
		return clientFailure(
			fallbackInvocation,
			inputBytes,
			Math.max(0, performance.now() - startedAt),
			classification.stage,
			classification.code,
			classification.reason,
				classification.retryable,
				applyDispatched,
				{ reasonCode: clientReasonCodeV1(error) },
				ports.signal?.aborted === true || (
				error instanceof Error && error.message === 'CLI_ABORTED'
			),
		);
	} finally {
		if (requestFile) {
			try {
				cleanupSecureInvocationV1(requestFile.token, {
					root: ports.requestRoot,
					fileIdentity: requestFile.fileIdentity,
				});
			} catch {
				// Handler also consumes the one-shot file; cleanup is best effort here.
			}
		}
		windowsBroker?.close();
	}
}

async function mutationDispatchMayHaveStartedV1(
	broker: WindowsBrokerClientPortV1 | null,
	requestToken: string | null,
	requestFile: SecureRequestFileV1 | null,
	requestRoot?: string,
): Promise<boolean> {
	if (!broker || !requestToken) {
		if (!requestFile) return false;
		try {
			// The exact published inode still existing proves that the handler
			// never consumed it. Remove it before reporting a safe pre-dispatch abort.
			return !cleanupSecureInvocationV1(requestFile.token, {
				root: requestRoot,
				fileIdentity: requestFile.fileIdentity,
			});
		} catch {
			return true;
		}
	}
	try {
		const status = await broker.status(requestToken);
		if (status.state !== 'staged') return true;
		const cancelled = await broker.cancel(requestToken);
		return !cancelled.cancelled || cancelled.state !== 'staged';
	} catch {
		return true;
	}
}

export function isPersistentReadCommandV1(command: CliCommandV1): boolean {
	return command === 'health'
		|| command === 'task.get'
		|| command === 'tasks.query'
		|| command === 'context.build';
}

function runSpawnTransport(
	options: CliOptionsV1,
	canonicalVaultPath: string,
	handler: string,
	requestToken: string,
	ports: {
		runProcess?: ProcessRunnerV1;
		signal?: AbortSignal;
	},
): Promise<ProcessResultV1> {
	return (ports.runProcess ?? runObsidianProcessV1)(
		resolveObsidianExecutableV1(options.obsidianBin, { cwd: canonicalVaultPath }),
		[
			`vault=${path.basename(canonicalVaultPath)}`,
			handler,
			`requestToken=${requestToken}`,
		],
		{
			cwd: canonicalVaultPath,
			timeoutMs: options.readinessTimeoutMs + 5_000,
			signal: ports.signal,
		},
	);
}

export function validateCliMutationApplyResultBindingV1(
	invocation: CliInvocationV1,
	envelope: CliResultEnvelopeV1,
): boolean {
	if (
		invocation.command !== 'mutation.apply'
		|| !envelope.ok
		|| envelope.result === undefined
	) return true;
	const applyRequest = invocation.request;
	const plan = isPlainRecord(applyRequest) && isPlainRecord(applyRequest.plan)
		? applyRequest.plan
		: null;
	const clientInstanceId = plan?.clientInstanceId;
	if (typeof clientInstanceId !== 'string') return false;
	return admitMutationResultV1(
		envelope.result,
		applyRequest,
		{
			vaultIdentityHash: invocation.expectedVaultSha256,
			clientInstanceId,
		},
	).ok;
}

export async function runObsidianProcessV1(
	executable: string,
	args: string[],
	options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
): Promise<ProcessResultV1> {
	if (options.signal?.aborted) {
		return {
			exitCode: null,
			signal: 'SIGTERM',
			stdout: Buffer.alloc(0),
			stderr: Buffer.alloc(0),
			totalMs: 0,
			timedOut: false,
			overflow: false,
			spawnErrorCode: 'ABORTED',
		};
	}
	return new Promise(resolve => {
		const startedAt = performance.now();
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let overflow = false;
		let timedOut = false;
		let spawnErrorCode: string | undefined;
		let settled = false;
		let forcedSettlementTimer: NodeJS.Timeout | undefined;
		const child = spawn(executable, args, {
			cwd: options.cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: process.env,
		});
		const settle = (exitCode: number | null, signal: NodeJS.Signals | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forcedSettlementTimer) clearTimeout(forcedSettlementTimer);
			options.signal?.removeEventListener('abort', abort);
			resolve({
				exitCode,
				signal,
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
				totalMs: Math.max(0, performance.now() - startedAt),
				timedOut,
				overflow,
				...(spawnErrorCode ? { spawnErrorCode } : {}),
			});
		};
		const terminateWindowsTree = () => {
			terminateProcessTreeV1(child.pid);
			if (forcedSettlementTimer) return;
			forcedSettlementTimer = setTimeout(() => {
				spawnErrorCode ??= 'PROCESS_TREE_TERMINATION_TIMEOUT';
				child.stdout.destroy();
				child.stderr.destroy();
				child.unref();
				settle(null, null);
			}, 2_000);
		};
		const terminateForOverflow = () => {
			overflow = true;
			if (process.platform === 'win32') terminateWindowsTree();
			else child.kill('SIGKILL');
		};
		child.stdout.on('data', (chunk: Buffer) => {
			stdoutBytes += chunk.byteLength;
			if (stdoutBytes > CLI_MAX_CAPTURE_BYTES_V1) return terminateForOverflow();
			stdout.push(Buffer.from(chunk));
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderrBytes += chunk.byteLength;
			if (stderrBytes > CLI_MAX_CAPTURE_BYTES_V1) return terminateForOverflow();
			stderr.push(Buffer.from(chunk));
		});
		child.on('error', error => {
			spawnErrorCode = 'code' in error && typeof error.code === 'string'
				? error.code
				: 'SPAWN_ERROR';
		});
		const timer = setTimeout(() => {
			timedOut = true;
			if (process.platform === 'win32') terminateWindowsTree();
			else child.kill('SIGKILL');
		}, options.timeoutMs);
		const abort = () => {
			if (process.platform === 'win32') terminateWindowsTree();
			else child.kill('SIGTERM');
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		child.on('close', (exitCode, signal) => {
			settle(exitCode, signal);
		});
	});
}

export function exitCodeForEnvelopeV1(envelope: CliResultEnvelopeV1): number {
	if (envelope.ok) {
		const resultRecord = asRecord(envelope.result);
		if (
			envelope.command === 'mutation.apply'
			&& resultRecord?.kind === 'mutation-result'
			&& resultRecord.status !== 'applied'
			&& resultRecord.status !== 'already-applied'
		) return CLI_EXIT_CODES_V1.runtimeFailure;
		if (
			isPlainRecord(envelope.result)
			&& 'ok' in envelope.result
			&& envelope.result.ok === false
		) return CLI_EXIT_CODES_V1.runtimeFailure;
		return CLI_EXIT_CODES_V1.success;
	}
	if (envelope.failure.error.code === 'outcome-unknown') {
		return CLI_EXIT_CODES_V1.runtimeFailure;
	}
	switch (envelope.failure.stage) {
		case 'client-input':
			return CLI_EXIT_CODES_V1.usage;
		case 'transport':
		case 'readiness':
			return CLI_EXIT_CODES_V1.unavailable;
		case 'vault':
		case 'compatibility':
		case 'capability':
			return CLI_EXIT_CODES_V1.refused;
		case 'runtime':
			return CLI_EXIT_CODES_V1.runtimeFailure;
		case 'internal':
			return CLI_EXIT_CODES_V1.internal;
	}
}

export function createCliUsageFailureV1(command: CliCommandV1): CliResultEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: randomUUID(),
		command,
		ok: false,
		transport: { channel: 'request-file', inputBytes: 0 },
		vaultIdentity: { expectedMatch: null },
		timing: { handlerMs: 0, totalMs: 0 },
		warnings: [],
		failure: {
			stage: 'client-input',
			error: structuredErrorV1(
				'invalid-request',
				'The CLI request is invalid. Run operon --help for supported commands.',
			),
		},
	};
}

export function createCliClientErrorV1(reason: string): CliClientErrorEnvelopeV1 {
	return {
		contractVersion: 1,
		kind: 'cli-client-error',
		ok: false,
		error: structuredErrorV1('invalid-request', reason),
	};
}

async function loadInputV1(inputPath: string): Promise<Buffer> {
	if (inputPath !== '-') {
		try {
			return readInputFileSafelyV1(inputPath);
		} catch (error) {
			const stableInputErrors = new Set([
				'INPUT_FILE_NOT_REGULAR',
				'INPUT_FILE_CHANGED',
				'INPUT_TOO_LARGE',
			]);
			if (error instanceof Error && stableInputErrors.has(error.message)) throw error;
			throw new Error('INPUT_FILE_UNAVAILABLE');
		}
	}
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of process.stdin as AsyncIterable<string | Uint8Array>) {
		const buffer = Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('INPUT_TOO_LARGE');
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

function parseRuntimeRequest(input: Buffer): CliRuntimeRequestV1 {
	if (input.byteLength > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('INPUT_TOO_LARGE');
	try {
		return JSON.parse(input.toString('utf8')) as CliRuntimeRequestV1;
	} catch {
		throw new Error('INPUT_NOT_JSON');
	}
}

export function parseCliCommandV1(argv: string[]): { command: CliCommandV1; consumed: number } {
	const resolved = resolveCommandDefinitionV1(argv, 'runtime');
	if (!resolved) throw new Error('UNKNOWN_COMMAND');
	return {
		command: resolved.definition.id as CliCommandV1,
		consumed: resolved.consumed,
	};
}

function validateInputOptions(options: CliOptionsV1): void {
	const noRequest = options.command === 'health'
		|| options.command === 'capabilities'
		|| options.command === 'diagnostics';
	if (noRequest && (options.inputPath || options.operonId)) throw new Error('COMMAND_DOES_NOT_ACCEPT_INPUT');
	if (options.command === 'catalog' && (options.inputPath || options.operonId)) {
		throw new Error('CATALOG_DOES_NOT_ACCEPT_INPUT');
	}
	if (options.command === 'timers.read' && (options.inputPath || options.operonId)) {
		throw new Error('TIMER_READ_DOES_NOT_ACCEPT_INPUT');
	}
	if (options.command === 'task.get') {
		if (Boolean(options.inputPath) === Boolean(options.operonId)) {
			throw new Error('TASK_GET_REQUIRES_EXACTLY_ONE_SELECTOR_INPUT');
		}
	} else if (
			options.command !== 'health'
				&& options.command !== 'capabilities'
				&& options.command !== 'diagnostics'
			&& options.command !== 'catalog'
			&& options.command !== 'timers.read'
			&& !options.inputPath
	) {
		throw new Error('INPUT_REQUIRED');
	}
	if (
		options.command !== 'catalog'
		&& options.command !== 'timers.read'
		&& !options.operonId
		&& options.consistency !== 'live-verified'
	) {
		throw new Error('CONSISTENCY_IS_DEFINED_BY_INPUT');
	}
}

function parsePositiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`INVALID_INTEGER:${flag}`);
	return parsed;
}

function fallbackInvocationV1(options: CliOptionsV1): CliInvocationV1 {
	return {
		contractVersion: 1,
		kind: 'cli-invocation',
		requestId: options.requestId ?? randomUUID(),
		command: options.command,
		mode: 'live',
		clientVersion: OPERON_CLI_VERSION,
		compatibility: {
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
		},
		cliContract: { min: 1, max: 1 },
		expectedVaultSha256: '0'.repeat(64),
		readinessTimeoutMs: options.readinessTimeoutMs,
	};
}

function processFailureDetailsV1(
	result: ProcessResultV1,
	persistentFallbackAttempted: boolean,
): Record<string, JsonValue> {
	const processDiagnostic = sanitizeProcessDiagnosticV1(
		result.stderr.byteLength > 0
			? result.stderr.toString('utf8')
			: result.stdout.toString('utf8'),
	);
	let reasonCode = 'obsidian-cli-exit-failed';
	if (result.spawnErrorCode === 'ENOENT') reasonCode = 'obsidian-cli-bin-not-found';
	else if (result.spawnErrorCode === 'EACCES' || result.spawnErrorCode === 'EPERM') {
		reasonCode = 'obsidian-cli-execution-denied';
	} else if (isObsidianHostUnreachableDiagnosticV1(processDiagnostic)) {
		reasonCode = 'obsidian-cli-host-unreachable';
	} else if (isObsidianHandlerUnavailableDiagnosticV1(processDiagnostic)) {
		reasonCode = 'obsidian-cli-handler-unavailable';
	}
	const diagnosticSummary = safeObsidianDiagnosticSummaryV1(reasonCode);
	return {
		reasonCode,
		...(Number.isSafeInteger(result.exitCode) ? { processExitCode: result.exitCode } : {}),
		...(result.signal ? { processSignal: result.signal } : {}),
		...(diagnosticSummary ? { diagnosticSummary } : {}),
		...(persistentFallbackAttempted ? { persistentFallbackAttempted: true } : {}),
	};
}

function responseFailureDetailsV1(
	stdout: Buffer,
	persistentFallbackAttempted: boolean,
	usedSpawnTransport: boolean,
): Record<string, JsonValue> {
	const diagnosticSummary = sanitizeProcessDiagnosticV1(stdout.toString('utf8'));
	if (!usedSpawnTransport) {
		return { reasonCode: 'obsidian-cli-response-invalid' };
	}
	const handlerUnavailable = isObsidianHandlerUnavailableDiagnosticV1(diagnosticSummary);
	return {
		reasonCode: handlerUnavailable
			? 'obsidian-cli-handler-unavailable'
			: 'obsidian-cli-response-invalid',
		...(handlerUnavailable
			? { diagnosticSummary: safeObsidianDiagnosticSummaryV1('obsidian-cli-handler-unavailable') }
			: {}),
		...(persistentFallbackAttempted ? { persistentFallbackAttempted: true } : {}),
	};
}

function safeObsidianDiagnosticSummaryV1(reasonCode: string): string {
	switch (reasonCode) {
		case 'obsidian-cli-host-unreachable':
			return 'The CLI is unable to find Obsidian.';
		case 'obsidian-cli-handler-unavailable':
			return 'The requested Obsidian CLI command is unavailable; its plugin may be disabled.';
		default:
			return '';
	}
}

function isObsidianHostUnreachableDiagnosticV1(value: string): boolean {
	return value.startsWith('The CLI is unable to find Obsidian.');
}

function isObsidianHandlerUnavailableDiagnosticV1(value: string): boolean {
	return /^Error: Command ".+" not found\. It may require a plugin to be enabled\.$/u.test(value)
		|| /^Error: command not found$/iu.test(value);
}

function clientFailure(
	invocation: CliInvocationV1,
	inputBytes: number,
	totalMs: number,
	stage: Extract<CliResultEnvelopeV1, { ok: false }>['failure']['stage'],
	code: Extract<CliResultEnvelopeV1, { ok: false }>['failure']['error']['code'],
	reason: string,
	retryable: boolean,
	applyDispatched: boolean = false,
	details?: Record<string, JsonValue>,
	interrupted: boolean = false,
): CliExecutionOutcomeV1 {
	const uncertainApply = invocation.command === 'mutation.apply' && applyDispatched;
	const publicCode = uncertainApply ? 'outcome-unknown' : code;
	const publicReason = uncertainApply
		? 'Apply outcome is uncertain; recover the same stored plan only.'
		: reason;
	const envelope: CliResultEnvelopeV1 = {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: false,
		transport: { channel: 'request-file', inputBytes },
		vaultIdentity: { expectedMatch: null },
		timing: { handlerMs: 0, totalMs },
		warnings: [],
		failure: {
			stage,
			error: structuredErrorV1(publicCode, publicReason, {
					retryable: uncertainApply ? false : retryable,
					...(uncertainApply ? { action: 'recover-same-plan' } : {}),
					...(details ? { details } : {}),
				}),
		},
	};
	return {
		envelope,
		exitCode: interrupted && !uncertainApply
			? 130
			: exitCodeForEnvelopeV1(envelope),
		...(invocation.command === 'mutation.apply'
			? {
				_applyDispatchEvidence: applyDispatched
					? 'may-have-started' as const
					: 'not-started' as const,
			}
			: {}),
	};
}

function clientReasonCodeV1(error: unknown): string {
	const raw = error instanceof Error ? error.message.split(':', 1)[0] : 'internal-error';
	const normalized = raw.toLowerCase().replace(/_/gu, '-');
	return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(normalized)
		? normalized
		: 'internal-error';
}

function publicClientErrorReason(error: unknown): string {
	const code = error instanceof Error ? error.message.split(':', 1)[0] : '';
	const reasons: Readonly<Record<string, string>> = {
		VAULT_REQUIRED: 'A vault path is required.',
		VAULT_NOT_DIRECTORY: 'The vault path is not a directory.',
		VAULT_PATH_UNAVAILABLE: 'The vault path is unavailable.',
		INPUT_REQUIRED: 'This command requires a Runtime request JSON input.',
		INPUT_NOT_JSON: 'The Runtime request input is not valid JSON.',
		INPUT_TOO_LARGE: 'The Runtime request input exceeds the V1 byte limit.',
		INPUT_FILE_NOT_REGULAR: 'The Runtime request input must be a regular file.',
		INPUT_FILE_CHANGED: 'The Runtime request input changed while it was being read.',
		INPUT_FILE_UNAVAILABLE: 'The Runtime request input file is unavailable.',
		IDEMPOTENCY_KEY_REQUIRED: 'Mutation preview input must include a reusable idempotency key for apply.',
		OFFLINE_MODE_UNSUPPORTED: 'The Phase 6 CLI supports live mode only.',
		REQUEST_ID_MISMATCH: 'The explicit request id does not match the Runtime request.',
		READINESS_TIMEOUT_OUT_OF_RANGE: 'The readiness timeout must be between 1 and 30000 milliseconds.',
		INVALID_CONSISTENCY: 'Consistency must be live-verified or best-effort.',
		TASK_GET_REQUIRES_EXACTLY_ONE_SELECTOR_INPUT: 'Task get requires exactly one of --id or --input.',
		CONSISTENCY_IS_DEFINED_BY_INPUT: 'Structured Runtime input owns its consistency value.',
		PLATFORM_UNSUPPORTED: 'Live Operon transport is not supported on this platform.',
	};
	return reasons[code] ?? 'The CLI request is invalid.';
}

function classifyClientExecutionError(error: unknown): {
	stage: Extract<CliResultEnvelopeV1, { ok: false }>['failure']['stage'];
	code: Extract<CliResultEnvelopeV1, { ok: false }>['failure']['error']['code'];
	reason: string;
	retryable: boolean;
} {
	const code = error instanceof Error ? error.message.split(':', 1)[0] : '';
	const clientInputCodes = new Set([
		'VAULT_REQUIRED',
		'VAULT_NOT_DIRECTORY',
		'VAULT_PATH_UNAVAILABLE',
		'INPUT_REQUIRED',
		'INPUT_NOT_JSON',
		'INPUT_TOO_LARGE',
		'INPUT_FILE_NOT_REGULAR',
		'INPUT_FILE_CHANGED',
		'INPUT_FILE_UNAVAILABLE',
		'IDEMPOTENCY_KEY_REQUIRED',
		'OFFLINE_MODE_UNSUPPORTED',
		'REQUEST_ID_MISMATCH',
		'READINESS_TIMEOUT_OUT_OF_RANGE',
		'INVALID_CONSISTENCY',
		'TASK_GET_REQUIRES_EXACTLY_ONE_SELECTOR_INPUT',
		'CONSISTENCY_IS_DEFINED_BY_INPUT',
	]);
	if (clientInputCodes.has(code) || code.startsWith('INVALID_INVOCATION')) {
		return {
			stage: 'client-input',
			code: 'invalid-request',
			reason: publicClientErrorReason(error),
			retryable: false,
		};
	}
	if (code === 'PLATFORM_UNSUPPORTED') {
		return {
			stage: 'capability',
			code: 'capability-unavailable',
			reason: publicClientErrorReason(error),
			retryable: false,
		};
	}
	if (code === 'CLI_ABORTED') {
		return {
			stage: 'transport',
			code: 'transport-unavailable',
			reason: 'The CLI operation was cancelled.',
			retryable: false,
		};
	}
	if (error instanceof PersistentReadTransportErrorV1) {
		if (code === 'PERSISTENT_DESCRIPTOR_MISSING') {
			return {
				stage: 'transport',
				code: 'transport-unavailable',
				reason: 'The authenticated Operon Runtime transport is unavailable.',
				retryable: true,
			};
		}
		return {
			stage: 'transport',
			code: 'desktop-unavailable',
			reason: 'The authenticated Operon Runtime transport is unavailable.',
			retryable: false,
		};
	}
	const transportSecurityCodes = new Set([
		'REQUEST_ROOT_NOT_SECURE',
		'REQUEST_ROOT_WRONG_OWNER',
		'REQUEST_ROOT_WRONG_MODE',
		'REQUEST_FILE_NOT_REGULAR',
		'REQUEST_FILE_WRONG_OWNER',
		'REQUEST_FILE_WRONG_MODE',
		'REQUEST_FILE_CHANGED',
	]);
	if (transportSecurityCodes.has(code)) {
		return {
			stage: 'transport',
			code: 'desktop-unavailable',
			reason: 'The owner-only request transport is unavailable.',
			retryable: false,
		};
	}
	return {
		stage: 'internal',
		code: 'internal-error',
		reason: 'The CLI client failed unexpectedly.',
		retryable: false,
	};
}

function formatDecodeIssues(issues: Array<{ path: string; code: string }>): string {
	return issues.slice(0, 4).map(item => `${item.path}:${item.code}`).join(',');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return isPlainRecord(value) ? value : null;
}
