import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-compact-update-tests-'));
const outfile = path.join(tempRoot, 'compact-update.test.mjs');

try {
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/compact-update.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonCompactUpdateTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Compact update test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonCompactUpdateTestRun;
	await rm(tempRoot, { recursive: true, force: true });
}
