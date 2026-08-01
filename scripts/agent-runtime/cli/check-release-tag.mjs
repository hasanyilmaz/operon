import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageDocument = JSON.parse(
	await readFile(path.join(pluginRoot, 'packages', 'operon-cli', 'package.json'), 'utf8'),
);
const pluginManifest = JSON.parse(
	await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'),
);
assert.equal(packageDocument.name, 'operon-cli');
assert.match(packageDocument.version, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
assert.equal(pluginManifest.id, 'operon');
assert.match(pluginManifest.version, /^[0-9]+\.[0-9]+\.[0-9]+$/u);

const refName = process.env.GITHUB_REF_NAME;
const pluginReleaseValidation = process.env.OPERON_PLUGIN_RELEASE_VALIDATION;
assert.ok(
	pluginReleaseValidation === undefined || pluginReleaseValidation === '1',
	'OPERON_PLUGIN_RELEASE_VALIDATION must be unset or exactly 1.',
);
const isTagRef = process.env.GITHUB_REF_TYPE === 'tag'
	|| process.env.GITHUB_REF?.startsWith('refs/tags/') === true
	|| process.env.REQUIRE_EXACT_GIT_TAG === '1';
if (pluginReleaseValidation === '1') {
	assert.notEqual(
		process.env.REQUIRE_EXACT_GIT_TAG,
		'1',
		'Plugin release validation cannot authorize an exact CLI tag publication.',
	);
	assert.equal(isTagRef, true, 'Plugin release validation requires a tag ref.');
	assert.ok(refName, 'Plugin release tag name is required.');
	assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'Plugin release validation requires GITHUB_REF_TYPE=tag.');
	assert.equal(
		process.env.GITHUB_REF,
		`refs/tags/${refName}`,
		'Plugin release validation requires a self-consistent GitHub tag ref.',
	);
	assert.match(refName, /^[0-9]+\.[0-9]+\.[0-9]+$/u, 'Plugin release tag must be plain stable SemVer.');
	assert.equal(refName, pluginManifest.version, 'Plugin release tag must exactly match manifest.json.');
} else if (isTagRef) {
	assert.ok(refName, 'CLI release tag name is required for a tag release.');
	assert.equal(
		refName,
		`cli-v${packageDocument.version}`,
		'CLI release tag must exactly match packages/operon-cli/package.json.',
	);
	if (process.env.REQUIRE_EXACT_GIT_TAG === '1') {
		execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${refName}`], {
			cwd: pluginRoot,
		});
		const tagCommit = execFileSync('git', ['rev-list', '-n', '1', `refs/tags/${refName}`], {
			cwd: pluginRoot,
			encoding: 'utf8',
		}).trim();
		const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: pluginRoot,
			encoding: 'utf8',
		}).trim();
		assert.equal(tagCommit, headCommit, 'CLI release tag must point at the checked-out commit.');
	}
}

console.log(JSON.stringify({
	status: 'ok',
	package: `${packageDocument.name}@${packageDocument.version}`,
	validationTarget: pluginReleaseValidation === '1' ? 'plugin' : 'cli',
	expectedTag: pluginReleaseValidation === '1'
		? pluginManifest.version
		: `cli-v${packageDocument.version}`,
	publishPerformed: false,
}, null, 2));
