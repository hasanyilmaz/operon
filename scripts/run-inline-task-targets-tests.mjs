import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'operon-inline-target-tests-'));
try {
	const outfile = path.join(temporary, 'tests.mjs');
	await build({ entryPoints: [path.join(root, 'scripts/inline-task-targets.test.ts')], outfile,
		bundle: true, platform: 'node', format: 'esm', target: 'node18', logLevel: 'silent' });
	const code = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (result, signal) => signal ? reject(new Error(signal)) : resolve(result ?? 1));
	});
	if (code !== 0) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
