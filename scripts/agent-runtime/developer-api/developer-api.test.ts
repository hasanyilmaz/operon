import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CAPABILITY_REGISTRY_V1,
	type CapabilityAdvertisementV1,
	type CapabilityIdV1,
} from '../../../src/agent-runtime/contracts/v1/capabilities';
import type { RuntimeHealthV1, RuntimeLifecyclePhaseV1 } from '../../../src/agent-runtime/contracts/v1/lifecycle';
import { structuredErrorV1, type StructuredErrorV1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import {
	DeveloperMutationRecoveryStoreErrorV1,
	getOperonDeveloperApiV1,
	type DeveloperMutationRecoveryRecordV1,
	type DeveloperMutationRecoveryStoreV1,
} from '../../../src/agent-runtime/developer-api';
import { DeveloperMutationSecurityPolicyV1 } from '../../../src/agent-runtime/developer-api/security';
import type {
	DeveloperMutationPreviewInputV1,
} from '../../../src/agent-runtime/public/v1/developer-api';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';

const allCapabilities: CapabilityAdvertisementV1[] = CAPABILITY_REGISTRY_V1.map(definition => ({
	id: definition.id,
	availability: 'available',
	stability: 'stable',
}));
const mutationTarget = {
	operonId: '00000000-0000-4000-8000-000000000001',
	locator: {
		representation: 'inline' as const,
		filePath: 'Tasks.md',
		lineNumber: 1,
	},
};

function health(
	phase: RuntimeLifecyclePhaseV1 = 'ready',
	error?: StructuredErrorV1,
): RuntimeHealthV1 {
	return {
		apiVersion: 1,
		contractVersion: 1,
		lifecyclePhase: phase,
		v8PersistencePhase: 'idle',
		compatibility: { contractVersion: 1, runtimeApi: { min: 1, max: 1 } },
		capabilities: allCapabilities,
		freshness: {
			source: 'live-runtime',
			coherence: phase === 'ready' ? 'verified' : 'settling',
			observedAt: '2026-07-29T00:00:00.000Z',
			settled: phase === 'ready',
		},
		admission: {
			reads: phase === 'cache-ready' || phase === 'settling' || phase === 'ready',
			writes: phase === 'ready',
		},
		warnings: [],
		...(error ? { ok: false as const, error } : { ok: true as const }),
	};
}

function runtime(overrides: Partial<OperonAgentRuntimeCoreV1> = {}): OperonAgentRuntimeCoreV1 {
	const base: OperonAgentRuntimeCoreV1 = {
		apiVersion: 1,
		hasCapability: name => allCapabilities.some(capability => (
			capability.id === name && capability.availability === 'available'
		)),
		system: {
			health: async () => health(),
			capabilities: () => allCapabilities,
			diagnostics: async () => ({
				contractVersion: 1,
				kind: 'runtime-diagnostics',
				health: health(),
				capabilities: allCapabilities,
				warnings: [],
			}),
		},
		catalog: {
			snapshot: async request => ({
				contractVersion: 1,
				requestId: request?.requestId ?? 'catalog',
				kind: 'catalog-result',
				ok: false,
				freshness: {
					source: 'live-runtime',
					coherence: 'verified',
					observedAt: '2026-07-29T00:00:00.000Z',
					settled: true,
				},
				warnings: [],
				error: structuredErrorV1('internal-error', 'Test catalog stub.'),
			}),
		},
		entities: {
			resolve: async request => readFailure('entity-resolution-result', request.requestId),
		},
		tasks: {
			get: async request => readFailure('task-get-result', request.requestId),
			query: async request => readFailure('task-query-result', request.requestId),
			find: async request => readFailure('task-finder-result', request.requestId),
		},
		relationships: {
			get: async request => readFailure('relationship-result', request.requestId),
		},
		context: {
			build: async request => ({
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'context-pack',
				purpose: request.purpose,
				projection: request.projection,
				ok: false,
				warnings: [],
				error: structuredErrorV1('internal-error', 'Test context stub.'),
			}),
		},
		timers: {
			read: async request => ({
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'timer-read-result',
				ok: false,
				freshness: {
					source: 'live-runtime',
					coherence: 'verified',
					observedAt: '2026-07-29T00:00:00.000Z',
					settled: true,
				},
				warnings: [],
				error: structuredErrorV1('internal-error', 'Test timer stub.'),
			}),
		},
		mutations: {
			preview: async request => ({
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-preview-result',
				ok: false,
				warnings: [],
				error: structuredErrorV1('internal-error', 'Mutation core must not be called.'),
			}),
			apply: async request => ({
				contractVersion: 1,
				requestId: request.requestId,
				kind: 'mutation-result',
				status: 'failed',
				mutationMayHaveApplied: false,
				retryAllowed: false,
				groupResults: [],
				error: structuredErrorV1('internal-error', 'Mutation core must not be called.'),
			}),
		},
	};
	return { ...base, ...overrides };
}

function sealedPlan(
	input: Parameters<OperonAgentRuntimeCoreV1['mutations']['preview']>[0],
	riskLevel: 'routine' | 'elevated' | 'destructive' = 'routine',
) {
	return {
		contractVersion: 1 as const,
		planId: 'plan-id',
		planHash: 'plan-hash',
		clientInstanceId: input.clientInstanceId,
		correlationId: input.correlationId ?? input.requestId,
		idempotencyKeyHash: 'idempotency-hash',
		receiptTargetDigest: 'target-digest',
		capability: input.capability,
		mutationKind: input.mutationKind,
		createdAt: '2026-07-29T00:00:00.000Z',
		expiresAt: '2026-07-29T00:10:00.000Z',
		targets: [],
		contextRevision: {
			index: {
				sessionId: 'index',
				ramGeneration: 1,
				durable: {
					status: 'available' as const,
					snapshotId: 'snapshot',
					committedAt: '2026-07-29T00:00:00.000Z',
				},
			},
			settingsFingerprint: 'settings',
			pinnedGeneration: 1,
			activeTrackerGeneration: 1,
			repeatSeriesRevision: 1,
			projectSerialGeneration: 1,
			projectSerialSignature: 'serial',
		},
		affectedResources: [],
		atomicGroups: [],
		predictedEffects: [],
		riskLevel,
		requiresConfirmation: riskLevel !== 'routine',
		requiredAcknowledgements: [],
		warnings: [],
		spec: input.spec as never,
	};
}

function readFailure(kind: string, requestId: string) {
	return {
		contractVersion: 1 as const,
		requestId,
		kind,
		ok: false as const,
		freshness: {
			source: 'live-runtime' as const,
			coherence: 'verified' as const,
			observedAt: '2026-07-29T00:00:00.000Z',
			settled: true,
		},
		warnings: [],
		error: structuredErrorV1('internal-error', 'Test read stub.'),
	} as never;
}

function harness(options: {
	core?: OperonAgentRuntimeCoreV1 | null;
	desktop?: boolean;
	hostVersionSupported?: boolean;
	phase?: RuntimeLifecyclePhaseV1;
	error?: StructuredErrorV1;
	active?: { value: boolean };
	grantState?: { value: 'pending' | 'active' | 'suspended' | 'revoked'; revision: number };
	grantWriteQueued?: boolean;
	consumerCurrent?: { value: boolean };
	mutationSecurityPolicy?: DeveloperMutationSecurityPolicyV1;
	recoveryStore?: DeveloperMutationRecoveryStoreV1;
} = {}) {
	const active = options.active ?? { value: true };
	const phase = { value: options.phase ?? 'ready' };
	const core = options.core === undefined ? runtime() : options.core;
	const consumerPlugin = {
		manifest: { id: 'consumer.test', name: 'Consumer Test', version: '1.2.3' },
	};
	const grantState = options.grantState ?? { value: 'active' as const, revision: 1 };
	const consumerCurrent = options.consumerCurrent ?? { value: true };
	const grantController = {
		verifyConsumer: (candidate: unknown) => candidate === consumerPlugin
			? {
				id: consumerPlugin.manifest.id,
				name: consumerPlugin.manifest.name,
				version: consumerPlugin.manifest.version,
				instanceEpoch: 'consumer-instance-1',
			}
			: null,
		isConsumerCurrent: () => consumerCurrent.value,
		observeConsumerVersion: () => true,
		evaluate: (
			_candidate: unknown,
			requestedCapabilities: readonly CapabilityIdV1[],
		) => ({
			state: grantState.value,
			revision: grantState.revision,
			grantedCapabilities: grantState.value === 'active' ? requestedCapabilities : [],
			effectiveCapabilities: grantState.value === 'active' ? requestedCapabilities : [],
			pendingCapabilities: grantState.value === 'pending' ? requestedCapabilities : [],
			reason: grantState.value === 'active'
				? 'active' as const
				: grantState.value === 'pending'
					? 'capability-approval-required' as const
					: grantState.value === 'revoked'
						? 'revoked' as const
						: 'consumer-major-version-changed' as const,
		}),
		recordPending: () => undefined,
		hasPersistenceError: () => options.grantWriteQueued ?? false,
	};
	const accessAs = (consumer: typeof consumerPlugin, request: unknown) => getOperonDeveloperApiV1(core, consumer, request, {
		isDesktopAvailable: () => options.desktop ?? true,
		isHostVersionSupported: () => options.hostVersionSupported ?? true,
		lifecyclePhase: () => phase.value,
		retryAfterMs: () => phase.value === 'booting' ? 250 : undefined,
		lifecycleError: () => options.error,
		isCoreActive: candidate => active.value && candidate === core,
		grantController,
		...(options.mutationSecurityPolicy
			? { mutationSecurityPolicy: options.mutationSecurityPolicy }
			: {}),
		recoveryStore: options.recoveryStore ?? new MemoryDeveloperRecoveryStore(),
		createSessionId: () => 'developer-test-session',
	});
	const access = (request: unknown) => accessAs(consumerPlugin, request);
	return { access, accessAs, active, consumerCurrent, consumerPlugin, grantState, phase };
}

class MemoryDeveloperRecoveryStore implements DeveloperMutationRecoveryStoreV1 {
	private readonly records = new Map<string, DeveloperMutationRecoveryRecordV1>();

	rawState(recoveryRef: string): DeveloperMutationRecoveryRecordV1['state'] | undefined {
		return this.records.get(recoveryRef)?.state;
	}

	async putPrepared(record: DeveloperMutationRecoveryRecordV1): Promise<void> {
		this.records.set(record.recoveryRef, structuredClone(record));
	}

	async get(
		consumerId: string,
		recoveryRef: string,
	): Promise<DeveloperMutationRecoveryRecordV1 | undefined> {
		const record = this.records.get(recoveryRef);
		return record?.consumerId === consumerId
			&& (record.state === 'dispatched' || record.state === 'terminal')
			? structuredClone(record)
			: undefined;
	}

	async list(consumerId: string): Promise<readonly DeveloperMutationRecoveryRecordV1[]> {
		return [...this.records.values()]
			.filter(record => record.consumerId === consumerId && record.state === 'dispatched')
			.map(record => structuredClone(record));
	}

	async markDispatched(consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record?.consumerId === consumerId) {
			this.records.set(recoveryRef, { ...record, state: 'dispatched' });
		}
	}

	async markTerminal(consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record?.consumerId === consumerId) {
			this.records.set(recoveryRef, { ...record, state: 'terminal' });
		}
	}

	async markRefused(consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record?.consumerId === consumerId) {
			this.records.set(recoveryRef, { ...record, state: 'refused' });
		}
	}

	async delete(consumerId: string, recoveryRef: string): Promise<void> {
		const record = this.records.get(recoveryRef);
		if (record?.consumerId === consumerId) this.records.delete(recoveryRef);
	}
}

function request(capabilities: CapabilityIdV1[] = []) {
	return {
		contractVersion: 1 as const,
		runtimeApi: { min: 1, max: 1 },
		requestedCapabilities: capabilities,
	};
}

test('strictly rejects unknown, duplicate, malformed, and disjoint access requests', () => {
	const { access } = harness();
	const extra = access({ ...request(), consumerId: 'forbidden' });
	assert.equal(extra.ok, false);
	assert.equal(extra.ok ? undefined : extra.error.code, 'invalid-request');

	const duplicate = access(request(['tasks.read', 'tasks.read']));
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.ok ? undefined : duplicate.error.code, 'invalid-request');

	const unknown = access({
		...request(),
		requestedCapabilities: ['tasks.read', 'unknown.read'],
	});
	assert.equal(unknown.ok, false);
	assert.equal(unknown.ok ? undefined : unknown.error.code, 'invalid-request');

	const disjoint = access({
		...request(),
		runtimeApi: { min: 2, max: 3 },
	});
	assert.equal(disjoint.ok, false);
	assert.equal(disjoint.ok ? undefined : disjoint.error.code, 'unsupported-version');
});

test('requires the exact host-verified plugin instance and publishes derived identity', () => {
	const { accessAs, consumerPlugin } = harness();
	const copiedPlugin = {
		manifest: { ...consumerPlugin.manifest },
	};
	const forged = accessAs(copiedPlugin, request());
	assert.equal(forged.ok, false);
	assert.equal(forged.ok ? undefined : forged.error.code, 'authority-insufficient');
	assert.equal(
		forged.ok ? undefined : forged.error.details?.reasonCode,
		'developer-api-consumer-unverified',
	);

	const verified = accessAs(consumerPlugin, request());
	assert.equal(verified.ok, true);
	assert.equal(verified.status.consumer?.id, 'consumer.test');
	assert.equal(verified.status.consumer?.instanceEpoch, 'consumer-instance-1');
	assert.equal(verified.status.grant?.state, 'active');
});

test('fails exact-scope access closed while pending and revokes a live session synchronously', async () => {
	const grantState = { value: 'pending' as 'pending' | 'active' | 'suspended' | 'revoked', revision: 4 };
	const pendingHarness = harness({ grantState });
	const pending = pendingHarness.access(request(['tasks.read']));
	assert.equal(pending.ok, false);
	assert.equal(pending.ok ? undefined : pending.error.code, 'authority-insufficient');
	assert.equal(pending.status.grant?.state, 'pending');

	grantState.value = 'active';
	const active = pendingHarness.access(request(['tasks.read']));
	assert.equal(active.ok, true);
	if (!active.ok) return;
	assert.equal(active.status.authority, 'granted');
	assert.equal(active.status.grant?.effectiveCapabilities.includes('tasks.read'), true);

	grantState.value = 'revoked';
	grantState.revision += 1;
	assert.equal(active.api.channel.status().authority, 'revoked');
	assert.equal(active.api.hasCapability('tasks.read'), false);
	const refused = await active.api.tasks.get({
		contractVersion: 1,
		requestId: 'revoked-read',
		kind: 'task-get',
		consistency: 'best-effort',
		selector: { kind: 'operon-id', operonId: 'task' },
	});
	assert.equal(refused.ok, false);
	assert.equal(refused.ok ? undefined : refused.error.code, 'authority-insufficient');
});

test('keeps queued grant states coherent without granting Runtime authority', () => {
	const pending = harness({
		grantState: { value: 'pending', revision: 1 },
		grantWriteQueued: true,
	}).access(request(['tasks.read']));
	assert.equal(pending.ok, false);
	assert.equal(pending.ok ? undefined : pending.error.code, 'authority-insufficient');
	assert.equal(pending.ok ? undefined : pending.error.details?.grantState, 'pending');
	assert.equal(
		pending.ok ? undefined : pending.error.details?.reasonCode,
		'capability-approval-required',
	);
	assert.deepEqual(
		pending.ok ? undefined : pending.error.details?.pendingCapabilities,
		['tasks.read'],
	);
	assert.equal(pending.status.grant?.state, 'pending');
	assert.deepEqual(pending.status.grant?.effectiveCapabilities, []);
	assert.equal(pending.status.authority, 'revoked');
	assert.equal(pending.status.admission.reads, false);
	assert.equal(pending.status.admission.writes, false);

	const active = harness({
		grantState: { value: 'active', revision: 2 },
		grantWriteQueued: true,
	}).access(request(['tasks.read']));
	assert.equal(active.ok, false);
	assert.equal(active.ok ? undefined : active.error.code, 'authority-insufficient');
	assert.equal(active.ok ? undefined : active.error.details?.grantState, 'suspended');
	assert.equal(
		active.ok ? undefined : active.error.details?.reasonCode,
		'grant-persistence-unavailable',
	);
	assert.equal(active.status.grant?.state, 'suspended');
	assert.deepEqual(active.status.grant?.effectiveCapabilities, []);
	assert.equal(active.status.admission.reads, false);
	assert.equal(active.status.admission.writes, false);

	const revoked = harness({
		grantState: { value: 'revoked', revision: 3 },
		grantWriteQueued: true,
	}).access(request(['tasks.read']));
	assert.equal(revoked.ok, false);
	assert.equal(revoked.ok ? undefined : revoked.error.details?.grantState, 'revoked');
	assert.equal(revoked.ok ? undefined : revoked.error.details?.reasonCode, 'revoked');
	assert.equal(revoked.status.grant?.state, 'revoked');
});

test('fails access closed off desktop, without a core, while booting, and on terminal startup failure', () => {
	const mobile = harness({ desktop: false }).access(request());
	assert.equal(mobile.ok, false);
	assert.equal(mobile.ok ? undefined : mobile.error.code, 'unsupported-platform');
	assert.equal(mobile.status.reason, 'unsupported-platform');

	const oldDesktop = harness({ hostVersionSupported: false }).access(request());
	assert.equal(oldDesktop.ok, false);
	assert.equal(oldDesktop.ok ? undefined : oldDesktop.error.code, 'unsupported-platform');
	assert.equal(
		oldDesktop.ok ? undefined : oldDesktop.error.details?.reasonCode,
		'obsidian-version-unsupported',
	);
	assert.equal(oldDesktop.status.reason, 'unsupported-platform');

	const missing = harness({ core: null }).access(request());
	assert.equal(missing.ok, false);
	assert.equal(missing.ok ? undefined : missing.error.code, 'handler-unavailable');
	assert.equal(missing.ok ? undefined : missing.error.retryable, false);

	const booting = harness({ phase: 'booting' }).access(request());
	assert.equal(booting.ok, false);
	assert.equal(booting.status.reason, 'booting');

	const terminalError = structuredErrorV1('internal-error', 'Startup failed.', { retryable: false });
	const terminal = harness({ phase: 'settling', error: terminalError }).access(request());
	assert.equal(terminal.ok, false);
	assert.equal(terminal.status.reason, 'terminal-startup-failure');
});

test('preserves cache-ready, settling, ready, and unloading lifecycle admission', async () => {
	const cached = harness({ phase: 'cache-ready' }).access(request(['tasks.read']));
	assert.equal(cached.ok, true);
	assert.equal(cached.status.reason, 'cache-ready');
	assert.equal(cached.status.availability, 'degraded');
	assert.equal(cached.status.admission.reads, true);
	assert.equal(cached.status.admission.writes, false);

	const settling = harness({ phase: 'settling' }).access(request(['tasks.read']));
	assert.equal(settling.ok, true);
	assert.equal(settling.status.reason, 'settling');
	assert.equal(settling.status.availability, 'degraded');

	let taskCalls = 0;
	const core = runtime({
		tasks: {
			get: async input => {
				taskCalls += 1;
				return readFailure('task-get-result', input.requestId);
			},
			query: async input => readFailure('task-query-result', input.requestId),
			find: async input => readFailure('task-finder-result', input.requestId),
		},
	});
	const readyHarness = harness({ core });
	const ready = readyHarness.access(request(['tasks.read']));
	assert.equal(ready.ok, true);
	if (!ready.ok) return;
	assert.equal(ready.api.channel.status().reason, 'ready');
	readyHarness.phase.value = 'unloading';
	assert.equal(ready.api.channel.status().reason, 'unloading');
	assert.equal(ready.api.channel.status().authority, 'revoked');
	assert.equal(ready.api.channel.status().admission.reads, false);
	const refused = await ready.api.tasks.get({
		contractVersion: 1,
		requestId: 'unloading-read',
		kind: 'task-get',
		consistency: 'best-effort',
		selector: { kind: 'operon-id', operonId: 'task' },
	});
	assert.equal(refused.ok, false);
	assert.equal(refused.ok ? undefined : refused.error.code, 'capability-unavailable');
	assert.equal(taskCalls, 0);

	const unloadingAccess = harness({ phase: 'unloading' }).access(request());
	assert.equal(unloadingAccess.ok, false);
	assert.equal(unloadingAccess.status.reason, 'unloading');
});

test('revokes an existing session after a terminal lifecycle failure', async () => {
	let taskCalls = 0;
	const core = runtime({
		tasks: {
			get: async input => {
				taskCalls += 1;
				return readFailure('task-get-result', input.requestId);
			},
			query: async input => readFailure('task-query-result', input.requestId),
			find: async input => readFailure('task-finder-result', input.requestId),
		},
	});
	const mutableOptions: {
		core: OperonAgentRuntimeCoreV1;
		error?: StructuredErrorV1;
	} = { core };
	const session = harness(mutableOptions).access(request(['tasks.read']));
	assert.equal(session.ok, true);
	if (!session.ok) return;
	mutableOptions.error = structuredErrorV1('internal-error', 'Runtime became terminal.', {
		retryable: false,
	});
	const status = session.api.channel.status();
	assert.equal(status.reason, 'terminal-startup-failure');
	assert.equal(status.availability, 'unavailable');
	assert.equal(status.authority, 'revoked');
	assert.equal(status.admission.reads, false);
	assert.equal(session.api.hasCapability('tasks.read'), false);
	assert.equal(
		status.capabilities.find(capability => capability.id === 'tasks.read')?.availability,
		'unavailable',
	);
	const refused = await session.api.tasks.get({
		contractVersion: 1,
		requestId: 'terminal-read',
		kind: 'task-get',
		consistency: 'best-effort',
		selector: { kind: 'operon-id', operonId: 'task' },
	});
	assert.equal(refused.ok, false);
	assert.equal(refused.ok ? undefined : refused.error.code, 'capability-unavailable');
	assert.equal(taskCalls, 0);
});

test('invalidates every existing session surface when the consumer unloads or is replaced', async () => {
	let healthCalls = 0;
	let capabilityCalls = 0;
	let taskCalls = 0;
	const base = runtime();
	const core = runtime({
		system: {
			health: async () => {
				healthCalls += 1;
				return health();
			},
			capabilities: () => {
				capabilityCalls += 1;
				return allCapabilities;
			},
			diagnostics: base.system.diagnostics,
		},
		tasks: {
			get: async input => {
				taskCalls += 1;
				return readFailure('task-get-result', input.requestId);
			},
			query: async input => readFailure('task-query-result', input.requestId),
			find: async input => readFailure('task-finder-result', input.requestId),
		},
	});
	const current = { value: true };
	const active = harness({ core, consumerCurrent: current }).access(request(['tasks.read']));
	assert.equal(active.ok, true);
	if (!active.ok) return;
	const capabilitiesBeforeReplacement = capabilityCalls;
	current.value = false;

	const status = active.api.channel.status();
	assert.equal(status.authority, 'revoked');
	assert.equal(status.admission.reads, false);
	assert.equal(status.capabilities.length, 0);
	assert.equal(active.api.hasCapability('tasks.read'), false);
	assert.equal(active.api.system.capabilities().length, 0);
	const staleHealth = await active.api.system.health();
	assert.equal(staleHealth.ok, false);
	assert.equal(staleHealth.ok ? undefined : staleHealth.error.code, 'authority-insufficient');
	const staleTask = await active.api.tasks.get({
		contractVersion: 1,
		requestId: 'replaced-consumer',
		kind: 'task-get',
		consistency: 'best-effort',
		selector: { kind: 'operon-id', operonId: 'task' },
	});
	assert.equal(staleTask.ok, false);
	assert.equal(taskCalls, 0);
	assert.equal(healthCalls, 0);
	assert.equal(capabilityCalls, capabilitiesBeforeReplacement);
});

test('returns a frozen exact-grant session and does not broaden requested capabilities', async () => {
	const result = harness().access(request(['tasks.read', 'system.diagnostics']));
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.api.contractVersion, 1);
	assert.equal(result.api.runtimeApiVersion, 1);
	assert.equal(result.api.hasCapability('tasks.read'), true);
	assert.equal(result.api.hasCapability('tasks.query'), false);
	assert.equal(result.status.authority, 'granted');
	assert.equal(result.status.admission.writes, false);
	assert.ok(result.status.capabilities.every(capability => !capability.id.endsWith('.apply')));
	assert.ok(result.status.capabilities.every(capability => !capability.id.endsWith('.preview')));
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.api), true);
	assert.equal(Object.isFrozen(result.api.tasks), true);

	const projectedHealth = await result.api.system.health();
	assert.equal(projectedHealth.admission.writes, false);
	assert.equal(
		projectedHealth.capabilities.find(capability => capability.id === 'tasks.query')?.availability,
		undefined,
	);
	assert.ok(projectedHealth.capabilities.every(capability => !capability.id.endsWith('.apply')));

	const projectedDiagnostics = await result.api.system.diagnostics();
	assert.equal(projectedDiagnostics.health.admission.writes, false);
	assert.equal(
		projectedDiagnostics.capabilities.find(capability => capability.id === 'tasks.query')?.availability,
		undefined,
	);
});

test('gates diagnostics outside the baseline discovery surface', async () => {
	let diagnosticCalls = 0;
	const base = runtime();
	const core = runtime({
		system: {
			...base.system,
			diagnostics: async () => {
				diagnosticCalls += 1;
				return base.system.diagnostics();
			},
		},
	});
	const result = harness({ core }).access(request());
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const diagnostics = await result.api.system.diagnostics();
	assert.equal(diagnostics.health.ok, false);
	assert.equal(diagnostics.health.ok ? undefined : diagnostics.health.error.code, 'authority-insufficient');
	assert.equal(diagnosticCalls, 0);
});

test('snapshots inputs before core use and deep-clones and freezes outputs', async () => {
	let capturedRequest: unknown;
	const taskResult = {
		contractVersion: 1 as const,
		requestId: 'read-1',
		kind: 'task-get-result' as const,
		ok: false as const,
		freshness: {
			source: 'live-runtime' as const,
			coherence: 'verified' as const,
			observedAt: '2026-07-29T00:00:00.000Z',
			settled: true,
		},
		warnings: [{ code: 'nested', message: 'original' }],
		error: structuredErrorV1('entity-not-found', 'Not found.'),
	};
	const core = runtime({
		tasks: {
			get: async input => {
				capturedRequest = input;
				await Promise.resolve();
				return taskResult;
			},
			query: async input => readFailure('task-query-result', input.requestId),
			find: async input => readFailure('task-finder-result', input.requestId),
		},
	});
	const result = harness({ core }).access(request(['tasks.read']));
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const input = {
		contractVersion: 1 as const,
		requestId: 'read-1',
		kind: 'task-get' as const,
		consistency: 'best-effort' as const,
		selector: { kind: 'operon-id' as const, operonId: 'task-before' },
	};
	const pending = result.api.tasks.get(input);
	input.selector.operonId = 'task-after';
	const output = await pending;
	taskResult.warnings[0].message = 'mutated-after-return';
	assert.equal((capturedRequest as typeof input).selector.operonId, 'task-before');
	assert.equal(Object.isFrozen(capturedRequest), true);
	assert.equal(Object.isFrozen((capturedRequest as typeof input).selector), true);
	assert.equal(output.warnings[0].message, 'original');
	assert.equal(Object.isFrozen(output), true);
	assert.equal(Object.isFrozen(output.warnings), true);
	assert.equal(Object.isFrozen(output.warnings[0]), true);
});

test('distinguishes unrequested authority from a stale requested capability', async () => {
	let taskCalls = 0;
	const active = { value: true };
	const core = runtime({
		tasks: {
			get: async input => {
				taskCalls += 1;
				return readFailure('task-get-result', input.requestId);
			},
			query: async input => readFailure('task-query-result', input.requestId),
			find: async input => readFailure('task-finder-result', input.requestId),
		},
	});
	const unrequested = harness({ core, active }).access(request());
	assert.equal(unrequested.ok, true);
	if (!unrequested.ok) return;
	const input = {
		contractVersion: 1 as const,
		requestId: 'read-2',
		kind: 'task-get' as const,
		consistency: 'best-effort' as const,
		selector: { kind: 'operon-id' as const, operonId: 'task' },
	};
	const refused = await unrequested.api.tasks.get(input);
	assert.equal(refused.ok, false);
	assert.equal(refused.ok ? undefined : refused.error.code, 'authority-insufficient');
	assert.equal(taskCalls, 0);

	const requested = harness({ core, active }).access(request(['tasks.read']));
	assert.equal(requested.ok, true);
	if (!requested.ok) return;
	active.value = false;
	const stale = await requested.api.tasks.get(input);
	assert.equal(stale.ok, false);
	assert.equal(stale.ok ? undefined : stale.error.code, 'capability-unavailable');
	assert.equal(requested.api.channel.status().authority, 'revoked');
	assert.equal(taskCalls, 0);
});

test('malformed non-cloneable read input returns invalid-request without a core call', async () => {
	let taskCalls = 0;
	const core = runtime({
		tasks: {
			get: async input => {
				taskCalls += 1;
				return readFailure('task-get-result', input.requestId);
			},
			query: async input => readFailure('task-query-result', input.requestId),
			find: async input => readFailure('task-finder-result', input.requestId),
		},
	});
	const result = harness({ core }).access(request(['tasks.read']));
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const malformed = {
		contractVersion: 1,
		requestId: 'malformed',
		kind: 'task-get',
		consistency: 'best-effort',
		selector: { operonId: 'task' },
		forbidden: () => undefined,
	};
	const response = await result.api.tasks.get(malformed as never);
	assert.equal(response.ok, false);
	assert.equal(response.ok ? undefined : response.error.code, 'invalid-request');
	assert.equal(taskCalls, 0);
});

test('mutation methods reject ungranted capabilities and forged plan handles without side effects', async () => {
	let previewCalls = 0;
	let applyCalls = 0;
	const core = runtime({
		mutations: {
			preview: async request => {
				previewCalls += 1;
				return {
					contractVersion: 1,
					requestId: request.requestId,
					kind: 'mutation-preview-result',
					ok: false,
					warnings: [],
					error: structuredErrorV1('internal-error', 'Must not run.'),
				};
			},
			apply: async request => {
				applyCalls += 1;
				return {
					contractVersion: 1,
					requestId: request.requestId,
					kind: 'mutation-result',
					status: 'failed',
					mutationMayHaveApplied: false,
					retryAllowed: false,
					groupResults: [],
					error: structuredErrorV1('internal-error', 'Must not run.'),
				};
			},
		},
	});
	const result = harness({ core }).access(request());
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const preview = await result.api.mutations.preview({
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		target: mutationTarget,
		spec: {
			kind: 'task.delete',
			target: { operonId: 'task' },
		} as never,
	});
	assert.equal(preview.ok, false);
	assert.equal(preview.ok ? undefined : preview.error.code, 'authority-insufficient');

	const forbidden = await result.api.mutations.preview({
		capability: 'tasks.delete.preview',
		mutationKind: 'task.delete',
		spec: {} as never,
		clientInstanceId: 'forged',
		authorization: { granted: true },
	} as never);
	assert.equal(forbidden.ok, false);
	assert.equal(forbidden.ok ? undefined : forbidden.error.code, 'invalid-request');

	const fakePlan = {
		contractVersion: 1,
		kind: 'developer-mutation-plan',
		planDigest: 'forged',
	};
	const apply = await result.api.mutations.apply({ plan: fakePlan } as never);
	const recover = await result.api.mutations.recover({ plan: fakePlan } as never);
	assert.equal(apply.error?.code, 'invalid-request');
	assert.equal(recover.error?.code, 'invalid-request');
	assert.equal(apply.mutationMayHaveApplied, false);
	assert.equal(recover.mutationMayHaveApplied, false);
	assert.equal(previewCalls, 0);
	assert.equal(applyCalls, 0);
});

test('mutation inputs reject caller injection of every host-owned security field', async () => {
	const result = harness().access(request());
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const fakePlan = {
		contractVersion: 1,
		kind: 'developer-mutation-plan',
		planDigest: 'forged',
	};
	const injections = [
		['consent', { approved: true }],
		['acknowledgements', []],
		['correlationId', 'caller-correlation'],
		['idempotencyKey', 'caller-idempotency'],
	] as const;
	for (const [field, value] of injections) {
		const preview = await result.api.mutations.preview({
			capability: 'tasks.update.preview',
			mutationKind: 'task.update',
			spec: { operation: 'update', changes: [] },
			[field]: value,
		} as never);
		assert.equal(preview.ok, false, `preview must reject ${field}`);
		assert.equal(preview.ok ? undefined : preview.error.code, 'invalid-request');

		const apply = await result.api.mutations.apply({
			plan: fakePlan,
			[field]: value,
		} as never);
		assert.equal(apply.error?.code, 'invalid-request', `apply must reject ${field}`);

		const recover = await result.api.mutations.recover({
			plan: fakePlan,
			[field]: value,
		} as never);
		assert.equal(recover.error?.code, 'invalid-request', `recover must reject ${field}`);
	}
});

test('mutation preview and apply use an opaque session handle and host-minted authority', async () => {
	let previewRequest: Parameters<OperonAgentRuntimeCoreV1['mutations']['preview']>[0] | undefined;
	let applyRequest: Parameters<OperonAgentRuntimeCoreV1['mutations']['apply']>[0] | undefined;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date('2026-07-29T00:01:00.000Z'),
	});
	const core = runtime({
		mutations: {
			preview: async input => {
				previewRequest = input;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-preview-result',
					ok: true,
					warnings: [],
					plan: sealedPlan(input),
				};
			},
			apply: async input => {
				applyRequest = input;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'failed',
					mutationMayHaveApplied: false,
					retryAllowed: false,
					groupResults: [],
					error: structuredErrorV1('internal-error', 'Expected test failure.'),
				};
			},
		},
	});
	const access = harness({ core, mutationSecurityPolicy: policy }).access(request([
		'tasks.update.preview',
		'tasks.update.apply',
	]));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	assert.equal(previewRequest?.authorization.basis, 'user-explicit-request');
	assert.match(previewRequest?.clientInstanceId ?? '', /^developer-api:consumer\.test:/u);
	assert.notEqual(previewRequest?.idempotencyKey, '');

	const applied = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(applied.status, 'failed');
	assert.equal(applyRequest?.authorization.basis, 'user-standing-instruction');
	assert.deepEqual(applyRequest?.acknowledgements, []);
	assert.equal(applyRequest?.plan.planHash, 'plan-hash');
	const repeatedApply = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(repeatedApply.error?.code, 'invalid-request');
	assert.equal(repeatedApply.error?.details?.planState, 'terminal');
	const preDispatchRecovery = await access.api.mutations.recover({ plan: preview.plan });
	assert.equal(preDispatchRecovery.error?.code, 'invalid-request');

	const copiedHandle = structuredClone(preview.plan);
	const forged = await access.api.mutations.apply({ plan: copiedHandle });
	assert.equal(forged.error?.code, 'invalid-request');
});

test('plan state rejects concurrent apply and permits recovery only after uncertainty', async () => {
	let applyCalls = 0;
	let releaseFirstApply: ((value: Awaited<ReturnType<
		OperonAgentRuntimeCoreV1['mutations']['apply']
	>>) => void) | undefined;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: input => {
				applyCalls += 1;
				if (applyCalls === 1) {
					return new Promise(resolve => {
						releaseFirstApply = resolve;
					});
				}
				return Promise.resolve({
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'failed',
					mutationMayHaveApplied: false,
					retryAllowed: false,
					groupResults: [],
					error: structuredErrorV1('internal-error', 'Recovery reached a terminal failure.'),
				});
			},
		},
	});
	const access = harness({ core, mutationSecurityPolicy: policy }).access(request([
		'tasks.update.preview',
		'tasks.update.apply',
	]));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;

	const firstApply = access.api.mutations.apply({ plan: preview.plan });
	for (let index = 0; index < 4 && applyCalls === 0; index++) await Promise.resolve();
	const concurrentApply = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(concurrentApply.error?.code, 'invalid-request');
	assert.equal(concurrentApply.error?.details?.planState, 'applying');
	assert.equal(applyCalls, 1);

	releaseFirstApply?.({
		contractVersion: 1,
		requestId: 'uncertain',
		kind: 'mutation-result',
		status: 'outcome-unknown',
		mutationMayHaveApplied: true,
		retryAllowed: false,
		groupResults: [],
		error: structuredErrorV1('outcome-unknown', 'Uncertain.', {
			action: 'recover-same-plan',
		}),
	});
	const uncertain = await firstApply;
	assert.equal(uncertain.status, 'outcome-unknown');
	assert.equal(uncertain.recovery?.required, true);

	const applyAfterUncertain = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(applyAfterUncertain.error?.code, 'invalid-request');
	assert.equal(applyAfterUncertain.error?.details?.planState, 'recovery-required');

	const recovery = await access.api.mutations.recover({ plan: preview.plan });
	assert.equal(recovery.status, 'failed');
	assert.equal(applyCalls, 2);
	const repeatedRecovery = await access.api.mutations.recover({ plan: preview.plan });
	assert.equal(repeatedRecovery.error?.code, 'invalid-request');
	assert.equal(repeatedRecovery.error?.details?.planState, 'terminal');
});

test('restart-safe recovery is consumer-bound, redacted, and survives grant revocation', async () => {
	let applyCalls = 0;
	const recoveryStore = new MemoryDeveloperRecoveryStore();
	const grantState = {
		value: 'active' as 'pending' | 'active' | 'suspended' | 'revoked',
		revision: 3,
	};
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date('2026-07-29T00:01:00.000Z'),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				if (applyCalls === 1) {
					return {
						contractVersion: 1,
						requestId: input.requestId,
						kind: 'mutation-result',
						status: 'outcome-unknown',
						mutationMayHaveApplied: true,
						retryAllowed: false,
						groupResults: [],
						error: structuredErrorV1('outcome-unknown', 'Result delivery was lost.', {
							action: 'recover-same-plan',
						}),
					};
				}
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'already-applied',
					mutationMayHaveApplied: true,
					retryAllowed: false,
					groupResults: [],
					receipt: {
						contractVersion: 1,
						vaultIdentityHash: 'vault',
						clientInstanceId: input.plan.clientInstanceId,
						idempotencyKeyHash: input.plan.idempotencyKeyHash,
						planHash: input.plan.planHash,
						mutationKind: input.plan.mutationKind,
						targetDigest: input.plan.receiptTargetDigest,
						terminalOutcome: 'already-applied',
						effectiveAt: '2026-07-29T00:01:00.000Z',
						completedAt: '2026-07-29T00:01:01.000Z',
						expiresAt: input.plan.expiresAt,
					},
					postflight: {
						status: 'receipt-replay',
						observedAt: '2026-07-29T00:01:01.000Z',
						contextRevision: input.plan.contextRevision,
					},
				};
			},
		},
	});
	const runtimeHarness = harness({
		core,
		grantState,
		mutationSecurityPolicy: policy,
		recoveryStore,
	});
	const first = runtimeHarness.access(request([
		'tasks.update.preview',
		'tasks.update.apply',
	]));
	assert.equal(first.ok, true);
	if (!first.ok) return;
	const preview = await first.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: {
			operonId: '00000000-0000-4000-8000-000000000001',
			locator: {
				representation: 'inline',
				filePath: 'Tasks.md',
				lineNumber: 1,
			},
		},
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const uncertain = await first.api.mutations.apply({ plan: preview.plan });
	assert.equal(uncertain.status, 'outcome-unknown');
	assert.equal(uncertain.recovery?.recoveryRef, preview.plan.recoveryRef);

	const pending = await first.api.mutations.pendingRecoveries();
	assert.equal(pending.ok, true);
	if (pending.ok) {
		assert.deepEqual(Object.keys(pending.recoveries[0]).sort(), [
			'capability',
			'createdAt',
			'expiresAt',
			'mutationKind',
			'planDigest',
			'recoveryRef',
			'riskLevel',
		]);
	}

	grantState.value = 'revoked';
	const restarted = runtimeHarness.access(request());
	assert.equal(restarted.ok, true);
	if (!restarted.ok) return;
	const restartedPending = await restarted.api.mutations.pendingRecoveries();
	assert.equal(restartedPending.ok, true);
	if (restartedPending.ok) assert.equal(restartedPending.recoveries.length, 1);
	const recovered = await restarted.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(recovered.status, 'already-applied');
	assert.equal(applyCalls, 2);
	const afterTerminal = await restarted.api.mutations.pendingRecoveries();
	assert.equal(afterTerminal.ok, true);
	if (afterTerminal.ok) assert.equal(afterTerminal.recoveries.length, 0);
});

test('undispatched recovery refs and unavailable durable admission fail before Runtime apply', async () => {
	let applyCalls = 0;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				return runtime().mutations.apply(input);
			},
		},
	});
	let storeFailure: Error | null = new Error('blocked');
	const unavailableStore: DeveloperMutationRecoveryStoreV1 = {
		putPrepared: async () => {
			if (storeFailure) throw storeFailure;
		},
		get: async () => undefined,
		list: async () => {
			throw storeFailure;
		},
		markDispatched: async () => undefined,
		markTerminal: async () => undefined,
		markRefused: async () => undefined,
		delete: async () => undefined,
	};
	const access = harness({
		core,
		mutationSecurityPolicy: policy,
		recoveryStore: unavailableStore,
	}).access(request(['tasks.update.preview', 'tasks.update.apply']));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: {
			operonId: '00000000-0000-4000-8000-000000000001',
			locator: {
				representation: 'inline',
				filePath: 'Tasks.md',
				lineNumber: 1,
			},
		},
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const undispatched = await access.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(undispatched.error?.code, 'invalid-request');
	for (const [reasonCode, error] of [
		['recovery-store-unexpected-failure', new Error('blocked')],
		['recovery-store-corrupt', new DeveloperMutationRecoveryStoreErrorV1(
			'recovery-store-corrupt',
			'corrupt',
		)],
	] as const) {
		storeFailure = error;
		const pending = await access.api.mutations.pendingRecoveries();
		assert.equal(pending.ok, false);
		if (!pending.ok) {
			assert.equal(pending.error.code, 'receipt-store-unavailable');
			assert.equal(pending.error.details?.reasonCode, reasonCode);
		}
	}
	storeFailure = new DeveloperMutationRecoveryStoreErrorV1(
		'recovery-store-full',
		'full',
	);
	const apply = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(apply.status, 'failed');
	assert.equal(apply.error?.code, 'receipt-store-unavailable');
	assert.equal(apply.error?.details?.reasonCode, 'recovery-store-full');
	assert.equal(apply.error?.retryable, true);
	assert.equal(apply.error?.action, 'wait-and-retry');
	assert.equal(apply.recovery, undefined);
	storeFailure = null;
	const repeated = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(repeated.error?.details?.planState, undefined);
	assert.equal(applyCalls, 1);
});

test('a dispatch-proof store failure releases the claim for unchanged apply retry', async () => {
	class RetryableDispatchStore extends MemoryDeveloperRecoveryStore {
		failDispatch = true;

		override async markDispatched(consumerId: string, recoveryRef: string): Promise<void> {
			if (this.failDispatch) {
				this.failDispatch = false;
				throw new DeveloperMutationRecoveryStoreErrorV1(
					'recovery-store-unavailable',
					'Injected dispatch proof failure.',
				);
			}
			await super.markDispatched(consumerId, recoveryRef);
		}
	}
	const recoveryStore = new RetryableDispatchStore();
	let applyCalls = 0;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				return runtime().mutations.apply(input);
			},
		},
	});
	const access = harness({
		core,
		mutationSecurityPolicy: policy,
		recoveryStore,
	}).access(request(['tasks.update.preview', 'tasks.update.apply']));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;

	const unavailable = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(unavailable.error?.code, 'receipt-store-unavailable');
	assert.equal(unavailable.error?.retryable, true);
	assert.equal(unavailable.error?.action, 'wait-and-retry');
	assert.equal(unavailable.recovery, undefined);
	assert.equal(recoveryStore.rawState(preview.plan.recoveryRef), 'prepared');
	assert.equal(applyCalls, 0);

	const retried = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(retried.error?.details?.reasonCode, undefined);
	assert.equal(applyCalls, 1);
});

test('durable dispatch-intent precedes Runtime invocation', async () => {
	class IntentTrackingStore extends MemoryDeveloperRecoveryStore {
		intentDurable = false;

		override async markDispatched(consumerId: string, recoveryRef: string): Promise<void> {
			await super.markDispatched(consumerId, recoveryRef);
			this.intentDurable = true;
		}
	}
	const recoveryStore = new IntentTrackingStore();
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				assert.equal(recoveryStore.intentDurable, true);
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'outcome-unknown',
					mutationMayHaveApplied: true,
					retryAllowed: false,
					groupResults: [],
					error: structuredErrorV1('outcome-unknown', 'Injected crash window.', {
						action: 'recover-same-plan',
					}),
				};
			},
		},
	});
	const access = harness({
		core,
		mutationSecurityPolicy: policy,
		recoveryStore,
	}).access(request(['tasks.update.preview', 'tasks.update.apply']));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const result = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(result.status, 'outcome-unknown');
	assert.equal(recoveryStore.rawState(preview.plan.recoveryRef), 'dispatched');
});

test('revocation during prepared-store await refuses final claim and seals the intent refused', async () => {
	let releaseStore: (() => void) | undefined;
	let enteredStore: (() => void) | undefined;
	const entered = new Promise<void>(resolve => {
		enteredStore = resolve;
	});
	const storeGate = new Promise<void>(resolve => {
		releaseStore = resolve;
	});
	class DelayedPreparedStore extends MemoryDeveloperRecoveryStore {
		override async putPrepared(record: DeveloperMutationRecoveryRecordV1): Promise<void> {
			await super.putPrepared(record);
			enteredStore?.();
			await storeGate;
		}
	}
	const recoveryStore = new DelayedPreparedStore();
	const grantState = {
		value: 'active' as 'pending' | 'active' | 'suspended' | 'revoked',
		revision: 4,
	};
	let applyCalls = 0;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: grant => grant.revision === grantState.revision,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				return runtime().mutations.apply(input);
			},
		},
	});
	const access = harness({
		core,
		grantState,
		mutationSecurityPolicy: policy,
		recoveryStore,
	}).access(request(['tasks.update.preview', 'tasks.update.apply']));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const applying = access.api.mutations.apply({ plan: preview.plan });
	await entered;
	grantState.revision += 1;
	releaseStore?.();
	const refused = await applying;
	assert.equal(refused.status, 'failed');
	assert.equal(refused.error?.details?.reasonCode, 'grant-revision-changed');
	assert.equal(applyCalls, 0);
	assert.equal(recoveryStore.rawState(preview.plan.recoveryRef), 'refused');
	const recovery = await access.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(recovery.error?.code, 'invalid-request');
});

test('a denied claim remains durably non-recoverable across restart when refusal finalization fails', async () => {
	const grantState = {
		value: 'active' as 'pending' | 'active' | 'suspended' | 'revoked',
		revision: 8,
	};
	class RefusalFailingStore extends MemoryDeveloperRecoveryStore {
		override async putPrepared(record: DeveloperMutationRecoveryRecordV1): Promise<void> {
			await super.putPrepared(record);
			grantState.revision += 1;
		}

		override async markRefused(): Promise<void> {
			throw new DeveloperMutationRecoveryStoreErrorV1(
				'recovery-store-unavailable',
				'Injected refusal persistence failure.',
			);
		}
	}
	const recoveryStore = new RefusalFailingStore();
	let applyCalls = 0;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: grant => grant.revision === grantState.revision,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				return runtime().mutations.apply(input);
			},
		},
	});
	const runtimeHarness = harness({
		core,
		grantState,
		mutationSecurityPolicy: policy,
		recoveryStore,
	});
	const access = runtimeHarness.access(request([
		'tasks.update.preview',
		'tasks.update.apply',
	]));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const refused = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(refused.status, 'failed');
	assert.equal(refused.error?.code, 'authority-insufficient');
	assert.equal(refused.error?.details?.reasonCode, 'grant-revision-changed');
	assert.equal(applyCalls, 0);
	assert.equal(recoveryStore.rawState(preview.plan.recoveryRef), 'prepared');

	const pending = await access.api.mutations.pendingRecoveries();
	assert.equal(pending.ok, true);
	if (pending.ok) assert.equal(pending.recoveries.length, 0);
	const sameSessionRecovery = await access.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(sameSessionRecovery.error?.code, 'invalid-request');

	// A new harness models a fresh Operon/Obsidian renderer over the same
	// private durable recovery database.
	const freshHarness = harness({
		core,
		grantState,
		mutationSecurityPolicy: policy,
		recoveryStore,
	});
	const reacquired = freshHarness.access(request());
	assert.equal(reacquired.ok, true);
	if (!reacquired.ok) return;
	const reacquiredPending = await reacquired.api.mutations.pendingRecoveries();
	assert.equal(reacquiredPending.ok, true);
	if (reacquiredPending.ok) assert.equal(reacquiredPending.recoveries.length, 0);
	const reacquiredRecovery = await reacquired.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(reacquiredRecovery.error?.code, 'invalid-request');
});

test('definitive Runtime refusal remains non-recoverable when physical delete fails', async () => {
	class DeleteFailingStore extends MemoryDeveloperRecoveryStore {
		override async delete(): Promise<void> {
			throw new Error('Injected delete failure.');
		}
	}
	const recoveryStore = new DeleteFailingStore();
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-result',
				status: 'failed',
				mutationMayHaveApplied: false,
				retryAllowed: false,
				groupResults: [],
				error: structuredErrorV1('authority-insufficient', 'Injected pre-source refusal.'),
			}),
		},
	});
	const access = harness({
		core,
		mutationSecurityPolicy: policy,
		recoveryStore,
	}).access(request(['tasks.update.preview', 'tasks.update.apply']));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const refused = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(refused.status, 'failed');
	assert.equal(recoveryStore.rawState(preview.plan.recoveryRef), 'refused');
	const pending = await access.api.mutations.pendingRecoveries();
	assert.equal(pending.ok, true);
	if (pending.ok) assert.equal(pending.recoveries.length, 0);
	const recovery = await access.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(recovery.error?.code, 'invalid-request');
});

test('all public mutation families and suboperations apply once and replay through the Developer Gateway', async () => {
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const observed = new Set<string>();
	let applyCalls = 0;
	const core = runtime({
		mutations: {
			preview: async input => {
				observed.add(`${input.mutationKind}:${JSON.stringify(input.spec)}`);
				const caseNumber = observed.size;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-preview-result',
					ok: true,
					warnings: [],
					plan: {
						...sealedPlan(input),
						planId: `plan-${input.mutationKind}-${caseNumber}`,
						planHash: `plan-hash-${input.mutationKind}-${caseNumber}`,
						receiptTargetDigest: `target-digest-${input.mutationKind}-${caseNumber}`,
					},
				};
			},
			apply: async input => {
				applyCalls += 1;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'applied',
					mutationMayHaveApplied: true,
					retryAllowed: false,
					groupResults: [{ groupId: 'group-1', status: 'committed' }],
					receipt: {
						contractVersion: 1,
						vaultIdentityHash: 'vault',
						clientInstanceId: input.plan.clientInstanceId,
						idempotencyKeyHash: input.plan.idempotencyKeyHash,
						planHash: input.plan.planHash,
						mutationKind: input.plan.mutationKind,
						targetDigest: input.plan.receiptTargetDigest,
						terminalOutcome: 'applied',
						effectiveAt: '2026-07-29T00:01:00.000Z',
						completedAt: '2026-07-29T00:01:01.000Z',
						expiresAt: input.plan.expiresAt,
					},
					postflight: {
						status: 'verified',
						observedAt: '2026-07-29T00:01:01.000Z',
						contextRevision: input.plan.contextRevision,
					},
				};
			},
		},
	});
	const target = {
		operonId: '00000000-0000-4000-8000-000000000001',
		locator: {
			representation: 'inline' as const,
			filePath: 'Tasks.md',
			lineNumber: 1,
		},
	};
	const cases: readonly {
		readonly input: DeveloperMutationPreviewInputV1;
		readonly applyCapability: CapabilityIdV1;
	}[] = [
		{
			input: { capability: 'tasks.create.preview', mutationKind: 'task.create', spec: { operation: 'create', items: [] } },
			applyCapability: 'tasks.create.apply',
		},
		{
			input: { capability: 'tasks.update.preview', mutationKind: 'task.update', target, spec: { operation: 'update', changes: [] } },
			applyCapability: 'tasks.update.apply',
		},
		{
			input: { capability: 'tasks.update.preview', mutationKind: 'task.update', spec: { operation: 'update-batch', items: [] } },
			applyCapability: 'tasks.update.apply',
		},
		{
			input: { capability: 'tasks.recurrence.preview', mutationKind: 'task.recurrence', target, spec: { operation: 'update-recurrence', scope: 'this-task', changes: [] } },
			applyCapability: 'tasks.recurrence.apply',
		},
		{
			input: { capability: 'tasks.relationship.preview', mutationKind: 'task.relationship', target, spec: { operation: 'replace-relationships', changes: [] } },
			applyCapability: 'tasks.relationship.apply',
		},
		{
			input: { capability: 'tasks.reminder.preview', mutationKind: 'task.reminder-item', target, spec: { operation: 'add', collection: 'reminderRules', value: 'dateDue.30m' } },
			applyCapability: 'tasks.reminder.apply',
		},
		{
			input: { capability: 'tasks.reminder.preview', mutationKind: 'task.reminder-item', target, spec: { operation: 'replace', collection: 'reminderRules', itemId: 'r1', expectedValue: 'dateDue.30m', value: 'dateDue.1h' } },
			applyCapability: 'tasks.reminder.apply',
		},
		{
			input: { capability: 'tasks.reminder.preview', mutationKind: 'task.reminder-item', target, spec: { operation: 'remove', collection: 'reminderRules', itemId: 'r1', expectedValue: 'dateDue.30m' } },
			applyCapability: 'tasks.reminder.apply',
		},
		{
			input: { capability: 'tasks.transition.preview', mutationKind: 'task.transition', target, spec: { operation: 'transition', targetStatusId: 'done' } },
			applyCapability: 'tasks.transition.apply',
		},
		{
			input: { capability: 'tasks.pinned.preview', mutationKind: 'task.pinned-state', target, spec: { operation: 'set-pinned', pinned: true } },
			applyCapability: 'tasks.pinned.apply',
		},
		{
			input: { capability: 'timers.control.preview', mutationKind: 'timer.control', spec: { operation: 'start' } },
			applyCapability: 'timers.control.apply',
		},
		{
			input: { capability: 'timers.control.preview', mutationKind: 'timer.control', spec: { operation: 'stop' } },
			applyCapability: 'timers.control.apply',
		},
		{
			input: { capability: 'timers.session.preview', mutationKind: 'timer.session', target, spec: { operation: 'add-session', start: '2026-07-29T00:00:00', end: '2026-07-29T01:00:00' } },
			applyCapability: 'timers.session.apply',
		},
		{
			input: { capability: 'timers.session.preview', mutationKind: 'timer.session', target, spec: { operation: 'update-session', sessionNumber: 1, start: '2026-07-29T00:00:00', end: '2026-07-29T01:00:00' } },
			applyCapability: 'timers.session.apply',
		},
		{
			input: { capability: 'timers.session.preview', mutationKind: 'timer.session', target, spec: { operation: 'remove-session', sessionNumber: 1 } },
			applyCapability: 'timers.session.apply',
		},
		{
			input: { capability: 'tasks.convert.preview', mutationKind: 'task.convert', target, spec: { operation: 'convert', from: 'inline', to: 'file', templateId: 'default' } },
			applyCapability: 'tasks.convert.apply',
		},
		{
			input: { capability: 'tasks.convert.preview', mutationKind: 'task.convert', target, spec: { operation: 'convert', from: 'file', to: 'inline', target: { mode: 'configured-target' } } },
			applyCapability: 'tasks.convert.apply',
		},
		{
			input: {
				capability: 'tasks.inline.relocate.preview',
				mutationKind: 'task.inline-relocate',
				target,
				spec: {
					operation: 'relocate-inline',
					destination: { locator: target.locator, mustBeBlank: true },
				},
			},
			applyCapability: 'tasks.inline.relocate.apply',
		},
		{
			input: { capability: 'tasks.delete.preview', mutationKind: 'task.delete', target, spec: { operation: 'delete', mode: 'delete-exact-task', cascade: false } },
			applyCapability: 'tasks.delete.apply',
		},
	];
	const access = harness({
		core,
		mutationSecurityPolicy: policy,
	}).access(request([...new Set(cases.flatMap(item => [
		item.input.capability,
		item.applyCapability,
	]))]));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	for (const { input } of cases) {
		const preview = await access.api.mutations.preview(input);
		assert.equal(preview.ok, true, `${input.mutationKind}:${input.spec.operation} should be admitted`);
		if (!preview.ok) continue;
		const applyCallsBefore = applyCalls;
		const applied = await access.api.mutations.apply({ plan: preview.plan });
		assert.equal(applied.status, 'applied', `${input.mutationKind}:${input.spec.operation} should apply`);
		const replayed = await access.api.mutations.apply({ plan: preview.plan });
		assert.equal(replayed.status, 'already-applied', `${input.mutationKind}:${input.spec.operation} should replay`);
		assert.equal(replayed.postflight?.status, 'receipt-replay');
		assert.equal(applyCalls, applyCallsBefore + 1, `${input.mutationKind}:${input.spec.operation} should dispatch once`);
	}
	assert.equal(observed.size, cases.length);
	for (const { input } of cases) {
		assert.equal(observed.has(`${input.mutationKind}:${JSON.stringify(input.spec)}`), true);
	}
});

test('a successfully applied plan replays its authoritative terminal receipt without another source apply', async () => {
	let applyCalls = 0;
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'applied',
					mutationMayHaveApplied: true,
					retryAllowed: false,
					groupResults: [],
					receipt: {
						contractVersion: 1,
						vaultIdentityHash: 'vault',
						clientInstanceId: input.plan.clientInstanceId,
						idempotencyKeyHash: input.plan.idempotencyKeyHash,
						planHash: input.plan.planHash,
						mutationKind: input.plan.mutationKind,
						targetDigest: input.plan.receiptTargetDigest,
						terminalOutcome: 'applied',
						effectiveAt: '2026-07-29T00:01:00.000Z',
						completedAt: '2026-07-29T00:01:01.000Z',
						expiresAt: input.plan.expiresAt,
					},
					postflight: {
						status: 'verified',
						observedAt: '2026-07-29T00:01:01.000Z',
						contextRevision: input.plan.contextRevision,
					},
				};
			},
		},
	});
	const access = harness({ core, mutationSecurityPolicy: policy }).access(request([
		'tasks.update.preview',
		'tasks.update.apply',
	]));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const applied = await access.api.mutations.apply({ plan: preview.plan });
	assert.equal(applied.status, 'applied');

	const repeatedApply = await access.api.mutations.apply({ plan: preview.plan });
	const recovery = await access.api.mutations.recover({ plan: preview.plan });
	assert.equal(repeatedApply.status, 'already-applied');
	assert.equal(repeatedApply.receipt?.terminalOutcome, 'already-applied');
	assert.equal(repeatedApply.postflight?.status, 'receipt-replay');
	assert.equal(recovery.error?.details?.planState, 'terminal');
	assert.equal(applyCalls, 1);
});

test('terminal recovery tombstone survives result-delivery loss without listing as pending', async () => {
	let applyCalls = 0;
	const recoveryStore = new MemoryDeveloperRecoveryStore();
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: () => true,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				const replay = applyCalls > 1;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: replay ? 'already-applied' : 'applied',
					mutationMayHaveApplied: true,
					retryAllowed: false,
					groupResults: replay ? [] : [{ groupId: 'group-1', status: 'committed' }],
					receipt: {
						contractVersion: 1,
						vaultIdentityHash: 'vault',
						clientInstanceId: input.plan.clientInstanceId,
						idempotencyKeyHash: input.plan.idempotencyKeyHash,
						planHash: input.plan.planHash,
						mutationKind: input.plan.mutationKind,
						targetDigest: input.plan.receiptTargetDigest,
						terminalOutcome: replay ? 'already-applied' : 'applied',
						effectiveAt: '2026-07-29T00:01:00.000Z',
						completedAt: '2026-07-29T00:01:01.000Z',
						expiresAt: input.plan.expiresAt,
					},
					postflight: {
						status: replay ? 'receipt-replay' : 'verified',
						observedAt: '2026-07-29T00:01:01.000Z',
						contextRevision: input.plan.contextRevision,
					},
				};
			},
		},
	});
	const runtimeHarness = harness({
		core,
		mutationSecurityPolicy: policy,
		recoveryStore,
	});
	const first = runtimeHarness.access(request([
		'tasks.update.preview',
		'tasks.update.apply',
	]));
	assert.equal(first.ok, true);
	if (!first.ok) return;
	const preview = await first.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: {
			operonId: '00000000-0000-4000-8000-000000000001',
			locator: {
				representation: 'inline',
				filePath: 'Tasks.md',
				lineNumber: 1,
			},
		},
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;
	const applied = await first.api.mutations.apply({ plan: preview.plan });
	assert.equal(applied.status, 'applied');

	const restarted = runtimeHarness.access(request());
	assert.equal(restarted.ok, true);
	if (!restarted.ok) return;
	const pending = await restarted.api.mutations.pendingRecoveries();
	assert.equal(pending.ok, true);
	if (pending.ok) assert.equal(pending.recoveries.length, 0);
	const replayed = await restarted.api.mutations.recover({
		recoveryRef: preview.plan.recoveryRef,
	});
	assert.equal(replayed.status, 'already-applied');
	assert.equal(applyCalls, 2);
});

test('dispatch-time claim blocks grant revocation across the consent await boundary', async () => {
	let applyCalls = 0;
	const grantState = {
		value: 'active' as 'pending' | 'active' | 'suspended' | 'revoked',
		revision: 7,
	};
	const policy = new DeveloperMutationSecurityPolicyV1({
		consent: { requestConsent: async () => 'approved' },
		isSessionCurrent: () => true,
		isGrantCurrent: candidate => candidate.revision === grantState.revision,
		now: () => new Date(),
	});
	const core = runtime({
		mutations: {
			preview: async input => ({
				contractVersion: 1,
				requestId: input.requestId,
				kind: 'mutation-preview-result',
				ok: true,
				warnings: [],
				plan: sealedPlan(input),
			}),
			apply: async input => {
				applyCalls += 1;
				return {
					contractVersion: 1,
					requestId: input.requestId,
					kind: 'mutation-result',
					status: 'failed',
					mutationMayHaveApplied: false,
					retryAllowed: false,
					groupResults: [],
					error: structuredErrorV1('internal-error', 'Must not dispatch after revocation.'),
				};
			},
		},
	});
	const access = harness({
		core,
		grantState,
		mutationSecurityPolicy: policy,
	}).access(request(['tasks.update.preview', 'tasks.update.apply']));
	assert.equal(access.ok, true);
	if (!access.ok) return;
	const preview = await access.api.mutations.preview({
		capability: 'tasks.update.preview',
		mutationKind: 'task.update',
		target: mutationTarget,
		spec: { operation: 'update', changes: [] },
	});
	assert.equal(preview.ok, true);
	if (!preview.ok) return;

	const pendingApply = access.api.mutations.apply({ plan: preview.plan });
	grantState.revision += 1;
	const refused = await pendingApply;
	assert.equal(refused.status, 'failed');
	assert.equal(refused.error?.code, 'authority-insufficient');
	assert.equal(refused.error?.details?.reasonCode, 'grant-revision-changed');
	assert.equal(applyCalls, 0);
});

test('an exact mutation grant passes access admission without broadening capability scope', () => {
	const result = harness().access(request(['tasks.create.preview']));
	assert.equal(result.ok, true);
	assert.equal(result.status.authority, 'granted');
	assert.deepEqual(result.status.grant?.effectiveCapabilities, ['tasks.create.preview']);
	assert.ok(result.status.capabilities.every(capability => (
		capability.id === 'system.health'
		|| capability.id === 'system.capabilities'
		|| capability.id === 'tasks.create.preview'
	)));
});
