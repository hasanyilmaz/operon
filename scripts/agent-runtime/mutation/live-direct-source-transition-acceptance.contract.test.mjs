import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
	new URL('./live-direct-source-transition-acceptance.mjs', import.meta.url),
	'utf8',
);

test('direct source-transition acceptance is fixed to the reusable CLI vault', () => {
	assert.match(source, /realpathSync\('\/private\/tmp\/cli-test-vault'\)/u);
	assert.doesNotMatch(source, /process\.argv\[3\]/u);
});

test('direct source-transition acceptance covers exact human routes and confirmations', () => {
	assert.match(source, /'task', 'relocate'/u);
	assert.match(source, /'task', 'convert'/u);
	assert.match(source, /'task', 'delete'/u);
	assert.match(source, /firstPlacementLine/u);
	assert.match(source, /confirmationToken/u);
	assert.match(source, /fileDeletePinnedCleanup/u);
});

test('destructive acceptance applies only the retained same plan', () => {
	assert.match(source, /applyStoredPlan\(fileToInlinePreview\.client\.planRef\)/u);
	assert.match(source, /applyStoredPlan\(inlineDeletePreview\.client\.planRef\)/u);
	assert.match(source, /applyStoredPlan\(fileDeletePreview\.client\.planRef\)/u);
	assert.doesNotMatch(source, /mutation['"], ['"]preview/u);
});
