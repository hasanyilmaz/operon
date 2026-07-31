import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
	new URL('./run-live-stage5-completion.mjs', import.meta.url),
	'utf8',
);
const candidateSource = readFileSync(
	new URL('../cli/run-candidate-live-acceptance.mjs', import.meta.url),
	'utf8',
);
const verifierSource = readFileSync(
	new URL('../cli/verify-live-acceptance.mjs', import.meta.url),
	'utf8',
);

const mutationKinds = [
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

test('Stage 5 live completion composes every specialized acceptance surface', () => {
	for (const script of [
		'run-live-phase8-completion.mjs',
		'live-typed-creation-acceptance.mjs',
		'live-recurrence-acceptance.mjs',
		'live-relationship-acceptance.mjs',
		'live-timer-session-acceptance.mjs',
	]) {
		assert.match(source, new RegExp(script.replaceAll('.', '\\.'), 'u'));
	}
	assert.match(source, /runPinnedStateAcceptance\(\)/u);
	for (const mutationKind of mutationKinds) {
		assert.match(source, new RegExp(`['"]${mutationKind.replaceAll('.', '\\.')}['"]`, 'u'));
		assert.match(verifierSource, new RegExp(`['"]${mutationKind.replaceAll('.', '\\.')}['"]`, 'u'));
	}
	assert.match(candidateSource, /run-live-stage5-completion\.mjs/u);
	assert.doesNotMatch(candidateSource, /run-live-phase8-completion\.mjs/u);
});

test('Stage 5 live completion restores the reusable CLI fixture in a finally fence', () => {
	assert.match(
		source,
		/finally\s*\{\s*run\(resetRunner, \[typedCreateVault\], \{ OPERON_PHASE8_RESET_ONLY: '1' \}\);\s*restoreCliTestVault\(\);/u,
	);
	assert.match(source, /create-sanitized-vault\.mjs/u);
	assert.match(source, /\['--production', cliTestVault\]/u);
});
