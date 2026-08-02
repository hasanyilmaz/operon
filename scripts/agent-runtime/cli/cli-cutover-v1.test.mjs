import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { checkCliCutover, inventoryAggregate } from './check-cli-cutover.mjs';

test('every duplicate CLI reference has a Stage 8 disposition', async () => {
	const result = await checkCliCutover();
	assert.equal(result.unmatched, 0);
	assert.equal(result.directSourceImports, 20);
});

test('cutover inventory self aggregate changes with its contents', async () => {
	const inventory = JSON.parse(await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.json', import.meta.url),
		'utf8',
	));
	const original = inventoryAggregate(inventory);
	inventory.entries[0].stage8Action = 'unreviewed mutation';
	assert.notEqual(inventoryAggregate(inventory), original);
});

test('standalone removals have exact replacements and direct imports use one master disposition', async () => {
	const inventory = JSON.parse(await readFile(
		new URL('../../../contracts/agent-runtime/cli-cutover-v1.json', import.meta.url),
		'utf8',
	));
	const entries = new Map(inventory.entries.map(entry => [entry.path, entry]));
	for (const path of inventory.directSourceImports) {
		assert.equal(typeof path, 'string');
		assert.ok(entries.has(path), path);
	}
	for (const entry of inventory.entries.filter(candidate => candidate.disposition === 'standalone-equivalent')) {
		assert.match(entry.replacementPath, /^(?:src|test|scripts|docs)\//u);
	}
	assert.equal(entries.get('scripts/agent-runtime/cli/cli.test.ts').disposition, 'convert-to-external-artifact');
	assert.equal(entries.get('scripts/agent-runtime/cli/phase9-client.test.ts').disposition, 'convert-to-external-artifact');
	assert.equal(entries.get('scripts/analyze-production-bundle.test.mjs').disposition, 'retain-plugin-runtime-contract');
});
