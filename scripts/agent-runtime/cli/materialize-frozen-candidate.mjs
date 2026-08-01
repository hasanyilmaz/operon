#!/usr/bin/env node

import assert from 'node:assert/strict';
import { COPYFILE_EXCL } from 'node:constants';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readAcceptedPublicV1Freeze } from './release-contract.mjs';

export async function materializeFrozenCandidate({ repositoryRoot, outputRoot }) {
	const root = path.resolve(repositoryRoot);
	const output = path.resolve(outputRoot);
	assert.equal(
		output,
		path.join(root, 'packages/operon-cli/release'),
		'Candidate output directory must be the canonical release directory.',
	);
	const { freeze } = await readAcceptedPublicV1Freeze(root);
	const packageDocument = JSON.parse(await readFile(
		path.join(root, 'packages/operon-cli/package.json'),
		'utf8',
	));
	assert.equal(freeze.state, 'accepted', 'Public V1 freeze must be accepted.');
	assert.equal(
		freeze.cli?.packageVersion,
		packageDocument.version,
		'Frozen CLI version does not match package metadata.',
	);
	const fileName = `operon-cli-${packageDocument.version}.tgz`;
	const relativeSource = `packages/operon-cli/freeze/${fileName}`;
	assert.equal(
		freeze.cli?.tarball?.path,
		relativeSource,
		'Frozen CLI tarball path is not canonical.',
	);
	const source = path.join(root, relativeSource);
	const sourceStat = await lstat(source);
	assert.equal(sourceStat.isSymbolicLink(), false, 'Frozen CLI tarball cannot be a symlink.');
	assert.equal(sourceStat.isFile(), true, 'Frozen CLI tarball must be a regular file.');
	const bytes = await readFile(source);
	assert.equal(bytes.length, freeze.cli.tarball.bytes, 'Frozen CLI tarball size drifted.');
	assert.equal(sha256(bytes), freeze.cli.tarball.sha256, 'Frozen CLI tarball digest drifted.');
	try {
		await mkdir(output);
	} catch (error) {
		if (error?.code !== 'EEXIST') throw error;
		const outputStat = await lstat(output);
		assert.equal(outputStat.isSymbolicLink(), false, 'Candidate output cannot be a symlink.');
		assert.equal(outputStat.isDirectory(), true, 'Candidate output must be a directory.');
		assert.deepEqual(
			await readdir(output),
			[],
			'Candidate output directory must be empty.',
		);
	}
	const destination = path.join(output, fileName);
	await copyFile(source, destination, COPYFILE_EXCL);
	const copied = await readFile(destination);
	const destinationStat = await lstat(destination);
	assert.equal(destinationStat.isSymbolicLink(), false);
	assert.equal(destinationStat.isFile(), true);
	assert.equal(copied.length, freeze.cli.tarball.bytes);
	assert.equal(sha256(copied), freeze.cli.tarball.sha256);
	return {
		fileName,
		path: destination,
		bytes: copied.length,
		sha256: freeze.cli.tarball.sha256,
	};
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const outputArgument = process.argv[2];
	assert.ok(outputArgument, 'Candidate output directory is required.');
	const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
	const result = await materializeFrozenCandidate({
		repositoryRoot: path.resolve(scriptDirectory, '../../..'),
		outputRoot: outputArgument,
	});
	process.stdout.write(`${JSON.stringify({ status: 'ok', ...result }, null, 2)}\n`);
}
