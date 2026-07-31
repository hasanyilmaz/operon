import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const tempDirectory = await mkdtemp(path.join(tmpdir(), 'operon-developer-security-test-'));
const outfile = path.join(tempDirectory, 'security-policy.test.mjs');

try {
	await build({
		entryPoints: [path.join(scriptDirectory, 'security-policy.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempDirectory, { recursive: true, force: true });
}
