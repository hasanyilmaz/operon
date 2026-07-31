import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-direct-lifecycle-tests-'));
const outfile = path.join(tempRoot, 'direct-lifecycle.test.mjs');

try {
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/direct-lifecycle.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonDirectLifecycleTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Direct lifecycle test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonDirectLifecycleTestRun;
	await rm(tempRoot, { recursive: true, force: true });
}
