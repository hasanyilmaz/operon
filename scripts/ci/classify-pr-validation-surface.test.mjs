import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { checkDocsClassificationGate } from './docs-only-workflow-policy.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync, copyFileSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';

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
			docsOnly: false,
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
			docsOnly: false,
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
			docsOnly: false,
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
			docsOnly: false,
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
			docsOnly: false,
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
	assert.deepEqual(parseCliArguments(['--base', baseSha, '--head', headSha]), { baseSha, headSha, event: 'pull_request' });
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
		/OPERON_COMPARISON_UNAVAILABLE/u,
	);
});

test('CLI output is machine-readable GitHub step output without hashes', () => {
	let output = '';
	main({
		argv: ['--base', 'a'.repeat(40), '--head', 'b'.repeat(40)],
		executeGit: () => Buffer.from('package.json\0'),
		write: value => { output += value; },
	});
	assert.equal(output, 'docs_only=false\nclassification=plugin-release-sensitive\nplugin_release_guard=true\ncli_compat_review=false\nruntime_contract_review=false\nruntime_baseline_mutation=false\n');
	assert.equal(
		formatGitHubOutput(classifyPullRequestValidationSurface(['src/main.ts'])),
		'docs_only=false\nclassification=normal-plugin\nplugin_release_guard=false\ncli_compat_review=false\nruntime_contract_review=false\nruntime_baseline_mutation=false',
	);
});

for (const paths of [
	['docs/operon-docs/DOCS-147 Excalidraw Task Cards.md'],
	['docs/media/MEDIA-DOCS-147-1.png'],
	['docs/operon-docs/manifest.json', 'docs/media/video.mp4'],
	['docs/operon-docs/DOCS-145 Old.md', 'docs/operon-docs/DOCS-145 New.md'],
]) {
	test('docs-only classification: ' + paths.join(', '), () => {
		const result = classifyPullRequestValidationSurface(paths);
		assert.equal(result.docsOnly, true);
		assert.equal(result.classification, 'docs-only');
	});
}
for (const other of ['main.ts', '.github/workflows/ci.yml', 'package-lock.json', 'scripts/ci/classify-pr-validation-surface.mjs', 'docs/media/code.js', 'DOCS/media/test.png']) {
	test('mixed or non-package change requires full validation: ' + other, () => {
		assert.equal(classifyPullRequestValidationSurface(['docs/media/image.png', other]).docsOnly, false);
	});
}
test('empty changes never prove docs-only', () => {
	assert.equal(classifyPullRequestValidationSurface([]).docsOnly, false);
});
test('push uses full before/after range and schedule always scans code', () => {
	const base = 'a'.repeat(40), head = 'b'.repeat(40), calls = [];
	changedPathsBetween(base, head, args => { calls.push(args); return Buffer.from('docs/media/a.png\0main.ts\0'); }, true);
	assert.equal(calls[0].includes('--merge-base'), false);
	let output = '';
	main({argv: ['--base', base, '--head', head, '--event', 'schedule'], executeGit: () => { throw new Error('schedule must not diff'); }, write: s => { output = s; }});
	assert.match(output, /docs_only=false/);
	assert.throws(() => parseCliArguments(['--base', base, '--head', head, '--event', 'unknown']));
});

test('real Git detects deleted code and cross-boundary renames in the full push range', () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'operon-docs-ci-'));
	const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
	const execute = args => execFileSync('git', args, {cwd: root});
	try {
		git('init', '-q'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
		mkdirSync(path.join(root, 'docs/media'), {recursive: true});
		writeFileSync(path.join(root, 'main.ts'), 'code'); git('add', '.'); git('commit', '-qm', 'base');
		const base = git('rev-parse', 'HEAD');
		renameSync(path.join(root, 'main.ts'), path.join(root, 'docs/media/a.png'));
		git('add', '-A'); git('commit', '-qm', 'move');
		const moved = git('rev-parse', 'HEAD');
		writeFileSync(path.join(root, 'docs/media/b.png'), 'image'); git('add', '.'); git('commit', '-qm', 'docs');
		const head = git('rev-parse', 'HEAD');
		assert.equal(classifyPullRequestValidationSurface(changedPathsBetween(base, head, execute, true)).docsOnly, false);
		assert.equal(classifyPullRequestValidationSurface(changedPathsBetween(moved, head, execute, true)).docsOnly, true);
		assert.throws(() => changedPathsBetween('0'.repeat(40), head, execute, true), /COMPARISON_UNAVAILABLE/);
	} finally { rmSync(root, {recursive: true, force: true}); }
});

for (const scenario of ['valid', 'bad-manifest', 'broken-link', 'missing-media', 'symlink']) {
	test('docs-only package validator rejects invalid publication: ' + scenario, () => {
		const root = mkdtempSync(path.join(os.tmpdir(), 'operon-docs-package-'));
		try {
			mkdirSync(path.join(root, 'scripts'), {recursive: true});
			mkdirSync(path.join(root, 'docs/operon-docs'), {recursive: true});
			mkdirSync(path.join(root, 'docs/media'), {recursive: true});
			copyFileSync(new URL('../test-operon-docs-package.mjs', import.meta.url), path.join(root, 'scripts/test-operon-docs-package.mjs'));
			const text = scenario === 'broken-link' ? '[[DOCS-999 Missing]]' : scenario === 'missing-media' ? 'https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/missing.png' : '# Valid';
			writeFileSync(path.join(root, 'docs/operon-docs/DOCS-001 Test.md'), text);
			const manifest = {schemaVersion: 1, packageId: 'operon-docs', generatedAt: '2026-10-06T00:00:00Z', source: {branch: 'main', docsBasePath: 'docs/operon-docs', mediaBasePath: 'docs/media'}, files: [{path: 'DOCS-001 Test.md', bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex')}]};
			if (scenario === 'bad-manifest') manifest.files[0].sha256 = '0'.repeat(64);
			if (scenario === 'symlink') symlinkSync('../operon-docs/DOCS-001 Test.md', path.join(root, 'docs/media/link.png'));
			writeFileSync(path.join(root, 'docs/operon-docs/manifest.json'), JSON.stringify(manifest));
			const env = {...process.env}; delete env.OPERON_DOCS_SOURCE_ROOT; delete env.NODE_TEST_CONTEXT;
			const result = spawnSync(process.execPath, ['--test', 'scripts/test-operon-docs-package.mjs'], {cwd: root, env, encoding: 'utf8'});
			assert.equal(result.status, scenario === 'valid' ? 0 : 1, result.stdout + result.stderr);
		} finally { rmSync(root, {recursive: true, force: true}); }
	});
}

for (const [file, gates] of [['ci.yml', ['validate', 'windows-native']], ['codeql.yml', ['analyze']]]) {
	test('classification identity guard rejects unsafe workflow mutations: ' + file, () => {
		const original = parseYaml(readFileSync(new URL('../../.github/workflows/' + file, import.meta.url), 'utf8'));
		const assertions = {assertEqual: (label, actual, expected) => assert.equal(actual, expected, label), assertNoMatch: () => {}};
		const check = document => checkDocsClassificationGate(document, file, gates, assertions);
		check(original);
		for (const mutate of [
			document => { document.jobs.surface.steps.find(step => step.id === 'surface').env.BASE_SHA = 'HEAD^'; },
			document => { document.jobs.surface.steps.find(step => step.id === 'surface').env.HEAD_SHA = 'HEAD'; },
			document => { document.jobs.surface.steps[0].with.ref = 'main'; },
			document => { document.jobs.surface.steps[0].with['fetch-depth'] = 1; },
			document => { document.jobs[gates[0]].steps[0].run = 'exit 0'; },
		]) {
			const document = structuredClone(original); mutate(document); assert.throws(() => check(document));
		}
	});
}
