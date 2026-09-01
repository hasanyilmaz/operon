import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const outputDirectory = await mkdtemp(join(tmpdir(), 'operon-agent-runtime-mutation-'));
try {
	const outputFile = join(outputDirectory, 'mutation-gateway.test.js');
	await build({
		entryPoints: [
			'scripts/agent-runtime/mutation/candidate-capability-smoke.test.ts',
			'scripts/agent-runtime/mutation/canonical-resource-ordering.test.ts',
			'scripts/agent-runtime/mutation/modified-time-plugin-integration.test.ts',
			'scripts/agent-runtime/mutation/mutation-acceptance-matrix.test.ts',
			'scripts/agent-runtime/mutation/mutation-gateway.test.ts',
			'scripts/agent-runtime/mutation/source-transition-guards.test.ts',
			'scripts/agent-runtime/mutation/task-mutation-adapter.test.ts',
			'scripts/agent-runtime/mutation/task-recurrence-adapter.test.ts',
			'scripts/agent-runtime/mutation/task-relationship-adapter.test.ts',
			'scripts/agent-runtime/mutation/timer-session-adapter.test.ts',
			'scripts/agent-runtime/mutation/relationship-aggregate-projection.test.ts',
			'scripts/agent-runtime/mutation/semantic-transition.test.ts',
			'scripts/agent-runtime/mutation/pinned-state-mutation.test.ts',
			'scripts/agent-runtime/mutation/source-transition-executor.test.ts',
			'scripts/agent-runtime/mutation/timing-probe.test.ts',
		],
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		outdir: outputDirectory,
		logLevel: 'silent',
		define: {
			OPERON_AGENT_RUNTIME_PROBE_ENABLED: 'true',
		},
	});
	await import(pathToFileURL(join(outputDirectory, 'candidate-capability-smoke.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'canonical-resource-ordering.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'modified-time-plugin-integration.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'mutation-acceptance-matrix.test.js')).href);
	await import(pathToFileURL(outputFile).href);
	await import(pathToFileURL(join(outputDirectory, 'source-transition-guards.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'task-mutation-adapter.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'task-recurrence-adapter.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'task-relationship-adapter.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'timer-session-adapter.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'relationship-aggregate-projection.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'semantic-transition.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'pinned-state-mutation.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'source-transition-executor.test.js')).href);
	await import(pathToFileURL(join(outputDirectory, 'timing-probe.test.js')).href);
} finally {
	await rm(outputDirectory, { recursive: true, force: true });
}
