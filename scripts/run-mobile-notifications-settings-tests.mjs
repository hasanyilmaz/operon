import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-notifications-settings-test-'));
const outfile = path.join(tempDir, 'mobile-notifications-settings.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/mobile-notifications-settings.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-mobile-notifications-settings-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: `
						export const Platform = { isDesktopApp: true };
						export const normalizePath = value => value.replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/');
					`,
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
