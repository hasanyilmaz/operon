#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_TRANSACTION_FEATURES = [
	'vault-wide-graph-transaction',
	'compare-aware-compensation',
	'same-plan-safe-continuation',
	'cross-source-reciprocal-dependency',
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
const phase = process.argv[2];
const requestedVault = process.argv[3] ?? path.join(
	expectedTempRoot,
	'operon-agent-runtime-phase1-v1',
);
const vaultPath = realpathSync(requestedVault);
const vaultStat = lstatSync(vaultPath);
assert.equal(vaultStat.isDirectory(), true, 'Live acceptance target must be a directory.');
assert.equal(vaultStat.isSymbolicLink(), false, 'Live acceptance target cannot be a symlink.');
assert.equal(path.dirname(vaultPath), expectedTempRoot, 'Live acceptance target must stay in temp.');
assert.match(path.basename(vaultPath), /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);
assert.ok(['run', 'prepare', 'recover'].includes(phase), 'Expected run, prepare or recover phase.');

const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');
const configRoot = path.join(expectedTempRoot, 'operon-a6-graph-recovery-cli');
const statePath = path.join(expectedTempRoot, 'operon-a6-graph-recovery-state.json');

if (phase === 'run') {
	const before = diagnostics();
	const prepared = runPhase('prepare');
	let restartFallback = false;
	runObsidianLifecycle('reload');
	let after = waitForFreshRuntime(before.sessionId);
	if (!after) {
		restartFallback = true;
		runObsidianLifecycle('restart');
		after = waitForFreshRuntime(before.sessionId);
	}
	assert.ok(after, 'Reload and full restart could not restore the exact ready test vault.');
	wait(30_500);
	const recovered = runPhase('recover');
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		reloadCommandId: 'app:reload',
		restartFallback,
		sessionChanged: before.sessionId !== after.sessionId,
		prepare: prepared,
		recover: recovered,
	}, null, 2)}\n`);
} else if (phase === 'prepare') {
	rmSync(configRoot, { recursive: true, force: true });
	rmSync(statePath, { force: true });
	mkdirSync(configRoot, { recursive: true, mode: 0o700 });

	const manifest = runCli(['manifest']);
	const manifestCreate = manifest.envelope.result?.convenienceContracts?.['task.create'];
	assert.equal(manifestCreate?.graphTransactionVersion, 1);
	assert.deepEqual(manifestCreate?.graphTransactionFeatures, GRAPH_TRANSACTION_FEATURES);
	const catalog = runCli(['catalog']);
	assert.equal(catalog.envelope.result?.policies?.creation?.graphTransactionVersion, 1);
	assert.deepEqual(
		catalog.envelope.result?.policies?.creation?.graphTransactionFeatures,
		GRAPH_TRANSACTION_FEATURES,
	);

	const suffix = randomUUID().slice(0, 8);
	const sourceDescription = `A6 probe dependency source ${suffix}`;
	const targetDescription = `A6 probe dependency target ${suffix}`;
	const preview = runCli(['task', 'create'], {
		contractVersion: 1,
		kind: 'mutation-intent',
		idempotencyKey: 'a6-probe-graph-interrupt-v1',
		reason: 'A6 probe-build durable graph recovery acceptance.',
		spec: {
			operation: 'create',
			items: [{
				itemRef: 'source',
				description: sourceDescription,
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: `Tasks/${sourceDescription}.md`,
				},
				fields: [],
				dependencies: [{
					relation: 'blocks',
					target: { kind: 'created', itemRef: 'target' },
				}],
			}, {
				itemRef: 'target',
				description: targetDescription,
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: `Tasks/${targetDescription}.md`,
				},
				fields: [],
			}],
		},
	});
	assert.equal(preview.envelope.result?.plan?.riskLevel, 'elevated');
	assert.equal(preview.envelope.result?.plan?.requiresConfirmation, true);
	assert.deepEqual(
		preview.envelope.result?.plan?.warnings?.map(warning => warning.code),
		['apply-time-values-projected', 'cross-source-graph-partial-risk'],
	);
	assert.deepEqual(
		preview.envelope.result?.plan?.requiredAcknowledgements,
		['confirm:cross-source-graph-partial-risk'],
	);
	assert.deepEqual(
		preview.envelope.result?.plan?.atomicGroups?.map(group => (
			group.resources.find(resource => resource.resourceKind === 'task-source')?.resourceKey
		)),
		[
			`Tasks/${sourceDescription}.md`,
			`Tasks/${targetDescription}.md`,
		],
	);
	const planRef = preview.envelope.client?.planRef;
	assert.match(planRef, /^[A-Za-z0-9_-]+$/u);
	const shown = runCli(['plan', 'show', planRef]);
	const confirmationToken = shown.envelope.result?.plan?.confirmationToken;
	assert.match(confirmationToken, /^[a-f0-9]{64}$/u);
	const unconfirmed = runCli(
		['plan', 'apply', planRef, '--timeout-ms', '30000'],
		undefined,
		true,
	);
	assert.notEqual(unconfirmed.exitCode, 0);
	assert.equal(unconfirmed.envelope.error?.code, 'plan-confirmation-required');
	const interrupted = runCli(
		['plan', 'apply', planRef, '--confirm', confirmationToken, '--timeout-ms', '30000'],
		undefined,
		true,
	);
	assert.notEqual(interrupted.exitCode, 0, 'Probe apply must be interrupted after its first write.');
	assert.equal(interrupted.envelope.result?.status, 'outcome-unknown');
	assert.equal(interrupted.envelope.result?.mutationMayHaveApplied, true);
	assert.equal(interrupted.envelope.result?.retryAllowed, false);
	assert.equal(existsSync(path.join(configRoot, 'plans', `${planRef}.json`)), true);

	const effects = new Map(
		preview.envelope.result.plan.createEffects.map(effect => [effect.itemRef, effect]),
	);
	const state = {
		contractVersion: 1,
		vaultPath,
		configRoot,
		planRef,
		sourceOperonId: effects.get('source').operonId,
		targetOperonId: effects.get('target').operonId,
	};
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
		['plan', 'recover', state.planRef, '--timeout-ms', '30000'],
	);
	assert.ok(['applied', 'already-applied'].includes(recovered.envelope.result?.status));
	assert.equal(recovered.envelope.result?.mutationMayHaveApplied, true);
	const source = readTask(state.sourceOperonId);
	const target = readTask(state.targetOperonId);
	assert.equal(source.relationships.blockingOperonIds.includes(state.targetOperonId), true);
	assert.equal(target.relationships.blockedByOperonIds.includes(state.sourceOperonId), true);
	assert.equal(
		existsSync(path.join(configRoot, 'plans', `${state.planRef}.json`)),
		true,
		'Terminal graph recovery must retain its replay tombstone.',
	);
	rmSync(configRoot, { recursive: true, force: true });
	rmSync(statePath, { force: true });
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		recovery: recovered.envelope.result.status,
		samePlan: true,
		reciprocalDependencyVerified: true,
	}, null, 2)}\n`);
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
				OPERON_CLI_EXECUTABLE: cliArtifact,
			},
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return JSON.parse(result.stdout);
}

function runObsidianLifecycle(action) {
	const args = action === 'reload'
		? [`vault=${path.basename(vaultPath)}`, 'command', 'id=app:reload']
		: [`vault=${path.basename(vaultPath)}`, 'restart'];
	const result = spawnSync('obsidian', args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 1_024 * 1_024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

function waitForFreshRuntime(previousSessionId) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const current = diagnostics();
			if (
				current.sessionId !== previousSessionId
				&& current.lifecyclePhase === 'ready'
				&& current.persistencePhase === 'idle'
				&& current.vaultIdentityMatches
				&& requestRootIsClean()
			) return current;
		} catch {
			// Runtime may be unavailable briefly while the app reloads.
		}
		wait(250);
	}
	return null;
}

function wait(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function diagnostics() {
	const envelope = runCli(['diagnostics']).envelope;
	const health = envelope.result?.health;
	return {
		sessionId: health?.contextRevision?.index?.sessionId,
		lifecyclePhase: health?.lifecyclePhase,
		persistencePhase: health?.v8PersistencePhase,
		vaultIdentityMatches: envelope.vaultIdentity?.expectedMatch === true,
	};
}

function requestRootIsClean() {
	const requestRoot = path.join(
		expectedTempRoot,
		`operon-agent-runtime-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`,
	);
	return !existsSync(requestRoot) || readdirSync(requestRoot).length === 0;
}

function readTask(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a6-probe-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: [],
	});
	assert.equal(result.envelope.result?.ok, true, `Task ${operonId} must be live-readable.`);
	return result.envelope.result.task;
}

function runCli(command, input, allowFailure = false) {
	const isLocalCommand = command[0] === 'manifest' || command[0] === 'plan';
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			...(isLocalCommand ? [] : ['--vault', vaultPath]),
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
