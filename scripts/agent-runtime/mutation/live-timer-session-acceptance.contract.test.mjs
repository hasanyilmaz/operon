import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./live-timer-session-acceptance.mjs', import.meta.url), 'utf8');

test('timer-session acceptance is fixed to the reusable sanitized CLI vault', () => {
	assert.match(source, /realpathSync\('\/private\/tmp\/cli-test-vault'\)/u);
	assert.doesNotMatch(source, /mkdtempSync\([^)]*vault/u);
});

test('timer-session acceptance covers direct CRUD, confirmation and same-plan recovery', () => {
	for (const token of [
		"'timer', 'session', 'add'",
		"'timer', 'session', 'update'",
		"'timer', 'session', 'remove'",
		"'--confirm'",
		"'plan', 'recover'",
		"'a12-probe-timer-session-interrupt-v1'",
	]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
});

test('timer-session acceptance checks exact duplicate index, last-item clear, midnight handling and parent aggregate', () => {
	assert.match(source, /duplicateRange/u);
	assert.match(source, /selectedRawIndex, 1/u);
	assert.match(source, /lastItemClear/u);
	assert.match(source, /trackers\|duration/u);
	assert.match(source, /midnight/u);
	assert.match(source, /totalDuration/u);
	assert.match(source, /tmrpar1/u);
	assert.match(source, /tmrch01/u);
});
