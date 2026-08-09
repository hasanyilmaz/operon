import assert from 'node:assert/strict';
import test from 'node:test';

import {
	admitMutationResultV1,
	decodeMutationPreviewResultV1,
	decodeMutationResultV1,
	decodeMutationApplyRequestV1,
	computeSealedMutationPlanHashV1,
	canonicalJsonV1,
	type ContextRevisionV1,
	type MutationPreviewRequestV1,
	type MutationReceiptV1,
	type SealedMutationPlanV1,
	sha256HexV1,
	toJsonValueV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	checkpointGraphForwardCompletionV1,
	RuntimeMutationGatewayV1,
	tryWithRuntimeVaultMutationLockV1,
	withRuntimeVaultMutationLockV1,
	type RuntimeMutationGatewayPortsV1,
	type RuntimePreparedMutationV1,
} from '../../../src/agent-runtime/runtime/mutation-gateway';
import {
	validateRuntimeMutationApplyRequestV1,
	validateRuntimeMutationPreviewRequestV1,
} from '../../../src/agent-runtime/runtime/mutation-request-validator';
import { validateCliRuntimeRequestV1 } from '../../../src/agent-runtime/runtime/context-request-validator';
import {
	prepareRuntimeTaskCreationV1,
	type RuntimeTaskCreationPreparationV1,
} from '../../../src/agent-runtime/runtime/task-creation-adapter';
import {
	buildRuntimeConversionAncestorPredictedEffectsV1,
	refreshRuntimeInlineTaskUpdateSettlementEvidenceV1,
	resolveRuntimeInlineTaskUpdateSettlementEvidenceV1,
	resolveRuntimeTaskFieldMutationPostflightEvidenceV1,
	type RuntimeTaskFieldMutationPreparationV1,
	verifyRuntimeTaskFieldMutationPrimaryPostflightV1,
} from '../../../src/agent-runtime/runtime/task-mutation-adapter';
import type { RuntimeSemanticTransitionPlanV1 } from '../../../src/agent-runtime/runtime/semantic-transition';
import {
	GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1,
	type GraphTransactionJournalV1,
	type GraphTransactionJournalStepV1,
	type IndexedDbSecurityAuditStoreV1,
	type IndexedDbMutationReceiptStoreV1,
	type MutationReceiptApplyAdmissionTokenV1,
	type MutationReceiptScopeV1,
	type SecurityAuditEventV1,
} from '../../../src/agent-runtime/runtime/receipts';
import { RuntimeTimingProbeBufferV1 } from '../../../src/agent-runtime/runtime/timing-probe';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

const revision: ContextRevisionV1 = {
	index: {
		sessionId: 'session-phase7',
		ramGeneration: 7,
		durable: { status: 'missing' },
	},
	settingsFingerprint: 'a'.repeat(64),
	pinnedGeneration: 0,
	activeTrackerGeneration: 0,
	repeatSeriesRevision: 0,
	projectSerialGeneration: 0,
	projectSerialSignature: 'b'.repeat(64),
};

const request: MutationPreviewRequestV1 = {
	contractVersion: 1,
	requestId: 'phase7-preview',
	kind: 'mutation-preview',
	clientInstanceId: 'test-client',
	idempotencyKey: 'phase7-idempotency-key',
	capability: 'tasks.create.preview',
	mutationKind: 'task.create',
	spec: {
		operation: 'create',
		items: [{
			itemRef: 'task-one',
			description: 'Created through Gateway',
			target: {
				representation: 'inline',
				mode: 'exact-path',
				filePath: 'Tasks.md',
			},
			fields: [],
			tags: [],
		}],
	},
	authorization: { basis: 'user-explicit-request' },
};

const sourceBefore = '# Tasks\n';
const taskLine = '- [ ] Created through Gateway {{operonId:: abc1234}}';
const sourceAfter = `${sourceBefore}${taskLine}\n`;

test('prepared all-after recovery checkpoints committing before postflight', async () => {
	let durablePhase = 'prepared';
	const checkpoints: string[] = [];
	await checkpointGraphForwardCompletionV1('prepared', 1, async checkpoint => {
		const allowed = durablePhase === 'prepared'
			? checkpoint.phase === 'committing'
			: durablePhase === 'committing' && checkpoint.phase === 'postflight';
		assert.equal(allowed, true, `${durablePhase} -> ${checkpoint.phase}`);
		assert.equal(checkpoint.completedStepCount, 1);
		durablePhase = checkpoint.phase;
		checkpoints.push(`${checkpoint.phase}:${checkpoint.completedStepCount}`);
	});
	assert.deepEqual(checkpoints, ['committing:1', 'postflight:1']);
	assert.equal(durablePhase, 'postflight');
});

test('automatic reconcile try-lock cannot overlap a Runtime vault mutation', async () => {
	const vaultIdentityHash = 'f'.repeat(64);
	let releaseHeldLock: (() => void) | undefined;
	const heldLockReleased = new Promise<void>(resolve => {
		releaseHeldLock = resolve;
	});
	let heldLockEntered = false;
	const heldLock = withRuntimeVaultMutationLockV1(vaultIdentityHash, async () => {
		heldLockEntered = true;
		await heldLockReleased;
		return 'held';
	});
	while (!heldLockEntered) await Promise.resolve();

	let reconcileRan = false;
	const skipped = await tryWithRuntimeVaultMutationLockV1(vaultIdentityHash, async () => {
		reconcileRan = true;
		return 1;
	});
	assert.equal(skipped, null);
	assert.equal(reconcileRan, false);

	releaseHeldLock?.();
	assert.equal(await heldLock, 'held');
	assert.equal(
		await tryWithRuntimeVaultMutationLockV1(vaultIdentityHash, async () => 2),
		2,
	);
});

test('Runtime admission preserves the contract tag-count boundary', () => {
	const maximumTags = Array.from({ length: 512 }, (_, index) => `tag-${index}`);
	const accepted = structuredClone(request);
	assert.equal(accepted.spec.operation, 'create');
	if (accepted.spec.operation !== 'create') return;
	accepted.spec.items[0].tags = maximumTags;
	assert.equal(validateRuntimeMutationPreviewRequestV1(accepted).ok, true);

	const rejected = structuredClone(request);
	assert.equal(rejected.spec.operation, 'create');
	if (rejected.spec.operation !== 'create') return;
	rejected.spec.items[0].tags = [...maximumTags, 'tag-overflow'];
	assert.equal(validateRuntimeMutationPreviewRequestV1(rejected).ok, false);
});

test('creation capability refusal preserves structured adapter details', async () => {
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => ({
			ok: false,
			code: 'capability-unavailable',
			reason: 'Cross-source reciprocal dependency is unavailable.',
			details: {
				feature: 'cross-source-reciprocal-dependency-create',
				requiredScope: 'single-task-source',
			},
		}),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'unused-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, false);
	if (preview.ok) return;
	assert.equal(preview.error.code, 'capability-unavailable');
	assert.deepEqual(preview.error.details, {
		feature: 'cross-source-reciprocal-dependency-create',
		requiredScope: 'single-task-source',
	});
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);
});

test('mutation preview timing is request-linked and diagnostic-only', async () => {
	const timingSink = new RuntimeTimingProbeBufferV1();
	let timingClock = 0;
	const gateway = new RuntimeMutationGatewayV1({
		timingSink,
		timingNow: () => ++timingClock,
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'timed-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	assert.deepEqual(timingSink.snapshot(), [{
		requestId: request.requestId,
		flow: 'mutation-preview',
		span: 'prepare',
		durationMs: 1,
		attempt: 1,
	}]);
});

function preparation(): RuntimeTaskCreationPreparationV1 {
	return {
		ok: true,
		plan: {
			requestId: request.requestId,
			preparedAt: '2026-07-24T10:00:00',
			tasks: [{
				itemKey: 'task-one',
				operonId: 'abc1234',
				description: 'Created through Gateway',
				representation: 'inline',
				filePath: 'Tasks.md',
				lineNumber: 1,
				checkbox: 'open',
				fieldValues: { operonId: 'abc1234' },
				tags: [],
				renderedTaskLine: taskLine,
				relatedOperonIds: [],
				resolvedDependencies: [],
			}],
			sourceGroups: [{
				groupId: 'task-source:Tasks.md',
				filePath: 'Tasks.md',
				expectedRevision: sha256HexV1(sourceBefore),
				expectedState: 'present',
				expectedContent: sourceBefore,
				operation: 'update',
				resultingContent: sourceAfter,
				taskItemKeys: ['task-one'],
			}],
		},
		createEffects: [{
			itemRef: 'task-one',
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
			targetBeforeDigest: sha256HexV1(sourceBefore),
			renderedTaskDigest: sha256HexV1(taskLine),
			plannedSourceDigest: sha256HexV1(sourceAfter),
			resolvedRelatedOperonIds: [],
		}],
		parentResources: [],
		dependencyResources: [],
		sourceGroupGraph: {
			sourceOrder: ['Tasks.md'],
			edges: [],
			crossSourcePartialRisk: false,
		},
		recurrenceResources: [],
	};
}

function temporalPreparation(
	seriesId = 'series-create-1',
): Extract<RuntimeTaskCreationPreparationV1, { ok: true }> {
	const base = preparation();
	if (!base.ok) throw new Error(base.reason);
	return {
		...base,
		plan: {
			...base.plan,
			tasks: base.plan.tasks.map(task => ({
				...task,
				fieldValues: {
					...task.fieldValues,
					repeat: 'mode=schedule|freq=day|interval=1',
					repeatSeriesId: seriesId,
					repeatOccurrenceDate: '2026-07-24',
				},
			})),
		},
		createEffects: base.createEffects.map(effect => ({ ...effect, repeatSeriesId: seriesId })),
		recurrenceResources: [{
			itemRef: 'task-one',
			operonId: 'abc1234',
			seriesId,
			filePath: 'Tasks.md',
			sourceFormat: 'inline',
			baseTitle: null,
			lastMaterializedTitle: 'Created through Gateway',
			naming: {
				mode: 'plain',
				template: 'Created through Gateway',
				weekTokenCase: null,
			},
			baseTemporalTemplate: {
				mode: 'allDay',
				dateShiftDays: 0,
				startDateShiftDays: 0,
				endDateShiftDays: 0,
				startTime: null,
				endTime: null,
				estimate: null,
			},
			revision: 'repeat-before',
		}],
	};
}

function crossSourcePreparation(): Extract<RuntimeTaskCreationPreparationV1, { ok: true }> {
	const base = preparation();
	if (!base.ok) throw new Error(base.reason);
	const parentSource = '- [ ] Existing parent {{operonId:: ext0001}}\n';
	return {
		...base,
		parentResources: [{
			operonId: 'ext0001',
			filePath: 'Parent.md',
			sourceRevision: sha256HexV1(parentSource),
			sourceContent: parentSource,
			format: 'inline',
			lineNumber: 0,
		}],
		sourceGroupGraph: {
			sourceOrder: ['Parent.md', 'Tasks.md'],
			edges: [{
				fromFilePath: 'Parent.md',
				toFilePath: 'Tasks.md',
				relation: 'parent',
			}],
			crossSourcePartialRisk: true,
		},
	};
}

function graphGateway(
	prepared: Extract<RuntimeTaskCreationPreparationV1, { ok: true }>,
	receiptStore: IndexedDbMutationReceiptStoreV1,
	options: {
		commit: NonNullable<RuntimeMutationGatewayPortsV1['commitCreationTransaction']>;
		recover?: NonNullable<RuntimeMutationGatewayPortsV1['recoverCreationTransaction']>;
		steps?: GraphTransactionJournalStepV1[];
		verifyCreationTransactionState?: NonNullable<
			RuntimeMutationGatewayPortsV1['verifyCreationTransactionState']
		>;
		reindexAffectedSources?: (filePaths: readonly string[]) => Promise<void>;
		settleAfterMutation?: () => Promise<void>;
	},
): RuntimeMutationGatewayV1 {
	const parentSource = prepared.parentResources[0]?.sourceContent ?? '';
	const steps = options.steps ?? [{
		stepId: 'parent-source',
		groupId: 'task-source:Parent.md',
		resourceKind: 'task-source' as const,
		resourceKey: 'Parent.md',
		operation: 'modify' as const,
		before: {
			state: 'present' as const,
			digest: sha256HexV1(parentSource),
			content: parentSource,
		},
		after: {
			state: 'present' as const,
			digest: sha256HexV1(`${parentSource}updated`),
			content: `${parentSource}updated`,
		},
	}, {
		stepId: 'task-source',
		groupId: 'task-source:Tasks.md',
		resourceKind: 'task-source' as const,
		resourceKey: 'Tasks.md',
		operation: 'modify' as const,
		before: {
			state: 'present' as const,
			digest: sha256HexV1(sourceBefore),
			content: sourceBefore,
		},
		after: {
			state: 'present' as const,
			digest: sha256HexV1(sourceAfter),
			content: sourceAfter,
		},
	}];
	return new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => prepared,
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		prepareCreationTransaction: async () => ({
			ok: true,
			steps,
		}),
		commitCreationTransaction: options.commit,
		recoverCreationTransaction: options.recover ?? (async () => ({
			status: 'outcome-unknown',
			groupResults: [],
			affectedFilePaths: [],
			verified: false,
		})),
		verifyCreationTransactionState: options.verifyCreationTransactionState
			?? (async () => true),
		reindexAffectedSources: options.reindexAffectedSources ?? (async () => undefined),
		settleAfterMutation: options.settleAfterMutation ?? (async () => undefined),
		reconcileCreatedHierarchy: async () => {
			throw new Error('graph transaction must own hierarchy reconciliation');
		},
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase12-graph-transaction-plan',
	});
}

function committedCrossSourceSummary() {
	return {
		status: 'committed' as const,
		groups: [{
			groupId: 'task-source:Parent.md',
			filePath: 'Parent.md',
			result: {
				status: 'committed' as const,
				resultingRevision: sha256HexV1('parent-after'),
			},
		}, {
			groupId: 'task-source:Tasks.md',
			filePath: 'Tasks.md',
			result: {
				status: 'committed' as const,
				resultingRevision: sha256HexV1(sourceAfter),
			},
		}],
		remainingGroupIds: [],
	};
}

function confirmedCreateApply(
	plan: SealedMutationPlanV1,
	requestId: string,
) {
	return {
		contractVersion: 1 as const,
		requestId,
		kind: 'mutation-apply' as const,
		plan,
		authorization: { basis: 'user-explicit-confirmation' as const },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [{
			code: 'confirm:cross-source-graph-partial-risk',
			planHash: plan.planHash,
			targetDigest: plan.targets[0]!.targetDigest,
			acknowledgedAt: plan.createdAt,
		}],
	};
}

test('preview seals one live-verified creation plan and apply replays by receipt', async () => {
	const timingSink = new RuntimeTimingProbeBufferV1();
	let timingClock = 0;
	let receipt: Parameters<IndexedDbMutationReceiptStoreV1['persist']>[0] | null = null;
	let committed = 0;
	let nowEpochMs = Date.parse('2026-07-24T08:00:00.000Z');
	let committedAt = '';
	let sampledRevision = revision;
	const reindexed: string[][] = [];
	const receiptHealthForces: boolean[] = [];
	const receiptStore = {
		health: async (force = false) => {
			receiptHealthForces.push(force);
			return { healthy: true };
		},
		lookup: async () => receipt,
		persist: async (value: NonNullable<typeof receipt>) => {
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		timingSink,
		timingNow: () => ++timingClock,
		isReady: () => true,
		sampleContextRevision: () => sampledRevision,
		prepareCreation: async () => preparation(),
		commitCreation: async (_prepared, modifiedAt) => {
			committed += 1;
			committedAt = modifiedAt;
			return {
				status: 'committed',
				groups: [{
					groupId: 'task-source:Tasks.md',
					filePath: 'Tasks.md',
					result: { status: 'committed', resultingRevision: sha256HexV1(sourceAfter) },
				}],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async filePaths => {
			reindexed.push([...filePaths]);
		},
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({
			ok: true,
			resourceRevisions: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				revision: sha256HexV1(sourceAfter),
			}],
		}),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => nowEpochMs,
		randomId: () => 'phase7-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);
	if (!preview.ok) return;
	const unauthorized = await gateway.preview({
		...request,
		requestId: 'phase7-preview-standing-authority',
		authorization: { basis: 'user-standing-instruction' },
	});
	assert.equal(unauthorized.ok, false);
	if (!unauthorized.ok) assert.equal(unauthorized.error.code, 'authority-insufficient');
	const apply = {
		contractVersion: 1 as const,
		requestId: 'phase7-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	};
	sampledRevision = {
		...revision,
		index: {
			...revision.index,
			durable: {
				status: 'available',
				snapshotId: 'd'.repeat(64),
				committedAt: '2026-07-24T08:03:30.000Z',
			},
		},
	};
	nowEpochMs = Date.parse('2026-07-24T08:04:00.000Z');
	const first = await gateway.apply(apply);
	assert.equal(first.status, 'applied');
	assert.equal(first.postflight?.status, 'verified');
	assert.equal(committedAt, '2026-07-24T08:04:00.000Z');
	assert.equal(first.receipt?.effectiveAt, '2026-07-24T08:04:00.000Z');
	assert.equal(committed, 1);
	assert.deepEqual(
		reindexed,
		[['Tasks.md'], ['Tasks.md']],
		'non-transaction creation must reindex before and after hierarchy reconciliation writes',
	);
	assert.deepEqual(
		timingSink.snapshot()
			.filter(value => value.requestId === apply.requestId)
			.map(value => value.span),
		[
			'vault-identity',
			'lock-wait',
			'receipt-health',
			'receipt-lookup',
			'journal-lookup',
			'context-revision',
			'prepare',
			'prepare',
			'context-revision',
			'commit',
			'reindex',
			'reindex',
			'settlement',
			'semantic-postflight',
			'receipt-persist',
		],
	);
	const replay = await gateway.apply({ ...apply, requestId: 'phase7-replay' });
	assert.equal(replay.status, 'already-applied');
	assert.deepEqual(replay.postflight, { status: 'receipt-replay' });
	assert.deepEqual(
		receiptHealthForces,
		[true, true],
		'every apply admission must force receipt health before any write or replay',
	);
	const replayDecoded = decodeMutationResultV1(replay);
	assert.equal(
		replayDecoded.ok,
		true,
		replayDecoded.ok ? undefined : JSON.stringify(replayDecoded.issues),
	);
	assert.equal(committed, 1);
	nowEpochMs = Date.parse('2026-07-24T08:06:00.000Z');
	const delayedReplay = await gateway.apply({ ...apply, requestId: 'phase7-delayed-replay' });
	assert.equal(delayedReplay.status, 'already-applied');
	assert.equal(committed, 1);
	const expiredPlan = {
		...preview.plan,
		createdAt: '2026-07-24T07:50:00.000Z',
		expiresAt: '2026-07-24T07:55:00.000Z',
	};
	expiredPlan.planHash = computeSealedMutationPlanHashV1(expiredPlan);
	receipt = null;
	const expired = await gateway.apply({
		...apply,
		requestId: 'phase7-expired',
		plan: expiredPlan,
	});
	assert.equal(expired.status, 'failed');
	assert.equal(expired.error?.code, 'plan-expired');
});

test('minute-precision creation is canonical through Gateway postflight and receipt replay', async () => {
	const filePath = 'Datetime.md';
	const sourceBefore = '# Datetime\n';
	let source = sourceBefore;
	let commitCount = 0;
	let verifyCount = 0;
	let receipt: Parameters<IndexedDbMutationReceiptStoreV1['persist']>[0] | null = null;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		persist: async (value: NonNullable<typeof receipt>) => {
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const datetimeRequest: MutationPreviewRequestV1 = {
		...request,
		requestId: 'datetime-minute-preview',
		idempotencyKey: 'datetime-minute-idempotency',
		spec: {
			operation: 'create',
			items: [{
				itemRef: 'datetime-task',
				description: 'Minute precision task',
				target: {
					representation: 'inline',
					mode: 'exact-path',
					filePath,
				},
				fields: [{
					kind: 'datetime',
					field: 'datetimeStart',
					value: '2026-07-31T22:00',
				}],
				tags: [],
			}],
		},
	};
	const creationPorts = {
		settings: () => DEFAULT_SETTINGS,
		listOperonIds: () => new Set<string>(),
		listDependencyGraphTasks: () => [],
		getExistingTask: () => null,
		readSource: async (requestedPath: string) => ({
			filePath: requestedPath,
			content: requestedPath === filePath ? source : null,
		}),
		resolveConfiguredInlineTarget: async () => ({
			filePath,
			placement: { kind: 'append' as const },
		}),
		resolveConfiguredFilePath: async () => filePath,
		readTemplate: async () => null,
		creationFieldCatalog: () => [{
			canonicalKey: 'datetimeStart',
			displayName: 'Starts at',
			description: 'Built-in start datetime.',
			valueType: 'datetime' as const,
			source: 'built-in' as const,
			mappingStatus: 'mapped' as const,
			readable: true,
			mutationClass: 'general-update' as const,
			mutationOwner: 'tasks.update',
			requiresStableTaxonomyId: false,
		}],
		resolveCoreTemplateVariables: (content: string) => content,
		generateOperonId: () => 'dtm0001',
		now: () => '2026-07-31T20:00:00',
	};
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async (
			requestId,
			spec,
			sealedIds,
			effectiveAt,
			activeItemRefs,
			sealedSeriesIds,
		) => await prepareRuntimeTaskCreationV1(
			requestId,
			spec,
			creationPorts,
			sealedIds,
			effectiveAt,
			activeItemRefs,
			sealedSeriesIds,
		),
		commitCreation: async prepared => {
			commitCount += 1;
			const group = prepared.plan.sourceGroups[0];
			assert.ok(group);
			source = group.resultingContent;
			return {
				status: 'committed',
				groups: [{
					groupId: group.groupId,
					filePath,
					result: { status: 'committed', resultingRevision: sha256HexV1(source) },
				}],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({
			ok: true,
			resourceRevisions: [{
				resourceKind: 'task-source',
				resourceKey: filePath,
				revision: sha256HexV1(source),
			}],
		}),
		verifyCreatedTasks: async prepared => {
			verifyCount += 1;
			assert.equal(
				prepared.plan.tasks[0]?.fieldValues.datetimeStart,
				'2026-07-31T22:00:00',
			);
			assert.match(source, /\{\{datetimeStart:: 2026-07-31T22:00:00\}\}/u);
			return source === prepared.plan.sourceGroups[0]?.resultingContent;
		},
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => '9'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-31T20:00:00.000Z'),
		randomId: () => 'datetime-minute-plan',
	});

	const preview = await gateway.preview(datetimeRequest);
	assert.equal(preview.ok, true, JSON.stringify(preview));
	if (!preview.ok) return;
	const applyRequest = {
		contractVersion: 1 as const,
		requestId: 'datetime-minute-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: datetimeRequest.idempotencyKey,
		acknowledgements: [],
	};
	const applied = await gateway.apply(applyRequest);
	assert.equal(applied.status, 'applied');
	assert.equal(applied.postflight?.status, 'verified');
	assert.equal(commitCount, 1);
	assert.equal(verifyCount, 1);

	const replay = await gateway.apply({ ...applyRequest, requestId: 'datetime-minute-replay' });
	assert.equal(replay.status, 'already-applied');
	assert.deepEqual(replay.postflight, { status: 'receipt-replay' });
	assert.equal(commitCount, 1, 'receipt replay must not write the canonical source again');
	assert.equal(verifyCount, 1, 'receipt replay must not rerun semantic postflight');
});

test('production combined admission wins over legacy methods and receipt replay stays write-free', async () => {
	let receipt: MutationReceiptV1 | null = null;
	let admissionCalls = 0;
	let prepareCalls = 0;
	let commitCalls = 0;
	let reindexCalls = 0;
	let settlementCalls = 0;
	let persistCalls = 0;
	const admissionToken = Object.freeze({}) as MutationReceiptApplyAdmissionTokenV1;
	const receiptStore = {
		lookupForApplyAdmission: async () => {
			admissionCalls += 1;
			return {
				health: { healthy: true, status: 'healthy', reason: 'ready' },
				receipt,
				journal: null,
				admissionToken,
			};
		},
		health: async () => {
			throw new Error('legacy health must not run');
		},
		lookup: async () => {
			throw new Error('legacy receipt lookup must not run');
		},
		lookupJournal: async () => {
			throw new Error('legacy journal lookup must not run');
		},
		persist: async () => {
			throw new Error('legacy persist must not run with an admission token');
		},
		persistAfterApplyAdmission: async (
			value: MutationReceiptV1,
			token: MutationReceiptApplyAdmissionTokenV1,
		) => {
			assert.equal(token, admissionToken);
			persistCalls += 1;
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => {
			prepareCalls += 1;
			return preparation();
		},
		commitCreation: async () => {
			commitCalls += 1;
			return {
				status: 'committed',
				groups: [{
					groupId: 'task-source:Tasks.md',
					filePath: 'Tasks.md',
					result: { status: 'committed', resultingRevision: sha256HexV1(sourceAfter) },
				}],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async () => {
			reindexCalls += 1;
		},
		settleAfterMutation: async () => {
			settlementCalls += 1;
		},
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'combined-admission-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = {
		contractVersion: 1 as const,
		requestId: 'combined-admission-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	};
	const first = await gateway.apply(apply);
	assert.equal(first.status, 'applied');
	assert.equal(first.postflight?.status, 'verified');
	const afterFirst = {
		prepareCalls,
		commitCalls,
		reindexCalls,
		settlementCalls,
		persistCalls,
	};
	const replay = await gateway.apply({ ...apply, requestId: 'combined-admission-replay' });
	assert.equal(replay.status, 'already-applied');
	assert.deepEqual(replay.postflight, { status: 'receipt-replay' });
	assert.equal(admissionCalls, 2);
	assert.deepEqual({
		prepareCalls,
		commitCalls,
		reindexCalls,
		settlementCalls,
		persistCalls,
	}, afterFirst);
});

test('combined admission failure is retryable and stops every mutation write path', async () => {
	let prepareCalls = 0;
	let commitCalls = 0;
	let reindexCalls = 0;
	let settlementCalls = 0;
	let verifyCalls = 0;
	let persistCalls = 0;
	const receiptStore = {
		lookupForApplyAdmission: async () => ({
			health: { healthy: false, status: 'unhealthy', reason: 'operation-timeout' },
			receipt: null,
			journal: null,
		}),
		persist: async () => {
			persistCalls += 1;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 0 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => {
			prepareCalls += 1;
			return preparation();
		},
		commitCreation: async () => {
			commitCalls += 1;
			return { status: 'failed', groups: [], remainingGroupIds: [] };
		},
		reindexAffectedSources: async () => {
			reindexCalls += 1;
		},
		settleAfterMutation: async () => {
			settlementCalls += 1;
		},
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => {
			verifyCalls += 1;
			return false;
		},
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'combined-admission-failure-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	prepareCalls = 0;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'combined-admission-failure-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error?.code, 'receipt-store-unavailable');
	assert.equal(result.retryAllowed, true);
	assert.equal(result.mutationMayHaveApplied, false);
	assert.deepEqual({
		prepareCalls,
		commitCalls,
		reindexCalls,
		settlementCalls,
		verifyCalls,
		persistCalls,
	}, {
		prepareCalls: 0,
		commitCalls: 0,
		reindexCalls: 0,
		settlementCalls: 0,
		verifyCalls: 0,
		persistCalls: 0,
	});
});

test('cross-source creation graph seals elevated risk, acknowledgement, and topological group order', async () => {
	const base = preparation();
	assert.equal(base.ok, true);
	if (!base.ok) return;
	const parentSource = '- [ ] Existing parent {{operonId:: ext0001}}\n';
	const prepared: RuntimeTaskCreationPreparationV1 = {
		...base,
		parentResources: [{
			operonId: 'ext0001',
			filePath: 'Parent.md',
			sourceRevision: sha256HexV1(parentSource),
			sourceContent: parentSource,
			format: 'inline',
			lineNumber: 0,
		}],
		sourceGroupGraph: {
			sourceOrder: ['Parent.md', 'Tasks.md'],
			edges: [{
				fromFilePath: 'Parent.md',
				toFilePath: 'Tasks.md',
				relation: 'parent',
			}],
			crossSourcePartialRisk: true,
		},
	};
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => prepared,
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase11-cross-source-graph-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.equal(preview.plan.riskLevel, 'elevated');
	assert.equal(preview.plan.requiresConfirmation, true);
	assert.deepEqual(
		preview.plan.requiredAcknowledgements,
		['confirm:cross-source-graph-partial-risk'],
	);
	assert.ok(
		preview.warnings.some(warning => warning.code === 'cross-source-graph-partial-risk'),
	);
	assert.deepEqual(
		preview.plan.atomicGroups.map(group => group.groupId),
		['task-source:Parent.md', 'task-source:Tasks.md'],
	);
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);

	const withoutAcknowledgement = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase11-cross-source-graph-apply-without-ack',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(withoutAcknowledgement.status, 'failed');
	assert.equal(withoutAcknowledgement.error?.code, 'invalid-request');
	const confirmed = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase11-cross-source-graph-confirmed-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-confirmation' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [{
			code: 'confirm:cross-source-graph-partial-risk',
			planHash: preview.plan.planHash,
			targetDigest: preview.plan.targets[0].targetDigest,
			acknowledgedAt: preview.plan.createdAt,
		}],
	});
	assert.equal(confirmed.status, 'failed');
	assert.equal(
		confirmed.error?.code,
		'receipt-store-unavailable',
		'confirmed elevated creation must pass acknowledgement and authority admission',
	);
});

test('cross-source graph persists and read-verifies its journal before the first write', async () => {
	const prepared = crossSourcePreparation();
	const events: string[] = [];
	const reindexed: string[][] = [];
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let receipt: MutationReceiptV1 | null = null;
	const admissionToken = Object.freeze({}) as MutationReceiptApplyAdmissionTokenV1;
	const receiptStore = {
		lookupForApplyAdmission: async () => ({
			health: { healthy: true, status: 'healthy', reason: 'ready' },
			receipt,
			journal: journal ? structuredClone(journal) : null,
			admissionToken,
		}),
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			events.push(`journal:${value.phase}:${value.completedStepCount}`);
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			events.push(`journal:${value.phase}:${value.completedStepCount}`);
			journal = structuredClone(value);
		},
		deleteJournal: async () => {
			journal = null;
			return true;
		},
		finalizeReceipt: async () => {
			throw new Error('legacy graph finalize must not run with an admission token');
		},
		finalizeReceiptAfterApplyAdmission: async (
			value: MutationReceiptV1,
			_expectedJournal: GraphTransactionJournalV1,
			_leaseOwner: string,
			token: MutationReceiptApplyAdmissionTokenV1,
		) => {
			assert.equal(token, admissionToken);
			events.push('finalize');
			receipt = value;
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = graphGateway(prepared, receiptStore, {
		commit: async (_prepared, _at, _journal, checkpoint) => {
			events.push('write-start');
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			await checkpoint({ phase: 'committing', completedStepCount: 2 });
			return committedCrossSourceSummary();
		},
		reindexAffectedSources: async filePaths => {
			reindexed.push([...filePaths]);
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply(confirmedCreateApply(preview.plan, 'graph-journal-apply'));
	assert.equal(result.status, 'applied', JSON.stringify({ result, events }));
	assert.equal(events[0], 'journal:prepared:0');
	assert.equal(events[1], 'write-start');
	assert.equal(events.at(-1), 'finalize');
	assert.equal(journal, null);
	assert.ok(receipt);
	assert.deepEqual(
		reindexed,
		[['Parent.md', 'Tasks.md']],
		'committed graph creation must reindex its affected sources exactly once',
	);
	assert.equal(decodeMutationResultV1(result).ok, true);
});

test('live transaction ports route routine single-source creation through the durable journal', async () => {
	const prepared = preparation();
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let legacyCommitCount = 0;
	let transactionCommitCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		finalizeReceipt: async () => {
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => prepared,
		commitCreation: async () => {
			legacyCommitCount += 1;
			return { status: 'failed', groups: [], remainingGroupIds: [] };
		},
		prepareCreationTransaction: async () => ({
			ok: true,
			steps: [{
				stepId: 'task-source',
				groupId: 'task-source:Tasks.md',
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				operation: 'modify',
				before: {
					state: 'present',
					digest: sha256HexV1(sourceBefore),
					content: sourceBefore,
				},
				after: {
					state: 'present',
					digest: sha256HexV1(sourceAfter),
					content: sourceAfter,
				},
			}],
		}),
		commitCreationTransaction: async (_prepared, _at, _journal, checkpoint) => {
			transactionCommitCount += 1;
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			await checkpoint({ phase: 'postflight', completedStepCount: 1 });
			return {
				status: 'committed',
				groups: [{
					groupId: 'task-source:Tasks.md',
					filePath: 'Tasks.md',
					result: {
						status: 'committed',
						resultingRevision: sha256HexV1(sourceAfter),
					},
				}],
				remainingGroupIds: [],
			};
		},
		recoverCreationTransaction: async () => ({
			status: 'outcome-unknown',
			groupResults: [],
			affectedFilePaths: [],
			verified: false,
		}),
		verifyCreationTransactionState: async () => true,
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => {
			throw new Error('durable creation owns hierarchy reconciliation');
		},
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'single-source-journal-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'single-source-journal-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'applied');
	assert.equal(transactionCommitCount, 1);
	assert.equal(legacyCommitCount, 0);
	assert.equal(journal, null);
});

test('cross-source graph execution exceptions preserve one contract-valid unknown group', async () => {
	const prepared = crossSourcePreparation();
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let completedStepCount = -1;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
			completedStepCount = value.completedStepCount;
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = graphGateway(prepared, receiptStore, {
		commit: async (_prepared, _at, _journal, checkpoint) => {
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			throw new Error('Injected graph interruption.');
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply(confirmedCreateApply(preview.plan, 'graph-interrupted'));
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(result.groupResults[0]?.status, 'outcome-unknown');
	assert.equal(decodeMutationResultV1(result).ok, true);
	assert.equal(completedStepCount, 1);
});

test('cross-source graph does not write when another Runtime owns the durable lease', async () => {
	const prepared = crossSourcePreparation();
	let commitCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => null,
		acquireJournal: async () => false,
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = graphGateway(prepared, receiptStore, {
		commit: async () => {
			commitCount += 1;
			return committedCrossSourceSummary();
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply(confirmedCreateApply(preview.plan, 'graph-lease-busy'));
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(commitCount, 0);
});

test('same sealed graph plan resumes an exact committed prefix without a new create', async () => {
	const prepared = crossSourcePreparation();
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let receipt: MutationReceiptV1 | null = null;
	let commitCount = 0;
	let recoveryCount = 0;
	const verifiedStates: string[] = [];
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		deleteJournal: async () => {
			journal = null;
			return true;
		},
		finalizeReceipt: async (value: MutationReceiptV1) => {
			receipt = value;
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = graphGateway(prepared, receiptStore, {
		commit: async (_prepared, _at, _journal, checkpoint) => {
			commitCount += 1;
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			return {
				status: 'partial',
				groups: committedCrossSourceSummary().groups.slice(0, 1),
				remainingGroupIds: ['task-source:Tasks.md'],
			};
		},
		recover: async (_request, _journal, checkpoint) => {
			recoveryCount += 1;
			await checkpoint({ phase: 'committing', completedStepCount: 2 });
			await checkpoint({ phase: 'postflight', completedStepCount: 2 });
			return {
				status: 'forward-completed',
				groupResults: [{
					groupId: 'task-source:Parent.md',
					status: 'committed',
					resourceRevisions: [{
						resourceKind: 'task-source',
						resourceKey: 'Parent.md',
						revision: sha256HexV1('parent-after'),
					}],
				}, {
					groupId: 'task-source:Tasks.md',
					status: 'committed',
					resourceRevisions: [{
						resourceKind: 'task-source',
						resourceKey: 'Tasks.md',
						revision: sha256HexV1(sourceAfter),
					}],
				}],
				affectedFilePaths: ['Parent.md', 'Tasks.md'],
				verified: true,
			};
		},
		verifyCreationTransactionState: async (_journal, expected) => {
			verifiedStates.push(expected);
			return true;
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = confirmedCreateApply(preview.plan, 'graph-prefix-first');
	const first = await gateway.apply(apply);
	assert.equal(first.status, 'outcome-unknown');
	assert.ok(journal);
	const conflictingPlan = structuredClone(preview.plan);
	conflictingPlan.planId = 'phase12-conflicting-plan';
	conflictingPlan.planHash = computeSealedMutationPlanHashV1(conflictingPlan);
	const conflicting = await gateway.apply(
		confirmedCreateApply(conflictingPlan, 'graph-prefix-conflicting-plan'),
	);
	assert.equal(conflicting.status, 'failed');
	assert.equal(conflicting.error?.code, 'stale-plan');
	assert.equal(recoveryCount, 0);
	const recovered = await gateway.apply({
		...apply,
		requestId: 'graph-prefix-recovery',
	});
	assert.equal(recovered.status, 'applied');
	assert.equal(commitCount, 1);
	assert.equal(recoveryCount, 1);
	assert.deepEqual(verifiedStates, ['after']);
	assert.equal(journal, null);
	assert.ok(receipt);
	assert.equal(decodeMutationResultV1(recovered).ok, true);
});

test('verified reverse compensation clears the fence and stays V1 failed', async () => {
	const prepared = crossSourcePreparation();
	const settlementEvents: string[] = [];
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let receipt: MutationReceiptV1 | null = null;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		deleteJournal: async () => {
			settlementEvents.push('delete-journal');
			journal = null;
			return true;
		},
		finalizeReceipt: async (value: MutationReceiptV1) => {
			receipt = value;
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = graphGateway(prepared, receiptStore, {
		commit: async (_prepared, _at, _journal, checkpoint) => {
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			return {
				status: 'partial',
				groups: committedCrossSourceSummary().groups.slice(0, 1),
				remainingGroupIds: ['task-source:Tasks.md'],
			};
		},
		recover: async (_request, _journal, checkpoint) => {
			await checkpoint({ phase: 'compensating', completedStepCount: 1 });
			return {
				status: 'compensated',
				groupResults: [{
					groupId: 'task-source:Parent.md',
					status: 'failed',
				}, {
					groupId: 'task-source:Tasks.md',
					status: 'failed',
				}],
				affectedFilePaths: ['Parent.md', 'Tasks.md'],
				verified: true,
				reason: 'The graph transaction was fully compensated.',
			};
		},
		reindexAffectedSources: async filePaths => {
			settlementEvents.push(`reindex:${filePaths.join(',')}`);
		},
		settleAfterMutation: async () => {
			settlementEvents.push('settle');
		},
		verifyCreationTransactionState: async (_journal, expected) => {
			settlementEvents.push(`verify:${expected}`);
			return true;
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = confirmedCreateApply(preview.plan, 'graph-compensate-first');
	assert.equal((await gateway.apply(apply)).status, 'outcome-unknown');
	const compensated = await gateway.apply({
		...apply,
		requestId: 'graph-compensate-recovery',
	});
	assert.equal(compensated.status, 'failed');
	assert.equal(compensated.mutationMayHaveApplied, false);
	assert.deepEqual(compensated.groupResults.map(group => group.groupId), [
		'task-source:Parent.md',
	]);
	assert.equal(journal, null);
	assert.equal(receipt, null);
	assert.deepEqual(settlementEvents, [
		'reindex:Parent.md,Tasks.md',
		'settle',
		'verify:before',
		'delete-journal',
	]);
	assert.equal(decodeMutationResultV1(compensated).ok, true);
});

test('compensation settlement failure retains the durable same-plan fence', async () => {
	const prepared = crossSourcePreparation();
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let deleteCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		deleteJournal: async () => {
			deleteCount += 1;
			journal = null;
			return true;
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = graphGateway(prepared, receiptStore, {
		commit: async (_prepared, _at, _journal, checkpoint) => {
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			return {
				status: 'partial',
				groups: committedCrossSourceSummary().groups.slice(0, 1),
				remainingGroupIds: ['task-source:Tasks.md'],
			};
		},
		recover: async (_request, _journal, checkpoint) => {
			await checkpoint({ phase: 'compensating', completedStepCount: 1 });
			return {
				status: 'compensated',
				groupResults: [{
					groupId: 'task-source:Parent.md',
					status: 'failed',
				}, {
					groupId: 'task-source:Tasks.md',
					status: 'failed',
				}],
				affectedFilePaths: ['Parent.md', 'Tasks.md'],
				verified: true,
			};
		},
		settleAfterMutation: async () => {
			throw new Error('Injected settlement failure.');
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = confirmedCreateApply(preview.plan, 'graph-compensate-settlement-first');
	assert.equal((await gateway.apply(apply)).status, 'outcome-unknown');
	const result = await gateway.apply({
		...apply,
		requestId: 'graph-compensate-settlement-recovery',
	});
	assert.equal(result.status, 'outcome-unknown');
	assert.deepEqual(result.groupResults.map(group => group.groupId), [
		'task-source:Parent.md',
	]);
	assert.equal(decodeMutationResultV1(result).ok, true);
	assert.ok(journal);
	assert.equal(deleteCount, 0);
});

test('oversized graph journal fails before persistence or source writes', async () => {
	const prepared = crossSourcePreparation();
	let persisted = 0;
	let committed = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => null,
		acquireJournal: async () => {
			persisted += 1;
			return true;
		},
		persistJournal: async () => {
			persisted += 1;
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const oversized = 'x'.repeat(GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1);
	const gateway = graphGateway(prepared, receiptStore, {
		steps: [{
			stepId: 'oversized-source',
			groupId: 'task-source:Tasks.md',
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			operation: 'modify',
			before: {
				state: 'present',
				digest: sha256HexV1(sourceBefore),
				content: sourceBefore,
			},
			after: {
				state: 'present',
				digest: sha256HexV1(oversized),
				content: oversized,
			},
		}],
		commit: async () => {
			committed += 1;
			return committedCrossSourceSummary();
		},
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply(confirmedCreateApply(preview.plan, 'graph-oversized'));
	assert.equal(result.status, 'failed');
	assert.equal(result.error?.code, 'payload-too-large');
	assert.equal(persisted, 0);
	assert.equal(committed, 0);
});

test('temporal creation seals repeat-series in its source group and receipt replay is write-free', async () => {
	const seriesId = 'series-create-1';
	const prepared = temporalPreparation(seriesId);
	let receipt: Parameters<IndexedDbMutationReceiptStoreV1['persist']>[0] | null = null;
	let commitCount = 0;
	let observedSealedSeriesId = '';
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		persist: async (value: NonNullable<typeof receipt>) => {
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async (_requestId, _spec, _ids, _at, _refs, seriesIds) => {
			observedSealedSeriesId = seriesIds?.get('task-one') ?? observedSealedSeriesId;
			return prepared;
		},
		commitCreation: async () => {
			commitCount += 1;
			return {
				status: 'committed',
				groups: [{
					groupId: 'task-source:Tasks.md',
					filePath: 'Tasks.md',
					result: {
						status: 'committed',
						resultingRevision: sha256HexV1(sourceAfter),
						resourceRevisions: [{
							resourceKind: 'task-source',
							resourceKey: 'Tasks.md',
							revision: sha256HexV1(sourceAfter),
						}, {
							resourceKind: 'repeat-series',
							resourceKey: seriesId,
							revision: 'repeat-after',
						}],
					},
				}],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({
			ok: true,
			resourceRevisions: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				revision: sha256HexV1(sourceAfter),
			}, {
				resourceKind: 'repeat-series',
				resourceKey: seriesId,
				revision: 'repeat-after',
			}],
		}),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'e'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:01:00.000Z'),
		randomId: () => 'temporal-create-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.deepEqual(preview.plan.atomicGroups[0].resources, [{
		resourceKind: 'repeat-series',
		resourceKey: seriesId,
	}, {
		resourceKind: 'task-source',
		resourceKey: 'Tasks.md',
	}]);
	assert.equal(preview.plan.createEffects?.[0].repeatSeriesId, seriesId);
	assert.ok(preview.plan.affectedResources.some(resource => (
		resource.resourceKind === 'repeat-series'
			&& resource.resourceKey === seriesId
			&& resource.revision === 'repeat-before'
	)));
	const apply = await gateway.apply({
		contractVersion: 1,
		requestId: 'temporal-create-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(apply.status, 'applied');
	assert.equal(observedSealedSeriesId, seriesId);
	assert.equal(commitCount, 1);
	assert.deepEqual(
		apply.groupResults[0]?.resourceRevisions?.map(resource => ({
			resourceKind: resource.resourceKind,
			resourceKey: resource.resourceKey,
		})),
		preview.plan.atomicGroups[0]?.resources,
	);
	assert.equal(admitMutationResultV1(apply, {
		contractVersion: 1,
		requestId: 'temporal-create-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	}, {
		vaultIdentityHash: 'e'.repeat(64),
		clientInstanceId: request.clientInstanceId,
	}).ok, true);
	const replay = await gateway.apply({
		contractVersion: 1,
		requestId: 'temporal-create-replay',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(replay.status, 'already-applied');
	assert.equal(commitCount, 1);
});

test('temporal receipt persistence failure keeps same-plan recovery write-free', async () => {
	const seriesId = 'series-receipt-failure';
	const prepared = temporalPreparation(seriesId);
	let commitCount = 0;
	let persistCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		persist: async () => {
			persistCount += 1;
			throw new Error('RECEIPT_PERSIST_FAILED');
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => (
			commitCount === 0
				? prepared
				: {
					ok: false,
					code: 'stale-source',
					reason: `Sealed repeat series already exists: ${seriesId}`,
				}
		),
		commitCreation: async () => {
			commitCount += 1;
			return {
				status: 'committed',
				groups: [{
					groupId: 'task-source:Tasks.md',
					filePath: 'Tasks.md',
					result: {
						status: 'committed',
						resultingRevision: sha256HexV1(sourceAfter),
						resourceRevisions: [{
							resourceKind: 'task-source',
							resourceKey: 'Tasks.md',
							revision: sha256HexV1(sourceAfter),
						}, {
							resourceKind: 'repeat-series',
							resourceKey: seriesId,
							revision: 'repeat-after',
						}],
					},
				}],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({
			ok: true,
			resourceRevisions: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				revision: sha256HexV1(sourceAfter),
			}, {
				resourceKind: 'repeat-series',
				resourceKey: seriesId,
				revision: 'repeat-after',
			}],
		}),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'e'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:01:00.000Z'),
		randomId: () => 'temporal-receipt-failure-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const applyRequest = {
		contractVersion: 1 as const,
		requestId: 'temporal-receipt-failure-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	};
	const first = await gateway.apply(applyRequest);
	assert.equal(first.status, 'outcome-unknown');
	assert.equal(first.ambiguitySource, 'receipt-persist-failure');
	assert.equal(first.postflight?.status, 'verified');
	assert.equal(commitCount, 1);
	assert.equal(persistCount, 1);

	const recovered = await gateway.apply({
		...applyRequest,
		requestId: 'temporal-receipt-failure-recover',
	});
	assert.equal(recovered.status, 'failed');
	assert.equal(recovered.error?.code, 'stale-source');
	assert.equal(commitCount, 1, 'same-plan recovery must not commit an existing repeat series twice');
	assert.equal(persistCount, 1, 'pre-commit recovery refusal must not attempt another receipt write');
});

test('temporal apply refuses repeat-series revision drift before commit', async () => {
	const prepared = temporalPreparation('series-stale-context');
	let sampledRevision = revision;
	let commitCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		persist: async () => ({ expiredDeleted: 0, overflowDeleted: 0, retained: 1 }),
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => sampledRevision,
		prepareCreation: async () => prepared,
		commitCreation: async () => {
			commitCount += 1;
			return { status: 'failed', groups: [], remainingGroupIds: [] };
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'e'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:01:00.000Z'),
		randomId: () => 'temporal-stale-context-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	sampledRevision = { ...revision, repeatSeriesRevision: revision.repeatSeriesRevision + 1 };
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'temporal-stale-context-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error?.code, 'stale-context');
	assert.equal(commitCount, 0);
});

for (const stateFailure of ['missing', 'corrupt'] as const) {
	test(`temporal ${stateFailure} repeat-series postflight is fenced from replay`, async () => {
		const seriesId = `series-postflight-${stateFailure}`;
		const prepared = temporalPreparation(seriesId);
		let receipt: MutationReceiptV1 | null = null;
		let commitCount = 0;
		const receiptStore = {
			health: async () => ({ healthy: true }),
			lookup: async () => receipt,
			persist: async (value: MutationReceiptV1) => {
				receipt = value;
				return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
			},
		} as unknown as IndexedDbMutationReceiptStoreV1;
		const gateway = new RuntimeMutationGatewayV1({
			isReady: () => true,
			sampleContextRevision: () => revision,
			prepareCreation: async () => prepared,
			commitCreation: async () => {
				commitCount += 1;
				return {
					status: 'committed',
					groups: [{
						groupId: 'task-source:Tasks.md',
						filePath: 'Tasks.md',
						result: {
							status: 'committed',
							resultingRevision: sha256HexV1(sourceAfter),
							resourceRevisions: [{
								resourceKind: 'task-source',
								resourceKey: 'Tasks.md',
								revision: sha256HexV1(sourceAfter),
							}, {
								resourceKind: 'repeat-series',
								resourceKey: seriesId,
								revision: 'repeat-after',
							}],
						},
					}],
					remainingGroupIds: [],
				};
			},
			reindexAffectedSources: async () => undefined,
			settleAfterMutation: async () => undefined,
			reconcileCreatedHierarchy: async () => ({
				ok: true,
				resourceRevisions: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					revision: sha256HexV1(sourceAfter),
				}, {
					resourceKind: 'repeat-series',
					resourceKey: seriesId,
					revision: 'repeat-after',
				}],
			}),
			verifyCreatedTasks: async (_candidate, _revision, _effectiveAt, groups) => {
				const sealedStateRevision = groups.flatMap(
					group => group.resourceRevisions ?? [],
				).find(resource => (
					resource.resourceKind === 'repeat-series'
					&& resource.resourceKey === seriesId
				))?.revision;
				const liveEntry = stateFailure === 'missing'
					? null
					: { seriesId, sourceTaskId: 'wrong-task', revision: 'repeat-after' };
				return liveEntry !== null
					&& liveEntry.sourceTaskId === prepared.recurrenceResources[0].operonId
					&& liveEntry.revision === sealedStateRevision;
			},
			receiptStore: () => receiptStore,
			vaultIdentityHash: async () => 'e'.repeat(64),
			nowEpochMs: () => Date.parse('2026-07-24T08:01:00.000Z'),
			randomId: () => `temporal-postflight-${stateFailure}-plan`,
		});
		const preview = await gateway.preview(request);
		assert.equal(preview.ok, true);
		if (!preview.ok) return;
		const applyRequest = {
			contractVersion: 1 as const,
			requestId: `temporal-postflight-${stateFailure}-apply`,
			kind: 'mutation-apply' as const,
			plan: preview.plan,
			authorization: { basis: 'user-explicit-request' as const },
			idempotencyKey: request.idempotencyKey,
			acknowledgements: [],
		};
		const first = await gateway.apply(applyRequest);
		assert.equal(first.status, 'outcome-unknown');
		assert.equal(first.receipt?.terminalOutcome, 'outcome-unknown');
		assert.equal(first.retryAllowed, false);
		assert.equal(commitCount, 1);
		const replay = await gateway.apply({
			...applyRequest,
			requestId: `temporal-postflight-${stateFailure}-replay`,
		});
		assert.equal(replay.status, 'outcome-unknown');
		assert.equal(replay.receipt?.terminalOutcome, 'outcome-unknown');
		assert.equal(commitCount, 1);
	});
}

test('creation preview explains reciprocal dependency writes and partial apply is durably fenced', async () => {
	const base = preparation();
	assert.equal(base.ok, true);
	if (!base.ok) return;
	const existingBefore = '- [ ] Existing target {{operonId:: ext0001}}\n';
	const existingAfter = '- [ ] Existing target {{operonId:: ext0001}} {{blockedBy:: abc1234}}\n';
	const prepared: RuntimeTaskCreationPreparationV1 = {
		...base,
		plan: {
			...base.plan,
			sourceGroups: [
				base.plan.sourceGroups[0],
				{
					groupId: 'task-source:Existing.md',
					filePath: 'Existing.md',
					expectedRevision: sha256HexV1(existingBefore),
					expectedState: 'present',
					expectedContent: existingBefore,
					operation: 'update',
					resultingContent: existingAfter,
					taskItemKeys: [],
				},
			],
		},
		dependencyResources: [{
			operonId: 'ext0001',
			filePath: 'Existing.md',
			format: 'inline',
			lineNumber: 0,
			additions: { blocking: [], blockedBy: ['abc1234'] },
			expectedModifiedAt: '2026-07-24T08:00:00.000Z',
		}],
		sourceGroupGraph: {
			sourceOrder: ['Tasks.md', 'Existing.md'],
			edges: [],
			crossSourcePartialRisk: false,
		},
	};
	let receipt: MutationReceiptV1 | null = null;
	let commitCount = 0;
	const reindexed: string[][] = [];
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		persist: async (value: MutationReceiptV1) => {
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => prepared,
		commitCreation: async () => {
			commitCount += 1;
			return {
				status: 'partial',
				groups: [
					{
						groupId: 'task-source:Tasks.md',
						filePath: 'Tasks.md',
						result: {
							status: 'committed',
							resultingRevision: sha256HexV1(sourceAfter),
						},
					},
					{
						groupId: 'task-source:Existing.md',
						filePath: 'Existing.md',
						result: { status: 'conflict', reason: 'source drifted' },
					},
				],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async filePaths => {
			reindexed.push([...filePaths]);
		},
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase11-dependency-partial-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const reciprocalEffect = preview.plan.predictedEffects.find(
		effect => effect.resourceKey === 'Existing.md',
	);
	assert.match(reciprocalEffect?.summary ?? '', /reciprocal dependency target/u);
	assert.doesNotMatch(reciprocalEffect?.summary ?? '', /Create 0/u);
	const apply = {
		contractVersion: 1 as const,
		requestId: 'phase11-dependency-partial-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	};
	const result = await gateway.apply(apply);
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(result.retryAllowed, false);
	assert.equal(result.receipt?.terminalOutcome, 'outcome-unknown');
	assert.deepEqual(reindexed, [['Tasks.md']]);
	assert.equal(commitCount, 1);
	const replay = await gateway.apply({ ...apply, requestId: 'phase11-dependency-partial-replay' });
	assert.equal(replay.status, 'outcome-unknown');
	assert.equal(replay.retryAllowed, false);
	assert.equal(commitCount, 1, 'an uncertain receipt must fence the creation from replay');
});

test('same receipt scope serializes concurrent applies across Runtime Gateway instances', async () => {
	let receipt: Parameters<IndexedDbMutationReceiptStoreV1['persist']>[0] | null = null;
	let committed = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		persist: async (value: NonNullable<typeof receipt>) => {
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gatewayPorts: RuntimeMutationGatewayPortsV1 = {
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => {
			committed += 1;
			await new Promise(resolve => setTimeout(resolve, 10));
			return {
				status: 'committed',
				groups: [{
					groupId: 'task-source:Tasks.md',
					filePath: 'Tasks.md',
					result: { status: 'committed', resultingRevision: sha256HexV1(sourceAfter) },
				}],
				remainingGroupIds: [],
			};
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({
			ok: true,
			resourceRevisions: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				revision: sha256HexV1(sourceAfter),
			}],
		}),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-plan-concurrent',
	};
	const gateway = new RuntimeMutationGatewayV1(gatewayPorts);
	const competingGateway = new RuntimeMutationGatewayV1(gatewayPorts);
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const competingPlan = structuredClone(preview.plan);
	competingPlan.planId = 'phase7-competing-plan';
	competingPlan.planHash = computeSealedMutationPlanHashV1(competingPlan);
	const baseApply = {
		contractVersion: 1 as const,
		kind: 'mutation-apply' as const,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	};
	const [first, second] = await Promise.all([
		gateway.apply({ ...baseApply, requestId: 'phase7-concurrent-first', plan: preview.plan }),
		competingGateway.apply({ ...baseApply, requestId: 'phase7-concurrent-second', plan: competingPlan }),
	]);
	assert.equal(first.status, 'applied');
	assert.equal(second.status, 'failed');
	assert.equal(second.error?.code, 'stale-plan');
	assert.equal(committed, 1);
});

test('preview rejects unsafe tags and semantic fields disguised as custom keys', async () => {
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => {
			throw new Error('invalid input reached the creation adapter');
		},
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-plan',
	});
	const unsafeTag = structuredClone(request);
	unsafeTag.requestId = 'phase7-unsafe-tag';
	assert.equal(unsafeTag.spec.operation, 'create');
	if (unsafeTag.spec.operation !== 'create') return;
	unsafeTag.spec.items[0].tags = ['safe\n- [ ] injected'];
	const unsafeResult = await gateway.preview(unsafeTag);
	assert.equal(unsafeResult.ok, false);
	if (!unsafeResult.ok) assert.equal(unsafeResult.error.code, 'invalid-request');

	const unsafeList = structuredClone(request);
	unsafeList.requestId = 'phase7-unsafe-list-delimiter';
	assert.equal(unsafeList.spec.operation, 'create');
	if (unsafeList.spec.operation !== 'create') return;
	unsafeList.spec.items[0].fields = [{
		kind: 'list',
		field: 'contexts',
		value: ['first; second'],
	}];
	const unsafeListResult = await gateway.preview(unsafeList);
	assert.equal(unsafeListResult.ok, false);
	if (!unsafeListResult.ok) assert.equal(unsafeListResult.error.code, 'invalid-request');

	const rawStatus = structuredClone(request);
	rawStatus.requestId = 'phase7-custom-status';
	assert.equal(rawStatus.spec.operation, 'create');
	if (rawStatus.spec.operation !== 'create') return;
	rawStatus.spec.items[0].fields = [{
		kind: 'custom',
		field: 'status',
		valueType: 'text',
		value: 'Forged.Status',
	}];
	const rawStatusResult = await gateway.preview(rawStatus);
	assert.equal(rawStatusResult.ok, false);
	if (!rawStatusResult.ok) assert.equal(rawStatusResult.error.code, 'invalid-request');
});

test('preview fails closed after repeated context drift', async () => {
	let generation = 0;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => ({
			...revision,
			index: { ...revision.index, ramGeneration: generation++ },
		}),
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-plan',
	});
	const result = await gateway.preview(request);
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'live-settling');
});

test('expired preview deadline fails before mutation preparation starts', async () => {
	let preparationCount = 0;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => {
			preparationCount += 1;
			return preparation();
		},
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-plan',
	});
	const result = await gateway.preview(request, { deadlineAtMs: Date.now() - 1 });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, 'live-settling');
		assert.equal(result.error.retryable, true);
	}
	assert.equal(preparationCount, 0);
});

test('in-flight preview cannot build a late plan after its deadline', async () => {
	const previousActiveWindow = Reflect.get(globalThis, 'activeWindow');
	Reflect.set(globalThis, 'activeWindow', globalThis);
	let releasePreparation: (() => void) | undefined;
	const preparationGate = new Promise<void>(resolve => {
		releasePreparation = resolve;
	});
	let randomIdCount = 0;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => {
			await preparationGate;
			return preparation();
		},
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => {
			randomIdCount += 1;
			return 'phase7-plan';
		},
	});
	try {
		const deadlineAtMs = Date.now() + 5;
		const result = await gateway.preview(request, { deadlineAtMs });
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, 'live-settling');
		const remainingMs = Math.max(0, deadlineAtMs - Date.now() + 1);
		await new Promise(resolve => setTimeout(resolve, remainingMs));
		releasePreparation?.();
		await new Promise(resolve => setImmediate(resolve));
		assert.equal(randomIdCount, 0);
	} finally {
		if (previousActiveWindow === undefined) {
			Reflect.deleteProperty(globalThis, 'activeWindow');
		} else {
			Reflect.set(globalThis, 'activeWindow', previousActiveWindow);
		}
	}
});

test('apply fails closed when semantic context drifts during apply-time preparation', async () => {
	let sampleCount = 0;
	let prepareCount = 0;
	let committed = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		persist: async () => ({ expiredDeleted: 0, overflowDeleted: 0, retained: 1 }),
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => {
			sampleCount += 1;
			return sampleCount >= 4
				? { ...revision, settingsFingerprint: 'e'.repeat(64) }
				: revision;
		},
		prepareCreation: async () => {
			prepareCount += 1;
			return preparation();
		},
		commitCreation: async () => {
			committed += 1;
			return { status: 'failed', groups: [], remainingGroupIds: [] };
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-semantic-drift-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase7-semantic-drift-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(prepareCount, 3);
	assert.equal(result.status, 'failed');
	assert.equal(result.error?.code, 'stale-context');
	assert.equal(committed, 0);
});

test('a post-commit exception is reported as non-retryable outcome unknown', async () => {
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		persist: async () => {
			throw new Error('receipt persistence must not be reached');
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({
			status: 'committed',
			groups: [{
				groupId: 'task-source:Tasks.md',
				filePath: 'Tasks.md',
				result: { status: 'committed', resultingRevision: sha256HexV1(sourceAfter) },
			}],
			remainingGroupIds: [],
		}),
		reindexAffectedSources: async () => {
			throw new Error('simulated post-commit reindex failure');
		},
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-post-commit-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase7-post-commit-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(result.mutationMayHaveApplied, true);
	assert.equal(result.retryAllowed, false);
	assert.equal(result.ambiguitySource, 'group-outcome');
	assert.equal(result.groupResults[0]?.status, 'outcome-unknown');
});

test('an uncertain durable receipt blocks replay without reapplying', async () => {
	let committed = 0;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => {
			committed += 1;
			return { status: 'failed', groups: [], remainingGroupIds: [] };
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => ({
			health: async () => ({ healthy: true }),
			lookup: async (scope: MutationReceiptScopeV1) => ({
				contractVersion: 1,
				...scope,
				planHash: uncertainPlanHash,
				targetDigest: uncertainTargetDigest,
				terminalOutcome: 'outcome-unknown',
				effectiveAt: '2026-07-24T08:00:00.000Z',
				completedAt: '2026-07-24T08:00:01.000Z',
				expiresAt: '2026-07-25T08:00:01.000Z',
			}),
		} as unknown as IndexedDbMutationReceiptStoreV1),
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-uncertain-receipt-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const uncertainPlanHash = preview.plan.planHash;
	const uncertainTargetDigest = preview.plan.receiptTargetDigest;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase7-uncertain-receipt-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(result.retryAllowed, false);
	assert.equal(committed, 0);
});

test('same pinned-state plan finalizes an exact after-state without a second write', async () => {
	let planHash = '';
	let targetDigest = '';
	let commits = 0;
	let recovered = 0;
	let persistedOutcome = '';
	const pinnedRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'pinned-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'pinned-idempotency-key',
		capability: 'tasks.pinned.preview',
		mutationKind: 'task.pinned-state',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
		},
		spec: { operation: 'set-pinned', pinned: true },
		authorization: { basis: 'user-explicit-request' },
	};
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async (scope: MutationReceiptScopeV1) => planHash
			? {
				contractVersion: 1 as const,
				...scope,
				planHash,
				targetDigest,
				terminalOutcome: 'outcome-unknown' as const,
				effectiveAt: '2026-07-24T08:00:00.000Z',
				completedAt: '2026-07-24T08:00:01.000Z',
				expiresAt: '2026-07-25T08:00:01.000Z',
			}
			: null,
		persist: async (receipt: MutationReceiptV1) => {
			persistedOutcome = receipt.terminalOutcome;
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		prepareMutation: async (_request, effectiveAt) => ({
			ok: true,
			value: {
				target: {
					operonId: 'abc1234',
					locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
					targetDigest: 'e'.repeat(64),
				},
				affectedResources: [{
					resourceKind: 'pinned',
					resourceKey: 'abc1234',
					revision: 'f'.repeat(64),
				}],
				predictedEffects: [{
					resourceKind: 'pinned',
					resourceKey: 'abc1234',
					action: 'state-change',
					summary: 'Pin task abc1234.',
				}],
				warnings: [],
				sealedSpec: {
					operation: 'set-pinned',
					pinned: true,
					expectedPinned: false,
					expectedEntryRevision: 'f'.repeat(64),
					effectiveAt,
				},
				token: { kind: 'pinned-state' },
			},
		}),
		commitMutation: async () => {
			commits += 1;
			return { status: 'committed', groupResults: [], affectedFilePaths: [] };
		},
		verifyMutation: async () => true,
		recoverMutation: async () => {
			recovered += 1;
			return true;
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'pinned-plan',
	});
	const preview = await gateway.preview(pinnedRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	planHash = preview.plan.planHash;
	targetDigest = preview.plan.receiptTargetDigest;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'pinned-recover',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: pinnedRequest.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'already-applied');
	assert.equal(recovered, 1);
	assert.equal(commits, 0);
	assert.equal(persistedOutcome, 'already-applied');
});

test('receipt lookup failure stays a structured retryable pre-commit failure', async () => {
	let committed = 0;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => {
			committed += 1;
			return { status: 'failed', groups: [], remainingGroupIds: [] };
		},
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		receiptStore: () => ({
			health: async () => ({ healthy: true }),
			lookup: async () => {
				throw new Error('simulated receipt lookup failure');
			},
		} as unknown as IndexedDbMutationReceiptStoreV1),
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase7-receipt-lookup-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase7-receipt-lookup-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error?.code, 'receipt-store-unavailable');
	assert.equal(result.retryAllowed, true);
	assert.equal(result.mutationMayHaveApplied, false);
	assert.equal(committed, 0);
});

test('destructive preview is inspectable from an explicit request but apply requires fresh confirmation', async () => {
	const target = {
		operonId: 'abc1234',
		locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
	};
	const destructiveRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'phase8-delete-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-delete-key',
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target,
		spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false },
		authorization: { basis: 'user-explicit-request' },
	};
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({
			ok: true,
			value: {
				target: { ...target, targetDigest: 'd'.repeat(64) },
				affectedResources: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					revision: 'e'.repeat(64),
				}],
				predictedEffects: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					action: 'update',
					summary: 'Delete the exact inline task.',
				}],
				warnings: [],
				riskLevel: 'destructive',
				requiredAcknowledgements: ['confirm:delete:abc1234'],
				token: {},
			},
		}),
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-delete-plan',
	});
	const preview = await gateway.preview(destructiveRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.equal(preview.plan.requiresConfirmation, true);
	assert.equal(preview.plan.riskLevel, 'destructive');
	assert.equal(preview.plan.requiredAcknowledgements[0], 'confirm:delete:abc1234');
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);

	const withoutConfirmation = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase8-delete-apply-without-confirmation',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: destructiveRequest.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(withoutConfirmation.status, 'failed');
	assert.equal(withoutConfirmation.error?.code, 'invalid-request');

	const standing = await gateway.preview({
		...destructiveRequest,
		requestId: 'phase8-delete-standing',
		authorization: { basis: 'user-standing-instruction' },
	});
	assert.equal(standing.ok, false);
	if (!standing.ok) assert.equal(standing.error.code, 'authority-insufficient');
});

test('unassigned timer preview seals an active-tracker-only target', async () => {
	const timerRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'phase8-unassigned-timer-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-unassigned-timer-key',
		capability: 'timers.control.preview',
		mutationKind: 'timer.control',
		spec: { operation: 'start' },
		authorization: { basis: 'user-explicit-request' },
	};
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({
			ok: true,
			value: {
				target: { targetDigest: 'f'.repeat(64) },
				affectedResources: [{
					resourceKind: 'active-tracker',
					resourceKey: 'current-user',
					revision: 'a'.repeat(64),
				}],
				predictedEffects: [{
					resourceKind: 'active-tracker',
					resourceKey: 'current-user',
					action: 'state-change',
					summary: 'Start the unassigned timer.',
				}],
				warnings: [],
				token: {},
			},
		}),
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-unassigned-timer-plan',
	});
	const preview = await gateway.preview(timerRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.equal(preview.plan.targets[0]?.operonId, undefined);
	assert.equal(preview.plan.targets[0]?.locator, undefined);
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);
});

test('elevated relocation preview preserves a non-destructive acknowledgement', async () => {
	const target = {
		operonId: 'abc1234',
		locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
	};
	const sealedRelocationSpec = {
		operation: 'relocate-inline' as const,
		source: {
			locator: target.locator,
			lineDigest: '3'.repeat(64),
			sourceRevision: {
				algorithm: 'sha256' as const,
				contentDigest: '2'.repeat(64),
			},
		},
		destination: {
			locator: { representation: 'inline' as const, filePath: 'Other.md', lineNumber: 2 },
			lineDigest: '4'.repeat(64),
			sourceRevision: {
				algorithm: 'sha256' as const,
				contentDigest: '2'.repeat(64),
			},
			mustBeBlank: true as const,
		},
	};
	const acknowledgement = 'confirm:relocate-attached-checkboxes:0123456789abcdef';
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({
			ok: true,
			value: {
				target: { ...target, targetDigest: '1'.repeat(64) },
				affectedResources: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					revision: '2'.repeat(64),
				}],
				predictedEffects: [{
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					action: 'update',
					summary: 'Relocate one exact inline task.',
				}],
				warnings: [{
					code: 'attached-checkbox-scope-changes',
					message: 'Moving the task changes attached checkbox scope.',
				}],
				riskLevel: 'elevated',
				requiredAcknowledgements: [acknowledgement],
				sealedSpec: sealedRelocationSpec,
				token: {},
			},
		}),
		receiptStore: () => null,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-relocation-plan',
	});
	const preview = await gateway.preview({
		contractVersion: 1,
		requestId: 'phase8-relocation-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-relocation-key',
		capability: 'tasks.inline.relocate.preview',
		mutationKind: 'task.inline-relocate',
		target,
		spec: {
			operation: 'relocate-inline',
			destination: {
				locator: { representation: 'inline', filePath: 'Other.md', lineNumber: 2 },
				mustBeBlank: true,
			},
		},
		authorization: { basis: 'user-explicit-request' },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.equal(preview.plan.riskLevel, 'elevated');
	assert.equal(preview.plan.requiresConfirmation, true);
	assert.deepEqual(preview.plan.requiredAcknowledgements, [acknowledgement]);
	assert.deepEqual(preview.plan.spec, sealedRelocationSpec);
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);
});

test('non-create receipt persistence ambiguity remains contract-valid', async () => {
	const updateRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'phase8-update-preview-receipt-failure',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-update-receipt-failure',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
		},
		spec: {
			operation: 'update',
			changes: [{ field: 'note', valueType: 'text', value: 'Updated note' }],
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		persist: async () => {
			throw new Error('PERSIST_FAILED');
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const prepared = {
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			revision: 'e'.repeat(64),
		}],
		predictedEffects: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			action: 'update' as const,
			summary: 'Update one task field.',
		}],
		warnings: [],
		token: { kind: 'test-update' },
	};
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => ({
			status: 'committed',
			groupResults: [{
				groupId: 'task-source:Tasks.md',
				status: 'committed',
				resourceRevisions: prepared.affectedResources,
			}],
			affectedFilePaths: ['Tasks.md'],
		}),
		verifyMutation: async () => true,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-update-plan',
	});
	const preview = await gateway.preview(updateRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'phase8-update-apply-receipt-failure',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: updateRequest.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(result.ambiguitySource, 'receipt-persist-failure');
	assert.deepEqual(result.groupResults, []);
	assert.equal(result.postflight?.status, 'verified');
	const decoded = decodeMutationResultV1(result);
	assert.equal(decoded.ok, true, decoded.ok ? undefined : JSON.stringify(decoded.issues));
});

test('a partially committed prepared mutation is surfaced as an explicit outcome-unknown group', async () => {
	const updateRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'phase8-update-preview-partial',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-update-partial',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
		},
		spec: {
			operation: 'update',
			changes: [{ field: 'note', valueType: 'text', value: 'Updated note' }],
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const prepared = {
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Related.md',
			revision: 'e'.repeat(64),
		}, {
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			revision: 'f'.repeat(64),
		}],
		atomicGroups: [{
			groupId: 'task-source:Related.md',
			order: 0,
			resources: [{ resourceKind: 'task-source' as const, resourceKey: 'Related.md' }],
		}, {
			groupId: 'task-source:Tasks.md',
			order: 1,
			resources: [{ resourceKind: 'task-source' as const, resourceKey: 'Tasks.md' }],
		}],
		predictedEffects: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			action: 'update' as const,
			summary: 'Update one task field.',
		}],
		warnings: [],
		token: { kind: 'test-update' },
	};
	let persistedReceipt: Parameters<IndexedDbMutationReceiptStoreV1['persist']>[0] | null = null;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => ({
			status: 'partial',
			groupResults: [{
				groupId: 'task-source:Related.md',
				status: 'committed',
				resourceRevisions: [prepared.affectedResources[0]],
			}, {
				groupId: 'task-source:Tasks.md',
				status: 'failed',
				resourceRevisions: [prepared.affectedResources[1]],
				error: {
					contractVersion: 1,
					code: 'internal-error',
					reason: 'The second atomic group did not report a durable outcome.',
					retryable: false,
					action: 'report-bug',
				},
			}],
			affectedFilePaths: ['Tasks.md', 'Related.md'],
			reason: 'The second atomic group did not report a durable outcome.',
		}),
		verifyMutation: async () => false,
		receiptStore: () => ({
			health: async () => ({ healthy: true }),
			lookup: async () => null,
			persist: async (value: MutationReceiptV1) => {
				persistedReceipt = value;
				return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
			},
		}) as unknown as IndexedDbMutationReceiptStoreV1,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-update-partial-plan',
	});
	const preview = await gateway.preview(updateRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = {
		contractVersion: 1,
		requestId: 'phase8-update-apply-partial',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: updateRequest.idempotencyKey,
		acknowledgements: [],
	};
	const decodedApply = decodeMutationApplyRequestV1(apply);
	assert.equal(decodedApply.ok, true, decodedApply.ok ? undefined : JSON.stringify(decodedApply.issues));
	const result = await gateway.apply(apply);
	assert.equal(result.status, 'outcome-unknown', JSON.stringify(result));
	assert.equal(result.ambiguitySource, 'group-outcome');
	assert.equal(result.groupResults[0]?.status, 'committed');
	assert.equal(result.groupResults[1]?.status, 'outcome-unknown');
	assert.equal(result.receipt?.terminalOutcome, 'outcome-unknown');
	assert.ok(persistedReceipt);
	const decoded = decodeMutationResultV1(result);
	assert.equal(decoded.ok, true, decoded.ok ? undefined : JSON.stringify(decoded.issues));
});

test('prepared mutation postflight failure persists an uncertain receipt and fences replay', async () => {
	const updateRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'phase8-update-preview-postflight-failure',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-update-postflight-failure',
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 1 },
		},
		spec: {
			operation: 'update',
			changes: [{ field: 'note', valueType: 'text', value: 'Updated note' }],
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const prepared = {
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			revision: 'e'.repeat(64),
		}],
		predictedEffects: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks.md',
			action: 'update' as const,
			summary: 'Update one task field.',
		}],
		warnings: [],
		token: { kind: 'test-update' },
	};
	let receipt: Parameters<IndexedDbMutationReceiptStoreV1['persist']>[0] | null = null;
	let commitCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		persist: async (value: NonNullable<typeof receipt>) => {
			receipt = value;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => {
			commitCount += 1;
			return {
				status: 'committed',
				groupResults: [{
					groupId: 'task-source:Tasks.md',
					status: 'committed',
					resourceRevisions: prepared.affectedResources,
				}],
				affectedFilePaths: ['Tasks.md'],
			};
		},
		verifyMutation: async () => {
			throw new Error('POSTFLIGHT_FAILED');
		},
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-update-postflight-plan',
	});
	const preview = await gateway.preview(updateRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = {
		contractVersion: 1 as const,
		requestId: 'phase8-update-postflight-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: updateRequest.idempotencyKey,
		acknowledgements: [],
	};
	const first = await gateway.apply(apply);
	assert.equal(first.status, 'outcome-unknown', JSON.stringify(first));
	assert.equal(first.receipt?.terminalOutcome, 'outcome-unknown');
	assert.equal(first.retryAllowed, false);
	assert.equal(commitCount, 1);
	const replay = await gateway.apply({ ...apply, requestId: 'phase8-update-postflight-replay' });
	assert.equal(replay.status, 'outcome-unknown');
	assert.equal(replay.receipt?.terminalOutcome, 'outcome-unknown');
	assert.equal(commitCount, 1);
});

async function characterizePreparedTaskUpdateSettlement(
	caseId: string,
	committedContent: string,
	settledContent: string,
	options: {
		modifiedTimeFrontmatterKeys?: readonly string[];
		operation?: 'update' | 'transition';
		postRefreshContent?: string;
		representation?: 'inline' | 'file';
		refreshThrows?: boolean;
		previewEpochMs?: number;
		applyStartedAtEpochMs?: number;
		settlementObservedAtEpochMs?: number;
	} = {},
) {
	const filePath = 'Tasks.md';
	const operation = options.operation ?? 'update';
	const representation = options.representation ?? 'inline';
	const targetLineNumber = committedContent.split('\n').findIndex(line => line.includes('operonId:: abc1234'));
	if (representation === 'inline') {
		assert.notEqual(targetLineNumber, -1, 'The settlement fixture must contain the target task.');
	}
	const locator = representation === 'inline'
		? { representation: 'inline' as const, filePath, lineNumber: targetLineNumber }
		: { representation: 'file' as const, filePath };
	let durableContent = committedContent;
	let commitCount = 0;
	const events: string[] = [];
	const defaultApplyStartedAtEpochMs = new Date(2026, 6, 24, 12, 0, 0).getTime();
	const defaultSettlementObservedAtEpochMs = new Date(2026, 6, 24, 12, 0, 2).getTime();
	let nowEpochMs = options.previewEpochMs ?? defaultApplyStartedAtEpochMs;
	const updateRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: `phase8-update-preview-${caseId}`,
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: `phase8-update-${caseId}`,
		capability: operation === 'transition' ? 'tasks.transition.preview' : 'tasks.update.preview',
		mutationKind: operation === 'transition' ? 'task.transition' : 'task.update',
		target: {
			operonId: 'abc1234',
			locator,
		},
		spec: operation === 'transition'
			? { operation: 'transition', targetStatusId: 'done' }
			: {
				operation: 'update',
				changes: representation === 'inline'
					? [{ field: 'description', valueType: 'text', value: 'Updated description' }]
					: [{ field: 'priority', valueType: 'text', value: 'A' }],
			},
		authorization: { basis: 'user-explicit-request' },
	};
	const committedRevision = sha256HexV1(committedContent);
	const taskFieldPreparation: RuntimeTaskFieldMutationPreparationV1 = {
		kind: 'task-fields',
		operation,
		task: {
			operonId: 'abc1234',
			locator,
			description: representation === 'inline' ? 'Before update' : 'Tasks',
			checkbox: 'open',
			fieldValues: {
				...(representation === 'file' ? { priority: 'F' } : {}),
				datetimeModified: '2026-07-24T11:59:59',
			},
			tags: [],
			sourceContent: committedContent,
			duplicate: false,
		},
		fieldValues: operation === 'transition'
			? {
				_checkbox: 'done',
				status: 'Pipeline.Done',
				dateCompleted: '2026-07-24',
				datetimeModified: '2026-07-24T12:00:00',
			}
			: {
				...(representation === 'inline' ? { _description: 'Updated description' } : { priority: 'A' }),
				datetimeModified: '2026-07-24T12:00:00',
			},
		sourceRevision: 'a'.repeat(64),
		targetDigest: 'd'.repeat(64),
		summary: operation === 'transition' ? 'Transition the task.' : 'Update the task.',
		noChange: false,
	};
	const primaryGroup = {
		groupId: `task-source:${filePath}`,
		order: 0,
		resources: [{ resourceKind: 'task-source' as const, resourceKey: filePath }],
	};
	const token = operation === 'transition'
		? {
			kind: 'semantic-transition-plan' as const,
			operation: 'task.transition' as const,
			effectiveAt: '2026-07-24T12:00:00.000Z',
			prepared: taskFieldPreparation,
			noChange: false,
			primaryGroup,
			primaryAncestors: [],
			recurrence: null,
			ancestorGroups: [],
			pinnedGroup: null,
			projectSerialGroup: null,
			affectedResources: [{
				resourceKind: 'task-source' as const,
				resourceKey: filePath,
				revision: committedRevision,
			}],
			atomicGroups: [primaryGroup],
			predictedEffects: [],
		} satisfies RuntimeSemanticTransitionPlanV1
		: taskFieldPreparation;
	const prepared = {
		target: {
			operonId: 'abc1234',
			locator,
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source' as const,
			resourceKey: filePath,
			revision: committedRevision,
		}],
		predictedEffects: [{
			resourceKind: 'task-source' as const,
			resourceKey: filePath,
			action: 'update' as const,
			summary: 'Update the task description.',
		}],
		warnings: [],
		token,
	};
	let persistedReceipt: MutationReceiptV1 | null = null;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => persistedReceipt,
		persist: async (receipt: MutationReceiptV1) => {
			persistedReceipt = receipt;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => { events.push('reindex'); },
		settleAfterMutation: async () => {
			events.push('settlement');
			durableContent = settledContent;
			nowEpochMs = options.settlementObservedAtEpochMs ?? defaultSettlementObservedAtEpochMs;
		},
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => {
			commitCount += 1;
			return ({
			status: 'committed',
			groupResults: [{
				groupId: `task-source:${filePath}`,
				status: 'committed',
				resourceRevisions: prepared.affectedResources,
			}],
			affectedFilePaths: [filePath],
			primaryTaskSourceCommitEvidence: {
				resourceKey: filePath,
				content: committedContent,
				revision: committedRevision,
			},
			});
		},
		refreshMutationCommitEvidence: async (preparedMutation, commit, settlementWindow) => {
			events.push('refresh');
			if (options.refreshThrows) throw new Error('simulated source read failure');
			const refreshedCommit = refreshRuntimeInlineTaskUpdateSettlementEvidenceV1(
				preparedMutation,
				commit,
				durableContent,
				DEFAULT_SETTINGS.keyMappings,
				options.modifiedTimeFrontmatterKeys,
				settlementWindow,
			);
			if (options.postRefreshContent !== undefined) {
				assert.equal(
					refreshedCommit.groupResults.flatMap(
						group => group.resourceRevisions ?? [],
					).find(resource => (
						resource.resourceKind === 'task-source'
						&& resource.resourceKey === filePath
					))?.revision,
					sha256HexV1(durableContent),
					'The race fixture must first prove that settlement evidence was refreshed.',
				);
				durableContent = options.postRefreshContent;
			}
			return refreshedCommit;
		},
		verifyMutation: async (
			_request,
			preparedMutation,
			_postflightRevision,
			commit,
			settlementWindow,
		) => {
			events.push('postflight');
			if (representation === 'inline') assert.match(durableContent, /Updated description/u);
			const exactEvidence = resolveRuntimeTaskFieldMutationPostflightEvidenceV1(
				filePath,
				commit.groupResults.flatMap(group => group.resourceRevisions ?? []),
				durableContent,
			);
			const evidence = commit.primaryTaskSourceCommitEvidence;
			const preparedToken = preparedMutation.token as {
				kind?: unknown;
				prepared?: RuntimeTaskFieldMutationPreparationV1;
			};
			const preparation = preparedToken.kind === 'semantic-transition-plan'
				? preparedToken.prepared
				: preparedToken as RuntimeTaskFieldMutationPreparationV1;
			if (!preparation) return false;
			const settlementEvidence = evidence
				? resolveRuntimeInlineTaskUpdateSettlementEvidenceV1(
					preparation,
					evidence.content,
					evidence.revision,
					durableContent,
					DEFAULT_SETTINGS.keyMappings,
					options.modifiedTimeFrontmatterKeys,
					settlementWindow,
				)
				: null;
			const observedModified = representation === 'inline'
				? /\{\{datetimeModified:: ([^}]+)\}\}/u.exec(durableContent)?.[1] ?? ''
				: /^datetimeModified:\s*(\S+)\s*$/mu.exec(durableContent)?.[1] ?? '';
			const expectedFields = Object.fromEntries(Object.entries(preparation.fieldValues)
				.filter(([field]) => !field.startsWith('_')));
			return exactEvidence !== null && verifyRuntimeTaskFieldMutationPrimaryPostflightV1(
				preparation,
				{
					...preparation.task,
					description: preparation.fieldValues['_description'] ?? preparation.task.description,
					checkbox: preparation.fieldValues['_checkbox'] === 'done'
						? 'done'
						: preparation.task.checkbox,
					fieldValues: {
						...preparation.task.fieldValues,
						...expectedFields,
						datetimeModified: observedModified,
					},
				},
				{
					...exactEvidence,
					...(settlementEvidence?.datetimeModified
						? { settlementDatetimeModified: settlementEvidence.datetimeModified }
						: {}),
				},
			);
		},
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => nowEpochMs,
		randomId: () => `phase8-update-${caseId}-plan`,
	});
	const preview = await gateway.preview(updateRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) throw new Error('Characterization preview must succeed.');
	nowEpochMs = options.applyStartedAtEpochMs ?? defaultApplyStartedAtEpochMs;
	const applyRequest = {
		contractVersion: 1,
		requestId: `phase8-update-apply-${caseId}`,
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: updateRequest.idempotencyKey,
		acknowledgements: [],
	} as const;
	const result = await gateway.apply(applyRequest);
	const replayResult = await gateway.apply(applyRequest);
	return { commitCount, events, replayResult, result };
}

test('prepared task update verifies Runtime-owned datetimeModified settlement drift', async () => {
	const committedContent = [
		'# Tasks',
		'',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'2026-07-24T12:00:00',
		'2026-07-24T12:00:01',
	);
	const { commitCount, events, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-metadata',
		committedContent,
		settledContent,
	);
	assert.deepEqual(events, ['reindex', 'settlement', 'refresh', 'postflight']);
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.doesNotMatch(
		JSON.stringify(result),
		/primaryTaskSourceCommitEvidence|# Tasks/u,
		'Internal committed source evidence must not enter the public result.',
	);
	assert.equal(replayResult.status, 'already-applied', JSON.stringify(replayResult));
	assert.equal(commitCount, 1);
});

test('prepared task update verifies configured modified-time frontmatter settlement drift', async () => {
	const committedContent = [
		'---',
		'created: 2026-07-24T09:00',
		'modification: 2026-07-24T11:59',
		'---',
		'# Tasks',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'',
	].join('\n');
	const settledContent = committedContent
		.replace('modification: 2026-07-24T11:59', 'modification: 2026-07-24T12:00')
		.replace('2026-07-24T12:00:00', '2026-07-24T12:00:01');
	const { commitCount, events, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-frontmatter-metadata',
		committedContent,
		settledContent,
		{ modifiedTimeFrontmatterKeys: ['modification'] },
	);
	assert.deepEqual(events, ['reindex', 'settlement', 'refresh', 'postflight']);
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.equal(replayResult.status, 'already-applied', JSON.stringify(replayResult));
	assert.equal(commitCount, 1);
});

test('prepared task update verifies configured frontmatter-only settlement drift', async () => {
	const committedContent = [
		'---',
		'created: 2026-07-24T09:00',
		'modification: 2026-07-24T11:59',
		'---',
		'# Tasks',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:00',
	);
	const { commitCount, events, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-frontmatter-only',
		committedContent,
		settledContent,
		{ modifiedTimeFrontmatterKeys: ['modification'] },
	);
	assert.deepEqual(events, ['reindex', 'settlement', 'refresh', 'postflight']);
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.equal(replayResult.status, 'already-applied', JSON.stringify(replayResult));
	assert.equal(commitCount, 1);
});

test('prepared task update correlates modified-time drift with a later apply minute', async () => {
	const committedContent = [
		'---',
		'created: 2026-07-24T09:00',
		'modification: 2026-07-24T11:59',
		'---',
		'# Tasks',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:01',
	);
	const { commitCount, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-frontmatter-later-apply-minute',
		committedContent,
		settledContent,
		{
			modifiedTimeFrontmatterKeys: ['modification'],
			previewEpochMs: new Date(2026, 6, 24, 12, 0, 0).getTime(),
			applyStartedAtEpochMs: new Date(2026, 6, 24, 12, 1, 0).getTime(),
			settlementObservedAtEpochMs: new Date(2026, 6, 24, 12, 1, 2).getTime(),
		},
	);
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.equal(replayResult.status, 'already-applied', JSON.stringify(replayResult));
	assert.equal(commitCount, 1);
});

test('prepared inline transition verifies configured modified-time frontmatter settlement drift', async () => {
	const committedContent = [
		'---',
		'modification: 2026-07-24T11:59',
		'---',
		'# Tasks',
		'- [x] Updated description {{operonId:: abc1234}} {{status:: Pipeline.Done}} {{dateCompleted:: 2026-07-24}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:00',
	);
	const { commitCount, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-inline-transition-frontmatter',
		committedContent,
		settledContent,
		{
			modifiedTimeFrontmatterKeys: ['modification'],
			operation: 'transition',
		},
	);
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.equal(replayResult.status, 'already-applied', JSON.stringify(replayResult));
	assert.equal(commitCount, 1);
});

test('prepared File Task update verifies configured modified-time frontmatter settlement drift', async () => {
	const committedContent = [
		'---',
		'operonId: abc1234',
		'priority: A',
		'datetimeModified: 2026-07-24T12:00:00',
		'modification: 2026-07-24T11:59',
		'---',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:00',
	);
	const success = await characterizePreparedTaskUpdateSettlement(
		'settlement-file-update-frontmatter',
		committedContent,
		settledContent,
		{
			modifiedTimeFrontmatterKeys: ['modification'],
			representation: 'file',
		},
	);
	assert.equal(success.result.status, 'applied', JSON.stringify(success.result));
	assert.equal(success.replayResult.status, 'already-applied', JSON.stringify(success.replayResult));
	assert.equal(success.commitCount, 1);

	const unrelatedDrift = await characterizePreparedTaskUpdateSettlement(
		'settlement-file-update-unrelated-drift',
		committedContent,
		settledContent.replace('priority: A', 'priority: F'),
		{
			modifiedTimeFrontmatterKeys: ['modification'],
			representation: 'file',
		},
	);
	assert.equal(unrelatedDrift.result.status, 'outcome-unknown', JSON.stringify(unrelatedDrift.result));
	assert.equal(unrelatedDrift.replayResult.status, 'outcome-unknown');
	assert.equal(unrelatedDrift.commitCount, 1);
});

test('prepared File Task transition verifies configured modified-time frontmatter settlement drift', async () => {
	const committedContent = [
		'---',
		'operonId: abc1234',
		'priority: F',
		'status: Pipeline.Done',
		'dateCompleted: 2026-07-24',
		'datetimeModified: 2026-07-24T12:00:00',
		'modification: 2026-07-24T11:59',
		'---',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'modification: 2026-07-24T11:59',
		'modification: 2026-07-24T12:00',
	);
	const { commitCount, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-file-transition-frontmatter',
		committedContent,
		settledContent,
		{
			modifiedTimeFrontmatterKeys: ['modification'],
			operation: 'transition',
			representation: 'file',
		},
	);
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.equal(replayResult.status, 'already-applied', JSON.stringify(replayResult));
	assert.equal(commitCount, 1);

	const unrelatedDrift = await characterizePreparedTaskUpdateSettlement(
		'settlement-file-transition-unrelated-drift',
		committedContent,
		settledContent.replace('priority: F', 'priority: A'),
		{
			modifiedTimeFrontmatterKeys: ['modification'],
			operation: 'transition',
			representation: 'file',
		},
	);
	assert.equal(unrelatedDrift.result.status, 'outcome-unknown', JSON.stringify(unrelatedDrift.result));
	assert.equal(unrelatedDrift.replayResult.status, 'outcome-unknown');
	assert.equal(unrelatedDrift.commitCount, 1);
});

test('prepared task update does not verify unrelated same-source settlement drift', async () => {
	const committedContent = [
		'# Tasks',
		'',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'- [ ] Unrelated task {{operonId:: def5678}}',
		'',
	].join('\n');
	const { commitCount, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'unrelated-settlement-drift',
		committedContent,
		committedContent.replace('Unrelated task', 'Concurrent unrelated edit'),
	);
	assert.equal(result.status, 'outcome-unknown', JSON.stringify(result));
	assert.equal(result.retryAllowed, false);
	assert.equal(replayResult.status, 'outcome-unknown', JSON.stringify(replayResult));
	assert.equal(commitCount, 1, 'Outcome-unknown replay must not invoke the writer again.');
});

test('prepared task update source-read failure remains uncertain and replay-fenced', async () => {
	const committedContent = [
		'# Tasks',
		'',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'',
	].join('\n');
	const { commitCount, events, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'settlement-read-failure',
		committedContent,
		committedContent.replace('2026-07-24T12:00:00', '2026-07-24T12:00:01'),
		{ refreshThrows: true },
	);
	assert.deepEqual(events, ['reindex', 'settlement', 'refresh']);
	assert.equal(result.status, 'outcome-unknown', JSON.stringify(result));
	assert.equal(result.retryAllowed, false);
	assert.equal(replayResult.status, 'outcome-unknown', JSON.stringify(replayResult));
	assert.equal(commitCount, 1, 'A failed refresh must still fence writer replay.');
});

test('prepared task update rejects same-source drift after evidence refresh and fences replay', async () => {
	const committedContent = [
		'# Tasks',
		'',
		'- [ ] Updated description {{operonId:: abc1234}} {{datetimeModified:: 2026-07-24T12:00:00}}',
		'- [ ] Unrelated task {{operonId:: def5678}}',
		'',
	].join('\n');
	const settledContent = committedContent.replace(
		'2026-07-24T12:00:00',
		'2026-07-24T12:00:01',
	);
	const { commitCount, events, replayResult, result } = await characterizePreparedTaskUpdateSettlement(
		'post-refresh-source-drift',
		committedContent,
		settledContent,
		{
			postRefreshContent: settledContent.replace(
				'Unrelated task',
				'Concurrent post-refresh edit',
			),
		},
	);
	assert.deepEqual(events, ['reindex', 'settlement', 'refresh', 'postflight']);
	assert.equal(result.status, 'outcome-unknown', JSON.stringify(result));
	assert.equal(result.retryAllowed, false);
	assert.equal(replayResult.status, 'outcome-unknown', JSON.stringify(replayResult));
	assert.equal(commitCount, 1, 'Post-refresh drift must not authorize writer replay.');
});

test('file-to-inline postflight failure preserves its durable same-plan recovery journal', async () => {
	const conversionRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'phase8-conversion-postflight-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'phase8-conversion-postflight-key',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'file', filePath: 'Tasks/Source.md' },
		},
		spec: {
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'exact-line',
				filePath: 'Daily.md',
				lineNumber: 1,
			},
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const lossManifest = [{
		kind: 'body-content' as const,
		digest: '4'.repeat(64),
	}];
	const conversionEffect = {
		direction: 'file-to-inline' as const,
		operonId: 'abc1234',
		beforeLocator: { representation: 'file' as const, filePath: 'Tasks/Source.md' },
		afterLocator: { representation: 'inline' as const, filePath: 'Daily.md', lineNumber: 1 },
		plannedTargetDigest: '1'.repeat(64),
		plannedSourceDigest: '2'.repeat(64),
		settingsFingerprint: '3'.repeat(64),
		resolvedFieldDiff: [],
		lossManifest,
		lossManifestDigest: sha256HexV1(
			canonicalJsonV1(toJsonValueV1(lossManifest)),
		),
	};
	const acknowledgement = 'confirm:conversion-loss:abc1234';
	const prepared = {
		target: {
			operonId: 'abc1234',
			locator: conversionRequest.target?.locator,
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Daily.md',
			revision: 'e'.repeat(64),
		}, {
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks/Source.md',
			revision: 'f'.repeat(64),
		}],
		atomicGroups: [{
			groupId: 'task-source:Daily.md',
			order: 0,
			resources: [{ resourceKind: 'task-source' as const, resourceKey: 'Daily.md' }],
		}, {
			groupId: 'task-source:Tasks/Source.md',
			order: 1,
			resources: [{
				resourceKind: 'task-source' as const,
				resourceKey: 'Tasks/Source.md',
			}],
		}],
		predictedEffects: [{
			resourceKind: 'task-source' as const,
			resourceKey: 'Daily.md',
			action: 'update' as const,
			summary: 'Insert the canonical inline task.',
		}, {
			resourceKind: 'task-source' as const,
			resourceKey: 'Tasks/Source.md',
			action: 'trash' as const,
			summary: 'Trash the source File Task.',
		}],
		warnings: [],
		riskLevel: 'destructive' as const,
		requiredAcknowledgements: [acknowledgement],
		conversionEffect,
		token: { kind: 'source-transition', operation: 'convert' },
	};
	let journal: GraphTransactionJournalV1 | null = null;
	let commitCount = 0;
	let recoverCount = 0;
	const events: string[] = [];
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (value: GraphTransactionJournalV1) => {
			journal = structuredClone(value);
			events.push('journal');
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (value: GraphTransactionJournalV1) => {
			journal = structuredClone(value);
		},
		finalizeReceipt: async () => {
			journal = null;
			events.push('finalize');
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => {
			throw new Error('Source transition writes must use the graph transaction.');
		},
		prepareMutationTransaction: async () => ({
			ok: true,
			steps: [{
				stepId: 'source:Daily.md',
				groupId: 'task-source:Daily.md',
				resourceKind: 'task-source',
				resourceKey: 'Daily.md',
				operation: 'modify',
				before: {
					state: 'present',
					digest: sha256HexV1('daily-before'),
					content: 'daily-before',
				},
				after: {
					state: 'present',
					digest: sha256HexV1('daily-after'),
					content: 'daily-after',
				},
			}, {
				stepId: 'source:Tasks/Source.md',
				groupId: 'task-source:Tasks/Source.md',
				resourceKind: 'task-source',
				resourceKey: 'Tasks/Source.md',
				operation: 'delete',
				before: {
					state: 'present',
					digest: sha256HexV1('source-before'),
					content: 'source-before',
				},
				after: {
					state: 'absent',
					digest: sha256HexV1(''),
					content: null,
				},
			}],
		}),
		commitMutationTransaction: async (_request, _prepared, _at, _journal, checkpoint) => {
			commitCount += 1;
			events.push('write');
			await checkpoint({ phase: 'committing', completedStepCount: 2 });
			await checkpoint({ phase: 'postflight', completedStepCount: 2 });
			return {
				status: 'committed',
				groupResults: prepared.atomicGroups.map((group, index) => ({
					groupId: group.groupId,
					status: 'committed' as const,
					resourceRevisions: [prepared.affectedResources[index]],
				})),
				affectedFilePaths: ['Daily.md', 'Tasks/Source.md'],
			};
		},
		recoverMutationTransaction: async () => {
			recoverCount += 1;
			return {
				status: 'forward-completed',
				groupResults: prepared.atomicGroups.map((group, index) => ({
					groupId: group.groupId,
					status: 'committed' as const,
					resourceRevisions: [prepared.affectedResources[index]],
				})),
				affectedFilePaths: ['Daily.md', 'Tasks/Source.md'],
				verified: true,
			};
		},
		verifyMutationTransactionState: async () => true,
		verifyRecoveredMutationTransaction: async () => true,
		verifyMutation: async () => false,
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'phase8-conversion-postflight-plan',
	});
	const preview = await gateway.preview(conversionRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const acknowledgedAt = '2026-07-24T08:00:00.000Z';
	const apply = {
		contractVersion: 1 as const,
		requestId: 'phase8-conversion-postflight-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-confirmation' as const },
		idempotencyKey: conversionRequest.idempotencyKey,
		acknowledgements: [{
			code: acknowledgement,
			planHash: preview.plan.planHash,
			targetDigest: preview.plan.targets[0].targetDigest,
			acknowledgedAt,
		}],
	};
	const decodedApply = decodeMutationApplyRequestV1(apply);
	assert.equal(decodedApply.ok, true, JSON.stringify(decodedApply));
	assert.equal(
		validateCliRuntimeRequestV1('mutation.apply', apply).ok,
		true,
		'expired same-plan recovery must reach the Runtime journal gate',
	);
	const admitted = validateRuntimeMutationApplyRequestV1(
		apply,
		Date.parse('2026-07-24T08:00:00.000Z'),
	);
	assert.equal(admitted.ok, true);
	const first = await gateway.apply(apply);
	assert.equal(first.status, 'outcome-unknown', JSON.stringify(first));
	assert.ok(journal);
	assert.equal(first.retryAllowed, false);
	assert.equal(commitCount, 1);
	assert.deepEqual(events.slice(0, 2), ['journal', 'write']);
	const replay = await gateway.apply({
		...apply,
		requestId: 'phase8-conversion-postflight-replay',
	});
	assert.equal(replay.status, 'applied');
	assert.equal(commitCount, 1);
	assert.equal(recoverCount, 1);
	assert.equal(journal, null);
	assert.equal(events.at(-1), 'finalize');
});

test('same-source conversion ancestor seals one effect and replays without another write', async () => {
	const conversionRequest: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'same-source-conversion-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'same-source-conversion-key',
		capability: 'tasks.convert.preview',
		mutationKind: 'task.convert',
		target: {
			operonId: 'abc1234',
			locator: { representation: 'inline', filePath: 'Daily.md', lineNumber: 2 },
		},
		spec: {
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId: 'template:default',
			targetPath: 'Tasks/Converted.md',
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const sourceGroupPaths = ['Daily.md', 'Tasks/Converted.md'];
	const predictedEffects = [{
		resourceKind: 'task-source' as const,
		resourceKey: 'Daily.md',
		action: 'update' as const,
		summary: 'Replace the exact inline task with a wikilink.',
	}, {
		resourceKind: 'task-source' as const,
		resourceKey: 'Tasks/Converted.md',
		action: 'create' as const,
		summary: 'Create the exact File Task target.',
	}, ...buildRuntimeConversionAncestorPredictedEffectsV1(
		sourceGroupPaths,
		['Daily.md', 'Daily.md'],
	)];
	assert.equal(predictedEffects.length, 2);
	assert.equal(predictedEffects.filter(effect => effect.resourceKey === 'Daily.md').length, 1);
	const prepared: RuntimePreparedMutationV1 = {
		target: {
			operonId: 'abc1234',
			locator: conversionRequest.target?.locator,
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: sourceGroupPaths.map((resourceKey, index) => ({
			resourceKind: 'task-source' as const,
			resourceKey,
			revision: String(index + 1).repeat(64),
		})),
		atomicGroups: sourceGroupPaths.map((resourceKey, order) => ({
			groupId: `task-source:${resourceKey}`,
			order,
			resources: [{ resourceKind: 'task-source' as const, resourceKey }],
		})),
		predictedEffects,
		warnings: [],
		conversionEffect: {
			direction: 'inline-to-file',
			operonId: 'abc1234',
			beforeLocator: conversionRequest.target!.locator,
			afterLocator: { representation: 'file', filePath: 'Tasks/Converted.md' },
			plannedTargetDigest: 'a'.repeat(64),
			plannedSourceDigest: 'b'.repeat(64),
			settingsFingerprint: 'c'.repeat(64),
			templateId: 'template:default',
			templateRevision: 'e'.repeat(64),
			resolvedFieldDiff: [],
			lossManifest: [],
			lossManifestDigest: sha256HexV1('[]'),
			parentOperonId: 'parent1',
		},
		token: { kind: 'test-same-source-conversion' },
	};
	let receipt: MutationReceiptV1 | null = null;
	let journal: GraphTransactionJournalV1 | null = null;
	let commitCount = 0;
	let verifyCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (value: GraphTransactionJournalV1) => {
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (value: GraphTransactionJournalV1) => {
			journal = structuredClone(value);
		},
		finalizeReceipt: async (value: MutationReceiptV1) => {
			receipt = value;
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => {
			throw new Error('Conversion writes must use the graph transaction.');
		},
		prepareMutationTransaction: async () => ({
			ok: true,
			steps: sourceGroupPaths.map((resourceKey, index) => ({
				stepId: `source:${resourceKey}`,
				groupId: `task-source:${resourceKey}`,
				resourceKind: 'task-source' as const,
				resourceKey,
				operation: index === 0 ? 'modify' as const : 'create' as const,
				before: index === 0
					? { state: 'present' as const, digest: sha256HexV1('before'), content: 'before' }
					: { state: 'absent' as const, digest: sha256HexV1(''), content: null },
				after: {
					state: 'present' as const,
					digest: sha256HexV1(`after-${index}`),
					content: `after-${index}`,
				},
			})),
		}),
		commitMutationTransaction: async (_request, _prepared, _at, _journal, checkpoint) => {
			commitCount += 1;
			await checkpoint({ phase: 'committing', completedStepCount: sourceGroupPaths.length });
			await checkpoint({ phase: 'postflight', completedStepCount: sourceGroupPaths.length });
			return {
				status: 'committed',
				groupResults: prepared.atomicGroups!.map(group => ({
					groupId: group.groupId,
					status: 'committed' as const,
					resourceRevisions: prepared.affectedResources.filter(resource => (
						group.resources.some(candidate => (
							candidate.resourceKind === resource.resourceKind
								&& candidate.resourceKey === resource.resourceKey
						))
					)),
				})),
				affectedFilePaths: sourceGroupPaths,
			};
		},
		recoverMutationTransaction: async () => ({
			status: 'forward-completed',
			groupResults: prepared.atomicGroups!.map(group => ({
				groupId: group.groupId,
				status: 'committed' as const,
				resourceRevisions: prepared.affectedResources.filter(resource => (
					group.resources.some(candidate => (
						candidate.resourceKind === resource.resourceKind
							&& candidate.resourceKey === resource.resourceKey
					))
				)),
			})),
			affectedFilePaths: sourceGroupPaths,
			verified: true,
		}),
		verifyMutationTransactionState: async () => true,
		verifyMutation: async () => {
			verifyCount += 1;
			return true;
		},
		receiptStore: () => receiptStore,
		vaultIdentityHash: async () => 'f'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-31T20:00:00.000Z'),
		randomId: () => 'same-source-conversion-plan',
	});
	const preview = await gateway.preview(conversionRequest);
	assert.equal(preview.ok, true, JSON.stringify(preview));
	assert.equal(decodeMutationPreviewResultV1(preview).ok, true);
	if (!preview.ok) return;
	assert.equal(preview.plan.predictedEffects.filter(effect => effect.resourceKey === 'Daily.md').length, 1);
	const apply = {
		contractVersion: 1 as const,
		requestId: 'same-source-conversion-apply',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: conversionRequest.idempotencyKey,
		acknowledgements: [],
	};
	const applied = await gateway.apply(apply);
	assert.equal(applied.status, 'applied', JSON.stringify(applied));
	assert.equal(applied.postflight?.status, 'verified');
	const replay = await gateway.apply({ ...apply, requestId: 'same-source-conversion-replay' });
	assert.equal(replay.status, 'already-applied');
	assert.deepEqual(replay.postflight, { status: 'receipt-replay' });
	assert.equal(commitCount, 1);
	assert.equal(verifyCount, 1);
});

test('relocate and delete source transitions persist a journal before graph writes', async () => {
	for (const mutationKind of ['task.inline-relocate', 'task.delete'] as const) {
		const target = {
			operonId: 'abc1234',
			locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
		};
		const destructive = mutationKind === 'task.delete';
		const request: MutationPreviewRequestV1 = {
			contractVersion: 1,
			requestId: `${mutationKind}-preview`,
			kind: 'mutation-preview',
			clientInstanceId: 'test-client',
			idempotencyKey: `${mutationKind}-journal-before-write`,
			capability: destructive ? 'tasks.delete.preview' : 'tasks.inline.relocate.preview',
			mutationKind,
			target,
			spec: destructive
				? { operation: 'delete', mode: 'delete-exact-task', cascade: false }
				: {
					operation: 'relocate-inline',
					source: {
						locator: target.locator,
						lineDigest: '1'.repeat(64),
						sourceRevision: { algorithm: 'sha256', contentDigest: '2'.repeat(64) },
					},
					destination: {
						locator: {
							representation: 'inline',
							filePath: 'Other.md',
							lineNumber: 2,
						},
						lineDigest: '3'.repeat(64),
						sourceRevision: { algorithm: 'sha256', contentDigest: '4'.repeat(64) },
						mustBeBlank: true,
					},
				},
			authorization: { basis: 'user-explicit-request' },
		};
		const acknowledgement = `confirm:${mutationKind}:abc1234`;
		const prepared: RuntimePreparedMutationV1 = {
			target: { ...target, targetDigest: 'd'.repeat(64) },
			affectedResources: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				revision: 'e'.repeat(64),
			}],
			atomicGroups: [{
				groupId: 'task-source:Tasks.md',
				order: 0,
				resources: [{ resourceKind: 'task-source', resourceKey: 'Tasks.md' }],
			}],
			predictedEffects: [{
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				action: destructive ? 'trash' : 'update',
				summary: 'Execute the exact source transition.',
			}],
			warnings: [],
			...(destructive
				? {
					riskLevel: 'destructive' as const,
					requiredAcknowledgements: [acknowledgement],
				}
				: {}),
			token: { kind: 'source-transition' },
		};
		const events: string[] = [];
		let journal: GraphTransactionJournalV1 | null = null;
		const receiptStore = {
			health: async () => ({ healthy: true }),
			lookup: async () => null,
			lookupJournal: async () => journal ? structuredClone(journal) : null,
			acquireJournal: async (value: GraphTransactionJournalV1) => {
				journal = structuredClone(value);
				events.push('journal');
				return true;
			},
			persistJournal: async (value: GraphTransactionJournalV1) => {
				journal = structuredClone(value);
			},
			finalizeReceipt: async () => {
				journal = null;
				return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
			},
		} as unknown as IndexedDbMutationReceiptStoreV1;
		const gateway = new RuntimeMutationGatewayV1({
			isReady: () => true,
			sampleContextRevision: () => revision,
			prepareCreation: async () => preparation(),
			commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
			prepareMutation: async () => ({ ok: true, value: prepared }),
			commitMutation: async () => {
				throw new Error('Source transition bypassed graph admission.');
			},
			prepareMutationTransaction: async () => ({
				ok: true,
				steps: [{
					stepId: 'source:Tasks.md',
					groupId: 'task-source:Tasks.md',
					resourceKind: 'task-source',
					resourceKey: 'Tasks.md',
					operation: destructive ? 'delete' : 'modify',
					before: {
						state: 'present',
						digest: sha256HexV1('before'),
						content: 'before',
					},
					after: destructive
						? { state: 'absent', digest: sha256HexV1(''), content: null }
						: {
							state: 'present',
							digest: sha256HexV1('after'),
							content: 'after',
						},
				}],
			}),
			commitMutationTransaction: async (_apply, _prepared, _at, _journal, checkpoint) => {
				events.push('write');
				await checkpoint({ phase: 'committing', completedStepCount: 1 });
				await checkpoint({ phase: 'postflight', completedStepCount: 1 });
				return {
					status: 'committed',
					groupResults: [{
						groupId: 'task-source:Tasks.md',
						status: 'committed',
						resourceRevisions: prepared.affectedResources,
					}],
					affectedFilePaths: ['Tasks.md'],
				};
			},
			recoverMutationTransaction: async () => ({
				status: 'outcome-unknown',
				groupResults: [],
				affectedFilePaths: [],
				verified: false,
			}),
			verifyMutationTransactionState: async () => true,
			verifyRecoveredMutationTransaction: async () => true,
			reindexAffectedSources: async () => undefined,
			settleAfterMutation: async () => undefined,
			reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
			verifyCreatedTasks: async () => false,
			verifyMutation: async () => true,
			receiptStore: () => receiptStore,
			vaultIdentityHash: async () => 'c'.repeat(64),
			nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
			randomId: () => `${mutationKind}-plan`,
		});
		const preview = await gateway.preview(request);
		assert.equal(preview.ok, true, JSON.stringify(preview));
		if (!preview.ok) continue;
		const result = await gateway.apply({
			contractVersion: 1,
			requestId: `${mutationKind}-apply`,
			kind: 'mutation-apply',
			plan: preview.plan,
			authorization: {
				basis: destructive ? 'user-explicit-confirmation' : 'user-explicit-request',
			},
			idempotencyKey: request.idempotencyKey,
			acknowledgements: destructive ? [{
				code: acknowledgement,
				planHash: preview.plan.planHash,
				targetDigest: preview.plan.targets[0].targetDigest,
				acknowledgedAt: '2026-07-24T08:00:00.000Z',
			}] : [],
		});
		assert.equal(result.status, 'applied', `${mutationKind}: ${JSON.stringify(result)}`);
		assert.deepEqual(events.slice(0, 2), ['journal', 'write']);
	}
});

test('oversized source-transition journal fails before persistence or graph writes', async () => {
	const target = {
		operonId: 'abc1234',
		locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 1 },
	};
	const request: MutationPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'source-transition-oversized-preview',
		kind: 'mutation-preview',
		clientInstanceId: 'test-client',
		idempotencyKey: 'source-transition-oversized',
		capability: 'tasks.inline.relocate.preview',
		mutationKind: 'task.inline-relocate',
		target,
		spec: {
			operation: 'relocate-inline',
			source: {
				locator: target.locator,
				lineDigest: '1'.repeat(64),
				sourceRevision: { algorithm: 'sha256', contentDigest: '2'.repeat(64) },
			},
			destination: {
				locator: { representation: 'inline', filePath: 'Other.md', lineNumber: 2 },
				lineDigest: '3'.repeat(64),
				sourceRevision: { algorithm: 'sha256', contentDigest: '4'.repeat(64) },
				mustBeBlank: true,
			},
		},
		authorization: { basis: 'user-explicit-request' },
	};
	const prepared: RuntimePreparedMutationV1 = {
		target: { ...target, targetDigest: 'd'.repeat(64) },
		affectedResources: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			revision: 'e'.repeat(64),
		}],
		predictedEffects: [{
			resourceKind: 'task-source',
			resourceKey: 'Tasks.md',
			action: 'update',
			summary: 'Relocate one exact task.',
		}],
		warnings: [],
		token: { kind: 'source-transition' },
	};
	let acquired = 0;
	let writes = 0;
	const gateway = new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => {
			throw new Error('Source transition bypassed graph admission.');
		},
		prepareMutationTransaction: async () => ({
			ok: true,
			steps: [{
				stepId: 'source:Tasks.md',
				groupId: 'task-source:Tasks.md',
				resourceKind: 'task-source',
				resourceKey: 'Tasks.md',
				operation: 'modify',
				before: {
					state: 'present',
					digest: sha256HexV1('before'),
					content: 'before',
				},
				after: {
					state: 'present',
					digest: sha256HexV1('x'.repeat(GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1)),
					content: 'x'.repeat(GRAPH_TRANSACTION_JOURNAL_MAX_BYTES_V1),
				},
			}],
		}),
		commitMutationTransaction: async () => {
			writes += 1;
			throw new Error('oversized journal reached write');
		},
		recoverMutationTransaction: async () => ({
			status: 'outcome-unknown',
			groupResults: [],
			affectedFilePaths: [],
			verified: false,
		}),
		verifyMutationTransactionState: async () => true,
		verifyRecoveredMutationTransaction: async () => true,
		reindexAffectedSources: async () => undefined,
		settleAfterMutation: async () => undefined,
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		verifyMutation: async () => true,
		receiptStore: () => ({
			health: async () => ({ healthy: true }),
			lookup: async () => null,
			lookupJournal: async () => null,
			acquireJournal: async () => {
				acquired += 1;
				return true;
			},
		}) as unknown as IndexedDbMutationReceiptStoreV1,
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'source-transition-oversized-plan',
	});
	const preview = await gateway.preview(request);
	assert.equal(preview.ok, true, JSON.stringify(preview));
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'source-transition-oversized-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: request.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.error?.code, 'payload-too-large');
	assert.equal(acquired, 0);
	assert.equal(writes, 0);
});

const relationshipRequest: MutationPreviewRequestV1 = {
	contractVersion: 1,
	requestId: 'a11-relationship-preview',
	kind: 'mutation-preview',
	clientInstanceId: 'test-client',
	idempotencyKey: 'a11-relationship-idempotency',
	capability: 'tasks.relationship.preview',
	mutationKind: 'task.relationship',
	target: {
		operonId: 'owner01',
		locator: { representation: 'inline', filePath: 'Owner.md', lineNumber: 0 },
	},
	spec: {
		operation: 'replace-relationships',
		changes: [{
			field: 'blocking',
			targetOperonIds: ['target1'],
		}],
	},
	authorization: { basis: 'user-explicit-request' },
};

function relationshipPrepared(): RuntimePreparedMutationV1 {
	return {
		target: {
			operonId: 'owner01',
			locator: { representation: 'inline', filePath: 'Owner.md', lineNumber: 0 },
			targetDigest: 'd'.repeat(64),
		},
		affectedResources: [{
			resourceKind: 'task-source',
			resourceKey: 'Owner.md',
			revision: 'e'.repeat(64),
		}, {
			resourceKind: 'task-source',
			resourceKey: 'Target.md',
			revision: 'f'.repeat(64),
		}],
		atomicGroups: [{
			groupId: 'task-source:Owner.md',
			order: 0,
			resources: [{ resourceKind: 'task-source', resourceKey: 'Owner.md' }],
		}, {
			groupId: 'task-source:Target.md',
			order: 1,
			resources: [{ resourceKind: 'task-source', resourceKey: 'Target.md' }],
		}],
		predictedEffects: [{
			resourceKind: 'task-source',
			resourceKey: 'Owner.md',
			action: 'update',
			summary: 'Replace the exact task relationship set.',
		}, {
			resourceKind: 'task-source',
			resourceKey: 'Target.md',
			action: 'update',
			summary: 'Update the reciprocal dependency relationship.',
		}],
		warnings: [],
		sealedSpec: {
			operation: 'replace-relationships',
			changes: [{
				field: 'blocking',
				targetOperonIds: ['target1'],
				expectedTargetOperonIds: [],
			}],
			affectedOperonIds: ['owner01', 'target1'],
		},
		token: { kind: 'task-relationships' },
	};
}

function relationshipJournalSteps(): GraphTransactionJournalStepV1[] {
	return [{
		stepId: 'source:Owner.md',
		groupId: 'task-source:Owner.md',
		resourceKind: 'task-source',
		resourceKey: 'Owner.md',
		operation: 'modify',
		before: {
			state: 'present',
			digest: sha256HexV1('owner-before'),
			content: 'owner-before',
		},
		after: {
			state: 'present',
			digest: sha256HexV1('owner-after'),
			content: 'owner-after',
		},
	}, {
		stepId: 'source:Target.md',
		groupId: 'task-source:Target.md',
		resourceKind: 'task-source',
		resourceKey: 'Target.md',
		operation: 'modify',
		before: {
			state: 'present',
			digest: sha256HexV1('target-before'),
			content: 'target-before',
		},
		after: {
			state: 'present',
			digest: sha256HexV1('target-after'),
			content: 'target-after',
		},
	}];
}

function relationshipGateway(
	receiptStore: IndexedDbMutationReceiptStoreV1,
	options: {
		commit: NonNullable<RuntimeMutationGatewayPortsV1['commitMutationTransaction']>;
		recover?: NonNullable<RuntimeMutationGatewayPortsV1['recoverMutationTransaction']>;
		verifyState?: NonNullable<RuntimeMutationGatewayPortsV1['verifyMutationTransactionState']>;
		verifyRecovered?: NonNullable<
			RuntimeMutationGatewayPortsV1['verifyRecoveredMutationTransaction']
		>;
		events?: string[];
		audit?: boolean;
	},
): RuntimeMutationGatewayV1 {
	const prepared = relationshipPrepared();
	return new RuntimeMutationGatewayV1({
		isReady: () => true,
		sampleContextRevision: () => revision,
		prepareCreation: async () => preparation(),
		commitCreation: async () => ({ status: 'failed', groups: [], remainingGroupIds: [] }),
		prepareMutation: async () => ({ ok: true, value: prepared }),
		commitMutation: async () => {
			throw new Error('Relationship writes must use the graph transaction.');
		},
		prepareMutationTransaction: async () => ({
			ok: true,
			steps: relationshipJournalSteps(),
		}),
		commitMutationTransaction: options.commit,
		recoverMutationTransaction: options.recover ?? (async () => ({
			status: 'outcome-unknown',
			groupResults: [],
			affectedFilePaths: [],
			verified: false,
		})),
		verifyMutationTransactionState: options.verifyState ?? (async () => true),
		verifyRecoveredMutationTransaction: options.verifyRecovered ?? (async () => true),
		reindexAffectedSources: async filePaths => {
			options.events?.push(`reindex:${filePaths.join(',')}`);
		},
		settleAfterMutation: async () => {
			options.events?.push('settle');
		},
		reconcileCreatedHierarchy: async () => ({ ok: true, resourceRevisions: [] }),
		verifyCreatedTasks: async () => false,
		verifyMutation: async () => true,
		receiptStore: () => receiptStore,
		...(options.audit
			? {
				securityAuditStore: () => ({
					health: async () => true,
					append: async (event: SecurityAuditEventV1) => {
						options.events?.push(`audit:${event.event}`);
						return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
					},
				} as unknown as IndexedDbSecurityAuditStoreV1),
				createSecurityAuditEvent: (
					event:
						| 'apply-dispatched'
						| 'apply-completed'
						| 'recovery-dispatched'
						| 'recovery-completed',
				) => ({ event } as SecurityAuditEventV1),
			}
			: {}),
		vaultIdentityHash: async () => 'c'.repeat(64),
		nowEpochMs: () => Date.parse('2026-07-24T08:00:00.000Z'),
		randomId: () => 'a11-relationship-plan',
	});
}

test('routine relationship graph persists its recovery journal before the first source write', async () => {
	const events: string[] = [];
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let receipt: MutationReceiptV1 | null = null;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			events.push(`journal:${value.phase}:${value.completedStepCount}`);
			return true;
		},
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		finalizeReceipt: async (value: MutationReceiptV1) => {
			receipt = value;
			journal = null;
			events.push('finalize');
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = relationshipGateway(receiptStore, {
		events,
		audit: true,
		commit: async (_request, _prepared, _at, _journal, checkpoint) => {
			events.push('write-start');
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			await checkpoint({ phase: 'postflight', completedStepCount: 2 });
			return {
				status: 'committed',
				groupResults: relationshipPrepared().atomicGroups!.map((group, index) => ({
					groupId: group.groupId,
					status: 'committed' as const,
					resourceRevisions: [relationshipPrepared().affectedResources[index]],
				})),
				affectedFilePaths: ['Owner.md', 'Target.md'],
			};
		},
	});
	const preview = await gateway.preview(relationshipRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.equal(preview.plan.riskLevel, 'routine');
	assert.equal(preview.plan.requiresConfirmation, false);
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'a11-relationship-apply',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: relationshipRequest.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'applied', JSON.stringify(result));
	assert.deepEqual(events.slice(0, 3), [
		'journal:prepared:0',
		'audit:apply-dispatched',
		'write-start',
	]);
	assert.deepEqual(events.slice(-2), ['finalize', 'audit:apply-completed']);
	assert.equal(journal, null);
	assert.ok(receipt);
	assert.equal(decodeMutationResultV1(result).ok, true);
});

test('first graph CAS conflict removes its write-free journal without requiring stale before-state', async () => {
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let verifyStateCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => null,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		deleteJournal: async () => {
			journal = null;
			return true;
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = relationshipGateway(receiptStore, {
		commit: async () => ({
			status: 'failed',
			groupResults: [{
				groupId: relationshipPrepared().atomicGroups![0].groupId,
				status: 'failed',
				reason: 'Injected first-step CAS conflict.',
			}],
			affectedFilePaths: [],
			reason: 'Injected first-step CAS conflict.',
		}),
		verifyState: async () => {
			verifyStateCount += 1;
			return false;
		},
	});
	const preview = await gateway.preview(relationshipRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await gateway.apply({
		contractVersion: 1,
		requestId: 'a11-first-cas-conflict',
		kind: 'mutation-apply',
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: relationshipRequest.idempotencyKey,
		acknowledgements: [],
	});
	assert.equal(result.status, 'failed');
	assert.equal(result.mutationMayHaveApplied, false);
	assert.equal(result.error?.code, 'stale-source');
	assert.equal(verifyStateCount, 0);
	assert.equal(journal, null);
});

test('same relationship plan resumes a durable prefix while a conflicting plan is fenced', async () => {
	const events: string[] = [];
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let receipt: MutationReceiptV1 | null = null;
	let commitCount = 0;
	let recoveryCount = 0;
	let semanticRecoveryCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		finalizeReceipt: async (value: MutationReceiptV1) => {
			receipt = value;
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = relationshipGateway(receiptStore, {
		events,
		audit: true,
		commit: async (_request, _prepared, _at, _journal, checkpoint) => {
			commitCount += 1;
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			return {
				status: 'partial',
				groupResults: [{
					groupId: 'task-source:Owner.md',
					status: 'committed',
				}],
				affectedFilePaths: ['Owner.md'],
				reason: 'Injected relationship interruption.',
			};
		},
		recover: async (_request, _journal, checkpoint) => {
			recoveryCount += 1;
			await checkpoint({ phase: 'postflight', completedStepCount: 2 });
			return {
				status: 'forward-completed',
				groupResults: relationshipPrepared().atomicGroups!.map((group, index) => ({
					groupId: group.groupId,
					status: 'committed' as const,
					resourceRevisions: [relationshipPrepared().affectedResources[index]],
				})),
				affectedFilePaths: ['Owner.md', 'Target.md'],
				verified: true,
			};
		},
		verifyRecovered: async () => {
			semanticRecoveryCount += 1;
			return true;
		},
	});
	const preview = await gateway.preview(relationshipRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = {
		contractVersion: 1 as const,
		requestId: 'a11-relationship-prefix',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: relationshipRequest.idempotencyKey,
		acknowledgements: [],
	};
	assert.equal((await gateway.apply(apply)).status, 'outcome-unknown');
	assert.ok(journal);
	const conflictingPlan = structuredClone(preview.plan);
	conflictingPlan.planId = 'a11-conflicting-relationship-plan';
	conflictingPlan.planHash = computeSealedMutationPlanHashV1(conflictingPlan);
	const conflicting = await gateway.apply({
		...apply,
		requestId: 'a11-relationship-conflicting',
		plan: conflictingPlan,
	});
	assert.equal(conflicting.status, 'failed');
	assert.equal(conflicting.error?.code, 'stale-plan');
	assert.equal(recoveryCount, 0);
	const recovered = await gateway.apply({
		...apply,
		requestId: 'a11-relationship-recovery',
	});
	assert.equal(recovered.status, 'applied');
	assert.ok(events.includes('audit:recovery-dispatched'));
	assert.ok(events.includes('audit:recovery-completed'));
	assert.ok(
		events.indexOf('audit:recovery-dispatched')
		< events.indexOf('audit:recovery-completed'),
	);
	assert.equal(commitCount, 1);
	assert.equal(recoveryCount, 1);
	assert.equal(semanticRecoveryCount, 1);
	assert.equal(journal, null);
	assert.ok(receipt);
	assert.equal(decodeMutationResultV1(recovered).ok, true);
});

test('relationship recovery keeps its journal when semantic postflight cannot be verified', async () => {
	let journal: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0] | null = null;
	let receipt: MutationReceiptV1 | null = null;
	let recoveryCount = 0;
	let semanticRecoveryCount = 0;
	const receiptStore = {
		health: async () => ({ healthy: true }),
		lookup: async () => receipt,
		lookupJournal: async () => journal ? structuredClone(journal) : null,
		acquireJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['acquireJournal']>[0],
		) => {
			journal = structuredClone(value);
			return true;
		},
		claimJournal: async () => true,
		persistJournal: async (
			value: Parameters<IndexedDbMutationReceiptStoreV1['persistJournal']>[0],
		) => {
			journal = structuredClone(value);
		},
		finalizeReceipt: async (value: MutationReceiptV1) => {
			receipt = value;
			journal = null;
			return { expiredDeleted: 0, overflowDeleted: 0, retained: 1 };
		},
	} as unknown as IndexedDbMutationReceiptStoreV1;
	const gateway = relationshipGateway(receiptStore, {
		commit: async (_request, _prepared, _at, _journal, checkpoint) => {
			await checkpoint({ phase: 'committing', completedStepCount: 1 });
			return {
				status: 'partial',
				groupResults: [{
					groupId: 'task-source:Owner.md',
					status: 'committed',
				}],
				affectedFilePaths: ['Owner.md'],
				reason: 'Injected relationship interruption.',
			};
		},
		recover: async (_request, _journal, checkpoint) => {
			recoveryCount += 1;
			await checkpoint({ phase: 'postflight', completedStepCount: 2 });
			return {
				status: 'forward-completed',
				groupResults: relationshipPrepared().atomicGroups!.map((group, index) => ({
					groupId: group.groupId,
					status: 'committed' as const,
					resourceRevisions: [relationshipPrepared().affectedResources[index]],
				})),
				affectedFilePaths: ['Owner.md', 'Target.md'],
				verified: true,
			};
		},
		verifyRecovered: async () => {
			semanticRecoveryCount += 1;
			return false;
		},
	});
	const preview = await gateway.preview(relationshipRequest);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const apply = {
		contractVersion: 1 as const,
		requestId: 'a11-semantic-postflight-initial',
		kind: 'mutation-apply' as const,
		plan: preview.plan,
		authorization: { basis: 'user-explicit-request' as const },
		idempotencyKey: relationshipRequest.idempotencyKey,
		acknowledgements: [],
	};
	assert.equal((await gateway.apply(apply)).status, 'outcome-unknown');
	assert.ok(journal);
	const recovered = await gateway.apply({
		...apply,
		requestId: 'a11-semantic-postflight-recovery',
	});
	assert.equal(recovered.status, 'outcome-unknown');
	assert.match(recovered.error?.reason ?? '', /semantic postflight/i);
	assert.equal(recoveryCount, 1);
	assert.equal(semanticRecoveryCount, 1);
	assert.ok(journal);
	assert.equal(receipt, null);
});
