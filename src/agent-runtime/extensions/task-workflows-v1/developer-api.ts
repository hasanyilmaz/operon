import type { OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { DeveloperApiGrantControllerV1 } from '../../developer-api/grant-controller';
import { structuredErrorV1, type StructuredErrorV1 } from '../../contracts/v1/primitives';
import type { RuntimeLifecyclePhaseV1 } from '../../contracts/v1/lifecycle';
import type { TaskFilterQueryRequestV1, TaskFilterQueryResultV1 } from './contracts';

export interface TaskWorkflowDeveloperApiAccessRequestV1 {
	readonly contractVersion: 1;
	readonly runtimeApi: { readonly min: number; readonly max: number };
	readonly requestedCapabilities: readonly ['tasks.filter-query'];
}

export interface OperonTaskWorkflowDeveloperApiV1 {
	readonly contractVersion: 1;
	readonly runtimeApi: 1;
	readonly tasks: Readonly<{
		filterQuery(request: TaskFilterQueryRequestV1): Promise<TaskFilterQueryResultV1>;
	}>;
}

export type TaskWorkflowDeveloperApiAccessResultV1 = Readonly<{
	contractVersion: 1;
	kind: 'task-workflow-developer-api-access-result';
}> & (
	| Readonly<{ ok: true; api: OperonTaskWorkflowDeveloperApiV1; error?: never }>
	| Readonly<{ ok: false; api?: never; error: StructuredErrorV1 }>
	);

export interface OperonTaskWorkflowDeveloperApiAccessorV1 {
	readonly getTaskWorkflowDeveloperApiV1: (
		consumerPlugin: OperonDeveloperApiConsumerPluginV1,
		request: TaskWorkflowDeveloperApiAccessRequestV1,
	) => TaskWorkflowDeveloperApiAccessResultV1;
}

export interface TaskWorkflowDeveloperApiRuntimeOptionsV1 {
	readonly isDesktopAvailable: () => boolean;
	readonly isHostVersionSupported: () => boolean;
	readonly lifecyclePhase: () => RuntimeLifecyclePhaseV1;
	readonly isCoreActive: (core: OperonAgentRuntimeCoreV1) => boolean;
	readonly grantController: Pick<DeveloperApiGrantControllerV1, 'verifyConsumer' | 'isConsumerCurrent' | 'evaluate' | 'recordPending'>;
}

/** Separate additive access surface; the frozen getDeveloperApiV1 contract stays unchanged. */
export function getOperonTaskWorkflowDeveloperApiV1(
	core: OperonAgentRuntimeCoreV1 | null,
	consumerPlugin: OperonDeveloperApiConsumerPluginV1,
	request: unknown,
	options: TaskWorkflowDeveloperApiRuntimeOptionsV1,
): TaskWorkflowDeveloperApiAccessResultV1 {
	const decoded = decodeAccessRequest(request);
	if (!decoded) return failure('invalid-request', 'The task-workflow Developer API access request is invalid.');
	if (!options.isDesktopAvailable() || !options.isHostVersionSupported()) return failure('unsupported-platform', 'The task-workflow Developer API requires supported Obsidian Desktop.');
	if (!core || !options.isCoreActive(core)) return failure('handler-unavailable', 'The Operon Runtime facade is unavailable.');
	if (decoded.runtimeApi.min > 1 || decoded.runtimeApi.max < 1) return failure('unsupported-version', 'The requested Runtime API range does not include V1.');
	const consumer = options.grantController.verifyConsumer(consumerPlugin);
	if (!consumer) return failure('authority-insufficient', 'The Developer API consumer is not the active host plugin instance.');
	const grant = options.grantController.evaluate(consumer, ['tasks.filter-query']);
	if (grant.state !== 'active') {
		if (grant.state === 'pending') options.grantController.recordPending(consumer, ['tasks.filter-query']);
		return failure('authority-insufficient', 'The saved-filter capability requires an active exact-capability grant.');
	}
	const advertised = core.system.capabilities().find(item => item.id === 'tasks.filter-query');
	if (!advertised || (advertised.availability !== 'available' && advertised.availability !== 'degraded') || !core.tasks.filterQuery) {
		return failure('capability-unavailable', 'The saved-filter Developer API capability is unavailable.');
	}
	if (options.lifecyclePhase() !== 'ready') return failure('live-settling', 'The Operon Runtime is not ready.', true);
	return deepFreeze({
		contractVersion: 1,
		kind: 'task-workflow-developer-api-access-result',
		ok: true,
		api: {
			contractVersion: 1,
			runtimeApi: 1,
			tasks: {
			filterQuery: async (input: TaskFilterQueryRequestV1): Promise<TaskFilterQueryResultV1> => {
					if (!options.isCoreActive(core) || !options.grantController.isConsumerCurrent(consumer)) {
						return readFailure(input, structuredErrorV1('authority-insufficient', 'The task-workflow Developer API session is no longer current.'));
					}
					const liveGrant = options.grantController.evaluate(consumer, ['tasks.filter-query']);
					if (
						liveGrant.state !== 'active'
						|| !liveGrant.effectiveCapabilities.includes('tasks.filter-query')
					) {
						return readFailure(input, structuredErrorV1('authority-insufficient', 'The saved-filter capability grant is no longer active.'));
					}
					const snapshot = structuredCloneSafe<TaskFilterQueryRequestV1>(input);
					if (!snapshot) return readFailure(input, structuredErrorV1('invalid-request', 'The saved-filter request is not structured-cloneable.'));
					const result = await core.tasks.filterQuery?.(snapshot);
					return result
						? deepFreeze(result)
						: readFailure(input, structuredErrorV1('capability-unavailable', 'The saved-filter Developer API capability is no longer available.'));
				},
			},
		},
	});
}

function decodeAccessRequest(value: unknown): TaskWorkflowDeveloperApiAccessRequestV1 | null {
	if (!isRecord(value) || !exactKeys(value, ['contractVersion', 'runtimeApi', 'requestedCapabilities'])) return null;
	if (value.contractVersion !== 1 || !isRecord(value.runtimeApi) || !exactKeys(value.runtimeApi, ['min', 'max'])) return null;
	if (!Number.isSafeInteger(value.runtimeApi.min) || !Number.isSafeInteger(value.runtimeApi.max) || (value.runtimeApi.min as number) < 1 || (value.runtimeApi.min as number) > (value.runtimeApi.max as number)) return null;
	if (!Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length !== 1 || value.requestedCapabilities[0] !== 'tasks.filter-query') return null;
	return deepFreeze({
		contractVersion: 1,
		runtimeApi: { min: value.runtimeApi.min as number, max: value.runtimeApi.max as number },
		requestedCapabilities: ['tasks.filter-query'],
	});
}

function readFailure(request: unknown, error: StructuredErrorV1): TaskFilterQueryResultV1 {
	const requestId = isRecord(request) && typeof request.requestId === 'string' ? request.requestId : 'invalid-request';
	return deepFreeze({
		contractVersion: 1,
		requestId,
		kind: 'task-filter-query-result',
		ok: false,
		freshness: { source: 'live-runtime', coherence: 'unverified', observedAt: new Date(0).toISOString(), settled: false },
		warnings: [],
		error,
	});
}

function failure(code: Parameters<typeof structuredErrorV1>[0], reason: string, retryable = false): TaskWorkflowDeveloperApiAccessResultV1 {
	return deepFreeze({ contractVersion: 1, kind: 'task-workflow-developer-api-access-result', ok: false, error: structuredErrorV1(code, reason, { retryable }) });
}

function structuredCloneSafe<T>(value: unknown): T | null {
	try {
		return deepFreeze(structuredClone(value)) as T;
	} catch {
		return null;
	}
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}
