import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCliImpactV1, inspectCliImpactV1 } from './cli-impact.mjs';
import { classifyRuntimeProviderV1SnapshotDiff } from './runtime-provider-v1.mjs';

test('CLI impact statuses are informational and never block Plugin work', async () => {
	for (const [changes, status] of [
		[[], 'current'],
		[[{ classification: 'additive' }], 'lagging'],
		[[{ classification: 'breaking' }], 'incompatible'],
		[undefined, 'unknown'],
	]) {
		const result = classifyCliImpactV1(changes);
		assert.equal(result.status, status);
		assert.equal(result.runtimeApi, 'V1');
		assert.equal(result.blocking, false);
	}
	assert.deepEqual(
		await inspectCliImpactV1({ inspection: { changes: [{ classification: 'additive' }] } }),
		{
			status: 'lagging',
			reason: 'additive-runtime-surface-added',
			runtimeApi: 'V1',
			blocking: false,
		},
	);
});

test('an additive capability is reported as lagging rather than a Plugin blocker', () => {
	const baseline = {
		baselineVersion: 1,
		runtimeContract: 1,
		schemaDocuments: {},
		schemaDirections: {},
		entrypoints: [],
		capabilities: ['system.health'],
		contractPolicy: { inputs: 'strict', outputs: 'additive' },
	};
	const current = structuredClone(baseline);
	current.capabilities.push('tasks.future');
	const changes = classifyRuntimeProviderV1SnapshotDiff(baseline, current);
	assert.deepEqual(classifyCliImpactV1(changes), {
		status: 'lagging',
		reason: 'additive-runtime-surface-added',
		runtimeApi: 'V1',
		blocking: false,
	});
});
