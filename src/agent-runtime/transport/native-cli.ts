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
import type { RuntimeTimingSinkV1 } from '../runtime/timing-probe';
import { createAgentRuntimeDesktopNodeApiLoaderV1 } from './desktop-node-api';
import { dispatchAgentRuntimeCliV1 } from './dispatcher';
import type { AgentRuntimeDesktopNodeApiV1 } from './types';

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
}

interface AgentRuntimeCliRegistrationStateV1 {
	readonly commands: Set<string>;
	attempt: number;
}

const registrationByPluginInstance = new WeakMap<object, AgentRuntimeCliRegistrationStateV1>();

const COMMAND_DESCRIPTIONS_V1: Readonly<Record<CliCommandV1, string>> = Object.freeze({
	health: 'Read the current Operon Agent Runtime health.',
	capabilities: 'List Operon Agent Runtime capabilities.',
	diagnostics: 'Inspect Operon Runtime, catalog, compatibility, and CLI readiness.',
	catalog: 'Read the live Operon Property Catalog.',
	'entity.resolve': 'Resolve a live Operon task selector.',
	'task.get': 'Read one exact live Operon task.',
	'tasks.query': 'Query the bounded live Operon task index.',
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
		attempt: 0,
	};
	registrationByPluginInstance.set(plugin, state);
	if (state.commands.size === CLI_COMMANDS_V1.length) {
		return registrationResultV1([...state.commands], state.attempt);
	}
	state.attempt += 1;
	const loadNodeApi = createAgentRuntimeDesktopNodeApiLoaderV1();
	try {
		for (const command of CLI_COMMANDS_V1) {
			const handlerId = CLI_COMMAND_HANDLER_V1[command];
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
		return registrationResultV1([...state.commands], state.attempt);
	} catch {
		return registrationResultV1(
			[...state.commands],
			state.attempt,
			'cli-handler-registration-failed',
			true,
		);
	}
}

function registrationResultV1(
	commands: readonly string[],
	attempt: number,
	reason?: string,
	retryable = false,
): AgentRuntimeCliRegistrationResultV1 {
	const commandSet = new Set(commands);
	const missingCommands = CLI_COMMANDS_V1
		.map(command => CLI_COMMAND_HANDLER_V1[command])
		.filter(command => !commandSet.has(command));
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
	command: CliCommandV1,
	runtimeMetadata: CliRuntimeMetadataV1,
	handlerMs: number,
	stage: 'transport' | 'internal',
	code: 'transport-unavailable' | 'internal-error',
	reason: string,
	retryable: boolean,
): CliResultEnvelopeV1 {
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
