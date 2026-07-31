import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
	process.execPath,
	['esbuild.config.mjs', 'production-agent-runtime-probe'],
	{
		cwd: rootDir,
		encoding: 'utf8',
		stdio: 'inherit',
	},
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const outputPath = path.join(rootDir, 'build/agent-runtime-probe/main.js');
const source = readFileSync(outputPath, 'utf8');
if (!source.includes('operon:transport-probe')) {
	throw new Error('Agent Runtime probe build did not contain the expected development command.');
}
for (const marker of [
	'a12-probe-source-pre-trash-interrupt-v1',
	'a12-probe-source-post-trash-interrupt-v1',
]) {
	if (!source.includes(marker)) {
		throw new Error(`Agent Runtime probe build did not contain ${marker}.`);
	}
}
console.log(`Operon Agent Runtime probe build: ${statSync(outputPath).size} bytes`);
