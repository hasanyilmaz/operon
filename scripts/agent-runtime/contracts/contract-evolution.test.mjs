import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyContractChangeV1,
	classifyContractDiffV1,
} from './contract-evolution.mjs';

for (const kind of [
	'field-removed',
	'field-made-required',
	'field-made-optional',
	'type-narrowed',
	'control-flow-enum-changed',
	'exit-meaning-changed',
	'capability-semantics-changed',
	'error-semantics-changed',
	'sealed-plan-input-expanded',
	'authorization-input-expanded',
]) {
	test(`${kind} requires a new Runtime contract`, () => {
		assert.deepEqual(classifyContractChangeV1({ kind, surface: 'runtime' }), {
			classification: 'breaking',
			requiredMajor: 'runtime-v2',
		});
	});
}

test('CLI breaking changes require CLI 2.0', () => {
	assert.equal(
		classifyContractChangeV1({ kind: 'exit-meaning-changed', surface: 'cli' }).requiredMajor,
		'cli-2.0',
	);
});

test('making a required response field optional is breaking', () => {
	const changes = classifyContractDiffV1({
		type: 'object',
		required: ['ok'],
		properties: { ok: { type: 'boolean' } },
	}, {
		type: 'object',
		required: [],
		properties: { ok: { type: 'boolean' } },
	}, { direction: 'response' });
	assert.equal(changes.length, 1);
	assert.equal(changes[0].kind, 'field-made-optional');
	assert.equal(changes[0].classification, 'breaking');
});

for (const kind of [
	'optional-response-field-added',
	'optional-schema-entrypoint-added',
	'capability-added',
	'error-code-added',
	'deprecation-announced',
]) {
	test(`${kind} remains additive with review`, () => {
		assert.equal(classifyContractChangeV1({ kind }).classification, 'additive');
	});
}

test('unknown change kinds stop for manual review', () => {
	assert.deepEqual(classifyContractChangeV1({ kind: 'future-change' }), {
		classification: 'unclassified',
		review: 'manual-contract-review-required',
	});
});

test('malformed change input is rejected', () => {
	assert.throws(() => classifyContractChangeV1(null), /CONTRACT_CHANGE_INVALID/u);
});

test('schema snapshot comparison detects removals, required fields, narrowing, and additive fields', () => {
	const changes = classifyContractDiffV1({
		type: 'object',
		required: ['stable'],
		properties: {
			stable: { type: 'string', enum: ['a', 'b'] },
			removed: { type: 'string' },
		},
	}, {
		type: 'object',
		required: ['stable', 'added'],
		properties: {
			stable: { type: 'string', enum: ['a'] },
			added: { type: 'string' },
		},
	}, { direction: 'response' });
	assert.deepEqual(
		changes.map(change => change.kind),
		[
			'field-made-required',
			'control-flow-enum-changed',
			'field-removed',
			'optional-response-field-added',
		],
	);
	assert.equal(changes.filter(change => change.classification === 'breaking').length, 3);
});

test('manifest snapshot comparison detects entrypoint and registry semantic drift', () => {
	const changes = classifyContractDiffV1({
		entrypoints: [{ schemaId: 'read', ref: 'urn:before' }],
		errorRegistry: [{ code: 'invalid-request', action: 'fix-request' }],
		capabilities: [{ id: 'tasks.read', availability: 'available' }],
		exitCodes: { usage: 2 },
	}, {
		entrypoints: [
			{ schemaId: 'read', ref: 'urn:after' },
			{ schemaId: 'future', ref: 'urn:future' },
		],
		errorRegistry: [
			{ code: 'invalid-request', action: 'report-bug' },
			{ code: 'future-error', action: 'do-not-retry' },
		],
		capabilities: [
			{ id: 'tasks.read', availability: 'unavailable' },
			{ id: 'future.read', availability: 'available' },
		],
		exitCodes: { usage: 70 },
	}, { surface: 'cli' });
	assert.ok(changes.some(change => change.kind === 'error-semantics-changed'));
	assert.ok(changes.some(change => change.kind === 'capability-semantics-changed'));
	assert.ok(changes.some(change => change.kind === 'optional-schema-entrypoint-added'));
	assert.ok(changes.some(change => change.kind === 'exit-meaning-changed'));
	assert.ok(changes.some(change => change.requiredMajor === 'cli-2.0'));
});

test('schema snapshot comparison traverses definitions, combinators, arrays, and constraints', () => {
	const changes = classifyContractDiffV1({
		$defs: {
			nested: {
				type: 'object',
				properties: {
					state: { enum: ['ready', 'blocked'] },
				},
			},
		},
		allOf: [{
			type: 'array',
			items: { type: 'string', minLength: 1 },
		}],
	}, {
		$defs: {
			nested: {
				type: 'object',
				properties: {
					state: { enum: ['ready'] },
				},
			},
		},
		allOf: [{
			type: 'array',
			items: { type: 'string', minLength: 2 },
		}],
	});
	assert.ok(changes.some(change => change.kind === 'control-flow-enum-changed'));
	assert.ok(changes.some(change => change.kind === 'type-narrowed'));
	assert.ok(changes.every(change => change.classification === 'breaking'));
});

test('optional strict-input expansion is breaking while optional response expansion is additive', () => {
	const before = {
		type: 'object',
		additionalProperties: false,
		properties: { stable: { type: 'string' } },
	};
	const after = {
		...before,
		properties: {
			...before.properties,
			future: { type: 'string' },
		},
	};
	const inputChanges = classifyContractDiffV1(before, after, { direction: 'input' });
	assert.equal(inputChanges[0].kind, 'authorization-input-expanded');
	assert.equal(inputChanges[0].classification, 'breaking');
	const responseChanges = classifyContractDiffV1(before, after, { direction: 'response' });
	assert.equal(responseChanges[0].kind, 'optional-response-field-added');
	assert.equal(responseChanges[0].classification, 'additive');
});

test('path-aware direction classification applies strict input and additive response policy', () => {
	const before = {
		type: 'object',
		properties: {
			request: {
				type: 'object',
				additionalProperties: false,
				properties: {},
			},
			result: {
				type: 'object',
				additionalProperties: true,
				properties: {},
			},
			unclassified: {
				type: 'object',
				properties: {},
			},
		},
	};
	const after = structuredClone(before);
	after.properties.request.properties.future = { type: 'string' };
	after.properties.result.properties.future = { type: 'string' };
	after.properties.unclassified.properties.future = { type: 'string' };
	const changes = classifyContractDiffV1(before, after, {
		directionForPath(path) {
			if (path.startsWith('/request')) return 'input';
			if (path.startsWith('/result')) return 'response';
			return undefined;
		},
	});
	assert.deepEqual(changes.map(change => change.kind), [
		'authorization-input-expanded',
		'optional-response-field-added',
		'direction-unknown-field-added',
	]);
	assert.equal(changes[0].classification, 'breaking');
	assert.equal(changes[1].classification, 'additive');
	assert.equal(changes[2].classification, 'unclassified');
});

test('registry deprecation announcement is additive while semantic or deprecation drift is breaking', () => {
	const before = {
		capabilities: [{
			id: 'tasks.read',
			availability: 'available',
		}],
	};
	const announced = classifyContractDiffV1(before, {
		capabilities: [{
			id: 'tasks.read',
			availability: 'available',
			deprecation: {
				announcedIn: '1.1.0',
				removal: 'runtime-v2',
			},
		}],
	});
	assert.deepEqual(announced.map(change => change.kind), ['deprecation-announced']);
	assert.equal(announced[0].classification, 'additive');

	const changedDeprecation = classifyContractDiffV1({
		capabilities: [{
			...before.capabilities[0],
			deprecation: {
				announcedIn: '1.1.0',
				removal: 'runtime-v2',
			},
		}],
	}, {
		capabilities: [{
			...before.capabilities[0],
			deprecation: {
				announcedIn: '1.2.0',
				removal: 'runtime-v2',
			},
		}],
	});
	assert.deepEqual(changedDeprecation.map(change => change.kind), ['deprecation-changed']);
	assert.equal(changedDeprecation[0].classification, 'breaking');

	const semanticDrift = classifyContractDiffV1(before, {
		capabilities: [{
			id: 'tasks.read',
			availability: 'unavailable',
			deprecation: {
				announcedIn: '1.1.0',
				removal: 'runtime-v2',
			},
		}],
	});
	assert.ok(semanticDrift.some(change => change.kind === 'capability-semantics-changed'));
	assert.ok(semanticDrift.some(change => change.classification === 'breaking'));
});

test('top-level deprecation inventory admits additions but rejects removal or rewriting', () => {
	const entry = {
		id: 'tasks.read',
		announcedIn: '1.1.0',
		removal: 'runtime-v2',
	};
	const announced = classifyContractDiffV1(
		{ deprecations: [] },
		{ deprecations: [entry] },
	);
	assert.deepEqual(announced.map(change => change.kind), ['deprecation-announced']);
	assert.equal(announced[0].classification, 'additive');

	const removed = classifyContractDiffV1(
		{ deprecations: [entry] },
		{ deprecations: [] },
	);
	assert.deepEqual(removed.map(change => change.kind), ['deprecation-changed']);
	assert.equal(removed[0].classification, 'breaking');

	const propertyRemoved = classifyContractDiffV1(
		{ deprecations: [entry] },
		{},
	);
	assert.deepEqual(propertyRemoved.map(change => change.kind), ['deprecation-changed']);
	assert.equal(propertyRemoved[0].classification, 'breaking');
});

test('removing an entire capability or error registry is breaking', () => {
	for (const [property, entry, expectedKind] of [
		['capabilities', { id: 'tasks.read' }, 'capability-semantics-changed'],
		['errorRegistry', { code: 'invalid-request' }, 'error-semantics-changed'],
	]) {
		const changes = classifyContractDiffV1({ [property]: [entry] }, {});
		assert.deepEqual(changes.map(change => change.kind), [expectedKind]);
		assert.equal(changes[0].classification, 'breaking');
	}
});

test('removing the entire schema entrypoint registry is breaking', () => {
	const changes = classifyContractDiffV1({
		entrypoints: [{
			schemaId: 'task-get-request',
			ref: 'urn:operon:schema:runtime:v1:read.schema.json#/$defs/taskGetRequest',
		}],
	}, {});
	assert.deepEqual(changes.map(change => change.kind), ['field-removed']);
	assert.equal(changes[0].path, '/entrypoints');
	assert.equal(changes[0].classification, 'breaking');
});

test('reference, semantic annotation, and boolean-schema drift are blocking', () => {
	for (const [before, after, expectedKind] of [
		[{ $ref: '#/$defs/one' }, { $ref: '#/$defs/two' }, 'schema-keyword-changed'],
		[
			{ 'x-operon-sealedPlanSafety': true },
			{ 'x-operon-sealedPlanSafety': false },
			'schema-keyword-changed',
		],
		[{ items: { type: 'string' } }, { items: false }, 'type-narrowed'],
	]) {
		const changes = classifyContractDiffV1(before, after);
		assert.ok(changes.some(change => change.kind === expectedKind));
		assert.ok(changes.some(change => change.classification !== 'additive'));
	}
});

test('new dependent and pattern schema-map entries are blocking', () => {
	for (const keyword of ['dependentSchemas', 'patternProperties']) {
		const changes = classifyContractDiffV1({
			[keyword]: {
				stable: { type: 'string' },
			},
		}, {
			[keyword]: {
				stable: { type: 'string' },
				future: { type: 'number' },
			},
		});
		assert.ok(changes.some(change => change.kind === 'schema-keyword-changed'));
		assert.ok(changes.some(change => change.classification === 'unclassified'));
	}
});

test('additive error registry, known-value annotation, and entrypoint changes stay additive', () => {
	const changes = classifyContractDiffV1({
		$defs: {
			errorCode: {
				type: 'string',
				'x-operon-knownValues': ['stable-error'],
			},
		},
		entrypoints: [{ schemaId: 'stable', ref: 'urn:stable' }],
		errorRegistry: [{ code: 'stable-error', action: 'do-not-retry' }],
	}, {
		$defs: {
			errorCode: {
				type: 'string',
				'x-operon-knownValues': ['stable-error', 'new-error'],
			},
		},
		entrypoints: [
			{ schemaId: 'stable', ref: 'urn:stable' },
			{ schemaId: 'new-entrypoint', ref: 'urn:new' },
		],
		errorRegistry: [
			{ code: 'stable-error', action: 'do-not-retry' },
			{ code: 'new-error', action: 'fix-environment' },
		],
	});
	assert.deepEqual(
		changes.map(change => change.kind).sort(),
		['error-code-added', 'optional-schema-entrypoint-added'],
	);
	assert.ok(changes.every(change => change.classification === 'additive'));
});
