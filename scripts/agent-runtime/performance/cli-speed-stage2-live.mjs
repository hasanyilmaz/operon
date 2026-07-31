#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	closeSync,
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
	assertAdmissibleStage2Baseline,
	assertFreshStage2CollectorEvidence,
	clearStage2CollectorResult,
} from './cli-speed-stage2-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resultsDirectory = '/private/tmp/operon-agent-runtime-results';
const frozenDirectory = path.join(resultsDirectory, 'stage2-baseline');
const resultPath = path.join(resultsDirectory, 'cli-speed-stage2.json');
const sessionDirectory = mkdtempSync('/private/tmp/operon-cli-speed-stage2-session-');
const baselineResultPath = path.join(resultsDirectory, 'cli-speed-stage2-baseline-session.json');
const baselineWorkingPath = path.join(sessionDirectory, 'baseline-production.json');
const candidateResultPath = path.join(sessionDirectory, 'candidate-production.json');
const artifactSwapMarkerPath = path.join(resultsDirectory, 'cli-speed-stage2-artifact-swap.json');
const productionPath = path.join(pluginRoot, 'main.js');
const probePath = path.join(pluginRoot, 'build/agent-runtime-probe/main.js');
const cliPath = path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const frozen = {
	production: path.join(frozenDirectory, 'main.js'),
	probe: path.join(frozenDirectory, 'main-probe.js'),
	cli: path.join(frozenDirectory, 'operon.mjs'),
	evidence: path.join(frozenDirectory, 'cli-speed-stage1.json'),
};

for (const [label, artifactPath] of Object.entries(frozen)) {
	assert.equal(existsSync(artifactPath), true, `Frozen Stage 1 ${label} is missing: ${artifactPath}`);
}

mkdirSync(resultsDirectory, { recursive: true });
runRequired(process.execPath, ['packages/operon-cli/build.mjs']);
runRequired(process.execPath, ['esbuild.config.mjs', 'production']);
runRequired(process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-probe']);
rmSync(artifactSwapMarkerPath, { force: true });

const candidateSnapshot = {
	production: path.join(sessionDirectory, 'candidate-main.js'),
	probe: path.join(sessionDirectory, 'candidate-main-probe.js'),
	cli: path.join(sessionDirectory, 'candidate-operon.mjs'),
};
copyFileSync(productionPath, candidateSnapshot.production);
copyFileSync(probePath, candidateSnapshot.probe);
copyFileSync(cliPath, candidateSnapshot.cli);

let stage2Error;
try {
	installArtifacts({
		production: frozen.production,
		probe: frozen.probe,
	});
	const baselineEvidence = runCollector({
		result: baselineWorkingPath,
		cli: candidateSnapshot.cli,
		expectedProduction: frozen.production,
		expectedProbe: frozen.probe,
		expectedCli: candidateSnapshot.cli,
	});
	assertAdmissibleStage2Baseline(baselineEvidence);
	copyFileSync(baselineWorkingPath, baselineResultPath);

	installArtifacts(candidateSnapshot);
	runCollector({
		result: candidateResultPath,
		cli: candidateSnapshot.cli,
		expectedProduction: candidateSnapshot.production,
		expectedProbe: candidateSnapshot.probe,
		expectedCli: candidateSnapshot.cli,
		argumentsList: ['--stage2', '--compare', baselineResultPath],
	});

	const baseline = readJson(baselineResultPath);
	const candidate = readJson(candidateResultPath);
	const evidence = {
		...candidate,
		schemaVersion: 2,
		suite: 'operon-cli-speed-stage2',
		stage2: {
			sameSession: true,
			baselineResultPath,
			measurementHarness: {
				cliMode: 'common-candidate-cli',
				reason:
					'Both production legs use the same benchmark-only dispatch observer '
					+ 'so trace I/O cannot appear as a candidate regression.',
				cli: fileArtifact(candidateSnapshot.cli),
			},
			frozenCliComparison: {
				baseline: fileArtifact(frozen.cli),
				candidate: fileArtifact(candidateSnapshot.cli),
				signedByteDelta:
					statSync(candidateSnapshot.cli).size - statSync(frozen.cli).size,
			},
			frozenArtifacts: Object.fromEntries(
				Object.entries(frozen).map(([label, artifactPath]) => [label, fileArtifact(artifactPath)]),
			),
			candidateArtifacts: {
				production: fileArtifact(candidateSnapshot.production),
				probe: fileArtifact(candidateSnapshot.probe),
				cli: fileArtifact(candidateSnapshot.cli),
			},
			comparison: compareScenarios(baseline, candidate),
			baselineGate: baseline.gates,
			candidateGate: candidate.gates,
		},
	};
	writeFileSync(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	if (evidence.gates?.ok !== true) process.exitCode = 1;
} catch (error) {
	stage2Error = error;
} finally {
	try {
		installArtifacts(candidateSnapshot);
	} catch (restoreError) {
		if (stage2Error) {
			throw new AggregateError(
				[stage2Error, restoreError],
				'Stage 2 comparison and candidate artifact restore both failed.',
			);
		}
		throw restoreError;
	}
	rmSync(sessionDirectory, { recursive: true, force: true });
}
if (stage2Error) throw stage2Error;

function installArtifacts(artifacts) {
	const expected = {
		production: fileArtifact(artifacts.production),
		probe: fileArtifact(artifacts.probe),
	};
	writeFileSync(artifactSwapMarkerPath, `${JSON.stringify({
		startedAt: new Date().toISOString(),
		expected,
	})}\n`, 'utf8');
	atomicCopyFile(artifacts.production, productionPath);
	atomicCopyFile(artifacts.probe, probePath);
	assert.equal(fileArtifact(productionPath).sha256, expected.production.sha256);
	assert.equal(fileArtifact(probePath).sha256, expected.probe.sha256);
	rmSync(artifactSwapMarkerPath, { force: true });
}

function atomicCopyFile(source, destination) {
	const temporary = `${destination}.stage2-swap-${process.pid}`;
	rmSync(temporary, { force: true });
	copyFileSync(source, temporary);
	const fileDescriptor = openSync(temporary, 'r');
	try {
		fsyncSync(fileDescriptor);
	} finally {
		closeSync(fileDescriptor);
	}
	renameSync(temporary, destination);
	const directoryDescriptor = openSync(path.dirname(destination), 'r');
	try {
		fsyncSync(directoryDescriptor);
	} finally {
		closeSync(directoryDescriptor);
	}
}

function runCollector({
	result,
	cli,
	expectedProduction,
	expectedProbe,
	expectedCli,
	argumentsList = [],
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
		},
		maxBuffer: 256 * 1_024 * 1_024,
	});
	assert.equal(
		run.status === 0 || (run.status === 1 && existsSync(result)),
		true,
		run.stderr || run.stdout || 'Stage 2 live collector failed.',
	);
	assert.equal(existsSync(result), true, 'Stage 2 collector did not write fresh evidence.');
	return assertFreshStage2CollectorEvidence({
		evidence: readJson(result),
		startedAt,
		expectedProductionSha256: fileArtifact(expectedProduction).sha256,
		expectedProbeSha256: fileArtifact(expectedProbe).sha256,
		expectedCliSha256: fileArtifact(expectedCli).sha256,
	});
}

function compareScenarios(baseline, candidate) {
	const scenarios = {};
	for (const [name, value] of Object.entries(candidate.scenarios ?? {})) {
		const reference = baseline.scenarios?.[name];
		if (!reference) continue;
		scenarios[name] = {
			p50Percent: percentDelta(reference.totalMs?.p50, value.totalMs?.p50),
			p95Percent: percentDelta(reference.totalMs?.p95, value.totalMs?.p95),
			handlerP95Percent: percentDelta(reference.handlerMs?.p95, value.handlerMs?.p95),
		};
	}
	return {
		scenarios,
		batchSpeedups: {
			baseline: baseline.batchSpeedups,
			candidate: candidate.batchSpeedups,
		},
	};
}

function percentDelta(reference, candidate) {
	if (!Number.isFinite(reference) || reference === 0 || !Number.isFinite(candidate)) return null;
	return ((candidate - reference) / reference) * 100;
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
