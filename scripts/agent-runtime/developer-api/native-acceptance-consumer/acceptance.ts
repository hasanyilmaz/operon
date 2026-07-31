import type {
	DeveloperApiChannelStatusV1,
	OperonDeveloperApiAccessorV1,
	OperonDeveloperApiConsumerPluginV1,
	OperonDeveloperApiV1,
} from 'operon-cli/contracts/v1/developer-api';

import {
	ACCEPTANCE_OUTPUT_KIND_V1,
	type AcceptanceErrorEvidenceV1,
	type AcceptanceRunnerInputV1,
	type AcceptanceRunnerOutputV1,
} from './runner-contract.js';

export {
	ACCEPTANCE_INPUT_KIND_V1,
	parseRunnerInputV1,
} from './runner-contract.js';

interface ErrorShapeV1 {
	readonly code: string;
	readonly retryable: boolean;
	readonly action: string;
}

export interface AcceptanceHostV1 {
	readonly accessor: OperonDeveloperApiAccessorV1;
	readonly consumerPlugin: OperonDeveloperApiConsumerPluginV1;
	readonly registeredConsumer: unknown;
}

export async function runAcceptanceV1(
	input: AcceptanceRunnerInputV1,
	host: AcceptanceHostV1,
): Promise<AcceptanceRunnerOutputV1> {
	const exactInstance = host.registeredConsumer === host.consumerPlugin;
	const baselineRequest = {
		contractVersion: 1 as const,
		runtimeApi: { min: 1, max: 1 },
		requestedCapabilities: ['system.health', 'system.capabilities'] as const,
	};
	const forgedCopy = Object.freeze({
		manifest: Object.freeze({ ...host.consumerPlugin.manifest }),
	});
	const forgedResult = host.accessor.getDeveloperApiV1(forgedCopy, baselineRequest);
	const forgedCopyRejected = !forgedResult.ok
		&& forgedResult.error.code === 'authority-insufficient';
	const baselineAccess = host.accessor.getDeveloperApiV1(host.consumerPlugin, baselineRequest);
	if (
		!exactInstance
		|| !forgedCopyRejected
		|| !baselineAccess.ok
		|| baselineAccess.status.consumer?.id !== input.expectedConsumer.id
		|| baselineAccess.status.consumer?.version !== input.expectedConsumer.version
	) {
		return failed(
			input,
			'REGISTRY_IDENTITY_PROOF_FAILED',
			registryIdentity(
				exactInstance,
				forgedCopyRejected,
				forgedResult.ok ? null : forgedResult.error.code,
				baselineAccess.status,
			),
		);
	}

	const health = await baselineAccess.api.system.health();
	const capabilities = baselineAccess.api.system.capabilities();
	const baseline = {
		health: health.ok === true,
		capabilities: capabilities.length > 0,
		lifecyclePhase: health.lifecyclePhase ?? null,
		advertisedCapabilities: capabilities.length,
	};
	const identity = registryIdentity(
		true,
		true,
		forgedResult.ok ? null : forgedResult.error.code,
		baselineAccess.status,
	);
	if (!baseline.health || !baseline.capabilities) {
		return failed(input, 'BASELINE_DISCOVERY_FAILED', identity, baseline);
	}

	const requestedAccess = host.accessor.getDeveloperApiV1(host.consumerPlugin, {
		contractVersion: 1,
		runtimeApi: { min: 1, max: 1 },
		requestedCapabilities: input.requestedCapabilities,
	});
	const grant = grantEvidence(requestedAccess.status);
	if (!requestedAccess.ok) {
		if (requestedAccess.error.code === 'authority-insufficient') {
			return {
				evidenceVersion: 1,
				kind: ACCEPTANCE_OUTPUT_KIND_V1,
				runId: input.runId,
				phase: input.phase,
				status: 'blocked',
				completedAt: new Date().toISOString(),
				registryIdentity: identity,
				baseline,
				grant,
				failClosed: {
					error: errorEvidence(requestedAccess.error),
					writeAttempted: false,
				},
			};
		}
		return failed(input, `ACCESS_${requestedAccess.error.code}`, identity, baseline, grant);
	}
	if (
		requestedAccess.status.grant?.state !== 'active'
		|| !input.requestedCapabilities.every(capability => (
			requestedAccess.status.grant?.effectiveCapabilities.includes(capability)
		))
	) {
		return failed(input, 'EXACT_GRANT_NOT_ACTIVE', identity, baseline, grant);
	}

	if (input.phase === 'routine') {
		return runRoutine(input, requestedAccess.api, identity, baseline, grant);
	}
	return runRecovery(input, requestedAccess.api, identity, baseline, grant);
}

async function runRoutine(
	input: Extract<AcceptanceRunnerInputV1, { phase: 'routine' }>,
	api: OperonDeveloperApiV1,
	identity: NonNullable<AcceptanceRunnerOutputV1['registryIdentity']>,
	baseline: NonNullable<AcceptanceRunnerOutputV1['baseline']>,
	grant: NonNullable<AcceptanceRunnerOutputV1['grant']>,
): Promise<AcceptanceRunnerOutputV1> {
	const before = await api.tasks.get(input.exactRead);
	if (!before.ok) return failed(input, `EXACT_READ_${before.error.code}`, identity, baseline, grant);
	if (!exactTaskMatches(before, input)) {
		return failed(input, 'EXACT_READ_TARGET_MISMATCH', identity, baseline, grant);
	}
	const preview = await api.mutations.preview(input.mutation);
	if (!preview.ok) return failed(input, `PREVIEW_${preview.error.code}`, identity, baseline, grant);
	if (preview.plan.riskLevel !== 'routine' || preview.plan.requiresConsent) {
		return failed(input, 'ROUTINE_PLAN_POLICY_INVALID', identity, baseline, grant);
	}
	const applied = await api.mutations.apply({ plan: preview.plan });
	if (applied.status !== 'applied') {
		return failed(
			input,
			`ROUTINE_APPLY_${applied.error?.code ?? applied.status}`,
			identity,
			baseline,
			grant,
		);
	}
	const afterApply = await api.tasks.get(input.exactRead);
	if (!afterApply.ok) {
		return failed(input, `POST_APPLY_READ_${afterApply.error.code}`, identity, baseline, grant);
	}
	const afterApplyVerified = exactTaskMatches(afterApply, input)
		&& finalStateMatches(afterApply, input);
	const replayed = await api.mutations.apply({ plan: preview.plan });
	const afterReplay = await api.tasks.get(input.exactRead);
	if (!afterReplay.ok) {
		return failed(input, `POST_REPLAY_READ_${afterReplay.error.code}`, identity, baseline, grant);
	}
	const sourceRevisionStable = (
		afterApply.task.sourceRevision.algorithm === afterReplay.task.sourceRevision.algorithm
		&& afterApply.task.sourceRevision.contentDigest
			=== afterReplay.task.sourceRevision.contentDigest
	);
	const applyPlanDigestMatched = applied.receipt.planDigest === preview.plan.planDigest;
	const applyReceiptOutcomeMatched = applied.receipt.terminalOutcome === 'applied';
	const replayPlanDigestMatched = replayed.receipt?.planDigest === preview.plan.planDigest;
	const applyPostflightVerified = applied.postflight.status === 'verified';
	const replayPostflightVerified = replayed.postflight?.status === 'receipt-replay';
	const finalStateVerified = afterApplyVerified
		&& exactTaskMatches(afterReplay, input)
		&& finalStateMatches(afterReplay, input);
	const writeFreeReplay = (
		replayed.status === 'already-applied'
		&& replayed.receipt?.terminalOutcome === 'already-applied'
		&& replayPostflightVerified
		&& sourceRevisionStable
	);
	const exactRead = exactReadEvidence(afterReplay);
	const routine = {
		previewed: true,
		applied: true,
		replayed: replayed.status === 'already-applied',
		writeFreeReplay,
		recoveryRef: preview.plan.recoveryRef,
		planDigest: preview.plan.planDigest,
		applyStatus: applied.status,
		replayStatus: replayed.status,
		sourceRevisionStableAfterReplay: sourceRevisionStable,
		applyPlanDigestMatched,
		applyReceiptOutcomeMatched,
		replayPlanDigestMatched,
		applyPostflightVerified,
		replayPostflightVerified,
		finalStateVerified,
	};
	if (
		!writeFreeReplay
		|| !applyPlanDigestMatched
		|| !applyReceiptOutcomeMatched
		|| !replayPlanDigestMatched
		|| !applyPostflightVerified
		|| !finalStateVerified
	) {
		return {
			...failed(input, 'ROUTINE_FINAL_PROOF_NOT_VERIFIED', identity, baseline, grant),
			runtimeSessionId: api.sessionId,
			exactRead,
			routine,
		};
	}
	return {
		evidenceVersion: 1,
		kind: ACCEPTANCE_OUTPUT_KIND_V1,
		runId: input.runId,
		phase: input.phase,
		status: 'passed',
		completedAt: new Date().toISOString(),
		runtimeSessionId: api.sessionId,
		registryIdentity: identity,
		baseline,
		grant,
		exactRead,
		routine,
	};
}

async function runRecovery(
	input: Extract<AcceptanceRunnerInputV1, { phase: 'recovery' }>,
	api: OperonDeveloperApiV1,
	identity: NonNullable<AcceptanceRunnerOutputV1['registryIdentity']>,
	baseline: NonNullable<AcceptanceRunnerOutputV1['baseline']>,
	grant: NonNullable<AcceptanceRunnerOutputV1['grant']>,
): Promise<AcceptanceRunnerOutputV1> {
	const pendingBefore = await api.mutations.pendingRecoveries();
	if (!pendingBefore.ok) {
		return failed(input, `PENDING_RECOVERIES_${pendingBefore.error.code}`, identity, baseline, grant);
	}
	const recovered = await api.mutations.recover({ recoveryRef: input.recoveryRef });
	const exactReadResult = await api.tasks.get(input.exactRead);
	if (!exactReadResult.ok) {
		return failed(
			input,
			`POST_RECOVERY_READ_${exactReadResult.error.code}`,
			identity,
			baseline,
			grant,
		);
	}
	const pendingAfter = await api.mutations.pendingRecoveries();
	if (!pendingAfter.ok) {
		return failed(input, `PENDING_AFTER_${pendingAfter.error.code}`, identity, baseline, grant);
	}
	const receiptReplayed = recovered.status === 'already-applied'
		&& recovered.receipt?.terminalOutcome === 'already-applied'
		&& recovered.postflight?.status === 'receipt-replay';
	const receiptPlanDigestMatched = recovered.receipt?.planDigest
		=== input.routineEvidence.planDigest;
	const sessionChanged = api.sessionId !== input.routineEvidence.sessionId;
	const instanceChanged = identity.instanceEpoch !== input.routineEvidence.instanceEpoch;
	const finalStateVerified = exactTaskMatches(exactReadResult, input)
		&& finalStateMatches(exactReadResult, input);
	const pendingMatch = pendingBefore.recoveries.find(item => (
		item.recoveryRef === input.recoveryRef
	));
	const recovery = {
		recoveryRef: input.recoveryRef,
		planDigest: input.routineEvidence.planDigest,
		routineEvidenceSha256: input.routineEvidence.sha256,
		listedPendingBefore: Boolean(pendingMatch),
		status: recovered.status,
		receiptReplayed,
		listedPendingAfter: pendingAfter.recoveries.some(item => (
			item.recoveryRef === input.recoveryRef
		)),
		receiptPlanDigestMatched,
		sessionChanged,
		instanceChanged,
		finalStateVerified,
	};
	if (
		(pendingMatch !== undefined && pendingMatch.planDigest !== input.routineEvidence.planDigest)
		|| !receiptReplayed
		|| !receiptPlanDigestMatched
		|| !sessionChanged
		|| !instanceChanged
		|| !finalStateVerified
		|| recovery.listedPendingAfter
	) {
		return {
			...failed(input, 'RESTART_RECOVERY_REF_NOT_PROVEN', identity, baseline, grant),
			runtimeSessionId: api.sessionId,
			exactRead: exactReadEvidence(exactReadResult),
			recovery,
		};
	}
	return {
		evidenceVersion: 1,
		kind: ACCEPTANCE_OUTPUT_KIND_V1,
		runId: input.runId,
		phase: input.phase,
		status: 'passed',
		completedAt: new Date().toISOString(),
		runtimeSessionId: api.sessionId,
		registryIdentity: identity,
		baseline,
		grant,
		exactRead: exactReadEvidence(exactReadResult),
		recovery,
	};
}

function exactTaskMatches(
	result: Awaited<ReturnType<OperonDeveloperApiV1['tasks']['get']>>,
	input: AcceptanceRunnerInputV1,
): boolean {
	return result.ok
		&& result.task.identity.operonId === input.expectedTask.operonId
		&& result.task.representation === input.expectedTask.representation;
}

function finalStateMatches(
	result: Awaited<ReturnType<OperonDeveloperApiV1['tasks']['get']>>,
	input: AcceptanceRunnerInputV1,
): boolean {
	return result.ok && result.task.note === input.expectedFinalState.note;
}

function exactReadEvidence(
	result: Awaited<ReturnType<OperonDeveloperApiV1['tasks']['get']>>,
): NonNullable<AcceptanceRunnerOutputV1['exactRead']> {
	if (!result.ok) {
		return {
			ok: false,
			operonId: null,
			representation: null,
			sourceRevision: null,
			error: errorEvidence(result.error),
		};
	}
	return {
		ok: true,
		operonId: result.task.identity.operonId,
		representation: result.task.representation,
		sourceRevision: result.task.sourceRevision,
	};
}

function registryIdentity(
	exactInstance: boolean,
	forgedCopyRejected: boolean,
	forgedCopyErrorCode: string | null,
	status: DeveloperApiChannelStatusV1,
): NonNullable<AcceptanceRunnerOutputV1['registryIdentity']> {
	return {
		exactInstance,
		forgedCopyRejected,
		forgedCopyErrorCode,
		consumerId: status.consumer?.id ?? null,
		instanceEpoch: status.consumer?.instanceEpoch ?? null,
	};
}

function grantEvidence(
	status: DeveloperApiChannelStatusV1,
): NonNullable<AcceptanceRunnerOutputV1['grant']> {
	return {
		state: status.grant?.state ?? null,
		revision: status.grant?.revision ?? null,
		requestedCapabilities: status.grant?.requestedCapabilities ?? [],
		grantedCapabilities: status.grant?.grantedCapabilities ?? [],
		effectiveCapabilities: status.grant?.effectiveCapabilities ?? [],
	};
}

function errorEvidence(error: ErrorShapeV1): AcceptanceErrorEvidenceV1 {
	return {
		code: error.code,
		retryable: error.retryable,
		action: error.action,
	};
}

function failed(
	input: AcceptanceRunnerInputV1,
	code: string,
	registry?: NonNullable<AcceptanceRunnerOutputV1['registryIdentity']>,
	baseline?: NonNullable<AcceptanceRunnerOutputV1['baseline']>,
	grant?: NonNullable<AcceptanceRunnerOutputV1['grant']>,
): AcceptanceRunnerOutputV1 {
	return {
		evidenceVersion: 1,
		kind: ACCEPTANCE_OUTPUT_KIND_V1,
		runId: input.runId,
		phase: input.phase,
		status: 'failed',
		completedAt: new Date().toISOString(),
		...(registry ? { registryIdentity: registry } : {}),
		...(baseline ? { baseline } : {}),
		...(grant ? { grant } : {}),
		error: { code },
	};
}
