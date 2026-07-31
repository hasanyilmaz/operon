import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../..',
);
const executable = path.join(
	pluginRoot,
	'packages',
	'operon-cli',
	'dist',
	'operon.mjs',
);

if (process.platform === 'win32') {
	const version = spawnSync(process.execPath, [executable, 'version', '--json'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		shell: false,
		windowsHide: true,
	});
	assert.equal(version.error, undefined);
	assert.equal(version.status, 0, version.stderr);
	assert.equal(JSON.parse(version.stdout).ok, true);

	const nonInteractive = spawnSync(process.execPath, [executable, 'task', 'create'], {
		cwd: pluginRoot,
		encoding: 'utf8',
		shell: false,
		windowsHide: true,
	});
	assert.equal(nonInteractive.error, undefined);
	assert.equal(nonInteractive.status, 2, nonInteractive.stderr);
	assert.match(nonInteractive.stderr, /interactive terminal/u);
	console.log(
		'Windows console acceptance passed: executable launch and non-TTY safety guard; '
		+ 'POSIX PTY suites are not applicable on win32.',
	);
} else {
	execFileSync(
		process.execPath,
		[path.join(pluginRoot, 'scripts/agent-runtime/cli/run-guided-source-transition-pty-tests.mjs')],
		{ cwd: pluginRoot, stdio: 'inherit' },
	);
	for (const test of [
		'interactive-shell-pty.test.py',
		'guided-setup-pty.test.py',
	]) {
		execFileSync(
			'python3',
			[
				path.join(pluginRoot, 'scripts/agent-runtime/cli', test),
				executable,
			],
			{ cwd: pluginRoot, stdio: 'inherit' },
		);
	}
}
