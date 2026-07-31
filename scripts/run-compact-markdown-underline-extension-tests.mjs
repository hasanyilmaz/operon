import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-compact-underline-test-'));
const outfile = path.join(tempDir, 'compact-markdown-underline-extension.test.mjs');

try {
	await build({
		entryPoints: [
			path.join(rootDir, 'scripts/compact-markdown-underline-extension.test.ts'),
		],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
