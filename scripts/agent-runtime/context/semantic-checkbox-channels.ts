import { canonicalJsonV1, toJsonValueV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import { computeRunningVaultSha256V1 } from '../../../src/agent-runtime/transport/secure-request-file';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getOperonDeveloperApiV1 } from '../../../src/agent-runtime/developer-api';
import { dispatchAgentRuntimeCliV1 } from '../../../src/agent-runtime/transport/dispatcher';
import { registerWindowsBrokerScopeV1, stageWindowsBrokerInvocationV1, clearWindowsBrokerStagesForTestsV1 } from '../../../src/agent-runtime/transport/windows-broker-state';
import type { AgentRuntimeDesktopNodeApiV1 } from '../../../src/agent-runtime/transport/types';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { RuntimeHealthV1 } from '../../../src/agent-runtime/contracts/v1/lifecycle';
import type { TaskQueryRequestV1, TaskQueryResultV1 } from '../../../src/agent-runtime/contracts/v1/context';
import { decodeCliResultEnvelopeV1 } from '../../../src/agent-runtime/contracts/v1/decode';

/** Exercise both production adapters over the real indexer/Context query supplied by the fixture. */
export async function testSemanticCheckboxChannels(query: (request: TaskQueryRequestV1) => Promise<TaskQueryResultV1>): Promise<void> {
	const compatibility = { contractVersion: 1 as const, runtimeApi: { min: 1, max: 1 } };
	const health: RuntimeHealthV1 = {
		apiVersion: 1, contractVersion: 1, ok: true, lifecyclePhase: 'ready', v8PersistencePhase: 'idle',
		compatibility, capabilities: [{ id: 'tasks.query', availability: 'available', stability: 'stable' }],
		freshness: { source: 'live-runtime', coherence: 'verified', observedAt: '2026-01-15T10:20:30.000Z', settled: true },
		admission: { reads: true, writes: false }, warnings: [],
	};
	let calls = 0;
	const core = {
		apiVersion: 1, hasCapability: (id: string) => id === 'tasks.query',
		system: { health: async () => health, capabilities: () => health.capabilities },
		tasks: { query: async (request: TaskQueryRequestV1) => { calls += 1; return query(request); } },
	} as unknown as OperonAgentRuntimeCoreV1;
	const consumer = { manifest: { id: 'checkbox-test', name: 'Checkbox test', version: '1.0.0' } };
	const access = getOperonDeveloperApiV1(core, consumer, { ...compatibility, requestedCapabilities: ['tasks.query'] }, {
		isDesktopAvailable: () => true, isHostVersionSupported: () => true,
		lifecyclePhase: () => 'ready', retryAfterMs: () => undefined, lifecycleError: () => undefined,
		isCoreActive: candidate => candidate === core,
		grantController: {
			verifyConsumer: candidate => candidate === consumer ? { id: 'checkbox-test', name: 'Checkbox test', version: '1.0.0', instanceEpoch: 'test-epoch' } : null,
			isConsumerCurrent: () => true, observeConsumerVersion: () => true,
			evaluate: () => ({ state: 'active', revision: 1, grantedCapabilities: ['tasks.query'], effectiveCapabilities: ['tasks.query'], pendingCapabilities: [], reason: 'active' }),
			recordPending: () => undefined, hasPersistenceError: () => false,
		},
	});
	assert.ok(access.ok, JSON.stringify(access));
	// Broker admission is in memory; no live IPC, vault, settings or grants are touched.
	const vaultPath = '/synthetic-semantic-checkbox-vault';
	const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
	const nodeApi = {
		platform: 'win32', realpath: async () => vaultPath, utf8: (text: string) => new TextEncoder().encode(text),
		createSha256: sha,
	} as unknown as AgentRuntimeDesktopNodeApiV1;
	const scope = { serverInstanceId: 'a'.repeat(64), vaultSha256: await computeRunningVaultSha256V1(nodeApi, { getFullPath: () => vaultPath }) };
	clearWindowsBrokerStagesForTestsV1();
	registerWindowsBrokerScopeV1(scope);
	try {
		for (const [index, consistency] of (['live-verified', 'best-effort'] as const).entries()) {
			const request: TaskQueryRequestV1 = { contractVersion: 1, requestId: 'semantic-checkbox', kind: 'task-query', consistency, limit: 17 };
			const apiResult = await access.api.tasks.query(request);
			assert.ok(apiResult.ok, JSON.stringify(apiResult));
			const token = String(index + 1).repeat(32);
			stageWindowsBrokerInvocationV1({ token, receipt: 'b'.repeat(64), scope, now: Date.now(), raw: JSON.stringify({
				kind: 'cli-invocation', contractVersion: 1, compatibility, mode: 'live', clientVersion: '1.0.0-test', cliContract: { min: 1, max: 1 }, requestId: request.requestId, command: 'tasks.query',
				expectedVaultSha256: scope.vaultSha256, readinessTimeoutMs: 1000, request,
			}) });
			const raw = await dispatchAgentRuntimeCliV1({ runtime: core, nodeApi,
				vaultAdapter: { getFullPath: () => vaultPath }, monotonicNow: () => Date.now(),
				runtimeMetadata: { appVersion: '1.13.3', plugin: { id: 'operon', version: '4.5.0', minAppVersion: '1.7.2' }, apiVersion: 1 },
			}, { expectedCommand: 'tasks.query', requestToken: token, transportKind: 'windows-named-pipe', brokerScope: scope });
			const decoded = decodeCliResultEnvelopeV1(JSON.parse(raw));
			assert.ok(decoded.ok, raw);
			assert.equal(decoded.value.ok, true, raw);
			assert.ok(decoded.value.ok);
			const cliResult = decoded.value.result as TaskQueryResultV1;
			assert.ok(cliResult.ok);
			assert.equal(canonicalJsonV1(toJsonValueV1(cliResult.tasks)), canonicalJsonV1(toJsonValueV1(apiResult.tasks)));
			assert.equal(cliResult.tasks.length, 17);
			assert.equal(cliResult.tasks.find(task => task.identity.operonId === 'z000017')?.checkbox, 'cancelled');
		}
		assert.equal(calls, 4, 'Both production channels must dispatch each consistency to the common Runtime read');
	} finally { clearWindowsBrokerStagesForTestsV1(); }
}
