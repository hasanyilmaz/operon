import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-transport-test-'));
const outfile = path.join(tempDir, 'transport-probe-core.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/agent-runtime/transport-probe-core.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-agent-runtime-transport-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: `
						export const Platform = { isDesktop: true, isDesktopApp: true };
						export const requireApiVersion = () => true;
					`,
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonAgentRuntimeTransportProbeTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Agent Runtime transport probe test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonAgentRuntimeTransportProbeTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
