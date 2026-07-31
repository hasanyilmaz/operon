import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOperonCliPackageVersion } from './package-version.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageVersion = await readOperonCliPackageVersion(pluginRoot);
const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-phase9-tests-'));
const outfile = path.join(tempRoot, 'phase9-client.test.mjs');

try {
	const capacityWorkerBuild = await build({
		entryPoints: [path.join(
			pluginRoot,
			'scripts/agent-runtime/cli/plan-store-capacity-worker.ts',
		)],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		logLevel: 'silent',
		write: false,
	});
	await build({
		entryPoints: [path.join(pluginRoot, 'scripts/agent-runtime/cli/phase9-client.test.ts')],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		logLevel: 'silent',
		define: {
			__OPERON_CLI_VERSION__: JSON.stringify(packageVersion),
			__OPERON_PLAN_STORE_CAPACITY_WORKER_SOURCE__: JSON.stringify(
				capacityWorkerBuild.outputFiles[0].text,
			),
		},
	});
	await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
