#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	assertOperonPublicRuntimeV1,
	readAcceptedPublicV1Freeze,
} from './release-contract.mjs';

const [releaseRootArgument, releaseTag, outputArgument] = process.argv.slice(2);
assert.ok(releaseRootArgument, 'Downloaded plugin release directory is required.');
assert.ok(releaseTag, 'Public plugin release tag is required.');
assert.ok(outputArgument, 'Plugin release evidence output path is required.');

const releaseRoot = path.resolve(releaseRootArgument);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const manifestBytes = await readFile(path.join(releaseRoot, 'manifest.json'));
const mainBytes = await readFile(path.join(releaseRoot, 'main.js'));
const stylesBytes = await readFile(path.join(releaseRoot, 'styles.css'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const { freeze, binding: publicV1Freeze } =
	await readAcceptedPublicV1Freeze(repositoryRoot);

assert.equal(manifest.version, releaseTag, 'Plugin release tag must equal manifest version.');
assert.ok(mainBytes.length > 0, 'Public plugin main.js must not be empty.');
assertOperonPublicRuntimeV1(
	manifest,
	{ mainBytes, manifestBytes, stylesBytes },
	freeze,
);

const evidence = {
	evidenceVersion: 2,
	kind: 'operon-public-plugin-release',
	releaseTag,
	pluginId: manifest.id,
	pluginVersion: manifest.version,
	mainJsSha256: createHash('sha256').update(mainBytes).digest('hex'),
	mainJsSizeBytes: mainBytes.length,
	manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
	stylesCssSha256: createHash('sha256').update(stylesBytes).digest('hex'),
	runtimeCompatibility: {
		evidenceKind: 'accepted-public-v1-freeze',
		runtimeApi: publicV1Freeze.runtimeApi,
		runtimeSchemaAggregateSha256: publicV1Freeze.runtimeSchemaAggregateSha256,
	},
	publicV1Freeze,
};

await writeFile(path.resolve(outputArgument), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
