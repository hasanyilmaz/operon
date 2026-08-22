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
import { buildKanbanCellKey, buildKanbanTaskComparator, KANBAN_NO_VALUE_KEY, queryKanbanBoard } from '../src/systems/kanban-query';
import {
	KANBAN_BUILT_IN_SORT_FIELDS,
	reconcileKanbanColumnSortOverrides,
	type BuiltInKanbanSortField,
	type KanbanPreset,
} from '../src/types/kanban';
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

function sortingPreset(overrides: Partial<KanbanPreset> = {}): KanbanPreset {
	return {
		id: 'board',
		name: 'Board',
		pipelineId: pipeline.id,
		filterSetId: null,
		swimlaneBy: null,
		colorSource: 'noColor',
		cardImageSource: 'none',
		appearanceModeLight: 'theme',
		appearanceModeDark: 'theme',
		collapseEmptyColumns: false,
		collapseEmptySwimlanes: false,
		autoCollapseFinishedColumns: false,
		sortMode: 'automatic',
		sortRules: [{ field: 'alphabetical', direction: 'asc', empty: 'last' }],
		columnSortOverrides: [],
		...overrides,
	};
}

test('column automatic sorting overrides board sorting only for its status', () => {
	const preset = sortingPreset({
		columnSortOverrides: [{
			statusId: 'doing',
			sortMode: 'automatic',
			sortRules: [{ field: 'alphabetical', direction: 'desc', empty: 'last' }],
		}],
	});
	const board = queryKanbanBoard({
		preset,
		pipeline,
		pipelines: [pipeline],
		filterSet: null,
		tasks: [
			task({ operonId: 'todo-b', description: 'Beta', fieldValues: { status: 'Project.Todo' } }),
			task({ operonId: 'todo-a', description: 'Alpha', fieldValues: { status: 'Project.Todo' } }),
			task({ operonId: 'doing-a', description: 'Alpha', fieldValues: { status: 'Project.Doing' } }),
			task({ operonId: 'doing-b', description: 'Beta', fieldValues: { status: 'Project.Doing' } }),
		],
		priorities: [],
	});
	assert.deepEqual(board.cellMap.get(buildKanbanCellKey('todo', KANBAN_NO_VALUE_KEY))?.map(item => item.operonId), ['todo-a', 'todo-b']);
	assert.deepEqual(board.cellMap.get(buildKanbanCellKey('doing', KANBAN_NO_VALUE_KEY))?.map(item => item.operonId), ['doing-b', 'doing-a']);
});

function builtInSortPair(field: BuiltInKanbanSortField): [IndexedTask, IndexedTask] {
	const low = task({
		operonId: `${field}-low`,
		description: field === 'alphabetical' ? 'Alpha' : 'Same',
		fieldValues: { status: 'Project.Todo' },
	});
	const high = task({
		operonId: `${field}-high`,
		description: field === 'alphabetical' ? 'Zulu' : 'Same',
		fieldValues: { status: 'Project.Todo' },
	});
	if (field === 'priority') {
		low.fieldValues.priority = 'Low';
		high.fieldValues.priority = 'High';
	} else if (field === 'datetimeModified') {
		low.datetimeModified = '2026-08-22T09:00:00';
		high.datetimeModified = '2026-08-22T17:00:00';
	} else if (field === 'datetimeCreated') {
		low.fieldValues.datetimeCreated = '2026-08-22T09:00:00';
		high.fieldValues.datetimeCreated = '2026-08-22T17:00:00';
	} else if (field.startsWith('date')) {
		low.fieldValues[field] = '2026-08-22';
		high.fieldValues[field] = '2026-08-23';
	} else if (field !== 'alphabetical') {
		low.fieldValues[field] = '10';
		high.fieldValues[field] = '20';
	}
	return [low, high];
}

test('every built-in Kanban sort field honors ascending and descending order', () => {
	assert.equal(KANBAN_BUILT_IN_SORT_FIELDS.length, 14);
	for (const field of KANBAN_BUILT_IN_SORT_FIELDS) {
		const [low, high] = builtInSortPair(field);
		for (const direction of ['asc', 'desc'] as const) {
			const comparator = buildKanbanTaskComparator({
				preset: sortingPreset({ sortRules: [{ field, direction, empty: 'last' }] }),
				priorities: [{ label: 'Low' }, { label: 'High' }],
			});
			const actual = [high, low].sort(comparator).map(item => item.operonId);
			const expected = direction === 'asc'
				? [`${field}-low`, `${field}-high`]
				: [`${field}-high`, `${field}-low`];
			assert.deepEqual(actual, expected, `${field}:${direction}`);
		}
	}
});

test('Kanban sort empty placement honors First and Last independently of direction', () => {
	const empty = task({ operonId: 'empty', description: 'Same', fieldValues: { status: 'Project.Todo' } });
	const present = task({
		operonId: 'present',
		description: 'Same',
		fieldValues: { status: 'Project.Todo', dateDue: '2026-08-22' },
	});
	for (const direction of ['asc', 'desc'] as const) {
		for (const placement of ['first', 'last'] as const) {
			const comparator = buildKanbanTaskComparator({
				preset: sortingPreset({ sortRules: [{ field: 'dateDue', direction, empty: placement }] }),
				priorities: [],
			});
			const actual = [present, empty].sort(comparator).map(item => item.operonId);
			assert.deepEqual(actual, placement === 'first' ? ['empty', 'present'] : ['present', 'empty']);
		}
	}
});

test('column manual sorting consumes manual order without affecting automatic columns', () => {
	const preset = sortingPreset({
		columnSortOverrides: [{
			statusId: 'doing',
			sortMode: 'manual',
			sortRules: [{ field: 'alphabetical', direction: 'asc', empty: 'last' }],
		}],
	});
	const doingKey = buildKanbanCellKey('doing', KANBAN_NO_VALUE_KEY);
	const board = queryKanbanBoard({
		preset,
		pipeline,
		pipelines: [pipeline],
		filterSet: null,
		tasks: [
			task({ operonId: 'todo-b', description: 'Beta', fieldValues: { status: 'Project.Todo' } }),
			task({ operonId: 'todo-a', description: 'Alpha', fieldValues: { status: 'Project.Todo' } }),
			task({ operonId: 'doing-a', description: 'Alpha', fieldValues: { status: 'Project.Doing' } }),
			task({ operonId: 'doing-b', description: 'Beta', fieldValues: { status: 'Project.Doing' } }),
		],
		priorities: [],
		manualOrder: { [doingKey]: ['doing-b', 'doing-a'] },
	});
	assert.deepEqual(board.cellMap.get(buildKanbanCellKey('todo', KANBAN_NO_VALUE_KEY))?.map(item => item.operonId), ['todo-a', 'todo-b']);
	assert.deepEqual(board.cellMap.get(doingKey)?.map(item => item.operonId), ['doing-b', 'doing-a']);
});

test('column override reconciliation deduplicates, removes stale statuses and follows pipeline order', () => {
	const rule = [{ field: 'alphabetical', direction: 'asc', empty: 'last' }] as const;
	const overrides = reconcileKanbanColumnSortOverrides([
		{ statusId: 'doing', sortMode: 'automatic', sortRules: [...rule] },
		{ statusId: 'todo', sortMode: 'manual', sortRules: [...rule] },
		{ statusId: 'doing', sortMode: 'manual', sortRules: [...rule] },
		{ statusId: 'stale', sortMode: 'automatic', sortRules: [...rule] },
	], ['todo', 'doing']);
	assert.deepEqual(overrides.map(override => [override.statusId, override.sortMode]), [
		['todo', 'manual'],
		['doing', 'automatic'],
	]);
});
