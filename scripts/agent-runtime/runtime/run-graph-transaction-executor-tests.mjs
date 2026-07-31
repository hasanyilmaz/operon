import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'operon-graph-transaction-test-'));
const outfile = path.join(tempDirectory, 'graph-transaction-executor.test.mjs');

try {
	await build({
		entryPoints: [path.join(scriptDirectory, 'graph-transaction-executor.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonGraphTransactionExecutorTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Graph transaction executor test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonGraphTransactionExecutorTestRun;
	await rm(tempDirectory, { recursive: true, force: true });
}
