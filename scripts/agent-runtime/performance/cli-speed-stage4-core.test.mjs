import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	evaluateStage4Evidence,
	isRetryableCompactReloadFailure,
} from './cli-speed-stage4-core.mjs';

function passingEvidence() {
	const workflows = Object.fromEntries(['create', 'update'].map(name => [name, {
		attempts: 20,
		successes: 20,
		runtimeCalls: { p50: 3, max: 3 },
		outerWallMs: { p50: 70, p95: 70 },
		applyOuterWallMs: { samples: 20, p50: 70, p95: 70, max: 70 },
	}]));
	const scenarios = [];
	for (const writers of [3, 6]) {
		for (const mode of ['sequential', 'parallel']) {
			for (let repetition = 0; repetition < 5; repetition += 1) {
				scenarios.push({
					writers,
					mode,
					repetition,
					successes: writers,
					outcomes: Array.from({ length: writers }, () => ({
						terminalStatus: 'applied',
						postflightStatus: 'verified',
						finalVerified: true,
						recoveryAttempted: false,
						applyWallMs: 25,
						writerWallMs: 25,
					})),
				});
			}
		}
	}
	return {
		compact: {
			gate: { ok: true },
			order: ['baselineA', 'candidateA', 'candidateB', 'baselineB'],
			applyPhase: {
				authoritative: true,
				metric: 'applyOuterWallMs',
				sharedCliDigest: 'a'.repeat(64),
			},
			legs: Object.fromEntries(
				['baselineA', 'candidateA', 'candidateB', 'baselineB'].map(name => [name, {
					artifacts: { cli: { sha256: 'a'.repeat(64) } },
					humanOneLineSamples: Object.fromEntries(['create', 'update'].map(family => [
						family,
						Array.from({ length: 10 }, () => ({
							ok: true,
							applyOuterWallMs: name.startsWith('baseline') ? 100 : 70,
						})),
					])),
					humanOneLineWorkflows: Object.fromEntries(['create', 'update'].map(family => [
						family,
						{
							attempts: 10,
							successes: 10,
							outerWallMs: { p50: 80, p95: 80 },
							applyOuterWallMs: {
								p50: name.startsWith('baseline') ? 100 : 70,
								p95: name.startsWith('baseline') ? 100 : 70,
							},
						},
					])),
				}]),
			),
			baseline: {
				humanOneLineWorkflows: Object.fromEntries(['create', 'update'].map(name => [name, {
					attempts: 20,
					successes: 20,
					outerWallMs: { p50: 100, p95: 100 },
					applyOuterWallMs: { samples: 20, p50: 100, p95: 100, max: 100 },
				}])),
				scenarios: {
					'compact-create.apply': { outerWallMs: { p50: 100, p95: 100 } },
					'update.apply': { outerWallMs: { p50: 100, p95: 100 } },
				},
			},
			candidate: {
				humanOneLineWorkflows: workflows,
				scenarios: {
					'compact-create.apply': { outerWallMs: { p50: 85, p95: 85 } },
					'update.apply': { outerWallMs: { p50: 85, p95: 85 } },
				},
			},
		},
		tail: { status: 'collected', samples: 75, totalMs: { p50: 15, p95: 20, max: 25 } },
		tailBaseline: { totalMs: { p95: 20 } },
		concurrency: { status: 'collected', scenarios },
		jsonl: {
			status: 'collected',
			warmReads: { attempts: 75, successes: 75 },
			throughput: { attempts: 75, successes: 75 },
			leakCharacterization: {
				attempts: 300,
				successes: 300,
				rssDeltaBytes: 1024,
				fdDelta: 0,
				pendingRequestsAfter: 0,
			},
		},
	};
}

test('accepts the standard 20/75/300 Stage 4 profile', () => {
	assert.deepEqual(evaluateStage4Evidence(passingEvidence()), { ok: true, failures: [] });
});

test('rejects p99 in the standard tail profile', () => {
	const evidence = passingEvidence();
	evidence.tail.totalMs.p99 = 25;
	assert.equal(evaluateStage4Evidence(evidence).ok, false);
});

test('requires finite standard tail percentiles and max', () => {
	const evidence = passingEvidence();
	evidence.tail.totalMs = {};
	const result = evaluateStage4Evidence(evidence);
	assert.ok(result.failures.includes('tail:candidate-p50-required'));
	assert.ok(result.failures.includes('tail:candidate-p95-required'));
	assert.ok(result.failures.includes('tail:candidate-max-required'));
});

test('binds apply evidence to one shared CLI and leg-derived merged summaries', () => {
	const digestMismatch = passingEvidence();
	digestMismatch.compact.legs.candidateB.artifacts.cli.sha256 = 'b'.repeat(64);
	assert.ok(evaluateStage4Evidence(digestMismatch).failures.includes(
		'compact:shared-cli-digest-mismatch',
	));

	const summaryMismatch = passingEvidence();
	summaryMismatch.compact.candidate.humanOneLineWorkflows.create.applyOuterWallMs.p50 = 69;
	assert.ok(evaluateStage4Evidence(summaryMismatch).failures.includes(
		'compact:candidate:create:merged-apply-summary-mismatch',
	));
});

test('requires every baseline and candidate ABBA leg to retain ten finite successful samples', () => {
	const missing = passingEvidence();
	missing.compact.legs.baselineA.humanOneLineSamples.create.pop();
	missing.compact.legs.baselineA.humanOneLineWorkflows.create.attempts = 9;
	missing.compact.legs.baselineA.humanOneLineWorkflows.create.successes = 9;
	missing.compact.baseline.humanOneLineWorkflows.create.attempts = 19;
	missing.compact.baseline.humanOneLineWorkflows.create.successes = 19;
	const missingResult = evaluateStage4Evidence(missing);
	assert.ok(missingResult.failures.includes('compact:baselineA:create:10-of-10-required'));
	assert.ok(missingResult.failures.includes(
		'compact:create:baseline-and-candidate-20-of-20-required',
	));

	const nonFinite = passingEvidence();
	nonFinite.compact.legs.baselineB.humanOneLineSamples.update[0].applyOuterWallMs = null;
	assert.ok(evaluateStage4Evidence(nonFinite).failures.includes(
		'compact:baselineB:update:10-of-10-required',
	));
});

test('requires one apply family to improve apply-dispatch outer p50 and p95 by ten percent', () => {
	const evidence = passingEvidence();
	for (const workflow of Object.values(evidence.compact.candidate.humanOneLineWorkflows)) {
		workflow.applyOuterWallMs = { p50: 91, p95: 91 };
	}
	const result = evaluateStage4Evidence(evidence);
	assert.ok(result.failures.includes(
		'compact:apply-family-p50-and-p95-improvement-below-10-percent',
	));
});

test('compact-only close evaluates compact gates without requiring unchanged Stage 4 units', () => {
	const evidence = passingEvidence();
	assert.deepEqual(evaluateStage4Evidence({
		compact: evidence.compact,
		compactOnly: true,
	}), { ok: true, failures: [] });
});

test('ten-sample ABBA leg stability gates p50 but treats p95 as merged evidence', () => {
	const evidence = passingEvidence();
	evidence.compact.legs.candidateB.humanOneLineWorkflows.create.applyOuterWallMs.p95 = 200;
	assert.equal(evaluateStage4Evidence(evidence).ok, true);
	evidence.compact.legs.candidateB.humanOneLineWorkflows.create.applyOuterWallMs.p50 = 90;
	assert.ok(evaluateStage4Evidence(evidence).failures.includes(
		'compact:create:candidate-leg-p50-drift-over-15-percent',
	));
});

test('requires verified, unrecovered concurrency outcomes below five seconds', () => {
	const evidence = passingEvidence();
	evidence.concurrency.scenarios[0].outcomes[0].recoveryAttempted = true;
	evidence.concurrency.scenarios[0].outcomes[0].writerWallMs = 5_000;
	const result = evaluateStage4Evidence(evidence);
	assert.equal(result.ok, false);
	assert.ok(result.failures.includes('concurrency:3-sequential:unverified-or-recovered'));
	assert.ok(result.failures.includes('concurrency:3-sequential:writer-over-5s'));
});

test('does not hide stale concurrency contention behind a fresh preview', () => {
	const evidence = passingEvidence();
	evidence.concurrency.scenarios[0].outcomes[0].freshPreviewCount = 1;
	const result = evaluateStage4Evidence(evidence);
	assert.ok(result.failures.includes('concurrency:3-sequential:stale-contention-refresh'));
});

test('requires one terminal outcome per declared writer', () => {
	const evidence = passingEvidence();
	evidence.concurrency.scenarios[0].outcomes.pop();
	const result = evaluateStage4Evidence(evidence);
	assert.ok(result.failures.includes('concurrency:3-sequential:outcome-count'));
});

test('requires zero session resource and request-state leaks', () => {
	const evidence = passingEvidence();
	evidence.jsonl.leakCharacterization.fdDelta = 1;
	evidence.jsonl.leakCharacterization.pendingRequestsAfter = 1;
	const result = evaluateStage4Evidence(evidence);
	assert.ok(result.failures.includes('jsonl:fd-leak'));
	assert.ok(result.failures.includes('jsonl:request-state-leak'));
});

test('reload retry requires zero measured mutations even when readiness stderr matches', () => {
	const stderr = 'Operon Runtime did not become ready/verified/settled after app reload.';
	assert.equal(isRetryableCompactReloadFailure({
		status: 1,
		stderr,
		evidence: { measuredMutationCount: 0 },
	}), true);
	assert.equal(isRetryableCompactReloadFailure({
		status: 1,
		stderr,
		evidence: { measuredMutationCount: 1 },
	}), false);
});

test('Stage 4 runner is checkpointed, vault-pinned, and separates production from probe', () => {
	const source = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage4-live.mjs', import.meta.url)),
		'utf8',
	);
	assert.match(source, /CLI_SPEED_STAGE1_VAULT/u);
	assert.match(source, /stage4-close[\s\S]*?checkpoint\.json/u);
	assert.match(source, /cli-speed-stage4\.json/u);
	assert.match(source, /cli-speed-stage4-8-compact\.json/u);
	assert.match(source, /compactOnly \? 'cli-speed-stage4-8-compact\.json' : 'cli-speed-stage4\.json'/u);
	assert.match(source, /isRetryablePreHandlerShardFailure/u);
	assert.match(source, /isRetryableCompactReloadFailure\(runResult\)/u);
	assert.match(source, /stage4-baseline/u);
	assert.match(source, /expectedBaselineDigests/u);
	assert.match(
		source,
		/function runCompactAbbaUnit[\s\S]*?finally \{[\s\S]*?installBundleArtifacts\(candidateArtifacts\);[\s\S]*?restoreCandidateLiveVault\(candidateArtifacts\.cli\)/u,
	);
	assert.match(source, /compact:\$\{name\}:artifact-class-mismatch/u);
	assert.match(source, /compact:abba-fixture-digest-mismatch/u);
	assert.match(source, /expectedArtifacts/u);
	assert.match(source, /registerCandidateRestoreGuards\(candidateArtifacts\)/u);
	assert.match(source, /process\.once\('exit', restore\)/u);
	assert.match(source, /for \(const signal of \['SIGINT', 'SIGTERM'\]\)/u);
	assert.match(source, /candidate-restore-required\.json/u);
	assert.match(source, /candidateLiveRestoreVerified = true/u);
	assert.match(
		source,
		/candidate-restore-health\.json'\), true\)/u,
	);
	assert.match(
		source,
		/candidate-restore-capabilities\.json'\), true\)/u,
	);
	assert.match(source, /OPERON_CLI_SPEED_TAIL_SAMPLES: fullTail \? '300' : '75'/u);
	assert.match(source, /OPERON_CLI_SPEED_CONCURRENCY_REPETITIONS: '5'/u);
	assert.match(source, /OPERON_CLI_SPEED_SESSION_LEAK_SAMPLES: '300'/u);
	assert.match(source, /identitiesDifferOnlyByTailProfile/u);
	assert.match(source, /delete value\.units\['tail-concurrency'\]/u);
	assert.match(source, /production: \{/u);
	assert.match(source, /probe: \{[\s\S]*?authoritativeForGates: false/u);
});
