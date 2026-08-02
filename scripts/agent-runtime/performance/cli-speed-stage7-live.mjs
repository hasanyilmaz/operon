#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { arch, hostname, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

import {
	assertCliSpeedStage1Vault,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';
import {
	evaluateStage7Evidence,
	STAGE7_CHECKPOINT_PATH,
	STAGE7_MAIN_JS_BASELINE_BYTES,
	STAGE7_PROFILE,
	STAGE7_REQUIRED_UNITS,
	STAGE7_RESULT_PATH,
} from './cli-speed-stage7-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const checkpointDirectory = path.dirname(STAGE7_CHECKPOINT_PATH);
const workerPath = path.join(scriptDirectory, 'cli-speed-stage7-session.mjs');
const corePath = path.join(scriptDirectory, 'cli-speed-stage7-core.mjs');
const candidateCli = await requirePublishedCliExecutable(pluginRoot);
const candidatePlugin = path.join(pluginRoot, 'main.js');
const probePlugin = path.join(pluginRoot, 'build/agent-runtime-probe/main.js');
const stage6Evidence =
	'/private/tmp/operon-agent-runtime-results/cli-speed-stage6.json';
const unitRevisions = Object.freeze({
	probe: 1,
	'compact-update-single': 1,
	'compact-update-5': 1,
	'compact-update-20': 1,
	'compact-update-64': 1,
	'mixed-workflow': 1,
	soak: 1,
});

let evidence = null;
let executionError = null;
let cleanupEvidence = null;
try {
	assert.deepEqual(process.argv.slice(2), [], 'Stage 7 live runner accepts no arguments.');
	assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
	mkdirSync(checkpointDirectory, { recursive: true });
	buildArtifacts();
	for (const target of [
		candidateCli, candidatePlugin, probePlugin, workerPath, corePath, stage6Evidence,
	]) assert.equal(existsSync(target), true, `Missing Stage 7 dependency: ${target}`);

	const identity = buildIdentity();
	const checkpoint = loadCheckpoint(identity);
	for (const unit of STAGE7_REQUIRED_UNITS) {
	const dependency = dependencyDigest(unit, identity);
	if (validUnit(checkpoint.units[unit], dependency)) continue;
	const result = runUnit(unit);
	checkpoint.units[unit] = {
		status: result.status === 0 ? 'passed' : 'failed',
		recordedAt: new Date().toISOString(),
		dependencyDigest: dependency,
		evidencePath: result.path,
		evidenceDigest: existsSync(result.path) ? sha256File(result.path) : null,
		...(result.status === 0 ? {} : {
			failure: {
				exitCode: result.status,
				reason: result.reason,
				stdout: result.stdout.slice(-8192),
				stderr: result.stderr.slice(-8192),
			},
		}),
	};
	checkpoint.revision += 1;
	atomicWriteJson(STAGE7_CHECKPOINT_PATH, checkpoint);
		if (result.status !== 0) break;
	}

	const missing = STAGE7_REQUIRED_UNITS.filter(unit => (
	!validUnit(checkpoint.units[unit], dependencyDigest(unit, identity))
	));
	const units = Object.fromEntries(STAGE7_REQUIRED_UNITS.map(unit => [
	unit,
	missing.includes(unit)
		? { status: 'missing' }
		: readJson(checkpoint.units[unit].evidencePath),
	]));
	const gateInput = {
	probe: units.probe,
	compactUpdateSingle: units['compact-update-single'],
	compactUpdate5: units['compact-update-5'],
	compactUpdate20: units['compact-update-20'],
	compactUpdate64: units['compact-update-64'],
	mixedWorkflow: units['mixed-workflow'],
	soak: units.soak,
	bundle: { candidateBytes: statSync(candidatePlugin).size },
	};
	const gates = evaluateStage7Evidence(gateInput);
	const failedUnits = failedCheckpointUnits(gates.failures);
	for (const unit of failedUnits) {
		const checkpointUnit = checkpoint.units[unit];
		if (!checkpointUnit) continue;
		checkpoint.units[unit] = {
			...checkpointUnit,
			status: 'failed',
			failure: {
				exitCode: 1,
				reason: 'stage7-unit-gate-failed',
				gates: gates.failures.filter(failure => failure.startsWith(`${unit}:`)),
			},
		};
	}
	if (failedUnits.size > 0) {
		checkpoint.revision += 1;
		atomicWriteJson(STAGE7_CHECKPOINT_PATH, checkpoint);
	}
	evidence = {
	schemaVersion: 1,
	suite: 'operon-cli-speed-stage7',
	status: missing.length === 0 && gates.ok ? 'passed' : 'failed',
	recordedAt: new Date().toISOString(),
	vaultPath: CLI_SPEED_STAGE1_VAULT,
	profile: STAGE7_PROFILE,
	identity,
	checkpoint: {
		path: STAGE7_CHECKPOINT_PATH,
		revision: checkpoint.revision,
	},
	units,
	bundle: {
		baselineBytes: STAGE7_MAIN_JS_BASELINE_BYTES,
		candidateBytes: statSync(candidatePlugin).size,
		signedDeltaBytes: statSync(candidatePlugin).size - STAGE7_MAIN_JS_BASELINE_BYTES,
	},
	gates,
	...(missing.length > 0 ? { incompleteUnits: missing } : {}),
	};
} catch (error) {
	executionError = error;
} finally {
	const cleanup = spawnSync(process.execPath, [workerPath, '--cleanup'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CLI_STAGE7_CANDIDATE: candidateCli,
		},
		maxBuffer: 32 * 1024 * 1024,
		timeout: 10 * 60_000,
	});
	cleanupEvidence = {
		status: cleanup.status === 0 ? 'passed' : 'failed',
		exitCode: cleanup.status ?? 1,
	};
	if (cleanup.status !== 0) process.stderr.write(
		`Stage 7 production cleanup failed:\n${cleanup.stderr || cleanup.stdout}\n`,
	);
}

if (evidence) {
	evidence.cleanup = cleanupEvidence;
	if (cleanupEvidence?.status !== 'passed') {
		evidence.status = 'failed';
		evidence.gates = {
			ok: false,
			failures: [...new Set([
				...(evidence.gates?.failures ?? []),
				'cleanup:production-restore-required',
			])],
		};
	}
	atomicWriteJson(STAGE7_RESULT_PATH, evidence);
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
	if (evidence.status !== 'passed') process.exitCode = 1;
}
if (executionError) {
	process.exitCode = 1;
	throw executionError;
}

function buildArtifacts() {
	for (const args of [
		['esbuild.config.mjs', 'production'],
		['esbuild.config.mjs', 'production-agent-runtime-probe'],
	]) {
		const result = spawnSync(process.execPath, args, {
			cwd: pluginRoot,
			encoding: 'utf8',
			env: cleanBuildEnv(),
			maxBuffer: 32 * 1024 * 1024,
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
}

function cleanBuildEnv() {
	const env = { ...process.env };
	delete env.OPERON_CLI_PERSISTENT_READ_BUILD;
	delete env.OPERON_CLI_FRAME_TIMING_BUILD;
	return env;
}

function runUnit(unit) {
	const destination = path.join(checkpointDirectory, `${unit}.json`);
	const result = spawnSync(process.execPath, [workerPath, '--unit', unit], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CLI_STAGE7_CANDIDATE: candidateCli,
			OPERON_CLI_STAGE7_RESULT_PATH: destination,
		},
		maxBuffer: 32 * 1024 * 1024,
		timeout: unit === 'soak' ? 20 * 60_000 : 10 * 60_000,
	});
	return {
		status: result.status ?? 1,
		path: destination,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		reason: result.error?.message ?? (
			result.status === 0 ? null : 'stage7-worker-failed'
		),
	};
}

function buildIdentity() {
	const members = {
		candidateCli: sha256File(candidateCli),
		candidatePlugin: sha256File(candidatePlugin),
		probePlugin: sha256File(probePlugin),
		harness: sha256File(workerPath),
		core: sha256File(corePath),
		runner: sha256File(fileURLToPath(import.meta.url)),
		fixtureGenerator: sha256File(path.join(
			pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs',
		)),
		stage6Evidence: sha256File(stage6Evidence),
		vaultRealpath: realpathSync(CLI_SPEED_STAGE1_VAULT),
		profileDigest: sha256Json(STAGE7_PROFILE),
		node: process.version,
		platform: `${platform()}-${release()}-${arch()}`,
		host: hostname(),
	};
	return { ...members, digest: sha256Json(members) };
}

function dependencyDigest(unit, identity) {
	const shared = {
		candidateCli: identity.candidateCli,
		candidatePlugin: identity.candidatePlugin,
		harness: identity.harness,
		fixtureGenerator: identity.fixtureGenerator,
		vaultRealpath: identity.vaultRealpath,
		profileDigest: identity.profileDigest,
		node: identity.node,
		platform: identity.platform,
		host: identity.host,
	};
	return sha256Json({
		unit,
		unitRevision: unitRevisions[unit],
		shared,
		...(unit === 'probe' ? { probePlugin: identity.probePlugin } : {}),
		...(unit === 'compact-update-single'
			? { stage6Evidence: identity.stage6Evidence }
			: {}),
	});
}

function loadCheckpoint(identity) {
	if (!existsSync(STAGE7_CHECKPOINT_PATH)) {
		return {
			schemaVersion: 1,
			suite: 'operon-cli-speed-stage7',
			identityDigest: identity.digest,
			revision: 0,
			units: {},
		};
	}
	const value = readJson(STAGE7_CHECKPOINT_PATH);
	if (value?.suite !== 'operon-cli-speed-stage7') {
		return {
			schemaVersion: 1,
			suite: 'operon-cli-speed-stage7',
			identityDigest: identity.digest,
			revision: Number(value?.revision ?? 0) + 1,
			units: {},
		};
	}
	return {
		...value,
		identityDigest: identity.digest,
	};
}

function failedCheckpointUnits(failures) {
	const labels = new Map([
		['probe', 'probe'],
		['compact-update-single', 'compact-update-single'],
		['compact-update-5', 'compact-update-5'],
		['compact-update-20', 'compact-update-20'],
		['compact-update-64', 'compact-update-64'],
		['mixed-workflow', 'mixed-workflow'],
		['soak', 'soak'],
	]);
	const failed = new Set();
	for (const failure of failures) {
		const prefix = failure.split(':', 1)[0];
		const unit = labels.get(prefix);
		if (unit) failed.add(unit);
	}
	return failed;
}

function validUnit(value, dependency) {
	return value?.status === 'passed'
		&& value?.dependencyDigest === dependency
		&& typeof value?.evidencePath === 'string'
		&& existsSync(value.evidencePath)
		&& value?.evidenceDigest === sha256File(value.evidencePath);
}

function readJson(target) {
	return JSON.parse(readFileSync(target, 'utf8'));
}

function atomicWriteJson(destination, value) {
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

function sha256File(target) {
	return createHash('sha256').update(readFileSync(target)).digest('hex');
}

function sha256Json(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
