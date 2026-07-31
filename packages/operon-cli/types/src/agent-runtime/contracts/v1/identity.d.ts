import { StructuredErrorV1 } from './primitives.js';
export declare const OPERON_ID_PATTERN_V1: RegExp;
export declare const SHA256_HEX_PATTERN_V1: RegExp;
export type OperonIdValidityV1 = 'canonical' | 'legacy-invalid' | 'duplicate';
export interface TaskIdentityV1 {
    operonId: string;
    validity: OperonIdValidityV1;
    mutationAllowed: boolean;
}
export interface InlineTaskSourceLocatorV1 {
    representation: 'inline';
    filePath: string;
    lineNumber: number;
}
export interface FileTaskSourceLocatorV1 {
    representation: 'file';
    filePath: string;
}
export type TaskSourceLocatorV1 = InlineTaskSourceLocatorV1 | FileTaskSourceLocatorV1;
export declare function sameTaskSourceLocatorV1(left: TaskSourceLocatorV1 | null | undefined, right: TaskSourceLocatorV1): boolean;
export interface SourceRevisionV1 {
    algorithm: 'sha256';
    contentDigest: string;
}
interface IndexRevisionBaseV1 {
    sessionId: string;
    ramGeneration: number;
}
export type DurableIndexRevisionV1 = {
    status: 'available';
    snapshotId: string;
    committedAt: string;
} | {
    status: 'missing' | 'recovery-required' | 'unavailable';
};
export type IndexRevisionV1 = IndexRevisionBaseV1 & {
    durable: DurableIndexRevisionV1;
};
export interface ContextRevisionV1 {
    index: IndexRevisionV1;
    settingsFingerprint: string;
    pinnedGeneration: number;
    activeTrackerGeneration: number;
    repeatSeriesRevision: number;
    projectSerialGeneration: number;
    projectSerialSignature: string;
}
export interface ResourceRevisionV1 {
    resourceKind: ResourceKindV1;
    resourceKey: string;
    revision: string;
}
export type AffectedResourceRevisionMapV1 = ResourceRevisionV1[];
export declare const RESOURCE_KINDS_V1: readonly ["timer", "repeat-series", "active-tracker", "pinned", "project-serial", "task-source"];
export type ResourceKindV1 = typeof RESOURCE_KINDS_V1[number];
export declare const RESOURCE_QUEUE_ORDER_V1: Readonly<Record<ResourceKindV1, number>>;
export type TaskSelectorV1 = {
    kind: 'operon-id';
    operonId: string;
} | {
    kind: 'exact-locator';
    locator: TaskSourceLocatorV1;
    expectedOperonId?: string;
} | {
    kind: 'exact-path';
    filePath: string;
    expectedOperonId?: string;
} | {
    kind: 'exact-name';
    noteName: string;
    expectedOperonId?: string;
} | {
    kind: 'search';
    query: string;
    limit?: number;
};
export interface EntityCandidateV1 {
    identity: TaskIdentityV1;
    description: string;
    locator: TaskSourceLocatorV1;
    confidence: number;
    reasons: string[];
    selector: Extract<TaskSelectorV1, {
        kind: 'operon-id' | 'exact-locator';
    }>;
}
export declare function classifyOperonIdV1(operonId: string, duplicate?: boolean): TaskIdentityV1;
export declare function validateLocatorLexicallyV1(locator: TaskSourceLocatorV1): StructuredErrorV1 | null;
export declare function validateVaultRelativePathV1(filePath: string): StructuredErrorV1 | null;
export declare function compareResourceRevisionsV1(left: AffectedResourceRevisionMapV1, right: AffectedResourceRevisionMapV1): boolean;
export {};
