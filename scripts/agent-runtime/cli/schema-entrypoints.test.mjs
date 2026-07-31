import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schemaRoot = path.join(pluginRoot, 'packages', 'operon-cli', 'schemas', 'v1');
const manifest = JSON.parse(await readFile(
	path.join(pluginRoot, 'packages', 'operon-cli', 'cli-manifest-v1.json'),
	'utf8',
));
const ajv = new Ajv2020({
	strict: true,
	strictRequired: false,
	strictTypes: false,
	allowUnionTypes: true,
});
for (const keyword of [
	'x-operon-acknowledgementBindings',
	'x-operon-catalogResultSafety',
	'x-operon-cliInvocationBinding',
	'x-operon-cliResultBinding',
	'x-operon-contiguousOrder',
	'x-operon-createGraphSafety',
	'x-operon-fieldCatalogSafety',
	'x-operon-frozenCapabilityRegistry',
	'x-operon-knownValues',
	'x-operon-maxUtf8Bytes',
	'x-operon-receiptTimeline',
	'x-operon-resultState',
	'x-operon-sealedPlanSafety',
	'x-operon-sessionOrder',
	'x-operon-sessionReadCommand',
	'x-operon-truncationState',
	'x-operon-uniqueBy',
	'x-operon-updateBatchSafety',
]) ajv.addKeyword({ keyword });
ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/u);
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T/u);
ajv.addFormat('operon-audit-date-time', /^\d{4}-\d{2}-\d{2}T/u);
ajv.addFormat('operon-local-date-time', /^\d{4}-\d{2}-\d{2}T/u);
const schemaFiles = await readdir(schemaRoot);
for (const file of schemaFiles) {
	if (!file.endsWith('.json')) continue;
	const document = JSON.parse(await readFile(path.join(schemaRoot, file), 'utf8'));
	if (typeof document.$id === 'string') ajv.addSchema(document);
}

const validators = new Map(manifest.schemaEntrypoints.map(entrypoint => [
	entrypoint.schemaId,
	ajv.compile({ $ref: entrypoint.ref }),
]));

test('every published schema entrypoint resolves and rejects a null document', () => {
	for (const [schemaId, validate] of validators) {
		assert.equal(validate(null), false, `${schemaId} unexpectedly accepted null.`);
	}
});

test('removed Capture contracts are absent from the packaged schema surface', () => {
	assert.equal(schemaFiles.includes('capture-agent.schema.json'), false);
	assert.equal(schemaFiles.includes('capture-agent-adapters.schema.json'), false);
	for (const schemaId of [
		'capture-agent-adapters-result',
		'capture-agent-admin-result',
		'capture-agent-client-frame',
		'capture-agent-client-hello',
		'capture-agent-doctor-result',
		'capture-agent-failure',
		'capture-agent-provider-config',
		'capture-agent-request',
		'capture-agent-result',
		'capture-agent-server-frame',
		'capture-agent-server-hello',
		'capture-agent-task-draft',
		'capture-command-result',
	]) {
		assert.equal(validators.has(schemaId), false, `Removed entrypoint remains: ${schemaId}.`);
	}
	assert.equal('captureAgent' in manifest.protocols, false);
});

const local = JSON.parse(await readFile(
	path.join(schemaRoot, 'operon-cli-local.schema.json'),
	'utf8',
));
const cliManifest = JSON.parse(await readFile(
	path.join(pluginRoot, 'packages', 'operon-cli', 'cli-manifest-v1.json'),
	'utf8',
));
const contractFixtures = JSON.parse(await readFile(
	path.join(pluginRoot, 'scripts', 'agent-runtime', 'contracts', 'fixtures', 'cases.json'),
	'utf8',
));
const sealedPlan = contractFixtures.cases.find(
	item => item.id === 'valid-destructive-delete-apply',
)?.value?.plan;
assert.ok(sealedPlan);
const profile = {
	name: 'default',
	canonicalPath: '/vault',
	vaultSha256: 'a'.repeat(64),
	verifiedAt: '2026-07-29T10:00:00.000Z',
};
const config = { version: 1, defaultProfile: 'default', profiles: [profile] };
const plugin = { id: 'operon', version: '2.6.0', minAppVersion: '1.12.2' };
const success = (command, result) => ({
	contractVersion: 1,
	kind: 'operon-cli-local-result',
	command,
	ok: true,
	result,
});
const failure = command => ({
	contractVersion: 1,
	kind: 'operon-cli-local-result',
	command,
	ok: false,
	error: {
		contractVersion: 1,
		code: 'invalid-request',
		reason: 'Invalid request.',
		retryable: false,
		action: 'fix-request',
	},
});

const localCases = {
	'version-result': success('version', {
		name: 'operon-cli',
		version: '0.1.0-beta.23',
		node: 'v26.0.0',
		platform: 'darwin',
	}),
	'manifest-result': success('manifest', cliManifest),
	'schema-list-result': success('schema.list', {
		files: ['cli-manifest.schema.json'],
		entrypoints: [{ schemaId: 'manifest-result', ref: 'urn:example' }],
	}),
	'schema-get-result': success('schema.get', local),
	'setup-result': success('setup', { profile, plugin }),
	'doctor-result': success('doctor', {
		platform: { name: 'darwin', liveTransport: 'supported' },
		security: { backend: 'posix-mode', secure: true, repaired: false },
		vault: { canonicalPath: '/vault', sha256: 'a'.repeat(64) },
		plugin,
	}),
	'profile-list-result': success('profile.list', config),
	'profile-default-result': success('profile.default', config),
	'profile-remove-result': success('profile.remove', config),
	'plan-show-envelope': success('plan.show', {
		planRef: `p${'a'.repeat(31)}`,
		createdAt: sealedPlan.createdAt,
		expiresAt: sealedPlan.expiresAt,
		plan: {
			planId: sealedPlan.planId,
			confirmationToken: 'b'.repeat(64),
			capability: sealedPlan.capability,
			mutationKind: sealedPlan.mutationKind,
			createdAt: sealedPlan.createdAt,
			expiresAt: sealedPlan.expiresAt,
			targets: sealedPlan.targets,
			atomicGroups: sealedPlan.atomicGroups,
			predictedEffects: sealedPlan.predictedEffects,
			riskLevel: sealedPlan.riskLevel,
			requiresConfirmation: sealedPlan.requiresConfirmation,
			requiredAcknowledgements: sealedPlan.requiredAcknowledgements,
			warnings: sealedPlan.warnings,
			spec: sealedPlan.spec,
		},
	}),
	'plan-apply-local-result': failure('plan.apply'),
	'plan-recover-local-result': success('plan.recover', { cancelled: true }),
	'plan-discard-result': success('plan.discard', {
		planRef: `p${'a'.repeat(31)}`,
		discarded: true,
	}),
};

test('every machine-readable local command family has a valid closed result fixture', () => {
	for (const [schemaId, value] of Object.entries(localCases)) {
		const validate = validators.get(schemaId);
		assert.ok(validate, `Missing local entrypoint ${schemaId}.`);
		assert.equal(validate(value), true, `${schemaId}: ${JSON.stringify(validate.errors)}`);
	}
});

test('local recovery envelopes are failure-only and bind the outcome-unknown policy', () => {
	const validate = validators.get('operon-cli-local-result');
	assert.ok(validate);
	const recovery = {
		required: true,
		planRef: `p${'a'.repeat(31)}`,
		action: 'recover-same-plan',
		mutationMayHaveApplied: true,
	};
	assert.equal(validate({
		...success('plan.apply', { applied: true }),
		recovery,
	}), false, 'Successful local results must not advertise recovery.');
	assert.equal(validate({
		contractVersion: 1,
		kind: 'operon-cli-local-result',
		command: 'plan.apply',
		ok: false,
		error: {
			contractVersion: 1,
			code: 'invalid-request',
			reason: 'Invalid request.',
			retryable: false,
			action: 'fix-request',
		},
		recovery,
	}), false, 'Recovery must use the outcome-unknown error policy.');
});

const sessionCases = {
	'session-frame': { id: 'one', argv: ['version'] },
	'session-read-group': {
		id: 'group',
		reads: [
			{ id: 'one', argv: ['health'] },
			{ id: 'two', argv: ['task', 'get', '--id', 'abc1234'] },
		],
	},
	'session-result': { id: 'one', exitCode: 0, result: { ok: true } },
	'session-failure': {
		id: 'one',
		exitCode: 2,
		error: {
			contractVersion: 1,
			code: 'invalid-request',
			reason: 'Invalid request.',
			retryable: false,
			action: 'fix-request',
		},
	},
	'session-uncertain-result': {
		id: 'one',
		exitCode: 5,
		error: {
			contractVersion: 1,
			code: 'outcome-unknown',
			reason: 'Outcome unknown.',
			retryable: false,
			action: 'recover-same-plan',
		},
		recovery: {
			required: true,
			planRef: `p${'a'.repeat(31)}`,
			action: 'recover-same-plan',
			mutationMayHaveApplied: true,
		},
	},
	'session-protocol': {
		version: 1,
		invocation: 'operon session --jsonl',
		transport: 'jsonl-stdio',
		requestSchema: 'session-frame',
		readGroupSchema: 'session-read-group',
		resultSchema: 'session-result',
		failureSchema: 'session-failure',
		uncertainResultSchema: 'session-uncertain-result',
		readGroupMin: 2,
		readGroupMax: 8,
		readGroupCommands: ['health', 'task.get', 'tasks.query', 'context.build'],
		ordinaryFrames: 'sequential',
		readGroups: 'concurrent-ordered',
		abortExitCode: 130,
	},
};

test('every JSONL session entrypoint has a valid fixture', () => {
	for (const [schemaId, value] of Object.entries(sessionCases)) {
		const validate = validators.get(schemaId);
		assert.ok(validate, `Missing session entrypoint ${schemaId}.`);
		assert.equal(validate(value), true, `${schemaId}: ${JSON.stringify(validate.errors)}`);
	}
});

test('the complete public error registry has one deterministic exit mapping', () => {
	const exitByClass = {
		usage: cliManifest.exitCodes.usage,
		unavailable: cliManifest.exitCodes.unavailable,
		refused: cliManifest.exitCodes.refused,
		'runtime-failure': cliManifest.exitCodes.runtimeFailure,
		internal: cliManifest.exitCodes.internal,
	};
	assert.equal(new Set(cliManifest.errorRegistry.map(entry => entry.code)).size, 38);
	for (const entry of cliManifest.errorRegistry) {
		assert.equal(
			entry.exitCode,
			exitByClass[entry.exitClass],
			`${entry.code} has an inconsistent exit class.`,
		);
		if (entry.code === 'outcome-unknown') {
			assert.equal(entry.exitCode, 5);
			assert.equal(entry.retryable, false);
			assert.equal(entry.action, 'recover-same-plan');
			assert.equal(entry.recovery, 'same-plan');
		}
		if (entry.code === 'unsupported-platform') {
			assert.equal(entry.exitCode, cliManifest.exitCodes.refused);
			assert.equal(entry.retryable, false);
			assert.equal(entry.action, 'fix-environment');
			assert.equal(entry.recovery, 'none');
		}
		if (entry.code === 'receipt-store-unavailable') {
			assert.equal(entry.exitCode, 5);
			assert.equal(entry.retryable, true);
			assert.equal(entry.action, 'wait-and-retry');
			assert.equal(entry.recovery, 'none');
		}
	}
	assert.equal(cliManifest.exitCodes.interrupted, 130);
	assert.equal(cliManifest.contractPolicy.unknownError, 'stop-and-inspect');
});
