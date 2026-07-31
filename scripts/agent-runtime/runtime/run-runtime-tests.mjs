import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-core-test-'));
const outfile = path.join(tempDirectory, 'runtime-core.test.mjs');

try {
	await build({
		entryPoints: [path.join(scriptDirectory, 'runtime-core.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		define: {
			OPERON_AGENT_RUNTIME_PROBE_ENABLED: 'true',
		},
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonAgentRuntimeCoreTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Agent Runtime core test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonAgentRuntimeCoreTestRun;
	await rm(tempDirectory, { recursive: true, force: true });
}
