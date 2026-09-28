import type { CapabilityAdvertisementV1 } from '../../contracts/v1/capabilities';
import type { MutationPreviewRequestV1, MutationApplyRequestV1, MutationPreviewResultV1, MutationResultV1, SealedMutationPlanV1 } from '../../contracts/v1/mutation';
import type { AdoptTaskSealedPlanV1, TaskWorkflowPreviewRequestV1, TaskWorkflowPreviewResultV1, TaskWorkflowMutationResultV1, TaskFilterQueryRequestV1, TaskFilterQueryResultV1 } from '../task-workflows-v1/contracts';

/** Explicit opt-in; frozen V1 and task-workflow inputs never select this policy. */
export const CHECKBOX_OWNERSHIP_CAPABILITIES_V1 = [
 'tasks.filter-query.contiguous',
 'tasks.create.contiguous.preview', 'tasks.create.contiguous.apply',
 'tasks.adopt.contiguous.preview', 'tasks.adopt.contiguous.apply',
 'tasks.inline.relocate.contiguous.preview', 'tasks.inline.relocate.contiguous.apply',
 'tasks.convert.contiguous.preview', 'tasks.convert.contiguous.apply',
] as const;
export type CheckboxOwnershipCapabilityV1 = typeof CHECKBOX_OWNERSHIP_CAPABILITIES_V1[number];
export type CheckboxOwnershipPreviewCapabilityV1 = Extract<CheckboxOwnershipCapabilityV1, `${string}.preview`>;
export type CheckboxOwnershipApplyCapabilityV1 = Extract<CheckboxOwnershipCapabilityV1, `${string}.apply`>;
export const CHECKBOX_OWNERSHIP_EXTENSION_V1 = 'checkbox-ownership-v1' as const;
export function isCheckboxOwnershipCapabilityV1(value: string): value is CheckboxOwnershipCapabilityV1 {
 return (CHECKBOX_OWNERSHIP_CAPABILITIES_V1 as readonly string[]).includes(value);
}
export function checkboxOwnershipApplyCapabilityV1(capability: CheckboxOwnershipPreviewCapabilityV1): CheckboxOwnershipApplyCapabilityV1 {
 return capability.replace(/preview$/u, 'apply') as CheckboxOwnershipApplyCapabilityV1;
}
export function checkboxOwnershipAdvertisementsV1(available: boolean): CapabilityAdvertisementV1[] {
 return CHECKBOX_OWNERSHIP_CAPABILITIES_V1.map(id => ({ id, availability: available ? 'available' : 'unavailable', stability: 'stable' }));
}

type CorePreview<C extends CheckboxOwnershipPreviewCapabilityV1, K extends MutationPreviewRequestV1['mutationKind'], S> =
 Omit<MutationPreviewRequestV1, 'capability' | 'mutationKind' | 'spec'> & { capability: C; mutationKind: K; spec: S };
type ExtensionPreview<T, C> = Omit<T, 'capability'> & { capability: C };
export type CheckboxOwnershipPreviewRequestV1 =
 | CorePreview<'tasks.create.contiguous.preview', 'task.create', Extract<MutationPreviewRequestV1['spec'], { operation: 'create' }>>
 | ExtensionPreview<Extract<TaskWorkflowPreviewRequestV1, { capability: 'tasks.adopt.preview' }>, 'tasks.adopt.contiguous.preview'>
 | (CorePreview<'tasks.inline.relocate.contiguous.preview', 'task.inline-relocate', import('../../contracts/v1/mutation').RelocateInlineTaskPreviewIntentV1> & { target: NonNullable<MutationPreviewRequestV1['target']> })
 | (CorePreview<'tasks.convert.contiguous.preview', 'task.convert', Extract<MutationPreviewRequestV1['spec'], { from: 'inline' }>> & { target: NonNullable<MutationPreviewRequestV1['target']> });
export type CheckboxOwnershipExecutionPlanV1 = SealedMutationPlanV1 | AdoptTaskSealedPlanV1;
/** Outer seal binds capability and the unchanged inner execution plan. */
export type CheckboxOwnershipSealedPlanV1 = Omit<CheckboxOwnershipExecutionPlanV1, 'capability' | 'planHash' | 'idempotencyKeyHash'> & {
 extension: typeof CHECKBOX_OWNERSHIP_EXTENSION_V1;
 capability: CheckboxOwnershipPreviewCapabilityV1;
 planHash: string;
 idempotencyKeyHash: string;
 executionPlan: CheckboxOwnershipExecutionPlanV1;
 /** Adoption includes the parent update in its one guarded source write. */
 adoptionAfterDigest?: string;
};
export type CheckboxOwnershipPreviewResultV1 = Exclude<MutationPreviewResultV1, { ok: true }> | {
 contractVersion: 1; requestId: string; kind: 'mutation-preview-result'; ok: true;
 warnings: MutationPreviewResultV1['warnings']; plan: CheckboxOwnershipSealedPlanV1;
};
export type CheckboxOwnershipApplyRequestV1 = Omit<MutationApplyRequestV1, 'plan'> & { plan: CheckboxOwnershipSealedPlanV1 };
export type CheckboxOwnershipMutationResultV1 = Omit<MutationResultV1 | TaskWorkflowMutationResultV1, 'continuation'> & { continuation?: { originPlanHash: string; remainingGroupIds: string[]; plan: CheckboxOwnershipSealedPlanV1 } };
export type CheckboxOwnershipFilterRequestV1 = Omit<TaskFilterQueryRequestV1, 'kind'> & { kind: 'task-filter-query-contiguous' };
export type CheckboxOwnershipFilterResultV1 = TaskFilterQueryResultV1;
export type CheckboxOwnershipInnerPreviewResultV1 = MutationPreviewResultV1 | TaskWorkflowPreviewResultV1;
