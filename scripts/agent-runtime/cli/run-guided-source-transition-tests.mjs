import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOperonCliPackageVersion } from './package-version.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageVersion = await readOperonCliPackageVersion(pluginRoot);
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-guided-source-transition-tests-'));
const outfile = path.join(tempRoot, 'guided-source-transitions.test.mjs');

try {
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/guided-source-transitions.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
		define: {
			__OPERON_CLI_VERSION__: JSON.stringify(packageVersion),
		},
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonGuidedSourceTransitionTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Guided source-transition test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonGuidedSourceTransitionTestRun;
	await rm(tempRoot, { recursive: true, force: true });
}
