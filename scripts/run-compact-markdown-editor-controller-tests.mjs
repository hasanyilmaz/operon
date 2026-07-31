import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-compact-editor-controller-test-'));
const outfile = path.join(tempDir, 'compact-markdown-editor-controller.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/compact-markdown-editor-controller.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonCompactMarkdownEditorControllerTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Compact Markdown editor controller test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonCompactMarkdownEditorControllerTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
