import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computeReceiptTargetDigestV1,
	computeSealedMutationPlanHashV1,
	sha256HexV1,
} from '../../../src/agent-runtime/contracts/v1/canonical';
import { structuredErrorV1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import {
	getOperonTaskWorkflowDeveloperApiV1,
	TaskWorkflowGatewayV1,
	type OperonTaskWorkflowDeveloperApiV1,
	type OperonTaskWorkflowDeveloperApiAccessorV1,
	type TaskWorkflowDeveloperApiRuntimeOptionsV1,
	type TaskWorkflowDeveloperApiAccessRequestV1,
	type TaskWorkflowDeveloperCapabilityAccessResultV1,
	type TaskWorkflowDeveloperCapabilitySubsetV1,
	type TaskFilterQueryRequestV1,
	type AdoptTaskSealedPlanV1,
	type PeriodicNoteCreateSealedPlanV1,
	type PeriodicNoteCreateSpecV1,
	type PeriodicNoteUpdateSealedPlanV1,
	type PeriodicNoteUpdateSpecV1,
	type TaskWorkflowApplyRequestV1,
	type TaskWorkflowMutationResultV1,
	type TaskWorkflowPreviewRequestV1,
	type TaskWorkflowPreviewResultV1,
} from '../../../src/agent-runtime/extensions/task-workflows-v1';
import { getOperonDeveloperApiV1 } from '../../../src/agent-runtime/developer-api';
import { DeveloperMutationSecurityPolicyV1 } from '../../../src/agent-runtime/developer-api/security';
import type { DeveloperMutationRecoveryRecordV1, DeveloperMutationRecoveryStoreV1 } from '../../../src/agent-runtime/developer-api/recovery-store';
import type {
	DeveloperApiGrantCapabilityV1,
	DeveloperApiGrantEvaluationV1,
} from '../../../src/agent-runtime/developer-api/grants';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
import {
	createOperonAgentRuntimeFacadeV1,
	RuntimeLifecycleCoordinatorV1,
} from '../../../src/agent-runtime/runtime';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';

const consumerPlugin = {
	manifest: { id: 'consumer.test', name: 'Consumer Test', version: '1.0.0' },
} as OperonDeveloperApiConsumerPluginV1;
const consumer = {
	id: 'consumer.test',
	name: 'Consumer Test',
	version: '1.0.0',
	instanceEpoch: 'instance-1',
};
const accessRequest: TaskWorkflowDeveloperApiAccessRequestV1 = {
	contractVersion: 1,
	runtimeApi: { min: 1, max: 1 },
	requestedCapabilities: ['tasks.filter-query'],
} as const;
const queryRequest: TaskFilterQueryRequestV1 = {
	contractVersion: 1,
	requestId: 'filter-query-test',
	kind: 'task-filter-query',
	consistency: 'live-verified',
	filterSetId: 'saved-filter',
	include: ['links'],
};

function assertBroadCapabilitySubsetStaysNarrow(
	result: TaskWorkflowDeveloperCapabilityAccessResultV1<TaskWorkflowDeveloperCapabilitySubsetV1>,
): void {
	if (!result.ok) return;
	// @ts-expect-error A broad capability union cannot promise filter-query access.
	void result.api.tasks.filterQuery;
	// @ts-expect-error A broad capability union cannot promise task-adoption access.
	void result.api.tasks.adopt;
}
void assertBroadCapabilitySubsetStaysNarrow;

test('task-workflow extension owns a typed accessor and the frozen base accessor rejects its capability', () => {
	let grantCalls = 0;
	const core = {
		system: { capabilities: () => [] },
	} as unknown as OperonAgentRuntimeCoreV1;
	const extensionAccessor = {
		getTaskWorkflowDeveloperApiV1: getOperonTaskWorkflowDeveloperApiV1.bind(null, core),
	} as unknown as OperonTaskWorkflowDeveloperApiAccessorV1;
	assert.equal(typeof extensionAccessor.getTaskWorkflowDeveloperApiV1, 'function');

	const baseResult = getOperonDeveloperApiV1(core, consumerPlugin, accessRequest, {
		isDesktopAvailable: () => true,
		isHostVersionSupported: () => true,
		lifecyclePhase: () => 'ready',
		retryAfterMs: () => undefined,
		lifecycleError: () => undefined,
		isCoreActive: value => value === core,
		grantController: {
			verifyConsumer: () => {
				grantCalls += 1;
				throw new Error('invalid base access must fail before consumer verification');
			},
			isConsumerCurrent: () => true,
			observeConsumerVersion: () => true,
			evaluate: () => {
				grantCalls += 1;
				throw new Error('invalid base access must fail before grant evaluation');
			},
			recordPending: () => undefined,
			hasPersistenceError: () => false,
		},
	});
	assert.equal(baseResult.ok, false);
	if (!baseResult.ok) assert.equal(baseResult.error.code, 'invalid-request');
	assert.equal(grantCalls, 0);
});

test('task-workflow Developer API keeps its accessor exact and rechecks the live grant per call', async () => {
	let grantState: DeveloperApiGrantEvaluationV1['state'] = 'pending';
	let pendingRecords = 0;
	let queryCalls = 0;
	let currentConsumer = true;
	let activeCore = true;
	const evaluation = (): DeveloperApiGrantEvaluationV1 => ({
		state: grantState,
		revision: grantState === 'active' ? 2 : 1,
		grantedCapabilities: grantState === 'active' ? ['tasks.filter-query'] : [],
		effectiveCapabilities: grantState === 'active' ? ['tasks.filter-query'] : [],
		pendingCapabilities: grantState === 'pending' ? ['tasks.filter-query'] : [],
		reason: grantState === 'active' ? 'active' : grantState === 'revoked' ? 'revoked' : 'capability-approval-required',
	});
	const core = {
		hasCapability: (capability: string) => capability === 'tasks.filter-query',
		system: {
			capabilities: () => [{ id: 'tasks.filter-query', availability: 'available', stability: 'stable' }],
		},
		tasks: {
			filterQuery: async (request: TaskFilterQueryRequestV1) => {
				queryCalls += 1;
				assert.notEqual(request, queryRequest, 'the caller request must be structured-cloned');
				return {
					contractVersion: 1 as const,
					requestId: request.requestId,
					kind: 'task-filter-query-result' as const,
					ok: false as const,
					freshness: { source: 'live-runtime' as const, coherence: 'verified' as const, observedAt: '2026-08-09T00:00:00.000Z', settled: true },
					warnings: [],
					error: structuredErrorV1('capability-unavailable', 'test result'),
				};
			},
		},
	} as unknown as OperonAgentRuntimeCoreV1;
	const options = {
		isDesktopAvailable: () => true,
		isHostVersionSupported: () => true,
		lifecyclePhase: () => 'ready' as const,
		isCoreActive: (candidate: OperonAgentRuntimeCoreV1) => activeCore && candidate === core,
		grantController: {
			verifyConsumer: (candidate: OperonDeveloperApiConsumerPluginV1) => candidate === consumerPlugin ? consumer : null,
			isConsumerCurrent: () => currentConsumer,
			evaluate: () => evaluation(),
			recordPending: () => { pendingRecords += 1; },
		},
	};

	for (const invalid of [
		{ ...accessRequest, requestedCapabilities: ['tasks.query'] },
		{ ...accessRequest, requestedCapabilities: ['tasks.filter-query', 'tasks.filter-query'] },
		{ ...accessRequest, extra: true },
	]) {
		assert.equal(getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, invalid as unknown as TaskWorkflowDeveloperApiAccessRequestV1, options).ok, false);
	}
	assert.equal(getOperonTaskWorkflowDeveloperApiV1(core, { ...consumerPlugin }, accessRequest, options).ok, false);

	const pending = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, accessRequest, options);
	assert.equal(pending.ok, false);
	assert.equal(pendingRecords, 1);

	grantState = 'active';
	const missingFilterCore = {
		system: {
			capabilities: () => [{ id: 'tasks.filter-query', availability: 'available' as const, stability: 'stable' as const }],
		},
		tasks: {},
	} as unknown as OperonAgentRuntimeCoreV1;
	const missingFilter = getOperonTaskWorkflowDeveloperApiV1(missingFilterCore, consumerPlugin, accessRequest, {
		...options,
		isCoreActive: candidate => candidate === missingFilterCore,
	});
	assert.equal(missingFilter.ok, false);
	if (!missingFilter.ok) assert.equal(missingFilter.error.code, 'capability-unavailable');
	const opened = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, accessRequest, options);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	assert.deepEqual(Object.keys(opened.api.tasks), ['filterQuery']);
	assert.equal(Object.isFrozen(opened.api), true);
	const filterOnlyApi: OperonTaskWorkflowDeveloperApiV1 = opened.api;
	// @ts-expect-error Frozen V1 filter-only consumers must not see adoption methods.
	void filterOnlyApi.tasks.adopt;
	const first = await filterOnlyApi.tasks.filterQuery(queryRequest);
	assert.equal(first.ok, false);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(queryCalls, 1);

	grantState = 'revoked';
	const revoked = await filterOnlyApi.tasks.filterQuery(queryRequest);
	assert.equal(revoked.ok, false);
	assert.equal(revoked.error.code, 'authority-insufficient');
	assert.equal(queryCalls, 1, 'revoked sessions must not reach the Runtime');

	grantState = 'active';
	currentConsumer = false;
	const staleConsumer = await filterOnlyApi.tasks.filterQuery(queryRequest);
	assert.equal(staleConsumer.ok, false);
	if (!staleConsumer.ok) assert.equal(staleConsumer.error.code, 'authority-insufficient');
	currentConsumer = true;
	activeCore = false;
	const staleCore = await filterOnlyApi.tasks.filterQuery(queryRequest);
	assert.equal(staleCore.ok, false);
	if (!staleCore.ok) assert.equal(staleCore.error.code, 'authority-insufficient');
	assert.equal(queryCalls, 1);
});

test('task-workflow adoption uses opaque handles, standing grants, and same-plan recovery', async () => {
	const requestedCapabilities = ['tasks.adopt.preview', 'tasks.adopt.apply'] as const;
	let applyCalls = 0;
	let previewCalls = 0;
	let outcome: 'applied' | 'unknown' = 'applied';
	const createdAt = '2026-08-18T00:00:00.000Z';
	const expiresAt = '2026-08-18T00:05:00.000Z';
	const plan = {
		contractVersion: 1, planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', planHash: 'a'.repeat(64),
		clientInstanceId: 'developer-api:consumer.test:instance-1', correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', idempotencyKeyHash: 'b'.repeat(64), receiptTargetDigest: 'c'.repeat(64),
		capability: 'tasks.adopt.preview', mutationKind: 'task.adopt', createdAt, expiresAt,
		targets: [], contextRevision: { index: { sessionId: 'index-session', ramGeneration: 1 }, settingsFingerprint: 'd'.repeat(64), pinnedGeneration: 0, activeTrackerGeneration: 0, repeatSeriesRevision: 0, projectSerialGeneration: 0, projectSerialSignature: 'e'.repeat(64) }, affectedResources: {}, atomicGroups: [{ groupId: 'inline:Tasks.md:0', resources: [] }], predictedEffects: [{ kind: 'task-source-update', summary: 'Adopt task.' }], riskLevel: 'routine', requiresConfirmation: false, requiredAcknowledgements: [], warnings: [],
		spec: { operation: 'adopt-inline', source: { filePath: 'Tasks.md', lineNumber: 0, expectedLine: '- [ ] Plain task' }, operonId: 'abc1234', resultingLine: '- [ ] Plain task {{operonId:: abc1234}}', sourceDigest: 'f'.repeat(64), resultDigest: '0'.repeat(64), locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 0 } },
	} as unknown as AdoptTaskSealedPlanV1;
	const records = new Map<string, DeveloperMutationRecoveryRecordV1>();
	const recoveryStore: DeveloperMutationRecoveryStoreV1 = {
		putPrepared: async record => { records.set(record.recoveryRef, structuredClone(record)); },
		get: async (consumerId, recoveryRef) => records.get(recoveryRef)?.consumerId === consumerId ? structuredClone(records.get(recoveryRef)!) : undefined,
		list: async consumerId => [...records.values()].filter(record => record.consumerId === consumerId && record.state === 'dispatched').map(record => structuredClone(record)),
		markDispatched: async (_consumerId, recoveryRef) => { const record = records.get(recoveryRef)!; records.set(recoveryRef, { ...record, state: 'dispatched' }); },
		markTerminal: async (_consumerId, recoveryRef) => { const record = records.get(recoveryRef)!; records.set(recoveryRef, { ...record, state: 'terminal' }); },
		markRefused: async (_consumerId, recoveryRef) => { const record = records.get(recoveryRef)!; records.set(recoveryRef, { ...record, state: 'refused' }); },
		delete: async (_consumerId, recoveryRef) => { records.delete(recoveryRef); },
	};
	const core = {
		hasCapability: (capability: string) => requestedCapabilities.includes(capability as never),
		system: { capabilities: () => requestedCapabilities.map(id => ({ id, availability: 'available' as const, stability: 'stable' as const })) },
		mutations: {
			previewTaskWorkflow: async () => {
				previewCalls += 1;
				return {
					contractVersion: 1 as const,
					requestId: 'preview',
					kind: 'mutation-preview-result' as const,
					ok: true as const,
					plan: { ...plan, planHash: `${'a'.repeat(63)}${previewCalls}` },
					warnings: [],
				};
			},
			applyTaskWorkflow: async (request: { readonly plan: AdoptTaskSealedPlanV1 }) => {
				const appliedPlan = request.plan as AdoptTaskSealedPlanV1;
				applyCalls += 1;
				if (outcome === 'unknown') return { contractVersion: 1 as const, requestId: 'apply', kind: 'mutation-result' as const, status: 'outcome-unknown' as const, mutationMayHaveApplied: true, retryAllowed: false, groupResults: [], error: structuredErrorV1('outcome-unknown', 'test uncertainty') };
				return { contractVersion: 1 as const, requestId: 'apply', kind: 'mutation-result' as const, status: 'applied' as const, mutationMayHaveApplied: true, retryAllowed: false, groupResults: [], receipt: { contractVersion: 1 as const, vaultIdentityHash: '1'.repeat(64), clientInstanceId: appliedPlan.clientInstanceId, idempotencyKeyHash: appliedPlan.idempotencyKeyHash, planHash: appliedPlan.planHash, mutationKind: 'task.adopt' as const, targetDigest: appliedPlan.receiptTargetDigest, terminalOutcome: 'applied' as const, effectiveAt: createdAt, completedAt: createdAt, expiresAt }, postflight: { status: 'verified' as const, observedAt: createdAt } };
			},
		},
	} as unknown as OperonAgentRuntimeCoreV1;
	const policy = new DeveloperMutationSecurityPolicyV1({ consent: { requestConsent: async () => 'unavailable' }, isSessionCurrent: () => true, isGrantCurrent: () => true, now: () => new Date(createdAt) });
	const options = {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready' as const, isCoreActive: (candidate: OperonAgentRuntimeCoreV1) => candidate === core,
		grantController: { verifyConsumer: (candidate: OperonDeveloperApiConsumerPluginV1) => candidate === consumerPlugin ? consumer : null, isConsumerCurrent: () => true, evaluate: () => ({ state: 'active' as const, revision: 4, grantedCapabilities: [...requestedCapabilities], effectiveCapabilities: [...requestedCapabilities], pendingCapabilities: [], reason: 'active' as const }), recordPending: () => undefined },
		mutationSecurityPolicy: policy,
		recoveryStore,
		recoverTaskWorkflowMutation: (request: TaskWorkflowApplyRequestV1) => core.mutations.applyTaskWorkflow!(request),
		createSessionId: () => 'task-workflow-session',
		now: () => new Date(createdAt),
	};
	const adoptionWithoutPolicy = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities }, {
		...options,
		mutationSecurityPolicy: undefined,
		createSessionId: () => 'task-workflow-session-without-policy',
	});
	assert.equal(adoptionWithoutPolicy.ok, true);
	if (!adoptionWithoutPolicy.ok) return;
	const refusedAdoptionPreview = await adoptionWithoutPolicy.api.tasks.adopt.preview({ operation: 'adopt-inline', source: { filePath: 'Tasks.md', lineNumber: 0, expectedLine: '- [ ] Plain task' } });
	assert.equal(refusedAdoptionPreview.ok, false);
	if (!refusedAdoptionPreview.ok) assert.equal(refusedAdoptionPreview.error.reason, 'Developer API task-adoption admission requires the host security policy.');
	const opened = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities }, options);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	assert.deepEqual(Object.keys(opened.api.tasks), ['adopt']);
	assert.deepEqual(Object.keys(opened.api.tasks.adopt), ['preview', 'apply', 'recover', 'pendingRecoveries']);
	const preview = await opened.api.tasks.adopt.preview({ operation: 'adopt-inline', source: { filePath: 'Tasks.md', lineNumber: 0, expectedLine: '- [ ] Plain task' } });
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.deepEqual(Object.keys(preview.plan), ['contractVersion', 'kind', 'recoveryRef', 'planDigest', 'createdAt', 'expiresAt', 'riskLevel', 'requiresConsent']);
	assert.equal('operonId' in preview.plan, false);
	const forged = await opened.api.tasks.adopt.apply({ plan: { ...preview.plan } as typeof preview.plan });
	assert.equal(forged.status, 'failed');
	assert.equal(applyCalls, 0);
	const firstApply = await opened.api.tasks.adopt.apply({ plan: preview.plan });
	assert.equal(firstApply.status, 'applied', JSON.stringify(firstApply));
	assert.equal(applyCalls, 1);
	assert.equal((await opened.api.tasks.adopt.apply({ plan: preview.plan })).status, 'already-applied');
	assert.equal(applyCalls, 1);
	const second = await opened.api.tasks.adopt.preview({ operation: 'adopt-inline', source: { filePath: 'Tasks.md', lineNumber: 0, expectedLine: '- [ ] Plain task' } });
	assert.equal(second.ok, true);
	if (!second.ok) return;
	outcome = 'unknown';
	assert.equal((await opened.api.tasks.adopt.apply({ plan: second.plan })).status, 'outcome-unknown');
	assert.equal((await opened.api.tasks.adopt.pendingRecoveries()).ok, true);
	outcome = 'applied';
	assert.equal((await opened.api.tasks.adopt.recover({ plan: second.plan })).status, 'applied');
});

test('periodic-note Developer API exposes create/update opaque preview/apply and receipt replay', async () => {
	const capabilities = ['tasks.create.periodic-note.preview', 'tasks.create.periodic-note.apply', 'tasks.update.periodic-note.preview', 'tasks.update.periodic-note.apply'] as const;
	const createdAt = '2026-08-21T10:00:00.000Z';
	const spec: PeriodicNoteCreateSpecV1 = {
		operation: 'create',
		items: [{
			itemRef: 'periodic-1', description: 'Periodic child',
			target: { representation: 'inline', mode: 'periodic-note', periodicKind: 'weekly', routeDate: '2026-08-23' },
			fields: [],
		}],
	};
	const plan = {
		contractVersion: 1, planId: 'periodic-plan', planHash: 'a'.repeat(64),
		clientInstanceId: 'developer-api:consumer.test:instance-1', correlationId: 'periodic-request',
		idempotencyKeyHash: 'b'.repeat(64), receiptTargetDigest: 'c'.repeat(64),
		capability: 'tasks.create.periodic-note.preview', mutationKind: 'task.create', createdAt,
		expiresAt: '2026-08-21T10:05:00.000Z', targets: [{ operonId: 'abc1234', locator: { representation: 'inline', filePath: 'Weekly/2026-W34.md', lineNumber: 1 }, targetDigest: 'd'.repeat(64) }],
		contextRevision: { index: { sessionId: 'index', ramGeneration: 1 }, settingsFingerprint: 'e'.repeat(64), pinnedGeneration: 0, activeTrackerGeneration: 0, repeatSeriesRevision: 0, projectSerialGeneration: 0, projectSerialSignature: 'f'.repeat(64) },
		affectedResources: [{ resourceKind: 'task-source', resourceKey: 'Weekly/2026-W34.md', revision: '1'.repeat(64) }],
		atomicGroups: [{ groupId: 'periodic-note:Weekly/2026-W34.md', order: 0, resources: [{ resourceKind: 'task-source', resourceKey: 'Weekly/2026-W34.md' }] }],
		predictedEffects: [{ resourceKind: 'task-source', resourceKey: 'Weekly/2026-W34.md', action: 'create', summary: 'Create Weekly note.' }],
		riskLevel: 'routine', requiresConfirmation: false, requiredAcknowledgements: [], warnings: [], spec,
		createEffects: [{ itemRef: 'periodic-1', operonId: 'abc1234', locator: { representation: 'inline', filePath: 'Weekly/2026-W34.md', lineNumber: 1 }, expectedAbsence: true, renderedTaskDigest: '2'.repeat(64), plannedSourceDigest: '3'.repeat(64), resolvedRelatedOperonIds: [] }],
		periodicRoute: { periodicKind: 'weekly', routeDateKey: '2026-08-23', periodicAnchorDateKey: '2026-08-17', routeSource: 'explicit-route-date', localToday: '2026-08-21', notePath: 'Weekly/2026-W34.md', headingKeyword: '## [[2026-08-23]]', configDigest: '4'.repeat(64), templatePath: null, templateDigest: '5'.repeat(64), noteExpectedState: 'absent', noteExpectedDigest: '6'.repeat(64), preparedNoteContent: '', container: { mode: 'none', registryState: 'not-required' } },
	} as unknown as PeriodicNoteCreateSealedPlanV1;
	const updateSpec: PeriodicNoteUpdateSpecV1 = {
		operation: 'update-periodic-note',
		target: { operonId: 'abc1234', locator: { representation: 'inline', filePath: 'Tasks.md', lineNumber: 4 } },
		changes: [
			{ field: 'dateScheduled', valueType: 'date', value: '2026-08-24' },
			{ field: 'taskType', valueType: 'text', value: 'project' },
			{ field: 'taskImage', valueType: 'text', value: 'cover.png' },
			{ field: 'taskGallery', valueType: 'list', value: ['one.png', 'two.png'] },
		],
	};
	const { createEffects: _createEffects, periodicRoute: _periodicRoute, ...planBase } = plan;
	const updatePlan = {
		...planBase,
		planId: 'periodic-update-plan', planHash: '8'.repeat(64), receiptTargetDigest: '9'.repeat(64),
		capability: 'tasks.update.periodic-note.preview', mutationKind: 'task.update', spec: updateSpec,
		targets: [{ operonId: 'abc1234', locator: updateSpec.target.locator, targetDigest: 'a'.repeat(64) }],
		periodicUpdate: {
			decision: 'realign', periodicKind: 'weekly', previousDateScheduled: '2026-08-23', nextDateScheduled: '2026-08-24', periodicAnchorDateKey: '2026-08-24', notePath: 'Weekly/2026-W35.md',
			configDigest: 'b'.repeat(64), templatePath: null, templateDigest: 'c'.repeat(64), container: { mode: 'existing', operonId: 'def5678', registryState: 'registered' },
			parentBefore: 'old1234', parentAfter: 'def5678', originalLocator: updateSpec.target.locator,
			sourceTransitions: [{ filePath: 'Tasks.md', expectedState: 'present', expectedDigest: 'd'.repeat(64), plannedDigest: 'e'.repeat(64) }],
		},
	} as unknown as PeriodicNoteUpdateSealedPlanV1;
	let applyCalls = 0;
	let useUncertainCreatePlan = false;
	let applyOutcome: 'applied' | 'outcome-unknown-without-error' = 'applied';
	const records = new Map<string, DeveloperMutationRecoveryRecordV1>();
	const recoveryStore: DeveloperMutationRecoveryStoreV1 = {
		putPrepared: async record => { records.set(record.recoveryRef, record); },
		get: async (_consumerId, recoveryRef) => records.get(recoveryRef),
		list: async () => [...records.values()].filter(record => record.state === 'dispatched'),
		markDispatched: async (_consumerId, recoveryRef) => { records.set(recoveryRef, { ...records.get(recoveryRef)!, state: 'dispatched' }); },
		markTerminal: async (_consumerId, recoveryRef) => { records.set(recoveryRef, { ...records.get(recoveryRef)!, state: 'terminal' }); },
		markRefused: async (_consumerId, recoveryRef) => { records.set(recoveryRef, { ...records.get(recoveryRef)!, state: 'refused' }); },
		delete: async (_consumerId, recoveryRef) => { records.delete(recoveryRef); },
	};
	const core = {
		hasCapability: (capability: string) => capabilities.includes(capability as never),
		system: { capabilities: () => capabilities.map(id => ({ id, availability: 'available' as const, stability: 'stable' as const })) },
		mutations: {
			previewTaskWorkflow: async (request: TaskWorkflowPreviewRequestV1) => ({ contractVersion: 1 as const, requestId: 'periodic-preview', kind: 'mutation-preview-result' as const, ok: true as const, warnings: [], plan: request.mutationKind === 'task.update' ? updatePlan : useUncertainCreatePlan ? { ...plan, planHash: '6'.repeat(64) } : plan }),
			applyTaskWorkflow: async (request: TaskWorkflowApplyRequestV1) => {
				applyCalls += 1;
				const appliedPlan = request.plan;
				if (applyOutcome === 'outcome-unknown-without-error') {
					return { contractVersion: 1 as const, requestId: 'periodic-apply', kind: 'mutation-result' as const, status: 'outcome-unknown' as const, mutationMayHaveApplied: true as const, retryAllowed: false as const, groupResults: [] };
				}
				return { contractVersion: 1 as const, requestId: 'periodic-apply', kind: 'mutation-result' as const, status: 'applied' as const, mutationMayHaveApplied: true as const, retryAllowed: false as const, groupResults: [{ groupId: appliedPlan.atomicGroups[0].groupId, status: 'committed' as const, resourceRevisions: [] }], receipt: { contractVersion: 1 as const, vaultIdentityHash: '7'.repeat(64), clientInstanceId: appliedPlan.clientInstanceId, idempotencyKeyHash: appliedPlan.idempotencyKeyHash, planHash: appliedPlan.planHash, mutationKind: appliedPlan.mutationKind, targetDigest: appliedPlan.receiptTargetDigest, terminalOutcome: 'applied' as const, effectiveAt: createdAt, completedAt: createdAt, expiresAt: '2026-08-22T10:00:00.000Z' }, postflight: { status: 'verified' as const, observedAt: createdAt, contextRevision: appliedPlan.contextRevision } };
			},
		},
	} as unknown as OperonAgentRuntimeCoreV1;
	const policy = new DeveloperMutationSecurityPolicyV1({ consent: { requestConsent: async () => 'unavailable' }, isSessionCurrent: () => true, isGrantCurrent: () => true, now: () => new Date(createdAt) });
	const opened = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: capabilities }, {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: candidate => candidate === core,
		grantController: { verifyConsumer: () => consumer, isConsumerCurrent: () => true, evaluate: () => ({ state: 'active', revision: 1, grantedCapabilities: [...capabilities], effectiveCapabilities: [...capabilities], pendingCapabilities: [], reason: 'active' }), recordPending: () => undefined },
		mutationSecurityPolicy: policy, recoveryStore, createSessionId: () => 'periodic-session', now: () => new Date(createdAt),
	});
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	const preview = await opened.api.tasks.createPeriodicNote.preview(spec);
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const applied = await opened.api.tasks.createPeriodicNote.apply({ plan: preview.plan });
	assert.equal(applied.status, 'applied');
	assert.equal(applied.receipt?.mutationKind, 'task.create');
	const replay = await opened.api.tasks.createPeriodicNote.apply({ plan: preview.plan });
	assert.equal(replay.status, 'already-applied');
	assert.equal(applyCalls, 1);
	const updatePreview = await opened.api.tasks.updatePeriodicNote.preview(updateSpec);
	assert.equal(updatePreview.ok, true);
	if (!updatePreview.ok) return;
	const updateApplied = await opened.api.tasks.updatePeriodicNote.apply({ plan: updatePreview.plan });
	assert.equal(updateApplied.status, 'applied');
	assert.equal(updateApplied.receipt?.mutationKind, 'task.update');
	assert.equal((await opened.api.tasks.updatePeriodicNote.apply({ plan: updatePreview.plan })).status, 'already-applied');
	assert.equal(applyCalls, 2);

	useUncertainCreatePlan = true;
	const uncertainPreview = await opened.api.tasks.createPeriodicNote.preview(spec);
	assert.equal(uncertainPreview.ok, true);
	if (!uncertainPreview.ok) return;
	applyOutcome = 'outcome-unknown-without-error';
	const uncertain = await opened.api.tasks.createPeriodicNote.apply({ plan: uncertainPreview.plan });
	assert.equal(uncertain.status, 'outcome-unknown');
	assert.equal(uncertain.error?.reason, 'The periodic-note outcome is uncertain. Recover only with this same opaque plan.');
	assert.equal(uncertain.error?.reason.includes('task-adoption'), false);
	const repeatedApply = await opened.api.tasks.createPeriodicNote.apply({ plan: uncertainPreview.plan });
	assert.equal(repeatedApply.status, 'failed');
	assert.equal(repeatedApply.error?.reason, 'Apply is unavailable while this periodic-note plan is recovery-required.');

	const withoutPolicy = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: capabilities }, {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: candidate => candidate === core,
		grantController: { verifyConsumer: () => consumer, isConsumerCurrent: () => true, evaluate: () => ({ state: 'active', revision: 1, grantedCapabilities: [...capabilities], effectiveCapabilities: [...capabilities], pendingCapabilities: [], reason: 'active' }), recordPending: () => undefined },
		recoveryStore, createSessionId: () => 'periodic-session-without-policy', now: () => new Date(createdAt),
	});
	assert.equal(withoutPolicy.ok, true);
	if (!withoutPolicy.ok) return;
	const refusedPreview = await withoutPolicy.api.tasks.createPeriodicNote.preview(spec);
	assert.equal(refusedPreview.ok, false);
	if (!refusedPreview.ok) assert.equal(refusedPreview.error.reason, 'Developer API periodic-note admission requires the host security policy.');
});

test('task-workflow Developer API reaches the Runtime facade, Gateway, source writer, and index without widening handles', async () => {
	const fixture = createRuntimeChainFixture();
	const primary = fixture.registerConsumer('companion.primary');
	const secondary = fixture.registerConsumer('companion.secondary');
	const capabilities = ['tasks.adopt.preview', 'tasks.adopt.apply'] as const;

	for (const source of [
		{ filePath: 'Tasks/Plain.md', lineNumber: 0, line: '- [ ] Plain Markdown task' },
		{ filePath: 'Tasks/Tasks-style.md', lineNumber: 0, line: '- [ ] Tasks-style checkbox 📅 2026-08-18' },
	]) {
		fixture.addSource(source);
		const opened = fixture.open(primary, capabilities, source.filePath === 'Tasks/Plain.md' ? 'source-plain' : 'source-tasks-style');
		assert.equal(opened.ok, true);
		if (!opened.ok) return;
		const preview = await opened.api.tasks.adopt.preview({
			operation: 'adopt-inline',
			source: {
				filePath: source.filePath,
				lineNumber: source.lineNumber,
				expectedLine: source.line,
			},
		});
		assert.equal(preview.ok, true, JSON.stringify(preview));
		if (!preview.ok) return;
		const applied = await opened.api.tasks.adopt.apply({ plan: preview.plan });
		assert.equal(applied.status, 'applied', JSON.stringify(applied));
		assert.equal(fixture.indexedOpen(preview.plan.planDigest), true, 'successful source writes must be reindexed as open tasks');
		assert.equal(fixture.sourceLine(source.filePath, source.lineNumber)?.includes('{{operonId::'), true);
		assert.equal((await opened.api.tasks.adopt.apply({ plan: preview.plan })).status, 'already-applied');
	}
	assert.equal(fixture.consentCalls(), 0, 'routine adoption must use the standing capability grant without a consent prompt');
	assert.equal(fixture.writeCount(), 2, 'replay must not write a second task');

	const handleSource = { filePath: 'Tasks/Handles.md', lineNumber: 0, line: '- [ ] Opaque handle task' };
	fixture.addSource(handleSource);
	const firstSession = fixture.open(primary, capabilities, 'handle-session-one');
	const secondSession = fixture.open(primary, capabilities, 'handle-session-two');
	const otherConsumer = fixture.open(secondary, capabilities, 'other-consumer-session');
	assert.equal(firstSession.ok && secondSession.ok && otherConsumer.ok, true);
	if (!firstSession.ok || !secondSession.ok || !otherConsumer.ok) return;
	const opaquePreview = await firstSession.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(handleSource) });
	assert.equal(opaquePreview.ok, true);
	if (!opaquePreview.ok) return;
	const beforeHandleRejects = fixture.writeCount();
	assert.equal((await firstSession.api.tasks.adopt.apply({ plan: { ...opaquePreview.plan } as typeof opaquePreview.plan })).status, 'failed', 'cloned handles must be rejected');
	assert.equal((await secondSession.api.tasks.adopt.apply({ plan: opaquePreview.plan })).status, 'failed', 'cross-session handles must be rejected');
	assert.equal((await otherConsumer.api.tasks.adopt.apply({ plan: opaquePreview.plan })).status, 'failed', 'cross-consumer handles must be rejected');
	assert.equal(fixture.writeCount(), beforeHandleRejects, 'forged handles must stop before the source writer');
	assert.equal((await firstSession.api.tasks.adopt.apply({ plan: opaquePreview.plan })).status, 'applied');

	for (const scenario of ['stale', 'moved', 'edited', 'terminal'] as const) {
		const source = { filePath: `Tasks/${scenario}.md`, lineNumber: 0, line: '- [ ] Source precondition task' };
		fixture.addSource(source);
		const opened = fixture.open(primary, capabilities, `precondition-${scenario}`);
		assert.equal(opened.ok, true);
		if (!opened.ok) return;
		const preview = await opened.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(source) });
		assert.equal(preview.ok, true);
		if (!preview.ok) return;
		const writes = fixture.writeCount();
		if (scenario === 'moved') fixture.moveSource(source.filePath, source.lineNumber, `Moved/${scenario}.md`, 1);
		else if (scenario === 'terminal') fixture.replaceSource(source.filePath, source.lineNumber, '- [x] Source precondition task');
		else if (scenario === 'edited') fixture.replaceSource(source.filePath, source.lineNumber, '- [ ] Source text changed');
		else fixture.removeSource(source.filePath, source.lineNumber);
		const refused = await opened.api.tasks.adopt.apply({ plan: preview.plan });
		assert.equal(refused.status, 'failed', `${scenario} must fail closed before the writer`);
		assert.equal(fixture.writeCount(), writes, `${scenario} must not write`);
		assert.equal(fixture.indexedOpen(preview.plan.planDigest), false, `${scenario} must not create an indexed task`);
	}

	const recoverySource = { filePath: 'Tasks/Recovery.md', lineNumber: 0, line: '- [ ] Recovery task' };
	fixture.addSource(recoverySource);
	const recoverySession = fixture.open(primary, capabilities, 'recovery-same-session');
	assert.equal(recoverySession.ok, true);
	if (!recoverySession.ok) return;
	const recoveryPreview = await recoverySession.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(recoverySource) });
	assert.equal(recoveryPreview.ok, true);
	if (!recoveryPreview.ok) return;
	fixture.setOutcomeUnknownAfterDispatch(true);
	assert.equal((await recoverySession.api.tasks.adopt.apply({ plan: recoveryPreview.plan })).status, 'outcome-unknown');
	assert.equal(fixture.writeCount(), 3, 'uncertain dispatch fixture stops before the source writer');
	fixture.setOutcomeUnknownAfterDispatch(false);
	fixture.clearRecoveryEvidence(recoveryPreview.plan.planDigest);
	const recoveryAuditsBeforeSameSession = fixture.recoveryAuditCount();
	assert.equal((await recoverySession.api.tasks.adopt.recover({ plan: recoveryPreview.plan })).status, 'applied');
	assert.equal(fixture.recoveryAuditCount(), recoveryAuditsBeforeSameSession + 1, 'unexpired same-session recovery must use recovery audit mode');
	assert.equal(fixture.indexedOpen(recoveryPreview.plan.planDigest), true);

	const restartSource = { filePath: 'Tasks/Restart.md', lineNumber: 0, line: '- [ ] Restart recovery task' };
	fixture.addSource(restartSource);
	const beforeRestart = fixture.writeCount();
	const originalSession = fixture.open(primary, capabilities, 'recovery-original-session');
	assert.equal(originalSession.ok, true);
	if (!originalSession.ok) return;
	const restartPreview = await originalSession.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(restartSource) });
	assert.equal(restartPreview.ok, true);
	if (!restartPreview.ok) return;
	fixture.setOutcomeUnknownAfterDispatch(true);
	const uncertain = await originalSession.api.tasks.adopt.apply({ plan: restartPreview.plan });
	assert.equal(uncertain.status, 'outcome-unknown');
	fixture.setOutcomeUnknownAfterDispatch(false);
	fixture.clearRecoveryEvidence(restartPreview.plan.planDigest);
	const restarted = fixture.open(primary, capabilities, 'recovery-restarted-session');
	assert.equal(restarted.ok, true);
	if (!restarted.ok) return;
	const recoveryAuditsBeforeRestart = fixture.recoveryAuditCount();
	assert.equal((await restarted.api.tasks.adopt.recover({ recoveryRef: restartPreview.plan.recoveryRef })).status, 'applied');
	assert.equal(fixture.recoveryAuditCount(), recoveryAuditsBeforeRestart + 1, 'unexpired restart recovery must use recovery audit mode');
	assert.equal(fixture.writeCount(), beforeRestart + 1, 'restart recovery must apply exactly once');
	assert.equal(fixture.indexedOpen(restartPreview.plan.planDigest), true);

	const expiredWithoutEvidenceSource = { filePath: 'Tasks/Expired-no-evidence.md', lineNumber: 0, line: '- [ ] Expired recovery without evidence' };
	fixture.addSource(expiredWithoutEvidenceSource);
	const expiredWithoutEvidenceSession = fixture.open(primary, capabilities, 'expired-no-evidence-original');
	assert.equal(expiredWithoutEvidenceSession.ok, true);
	if (!expiredWithoutEvidenceSession.ok) return;
	const expiredWithoutEvidencePreview = await expiredWithoutEvidenceSession.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(expiredWithoutEvidenceSource) });
	assert.equal(expiredWithoutEvidencePreview.ok, true);
	if (!expiredWithoutEvidencePreview.ok) return;
	fixture.setOutcomeUnknownAfterDispatch(true);
	assert.equal((await expiredWithoutEvidenceSession.api.tasks.adopt.apply({ plan: expiredWithoutEvidencePreview.plan })).status, 'outcome-unknown');
	fixture.setOutcomeUnknownAfterDispatch(false);
	fixture.clearRecoveryEvidence(expiredWithoutEvidencePreview.plan.planDigest);
	fixture.advanceTime(300_001);
	const writesBeforeNoEvidence = fixture.writeCount();
	const recoveryAuditsBeforeNoEvidence = fixture.recoveryAuditCount();
	const expiredWithoutEvidenceRestart = fixture.open(primary, capabilities, 'expired-no-evidence-restart');
	assert.equal(expiredWithoutEvidenceRestart.ok, true);
	if (!expiredWithoutEvidenceRestart.ok) return;
	const expiredWithoutEvidenceResult = await expiredWithoutEvidenceRestart.api.tasks.adopt.recover({ recoveryRef: expiredWithoutEvidencePreview.plan.recoveryRef });
	assert.equal(expiredWithoutEvidenceResult.status, 'failed');
	assert.equal(expiredWithoutEvidenceResult.error.code, 'plan-expired');
	assert.equal(fixture.writeCount(), writesBeforeNoEvidence, 'expired recovery without exact evidence must not write');
	assert.equal(fixture.recoveryAuditCount(), recoveryAuditsBeforeNoEvidence, 'expired recovery without evidence must not dispatch');
	fixture.advanceTime(-300_001);

	const expiredWithEvidenceSource = { filePath: 'Tasks/Expired-with-evidence.md', lineNumber: 0, line: '- [ ] Expired recovery with exact evidence' };
	fixture.addSource(expiredWithEvidenceSource);
	const expiredWithEvidenceSession = fixture.open(primary, capabilities, 'expired-with-evidence-original');
	assert.equal(expiredWithEvidenceSession.ok, true);
	if (!expiredWithEvidenceSession.ok) return;
	const expiredWithEvidencePreview = await expiredWithEvidenceSession.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(expiredWithEvidenceSource) });
	assert.equal(expiredWithEvidencePreview.ok, true);
	if (!expiredWithEvidencePreview.ok) return;
	fixture.setOutcomeUnknownAfterDispatch(true);
	assert.equal((await expiredWithEvidenceSession.api.tasks.adopt.apply({ plan: expiredWithEvidencePreview.plan })).status, 'outcome-unknown');
	fixture.setOutcomeUnknownAfterDispatch(false);
	fixture.advanceTime(300_001);
	const writesBeforeEvidenceRecovery = fixture.writeCount();
	const recoveryAuditsBeforeEvidenceRecovery = fixture.recoveryAuditCount();
	const expiredWithEvidenceRestart = fixture.open(primary, capabilities, 'expired-with-evidence-restart');
	assert.equal(expiredWithEvidenceRestart.ok, true);
	if (!expiredWithEvidenceRestart.ok) return;
	assert.equal((await expiredWithEvidenceRestart.api.tasks.adopt.recover({ recoveryRef: expiredWithEvidencePreview.plan.recoveryRef })).status, 'applied');
	assert.equal(fixture.writeCount(), writesBeforeEvidenceRecovery + 1, 'expired recovery with exact evidence must write exactly once');
	assert.equal(fixture.recoveryAuditCount(), recoveryAuditsBeforeEvidenceRecovery + 1, 'expired evidence recovery must use the recovery audit mode');
	assert.equal(fixture.indexedOpen(expiredWithEvidencePreview.plan.planDigest), true);
	fixture.advanceTime(-300_001);

	const missingPortSource = { filePath: 'Tasks/Missing-recovery-port.md', lineNumber: 0, line: '- [ ] Missing recovery port' };
	fixture.addSource(missingPortSource);
	const missingPortOriginal = fixture.open(primary, capabilities, 'missing-port-original');
	assert.equal(missingPortOriginal.ok, true);
	if (!missingPortOriginal.ok) return;
	const missingPortPreview = await missingPortOriginal.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(missingPortSource) });
	assert.equal(missingPortPreview.ok, true);
	if (!missingPortPreview.ok) return;
	fixture.setOutcomeUnknownAfterDispatch(true);
	assert.equal((await missingPortOriginal.api.tasks.adopt.apply({ plan: missingPortPreview.plan })).status, 'outcome-unknown');
	fixture.setOutcomeUnknownAfterDispatch(false);
	const writesBeforeMissingPort = fixture.writeCount();
	const missingPortRestart = fixture.open(primary, capabilities, 'missing-port-restart', false);
	assert.equal(missingPortRestart.ok, true);
	if (!missingPortRestart.ok) return;
	assert.equal((await missingPortRestart.api.tasks.adopt.recover({ recoveryRef: missingPortPreview.plan.recoveryRef })).status, 'outcome-unknown');
	assert.equal(fixture.writeCount(), writesBeforeMissingPort, 'missing host recovery port must fail closed before source write');

	fixture.addBaseRecovery(primary);
	const pending = await restarted.api.tasks.adopt.pendingRecoveries();
	assert.equal(pending.ok, true);
	if (!pending.ok) return;
	assert.equal(pending.recoveries.some(item => item.recoveryRef === fixture.baseRecoveryRef()), false, 'task-workflow sessions must not list base mutation recovery records');
	assert.equal((await restarted.api.tasks.adopt.recover({ recoveryRef: fixture.baseRecoveryRef() })).status, 'failed', 'task-workflow recovery must reject a base-family recovery reference');

	fixture.setGrantState('revoked');
	assert.equal((await restarted.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(restartSource) })).ok, false, 'revoked grants must stop before Runtime preview');
	fixture.setGrantState('active');
	fixture.setCoreActive(false);
	assert.equal((await restarted.api.tasks.adopt.preview({ operation: 'adopt-inline', source: sourceIntent(restartSource) })).ok, false, 'lost Runtime lifecycle ownership must stop calls');
	fixture.setCoreActive(true);
	fixture.setCapabilityAvailable(false);
	assert.equal(fixture.open(primary, capabilities, 'capability-unavailable').ok, false, 'unavailable advertised capability must reject access');
});

function sourceIntent(source: { filePath: string; lineNumber: number; line: string }): {
	filePath: string;
	lineNumber: number;
	expectedLine: string;
} {
	return {
		filePath: source.filePath,
		lineNumber: source.lineNumber,
		expectedLine: source.line,
	};
}

class MemoryTaskWorkflowRecoveryStoreV1 implements DeveloperMutationRecoveryStoreV1 {
	readonly records = new Map<string, DeveloperMutationRecoveryRecordV1>();

	async putPrepared(record: DeveloperMutationRecoveryRecordV1): Promise<void> {
		this.records.set(record.recoveryRef, structuredClone(record));
	}

	async get(consumerId: string, recoveryRef: string): Promise<DeveloperMutationRecoveryRecordV1 | undefined> {
		const record = this.records.get(recoveryRef);
		return record?.consumerId === consumerId ? structuredClone(record) : undefined;
	}

	async list(consumerId: string): Promise<readonly DeveloperMutationRecoveryRecordV1[]> {
		return [...this.records.values()]
			.filter(record => record.consumerId === consumerId && record.state === 'dispatched')
			.map(record => structuredClone(record));
	}

	async markDispatched(_consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record) this.records.set(recoveryRef, { ...record, state: 'dispatched' });
	}

	async markTerminal(_consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record) this.records.set(recoveryRef, { ...record, state: 'terminal' });
	}

	async markRefused(_consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record) this.records.set(recoveryRef, { ...record, state: 'refused' });
	}

	async delete(_consumerId: string, recoveryRef: string): Promise<void> {
		this.records.delete(recoveryRef);
	}
}

function createRuntimeChainFixture(): {
	registerConsumer(id: string): OperonDeveloperApiConsumerPluginV1;
	open<TCapabilities extends TaskWorkflowDeveloperCapabilitySubsetV1>(consumer: OperonDeveloperApiConsumerPluginV1, capabilities: TCapabilities, sessionId: string, withRecoveryPort?: boolean): ReturnType<typeof getOperonTaskWorkflowDeveloperApiV1<TCapabilities>>;
	addSource(source: { filePath: string; lineNumber: number; line: string }): void;
	sourceLine(filePath: string, lineNumber: number): string | undefined;
	replaceSource(filePath: string, lineNumber: number, line: string): void;
	removeSource(filePath: string, lineNumber: number): void;
	moveSource(filePath: string, lineNumber: number, nextPath: string, nextLineNumber: number): void;
	indexedOpen(planDigest: string): boolean;
	writeCount(): number;
	consentCalls(): number;
	setOutcomeUnknownAfterDispatch(value: boolean): void;
	setGrantState(value: DeveloperApiGrantEvaluationV1['state']): void;
	setCoreActive(value: boolean): void;
	setCapabilityAvailable(value: boolean): void;
	advanceTime(milliseconds: number): void;
	clearRecoveryEvidence(planDigest: string): void;
	recoveryAuditCount(): number;
	addBaseRecovery(consumer: OperonDeveloperApiConsumerPluginV1): void;
	baseRecoveryRef(): string;
} {
	const sources = new Map<string, string>();
	const indexed = new Set<string>();
	const receipts = new Map<string, TaskWorkflowMutationResultV1>();
	const recoveryEvidence = new Set<string>();
	const recoveryStore = new MemoryTaskWorkflowRecoveryStoreV1();
	const consumers = new Map<OperonDeveloperApiConsumerPluginV1, { id: string; name: string; version: string; instanceEpoch: string }>();
	const availableCapabilities = new Set(['tasks.adopt.preview', 'tasks.adopt.apply']);
	let grantState: DeveloperApiGrantEvaluationV1['state'] = 'active';
	let coreActive = true;
	let unknownAfterDispatch = false;
	let writes = 0;
	let previews = 0;
	let consentPrompts = 0;
	let nowMs = Date.now();
	let recoveryAudits = 0;
	const baseRef = `dvr1_${'b'.repeat(48)}`;
	const key = (filePath: string, lineNumber: number): string => `${filePath}\u0000${lineNumber}`;
	const contextRevision = (now: string) => ({
		index: { sessionId: 'acceptance-index', ramGeneration: writes, durable: { status: 'available' as const, snapshotId: 'acceptance-snapshot', committedAt: now } },
		settingsFingerprint: sha256HexV1('acceptance-settings'),
		pinnedGeneration: 0,
		activeTrackerGeneration: 0,
		repeatSeriesRevision: 0,
		projectSerialGeneration: 0,
		projectSerialSignature: sha256HexV1('acceptance-projects'),
	});
	const failed = (requestId: string, reason: string): TaskWorkflowMutationResultV1 => ({
		contractVersion: 1,
		requestId,
		kind: 'mutation-result',
		status: 'failed',
		mutationMayHaveApplied: false,
		retryAllowed: false,
		groupResults: [],
		error: structuredErrorV1('stale-source', reason),
	});
	const gateway = new TaskWorkflowGatewayV1({
		isReady: () => coreActive,
		nowEpochMs: () => nowMs,
		preview: async (request: TaskWorkflowPreviewRequestV1): Promise<TaskWorkflowPreviewResultV1> => {
			if (request.mutationKind !== 'task.adopt') throw new Error('acceptance fixture only accepts adoption previews');
			const source = request.spec.source;
			const current = sources.get(key(source.filePath, source.lineNumber));
			if (current !== source.expectedLine) {
				return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-preview-result', ok: false, warnings: [], error: structuredErrorV1('stale-source', 'The source changed before preview.') };
			}
			const now = new Date(nowMs);
			const createdAt = now.toISOString();
			const operonId = `a${(++previews).toString(36).padStart(6, '0')}`;
			const target = {
				operonId,
				locator: { representation: 'inline' as const, filePath: source.filePath, lineNumber: source.lineNumber },
				targetDigest: sha256HexV1(`${source.filePath}:${source.lineNumber}:${current}`),
			};
			const resource = { resourceKind: 'task-source' as const, resourceKey: source.filePath, revision: sha256HexV1(current) };
			const plan: AdoptTaskSealedPlanV1 = {
				contractVersion: 1,
				planId: `acceptance-plan-${previews}`,
				planHash: '0'.repeat(64),
				clientInstanceId: request.clientInstanceId,
				correlationId: request.correlationId ?? request.requestId,
				idempotencyKeyHash: sha256HexV1(request.idempotencyKey),
				receiptTargetDigest: computeReceiptTargetDigestV1([target] as never),
				capability: 'tasks.adopt.preview',
				mutationKind: 'task.adopt',
				createdAt,
				expiresAt: new Date(now.getTime() + 300_000).toISOString(),
				targets: [target],
				contextRevision: contextRevision(createdAt),
				affectedResources: [resource],
				atomicGroups: [{ groupId: `task-source:${source.filePath}`, order: 0, resources: [{ resourceKind: resource.resourceKind, resourceKey: resource.resourceKey }], }],
				predictedEffects: [{ resourceKind: resource.resourceKind, resourceKey: resource.resourceKey, action: 'update', summary: 'Adopt the inline task.' }],
				riskLevel: 'routine',
				requiresConfirmation: false,
				requiredAcknowledgements: [],
				warnings: [],
				spec: {
					operation: 'adopt-inline',
					source: { ...source },
					operonId,
					resultingLine: `${current} {{operonId:: ${operonId}}}`,
					sourceDigest: sha256HexV1(current),
					resultDigest: sha256HexV1(`${current} {{operonId:: ${operonId}}}`),
					locator: { representation: 'inline', filePath: source.filePath, lineNumber: source.lineNumber },
				},
			};
			plan.planHash = computeSealedMutationPlanHashV1(plan as never);
			return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-preview-result', ok: true, warnings: [], plan };
		},
		hasSamePlanRecoveryEvidence: async request => recoveryEvidence.has(request.plan.planHash),
		apply: async (request: TaskWorkflowApplyRequestV1, execution): Promise<TaskWorkflowMutationResultV1> => {
			if (request.plan.mutationKind !== 'task.adopt') return failed(request.requestId, 'The acceptance source writer accepts adoption plans only.');
			const plan = request.plan;
			const source = plan.spec.source;
			const current = sources.get(key(source.filePath, source.lineNumber));
			if (current !== source.expectedLine || current?.includes('{{operonId::')) return failed(request.requestId, 'The source precondition no longer matches the sealed plan.');
			if (/^\s*-\s*\[[xX]\]/u.test(current)) return failed(request.requestId, 'The source task is terminal.');
			const existing = receipts.get(plan.planHash);
			if (existing?.receipt) {
				return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-result', status: 'already-applied', mutationMayHaveApplied: true, retryAllowed: false, groupResults: [], receipt: { ...existing.receipt, terminalOutcome: 'already-applied' }, postflight: { status: 'receipt-replay' } };
			}
			await execution.dispatch(recoveryEvidence.has(plan.planHash) ? 'recovery-dispatched' : 'apply-dispatched');
			if (unknownAfterDispatch) {
				recoveryEvidence.add(plan.planHash);
				throw new Error('forced after-dispatch uncertainty');
			}
			writes += 1;
			sources.set(key(source.filePath, source.lineNumber), plan.spec.resultingLine);
			indexed.add(plan.planHash);
			recoveryEvidence.delete(plan.planHash);
			const completedAt = new Date(nowMs).toISOString();
			const result: TaskWorkflowMutationResultV1 = {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'applied',
				mutationMayHaveApplied: true,
				retryAllowed: false,
				groupResults: [{ groupId: plan.atomicGroups[0]!.groupId, status: 'committed', resourceRevisions: [{ resourceKind: 'task-source', resourceKey: source.filePath, revision: plan.spec.resultDigest }] }],
				receipt: { contractVersion: 1, vaultIdentityHash: sha256HexV1('acceptance-vault'), clientInstanceId: plan.clientInstanceId, idempotencyKeyHash: plan.idempotencyKeyHash, planHash: plan.planHash, mutationKind: 'task.adopt', targetDigest: plan.receiptTargetDigest, terminalOutcome: 'applied', effectiveAt: plan.createdAt, completedAt, expiresAt: new Date(Date.parse(completedAt) + 86_400_000).toISOString() },
				postflight: { status: 'verified', observedAt: completedAt, contextRevision: contextRevision(completedAt) },
			};
			receipts.set(plan.planHash, result);
			return result;
		},
		auditDispatched: async event => { if (event === 'recovery-dispatched') recoveryAudits += 1; },
		auditCompleted: async () => undefined,
	});
	const lifecycle = new RuntimeLifecycleCoordinatorV1();
	const release = lifecycle.beginSettling();
	lifecycle.markReady();
	release();
	const core = createOperonAgentRuntimeFacadeV1(lifecycle, {
		persistencePhase: () => 'idle',
		revision: () => undefined,
		capabilityAvailability: capability => availableCapabilities.has(capability) ? { availability: 'available' } : undefined,
		previewTaskWorkflowMutation: request => gateway.preview(request),
		applyTaskWorkflowMutation: request => gateway.apply(request),
	});
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => { consentPrompts += 1; return 'unavailable'; } },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const options = (
		sessionId: string,
		withRecoveryPort = true,
	): TaskWorkflowDeveloperApiRuntimeOptionsV1 => ({
		isDesktopAvailable: () => true,
		isHostVersionSupported: () => true,
		lifecyclePhase: () => lifecycle.getPhase(),
		isCoreActive: (candidate: OperonAgentRuntimeCoreV1) => coreActive && candidate === core,
		grantController: {
			verifyConsumer: (candidate: OperonDeveloperApiConsumerPluginV1) => consumers.get(candidate) ?? null,
			isConsumerCurrent: (candidate: { id: string }) => [...consumers.values()].some(consumer => consumer.id === candidate.id),
			evaluate: (_consumer: { id: string }, requestedCapabilities: readonly DeveloperApiGrantCapabilityV1[]): DeveloperApiGrantEvaluationV1 => ({
				state: grantState,
				revision: 1,
				grantedCapabilities: grantState === 'active' ? [...requestedCapabilities] : [],
				effectiveCapabilities: grantState === 'active' ? [...requestedCapabilities] : [],
				pendingCapabilities: grantState === 'pending' ? [...requestedCapabilities] : [],
				reason: grantState === 'active' ? 'active' : grantState === 'revoked' ? 'revoked' : 'capability-approval-required',
			}),
			recordPending: () => undefined,
		},
		mutationSecurityPolicy: policy,
		recoveryStore,
		...(withRecoveryPort
			? { recoverTaskWorkflowMutation: (request: TaskWorkflowApplyRequestV1) => gateway.recover(request) }
			: {}),
		createSessionId: () => sessionId,
		now: () => new Date(nowMs),
	});
	return {
		registerConsumer: id => {
			const plugin = { manifest: { id, name: id, version: '1.0.0' } } as OperonDeveloperApiConsumerPluginV1;
			consumers.set(plugin, { id, name: id, version: '1.0.0', instanceEpoch: `instance-${id}` });
			return plugin;
		},
		open: (consumer, capabilities, sessionId, withRecoveryPort = true) => getOperonTaskWorkflowDeveloperApiV1(core, consumer, {
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
			requestedCapabilities: capabilities,
		}, options(sessionId, withRecoveryPort)),
		addSource: source => { sources.set(key(source.filePath, source.lineNumber), source.line); },
		sourceLine: (filePath, lineNumber) => sources.get(key(filePath, lineNumber)),
		replaceSource: (filePath, lineNumber, line) => { sources.set(key(filePath, lineNumber), line); },
		removeSource: (filePath, lineNumber) => { sources.delete(key(filePath, lineNumber)); },
		moveSource: (filePath, lineNumber, nextPath, nextLineNumber) => {
			const line = sources.get(key(filePath, lineNumber));
			sources.delete(key(filePath, lineNumber));
			if (line !== undefined) sources.set(key(nextPath, nextLineNumber), line);
		},
		indexedOpen: planDigest => indexed.has(planDigest),
		writeCount: () => writes,
		consentCalls: () => consentPrompts,
		setOutcomeUnknownAfterDispatch: value => { unknownAfterDispatch = value; },
		setGrantState: value => { grantState = value; },
		setCoreActive: value => { coreActive = value; },
		setCapabilityAvailable: value => {
			if (value) {
				availableCapabilities.add('tasks.adopt.preview');
				availableCapabilities.add('tasks.adopt.apply');
			} else {
				availableCapabilities.delete('tasks.adopt.apply');
			}
		},
		advanceTime: milliseconds => { nowMs += milliseconds; },
		clearRecoveryEvidence: planDigest => { recoveryEvidence.delete(planDigest); },
		recoveryAuditCount: () => recoveryAudits,
		addBaseRecovery: consumer => {
			const descriptor = consumers.get(consumer);
			if (!descriptor) throw new Error('consumer is not registered');
			recoveryStore.records.set(baseRef, {
				contractVersion: 1,
				recoveryRef: baseRef,
				consumerId: descriptor.id,
				planDigest: sha256HexV1('base-recovery'),
				sealed: { capability: 'tasks.update.preview', mutationKind: 'task.update' } as never,
				binding: { consumerId: descriptor.id, instanceEpoch: descriptor.instanceEpoch, sessionId: 'base-session', grantRevision: 1, capability: 'tasks.update.preview', planHash: sha256HexV1('base-plan'), targetDigest: sha256HexV1('base-target') },
				idempotencyKey: 'base-recovery-key',
				authorization: { basis: 'user-explicit-request' },
				acknowledgements: [],
				state: 'dispatched',
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			});
		},
		baseRecoveryRef: () => baseRef,
	};
}
