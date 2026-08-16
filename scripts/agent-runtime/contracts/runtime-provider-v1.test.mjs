import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildRuntimeProviderV1Snapshot,
	checkRuntimeProviderV1Baseline,
	classifyRuntimeProviderV1SnapshotDiff,
} from './runtime-provider-v1.mjs';

test('provider baseline is built from Plugin-owned Runtime schemas only', async () => {
	const snapshot = await buildRuntimeProviderV1Snapshot();
	assert.ok(Object.keys(snapshot.schemaDocuments).length > 0);
	assert.equal(Object.keys(snapshot.schemaDocuments).some(file => file.startsWith('operon-cli/')), false);
	assert.ok(snapshot.entrypoints.length > 0);
	await assert.doesNotReject(checkRuntimeProviderV1Baseline());
});

test('an additive Runtime response field remains Plugin-first eligible', () => {
	const baseline = fixtureSnapshot();
	baseline.schemaDirections['fixture.schema.json']['/'] = 'response';
	const current = structuredClone(baseline);
	current.schemaDocuments['fixture.schema.json'].properties.future = { type: 'string' };
	const changes = classifyRuntimeProviderV1SnapshotDiff(baseline, current);
	assert.deepEqual(changes.map(change => change.kind), ['optional-response-field-added']);
	assert.equal(changes[0].classification, 'additive');
});

test('an additive Runtime capability marks CLI support as deferred without blocking the provider', () => {
	const baseline = fixtureSnapshot();
	baseline.capabilities = ['system.health'];
	const current = structuredClone(baseline);
	current.capabilities.push('tasks.future');
	const changes = classifyRuntimeProviderV1SnapshotDiff(baseline, current);
	assert.deepEqual(changes.map(change => change.kind), ['capability-added']);
	assert.equal(changes[0].classification, 'additive');
});

test('an existing Runtime input expansion requires Runtime V2 instead of a CLI release', () => {
	const baseline = fixtureSnapshot();
	baseline.schemaDirections['fixture.schema.json']['/'] = 'input';
	const current = structuredClone(baseline);
	current.schemaDocuments['fixture.schema.json'].properties.future = { type: 'string' };
	const changes = classifyRuntimeProviderV1SnapshotDiff(baseline, current);
	assert.deepEqual(changes.map(change => change.kind), ['authorization-input-expanded']);
	assert.equal(changes[0].requiredMajor, 'runtime-v2');
});

test('a provider-only schema document without a public entrypoint stops for review', () => {
	const baseline = fixtureSnapshot();
	const current = structuredClone(baseline);
	current.schemaDocuments['new.schema.json'] = { type: 'object', properties: {} };
	const changes = classifyRuntimeProviderV1SnapshotDiff(baseline, current);
	assert.ok(changes.some(change => change.kind === 'schema-document-added-without-entrypoint'));
});

function fixtureSnapshot() {
	return {
		baselineVersion: 1,
		runtimeContract: 1,
		schemaDocuments: {
			'fixture.schema.json': { type: 'object', properties: {} },
		},
		schemaDirections: { 'fixture.schema.json': {} },
		entrypoints: [],
		capabilities: [],
		contractPolicy: { inputs: 'strict', outputs: 'additive' },
	};
}
