import type { CapabilityAdvertisementV1 } from '../../contracts/v1/capabilities';
import type { CreateTaskItemV1, MutationPreviewRequestV1, MutationApplyRequestV1, MutationPreviewResultV1, MutationResultV1, SealedMutationPlanV1 } from '../../contracts/v1/mutation';

export const FILE_TASK_TITLES_CAPABILITIES_V1 = ['tasks.file.create.preview', 'tasks.file.create.apply', 'tasks.file.title.preview', 'tasks.file.title.apply'] as const;
export type FileTaskTitlesCapabilityV1 = typeof FILE_TASK_TITLES_CAPABILITIES_V1[number];
export type FileTaskTitlesPreviewCapabilityV1 = Extract<FileTaskTitlesCapabilityV1, `${string}.preview`>;
export type FileTaskTitlesApplyCapabilityV1 = Extract<FileTaskTitlesCapabilityV1, `${string}.apply`>;
export const FILE_TASK_TITLES_EXTENSION_V1 = 'file-task-titles-v1' as const;
export function isFileTaskTitlesCapabilityV1(value: string): value is FileTaskTitlesCapabilityV1 { return (FILE_TASK_TITLES_CAPABILITIES_V1 as readonly string[]).includes(value); }
export function fileTaskTitlesApplyCapabilityV1(value: FileTaskTitlesPreviewCapabilityV1): FileTaskTitlesApplyCapabilityV1 { return value === 'tasks.file.create.preview' ? 'tasks.file.create.apply' : 'tasks.file.title.apply'; }
export function fileTaskTitlesAdvertisementsV1(available: boolean): CapabilityAdvertisementV1[] { return FILE_TASK_TITLES_CAPABILITIES_V1.map(id => ({ id, availability: available ? 'available' : 'unavailable', stability: 'stable' })); }
export type FileTaskTitleCreateSpecV1 = { operation: 'create-file'; item: Omit<CreateTaskItemV1, 'description' | 'target'> & { displayTitle: string; target: Extract<CreateTaskItemV1['target'], { representation: 'file' }> } };
/** Null removes the mapped title. This operation always preserves the physical filename. */
export type FileTaskTitleEditSpecV1 = { operation: 'set-title'; displayTitle: string | null };
type Base = Omit<MutationPreviewRequestV1, 'capability' | 'mutationKind' | 'spec' | 'target'>;
export type FileTaskTitlesPreviewRequestV1 =
 | (Base & { capability: 'tasks.file.create.preview'; mutationKind: 'task.create'; spec: FileTaskTitleCreateSpecV1; target?: never })
 | (Base & { capability: 'tasks.file.title.preview'; mutationKind: 'task.update'; spec: FileTaskTitleEditSpecV1; target: NonNullable<MutationPreviewRequestV1['target']> });
export type FileTaskTitlesSealedPlanV1 = Omit<SealedMutationPlanV1, 'capability' | 'spec'> & {
 extension: typeof FILE_TASK_TITLES_EXTENSION_V1;
 capability: FileTaskTitlesPreviewCapabilityV1;
 spec: FileTaskTitleCreateSpecV1 | FileTaskTitleEditSpecV1;
 executionPlan: SealedMutationPlanV1;
};
export type FileTaskTitlesPreviewResultV1 = Exclude<MutationPreviewResultV1, { ok: true }> | { contractVersion: 1; requestId: string; kind: 'mutation-preview-result'; ok: true; warnings: MutationPreviewResultV1['warnings']; plan: FileTaskTitlesSealedPlanV1 };
export type FileTaskTitlesApplyRequestV1 = Omit<MutationApplyRequestV1, 'plan'> & { plan: FileTaskTitlesSealedPlanV1 };
export type FileTaskTitlesMutationResultV1 = Omit<MutationResultV1, 'continuation'> & { recoveryOutcome?: 'compensated'; continuation?: { originPlanHash: string; remainingGroupIds: string[]; plan: FileTaskTitlesSealedPlanV1 } };

export type FileTaskTitlesCliInvocationV1 = import('../task-workflows-v1/contracts').TaskWorkflowCliInvocationBaseV1 & (
 | { command: 'mutation.preview'; request: FileTaskTitlesPreviewRequestV1 }
 | { command: 'mutation.apply'; request: FileTaskTitlesApplyRequestV1 }
);
type WithTitleResult<T> = T extends { ok: true } ? Omit<T, 'result' | 'command'> & { command: 'mutation.preview' | 'mutation.apply'; result: FileTaskTitlesPreviewResultV1 | FileTaskTitlesMutationResultV1 } : T;
export type FileTaskTitlesCliResultEnvelopeV1 = WithTitleResult<import('../task-workflows-v1/contracts').TaskWorkflowCliResultEnvelopeV1>;
