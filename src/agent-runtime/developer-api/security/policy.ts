import {
	MUTATION_CAPABILITY_MAP_V1,
} from '../../contracts/v1/capabilities';
import type {
	MutationAuthorizationV1,
} from '../../contracts/v1/mutation';
import type {
	DeveloperApplyAdmissionV1,
	DeveloperApplyDispatchClaimV1,
	DeveloperCapabilityGrantV1,
	DeveloperMutationCapabilityV1,
	DeveloperMutationSealedPlanV1,
	DeveloperPlanBindingAdmissionV1,
	DeveloperPlanDispatchStateV1,
	DeveloperPlanSecurityBindingV1,
	DeveloperPreviewAdmissionV1,
	DeveloperRecoveryAdmissionV1,
	DeveloperSecurityDenialReasonV1,
	DeveloperSecurityDenialV1,
	DeveloperSecurityPolicyPortsV1,
	DeveloperSecuritySessionV1,
} from './types';

type AdmissionResultV1<T> = T | DeveloperSecurityDenialV1;

export class DeveloperMutationSecurityPolicyV1 {
	private readonly consentInFlight = new Set<string>();
	private readonly deniedConsentPlans = new Set<string>();
	private readonly claimedApplyPlans = new Set<string>();

	constructor(private readonly ports: DeveloperSecurityPolicyPortsV1) {}

	admitPreview(input: {
		session: DeveloperSecuritySessionV1;
		grant: DeveloperCapabilityGrantV1;
		capability: DeveloperMutationCapabilityV1;
	}): AdmissionResultV1<DeveloperPreviewAdmissionV1> {
		const denial = this.admitGrant(input.session, input.grant, input.capability);
		if (denial) return denial;
		return {
			ok: true,
			authorization: hostAuthorization('user-explicit-request'),
		};
	}

	bindPlan(input: {
		session: DeveloperSecuritySessionV1;
		grant: DeveloperCapabilityGrantV1;
		plan: DeveloperMutationSealedPlanV1;
	}): AdmissionResultV1<DeveloperPlanBindingAdmissionV1> {
		const denial = this.admitGrant(input.session, input.grant, input.plan.capability);
		if (denial) return denial;
		return {
			ok: true,
			binding: Object.freeze({
				consumerId: input.session.consumerId,
				instanceEpoch: input.session.instanceEpoch,
				sessionId: input.session.sessionId,
				grantRevision: input.grant.revision,
				capability: input.plan.capability,
				planHash: input.plan.planHash,
				targetDigest: input.plan.receiptTargetDigest,
			}),
		};
	}

	async admitApply(input: {
		session: DeveloperSecuritySessionV1;
		grant: DeveloperCapabilityGrantV1;
		binding: DeveloperPlanSecurityBindingV1;
		plan: DeveloperMutationSealedPlanV1;
	}): Promise<AdmissionResultV1<DeveloperApplyAdmissionV1>> {
		const denial = this.admitBoundPlan(input);
		if (denial) return denial;
		const applyCapability = resolveApplyCapability(input.plan);

		if (input.plan.riskLevel === 'none' || input.plan.riskLevel === 'routine') {
			return {
				ok: true,
				authorization: routineAuthorization(input.plan),
				acknowledgements: [],
				consent: 'standing-grant',
			};
		}
		const acknowledgementTargetDigest = input.plan.targets[0]?.targetDigest;
		if (!acknowledgementTargetDigest) {
			return denialResult(
				'invalid-request',
				'plan-binding-mismatch',
				'The sealed plan does not expose a target for confirmation.',
			);
		}

		const consentKey = planKey(input.session.consumerId, input.plan.planHash);
		if (this.deniedConsentPlans.has(consentKey)) {
			return denialResult(
				'consent-denied',
				'plan-consent-already-denied',
				'Consent was already denied for this sealed plan. Create a new preview before requesting consent again.',
			);
		}
		if (this.consentInFlight.has(consentKey)) {
			return denialResult(
				'confirmation-required',
				'consent-in-progress',
				'Consent review is already in progress for this sealed plan.',
			);
		}

		this.consentInFlight.add(consentKey);
		let decision: 'approved' | 'denied' | 'unavailable';
		try {
			try {
				decision = await this.ports.consent.requestConsent({
					consumerId: input.session.consumerId,
					capability: applyCapability,
					mutationKind: input.plan.mutationKind,
					riskLevel: input.plan.riskLevel,
					planHash: input.plan.planHash,
					targetDigest: input.plan.receiptTargetDigest,
					targetCount: input.plan.targets.length,
					predictedEffects: input.plan.predictedEffects,
					acknowledgementCodes: input.plan.requiredAcknowledgements,
				});
			} catch {
				decision = 'unavailable';
			}
		} finally {
			this.consentInFlight.delete(consentKey);
		}

		if (decision !== 'approved') {
			if (decision === 'denied') this.deniedConsentPlans.add(consentKey);
			return decision === 'denied'
				? denialResult(
					'consent-denied',
					'consent-denied',
					'The user denied consent for this sealed plan.',
				)
				: denialResult(
					'confirmation-required',
					'consent-unavailable',
					'Operon could not present consent for this sealed plan.',
				);
		}

		// Recheck the live session and grant after the asynchronous UI boundary.
		const postConsentDenial = this.admitBoundPlan(input);
		if (postConsentDenial) return postConsentDenial;

		const acknowledgedAt = this.ports.now().toISOString();
		return {
			ok: true,
			authorization: hostAuthorization('user-explicit-confirmation'),
			acknowledgements: input.plan.requiredAcknowledgements.map(code => ({
				code,
				planHash: input.plan.planHash,
				targetDigest: acknowledgementTargetDigest,
				acknowledgedAt,
			})),
			consent: 'fresh-user-confirmation',
		};
	}

	/**
	 * Performs the final synchronous grant/session recheck and one-shot claim.
	 * The claim is the dispatch boundary: the host must durably persist its
	 * private recovery proof before invoking Runtime.
	 */
	claimApplyDispatch(input: {
		session: DeveloperSecuritySessionV1;
		grant: DeveloperCapabilityGrantV1;
		binding: DeveloperPlanSecurityBindingV1;
		plan: DeveloperMutationSealedPlanV1;
	}): AdmissionResultV1<DeveloperApplyDispatchClaimV1> {
		const denial = this.admitBoundPlan(input);
		if (denial) return denial;
		const key = planKey(input.session.consumerId, input.plan.planHash);
		if (this.claimedApplyPlans.has(key)) {
			return denialResult(
				'invalid-request',
				'apply-already-claimed',
				'Apply dispatch was already claimed for this sealed plan.',
			);
		}
		this.claimedApplyPlans.add(key);
		return { ok: true, action: 'apply-dispatch-claimed' };
	}

	/**
	 * Releases a claim only when private recovery persistence failed before the
	 * Runtime handler was invoked, allowing the unchanged opaque plan to retry.
	 */
	releaseApplyDispatchClaim(input: {
		session: DeveloperSecuritySessionV1;
		plan: DeveloperMutationSealedPlanV1;
	}): void {
		this.claimedApplyPlans.delete(planKey(
			input.session.consumerId,
			input.plan.planHash,
		));
	}

	admitRecovery(input: {
		session: DeveloperSecuritySessionV1;
		plan: DeveloperMutationSealedPlanV1;
		dispatch: DeveloperPlanDispatchStateV1;
	}): AdmissionResultV1<DeveloperRecoveryAdmissionV1> {
		if (!this.ports.isSessionCurrent(input.session)) {
			return denialResult(
				'authority-insufficient',
				'session-stale',
				'The Developer API consumer session is no longer current.',
			);
		}
		if (
			input.dispatch.binding.consumerId !== input.session.consumerId
			|| input.dispatch.binding.planHash !== input.plan.planHash
			|| input.dispatch.binding.targetDigest !== input.plan.receiptTargetDigest
			|| input.dispatch.binding.capability !== input.plan.capability
		) {
			return denialResult(
				'invalid-request',
				'plan-binding-mismatch',
				'Recovery is restricted to the same consumer and unchanged sealed plan.',
			);
		}
		if (!input.dispatch.dispatchStarted) {
			return denialResult(
				'invalid-request',
				'apply-not-dispatched',
				'Recovery is unavailable because apply was never dispatched.',
			);
		}
		return { ok: true, action: 'recover-same-plan' };
	}

	private admitBoundPlan(input: {
		session: DeveloperSecuritySessionV1;
		grant: DeveloperCapabilityGrantV1;
		binding: DeveloperPlanSecurityBindingV1;
		plan: DeveloperMutationSealedPlanV1;
	}): DeveloperSecurityDenialV1 | undefined {
		const applyCapability = resolveApplyCapability(input.plan);
		const grantDenial = this.admitGrant(input.session, input.grant, applyCapability);
		if (grantDenial) return grantDenial;
		if (
			input.binding.consumerId !== input.session.consumerId
			|| input.binding.instanceEpoch !== input.session.instanceEpoch
			|| input.binding.sessionId !== input.session.sessionId
			|| input.binding.capability !== input.plan.capability
			|| input.binding.planHash !== input.plan.planHash
			|| input.binding.targetDigest !== input.plan.receiptTargetDigest
		) {
			return denialResult(
				'invalid-request',
				'plan-binding-mismatch',
				'The sealed plan is not bound to this Developer API consumer session.',
			);
		}
		if (input.binding.grantRevision !== input.grant.revision) {
			return denialResult(
				'authority-insufficient',
				'grant-revision-changed',
				'The capability grant changed after this plan was previewed.',
			);
		}
		return undefined;
	}

	private admitGrant(
		session: DeveloperSecuritySessionV1,
		grant: DeveloperCapabilityGrantV1,
		capability: DeveloperMutationCapabilityV1,
	): DeveloperSecurityDenialV1 | undefined {
		if (!this.ports.isSessionCurrent(session)) {
			return denialResult(
				'authority-insufficient',
				'session-stale',
				'The Developer API consumer session is no longer current.',
			);
		}
		if (grant.consumerId !== session.consumerId) {
			return denialResult(
				'authority-insufficient',
				'consumer-mismatch',
				'The capability grant belongs to a different consumer.',
			);
		}
		if (grant.state !== 'active') {
			return denialResult(
				'authority-insufficient',
				'grant-not-active',
				`The Developer API capability grant is ${grant.state}.`,
			);
		}
		if (!this.ports.isGrantCurrent(grant)) {
			return denialResult(
				'authority-insufficient',
				'grant-revision-changed',
				'The persisted Developer API capability grant changed.',
			);
		}
		if (!grant.capabilities.has(capability)) {
			return denialResult(
				'authority-insufficient',
				'capability-not-granted',
				`The exact Developer API capability is not granted: ${capability}.`,
			);
		}
		return undefined;
	}
}

function routineAuthorization(plan: DeveloperMutationSealedPlanV1): MutationAuthorizationV1 {
	// The existing Runtime V1 create gate specifically requires this basis.
	return hostAuthorization(
		plan.mutationKind === 'task.create'
			? 'user-explicit-request'
			: 'user-standing-instruction',
	);
}

/** Base capabilities are frozen; task adoption is an additive extension. */
export function resolveDeveloperMutationApplyCapabilityV1(
	plan: DeveloperMutationSealedPlanV1,
): DeveloperMutationCapabilityV1 {
	return plan.mutationKind === 'task.adopt'
		? 'tasks.adopt.apply'
		: plan.capability === 'tasks.create.periodic-note.preview'
			? 'tasks.create.periodic-note.apply'
		: MUTATION_CAPABILITY_MAP_V1[plan.mutationKind].apply;
}

function resolveApplyCapability(
	plan: DeveloperMutationSealedPlanV1,
): DeveloperMutationCapabilityV1 {
	return resolveDeveloperMutationApplyCapabilityV1(plan);
}

function hostAuthorization(
	basis: MutationAuthorizationV1['basis'],
): MutationAuthorizationV1 {
	return Object.freeze({ basis });
}

function planKey(consumerId: string, planHash: string): string {
	return `${consumerId}\u0000${planHash}`;
}

function denialResult(
	code: DeveloperSecurityDenialV1['code'],
	reasonCode: DeveloperSecurityDenialReasonV1,
	reason: string,
): DeveloperSecurityDenialV1 {
	return Object.freeze({
		ok: false,
		code,
		reasonCode,
		reason,
		retryable: false,
	});
}
