import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-date-nlp-language-fallback-test-'));
const outfile = path.join(tempDir, 'date-nlp-language-fallback.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/date-nlp-language-fallback.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-date-nlp-language-fallback-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: 'export class App {} export class Editor {}',
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
