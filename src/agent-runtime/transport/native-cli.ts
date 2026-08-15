import {
	apiVersion,
	Platform,
	requireApiVersion,
	type Plugin,
} from 'obsidian';
import {
	CLI_COMMANDS_V1,
	CLI_COMMAND_HANDLER_V1,
	type CliCommandV1,
	type CliResultEnvelopeV1,
	type CliRuntimeMetadataV1,
} from '../contracts/v1/cli';
import {
	CONTRACT_VERSION_V1,
	structuredErrorV1,
} from '../contracts/v1/primitives';
import type { OperonAgentRuntimeCoreV1 } from '../runtime/types';
import type { TaskWorkflowCliResultEnvelopeV1 } from '../extensions/task-workflows-v1';
import type { RuntimeTimingSinkV1 } from '../runtime/timing-probe';
import { createAgentRuntimeDesktopNodeApiLoaderV1 } from './desktop-node-api';
import { dispatchAgentRuntimeCliV1 } from './dispatcher';
import type { AgentRuntimeDesktopNodeApiV1 } from './types';
import type {
	AgentRuntimePersistentReadSupervisorSnapshotV1,
} from './persistent-read-supervisor';
import type { PersistentReadDescriptorV1 } from './persistent-read-server';

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

export interface AgentRuntimeCliRegistrationResultV1 {
	readonly registered: boolean;
	readonly commands: readonly string[];
	readonly missingCommands: readonly string[];
	readonly retryable: boolean;
	readonly attempt: number;
	readonly reason?: string;
}

export interface AgentRuntimeCliRegistrationOptionsV1 {
	readonly timingSink?: RuntimeTimingSinkV1;
	readonly persistentReadBootstrap?: () => {
		readonly supervisor: AgentRuntimePersistentReadSupervisorSnapshotV1;
		readonly descriptor: PersistentReadDescriptorV1 | null;
	};
	readonly platformIsWindows?: boolean;
}

interface AgentRuntimeCliRegistrationStateV1 {
	readonly commands: Set<string>;
	bootstrapRegistered: boolean;
	attempt: number;
}

const registrationByPluginInstance = new WeakMap<object, AgentRuntimeCliRegistrationStateV1>();
const WINDOWS_BOOTSTRAP_HANDLER_V1 = 'operon:transport-bootstrap';
const WINDOWS_BOOTSTRAP_KIND_V1 = 'operon-windows-persistent-bootstrap';
const WINDOWS_BOOTSTRAP_NONCE_PATTERN_V1 = /^[A-Za-z0-9_-]{32,128}$/u;
const HEX_256_PATTERN_V1 = /^[a-f0-9]{64}$/u;

type RuntimeCliCommandV1 = CliCommandV1 | 'tasks.filter-query';
const RUNTIME_CLI_COMMANDS_V1: readonly RuntimeCliCommandV1[] = [...CLI_COMMANDS_V1, 'tasks.filter-query'];
const RUNTIME_CLI_HANDLERS_V1: Readonly<Record<RuntimeCliCommandV1, string>> = Object.freeze({
	...CLI_COMMAND_HANDLER_V1,
	'tasks.filter-query': 'operon:filter-query',
});

const COMMAND_DESCRIPTIONS_V1: Readonly<Record<RuntimeCliCommandV1, string>> = Object.freeze({
	health: 'Read the current Operon Agent Runtime health.',
	capabilities: 'List Operon Agent Runtime capabilities.',
	diagnostics: 'Inspect Operon Runtime, catalog, compatibility, and CLI readiness.',
	catalog: 'Read the live Operon Property Catalog.',
	'entity.resolve': 'Resolve a live Operon task selector.',
	'task.get': 'Read one exact live Operon task.',
	'tasks.query': 'Query the bounded live Operon task index.',
	'tasks.filter-query': 'Evaluate one saved Operon filter against the live task index.',
	'tasks.finder': 'Search the live Operon Task Finder index with native ranking.',
	'relationships.get': 'Read live Operon task relationships.',
	'context.build': 'Build a bounded live Operon Context Pack.',
	'timers.read': 'Read the live Operon timer state.',
	'mutation.preview': 'Preview and seal a live Operon mutation plan.',
	'mutation.apply': 'Apply one sealed Operon mutation plan.',
});

const REQUEST_TOKEN_FLAGS_V1: CliFlagsLike = Object.freeze({
	requestToken: Object.freeze({
		value: '<token>',
		description: 'Owner-only one-shot request token.',
		required: true,
	}),
});

const WINDOWS_BOOTSTRAP_FLAGS_V1: CliFlagsLike = Object.freeze({
	bootstrapVersion: Object.freeze({
		value: '<version>',
		description: 'Internal Windows persistent transport bootstrap version.',
		required: true,
	}),
	expectedVaultSha256: Object.freeze({
		value: '<sha256>',
		description: 'Expected canonical vault identity.',
		required: true,
	}),
	clientNonce: Object.freeze({
		value: '<nonce>',
		description: 'Opaque bootstrap response-binding nonce.',
		required: true,
	}),
});

export type AgentRuntimeWindowsBootstrapFailureCodeV1 =
	| 'unsupported-platform'
	| 'unsupported-version'
	| 'vault-mismatch'
	| 'starting'
	| 'backoff'
	| 'unavailable'
	| 'closed';

export function handleAgentRuntimeWindowsBootstrapV1(input: {
	readonly params: CliDataLike;
	readonly windows: boolean;
	readonly supervisor: AgentRuntimePersistentReadSupervisorSnapshotV1 | null;
	readonly descriptor: PersistentReadDescriptorV1 | null;
}): string {
	const keys = Object.keys(input.params).sort();
	const expectedKeys = ['bootstrapVersion', 'clientNonce', 'expectedVaultSha256'];
	const clientNonce = input.params['clientNonce'];
	const expectedVaultSha256 = input.params['expectedVaultSha256'];
	if (
		keys.length !== expectedKeys.length
		|| keys.some((key, index) => key !== expectedKeys[index])
		|| typeof clientNonce !== 'string'
		|| !WINDOWS_BOOTSTRAP_NONCE_PATTERN_V1.test(clientNonce)
		|| typeof expectedVaultSha256 !== 'string'
		|| !HEX_256_PATTERN_V1.test(expectedVaultSha256)
	) return bootstrapFailureV1('unavailable', false, '');
	if (input.params['bootstrapVersion'] !== '1') {
		return bootstrapFailureV1('unsupported-version', false, clientNonce);
	}
	if (!input.windows) return bootstrapFailureV1('unsupported-platform', false, clientNonce);
	if (!input.supervisor) return bootstrapFailureV1('starting', true, clientNonce);
	if (input.supervisor.state !== 'available' || !input.descriptor) {
		const code: AgentRuntimeWindowsBootstrapFailureCodeV1 = input.supervisor.state === 'starting'
			|| input.supervisor.state === 'idle'
			? 'starting'
			: input.supervisor.state === 'backoff'
				? 'backoff'
				: input.supervisor.state === 'closing' || input.supervisor.state === 'closed'
					? 'closed'
					: 'unavailable';
		return bootstrapFailureV1(code, ['starting', 'backoff'].includes(code), clientNonce);
	}
	const descriptor = input.descriptor;
	if (descriptor.vaultSha256 !== expectedVaultSha256) {
		return bootstrapFailureV1('vault-mismatch', false, clientNonce);
	}
	if (
		descriptor.protocolVersion !== 1
		|| descriptor.apiVersion !== 1
		|| descriptor.endpointKind !== 'windows-named-pipe'
		|| !HEX_256_PATTERN_V1.test(descriptor.serverInstanceId)
		|| !/^\\\\\.\\pipe\\operon-[a-f0-9]{64}$/u.test(descriptor.endpoint)
		|| !HEX_256_PATTERN_V1.test(descriptor.authSecret)
		|| !Number.isSafeInteger(descriptor.expiresAt)
		|| descriptor.expiresAt <= Date.now()
	) return bootstrapFailureV1('unavailable', true, clientNonce);
	return JSON.stringify({
		kind: WINDOWS_BOOTSTRAP_KIND_V1,
		bootstrapVersion: 1,
		ok: true,
		clientNonce,
		protocolVersion: descriptor.protocolVersion,
		serverInstanceId: descriptor.serverInstanceId,
		vaultSha256: descriptor.vaultSha256,
		endpointKind: descriptor.endpointKind,
		endpoint: descriptor.endpoint,
		authSecret: descriptor.authSecret,
		expiresAt: descriptor.expiresAt,
		pluginVersion: descriptor.pluginVersion,
		apiVersion: descriptor.apiVersion,
	});
}

function bootstrapFailureV1(
	code: AgentRuntimeWindowsBootstrapFailureCodeV1,
	retryable: boolean,
	clientNonce?: string,
): string {
	return JSON.stringify({
		kind: WINDOWS_BOOTSTRAP_KIND_V1,
		bootstrapVersion: 1,
		apiVersion: 1,
		ok: false,
		clientNonce: clientNonce ?? '',
		code,
		retryable,
	});
}

export function registerAgentRuntimeCliHandlersV1(
	plugin: Plugin,
	runtime: OperonAgentRuntimeCoreV1,
	options: AgentRuntimeCliRegistrationOptionsV1 = {},
): AgentRuntimeCliRegistrationResultV1 {
	if (!Platform.isDesktopApp) {
		return registrationResultV1([], 0, 'desktop-required', false);
	}
	if (!requireApiVersion('1.12.2')) {
		return registrationResultV1([], 0, 'obsidian-cli-api-unavailable', false);
	}
	const methodName = ['register', 'Cli', 'Handler'].join('');
	const registerCliHandler = (plugin as unknown as Record<string, unknown>)[methodName];
	if (typeof registerCliHandler !== 'function') {
		return registrationResultV1([], 0, 'obsidian-cli-handler-unavailable', false);
	}
	if (plugin.manifest.id !== 'operon') {
		return registrationResultV1([], 0, 'plugin-id-mismatch', false);
	}

	const state = registrationByPluginInstance.get(plugin) ?? {
		commands: new Set<string>(),
		bootstrapRegistered: false,
		attempt: 0,
	};
	registrationByPluginInstance.set(plugin, state);
	const platformIsWindows = options.platformIsWindows ?? Platform.isWin;
	const bootstrapRequired = platformIsWindows && options.persistentReadBootstrap !== undefined;
	if (
		state.commands.size === RUNTIME_CLI_COMMANDS_V1.length
		&& (!bootstrapRequired || state.bootstrapRegistered)
	) {
		return registrationResultV1(
			[...state.commands],
			state.attempt,
			undefined,
			false,
			bootstrapRequired,
			state.bootstrapRegistered,
		);
	}
	state.attempt += 1;
	const loadNodeApi = createAgentRuntimeDesktopNodeApiLoaderV1();
	try {
		for (const command of RUNTIME_CLI_COMMANDS_V1) {
			const handlerId = RUNTIME_CLI_HANDLERS_V1[command];
			if (state.commands.has(handlerId)) continue;
			(registerCliHandler as RegisterCliHandlerLike).call(
				plugin,
				handlerId,
				COMMAND_DESCRIPTIONS_V1[command],
				REQUEST_TOKEN_FLAGS_V1,
				async (params: CliDataLike) => {
					const startedAt = performance.now();
					const runtimeMetadata = createAgentRuntimeCliMetadataV1(plugin);
					let nodeApi: AgentRuntimeDesktopNodeApiV1;
					const nodeApiStartedAt = performance.now();
					let nodeApiLoadDurationMs = 0;
					try {
						nodeApi = await loadNodeApi();
						nodeApiLoadDurationMs = Math.max(0, performance.now() - nodeApiStartedAt);
					} catch {
						return JSON.stringify(fallbackFailureEnvelope(
							command,
							runtimeMetadata,
							performance.now() - startedAt,
							'transport',
							'transport-unavailable',
							'The secure desktop request-file transport is unavailable.',
							true,
						));
					}
					try {
						return await dispatchAgentRuntimeCliV1(
							{
								runtime,
								nodeApi,
								vaultAdapter: plugin.app.vault.adapter,
								runtimeMetadata,
								monotonicNow: () => performance.now(),
								...(options.timingSink ? { timingSink: options.timingSink } : {}),
							},
							{
								expectedCommand: command,
								requestToken: params['requestToken'],
								nodeApiLoadDurationMs,
								transportKind: Platform.isWin
									? 'windows-named-pipe'
									: 'request-file',
							},
						);
					} catch {
						return JSON.stringify(fallbackFailureEnvelope(
							command,
							runtimeMetadata,
							performance.now() - startedAt,
							'internal',
							'internal-error',
							'The native CLI dispatcher failed unexpectedly.',
							false,
						));
					}
				},
			);
			state.commands.add(handlerId);
		}
		if (bootstrapRequired && !state.bootstrapRegistered) {
			(registerCliHandler as RegisterCliHandlerLike).call(
				plugin,
				WINDOWS_BOOTSTRAP_HANDLER_V1,
				'Bootstrap the internal owner-only Windows persistent transport descriptor.',
				WINDOWS_BOOTSTRAP_FLAGS_V1,
				(params: CliDataLike) => {
					let bootstrap: ReturnType<NonNullable<AgentRuntimeCliRegistrationOptionsV1['persistentReadBootstrap']>>;
					try {
						bootstrap = options.persistentReadBootstrap?.() ?? {
							supervisor: {
								state: 'idle',
								available: false,
								consecutiveFailures: 0,
							},
							descriptor: null,
						};
					} catch {
						const clientNonce = params['clientNonce'];
						return bootstrapFailureV1(
							'unavailable',
							true,
							typeof clientNonce === 'string'
								&& WINDOWS_BOOTSTRAP_NONCE_PATTERN_V1.test(clientNonce)
								? clientNonce
								: '',
						);
					}
					return handleAgentRuntimeWindowsBootstrapV1({
						params,
						windows: platformIsWindows,
						supervisor: bootstrap.supervisor,
						descriptor: bootstrap.descriptor,
					});
				},
			);
			state.bootstrapRegistered = true;
		}
		return registrationResultV1(
			[...state.commands],
			state.attempt,
			undefined,
			false,
			bootstrapRequired,
			state.bootstrapRegistered,
		);
	} catch {
		return registrationResultV1(
			[...state.commands],
			state.attempt,
			'cli-handler-registration-failed',
			true,
			bootstrapRequired,
			state.bootstrapRegistered,
		);
	}
}

function registrationResultV1(
	commands: readonly string[],
	attempt: number,
	reason?: string,
	retryable = false,
	bootstrapRequired = false,
	bootstrapRegistered = true,
): AgentRuntimeCliRegistrationResultV1 {
	const commandSet = new Set(commands);
	const missingCommands = [
		...RUNTIME_CLI_COMMANDS_V1
		.map(command => RUNTIME_CLI_HANDLERS_V1[command])
		.filter(command => !commandSet.has(command)),
		...(bootstrapRequired && !bootstrapRegistered ? [WINDOWS_BOOTSTRAP_HANDLER_V1] : []),
	];
	const registered = missingCommands.length === 0;
	return Object.freeze({
		registered,
		commands: Object.freeze([...commands]),
		missingCommands: Object.freeze(missingCommands),
		retryable: !registered && retryable,
		attempt,
		...(!registered && reason ? { reason } : {}),
	});
}

export function createAgentRuntimeCliMetadataV1(plugin: Plugin): CliRuntimeMetadataV1 {
	return {
		appVersion: apiVersion,
		plugin: {
			id: 'operon',
			version: plugin.manifest.version,
			minAppVersion: plugin.manifest.minAppVersion,
		},
		apiVersion: 1,
	};
}

function fallbackFailureEnvelope(
	command: RuntimeCliCommandV1,
	runtimeMetadata: CliRuntimeMetadataV1,
	handlerMs: number,
	stage: 'transport' | 'internal',
	code: 'transport-unavailable' | 'internal-error',
	reason: string,
	retryable: boolean,
): CliResultEnvelopeV1 | TaskWorkflowCliResultEnvelopeV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'cli-result',
		requestId: 'invalid-request',
		command,
		ok: false,
		transport: { channel: 'request-file', inputBytes: 0 },
		vaultIdentity: { expectedMatch: null },
		runtime: runtimeMetadata,
		timing: { handlerMs: Math.max(0, Math.round(handlerMs * 1_000) / 1_000) },
		warnings: [],
		failure: {
			stage,
			error: structuredErrorV1(code, reason, { retryable }),
		},
	};
}
