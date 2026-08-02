#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadPublishedCliBinding,
	sanitizedChildEnvironment,
	withVerifiedPublishedCli,
} from '../agent-runtime/cli/published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../..');
const liveAcceptanceScript = path.join(
	pluginRoot,
	'scripts',
	'agent-runtime',
	'mutation',
	'run-live-stage5-completion.mjs',
);

export function readPublishedLiveArguments(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!['--tarball', '--vault', '--output'].includes(key) || !value || values.has(key)) {
			throw new Error('OPERON_PUBLISHED_CLI_LIVE_USAGE');
		}
		values.set(key, value);
	}
	if (values.size !== 3) throw new Error('OPERON_PUBLISHED_CLI_LIVE_USAGE');
	return Object.freeze({
		tarballPath: values.get('--tarball'),
		vaultPath: values.get('--vault'),
		outputPath: values.get('--output'),
	});
}

export async function runPublishedCliLiveAcceptance(arguments_, options = {}) {
	const outputPath = path.resolve(arguments_.outputPath);
	if (
		!path.isAbsolute(arguments_.outputPath)
		|| arguments_.outputPath.includes('\0')
		|| arguments_.vaultPath.includes('\0')
	) {
		throw new Error('OPERON_PUBLISHED_CLI_LIVE_PATH_INVALID');
	}
	const vaultPath = await validateDisposableVault(arguments_.vaultPath);
	await assertNewOutputPath(outputPath);
	const loadBinding = options.loadBinding ?? loadPublishedCliBinding;
	const installVerified = options.installVerified ?? withVerifiedPublishedCli;
	const spawn = options.spawn ?? spawnSync;
	const { binding } = await loadBinding({ pluginRoot: options.pluginRoot ?? pluginRoot });
	const result = await installVerified(
		arguments_.tarballPath,
		binding,
		async ({ executable, npmVersion }) => {
			const childEnvironment = withoutExecutableOverride(
				sanitizedChildEnvironment(options.env ?? process.env),
			);
			childEnvironment.OPERON_PUBLISHED_CLI_EXECUTABLE = executable;
			const child = spawn(
				process.execPath,
				[liveAcceptanceScript, vaultPath],
				{
					cwd: options.pluginRoot ?? pluginRoot,
					encoding: 'utf8',
					env: childEnvironment,
				},
			);
			if (child.error) throw child.error;
			assert.equal(
				child.status,
				0,
				`OPERON_PUBLISHED_CLI_LIVE_FAILED:${child.stderr?.trim() ?? ''}`,
			);
			const acceptance = JSON.parse(child.stdout.trim());
			assert.equal(acceptance.status, 'ok', 'OPERON_PUBLISHED_CLI_LIVE_RESULT_INVALID');
			return Object.freeze({
				kind: 'operon-published-cli-runtime-live-acceptance',
				package: `${binding.package.name}@${binding.package.version}`,
				tarballSha256: binding.tarball.sha256,
				runtimeContractDigest: binding.runtime.contractDigest,
				npmVersion,
				acceptance,
			});
		},
		{ pluginRoot: options.pluginRoot ?? pluginRoot, env: options.env ?? process.env },
	);
	await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600,
	});
	return result;
}

async function validateDisposableVault(requestedPath) {
	const expectedTempRoot = await realpath(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir());
	const vaultPath = await realpath(requestedPath);
	const stats = await lstat(vaultPath);
	if (
		!stats.isDirectory()
		|| stats.isSymbolicLink()
		|| path.dirname(vaultPath) !== expectedTempRoot
		|| !/^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u.test(path.basename(vaultPath))
	) {
		throw new Error('OPERON_PUBLISHED_CLI_LIVE_VAULT_INVALID');
	}
	return vaultPath;
}

async function assertNewOutputPath(outputPath) {
	const parentStats = await lstat(path.dirname(outputPath));
	if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
		throw new Error('OPERON_PUBLISHED_CLI_LIVE_OUTPUT_PARENT_INVALID');
	}
	try {
		await lstat(outputPath);
		throw new Error('OPERON_PUBLISHED_CLI_LIVE_OUTPUT_EXISTS');
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
	}
}

function withoutExecutableOverride(environment) {
	const output = {};
	for (const [key, value] of Object.entries(environment)) {
		if (['operon_cli_executable', 'operon_published_cli_executable'].includes(key.toLowerCase())) continue;
		output[key] = value;
	}
	return output;
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const arguments_ = readPublishedLiveArguments(process.argv.slice(2));
	const result = await runPublishedCliLiveAcceptance(arguments_);
	process.stdout.write(`${JSON.stringify({
		status: 'ok',
		kind: result.kind,
		package: result.package,
		output: path.basename(path.resolve(arguments_.outputPath)),
	})}\n`);
}
