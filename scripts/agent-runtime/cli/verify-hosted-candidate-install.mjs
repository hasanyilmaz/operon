#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execNpmV1 } from './live-acceptance-platform.mjs';
import { loadCandidateBindingV1 } from './native-acceptance-lib.mjs';

const [candidateRootArgument] = process.argv.slice(2);
assert.ok(candidateRootArgument, 'Candidate directory is required.');
const candidateRoot = path.resolve(candidateRootArgument);
const { evidence } = await loadCandidateBindingV1(candidateRoot);
const root = await mkdtemp(path.join(tmpdir(), 'operon-hosted-candidate-'));
const prefix = path.join(root, 'prefix');
const configRoot = path.join(root, 'config');
const npmCache = path.join(root, 'npm-cache');
const env = {
	...process.env,
	npm_config_cache: npmCache,
	OPERON_CONFIG_HOME: configRoot,
};
try {
	await mkdir(configRoot, { recursive: true });
	const tarball = path.join(candidateRoot, evidence.tarball);
	execNpmV1(
		['install', '--global', '--prefix', prefix, '--ignore-scripts', tarball],
		{ env, stdio: 'inherit' },
	);
	const globalRoot = execNpmV1(
		['root', '--global', '--prefix', prefix],
		{ env, encoding: 'utf8' },
	).trim();
	const installedRoot = path.join(globalRoot, 'operon-cli');
	const manifestBytes = await readFile(path.join(installedRoot, 'cli-manifest-v1.json'));
	assert.equal(
		createHash('sha256').update(manifestBytes).digest('hex'),
		evidence.cliManifestSha256,
	);
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	assert.equal(manifest.contractDigest, evidence.aggregateContractSha256);
	assert.deepEqual(manifest.platforms, evidence.platforms);
	for (const schema of manifest.schemas) {
		const bytes = await readFile(path.join(installedRoot, 'schemas', 'v1', schema.file));
		assert.equal(createHash('sha256').update(bytes).digest('hex'), schema.sha256);
	}
	const executable = path.join(installedRoot, 'dist', 'operon.mjs');
	const version = runJson(executable, ['version', '--json'], env);
	assert.equal(version.result.version, manifest.package.version);
	const installedManifest = runJson(executable, ['manifest', '--json'], env);
	assert.deepEqual(installedManifest.result, manifest);
	if (process.platform === 'win32') {
		const shim = path.join(prefix, 'operon.cmd');
		assert.equal(
			runWindowsShimJson(shim, ['version', '--json'], env).result.version,
			manifest.package.version,
		);
	}
	execNpmV1(
		['uninstall', '--global', '--prefix', prefix, 'operon-cli'],
		{ env, stdio: 'inherit' },
	);
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		package: evidence.package,
		tarballSha256: evidence.sha256,
		platform: process.platform,
		node: process.version,
	}, null, 2)}\n`);
} finally {
	await rm(root, { recursive: true, force: true });
}

function runJson(executable, args, childEnv) {
	const result = spawnSync(process.execPath, [executable, ...args], {
		env: childEnv,
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

function runWindowsShimJson(executableShim, args, childEnv) {
	assert.match(executableShim, /\.cmd$/iu);
	assert.ok(!/["\r\n]/u.test(executableShim));
	for (const arg of args) assert.match(arg, /^[A-Za-z0-9._:-]+$/u);
	const result = spawnSync(
		process.env.ComSpec ?? 'cmd.exe',
		['/d', '/c', executableShim, ...args],
		{
			env: childEnv,
			encoding: 'utf8',
			shell: false,
			windowsHide: true,
		},
	);
	if (result.error) throw result.error;
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}
