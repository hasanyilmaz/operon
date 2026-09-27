import type { OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { TaskWorkflowDeveloperApiRuntimeOptionsV1, TaskWorkflowDeveloperMutationExecutionResultV1, TaskWorkflowDeveloperMutationPlanHandleV1, TaskWorkflowDeveloperMutationPreviewResultV1, TaskWorkflowDeveloperPendingRecoveriesResultV1 } from '../task-workflows-v1/developer-api';
import { structuredErrorV1 } from '../../contracts/v1/primitives';
import { isRecord } from '../../../core/unknown-value';
import { CHECKBOX_OWNERSHIP_CAPABILITIES_V1, isCheckboxOwnershipCapabilityV1, type CheckboxOwnershipCapabilityV1, type CheckboxOwnershipPreviewCapabilityV1, type CheckboxOwnershipApplyCapabilityV1, type CheckboxOwnershipPreviewRequestV1, type CheckboxOwnershipFilterRequestV1, type CheckboxOwnershipFilterResultV1, type CheckboxOwnershipMutationResultV1 } from './contracts';
import { createCheckboxOwnershipDeveloperSessionV1 } from './developer-session';

type Replace<T, K extends PropertyKey, V> = T extends unknown ? Omit<T, K> & V : never;
declare const checkboxOwnershipHandleBrand: unique symbol;
export type CheckboxOwnershipPlanHandleV1 = Pick<TaskWorkflowDeveloperMutationPlanHandleV1, 'contractVersion' | 'recoveryRef' | 'planDigest' | 'createdAt' | 'expiresAt' | 'riskLevel' | 'requiresConsent'> & {
 readonly [checkboxOwnershipHandleBrand]: true;
 readonly kind: 'checkbox-ownership-developer-mutation-plan';
};
export type CheckboxOwnershipDeveloperPreviewIntentV1 = Replace<CheckboxOwnershipPreviewRequestV1, 'contractVersion' | 'kind' | 'requestId' | 'clientInstanceId' | 'correlationId' | 'idempotencyKey' | 'authorization', Record<never, never>>;
type PreviewResult<T> = T extends { ok: true }
 ? Replace<T, 'kind' | 'plan', { readonly kind: 'checkbox-ownership-developer-mutation-preview-result'; readonly plan: CheckboxOwnershipPlanHandleV1 }>
 : Replace<T, 'kind', { readonly kind: 'checkbox-ownership-developer-mutation-preview-result' }>;
export type CheckboxOwnershipDeveloperPreviewResultV1 = PreviewResult<TaskWorkflowDeveloperMutationPreviewResultV1>;
type ExecutionFields = {
 readonly kind: 'checkbox-ownership-developer-mutation-execution-result';
 readonly receipt?: Readonly<{ contractVersion: 1; planDigest: string; mutationKind: NonNullable<CheckboxOwnershipMutationResultV1['receipt']>['mutationKind']; targetDigest: string; terminalOutcome: 'applied' | 'already-applied'; effectiveAt: string; completedAt: string; expiresAt: string }>;
 readonly recovery?: Readonly<{ required: true; action: 'recover-same-plan'; mutationMayHaveApplied: true; recoveryRef: string; planDigest: string; plan: CheckboxOwnershipPlanHandleV1 }>;
};
type ExecutionResult<T> = T extends { status: 'applied' | 'already-applied' }
 ? Replace<T, 'kind' | 'receipt', Pick<ExecutionFields, 'kind'> & { readonly receipt: NonNullable<ExecutionFields['receipt']> }>
 : T extends { status: 'failed' }
  ? Replace<T, 'kind', Pick<ExecutionFields, 'kind'>>
  : Replace<T, 'kind' | 'recovery', Pick<ExecutionFields, 'kind'> & { readonly recovery: NonNullable<ExecutionFields['recovery']> }>;
export type CheckboxOwnershipDeveloperExecutionResultV1 = ExecutionResult<TaskWorkflowDeveloperMutationExecutionResultV1>;
export type CheckboxOwnershipPendingRecoveriesResultV1 = Replace<TaskWorkflowDeveloperPendingRecoveriesResultV1, 'kind', { readonly kind: 'checkbox-ownership-developer-pending-recoveries-result' }>;
export type CheckboxOwnershipRecoverInputV1 = { readonly plan: CheckboxOwnershipPlanHandleV1; readonly recoveryRef?: never } | { readonly recoveryRef: string; readonly plan?: never };
export type CheckboxOwnershipCapabilitySubsetV1 = readonly [CheckboxOwnershipCapabilityV1, ...CheckboxOwnershipCapabilityV1[]];
export interface CheckboxOwnershipDeveloperAccessRequestV1<C extends CheckboxOwnershipCapabilitySubsetV1> {
 readonly contractVersion: 1;
 readonly runtimeApi: { readonly min: number; readonly max: number };
 readonly requestedCapabilities: C;
}
type Selected<C extends readonly string[], K extends string, T> = Extract<C[number], K> extends never ? Record<never, never> : T;
export type CheckboxOwnershipDeveloperApiV1<C extends CheckboxOwnershipCapabilitySubsetV1> = Readonly<{
 contractVersion: 1; runtimeApi: 1;
 tasks: Readonly<Selected<C, 'tasks.filter-query.contiguous', { filterQuery(request: CheckboxOwnershipFilterRequestV1): Promise<CheckboxOwnershipFilterResultV1> }>>;
 mutations: Readonly<Selected<C, CheckboxOwnershipPreviewCapabilityV1, { preview(intent: Extract<CheckboxOwnershipDeveloperPreviewIntentV1, { capability: C[number] }>): Promise<CheckboxOwnershipDeveloperPreviewResultV1> }>
 & Selected<C, CheckboxOwnershipApplyCapabilityV1, {
  apply(input: { readonly plan: CheckboxOwnershipPlanHandleV1 }): Promise<CheckboxOwnershipDeveloperExecutionResultV1>;
  recover(input: CheckboxOwnershipRecoverInputV1): Promise<CheckboxOwnershipDeveloperExecutionResultV1>;
  pendingRecoveries(): Promise<CheckboxOwnershipPendingRecoveriesResultV1>;
 }>>;
}>;
export type CheckboxOwnershipDeveloperAccessResultV1<C extends CheckboxOwnershipCapabilitySubsetV1> = Readonly<{ contractVersion: 1; kind: 'checkbox-ownership-developer-api-access-result' }> & (
 | Readonly<{ ok: true; api: CheckboxOwnershipDeveloperApiV1<C>; error?: never }>
 | Readonly<{ ok: false; error: ReturnType<typeof structuredErrorV1>; api?: never }>
);
/** Native Plugin entrypoint; published V1 accessors remain unchanged. */
export interface CheckboxOwnershipDeveloperApiAccessorV1 {
 getCheckboxOwnershipDeveloperApiV1<C extends CheckboxOwnershipCapabilitySubsetV1>(consumerPlugin: OperonDeveloperApiConsumerPluginV1, request: CheckboxOwnershipDeveloperAccessRequestV1<C>): CheckboxOwnershipDeveloperAccessResultV1<C>;
}
export type CheckboxOwnershipDeveloperOptionsV1 = Omit<TaskWorkflowDeveloperApiRuntimeOptionsV1, 'recoverTaskWorkflowMutation'>;

/** Separate opt-in accessor. Existing grants are evaluated, never widened here. */
export function getCheckboxOwnershipDeveloperApiV1<C extends CheckboxOwnershipCapabilitySubsetV1>(core: OperonAgentRuntimeCoreV1 | null, consumerPlugin: OperonDeveloperApiConsumerPluginV1, request: CheckboxOwnershipDeveloperAccessRequestV1<C>, options: CheckboxOwnershipDeveloperOptionsV1): CheckboxOwnershipDeveloperAccessResultV1<C> {
 const fail = (code: Parameters<typeof structuredErrorV1>[0], reason: string): CheckboxOwnershipDeveloperAccessResultV1<C> => Object.freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-api-access-result', ok: false, error: structuredErrorV1(code, reason) });
 if (!isRecord(request) || !exactKeys(request, ['contractVersion', 'runtimeApi', 'requestedCapabilities']) || request.contractVersion !== 1 || !isRecord(request.runtimeApi) || !exactKeys(request.runtimeApi, ['min', 'max']) || !Number.isSafeInteger(request.runtimeApi.min) || !Number.isSafeInteger(request.runtimeApi.max) || request.runtimeApi.min < 1 || request.runtimeApi.min > request.runtimeApi.max || !Array.isArray(request.requestedCapabilities) || !request.requestedCapabilities.length || request.requestedCapabilities.length > CHECKBOX_OWNERSHIP_CAPABILITIES_V1.length || !request.requestedCapabilities.every(c => typeof c === 'string' && isCheckboxOwnershipCapabilityV1(c)) || new Set(request.requestedCapabilities).size !== request.requestedCapabilities.length) return fail('invalid-request', 'Invalid checkbox ownership access request.');
 if (!options.isDesktopAvailable() || !options.isHostVersionSupported()) return fail('unsupported-platform', 'This extension requires supported Obsidian Desktop.');
 if (request.runtimeApi.min > 1 || request.runtimeApi.max < 1) return fail('unsupported-version', 'The requested API range does not include V1.');
 if (!core || !core.checkboxOwnership || !options.isCoreActive(core)) return fail('handler-unavailable', 'The checkbox ownership Runtime is unavailable.');
 const consumer = options.grantController.verifyConsumer(consumerPlugin);
 if (!consumer) return fail('authority-insufficient', 'The consumer is not the active host plugin instance.');
 const capabilities = Object.freeze([...request.requestedCapabilities]) as unknown as C;
 const grant = options.grantController.evaluate(consumer, capabilities);
 if (grant.state !== 'active') {
  if (grant.state === 'pending') options.grantController.recordPending(consumer, capabilities);
  return fail('authority-insufficient', 'The exact checkbox ownership capabilities require an active grant.');
 }
 if (options.lifecyclePhase() !== 'ready') return fail('live-settling', 'The Runtime is not ready.');
 if (capabilities.some(capability => !core.hasCapability(capability))) return fail('capability-unavailable', 'A requested checkbox ownership capability is unavailable.');
 return Object.freeze({ contractVersion: 1, kind: 'checkbox-ownership-developer-api-access-result', ok: true, api: createCheckboxOwnershipDeveloperSessionV1(core, consumer, capabilities, options) });
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
 return Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}
