import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Reminder resolution intentionally distinguishes calendar and elapsed-time
// arithmetic across a real DST fold. Keep that matrix deterministic in local
// development and UTC-based CI runners.
process.env.TZ = 'Europe/Berlin';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-reminder-scheduler-test-'));
const outfile = path.join(tempDir, 'reminder-scheduler.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/reminder-scheduler.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
		plugins: [{
			name: 'obsidian-reminder-test-stub',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
					loader: 'js',
					contents: `
						export class TFile {}
						export class Notice {
							static instances = [];
							constructor(content, duration) { this.content = content; this.duration = duration; Notice.instances.push(this); }
							hide() {}
						}
						export const Platform = { isDesktopApp: true };
						export const normalizePath = value => value.replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/');
						export const setIcon = () => {};
					`,
				}));
			},
		}],
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	const testRun = globalThis.__operonReminderSchedulerTestRun;
	if (!testRun || typeof testRun.then !== 'function') {
		throw new Error('Reminder scheduler test runner did not expose its completion promise.');
	}
	await testRun;
} finally {
	delete globalThis.__operonReminderSchedulerTestRun;
	await rm(tempDir, { recursive: true, force: true });
}
