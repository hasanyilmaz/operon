import assert from 'node:assert/strict';
import test from 'node:test';
import type { CapabilityIdV1 } from '../../../src/agent-runtime/contracts/v1/capabilities';
import {
	approveDeveloperApiCapabilities,
	createEmptyDeveloperApiGrantPackage,
	evaluateDeveloperApiGrant,
	normalizeDeveloperApiGrantPackage,
	recordDeveloperApiGrantRequest,
	reconcileDeveloperApiConsumerVersion,
	revokeDeveloperApiGrant,
	suspendDeveloperApiGrantForAuditRecovery,
	type DeveloperApiConsumerDescriptorV1,
} from '../../../src/agent-runtime/developer-api/grants';
import { DeveloperApiGrantControllerV1 } from '../../../src/agent-runtime/developer-api/grant-controller';
import {
	buildOperonDataPackageFromSettings,
	mergeOperonDataPackage,
} from '../../../src/storage/operon-data-package';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

const NOW = '2026-07-29T12:00:00.000Z';
const LATER = '2026-07-29T12:01:00.000Z';
const consumer = (
	version = '1.2.3',
): DeveloperApiConsumerDescriptorV1 => ({
	id: 'consumer.test',
	name: 'Consumer Test',
	version,
	instanceEpoch: 'instance-1',
});

test('records pending exact capabilities without granting partial access', () => {
	const pending = recordDeveloperApiGrantRequest(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read', 'tasks.query'],
		NOW,
	);
	assert.deepEqual(pending.consumersById['consumer.test']?.pendingCapabilities, [
		'tasks.query',
		'tasks.read',
	]);
	const evaluation = evaluateDeveloperApiGrant(
		pending,
		consumer(),
		['tasks.read'],
	);
	assert.equal(evaluation.state, 'pending');
	assert.deepEqual(evaluation.effectiveCapabilities, []);
});

test('approves exact scope, preserves it for patch/minor updates, and queues new capabilities', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	assert.equal(evaluateDeveloperApiGrant(approved, consumer('1.9.0'), ['tasks.read']).state, 'active');
	assert.deepEqual(
		evaluateDeveloperApiGrant(approved, consumer('1.9.0'), ['tasks.read']).effectiveCapabilities,
		['tasks.read'],
	);
	const expanded = evaluateDeveloperApiGrant(
		approved,
		consumer('1.9.0'),
		['tasks.read', 'tasks.query'],
	);
	assert.equal(expanded.state, 'pending');
	assert.deepEqual(expanded.pendingCapabilities, ['tasks.query']);
	assert.deepEqual(expanded.effectiveCapabilities, []);
});

test('suspends invalid, major-changed, and regressed consumer versions', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3'),
		['tasks.read'],
		NOW,
	);
	assert.equal(
		evaluateDeveloperApiGrant(approved, consumer('2.0.0'), ['tasks.read']).reason,
		'consumer-major-version-changed',
	);
	assert.equal(
		evaluateDeveloperApiGrant(approved, consumer('1.2.2'), ['tasks.read']).reason,
		'consumer-version-regressed',
	);
	assert.equal(
		evaluateDeveloperApiGrant(approved, consumer('not-semver'), ['tasks.read']).reason,
		'consumer-version-invalid',
	);
});

test('persists monotonic patch/minor observations and durable exact-scope suspension', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3'),
		['tasks.read', 'tasks.query'],
		NOW,
	);
	const accepted = reconcileDeveloperApiConsumerVersion(
		approved,
		consumer('1.4.0'),
		['tasks.read'],
		LATER,
	);
	assert.equal(accepted.transition, 'accepted');
	assert.equal(accepted.grantPackage.consumersById['consumer.test']?.consumerVersion, '1.4.0');
	assert.equal(accepted.grantPackage.consumersById['consumer.test']?.revision, 2);

	const major = reconcileDeveloperApiConsumerVersion(
		accepted.grantPackage,
		consumer('2.0.0'),
		['tasks.read'],
		LATER,
	);
	const suspended = major.grantPackage.consumersById['consumer.test'];
	assert.equal(major.transition, 'suspended');
	assert.equal(suspended?.state, 'suspended');
	assert.equal(suspended?.observedConsumerVersion, '2.0.0');
	assert.equal(suspended?.suspensionReason, 'consumer-major-version-changed');
	assert.deepEqual(suspended?.pendingCapabilities, ['tasks.read']);
	assert.deepEqual(
		evaluateDeveloperApiGrant(major.grantPackage, consumer('2.0.0'), ['tasks.read']).effectiveCapabilities,
		[],
	);
});

test('durably suspends invalid and regressed observations without replacing the accepted version', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3'),
		['tasks.read'],
		NOW,
	);
	for (const [version, reason] of [
		['invalid', 'consumer-version-invalid'],
		['1.2.2', 'consumer-version-regressed'],
	] as const) {
		const result = reconcileDeveloperApiConsumerVersion(
			approved,
			consumer(version),
			['tasks.read'],
			LATER,
		);
		const record = result.grantPackage.consumersById['consumer.test'];
		assert.equal(record?.state, 'suspended');
		assert.equal(record?.consumerVersion, '1.2.3');
		assert.equal(record?.observedConsumerVersion, version);
		assert.equal(record?.suspensionReason, reason);
		assert.deepEqual(record?.pendingCapabilities, ['tasks.read']);
	}
});

test('revocation advances revision and cannot be reopened by a pending request', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const revoked = revokeDeveloperApiGrant(approved, consumer().id, LATER);
	assert.equal(revoked.consumersById['consumer.test']?.revision, 2);
	assert.equal(evaluateDeveloperApiGrant(revoked, consumer(), ['tasks.read']).state, 'revoked');
	assert.deepEqual(
		recordDeveloperApiGrantRequest(
			revoked,
			consumer(),
			['tasks.query'],
			LATER,
		),
		revoked,
	);
});

test('incomplete audit activation suspends the exact persisted revision across restart', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const revision = approved.consumersById['consumer.test']?.revision ?? -1;
	const suspended = suspendDeveloperApiGrantForAuditRecovery(
		approved,
		'consumer.test',
		revision,
		LATER,
	);
	assert.equal(suspended.consumersById['consumer.test']?.state, 'suspended');
	assert.equal(
		suspended.consumersById['consumer.test']?.suspensionReason,
		'audit-activation-incomplete',
	);
	assert.equal(suspended.consumersById['consumer.test']?.revision, revision + 1);
	assert.deepEqual(
		evaluateDeveloperApiGrant(suspended, consumer(), ['tasks.read']).effectiveCapabilities,
		[],
	);
	assert.deepEqual(
		suspendDeveloperApiGrantForAuditRecovery(
			suspended,
			'consumer.test',
			revision,
			LATER,
		),
		suspended,
	);
});

test('normalization rejects forged records and unknown capabilities', () => {
	const normalized = normalizeDeveloperApiGrantPackage({
		version: 99,
		consumersById: {
			'consumer.test': {
				consumerId: 'different.consumer',
				consumerName: 'Forged',
				consumerVersion: '1.0.0',
				approvedMajorVersion: 1,
				state: 'active',
				revision: 1,
				grantedCapabilities: ['tasks.read'],
				pendingCapabilities: [],
				createdAt: NOW,
				updatedAt: NOW,
			},
			'consumer.valid': {
				consumerId: 'consumer.valid',
				consumerName: 'Valid',
				consumerVersion: '1.0.0',
				approvedMajorVersion: 1,
				state: 'active',
				revision: 1,
				grantedCapabilities: ['tasks.read', 'forged.capability'] as CapabilityIdV1[],
				pendingCapabilities: [],
				createdAt: NOW,
				updatedAt: NOW,
			},
		},
	});
	assert.equal(normalized.consumersById['consumer.test'], undefined);
	assert.deepEqual(normalized.consumersById['consumer.valid']?.grantedCapabilities, ['tasks.read']);
});

test('canonical data package creates and preserves the Developer API integration grant slice', () => {
	const fallback = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	assert.deepEqual(fallback.integrations.developerApi, {
		version: 1,
		consumersById: {},
	});
	const granted = approveDeveloperApiCapabilities(
		fallback.integrations.developerApi,
		consumer(),
		['tasks.read'],
		NOW,
	);
	const merged = mergeOperonDataPackage({
		...fallback,
		integrations: {
			...fallback.integrations,
			developerApi: granted,
		},
	}, fallback);
	assert.equal(
		merged.integrations.developerApi.consumersById['consumer.test']?.state,
		'active',
	);
});

test('grant controller verifies object identity and activates grants only after durable persistence', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let releasePersist: (() => void) | undefined;
	const persistGate = new Promise<void>(resolve => {
		releasePersist = resolve;
	});
	const plugin = {
		manifest: { id: 'consumer.test', name: 'Consumer Test', version: '1.2.3' },
	};
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				await persistGate;
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: candidate => candidate === plugin ? consumer() : null,
			isCurrent: candidate => candidate.instanceEpoch === 'instance-1',
		},
		now: () => new Date(NOW),
	});
	assert.equal(controller.verifyConsumer(plugin)?.id, 'consumer.test');
	assert.equal(controller.verifyConsumer({ manifest: { ...plugin.manifest } }), null);
	const approval = controller.approve(consumer(), ['tasks.read']);
	assert.equal(controller.hasPersistenceError(), true);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'suspended');
	releasePersist?.();
	await approval;
	assert.equal(controller.hasPersistenceError(), false);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'active');
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.state,
		'active',
	);
});

test('grant controller audits and persists version acceptance and suspension before readmission', async () => {
	const initialGrants = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3'),
		['tasks.read'],
		NOW,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: initialGrants,
	});
	const auditEvents: Array<{ phase: string; action: string }> = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer('1.2.3'),
			isCurrent: () => true,
		},
		audit: {
			record: async event => {
				auditEvents.push({ phase: event.phase, action: event.action });
			},
		},
		now: () => new Date(LATER),
	});

	const patchConsumer = consumer('1.4.0');
	assert.equal(controller.observeConsumerVersion(patchConsumer, []), false);
	await controller.drain();
	assert.equal(controller.evaluate(patchConsumer, ['tasks.read']).state, 'active');
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.consumerVersion,
		'1.4.0',
	);
	assert.deepEqual(auditEvents.slice(0, 2), [
		{ phase: 'intent', action: 'version-accepted' },
		{ phase: 'activated', action: 'version-accepted' },
	]);

	const majorConsumer = consumer('2.0.0');
	assert.equal(controller.evaluate(majorConsumer, ['tasks.read']).state, 'suspended');
	await controller.drain();
	const suspended = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(suspended?.state, 'suspended');
	assert.equal(suspended?.observedConsumerVersion, '2.0.0');
	assert.deepEqual(suspended?.pendingCapabilities, ['tasks.read']);
	assert.deepEqual(auditEvents.slice(2), [
		{ phase: 'intent', action: 'version-suspended' },
		{ phase: 'activated', action: 'version-suspended' },
	]);
});
