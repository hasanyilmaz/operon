import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'operon-native-cli-transport-'));
const outfile = path.join(temporaryDirectory, 'native-transport.test.mjs');

try {
	await build({
		entryPoints: [path.join(root, 'scripts/agent-runtime/cli-transport/native-transport.test.ts')],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		outfile,
		logLevel: 'silent',
		define: {
			OPERON_AGENT_RUNTIME_PROBE_ENABLED: 'true',
		},
		plugins: [{
			name: 'obsidian-test-shim',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
					path: 'obsidian',
					namespace: 'operon-test',
				}));
				buildContext.onLoad(
					{ filter: /.*/, namespace: 'operon-test' },
					() => ({
						contents: [
							`export const Platform = ${JSON.stringify({
								isDesktop: true,
								isDesktopApp: true,
								isMacOS: process.platform === 'darwin',
								isWin: process.platform === 'win32',
								isLinux: process.platform === 'linux',
							})};`,
							'export const apiVersion = "1.13.3";',
							'export const requireApiVersion = () => true;',
						].join('\n'),
						loader: 'js',
					}),
				);
			},
		}],
	});
	const result = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [
			'--test',
			'--test-reporter=tap',
			'--test-timeout=60000',
			outfile,
		], {
			cwd: root,
			stdio: ['inherit', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', chunk => {
			const text = chunk.toString();
			output += text;
			process.stdout.write(text);
		});
		child.stderr.on('data', chunk => {
			const text = chunk.toString();
			output += text;
			process.stderr.write(text);
		});
		const watchdog = setTimeout(() => {
			process.stderr.write('Native transport test process exceeded 180 seconds.\n');
			child.kill('SIGKILL');
		}, 180_000);
		child.once('error', error => {
			clearTimeout(watchdog);
			reject(error);
		});
		child.once('exit', code => {
			clearTimeout(watchdog);
			resolve({ code: code ?? 1, output });
		});
	});
	const totals = Object.fromEntries(['tests', 'fail', 'cancelled', 'skipped'].map(label => {
		const matches = [...result.output.matchAll(new RegExp(`^# ${label} (\\d+)$`, 'gmu'))];
		return [label, matches.length === 1 ? Number.parseInt(matches[0]?.[1] ?? '', 10) : null];
	}));
	const summaryParseable = Object.values(totals).every(value => Number.isSafeInteger(value));
	const requiredNative = process.env['OPERON_REQUIRE_NATIVE_TRANSPORT'] === '1';
	process.stdout.write(`${JSON.stringify({
		kind: 'operon-native-transport-summary',
		platform: process.platform,
		requiredNative,
		summaryParseable,
		...totals,
	})}\n`);
	const invalidRequiredSummary = requiredNative && (
		!summaryParseable
		|| (totals.tests ?? 0) <= 0
		|| totals.fail !== 0
		|| totals.cancelled !== 0
		|| totals.skipped !== 0
	);
	if (result.code !== 0 || invalidRequiredSummary) process.exitCode = result.code || 1;
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
