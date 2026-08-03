import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../../../.github/workflows/cli-external-compatibility.yml', import.meta.url);

test('external CLI proof workflow is manual, read-only, and publish-free', async () => {
	const source = await readFile(workflowUrl, 'utf8');
	assert.match(source, /^on:\n  workflow_dispatch:\s*$/mu);
	assert.doesNotMatch(source, /pull_request_target|\bpush:|\bpull_request:|\brelease:|\bschedule:|workflow_call/u);
	assert.match(source, /^permissions:\n  contents: read$/mu);
	assert.doesNotMatch(source, /id-token:\s*write|npm\s+(?:publish|stage)|upload-artifact/u);
	assert.match(source, /^\s+NODE_AUTH_TOKEN: ""$/mu);
	assert.match(source, /^\s+NPM_TOKEN: ""$/mu);
	assert.match(source, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
	assert.match(source, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
	assert.match(source, /^\s+package-manager-cache:\s*false\s*$/mu);
	assert.doesNotMatch(source, /^\s+cache:/mu);
	assert.match(source, /npm-11\.12\.1\.tgz/u);
	assert.match(source, /sha512-zcoUuF1kezGSAo0CqtvoLXX3mkRqzuqYdL6Y5tdo8g69NVV3CkjQ6ZBhBgB4d7vGkPcV6TcvLi3GRKPDFX\+xTA==/u);
	assert.doesNotMatch(source, /\bnpx\b/u);
	assert.match(source, /^\s+GH_TOKEN: \$\{\{ github\.token \}\}$/mu);
	assert.match(source, /agent-runtime:external-cli:public-proof/u);
});
