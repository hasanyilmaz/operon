#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { OPERON_CLI_NPM_PACKAGE_NAME } from '../../../packages/operon-cli/package-identity.mjs';

const [candidateRootArgument, registryRootArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
assert.ok(registryRootArgument, 'Registry download directory is required.');

const candidateRoot = path.resolve(candidateRootArgument);
const registryRoot = path.resolve(registryRootArgument);

async function readSingleTarball(directory, label) {
	const tarballs = (await readdir(directory))
		.filter(name => name.endsWith('.tgz'))
		.sort();
	assert.equal(tarballs.length, 1, `${label} directory must contain exactly one tarball.`);
	const bytes = await readFile(path.join(directory, tarballs[0]));
	return {
		name: tarballs[0],
		bytes,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}

const evidence = JSON.parse(
	await readFile(path.join(candidateRoot, 'candidate-evidence.json'), 'utf8'),
);
const candidate = await readSingleTarball(candidateRoot, 'Candidate');
const registry = await readSingleTarball(registryRoot, 'Registry download');

assert.equal(evidence.kind, 'operon-cli-release-candidate');
assert.equal(evidence.tarball, candidate.name);
assert.equal(evidence.sha256, candidate.sha256);
assert.match(evidence.package, /^@stratejya\/operon-cli@[0-9]+\.[0-9]+\.[0-9]+$/u);
assert.equal(registry.name, candidate.name);
assert.equal(
	registry.sha256,
	candidate.sha256,
	'Registry tarball SHA-256 does not match the accepted release candidate.',
);
assert.deepEqual(
	registry.bytes,
	candidate.bytes,
	'Registry tarball bytes do not match the accepted release candidate.',
);

if (process.env.EXPECTED_VERSION) {
	assert.equal(evidence.package, `${OPERON_CLI_NPM_PACKAGE_NAME}@${process.env.EXPECTED_VERSION}`);
}
if (process.env.EXPECTED_SHA256) {
	assert.equal(registry.sha256, process.env.EXPECTED_SHA256);
}

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	package: evidence.package,
	tarball: registry.name,
	sha256: registry.sha256,
	byteIdentical: true,
}, null, 2)}\n`);
