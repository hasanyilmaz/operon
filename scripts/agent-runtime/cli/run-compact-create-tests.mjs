import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-compact-create-tests-'));
const outfile = path.join(tempRoot, 'compact-create.test.mjs');

try {
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/compact-create.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonCompactCreateTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Compact create test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonCompactCreateTestRun;
	await rm(tempRoot, { recursive: true, force: true });
}
