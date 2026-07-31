import {
	CAPABILITY_REGISTRY_V1,
	type CapabilityAdvertisementV1,
	type CapabilityAvailabilityV1,
	type CapabilityIdV1,
	isCapabilityIdV1,
	MUTATION_CAPABILITY_MAP_V1,
} from '../contracts/v1/capabilities';
import {
	type CatalogRequestV1,
	type OperonCatalogV1,
} from '../contracts/v1/catalog';
import {
	type ContextPackV1,
	type ContextRequestV1,
	type EntityResolutionResultV1,
	type EntityResolveRequestV1,
	type RelationshipRequestV1,
	type RelationshipResultV1,
	type TaskGetRequestV1,
	type TaskGetResultV1,
	type TaskFinderRequestV1,
	type TaskFinderResultV1,
	type TaskQueryRequestV1,
	type TaskQueryResultV1,
} from '../contracts/v1/context';
import type {
	RuntimeDiagnosticsV1,
	RuntimeTransportDiagnosticsV1,
} from '../contracts/v1/lifecycle';
import {
	CONTRACT_VERSION_V1,
	structuredErrorV1,
	type CompatibilityOfferV1,
} from '../contracts/v1/primitives';
import {
	RUNTIME_API_VERSION_V1,
	type RuntimeHealthV1,
	type V8PersistencePhaseV1,
} from '../contracts/v1/lifecycle';
import type {
	MutationApplyRequestV1,
	MutationPreviewRequestV1,
	MutationPreviewResultV1,
	MutationResultV1,
} from '../contracts/v1/mutation';
import type { TimerReadRequestV1, TimerReadResultV1 } from '../contracts/v1/timer';
import {
	validateRuntimeMutationApplyRequestV1,
	validateRuntimeMutationPreviewRequestV1,
} from './mutation-request-validator';
import { RuntimeLifecycleCoordinatorV1 } from './lifecycle';
import { cloneRuntimeRevisionV1 } from './revision';
import {
	type OperonAgentRuntimeCoreV1,
	type RuntimeInvocationContextV1,
	type RuntimeRevisionSnapshotV1,
} from './types';
import {
	validateContextRequestV1,
	validateEntityResolveRequestV1,
	validateRelationshipRequestV1,
	validateTaskGetRequestV1,
	validateTaskFinderRequestV1,
	validateTaskQueryRequestV1,
	validateTimerReadRequestV1,
} from './context-request-validator';

const COMPATIBILITY_V1: CompatibilityOfferV1 = Object.freeze({
	contractVersion: CONTRACT_VERSION_V1,
	runtimeApi: Object.freeze({ min: 1, max: 1 }),
});

export interface RuntimeFacadePortsV1 {
	beforeHealth?(): Promise<void>;
	persistencePhase(): V8PersistencePhaseV1;
	revision(): Promise<RuntimeRevisionSnapshotV1 | undefined> | RuntimeRevisionSnapshotV1 | undefined;
	observedAt?(): string;
	nativeCliTransportAvailable?(): boolean;
	transportDiagnostics?(): RuntimeTransportDiagnosticsV1 | undefined;
	capabilityAvailability?(capability: CapabilityIdV1): {
		availability: CapabilityAvailabilityV1;
		reason?: string;
	} | undefined;
	catalogSnapshot?(request: CatalogRequestV1, context?: RuntimeInvocationContextV1): Promise<OperonCatalogV1>;
	resolveEntity?(request: EntityResolveRequestV1, context?: RuntimeInvocationContextV1): Promise<EntityResolutionResultV1>;
	getTask?(request: TaskGetRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskGetResultV1>;
	queryTasks?(request: TaskQueryRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskQueryResultV1>;
	findTasks?(request: TaskFinderRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskFinderResultV1>;
	getRelationships?(request: RelationshipRequestV1, context?: RuntimeInvocationContextV1): Promise<RelationshipResultV1>;
	buildContext?(request: ContextRequestV1, context?: RuntimeInvocationContextV1): Promise<ContextPackV1>;
	readTimer?(request: TimerReadRequestV1, context?: RuntimeInvocationContextV1): Promise<TimerReadResultV1>;
	previewMutation?(request: MutationPreviewRequestV1, context?: RuntimeInvocationContextV1): Promise<MutationPreviewResultV1>;
	applyMutation?(request: MutationApplyRequestV1): Promise<MutationResultV1>;
}

export function createOperonAgentRuntimeFacadeV1(
	lifecycle: RuntimeLifecycleCoordinatorV1,
	ports: RuntimeFacadePortsV1,
): OperonAgentRuntimeCoreV1 {
	const capabilities = (): CapabilityAdvertisementV1[] => CAPABILITY_REGISTRY_V1.map(definition => {
		if (lifecycle.getPhase() === 'unloading' && definition.id !== 'system.health') {
			return {
				id: definition.id,
				availability: 'unavailable',
				stability: 'stable',
				reason: 'Runtime admission is closed because Operon is unloading.',
			};
		}
		let override: ReturnType<NonNullable<RuntimeFacadePortsV1['capabilityAvailability']>>;
		try {
			override = ports.capabilityAvailability?.(definition.id);
		} catch {
			return {
				id: definition.id,
				availability: 'unavailable',
				stability: 'stable',
				reason: 'Runtime capability availability could not be evaluated.',
			};
		}
		if (override) {
			return {
				id: definition.id,
				availability: override.availability,
				stability: 'stable',
				...(override.reason ? { reason: override.reason } : {}),
			};
		}
		if (
			definition.id === 'system.health'
			|| definition.id === 'system.capabilities'
			|| definition.id === 'system.diagnostics'
		) {
			return { id: definition.id, availability: 'available', stability: 'stable' };
		}
		return {
			id: definition.id,
			availability: 'contract-only',
			stability: 'stable',
			reason: 'The V1 contract is defined, but this capability has not passed its Runtime parity gate.',
		};
	});

	const hasCapability = (name: string): boolean => {
		if (!isCapabilityIdV1(name)) return false;
		const capability = capabilities().find(candidate => candidate.id === name);
		return capability?.availability === 'available' || capability?.availability === 'degraded';
	};

	const health = async (): Promise<RuntimeHealthV1> => {
		if (lifecycle.getPhase() !== 'unloading') {
			try {
				await ports.beforeHealth?.();
				lifecycle.clearError('health-freshness');
			} catch {
				lifecycle.recordError(structuredErrorV1(
					'internal-error',
					'Runtime freshness could not be verified before health was sampled.',
					{ retryable: true },
				), 'health-freshness');
			}
		}
		let revision: RuntimeRevisionSnapshotV1 | undefined;
		try {
			const sampled = await ports.revision();
			revision = sampled ? cloneRuntimeRevisionV1(sampled) : undefined;
			lifecycle.clearError('health-revision');
		} catch {
			lifecycle.recordError(structuredErrorV1(
				'internal-error',
				'Runtime component revisions could not be sampled.',
				{ retryable: true },
			), 'health-revision');
		}
		let persistencePhase: V8PersistencePhaseV1 = 'recovery-required';
		try {
			persistencePhase = ports.persistencePhase();
			lifecycle.clearError('health-persistence');
		} catch {
			lifecycle.recordError(structuredErrorV1(
				'internal-error',
				'V8 persistence state could not be sampled.',
				{ retryable: true },
			), 'health-persistence');
		}
		const phase = lifecycle.getPhase();
		const capabilitySnapshot = capabilities();
		const readAvailable = lifecycle.isReadAvailable();
		const writeAvailable = lifecycle.isWriteAvailable();
		const lastError = lifecycle.getLastError();
		const retryAfterMs = lifecycle.getRetryAfterMs();
		const base = {
			apiVersion: RUNTIME_API_VERSION_V1,
			contractVersion: CONTRACT_VERSION_V1,
			lifecyclePhase: phase,
			v8PersistencePhase: persistencePhase,
			compatibility: cloneCompatibility(),
			capabilities: capabilitySnapshot,
			freshness: {
				source: 'live-runtime' as const,
				coherence: lastError
					? 'unverified' as const
					: phase === 'ready'
						? 'verified' as const
						: readAvailable ? 'settling' as const : 'unverified' as const,
				observedAt: observeNow(ports),
				settled: phase === 'ready' && !lastError,
			},
			...(revision ? { contextRevision: revision.contextRevision } : {}),
			admission: {
				reads: readAvailable,
				writes: writeAvailable,
			},
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
			warnings: [],
		};
		return lastError
			? { ...base, ok: false, error: lastError }
			: { ...base, ok: true };
	};

	const catalogSnapshot = async (
		request?: CatalogRequestV1,
		context?: RuntimeInvocationContextV1,
	): Promise<OperonCatalogV1> => {
		const rawRequest: unknown = request ?? {
			contractVersion: CONTRACT_VERSION_V1,
			requestId: createCatalogRequestId(),
			kind: 'catalog',
			consistency: 'live-verified',
		};
		if (!isCatalogRequestV1(rawRequest)) {
			return catalogFailure(
				readCatalogRequestId(rawRequest),
				'invalid-request',
				'The Property Catalog request does not match the V1 contract.',
				false,
				ports,
				lifecycle,
			);
		}
		const normalizedRequest = rawRequest;
		const availability = capabilities().find(item => item.id === 'catalog.read');
		if (
			!ports.catalogSnapshot
			|| (availability?.availability !== 'available' && availability?.availability !== 'degraded')
		) {
			return catalogFailure(
				normalizedRequest.requestId,
				'capability-unavailable',
				'The live Property Catalog has not passed its Runtime publication gate.',
				false,
				ports,
				lifecycle,
			);
		}
		try {
			return await ports.catalogSnapshot(normalizedRequest, context);
		} catch {
			return catalogFailure(
				normalizedRequest.requestId,
				'internal-error',
				'The live Property Catalog could not be produced.',
				true,
				ports,
				lifecycle,
			);
		}
	};

	const resolveEntity = async (request: EntityResolveRequestV1, context?: RuntimeInvocationContextV1): Promise<EntityResolutionResultV1> => {
		const decoded = validateEntityResolveRequestV1(request);
		if (!decoded.ok) return readFailure('entity-resolution-result', request, ports, 'invalid-request');
		if (!ports.resolveEntity || !isPublished('entities.resolve')) {
			return readFailure('entity-resolution-result', decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.resolveEntity(decoded.value, context);
		} catch {
			return readFailure('entity-resolution-result', decoded.value, ports, 'internal-error');
		}
	};

	const getTask = async (request: TaskGetRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskGetResultV1> => {
		const decoded = validateTaskGetRequestV1(request);
		if (!decoded.ok) return readFailure('task-get-result', request, ports, 'invalid-request');
		if (!ports.getTask || !isPublished('tasks.read')) {
			return readFailure('task-get-result', decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.getTask(decoded.value, context);
		} catch {
			return readFailure('task-get-result', decoded.value, ports, 'internal-error');
		}
	};

	const queryTasks = async (request: TaskQueryRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskQueryResultV1> => {
		const decoded = validateTaskQueryRequestV1(request);
		if (!decoded.ok) return readFailure('task-query-result', request, ports, 'invalid-request');
		if (!ports.queryTasks || !isPublished('tasks.query')) {
			return readFailure('task-query-result', decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.queryTasks(decoded.value, context);
		} catch {
			return readFailure('task-query-result', decoded.value, ports, 'internal-error');
		}
	};

	const findTasks = async (request: TaskFinderRequestV1, context?: RuntimeInvocationContextV1): Promise<TaskFinderResultV1> => {
		const decoded = validateTaskFinderRequestV1(request);
		if (!decoded.ok) return readFailure('task-finder-result', request, ports, 'invalid-request');
		if (!ports.findTasks || !isPublished('tasks.finder')) {
			return readFailure('task-finder-result', decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.findTasks(decoded.value, context);
		} catch {
			return readFailure('task-finder-result', decoded.value, ports, 'internal-error');
		}
	};

	const getRelationships = async (request: RelationshipRequestV1, context?: RuntimeInvocationContextV1): Promise<RelationshipResultV1> => {
		const decoded = validateRelationshipRequestV1(request);
		if (!decoded.ok) return readFailure('relationship-result', request, ports, 'invalid-request');
		if (!ports.getRelationships || !isPublished('relationships.read')) {
			return readFailure('relationship-result', decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.getRelationships(decoded.value, context);
		} catch {
			return readFailure('relationship-result', decoded.value, ports, 'internal-error');
		}
	};

	const buildContext = async (request: ContextRequestV1, context?: RuntimeInvocationContextV1): Promise<ContextPackV1> => {
		const decoded = validateContextRequestV1(request);
		if (!decoded.ok) return contextReadFailure(request, ports, 'invalid-request');
		if (!ports.buildContext || !isPublished('context.build')) {
			return contextReadFailure(decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.buildContext(decoded.value, context);
		} catch {
			return contextReadFailure(decoded.value, ports, 'internal-error');
		}
	};

	const readTimer = async (request: TimerReadRequestV1, context?: RuntimeInvocationContextV1): Promise<TimerReadResultV1> => {
		const decoded = validateTimerReadRequestV1(request);
		if (!decoded.ok) return timerReadFailure(request, ports, 'invalid-request');
		if (!ports.readTimer || !isPublished('timers.read')) {
			return timerReadFailure(decoded.value, ports, 'capability-unavailable');
		}
		try {
			return await ports.readTimer(decoded.value, context);
		} catch {
			return timerReadFailure(decoded.value, ports, 'internal-error');
		}
	};

	const previewMutation = async (
		request: MutationPreviewRequestV1,
		context?: RuntimeInvocationContextV1,
	): Promise<MutationPreviewResultV1> => {
		const decoded = validateRuntimeMutationPreviewRequestV1(request);
		if (!decoded.ok) return mutationPreviewFacadeFailure(request, 'invalid-request');
		const capability = MUTATION_CAPABILITY_MAP_V1[decoded.value.mutationKind]?.preview;
		if (!capability || !ports.previewMutation || !isPublished(capability)) {
			return mutationPreviewFacadeFailure(decoded.value, 'capability-unavailable');
		}
		try {
			return await ports.previewMutation(decoded.value, context);
		} catch {
			return mutationPreviewFacadeFailure(decoded.value, 'internal-error');
		}
	};

	const applyMutation = async (
		request: MutationApplyRequestV1,
	): Promise<MutationResultV1> => {
		const decoded = validateRuntimeMutationApplyRequestV1(request, Date.now(), { allowExpired: true });
		if (!decoded.ok) return mutationApplyFacadeFailure(request, 'invalid-request');
		const capability = MUTATION_CAPABILITY_MAP_V1[decoded.value.plan.mutationKind]?.apply;
		if (!capability || !ports.applyMutation || !isPublished(capability)) {
			return mutationApplyFacadeFailure(decoded.value, 'capability-unavailable');
		}
		try {
			return await ports.applyMutation(decoded.value);
		} catch {
			return mutationApplyFacadeFailure(decoded.value, 'internal-error');
		}
	};

	const diagnostics = async (): Promise<RuntimeDiagnosticsV1> => {
		const healthSnapshot = await health();
		const capabilitySnapshot = capabilities();
		let catalogSummary: RuntimeDiagnosticsV1['catalog'];
		if (ports.catalogSnapshot && isPublished('catalog.read') && lifecycle.isReadAvailable()) {
			try {
				const catalogResult = await ports.catalogSnapshot({
					contractVersion: CONTRACT_VERSION_V1,
					requestId: `diagnostics-${Date.now().toString(36)}`,
					kind: 'catalog',
					consistency: 'best-effort',
				});
				if (catalogResult.ok) {
					catalogSummary = {
						catalogRevision: catalogResult.catalogRevision,
						settingsFingerprint: catalogResult.settingsFingerprint,
						fieldCount: catalogResult.fields.length,
						pipelineCount: catalogResult.taxonomy.pipelines.length,
						priorityCount: catalogResult.taxonomy.priorities.length,
					};
				}
			} catch {
				// Diagnostics remains useful when catalog projection is temporarily unavailable.
			}
		}
		const transportSummary = ports.transportDiagnostics?.();
		return {
			contractVersion: CONTRACT_VERSION_V1,
			kind: 'runtime-diagnostics',
			health: healthSnapshot,
			capabilities: capabilitySnapshot,
			...(catalogSummary ? { catalog: catalogSummary } : {}),
			...(transportSummary ? { transport: transportSummary } : {}),
			warnings: [],
		};
	};

	const system = Object.freeze({
		health,
		capabilities,
		diagnostics,
	});
	const catalog = Object.freeze({
		snapshot: catalogSnapshot,
	});
	const entities = Object.freeze({ resolve: resolveEntity });
	const tasks = Object.freeze({ get: getTask, query: queryTasks, find: findTasks });
	const relationships = Object.freeze({ get: getRelationships });
	const context = Object.freeze({ build: buildContext });
	const timers = Object.freeze({ read: readTimer });
	const mutations = Object.freeze({ preview: previewMutation, apply: applyMutation });
	return Object.freeze({
		apiVersion: RUNTIME_API_VERSION_V1,
		hasCapability,
		system,
		catalog,
		entities,
		tasks,
		relationships,
		context,
		timers,
		mutations,
	});

	function isPublished(
		capability: CapabilityIdV1,
	): boolean {
		const advertisement = capabilities().find(item => item.id === capability);
		return advertisement?.availability === 'available' || advertisement?.availability === 'degraded';
	}
}

function timerReadFailure(
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): TimerReadResultV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readRequestId(request) ?? 'invalid-request',
		kind: 'timer-read-result',
		ok: false,
		freshness: {
			source: 'live-runtime',
			coherence: 'unverified',
			observedAt: observeNow(ports),
			settled: false,
		},
		warnings: [],
		error: structuredErrorV1(code, readFailureReason(code), {
			retryable: code === 'internal-error',
		}),
	};
}

function mutationPreviewFacadeFailure(
	request: unknown,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): MutationPreviewResultV1 {
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readRequestId(request) ?? 'invalid-request',
		kind: 'mutation-preview-result',
		ok: false,
		warnings: [],
		error: structuredErrorV1(code, readFailureReason(code), {
			retryable: code === 'internal-error',
		}),
	};
}

function mutationApplyFacadeFailure(
	request: unknown,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): MutationResultV1 {
	const outcomeUncertain = code === 'internal-error';
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readRequestId(request) ?? 'invalid-request',
		kind: 'mutation-result',
		status: outcomeUncertain ? 'outcome-unknown' : 'failed',
		mutationMayHaveApplied: outcomeUncertain,
		retryAllowed: false,
		groupResults: [],
		...(outcomeUncertain ? { ambiguitySource: 'group-outcome' as const } : {}),
		error: structuredErrorV1(
			outcomeUncertain ? 'outcome-unknown' : code,
			outcomeUncertain
				? 'Mutation execution may have begun before an internal Runtime failure.'
				: readFailureReason(code),
			{ retryable: false },
		),
	};
}

type NonContextReadResultKindV1 =
	| 'entity-resolution-result'
	| 'task-get-result'
	| 'task-query-result'
	| 'task-finder-result'
	| 'relationship-result';

function readFailure(
	kind: 'entity-resolution-result',
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): EntityResolutionResultV1;
function readFailure(
	kind: 'task-get-result',
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): TaskGetResultV1;
function readFailure(
	kind: 'task-query-result',
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): TaskQueryResultV1;
function readFailure(
	kind: 'task-finder-result',
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): TaskFinderResultV1;
function readFailure(
	kind: 'relationship-result',
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): RelationshipResultV1;
function readFailure(
	kind: NonContextReadResultKindV1,
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): EntityResolutionResultV1 | TaskGetResultV1 | TaskQueryResultV1 | TaskFinderResultV1 | RelationshipResultV1 {
	const base = {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readRequestId(request) ?? 'invalid-request',
		kind,
		ok: false as const,
		freshness: unavailableFreshness(ports),
		warnings: [],
		error: structuredErrorV1(code, readFailureReason(code), {
			retryable: code === 'internal-error',
		}),
	};
	switch (kind) {
		case 'entity-resolution-result': return base;
		case 'task-get-result': return base;
		case 'task-query-result': return base;
		case 'task-finder-result': return base;
		case 'relationship-result': return base;
	}
}

function contextReadFailure(
	request: unknown,
	ports: RuntimeFacadePortsV1,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): ContextPackV1 {
	const record = isPlainRecord(request) ? request : {};
	const purpose = ['read', 'analysis', 'planning', 'creation', 'mutation-readiness'].includes(String(record.purpose))
		? record.purpose as ContextPackV1['purpose']
		: 'read';
	const projection = [
		'exact-task',
		'task-neighborhood',
		'project-analysis',
		'planning-workload',
		'creation-context',
		'mutation-preview',
	].includes(String(record.projection))
		? record.projection as ContextPackV1['projection']
		: 'exact-task';
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: readRequestId(request) ?? 'invalid-request',
		kind: 'context-pack',
		ok: false,
		purpose,
		projection,
		warnings: [],
		error: structuredErrorV1(code, readFailureReason(code), {
			retryable: code === 'internal-error',
		}),
	};
}

function unavailableFreshness(ports: RuntimeFacadePortsV1) {
	return {
		source: 'live-runtime' as const,
		coherence: 'unverified' as const,
		observedAt: observeNow(ports),
		settled: false,
	};
}

function readRequestId(value: unknown): string | undefined {
	if (!isPlainRecord(value)) return undefined;
	return isValidCatalogRequestId(value.requestId) ? value.requestId : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return !!value
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function readFailureReason(
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
): string {
	if (code === 'invalid-request') return 'The request does not match the strict V1 contract.';
	if (code === 'capability-unavailable') return 'The Runtime capability has not passed its publication gate.';
	return 'The Runtime operation could not be completed.';
}

function readCatalogRequestId(value: unknown): string | undefined {
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
		const requestId = (value as Record<string, unknown>).requestId;
		return isValidCatalogRequestId(requestId) ? requestId : undefined;
	} catch {
		return undefined;
	}
}

function isCatalogRequestV1(value: unknown): value is CatalogRequestV1 {
	try {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		if (Object.getPrototypeOf(value) !== Object.prototype) return false;
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record);
		if (
			keys.length !== 4
			|| !keys.every(key => ['contractVersion', 'requestId', 'kind', 'consistency'].includes(key))
		) return false;
		return record.contractVersion === CONTRACT_VERSION_V1
			&& isValidCatalogRequestId(record.requestId)
			&& record.kind === 'catalog'
			&& ['live-verified', 'best-effort', 'offline-unverified'].includes(String(record.consistency));
	} catch {
		return false;
	}
}

function isValidCatalogRequestId(value: unknown): value is string {
	return typeof value === 'string'
		&& /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
		&& new TextEncoder().encode(value).byteLength <= 128;
}

function cloneCompatibility(): CompatibilityOfferV1 {
	return {
		contractVersion: COMPATIBILITY_V1.contractVersion,
		runtimeApi: { ...COMPATIBILITY_V1.runtimeApi },
	};
}

function observeNow(ports: RuntimeFacadePortsV1): string {
	try {
		return ports.observedAt?.() ?? new Date().toISOString();
	} catch {
		return new Date().toISOString();
	}
}

function createCatalogRequestId(): string {
	return `catalog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function catalogFailure(
	requestId: string | undefined,
	code: 'invalid-request' | 'capability-unavailable' | 'internal-error',
	reason: string,
	retryable: boolean,
	ports: RuntimeFacadePortsV1,
	lifecycle: RuntimeLifecycleCoordinatorV1,
): OperonCatalogV1 {
	const phase = lifecycle.getPhase();
	return {
		contractVersion: CONTRACT_VERSION_V1,
		requestId: isValidCatalogRequestId(requestId)
			? requestId
			: createCatalogRequestId(),
		kind: 'catalog-result',
		ok: false,
		freshness: {
			source: 'live-runtime',
			coherence: phase === 'ready' ? 'verified' : phase === 'settling' || phase === 'cache-ready'
				? 'settling'
				: 'unverified',
			observedAt: observeNow(ports),
			settled: phase === 'ready',
		},
		warnings: [],
		error: structuredErrorV1(code, reason, { retryable }),
	};
}
