import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-table-gantt-scroll-hot-path-test-'));
const outfile = path.join(tempDir, 'table-gantt-scroll-hot-path.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/table-gantt-scroll-hot-path.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonTableGanttScrollHotPathTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Table Gantt scroll hot-path test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonTableGanttScrollHotPathTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
