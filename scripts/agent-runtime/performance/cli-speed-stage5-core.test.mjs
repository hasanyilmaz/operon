import assert from 'node:assert/strict';
import test from 'node:test';

import {
	checkpointIdentityMatches,
	evaluateStage5Evidence,
	summarize,
} from './cli-speed-stage5-core.mjs';

test('Stage 5 accepts complete evidence and queue/service decomposition', () => {
	const summary = (p50, p95 = p50, max = p95) => ({ samples: 20, p50, p95, max });
	const compactFamily = value => ({
		attempts: 20, successes: 20, uncertain: 0, unverified: 0,
		outerWallMs: summary(value), runtimeCalls: summary(3, 3, 3),
	});
	const cliSpanNames = [
		'command-resolution', 'config-load-decode', 'vault-resolution',
		'invocation-build', 'request-serialization', 'request-write', 'request-fsync',
		'request-link', 'request-verification', 'obsidian-spawn-to-close',
		'result-decode-admission', 'human-rendering', 'plan-persistence',
	];
	const probeFamily = {
		attempts: 5,
		linked: 5,
		cliLinkedSamples: 5,
		cliSubspans: cliSpanNames.flatMap(span => Array.from(
			{ length: 5 },
			(_, sample) => ({ span, sample }),
		)),
	};
	const evidence = {
		probe: {
			authoritativeForGates: false,
			families: {
				create: probeFamily,
				update: probeFamily,
			},
		},
		reads: {
			candidate: Object.fromEntries(['explicitVault', 'profile'].map(route => [
				route,
				{
					attempts: 20, successes: 20, traceLinked: 20,
					outerWallMs: summary(20), cliTotalMs: summary(15),
					serviceMs: summary(10), handlerMs: summary(5),
				},
			])),
		},
		compact: {
			order: ['baselineA', 'candidateA', 'candidateB', 'baselineB'],
			baseline: { create: compactFamily(100), update: compactFamily(100) },
			candidate: { create: compactFamily(90), update: compactFamily(100) },
		},
		session: {
			mixed: {
				attempts: 75, successes: 75, requestsPerSecond: 75, wallMs: 1000,
				queueWaitMs: summary(0), serviceMs: summary(20, 24),
			},
			soak: {
				attempts: 300, successes: 300, rssDeltaBytes: 0, fdDelta: 0,
				pendingRequestsAfter: 0,
			},
		},
		skillWorkflow: {
			candidate: { attempts: 20, successes: 20 },
			samePlanRef: 20,
			speedupP50: 1.5,
		},
	};
	assert.deepEqual(evaluateStage5Evidence(evidence), { ok: true, failures: [] });
});

test('Stage 5 rejects cumulative queue latency as service evidence', () => {
	const result = evaluateStage5Evidence({
		probe: {}, reads: {}, compact: {}, skillWorkflow: {},
		session: {
			mixed: {
				attempts: 75, successes: 75, requestsPerSecond: 80, wallMs: 1000,
				queueWaitMs: summarize([1]), serviceMs: summarize([30]),
			},
			soak: {},
		},
	});
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes('session:mixed:service-p95-over-25ms'));
});

test('checkpoint identity requires the exact 64-character digest', () => {
	const digest = 'a'.repeat(64);
	assert.equal(checkpointIdentityMatches({ digest }, { digest }), true);
	assert.equal(checkpointIdentityMatches({ digest }, { digest: 'b'.repeat(64) }), false);
	assert.equal(checkpointIdentityMatches({ digest: 'short' }, { digest: 'short' }), false);
});

test('summarize reports p50 p95 and max', () => {
	assert.deepEqual(summarize([3, 1, 2]), { samples: 3, p50: 2, p95: 3, max: 3 });
});

test('Stage 5 rejects missing evidence instead of treating partial results as complete', () => {
	const result = evaluateStage5Evidence({});
	assert.equal(result.ok, false);
	assert.ok(result.failures.length > 0);
	assert.ok(result.failures.some(failure => failure.startsWith('probe:')));
	assert.ok(result.failures.some(failure => failure.startsWith('reads:')));
	assert.ok(result.failures.some(failure => failure.startsWith('session:')));
});
