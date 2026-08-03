import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-index-v8-test-'));
const outfile = path.join(tempDir, 'index-v8-contract.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/index-v8-contract.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonIndexV8ContractTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Index V8 contract test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonIndexV8ContractTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
