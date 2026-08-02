#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

const sampleCount = 20;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : '/tmp');
const requestedVault = process.argv[2] ?? path.join(expectedTempRoot, 'operon-agent-runtime-phase1-v1');
const vaultPath = realpathSync(requestedVault);
const vaultStat = lstatSync(vaultPath);
assert.equal(vaultStat.isDirectory(), true);
assert.equal(vaultStat.isSymbolicLink(), false);
assert.equal(path.dirname(vaultPath), expectedTempRoot);
assert.match(path.basename(vaultPath), /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);

const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const settingsPath = path.join(vaultPath, '.obsidian/plugins/operon/data.json');
const settingsBefore = digestFile(settingsPath);
const previewHandlerMs = [];
const applyHandlerMs = [];
const previewTotalMs = [];
const applyTotalMs = [];

for (let index = 0; index < sampleCount; index += 1) {
	const suffix = String(index + 1).padStart(2, '0');
	const idempotencyKey = `phase7-performance-${randomUUID()}`;
	const preview = runCli(['mutation', 'preview'], {
		contractVersion: 1,
		requestId: `phase7-performance-preview-${randomUUID()}`,
		kind: 'mutation-preview',
		clientInstanceId: 'phase7-performance',
		idempotencyKey,
		capability: 'tasks.create.preview',
		mutationKind: 'task.create',
		spec: {
			operation: 'create',
			items: [{
				itemRef: `benchmark-${suffix}`,
				description: `Phase 7 benchmark ${suffix}`,
				target: {
					representation: 'file',
					mode: 'exact-path',
					filePath: `Tasks/Phase 7 benchmark ${suffix}.md`,
				},
				fields: [],
				statusId: 'st_fixture_inbox',
				priorityId: 'pr_fixture_p2',
			}],
		},
		authorization: {
			basis: 'user-explicit-request',
			reason: 'Phase 7 sanitized performance measurement.',
		},
	});
	assert.equal(preview.result?.ok, true);
	previewHandlerMs.push(preview.timing.handlerMs);
	previewTotalMs.push(preview.timing.totalMs);

	const applied = runCli(['mutation', 'apply'], {
		contractVersion: 1,
		requestId: `phase7-performance-apply-${randomUUID()}`,
		kind: 'mutation-apply',
		plan: preview.result.plan,
		authorization: {
			basis: 'user-explicit-request',
			reason: 'Phase 7 sanitized performance measurement.',
		},
		idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(applied.result?.status, 'applied');
	applyHandlerMs.push(applied.timing.handlerMs);
	applyTotalMs.push(applied.timing.totalMs);
}

assert.equal(digestFile(settingsPath), settingsBefore);
process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vault: path.basename(vaultPath),
	samples: sampleCount,
	preview: summarize(previewHandlerMs, previewTotalMs),
	applyThroughPostflight: summarize(applyHandlerMs, applyTotalMs),
	settingsUnchanged: true,
}, null, 2)}\n`);

function runCli(command, request) {
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			'--vault',
			vaultPath,
			'--input',
			'-',
			'--json',
		],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			input: `${JSON.stringify(request)}\n`,
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout || 'Operon CLI failed.');
	return JSON.parse(result.stdout);
}

function summarize(handlerSamples, totalSamples) {
	return {
		handlerP50Ms: percentile(handlerSamples, 0.50),
		handlerP95Ms: percentile(handlerSamples, 0.95),
		handlerMaxMs: Math.max(...handlerSamples),
		totalP50Ms: percentile(totalSamples, 0.50),
		totalP95Ms: percentile(totalSamples, 0.95),
		totalMaxMs: Math.max(...totalSamples),
	};
}

function percentile(values, ratio) {
	const ordered = [...values].sort((left, right) => left - right);
	return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}

function digestFile(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
