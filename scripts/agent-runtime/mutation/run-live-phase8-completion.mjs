#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const resetRunner = path.join(scriptDirectory, 'run-live-phase8-reset.mjs');
const warmBenchmark = path.join(scriptDirectory, 'live-phase8-warm-benchmark.mjs');

const acceptance = run(resetRunner, {
	OPERON_PHASE8_STRICT_COMPLETION: '1',
	OPERON_PHASE8_PREVIEW_SAMPLES: '1',
	OPERON_PHASE8_DEFER_PER_RUN_PERFORMANCE: '1',
});
const acceptanceEvidence = parseEvidence(acceptance.stdout, 'Phase 8 live acceptance');

run(resetRunner, { OPERON_PHASE8_RESET_ONLY: '1' });
const warm = run(warmBenchmark);
const warmEvidence = parseEvidence(warm.stdout, 'Phase 8 warm benchmark');

assert.deepEqual(acceptanceEvidence.publishedFamilies, [
	'update',
	'reminder',
	'transition',
	'timer',
	'relocation',
	'conversion',
	'delete',
]);
assert.deepEqual(acceptanceEvidence.refusedFamilies, []);
assert.deepEqual(acceptanceEvidence.unavailableFamilies, []);
assert.equal(warmEvidence.samplesPerFamily, 20);

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	publishedFamilies: acceptanceEvidence.publishedFamilies,
	refusedFamilies: acceptanceEvidence.refusedFamilies,
	unavailableFamilies: acceptanceEvidence.unavailableFamilies,
	correctnessAcceptance: {
		runtimeSession: 'fresh-restart',
		operations: acceptanceEvidence.timings,
	},
	warmPerformance: warmEvidence,
}, null, 2)}\n`);

function run(scriptPath, extraEnv = {}) {
	const result = spawnSync(process.execPath, [scriptPath], {
		cwd: pluginRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1_024 * 1_024,
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

function parseEvidence(stdout, label) {
	const marker = stdout.lastIndexOf('{\n  "status": "ok"');
	assert.ok(marker >= 0, `${label} did not return evidence JSON.`);
	return JSON.parse(stdout.slice(marker));
}
