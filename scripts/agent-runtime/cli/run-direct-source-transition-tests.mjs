import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-direct-source-transition-tests-'));
const outfile = path.join(tempRoot, 'direct-source-transitions.test.mjs');

try {
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/direct-source-transitions.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonDirectSourceTransitionTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Direct source-transition test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonDirectSourceTransitionTestRun;
	await rm(tempRoot, { recursive: true, force: true });
}
