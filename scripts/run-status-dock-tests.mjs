import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(path.join(tmpdir(), 'operon-status-dock-test-'));
try {
	const outfile = path.join(temp, 'status-dock.test.cjs');
	await build({ entryPoints: [path.join(root, 'scripts/status-dock.test.ts')], outfile, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
	const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Status dock tests failed: ${result.status ?? result.signal}`);
} finally { await rm(temp, { recursive: true, force: true }); }
