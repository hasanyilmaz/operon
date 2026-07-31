import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-context-'));
const outfile = path.join(tempDir, 'context-engine.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/agent-runtime/context/context-engine.test.ts')],
		outfile,
		bundle: true,
		alias: {
			obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts'),
		},
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonAgentRuntimeContextTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Agent Runtime context test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonAgentRuntimeContextTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
