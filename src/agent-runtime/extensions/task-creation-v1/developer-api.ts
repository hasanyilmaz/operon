import type {RoutedCreationSummaryV1} from './contracts';
import { createTaskCreationDeveloperSessionV1 } from './developer-session';
import type { TaskCreationDeveloperApiV1 as MutationSessionApiV1 } from './session-contract';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import type { TaskWorkflowDeveloperApiRuntimeOptionsV1, TaskWorkflowDeveloperMutationPlanHandleV1, TaskWorkflowDeveloperMutationPreviewResultV1, TaskWorkflowDeveloperMutationExecutionResultV1 } from '../task-workflows-v1/developer-api';
import { structuredErrorV1 } from '../../contracts/v1/primitives';
import { isRecord } from '../../../core/unknown-value';
import { TASK_CREATION_CAPABILITIES_V1, isTaskCreationCapabilityV1, type TaskCreationCapabilityV1, type TaskCreationPolicyRequestV1, type TaskCreationPolicyResultV1, type RoutedTaskCreationPreviewRequestV1 } from './contracts';
import { creationKeysV1, decodeTaskCreationPolicyRequestV1 } from './decode';
import { creationPolicyFailureV1 } from './gateway';
export interface TaskCreationDeveloperAccessRequestV1 {
 contractVersion: 1; runtimeApi: { min: number; max: number }; requestedCapabilities: readonly TaskCreationCapabilityV1[];
}
declare const creationHandleBrand: unique symbol;
export type TaskCreationDeveloperPlanHandleV1 = Pick<TaskWorkflowDeveloperMutationPlanHandleV1, 'contractVersion' | 'recoveryRef' | 'planDigest' | 'createdAt' | 'expiresAt' | 'riskLevel' | 'requiresConsent'> & {
 readonly [creationHandleBrand]: true; readonly kind: 'task-creation-developer-mutation-plan';
};
export type TaskCreationDeveloperPreviewIntentV1 = Omit<RoutedTaskCreationPreviewRequestV1, 'contractVersion' | 'kind' | 'requestId' | 'clientInstanceId' | 'correlationId' | 'idempotencyKey' | 'authorization'>;
type PreviewResult<T> = T extends { ok: true } ? Omit<T, 'kind' | 'plan'> & { kind: 'task-creation-developer-mutation-preview-result'; plan: TaskCreationDeveloperPlanHandleV1; creation:RoutedCreationSummaryV1 } : Omit<T, 'kind'> & { kind: 'task-creation-developer-mutation-preview-result' };
export type TaskCreationDeveloperPreviewResultV1 = PreviewResult<TaskWorkflowDeveloperMutationPreviewResultV1>;
type ExecutionResult<T> = T extends { recovery: infer R } ? Omit<T, 'kind' | 'recovery'> & { kind: 'task-creation-developer-mutation-execution-result'; recovery: Omit<R, 'plan'> & { plan: TaskCreationDeveloperPlanHandleV1 } } : Omit<T, 'kind'> & { kind: 'task-creation-developer-mutation-execution-result' };
export type TaskCreationDeveloperExecutionResultV1 = ExecutionResult<TaskWorkflowDeveloperMutationExecutionResultV1>;
/** Mutation calls use opaque session handles; summaries expose the approved creation result. */
export interface TaskCreationDeveloperMutationContractV1 {
 preview(intent: TaskCreationDeveloperPreviewIntentV1): Promise<TaskCreationDeveloperPreviewResultV1>;
 apply(input: { readonly plan: TaskCreationDeveloperPlanHandleV1 }): Promise<TaskCreationDeveloperExecutionResultV1>;
}
export interface TaskCreationDeveloperApiAccessorV1 {
 getTaskCreationDeveloperApiV1(consumerPlugin: OperonDeveloperApiConsumerPluginV1, request: TaskCreationDeveloperAccessRequestV1): TaskCreationDeveloperAccessResultV1;
}
export interface TaskCreationDeveloperApiV1 {
 readonly contractVersion: 1; readonly runtimeApi: 1;
 readonly mutations?: MutationSessionApiV1['mutations'];
 readonly creation: { readPolicy(request: TaskCreationPolicyRequestV1): Promise<TaskCreationPolicyResultV1> };
}
export type TaskCreationDeveloperAccessResultV1 =
 | { contractVersion: 1; kind: 'task-creation-developer-api-access-result'; ok: true; api: TaskCreationDeveloperApiV1 }
 | { contractVersion: 1; kind: 'task-creation-developer-api-access-result'; ok: false; error: ReturnType<typeof structuredErrorV1> };
export function getTaskCreationDeveloperApiV1(core: OperonAgentRuntimeCoreV1 | null, plugin: OperonDeveloperApiConsumerPluginV1, request: TaskCreationDeveloperAccessRequestV1, options: TaskWorkflowDeveloperApiRuntimeOptionsV1): TaskCreationDeveloperAccessResultV1 {
 const fail = (code: Parameters<typeof structuredErrorV1>[0], reason: string): TaskCreationDeveloperAccessResultV1 => ({ contractVersion: 1, kind: 'task-creation-developer-api-access-result', ok: false, error: structuredErrorV1(code, reason) });
 if (!isRecord(request) || !creationKeysV1(request, ['contractVersion', 'runtimeApi', 'requestedCapabilities']) || request.contractVersion !== 1 || !isRecord(request.runtimeApi) || !creationKeysV1(request.runtimeApi, ['min', 'max']) || !Number.isSafeInteger(request.runtimeApi.min) || !Number.isSafeInteger(request.runtimeApi.max) || request.runtimeApi.min < 1 || request.runtimeApi.min > request.runtimeApi.max || !Array.isArray(request.requestedCapabilities) || !request.requestedCapabilities.length || request.requestedCapabilities.length > TASK_CREATION_CAPABILITIES_V1.length || !request.requestedCapabilities.every(c => typeof c === 'string' && isTaskCreationCapabilityV1(c)) || new Set(request.requestedCapabilities).size !== request.requestedCapabilities.length) return fail('invalid-request', 'Invalid creation extension access request.');
 if (!options.isDesktopAvailable() || !options.isHostVersionSupported()) return fail('unsupported-platform', 'The creation extension requires supported Obsidian Desktop.');
 if (request.runtimeApi.min > 1 || request.runtimeApi.max < 1) return fail('unsupported-version', 'The requested range does not include Runtime V1.');
 if (!core?.taskCreation || !options.isCoreActive(core)) return fail('handler-unavailable', 'Creation extension is unavailable.');
 const capabilities = [...request.requestedCapabilities];
 if (capabilities.some(capability => !core.hasCapability(capability))) return fail('capability-unavailable', 'Requested creation capability is not executable.');
 const consumer = options.grantController.verifyConsumer(plugin);
 if (!consumer) return fail('authority-insufficient', 'The caller is not the active host plugin instance.');
 const grant = options.grantController.evaluate(consumer, capabilities);
 if (grant.state !== 'active') {
  if (grant.state === 'pending') options.grantController.recordPending(consumer, capabilities);
  return fail('authority-insufficient', 'An exact creation capability grant is required.');
 }
 const valid = () => options.isCoreActive(core) && options.lifecyclePhase() === 'ready' && options.grantController.isConsumerCurrent(consumer) && options.grantController.evaluate(consumer, capabilities).state === 'active' && capabilities.every(capability=>core.hasCapability(capability));
 if (!valid()) return fail('live-settling', 'The creation extension is not ready.');
 return Object.freeze({ contractVersion: 1, kind: 'task-creation-developer-api-access-result', ok: true, api: Object.freeze({ contractVersion: 1, runtimeApi: 1, ...(core.taskCreation.mutations && capabilities.some(capability=>capability.endsWith('.preview')||capability.endsWith('.apply')) ? {mutations:createTaskCreationDeveloperSessionV1(core,consumer,capabilities,options).mutations} : {}), creation: Object.freeze({ async readPolicy(input: TaskCreationPolicyRequestV1): Promise<TaskCreationPolicyResultV1> {
  const decoded = decodeTaskCreationPolicyRequestV1(input);
  if (!decoded.ok) return creationPolicyFailureV1('invalid-request', 'invalid-request', 'Invalid creation policy request.');
  if (!valid() || !capabilities.includes('tasks.creation-policy.read')) return creationPolicyFailureV1(decoded.value.requestId, 'authority-insufficient', 'The creation read grant is no longer active.');
  const result = await core.taskCreation!.readPolicy(input);
  return valid() ? result : creationPolicyFailureV1(decoded.value.requestId, 'authority-insufficient', 'The creation read grant changed during the request.');
 } }) }) });
}
