import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'operon-settings-preservation-tests-'));
try {
 const outfile = path.join(temporary, 'settings-preservation.test.mjs');
 await build({
  entryPoints: [path.join(root, 'scripts/settings-preservation.test.ts')],
  outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
  alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') },
 });
 process.exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', outfile], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => signal ? reject(new Error(`Settings preservation tests terminated: ${signal}`)) : resolve(code ?? 1));
 });
} finally {
 await rm(temporary, { recursive: true, force: true });
}
