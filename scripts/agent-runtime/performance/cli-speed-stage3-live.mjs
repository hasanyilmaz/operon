#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	closeSync,
	copyFileSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertFreshStage2CollectorEvidence,
	clearStage2CollectorResult,
} from './cli-speed-stage2-core.mjs';
import {
	assertAdmissibleStage3Baseline,
	assertAdmissibleStage3JsonlSession,
	buildAcceptedStage2BatchMilestone,
	compactWorkflowEvidence,
	evaluateStage3Candidate,
	sha256Json,
} from './cli-speed-stage3-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resultsDirectory = '/private/tmp/operon-agent-runtime-results';
const resultPath = process.env.OPERON_CLI_SPEED_STAGE3_RESULT_PATH
	?? path.join(resultsDirectory, 'cli-speed-stage3.json');
const qualificationEvidencePath = path.join(
	resultsDirectory,
	'cli-speed-stage3-baseline-qualification.json',
);
const acceptedStage2Path = path.join(resultsDirectory, 'cli-speed-stage2.json');
const sealDirectory = path.join(resultsDirectory, 'stage3-baseline');
const sealEvidencePath = path.join(sealDirectory, 'baseline-evidence.json');
const sealManifestPath = path.join(sealDirectory, 'manifest.json');
const milestonePath = path.join(sealDirectory, 'stage2-batch-milestone.json');
const acceptedEvidenceCopyPath = path.join(sealDirectory, 'accepted-stage2-evidence.json');
const defaultPrechangeDirectory = path.join(resultsDirectory, 'stage3-prechange');
const productionPath = path.join(pluginRoot, 'main.js');
const probePath = path.join(pluginRoot, 'build/agent-runtime-probe/main.js');
const cliPath = path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const swapMarkerPath = path.join(resultsDirectory, 'cli-speed-stage3-artifact-swap.json');
const sessionDirectory = mkdtempSync('/private/tmp/operon-cli-speed-stage3-run-');
const prechangeArtifactIdentity = Object.freeze({
	production: Object.freeze({
		bytes: 4_217_641,
		sha256: '2965a41e1f2d5c61cf3498bb79a0a93c46e4f3d0d70f933ad5b86a89c9dd22c9',
	}),
	probe: Object.freeze({
		bytes: 4_231_718,
		sha256: '4de0003c9b285d16bad2c872aec578a62b3007bbd8f40bf24c4b2feea1709074',
	}),
	cli: Object.freeze({
		bytes: 415_465,
		sha256: '3c1080ea96c7fef958d49d06d0f8fe7816f4b061e29cf60a467e09a4c1291e74',
	}),
});
const stage3Options = parseStage3Options(process.argv.slice(2));
const qualificationProfile = stage3Options.profile;

mkdirSync(resultsDirectory, { recursive: true });
assert.equal(existsSync(acceptedStage2Path), true, `Accepted Stage 2 evidence is missing: ${acceptedStage2Path}`);
runRequired(process.execPath, ['packages/operon-cli/build.mjs']);
runRequired(process.execPath, ['esbuild.config.mjs', 'production']);
runRequired(process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-probe']);

const candidate = {
	production: path.join(sessionDirectory, 'candidate-main.js'),
	probe: path.join(sessionDirectory, 'candidate-main-probe.js'),
	cli: path.join(sessionDirectory, 'candidate-operon.mjs'),
};
copyFileSync(productionPath, candidate.production);
copyFileSync(probePath, candidate.probe);
copyFileSync(cliPath, candidate.cli);

let stage3Error;
try {
	const milestone = ensureAcceptedMilestone();
	const acceptedStage2 = readJson(acceptedStage2Path);
	const baselineSeal = ensureStage3Baseline(acceptedStage2, milestone);
	const qualificationPath = path.join(sessionDirectory, 'baseline-qualification.json');
	const candidateWorkingPath = path.join(sessionDirectory, 'candidate-session.json');
	const sealedBaseline = {
		production: path.join(sealDirectory, 'main.js'),
		probe: path.join(sealDirectory, 'main-probe.js'),
		cli: path.join(sealDirectory, 'operon.mjs'),
	};

	const reusableQualification = !stage3Options.target
		&& !stage3Options.refreshBaseline
		&& existsSync(qualificationEvidencePath)
		&& qualificationMatchesProfile(
			readJson(qualificationEvidencePath),
			qualificationProfile,
			sealedBaseline,
		);
	const qualification = reusableQualification
		? readJson(qualificationEvidencePath)
		: (() => {
			installArtifacts(sealedBaseline);
			const collected = runCollector({
				result: qualificationPath,
				cli: sealedBaseline.cli,
				expectedProduction: sealedBaseline.production,
				expectedProbe: sealedBaseline.probe,
				expectedCli: sealedBaseline.cli,
				argumentsList: ['--stage2', ...familyArguments(stage3Options.families)],
				profile: qualificationProfile,
			});
			if (!stage3Options.target) {
				atomicCopyFile(qualificationPath, qualificationEvidencePath);
			}
			return collected;
		})();
	if (reusableQualification) atomicCopyFile(qualificationEvidencePath, qualificationPath);
	if (stage3Options.target) {
		assertTargetCollectorShape(qualification);
	} else {
		assertAdmissibleStage3Baseline(qualification);
	}
	if (!stage3Options.target) atomicCopyFile(qualificationPath, sealEvidencePath);

	installArtifacts(candidate);
	const candidateEvidence = runCollector({
		result: candidateWorkingPath,
		cli: candidate.cli,
		expectedProduction: candidate.production,
		expectedProbe: candidate.probe,
		expectedCli: candidate.cli,
		argumentsList: [
			'--stage2',
			'--compare',
			qualificationPath,
			...familyArguments(stage3Options.families),
		],
		profile: qualificationProfile,
	});
	const jsonlSession = stage3Options.includeJsonl
		? collectJsonlSession(candidate.cli, qualificationProfile)
		: undefined;
	if (stage3Options.target) {
		assertTargetCollectorShape(candidateEvidence);
		const targetGate = evaluateTargetGate({
			baseline: qualification,
			candidate: candidateEvidence,
			jsonlSession,
			options: stage3Options,
		});
		const targetEvidence = {
			schemaVersion: 1,
			suite: 'operon-cli-speed-stage3-target',
			recordedAt: new Date().toISOString(),
			authoritative: false,
			reason: 'targeted-diagnostic-or-checkpoint-unit',
			profile: qualificationProfile.evidence,
			families: stage3Options.families,
			includeJsonl: stage3Options.includeJsonl,
			sameSession: true,
			gate: targetGate,
			baseline: qualification,
			candidate: candidateEvidence,
			...(jsonlSession ? { jsonlSession } : {}),
			artifacts: {
				baseline: artifactSet(sealedBaseline),
				candidate: artifactSet(candidate),
			},
		};
		atomicWriteJson(resultPath, targetEvidence);
		process.stdout.write(`${JSON.stringify(targetEvidence, null, 2)}\n`);
		if (!targetGate.ok) process.exitCode = 1;
	} else {
	const gates = evaluateStage3Candidate({
		baseline: qualification,
		candidate: candidateEvidence,
		jsonlSession,
		expectedProfile: qualificationProfile.evidence,
	});
	if (reusableQualification) {
		gates.ok = false;
		gates.failures.push('baseline:cached-cross-session-screening-only');
	}
	const evidence = {
		...candidateEvidence,
		schemaVersion: 3,
		suite: 'operon-cli-speed-stage3',
		qualificationProfile: qualificationProfile.evidence,
		gates,
		stage3: {
			sameSession: !reusableQualification,
			milestone,
			baselineSeal,
			baselineSession: {
				kind: reusableQualification
					? 'cached-cross-session-screening'
					: 'same-session-qualification',
				reusedAsComparisonBaseline: true,
				sha256: sha256Json(qualification),
				artifacts: qualification.artifacts,
				gates: qualification.gates,
				humanOneLineWorkflows: qualification.humanOneLineWorkflows,
			},
			candidateArtifacts: artifactSet(candidate),
			compact: compactWorkflowEvidence(candidateEvidence),
			jsonlSession,
		},
	};
	atomicWriteJson(resultPath, evidence);
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	if (!gates.ok) process.exitCode = 1;
	}
} catch (error) {
	stage3Error = error;
} finally {
	try {
		installArtifacts(candidate);
	} catch (restoreError) {
		if (stage3Error) {
			throw new AggregateError([stage3Error, restoreError], 'Stage 3 run and restore failed.');
		}
		throw restoreError;
	}
	rmSync(sessionDirectory, { recursive: true, force: true });
}
if (stage3Error) throw stage3Error;

function ensureAcceptedMilestone() {
	const accepted = readJson(acceptedStage2Path);
	const builtMilestone = buildAcceptedStage2BatchMilestone(accepted);
	const milestone = {
		...builtMilestone,
		sourceEvidence: {
			...builtMilestone.sourceEvidence,
			file: fileArtifact(acceptedStage2Path),
		},
	};
	mkdirSync(sealDirectory, { recursive: true });
	if (existsSync(milestonePath)) {
		const existing = readJson(milestonePath);
		assert.equal(
			existing.sourceEvidence?.sha256,
			milestone.sourceEvidence.sha256,
			'Stage 2 accepted milestone source changed after sealing.',
		);
		return existing;
	}
	atomicCopyFile(acceptedStage2Path, acceptedEvidenceCopyPath);
	atomicWriteJson(milestonePath, milestone);
	return milestone;
}

function ensureStage3Baseline(acceptedStage2, milestone) {
	const expected = prechangeArtifactIdentity;
	assert.equal(
		acceptedStage2?.stage2?.candidateArtifacts?.cli?.sha256,
		expected.cli.sha256,
		'Accepted Stage 2 evidence does not identify the pre-change CLI artifact.',
	);
	if (existsSync(sealManifestPath)) {
		const manifest = readJson(sealManifestPath);
		for (const [label, filename] of [
			['production', 'main.js'],
			['probe', 'main-probe.js'],
			['cli', 'operon.mjs'],
		]) {
			const actual = fileArtifact(path.join(sealDirectory, filename));
			assert.deepEqual(actual, manifest.artifacts[label], `Stage 3 sealed ${label} changed.`);
			assert.equal(
				actual.sha256,
				expected[label].sha256,
				`Stage 3 sealed ${label} is not the accepted pre-change artifact.`,
			);
			assert.equal(actual.bytes, expected[label].bytes);
		}
		assert.equal(manifest.stage2MilestoneSha256, sha256Json(milestone));
		return manifest;
	}
	const prechangeDirectory = process.env.OPERON_CLI_SPEED_STAGE3_PRECHANGE_DIR
		?? defaultPrechangeDirectory;
	const prechangeArtifacts = {
		production: path.join(prechangeDirectory, 'main.js'),
		probe: path.join(prechangeDirectory, 'main-probe.js'),
		cli: path.join(prechangeDirectory, 'operon.mjs'),
	};
	for (const [label, filePath] of Object.entries(prechangeArtifacts)) {
		assert.equal(
			existsSync(filePath),
			true,
			`Pre-change ${label} artifact is missing; Stage 3 refuses to seal current artifacts: ${filePath}`,
		);
		assert.equal(
			fileArtifact(filePath).sha256,
			expected[label].sha256,
			`Pre-change ${label} artifact does not match the sealed final Stage 2 identity.`,
		);
		assert.equal(
			fileArtifact(filePath).bytes,
			expected[label].bytes,
			`Pre-change ${label} artifact size does not match the sealed identity.`,
		);
	}
	mkdirSync(sealDirectory, { recursive: true });
	atomicCopyFile(prechangeArtifacts.production, path.join(sealDirectory, 'main.js'));
	atomicCopyFile(prechangeArtifacts.probe, path.join(sealDirectory, 'main-probe.js'));
	atomicCopyFile(prechangeArtifacts.cli, path.join(sealDirectory, 'operon.mjs'));
	const manifest = {
		schemaVersion: 1,
		kind: 'operon-cli-stage3-baseline-seal',
		sealedAt: new Date().toISOString(),
		stage2MilestoneSha256: sha256Json(milestone),
		artifacts: {
			production: fileArtifact(path.join(sealDirectory, 'main.js')),
			probe: fileArtifact(path.join(sealDirectory, 'main-probe.js')),
			cli: fileArtifact(path.join(sealDirectory, 'operon.mjs')),
		},
		sourceDirectory: prechangeDirectory,
		expectedStage2ArtifactDigests: Object.fromEntries(
			Object.entries(expected).map(([label, artifact]) => [label, artifact.sha256]),
		),
	};
	atomicWriteJson(sealManifestPath, manifest);
	return manifest;
}

function runCollector({
	result,
	cli,
	expectedProduction,
	expectedProbe,
	expectedCli,
	argumentsList,
	profile,
}) {
	clearStage2CollectorResult(result, { rmSync });
	const startedAt = Date.now();
	const run = spawnSync(process.execPath, [
		path.join(scriptDirectory, 'cli-speed-stage1-live.mjs'),
		...argumentsList,
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CLI_EXECUTABLE: cli,
			OPERON_CLI_SPEED_RESULT_PATH: result,
			OPERON_CLI_SPEED_SKIP_BUILD: '1',
			...profile.collectorEnvironment,
		},
		maxBuffer: 256 * 1_024 * 1_024,
	});
	assert.equal(
		run.status === 0 || (run.status === 1 && existsSync(result)),
		true,
		run.stderr || run.stdout || 'Stage 3 live collector failed.',
	);
	assert.equal(existsSync(result), true, 'Stage 3 collector did not write evidence.');
	return assertFreshStage2CollectorEvidence({
		evidence: readJson(result),
		startedAt,
		expectedProductionSha256: fileArtifact(expectedProduction).sha256,
		expectedProbeSha256: fileArtifact(expectedProbe).sha256,
		expectedCliSha256: fileArtifact(expectedCli).sha256,
	});
}

function collectJsonlSession(cli, profile) {
	const run = spawnSync(process.execPath, [
		path.join(scriptDirectory, 'cli-speed-stage3-session.mjs'),
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CLI_EXECUTABLE: cli,
			...profile.sessionEnvironment,
		},
		maxBuffer: 64 * 1_024 * 1_024,
	});
	const parsed = JSON.parse(run.stdout || '{}');
	if (run.status !== 0 && parsed.status !== 'blocked') {
		return {
			status: 'blocked',
			reason: 'collection-failed',
			message: run.stderr || 'JSONL session collector failed.',
		};
	}
	return parsed;
}

function familyArguments(families) {
	return families.flatMap(family => ['--family', family]);
}

function assertTargetCollectorShape(evidence) {
	assert.equal(
		evidence?.collection?.mode,
		'targeted',
		'Targeted collector must declare targeted mode.',
	);
	assert.equal(
		evidence?.collection?.production?.authoritativeForGates,
		false,
		'Targeted shards must not claim standalone authority.',
	);
	assert.equal(
		Array.isArray(evidence?.rawSamples) || evidence?.collection?.production?.status === 'failed',
		true,
		'Targeted collector must retain raw samples or an explicit collection failure.',
	);
}

function evaluateTargetGate({ baseline, candidate, jsonlSession, options }) {
	const failures = [];
	if (
		typeof baseline?.fixtureDigest !== 'string'
		|| baseline.fixtureDigest.length === 0
		|| baseline.fixtureDigest !== candidate?.fixtureDigest
	) {
		failures.push('fixture-digest:mismatch-or-missing');
	}
	for (const [label, evidence] of [
		['baseline', baseline],
		['candidate', candidate],
	]) {
		if (evidence?.collection?.production?.status !== 'collected') {
			failures.push(`${label}:collection-failed`);
		}
		for (const [scenario, summary] of Object.entries(evidence?.scenarios ?? {})) {
			if (summary.successes !== summary.attempts) {
				failures.push(`${label}:${scenario}:correctness-incomplete`);
			}
		}
		if (
			options.families.includes('file-update-characterization')
			&& evidence?.fileUpdateCharacterization?.ok !== true
		) {
			failures.push(`${label}:file-update-characterization-incomplete`);
		}
		for (const family of ['create', 'update']) {
			const workflow = evidence?.humanOneLineWorkflows?.[family];
			if (workflow && workflow.successes !== workflow.attempts) {
				failures.push(`${label}:human-${family}:correctness-incomplete`);
			}
		}
		failures.push(...targetFamilyFailures(label, evidence, options));
	}
	if (options.includeJsonl) {
		try {
			assertAdmissibleStage3JsonlSession(jsonlSession);
		} catch (error) {
			failures.push(`jsonl:${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { ok: failures.length === 0, failures };
}

function targetFamilyFailures(label, evidence, options) {
	const failures = [];
	const expected = options.profile.evidence;
	const requireScenario = (scenario, attempts) => {
		const summary = evidence?.scenarios?.[scenario];
		const rawCount = (evidence?.rawSamples ?? [])
			.filter(sample => sample.scenario === scenario)
			.length;
		if (
			summary?.attempts !== attempts
			|| summary.successes !== attempts
			|| rawCount !== attempts
		) {
			failures.push(`${label}:${scenario}:sample-count-mismatch`);
		}
	};
	for (const family of options.families) {
		if (family === 'task-get-warm') {
			requireScenario('task-get.warm', expected.warm);
		} else if (family === 'file-update-core') {
			requireScenario('file-update.preview', expected.warm);
			requireScenario('file-update.apply', expected.warm);
		} else if (family === 'file-update-characterization') {
			const values = evidence?.fileUpdateCharacterization?.rawSamples;
			if (
				evidence?.fileUpdateCharacterization?.attempts !== expected.fileUpdate
				|| evidence.fileUpdateCharacterization.successes !== expected.fileUpdate
				|| !Array.isArray(values)
				|| values.length !== expected.fileUpdate
			) {
				failures.push(`${label}:file-update-characterization:sample-count-mismatch`);
			}
		} else if (/^batch-(?:1|20|64)$/u.test(family)) {
			const size = family.slice('batch-'.length);
			requireScenario(`batch-create-${size}.preview`, expected.batch);
			requireScenario(`batch-create-${size}.apply`, expected.batch);
			const workflows = evidence?.agentWorkflowSamples?.[`batch-create-${size}`];
			if (!Array.isArray(workflows) || workflows.length !== expected.batch) {
				failures.push(`${label}:batch-create-${size}:workflow-count-mismatch`);
			}
		} else if (family === 'human-compact-create' || family === 'human-exact-update') {
			const key = family === 'human-compact-create' ? 'create' : 'update';
			const workflow = evidence?.humanOneLineWorkflows?.[key];
			const values = evidence?.humanOneLineSamples?.[key];
			if (
				workflow?.attempts !== expected.warm
				|| workflow.successes !== expected.warm
				|| !Array.isArray(values)
				|| values.length !== expected.warm
			) {
				failures.push(`${label}:human-${key}:sample-count-mismatch`);
			}
		}
	}
	return failures;
}

function parseStage3Options(args) {
	const full = args.includes('--full');
	const refreshBaseline = args.includes('--refresh-baseline');
	const target = args.includes('--target');
	const includeJsonl = args.includes('--jsonl');
	const families = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--family') {
			const family = args[index + 1];
			if (!family || family.startsWith('--')) {
				throw new Error('--family requires one family name.');
			}
			families.push(family);
			index += 1;
			continue;
		}
		if (!['--full', '--refresh-baseline', '--target', '--jsonl'].includes(argument)) {
			throw new Error(`Unknown Stage 3 argument: ${argument}`);
		}
	}
	if (!target && (families.length > 0 || includeJsonl)) {
		throw new Error('--family and --jsonl require --target.');
	}
	if (target && families.length === 0) {
		throw new Error('Targeted Stage 3 collection requires at least one --family.');
	}
	if (full) {
		return {
			refreshBaseline,
			target,
			includeJsonl,
			families,
			profile: {
				evidence: {
					name: 'full',
					cold: 10,
					warm: 30,
					warmup: 3,
					batch: 20,
					batchWarmup: 3,
					fileUpdate: 100,
					sessionWarm: 100,
					sessionThroughput: 100,
					sessionLeak: 1000,
				},
				collectorEnvironment: {
					OPERON_CLI_SPEED_COLD_SAMPLES: '10',
					OPERON_CLI_SPEED_WARM_SAMPLES: '30',
					OPERON_CLI_SPEED_WARMUPS: '3',
					OPERON_CLI_SPEED_BATCH_SAMPLES: '20',
					OPERON_CLI_SPEED_BATCH_WARMUPS: '3',
					OPERON_CLI_SPEED_FILE_UPDATE_SAMPLES: '100',
				},
				sessionEnvironment: {
					OPERON_CLI_SPEED_SESSION_WARMUPS: '3',
					OPERON_CLI_SPEED_SESSION_WARM_SAMPLES: '100',
					OPERON_CLI_SPEED_SESSION_THROUGHPUT_SAMPLES: '100',
					OPERON_CLI_SPEED_SESSION_LEAK_SAMPLES: '1000',
				},
			},
		};
	}
	return {
		refreshBaseline,
		target,
		includeJsonl,
		families,
		profile: {
			evidence: {
				name: 'standard',
				cold: 5,
				warm: 20,
				warmup: 2,
				batch: 10,
				batchWarmup: 2,
				fileUpdate: 75,
				sessionWarm: 75,
				sessionThroughput: 75,
				sessionLeak: 300,
			},
			collectorEnvironment: {
				OPERON_CLI_SPEED_COLD_SAMPLES: '5',
				OPERON_CLI_SPEED_WARM_SAMPLES: '20',
				OPERON_CLI_SPEED_WARMUPS: '2',
				OPERON_CLI_SPEED_BATCH_SAMPLES: '10',
				OPERON_CLI_SPEED_BATCH_WARMUPS: '2',
				OPERON_CLI_SPEED_FILE_UPDATE_SAMPLES: '75',
			},
			sessionEnvironment: {
				OPERON_CLI_SPEED_SESSION_WARMUPS: '2',
				OPERON_CLI_SPEED_SESSION_WARM_SAMPLES: '75',
				OPERON_CLI_SPEED_SESSION_THROUGHPUT_SAMPLES: '75',
				OPERON_CLI_SPEED_SESSION_LEAK_SAMPLES: '300',
			},
		},
	};
}

function qualificationMatchesProfile(evidence, profile, sealedBaseline) {
	const counts = evidence?.collection?.counts;
	return counts?.cold === profile.evidence.cold
		&& counts.warm === profile.evidence.warm
		&& counts.warmup === profile.evidence.warmup
		&& counts.batch === profile.evidence.batch
		&& counts.batchWarmup === profile.evidence.batchWarmup
		&& evidence?.fileUpdateCharacterization?.attempts === profile.evidence.fileUpdate
		&& evidence?.artifacts?.production?.sha256 === fileArtifact(sealedBaseline.production).sha256
		&& evidence?.artifacts?.probe?.sha256 === fileArtifact(sealedBaseline.probe).sha256
		&& evidence?.artifacts?.cli?.sha256 === fileArtifact(sealedBaseline.cli).sha256;
}

function installArtifacts(artifacts) {
	const expected = {
		production: fileArtifact(artifacts.production),
		probe: fileArtifact(artifacts.probe),
	};
	atomicWriteJson(swapMarkerPath, { startedAt: new Date().toISOString(), expected });
	atomicCopyFile(artifacts.production, productionPath);
	atomicCopyFile(artifacts.probe, probePath);
	assert.equal(fileArtifact(productionPath).sha256, expected.production.sha256);
	assert.equal(fileArtifact(probePath).sha256, expected.probe.sha256);
	rmSync(swapMarkerPath, { force: true });
}

function atomicCopyFile(source, destination) {
	const temporary = `${destination}.stage3-${process.pid}`;
	rmSync(temporary, { force: true });
	copyFileSync(source, temporary);
	const descriptor = openSync(temporary, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, destination);
	fsyncDirectory(path.dirname(destination));
}

function atomicWriteJson(destination, value) {
	mkdirSync(path.dirname(destination), { recursive: true });
	const temporary = `${destination}.stage3-${process.pid}`;
	rmSync(temporary, { force: true });
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	const descriptor = openSync(temporary, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	renameSync(temporary, destination);
	fsyncDirectory(path.dirname(destination));
}

function fsyncDirectory(directory) {
	const descriptor = openSync(directory, 'r');
	try {
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}

function artifactSet(value) {
	return Object.fromEntries(Object.entries(value).map(([label, filePath]) => [
		label,
		fileArtifact(filePath),
	]));
}

function fileArtifact(filePath) {
	const bytes = readFileSync(filePath);
	return {
		path: filePath,
		bytes: statSync(filePath).size,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function runRequired(command, args) {
	const run = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 64 * 1_024 * 1_024,
	});
	assert.equal(run.status, 0, run.stderr || run.stdout || `${command} failed.`);
}
