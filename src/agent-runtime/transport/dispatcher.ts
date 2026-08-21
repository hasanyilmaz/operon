import {
	resolveCliInvocationCapabilityV1,
	type CliCommandV1,
	type CliFailureStageV1,
	type CliInvocationV1,
	type CliResultEnvelopeV1,
	type CliRuntimeMetadataV1,
	type CliRuntimeResultV1,
} from '../contracts/v1/cli';
import type {
	ContextRequestV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	TaskGetRequestV1,
	TaskQueryRequestV1,
	TaskFinderRequestV1,
} from '../contracts/v1/context';
import type {
	TaskFilterQueryResultV1,
	TaskWorkflowApplyRequestV1,
	TaskWorkflowCliInvocationV1,
	TaskWorkflowCliResultEnvelopeV1,
	TaskWorkflowMutationResultV1,
	TaskWorkflowPreviewRequestV1,
	TaskWorkflowPreviewResultV1,
} from '../extensions/task-workflows-v1';
import {
	CONTRACT_LIMITS_V1,
	CONTRACT_VERSION_V1,
	negotiateCompatibilityV1,
	structuredErrorV1,
	type CompatibilitySelectionV1,
	type ContractWarningV1,
	type StructuredErrorCodeV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import type { CatalogRequestV1 } from '../contracts/v1/catalog';
import type { RuntimeHealthV1 } from '../contracts/v1/lifecycle';
import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
} from '../contracts/v1/mutation';
import type { OperonAgentRuntimeCoreV1 } from '../runtime/types';
import {
	emitRuntimeTimingSpanV1,
	runtimeTimingNowV1,
	type RuntimeTimingFlowV1,
	type RuntimeTimingSinkV1,
} from '../runtime/timing-probe';
import type { TimerReadRequestV1 } from '../contracts/v1/timer';
import {
	computeRunningVaultSha256V1,
	readAndConsumeAgentRuntimeRequestFileV1,
} from './secure-request-file';
import {
	AgentRuntimeTransportErrorV1,
	type AgentRuntimeDesktopNodeApiV1,
} from './types';
import {
	resolveTaskWorkflowApplyCapabilityV1,
	resolveTaskWorkflowPreviewCapabilityV1,
} from '../extensions/task-workflows-v1/routing';
import { validateCliInvocationForTransportV1 } from './invocation-validator';
import {
	consumeWindowsBrokerInvocationV1,
	markWindowsBrokerDispatchStartedV1,
	type WindowsBrokerScopeV1,
} from './windows-broker-state';

export interface AgentRuntimeCliDispatcherPortsV1 {
	readonly runtime: OperonAgentRuntimeCoreV1;
	readonly nodeApi: AgentRuntimeDesktopNodeApiV1;
	readonly vaultAdapter: unknown;
	readonly runtimeMetadata: CliRuntimeMetadataV1;
	readonly timingSink?: RuntimeTimingSinkV1;
	monotonicNow(): number;
}

export interface AgentRuntimeCliDispatchInputV1 {
	readonly expectedCommand: CliCommandV1 | 'tasks.filter-query';
	readonly expectedRequestId?: string;
	readonly requestToken?: string;
	readonly nodeApiLoadDurationMs?: number;
	readonly transportKind?: 'request-file' | 'windows-named-pipe';
	readonly brokerScope?: WindowsBrokerScopeV1;
}

interface DispatchStateV1 {
	requestId: string;
	inputBytes: number;
	expectedMatch: boolean | null;
	compatibility?: CompatibilitySelectionV1;
}

declare const OPERON_AGENT_RUNTIME_PROBE_ENABLED: boolean;

export async function dispatchAgentRuntimeCliV1(
	ports: AgentRuntimeCliDispatcherPortsV1,
	input: AgentRuntimeCliDispatchInputV1,
): Promise<string> {
	const startedAt = ports.monotonicNow();
	const state: DispatchStateV1 = {
		requestId: 'invalid-request',
		inputBytes: 0,
		expectedMatch: null,
	};
	try {
		const runningVaultStartedAt = runtimeTimingNowV1(() => ports.monotonicNow());
		const runningVaultSha256 = await computeRunningVaultSha256V1(
			ports.nodeApi,
			ports.vaultAdapter,
		);
		const runningVaultDurationMs = Math.max(
			0,
			runtimeTimingNowV1(() => ports.monotonicNow()) - runningVaultStartedAt,
		);
		const consumeStartedAt = runtimeTimingNowV1(() => ports.monotonicNow());
		const brokerRequired = input.transportKind === 'windows-named-pipe';
		const brokerConsumed = brokerRequired && input.requestToken
			? consumeWindowsBrokerInvocationV1(
				input.requestToken,
				input.brokerScope ?? runningVaultSha256,
			)
			: null;
		if (brokerRequired && !brokerConsumed) {
			throw new AgentRuntimeTransportErrorV1(
				'transport-unavailable',
				'windows-broker-token-unavailable',
			);
		}
		const consumed = brokerConsumed ?? await readAndConsumeAgentRuntimeRequestFileV1(
			ports.nodeApi,
			input.requestToken,
		);
		const consumeDurationMs = Math.max(
			0,
			runtimeTimingNowV1(() => ports.monotonicNow()) - consumeStartedAt,
		);
		state.inputBytes = consumed.inputBytes;
		const invocationValue = parseInvocationJson(consumed.raw);
		const decoded = validateCliInvocationForTransportV1(invocationValue);
		if (!decoded.ok) {
			throw new AgentRuntimeTransportErrorV1(
				'invalid-request',
				'cli-invocation-contract-invalid',
			);
		}
		const invocation = decoded.value;
		state.requestId = invocation.requestId;
		const timingFlow = timingFlowForInvocationV1(invocation);
		if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
			emitRuntimeTimingSpanV1(ports.timingSink, {
				requestId: invocation.requestId,
				flow: timingFlow,
				span: 'node-api-load',
				durationMs: input.nodeApiLoadDurationMs ?? 0,
			});
			emitRuntimeTimingSpanV1(ports.timingSink, {
				requestId: invocation.requestId,
				flow: timingFlow,
				span: 'secure-request-consume',
				durationMs: consumeDurationMs,
			});
		}
		if (invocation.command !== input.expectedCommand) {
			throw new AgentRuntimeTransportErrorV1(
				'invalid-request',
				'handler-command-mismatch',
			);
		}
		if (
			input.expectedRequestId !== undefined
			&& invocation.requestId !== input.expectedRequestId
		) {
			throw new AgentRuntimeTransportErrorV1(
				'invalid-request',
				'frame-request-id-mismatch',
			);
		}

		if (OPERON_AGENT_RUNTIME_PROBE_ENABLED) {
			emitRuntimeTimingSpanV1(ports.timingSink, {
				requestId: invocation.requestId,
				flow: timingFlow,
				span: 'running-vault-identity',
				durationMs: runningVaultDurationMs,
			});
		}
		state.expectedMatch = runningVaultSha256 === invocation.expectedVaultSha256;
		if (!state.expectedMatch) {
			throw new AgentRuntimeTransportErrorV1(
				'vault-mismatch',
				'canonical-realpath-hash-mismatch',
			);
		}

		let health = await ports.runtime.system.health();
		state.compatibility = negotiateCompatibilityV1(
			invocation.compatibility,
			health.compatibility,
		);
		if (!state.compatibility.compatible) {
			return serializeBoundedEnvelopeV1(
				ports,
				failureEnvelope(
					input.expectedCommand,
					state,
					ports,
					startedAt,
					'compatibility',
					state.compatibility.error ?? structuredError(
						'incompatible-version',
						'No mutually supported Runtime API version.',
						false,
					),
				),
			);
		}

		if (invocation.command === 'health') {
			return serializeBoundedEnvelopeV1(
				ports,
				successEnvelope(invocation, health, state, ports, startedAt),
			);
		}
			if (invocation.command === 'capabilities') {
				const result = ports.runtime.system.capabilities();
				return serializeBoundedEnvelopeV1(
					ports,
					successEnvelope(invocation, result, state, ports, startedAt),
				);
			}
			if (invocation.command === 'diagnostics') {
				const diagnosticsCapability = health.capabilities.find(
					candidate => candidate.id === 'system.diagnostics',
				);
				if (
					!ports.runtime.hasCapability('system.diagnostics')
					|| (
						diagnosticsCapability?.availability !== 'available'
						&& diagnosticsCapability?.availability !== 'degraded'
					)
				) {
					return serializeBoundedEnvelopeV1(
						ports,
						failureEnvelope(
							invocation.command,
							state,
							ports,
							startedAt,
							'capability',
							structuredError(
								'capability-unavailable',
								'Operon Runtime diagnostics are unavailable.',
								false,
							),
						),
					);
				}
				const result = await ports.runtime.system.diagnostics();
				return serializeBoundedEnvelopeV1(
					ports,
					successEnvelope(invocation, result, state, ports, startedAt),
				);
			}

		health = invocation.command === 'mutation.preview' || invocation.command === 'mutation.apply'
			? await awaitMutationAdmissionV1(
				ports,
				health,
				startedAt + invocation.readinessTimeoutMs,
				invocation.command === 'mutation.apply',
			)
			: await awaitReadAdmissionV1(
				ports,
				invocation,
				health,
				startedAt + invocation.readinessTimeoutMs,
			);
		const capability = resolveInvocationCapabilityV1(invocation);
		const advertisement = health.capabilities.find(candidate => candidate.id === capability);
		if (
			!ports.runtime.hasCapability(capability)
			|| (advertisement?.availability !== 'available' && advertisement?.availability !== 'degraded')
		) {
			return serializeBoundedEnvelopeV1(
				ports,
				failureEnvelope(
					invocation.command,
					state,
					ports,
					startedAt,
					'capability',
					structuredError(
						'capability-unavailable',
						'The requested Runtime capability is not published.',
						false,
					),
				),
			);
		}

		if (brokerConsumed && invocation.command === 'mutation.apply' && input.requestToken) {
			markWindowsBrokerDispatchStartedV1(input.requestToken, brokerConsumed.scope);
		}
		const result = await invokeRuntimeReadV1(
			ports.runtime,
			invocation,
			Date.now() + Math.max(
				0,
				startedAt + invocation.readinessTimeoutMs - ports.monotonicNow(),
			),
		);
		const operationError = readRuntimeOperationError(result);
		if (operationError) {
			return serializeBoundedEnvelopeV1(
				ports,
				failureEnvelope(
					invocation.command,
					state,
					ports,
					startedAt,
					'runtime',
					operationError,
					readWarnings(result),
				),
			);
		}
		return serializeBoundedEnvelopeV1(
			ports,
			successEnvelope(invocation, result, state, ports, startedAt),
		);
	} catch (error) {
		const normalized = normalizeTransportError(error);
		const structured = normalized instanceof CliDispatchFailureV1
			? normalized.structured
			: structuredError(
				normalized.code,
				normalized.reason,
				isRetryableTransportError(normalized),
			);
		return serializeBoundedEnvelopeV1(
			ports,
			failureEnvelope(
				input.expectedCommand,
				state,
				ports,
				startedAt,
				failureStageForError(normalized),
				structured,
			),
		);
	}
}

type RuntimeCliInvocationV1 = CliInvocationV1 | TaskWorkflowCliInvocationV1;
type RuntimeCliResultV1 = CliRuntimeResultV1 | TaskFilterQueryResultV1 | TaskWorkflowPreviewResultV1 | TaskWorkflowMutationResultV1;

function timingFlowForInvocationV1(invocation: RuntimeCliInvocationV1): RuntimeTimingFlowV1 {
	if (invocation.command === 'mutation.preview') return 'mutation-preview';
	if (invocation.command === 'mutation.apply') return 'mutation-apply';
	return 'read';
}

function resolveInvocationCapabilityV1(invocation: RuntimeCliInvocationV1): string {
	let capability: string | undefined;
	if (invocation.command === 'tasks.filter-query') capability = 'tasks.filter-query';
	else if (invocation.command === 'mutation.preview') {
		capability = resolveTaskWorkflowPreviewCapabilityV1(invocation.request);
	}
	else if (invocation.command === 'mutation.apply') {
		capability = resolveTaskWorkflowApplyCapabilityV1(invocation.request);
	}
	else capability = resolveCliInvocationCapabilityV1(invocation);
	if (!capability && invocation.command !== 'tasks.filter-query') {
		capability = resolveCliInvocationCapabilityV1(invocation as CliInvocationV1);
	}
	if (!capability) {
		throw new CliDispatchFailureV1(
			'capability',
			structuredError(
				'capability-unavailable',
				'The CLI invocation does not resolve to a Runtime capability.',
				false,
			),
		);
	}
	return capability;
}

async function awaitReadAdmissionV1(
	ports: AgentRuntimeCliDispatcherPortsV1,
	invocation: RuntimeCliInvocationV1,
	initialHealth: RuntimeHealthV1,
	deadline: number,
): Promise<RuntimeHealthV1> {
	let health = initialHealth;
	const consistency = readInvocationConsistency(invocation);
	if (consistency === 'offline-unverified') {
		throw new CliDispatchFailureV1(
			'readiness',
			structuredError(
				'invalid-request',
				'The live CLI transport does not support offline consistency.',
				false,
			),
		);
	}
	if (consistency === 'best-effort') {
		if (health.lifecyclePhase === 'unloading' || !health.admission.reads) {
			throw new CliDispatchFailureV1(
				'readiness',
				structuredError(
					'transport-unavailable',
					'Runtime read admission is currently closed.',
					true,
				),
			);
		}
		return health;
	}

	while (true) {
		if (health.lifecyclePhase === 'unloading') {
			throw new CliDispatchFailureV1(
				'readiness',
				structuredError(
					'transport-unavailable',
					'Operon is unloading and no longer accepts Runtime reads.',
					false,
				),
			);
		}
		if (!health.ok && health.error && !health.error.retryable) {
			throw new CliDispatchFailureV1('readiness', health.error);
		}
		const remaining = deadline - ports.monotonicNow();
		if (remaining <= 0) {
			throw new CliDispatchFailureV1(
				'readiness',
				structuredError(
					'live-settling',
					'Operon did not reach live-verified readiness before the request deadline.',
					true,
				),
			);
		}
		if (health.ok && health.lifecyclePhase === 'ready' && health.admission.reads) return health;
		const retryAfterMs = Math.max(10, Math.min(health.retryAfterMs ?? 250, 1_000, remaining));
		await ports.nodeApi.delay(retryAfterMs);
		health = await ports.runtime.system.health();
	}
}

async function awaitMutationAdmissionV1(
	ports: AgentRuntimeCliDispatcherPortsV1,
	initialHealth: RuntimeHealthV1,
	deadline: number,
	requireWriteAdmission: boolean,
): Promise<RuntimeHealthV1> {
	let health = initialHealth;
	while (true) {
		if (health.lifecyclePhase === 'unloading') {
			throw new CliDispatchFailureV1(
				'readiness',
				structuredError('transport-unavailable', 'Operon is unloading.', false),
			);
		}
		if (!health.ok && health.error && !health.error.retryable) {
			throw new CliDispatchFailureV1('readiness', health.error);
		}
		if (
			health.ok
			&& health.lifecyclePhase === 'ready'
			&& health.admission.reads
			&& (!requireWriteAdmission || health.admission.writes)
		) return health;
		const remaining = deadline - ports.monotonicNow();
		if (remaining <= 0) {
			throw new CliDispatchFailureV1(
				'readiness',
				structuredError(
					'live-settling',
					'Operon did not reach mutation readiness before the request deadline.',
					true,
				),
			);
		}
		await ports.nodeApi.delay(Math.max(10, Math.min(health.retryAfterMs ?? 250, 1_000, remaining)));
		health = await ports.runtime.system.health();
	}
}

async function invokeRuntimeReadV1(
	runtime: OperonAgentRuntimeCoreV1,
	invocation: RuntimeCliInvocationV1,
	deadlineAtMs: number,
): Promise<RuntimeCliResultV1> {
	const context = { deadlineAtMs };
	switch (invocation.command) {
		case 'catalog':
			return await runtime.catalog.snapshot(invocation.request as CatalogRequestV1, context);
		case 'entity.resolve':
			return await runtime.entities.resolve(invocation.request as EntityResolveRequestV1, context);
		case 'task.get':
			return await runtime.tasks.get(invocation.request as TaskGetRequestV1, context);
		case 'tasks.query':
			return await runtime.tasks.query(invocation.request as TaskQueryRequestV1, context);
		case 'tasks.filter-query':
			if (!runtime.tasks.filterQuery) throw new Error('task-filter-query-unavailable');
			return await runtime.tasks.filterQuery(invocation.request, context);
		case 'tasks.finder':
			return await runtime.tasks.find(invocation.request as TaskFinderRequestV1, context);
		case 'relationships.get':
			return await runtime.relationships.get(invocation.request as RelationshipRequestV1, context);
		case 'context.build':
			return await runtime.context.build(invocation.request as ContextRequestV1, context);
		case 'timers.read':
			return await runtime.timers.read(invocation.request as TimerReadRequestV1, context);
		case 'mutation.preview':
			if (resolveTaskWorkflowPreviewCapabilityV1(invocation.request)) {
				if (!runtime.mutations.previewTaskWorkflow) throw new Error('task-workflow-preview-unavailable');
				return await runtime.mutations.previewTaskWorkflow(invocation.request as TaskWorkflowPreviewRequestV1, context);
			}
			return await runtime.mutations.preview(invocation.request as MutationPreviewRequestV1, context);
		case 'mutation.apply':
			if (resolveTaskWorkflowApplyCapabilityV1(invocation.request)) {
				if (!runtime.mutations.applyTaskWorkflow) throw new Error('task-workflow-apply-unavailable');
				return await runtime.mutations.applyTaskWorkflow(invocation.request as TaskWorkflowApplyRequestV1);
			}
			return await runtime.mutations.apply(invocation.request as MutationApplyRequestV1);
		case 'health':
			return await runtime.system.health();
		case 'capabilities':
			return runtime.system.capabilities();
		case 'diagnostics':
			return await runtime.system.diagnostics();
	}
}

function successEnvelope(
	invocation: RuntimeCliInvocationV1,
	result: RuntimeCliResultV1,
	state: DispatchStateV1,
	ports: AgentRuntimeCliDispatcherPortsV1,
	startedAt: number,
): CliResultEnvelopeV1 | TaskWorkflowCliResultEnvelopeV1 {
	let warnings = readWarnings(result);
	if (readInvocationConsistency(invocation) === 'best-effort') {
		const bestEffortWarning: ContractWarningV1 = {
			code: 'best-effort-consistency',
			message: 'This result used explicitly requested best-effort consistency and may not be fully settled.',
		};
		warnings = [
			bestEffortWarning,
			...warnings.filter(warning => warning.code !== bestEffortWarning.code),
		].slice(0, CONTRACT_LIMITS_V1.warnings);
	}
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'cli-result',
		requestId: invocation.requestId,
		command: invocation.command,
		ok: true,
		transport: {
			channel: 'request-file',
			inputBytes: state.inputBytes,
		},
		vaultIdentity: { expectedMatch: true },
		compatibility: state.compatibility as CompatibilitySelectionV1 & { compatible: true },
		cliContract: 1,
		runtime: ports.runtimeMetadata,
		timing: { handlerMs: elapsedMilliseconds(ports, startedAt) },
		warnings,
		result,
	} as CliResultEnvelopeV1 | TaskWorkflowCliResultEnvelopeV1;
}

function failureEnvelope(
	command: CliCommandV1 | 'tasks.filter-query',
	state: DispatchStateV1,
	ports: AgentRuntimeCliDispatcherPortsV1,
	startedAt: number,
	stage: CliFailureStageV1,
	error: StructuredErrorV1,
	warnings: ContractWarningV1[] = [],
): CliResultEnvelopeV1 | TaskWorkflowCliResultEnvelopeV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'cli-result',
		requestId: state.requestId,
		command,
		ok: false,
		transport: {
			channel: 'request-file',
			inputBytes: state.inputBytes,
		},
		vaultIdentity: { expectedMatch: state.expectedMatch },
		...(state.compatibility ? { compatibility: state.compatibility } : {}),
		runtime: ports.runtimeMetadata,
		timing: { handlerMs: elapsedMilliseconds(ports, startedAt) },
		warnings,
		failure: { stage, error },
	};
}

function serializeBoundedEnvelopeV1(
	ports: AgentRuntimeCliDispatcherPortsV1,
	envelope: CliResultEnvelopeV1 | TaskWorkflowCliResultEnvelopeV1,
): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(envelope);
	} catch {
		throw new AgentRuntimeTransportErrorV1('internal-error', 'cli-result-not-json-safe');
	}
	if (ports.nodeApi.utf8(serialized).byteLength <= CONTRACT_LIMITS_V1.transportResultBytes) {
		return serialized;
	}
	if (!envelope.ok) {
		throw new AgentRuntimeTransportErrorV1('result-too-large', 'failure-envelope-exceeds-result-limit');
	}
	const failure = {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'cli-result',
		requestId: envelope.requestId,
		command: envelope.command,
		ok: false,
		transport: envelope.transport,
		vaultIdentity: envelope.vaultIdentity,
		compatibility: envelope.compatibility,
		cliContract: envelope.cliContract,
		runtime: envelope.runtime,
		timing: envelope.timing,
		warnings: [],
		failure: {
			stage: 'runtime',
			error: structuredError(
				'result-too-large',
				'The encoded Runtime result exceeds the V1 transport limit.',
				false,
			),
		},
	} as CliResultEnvelopeV1 | TaskWorkflowCliResultEnvelopeV1;
	return JSON.stringify(failure);
}

function parseInvocationJson(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new AgentRuntimeTransportErrorV1('invalid-request', 'request-file-json-invalid');
	}
}

function readInvocationConsistency(
	invocation: RuntimeCliInvocationV1,
): 'live-verified' | 'best-effort' | 'offline-unverified' {
	if (!invocation.request) return 'live-verified';
	return 'consistency' in invocation.request
		? invocation.request.consistency
		: 'live-verified';
}

function readRuntimeOperationError(result: RuntimeCliResultV1): StructuredErrorV1 | null {
	if (Array.isArray(result) || typeof result !== 'object' || result === null) return null;
	// A decoded mutation result is itself the domain outcome. Preserve partial
	// and ambiguous group evidence in the success envelope for the client.
	if ('kind' in result && result.kind === 'mutation-result') return null;
	if (!('ok' in result) || result.ok !== false || !('error' in result)) return null;
	const error = result.error;
	return error && typeof error === 'object' ? error : null;
}

function readWarnings(result: RuntimeCliResultV1): ContractWarningV1[] {
	if (Array.isArray(result) || typeof result !== 'object' || result === null) return [];
	if (!('warnings' in result) || !Array.isArray(result.warnings)) return [];
	return result.warnings.map(warning => ({ ...warning }));
}

function normalizeTransportError(error: unknown): AgentRuntimeTransportErrorV1 | CliDispatchFailureV1 {
	if (error instanceof AgentRuntimeTransportErrorV1 || error instanceof CliDispatchFailureV1) return error;
	return new AgentRuntimeTransportErrorV1('internal-error', 'unexpected-cli-dispatch-error');
}

function failureStageForError(
	error: AgentRuntimeTransportErrorV1 | CliDispatchFailureV1,
): CliFailureStageV1 {
	if (error instanceof CliDispatchFailureV1) return error.stage;
	if (error.code === 'invalid-request' || error.code === 'payload-too-large') return 'client-input';
	if (error.code === 'vault-mismatch') return 'vault';
	if (error.code === 'transport-unavailable') return 'transport';
	if (error.code === 'result-too-large') return 'runtime';
	return 'internal';
}

function isRetryableTransportError(
	error: AgentRuntimeTransportErrorV1 | CliDispatchFailureV1,
): boolean {
	return error.code === 'transport-unavailable';
}

function structuredError(
	code: StructuredErrorCodeV1,
	reason: string,
	retryable: boolean,
): StructuredErrorV1 {
	return structuredErrorV1(code, reason, { retryable });
}

function elapsedMilliseconds(ports: AgentRuntimeCliDispatcherPortsV1, startedAt: number): number {
	return Math.max(0, Math.round((ports.monotonicNow() - startedAt) * 1_000) / 1_000);
}

class CliDispatchFailureV1 extends Error {
	readonly code: StructuredErrorCodeV1;
	readonly reason: string;

	constructor(
		readonly stage: CliFailureStageV1,
		readonly structured: StructuredErrorV1,
	) {
		super(structured.reason);
		this.name = 'CliDispatchFailureV1';
		this.code = structured.code;
		this.reason = structured.reason;
	}
}
