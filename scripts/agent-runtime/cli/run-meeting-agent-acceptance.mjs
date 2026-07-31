#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptRoot, '../../..');
const packageRoot = path.join(pluginRoot, 'packages', 'operon-cli');
const vaultPath = process.argv[2] ?? path.join(
	process.platform === 'darwin' ? '/private/tmp' : '/tmp',
	'operon-agent-runtime-phase1-v1',
);
const tempRoot = mkdtempSync(path.join(tmpdir(), 'operon-meeting-agent-'));
const packRoot = path.join(tempRoot, 'pack');
const prefixRoot = path.join(tempRoot, 'prefix');
const configRoot = path.join(tempRoot, 'config');
const env = {
	...process.env,
	OPERON_CONFIG_HOME: configRoot,
	npm_config_cache: path.join(tempRoot, 'npm-cache'),
};

try {
	const settingsPath = path.join(vaultPath, '.obsidian', 'plugins', 'operon', 'data.json');
	const settingsDigestBefore = settingsDomainsDigest(settingsPath);
	mkdirSync(packRoot, { recursive: true });
	execFileSync(process.execPath, ['build.mjs'], { cwd: packageRoot, env, stdio: 'inherit' });
	const pack = JSON.parse(execFileSync(
		'npm',
		['pack', '--json', '--pack-destination', packRoot],
		{ cwd: packageRoot, env, encoding: 'utf8' },
	))[0];
	const tarball = path.join(packRoot, pack.filename);
	execFileSync('npm', ['install', '--global', '--prefix', prefixRoot, tarball], {
		env,
		stdio: 'inherit',
	});
	const executable = path.join(prefixRoot, 'bin', 'operon');
	const fixture = spawnSync(process.execPath, [
		path.join(scriptRoot, 'meeting-agent-fixture.mjs'),
		executable,
		vaultPath,
		configRoot,
	], {
		env,
		encoding: 'utf8',
	});
	if (fixture.stdout) process.stdout.write(fixture.stdout);
	if (fixture.stderr) process.stderr.write(fixture.stderr);
	if (fixture.status !== 0) process.exitCode = fixture.status ?? 1;
	const settingsDigestAfter = settingsDomainsDigest(settingsPath);
	if (settingsDigestAfter !== settingsDigestBefore) {
		throw new Error('MEETING_AGENT_MUTATED_OPERON_SETTINGS');
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
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
