import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-index-v8-maintenance-test-'));
const outfile = path.join(tempDir, 'index-v8-maintenance.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/index-v8-maintenance.test.ts')],
		outfile,
		bundle: true,
		alias: {
			obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts'),
		},
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonIndexV8MaintenanceTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Index V8 maintenance test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonIndexV8MaintenanceTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
