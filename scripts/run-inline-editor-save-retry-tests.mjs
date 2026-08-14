import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-inline-editor-save-retry-test-'));
const outfile = path.join(tempDir, 'inline-editor-save-retry.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/inline-editor-save-retry.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonInlineEditorSaveRetryTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Inline editor save retry test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonInlineEditorSaveRetryTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
