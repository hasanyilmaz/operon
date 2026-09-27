import { runCheckboxOwnershipIntegrationTests } from './checkbox-ownership-integration.test.mjs';
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-checkbox-ownership-'));
try {
	const outfile = path.join(tempDir, 'ownership.test.cjs');
	await build({
		entryPoints: [path.join(rootDir, 'scripts/plain-checkbox-ownership.test.ts')],
		outfile, bundle: true, format: 'cjs', platform: 'node', target: ['node18'], logLevel: 'silent',
		alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
	});
	const code = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile], { stdio: 'inherit', cwd: rootDir });
		child.once('error', reject);
		child.once('exit', (code, signal) => signal ? reject(new Error(`Ownership tests terminated by ${signal}`)) : resolve(code ?? 1));
	});
	if (code !== 0) throw new Error(`Checkbox ownership tests failed with exit code ${code}`);
	await runCheckboxOwnershipIntegrationTests(rootDir);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
