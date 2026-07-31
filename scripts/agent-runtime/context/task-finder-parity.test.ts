import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { decodeTaskFinderRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import { buildLivePropertyCatalogV1 } from '../../../src/agent-runtime/runtime/catalog-builder';
import {
	LiveIndexContextProviderV1,
	type IndexContextReadPortV1,
} from '../../../src/agent-runtime/runtime/context-provider';
import { validateTaskFinderRequestV1 } from '../../../src/agent-runtime/runtime/context-request-validator';
import { RuntimeSourceHydratorV1 } from '../../../src/agent-runtime/runtime/context-source';
import {
	rankTaskSearchResults,
} from '../../../src/systems/task-search';
import type {
	IndexedTask,
	IndexedTaskInstance,
} from '../../../src/types/fields';
import {
	DEFAULT_SETTINGS,
	type OperonSettings,
} from '../../../src/types/settings';

declare global {
	var __operonAgentRuntimeTaskFinderParityTestRun: Promise<void> | undefined;
}

globalThis.__operonAgentRuntimeTaskFinderParityTestRun = Promise.resolve().then(run);

function run(): void {
	testRequestValidationParity();
	testNativeRankingParity();
	testRepresentationAndSpecialScopes();
	testProjectDirectAndTreeModes();
	testPunctuationAndDeterministicTies();
	testGenerationAndMappingCacheInvalidation();
	testFinderPerformanceGate();
	console.log('Agent Runtime Task Finder parity tests passed');
}

function testRequestValidationParity(): void {
	const valid = {
		contractVersion: 1,
		requestId: 'finder-validation',
		kind: 'task-finder',
		consistency: 'live-verified',
		representations: ['inline'],
	};
	assert.equal(decodeTaskFinderRequestV1(valid).ok, true);
	assert.equal(validateTaskFinderRequestV1(valid).ok, true);
	const selectedProject = {
		...valid,
		project: { mode: 'tree', rootOperonId: 'proj001' },
	};
	assert.equal(decodeTaskFinderRequestV1(selectedProject).ok, true);
	assert.equal(validateTaskFinderRequestV1(selectedProject).ok, true);
	for (const representations of [[], ['inline', 'inline']]) {
		const candidate = { ...valid, representations };
		assert.equal(decodeTaskFinderRequestV1(candidate).ok, false);
		assert.equal(validateTaskFinderRequestV1(candidate).ok, false);
	}
}

function testNativeRankingParity(): void {
	const fixture = createFixture();
	const request = {
		contractVersion: 1 as const,
		requestId: 'finder-native-parity',
		kind: 'task-finder' as const,
		consistency: 'live-verified' as const,
		text: 'release',
		filters: { checkbox: ['open' as const] },
		scope: 'normal' as const,
	};
	const runtime = fixture.provider.queryFinder(request, 250, fixture.asOf, 0);
	const native = rankTaskSearchResults({
		tasks: fixture.tasks.filter(task => task.checkbox === 'open'),
		query: 'release',
		includeAllTasks: true,
		keyMappings: fixture.settings.keyMappings,
	});
	assert.deepEqual(
		runtime.rows.map(row => [row.task.operonId, row.score]),
		native.map(row => [row.task.operonId, row.score]),
		'Runtime Finder must preserve the native matcher, score, and total order.',
	);
}

function testRepresentationAndSpecialScopes(): void {
	const fixture = createFixture();
	const base = {
		contractVersion: 1 as const,
		kind: 'task-finder' as const,
		consistency: 'live-verified' as const,
		filters: { checkbox: ['open' as const] },
	};
	const inline = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-inline',
		representations: ['inline'],
	}, 250, fixture.asOf, 0);
	assert.ok(inline.rows.every(row => row.task.primary.format === 'inline'));

	const file = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-file',
		representations: ['file'],
	}, 250, fixture.asOf, 0);
	assert.deepEqual(file.rows.map(row => row.task.operonId), ['file001', 'proj001']);

	const overdue = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-overdue',
		scope: 'overdue',
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		overdue.rows.map(row => row.task.operonId),
		['proj001', 'grand001', 'child001', 'over001', 'over002'],
		'Overdue Finder order must use oldest date before live priority order.',
	);

	const today = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-today',
		scope: 'happens-today',
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		today.rows.map(row => row.task.operonId),
		['today01', 'today02', 'today03'],
		'Today scope must preserve due, scheduled, then started category order.',
	);

	const recent = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-recent',
		scope: 'recent',
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		recent.rows.slice(0, 3).map(row => row.task.operonId),
		['recent2', 'child001', 'recent1'],
		'Recent scope must order by newest modification first.',
	);

	const rankedWithinScope = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-overdue-ranked-text',
		scope: 'overdue',
		text: 'overdue',
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		new Set(rankedWithinScope.rows.map(row => row.task.operonId)),
		new Set(['over001', 'over002']),
		'Text search must retain special-scope filtering while switching to native ranked ordering.',
	);
}

function testProjectDirectAndTreeModes(): void {
	const fixture = createFixture();
	const base = {
		contractVersion: 1 as const,
		kind: 'task-finder' as const,
		consistency: 'live-verified' as const,
		filters: { checkbox: ['open' as const] },
		scope: 'normal' as const,
	};
	const candidates = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-project-candidates',
		project: { mode: 'tree' as const },
	}, 250, fixture.asOf, 0);
	const project = candidates.rows.find(row => (
		row.kind === 'project' && row.task.operonId === 'proj001'
	));
	assert.ok(project && project.kind === 'project');
	assert.equal(project.directTaskCount, 1);
	assert.equal(project.treeTaskCount, 2);
	assert.equal(project.visibleDirectTaskCount, 2);
	assert.equal(project.visibleTreeTaskCount, 3);

	const direct = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-project-direct',
		project: { mode: 'direct' as const, rootOperonId: 'proj001' },
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		new Set(direct.rows.map(row => row.task.operonId)),
		new Set(['proj001', 'child001']),
	);

	const tree = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-project-tree',
		project: { mode: 'tree' as const, rootOperonId: 'proj001' },
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		new Set(tree.rows.map(row => row.task.operonId)),
		new Set(['proj001', 'child001', 'grand001']),
	);

	const selectedProjectOverdue = fixture.provider.queryFinder({
		...base,
		requestId: 'finder-project-overdue',
		scope: 'overdue',
		project: { mode: 'tree' as const, rootOperonId: 'proj001' },
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		selectedProjectOverdue.rows.map(row => row.task.operonId),
		['child001', 'grand001', 'proj001'],
		'Selected-project Overdue scope must filter the corpus but retain native empty-query rank order.',
	);
}

function testPunctuationAndDeterministicTies(): void {
	const fixture = createFixture();
	const punctuation = fixture.provider.queryFinder({
		contractVersion: 1,
		requestId: 'finder-punctuation',
		kind: 'task-finder',
		consistency: 'live-verified',
		text: '--',
		scope: 'normal',
	}, 250, fixture.asOf, 0);
	assert.equal(punctuation.actualCount, 0);
	assert.deepEqual(punctuation.rows, []);

	const first = fixture.provider.queryFinder({
		contractVersion: 1,
		requestId: 'finder-ties-1',
		kind: 'task-finder',
		consistency: 'live-verified',
		text: 'same',
		scope: 'normal',
	}, 250, fixture.asOf, 0);
	fixture.index.reverseInsertionOrder();
	fixture.index.generation += 1;
	const second = fixture.provider.queryFinder({
		contractVersion: 1,
		requestId: 'finder-ties-2',
		kind: 'task-finder',
		consistency: 'live-verified',
		text: 'same',
		scope: 'normal',
	}, 250, fixture.asOf, 0);
	assert.deepEqual(
		second.rows.map(row => row.task.operonId),
		first.rows.map(row => row.task.operonId),
		'Finder order must not inherit RAM Map insertion order.',
	);
}

function testGenerationAndMappingCacheInvalidation(): void {
	const fixture = createFixture();
	const request = {
		contractVersion: 1 as const,
		requestId: 'finder-cache',
		kind: 'task-finder' as const,
		consistency: 'live-verified' as const,
		text: 'release',
		scope: 'normal' as const,
	};
	fixture.provider.queryFinder(request, 10, fixture.asOf, 0);
	const coldReads = fixture.index.allTaskReads;
	fixture.provider.queryFinder({ ...request, requestId: 'finder-cache-warm' }, 10, fixture.asOf, 0);
	assert.equal(
		fixture.index.allTaskReads,
		coldReads,
		'Warm same-generation Finder requests must reuse the bounded Runtime corpus cache.',
	);

	fixture.index.generation += 1;
	fixture.provider.queryFinder({ ...request, requestId: 'finder-cache-generation' }, 10, fixture.asOf, 0);
	assert.equal(fixture.index.allTaskReads, coldReads + 1);

	fixture.settings.keyMappings = [
		...fixture.settings.keyMappings,
			{
				canonicalKey: 'phase8FinderKey',
				visiblePropertyName: 'Phase8FinderKey',
				type: 'text',
				sync: 'yes',
				enabled: true,
				isSystem: false,
			},
	];
	fixture.provider.queryFinder({ ...request, requestId: 'finder-cache-mapping' }, 10, fixture.asOf, 0);
	assert.equal(
		fixture.index.allTaskReads,
		coldReads + 2,
		'Key-mapping changes must invalidate cached Finder documents and score projections.',
	);

	const recentRequest = {
		...request,
		requestId: 'finder-cache-recent-before',
		text: undefined,
		scope: 'recent' as const,
	};
	const recentBefore = fixture.provider.queryFinder(recentRequest, 250, fixture.asOf, 0);
	const readsBeforeRecentChange = fixture.index.allTaskReads;
	fixture.settings.taskFinderRecentModifiedDays = 1;
	const recentAfter = fixture.provider.queryFinder({
		...recentRequest,
		requestId: 'finder-cache-recent-after',
	}, 250, fixture.asOf, 0);
	assert.ok(recentAfter.actualCount < recentBefore.actualCount);
	assert.equal(fixture.index.allTaskReads, readsBeforeRecentChange + 1);

	const overdueRequest = {
		...request,
		requestId: 'finder-cache-priority-before',
		text: undefined,
		scope: 'overdue' as const,
	};
	const priorityBefore = fixture.provider.queryFinder(overdueRequest, 250, fixture.asOf, 0);
	fixture.settings.priorities.reverse();
	fixture.refreshCatalog();
	const priorityAfter = fixture.provider.queryFinder({
		...overdueRequest,
		requestId: 'finder-cache-priority-after',
	}, 250, fixture.asOf, 0);
	assert.ok(
		priorityBefore.rows.findIndex(row => row.task.operonId === 'child001')
			< priorityBefore.rows.findIndex(row => row.task.operonId === 'over001'),
	);
	assert.ok(
		priorityAfter.rows.findIndex(row => row.task.operonId === 'over001')
			< priorityAfter.rows.findIndex(row => row.task.operonId === 'child001'),
		'Catalog priority-order changes must invalidate cached Finder ordering.',
	);
}

function testFinderPerformanceGate(): void {
	const tasks = Array.from({ length: 5_359 }, (_, index) => task(
		index.toString(36).padStart(7, '0'),
		`Release planning task ${index}`,
		'open',
		index % 8 === 0 ? 'yaml' : 'inline',
		'',
		'High',
		`2026-07-${String(1 + (index % 24)).padStart(2, '0')}T09:00:00.000Z`,
		Object.fromEntries(Array.from(
			{ length: 16 },
			(_, fieldIndex) => [`customField${fieldIndex}`, `value-${index}-${fieldIndex}`],
		)),
	));
	const request = {
		contractVersion: 1 as const,
		requestId: 'finder-performance',
		kind: 'task-finder' as const,
		consistency: 'live-verified' as const,
		text: 'release planning',
		filters: { checkbox: ['open' as const] },
		scope: 'normal' as const,
		limit: 50,
	};
	const coldSamples = Array.from({ length: 7 }, (_, index) => {
		const fixture = createFixtureFromTasks(tasks);
		const started = performance.now();
		fixture.provider.queryFinder({ ...request, requestId: `finder-cold-${index}` }, 250, fixture.asOf, 0);
		return performance.now() - started;
	});
	const warmFixture = createFixtureFromTasks(tasks);
	warmFixture.provider.queryFinder({ ...request, requestId: 'finder-warm-prime' }, 250, warmFixture.asOf, 0);
	const warmSamples = Array.from({ length: 25 }, (_, index) => {
		const started = performance.now();
		const asOf = new Date(Date.parse(warmFixture.asOf) + index + 1).toISOString();
		warmFixture.provider.queryFinder({ ...request, requestId: `finder-warm-${index}` }, 250, asOf, 0);
		return performance.now() - started;
	});
	const coldMedian = percentile(coldSamples, 0.5);
	const warmMedian = percentile(warmSamples, 0.5);
	const warmP95 = percentile(warmSamples, 0.95);
	const performanceMode = process.env.OPERON_TASK_FINDER_PERFORMANCE_MODE ?? 'enforce';
	assert.match(
		performanceMode,
		/^(?:diagnostic|enforce)$/u,
		'OPERON_TASK_FINDER_PERFORMANCE_MODE must be diagnostic or enforce.',
	);
	const thresholdsPassed = coldMedian < 150
		&& warmMedian < 75
		&& warmP95 < 125
		&& warmMedian <= coldMedian * 0.35;
	if (performanceMode === 'enforce') {
		assert.ok(coldMedian < 150, `Cold Finder median ${coldMedian.toFixed(2)} ms exceeded 150 ms.`);
		assert.ok(warmMedian < 75, `Warm Finder median ${warmMedian.toFixed(2)} ms exceeded 75 ms.`);
		assert.ok(warmP95 < 125, `Warm Finder p95 ${warmP95.toFixed(2)} ms exceeded 125 ms.`);
		assert.ok(
			warmMedian <= coldMedian * 0.35,
			`Warm Finder median ${warmMedian.toFixed(2)} ms exceeded 35% of cold ${coldMedian.toFixed(2)} ms.`,
		);
	}
	console.log(JSON.stringify({
		taskFinderPerformance: {
			corpus: tasks.length,
			mode: performanceMode,
			thresholdsPassed,
			coldMedianMs: Number(coldMedian.toFixed(2)),
			warmMedianMs: Number(warmMedian.toFixed(2)),
			warmP95Ms: Number(warmP95.toFixed(2)),
			warmToColdRatio: Number((warmMedian / coldMedian).toFixed(3)),
		},
	}));
}

function percentile(samples: readonly number[], ratio: number): number {
	const sorted = [...samples].sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? Number.POSITIVE_INFINITY;
}

interface FinderFixture {
	provider: LiveIndexContextProviderV1;
	index: FinderIndex;
	settings: OperonSettings;
	tasks: IndexedTask[];
	asOf: string;
	refreshCatalog(): void;
}

function createFixture(): FinderFixture {
	const settings: OperonSettings = structuredClone(DEFAULT_SETTINGS);
	settings.taskFinderRecentModifiedDays = 3;
	const high = settings.priorities[0]?.label ?? 'High';
	const low = settings.priorities.at(-1)?.label ?? high;
	const tasks = [
		task('release1', 'Release notes', 'open', 'inline', '', high, '2026-07-24T09:00:00.000Z'),
		task('release2', 'Draft release plan', 'open', 'inline', '', low, '2026-07-23T09:00:00.000Z'),
		task('file001', 'Release file task', 'open', 'yaml', '', high, '2026-07-22T09:00:00.000Z'),
		task('over001', 'Old overdue', 'open', 'inline', '', low, '2026-07-20T09:00:00.000Z', {
			dateDue: '2026-07-20',
		}),
		task('over002', 'New overdue', 'open', 'inline', '', high, '2026-07-21T09:00:00.000Z', {
			dateDue: '2026-07-21',
		}),
		task('future01', 'Future overdue wording', 'open', 'inline', '', high, '2026-07-24T09:00:00.000Z', {
			dateDue: '2026-07-28',
		}),
		task('today01', 'Due today', 'open', 'inline', '', low, '2026-07-21T09:00:00.000Z', {
			dateDue: '2026-07-25',
		}),
		task('today02', 'Scheduled today', 'open', 'inline', '', high, '2026-07-22T09:00:00.000Z', {
			dateScheduled: '2026-07-25',
		}),
		task('today03', 'Started today', 'open', 'inline', '', high, '2026-07-23T09:00:00.000Z', {
			dateStarted: '2026-07-25',
		}),
		task('recent1', 'Recent one', 'open', 'inline', '', high, '2026-07-24T10:00:00.000Z'),
		task('recent2', 'Recent two', 'open', 'inline', '', high, '2026-07-25T10:00:00.000Z'),
		task('proj001', 'Project root', 'open', 'yaml', '', high, '2026-07-20T10:00:00.000Z', {
			dateDue: '2026-07-18',
		}),
		task('child001', 'Project child', 'open', 'inline', 'proj001', high, '2026-07-24T10:00:00.000Z', {
			dateDue: '2026-07-20',
		}),
		task('grand001', 'Project grandchild', 'open', 'inline', 'child001', high, '2026-07-23T10:00:00.000Z', {
			dateDue: '2026-07-19',
		}),
		task('same001', 'Same task', 'open', 'inline', '', high, '2026-07-20T10:00:00.000Z'),
		task('same002', 'Same task', 'open', 'inline', '', high, '2026-07-20T10:00:00.000Z'),
	];
	const index = new FinderIndex(tasks);
	const catalog = buildLivePropertyCatalogV1(settings);
	assert.equal(catalog.ok, true);
	if (!catalog.ok) throw new Error('The Task Finder parity catalog fixture is invalid.');
	let catalogValue = catalog.value;
	const provider = new LiveIndexContextProviderV1(
		index,
		{
			isPinned: () => false,
			getActiveTrackerTaskId: () => null,
		},
		new RuntimeSourceHydratorV1({
			read: async () => null,
		}),
		() => settings,
		() => catalogValue,
	);
	return {
		provider,
		index,
		settings,
		tasks,
		asOf: '2026-07-25T12:00:00.000Z',
		refreshCatalog(): void {
			const refreshed = buildLivePropertyCatalogV1(settings);
			assert.equal(refreshed.ok, true);
			if (!refreshed.ok) throw new Error('The refreshed Task Finder parity catalog is invalid.');
			catalogValue = refreshed.value;
		},
	};
}

function createFixtureFromTasks(tasks: IndexedTask[]): FinderFixture {
	const settings: OperonSettings = structuredClone(DEFAULT_SETTINGS);
	const index = new FinderIndex(tasks);
	const catalog = buildLivePropertyCatalogV1(settings);
	assert.equal(catalog.ok, true);
	if (!catalog.ok) throw new Error('The Task Finder performance catalog fixture is invalid.');
	return {
		provider: new LiveIndexContextProviderV1(
			index,
			{
				isPinned: () => false,
				getActiveTrackerTaskId: () => null,
			},
			new RuntimeSourceHydratorV1({
				read: async () => null,
			}),
			() => settings,
			() => catalog.value,
		),
		index,
		settings,
		tasks,
		asOf: '2026-07-25T12:00:00.000Z',
		refreshCatalog(): void {
			// Performance fixtures do not mutate their settings.
		},
	};
}

class FinderIndex implements IndexContextReadPortV1 {
	generation = 7;
	allTaskReads = 0;
	private tasks: IndexedTask[];

	constructor(tasks: readonly IndexedTask[]) {
		this.tasks = [...tasks];
	}

	reverseInsertionOrder(): void {
		this.tasks.reverse();
	}

	getTaskSnapshot(operonId: string): IndexedTask | undefined {
		return this.tasks.find(taskValue => taskValue.operonId === operonId);
	}

	getAllTaskSnapshots(): readonly IndexedTask[] {
		this.allTaskReads += 1;
		return [...this.tasks];
	}

	getDuplicateInstanceSnapshots(_operonId: string): readonly IndexedTaskInstance[] {
		return [];
	}

	getAllDuplicateInstanceSnapshots(): readonly IndexedTaskInstance[] {
		return [];
	}

	getTaskIdsInFileSnapshot(filePath: string): readonly string[] {
		return this.tasks.filter(taskValue => taskValue.primary.filePath === filePath).map(taskValue => taskValue.operonId);
	}

	getChildIdsSnapshot(parentOperonId: string): readonly string[] {
		return this.tasks
			.filter(taskValue => taskValue.fieldValues['parentTask'] === parentOperonId)
			.map(taskValue => taskValue.operonId);
	}

	getTaskIdsByWorkflowStatusSnapshot(statusValue: string): readonly string[] {
		return this.tasks.filter(taskValue => taskValue.fieldValues['status'] === statusValue).map(taskValue => taskValue.operonId);
	}

	getTaskIdsByPrioritySnapshot(priorityValue: string): readonly string[] {
		return this.tasks.filter(taskValue => taskValue.fieldValues['priority'] === priorityValue).map(taskValue => taskValue.operonId);
	}

	getTaskIdsDueInRangeSnapshot(startDate: string, endDate: string): readonly string[] {
		return this.tasks
			.filter(taskValue => {
				const due = taskValue.fieldValues['dateDue'] ?? '';
				return due >= startDate && due <= endDate;
			})
			.map(taskValue => taskValue.operonId);
	}

	getOpenTaskIdsSnapshot(): readonly string[] {
		return this.tasks.filter(taskValue => taskValue.checkbox === 'open').map(taskValue => taskValue.operonId);
	}

	getLiveReadAuthoritySnapshot() {
		return { state: 'verified' as const, ramGeneration: this.generation };
	}
}

function task(
	operonId: string,
	description: string,
	checkbox: IndexedTask['checkbox'],
	format: IndexedTask['primary']['format'],
	parentTask: string,
	priority: string,
	datetimeModified: string,
	extraFields: Record<string, string> = {},
): IndexedTask {
	return {
		operonId,
		description,
		checkbox,
		fieldValues: {
			operonId,
			priority,
			...(parentTask ? { parentTask } : {}),
			...extraFields,
		},
		tags: [],
		primary: format === 'yaml'
			? { format, filePath: `Tasks/${operonId}.md`, lineNumber: 0 }
			: { format, filePath: 'Tasks.md', lineNumber: 0 },
		datetimeModified,
		tier: checkbox === 'open' ? 'hot' : 'warm',
	};
}
