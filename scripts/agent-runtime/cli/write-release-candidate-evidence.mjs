#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readAcceptedPublicV1Freeze } from './release-contract.mjs';

const [releaseRootArgument, outputArgument, pluginEvidenceArgument] = process.argv.slice(2);
assert.ok(releaseRootArgument, 'Release directory is required.');
assert.ok(outputArgument, 'Evidence output path is required.');

const releaseRoot = path.resolve(releaseRootArgument);
const pluginRoot = path.resolve(releaseRoot, '../../..');
const tarballs = (await readdir(releaseRoot))
	.filter(name => name.endsWith('.tgz'))
	.sort();
assert.equal(tarballs.length, 1, 'Candidate directory must contain exactly one tarball.');

const tarballPath = path.join(releaseRoot, tarballs[0]);
const bytes = await readFile(tarballPath);
const packageDocument = JSON.parse(
	await readFile(path.resolve(releaseRoot, '../package.json'), 'utf8'),
);
assert.match(packageDocument.version, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
const manifestBytes = await readFile(path.resolve(releaseRoot, '../cli-manifest-v1.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const pluginReleaseEvidence = pluginEvidenceArgument
	? JSON.parse(await readFile(path.resolve(pluginEvidenceArgument), 'utf8'))
	: null;
const pluginRelease = pluginReleaseEvidence
	? {
		kind: pluginReleaseEvidence.kind,
		releaseTag: pluginReleaseEvidence.releaseTag,
		pluginId: pluginReleaseEvidence.pluginId,
		pluginVersion: pluginReleaseEvidence.pluginVersion,
		mainJsSha256: pluginReleaseEvidence.mainJsSha256,
		manifestSha256: pluginReleaseEvidence.manifestSha256,
		stylesCssSha256: pluginReleaseEvidence.stylesCssSha256,
	}
	: null;
const { freeze, binding: publicV1Freeze } =
	await readAcceptedPublicV1Freeze(pluginRoot);
const tarballSha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(
	tarballSha256,
	freeze.cli.tarball.sha256,
	'Release candidate tarball does not match the accepted Public V1 freeze.',
);
if (process.env.REQUIRE_PUBLIC_PLUGIN_RELEASE === '1') {
	assert.ok(pluginRelease, 'Public Operon plugin release evidence is required.');
}
if (pluginReleaseEvidence) {
	assert.equal(pluginReleaseEvidence.evidenceVersion, 2);
	assert.equal(pluginReleaseEvidence.kind, 'operon-public-plugin-release');
	assert.equal(pluginReleaseEvidence.pluginId, 'operon');
	assert.match(pluginReleaseEvidence.mainJsSha256, /^[a-f0-9]{64}$/u);
	assert.match(pluginReleaseEvidence.manifestSha256, /^[a-f0-9]{64}$/u);
	assert.match(pluginReleaseEvidence.stylesCssSha256, /^[a-f0-9]{64}$/u);
	assert.deepEqual(pluginReleaseEvidence.publicV1Freeze, publicV1Freeze);
}
assert.equal(manifest.package.name, packageDocument.name);
assert.equal(manifest.package.version, packageDocument.version);
assert.equal(tarballs[0], `${packageDocument.name}-${packageDocument.version}.tgz`);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
	cwd: pluginRoot,
	encoding: 'utf8',
}).trim();
assert.match(sourceCommit, /^[a-f0-9]{40}$/u);
const trackedTreeClean = execFileSync(
	'git',
	['status', '--porcelain', '--untracked-files=all'],
	{ cwd: pluginRoot, encoding: 'utf8' },
).trim() === '';
if (process.env.REQUIRE_CLEAN_SOURCE === '1') {
	assert.equal(
		trackedTreeClean,
		true,
		'Release candidate source has tracked or untracked changes.',
	);
}

const evidence = {
	evidenceVersion: 2,
	kind: 'operon-cli-release-candidate',
	package: `${packageDocument.name}@${packageDocument.version}`,
	tarball: tarballs[0],
	sha256: tarballSha256,
	sizeBytes: (await stat(tarballPath)).size,
	cliManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
	aggregateContractSha256: manifest.contractDigest,
	platforms: manifest.platforms,
	manifestVersion: manifest.manifestVersion,
	commandCounts: {
		local: manifest.commands.local.length,
		runtime: manifest.commands.runtime.length,
		convenience: manifest.commands.convenience.length,
	},
	schemaDigests: manifest.schemas,
	source: {
		commit: sourceCommit,
		ref: process.env.SOURCE_REF ?? null,
		trackedTreeClean,
	},
	compatiblePublicPlugin: pluginRelease,
	publicV1Freeze,
	releaseAcceptance: {
		hostedPortability: 'required',
		nativeDesktopCertification: 'optional-post-release',
	},
	publishPerformed: false,
};

await writeFile(path.resolve(outputArgument), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
