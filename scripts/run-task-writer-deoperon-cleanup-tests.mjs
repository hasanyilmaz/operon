import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-task-writer-deoperon-cleanup-test-'));
const outfile = path.join(tempDir, 'task-writer-deoperon-cleanup.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/task-writer-deoperon-cleanup.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		alias: {
			obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts'),
		},
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonTaskWriterDeoperonCleanupTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Task writer plain-file cleanup test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonTaskWriterDeoperonCleanupTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
