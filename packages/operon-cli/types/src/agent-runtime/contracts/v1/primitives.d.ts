export declare const CONTRACT_VERSION_V1: 1;
export declare const CONTRACT_LIMITS_V1: Readonly<{
    transportInputBytes: 786432;
    transportResultBytes: 3145728;
    requestIdBytes: 128;
    idempotencyKeyBytes: 256;
    cursorCharacters: 4096;
    jsonObjectKeys: 128;
    errorDetailKeys: 32;
    generalStringBytes: 65536;
    reasonBytes: 2048;
    collectionItems: 512;
    createItems: 64;
    createRelationsPerItem: 64;
    planTargets: 128;
    affectedResources: 128;
    atomicGroups: 128;
    predictedEffects: 256;
    acknowledgements: 128;
    warnings: 256;
}>;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export declare const IDEMPOTENCY_KEY_PATTERN_V1: RegExp;
export declare const REQUEST_ID_PATTERN_V1: RegExp;
export declare const WARNING_CODE_PATTERN_V1: RegExp;
export type ConsistencyV1 = 'live-verified' | 'best-effort' | 'offline-unverified';
export type CoherenceV1 = 'verified' | 'settling' | 'unverified';
export type FreshnessSourceV1 = 'live-runtime' | 'persisted-index' | 'source-file';
export interface FreshnessV1 {
    source: FreshnessSourceV1;
    coherence: CoherenceV1;
    observedAt: string;
    settled: boolean;
}
export declare const STRUCTURED_ERROR_CODES_V1: readonly ["invalid-request", "unsupported-version", "unsupported-platform", "incompatible-version", "unknown-capability", "capability-unavailable", "invalid-operon-id", "duplicate-operon-id", "ambiguous-selector", "entity-not-found", "invalid-locator", "vault-mismatch", "stale-source", "stale-context", "stale-cursor", "stale-plan", "plan-expired", "plan-tampered", "confirmation-required", "acknowledgement-required", "authority-insufficient", "consent-denied", "audit-unavailable", "field-not-writable", "needs-template", "needs-target", "template-processing-required", "mutation-kind-mismatch", "outcome-unknown", "payload-too-large", "result-too-large", "projection-too-broad", "receipt-store-unavailable", "transport-unavailable", "desktop-unavailable", "handler-unavailable", "live-settling", "internal-error"];
export type KnownStructuredErrorCodeV1 = typeof STRUCTURED_ERROR_CODES_V1[number];
/**
 * Error identifiers are additive in Runtime API V1. Unknown identifiers must
 * be treated as stop-and-inspect, never as retry or mutation authorization.
 */
export type StructuredErrorCodeV1 = string;
export declare const ERROR_ACTIONS_V1: readonly ["fix-request", "rediscover", "refresh-state", "wait-and-retry", "request-consent", "request-authority", "narrow-request", "upgrade-client", "fix-environment", "recover-same-plan", "do-not-retry", "report-bug"];
export type ErrorActionV1 = typeof ERROR_ACTIONS_V1[number];
export interface StructuredErrorV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    code: StructuredErrorCodeV1;
    reason: string;
    retryable: boolean;
    action: ErrorActionV1;
    details?: Record<string, JsonValue>;
}
export type ErrorExitClassV1 = 'usage' | 'unavailable' | 'refused' | 'runtime-failure' | 'internal';
export interface ErrorRegistryEntryV1 {
    readonly code: KnownStructuredErrorCodeV1;
    readonly action: ErrorActionV1;
    readonly retryable: boolean;
    readonly recovery: 'none' | 'same-plan';
    readonly exitClass: ErrorExitClassV1;
}
export declare const ERROR_REGISTRY_V1: readonly ErrorRegistryEntryV1[];
export declare function errorPolicyForCodeV1(code: StructuredErrorCodeV1): Omit<ErrorRegistryEntryV1, 'code'> & {
    readonly code: string;
};
export declare function structuredErrorV1(code: StructuredErrorCodeV1, reason: string, options?: {
    details?: Record<string, JsonValue>;
    retryable?: boolean;
    action?: ErrorActionV1;
}): StructuredErrorV1;
export declare function normalizeStructuredErrorV1(error: StructuredErrorV1): StructuredErrorV1;
export interface ContractWarningV1 {
    code: string;
    message: string;
    path?: string;
}
export interface ProvenanceV1 {
    path: string;
    source: FreshnessSourceV1;
    revision?: string;
    derived: boolean;
}
export interface TruncationV1 {
    path: string;
    actualCount: number;
    returnedCount: number;
    limit: number;
}
export interface CompatibilityRangeV1 {
    min: number;
    max: number;
}
export interface CompatibilityOfferV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    runtimeApi: CompatibilityRangeV1;
}
export interface CompatibilitySelectionV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    compatible: boolean;
    runtimeApi?: 1;
    error?: StructuredErrorV1;
}
export declare function utf8ByteLengthV1(value: string): number;
export declare function negotiateCompatibilityV1(local: CompatibilityOfferV1, remote: CompatibilityOfferV1): CompatibilitySelectionV1;
