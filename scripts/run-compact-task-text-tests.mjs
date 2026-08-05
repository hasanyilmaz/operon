import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-compact-task-text-test-'));
const outfile = path.join(tempDir, 'compact-task-text.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/compact-task-text.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonCompactTaskTextTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Compact task text test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonCompactTaskTextTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
