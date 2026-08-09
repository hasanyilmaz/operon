import assert from 'node:assert/strict';
import type { OperonSettings } from '../../../src/types/settings';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import { decodeCapabilityAdvertisementsV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import {
	computeContextSettingsFingerprintV1,
	createAgentRuntimeSessionId,
	createOperonAgentRuntimeFacadeV1,
	hashProjectSerialSignatureV1,
	RuntimeCoherentReadCoordinatorV1,
	RuntimeLifecycleCoordinatorV1,
	RuntimeSettlementBarrierV1,
	RuntimeSettingsFreshnessCoordinatorV1,
	savedFilterQueryDigestV1,
	SealedIndexRevisionV1,
	SingleFlightRuntimeBarrierV1,
	type RuntimeRevisionSnapshotV1,
} from '../../../src/agent-runtime/runtime';
import {
	TaskWorkflowGatewayV1,
	admitTaskWorkflowApplyRequestExtensionV1,
	decodeTaskFilterQueryResultExtensionV1,
	decodeTaskWorkflowApplyRequestExtensionV1,
	decodeTaskWorkflowCliResultEnvelopeExtensionV1,
	decodeTaskWorkflowMutationResultExtensionV1,
	decodeTaskWorkflowPreviewResultExtensionV1,
	taskWorkflowTerminalAuditFieldsV1,
	type TaskWorkflowApplyRequestV1,
	type TaskWorkflowPreviewRequestV1,
} from '../../../src/agent-runtime/extensions/task-workflows-v1';

declare global {
	var __operonAgentRuntimeCoreTestRun: Promise<void> | undefined;
}

globalThis.__operonAgentRuntimeCoreTestRun = run();

async function run(): Promise<void> {
	testLifecycleAndAdmission();
	await testFrozenFacadeAndHealth();
	await testTaskWorkflowGatewayIsolation();
	await testHealthRevisionIsolationAndPerformance();
	testSettingsFingerprintBoundary();
	testSavedFilterQueryDigest();
	testSealedIndexRevision();
	assert.match(createAgentRuntimeSessionId(), /^runtime-[a-f0-9]{32}$/u);
	assert.equal(hashProjectSerialSignatureV1('project-serial-signature').length, 64);
	await testSingleFlightBarrier();
	await testRuntimeSettlementBarrier();
	await testCoherentReadRetry();
	await testCoherentReadJoinsActiveSettlement();
	await testCoherentReadRecoversRetryableFreshness();
	await testCoherentReadDetectsSettlementDuringProjection();
	await testCoherentReadSecondDrift();
	await testBestEffortDrift();
	await testBestEffortReadmitsAfterRefresh();
	await testProjectionIsolationAndPrivateErrors();
	await testDeadlineAndAbort();
	await testSettingsFreshnessCoordinator();
	console.log('Agent Runtime core tests passed');
}

async function testTaskWorkflowGatewayIsolation(): Promise<void> {
	const envelope = {
		contractVersion: 1,
		kind: 'cli-result',
		requestId: 'filter-envelope',
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
			requestId: 'filter-envelope',
			kind: 'task-filter-query-result',
			ok: false,
			freshness: { source: 'live-runtime', coherence: 'verified', observedAt: '2026-08-09T00:00:00.000Z', settled: true },
			warnings: [],
			error: { contractVersion: 1, code: 'capability-unavailable', reason: 'Unavailable.', retryable: false, action: 'rediscover' },
		},
	} as const;
	const decodedEnvelope = decodeTaskWorkflowCliResultEnvelopeExtensionV1(envelope);
	assert.equal(decodedEnvelope.ok, true, decodedEnvelope.ok ? undefined : JSON.stringify(decodedEnvelope.issues));
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({ ...envelope, result: { ...envelope.result, requestId: 'different-request' } }).ok, false);
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({ ...envelope, result: { contractVersion: 1, requestId: 'filter-envelope', kind: 'mutation-preview-result', ok: false, warnings: [], error: envelope.result.error } }).ok, false);
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({ ...envelope, transport: {} }).ok, false);
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({
		...envelope,
		client: { planRef: 'plan-ref' },
		recovery: { required: true, planRef: 'plan-ref', action: 'recover-same-plan', mutationMayHaveApplied: true },
	}).ok, false);
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({
		...envelope,
		result: {
			...envelope.result,
			error: { ...envelope.result.error, code: 'future-additive-error', retryable: false, action: 'do-not-retry' },
		},
	}).ok, true, 'unknown additive errors use the safe fallback policy');
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({
		...envelope,
		result: { ...envelope.result, error: { ...envelope.result.error, retryable: true } },
	}).ok, false, 'known errors must retain their published retry policy');
	assert.equal(decodeTaskWorkflowCliResultEnvelopeExtensionV1({
		...envelope,
		result: { ...envelope.result, error: { ...envelope.result.error, reason: 'x'.repeat(2_049) } },
	}).ok, false, 'structured error reasons retain the frozen 2048-byte limit');
	const malformedTaskResult = decodeTaskFilterQueryResultExtensionV1({
		contractVersion: 1,
		requestId: 'filter-envelope',
		kind: 'task-filter-query-result',
		ok: true,
		freshness: { source: 'live-runtime', coherence: 'verified', observedAt: '2026-08-09T00:00:00.000Z', settled: true },
		warnings: [],
		contextRevision: {
			index: { sessionId: 'session-a', ramGeneration: 1, durable: { status: 'missing' } },
			settingsFingerprint: 'a'.repeat(64),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: 'b'.repeat(64),
		},
		tasks: [{}],
		page: { actualCount: 1, returnedCount: 1, truncated: false, asOf: '2026-08-09T00:00:00.000Z' },
		provenance: [],
		truncations: [],
	});
	assert.equal(malformedTaskResult.ok, false);
	assert.equal(!malformedTaskResult.ok && malformedTaskResult.issues.some(item => item.path.startsWith('/tasks/0/identity')), true);
	assert.deepEqual(taskWorkflowTerminalAuditFieldsV1({
		contractVersion: 1,
		requestId: 'audit-applied',
		kind: 'mutation-result',
		status: 'applied',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
	}), { outcome: 'succeeded', errorCode: null });
	assert.deepEqual(taskWorkflowTerminalAuditFieldsV1({
		contractVersion: 1,
		requestId: 'audit-unknown',
		kind: 'mutation-result',
		status: 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		ambiguitySource: 'group-outcome',
		error: {
			contractVersion: 1,
			code: 'outcome-unknown',
			reason: 'test',
			retryable: false,
			action: 'recover-same-plan',
		},
	}), { outcome: 'outcome-unknown', errorCode: 'outcome-unknown' });
	assert.deepEqual(taskWorkflowTerminalAuditFieldsV1({
		contractVersion: 1,
		requestId: 'audit-failed',
		kind: 'mutation-result',
		status: 'failed',
		mutationMayHaveApplied: false,
		retryAllowed: false,
		groupResults: [],
		error: {
			contractVersion: 1,
			code: 'stale-context',
			reason: 'test',
			retryable: false,
			action: 'refresh-state',
		},
	}), { outcome: 'failed', errorCode: 'stale-context' });
	let previewCalls = 0;
	let applyCalls = 0;
	let dispatchAudits = 0;
	let terminalAudits = 0;
	let previewOutputMode: 'valid' | 'invalid-output' | 'wrong-request' = 'valid';
	let applyMode: 'invalid-output' | 'wrong-request' | 'throw' = 'invalid-output';
	const terminalAuditResults: import('../../../src/agent-runtime/extensions/task-workflows-v1').TaskWorkflowMutationResultV1[] = [];
	const gateway = new TaskWorkflowGatewayV1({
		isReady: () => true,
		nowEpochMs: () => Date.parse('2026-08-09T00:00:00.000Z'),
		preview: async request => {
			previewCalls += 1;
			if (previewOutputMode === 'invalid-output') {
				return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-preview-result', ok: true } as unknown as import('../../../src/agent-runtime/extensions/task-workflows-v1').TaskWorkflowPreviewResultV1;
			}
			return {
				contractVersion: 1,
				requestId: previewOutputMode === 'wrong-request' ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : request.requestId,
				kind: 'mutation-preview-result',
				ok: false,
				warnings: [],
				error: {
					contractVersion: 1,
					code: 'capability-unavailable',
					reason: 'test',
					retryable: false,
					action: 'wait-and-retry',
				},
			};
		},
		apply: async request => {
			applyCalls += 1;
			if (applyMode === 'throw') throw new Error(request.requestId);
			if (applyMode === 'wrong-request') {
				return {
					contractVersion: 1,
					requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
					kind: 'mutation-result',
					status: 'failed',
					mutationMayHaveApplied: false,
					retryAllowed: false,
					groupResults: [],
					error: {
						contractVersion: 1,
						code: 'stale-context',
						reason: 'wrong request',
						retryable: false,
						action: 'refresh-state',
					},
				};
			}
			return { contractVersion: 1, requestId: request.requestId, kind: 'mutation-result', status: 'applied' } as unknown as import('../../../src/agent-runtime/extensions/task-workflows-v1').TaskWorkflowMutationResultV1;
		},
		auditDispatched: async () => { dispatchAudits += 1; },
		auditCompleted: async (_request, result) => {
			terminalAudits += 1;
			terminalAuditResults.push(result);
		},
	});
	const preview: TaskWorkflowPreviewRequestV1 = {
		contractVersion: 1,
		requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		kind: 'mutation-preview',
		clientInstanceId: 'runtime-test',
		idempotencyKey: 'identity-preview-0001',
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
		authorization: { basis: 'user-explicit-request' },
	};
	const previewResult = await gateway.preview(preview);
	assert.equal(previewResult.ok, false);
	assert.equal(previewCalls, 1);
	const confused = await gateway.preview({ ...preview, capability: 'tasks.create.preview' });
	assert.equal(confused.ok, false);
	assert.equal(confused.error.code, 'invalid-request');
	assert.equal(previewCalls, 1, 'cross-kind request must not reach extension execution');
	previewOutputMode = 'invalid-output';
	const invalidPreviewResult = await gateway.preview(preview);
	assert.equal(invalidPreviewResult.ok, false);
	assert.equal(invalidPreviewResult.error.code, 'internal-error');
	assert.equal(decodeTaskWorkflowPreviewResultExtensionV1(invalidPreviewResult).ok, true);
	previewOutputMode = 'wrong-request';
	const wrongRequestPreviewResult = await gateway.preview(preview);
	assert.equal(wrongRequestPreviewResult.ok, false);
	assert.equal(wrongRequestPreviewResult.requestId, preview.requestId);
	assert.equal(decodeTaskWorkflowPreviewResultExtensionV1(wrongRequestPreviewResult).ok, true);

	const applyPlan: TaskWorkflowApplyRequestV1['plan'] = {
			contractVersion: 1,
			planId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			planHash: '',
			clientInstanceId: 'runtime-test',
			correlationId: preview.requestId,
			idempotencyKeyHash: sha256HexV1('identity-preview-0001'),
			receiptTargetDigest: '',
			capability: 'tasks.create.identity-placeholders' as const,
			mutationKind: 'task.create' as const,
			createdAt: '2026-08-08T23:57:30.000Z',
			expiresAt: '2026-08-09T00:02:30.000Z',
			targets: [{
				operonId: 'abc1234',
				locator: { representation: 'file', filePath: 'Tasks/Task.md' },
				targetDigest: 'd'.repeat(64),
			}],
			contextRevision: { ...revision(1).contextRevision, projectSerialSignature: '2'.repeat(64) },
			affectedResources: [{ resourceKind: 'task-source', resourceKey: 'Tasks/Task.md', revision: 'e'.repeat(64) }],
			atomicGroups: [{ groupId: 'task-source:Tasks/Task.md', order: 0, resources: [{ resourceKind: 'task-source', resourceKey: 'Tasks/Task.md' }] }],
			predictedEffects: [{ resourceKind: 'task-source', resourceKey: 'Tasks/Task.md', action: 'create', summary: 'Create task.' }],
			riskLevel: 'routine' as const,
			requiresConfirmation: false,
			requiredAcknowledgements: [],
			warnings: [],
			spec: preview.spec,
			createEffects: [{
				itemRef: 'item-1',
				operonId: 'abc1234',
				locator: { representation: 'file', filePath: 'Tasks/Task.md' },
				renderedTaskDigest: 'f'.repeat(64),
				plannedSourceDigest: '1'.repeat(64),
				expectedAbsence: true,
				templateIdentityAllocations: [{ occurrence: 0, operonId: 'def5678' }],
				resolvedRelatedOperonIds: [],
			}],
	};
	applyPlan.receiptTargetDigest = sha256HexV1(canonicalJsonV1(toJsonValueV1(applyPlan.targets)));
	const { planHash: _planHash, ...planMaterial } = applyPlan;
	applyPlan.planHash = sha256HexV1(canonicalJsonV1(toJsonValueV1(planMaterial)));
	const apply = {
		contractVersion: 1,
		requestId: preview.requestId,
		kind: 'mutation-apply',
		plan: applyPlan,
		authorization: { basis: 'user-explicit-request' },
		idempotencyKey: 'identity-preview-0001',
		acknowledgements: [],
	} satisfies TaskWorkflowApplyRequestV1;
	const decodedApply = decodeTaskWorkflowApplyRequestExtensionV1(apply);
	if (!decodedApply.ok) throw new Error(JSON.stringify(decodedApply.issues));
	assert.equal(decodeTaskWorkflowApplyRequestExtensionV1({ ...apply, idempotencyKey: 'different-key-0001' }).ok, false);
	assert.equal(decodeTaskWorkflowApplyRequestExtensionV1({ ...apply, plan: { ...apply.plan, expiresAt: 'not-a-date' } }).ok, false);
	assert.equal(decodeTaskWorkflowApplyRequestExtensionV1({ ...apply, acknowledgements: [{ code: 'not-required', planHash: apply.plan.planHash, targetDigest: apply.plan.targets[0].targetDigest, acknowledgedAt: apply.plan.createdAt }] }).ok, false);
	assert.equal(admitTaskWorkflowApplyRequestExtensionV1(apply, Date.parse(apply.plan.createdAt) - 1).ok, false);
	const applyResult = await gateway.apply(apply);
	assert.equal(applyCalls, 1);
	assert.equal(dispatchAudits, 1);
	assert.equal(terminalAudits, 1);
	assert.equal(applyResult.status, 'outcome-unknown');
	assert.equal(applyResult.mutationMayHaveApplied, true);
	assert.equal(decodeTaskWorkflowMutationResultExtensionV1(applyResult).ok, true);
	assert.equal(terminalAuditResults.at(-1)?.status, 'outcome-unknown');
	assert.equal(decodeTaskWorkflowMutationResultExtensionV1(terminalAuditResults.at(-1)).ok, true);
	applyMode = 'wrong-request';
	const wrongRequestApplyResult = await gateway.apply(apply);
	assert.equal(wrongRequestApplyResult.status, 'outcome-unknown');
	assert.equal(wrongRequestApplyResult.requestId, apply.requestId);
	assert.equal(decodeTaskWorkflowMutationResultExtensionV1(wrongRequestApplyResult).ok, true);
	assert.equal(terminalAuditResults.at(-1)?.requestId, apply.requestId);
	applyMode = 'throw';
	const thrownApplyResult = await gateway.apply(apply);
	assert.equal(thrownApplyResult.status, 'outcome-unknown');
	assert.equal(decodeTaskWorkflowMutationResultExtensionV1(thrownApplyResult).ok, true);
	assert.equal(applyCalls, 3);
	assert.equal(dispatchAudits, 3);
	assert.equal(terminalAudits, 3);
	assert.equal(terminalAuditResults.at(-1)?.status, 'outcome-unknown');
}

function testLifecycleAndAdmission(): void {
	const startupSettlementLifecycle = new RuntimeLifecycleCoordinatorV1();
	const releaseStartup = startupSettlementLifecycle.beginSettling();
	startupSettlementLifecycle.markCacheReady();
	assert.equal(startupSettlementLifecycle.getPhase(), 'settling');
	releaseStartup();
	assert.equal(startupSettlementLifecycle.getPhase(), 'cache-ready');

	const cachedStartupLifecycle = new RuntimeLifecycleCoordinatorV1();
	const releaseCachedStartup = cachedStartupLifecycle.beginSettling({
		preservesBestEffortCache: true,
	});
	cachedStartupLifecycle.markCacheReady();
	assert.equal(cachedStartupLifecycle.getPhase(), 'cache-ready');
	const cachedAdmission = cachedStartupLifecycle.admitRead('best-effort');
	assert.equal(cachedAdmission.ok, true);
	assert.equal(cachedAdmission.warnings[0]?.code, 'runtime-not-settled');
	const releaseBlockingSettlement = cachedStartupLifecycle.beginSettling();
	assert.equal(cachedStartupLifecycle.getPhase(), 'settling');
	releaseBlockingSettlement();
	assert.equal(cachedStartupLifecycle.getPhase(), 'cache-ready');
	releaseCachedStartup();

	const lifecycle = new RuntimeLifecycleCoordinatorV1();
	assert.equal(lifecycle.getPhase(), 'booting');
	assert.equal(lifecycle.admitRead('live-verified').ok, false);
	lifecycle.markCacheReady();
	assert.equal(lifecycle.getPhase(), 'cache-ready');
	assert.equal(lifecycle.getRetryAfterMs(), 500);
	assert.equal(lifecycle.admitRead('best-effort').ok, true);
	assert.equal(lifecycle.admitRead('live-verified').error?.code, 'live-settling');

	const releaseA = lifecycle.beginSettling();
	const releaseB = lifecycle.beginSettling();
	lifecycle.markReady();
	assert.equal(lifecycle.getPhase(), 'settling');
	releaseA();
	assert.equal(lifecycle.getPhase(), 'settling');
	releaseA();
	releaseB();
	assert.equal(lifecycle.getPhase(), 'ready');
	assert.equal(lifecycle.getRetryAfterMs(), undefined);
	assert.equal(lifecycle.admitWrite().ok, true);

	lifecycle.beginUnloading();
	assert.equal(lifecycle.getPhase(), 'unloading');
	assert.equal(lifecycle.getRetryAfterMs(), undefined);
	assert.equal(lifecycle.admitRead('best-effort').ok, false);
	assert.equal(lifecycle.admitWrite().ok, false);
	lifecycle.markReady();
	assert.equal(lifecycle.getPhase(), 'unloading');

	const failedStartup = new RuntimeLifecycleCoordinatorV1();
	failedStartup.recordError({
		contractVersion: 1,
		code: 'internal-error',
		reason: 'Synthetic startup freshness failure.',
		retryable: true,
		action: 'report-bug',
	});
	const releaseFailedStartup = failedStartup.beginSettling();
	failedStartup.markReady();
	releaseFailedStartup();
	assert.equal(failedStartup.getLastError()?.code, 'internal-error');
	assert.equal(failedStartup.admitRead('live-verified').ok, false);
	assert.equal(failedStartup.admitRead('best-effort').ok, false);
	assert.equal(failedStartup.admitWrite().ok, false);

	const componentErrors = new RuntimeLifecycleCoordinatorV1();
	componentErrors.recordError({
		contractVersion: 1,
		code: 'internal-error',
		reason: 'Component A failed.',
		retryable: true,
		action: 'report-bug',
	}, 'component-a');
	componentErrors.recordError({
		contractVersion: 1,
		code: 'live-settling',
		reason: 'Component B failed.',
		retryable: true,
		action: 'wait-and-retry',
	}, 'component-b');
	assert.equal(componentErrors.hasError('component-a'), true);
	componentErrors.clearError('component-a');
	assert.equal(componentErrors.hasError('component-a'), false);
	assert.equal(componentErrors.getLastError()?.reason, 'Component B failed.');

	const illegalTransition = new RuntimeLifecycleCoordinatorV1();
	illegalTransition.markReady();
	assert.equal(illegalTransition.getPhase(), 'booting');
	assert.equal(illegalTransition.getLastError()?.retryable, false);
}

async function testFrozenFacadeAndHealth(): Promise<void> {
	const lifecycle = new RuntimeLifecycleCoordinatorV1();
	let beforeHealthCalls = 0;
	const facade = createOperonAgentRuntimeFacadeV1(lifecycle, {
		beforeHealth: async () => {
			beforeHealthCalls += 1;
		},
		persistencePhase: () => 'idle',
		revision: () => undefined,
		transportDiagnostics: () => ({
			endpointKind: 'unix-domain-socket',
			securityBackend: 'posix-mode',
			persistentTransportAvailable: false,
			failureReason: 'persistent-read-server-starting',
		}),
	});
	assert.equal(Object.isFrozen(facade), true);
	assert.equal(Object.isFrozen(facade.system), true);
	assert.equal(Object.isFrozen(facade.catalog), true);
	assert.equal(facade.hasCapability('system.health'), true);
	assert.equal(facade.hasCapability('tasks.read'), false);
	assert.equal(facade.hasCapability('not-real'), false);
	const booting = await facade.system.health();
	assert.equal(beforeHealthCalls, 1);
	assert.equal(booting.lifecyclePhase, 'booting');
	assert.equal(booting.freshness.coherence, 'unverified');
	assert.equal(booting.retryAfterMs, 250);
	assert.equal(booting.admission.reads, false);
	assert.equal(
		facade.system.capabilities().find(item => item.id === 'tasks.read')?.availability,
		'contract-only',
	);
	const advertisedCapabilities = facade.system.capabilities();
	assert.deepEqual(
		advertisedCapabilities.filter(item => item.id.startsWith('tasks.adopt') || item.id.includes('identity-placeholders') || item.id === 'tasks.filter-query').map(item => item.id),
		['tasks.filter-query', 'tasks.create.identity-placeholders', 'tasks.adopt.preview', 'tasks.adopt.apply'],
	);
	assert.equal(decodeCapabilityAdvertisementsV1(advertisedCapabilities).ok, true, 'old V1 decoders must tolerate additive advertisement ids');
	const gatedCatalog = await facade.catalog.snapshot({
		contractVersion: 1,
		requestId: 'catalog-gated-001',
		kind: 'catalog',
		consistency: 'live-verified',
	});
	assert.equal(gatedCatalog.ok, false);
	assert.equal(gatedCatalog.ok ? undefined : gatedCatalog.error.code, 'capability-unavailable');
	const releaseStartup = lifecycle.beginSettling();
	lifecycle.markReady();
	releaseStartup();
	const ready = await facade.system.health();
	assert.equal(ready.lifecyclePhase, 'ready');
	assert.equal(ready.admission.reads, true);
	assert.equal(ready.admission.writes, true);
	assert.equal(ready.retryAfterMs, undefined);
	assert.deepEqual((await facade.system.diagnostics()).transport, {
		endpointKind: 'unix-domain-socket',
		securityBackend: 'posix-mode',
		persistentTransportAvailable: false,
		failureReason: 'persistent-read-server-starting',
	});
	lifecycle.recordError({
		contractVersion: 1,
		code: 'internal-error',
		reason: 'Synthetic fatal health state.',
		retryable: false,
		action: 'report-bug',
	});
	const failed = await facade.system.health();
	assert.equal(failed.ok, false);
	assert.equal(failed.freshness.coherence, 'unverified');
	assert.equal(failed.freshness.settled, false);
	lifecycle.clearError();
	const recovered = await facade.system.health();
	assert.equal(recovered.ok, true);
	assert.equal(recovered.freshness.coherence, 'verified');
	const beforeUnloadHealthCalls = beforeHealthCalls;
	lifecycle.beginUnloading();
	const unloading = await facade.system.health();
	assert.equal(unloading.lifecyclePhase, 'unloading');
	assert.equal(beforeHealthCalls, beforeUnloadHealthCalls);
	assert.equal(facade.hasCapability('system.health'), true);
	assert.equal(facade.hasCapability('system.capabilities'), false);

	const failingLifecycle = new RuntimeLifecycleCoordinatorV1();
	const failingFacade = createOperonAgentRuntimeFacadeV1(failingLifecycle, {
		beforeHealth: async () => {
			throw new Error('synthetic refresh failure');
		},
		persistencePhase: () => {
			throw new Error('synthetic persistence failure');
		},
		revision: async () => {
			throw new Error('synthetic revision failure');
		},
	});
	const degraded = await failingFacade.system.health();
	assert.equal(degraded.ok, false);
	assert.equal(degraded.lifecyclePhase, 'booting');
	assert.equal(degraded.v8PersistencePhase, 'recovery-required');

	const catalogLifecycle = readyLifecycle();
	let catalogCalls = 0;
	const availableCatalogFacade = createOperonAgentRuntimeFacadeV1(catalogLifecycle, {
		persistencePhase: () => 'idle',
		revision: () => revision(1),
		capabilityAvailability: capability => capability === 'catalog.read'
			? { availability: 'available' }
			: undefined,
		catalogSnapshot: async request => {
			catalogCalls += 1;
			return {
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'catalog-result',
				ok: false,
				freshness: {
					source: 'live-runtime',
					coherence: 'verified',
					observedAt: '2026-07-23T12:00:00.000Z',
					settled: true,
				},
				warnings: [],
				error: {
					contractVersion: 1,
					code: 'projection-too-broad',
					reason: 'Synthetic catalog provider result.',
					retryable: false,
					action: 'narrow-request',
				},
			};
		},
	});
	assert.equal(availableCatalogFacade.hasCapability('catalog.read'), true);
	const catalogResult = await availableCatalogFacade.catalog.snapshot({
		contractVersion: 1,
		requestId: 'catalog-available-001',
		kind: 'catalog',
		consistency: 'live-verified',
	});
	assert.equal(catalogCalls, 1);
	assert.equal(catalogResult.requestId, 'catalog-available-001');
	const invalidCatalog = await availableCatalogFacade.catalog.snapshot({
		contractVersion: 1,
		requestId: 'invalid request id',
		kind: 'catalog',
		consistency: 'live-verified',
	});
	assert.equal(invalidCatalog.ok, false);
	assert.equal(invalidCatalog.ok ? undefined : invalidCatalog.error.code, 'invalid-request');
	assert.match(invalidCatalog.requestId, /^catalog-[A-Za-z0-9-]+$/u);
	assert.equal(catalogCalls, 1);
}

async function testHealthRevisionIsolationAndPerformance(): Promise<void> {
	const lifecycle = readyLifecycle();
	const sharedRevision = revision(3);
	const facade = createOperonAgentRuntimeFacadeV1(lifecycle, {
		persistencePhase: () => 'rebasing',
		revision: () => sharedRevision,
	});
	const first = await facade.system.health();
	assert.equal(first.ok, true);
	assert.equal(first.v8PersistencePhase, 'rebasing');
	assert.equal(first.freshness.coherence, 'verified');
	assert.equal(first.contextRevision?.index.ramGeneration, 3);
	if (first.contextRevision) first.contextRevision.index.ramGeneration = 99;
	assert.equal(sharedRevision.contextRevision.index.ramGeneration, 3);

	const timings: number[] = [];
	for (let index = 0; index < 50; index++) {
		const startedAt = performance.now();
		await facade.system.health();
		timings.push(performance.now() - startedAt);
	}
	timings.sort((left, right) => left - right);
	assert.ok(timings[Math.floor(timings.length * 0.95)]! < 25);
}

function testSettingsFingerprintBoundary(): void {
	const settings = createSettingsFixture();
	const baseline = computeContextSettingsFingerprintV1(settings);
	const uiOnly = {
		...settings,
		inlineRowWidth: 999,
		language: 'tr',
		reminderNoticeDurationSeconds: 60,
		reminderSoundFilePath: 'Sounds/notice.mp3',
	} as OperonSettings;
	assert.equal(computeContextSettingsFingerprintV1(uiOnly), baseline);

	const descriptionChange = createSettingsFixture();
	descriptionChange.pipelines[0].description = 'Changed agent guidance';
	assert.notEqual(computeContextSettingsFingerprintV1(descriptionChange), baseline);

	const customDescriptionChange = createSettingsFixture();
	customDescriptionChange.keyMappings[0].description = 'Changed custom field meaning';
	assert.notEqual(computeContextSettingsFingerprintV1(customDescriptionChange), baseline);

	const creationChange = createSettingsFixture();
	creationChange.fileTasksFolder = 'Another Tasks';
	assert.notEqual(computeContextSettingsFingerprintV1(creationChange), baseline);

	const policyChange = createSettingsFixture();
	policyChange.trackerSplitSessionsAtMidnight = true;
	assert.notEqual(computeContextSettingsFingerprintV1(policyChange), baseline);

	const reorderedExclusions = createSettingsFixture();
	reorderedExclusions.excludedFolders = [...reorderedExclusions.excludedFolders].reverse();
	assert.equal(computeContextSettingsFingerprintV1(reorderedExclusions), baseline);
}

function testSealedIndexRevision(): void {
	const sealed = new SealedIndexRevisionV1('session-a', { status: 'missing' });
	sealed.updateRamGeneration(3);
	sealed.sealDurableRevision({
		status: 'available',
		snapshotId: 'a'.repeat(64),
		committedAt: '2026-07-23T10:00:00.000Z',
	});
	assert.deepEqual(sealed.snapshot(), {
		sessionId: 'session-a',
		ramGeneration: 3,
		durable: {
			status: 'available',
			snapshotId: 'a'.repeat(64),
			committedAt: '2026-07-23T10:00:00.000Z',
		},
	});
	assert.throws(() => sealed.updateRamGeneration(2), /cannot move backwards/u);
}

async function testSingleFlightBarrier(): Promise<void> {
	const barrier = new SingleFlightRuntimeBarrierV1();
	let calls = 0;
	let release: (() => void) | undefined;
	const operation = (): Promise<void> => {
		calls += 1;
		return new Promise(resolve => {
			release = resolve;
		});
	};
	const first = barrier.run(operation);
	const second = barrier.run(operation);
	assert.equal(calls, 1);
	release?.();
	await Promise.all([first, second]);
	await barrier.run(async () => {
		calls += 1;
	});
	assert.equal(calls, 2);
}

async function testRuntimeSettlementBarrier(): Promise<void> {
	const lifecycle = readyLifecycle();
	const barrier = new RuntimeSettlementBarrierV1(
		lifecycle,
		'synthetic-component',
		'Synthetic component could not settle.',
	);
	barrier.ensure();
	const failedRun = barrier.current();
	assert.ok(failedRun);
	assert.equal(lifecycle.getPhase(), 'settling');
	barrier.settleIfIdle(false);
	assert.equal(barrier.current(), failedRun);
	barrier.recordFailure(new Error('/Users/private-vault/secret'));
	barrier.settleIfIdle(true);
	await assert.rejects(failedRun);
	assert.equal(lifecycle.hasError('synthetic-component'), true);
	assert.equal(lifecycle.getLastError()?.reason, 'Synthetic component could not settle.');

	barrier.ensure();
	const recoveredRun = barrier.current();
	assert.ok(recoveredRun);
	barrier.settleIfIdle(true);
	await recoveredRun;
	assert.equal(lifecycle.hasError('synthetic-component'), false);
	assert.equal(lifecycle.getPhase(), 'ready');

	barrier.ensure();
	const cancelledRun = barrier.current();
	assert.ok(cancelledRun);
	barrier.cancel(new Error('cancelled'));
	await assert.rejects(cancelledRun);
	assert.equal(barrier.current(), null);
}

async function testCoherentReadRetry(): Promise<void> {
	const lifecycle = readyLifecycle();
	let generation = 1;
	let reads = 0;
	let settles = 0;
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => {
			settles += 1;
		},
		sampleRevision: () => revision(generation),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => {
			reads += 1;
			if (reads === 1) generation += 1;
			return `value-${reads}`;
		},
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.attempts, 2);
	assert.equal(result.value, 'value-2');
	assert.equal(result.revision.contextRevision.index.ramGeneration, 2);
	assert.equal(settles, 2);
}

async function testCoherentReadJoinsActiveSettlement(): Promise<void> {
	const lifecycle = readyLifecycle();
	const release = lifecycle.beginSettling();
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => {
			release();
		},
		sampleRevision: () => revision(1),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => 'settled',
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.value, 'settled');
}

async function testCoherentReadRecoversRetryableFreshness(): Promise<void> {
	const lifecycle = readyLifecycle();
	lifecycle.recordError({
		contractVersion: 1,
		code: 'internal-error',
		reason: 'Canonical settings were temporarily unreadable.',
		retryable: true,
		action: 'report-bug',
	}, 'settings-freshness');
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => {
			lifecycle.clearError('settings-freshness');
		},
		settle: async () => undefined,
		sampleRevision: () => revision(1),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => 'recovered-without-health',
	});
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.value, 'recovered-without-health');
}

async function testCoherentReadDetectsSettlementDuringProjection(): Promise<void> {
	const lifecycle = readyLifecycle();
	const settlement = { release: undefined as (() => void) | undefined };
	let reads = 0;
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => {
			settlement.release?.();
			settlement.release = undefined;
		},
		sampleRevision: () => revision(1),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => {
			reads += 1;
			if (reads === 1) settlement.release = lifecycle.beginSettling();
			return `projection-${reads}`;
		},
	});
	assert.equal(result.ok, true);
	if (result.ok) {
		assert.equal(result.value, 'projection-2');
		assert.equal(result.attempts, 2);
	}
}

async function testCoherentReadSecondDrift(): Promise<void> {
	const lifecycle = readyLifecycle();
	let generation = 1;
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => undefined,
		sampleRevision: () => revision(generation),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => {
			generation += 1;
			return 'discarded';
		},
	});
	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.equal(result.error.code, 'live-settling');
	assert.equal(result.attempts, 2);
	assert.equal(result.warnings[0]?.code, 'runtime-revision-drift');
}

async function testBestEffortDrift(): Promise<void> {
	const lifecycle = new RuntimeLifecycleCoordinatorV1();
	lifecycle.markCacheReady();
	let generation = 1;
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => {
			throw new Error('best effort must not settle');
		},
		sampleRevision: () => revision(generation),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'best-effort',
		read: async () => {
			generation += 1;
			return 'best-effort-value';
		},
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.attempts, 1);
	assert.equal(result.warnings.some(item => item.code === 'runtime-not-settled'), true);
	assert.equal(result.warnings.some(item => item.code === 'runtime-revision-drift'), true);
}

async function testBestEffortReadmitsAfterRefresh(): Promise<void> {
	const lifecycle = readyLifecycle();
	const settlement = { release: undefined as (() => void) | undefined };
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => {
			settlement.release = lifecycle.beginSettling();
		},
		settle: async () => undefined,
		sampleRevision: () => revision(1),
	});
	const result = await coordinator.execute({
		minimumConsistency: 'best-effort',
		read: async () => 'best-effort-after-refresh',
	});
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'live-settling');
	settlement.release?.();
}

async function testProjectionIsolationAndPrivateErrors(): Promise<void> {
	const lifecycle = readyLifecycle();
	const internal = { nested: { count: 1 } };
	const isolatedCoordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => undefined,
		sampleRevision: () => revision(1),
	});
	const isolated = await isolatedCoordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => internal,
	});
	assert.equal(isolated.ok, true);
	if (isolated.ok) isolated.value.nested.count = 99;
	assert.equal(internal.nested.count, 1);

	const failingCoordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => {
			throw new Error('/Users/private-vault/Task secret');
		},
		sampleRevision: () => revision(1),
	});
	const failed = await failingCoordinator.execute({
		minimumConsistency: 'live-verified',
		read: async () => 'never',
	});
	assert.equal(failed.ok, false);
	if (!failed.ok) {
		assert.equal(failed.error.reason, 'Runtime freshness coordination failed.');
		assert.equal(failed.error.retryable, false);
		assert.equal(failed.error.action, 'report-bug');
		assert.equal(JSON.stringify(failed).includes('/Users/private-vault'), false);
		assert.equal(JSON.stringify(failed).includes('Task secret'), false);
	}
}

function testSavedFilterQueryDigest(): void {
	const filter = {
		id: 'fs_runtime_digest',
		name: 'Runtime digest',
		rootGroup: { id: 'group', logic: 'all' as const, children: [] },
		sorts: [],
		subgroupBy: undefined,
		subgroupOrder: undefined,
		matchLogic: 'all' as const,
		conditions: [],
		groupBy: undefined,
		groupOrder: undefined,
	};
	const compact = {
		id: filter.id,
		name: filter.name,
		rootGroup: filter.rootGroup,
		sorts: filter.sorts,
		matchLogic: filter.matchLogic,
		conditions: filter.conditions,
	};
	assert.equal(savedFilterQueryDigestV1(filter, undefined), savedFilterQueryDigestV1(compact, undefined));
	assert.notEqual(
		savedFilterQueryDigestV1(filter, undefined),
		savedFilterQueryDigestV1(filter, { kind: 'folder-tree', path: 'Stage7' }),
	);
}

async function testDeadlineAndAbort(): Promise<void> {
	const lifecycle = readyLifecycle();
	const coordinator = new RuntimeCoherentReadCoordinatorV1(lifecycle, {
		...runtimeTimingPorts(),
		refreshSettings: async () => undefined,
		settle: async () => undefined,
		sampleRevision: () => revision(1),
	});
	const expired = await coordinator.execute({
		minimumConsistency: 'live-verified',
		deadlineAtMs: Date.now() - 1,
		read: async () => 'never',
	});
	assert.equal(expired.ok, false);
	if (!expired.ok) assert.equal(expired.error.code, 'live-settling');

	const controller = new AbortController();
	controller.abort();
	const aborted = await coordinator.execute({
		minimumConsistency: 'live-verified',
		signal: controller.signal,
		read: async () => 'never',
	});
	assert.equal(aborted.ok, false);
	if (!aborted.ok) assert.equal(aborted.error.code, 'invalid-request');

	const duringRead = new AbortController();
	const pending = coordinator.execute({
		minimumConsistency: 'live-verified',
		deadlineAtMs: Date.now() + 1_000,
		signal: duringRead.signal,
		read: async () => new Promise<string>(() => undefined),
	});
	duringRead.abort();
	const cancelled = await pending;
	assert.equal(cancelled.ok, false);
	if (!cancelled.ok) assert.equal(cancelled.error.code, 'invalid-request');
}

async function testSettingsFreshnessCoordinator(): Promise<void> {
	let fingerprint = 'a';
	let reloads = 0;
	const stable = new RuntimeSettingsFreshnessCoordinatorV1({
		statFingerprint: async () => fingerprint,
		reload: async () => {
			reloads += 1;
			return { ok: true };
		},
	});
	assert.deepEqual(await stable.prime(), { ok: true, changed: false, reloadCount: 0 });
	assert.deepEqual(await stable.refresh(), { ok: true, changed: false, reloadCount: 0 });
	fingerprint = 'b';
	assert.deepEqual(await stable.refresh(), { ok: true, changed: true, reloadCount: 1 });
	assert.equal(reloads, 1);

	let driftingFingerprint = 'a';
	let driftReloads = 0;
	const oneFollowUp = new RuntimeSettingsFreshnessCoordinatorV1({
		statFingerprint: async () => driftingFingerprint,
		reload: async () => {
			driftReloads += 1;
			if (driftReloads === 1) driftingFingerprint = 'c';
			return { ok: true };
		},
	});
	await oneFollowUp.prime();
	driftingFingerprint = 'b';
	assert.deepEqual(await oneFollowUp.refresh(), { ok: true, changed: true, reloadCount: 2 });
	assert.equal(driftReloads, 2);

	let unstableFingerprint = 'a';
	let unstableReloads = 0;
	const unstable = new RuntimeSettingsFreshnessCoordinatorV1({
		statFingerprint: async () => unstableFingerprint,
		reload: async () => {
			unstableReloads += 1;
			unstableFingerprint = unstableReloads === 1 ? 'c' : 'd';
			return { ok: true };
		},
	});
	await unstable.prime();
	unstableFingerprint = 'b';
	const failed = await unstable.refresh();
	assert.equal(failed.ok, false);
	if (!failed.ok) {
		assert.equal(failed.error.code, 'live-settling');
		assert.equal(JSON.stringify(failed).includes('/Users/'), false);
	}
	assert.equal(unstableReloads, 2);

	let sharedFingerprint = 'a';
	let sharedReloads = 0;
	let releaseReload: (() => void) | undefined;
	const shared = new RuntimeSettingsFreshnessCoordinatorV1({
		statFingerprint: async () => sharedFingerprint,
		reload: async () => {
			sharedReloads += 1;
			await new Promise<void>(resolve => {
				releaseReload = resolve;
			});
			return { ok: true };
		},
	});
	await shared.prime();
	sharedFingerprint = 'b';
	const callers = Array.from({ length: 30 }, () => shared.refresh());
	await Promise.resolve();
	assert.equal(sharedReloads, 1);
	releaseReload?.();
	const results = await Promise.all(callers);
	assert.equal(results.length, 30);
	assert.equal(results.every(result => (
		result.ok && result.changed && result.reloadCount === 1
	)), true);
}

function readyLifecycle(): RuntimeLifecycleCoordinatorV1 {
	const lifecycle = new RuntimeLifecycleCoordinatorV1();
	const releaseStartup = lifecycle.beginSettling();
	lifecycle.markReady();
	releaseStartup();
	return lifecycle;
}

function runtimeTimingPorts(): {
	now(): number;
	setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
	clearTimer(handle: unknown): void;
} {
	return {
		now: () => Date.now(),
		setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
	};
}

function revision(generation: number): RuntimeRevisionSnapshotV1 {
	return {
		contextRevision: {
			index: {
				sessionId: 'session-a',
				ramGeneration: generation,
				durable: { status: 'missing' },
			},
			settingsFingerprint: 'b'.repeat(64),
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 1,
			projectSerialGeneration: 0,
			projectSerialSignature: '',
		},
		packageRevision: 'package-a',
	};
}

function createSettingsFixture(): OperonSettings {
	return {
		defaultPipelineName: 'Project',
		defaultPriority: 'A',
		pipelines: [{
			id: 'pl_project',
			name: 'Project',
			description: 'Project guidance',
			statuses: [{
				id: 'st_open',
				label: 'Open',
				color: '#111111',
				isFinished: false,
				isCancelled: false,
				isScheduledTarget: true,
				isTrackingTarget: false,
				propertyMapping: null,
			}],
		}],
		priorities: [{
			id: 'pr_a',
			label: 'A',
			color: '#ff0000',
			description: 'Important',
		}],
		keyMappings: [{
			canonicalKey: 'Customer',
			visiblePropertyName: 'Customer',
			type: 'text',
			sync: 'auto',
			enabled: true,
			isSystem: false,
			description: 'Customer name',
		}],
		excludedFolders: ['Archive', 'Templates'],
		filterSets: [],
		projectSerialScopes: [],
		taskDescriptionRequired: true,
		assigneesRequired: false,
		fileTasksFolder: 'Tasks',
		inlineTaskSaveMode: 'daily-notes',
		inlineTaskUseDailyNote: true,
		inlineTaskTargetFile: '',
		inlineTaskHeading: 'Tasks',
		fileTaskParentInlineTargetMode: 'default',
		fileTaskParentFileTargetMode: 'same-folder',
		inlineToFileTaskMovePlainCheckboxes: true,
		inlineTaskParentInlineTargetMode: 'below-parent',
		inlineTaskParentFileTargetMode: 'inside-parent-file',
		inlineTaskParentFileHeadingKeyword: 'Tasks',
		inlineTaskDailyNoteAddStartDate: true,
		inlineTaskDailyNoteAddScheduledDate: false,
		calendarInlineTaskHeading: 'Tasks',
		autoParentFileTask: true,
		autoParentLinkedFileSubtasks: true,
		childTaskInheritanceFields: ['status', 'priority'],
		childTaskInheritanceStatusPipelineSource: 'parent',
		taskCreatorDefaultToFileTask: false,
		taskCreatorDefaultFileTemplateId: null,
		fileTaskTemplateFolder: 'Templates',
		createDailyNotesAsOperonTask: false,
		defaultEstimateMinutes: 30,
		autoCompleteParentWhenAllChildrenTerminal: true,
		cascadeCancelToDescendants: false,
		newOccurrencePosition: 'below',
		fileTaskAutoArchiveEnabled: true,
		fileTaskArchiveFolder: 'Archive',
		fileTaskArchiveDelaySeconds: 30,
		fileTaskArchiveOnlyFromFileTasksFolder: true,
		fileRepeatDestination: 'same-folder',
		fileRepeatCustomFolder: '',
		estimateAutoReallocation: false,
		trackerSplitSessionsAtMidnight: false,
		reminderCatchUpWindowMinutes: 60,
		reminderAutoPinDueTasks: false,
		pinnedDockAutoPin: false,
		pinnedDockAutoUnpinFinished: true,
		inlineRowWidth: 720,
		language: 'en',
		reminderNoticeDurationSeconds: 15,
		reminderSoundFilePath: '',
	} as unknown as OperonSettings;
}
