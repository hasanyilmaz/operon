import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-direct-timer-session-tests-'));
const outfile = path.join(tempRoot, 'direct-timer-session.test.mjs');

try {
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/direct-timer-session.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonDirectTimerSessionTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Direct timer-session test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonDirectTimerSessionTestRun;
	await rm(tempRoot, { recursive: true, force: true });
}
