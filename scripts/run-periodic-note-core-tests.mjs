import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-periodic-note-core-test-'));
const outfile = path.join(tempDir, 'periodic-note-core.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/periodic-note-core.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-periodic-note-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: `import moment from 'moment'; export { moment };`,
					resolveDir: rootDir,
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonPeriodicNoteCoreTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Periodic note core test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonPeriodicNoteCoreTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
