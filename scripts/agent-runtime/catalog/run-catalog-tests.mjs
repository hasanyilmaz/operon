import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-catalog-test-'));
const outfile = path.join(tempDirectory, 'catalog.test.mjs');

try {
	await build({
		entryPoints: [path.join(scriptDirectory, 'catalog.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonAgentRuntimeCatalogTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Agent Runtime catalog test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonAgentRuntimeCatalogTestRun;
	await rm(tempDirectory, { recursive: true, force: true });
}
