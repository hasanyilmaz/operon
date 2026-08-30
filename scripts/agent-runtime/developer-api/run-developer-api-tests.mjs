import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'operon-developer-api-test-'));
try {
	for (const entry of [
		'developer-api.test.ts',
		'task-workflows-developer-api.test.ts',
		'read-projection-developer-api.test.ts',
		'developer-api-grants.test.ts',
		'operon-storage-grant-persistence.test.ts',
		'recovery-store.test.ts',
	]) {
		const outfile = path.join(tempDirectory, entry.replace(/\.ts$/u, '.mjs'));
		await build({
			entryPoints: [path.join(scriptDirectory, entry)],
			outfile,
			bundle: true,
			format: 'esm',
			platform: 'node',
			target: ['node18'],
			logLevel: 'silent',
		});
		await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	}
} finally {
	await rm(tempDirectory, { recursive: true, force: true });
}
