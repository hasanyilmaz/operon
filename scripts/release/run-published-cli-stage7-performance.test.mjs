import assert from 'node:assert/strict';
import test from 'node:test';

import {
	readPublishedPerformanceArguments,
	runPublishedCliStage7Performance,
} from './run-published-cli-stage7-performance.mjs';

test('published Stage 7 performance arguments require one exact tarball', () => {
	assert.deepEqual(readPublishedPerformanceArguments(['--tarball', '/reviewed/cli.tgz']), {
		tarballPath: '/reviewed/cli.tgz',
	});
	for (const value of [[], ['--tarball'], ['--vault', '/tmp/vault'], ['--tarball', 'a', '--tarball', 'b']]) {
		assert.throws(() => readPublishedPerformanceArguments(value), /OPERON_PUBLISHED_CLI_PERFORMANCE_USAGE/u);
	}
});

test('published Stage 7 performance runs only inside the verified callback', async () => {
	const binding = Object.freeze({ package: { name: '@stratejya/operon-cli', version: '1.0.8' } });
	let callbackCompleted = false;
	const output = await runPublishedCliStage7Performance({ tarballPath: '/reviewed/cli.tgz' }, {
		pluginRoot: '/fixture/plugin',
		env: {
			PATH: '/safe/bin',
			OPERON_CLI_EXECUTABLE: '/untrusted/local',
			OPERON_PUBLISHED_CLI_EXECUTABLE: '/untrusted/published',
			OPERON_CLI_STAGE7_CANDIDATE: '/untrusted/candidate',
		},
		loadBinding: async () => ({ binding }),
		installVerified: async (tarballPath, actualBinding, callback) => {
			assert.equal(tarballPath, '/reviewed/cli.tgz');
			assert.equal(actualBinding, binding);
			const result = await callback({ executable: '/verified/temp/dist/operon.mjs' });
			callbackCompleted = true;
			return result;
		},
		spawn: (node, argv, options) => {
			assert.equal(node, process.execPath);
			assert.match(argv[0], /cli-speed-stage7-live\.mjs$/u);
			assert.equal(options.env.OPERON_CLI_EXECUTABLE, undefined);
			assert.equal(options.env.OPERON_CLI_STAGE7_CANDIDATE, undefined);
			assert.equal(options.env.OPERON_PUBLISHED_CLI_EXECUTABLE, '/verified/temp/dist/operon.mjs');
			return { status: 0, stdout: '{"status":"ok"}\n', stderr: '' };
		},
	});
	assert.equal(callbackCompleted, true);
	assert.equal(output, '{"status":"ok"}\n');
});
