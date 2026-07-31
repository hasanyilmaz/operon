import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	analyzeStage51OverheadPairs,
	checkpointIdentityMatches,
	evaluateStage51Evidence,
	STAGE51_PROFILE,
	summarize,
} from './cli-speed-stage51-core.mjs';

const metric = (p50, p95 = p50, max = p95) => ({ samples: 75, p50, p95, max });

function overheadPairs(deltas = Array.from({ length: 20 }, (_value, index) => (
	(index % 5 - 2) / 10
))) {
	return deltas.map((deltaMs, index) => ({
		index,
		order: index % 2 === 0 ? 'AB' : 'BA',
		family: ['health', 'task.get', 'context.build'][index % 3],
		timedMs: 10 + deltaMs,
		controlMs: 10,
		deltaMs,
		percent: deltaMs * 10,
	}));
}

function passingEvidence() {
	const rawOverheadPairs = overheadPairs();
	return {
		parity: {
			families: Object.fromEntries(['health', 'task.get', 'context.build'].map(name => [
				name, { attempts: 5, successes: 5, semanticMatches: 5 },
			])),
		},
		timed: {
			attempts: 75, successes: 75, linked: 75, unique: 75,
			residualWithinLimit: 75, nonNegativeComponents: 75,
			overflow: 0, duplicates: 0, missing: 0,
			clockOffsetMs: 1, serviceMs: metric(10, 20),
		},
		throughput: {
			baseline: { attempts: 75, successes: 75, requestsPerSecond: 60 },
			candidate: { attempts: 75, successes: 75, requestsPerSecond: 75 },
			speedup: 1.25,
			outerImprovementPercent: { p50: 25, p95: 20 },
		},
		overhead: {
			method: 'paired-same-binary-alternating-ab-ba',
			executableDigestBefore: 'a'.repeat(64),
			executableDigestAfter: 'a'.repeat(64),
			timed: { attempts: 20, successes: 20 },
			untimed: { attempts: 20, successes: 20 },
			paired: {
				attempts: 20, semanticMatches: 20,
				measuredTimingRecords: 20, warmupTimingRecords: 2,
				totalTimingRecords: 22, uniqueTimingRecords: 22,
				timingOverflow: 0, persistentMeasured: 20, raw: rawOverheadPairs,
			},
			percent: { p50: 1, p95: 1.5 },
			absoluteMs: { p50: 0.2, p95: 0.4 },
			diagnostic: analyzeStage51OverheadPairs(rawOverheadPairs),
		},
		soak: {
			attempts: 300, successes: 300, rssDeltaBytes: 0,
			fdDelta: 0, socketDelta: 0, listenerDelta: 0, pendingAfter: 0,
		},
		mutationIsolation: {
			families: Object.fromEntries(['compact-create', 'exact-update'].map(name => [
				name, {
					attempts: 5, successes: 5, requestFileDispatches: 5,
					persistentDispatches: 0, verifiedPostflight: 5,
					observedRuntimeDispatches: 15, expectedRuntimeDispatches: 15,
					observedMutationDispatches: 10,
				},
			])),
		},
		negativeTests: { status: 'passed', runtimeMutationCalls: 0, planStoreCalls: 0 },
	};
}

test('Stage 5.1 accepts complete 5/75/300 evidence', () => {
	assert.deepEqual(evaluateStage51Evidence(passingEvidence()), { ok: true, failures: [] });
	assert.deepEqual(STAGE51_PROFILE, {
		parityPerFamily: 5, timed: 75, throughput: 75, overhead: 20,
		soak: 300, mutationIsolationPerFamily: 5,
	});
});

test('Stage 5.1 fails closed for absent timing, mutation isolation, and negative evidence', () => {
	const evidence = passingEvidence();
	delete evidence.timed.serviceMs;
	evidence.mutationIsolation.families['compact-create'].persistentDispatches = 1;
	evidence.negativeTests.runtimeMutationCalls = 1;
	const result = evaluateStage51Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes('timed:service-p95-over-25ms'));
	assert.ok(result.failures.includes(
		'mutation-isolation:compact-create:5-of-5-request-file-only-required',
	));
	assert.ok(result.failures.includes('negative-tests:runtime-mutation-calls-must-be-zero'));
});

test('Stage 5.1 checkpoint identity requires an exact digest', () => {
	const digest = 'a'.repeat(64);
	assert.equal(checkpointIdentityMatches({ digest }, { digest }), true);
	assert.equal(checkpointIdentityMatches({ digest }, { digest: 'b'.repeat(64) }), false);
	assert.equal(checkpointIdentityMatches({ digest: 'short' }, { digest: 'short' }), false);
});

test('Stage 5.1 summary reports p50 p95 and max', () => {
	assert.deepEqual(summarize([3, 1, 2]), { samples: 3, p50: 2, p95: 3, max: 3 });
});

test('paired overhead Hampel diagnostic excludes at most two deterministic two-sided spikes', () => {
	const pairs = overheadPairs([
		-10, -0.2, -0.1, 0, 0.1, 0.2, -0.2, -0.1, 0, 0.1,
		0.2, -0.2, -0.1, 0, 0.1, 0.2, -0.2, -0.1, 0, 10,
	]);
	const result = analyzeStage51OverheadPairs(pairs);
	assert.equal(result.status, 'filtered');
	assert.equal(result.inputPairs, 20);
	assert.equal(result.retainedPairs, 18);
	assert.equal(result.excludedPairs, 2);
	assert.deepEqual(result.excluded.map(value => value.index), [0, 19]);
	assert.equal(result.rawPreserved, true);
	assert.equal(result.balanceEligible, true);
});

test('paired overhead diagnostic does not hide three or more sustained spikes', () => {
	const pairs = overheadPairs([
		-0.2, -0.1, 0, 0.1, 0.2, -0.2, -0.1, 0, 0.1, 0.2,
		-0.2, -0.1, 0, 0.1, 0.2, -0.2, -0.1, 8, 10, 12,
	]);
	const result = analyzeStage51OverheadPairs(pairs);
	assert.equal(result.status, 'unstable');
	assert.equal(result.excludedPairs, 0);
	assert.equal(result.retainedPairs, 20);
	assert.deepEqual(result.excluded, []);
});

test('paired overhead diagnostic handles zero MAD without silently accepting a spike', () => {
	const result = analyzeStage51OverheadPairs(overheadPairs([
		0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10,
	]));
	assert.equal(result.status, 'filtered');
	assert.equal(result.excludedPairs, 1);
	assert.equal(result.excluded[0].robustZ, Number.POSITIVE_INFINITY);
	assert.equal(result.retainedPairs, 19);
});

test('overhead latency remains diagnostic while malformed pair evidence fails closed', () => {
	const evidence = passingEvidence();
	evidence.overhead.absoluteMs = { p50: 50, p95: 100 };
	evidence.overhead.percent = { p50: 500, p95: 1000 };
	assert.equal(evaluateStage51Evidence(evidence).ok, true);

	evidence.overhead.paired.raw[0].order = 'BA';
	const malformed = evaluateStage51Evidence(evidence);
	assert.equal(malformed.ok, false);
	assert.ok(malformed.failures.includes('overhead:paired-raw-and-outlier-diagnostic-required'));
});

test('overhead hard gate recomputes pair arithmetic and exact excluded identities', () => {
	const arithmetic = passingEvidence();
	arithmetic.overhead.paired.raw[0].deltaMs += 1;
	assert.ok(evaluateStage51Evidence(arithmetic).failures.includes(
		'overhead:paired-raw-and-outlier-diagnostic-required',
	));

	const excluded = passingEvidence();
	excluded.overhead.paired.raw = overheadPairs([
		-10, -0.2, -0.1, 0, 0.1, 0.2, -0.2, -0.1, 0, 0.1,
		0.2, -0.2, -0.1, 0, 0.1, 0.2, -0.2, -0.1, 0, 10,
	]);
	excluded.overhead.diagnostic = analyzeStage51OverheadPairs(
		excluded.overhead.paired.raw,
	);
	excluded.overhead.diagnostic.excluded[0] = {
		...excluded.overhead.diagnostic.excluded[0],
		index: 3,
	};
	assert.ok(evaluateStage51Evidence(excluded).failures.includes(
		'overhead:paired-raw-and-outlier-diagnostic-required',
	));
});

test('Stage 5.1 runner is vault-pinned, checkpointed, and emits the required result', () => {
	const directory = path.dirname(fileURLToPath(import.meta.url));
	const source = readFileSync(path.join(directory, 'cli-speed-stage51-live.mjs'), 'utf8');
	const sessionSource = readFileSync(
		path.join(directory, 'cli-speed-stage51-session.mjs'),
		'utf8',
	);
	assert.match(source, /CLI_SPEED_STAGE1_VAULT/u);
	assert.match(source, /assertCliSpeedStage1Vault/u);
	assert.match(source, /stage51-close/u);
	assert.match(source, /cli-speed-stage51\.json/u);
	assert.match(source, /OPERON_CLI_STAGE51_TIMING_FD/u);
	assert.match(source, /unitDependencyDigest/u);
	assert.match(source, /STAGE51_REQUIRED_UNITS/u);
	assert.match(source, /byteIdenticalPromotion/u);
	assert.match(source, /digest-bound-short-smoke/u);
	assert.match(source, /evaluatePromotionSmoke/u);
	assert.match(sessionSource, /promotion-smoke/u);
	assert.doesNotMatch(source, /process\.argv\.slice\(2\).*vault/u);
	assert.match(sessionSource, /processUnixFdCount/u);
	assert.match(sessionSource, /processUnixPathRefCount/u);
	assert.match(sessionSource, /OPERON_CLI_BENCHMARK_TRACE_PATH/u);
	assert.match(sessionSource, /observedRuntimeDispatches/u);
	assert.doesNotMatch(sessionSource, /socketDelta:\s*0/u);
	assert.doesNotMatch(sessionSource, /listenerDelta:\s*0/u);
	const mutationIsolationSource = sessionSource.slice(
		sessionSource.indexOf('async function collectMutationIsolation'),
		sessionSource.indexOf('function collectNegativeTests'),
	);
	assert.match(mutationIsolationSource, /timing:\s*false/u);
	assert.doesNotMatch(mutationIsolationSource, /timing:\s*true/u);
});
