import { createHash } from 'node:crypto';

import {
	classifyApplyCorrectness,
	evaluateStage1Gates,
} from './cli-speed-stage1-core.mjs';

export const STAGE3_ACCEPTED_BATCH_MILESTONE = Object.freeze({
	batch20Speedup: 13.293346383606774,
	batch64Speedup: 23.626719935372364,
	batch20RetentionFloor: 11.964,
	batch64RetentionFloor: 21.264,
});

const REQUIRED_BATCH_SCENARIOS = Object.freeze([
	'batch-create-1.preview',
	'batch-create-1.apply',
	'batch-create-20.preview',
	'batch-create-20.apply',
	'batch-create-64.preview',
	'batch-create-64.apply',
]);

const HUMAN_WORKFLOW_GATES = Object.freeze({
	create: Object.freeze({
		baselineDispatches: 4,
		candidateDispatches: 3,
		p50ImprovementPercent: 15,
		p95ImprovementPercent: 10,
	}),
	update: Object.freeze({
		baselineDispatches: 5,
		candidateDispatches: 3,
		p50ImprovementPercent: 23,
		p95ImprovementPercent: 20,
	}),
});
const USER_ACCEPTED_BATCH1_APPLY_P95_REGRESSION_PERCENT = 18;

export function buildAcceptedStage2BatchMilestone(evidence) {
	assertFullCorrectnessEvidence(evidence);
	assertBatchScenarioEvidence(evidence);
	const absoluteGate = evaluateStage1Gates(evidence);
	if (absoluteGate.ok !== true) {
		throw new Error(
			`Accepted Stage 2 candidate does not pass absolute gates: ${absoluteGate.failures.join(', ')}`,
		);
	}
	assertNear(
		evidence.batchSpeedups?.[20],
		STAGE3_ACCEPTED_BATCH_MILESTONE.batch20Speedup,
		'Stage 2 batch-20 speedup',
	);
	assertNear(
		evidence.batchSpeedups?.[64],
		STAGE3_ACCEPTED_BATCH_MILESTONE.batch64Speedup,
		'Stage 2 batch-64 speedup',
	);
	if (evidence.fileUpdateCharacterization?.ok !== true) {
		throw new Error('Accepted Stage 2 candidate lacks a clean File Task characterization.');
	}
	return {
		schemaVersion: 1,
		kind: 'operon-cli-stage2-batch-milestone',
		sealedAt: new Date().toISOString(),
		sourceEvidence: {
			recordedAt: evidence.recordedAt,
			sha256: sha256Json(evidence),
			environment: evidence.environment,
			fixtureDigest: evidence.fixtureDigest,
			collection: evidence.collection,
		},
		scope: {
			historicalComparison: 'batch-only',
			frozenBaselineWholeSuiteAdmissible: false,
			frozenBaselineBatchScenariosCorrect: true,
			candidateAbsoluteGate: absoluteGate,
		},
		accepted: {
			batchSpeedups: {
				20: evidence.batchSpeedups[20],
				64: evidence.batchSpeedups[64],
			},
			retentionFloors: {
				20: STAGE3_ACCEPTED_BATCH_MILESTONE.batch20RetentionFloor,
				64: STAGE3_ACCEPTED_BATCH_MILESTONE.batch64RetentionFloor,
			},
			scenarios: Object.fromEntries(
				REQUIRED_BATCH_SCENARIOS.map(name => [name, evidence.scenarios[name]]),
			),
			fileUpdateCharacterization: evidence.fileUpdateCharacterization,
		},
		artifacts: evidence.artifacts,
		historicalComparison: {
			baselineGate: evidence.stage2?.baselineGate,
			comparison: evidence.stage2?.comparison?.batchSpeedups,
			frozenArtifacts: evidence.stage2?.frozenArtifacts,
			candidateArtifacts: evidence.stage2?.candidateArtifacts,
		},
	};
}

export function assertAdmissibleStage3Baseline(evidence) {
	assertFullCorrectnessEvidence(evidence);
	if (!Array.isArray(evidence?.gates?.failures)) {
		throw new Error('Stage 3 baseline absolute gate evidence is missing.');
	}
	if (evidence.gates.ok !== (evidence.gates.failures.length === 0)) {
		throw new Error('Stage 3 baseline gate status is inconsistent with its failures.');
	}
	const unsupportedGateFailures = evidence.gates.failures.filter(failure => (
		!isAdmissibleBaselinePerformanceFailure(failure)
		&& !isProvenRecoveredCorrectnessFailure(evidence, failure)
	));
	if (unsupportedGateFailures.length > 0) {
		throw new Error(
			`Stage 3 baseline has unsupported gate failures: ${unsupportedGateFailures.join(', ')}`,
		);
	}
	if (evidence?.collection?.mode !== 'core') {
		throw new Error('Stage 3 baseline must be a full core collection.');
	}
	if (evidence?.collection?.performanceGatesAuthoritative !== true) {
		throw new Error('Stage 3 baseline performance evidence is not authoritative.');
	}
	if (evidence?.collection?.production?.authoritativeForGates !== true) {
		throw new Error('Stage 3 baseline production collection is not authoritative.');
	}
	if (evidence?.fileUpdateCharacterization?.ok !== true) {
		throw new Error('Stage 3 baseline File Task characterization is incomplete.');
	}
	for (const [family, gate] of Object.entries(HUMAN_WORKFLOW_GATES)) {
		const failures = classifyHumanWorkflow(evidence, family, gate.baselineDispatches);
		if (failures.length > 0) {
			throw new Error(`Stage 3 baseline ${family} workflow is incomplete: ${failures.join(', ')}`);
		}
	}
	return evidence;
}

export function evaluateStage3Candidate({
	baseline,
	candidate,
	jsonlSession,
	expectedProfile,
}) {
	assertAdmissibleStage3Baseline(baseline);
	assertFullCorrectnessEvidence(candidate);
	const failures = [];
	if (
		candidate?.collection?.mode !== 'core'
		|| candidate.collection.performanceGatesAuthoritative !== true
		|| candidate.collection.production?.authoritativeForGates !== true
	) {
		failures.push('candidate:full-authoritative-collection-required');
	}
	if (candidate?.fileUpdateCharacterization?.ok !== true) {
		failures.push('candidate:file-update-characterization-all-attempts-not-met');
	}
	if (expectedProfile) {
		for (const [field, expected] of [
			['cold', expectedProfile.cold],
			['warm', expectedProfile.warm],
			['warmup', expectedProfile.warmup],
			['batch', expectedProfile.batch],
			['batchWarmup', expectedProfile.batchWarmup],
		]) {
			if (candidate?.collection?.counts?.[field] !== expected) {
				failures.push(`candidate:${field}-sample-count-mismatch`);
			}
		}
		if (candidate?.fileUpdateCharacterization?.attempts !== expectedProfile.fileUpdate) {
			failures.push('candidate:file-update-sample-count-mismatch');
		}
	}
	const absoluteGate = evaluateStage1Gates(candidate);
	for (const failure of absoluteGate.failures) failures.push(`absolute:${failure}`);
	const relativeGate = evaluateStage1Gates(candidate, { baseline });
	for (const failure of relativeGate.failures) {
		if (
			failure === 'batch-create-1.apply:total-p95-regressed'
			&& regressionPercent(
				baseline?.scenarios?.['batch-create-1.apply']?.totalMs?.p95,
				candidate?.scenarios?.['batch-create-1.apply']?.totalMs?.p95,
			) <= USER_ACCEPTED_BATCH1_APPLY_P95_REGRESSION_PERCENT
		) continue;
		if (!absoluteGate.failures.includes(failure)) failures.push(`relative:${failure}`);
	}
	for (const [size, floor] of [
		[20, STAGE3_ACCEPTED_BATCH_MILESTONE.batch20RetentionFloor],
		[64, STAGE3_ACCEPTED_BATCH_MILESTONE.batch64RetentionFloor],
	]) {
		const speedup = candidate?.batchSpeedups?.[size];
		if (!Number.isFinite(speedup) || speedup < floor) {
			failures.push(`batch-${size}:accepted-milestone-retention-not-met`);
		}
	}
	for (const failure of classifyJsonlSession(jsonlSession, expectedProfile)) failures.push(failure);
	const subprocessWarmRead = baseline?.scenarios?.['task-get.warm']?.totalMs;
	const subprocessRequestsPerSecond = Number.isFinite(subprocessWarmRead?.p50)
		&& subprocessWarmRead.p50 > 0
		? 1000 / subprocessWarmRead.p50
		: null;
	if (!Number.isFinite(subprocessRequestsPerSecond)) {
		failures.push('baseline:task-get-warm-subprocess-throughput-unavailable');
	} else if (
		Number.isFinite(jsonlSession?.throughput?.requestsPerSecond)
		&& jsonlSession.throughput.requestsPerSecond < subprocessRequestsPerSecond * 2
	) {
		failures.push('jsonl-session:throughput-less-than-2x-subprocess');
	}
	for (const [family, gate] of Object.entries(HUMAN_WORKFLOW_GATES)) {
		for (const failure of classifyHumanWorkflow(candidate, family, gate.candidateDispatches)) {
			failures.push(`human-${family}:${failure}`);
		}
		for (const metric of ['p50', 'p95']) {
			const reference = baseline?.humanOneLineWorkflows?.[family]?.outerWallMs?.[metric];
			const observed = candidate?.humanOneLineWorkflows?.[family]?.outerWallMs?.[metric];
			const required = metric === 'p50'
				? gate.p50ImprovementPercent
				: gate.p95ImprovementPercent;
			if (
				!Number.isFinite(reference)
				|| !Number.isFinite(observed)
				|| percentImprovement(reference, observed) < required
			) {
				failures.push(`human-${family}:outer-wall-${metric}-improvement-below-${required}-percent`);
			}
		}
	}
	return {
		ok: failures.length === 0,
		failures,
		absoluteGate,
		relativeGate,
		jsonlComparison: {
			subprocessWarmTaskGet: subprocessWarmRead,
			subprocessRequestsPerSecond,
			candidateRequestsPerSecond: jsonlSession?.throughput?.requestsPerSecond ?? null,
			requiredThroughputMultiplier: 2,
		},
	};
}

export function assertAdmissibleStage3JsonlSession(value) {
	const failures = classifyJsonlSession(value);
	if (failures.length > 0) {
		throw new Error(`Stage 3 JSONL baseline is incomplete: ${failures.join(', ')}`);
	}
	return value;
}

export function compactWorkflowEvidence(evidence) {
	return Object.fromEntries(['create', 'update'].map(family => [
		family,
		{
			warmupSamples: evidence?.collection?.counts?.warmup ?? null,
			measuredSamples: evidence?.humanOneLineWorkflows?.[family]?.attempts ?? null,
			workflow: evidence?.humanOneLineWorkflows?.[family],
			samples: evidence?.humanOneLineSamples?.[family],
		},
	]));
}

export function sha256Json(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertFullCorrectnessEvidence(evidence) {
	const scenarios = evidence?.scenarios;
	if (!scenarios || typeof scenarios !== 'object' || Object.keys(scenarios).length === 0) {
		throw new Error('Performance evidence has no scenarios.');
	}
	for (const [name, scenario] of Object.entries(scenarios)) {
		const recoveredSamples = recoveredSamePlanSamples(evidence, name);
		const directTimingCoverage = scenario?.successes / scenario?.attempts;
		if (
			!Number.isSafeInteger(scenario?.attempts)
			|| scenario.attempts < 1
			|| scenario.successes + recoveredSamples !== scenario.attempts
			|| directTimingCoverage < 0.9
			|| scenario.handlerSamples !== scenario.successes
			|| scenario.totalSamples !== scenario.successes
			|| !hasFiniteTimingSummary(scenario.handlerMs)
			|| !hasFiniteTimingSummary(scenario.totalMs)
		) {
			throw new Error(`Performance correctness or timing evidence is incomplete for ${name}.`);
		}
	}
}

function isAdmissibleBaselinePerformanceFailure(failure) {
	return [
		':warm-total-max-exceeded',
		':preview-handler-p95-exceeded',
		':apply-handler-p95-exceeded',
	].some(suffix => failure.endsWith(suffix))
		|| /^batch-(20|64):minimum-speedup-not-met$/u.test(failure);
}

function isProvenRecoveredCorrectnessFailure(evidence, failure) {
	const match = /^(.*):(successes-do-not-match-attempts|missing-handler-timings|missing-total-timings)$/u
		.exec(failure);
	if (!match) return false;
	return recoveredSamePlanSamples(evidence, match[1]) > 0;
}

function hasFiniteTimingSummary(summary) {
	return Number.isFinite(summary?.p50)
		&& Number.isFinite(summary?.p95)
		&& Number.isFinite(summary?.max);
}

function recoveredSamePlanSamples(evidence, scenarioName) {
	if (!Array.isArray(evidence?.rawSamples)) return 0;
	return evidence.rawSamples.filter(sample => (
		sample?.scenario === scenarioName
		&& classifyApplyCorrectness(sample).ok === true
		&& sample.correctness?.apply?.samePlanRecovery?.status === 'already-applied'
		&& sample.correctness.apply.samePlanRecovery.postflightStatus === 'receipt-replay'
		&& sample.correctness?.finalState?.verified === true
		&& sample.correctness.finalState.description === true
		&& sample.correctness.finalState.status === true
		&& sample.correctness.finalState.locator === true
		&& sample.correctness.finalState.revision === true
	)).length;
}

function assertBatchScenarioEvidence(evidence) {
	for (const name of REQUIRED_BATCH_SCENARIOS) {
		const scenario = evidence?.scenarios?.[name];
		if (!scenario || scenario.successes !== scenario.attempts) {
			throw new Error(`Accepted Stage 2 batch evidence is incomplete for ${name}.`);
		}
	}
}

function classifyJsonlSession(value, expectedProfile) {
	if (value?.status !== 'collected') {
		return [`jsonl-session:${value?.reason ?? 'not-collected'}`];
	}
	const failures = [];
	const expectedWarm = expectedProfile?.sessionWarm ?? value.samplePlan?.warm ?? 100;
	const expectedThroughput = expectedProfile?.sessionThroughput
		?? value.samplePlan?.throughput
		?? 100;
	const expectedLeak = expectedProfile?.sessionLeak ?? value.samplePlan?.leak ?? 1000;
	const expectedWarmup = expectedProfile?.warmup ?? value.samplePlan?.warmup ?? 3;
	const expectedDispatches = expectedWarmup
		+ expectedWarm
		+ expectedThroughput
		+ expectedLeak;
	if (expectedProfile && (
		value.samplePlan?.warmup !== expectedWarmup
		|| value.samplePlan?.warm !== expectedWarm
		|| value.samplePlan?.throughput !== expectedThroughput
		|| value.samplePlan?.leak !== expectedLeak
	)) {
		failures.push('jsonl-session:sample-plan-mismatch');
	}
	if (
		value.warmReads?.attempts !== expectedWarm
		|| value.warmReads.successes !== expectedWarm
	) {
		failures.push('jsonl-session:warm-read-all-attempts-not-met');
	}
	if (
		value.throughput?.attempts !== expectedThroughput
		|| value.throughput.successes !== expectedThroughput
	) {
		failures.push('jsonl-session:throughput-all-attempts-not-met');
	}
	if (
		value.leakCharacterization?.attempts !== expectedLeak
		|| value.leakCharacterization.successes !== expectedLeak
		|| !Number.isFinite(value.leakCharacterization.rssDeltaBytes)
	) {
		failures.push('jsonl-session:leak-all-attempts-not-met');
	} else if (value.leakCharacterization.rssDeltaBytes >= 20 * 1024 * 1024) {
		failures.push('jsonl-session:rss-growth-not-below-20mib');
	}
	if (
		value.runtimeDispatches?.count !== value.runtimeDispatches?.expected
		|| value.runtimeDispatches?.expected !== expectedDispatches
	) {
		failures.push('jsonl-session:runtime-dispatch-count-mismatch');
	}
	if (!Number.isFinite(value.warmReads?.durationMs?.p50) || value.warmReads.durationMs.p50 >= 30) {
		failures.push('jsonl-session:warm-read-p50-not-below-30ms');
	}
	if (!Number.isFinite(value.warmReads?.durationMs?.p95) || value.warmReads.durationMs.p95 >= 45) {
		failures.push('jsonl-session:warm-read-p95-not-below-45ms');
	}
	if (!Number.isFinite(value.throughput?.requestsPerSecond)) {
		failures.push('jsonl-session:throughput-rate-unavailable');
	}
	return failures;
}

function classifyHumanWorkflow(evidence, family, expectedDispatches) {
	const summary = evidence?.humanOneLineWorkflows?.[family];
	const samples = evidence?.humanOneLineSamples?.[family];
	const expectedSamples = evidence?.collection?.counts?.warm ?? 30;
	const failures = [];
	if (
		summary?.attempts !== expectedSamples
		|| summary.successes !== expectedSamples
		|| !Array.isArray(samples)
		|| samples.length !== expectedSamples
		|| samples.some(sample => sample?.ok !== true)
	) {
		failures.push('all-attempts-correctness-not-met');
	}
	if (
		!Array.isArray(samples)
		|| samples.some(sample => sample?.runtimeCalls !== expectedDispatches)
	) {
		failures.push(`runtime-dispatches-not-exactly-${expectedDispatches}`);
	}
	for (const metric of ['outerWallMs', 'cliTotalMs', 'handlerMs', 'runtimeCalls']) {
		if (
			summary?.[metric]?.samples !== expectedSamples
			|| !Number.isFinite(summary[metric].p50)
			|| !Number.isFinite(summary[metric].p95)
		) {
			failures.push(`${metric}-evidence-incomplete`);
		}
	}
	return failures;
}

function percentImprovement(reference, observed) {
	return ((reference - observed) / reference) * 100;
}

function regressionPercent(reference, observed) {
	if (!Number.isFinite(reference) || reference <= 0 || !Number.isFinite(observed)) return Infinity;
	return ((observed - reference) / reference) * 100;
}

function assertNear(value, expected, label) {
	if (!Number.isFinite(value) || Math.abs(value - expected) > 1e-9) {
		throw new Error(`${label} does not match the user-accepted milestone.`);
	}
}
