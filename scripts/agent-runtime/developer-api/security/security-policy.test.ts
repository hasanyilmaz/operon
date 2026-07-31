import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityIdV1, MutationKindV1 } from '../../../../src/agent-runtime/contracts/v1/capabilities';
import type {
	RiskLevelV1,
	SealedMutationPlanV1,
} from '../../../../src/agent-runtime/contracts/v1/mutation';
import {
	DeveloperMutationSecurityPolicyV1,
	type DeveloperCapabilityGrantV1,
	type DeveloperConsentDecisionV1,
	type DeveloperSecuritySessionV1,
} from '../../../../src/agent-runtime/developer-api/security';

const session: DeveloperSecuritySessionV1 = {
	consumerId: 'obsidian-plugin:test.consumer',
	instanceEpoch: 'instance-1',
	sessionId: 'session-1',
};

function grant(
	capabilities: CapabilityIdV1[],
	overrides: Partial<DeveloperCapabilityGrantV1> = {},
): DeveloperCapabilityGrantV1 {
	return {
		consumerId: session.consumerId,
		state: 'active',
		revision: 4,
		capabilities: new Set(capabilities),
		...overrides,
	};
}

function plan(options: {
	capability?: CapabilityIdV1;
	mutationKind?: MutationKindV1;
	riskLevel?: RiskLevelV1;
	planHash?: string;
	requiredAcknowledgements?: string[];
} = {}): SealedMutationPlanV1 {
	const capability = options.capability ?? 'tasks.update.preview';
	const mutationKind = options.mutationKind ?? 'task.update';
	const riskLevel = options.riskLevel ?? 'routine';
	return {
		contractVersion: 1,
		planId: 'plan-id',
		planHash: options.planHash ?? 'plan-hash',
		clientInstanceId: 'developer-session',
		correlationId: 'correlation',
		idempotencyKeyHash: 'idempotency-hash',
		receiptTargetDigest: 'target-digest',
		capability,
		mutationKind,
		createdAt: '2026-07-29T10:00:00.000Z',
		expiresAt: '2026-07-29T10:10:00.000Z',
		targets: [],
		contextRevision: {
			index: {
				sessionId: 'index-session',
				ramGeneration: 1,
				durable: {
					status: 'available',
					snapshotId: 'snapshot',
					committedAt: '2026-07-29T10:00:00.000Z',
				},
			},
			settingsFingerprint: 'settings',
			pinnedGeneration: 1,
			activeTrackerGeneration: 1,
			repeatSeriesRevision: 1,
			projectSerialGeneration: 1,
			projectSerialSignature: 'serial',
		},
		affectedResources: [],
		atomicGroups: [],
		predictedEffects: [],
		riskLevel,
		requiresConfirmation: riskLevel === 'elevated' || riskLevel === 'destructive',
		requiredAcknowledgements: options.requiredAcknowledgements ?? [],
		warnings: [],
		spec: {
			operation: 'update',
			changes: [],
		},
	};
}

function harness(decisions: DeveloperConsentDecisionV1[] = []) {
	const prompts: unknown[] = [];
	let current = true;
	let currentGrantRevision = 4;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: {
			requestConsent: async prompt => {
				prompts.push(prompt);
				return decisions.shift() ?? 'unavailable';
			},
		},
		isSessionCurrent: candidate => current && candidate === session,
		isGrantCurrent: candidate => candidate.revision === currentGrantRevision,
		now: () => new Date('2026-07-29T10:01:00.000Z'),
	});
	return {
		policy,
		prompts,
		revokeSession: () => {
			current = false;
		},
		setGrantRevision: (revision: number) => {
			currentGrantRevision = revision;
		},
	};
}

function bindPlan(
	policy: DeveloperMutationSecurityPolicyV1,
	activeGrant: DeveloperCapabilityGrantV1,
	sealed: SealedMutationPlanV1,
) {
	const result = policy.bindPlan({ session, grant: activeGrant, plan: sealed });
	assert.equal(result.ok, true);
	if (!result.ok) throw new Error('Expected a plan binding.');
	return result.binding;
}

test('requires the exact active consumer grant for preview admission', () => {
	const { policy, revokeSession } = harness();
	const permitted = policy.admitPreview({
		session,
		grant: grant(['tasks.update.apply']),
		capability: 'tasks.update.apply',
	});
	assert.equal(permitted.ok, true);
	assert.equal(permitted.ok ? permitted.authorization.basis : undefined, 'user-explicit-request');

	const missing = policy.admitPreview({
		session,
		grant: grant(['tasks.read']),
		capability: 'tasks.update.apply',
	});
	assert.equal(missing.ok, false);
	assert.equal(missing.ok ? undefined : missing.reasonCode, 'capability-not-granted');

	const suspended = policy.admitPreview({
		session,
		grant: grant(['tasks.update.apply'], { state: 'suspended' }),
		capability: 'tasks.update.apply',
	});
	assert.equal(suspended.ok, false);
	assert.equal(suspended.ok ? undefined : suspended.reasonCode, 'grant-not-active');

	revokeSession();
	const stale = policy.admitPreview({
		session,
		grant: grant(['tasks.update.apply']),
		capability: 'tasks.update.apply',
	});
	assert.equal(stale.ok, false);
	assert.equal(stale.ok ? undefined : stale.reasonCode, 'session-stale');
});

test('admits routine plans from a standing grant without consent', async () => {
	const { policy, prompts } = harness();
	const sealed = plan();
	const previewOnlyGrant = grant([sealed.capability]);
	const previewOnlyBinding = bindPlan(policy, previewOnlyGrant, sealed);
	const previewOnlyApply = await policy.admitApply({
		session,
		grant: previewOnlyGrant,
		binding: previewOnlyBinding,
		plan: sealed,
	});
	assert.equal(previewOnlyApply.ok, false);
	assert.equal(
		previewOnlyApply.ok ? undefined : previewOnlyApply.reasonCode,
		'capability-not-granted',
	);

	const activeGrant = grant([sealed.capability, 'tasks.update.apply']);
	const binding = bindPlan(policy, activeGrant, sealed);

	const admitted = await policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(admitted.ok, true);
	assert.equal(admitted.ok ? admitted.consent : undefined, 'standing-grant');
	assert.equal(admitted.ok ? admitted.authorization.basis : undefined, 'user-standing-instruction');
	assert.deepEqual(prompts, []);
});

test('mints host-owned destructive confirmation and target-bound acknowledgements', async () => {
	const { policy, prompts } = harness(['approved']);
	const sealed = plan({
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		riskLevel: 'destructive',
		requiredAcknowledgements: ['destructive-delete', 'attached-checkboxes'],
	});
	const activeGrant = grant([sealed.capability, 'tasks.delete.apply']);
	const binding = bindPlan(policy, activeGrant, sealed);

	const admitted = await policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(admitted.ok, true);
	if (!admitted.ok) return;
	assert.equal(admitted.authorization.basis, 'user-explicit-confirmation');
	assert.deepEqual(admitted.acknowledgements, [
		{
			code: 'destructive-delete',
			planHash: sealed.planHash,
			targetDigest: sealed.receiptTargetDigest,
			acknowledgedAt: '2026-07-29T10:01:00.000Z',
		},
		{
			code: 'attached-checkboxes',
			planHash: sealed.planHash,
			targetDigest: sealed.receiptTargetDigest,
			acknowledgedAt: '2026-07-29T10:01:00.000Z',
		},
	]);
	assert.equal(prompts.length, 1);
});

test('blocks consent replay after cancellation and fails closed when UI throws', async () => {
	const cancelledHarness = harness(['denied', 'approved']);
	const sealed = plan({ riskLevel: 'elevated' });
	const activeGrant = grant([sealed.capability, 'tasks.update.apply']);
	const binding = bindPlan(cancelledHarness.policy, activeGrant, sealed);

	const denied = await cancelledHarness.policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(denied.ok, false);
	assert.equal(denied.ok ? undefined : denied.code, 'consent-denied');

	const replay = await cancelledHarness.policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(replay.ok, false);
	assert.equal(replay.ok ? undefined : replay.reasonCode, 'plan-consent-already-denied');
	assert.equal(cancelledHarness.prompts.length, 1);

	const throwingPolicy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => Promise.reject(new Error('UI unavailable')) },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const throwingBinding = bindPlan(throwingPolicy, activeGrant, sealed);
	const unavailable = await throwingPolicy.admitApply({
		session,
		grant: activeGrant,
		binding: throwingBinding,
		plan: sealed,
	});
	assert.equal(unavailable.ok, false);
	assert.equal(unavailable.ok ? undefined : unavailable.reasonCode, 'consent-unavailable');
});

test('rechecks grant revision after consent and preserves only same-plan recovery after dispatch', async () => {
	let resolveConsent: ((decision: DeveloperConsentDecisionV1) => void) | undefined;
	let currentGrantRevision = 4;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: {
			requestConsent: () => new Promise(resolve => {
				resolveConsent = resolve;
			}),
		},
		isSessionCurrent: () => true,
		isGrantCurrent: candidate => candidate.revision === currentGrantRevision,
		now: () => new Date(),
	});
	const sealed = plan({ riskLevel: 'elevated' });
	const activeGrant = grant([sealed.capability, 'tasks.update.apply']);
	const binding = bindPlan(policy, activeGrant, sealed);

	const applyPromise = policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	const concurrent = await policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(concurrent.ok, false);
	assert.equal(concurrent.ok ? undefined : concurrent.reasonCode, 'consent-in-progress');
	currentGrantRevision = 5;
	resolveConsent?.('approved');
	const revokedDuringConsent = await applyPromise;
	assert.equal(revokedDuringConsent.ok, false);
	assert.equal(
		revokedDuringConsent.ok ? undefined : revokedDuringConsent.reasonCode,
		'grant-revision-changed',
	);

	const revised = await policy.admitApply({
		session,
		grant: grant([sealed.capability], { revision: 4 }),
		binding,
		plan: sealed,
	});
	assert.equal(revised.ok, false);
	assert.equal(revised.ok ? undefined : revised.reasonCode, 'grant-revision-changed');

	const recovery = policy.admitRecovery({
		session,
		plan: sealed,
		dispatch: { binding, dispatchStarted: true },
	});
	assert.equal(recovery.ok, true);

	const notDispatched = policy.admitRecovery({
		session,
		plan: sealed,
		dispatch: { binding, dispatchStarted: false },
	});
	assert.equal(notDispatched.ok, false);
	assert.equal(notDispatched.ok ? undefined : notDispatched.reasonCode, 'apply-not-dispatched');

	const changedPlan = plan({ planHash: 'different-plan' });
	const wrongPlan = policy.admitRecovery({
		session,
		plan: changedPlan,
		dispatch: { binding, dispatchStarted: true },
	});
	assert.equal(wrongPlan.ok, false);
	assert.equal(wrongPlan.ok ? undefined : wrongPlan.reasonCode, 'plan-binding-mismatch');
});

test('claims apply dispatch once and rechecks live grant synchronously', () => {
	let currentGrantRevision = 4;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: candidate => candidate.revision === currentGrantRevision,
		now: () => new Date(),
	});
	const sealed = plan();
	const activeGrant = grant([sealed.capability, 'tasks.update.apply']);
	const binding = bindPlan(policy, activeGrant, sealed);

	currentGrantRevision = 5;
	const revoked = policy.claimApplyDispatch({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(revoked.ok, false);
	assert.equal(revoked.ok ? undefined : revoked.reasonCode, 'grant-revision-changed');

	currentGrantRevision = 4;
	const claimed = policy.claimApplyDispatch({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(claimed.ok, true);

	const duplicate = policy.claimApplyDispatch({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.ok ? undefined : duplicate.reasonCode, 'apply-already-claimed');

	policy.releaseApplyDispatchClaim({ session, plan: sealed });
	const reclaimed = policy.claimApplyDispatch({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});
	assert.equal(reclaimed.ok, true);
});
