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
			runtimeContractReview: false,
			runtimeBaselineMutation: false,
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
			runtimeContractReview: false,
			runtimeBaselineMutation: false,
		},
	);
});

test('CI classifier and Windows platform validator cannot change on the normal fast path', () => {
	for (const path of [
		'scripts/ci/classify-pr-validation-surface.mjs',
		'scripts/validate-windows-plugin.mjs',
	]) {
		assert.equal(classifyPullRequestValidationSurface([path]).pluginReleaseGuard, true);
	}
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
			runtimeContractReview: false,
			runtimeBaselineMutation: false,
		},
	);
});

test('Runtime contract changes require the focused boundary while a baseline rewrite is refused', () => {
	assert.deepEqual(
		classifyPullRequestValidationSurface([
			'contracts/agent-runtime/v1/capability-advertisements.schema.json',
			'contracts/agent-runtime/public-v1-baseline.json',
		]),
		{
			classification: 'runtime-contract-sensitive',
			pluginReleaseGuard: true,
			cliCompatReview: false,
			runtimeContractReview: true,
			runtimeBaselineMutation: true,
		},
	);
});

test('CLI freeze, acceptance, and cutover evidence never enters the normal Plugin lane', () => {
	for (const path of [
		'contracts/agent-runtime/public-v1-external-freeze.json',
		'contracts/agent-runtime/public-v1-live-acceptance.json',
		'contracts/agent-runtime/cli-cutover-v1.schema.json',
	]) {
		assert.equal(classifyPullRequestValidationSurface([path]).classification, 'cli-compat-required');
	}
	assert.equal(
		classifyPullRequestValidationSurface(['scripts/agent-runtime/cli/check-published-cli-binding.mjs']).classification,
		'cli-compat-required',
	);
	assert.equal(
		classifyPullRequestValidationSurface(['scripts/agent-runtime/cli/check-cli-compat.mjs']).classification,
		'plugin-release-sensitive',
	);
});

test('public docs coverage can evolve with Plugin docs without changing historical CLI evidence', () => {
	assert.deepEqual(
		classifyPullRequestValidationSurface(['scripts/agent-runtime/cli/public-docs.test.mjs']),
		{
			classification: 'normal-plugin',
			pluginReleaseGuard: false,
			cliCompatReview: false,
			runtimeContractReview: false,
			runtimeBaselineMutation: false,
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
		'diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', '--merge-base', baseSha, headSha,
	]]);
	assert.throws(
		() => changedPathsBetween(baseSha, headSha, () => { throw new Error('missing merge base'); }),
		/OPERON_PR_MERGE_BASE_UNAVAILABLE/u,
	);
});

test('CLI output is machine-readable GitHub step output without hashes', () => {
	let output = '';
	main({
		argv: ['--base', 'a'.repeat(40), '--head', 'b'.repeat(40)],
		executeGit: () => Buffer.from('package.json\0'),
		write: value => { output += value; },
	});
	assert.equal(output, 'classification=plugin-release-sensitive\nplugin_release_guard=true\ncli_compat_review=false\nruntime_contract_review=false\nruntime_baseline_mutation=false\n');
	assert.equal(
		formatGitHubOutput(classifyPullRequestValidationSurface(['src/main.ts'])),
		'classification=normal-plugin\nplugin_release_guard=false\ncli_compat_review=false\nruntime_contract_review=false\nruntime_baseline_mutation=false',
	);
});
