import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDependencyEdge } from '../src/core/dependency-graph';
import { buildGanttDateAxis, projectTaskToGantt } from '../src/systems/gantt-core';
import type { IndexedTask } from '../src/types/fields';
import type { GanttDateAxis } from '../src/types/gantt';
import type { TableTaskTreeRenderItem, TableTaskTreeProjection } from '../src/ui/table/table-task-tree';
import {
	buildTableGanttDependencyPath,
	collectTableGanttDependencyEdges,
	resolveTableGanttDependencyConnectors,
	resolveTableGanttDependencyDirection,
	selectTableGanttDependencyOccurrences,
} from '../src/ui/table/table-gantt-dependencies';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) assert.equal(actual, expected);
	else assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message === undefined) assert.deepEqual(actual, expected);
	else assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function ok(value: unknown, message?: string): void {
	assert.ok(value, message);
	assertions += 1;
}

function task(id: string, dateScheduled: string, fieldValues: Record<string, string> = {}): IndexedTask {
	return {
		operonId: id,
		description: id,
		checkbox: 'open',
		fieldValues: { dateScheduled, ...fieldValues },
		tags: [],
		primary: { filePath: 'Gantt dependency fixtures.md', lineNumber: 1, format: 'inline' },
		datetimeModified: '2026-08-26T12:00:00',
		tier: 'hot',
	};
}

function tree(context: boolean): TableTaskTreeProjection {
	return {
		depth: context ? 1 : 0,
		path: context ? [1, 1] : [1],
		tokenWidthChars: 3,
		expansionKey: context ? 'context' : 'base',
		hasChildren: false,
		expanded: false,
		context,
		baseLeaf: !context,
	};
}

function taskItem(value: IndexedTask, ordinalKey: string, context = false): TableTaskTreeRenderItem {
	return { kind: 'task', task: value, groupKey: null, ordinalKey, tree: tree(context) };
}

function parentItem(value: IndexedTask, occurrenceKey: string): TableTaskTreeRenderItem {
	return { kind: 'parentContext', task: value, groupKey: 'parent', occurrenceKey };
}

const maybeAxis = buildGanttDateAxis({
	startDate: '2026-08-01',
	endDate: '2026-08-31',
	scale: 'day',
	weekStart: 'monday',
	baseDayWidthPx: 10,
	unitWidthMultiplier: 1,
});
if (!maybeAxis) throw new Error('Expected dependency fixture axis to be valid');
const axis: GanttDateAxis = maybeAxis;

async function run(): Promise<void> {
	const source = task('source', '2026-08-03', { blocking: 'target' });
	const target = task('target', '2026-08-08', { blockedBy: 'source' });
	const duplicateMetadataItems: TableTaskTreeRenderItem[] = [
		taskItem(source, 'source'),
		taskItem(target, 'target'),
	];
	deepEqual(collectTableGanttDependencyEdges(duplicateMetadataItems), [{
		key: 'source\u0000target',
		fromId: 'source',
		toId: 'target',
	}], 'blocking and blockedBy halves collapse into one directed edge');

	deepEqual(resolveTableGanttDependencyDirection('source', 'outgoing', 'target', 'incoming'), {
		fromId: 'source',
		toId: 'target',
	});
	deepEqual(resolveTableGanttDependencyDirection('target', 'incoming', 'source', 'outgoing'), {
		fromId: 'source',
		toId: 'target',
	});
	equal(resolveTableGanttDependencyDirection('source', 'outgoing', 'target', 'outgoing'), null);
	equal(resolveTableGanttDependencyDirection('source', 'outgoing', 'source', 'incoming'), null);

	const repeatedItems: TableTaskTreeRenderItem[] = [
		taskItem(source, 'context-source', true),
		parentItem(source, 'parent-source'),
		taskItem(source, 'base-source'),
		taskItem(target, 'base-target'),
	];
	const commonOptions = {
		items: repeatedItems,
		startIndex: 0,
		endIndex: repeatedItems.length,
		rowHeight: 38,
		axis,
		resolveProjection: projectTaskToGantt,
	};
	const occurrences = selectTableGanttDependencyOccurrences(commonOptions);
	equal(occurrences.get('source')?.rowIndex, 2, 'base task wins over parent and Task Tree context');
	equal(occurrences.get('target')?.rowIndex, 3);
	equal(occurrences.get('source')?.centerY, 95);

	const clippedOccurrences = selectTableGanttDependencyOccurrences({
		...commonOptions,
		endIndex: 2,
	});
	equal(clippedOccurrences.get('source')?.rowIndex, 1, 'parent context wins when the base row is outside the virtual range');

	const comfortableOccurrences = selectTableGanttDependencyOccurrences({
		...commonOptions,
		rowHeight: 44,
	});
	equal(comfortableOccurrences.get('source')?.centerY, 110);

	const layout = resolveTableGanttDependencyConnectors(commonOptions);
	equal(layout.connectors.length, 1);
	equal(layout.connectors[0]?.edge.fromId, 'source');
	equal(layout.connectors[0]?.edge.toId, 'target');
	ok(layout.connectors[0]?.path.includes(' H '));
	ok(layout.connectors[0]?.arrowPath.endsWith(' 136'));

	const forwardPath = buildTableGanttDependencyPath(37, 19, 63, 57);
	equal(forwardPath.path, 'M 37 19 H 50 V 57 H 63');
	equal(forwardPath.arrowPath, 'M 58 54 L 63 57 L 58 60');
	const backwardPath = buildTableGanttDependencyPath(87, 19, 13, 57);
	equal(backwardPath.path, 'M 87 19 H 99 V 38 H 1 V 57 H 13');

	const undated = task('undated', '', { blockedBy: 'source' });
	const missingBarLayout = resolveTableGanttDependencyConnectors({
		...commonOptions,
		items: [taskItem(source, 'source'), taskItem(undated, 'undated')],
		endIndex: 2,
	});
	equal(missingBarLayout.connectors.length, 0, 'barless endpoints do not create connector stubs');

	const movedProjection = projectTaskToGantt(task('source', '2026-08-12', { blocking: 'target' }));
	const previewLayout = resolveTableGanttDependencyConnectors({
		...commonOptions,
		resolveProjection: value => value.operonId === 'source' ? movedProjection : projectTaskToGantt(value),
	});
	equal(previewLayout.occurrences.get('source')?.left, 110, 'connector geometry follows the active bar projection');

	const optimistic = resolveTableGanttDependencyConnectors({
		...commonOptions,
		items: [taskItem(task('source', '2026-08-03'), 'source'), taskItem(task('target', '2026-08-08'), 'target')],
		endIndex: 2,
		additionalEdges: [{ key: 'source\u0000target', fromId: 'source', toId: 'target' }],
	});
	equal(optimistic.connectors.length, 1);

	equal(validateDependencyEdge('source', 'source', [source, target]).ok, false);
	equal(validateDependencyEdge('target', 'source', [source, target]).ok, false, 'reverse edge is rejected as a cycle');
	equal(validateDependencyEdge('source', 'target', [source, target]).ok, true, 'an already asserted edge is not treated as a new cycle');

	const rootDir = process.cwd();
	const [rendererSource, interactionSource, workspaceSource, embedSource, mainSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-renderer.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-gantt-interaction.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'main.ts'), 'utf8'),
		readFile(path.join(rootDir, 'styles.css'), 'utf8'),
	]);
	assert.match(rendererSource, /operon-table-gantt-dependency-layer/);
	assert.match(rendererSource, /getOptimisticDependencyEdges/);
	assert.match(interactionSource, /setPointerCapture/);
	assert.match(interactionSource, /elementFromPoint/);
	assert.match(interactionSource, /verticalScrollerEl\.scrollTop/);
	assert.match(interactionSource, /TableGanttDependencyMutationOutcome/);
	assert.match(workspaceSource, /onCreateGanttDependency/);
	assert.match(embedSource, /createGanttDependency/);
	assert.match(embedSource, /canWriteEmbedTable\(deps\)/);
	assert.match(mainSource, /validateGanttDependencyCandidate/);
	assert.match(mainSource, /sourceHasTarget/);
	assert.match(cssSource, /is-gantt-dependency-dragging/);
	assertions += 12;

	console.log(`Table Gantt dependency tests passed (${assertions} assertions).`);
}

globalThis.__operonTableGanttDependencyTestRun = run();

declare global {
	var __operonTableGanttDependencyTestRun: Promise<void> | undefined;
}

export {};
