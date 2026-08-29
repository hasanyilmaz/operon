import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	estimateKanbanCellPlaceholderHeightPx,
	resolveKanbanViewportAnchorScroll,
	type KanbanViewportContentAnchor,
} from '../src/systems/kanban-cell-materialization';

const rootDir = process.cwd();
const viewSource = readFileSync(path.join(rootDir, 'src/ui/kanban/kanban-view.ts'), 'utf8');
const mainSource = readFileSync(path.join(rootDir, 'main.ts'), 'utf8');
const stylesSource = readFileSync(path.join(rootDir, 'styles.css'), 'utf8');

test('the first surviving lane anchor preserves its viewport offset', () => {
	const anchors: KanbanViewportContentAnchor[] = [
		{ key: 'missing', viewportOffsetPx: -120 },
		{ key: 'middle', viewportOffsetPx: 40 },
	];
	assert.equal(resolveKanbanViewportAnchorScroll(anchors, new Map([['middle', 680]]), 300), 640);
});

test('status anchors compensate for horizontal geometry changes', () => {
	const anchors: KanbanViewportContentAnchor[] = [{ key: 'doing', viewportOffsetPx: 112 }];
	assert.equal(resolveKanbanViewportAnchorScroll(anchors, new Map([['doing', 590]]), 200), 478);
});

test('missing anchors fall back to the captured coordinate and never go negative', () => {
	assert.equal(resolveKanbanViewportAnchorScroll([{ key: 'gone', viewportOffsetPx: 0 }], new Map(), 420), 420);
	assert.equal(resolveKanbanViewportAnchorScroll([], new Map(), -25), 0);
});

test('first, middle, and last visible lanes stay fixed when rows above them resize', () => {
	for (const [key, contentTop, viewportOffset, expectedTop] of [
		['first', 40, 40, 0],
		['middle', 760, 35, 725],
		['last', 1480, -20, 1500],
	] as const) {
		assert.equal(
			resolveKanbanViewportAnchorScroll(
				[{ key, viewportOffsetPx: viewportOffset }],
				new Map([[key, contentTop]]),
				300,
			),
			expectedTop,
		);
	}
});

test('accepted vertical drop behavior keeps the same list swimlane at the same viewport offset', () => {
	const capturedScrollTop = 720;
	const capturedViewportOffset = 48;
	const rebuiltLaneContentTop = 918;
	const settledScrollTop = resolveKanbanViewportAnchorScroll(
		[{ key: 'visible-list-lane', viewportOffsetPx: capturedViewportOffset }],
		new Map([['visible-list-lane', rebuiltLaneContentTop]]),
		capturedScrollTop,
	);

	assert.notEqual(settledScrollTop, capturedScrollTop);
	assert.equal(rebuiltLaneContentTop - settledScrollTop, capturedViewportOffset);
});

test('a removed list swimlane falls through to the next surviving visible lane', () => {
	const anchors: KanbanViewportContentAnchor[] = [
		{ key: '1a', viewportOffsetPx: -36 },
		{ key: '1b', viewportOffsetPx: 128 },
	];
	assert.equal(resolveKanbanViewportAnchorScroll(anchors, new Map([['1b', 940]]), 700), 812);
});

test('the five-card viewport estimate stays stable when a sixth task is added', () => {
	const estimate = (taskCount: number): number => estimateKanbanCellPlaceholderHeightPx({
		taskCount,
		maxVisibleTasks: 5,
		renderBatchSize: 20,
		cardHeightPx: 80,
		cardGapPx: 8,
	});
	assert.equal(estimate(5), 432);
	assert.equal(estimate(6), 432);
});

test('task refreshes opt into viewport retention without changing ordinary Kanban renders', () => {
	assert.match(mainSource, /preserveKanbanViewport\?: boolean/u);
	assert.match(mainSource, /refreshKanbanLeaves\(preserveViewport = false\)/u);
	assert.match(mainSource, /markDirty', \{ preserveViewport \}/u);
	assert.match(mainSource, /refreshAfterTaskEditorClose[\s\S]*?refreshViews\(\{ preserveKanbanViewport: true \}\)/u);
	assert.match(viewSource, /markDirty\(options: KanbanMarkDirtyOptions = \{\}\)/u);
	assert.match(viewSource, /if \(options\.preserveViewport\) \{\s*this\.preserveViewportOnNextRender = true/u);
	assert.doesNotMatch(viewSource, /else \{\s*this\.preserveViewportOnNextRender = false;\s*this\.clearViewportAnchor\(\)/u);
});

test('the rebuilt board restores raw scroll before materialization and content anchors after layout', () => {
	const rawRestore = viewSource.indexOf('this.restoreBoardScrollState(gridViewport);');
	const materialize = viewSource.indexOf('this.activateDeferredCellMaterialization(gridViewport, deferredCells);');
	const anchorRestore = viewSource.indexOf('this.restoreBoardViewportAnchor(gridViewport);');
	assert.ok(rawRestore >= 0 && materialize > rawRestore && anchorRestore > materialize);
	assert.match(viewSource, /row\.dataset\.kanbanLaneKey = lane\.key/u);
	assert.match(viewSource, /KANBAN_VIEWPORT_ANCHOR_STABLE_PASSES = 2/u);
	assert.match(viewSource, /KANBAN_VIEWPORT_ANCHOR_MIN_SETTLE_MS = 140/u);
	assert.match(viewSource, /KANBAN_VIEWPORT_ANCHOR_TTL_MS = 2000/u);
});

test('user input cancels late restoration and image settlement requests layout refresh', () => {
	assert.match(viewSource, /const cancelViewportRestore = \(\): void => \{\s*this\.clearViewportAnchor\(\);\s*this\.clearDropScrollAnchor\(\);/u);
	assert.match(viewSource, /addEventListener\('wheel', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('pointerdown', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('touchstart', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('keydown', cancelViewportRestore/u);
	assert.match(viewSource, /image\.addEventListener\('load', refreshSettledLayout/u);
	assert.match(viewSource, /imageWrap\.remove\(\);[\s\S]*?refreshSettledLayout\(\)/u);
});

test('drop raw restoration bootstraps without destroying the semantic viewport anchor', () => {
	const beginDrop = viewSource.slice(
		viewSource.indexOf('private beginDropScrollAnchor'),
		viewSource.indexOf('private getActiveDropScrollAnchor'),
	);
	assert.match(beginDrop, /this\.captureBoardViewportAnchor\(board\)/u);
	assert.doesNotMatch(viewSource, /if \(dropAnchor\) \{\s*this\.clearViewportAnchor\(\)/u);
	assert.match(viewSource, /if \(this\.getActiveDropScrollAnchor\(\) !== null\) return/u);
});

test('the managed board scroller owns anchoring and keeps its scrollbar geometry stable', () => {
	assert.match(stylesSource, /\.operon-kanban-grid-viewport \{[\s\S]*?overflow-anchor: none;/u);
	assert.match(stylesSource, /\.operon-kanban-grid-viewport \{[\s\S]*?scrollbar-gutter: stable;/u);
});
