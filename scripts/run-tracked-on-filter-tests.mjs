import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-tracked-on-filter-test-'));
const outfile = path.join(tempDir, 'tracked-on-filter.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/tracked-on-filter.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
	});
	const suite = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	let passed = 0;
	suite.registerTrackedOnFilterTests((name, run) => { run(); passed++; });
	console.log(`Tracked on filter: ${passed}/${passed} passed`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
