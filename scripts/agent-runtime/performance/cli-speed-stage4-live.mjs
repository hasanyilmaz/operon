#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	copyFileSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { arch, hostname, platform, release } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
	assertCliSpeedStage1Vault,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';
import { isRetryablePreHandlerShardFailure } from './cli-speed-stage3-checkpoint-core.mjs';
import {
	evaluateStage4Evidence,
	isRetryableCompactReloadFailure,
	STAGE4_PROFILE,
} from './cli-speed-stage4-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resultsDirectory = '/private/tmp/operon-agent-runtime-results';
const fullTail = process.argv.includes('--full-tail');
const compactOnly = process.argv.includes('--compact-only');
const checkpointDirectory = path.join(
	resultsDirectory,
	compactOnly ? 'stage4-a48-compact-close' : 'stage4-close',
);
const checkpointPath = path.join(checkpointDirectory, 'checkpoint.json');
const candidateRestoreMarkerPath = path.join(checkpointDirectory, 'candidate-restore-required.json');
const finalPath = path.join(
	resultsDirectory,
	compactOnly ? 'cli-speed-stage4-8-compact.json' : 'cli-speed-stage4.json',
);
const stage3EvidencePath = path.join(resultsDirectory, 'cli-speed-stage3.json');
const baselineDirectory = path.join(
	resultsDirectory,
	compactOnly ? 'stage4-a48-baseline' : 'stage4-baseline',
);
const baselineManifestPath = path.join(baselineDirectory, 'manifest.json');
const baselineArtifacts = Object.freeze({
	production: path.join(baselineDirectory, 'main.js'),
	probe: path.join(baselineDirectory, 'main-probe.js'),
	cli: path.join(baselineDirectory, 'operon.mjs'),
});
const expectedBaselineDigests = Object.freeze(compactOnly ? {
	production: '529185ae3b1db01f5af9a43928815a1d1b2a24ea5dab6364c01cd473abba3f1e',
	probe: '4e24d64089ac21b1b763928ac2b2cb8ced668a5f843574a3f5b85e86584120b3',
	cli: 'b75e9bf5f3ad8016c032430dc27529c40cf9778c9466f045ca6a3ba066cf04df',
} : {
	production: 'b29f21270ea4d217d5dbb87fb434a8548ca3dfd11c7aa7f3d8e100f4ddead349',
	probe: 'c1777b328f5b054015585de87de69ee968dddd2060b176fb3d38c11fddedc3de',
	cli: '04ad8aefc8c35c1246171211d1804438355735ab4202f729c00f136540d6a8af',
});
const liveArtifacts = Object.freeze({
	production: path.join(pluginRoot, 'main.js'),
	probe: path.join(pluginRoot, 'build/agent-runtime-probe/main.js'),
	cli: path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs'),
});
const requiredUnits = compactOnly ? ['compact'] : ['compact', 'batch', 'tail-concurrency', 'jsonl'];
let candidateLiveRestoreVerified = false;

assert.deepEqual(
	process.argv.slice(2).filter(value => !['--full-tail', '--compact-only'].includes(value)),
	[],
	'Only --full-tail and --compact-only are supported.',
);
assert.equal(
	fullTail && compactOnly,
	false,
	'--full-tail and --compact-only cannot be combined.',
);
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
mkdirSync(checkpointDirectory, { recursive: true });
assert.equal(existsSync(stage3EvidencePath), true, 'Sealed Stage 3 evidence is required.');
const baselineManifest = ensureBaselineManifest();
const initialObsidianSessionDigest = obsidianSessionDigest();

buildArtifacts();
const candidateArtifacts = preserveCandidateArtifacts();
registerCandidateRestoreGuards(candidateArtifacts);
if (existsSync(candidateRestoreMarkerPath)) restoreCandidateLiveVault(candidateArtifacts.cli);
const identity = buildIdentity();
let checkpoint = loadCheckpoint(identity);
for (const unit of requiredUnits) {
	if (
		checkpoint.units[unit]?.status === 'passed'
		&& checkpointUnitIsValid(unit, checkpoint.units[unit])
	) continue;
	let result = runUnit(unit);
	if (unit === 'compact' && isRetryablePreHandlerShardFailure(result.evidence, result.status)) {
		atomicWriteJson(
			path.join(checkpointDirectory, `compact-pre-handler-retry-${Date.now()}.json`),
			result.evidence,
		);
		result = runUnit(unit);
	}
	checkpoint.units[unit] = {
		status: result.status === 0 ? 'passed' : 'failed',
		recordedAt: new Date().toISOString(),
		evidencePath: result.path,
		evidenceDigest: existsSync(result.path) ? sha256File(result.path) : null,
		failure: result.status === 0 ? null : {
			exitCode: result.status,
			stderr: result.stderr,
			stdoutTail: result.stdout.slice(-8192),
		},
	};
	checkpoint.revision += 1;
	atomicWriteJson(checkpointPath, checkpoint);
	if (result.status !== 0) break;
}
restoreCandidateLiveVault(candidateArtifacts.cli);

const missing = requiredUnits.filter(unit => (
	checkpoint.units[unit]?.status !== 'passed'
	|| !checkpointUnitIsValid(unit, checkpoint.units[unit])
));
if (missing.length > 0) {
	process.stdout.write(`${JSON.stringify({
		suite: 'operon-cli-speed-stage4',
		status: 'failed',
		missing,
		checkpoint: checkpointPath,
	}, null, 2)}\n`);
	process.exitCode = 1;
} else {
	const compact = readJson(path.join(checkpointDirectory, 'compact.json'));
	if (compactOnly) {
		const gates = evaluateStage4Evidence({ compact, compactOnly: true });
		const evidence = {
			schemaVersion: 1,
			suite: 'operon-cli-speed-stage4-compact-close',
			recordedAt: new Date().toISOString(),
			vaultPath: CLI_SPEED_STAGE1_VAULT,
			profile: { compact: STAGE4_PROFILE.compact },
			identity,
			checkpoint: { path: checkpointPath, revision: checkpoint.revision },
			production: { compact: compact.candidate },
			probe: {
				compact: compact.candidate?.probeStageTimings ?? [],
				authoritativeForGates: false,
				profile: compact.probeProfile,
			},
			baseline: { compact: compact.baseline, manifest: baselineManifest },
			comparison: { compact },
			gates,
		};
		if (!gates.ok && checkpoint.units.compact) {
			checkpoint.units.compact = {
				...checkpoint.units.compact,
				status: 'failed',
				gateFailure: gates.failures[0] ?? 'compact:unknown-gate-failure',
			};
			checkpoint.revision += 1;
			atomicWriteJson(checkpointPath, checkpoint);
		}
		atomicWriteJson(finalPath, evidence);
		process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
		if (!gates.ok) process.exitCode = 1;
	} else {
	const batch = readJson(path.join(checkpointDirectory, 'batch.json'));
	const tailConcurrency = readJson(path.join(checkpointDirectory, 'tail-concurrency.json'));
	const jsonl = readJson(path.join(checkpointDirectory, 'jsonl.json'));
	const gates = evaluateStage4Evidence({
		compact,
		tail: tailConcurrency.tail,
		concurrency: tailConcurrency.concurrency,
		jsonl,
		tailBaseline: tailConcurrency.baseline?.tail,
		fullTail,
	});
	if (batch.gate?.ok !== true) {
		gates.ok = false;
		gates.failures.push('batch:stage3-preservation-gates-failed');
	}
	const evidence = {
		schemaVersion: 1,
		suite: 'operon-cli-speed-stage4',
		recordedAt: new Date().toISOString(),
		vaultPath: CLI_SPEED_STAGE1_VAULT,
		profile: { ...STAGE4_PROFILE, tail: fullTail ? 300 : STAGE4_PROFILE.tail },
		identity,
		checkpoint: { path: checkpointPath, revision: checkpoint.revision },
		production: {
			compact: compact.candidate,
			batch: batch.candidate,
			tail: tailConcurrency.tail,
			concurrency: tailConcurrency.concurrency,
			jsonl,
		},
		probe: {
			compact: compact.candidate?.probeStageTimings ?? [],
			batch: batch.candidate?.probeStageTimings ?? [],
			tailAndConcurrency: tailConcurrency.probeStageTimings ?? [],
			authoritativeForGates: false,
		},
		baseline: {
			compact: compact.baseline,
			batch: batch.baseline,
			tail: tailConcurrency.baseline?.tail ?? null,
			manifest: baselineManifest,
		},
		comparison: {
			compact,
		},
		gates,
	};
	if (!gates.ok) {
		for (const failure of gates.failures) {
			const unit = failure.startsWith('compact:')
				? 'compact'
				: failure.startsWith('batch:')
					? 'batch'
					: failure.startsWith('jsonl:')
						? 'jsonl'
						: failure.startsWith('tail:') || failure.startsWith('concurrency:')
							? 'tail-concurrency'
							: null;
			if (unit && checkpoint.units[unit]) {
				checkpoint.units[unit] = {
					...checkpoint.units[unit],
					status: 'failed',
					gateFailure: failure,
				};
			}
		}
		checkpoint.revision += 1;
		atomicWriteJson(checkpointPath, checkpoint);
	}
	atomicWriteJson(finalPath, evidence);
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	if (!gates.ok) process.exitCode = 1;
	}
}

function runUnit(unit) {
	const destination = path.join(checkpointDirectory, `${unit}.json`);
	rmSync(destination, { force: true });
	if (unit === 'compact' || unit === 'batch') {
		const families = unit === 'compact'
			? ['human-compact-create', 'human-exact-update']
			: ['batch-1', 'batch-20', 'batch-64'];
		return runComparisonUnit(unit, families, destination);
	}
	if (unit === 'tail-concurrency') {
		return runTailConcurrencyUnit(destination);
	}
	const child = run(process.execPath, [
		path.join(scriptDirectory, 'cli-speed-stage3-session.mjs'),
	], {
		OPERON_CLI_SPEED_SESSION_WARMUPS: '2',
		OPERON_CLI_SPEED_SESSION_WARM_SAMPLES: '75',
		OPERON_CLI_SPEED_SESSION_THROUGHPUT_SAMPLES: '75',
		OPERON_CLI_SPEED_SESSION_LEAK_SAMPLES: '300',
	}, destination, true);
	return child;
}

function runComparisonUnit(unit, families, destination) {
	if (unit === 'compact') return runCompactAbbaUnit(families, destination);
	const baselinePath = path.join(checkpointDirectory, `${unit}-baseline.json`);
	const candidatePath = path.join(checkpointDirectory, `${unit}-candidate.json`);
	let baselineRun;
	let candidateRun;
	try {
		markCandidateRestoreRequired();
		installBundleArtifacts(baselineArtifacts);
		baselineRun = runStage1Families(families, baselinePath, baselineArtifacts.cli, 20, true);
		assertSameObsidianSession();
		installBundleArtifacts(candidateArtifacts);
		candidateRun = runStage1Families(families, candidatePath, candidateArtifacts.cli);
		assertSameObsidianSession();
	} finally {
		installBundleArtifacts(candidateArtifacts);
		restoreCandidateLiveVault(candidateArtifacts.cli);
	}
	const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
	const candidate = existsSync(candidatePath) ? readJson(candidatePath) : null;
	const gate = {
		ok: baselineRun?.status === 0
			&& candidateRun?.status === 0
			&& baseline !== null
			&& candidate !== null,
		failures: [],
	};
	if (!gate.ok) gate.failures.push(`${unit}:same-session-collection-failed`);
	if (unit === 'batch' && gate.ok) {
		for (const [size, minimum] of [[20, 11.964], [64, 21.264]]) {
			if (!(candidate.batchSpeedups?.[size] >= minimum)) {
				gate.failures.push(`batch-${size}:speedup-below-${minimum}`);
			}
		}
		for (const [scenario, candidateSummary] of Object.entries(candidate.scenarios ?? {})) {
			const baselineSummary = baseline.scenarios?.[scenario];
			for (const [metric, limit] of [['p50', 10], ['p95', 15]]) {
				const effectiveLimit = scenario === 'batch-create-1.apply' && metric === 'p95'
					? 18
					: limit;
				const before = baselineSummary?.outerWallMs?.[metric];
				const after = candidateSummary?.outerWallMs?.[metric];
				if (Number.isFinite(before) && before > 0 && Number.isFinite(after)
					&& (after - before) / before * 100 > effectiveLimit) {
					gate.failures.push(
						`${scenario}:outer-${metric}-regressed-over-${effectiveLimit}-percent`,
					);
				}
			}
			if (candidateSummary?.totalMs?.max > 5_000) {
				gate.failures.push(`${scenario}:warm-total-over-5s`);
			}
		}
		gate.ok = gate.failures.length === 0;
	}
	const evidence = {
		schemaVersion: 1,
		suite: `operon-cli-speed-stage4-${unit}`,
		sameSession: true,
		baseline,
		candidate,
		gate,
	};
	atomicWriteJson(destination, evidence);
	return {
		status: gate.ok ? 0 : 1,
		stdout: candidateRun?.stdout ?? '',
		stderr: [baselineRun?.stderr, candidateRun?.stderr].filter(Boolean).join('\n'),
		path: destination,
		evidence,
	};
}

function runCompactAbbaUnit(families, destination) {
	const paths = {
		baselineA: path.join(checkpointDirectory, 'compact-baseline-a.json'),
		candidateA: path.join(checkpointDirectory, 'compact-candidate-a.json'),
		candidateB: path.join(checkpointDirectory, 'compact-candidate-b.json'),
		baselineB: path.join(checkpointDirectory, 'compact-baseline-b.json'),
	};
	const runs = {};
	try {
		for (const [name, artifacts] of [
			['baselineA', baselineArtifacts],
			['candidateA', candidateArtifacts],
			['candidateB', candidateArtifacts],
			['baselineB', baselineArtifacts],
		]) {
			const compactArtifacts = { ...artifacts, cli: candidateArtifacts.cli };
			if (name.startsWith('baseline')) markCandidateRestoreRequired();
			installBundleArtifacts(compactArtifacts);
			runs[name] = runStage1Families(
				families,
				paths[name],
				candidateArtifacts.cli,
				10,
				name.startsWith('baseline'),
			);
			if (
				isRetryableCompactLegFailure(runs[name])
			) {
				atomicWriteJson(
					path.join(checkpointDirectory, `compact-${name}-pre-handler-retry-${Date.now()}.json`),
					runs[name].evidence,
				);
				runs[name] = runStage1Families(
					families,
					paths[name],
					candidateArtifacts.cli,
					10,
					name.startsWith('baseline'),
				);
			}
			assertSameObsidianSession();
		}
	} finally {
		installBundleArtifacts(candidateArtifacts);
		restoreCandidateLiveVault(candidateArtifacts.cli);
	}
	const legs = Object.fromEntries(Object.entries(paths).map(([name, filePath]) => [
		name,
		existsSync(filePath) ? readJson(filePath) : null,
	]));
	const baseline = mergeCompactEvidence(legs.baselineA, legs.baselineB);
	const candidate = mergeCompactEvidence(legs.candidateA, legs.candidateB);
	const gate = {
		ok: Object.values(runs).every(runResult => runResult?.status === 0)
			&& baseline !== null
			&& candidate !== null,
		failures: [],
	};
	if (!gate.ok) gate.failures.push('compact:abba-same-session-collection-failed');
	const expectedLegArtifacts = {
		baselineA: baselineArtifacts,
		candidateA: candidateArtifacts,
		candidateB: candidateArtifacts,
		baselineB: baselineArtifacts,
	};
	for (const [name, artifacts] of Object.entries(expectedLegArtifacts)) {
		if (!compactLegMatchesArtifacts(legs[name], artifacts, candidateArtifacts.cli)) {
			gate.failures.push(`compact:${name}:artifact-class-mismatch`);
		}
	}
	const fixtureDigests = Object.values(legs).map(leg => leg?.fixtureDigest);
	if (
		fixtureDigests.some(digest => typeof digest !== 'string' || digest.length !== 64)
		|| new Set(fixtureDigests).size !== 1
	) {
		gate.failures.push('compact:abba-fixture-digest-mismatch');
	}
	gate.ok = gate.failures.length === 0;
	const evidence = {
		schemaVersion: 1,
		suite: 'operon-cli-speed-stage4-compact',
		sameSession: true,
		order: ['baselineA', 'candidateA', 'candidateB', 'baselineB'],
		baselineClass: 'pre-validated-snapshot-prune',
		expectedArtifacts: Object.fromEntries(
			Object.entries(expectedLegArtifacts).map(([name, artifacts]) => [
				name,
				{
					production: sha256File(artifacts.production),
					probe: sha256File(artifacts.probe),
					cli: sha256File(candidateArtifacts.cli),
				},
			]),
		),
		fixtureDigest: fixtureDigests[0] ?? null,
		legs,
		baseline,
		candidate,
		applyPhase: {
			authoritative: [
				baseline,
				candidate,
				...Object.values(legs),
			].every(value => ['create', 'update'].every(family => (
				value?.humanOneLineWorkflows?.[family]?.applyOuterWallMs?.samples
				=== value?.humanOneLineWorkflows?.[family]?.successes
			))),
			metric: 'applyOuterWallMs',
			source: 'benchmark-runtime-dispatch-trace',
			sharedCliDigest: sha256File(candidateArtifacts.cli),
		},
		probeProfile: {
			mutationSamplesPerFamily: 5,
			authoritativeForGates: false,
		},
		gate,
	};
	atomicWriteJson(destination, evidence);
	return {
		status: gate.ok ? 0 : 1,
		stdout: runs.candidateB?.stdout ?? '',
		stderr: Object.values(runs).map(runResult => runResult?.stderr).filter(Boolean).join('\n'),
		path: destination,
		evidence,
	};
}

function isRetryableCompactLegFailure(runResult) {
	if (isRetryablePreHandlerShardFailure(runResult?.evidence, runResult?.status)) return true;
	return isRetryableCompactReloadFailure(runResult);
}

function mergeCompactEvidence(left, right) {
	if (!left || !right) return null;
	const humanOneLineSamples = {};
	const humanOneLineWorkflows = {};
	for (const family of ['create', 'update']) {
		const samples = [
			...(left.humanOneLineSamples?.[family] ?? []),
			...(right.humanOneLineSamples?.[family] ?? []),
		];
		humanOneLineSamples[family] = samples;
		humanOneLineWorkflows[family] = summarizeHumanSamples(samples);
	}
	return {
		...right,
		fixtureDigest: left.fixtureDigest === right.fixtureDigest
			? left.fixtureDigest
			: sha256Text(JSON.stringify([left.fixtureDigest, right.fixtureDigest])),
		humanOneLineSamples,
		humanOneLineWorkflows,
	};
}

function compactLegMatchesArtifacts(leg, artifacts, cliArtifact) {
	return leg?.artifacts?.production?.sha256 === sha256File(artifacts.production)
		&& leg?.artifacts?.probe?.sha256 === sha256File(artifacts.probe)
		&& leg?.artifacts?.cli?.sha256 === sha256File(cliArtifact);
}

function summarizeHumanSamples(values) {
	const successful = values.filter(value => value.ok === true);
	const summarize = key => {
		const samples = successful.map(value => value[key]).filter(Number.isFinite);
		return {
			samples: samples.length,
			p50: percentile(samples, 0.5),
			p95: percentile(samples, 0.95),
			max: samples.length ? Math.max(...samples) : null,
		};
	};
	return {
		attempts: values.length,
		successes: successful.length,
		correctnessFailures: values.filter(value => value.ok !== true),
		outerWallMs: summarize('outerWallMs'),
		cliTotalMs: summarize('cliTotalMs'),
		handlerMs: summarize('handlerMs'),
		runtimeCalls: summarize('runtimeCalls'),
		applyOuterWallMs: summarize('applyOuterWallMs'),
	};
}

function percentile(values, fraction) {
	const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
	if (finite.length === 0) return null;
	const rank = Math.ceil(fraction * finite.length) - 1;
	return finite[Math.max(0, Math.min(finite.length - 1, rank))];
}

function runTailConcurrencyUnit(destination) {
	const baselinePath = path.join(checkpointDirectory, 'tail-baseline.json');
	const candidatePath = path.join(checkpointDirectory, 'tail-concurrency-candidate.json');
	let baselineRun;
	let candidateRun;
	try {
		installBundleArtifacts(baselineArtifacts);
		baselineRun = runStage1Tail(baselinePath, baselineArtifacts.cli, false);
		assertSameObsidianSession();
		installBundleArtifacts(candidateArtifacts);
		candidateRun = runStage1Tail(candidatePath, candidateArtifacts.cli, true);
		assertSameObsidianSession();
	} finally {
		installBundleArtifacts(candidateArtifacts);
	}
	const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
	const candidate = existsSync(candidatePath) ? readJson(candidatePath) : null;
	const ok = baselineRun?.status === 0 && candidateRun?.status === 0
		&& baseline?.tail?.status === 'collected'
		&& candidate?.tail?.status === 'collected'
		&& candidate?.concurrency?.status === 'collected';
	const evidence = {
		schemaVersion: 1,
		suite: 'operon-cli-speed-stage4-tail-concurrency',
		sameSession: true,
		baseline,
		candidate,
		tail: candidate?.tail,
		concurrency: candidate?.concurrency,
		probeStageTimings: candidate?.probeStageTimings ?? [],
	};
	atomicWriteJson(destination, evidence);
	return {
		status: ok ? 0 : 1,
		stdout: candidateRun?.stdout ?? '',
		stderr: [baselineRun?.stderr, candidateRun?.stderr].filter(Boolean).join('\n'),
		path: destination,
		evidence,
	};
}

function runStage1Families(families, destination, cli, samples = 20, legacyProbe = false) {
	return run(process.execPath, [
		path.join(scriptDirectory, 'cli-speed-stage1-live.mjs'),
		...families.flatMap(family => ['--family', family]),
	], {
		OPERON_CLI_EXECUTABLE: cli,
		OPERON_CLI_SPEED_SKIP_BUILD: '1',
		OPERON_CLI_SPEED_RESULT_PATH: destination,
		OPERON_CLI_SPEED_WARM_SAMPLES: String(samples),
		OPERON_CLI_SPEED_WARMUPS: '2',
		OPERON_CLI_SPEED_BATCH_SAMPLES: String(samples),
		OPERON_CLI_SPEED_BATCH_WARMUPS: '2',
		OPERON_CLI_SPEED_PROBE_MUTATION_SAMPLES: unitProbeSamples(families),
		OPERON_CLI_SPEED_ALLOW_LEGACY_PROBE: legacyProbe ? '1' : '0',
	}, destination);
}

function unitProbeSamples(families) {
	return families.some(family => (
		family === 'human-compact-create'
		|| family === 'human-exact-update'
	)) ? '5' : '1';
}

function runStage1Tail(destination, cli, concurrency) {
	return run(process.execPath, [
		path.join(scriptDirectory, 'cli-speed-stage1-live.mjs'),
		'--tail',
		...(concurrency ? ['--concurrency'] : []),
		'--family',
		'task-get-warm',
	], {
		OPERON_CLI_EXECUTABLE: cli,
		OPERON_CLI_SPEED_SKIP_BUILD: '1',
		OPERON_CLI_SPEED_RESULT_PATH: destination,
		OPERON_CLI_SPEED_WARM_SAMPLES: '20',
		OPERON_CLI_SPEED_WARMUPS: '2',
		OPERON_CLI_SPEED_TAIL_SAMPLES: fullTail ? '300' : '75',
		OPERON_CLI_SPEED_CONCURRENCY_REPETITIONS: '5',
	}, destination);
}

function run(command, args, extraEnvironment, destination, stdoutJson = false) {
	const environment = { ...process.env, ...extraEnvironment };
	const result = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: environment,
		maxBuffer: 256 * 1024 * 1024,
	});
	if (stdoutJson && result.stdout.trim()) {
		atomicWriteJson(destination, JSON.parse(result.stdout.trim().split('\n').at(-1)));
	}
	return {
		status: result.status,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		path: destination,
		evidence: existsSync(destination) ? readJson(destination) : null,
	};
}

function runRequired(command, args) {
	const result = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 8 * 1_024 * 1_024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result;
}

function buildArtifacts() {
	for (const [command, args] of [
		[process.execPath, ['packages/operon-cli/build.mjs']],
		[process.execPath, ['esbuild.config.mjs', 'production']],
		[process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-probe']],
	]) {
		const result = spawnSync(command, args, { cwd: pluginRoot, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
}

function registerCandidateRestoreGuards(artifacts) {
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		installBundleArtifacts(artifacts);
		if (!candidateLiveRestoreVerified) {
			try {
				restoreCandidateLiveVault(artifacts.cli);
			} catch (error) {
				atomicWriteJson(candidateRestoreMarkerPath, {
					schemaVersion: 1,
					kind: 'operon-cli-stage4-candidate-restore-required',
					recordedAt: new Date().toISOString(),
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}
	};
	process.once('exit', restore);
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, () => {
			restore();
			process.exit(signal === 'SIGINT' ? 130 : 143);
		});
	}
}

function markCandidateRestoreRequired() {
	candidateLiveRestoreVerified = false;
	atomicWriteJson(candidateRestoreMarkerPath, {
		schemaVersion: 1,
		kind: 'operon-cli-stage4-candidate-restore-required',
		recordedAt: new Date().toISOString(),
	});
}

function buildIdentity() {
	const files = [
		'main.js',
		'build/agent-runtime-probe/main.js',
		'packages/operon-cli/dist/operon.mjs',
		...[
			'cli-speed-stage1-live.mjs',
			'cli-speed-stage3-live.mjs',
			'cli-speed-stage3-session.mjs',
			'cli-speed-stage4-live.mjs',
			'cli-speed-stage4-core.mjs',
		].map(name => path.join('scripts/agent-runtime/performance', name)),
		'scripts/agent-runtime/create-sanitized-vault.mjs',
	];
	const artifacts = Object.fromEntries(files.map(file => [file, sha256File(path.join(pluginRoot, file))]));
	const value = {
		vaultRealpath: realpathSync(CLI_SPEED_STAGE1_VAULT),
		profile: { ...STAGE4_PROFILE, tail: fullTail ? 300 : STAGE4_PROFILE.tail },
		artifacts,
		stage3EvidenceDigest: sha256File(stage3EvidencePath),
		baselineManifestDigest: sha256File(baselineManifestPath),
		environment: {
			host: hostname(),
			platform: platform(),
			release: release(),
			architecture: arch(),
			node: process.version,
		},
		obsidianSessionDigest: initialObsidianSessionDigest,
	};
	return { ...value, digest: sha256Text(JSON.stringify(value)) };
}

function checkpointUnitIsValid(unitName, unit) {
	if (
		typeof unit?.evidencePath !== 'string'
		|| typeof unit?.evidenceDigest !== 'string'
		|| !existsSync(unit.evidencePath)
		|| sha256File(unit.evidencePath) !== unit.evidenceDigest
	) return false;
	const evidence = readJson(unit.evidencePath);
	if (unitName === 'jsonl') {
		return evidence?.status === 'collected'
			&& evidence?.samplePlan?.warm === STAGE4_PROFILE.session
			&& evidence?.samplePlan?.leak === STAGE4_PROFILE.soak;
	}
	const expectedSuite = {
		compact: 'operon-cli-speed-stage4-compact',
		batch: 'operon-cli-speed-stage4-batch',
		'tail-concurrency': 'operon-cli-speed-stage4-tail-concurrency',
	}[unitName];
	if (evidence?.suite !== expectedSuite) return false;
	if (unitName === 'compact') {
		return evidence?.order?.join(',') === 'baselineA,candidateA,candidateB,baselineB'
			&& evidence?.baselineClass === 'pre-validated-snapshot-prune'
			&& evidence?.gate?.ok === true;
	}
	return true;
}

function obsidianSessionDigest() {
	const result = spawnSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr || 'Could not inspect Obsidian session.');
	const matches = result.stdout.split('\n')
		.map(line => line.trim())
		.filter(line => /\/Obsidian\.app\/Contents\/MacOS\/Obsidian(?:\s|$)/u.test(line));
	assert.equal(matches.length, 1, `Expected one Obsidian process, found ${matches.length}.`);
	return sha256Text(matches[0]);
}

function assertSameObsidianSession() {
	assert.equal(
		obsidianSessionDigest(),
		initialObsidianSessionDigest,
		'Obsidian session changed during Stage 4 AB comparison.',
	);
}

function ensureBaselineManifest() {
	for (const [name, filePath] of Object.entries(baselineArtifacts)) {
		assert.equal(existsSync(filePath), true, `Stage 4 baseline artifact is missing: ${filePath}`);
		assert.equal(
			sha256File(filePath),
			expectedBaselineDigests[name],
			`Stage 4 ${name} baseline digest mismatch.`,
		);
	}
	const expected = {
		schemaVersion: 1,
		kind: 'operon-cli-stage4-baseline',
		artifacts: Object.fromEntries(Object.entries(baselineArtifacts).map(([name, filePath]) => [
			name,
			{ path: filePath, bytes: statSync(filePath).size, sha256: expectedBaselineDigests[name] },
		])),
	};
	if (!existsSync(baselineManifestPath)) atomicWriteJson(baselineManifestPath, expected);
	const manifest = readJson(baselineManifestPath);
	assert.deepEqual(manifest, expected, 'Stage 4 baseline manifest does not match frozen artifacts.');
	return manifest;
}

function preserveCandidateArtifacts() {
	const directory = path.join(checkpointDirectory, 'candidate-artifacts');
	mkdirSync(directory, { recursive: true });
	const preserved = {
		production: path.join(directory, 'main.js'),
		probe: path.join(directory, 'main-probe.js'),
		cli: path.join(directory, 'operon.mjs'),
	};
	for (const [name, destination] of Object.entries(preserved)) {
		copyFileSync(liveArtifacts[name], destination);
	}
	return preserved;
}

function installBundleArtifacts(artifacts) {
	for (const name of ['production', 'probe']) {
		const destination = liveArtifacts[name];
		const temporary = `${destination}.stage4-${process.pid}`;
		copyFileSync(artifacts[name], temporary);
		renameSync(temporary, destination);
		assert.equal(sha256File(destination), sha256File(artifacts[name]));
	}
}

function restoreCandidateLiveVault(cliArtifact) {
	runRequired('obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon']);
	runRequired(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		'--production',
		'--allow-active-vault-ephemera',
		CLI_SPEED_STAGE1_VAULT,
	]);
	runRequired('obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']);
	const deadline = Date.now() + 35_000;
	do {
		const health = run(cliArtifact, [
			'health',
			'--vault',
			CLI_SPEED_STAGE1_VAULT,
			'--json',
		], {}, path.join(checkpointDirectory, 'candidate-restore-health.json'), true);
		const capabilities = run(cliArtifact, [
			'capabilities',
			'--vault',
			CLI_SPEED_STAGE1_VAULT,
			'--json',
		], {}, path.join(checkpointDirectory, 'candidate-restore-capabilities.json'), true);
		const ready = health.status === 0
			&& health.evidence?.ok === true
			&& health.evidence?.result?.lifecyclePhase === 'ready'
			&& health.evidence?.result?.freshness?.settled === true;
		const capabilityMap = new Map(
			(capabilities.evidence?.result ?? []).map(capability => [
				capability.id,
				capability.availability,
			]),
		);
		if (
			ready
			&& capabilities.status === 0
			&& capabilityMap.get('tasks.create.preview') === 'available'
			&& capabilityMap.get('tasks.update.preview') === 'available'
		) {
			candidateLiveRestoreVerified = true;
			rmSync(candidateRestoreMarkerPath, { force: true });
			return;
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
	} while (Date.now() < deadline);
	throw new Error('Candidate Runtime did not restore with mutation capabilities available.');
}

function loadCheckpoint(expectedIdentity) {
	if (!existsSync(checkpointPath)) {
		return { schemaVersion: 1, kind: 'operon-cli-stage4-checkpoint', identity: expectedIdentity,
			requiredUnits, revision: 0, units: {} };
	}
	const value = readJson(checkpointPath);
	if (value.kind === 'operon-cli-stage4-checkpoint'
		&& value.identity?.digest === expectedIdentity.digest) return value;
	if (
		value.kind === 'operon-cli-stage4-checkpoint'
		&& identitiesDifferOnlyByTailProfile(value.identity, expectedIdentity)
	) {
		value.identity = expectedIdentity;
		delete value.units['tail-concurrency'];
		value.revision += 1;
		return value;
	}
	renameSync(checkpointPath, `${checkpointPath}.stale-${Date.now()}`);
	return { schemaVersion: 1, kind: 'operon-cli-stage4-checkpoint', identity: expectedIdentity,
		requiredUnits, revision: 0, units: {} };
}

function identitiesDifferOnlyByTailProfile(left, right) {
	if (!left || !right) return false;
	const normalize = value => {
		const copy = JSON.parse(JSON.stringify(value));
		delete copy.digest;
		if (copy.profile) copy.profile.tail = null;
		return copy;
	};
	return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function atomicWriteJson(destination, value) {
	mkdirSync(path.dirname(destination), { recursive: true });
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
	assert.equal(statSync(filePath).isFile(), true, `Expected file: ${filePath}`);
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function sha256Text(value) {
	return createHash('sha256').update(value).digest('hex');
}
