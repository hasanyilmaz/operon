import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageManifest = JSON.parse(await readFile(path.join(pluginRoot, 'package.json'), 'utf8'));
const scripts = packageManifest.scripts;

test('Plugin validation graph never enters CLI compatibility work', () => {
	const pluginGraph = collectScriptGraph('check:plugin');
	for (const forbidden of [
		'agent-runtime:external-cli:test',
		'agent-runtime:external-cli:binding:check',
		'agent-runtime:external-cli:artifact:check',
		'agent-runtime:external-cli:public-proof',
		'agent-runtime:cli-contracts:check',
		'agent-runtime:compatibility:check',
		'agent-runtime:historical-freeze:test',
		'agent-runtime:historical-freeze:check',
		'agent-runtime:cli-schemas:test',
		'release:external-live:test',
		'docs:public-v1:test',
		'check:cli-compat',
	]) assert.equal(pluginGraph.has(forbidden), false, `Plugin lane must not invoke ${forbidden}.`);
	assert.equal(scripts.check, 'npm run check:plugin');
	assert.equal(scripts['check:candidate'], 'npm run check:plugin');
	assert.equal(Object.hasOwn(scripts, 'agent-runtime:types:check'), false);
});

test('manual CLI compatibility retains each exact-bound consumer check once', async () => {
	const source = await readFile(
		path.join(pluginRoot, 'scripts', 'agent-runtime', 'cli', 'check-cli-compat.mjs'),
		'utf8',
	);
	for (const file of [
		'check-published-cli-binding.mjs',
		'check-cli-cutover.mjs',
		'check-package-contracts.mjs',
		'check-public-v1-baseline.mjs',
		'check-historical-public-v1-freeze.mjs',
		'check-published-cli-artifact.mjs',
		'check-published-cli-public-proof.mjs',
	]) {
		assert.equal(count(source, file), 1, `CLI compatibility must run ${file} once.`);
	}
	assert.match(scripts['check:cli-compat'], /check-cli-compat\.mjs/u);
});

function collectScriptGraph(root) {
	const seen = new Set();
	const visit = name => {
		if (seen.has(name)) return;
		seen.add(name);
		const command = scripts[name];
		if (typeof command !== 'string') return;
		for (const match of command.matchAll(/npm run ([\w:-]+)/gu)) visit(match[1]);
	};
	visit(root);
	return seen;
}

function count(source, value) {
	return source.split(value).length - 1;
}
