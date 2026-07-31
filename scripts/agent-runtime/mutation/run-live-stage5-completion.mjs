#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const cliTestVault = '/private/tmp/cli-test-vault';
const typedCreateVault = '/private/tmp/operon-agent-runtime-phase1-v1';
const resetRunner = path.join(scriptDirectory, 'run-live-phase8-reset.mjs');
const phase8Runner = path.join(scriptDirectory, 'run-live-phase8-completion.mjs');
const cliArtifact = process.env.OPERON_CLI_EXECUTABLE
	?? path.join(pluginRoot, 'packages/operon-cli/dist/operon.mjs');

const evidence = {};
try {
	run(resetRunner, [typedCreateVault], { OPERON_PHASE8_RESET_ONLY: '1' });
	evidence.create = runJson(
		path.join(scriptDirectory, 'live-typed-creation-acceptance.mjs'),
		[typedCreateVault],
	);

	const phase8 = runJson(phase8Runner);
	evidence.phase8 = phase8;
	evidence.recurrence = runJson(
		path.join(scriptDirectory, 'live-recurrence-acceptance.mjs'),
		['run'],
	);
	evidence.relationship = runJson(
		path.join(scriptDirectory, 'live-relationship-acceptance.mjs'),
		['run', cliTestVault],
	);
	restoreCliTestVault();
	waitForCliTestRuntime();
	evidence.timerSession = runJson(
		path.join(scriptDirectory, 'live-timer-session-acceptance.mjs'),
		['happy'],
	);
	evidence.pinnedState = runPinnedStateAcceptance();

	const publishedFamilies = [
		'task.create',
		'task.update',
		'task.recurrence',
		'task.relationship',
		'task.reminder-item',
		'task.transition',
		'task.pinned-state',
		'timer.control',
		'timer.session',
		'task.convert',
		'task.inline-relocate',
		'task.delete',
	];
	assert.equal(Object.values(evidence).every(item => item?.status === 'ok'), true);
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		publishedFamilies,
		refusedFamilies: [],
		unavailableFamilies: [],
		familyEvidence: evidence,
		warmPerformance: phase8.warmPerformance,
	}, null, 2)}\n`);
} finally {
	run(resetRunner, [typedCreateVault], { OPERON_PHASE8_RESET_ONLY: '1' });
	restoreCliTestVault();
	waitForCliTestRuntime();
}

function runPinnedStateAcceptance() {
	const configRoot = mkdtempSync(path.join(tmpdir(), 'operon-stage5-pinned-'));
	try {
		const pinned = runCli(
			['task', 'pin', '--id', 'inln001'],
			configRoot,
		cliTestVault,
		{ parseLastJson: false },
		);
		assert.ok(['applied', 'already-applied'].includes(pinned.result?.status));
		assert.equal(pinned.result?.postflight?.status, 'verified');
		const unpinned = runCli(
			['task', 'unpin', '--id', 'inln001'],
			configRoot,
			cliTestVault,
			{ parseLastJson: false },
		);
		assert.ok(['applied', 'already-applied'].includes(unpinned.result?.status));
		assert.equal(unpinned.result?.postflight?.status, 'verified');
		return { status: 'ok', pin: pinned.result.status, unpin: unpinned.result.status };
	} finally {
		rmSync(configRoot, { recursive: true, force: true });
	}
}

function runCli(command, configRoot, vaultPath, options = {}) {
	const result = spawnSync(process.execPath, [
		cliArtifact,
		...command,
		'--vault',
		vaultPath,
		'--json',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 8 * 1_024 * 1_024,
		env: { ...process.env, OPERON_CONFIG_HOME: configRoot },
	});
	if (result.stderr) process.stderr.write(result.stderr);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return options.parseLastJson === false
		? JSON.parse(result.stdout)
		: parseEvidence(result.stdout, command.join(' '));
}

function runJson(scriptPath, args = []) {
	const result = run(scriptPath, args);
	return parseEvidence(result.stdout, path.basename(scriptPath));
}

function run(scriptPath, args = [], extraEnv = {}) {
	const result = spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 64 * 1_024 * 1_024,
		env: {
			...process.env,
			...extraEnv,
		},
	});
	if (result.status !== 0) {
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
	}
	assert.equal(result.status, 0, `${path.basename(scriptPath)} failed.`);
	return result;
}

function restoreCliTestVault() {
	spawnSync('obsidian', ['vault=cli-test-vault', 'plugin:disable', 'id=operon'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
	});
	run(
		path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
		['--production', cliTestVault],
	);
	const enable = spawnSync('obsidian', [
		'vault=cli-test-vault',
		'plugin:enable',
		'id=operon',
		'filter=community',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
		timeout: 10_000,
	});
	assert.equal(enable.status, 0, enable.stderr || enable.stdout);
}

function waitForCliTestRuntime() {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const diagnostics = spawnSync(process.execPath, [
			cliArtifact,
			'diagnostics',
			'--vault',
			cliTestVault,
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
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
	}
	throw new Error('Restored production CLI test Runtime did not become ready and idle.');
}

function parseEvidence(stdout, label) {
	const marker = stdout.lastIndexOf('{\n  "status": "ok"');
	assert.ok(marker >= 0, `${label} did not return evidence JSON.`);
	return JSON.parse(stdout.slice(marker));
}
