import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-periodic-note-settings-test-'));
const outfile = path.join(tempDir, 'periodic-note-settings.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/periodic-note-settings.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-periodic-note-settings-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: `
						export const normalizePath = value => value.replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/');
						export const moment = () => ({ isValid: () => true });
					`,
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonPeriodicNoteSettingsTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Periodic Note settings test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonPeriodicNoteSettingsTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
