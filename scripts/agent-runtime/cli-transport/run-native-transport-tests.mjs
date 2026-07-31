import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
		}, {
			name: 'persistent-startup-test-diagnostics',
			setup(buildContext) {
				buildContext.onLoad(
					{ filter: /persistent-read-server\.ts$/ },
					async ({ path: sourcePath }) => {
						const source = await readFile(sourcePath, 'utf8');
						const caught = source.replace(
							"\t} catch {\n\t\treturn unavailableHandle('persistent-read-server-start-failed');\n\t}",
							"\t} catch (error) {\n\t\treturn unavailableHandle(error instanceof Error ? error.message : 'persistent-read-server-start-failed');\n\t}",
						);
						if (caught === source) {
							throw new Error('persistent-startup-test-diagnostic-transform-missing');
						}
						return { contents: caught, loader: 'ts' };
					},
				);
			},
		}],
	});
	const exitCode = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', outfile], {
			cwd: root,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', code => resolve(code ?? 1));
	});
	if (exitCode !== 0) process.exitCode = exitCode;
} finally {
	await rm(temporaryDirectory, { recursive: true, force: true });
}
