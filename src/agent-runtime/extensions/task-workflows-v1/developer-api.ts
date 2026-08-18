import type { OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { DeveloperApiGrantControllerV1 } from '../../developer-api/grant-controller';
import {
	structuredErrorV1,
	type ContractWarningV1,
	type StructuredErrorV1,
} from '../../contracts/v1/primitives';
import type { RuntimeLifecyclePhaseV1 } from '../../contracts/v1/lifecycle';
import type { DeveloperMutationSecurityPolicyV1 } from '../../developer-api/security';
import type { DeveloperMutationRecoveryStoreV1 } from '../../developer-api/recovery-store';
import type {
	AtomicGroupResultV1,
	MutationPostflightV1,
	RiskLevelV1,
} from '../../contracts/v1/mutation';
import type {
	AdoptTaskPreviewIntentV1,
	TaskFilterQueryRequestV1,
	TaskFilterQueryResultV1,
	TaskWorkflowApplyRequestV1,
	TaskWorkflowCapabilityIdV1,
	TaskWorkflowMutationResultV1,
} from './contracts';
import { createTaskWorkflowDeveloperMutationSessionV1 } from './task-workflow-mutation-session';

const ACCESS_CAPABILITIES_V1 = [
	'tasks.filter-query',
	'tasks.adopt.preview',
	'tasks.adopt.apply',
] as const satisfies readonly TaskWorkflowCapabilityIdV1[];

export type TaskWorkflowDeveloperAccessCapabilityV1 = typeof ACCESS_CAPABILITIES_V1[number];

/** Canonical non-empty capability subsets accepted by the extension accessor. */
export type TaskWorkflowDeveloperCapabilitySubsetV1 =
	| readonly ['tasks.filter-query']
	| readonly ['tasks.adopt.preview']
	| readonly ['tasks.adopt.apply']
	| readonly ['tasks.filter-query', 'tasks.adopt.preview']
	| readonly ['tasks.filter-query', 'tasks.adopt.apply']
	| readonly ['tasks.adopt.preview', 'tasks.adopt.apply']
	| readonly ['tasks.filter-query', 'tasks.adopt.preview', 'tasks.adopt.apply'];

/**
 * Frozen V1 filter-only request. Keep this exact shape for existing companion
 * plugins; capability-subset consumers use the additive generic request below.
 */
export interface TaskWorkflowDeveloperApiAccessRequestV1 {
	readonly contractVersion: 1;
	readonly runtimeApi: { readonly min: number; readonly max: number };
	readonly requestedCapabilities: readonly ['tasks.filter-query'];
}

export interface TaskWorkflowDeveloperCapabilityAccessRequestV1<
	TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1,
> {
	readonly contractVersion: 1;
	readonly runtimeApi: { readonly min: number; readonly max: number };
	readonly requestedCapabilities: TCapabilities;
}

declare const taskWorkflowDeveloperMutationPlanHandleBrandV1: unique symbol;

/** Opaque, session-bound adoption plan; sealed task/source fields stay host-only. */
export interface TaskWorkflowDeveloperMutationPlanHandleV1 {
	readonly [taskWorkflowDeveloperMutationPlanHandleBrandV1]: 'operon-task-workflow-developer-mutation-plan-v1';
	readonly contractVersion: 1;
	readonly kind: 'task-workflow-developer-mutation-plan';
	readonly recoveryRef: string;
	readonly planDigest: string;
	readonly createdAt: string;
	readonly expiresAt: string;
	readonly riskLevel: RiskLevelV1;
	readonly requiresConsent: boolean;
}

export type TaskWorkflowDeveloperMutationPreviewResultV1 = Readonly<{
	contractVersion: 1;
	kind: 'task-workflow-developer-mutation-preview-result';
	requestId: string;
}> & (
	| Readonly<{ ok: true; plan: TaskWorkflowDeveloperMutationPlanHandleV1; warnings: readonly ContractWarningV1[]; error?: never }>
	| Readonly<{ ok: false; warnings: readonly ContractWarningV1[]; error: StructuredErrorV1; plan?: never }>
);

export type TaskWorkflowDeveloperMutationExecutionResultV1 = Readonly<{
	contractVersion: 1;
	kind: 'task-workflow-developer-mutation-execution-result';
	requestId: string;
	groupResults: readonly AtomicGroupResultV1[];
}> & (
	| Readonly<{ status: 'applied' | 'already-applied'; mutationMayHaveApplied: true; retryAllowed: false; receipt: Readonly<{ contractVersion: 1; planDigest: string; mutationKind: 'task.adopt'; targetDigest: string; terminalOutcome: 'applied' | 'already-applied'; effectiveAt: string; completedAt: string; expiresAt: string }>; postflight: Readonly<MutationPostflightV1>; error?: never; recovery?: never }>
	| Readonly<{ status: 'failed'; mutationMayHaveApplied: false; retryAllowed: false; error: StructuredErrorV1; receipt?: never; postflight?: never; recovery?: never }>
	| Readonly<{ status: 'partial' | 'outcome-unknown'; mutationMayHaveApplied: true; retryAllowed: false; error: StructuredErrorV1; recovery: Readonly<{ required: true; action: 'recover-same-plan'; mutationMayHaveApplied: true; recoveryRef: string; planDigest: string; plan: TaskWorkflowDeveloperMutationPlanHandleV1 }>; receipt?: never; postflight?: never }>
);

export type TaskWorkflowDeveloperMutationRecoverInputV1 =
	| Readonly<{ plan: TaskWorkflowDeveloperMutationPlanHandleV1; recoveryRef?: never }>
	| Readonly<{ recoveryRef: string; plan?: never }>;

export type TaskWorkflowDeveloperPendingRecoveriesResultV1 =
	| Readonly<{ contractVersion: 1; kind: 'task-workflow-developer-pending-recoveries-result'; ok: true; recoveries: readonly Readonly<{ recoveryRef: string; planDigest: string; createdAt: string; expiresAt: string }>[]; error?: never }>
	| Readonly<{ contractVersion: 1; kind: 'task-workflow-developer-pending-recoveries-result'; ok: false; error: StructuredErrorV1; recoveries?: never }>;

type IncludesTaskWorkflowDeveloperCapabilityV1<
	TCapabilities extends readonly TaskWorkflowDeveloperAccessCapabilityV1[],
	TCapability extends TaskWorkflowDeveloperAccessCapabilityV1,
> = TCapability extends TCapabilities[number] ? true : false;

type IncludesAnyTaskWorkflowDeveloperCapabilityV1<
	TCapabilities extends readonly TaskWorkflowDeveloperAccessCapabilityV1[],
	TCapability extends TaskWorkflowDeveloperAccessCapabilityV1,
> = Extract<TCapability, TCapabilities[number]> extends never ? false : true;

type HasTaskWorkflowDeveloperAdoptionCapabilityV1<
	TCapabilities extends readonly TaskWorkflowDeveloperAccessCapabilityV1[],
> = IncludesAnyTaskWorkflowDeveloperCapabilityV1<
	TCapabilities,
	'tasks.adopt.preview' | 'tasks.adopt.apply'
> extends false ? false : true;

type TaskWorkflowDeveloperAdoptionMethodsV1<
	TCapabilities extends readonly TaskWorkflowDeveloperAccessCapabilityV1[],
> = Readonly<
	( IncludesTaskWorkflowDeveloperCapabilityV1<TCapabilities, 'tasks.adopt.preview'> extends true
		? { readonly preview: (intent: AdoptTaskPreviewIntentV1) => Promise<TaskWorkflowDeveloperMutationPreviewResultV1> }
			: Record<never, never> )
	& ( IncludesTaskWorkflowDeveloperCapabilityV1<TCapabilities, 'tasks.adopt.apply'> extends true
		? {
			readonly apply: (input: Readonly<{ plan: TaskWorkflowDeveloperMutationPlanHandleV1 }>) => Promise<TaskWorkflowDeveloperMutationExecutionResultV1>;
			readonly recover: (input: TaskWorkflowDeveloperMutationRecoverInputV1) => Promise<TaskWorkflowDeveloperMutationExecutionResultV1>;
			readonly pendingRecoveries: () => Promise<TaskWorkflowDeveloperPendingRecoveriesResultV1>;
		}
			: Record<never, never> )
>;

type TaskWorkflowDeveloperTasksForCapabilitiesV1<
	TCapabilities extends readonly TaskWorkflowDeveloperAccessCapabilityV1[],
> = Readonly<
	( IncludesTaskWorkflowDeveloperCapabilityV1<TCapabilities, 'tasks.filter-query'> extends true
		? { readonly filterQuery: (request: TaskFilterQueryRequestV1) => Promise<TaskFilterQueryResultV1> }
			: Record<never, never> )
	& ( HasTaskWorkflowDeveloperAdoptionCapabilityV1<TCapabilities> extends true
		? { readonly adopt: TaskWorkflowDeveloperAdoptionMethodsV1<TCapabilities> }
			: Record<never, never> )
>;

/** Frozen V1 filter-only API surface. */
export interface OperonTaskWorkflowDeveloperApiV1 {
	readonly contractVersion: 1;
	readonly runtimeApi: 1;
	readonly tasks: Readonly<{
		readonly filterQuery: (request: TaskFilterQueryRequestV1) => Promise<TaskFilterQueryResultV1>;
	}>;
}

export type OperonTaskWorkflowDeveloperCapabilityApiV1<
	TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1,
> = TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1 ? Readonly<{
	readonly contractVersion: 1;
	readonly runtimeApi: 1;
	readonly tasks: TaskWorkflowDeveloperTasksForCapabilitiesV1<TCapabilities>;
}> : never;

export type TaskWorkflowDeveloperApiAccessResultV1 = Readonly<{
	contractVersion: 1;
	kind: 'task-workflow-developer-api-access-result';
}> & (
	| Readonly<{ ok: true; api: OperonTaskWorkflowDeveloperApiV1; error?: never }>
	| Readonly<{ ok: false; api?: never; error: StructuredErrorV1 }>
	);

export type TaskWorkflowDeveloperCapabilityAccessResultV1<
	TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1,
> = TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1 ? Readonly<{
	contractVersion: 1;
	kind: 'task-workflow-developer-api-access-result';
}> & (
	| Readonly<{ ok: true; api: OperonTaskWorkflowDeveloperCapabilityApiV1<TCapabilities>; error?: never }>
	| Readonly<{ ok: false; api?: never; error: StructuredErrorV1 }>
) : never;

export interface OperonTaskWorkflowDeveloperApiAccessorV1 {
	getTaskWorkflowDeveloperApiV1(
		consumerPlugin: OperonDeveloperApiConsumerPluginV1,
		request: TaskWorkflowDeveloperApiAccessRequestV1,
	): TaskWorkflowDeveloperApiAccessResultV1;
	getTaskWorkflowDeveloperApiV1<
		TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1,
	>(
		consumerPlugin: OperonDeveloperApiConsumerPluginV1,
		request: TaskWorkflowDeveloperCapabilityAccessRequestV1<TCapabilities>,
	): TaskWorkflowDeveloperCapabilityAccessResultV1<TCapabilities>;
}

export interface TaskWorkflowDeveloperApiRuntimeOptionsV1 {
	readonly isDesktopAvailable: () => boolean;
	readonly isHostVersionSupported: () => boolean;
	readonly lifecyclePhase: () => RuntimeLifecyclePhaseV1;
	readonly isCoreActive: (core: OperonAgentRuntimeCoreV1) => boolean;
	readonly grantController: Pick<DeveloperApiGrantControllerV1, 'verifyConsumer' | 'isConsumerCurrent' | 'evaluate' | 'recordPending'>;
	readonly mutationSecurityPolicy?: DeveloperMutationSecurityPolicyV1;
	readonly recoveryStore?: DeveloperMutationRecoveryStoreV1;
	/**
	 * Host-internal durable recovery path. Production binds this directly to
	 * the task-workflow Gateway so its exact same-plan evidence check remains
	 * authoritative even after the public facade TTL has elapsed.
	 */
	readonly recoverTaskWorkflowMutation?: (
		request: TaskWorkflowApplyRequestV1,
	) => Promise<TaskWorkflowMutationResultV1>;
	readonly createSessionId?: () => string;
	readonly now?: () => Date;
}

/** Separate additive access surface; the frozen getDeveloperApiV1 contract stays unchanged. */
export function getOperonTaskWorkflowDeveloperApiV1(
	core: OperonAgentRuntimeCoreV1 | null,
	consumerPlugin: OperonDeveloperApiConsumerPluginV1,
	request: TaskWorkflowDeveloperApiAccessRequestV1,
	options: TaskWorkflowDeveloperApiRuntimeOptionsV1,
): TaskWorkflowDeveloperApiAccessResultV1;
export function getOperonTaskWorkflowDeveloperApiV1<
	TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1,
>(
	core: OperonAgentRuntimeCoreV1 | null,
	consumerPlugin: OperonDeveloperApiConsumerPluginV1,
	request: TaskWorkflowDeveloperCapabilityAccessRequestV1<TCapabilities>,
	options: TaskWorkflowDeveloperApiRuntimeOptionsV1,
): TaskWorkflowDeveloperCapabilityAccessResultV1<TCapabilities>;
export function getOperonTaskWorkflowDeveloperApiV1(
	core: OperonAgentRuntimeCoreV1 | null,
	consumerPlugin: OperonDeveloperApiConsumerPluginV1,
	request: unknown,
	options: TaskWorkflowDeveloperApiRuntimeOptionsV1,
): TaskWorkflowDeveloperCapabilityAccessResultV1<TaskWorkflowDeveloperCapabilitySubsetV1> {
	const decoded = decodeAccessRequest(request);
	if (!decoded) return failure('invalid-request', 'The task-workflow Developer API access request is invalid.');
	if (!options.isDesktopAvailable() || !options.isHostVersionSupported()) return failure('unsupported-platform', 'The task-workflow Developer API requires supported Obsidian Desktop.');
	if (!core || !options.isCoreActive(core)) return failure('handler-unavailable', 'The Operon Runtime facade is unavailable.');
	if (decoded.runtimeApi.min > 1 || decoded.runtimeApi.max < 1) return failure('unsupported-version', 'The requested Runtime API range does not include V1.');
	const consumer = options.grantController.verifyConsumer(consumerPlugin);
	if (!consumer) return failure('authority-insufficient', 'The Developer API consumer is not the active host plugin instance.');
	const grant = options.grantController.evaluate(consumer, decoded.requestedCapabilities);
	if (grant.state !== 'active') {
		if (grant.state === 'pending') options.grantController.recordPending(consumer, decoded.requestedCapabilities);
		return failure('authority-insufficient', 'The requested task-workflow capability set requires an active exact-capability grant.');
	}
	for (const capability of decoded.requestedCapabilities) {
		const advertised = core.system.capabilities().find(item => item.id === capability);
		if (!advertised || (advertised.availability !== 'available' && advertised.availability !== 'degraded')) {
			return failure('capability-unavailable', `The task-workflow Developer API capability is unavailable: ${capability}.`);
		}
		if (capability === 'tasks.filter-query' && !core.tasks.filterQuery) {
			return failure('capability-unavailable', 'The saved-filter Developer API capability is unavailable.');
		}
	}
	if (options.lifecyclePhase() !== 'ready') return failure('live-settling', 'The Operon Runtime is not ready.', true);
	return deepFreeze({
		contractVersion: 1,
		kind: 'task-workflow-developer-api-access-result',
		ok: true,
		api: createTaskWorkflowDeveloperMutationSessionV1(
			core,
			consumer,
			decoded.requestedCapabilities,
			options,
		),
	});
}

function decodeAccessRequest(
	value: unknown,
): TaskWorkflowDeveloperCapabilityAccessRequestV1<TaskWorkflowDeveloperCapabilitySubsetV1> | null {
	if (!isRecord(value) || !exactKeys(value, ['contractVersion', 'runtimeApi', 'requestedCapabilities'])) return null;
	if (value.contractVersion !== 1 || !isRecord(value.runtimeApi) || !exactKeys(value.runtimeApi, ['min', 'max'])) return null;
	if (!Number.isSafeInteger(value.runtimeApi.min) || !Number.isSafeInteger(value.runtimeApi.max) || (value.runtimeApi.min as number) < 1 || (value.runtimeApi.min as number) > (value.runtimeApi.max as number)) return null;
	if (!Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length < 1 || value.requestedCapabilities.length > ACCESS_CAPABILITIES_V1.length) return null;
	if (!value.requestedCapabilities.every(isAccessCapability)) return null;
	const positions = value.requestedCapabilities.map(capability => ACCESS_CAPABILITIES_V1.indexOf(capability));
	if (new Set(value.requestedCapabilities).size !== value.requestedCapabilities.length || positions.some((position, index) => position < 0 || (index > 0 && position <= positions[index - 1]))) return null;
	return deepFreeze({
		contractVersion: 1,
		runtimeApi: { min: value.runtimeApi.min as number, max: value.runtimeApi.max as number },
		requestedCapabilities: [...value.requestedCapabilities] as unknown as TaskWorkflowDeveloperCapabilitySubsetV1,
	});
}

function isAccessCapability(value: unknown): value is TaskWorkflowDeveloperAccessCapabilityV1 {
	return typeof value === 'string' && (ACCESS_CAPABILITIES_V1 as readonly string[]).includes(value);
}

function failure(code: Parameters<typeof structuredErrorV1>[0], reason: string, retryable = false): TaskWorkflowDeveloperCapabilityAccessResultV1<TaskWorkflowDeveloperCapabilitySubsetV1> {
	return deepFreeze({ contractVersion: 1, kind: 'task-workflow-developer-api-access-result', ok: false, error: structuredErrorV1(code, reason, { retryable }) });
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
