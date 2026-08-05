import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	readPublishedLiveArguments,
	runPublishedCliLiveAcceptance,
} from './run-published-cli-live-acceptance.mjs';

const binding = Object.freeze({
	package: { name: '@stratejya/operon-cli', version: '1.0.8' },
	tarball: { sha256: '8638e108569f7a17de39a8c7981f48fa609dab47dc2d86e18bf2453046c540c8' },
	runtime: { contractDigest: '407f3a222f8c59a9622038e99e9345d0d34882fd358149b38bce5354ae0ca92b' },
});
const pluginArtifact = Object.freeze({
	version: '3.0.2',
	files: Object.freeze([
		Object.freeze({ path: 'main.js', bytes: 10, sha256: '1'.repeat(64) }),
		Object.freeze({ path: 'manifest.json', bytes: 20, sha256: '2'.repeat(64) }),
		Object.freeze({ path: 'styles.css', bytes: 30, sha256: '3'.repeat(64) }),
	]),
});

test('published live arguments require one exact tarball, vault, and output', () => {
	assert.deepEqual(readPublishedLiveArguments([
		'--tarball', '/tmp/cli.tgz',
		'--vault', '/tmp/operon-agent-runtime-phase1-test',
		'--output', '/tmp/evidence.json',
	]), {
		tarballPath: '/tmp/cli.tgz',
		vaultPath: '/tmp/operon-agent-runtime-phase1-test',
		outputPath: '/tmp/evidence.json',
	});
	for (const argv of [
		[],
		['--tarball', '/tmp/cli.tgz'],
		['--executable', '/tmp/operon', '--vault', '/tmp/vault', '--output', '/tmp/out'],
		['--tarball', '/tmp/a', '--tarball', '/tmp/b', '--vault', '/tmp/vault'],
	]) {
		assert.throws(() => readPublishedLiveArguments(argv), /OPERON_PUBLISHED_CLI_LIVE_USAGE/u);
	}
});

test('live acceptance receives only the helper-verified executable and writes bound evidence', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-published-live-test-'));
	const disposableVault = await mkdtemp(path.join(
		process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(),
		'operon-agent-runtime-phase1-wrapper-',
	));
	try {
		const canonicalDisposableVault = await realpath(disposableVault);
		const outputPath = path.join(temporaryRoot, 'evidence.json');
		let helperCalled = false;
		const result = await runPublishedCliLiveAcceptance({
			tarballPath: '/absolute/reviewed.tgz',
			vaultPath: disposableVault,
			outputPath,
		}, {
			pluginRoot: '/fixture/plugin',
			env: {
				PATH: '/safe/bin',
				OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT: '/verified/plugin-artifact',
					OPERON_CLI_EXECUTABLE: '/untrusted/user-install',
					OPERON_PUBLISHED_CLI_EXECUTABLE: '/untrusted/published-path',
			},
			loadBinding: async () => ({ binding }),
			readPluginArtifact: async artifactRoot => {
				assert.equal(artifactRoot, '/verified/plugin-artifact');
				return pluginArtifact;
			},
			installVerified: async (tarballPath, actualBinding, callback) => {
				helperCalled = true;
				assert.equal(tarballPath, '/absolute/reviewed.tgz');
				assert.equal(actualBinding, binding);
				return callback({
					executable: '/verified/temp-prefix/dist/operon.mjs',
					npmVersion: '11.12.1',
				});
			},
			spawn: (node, argv, spawnOptions) => {
				assert.equal(node, process.execPath);
				assert.match(argv[0], /run-live-stage5-completion\.mjs$/u);
				assert.equal(argv[1], canonicalDisposableVault);
				assert.equal(spawnOptions.env.OPERON_CLI_EXECUTABLE, undefined);
				assert.equal(
					spawnOptions.env.OPERON_PUBLISHED_CLI_EXECUTABLE,
					'/verified/temp-prefix/dist/operon.mjs',
				);
				assert.equal(spawnOptions.env.PATH, '/safe/bin');
				return {
					status: 0,
					stdout: JSON.stringify({ status: 'ok', vault: path.basename(disposableVault) }),
					stderr: '',
				};
			},
		});
		assert.equal(helperCalled, true);
		assert.equal(result.package, '@stratejya/operon-cli@1.0.8');
		assert.equal(result.nodeVersion, '24.18.0');
		assert.equal(result.npmVersion, '11.12.1');
		assert.deepEqual(result.pluginArtifact, pluginArtifact);
		assert.equal(result.acceptance.status, 'ok');
		assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result);
	} finally {
		await Promise.all([
			rm(temporaryRoot, { recursive: true, force: true }),
			rm(disposableVault, { recursive: true, force: true }),
		]);
	}
});

test('live acceptance rejects non-disposable vault paths before helper installation', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-live-invalid-vault-'));
	try {
		await assert.rejects(
			runPublishedCliLiveAcceptance({
				tarballPath: '/tmp/reviewed.tgz',
				vaultPath: temporaryRoot,
				outputPath: path.join(temporaryRoot, 'evidence.json'),
			}),
			/OPERON_PUBLISHED_CLI_LIVE_VAULT_INVALID/u,
		);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('live acceptance requires an exact production plugin artifact root', async () => {
	const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'operon-live-artifact-root-'));
	const disposableVault = await mkdtemp(path.join(
		process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(),
		'operon-agent-runtime-phase1-artifact-root-',
	));
	try {
		await assert.rejects(
			runPublishedCliLiveAcceptance({
				tarballPath: '/tmp/reviewed.tgz',
				vaultPath: disposableVault,
				outputPath: path.join(temporaryRoot, 'evidence.json'),
			}, { env: { PATH: '/safe/bin' } }),
			/OPERON_PUBLISHED_CLI_LIVE_PLUGIN_ARTIFACT_ROOT_INVALID/u,
		);
	} finally {
		await Promise.all([
			rm(temporaryRoot, { recursive: true, force: true }),
			rm(disposableVault, { recursive: true, force: true }),
		]);
	}
});
