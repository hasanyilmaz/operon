import {
	CAPABILITY_REGISTRY_V1,
	isCapabilityIdV1,
	MUTATION_CAPABILITY_MAP_V1,
	type CapabilityAdvertisementV1,
	type CapabilityIdV1,
} from '../contracts/v1/capabilities';
import type { CatalogRequestV1, OperonCatalogV1 } from '../contracts/v1/catalog';
import type {
	MutationResultV1,
	SealedMutationPlanV1,
} from '../contracts/v1/mutation';
import type {
	ContextPackV1,
	ContextRequestV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
	TaskGetRequestV1,
	TaskGetResultV1,
	TaskQueryRequestV1,
	TaskQueryResultV1,
} from '../contracts/v1/context';
import type {
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
} from '../extensions/task-workflows-v1';
import type {
	RuntimeDiagnosticsV1,
	RuntimeHealthV1,
	RuntimeLifecyclePhaseV1,
} from '../contracts/v1/lifecycle';
import {
	CONTRACT_LIMITS_V1,
	CONTRACT_VERSION_V1,
	structuredErrorV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import type { TimerReadRequestV1, TimerReadResultV1 } from '../contracts/v1/timer';
import type {
	DeveloperApiChannelStatusV1,
	DeveloperMutationApplyInputV1,
	DeveloperMutationExecutionResultV1,
	DeveloperMutationPendingRecoveriesResultV1,
	DeveloperMutationPlanHandleV1,
	DeveloperMutationPreviewInputV1,
	DeveloperMutationPreviewResultV1,
	DeveloperMutationRecoveryErrorV1,
	DeveloperMutationRecoverInputV1,
	OperonDeveloperApiAccessRequestV1,
	OperonDeveloperApiAccessResultV1,
	OperonDeveloperApiConsumerPluginV1,
	OperonDeveloperApiV1,
} from '../public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../runtime/types';
import {
	DEVELOPER_RECOVERY_RETENTION_MS_V1,
	DeveloperMutationRecoveryStoreErrorV1,
	IndexedDbDeveloperMutationRecoveryStoreV1,
	type DeveloperMutationRecoveryRecordV1,
	type DeveloperMutationRecoveryStoreV1,
} from './recovery-store';
import type { DeveloperApiGrantControllerV1 } from './grant-controller';
import type {
	DeveloperApiConsumerDescriptorV1,
	DeveloperApiGrantEvaluationV1,
} from './grants';
import type {
	DeveloperCapabilityGrantV1,
	DeveloperMutationSealedPlanV1,
	DeveloperPlanSecurityBindingV1,
	DeveloperSecurityDenialV1,
	DeveloperSecuritySessionV1,
} from './security';
import type { DeveloperMutationSecurityPolicyV1 } from './security';

const RUNTIME_API_VERSION_V1 = 1 as const;
const ACCESS_REQUEST_KEYS_V1 = [
	'contractVersion',
	'requestedCapabilities',
	'runtimeApi',
] as const;
const RUNTIME_RANGE_KEYS_V1 = ['max', 'min'] as const;
const PREVIEW_INPUT_KEYS_V1 = ['capability', 'mutationKind', 'spec', 'target'] as const;
const PLAN_INPUT_KEYS_V1 = ['plan'] as const;
const RECOVERY_INPUT_KEYS_V1 = ['plan', 'recoveryRef'] as const;
const BASELINE_DISCOVERY_CAPABILITIES_V1 = new Set<CapabilityIdV1>([
	'system.health',
	'system.capabilities',
]);
const READ_CAPABILITIES_V1 = new Set<CapabilityIdV1>(
	CAPABILITY_REGISTRY_V1
		.filter(definition => definition.mode === 'read')
		.map(definition => definition.id),
);

type SnapshotResultV1<T> =
	| { ok: true; value: T }
	| { ok: false; error: StructuredErrorV1 };

type DeveloperPlanExecutionStateV1 =
	| 'idle'
	| 'applying'
	| 'recovery-required'
	| 'terminal';

export interface OperonDeveloperApiRuntimeOptionsV1 {
	readonly isDesktopAvailable: () => boolean;
	readonly isHostVersionSupported: () => boolean;
	readonly lifecyclePhase: () => RuntimeLifecyclePhaseV1;
	readonly retryAfterMs: () => number | undefined;
	readonly lifecycleError: () => StructuredErrorV1 | undefined;
	readonly isCoreActive: (core: OperonAgentRuntimeCoreV1) => boolean;
	readonly grantController: Pick<
		DeveloperApiGrantControllerV1,
		| 'verifyConsumer'
		| 'isConsumerCurrent'
		| 'observeConsumerVersion'
		| 'evaluate'
		| 'recordPending'
		| 'hasPersistenceError'
	>;
	readonly mutationSecurityPolicy?: DeveloperMutationSecurityPolicyV1;
	readonly recoveryStore?: DeveloperMutationRecoveryStoreV1;
	readonly createSessionId?: () => string;
	readonly now?: () => Date;
}

/**
 * Creates one immutable, capability-bounded in-process session over the
 * existing Runtime V1 facade. It never creates or owns a second Runtime.
 */
export function getOperonDeveloperApiV1(
	core: OperonAgentRuntimeCoreV1 | null,
	consumerPlugin: OperonDeveloperApiConsumerPluginV1,
	request: unknown,
	options: OperonDeveloperApiRuntimeOptionsV1,
): OperonDeveloperApiAccessResultV1 {
	const decoded = decodeAccessRequest(request);
	if (!decoded.ok) {
		const status = accessFailureStatus(options, 'accessor-unavailable', decoded.error);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error: decoded.error,
		});
	}
	if (!options.isDesktopAvailable()) {
		const error = structuredErrorV1(
			'unsupported-platform',
			'The in-process Operon Developer API is supported only in Obsidian Desktop.',
		);
		const status = accessFailureStatus(options, 'unsupported-platform', error);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}
	if (!options.isHostVersionSupported()) {
		const error = structuredErrorV1(
			'unsupported-platform',
			'The in-process Operon Developer API requires Obsidian Desktop 1.12.2 or newer.',
			{ details: { reasonCode: 'obsidian-version-unsupported' } },
		);
		const status = accessFailureStatus(options, 'unsupported-platform', error);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}
	const consumer = options.grantController.verifyConsumer(consumerPlugin);
	if (!consumer) {
		const error = structuredErrorV1(
			'authority-insufficient',
			'The Developer API consumer is not the active Obsidian plugin instance registered by the host.',
			{ details: { reasonCode: 'developer-api-consumer-unverified' } },
		);
		const status = accessFailureStatus(options, 'accessor-unavailable', error);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}
	if (decoded.value.runtimeApi.min > 1 || decoded.value.runtimeApi.max < 1) {
		const error = structuredErrorV1(
			'unsupported-version',
			'The requested Runtime API range does not include Runtime API V1.',
		);
		const status = accessFailureStatus(options, 'unsupported-version', error);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}
	if (!core) {
		const error = structuredErrorV1(
			'handler-unavailable',
			'The Operon Runtime facade has not been initialized.',
		);
		const status = accessFailureStatus(options, 'accessor-unavailable', error);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}

	const requested = new Set(decoded.value.requestedCapabilities);
	const grant = evaluateSessionGrant(options, consumer, requested);
	if (grant.state !== 'active') {
		if (grant.state === 'pending') {
			options.grantController.recordPending(
				consumer,
				grantRequiredCapabilities(requested),
			);
		}
		const error = structuredErrorV1(
			'authority-insufficient',
			'The Developer API request is not covered by an active exact-capability grant.',
			{
				details: {
					consumerId: consumer.id,
					grantState: grant.state,
					grantRevision: grant.revision,
					pendingCapabilities: [...grant.pendingCapabilities],
					reasonCode: grant.reason,
				},
			},
		);
		const status = currentChannelStatus(core, options, requested, consumer);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}

	const unavailable = decoded.value.requestedCapabilities.find(capability => {
		const advertisement = core.system.capabilities().find(item => item.id === capability);
		return advertisement?.availability !== 'available' && advertisement?.availability !== 'degraded';
	});
	if (unavailable) {
		const error = structuredErrorV1(
			'capability-unavailable',
			`The requested Developer API capability is unavailable: ${unavailable}.`,
			{ details: { capability: unavailable } },
		);
		const status = currentChannelStatus(core, options, requested, consumer);
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status,
			error,
		});
	}

	const status = currentChannelStatus(core, options, requested, consumer);
	if (status.availability === 'unavailable') {
		const error = status.error ?? structuredErrorV1(
			status.reason === 'booting' || status.reason === 'settling'
				? 'live-settling'
				: 'capability-unavailable',
			`The Developer API is unavailable while Operon is ${status.reason}.`,
			{ retryable: status.reason === 'booting' || status.reason === 'settling' },
		);
		const failedStatus = freezeDto({ ...status, error });
		return freezeApiStructure({
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-api-access-result',
			ok: false,
			status: failedStatus,
			error,
		});
	}

	const api = createDeveloperApiSession(core, options, requested, consumer);
	return freezeApiStructure({
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-api-access-result',
		ok: true,
		status,
		api,
	});
}

function createDeveloperApiSession(
	core: OperonAgentRuntimeCoreV1,
	options: OperonDeveloperApiRuntimeOptionsV1,
	requested: ReadonlySet<CapabilityIdV1>,
	consumer: DeveloperApiConsumerDescriptorV1,
): OperonDeveloperApiV1 {
	const sessionId = options.createSessionId?.() ?? createDeveloperSessionId();
	const securitySession: DeveloperSecuritySessionV1 = Object.freeze({
		consumerId: consumer.id,
		instanceEpoch: consumer.instanceEpoch,
		sessionId,
	});
	interface BoundPlanV1 {
		readonly recoveryRef: string;
		readonly sealed: SealedMutationPlanV1;
		readonly binding: DeveloperPlanSecurityBindingV1;
		readonly idempotencyKey: string;
		readonly dispatch: {
			readonly binding: DeveloperPlanSecurityBindingV1;
			dispatchStarted: boolean;
		};
		state: DeveloperPlanExecutionStateV1;
		authorization?: Parameters<OperonAgentRuntimeCoreV1['mutations']['apply']>[0]['authorization'];
		acknowledgements?: Parameters<OperonAgentRuntimeCoreV1['mutations']['apply']>[0]['acknowledgements'];
		terminalResult?: MutationResultV1;
	}
	const boundPlans = new WeakMap<DeveloperMutationPlanHandleV1, BoundPlanV1>();
	const recoveryStore = options.recoveryStore
		?? new IndexedDbDeveloperMutationRecoveryStoreV1({
			now: () => (options.now?.() ?? new Date()).getTime(),
		});
	let requestSequence = 0;
	const nextRequestId = (): string => {
		requestSequence += 1;
		return `${sessionId}-${requestSequence.toString(36)}`;
	};
	const status = (): DeveloperApiChannelStatusV1 => (
		currentChannelStatus(core, options, requested, consumer)
	);
	const canUse = (capability: CapabilityIdV1 | 'tasks.filter-query'): boolean => (
		(requested as ReadonlySet<string>).has(capability)
		&& (
			(capability !== 'tasks.filter-query' && BASELINE_DISCOVERY_CAPABILITIES_V1.has(capability))
				|| evaluateSessionGrant(options, consumer, requested).effectiveCapabilities.includes(capability)
		)
		&& options.isCoreActive(core)
		&& (
			(capability === 'tasks.filter-query' || READ_CAPABILITIES_V1.has(capability))
				? status().admission.reads
				: status().admission.writes
		)
		&& core.hasCapability(capability)
	);
	const cloneInput = <T>(value: unknown): T => freezeDto(value) as T;
	const cloneOutput = <T>(value: T): T => freezeDto(value);
	const snapshotInput = <T>(value: unknown): SnapshotResultV1<T> => {
		try {
			return { ok: true, value: cloneInput<T>(value) };
		} catch {
			return {
				ok: false,
				error: structuredErrorV1(
					'invalid-request',
					'Developer API input must be a structured-cloneable Runtime V1 DTO.',
				),
			};
		}
	};

	const system = Object.freeze({
		health: async () => {
			const channel = status();
			if (!channel.admission.reads) {
				return cloneOutput(unavailableDeveloperHealth(options, channel));
			}
			const health = await core.system.health();
			return cloneOutput(projectHealth(
				health,
				requested,
				channel.admission.reads,
				channel.admission.writes,
			));
		},
		capabilities: () => status().capabilities,
		diagnostics: async () => {
			if (!canUse('system.diagnostics')) {
				const channel = status();
				const runtimeHealth = channel.admission.reads
					? await core.system.health()
					: unavailableDeveloperHealth(options, channel);
				return cloneOutput(diagnosticsFailure(
					projectHealth(
						runtimeHealth,
						requested,
						channel.admission.reads,
						channel.admission.writes,
					),
					sessionError(core, options, requested, consumer, 'system.diagnostics'),
				));
			}
			const diagnostics = await core.system.diagnostics();
			const channel = status();
			return cloneOutput(projectDiagnostics(
				diagnostics,
				requested,
				channel.admission.reads,
				channel.admission.writes,
			));
		},
	});
	const catalog = Object.freeze({
		snapshot: (request?: CatalogRequestV1) => {
			const decoded = snapshotInput<CatalogRequestV1 | undefined>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(catalogFailure(request, decoded.error)));
			}
			const snapshot = decoded.value;
			if (!canUse('catalog.read')) {
				return Promise.resolve(cloneOutput(catalogFailure(
					snapshot,
					sessionError(core, options, requested, consumer, 'catalog.read'),
				)));
			}
			return core.catalog.snapshot(snapshot).then(cloneOutput);
		},
	});
	const entities = Object.freeze({
		resolve: (request: EntityResolveRequestV1) => {
			const decoded = snapshotInput<EntityResolveRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(readFailure(
					'entity-resolution-result',
					request,
					decoded.error,
				)));
			}
			const snapshot = decoded.value;
			if (!canUse('entities.resolve')) {
				return Promise.resolve(cloneOutput(readFailure(
					'entity-resolution-result',
					snapshot,
					sessionError(core, options, requested, consumer, 'entities.resolve'),
				)));
			}
			return core.entities.resolve(snapshot).then(cloneOutput);
		},
	});
	const tasks = Object.freeze({
		get: (request: TaskGetRequestV1) => {
			const decoded = snapshotInput<TaskGetRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-get-result',
					request,
					decoded.error,
				)));
			}
			const snapshot = decoded.value;
			if (!canUse('tasks.read')) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-get-result',
					snapshot,
					sessionError(core, options, requested, consumer, 'tasks.read'),
				)));
			}
			return core.tasks.get(snapshot).then(cloneOutput);
		},
		query: (request: TaskQueryRequestV1) => {
			const decoded = snapshotInput<TaskQueryRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-query-result',
					request,
					decoded.error,
				)));
			}
			const snapshot = decoded.value;
			if (!canUse('tasks.query')) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-query-result',
					snapshot,
					sessionError(core, options, requested, consumer, 'tasks.query'),
				)));
			}
			return core.tasks.query(snapshot).then(cloneOutput);
		},
		filterQuery: (request: TaskFilterQueryRequestV1) => {
			const decoded = snapshotInput<TaskFilterQueryRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-filter-query-result',
					request,
					decoded.error,
				)));
			}
			const snapshot = decoded.value;
			if (!canUse('tasks.filter-query') || !core.tasks.filterQuery) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-filter-query-result',
					snapshot,
					sessionError(core, options, requested, consumer, 'tasks.filter-query' as CapabilityIdV1),
				)));
			}
			return core.tasks.filterQuery(snapshot).then(cloneOutput);
		},
		find: (request: TaskFinderRequestV1) => {
			const decoded = snapshotInput<TaskFinderRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-finder-result',
					request,
					decoded.error,
				)));
			}
			const snapshot = decoded.value;
			if (!canUse('tasks.finder')) {
				return Promise.resolve(cloneOutput(readFailure(
					'task-finder-result',
					snapshot,
					sessionError(core, options, requested, consumer, 'tasks.finder'),
				)));
			}
			return core.tasks.find(snapshot).then(cloneOutput);
		},
	});
	const relationships = Object.freeze({
		get: (request: RelationshipRequestV1) => {
			const decoded = snapshotInput<RelationshipRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(readFailure(
					'relationship-result',
					request,
					decoded.error,
				)));
			}
			const snapshot = decoded.value;
			if (!canUse('relationships.read')) {
				return Promise.resolve(cloneOutput(readFailure(
					'relationship-result',
					snapshot,
					sessionError(core, options, requested, consumer, 'relationships.read'),
				)));
			}
			return core.relationships.get(snapshot).then(cloneOutput);
		},
	});
	const context = Object.freeze({
		build: (request: ContextRequestV1) => {
			const decoded = snapshotInput<ContextRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(contextFailure(request, decoded.error)));
			}
			const snapshot = decoded.value;
			if (!canUse('context.build')) {
				return Promise.resolve(cloneOutput(contextFailure(
					snapshot,
					sessionError(core, options, requested, consumer, 'context.build'),
				)));
			}
			return core.context.build(snapshot).then(cloneOutput);
		},
	});
	const timers = Object.freeze({
		read: (request: TimerReadRequestV1) => {
			const decoded = snapshotInput<TimerReadRequestV1>(request);
			if (!decoded.ok) {
				return Promise.resolve(cloneOutput(timerFailure(request, decoded.error)));
			}
			const snapshot = decoded.value;
			if (!canUse('timers.read')) {
				return Promise.resolve(cloneOutput(timerFailure(
					snapshot,
					sessionError(core, options, requested, consumer, 'timers.read'),
				)));
			}
			return core.timers.read(snapshot).then(cloneOutput);
		},
	});
	const mutations = Object.freeze({
		preview: async (input: DeveloperMutationPreviewInputV1): Promise<DeveloperMutationPreviewResultV1> => {
			const requestId = nextRequestId();
			const validationError = validateMutationInput(
				input,
				['capability', 'mutationKind', 'spec'],
				PREVIEW_INPUT_KEYS_V1,
			);
			if (validationError) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: validationError,
					warnings: [],
				});
			}
			const snapshot = cloneInput<DeveloperMutationPreviewInputV1>(input);
			const expected = MUTATION_CAPABILITY_MAP_V1[snapshot.mutationKind];
			if (expected?.preview !== snapshot.capability) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: structuredErrorV1(
						'invalid-request',
						'The preview capability does not match the requested mutation kind.',
					),
					warnings: [],
				});
			}
			if (!canUse(snapshot.capability)) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: sessionError(core, options, requested, consumer, snapshot.capability),
					warnings: [],
				});
			}
			const policy = options.mutationSecurityPolicy;
			if (!policy) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: mutationAuthorityError(),
					warnings: [],
				});
			}
			const grant = currentSecurityGrant(options, consumer, requested);
			const admission = policy.admitPreview({
				session: securitySession,
				grant,
				capability: snapshot.capability,
			});
			if (!admission.ok) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: securityDenialError(admission),
					warnings: [],
				});
			}
			const idempotencyKey = createHostMutationKey(sessionId, requestId);
			let result: Awaited<ReturnType<OperonAgentRuntimeCoreV1['mutations']['preview']>>;
			try {
				result = await core.mutations.preview({
					contractVersion: CONTRACT_VERSION_V1,
					requestId,
					kind: 'mutation-preview',
					clientInstanceId: `developer-api:${consumer.id}:${consumer.instanceEpoch}`,
					idempotencyKey,
					correlationId: requestId,
					capability: snapshot.capability,
					mutationKind: snapshot.mutationKind,
					...(snapshot.target ? { target: snapshot.target } : {}),
					spec: snapshot.spec as unknown as Parameters<
						OperonAgentRuntimeCoreV1['mutations']['preview']
					>[0]['spec'],
					authorization: admission.authorization,
				});
			} catch {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: structuredErrorV1(
						'internal-error',
						'The Runtime preview handler failed unexpectedly.',
					),
					warnings: [],
				});
			}
			if (!result.ok) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: result.error,
					warnings: result.warnings,
				});
			}
			const binding = policy.bindPlan({
				session: securitySession,
				grant,
				plan: result.plan,
			});
			if (!binding.ok) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-preview-result',
					requestId,
					ok: false,
					error: securityDenialError(binding),
					warnings: result.warnings,
				});
			}
			const recoveryRef = createHostRecoveryRef();
			const handle = createDeveloperPlanHandle(result.plan, recoveryRef);
			const dispatch = {
				binding: binding.binding,
				dispatchStarted: false,
			};
			boundPlans.set(handle, {
				recoveryRef,
				sealed: result.plan,
				binding: binding.binding,
				idempotencyKey,
				dispatch,
				state: 'idle',
			});
			return freezeApiStructure({
				contractVersion: CONTRACT_VERSION_V1,
				kind: 'developer-mutation-preview-result',
				requestId,
				ok: true,
				plan: handle,
				warnings: freezeDto(result.warnings),
			});
		},
		apply: async (input: DeveloperMutationApplyInputV1): Promise<DeveloperMutationExecutionResultV1> => {
			const requestId = nextRequestId();
			const validationError = validateMutationInput(input, PLAN_INPUT_KEYS_V1, PLAN_INPUT_KEYS_V1);
			if (validationError) return cloneOutput(mutationExecutionFailure(requestId, validationError));
			const bound = boundPlans.get(input.plan);
			if (!bound) {
				return cloneOutput(mutationExecutionFailure(
					requestId,
					structuredErrorV1(
						'invalid-request',
						'The mutation plan is not an opaque handle from this Developer API session.',
					),
				));
			}
			if (bound.state === 'terminal' && bound.terminalResult) {
				return cloneOutput(projectTerminalReceiptReplay(
					requestId,
					bound.terminalResult,
				));
			}
			if (bound.state !== 'idle') {
				return cloneOutput(mutationExecutionFailure(
					requestId,
					planStateError('apply', bound.state),
				));
			}
			bound.state = 'applying';
			const policy = options.mutationSecurityPolicy;
			if (!policy) {
				bound.state = 'terminal';
				return cloneOutput(mutationExecutionFailure(requestId, mutationAuthorityError()));
			}
			const admission = await policy.admitApply({
				session: securitySession,
				grant: currentSecurityGrant(options, consumer, requested),
				binding: bound.binding,
				plan: bound.sealed,
			});
			if (!admission.ok) {
				bound.state = 'terminal';
				return cloneOutput(mutationExecutionFailure(requestId, securityDenialError(admission)));
			}
			bound.authorization = admission.authorization;
			bound.acknowledgements = [...admission.acknowledgements];
			try {
				await recoveryStore.putPrepared(createRecoveryRecord(
					consumer.id,
					bound,
					options.now?.() ?? new Date(),
				));
			} catch (error) {
				bound.state = 'idle';
				return cloneOutput(mutationExecutionFailure(
					requestId,
					recoveryStoreStructuredError(error),
				));
			}
			const dispatchAdmission = policy.claimApplyDispatch({
				session: securitySession,
				grant: currentSecurityGrant(options, consumer, requested),
				binding: bound.binding,
				plan: bound.sealed,
			});
			if (!dispatchAdmission.ok) {
				bound.state = 'terminal';
				try {
					await recoveryStore.markRefused(consumer.id, bound.recoveryRef);
				} catch {
					// The durable record is still prepared and therefore cannot
					// be listed or recovered after restart.
				}
				return cloneOutput(mutationExecutionFailure(
					requestId,
					securityDenialError(dispatchAdmission),
				));
			}
			try {
				await recoveryStore.markDispatched(consumer.id, bound.recoveryRef);
			} catch (error) {
				policy.releaseApplyDispatchClaim({
					session: securitySession,
					plan: bound.sealed,
				});
				bound.state = 'idle';
				return cloneOutput(mutationExecutionFailure(
					requestId,
					recoveryStoreStructuredError(error),
				));
			}
			// The one-shot host claim is the dispatch boundary. Its private
			// recovery record is made durable before Runtime is invoked; a crash
			// after this point is therefore recoverable without the audit log.
			bound.dispatch.dispatchStarted = true;
			let result: MutationResultV1;
			try {
				result = await core.mutations.apply({
					contractVersion: CONTRACT_VERSION_V1,
					requestId,
					kind: 'mutation-apply',
					plan: bound.sealed,
					authorization: admission.authorization,
					idempotencyKey: bound.idempotencyKey,
					acknowledgements: [...admission.acknowledgements],
				});
			} catch {
				result = dispatchedHandlerFailure(requestId);
			}
			bound.state = planStateAfterResult(result);
			if (bound.state === 'terminal') {
				if (isSuccessfulTerminalResult(result)) {
					bound.terminalResult = result;
					await markRecoveryRecordTerminalBestEffort(
						recoveryStore,
						consumer.id,
						bound.recoveryRef,
					);
				} else {
					try {
						await recoveryStore.markRefused(consumer.id, bound.recoveryRef);
					} catch {
						result = dispatchedHandlerFailure(requestId);
						bound.state = 'recovery-required';
					}
				}
			}
			return cloneOutput(projectMutationExecutionResult(requestId, input.plan, result));
		},
		recover: async (input: DeveloperMutationRecoverInputV1): Promise<DeveloperMutationExecutionResultV1> => {
			const requestId = nextRequestId();
			const validationError = validateRecoveryInput(input);
			if (validationError) {
				return cloneOutput(mutationExecutionFailure(requestId, validationError));
			}
			if (
				!options.grantController.isConsumerCurrent(consumer)
				|| !options.isCoreActive(core)
			) {
				return cloneOutput(mutationExecutionFailure(
					requestId,
					structuredErrorV1(
						'authority-insufficient',
						'Recovery requires the current host-verified consumer and active Runtime.',
						{ details: { reasonCode: 'developer-api-recovery-session-stale' } },
					),
				));
			}
			let handle: DeveloperMutationPlanHandleV1;
			let bound: BoundPlanV1 | undefined;
			if ('plan' in input && input.plan) {
				handle = input.plan;
				bound = boundPlans.get(input.plan);
			} else {
				let record: DeveloperMutationRecoveryRecordV1 | undefined;
				try {
					record = await recoveryStore.get(consumer.id, input.recoveryRef);
				} catch (error) {
					return cloneOutput(mutationExecutionFailure(
						requestId,
						recoveryStoreStructuredError(error),
					));
				}
				if (!record) {
					return cloneOutput(mutationExecutionFailure(
						requestId,
						structuredErrorV1(
							'invalid-request',
							'The recovery reference is not pending for this Developer API consumer.',
							{ details: { reasonCode: 'developer-api-recovery-ref-unavailable' } },
						),
					));
				}
				if (!isBaseDeveloperMutationPlan(record.sealed)) {
					return cloneOutput(mutationExecutionFailure(
						requestId,
						structuredErrorV1(
							'invalid-request',
							'The recovery reference belongs to another Developer API plan family.',
						),
					));
				}
				handle = createDeveloperPlanHandle(record.sealed, record.recoveryRef);
				bound = {
					recoveryRef: record.recoveryRef,
					sealed: record.sealed,
					binding: record.binding,
					idempotencyKey: record.idempotencyKey,
					dispatch: {
						binding: record.binding,
						dispatchStarted: true,
					},
					state: 'recovery-required',
					authorization: record.authorization,
					acknowledgements: [...record.acknowledgements],
				};
				boundPlans.set(handle, bound);
			}
			if (!bound || !bound.authorization || !bound.acknowledgements) {
				return cloneOutput(mutationExecutionFailure(
					requestId,
					structuredErrorV1(
						'invalid-request',
						'Recovery requires the same opaque plan after apply dispatch.',
					),
				));
			}
			if (bound.state !== 'recovery-required') {
				return cloneOutput(mutationExecutionFailure(
					requestId,
					planStateError('recover', bound.state),
				));
			}
			bound.state = 'applying';
			const policy = options.mutationSecurityPolicy;
			if (!policy) {
				bound.state = 'recovery-required';
				return cloneOutput(mutationExecutionFailure(requestId, mutationAuthorityError()));
			}
			const admission = policy.admitRecovery({
				session: securitySession,
				plan: bound.sealed,
				dispatch: bound.dispatch,
			});
			if (!admission.ok) {
				bound.state = 'recovery-required';
				return cloneOutput(mutationExecutionFailure(requestId, securityDenialError(admission)));
			}
			let result: MutationResultV1;
			try {
				result = await core.mutations.apply({
					contractVersion: CONTRACT_VERSION_V1,
					requestId,
					kind: 'mutation-apply',
					plan: bound.sealed,
					authorization: bound.authorization,
					idempotencyKey: bound.idempotencyKey,
					acknowledgements: [...bound.acknowledgements],
				});
			} catch {
				result = dispatchedHandlerFailure(requestId);
			}
			bound.state = planStateAfterResult(result);
			if (bound.state === 'terminal') {
				if (isSuccessfulTerminalResult(result)) {
					await markRecoveryRecordTerminalBestEffort(
						recoveryStore,
						consumer.id,
						bound.recoveryRef,
					);
				} else {
					try {
						await recoveryStore.markRefused(consumer.id, bound.recoveryRef);
					} catch {
						result = dispatchedHandlerFailure(requestId);
						bound.state = 'recovery-required';
					}
				}
			}
			return cloneOutput(projectMutationExecutionResult(requestId, handle, result));
		},
		pendingRecoveries: async (): Promise<DeveloperMutationPendingRecoveriesResultV1> => {
			if (!options.grantController.isConsumerCurrent(consumer)) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-pending-recoveries-result',
					ok: false,
					error: structuredErrorV1(
						'authority-insufficient',
						'Pending recoveries require the current host-verified consumer.',
						{ details: { reasonCode: 'developer-api-recovery-session-stale' } },
					),
				});
			}
			try {
				const records = (await recoveryStore.list(consumer.id)).filter(isBaseRecoveryRecord);
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-pending-recoveries-result',
					ok: true,
					recoveries: records.filter(record => isBaseDeveloperMutationPlan(record.sealed)).map(record => ({
						recoveryRef: record.recoveryRef,
						planDigest: record.planDigest,
						mutationKind: record.sealed.mutationKind,
						capability: record.sealed.capability,
						riskLevel: record.sealed.riskLevel,
						createdAt: record.createdAt,
						expiresAt: record.expiresAt,
					})),
				});
			} catch (error) {
				return cloneOutput({
					contractVersion: CONTRACT_VERSION_V1,
					kind: 'developer-mutation-pending-recoveries-result',
					ok: false,
					error: recoveryStoreStructuredError(error),
				});
			}
		},
	});

	return freezeApiStructure({
		contractVersion: CONTRACT_VERSION_V1,
		runtimeApiVersion: RUNTIME_API_VERSION_V1,
		sessionId,
		hasCapability: (name: string) => (
			isCapabilityIdV1(name)
			&& requested.has(name)
			&& (
				BASELINE_DISCOVERY_CAPABILITIES_V1.has(name)
				|| evaluateSessionGrant(options, consumer, requested).effectiveCapabilities.includes(name)
			)
			&& options.isCoreActive(core)
			&& (
				READ_CAPABILITIES_V1.has(name)
					? status().admission.reads
					: status().admission.writes
			)
			&& core.hasCapability(name)
		),
		channel: Object.freeze({ status }),
		system,
		catalog,
		entities,
		tasks,
		relationships,
		context,
		timers,
		mutations,
	});
}

function decodeAccessRequest(
	value: unknown,
): { ok: true; value: OperonDeveloperApiAccessRequestV1 } | { ok: false; error: StructuredErrorV1 } {
	try {
		return decodeAccessRequestUnsafe(value);
	} catch {
		return invalidAccessRequest('Developer API access must be a plain structured-cloneable V1 request.');
	}
}

function decodeAccessRequestUnsafe(
	value: unknown,
): { ok: true; value: OperonDeveloperApiAccessRequestV1 } | { ok: false; error: StructuredErrorV1 } {
	if (!isPlainRecord(value) || !hasExactKeys(value, ACCESS_REQUEST_KEYS_V1)) {
		return invalidAccessRequest('Developer API access accepts only contractVersion, runtimeApi, and requestedCapabilities.');
	}
	if (value.contractVersion !== CONTRACT_VERSION_V1) {
		return invalidAccessRequest('Developer API access requires contractVersion 1.');
	}
	if (
		!isPlainRecord(value.runtimeApi)
		|| !hasExactKeys(value.runtimeApi, RUNTIME_RANGE_KEYS_V1)
		|| !isSafePositiveInteger(value.runtimeApi.min)
		|| !isSafePositiveInteger(value.runtimeApi.max)
		|| value.runtimeApi.min > value.runtimeApi.max
	) {
		return invalidAccessRequest('runtimeApi must be an ordered positive integer min/max range.');
	}
	if (!Array.isArray(value.requestedCapabilities)) {
		return invalidAccessRequest('requestedCapabilities must be an array.');
	}
	if (value.requestedCapabilities.length > CONTRACT_LIMITS_V1.collectionItems) {
		return invalidAccessRequest('requestedCapabilities exceeds the Runtime V1 collection limit.');
	}
	const requestedCapabilities: CapabilityIdV1[] = [];
	const seen = new Set<string>();
	for (const capability of value.requestedCapabilities) {
		if (typeof capability !== 'string' || !isCapabilityIdV1(capability)) {
			return invalidAccessRequest('requestedCapabilities contains an unknown Runtime V1 capability.');
		}
		if (seen.has(capability)) {
			return invalidAccessRequest('requestedCapabilities must not contain duplicates.');
		}
		seen.add(capability);
		requestedCapabilities.push(capability);
	}
	return {
		ok: true,
		value: freezeDto({
			contractVersion: CONTRACT_VERSION_V1,
			runtimeApi: {
				min: value.runtimeApi.min,
				max: value.runtimeApi.max,
			},
			requestedCapabilities,
		}),
	};
}

function invalidAccessRequest(reason: string): { ok: false; error: StructuredErrorV1 } {
	return { ok: false, error: structuredErrorV1('invalid-request', reason) };
}

function grantRequiredCapabilities(
	requested: ReadonlySet<CapabilityIdV1>,
): CapabilityIdV1[] {
	return [...requested].filter(capability => !BASELINE_DISCOVERY_CAPABILITIES_V1.has(capability));
}

function evaluateSessionGrant(
	options: OperonDeveloperApiRuntimeOptionsV1,
	consumer: DeveloperApiConsumerDescriptorV1,
	requested: ReadonlySet<CapabilityIdV1>,
): DeveloperApiGrantEvaluationV1 {
	const required = grantRequiredCapabilities(requested);
	if (required.length === 0) {
		const persistenceReady = options.grantController.observeConsumerVersion(consumer, []);
		return {
			state: persistenceReady ? 'active' : 'suspended',
			revision: 0,
			grantedCapabilities: [],
			effectiveCapabilities: persistenceReady ? [...requested] : [],
			pendingCapabilities: [],
			reason: persistenceReady ? 'active' : 'grant-persistence-unavailable',
		};
	}
	const grant = options.grantController.evaluate(consumer, required);
	if (grant.state === 'active' && options.grantController.hasPersistenceError()) {
		return {
			...grant,
			state: 'suspended',
			effectiveCapabilities: [],
			reason: 'grant-persistence-unavailable',
		};
	}
	return {
		...grant,
		effectiveCapabilities: grant.state === 'active'
			? [...new Set([
				...grant.effectiveCapabilities,
				...[...requested].filter(capability => BASELINE_DISCOVERY_CAPABILITIES_V1.has(capability)),
			])]
			: [],
	};
}

function currentChannelStatus(
	core: OperonAgentRuntimeCoreV1,
	options: OperonDeveloperApiRuntimeOptionsV1,
	requested: ReadonlySet<CapabilityIdV1>,
	consumer: DeveloperApiConsumerDescriptorV1,
): DeveloperApiChannelStatusV1 {
	const active = options.isCoreActive(core);
	const consumerCurrent = options.grantController.isConsumerCurrent(consumer);
	const phase = options.lifecyclePhase();
	const sessionActive = active && consumerCurrent && phase !== 'unloading';
	const lifecycleError = options.lifecycleError();
	const terminalLifecycleError = lifecycleError?.retryable === false;
	const reason = !sessionActive
		? (phase === 'unloading' ? 'unloading' : 'accessor-unavailable')
		: terminalLifecycleError
			? 'terminal-startup-failure'
			: phase;
	const grant = evaluateSessionGrant(options, consumer, requested);
	const reads = grant.state === 'active' && sessionActive && !terminalLifecycleError && (
		phase === 'cache-ready'
		|| phase === 'settling'
		|| phase === 'ready'
	);
	const capabilities = projectCapabilities(
		sessionActive ? core.system.capabilities() : [],
		requested,
		reads,
	);
	const writes = reads
		&& phase === 'ready'
		&& grant.effectiveCapabilities.some(capability => isCapabilityIdV1(capability) && !READ_CAPABILITIES_V1.has(capability));
	const availability = !sessionActive || phase === 'booting' || terminalLifecycleError
		? 'unavailable'
		: phase === 'ready' && !lifecycleError
			? 'available'
			: 'degraded';
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-api-channel-status',
		runtimeApiVersion: RUNTIME_API_VERSION_V1,
		availability,
		reason,
		lifecyclePhase: phase,
		authority: reads
			? (grantRequiredCapabilities(requested).length > 0 ? 'granted' : 'read-only')
			: 'revoked',
		consumer: {
			id: consumer.id,
			name: consumer.name,
			version: consumer.version,
			instanceEpoch: consumer.instanceEpoch,
		},
		grant: {
			state: grant.state,
			revision: grant.revision,
			requestedCapabilities: [...requested],
			grantedCapabilities: grant.grantedCapabilities.filter(isCapabilityIdV1),
			effectiveCapabilities: grant.effectiveCapabilities.filter(isCapabilityIdV1),
		},
		admission: {
			reads,
			writes,
		},
		capabilities,
		...(options.retryAfterMs() === undefined ? {} : { retryAfterMs: options.retryAfterMs() }),
		...(lifecycleError ? { error: lifecycleError } : {}),
	});
}

function accessFailureStatus(
	options: OperonDeveloperApiRuntimeOptionsV1,
	reason: DeveloperApiChannelStatusV1['reason'],
	error: StructuredErrorV1,
): DeveloperApiChannelStatusV1 {
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-api-channel-status',
		runtimeApiVersion: RUNTIME_API_VERSION_V1,
		availability: 'unavailable',
		reason,
		lifecyclePhase: safeLifecyclePhase(options),
		authority: 'revoked',
		admission: { reads: false, writes: false },
		capabilities: [],
		error,
	});
}

function projectCapabilities(
	advertisements: readonly CapabilityAdvertisementV1[],
	requested: ReadonlySet<CapabilityIdV1>,
	admitted: boolean = true,
): readonly CapabilityAdvertisementV1[] {
	return freezeDto(advertisements
		.filter(advertisement => (
			isCapabilityIdV1(advertisement.id)
			&& (
				BASELINE_DISCOVERY_CAPABILITIES_V1.has(advertisement.id)
				|| requested.has(advertisement.id)
			)
		))
		.map(advertisement => admitted
			? { ...advertisement }
			: {
				...advertisement,
				availability: 'unavailable' as const,
				reason: 'developer-api-read-admission-closed',
			}));
}

function projectHealth(
	health: RuntimeHealthV1,
	requested: ReadonlySet<CapabilityIdV1>,
	readsAdmitted: boolean,
	writesAdmitted: boolean,
): RuntimeHealthV1 {
	return {
		...health,
		capabilities: projectCapabilities(
			health.capabilities,
			requested,
			readsAdmitted,
		) as CapabilityAdvertisementV1[],
		admission: {
			reads: readsAdmitted && health.admission.reads,
			writes: writesAdmitted && health.admission.writes,
		},
	};
}

function unavailableDeveloperHealth(
	options: OperonDeveloperApiRuntimeOptionsV1,
	channel: DeveloperApiChannelStatusV1,
): RuntimeHealthV1 {
	return {
		apiVersion: RUNTIME_API_VERSION_V1,
		contractVersion: CONTRACT_VERSION_V1,
		lifecyclePhase: channel.lifecyclePhase ?? 'booting',
		v8PersistencePhase: 'idle',
		compatibility: {
			contractVersion: CONTRACT_VERSION_V1,
			runtimeApi: { min: RUNTIME_API_VERSION_V1, max: RUNTIME_API_VERSION_V1 },
		},
		capabilities: [...channel.capabilities],
		freshness: {
			source: 'live-runtime',
			coherence: 'unverified',
			observedAt: (options.now?.() ?? new Date()).toISOString(),
			settled: false,
		},
		admission: { reads: false, writes: false },
		warnings: [],
		ok: false,
		error: structuredErrorV1(
			'authority-insufficient',
			'The Developer API consumer session is no longer current.',
			{ details: { reasonCode: 'developer-api-consumer-session-stale' } },
		),
	};
}

function projectDiagnostics(
	diagnostics: RuntimeDiagnosticsV1,
	requested: ReadonlySet<CapabilityIdV1>,
	readsAdmitted: boolean,
	writesAdmitted: boolean,
): RuntimeDiagnosticsV1 {
	return {
		...diagnostics,
		health: projectHealth(diagnostics.health, requested, readsAdmitted, writesAdmitted),
		capabilities: projectCapabilities(
			diagnostics.capabilities,
			requested,
			readsAdmitted,
		) as CapabilityAdvertisementV1[],
	};
}

function diagnosticsFailure(
	health: RuntimeHealthV1,
	error: StructuredErrorV1,
): RuntimeDiagnosticsV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'runtime-diagnostics',
		health: {
			...health,
			ok: false,
			admission: { reads: false, writes: false },
			error,
		},
		capabilities: health.capabilities,
		warnings: [{
			code: 'developer-api-authority-insufficient',
			message: error.reason,
		}],
	};
}

function sessionError(
	core: OperonAgentRuntimeCoreV1,
	options: OperonDeveloperApiRuntimeOptionsV1,
	requested: ReadonlySet<CapabilityIdV1>,
	consumer: DeveloperApiConsumerDescriptorV1,
	capability: CapabilityIdV1,
): StructuredErrorV1 {
	if (!requested.has(capability)) {
		return structuredErrorV1(
			'authority-insufficient',
			'This capability was not granted to the current Developer API session.',
			{ details: { capability } },
		);
	}
	const grant = evaluateSessionGrant(options, consumer, requested);
	if (
		!BASELINE_DISCOVERY_CAPABILITIES_V1.has(capability)
		&& !grant.effectiveCapabilities.includes(capability)
	) {
		return structuredErrorV1(
			'authority-insufficient',
			'The current Developer API grant no longer admits this capability.',
			{
				details: {
					capability,
					grantState: grant.state,
					grantRevision: grant.revision,
					reasonCode: grant.reason,
				},
			},
		);
	}
	const status = currentChannelStatus(core, options, requested, consumer);
	if (!options.isCoreActive(core) || status.reason === 'unloading') {
		return structuredErrorV1(
			'capability-unavailable',
			'This Developer API session is stale or Runtime admission is closed.',
		);
	}
	return structuredErrorV1(
		'capability-unavailable',
		'The requested capability is not currently available.',
		{ details: { capability } },
	);
}

function catalogFailure(
	request: unknown,
	error: StructuredErrorV1,
): OperonCatalogV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readStringProperty(request, 'requestId') ?? 'developer-api',
		kind: 'catalog-result',
		ok: false,
		freshness: unavailableFreshness(),
		warnings: [],
		error,
	};
}

type ReadFailureKindV1 =
	| 'entity-resolution-result'
	| 'task-get-result'
	| 'task-query-result'
	| 'task-filter-query-result'
	| 'task-finder-result'
	| 'relationship-result';

function readFailure(
	kind: 'entity-resolution-result',
	request: unknown,
	error: StructuredErrorV1,
): EntityResolutionResultV1;
function readFailure(
	kind: 'task-get-result',
	request: unknown,
	error: StructuredErrorV1,
): TaskGetResultV1;
function readFailure(
	kind: 'task-query-result',
	request: unknown,
	error: StructuredErrorV1,
): TaskQueryResultV1;
function readFailure(
	kind: 'task-filter-query-result',
	request: unknown,
	error: StructuredErrorV1,
): TaskFilterQueryResultV1;
function readFailure(
	kind: 'task-finder-result',
	request: unknown,
	error: StructuredErrorV1,
): TaskFinderResultV1;
function readFailure(
	kind: 'relationship-result',
	request: unknown,
	error: StructuredErrorV1,
): RelationshipResultV1;
function readFailure(
	kind: ReadFailureKindV1,
	request: unknown,
	error: StructuredErrorV1,
): EntityResolutionResultV1
	| TaskGetResultV1
	| TaskQueryResultV1
	| TaskFilterQueryResultV1
	| TaskFinderResultV1
	| RelationshipResultV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readStringProperty(request, 'requestId') ?? 'developer-api',
		kind,
		ok: false,
		freshness: unavailableFreshness(),
		warnings: [],
		error,
	};
}

function contextFailure(
	request: unknown,
	error: StructuredErrorV1,
): ContextPackV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readStringProperty(request, 'requestId') ?? 'developer-api',
		kind: 'context-pack',
		purpose: readStringProperty(request, 'purpose') === 'analysis'
			? 'analysis'
			: readStringProperty(request, 'purpose') === 'planning'
				? 'planning'
				: readStringProperty(request, 'purpose') === 'creation'
					? 'creation'
					: readStringProperty(request, 'purpose') === 'mutation-readiness'
						? 'mutation-readiness'
						: 'read',
		projection: readContextProjection(request),
		ok: false,
		warnings: [],
		error,
	};
}

function timerFailure(
	request: unknown,
	error: StructuredErrorV1,
): TimerReadResultV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readStringProperty(request, 'requestId') ?? 'developer-api',
		kind: 'timer-read-result',
		ok: false,
		freshness: unavailableFreshness(),
		warnings: [],
		error,
	};
}

function currentSecurityGrant(
	options: OperonDeveloperApiRuntimeOptionsV1,
	consumer: DeveloperApiConsumerDescriptorV1,
	requested: ReadonlySet<CapabilityIdV1>,
): DeveloperCapabilityGrantV1 {
	const evaluation = evaluateSessionGrant(options, consumer, requested);
	return {
		consumerId: consumer.id,
		state: evaluation.state,
		revision: evaluation.revision,
		capabilities: new Set(
			evaluation.effectiveCapabilities.filter((capability): capability is CapabilityIdV1 => (
				isCapabilityIdV1(capability)
				&&
				!BASELINE_DISCOVERY_CAPABILITIES_V1.has(capability)
			)),
		),
	};
}

function isBaseDeveloperMutationPlan(
	plan: DeveloperMutationSealedPlanV1,
): plan is SealedMutationPlanV1 {
	return plan.mutationKind !== 'task.adopt' && isCapabilityIdV1(plan.capability);
}

function isBaseRecoveryRecord(
	record: DeveloperMutationRecoveryRecordV1,
): record is DeveloperMutationRecoveryRecordV1 & { readonly sealed: SealedMutationPlanV1 } {
	return isBaseDeveloperMutationPlan(record.sealed);
}

function createDeveloperPlanHandle(
	plan: SealedMutationPlanV1,
	recoveryRef: string,
): DeveloperMutationPlanHandleV1 {
	const targets = plan.targets.flatMap(target => (
		target.operonId && target.locator
			? [{ operonId: target.operonId, locator: target.locator }]
			: []
	));
	return freezeDto({
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-mutation-plan',
		recoveryRef,
		planDigest: plan.planHash,
		capability: plan.capability,
		mutationKind: plan.mutationKind,
		createdAt: plan.createdAt,
		expiresAt: plan.expiresAt,
		riskLevel: plan.riskLevel,
		requiresConsent: plan.requiresConfirmation,
		targets,
		predictedEffects: plan.predictedEffects,
		warnings: plan.warnings,
	}) as unknown as DeveloperMutationPlanHandleV1;
}

function securityDenialError(
	denial: DeveloperSecurityDenialV1,
): StructuredErrorV1 {
	return structuredErrorV1(
		denial.code,
		denial.reason,
		{
			retryable: denial.retryable,
			details: { reasonCode: denial.reasonCode },
		},
	);
}

function projectMutationExecutionResult(
	requestId: string,
	handle: DeveloperMutationPlanHandleV1,
	result: MutationResultV1,
): DeveloperMutationExecutionResultV1 {
	if (
		result.status === 'applied'
		&& result.receipt
		&& result.postflight?.status === 'verified'
	) {
		return {
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-mutation-execution-result',
			requestId,
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: result.groupResults,
			receipt: {
				contractVersion: CONTRACT_VERSION_V1,
				planDigest: result.receipt.planHash,
				mutationKind: result.receipt.mutationKind,
				targetDigest: result.receipt.targetDigest,
				terminalOutcome: 'applied',
				effectiveAt: result.receipt.effectiveAt,
				completedAt: result.receipt.completedAt,
				expiresAt: result.receipt.expiresAt,
			},
			postflight: result.postflight,
		};
	}
	if (
		result.status === 'already-applied'
		&& result.receipt
		&& result.postflight?.status === 'receipt-replay'
	) {
		return {
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'developer-mutation-execution-result',
			requestId,
			status: 'already-applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: result.groupResults,
			receipt: {
				contractVersion: CONTRACT_VERSION_V1,
				planDigest: result.receipt.planHash,
				mutationKind: result.receipt.mutationKind,
				targetDigest: result.receipt.targetDigest,
				terminalOutcome: 'already-applied',
				effectiveAt: result.receipt.effectiveAt,
				completedAt: result.receipt.completedAt,
				expiresAt: result.receipt.expiresAt,
			},
			postflight: result.postflight,
		};
	}
	if (result.status === 'failed' && !result.mutationMayHaveApplied) {
		return mutationExecutionFailure(
			requestId,
			result.error ?? structuredErrorV1('internal-error', 'Mutation execution failed without an error.'),
			result.groupResults,
		);
	}
	const error = structuredErrorV1(
		'outcome-unknown',
		result.error?.reason ?? 'The mutation outcome is uncertain. Recover only with this same sealed plan.',
		{
			retryable: false,
			action: 'recover-same-plan',
			details: {
				...(result.error ? { reasonCode: result.error.code } : {}),
			},
		},
	) as DeveloperMutationRecoveryErrorV1;
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-mutation-execution-result',
		requestId,
		status: result.status === 'partial' ? 'partial' : 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: result.groupResults,
		error,
		recovery: {
			required: true,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
			recoveryRef: handle.recoveryRef,
			planDigest: handle.planDigest,
			plan: handle,
		},
	};
}

function projectTerminalReceiptReplay(
	requestId: string,
	result: MutationResultV1,
): DeveloperMutationExecutionResultV1 {
	if (!isSuccessfulTerminalResult(result) || !result.receipt) {
		return mutationExecutionFailure(
			requestId,
			structuredErrorV1('internal-error', 'The terminal mutation receipt is unavailable for replay.'),
		);
	}
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-mutation-execution-result',
		requestId,
		status: 'already-applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		receipt: {
			contractVersion: CONTRACT_VERSION_V1,
			planDigest: result.receipt.planHash,
			mutationKind: result.receipt.mutationKind,
			targetDigest: result.receipt.targetDigest,
			terminalOutcome: 'already-applied',
			effectiveAt: result.receipt.effectiveAt,
			completedAt: result.receipt.completedAt,
			expiresAt: result.receipt.expiresAt,
		},
		postflight: {
			status: 'receipt-replay',
		},
	};
}

function dispatchedHandlerFailure(requestId: string): MutationResultV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId,
		kind: 'mutation-result',
		status: 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		error: structuredErrorV1(
			'outcome-unknown',
			'The Runtime apply handler failed after dispatch began.',
			{
				retryable: false,
				action: 'recover-same-plan',
			},
		),
	};
}

function planStateAfterResult(
	result: MutationResultV1,
): DeveloperPlanExecutionStateV1 {
	if (
		result.status === 'applied'
		&& result.receipt
		&& result.postflight?.status === 'verified'
	) {
		return 'terminal';
	}
	if (
		result.status === 'already-applied'
		&& result.receipt
		&& result.postflight?.status === 'receipt-replay'
	) {
		return 'terminal';
	}
	if (result.status === 'failed' && !result.mutationMayHaveApplied) return 'terminal';
	return 'recovery-required';
}

function isSuccessfulTerminalResult(result: MutationResultV1): boolean {
	return (
		result.status === 'applied'
		&& result.receipt !== undefined
		&& result.postflight?.status === 'verified'
	) || (
		result.status === 'already-applied'
		&& result.receipt !== undefined
		&& result.postflight?.status === 'receipt-replay'
	);
}

function planStateError(
	action: 'apply' | 'recover',
	state: DeveloperPlanExecutionStateV1,
): StructuredErrorV1 {
	return structuredErrorV1(
		'invalid-request',
		action === 'apply'
			? `Apply is unavailable while this sealed plan is ${state}.`
			: `Recovery is available only while this sealed plan is recovery-required, not ${state}.`,
		{
			details: {
				reasonCode: action === 'apply'
					? 'developer-api-plan-apply-already-attempted'
					: 'developer-api-plan-not-recovery-required',
				planState: state,
			},
		},
	);
}

function mutationExecutionFailure(
	requestId: string,
	error: StructuredErrorV1,
	groupResults: MutationResultV1['groupResults'] = [],
): DeveloperMutationExecutionResultV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		kind: 'developer-mutation-execution-result',
		requestId,
		status: 'failed',
		mutationMayHaveApplied: false,
		retryAllowed: false,
		groupResults,
		error,
	};
}

function mutationAuthorityError(): StructuredErrorV1 {
	return structuredErrorV1(
		'authority-insufficient',
		'Developer API mutation admission requires the host security policy.',
	);
}

function createHostMutationKey(sessionId: string, requestId: string): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const entropy = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
	return `${sessionId}:${requestId}:${entropy}`;
}

function createHostRecoveryRef(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return `dvr1_${Array.from(
		bytes,
		byte => byte.toString(16).padStart(2, '0'),
	).join('')}`;
}

function createRecoveryRecord(
	consumerId: string,
	bound: {
		readonly recoveryRef: string;
		readonly sealed: SealedMutationPlanV1;
		readonly binding: DeveloperPlanSecurityBindingV1;
		readonly idempotencyKey: string;
		readonly authorization?: Parameters<
			OperonAgentRuntimeCoreV1['mutations']['apply']
		>[0]['authorization'];
		readonly acknowledgements?: Parameters<
			OperonAgentRuntimeCoreV1['mutations']['apply']
		>[0]['acknowledgements'];
	},
	now: Date,
): DeveloperMutationRecoveryRecordV1 {
	if (!bound.authorization || !bound.acknowledgements) {
		throw new DeveloperMutationRecoveryStoreErrorV1(
			'recovery-store-corrupt',
			'Host-owned recovery credentials are incomplete.',
		);
	}
	const createdAtMs = now.getTime();
	return {
		contractVersion: CONTRACT_VERSION_V1,
		recoveryRef: bound.recoveryRef,
		consumerId,
		planDigest: bound.sealed.planHash,
		sealed: bound.sealed,
		binding: bound.binding,
		idempotencyKey: bound.idempotencyKey,
		authorization: bound.authorization,
		acknowledgements: [...bound.acknowledgements],
		state: 'prepared',
		createdAt: new Date(createdAtMs).toISOString(),
		expiresAt: new Date(
			createdAtMs + DEVELOPER_RECOVERY_RETENTION_MS_V1,
		).toISOString(),
	};
}

async function markRecoveryRecordTerminalBestEffort(
	store: DeveloperMutationRecoveryStoreV1,
	consumerId: string,
	recoveryRef: string,
): Promise<void> {
	try {
		await store.markTerminal(consumerId, recoveryRef);
	} catch {
		// Leaving the record dispatched is conservative and keeps same-plan
		// receipt replay available if result delivery is interrupted.
	}
}

function recoveryStoreStructuredError(error: unknown): StructuredErrorV1 {
	if (
		error instanceof DeveloperMutationRecoveryStoreErrorV1
		&& error.code === 'plan-expired'
	) {
		return structuredErrorV1(
			'plan-expired',
			error.message,
			{ retryable: false, action: 'do-not-retry' },
		);
	}
	const reasonCode = error instanceof DeveloperMutationRecoveryStoreErrorV1
		? error.code
		: 'recovery-store-unexpected-failure';
	return structuredErrorV1(
		'receipt-store-unavailable',
		'Durable Developer API recovery admission is unavailable.',
		{
			retryable: true,
			action: 'wait-and-retry',
			details: { reasonCode },
		},
	);
}

function validateMutationInput(
	value: unknown,
	requiredKeys: readonly string[],
	allowedKeys: readonly string[],
): StructuredErrorV1 | undefined {
	try {
		if (
			!isPlainRecord(value)
			|| !hasOnlyAllowedKeys(value, allowedKeys)
			|| requiredKeys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
		) {
			return structuredErrorV1(
				'invalid-request',
				'Developer API mutation input contains unsupported or host-owned fields.',
			);
		}
		freezeDto(value);
	} catch {
		return structuredErrorV1(
			'invalid-request',
			'Developer API mutation input must be a structured-cloneable Runtime V1 DTO.',
		);
	}
	return undefined;
}

function validateRecoveryInput(
	value: unknown,
): StructuredErrorV1 | undefined {
	const structural = validateMutationInput(value, [], RECOVERY_INPUT_KEYS_V1);
	if (structural) return structural;
	if (!isPlainRecord(value)) {
		return structuredErrorV1('invalid-request', 'Recovery input must be an object.');
	}
	const keys = Object.keys(value);
	const hasPlan = keys.includes('plan');
	const hasRecoveryRef = keys.includes('recoveryRef');
	if (hasPlan === hasRecoveryRef) {
		return structuredErrorV1(
			'invalid-request',
			'Recovery requires exactly one of plan or recoveryRef.',
		);
	}
	if (
		hasRecoveryRef
		&& (
			typeof value.recoveryRef !== 'string'
			|| !/^dvr1_[0-9a-f]{48}$/u.test(value.recoveryRef)
		)
	) {
		return structuredErrorV1(
			'invalid-request',
			'The Developer API recovery reference is malformed.',
		);
	}
	return undefined;
}

function unavailableFreshness() {
	return {
		source: 'live-runtime' as const,
		coherence: 'unverified' as const,
		observedAt: new Date().toISOString(),
		settled: false,
	};
}

function safeLifecyclePhase(
	options: OperonDeveloperApiRuntimeOptionsV1,
): RuntimeLifecyclePhaseV1 | undefined {
	try {
		return options.lifecyclePhase();
	} catch {
		return undefined;
	}
}

function createDeveloperSessionId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return `developer-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some(key => typeof key !== 'string')) return false;
	const actual = (ownKeys as string[]).sort();
	const sortedExpected = [...expected].sort();
	return actual.length === sortedExpected.length
		&& actual.every((key, index) => key === sortedExpected[index]);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const allowedSet = new Set(allowed);
	return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowedSet.has(key));
}

function isSafePositiveInteger(value: unknown): value is number {
	return typeof value === 'number'
		&& Number.isSafeInteger(value)
		&& value >= 1;
}

function readStringProperty(value: unknown, key: string): string | undefined {
	try {
		if (typeof value !== 'object' || value === null) return undefined;
		const candidate = (value as Record<string, unknown>)[key];
		return typeof candidate === 'string' ? candidate : undefined;
	} catch {
		return undefined;
	}
}

function readContextProjection(value: unknown): ContextRequestV1['projection'] {
	const projection = readStringProperty(value, 'projection');
	switch (projection) {
		case 'task-neighborhood':
		case 'project-analysis':
		case 'planning-workload':
		case 'creation-context':
		case 'mutation-preview':
		case 'placement-candidates':
			return projection;
		default:
			return 'exact-task';
	}
}

function freezeDto<T>(value: T): T {
	const clone = structuredClone(value);
	deepFreeze(clone, new WeakSet<object>());
	return clone;
}

function freezeApiStructure<T>(value: T): T {
	deepFreeze(value, new WeakSet<object>());
	return value;
}

function deepFreeze(value: unknown, visited: WeakSet<object>): void {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
	if (visited.has(value)) return;
	visited.add(value);
	for (const child of Object.values(value)) deepFreeze(child, visited);
	Object.freeze(value);
}
