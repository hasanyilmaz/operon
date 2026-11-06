import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(path.join(tmpdir(), 'operon-file-titles-'));
try {
 const outfile = path.join(dir, 'tests.cjs');
 await build({ entryPoints: ['scripts/agent-runtime/file-task-titles/extension.test.ts'], bundle: true, outfile, format: 'cjs', platform: 'node', logLevel: 'silent', alias: { obsidian: path.resolve('scripts/test-support/obsidian-native-yaml.ts') } });
 const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
 if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally { await rm(dir, { recursive: true, force: true }); }
