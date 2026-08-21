import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const baseRoot = path.join(root, 'contracts', 'agent-runtime', 'v1');
const extensionRoot = path.join(root, 'contracts', 'agent-runtime', 'extensions', 'task-workflows-v1');
const manifestPath = path.join(extensionRoot, 'extension-manifest.json');

test('task-workflows-v1 manifest binds every extension document and entrypoint', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	assert.equal(manifest.contractVersion, 1);
	assert.equal(manifest.extensionId, 'task-workflows-v1');
	assert.equal(manifest.baseSchemaManifestAggregateSha256, '7cc7826093758c61491551c9ee925440e7641fecc44b953f7ea2c8595eb345fa');
	const aggregate = manifest.aggregateSha256;
	delete manifest.aggregateSha256;
	assert.equal(sha256(Buffer.from(JSON.stringify(manifest))), aggregate);

	const ajv = new Ajv2020({ strict: true, strictSchema: false, strictRequired: false, strictTypes: false, validateFormats: false });
	ajv.addKeyword({ keyword: 'x-operon-maxUtf8Bytes', schemaType: 'number' });
	ajv.addKeyword({ keyword: 'x-operon-uniqueBy' });
	ajv.addKeyword({ keyword: 'x-operon-frozenCapabilityRegistry', schemaType: 'boolean' });
	for (const directory of [baseRoot, extensionRoot]) {
		for (const file of (await readdir(directory)).filter(name => name.endsWith('.schema.json'))) {
			ajv.addSchema(JSON.parse(await readFile(path.join(directory, file), 'utf8')));
		}
	}
	for (const document of manifest.documents) {
		const bytes = await readFile(path.join(extensionRoot, document.file));
		assert.equal(sha256(bytes), document.sha256, document.file);
		assert.equal(JSON.parse(bytes).$id, document.id, document.file);
	}
	for (const entrypoint of manifest.entrypoints) {
		assert.equal(typeof ajv.getSchema(entrypoint.ref), 'function', entrypoint.schemaId);
		assert.ok(entrypoint.direction === 'input' || entrypoint.direction === 'response');
	}
});

test('task-workflows-v1 leaf schemas remain strict and feature-specific', async () => {
	const ajv = new Ajv2020({ strict: true, strictSchema: false, strictRequired: false, strictTypes: false, validateFormats: false });
	ajv.addKeyword({ keyword: 'x-operon-maxUtf8Bytes', schemaType: 'number' });
	ajv.addKeyword({ keyword: 'x-operon-uniqueBy' });
	ajv.addKeyword({ keyword: 'x-operon-frozenCapabilityRegistry', schemaType: 'boolean' });
	for (const directory of [baseRoot, extensionRoot]) {
		for (const file of (await readdir(directory)).filter(name => name.endsWith('.schema.json'))) {
			ajv.addSchema(JSON.parse(await readFile(path.join(directory, file), 'utf8')));
		}
	}
	const filter = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:read#/$defs/request');
	assert.equal(filter({
		contractVersion: 1,
		requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		scope: { kind: 'folder-tree', path: 'Projects' },
	}), true, JSON.stringify(filter.errors));
	assert.equal(filter({
		contractVersion: 1,
		requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		unknown: true,
	}), false);
	assert.equal(filter({
		contractVersion: 1,
		requestId: 'req-1',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
	}), true, JSON.stringify(filter.errors));
	for (const cursor of ['x', ' padded-cursor-value ']) assert.equal(filter({
		contractVersion: 1,
		requestId: 'req-1',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		cursor,
	}), false, cursor);
	for (const invalidPath of ['a//b', 'a/./b', 'C:/x']) assert.equal(filter({
		contractVersion: 1,
		requestId: 'req-1',
		kind: 'task-filter-query',
		consistency: 'live-verified',
		filterSetId: 'saved-filter',
		scope: { kind: 'folder-tree', path: invalidPath },
	}), false, invalidPath);

	const target = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:mutation#/$defs/identityPlaceholderFileTarget');
	assert.equal(target({
		representation: 'file',
		mode: 'configured-default',
		identityPlaceholderPolicy: 'resolve-operon-id-v1',
	}), true, JSON.stringify(target.errors));
	assert.equal(target({
		representation: 'inline',
		mode: 'configured-default',
		identityPlaceholderPolicy: 'resolve-operon-id-v1',
	}), false);
	for (const invalidPath of ['a//b', 'a/./b', 'C:/x']) assert.equal(target({
		representation: 'file',
		mode: 'exact-path',
		filePath: invalidPath,
		identityPlaceholderPolicy: 'resolve-operon-id-v1',
	}), false, invalidPath);
	const periodicTarget = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:mutation#/$defs/periodicNoteCreateTarget');
	assert.equal(periodicTarget({
		representation: 'inline',
		mode: 'periodic-note',
		periodicKind: 'weekly',
		routeDate: '2026-08-21',
	}), true, JSON.stringify(periodicTarget.errors));
	assert.equal(periodicTarget({
		representation: 'inline',
		mode: 'periodic-note',
		periodicKind: 'daily',
		routeDate: '2026-2-3',
	}), false, 'periodic routeDate is strict');
	const periodicSpec = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:mutation#/$defs/periodicNoteCreateSpec');
	const periodicItem = {
		itemRef: 'periodic-1',
		description: 'Route me',
		target: { representation: 'inline', mode: 'periodic-note', periodicKind: 'daily' },
		fields: [],
	};
	assert.equal(periodicSpec({ operation: 'create', items: [periodicItem] }), true, JSON.stringify(periodicSpec.errors));
	assert.equal(periodicSpec({ operation: 'create', items: [periodicItem, { ...periodicItem, itemRef: 'periodic-2' }] }), false, 'periodic create accepts exactly one item');
	assert.equal(periodicSpec({ operation: 'create', items: [{ ...periodicItem, parent: { operonId: 'abc1234' } }] }), false, 'periodic create rejects caller-provided parent');
	assert.equal(periodicSpec({ operation: 'create', items: [{ ...periodicItem, bodyMarkdown: 'body' }] }), false, 'periodic create rejects body overrides');
	const periodicUpdateSpec = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:mutation#/$defs/periodicNoteUpdateSpec');
	const periodicUpdate = {
		operation: 'update-periodic-note',
		target: { operonId: 'abc1234', locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 2 } },
		changes: [{ field: 'dateScheduled', valueType: 'date', value: '2026-08-21' }],
	};
	assert.equal(periodicUpdateSpec(periodicUpdate), true, JSON.stringify(periodicUpdateSpec.errors));
	assert.equal(periodicUpdateSpec({ ...periodicUpdate, changes: [] }), false, 'periodic update requires a scheduled-date change');
	assert.equal(periodicUpdateSpec({ ...periodicUpdate, changes: [...periodicUpdate.changes, { operation: 'clear', field: 'dateScheduled', valueType: 'date' }] }), false, 'periodic update accepts one scheduled-date change');
	assert.equal(periodicUpdateSpec({ ...periodicUpdate, changes: [...periodicUpdate.changes, { field: 'parentTask', valueType: 'text', value: 'def5678' }] }), false, 'periodic update rejects caller-provided parent');
	const canonicalParityChanges = [
		...periodicUpdate.changes,
		{ field: 'taskType', valueType: 'text', value: 'project' },
		{ field: 'taskImage', valueType: 'text', value: 'cover.png' },
		{ field: 'taskGallery', valueType: 'list', value: ['one.png', 'two\\,literal.png', 'three.png'] },
	];
	assert.equal(periodicUpdateSpec({ ...periodicUpdate, changes: canonicalParityChanges }), true, JSON.stringify(periodicUpdateSpec.errors));
	assert.equal(periodicUpdateSpec({ ...periodicUpdate, changes: [...periodicUpdate.changes, { field: '__taskDataType', valueType: 'text', value: 'Table' }] }), false, '__taskDataType remains read-only and absent from Runtime writes');
	const combined = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:capabilities#/$defs/combinedCapabilityAdvertisements');
	const advertisements = [
		{ id: 'system.health', availability: 'available', stability: 'stable' },
		{ id: 'tasks.filter-query', availability: 'available', stability: 'stable' },
		{ id: 'tasks.create.identity-placeholders', availability: 'available', stability: 'stable' },
		{ id: 'tasks.create.periodic-note.preview', availability: 'available', stability: 'stable' },
		{ id: 'tasks.create.periodic-note.apply', availability: 'available', stability: 'stable' },
		{ id: 'tasks.update.periodic-note.preview', availability: 'available', stability: 'stable' },
		{ id: 'tasks.update.periodic-note.apply', availability: 'available', stability: 'stable' },
		{ id: 'tasks.adopt.preview', availability: 'available', stability: 'stable' },
		{ id: 'tasks.adopt.apply', availability: 'available', stability: 'stable' },
	];
	assert.equal(combined(advertisements), true, JSON.stringify(combined.errors));
	assert.equal(combined(advertisements.slice(0, -1)), false, 'combined advertisement requires every extension capability');
	const developerAccess = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:developer-api#/$defs/accessRequest');
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.filter-query'] }), true, JSON.stringify(developerAccess.errors));
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.adopt.preview', 'tasks.adopt.apply'] }), true, JSON.stringify(developerAccess.errors));
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.create.periodic-note.preview', 'tasks.create.periodic-note.apply'] }), true, JSON.stringify(developerAccess.errors));
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.update.periodic-note.preview', 'tasks.update.periodic-note.apply'] }), true, JSON.stringify(developerAccess.errors));
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.update.periodic-note.apply', 'tasks.update.periodic-note.preview'] }), false, 'periodic update capability subsets are canonical-order only');
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.create.periodic-note.apply', 'tasks.create.periodic-note.preview'] }), false, 'periodic capability subsets are canonical-order only');
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.adopt.apply', 'tasks.adopt.preview'] }), false, 'access capability subsets are canonical-order only');
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.adopt.preview', 'tasks.adopt.preview'] }), false, 'access capability subsets reject duplicates');
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.create.identity-placeholders'] }), false, 'identity creation remains outside the Developer API extension accessor');
	assert.equal(developerAccess({ contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.query'] }), false, 'base capability cannot enter the extension accessor');
});

test('task-workflows-v1 rejects cross-kind command, capability, and base-contract confusion', async () => {
	const ajv = new Ajv2020({ strict: true, strictSchema: false, strictRequired: false, strictTypes: false, validateFormats: false });
	ajv.addKeyword({ keyword: 'x-operon-maxUtf8Bytes', schemaType: 'number' });
	ajv.addKeyword({ keyword: 'x-operon-uniqueBy' });
	ajv.addKeyword({ keyword: 'x-operon-frozenCapabilityRegistry', schemaType: 'boolean' });
	for (const directory of [baseRoot, extensionRoot]) {
		for (const file of (await readdir(directory)).filter(name => name.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(await readFile(path.join(directory, file), 'utf8')));
	}
	const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	const filterRequest = { contractVersion: 1, requestId, kind: 'task-filter-query', consistency: 'live-verified', filterSetId: 'saved-filter' };
	const invocation = {
		contractVersion: 1,
		kind: 'cli-invocation',
		requestId,
		command: 'tasks.filter-query',
		mode: 'live',
		clientVersion: '1.1.0',
		compatibility: { contractVersion: 1, runtimeApi: { min: 1, max: 1 } },
		cliContract: { min: 1, max: 1 },
		expectedVaultSha256: 'a'.repeat(64),
		readinessTimeoutMs: 15000,
		request: filterRequest,
	};
	const extensionInvocation = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:cli#/$defs/invocation');
	const extensionResult = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:cli#/$defs/resultEnvelope');
	const baseInvocation = ajv.getSchema('urn:operon:schema:runtime:v1:cli.schema.json#/$defs/invocation');
	assert.equal(extensionInvocation(invocation), true, JSON.stringify(extensionInvocation.errors));
	assert.equal(baseInvocation(invocation), false, 'frozen base CLI must not silently absorb the extension');
	assert.equal(extensionInvocation({ ...invocation, command: 'mutation.preview' }), false, 'command/request confusion');
	const resultEnvelope = {
		contractVersion: 1,
		kind: 'cli-result',
		requestId,
		command: 'tasks.filter-query',
		ok: true,
		transport: { channel: 'request-file', inputBytes: 1 },
		vaultIdentity: { expectedMatch: true },
		compatibility: { contractVersion: 1, compatible: true, runtimeApi: 1 },
		cliContract: 1,
		runtime: { appVersion: '1.13.3', plugin: { id: 'operon', version: '3.2.0', minAppVersion: '1.7.2' }, apiVersion: 1 },
		timing: { handlerMs: 1 },
		warnings: [],
		result: {
			contractVersion: 1,
			requestId,
			kind: 'task-filter-query-result',
			ok: false,
			freshness: { source: 'live-runtime', coherence: 'verified', observedAt: '2026-08-09T00:00:00.000Z', settled: true },
			warnings: [],
			error: { contractVersion: 1, code: 'capability-unavailable', reason: 'Unavailable.', retryable: false, action: 'rediscover' },
		},
	};
	assert.equal(extensionResult(resultEnvelope), true, JSON.stringify(extensionResult.errors));
	assert.equal(extensionResult({ ...resultEnvelope, result: { contractVersion: 1, requestId, kind: 'mutation-preview-result', ok: false, warnings: [], error: resultEnvelope.result.error } }), false, 'command/result confusion');
	assert.equal(extensionResult({
		...resultEnvelope,
		recovery: { required: true, planRef: 'plan-ref', action: 'recover-same-plan', mutationMayHaveApplied: true },
		client: { planRef: 'plan-ref' },
	}), false, 'recovery metadata is valid only for mutation.apply');
	const mutationResult = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:mutation#/$defs/mutationResult');
	assert.equal(mutationResult({
		contractVersion: 1,
		requestId,
		kind: 'mutation-result',
		status: 'applied',
		mutationMayHaveApplied: false,
		retryAllowed: true,
		groupResults: [],
	}), false, 'applied results require committed groups, final receipt, and verified postflight');

	const preview = ajv.getSchema('urn:operon:schema:runtime:v1:extension:task-workflows:mutation#/$defs/previewRequest');
	const adopt = {
		contractVersion: 1,
		requestId,
		kind: 'mutation-preview',
		clientInstanceId: 'cli-test',
		idempotencyKey: 'abcdefghijklmnop',
		capability: 'tasks.adopt.preview',
		mutationKind: 'task.adopt',
		spec: { operation: 'adopt-inline', source: { filePath: 'Tasks.md', lineNumber: 0, expectedLine: '- [ ] task' } },
		authorization: { basis: 'user-explicit-request' },
	};
	assert.equal(preview(adopt), true, JSON.stringify(preview.errors));
	assert.equal(preview({ ...adopt, capability: 'tasks.create.preview' }), false, 'capability/kind confusion');
	assert.equal(preview({ ...adopt, mutationKind: 'task.create' }), false, 'mutation/spec confusion');
	const identity = {
		...adopt,
		capability: 'tasks.create.identity-placeholders',
		mutationKind: 'task.create',
		spec: {
			operation: 'create',
			items: [{
				itemRef: 'item-1',
				description: 'Task',
				target: {
					representation: 'file',
					mode: 'configured-default',
					identityPlaceholderPolicy: 'resolve-operon-id-v1',
				},
				fields: [],
			}],
		},
	};
	assert.equal(preview(identity), true, JSON.stringify(preview.errors));
	assert.equal(preview({ ...identity, capability: 'tasks.create.preview' }), false, 'identity capability must remain extension-specific');
	const periodicUpdate = {
		...adopt,
		capability: 'tasks.update.periodic-note.preview',
		mutationKind: 'task.update',
		spec: {
			operation: 'update-periodic-note',
			target: { operonId: 'abc1234', locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 } },
			changes: [{ operation: 'clear', field: 'dateScheduled', valueType: 'date' }],
		},
	};
	assert.equal(preview(periodicUpdate), true, JSON.stringify(preview.errors));
	assert.equal(preview({ ...periodicUpdate, capability: 'tasks.update.preview' }), false, 'periodic update capability must remain extension-specific');
});

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
