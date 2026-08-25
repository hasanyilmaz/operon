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
	type DeveloperMutationCapabilityV1,
	type DeveloperMutationSealedPlanV1,
	type DeveloperSecuritySessionV1,
} from '../../../../src/agent-runtime/developer-api/security';
import { resolveDeveloperRoutineAuthorizationBasisV1 } from '../../../../src/agent-runtime/developer-api/security/policy';
import { requestBoundedDeveloperConsentV1 } from '../../../../src/agent-runtime/developer-api/security/bounded-consent';

class FakeConsentWindow {
	focused = false;
	activeWindow: FakeConsentWindow = this;
	activeDocument: Document = { marker: 'previous' } as unknown as Document;
	private nextHandle = 1;
	private readonly timers = new Map<number, { handler: () => void; timeoutMs: number }>();

	focus(): void {
		this.focused = true;
	}

	setTimeout(handler: () => void, timeoutMs: number): number {
		const handle = this.nextHandle++;
		this.timers.set(handle, { handler, timeoutMs });
		return handle;
	}

	clearTimeout(handle: number): void {
		this.timers.delete(handle);
	}

	run(timeoutMs: number): void {
		const matches = [...this.timers.entries()]
			.filter(([, timer]) => timer.timeoutMs === timeoutMs);
		for (const [handle, timer] of matches) {
			this.timers.delete(handle);
			timer.handler();
		}
	}
}

test('opens Developer API consent in the owning window and returns the decision', async () => {
	const ownerWindow = new FakeConsentWindow();
	const ownerDocument = { marker: 'owner' } as unknown as Document;
	const previousWindow = new FakeConsentWindow();
	const previousDocument = ownerWindow.activeDocument;
	ownerWindow.activeWindow = previousWindow;
	let decide: ((confirmed: boolean) => void) | undefined;
	let openedAgainstOwner = false;
	const decisionPromise = requestBoundedDeveloperConsentV1({
		ownerWindow,
		ownerDocument,
		timeoutMs: 45_000,
		show: onDecision => {
			openedAgainstOwner = ownerWindow.activeWindow === ownerWindow
				&& ownerWindow.activeDocument === ownerDocument;
			decide = onDecision;
			return () => {};
		},
	});
	assert.equal(ownerWindow.focused, true);
	ownerWindow.run(0);
	assert.equal(openedAgainstOwner, true);
	assert.equal(ownerWindow.activeWindow, previousWindow);
	assert.equal(ownerWindow.activeDocument, previousDocument);
	decide?.(true);
	assert.equal(await decisionPromise, 'approved');
});

test('closes unavailable Developer API consent after a bounded timeout', async () => {
	const ownerWindow = new FakeConsentWindow();
	const ownerDocument = { marker: 'owner' } as unknown as Document;
	let closed = false;
	let decide: ((confirmed: boolean) => void) | undefined;
	const decisionPromise = requestBoundedDeveloperConsentV1({
		ownerWindow,
		ownerDocument,
		timeoutMs: 45_000,
		show: onDecision => {
			decide = onDecision;
			return () => {
				closed = true;
			};
		},
	});
	ownerWindow.run(0);
	ownerWindow.run(45_000);
	assert.equal(await decisionPromise, 'unavailable');
	assert.equal(closed, true);
	decide?.(true);
});

const session: DeveloperSecuritySessionV1 = {
	consumerId: 'obsidian-plugin:test.consumer',
	instanceEpoch: 'instance-1',
	sessionId: 'session-1',
};

const confirmationTargets: SealedMutationPlanV1['targets'] = [{
	operonId: 'abc1234',
	locator: {
		representation: 'inline',
		filePath: 'Tasks.md',
		lineNumber: 0,
	},
	targetDigest: 'primary-target-digest',
}];

function grant(
	capabilities: DeveloperMutationCapabilityV1[],
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

test('maps routine Developer API plans to the authorization basis required by Runtime V1', () => {
	const cases: ReadonlyArray<{
		name: string;
		plan: Pick<DeveloperMutationSealedPlanV1, 'capability' | 'mutationKind'>;
		expectedBasis: 'user-explicit-request' | 'user-standing-instruction';
	}> = [
		{
			name: 'ordinary update',
			plan: { capability: 'tasks.update.preview', mutationKind: 'task.update' },
			expectedBasis: 'user-standing-instruction',
		},
		{
			name: 'task creation',
			plan: { capability: 'tasks.create.preview', mutationKind: 'task.create' },
			expectedBasis: 'user-explicit-request',
		},
		{
			name: 'task adoption',
			plan: { capability: 'tasks.adopt.preview', mutationKind: 'task.adopt' },
			expectedBasis: 'user-explicit-request',
		},
		{
			name: 'periodic-note creation',
			plan: { capability: 'tasks.create.periodic-note.preview', mutationKind: 'task.create' },
			expectedBasis: 'user-explicit-request',
		},
		{
			name: 'periodic-note update',
			plan: { capability: 'tasks.update.periodic-note.preview', mutationKind: 'task.update' },
			expectedBasis: 'user-explicit-request',
		},
	];

	for (const testCase of cases) {
		assert.equal(
			resolveDeveloperRoutineAuthorizationBasisV1(testCase.plan),
			testCase.expectedBasis,
			testCase.name,
		);
	}
});

function plan(options: {
	capability?: CapabilityIdV1;
	mutationKind?: MutationKindV1;
	riskLevel?: RiskLevelV1;
	planHash?: string;
	requiredAcknowledgements?: string[];
	targets?: SealedMutationPlanV1['targets'];
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
		targets: options.targets ?? [],
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
		targets: [
			...confirmationTargets,
			{
				operonId: 'def5678',
				locator: {
					representation: 'inline',
					filePath: 'Tasks.md',
					lineNumber: 1,
				},
				targetDigest: 'secondary-target-digest',
			},
		],
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
			targetDigest: sealed.targets[0].targetDigest,
			acknowledgedAt: '2026-07-29T10:01:00.000Z',
		},
		{
			code: 'attached-checkboxes',
			planHash: sealed.planHash,
			targetDigest: sealed.targets[0].targetDigest,
			acknowledgedAt: '2026-07-29T10:01:00.000Z',
		},
	]);
	assert.deepEqual(prompts, [{
		consumerId: session.consumerId,
		capability: 'tasks.delete.apply',
		mutationKind: sealed.mutationKind,
		riskLevel: sealed.riskLevel,
		planHash: sealed.planHash,
		targetDigest: sealed.receiptTargetDigest,
		targetCount: 2,
		predictedEffects: sealed.predictedEffects,
		acknowledgementCodes: sealed.requiredAcknowledgements,
	}]);
});

test('fails closed before consent when a confirmation plan has no sealed target', async () => {
	const { policy, prompts } = harness(['approved']);
	const sealed = plan({
		riskLevel: 'elevated',
		requiredAcknowledgements: ['terminal-transition'],
	});
	const activeGrant = grant([sealed.capability, 'tasks.update.apply']);
	const binding = bindPlan(policy, activeGrant, sealed);

	const denied = await policy.admitApply({
		session,
		grant: activeGrant,
		binding,
		plan: sealed,
	});

	assert.equal(denied.ok, false);
	assert.equal(denied.ok ? undefined : denied.code, 'invalid-request');
	assert.equal(denied.ok ? undefined : denied.reasonCode, 'plan-binding-mismatch');
	assert.deepEqual(prompts, []);
});

test('blocks consent replay after cancellation and fails closed when UI throws', async () => {
	const cancelledHarness = harness(['denied', 'approved']);
	const sealed = plan({ riskLevel: 'elevated', targets: confirmationTargets });
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
	const sealed = plan({ riskLevel: 'elevated', targets: confirmationTargets });
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
