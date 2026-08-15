import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-expanded-descendant-state-test-'));
const outfile = path.join(tempDir, 'expanded-descendant-state.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/expanded-descendant-state.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		alias: {
			obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts'),
		},
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonExpandedDescendantStateTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Expanded descendant state test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonExpandedDescendantStateTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
