#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isGitSourceCleanV1 } from './native-acceptance-lib.mjs';
import {
	assertOperonPublicRuntimeV1,
	readAcceptedPublicV1Freeze,
} from './release-contract.mjs';

const [candidateRootArgument, pluginArtifactRootArgument, outputArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(pluginArtifactRootArgument, 'Operon plugin candidate artifact directory is required.');
assert.ok(outputArgument, 'Native candidate evidence output is required.');

const candidateRoot = path.resolve(candidateRootArgument);
const pluginArtifactRoot = path.resolve(pluginArtifactRootArgument);
const repositoryRoot = path.resolve(candidateRoot, '../../..');
const tarballs = (await readdir(candidateRoot)).filter(name => name.endsWith('.tgz')).sort();
assert.equal(tarballs.length, 1, 'Native candidate directory must contain exactly one tarball.');
const tarballPath = path.join(candidateRoot, tarballs[0]);
const tarballBytes = await readFile(tarballPath);
const packageDocument = JSON.parse(await readFile(
	path.join(repositoryRoot, 'packages/operon-cli/package.json'),
	'utf8',
));
assert.match(packageDocument.version, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
const cliManifestBytes = await readFile(
	path.join(repositoryRoot, 'packages/operon-cli/cli-manifest-v1.json'),
);
const cliManifest = JSON.parse(cliManifestBytes.toString('utf8'));
assert.equal(tarballs[0], `${packageDocument.name}-${packageDocument.version}.tgz`);
assert.equal(cliManifest.package.name, packageDocument.name);
assert.equal(cliManifest.package.version, packageDocument.version);
assert.match(cliManifest.contractDigest, /^[a-f0-9]{64}$/u);

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: repositoryRoot,
	encoding: 'utf8',
}).trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/u);
const sourceClean = isGitSourceCleanV1(repositoryRoot);
if (process.env.REQUIRE_CLEAN_SOURCE !== '0') {
	assert.equal(sourceClean, true, 'Native acceptance candidate requires an exact clean source tree.');
}

const pluginManifestBytes = await readFile(path.join(pluginArtifactRoot, 'manifest.json'));
const pluginManifest = JSON.parse(pluginManifestBytes.toString('utf8'));
const pluginMainBytes = await readFile(path.join(pluginArtifactRoot, 'main.js'));
const pluginStylesBytes = await readFile(path.join(pluginArtifactRoot, 'styles.css'));
const { freeze, binding: publicV1Freeze } =
	await readAcceptedPublicV1Freeze(repositoryRoot);
const tarballSha256 = sha256(tarballBytes);
assert.equal(
	tarballSha256,
	freeze.cli.tarball.sha256,
	'Native candidate tarball does not match the accepted Public V1 freeze.',
);
assertOperonPublicRuntimeV1(
	pluginManifest,
	{
		mainBytes: pluginMainBytes,
		manifestBytes: pluginManifestBytes,
		stylesBytes: pluginStylesBytes,
	},
	freeze,
);
const pluginCandidate = {
	kind: 'operon-plugin-native-candidate',
	pluginId: 'operon',
	pluginVersion: pluginManifest.version,
	sourceCommit,
	mainJsSha256: sha256(pluginMainBytes),
	manifestSha256: sha256(pluginManifestBytes),
	stylesCssSha256: sha256(pluginStylesBytes),
};
const evidence = {
	evidenceVersion: 2,
	kind: 'operon-cli-native-candidate',
	package: `${packageDocument.name}@${packageDocument.version}`,
	tarball: tarballs[0],
	sha256: tarballSha256,
	sizeBytes: (await stat(tarballPath)).size,
	cliManifestSha256: sha256(cliManifestBytes),
	aggregateContractSha256: cliManifest.contractDigest,
	platforms: cliManifest.platforms,
	source: {
		commit: sourceCommit,
		ref: process.env.SOURCE_REF || sourceCommit,
		trackedTreeClean: sourceClean,
	},
	compatiblePublicPlugin: pluginCandidate,
	publicV1Freeze,
	nativeAcceptance: 'required',
	publishPerformed: false,
};
await writeFile(path.resolve(outputArgument), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}
