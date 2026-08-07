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

async function waitForGrantWriteStart(started: Promise<void>, label: string): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			started,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(() => {
					reject(new Error(`Timed out waiting for ${label}`));
				}, 2_000);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

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

test('dedupes semantically unchanged pending requests while persisting canonical supersets', () => {
	const initial = recordDeveloperApiGrantRequest(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read', 'tasks.query'],
		NOW,
	);
	const repeated = recordDeveloperApiGrantRequest(
		initial,
		consumer(),
		['tasks.query', 'tasks.read'],
		LATER,
	);
	const subset = recordDeveloperApiGrantRequest(
		repeated,
		consumer(),
		['tasks.read'],
		LATER,
	);
	assert.deepEqual(repeated, initial);
	assert.deepEqual(subset, initial);
	assert.equal(
		subset.consumersById['consumer.test']?.updatedAt,
		NOW,
	);

	const expanded = recordDeveloperApiGrantRequest(
		subset,
		consumer(),
		['tasks.finder', 'tasks.read'],
		LATER,
	);
	assert.deepEqual(
		expanded.consumersById['consumer.test']?.pendingCapabilities,
		['tasks.finder', 'tasks.query', 'tasks.read'],
	);
	assert.equal(
		expanded.consumersById['consumer.test']?.updatedAt,
		LATER,
	);
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
		version: 1,
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

test('normalization fails closed for explicit unsupported or corrupt package versions', () => {
	for (const version of [2, 2.5, '2', null]) {
		assert.deepEqual(
			normalizeDeveloperApiGrantPackage({
				version,
				consumersById: {
					'consumer.valid': {
						consumerId: 'consumer.valid',
						consumerName: 'Valid',
						consumerVersion: '1.0.0',
						approvedMajorVersion: 1,
						state: 'active',
						revision: 1,
						grantedCapabilities: ['tasks.read'],
						pendingCapabilities: [],
						createdAt: NOW,
						updatedAt: NOW,
					},
				},
			}),
			createEmptyDeveloperApiGrantPackage(),
		);
	}
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
	const blocked = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(blocked.state, 'suspended');
	assert.equal(blocked.reason, 'grant-persistence-unavailable');
	assert.deepEqual(blocked.effectiveCapabilities, []);
	releasePersist?.();
	await approval;
	assert.equal(controller.hasPersistenceError(), false);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'active');
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.state,
		'active',
	);
});

test('grant controller keeps a queued first request pending until its durable record is written', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let releasePersist: (() => void) | undefined;
	const persistGate = new Promise<void>(resolve => {
		releasePersist = resolve;
	});
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				await persistGate;
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		now: () => new Date(NOW),
	});

	const initial = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(initial.state, 'pending');
	assert.equal(initial.reason, 'capability-approval-required');
	assert.deepEqual(initial.effectiveCapabilities, []);

	controller.recordPending(consumer(), ['tasks.read']);
	assert.equal(controller.hasPersistenceError(), true);
	const queued = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(queued.state, 'pending');
	assert.equal(queued.reason, 'capability-approval-required');
	assert.deepEqual(queued.pendingCapabilities, ['tasks.read']);
	assert.deepEqual(queued.effectiveCapabilities, []);

	releasePersist?.();
	await controller.drain();
	assert.equal(controller.hasPersistenceError(), false);
	const durable = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(durable?.state, 'active');
	assert.deepEqual(durable?.grantedCapabilities, []);
	assert.deepEqual(durable?.pendingCapabilities, ['tasks.read']);
	const settled = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(settled.state, 'pending');
	assert.deepEqual(settled.effectiveCapabilities, []);
});

test('grant controller dedupes repeated pending requests across queued and durable state', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let now = NOW;
	let updateCalls = 0;
	let releasePersist: (() => void) | undefined;
	let markPersistStarted: (() => void) | undefined;
	const persistStarted = new Promise<void>(resolve => {
		markPersistStarted = resolve;
	});
	const persistGate = new Promise<void>(resolve => {
		releasePersist = resolve;
	});
	const auditEvents: string[] = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				updateCalls += 1;
				markPersistStarted?.();
				await persistGate;
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'deduped-pending-transition',
			record: async event => {
				auditEvents.push(event.phase);
			},
		},
		now: () => new Date(now),
	});

	controller.recordPending(consumer(), ['tasks.read']);
	now = LATER;
	controller.recordPending(consumer(), ['tasks.read']);
	try {
		await waitForGrantWriteStart(persistStarted, 'deduped pending grant persistence');
		assert.equal(updateCalls, 1);
	} finally {
		releasePersist?.();
	}
	await controller.drain();

	controller.recordPending(consumer(), ['tasks.read']);
	await controller.drain();
	assert.equal(updateCalls, 1);
	assert.deepEqual(auditEvents, ['intent', 'activated']);
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.updatedAt,
		NOW,
	);
});

test('grant controller keeps a first request suspended when the store cannot persist', async () => {
	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let updateCalls = 0;
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			canPersist: () => false,
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async () => {
				updateCalls += 1;
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		now: () => new Date(NOW),
	});

	const unavailable = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(unavailable.state, 'suspended');
	assert.equal(unavailable.reason, 'grant-persistence-unavailable');
	assert.deepEqual(unavailable.effectiveCapabilities, []);
	controller.recordPending(consumer(), ['tasks.read']);
	await controller.drain();
	assert.equal(updateCalls, 0);
	assert.deepEqual(dataPackage.integrations.developerApi.consumersById, {});
});

test('grant controller restores durable state after a failed write and permits an exact retry', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: recordDeveloperApiGrantRequest(
			createEmptyDeveloperApiGrantPackage(),
			consumer(),
			['tasks.read'],
			NOW,
		),
	});
	let failNextWrite = true;
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				if (failNextWrite) {
					failNextWrite = false;
					throw new Error('injected grant persistence failure');
				}
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		now: () => new Date(LATER),
	});

	await assert.rejects(
		controller.approvePending('consumer.test', ['tasks.read']),
		/injected grant persistence failure/u,
	);
	assert.equal(controller.list()[0]?.revision, 0);
	assert.deepEqual(controller.list()[0]?.pendingCapabilities, ['tasks.read']);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'pending');

	const retried = await controller.approvePending('consumer.test', ['tasks.read']);
	assert.equal(retried.state, 'active');
	assert.equal(controller.hasPersistenceError(), false);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'active');
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.state,
		'active',
	);
});

test('grant controller closes a failed first pending intent and requeues it in the same session', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let failNextWrite = true;
	const auditEvents: Array<{ phase: string; correlationId: string }> = [];
	let correlationSequence = 0;
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				if (failNextWrite) {
					failNextWrite = false;
					throw new Error('injected initial pending persistence failure');
				}
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => `pending-transition-${++correlationSequence}`,
			record: async event => {
				auditEvents.push({ phase: event.phase, correlationId: event.correlationId });
			},
		},
		now: () => new Date(LATER),
	});

	controller.recordPending(consumer(), ['tasks.read']);
	await assert.rejects(controller.drain(), /injected initial pending persistence failure/u);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'pending');
	assert.equal(controller.hasPersistenceError(), false);

	controller.recordPending(consumer(), ['tasks.read']);
	await controller.drain();
	assert.deepEqual(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.pendingCapabilities,
		['tasks.read'],
	);
	assert.deepEqual(auditEvents, [
		{ phase: 'intent', correlationId: 'pending-transition-1' },
		{ phase: 'failed', correlationId: 'pending-transition-1' },
		{ phase: 'intent', correlationId: 'pending-transition-2' },
		{ phase: 'activated', correlationId: 'pending-transition-2' },
	]);
});

test('grant controller retries after an audit intent fails before persistence', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	let updateCalls = 0;
	let failIntent = true;
	let correlationSequence = 0;
	const auditEvents: Array<{ phase: string; correlationId: string }> = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				updateCalls += 1;
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => `intent-failure-${++correlationSequence}`,
			record: async event => {
				if (event.phase === 'intent' && failIntent) {
					failIntent = false;
					throw new Error('injected grant audit intent failure');
				}
				auditEvents.push({ phase: event.phase, correlationId: event.correlationId });
			},
		},
		now: () => new Date(NOW),
	});

	controller.recordPending(consumer(), ['tasks.read']);
	await assert.rejects(controller.drain(), /injected grant audit intent failure/u);
	assert.equal(updateCalls, 0);
	assert.deepEqual(dataPackage.integrations.developerApi.consumersById, {});
	assert.equal(controller.hasPersistenceError(), true);
	const recovered = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(recovered.state, 'pending');
	assert.equal(recovered.reason, 'capability-approval-required');
	assert.deepEqual(recovered.effectiveCapabilities, []);
	assert.equal(controller.hasPersistenceError(), false);

	controller.recordPending(consumer(), ['tasks.read']);
	await controller.drain();
	assert.equal(updateCalls, 1);
	assert.deepEqual(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.pendingCapabilities,
		['tasks.read'],
	);
	assert.deepEqual(auditEvents, [
		{ phase: 'intent', correlationId: 'intent-failure-2' },
		{ phase: 'activated', correlationId: 'intent-failure-2' },
	]);
});

test('grant controller keeps an activated-audit failure sticky and fenced across restart', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	const auditEvents: Array<{ phase: string; correlationId: string; revision: number }> = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'activated-audit-failure',
			record: async event => {
				auditEvents.push({
					phase: event.phase,
					correlationId: event.correlationId,
					revision: event.revision,
				});
				if (event.phase === 'activated') {
					throw new Error('injected grant activated audit failure');
				}
			},
		},
		now: () => new Date(NOW),
	});

	controller.recordPending(consumer(), ['tasks.read']);
	await assert.rejects(controller.drain(), /injected grant activated audit failure/u);
	const durable = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(durable?.revision, 0);
	assert.deepEqual(durable?.grantedCapabilities, []);
	assert.deepEqual(durable?.pendingCapabilities, ['tasks.read']);
	assert.deepEqual(auditEvents.map(event => event.phase), ['intent', 'activated']);
	const unmatchedIntent = auditEvents.find(event => event.phase === 'intent');
	assert.ok(unmatchedIntent);
	assert.equal(unmatchedIntent.revision, durable?.revision);
	assert.equal(controller.hasPersistenceError(), true);
	const sticky = controller.evaluate(consumer(), ['tasks.read']);
	assert.equal(sticky.state, 'suspended');
	assert.equal(sticky.reason, 'grant-persistence-unavailable');
	assert.deepEqual(sticky.effectiveCapabilities, []);

	const restarted = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		startupAuditRecoveryTransitions: [{
			consumerId: 'consumer.test',
			revision: unmatchedIntent.revision,
		}],
		now: () => new Date(LATER),
	});
	const fenced = restarted.evaluate(consumer(), ['tasks.read']);
	assert.equal(fenced.state, 'suspended');
	assert.equal(fenced.reason, 'audit-activation-incomplete');
	assert.deepEqual(fenced.effectiveCapabilities, []);
});

test('grant controller remains fail-closed when persistence and its failed audit marker both fail', async () => {
	const activeGrants = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: activeGrants,
	});
	const auditEvents: Array<{ phase: string; correlationId: string; revision: number }> = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async () => {
				throw new Error('injected pending grant store failure');
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'failed-marker-failure',
			record: async event => {
				auditEvents.push({
					phase: event.phase,
					correlationId: event.correlationId,
					revision: event.revision,
				});
				if (event.phase === 'failed') {
					throw new Error('injected failed marker audit failure');
				}
			},
		},
		now: () => new Date(LATER),
	});

	controller.recordPending(consumer(), ['tasks.query']);
	await assert.rejects(controller.drain(), /injected pending grant store failure/u);
	const durable = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(durable?.revision, 1);
	assert.deepEqual(durable?.grantedCapabilities, ['tasks.read']);
	assert.deepEqual(durable?.pendingCapabilities, []);
	assert.deepEqual(auditEvents.map(event => event.phase), ['intent', 'failed']);
	const unmatchedIntent = auditEvents.find(event => event.phase === 'intent');
	assert.ok(unmatchedIntent);
	assert.equal(unmatchedIntent.revision, durable?.revision);
	assert.equal(controller.hasPersistenceError(), true);
	const sticky = controller.evaluate(consumer(), ['tasks.read', 'tasks.query']);
	assert.equal(sticky.state, 'suspended');
	assert.equal(sticky.reason, 'grant-persistence-unavailable');
	assert.deepEqual(sticky.effectiveCapabilities, []);

	const restarted = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		startupAuditRecoveryTransitions: [{
			consumerId: 'consumer.test',
			revision: unmatchedIntent.revision,
		}],
		now: () => new Date(LATER),
	});
	const fenced = restarted.evaluate(consumer(), ['tasks.read']);
	assert.equal(fenced.state, 'suspended');
	assert.equal(fenced.reason, 'audit-activation-incomplete');
	assert.deepEqual(fenced.effectiveCapabilities, []);
});

test('grant controller preserves an unpersisted startup audit suspension after storage recovers', () => {
	const initialGrants = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3'),
		['tasks.read'],
		NOW,
	);
	const dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: initialGrants,
	});
	const revision = initialGrants.consumersById['consumer.test']?.revision ?? -1;
	let canPersist = false;
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			canPersist: () => canPersist,
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async () => {
				throw new Error('startup audit suspension was not persisted');
			},
		},
		verifier: {
			verify: () => consumer('1.2.3'),
			isCurrent: () => true,
		},
		startupAuditRecoveryTransitions: [{ consumerId: 'consumer.test', revision }],
		now: () => new Date(LATER),
	});

	const unavailable = controller.evaluate(consumer('1.2.3'), ['tasks.read']);
	assert.equal(unavailable.state, 'suspended');
	assert.equal(unavailable.reason, 'grant-persistence-unavailable');
	canPersist = true;
	const recovered = controller.evaluate(consumer('1.2.3'), ['tasks.read']);
	assert.equal(recovered.state, 'suspended');
	assert.equal(recovered.reason, 'audit-activation-incomplete');
	assert.deepEqual(recovered.effectiveCapabilities, []);
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
	const auditEvents: Array<{ phase: string; action: string; correlationId: string }> = [];
	let correlationSequence = 0;
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
			createCorrelationId: () => `grant-audit-transition-${++correlationSequence}`,
			record: async event => {
				auditEvents.push({
					phase: event.phase,
					action: event.action,
					correlationId: event.correlationId,
				});
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
		{ phase: 'intent', action: 'version-accepted', correlationId: 'grant-audit-transition-1' },
		{ phase: 'activated', action: 'version-accepted', correlationId: 'grant-audit-transition-1' },
	]);

	const majorConsumer = consumer('2.0.0');
	assert.equal(controller.evaluate(majorConsumer, ['tasks.read']).state, 'suspended');
	await controller.drain();
	const suspended = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(suspended?.state, 'suspended');
	assert.equal(suspended?.observedConsumerVersion, '2.0.0');
	assert.deepEqual(suspended?.pendingCapabilities, ['tasks.read']);
	assert.deepEqual(auditEvents.slice(2), [
		{ phase: 'intent', action: 'version-suspended', correlationId: 'grant-audit-transition-2' },
		{ phase: 'activated', action: 'version-suspended', correlationId: 'grant-audit-transition-2' },
	]);
});
