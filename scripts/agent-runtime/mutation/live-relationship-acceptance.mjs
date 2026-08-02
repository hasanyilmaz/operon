#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
const phase = process.argv[2] ?? 'run';
const requestedVault = process.argv[3] ?? path.join(
	expectedTempRoot,
	'cli-test-vault',
);
const vaultPath = realpathSync(requestedVault);
const vaultStat = lstatSync(vaultPath);
assert.equal(vaultStat.isDirectory(), true, 'Relationship acceptance target must be a directory.');
assert.equal(vaultStat.isSymbolicLink(), false, 'Relationship acceptance target cannot be a symlink.');
assert.equal(path.dirname(vaultPath), expectedTempRoot, 'Relationship acceptance target must stay in temp.');
assert.equal(
	path.basename(vaultPath),
	'cli-test-vault',
	'Relationship acceptance target must be the reusable CLI test vault.',
);
assert.ok(
	['run', 'happy', 'prepare', 'recover'].includes(phase),
	'Expected run, happy, prepare or recover phase.',
);

const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const durableConfigRoot = path.join(expectedTempRoot, 'operon-a11-relationship-recovery-cli');
const statePath = path.join(expectedTempRoot, 'operon-a11-relationship-recovery-state.json');

if (phase === 'run') {
	const productionAcceptance = Boolean(process.env.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT);
	if (productionAcceptance) {
		resetSanitizedVault(true);
		waitForReadyRuntime();
	}
	const happy = runPhase('happy');
	if (productionAcceptance) {
		resetSanitizedVault(false);
		waitForReadyRuntime();
	}
	const prepared = runPhase('prepare');
	const reload = runObsidianLifecycle();
	wait(30_500);
	const recovered = runPhase('recover');
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		happy,
		prepared,
		reload,
		recovered,
	}, null, 2)}\n`);
} else if (phase === 'happy') {
	const configRoot = mkdtempSync(path.join(tmpdir(), 'operon-a11-happy-'));
	let completed = false;
	process.on('exit', () => {
		if (completed) {
			rmSync(configRoot, { recursive: true, force: true });
		} else {
			process.stderr.write(`A11 recovery config retained at ${configRoot}\n`);
		}
	});
	const sourceId = 'inln001';
	const sourceDescription = 'Türkçe görev and English context';

	runHumanUpdate(configRoot, ['--id', sourceId, 'parentTask::file001']);
	assert.equal(readTask(configRoot, sourceId).relationships.parentOperonId, 'file001');
	runHumanUpdate(configRoot, ['--id', sourceId, 'parentTask::gran001']);
	assert.equal(readTask(configRoot, sourceId).relationships.parentOperonId, 'gran001');
	runHumanUpdate(configRoot, ['--id', sourceId, '--clear', 'parentTask']);
	assert.equal(readTask(configRoot, sourceId).relationships.parentOperonId, undefined);

	runHumanUpdate(configRoot, ['--id', sourceId, 'blocking::unrel01']);
	assert.deepEqual(readTask(configRoot, sourceId).relationships.blockingOperonIds, ['unrel01']);
	assert.equal(
		readTask(configRoot, 'unrel01').relationships.blockedByOperonIds.includes(sourceId),
		true,
	);
	runHumanUpdate(configRoot, ['--id', sourceId, '--clear', 'blocking']);
	assert.deepEqual(readTask(configRoot, sourceId).relationships.blockingOperonIds, []);
	assert.equal(
		readTask(configRoot, 'unrel01').relationships.blockedByOperonIds.includes(sourceId),
		false,
	);

	runHumanUpdate(configRoot, ['--description', sourceDescription, 'blockedBy::recpar1']);
	assert.deepEqual(readTask(configRoot, sourceId).relationships.blockedByOperonIds, ['recpar1']);
	assert.equal(
		readTask(configRoot, 'recpar1').relationships.blockingOperonIds.includes(sourceId),
		true,
	);
	runHumanUpdate(configRoot, ['--id', sourceId, '--clear', 'blockedBy']);
	assert.deepEqual(readTask(configRoot, sourceId).relationships.blockedByOperonIds, []);
	assert.equal(
		readTask(configRoot, 'recpar1').relationships.blockingOperonIds.includes(sourceId),
		false,
	);

	const noChange = runHumanUpdate(configRoot, ['--id', sourceId, '--clear', 'blockedBy']);
	assert.equal(noChange.envelope.ok, true);
	assert.match(JSON.stringify(noChange.envelope), /no-change|No task relationships changed/iu);
	completed = true;
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		vault: path.basename(vaultPath),
		parentSetReparentClear: true,
		blockingReciprocalReplaceClear: true,
		blockedByReciprocalReplaceClear: true,
		exactDescriptionSelector: true,
		localNoChange: true,
	}, null, 2)}\n`);
} else if (phase === 'prepare') {
	rmSync(durableConfigRoot, { recursive: true, force: true });
	rmSync(statePath, { force: true });
	mkdirSync(durableConfigRoot, { recursive: true, mode: 0o700 });
	const source = readTask(durableConfigRoot, 'inln001');
	const preview = runCli(
		durableConfigRoot,
		['mutation', 'preview'],
		{
			contractVersion: 1,
			requestId: `a11-probe-preview-${randomUUID()}`,
			kind: 'mutation-preview',
			clientInstanceId: 'a11-live-relationship-acceptance',
			idempotencyKey: 'a11-probe-relationship-interrupt-v1',
			capability: 'tasks.relationship.preview',
			mutationKind: 'task.relationship',
			target: exactTarget(source),
			spec: {
				operation: 'replace-relationships',
				changes: [{ field: 'blocking', targetOperonIds: ['unrel01'] }],
			},
			authorization: {
				basis: 'user-explicit-request',
				reason: 'A11 probe-build relationship recovery acceptance.',
			},
		},
	);
	const plan = preview.envelope.result?.plan;
	assert.equal(plan?.mutationKind, 'task.relationship');
	assert.equal(plan?.riskLevel, 'routine');
	assert.equal(plan?.requiresConfirmation, false);
	assert.deepEqual(plan?.warnings, []);
	assert.equal(plan?.atomicGroups?.length >= 2, true);
	const planRef = preview.envelope.client?.planRef;
	assert.match(planRef, /^[A-Za-z0-9_-]+$/u);
	const interrupted = runCli(
		durableConfigRoot,
		['plan', 'apply', planRef, '--timeout-ms', '30000'],
		undefined,
		true,
	);
	assert.notEqual(interrupted.exitCode, 0, 'Probe relationship apply must stop after its first write.');
	assert.equal(interrupted.envelope.result?.status, 'outcome-unknown');
	assert.equal(interrupted.envelope.result?.mutationMayHaveApplied, true);
	assert.equal(interrupted.envelope.result?.retryAllowed, false);
	assert.equal(existsSync(path.join(durableConfigRoot, 'plans', `${planRef}.json`)), true);
	const state = { contractVersion: 1, vaultPath, planRef };
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	chmodSync(statePath, 0o600);
	process.stdout.write(`${JSON.stringify({
		status: 'interrupted',
		planRef,
		planFenced: true,
		recoveryOnly: true,
	}, null, 2)}\n`);
} else {
	const state = JSON.parse(readFileSync(statePath, 'utf8'));
	assert.equal(state.contractVersion, 1);
	assert.equal(state.vaultPath, vaultPath);
	const recovered = runCli(
		durableConfigRoot,
		['plan', 'recover', state.planRef, '--timeout-ms', '30000'],
	);
	assert.ok(['applied', 'already-applied'].includes(recovered.envelope.result?.status));
	const source = readTask(durableConfigRoot, 'inln001');
	const target = readTask(durableConfigRoot, 'unrel01');
	assert.equal(source.relationships.blockingOperonIds.includes('unrel01'), true);
	assert.equal(target.relationships.blockedByOperonIds.includes('inln001'), true);
	assert.equal(
		existsSync(path.join(durableConfigRoot, 'plans', `${state.planRef}.json`)),
		true,
		'Terminal relationship recovery must retain its replay tombstone.',
	);
	rmSync(durableConfigRoot, { recursive: true, force: true });
	rmSync(statePath, { force: true });
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		recovery: recovered.envelope.result.status,
		samePlan: true,
		reciprocalDependencyVerified: true,
	}, null, 2)}\n`);
}

function runHumanUpdate(configRoot, args) {
	const result = runCli(configRoot, ['task', 'update', ...args], undefined, true);
	if (result.exitCode === 0) {
		assert.equal(result.envelope.ok, true);
		return result;
	}
	assert.equal(result.exitCode, 5);
	assert.equal(result.envelope.result?.status, 'outcome-unknown');
	assert.equal(result.envelope.result?.retryAllowed, false);
	assert.equal(result.envelope.recovery?.action, 'recover-same-plan');
	assert.equal(result.envelope.recovery?.planRef, result.envelope.client?.planRef);
	const recovered = runCli(configRoot, [
		'plan',
		'recover',
		result.envelope.recovery.planRef,
		'--timeout-ms',
		'30000',
	]);
	assert.ok(['applied', 'already-applied'].includes(recovered.envelope.result?.status));
	return recovered;
}

function runPhase(targetPhase) {
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(import.meta.url), targetPhase, vaultPath],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_PUBLISHED_CLI_EXECUTABLE: cliArtifact,
			},
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return JSON.parse(result.stdout);
}

function runObsidianLifecycle() {
	const reload = spawnSync('obsidian', [
		`vault=${path.basename(vaultPath)}`,
		'command',
		'id=app:reload',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 1_024 * 1_024,
	});
	if (reload.status === 0) return { action: 'reload' };
	const restart = spawnSync('obsidian', [
		`vault=${path.basename(vaultPath)}`,
		'restart',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 1_024 * 1_024,
	});
	assert.equal(restart.status, 0, restart.stderr || restart.stdout || reload.stderr);
	return { action: 'restart' };
}

function resetSanitizedVault(useProductionArtifact) {
	spawnSync('obsidian', [
		`vault=${path.basename(vaultPath)}`,
		'plugin:disable',
		'id=operon',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
	});
	const resetEnvironment = { ...process.env };
	if (!useProductionArtifact) delete resetEnvironment.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT;
	const reset = spawnSync(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		...(useProductionArtifact ? ['--production'] : []),
		vaultPath,
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		env: resetEnvironment,
		maxBuffer: 8 * 1_024 * 1_024,
	});
	assert.equal(reset.status, 0, reset.stderr || reset.stdout);
	const reload = spawnSync('obsidian', [`vault=${path.basename(vaultPath)}`, 'reload'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
	});
	assert.equal(reload.status, 0, reload.stderr || reload.stdout);
	const enable = spawnSync('obsidian', [
		`vault=${path.basename(vaultPath)}`,
		'plugin:enable',
		'id=operon',
		'filter=community',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
		timeout: 10_000,
	});
	assert.equal(
		enable.status === 0 || enable.error?.code === 'ETIMEDOUT',
		true,
		enable.stderr || enable.stdout || enable.error?.message,
	);
}

function waitForReadyRuntime() {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const diagnostics = spawnSync(process.execPath, [
			cliArtifact,
			'diagnostics',
			'--vault',
			vaultPath,
			'--json',
		], {
			cwd: pluginRoot,
			encoding: 'utf8',
			maxBuffer: 4 * 1_024 * 1_024,
		});
		if (diagnostics.status === 0 && diagnostics.stdout.trim()) {
			const envelope = JSON.parse(diagnostics.stdout);
			if (
				envelope.ok === true
				&& envelope.result?.health?.lifecyclePhase === 'ready'
				&& envelope.result?.health?.v8PersistencePhase === 'idle'
			) return;
		}
		wait(250);
	}
	throw new Error('Sanitized relationship Runtime did not become ready after reset.');
}

function wait(milliseconds) {
	const buffer = new SharedArrayBuffer(4);
	Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function readTask(configRoot, operonId) {
	const result = runCli(configRoot, ['task', 'get'], {
		contractVersion: 1,
		requestId: `a11-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: [],
	});
	assert.equal(result.envelope.result?.ok, true, `Task ${operonId} must be live-readable.`);
	return result.envelope.result.task;
}

function exactTarget(task) {
	return {
		operonId: task.identity.operonId,
		locator: task.locator,
	};
}

function runCli(configRoot, command, input, allowFailure = false) {
	const localCommand = command[0] === 'plan';
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			...(localCommand ? [] : ['--vault', vaultPath]),
			...(input === undefined ? [] : ['--input', '-']),
			'--json',
		],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_CONFIG_HOME: configRoot,
			},
			...(input === undefined ? {} : { input: `${JSON.stringify(input)}\n` }),
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	if (!allowFailure) {
		assert.equal(result.status, 0, result.stderr || result.stdout || 'Operon CLI failed.');
	}
	assert.match(result.stdout, /\S/u, result.stderr || 'Operon CLI returned no JSON.');
	return {
		exitCode: result.status,
		envelope: JSON.parse(result.stdout),
	};
}
