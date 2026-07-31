import type { ContextRevisionV1 } from './identity.js';
import { CONTRACT_VERSION_V1, type ConsistencyV1, type ContractWarningV1, type FreshnessV1, type StructuredErrorV1 } from './primitives.js';
export declare const FIELD_VALUE_TYPES_V1: readonly ["text", "number", "date", "datetime", "list", "checkbox"];
export type FieldValueTypeV1 = typeof FIELD_VALUE_TYPES_V1[number];
export declare const MUTATION_CLASSES_V1: readonly ["general-update", "semantic-capability", "runtime-owned"];
export type MutationClassV1 = typeof MUTATION_CLASSES_V1[number];
export declare const FIELD_CATALOG_LIMITS_V1: Readonly<{
    descriptors: 512;
    canonicalKeyCharacters: 256;
    displayNameCharacters: 256;
    descriptionCharacters: 4096;
    mutationOwnerCharacters: 256;
}>;
export interface FieldDescriptorV1 {
    canonicalKey: string;
    displayName: string;
    description: string;
    valueType: FieldValueTypeV1;
    source: 'built-in' | 'custom';
    mappingStatus: 'mapped' | 'unmapped' | 'collision' | 'reserved';
    readable: boolean;
    mutationClass: MutationClassV1;
    mutationOwner?: string;
    requiresStableTaxonomyId: boolean;
}
export declare const CATALOG_LIMITS_V1: Readonly<{
    pipelines: 128;
    statusesPerPipeline: 128;
    priorities: 128;
    filters: 256;
    filterNodes: 2048;
    projectSerialScopes: 256;
    pathItems: 512;
    templateCandidates: 128;
    textCharacters: 4096;
}>;
export type CatalogIdentityStatusV1 = 'resolved' | 'ambiguous';
export interface CatalogStatusV1 {
    id: string;
    label: string;
    order: number;
    color: string;
    icon?: string;
    propertyMapping?: string;
    isFinished: boolean;
    isCancelled: boolean;
    isScheduledTarget: boolean;
    isTrackingTarget: boolean;
    identityStatus: CatalogIdentityStatusV1;
}
export interface CatalogPipelineV1 {
    id: string;
    name: string;
    description: string;
    order: number;
    identityStatus: CatalogIdentityStatusV1;
    statuses: CatalogStatusV1[];
}
export interface CatalogPriorityV1 {
    id: string;
    label: string;
    description: string;
    order: number;
    color: string;
    icon?: string;
    isDefault: boolean;
    identityStatus: CatalogIdentityStatusV1;
}
export interface CatalogDefaultReferenceV1 {
    configuredValue: string;
    id?: string;
    status: 'resolved' | 'none' | 'ambiguous' | 'unavailable';
}
export interface CatalogTaxonomyV1 {
    defaultPipeline: CatalogDefaultReferenceV1;
    defaultPriority: CatalogDefaultReferenceV1;
    pipelines: CatalogPipelineV1[];
    priorities: CatalogPriorityV1[];
}
export type CatalogFilterNodeV1 = {
    kind: 'group';
    id: string;
    logic: 'all' | 'any' | 'none';
    children: CatalogFilterNodeV1[];
} | {
    kind: 'condition';
    id: string;
    field: string;
    fieldType: string;
    operator: string;
    value?: string;
    values?: string[];
};
export interface CatalogFilterV1 {
    id: string;
    name: string;
    icon?: string;
    root: CatalogFilterNodeV1;
    sorts: Array<{
        field: string;
        order: 'asc' | 'desc';
    }>;
    subgroupBy?: string;
    subgroupOrder?: 'asc' | 'desc';
    groupBy?: string;
    groupOrder?: 'asc' | 'desc';
}
export interface CatalogReminderFieldPolicyV1 {
    canonicalKey: 'reminderDatetimes' | 'reminderRules';
    availability: 'available' | 'unavailable' | 'collision';
    visiblePropertyName?: string;
}
export declare const TEMPORAL_CREATE_KEYS_V1: readonly ["reminderDatetimes", "reminderRules", "repeat", "datetimeRepeatEnd"];
export type TemporalCreateKeyV1 = typeof TEMPORAL_CREATE_KEYS_V1[number];
export declare const TYPED_CREATE_FEATURES_V1: readonly ["exact-inline-placement", "exact-file-target", "deterministic-file-template", "file-body-replacement", "same-source-task-graph", "cross-source-parent-related"];
export type TypedCreateFeatureV1 = typeof TYPED_CREATE_FEATURES_V1[number];
export declare const GRAPH_TRANSACTION_FEATURES_V1: readonly ["vault-wide-graph-transaction", "compare-aware-compensation", "same-plan-safe-continuation", "cross-source-reciprocal-dependency"];
export type GraphTransactionFeatureV1 = typeof GRAPH_TRANSACTION_FEATURES_V1[number];
export declare const SOURCE_TRANSITION_RECOVERY_FEATURES_V1: readonly ["terminal-after-state-verification", "same-plan-forward-continuation", "compare-aware-compensation", "cross-file-transition-journal"];
export type SourceTransitionRecoveryFeatureV1 = typeof SOURCE_TRANSITION_RECOVERY_FEATURES_V1[number];
export declare const COMPACT_UPDATE_BATCH_FEATURES_V1: readonly ["exact-id-targets", "heterogeneous-general-updates", "explicit-field-clear", "single-source-atomic-plan", "per-target-postflight", "same-plan-recovery"];
export type CompactUpdateBatchFeatureV1 = typeof COMPACT_UPDATE_BATCH_FEATURES_V1[number];
export interface FileTaskTemplateCandidateV1 {
    id: string;
    name: string;
    kind: 'builtin-pipeline-minimal' | 'folder';
    sourcePath?: string;
    pipelineId?: string;
    initialStatusId?: string;
}
export interface CatalogPoliciesV1 {
    /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
    sourceTransitionRecoveryVersion?: 1;
    sourceTransitionRecoveryFeatures?: SourceTransitionRecoveryFeatureV1[];
    creation: {
        descriptionRequired: boolean;
        assigneesRequired: boolean;
        defaultEstimateMinutes: number;
        defaultToFileTask: boolean;
        fileTaskTargetFolder: string;
        fileTaskTemplateFolder: string;
        defaultFileTemplateId?: string;
        inlineTaskSaveMode: 'daily-notes' | 'specific-file' | 'active-file' | 'ask-every-time';
        inlineTaskTargetFile: string;
        inlineTaskHeading: string;
        dailyNoteAddsStartDate: boolean;
        dailyNoteAddsScheduledDate: boolean;
        createDailyNotesAsFileTasks: boolean;
        calendarInlineTaskHeading: string;
        builtInTemplateCandidates: Array<{
            id: string;
            pipelineId: string;
            initialStatusId: string;
        }>;
        /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
        fileTaskTemplateCandidates?: FileTaskTemplateCandidateV1[];
        /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
        typedCreateVersion?: 1;
        typedCreateFeatures?: TypedCreateFeatureV1[];
        /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
        temporalCreateVersion?: 1;
        temporalCreateKeys?: TemporalCreateKeyV1[];
        /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
        compactBatchVersion?: 1;
        compactBatchInputFormat?: 'compact-lines';
        compactBatchMaxItems?: 64;
        /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
        graphTransactionVersion?: 1;
        graphTransactionFeatures?: GraphTransactionFeatureV1[];
    };
    inheritance: {
        fields: string[];
        statusPipelineSource: 'parent' | 'default';
        autoParentFileTask: boolean;
        autoParentLinkedFileSubtasks: boolean;
        fileTaskParentInlineTargetMode: 'default' | 'same-folder';
        fileTaskParentFileTargetMode: 'default' | 'same-folder';
        inlineTaskParentInlineTargetMode: 'default' | 'below-parent';
        inlineTaskParentFileTargetMode: 'default' | 'inside-parent-file';
        inlineTaskParentFileHeadingKeyword: string;
    };
    exclusions: {
        folders: string[];
    };
    filters: CatalogFilterV1[];
    automation: {
        autoCompleteParentWhenAllChildrenTerminal: boolean;
        cascadeCancelToDescendants: boolean;
        newOccurrencePosition: 'above' | 'below';
        fileTaskAutoArchiveEnabled: boolean;
        fileTaskArchiveFolder: string;
        fileTaskArchiveDelaySeconds: number;
        fileTaskArchiveOnlyFromFileTasksFolder: boolean;
        fileRepeatDestination: 'same-folder' | 'custom-folder';
        fileRepeatCustomFolder: string;
        estimateAutoReallocation: boolean;
        trackerSplitSessionsAtMidnight: boolean;
        reminderCatchUpWindowMinutes: number;
        reminderAutoPinDueTasks: boolean;
        pinnedDockAutoPin: boolean;
        pinnedDockAutoUnpinFinished: boolean;
    };
    reminders: {
        fields: CatalogReminderFieldPolicyV1[];
        ruleAnchors: Array<'datetimeStart' | 'datetimeEnd' | 'dateStarted' | 'dateScheduled' | 'dateDue'>;
        itemActions: Array<'add' | 'replace' | 'remove'>;
    };
    conversion: {
        directions: Array<'inline-to-file' | 'file-to-inline'>;
        templateSelection: 'explicit-or-needs-template';
        targetModes: Array<'exact-line' | 'configured-target'>;
        inlineToFileMovesPlainCheckboxes: boolean;
        fileToInlineRequiresExplicitConfirmation: boolean;
    };
    taskUpdate: {
        writableKeys: string[];
        customKeyPolicy: 'active-valid-nonreserved-text-number-date-datetime-list-checkbox';
        /** Optional so V1 clients can still decode Catalogs from older Runtime builds. */
        compactUpdateBatchVersion?: 1;
        compactUpdateBatchInputFormat?: 'compact-lines';
        compactUpdateBatchMaxItems?: 64;
        compactUpdateBatchFeatures?: CompactUpdateBatchFeatureV1[];
    };
    relationships: {
        writableFields: Array<'parentTask' | 'blocking' | 'blockedBy'>;
        actions: Array<'replace' | 'clear'>;
        parentMaxTargets: 1;
        dependencyInverseWrites: true;
    };
    transitions: {
        actions: Array<'set-status' | 'complete' | 'cancel' | 'reopen'>;
    };
    timer: {
        actions: Array<'start' | 'stop'>;
    };
    inlineRelocation: {
        target: 'exact-blank-line';
    };
    deletion: {
        requiresExplicitConfirmation: true;
        deleteAdditionalTasks: false;
        referenceCleanup: 'explicit-or-block';
    };
    projectSerialScopes: Array<{
        id: string;
        prefix: string;
        parentOperonId: string;
    }>;
}
export interface CatalogRequestV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'catalog';
    consistency: ConsistencyV1;
}
interface OperonCatalogResultBaseV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'catalog-result';
    freshness: FreshnessV1;
    warnings: ContractWarningV1[];
}
export type OperonCatalogV1 = OperonCatalogResultBaseV1 & ({
    ok: true;
    contextRevision: ContextRevisionV1;
    settingsFingerprint: string;
    catalogRevision: string;
    taxonomy: CatalogTaxonomyV1;
    fields: FieldDescriptorV1[];
    policies: CatalogPoliciesV1;
    error?: never;
} | {
    ok: false;
    contextRevision?: ContextRevisionV1;
    error: StructuredErrorV1;
    settingsFingerprint?: never;
    catalogRevision?: never;
    taxonomy?: never;
    fields?: never;
    policies?: never;
});
export declare const GENERAL_UPDATE_BUILT_IN_KEYS_V1: readonly ["description", "priority", "dateDue", "dateScheduled", "dateStarted", "datetimeStart", "datetimeEnd", "estimate", "assignees", "contexts", "tags", "taskIcon", "taskColor", "note", "location", "links"];
export type GeneralUpdateBuiltInKeyV1 = typeof GENERAL_UPDATE_BUILT_IN_KEYS_V1[number];
export declare const RECURRENCE_UPDATE_KEYS_V1: readonly ["repeat", "datetimeRepeatEnd", "dateScheduled", "dateStarted", "dateDue", "datetimeStart", "datetimeEnd", "estimate"];
export type RecurrenceUpdateKeyV1 = typeof RECURRENCE_UPDATE_KEYS_V1[number];
export declare const SEMANTIC_CAPABILITY_KEYS_V1: readonly ["status", "checkbox", "dateCompleted", "dateCancelled", "reminderDatetimes", "reminderRules", "repeat", "repeatSeriesId", "repeatOccurrenceDate", "datetimeRepeatEnd", "parentTask", "blocking", "blockedBy", "trackers", "activeTracker"];
export declare const RUNTIME_OWNED_KEYS_V1: readonly ["operonId", "locator", "representation", "duration", "totalEstimate", "totalDuration", "progress", "directSubtaskCount", "directDoneSubtaskCount", "directOpenSubtaskCount", "treeDescendantCount", "treeDoneDescendantCount", "treeOpenDescendantCount", "timezone", "datetimeCreated", "datetimeModified"];
export type GeneralUpdateValidationCodeV1 = 'duplicate-field' | 'field-not-writable' | 'field-not-cataloged' | 'value-type-mismatch';
export interface GeneralUpdateValidationIssueV1 {
    index: number;
    field: string;
    code: GeneralUpdateValidationCodeV1;
}
export interface GeneralUpdateCandidateV1 {
    field: string;
    valueType: FieldValueTypeV1;
}
export declare function isGeneralUpdateFieldV1(descriptor: FieldDescriptorV1): boolean;
export declare function validateGeneralUpdateItemsAgainstCatalogV1(items: readonly GeneralUpdateCandidateV1[], catalog: readonly FieldDescriptorV1[]): GeneralUpdateValidationIssueV1[];
export {};
