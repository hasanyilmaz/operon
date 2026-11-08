import type { TaskWorkflowDeveloperApiRuntimeOptionsV1, TaskWorkflowDeveloperPendingRecoveriesResultV1 } from '../task-workflows-v1/developer-api';
import type { TaskCreationCapabilityV1, RoutedTaskCreationPlanV1, RoutedTaskCreationMutationResultV1, RoutedTaskCreationApplyRequestV1 } from './contracts';
import type { TaskCreationDeveloperPlanHandleV1, TaskCreationDeveloperPreviewIntentV1, TaskCreationDeveloperPreviewResultV1, TaskCreationDeveloperExecutionResultV1, TaskCreationDeveloperMutationContractV1 } from './developer-api';
export { isTaskCreationCapabilityV1, type TaskCreationCapabilityV1 } from './contracts';
export { decodeRoutedTaskCreationPreviewV1 as decodeTaskCreationPreviewV1 } from './decode';
export type TaskCreationSealedPlanV1=RoutedTaskCreationPlanV1;
export type TaskCreationMutationResultV1=RoutedTaskCreationMutationResultV1;
export type TaskCreationApplyRequestV1=RoutedTaskCreationApplyRequestV1;
export type TaskCreationPlanHandleV1=TaskCreationDeveloperPlanHandleV1;
export type {TaskCreationDeveloperPreviewIntentV1,TaskCreationDeveloperPreviewResultV1,TaskCreationDeveloperExecutionResultV1};
export type TaskCreationDeveloperOptionsV1=Omit<TaskWorkflowDeveloperApiRuntimeOptionsV1,'recoverTaskWorkflowMutation'>;
export type TaskCreationCapabilitySubsetV1=readonly TaskCreationCapabilityV1[];
export type TaskCreationRecoverInputV1={readonly plan:TaskCreationPlanHandleV1;readonly recoveryRef?:never}|{readonly recoveryRef:string;readonly plan?:never};
type PendingResult<T> = T extends unknown ? Omit<T,'kind'> & {readonly kind:'task-creation-developer-pending-recoveries-result'} : never;
export type TaskCreationPendingRecoveriesResultV1=PendingResult<TaskWorkflowDeveloperPendingRecoveriesResultV1>;
export type TaskCreationDeveloperApiV1<C extends TaskCreationCapabilitySubsetV1=TaskCreationCapabilitySubsetV1>={readonly contractVersion:1;readonly runtimeApi:1;readonly tasks:Readonly<Record<never,never>>;readonly mutations:Partial<TaskCreationDeveloperMutationContractV1 & {recover(input:TaskCreationRecoverInputV1):Promise<TaskCreationDeveloperExecutionResultV1>;pendingRecoveries():Promise<TaskCreationPendingRecoveriesResultV1>}>;readonly __capabilities?:C};
export function taskCreationApplyCapabilityV1(_capability:string):'tasks.create.routed.apply' {return 'tasks.create.routed.apply';}
export function isTaskCreationPreviewCapabilityV1(capability:unknown):capability is 'tasks.create.routed.preview' {return capability==='tasks.create.routed.preview';}
export function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean {return Reflect.ownKeys(value).length===keys.length && Reflect.ownKeys(value).every(key=>typeof key==='string' && keys.includes(key));}
