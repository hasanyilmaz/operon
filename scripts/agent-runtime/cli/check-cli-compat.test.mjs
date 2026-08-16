import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';

import { parseCliCompatibilityArguments, runCliCompatibilityCheck } from './check-cli-compat.mjs';

test('CLI compatibility requires one explicit tarball and rejects ambiguous input', () => {
	const result = parseCliCompatibilityArguments(['--tarball', '/private/tmp/operon-cli.tgz']);
	assert.equal(result.tarballPath, '/private/tmp/operon-cli.tgz');
	assert.throws(
		() => parseCliCompatibilityArguments([]),
		/OPERON_CLI_COMPAT_USAGE/u,
	);
	assert.throws(
		() => parseCliCompatibilityArguments(['--tarball', 'a.tgz', '--tarball', 'b.tgz']),
		/OPERON_CLI_COMPAT_USAGE/u,
	);
	assert.throws(
		() => parseCliCompatibilityArguments(['--tarball', 'a.tgz', '--unexpected', 'value']),
		/OPERON_CLI_COMPAT_USAGE/u,
	);
});

test('CLI compatibility lane includes current accepted-freeze and registry evidence exactly once', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-cli-compat-'));
	const tarball = path.join(root, 'operon-cli.tgz');
	await writeFile(tarball, 'fixture');
	const calls = [];
	try {
		await runCliCompatibilityCheck({
			argv: ['--tarball', tarball],
			run: async arguments_ => { calls.push(arguments_); },
		});
		const flattened = calls.flat().join('\n');
		assert.match(flattened, /scripts\/release\/check-accepted-freeze\.mjs/u);
		assert.match(flattened, /scripts\/release\/check-release-freeze-registry\.mjs/u);
		assert.equal(
			calls.filter(arguments_ => arguments_.join(' ').includes('check-accepted-freeze.mjs')).length,
			1,
		);
		assert.equal(
			calls.filter(arguments_ => arguments_.join(' ').includes('check-release-freeze-registry.mjs')).length,
			1,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
