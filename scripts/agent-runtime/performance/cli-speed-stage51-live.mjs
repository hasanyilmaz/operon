#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	closeSync,
	constants,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { arch, hostname, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertCliSpeedStage1Vault,
	CLI_SPEED_STAGE1_VAULT,
} from './cli-speed-stage1-core.mjs';
import {
	evaluateStage51Evidence,
	STAGE51_PROFILE,
	STAGE51_REQUIRED_UNITS,
} from './cli-speed-stage51-core.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resultsRoot = '/private/tmp/operon-agent-runtime-results';
const checkpointDirectory = path.join(resultsRoot, 'stage51-close');
const checkpointPath = path.join(checkpointDirectory, 'checkpoint.json');
const finalPath = path.join(resultsRoot, 'cli-speed-stage51.json');
const workerPath = path.join(scriptDirectory, 'cli-speed-stage51-session.mjs');
const installedPluginPath = path.join(pluginRoot, 'main.js');
const installedCliPath = path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const artifacts = Object.freeze({
	production: path.join(pluginRoot, 'build/stage51/main-promoted.js'),
	productionDisabled: path.join(pluginRoot, 'build/stage51/main-disabled.js'),
	probe: path.join(pluginRoot, 'build/agent-runtime-probe/main.js'),
	feasibility: path.join(pluginRoot, 'build/stage51/main.js'),
	productionCandidate: path.join(pluginRoot, 'build/stage51/main-production.js'),
	cli: path.join(pluginRoot, 'build/stage51/operon-production.mjs'),
	cliProduction: path.join(pluginRoot, 'build/stage51/operon-promoted.mjs'),
	cliTiming: path.join(pluginRoot, 'build/stage51/operon-timing.mjs'),
	cliDisabled: path.join(pluginRoot, 'build/stage51/operon-disabled.mjs'),
	cliBaseline: '/private/tmp/operon-agent-runtime-results/stage5-close/candidate-artifacts/operon.mjs',
});

assert.deepEqual(process.argv.slice(2), [], 'Stage 5.1 live runner accepts no arguments.');
assertCliSpeedStage1Vault(CLI_SPEED_STAGE1_VAULT, { lstatSync, realpathSync });
mkdirSync(checkpointDirectory, { recursive: true });
let identity = null;
let checkpoint = { revision: 0, units: {} };
let evidence;
let promoted = false;
let disabledArtifactsSealed = false;
const phaseActivations = {};
try {
	buildArtifacts();
	for (const artifact of Object.values(artifacts)) {
		assert.equal(existsSync(artifact), true, `Missing Stage 5.1 artifact: ${artifact}`);
	}
	identity = buildIdentity();
	checkpoint = loadCheckpoint(identity);
	installArtifact(artifacts.feasibility, installedPluginPath);
	phaseActivations.feasibility = activatePhase(
		artifacts.feasibility, artifacts.cli, true,
	);
	for (const unit of STAGE51_REQUIRED_UNITS) {
		runCheckpointUnit({ unit, phase: 'feasibility', identity });
		if (checkpoint.units[unit]?.status !== 'passed') break;
	}
	const incomplete = STAGE51_REQUIRED_UNITS.filter(unit => (
		!validUnit(checkpoint.units[unit], unitDependencyDigest(unit, identity))
	));
	if (incomplete.length > 0) throw new Error(`Stage 5.1 incomplete: ${incomplete.join(', ')}`);
	const feasibilityUnits = readUnits('feasibility', STAGE51_REQUIRED_UNITS);
	const feasibilityGates = evaluateStage51Evidence(gateInput(feasibilityUnits));
	if (!feasibilityGates.ok) {
		throw new Error(`Stage 5.1 feasibility gates failed: ${feasibilityGates.failures.join(', ')}`);
	}

	const byteIdenticalPromotion = {
		plugin: sha256File(artifacts.production) === sha256File(artifacts.feasibility),
		candidate: sha256File(artifacts.productionCandidate)
			=== sha256File(artifacts.feasibility),
		cli: sha256File(artifacts.cliProduction) === sha256File(artifacts.cli),
	};
	installArtifact(artifacts.production, installedPluginPath);
	installArtifact(artifacts.cliProduction, installedCliPath);
	phaseActivations.production = activatePhase(
		artifacts.production, artifacts.cliProduction, true,
	);
	const promotionUnitsRequired = (
		byteIdenticalPromotion.plugin
		&& byteIdenticalPromotion.candidate
		&& byteIdenticalPromotion.cli
	)
		? ['promotion-smoke']
		: ['parity', 'throughput', 'soak', 'mutation-isolation', 'negative-tests'];
	for (const unit of promotionUnitsRequired) {
		runCheckpointUnit({ unit, phase: 'production', identity });
		if (checkpoint.units[`production:${unit}`]?.status !== 'passed') break;
	}
	const incompleteProduction = promotionUnitsRequired.filter(unit => (
		!validUnit(
			checkpoint.units[`production:${unit}`],
			unitDependencyDigest(unit, identity, 'production'),
		)
	));
	if (incompleteProduction.length > 0) {
		throw new Error(`Stage 5.1 production incomplete: ${incompleteProduction.join(', ')}`);
	}
	const productionUnits = readUnits('production', promotionUnitsRequired);
	const productionGates = promotionUnitsRequired.length === 1
		? evaluatePromotionSmoke(productionUnits['promotion-smoke'])
		: evaluateStage51Evidence({
			...gateInput(feasibilityUnits),
			parity: productionUnits.parity,
			throughput: productionUnits.throughput,
			soak: productionUnits.soak,
			mutationIsolation: productionUnits['mutation-isolation'],
			negativeTests: productionUnits['negative-tests'],
		});
	promoted = productionGates.ok;
	evidence = {
		schemaVersion: 2,
		suite: 'operon-cli-speed-stage51',
		status: promoted ? 'passed' : 'failed',
		recordedAt: new Date().toISOString(),
		vaultPath: CLI_SPEED_STAGE1_VAULT,
		profile: STAGE51_PROFILE,
		identity,
		checkpoint: { path: checkpointPath, revision: checkpoint.revision },
		artifacts: artifactEvidence(),
		phaseActivations,
		feasibility: { units: feasibilityUnits, gates: feasibilityGates },
		productionPromotion: {
			eligible: true,
			promoted,
			byteIdenticalPromotion,
			validationProfile: promotionUnitsRequired.length === 1
				? 'digest-bound-short-smoke'
				: 'telemetry-free-5-75-300',
			scope: ['session-jsonl:health', 'session-jsonl:task.get', 'session-jsonl:context.build'],
			publicContractChanged: false,
			units: productionUnits,
			gates: productionGates,
		},
	};
} catch (error) {
	evidence = {
		schemaVersion: 2,
		suite: 'operon-cli-speed-stage51',
		status: 'failed',
		recordedAt: new Date().toISOString(),
		vaultPath: CLI_SPEED_STAGE1_VAULT,
		profile: STAGE51_PROFILE,
		identity,
		checkpoint: { path: checkpointPath, revision: checkpoint.revision },
		reason: error instanceof Error ? error.message : String(error),
	};
} finally {
	if (!promoted) {
		try {
			assert.equal(
				disabledArtifactsSealed,
				true,
				'Stage 5.1 disabled rollback artifacts were not sealed.',
			);
			installArtifact(
				artifacts.productionDisabled,
				installedPluginPath,
			);
			installArtifact(
				artifacts.cliDisabled,
				installedCliPath,
			);
			evidence.rollback = restoreDisabledVault();
		} catch (rollbackError) {
			evidence.status = 'failed';
			evidence.rollback = {
				status: 'failed',
				reason: rollbackError instanceof Error
					? rollbackError.message
					: String(rollbackError),
			};
		}
	}
}
atomicWriteJson(finalPath, evidence);
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!promoted) process.exitCode = 1;

function runUnit(unit, phase = 'feasibility') {
	const destination = path.join(
		checkpointDirectory, `${phase === 'production' ? 'production-' : ''}${unit}.json`,
	);
	const result = spawnSync(process.execPath, [workerPath, '--unit', unit], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			OPERON_CLI_EXECUTABLE: phase === 'production'
				? artifacts.cliProduction
				: artifacts.cli,
			OPERON_CLI_STAGE51_TIMING_EXECUTABLE: artifacts.cliTiming,
			OPERON_CLI_STAGE51_BASELINE_EXECUTABLE: artifacts.cliBaseline,
			OPERON_CLI_STAGE51_RESULT_PATH: destination,
			OPERON_CLI_STAGE51_TIMING_FD: '3',
			...(unit === 'promotion-smoke'
				? { OPERON_CLI_BENCHMARK_TRANSPORT_EVIDENCE: '1' }
				: {}),
		},
		stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
		maxBuffer: 32 * 1024 * 1024,
		timeout: unit === 'soak' ? 20 * 60_000 : 10 * 60_000,
	});
	const status = result.status ?? 1;
	return {
		status,
		path: destination,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		reason: result.error?.message ?? (status === 0 ? null : 'stage51-worker-failed'),
	};
}

function buildArtifacts() {
	const artifactDirectory = path.join(checkpointDirectory, 'artifacts');
	mkdirSync(artifactDirectory, { recursive: true });
	const disabledPluginBuild = spawnSync(process.execPath, [
		'esbuild.config.mjs', 'production-agent-runtime-persistent-read-disabled',
	], {
		cwd: pluginRoot, encoding: 'utf8', env: cleanBuildEnv(),
	});
	assert.equal(
		disabledPluginBuild.status,
		0,
		disabledPluginBuild.stderr || disabledPluginBuild.stdout,
	);
	buildCliArtifact({
		destination: artifacts.cliDisabled,
		persistent: false,
		timing: false,
	});
	disabledArtifactsSealed = true;
	for (const [command, args, env] of [
		[process.execPath, ['esbuild.config.mjs', 'production'], cleanBuildEnv()],
		[process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-probe'], cleanBuildEnv()],
		[process.execPath, ['esbuild.config.mjs', 'production-agent-runtime-transport-feasibility'], cleanBuildEnv()],
		[process.execPath, [
			'esbuild.config.mjs', 'production-agent-runtime-persistent-read-candidate',
		], cleanBuildEnv()],
	]) {
		const result = spawnSync(command, args, {
			cwd: pluginRoot, encoding: 'utf8', env,
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	copyFileSync(installedPluginPath, artifacts.production);
	copyFileSync(artifacts.productionDisabled, path.join(artifactDirectory, 'main-disabled.js'));
	assert.equal(
		existsSync(artifacts.cliBaseline),
		true,
		'Sealed Stage 5 CLI baseline is required for Stage 5.1 comparisons.',
	);
	mkdirSync(path.dirname(artifacts.cliTiming), { recursive: true });
	buildCliArtifact({
		destination: artifacts.cli,
		persistent: true,
		timing: false,
	});
	buildCliArtifact({
		destination: artifacts.cliTiming,
		persistent: true,
		timing: true,
	});
	buildCliArtifact({
		destination: artifacts.cliProduction,
		persistent: undefined,
		timing: false,
	});
}

function buildIdentity() {
	const fixtureDigest = sha256Json({
		generator: sha256File(path.join(
			pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs',
		)),
		settings: sha256File(path.join(
			pluginRoot, 'scripts/agent-runtime/sanitized-vault-settings.ts',
		)),
		profile: sha256File(path.join(
			pluginRoot, 'scripts/agent-runtime/fixtures/sanitized-profile.json',
		)),
	});
	const members = {
		production: sha256File(artifacts.production),
		productionDisabled: sha256File(artifacts.productionDisabled),
		probe: sha256File(artifacts.probe),
		feasibility: sha256File(artifacts.feasibility),
		productionCandidate: sha256File(artifacts.productionCandidate),
		cli: sha256File(artifacts.cli),
		cliProduction: sha256File(artifacts.cliProduction),
		cliTiming: sha256File(artifacts.cliTiming),
		cliDisabled: sha256File(artifacts.cliDisabled),
		cliBaseline: sha256File(artifacts.cliBaseline),
		harness: sha256File(workerPath),
		core: sha256File(path.join(scriptDirectory, 'cli-speed-stage51-core.mjs')),
		runner: sha256File(fileURLToPath(import.meta.url)),
		fixtureDigest,
		vaultRealpath: realpathSync(CLI_SPEED_STAGE1_VAULT),
		obsidianSessionDigest: obsidianSessionDigest(),
		node: process.version,
		platform: `${platform()}-${release()}-${arch()}`,
		host: hostname(),
	};
	return { ...members, digest: sha256Json(members) };
}

function loadCheckpoint(expectedIdentity) {
	if (!existsSync(checkpointPath)) {
		return {
			schemaVersion: 2,
			kind: 'operon-cli-stage51-checkpoint',
			identity: expectedIdentity,
			revision: 0,
			units: {},
		};
	}
	const value = readJson(checkpointPath);
	if (
		value?.kind === 'operon-cli-stage51-checkpoint'
		&& value?.schemaVersion === 2
	) return { ...value, identity: expectedIdentity };
	renameSync(checkpointPath, `${checkpointPath}.stale-${Date.now()}`);
	return {
		schemaVersion: 2,
		kind: 'operon-cli-stage51-checkpoint',
		identity: expectedIdentity,
		revision: 0,
		units: {},
	};
}

function validUnit(unit, expectedDependencyDigest) {
	return unit?.status === 'passed'
		&& unit?.dependencyDigest === expectedDependencyDigest
		&& typeof unit?.evidencePath === 'string'
		&& existsSync(unit.evidencePath)
		&& unit.evidenceDigest === sha256File(unit.evidencePath);
}

function artifactEvidence() {
	return Object.fromEntries(Object.entries(artifacts).map(([name, target]) => [
		name, { path: target, bytes: statSync(target).size, sha256: sha256File(target) },
	]));
}

function runCheckpointUnit({ unit, phase, identity, force = false }) {
	const key = phase === 'production' ? `production:${unit}` : unit;
	const dependencyDigest = unitDependencyDigest(unit, identity, phase);
	if (!force && validUnit(checkpoint.units[key], dependencyDigest)) return;
	const result = runUnit(unit, phase);
	checkpoint.units[key] = {
		status: result.status === 0 ? 'passed' : 'failed',
		recordedAt: new Date().toISOString(),
		evidencePath: result.path,
		evidenceDigest: existsSync(result.path) ? sha256File(result.path) : null,
		dependencyDigest,
		phase,
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
	atomicWriteJson(checkpointPath, checkpoint);
}

function unitDependencyDigest(unit, identity, phase = 'feasibility') {
	const common = {
		unit,
		phase,
		fixtureDigest: identity.fixtureDigest,
		harness: identity.harness,
		core: identity.core,
		vaultRealpath: identity.vaultRealpath,
		obsidianSessionDigest: identity.obsidianSessionDigest,
		plugin: phase === 'production'
			? identity.production
			: identity.feasibility,
		cli: phase === 'production' ? identity.cliProduction : identity.cli,
	};
	if (unit === 'timed' || unit === 'overhead') common.cliTiming = identity.cliTiming;
	if (unit === 'throughput' || unit === 'parity') common.cliBaseline = identity.cliBaseline;
	if (unit === 'negative-tests') common.runner = identity.runner;
	return sha256Json(common);
}

function readUnits(phase, units) {
	return Object.fromEntries(units.map(unit => [
		unit,
		readJson(path.join(
			checkpointDirectory,
			`${phase === 'production' ? 'production-' : ''}${unit}.json`,
		)),
	]));
}

function gateInput(units) {
	return {
		parity: units.parity,
		timed: units.timed,
		throughput: units.throughput,
		overhead: units.overhead,
		soak: units.soak,
		mutationIsolation: units['mutation-isolation'],
		negativeTests: units['negative-tests'],
	};
}

function evaluatePromotionSmoke(smoke) {
	const failures = [];
	for (const family of ['health', 'task.get', 'context.build']) {
		if (
			smoke?.reads?.[family]?.attempts !== 1
			|| smoke?.reads?.[family]?.successes !== 1
		) failures.push(`promotion-smoke:${family}:1-of-1-required`);
	}
	if (
		smoke?.persistentReads !== 3
		|| smoke?.readFallbacks !== 0
		|| smoke?.readTransportEvidence?.length !== 3
	) failures.push('promotion-smoke:three-persistent-reads-without-fallback-required');
	for (const family of ['compact-create', 'exact-update']) {
		const mutation = smoke?.mutationIsolation?.families?.[family];
		if (
			mutation?.attempts !== 1
			|| mutation?.successes !== 1
			|| mutation?.requestFileDispatches !== 1
			|| mutation?.persistentDispatches !== 0
			|| mutation?.observedRuntimeDispatches !== 3
			|| mutation?.expectedRuntimeDispatches !== 3
			|| mutation?.observedMutationDispatches !== 2
			|| !Array.isArray(mutation?.transportSelections)
			|| mutation.transportSelections.some(value => (
				value.transport === 'persistent'
				&& !['health', 'task.get', 'context.build'].includes(value.command)
			))
			|| mutation?.verifiedPostflight !== 1
		) failures.push(`promotion-smoke:${family}:verified-request-file-required`);
	}
	return { ok: failures.length === 0, failures };
}

function buildCliArtifact({ destination, persistent, timing }) {
	const env = {
		...cleanBuildEnv(),
		OPERON_CLI_FRAME_TIMING_BUILD: timing ? '1' : '0',
	};
	if (persistent !== undefined) {
		env.OPERON_CLI_PERSISTENT_READ_BUILD = persistent ? '1' : '0';
	}
	const result = spawnSync(process.execPath, ['packages/operon-cli/build.mjs'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	copyFileSync(path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs'), destination);
}

function cleanBuildEnv() {
	const env = { ...process.env };
	delete env.OPERON_CLI_PERSISTENT_READ_BUILD;
	delete env.OPERON_CLI_FRAME_TIMING_BUILD;
	delete env.OPERON_AGENT_RUNTIME_PERSISTENT_READ_BUILD;
	return env;
}

function installArtifact(source, destination) {
	const temporary = `${destination}.stage51-${process.pid}`;
	copyFileSync(source, temporary);
	renameSync(temporary, destination);
	assert.equal(sha256File(destination), sha256File(source));
}

function activatePhase(pluginArtifact, cliArtifact, expectEndpoint) {
	assert.equal(
		sha256File(installedPluginPath),
		sha256File(pluginArtifact),
		'Stage 5.1 phase activation source is not installed at plugin root.',
	);
	for (const [command, args] of [
		['obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon']],
		[process.execPath, [
			path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
			'--production', '--allow-active-vault-ephemera', CLI_SPEED_STAGE1_VAULT,
		]],
		['obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']],
	]) {
		const result = spawnSync(command, args, { cwd: pluginRoot, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	const installedBundle = path.join(
		CLI_SPEED_STAGE1_VAULT, '.obsidian/plugins/operon/main.js',
	);
	assert.equal(
		sha256File(installedBundle),
		sha256File(pluginArtifact),
		'Stage 5.1 installed vault bundle digest mismatch.',
	);
	const activationConfig = path.join(checkpointDirectory, 'activation-config');
	mkdirSync(activationConfig, { recursive: true, mode: 0o700 });
	const deadline = Date.now() + 35_000;
	let health = null;
	while (Date.now() < deadline) {
		const result = spawnSync(process.execPath, [
			cliArtifact, 'health', '--vault', CLI_SPEED_STAGE1_VAULT, '--json',
		], {
			cwd: pluginRoot,
			encoding: 'utf8',
			env: { ...process.env, OPERON_CONFIG_HOME: activationConfig },
		});
		if (result.status === 0 && result.stdout.trim()) {
			health = JSON.parse(result.stdout.trim().split('\n').at(-1));
			if (
				health?.ok === true
				&& health?.result?.lifecyclePhase === 'ready'
				&& health?.result?.freshness?.settled === true
			) break;
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
	}
	assert.equal(health?.ok, true, 'Stage 5.1 phase activation health failed.');
	const endpoint = inspectSecureEndpoint();
	assert.equal(Boolean(endpoint), expectEndpoint, 'Stage 5.1 endpoint activation mismatch.');
	return {
		status: 'verified',
		pluginSha256: sha256File(pluginArtifact),
		installedSha256: sha256File(installedBundle),
		cliSha256: sha256File(cliArtifact),
		endpoint,
	};
}

function inspectSecureEndpoint() {
	const uid = process.getuid();
	const endpointRoot = `/private/tmp/operon-agent-runtime-uid-${uid}`;
	if (!existsSync(endpointRoot)) return null;
	const rootStat = lstatSync(endpointRoot);
	assert.equal(rootStat.isSymbolicLink(), false, 'Persistent endpoint root is a symlink.');
	assert.equal(rootStat.isDirectory(), true, 'Persistent endpoint root is not a directory.');
	assert.equal(rootStat.uid, uid, 'Persistent endpoint root owner mismatch.');
	assert.equal(rootStat.mode & 0o777, 0o700, 'Persistent endpoint root mode mismatch.');
	assert.equal(realpathSync(endpointRoot), endpointRoot, 'Persistent endpoint root realpath mismatch.');
	const vaultSha256 = createHash('sha256')
		.update(realpathSync(CLI_SPEED_STAGE1_VAULT))
		.digest('hex');
	const descriptorPath = path.join(endpointRoot, `persistent-read-${vaultSha256}.json`);
	if (!existsSync(descriptorPath)) return null;
	const descriptorStat = lstatSync(descriptorPath);
	assert.equal(descriptorStat.isSymbolicLink(), false, 'Persistent descriptor is a symlink.');
	assert.equal(descriptorStat.isFile(), true, 'Persistent descriptor is not a regular file.');
	assert.equal(descriptorStat.uid, uid, 'Persistent descriptor owner mismatch.');
	assert.equal(descriptorStat.mode & 0o777, 0o600, 'Persistent descriptor mode mismatch.');
	const descriptorFd = openSync(
		descriptorPath,
		constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
	);
	let openedStat;
	try {
		openedStat = fstatSync(descriptorFd);
	} finally {
		closeSync(descriptorFd);
	}
	assert.equal(openedStat.dev, descriptorStat.dev, 'Persistent descriptor dev changed.');
	assert.equal(openedStat.ino, descriptorStat.ino, 'Persistent descriptor inode changed.');
	const descriptor = readJson(descriptorPath);
	assert.equal(descriptor.vaultSha256, vaultSha256, 'Persistent descriptor vault mismatch.');
	assert.equal(typeof descriptor.socketBasename, 'string', 'Persistent socket basename missing.');
	assert.equal(
		path.basename(descriptor.socketBasename),
		descriptor.socketBasename,
		'Persistent socket basename escaped endpoint root.',
	);
	const socketPath = path.join(endpointRoot, descriptor.socketBasename);
	assert.equal(path.dirname(socketPath), endpointRoot, 'Persistent socket path escaped endpoint root.');
	const socketStat = lstatSync(socketPath);
	assert.equal(socketStat.isSymbolicLink(), false, 'Persistent socket is a symlink.');
	assert.equal(socketStat.isSocket(), true, 'Persistent endpoint target is not a socket.');
	assert.equal(socketStat.uid, uid, 'Persistent socket owner mismatch.');
	assert.equal(socketStat.mode & 0o777, 0o600, 'Persistent socket mode mismatch.');
	return {
		root: { path: endpointRoot, dev: rootStat.dev, ino: rootStat.ino },
		descriptor: {
			path: descriptorPath, dev: descriptorStat.dev, ino: descriptorStat.ino,
		},
		socket: { path: socketPath, dev: socketStat.dev, ino: socketStat.ino },
		serverInstanceId: descriptor.serverInstanceId,
		vaultSha256,
	};
}

function restoreDisabledVault() {
	const endpointBefore = inspectSecureEndpoint();
	for (const [command, args] of [
		['obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon']],
		[process.execPath, [
			path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
			'--production', '--allow-active-vault-ephemera', CLI_SPEED_STAGE1_VAULT,
		]],
		['obsidian', ['vault=cli-test-vault', 'command', 'id=app:reload']],
	]) {
		const result = spawnSync(command, args, { cwd: pluginRoot, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	if (endpointBefore) {
		assert.equal(
			existsSync(endpointBefore.descriptor.path),
			false,
			'Disabled restore left Stage 5.1 descriptor.',
		);
		assert.equal(
			existsSync(endpointBefore.socket.path),
			false,
			'Disabled restore left Stage 5.1 socket.',
		);
	}
	assert.equal(inspectSecureEndpoint(), null, 'Disabled restore published a new endpoint.');
	return { status: 'verified', endpointBefore, endpointAfter: null };
}

function atomicWriteJson(destination, value) {
	const temporary = `${destination}.tmp-${process.pid}`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

function readJson(target) {
	return JSON.parse(readFileSync(target, 'utf8'));
}

function sha256File(target) {
	return createHash('sha256').update(readFileSync(target)).digest('hex');
}

function sha256Json(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function obsidianSessionDigest() {
	const result = spawnSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const obsidian = result.stdout.split('\n').filter(line => /Obsidian\.app/u.test(line)).join('\n');
	return createHash('sha256').update(obsidian).digest('hex');
}
