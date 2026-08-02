import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	assertPublishedCliBinding,
	artifactInventoryAggregate,
	bindingAggregate,
	bindingPath,
	loadPublishedCliBinding,
	sanitizedChildEnvironment,
	verifyCanonicalPluginInputs,
	verifyTarballIdentity,
	withVerifiedPublishedCli,
} from './published-cli-v1.mjs';
import { readArtifactArguments } from './check-published-cli-artifact.mjs';

test('accepted binding validates and canonical plugin inputs match', async () => {
	const { binding } = await loadPublishedCliBinding();
	assertPublishedCliBinding(binding);
	await verifyCanonicalPluginInputs(binding);
	assert.match(bindingAggregate(binding), /^[a-f0-9]{64}$/u);
});

test('schema and declaration aggregates are derived from exact inventory subsets', async () => {
	const { binding } = await loadPublishedCliBinding();
	assert.equal(
		artifactInventoryAggregate(binding.artifact.inventory, 'package/schemas/v1/'),
		binding.artifact.schemaAggregateSha256,
	);
	assert.equal(
		artifactInventoryAggregate(binding.artifact.inventory, 'package/types/'),
		binding.artifact.declarationAggregateSha256,
	);
	const mutated = structuredClone(binding);
	mutated.artifact.schemaAggregateSha256 = '0'.repeat(64);
	mutated.bindingAggregateSha256 = bindingAggregate(mutated);
	assert.throws(
		() => assertPublishedCliBinding(mutated),
		/OPERON_PUBLISHED_CLI_SCHEMA_AGGREGATE_MISMATCH/u,
	);
});

test('child environment removes case-variant npm auth and registry configuration', () => {
	const sanitized = sanitizedChildEnvironment({
		Path: '/safe/bin',
		Node_Auth_Token: 'secret-a',
		NPM_TOKEN: 'secret-b',
		Npm_Config_Registry: 'https://attacker.invalid/',
		npm_config_userconfig: '/private/config',
		NPM_CONFIG__AUTHTOKEN: 'secret-c',
		SAFE_VALUE: 'preserved',
	});
	assert.deepEqual(sanitized, {
		PATH: '/safe/bin',
		NO_COLOR: '1',
		SAFE_VALUE: 'preserved',
	});
});

test('binding mutation fails closed through its self aggregate', async () => {
	const { binding } = await loadPublishedCliBinding();
	const mutated = structuredClone(binding);
	mutated.package.version = '1.0.9';
	assert.throws(
		() => assertPublishedCliBinding(mutated),
		/OPERON_PUBLISHED_CLI_BINDING_AGGREGATE_INVALID/u,
	);
});

test('binding schema rejects an unknown top-level field', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-binding-negative-'));
	try {
		const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
		binding.unreviewed = true;
		binding.bindingAggregateSha256 = bindingAggregate(binding);
		const target = path.join(temporaryRoot, 'binding.json');
		await writeFile(target, `${JSON.stringify(binding)}\n`, 'utf8');
		await assert.rejects(
			loadPublishedCliBinding({ bindingPath: target }),
			/OPERON_PUBLISHED_CLI_BINDING_SCHEMA_INVALID/u,
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('tarball verification rejects relative and symlink paths before reading bytes', async () => {
	const { binding } = await loadPublishedCliBinding();
	await assert.rejects(
		verifyTarballIdentity('candidate.tgz', binding),
		/OPERON_PUBLISHED_CLI_TARBALL_PATH_INVALID/u,
	);
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-tarball-negative-'));
	try {
		const real = path.join(temporaryRoot, 'real.tgz');
		const link = path.join(temporaryRoot, 'link.tgz');
		await writeFile(real, 'not-a-tarball', 'utf8');
		await symlink(real, link);
		await assert.rejects(
			verifyTarballIdentity(link, binding),
			/OPERON_PUBLISHED_CLI_TARBALL_FILE_INVALID/u,
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('artifact arguments require one candidate and reject duplicate flags', () => {
	assert.deepEqual(
		readArtifactArguments(['--tarball', '/tmp/candidate.tgz']),
		{ tarballPath: '/tmp/candidate.tgz', legacyTarballPath: undefined },
	);
	assert.throws(
		() => readArtifactArguments(['--tarball', '/tmp/a.tgz', '--tarball', '/tmp/b.tgz']),
		/OPERON_PUBLISHED_CLI_ARTIFACT_USAGE/u,
	);
	assert.throws(
		() => readArtifactArguments(['--legacy-tarball', '/tmp/legacy.tgz']),
		/OPERON_PUBLISHED_CLI_ARTIFACT_USAGE/u,
	);
});

test('verified CLI callback API rejects a missing callback before artifact access', async () => {
	const { binding } = await loadPublishedCliBinding();
	await assert.rejects(
		withVerifiedPublishedCli('/not/read/without/a/callback.tgz', binding, null),
		/OPERON_PUBLISHED_CLI_CALLBACK_REQUIRED/u,
	);
});
