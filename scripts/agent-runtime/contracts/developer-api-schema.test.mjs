import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { build } from 'esbuild';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const schemaRoot = path.join(pluginRoot, 'contracts/agent-runtime/v1');
const manifest = JSON.parse(await readFile(path.join(schemaRoot, 'schema-manifest.json'), 'utf8'));
const decoderBuild = await build({
	entryPoints: [path.join(pluginRoot, 'src/agent-runtime/contracts/v1/fixture-decoders.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node22',
	write: false,
});
const decoderModule = await import(
	`data:text/javascript;base64,${Buffer.from(decoderBuild.outputFiles[0].text).toString('base64')}`
);

const ajv = new Ajv2020({
	allErrors: true,
	allowUnionTypes: true,
	strict: false,
	validateFormats: false,
});
for (const file of (await readdir(schemaRoot)).filter(name => name.endsWith('.schema.json')).sort()) {
	ajv.addSchema(JSON.parse(await readFile(path.join(schemaRoot, file), 'utf8')));
}

const developerEntrypoints = new Map(
	manifest.entrypoints
		.filter(entrypoint => entrypoint.schemaId.startsWith('developer-'))
		.map(entrypoint => [entrypoint.schemaId, ajv.getSchema(entrypoint.ref)]),
);

const target = Object.freeze({
	operonId: 'abc1234',
	locator: {
		representation: 'inline',
		filePath: 'Notes/Plan.md',
		lineNumber: 3,
	},
});
const previewInput = Object.freeze({
	capability: 'tasks.delete.preview',
	mutationKind: 'task.delete',
	target,
	spec: {
		operation: 'delete',
		mode: 'delete-exact-task',
		cascade: false,
	},
});
const recoveryRef = `dvr1_${'1'.repeat(48)}`;
const plan = Object.freeze({
	contractVersion: 1,
	kind: 'developer-mutation-plan',
	recoveryRef,
	planDigest: 'a'.repeat(64),
	capability: 'tasks.delete.preview',
	mutationKind: 'task.delete',
	createdAt: '2026-07-29T10:00:00.000Z',
	expiresAt: '2026-07-29T10:01:00.000Z',
	riskLevel: 'destructive',
	requiresConsent: true,
	targets: [target],
	predictedEffects: [{
		resourceKind: 'task-source',
		resourceKey: 'Notes/Plan.md',
		action: 'trash',
		summary: 'Delete the exact task.',
	}],
	warnings: [],
});
const unsupportedPlatformError = Object.freeze({
	contractVersion: 1,
	code: 'unsupported-platform',
	reason: 'Developer API V1 is available only on supported Obsidian Desktop platforms.',
	retryable: false,
	action: 'fix-environment',
});
const authorityError = Object.freeze({
	contractVersion: 1,
	code: 'authority-insufficient',
	reason: 'Public mutation authority is not enabled in Stage 3.',
	retryable: false,
	action: 'request-authority',
});
const unavailableStatus = Object.freeze({
	contractVersion: 1,
	kind: 'developer-api-channel-status',
	runtimeApiVersion: 1,
	availability: 'unavailable',
	reason: 'unsupported-platform',
	authority: 'read-only',
	admission: {
		reads: false,
		writes: false,
	},
	capabilities: [],
	error: unsupportedPlatformError,
});
const grantedStatus = Object.freeze({
	contractVersion: 1,
	kind: 'developer-api-channel-status',
	runtimeApiVersion: 1,
	availability: 'available',
	reason: 'ready',
	authority: 'granted',
	consumer: {
		id: 'example-plugin',
		name: 'Example Plugin',
		version: '1.2.3',
		instanceEpoch: 'runtime-1234',
	},
	grant: {
		state: 'active',
		revision: 2,
		requestedCapabilities: ['tasks.read'],
		grantedCapabilities: ['tasks.read'],
		effectiveCapabilities: ['tasks.read'],
	},
	admission: {
		reads: true,
		writes: false,
	},
	capabilities: [],
});

const validFixtures = [
	[
		'developer-api-access-request',
		{
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
			requestedCapabilities: ['tasks.read'],
		},
	],
	['developer-api-channel-status', unavailableStatus],
	['developer-api-channel-status', grantedStatus],
	[
		'developer-api-access-failure',
		{
			contractVersion: 1,
			kind: 'developer-api-access-result',
			ok: false,
			status: unavailableStatus,
			error: unsupportedPlatformError,
		},
	],
	['developer-mutation-preview-input', previewInput],
	[
		'developer-mutation-preview-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-preview-result',
			requestId: 'developer-preview-1',
			ok: true,
			plan,
			warnings: [],
		},
	],
	['developer-mutation-apply-input', { plan }],
	['developer-mutation-recover-input', { plan }],
	['developer-mutation-recover-input', { recoveryRef }],
	[
		'developer-mutation-pending-recoveries-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-pending-recoveries-result',
			ok: true,
			recoveries: [{
				recoveryRef,
				planDigest: plan.planDigest,
				mutationKind: plan.mutationKind,
				capability: plan.capability,
				riskLevel: plan.riskLevel,
				createdAt: plan.createdAt,
				expiresAt: '2026-07-30T10:00:00.000Z',
			}],
		},
	],
	[
		'developer-mutation-execution-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-execution-result',
			requestId: 'developer-apply-1',
			status: 'failed',
			mutationMayHaveApplied: false,
			retryAllowed: false,
			groupResults: [],
			error: authorityError,
		},
	],
];

const invalidFixtures = [
	[
		'developer-api-access-request',
		{
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
			requestedCapabilities: ['tasks.read'],
			clientInstanceId: 'caller-controlled',
		},
		'caller identity is host-owned',
	],
	[
		'developer-api-access-request',
		{
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
			requestedCapabilities: ['tasks.read', 'tasks.read'],
		},
		'requested capability duplicates are rejected',
	],
	[
		'developer-mutation-preview-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-preview-result',
			requestId: 'developer-preview-sealed-plan',
			ok: true,
			plan: {
				...plan,
				planId: 'internal-plan',
				planHash: 'b'.repeat(64),
				clientInstanceId: 'internal-consumer',
				correlationId: 'internal-correlation',
				idempotencyKeyHash: 'c'.repeat(64),
				receiptTargetDigest: 'd'.repeat(64),
				contextRevision: {},
				affectedResources: {},
				atomicGroups: [],
				requiresConfirmation: true,
				requiredAcknowledgements: [],
				spec: previewInput.spec,
			},
			warnings: [],
		},
		'a complete sealed Runtime plan cannot cross the public plan-handle boundary',
	],
	[
		'developer-api-access-failure',
		{
			contractVersion: 1,
			kind: 'developer-api-access-result',
			ok: false,
			status: unavailableStatus,
			error: unsupportedPlatformError,
			api: {},
		},
		'an access failure cannot also expose an API object',
	],
	...[
		'clientInstanceId',
		'authorization',
		'consentToken',
		'acknowledgements',
		'idempotencyKey',
		'planRef',
	].map(forbiddenField => [
		'developer-mutation-preview-input',
		{ ...previewInput, [forbiddenField]: 'caller-controlled' },
		`${forbiddenField} is not a public preview input`,
	]),
	[
		'developer-mutation-preview-input',
		{ ...previewInput, capability: 'tasks.update.preview' },
		'capability and mutation kind must match',
	],
	[
		'developer-mutation-preview-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-preview-result',
			requestId: 'developer-preview-2',
			ok: true,
			plan,
			error: authorityError,
			warnings: [],
		},
		'a successful preview cannot also carry an error',
	],
	[
		'developer-mutation-preview-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-preview-result',
			requestId: 'developer-preview-3',
			ok: true,
			plan: { ...plan, authorization: { basis: 'host-policy' } },
			warnings: [],
		},
		'public plan output cannot leak authorization internals',
	],
	[
		'developer-mutation-apply-input',
		{ plan, authorization: { basis: 'host-policy' } },
		'apply accepts only the opaque plan handle',
	],
	[
		'developer-mutation-apply-input',
		{ plan: { ...plan, clientInstanceId: 'caller-controlled' } },
		'the plan input cannot be extended with caller identity',
	],
	[
		'developer-mutation-recover-input',
		{ plan, planRef: 'local-cli-plan' },
		'CLI plan references are not Developer API inputs',
	],
	[
		'developer-mutation-execution-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-execution-result',
			requestId: 'developer-apply-3',
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: [],
			receipt: {
				contractVersion: 1,
				planDigest: 'a'.repeat(64),
				mutationKind: 'task.delete',
				targetDigest: 'b'.repeat(64),
				terminalOutcome: 'applied',
				effectiveAt: '2026-07-29T10:00:00.000Z',
				completedAt: '2026-07-29T10:00:01.000Z',
				expiresAt: '2026-07-29T10:05:00.000Z',
				clientInstanceId: 'internal-consumer',
			},
		},
		'public receipt output cannot leak consumer identity',
	],
	[
		'developer-mutation-execution-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-execution-result',
			requestId: 'developer-apply-2',
			status: 'applied',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: [],
			recovery: {
				required: true,
				action: 'recover-same-plan',
				mutationMayHaveApplied: true,
				plan,
			},
		},
		'a final result cannot expose recovery',
	],
	[
		'developer-mutation-execution-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-execution-result',
			requestId: 'developer-apply-contradiction',
			status: 'applied',
			mutationMayHaveApplied: false,
			retryAllowed: true,
			groupResults: [],
			error: authorityError,
		},
		'applied results cannot contradict their effect, retry, receipt, or error state',
	],
	[
		'developer-mutation-execution-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-execution-result',
			requestId: 'developer-recovery-error-contradiction',
			status: 'outcome-unknown',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: [],
			error: authorityError,
			recovery: {
				required: true,
				action: 'recover-same-plan',
				mutationMayHaveApplied: true,
				plan,
			},
		},
		'recovery results cannot carry a conflicting structured error action',
	],
	[
		'developer-mutation-execution-result',
		{
			contractVersion: 1,
			kind: 'developer-mutation-execution-result',
			requestId: 'developer-partial-recovery-error-contradiction',
			status: 'partial',
			mutationMayHaveApplied: true,
			retryAllowed: false,
			groupResults: [
				{ groupId: 'group-1', status: 'committed' },
				{ groupId: 'group-2', status: 'failed', error: authorityError },
			],
			error: authorityError,
			recovery: {
				required: true,
				action: 'recover-same-plan',
				mutationMayHaveApplied: true,
				plan,
			},
		},
		'partial recovery cannot carry a conflicting structured error action',
	],
];

test('Developer API manifest exposes only the nine JSON DTO entrypoints', () => {
	assert.deepEqual(
		[...developerEntrypoints.keys()].sort(),
		[
			'developer-api-access-failure',
			'developer-api-access-request',
			'developer-api-channel-status',
			'developer-mutation-apply-input',
			'developer-mutation-execution-result',
			'developer-mutation-pending-recoveries-result',
			'developer-mutation-preview-input',
			'developer-mutation-preview-result',
			'developer-mutation-recover-input',
		],
	);
	assert.equal(
		manifest.entrypoints.some(entrypoint => entrypoint.schemaId === 'developer-api-object'),
		false,
		'The function-bearing API object must remain outside JSON Schema.',
	);
	for (const [schemaId, validator] of developerEntrypoints) {
		assert.equal(typeof validator, 'function', `Missing validator for ${schemaId}.`);
	}
});

test('Developer API JSON DTO schemas accept canonical fixtures', () => {
	for (const [schemaId, value] of validFixtures) {
		const validator = developerEntrypoints.get(schemaId);
		assert.ok(validator(value), `${schemaId}: ${ajv.errorsText(validator.errors)}`);
		const decoded = decoderModule.decodeContractFixtureV1(schemaId, value);
		assert.ok(decoded.ok, `${schemaId} decoder: ${JSON.stringify(decoded.issues)}`);
	}
});

test('Developer API strict inputs and result invariants reject invalid fixtures', () => {
	for (const [schemaId, value, reason] of invalidFixtures) {
		const validator = developerEntrypoints.get(schemaId);
		assert.equal(validator(value), false, `${schemaId} accepted invalid fixture: ${reason}`);
		const decoded = decoderModule.decodeContractFixtureV1(schemaId, value);
		assert.equal(decoded.ok, false, `${schemaId} decoder accepted invalid fixture: ${reason}`);
	}
});

test('Developer API semantic decoder enforces known error registry bindings', () => {
	const mismatchedError = {
		...unsupportedPlatformError,
		retryable: true,
		action: 'wait-and-retry',
	};
	const value = {
		contractVersion: 1,
		kind: 'developer-api-access-result',
		ok: false,
		status: {
			...unavailableStatus,
			error: mismatchedError,
		},
		error: mismatchedError,
	};
	const validator = developerEntrypoints.get('developer-api-access-failure');
	assert.ok(validator(value), `Structural schema unexpectedly rejected semantic fixture: ${ajv.errorsText(validator.errors)}`);
	const decoded = decoderModule.decodeContractFixtureV1('developer-api-access-failure', value);
	assert.equal(decoded.ok, false, 'Semantic decoder accepted a known error with mismatched retry/action policy.');
});

test('Developer API semantic decoder rejects unknown requested capabilities without closing structural evolution', () => {
	const value = {
		contractVersion: 1,
		runtimeApi: { min: 1, max: 1 },
		requestedCapabilities: ['future.capability'],
	};
	const validator = developerEntrypoints.get('developer-api-access-request');
	assert.ok(validator(value), `Structural schema unexpectedly rejected an additive capability identifier: ${ajv.errorsText(validator.errors)}`);
	const decoded = decoderModule.decodeContractFixtureV1('developer-api-access-request', value);
	assert.equal(decoded.ok, false, 'Semantic decoder accepted an unknown requested capability.');
});
