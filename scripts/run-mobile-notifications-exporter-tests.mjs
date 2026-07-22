import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.TZ = 'Europe/Berlin';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-notifications-test-'));
const outfile = path.join(tempDir, 'mobile-notifications-exporter.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/mobile-notifications-exporter.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-mobile-notifications-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'operon-test' }));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: `
						export const normalizePath = value => value.replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/');
						export const Platform = { isDesktopApp: true };
						export const setIcon = () => {};
					`,
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonMobileNotificationsExporterTestRun;
	if (!testRun || typeof testRun.then !== 'function') throw new Error('Producer test runner did not expose completion.');
	await testRun;
	const referenceContractPath = path.resolve(
		homedir(),
		'Projects/OperonNotify/Android/reference/node/mobile-notifications-contract.mjs',
	);
	const referenceContract = await import(pathToFileURL(referenceContractPath).href);
	referenceContract.validateMobileNotificationsSnapshot(globalThis.__operonMobileNotificationsSample);
	console.log('Android reference contract accepted the generated producer snapshot');
} finally {
	delete globalThis.__operonMobileNotificationsExporterTestRun;
	delete globalThis.__operonMobileNotificationsSample;
	await rm(tempDir, { recursive: true, force: true });
}
