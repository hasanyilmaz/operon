import { runMobileConversionTests } from './plugin-ui-mobile-conversion.test.mjs';
import { runMobileTaskDeleteTests } from './plugin-ui-mobile-task-delete.test.mjs';
import { runMobileFileRecurrenceTests } from './plugin-ui-mobile-file-recurrence.test.mjs';
import { runMobileInlineRecurrenceTests } from './plugin-ui-mobile-inline-recurrence.test.mjs';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-plugin-ui-status-mutation-test-'));
const outfile = path.join(tempDir, 'plugin-ui-status-mutation.test.mjs');

try {
	await build({
		entryPoints: [path.join(rootDir, 'scripts/plugin-ui-status-mutation.test.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: ['node18'],
		logLevel: 'silent',
	});
	const testModule = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
	await testModule.pluginUiStatusMutationTestRun;
	await runMobileInlineRecurrenceTests(rootDir);
	await runMobileFileRecurrenceTests(rootDir);
	await runMobileTaskDeleteTests(rootDir);
	await runMobileConversionTests(rootDir);
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
