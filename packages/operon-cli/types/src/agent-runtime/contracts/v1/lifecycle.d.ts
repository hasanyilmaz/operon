import { CapabilityAdvertisementV1 } from './capabilities.js';
import { ContextRevisionV1 } from './identity.js';
import { CompatibilityOfferV1, CONTRACT_VERSION_V1, ContractWarningV1, FreshnessV1, StructuredErrorV1 } from './primitives.js';
export declare const RUNTIME_API_VERSION_V1: 1;
export declare const RUNTIME_LIFECYCLE_PHASES_V1: readonly ["booting", "cache-ready", "settling", "ready", "unloading"];
export type RuntimeLifecyclePhaseV1 = typeof RUNTIME_LIFECYCLE_PHASES_V1[number];
export declare const V8_PERSISTENCE_PHASES_V1: readonly ["idle", "sync-settling", "rebasing", "recovery-required"];
export type V8PersistencePhaseV1 = typeof V8_PERSISTENCE_PHASES_V1[number];
export declare const RUNTIME_RETRY_AFTER_MAX_MS_V1 = 1000;
export interface RuntimeAdmissionV1 {
    reads: boolean;
    writes: boolean;
}
export interface RuntimeTransportDiagnosticsV1 {
    channel?: 'native-cli';
    available?: boolean;
    endpointKind?: 'unix-domain-socket' | 'windows-named-pipe';
    securityBackend?: 'posix-mode' | 'windows-dacl';
    persistentTransportAvailable?: boolean;
    failureReason?: string;
}
export interface RuntimeDiagnosticsV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    kind: 'runtime-diagnostics';
    health: RuntimeHealthV1;
    capabilities: CapabilityAdvertisementV1[];
    catalog?: {
        catalogRevision: string;
        settingsFingerprint: string;
        fieldCount: number;
        pipelineCount: number;
        priorityCount: number;
    };
    transport?: RuntimeTransportDiagnosticsV1;
    warnings: ContractWarningV1[];
}
interface RuntimeHealthBaseV1 {
    apiVersion: typeof RUNTIME_API_VERSION_V1;
    contractVersion: typeof CONTRACT_VERSION_V1;
    lifecyclePhase: RuntimeLifecyclePhaseV1;
    v8PersistencePhase: V8PersistencePhaseV1;
    compatibility: CompatibilityOfferV1;
    capabilities: CapabilityAdvertisementV1[];
    freshness: FreshnessV1;
    contextRevision?: ContextRevisionV1;
    admission: RuntimeAdmissionV1;
    retryAfterMs?: number;
    warnings: ContractWarningV1[];
}
export type RuntimeHealthV1 = RuntimeHealthBaseV1 & ({
    ok: true;
    error?: never;
} | {
    ok: false;
    error: StructuredErrorV1;
});
export {};
