import { runInlineParentPlacementIntegrationTests } from './inline-parent-placement-integration.test.mjs';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-inline-task-parent-placement-test-'));
const outfile = path.join(tempDir, 'inline-task-parent-placement.test.mjs');

try {
	await build({
		stdin: { contents: "import './scripts/inline-task-parent-placement.test.ts'; import './scripts/inline-parent-placement-transaction.test.ts';", loader: 'ts', resolveDir: rootDir },
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
	});
	const exitCode = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal) reject(new Error(`Inline parent placement tests terminated by ${signal}.`));
			else resolve(code ?? 1);
		});
	});
	await runInlineParentPlacementIntegrationTests(rootDir);
	if (exitCode !== 0) throw new Error(`Inline parent placement tests failed with exit code ${exitCode}.`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
