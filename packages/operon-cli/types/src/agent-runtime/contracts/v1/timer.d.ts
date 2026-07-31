import type { ContextRevisionV1 } from './identity.js';
import type { ConsistencyV1, ContractWarningV1, FreshnessV1, StructuredErrorV1 } from './primitives.js';
import { CONTRACT_VERSION_V1 } from './primitives.js';
export interface TimerReadRequestV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'timer-read';
    consistency: ConsistencyV1;
}
export interface TimerStateV1 {
    active: null | {
        operonId: string | null;
        start: string;
        source: string;
        elapsedSeconds: number;
        isUnassigned: boolean;
    };
    transition: null | {
        kind: 'starting' | 'stopping';
        operonId: string | null;
        start: string;
    };
}
interface TimerReadResultBaseV1 {
    contractVersion: typeof CONTRACT_VERSION_V1;
    requestId: string;
    kind: 'timer-read-result';
    freshness: FreshnessV1;
    warnings: ContractWarningV1[];
}
export type TimerReadResultV1 = TimerReadResultBaseV1 & ({
    ok: true;
    state: TimerStateV1;
    contextRevision: ContextRevisionV1;
} | {
    ok: false;
    error: StructuredErrorV1;
});
export {};
