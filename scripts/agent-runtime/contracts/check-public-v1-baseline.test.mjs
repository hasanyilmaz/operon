import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildPublicV1Snapshot,
	classifyPublicV1SnapshotDiffV1,
} from './check-public-v1-baseline.mjs';

test('canonical schema graph assigns strict input and additive response directions', async () => {
	const baseline = await buildPublicV1Snapshot();
	const current = structuredClone(baseline);
	current.schemaDocuments['read.schema.json'].$defs.taskGetRequest.properties.futureInput = {
		type: 'string',
	};
	current.schemaDocuments['read.schema.json'].$defs.taskQueryResult.properties.futureOutput = {
		type: 'string',
	};
	const changes = classifyPublicV1SnapshotDiffV1(baseline, current);
	assert.ok(changes.some(change => (
		change.kind === 'authorization-input-expanded'
		&& change.path.endsWith('/futureInput')
		&& change.classification === 'breaking'
	)));
	assert.ok(changes.some(change => (
		change.kind === 'optional-response-field-added'
		&& change.path.endsWith('/futureOutput')
		&& change.classification === 'additive'
	)));
});

test('unclassified schema paths stop for manual review', () => {
	const beforeSchema = {
		type: 'object',
		properties: {
			unclassified: {
				type: 'object',
				properties: {},
			},
		},
	};
	const afterSchema = structuredClone(beforeSchema);
	afterSchema.properties.unclassified.properties.future = { type: 'string' };
	const baseline = snapshotWithSchema(beforeSchema);
	const current = snapshotWithSchema(afterSchema);
	const changes = classifyPublicV1SnapshotDiffV1(baseline, current);
	assert.deepEqual(changes.map(change => change.kind), ['direction-unknown-field-added']);
	assert.equal(changes[0].classification, 'unclassified');
});

test('baseline includes and classifies the canonical deprecation inventory', async () => {
	const baseline = await buildPublicV1Snapshot();
	assert.ok(Array.isArray(baseline.deprecations));
	const current = structuredClone(baseline);
	current.deprecations.push({
		id: 'tasks.read',
		announcedIn: '1.1.0',
		removal: 'runtime-v2',
	});
	const changes = classifyPublicV1SnapshotDiffV1(baseline, current);
	assert.ok(changes.some(change => (
		change.kind === 'deprecation-announced'
		&& change.classification === 'additive'
	)));
});

test('raw schema direction drift remains manual-blocking', () => {
	const baseline = snapshotWithSchema({ type: 'object', properties: {} });
	baseline.schemaDirections['fixture.schema.json']['/'] = 'mixed';
	const current = structuredClone(baseline);
	current.schemaDirections['fixture.schema.json']['/'] = 'input';
	const changes = classifyPublicV1SnapshotDiffV1(baseline, current);
	assert.ok(changes.some(change => change.kind === 'schema-direction-changed'));
});

function snapshotWithSchema(document) {
	return {
		baselineVersion: 1,
		runtimeContract: 1,
		cliContract: 1,
		schemaDocuments: { 'fixture.schema.json': document },
		schemaDirections: { 'fixture.schema.json': {} },
		entrypoints: [],
		errorRegistry: [],
		capabilities: [],
		exitCodes: {},
		deprecations: [],
		contractPolicy: {},
	};
}
