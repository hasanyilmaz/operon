#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	readAcceptedPublicV1Freeze,
} from './release-contract.mjs';

const [candidateRootArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const candidateRoot = path.resolve(candidateRootArgument);
const packageDocument = JSON.parse(
	await readFile(path.join(pluginRoot, 'packages/operon-cli/package.json'), 'utf8'),
);
const evidence = JSON.parse(
	await readFile(path.join(candidateRoot, 'candidate-evidence.json'), 'utf8'),
);
const tarballs = (await readdir(candidateRoot)).filter(name => name.endsWith('.tgz'));
assert.equal(tarballs.length, 1, 'Candidate directory must contain exactly one tarball.');
const tarballPath = path.join(candidateRoot, tarballs[0]);
const tarballBytes = await readFile(tarballPath);
const cliManifestBytes = await readFile(
	path.join(pluginRoot, 'packages/operon-cli/cli-manifest-v1.json'),
);
const cliManifest = JSON.parse(cliManifestBytes.toString('utf8'));
const actualSha256 = createHash('sha256').update(tarballBytes).digest('hex');
const { freeze, binding: publicV1Freeze } =
	await readAcceptedPublicV1Freeze(pluginRoot);
const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: pluginRoot,
	encoding: 'utf8',
}).trim();

assert.equal(evidence.kind, 'operon-cli-release-candidate');
assert.equal(evidence.evidenceVersion, 2);
assert.equal(evidence.package, `${packageDocument.name}@${packageDocument.version}`);
assert.equal(evidence.tarball, tarballs[0]);
assert.equal(evidence.sha256, actualSha256);
assert.equal(
	actualSha256,
	freeze.cli.tarball.sha256,
	'Release candidate tarball does not match the accepted Public V1 freeze.',
);
assert.deepEqual(evidence.publicV1Freeze, publicV1Freeze);
assert.equal(
	evidence.cliManifestSha256,
	createHash('sha256').update(cliManifestBytes).digest('hex'),
);
assert.equal(evidence.aggregateContractSha256, cliManifest.contractDigest);
assert.deepEqual(evidence.platforms, cliManifest.platforms);
assert.equal(evidence.source?.commit, headCommit);
assert.equal(evidence.source?.trackedTreeClean, true);
assert.deepEqual(evidence.releaseAcceptance, {
	hostedPortability: 'required',
	nativeDesktopCertification: 'optional-post-release',
});
if (process.env.REQUIRE_PUBLIC_PLUGIN_RELEASE === '1') {
	assert.equal(evidence.compatiblePublicPlugin?.evidenceVersion, 2);
	assert.equal(evidence.compatiblePublicPlugin?.kind, 'operon-public-plugin-release');
	assert.equal(evidence.compatiblePublicPlugin?.pluginId, 'operon');
	assert.equal(
		evidence.compatiblePublicPlugin?.pluginVersion,
		freeze.plugin.version,
		'Compatible public Operon release must match the accepted Public V1 freeze.',
	);
	assert.match(evidence.compatiblePublicPlugin?.mainJsSha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.match(evidence.compatiblePublicPlugin?.manifestSha256 ?? '', /^[a-f0-9]{64}$/u);
	assert.match(evidence.compatiblePublicPlugin?.stylesCssSha256 ?? '', /^[a-f0-9]{64}$/u);
}
if (process.env.EXPECTED_SHA256) {
	assert.equal(actualSha256, process.env.EXPECTED_SHA256);
}
if (process.env.EXPECTED_SOURCE_REF) {
	assert.equal(evidence.source?.ref, process.env.EXPECTED_SOURCE_REF);
}
if (process.env.REQUIRE_EXACT_GIT_TAG === '1') {
	const expectedTag = `cli-v${packageDocument.version}`;
	assert.equal(process.env.EXPECTED_SOURCE_REF, expectedTag);
	execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${expectedTag}`], {
		cwd: pluginRoot,
	});
	const tagCommit = execFileSync('git', ['rev-list', '-n', '1', `refs/tags/${expectedTag}`], {
		cwd: pluginRoot,
		encoding: 'utf8',
	}).trim();
	assert.equal(tagCommit, headCommit);
}

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	package: evidence.package,
	sourceCommit: headCommit,
	tarballSha256: actualSha256,
}, null, 2)}\n`);
