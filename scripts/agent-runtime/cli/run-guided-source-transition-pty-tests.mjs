import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { readOperonCliPackageVersion } from './package-version.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageVersion = await readOperonCliPackageVersion(pluginRoot);
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-phase7-pty-responder-'));
const responder = path.join(tempRoot, 'phase7-pty-responder.mjs');
const executable = path.join(pluginRoot, 'packages', 'operon-cli', 'dist', 'operon.mjs');
const test = path.join(
	pluginRoot,
	'scripts',
	'agent-runtime',
	'cli',
	'guided-source-transitions-pty.test.py',
);

try {
	await build({
		entryPoints: [path.join(
			pluginRoot,
			'scripts',
			'agent-runtime',
			'cli',
			'phase7-pty-responder.ts',
		)],
		outfile: responder,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
		banner: {
			js: '#!/usr/bin/env node',
		},
		define: {
			__OPERON_CLI_VERSION__: JSON.stringify(packageVersion),
		},
	});
	await chmod(responder, 0o755);
	execFileSync('python3', [test, executable, responder], {
		cwd: pluginRoot,
		stdio: 'inherit',
	});
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
