import assert from 'node:assert/strict';

import {
	compileDirectLifecycleIntentV1,
	type DirectLifecycleActionV1,
} from '../../../packages/operon-cli/src/direct-lifecycle';
import type {
	CatalogPipelineV1,
	CatalogStatusV1,
	OperonCatalogV1,
	TaskContextV1,
} from '../../../src/agent-runtime/contracts/v1';

declare global {
	var __operonDirectLifecycleTestRun: Promise<void> | undefined;
}

globalThis.__operonDirectLifecycleTestRun = Promise.resolve().then(run);

function run(): void {
	testComplete();
	testCancel();
	testReopenUsesFirstOpenStatus();
	testSemanticNoChanges();
	testRefusals();
	console.log('Direct lifecycle compiler tests passed');
}

function testComplete(): void {
	const task = liveTask('status-active');
	const result = compileDirectLifecycleIntentV1({
		action: 'complete',
		task,
		catalog: liveCatalog(),
	});
	assert.equal(result.status, 'ready');
	if (result.status !== 'ready') return;
	assert.deepEqual(result.targetStatus, { id: 'status-done', label: 'Done' });
	assert.deepEqual(result.intent.target, {
		operonId: 'abc1234',
		locator: task.locator,
	});
	assert.deepEqual(result.intent.spec, {
		operation: 'transition',
		targetStatusId: 'status-done',
		expectedStatusId: 'status-active',
	});
}

function testCancel(): void {
	const result = compileDirectLifecycleIntentV1({
		action: 'cancel',
		task: liveTask('status-active'),
		catalog: liveCatalog(),
	});
	assert.equal(result.status, 'ready');
	if (result.status !== 'ready') return;
	assert.equal(result.targetStatus.id, 'status-cancelled');
	assert.equal(result.intent.spec.expectedStatusId, 'status-active');
}

function testReopenUsesFirstOpenStatus(): void {
	const catalog = liveCatalog();
	catalog.taxonomy.pipelines[0].statuses = [
		status('status-active', 'Active', 20),
		status('status-open', 'Open', 10),
		status('status-done', 'Done', 30, { isFinished: true }),
		status('status-cancelled', 'Cancelled', 40, { isCancelled: true }),
	];
	const result = compileDirectLifecycleIntentV1({
		action: 'reopen',
		task: liveTask('status-done'),
		catalog,
	});
	assert.equal(result.status, 'ready');
	if (result.status !== 'ready') return;
	assert.equal(result.targetStatus.id, 'status-open');
	assert.deepEqual(result.intent.spec, {
		operation: 'transition',
		targetStatusId: 'status-open',
		expectedStatusId: 'status-done',
	});
}

function testSemanticNoChanges(): void {
	for (const [action, currentStatusId] of [
		['complete', 'status-done'],
		['cancel', 'status-cancelled'],
		['reopen', 'status-active'],
	] as const) {
		const result = compileDirectLifecycleIntentV1({
			action,
			task: liveTask(currentStatusId),
			catalog: liveCatalog(),
		});
		assert.equal(result.status, 'no-change', action);
	}
}

function testRefusals(): void {
	const noFinished = liveCatalog();
	noFinished.taxonomy.pipelines[0].statuses = noFinished.taxonomy.pipelines[0].statuses
		.filter(candidate => !candidate.isFinished);
	expectCode('LIFECYCLE_TARGET_UNAVAILABLE', () => compile('complete', liveTask(), noFinished));

	const ambiguousFinished = liveCatalog();
	ambiguousFinished.taxonomy.pipelines[0].statuses.push(
		status('status-archived', 'Archived', 50, { isFinished: true }),
	);
	expectCode('AMBIGUOUS_LIFECYCLE_TARGET', () => (
		compile('complete', liveTask(), ambiguousFinished)
	));
	expectCode('AMBIGUOUS_LIFECYCLE_TARGET', () => (
		compile('complete', liveTask('status-done'), ambiguousFinished)
	));

	const ambiguousCancelled = liveCatalog();
	ambiguousCancelled.taxonomy.pipelines[0].statuses.push(
		status('status-abandoned', 'Abandoned', 50, { isCancelled: true }),
	);
	expectCode('AMBIGUOUS_LIFECYCLE_TARGET', () => (
		compile('cancel', liveTask('status-cancelled'), ambiguousCancelled)
	));

	const unresolvedFinished = liveCatalog();
	const done = unresolvedFinished.taxonomy.pipelines[0].statuses
		.find(candidate => candidate.id === 'status-done');
	assert.ok(done);
	done.identityStatus = 'ambiguous';
	expectCode('LIFECYCLE_TARGET_UNAVAILABLE', () => (
		compile('complete', liveTask(), unresolvedFinished)
	));

	const unavailableAction = liveCatalog();
	unavailableAction.policies.transitions.actions = ['set-status', 'complete', 'reopen'];
	expectCode('LIFECYCLE_ACTION_UNAVAILABLE', () => (
		compile('cancel', liveTask(), unavailableAction)
	));

	expectCode('CURRENT_STATUS_UNAVAILABLE', () => (
		compile('complete', liveTask('missing-status'), liveCatalog())
	));
	const duplicateCurrent = liveCatalog();
	duplicateCurrent.taxonomy.pipelines[0].statuses.push(
		status('status-active', 'Duplicate active', 11),
	);
	expectCode('CURRENT_STATUS_UNAVAILABLE', () => (
		compile('complete', liveTask(), duplicateCurrent)
	));
	expectCode('CURRENT_PIPELINE_UNAVAILABLE', () => (
		compile('complete', liveTask('status-active', 'missing-pipeline'), liveCatalog())
	));
	expectCode('INVALID_OPERON_ID', () => (
		compile('complete', {
			...liveTask(),
			identity: { operonId: 'invalid', validity: 'legacy-invalid', mutationAllowed: false },
		}, liveCatalog())
	));
}

function compile(
	action: DirectLifecycleActionV1,
	task: TaskContextV1,
	catalog: Extract<OperonCatalogV1, { ok: true }>,
) {
	return compileDirectLifecycleIntentV1({ action, task, catalog });
}

function liveCatalog(): Extract<OperonCatalogV1, { ok: true }> {
	return {
		ok: true,
		taxonomy: {
			pipelines: [{
				id: 'pipeline-daily',
				name: 'Daily',
				description: 'Daily work',
				order: 0,
				identityStatus: 'resolved',
				statuses: [
					status('status-open', 'Open', 0),
					status('status-active', 'Active', 10),
					status('status-done', 'Done', 20, { isFinished: true }),
					status('status-cancelled', 'Cancelled', 30, { isCancelled: true }),
				],
			}],
		},
		policies: {
			transitions: {
				actions: ['set-status', 'complete', 'cancel', 'reopen'],
			},
		},
	} as Extract<OperonCatalogV1, { ok: true }>;
}

function liveTask(
	statusId = 'status-active',
	pipelineId = 'pipeline-daily',
): TaskContextV1 {
	return {
		identity: { operonId: 'abc1234', validity: 'canonical', mutationAllowed: true },
		description: 'Lifecycle test task',
		locator: {
			representation: 'inline',
			filePath: 'Disposable.md',
			line: { lineNumber: 2, operonId: 'abc1234' },
		},
		workflow: {
			pipeline: { id: pipelineId, label: 'Daily' },
			status: { id: statusId, label: statusId },
		},
	} as unknown as TaskContextV1;
}

function status(
	id: string,
	label: string,
	order: number,
	semantics: Partial<Pick<CatalogStatusV1, 'isFinished' | 'isCancelled'>> = {},
): CatalogStatusV1 {
	return {
		id,
		label,
		order,
		color: '#000000',
		isFinished: false,
		isCancelled: false,
		isScheduledTarget: false,
		isTrackingTarget: false,
		identityStatus: 'resolved',
		...semantics,
	};
}

function expectCode(code: string, runCase: () => unknown): void {
	assert.throws(runCase, error => (
		error instanceof Error && error.message === code
	));
}
