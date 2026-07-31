import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type {
	CapabilityAdvertisementV1,
	CapabilityIdV1,
	CliResultEnvelopeV1,
	ContextPackV1,
	ContextRequestV1,
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationResultV1,
	OperonCatalogV1,
	PlacementCandidateRequestV1,
	PlacementCandidatesV1,
	SealedMutationPlanV1,
	StructuredErrorV1,
	TaskContextV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
	TaskGetRequestV1,
	TaskGetResultV1,
	TaskGetHydrationKeyV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
	TaskSelectorV1,
	TimerReadRequestV1,
	TimerReadResultV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	CONTRACT_LIMITS_V1,
	OPERON_ID_PATTERN_V1,
	SOURCE_TRANSITION_RECOVERY_FEATURES_V1,
	canonicalJsonV1,
	errorPolicyForCodeV1,
	sha256HexV1,
	toJsonValueV1,
	structuredErrorV1,
	validateVaultRelativePathV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	OPERON_CLI_VERSION,
	type ProcessRunnerV1,
	type WindowsBrokerClientPortV1,
	executeCliV1,
	isPersistentReadCommandV1,
	parseCliArgsV1,
	sanitizeTerminalTextV1,
} from './client';
import type { PersistentReadTransportV1 } from './persistent-read-client';
import { createPersistentReadTransportV1 } from './persistent-read-feature';
import {
	canonicalSubcommandsV1,
	commandDefinitionByIdV1,
	completionCandidatesV1,
	isCommandGroupPathV1,
	renderCommandHelpV1,
	renderGroupHelpV1,
	renderRootHelpV1,
	resolveCommandDefinitionV1,
} from './command-registry';
import {
	renderHumanWithOptionsV1,
	renderLocalHumanV1,
} from './human-renderer';
import {
	type ResolvedVaultCommandScopeV1,
	assertResolvedVaultCommandScopeV1,
	createResolvedVaultCommandScopeV1,
	loadOperonCliConfigV1,
	operonCliConfigRootV1,
	removeVaultProfileV1,
	resolveVaultV1,
	saveOperonCliConfigV1,
	setDefaultVaultProfileV1,
	upsertVaultProfileV1,
	validateOperonManifestV1,
} from './config';
import {
	askGuidedApplyV1,
	buildGuidedCreationModelV1,
	type GuidedCreationModelV1,
	runGuidedCreationWizardV1,
} from './guided-creation';
import {
	compileCompactCreateBatchIntentV1,
	compileCompactCreateIntentV1,
	type CompactCreateAstV1,
	normalizeCompactValueV1,
	parseCompactCreateArgvV1,
	parseCompactCreateInputV1,
	parseCompactCreateLinesInputV1,
} from './compact-create';
import {
	compactRelationshipUpdateWouldChangeTaskV1,
	compactUpdateRouteV1,
	compileCompactUpdateBatchIntentV1,
	compileCompactRelationshipUpdateIntentV1,
	compileCompactRecurrenceUpdateIntentV1,
	compileCompactUpdateIntentV1,
	parseCompactUpdateLinesInputV1,
	parseCompactUpdateArgvV1,
	type CompactUpdateBatchItemAstV1,
	type CompactUpdateAstV1,
} from './compact-update';
import {
	compileDirectLifecycleIntentV1,
	type DirectLifecycleActionV1,
} from './direct-lifecycle';
import {
	compileDirectPinnedIntentV1,
	type DirectPinnedActionV1,
} from './direct-pinned';
import {
	compileDirectReminderIntentV1,
	parseDirectReminderArgvV1,
	type DirectReminderOperationV1,
} from './direct-reminder';
import {
	compileDirectTimerSessionIntentV1,
	parseDirectTimerSessionArgsV1,
	type DirectTimerSessionActionV1,
} from './direct-timer-session';
import {
	completionHintForShellV1,
	runGuidedSetupWizardV1,
} from './guided-setup';
import {
	askGuidedMaintenanceApplyV1,
	type GuidedMutationIntentV1,
	type GuidedMaintenanceResultV1,
	runGuidedReminderWizardV1,
	runGuidedTaskUpdateWizardV1,
	runGuidedTimerStartWizardV1,
	runGuidedTimerStopWizardV1,
	runGuidedTransitionWizardV1,
} from './guided-maintenance';
import {
	runGuidedConvertWizardV1,
	runGuidedDeleteWizardV1,
	runGuidedRelocateWizardV1,
} from './guided-source-transitions';
import type { InteractiveTerminalPortV1 } from './terminal-port';
import {
	OPERON_CLI_CONVENIENCE_COMMANDS_V1,
	OPERON_CLI_CONVENIENCE_TARGET_POLICIES_V1,
	OPERON_CLI_MUTATION_CAPABILITIES_V1,
} from './manifest-data';
import {
	type StoredMutationPlanV1,
	buildMutationApplyRequestV1,
	abandonRecoverableMutationPlanV1,
	confirmationTokenForPlanV1,
	discardMutationPlanV1,
	listRecoverableMutationPlansV1,
	markMutationPlanDispatchedV1,
	readMutationPlanV1,
	recordMutationOutcomeV1,
	restoreMutationPlanBeforeDispatchV1,
	storeMutationPlanV1,
} from './plan-store';
import {
	listCliSchemaEntrypointsV1,
	listCliSchemasV1,
	readCliManifestV1,
	readCliSchemaV1,
} from './package-assets';
import {
	canonicalVaultIdentityV1,
	liveTransportPlatformStatusV1,
	readInputFileSafelyV1,
} from './protocol';
import {
	runGuidedTaskFinderV1,
	type TaskFinderQueryV1,
	type TaskFinderRuntimeResponseV1,
} from './task-finder';
import {
	renderShellCompletionV1,
	type OperonShellCompletionV1,
} from './shell-completion';
import {
	inspectCliStorageSecurityV1,
	repairCliStorageSecurityV1,
} from './secure-storage';

type LocalCommandV1 =
	| 'help'
	| 'unknown'
	| 'runtime'
	| 'version'
	| 'manifest'
	| 'schema.list'
	| 'schema.get'
	| 'setup'
	| 'doctor'
	| 'completion'
	| 'profile.list'
	| 'profile.default'
	| 'profile.remove'
	| 'task.find'
	| 'plan.show'
	| 'plan.apply'
	| 'plan.recover'
	| 'plan.discard';

interface LocalResultEnvelopeV1 {
	contractVersion: 1;
	kind: 'operon-cli-local-result';
	command: string;
	ok: boolean;
	result?: unknown;
	error?: StructuredErrorV1;
	recovery?: {
		required: true;
		planRef: string;
		action: 'recover-same-plan';
		mutationMayHaveApplied: true;
	};
}

export interface PublicCommandOutcomeV1 {
	exitCode: number;
	json: boolean;
	envelope: CliResultEnvelopeV1 | LocalResultEnvelopeV1;
	human: string;
	/** Internal session handoff; never serialized by the public command writer. */
	_recoveryPlanRef?: string;
	/** Internal plan-store handoff; never serialized by the public command writer. */
	_applyDispatchEvidence?: 'not-started' | 'may-have-started';
}

export interface PublicCommandPortsV1 {
	cwd?: string;
	configRoot?: string;
	interactive?: InteractiveTerminalPortV1;
	input?: Buffer;
	runProcess?: ProcessRunnerV1;
	signal?: AbortSignal;
	requestRoot?: string;
	/** Internal session hint; never serialized or exposed through public output. */
	outputMode?: 'full' | 'envelope-only';
	/** Internal command-scope target; never serialized or exposed through public output. */
	_resolvedTarget?: ResolvedVaultCommandScopeV1;
	/** Internal deferred timings awaiting the first requestId-bearing dispatch. */
	_pendingBenchmarkSpans?: Array<{ span: string; durationMs: number; recorded: boolean }>;
	/** Internal JSONL-session read transport; never serialized or exposed publicly. */
	_persistentReadTransport?: PersistentReadTransportV1;
	/** Internal one-shot transport seam; production uses the build-gated factory. */
	_createPersistentReadTransport?: () => PersistentReadTransportV1 | undefined;
	/** Internal Windows broker seam used by platform acceptance tests. */
	_windowsBrokerClient?: WindowsBrokerClientPortV1;
}

const CONVENIENCE_COMMAND_SET = new Set<string>(OPERON_CLI_CONVENIENCE_COMMANDS_V1);
let benchmarkRuntimeDispatchOrdinal = 0;
const GUIDED_MAINTENANCE_COMMANDS = new Set([
	'task.update',
	'task.transition',
	'reminder.add',
	'reminder.replace',
	'reminder.remove',
	'timer.start',
	'timer.stop',
	'task.convert',
	'task.delete',
	'task.relocate',
]);
const DIRECT_LIFECYCLE_COMMANDS = new Set([
	'task.complete',
	'task.reopen',
	'task.cancel',
]);
const DIRECT_PINNED_COMMANDS = new Set([
	'task.pin',
	'task.unpin',
]);
const DIRECT_REMINDER_COMMANDS = new Set([
	'reminder.add',
	'reminder.replace',
	'reminder.remove',
]);
const DIRECT_TIMER_SESSION_COMMANDS = new Set([
	'timer.session.add',
	'timer.session.update',
	'timer.session.remove',
]);
export function publicUsageV1(): string {
	return renderRootHelpV1();
}

function resolveDiscoveryCommand(argv: string[]): PublicCommandOutcomeV1 | undefined {
	if (argv.length === 0) {
		return helpOutcome('root', renderRootHelpV1('short'));
	}
	if (argv[0] === 'help') {
		const json = argv.includes('--json');
		const tokens = argv.slice(1).filter(token => token !== '--json');
		if (tokens.length === 1 && (tokens[0] === '--help' || tokens[0] === '-h')) {
			return helpOutcome('help', renderCommandHelpV1(
				commandDefinitionByIdV1('help')!,
			));
		}
		return resolveHelpTokens(tokens, false, json);
	}
	const helpIndex = argv.findIndex(token => token === '--help' || token === '-h');
	if (helpIndex >= 0) {
		const json = argv.includes('--json');
		const tokens = argv.slice(0, helpIndex).filter(token => !token.startsWith('-'));
		return resolveHelpTokens(tokens, true, json);
	}
	const resolved = resolveCommandDefinitionV1(argv);
	if (resolved) return undefined;
	if (isCommandGroupPathV1(argv)) {
		return helpOutcome(argv.join('.'), renderGroupHelpV1(argv) ?? renderRootHelpV1());
	}
	return unknownCommandOutcome(argv);
}

function resolveHelpTokens(
	tokens: string[],
	allowTrailingArguments = false,
	json = false,
): PublicCommandOutcomeV1 {
	if (tokens.length === 0) return helpOutcome('root', renderRootHelpV1());
	if (isCommandGroupPathV1(tokens)) {
		return helpOutcome(tokens.join('.'), renderGroupHelpV1(tokens) ?? renderRootHelpV1());
	}
	const resolved = resolveCommandDefinitionV1(tokens);
	if (resolved && (allowTrailingArguments || resolved.consumed === tokens.length)) {
		return helpOutcome(resolved.definition.id, renderCommandHelpV1(resolved.definition));
	}
	return unknownCommandOutcome(tokens, json);
}

function helpOutcome(topic: string, human: string): PublicCommandOutcomeV1 {
	return {
		exitCode: 0,
		json: false,
		envelope: {
			contractVersion: 1,
			kind: 'operon-cli-local-result',
			command: 'help',
			ok: true,
			result: { topic },
		},
		human,
	};
}

function unknownCommandOutcome(
	argv: readonly string[],
	json = argv.includes('--json'),
): PublicCommandOutcomeV1 {
	let groupTokens: string[] = [];
	for (let length = 1; length <= argv.length; length++) {
		const candidate = argv.slice(0, length);
		if (isCommandGroupPathV1(candidate)) groupTokens = candidate;
		else break;
	}
	const group = groupTokens.length > 0 ? groupTokens.join(' ') : undefined;
	const rawToken = group ? (argv[groupTokens.length] ?? '') : (argv[0] ?? '');
	const token = boundedTerminalToken(rawToken);
	const candidates = group
		? canonicalSubcommandsV1(groupTokens)
		: completionCandidatesV1([]);
	const suggestion = nearestCommandToken(token, candidates);
	const scope = group ? ` under "${boundedTerminalToken(group)}"` : '';
	const detail = suggestion
		? `\nDid you mean "${group ? `${group} ` : ''}${suggestion}"?`
		: candidates.length > 0
			? `\nAvailable commands: ${candidates.join(', ')}`
			: '';
	const help = group ? `operon ${boundedTerminalToken(group)} --help` : 'operon --help';
	const reason = `Unknown command "${token}"${scope}.`;
	const human = `Error: ${reason}${detail}\nRun "${help}" to see available commands.`;
	return {
		exitCode: 2,
		json,
		envelope: {
			contractVersion: 1,
			kind: 'operon-cli-local-result',
			command: 'unknown',
			ok: false,
			error: structuredErrorV1('invalid-request', reason, {
				details: { reasonCode: 'unknown-command' },
			}),
		},
		human,
	};
}

function boundedTerminalToken(value: string): string {
	return [...sanitizeTerminalTextV1(value)].slice(0, 120).join('');
}

function nearestCommandToken(value: string, candidates: readonly string[]): string | undefined {
	if (!value) return undefined;
	const ranked = candidates
		.map(candidate => ({ candidate, distance: editDistance(value, candidate) }))
		.filter(item => item.distance <= 2)
		.sort((left, right) => (
			left.distance - right.distance || left.candidate.localeCompare(right.candidate)
		));
	return ranked[0]?.candidate;
}

function editDistance(left: string, right: string): number {
	const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
			);
		}
		previous.splice(0, previous.length, ...current);
	}
	return previous[right.length];
}

export async function runPublicCommandLineV1(
	argv: string[],
	ports: PublicCommandPortsV1 = {},
): Promise<PublicCommandOutcomeV1> {
	const commandResolutionStartedAt = performance.now();
	let commandResolutionRecorded = false;
	const recordCommandResolution = (): void => {
		if (commandResolutionRecorded) return;
		commandResolutionRecorded = true;
		recordBenchmarkSubspan(
			argv,
			undefined,
			'command-resolution',
			performance.now() - commandResolutionStartedAt,
		);
	};
	const discovery = resolveDiscoveryCommand(argv);
	if (discovery) {
		recordCommandResolution();
		return discovery;
	}
	if (argv[0] === 'mutation' && argv[1] === 'apply') {
		recordCommandResolution();
		const planRef = readFlag(argv, '--plan-ref');
		if (!planRef || readFlag(argv, '--input')) {
			return localFailure('runtime', argv.includes('--json'), new Error('RAW_MUTATION_APPLY_DISABLED'));
		}
		const rewritten = [
			planRef,
			...removeFlag(argv.slice(2), '--plan-ref'),
		];
		return await runPlanApply(
			rewritten,
			argv.includes('--json'),
			ports,
			ports.configRoot ?? operonCliConfigRootV1(),
			false,
		);
	}
	const local = parseLocalCommand(argv);
	if (local) {
		recordCommandResolution();
		return await runLocalCommand(local.command, local.consumed, argv, ports);
	}
	const convenience = parseConvenienceCommand(argv);
	if (convenience) {
		recordCommandResolution();
		try {
			return await runConvenienceCommand(convenience.command, convenience.consumed, argv, ports);
		} catch (error) {
			return localFailure(convenience.command, argv.includes('--json'), error);
		}
	}
	recordCommandResolution();
	return await runRuntimeCommand(argv, ports);
}

async function runRuntimeCommand(
	argv: string[],
	ports: PublicCommandPortsV1,
	options: { input?: Buffer } = {},
): Promise<PublicCommandOutcomeV1> {
	const json = argv.includes('--json');
	const definition = resolveCommandDefinitionV1(argv, 'runtime')?.definition;
	const benchmarkStartedAt = performance.now();
	const benchmarkSpan = createBenchmarkSpanSink(argv, options.input ?? ports.input);
	let benchmarkRecorded = false;
	let ownedPersistentReadTransport: PersistentReadTransportV1 | undefined;
	const recordBenchmark = (): void => {
		if (benchmarkRecorded) return;
		benchmarkRecorded = true;
		try {
			recordBenchmarkRuntimeDispatch(argv, performance.now() - benchmarkStartedAt);
		} catch {
			// Benchmark-only telemetry must never change the command outcome.
		}
	};
	try {
		if (benchmarkSpan && ports._pendingBenchmarkSpans) {
			for (const pending of ports._pendingBenchmarkSpans) {
				if (pending.recorded) continue;
				pending.recorded = true;
				benchmarkSpan(pending.span, pending.durationMs);
			}
		}
		const resolved = resolveRuntimeVaultArgs(argv, ports, benchmarkSpan);
		const cliOptions = parseCliArgsV1(resolved.argv);
		if (
			!ports._persistentReadTransport
			&& isPersistentReadCommandV1(cliOptions.command)
		) {
			ownedPersistentReadTransport = ports._createPersistentReadTransport
				? ports._createPersistentReadTransport()
				: createPersistentReadTransportV1();
		}
		const persistentReadTransport = ports._persistentReadTransport
			?? ownedPersistentReadTransport;
		const outcome = await executeCliV1(cliOptions, {
			...(ports.runProcess ? { runProcess: ports.runProcess } : {}),
			...(options.input ?? ports.input ? { input: options.input ?? ports.input } : {}),
			...(ports.signal ? { signal: ports.signal } : {}),
			...(ports.requestRoot ? { requestRoot: ports.requestRoot } : {}),
			...(ports._windowsBrokerClient
				? { windowsBrokerClient: ports._windowsBrokerClient }
				: {}),
			clientIdentityPath: join(
				ports.configRoot ?? operonCliConfigRootV1(),
				'client-v1.json',
			),
			resolvedVaultFence: resolved.target.vaultFence,
			...(benchmarkSpan ? { benchmarkSpan } : {}),
			...(persistentReadTransport
				? { persistentReadTransport }
				: {}),
		});
		recordBenchmark();
		let envelope: CliResultEnvelopeV1 = {
			...outcome.envelope,
			...(resolved.profile ? {
				client: {
					...outcome.envelope.client,
					profile: resolved.profile,
				},
			} : {}),
		};
		if (
			outcome.exitCode === 0
			&& outcome.invocation?.command === 'mutation.preview'
			&& outcome.invocation.request?.kind === 'mutation-preview'
			&& envelope.ok
			&& isMutationPreviewSuccess(envelope.result)
		) {
			const planPersistenceStartedAt = performance.now();
			assertResolvedVaultCommandScopeV1(resolved.target);
			const record = storeMutationPlanV1({
				vaultPath: resolved.canonicalPath,
				vaultSha256: outcome.invocation.expectedVaultSha256,
				...(resolved.profile ? { profile: resolved.profile } : {}),
				request: outcome.invocation.request,
				plan: envelope.result.plan,
			}, ports.configRoot ?? operonCliConfigRootV1());
			benchmarkSpan?.(
				'plan-persistence',
				Math.max(0, performance.now() - planPersistenceStartedAt),
			);
			envelope = {
				...envelope,
				client: {
					...envelope.client,
					...(resolved.profile ? { profile: resolved.profile } : {}),
					planRef: record.planRef,
				},
			};
		}
		const humanRenderingStartedAt = performance.now();
		const human = ports.outputMode === 'envelope-only'
			&& outcome.exitCode === 0
			&& envelope.ok
			? ''
			: renderPublicRuntimeHuman(envelope);
		benchmarkSpan?.(
			'human-rendering',
			Math.max(0, performance.now() - humanRenderingStartedAt),
		);
		return {
			exitCode: outcome.exitCode,
			json,
			envelope,
			human,
			...(outcome._applyDispatchEvidence
				? { _applyDispatchEvidence: outcome._applyDispatchEvidence }
				: {}),
		};
	} catch (error) {
		recordBenchmark();
		return localFailure(definition?.id ?? 'runtime', json, error);
	} finally {
		ownedPersistentReadTransport?.close();
	}
}

function createBenchmarkSpanSink(
	argv: readonly string[],
	input?: Buffer,
): ((span: string, durationMs: number) => void) | undefined {
	if (
		!process.env.OPERON_CLI_BENCHMARK_TRACE_PATH
		|| process.env.OPERON_CLI_BENCHMARK_SUBSPANS !== '1'
	) return undefined;
	benchmarkRuntimeDispatchOrdinal += 1;
	const dispatch = String(benchmarkRuntimeDispatchOrdinal);
	return (span, durationMs) => {
		try {
			recordBenchmarkSubspan(argv, input, span, durationMs, dispatch);
		} catch {
			// Benchmark-only telemetry must never change the command outcome.
		}
	};
}

function recordBenchmarkSubspan(
	argv: readonly string[],
	input: Buffer | undefined,
	span: string,
	durationMs: number,
	dispatch?: string,
): void {
	const dispatchTracePath = process.env.OPERON_CLI_BENCHMARK_TRACE_PATH;
	if (!dispatchTracePath) return;
	if (
		!/^\/private\/tmp\/operon-cli-speed-[^/]+\/runtime-dispatches\.jsonl$/u.test(
			dispatchTracePath,
		)
	) {
		throw new Error('BENCHMARK_TRACE_PATH_INVALID');
	}
	const requestId = benchmarkRequestId(argv, input);
	const tracePath = dispatchTracePath.replace(/runtime-dispatches\.jsonl$/u, 'cli-subspans.jsonl');
	appendFileSync(
		tracePath,
		`${JSON.stringify({
			kind: 'cli-subspan',
			recordedAt: new Date().toISOString(),
			pid: process.pid,
			command: argv.slice(0, 2),
			span,
			durationMs: Math.max(0, durationMs),
			...(requestId ? { requestId } : {}),
			...(process.env.OPERON_CLI_BENCHMARK_SCENARIO
				? { scenario: process.env.OPERON_CLI_BENCHMARK_SCENARIO }
				: {}),
			...(process.env.OPERON_CLI_BENCHMARK_PHASE
				? { phase: process.env.OPERON_CLI_BENCHMARK_PHASE }
				: {}),
			...(process.env.OPERON_CLI_BENCHMARK_SAMPLE
				? { sample: process.env.OPERON_CLI_BENCHMARK_SAMPLE }
				: {}),
			...(process.env.OPERON_CLI_BENCHMARK_DISPATCH || dispatch
				? { dispatch: process.env.OPERON_CLI_BENCHMARK_DISPATCH ?? dispatch }
				: {}),
		})}\n`,
		{ encoding: 'utf8', mode: 0o600 },
	);
}

function benchmarkRequestId(argv: readonly string[], input?: Buffer): string | undefined {
	const flagRequestId = readFlag([...argv], '--request-id');
	if (flagRequestId) return flagRequestId;
	if (process.env.OPERON_CLI_BENCHMARK_REQUEST_ID) {
		return process.env.OPERON_CLI_BENCHMARK_REQUEST_ID;
	}
	if (!input) return undefined;
	try {
		const parsed = JSON.parse(input.toString('utf8')) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			&& typeof (parsed as Record<string, unknown>).requestId === 'string'
			? String((parsed as Record<string, unknown>).requestId)
			: undefined;
	} catch {
		return undefined;
	}
}

function recordBenchmarkRuntimeDispatch(argv: readonly string[], outerWallMs: number): void {
	const tracePath = process.env.OPERON_CLI_BENCHMARK_TRACE_PATH;
	if (!tracePath) return;
	if (
		!/^\/private\/tmp\/operon-cli-speed-[^/]+\/runtime-dispatches\.jsonl$/u.test(tracePath)
	) {
		throw new Error('BENCHMARK_TRACE_PATH_INVALID');
	}
	appendFileSync(
		tracePath,
		`${JSON.stringify({
			recordedAt: new Date().toISOString(),
			pid: process.pid,
			command: argv.slice(0, 2),
			outerWallMs,
		})}\n`,
		{ encoding: 'utf8', mode: 0o600 },
	);
}

async function runConvenienceCommand(
	command: string,
	consumed: number,
	argv: string[],
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const allowsGuidedCreation = command === 'task.create';
	const allowsGuidedMaintenance = GUIDED_MAINTENANCE_COMMANDS.has(command);
	const allowsCompactUpdate = command === 'task.update';
	const allowsDirectLifecycle = DIRECT_LIFECYCLE_COMMANDS.has(command);
	const allowsDirectPinned = DIRECT_PINNED_COMMANDS.has(command);
	const allowsDirectReminder = DIRECT_REMINDER_COMMANDS.has(command);
	const allowsDirectTimerSession = DIRECT_TIMER_SESSION_COMMANDS.has(command);
	const allowsDirectSourceTransition = command === 'task.relocate' || command === 'task.convert';
	const allowsDirectDelete = command === 'task.delete';
	const allowsDirectMutation = allowsDirectLifecycle
		|| allowsDirectPinned
		|| allowsDirectReminder
		|| allowsDirectTimerSession
		|| allowsDirectSourceTransition
		|| allowsDirectDelete;
	const parsed = parseFlags(argv.slice(consumed), {
		value: [
			'--vault',
			'--profile',
			'--input',
			'--timeout-ms',
			'--request-id',
			'--obsidian-bin',
			...(allowsGuidedCreation || allowsCompactUpdate ? ['--input-format'] : []),
			...(allowsCompactUpdate || allowsDirectMutation ? ['--id', '--description'] : []),
			...(allowsDirectSourceTransition ? ['--target-file'] : []),
			...(command === 'task.relocate' || command === 'task.convert' ? ['--line'] : []),
			...(command === 'task.convert' ? ['--to', '--template'] : []),
			...(allowsCompactUpdate ? ['--scope'] : []),
			...(allowsDirectReminder ? ['--current'] : []),
			...(allowsDirectTimerSession ? ['--session', '--start', '--end'] : []),
		],
		repeatableValue: allowsCompactUpdate ? ['--clear'] : [],
		boolean: [
			'--json',
			...(allowsGuidedCreation || allowsCompactUpdate || allowsDirectMutation
				? ['--preview-only']
				: []),
		],
		...(allowsGuidedCreation || allowsCompactUpdate || allowsDirectMutation
			? { positional: 'any' as const }
			: {}),
	});
	if (allowsGuidedCreation) {
		const inputPath = parsed.values['--input'];
		const inputFormat = parsed.values['--input-format'];
		if (inputFormat && !inputPath) throw new Error('INPUT_FORMAT_REQUIRES_INPUT');
		if (
			inputFormat
			&& inputFormat !== 'json'
			&& inputFormat !== 'compact'
			&& inputFormat !== 'compact-lines'
		) {
			throw new Error('INPUT_FORMAT_UNSUPPORTED');
		}
		if (inputPath && parsed.positionals.length > 0) throw new Error('COMPACT_INPUT_CONFLICT');
		if (inputPath && inputFormat === 'compact') {
			const ast = parseCompactCreateInputV1(await readInputText(inputPath, ports.input));
			return await runCompactCreationCommand(ast, parsed, ports, true);
		}
		if (inputPath && inputFormat === 'compact-lines') {
			const asts = parseCompactCreateLinesInputV1(await readInputText(
				inputPath,
				ports.input,
				'COMPACT_BATCH_UTF8_INVALID',
			));
			return await runCompactBatchCreationCommand(asts, parsed, ports);
		}
		if (!inputPath) {
			const route = parseCompactCreateArgvV1(parsed.positionals);
			if (route.route === 'compact') {
				return await runCompactCreationCommand(route.ast, parsed, ports, false);
			}
		}
	}
	if (allowsGuidedCreation && parsed.booleans.has('--preview-only')) {
		if (parsed.values['--input'] || parsed.booleans.has('--json')) {
			throw new Error('GUIDED_PREVIEW_ONLY_CONFLICT');
		}
	}
	if (allowsGuidedCreation && !parsed.values['--input']) {
		if (parsed.booleans.has('--json')) throw new Error('INPUT_REQUIRED');
		return await runGuidedCreationCommand(parsed, ports);
	}
	if (allowsCompactUpdate) {
		const inputPath = parsed.values['--input'];
		const inputFormat = parsed.values['--input-format'];
		if (inputFormat && !inputPath) throw new Error('INPUT_FORMAT_REQUIRES_INPUT');
		if (inputFormat && inputFormat !== 'json' && inputFormat !== 'compact-lines') {
			throw new Error('INPUT_FORMAT_UNSUPPORTED');
		}
		const recurrenceScope = parsed.values['--scope'];
		if (
			recurrenceScope !== undefined
			&& recurrenceScope !== 'this-task'
			&& recurrenceScope !== 'this-and-following'
		) {
			throw new Error('RECURRENCE_SCOPE_INVALID');
		}
		const hasDirectArguments = (
			parsed.values['--id'] !== undefined
			|| parsed.values['--description'] !== undefined
			|| parsed.values['--scope'] !== undefined
			|| parsed.positionals.length > 0
			|| (parsed.multiValues['--clear']?.length ?? 0) > 0
			|| parsed.booleans.has('--preview-only')
		);
		if (inputPath && hasDirectArguments) throw new Error('COMPACT_UPDATE_INPUT_CONFLICT');
		if (inputPath && inputFormat === 'compact-lines') {
			const items = parseCompactUpdateLinesInputV1(await readInputText(
				inputPath,
				ports.input,
				'COMPACT_UPDATE_BATCH_UTF8_INVALID',
			));
			return await runCompactUpdateBatchCommand(items, parsed, ports);
		}
		if (!inputPath && hasDirectArguments) {
			const ast = parseCompactUpdateArgvV1(
				parsed.positionals,
				parsed.multiValues['--clear'] ?? [],
			);
			return await runCompactUpdateCommand(ast, parsed, ports);
		}
	}
	if (allowsDirectLifecycle) {
		if (parsed.values['--input']) throw new Error('DIRECT_MUTATION_INPUT_CONFLICT');
		if (parsed.positionals.length > 0) throw new Error('DIRECT_LIFECYCLE_ASSIGNMENT_UNAVAILABLE');
		return await runDirectLifecycleCommand(
			command.split('.')[1] as DirectLifecycleActionV1,
			parsed,
			ports,
		);
	}
	if (
		allowsDirectPinned
		&& parsed.values['--input']
		&& (
			parsed.values['--id'] !== undefined
			|| parsed.values['--description'] !== undefined
			|| parsed.positionals.length > 0
			|| parsed.booleans.has('--preview-only')
		)
	) {
		throw new Error('DIRECT_MUTATION_INPUT_CONFLICT');
	}
	if (allowsDirectPinned && !parsed.values['--input']) {
		if (parsed.positionals.length > 0) throw new Error('DIRECT_PINNED_ASSIGNMENT_UNAVAILABLE');
		return await runDirectPinnedCommand(
			command.split('.')[1] as DirectPinnedActionV1,
			parsed,
			ports,
		);
	}
	if (allowsDirectReminder) {
		const hasDirectArguments = (
			parsed.values['--id'] !== undefined
			|| parsed.values['--description'] !== undefined
			|| parsed.values['--current'] !== undefined
			|| parsed.positionals.length > 0
			|| parsed.booleans.has('--preview-only')
		);
		if (parsed.values['--input'] && hasDirectArguments) {
			throw new Error('DIRECT_MUTATION_INPUT_CONFLICT');
		}
		if (!parsed.values['--input'] && hasDirectArguments) {
			return await runDirectReminderCommand(
				command.split('.')[1] as DirectReminderOperationV1,
				parsed,
				ports,
			);
		}
	}
	if (allowsDirectTimerSession) {
		const hasDirectArguments = (
			parsed.values['--id'] !== undefined
			|| parsed.values['--description'] !== undefined
			|| parsed.values['--session'] !== undefined
			|| parsed.values['--start'] !== undefined
			|| parsed.values['--end'] !== undefined
			|| parsed.booleans.has('--preview-only')
		);
		if (parsed.values['--input'] && hasDirectArguments) {
			throw new Error('DIRECT_MUTATION_INPUT_CONFLICT');
		}
		if (!parsed.values['--input'] && hasDirectArguments) {
			if (parsed.positionals.length > 0) {
				throw new Error('DIRECT_TIMER_SESSION_ASSIGNMENT_UNAVAILABLE');
			}
			return await runDirectTimerSessionCommand(
				command.split('.')[2] as DirectTimerSessionActionV1,
				parsed,
				ports,
			);
		}
	}
	if (allowsDirectSourceTransition) {
		const hasDirectArguments = (
			parsed.values['--id'] !== undefined
			|| parsed.values['--description'] !== undefined
			|| parsed.values['--target-file'] !== undefined
			|| parsed.values['--line'] !== undefined
			|| parsed.values['--to'] !== undefined
			|| parsed.values['--template'] !== undefined
			|| parsed.booleans.has('--preview-only')
		);
		if (parsed.values['--input'] && hasDirectArguments) {
			throw new Error('DIRECT_MUTATION_INPUT_CONFLICT');
		}
		if (!parsed.values['--input'] && hasDirectArguments) {
			if (parsed.positionals.length > 0) throw new Error('DIRECT_SOURCE_TRANSITION_ASSIGNMENT_UNAVAILABLE');
			return await runDirectSourceTransitionCommand(command, parsed, ports);
		}
	}
	if (allowsDirectDelete) {
		const hasDirectArguments = (
			parsed.values['--id'] !== undefined
			|| parsed.values['--description'] !== undefined
			|| parsed.booleans.has('--preview-only')
		);
		if (parsed.values['--input'] && hasDirectArguments) {
			throw new Error('DIRECT_MUTATION_INPUT_CONFLICT');
		}
		if (!parsed.values['--input'] && hasDirectArguments) {
			if (parsed.positionals.length > 0) throw new Error('DIRECT_DELETE_ASSIGNMENT_UNAVAILABLE');
			return await runDirectDeleteCommand(parsed, ports);
		}
	}
	if (allowsGuidedMaintenance && !parsed.values['--input']) {
		if (parsed.booleans.has('--json')) throw new Error('INPUT_REQUIRED');
		return await runGuidedMaintenanceCommand(command, parsed, ports);
	}
	if (!parsed.values['--input']) throw new Error('INPUT_REQUIRED');
	if (parsed.positionals.length > 0) throw new Error('GUIDED_INPUT_CONFLICT');
	const intent = parseMutationIntent(await readInput(parsed.values['--input'], ports.input));
	const mapping = convenienceMapping(command, intent.spec);
	if (intent.spec.operation !== mapping.operation) throw new Error('MUTATION_OPERATION_MISMATCH');
	if (
		(command === 'task.pin' && intent.spec.pinned !== true)
		|| (command === 'task.unpin' && intent.spec.pinned !== false)
	) {
		throw new Error('PINNED_ACTION_MISMATCH');
	}
	const targetPolicy = OPERON_CLI_CONVENIENCE_TARGET_POLICIES_V1[
		command as keyof typeof OPERON_CLI_CONVENIENCE_TARGET_POLICIES_V1
	];
	const batchTargetInSpec = command === 'task.update' && intent.spec.operation === 'update-batch';
	if (targetPolicy === 'required' && !intent.target && !batchTargetInSpec) {
		throw new Error('EXACT_TARGET_REQUIRED');
	}
	if (targetPolicy === 'forbidden' && intent.target) throw new Error('TARGET_NOT_ALLOWED');
	const requestId = intent.requestId ?? parsed.values['--request-id'] ?? randomUUID();
	const request: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId,
		kind: 'mutation-preview',
		clientInstanceId: 'operon-cli-pending',
		idempotencyKey: intent.idempotencyKey ?? randomUUID(),
		...(intent.correlationId ? { correlationId: intent.correlationId } : {}),
		capability: mapping.capability,
		mutationKind: mapping.mutationKind,
		...(intent.target ? { target: intent.target } : {}),
		spec: intent.spec as unknown as MutationPreviewRequestV1['spec'],
		authorization: {
			basis: 'user-explicit-request',
			reason: intent.reason ?? `The user requested Operon ${command}.`,
		},
	};
	const runtimeArgs = [
		'mutation',
		'preview',
		'--input',
		'-',
		...(parsed.values['--vault'] ? ['--vault', parsed.values['--vault']] : []),
		...(parsed.values['--profile'] ? ['--profile', parsed.values['--profile']] : []),
		...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
		...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
		...(parsed.booleans.has('--json') ? ['--json'] : []),
	];
	return await runRuntimeCommand(runtimeArgs, ports, {
		input: Buffer.from(JSON.stringify(request), 'utf8'),
	});
}

async function runCompactCreationCommand(
	ast: CompactCreateAstV1,
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
	inputMode: boolean,
): Promise<PublicCommandOutcomeV1> {
	const scopedPorts = withResolvedRuntimeTargetV1(parsed.values, ports);
	const requireApply = !inputMode && !parsed.booleans.has('--preview-only');
	const creation = await loadCreationModelV1(
		parsed,
		scopedPorts,
		requireApply,
		'COMPACT_CAPABILITY_UNAVAILABLE',
		false,
	);
	if ('outcome' in creation) {
		return { ...creation.outcome, json: parsed.booleans.has('--json') };
	}
	const intent = compileCompactCreateIntentV1({
		ast,
		model: creation.model,
		itemRef: randomUUID(),
	});
	const runtimeTargetArgs = creation.runtimeTargetArgs;
	const preview = await runConvenienceCommand(
		'task.create',
		2,
		[
			'task',
			'create',
			'--input',
			'-',
			...runtimeTargetArgs,
			...(parsed.values['--request-id']
				? ['--request-id', parsed.values['--request-id']]
				: []),
			...(parsed.booleans.has('--json') ? ['--json'] : []),
		],
		{ ...scopedPorts, input: Buffer.from(JSON.stringify(intent), 'utf8') },
	);
	if (
		preview.exitCode !== 0
		|| preview.envelope.kind !== 'cli-result'
		|| !preview.envelope.ok
		|| !preview.envelope.client?.planRef
	) {
		return preview;
	}
	const planRef = preview.envelope.client.planRef;
	if (inputMode || parsed.booleans.has('--preview-only')) {
		return compactPreviewOutcome(preview, planRef, 'No task was created.');
	}
	const root = scopedPorts.configRoot ?? operonCliConfigRootV1();
	const stored = readMutationPlanV1(planRef, root);
	if (
		!isExpectedCompactSingleCreationPlanV1(stored.plan, intent.spec)
		|| !isCompactPreviewSafeToAutoApply(preview, stored.plan, true, true)
	) {
		return compactPreviewOutcome(
			preview,
			planRef,
			'The reviewed plan requires explicit handling and was not applied.',
		);
	}
	return await runPlanApply(
		[
			planRef,
			...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
			...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
			...(parsed.booleans.has('--json') ? ['--json'] : []),
		],
		parsed.booleans.has('--json'),
		scopedPorts,
		root,
		false,
	);
}

async function runCompactBatchCreationCommand(
	asts: readonly CompactCreateAstV1[],
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const scopedPorts = withResolvedRuntimeTargetV1(parsed.values, ports);
	const creation = await loadCreationModelV1(
		parsed,
		scopedPorts,
		false,
		'COMPACT_BATCH_CAPABILITY_UNAVAILABLE',
		false,
	);
	if ('outcome' in creation) {
		return { ...creation.outcome, json: parsed.booleans.has('--json') };
	}
	const itemRefs = asts.map(() => randomUUID());
	const intent = compileCompactCreateBatchIntentV1({
		asts,
		model: creation.model,
		itemRefs,
	});
	const preview = await runConvenienceCommand(
		'task.create',
		2,
		[
			'task',
			'create',
			'--input',
			'-',
			...creation.runtimeTargetArgs,
			...(parsed.values['--request-id']
				? ['--request-id', parsed.values['--request-id']]
				: []),
			...(parsed.booleans.has('--json') ? ['--json'] : []),
		],
		{ ...scopedPorts, input: Buffer.from(JSON.stringify(intent), 'utf8') },
	);
	if (
		preview.exitCode !== 0
		|| preview.envelope.kind !== 'cli-result'
		|| !preview.envelope.ok
		|| !preview.envelope.client?.planRef
	) {
		return preview;
	}
	const planRef = preview.envelope.client.planRef;
	const root = scopedPorts.configRoot ?? operonCliConfigRootV1();
	const stored = readMutationPlanV1(planRef, root);
	let sealed: { sameSourceAtomicGroup: boolean };
	try {
		sealed = inspectCompactBatchSealedPlanV1(stored.plan, intent.spec);
	} catch (error) {
		discardMutationPlanV1(planRef, root);
		throw error;
	}
	const message = sealed.sameSourceAtomicGroup
		? `${asts.length} tasks were previewed in one sealed source/atomic group. No task was created.`
		: `${asts.length} tasks were previewed across multiple sources or atomic groups. Automatic apply is disabled.`;
	return compactPreviewOutcome(preview, planRef, message);
}

function inspectCompactBatchSealedPlanV1(
	plan: SealedMutationPlanV1,
	expectedSpec: Extract<MutationPreviewRequestV1['spec'], { operation: 'create' }>,
): { sameSourceAtomicGroup: boolean } {
	const expectedItemRefs = expectedSpec.items.map(item => item.itemRef);
	const effectItemRefs = new Set(plan.createEffects?.map(effect => effect.itemRef) ?? []);
	if (
		plan.mutationKind !== 'task.create'
		|| plan.spec.operation !== 'create'
		|| !plan.createEffects
		|| canonicalJsonV1(toJsonValueV1(plan.spec))
			!== canonicalJsonV1(toJsonValueV1(expectedSpec))
		|| plan.spec.items.length !== expectedItemRefs.length
		|| plan.createEffects.length !== expectedItemRefs.length
		|| effectItemRefs.size !== expectedItemRefs.length
		|| expectedItemRefs.some(itemRef => !effectItemRefs.has(itemRef))
	) {
		throw new Error('COMPACT_BATCH_PLAN_MISMATCH');
	}
	const sourcePaths = new Set(plan.createEffects.map(effect => effect.locator.filePath));
	const affectedSourcePaths = new Set(plan.affectedResources
		.filter(resource => resource.resourceKind === 'task-source')
		.map(resource => resource.resourceKey));
	const soleAtomicGroup = plan.atomicGroups.length === 1
		? plan.atomicGroups[0]
		: undefined;
	const soleAtomicResource = soleAtomicGroup?.resources.length === 1
		? soleAtomicGroup.resources[0]
		: undefined;
	const soleAtomicSourceKey = soleAtomicResource?.resourceKind === 'task-source'
		? soleAtomicResource.resourceKey
		: undefined;
	return {
		sameSourceAtomicGroup: sourcePaths.size === 1
			&& affectedSourcePaths.size === 1
			&& soleAtomicSourceKey !== undefined
			&& [...sourcePaths].every(source => affectedSourcePaths.has(source))
			&& [...sourcePaths].every(source => soleAtomicSourceKey === source),
	};
}

function compactPreviewOutcome(
	preview: PublicCommandOutcomeV1,
	planRef: string,
	message: string,
): PublicCommandOutcomeV1 {
	return {
		...preview,
		human: [
			message,
			`Review: operon plan show ${planRef}`,
			`Apply: operon plan apply ${planRef}`,
			`Discard: operon plan discard ${planRef}`,
		].join('\n'),
	};
}

function isExpectedCompactSingleCreationPlanV1(
	plan: SealedMutationPlanV1,
	expectedSpec: Extract<MutationPreviewRequestV1['spec'], { operation: 'create' }>,
): boolean {
	if (expectedSpec.items.length !== 1 || plan.targets.length !== 1) return false;
	try {
		inspectCompactBatchSealedPlanV1(plan, expectedSpec);
		const effect = plan.createEffects?.[0];
		const atomicGroup = plan.atomicGroups.length === 1
			? plan.atomicGroups[0]
			: undefined;
		const atomicTaskSources = atomicGroup?.resources.filter(
			resource => resource.resourceKind === 'task-source',
		) ?? [];
		const affectedTaskSources = plan.affectedResources.filter(
			resource => resource.resourceKind === 'task-source',
		);
		const atomicAdditionalResources = atomicGroup?.resources.filter(
			resource => resource.resourceKind !== 'task-source',
		) ?? [];
		const affectedAdditionalResources = plan.affectedResources.filter(
			resource => resource.resourceKind !== 'task-source',
		);
		const expectsRepeatSeries = expectedSpec.items[0].fields.some(
			field => field.kind === 'recurrence',
		);
		const additionalResourcesMatch = expectsRepeatSeries
			? effect?.repeatSeriesId !== undefined
				&& atomicAdditionalResources.length === 1
				&& atomicAdditionalResources[0].resourceKind === 'repeat-series'
				&& atomicAdditionalResources[0].resourceKey === effect.repeatSeriesId
				&& affectedAdditionalResources.length === 1
				&& affectedAdditionalResources[0].resourceKind === 'repeat-series'
				&& affectedAdditionalResources[0].resourceKey === effect.repeatSeriesId
			: effect?.repeatSeriesId === undefined
				&& atomicAdditionalResources.length === 0
				&& affectedAdditionalResources.length === 0;
		const predictedResourceKeys = plan.predictedEffects.map(predicted => (
			`${predicted.resourceKind}\0${predicted.resourceKey}`
		));
		const affectedResourceKeys = plan.affectedResources.map(resource => (
			`${resource.resourceKind}\0${resource.resourceKey}`
		));
		const expectedTaskSourceAction = effect?.expectedAbsence === true
			? 'create'
			: effect?.targetBeforeDigest !== undefined
				? 'update'
				: undefined;
		const predictedResourcesMatch = predictedResourceKeys.length === affectedResourceKeys.length
			&& predictedResourceKeys.every((key, index) => key === affectedResourceKeys[index])
			&& plan.predictedEffects.every(predicted => (
				predicted.resourceKind === 'repeat-series'
					? predicted.action === 'create'
					: predicted.resourceKind === 'task-source'
						&& predicted.action === expectedTaskSourceAction
			));
		return atomicGroup !== undefined
			&& effect !== undefined
			&& effect.itemRef === expectedSpec.items[0].itemRef
			&& effect.operonId === plan.targets[0].operonId
			&& canonicalJsonV1(toJsonValueV1(effect.locator))
				=== canonicalJsonV1(toJsonValueV1(plan.targets[0].locator))
			&& plan.targets[0].targetDigest
				=== sha256HexV1(canonicalJsonV1(toJsonValueV1(effect)))
			&& atomicTaskSources.length === 1
			&& atomicTaskSources[0].resourceKey === effect.locator.filePath
			&& affectedTaskSources.length === 1
			&& affectedTaskSources[0].resourceKey === effect.locator.filePath
			&& additionalResourcesMatch
			&& predictedResourcesMatch;
	} catch {
		return false;
	}
}

function isCompactPreviewSafeToAutoApply(
	preview: PublicCommandOutcomeV1,
	plan: SealedMutationPlanV1,
	allowApplyTimeValuesProjected = false,
	requireRoutineRisk = false,
): boolean {
	return preview.envelope.kind === 'cli-result'
		&& preview.envelope.warnings.every(warning => (
			isCompactAutoApplyDiagnosticWarning(warning, allowApplyTimeValuesProjected)
		))
		&& isMutationPreviewSuccess(preview.envelope.result)
		&& preview.envelope.result.warnings.every(warning => (
			isCompactAutoApplyDiagnosticWarning(warning, allowApplyTimeValuesProjected)
		))
		&& (
			requireRoutineRisk
				? plan.riskLevel === 'routine'
				: plan.riskLevel !== 'destructive'
		)
		&& !plan.requiresConfirmation
		&& plan.requiredAcknowledgements.length === 0
		&& plan.warnings.every(warning => (
			isCompactAutoApplyDiagnosticWarning(warning, allowApplyTimeValuesProjected)
		));
}

function isCompactAutoApplyDiagnosticWarning(
	warning: { code: string },
	allowApplyTimeValuesProjected: boolean,
): boolean {
	return allowApplyTimeValuesProjected && warning.code === 'apply-time-values-projected';
}

async function runCompactUpdateCommand(
	ast: CompactUpdateAstV1,
	parsed: {
		values: Record<string, string>;
		multiValues: Record<string, string[]>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const id = parsed.values['--id'];
	const rawDescription = parsed.values['--description'];
	const description = rawDescription === undefined
		? undefined
		: normalizeCompactValueV1(rawDescription);
	const route = compactUpdateRouteV1(ast, parsed.values['--scope']);
	if (
		(id === undefined ? 0 : 1) + (rawDescription === undefined ? 0 : 1) !== 1
		|| (description !== undefined && description.length === 0)
	) {
		throw new Error('COMPACT_UPDATE_SELECTOR_REQUIRED');
	}
	if (id !== undefined && !OPERON_ID_PATTERN_V1.test(id)) throw new Error('INVALID_OPERON_ID');
	const scopedPorts = withResolvedRuntimeTargetV1(parsed.values, ports);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values, scopedPorts._resolvedTarget);
	const selector = await resolveExactDirectOperonIdV1({
		...(id
			? { operonId: id }
			: { description: description ?? '' }),
		runtimeTargetArgs,
		ports: scopedPorts,
	});
	if (!selector.ok) return { ...selector.outcome, json: parsed.booleans.has('--json') };
	let intent: GuidedMutationIntentV1;
	let resolvedTask: TaskContextV1;
	if (route === 'relationship-update') {
		const resolved = await resolveExactDirectTaskV1({
			operonId: selector.operonId,
			...(description !== undefined ? { description } : {}),
			incompleteCode: 'RELATIONSHIP_TARGET_INCOMPLETE',
			runtimeTargetArgs,
			ports: scopedPorts,
		});
		if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
		resolvedTask = resolved.task;
		intent = compileCompactRelationshipUpdateIntentV1({
			ast,
			task: resolved.task,
		});
	} else {
		const context = await loadCompactUpdateContextV1({
			operonId: selector.operonId,
			...(description !== undefined ? { description } : {}),
			mutationKind: route === 'recurrence-update' ? 'task.recurrence' : 'task.update',
			runtimeTargetArgs,
			ports: scopedPorts,
		});
		if (!context.ok) return { ...context.outcome, json: parsed.booleans.has('--json') };
		resolvedTask = context.task;
		intent = route === 'recurrence-update'
			? compileCompactRecurrenceUpdateIntentV1({
				ast,
				task: context.task,
				catalog: context.catalog,
				scope: parsed.values['--scope'],
			})
			: compileCompactUpdateIntentV1({
				ast,
				task: context.task,
				catalog: context.catalog,
			});
	}
	if (
		intent.spec.operation === 'update'
		&& Array.isArray(intent.spec.changes)
		&& intent.spec.changes.length === 0
	) {
		return localSuccess(
			'task.update',
			parsed.booleans.has('--json'),
			{ status: 'no-change', operonId: resolvedTask.identity.operonId },
			'No task fields changed.',
		);
	}
	if (
		route === 'relationship-update'
		&& !compactRelationshipUpdateWouldChangeTaskV1(intent, resolvedTask)
	) {
		return localSuccess(
			'task.update',
			parsed.booleans.has('--json'),
			{ status: 'no-change', operonId: resolvedTask.identity.operonId },
			'No task relationships changed.',
		);
	}
	const preview = await runConvenienceCommand(
		'task.update',
		2,
		[
			'task',
			'update',
			'--input',
			'-',
			...runtimeTargetArgs,
			...(parsed.values['--request-id']
				? ['--request-id', parsed.values['--request-id']]
				: []),
			...(parsed.booleans.has('--json') ? ['--json'] : []),
		],
		{ ...scopedPorts, input: Buffer.from(JSON.stringify(intent), 'utf8') },
	);
	if (
		preview.exitCode !== 0
		|| preview.envelope.kind !== 'cli-result'
		|| !preview.envelope.ok
		|| !preview.envelope.client?.planRef
	) {
		return preview;
	}
	const planRef = preview.envelope.client.planRef;
	if (
		isMutationPreviewSuccess(preview.envelope.result)
		&& preview.envelope.result.plan.predictedEffects.length === 0
	) {
		return compactPreviewOutcome(preview, planRef, 'No task fields changed.');
	}
	if (parsed.booleans.has('--preview-only')) {
		return compactPreviewOutcome(preview, planRef, 'No task fields were updated.');
	}
	const root = scopedPorts.configRoot ?? operonCliConfigRootV1();
	const stored = readMutationPlanV1(planRef, root);
	if (
		!isCompactPreviewSafeToAutoApply(preview, stored.plan)
		|| !(route === 'relationship-update'
			? isExpectedCompactRelationshipPlan(stored.plan, intent)
			: route === 'recurrence-update'
				? isExpectedCompactRecurrencePlan(stored.plan, intent)
				: isExpectedCompactUpdatePlan(stored.plan, intent))
	) {
		return compactPreviewOutcome(
			preview,
			planRef,
			'The reviewed update plan requires explicit handling and was not applied.',
		);
	}
	return await runPlanApply(
		[
			planRef,
			...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
			...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
			...(parsed.booleans.has('--json') ? ['--json'] : []),
		],
		parsed.booleans.has('--json'),
		scopedPorts,
		root,
		false,
	);
}

async function runCompactUpdateBatchCommand(
	items: readonly CompactUpdateBatchItemAstV1[],
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const scopedPorts = withResolvedRuntimeTargetV1(parsed.values, ports);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values, scopedPorts._resolvedTarget);
	const readiness = await loadCompactUpdateBatchContextV1({
		operonIds: items.map(item => item.operonId),
		runtimeTargetArgs,
		ports: scopedPorts,
	});
	if (!readiness.ok) {
		return { ...readiness.outcome, json: parsed.booleans.has('--json') };
	}
	const intent = compileCompactUpdateBatchIntentV1({
		items,
		tasks: readiness.tasks,
		catalog: readiness.catalog,
		itemRefs: items.map(() => randomUUID()),
	});
	const preview = await runConvenienceCommand(
		'task.update',
		2,
		[
			'task',
			'update',
			'--input',
			'-',
			...runtimeTargetArgs,
			...(parsed.values['--request-id']
				? ['--request-id', parsed.values['--request-id']]
				: []),
			...(parsed.booleans.has('--json') ? ['--json'] : []),
		],
		{ ...scopedPorts, input: Buffer.from(JSON.stringify(intent), 'utf8') },
	);
	if (
		preview.exitCode !== 0
		|| preview.envelope.kind !== 'cli-result'
		|| !preview.envelope.ok
		|| !preview.envelope.client?.planRef
	) {
		return preview;
	}
	const planRef = preview.envelope.client.planRef;
	const root = scopedPorts.configRoot ?? operonCliConfigRootV1();
	const stored = readMutationPlanV1(planRef, root);
	if (!isExpectedCompactUpdateBatchPlanV1(stored.plan, intent.spec)) {
		discardMutationPlanV1(planRef, root);
		throw new Error('COMPACT_UPDATE_BATCH_PLAN_MISMATCH');
	}
	return compactPreviewOutcome(
		preview,
		planRef,
		`${items.length} exact task updates were previewed in one sealed source/atomic group. No task was updated.`,
	);
}

async function loadCompactUpdateBatchContextV1(options: {
	operonIds: string[];
	runtimeTargetArgs: string[];
	ports: PublicCommandPortsV1;
}): Promise<
	| {
		ok: true;
		tasks: TaskContextV1[];
		catalog: NonNullable<Extract<ContextPackV1, { ok: true }>['catalog']> & {
			policies: NonNullable<Extract<ContextPackV1, { ok: true }>['policies']>;
		};
	}
	| { ok: false; outcome: PublicCommandOutcomeV1 }
> {
	const request = buildCompactUpdateBatchContextRequestV1(
		options.operonIds,
		randomUUID(),
	);
	const outcome = await runRuntimeCommand(
		['context', '--input', '-', ...options.runtimeTargetArgs, '--json'],
		options.ports,
		{ input: Buffer.from(JSON.stringify(request), 'utf8') },
	);
	if (
		outcome.exitCode !== 0
		|| outcome.envelope.kind !== 'cli-result'
		|| !outcome.envelope.ok
	) {
		remapCompactCapabilityFailureV1(outcome, 'COMPACT_UPDATE_BATCH_CAPABILITY_UNAVAILABLE');
		return { ok: false, outcome };
	}
	const context = outcome.envelope.result as ContextPackV1;
	if (!context.ok) return { ok: false, outcome };
	const tasksById = new Map(context.entities.map(task => [task.identity.operonId, task]));
	const tasks = options.operonIds.map(operonId => tasksById.get(operonId));
	const sourcePaths = new Set(tasks.map(task => task?.locator.filePath));
	if (
		context.purpose !== 'mutation-readiness'
		|| context.projection !== 'mutation-preview'
		|| context.entities.length !== options.operonIds.length
		|| tasks.some(task => (
			!task
			|| task.representation !== 'inline'
			|| !task.identity.mutationAllowed
			|| !Array.isArray(task.writableFields)
		))
		|| sourcePaths.size !== 1
		|| sourcePaths.has(undefined)
		|| context.catalog === undefined
		|| context.policies === undefined
		|| context.catalogRevision === undefined
		|| context.resourceRevisions === undefined
		|| context.resourceRevisions.length === 0
		|| context.truncations.length > 0
		|| context.warnings.length > 0
	) {
		throw new Error('COMPACT_UPDATE_BATCH_TARGET_INCOMPLETE');
	}
	return {
		ok: true,
		tasks: tasks as TaskContextV1[],
		catalog: { ...context.catalog, policies: context.policies },
	};
}

export function buildCompactUpdateBatchContextRequestV1(
	operonIds: string[],
	requestId: string,
): ContextRequestV1 {
	return {
		contractVersion: 1,
		requestId,
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		operonIds,
		mutationKind: 'task.update',
	};
}

function isExpectedCompactUpdateBatchPlanV1(
	plan: SealedMutationPlanV1,
	expectedSpec: GuidedMutationIntentV1['spec'],
): boolean {
	if (
		!isPlainRecord(expectedSpec)
		|| expectedSpec.operation !== 'update-batch'
		|| !Array.isArray(expectedSpec.items)
		|| plan.mutationKind !== 'task.update'
		|| canonicalJsonV1(toJsonValueV1(plan.spec))
			!== canonicalJsonV1(toJsonValueV1(expectedSpec))
		|| plan.targets.length !== expectedSpec.items.length
	) return false;
	const expectedTargets = expectedSpec.items.map(item => (
		isPlainRecord(item) && isPlainRecord(item.target) ? item.target : undefined
	));
	if (
		expectedTargets.some(target => !target)
		|| plan.targets.some(target => !target.locator)
		|| plan.targets.some((target, index) => (
			target.operonId !== expectedTargets[index]?.operonId
			|| canonicalJsonV1(toJsonValueV1(target.locator))
				!== canonicalJsonV1(toJsonValueV1(expectedTargets[index]?.locator))
		))
	) return false;
	const sourcePaths = new Set(plan.targets.map(target => target.locator!.filePath));
	const affectedSourcePaths = new Set(plan.affectedResources
		.filter(resource => resource.resourceKind === 'task-source')
		.map(resource => resource.resourceKey));
	const atomicSourcePaths = new Set(plan.atomicGroups.flatMap(group => group.resources
		.filter(resource => resource.resourceKind === 'task-source')
		.map(resource => resource.resourceKey)));
	return plan.atomicGroups.length === 1
		&& sourcePaths.size === 1
		&& affectedSourcePaths.size === 1
		&& atomicSourcePaths.size === 1
		&& [...sourcePaths].every(source => (
			affectedSourcePaths.has(source) && atomicSourcePaths.has(source)
		));
}

async function runDirectLifecycleCommand(
	action: DirectLifecycleActionV1,
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const selector = directSelectorFrom(parsed.values);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const capabilities = await requireDirectMutationCapabilitiesV1({
		preview: 'tasks.transition.preview',
		apply: 'tasks.transition.apply',
		previewOnly: parsed.booleans.has('--preview-only'),
		descriptionTarget: selector.description !== undefined,
		requireCatalog: true,
		runtimeTargetArgs,
		ports,
		json: parsed.booleans.has('--json'),
	});
	if (!capabilities.ok) return capabilities.outcome;
	const resolved = await resolveExactDirectTaskV1({
		...selector,
		incompleteCode: 'DIRECT_TARGET_INCOMPLETE',
		runtimeTargetArgs,
		ports,
	});
	if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
	const catalogOutcome = await runRuntimeCommand(
		['catalog', ...runtimeTargetArgs, '--json'],
		ports,
	);
	if (
		catalogOutcome.exitCode !== 0
		|| catalogOutcome.envelope.kind !== 'cli-result'
		|| !catalogOutcome.envelope.ok
	) {
		return { ...catalogOutcome, json: parsed.booleans.has('--json') };
	}
	const catalog = catalogOutcome.envelope.result as OperonCatalogV1;
	if (!catalog.ok) return { ...catalogOutcome, json: parsed.booleans.has('--json') };
	const compiled = compileDirectLifecycleIntentV1({
		action,
		task: resolved.task,
		catalog,
	});
	if (compiled.status === 'no-change') {
		return localSuccess(
			`task.${action}`,
			parsed.booleans.has('--json'),
			{ status: 'no-change', operonId: resolved.task.identity.operonId },
			compiled.message,
		);
	}
	return await previewAndMaybeApplyDirectIntentV1({
		command: `task.${action}`,
		previewCommand: 'task.transition',
		expectedMutationKind: 'task.transition',
		intent: compiled.intent,
		previewOnly: parsed.booleans.has('--preview-only'),
		parsed,
		runtimeTargetArgs,
		ports,
		previewMessage: 'The task lifecycle action was not applied.',
	});
}

async function runDirectPinnedCommand(
	action: DirectPinnedActionV1,
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const selector = directSelectorFrom(parsed.values);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const capabilities = await requireDirectMutationCapabilitiesV1({
		preview: 'tasks.pinned.preview',
		apply: 'tasks.pinned.apply',
		previewOnly: parsed.booleans.has('--preview-only'),
		descriptionTarget: selector.description !== undefined,
		requireCatalog: false,
		runtimeTargetArgs,
		ports,
		json: parsed.booleans.has('--json'),
	});
	if (!capabilities.ok) return capabilities.outcome;
	const resolved = await resolveExactDirectTaskV1({
		...selector,
		incompleteCode: 'DIRECT_PINNED_TARGET_INCOMPLETE',
		runtimeTargetArgs,
		ports,
	});
	if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
	const compiled = compileDirectPinnedIntentV1({
		action,
		task: resolved.task,
	});
	if (compiled.status === 'no-change') {
		return localSuccess(
			`task.${action}`,
			parsed.booleans.has('--json'),
			{ status: 'no-change', operonId: resolved.task.identity.operonId },
			compiled.message,
		);
	}
	return await previewAndMaybeApplyDirectIntentV1({
		command: `task.${action}`,
		previewCommand: `task.${action}`,
		expectedMutationKind: 'task.pinned-state',
		intent: compiled.intent,
		previewOnly: parsed.booleans.has('--preview-only'),
		parsed,
		runtimeTargetArgs,
		ports,
		previewMessage: `The task was not ${action === 'pin' ? 'pinned' : 'unpinned'}.`,
	});
}

async function runDirectReminderCommand(
	operation: DirectReminderOperationV1,
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const selector = directSelectorFrom(parsed.values);
	const ast = parseDirectReminderArgvV1(
		operation,
		parsed.positionals,
		parsed.values['--current'],
	);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const capabilities = await requireDirectMutationCapabilitiesV1({
		preview: 'tasks.reminder.preview',
		apply: 'tasks.reminder.apply',
		previewOnly: parsed.booleans.has('--preview-only'),
		descriptionTarget: selector.description !== undefined,
		requireCatalog: false,
		runtimeTargetArgs,
		ports,
		json: parsed.booleans.has('--json'),
	});
	if (!capabilities.ok) return capabilities.outcome;
	const resolved = await resolveExactDirectTaskV1({
		...selector,
		...(operation === 'add' ? {} : { include: ['reminder-items'] as const }),
		incompleteCode: 'DIRECT_REMINDER_ITEMS_INCOMPLETE',
		runtimeTargetArgs,
		ports,
	});
	if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
	let intent: GuidedMutationIntentV1;
	try {
		intent = compileDirectReminderIntentV1({ ast, task: resolved.task });
	} catch (error) {
		if (
			error instanceof Error
			&& error.message === 'DIRECT_REMINDER_NO_CHANGE'
		) {
			return localSuccess(
				`reminder.${operation}`,
				parsed.booleans.has('--json'),
				{ status: 'no-change', operonId: resolved.task.identity.operonId },
				'The reminder already has that value.',
			);
		}
		throw error;
	}
	return await previewAndMaybeApplyDirectIntentV1({
		command: `reminder.${operation}`,
		previewCommand: `reminder.${operation}`,
		expectedMutationKind: 'task.reminder-item',
		intent,
		previewOnly: parsed.booleans.has('--preview-only'),
		parsed,
		runtimeTargetArgs,
		ports,
		previewMessage: 'The reminder change was not applied.',
	});
}

async function runDirectTimerSessionCommand(
	action: DirectTimerSessionActionV1,
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const selector = directSelectorFrom(parsed.values);
	const spec = parseDirectTimerSessionArgsV1(action, {
		...(parsed.values['--session'] ? { session: parsed.values['--session'] } : {}),
		...(parsed.values['--start'] ? { start: parsed.values['--start'] } : {}),
		...(parsed.values['--end'] ? { end: parsed.values['--end'] } : {}),
	});
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const capabilities = await requireDirectMutationCapabilitiesV1({
		preview: 'timers.session.preview',
		apply: 'timers.session.apply',
		previewOnly: parsed.booleans.has('--preview-only'),
		descriptionTarget: selector.description !== undefined,
		requireCatalog: false,
		runtimeTargetArgs,
		ports,
		json: parsed.booleans.has('--json'),
	});
	if (!capabilities.ok) return capabilities.outcome;
	const resolved = await resolveExactDirectTaskV1({
		...selector,
		incompleteCode: 'DIRECT_TIMER_SESSION_TARGET_INCOMPLETE',
		runtimeTargetArgs,
		ports,
	});
	if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
	const intent = compileDirectTimerSessionIntentV1({
		spec,
		task: resolved.task,
	});
	return await previewAndMaybeApplyDirectIntentV1({
		command: `timer.session.${action}`,
		previewCommand: `timer.session.${action}`,
		expectedMutationKind: 'timer.session',
		intent,
		previewOnly: parsed.booleans.has('--preview-only'),
		parsed,
		runtimeTargetArgs,
		ports,
		previewMessage: 'The timer session change was not applied.',
		allowInteractiveConfirmation: action === 'remove',
	});
}

async function runDirectSourceTransitionCommand(
	command: 'task.relocate' | 'task.convert',
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const selector = directSelectorFrom(parsed.values);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const previewOnly = parsed.booleans.has('--preview-only');
	const mapping = convenienceMapping(command);
	const capabilities = await requireDirectMutationCapabilitiesV1({
		preview: mapping.capability,
		apply: OPERON_CLI_MUTATION_CAPABILITIES_V1[mapping.mutationKind].apply,
		previewOnly,
		descriptionTarget: selector.description !== undefined,
		requireCatalog: true,
		additional: (
			command === 'task.relocate'
			|| (command === 'task.convert' && parsed.values['--to'] === 'inline')
		) ? ['context.build'] : [],
		runtimeTargetArgs,
		ports,
		json: parsed.booleans.has('--json'),
	});
	if (!capabilities.ok) return capabilities.outcome;
	const resolved = await resolveExactDirectTaskV1({
		...selector,
		incompleteCode: 'DIRECT_SOURCE_TRANSITION_TARGET_INCOMPLETE',
		runtimeTargetArgs,
		ports,
	});
	if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
	const catalogOutcome = await runRuntimeCommand(
		['catalog', ...runtimeTargetArgs, '--json'],
		ports,
	);
	if (
		catalogOutcome.exitCode !== 0
		|| catalogOutcome.envelope.kind !== 'cli-result'
		|| !catalogOutcome.envelope.ok
	) return { ...catalogOutcome, json: parsed.booleans.has('--json') };
	const catalog = catalogOutcome.envelope.result as OperonCatalogV1;
	assertDirectSourceTransitionCatalogV1(catalog);
	let spec: Record<string, unknown>;
	if (command === 'task.relocate') {
		if (resolved.task.representation !== 'inline' || resolved.task.locator.representation !== 'inline') {
			throw new Error('DIRECT_INLINE_TASK_REQUIRED');
		}
		const targetFile = directMarkdownPathV1(parsed.values['--target-file']);
		const line = Number(parsed.values['--line']);
		if (!Number.isSafeInteger(line) || line < 1) throw new Error('DIRECT_LINE_INVALID');
		const request: ContextRequestV1 = {
			contractVersion: 1,
			requestId: randomUUID(),
			kind: 'context',
			consistency: 'live-verified',
			purpose: 'mutation-readiness',
			projection: 'placement-candidates',
			limit: 100,
			placement: { mode: 'lines', filePath: targetFile },
		};
		const placementOutcome = await runRuntimeCommand(
			['context', '--input', '-', ...runtimeTargetArgs, '--json'],
			ports,
			{ input: Buffer.from(JSON.stringify(request), 'utf8') },
		);
		if (
			placementOutcome.exitCode !== 0
			|| placementOutcome.envelope.kind !== 'cli-result'
			|| !placementOutcome.envelope.ok
		) return { ...placementOutcome, json: parsed.booleans.has('--json') };
		const context = placementOutcome.envelope.result as ContextPackV1;
		const candidate = resolveExactDirectPlacementV1(context, targetFile, line);
		spec = {
			operation: 'relocate-inline',
			destination: { locator: candidate.locator, mustBeBlank: true },
		};
	} else {
		const to = parsed.values['--to'];
		if (to === 'file') {
			if (resolved.task.representation !== 'inline' || resolved.task.locator.representation !== 'inline') {
				throw new Error('DIRECT_INLINE_TASK_REQUIRED');
			}
			if (parsed.values['--line'] !== undefined) throw new Error('DIRECT_CONVERT_FLAGS_INVALID');
			const targetPath = directMarkdownPathV1(parsed.values['--target-file']);
			const templateId = resolveExactDirectTemplateIdV1(catalog, parsed.values['--template']);
			spec = {
				operation: 'convert',
				from: 'inline',
				to: 'file',
				templateId,
				targetPath,
			};
		} else if (to === 'inline') {
			if (resolved.task.representation !== 'file' || resolved.task.locator.representation !== 'file') {
				throw new Error('DIRECT_FILE_TASK_REQUIRED');
			}
			if (parsed.values['--template'] !== undefined) throw new Error('DIRECT_CONVERT_FLAGS_INVALID');
			const targetFile = directMarkdownPathV1(parsed.values['--target-file']);
			const line = Number(parsed.values['--line']);
			if (!Number.isSafeInteger(line) || line < 1) throw new Error('DIRECT_LINE_INVALID');
			const request: ContextRequestV1 = {
				contractVersion: 1,
				requestId: randomUUID(),
				kind: 'context',
				consistency: 'live-verified',
				purpose: 'mutation-readiness',
				projection: 'placement-candidates',
				limit: 100,
				placement: { mode: 'lines', filePath: targetFile },
			};
			const placementOutcome = await runRuntimeCommand(
				['context', '--input', '-', ...runtimeTargetArgs, '--json'],
				ports,
				{ input: Buffer.from(JSON.stringify(request), 'utf8') },
			);
			if (
				placementOutcome.exitCode !== 0
				|| placementOutcome.envelope.kind !== 'cli-result'
				|| !placementOutcome.envelope.ok
			) return { ...placementOutcome, json: parsed.booleans.has('--json') };
			const context = placementOutcome.envelope.result as ContextPackV1;
			const candidate = resolveExactDirectPlacementV1(context, targetFile, line);
			spec = {
				operation: 'convert',
				from: 'file',
				to: 'inline',
				target: {
					mode: 'exact-line',
					filePath: candidate.locator.filePath,
					lineNumber: candidate.locator.lineNumber,
				},
			};
		} else {
			throw new Error('DIRECT_CONVERT_TO_INVALID');
		}
	}
	const intent: GuidedMutationIntentV1 = {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: `The user requested direct Operon ${command}.`,
		target: {
			operonId: resolved.task.identity.operonId,
			locator: resolved.task.locator,
		},
		spec,
	};
	return await previewAndMaybeApplyDirectIntentV1({
		command,
		previewCommand: command,
		expectedMutationKind: mapping.mutationKind,
		intent,
		previewOnly,
		parsed,
		runtimeTargetArgs,
		ports,
		previewMessage: 'The source transition was not applied.',
		allowInteractiveConfirmation: command === 'task.convert' && spec.to === 'inline',
	});
}

function assertDirectSourceTransitionCatalogV1(catalog: OperonCatalogV1): void {
	if (
		!catalog.ok
		|| catalog.warnings.length > 0
		|| catalog.freshness.source !== 'live-runtime'
		|| catalog.freshness.coherence !== 'verified'
		|| !catalog.freshness.settled
		|| catalog.policies.sourceTransitionRecoveryVersion !== 1
		|| canonicalJsonV1(toJsonValueV1(catalog.policies.sourceTransitionRecoveryFeatures))
			!== canonicalJsonV1(toJsonValueV1([...SOURCE_TRANSITION_RECOVERY_FEATURES_V1]))
	) throw new Error('DIRECT_SOURCE_TRANSITION_CATALOG_UNAVAILABLE');
}

async function runDirectDeleteCommand(
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const selector = directSelectorFrom(parsed.values);
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const previewOnly = parsed.booleans.has('--preview-only');
	const capabilities = await requireDirectMutationCapabilitiesV1({
		preview: 'tasks.delete.preview',
		apply: 'tasks.delete.apply',
		previewOnly,
		descriptionTarget: selector.description !== undefined,
		requireCatalog: true,
		runtimeTargetArgs,
		ports,
		json: parsed.booleans.has('--json'),
	});
	if (!capabilities.ok) return capabilities.outcome;
	const resolved = await resolveExactDirectTaskV1({
		...selector,
		incompleteCode: 'DIRECT_DELETE_TARGET_INCOMPLETE',
		runtimeTargetArgs,
		ports,
	});
	if (!resolved.ok) return { ...resolved.outcome, json: parsed.booleans.has('--json') };
	const catalogOutcome = await runRuntimeCommand(
		['catalog', ...runtimeTargetArgs, '--json'],
		ports,
	);
	if (
		catalogOutcome.exitCode !== 0
		|| catalogOutcome.envelope.kind !== 'cli-result'
		|| !catalogOutcome.envelope.ok
	) return { ...catalogOutcome, json: parsed.booleans.has('--json') };
	assertDirectSourceTransitionCatalogV1(
		catalogOutcome.envelope.result as OperonCatalogV1,
	);
	const intent: GuidedMutationIntentV1 = {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason: 'The user requested direct deletion of one exact Operon task.',
		target: {
			operonId: resolved.task.identity.operonId,
			locator: resolved.task.locator,
		},
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
	};
	return await previewAndMaybeApplyDirectIntentV1({
		command: 'task.delete',
		previewCommand: 'task.delete',
		expectedMutationKind: 'task.delete',
		intent,
		previewOnly,
		parsed,
		runtimeTargetArgs,
		ports,
		previewMessage: 'The exact task was not deleted.',
		allowInteractiveConfirmation: true,
	});
}

export function directMarkdownPathV1(raw: string | undefined): string {
	const path = raw?.trim() ?? '';
	if (
		!path
		|| path !== path.normalize('NFC')
		|| sanitizeTerminalTextV1(path) !== path
		|| validateVaultRelativePathV1(path) !== null
		|| !path.endsWith('.md')
	) throw new Error('DIRECT_TARGET_FILE_INVALID');
	return path;
}

export function resolveExactDirectTemplateIdV1(
	catalog: OperonCatalogV1,
	raw: string | undefined,
): string {
	const name = raw ?? '';
	if (
		!name
		|| name !== name.normalize('NFC')
		|| sanitizeTerminalTextV1(name) !== name
	) throw new Error('DIRECT_TEMPLATE_INVALID');
	if (!catalog.ok) throw new Error('DIRECT_TEMPLATE_UNAVAILABLE');
	const candidates = catalog.policies.creation.fileTaskTemplateCandidates;
	if (!candidates) throw new Error('DIRECT_TEMPLATE_UNAVAILABLE');
	const matches = candidates.filter(candidate => candidate.name === name);
	if (matches.length !== 1) throw new Error('DIRECT_TEMPLATE_UNAVAILABLE');
	return matches[0].id;
}

export function resolveExactDirectPlacementV1(
	context: ContextPackV1,
	targetFile: string,
	line: number,
): Extract<PlacementCandidatesV1, { mode: 'lines' }>['lines'][number] {
	const placement = context.ok ? context.placement : undefined;
	if (
		!context.ok
		|| context.warnings.length > 0
		|| context.truncations.length > 0
		|| context.execution.source !== 'live-runtime'
		|| context.execution.coherence !== 'verified'
		|| !context.execution.settled
		|| !placement
		|| placement.mode !== 'lines'
		|| placement.filePath !== targetFile
		|| placement.truncated
	) throw new Error('DIRECT_PLACEMENT_UNAVAILABLE');
	const candidate = placement.lines.find(item => (
		item.locator.filePath === targetFile && item.locator.lineNumber === line - 1
	));
	if (!candidate) throw new Error('DIRECT_PLACEMENT_UNAVAILABLE');
	return candidate;
}

function directSelectorFrom(values: Record<string, string>): {
	operonId?: string;
	description?: string;
} {
	const hasId = values['--id'] !== undefined;
	const hasDescription = values['--description'] !== undefined;
	if ((hasId ? 1 : 0) + (hasDescription ? 1 : 0) !== 1) {
		throw new Error('DIRECT_SELECTOR_REQUIRED');
	}
	if (hasId) {
		const operonId = values['--id'];
		if (!operonId || !OPERON_ID_PATTERN_V1.test(operonId)) {
			throw new Error('INVALID_OPERON_ID');
		}
		return { operonId };
	}
	const description = normalizeCompactValueV1(values['--description'] ?? '');
	if (!description) throw new Error('DIRECT_SELECTOR_REQUIRED');
	return { description };
}

async function requireDirectMutationCapabilitiesV1(options: {
	preview: CapabilityIdV1;
	apply: CapabilityIdV1;
	previewOnly: boolean;
	descriptionTarget: boolean;
	requireCatalog: boolean;
	additional?: CapabilityIdV1[];
	runtimeTargetArgs: string[];
	ports: PublicCommandPortsV1;
	json: boolean;
}): Promise<
	| { ok: true }
	| { ok: false; outcome: PublicCommandOutcomeV1 }
> {
	const required: CapabilityIdV1[] = [
		options.preview,
		...(options.previewOnly ? [] : [options.apply]),
		'tasks.read',
		...(options.descriptionTarget ? ['tasks.query' as const] : []),
		...(options.requireCatalog ? ['catalog.read' as const] : []),
		...(options.additional ?? []),
	];
	const capabilities = await runRuntimeCommand(
		['capabilities', ...options.runtimeTargetArgs, '--json'],
		options.ports,
	);
	if (
		capabilities.exitCode !== 0
		|| capabilities.envelope.kind !== 'cli-result'
		|| !capabilities.envelope.ok
	) {
		return { ok: false, outcome: { ...capabilities, json: options.json } };
	}
	assertCapabilitiesAvailable(
		capabilities.envelope.result,
		required,
		'DIRECT_CAPABILITY_UNAVAILABLE',
	);
	return { ok: true };
}

async function previewAndMaybeApplyDirectIntentV1(options: {
	command: string;
	previewCommand: string;
	expectedMutationKind: SealedMutationPlanV1['mutationKind'];
	intent: GuidedMutationIntentV1;
	previewOnly: boolean;
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
	};
	runtimeTargetArgs: string[];
	ports: PublicCommandPortsV1;
	previewMessage: string;
	allowInteractiveConfirmation?: boolean;
}): Promise<PublicCommandOutcomeV1> {
	const preview = await runConvenienceCommand(
		options.previewCommand,
		options.previewCommand.split('.').length,
		[
			...options.previewCommand.split('.'),
			'--input',
			'-',
			...options.runtimeTargetArgs,
			...(options.parsed.values['--request-id']
				? ['--request-id', options.parsed.values['--request-id']]
				: []),
			...(options.parsed.booleans.has('--json') ? ['--json'] : []),
		],
		{ ...options.ports, input: Buffer.from(JSON.stringify(options.intent), 'utf8') },
	);
	if (
		preview.exitCode !== 0
		|| preview.envelope.kind !== 'cli-result'
		|| !preview.envelope.ok
		|| !preview.envelope.client?.planRef
	) {
		return preview;
	}
	const planRef = preview.envelope.client.planRef;
	const root = options.ports.configRoot ?? operonCliConfigRootV1();
	if (
		isMutationPreviewSuccess(preview.envelope.result)
		&& preview.envelope.result.plan.predictedEffects.length === 0
	) {
		return compactPreviewOutcome(preview, planRef, 'No durable change is required.');
	}
	if (options.previewOnly) {
		return compactPreviewOutcome(preview, planRef, options.previewMessage);
	}
	const stored = readMutationPlanV1(planRef, root);
	const expectedPlan = isExpectedDirectMutationKindV1(
		stored.plan,
		options.expectedMutationKind,
	) && isExpectedDirectMutationPlan(stored.plan, options.intent);
	if (expectedPlan && isDirectTimerSessionNoChange(stored.plan)) {
		discardMutationPlanV1(planRef, root);
		return localSuccess(
			options.command,
			options.parsed.booleans.has('--json'),
			{
				status: 'no-change',
				...(options.intent.target?.operonId
					? { operonId: options.intent.target.operonId }
					: {}),
			},
			'The timer session already has that range.',
		);
	}
	if (
		options.allowInteractiveConfirmation
		&& expectedPlan
		&& semanticConfirmationWord(stored.plan)
		&& isExpectedDirectSemanticConfirmationPlanV1(preview, stored.plan)
		&& !options.parsed.booleans.has('--json')
		&& (options.ports.interactive || (process.stdin.isTTY && process.stdout.isTTY))
	) {
		const confirmed = await promptForSemanticConfirmation(
			stored.plan,
			semanticConfirmationWord(stored.plan)!,
			planRef,
			options.ports.interactive,
		);
		if (!confirmed) return compactPreviewOutcome(preview, planRef, options.previewMessage);
		return await runPlanApply(
			[
				planRef,
				'--confirm',
				confirmationTokenForPlanV1(stored.plan),
				...(options.parsed.values['--timeout-ms']
					? ['--timeout-ms', options.parsed.values['--timeout-ms']]
					: []),
				...(options.parsed.values['--obsidian-bin']
					? ['--obsidian-bin', options.parsed.values['--obsidian-bin']]
					: []),
			],
			false,
			options.ports,
			root,
			false,
		);
	}
	if (
		!isCompactPreviewSafeToAutoApply(preview, stored.plan)
		|| !expectedPlan
	) {
		return compactPreviewOutcome(
			preview,
			planRef,
			'The reviewed plan requires explicit handling and was not applied.',
		);
	}
	return await runPlanApply(
		[
			planRef,
			...(options.parsed.values['--timeout-ms']
				? ['--timeout-ms', options.parsed.values['--timeout-ms']]
				: []),
			...(options.parsed.values['--obsidian-bin']
				? ['--obsidian-bin', options.parsed.values['--obsidian-bin']]
				: []),
			...(options.parsed.booleans.has('--json') ? ['--json'] : []),
		],
		options.parsed.booleans.has('--json'),
		options.ports,
		root,
		false,
	);
}

export function isExpectedDirectSemanticConfirmationPlanV1(
	preview: PublicCommandOutcomeV1,
	plan: SealedMutationPlanV1,
): boolean {
	if (
		preview.envelope.kind !== 'cli-result'
		|| preview.envelope.warnings.length > 0
		|| !isMutationPreviewSuccess(preview.envelope.result)
		|| preview.envelope.result.warnings.length > 0
		|| plan.riskLevel !== 'destructive'
		|| !plan.requiresConfirmation
		|| plan.warnings.length > 0
		|| plan.requiredAcknowledgements.length !== 1
	) return false;
	const acknowledgement = plan.requiredAcknowledgements[0];
	if (
		plan.targets.length === 1
		&& plan.mutationKind === 'timer.session'
		&& plan.spec.operation === 'remove-session'
	) {
		return acknowledgement === `confirm:timer.session:${plan.targets[0].operonId}`;
	}
	return plan.targets.length === 1 && plan.mutationKind === 'task.delete'
		? /^confirm:delete:[a-f0-9]{16}$/u.test(acknowledgement)
		: plan.mutationKind === 'task.convert'
			&& plan.spec.operation === 'convert'
			&& plan.spec.from === 'file'
			&& plan.targets.length === 1
			&& /^confirm:convert:[a-f0-9]{16}$/u.test(acknowledgement);
}

export function isExpectedDirectMutationKindV1(
	plan: Pick<SealedMutationPlanV1, 'mutationKind'>,
	expectedMutationKind: SealedMutationPlanV1['mutationKind'],
): boolean {
	return plan.mutationKind === expectedMutationKind;
}

async function resolveExactDirectOperonIdV1(options: {
	operonId?: string;
	description?: string;
	runtimeTargetArgs: string[];
	ports: PublicCommandPortsV1;
}): Promise<
	| { ok: true; operonId: string }
	| { ok: false; outcome: PublicCommandOutcomeV1 }
> {
	let operonId = options.operonId;
	if (!operonId) {
		const description = options.description ?? '';
		if (!description) throw new Error('COMPACT_UPDATE_SELECTOR_REQUIRED');
		const matches: TaskContextV1[] = [];
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
			const request: TaskQueryRequestV1 = {
				contractVersion: 1,
				requestId: randomUUID(),
				kind: 'task-query',
				consistency: 'live-verified',
				filters: { text: description },
				limit: 250,
				...(cursor ? { cursor } : {}),
			};
			const outcome = await runRuntimeCommand(
				['query', '--input', '-', ...options.runtimeTargetArgs, '--json'],
				options.ports,
				{ input: Buffer.from(JSON.stringify(request), 'utf8') },
			);
			if (
				outcome.exitCode !== 0
				|| outcome.envelope.kind !== 'cli-result'
				|| !outcome.envelope.ok
			) {
				return { ok: false, outcome };
			}
			const result = outcome.envelope.result as TaskQueryResultV1;
			if (!result.ok) return { ok: false, outcome };
			if (result.truncations.length > 0) throw new Error('DESCRIPTION_RESOLUTION_INCOMPLETE');
			for (const task of result.tasks) {
				if (normalizeCompactValueV1(task.description) !== description) continue;
				matches.push(task);
				if (matches.length >= 2) {
					const ids = matches.map(item => item.identity.operonId).join(', ');
					throw publicCliError(
						'DESCRIPTION_TARGET_AMBIGUOUS',
						`More than one task has that exact description. Use --id with one of: ${ids}`,
					);
				}
			}
			cursor = result.page.nextCursor;
			if (!cursor) break;
			if (seenCursors.has(cursor)) throw new Error('DESCRIPTION_RESOLUTION_INCOMPLETE');
			seenCursors.add(cursor);
			if (pageIndex === 99) throw new Error('DESCRIPTION_RESOLUTION_INCOMPLETE');
		}
		if (matches.length === 0) throw new Error('DESCRIPTION_TARGET_NOT_FOUND');
		operonId = matches[0].identity.operonId;
		if (!OPERON_ID_PATTERN_V1.test(operonId)) throw new Error('INVALID_OPERON_ID');
	}
	if (!operonId || !OPERON_ID_PATTERN_V1.test(operonId)) throw new Error('INVALID_OPERON_ID');
	return { ok: true, operonId };
}

async function resolveExactDirectTaskV1(options: {
	operonId?: string;
	description?: string;
	include?: TaskGetHydrationKeyV1[];
	incompleteCode: string;
	runtimeTargetArgs: string[];
	ports: PublicCommandPortsV1;
}): Promise<
	| { ok: true; task: TaskContextV1 }
	| { ok: false; outcome: PublicCommandOutcomeV1 }
> {
	const resolved = await resolveExactDirectOperonIdV1(options);
	if (!resolved.ok) return resolved;
	const { operonId } = resolved;
	const request: TaskGetRequestV1 = {
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'task-get',
		consistency: 'live-verified',
		selector: { kind: 'operon-id', operonId },
		...(options.include && options.include.length > 0 ? { include: options.include } : {}),
	};
	const outcome = await runRuntimeCommand(
		['task', 'get', '--input', '-', ...options.runtimeTargetArgs, '--json'],
		options.ports,
		{ input: Buffer.from(JSON.stringify(request), 'utf8') },
	);
	if (
		outcome.exitCode !== 0
		|| outcome.envelope.kind !== 'cli-result'
		|| !outcome.envelope.ok
	) {
		return { ok: false, outcome };
	}
	const result = outcome.envelope.result as TaskGetResultV1;
	if (!result.ok) return { ok: false, outcome };
	if (
		result.task.identity.operonId !== operonId
		|| !result.task.identity.mutationAllowed
		|| result.truncations.length > 0
		|| result.warnings.length > 0
		|| (
			options.description !== undefined
			&& normalizeCompactValueV1(result.task.description) !== options.description
		)
	) {
		throw new Error(options.incompleteCode);
	}
	return { ok: true, task: result.task };
}

async function loadCompactUpdateContextV1(options: {
	operonId: string;
	description?: string;
	mutationKind: 'task.update' | 'task.recurrence';
	runtimeTargetArgs: string[];
	ports: PublicCommandPortsV1;
}): Promise<
	| {
		ok: true;
		task: TaskContextV1;
		catalog: NonNullable<Extract<ContextPackV1, { ok: true }>['catalog']>;
	}
	| { ok: false; outcome: PublicCommandOutcomeV1 }
> {
	const request: ContextRequestV1 = {
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'mutation-preview',
		selector: { kind: 'operon-id', operonId: options.operonId },
		mutationKind: options.mutationKind,
		limit: 1,
	};
	const outcome = await runRuntimeCommand(
		['context', '--input', '-', ...options.runtimeTargetArgs, '--json'],
		options.ports,
		{ input: Buffer.from(JSON.stringify(request), 'utf8') },
	);
	if (
		outcome.exitCode !== 0
		|| outcome.envelope.kind !== 'cli-result'
		|| !outcome.envelope.ok
	) {
		remapCompactCapabilityFailureV1(
			outcome,
			options.mutationKind === 'task.recurrence'
				? 'RECURRENCE_CAPABILITY_UNAVAILABLE'
				: 'GUIDED_CAPABILITY_UNAVAILABLE',
		);
		return { ok: false, outcome };
	}
	const context = outcome.envelope.result as ContextPackV1;
	if (!context.ok) return { ok: false, outcome };
	const task = context.entities[0];
	if (
		context.purpose !== 'mutation-readiness'
		|| context.projection !== 'mutation-preview'
		|| context.entities.length !== 1
		|| !task
		|| task.identity.operonId !== options.operonId
		|| !task.identity.mutationAllowed
		|| context.catalog === undefined
		|| context.catalogRevision === undefined
		|| context.resourceRevisions === undefined
		|| context.resourceRevisions.length === 0
		|| context.truncations.length > 0
		|| context.warnings.some(warning => (
			warning.path === undefined
			|| warning.path === 'warnings'
			|| warning.path.startsWith(`entities.${options.operonId}.`)
		))
		|| (
			options.mutationKind === 'task.update'
			&& !Array.isArray(task.writableFields)
		)
		|| (
			options.description !== undefined
			&& normalizeCompactValueV1(task.description) !== options.description
		)
	) {
		throw new Error(
			options.mutationKind === 'task.recurrence'
				? 'RECURRENCE_TARGET_INCOMPLETE'
				: 'WRITABLE_FIELDS_INCOMPLETE',
		);
	}
	return { ok: true, task, catalog: context.catalog };
}

function isExpectedDirectMutationPlan(
	plan: SealedMutationPlanV1,
	intent: GuidedMutationIntentV1,
): boolean {
	const target = intent.target;
	const specsMatch = intent.spec.operation === 'set-pinned'
		? isExpectedDirectPinnedSpec(plan.spec, intent.spec)
		: intent.spec.operation === 'relocate-inline'
			? isExpectedDirectRelocateSpecV1(plan.spec, intent.spec, target?.locator)
		: intent.spec.operation === 'convert'
			? isExpectedDirectConvertSpecV1(plan.spec, intent.spec)
		: (
			intent.spec.operation === 'add-session'
			|| intent.spec.operation === 'update-session'
			|| intent.spec.operation === 'remove-session'
		)
			? isExpectedDirectTimerSessionSpec(plan.spec, intent.spec)
		: canonicalJsonV1(toJsonValueV1(plan.spec))
			=== canonicalJsonV1(toJsonValueV1(intent.spec));
	return target !== undefined
		&& plan.targets.length === 1
		&& plan.targets[0].operonId === target.operonId
		&& canonicalJsonV1(toJsonValueV1(plan.targets[0].locator))
			=== canonicalJsonV1(toJsonValueV1(target.locator))
		&& specsMatch;
}

export function isExpectedDirectConvertSpecV1(
	sealed: SealedMutationPlanV1['spec'],
	requested: GuidedMutationIntentV1['spec'],
): boolean {
	return canonicalJsonV1(toJsonValueV1(sealed))
		=== canonicalJsonV1(toJsonValueV1(requested));
}

export function isExpectedDirectRelocateSpecV1(
	sealed: SealedMutationPlanV1['spec'],
	requested: GuidedMutationIntentV1['spec'],
	expectedSourceLocator: NonNullable<GuidedMutationIntentV1['target']>['locator'] | undefined,
): boolean {
	if (!isPlainRecord(sealed) || !isPlainRecord(requested)) return false;
	if (
		sealed.operation !== 'relocate-inline'
		|| requested.operation !== 'relocate-inline'
		|| !isPlainRecord(sealed.source)
		|| !isPlainRecord(sealed.destination)
		|| !isPlainRecord(requested.destination)
		|| expectedSourceLocator === undefined
		|| sealed.destination.mustBeBlank !== true
		|| requested.destination.mustBeBlank !== true
		|| canonicalJsonV1(toJsonValueV1(sealed.source.locator))
			!== canonicalJsonV1(toJsonValueV1(expectedSourceLocator))
		|| canonicalJsonV1(toJsonValueV1(sealed.destination.locator))
			!== canonicalJsonV1(toJsonValueV1(requested.destination.locator))
	) return false;
	const allowedSource = new Set(['locator', 'lineDigest', 'sourceRevision']);
	const allowedDestination = new Set(['locator', 'lineDigest', 'sourceRevision', 'mustBeBlank']);
	return Object.keys(sealed).every(key => key === 'operation' || key === 'source' || key === 'destination')
		&& Object.keys(sealed.source).every(key => allowedSource.has(key))
		&& Object.keys(sealed.destination).every(key => allowedDestination.has(key))
		&& typeof sealed.source.lineDigest === 'string'
		&& typeof sealed.destination.lineDigest === 'string'
		&& /^[a-f0-9]{64}$/u.test(sealed.source.lineDigest)
		&& /^[a-f0-9]{64}$/u.test(sealed.destination.lineDigest)
		&& isPlainRecord(sealed.source.sourceRevision)
		&& isPlainRecord(sealed.destination.sourceRevision)
		&& sealed.source.sourceRevision.algorithm === 'sha256'
		&& sealed.destination.sourceRevision.algorithm === 'sha256'
		&& typeof sealed.source.sourceRevision.contentDigest === 'string'
		&& typeof sealed.destination.sourceRevision.contentDigest === 'string'
		&& /^[a-f0-9]{64}$/u.test(sealed.source.sourceRevision.contentDigest)
		&& /^[a-f0-9]{64}$/u.test(sealed.destination.sourceRevision.contentDigest);
}

function isExpectedDirectTimerSessionSpec(
	sealed: SealedMutationPlanV1['spec'],
	requested: GuidedMutationIntentV1['spec'],
): boolean {
	if (!isPlainRecord(sealed) || !isPlainRecord(requested)) return false;
	if (
		sealed.operation !== requested.operation
		|| sealed.sessionNumber !== requested.sessionNumber
		|| sealed.start !== requested.start
		|| sealed.end !== requested.end
		|| typeof sealed.expectedTrackers !== 'string'
		|| !Number.isSafeInteger(sealed.expectedDuration)
		|| typeof sealed.nextTrackers !== 'string'
		|| !Number.isSafeInteger(sealed.nextDuration)
		|| typeof sealed.effectiveAt !== 'string'
		|| !Number.isFinite(Date.parse(sealed.effectiveAt))
	) return false;
	if (sealed.operation === 'add-session') {
		if (
			sealed.selectedRawIndex !== undefined
			|| sealed.expectedStart !== undefined
			|| sealed.expectedEnd !== undefined
		) return false;
	} else if (
		!Number.isSafeInteger(sealed.selectedRawIndex)
		|| typeof sealed.expectedStart !== 'string'
		|| typeof sealed.expectedEnd !== 'string'
	) return false;
	const allowed = new Set([
		'operation',
		'sessionNumber',
		'start',
		'end',
		'expectedTrackers',
		'expectedDuration',
		'selectedRawIndex',
		'expectedStart',
		'expectedEnd',
		'nextTrackers',
		'nextDuration',
		'effectiveAt',
	]);
	return Object.keys(sealed).every(key => allowed.has(key));
}

function isDirectTimerSessionNoChange(plan: SealedMutationPlanV1): boolean {
	return plan.mutationKind === 'timer.session'
		&& plan.spec.operation === 'update-session'
		&& plan.spec.expectedTrackers === plan.spec.nextTrackers
		&& plan.spec.expectedDuration === plan.spec.nextDuration;
}

function isExpectedDirectPinnedSpec(
	sealed: SealedMutationPlanV1['spec'],
	requested: GuidedMutationIntentV1['spec'],
): boolean {
	if (!isPlainRecord(sealed) || !isPlainRecord(requested)) return false;
	if (
		sealed.operation !== 'set-pinned'
		|| requested.operation !== 'set-pinned'
		|| sealed.pinned !== requested.pinned
		|| sealed.expectedPinned !== !requested.pinned
	) return false;
	const allowed = new Set([
		'operation',
		'pinned',
		'expectedPinned',
		'expectedEntryRevision',
		'effectiveAt',
	]);
	return Object.keys(sealed).every(key => allowed.has(key))
		&& typeof sealed.expectedEntryRevision === 'string'
		&& sealed.expectedEntryRevision.length > 0
		&& typeof sealed.effectiveAt === 'string'
		&& Number.isFinite(Date.parse(sealed.effectiveAt));
}

function isExpectedCompactUpdatePlan(
	plan: SealedMutationPlanV1,
	intent: ReturnType<typeof compileCompactUpdateIntentV1>,
): boolean {
	const target = intent.target;
	return plan.mutationKind === 'task.update'
		&& plan.targets.length === 1
		&& target !== undefined
		&& plan.targets[0].operonId === target.operonId
		&& canonicalJsonV1(toJsonValueV1(plan.targets[0].locator))
			=== canonicalJsonV1(toJsonValueV1(target.locator))
		&& canonicalJsonV1(toJsonValueV1(plan.spec))
			=== canonicalJsonV1(toJsonValueV1(intent.spec));
}

export function isExpectedCompactRecurrencePlan(
	plan: SealedMutationPlanV1,
	intent: GuidedMutationIntentV1,
): boolean {
	const target = intent.target;
	if (
		plan.mutationKind !== 'task.recurrence'
		|| plan.targets.length !== 1
		|| target === undefined
		|| plan.targets[0].operonId !== target.operonId
		|| canonicalJsonV1(toJsonValueV1(plan.targets[0].locator))
			!== canonicalJsonV1(toJsonValueV1(target.locator))
		|| !isPlainRecord(plan.spec)
		|| !isPlainRecord(intent.spec)
		|| plan.spec.operation !== 'update-recurrence'
		|| intent.spec.operation !== 'update-recurrence'
		|| plan.spec.scope !== intent.spec.scope
		|| !Array.isArray(plan.spec.changes)
		|| !Array.isArray(intent.spec.changes)
		|| plan.spec.changes.length !== intent.spec.changes.length
		|| !isPlainRecord(plan.spec.expected)
		|| Object.keys(plan.spec).some(key => (
			key !== 'operation' && key !== 'scope' && key !== 'changes' && key !== 'expected'
		))
		|| !isExpectedRecurrenceStateV1(plan.spec.expected)
	) return false;
	const requestedChanges = intent.spec.changes as unknown[];
	return plan.spec.changes.every((sealed, index) => {
		const requested = requestedChanges[index];
		if (
			!isPlainRecord(sealed)
			|| !isPlainRecord(requested)
			|| Object.keys(sealed).some(key => (
				key !== 'operation'
				&& key !== 'field'
				&& key !== 'valueType'
				&& key !== 'value'
				&& key !== 'expectedValue'
			))
		) return false;
		const requestedMaterial = Object.fromEntries(
			Object.entries(sealed).filter(([key]) => key !== 'expectedValue'),
		);
		return canonicalJsonV1(toJsonValueV1(requestedMaterial))
			=== canonicalJsonV1(toJsonValueV1(requested));
	});
}

function isExpectedRecurrenceStateV1(value: Record<string, unknown>): boolean {
	if (
		Object.keys(value).some(key => (
			key !== 'fieldValues'
			&& key !== 'repeatSeriesId'
			&& key !== 'repeatOccurrenceDate'
		))
		|| !isPlainRecord(value.fieldValues)
		|| !Object.prototype.hasOwnProperty.call(value, 'repeatSeriesId')
		|| !Object.prototype.hasOwnProperty.call(value, 'repeatOccurrenceDate')
	) return false;
	const allowedFields = new Set([
		'repeat',
		'datetimeRepeatEnd',
		'dateScheduled',
		'dateStarted',
		'dateDue',
		'datetimeStart',
		'datetimeEnd',
		'estimate',
	]);
	if (Object.keys(value.fieldValues).some(key => !allowedFields.has(key))) return false;
	return (
		value.repeatSeriesId === null
		|| (
			typeof value.repeatSeriesId === 'string'
			&& /^rs[a-z0-9]{5}$/u.test(value.repeatSeriesId)
		)
	) && (
		value.repeatOccurrenceDate === null
		|| (
			typeof value.repeatOccurrenceDate === 'string'
			&& /^\d{4}-\d{2}-\d{2}$/u.test(value.repeatOccurrenceDate)
		)
	);
}

function isExpectedCompactRelationshipPlan(
	plan: SealedMutationPlanV1,
	intent: GuidedMutationIntentV1,
): boolean {
	const target = intent.target;
	const requestedChangesValue: unknown = intent.spec.changes;
	if (
		plan.mutationKind !== 'task.relationship'
		|| plan.targets.length !== 1
		|| target === undefined
		|| plan.targets[0].operonId !== target.operonId
		|| canonicalJsonV1(toJsonValueV1(plan.targets[0].locator))
			!== canonicalJsonV1(toJsonValueV1(target.locator))
		|| !isPlainRecord(plan.spec)
		|| !isPlainRecord(intent.spec)
		|| plan.spec.operation !== 'replace-relationships'
		|| intent.spec.operation !== 'replace-relationships'
		|| !Array.isArray(plan.spec.changes)
		|| !isUnknownArray(requestedChangesValue)
		|| !Array.isArray(plan.spec.affectedOperonIds)
		|| plan.spec.changes.length !== requestedChangesValue.length
		|| Object.keys(plan.spec).some(key => (
			key !== 'operation' && key !== 'changes' && key !== 'affectedOperonIds'
		))
	) return false;
	const affected = plan.spec.affectedOperonIds;
	if (
		affected.some(value => typeof value !== 'string' || !OPERON_ID_PATTERN_V1.test(value))
		|| affected.some((value, index) => affected.indexOf(value) !== index)
		|| affected.some((value, index) => index > 0 && affected[index - 1].localeCompare(value) > 0)
		|| !affected.includes(target.operonId)
	) return false;
	const requestedChanges = requestedChangesValue;
	return plan.spec.changes.every((sealed, index) => {
		const requested = requestedChanges[index];
		if (
			!isPlainRecord(sealed)
			|| !isPlainRecord(requested)
			|| !Array.isArray(sealed.targetOperonIds)
			|| !Array.isArray(sealed.expectedTargetOperonIds)
			|| !Array.isArray(requested.targetOperonIds)
			|| Object.keys(sealed).some(key => (
				key !== 'field'
				&& key !== 'targetOperonIds'
				&& key !== 'expectedTargetOperonIds'
			))
		) return false;
		const expected = sealed.expectedTargetOperonIds;
		const desired = sealed.targetOperonIds;
		return sealed.field === requested.field
			&& canonicalJsonV1(toJsonValueV1(sealed.targetOperonIds))
				=== canonicalJsonV1(toJsonValueV1(requested.targetOperonIds))
			&& expected.every(value => (
				typeof value === 'string' && OPERON_ID_PATTERN_V1.test(value)
			))
			&& expected.every((value, valueIndex) => expected.indexOf(value) === valueIndex)
			&& desired.every(value => affected.includes(value))
			&& expected.every(value => affected.includes(value))
			&& (sealed.field !== 'parentTask' || expected.length <= 1);
	});
}

async function runGuidedCreationCommand(
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const terminal = ports.interactive
		? { port: ports.interactive, close: () => undefined }
		: createProcessGuidedPort();
	if (!terminal) throw new Error('GUIDED_TTY_REQUIRED');
	try {
		const creation = await loadCreationModelV1(
			parsed,
			ports,
			true,
			'GUIDED_CAPABILITY_UNAVAILABLE',
			true,
		);
		if ('outcome' in creation) return { ...creation.outcome, json: false };
		const { model, runtimeTargetArgs } = creation;
		const wizard = await runGuidedCreationWizardV1({
			model,
			port: terminal.port,
			itemRef: randomUUID(),
			...(parsed.positionals[0] ? { initialDescription: parsed.positionals[0] } : {}),
		});
		if (wizard.status === 'cancelled') {
			return localSuccess('task.create', false, { cancelled: true }, wizard.message);
		}
		const previewArgs = [
			'task',
			'create',
			'--input',
			'-',
			...runtimeTargetArgs,
			...(parsed.values['--request-id']
				? ['--request-id', parsed.values['--request-id']]
				: []),
		];
		const preview = await runConvenienceCommand(
			'task.create',
			2,
			previewArgs,
			{ ...ports, input: Buffer.from(JSON.stringify(wizard.intent), 'utf8') },
		);
		if (
			preview.exitCode !== 0
			|| preview.envelope.kind !== 'cli-result'
			|| !preview.envelope.ok
			|| !preview.envelope.client?.planRef
		) {
			return preview;
		}
		terminal.port.write(`\n${preview.human}\n\n`);
		const planRef = preview.envelope.client.planRef;
		if (parsed.booleans.has('--preview-only')) {
			return {
				...preview,
				human: [
					'No task was created.',
					`Review: operon plan show ${planRef}`,
					`Apply: operon plan apply ${planRef}`,
					`Discard: operon plan discard ${planRef}`,
				].join('\n'),
			};
		}
		if (!await askGuidedApplyV1(terminal.port)) {
			return {
				...preview,
				human: `Plan saved. Apply it with:\n  operon plan apply ${planRef}`,
			};
		}
		return await runPlanApply(
			[
				planRef,
				...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
				...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
			],
			false,
			ports,
			ports.configRoot ?? operonCliConfigRootV1(),
			false,
		);
	} finally {
		terminal.close();
	}
}

async function loadCreationModelV1(
	parsed: { values: Record<string, string> },
	ports: PublicCommandPortsV1,
	requireApply: boolean,
	capabilityErrorCode:
		| 'COMPACT_BATCH_CAPABILITY_UNAVAILABLE'
		| 'COMPACT_CAPABILITY_UNAVAILABLE'
		| 'GUIDED_CAPABILITY_UNAVAILABLE',
	preflightCapabilities: boolean,
): Promise<
	| { model: GuidedCreationModelV1; runtimeTargetArgs: string[] }
	| { outcome: PublicCommandOutcomeV1 }
> {
	const runtimeTargetArgs = [
		...(ports._resolvedTarget
			? ['--vault', ports._resolvedTarget.canonicalPath]
			: [
				...(parsed.values['--vault'] ? ['--vault', parsed.values['--vault']] : []),
				...(parsed.values['--profile'] ? ['--profile', parsed.values['--profile']] : []),
			]),
		...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
		...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
	];
	if (preflightCapabilities) {
		const capabilities = await runRuntimeCommand(
			['capabilities', ...runtimeTargetArgs, '--json'],
			ports,
		);
		if (
			capabilities.exitCode !== 0
			|| capabilities.envelope.kind !== 'cli-result'
			|| !capabilities.envelope.ok
		) {
			return { outcome: capabilities };
		}
		assertCreationCapabilities(capabilities.envelope.result, requireApply, capabilityErrorCode);
	}
	const contextRequest = {
		contractVersion: 1,
		requestId: randomUUID(),
		kind: 'context',
		purpose: 'creation',
		projection: 'creation-context',
		consistency: 'live-verified',
	};
	const context = await runRuntimeCommand(
		['context', '--input', '-', ...runtimeTargetArgs, '--json'],
		ports,
		{ input: Buffer.from(JSON.stringify(contextRequest), 'utf8') },
	);
	if (
		context.exitCode !== 0
		|| context.envelope.kind !== 'cli-result'
		|| !context.envelope.ok
	) {
		remapCompactCapabilityFailureV1(context, capabilityErrorCode);
		return { outcome: context };
	}
	return {
		model: buildGuidedCreationModelV1(context.envelope.result as ContextPackV1),
		runtimeTargetArgs,
	};
}

function assertCreationCapabilities(
	value: unknown,
	requireApply: boolean,
	errorCode:
		| 'COMPACT_BATCH_CAPABILITY_UNAVAILABLE'
		| 'COMPACT_CAPABILITY_UNAVAILABLE'
		| 'GUIDED_CAPABILITY_UNAVAILABLE',
): void {
	if (!Array.isArray(value)) throw new Error(errorCode);
	const ids = [
		'context.build',
		'tasks.create.preview',
		...(requireApply ? ['tasks.create.apply'] : []),
	];
	const capabilities = value as CapabilityAdvertisementV1[];
	for (const id of ids) {
		const capability = capabilities.find(candidate => candidate.id === id);
		if (capability?.availability !== 'available') throw new Error(errorCode);
	}
}

function remapCompactCapabilityFailureV1(
	outcome: PublicCommandOutcomeV1,
	errorCode:
		| 'COMPACT_BATCH_CAPABILITY_UNAVAILABLE'
		| 'COMPACT_CAPABILITY_UNAVAILABLE'
		| 'COMPACT_UPDATE_BATCH_CAPABILITY_UNAVAILABLE'
		| 'GUIDED_CAPABILITY_UNAVAILABLE'
		| 'RECURRENCE_CAPABILITY_UNAVAILABLE',
): void {
	if (
		outcome.envelope.kind === 'cli-result'
		&& !outcome.envelope.ok
		&& (
			outcome.envelope.failure.stage === 'capability'
			|| outcome.envelope.failure.error.code === 'capability-unavailable'
		)
	) {
		throw new Error(errorCode);
	}
}

async function runGuidedMaintenanceCommand(
	command: string,
	parsed: {
		values: Record<string, string>;
		booleans: Set<string>;
		positionals: string[];
	},
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	if (parsed.positionals.length > 0) throw new Error('GUIDED_INPUT_CONFLICT');
	const terminal = ports.interactive
		? { port: ports.interactive, close: () => undefined }
		: createProcessGuidedPort();
	if (!terminal) throw new Error('GUIDED_MAINTENANCE_TTY_REQUIRED');
	const runtimeTargetArgs = runtimeTargetArgsFor(parsed.values);
	const runtimeResponse = async <T>(
		args: string[],
		input?: Buffer,
	): Promise<TaskFinderRuntimeResponseV1<T>> => {
		const outcome = await runRuntimeCommand(args, ports, input ? { input } : {});
		if (outcome.envelope.kind !== 'cli-result' || !outcome.envelope.ok) {
			return {
				ok: false,
				failure: outcome,
				...(outcome.envelope.kind === 'cli-result'
					? { code: outcome.envelope.failure.error.code }
					: {}),
			};
		}
		return { ok: true, value: outcome.envelope.result as T, opaque: outcome };
	};
	const readTask = async (
		selector: TaskSelectorV1,
		include?: TaskGetHydrationKeyV1[],
	): Promise<TaskFinderRuntimeResponseV1<TaskGetResultV1>> => {
		const request: TaskGetRequestV1 = {
			contractVersion: 1,
			requestId: randomUUID(),
			kind: 'task-get',
			consistency: 'live-verified',
			selector,
			...(include && include.length > 0 ? { include } : {}),
		};
		return await runtimeResponse<TaskGetResultV1>(
			['task', 'get', '--input', '-', ...runtimeTargetArgs, '--json'],
			Buffer.from(JSON.stringify(request), 'utf8'),
		);
	};
	let catalogPromise: Promise<TaskFinderRuntimeResponseV1<OperonCatalogV1>> | undefined;
	const catalogResponse = async () => {
		catalogPromise ??= runtimeResponse<OperonCatalogV1>([
			'catalog',
			...runtimeTargetArgs,
			'--json',
		]);
		return await catalogPromise;
	};
	let placementFailure: PublicCommandOutcomeV1 | undefined;
	const loadPlacement = async (
		placement: PlacementCandidateRequestV1,
	): Promise<PlacementCandidatesV1 | null> => {
		const request: ContextRequestV1 = {
			contractVersion: 1,
			requestId: randomUUID(),
			kind: 'context',
			consistency: 'live-verified',
			purpose: 'mutation-readiness',
			projection: 'placement-candidates',
			limit: 20,
			placement,
		};
		const response = await runtimeResponse<ContextPackV1>(
			['context', '--input', '-', ...runtimeTargetArgs, '--json'],
			Buffer.from(JSON.stringify(request), 'utf8'),
		);
		if (!response.ok) {
			placementFailure = response.failure as PublicCommandOutcomeV1;
			return null;
		}
		if (!response.value.ok) {
			placementFailure = response.opaque as PublicCommandOutcomeV1;
			return null;
		}
		if (!response.value.placement) throw new Error('GUIDED_PLACEMENT_UNAVAILABLE');
		return response.value.placement;
	};
	const selectTask = async (
		include: TaskGetHydrationKeyV1[] = [],
	): Promise<
		| { status: 'selected'; task: TaskContextV1 }
		| { status: 'cancelled' }
		| { status: 'failed'; outcome: PublicCommandOutcomeV1 }
	> => {
		const selected = await runGuidedTaskFinderV1({
			port: terminal.port,
			purpose: 'mutation-target',
			readInclude: [],
			runtime: {
				finder: async (finder: TaskFinderQueryV1) => {
					const request: TaskFinderRequestV1 = {
						contractVersion: 1,
						requestId: randomUUID(),
						kind: 'task-finder',
						consistency: 'live-verified',
						...finder,
					};
					return await runtimeResponse<TaskFinderResultV1>(
						['finder', '--input', '-', ...runtimeTargetArgs, '--json'],
						Buffer.from(JSON.stringify(request), 'utf8'),
					);
				},
				read: readTask,
				catalog: catalogResponse,
			},
		});
		if (selected.status === 'cancelled') return { status: 'cancelled' };
		if (selected.status === 'failed') {
			return { status: 'failed', outcome: selected.failure as PublicCommandOutcomeV1 };
		}
		if (include.length === 0) return { status: 'selected', task: selected.task };
		const hydrated = await readTask(selected.selector, include);
		if (!hydrated.ok) {
			return { status: 'failed', outcome: hydrated.failure as PublicCommandOutcomeV1 };
		}
		if (!hydrated.value.ok) {
			return { status: 'failed', outcome: hydrated.opaque as PublicCommandOutcomeV1 };
		}
		const hydrationPaths = include.map(key => (
			key === 'writable-fields' ? 'writableFields' : 'reminderItems'
		));
		if (hydrated.value.truncations.some(item => (
			hydrationPaths.some(path => item.path.includes(path))
		))) {
			throw new Error('GUIDED_HYDRATION_TRUNCATED');
		}
		return { status: 'selected', task: hydrated.value.task };
	};
	try {
		const mapping = convenienceMapping(command);
		const requiredCapabilities: CapabilityIdV1[] = [
			OPERON_CLI_MUTATION_CAPABILITIES_V1[mapping.mutationKind].preview,
			OPERON_CLI_MUTATION_CAPABILITIES_V1[mapping.mutationKind].apply,
		];
			if (!command.startsWith('timer.')) {
				requiredCapabilities.push('tasks.read', 'tasks.finder', 'catalog.read');
			} else {
				requiredCapabilities.push('timers.read');
			}
			if (command === 'task.convert' || command === 'task.relocate') {
				requiredCapabilities.push('context.build');
			}
		const capabilities = await runRuntimeCommand(
			['capabilities', ...runtimeTargetArgs, '--json'],
			ports,
		);
		if (capabilities.exitCode !== 0 || capabilities.envelope.kind !== 'cli-result' || !capabilities.envelope.ok) {
			return { ...capabilities, json: false };
		}
		assertCapabilitiesAvailable(capabilities.envelope.result, requiredCapabilities);
		const capabilityAdvertisements = capabilities.envelope.result;

		let guided: GuidedMaintenanceResultV1;
		if (command === 'timer.start' || command === 'timer.stop') {
			const timerRequest: TimerReadRequestV1 = {
				contractVersion: 1,
				requestId: randomUUID(),
				kind: 'timer-read',
				consistency: 'live-verified',
			};
			const timer = await runtimeResponse<TimerReadResultV1>(
				['timer', 'state', '--input', '-', ...runtimeTargetArgs, '--json'],
				Buffer.from(JSON.stringify(timerRequest), 'utf8'),
			);
			if (!timer.ok) return { ...(timer.failure as PublicCommandOutcomeV1), json: false };
			if (!timer.value.ok) return { ...(timer.opaque as PublicCommandOutcomeV1), json: false };
			if (command === 'timer.start') {
				let selectedFailure: PublicCommandOutcomeV1 | undefined;
				guided = await runGuidedTimerStartWizardV1({
					port: terminal.port,
					state: timer.value.state,
					selectTask: async () => {
						assertCapabilitiesAvailable(capabilityAdvertisements, [
							'tasks.read',
							'tasks.finder',
							'catalog.read',
						]);
						const selected = await selectTask();
						if (selected.status === 'failed') {
							selectedFailure = selected.outcome;
							return null;
						}
						return selected.status === 'selected' ? selected.task : null;
					},
				});
				if (selectedFailure) return { ...selectedFailure, json: false };
			} else {
				let target;
				const activeId = timer.value.state.active?.operonId;
				if (activeId) {
					const current = await readTask({ kind: 'operon-id', operonId: activeId });
					if (current.ok && current.value.ok && current.value.task.identity.mutationAllowed) {
						target = current.value.task;
					}
				}
				guided = await runGuidedTimerStopWizardV1({
					port: terminal.port,
					state: timer.value.state,
					...(target ? { target } : {}),
				});
			}
		} else {
			const include: TaskGetHydrationKeyV1[] = command === 'task.update'
				? ['writable-fields']
				: command.startsWith('reminder.')
					? ['reminder-items']
					: [];
			const selected = await selectTask(include);
			if (selected.status === 'cancelled') {
				return localSuccess(command, false, { cancelled: true }, 'Guided mutation cancelled before preview.');
			}
			if (selected.status === 'failed') return { ...selected.outcome, json: false };
			const needsCatalog = command !== 'task.relocate' && command !== 'task.delete';
			const catalog = needsCatalog ? await catalogResponse() : undefined;
			if (catalog && !catalog.ok) {
				return { ...(catalog.failure as PublicCommandOutcomeV1), json: false };
			}
			const catalogValue = catalog?.ok ? catalog.value : undefined;
			const requireCatalog = (): OperonCatalogV1 => {
				if (!catalogValue) throw new Error('GUIDED_CATALOG_UNAVAILABLE');
				return catalogValue;
			};
			if (command === 'task.update') {
				guided = await runGuidedTaskUpdateWizardV1({
					port: terminal.port,
					task: selected.task,
					catalog: requireCatalog(),
				});
			} else if (command === 'task.transition') {
				guided = await runGuidedTransitionWizardV1({
					port: terminal.port,
					task: selected.task,
					catalog: requireCatalog(),
				});
			} else if (command.startsWith('reminder.')) {
				guided = await runGuidedReminderWizardV1({
					port: terminal.port,
					task: selected.task,
					catalog: requireCatalog(),
					operation: command.split('.')[1] as 'add' | 'replace' | 'remove',
				});
			} else if (command === 'task.relocate') {
				guided = await runGuidedRelocateWizardV1({
					port: terminal.port,
					task: selected.task,
					loadPlacement,
				});
			} else if (command === 'task.convert') {
				guided = await runGuidedConvertWizardV1({
					port: terminal.port,
					task: selected.task,
					catalog: requireCatalog(),
					loadPlacement,
				});
			} else {
				guided = await runGuidedDeleteWizardV1({
					port: terminal.port,
					task: selected.task,
				});
			}
			if (placementFailure) return { ...placementFailure, json: false };
		}
		if (guided.status !== 'ready') {
			return localSuccess(command, false, { status: guided.status }, guided.message);
		}
		const preview = await runConvenienceCommand(
			command,
			2,
			[
				...command.split('.'),
				'--input',
				'-',
				...runtimeTargetArgs,
				...(parsed.values['--request-id']
					? ['--request-id', parsed.values['--request-id']]
					: []),
			],
			{ ...ports, input: Buffer.from(JSON.stringify(guided.intent), 'utf8') },
		);
		if (
			preview.exitCode !== 0
			|| preview.envelope.kind !== 'cli-result'
			|| !preview.envelope.ok
			|| !preview.envelope.client?.planRef
		) {
			return preview;
		}
		terminal.port.write(`\n${preview.human}\n\n`);
		const planRef = preview.envelope.client.planRef;
			if (
				isMutationPreviewSuccess(preview.envelope.result)
				&& preview.envelope.result.plan.predictedEffects.length === 0
		) {
			return {
				...preview,
					human: `${preview.human}\nNo durable change is required.`,
				};
			}
			const previewPlan = isMutationPreviewSuccess(preview.envelope.result)
				? preview.envelope.result.plan
				: undefined;
			const guidedConfirmationWord = previewPlan
				? semanticConfirmationWord(previewPlan)
				: null;
			if (previewPlan && guidedConfirmationWord) {
					const confirmed = await promptForSemanticConfirmation(
						previewPlan,
						guidedConfirmationWord,
						planRef,
						terminal.port,
						false,
					);
				if (!confirmed) {
					return {
						...preview,
						human: `Plan saved. Apply it with:\n  operon plan apply ${planRef}`,
					};
				}
				return await runPlanApply(
					[
						planRef,
						'--confirm',
						confirmationTokenForPlanV1(previewPlan),
						...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
						...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
					],
					false,
					ports,
					ports.configRoot ?? operonCliConfigRootV1(),
					false,
				);
			}
			if (
				isMutationPreviewSuccess(preview.envelope.result)
				&& (
					preview.envelope.result.plan.requiresConfirmation
					|| preview.envelope.result.plan.riskLevel === 'destructive'
					|| preview.envelope.result.plan.requiredAcknowledgements.length > 0
			)
		) {
			return {
				...preview,
				human: `${preview.human}\nPlan saved. Review it with:\n  operon plan show ${planRef}`,
			};
		}
		if (!await askGuidedMaintenanceApplyV1(terminal.port)) {
			return {
				...preview,
				human: `Plan saved. Apply it with:\n  operon plan apply ${planRef}`,
			};
		}
		return await runPlanApply(
			[
				planRef,
				...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
				...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
			],
			false,
			ports,
			ports.configRoot ?? operonCliConfigRootV1(),
			false,
		);
	} finally {
		terminal.close();
	}
}

function runtimeTargetArgsFor(
	values: Record<string, string>,
	resolvedTarget?: ResolvedVaultCommandScopeV1,
): string[] {
	return [
		...(resolvedTarget
			? ['--vault', resolvedTarget.canonicalPath]
			: [
				...(values['--vault'] ? ['--vault', values['--vault']] : []),
				...(values['--profile'] ? ['--profile', values['--profile']] : []),
			]),
		...(values['--timeout-ms'] ? ['--timeout-ms', values['--timeout-ms']] : []),
		...(values['--obsidian-bin'] ? ['--obsidian-bin', values['--obsidian-bin']] : []),
	];
}

function assertCapabilitiesAvailable(
	value: unknown,
	required: readonly string[],
	errorCode = 'GUIDED_CAPABILITY_UNAVAILABLE',
): void {
	if (!Array.isArray(value)) throw new Error(errorCode);
	const capabilities = value as CapabilityAdvertisementV1[];
	for (const id of required) {
		const capability = capabilities.find(candidate => candidate.id === id);
		if (capability?.availability !== 'available') throw new Error(errorCode);
	}
}

function createProcessGuidedPort(): {
	port: InteractiveTerminalPortV1;
	close(): void;
} | null {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
	const input = createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
		historySize: 0,
	});
	let closed = false;
	input.on('SIGINT', () => input.close());
	return {
		port: {
			ask(prompt: string): Promise<string | null> {
				if (closed) return Promise.resolve(null);
				return new Promise(resolve => {
					let settled = false;
					const finish = (value: string | null) => {
						if (settled) return;
						settled = true;
						input.off('close', onClose);
						resolve(value);
					};
					const onClose = () => {
						closed = true;
						finish(null);
					};
					input.once('close', onClose);
					input.question(prompt, answer => finish(answer));
				});
			},
			write(text: string): void {
				process.stdout.write(text);
			},
		},
		close(): void {
			if (closed) return;
			closed = true;
			input.close();
		},
	};
}

async function runLocalCommand(
	command: LocalCommandV1,
	consumed: number,
	argv: string[],
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	const tail = argv.slice(consumed);
	const json = argv.includes('--json');
	const root = ports.configRoot ?? operonCliConfigRootV1();
	try {
		switch (command) {
			case 'help':
			case 'unknown':
			case 'runtime':
				throw new Error('UNKNOWN_COMMAND');
			case 'version':
				assertOnlyJson(tail);
				return localSuccess(command, json, {
					name: 'operon-cli',
					version: OPERON_CLI_VERSION,
					node: process.version,
					platform: process.platform,
				}, `operon-cli ${OPERON_CLI_VERSION}`);
			case 'manifest':
				assertOnlyJson(tail);
				return localSuccess(command, json, readCliManifestV1(), 'Operon CLI manifest V1');
			case 'schema.list':
				assertOnlyJson(tail);
				return localSuccess(command, json, {
					files: listCliSchemasV1(),
					entrypoints: listCliSchemaEntrypointsV1(),
				}, 'Operon CLI schemas listed.');
			case 'schema.get': {
				const positional = tail.filter(value => value !== '--json');
				if (positional.length !== 1) throw new Error('SCHEMA_ID_REQUIRED');
				return localSuccess(command, json, readCliSchemaV1(positional[0]), `Operon CLI schema: ${positional[0]}`);
			}
			case 'profile.list': {
				assertOnlyJson(tail);
				const config = loadOperonCliConfigV1(root);
				return localSuccess(command, json, config, `${config.profiles.length} Operon vault profile(s).`);
			}
			case 'profile.default': {
				const positional = tail.filter(value => value !== '--json');
				if (positional.length !== 1) throw new Error('PROFILE_NAME_REQUIRED');
				const config = setDefaultVaultProfileV1(loadOperonCliConfigV1(root), positional[0]);
				saveOperonCliConfigV1(config, root);
				return localSuccess(command, json, config, `Default Operon profile: ${positional[0]}`);
			}
			case 'profile.remove': {
				const positional = tail.filter(value => value !== '--json');
				if (positional.length !== 1) throw new Error('PROFILE_NAME_REQUIRED');
				const config = removeVaultProfileV1(loadOperonCliConfigV1(root), positional[0]);
				saveOperonCliConfigV1(config, root);
				return localSuccess(command, json, config, `Removed Operon profile: ${positional[0]}`);
			}
			case 'setup':
				return await runSetup(tail, json, ports, root);
			case 'doctor':
				return await runDoctor(tail, json, ports, root);
			case 'completion': {
				const positional = tail.filter(value => value !== '--json');
				if (json || positional.length !== 1 || !isShellCompletion(positional[0])) {
					throw new Error('COMPLETION_SHELL_REQUIRED');
				}
				return {
					exitCode: 0,
					json: false,
					envelope: {
						contractVersion: 1,
						kind: 'operon-cli-local-result',
						command,
						ok: true,
						result: { shell: positional[0] },
					},
					human: renderShellCompletionV1(positional[0]),
				};
			}
			case 'task.find':
				return await runTaskFind(tail, json, ports);
			case 'plan.show':
				return runPlanShow(tail, json, root);
			case 'plan.discard':
				return runPlanDiscard(tail, json, root);
			case 'plan.apply':
				return await runPlanApply(tail, json, ports, root, false);
			case 'plan.recover':
				return await runPlanRecoverCommand(tail, json, ports, root);
		}
	} catch (error) {
		return localFailure(command, json, error);
	}
}

function isShellCompletion(value: string): value is OperonShellCompletionV1 {
	return value === 'zsh' || value === 'bash' || value === 'fish';
}

async function runPlanRecoverCommand(
	argv: string[],
	json: boolean,
	ports: PublicCommandPortsV1,
	root: string,
): Promise<PublicCommandOutcomeV1> {
	const parsed = parseFlags(argv, {
		value: ['--obsidian-bin', '--timeout-ms'],
		boolean: ['--json'],
		positional: [0, 1],
	});
	if (parsed.positionals.length === 1) {
		return await runPlanApply(argv, json, ports, root, true);
	}
	if (json) throw new Error('PLAN_REF_REQUIRED');
	const terminal = ports.interactive
		? { port: ports.interactive, close: () => undefined }
		: createProcessGuidedPort();
	if (!terminal) throw new Error('PLAN_RECOVERY_TTY_REQUIRED');
	try {
		const records = listRecoverableMutationPlansV1(root);
		if (records.length === 0) {
			return localSuccess('plan.recover', false, { recoverableCount: 0 }, 'No recoverable Operon plan is stored.');
		}
		terminal.port.write('Recover an uncertain Operon plan\n\n');
		records.forEach((record, index) => {
			const target = record.plan.targets[0];
			const targetLabel = target?.operonId ?? target?.locator?.filePath ?? 'unknown target';
			const expired = Date.now() >= Date.parse(record.expiresAt) ? ' | expired' : '';
			terminal.port.write(
				`  ${index + 1}. ${record.plan.mutationKind} | ${sanitizeTerminalTextV1(targetLabel)}`
					+ ` | ${record.lastOutcome?.status ?? 'apply interrupted'}${expired}\n`,
			);
		});
		const answer = await terminal.port.ask('Select a plan number, or q to cancel: ');
		if (answer === null || answer.trim().toLowerCase() === 'q') {
			return localSuccess('plan.recover', false, { cancelled: true }, 'Plan recovery cancelled.');
		}
		const index = Number.parseInt(answer.trim(), 10) - 1;
		if (!Number.isSafeInteger(index) || index < 0 || index >= records.length) {
			throw new Error('PLAN_RECOVERY_SELECTION_INVALID');
		}
		const record = records[index];
		terminal.port.write(`${renderLocalHumanV1('plan.show', {
			planRef: record.planRef,
			expiresAt: record.expiresAt,
			plan: record.plan,
			...(record.lastOutcome ? { lastOutcome: record.lastOutcome } : {}),
		}, 'Operon recovery plan')}\n\n`);
		const action = await terminal.port.ask(
			'Enter r to recover the same idempotent apply, a to abandon recovery, or q to cancel: ',
		);
		if (action === null || action.trim().toLowerCase() === 'q') {
			return localSuccess('plan.recover', false, { cancelled: true }, 'Plan recovery cancelled.');
		}
		if (action.trim().toLowerCase() === 'a') {
			terminal.port.write(
				'Abandoning removes the only local recovery reference even if the mutation may have applied.\n',
			);
			const confirmation = await terminal.port.ask('Type ABANDON to remove this recovery record: ');
			if (confirmation !== 'ABANDON') {
				return localSuccess('plan.recover', false, { cancelled: true }, 'Recovery record was preserved.');
			}
			abandonRecoverableMutationPlanV1(record.planRef, confirmation, root);
			return localSuccess(
				'plan.recover',
				false,
				{ planRef: record.planRef, abandoned: true },
				`Abandoned recovery for Operon plan ${record.planRef}.`,
			);
		}
		if (action.trim().toLowerCase() !== 'r') throw new Error('PLAN_RECOVERY_ACTION_INVALID');
		return await runPlanApply([
			record.planRef,
			...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
			...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
		], false, ports, root, true);
	} finally {
		terminal.close();
	}
}

async function runTaskFind(
	argv: string[],
	json: boolean,
	ports: PublicCommandPortsV1,
): Promise<PublicCommandOutcomeV1> {
	if (json) throw new Error('FINDER_JSON_UNSUPPORTED');
	if (argv.includes('--input')) throw new Error('FINDER_INPUT_UNSUPPORTED');
	const parsed = parseFlags(argv, {
		value: ['--vault', '--profile', '--timeout-ms', '--obsidian-bin'],
		boolean: ['--json'],
		positional: [0, 1],
	});
	const terminal = ports.interactive
		? { port: ports.interactive, close: () => undefined }
		: createProcessGuidedPort();
	if (!terminal) throw new Error('FINDER_TTY_REQUIRED');
	const runtimeTargetArgs = [
		...(parsed.values['--vault'] ? ['--vault', parsed.values['--vault']] : []),
		...(parsed.values['--profile'] ? ['--profile', parsed.values['--profile']] : []),
		...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
		...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
	];
	const runtimeResponse = async <T>(
		args: string[],
		input?: Buffer,
	): Promise<TaskFinderRuntimeResponseV1<T>> => {
		const outcome = await runRuntimeCommand(args, ports, input ? { input } : {});
		if (outcome.envelope.kind !== 'cli-result' || !outcome.envelope.ok) {
			return {
				ok: false,
				failure: outcome,
				...(outcome.envelope.kind === 'cli-result'
					? { code: outcome.envelope.failure.error.code }
					: {}),
			};
		}
		return { ok: true, value: outcome.envelope.result as T, opaque: outcome };
	};
	try {
		const result = await runGuidedTaskFinderV1({
			port: terminal.port,
			...(parsed.positionals[0] ? { initialQuery: parsed.positionals[0] } : {}),
			runtime: {
				finder: async (finder: TaskFinderQueryV1) => {
					const request: TaskFinderRequestV1 = {
						contractVersion: 1,
						requestId: randomUUID(),
						kind: 'task-finder',
						consistency: 'live-verified',
						...finder,
					};
					return await runtimeResponse<TaskFinderResultV1>(
						['finder', '--input', '-', ...runtimeTargetArgs, '--json'],
						Buffer.from(JSON.stringify(request), 'utf8'),
					);
				},
				read: async (selector: TaskSelectorV1) => {
					const request: TaskGetRequestV1 = {
						contractVersion: 1,
						requestId: randomUUID(),
						kind: 'task-get',
						consistency: 'live-verified',
						selector,
					};
					return await runtimeResponse<TaskGetResultV1>(
						['task', 'get', '--input', '-', ...runtimeTargetArgs, '--json'],
						Buffer.from(JSON.stringify(request), 'utf8'),
					);
				},
				catalog: async () => await runtimeResponse<OperonCatalogV1>([
					'catalog',
					...runtimeTargetArgs,
					'--json',
				]),
			},
		});
		if (result.status === 'cancelled') {
			return localSuccess('task.find', false, { cancelled: true }, result.message);
		}
		if (result.status === 'failed') {
			const outcome = result.failure as PublicCommandOutcomeV1;
			return { ...outcome, json: false };
		}
		const outcome = result.opaque as PublicCommandOutcomeV1;
		return { ...outcome, json: false };
	} finally {
		terminal.close();
	}
}

async function runSetup(
	argv: string[],
	json: boolean,
	ports: PublicCommandPortsV1,
	root: string,
): Promise<PublicCommandOutcomeV1> {
	const parsed = parseFlags(argv, {
		value: ['--vault', '--name', '--obsidian-bin'],
		boolean: ['--default', '--live', '--json'],
	});
	const current = loadOperonCliConfigV1(root);
	let vaultPath = parsed.values['--vault'];
	let name = parsed.values['--name'];
	let makeDefault = parsed.booleans.has('--default');
	let verifyLive = parsed.booleans.has('--live');
	let guided = false;
	let terminal: ReturnType<typeof createProcessGuidedPort> | {
		port: InteractiveTerminalPortV1;
		close(): void;
	} | null = null;
	if (!vaultPath && !name && !json) {
		terminal = ports.interactive
			? { port: ports.interactive, close: () => undefined }
			: createProcessGuidedPort();
		if (!terminal) throw new Error('SETUP_ARGUMENTS_REQUIRED');
		guided = true;
		let result;
		try {
			result = await runGuidedSetupWizardV1({
				port: terminal.port,
				config: current,
				cwd: ports.cwd ?? process.cwd(),
			});
		} finally {
			terminal.close();
			terminal = null;
		}
		if (result.status === 'cancelled') {
			return localSuccess('setup', false, { cancelled: true }, result.message);
		}
		({ vaultPath, name, makeDefault, verifyLive } = result.selection);
	} else if (!vaultPath || !name) {
		throw new Error('SETUP_ARGUMENTS_REQUIRED');
	}
	const config = upsertVaultProfileV1(current, {
		name,
		vaultPath,
		makeDefault,
	});
	const resolved = resolveVaultV1(config, { explicitProfile: name });
	const manifest = validateOperonManifestV1(resolved.canonicalPath);
	saveOperonCliConfigV1(config, root);
	let live: unknown;
	if (verifyLive) {
		const runtime = await runRuntimeCommand([
			'diagnostics',
			'--vault',
			resolved.canonicalPath,
			...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
			'--json',
		], { ...ports, configRoot: root });
		if (runtime.exitCode !== 0) {
			return {
				...runtime,
				json: false,
				human: [
					'Local setup saved; live verification incomplete.',
					runtime.human,
					'Retry: operon doctor --live',
				].join('\n'),
			};
		}
		live = runtime.envelope;
	}
	const completionHint = guided ? completionHintForShellV1(process.env.SHELL) : undefined;
	return localSuccess('setup', json, {
		profile: config.profiles.find(profile => profile.name === name),
		plugin: manifest,
		...(live ? { live } : {}),
	}, [
		`Configured Operon vault profile: ${name}${live ? ' (live verified)' : ''}`,
		...(guided ? [
			'✓ Vault and Operon plugin verified',
			`✓ Profile saved${makeDefault ? ' as default' : ''}`,
			...(live ? ['✓ Live Runtime verified'] : ['○ Live Runtime verification skipped']),
			...(completionHint ? [completionHint] : []),
		] : []),
	].join('\n'));
}

async function runDoctor(
	argv: string[],
	json: boolean,
	ports: PublicCommandPortsV1,
	root: string,
): Promise<PublicCommandOutcomeV1> {
	const parsed = parseFlags(argv, {
		value: ['--vault', '--profile', '--obsidian-bin'],
		boolean: ['--live', '--repair-security', '--json'],
	});
	const repairedSecurity = parsed.booleans.has('--repair-security')
		? repairCliStorageSecurityV1(root)
		: undefined;
	const config = loadOperonCliConfigV1(root);
	const resolved = resolveVaultV1(config, {
		explicitVault: parsed.values['--vault'],
		explicitProfile: parsed.values['--profile'],
		cwd: ports.cwd ?? process.cwd(),
	});
	const manifest = validateOperonManifestV1(resolved.canonicalPath);
	const security = repairedSecurity ?? inspectCliStorageSecurityV1(root);
	if (!security.secure) throw new Error(
		`CLI_STORAGE_SECURITY_UNAVAILABLE:${security.failureReason ?? 'SECURITY_CHECK_FAILED'}`,
	);
	let live: unknown;
	if (parsed.booleans.has('--live')) {
		const runtime = await runRuntimeCommand([
			'diagnostics',
			'--vault',
			resolved.canonicalPath,
			...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
			'--json',
		], { ...ports, configRoot: root });
		if (runtime.exitCode !== 0) {
			return {
				...runtime,
				json,
				human: `${runtime.human}\n${doctorRemediationV1(runtime)}`,
			};
		}
		live = runtime.envelope;
	}
	return localSuccess('doctor', json, {
		platform: {
			name: process.platform,
			liveTransport: liveTransportPlatformStatusV1(),
		},
		security: {
			...security,
			repaired: parsed.booleans.has('--repair-security'),
		},
		vault: resolved,
		plugin: manifest,
		...(live ? { live } : {}),
	}, `Operon doctor: vault and plugin valid${live ? ', Runtime verified' : ''}; ${
		security.backend
	} storage security valid.`);
}

function doctorRemediationV1(outcome: PublicCommandOutcomeV1): string {
	if (outcome.envelope.kind !== 'cli-result') {
		return 'Run operon setup to verify the local vault profile, then retry operon doctor --live.';
	}
	const failure = outcome.envelope.failure;
	if (!failure) return 'Retry operon doctor --live and inspect the returned Runtime result.';
	const code = failure.error.code;
	const stage = failure.stage;
	const reasonCode = typeof failure.error.details?.reasonCode === 'string'
		? failure.error.details.reasonCode
		: '';
	switch (reasonCode) {
		case 'obsidian-cli-bin-not-found':
			return 'Install or repair the official Obsidian CLI executable, or provide its exact path with --obsidian-bin.';
		case 'obsidian-cli-execution-denied':
			return 'Check the Obsidian CLI executable permissions, quarantine state, and host execution policy before retrying.';
		case 'obsidian-cli-host-unreachable':
			return 'The official CLI could not reach the Obsidian desktop host. Confirm the intended vault is open and CLI integration is enabled. If this shell is sandboxed or isolated, run from a host-authorized terminal or grant local IPC access.';
		case 'obsidian-cli-handler-unavailable':
			return 'The Obsidian CLI is connected, but the Operon handler is unavailable. Confirm Operon is enabled in the selected vault, then reload the plugin.';
		case 'obsidian-cli-response-invalid':
		case 'obsidian-cli-exit-failed':
			return 'The CLI transport returned an unexpected response. Retry operon doctor --live --json from a host-authorized terminal and inspect its structured reason code.';
		case 'obsidian-cli-deadline-exceeded':
			return 'Operon Runtime did not answer before the deadline. Wait briefly, then retry operon doctor --live.';
		default:
			break;
	}
	if (stage === 'transport' || code === 'transport-unavailable') {
		return 'Check that the selected vault is open, Operon is enabled, and the official Obsidian CLI is available; then retry operon doctor --live.';
	}
	if (stage === 'readiness' || code === 'live-settling') {
		return 'Operon Runtime is still settling. Wait briefly, then retry operon doctor --live.';
	}
	if (stage === 'vault' || code === 'vault-mismatch') {
		return 'The configured vault identity no longer matches. Run operon setup again for the intended vault.';
	}
	if (stage === 'compatibility') {
		return 'The installed Operon plugin and CLI are incompatible. Update the incompatible component, then retry.';
	}
	return 'Review the reported stage and retry operon doctor --live after resolving it.';
}

function runPlanShow(argv: string[], json: boolean, root: string): PublicCommandOutcomeV1 {
	const positional = argv.filter(value => value !== '--json');
	if (positional.length !== 1) throw new Error('PLAN_REF_REQUIRED');
	const record = readMutationPlanV1(positional[0], root, { allowExpired: true });
	const plan = record.plan;
	return localSuccess('plan.show', json, {
		planRef: record.planRef,
		createdAt: record.createdAt,
		expiresAt: record.expiresAt,
			plan: {
				planId: plan.planId,
				confirmationToken: confirmationTokenForPlanV1(plan),
				capability: plan.capability,
			mutationKind: plan.mutationKind,
			createdAt: plan.createdAt,
			expiresAt: plan.expiresAt,
				targets: plan.targets,
				atomicGroups: plan.atomicGroups,
				predictedEffects: plan.predictedEffects,
			riskLevel: plan.riskLevel,
			requiresConfirmation: plan.requiresConfirmation,
			requiredAcknowledgements: plan.requiredAcknowledgements,
			warnings: plan.warnings,
			spec: plan.spec,
			...(plan.createEffects ? { createEffects: plan.createEffects } : {}),
			...(plan.conversionEffect ? { conversionEffect: plan.conversionEffect } : {}),
		},
		...(record.lastOutcome ? { lastOutcome: record.lastOutcome } : {}),
	}, `Operon plan ${record.planRef}: ${record.plan.mutationKind}`);
}

function runPlanDiscard(argv: string[], json: boolean, root: string): PublicCommandOutcomeV1 {
	const positional = argv.filter(value => value !== '--json');
	if (positional.length !== 1) throw new Error('PLAN_REF_REQUIRED');
	let discarded: boolean;
	try {
		discarded = discardMutationPlanV1(positional[0], root);
	} catch (error) {
		if (error instanceof Error && error.message === 'PLAN_RECOVERY_REQUIRED') {
			return localRecoveryFailure('plan.discard', json, positional[0]);
		}
		throw error;
	}
	return localSuccess('plan.discard', json, { planRef: positional[0], discarded }, `Discarded Operon plan ${positional[0]}.`);
}

async function runPlanApply(
	argv: string[],
	json: boolean,
	ports: PublicCommandPortsV1,
	root: string,
	recovery: boolean,
): Promise<PublicCommandOutcomeV1> {
	const parsed = parseFlags(argv, {
		value: ['--confirm', '--obsidian-bin', '--timeout-ms'],
		boolean: ['--json'],
		positional: 1,
	});
	const planRef = parsed.positionals[0];
	let record: StoredMutationPlanV1;
	try {
		record = readMutationPlanV1(planRef, root, { allowExpired: recovery });
	} catch (error) {
		if (error instanceof Error && error.message === 'PLAN_RECOVERY_REQUIRED') {
			return localRecoveryFailure('plan.apply', json, planRef);
		}
		throw error;
	}
	assertStoredPlanVaultIdentity(record);
	if (
		ports._resolvedTarget
		&& (
			record.vaultPath !== ports._resolvedTarget.canonicalPath
			|| record.vaultSha256 !== ports._resolvedTarget.vaultSha256
		)
	) {
		throw new Error('VAULT_TARGET_CHANGED');
	}
	if (!recovery && (record.applyRequest || record.lastOutcome)) {
		return localRecoveryFailure('plan.apply', json, planRef);
	}
	let confirmation = parsed.values['--confirm'];
	const semanticConfirmation = semanticConfirmationWord(record.plan);
	if (
		!recovery
		&& (
			semanticConfirmation !== null
			|| record.plan.riskLevel === 'destructive'
			|| record.plan.requiresConfirmation
			|| record.plan.requiredAcknowledgements.length > 0
		)
		&& !confirmation
		&& !json
		&& (ports.interactive || (process.stdin.isTTY && process.stdout.isTTY))
	) {
			const confirmed = await promptForSemanticConfirmation(
				record.plan,
				semanticConfirmation ?? 'CONFIRM',
				planRef,
				ports.interactive,
			);
		if (!confirmed) throw new Error('PLAN_CONFIRMATION_REQUIRED');
		confirmation = confirmationTokenForPlanV1(record.plan);
	}
	let applyRequest = recovery
		? requireRecoveryRequest(record.applyRequest)
		: buildMutationApplyRequestV1(record, { confirmationToken: confirmation });
	if (!recovery) {
		record = markMutationPlanDispatchedV1(record, applyRequest, root);
		applyRequest = requireRecoveryRequest(record.applyRequest);
	}
	const runtime = await runRuntimeCommand([
		'mutation',
		'apply',
		'--vault',
		record.vaultPath,
		'--input',
		'-',
		...(parsed.values['--obsidian-bin'] ? ['--obsidian-bin', parsed.values['--obsidian-bin']] : []),
		...(parsed.values['--timeout-ms'] ? ['--timeout-ms', parsed.values['--timeout-ms']] : []),
		'--json',
	], { ...ports, configRoot: root }, {
		input: Buffer.from(JSON.stringify(applyRequest), 'utf8'),
	});
	let terminalHandoffFailed = false;
	if (runtime.envelope.kind === 'cli-result' && runtime.envelope.ok && isMutationResult(runtime.envelope.result)) {
		try {
			recordMutationOutcomeV1(record, applyRequest, runtime.envelope.result, root);
		} catch {
			terminalHandoffFailed = true;
		}
	}
	const baseEnvelope = runtime.envelope.kind === 'cli-result'
		? {
			...runtime.envelope,
			client: {
				...runtime.envelope.client,
				...(record.profile ? { profile: record.profile } : {}),
				planRef,
			},
		}
		: runtime.envelope;
	const mutationResult = runtime.envelope.kind === 'cli-result'
		&& runtime.envelope.ok
		&& isMutationResult(runtime.envelope.result)
		? runtime.envelope.result
		: null;
	let safelyRestoredBeforeDispatch = false;
	if (
		!recovery
		&& runtime._applyDispatchEvidence === 'not-started'
		&& runtime.exitCode !== 0
	) {
		try {
			record = restoreMutationPlanBeforeDispatchV1(record, applyRequest, root);
			safelyRestoredBeforeDispatch = true;
		} catch {
			// A concurrent terminal handoff or an indeterminate store state remains recovery-only.
		}
	}
	const requiresRecovery = !safelyRestoredBeforeDispatch && (terminalHandoffFailed || (
		runtime.envelope.kind === 'cli-result'
		&& !runtime.envelope.ok
	) || (
		mutationResult !== null
		&& mutationResult.mutationMayHaveApplied === true
		&& mutationResult.status !== 'applied'
		&& mutationResult.status !== 'already-applied'
	) || (
		runtime.envelope.kind !== 'cli-result'
		&& runtime.exitCode !== 0
	));
	const recoveryEnvelope = {
		required: true as const,
		planRef,
		action: 'recover-same-plan' as const,
		mutationMayHaveApplied: true as const,
	};
	const envelope = requiresRecovery
		? terminalHandoffFailed
			? localRecoveryFailure(
				recovery ? 'plan.recover' : 'plan.apply',
				json,
				planRef,
			).envelope
			: baseEnvelope.kind === 'cli-result' && !baseEnvelope.ok
			? {
				...baseEnvelope,
				failure: {
					...baseEnvelope.failure,
					error: structuredErrorV1(
						'outcome-unknown',
						'Apply dispatch did not produce a safely final result. Recover the same plan.',
						{
							details: {
								reasonCode: 'apply-dispatch-not-final',
								originalCode: baseEnvelope.failure.error.code,
							},
						},
					),
				},
				recovery: recoveryEnvelope,
			}
			: baseEnvelope.kind !== 'cli-result'
				? localRecoveryFailure(
					recovery ? 'plan.recover' : 'plan.apply',
					json,
					planRef,
				).envelope
				: { ...baseEnvelope, recovery: recoveryEnvelope }
		: baseEnvelope;
	const renderedHuman = envelope.kind === 'cli-result'
		? ports.outputMode === 'envelope-only'
			&& runtime.exitCode === 0
			&& envelope.ok
			? ''
			: renderPublicRuntimeHuman(envelope, {
				suppressMutationRecovery: safelyRestoredBeforeDispatch,
			})
		: runtime.human;
	const human = safelyRestoredBeforeDispatch
		? [
			renderedHuman,
			'Apply was not dispatched. Retry this stored plan with:',
			`  operon plan apply ${planRef}`,
		].join('\n')
		: renderedHuman;
	const recoveryOutcome = recovery
		&& envelope.kind === 'cli-result'
		&& envelope.ok
		&& isMutationResult(envelope.result)
		? envelope.result.status === 'applied' || envelope.result.status === 'already-applied'
			? 'forward-completed'
			: envelope.result.status === 'failed'
				&& envelope.result.mutationMayHaveApplied === false
				? 'compensated'
				: 'unresolved'
		: null;
	return {
		...runtime,
		exitCode: requiresRecovery ? 5 : runtime.exitCode,
		json,
		envelope,
		...(requiresRecovery ? { _recoveryPlanRef: planRef } : {}),
		human: requiresRecovery
			? [
				human,
				'Apply outcome is uncertain. Do not repeat the compact command.',
				`Recover only this stored plan: operon plan recover ${planRef}`,
			].join('\n')
			: recoveryOutcome
				? `${human}\nRecovery outcome: ${recoveryOutcome}`
				: human,
	};
}

function resolveRuntimeVaultArgs(
	argv: string[],
	ports: PublicCommandPortsV1,
	benchmarkSpan?: (span: string, durationMs: number) => void,
): {
	argv: string[];
	canonicalPath: string;
	target: ResolvedVaultCommandScopeV1;
	profile?: string;
} {
	const explicitVault = readFlag(argv, '--vault');
	const explicitProfile = readFlag(argv, '--profile');
	const target = ports._resolvedTarget ?? createResolvedVaultCommandScopeV1({
		...(explicitVault ? { explicitVault } : {}),
		...(explicitProfile ? { explicitProfile } : {}),
		cwd: ports.cwd ?? process.cwd(),
	}, ports.configRoot ?? operonCliConfigRootV1(), benchmarkSpan);
	assertResolvedVaultCommandScopeV1(target);
	if (
		ports._resolvedTarget
		&& (
			(explicitVault !== undefined && explicitVault !== target.canonicalPath)
			|| (explicitProfile !== undefined && explicitProfile !== target.profile)
		)
	) {
		throw new Error('VAULT_TARGET_CHANGED');
	}
	const withoutTargetFlags = removeFlag(removeFlag(argv, '--profile'), '--vault');
	return {
		argv: [...withoutTargetFlags, '--vault', target.canonicalPath],
		canonicalPath: target.canonicalPath,
		target,
		...(target.profile ? { profile: target.profile } : {}),
	};
}

function withResolvedRuntimeTargetV1(
	values: Record<string, string>,
	ports: PublicCommandPortsV1,
): PublicCommandPortsV1 {
	if (ports._resolvedTarget) {
		assertResolvedVaultCommandScopeV1(ports._resolvedTarget);
		return ports;
	}
	const pendingBenchmarkSpans: Array<{
		span: string;
		durationMs: number;
		recorded: boolean;
	}> = [];
	const target = createResolvedVaultCommandScopeV1({
		...(values['--vault'] ? { explicitVault: values['--vault'] } : {}),
		...(values['--profile'] ? { explicitProfile: values['--profile'] } : {}),
		cwd: ports.cwd ?? process.cwd(),
	}, ports.configRoot ?? operonCliConfigRootV1(), (span, durationMs) => {
		pendingBenchmarkSpans.push({ span, durationMs, recorded: false });
	});
	return {
		...ports,
		_resolvedTarget: target,
		_pendingBenchmarkSpans: pendingBenchmarkSpans,
	};
}

function parseLocalCommand(argv: string[]): { command: LocalCommandV1; consumed: number } | null {
	const resolved = resolveCommandDefinitionV1(argv, 'local');
	return resolved ? {
		command: resolved.definition.id as LocalCommandV1,
		consumed: resolved.consumed,
	} : null;
}

function parseConvenienceCommand(argv: string[]): { command: string; consumed: number } | null {
	const resolved = resolveCommandDefinitionV1(argv, 'convenience');
	if (!resolved || !CONVENIENCE_COMMAND_SET.has(resolved.definition.id)) return null;
	return { command: resolved.definition.id, consumed: resolved.consumed };
}

function convenienceMapping(command: string, spec?: Record<string, unknown>): {
	mutationKind: keyof typeof OPERON_CLI_MUTATION_CAPABILITIES_V1;
	capability: MutationPreviewRequestV1['capability'];
	operation: string;
} {
	if (command === 'task.update' && spec?.operation === 'update-batch') {
		return {
			mutationKind: 'task.update',
			capability: OPERON_CLI_MUTATION_CAPABILITIES_V1['task.update'].preview,
			operation: 'update-batch',
		};
	}
	if (command === 'task.update' && spec?.operation === 'replace-relationships') {
		return {
			mutationKind: 'task.relationship',
			capability: OPERON_CLI_MUTATION_CAPABILITIES_V1['task.relationship'].preview,
			operation: 'replace-relationships',
		};
	}
	if (command === 'task.update' && spec?.operation === 'update-recurrence') {
		return {
			mutationKind: 'task.recurrence',
			capability: OPERON_CLI_MUTATION_CAPABILITIES_V1['task.recurrence'].preview,
			operation: 'update-recurrence',
		};
	}
	const definitions = {
		'task.create': ['task.create', 'create'],
		'task.update': ['task.update', 'update'],
		'task.transition': ['task.transition', 'transition'],
		'task.pin': ['task.pinned-state', 'set-pinned'],
		'task.unpin': ['task.pinned-state', 'set-pinned'],
		'task.delete': ['task.delete', 'delete'],
		'task.convert': ['task.convert', 'convert'],
		'task.relocate': ['task.inline-relocate', 'relocate-inline'],
		'reminder.add': ['task.reminder-item', 'add'],
		'reminder.replace': ['task.reminder-item', 'replace'],
		'reminder.remove': ['task.reminder-item', 'remove'],
		'timer.start': ['timer.control', 'start'],
		'timer.stop': ['timer.control', 'stop'],
		'timer.session.add': ['timer.session', 'add-session'],
		'timer.session.update': ['timer.session', 'update-session'],
		'timer.session.remove': ['timer.session', 'remove-session'],
	} as const;
	const definition = definitions[command as keyof typeof definitions];
	if (!definition) throw new Error('UNKNOWN_CONVENIENCE_COMMAND');
	const mutationKind = definition[0];
	return {
		mutationKind,
		capability: OPERON_CLI_MUTATION_CAPABILITIES_V1[mutationKind].preview,
		operation: definition[1],
	};
}

interface CliMutationIntentInputV1 {
	requestId?: string;
	idempotencyKey?: string;
	correlationId?: string;
	target?: MutationPreviewRequestV1['target'];
	spec: Record<string, unknown>;
	reason?: string;
}

function parseMutationIntent(value: unknown): CliMutationIntentInputV1 {
	if (!isPlainRecord(value)) throw new Error('INTENT_MALFORMED');
	const allowed = new Set(['contractVersion', 'kind', 'requestId', 'idempotencyKey', 'correlationId', 'target', 'spec', 'reason']);
	if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('INTENT_UNKNOWN_FIELD');
	if (
		value.contractVersion !== 1
		|| value.kind !== 'mutation-intent'
		|| !isPlainRecord(value.spec)
		|| (value.requestId !== undefined && typeof value.requestId !== 'string')
		|| (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== 'string')
		|| (value.correlationId !== undefined && typeof value.correlationId !== 'string')
		|| (value.reason !== undefined && typeof value.reason !== 'string')
		|| (value.target !== undefined && !isPlainRecord(value.target))
	) throw new Error('INTENT_MALFORMED');
	return value as unknown as CliMutationIntentInputV1;
}

async function readInput(path: string, supplied?: Buffer): Promise<unknown> {
	try {
		return JSON.parse(await readInputText(path, supplied)) as unknown;
	} catch (error) {
		if (error instanceof Error && error.message === 'INPUT_TOO_LARGE') throw error;
		if (error instanceof SyntaxError) throw new Error('INPUT_NOT_JSON');
		throw error;
	}
}

async function readInputText(
	path: string,
	supplied?: Buffer,
	fatalUtf8Code?: string,
): Promise<string> {
	let input: Buffer;
	if (supplied) {
		if (supplied.byteLength > CONTRACT_LIMITS_V1.transportInputBytes) {
			throw new Error('INPUT_TOO_LARGE');
		}
		input = supplied;
	} else if (path !== '-') {
		input = readInputFileSafelyV1(path);
	} else {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		for await (const chunk of process.stdin as AsyncIterable<string | Uint8Array>) {
			const bytes = Buffer.from(chunk);
			totalBytes += bytes.byteLength;
			if (totalBytes > CONTRACT_LIMITS_V1.transportInputBytes) throw new Error('INPUT_TOO_LARGE');
			chunks.push(bytes);
		}
		input = Buffer.concat(chunks);
	}
	if (fatalUtf8Code) {
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(input);
		} catch {
			throw new Error(fatalUtf8Code);
		}
	}
	return input.toString('utf8');
}

function parseFlags(
	argv: string[],
	spec: {
		value: string[];
		repeatableValue?: string[];
		boolean: string[];
		positional?: number | number[] | 'any';
	},
): {
	values: Record<string, string>;
	multiValues: Record<string, string[]>;
	booleans: Set<string>;
	positionals: string[];
} {
	const values: Record<string, string> = {};
	const multiValues: Record<string, string[]> = {};
	const booleans = new Set<string>();
	const positionals: string[] = [];
	let positionalOnly = false;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!positionalOnly && token === '--') {
			positionalOnly = true;
			continue;
		}
		if (positionalOnly) {
			positionals.push(token);
			continue;
		}
		if (spec.boolean.includes(token)) {
			if (booleans.has(token)) throw new Error('DUPLICATE_FLAG');
			booleans.add(token);
			continue;
		}
		if (spec.value.includes(token)) {
			if (values[token] !== undefined || argv[index + 1] === undefined) throw new Error('INVALID_FLAG_VALUE');
			values[token] = argv[index + 1];
			index += 1;
			continue;
		}
		if (spec.repeatableValue?.includes(token)) {
			if (argv[index + 1] === undefined) throw new Error('INVALID_FLAG_VALUE');
			(multiValues[token] ??= []).push(argv[index + 1]);
			index += 1;
			continue;
		}
		if (token.startsWith('-')) throw new Error('UNKNOWN_FLAG');
		positionals.push(token);
	}
	if (spec.positional !== 'any') {
		const expectedPositionals = Array.isArray(spec.positional)
			? spec.positional
			: [spec.positional ?? 0];
		if (!expectedPositionals.includes(positionals.length)) {
			throw new Error('POSITIONAL_ARGUMENT_REQUIRED');
		}
	}
	return { values, multiValues, booleans, positionals };
}

function readFlag(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

function removeFlag(argv: string[], flag: string): string[] {
	const index = argv.indexOf(flag);
	if (index < 0) return [...argv];
	return argv.filter((_value, candidate) => candidate !== index && candidate !== index + 1);
}

function assertOnlyJson(argv: string[]): void {
	if (argv.some(value => value !== '--json')) throw new Error('UNKNOWN_ARGUMENT');
}

function localSuccess(
	command: string,
	json: boolean,
	result: unknown,
	human: string,
): PublicCommandOutcomeV1 {
	return {
		exitCode: 0,
		json,
		envelope: {
			contractVersion: 1,
			kind: 'operon-cli-local-result',
			command,
			ok: true,
			result,
		},
		human: renderLocalHumanV1(command, result, human),
	};
}

function localRecoveryFailure(
	command: string,
	json: boolean,
	planRef: string,
): PublicCommandOutcomeV1 {
	const error = structuredErrorV1(
		'outcome-unknown',
		'This plan has an earlier apply attempt and must be recovered without replacement.',
		{ details: { reasonCode: 'plan-recovery-required' } },
	);
	return {
		exitCode: 5,
		json,
		envelope: {
			contractVersion: 1,
			kind: 'operon-cli-local-result',
			command,
			ok: false,
			error,
			recovery: {
				required: true,
				planRef,
				action: 'recover-same-plan',
				mutationMayHaveApplied: true,
			},
		},
		_recoveryPlanRef: planRef,
		human: [
			`Operon CLI failed: ${error.reason}`,
			`Recover only this stored plan: operon plan recover ${planRef}`,
		].join('\n'),
	};
}

function localFailure(
	command: string,
	json: boolean,
	error: unknown,
): PublicCommandOutcomeV1 {
	const code = error instanceof Error ? error.message.split(':', 1)[0] : 'INTERNAL_ERROR';
	const refusalCodes = new Set([
		'AMBIGUOUS_PRIORITY',
		'AMBIGUOUS_STATUS',
		'COMPACT_CAPABILITY_UNAVAILABLE',
		'COMPACT_BATCH_CAPABILITY_UNAVAILABLE',
		'CREATE_CAPABILITY_UNAVAILABLE',
		'DESCRIPTION_TARGET_AMBIGUOUS',
		'DESCRIPTION_TARGET_NOT_FOUND',
		'DESCRIPTION_RESOLUTION_INCOMPLETE',
		'DIRECT_CAPABILITY_UNAVAILABLE',
		'DIRECT_REMINDER_ITEM_AMBIGUOUS',
		'DIRECT_REMINDER_ITEM_NOT_FOUND',
		'DIRECT_REMINDER_ITEMS_INCOMPLETE',
		'DIRECT_TIMER_SESSION_TARGET_INCOMPLETE',
		'DIRECT_TARGET_INCOMPLETE',
		'DIRECT_DELETE_TARGET_INCOMPLETE',
		'DIRECT_FILE_TASK_REQUIRED',
		'DIRECT_INLINE_TASK_REQUIRED',
		'DIRECT_PLACEMENT_UNAVAILABLE',
		'DIRECT_SOURCE_TRANSITION_CATALOG_UNAVAILABLE',
		'DIRECT_SOURCE_TRANSITION_TARGET_INCOMPLETE',
		'DIRECT_TEMPLATE_UNAVAILABLE',
		'AMBIGUOUS_LIFECYCLE_TARGET',
		'CURRENT_PIPELINE_UNAVAILABLE',
		'CURRENT_STATUS_UNAVAILABLE',
		'LIFECYCLE_ACTION_UNAVAILABLE',
		'LIFECYCLE_TARGET_UNAVAILABLE',
		'GUIDED_CAPABILITY_UNAVAILABLE',
		'GUIDED_CATALOG_UNAVAILABLE',
		'GUIDED_CONTEXT_UNAVAILABLE',
		'GUIDED_HYDRATION_TRUNCATED',
		'GUIDED_INLINE_TASK_REQUIRED',
		'GUIDED_PLACEMENT_UNAVAILABLE',
		'GUIDED_PIPELINE_UNAVAILABLE',
		'GUIDED_PRIORITY_UNAVAILABLE',
		'GUIDED_REPRESENTATION_UNAVAILABLE',
		'GUIDED_REMINDER_ANCHOR_UNAVAILABLE',
		'GUIDED_REMINDER_COLLECTION_UNAVAILABLE',
		'GUIDED_REMINDER_ITEMS_UNAVAILABLE',
		'GUIDED_STATUS_UNAVAILABLE',
		'GUIDED_TEMPLATE_UNAVAILABLE',
		'GUIDED_TARGET_REQUIRED',
		'GUIDED_TIMER_TRANSITION_IN_PROGRESS',
		'GUIDED_WRITABLE_FIELDS_INCOMPLETE',
		'GUIDED_WRITABLE_FIELDS_UNAVAILABLE',
		'PLATFORM_UNSUPPORTED',
		'OPERON_PLUGIN_NOT_FOUND',
		'OPERON_MANIFEST_INVALID',
		'VAULT_PROFILE_MOVED',
		'PLAN_CONFIRMATION_REQUIRED',
		'PLAN_VAULT_MISMATCH',
		'RAW_MUTATION_APPLY_DISABLED',
		'PLAN_RECOVERY_REQUIRED',
		'RECURRING_TEMPORAL_REQUIRES_SCOPE',
		'RELATIONSHIP_CAPABILITY_UNAVAILABLE',
		'RELATIONSHIP_TARGET_INCOMPLETE',
		'RECURRENCE_CAPABILITY_UNAVAILABLE',
		'RECURRENCE_TARGET_INCOMPLETE',
		'WRITABLE_FIELDS_INCOMPLETE',
	]);
	const unavailableCodes = new Set([
		'CLIENT_IDENTITY_MISSING',
		'CONFIG_FILE_NOT_SECURE',
		'CONFIG_FILE_WRONG_MODE',
		'CONFIG_FILE_WRONG_OWNER',
		'CONFIG_MALFORMED',
		'CONFIG_ROOT_NOT_SECURE',
		'CONFIG_ROOT_UNAVAILABLE',
		'CONFIG_ROOT_WRONG_MODE',
		'CONFIG_ROOT_WRONG_OWNER',
		'CONFIG_UNKNOWN_FIELD',
		'PLAN_EXPIRED',
		'PLAN_MALFORMED',
		'PLAN_NOT_SECURE',
		'PLAN_UNKNOWN_FIELD',
		'PLAN_WRONG_MODE',
		'PLAN_WRONG_OWNER',
		'PROFILE_NOT_FOUND',
		'VAULT_NOT_CONFIGURED',
	]);
	const reason = (
		error instanceof Error
		&& 'publicReason' in error
		&& typeof error.publicReason === 'string'
	)
		? sanitizeTerminalTextV1(error.publicReason)
		: localErrorReason(code);
	const usageCodes = new Set([
		'COMPACT_BATCH_BLANK_LINE',
		'COMPACT_BATCH_EMPTY',
		'COMPACT_BATCH_LINE_ENDING_INVALID',
		'COMPACT_BATCH_TOO_MANY_ITEMS',
		'COMPACT_BATCH_UTF8_INVALID',
		'COMPACT_DESCRIPTION_QUOTE_REQUIRED',
		'COMPACT_DESCRIPTION_REQUIRED',
		'COMPACT_INPUT_CONFLICT',
		'COMPACT_SYNTAX_INVALID',
		'COMPACT_UPDATE_INPUT_CONFLICT',
		'COMPACT_UPDATE_BATCH_BLANK_LINE',
		'COMPACT_UPDATE_BATCH_DUPLICATE_ID',
		'COMPACT_UPDATE_BATCH_EMPTY',
		'COMPACT_UPDATE_BATCH_LINE_ENDING_INVALID',
		'COMPACT_UPDATE_BATCH_SELECTOR_REQUIRED',
		'COMPACT_UPDATE_BATCH_TOO_FEW_ITEMS',
		'COMPACT_UPDATE_BATCH_TOO_MANY_ITEMS',
		'COMPACT_UPDATE_BATCH_UTF8_INVALID',
		'COMPACT_UPDATE_SELECTOR_REQUIRED',
		'COMPACT_VALUE_QUOTE_REQUIRED',
		'DIRECT_LIFECYCLE_ASSIGNMENT_UNAVAILABLE',
		'DIRECT_CONVERT_FLAGS_INVALID',
		'DIRECT_CONVERT_TO_INVALID',
		'DIRECT_DELETE_ASSIGNMENT_UNAVAILABLE',
		'DIRECT_LINE_INVALID',
		'DIRECT_MUTATION_INPUT_CONFLICT',
		'DIRECT_PINNED_ASSIGNMENT_UNAVAILABLE',
		'DIRECT_REMINDER_ASSIGNMENT_REQUIRED',
		'DIRECT_REMINDER_CURRENT_CONFLICT',
		'DIRECT_REMINDER_CURRENT_REQUIRED',
		'DIRECT_REMINDER_INVALID_KEY',
		'DIRECT_REMINDER_INVALID_OPERON_ID',
		'DIRECT_REMINDER_INVALID_VALUE',
		'DIRECT_REMINDER_MULTI_ITEM_UNAVAILABLE',
		'DIRECT_TIMER_SESSION_ASSIGNMENT_UNAVAILABLE',
		'DIRECT_TIMER_SESSION_DATETIME_INVALID',
		'DIRECT_TIMER_SESSION_NUMBER_CONFLICT',
		'DIRECT_TIMER_SESSION_NUMBER_INVALID',
		'DIRECT_TIMER_SESSION_RANGE_CONFLICT',
		'DIRECT_TIMER_SESSION_RANGE_INVALID',
		'DIRECT_TIMER_SESSION_RANGE_REQUIRED',
		'DIRECT_SELECTOR_REQUIRED',
		'DIRECT_SOURCE_TRANSITION_ASSIGNMENT_UNAVAILABLE',
		'DIRECT_TARGET_FILE_INVALID',
		'DIRECT_TEMPLATE_INVALID',
		'DESCRIPTION_CLEAR_UNAVAILABLE',
		'DUPLICATE_CLEAR',
		'DUPLICATE_KEY',
		'DUPLICATE_LIST_ELEMENT',
		'DUPLICATE_FLAG',
		'EMPTY_LIST_ELEMENT',
		'COMPLETION_SHELL_REQUIRED',
		'EXACT_TARGET_REQUIRED',
		'FIELD_NOT_WRITABLE',
		'FIELD_OWNED_BY_OTHER_COMMAND',
		'GUIDED_INPUT_CONFLICT',
		'GUIDED_MAINTENANCE_TTY_REQUIRED',
		'GUIDED_PREVIEW_ONLY_CONFLICT',
		'GUIDED_TTY_REQUIRED',
		'PLAN_ABANDON_CONFIRMATION_REQUIRED',
		'PLAN_RECOVERY_ACTION_INVALID',
		'PLAN_RECOVERY_SELECTION_INVALID',
		'PLAN_RECOVERY_TTY_REQUIRED',
		'FINDER_INPUT_UNSUPPORTED',
		'FINDER_JSON_UNSUPPORTED',
		'FINDER_TTY_REQUIRED',
		'INPUT_REQUIRED',
		'INPUT_FORMAT_REQUIRES_INPUT',
		'INPUT_FORMAT_UNSUPPORTED',
		'INPUT_NOT_JSON',
		'INPUT_TOO_LARGE',
		'INVALID_FIELD_VALUE',
		'INVALID_OPERON_ID',
		'INVALID_CONSISTENCY',
		'INVALID_FLAG_VALUE',
		'INVALID_INTEGER',
		'INVALID_PARENT_TASK',
		'INVALID_PLAN_REF',
		'INVALID_PRIORITY',
		'INVALID_PROFILE_NAME',
		'INVALID_SCHEMA_ID',
		'INVALID_STATUS',
		'INTENT_MALFORMED',
		'INTENT_UNKNOWN_FIELD',
		'MISSING_VALUE',
		'MUTATION_OPERATION_MISMATCH',
		'PLAN_REF_REQUIRED',
		'POSITIONAL_ARGUMENT_REQUIRED',
		'PROFILE_NAME_REQUIRED',
		'READINESS_TIMEOUT_OUT_OF_RANGE',
		'RECOVERY_REQUEST_REQUIRED',
		'REQUIRED_ASSIGNEES_MISSING',
		'RECURRENCE_GENERAL_UPDATE_CONFLICT',
		'RECURRENCE_SCOPE_INVALID',
		'RELATIONSHIP_GENERAL_UPDATE_CONFLICT',
		'RELATIONSHIP_INVERSE_CONFLICT',
		'RELATIONSHIP_SELF_REFERENCE',
		'RELATIONSHIP_TARGET_INVALID',
		'SCHEMA_ID_REQUIRED',
		'SCHEMA_NOT_FOUND',
		'SETUP_ARGUMENTS_REQUIRED',
		'SET_CLEAR_CONFLICT',
		'TARGET_NOT_ALLOWED',
		'TASK_GET_REQUIRES_EXACTLY_ONE_SELECTOR_INPUT',
		'UNKNOWN_ARGUMENT',
		'UNKNOWN_CANONICAL_KEY',
		'UNKNOWN_COMMAND',
		'UNKNOWN_CONVENIENCE_COMMAND',
		'UNKNOWN_FLAG',
		'UPDATE_CHANGES_REQUIRED',
		'VAULT_NOT_DIRECTORY',
		'VAULT_PATH_UNAVAILABLE',
		'VAULT_PROFILE_AMBIGUOUS',
		'VAULT_PROFILE_REQUIRED',
		'VAULT_REQUIRED',
	]);
	const definition = commandDefinitionByIdV1(command);
	const usage = usageCodes.has(code) && definition
		? `\nUsage: ${definition.usage[0]}`
		: '';
	const umbrellaCode = localStructuredErrorCodeV1(
		code,
		usageCodes,
		unavailableCodes,
		refusalCodes,
	);
	const policy = errorPolicyForCodeV1(umbrellaCode);
	const defaultExitCode = {
		usage: 2,
		unavailable: 3,
		refused: 4,
		'runtime-failure': 5,
		internal: 70,
	}[policy.exitClass];
	const exitCode = code === 'CLI_ABORTED'
		? 130
		: defaultExitCode;
	return {
		exitCode,
		json,
		envelope: {
			contractVersion: 1,
			kind: 'operon-cli-local-result',
			command,
			ok: false,
			error: structuredErrorV1(umbrellaCode, reason, {
				details: { reasonCode: code.toLowerCase().replace(/_/gu, '-') },
			}),
		},
		human: `Operon CLI failed: ${reason}${usage}`,
	};
}

function localStructuredErrorCodeV1(
	reasonCode: string,
	usageCodes: ReadonlySet<string>,
	unavailableCodes: ReadonlySet<string>,
	refusalCodes: ReadonlySet<string>,
): string {
	if (usageCodes.has(reasonCode)) return 'invalid-request';
	if (reasonCode === 'PLAN_EXPIRED') return 'plan-expired';
	if (reasonCode === 'RECOVERY_STORE_UNAVAILABLE') return 'receipt-store-unavailable';
	if ([
		'PLAN_MALFORMED',
		'PLAN_NOT_SECURE',
		'PLAN_UNKNOWN_FIELD',
		'PLAN_WRONG_MODE',
		'PLAN_WRONG_OWNER',
	].includes(reasonCode)) return 'plan-tampered';
	if (reasonCode === 'PLAN_CONFIRMATION_REQUIRED') return 'confirmation-required';
	if (reasonCode === 'PLAN_VAULT_MISMATCH' || reasonCode === 'VAULT_TARGET_CHANGED') {
		return 'vault-mismatch';
	}
	if (reasonCode === 'RAW_MUTATION_APPLY_DISABLED') return 'invalid-request';
	if (
		unavailableCodes.has(reasonCode)
		|| reasonCode.startsWith('CONFIG_')
		|| reasonCode === 'CLIENT_IDENTITY_MISSING'
		|| reasonCode === 'PLATFORM_UNSUPPORTED'
		|| reasonCode === 'OPERON_PLUGIN_NOT_FOUND'
		|| reasonCode === 'OPERON_MANIFEST_INVALID'
	) return 'desktop-unavailable';
	if (refusalCodes.has(reasonCode)) return 'capability-unavailable';
	return 'internal-error';
}

function publicCliError(code: string, publicReason: string): Error {
	return Object.assign(new Error(code), { publicReason });
}

function localErrorReason(code: string): string {
	const reasons: Record<string, string> = {
		AMBIGUOUS_PRIORITY: 'The live priority is ambiguous.',
		AMBIGUOUS_STATUS: 'The live Pipeline.Status is ambiguous.',
		COMPACT_CAPABILITY_UNAVAILABLE: 'Compact task creation is unavailable.',
		COMPACT_BATCH_BLANK_LINE: 'Compact line batches cannot contain blank records.',
		COMPACT_BATCH_CAPABILITY_UNAVAILABLE: 'The live Runtime does not advertise compact line batch creation.',
		COMPACT_BATCH_EMPTY: 'Compact line batch input requires at least one record.',
		COMPACT_BATCH_LINE_ENDING_INVALID: 'Compact line batches require LF or CRLF line endings.',
		COMPACT_BATCH_PLAN_MISMATCH: 'The stored batch plan did not preserve the exact compact input items.',
		COMPACT_BATCH_TOO_MANY_ITEMS: `Compact line batches accept at most ${CONTRACT_LIMITS_V1.createItems} records.`,
		COMPACT_BATCH_UTF8_INVALID: 'Compact line batch input must be valid UTF-8.',
		COMPACT_DESCRIPTION_QUOTE_REQUIRED: 'Quote the raw description with straight ASCII double quotes.',
		COMPACT_DESCRIPTION_REQUIRED: 'A compact description is required.',
		COMPACT_INPUT_CONFLICT: 'Do not combine compact argv with --input.',
		COMPACT_SYNTAX_INVALID: 'Use exact canonical key::value assignments.',
		COMPACT_UPDATE_INPUT_CONFLICT: 'Do not combine direct task update arguments with --input.',
		COMPACT_UPDATE_BATCH_BLANK_LINE: 'Compact update line batches cannot contain blank records.',
		COMPACT_UPDATE_BATCH_CAPABILITY_UNAVAILABLE: 'The live Runtime does not advertise compact line batch update.',
		COMPACT_UPDATE_BATCH_DUPLICATE_ID: 'Each compact update line must target a unique Operon ID.',
		COMPACT_UPDATE_BATCH_EMPTY: 'Compact update line batch input requires at least two records.',
		COMPACT_UPDATE_BATCH_LINE_ENDING_INVALID: 'Compact update line batches require LF or CRLF line endings.',
		COMPACT_UPDATE_BATCH_PLAN_MISMATCH: 'The stored batch update plan did not preserve the exact input targets and changes.',
		COMPACT_UPDATE_BATCH_SELECTOR_REQUIRED: 'Each compact update line must begin with one quoted exact --id.',
		COMPACT_UPDATE_BATCH_TARGET_INCOMPLETE: 'The batch targets could not be live-verified as one exact inline source.',
		COMPACT_UPDATE_BATCH_TOO_FEW_ITEMS: 'Compact update line batches require at least two records.',
		COMPACT_UPDATE_BATCH_TOO_MANY_ITEMS: 'Compact update line batches accept at most 64 records.',
		COMPACT_UPDATE_BATCH_UTF8_INVALID: 'Compact update line batch input must be valid UTF-8.',
		COMPACT_UPDATE_SELECTOR_REQUIRED: 'Choose exactly one task target with --id or --description.',
		COMPACT_VALUE_QUOTE_REQUIRED: 'Quote every raw value with straight ASCII double quotes.',
		DIRECT_CAPABILITY_UNAVAILABLE: 'The capabilities required by this direct task operation are unavailable.',
		DIRECT_CONVERT_FLAGS_INVALID: 'Use --template only with --to file, and --line only with --to inline.',
		DIRECT_CONVERT_TO_INVALID: 'Choose exactly one conversion direction with --to file or --to inline.',
		DIRECT_DELETE_ASSIGNMENT_UNAVAILABLE: 'Direct task deletion accepts only one exact selector and --preview-only.',
		DIRECT_DELETE_TARGET_INCOMPLETE: 'The exact deletion target could not be live-verified completely.',
		DIRECT_FILE_TASK_REQUIRED: 'This direct operation requires one exact File Task.',
		DIRECT_INLINE_TASK_REQUIRED: 'This direct operation requires one exact inline task.',
		DIRECT_LIFECYCLE_ASSIGNMENT_UNAVAILABLE: 'Lifecycle commands do not accept field assignments.',
		DIRECT_LINE_INVALID: 'Target line must be a positive 1-based integer.',
		DIRECT_MUTATION_INPUT_CONFLICT: 'Do not combine direct human arguments with --input.',
		DIRECT_PINNED_ASSIGNMENT_UNAVAILABLE: 'Pin and unpin commands do not accept field assignments.',
		DIRECT_REMINDER_ASSIGNMENT_REQUIRED: 'Provide exactly one reminderDatetimes or reminderRules assignment.',
		DIRECT_REMINDER_CURRENT_CONFLICT: 'Use --current only when replacing a reminder.',
		DIRECT_REMINDER_CURRENT_REQUIRED: 'Reminder replacement requires --current with the existing canonical value.',
		DIRECT_REMINDER_INVALID_KEY: 'Use only reminderDatetimes or reminderRules.',
		DIRECT_REMINDER_INVALID_OPERON_ID: 'The reminder target requires one canonical seven-character Operon ID.',
		DIRECT_REMINDER_INVALID_VALUE: 'The reminder value is not canonical or valid.',
		DIRECT_REMINDER_ITEM_AMBIGUOUS: 'More than one reminder matches that canonical value.',
		DIRECT_REMINDER_ITEM_NOT_FOUND: 'No reminder matches that canonical value.',
		DIRECT_REMINDER_ITEMS_INCOMPLETE: 'The task reminder hydration is incomplete.',
		DIRECT_REMINDER_MULTI_ITEM_UNAVAILABLE: 'Direct reminder commands change exactly one reminder item.',
		DIRECT_TIMER_SESSION_ASSIGNMENT_UNAVAILABLE: 'Timer session commands accept named flags, not positional assignments.',
		DIRECT_TIMER_SESSION_DATETIME_INVALID: 'Use a valid local-naive datetime such as 2026-07-27T09:00.',
		DIRECT_TIMER_SESSION_NUMBER_CONFLICT: 'Session number is not valid when adding a session.',
		DIRECT_TIMER_SESSION_NUMBER_INVALID: 'Session number must be a positive 1-based integer.',
		DIRECT_TIMER_SESSION_RANGE_CONFLICT: 'Session removal does not accept start or end.',
		DIRECT_TIMER_SESSION_RANGE_INVALID: 'Session end must be later than session start.',
		DIRECT_TIMER_SESSION_RANGE_REQUIRED: 'Session add and update require both start and end.',
		DIRECT_TIMER_SESSION_TARGET_INCOMPLETE: 'The exact timer session task could not be live-verified completely.',
		DIRECT_SELECTOR_REQUIRED: 'Choose exactly one task target with --id or --description.',
		DIRECT_PLACEMENT_UNAVAILABLE: 'The exact live blank-line placement is unavailable, truncated, warned, or stale.',
		DIRECT_SOURCE_TRANSITION_ASSIGNMENT_UNAVAILABLE: 'Direct source transitions accept named flags, not positional assignments.',
		DIRECT_SOURCE_TRANSITION_CATALOG_UNAVAILABLE: 'The live Catalog does not advertise the exact source-transition recovery contract.',
		DIRECT_SOURCE_TRANSITION_TARGET_INCOMPLETE: 'The exact source-transition task could not be live-verified completely.',
		DIRECT_TARGET_FILE_INVALID: 'Provide a safe NFC vault-relative Markdown path ending in .md.',
		DIRECT_TEMPLATE_INVALID: 'Provide one exact case-sensitive NFC-visible template name.',
		DIRECT_TEMPLATE_UNAVAILABLE: 'The exact live File Task template name is missing or ambiguous.',
		DIRECT_TARGET_INCOMPLETE: 'The exact task could not be live-verified completely.',
		AMBIGUOUS_LIFECYCLE_TARGET: 'The current pipeline has more than one matching lifecycle status.',
		CURRENT_PIPELINE_UNAVAILABLE: 'The task current pipeline cannot be resolved exactly.',
		CURRENT_STATUS_UNAVAILABLE: 'The task current status cannot be resolved exactly.',
		LIFECYCLE_ACTION_UNAVAILABLE: 'The live Catalog does not advertise this lifecycle action.',
		LIFECYCLE_TARGET_UNAVAILABLE: 'The current pipeline has no resolved status for this lifecycle action.',
		CREATE_CAPABILITY_UNAVAILABLE: 'The live Runtime does not advertise atomic temporal create.',
		COMPLETION_SHELL_REQUIRED: 'Choose exactly one supported shell: zsh, bash, or fish.',
		DUPLICATE_KEY: 'Each canonical key may appear once.',
		DUPLICATE_CLEAR: 'Each canonical key may be cleared once.',
		DUPLICATE_LIST_ELEMENT: 'List elements must be unique.',
		DESCRIPTION_CLEAR_UNAVAILABLE: 'Task description can be replaced but cannot be cleared.',
		DESCRIPTION_RESOLUTION_INCOMPLETE: 'Exact description resolution could not inspect a complete live result set.',
		DESCRIPTION_TARGET_AMBIGUOUS: 'More than one task has that exact description; use --id.',
		DESCRIPTION_TARGET_NOT_FOUND: 'No task has that exact description.',
		EMPTY_LIST_ELEMENT: 'List elements cannot be empty.',
		FIELD_NOT_WRITABLE: 'The field is not writable through this command.',
		FIELD_OWNED_BY_OTHER_COMMAND: 'The field is owned by a dedicated Operon command.',
		GUIDED_CAPABILITY_UNAVAILABLE: 'The capabilities required by this guided operation are not available.',
		GUIDED_CATALOG_UNAVAILABLE: 'The live Operon Property Catalog is unavailable.',
		GUIDED_CONTEXT_UNAVAILABLE: 'The live creation Context is unavailable or incomplete.',
			GUIDED_HYDRATION_TRUNCATED: 'The live task hydration was truncated; refine the task data before using this guided mutation.',
			GUIDED_INLINE_TASK_REQUIRED: 'This guided operation requires one exact inline Operon task.',
			GUIDED_INPUT_CONFLICT: 'A positional task description cannot be combined with --input.',
			GUIDED_PREVIEW_ONLY_CONFLICT: '--preview-only is available only in guided TTY mode and cannot be combined with --input or --json.',
			GUIDED_PLACEMENT_UNAVAILABLE: 'Live Operon placement candidates are unavailable or incomplete.',
		GUIDED_PIPELINE_UNAVAILABLE: 'No resolved Operon pipeline is available for guided creation.',
			GUIDED_PRIORITY_UNAVAILABLE: 'No resolved Operon priority choice is available for guided creation.',
			GUIDED_REPRESENTATION_UNAVAILABLE: 'The task representation cannot be resolved safely for guided conversion.',
		GUIDED_REMINDER_ANCHOR_UNAVAILABLE: 'This task has no populated field that can anchor a Relative Reminder.',
		GUIDED_REMINDER_COLLECTION_UNAVAILABLE: 'No mapped Operon reminder collection is available.',
		GUIDED_REMINDER_ITEMS_UNAVAILABLE: 'The task reminder items could not be hydrated completely.',
		GUIDED_STATUS_UNAVAILABLE: 'The task current status or available target statuses cannot be resolved safely.',
			GUIDED_TEMPLATE_UNAVAILABLE: 'No deterministic File Task template is available for the selected pipeline.',
			GUIDED_TARGET_REQUIRED: 'Provide an exact vault-relative target path.',
		GUIDED_TIMER_TRANSITION_IN_PROGRESS: 'A timer transition is already in progress; retry after the live timer state settles.',
		GUIDED_TTY_REQUIRED: 'Guided task creation requires an interactive terminal; use --input for non-interactive calls.',
		GUIDED_MAINTENANCE_TTY_REQUIRED: 'Guided task maintenance requires an interactive terminal; use --input for non-interactive calls.',
		GUIDED_WRITABLE_FIELDS_UNAVAILABLE: 'No live writable field is available for this task.',
		GUIDED_WRITABLE_FIELDS_INCOMPLETE: 'The task writable-field hydration is incomplete, so guided update cannot continue safely.',
		FINDER_INPUT_UNSUPPORTED: 'Task Finder is interactive; scripts and agents should use query, entity resolve, or task get with typed input.',
		FINDER_JSON_UNSUPPORTED: 'Task Finder does not support JSON mode; use the typed query and task get commands instead.',
		FINDER_TTY_REQUIRED: 'Task Finder requires an interactive terminal; use the typed query command in non-interactive environments.',
		VAULT_NOT_CONFIGURED: 'No Operon vault profile is configured. Run operon setup.',
		VAULT_PROFILE_REQUIRED: 'Select an Operon vault with --vault or --profile.',
		VAULT_PROFILE_AMBIGUOUS: 'The current directory matches more than one Operon vault profile.',
		VAULT_NAME_AMBIGUOUS: 'Two configured vaults share the same folder name, which the official Obsidian CLI cannot target unambiguously. Rename one vault folder before setup.',
		VAULT_PROFILE_MOVED: 'The configured vault path identity changed; run operon setup again.',
		PROFILE_NOT_FOUND: 'The requested Operon vault profile does not exist.',
		PLAN_EXPIRED: 'The sealed mutation plan expired; create a new preview.',
			PLAN_CONFIRMATION_REQUIRED: 'This plan requires its derived confirmation token through --confirm.',
			PLAN_ABANDON_CONFIRMATION_REQUIRED: 'Type ABANDON explicitly to remove an uncertain recovery record.',
			PLAN_RECOVERY_ACTION_INVALID: 'Choose recover, abandon, or cancel.',
			PLAN_RECOVERY_SELECTION_INVALID: 'Select one listed recoverable plan.',
			PLAN_RECOVERY_TTY_REQUIRED: 'Interactive recovery selection requires a terminal; provide a plan reference in non-interactive use.',
		PLAN_VAULT_MISMATCH: 'The sealed plan vault identity no longer matches its canonical vault path.',
		RAW_MUTATION_APPLY_DISABLED: 'Mutation apply requires an owner-only stored plan reference.',
		PLAN_RECOVERY_REQUIRED: 'This plan has an earlier apply attempt and must be handled with plan recover.',
		RECOVERY_STORE_UNAVAILABLE: 'The protected recovery store is full or unavailable; no mutation was dispatched.',
		RECOVERY_REQUEST_REQUIRED: 'This plan has no prior apply attempt to recover.',
		OPERON_PLUGIN_NOT_FOUND: 'The selected vault does not contain the Operon plugin.',
		SCHEMA_NOT_FOUND: 'The requested Operon CLI schema is not installed.',
		SCHEMA_ID_REQUIRED: 'Specify exactly one Operon CLI schema ID.',
		PROFILE_NAME_REQUIRED: 'Specify exactly one Operon vault profile alias.',
		PLAN_REF_REQUIRED: 'Specify exactly one stored Operon plan reference.',
		SETUP_ARGUMENTS_REQUIRED: 'Setup requires both --vault and --name.',
		INPUT_REQUIRED: 'This command requires typed JSON through --input <file|->.',
		INPUT_FORMAT_REQUIRES_INPUT: 'Use --input with --input-format.',
		INPUT_FORMAT_UNSUPPORTED: 'Use input format json or compact.',
		INPUT_NOT_JSON: 'The supplied input is not valid JSON.',
		INPUT_TOO_LARGE: 'The supplied input exceeds the V1 byte limit.',
		INVALID_FIELD_VALUE: 'The value does not match its live field type.',
		INVALID_OPERON_ID: 'The target requires one canonical seven-character Operon ID.',
		INVALID_CONSISTENCY: 'Consistency must be live-verified or best-effort.',
		INVALID_INTEGER: 'This command option requires a valid integer.',
		INVALID_PARENT_TASK: 'parentTask requires an exact seven-character Operon ID.',
		INVALID_PRIORITY: 'priority must exactly match one live value.',
		INVALID_STATUS: 'status must exactly match one live Pipeline.Status.',
		POSITIONAL_ARGUMENT_REQUIRED: 'A required positional argument is missing.',
		INVALID_FLAG_VALUE: 'A command option is missing its value.',
		MISSING_VALUE: 'A command option is missing its value.',
		READINESS_TIMEOUT_OUT_OF_RANGE: 'The readiness timeout must be between 1 and 30,000 milliseconds.',
		DUPLICATE_FLAG: 'A command option was provided more than once.',
		EXACT_TARGET_REQUIRED: 'This mutation requires one exact Operon task target.',
		TARGET_NOT_ALLOWED: 'This mutation does not accept a task target.',
		MUTATION_OPERATION_MISMATCH: 'The typed mutation operation does not match this command.',
		INTENT_MALFORMED: 'The mutation intent is malformed.',
		INTENT_UNKNOWN_FIELD: 'The mutation intent contains an unknown field.',
		REQUIRED_ASSIGNEES_MISSING: 'The creation policy requires an assignee.',
		RECURRING_TEMPORAL_REQUIRES_SCOPE: 'Recurring task temporal fields require the scoped recurrence command.',
		RECURRENCE_CAPABILITY_UNAVAILABLE: 'The live Runtime does not advertise scoped recurrence preview and apply capabilities.',
		RECURRENCE_GENERAL_UPDATE_CONFLICT: 'Do not mix recurrence-owned fields with general or relationship task fields.',
		RECURRENCE_SCOPE_INVALID: 'Use recurrence scope this-task or this-and-following.',
		RECURRENCE_TARGET_INCOMPLETE: 'The exact recurrence source task could not be live-verified completely.',
		RELATIONSHIP_CAPABILITY_UNAVAILABLE: 'The live Runtime does not advertise relationship replacement.',
		RELATIONSHIP_GENERAL_UPDATE_CONFLICT: 'Do not mix parentTask, blocking, or blockedBy changes with general task fields.',
		RELATIONSHIP_INVERSE_CONFLICT: 'The same task cannot appear in both blocking and blockedBy.',
		RELATIONSHIP_SELF_REFERENCE: 'A task cannot reference itself as a parent, blocker, or blocked task.',
		RELATIONSHIP_TARGET_INCOMPLETE: 'The exact relationship source task could not be live-verified completely.',
		RELATIONSHIP_TARGET_INVALID: 'Relationship values must contain only canonical seven-character Operon IDs.',
		SET_CLEAR_CONFLICT: 'A canonical key cannot be set and cleared in the same update.',
		UNKNOWN_CANONICAL_KEY: 'The field is not an exact live canonical key.',
		UNKNOWN_FLAG: 'This command option is not supported.',
		UNKNOWN_ARGUMENT: 'This command argument is not supported.',
		TASK_GET_REQUIRES_EXACTLY_ONE_SELECTOR_INPUT: 'Task get requires exactly one of --id or --input.',
		UPDATE_CHANGES_REQUIRED: 'Direct task update requires at least one assignment or --clear field.',
		VAULT_NOT_DIRECTORY: 'The selected vault path is not a directory.',
		VAULT_PATH_UNAVAILABLE: 'The selected vault path is unavailable.',
		VAULT_REQUIRED: 'Select an Operon vault with --vault or --profile.',
		CLIENT_IDENTITY_MISSING: 'The initialized Operon CLI client identity is missing; recovery is required.',
		PLATFORM_UNSUPPORTED: 'Live Operon transport is not supported on this platform.',
		WRITABLE_FIELDS_INCOMPLETE: 'The live writable-field hydration is incomplete, so direct update cannot continue safely.',
	};
	return reasons[code] ?? 'The Operon CLI request is invalid.';
}

function renderPublicRuntimeHuman(
	envelope: CliResultEnvelopeV1,
	options: { suppressMutationRecovery?: boolean } = {},
): string {
	return renderHumanWithOptionsV1(envelope, options);
}

async function promptForSemanticConfirmation(
	plan: SealedMutationPlanV1,
	word: string,
	planRef: string,
	port?: InteractiveTerminalPortV1,
	showSummary = true,
): Promise<boolean> {
	const summary = showSummary
		? renderLocalHumanV1('plan.show', {
			planRef,
			expiresAt: plan.expiresAt,
			plan,
		}, 'Operon mutation plan')
		: undefined;
	const prompt = `Type ${word} to confirm this exact reviewed plan: `;
	if (port) {
		if (summary) port.write(`${summary}\n\n`);
		const answer = await port.ask(prompt);
		return answer?.trim() === word;
	}
	const input = createInterface({ input: process.stdin, output: process.stdout });
	try {
		if (summary) process.stdout.write(`${summary}\n\n`);
		const answer = await new Promise<string>(resolve => input.question(prompt, resolve));
		return answer.trim() === word;
	} finally {
		input.close();
	}
}

function semanticConfirmationWord(plan: SealedMutationPlanV1): 'MOVE' | 'CONVERT' | 'DELETE' | 'REMOVE' | null {
	if (plan.mutationKind === 'task.delete') return 'DELETE';
	if (
		plan.mutationKind === 'timer.session'
		&& plan.spec.operation === 'remove-session'
	) return 'REMOVE';
	if (
		plan.mutationKind === 'task.convert'
		&& (
			(
				plan.spec.operation === 'convert'
				&& plan.spec.from === 'file'
			)
			|| plan.riskLevel === 'destructive'
			|| plan.requiresConfirmation
			|| plan.requiredAcknowledgements.length > 0
		)
	) return 'CONVERT';
	if (
		plan.mutationKind === 'task.inline-relocate'
		&& (
			plan.riskLevel === 'destructive'
			|| plan.requiresConfirmation
			|| plan.requiredAcknowledgements.length > 0
		)
	) return 'MOVE';
	return null;
}

function assertStoredPlanVaultIdentity(record: {
	vaultPath: string;
	vaultSha256: string;
}): void {
	try {
		const current = canonicalVaultIdentityV1(record.vaultPath);
		if (current.canonicalPath !== record.vaultPath || current.sha256 !== record.vaultSha256) {
			throw new Error('PLAN_VAULT_MISMATCH');
		}
	} catch (error) {
		if (error instanceof Error && error.message === 'PLAN_VAULT_MISMATCH') throw error;
		throw new Error('PLAN_VAULT_MISMATCH');
	}
}

function requireRecoveryRequest(
	request: MutationApplyRequestV1 | undefined,
): MutationApplyRequestV1 {
	if (!request) throw new Error('RECOVERY_REQUEST_REQUIRED');
	return request;
}

function isMutationPreviewSuccess(value: unknown): value is Extract<MutationPreviewResultV1, { ok: true }> {
	return isPlainRecord(value)
		&& value.kind === 'mutation-preview-result'
		&& value.ok === true
		&& isPlainRecord(value.plan);
}

function isMutationResult(value: unknown): value is MutationResultV1 {
	return isPlainRecord(value) && value.kind === 'mutation-result' && typeof value.status === 'string';
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}
