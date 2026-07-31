import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	STAGE3_ACCEPTED_BATCH_MILESTONE,
	assertAdmissibleStage3Baseline,
	assertAdmissibleStage3JsonlSession,
	buildAcceptedStage2BatchMilestone,
	compactWorkflowEvidence,
	evaluateStage3Candidate,
} from './cli-speed-stage3-core.mjs';

function scenario(value = 10) {
	return {
		attempts: 30,
		successes: 30,
		correctnessFailures: [],
		handlerSamples: 30,
		totalSamples: 30,
		handlerMs: { p50: value, p95: value, max: value },
		totalMs: { p50: value, p95: value, max: value },
	};
}

function evidence() {
	const scenarios = {
		'compact-create.preview': scenario(),
		'compact-create.apply': scenario(),
		'update.preview': scenario(),
		'update.apply': scenario(),
		'batch-create-1.preview': scenario(),
		'batch-create-1.apply': scenario(),
		'batch-create-20.preview': scenario(),
		'batch-create-20.apply': scenario(),
		'batch-create-64.preview': scenario(),
		'batch-create-64.apply': scenario(),
		'task-get.warm': scenario(20),
	};
	return {
		recordedAt: '2026-07-28T12:00:00.000Z',
		environment: { host: 'test' },
		fixtureDigest: 'fixture',
		artifacts: { production: { sha256: 'production' } },
		scenarios,
		scenarioMetadata: Object.fromEntries(Object.keys(scenarios).map(name => [
			name,
			{
				warm: true,
				phase: name.endsWith('.preview') ? 'preview' : 'apply',
				family: name.split('.')[0],
			},
		])),
		batchSpeedups: {
			20: STAGE3_ACCEPTED_BATCH_MILESTONE.batch20Speedup,
			64: STAGE3_ACCEPTED_BATCH_MILESTONE.batch64Speedup,
		},
		gates: { ok: true, failures: [] },
		collection: {
			mode: 'core',
			counts: { warmup: 3, warm: 30 },
			performanceGatesAuthoritative: true,
			production: { authoritativeForGates: true },
		},
		fileUpdateCharacterization: { ok: true, attempts: 100, successes: 100 },
		agentWorkflows: {
			'compact-create': { samples: 30 },
			update: { samples: 30 },
		},
		agentWorkflowSamples: {
			'compact-create': [{ runtimeCalls: 2 }],
			update: [{ runtimeCalls: 5 }],
		},
		humanOneLineWorkflows: {
			create: humanWorkflowSummary(100),
			update: humanWorkflowSummary(100),
		},
		humanOneLineSamples: {
			create: humanWorkflowSamples(4),
			update: humanWorkflowSamples(5),
		},
		stage2: {
			baselineGate: { ok: false, failures: ['file-update.apply:successes-do-not-match-attempts'] },
			comparison: { batchSpeedups: { baseline: { 20: 6, 64: 4 } } },
		},
	};
}

function humanWorkflowSummary(value) {
	return {
		attempts: 30,
		successes: 30,
		correctnessFailures: [],
		outerWallMs: metric(value),
		cliTotalMs: metric(value - 5),
		handlerMs: metric(value - 10),
		runtimeCalls: metric(4),
	};
}

function metric(value) {
	return { samples: 30, p50: value, p95: value, max: value };
}

function humanWorkflowSamples(runtimeCalls) {
	return Array.from({ length: 30 }, () => ({
		ok: true,
		runtimeCalls,
		applied: true,
		postflightVerified: true,
		finalVerified: true,
	}));
}

function candidateEvidence() {
	const value = evidence();
	value.humanOneLineWorkflows = {
		create: humanWorkflowSummary(80),
		update: humanWorkflowSummary(70),
	};
	value.humanOneLineSamples = {
		create: humanWorkflowSamples(3),
		update: humanWorkflowSamples(3),
	};
	return value;
}

function jsonlSession(overrides = {}) {
	return {
		status: 'collected',
		warmReads: {
			attempts: 100,
			successes: 100,
			durationMs: { p50: 10, p95: 20, max: 25 },
		},
		throughput: {
			attempts: 100,
			successes: 100,
			wallMs: 500,
			requestsPerSecond: 100,
		},
		leakCharacterization: { attempts: 1000, successes: 1000, rssDeltaBytes: 0 },
		runtimeDispatches: { count: 1203, expected: 1203 },
		...overrides,
	};
}

test('seals the accepted Stage 2 gain without admitting its whole baseline', () => {
	const milestone = buildAcceptedStage2BatchMilestone(evidence());
	assert.equal(milestone.scope.frozenBaselineWholeSuiteAdmissible, false);
	assert.equal(milestone.accepted.batchSpeedups[20], STAGE3_ACCEPTED_BATCH_MILESTONE.batch20Speedup);
	assert.equal(milestone.accepted.retentionFloors[64], 21.264);
});

test('admits performance-only baseline failures but rejects incomplete correctness', () => {
	const value = evidence();
	assert.equal(assertAdmissibleStage3Baseline(value), value);
	assert.equal(
		assertAdmissibleStage3Baseline({
			...value,
			gates: { ok: false, failures: ['update.preview:preview-handler-p95-exceeded'] },
		}).gates.ok,
		false,
	);
	assert.throws(
		() => assertAdmissibleStage3Baseline({
			...value,
			scenarios: {
				...value.scenarios,
				'update.preview': {
					...value.scenarios['update.preview'],
					successes: 29,
				},
			},
		}),
		/correctness or timing evidence is incomplete/u,
	);
	assert.throws(
		() => assertAdmissibleStage3Baseline({
			...value,
			gates: { ok: false, failures: ['unsupported-safety-failure'] },
		}),
		/unsupported gate failures/u,
	);
});

test('keeps JSONL and accepted batch retention as hard Stage 3 gates', () => {
	const baseline = evidence();
	const candidate = candidateEvidence();
	candidate.batchSpeedups = { 20: 11, 64: 21 };
	const result = evaluateStage3Candidate({
		baseline,
		candidate,
		jsonlSession: { status: 'blocked', reason: 'capability-unavailable' },
	});
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes('batch-20:accepted-milestone-retention-not-met'));
	assert.ok(result.failures.includes('batch-64:accepted-milestone-retention-not-met'));
	assert.ok(result.failures.includes('jsonl-session:capability-unavailable'));
});

test('requires one Runtime dispatch per JSONL request', () => {
	const value = evidence();
	const result = evaluateStage3Candidate({
		baseline: value,
		candidate: candidateEvidence(),
		jsonlSession: {
			...jsonlSession(),
			runtimeDispatches: { count: 1202, expected: 1203 },
		},
	});
	assert.ok(result.failures.includes('jsonl-session:runtime-dispatch-count-mismatch'));
});

test('rejects JSONL RSS growth at or above 20 MiB', () => {
	const result = evaluateStage3Candidate({
		baseline: evidence(),
		candidate: candidateEvidence(),
		jsonlSession: jsonlSession({
			leakCharacterization: {
				attempts: 1000,
				successes: 1000,
				rssDeltaBytes: 20 * 1024 * 1024,
			},
		}),
	});
	assert.ok(result.failures.includes('jsonl-session:rss-growth-not-below-20mib'));
});

test('compares JSONL throughput against subprocess warm task-get and absolute latency gates', () => {
	const value = evidence();
	const session = jsonlSession();
	assert.equal(assertAdmissibleStage3JsonlSession(session), session);
	const result = evaluateStage3Candidate({
		baseline: value,
		candidate: candidateEvidence(),
		jsonlSession: {
			...session,
			warmReads: {
				...session.warmReads,
				durationMs: { p50: 30, p95: 45, max: 50 },
			},
			throughput: { ...session.throughput, requestsPerSecond: 99 },
		},
	});
	assert.ok(result.failures.includes('jsonl-session:warm-read-p50-not-below-30ms'));
	assert.ok(result.failures.includes('jsonl-session:warm-read-p95-not-below-45ms'));
	assert.ok(result.failures.includes('jsonl-session:throughput-less-than-2x-subprocess'));
});

test('keeps full collection and all-attempt File Task correctness as candidate hard gates', () => {
	const baseline = evidence();
	const candidate = candidateEvidence();
	candidate.collection = { ...candidate.collection, mode: 'smoke' };
	candidate.fileUpdateCharacterization = { ok: false, attempts: 100, successes: 99 };
	const result = evaluateStage3Candidate({
		baseline,
		candidate,
		jsonlSession: jsonlSession(),
	});
	assert.ok(result.failures.includes('candidate:full-authoritative-collection-required'));
	assert.ok(result.failures.includes('candidate:file-update-characterization-all-attempts-not-met'));
});

test('exposes direct human one-line create/update timing and dispatch evidence', () => {
	const compact = compactWorkflowEvidence(evidence());
	assert.equal(compact.create.warmupSamples, 3);
	assert.equal(compact.update.measuredSamples, 30);
	assert.equal(compact.create.samples[0].runtimeCalls, 4);
});

test('requires exact candidate dispatch and human one-line improvement floors', () => {
	const candidate = candidateEvidence();
	candidate.humanOneLineSamples.create[0].runtimeCalls = 4;
	candidate.humanOneLineWorkflows.update.outerWallMs = metric(81);
	const result = evaluateStage3Candidate({
		baseline: evidence(),
		candidate,
		jsonlSession: jsonlSession(),
	});
	assert.ok(result.failures.includes('human-create:runtime-dispatches-not-exactly-3'));
	assert.ok(result.failures.includes('human-update:outer-wall-p50-improvement-below-23-percent'));
	assert.ok(result.failures.includes('human-update:outer-wall-p95-improvement-below-20-percent'));
});

test('keeps the user-accepted Stage 3 deviations narrowly bounded', () => {
	const baseline = evidence();
	const accepted = candidateEvidence();
	accepted.scenarios['batch-create-1.apply'].totalMs.p95 = 11.7;
	let result = evaluateStage3Candidate({
		baseline,
		candidate: accepted,
		jsonlSession: jsonlSession(),
	});
	assert.equal(
		result.failures.includes('relative:batch-create-1.apply:total-p95-regressed'),
		false,
	);
	const rejected = candidateEvidence();
	rejected.scenarios['batch-create-1.apply'].totalMs.p95 = 11.9;
	result = evaluateStage3Candidate({
		baseline,
		candidate: rejected,
		jsonlSession: jsonlSession(),
	});
	assert.ok(result.failures.includes('relative:batch-create-1.apply:total-p95-regressed'));
});

test('Stage 3 live and JSONL collectors stay pinned to the guarded runner contracts', () => {
	const live = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage3-live.mjs', import.meta.url)),
		'utf8',
	);
	const session = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage3-session.mjs', import.meta.url)),
		'utf8',
	);
	assert.match(live, /cli-speed-stage1-live\.mjs/u);
	assert.match(live, /cli-speed-stage3\.json/u);
	assert.match(live, /stage3-baseline/u);
	assert.match(live, /OPERON_CLI_SPEED_STAGE3_PRECHANGE_DIR/u);
	assert.doesNotMatch(live, /baselineJsonlSession/u);
	assert.match(live, /reusedAsComparisonBaseline: true/u);
	assert.match(session, /\[cliArtifact, 'session', '--jsonl'\]/u);
	assert.match(session, /CLI_SPEED_STAGE1_VAULT/u);
	assert.match(session, /samplePlan\.throughput/u);
	assert.match(session, /samplePlan\.leak/u);
	assert.match(session, /rawSessionSamples\('warm'/u);
	assert.match(session, /rawSessionSamples\('throughput'/u);
	assert.match(session, /rawSessionSamples\('leak'/u);
	assert.match(session, /raw: responseAuditEvidence\(value\.response\)/u);
	assert.match(session, /exitCode/u);
	assert.match(session, /errorCode/u);
	assert.match(session, /vaultExpectedMatch/u);
	assert.match(session, /operonId/u);
	assert.match(session, /validationReasons/u);
	assert.doesNotMatch(session, /raw:\s*value\.response/u);
});

test('Stage 3 targeted close is checkpointed, digest-bound, and uses the light profile', () => {
	const live = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage3-live.mjs', import.meta.url)),
		'utf8',
	);
	const close = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage3-close.mjs', import.meta.url)),
		'utf8',
	);
	assert.match(live, /OPERON_CLI_SPEED_STAGE3_RESULT_PATH/u);
	assert.match(live, /suite: 'operon-cli-speed-stage3-target'/u);
	assert.match(live, /targeted-diagnostic-or-checkpoint-unit/u);
	assert.match(live, /targetFamilyFailures/u);
	assert.match(live, /sample-count-mismatch/u);
	assert.match(live, /fixture-digest:mismatch-or-missing/u);
	assert.match(close, /assertCliSpeedStage1Vault\(CLI_SPEED_STAGE1_VAULT/u);
	assert.match(close, /buildStage3CheckpointIdentity/u);
	assert.match(close, /fixtureGeneratorDigest/u);
	assert.match(close, /benchmarkHarnessPaths/u);
	assert.match(close, /sessionIdentity/u);
	assert.match(close, /assertSessionIdentity/u);
	assert.match(close, /acquireCloseLock/u);
	assert.match(close, /isProcessAlive/u);
	assert.match(close, /delete environment\[name\]/u);
	assert.match(close, /stage2MilestoneHash/u);
	assert.match(close, /baselineHash/u);
	assert.match(close, /warm: 20/u);
	assert.match(close, /fileUpdate: 75/u);
	assert.match(close, /sessionLeak: 300/u);
	assert.match(close, /recomputeBatchSpeedups/u);
	assert.match(close, /recomputeFileUpdateCharacterization/u);
	assert.match(close, /recomputeHumanWorkflows/u);
	assert.match(close, /recomputeJsonlSession/u);
	assert.match(close, /evaluateStage3Candidate/u);
	assert.doesNotMatch(close, /plan recover|plan apply|mutation apply/iu);
});
