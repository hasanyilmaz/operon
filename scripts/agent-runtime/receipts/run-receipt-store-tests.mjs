import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-receipt-store-test-'));
const outfile = path.join(tempDirectory, 'receipt-store.test.mjs');

try {
	await build({
		entryPoints: [path.join(scriptDirectory, 'indexeddb-receipt-store.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		absWorkingDir: pluginRoot,
		define: {
			OPERON_AGENT_RUNTIME_PROBE_ENABLED: 'true',
		},
	});
	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile], {
			cwd: pluginRoot,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', code => {
			if (code === 0) resolve();
			else reject(new Error(`Receipt-store tests exited with status ${code ?? 'unknown'}.`));
		});
	});
} finally {
	await rm(tempDirectory, { recursive: true, force: true });
}
