import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCliCompatibilityArguments } from './check-cli-compat.mjs';

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
