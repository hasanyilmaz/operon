import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(path.join(tmpdir(), 'operon-checkbox-extension-'));
try {
 const outfile = path.join(dir, 'tests.mjs');
 await build({ entryPoints: ['scripts/agent-runtime/checkbox-ownership/extension.test.ts'], bundle: true, outfile, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent', alias: { obsidian: path.resolve('scripts/test-support/obsidian.ts') } });
 await import(pathToFileURL(outfile).href);
} finally { await rm(dir, { recursive: true, force: true }); }
