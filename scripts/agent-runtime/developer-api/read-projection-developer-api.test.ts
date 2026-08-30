import assert from 'node:assert/strict';
import test from 'node:test';
import {
	decodeContextPackV1,
	decodeEntityResolutionResultV1,
	decodeRelationshipResultV1,
	decodeRuntimeDiagnosticsV1,
	decodeTaskFinderResultV1,
	decodeTimerReadResultV1,
} from '../../../src/agent-runtime/contracts/v1/decode';
import {
	getOperonReadProjectionDeveloperApiV1,
	projectContextPackV1,
	projectEntityResolutionResultV1,
	projectRelationshipResultV1,
	projectRuntimeDiagnosticsV1,
	projectTaskFinderResultV1,
	projectTimerReadResultV1,
	type ReadProjectionDeveloperApiAccessRequestV1,
	type ReadProjectionDeveloperCapabilitySubsetV1,
} from '../../../src/agent-runtime/extensions/read-projection-v1';
import type { DeveloperApiGrantEvaluationV1 } from '../../../src/agent-runtime/developer-api/grants';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { RuntimeLifecyclePhaseV1 } from '../../../src/agent-runtime/contracts/v1/lifecycle';

const consumerPlugin = {
	manifest: { id: 'read-projection.test', name: 'Read projection test', version: '1.0.0' },
} as OperonDeveloperApiConsumerPluginV1;
const consumer = { id: 'read-projection.test', name: 'Read projection test', version: '1.0.0', instanceEpoch: 'instance-1' };
const runtimeCapabilities = [
	'system.diagnostics', 'tasks.finder', 'entities.resolve',
	'relationships.read', 'context.build', 'timers.read',
] as const;
const projectionCapabilities = [
	'read-projection.system.diagnostics', 'read-projection.tasks.finder',
	'read-projection.entities.resolve', 'read-projection.relationships.read',
	'read-projection.context.build', 'read-projection.timers.read',
] as const;
const allAccess: ReadProjectionDeveloperApiAccessRequestV1<ReadProjectionDeveloperCapabilitySubsetV1> = {
	contractVersion: 1,
	runtimeApi: { min: 1, max: 1 },
	requestedCapabilities: projectionCapabilities,
};
const stamp = '2026-08-30T00:00:00.000Z';
const hash = (character: string) => character.repeat(64);
const freshness = { source: 'live-runtime' as const, coherence: 'verified' as const, observedAt: stamp, settled: true };
const contextRevision = {
	index: { sessionId: 'index-session', ramGeneration: 1, durable: { status: 'available' as const, snapshotId: 'snapshot-1', committedAt: stamp } },
	settingsFingerprint: hash('a'), pinnedGeneration: 0, activeTrackerGeneration: 0,
	repeatSeriesRevision: 0, projectSerialGeneration: 0, projectSerialSignature: hash('b'),
};
const task = {
	identity: { operonId: 'abc1234', validity: 'canonical' as const, mutationAllowed: true },
	description: 'Projection test task', representation: 'inline' as const,
	locator: { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 0 }, checkbox: 'open' as const,
	dates: {}, datetimes: {},
	relationships: { childOperonIds: [], blockingOperonIds: [], blockedByOperonIds: [], relatedOperonIds: [] },
	recurrence: { repeating: false }, tracker: { active: false, sessionCount: 0 }, pinned: false,
	sourceRevision: { algorithm: 'sha256' as const, contentDigest: hash('c') }, contextRevision,
};
const relationshipSet = { explicit: [], derived: [], inferred: [] };
const contextPack = () => ({
	contractVersion: 1 as const, requestId: 'context-1', kind: 'context-pack' as const,
	purpose: 'analysis' as const, projection: 'project-analysis' as const, ok: true as const,
	execution: { ...freshness, nativeSentinel: 'must-not-cross' }, contextRevision,
	catalogRevision: hash('d'), asOf: stamp, entities: [task], relationships: relationshipSet,
	provenance: [], truncations: [], warnings: [],
});
const taskFinderResult = () => ({
	contractVersion: 1 as const, requestId: 'finder-1', kind: 'task-finder-result' as const, ok: true as const,
	freshness, warnings: [], contextRevision,
	rows: [{ kind: 'task' as const, task, score: 0.99 }],
	page: { actualCount: 1, returnedCount: 1, truncated: false, asOf: stamp }, provenance: [], truncations: [],
});
const entityResult = () => ({
	contractVersion: 1 as const, requestId: 'entity-1', kind: 'entity-resolution-result' as const, ok: true as const,
	freshness, warnings: [], contextRevision, resolution: 'resolved' as const,
	candidates: [{ identity: task.identity, description: task.description, locator: task.locator, confidence: 1, reasons: ['exact'], selector: { kind: 'operon-id' as const, operonId: 'abc1234' } }],
	selected: { identity: task.identity, description: task.description, locator: task.locator, confidence: 1, reasons: ['exact'], selector: { kind: 'operon-id' as const, operonId: 'abc1234' } },
});
const relationshipResult = () => ({
	contractVersion: 1 as const, requestId: 'relationship-1', kind: 'relationship-result' as const, ok: true as const,
	freshness, warnings: [], contextRevision, relationships: relationshipSet, tasks: [task], provenance: [], truncations: [],
});
const timerResult = () => ({
	contractVersion: 1 as const, requestId: 'timer-1', kind: 'timer-read-result' as const, ok: true as const,
	freshness, warnings: [], contextRevision,
	state: { active: null, transition: null },
});
const diagnostics = () => ({
	contractVersion: 1 as const, kind: 'runtime-diagnostics' as const,
	health: {
		apiVersion: 1 as const, contractVersion: 1 as const, ok: true as const,
		lifecyclePhase: 'ready' as const, v8PersistencePhase: 'idle' as const,
		compatibility: { contractVersion: 1 as const, runtimeApi: { min: 1, max: 1 } },
		capabilities: runtimeCapabilities.map(id => ({ id, availability: 'available' as const, stability: 'stable' as const })),
		freshness, admission: { reads: true, writes: true }, warnings: [],
	},
	capabilities: runtimeCapabilities.map(id => ({ id, availability: 'available' as const, stability: 'stable' as const })),
	warnings: [],
});

function runtime(): OperonAgentRuntimeCoreV1 {
	return {
		hasCapability: (capability: string) => runtimeCapabilities.includes(capability as typeof runtimeCapabilities[number]),
		system: { capabilities: () => runtimeCapabilities.map(id => ({ id, availability: 'available' as const, stability: 'stable' as const })), diagnostics: async () => diagnostics() },
		tasks: { find: async () => taskFinderResult() },
		entities: { resolve: async () => entityResult() },
		relationships: { get: async () => relationshipResult() },
		context: { build: async () => contextPack() },
		timers: { read: async () => timerResult() },
	} as unknown as OperonAgentRuntimeCoreV1;
}

interface AccessState {
	grant: DeveloperApiGrantEvaluationV1['state'];
	current: boolean;
	pending: number;
	coreActive?: boolean;
	lifecycle?: RuntimeLifecyclePhaseV1;
}

function open(core: OperonAgentRuntimeCoreV1, state: AccessState) {
	return getOperonReadProjectionDeveloperApiV1(core, consumerPlugin, allAccess, {
		isDesktopAvailable: () => true,
		isHostVersionSupported: () => true,
		lifecyclePhase: () => state.lifecycle ?? 'ready',
		isCoreActive: candidate => state.coreActive !== false && candidate === core,
		grantController: {
			verifyConsumer: candidate => candidate === consumerPlugin ? consumer : null,
			isConsumerCurrent: () => state.current,
			evaluate: () => ({
				state: state.grant, revision: 1,
				grantedCapabilities: state.grant === 'active' ? [...projectionCapabilities] : [],
				effectiveCapabilities: state.grant === 'active' ? [...projectionCapabilities] : [],
				pendingCapabilities: state.grant === 'pending' ? [...projectionCapabilities] : [],
				reason: state.grant === 'active'
					? 'active'
					: state.grant === 'revoked'
						? 'revoked'
						: 'capability-approval-required',
			}),
			recordPending: () => { state.pending += 1; },
		},
	});
}

test('read-projection context prototype rejects invalid packs and strips native additive fields', () => {
	const valid = contextPack();
	assert.equal(decodeContextPackV1(valid).ok, true);
	const projected = projectContextPackV1(valid);
	assert.ok(projected?.ok);
	assert.equal(projected?.requestId, 'context-1');
	assert.equal(projected?.catalogRevision, hash('d'));
	assert.equal(projected?.asOf, stamp);
	assert.equal('nativeSentinel' in (projected?.execution ?? {}), false);
	assert.equal(Object.isFrozen(projected), true);

	const invalidPlacement = { ...valid, placement: { mode: 'files', actualCount: 0, returnedCount: 0, truncated: false, files: [] } };
	assert.equal(decodeContextPackV1(invalidPlacement).ok, false);
	assert.equal(projectContextPackV1(invalidPlacement), null);
	for (const key of ['__proto__', 'constructor', 'prototype']) {
		const poisoned = structuredClone(valid) as Record<string, unknown>;
		Object.defineProperty(poisoned.relationships as Record<string, unknown>, key, {
			value: 'sentinel', enumerable: true, configurable: true,
		});
		assert.equal(decodeContextPackV1(poisoned).ok, false, `${key} must fail decoder admission`);
		assert.equal(projectContextPackV1(poisoned), null, `${key} must not cross the projector`);
	}
	(valid.entities[0] as { description: string }).description = 'source mutated after projection';
	assert.equal(projected?.ok && projected.entities[0]?.description, 'Projection test task');
});

test('read-projection access is exact, grant-bound, session-bound and version-gated', async () => {
	const core = runtime();
	const state = { grant: 'pending' as DeveloperApiGrantEvaluationV1['state'], current: true, pending: 0 };
	const unverifiedConsumer = getOperonReadProjectionDeveloperApiV1(core, consumerPlugin, allAccess, {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: candidate => candidate === core,
		grantController: { verifyConsumer: () => null, isConsumerCurrent: () => true, evaluate: () => ({ state: 'active', revision: 1, grantedCapabilities: [...projectionCapabilities], effectiveCapabilities: [...projectionCapabilities], pendingCapabilities: [], reason: 'active' }), recordPending: () => undefined },
	});
	assert.equal(unverifiedConsumer.ok, false);
	if (!unverifiedConsumer.ok) assert.equal(unverifiedConsumer.error.code, 'authority-insufficient');
	const baseOnlyGrant = getOperonReadProjectionDeveloperApiV1(core, consumerPlugin, allAccess, {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: candidate => candidate === core,
		grantController: {
			verifyConsumer: () => consumer,
			isConsumerCurrent: () => true,
			evaluate: () => ({
				state: 'pending', revision: 1,
				grantedCapabilities: [...runtimeCapabilities],
				effectiveCapabilities: [],
				pendingCapabilities: [...projectionCapabilities],
				reason: 'capability-approval-required',
			}),
			recordPending: () => undefined,
		},
	});
	assert.equal(baseOnlyGrant.ok, false, 'a frozen base API grant must not admit the projection accessor');
	if (!baseOnlyGrant.ok) assert.equal(baseOnlyGrant.error.code, 'authority-insufficient');
	const pending = open(core, state);
	assert.equal(pending.ok, false);
	assert.equal(state.pending, 1);
	state.grant = 'active';
	const invalidVersion = getOperonReadProjectionDeveloperApiV1(core, consumerPlugin, { ...allAccess, runtimeApi: { min: 2, max: 2 } }, {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: candidate => candidate === core,
		grantController: { verifyConsumer: () => consumer, isConsumerCurrent: () => true, evaluate: () => ({ state: 'active', revision: 1, grantedCapabilities: [...projectionCapabilities], effectiveCapabilities: [...projectionCapabilities], pendingCapabilities: [], reason: 'active' }), recordPending: () => undefined },
	});
	assert.equal(invalidVersion.ok, false);
	if (!invalidVersion.ok) assert.equal(invalidVersion.error.code, 'unsupported-version');
	const opened = open(core, state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	assert.deepEqual(Object.keys(opened.api.context), ['build']);
	assert.equal(opened.api.hasCapability('read-projection.context.build'), true);
	state.current = false;
	const stale = await opened.api.context.build({ contractVersion: 1, requestId: 'context-stale', kind: 'context', consistency: 'live-verified', purpose: 'analysis', projection: 'project-analysis', selector: { kind: 'operon-id', operonId: 'abc1234' } });
	assert.equal(stale.ok, false);
	if (!stale.ok) assert.equal(stale.error.code, 'authority-insufficient');
});

test('all six read projections are decoder-admitted, request-correlated, copied and frozen', async () => {
	const state = { grant: 'active' as DeveloperApiGrantEvaluationV1['state'], current: true, pending: 0 };
	const opened = open(runtime(), state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	const [system, finder, entity, relationship, context, timer] = await Promise.all([
		opened.api.system.diagnostics(),
		opened.api.tasks.find({ contractVersion: 1, requestId: 'finder-1', kind: 'task-finder', consistency: 'live-verified' }),
		opened.api.entities.resolve({ contractVersion: 1, requestId: 'entity-1', kind: 'entity-resolve', consistency: 'live-verified', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.relationships.get({ contractVersion: 1, requestId: 'relationship-1', kind: 'relationship', consistency: 'live-verified', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.context.build({ contractVersion: 1, requestId: 'context-1', kind: 'context', consistency: 'live-verified', purpose: 'analysis', projection: 'project-analysis', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.timers.read({ contractVersion: 1, requestId: 'timer-1', kind: 'timer-read', consistency: 'live-verified' }),
	]);
	assert.equal(decodeRuntimeDiagnosticsV1(system).ok, true);
	assert.equal(decodeTaskFinderResultV1(finder).ok, true);
	assert.equal(decodeEntityResolutionResultV1(entity).ok, true);
	assert.equal(decodeRelationshipResultV1(relationship).ok, true);
	assert.equal(decodeContextPackV1(context).ok, true);
	assert.equal(decodeTimerReadResultV1(timer).ok, true);
	assert.equal(Object.isFrozen(context), true);
	assert.equal(Object.isFrozen((context as { entities?: unknown[] }).entities?.[0]), true);
});

test('read-projection snapshots caller input and rejects a mismatched native request id', async () => {
	const state = { grant: 'active' as DeveloperApiGrantEvaluationV1['state'], current: true, pending: 0 };
	const core = runtime() as unknown as { tasks: { find: (request: unknown) => Promise<unknown> } } & OperonAgentRuntimeCoreV1;
	let observed: unknown;
	core.tasks.find = async request => {
		observed = request;
		return { ...taskFinderResult(), requestId: 'native-mismatch' };
	};
	const opened = open(core, state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	const request = { contractVersion: 1 as const, requestId: 'finder-original', kind: 'task-finder' as const, consistency: 'live-verified' as const };
	const result = await opened.api.tasks.find(request);
	assert.notEqual(observed, request);
	assert.equal(Object.isFrozen(observed), true);
	assert.equal(result.requestId, 'finder-original');
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, 'handler-unavailable');
});

test('all six reads close an in-flight result when the exact extension grant is revoked', async () => {
	const diagnosticsGate = deferred<ReturnType<typeof diagnostics>>();
	const finderGate = deferred<ReturnType<typeof taskFinderResult>>();
	const entityGate = deferred<ReturnType<typeof entityResult>>();
	const relationshipGate = deferred<ReturnType<typeof relationshipResult>>();
	const contextGate = deferred<ReturnType<typeof contextPack>>();
	const timerGate = deferred<ReturnType<typeof timerResult>>();
	const core = runtime() as unknown as {
		system: { diagnostics: () => Promise<ReturnType<typeof diagnostics>> };
		tasks: { find: () => Promise<ReturnType<typeof taskFinderResult>> };
		entities: { resolve: () => Promise<ReturnType<typeof entityResult>> };
		relationships: { get: () => Promise<ReturnType<typeof relationshipResult>> };
		context: { build: () => Promise<ReturnType<typeof contextPack>> };
		timers: { read: () => Promise<ReturnType<typeof timerResult>> };
	} & OperonAgentRuntimeCoreV1;
	core.system.diagnostics = () => diagnosticsGate.promise;
	core.tasks.find = () => finderGate.promise;
	core.entities.resolve = () => entityGate.promise;
	core.relationships.get = () => relationshipGate.promise;
	core.context.build = () => contextGate.promise;
	core.timers.read = () => timerGate.promise;
	const state: AccessState = { grant: 'active', current: true, pending: 0 };
	const opened = open(core, state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	const pending = [
		opened.api.system.diagnostics(),
		opened.api.tasks.find({ contractVersion: 1, requestId: 'finder-1', kind: 'task-finder', consistency: 'live-verified' }),
		opened.api.entities.resolve({ contractVersion: 1, requestId: 'entity-1', kind: 'entity-resolve', consistency: 'live-verified', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.relationships.get({ contractVersion: 1, requestId: 'relationship-1', kind: 'relationship', consistency: 'live-verified', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.context.build({ contractVersion: 1, requestId: 'context-1', kind: 'context', consistency: 'live-verified', purpose: 'analysis', projection: 'project-analysis', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.timers.read({ contractVersion: 1, requestId: 'timer-1', kind: 'timer-read', consistency: 'live-verified' }),
	] as const;
	state.grant = 'revoked';
	diagnosticsGate.resolve(diagnostics());
	finderGate.resolve(taskFinderResult());
	entityGate.resolve(entityResult());
	relationshipGate.resolve(relationshipResult());
	contextGate.resolve(contextPack());
	timerGate.resolve(timerResult());
	const [diagnosticResult, ...readResults] = await Promise.all(pending);
	assert.equal(diagnosticResult.health.ok, false);
	if (!diagnosticResult.health.ok) assert.equal(diagnosticResult.health.error.code, 'authority-insufficient');
	for (const result of readResults) {
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, 'authority-insufficient');
	}
});

test('all six rejected reads recheck the exact extension grant before classifying the failure', async () => {
	const diagnosticsGate = deferred<ReturnType<typeof diagnostics>>();
	const finderGate = deferred<ReturnType<typeof taskFinderResult>>();
	const entityGate = deferred<ReturnType<typeof entityResult>>();
	const relationshipGate = deferred<ReturnType<typeof relationshipResult>>();
	const contextGate = deferred<ReturnType<typeof contextPack>>();
	const timerGate = deferred<ReturnType<typeof timerResult>>();
	const core = runtime() as unknown as {
		system: { diagnostics: () => Promise<ReturnType<typeof diagnostics>> };
		tasks: { find: () => Promise<ReturnType<typeof taskFinderResult>> };
		entities: { resolve: () => Promise<ReturnType<typeof entityResult>> };
		relationships: { get: () => Promise<ReturnType<typeof relationshipResult>> };
		context: { build: () => Promise<ReturnType<typeof contextPack>> };
		timers: { read: () => Promise<ReturnType<typeof timerResult>> };
	} & OperonAgentRuntimeCoreV1;
	core.system.diagnostics = () => diagnosticsGate.promise;
	core.tasks.find = () => finderGate.promise;
	core.entities.resolve = () => entityGate.promise;
	core.relationships.get = () => relationshipGate.promise;
	core.context.build = () => contextGate.promise;
	core.timers.read = () => timerGate.promise;
	const state: AccessState = { grant: 'active', current: true, pending: 0 };
	const opened = open(core, state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	const pending = [
		opened.api.system.diagnostics(),
		opened.api.tasks.find({ contractVersion: 1, requestId: 'finder-rejection', kind: 'task-finder', consistency: 'live-verified' }),
		opened.api.entities.resolve({ contractVersion: 1, requestId: 'entity-rejection', kind: 'entity-resolve', consistency: 'live-verified', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.relationships.get({ contractVersion: 1, requestId: 'relationship-rejection', kind: 'relationship', consistency: 'live-verified', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.context.build({ contractVersion: 1, requestId: 'context-rejection', kind: 'context', consistency: 'live-verified', purpose: 'analysis', projection: 'project-analysis', selector: { kind: 'operon-id', operonId: 'abc1234' } }),
		opened.api.timers.read({ contractVersion: 1, requestId: 'timer-rejection', kind: 'timer-read', consistency: 'live-verified' }),
	] as const;
	state.grant = 'revoked';
	for (const gate of [diagnosticsGate, finderGate, entityGate, relationshipGate, contextGate, timerGate]) {
		gate.reject(new Error('native read rejected'));
	}
	const [diagnosticResult, ...readResults] = await Promise.all(pending);
	assert.equal(diagnosticResult.health.ok, false);
	if (!diagnosticResult.health.ok) assert.equal(diagnosticResult.health.error.code, 'authority-insufficient');
	for (const result of readResults) {
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, 'authority-insufficient');
	}
});

test('read-projection failures preserve invalid-request, authority, and handler fidelity', async () => {
	const state: AccessState = { grant: 'active', current: true, pending: 0 };
	const opened = open(runtime(), state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	const invalid = await opened.api.tasks.find({
		contractVersion: 1,
		requestId: 'invalid-finder',
		kind: 'task-finder',
		consistency: 'live-verified',
		unexpected: true,
	} as never);
	assert.equal(invalid.ok, false);
	if (!invalid.ok) assert.equal(invalid.error.code, 'invalid-request');
	state.current = false;
	const denied = await opened.api.tasks.find({ contractVersion: 1, requestId: 'denied-finder', kind: 'task-finder', consistency: 'live-verified' });
	assert.equal(denied.ok, false);
	if (!denied.ok) assert.equal(denied.error.code, 'authority-insufficient');
	state.current = true;
	const malformedCore = runtime();
	(malformedCore.tasks as unknown as { find: () => Promise<unknown> }).find = async () => ({ malformed: true });
	const malformedAccess = open(malformedCore, state);
	assert.equal(malformedAccess.ok, true);
	if (!malformedAccess.ok) return;
	const unavailable = await malformedAccess.api.tasks.find({ contractVersion: 1, requestId: 'unavailable-finder', kind: 'task-finder', consistency: 'live-verified' });
	assert.equal(unavailable.ok, false);
	if (!unavailable.ok) assert.equal(unavailable.error.code, 'handler-unavailable');
});

test('diagnostics rechecks consumer reload and reads recheck core and lifecycle after await', async () => {
	const diagnosticGate = deferred<ReturnType<typeof diagnostics>>();
	const finderGate = deferred<ReturnType<typeof taskFinderResult>>();
	const contextGate = deferred<ReturnType<typeof contextPack>>();
	const core = runtime() as unknown as {
		system: { diagnostics: () => Promise<ReturnType<typeof diagnostics>> };
		tasks: { find: () => Promise<ReturnType<typeof taskFinderResult>> };
		context: { build: () => Promise<ReturnType<typeof contextPack>> };
	} & OperonAgentRuntimeCoreV1;
	core.system.diagnostics = () => diagnosticGate.promise;
	core.tasks.find = () => finderGate.promise;
	core.context.build = () => contextGate.promise;
	const state: AccessState = { grant: 'active', current: true, pending: 0 };
	const opened = open(core, state);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;

	const diagnosticPromise = opened.api.system.diagnostics();
	state.current = false;
	diagnosticGate.resolve(diagnostics());
	assert.equal((await diagnosticPromise).health.ok, false, 'consumer reload must fence diagnostics');

	state.current = true;
	const finderPromise = opened.api.tasks.find({ contractVersion: 1, requestId: 'finder-1', kind: 'task-finder', consistency: 'live-verified' });
	state.coreActive = false;
	finderGate.resolve(taskFinderResult());
	assert.equal((await finderPromise).ok, false, 'core replacement must fence a finder result');

	state.coreActive = true;
	const contextPromise = opened.api.context.build({ contractVersion: 1, requestId: 'context-1', kind: 'context', consistency: 'live-verified', purpose: 'analysis', projection: 'project-analysis', selector: { kind: 'operon-id', operonId: 'abc1234' } });
	state.lifecycle = 'settling';
	contextGate.resolve(contextPack());
	assert.equal((await contextPromise).ok, false, 'lifecycle transition must fence a context result');
});

test('decoder/projector parity is fail-closed across all six result DTOs', () => {
	for (const [decode, project, valid] of [
		[decodeRuntimeDiagnosticsV1, projectRuntimeDiagnosticsV1, diagnostics()],
		[decodeTaskFinderResultV1, projectTaskFinderResultV1, taskFinderResult()],
		[decodeEntityResolutionResultV1, projectEntityResolutionResultV1, entityResult()],
		[decodeRelationshipResultV1, projectRelationshipResultV1, relationshipResult()],
		[decodeContextPackV1, projectContextPackV1, contextPack()],
		[decodeTimerReadResultV1, projectTimerReadResultV1, timerResult()],
	] as const) {
		assert.equal(decode(valid).ok, true);
		assert.ok(project(valid));
		const malformed = { ...valid, contractVersion: 999 };
		assert.equal(decode(malformed).ok, false);
		assert.equal(project(malformed), null);
	}
});

test('every read projection removes decoder-admitted additive freshness fields', () => {
	const samples: Array<{
		value: Record<string, unknown>;
		decode: (value: unknown) => { ok: boolean };
		project: (value: unknown) => object | null;
		freshnessAt: (value: Record<string, unknown>) => Record<string, unknown>;
	}> = [
		{ value: taskFinderResult(), decode: decodeTaskFinderResultV1, project: projectTaskFinderResultV1, freshnessAt: value => value.freshness as Record<string, unknown> },
		{ value: entityResult(), decode: decodeEntityResolutionResultV1, project: projectEntityResolutionResultV1, freshnessAt: value => value.freshness as Record<string, unknown> },
		{ value: relationshipResult(), decode: decodeRelationshipResultV1, project: projectRelationshipResultV1, freshnessAt: value => value.freshness as Record<string, unknown> },
		{ value: timerResult(), decode: decodeTimerReadResultV1, project: projectTimerReadResultV1, freshnessAt: value => value.freshness as Record<string, unknown> },
		{ value: diagnostics(), decode: decodeRuntimeDiagnosticsV1, project: projectRuntimeDiagnosticsV1, freshnessAt: value => (value.health as Record<string, unknown>).freshness as Record<string, unknown> },
	];
	for (const sample of samples) {
		sample.freshnessAt(sample.value).nativeSentinel = 'must-not-cross';
		assert.equal(sample.decode(sample.value).ok, true, 'response-open freshness is decoder-admitted');
		const projected = sample.project(sample.value);
		assert.ok(projected);
		assert.equal('nativeSentinel' in sample.freshnessAt(projected as Record<string, unknown>), false);
	}
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
