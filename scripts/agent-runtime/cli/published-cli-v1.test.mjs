import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
	sha256,
	verifyCanonicalPluginInputs,
	verifyPublishedCliExecutablePath,
	verifyTarballIdentity,
	withVerifiedPublishedCli,
} from './published-cli-v1.mjs';
import { readArtifactArguments } from './check-published-cli-artifact.mjs';
import { symlinkCapabilityUnavailableReason } from '../../test-symlink-capability.mjs';
import { fetchPublicProofBytes, publicProofRequest, verifyGithubTagIdentity } from './check-published-cli-public-proof.mjs';

test('accepted binding validates and canonical plugin inputs match', async () => {
	const { binding } = await loadPublishedCliBinding();
	assertPublishedCliBinding(binding);
	await verifyCanonicalPluginInputs(binding);
	assert.equal(binding.package.version, '1.1.0');
	assert.deepEqual(binding.source.tagObject, {
		type: 'commit',
		sha: binding.source.commit,
	});
	assert.equal(binding.runtime.canonicalSchemas.filter(item => item.path.includes('/extensions/')).length, 6);
	assert.match(bindingAggregate(binding), /^[a-f0-9]{64}$/u);
});

test('GitHub tag proof accepts exact lightweight and annotated tag identities', async () => {
	const commit = 'a'.repeat(40);
	const tagObject = 'b'.repeat(40);
	const lightweight = {
		source: {
			tag: 'cli-v1.1.0',
			commit,
			tagObject: { type: 'commit', sha: commit },
		},
	};
	let requests = 0;
	assert.equal(await verifyGithubTagIdentity(lightweight, async () => {
		requests += 1;
		return { object: { type: 'commit', sha: commit } };
	}), true);
	assert.equal(requests, 1);

	const annotated = {
		source: {
			tag: 'cli-v1.0.9',
			commit,
			tagObject: { type: 'tag', sha: tagObject },
		},
	};
	requests = 0;
	assert.equal(await verifyGithubTagIdentity(annotated, async url => {
		requests += 1;
		return url.includes('/git/tags/')
			? { object: { type: 'commit', sha: commit } }
			: { object: { type: 'tag', sha: tagObject } };
	}), true);
	assert.equal(requests, 2);

	await assert.rejects(
		verifyGithubTagIdentity(lightweight, async () => ({
			object: { type: 'commit', sha: 'c'.repeat(40) },
		})),
		/OPERON_PUBLISHED_CLI_TAG_OBJECT_MISMATCH/u,
	);
});

test('public proof authenticates only GitHub API requests', () => {
	assert.deepEqual(
		publicProofRequest('https://api.github.com/repos/hasanyilmaz/operon-cli/actions/runs/1', { accept: 'application/json' }, { GH_TOKEN: ' fixture-token ', GITHUB_TOKEN: 'fallback' }),
		{ githubApi: true, headers: { accept: 'application/json', authorization: 'Bearer fixture-token', 'user-agent': 'operon-plugin-public-cli-proof/1' }, redirect: 'manual' },
	);
	assert.deepEqual(
		publicProofRequest('https://api.github.com/repos/example', {}, { GITHUB_TOKEN: 'fallback' }),
		{ githubApi: true, headers: { authorization: 'Bearer fallback', 'user-agent': 'operon-plugin-public-cli-proof/1' }, redirect: 'manual' },
	);
	for (const url of [
		'https://github.com/hasanyilmaz/operon-cli/releases/download/cli-v1.1.0/file.tgz',
		'https://objects.githubusercontent.com/release-asset',
		'https://registry.npmjs.org/package',
		'https://registry.npmjs.org/package/-/package.tgz',
		'https://api.github.com.evil.example/repos/example',
		'http://api.github.com/repos/example',
		'https://api.github.com:444/repos/example',
		'https://user:password@api.github.com/repos/example',
	]) {
		assert.deepEqual(
			publicProofRequest(url, { Authorization: 'caller-controlled' }, { GH_TOKEN: 'fixture-token' }),
			{ githubApi: false, headers: { 'user-agent': 'operon-plugin-public-cli-proof/1' }, redirect: 'follow' },
		);
	}
	assert.deepEqual(
		publicProofRequest('https://api.github.com/repos/example', {}, {}),
		{ githubApi: true, headers: { 'user-agent': 'operon-plugin-public-cli-proof/1' }, redirect: 'manual' },
	);
});

test('public proof refuses GitHub API redirects without following the location', async () => {
	let requests = 0;
	await assert.rejects(
		fetchPublicProofBytes('https://api.github.com/repos/example', {}, {
			environment: { GH_TOKEN: 'fixture-token' },
			fetchImpl: async (_url, init) => {
				requests += 1;
				assert.equal(init.redirect, 'manual');
				assert.equal(init.headers.authorization, 'Bearer fixture-token');
				return { status: 302, ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
			},
		}),
		/OPERON_PUBLISHED_CLI_GITHUB_API_REDIRECT_REFUSED/u,
	);
	assert.equal(requests, 1);
});

test('canonical plugin inputs ignore only POSIX mode on Windows while preserving size and hash checks', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-canonical-input-platform-'));
	const relativePath = 'contracts/agent-runtime/synthetic-canonical.json';
	const target = path.join(temporaryRoot, relativePath);
	const bytes = Buffer.from('{"contractVersion":1}\n', 'utf8');
	try {
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, bytes);
		await chmod(target, 0o600);
		const actualMode = (await lstat(target)).mode & 0o777;
		const mismatchedMode = actualMode === 0o600 ? 0o644 : 0o600;
		const identity = {
			path: relativePath,
			bytes: bytes.byteLength,
			sha256: sha256(bytes),
			mode: mismatchedMode,
		};
		const binding = {
			runtime: {
				canonicalSchemas: [identity],
				canonicalTypeSources: [],
			},
		};

		assert.equal(
			await verifyCanonicalPluginInputs(binding, { pluginRoot: temporaryRoot, platform: 'win32' }),
			true,
		);
		await assert.rejects(
			verifyCanonicalPluginInputs(binding, { pluginRoot: temporaryRoot, platform: 'linux' }),
			/OPERON_PUBLISHED_CLI_CANONICAL_MODE_MISMATCH/u,
		);

		await assert.rejects(
			verifyCanonicalPluginInputs({
				runtime: {
					canonicalSchemas: [{ ...identity, bytes: identity.bytes + 1 }],
					canonicalTypeSources: [],
				},
			}, { pluginRoot: temporaryRoot, platform: 'win32' }),
			/OPERON_PUBLISHED_CLI_CANONICAL_SIZE_MISMATCH/u,
		);
		await assert.rejects(
			verifyCanonicalPluginInputs({
				runtime: {
					canonicalSchemas: [{ ...identity, sha256: '0'.repeat(64) }],
					canonicalTypeSources: [],
				},
			}, { pluginRoot: temporaryRoot, platform: 'win32' }),
			/OPERON_PUBLISHED_CLI_CANONICAL_HASH_MISMATCH/u,
		);

	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('canonical plugin input verification rejects a symlink', {
	skip: symlinkCapabilityUnavailableReason(),
}, async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-canonical-input-symlink-'));
	const relativePath = 'contracts/agent-runtime/synthetic-canonical.json';
	const target = path.join(temporaryRoot, relativePath);
	const realTarget = `${target}.real`;
	const bytes = Buffer.from('{"contractVersion":1}\n', 'utf8');
	try {
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(realTarget, bytes);
		await symlink(realTarget, target);
		await assert.rejects(
			verifyCanonicalPluginInputs({
				runtime: {
					canonicalSchemas: [{
						path: relativePath,
						bytes: bytes.byteLength,
						sha256: sha256(bytes),
						mode: 0o600,
					}],
					canonicalTypeSources: [],
				},
			}, { pluginRoot: temporaryRoot, platform: 'win32' }),
			/OPERON_PUBLISHED_CLI_CANONICAL_FILE_INVALID/u,
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
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
	mutated.package.version = '1.0.10';
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

test('tarball verification rejects a relative path before reading bytes', async () => {
	const { binding } = await loadPublishedCliBinding();
	await assert.rejects(
		verifyTarballIdentity('candidate.tgz', binding),
		/OPERON_PUBLISHED_CLI_TARBALL_PATH_INVALID/u,
	);
});

test('tarball verification rejects a symlink before reading bytes', {
	skip: symlinkCapabilityUnavailableReason(),
}, async () => {
	const { binding } = await loadPublishedCliBinding();
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

test('published executable verification uses the binding byte identity', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-executable-identity-'));
	try {
		const executable = path.join(temporaryRoot, 'operon.mjs');
		const bytes = Buffer.from('#!/usr/bin/env node\n', 'utf8');
		await writeFile(executable, bytes);
		await chmod(executable, 0o755);
		const binding = {
			artifact: {
				executable: {
					bytes: bytes.byteLength,
					mode: 0o755,
					sha256: sha256(bytes),
				},
			},
		};
		assert.equal(await verifyPublishedCliExecutablePath(executable, binding), executable);
		await assert.rejects(
			verifyPublishedCliExecutablePath(executable, {
				artifact: { executable: { ...binding.artifact.executable, bytes: bytes.byteLength + 1 } },
			}),
			/OPERON_PUBLISHED_CLI_EXECUTABLE_BYTES_MISMATCH/u,
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
