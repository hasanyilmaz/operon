#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertOperonPublicRuntimeV1,
	readAcceptedPublicV1Freeze,
} from './release-contract.mjs';

const [candidateEvidenceArgument, releaseRootArgument] = process.argv.slice(2);
assert.ok(candidateEvidenceArgument, 'Candidate evidence path is required.');
assert.ok(releaseRootArgument, 'Downloaded public plugin release directory is required.');

const candidate = JSON.parse(await readFile(path.resolve(candidateEvidenceArgument), 'utf8'));
const expected = candidate.compatiblePublicPlugin;
assert.equal(expected?.kind, 'operon-public-plugin-release');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const { freeze, binding: publicV1Freeze } =
	await readAcceptedPublicV1Freeze(repositoryRoot);
const releaseRoot = path.resolve(releaseRootArgument);
const manifestBytes = await readFile(path.join(releaseRoot, 'manifest.json'));
const mainBytes = await readFile(path.join(releaseRoot, 'main.js'));
const stylesBytes = await readFile(path.join(releaseRoot, 'styles.css'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assertOperonPublicRuntimeV1(
	manifest,
	{ mainBytes, manifestBytes, stylesBytes },
	freeze,
);

assert.equal(expected.evidenceVersion, 2);
assert.equal(manifest.id, expected.pluginId);
assert.equal(manifest.version, expected.pluginVersion);
assert.equal(expected.releaseTag, expected.pluginVersion);
assert.equal(hash(mainBytes), expected.mainJsSha256);
assert.equal(hash(manifestBytes), expected.manifestSha256);
assert.equal(hash(stylesBytes), expected.stylesCssSha256);
assert.deepEqual(candidate.publicV1Freeze, publicV1Freeze);

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	plugin: `${expected.pluginId}@${expected.pluginVersion}`,
	mainJsSha256: expected.mainJsSha256,
}, null, 2)}\n`);

function hash(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
