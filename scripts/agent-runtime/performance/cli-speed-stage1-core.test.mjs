import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	aggregateSamples,
	assertCliSpeedStage1Vault,
	buildStage1Evidence,
	classifyApplyCorrectness,
	CLI_SPEED_STAGE1_RESULT_PATH,
	CLI_SPEED_STAGE1_VAULT,
	evaluateStage1Gates,
	percentile,
	summarizeDurations,
} from './cli-speed-stage1-core.mjs';
import {
	assertAdmissibleStage2Baseline,
	assertFreshStage2CollectorEvidence,
	clearStage2CollectorResult,
} from './cli-speed-stage2-core.mjs';

const directoryMetadata = {
	isDirectory: () => true,
	isSymbolicLink: () => false,
};

function guardDependencies(overrides = {}) {
	return {
		lstatSync: () => directoryMetadata,
		realpathSync: value => value,
		...overrides,
	};
}

function validMutationSample(overrides = {}) {
	return {
		sampleId: 'sample-1',
		scenario: 'update.apply',
		kind: 'mutation',
		handlerMs: 40,
		totalMs: 75,
		correctness: {
			preview: { ok: true, exactTarget: true, expectedEffects: true },
			apply: {
				planRef: 'plan:one',
				planRefUsed: 'plan:one',
				status: 'applied',
				mutationMayHaveApplied: false,
				postflightStatus: 'verified',
			},
			finalState: {
				verified: true,
				description: true,
				status: true,
				locator: true,
				revision: true,
			},
			unrelatedFixtureUnchanged: true,
			settingsFingerprintUnchanged: true,
		},
		...overrides,
	};
}

test('vault guard accepts only the exact real non-symlink test vault', () => {
	assert.equal(
		assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies()),
		CLI_SPEED_STAGE1_VAULT,
	);
	for (const rejected of [
		'/private/tmp/other-vault',
		'/private/tmp/cli-test-vault/..',
		'/tmp/cli-test-vault',
		'/Users/example/cli-test-vault',
	]) {
		assert.throws(
			() => assertCliSpeedStage1Vault(rejected, guardDependencies()),
			/Refusing vault|exact guarded path/u,
		);
	}
});

test('vault guard rejects a symlink, non-directory, and mismatched realpath', () => {
	assert.throws(() => assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies({
		lstatSync: () => ({ ...directoryMetadata, isSymbolicLink: () => true }),
	})), /symbolic link/u);
	assert.throws(() => assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies({
		lstatSync: () => ({ ...directoryMetadata, isDirectory: () => false }),
	})), /must be a directory/u);
	assert.throws(() => assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, guardDependencies({
		realpathSync: value => value === CLI_SPEED_STAGE1_VAULT ? '/private/tmp/elsewhere' : value,
	})), /realpath does not match/u);
});

test('nearest-rank summaries expose p50, p95, and max', () => {
	assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5);
	assert.deepEqual(summarizeDurations([1, 2, 3, 4, 5]), {
		p50: 3,
		p95: 5,
		max: 5,
	});
});

test('apply correctness requires exact preview, unchanged plan, verified postflight and final state', () => {
	assert.deepEqual(classifyApplyCorrectness(validMutationSample()), { ok: true, reasons: [] });
	const unsafe = validMutationSample();
	unsafe.correctness.apply.planRefUsed = 'plan:other';
	unsafe.correctness.apply.mutationMayHaveApplied = true;
	unsafe.correctness.apply.postflightStatus = 'partial';
	unsafe.correctness.finalState.revision = false;
	const classification = classifyApplyCorrectness(unsafe);
	assert.equal(classification.ok, false);
	assert.deepEqual(classification.reasons, [
		'stored-plan-ref-not-used-unchanged',
		'mutation-may-have-applied',
		'postflight-not-verified',
		'final-revision-not-verified',
	]);
});

test('already-applied is accepted only for an explicit idempotency sample', () => {
	const retry = validMutationSample();
	retry.correctness.idempotencyExpected = true;
	retry.correctness.apply.status = 'already-applied';
	retry.correctness.apply.postflightStatus = 'receipt-replay';
	assert.equal(classifyApplyCorrectness(retry).ok, true);
	const ordinary = validMutationSample();
	ordinary.correctness.apply.status = 'already-applied';
	assert.equal(classifyApplyCorrectness(ordinary).ok, false);
});

test('failed correctness samples are excluded from timings and fail success count', () => {
	const failed = validMutationSample({ sampleId: 'failed', handlerMs: 1, totalMs: 1 });
	failed.correctness.apply.status = 'outcome-unknown';
	const scenarios = aggregateSamples([
		validMutationSample({ sampleId: 'passed', handlerMs: 40, totalMs: 75 }),
		failed,
	]);
	assert.equal(scenarios['update.apply'].attempts, 2);
	assert.equal(scenarios['update.apply'].successes, 1);
	assert.equal(scenarios['update.apply'].handlerSamples, 1);
	assert.equal(scenarios['update.apply'].totalSamples, 1);
	assert.deepEqual(scenarios['update.apply'].handlerMs, { p50: 40, p95: 40, max: 40 });
	assert.match(
		scenarios['update.apply'].correctnessFailures[0].reasons.join(','),
		/outcome-unknown/u,
	);
});

test('read retry metadata preserves cumulative attempts in scenario evidence', () => {
	const scenarios = aggregateSamples([{
		scenario: 'catalog.cold',
		sampleId: 'catalog-retry',
		kind: 'read',
		handlerMs: 5,
		totalMs: 125,
		outerWallMs: 125,
		cliTotalMs: 40,
		retryCount: 1,
		correctness: { verified: true, liveVerified: true },
	}]);
	assert.equal(scenarios['catalog.cold'].retriedSamples, 1);
	assert.equal(scenarios['catalog.cold'].retryAttempts, 1);
	assert.equal(scenarios['catalog.cold'].totalMs.p50, 125);
});

test('absolute, batch, and baseline regression gates fail closed', () => {
	const evidence = {
		environment: {
			host: 'fixture',
			platform: 'darwin',
			osRelease: 'fixture',
			architecture: 'arm64',
			node: 'v26',
			pluginVersion: '2.6.0',
			cliVersion: '0.1.0',
			obsidianVersion: '1.13.4',
		},
		fixtureDigest: 'fixture-digest',
		scenarios: {
			'update.preview': {
				attempts: 30,
				successes: 30,
				handlerSamples: 30,
				totalSamples: 30,
				handlerMs: { p50: 50, p95: 99, max: 99 },
				totalMs: { p50: 100, p95: 120, max: 130 },
			},
		},
		scenarioMetadata: {
			'update.preview': { warm: true, phase: 'preview', family: 'update' },
		},
		batchSpeedups: { 20: 10, 64: 20 },
	};
	assert.deepEqual(evaluateStage1Gates(evidence), { ok: true, failures: [] });
	const regressed = structuredClone(evidence);
	regressed.scenarios['update.preview'].totalMs.p50 = 111;
	regressed.scenarios['update.preview'].totalMs.p95 = 139;
	const result = evaluateStage1Gates(regressed, { baseline: evidence });
	assert.equal(result.ok, false);
	assert.deepEqual(result.failures, [
		'update.preview:total-p50-regressed',
		'update.preview:total-p95-regressed',
	]);
});

test('missing timing and incompatible baseline identity fail closed', () => {
	const sample = validMutationSample({ handlerMs: undefined, totalMs: undefined });
	const evidence = buildStage1Evidence({
		environment: { host: 'candidate' },
		artifacts: {},
		fixtureDigest: 'candidate-fixture',
		samples: [sample],
		scenarioMetadata: {
			'update.apply': { warm: true, phase: 'apply', family: 'update' },
		},
		batchSpeedups: { 20: 10, 64: 20 },
	});
	assert.match(evidence.gates.failures.join(','), /missing-handler-timings/u);
	const compared = evaluateStage1Gates(evidence, {
		baseline: {
			environment: { host: 'baseline' },
			fixtureDigest: 'baseline-fixture',
			scenarios: evidence.scenarios,
		},
	});
	assert.match(compared.failures.join(','), /baseline:environment-host-mismatch/u);
	assert.match(compared.failures.join(','), /baseline:fixture-digest-mismatch/u);
	const missingScenarioBaseline = structuredClone(evidence);
	missingScenarioBaseline.scenarios['query.warm'] = {
		attempts: 30,
		successes: 30,
	};
	const missingScenario = evaluateStage1Gates(evidence, {
		baseline: missingScenarioBaseline,
	});
	assert.match(
		missingScenario.failures.join(','),
		/baseline:query\.warm-missing-candidate-scenario/u,
	);
});

test('evidence uses the fixed result convention and keeps probe timings diagnostic', () => {
	assert.equal(
		CLI_SPEED_STAGE1_RESULT_PATH,
		'/private/tmp/operon-agent-runtime-results/cli-speed-stage1.json',
	);
	const evidence = buildStage1Evidence({
		environment: { machine: 'fixture' },
		artifacts: { production: 'sha256:one', probe: 'sha256:two' },
		fixtureDigest: 'sha256:fixture',
		samples: [validMutationSample()],
		scenarioMetadata: {
			'update.apply': { warm: true, phase: 'apply', family: 'update' },
		},
		batchSpeedups: { 20: 10, 64: 20 },
		probeStageTimings: { settlement: [1, 2, 3] },
	});
	assert.equal(evidence.vaultPath, CLI_SPEED_STAGE1_VAULT);
	assert.deepEqual(evidence.diagnostics.probeStageTimings, { settlement: [1, 2, 3] });
	assert.equal(evidence.gates.ok, true);
});

test('live collector is pinned to the disposable vault and always restores it', () => {
	const source = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage1-live.mjs', import.meta.url)),
		'utf8',
	);
	assert.match(source, /CLI_SPEED_STAGE1_VAULT/u);
	assert.match(source, /assertCliSpeedStage1Vault\(CLI_SPEED_STAGE1_VAULT/u);
	assert.match(source, /finally \{[\s\S]*?restoreProductionVault\(\);/u);
	assert.match(source, /AggregateError/u);
	assert.match(source, /cli-speed-stage1-smoke\.json/u);
	assert.doesNotMatch(source, /Stratejya_Next/u);
	assert.doesNotMatch(source, /process\.argv\[[^\]]+\].*vault/iu);
	for (const family of [
		'creation-context',
		'context-pack.warm',
		'compact-create',
		'typed-create-single',
		'file-update',
		'reminder',
		'timer',
		'relocate',
		'conversion',
		'delete',
	]) {
		assert.match(source, new RegExp(family, 'u'));
	}
	assert.match(source, /OPERON_CLI_BENCHMARK_TRACE_PATH/u);
	assert.match(source, /runtimeDispatchTracePath/u);
	assert.doesNotMatch(source, /runtimeDispatchesForCommand/u);
	assert.match(source, /runSimpleReadWithRetry\(command, configRoot\)/u);
	assert.match(source, /first\._wallMs \+ second\._wallMs/u);
	assert.match(source, /retryCount: readRetryCount\(envelope\)/u);
	assert.match(source, /agentWorkflows/u);
	assert.match(source, /runHumanOneLineCompactCreate/u);
	assert.match(source, /runHumanOneLineExactUpdate/u);
	assert.match(source, /humanOneLineWorkflows/u);
	assert.match(source, /postflightVerified/u);
	assert.match(source, /finalVerified/u);
	assert.match(source, /collectProbeDiagnostics\(selectedFamilies\)/u);
	assert.match(source, /collectTailCharacterization\(\)/u);
	assert.match(source, /collectConcurrencyCharacterization\(\)/u);
	assert.match(source, /\['plan', 'recover', writerResult\.preview\.client\.planRef\]/u);
	assert.match(source, /\['stale-source', 'stale-context'\]\.includes\(errorCode\)/u);
	assert.match(source, /freshPreviewCount: writerResult\.freshPreviewCount/u);
	assert.match(source, /writerWallMs: writerResult\.finishedAt - writerResult\.startedAt/u);
	assert.match(source, /p99: percentile\(totalMs, 0\.99\)/u);
});

test('live collector admits only exact composable Stage 3 closure families', () => {
	const source = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage1-live.mjs', import.meta.url)),
		'utf8',
	);
	for (const family of [
		'task-get-warm',
		'file-update-core',
		'file-update-characterization',
		'batch-1',
		'batch-20',
		'batch-64',
		'human-compact-create',
		'human-exact-update',
	]) {
		assert.match(source, new RegExp(`'${family}'`, 'u'));
	}
	assert.match(source, /OPERON_CLI_SPEED_FAMILIES/u);
	assert.match(source, /argument === '--family'/u);
	assert.match(source, /const requestedSet = new Set\(requested\)/u);
	assert.match(source, /\[\.\.\.TARGETED_FAMILY_ALLOWLIST\]\.filter/u);
	assert.match(source, /Unknown targeted CLI speed family/u);
	assert.match(source, /mode: targetedCollection \? 'targeted'/u);
	assert.match(source, /authoritativeForGates: !smoke && !targetedCollection/u);
	assert.match(source, /kind: 'targeted-correctness'/u);
	assert.match(
		source,
		/selectedFamilies === null[\s\S]*?\? liveOptions\.stage2[\s\S]*?: selectedFamilies\.has\('file-update-characterization'\)/u,
	);
});

test('targeted family resolver combines argv and env through the exact canonical allowlist', () => {
	const source = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage1-live.mjs', import.meta.url)),
		'utf8',
	);
	assert.ok(
		source.indexOf('const TARGETED_FAMILY_ALLOWLIST')
			< source.indexOf('const selectedFamilies = resolveSelectedFamilies'),
		'Targeted family allowlist must initialize before family resolution.',
	);
	const resolverSource = source.slice(source.indexOf('function resolveSelectedFamilies'));
	const allowlist = new Set([
		'task-get-warm',
		'file-update-core',
		'file-update-characterization',
		'batch-1',
		'batch-20',
		'batch-64',
		'human-compact-create',
		'human-exact-update',
	]);
	const makeResolver = environment => Function(
		'process',
		'TARGETED_FAMILY_ALLOWLIST',
		`${resolverSource}\nreturn resolveSelectedFamilies;`,
	)({ env: environment }, allowlist);
	assert.equal(makeResolver({})([]), null);
	assert.deepEqual(
		[...makeResolver({
			OPERON_CLI_SPEED_FAMILIES: 'batch-64, task-get-warm',
		})(['human-exact-update', 'batch-64'])],
		['task-get-warm', 'batch-64', 'human-exact-update'],
	);
	assert.throws(
		() => makeResolver({})(['batch-5']),
		/Unknown targeted CLI speed family/u,
	);
	assert.throws(
		() => makeResolver({ OPERON_CLI_SPEED_FAMILIES: 'batch-20,' })([]),
		/must not contain empty family names/u,
	);
});

test('targeted collector resets independent fixtures and keeps rich raw Runtime failures', () => {
	const source = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage1-live.mjs', import.meta.url)),
		'utf8',
	);
	assert.match(
		source,
		/for \(const family of mutationFamilies\) \{[\s\S]*?resetAndPrepareCoreFixtures/u,
	);
	assert.match(
		source,
		/for \(const humanFamily of \['human-compact-create', 'human-exact-update'\]\) \{[\s\S]*?resetAndPrepareCoreFixtures/u,
	);
	assert.match(
		source,
		/for \(const size of batchSizes\) \{[\s\S]*?resetAndPrepareCoreFixtures/u,
	);
	assert.match(
		source,
		/function collectFileUpdateCharacterization\(\) \{[\s\S]*?resetProductionVaultForFixturePreparation\(\)/u,
	);
	assert.match(
		source,
		/resetProductionVaultForFixturePreparation\(\);[\s\S]*?prepareCoreFixtures[\s\S]*?reloadAppAndWaitReady\(\)/u,
	);
	assert.match(source, /combinedFixtureDigest\([\s\S]*?fileUpdateCharacterization\.fixtureDigest/u);
	assert.match(source, /suite: 'operon-cli-speed-stage3-targeted'[\s\S]*?failure: serializeBenchmarkError/u);
	assert.match(source, /lastReadinessEvidence/u);
	for (const evidenceField of [
		'resultError',
		'groupResults',
		'readiness',
		'revisions',
		'reindexGeneration',
	]) {
		assert.match(source, new RegExp(evidenceField, 'u'));
	}
	assert.match(source, /runtimeEvidence: runtimeEnvelopeEvidence\(command\)/u);
	assert.match(source, /restoreProductionVault\(\)/u);
	assert.doesNotMatch(source, /retryMutation/iu);
});

test('Stage 2 comparison preserves frozen evidence and restores candidate artifacts', () => {
	const source = readFileSync(
		fileURLToPath(new URL('./cli-speed-stage2-live.mjs', import.meta.url)),
		'utf8',
	);
	assert.match(source, /stage2-baseline/u);
	assert.match(source, /cli-speed-stage2\.json/u);
	assert.match(source, /cli-speed-stage2-baseline-session\.json/u);
	assert.match(source, /--stage2/u);
	assert.match(source, /--compare/u);
	assert.match(source, /sameSession: true/u);
	assert.match(source, /finally \{[\s\S]*?installArtifacts\(candidateSnapshot\);/u);
	assert.doesNotMatch(source, /Stratejya_Next/u);
});

test('Stage 2 collector rejects stale or artifact-mismatched evidence', () => {
	let removed;
	clearStage2CollectorResult('/private/tmp/existing-stage2.json', {
		rmSync: (filePath, options) => {
			removed = { filePath, options };
		},
	});
	assert.deepEqual(removed, {
		filePath: '/private/tmp/existing-stage2.json',
		options: { force: true },
	});
	const evidence = {
		recordedAt: '2026-07-28T12:00:01.000Z',
		artifacts: {
			production: { sha256: 'production' },
			probe: { sha256: 'probe' },
			cli: { sha256: 'cli' },
		},
	};
	assert.equal(assertFreshStage2CollectorEvidence({
		evidence,
		startedAt: Date.parse('2026-07-28T12:00:00.000Z'),
		expectedProductionSha256: 'production',
		expectedProbeSha256: 'probe',
		expectedCliSha256: 'cli',
	}), evidence);
	assert.throws(() => assertFreshStage2CollectorEvidence({
		evidence,
		startedAt: Date.parse('2026-07-28T12:00:02.000Z'),
		expectedProductionSha256: 'production',
		expectedProbeSha256: 'probe',
		expectedCliSha256: 'cli',
	}), /predates/u);
	assert.throws(() => assertFreshStage2CollectorEvidence({
		evidence,
		startedAt: Date.parse('2026-07-28T12:00:00.000Z'),
		expectedProductionSha256: 'different',
		expectedProbeSha256: 'probe',
		expectedCliSha256: 'cli',
	}), /production artifact/u);
	assert.throws(() => assertFreshStage2CollectorEvidence({
		evidence,
		startedAt: Date.parse('2026-07-28T12:00:00.000Z'),
		expectedProductionSha256: 'production',
		expectedProbeSha256: 'different',
		expectedCliSha256: 'cli',
	}), /probe artifact/u);
});

test('Stage 2 baseline admits old absolute limits but rejects incomplete evidence', () => {
	const scenario = {
		attempts: 30,
		successes: 30,
		handlerSamples: 30,
		totalSamples: 30,
		handlerMs: { p50: 10, p95: 120, max: 130 },
		totalMs: { p50: 100, p95: 200, max: 6000 },
	};
	const baseline = {
		scenarios: { 'update.preview': scenario },
		gates: {
			ok: false,
			failures: [
				'update.preview:warm-total-max-exceeded',
				'update.preview:preview-handler-p95-exceeded',
				'batch-20:minimum-speedup-not-met',
			],
		},
	};
	assert.equal(assertAdmissibleStage2Baseline(baseline), baseline);
	assert.throws(() => assertAdmissibleStage2Baseline({
		...baseline,
		scenarios: {
			'update.preview': { ...scenario, successes: 29, handlerSamples: 29, totalSamples: 29 },
		},
	}), /correctness is incomplete/u);
	assert.throws(() => assertAdmissibleStage2Baseline({
		...baseline,
		scenarios: {
			'update.preview': { ...scenario, totalSamples: 29 },
		},
	}), /timing evidence is incomplete/u);
	assert.throws(() => assertAdmissibleStage2Baseline({
		...baseline,
		gates: { ok: false, failures: ['update.preview:successes-do-not-match-attempts'] },
	}), /non-performance gate failures/u);
	assert.throws(() => assertAdmissibleStage2Baseline({
		...baseline,
		gates: undefined,
	}), /gate evidence is missing/u);
	assert.throws(() => assertAdmissibleStage2Baseline({
		...baseline,
		gates: { ok: true, failures: ['update.preview:warm-total-max-exceeded'] },
	}), /gate evidence is inconsistent/u);
});
