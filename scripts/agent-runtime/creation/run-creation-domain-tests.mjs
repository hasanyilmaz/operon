import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const creationRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(creationRoot, '../../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-creation-'));
const outfile = path.join(tempDir, 'task-creation-domain.test.mjs');

try {
	await build({
		entryPoints: [path.join(creationRoot, 'task-creation-domain.test.ts')],
		outfile,
		absWorkingDir: pluginRoot,
		bundle: true,
		alias: {
			obsidian: path.join(pluginRoot, 'scripts/test-support/obsidian.ts'),
		},
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		sourcemap: 'inline',
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonTaskCreationDomainTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Task creation domain test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonTaskCreationDomainTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
