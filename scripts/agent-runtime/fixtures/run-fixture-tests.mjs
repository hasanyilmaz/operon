import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(fixtureRoot, '../../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-fixtures-'));
const outfile = path.join(tempDir, 'fixture-contract.test.mjs');

try {
	await build({
		entryPoints: [path.join(fixtureRoot, 'fixture-contract.test.ts')],
		outfile,
		absWorkingDir: pluginRoot,
		bundle: true,
		alias: { obsidian: path.resolve(fixtureRoot, '../../test-support/obsidian-native-yaml.ts') },
		banner: { js: 'import { createRequire as createYamlTestRequire } from "node:module"; const require = createYamlTestRequire(import.meta.url);' },
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	process.env.OPERON_FIXTURE_ROOT = fixtureRoot;
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	delete process.env.OPERON_FIXTURE_ROOT;
	await rm(tempDir, { recursive: true, force: true });
}
