import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	resolveKanbanViewportAnchorScroll,
	type KanbanViewportContentAnchor,
} from '../src/systems/kanban-cell-materialization';

const rootDir = process.cwd();
const viewSource = readFileSync(path.join(rootDir, 'src/ui/kanban/kanban-view.ts'), 'utf8');
const mainSource = readFileSync(path.join(rootDir, 'main.ts'), 'utf8');

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

test('task refreshes opt into viewport retention without changing ordinary Kanban renders', () => {
	assert.match(mainSource, /preserveKanbanViewport\?: boolean/u);
	assert.match(mainSource, /refreshKanbanLeaves\(preserveViewport = false\)/u);
	assert.match(mainSource, /markDirty', \{ preserveViewport \}/u);
	assert.match(mainSource, /refreshAfterTaskEditorClose[\s\S]*?refreshViews\(\{ preserveKanbanViewport: true \}\)/u);
	assert.match(viewSource, /markDirty\(options: KanbanMarkDirtyOptions = \{\}\)/u);
	assert.match(viewSource, /if \(options\.preserveViewport\) \{\s*this\.preserveViewportOnNextRender = true/u);
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
	assert.match(viewSource, /addEventListener\('wheel', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('pointerdown', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('touchstart', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('keydown', cancelViewportRestore/u);
	assert.match(viewSource, /image\.addEventListener\('load', refreshSettledLayout/u);
	assert.match(viewSource, /imageWrap\.remove\(\);[\s\S]*?refreshSettledLayout\(\)/u);
});

test('drop scroll retention remains higher priority than edit refresh retention', () => {
	assert.match(viewSource, /if \(dropAnchor\) \{\s*this\.clearViewportAnchor\(\)/u);
	assert.match(viewSource, /this\.getActiveDropScrollAnchor\(\) !== null[\s\S]*?this\.clearViewportAnchor\(\)/u);
});
