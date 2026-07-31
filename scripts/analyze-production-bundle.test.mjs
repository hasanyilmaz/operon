import assert from 'node:assert/strict';
import test from 'node:test';

import {
	analyzeProductionBundleMetafile,
	formatProductionBundleAnalysis,
} from './analyze-production-bundle.mjs';

function metafileFixture(extraInputs = {}) {
	return {
		outputs: {
			'main.js': {
				entryPoint: 'main.ts',
				bytes: 1_000,
				inputs: {
					'main.ts': { bytesInOutput: 400 },
					'src/agent-runtime/contracts/v1/decode.ts': { bytesInOutput: 250 },
					'src/agent-runtime/runtime/facade.ts': { bytesInOutput: 200 },
					'src/agent-runtime/transport/dispatcher.ts': { bytesInOutput: 100 },
					'src/agent-runtime/developer-api/runtime.ts': { bytesInOutput: 50 },
					...extraInputs,
				},
			},
		},
	};
}

test('reports total, Agent Runtime subgroups, and top contributors', () => {
	const analysis = analyzeProductionBundleMetafile(metafileFixture(), 2);
	assert.equal(analysis.totalBytes, 1_000);
	assert.equal(analysis.agentRuntime.bytes, 600);
	assert.equal(analysis.agentRuntime.percent, 60);
	assert.deepEqual(analysis.agentRuntime.subgroups, {
		contracts: 250,
		'developer-api': 50,
		public: 0,
		runtime: 200,
		transport: 100,
		other: 0,
	});
	assert.deepEqual(analysis.agentRuntime.topContributors, [
		{ path: 'src/agent-runtime/contracts/v1/decode.ts', bytes: 250 },
		{ path: 'src/agent-runtime/runtime/facade.ts', bytes: 200 },
	]);
	assert.deepEqual(analysis.forbiddenInputs, []);
	assert.match(formatProductionBundleAnalysis(analysis), /Agent Runtime: 600 bytes \(60\.00%\)/u);
});

test('reports package, scripts, schemas, docs, tests, and fixtures as forbidden inputs', () => {
	const analysis = analyzeProductionBundleMetafile(metafileFixture({
		'packages/operon-cli/src/main.ts': { bytesInOutput: 1 },
		'scripts/generated-helper.mjs': { bytesInOutput: 1 },
		'contracts/agent-runtime/v1/read.schema.json': { bytesInOutput: 1 },
		'docs/operon-docs/README.md': { bytesInOutput: 1 },
		'src/agent-runtime/runtime/example.test.ts': { bytesInOutput: 1 },
		'src/agent-runtime/fixtures/example.ts': { bytesInOutput: 1 },
	}));
	assert.deepEqual(
		analysis.forbiddenInputs.map(input => input.id),
		[
			'cli-package',
			'build-or-test-script',
			'canonical-schema-document',
			'generated-documentation',
			'test-or-fixture',
			'test-or-fixture',
		],
	);
});

test('reports test-only fixture modules outside a fixtures directory', () => {
	const analysis = analyzeProductionBundleMetafile(metafileFixture({
		'src/agent-runtime/contracts/v1/fixture-decoders.ts': { bytesInOutput: 1 },
		'src/agent-runtime/contracts/v1/schema-fixture.ts': { bytesInOutput: 1 },
		'src/agent-runtime/contracts/v1/fixtures.generated.ts': { bytesInOutput: 1 },
		'src/agent-runtime/contracts/v1/decode.test-helper.ts': { bytesInOutput: 1 },
		'src/agent-runtime/contracts/v1/__tests__/decode.ts': { bytesInOutput: 1 },
		'src/agent-runtime/contracts/v1/testing/decode.ts': { bytesInOutput: 1 },
	}));
	assert.deepEqual(
		analysis.forbiddenInputs.map(input => input.path),
		[
			'src/agent-runtime/contracts/v1/fixture-decoders.ts',
			'src/agent-runtime/contracts/v1/schema-fixture.ts',
			'src/agent-runtime/contracts/v1/fixtures.generated.ts',
			'src/agent-runtime/contracts/v1/decode.test-helper.ts',
			'src/agent-runtime/contracts/v1/__tests__/decode.ts',
			'src/agent-runtime/contracts/v1/testing/decode.ts',
		],
	);
});

test('reports detailed mutation acceptance metadata as a forbidden production input', () => {
	const analysis = analyzeProductionBundleMetafile(metafileFixture({
		'src/agent-runtime/contracts/v1/mutation-acceptance.ts': { bytesInOutput: 5_000 },
	}));
	assert.deepEqual(analysis.forbiddenInputs, [{
		id: 'detailed-acceptance-metadata',
		path: 'src/agent-runtime/contracts/v1/mutation-acceptance.ts',
	}]);
});

test('normalizes Windows paths before grouping and policy checks', () => {
	const analysis = analyzeProductionBundleMetafile({
		outputs: {
			'dist\\main.js': {
				entryPoint: 'main.ts',
				bytes: 100,
				inputs: {
					'src\\agent-runtime\\runtime\\facade.ts': { bytesInOutput: 75 },
					'packages\\operon-cli\\src\\main.ts': { bytesInOutput: 25 },
				},
			},
		},
	});
	assert.equal(analysis.agentRuntime.subgroups.runtime, 75);
	assert.deepEqual(analysis.forbiddenInputs, [
		{ id: 'cli-package', path: 'packages/operon-cli/src/main.ts' },
	]);
});

test('rejects malformed metafiles and invalid top counts', () => {
	assert.throws(
		() => analyzeProductionBundleMetafile({ outputs: {} }),
		/OPERON_PRODUCTION_MAIN_OUTPUT_MISSING/u,
	);
	assert.throws(
		() => analyzeProductionBundleMetafile(metafileFixture(), 0),
		/OPERON_PRODUCTION_METAFILE_TOP_COUNT_INVALID/u,
	);
});

test('selects one exact main.ts entrypoint and rejects ambiguous or renamed outputs', () => {
	const multiOutput = metafileFixture();
	multiOutput.outputs['chunks/main.js'] = {
		entryPoint: 'src/other.ts',
		bytes: 50,
		inputs: { 'src/other.ts': { bytesInOutput: 50 } },
	};
	assert.equal(analyzeProductionBundleMetafile(multiOutput).totalBytes, 1_000);

	const ambiguous = metafileFixture();
	ambiguous.outputs['dist/main.js'] = {
		entryPoint: '/workspace/main.ts',
		bytes: 50,
		inputs: { 'main.ts': { bytesInOutput: 50 } },
	};
	assert.throws(
		() => analyzeProductionBundleMetafile(ambiguous),
		/OPERON_PRODUCTION_MAIN_OUTPUT_AMBIGUOUS/u,
	);

	const renamed = metafileFixture();
	renamed.outputs['bundle.js'] = renamed.outputs['main.js'];
	delete renamed.outputs['main.js'];
	assert.throws(
		() => analyzeProductionBundleMetafile(renamed),
		/OPERON_PRODUCTION_MAIN_OUTPUT_INVALID/u,
	);
});
