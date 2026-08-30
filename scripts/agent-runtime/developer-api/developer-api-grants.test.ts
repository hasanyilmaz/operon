import assert from 'node:assert/strict';
import test from 'node:test';
import {
	approveDeveloperApiCapabilities,
	createEmptyDeveloperApiGrantPackage,
	evaluateDeveloperApiGrant,
	getDeveloperApiGrantApprovalCapabilities,
	isDeveloperApiGrantApprovalRecordCoherent,
	normalizeDeveloperApiGrantPackage,
	recordDeveloperApiGrantRequest,
	reconcileDeveloperApiConsumerVersion,
	revokeDeveloperApiGrant,
	suspendDeveloperApiGrantForAuditRecovery,
	type DeveloperApiConsumerDescriptorV1,
	type DeveloperApiGrantCapabilityV1,
} from '../../../src/agent-runtime/developer-api/grants';
import {
	DeveloperApiGrantControllerV1,
	type DeveloperApiGrantApprovalRequestV1,
} from '../../../src/agent-runtime/developer-api/grant-controller';
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

function approvalRequest(
	record: NonNullable<ReturnType<DeveloperApiGrantControllerV1['list']>[number]>,
	capabilities: readonly DeveloperApiGrantCapabilityV1[],
	liveConsumer: DeveloperApiConsumerDescriptorV1 = consumer(),
): DeveloperApiGrantApprovalRequestV1 {
	return {
		consumerId: record.consumerId,
		expectedRevision: record.revision,
		expectedConsumerName: record.consumerName,
		expectedConsumerVersion: record.consumerVersion,
		...(record.observedConsumerVersion
			? { expectedObservedConsumerVersion: record.observedConsumerVersion }
			: {}),
		expectedApprovedMajorVersion: record.approvedMajorVersion,
		expectedInstanceEpoch: liveConsumer.instanceEpoch,
		capabilities,
		consumer: liveConsumer,
	};
}

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

test('persists a SemVer-equal build metadata observation without changing grant scope', () => {
	const approved = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3+one'),
		['tasks.read'],
		NOW,
	);
	const accepted = reconcileDeveloperApiConsumerVersion(
		approved,
		consumer('1.2.3+two'),
		['tasks.read', 'tasks.query'],
		LATER,
	);
	const acceptedRecord = accepted.grantPackage.consumersById['consumer.test'];
	assert.equal(accepted.transition, 'accepted');
	assert.equal(acceptedRecord?.consumerVersion, '1.2.3+two');
	assert.equal(acceptedRecord?.approvedMajorVersion, 1);
	assert.deepEqual(acceptedRecord?.grantedCapabilities, ['tasks.read']);
	assert.deepEqual(acceptedRecord?.pendingCapabilities, []);

	for (const [version, reason] of [
		['2.0.0+two', 'consumer-major-version-changed'],
		['1.2.3-alpha+two', 'consumer-version-regressed'],
		['1.2.2+two', 'consumer-version-regressed'],
	] as const) {
		const suspended = reconcileDeveloperApiConsumerVersion(
			approved,
			consumer(version),
			['tasks.query'],
			LATER,
		).grantPackage.consumersById['consumer.test'];
		assert.equal(suspended?.state, 'suspended');
		assert.equal(suspended?.suspensionReason, reason);
		assert.equal(suspended?.consumerVersion, '1.2.3+one');
		assert.equal(suspended?.observedConsumerVersion, version);
		assert.deepEqual(suspended?.grantedCapabilities, ['tasks.read']);
		assert.deepEqual(suspended?.pendingCapabilities, ['tasks.query']);
	}
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

test('approval candidates require explicit reapproval for recoverable suspensions and stay closed otherwise', () => {
	const active = recordDeveloperApiGrantRequest(
		approveDeveloperApiCapabilities(
			createEmptyDeveloperApiGrantPackage(),
			consumer(),
			['tasks.read'],
			NOW,
		),
		consumer(),
		['tasks.query'],
		LATER,
	);
	const activeRecord = active.consumersById['consumer.test'];
	assert.ok(activeRecord);
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(activeRecord), ['tasks.query']);

	const suspended = suspendDeveloperApiGrantForAuditRecovery(
		active,
		'consumer.test',
		activeRecord.revision,
		LATER,
	);
	const suspendedRecord = suspended.consumersById['consumer.test'];
	assert.ok(suspendedRecord);
	assert.deepEqual(
		getDeveloperApiGrantApprovalCapabilities(suspendedRecord),
		['tasks.query', 'tasks.read'],
	);

	const invalid = reconcileDeveloperApiConsumerVersion(
		active,
		consumer('not-semver'),
		['tasks.read'],
		LATER,
	).grantPackage.consumersById['consumer.test'];
	assert.ok(invalid);
	assert.equal(invalid.suspensionReason, 'consumer-version-invalid');
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(invalid), []);

	const revoked = revokeDeveloperApiGrant(active, 'consumer.test', LATER)
		.consumersById['consumer.test'];
	assert.ok(revoked);
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(revoked), []);
});

test('incoherent persisted approval records stay visible but cannot become approval sources', () => {
	const coherent = recordDeveloperApiGrantRequest(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	).consumersById['consumer.test'];
	assert.ok(coherent);
	const incoherentRecords = [
		{ ...coherent, approvedMajorVersion: 2 },
		{ ...coherent, state: 'revoked' as const, approvedMajorVersion: 2 },
		{ ...coherent, suspensionReason: 'audit-activation-incomplete' as const },
		{ ...coherent, observedConsumerVersion: '1.2.4' },
		{ ...coherent, state: 'suspended' as const },
		{
			...coherent,
			state: 'suspended' as const,
			suspensionReason: 'audit-activation-incomplete' as const,
			observedConsumerVersion: '1.2.4',
		},
		{
			...coherent,
			state: 'suspended' as const,
			suspensionReason: 'consumer-version-invalid' as const,
			observedConsumerVersion: '1.2.4',
		},
		{
			...coherent,
			state: 'suspended' as const,
			suspensionReason: 'consumer-major-version-changed' as const,
			observedConsumerVersion: '1.2.4',
		},
		{
			...coherent,
			state: 'suspended' as const,
			suspensionReason: 'consumer-version-regressed' as const,
			observedConsumerVersion: '1.2.4',
		},
	];
	for (const record of incoherentRecords) {
		const normalized = normalizeDeveloperApiGrantPackage({
			version: 1,
			consumersById: { 'consumer.test': record },
		}).consumersById['consumer.test'];
		assert.deepEqual(normalized, record, 'normalization must not repair the evidence');
		assert.equal(isDeveloperApiGrantApprovalRecordCoherent(record), false);
		assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(record), []);
	}
});

test('normalization preserves canonical extension grants and rejects forged capabilities', () => {
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
				grantedCapabilities: [
					'tasks.read',
					'tasks.filter-query',
					'tasks.create.identity-placeholders',
					'tasks.adopt.apply',
					'tasks.filter-query',
					'forged.capability',
				] as DeveloperApiGrantCapabilityV1[],
				pendingCapabilities: ['tasks.adopt.preview', 'tasks.filter-query'],
				createdAt: NOW,
				updatedAt: NOW,
			},
		},
	});
	assert.equal(normalized.consumersById['consumer.test'], undefined);
	assert.deepEqual(normalized.consumersById['consumer.valid']?.grantedCapabilities, [
		'tasks.adopt.apply',
		'tasks.create.identity-placeholders',
		'tasks.filter-query',
		'tasks.read',
	]);
	assert.deepEqual(normalized.consumersById['consumer.valid']?.pendingCapabilities, [
		'tasks.adopt.preview',
		'tasks.filter-query',
	]);
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

test('grant controller persists and restores an exact task-workflow extension grant', async () => {
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
	const store = {
		getDataPackage: () => structuredClone(dataPackage),
		updateDataPackage: async (mutator: (value: typeof dataPackage) => typeof dataPackage) => {
			dataPackage = mutator(dataPackage);
		},
	};
	const verifier = {
		verify: () => consumer(),
		isCurrent: () => true,
	};
	const controller = new DeveloperApiGrantControllerV1({ store, verifier, now: () => new Date(NOW) });
	controller.recordPending(consumer(), ['tasks.filter-query']);
	await controller.drain();
	assert.deepEqual(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.pendingCapabilities,
		['tasks.filter-query'],
	);
	await controller.approvePending(approvalRequest(controller.list()[0]!, ['tasks.filter-query']));
	assert.equal(controller.evaluate(consumer(), ['tasks.filter-query']).state, 'active');

	const restarted = new DeveloperApiGrantControllerV1({ store, verifier, now: () => new Date(LATER) });
	const restored = restarted.evaluate(consumer(), ['tasks.filter-query']);
	assert.equal(restored.state, 'active');
	assert.deepEqual(restored.effectiveCapabilities, ['tasks.filter-query']);
	assert.deepEqual(restored.grantedCapabilities, ['tasks.filter-query']);
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
		controller.approvePending(approvalRequest(controller.list()[0]!, ['tasks.read'])),
		/injected grant persistence failure/u,
	);
	assert.equal(controller.list()[0]?.revision, 0);
	assert.deepEqual(controller.list()[0]?.pendingCapabilities, ['tasks.read']);
	assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'pending');

	const retried = await controller.approvePending(approvalRequest(controller.list()[0]!, ['tasks.read']));
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

test('grant controller explicitly reapproves and durably audits the full recoverable suspension scope', async () => {
	const queued = recordDeveloperApiGrantRequest(
		approveDeveloperApiCapabilities(
			createEmptyDeveloperApiGrantPackage(),
			consumer(),
			['tasks.read'],
			NOW,
		),
		consumer(),
		['tasks.query'],
		LATER,
	);
	const queuedRecord = queued.consumersById['consumer.test'];
	assert.ok(queuedRecord);
	const suspendedGrants = suspendDeveloperApiGrantForAuditRecovery(
		queued,
		'consumer.test',
		queuedRecord.revision,
		LATER,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: suspendedGrants,
	});
	const auditEvents: Array<{
		phase: string;
		action: string;
		capabilities: readonly DeveloperApiGrantCapabilityV1[];
	}> = [];
	const store = {
		getDataPackage: () => structuredClone(dataPackage),
		updateDataPackage: async (mutator: (value: typeof dataPackage) => typeof dataPackage) => {
			dataPackage = mutator(dataPackage);
		},
	};
	const verifier = {
		verify: () => consumer(),
		isCurrent: () => true,
	};
	const controller = new DeveloperApiGrantControllerV1({
		store,
		verifier,
		audit: {
			createCorrelationId: () => 'audit-recovery-reapproval',
			record: async event => {
				auditEvents.push({
					phase: event.phase,
					action: event.action,
					capabilities: event.capabilities,
				});
			},
		},
		now: () => new Date(LATER),
	});

	const fenced = controller.evaluate(consumer(), ['tasks.read', 'tasks.query']);
	assert.equal(fenced.state, 'suspended');
	assert.equal(fenced.reason, 'audit-activation-incomplete');
	assert.deepEqual(fenced.effectiveCapabilities, []);
	await assert.rejects(
		controller.approvePending(approvalRequest(controller.list()[0]!, ['tasks.finder'])),
		/No approvable Developer API capabilities selected/u,
	);

	const reapproved = await controller.approvePending(approvalRequest(
		controller.list()[0]!,
		['tasks.read', 'tasks.query'],
	));
	assert.equal(reapproved.state, 'active');
	assert.deepEqual(reapproved.grantedCapabilities, ['tasks.query', 'tasks.read']);
	assert.deepEqual(reapproved.pendingCapabilities, []);
	assert.deepEqual(auditEvents, [
		{
			phase: 'intent',
			action: 'approve',
			capabilities: ['tasks.query', 'tasks.read'],
		},
		{
			phase: 'activated',
			action: 'approve',
			capabilities: ['tasks.query', 'tasks.read'],
		},
	]);
	const durable = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(durable?.state, 'active');
	assert.deepEqual(durable?.grantedCapabilities, ['tasks.query', 'tasks.read']);
	assert.deepEqual(durable?.pendingCapabilities, []);

	const restarted = new DeveloperApiGrantControllerV1({ store, verifier, now: () => new Date(LATER) });
	assert.equal(restarted.evaluate(consumer(), ['tasks.read', 'tasks.query']).state, 'active');
});

test('same-major upgrade reconciles an audit-suspended grant before exact reapproval or revocation', async () => {
	const queued = recordDeveloperApiGrantRequest(
		approveDeveloperApiCapabilities(
			createEmptyDeveloperApiGrantPackage(),
			consumer('1.2.3'),
			['tasks.read'],
			NOW,
		),
		consumer('1.2.3'),
		['tasks.query'],
		LATER,
	);
	const queuedRecord = queued.consumersById['consumer.test'];
	assert.ok(queuedRecord);
	const suspended = suspendDeveloperApiGrantForAuditRecovery(
		queued,
		'consumer.test',
		queuedRecord.revision,
		LATER,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: suspended,
	});
	const auditEvents: Array<{ phase: string; action: string; consumerVersion: string }> = [];
	const store = {
		getDataPackage: () => structuredClone(dataPackage),
		updateDataPackage: async (mutator: (value: typeof dataPackage) => typeof dataPackage) => {
			dataPackage = mutator(dataPackage);
		},
	};
	const upgradedConsumer = consumer('1.2.4');
	const controller = new DeveloperApiGrantControllerV1({
		store,
		verifier: {
			verify: () => upgradedConsumer,
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => `audit-suspended-upgrade-${auditEvents.length}`,
			record: async event => {
				auditEvents.push({
					phase: event.phase,
					action: event.action,
					consumerVersion: event.consumerVersion,
				});
			},
		},
		now: () => new Date(LATER),
	});

	assert.equal(controller.observeConsumerVersion(upgradedConsumer, ['tasks.read', 'tasks.query']), false);
	await controller.drain();
	const rendered = controller.list()[0]!;
	assert.equal(rendered.state, 'suspended');
	assert.equal(rendered.suspensionReason, 'audit-activation-incomplete');
	assert.equal(rendered.consumerVersion, '1.2.4');
	assert.equal(rendered.observedConsumerVersion, undefined);
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(rendered), ['tasks.query', 'tasks.read']);
	assert.deepEqual(controller.evaluate(upgradedConsumer, ['tasks.read', 'tasks.query']).effectiveCapabilities, []);
	assert.equal(dataPackage.integrations.developerApi.consumersById['consumer.test']?.consumerVersion, '1.2.4');
	assert.deepEqual(auditEvents, [
		{ phase: 'intent', action: 'version-accepted', consumerVersion: '1.2.4' },
		{ phase: 'activated', action: 'version-accepted', consumerVersion: '1.2.4' },
	]);

	const reapproved = await controller.approvePending(approvalRequest(
		rendered,
		['tasks.read', 'tasks.query'],
		upgradedConsumer,
	));
	assert.equal(reapproved.state, 'active');
	assert.equal(reapproved.consumerVersion, '1.2.4');
	assert.deepEqual(reapproved.grantedCapabilities, ['tasks.query', 'tasks.read']);
	assert.deepEqual(dataPackage.integrations.developerApi.consumersById['consumer.test']?.pendingCapabilities, []);

	const revoked = await controller.revoke('consumer.test');
	assert.equal(revoked?.state, 'revoked');
	assert.deepEqual(controller.evaluate(upgradedConsumer, ['tasks.read', 'tasks.query']).effectiveCapabilities, []);
	assert.equal(dataPackage.integrations.developerApi.consumersById['consumer.test']?.state, 'revoked');
	assert.deepEqual(auditEvents.slice(2), [
		{ phase: 'intent', action: 'approve', consumerVersion: '1.2.4' },
		{ phase: 'activated', action: 'approve', consumerVersion: '1.2.4' },
		{ phase: 'intent', action: 'revoke', consumerVersion: '1.2.4' },
		{ phase: 'activated', action: 'revoke', consumerVersion: '1.2.4' },
	]);
});

test('owner revocation closes every suspended retained scope without repurposing pending denial', async () => {
	const granted = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const grantedRecord = granted.consumersById['consumer.test'];
	assert.ok(grantedRecord);
	const grantedAndPending = recordDeveloperApiGrantRequest(
		granted,
		consumer(),
		['tasks.query'],
		LATER,
	);
	const grantedAndPendingRecord = grantedAndPending.consumersById['consumer.test'];
	assert.ok(grantedAndPendingRecord);
	const recoverable = suspendDeveloperApiGrantForAuditRecovery(
		grantedAndPending,
		'consumer.test',
		grantedAndPendingRecord.revision,
		LATER,
	);
	const grantedOnly = suspendDeveloperApiGrantForAuditRecovery(
		granted,
		'consumer.test',
		grantedRecord.revision,
		LATER,
	);
	const invalid = reconcileDeveloperApiConsumerVersion(
		granted,
		consumer('not-semver'),
		['tasks.query'],
		LATER,
	).grantPackage;

	for (const { grants, liveConsumer } of [
		{ grants: recoverable, liveConsumer: consumer() },
		{ grants: grantedOnly, liveConsumer: consumer() },
		{ grants: invalid, liveConsumer: consumer('not-semver') },
	]) {
		let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
			developerApiGrants: grants,
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
				verify: () => liveConsumer,
				isCurrent: () => true,
			},
			audit: {
				createCorrelationId: () => 'owner-revocation',
				record: async event => { auditEvents.push({ phase: event.phase, action: event.action }); },
			},
			now: () => new Date(LATER),
		});
		const revoked = await controller.revoke('consumer.test');
		assert.equal(revoked?.state, 'revoked');
		assert.deepEqual(revoked?.pendingCapabilities, []);
		assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(revoked!), []);
		assert.equal(controller.evaluate(liveConsumer, ['tasks.read', 'tasks.query']).state, 'revoked');
		assert.deepEqual(controller.evaluate(liveConsumer, ['tasks.read', 'tasks.query']).effectiveCapabilities, []);
		assert.equal(dataPackage.integrations.developerApi.consumersById['consumer.test']?.state, 'revoked');
		assert.deepEqual(auditEvents, [
			{ phase: 'intent', action: 'revoke' },
			{ phase: 'activated', action: 'revoke' },
		]);
	}

	let activePendingPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: grantedAndPending,
	});
	const activePendingController = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(activePendingPackage),
			updateDataPackage: async mutator => {
				activePendingPackage = mutator(activePendingPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		now: () => new Date(LATER),
	});
	const denied = await activePendingController.denyPending('consumer.test');
	assert.equal(denied.state, 'active');
	assert.deepEqual(denied.grantedCapabilities, ['tasks.read']);
	assert.deepEqual(denied.pendingCapabilities, []);
	assert.deepEqual(activePendingController.evaluate(consumer(), ['tasks.read']).effectiveCapabilities, ['tasks.read']);
});

test('failed owner revocation remains fail-closed across audit and persistence failures', async () => {
	const granted = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const grantRecord = granted.consumersById['consumer.test'];
	assert.ok(grantRecord);
	const suspended = suspendDeveloperApiGrantForAuditRecovery(
		granted,
		'consumer.test',
		grantRecord.revision,
		LATER,
	);
	for (const failure of ['audit', 'persistence'] as const) {
		let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
			developerApiGrants: suspended,
		});
		let writes = 0;
		const controller = new DeveloperApiGrantControllerV1({
			store: {
				getDataPackage: () => structuredClone(dataPackage),
				updateDataPackage: async mutator => {
					writes += 1;
					if (failure === 'persistence') throw new Error('injected revoke persistence failure');
					dataPackage = mutator(dataPackage);
				},
			},
			verifier: {
				verify: () => consumer(),
				isCurrent: () => true,
			},
			audit: {
				createCorrelationId: () => `failed-owner-revocation-${failure}`,
				record: async () => {
					if (failure === 'audit') throw new Error('injected revoke audit failure');
				},
			},
			now: () => new Date(LATER),
		});
		await assert.rejects(controller.revoke('consumer.test'), /injected revoke/u);
		assert.equal(controller.evaluate(consumer(), ['tasks.read']).state, 'suspended');
		assert.deepEqual(controller.evaluate(consumer(), ['tasks.read']).effectiveCapabilities, []);
		assert.equal(writes, failure === 'audit' ? 0 : 1);
	}
});

test('grant controller rejects stale Settings approval bindings before audit or persistence', async () => {
	const activeGrants = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const activeRecord = activeGrants.consumersById['consumer.test'];
	assert.ok(activeRecord);
	const suspendedGrants = suspendDeveloperApiGrantForAuditRecovery(
		activeGrants,
		'consumer.test',
		activeRecord.revision,
		LATER,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: suspendedGrants,
	});
	let liveConsumer = consumer();
	const auditEvents: string[] = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => liveConsumer,
			isCurrent: candidate => candidate.instanceEpoch === liveConsumer.instanceEpoch,
		},
		audit: {
			createCorrelationId: () => 'stale-settings-binding',
			record: async event => { auditEvents.push(event.phase); },
		},
		now: () => new Date(LATER),
	});
	const rendered = controller.list()[0]!;
	const renderedRequest = approvalRequest(rendered, ['tasks.read'], liveConsumer);
	const beforeRevisionDrift = structuredClone(dataPackage);
	dataPackage = {
		...dataPackage,
		integrations: {
			...dataPackage.integrations,
			developerApi: {
				...dataPackage.integrations.developerApi,
				consumersById: {
					...dataPackage.integrations.developerApi.consumersById,
					'consumer.test': {
						...rendered,
						revision: rendered.revision + 1,
					},
				},
			},
		},
	};
	await assert.rejects(
		controller.approvePending(renderedRequest),
		/Developer API grant changed before approval/u,
	);
	assert.deepEqual(auditEvents, []);
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.revision,
		beforeRevisionDrift.integrations.developerApi.consumersById['consumer.test']!.revision + 1,
	);

	for (const changedConsumer of [
		consumer('1.2.4'),
		consumer('2.0.0'),
		consumer('1.2.2'),
		{ ...consumer(), instanceEpoch: 'instance-replaced' },
	]) {
		const cleanPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
			developerApiGrants: suspendedGrants,
		});
		liveConsumer = changedConsumer;
		const isolated = new DeveloperApiGrantControllerV1({
			store: {
				getDataPackage: () => structuredClone(cleanPackage),
				updateDataPackage: async () => {
					throw new Error('stale Settings approval must not persist');
				},
			},
			verifier: {
				verify: () => liveConsumer,
				isCurrent: candidate => candidate.instanceEpoch === liveConsumer.instanceEpoch,
			},
			now: () => new Date(LATER),
		});
		await assert.rejects(
			isolated.approvePending({ ...renderedRequest, consumer: changedConsumer }),
			/Developer API consumer changed before approval/u,
		);
	}
});

test('grant controller rejects an incoherent active record before audit or persistence', async () => {
	const pendingGrants = recordDeveloperApiGrantRequest(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const pendingRecord = pendingGrants.consumersById['consumer.test'];
	assert.ok(pendingRecord);
	const incoherentGrants = {
		...pendingGrants,
		consumersById: {
			...pendingGrants.consumersById,
			'consumer.test': { ...pendingRecord, approvedMajorVersion: 2 },
		},
	};
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: incoherentGrants,
	});
	const auditEvents: string[] = [];
	let writes = 0;
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				writes += 1;
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer(),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'incoherent-grant',
			record: async event => { auditEvents.push(event.phase); },
		},
		now: () => new Date(LATER),
	});
	const record = controller.list()[0]!;
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(record), []);
	await assert.rejects(
		controller.approvePending(approvalRequest(record, ['tasks.read'])),
		/semantically incoherent for approval/u,
	);
	assert.deepEqual(auditEvents, []);
	assert.equal(writes, 0);
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.approvedMajorVersion,
		2,
	);
});

test('restart preserves a durable version suspension after its audit activation fails, before Settings reapproval', async () => {
	const initialGrants = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer('1.2.3'),
		['tasks.read'],
		NOW,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: initialGrants,
	});
	const failedAuditEvents: Array<{ phase: string; action: string }> = [];
	const versionController = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer('2.0.0'),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'version-suspension-audit-failure',
			record: async event => {
				failedAuditEvents.push({ phase: event.phase, action: event.action });
				if (event.action === 'version-suspended' && event.phase === 'activated') {
					throw new Error('injected version suspension audit activation failure');
				}
			},
		},
		now: () => new Date(LATER),
	});
	versionController.observeConsumerVersion(consumer('2.0.0'), ['tasks.read']);
	await assert.rejects(versionController.drain(), /injected version suspension audit activation failure/u);
	const durableSuspension = dataPackage.integrations.developerApi.consumersById['consumer.test'];
	assert.equal(durableSuspension?.state, 'suspended');
	assert.equal(durableSuspension?.suspensionReason, 'consumer-major-version-changed');
	assert.equal(durableSuspension?.observedConsumerVersion, '2.0.0');
	assert.deepEqual(failedAuditEvents, [
		{ phase: 'intent', action: 'version-suspended' },
		{ phase: 'activated', action: 'version-suspended' },
	]);

	const approvalAuditEvents: Array<{ phase: string; action: string }> = [];
	const restartedSettings = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer('2.0.0'),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'version-suspension-reapproval',
			record: async event => { approvalAuditEvents.push({ phase: event.phase, action: event.action }); },
		},
		startupAuditRecoveryTransitions: [{
			consumerId: 'consumer.test',
			revision: durableSuspension?.revision ?? -1,
		}],
		now: () => new Date(LATER),
	});
	const rendered = restartedSettings.list()[0]!;
	assert.equal(rendered.suspensionReason, 'consumer-major-version-changed');
	assert.equal(rendered.observedConsumerVersion, '2.0.0');
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(rendered), ['tasks.read']);

	const reapproved = await restartedSettings.approvePending(approvalRequest(
		rendered,
		['tasks.read'],
		consumer('2.0.0'),
	));
	assert.equal(reapproved.state, 'active');
	assert.equal(reapproved.consumerVersion, '2.0.0');
	assert.equal(reapproved.approvedMajorVersion, 2);
	assert.deepEqual(approvalAuditEvents, [
		{ phase: 'intent', action: 'approve' },
		{ phase: 'activated', action: 'approve' },
	]);
});

test('grant controller rejects a forged audit-recovery version observation before audit or persistence', async () => {
	const versionSuspended = reconcileDeveloperApiConsumerVersion(
		approveDeveloperApiCapabilities(
			createEmptyDeveloperApiGrantPackage(),
			consumer('1.2.3'),
			['tasks.read'],
			NOW,
		),
		consumer('2.0.0'),
		['tasks.read'],
		LATER,
	).grantPackage;
	const suspendedRecord = versionSuspended.consumersById['consumer.test'];
	assert.ok(suspendedRecord);
	const forgedGrants = {
		...versionSuspended,
		consumersById: {
			...versionSuspended.consumersById,
			'consumer.test': {
				...suspendedRecord,
				suspensionReason: 'audit-activation-incomplete' as const,
			},
		},
	};
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: forgedGrants,
	});
	let writes = 0;
	const auditEvents: string[] = [];
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				writes += 1;
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer('2.0.0'),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => 'forged-audit-recovery',
			record: async event => { auditEvents.push(event.phase); },
		},
		now: () => new Date(LATER),
	});
	const record = controller.list()[0]!;
	assert.deepEqual(getDeveloperApiGrantApprovalCapabilities(record), []);
	await assert.rejects(
		controller.approvePending(approvalRequest(record, ['tasks.read'], consumer('2.0.0'))),
		/semantically incoherent for approval/u,
	);
	assert.deepEqual(auditEvents, []);
	assert.equal(writes, 0);
	assert.equal(dataPackage.integrations.developerApi.consumersById['consumer.test']?.suspensionReason, 'audit-activation-incomplete');
});

test('Settings approval stays exact across a build metadata observation and never grants implicitly', async () => {
	const pendingGrants = recordDeveloperApiGrantRequest(
		approveDeveloperApiCapabilities(
			createEmptyDeveloperApiGrantPackage(),
			consumer('1.2.3+one'),
			['tasks.read'],
			NOW,
		),
		consumer('1.2.3+one'),
		['tasks.read', 'tasks.query'],
		LATER,
	);
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: pendingGrants,
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
			verify: () => consumer('1.2.3+two'),
			isCurrent: () => true,
		},
		audit: {
			createCorrelationId: () => `build-metadata-${auditEvents.length}`,
			record: async event => { auditEvents.push({ phase: event.phase, action: event.action }); },
		},
		now: () => new Date(LATER),
	});

	const renderedBeforeRuntime = controller.list()[0]!;
	assert.equal(renderedBeforeRuntime.consumerVersion, '1.2.3+one');
	await assert.rejects(
		controller.approvePending(approvalRequest(
			renderedBeforeRuntime,
			['tasks.query'],
			consumer('1.2.3+two'),
		)),
		/Developer API consumer changed before approval/u,
	);
	assert.deepEqual(auditEvents, []);
	assert.deepEqual(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.grantedCapabilities,
		['tasks.read'],
	);
	assert.deepEqual(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.pendingCapabilities,
		['tasks.query'],
	);

	assert.equal(controller.observeConsumerVersion(consumer('1.2.3+two'), ['tasks.read', 'tasks.query']), false);
	await controller.drain();
	const renderedAfterRuntime = controller.list()[0]!;
	assert.equal(renderedAfterRuntime.consumerVersion, '1.2.3+two');
	assert.deepEqual(renderedAfterRuntime.grantedCapabilities, ['tasks.read']);
	assert.deepEqual(renderedAfterRuntime.pendingCapabilities, ['tasks.query']);
	assert.deepEqual(auditEvents, [
		{ phase: 'intent', action: 'version-accepted' },
		{ phase: 'activated', action: 'version-accepted' },
	]);

	const approved = await controller.approvePending(approvalRequest(
		renderedAfterRuntime,
		['tasks.query'],
		consumer('1.2.3+two'),
	));
	assert.deepEqual(approved.grantedCapabilities, ['tasks.query', 'tasks.read']);
	assert.deepEqual(approved.pendingCapabilities, []);
	assert.deepEqual(auditEvents.slice(2), [
		{ phase: 'intent', action: 'approve' },
		{ phase: 'activated', action: 'approve' },
	]);
});

test('grant controller keeps consumer-version-invalid suspended despite an approval attempt', async () => {
	const activeGrants = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	const invalidGrants = reconcileDeveloperApiConsumerVersion(
		activeGrants,
		consumer('not-semver'),
		['tasks.read'],
		LATER,
	).grantPackage;
	let dataPackage = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS, {
		developerApiGrants: invalidGrants,
	});
	const controller = new DeveloperApiGrantControllerV1({
		store: {
			getDataPackage: () => structuredClone(dataPackage),
			updateDataPackage: async mutator => {
				dataPackage = mutator(dataPackage);
			},
		},
		verifier: {
			verify: () => consumer('not-semver'),
			isCurrent: () => true,
		},
		now: () => new Date(LATER),
	});

	await assert.rejects(
		controller.approvePending(approvalRequest(
			controller.list()[0]!,
			['tasks.read'],
			consumer('not-semver'),
		)),
		/No approvable Developer API capabilities selected/u,
	);
	const fenced = controller.evaluate(consumer('not-semver'), ['tasks.read']);
	assert.equal(fenced.state, 'suspended');
	assert.equal(fenced.reason, 'consumer-version-invalid');
	assert.deepEqual(fenced.effectiveCapabilities, []);
	assert.equal(
		dataPackage.integrations.developerApi.consumersById['consumer.test']?.state,
		'suspended',
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
