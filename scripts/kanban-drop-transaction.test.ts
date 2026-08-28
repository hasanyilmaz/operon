import assert from 'node:assert/strict';
import test from 'node:test';
import { TFile } from 'obsidian';
import type { IndexedTask } from '../src/types/fields';
import type { Pipeline } from '../src/types/pipeline';
import { DEFAULT_SETTINGS, type KeyMapping, type OperonSettings } from '../src/types/settings';
import type { ProjectSerialDisplay } from '../src/core/project-serials';
import { tryPatchInlineTaskLineContent } from '../src/core/task-writer';
import { OperonIndexer } from '../src/indexer/indexer';
import {
	attachKanbanDropFailureCause,
	buildKanbanDropBoardSignature,
	buildKanbanDropFailureDiagnostic,
	hasKanbanCompanionPayload,
	KanbanCardOperationRegistry,
	matchesKanbanDropSource,
	runKanbanDropTransition,
	shouldRetryKanbanDropTransition,
	type KanbanDropTransitionResult,
} from '../src/systems/kanban-drop-transaction';
import { buildKanbanWritebackPlan } from '../src/systems/kanban-writeback';
import { KanbanDragInteractionGate, KanbanDropPersistenceGate } from '../src/systems/kanban-drag-interaction';
import {
	applyKanbanOptimisticMovesToBoard,
	createKanbanDropOptimisticMove,
} from '../src/systems/kanban-optimistic-move';
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

test('drop source fence requires the original status and lane', () => {
	assert.equal(matchesKanbanDropSource({
		actualStatusId: 'todo',
		actualStatusValue: 'Project.Todo',
		actualLaneKeys: ['lane-a', 'lane-b'],
		sourceStatusId: 'todo',
		sourceStatusValue: 'Project.Todo',
		sourceLaneKey: 'lane-b',
	}), true);
	assert.equal(matchesKanbanDropSource({
		actualStatusId: 'doing',
		actualStatusValue: 'Project.Doing',
		actualLaneKeys: ['lane-b'],
		sourceStatusId: 'todo',
		sourceStatusValue: 'Project.Todo',
		sourceLaneKey: 'lane-b',
	}), false);
	assert.equal(matchesKanbanDropSource({
		actualStatusId: 'todo',
		actualStatusValue: 'Project.Todo',
		actualLaneKeys: ['lane-c'],
		sourceStatusId: 'todo',
		sourceStatusValue: 'Project.Todo',
		sourceLaneKey: 'lane-b',
	}), false);
	assert.equal(matchesKanbanDropSource({
		actualStatusId: 'todo',
		actualStatusValue: 'Project.Todo',
		actualLaneKeys: ['lane-b'],
		sourceStatusId: null,
		sourceStatusValue: '',
		sourceLaneKey: 'lane-b',
	}), false);
	assert.equal(matchesKanbanDropSource({
		actualStatusId: null,
		actualStatusValue: '',
		actualLaneKeys: ['lane-b'],
		sourceStatusId: null,
		sourceStatusValue: '',
		sourceLaneKey: 'lane-b',
	}), true);
	assert.equal(matchesKanbanDropSource({
		actualStatusId: null,
		actualStatusValue: 'Project.Missing',
		actualLaneKeys: ['lane-b'],
		sourceStatusId: null,
		sourceStatusValue: '',
		sourceLaneKey: 'lane-b',
	}), false);
});

test('card operation ownership serializes drop and status mutations per task without blocking unrelated tasks', () => {
	const registry = new KanbanCardOperationRegistry();
	const first = registry.begin('task-1', 'preset-a', 'drop', 'signature-a');
	assert.ok(first);
	assert.equal(registry.isTaskPending('task-1'), true);
	assert.equal(registry.begin('task-1', 'preset-a', 'status', 'signature-a'), null);
	const unrelated = registry.begin('task-2', 'preset-a', 'status', 'signature-a');
	assert.ok(unrelated);
	assert.equal(registry.owns(first), true);
	assert.equal(registry.end(first), true);
	assert.equal(registry.end(first), false);
	assert.equal(registry.isTaskPending('task-1'), false);
	assert.equal(registry.owns(unrelated), true);
});

test('card operation UI generation fences late callbacks after preset changes', () => {
	const registry = new KanbanCardOperationRegistry();
	const operation = registry.begin('task-1', 'preset-a', 'status', 'signature-a');
	assert.ok(operation);
	assert.equal(registry.isUiCurrent(operation, 'preset-a', 'signature-a'), true);
	assert.equal(registry.isUiCurrent(operation, 'preset-a', 'signature-b'), false);
	registry.invalidateUi();
	assert.equal(registry.owns(operation), true, 'persistence ownership remains until settlement');
	assert.equal(registry.isUiCurrent(operation, 'preset-a', 'signature-a'), false);
	assert.equal(registry.isUiCurrent(operation, 'preset-b', 'signature-a'), false);
	assert.equal(registry.end(operation), true);
	const next = registry.begin('task-1', 'preset-b', 'drop', 'signature-b');
	assert.ok(next);
	assert.notEqual(next.id, operation.id);
	registry.reset();
	assert.equal(registry.owns(next), false);
	const reopened = registry.begin('task-1', 'preset-b', 'status', 'signature-b');
	assert.ok(reopened);
	assert.equal(registry.end(next), false, 'a late callback cannot end a newer operation');
	assert.equal(registry.owns(reopened), true);
});

function createKanbanIndexerHarness(initialContent: string): {
	indexer: OperonIndexer;
	content: { value: string };
	file: TFile;
	readOverride: { value: (() => Promise<string>) | null };
} {
	const filePath = 'Tasks.md';
	const content = { value: initialContent };
	const file = new (TFile as unknown as { new(path: string): TFile })(filePath);
	file.path = filePath;
	file.name = filePath;
	file.basename = 'Tasks';
	file.extension = 'md';
	file.stat = {
		mtime: Date.now(),
		ctime: Date.now(),
		size: initialContent.length,
	};
	const readOverride = { value: null as (() => Promise<string>) | null };
	const app = {
		vault: {
			getMarkdownFiles: () => [file],
			getAbstractFileByPath: (path: string) => path === filePath ? file : null,
			read: async () => readOverride.value ? await readOverride.value() : content.value,
		},
	};
	const settings: OperonSettings = {
		...DEFAULT_SETTINGS,
		indexEventDebounceMs: 0,
		pipelines: [pipeline],
	};
	const storage = {
		getSettings: () => settings,
		saveIndex: async () => undefined,
		loadIndex: async () => null,
	};
	return {
		indexer: new OperonIndexer(app as never, storage as never),
		content,
		file,
		readOverride,
	};
}

function createKanbanMultiSourceHarness(initialFiles: Record<string, string>): {
	indexer: OperonIndexer;
	contents: Map<string, string>;
	files: Map<string, TFile>;
} {
	const contents = new Map(Object.entries(initialFiles));
	const files = new Map<string, TFile>();
	for (const [filePath, source] of contents) {
		const file = new (TFile as unknown as { new(path: string): TFile })(filePath);
		file.path = filePath;
		file.name = filePath.split('/').at(-1) ?? filePath;
		file.basename = file.name.replace(/\.md$/u, '');
		file.extension = 'md';
		file.stat = { mtime: Date.now(), ctime: Date.now(), size: source.length };
		files.set(filePath, file);
	}
	const app = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (filePath: string) => files.get(filePath) ?? null,
			read: async (file: TFile) => contents.get(file.path) ?? '',
		},
	};
	const settings: OperonSettings = {
		...DEFAULT_SETTINGS,
		indexEventDebounceMs: 0,
		pipelines: [pipeline],
	};
	const storage = {
		getSettings: () => settings,
		saveIndex: async () => undefined,
		loadIndex: async () => null,
	};
	return {
		indexer: new OperonIndexer(app as never, storage as never),
		contents,
		files,
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

test('successful bounded-transition warnings survive the retry wrapper unchanged', async () => {
	const warning = {
		code: 'transition-ancestor-unavailable',
		message: 'Transition continued without unavailable ancestor par0001.',
		path: '/target/parentTask',
	};
	const result = await runKanbanDropTransition(async () => ({
		ok: true,
		affectedFilePaths: ['Tasks.md'],
		warnings: [warning],
	}));
	assert.equal(result.ok, true);
	if (result.ok) assert.deepEqual(result.warnings, [warning]);
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

test('automatic-sort diagnostics expose transition evidence without entering manual order', () => {
	const error = attachKanbanDropFailureCause(new Error('drop failed'), {
		phase: 'transition',
		attemptCount: 2,
		stage: 'apply',
		code: 'stale-context',
		mutationMayHaveApplied: false,
		mutationStatus: 'failed',
	});
	assert.deepEqual(buildKanbanDropFailureDiagnostic({
		taskId: 'cbxhyml',
		presetId: 'automatic-board',
		sourceStatusId: 'todo',
		targetStatusId: 'doing',
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		sourceSortMode: 'automatic',
		targetSortMode: 'automatic',
		error,
	}), {
		kind: 'kanban-drop-failure',
		taskId: 'cbxhyml',
		presetId: 'automatic-board',
		sourceStatusId: 'todo',
		targetStatusId: 'doing',
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		sourceSortMode: 'automatic',
		targetSortMode: 'automatic',
		manualOrderPathActive: false,
		failure: {
			kind: 'kanban-drop-failure-cause',
			phase: 'transition',
			attemptCount: 2,
			stage: 'apply',
			code: 'stale-context',
			mutationMayHaveApplied: false,
			mutationStatus: 'failed',
		},
	});
});

test('inline status patch preserves plain, bold, and wikilink descriptions', () => {
	for (const description of ['Task', '**Task**', 'Task with [[Project Alpha]]']) {
		const source = `- [ ] ${description} {{operonId:: cbxhyml}} {{status:: Project.Todo}}`;
		const patch = tryPatchInlineTaskLineContent(
			source,
			'Tasks.md',
			'cbxhyml',
			{ status: 'Project.Doing' },
			0,
			'merge',
		);
		assert.equal(patch.ok, true, description);
		assert.ok(patch.content.includes(description), description);
		assert.match(patch.content, /\{\{status:: Project\.Doing\}\}/u);
	}
});

test('automatic-sort drop lifecycle can join a stale in-flight scan and lose target visibility', async () => {
	const beforeSource = '- [ ] Task with [[Project Alpha]] {{operonId:: cbxhyml}} {{status:: Project.Todo}}';
	const afterSource = '- [ ] Task with [[Project Alpha]] {{operonId:: cbxhyml}} {{status:: Project.Doing}}';
	const harness = createKanbanIndexerHarness(beforeSource);
	await harness.indexer.fullReindex();

	let releaseSlowRead!: () => void;
	let markSlowReadStarted!: () => void;
	const slowReadStarted = new Promise<void>(resolve => { markSlowReadStarted = resolve; });
	const slowReadGate = new Promise<void>(resolve => { releaseSlowRead = resolve; });
	let readCount = 0;
	harness.readOverride.value = async () => {
		readCount += 1;
		const captured = harness.content.value;
		if (readCount === 1) {
			markSlowReadStarted();
			await slowReadGate;
		}
		return captured;
	};

	const staleScan = harness.indexer.reindexFilePath('Tasks.md', { notify: false });
	await slowReadStarted;
	harness.content.value = afterSource;
	harness.file.stat.mtime += 1;
	harness.file.stat.size = afterSource.length;
	const mutationBarrier = harness.indexer.reindexAffectedSources(['Tasks.md'], { notify: false });
	releaseSlowRead();
	await Promise.all([staleScan, mutationBarrier]);

	assert.equal(readCount, 1, 'the mutation barrier joins the stale scan without a fresh source read');
	assert.match(harness.content.value, /\{\{status:: Project\.Doing\}\}/u, 'persisted source reached the target');
	const staleTask = harness.indexer.getTask('cbxhyml');
	assert.equal(staleTask?.fieldValues.status, 'Project.Todo', 'RAM index remains in the source cell');

	const preset = sortingPreset({ id: 'automatic-board' });
	const orderStore = new KanbanOrderStore({} as never, new WriteQueue());
	assert.deepEqual(orderStore.getBoard(preset.id), {}, 'manual-order store stays empty');
	const queryBoard = () => queryKanbanBoard({
		preset,
		pipeline,
		pipelines: [pipeline],
		filterSet: null,
		tasks: harness.indexer.getAllTasks(),
		priorities: [],
	});
	const staleBoard = queryBoard();
	const sourceCell = buildKanbanCellKey('todo', KANBAN_NO_VALUE_KEY);
	const targetCell = buildKanbanCellKey('doing', KANBAN_NO_VALUE_KEY);
	assert.deepEqual(staleBoard.cellMap.get(sourceCell)?.map(item => item.operonId), ['cbxhyml']);
	assert.deepEqual(staleBoard.cellMap.get(targetCell)?.map(item => item.operonId) ?? [], []);

	const context = {
		taskId: 'cbxhyml',
		sourceStatusId: 'todo',
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetStatusId: 'doing',
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		targetBeforeTaskId: null,
		swimlaneBy: null,
	};
	const optimisticMove = createKanbanDropOptimisticMove(context, { task: staleTask });
	applyKanbanOptimisticMovesToBoard(staleBoard, [], [optimisticMove]);
	assert.deepEqual(staleBoard.cellMap.get(targetCell)?.map(item => item.operonId), ['cbxhyml']);
	const rerenderedAfterRejectedDrop = queryBoard();
	assert.deepEqual(
		rerenderedAfterRejectedDrop.cellMap.get(sourceCell)?.map(item => item.operonId),
		['cbxhyml'],
		'removing the optimistic move exposes the stale source cell again',
	);

	const error = attachKanbanDropFailureCause(new Error('target cell not visible'), {
		phase: 'target-postflight',
		attemptCount: 1,
		stage: null,
		code: 'target-cell-not-visible',
		mutationMayHaveApplied: true,
		mutationStatus: null,
	});
	const diagnostic = buildKanbanDropFailureDiagnostic({
		taskId: 'cbxhyml',
		presetId: preset.id,
		sourceStatusId: 'todo',
		targetStatusId: 'doing',
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		sourceSortMode: 'automatic',
		targetSortMode: 'automatic',
		error,
	});
	assert.equal(diagnostic.manualOrderPathActive, false);
	assert.equal(diagnostic.failure?.phase, 'target-postflight');
	assert.equal(diagnostic.failure?.code, 'target-cell-not-visible');

	await harness.indexer.reindexCommittedMutationSources(['Tasks.md'], { notify: false });
	assert.equal(readCount, 2, 'one forced follow-up scan publishes the persisted task state');
	assert.equal(harness.indexer.getTask('cbxhyml')?.fieldValues.status, 'Project.Doing');
});

test('committed-source settlement publishes multiple files in one reconciliation batch', async () => {
	const harness = createKanbanMultiSourceHarness({
		'A.md': '- [ ] First {{operonId:: first01}} {{status:: Project.Todo}}',
		'B.md': '- [ ] Second {{operonId:: second1}} {{status:: Project.Todo}}',
	});
	await harness.indexer.fullReindex();
	for (const [filePath, operonId] of [['A.md', 'first01'], ['B.md', 'second1']] as const) {
		const source = harness.contents.get(filePath)!.replace('Project.Todo', 'Project.Doing');
		harness.contents.set(filePath, source);
		const file = harness.files.get(filePath)!;
		file.stat.mtime += 1;
		file.stat.size = source.length;
		assert.equal(harness.indexer.getTask(operonId)?.fieldValues.status, 'Project.Todo');
	}
	const reconciliations: Array<{ affectedOperonIds: readonly string[] }> = [];
	const unsubscribe = harness.indexer.subscribeIndexReconciliation(event => {
		if (event.kind === 'incremental') reconciliations.push(event);
	});
	try {
		await harness.indexer.reindexCommittedMutationSources(['B.md', 'A.md', 'A.md'], { notify: false });
	} finally {
		unsubscribe();
	}
	assert.equal(harness.indexer.getTask('first01')?.fieldValues.status, 'Project.Doing');
	assert.equal(harness.indexer.getTask('second1')?.fieldValues.status, 'Project.Doing');
	assert.equal(reconciliations.length, 1, 'all committed sources publish one reconciliation event');
	assert.deepEqual([...reconciliations[0]!.affectedOperonIds].sort(), ['first01', 'second1']);
});

test('committed-source settlement does not start a follow-up scan after unload begins', async () => {
	const source = '- [ ] Task {{operonId:: cbxhyml}} {{status:: Project.Todo}}';
	const harness = createKanbanIndexerHarness(source);
	await harness.indexer.fullReindex();
	let releaseSlowRead!: () => void;
	let markSlowReadStarted!: () => void;
	const slowReadStarted = new Promise<void>(resolve => { markSlowReadStarted = resolve; });
	const slowReadGate = new Promise<void>(resolve => { releaseSlowRead = resolve; });
	let readCount = 0;
	harness.readOverride.value = async () => {
		readCount += 1;
		if (readCount === 1) {
			markSlowReadStarted();
			await slowReadGate;
		}
		return source;
	};
	const existingScan = harness.indexer.reindexFilePath('Tasks.md', { notify: false });
	await slowReadStarted;
	const committedBarrier = harness.indexer.reindexCommittedMutationSources(['Tasks.md'], { notify: false });
	harness.indexer.beginUnload();
	releaseSlowRead();
	await Promise.all([existingScan, committedBarrier]);
	assert.equal(readCount, 1, 'shutdown prevents a fresh scan after the joined flight settles');
});

test('manual-sort diagnostics identify the manual-order path without inventing a Runtime failure', () => {
	const diagnostic = buildKanbanDropFailureDiagnostic({
		taskId: 'task-1',
		presetId: 'manual-board',
		sourceStatusId: 'todo',
		targetStatusId: 'doing',
		sourceLaneKey: KANBAN_NO_VALUE_KEY,
		targetLaneKey: KANBAN_NO_VALUE_KEY,
		sourceSortMode: 'automatic',
		targetSortMode: 'manual',
		error: new Error('manual order failed'),
	});
	assert.equal(diagnostic.manualOrderPathActive, true);
	assert.equal(diagnostic.failure, null);
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

test('mobile drop persistence blocks refresh until a successful write settles', async () => {
	const gate = new KanbanDropPersistenceGate();
	let refreshes = 0;
	const flush = (): void => {
		if (!gate.isActive()) refreshes += 1;
	};
	gate.begin();
	const write = Promise.resolve().finally(() => {
		if (gate.end()) flush();
	});
	flush();
	assert.equal(refreshes, 0);
	await write;
	assert.equal(refreshes, 1);
});

test('mobile drop persistence releases refresh after a failed write', async () => {
	const gate = new KanbanDropPersistenceGate();
	let refreshes = 0;
	gate.begin();
	const write = Promise.reject(new Error('write failed')).finally(() => {
		if (gate.end()) refreshes += 1;
	});
	assert.equal(gate.isActive(), true);
	await assert.rejects(write, /write failed/u);
	assert.equal(gate.isActive(), false);
	assert.equal(refreshes, 1);
});

test('overlapping mobile drops flush refresh once after the final write settles', () => {
	const gate = new KanbanDropPersistenceGate();
	let refreshes = 0;
	gate.begin();
	gate.begin();
	if (gate.end()) refreshes += 1;
	assert.equal(gate.isActive(), true);
	assert.equal(refreshes, 0);
	if (gate.end()) refreshes += 1;
	assert.equal(gate.isActive(), false);
	assert.equal(refreshes, 1);
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

test('drop board signature changes with same-ID mutation semantics', () => {
	const base = sortingPreset();
	const baseSignature = buildKanbanDropBoardSignature(base, pipeline);
	assert.notEqual(
		buildKanbanDropBoardSignature({ ...base, swimlaneBy: 'priority' }, pipeline),
		baseSignature,
	);
	assert.notEqual(
		buildKanbanDropBoardSignature({ ...base, sortMode: 'manual' }, pipeline),
		baseSignature,
	);
	assert.notEqual(
		buildKanbanDropBoardSignature(base, {
			...pipeline,
			statuses: pipeline.statuses.map(status => status.id === 'doing'
				? { ...status, label: 'In progress' }
				: status),
		}),
		baseSignature,
	);
});

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
	} else if (field !== 'alphabetical' && field !== 'projectSerial') {
		low.fieldValues[field] = '10';
		high.fieldValues[field] = '20';
	}
	return [low, high];
}

test('every built-in Kanban sort field honors ascending and descending order', () => {
	assert.equal(KANBAN_BUILT_IN_SORT_FIELDS.length, 15);
	for (const field of KANBAN_BUILT_IN_SORT_FIELDS) {
		const [low, high] = builtInSortPair(field);
		for (const direction of ['asc', 'desc'] as const) {
			const comparator = buildKanbanTaskComparator({
				preset: sortingPreset({ sortRules: [{ field, direction, empty: 'last' }] }),
				priorities: [{ label: 'Low' }, { label: 'High' }],
				getProjectSerialDisplay: operonId => field === 'projectSerial'
					? projectSerialDisplay(operonId, 'PROD', operonId.endsWith('-low') ? 2 : 10)
					: null,
			});
			const actual = [high, low].sort(comparator).map(item => item.operonId);
			const expected = direction === 'asc'
				? [`${field}-low`, `${field}-high`]
				: [`${field}-high`, `${field}-low`];
			assert.deepEqual(actual, expected, `${field}:${direction}`);
		}
	}
});

test('Project Serial sorting compares prefix then numeric assignment and preserves empty placement', () => {
	const tasks = [
		task({ operonId: 'prod-10', description: 'Same', fieldValues: { status: 'Project.Todo' } }),
		task({ operonId: 'empty', description: 'Same', fieldValues: { status: 'Project.Todo' } }),
		task({ operonId: 'alpha-5', description: 'Same', fieldValues: { status: 'Project.Todo' } }),
		task({ operonId: 'prod-2', description: 'Same', fieldValues: { status: 'Project.Todo' } }),
	];
	const displays = new Map<string, ProjectSerialDisplay>([
		['prod-10', projectSerialDisplay('prod-10', 'PROD', 10)],
		['alpha-5', projectSerialDisplay('alpha-5', 'Alpha', 5)],
		['prod-2', projectSerialDisplay('prod-2', 'prod', 2)],
	]);
	const getProjectSerialDisplay = (operonId: string): ProjectSerialDisplay | null => displays.get(operonId) ?? null;
	const ascending = buildKanbanTaskComparator({
		preset: sortingPreset({ sortRules: [{ field: 'projectSerial', direction: 'asc', empty: 'last' }] }),
		priorities: [],
		getProjectSerialDisplay,
	});
	assert.deepEqual([...tasks].sort(ascending).map(item => item.operonId), ['alpha-5', 'prod-2', 'prod-10', 'empty']);
	const board = queryKanbanBoard({
		preset: sortingPreset({ sortRules: [{ field: 'projectSerial', direction: 'asc', empty: 'last' }] }),
		pipeline,
		pipelines: [pipeline],
		filterSet: null,
		tasks,
		priorities: [],
		getProjectSerialDisplay,
	});
	assert.deepEqual(
		board.cellMap.get(buildKanbanCellKey('todo', KANBAN_NO_VALUE_KEY))?.map(item => item.operonId),
		['alpha-5', 'prod-2', 'prod-10', 'empty'],
	);
	const descending = buildKanbanTaskComparator({
		preset: sortingPreset({ sortRules: [{ field: 'projectSerial', direction: 'desc', empty: 'first' }] }),
		priorities: [],
		getProjectSerialDisplay,
	});
	assert.deepEqual([...tasks].sort(descending).map(item => item.operonId), ['empty', 'prod-10', 'prod-2', 'alpha-5']);
});

function projectSerialDisplay(operonId: string, scopePrefix: string, number: number): ProjectSerialDisplay {
	return {
		scopeId: `scope-${scopePrefix.toLocaleLowerCase()}`,
		scopePrefix,
		parentOperonId: 'parent',
		number,
		label: `${scopePrefix}-${number}`,
		operonId,
	};
}

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

test('Kanban datetime sorting uses strict local timestamps and treats invalid values as empty', () => {
	const dateOnly = task({ operonId: 'date-only', description: 'Same', fieldValues: { status: 'Project.Todo', datetimeCreated: '2026-08-22' } });
	const timed = task({ operonId: 'timed', description: 'Same', fieldValues: { status: 'Project.Todo', datetimeCreated: '2026-08-22T01:00:00' } });
	const invalid = task({ operonId: 'invalid', description: 'Same', fieldValues: { status: 'Project.Todo', datetimeCreated: '2026-02-30T09:00:00' } });
	const comparator = buildKanbanTaskComparator({
		preset: sortingPreset({ sortRules: [{ field: 'datetimeCreated', direction: 'asc', empty: 'last' }] }),
		priorities: [],
	});
	assert.deepEqual([invalid, timed, dateOnly].sort(comparator).map(item => item.operonId), ['date-only', 'timed', 'invalid']);

	const zonedEarlier = task({ operonId: 'zoned-earlier', description: 'Same', fieldValues: { status: 'Project.Todo', datetimeCreated: '2026-08-22T09:00:00.500Z' } });
	const zonedLater = task({ operonId: 'zoned-later', description: 'Same', fieldValues: { status: 'Project.Todo', datetimeCreated: '2026-08-22T12:00:00+02:00' } });
	assert.deepEqual([zonedLater, zonedEarlier].sort(comparator).map(item => item.operonId), ['zoned-earlier', 'zoned-later']);
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
