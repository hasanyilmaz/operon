import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { obsidianRequestUrlTestPlugin } from './esbuild-obsidian-request-url-plugin.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-locale-pack-test-'));
const outfile = path.join(tempDir, 'locale-pack-manager.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/locale-pack-manager.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		plugins: [obsidianRequestUrlTestPlugin()],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
