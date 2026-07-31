import type { CapabilityIdV1 } from '../../contracts/v1/capabilities';
import type {
	MutationAcknowledgementV1,
	MutationAuthorizationV1,
	PredictedEffectV1,
	RiskLevelV1,
	SealedMutationPlanV1,
} from '../../contracts/v1/mutation';

export type DeveloperGrantStateV1 = 'pending' | 'active' | 'suspended' | 'revoked';

/**
 * Host-derived identity for one verified Developer API connection. Callers
 * cannot construct authority by copying these values; the host must also
 * prove that the session is still current at every admission boundary.
 */
export interface DeveloperSecuritySessionV1 {
	readonly consumerId: string;
	readonly instanceEpoch: string;
	readonly sessionId: string;
}

export interface DeveloperCapabilityGrantV1 {
	readonly consumerId: string;
	readonly state: DeveloperGrantStateV1;
	readonly revision: number;
	readonly capabilities: ReadonlySet<CapabilityIdV1>;
}

export interface DeveloperPlanSecurityBindingV1 {
	readonly consumerId: string;
	readonly instanceEpoch: string;
	readonly sessionId: string;
	readonly grantRevision: number;
	readonly capability: CapabilityIdV1;
	readonly planHash: string;
	readonly targetDigest: string;
}

export interface DeveloperPlanBindingAdmissionV1 {
	readonly ok: true;
	readonly binding: DeveloperPlanSecurityBindingV1;
}

export type DeveloperSecurityDenialCodeV1 =
	| 'authority-insufficient'
	| 'confirmation-required'
	| 'consent-denied'
	| 'invalid-request';

export type DeveloperSecurityDenialReasonV1 =
	| 'consumer-mismatch'
	| 'session-stale'
	| 'grant-not-active'
	| 'grant-revision-changed'
	| 'capability-not-granted'
	| 'plan-binding-mismatch'
	| 'consent-in-progress'
	| 'consent-denied'
	| 'consent-unavailable'
	| 'plan-consent-already-denied'
	| 'apply-already-claimed'
	| 'apply-not-dispatched';

export interface DeveloperSecurityDenialV1 {
	readonly ok: false;
	readonly code: DeveloperSecurityDenialCodeV1;
	readonly reasonCode: DeveloperSecurityDenialReasonV1;
	readonly reason: string;
	readonly retryable: false;
}

export interface DeveloperPreviewAdmissionV1 {
	readonly ok: true;
	readonly authorization: MutationAuthorizationV1;
}

export interface DeveloperApplyAdmissionV1 {
	readonly ok: true;
	readonly authorization: MutationAuthorizationV1;
	readonly acknowledgements: readonly MutationAcknowledgementV1[];
	readonly consent: 'standing-grant' | 'fresh-user-confirmation';
}

export interface DeveloperApplyDispatchClaimV1 {
	readonly ok: true;
	readonly action: 'apply-dispatch-claimed';
}

export interface DeveloperRecoveryAdmissionV1 {
	readonly ok: true;
	readonly action: 'recover-same-plan';
}

export interface DeveloperConsentPromptV1 {
	readonly consumerId: string;
	readonly capability: CapabilityIdV1;
	readonly mutationKind: SealedMutationPlanV1['mutationKind'];
	readonly riskLevel: Exclude<RiskLevelV1, 'none' | 'routine'>;
	readonly planHash: string;
	readonly targetDigest: string;
	readonly targetCount: number;
	readonly predictedEffects: readonly PredictedEffectV1[];
	readonly acknowledgementCodes: readonly string[];
}

export type DeveloperConsentDecisionV1 = 'approved' | 'denied' | 'unavailable';

export interface DeveloperConsentPortV1 {
	requestConsent: (
		prompt: DeveloperConsentPromptV1,
	) => Promise<DeveloperConsentDecisionV1>;
}

export interface DeveloperSecurityPolicyPortsV1 {
	readonly consent: DeveloperConsentPortV1;
	readonly isSessionCurrent: (session: DeveloperSecuritySessionV1) => boolean;
	/**
	 * Re-resolves persisted grant state/revision at the admission boundary.
	 * This must not trust the snapshot supplied by the consumer session.
	 */
	readonly isGrantCurrent: (grant: DeveloperCapabilityGrantV1) => boolean;
	readonly now: () => Date;
}

export interface DeveloperPlanDispatchStateV1 {
	readonly binding: DeveloperPlanSecurityBindingV1;
	readonly dispatchStarted: boolean;
}
