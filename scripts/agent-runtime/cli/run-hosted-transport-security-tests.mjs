#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';

const runner = path.resolve(
	import.meta.dirname,
	'../cli-transport/run-native-transport-tests.mjs',
);
const result = await new Promise((resolve, reject) => {
	const child = spawn(process.execPath, [runner], {
		env: process.env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	let timedOut = false;
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', chunk => {
		stdout += chunk;
		process.stdout.write(chunk);
	});
	child.stderr.on('data', chunk => {
		stderr += chunk;
		process.stderr.write(chunk);
	});
	const watchdog = setTimeout(() => {
		timedOut = true;
		child.kill('SIGKILL');
	}, 210_000);
	child.once('error', error => {
		clearTimeout(watchdog);
		reject(error);
	});
	child.once('close', (status, signal) => {
		clearTimeout(watchdog);
		resolve({ status, signal, stdout, stderr, timedOut });
	});
});
assert.equal(result.timedOut, false, 'Hosted transport/security tests timed out.');
assert.equal(result.signal, null, 'Hosted transport/security tests were interrupted.');
assert.equal(result.status, 0, 'Hosted transport/security tests failed.');
const combined = `${result.stdout}\n${result.stderr}`;
assert.doesNotMatch(combined, /#\s+SKIP\b/iu, 'Hosted transport/security tests skipped an assertion.');
const summaries = [...combined.matchAll(/[#ℹ]\s+skipped\s+([0-9]+)/giu)];
assert.ok(summaries.length > 0, 'Hosted transport/security test skip count was not reported.');
for (const summary of summaries) {
	assert.equal(Number(summary[1]), 0, 'Hosted transport/security tests must have zero skips.');
}
