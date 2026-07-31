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
							'export const Platform = { isDesktop: true, isDesktopApp: true, isMacOS: true };',
							'export const apiVersion = "1.13.3";',
							'export const requireApiVersion = () => true;',
						].join('\n'),
						loader: 'js',
					}),
				);
			},
		}],
	});
	const exitCode = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', '--test-timeout=60000', outfile], {
			cwd: root,
			stdio: 'inherit',
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
			resolve(code ?? 1);
		});
	});
	if (exitCode !== 0) process.exitCode = exitCode;
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
