import { CapabilityAdvertisementV1 } from './capabilities';
import { ContextRevisionV1 } from './identity';
import {
	CompatibilityOfferV1,
	CONTRACT_VERSION_V1,
	ContractWarningV1,
	FreshnessV1,
	StructuredErrorV1,
} from './primitives';

export const RUNTIME_API_VERSION_V1 = 1 as const;

export const RUNTIME_LIFECYCLE_PHASES_V1 = [
	'booting',
	'cache-ready',
	'settling',
	'ready',
	'unloading',
] as const;

export type RuntimeLifecyclePhaseV1 = typeof RUNTIME_LIFECYCLE_PHASES_V1[number];

export const V8_PERSISTENCE_PHASES_V1 = [
	'idle',
	'sync-settling',
	'rebasing',
	'recovery-required',
] as const;

export type V8PersistencePhaseV1 = typeof V8_PERSISTENCE_PHASES_V1[number];

export const RUNTIME_RETRY_AFTER_MAX_MS_V1 = 1_000;

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

export type RuntimeHealthV1 = RuntimeHealthBaseV1 & (
	| {
		ok: true;
		error?: never;
	}
	| {
		ok: false;
		error: StructuredErrorV1;
	}
);
