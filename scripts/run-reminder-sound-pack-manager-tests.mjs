import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-reminder-sound-pack-test-'));
const outfile = path.join(tempDir, 'reminder-sound-pack-manager.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/reminder-sound-pack-manager.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		alias: {
			obsidian: path.join(rootDir, 'scripts/test-stubs/obsidian.ts'),
		},
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
