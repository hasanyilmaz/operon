#!/usr/bin/env node

import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const expectedParent = realpathSync(process.platform === 'darwin' ? '/private/tmp' : '/tmp');
const requestedVault = path.resolve(
	process.argv[2] ?? path.join(expectedParent, 'operon-agent-runtime-phase1-v1'),
);
assert.equal(path.dirname(requestedVault), expectedParent);
assert.match(path.basename(requestedVault), /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);

disableBeforeReset();
run(process.execPath, [
	path.join(pluginRoot, 'scripts/agent-runtime/create-sanitized-vault.mjs'),
	'--production',
	requestedVault,
]);

const vaultName = path.basename(requestedVault);
reloadFreshVault();
if (!await waitUntilReady(30_000)) {
	reloadFreshVault();
	if (!await waitUntilReady(30_000)) {
		throw new Error('Sanitized Operon Runtime did not become ready after a bounded reload retry.');
	}
}
if (process.env.OPERON_PHASE8_DEBUG === '1') {
	run('obsidian', [`vault=${vaultName}`, 'dev:debug', 'on']);
}

if (process.env.OPERON_PHASE8_RESET_ONLY !== '1') {
	run(process.execPath, [
		path.join(pluginRoot, 'scripts/agent-runtime/mutation/live-phase8-acceptance.mjs'),
		requestedVault,
	], {
		...(process.env.OPERON_PHASE8_STRICT_COMPLETION === '1'
			? { OPERON_PHASE8_STRICT_COMPLETION: '1' }
			: {}),
		...(process.env.OPERON_PHASE8_DEFER_PER_RUN_PERFORMANCE === '1'
			? { OPERON_PHASE8_DEFER_PER_RUN_PERFORMANCE: '1' }
			: {}),
	});
}

function disableBeforeReset() {
	spawnSync('obsidian', [
		`vault=${path.basename(requestedVault)}`,
		'plugin:disable',
		'id=operon',
	], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 2 * 1_024 * 1_024,
	});
}

function reloadFreshVault() {
	run('obsidian', [`vault=${vaultName}`, 'reload']);
}

async function waitUntilReady(timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	do {
		const health = spawnSync(process.execPath, [
			cliArtifact,
			'health',
			'--vault',
			requestedVault,
			'--json',
		], {
			cwd: pluginRoot,
			encoding: 'utf8',
			maxBuffer: 4 * 1_024 * 1_024,
		});
		if (health.stdout.trim()) {
			try {
				const envelope = JSON.parse(health.stdout);
				if (
					envelope.ok === true
					&& envelope.result?.lifecyclePhase === 'ready'
				) return true;
				if (envelope.error?.retryable === false) return false;
			} catch {
				// A reload can briefly interrupt the native handler; retry within the deadline.
			}
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	} while (Date.now() < deadline);
	return false;
}

function run(command, args, extraEnv = {}) {
	const result = spawnSync(command, args, {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 8 * 1_024 * 1_024,
		env: {
			...process.env,
			...extraEnv,
		},
	});
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	assert.equal(result.status, 0, `${command} exited ${String(result.status)}.`);
}
