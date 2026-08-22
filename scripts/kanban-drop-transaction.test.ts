import assert from 'node:assert/strict';
import test from 'node:test';
import type { IndexedTask } from '../src/types/fields';
import type { Pipeline } from '../src/types/pipeline';
import type { KeyMapping } from '../src/types/settings';
import {
	hasKanbanCompanionPayload,
	runKanbanDropTransition,
	shouldRetryKanbanDropTransition,
	type KanbanDropTransitionResult,
} from '../src/systems/kanban-drop-transaction';
import { buildKanbanWritebackPlan } from '../src/systems/kanban-writeback';
import { KanbanDragInteractionGate } from '../src/systems/kanban-drag-interaction';
import { KANBAN_NO_VALUE_KEY } from '../src/systems/kanban-query';
import { KanbanOrderStore } from '../src/storage/kanban-order-store';
import { WriteQueue } from '../src/storage/write-queue';

const pipeline: Pipeline = {
	id: 'pipeline',
	name: 'Project',
	statuses: [
		{
			id: 'todo',
			label: 'Todo',
			color: '#000000',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		},
		{
			id: 'doing',
			label: 'Doing',
			color: '#000000',
			isFinished: false,
			isCancelled: false,
			isScheduledTarget: false,
			isTrackingTarget: false,
			propertyMapping: null,
		},
	],
};

function task(overrides: Partial<IndexedTask> = {}): IndexedTask {
	return {
		operonId: 'task-1',
		description: 'Task',
		checkbox: 'open',
		fieldValues: { status: 'Project.Todo' },
		tags: [],
		primary: { filePath: 'Tasks.md', lineNumber: 0, format: 'inline' },
		datetimeModified: '2026-08-22T00:00:00.000Z',
		tier: 'hot',
		...overrides,
	};
}

function failure(
	stage: 'prepare' | 'preview' | 'apply',
	code: string,
	mutationMayHaveApplied = false,
	mutationStatus: 'failed' | 'partial' | 'outcome-unknown' = 'failed',
): KanbanDropTransitionResult {
	return { ok: false, stage, code, reason: code, mutationMayHaveApplied, mutationStatus };
}

function customMapping(canonicalKey: string, type: KeyMapping['type']): KeyMapping {
	return {
		canonicalKey,
		visiblePropertyName: canonicalKey,
		type,
		sync: 'auto',
		enabled: true,
		isSystem: false,
		showInKanbanSwimlane: true,
	};
}

test('status-only drops have no companion catalog dependency', () => {
	assert.equal(hasKanbanCompanionPayload({}), false);
	assert.equal(hasKanbanCompanionPayload({ priority: 'High' }), true);
});

test('same-lane status changes do not rewrite ordered list swimlanes', () => {
	const tagsTask = task({ tags: ['alpha', 'lane', 'omega'] });
	const tagsPlan = buildKanbanWritebackPlan({
		task: tagsTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'lane',
		targetLaneKey: 'lane',
		swimlaneBy: 'tags',
	});
	assert.deepEqual(tagsPlan.payload, {
		status: 'Project.Doing',
	});
	assert.deepEqual(tagsPlan.nextDraft.tags, ['alpha', 'lane', 'omega']);

	const contextsTask = task({
		fieldValues: { status: 'Project.Todo', contexts: 'alpha; lane; omega' },
	});
	const contextsPlan = buildKanbanWritebackPlan({
		task: contextsTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'lane',
		targetLaneKey: 'lane',
		swimlaneBy: 'contexts',
	});
	assert.deepEqual(contextsPlan.payload, {
		status: 'Project.Doing',
	});
	assert.equal(contextsPlan.nextDraft.fieldValues.contexts, 'alpha; lane; omega');
});

test('cross-lane drops retain real lane writeback', () => {
	const plan = buildKanbanWritebackPlan({
		task: task({ tags: ['alpha', 'lane', 'omega'] }),
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'lane',
		targetLaneKey: 'next',
		swimlaneBy: 'tags',
	});
	assert.deepEqual(plan.payload, {
		status: 'Project.Doing',
		_tags: 'alpha;omega;next',
	});
});

test('inline and File Tasks use the same status-only plan without image fields', () => {
	const inlineTask = task({ fieldValues: { status: 'Project.Todo' } });
	const fileTask = task({
		primary: { filePath: 'Task.md', lineNumber: 0, format: 'yaml' },
		fieldValues: { status: 'Project.Todo' },
	});
	const planFor = (inputTask: IndexedTask) => buildKanbanWritebackPlan({
		task: inputTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		swimlaneBy: null,
	});
	assert.deepEqual(planFor(inlineTask).payload, { status: 'Project.Doing' });
	assert.deepEqual(planFor(fileTask).payload, { status: 'Project.Doing' });
});

test('Task Image and Gallery metadata do not enter a status-only writeback', () => {
	const plan = buildKanbanWritebackPlan({
		task: task({
			fieldValues: {
				status: 'Project.Todo',
				taskImage: 'Assets/cover.png',
				taskGallery: 'Assets/one.png; Assets/two.png',
			},
		}),
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		swimlaneBy: null,
	});
	assert.deepEqual(plan.payload, { status: 'Project.Doing' });
});

test('scalar and list swimlanes write only on real lane changes', () => {
	const priorityTask = task({ fieldValues: { status: 'Project.Todo', priority: 'High' } });
	const samePriority = buildKanbanWritebackPlan({
		task: priorityTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'High',
		targetLaneKey: 'High',
		swimlaneBy: 'priority',
	});
	assert.deepEqual(samePriority.payload, { status: 'Project.Doing' });

	const clearPriority = buildKanbanWritebackPlan({
		task: priorityTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'High',
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		swimlaneBy: 'priority',
	});
	assert.deepEqual(clearPriority.payload, { status: 'Project.Doing', priority: '' });

	for (const swimlaneBy of ['contexts', 'assignees'] as const) {
		const listTask = task({
			fieldValues: { status: 'Project.Todo', [swimlaneBy]: 'first; lane; last' },
		});
		const moved = buildKanbanWritebackPlan({
			task: listTask,
			pipeline,
			targetStatus: pipeline.statuses[1],
			sourceLaneKey: 'lane',
			targetLaneKey: 'next',
			swimlaneBy,
		});
		assert.equal(moved.payload[swimlaneBy], 'first; last; next');
	}
});

test('custom scalar and list swimlanes preserve unrelated ordered values', () => {
	const mappings = [customMapping('team', 'text'), customMapping('regions', 'list')];
	const customTask = task({
		fieldValues: {
			status: 'Project.Todo',
			team: 'Blue',
			regions: 'north; central; south',
		},
	});
	const scalarPlan = buildKanbanWritebackPlan({
		task: customTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'Blue',
		targetLaneKey: 'Green',
		swimlaneBy: 'team',
		keyMappings: mappings,
	});
	assert.equal(scalarPlan.payload.team, 'Green');

	const listPlan = buildKanbanWritebackPlan({
		task: customTask,
		pipeline,
		targetStatus: pipeline.statuses[1],
		sourceLaneKey: 'central',
		targetLaneKey: 'east',
		swimlaneBy: 'regions',
		keyMappings: mappings,
	});
	assert.equal(listPlan.payload.regions, 'north; south; east');
	assert.equal(listPlan.nextDraft.fieldValues.regions, 'north; south; east');
});

test('only safe transient pre-write failures are retryable', () => {
	assert.equal(shouldRetryKanbanDropTransition(failure('preview', 'live-settling')), true);
	assert.equal(shouldRetryKanbanDropTransition(failure('apply', 'stale-context')), true);
	assert.equal(shouldRetryKanbanDropTransition(failure('apply', 'live-settling')), true);
	assert.equal(shouldRetryKanbanDropTransition(failure('preview', 'stale-context')), false);
	assert.equal(shouldRetryKanbanDropTransition(failure('preview', 'stale-source')), false);
	assert.equal(shouldRetryKanbanDropTransition(failure('apply', 'stale-context', false, 'partial')), false);
	assert.equal(shouldRetryKanbanDropTransition(failure('apply', 'outcome-unknown', true)), false);
	assert.equal(shouldRetryKanbanDropTransition(failure('apply', 'stale-context', true)), false);
});

test('a safe transient failure gets exactly one fresh attempt', async () => {
	let attempts = 0;
	const result = await runKanbanDropTransition(async attemptIndex => {
		attempts += 1;
		return attemptIndex === 0
			? failure('preview', 'live-settling')
			: { ok: true, affectedFilePaths: ['Tasks.md'] };
	});
	assert.equal(result.ok, true);
	assert.equal(attempts, 2);
});

test('uncertain mutation outcomes are never retried', async () => {
	let attempts = 0;
	const result = await runKanbanDropTransition(async () => {
		attempts += 1;
		return failure('apply', 'outcome-unknown', true);
	});
	assert.equal(result.ok, false);
	assert.equal(attempts, 1);
});

test('a second transient failure is returned without a third attempt', async () => {
	let attempts = 0;
	const result = await runKanbanDropTransition(async () => {
		attempts += 1;
		return failure('apply', 'stale-context');
	});
	assert.equal(result.ok, false);
	assert.equal(attempts, 2);
});

test('drag interaction coalesces repeated render requests into one post-drag flush', () => {
	const gate = new KanbanDragInteractionGate();
	assert.equal(gate.isActive(), false);
	gate.begin();
	assert.equal(gate.isActive(), true);
	assert.equal(gate.deferRenderIfActive(), true);
	assert.equal(gate.deferRenderIfActive(), true);
	assert.equal(gate.end(), true);
	assert.equal(gate.isActive(), false);
	assert.equal(gate.end(), false);
});

test('drag interaction ends without a render when no refresh arrived', () => {
	const gate = new KanbanDragInteractionGate();
	gate.begin();
	assert.equal(gate.end(), false);
	assert.equal(gate.deferRenderIfActive(), false);
});

test('manual-order rollback uses expected cells and preserves a newer order', async () => {
	const store = new KanbanOrderStore({} as never, new WriteQueue());
	store.loadFromPackage({ version: 1, boards: { board: { source: ['task-1'], target: [] } } });
	store.setPackagePersistence(async () => {});
	await store.replaceCells('board', { source: [], target: ['task-1'] });
	await store.replaceCells('board', { source: ['task-2'], target: ['task-1'] });
	const rolledBack = await store.replaceCellsIfCurrent(
		'board',
		{ source: [], target: ['task-1'] },
		{ source: ['task-1'], target: [] },
	);
	assert.equal(rolledBack, false);
	assert.deepEqual(store.getBoard('board'), { source: ['task-2'], target: ['task-1'] });
});

test('manual-order persistence failure restores the in-memory board', async () => {
	const store = new KanbanOrderStore({} as never, new WriteQueue());
	store.loadFromPackage({ version: 1, boards: { board: { source: ['task-1'] } } });
	store.setPackagePersistence(async () => {
		throw new Error('persist failed');
	});
	await assert.rejects(
		store.replaceCells('board', { source: [], target: ['task-1'] }),
		/persist failed/u,
	);
	assert.deepEqual(store.getBoard('board'), { source: ['task-1'] });
});
