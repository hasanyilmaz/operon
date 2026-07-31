import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
	new URL('./live-source-transition-recovery-acceptance.mjs', import.meta.url),
	'utf8',
);

test('source-transition recovery acceptance is fixed to one reusable test vault', () => {
	assert.match(source, /realpathSync\('\/private\/tmp\/cli-test-vault'\)/u);
	assert.doesNotMatch(source, /mkdtempSync\([^)]*vault/u);
	assert.match(
		source,
		/\['prepare-pre-trash', 'prepare-post-trash', 'recover'\]\.includes\(phase\)/u,
	);
});

test('both probe interruptions retain exactly one sealed plan for recovery', () => {
	for (const key of [
		'a12-probe-source-pre-trash-interrupt-v1',
		'a12-probe-source-post-trash-interrupt-v1',
	]) {
		assert.equal(countOccurrences(source, `'${key}'`), 1);
	}
	assert.equal(countOccurrences(source, "runCli(['mutation', 'preview']"), 1);
	assert.match(source, /runCli\(\['plan', 'recover', state\.planRef/u);
	assert.match(source, /samePlan: true/u);
	assert.doesNotMatch(source, /idempotencyKey.*randomUUID/u);
});

test('pre-trash conversion and post-trash pinned delete verify exact terminal state', () => {
	assert.match(source, /from: 'file',\s*to: 'inline'/u);
	assert.match(source, /operation: 'delete', mode: 'delete-exact-task', cascade: false/u);
	assert.match(source, /\['task', 'pin', '--id', 'unrel01'\]/u);
	assert.match(source, /postflight\?\.status, 'verified'/u);
	assert.match(source, /countActiveTaskCopies\(state\.operonId\), 1/u);
	assert.match(source, /countActiveTaskCopies\(state\.operonId\), 0/u);
	assert.match(source, /readPinnedState\(state\.operonId\), false/u);
});

test('prepare preserves CLI plan storage for a later production-bundle recover phase', () => {
	const prepareBlock = source.slice(
		source.indexOf("if (phase === 'prepare-pre-trash')"),
		source.indexOf('assertRuntimeReady();\nconst state = JSON.parse'),
	);
	assert.doesNotMatch(prepareBlock, /rmSync\(configRoot.*process\.exit/u);
	assert.match(source, /writeFileSync\(\s*statePath/u);
	assert.match(source, /existsSync\(path\.join\(configRoot, 'plans'/u);
});

function countOccurrences(value, needle) {
	return value.split(needle).length - 1;
}
