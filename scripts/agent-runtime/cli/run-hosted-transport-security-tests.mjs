#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const runner = path.resolve(
	import.meta.dirname,
	'../cli-transport/run-native-transport-tests.mjs',
);
const result = spawnSync(process.execPath, [runner], {
	encoding: 'utf8',
	env: process.env,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
assert.equal(result.error, undefined);
assert.equal(result.status, 0, 'Hosted transport/security tests failed.');
const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
assert.doesNotMatch(combined, /#\s+SKIP\b/iu, 'Hosted transport/security tests skipped an assertion.');
const summaries = [...combined.matchAll(/[#ℹ]\s+skipped\s+([0-9]+)/giu)];
assert.ok(summaries.length > 0, 'Hosted transport/security test skip count was not reported.');
for (const summary of summaries) {
	assert.equal(Number(summary[1]), 0, 'Hosted transport/security tests must have zero skips.');
}
