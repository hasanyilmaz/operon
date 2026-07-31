import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-cli-'));
const outfile = path.join(tempDir, 'cli.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/agent-runtime/cli/cli.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonAgentRuntimeCliTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Agent Runtime CLI test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonAgentRuntimeCliTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
