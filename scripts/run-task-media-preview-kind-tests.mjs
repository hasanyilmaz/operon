import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-task-media-preview-kind-test-'));
const outfile = path.join(tempDir, 'task-media-preview-kind.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/task-media-preview-kind.test.ts')],
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
