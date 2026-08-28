import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildGanttDateAxis } from '../src/systems/gantt-core';
import type { IndexedTask } from '../src/types/fields';
import type { TableGanttSettings } from '../src/types/table';
import {
	buildTableGanttTimelineLayout,
	resolveTableGanttDependencyOverlayIntent,
} from '../src/ui/table/table-gantt-renderer';
import { resolveTableGanttDependencyConnectors } from '../src/ui/table/table-gantt-dependencies';
import { TableGanttTaskModelCache } from '../src/ui/table/table-gantt-model-cache';
import { TableScrollPerformanceRecorder } from '../src/ui/table/table-scroll-performance';
import type { TableTaskTreeRenderItem } from '../src/ui/table/table-task-tree';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) assert.equal(actual, expected);
	else assert.equal(actual, expected, message);
	assertions += 1;
}

function notEqual<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) assert.notEqual(actual, expected);
	else assert.notEqual(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.deepEqual(actual, expected);
	else assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function task(
	id: string,
	fieldValues: Record<string, string>,
	overrides: Partial<IndexedTask> = {},
): IndexedTask {
	return {
		operonId: id,
		description: id,
		checkbox: 'open',
		fieldValues,
		tags: [],
		primary: { filePath: 'Gantt cache fixtures.md', lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-08-27T12:00:00',
		tier: 'hot',
		...overrides,
	};
}

function taskItem(value: IndexedTask, ordinalKey = value.operonId): TableTaskTreeRenderItem {
	return { kind: 'task', task: value, groupKey: null, ordinalKey };
}

function gantt(overrides: Partial<TableGanttSettings> = {}): TableGanttSettings {
	return {
		enabled: true,
		splitPercent: 70,
		scale: 'week',
		unitWidthMultiplier: 1,
		barColorMode: 'noColor',
		weekendVisibility: 'show',
		...overrides,
	};
}

function cloneTask(
	value: IndexedTask,
	fieldValues: Record<string, string> = value.fieldValues,
	overrides: Partial<IndexedTask> = {},
): IndexedTask {
	return task(value.operonId, { ...fieldValues }, {
		...value,
		...overrides,
		fieldValues: { ...fieldValues },
	});
}

async function run(): Promise<void> {
	const source = task('source', {
		dateStarted: '2026-08-24',
		dateScheduled: '2026-08-25',
		dateDue: '2026-08-28',
		datetimeStart: '2026-08-24T09:00:00',
		datetimeEnd: '2026-08-24T10:00:00',
		estimate: '1h',
		blocking: 'target',
	});
	const target = task('target', { dateScheduled: '2026-09-02', blockedBy: 'source' });
	const items = [taskItem(source), taskItem(target)];
	const cache = new TableGanttTaskModelCache();
	const recorder = new TableScrollPerformanceRecorder('workspace', {
		isEnabled: () => true,
		now: () => 0,
		scheduleIdle: () => 1,
		cancelIdle: () => undefined,
		emit: () => undefined,
	});
	recorder.beginVerticalScroll({
		ganttEnabled: true,
		taskTreeEnabled: true,
		itemCount: items.length,
		columnCount: 6,
		rowHeight: 38,
	});
	const first = cache.resolve(items, recorder);
	const sameIdentity = cache.resolve(items, recorder);
	equal(first, sameIdentity, 'The same immutable item set returns the retained task model');
	equal(first.projections.get('source'), sameIdentity.projections.get('source'));
	deepEqual(first.dependencyEdges, [{ key: 'source\u0000target', fromId: 'source', toId: 'target' }]);
	const initialSummary = recorder.flush();
	equal(initialSummary?.counters.ganttProjectionCacheMisses, 2);
	equal(initialSummary?.counters.ganttDependencyModelCacheMisses, 2);
	equal(initialSummary?.counters.ganttProjectionCacheHits, 2);
	equal(initialSummary?.counters.ganttDependencyModelCacheHits, 2);

	const sourceProjection = first.projections.get('source');
	const unrelated = cloneTask(source, source.fieldValues, { description: 'Changed description', tags: ['cache'] });
	const unrelatedModel = cache.resolve([taskItem(unrelated), taskItem(target)]);
	equal(unrelatedModel.projections.get('source'), sourceProjection, 'Non-projection fields reuse the projection');
	deepEqual(unrelatedModel.dependencyEdges, first.dependencyEdges, 'Non-dependency fields preserve edge semantics');

	const dependencyChanged = cloneTask(unrelated, { ...unrelated.fieldValues, blocking: 'target, other' });
	const dependencyChangedModel = cache.resolve([taskItem(dependencyChanged), taskItem(target)]);
	equal(dependencyChangedModel.projections.get('source'), sourceProjection, 'Dependency edits do not invalidate projections');
	equal(dependencyChangedModel.dependencyEdges.length, 2);

	let previousTask = dependencyChanged;
	let previousProjection = dependencyChangedModel.projections.get('source');
	for (const [key, value] of [
		['dateStarted', '2026-08-23'],
		['dateScheduled', '2026-08-26'],
		['dateDue', '2026-08-30'],
		['datetimeStart', '2026-08-23T09:00:00'],
		['datetimeEnd', '2026-08-23T11:00:00'],
		['estimate', '2h'],
	] as const) {
		const changed = cloneTask(previousTask, { ...previousTask.fieldValues, [key]: value });
		const changedModel = cache.resolve([taskItem(changed), taskItem(target)]);
		notEqual(changedModel.projections.get('source'), previousProjection, `${key} invalidates the projection cache`);
		previousTask = changed;
		previousProjection = changedModel.projections.get('source');
	}

	const firstDuplicate = cloneTask(source, { ...source.fieldValues, dateScheduled: '2026-08-20' });
	const secondDuplicate = cloneTask(source, {
		...source.fieldValues,
		dateScheduled: '2026-10-20',
		blocking: 'other',
	});
	const duplicateModel = cache.resolve([
		taskItem(firstDuplicate, 'source-first'),
		taskItem(secondDuplicate, 'source-second'),
	]);
	equal(duplicateModel.projections.get('source')?.markers.find(marker => marker.key === 'dateScheduled')?.date, '2026-08-20');
	deepEqual(
		duplicateModel.dependencyEdges.map(edge => edge.toId).sort(),
		['other', 'target'],
		'Conflicting duplicate metadata preserves the existing edge-union behavior',
	);

	const beforePrune = duplicateModel.projections.get('source');
	cache.resolve([taskItem(target)]);
	const afterPrune = cache.resolve([taskItem(firstDuplicate)]);
	notEqual(afterPrune.projections.get('source'), beforePrune, 'Removed task entries are pruned');
	cache.clear();
	const afterClear = cache.resolve([taskItem(firstDuplicate)]);
	notEqual(afterClear.projections.get('source'), afterPrune.projections.get('source'), 'Explicit lifecycle reset clears projections');

	const layoutCache = new TableGanttTaskModelCache();
	const baseLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt(),
		calendarWeekStart: 'monday',
		viewportWidth: 400,
		today: '2026-08-27',
		modelCache: layoutCache,
	});
	const scaledLayout = buildTableGanttTimelineLayout({
		items,
		gantt: gantt({ scale: 'day', unitWidthMultiplier: 1.5 }),
		calendarWeekStart: 'monday',
		viewportWidth: 700,
		today: '2026-08-27',
		modelCache: layoutCache,
	});
	equal(baseLayout.projections.get('source'), scaledLayout.projections.get('source'));
	equal(baseLayout.dependencyEdges, scaledLayout.dependencyEdges, 'Scale and viewport reuse the cached dependency model');

	const axis = buildGanttDateAxis({
		startDate: '2026-08-01',
		endDate: '2026-09-30',
		baseDayWidthPx: 10,
		unitWidthMultiplier: 1,
		scale: 'day',
		weekStart: 'monday',
	});
	if (!axis) throw new Error('Expected a valid cache fixture axis');
	const connectorOptions = {
		items,
		startIndex: 0,
		endIndex: items.length,
		rowHeight: 38,
		axis,
		resolveProjection: (value: IndexedTask) => baseLayout.projections.get(value.operonId)!,
		edges: baseLayout.dependencyEdges,
	};
	const connectors = resolveTableGanttDependencyConnectors(connectorOptions).connectors;
	const retainedIntent = resolveTableGanttDependencyOverlayIntent(connectors, true);
	equal(resolveTableGanttDependencyOverlayIntent(connectors, true), retainedIntent);
	notEqual(resolveTableGanttDependencyOverlayIntent(connectors, false), retainedIntent, 'Live-layer availability invalidates overlay retention');
	const shiftedConnectors = resolveTableGanttDependencyConnectors({
		...connectorOptions,
		rowHeight: 44,
	}).connectors;
	notEqual(resolveTableGanttDependencyOverlayIntent(shiftedConnectors, true), retainedIntent, 'Connector geometry invalidates overlay retention');
	equal(
		resolveTableGanttDependencyOverlayIntent([], false),
		resolveTableGanttDependencyOverlayIntent([], false),
		'Empty connector layers have a stable retention intent',
	);

	const rootDir = process.cwd();
	const [rendererSource, dependencySource, workspaceSource, embeddedSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-renderer.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-dependencies.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
	]);
	assert.match(rendererSource, /state\.dependencyIntent === dependencyIntent[\s\S]*ganttDependencyOverlayRetentions[\s\S]*dependencySvg\.replaceChildren/);
	assert.match(rendererSource, /edges: layout\.dependencyEdges/);
	assert.match(dependencySource, /options\.edges \?\? collectTableGanttDependencyEdges/);
	for (const sourceText of [workspaceSource, embeddedSource]) {
		assert.match(sourceText, /modelCache: .*ganttTaskModelCache/);
		assert.match(sourceText, /ganttTaskModelCache\.clear\(\)/);
	}
	assertions += 7;

	console.log(`Table Gantt cache tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttCacheTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttCacheTestRun = run();
