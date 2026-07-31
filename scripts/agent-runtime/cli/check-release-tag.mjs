import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageDocument = JSON.parse(
	await readFile(path.join(pluginRoot, 'packages', 'operon-cli', 'package.json'), 'utf8'),
);
assert.equal(packageDocument.name, 'operon-cli');
assert.match(packageDocument.version, /^[0-9]+\.[0-9]+\.[0-9]+$/u);

const refName = process.env.GITHUB_REF_NAME;
if (refName !== undefined) {
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
	expectedTag: `cli-v${packageDocument.version}`,
	publishPerformed: false,
}, null, 2));
