import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-kanban-scroll-retention-test-'));
const outfile = path.join(tempDir, 'kanban-scroll-retention.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/kanban-scroll-retention.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	const exitCode = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal) reject(new Error(`Kanban scroll retention tests terminated by ${signal}.`));
			else resolve(code ?? 1);
		});
	});
	if (exitCode !== 0) throw new Error(`Kanban scroll retention tests failed with exit code ${exitCode}.`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
