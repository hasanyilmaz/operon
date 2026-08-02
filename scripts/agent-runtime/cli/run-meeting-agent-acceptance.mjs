#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	loadPublishedCliBinding,
	sanitizedChildEnvironment,
	withVerifiedPublishedCli,
} from './published-cli-v1.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(scriptPath);
const pluginRoot = path.resolve(scriptRoot, '../../..');

export function readMeetingAcceptanceArguments(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!['--tarball', '--vault'].includes(key) || !value || values.has(key)) {
			throw new Error('OPERON_MEETING_ACCEPTANCE_USAGE');
		}
		values.set(key, value);
	}
	if (values.size !== 2) throw new Error('OPERON_MEETING_ACCEPTANCE_USAGE');
	return Object.freeze({
		tarballPath: values.get('--tarball'),
		vaultPath: values.get('--vault'),
	});
}

export async function runMeetingAgentAcceptance(arguments_, options = {}) {
	const vaultPath = validateDisposableVault(arguments_.vaultPath);
	const loadBinding = options.loadBinding ?? loadPublishedCliBinding;
	const installVerified = options.installVerified ?? withVerifiedPublishedCli;
	const spawn = options.spawn ?? spawnSync;
	const { binding } = await loadBinding({ pluginRoot: options.pluginRoot ?? pluginRoot });
	return installVerified(
		arguments_.tarballPath,
		binding,
		async ({ executable, npmVersion }) => {
			const tempRoot = mkdtempSync(path.join(tmpdir(), 'operon-meeting-agent-'));
			try {
				const configRoot = path.join(tempRoot, 'config');
				const settingsPath = path.join(vaultPath, '.obsidian', 'plugins', 'operon', 'data.json');
				const settingsDigestBefore = settingsDomainsDigest(settingsPath);
				const env = withoutExecutableOverrides(sanitizedChildEnvironment(options.env ?? process.env));
				env.OPERON_CONFIG_HOME = configRoot;
				const fixture = spawn(process.execPath, [
					path.join(scriptRoot, 'meeting-agent-fixture.mjs'),
					executable,
					vaultPath,
					configRoot,
				], {
					cwd: options.pluginRoot ?? pluginRoot,
					env,
					encoding: 'utf8',
				});
				if (fixture.error) throw fixture.error;
				assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
				assert.equal(
					settingsDomainsDigest(settingsPath),
					settingsDigestBefore,
					'MEETING_AGENT_MUTATED_OPERON_SETTINGS',
				);
				return Object.freeze({
					status: 'ok',
					kind: 'operon-published-cli-meeting-acceptance',
					package: `${binding.package.name}@${binding.package.version}`,
					tarballSha256: binding.tarball.sha256,
					runtimeContractDigest: binding.runtime.contractDigest,
					npmVersion,
					vault: path.basename(vaultPath),
				});
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		},
		{ pluginRoot: options.pluginRoot ?? pluginRoot, env: options.env ?? process.env },
	);
}

function validateDisposableVault(requestedPath) {
	if (typeof requestedPath !== 'string' || requestedPath.includes('\0')) {
		throw new Error('OPERON_MEETING_ACCEPTANCE_VAULT_INVALID');
	}
	const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
	const resolvedPath = path.resolve(requestedPath);
	const requestedStats = lstatSync(resolvedPath);
	const vaultPath = realpathSync(resolvedPath);
	const stats = lstatSync(vaultPath);
	if (
		requestedStats.isSymbolicLink()
		|| vaultPath !== resolvedPath
		|| !stats.isDirectory()
		|| stats.isSymbolicLink()
		|| path.dirname(vaultPath) !== expectedTempRoot
		|| !/^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u.test(path.basename(vaultPath))
	) {
		throw new Error('OPERON_MEETING_ACCEPTANCE_VAULT_INVALID');
	}
	return vaultPath;
}

function settingsDomainsDigest(settingsPath) {
	const {
		state: _runtimeState,
		...settingsDomains
	} = JSON.parse(readFileSync(settingsPath, 'utf8'));
	return createHash('sha256')
		.update(JSON.stringify(settingsDomains))
		.digest('hex');
}

function withoutExecutableOverrides(environment) {
	return Object.fromEntries(Object.entries(environment).filter(([key]) => (
		!['operon_cli_executable', 'operon_published_cli_executable'].includes(key.toLowerCase())
	)));
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const result = await runMeetingAgentAcceptance(readMeetingAcceptanceArguments(process.argv.slice(2)));
	process.stdout.write(`${JSON.stringify(result)}\n`);
}
