import { CapabilityIdV1, MutationKindV1 } from './capabilities.js';
import type { FieldValueTypeV1 } from './catalog.js';
import { AffectedResourceRevisionMapV1, ContextRevisionV1, FileTaskSourceLocatorV1, InlineTaskSourceLocatorV1, ResourceKindV1, SourceRevisionV1, TaskSourceLocatorV1 } from './identity.js';
import { CONTRACT_VERSION_V1, ContractWarningV1, StructuredErrorV1 } from './primitives.js';
export declare const RISK_LEVELS_V1: readonly ["none", "routine", "elevated", "destructive"];
export type RiskLevelV1 = typeof RISK_LEVELS_V1[number];
export declare const AUTHORIZATION_BASES_V1: readonly ["user-explicit-request", "user-explicit-confirmation", "user-standing-instruction", "host-policy"];
export type AuthorizationBasisV1 = typeof AUTHORIZATION_BASES_V1[number];
export interface MutationAuthorizationV1 {
    basis: AuthorizationBasisV1;
    reason?: string;
}
export interface MutationAcknowledgementV1 {
    code: string;
    planHash: string;
    targetDigest: string;
    acknowledgedAt: string;
}
export type GeneralUpdateValueV1 = string | number | boolean | string[];
export type GeneralUpdateSetItemV1 = {
    field: string;
    valueType: Extract<FieldValueTypeV1, 'text' | 'date' | 'datetime'>;
    value: string;
} | {
    field: string;
    valueType: 'number';
    value: number;
} | {
    field: string;
    valueType: 'list';
    value: string[];
} | {
    field: string;
    valueType: 'checkbox';
    value: boolean;
};
export type GeneralUpdateClearItemV1 = {
    operation: 'clear';
    field: string;
    valueType: FieldValueTypeV1;
};
export type GeneralUpdateItemV1 = GeneralUpdateSetItemV1 | GeneralUpdateClearItemV1;
export type UpdateTaskChangesV1 = readonly GeneralUpdateItemV1[];
export interface ExactMutationTargetV1 {
    operonId: string;
    locator: TaskSourceLocatorV1;
}
export type CreateTaskReferenceV1 = {
    kind: 'existing';
    operonId: string;
} | {
    kind: 'created';
    itemRef: string;
};
export type CreateTaskDependencyRelationV1 = 'blocks' | 'blocked-by';
export interface CreateTaskDependencyV1 {
    relation: CreateTaskDependencyRelationV1;
    target: CreateTaskReferenceV1;
}
export type CreateTaskTargetV1 = {
    mode: 'configured-default';
    representation?: never;
    filePath?: never;
    lineNumber?: never;
    templateId?: never;
} | {
    representation: 'inline';
    mode: 'configured-default';
    filePath?: never;
    lineNumber?: never;
} | {
    representation: 'inline';
    mode: 'exact-path';
    filePath: string;
    lineNumber?: number;
} | {
    representation: 'file';
    mode: 'configured-default';
    filePath?: never;
    templateId?: string;
} | {
    representation: 'file';
    mode: 'exact-path';
    filePath: string;
    templateId?: string;
};
export type CreateFieldItemV1 = {
    kind: 'text';
    field: 'taskIcon' | 'taskColor' | 'note' | 'location';
    value: string;
} | {
    kind: 'date';
    field: 'dateDue' | 'dateScheduled' | 'dateStarted';
    value: string;
} | {
    kind: 'datetime';
    field: 'datetimeStart' | 'datetimeEnd';
    value: string;
} | {
    kind: 'number';
    field: 'estimate';
    value: number;
} | {
    kind: 'list';
    field: 'assignees' | 'contexts' | 'links';
    value: string[];
} | ({
    kind: 'custom';
} & GeneralUpdateSetItemV1) | {
    kind: 'reminder-datetimes';
    values: string[];
} | {
    kind: 'reminder-rules';
    values: string[];
} | {
    kind: 'recurrence';
    rule: string;
    endDatetime?: string;
};
export interface CreateTaskItemV1 {
    itemRef: string;
    description: string;
    target: CreateTaskTargetV1;
    fields: CreateFieldItemV1[];
    /** Omit to inherit configured parent tags; an explicit array replaces them. */
    tags?: string[];
    statusId?: string;
    priorityId?: string;
    parent?: CreateTaskReferenceV1;
    related?: CreateTaskReferenceV1[];
    dependencies?: CreateTaskDependencyV1[];
    /** File Task body content. Only valid when the requested representation is explicitly file. */
    bodyMarkdown?: string;
}
export interface CreateTaskSpecV1 {
    operation: 'create';
    items: CreateTaskItemV1[];
}
export interface UpdateTaskSpecV1 {
    operation: 'update';
    changes: UpdateTaskChangesV1;
}
export interface UpdateTaskBatchItemV1 {
    itemRef: string;
    target: ExactMutationTargetV1;
    changes: UpdateTaskChangesV1;
}
export interface UpdateTaskBatchSpecV1 {
    operation: 'update-batch';
    items: readonly UpdateTaskBatchItemV1[];
}
export declare const RECURRENCE_UPDATE_SCOPES_V1: readonly ["this-task", "this-and-following"];
export type RecurrenceUpdateScopeV1 = typeof RECURRENCE_UPDATE_SCOPES_V1[number];
export type RecurrenceUpdateSetItemV1 = {
    field: 'repeat';
    valueType: 'text';
    value: string;
    expectedValue?: string;
} | {
    field: 'datetimeRepeatEnd' | 'datetimeStart' | 'datetimeEnd';
    valueType: 'datetime';
    value: string;
    expectedValue?: string;
} | {
    field: 'dateScheduled' | 'dateStarted' | 'dateDue';
    valueType: 'date';
    value: string;
    expectedValue?: string;
} | {
    field: 'estimate';
    valueType: 'number';
    value: number;
    expectedValue?: number;
};
export type RecurrenceUpdateClearItemV1 = {
    operation: 'clear';
    field: 'repeat';
    valueType: 'text';
    expectedValue?: string;
} | {
    operation: 'clear';
    field: 'datetimeRepeatEnd' | 'datetimeStart' | 'datetimeEnd';
    valueType: 'datetime';
    expectedValue?: string;
} | {
    operation: 'clear';
    field: 'dateScheduled' | 'dateStarted' | 'dateDue';
    valueType: 'date';
    expectedValue?: string;
} | {
    operation: 'clear';
    field: 'estimate';
    valueType: 'number';
    expectedValue?: number;
};
export type RecurrenceUpdateItemV1 = RecurrenceUpdateSetItemV1 | RecurrenceUpdateClearItemV1;
export interface RecurrenceExpectedStateV1 {
    /** Exact normalized values of all recurrence-writable fields that are present. */
    fieldValues: Partial<Record<'repeat' | 'datetimeRepeatEnd' | 'dateScheduled' | 'dateStarted' | 'dateDue' | 'datetimeStart' | 'datetimeEnd', string> & Record<'estimate', number>>;
    repeatSeriesId: string | null;
    repeatOccurrenceDate: string | null;
}
export interface UpdateTaskRecurrenceSpecV1 {
    operation: 'update-recurrence';
    scope: RecurrenceUpdateScopeV1;
    changes: RecurrenceUpdateItemV1[];
    /** Runtime-sealed exact state; a reduced preview intent omits it. */
    expected?: RecurrenceExpectedStateV1;
}
export type TaskRelationshipFieldV1 = 'parentTask' | 'blocking' | 'blockedBy';
export interface ReplaceTaskRelationshipChangeV1 {
    field: TaskRelationshipFieldV1;
    /**
     * Complete desired relation value. An empty array clears the field.
     * `parentTask` accepts at most one target.
     */
    targetOperonIds: string[];
    /** Runtime-sealed exact value observed during preview. */
    expectedTargetOperonIds?: string[];
}
export interface ReplaceTaskRelationshipsSpecV1 {
    operation: 'replace-relationships';
    changes: ReplaceTaskRelationshipChangeV1[];
    /**
     * Runtime-sealed sorted union of the exact source task and every task whose
     * relationship or ancestor-derived metadata can be affected.
     */
    affectedOperonIds?: string[];
}
export declare function validateTaskRelationshipSpecV1(spec: ReplaceTaskRelationshipsSpecV1): string | null;
export declare function isCanonicalRelationshipIdListV1(values: readonly string[]): boolean;
export interface ReminderItemSpecV1 {
    operation: 'add' | 'replace' | 'remove';
    collection: 'reminderDatetimes' | 'reminderRules';
    itemId?: string;
    value?: string;
    expectedValue?: string;
}
export interface TransitionTaskSpecV1 {
    operation: 'transition';
    targetStatusId: string;
    expectedStatusId?: string;
    /** Optional allowlisted fields committed in the same sealed task-source write. */
    changes?: GeneralUpdateItemV1[];
}
export interface PinnedTaskStateSpecV1 {
    operation: 'set-pinned';
    pinned: boolean;
    /** Runtime-sealed current state; reduced preview intents may omit it. */
    expectedPinned?: boolean;
    /** Runtime-sealed SHA-256 revision of the exact pinned-state package entry. */
    expectedEntryRevision?: string;
    /** Runtime-sealed timestamp used as the deterministic package entry revision time. */
    effectiveAt?: string;
}
export interface TimerControlSpecV1 {
    operation: 'start' | 'stop';
    expectedActiveStart?: string;
}
export type TimerSessionOperationV1 = 'add-session' | 'update-session' | 'remove-session';
export interface TimerSessionSpecV1 {
    operation: TimerSessionOperationV1;
    sessionNumber?: number;
    start?: string;
    end?: string;
    /** Runtime-sealed exact task tracker state. */
    expectedTrackers?: string;
    expectedDuration?: number;
    selectedRawIndex?: number;
    expectedStart?: string;
    expectedEnd?: string;
    nextTrackers?: string;
    nextDuration?: number;
    effectiveAt?: string;
}
export interface InlineToFileConvertTaskSpecV1 {
    operation: 'convert';
    from: 'inline';
    to: 'file';
    templateId: string;
    targetPath?: string;
}
export type FileToInlineTargetV1 = {
    mode: 'exact-line';
    filePath: string;
    lineNumber: number;
} | {
    mode: 'configured-target';
    filePath?: string;
};
export interface FileToInlineConvertTaskSpecV1 {
    operation: 'convert';
    from: 'file';
    to: 'inline';
    target: FileToInlineTargetV1;
}
export type ConvertTaskSpecV1 = InlineToFileConvertTaskSpecV1 | FileToInlineConvertTaskSpecV1;
export interface RelocateInlineTaskSpecV1 {
    operation: 'relocate-inline';
    source: {
        locator: Extract<TaskSourceLocatorV1, {
            representation: 'inline';
        }>;
        lineDigest: string;
        sourceRevision: SourceRevisionV1;
    };
    destination: {
        locator: Extract<TaskSourceLocatorV1, {
            representation: 'inline';
        }>;
        lineDigest: string;
        sourceRevision: SourceRevisionV1;
        mustBeBlank: true;
    };
}
/**
 * Public preview-only relocation intent. Runtime resolves and seals both
 * source revisions and exact line digests before a plan is hashed.
 */
export interface RelocateInlineTaskPreviewIntentV1 {
    operation: 'relocate-inline';
    destination: {
        locator: Extract<TaskSourceLocatorV1, {
            representation: 'inline';
        }>;
        mustBeBlank: true;
    };
}
export interface DeleteTaskSpecV1 {
    operation: 'delete';
    mode: 'delete-exact-task';
    cascade: false;
}
export type MutationSpecV1 = CreateTaskSpecV1 | UpdateTaskSpecV1 | UpdateTaskBatchSpecV1 | UpdateTaskRecurrenceSpecV1 | ReplaceTaskRelationshipsSpecV1 | ReminderItemSpecV1 | TransitionTaskSpecV1 | PinnedTaskStateSpecV1 | TimerControlSpecV1 | TimerSessionSpecV1 | ConvertTaskSpecV1 | RelocateInlineTaskSpecV1 | DeleteTaskSpecV1;
export type MutationPreviewSpecV1 = MutationSpecV1 | RelocateInlineTaskPreviewIntentV1;
export interface MutationPreviewRequestV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'mutation-preview';
    clientInstanceId: string;
    idempotencyKey: string;
    correlationId?: string;
    capability: CapabilityIdV1;
    mutationKind: MutationKindV1;
    target?: ExactMutationTargetV1;
    spec: MutationPreviewSpecV1;
    authorization: MutationAuthorizationV1;
}
export interface PredictedEffectV1 {
    resourceKind: ResourceKindV1;
    resourceKey: string;
    action: 'create' | 'update' | 'trash' | 'state-change';
    summary: string;
}
export interface AtomicResourceGroupV1 {
    groupId: string;
    order: number;
    resources: Array<{
        resourceKind: ResourceKindV1;
        resourceKey: string;
    }>;
}
export type CreateEffectSourcePreconditionV1 = {
    targetBeforeDigest: string;
    expectedAbsence?: never;
} | {
    targetBeforeDigest?: never;
    expectedAbsence: true;
};
export type SealedCreateEffectV1 = {
    itemRef: string;
    operonId: string;
    repeatSeriesId?: string;
    locator: InlineTaskSourceLocatorV1 | FileTaskSourceLocatorV1;
    renderedTaskDigest: string;
    plannedSourceDigest: string;
    templateId?: string;
    templateDigest?: string;
    resolvedParentOperonId?: string;
    resolvedRelatedOperonIds: string[];
    resolvedDependencies?: Array<{
        relation: CreateTaskDependencyRelationV1;
        operonId: string;
    }>;
    bodyMarkdownSummary?: {
        utf8Bytes: number;
        sha256: string;
    };
} & CreateEffectSourcePreconditionV1;
export interface ConversionLossItemV1 {
    kind: 'body-content' | 'html-comments' | 'unmanaged-frontmatter' | 'reserved-frontmatter' | 'inline-time-prefix';
    key?: string;
    digest: string;
}
export interface ConversionFieldDiffV1 {
    field: string;
    source: 'default' | 'inheritance';
    before?: GeneralUpdateValueV1;
    after: GeneralUpdateValueV1;
}
export interface SealedConversionEffectV1 {
    direction: 'inline-to-file' | 'file-to-inline';
    operonId: string;
    beforeLocator: TaskSourceLocatorV1;
    afterLocator: TaskSourceLocatorV1;
    plannedTargetDigest: string;
    plannedSourceDigest: string;
    settingsFingerprint: string;
    templateId?: string;
    templateRevision?: string;
    resolvedFieldDiff: ConversionFieldDiffV1[];
    checkboxCarryoverDigest?: string;
    checkboxCarryoverCount?: number;
    lossManifest: ConversionLossItemV1[];
    lossManifestDigest: string;
    parentOperonId?: string;
    repeatSeriesId?: string;
}
export interface SealedUpdateBatchEffectV1 {
    itemRef: string;
    operonId: string;
    locator: InlineTaskSourceLocatorV1;
    beforeDigest: string;
    requestedCanonicalFields: string[];
    action: 'update' | 'no-change';
    directChange: boolean;
    plannedSourceDigest: string;
}
export interface SealedMutationPlanV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    planId: string;
    planHash: string;
    clientInstanceId: string;
    correlationId: string;
    idempotencyKeyHash: string;
    receiptTargetDigest: string;
    capability: CapabilityIdV1;
    mutationKind: MutationKindV1;
    createdAt: string;
    expiresAt: string;
    targets: Array<{
        operonId?: string;
        locator?: TaskSourceLocatorV1;
        targetDigest: string;
    }>;
    contextRevision: ContextRevisionV1;
    affectedResources: AffectedResourceRevisionMapV1;
    atomicGroups: AtomicResourceGroupV1[];
    predictedEffects: PredictedEffectV1[];
    riskLevel: RiskLevelV1;
    requiresConfirmation: boolean;
    requiredAcknowledgements: string[];
    warnings: ContractWarningV1[];
    spec: MutationSpecV1;
    createEffects?: SealedCreateEffectV1[];
    conversionEffect?: SealedConversionEffectV1;
    updateBatchEffects?: SealedUpdateBatchEffectV1[];
}
export type MutationPreviewResultV1 = {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'mutation-preview-result';
    warnings: ContractWarningV1[];
} & ({
    ok: true;
    plan: SealedMutationPlanV1;
    error?: never;
} | {
    ok: false;
    plan?: never;
    error: StructuredErrorV1;
});
export interface MutationApplyRequestV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'mutation-apply';
    plan: SealedMutationPlanV1;
    authorization: MutationAuthorizationV1;
    idempotencyKey: string;
    acknowledgements: MutationAcknowledgementV1[];
}
export declare const ATOMIC_GROUP_OUTCOME_VOCABULARY_V1: readonly ["committed", "failed", "compensated", "outcome-unknown"];
/** V1 has no compensation implementation; `compensated` is reserved and cannot be emitted. */
export declare const ATOMIC_GROUP_STATUSES_V1: readonly ["committed", "failed", "outcome-unknown"];
export type AtomicGroupStatusV1 = typeof ATOMIC_GROUP_STATUSES_V1[number];
export interface AtomicGroupResultV1 {
    groupId: string;
    status: AtomicGroupStatusV1;
    resourceRevisions?: AffectedResourceRevisionMapV1;
    error?: StructuredErrorV1;
}
export declare const MUTATION_RESULT_STATUSES_V1: readonly ["applied", "already-applied", "partial", "failed", "outcome-unknown"];
export type MutationResultStatusV1 = typeof MUTATION_RESULT_STATUSES_V1[number];
export type MutationAmbiguitySourceV1 = 'group-outcome' | 'receipt-persist-failure';
export interface MutationContinuationV1 {
    originPlanHash: string;
    remainingGroupIds: string[];
    plan: SealedMutationPlanV1;
}
export interface MutationReceiptV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    vaultIdentityHash: string;
    clientInstanceId: string;
    idempotencyKeyHash: string;
    planHash: string;
    mutationKind: MutationKindV1;
    targetDigest: string;
    terminalOutcome: 'applied' | 'already-applied' | 'outcome-unknown';
    effectiveAt: string;
    completedAt: string;
    expiresAt: string;
}
export interface MutationResultAdmissionScopeV1 {
    vaultIdentityHash: string;
    clientInstanceId: string;
}
export type MutationPostflightV1 = {
    status: 'verified';
    observedAt: string;
    contextRevision: ContextRevisionV1;
} | {
    status: 'receipt-replay';
};
export interface MutationResultV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'mutation-result';
    status: MutationResultStatusV1;
    mutationMayHaveApplied: boolean;
    retryAllowed: boolean;
    groupResults: AtomicGroupResultV1[];
    continuation?: MutationContinuationV1;
    ambiguitySource?: MutationAmbiguitySourceV1;
    receipt?: MutationReceiptV1;
    postflight?: MutationPostflightV1;
    error?: StructuredErrorV1;
}
export declare function requiredRiskForSpecV1(spec: MutationPreviewSpecV1): RiskLevelV1;
export declare function authorizationPermitsRiskV1(authorization: MutationAuthorizationV1, risk: RiskLevelV1): boolean;
