import type { VaultPropertyValue } from '../../../core/vault-property-codec';
import type { InlinePropertyDefinition } from '../../../core/inline-property-definitions';
import type { IdentityPlaceholderCreateSpecV1, PeriodicNoteCreateSpecV1, PeriodicNoteCreateSealedPlanV1, TemplateIdentityAllocationV1 } from '../task-workflows-v1/contracts';
import type { CapabilityAdvertisementV1 } from '../../contracts/v1/capabilities';
import type { CatalogRequestV1 } from '../../contracts/v1/catalog';
import type { CreateTaskItemV1, CreateTaskSpecV1, MutationPreviewRequestV1, MutationApplyRequestV1, MutationPreviewResultV1, MutationResultV1, SealedMutationPlanV1 } from '../../contracts/v1/mutation';
import type { StructuredErrorV1 } from '../../contracts/v1/primitives';
import type { TaskWorkflowCliInvocationBaseV1, TaskWorkflowCliResultEnvelopeV1 } from '../task-workflows-v1/contracts';

export const TASK_CREATION_EXTENSION_V1 = 'task-creation-v1' as const;
export const TASK_CREATION_CAPABILITIES_V1 = ['tasks.creation-policy.read', 'tasks.create.routed.preview', 'tasks.create.routed.apply'] as const;
export type TaskCreationCapabilityV1 = typeof TASK_CREATION_CAPABILITIES_V1[number];
export function isTaskCreationCapabilityV1(value: string): value is TaskCreationCapabilityV1 {
 return (TASK_CREATION_CAPABILITIES_V1 as readonly string[]).includes(value);
}
export function taskCreationAdvertisementsV1(ready: boolean, mutationsReady = false): CapabilityAdvertisementV1[] {
 return TASK_CREATION_CAPABILITIES_V1.map(id => ({ id, stability: 'stable', availability: id === 'tasks.creation-policy.read' || mutationsReady ? ready ? 'available' : 'unavailable' : 'contract-only', ...(id === 'tasks.creation-policy.read' || mutationsReady ? {} : { reason: 'Routed creation execution is not enabled.' }) }));
}
export type TaskCreationPolicyRequestV1 = Omit<CatalogRequestV1, 'kind' | 'consistency'> & { kind: 'task-creation-policy'; consistency: 'live-verified' };
export interface PeriodicCreationPolicyV1 {
 kind: 'daily' | 'weekly'; available: boolean; reason: 'operon-disabled' | 'core-daily-notes-unavailable' | 'invalid-config' | null;
 source: 'operon' | 'core-daily-notes' | null;
 config: { folder: string; format: string; template: string; createAsOperonTask: boolean } | null;
}
export interface TaskCreationPolicyV1 {
 defaultRepresentation: 'inline' | 'file';
 inline: {
  configuredSaveMode: 'daily-notes' | 'weekly-notes' | 'specific-file' | 'active-file' | 'ask-every-time';
  saveMode: 'daily-notes' | 'weekly-notes' | 'specific-file' | 'active-file' | 'ask-every-time';
  requiresExplicitTarget: boolean; targetFile: string; heading: string;
  parentInline: 'default' | 'below-parent'; parentFile: 'default' | 'inside-parent-file'; parentFileHeading: string;
  dailyAddsStartDate: boolean; dailyAddsScheduledDate: boolean;
 };
 file: {
  folder: string; pipelineLocations: Array<{ pipelineId: string; folder: string }>;
  parentInline: 'default' | 'same-folder'; parentFile: 'default' | 'same-folder';
  displayTitleEnabled: boolean; titleChangeMode: 'keep' | 'ask' | 'auto'; filenameFormat: 'same' | 'kebab' | 'snake';
 };
 periodic: { daily: PeriodicCreationPolicyV1; weekly: PeriodicCreationPolicyV1 };
 templates: {
  defaultInlineId: string | null; defaultFileId: string | null;
  candidates: Array<{ id: string; name: string; kind: 'builtin-pipeline-minimal' | 'folder'; sourcePath: string | null }>;
  execution: 'deterministic-only'; inlineContent: 'properties-only'; remembersLastSelection: false;
 };
 exclusions: string[];
 limits: { tasksPerRequest: 1; activeFile: 'explicit-target-required'; templater: 'not-executed' };
}
export type TaskCreationPolicyResultV1 = { contractVersion: 1; requestId: string; kind: 'task-creation-policy-result' } & (
 | { ok: true; policy: TaskCreationPolicyV1; policyRevision: string; error?: never }
 | { ok: false; error: StructuredErrorV1; policy?: never; policyRevision?: never }
);
export type TaskCreationTargetV1 =
 | { mode: 'configured-default'; representation?: 'inline' | 'file' }
 | { mode: 'exact-path'; representation: 'inline'; filePath: string; lineNumber?: number }
 | { mode: 'exact-path'; representation: 'file'; filePath: string }
 | { mode: 'periodic-note'; representation: 'inline'; periodicKind: 'daily' | 'weekly'; routeDate?: string };
export type TaskCreationTemplateV1 = { mode: 'configured' | 'none' } | { mode: 'selected'; templateId: string };
/** Exactly one item. title is human input; File Task identity remains its physical path. */
export interface RoutedTaskCreationSpecV1 {
 operation: 'create';
 item: Omit<CreateTaskItemV1, 'description' | 'target'> & { title: string; target: TaskCreationTargetV1; template: TaskCreationTemplateV1; nativeProperties?: Array<{ sourceName: string; value: VaultPropertyValue }> };
}
export type RoutedTaskCreationPreviewRequestV1 = Omit<MutationPreviewRequestV1, 'capability' | 'mutationKind' | 'target' | 'spec'> & {
 capability: 'tasks.create.routed.preview'; mutationKind: 'task.create'; target?: never; spec: RoutedTaskCreationSpecV1;
};
/** Reserved contract; Stage 1 never issues or accepts an executable plan. */
export type RoutedTaskCreationPlanV1 = Omit<SealedMutationPlanV1, 'capability' | 'spec' | 'mutationKind'> & {
 mutationKind: 'task.create'; extension: typeof TASK_CREATION_EXTENSION_V1; capability: 'tasks.create.routed.preview'; spec: RoutedTaskCreationSpecV1;
 policyRevision: string;
 creation?: RoutedCreationEvidenceV1;
};
export type RoutedTaskCreationApplyRequestV1 = Omit<MutationApplyRequestV1, 'plan'> & { plan: RoutedTaskCreationPlanV1 };
export type TaskCreationCliInvocationV1 = TaskWorkflowCliInvocationBaseV1 & ({ command: 'catalog'; request: TaskCreationPolicyRequestV1 } | {command:'mutation.preview';request:RoutedTaskCreationPreviewRequestV1} | {command:'mutation.apply';request:RoutedTaskCreationApplyRequestV1});
type Envelope<T> = T extends { ok: true } ? Omit<T, 'command' | 'result'> & { command: 'catalog'|'mutation.preview'|'mutation.apply'; result: TaskCreationPolicyResultV1|RoutedTaskCreationPreviewResultV1|RoutedTaskCreationMutationResultV1 } : Omit<T, 'command'> & { command: 'catalog'|'mutation.preview'|'mutation.apply' };
export type TaskCreationCliResultEnvelopeV1 = Envelope<TaskWorkflowCliResultEnvelopeV1>;

type WithPlan<T> = T extends { ok: true } ? Omit<T, 'plan'> & { plan: RoutedTaskCreationPlanV1 } : T;
export type RoutedTaskCreationPreviewResultV1 = WithPlan<MutationPreviewResultV1>;
/** No success/continuation can be returned while execution is contract-only. */
export type RoutedTaskCreationMutationResultV1 = { recoveryOutcome?: 'compensated' } & Omit<MutationResultV1, 'continuation' | 'receipt'> & { receipt?: Omit<NonNullable<MutationResultV1['receipt']>, 'mutationKind'> & { mutationKind: 'task.create' }; continuation?: Omit<NonNullable<MutationResultV1['continuation']>, 'plan'> & { plan: RoutedTaskCreationPlanV1 } };

/** Executable Stage 2 material; reserved Stage 1 plans without it cannot be applied. */
export interface RoutedCreationEvidenceV1 {
 version: 1;
 executionSpec: CreateTaskSpecV1 | IdentityPlaceholderCreateSpecV1 | PeriodicNoteCreateSpecV1;
 periodicRoute: PeriodicNoteCreateSealedPlanV1['periodicRoute'] | null;
 templateId: string | null;
 templateDigest: string;
 materialRevision: string;
 graphDigest: string;
 resolvedFields: Record<string,string>;
 resolvedTags: string[];
 nativeProperties: Array<{sourceName:string;value:VaultPropertyValue}>;
 allocations: string[];
 fileAllocations: TemplateIdentityAllocationV1[];
 definitions: InlinePropertyDefinition[];
 skipped: Array<{ sourceName: string; reason: string }>;
 retention: 'preserve-definitions-on-failure';
}
export type ExecutableRoutedCreationPlanV1 = RoutedTaskCreationPlanV1 & {
 creation: RoutedCreationEvidenceV1;
 createEffects: NonNullable<SealedMutationPlanV1['createEffects']>;
};

export type RoutedCreationSummaryV1 = Pick<RoutedCreationEvidenceV1,'resolvedFields'|'resolvedTags'|'nativeProperties'|'templateId'|'skipped'|'periodicRoute'> & {target:NonNullable<SealedMutationPlanV1['createEffects']>[number]['locator']};
