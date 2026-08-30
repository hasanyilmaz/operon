import type {
	ContextPackV1,
	ContextRequestV1,
	EntityResolutionResultV1,
	EntityResolveRequestV1,
	RelationshipRequestV1,
	RelationshipResultV1,
	TaskFinderRequestV1,
	TaskFinderResultV1,
} from '../../contracts/v1/context';
import {
	decodeContextPackV1,
	decodeContextRequestV1,
	decodeEntityResolutionResultV1,
	decodeEntityResolveRequestV1,
	decodeRelationshipRequestV1,
	decodeRelationshipResultV1,
	decodeRuntimeDiagnosticsV1,
	decodeTaskFinderRequestV1,
	decodeTaskFinderResultV1,
	decodeTimerReadRequestV1,
	decodeTimerReadResultV1,
} from '../../contracts/v1/decode';
import type { RuntimeDiagnosticsV1, RuntimeLifecyclePhaseV1 } from '../../contracts/v1/lifecycle';
import { structuredErrorV1, type StructuredErrorV1 } from '../../contracts/v1/primitives';
import type { TimerReadRequestV1, TimerReadResultV1 } from '../../contracts/v1/timer';
import type { DeveloperApiGrantControllerV1 } from '../../developer-api/grant-controller';
import type { DeveloperApiConsumerDescriptorV1 } from '../../developer-api/grants';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import {
	isReadProjectionDeveloperCapabilityIdV1,
	READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1,
	READ_PROJECTION_RUNTIME_CAPABILITY_BY_GRANT_V1,
} from './contracts';
import type {
	OperonReadProjectionDeveloperApiV1,
	ReadProjectionDeveloperAccessCapabilityV1,
	ReadProjectionDeveloperApiAccessRequestV1,
	ReadProjectionDeveloperApiAccessResultV1,
	ReadProjectionDeveloperCapabilitySubsetV1,
} from './public-contract';

export type {
	OperonReadProjectionDeveloperApiAccessorV1,
	OperonReadProjectionDeveloperApiV1,
	ReadProjectionDeveloperAccessCapabilityV1,
	ReadProjectionDeveloperApiAccessRequestV1,
	ReadProjectionDeveloperApiAccessResultV1,
	ReadProjectionDeveloperCapabilitySubsetV1,
} from './public-contract';

/**
 * The native Runtime facade deliberately remains private. This extension is a
 * second public boundary for integrations that need the six read DTOs used by
 * project analysis, without receiving an open-ended Runtime object.
 */
const ACCESS_CAPABILITIES_V1 = READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1;

export interface ReadProjectionDeveloperApiRuntimeOptionsV1 {
	readonly isDesktopAvailable: () => boolean;
	readonly isHostVersionSupported: () => boolean;
	readonly lifecyclePhase: () => RuntimeLifecyclePhaseV1;
	readonly isCoreActive: (core: OperonAgentRuntimeCoreV1) => boolean;
	readonly grantController: Pick<
		DeveloperApiGrantControllerV1,
		'verifyConsumer' | 'isConsumerCurrent' | 'evaluate' | 'recordPending'
	>;
}

/**
 * Additive accessor: it never changes, delegates to, or widens
 * getDeveloperApiV1(). Read results are decoded, bound to their request id,
 * then reconstructed as a strict public snapshot before crossing this seam.
 */
export function getOperonReadProjectionDeveloperApiV1<
	TCapabilities extends ReadProjectionDeveloperCapabilitySubsetV1,
>(
	core: OperonAgentRuntimeCoreV1 | null,
	consumerPlugin: OperonDeveloperApiConsumerPluginV1,
	request: ReadProjectionDeveloperApiAccessRequestV1<TCapabilities>,
	options: ReadProjectionDeveloperApiRuntimeOptionsV1,
): ReadProjectionDeveloperApiAccessResultV1<TCapabilities> {
	const decoded = decodeAccessRequest(request);
	if (!decoded) return failure('invalid-request', 'The read-projection Developer API access request is invalid.');
	try {
		if (!options.isDesktopAvailable() || !options.isHostVersionSupported()) {
			return failure('unsupported-platform', 'The read-projection Developer API requires supported Obsidian Desktop.');
		}
		if (!core || !options.isCoreActive(core)) {
			return failure('handler-unavailable', 'The Operon Runtime facade is unavailable.');
		}
		if (decoded.runtimeApi.min > 1 || decoded.runtimeApi.max < 1) {
			return failure('unsupported-version', 'The requested Runtime API range does not include V1.');
		}
		const consumer = options.grantController.verifyConsumer(consumerPlugin);
		if (!consumer) return failure('authority-insufficient', 'The Developer API consumer is not the active host plugin instance.');
		const grant = options.grantController.evaluate(consumer, decoded.requestedCapabilities);
		if (grant.state !== 'active') {
			if (grant.state === 'pending') options.grantController.recordPending(consumer, decoded.requestedCapabilities);
			return failure('authority-insufficient', 'The requested read-projection capability set requires an active exact-capability grant.');
		}
		if (options.lifecyclePhase() !== 'ready') {
			return failure('live-settling', 'The Operon Runtime is not ready.', true);
		}
		for (const capability of decoded.requestedCapabilities) {
			const runtimeCapability = READ_PROJECTION_RUNTIME_CAPABILITY_BY_GRANT_V1[capability];
			const advertised = core.system.capabilities().find(item => item.id === runtimeCapability);
			if (!advertised || (advertised.availability !== 'available' && advertised.availability !== 'degraded')) {
				return failure('capability-unavailable', `The read-projection Developer API capability is unavailable: ${capability}.`);
			}
		}
		return freezeStructure({
			contractVersion: 1,
			kind: 'read-projection-developer-api-access-result',
			ok: true,
			api: createSession(core, consumer, decoded.requestedCapabilities, options),
		});
	} catch {
		return failure('handler-unavailable', 'The read-projection Developer API accessor is unavailable.');
	}
}

function createSession<
	TCapabilities extends ReadProjectionDeveloperCapabilitySubsetV1,
>(
	core: OperonAgentRuntimeCoreV1,
	consumer: DeveloperApiConsumerDescriptorV1,
	requested: TCapabilities,
	options: ReadProjectionDeveloperApiRuntimeOptionsV1,
): OperonReadProjectionDeveloperApiV1<TCapabilities> {
	const requestedSet = new Set<ReadProjectionDeveloperAccessCapabilityV1>(requested);
	const active = (capability: ReadProjectionDeveloperAccessCapabilityV1): boolean => {
		try {
			const runtimeCapability = READ_PROJECTION_RUNTIME_CAPABILITY_BY_GRANT_V1[capability];
			return requestedSet.has(capability)
				&& options.isCoreActive(core)
				&& options.grantController.isConsumerCurrent(consumer)
				&& options.lifecyclePhase() === 'ready'
				&& core.hasCapability(runtimeCapability)
				&& options.grantController.evaluate(consumer, requested).effectiveCapabilities.includes(capability);
		} catch {
			return false;
		}
	};
	const api: Record<string, unknown> = {
		contractVersion: 1,
		runtimeApi: 1,
		hasCapability: (capability: string) => (
			isReadProjectionCapability(capability) && active(capability)
		),
		system: {},
		tasks: {},
		entities: {},
		relationships: {},
		context: {},
		timers: {},
	};
	const system = api.system as Record<string, unknown>;
	const tasks = api.tasks as Record<string, unknown>;
	const entities = api.entities as Record<string, unknown>;
	const relationships = api.relationships as Record<string, unknown>;
	const context = api.context as Record<string, unknown>;
	const timers = api.timers as Record<string, unknown>;
	if (requestedSet.has('read-projection.system.diagnostics')) {
		system.diagnostics = async (): Promise<RuntimeDiagnosticsV1> => {
			if (!active('read-projection.system.diagnostics')) return diagnosticsFailure('authority-insufficient', 'The read-projection diagnostics capability is not active for this session.');
			try {
				const projected = projectRuntimeDiagnosticsV1(await core.system.diagnostics());
				if (!active('read-projection.system.diagnostics')) return diagnosticsFailure('authority-insufficient', 'The read-projection diagnostics capability is no longer active for this session.');
				return projected ?? diagnosticsFailure('handler-unavailable', 'Operon returned an invalid diagnostics DTO.');
			} catch {
				if (!active('read-projection.system.diagnostics')) return diagnosticsFailure('authority-insufficient', 'The read-projection diagnostics capability is no longer active for this session.');
				return diagnosticsFailure('handler-unavailable', 'Operon diagnostics are unavailable.');
			}
		};
	}
	if (requestedSet.has('read-projection.tasks.finder')) {
		tasks.find = (request: TaskFinderRequestV1): Promise<TaskFinderResultV1> => runRead(
			request,
			'task-finder-result',
			() => active('read-projection.tasks.finder'),
			decodeTaskFinderRequestV1,
			read => core.tasks.find(read),
			projectTaskFinderResultV1,
		);
	}
	if (requestedSet.has('read-projection.entities.resolve')) {
		entities.resolve = (request: EntityResolveRequestV1): Promise<EntityResolutionResultV1> => runRead(
			request,
			'entity-resolution-result',
			() => active('read-projection.entities.resolve'),
			decodeEntityResolveRequestV1,
			read => core.entities.resolve(read),
			projectEntityResolutionResultV1,
		);
	}
	if (requestedSet.has('read-projection.relationships.read')) {
		relationships.get = (request: RelationshipRequestV1): Promise<RelationshipResultV1> => runRead(
			request,
			'relationship-result',
			() => active('read-projection.relationships.read'),
			decodeRelationshipRequestV1,
			read => core.relationships.get(read),
			projectRelationshipResultV1,
		);
	}
	if (requestedSet.has('read-projection.context.build')) {
		context.build = (request: ContextRequestV1): Promise<ContextPackV1> => runContextRead(
			request,
			() => active('read-projection.context.build'),
			read => core.context.build(read),
		);
	}
	if (requestedSet.has('read-projection.timers.read')) {
		timers.read = (request: TimerReadRequestV1): Promise<TimerReadResultV1> => runRead(
			request,
			'timer-read-result',
			() => active('read-projection.timers.read'),
			decodeTimerReadRequestV1,
			read => core.timers.read(read),
			projectTimerReadResultV1,
		);
	}
	return freezeStructure(api) as OperonReadProjectionDeveloperApiV1<TCapabilities>;
}

async function runRead<TRequest extends { readonly requestId: string }, TResult extends { readonly requestId: string }>(
	request: unknown,
	kind: string,
	admitted: () => boolean,
	decodeRequest: (value: unknown) => { ok: true; value: TRequest } | { ok: false },
	invoke: (request: TRequest) => Promise<TResult>,
	project: (value: unknown) => TResult | null,
): Promise<TResult> {
	const decoded = decodeRequest(request);
	const requestId = decoded.ok ? decoded.value.requestId : safeRequestId(request);
	if (!decoded.ok) return readFailure(kind, requestId, 'invalid-request', 'The read-projection request is invalid.') as TResult;
	if (!admitted()) return readFailure(kind, requestId, 'authority-insufficient', 'The requested read-projection capability is not active for this session.') as TResult;
	try {
		const projected = project(await invoke(freezeDto(decoded.value)));
		if (!admitted()) return readFailure(kind, requestId, 'authority-insufficient', 'The requested read-projection capability is no longer active for this session.') as TResult;
		if (projected && projected.requestId === requestId) return projected;
	} catch {
		if (!admitted()) return readFailure(kind, requestId, 'authority-insufficient', 'The requested read-projection capability is no longer active for this session.') as TResult;
	}
	return readFailure(kind, requestId, 'handler-unavailable', 'Operon returned an invalid read DTO.') as TResult;
}

async function runContextRead(
	request: unknown,
	admitted: () => boolean,
	invoke: (request: ContextRequestV1) => Promise<ContextPackV1>,
): Promise<ContextPackV1> {
	const decoded = decodeContextRequestV1(request);
	const requestId = decoded.ok ? decoded.value.requestId : safeRequestId(request);
	if (!decoded.ok) return contextFailure(requestId, request, 'invalid-request', 'The context request is invalid.');
	if (!admitted()) return contextFailure(requestId, decoded.value, 'authority-insufficient', 'The read-projection context capability is not active for this session.');
	try {
		const projected = projectContextPackV1(await invoke(freezeDto(decoded.value)));
		if (!admitted()) return contextFailure(requestId, decoded.value, 'authority-insufficient', 'The read-projection context capability is no longer active for this session.');
		if (projected && projected.requestId === requestId) return projected;
	} catch {
		if (!admitted()) return contextFailure(requestId, decoded.value, 'authority-insufficient', 'The read-projection context capability is no longer active for this session.');
	}
	return contextFailure(requestId, decoded.value, 'handler-unavailable', 'Operon returned an invalid context DTO.');
}

/** Context is intentionally first and explicit: it carries the widest nested read DTO. */
export function projectContextPackV1(value: unknown): ContextPackV1 | null {
	try {
		const decoded = decodeContextPackV1(value);
		if (!decoded.ok) return null;
		const source = decoded.value;
		const projected: Record<string, unknown> = {
			contractVersion: 1,
			requestId: source.requestId,
			kind: 'context-pack',
			ok: source.ok,
			purpose: source.purpose,
			projection: source.projection,
			warnings: projectWarnings(source.warnings),
		};
		if (source.ok) {
			projected.execution = projectFreshness(source.execution);
			projected.contextRevision = snapshot(source.contextRevision);
			projected.entities = snapshot(source.entities);
			projected.relationships = snapshot(source.relationships);
			projected.provenance = snapshot(source.provenance);
			projected.truncations = snapshot(source.truncations);
			if (source.catalogRevision !== undefined) projected.catalogRevision = source.catalogRevision;
			if (source.asOf !== undefined) projected.asOf = source.asOf;
			if (source.catalog !== undefined) projected.catalog = snapshot(source.catalog);
			if (source.policies !== undefined) projected.policies = snapshot(source.policies);
			if (source.resourceRevisions !== undefined) projected.resourceRevisions = snapshot(source.resourceRevisions);
			if (source.summary !== undefined) projected.summary = snapshot(source.summary);
			if (source.query !== undefined) projected.query = snapshot(source.query);
			if (source.placement !== undefined) projected.placement = snapshot(source.placement);
		} else {
			projected.error = projectStructuredError(source.error);
			if (source.contextRevision !== undefined) projected.contextRevision = snapshot(source.contextRevision);
		}
		return freezeDto(projected) as ContextPackV1;
	} catch {
		return null;
	}
}

export function projectTaskFinderResultV1(value: unknown): TaskFinderResultV1 | null {
	try {
		const decoded = decodeTaskFinderResultV1(value);
		if (!decoded.ok) return null;
		const source = decoded.value;
		const projected: Record<string, unknown> = baseReadProjection(source, 'task-finder-result');
		if (source.ok) {
			projected.contextRevision = snapshot(source.contextRevision);
			projected.rows = snapshot(source.rows);
			projected.page = snapshot(source.page);
			projected.provenance = snapshot(source.provenance);
			projected.truncations = snapshot(source.truncations);
		} else {
			projected.error = projectStructuredError(source.error);
			if (source.contextRevision !== undefined) projected.contextRevision = snapshot(source.contextRevision);
		}
		return freezeDto(projected) as unknown as TaskFinderResultV1;
	} catch {
		return null;
	}
}

export function projectEntityResolutionResultV1(value: unknown): EntityResolutionResultV1 | null {
	try {
		const decoded = decodeEntityResolutionResultV1(value);
		if (!decoded.ok) return null;
		const source = decoded.value;
		const projected: Record<string, unknown> = baseReadProjection(source, 'entity-resolution-result');
		if (source.ok) {
			projected.contextRevision = snapshot(source.contextRevision);
			projected.resolution = source.resolution;
			projected.candidates = snapshot(source.candidates);
			if (source.selected !== undefined) projected.selected = snapshot(source.selected);
		} else {
			projected.error = projectStructuredError(source.error);
			if (source.contextRevision !== undefined) projected.contextRevision = snapshot(source.contextRevision);
		}
		return freezeDto(projected) as unknown as EntityResolutionResultV1;
	} catch {
		return null;
	}
}

export function projectRelationshipResultV1(value: unknown): RelationshipResultV1 | null {
	try {
		const decoded = decodeRelationshipResultV1(value);
		if (!decoded.ok) return null;
		const source = decoded.value;
		const projected: Record<string, unknown> = baseReadProjection(source, 'relationship-result');
		if (source.ok) {
			projected.contextRevision = snapshot(source.contextRevision);
			projected.relationships = snapshot(source.relationships);
			projected.tasks = snapshot(source.tasks);
			projected.provenance = snapshot(source.provenance);
			projected.truncations = snapshot(source.truncations);
		} else {
			projected.error = projectStructuredError(source.error);
			if (source.contextRevision !== undefined) projected.contextRevision = snapshot(source.contextRevision);
		}
		return freezeDto(projected) as unknown as RelationshipResultV1;
	} catch {
		return null;
	}
}

export function projectTimerReadResultV1(value: unknown): TimerReadResultV1 | null {
	try {
		const decoded = decodeTimerReadResultV1(value);
		if (!decoded.ok) return null;
		const source = decoded.value;
		const projected: Record<string, unknown> = baseReadProjection(source, 'timer-read-result');
		if (source.ok) {
			projected.state = snapshot(source.state);
			projected.contextRevision = snapshot(source.contextRevision);
		} else {
			projected.error = projectStructuredError(source.error);
		}
		return freezeDto(projected) as unknown as TimerReadResultV1;
	} catch {
		return null;
	}
}

export function projectRuntimeDiagnosticsV1(value: unknown): RuntimeDiagnosticsV1 | null {
	try {
		const decoded = decodeRuntimeDiagnosticsV1(value);
		if (!decoded.ok) return null;
		const source = decoded.value;
		const projected: Record<string, unknown> = {
			contractVersion: 1,
			kind: 'runtime-diagnostics',
			health: projectRuntimeHealth(source.health),
			capabilities: projectCapabilityAdvertisements(source.capabilities),
			warnings: projectWarnings(source.warnings),
		};
		if (source.catalog !== undefined) {
			projected.catalog = {
				catalogRevision: source.catalog.catalogRevision,
				settingsFingerprint: source.catalog.settingsFingerprint,
				fieldCount: source.catalog.fieldCount,
				pipelineCount: source.catalog.pipelineCount,
				priorityCount: source.catalog.priorityCount,
			};
		}
		if (source.transport !== undefined) {
			const transport: Record<string, unknown> = {};
			for (const key of ['channel', 'available', 'endpointKind', 'securityBackend', 'persistentTransportAvailable', 'failureReason'] as const) {
				if (source.transport[key] !== undefined) transport[key] = source.transport[key];
			}
			projected.transport = transport;
		}
		return freezeDto(projected) as unknown as RuntimeDiagnosticsV1;
	} catch {
		return null;
	}
}

function baseReadProjection(source: {
	readonly contractVersion: number;
	readonly requestId: string;
	readonly ok: boolean;
	readonly freshness: unknown;
	readonly warnings: readonly unknown[];
}, kind: string): Record<string, unknown> {
	return {
		contractVersion: 1,
		requestId: source.requestId,
		kind,
		ok: source.ok,
		freshness: projectFreshness(source.freshness),
		warnings: projectWarnings(source.warnings),
	};
}

function projectRuntimeHealth(value: RuntimeDiagnosticsV1['health']): Record<string, unknown> {
	const projected: Record<string, unknown> = {
		apiVersion: value.apiVersion,
		contractVersion: 1,
		ok: value.ok,
		lifecyclePhase: value.lifecyclePhase,
		v8PersistencePhase: value.v8PersistencePhase,
		compatibility: snapshot({
			contractVersion: value.compatibility.contractVersion,
			runtimeApi: {
				min: value.compatibility.runtimeApi.min,
				max: value.compatibility.runtimeApi.max,
			},
		}),
		capabilities: projectCapabilityAdvertisements(value.capabilities),
		freshness: projectFreshness(value.freshness),
		admission: { reads: value.admission.reads, writes: value.admission.writes },
		warnings: projectWarnings(value.warnings),
	};
	if (value.contextRevision !== undefined) projected.contextRevision = snapshot(value.contextRevision);
	if (value.retryAfterMs !== undefined) projected.retryAfterMs = value.retryAfterMs;
	if (!value.ok) projected.error = projectStructuredError(value.error);
	return projected;
}

function projectCapabilityAdvertisements(value: readonly unknown[]): readonly Record<string, unknown>[] {
	return value.map(entry => {
		const source = entry as {
			id: string;
			availability: string;
			stability: string;
			reason?: string;
			deprecation?: { announcedIn: string; removal: string; replacement?: string };
		};
		const projected: Record<string, unknown> = {
			id: source.id,
			availability: source.availability,
			stability: source.stability,
		};
		if (source.reason !== undefined) projected.reason = source.reason;
		if (source.deprecation !== undefined) {
			projected.deprecation = {
				announcedIn: source.deprecation.announcedIn,
				removal: source.deprecation.removal,
				...(source.deprecation.replacement === undefined ? {} : { replacement: source.deprecation.replacement }),
			};
		}
		return projected;
	});
}

function projectFreshness(value: unknown): Record<string, unknown> {
	const source = value as { source: unknown; coherence: unknown; observedAt: unknown; settled: unknown };
	return {
		source: source.source,
		coherence: source.coherence,
		observedAt: source.observedAt,
		settled: source.settled,
	};
}

function projectWarnings(value: readonly unknown[]): readonly Record<string, unknown>[] {
	return value.map(entry => {
		const source = entry as { code: unknown; message: unknown; path?: unknown };
		return {
			code: source.code,
			message: source.message,
			...(source.path === undefined ? {} : { path: source.path }),
		};
	});
}

function projectStructuredError(value: StructuredErrorV1): Record<string, unknown> {
	return {
		contractVersion: 1,
		code: value.code,
		reason: value.reason,
		retryable: value.retryable,
		action: value.action,
		...(value.details === undefined ? {} : { details: snapshot(value.details) }),
	};
}

function readFailure(
	kind: string,
	requestId: string,
	code: 'invalid-request' | 'authority-insufficient' | 'handler-unavailable',
	reason: string,
): Record<string, unknown> {
	return freezeDto({
		contractVersion: 1,
		requestId,
		kind,
		ok: false,
		freshness: unavailableFreshness(),
		warnings: [],
		error: structuredErrorV1(code, reason),
	});
}

function contextFailure(
	requestId: string,
	request: unknown,
	code: 'invalid-request' | 'authority-insufficient' | 'handler-unavailable',
	reason: string,
): ContextPackV1 {
	const record = isPlainRecord(request) ? request : {};
	const purpose = isContextPurpose(record.purpose) ? record.purpose : 'read';
	const projection = isContextProjection(record.projection) ? record.projection : 'exact-task';
	return freezeDto({
		contractVersion: 1,
		requestId,
		kind: 'context-pack',
		ok: false,
		purpose,
		projection,
		warnings: [],
		error: structuredErrorV1(code, reason),
	});
}

function diagnosticsFailure(
	code: 'authority-insufficient' | 'handler-unavailable',
	reason: string,
): RuntimeDiagnosticsV1 {
	return freezeDto({
		contractVersion: 1,
		kind: 'runtime-diagnostics',
		health: {
			apiVersion: 1,
			contractVersion: 1,
			ok: false,
			lifecyclePhase: 'booting',
			v8PersistencePhase: 'idle',
			compatibility: { contractVersion: 1, runtimeApi: { min: 1, max: 1 } },
			capabilities: [],
			freshness: unavailableFreshness(),
			admission: { reads: false, writes: false },
			warnings: [],
			error: structuredErrorV1(code, reason),
		},
		capabilities: [],
		warnings: [],
	}) as unknown as RuntimeDiagnosticsV1;
}

function unavailableFreshness(): Record<string, unknown> {
	return {
		source: 'live-runtime',
		coherence: 'unverified',
		observedAt: new Date().toISOString(),
		settled: false,
	};
}

function decodeAccessRequest(value: unknown): ReadProjectionDeveloperApiAccessRequestV1<ReadProjectionDeveloperCapabilitySubsetV1> | null {
	if (!isPlainRecord(value) || !hasExactKeys(value, ['contractVersion', 'runtimeApi', 'requestedCapabilities'])) return null;
	if (value.contractVersion !== 1 || !isPlainRecord(value.runtimeApi) || !hasExactKeys(value.runtimeApi, ['min', 'max'])) return null;
	const min = value.runtimeApi.min;
	const max = value.runtimeApi.max;
	if (
		typeof min !== 'number'
		|| typeof max !== 'number'
		|| !Number.isSafeInteger(min)
		|| !Number.isSafeInteger(max)
		|| min < 1
		|| min > max
	) return null;
	if (!Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length < 1 || value.requestedCapabilities.length > ACCESS_CAPABILITIES_V1.length) return null;
	const requested = value.requestedCapabilities;
	if (!requested.every(isReadProjectionCapability)) return null;
	const positions = requested.map(capability => ACCESS_CAPABILITIES_V1.indexOf(capability));
	if (new Set(requested).size !== requested.length || positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1]))) return null;
	return freezeDto({
		contractVersion: 1,
		runtimeApi: { min, max },
		requestedCapabilities: [...requested],
	}) as unknown as ReadProjectionDeveloperApiAccessRequestV1<ReadProjectionDeveloperCapabilitySubsetV1>;
}

function failure(
	code: Parameters<typeof structuredErrorV1>[0],
	reason: string,
	retryable = false,
): ReadProjectionDeveloperApiAccessResultV1<ReadProjectionDeveloperCapabilitySubsetV1> {
	return freezeStructure({
		contractVersion: 1,
		kind: 'read-projection-developer-api-access-result',
		ok: false,
		error: structuredErrorV1(code, reason, { retryable }),
	});
}

function isReadProjectionCapability(value: unknown): value is ReadProjectionDeveloperAccessCapabilityV1 {
	return typeof value === 'string' && isReadProjectionDeveloperCapabilityIdV1(value);
}

function isContextPurpose(value: unknown): value is ContextPackV1['purpose'] {
	return value === 'read' || value === 'analysis' || value === 'planning' || value === 'creation' || value === 'mutation-readiness';
}

function isContextProjection(value: unknown): value is ContextPackV1['projection'] {
	return value === 'exact-task' || value === 'task-neighborhood' || value === 'project-analysis'
		|| value === 'planning-workload' || value === 'creation-context' || value === 'mutation-preview'
		|| value === 'placement-candidates';
}

function safeRequestId(value: unknown): string {
	try {
		if (isPlainRecord(value) && typeof value.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value.requestId)) return value.requestId;
	} catch {
		// Fall through to a valid fixed correlation id.
	}
	return 'read-projection';
}

function snapshot<T>(value: T): T {
	return structuredClone(value);
}

function freezeDto<T>(value: T): T {
	const clone = snapshot(value);
	return freezeStructure(clone);
}

function freezeStructure<T>(value: T): T {
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value);
	const actual: string[] = [];
	for (const key of keys) {
		if (typeof key !== 'string') return false;
		actual.push(key);
	}
	actual.sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}
