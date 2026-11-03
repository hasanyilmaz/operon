import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-lightbox-opening-test-'));
const outfile = path.join(tempDir, 'lightbox-opening.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/lightbox-opening.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
	});
	await build({ entryPoints: [path.join(rootDir, 'scripts/native-lightbox-lifecycle.test.ts')], outfile: path.join(tempDir, 'native-lightbox-lifecycle.test.mjs'), bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent', alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') } });
 await build({ entryPoints: [path.join(rootDir, 'scripts/chip-lightbox-opening.test.ts')], outfile: path.join(tempDir, 'chip-lightbox-opening.test.mjs'), bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent', alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') }, plugins: [{ name: 'picker-boundary', setup(build) { build.onResolve({filter: /task-field-picker-dispatch$/}, () => ({path: path.join(rootDir, 'scripts/test-support/chip-opening-picker.ts')})); } }] });
 await build({entryPoints:[path.join(rootDir,'scripts/task-text-link-opening.test.ts')],outfile:path.join(tempDir,'task-text-link-opening.test.mjs'),bundle:true,format:'esm',platform:'node',target:['node18'],logLevel:'silent',alias:{obsidian:path.join(rootDir,'scripts/test-support/obsidian.ts')}});
	const exitCode = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile, path.join(tempDir,'task-text-link-opening.test.mjs'), path.join(tempDir, 'native-lightbox-lifecycle.test.mjs'), path.join(tempDir, 'chip-lightbox-opening.test.mjs'), path.join(rootDir, 'scripts/chip-opening-surfaces.test.mjs')], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (signal) reject(new Error(`Lightbox opening tests terminated by ${signal}.`));
			else resolve(code ?? 1);
		});
	});
	if (exitCode !== 0) throw new Error(`Lightbox opening tests failed with exit code ${exitCode}.`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
