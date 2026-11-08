import type { OperonDeveloperApiConsumerPluginV1 } from '../../public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../runtime/types';
import type { TaskWorkflowDeveloperApiRuntimeOptionsV1, TaskWorkflowDeveloperMutationExecutionResultV1, TaskWorkflowDeveloperMutationPlanHandleV1, TaskWorkflowDeveloperMutationPreviewResultV1, TaskWorkflowDeveloperPendingRecoveriesResultV1 } from '../task-workflows-v1/developer-api';
import { structuredErrorV1 } from '../../contracts/v1/primitives';
import { isRecord } from '../../../core/unknown-value';
import { FILE_TASK_TITLES_CAPABILITIES_V1, isFileTaskTitlesCapabilityV1, type FileTaskTitlesCapabilityV1, type FileTaskTitlesPreviewCapabilityV1, type FileTaskTitlesApplyCapabilityV1, type FileTaskTitlesPreviewRequestV1, type FileTaskTitlesMutationResultV1 } from './contracts';
import { createFileTaskTitlesDeveloperSessionV1 } from './developer-session';

type Replace<T, K extends PropertyKey, V> = T extends unknown ? Omit<T, K> & V : never;
declare const fileTaskTitlesHandleBrand: unique symbol;
export type FileTaskTitlesPlanHandleV1 = Pick<TaskWorkflowDeveloperMutationPlanHandleV1, 'contractVersion' | 'recoveryRef' | 'planDigest' | 'createdAt' | 'expiresAt' | 'riskLevel' | 'requiresConsent'> & {
 readonly [fileTaskTitlesHandleBrand]: true;
 readonly kind: 'file-task-titles-developer-mutation-plan';
};
export type FileTaskTitlesDeveloperPreviewIntentV1 = Replace<FileTaskTitlesPreviewRequestV1, 'contractVersion' | 'kind' | 'requestId' | 'clientInstanceId' | 'correlationId' | 'idempotencyKey' | 'authorization', Record<never, never>>;
type PreviewResult<T> = T extends { ok: true }
 ? Replace<T, 'kind' | 'plan', { readonly kind: 'file-task-titles-developer-mutation-preview-result'; readonly plan: FileTaskTitlesPlanHandleV1 }>
 : Replace<T, 'kind', { readonly kind: 'file-task-titles-developer-mutation-preview-result' }>;
export type FileTaskTitlesDeveloperPreviewResultV1 = PreviewResult<TaskWorkflowDeveloperMutationPreviewResultV1>;
type ExecutionFields = {
 readonly kind: 'file-task-titles-developer-mutation-execution-result';
 readonly receipt?: Readonly<{ contractVersion: 1; planDigest: string; mutationKind: NonNullable<FileTaskTitlesMutationResultV1['receipt']>['mutationKind']; targetDigest: string; terminalOutcome: 'applied' | 'already-applied'; effectiveAt: string; completedAt: string; expiresAt: string }>;
 readonly recovery?: Readonly<{ required: true; action: 'recover-same-plan'; mutationMayHaveApplied: true; recoveryRef: string; planDigest: string; plan: FileTaskTitlesPlanHandleV1 }>;
};
type ExecutionResult<T> = T extends { status: 'applied' | 'already-applied' }
 ? Replace<T, 'kind' | 'receipt', Pick<ExecutionFields, 'kind'> & { readonly receipt: NonNullable<ExecutionFields['receipt']> }>
 : T extends { status: 'failed' }
  ? Replace<T, 'kind', Pick<ExecutionFields, 'kind'>>
  : Replace<T, 'kind' | 'recovery', Pick<ExecutionFields, 'kind'> & { readonly recovery: NonNullable<ExecutionFields['recovery']> }>;
export type FileTaskTitlesDeveloperExecutionResultV1 = ExecutionResult<TaskWorkflowDeveloperMutationExecutionResultV1>;
export type FileTaskTitlesPendingRecoveriesResultV1 = Replace<TaskWorkflowDeveloperPendingRecoveriesResultV1, 'kind', { readonly kind: 'file-task-titles-developer-pending-recoveries-result' }>;
export type FileTaskTitlesRecoverInputV1 = { readonly plan: FileTaskTitlesPlanHandleV1; readonly recoveryRef?: never } | { readonly recoveryRef: string; readonly plan?: never };
export type FileTaskTitlesCapabilitySubsetV1 = readonly [FileTaskTitlesCapabilityV1, ...FileTaskTitlesCapabilityV1[]];
export interface FileTaskTitlesDeveloperAccessRequestV1<C extends FileTaskTitlesCapabilitySubsetV1> {
 readonly contractVersion: 1;
 readonly runtimeApi: { readonly min: number; readonly max: number };
 readonly requestedCapabilities: C;
}
type Selected<C extends readonly string[], K extends string, T> = Extract<C[number], K> extends never ? Record<never, never> : T;
export type FileTaskTitlesDeveloperApiV1<C extends FileTaskTitlesCapabilitySubsetV1> = Readonly<{
 contractVersion: 1; runtimeApi: 1;
 tasks: Readonly<Record<never, never>>;
 mutations: Readonly<Selected<C, FileTaskTitlesPreviewCapabilityV1, { preview(intent: Extract<FileTaskTitlesDeveloperPreviewIntentV1, { capability: C[number] }>): Promise<FileTaskTitlesDeveloperPreviewResultV1> }>
 & Selected<C, FileTaskTitlesApplyCapabilityV1, {
  apply(input: { readonly plan: FileTaskTitlesPlanHandleV1 }): Promise<FileTaskTitlesDeveloperExecutionResultV1>;
  recover(input: FileTaskTitlesRecoverInputV1): Promise<FileTaskTitlesDeveloperExecutionResultV1>;
  pendingRecoveries(): Promise<FileTaskTitlesPendingRecoveriesResultV1>;
 }>>;
}>;
export type FileTaskTitlesDeveloperAccessResultV1<C extends FileTaskTitlesCapabilitySubsetV1> = Readonly<{ contractVersion: 1; kind: 'file-task-titles-developer-api-access-result' }> & (
 | Readonly<{ ok: true; api: FileTaskTitlesDeveloperApiV1<C>; error?: never }>
 | Readonly<{ ok: false; error: ReturnType<typeof structuredErrorV1>; api?: never }>
);
/** Native Plugin entrypoint; published V1 accessors remain unchanged. */
export interface FileTaskTitlesDeveloperApiAccessorV1 {
 getFileTaskTitlesDeveloperApiV1<C extends FileTaskTitlesCapabilitySubsetV1>(consumerPlugin: OperonDeveloperApiConsumerPluginV1, request: FileTaskTitlesDeveloperAccessRequestV1<C>): FileTaskTitlesDeveloperAccessResultV1<C>;
}
export type FileTaskTitlesDeveloperOptionsV1 = Omit<TaskWorkflowDeveloperApiRuntimeOptionsV1, 'recoverTaskWorkflowMutation'>;

/** Separate opt-in accessor. Existing grants are evaluated, never widened here. */
export function getFileTaskTitlesDeveloperApiV1<C extends FileTaskTitlesCapabilitySubsetV1>(core: OperonAgentRuntimeCoreV1 | null, consumerPlugin: OperonDeveloperApiConsumerPluginV1, request: FileTaskTitlesDeveloperAccessRequestV1<C>, options: FileTaskTitlesDeveloperOptionsV1): FileTaskTitlesDeveloperAccessResultV1<C> {
 const fail = (code: Parameters<typeof structuredErrorV1>[0], reason: string): FileTaskTitlesDeveloperAccessResultV1<C> => Object.freeze({ contractVersion: 1, kind: 'file-task-titles-developer-api-access-result', ok: false, error: structuredErrorV1(code, reason) });
 if (!isRecord(request) || !exactKeys(request, ['contractVersion', 'runtimeApi', 'requestedCapabilities']) || request.contractVersion !== 1 || !isRecord(request.runtimeApi) || !exactKeys(request.runtimeApi, ['min', 'max']) || !Number.isSafeInteger(request.runtimeApi.min) || !Number.isSafeInteger(request.runtimeApi.max) || request.runtimeApi.min < 1 || request.runtimeApi.min > request.runtimeApi.max || !Array.isArray(request.requestedCapabilities) || !request.requestedCapabilities.length || request.requestedCapabilities.length > FILE_TASK_TITLES_CAPABILITIES_V1.length || !request.requestedCapabilities.every(c => typeof c === 'string' && isFileTaskTitlesCapabilityV1(c)) || new Set(request.requestedCapabilities).size !== request.requestedCapabilities.length) return fail('invalid-request', 'Invalid File Task title access request.');
 if (!options.isDesktopAvailable() || !options.isHostVersionSupported()) return fail('unsupported-platform', 'This extension requires supported Obsidian Desktop.');
 if (request.runtimeApi.min > 1 || request.runtimeApi.max < 1) return fail('unsupported-version', 'The requested API range does not include V1.');
 if (!core || !core.fileTaskTitles || !options.isCoreActive(core)) return fail('handler-unavailable', 'The File Task title Runtime is unavailable.');
 const consumer = options.grantController.verifyConsumer(consumerPlugin);
 if (!consumer) return fail('authority-insufficient', 'The consumer is not the active host plugin instance.');
 const capabilities = Object.freeze([...request.requestedCapabilities]) as unknown as C;
 const grant = options.grantController.evaluate(consumer, capabilities);
 if (grant.state !== 'active') {
  if (grant.state === 'pending') options.grantController.recordPending(consumer, capabilities);
  return fail('authority-insufficient', 'The exact File Task title capabilities require an active grant.');
 }
 if (options.lifecyclePhase() !== 'ready') return fail('live-settling', 'The Runtime is not ready.');
 if (capabilities.some(capability => !core.hasCapability(capability))) return fail('capability-unavailable', 'A requested File Task title capability is unavailable.');
 return Object.freeze({ contractVersion: 1, kind: 'file-task-titles-developer-api-access-result', ok: true, api: createFileTaskTitlesDeveloperSessionV1(core, consumer, capabilities, options) });
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
 return Reflect.ownKeys(value).length === keys.length && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key));
}
