import { resolveRuntimeIdentityGraphFreshCommitSettlementV1, settleRuntimeIdentityGraphPostflightV1, buildRuntimeIdentityGraphGroupResultsV1 } from '../../../src/agent-runtime/runtime/identity-graph-settlement';
import { executeRuntimeGraphTransactionCommitV1, executeRuntimeGraphTransactionRecoveryV1 } from '../../../src/agent-runtime/runtime/graph-transaction-executor';
import legacyTransactionIdentifiers from './legacy-transaction-identifiers.json';
import { boundRuntimeTransactionIdV1 } from '../../../src/agent-runtime/runtime/transaction-identifiers';
import { RuntimeMutationGatewayV1, withRuntimeVaultMutationLockV1 } from '../../../src/agent-runtime/runtime/mutation-gateway';
import { prepareRuntimeTaskCreationV1 } from '../../../src/agent-runtime/runtime/task-creation-adapter';
import { decodeMutationApplyRequestV1, decodeMutationPreviewResultV1, decodeMutationResultV1, type ContextRevisionV1, type MutationPreviewRequestV1 } from '../../../src/agent-runtime/contracts/v1';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';
import { runtimeMainMethod, runtimeTransactionPort, transactionState } from '../mutation/transaction-id-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import './indexeddb-common.test';

import {
	sha256HexV1,
	type MutationReceiptV1,
	type MutationResultV1,
	structuredErrorV1,
} from '../../../src/agent-runtime/contracts/v1';
import type { IdentityPlaceholderSealedPlanV1 } from '../../../src/agent-runtime/extensions/task-workflows-v1/contracts';
import {
	buildIdentityPlaceholderJournalV1,
	identityPlaceholderJournalByteLengthV1,
	identityPlaceholderJournalsEqualV1,
	utf8ByteLengthV1,
} from '../../../src/agent-runtime/runtime/identity-placeholder-journal';
import {
	IndexedDbMutationReceiptStoreV1,
	IndexedDbSecurityAuditStoreV1,
	findIncompleteDeveloperGrantAuditTransitionsV1,
	findIncompleteDeveloperGrantAuditTransitionsForVaultV1,
	GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1,
	MUTATION_RECEIPT_MAX_RECORDS_V1,
	MUTATION_RECEIPT_TTL_MS_V1,
	SECURITY_AUDIT_MAX_RECORDS_V1,
	SECURITY_AUDIT_RETENTION_MS_V1,
	MutationReceiptStoreErrorV1,
	SecurityAuditStoreErrorV1,
	type GraphTransactionJournalV1,
	type MutationReceiptScopeV1,
	type SecurityAuditEventV1,
} from '../../../src/agent-runtime/runtime/receipts';
import type {
	RuntimeTimingSinkV1,
	RuntimeTimingSpanV1,
} from '../../../src/agent-runtime/runtime/timing-probe';

if (typeof window === 'undefined') {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: globalThis,
	});
}

const BASE_TIME = Date.parse('2026-07-24T10:00:00.000Z');
const LEASE_OWNER = 'receipt-test-executor';

function sha256(value: number): string {
	return value.toString(16).padStart(64, '0');
}

function receipt(
	id: number,
	completedAtMs: number = BASE_TIME,
	overrides: Partial<MutationReceiptV1> = {},
): MutationReceiptV1 {
	return {
		contractVersion: 1,
		vaultIdentityHash: sha256(1),
		clientInstanceId: 'client-fixture-v1',
		idempotencyKeyHash: sha256(10_000 + id),
		planHash: sha256(20_000 + id),
		mutationKind: 'task.create',
		targetDigest: sha256(30_000 + id),
		terminalOutcome: 'applied',
		effectiveAt: new Date(completedAtMs).toISOString(),
		completedAt: new Date(completedAtMs).toISOString(),
		expiresAt: new Date(completedAtMs + MUTATION_RECEIPT_TTL_MS_V1).toISOString(),
		...overrides,
	};
}

function scope(value: MutationReceiptV1): MutationReceiptScopeV1 {
	return {
		vaultIdentityHash: value.vaultIdentityHash,
		clientInstanceId: value.clientInstanceId,
		idempotencyKeyHash: value.idempotencyKeyHash,
		mutationKind: value.mutationKind,
	};
}

function journal(
	id: number,
	overrides: Partial<GraphTransactionJournalV1> = {},
): GraphTransactionJournalV1 {
	const value = receipt(id);
	return {
		contractVersion: 1,
		vaultIdentityHash: value.vaultIdentityHash,
		clientInstanceId: value.clientInstanceId,
		idempotencyKeyHash: value.idempotencyKeyHash,
		mutationKind: value.mutationKind,
		planHash: value.planHash,
		targetDigest: value.targetDigest,
		planId: `graph-plan-${id}`,
		effectiveAt: value.effectiveAt,
		createdAt: value.effectiveAt,
		phase: 'prepared',
		completedStepCount: 0,
		steps: [{
			stepId: 'source-a',
			groupId: 'source-a',
			resourceKind: 'task-source',
			resourceKey: 'Tasks/A.md',
			operation: 'modify',
			before: {
				state: 'present',
				digest: sha256HexV1('# Before\n'),
				content: '# Before\n',
			},
			after: {
				state: 'present',
				digest: sha256HexV1('# After\n'),
				content: '# After\n',
			},
		}],
		...overrides,
	};
}

function identityPlaceholderPlan(id: number): IdentityPlaceholderSealedPlanV1 {
	const value = receipt(id);
	return {
		contractVersion: 1,
		planId: `identity-plan-${id}`,
		planHash: value.planHash,
		clientInstanceId: value.clientInstanceId,
		correlationId: `identity-correlation-${id}`,
		idempotencyKeyHash: value.idempotencyKeyHash,
		receiptTargetDigest: value.targetDigest,
		capability: 'tasks.create.identity-placeholders',
		mutationKind: 'task.create',
		createdAt: '2026-07-24T10:00:00.000Z',
		expiresAt: '2026-07-24T10:05:00.000Z',
		targets: [],
		contextRevision: {
			index: {
				sessionId: 'identity-journal-test',
				ramGeneration: 1,
				durable: { status: 'missing' },
			},
			settingsFingerprint: sha256(50_000 + id),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: sha256(60_000 + id),
		},
		affectedResources: [],
		atomicGroups: [],
		predictedEffects: [],
		riskLevel: 'routine',
		requiresConfirmation: false,
		requiredAcknowledgements: [],
		warnings: [],
		spec: { operation: 'create', items: [] },
		createEffects: [],
	} as IdentityPlaceholderSealedPlanV1;
}

function auditEvent(
	id: number,
	occurredAtMs: number = BASE_TIME,
	overrides: Partial<SecurityAuditEventV1> = {},
): SecurityAuditEventV1 {
	return {
		contractVersion: 1,
		eventId: sha256(40_000 + id),
		event: 'apply-completed',
		channel: 'developer-api',
		consumerIdentityHash: sha256(41_000),
		grantRevision: 2,
		capability: 'tasks.create',
		mutationKind: 'task.create',
		risk: 'routine',
		planDigest: sha256(42_000 + id),
		targetDigest: sha256(43_000 + id),
		vaultIdentityHash: sha256(44_000),
		consent: 'not-required',
		admission: 'completed',
		outcome: 'succeeded',
		errorCode: null,
		occurredAt: new Date(occurredAtMs).toISOString(),
		correlationHash: sha256(45_000 + id),
		...overrides,
	};
}

test('health fails closed when IndexedDB is unavailable', async () => {
	const store = new IndexedDbMutationReceiptStoreV1({ indexedDBFactory: null });
	assert.deepEqual(await store.health(), {
		healthy: false,
		status: 'unavailable',
		reason: 'indexeddb-unavailable',
	});
	await assert.rejects(
		store.lookup(scope(receipt(1))),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-unavailable',
	);
});

test('identity placeholder journals retain preview creation time, use apply time, and admit durable exact readback', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-identity-journal-readback',
	});
	const plan = identityPlaceholderPlan(160);
	const value = buildIdentityPlaceholderJournalV1(
		plan,
		sha256(1),
		'2026-07-24T10:01:00.000Z',
		[{
			stepId: 'source:Identity.md',
			groupId: 'task-source:Identity.md',
			resourceKind: 'task-source',
			resourceKey: 'Identity.md',
			operation: 'create',
			before: { state: 'absent', digest: sha256HexV1(''), content: null },
			after: { state: 'present', digest: sha256HexV1('# Identity\n'), content: '# Identity\n' },
		}],
	);
	assert.equal(value.createdAt, plan.createdAt);
	assert.equal(value.effectiveAt, '2026-07-24T10:01:00.000Z');
	assert.equal(utf8ByteLengthV1('ö'), 2);
	assert.equal(await store.acquireJournal(value, LEASE_OWNER), true);
	const persisted = await store.lookupJournal({
		vaultIdentityHash: value.vaultIdentityHash,
		clientInstanceId: value.clientInstanceId,
		idempotencyKeyHash: value.idempotencyKeyHash,
		mutationKind: value.mutationKind,
	});
	assert.ok(persisted);
	if (!persisted) throw new Error('Expected the acquired identity journal to be readable.');
	assert.equal(identityPlaceholderJournalsEqualV1(persisted, value), true);
});

test('an owned journal can remove the exact altered readback before any recovery can reuse it', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-owned-altered-journal-cleanup',
	});
	const original = journal(162);
	const receiptScope: MutationReceiptScopeV1 = {
		vaultIdentityHash: original.vaultIdentityHash,
		clientInstanceId: original.clientInstanceId,
		idempotencyKeyHash: original.idempotencyKeyHash,
		mutationKind: original.mutationKind,
	};
	assert.equal(await store.acquireJournal(original, LEASE_OWNER), true);
	const key = [...factory.journals.keys()][0];
	assert.ok(key);
	const alteredStored = structuredClone(factory.journals.get(key)) as {
		journal: GraphTransactionJournalV1;
	};
	const alteredContent = '# Altered after-state\n';
	alteredStored.journal.steps[0]!.after = {
		state: 'present',
		digest: sha256HexV1(alteredContent),
		content: alteredContent,
	};
	factory.journals.set(key, alteredStored);

	const persisted = await store.lookupJournal(receiptScope);
	assert.ok(persisted);
	if (!persisted) throw new Error('Expected the altered journal readback.');
	assert.equal(identityPlaceholderJournalsEqualV1(persisted, original), false);
	assert.equal(await store.deleteJournal(receiptScope, original, LEASE_OWNER), false);
	assert.equal(await store.deleteJournal(receiptScope, persisted, LEASE_OWNER), true);
	assert.equal(await store.lookupJournal(receiptScope), null);
});

test('identity placeholder journal byte limit admits exactly 8 MiB and rejects the next byte without a journal write', async () => {
	const plan = identityPlaceholderPlan(161);
	const createJournal = () => buildIdentityPlaceholderJournalV1(
		plan,
		sha256(1),
		'2026-07-24T10:01:00.000Z',
		[{
			stepId: 'source:Large.md',
			groupId: 'task-source:Large.md',
			resourceKind: 'task-source',
			resourceKey: 'Large.md',
			operation: 'create',
			before: { state: 'absent', digest: sha256HexV1(''), content: null },
			after: { state: 'present', digest: sha256HexV1(''), content: '' },
		}],
	);
	const exact = createJournal();
	const paddingLength = GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1
		- identityPlaceholderJournalByteLengthV1(exact);
	exact.steps[0].after.content = 'x'.repeat(paddingLength);
	exact.steps[0].after.digest = sha256HexV1(exact.steps[0].after.content);
	assert.equal(identityPlaceholderJournalByteLengthV1(exact), GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1);

	const exactFactory = new FakeIndexedDbFactory();
	const exactStore = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: exactFactory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-identity-journal-exact-limit',
	});
	assert.equal(await exactStore.acquireJournal(exact, LEASE_OWNER), true);
	assert.equal(exactFactory.journals.size, 1);

	const oversized = structuredClone(exact);
	const oversizedContent = `${oversized.steps[0].after.content ?? ''}x`;
	oversized.steps[0].after.content = oversizedContent;
	oversized.steps[0].after.digest = sha256HexV1(oversizedContent);
	assert.equal(identityPlaceholderJournalByteLengthV1(oversized), GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1 + 1);
	const oversizedFactory = new FakeIndexedDbFactory();
	const oversizedStore = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: oversizedFactory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-identity-journal-over-limit',
	});
	await assert.rejects(
		oversizedStore.acquireJournal(oversized, LEASE_OWNER),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	assert.equal(oversizedFactory.journals.size, 0);
});

test('database version 2 upgrades an existing receipt-only store in place', async () => {
	const factory = new FakeIndexedDbFactory(true);
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-v1-upgrade',
	});
	assert.equal((await store.health()).healthy, true);
	const value = receipt(77);
	await store.persist(value);
	assert.equal(await store.acquireJournal(journal(77), LEASE_OWNER), true);
	assert.deepEqual(await store.lookup(scope(value)), value);
	assert.ok(await store.lookupJournal(scope(value)));
});

test('graph journal admits exact pinned CAS state and rejects non-CAS pinned operations', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-pinned-journal',
	});
	const before = JSON.stringify({ pinned: true, updatedAt: '2026-07-24T09:00:00.000Z' });
	const after = JSON.stringify({ pinned: false, updatedAt: '2026-07-24T10:00:00.000Z' });
	const valid = journal(78, {
		mutationKind: 'task.delete',
		steps: [{
			stepId: 'pinned:abc1234',
			groupId: 'pinned:abc1234',
			resourceKind: 'pinned',
			resourceKey: 'abc1234',
			operation: 'modify',
			before: { state: 'present', digest: sha256HexV1(before), content: before },
			after: { state: 'present', digest: sha256HexV1(after), content: after },
		}],
	});
	assert.equal(await store.acquireJournal(valid, LEASE_OWNER), true);
	assert.deepEqual(await store.lookupJournal(scope(receipt(78, BASE_TIME, {
		mutationKind: 'task.delete',
	}))), valid);

	const invalid = journal(79, {
		mutationKind: 'task.delete',
		steps: [{
			stepId: 'pinned:abc1234',
			groupId: 'pinned:abc1234',
			resourceKind: 'pinned',
			resourceKey: 'abc1234',
			operation: 'create',
			before: { state: 'absent', digest: sha256HexV1(''), content: null },
			after: { state: 'present', digest: sha256HexV1(after), content: after },
		}],
	});
	await assert.rejects(
		store.acquireJournal(invalid, LEASE_OWNER),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
});

test('graph journal admits modify-only timer and semantic operation recovery fences', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-operation-journal',
	});
	for (const [offset, resourceKind] of [
		[80, 'active-tracker'],
		[81, 'semantic-transition'],
	] as const) {
		const before = JSON.stringify({ state: 'before', resourceKind });
		const after = JSON.stringify({ state: 'after', resourceKind });
		const value = journal(offset, {
			mutationKind: resourceKind === 'active-tracker'
				? 'timer.control'
				: 'task.transition',
			steps: [{
				stepId: `${resourceKind}:one`,
				groupId: `${resourceKind}:one`,
				resourceKind,
				resourceKey: 'current-user',
				operation: 'modify',
				before: { state: 'present', digest: sha256HexV1(before), content: before },
				after: { state: 'present', digest: sha256HexV1(after), content: after },
			}],
		});
		assert.equal(await store.acquireJournal(value, LEASE_OWNER), true);
		assert.deepEqual(
			await store.lookupJournal(scope(receipt(offset, BASE_TIME, {
				mutationKind: value.mutationKind,
			}))),
			value,
		);
	}
});

test('persist and lookup use a strict metadata-only opaque record', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-persist',
	});
	assert.equal((await store.health()).healthy, true);

	const value = receipt(1);
	assert.deepEqual(await store.persist(value), {
		expiredDeleted: 0,
		overflowDeleted: 0,
		retained: 1,
	});
	const found = await store.lookup(scope(value));
	assert.deepEqual(found, value);
	assert.notEqual(found, value);

	const persisted = [...factory.records.values()];
	assert.equal(persisted.length, 1);
	assert.match(String(persisted[0]?.key), /^[a-f0-9]{64}$/);
	assert.equal(String(persisted[0]?.key).includes(value.clientInstanceId), false);
	assert.equal(JSON.stringify(persisted).includes('task description must never persist'), false);

	const withUnexpectedPayload = {
		...receipt(2),
		description: 'task description must never persist',
	};
	await assert.rejects(
		store.persist(withUnexpectedPayload as MutationReceiptV1),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
});

test('persist atomically replaces the same composite scope', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-replace',
	});
	const first = receipt(1);
	await store.persist(first);
	now += 1_000;
	const replacement = receipt(1, now, {
		terminalOutcome: 'already-applied',
	});
	await store.persist(replacement);
	assert.equal(factory.records.size, 1);
	assert.deepEqual(await store.lookup(scope(first)), replacement);
});

test('expired receipts are deleted and never authorize replay', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-expiry',
	});
	const value = receipt(1);
	await store.persist(value);
	now += MUTATION_RECEIPT_TTL_MS_V1;
	assert.equal(await store.lookup(scope(value)), null);
	assert.equal(factory.records.size, 0);
});

test('persist rejects expired receipts and TTL values above 24 hours', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-invalid-ttl',
	});
	await assert.rejects(
		store.persist(receipt(1, BASE_TIME - MUTATION_RECEIPT_TTL_MS_V1)),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	await assert.rejects(
		store.persist(receipt(2, BASE_TIME, {
			expiresAt: new Date(BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1 + 1).toISOString(),
		})),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
});

test('retention keeps the deterministic newest 256 receipts', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-retention',
	});
	const values: MutationReceiptV1[] = [];
	for (let index = 0; index <= MUTATION_RECEIPT_MAX_RECORDS_V1; index += 1) {
		const value = receipt(index + 1, now);
		values.push(value);
		await store.persist(value);
		now += 1;
	}
	assert.equal(factory.records.size, MUTATION_RECEIPT_MAX_RECORDS_V1);
	assert.equal(await store.lookup(scope(values[0])), null);
	assert.deepEqual(
		await store.lookup(scope(values[values.length - 1])),
		values[values.length - 1],
	);
});

test('delete and prune are bounded and deterministic', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-delete-prune',
	});
	const first = receipt(1);
	const second = receipt(2);
	await store.persist(first);
	await store.persist(second);
	assert.equal(await store.delete(scope(first)), true);
	assert.equal(await store.delete(scope(first)), false);

	now += MUTATION_RECEIPT_TTL_MS_V1;
	assert.deepEqual(await store.prune(), {
		expiredDeleted: 1,
		overflowDeleted: 0,
		retained: 0,
	});
	assert.equal(factory.records.size, 0);
});

test('database failures make the store unhealthy without a localStorage fallback', async () => {
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: new ThrowingIndexedDbFactory() as unknown as IDBFactory,
		databaseName: 'receipt-test-failure',
	});
	assert.deepEqual(await store.health(), {
		healthy: false,
		status: 'unhealthy',
		reason: 'database-open-failed',
	});
	assert.equal(JSON.stringify(await store.health()).includes('localStorage'), false);
});

test('forced health detects corrupt stored payloads before apply admission', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-corruption',
	});
	assert.equal((await store.health()).healthy, true);
	factory.records.set(sha256(99), {
		key: sha256(99),
		completedAtMs: BASE_TIME,
		expiresAtMs: BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1,
		receipt: { ...receipt(99), planHash: 'not-a-digest' },
	});
	assert.deepEqual(await store.health(true), {
		healthy: false,
		status: 'unhealthy',
		reason: 'operation-failed',
	});
});

test('forced health accepts an exact legacy task-adopt receipt without rewriting it', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-legacy-task-adopt',
	});
	assert.equal((await store.health()).healthy, true);
	const legacyReceipt = {
		...receipt(97),
		mutationKind: 'task.adopt',
	};
	const storedLegacyReceipt = {
		key: sha256(97),
		completedAtMs: BASE_TIME,
		expiresAtMs: BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1,
		receipt: legacyReceipt,
	};
	factory.records.set(
		storedLegacyReceipt.key,
		storedLegacyReceipt as unknown as FakeStoredRecord,
	);

	assert.deepEqual(await store.health(true), {
		healthy: true,
		status: 'healthy',
		reason: 'ready',
	});
	assert.deepEqual(factory.records.get(storedLegacyReceipt.key), storedLegacyReceipt);
});

test('current fallback and admission-token writes preserve a live legacy task-adopt receipt', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-legacy-task-adopt-current-writes',
	});
	assert.equal((await store.health()).healthy, true);
	const legacyReceipt = { ...receipt(94), mutationKind: 'task.adopt' };
	const storedLegacyReceipt = {
		key: sha256(94),
		completedAtMs: BASE_TIME,
		expiresAtMs: BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1,
		receipt: legacyReceipt,
	};
	factory.records.set(
		storedLegacyReceipt.key,
		storedLegacyReceipt as unknown as FakeStoredRecord,
	);
	assert.equal((await store.health(true)).healthy, true);

	const fallbackReceipt = receipt(95);
	await store.persist(fallbackReceipt);
	const admissionReceipt = receipt(96);
	const admission = await store.lookupForApplyAdmission(scope(admissionReceipt));
	assert.equal(admission.health.healthy, true);
	assert.ok(admission.admissionToken);
	await store.persistAfterApplyAdmission(admissionReceipt, admission.admissionToken);

	assert.deepEqual(factory.records.get(storedLegacyReceipt.key), storedLegacyReceipt);
	assert.deepEqual(await store.lookup(scope(fallbackReceipt)), fallbackReceipt);
	assert.deepEqual(await store.lookup(scope(admissionReceipt)), admissionReceipt);
});

test('live legacy task-adopt receipts are excluded from current receipt overflow', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME + MUTATION_RECEIPT_MAX_RECORDS_V1 + 2;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-legacy-task-adopt-overflow',
	});
	assert.equal((await store.health()).healthy, true);
	for (let index = 1; index <= MUTATION_RECEIPT_MAX_RECORDS_V1; index += 1) {
		const currentReceipt = receipt(index, BASE_TIME + index);
		factory.records.set(sha256(index), {
			key: sha256(index),
			completedAtMs: BASE_TIME + index,
			expiresAtMs: BASE_TIME + index + MUTATION_RECEIPT_TTL_MS_V1,
			receipt: currentReceipt,
		});
	}
	const storedLegacyReceipts = [1_000, 1_001].map(id => ({
		key: sha256(id),
		completedAtMs: BASE_TIME,
		expiresAtMs: BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1,
		receipt: { ...receipt(id), mutationKind: 'task.adopt' },
	}));
	for (const storedLegacyReceipt of storedLegacyReceipts) {
		factory.records.set(
			storedLegacyReceipt.key,
			storedLegacyReceipt as unknown as FakeStoredRecord,
		);
	}

	assert.equal((await store.health(true)).healthy, true);
	assert.deepEqual(await store.prune(), {
		expiredDeleted: 0,
		overflowDeleted: 0,
		retained: MUTATION_RECEIPT_MAX_RECORDS_V1 + storedLegacyReceipts.length,
	});
	for (const storedLegacyReceipt of storedLegacyReceipts) {
		assert.deepEqual(factory.records.get(storedLegacyReceipt.key), storedLegacyReceipt);
	}

	const fallbackReceipt = receipt(2_000, now);
	assert.deepEqual(await store.persist(fallbackReceipt), {
		expiredDeleted: 0,
		overflowDeleted: 1,
		retained: MUTATION_RECEIPT_MAX_RECORDS_V1 + storedLegacyReceipts.length,
	});
	assert.equal(factory.records.has(sha256(1)), false);
	for (const storedLegacyReceipt of storedLegacyReceipts) {
		assert.deepEqual(factory.records.get(storedLegacyReceipt.key), storedLegacyReceipt);
	}

	now += 1;
	const admissionReceipt = receipt(2_001, now);
	const admission = await store.lookupForApplyAdmission(scope(admissionReceipt));
	assert.ok(admission.admissionToken);
	assert.deepEqual(
		await store.persistAfterApplyAdmission(admissionReceipt, admission.admissionToken),
		{
			expiredDeleted: 0,
			overflowDeleted: 1,
			retained: MUTATION_RECEIPT_MAX_RECORDS_V1 + storedLegacyReceipts.length,
		},
	);
	assert.equal(factory.records.has(sha256(2)), false);
	for (const storedLegacyReceipt of storedLegacyReceipts) {
		assert.deepEqual(factory.records.get(storedLegacyReceipt.key), storedLegacyReceipt);
	}
});

test('expired legacy task-adopt receipts prune once and remain idempotent', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-legacy-task-adopt-expired',
	});
	assert.equal((await store.health()).healthy, true);
	const legacyReceipt = {
		...receipt(93, BASE_TIME - MUTATION_RECEIPT_TTL_MS_V1),
		mutationKind: 'task.adopt',
	};
	factory.records.set(sha256(93), {
		key: sha256(93),
		completedAtMs: BASE_TIME - MUTATION_RECEIPT_TTL_MS_V1,
		expiresAtMs: BASE_TIME,
		receipt: legacyReceipt,
	} as unknown as FakeStoredRecord);
	const beforeGeneration = structuredClone(factory.metadata.get('receipt-generation')) as {
		generation: number;
	};

	assert.equal((await store.health(true)).healthy, true);
	assert.equal(factory.records.size, 0);
	const afterFirstGeneration = structuredClone(factory.metadata.get('receipt-generation')) as {
		generation: number;
	};
	assert.equal(afterFirstGeneration.generation, beforeGeneration.generation + 1);
	assert.equal((await store.health(true)).healthy, true);
	assert.equal(factory.records.size, 0);
	assert.deepEqual(factory.metadata.get('receipt-generation'), afterFirstGeneration);
});

test('malformed legacy and future receipts fail closed without partial pruning', async () => {
	for (const [name, invalidReceipt] of [
		['malformed-legacy', { ...receipt(91), mutationKind: 'task.adopt', unexpected: true }],
		['missing-field', (() => {
			const { planHash: _planHash, ...value } = receipt(91);
			return { ...value, mutationKind: 'task.adopt' };
		})()],
		['bad-hash', { ...receipt(91), mutationKind: 'task.adopt', planHash: 'not-a-digest' }],
		['invalid-timestamp', { ...receipt(91), mutationKind: 'task.adopt', completedAt: 'not-a-timestamp' }],
		['ttl-too-long', {
			...receipt(91),
			mutationKind: 'task.adopt',
			expiresAt: new Date(BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1 + 1).toISOString(),
		}],
		['invalid-outcome', { ...receipt(91), mutationKind: 'task.adopt', terminalOutcome: 'unknown' }],
		['future-kind', { ...receipt(92), mutationKind: 'task.future' }],
	] as const) {
		const factory = new FakeIndexedDbFactory();
		const store = new IndexedDbMutationReceiptStoreV1({
			indexedDBFactory: factory as unknown as IDBFactory,
			now: () => BASE_TIME,
			databaseName: `receipt-test-${name}`,
		});
		assert.equal((await store.health()).healthy, true);
		const expired = receipt(90, BASE_TIME - MUTATION_RECEIPT_TTL_MS_V1);
		factory.records.set(sha256(90), {
			key: sha256(90),
			completedAtMs: Date.parse(expired.completedAt),
			expiresAtMs: Date.parse(expired.expiresAt),
			receipt: expired,
		});
		factory.records.set(sha256(91), {
			key: sha256(91),
			completedAtMs: BASE_TIME,
			expiresAtMs: BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1,
			receipt: invalidReceipt,
		} as unknown as FakeStoredRecord);
		const before = structuredClone([...factory.records.entries()]);
		const metadataBefore = structuredClone([...factory.metadata.entries()]);

		assert.deepEqual(await store.health(true), {
			healthy: false,
			status: 'unhealthy',
			reason: 'operation-failed',
		});
		assert.deepEqual([...factory.records.entries()], before);
		assert.deepEqual([...factory.metadata.entries()], metadataBefore);
	}
});

test('new writes cannot use the legacy task-adopt receipt kind', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-legacy-task-adopt-write-rejected',
	});
	const legacyReceipt = { ...receipt(89), mutationKind: 'task.adopt' };
	await assert.rejects(
		store.persist(legacyReceipt as unknown as MutationReceiptV1),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	assert.equal(factory.records.size, 0);
});

test('legacy task-adopt journals require explicit recovery and remain untouched', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-legacy-task-adopt-journal',
	});
	assert.equal((await store.health()).healthy, true);
	const legacyJournal = { ...journal(88), mutationKind: 'task.adopt' };
	factory.journals.set(sha256(88), {
		key: sha256(88),
		updatedAtMs: BASE_TIME,
		leaseOwner: LEASE_OWNER,
		leaseExpiresAtMs: BASE_TIME + 30_000,
		journal: legacyJournal,
	});
	const before = structuredClone([...factory.journals.entries()]);

	assert.deepEqual(await store.health(true), {
		healthy: false,
		status: 'unhealthy',
		reason: 'operation-failed',
	});
	assert.equal(store.getStartupFailureDetail(), 'legacy-task-adopt-journal-recovery-required');
	assert.deepEqual([...factory.journals.entries()], before);
});

test('a blocked upgrade times out and closes a later successful database handle', async () => {
	const factory = new BlockedThenLateSuccessIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-blocked-late-success',
		operationTimeoutMs: 100,
	});
	assert.deepEqual(await store.health(), {
		healthy: false,
		status: 'unhealthy',
		reason: 'operation-timeout',
	});
	factory.release();
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(factory.databaseClosed, true);
});

test('combined apply admission probes both stores and returns one scoped snapshot', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-combined-admission',
	});
	const value = receipt(41);
	await store.persist(value);
	const valueJournal = journal(41);
	assert.equal(await store.acquireJournal(valueJournal, LEASE_OWNER), true);
	factory.transactionCount = 0;
	factory.transactionLog.length = 0;

	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.deepEqual(admission.health, {
		healthy: true,
		status: 'healthy',
		reason: 'ready',
	});
	assert.deepEqual(admission.receipt, value);
	assert.notEqual(admission.receipt, value);
	assert.deepEqual(admission.journal, valueJournal);
	assert.ok(admission.admissionToken);
	assert.equal(factory.transactionCount, 1);
	assert.deepEqual(factory.transactionLog, [{
		stores: [
			'receipts',
			'graph-transaction-journals',
			'receipt-metadata',
			'security-audit-events',
		],
		mode: 'readwrite',
	}]);
	assert.equal(factory.records.has('0'.repeat(64)), false);
	assert.equal(factory.journals.has('0'.repeat(64)), false);
});

test('combined apply admission atomically prunes an expired exact receipt', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-combined-expired',
	});
	const expired = receipt(42);
	const live = receipt(43, BASE_TIME + 1_000);
	await store.persist(expired);
	await store.persist(live);
	now = BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1;
	factory.transactionCount = 0;

	const admission = await store.lookupForApplyAdmission(scope(expired));
	assert.equal(admission.health.healthy, true);
	assert.equal(admission.receipt, null);
	assert.equal(admission.journal, null);
	assert.equal(factory.transactionCount, 1);
	assert.equal(factory.records.size, 1);
	assert.deepEqual(await store.lookup(scope(live)), live);
});

test('combined apply admission fails closed on an unrelated corrupt receipt', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-combined-corruption',
	});
	const value = receipt(44);
	await store.persist(value);
	factory.records.set(sha256(98), {
		key: sha256(98),
		completedAtMs: BASE_TIME,
		expiresAtMs: BASE_TIME + MUTATION_RECEIPT_TTL_MS_V1,
		receipt: { ...receipt(98), planHash: 'not-a-digest' },
	});
	factory.transactionCount = 0;

	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.deepEqual(admission, {
		health: {
			healthy: false,
			status: 'unhealthy',
			reason: 'operation-failed',
		},
		receipt: null,
		journal: null,
		admissionToken: null,
	});
	assert.equal(factory.transactionCount, 1);
	assert.equal(factory.databaseClosed, true);
});

test('combined apply admission fails closed and rolls back a journal write-probe failure', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-combined-write-failure',
	});
	const value = receipt(45);
	await store.persist(value);
	const recordsBefore = structuredClone([...factory.records]);
	factory.failPutStoreName = 'graph-transaction-journals';

	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.deepEqual(admission, {
		health: {
			healthy: false,
			status: 'unhealthy',
			reason: 'operation-failed',
		},
		receipt: null,
		journal: null,
		admissionToken: null,
	});
	assert.deepEqual([...factory.records], recordsBefore);
	assert.equal(factory.records.has('0'.repeat(64)), false);
	assert.equal(factory.journals.has('0'.repeat(64)), false);
	assert.equal(factory.abortCount, 1);
});

test('combined apply admission times out atomically before exposing a scoped snapshot', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-combined-timeout',
		operationTimeoutMs: 100,
	});
	const value = receipt(46);
	await store.persist(value);
	const recordsBefore = structuredClone([...factory.records]);
	factory.hangPutStoreName = 'graph-transaction-journals';

	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.deepEqual(admission, {
		health: {
			healthy: false,
			status: 'unhealthy',
			reason: 'operation-timeout',
		},
		receipt: null,
		journal: null,
		admissionToken: null,
	});
	assert.deepEqual([...factory.records], recordsBefore);
	assert.equal(factory.records.has('0'.repeat(64)), false);
	assert.equal(factory.journals.has('0'.repeat(64)), false);
	assert.equal(factory.abortCount, 1);
	assert.equal(factory.databaseClosed, true);
});

test('combined apply admission fails closed on a corrupt exact journal', async () => {
	const factory = new FakeIndexedDbFactory();
	const timings: RuntimeTimingSpanV1[] = [];
	const timingSink: RuntimeTimingSinkV1 = {
		emit: value => timings.push(value),
	};
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-combined-journal-corruption',
	});
	const value = receipt(47);
	await store.persist(value);
	await store.acquireJournal(journal(47), LEASE_OWNER);
	const journalKey = [...factory.journals.keys()][0]!;
	const stored = factory.journals.get(journalKey) as {
		journal: GraphTransactionJournalV1;
	};
	factory.journals.set(journalKey, {
		...stored,
		journal: { ...stored.journal, planHash: 'not-a-digest' },
	});

	const admission = await store.lookupForApplyAdmission(
		scope(value),
		{
			requestId: 'receipt-corrupt-journal',
			timingSink,
			timingNow: () => BASE_TIME,
		},
	);
	assert.equal(admission.health.healthy, false);
	assert.equal(admission.health.reason, 'operation-failed');
	assert.equal(admission.receipt, null);
	assert.equal(admission.journal, null);
	assert.equal(
		timings.some(timing => timing.span === 'receipt-admission-probe-snapshot'),
		true,
	);
	assert.equal(
		timings.some(timing => timing.span === 'receipt-admission-commit'),
		false,
	);
});

test('admission token persists without a second receipt scan and is one-use', async () => {
	const factory = new FakeIndexedDbFactory();
	const timings: RuntimeTimingSpanV1[] = [];
	let timingValue = 0;
	const timingNow = () => {
		timingValue += 1;
		return timingValue;
	};
	const timingSink: RuntimeTimingSinkV1 = {
		emit: value => timings.push(value),
	};
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-fast-persist',
	});
	const value = receipt(48);
	const admission = await store.lookupForApplyAdmission(
		scope(value),
		{ requestId: 'receipt-fast-persist', timingSink, timingNow },
	);
	assert.ok(admission.admissionToken);
	assert.deepEqual(
		timings.map(timing => timing.span),
		[
			'receipt-admission-open',
			'receipt-admission-probe-snapshot',
			'receipt-admission-validate-prune',
			'receipt-admission-commit',
			'receipt-admission-clone',
		],
	);
	assert.equal(
		timings.every(timing => (
			timing.requestId === 'receipt-fast-persist'
			&& timing.flow === 'mutation-apply'
			&& Number.isFinite(timing.durationMs)
			&& timing.durationMs >= 0
		)),
		true,
	);
	factory.getAllCountByStore.clear();

	const result = await store.persistAfterApplyAdmission(value, admission.admissionToken);
	assert.deepEqual(result, { expiredDeleted: 0, overflowDeleted: 0, retained: 1 });
	assert.equal(factory.getAllCountByStore.get('receipts') ?? 0, 0);
	assert.deepEqual(
		timings.slice(5).map(timing => timing.span),
		[
			'receipt-terminal-metadata-journal',
			'receipt-terminal-generation-plan',
			'receipt-terminal-validate-prune',
			'receipt-terminal-commit',
		],
	);
	assert.deepEqual(await store.lookup(scope(value)), value);

	factory.getAllCountByStore.clear();
	await store.persistAfterApplyAdmission(
		receipt(48, BASE_TIME, { planHash: sha256(88) }),
		admission.admissionToken,
	);
	assert.equal(factory.getAllCountByStore.get('receipts'), 1);
});

test('a throwing receipt timing sink cannot change durable apply results', async () => {
	const factory = new FakeIndexedDbFactory();
	const timingSink: RuntimeTimingSinkV1 = {
		emit: () => {
			throw new Error('diagnostic sink failure');
		},
	};
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-timing-sink-isolated',
	});
	const value = receipt(481);
	const admission = await store.lookupForApplyAdmission(
		scope(value),
		{
			requestId: 'receipt-throwing-sink',
			timingSink,
			timingNow: () => BASE_TIME,
		},
	);
	assert.ok(admission.admissionToken);

	await store.persistAfterApplyAdmission(value, admission.admissionToken);
	assert.deepEqual(await store.lookup(scope(value)), value);
});

test('intervening store mutation invalidates generation and forces a full scan', async () => {
	const factory = new FakeIndexedDbFactory();
	const timings: RuntimeTimingSpanV1[] = [];
	const timingSink: RuntimeTimingSinkV1 = {
		emit: value => timings.push(value),
	};
	const first = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-intervening',
	});
	const second = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-intervening',
	});
	const candidate = receipt(50);
	const admission = await first.lookupForApplyAdmission(
		scope(candidate),
		{
			requestId: 'receipt-generation-fallback',
			timingSink,
			timingNow: () => BASE_TIME,
		},
	);
	assert.ok(admission.admissionToken);
	await second.persist(receipt(51));
	factory.getAllCountByStore.clear();

	await first.persistAfterApplyAdmission(candidate, admission.admissionToken);
	assert.equal(factory.getAllCountByStore.get('receipts'), 1);
	assert.equal(
		timings.filter(timing => timing.span === 'receipt-terminal-fallback-scan').length,
		1,
	);
	assert.equal(
		timings.every(timing => timing.requestId === 'receipt-generation-fallback'),
		true,
	);
	assert.deepEqual(await first.lookup(scope(candidate)), candidate);
	assert.deepEqual(await first.lookup(scope(receipt(51))), receipt(51));
});

test('same-count inter-instance replacement cannot preserve a stale fast path', async () => {
	const factory = new FakeIndexedDbFactory();
	const first = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-same-count',
	});
	const second = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-same-count',
	});
	const original = receipt(56);
	const replacement = receipt(57);
	const candidate = receipt(58);
	await first.persist(original);
	const admission = await first.lookupForApplyAdmission(scope(candidate));
	assert.ok(admission.admissionToken);
	assert.equal(await second.delete(scope(original)), true);
	await second.persist(replacement);
	assert.equal(factory.records.size, 1);
	factory.getAllCountByStore.clear();

	await first.persistAfterApplyAdmission(candidate, admission.admissionToken);
	assert.equal(factory.getAllCountByStore.get('receipts'), 1);
	assert.equal(await first.lookup(scope(original)), null);
	assert.deepEqual(await first.lookup(scope(replacement)), replacement);
	assert.deepEqual(await first.lookup(scope(candidate)), candidate);
});

test('forged or foreign-store admission tokens only receive the full-scan path', async () => {
	const factory = new FakeIndexedDbFactory();
	const first = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-token-auth',
	});
	const second = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-token-auth',
	});
	const foreignAdmission = await first.lookupForApplyAdmission(scope(receipt(59)));
	assert.ok(foreignAdmission.admissionToken);
	assert.equal((await second.health()).healthy, true);
	factory.getAllCountByStore.clear();
	await second.persistAfterApplyAdmission(receipt(59), foreignAdmission.admissionToken);
	assert.equal(factory.getAllCountByStore.get('receipts'), 1);

	factory.getAllCountByStore.clear();
	await first.persistAfterApplyAdmission(
		receipt(60),
		Object.freeze({}) as never,
	);
	assert.equal(factory.getAllCountByStore.get('receipts'), 1);

	const wrongScopeAdmission = await first.lookupForApplyAdmission(scope(receipt(61)));
	assert.ok(wrongScopeAdmission.admissionToken);
	factory.getAllCountByStore.clear();
	await first.persistAfterApplyAdmission(receipt(62), wrongScopeAdmission.admissionToken);
	assert.equal(factory.getAllCountByStore.get('receipts'), 1);
});

test('fast persist prunes a receipt that expires after admission', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-generation-expiry-crossing',
	});
	const expiring = receipt(52, BASE_TIME - MUTATION_RECEIPT_TTL_MS_V1 + 10);
	const candidate = receipt(53);
	await store.persist(expiring);
	const admission = await store.lookupForApplyAdmission(scope(candidate));
	assert.ok(admission.admissionToken);
	now = BASE_TIME + 10;
	factory.getAllCountByStore.clear();

	const result = await store.persistAfterApplyAdmission(candidate, admission.admissionToken);
	assert.equal(result.expiredDeleted, 1);
	assert.equal(factory.getAllCountByStore.get('receipts') ?? 0, 0);
	assert.equal(await store.lookup(scope(expiring)), null);
	assert.deepEqual(await store.lookup(scope(candidate)), candidate);
});

test('graph fast finalization is atomic and metadata failure rolls it back', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-graph-finalize',
	});
	const value = receipt(54);
	const valueJournal = journal(54);
	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.ok(admission.admissionToken);
	assert.equal(await store.acquireJournal(valueJournal, LEASE_OWNER), true);
	const metadataBefore = structuredClone([...factory.metadata]);
	factory.failPutStoreName = 'receipt-metadata';

	await assert.rejects(
		store.finalizeReceiptAfterApplyAdmission(
			value,
			valueJournal,
			LEASE_OWNER,
			admission.admissionToken,
		),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-unhealthy',
	);
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(factory.records.size, 0);
	assert.equal(factory.journals.size, 1);
	assert.deepEqual([...factory.metadata], metadataBefore);
});

test('graph fast finalization removes the journal without a receipt getAll', async () => {
	const factory = new FakeIndexedDbFactory();
	const timings: RuntimeTimingSpanV1[] = [];
	const timingSink: RuntimeTimingSinkV1 = {
		emit: value => timings.push(value),
	};
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-graph-fast',
	});
	const value = receipt(55);
	const valueJournal = journal(55);
	const admission = await store.lookupForApplyAdmission(
		scope(value),
		{
			requestId: 'receipt-graph-finalize',
			timingSink,
			timingNow: () => BASE_TIME,
		},
	);
	assert.ok(admission.admissionToken);
	assert.equal(await store.acquireJournal(valueJournal, LEASE_OWNER), true);
	factory.getAllCountByStore.clear();

	await store.finalizeReceiptAfterApplyAdmission(
		value,
		valueJournal,
		LEASE_OWNER,
		admission.admissionToken,
	);
	assert.equal(factory.getAllCountByStore.get('receipts') ?? 0, 0);
	assert.deepEqual(
		timings.slice(5).map(timing => timing.span),
		[
			'receipt-terminal-metadata-journal',
			'receipt-terminal-generation-plan',
			'receipt-terminal-validate-prune',
			'receipt-terminal-commit',
		],
	);
	assert.deepEqual(await store.lookup(scope(value)), value);
	assert.equal(await store.lookupJournal(scope(value)), null);
});

test('graph fast finalization preserves an exact journal on CAS mismatch', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-graph-cas',
	});
	const value = receipt(63);
	const valueJournal = journal(63);
	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.ok(admission.admissionToken);
	assert.equal(await store.acquireJournal(valueJournal, LEASE_OWNER), true);
	const staleJournal = { ...valueJournal, phase: 'committing' as const };

	await assert.rejects(
		store.finalizeReceiptAfterApplyAdmission(
			value,
			staleJournal,
			LEASE_OWNER,
			admission.admissionToken,
		),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	assert.equal(factory.records.size, 0);
	assert.deepEqual(await store.lookupJournal(scope(value)), valueJournal);
});

test('generation exhaustion aborts a fast persist without writing a receipt', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-exhaustion',
	});
	const value = receipt(64);
	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.ok(admission.admissionToken);
	const metadata = factory.metadata.get('receipt-generation') as {
		key: string;
		databaseEpoch: string;
		generation: number;
	};
	factory.metadata.set('receipt-generation', {
		...metadata,
		generation: Number.MAX_SAFE_INTEGER,
	});

	await assert.rejects(
		store.persistAfterApplyAdmission(value, admission.admissionToken),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-corrupt',
	);
	assert.equal(factory.records.size, 0);
});

test('missing or malformed receipt generation metadata fails closed', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-corrupt',
	});
	assert.equal((await store.health()).healthy, true);
	factory.metadata.set('receipt-generation', {
		key: 'receipt-generation',
		databaseEpoch: 'not-an-epoch',
		generation: 0,
	});
	assert.deepEqual(await store.health(true), {
		healthy: false,
		status: 'unhealthy',
		reason: 'operation-failed',
	});

	const extraFactory = new FakeIndexedDbFactory();
	const extraStore = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: extraFactory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-generation-extra-key',
	});
	assert.equal((await extraStore.health()).healthy, true);
	const metadata = extraFactory.metadata.get('receipt-generation') as Record<string, unknown>;
	extraFactory.metadata.set('receipt-generation', { ...metadata, extra: true });
	assert.equal((await extraStore.health(true)).healthy, false);
});

test('close is idempotent and permanently closes admission', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-close',
	});
	assert.equal((await store.health()).healthy, true);
	store.close();
	store.close();
	assert.deepEqual(await store.health(), {
		healthy: false,
		status: 'closed',
		reason: 'store-closed',
	});
	await assert.rejects(
		store.persist(receipt(1)),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-closed',
	);
	assert.equal(factory.databaseClosed, true);
});

test('graph journal is persisted before writes and advances without changing its binding', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-graph-journal',
	});
	const prepared = journal(1);
	assert.equal(await store.acquireJournal(prepared, LEASE_OWNER), true);
	const found = await store.lookupJournal(scope(receipt(1)));
	assert.deepEqual(found, prepared);
	assert.notEqual(found, prepared);

	const committing: GraphTransactionJournalV1 = {
		...prepared,
		phase: 'committing',
		completedStepCount: 1,
	};
	await store.persistJournal(committing, LEASE_OWNER);
	assert.deepEqual(await store.lookupJournal(scope(receipt(1))), committing);

	await assert.rejects(
		store.persistJournal({
			...committing,
			planHash: sha256(999),
		}, LEASE_OWNER),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	await assert.rejects(
		store.persistJournal({
			...committing,
			completedStepCount: 0,
		}, LEASE_OWNER),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
});

test('unresolved graph journal remains fenced beyond receipt TTL', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-graph-journal-durable-fence',
	});
	const value = journal(9);
	assert.equal(await store.acquireJournal(value, LEASE_OWNER), true);
	now += MUTATION_RECEIPT_TTL_MS_V1 * 30;
	assert.deepEqual(await store.lookupJournal(scope(receipt(9))), value);
	assert.equal((await store.health(true)).healthy, true);
	assert.deepEqual(await store.lookupJournal(scope(receipt(9))), value);
});

test('failed postflight can advance into compare-aware compensation', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-graph-postflight-compensation',
	});
	const prepared = journal(91);
	assert.equal(await store.acquireJournal(prepared, LEASE_OWNER), true);
	const committing: GraphTransactionJournalV1 = {
		...prepared,
		phase: 'committing',
		completedStepCount: 1,
	};
	await store.persistJournal(committing, LEASE_OWNER);
	const postflight: GraphTransactionJournalV1 = {
		...committing,
		phase: 'postflight',
	};
	await store.persistJournal(postflight, LEASE_OWNER);
	const compensating: GraphTransactionJournalV1 = {
		...postflight,
		phase: 'compensating',
	};
	await store.persistJournal(compensating, LEASE_OWNER);
	assert.deepEqual(await store.lookupJournal(scope(receipt(91))), compensating);
});

test('graph journal enforces the 8 MiB pre-write recovery bound', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-graph-journal-size',
	});
	const atLimit = journal(2);
	atLimit.steps[0]!.after.content = '';
	const baseBytes = new TextEncoder().encode(JSON.stringify(atLimit)).byteLength;
	atLimit.steps[0]!.after.content = 'x'.repeat(
		GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1 - baseBytes,
	);
	atLimit.steps[0]!.after.digest = sha256HexV1(atLimit.steps[0]!.after.content);
	assert.equal(
		new TextEncoder().encode(JSON.stringify(atLimit)).byteLength,
		GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1,
	);
	assert.equal(await store.acquireJournal(atLimit, LEASE_OWNER), true);
	assert.equal((await store.health(true)).healthy, true);
	assert.ok(await store.lookupJournal(scope(receipt(2))));

	const oversized = structuredClone(atLimit);
	const oversizedContent = `${oversized.steps[0]!.after.content ?? ''}x`;
	oversized.steps[0]!.after.content = oversizedContent;
	oversized.steps[0]!.after.digest = sha256HexV1(oversizedContent);
	await assert.rejects(
		store.persistJournal(oversized, LEASE_OWNER),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	assert.equal(factory.journals.size, 1);
	assert.equal(factory.records.size, 0);
});

test('graph journal enforces the 8 MiB bound again on persisted reads', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-graph-journal-read-size',
	});
	const value = journal(12);
	assert.equal(await store.acquireJournal(value, LEASE_OWNER), true);
	const [key, storedValue] = [...factory.journals.entries()][0]!;
	const stored = structuredClone(storedValue) as {
		journal: GraphTransactionJournalV1;
	};
	const oversizedContent = 'x'.repeat(GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1);
	stored.journal.steps[0]!.after.content = oversizedContent;
	stored.journal.steps[0]!.after.digest = sha256HexV1(oversizedContent);
	factory.journals.set(key, stored);
	await assert.rejects(
		store.lookupJournal(scope(receipt(12))),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-corrupt',
	);
});

test('receipt finalization atomically replaces the matching graph journal fence', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-graph-finalize',
	});
	const value = receipt(3);
	const fenced = journal(3);
	assert.equal(await store.acquireJournal(fenced, LEASE_OWNER), true);
	assert.equal(await store.hasUnresolvedGraphTransaction(), true);
	await store.finalizeReceipt(value, fenced, LEASE_OWNER);
	assert.deepEqual(await store.lookup(scope(value)), value);
	assert.equal(await store.lookupJournal(scope(value)), null);
	assert.equal(factory.records.size, 1);
	assert.equal(factory.journals.size, 0);
	assert.equal(await store.hasUnresolvedGraphTransaction(), false);

	const other = receipt(4);
	const otherJournal = journal(4);
	assert.equal(await store.acquireJournal(otherJournal, LEASE_OWNER), true);
	await assert.rejects(
		store.finalizeReceipt({
			...other,
			planHash: sha256(404),
		}, otherJournal, LEASE_OWNER),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	assert.equal(await store.lookup(scope(other)), null);
	assert.ok(await store.lookupJournal(scope(other)));
	assert.equal(await store.hasUnresolvedGraphTransaction(), true);
});

test('graph journal lease and exact-state CAS prevent concurrent or stale executors', async () => {
	const factory = new FakeIndexedDbFactory();
	let now = BASE_TIME;
	const firstStore = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-graph-lease',
	});
	const secondStore = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-graph-lease',
	});
	const prepared = journal(5);
	const receiptScope = scope(receipt(5));
	assert.equal(await firstStore.acquireJournal(prepared, 'executor-a'), true);
	assert.equal(await secondStore.acquireJournal(prepared, 'executor-b'), false);
	assert.equal(
		await secondStore.claimJournal(receiptScope, prepared, 'executor-b'),
		false,
	);

	now += 30_000;
	assert.equal(
		await secondStore.claimJournal(receiptScope, prepared, 'executor-b'),
		true,
	);
	const committing: GraphTransactionJournalV1 = {
		...prepared,
		phase: 'committing',
		completedStepCount: 1,
	};
	await secondStore.persistJournal(committing, 'executor-b');
	await assert.rejects(
		firstStore.persistJournal(committing, 'executor-a'),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	assert.equal(
		await firstStore.deleteJournal(receiptScope, prepared, 'executor-a'),
		false,
	);
	await assert.rejects(
		secondStore.finalizeReceipt(receipt(5), prepared, 'executor-b'),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-invalid-receipt',
	);
	await secondStore.finalizeReceipt(receipt(5), committing, 'executor-b');
	assert.equal(await secondStore.lookupJournal(receiptScope), null);
});

test('database upgrade adds the security audit store without losing receipts or journals', async () => {
	const factory = new FakeIndexedDbFactory(true);
	const receiptStore = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-upgrade',
	});
	const value = receipt(200);
	await receiptStore.persist(value);
	await receiptStore.acquireJournal(journal(200), LEASE_OWNER);

	const auditStore = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-upgrade',
	});
	await auditStore.append(auditEvent(200));
	assert.deepEqual(await receiptStore.lookup(scope(value)), value);
	assert.ok(await receiptStore.lookupJournal(scope(value)));
	assert.deepEqual(await auditStore.list(), [auditEvent(200)]);
});

test('security audit events reject extra fields and source-content-shaped metadata', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-privacy',
	});
	const unsafe = {
		...auditEvent(201),
		filePath: 'Tasks/Secret.md',
	} as unknown as SecurityAuditEventV1;
	await assert.rejects(
		store.append(unsafe),
		(error: unknown) => error instanceof SecurityAuditStoreErrorV1
			&& error.code === 'audit-store-invalid-event',
	);
	assert.equal(factory.audits.size, 0);
});

test('security audit rejects reuse of an existing event ID', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-event-id-reuse',
	});
	const event = auditEvent(209);
	await store.append(event);
	await assert.rejects(
		store.append(event),
		(error: unknown) => error instanceof SecurityAuditStoreErrorV1
			&& error.code === 'audit-store-invalid-event',
	);
	assert.deepEqual(await store.list(), [event]);
});

test('startup reconciliation finds grant intent without matching activation only', () => {
	const consumerIdentityHash = sha256(41_000);
	const intent = auditEvent(210, BASE_TIME, {
		event: 'grant-approved',
		consumerIdentityHash,
		grantRevision: 4,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'approved',
		admission: 'requested',
		outcome: 'pending',
	});
	const activation = auditEvent(211, BASE_TIME + 1, {
		...intent,
		eventId: sha256(40_211),
		occurredAt: new Date(BASE_TIME + 1).toISOString(),
		admission: 'completed',
		outcome: 'succeeded',
	});
	assert.deepEqual(findIncompleteDeveloperGrantAuditTransitionsV1([intent]), [{
		vaultIdentityHash: intent.vaultIdentityHash,
		consumerIdentityHash,
		revision: 4,
	}]);
	assert.deepEqual(
		findIncompleteDeveloperGrantAuditTransitionsV1([intent, activation]),
		[],
	);
	assert.deepEqual(
		findIncompleteDeveloperGrantAuditTransitionsV1([activation, intent]),
		[],
		'IndexedDB returns newest audit events first, so reconciliation must be order-independent.',
	);
});

test('startup reconciliation preserves a repeated unresolved grant intent at the same revision', () => {
	const consumerIdentityHash = sha256(41_100);
	const firstIntent = auditEvent(212, BASE_TIME, {
		event: 'grant-requested',
		consumerIdentityHash,
		grantRevision: 5,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'not-required',
		admission: 'requested',
		outcome: 'pending',
	});
	const activation = auditEvent(213, BASE_TIME, {
		...firstIntent,
		eventId: sha256(40_213),
		admission: 'completed',
		outcome: 'succeeded',
	});
	const interruptedRetry = auditEvent(214, BASE_TIME, {
		...firstIntent,
		eventId: sha256(40_214),
	});
	const expected = [{
		vaultIdentityHash: firstIntent.vaultIdentityHash,
		consumerIdentityHash,
		revision: 5,
	}];
	assert.deepEqual(
		findIncompleteDeveloperGrantAuditTransitionsV1([
			firstIntent,
			activation,
			interruptedRetry,
		]),
		expected,
	);
	assert.deepEqual(
		findIncompleteDeveloperGrantAuditTransitionsV1([
			interruptedRetry,
			activation,
			firstIntent,
		]),
		expected,
		'Random eventId order at one millisecond must not hide an unmatched retry.',
	);
});

test('startup reconciliation keeps otherwise identical vault transitions isolated', () => {
	const consumerIdentityHash = sha256(41_150);
	const firstVault = auditEvent(215, BASE_TIME, {
		event: 'grant-approved',
		consumerIdentityHash,
		grantRevision: 5,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'approved',
		admission: 'requested',
		outcome: 'pending',
	});
	const secondVault = {
		...firstVault,
		eventId: sha256(40_216),
		vaultIdentityHash: sha256(44_001),
	};
	const unknownVault = {
		...firstVault,
		eventId: sha256(40_217),
		vaultIdentityHash: null,
	};
	assert.deepEqual(findIncompleteDeveloperGrantAuditTransitionsV1([
		firstVault,
		secondVault,
		unknownVault,
	]), [
		{
			vaultIdentityHash: null,
			consumerIdentityHash,
			revision: 5,
		},
		{
			vaultIdentityHash: firstVault.vaultIdentityHash,
			consumerIdentityHash,
			revision: 5,
		},
		{
			vaultIdentityHash: secondVault.vaultIdentityHash,
			consumerIdentityHash,
			revision: 5,
		},
	]);
	assert.deepEqual(findIncompleteDeveloperGrantAuditTransitionsForVaultV1(
		[firstVault, secondVault, unknownVault],
		firstVault.vaultIdentityHash!,
	), [{
		vaultIdentityHash: firstVault.vaultIdentityHash,
		consumerIdentityHash,
		revision: 5,
	}]);
});

test('security audit retention enforces 30 days and the newest 2048 records', async () => {
	const factory = new FakeIndexedDbFactory();
	const now = BASE_TIME + SECURITY_AUDIT_RETENTION_MS_V1;
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-audit-retention',
	});
	await store.health();
	const expired = auditEvent(202, BASE_TIME);
	factory.audits.set(expired.eventId, {
		key: expired.eventId,
		occurredAtMs: BASE_TIME,
		expiresAtMs: BASE_TIME + SECURITY_AUDIT_RETENTION_MS_V1,
		event: expired,
	});
	for (let index = 0; index < SECURITY_AUDIT_MAX_RECORDS_V1; index += 1) {
		const event = auditEvent(1_000 + index, now + index + 1);
		factory.audits.set(event.eventId, {
			key: event.eventId,
			occurredAtMs: now + index + 1,
			expiresAtMs: now + index + 1 + SECURITY_AUDIT_RETENTION_MS_V1,
			event,
		});
	}
	const newest = auditEvent(9_000, now + SECURITY_AUDIT_MAX_RECORDS_V1 + 1);
	const result = await store.append(newest);
	assert.deepEqual(result, {
		expiredDeleted: 1,
		overflowDeleted: 1,
		retained: SECURITY_AUDIT_MAX_RECORDS_V1,
	});
	assert.equal((await store.list()).length, SECURITY_AUDIT_MAX_RECORDS_V1);
	assert.equal(factory.audits.has(expired.eventId), false);
	assert.equal(factory.audits.has(newest.eventId), true);
});

test('security audit retention keeps equal-time grant transitions atomic and preserves an incomplete group', async () => {
	const factory = new FakeIndexedDbFactory();
	const now = BASE_TIME + 10_000;
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-audit-grant-overflow',
	});
	await store.health();
	const consumerIdentityHash = sha256(41_200);
	const intent = auditEvent(301, now + 1, {
		event: 'grant-requested',
		consumerIdentityHash,
		grantRevision: 6,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'not-required',
		admission: 'requested',
		outcome: 'pending',
	});
	const completion = auditEvent(9_301, now + 1, {
		...intent,
		eventId: sha256(9_301),
		admission: 'completed',
		outcome: 'succeeded',
	});
	const interrupted = auditEvent(302, now + 1, {
		...intent,
		eventId: sha256(302),
		correlationHash: sha256(45_302),
	});
	for (const event of [intent, completion, interrupted]) {
		factory.audits.set(event.eventId, {
			key: event.eventId,
			occurredAtMs: now + 1,
			expiresAtMs: now + 1 + SECURITY_AUDIT_RETENTION_MS_V1,
			event,
		});
	}
	for (let index = 0; index < SECURITY_AUDIT_MAX_RECORDS_V1 - 2; index += 1) {
		const event = auditEvent(20_000 + index, now + index + 2);
		factory.audits.set(event.eventId, {
			key: event.eventId,
			occurredAtMs: now + index + 2,
			expiresAtMs: now + index + 2 + SECURITY_AUDIT_RETENTION_MS_V1,
			event,
		});
	}

	const retained = await store.list();

	assert.equal(retained.length, SECURITY_AUDIT_MAX_RECORDS_V1 - 1);
	assert.equal(retained.some(event => event.eventId === intent.eventId), false);
	assert.equal(retained.some(event => event.eventId === completion.eventId), false);
	assert.equal(retained.some(event => event.eventId === interrupted.eventId), true);
	assert.deepEqual(findIncompleteDeveloperGrantAuditTransitionsV1(retained), [{
		vaultIdentityHash: interrupted.vaultIdentityHash,
		consumerIdentityHash,
		revision: 6,
	}]);
});

test('security audit retention keeps legacy one-phase correlations per-record at overflow', async () => {
	const factory = new FakeIndexedDbFactory();
	const now = BASE_TIME + 20_000;
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-audit-legacy-overflow',
	});
	await store.health();
	const consumerIdentityHash = sha256(41_300);
	const legacyIntentHash = sha256(45_400);
	const firstIntent = auditEvent(401, now + 1, {
		event: 'grant-requested',
		consumerIdentityHash,
		grantRevision: 7,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'not-required',
		admission: 'requested',
		outcome: 'pending',
		correlationHash: legacyIntentHash,
	});
	const completion = auditEvent(402, now + 1, {
		...firstIntent,
		eventId: sha256(402),
		admission: 'completed',
		outcome: 'succeeded',
		correlationHash: sha256(45_401),
	});
	const interrupted = auditEvent(403, now + 1, {
		...firstIntent,
		eventId: sha256(403),
	});
	for (const event of [firstIntent, completion, interrupted]) {
		factory.audits.set(event.eventId, {
			key: event.eventId,
			occurredAtMs: now + 1,
			expiresAtMs: now + 1 + SECURITY_AUDIT_RETENTION_MS_V1,
			event,
		});
	}
	for (let index = 0; index < SECURITY_AUDIT_MAX_RECORDS_V1 - 1; index += 1) {
		const event = auditEvent(30_000 + index, now + index + 2);
		factory.audits.set(event.eventId, {
			key: event.eventId,
			occurredAtMs: now + index + 2,
			expiresAtMs: now + index + 2 + SECURITY_AUDIT_RETENTION_MS_V1,
			event,
		});
	}

	const retained = await store.list();

	assert.equal(retained.length, SECURITY_AUDIT_MAX_RECORDS_V1);
	assert.equal(retained.some(event => event.eventId === completion.eventId), false);
	assert.equal(
		retained.some(event => (
			event.eventId === firstIntent.eventId || event.eventId === interrupted.eventId
		)),
		true,
	);
	assert.deepEqual(findIncompleteDeveloperGrantAuditTransitionsV1(retained), [{
		vaultIdentityHash: interrupted.vaultIdentityHash,
		consumerIdentityHash,
		revision: 7,
	}]);
});

test('security audit retention preserves an expired incomplete grant intent until completion', async () => {
	const factory = new FakeIndexedDbFactory();
	const now = BASE_TIME + SECURITY_AUDIT_RETENTION_MS_V1 + 1;
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => now,
		databaseName: 'receipt-test-audit-expired-incomplete-grant',
	});
	const intent = auditEvent(404, BASE_TIME, {
		event: 'grant-approved',
		grantRevision: 8,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'approved',
		admission: 'requested',
		outcome: 'pending',
	});
	await store.append(intent);
	assert.deepEqual(await store.list(), [intent]);

	const completion = {
		...intent,
		eventId: sha256(40_405),
		admission: 'completed' as const,
		outcome: 'succeeded' as const,
	};
	await store.append(completion);
	assert.deepEqual(await store.list(), []);
});

test('clearing the security audit log atomically retains only the clear marker', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-clear',
	});
	await store.append(auditEvent(203));
	await store.append(auditEvent(204, BASE_TIME + 1));
	const marker = auditEvent(205, BASE_TIME + 2, {
		event: 'audit-cleared',
		capability: null,
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		vaultIdentityHash: null,
		consent: 'approved',
		admission: 'completed',
		outcome: 'succeeded',
	});
	await store.clear(marker);
	assert.deepEqual(await store.list(), [marker]);
});

test('clearing the security audit preserves an incomplete grant intent as recovery evidence', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbSecurityAuditStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME + 10,
		databaseName: 'receipt-test-audit-clear-incomplete-grant',
	});
	const intent = auditEvent(406, BASE_TIME, {
		event: 'grant-approved',
		grantRevision: 9,
		capability: 'tasks.read',
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		consent: 'approved',
		admission: 'requested',
		outcome: 'pending',
	});
	await store.append(intent);
	const marker = auditEvent(407, BASE_TIME + 10, {
		event: 'audit-cleared',
		capability: null,
		mutationKind: null,
		risk: null,
		planDigest: null,
		targetDigest: null,
		vaultIdentityHash: null,
		consent: 'approved',
		admission: 'completed',
		outcome: 'succeeded',
	});
	await store.clear(marker);
	assert.deepEqual(await store.list(), [marker, intent]);
	assert.deepEqual(findIncompleteDeveloperGrantAuditTransitionsV1(await store.list()), [{
		vaultIdentityHash: intent.vaultIdentityHash,
		consumerIdentityHash: intent.consumerIdentityHash,
		revision: intent.grantRevision,
	}]);
});

test('terminal receipt and audit finalization commits atomically', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-atomic-terminal',
	});
	const value = receipt(206);
	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.ok(admission.admissionToken);
	await store.persistWithSecurityAuditAfterApplyAdmission(
		value,
		auditEvent(206),
		admission.admissionToken,
	);
	assert.deepEqual(await store.lookup(scope(value)), value);
	assert.ok(factory.audits.has(auditEvent(206).eventId));
});

test('terminal audit failure rolls back the matching receipt', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-audit-atomic-failure',
	});
	const value = receipt(207);
	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.ok(admission.admissionToken);
	factory.failPutStoreName = 'security-audit-events';
	await assert.rejects(
		store.persistWithSecurityAuditAfterApplyAdmission(
			value,
			auditEvent(207),
			admission.admissionToken,
		),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1
			&& error.code === 'receipt-store-unhealthy',
	);
	assert.equal(factory.records.size, 0);
	assert.equal(factory.audits.size, 0);
});

test('graph terminal finalization atomically removes its journal and writes audit', async () => {
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({
		indexedDBFactory: factory as unknown as IDBFactory,
		now: () => BASE_TIME,
		databaseName: 'receipt-test-graph-audit-atomic',
	});
	const value = receipt(208);
	const prepared = journal(208);
	await store.acquireJournal(prepared, LEASE_OWNER);
	const admission = await store.lookupForApplyAdmission(scope(value));
	assert.ok(admission.admissionToken);
	await store.finalizeReceiptWithSecurityAuditAfterApplyAdmission(
		value,
		prepared,
		LEASE_OWNER,
		auditEvent(208),
		admission.admissionToken,
	);
	assert.deepEqual(await store.lookup(scope(value)), value);
	assert.equal(await store.lookupJournal(scope(value)), null);
	assert.ok(factory.audits.has(auditEvent(208).eventId));
});

class ThrowingIndexedDbFactory {
	open(): IDBOpenDBRequest {
		throw new Error('Injected open failure.');
	}
}

class BlockedThenLateSuccessIndexedDbFactory {
	databaseClosed = false;
	private request: FakeOpenRequest | null = null;

	open(): IDBOpenDBRequest {
		const request = new FakeOpenRequest();
		this.request = request;
		queueMicrotask(() => request.onblocked?.call(
			request as unknown as IDBOpenDBRequest,
			new Event('blocked') as IDBVersionChangeEvent,
		));
		return request as unknown as IDBOpenDBRequest;
	}

	release(): void {
		if (!this.request) throw new Error('No blocked open request.');
		this.request.result = {
			close: () => {
				this.databaseClosed = true;
			},
		} as IDBDatabase;
		this.request.onsuccess?.call(
			this.request as unknown as IDBRequest<IDBDatabase>,
			new Event('success'),
		);
	}
}

interface FakeStoredRecord {
	key: string;
	completedAtMs: number;
	expiresAtMs: number;
	receipt: MutationReceiptV1;
}

class FakeIndexedDbFactory {
	readonly records = new Map<string, FakeStoredRecord>();
	readonly journals = new Map<string, unknown>();
	readonly metadata = new Map<string, unknown>();
	readonly audits = new Map<string, unknown>();
	readonly transactionLog: Array<{ stores: string[]; mode: IDBTransactionMode }> = [];
	readonly getAllCountByStore = new Map<string, number>();
	databaseClosed = false;
	transactionCount = 0;
	abortCount = 0;
	failPutStoreName: string | null = null;
	hangPutStoreName: string | null = null;
	private database: FakeDatabase | null = null;

	constructor(legacyReceiptStore: boolean = false) {
		if (!legacyReceiptStore) return;
		this.database = new FakeDatabase(this);
		this.database.version = 1;
		this.database.createObjectStore('receipts');
	}

	open(_name: string, version: number = 1): IDBOpenDBRequest {
		const request = new FakeOpenRequest();
		queueMicrotask(() => {
			const upgrade = this.database === null || version > this.database.version;
			this.database ??= new FakeDatabase(this);
			this.database.version = version;
			request.result = this.database as unknown as IDBDatabase;
			if (upgrade) {
				request.onupgradeneeded?.call(
					request as unknown as IDBOpenDBRequest,
					new Event('upgradeneeded') as IDBVersionChangeEvent,
				);
			}
			request.onsuccess?.call(request as unknown as IDBRequest<IDBDatabase>, new Event('success'));
		});
		return request as unknown as IDBOpenDBRequest;
	}
}

class FakeDatabase {
	version = 1;
	onversionchange: ((this: IDBDatabase, event: IDBVersionChangeEvent) => unknown) | null = null;
	readonly objectStoreNames = {
		contains: (name: string) => this.stores.has(name),
	} as DOMStringList;
	private readonly stores = new Set<string>();

	constructor(private readonly factory: FakeIndexedDbFactory) {}

	createObjectStore(name: string): IDBObjectStore {
		if (
			name !== 'receipts'
			&& name !== 'graph-transaction-journals'
			&& name !== 'receipt-metadata'
			&& name !== 'security-audit-events'
		) {
			throw new Error('Unexpected store name.');
		}
		this.stores.add(name);
		const records = name === 'receipts'
			? this.factory.records as Map<string, unknown>
			: name === 'graph-transaction-journals'
				? this.factory.journals
				: name === 'receipt-metadata'
					? this.factory.metadata
					: this.factory.audits;
		return {
			keyPath: 'key',
			put: (value: { key: string }) => {
				records.set(value.key, structuredClone(value));
				return {} as IDBRequest<IDBValidKey>;
			},
		} as IDBObjectStore;
	}

	transaction(
		name: string | string[],
		mode: IDBTransactionMode = 'readonly',
	): IDBTransaction {
		this.factory.transactionCount += 1;
		const names = Array.isArray(name) ? name : [name];
		this.factory.transactionLog.push({ stores: [...names], mode });
		if (names.some(storeName => !this.stores.has(storeName))) {
			throw new Error('Receipt store is missing.');
		}
		return new FakeTransaction(new Map([
			['receipts', this.factory.records as Map<string, unknown>],
			['graph-transaction-journals', this.factory.journals],
			['receipt-metadata', this.factory.metadata],
			['security-audit-events', this.factory.audits],
		]), this.factory) as unknown as IDBTransaction;
	}

	close(): void {
		this.factory.databaseClosed = true;
	}
}

class FakeRequest<T> {
	result!: T;
	error: DOMException | null = null;
	onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
	onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
}

class FakeOpenRequest extends FakeRequest<IDBDatabase> {
	onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null = null;
	onblocked: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null = null;
}

class FakeTransaction {
	error: DOMException | null = null;
	oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
	onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
	onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
	private pending = 0;
	private completionScheduled = false;
	private finished = false;
	private aborted = false;
	private readonly before = new Map<string, Map<string, unknown>>();

	constructor(
		private readonly stores: Map<string, Map<string, unknown>>,
		private readonly factory: FakeIndexedDbFactory,
	) {
		for (const [name, records] of stores) this.before.set(name, new Map(records));
	}

	objectStore(name: string): IDBObjectStore {
		if (!this.stores.has(name)) throw new Error(`Unknown object store: ${name}`);
		return new FakeObjectStore(this, name) as unknown as IDBObjectStore;
	}

	abort(): void {
		if (this.aborted) return;
		if (this.finished) throw new DOMException('Transaction is inactive.', 'InvalidStateError');
		this.factory.abortCount += 1;
		this.aborted = true;
		this.finished = true;
		for (const [name, records] of this.stores) {
			records.clear();
			for (const [key, value] of this.before.get(name) ?? []) records.set(key, value);
		}
		queueMicrotask(() => this.onabort?.call(
			this as unknown as IDBTransaction,
			new Event('abort'),
		));
	}

	request<T>(operation: () => T): IDBRequest<T> {
		const request = new FakeRequest<T>();
		this.pending += 1;
		queueMicrotask(() => {
			if (this.aborted) return;
			try {
				request.result = operation();
				request.onsuccess?.call(request as unknown as IDBRequest<T>, new Event('success'));
			} catch (error) {
				request.error = new DOMException(String(error), 'UnknownError');
				request.onerror?.call(request as unknown as IDBRequest<T>, new Event('error'));
				this.abort();
				return;
			} finally {
				this.pending -= 1;
				this.scheduleCompletion();
			}
		});
		return request as unknown as IDBRequest<T>;
	}

	hangingRequest<T>(): IDBRequest<T> {
		this.pending += 1;
		return new FakeRequest<T>() as unknown as IDBRequest<T>;
	}

	cursor(name: string): IDBRequest<IDBCursorWithValue | null> {
		const request = new FakeRequest<IDBCursorWithValue | null>();
		const values = [...this.mutableRecords(name).values()].map(value => structuredClone(value));
		let index = 0;
		this.pending += 1;
		const advance = () => {
			queueMicrotask(() => {
				if (this.aborted) return;
				if (index >= values.length) {
					request.result = null;
					request.onsuccess?.call(
						request as unknown as IDBRequest<IDBCursorWithValue | null>,
						new Event('success'),
					);
					this.pending -= 1;
					this.scheduleCompletion();
					return;
				}
				let continued = false;
				request.result = {
					value: values[index],
					continue: () => {
						continued = true;
						index += 1;
						advance();
					},
				} as IDBCursorWithValue;
				request.onsuccess?.call(
					request as unknown as IDBRequest<IDBCursorWithValue | null>,
					new Event('success'),
				);
				if (!continued) {
					this.pending -= 1;
					this.scheduleCompletion();
				}
			});
		};
		advance();
		return request as unknown as IDBRequest<IDBCursorWithValue | null>;
	}

	shouldFailPut(name: string): boolean {
		return this.factory.failPutStoreName === name;
	}

	shouldHangPut(name: string): boolean {
		return this.factory.hangPutStoreName === name;
	}

	recordGetAll(name: string): void {
		this.factory.getAllCountByStore.set(
			name,
			(this.factory.getAllCountByStore.get(name) ?? 0) + 1,
		);
	}

	private scheduleCompletion(): void {
		if (this.completionScheduled || this.finished || this.pending !== 0) return;
		this.completionScheduled = true;
		setTimeout(() => {
			this.completionScheduled = false;
			if (this.finished || this.pending !== 0) return;
			this.finished = true;
			this.oncomplete?.call(this as unknown as IDBTransaction, new Event('complete'));
		}, 0);
	}

	mutableRecords(name: string): Map<string, unknown> {
		const records = this.stores.get(name);
		if (!records) throw new Error(`Unknown object store: ${name}`);
		return records;
	}
}

class FakeObjectStore {
	constructor(
		private readonly transaction: FakeTransaction,
		private readonly name: string,
	) {}

	readonly keyPath = 'key';

	count(): IDBRequest<number> {
		return this.transaction.request(() => this.transaction.mutableRecords(this.name).size);
	}

	get(key: IDBValidKey): IDBRequest<unknown> {
		return this.transaction.request(() => {
			const value = this.transaction.mutableRecords(this.name).get(String(key));
			return value ? structuredClone(value) : undefined;
		});
	}

	getKey(key: IDBValidKey): IDBRequest<IDBValidKey | undefined> {
		return this.transaction.request(() => (
			this.transaction.mutableRecords(this.name).has(String(key)) ? key : undefined
		));
	}

	getAll(): IDBRequest<unknown[]> {
		this.transaction.recordGetAll(this.name);
		return this.transaction.request(() => (
			[...this.transaction.mutableRecords(this.name).values()]
				.map(value => structuredClone(value))
		));
	}

	openCursor(): IDBRequest<IDBCursorWithValue | null> {
		return this.transaction.cursor(this.name);
	}

	put(value: { key: string }): IDBRequest<IDBValidKey> {
		if (this.transaction.shouldHangPut(this.name)) {
			return this.transaction.hangingRequest<IDBValidKey>();
		}
		return this.transaction.request(() => {
			if (this.transaction.shouldFailPut(this.name)) {
				throw new Error(`Injected put failure for ${this.name}.`);
			}
			this.transaction.mutableRecords(this.name).set(value.key, structuredClone(value));
			return value.key;
		});
	}

	delete(key: IDBValidKey): IDBRequest<undefined> {
		return this.transaction.request(() => {
			this.transaction.mutableRecords(this.name).delete(String(key));
			return undefined;
		});
	}
}


test('transaction identifiers preserve short values and bound complete prefixed identities', () => {
	for (const size of [127, 128, 129, 4096]) {
		const identity = 'source:' + 'a'.repeat(size - 7);
		const bounded = boundRuntimeTransactionIdV1(identity);
		assert.equal(bounded, size <= 128 ? identity : `sha256:${sha256HexV1(identity)}`);
		assert.ok(bounded.length <= 128);
		assert.equal(boundRuntimeTransactionIdV1(bounded), bounded);
	}
	const path = 'Ü/😀/'.repeat(40) + 'Task.md';
	const inputs = [`source:${path}`, `source:${path}x`, `task-source:${path}`, `timer-control:start-source:${path}`, `timer-control:stop-source:${path}`];
	assert.equal(new Set(inputs.map(boundRuntimeTransactionIdV1)).size, inputs.length);
	assert.ok(inputs.every(value => boundRuntimeTransactionIdV1(value).length <= 128));
});

const transactionIdRevision: ContextRevisionV1 = {
	index: { sessionId: 'transaction-id-fixture', ramGeneration: 1, durable: { status: 'missing' } },
	settingsFingerprint: sha256(900), pinnedGeneration: 0, activeTrackerGeneration: 0,
	repeatSeriesRevision: 0, projectSerialGeneration: 0, projectSerialSignature: sha256(901),
};

for (const representation of ['inline', 'file'] as const) {
	for (const pathLength of [8, 116, 117, 143, 4096]) {
		test(`long-path ${representation} creation ${pathLength}: production preparation, journal, recovery and replay agree`, async () => {
			const filePath = 'T'.repeat(pathLength - 3) + '.md';
			const now = BASE_TIME;
			let content: string | null = representation === 'file' ? null : '# Tasks\n';
			let writes = 0;
			let sequence = 0;
			const factory = new FakeIndexedDbFactory();
			const store = new IndexedDbMutationReceiptStoreV1({ indexedDBFactory: factory as unknown as IDBFactory, now: () => now });
			const request: MutationPreviewRequestV1 = {
				contractVersion: 1, requestId: 'bounded-create-preview', kind: 'mutation-preview',
				clientInstanceId: 'bounded-client', idempotencyKey: 'bounded-create-key',
				capability: 'tasks.create.preview', mutationKind: 'task.create',
				authorization: { basis: 'user-explicit-request' },
				spec: { operation: 'create', items: [{ itemRef: 'one', description: 'Bounded task',
					target: { mode: 'exact-path', representation, filePath }, fields: [], tags: [] }] },
			};
			const gateway = new RuntimeMutationGatewayV1({
				isReady: () => true, sampleContextRevision: () => transactionIdRevision,
				prepareCreation: async (requestId, spec, ids, effectiveAt) => {
					return await prepareRuntimeTaskCreationV1(requestId, spec, {
						settings: () => DEFAULT_SETTINGS, listOperonIds: () => new Set(),
						listDependencyGraphTasks: () => [], getExistingTask: () => null,
						readSource: async path => ({ filePath: path, content }),
						resolveConfiguredInlineTarget: async () => ({ filePath, placement: { kind: 'append' } }),
						resolveConfiguredFilePath: async () => filePath, readTemplate: async () => null,
						creationFieldCatalog: () => [], resolveCoreTemplateVariables: text => text,
						generateOperonId: () => 'bnd0001', now: () => '2026-07-24T10:00:00',
					}, ids, effectiveAt);
				},
				commitCreation: async () => { throw new Error('Unexpected unjournaled write'); },
				prepareCreationTransaction: runtimeTransactionPort('prepareCreationTransaction', {}, {
					aggregateCoordinator: { planCreationAggregatePatches: () => [] },
				}),
				commitCreationTransaction: async (_prepared, _at, value, checkpoint) => {
					// Frozen from the pre-fix production ports; short sealed identities must remain exact.
					if (pathLength === 8) assert.equal(JSON.stringify(value), JSON.stringify(legacyTransactionIdentifiers[representation].journal));
					assert.equal(value.steps.length, 1);
					const step = value.steps[0];
					assert.equal(step.resourceKey, filePath);
					assert.equal(step.groupId, boundRuntimeTransactionIdV1(`task-source:${filePath}`));
					assert.ok(step.stepId.length <= 128);
					assert.equal(content, step.before.content);
					content = step.after.content;
					writes++;
					await checkpoint({ phase: 'committing', completedStepCount: 1 });
					throw new Error('Interrupted after source write');
				},
				recoverCreationTransaction: async (input, value) => ({
					status: 'forward-completed', verified: content === value.steps[0].after.content,
					affectedFilePaths: [filePath],
					groupResults: [{ groupId: input.plan.atomicGroups[0].groupId, status: 'committed', resourceRevisions: [{
						resourceKind: 'task-source', resourceKey: filePath, revision: sha256HexV1(content ?? ''),
					}] }],
				}),
				verifyCreationTransactionState: async (value, expected) => content === value.steps[0][expected].content,
				reindexAffectedSources: async () => undefined, settleAfterMutation: async () => undefined,
				reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
				verifyCreatedTasks: async () => true, receiptStore: () => store,
				vaultIdentityHash: async () => sha256(902), nowEpochMs: () => now,
				randomId: () => `bounded-${++sequence}`,
			});
			const preview = await gateway.preview(request);
			assert.equal(preview.ok, true, JSON.stringify(preview));
			assert.equal(decodeMutationPreviewResultV1(preview).ok, true);
			if (!preview.ok) return;
			assert.equal(preview.plan.atomicGroups[0].groupId, boundRuntimeTransactionIdV1(`task-source:${filePath}`));
			if (pathLength === 8) assert.equal(JSON.stringify(preview.plan), JSON.stringify(legacyTransactionIdentifiers[representation].plan));
			const sealed = JSON.stringify(preview.plan);
			const apply = { contractVersion: 1 as const, requestId: 'bounded-apply', kind: 'mutation-apply' as const,
				plan: preview.plan, idempotencyKey: request.idempotencyKey,
				authorization: { basis: 'user-explicit-request' as const }, acknowledgements: [] };
			const interrupted = await gateway.apply(apply);
			assert.equal(interrupted.status, 'outcome-unknown', JSON.stringify(interrupted));
			assert.equal(writes, 1);
			assert.equal(factory.journals.size, 1);
			assert.equal(now, BASE_TIME); // Same executor must recover without waiting for its lease.
			const recovered = await gateway.apply({ ...apply, requestId: 'bounded-recover' });
			assert.equal(recovered.status, 'applied', JSON.stringify(recovered));
			assert.equal(decodeMutationResultV1(recovered).ok, true);
			assert.equal(recovered.groupResults[0].groupId, preview.plan.atomicGroups[0].groupId);
			assert.equal((await gateway.apply({ ...apply, requestId: 'bounded-replay' })).status, 'already-applied');
			assert.equal(writes, 1);
			assert.equal(factory.journals.size, 0);
			assert.equal(JSON.stringify(preview.plan), sealed);
		});
	}
}

for (const field of ['stepId', 'groupId'] as const) {
	test(`invalid journal ${field} is rejected before storage acquisition`, async () => {
		const factory = new FakeIndexedDbFactory();
		const store = new IndexedDbMutationReceiptStoreV1({ indexedDBFactory: factory as unknown as IDBFactory, now: () => BASE_TIME });
		const invalid = journal(2);
		invalid.steps[0][field] = 'x'.repeat(129);
		await assert.rejects(store.acquireJournal(invalid, LEASE_OWNER), (error: unknown) =>
			error instanceof MutationReceiptStoreErrorV1 && error.code === 'receipt-store-invalid-receipt');
		assert.equal(factory.journals.size, 0);
		assert.equal(factory.records.size, 0);
		assert.equal(await store.acquireJournal(journal(2), LEASE_OWNER), true);
	});
}

for (const pathLength of [115, 116]) {
	test(`legacy periodic preview group at path ${pathLength} stays unchanged beyond the journal ID limit`, () => {
		const notePath = 'P'.repeat(pathLength - 3) + '.md';
		const build = runtimeMainMethod('buildAgentRuntimePeriodicPlanCandidate', {
			buildIdentityPlaceholderCreateEffectsV1: () => [], computeReceiptTargetDigestV1: () => sha256(1),
		});
		const result = build(
			{ requestId: 'periodic-legacy', clientInstanceId: 'client', idempotencyKey: 'key', spec: {} },
			{ plan: { sourceGroups: [{ filePath: notePath, expectedRevision: sha256(2) }] }, createEffects: [] },
			{ notePath, periodicKind: 'daily', noteExpectedState: 'present', container: { registryState: 'existing' } },
			transactionIdRevision, '2026-07-24T10:00:00.000Z', 'periodic-plan', [],
		) as { plan: { atomicGroups: Array<{ groupId: string }> } };
		assert.equal(result.plan.atomicGroups[0].groupId, `periodic-note:${notePath}`);
		assert.ok(result.plan.atomicGroups[0].groupId.length > 128);
		assert.equal(boundRuntimeTransactionIdV1(`task-source:${notePath}`), `task-source:${notePath}`);
	});
}

async function samePlanLeaseFixture() {
	let now = BASE_TIME;
	let content = 'before';
	let writes = 0;
	let recoveries = 0;
	let holdCommit: Promise<void> = Promise.resolve();
	let failCheckpoint = false;
	let failFinalize = false;
	let sequence = 0;
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({ indexedDBFactory: factory as unknown as IDBFactory, now: () => now });
	const persist = store.persistJournal.bind(store);
	store.persistJournal = async (...args) => {
		if (failCheckpoint) { failCheckpoint = false; throw new Error('Injected checkpoint failure'); }
		return await persist(...args);
	};
	const finalize = store.finalizeReceiptAfterApplyAdmission.bind(store);
	store.finalizeReceiptAfterApplyAdmission = async (...args) => {
		if (failFinalize) { failFinalize = false; throw new Error('Injected finalization failure'); }
		return await finalize(...args);
	};
	const filePath = 'Lease.md';
	const groupId = `task-source:${filePath}`;
	const steps: GraphTransactionJournalV1['steps'] = [{
		stepId: `source:${filePath}`, groupId, resourceKind: 'task-source', resourceKey: filePath, operation: 'modify',
		before: transactionState('before'), after: transactionState('after'),
	}];
	const prepared = {
		target: { operonId: 'lease01', locator: { representation: 'inline' as const, filePath, lineNumber: 1 }, targetDigest: sha256(701) },
		affectedResources: [{ resourceKind: 'task-source' as const, resourceKey: filePath, revision: sha256HexV1('before') }],
		atomicGroups: [{ groupId, order: 0, resources: [{ resourceKind: 'task-source' as const, resourceKey: filePath }] }],
		predictedEffects: [{ resourceKind: 'task-source' as const, resourceKey: filePath, action: 'update' as const, summary: 'Transition the task.' }], warnings: [], token: {},
	};
	const groups = () => [{ groupId, status: 'committed' as const, resourceRevisions: [{ resourceKind: 'task-source' as const, resourceKey: filePath, revision: sha256HexV1(content) }] }];
	const newGateway = () => new RuntimeMutationGatewayV1({
		isReady: () => true, sampleContextRevision: () => transactionIdRevision,
		prepareCreation: async () => { throw new Error('Unexpected creation'); },
		commitCreation: async () => { throw new Error('Unexpected creation commit'); },
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => { throw new Error('Unjournaled mutation'); },
		prepareMutationTransaction: async () => ({ ok: true, steps }),
		commitMutationTransaction: async (_request, _prepared, _at, _journal, checkpoint) => {
			await holdCommit;
			assert.equal(content, 'before'); content = 'after'; writes++;
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			throw new Error('Injected interruption after write');
		},
		recoverMutationTransaction: async (_request, value, checkpoint) => {
			recoveries++;
			const result = await executeRuntimeGraphTransactionRecoveryV1(value, {
				readState: async () => transactionState(content),
				statesMatch: (left, right) => left.digest === right.digest,
				applyForward: async () => { content = 'after'; writes++; },
				applyCompensation: async () => { content = 'before'; writes++; },
				checkpoint, verifyState: async expected => content === expected,
			});
			return { status: result.status, verified: result.status !== 'outcome-unknown', groupResults: groups(), affectedFilePaths: [filePath] };
		},
		verifyMutationTransactionState: async (_value, expected) => content === expected,
		verifyRecoveredMutationTransaction: async () => content === 'after', verifyMutation: async () => content === 'after',
		reindexAffectedSources: async () => undefined, settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }), verifyCreatedTasks: async () => true,
		receiptStore: () => store, vaultIdentityHash: async () => sha256(702), nowEpochMs: () => now, randomId: () => `lease-${++sequence}`,
	});
	const gateway = newGateway();
	const preview = await gateway.preview({ contractVersion: 1, requestId: 'lease-preview', kind: 'mutation-preview', clientInstanceId: 'lease-client', idempotencyKey: 'same-plan-lease-key', capability: 'tasks.transition.preview', mutationKind: 'task.transition', target: { operonId: prepared.target.operonId, locator: prepared.target.locator },
		spec: { operation: 'transition', targetStatusId: 'status-done', expectedStatusId: 'status-open' }, authorization: { basis: 'user-explicit-request' } });
	assert.equal(preview.ok, true, JSON.stringify(preview));
	if (!preview.ok) throw new Error('Preview failed');
	const request = { contractVersion: 1 as const, requestId: 'lease-apply', kind: 'mutation-apply' as const, plan: preview.plan, idempotencyKey: 'same-plan-lease-key', authorization: { basis: 'user-explicit-request' as const }, acknowledgements: [] };
	const admission = decodeMutationApplyRequestV1(request);
	assert.equal(admission.ok, true, JSON.stringify(admission));
	return { gateway, newGateway, request, store, factory,
		advance: (milliseconds: number) => { now += milliseconds; },
		stats: () => ({ writes, recoveries, now }),
		hold: (promise: Promise<void>) => { holdCommit = promise; },
		failCheckpoint: () => { failCheckpoint = true; }, failFinalize: () => { failFinalize = true; },
	};
}

for (const failure of ['interrupt', 'checkpoint', 'finalize'] as const) {
	test(`same-plan lease: prepared mutation ${failure} recovers immediately without another write`, async () => {
		const f = await samePlanLeaseFixture();
		if (failure === 'checkpoint') f.failCheckpoint();
		const interrupted = await f.gateway.apply(f.request);
		assert.equal(interrupted.status, 'outcome-unknown', JSON.stringify(interrupted));
		if (failure === 'finalize') {
			f.failFinalize();
			assert.equal((await f.gateway.apply(f.request)).status, 'outcome-unknown');
		}
		const recovered = await f.gateway.apply(f.request);
		assert.equal(recovered.status, 'applied', JSON.stringify(recovered));
		assert.equal((await f.gateway.apply(f.request)).status, 'already-applied');
		assert.equal(f.stats().writes, 1);
		assert.equal(f.stats().now, BASE_TIME);
		assert.equal(f.factory.journals.size, 0);
	});
}

test('same-plan lease: a different gateway waits for lease expiry and rejects stale-owner writes', async () => {
	const f = await samePlanLeaseFixture();
	await f.gateway.apply(f.request);
	const stored = [...f.factory.journals.values()][0] as { journal: GraphTransactionJournalV1; leaseOwner: string };
	const other = f.newGateway();
	assert.equal((await other.apply(f.request)).status, 'outcome-unknown');
	assert.equal(f.stats().recoveries, 0);
	f.advance(29_999);
	assert.equal((await other.apply(f.request)).status, 'outcome-unknown');
	f.advance(1);
	f.failFinalize();
	assert.equal((await other.apply(f.request)).status, 'outcome-unknown');
	assert.equal(f.stats().recoveries, 1);
	const current = [...f.factory.journals.values()][0] as { journal: GraphTransactionJournalV1; leaseOwner: string };
	assert.notEqual(current.leaseOwner, stored.leaseOwner);
	await assert.rejects(f.store.persistJournal(current.journal, stored.leaseOwner));
	const terminal: MutationReceiptV1 = {
		...receipt(705), vaultIdentityHash: current.journal.vaultIdentityHash,
		clientInstanceId: current.journal.clientInstanceId, idempotencyKeyHash: current.journal.idempotencyKeyHash,
		mutationKind: current.journal.mutationKind, planHash: current.journal.planHash,
		targetDigest: current.journal.targetDigest, effectiveAt: current.journal.effectiveAt,
	};
	await assert.rejects(f.store.finalizeReceipt(terminal, current.journal, stored.leaseOwner),
		(error: unknown) => error instanceof MutationReceiptStoreErrorV1 && error.code === 'receipt-store-invalid-receipt');
	assert.equal(f.factory.journals.size, 1);
	assert.equal(f.factory.records.size, 0);
	assert.equal((await f.gateway.apply(f.request)).status, 'outcome-unknown');
	assert.equal((await other.apply(f.request)).status, 'applied');
	assert.equal(f.stats().writes, 1);
});

test('same-plan lease: concurrent recovery queues behind the active apply', async () => {
	const f = await samePlanLeaseFixture();
	let release = (): void => undefined;
	f.hold(new Promise<void>(resolve => { release = resolve; }));
	const applying = f.gateway.apply(f.request);
	let recoveryFinished = false;
	const recovery = f.gateway.apply(f.request).then(value => { recoveryFinished = true; return value; });
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.equal(recoveryFinished, false);
	assert.equal(f.stats().recoveries, 0);
	release();
	assert.equal((await applying).status, 'outcome-unknown');
	assert.equal((await recovery).status, 'applied');
	assert.equal(f.stats().writes, 1);
});

function workflowLeaseFixture(capability: 'tasks.create.identity-placeholders' | 'tasks.create.periodic-note.preview' | 'tasks.update.periodic-note.preview') {
	let now = Date.now();
	let content = 'before';
	let writes = 0;
	let sequence = 0;
	let failWrite = true;
	const factory = new FakeIndexedDbFactory();
	const store = new IndexedDbMutationReceiptStoreV1({ indexedDBFactory: factory as unknown as IDBFactory, now: () => now });
	const idempotencyKey = 'workflow-lease-key';
	const base = identityPlaceholderPlan(705);
	const step: GraphTransactionJournalV1['steps'][number] = { stepId: 'source:Workflow.md', groupId: 'task-source:Workflow.md', resourceKind: 'task-source', resourceKey: 'Workflow.md', operation: 'modify', before: transactionState('before'), after: transactionState('after') };
	const plan = { ...base, capability, mutationKind: capability === 'tasks.update.periodic-note.preview' ? 'task.update' : 'task.create',
		idempotencyKeyHash: sha256HexV1(idempotencyKey), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(),
		affectedResources: [{ resourceKind: 'task-source', resourceKey: step.resourceKey, revision: step.before.digest }],
		atomicGroups: [{ groupId: step.groupId, order: 0, resources: [{ resourceKind: 'task-source', resourceKey: step.resourceKey }] }],
		targets: [{ operonId: 'work001', locator: { representation: 'inline', filePath: step.resourceKey, lineNumber: 0 }, targetDigest: sha256(706) }],
		periodicUpdate: {},
	};
	const computeHash = runtimeMainMethod('computeTaskWorkflowPlanHash', {});
	plan.planHash = computeHash(plan) as string;
	const bindings = {
		withRuntimeVaultMutationLockV1, buildIdentityPlaceholderJournalV1, identityPlaceholderJournalByteLengthV1,
		identityPlaceholderJournalsEqualV1, GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1, MutationReceiptStoreErrorV1,
		executeRuntimeGraphTransactionCommitV1, executeRuntimeGraphTransactionRecoveryV1,
		resolveRuntimeIdentityGraphFreshCommitSettlementV1, settleRuntimeIdentityGraphPostflightV1,
		buildRuntimeIdentityGraphGroupResultsV1, structuredErrorV1,
		getActiveWindow: () => ({ crypto: { randomUUID: () => `workflow-owner-${++sequence}` } }),
		getExternalModifiedTimeFrontmatterPropertyNames: () => [],
		// Domain preparation is fixed; journal acquisition, execution and recovery stay real.
		compareRebuiltIdentityPlaceholderPlanV1: (candidate: { plan: unknown }, expected: unknown) => ({ ok: true, matches: JSON.stringify(candidate.plan) === JSON.stringify(expected) }),
		sealPeriodicNoteCreatePreviewResultV1: (candidate: unknown) => ({ ok: true, value: candidate }),
	};
	const execute = runtimeMainMethod('applyAgentRuntimeIdentityCreation', bindings);
	const newHost = () => ({
		agentRuntimeTaskWorkflowJournalLeaseOwner: null as string | null,
		agentRuntimeReceiptStore: store, agentRuntimeVaultIdentityHash: sha256(707),
		computeTaskWorkflowPlanHash: computeHash,
		agentRuntimeIdentityJournalMatchesPlan: runtimeMainMethod('agentRuntimeIdentityJournalMatchesPlan', {}),
		agentRuntimeTaskWorkflowApplyFailure: runtimeMainMethod('agentRuntimeTaskWorkflowApplyFailure', bindings),
		agentRuntimeIdentityOutcomeUnknown: runtimeMainMethod('agentRuntimeIdentityOutcomeUnknown', bindings),
		taskWorkflowIdentityReceipt: (value: unknown) => value,
		sampleAgentRuntimeRevision: () => ({ contextRevision: plan.contextRevision }),
		prepareAgentRuntimeIdentityCreation: async () => ({ ok: true }),
		prepareAgentRuntimePeriodicCreation: async () => ({ ok: true, preparation: { ok: true }, route: {} }),
		prepareAgentRuntimePeriodicUpdate: async () => ({ ok: true, steps: [step], target: plan.targets[0], evidence: plan.periodicUpdate }),
		prepareAgentRuntimeIdentityGraphSteps: async () => ({ ok: true, steps: [step] }),
		buildAgentRuntimeIdentityPlanCandidate: () => ({ ok: true, plan }),
		buildAgentRuntimePeriodicPlanCandidate: () => ({ ok: true, plan }),
		verifyAgentRuntimeIdentityPlanAfterState: async () => content === 'after',
		verifyAgentRuntimeIdentityGraphSteps: async (_steps: unknown, expected: string) => content === expected,
		readAgentRuntimeIdentityGraphState: async () => transactionState(content),
		agentRuntimeIdentityGraphStatesMatch: (left: { digest: string }, right: { digest: string }) => left.digest === right.digest,
		applyAgentRuntimeIdentityGraphStep: async (_step: unknown, direction: string) => {
			content = direction === 'forward' ? 'after' : 'before'; writes++;
			if (failWrite) { failWrite = false; throw new Error('Interrupted after workflow source write'); }
			return true;
		},
		reindexAgentRuntimeGraphCommittedPrefix: async () => undefined,
		awaitAgentRuntimeSettlement: async () => undefined,
		indexer: { reindexAffectedSources: async () => undefined },
		storage: { repeatSeries: { getRevision: () => 0 } }, settings: DEFAULT_SETTINGS, app: {},
		ensureAgentRuntimePeriodicRegistry: async () => ({ status: 'ok' }),
	});
	const host = newHost();
	const request = { contractVersion: 1, requestId: 'workflow-apply', kind: 'mutation-apply', plan, idempotencyKey, authorization: { basis: 'user-explicit-request' }, acknowledgements: [] };
	const events: string[] = [];
	const apply = async (target = host) => await execute.call(target, request, { recoveryOnly: false, dispatch: async (event: string) => { events.push(event); } }) as MutationResultV1;
	return { host, newHost, apply, factory, store, events, stats: () => ({ writes, now }), advance: (milliseconds: number) => { now += milliseconds; } };
}

for (const capability of ['tasks.create.identity-placeholders', 'tasks.create.periodic-note.preview', 'tasks.update.periodic-note.preview'] as const) {
	test(`same-plan lease: production ${capability} executor recovers immediately and replays once`, async () => {
		const f = workflowLeaseFixture(capability);
		const before = f.stats().now;
		const interrupted = await f.apply();
		assert.equal(interrupted.status, 'outcome-unknown', JSON.stringify(interrupted));
		assert.equal(f.stats().writes, 1);
		const owner = f.host.agentRuntimeTaskWorkflowJournalLeaseOwner;
		const recovered = await f.apply();
		assert.equal(recovered.status, 'applied', JSON.stringify(recovered));
		assert.equal(f.host.agentRuntimeTaskWorkflowJournalLeaseOwner, owner);
		assert.equal((await f.apply()).status, 'already-applied');
		assert.equal(f.stats().writes, 1);
		assert.equal(f.stats().now, before);
		assert.equal(f.factory.journals.size, 0);
		assert.deepEqual(f.events.slice(0, 2), ['apply-dispatched', 'recovery-dispatched']);
	});
}

test('same-plan lease: new Task Workflow session preserves the previous owner lease until expiry', async () => {
	const f = workflowLeaseFixture('tasks.update.periodic-note.preview');
	assert.equal((await f.apply()).status, 'outcome-unknown');
	const newSession = f.newHost();
	assert.equal((await f.apply(newSession)).status, 'outcome-unknown');
	assert.notEqual(newSession.agentRuntimeTaskWorkflowJournalLeaseOwner, f.host.agentRuntimeTaskWorkflowJournalLeaseOwner);
	assert.equal(f.stats().writes, 1);
	f.advance(30_000);
	const recovered = await f.apply(newSession);
	assert.equal(recovered.status, 'applied', JSON.stringify(recovered));
	assert.equal(f.stats().writes, 1);
});


test('same-plan lease: recovery checkpoint failure preserves the existing compensation outcome', async () => {
	const f = await samePlanLeaseFixture();
	assert.equal((await f.gateway.apply(f.request)).status, 'outcome-unknown');
	f.failCheckpoint();
	const result = await f.gateway.apply(f.request);
	assert.equal(result.status, 'failed', JSON.stringify(result));
	assert.equal(result.mutationMayHaveApplied, false);
	assert.equal(result.retryAllowed, false);
	assert.equal(f.stats().writes, 2); // One forward write and its existing compensation.
	assert.equal(f.factory.journals.size, 0);
	assert.equal(f.factory.records.size, 0);
});
