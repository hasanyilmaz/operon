import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-session-jsonl-tests-'));
const outfile = path.join(tempDir, 'session-jsonl.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/agent-runtime/cli/session-jsonl.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node22'],
		logLevel: 'silent',
		define: {
			__OPERON_CLI_FRAME_TIMING__: 'true',
			__OPERON_CLI_PERSISTENT_READ__: 'true',
		},
	});
	const result = spawnSync(process.execPath, ['--test', outfile], {
		cwd: rootDir,
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		throw new Error(`Session JSONL tests failed with exit ${String(result.status)}.`);
	}
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
