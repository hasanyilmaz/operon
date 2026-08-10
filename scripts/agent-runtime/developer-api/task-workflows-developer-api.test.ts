import assert from 'node:assert/strict';
import test from 'node:test';
import { structuredErrorV1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import {
	getOperonTaskWorkflowDeveloperApiV1,
	type OperonTaskWorkflowDeveloperApiAccessorV1,
	type TaskFilterQueryRequestV1,
} from '../../../src/agent-runtime/extensions/task-workflows-v1';
import { getOperonDeveloperApiV1 } from '../../../src/agent-runtime/developer-api';
import type { DeveloperApiGrantEvaluationV1 } from '../../../src/agent-runtime/developer-api/grants';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
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
const accessRequest = {
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

test('task-workflow extension owns a typed accessor and the frozen base accessor rejects its capability', () => {
	let grantCalls = 0;
	const core = {
		system: { capabilities: () => [] },
	} as unknown as OperonAgentRuntimeCoreV1;
	const extensionAccessor: OperonTaskWorkflowDeveloperApiAccessorV1 = {
		getTaskWorkflowDeveloperApiV1: (candidate, request) => getOperonTaskWorkflowDeveloperApiV1(
			core,
			candidate,
			request,
			{
				isDesktopAvailable: () => true,
				isHostVersionSupported: () => true,
				lifecyclePhase: () => 'ready',
				isCoreActive: value => value === core,
				grantController: {
					verifyConsumer: () => consumer,
					isConsumerCurrent: () => true,
					evaluate: () => {
						grantCalls += 1;
						throw new Error('the extension accessor is not invoked by this compile-time binding');
					},
					recordPending: () => undefined,
				},
			},
		),
	};
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
		assert.equal(getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, invalid, options).ok, false);
	}
	assert.equal(getOperonTaskWorkflowDeveloperApiV1(core, { ...consumerPlugin }, accessRequest, options).ok, false);

	const pending = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, accessRequest, options);
	assert.equal(pending.ok, false);
	assert.equal(pendingRecords, 1);

	grantState = 'active';
	const opened = getOperonTaskWorkflowDeveloperApiV1(core, consumerPlugin, accessRequest, options);
	assert.equal(opened.ok, true);
	if (!opened.ok) return;
	assert.deepEqual(Object.keys(opened.api.tasks), ['filterQuery']);
	assert.equal(Object.isFrozen(opened.api), true);
	const first = await opened.api.tasks.filterQuery(queryRequest);
	assert.equal(first.ok, false);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(queryCalls, 1);

	grantState = 'revoked';
	const revoked = await opened.api.tasks.filterQuery(queryRequest);
	assert.equal(revoked.ok, false);
	assert.equal(revoked.error.code, 'authority-insufficient');
	assert.equal(queryCalls, 1, 'revoked sessions must not reach the Runtime');

	grantState = 'active';
	currentConsumer = false;
	const staleConsumer = await opened.api.tasks.filterQuery(queryRequest);
	assert.equal(staleConsumer.ok, false);
	if (!staleConsumer.ok) assert.equal(staleConsumer.error.code, 'authority-insufficient');
	currentConsumer = true;
	activeCore = false;
	const staleCore = await opened.api.tasks.filterQuery(queryRequest);
	assert.equal(staleCore.ok, false);
	if (!staleCore.ok) assert.equal(staleCore.error.code, 'authority-insufficient');
	assert.equal(queryCalls, 1);
});
