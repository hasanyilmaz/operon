import assert from 'node:assert/strict';
import test from 'node:test';

import {
	changedPathsBetween,
	classifyPullRequestValidationSurface,
	formatGitHubOutput,
	main,
	parseCliArguments,
} from './classify-pr-validation-surface.mjs';

test('normal Plugin code skips the release guard', () => {
	assert.deepEqual(
		classifyPullRequestValidationSurface([
			'src/ui/task-router.ts',
			'src/ui/task-router.test.ts',
		]),
		{
			classification: 'normal-plugin',
			pluginReleaseGuard: false,
			cliCompatReview: false,
		},
	);
});

test('release-sensitive workflow and asset paths require the Plugin guard', () => {
	assert.deepEqual(
		classifyPullRequestValidationSurface([
			'.github/workflows/release.yml',
			'release-assets/locales/de.json',
			'styles.css',
		]),
		{
			classification: 'plugin-release-sensitive',
			pluginReleaseGuard: true,
			cliCompatReview: false,
		},
	);
});

test('historical CLI compatibility evidence requires a separate review before the Plugin guard', () => {
	assert.deepEqual(
		classifyPullRequestValidationSurface([
			'contracts/agent-runtime/public-v1-freeze.json',
			'scripts/release/extract-changelog-release-notes.mjs',
		]),
		{
			classification: 'cli-compat-required',
			pluginReleaseGuard: false,
			cliCompatReview: true,
		},
	);
});

test('classifier parses only exact revision arguments and NUL-delimited Git paths', () => {
	const baseSha = 'a'.repeat(40);
	const headSha = 'b'.repeat(40);
	assert.deepEqual(parseCliArguments(['--base', baseSha, '--head', headSha]), { baseSha, headSha });
	assert.throws(() => parseCliArguments(['--base', 'short', '--head', headSha]));
	const calls = [];
	const changed = changedPathsBetween(baseSha, headSha, arguments_ => {
		calls.push(arguments_);
		return Buffer.from('manifest.json\0src/main.ts\0');
	});
	assert.deepEqual(changed, ['manifest.json', 'src/main.ts']);
	assert.deepEqual(calls, [[
		'diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', baseSha, headSha,
	]]);
});

test('CLI output is machine-readable GitHub step output without hashes', () => {
	let output = '';
	main({
		argv: ['--base', 'a'.repeat(40), '--head', 'b'.repeat(40)],
		executeGit: () => Buffer.from('package.json\0'),
		write: value => { output += value; },
	});
	assert.equal(output, 'classification=plugin-release-sensitive\nplugin_release_guard=true\ncli_compat_review=false\n');
	assert.equal(
		formatGitHubOutput(classifyPullRequestValidationSurface(['src/main.ts'])),
		'classification=normal-plugin\nplugin_release_guard=false\ncli_compat_review=false',
	);
});
