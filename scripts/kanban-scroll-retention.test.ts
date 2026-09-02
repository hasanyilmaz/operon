import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
	estimateKanbanCellPlaceholderHeightPx,
	matchesKanbanProgrammaticScrollState,
	resolveKanbanDropLaneAnchorScroll,
	resolveKanbanViewportAnchorScroll,
	resolveKanbanViewportScrollCompensation,
	shouldReleaseKanbanViewportScrollCompensation,
	shouldUseKanbanDropTargetLaneAnchor,
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

test('a drop keeps its target cell fixed whether or not another lane disappears', () => {
	const scrollTop = resolveKanbanDropLaneAnchorScroll({
		anchors: [
			{ key: 'visible-top', viewportOffsetPx: -50 },
			{ key: 'target', viewportOffsetPx: 320 },
		],
		targetLaneAnchor: { key: 'target', viewportOffsetPx: 320 },
		contentOffsets: new Map([
			['visible-top', 250],
			['target', 500],
		]),
		fallbackScroll: 300,
		allowTargetAnchor: true,
	});
	assert.equal(scrollTop, 180);
	assert.equal(500 - scrollTop, 320);
	assert.equal(resolveKanbanDropLaneAnchorScroll({
		anchors: [{ key: 'visible-top', viewportOffsetPx: -50 }],
		targetLaneAnchor: { key: 'target', viewportOffsetPx: 320 },
		contentOffsets: new Map([
			['visible-top', 260],
			['target', 540],
		]),
		fallbackScroll: 300,
		allowTargetAnchor: true,
	}), 220);
});

test('a drop does not move its target cell when a lane below it disappears', () => {
	const scrollTop = resolveKanbanDropLaneAnchorScroll({
		anchors: [{ key: 'visible-top', viewportOffsetPx: -50 }],
		targetLaneAnchor: { key: 'target', viewportOffsetPx: 320 },
		contentOffsets: new Map([
			['visible-top', 250],
			['target', 620],
		]),
		fallbackScroll: 300,
		allowTargetAnchor: true,
	});
	assert.equal(scrollTop, 300);
	assert.equal(620 - scrollTop, 320);
});

test('failed drops retain the general viewport anchor instead of forcing the target cell', () => {
	assert.equal(resolveKanbanDropLaneAnchorScroll({
		anchors: [{ key: 'visible-top', viewportOffsetPx: -50 }],
		targetLaneAnchor: { key: 'target', viewportOffsetPx: 320 },
		contentOffsets: new Map([
			['visible-top', 250],
			['target', 500],
		]),
		fallbackScroll: 300,
		allowTargetAnchor: false,
	}), 300);
});

test('an available drop target always outranks the raw and general lane anchors', () => {
	assert.equal(shouldUseKanbanDropTargetLaneAnchor({
		targetLaneAnchor: { key: 'target', viewportOffsetPx: 320 },
		contentOffsets: new Map([
			['source', 250],
			['target', 500],
		]),
		allowTargetAnchor: true,
	}), true);
});

test('bottom compensation preserves a target beyond the natural scroll range', () => {
	assert.deepEqual(resolveKanbanViewportScrollCompensation({
		desiredScrollTop: 620,
		naturalMaxScrollTop: 500,
	}), {
		scrollTop: 620,
		bottomCompensationPx: 120,
	});
	assert.deepEqual(resolveKanbanViewportScrollCompensation({
		desiredScrollTop: 420,
		naturalMaxScrollTop: 500,
	}), {
		scrollTop: 420,
		bottomCompensationPx: 0,
	});
	assert.equal(shouldReleaseKanbanViewportScrollCompensation({
		scrollTop: 620,
		naturalMaxScrollTop: 500,
		bottomCompensationPx: 120,
	}), false);
	assert.equal(shouldReleaseKanbanViewportScrollCompensation({
		scrollTop: 500.5,
		naturalMaxScrollTop: 500,
		bottomCompensationPx: 120,
	}), true);
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
	assert.match(viewSource, /if \(board && !this\.pendingViewportAnchor\) \{\s*this\.captureBoardViewportAnchor\(board\)/u);
	const renderSignatureGuard = viewSource.indexOf('if (this.lastRenderSignature === nextSignature');
	const consumePreserveRequest = viewSource.indexOf('this.preserveViewportOnNextRender = false;', renderSignatureGuard);
	assert.ok(renderSignatureGuard >= 0 && consumePreserveRequest > renderSignatureGuard);
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

test('post-drop settlement batches first-scroll card materialization and avoids a redundant rebuild', () => {
	const observerStart = viewSource.indexOf('const observer = new IntersectionObserver(entries => {', viewSource.indexOf('private activateDeferredCellMaterialization('));
	const observerEnd = viewSource.indexOf('}, { root: gridViewport', observerStart);
	const observerBody = viewSource.slice(observerStart, observerEnd);
	assert.match(observerBody, /this\.materializeKanbanCellsIfPending\(cells\)/u);
	assert.doesNotMatch(observerBody, /this\.materializeKanbanCellIfPending\(cell\)/u);

	const batchStart = viewSource.indexOf('private materializeKanbanCellsIfPending(');
	const batchEnd = viewSource.indexOf('\n\t}', batchStart);
	const batchBody = viewSource.slice(batchStart, batchEnd);
	const writeIndex = batchBody.indexOf('finalizers.push(materialize());');
	const measureIndex = batchBody.indexOf('for (const finalizer of finalizers) finalizer.measure();');
	const commitIndex = batchBody.indexOf('for (const finalizer of finalizers) finalizer.commit();');
	assert.ok(writeIndex >= 0 && writeIndex < measureIndex && measureIndex < commitIndex);

	const renderStart = viewSource.indexOf('private render(): void');
	const renderEnd = viewSource.indexOf('\n\tprivate buildRenderSignature(', renderStart);
	const renderBody = viewSource.slice(renderStart, renderEnd);
	assert.match(renderBody, /optimisticMoveCountBeforeBoardRender/u);
	assert.match(renderBody, /this\.optimisticMoves\.size === optimisticMoveCountBeforeBoardRender[\s\S]*?this\.buildRenderSignature/u);
});

test('board layout settlement has no unconditional delayed full-row rewrite', () => {
	const refreshStart = viewSource.indexOf('private bindBoardLayoutRefresh(');
	const refreshEnd = viewSource.indexOf('\n\tprivate clearBoardLayoutRefresh(', refreshStart);
	const refreshBody = viewSource.slice(refreshStart, refreshEnd);
	assert.doesNotMatch(refreshBody, /setTimeout\(scheduleRefresh, 120\)/u);
	assert.match(refreshBody, /window\.requestAnimationFrame\(scheduleRefresh\)/u);
	assert.match(refreshBody, /new ResizeObserver\(entries => \{[\s\S]*?entry\.contentRect\.width[\s\S]*?if \(widthChanged\) scheduleRefresh\(\)/u);
	assert.doesNotMatch(refreshBody, /observer\.observe\(gridRow\)/u);

	const cellRefreshStart = viewSource.indexOf('private scheduleBoardLayoutRefreshFromCell(');
	const cellRefreshEnd = viewSource.indexOf('\n\tprivate clearKanbanLazyObservers(', cellRefreshStart);
	const cellRefreshBody = viewSource.slice(cellRefreshStart, cellRefreshEnd);
	assert.match(cellRefreshBody, /this\.syncRowCellHeights\(\[row\]\)/u);
	assert.match(cellRefreshBody, /this\.syncLaneHeights\(\[laneLabel\], \[row\]\)/u);
	assert.doesNotMatch(cellRefreshBody, /querySelectorAll<HTMLElement>\('\.operon-kanban-row'\)|syncRowCellHeights\(gridRows\)/u);
});

test('user input cancels late restoration and image settlement requests layout refresh', () => {
	assert.equal(matchesKanbanProgrammaticScrollState(
		{ left: 120, top: 640 },
		{ left: 120, top: 640 },
	), true);
	assert.equal(matchesKanbanProgrammaticScrollState(
		{ left: 120, top: 648 },
		{ left: 120, top: 640 },
	), false);
	assert.match(viewSource, /const cancelViewportRestore = \(\): void => \{\s*this\.pendingProgrammaticBoardScroll = null;\s*this\.clearViewportAnchor\(\);\s*this\.preserveViewportOnNextRender = false;/u);
	assert.match(viewSource, /addEventListener\('wheel', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('pointerdown', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('touchstart', cancelViewportRestore/u);
	assert.match(viewSource, /addEventListener\('keydown', cancelViewportRestore/u);
	assert.match(viewSource, /matchesKanbanProgrammaticScrollState[\s\S]*?this\.clearViewportAnchor\(\)/u);
	assert.match(viewSource, /this\.scheduleBoardBottomScrollCompensationRelease\(gridViewport\)/u);
	const compensationStart = viewSource.indexOf('private scheduleBoardBottomScrollCompensationRelease(');
	const compensationEnd = viewSource.indexOf('\n\tprivate cancelBoardBottomScrollCompensationRelease(', compensationStart);
	const compensationBody = viewSource.slice(compensationStart, compensationEnd);
	assert.match(compensationBody, /ownerWindow\.requestAnimationFrame/u);
	assert.doesNotMatch(compensationBody, /setTimeout|KANBAN_COMPENSATION_RELEASE_IDLE_MS/u);
	assert.match(viewSource, /image\.addEventListener\('load', refreshSettledLayout/u);
	assert.match(viewSource, /imageWrap\.remove\(\);[\s\S]*?refreshSettledLayout\(\)/u);
});

test('one viewport transaction owns drop bootstrap and semantic settlement', () => {
	const beginDrop = viewSource.slice(
		viewSource.indexOf('private beginDropScrollAnchor'),
		viewSource.indexOf('private settleDropViewportAnchor'),
	);
	assert.match(beginDrop, /this\.captureBoardViewportAnchor\(board\)/u);
	assert.doesNotMatch(viewSource, /pendingDropScrollAnchor|clearDropScrollAnchor|getActiveDropScrollAnchor/u);
	assert.match(viewSource, /const desiredScrollTop = resolveKanbanDropLaneAnchorScroll/u);
	assert.match(viewSource, /this\.applyBoardBottomScrollCompensation\(board, compensation\.bottomCompensationPx\)/u);
	assert.match(viewSource, /anchor\.drop\?\.outcome !== null/u);
	assert.match(viewSource, /if \(!anchor\?\.drop \|\| this\.pendingViewportAnchor !== anchor\) return/u);
});

test('the managed board scroller owns anchoring and keeps its scrollbar geometry stable', () => {
	assert.match(stylesSource, /\.operon-kanban-grid-viewport \{[\s\S]*?overflow-anchor: none;/u);
	assert.match(stylesSource, /\.operon-kanban-grid-viewport \{[\s\S]*?scrollbar-gutter: stable;/u);
});

test('desktop, phone, and tablet drops share one platform-neutral viewport transaction', () => {
	const completionStart = viewSource.indexOf('private completeKanbanCardDrop(');
	const completionEnd = viewSource.indexOf('\n\tprivate deleteOptimisticMove(', completionStart);
	const completionBody = viewSource.slice(completionStart, completionEnd);
	assert.ok(completionStart >= 0 && completionEnd > completionStart);
	assert.match(completionBody, /const dropViewportAnchor = this\.beginDropScrollAnchor\(targetCell, context\);/u);
	assert.match(completionBody, /this\.settleDropViewportAnchor\(dropViewportAnchor, outcome\);/u);
	assert.doesNotMatch(completionBody, /Platform\.|isKanbanMobileLayoutEligible/u);

	const sharedScrollStart = viewSource.indexOf('private captureBoardScrollState(');
	const sharedScrollEnd = viewSource.indexOf('\n\tprivate bindBoardScrollStateTracking(', sharedScrollStart);
	const sharedScrollBody = viewSource.slice(sharedScrollStart, sharedScrollEnd);
	assert.ok(sharedScrollStart >= 0 && sharedScrollEnd > sharedScrollStart);
	assert.match(sharedScrollBody, /this\.captureCellScrollStates\(board\);/u);
	assert.match(sharedScrollBody, /this\.captureBoardViewportAnchor\(board\)/u);
	assert.match(sharedScrollBody, /resolveKanbanDropLaneAnchorScroll/u);
	assert.doesNotMatch(sharedScrollBody, /Platform\.|isKanbanMobileLayoutEligible|is-mobile-layout/u);

	assert.match(viewSource, /cell\.addEventListener\('drop',[\s\S]*?this\.completeKanbanCardDrop\(cell, dragged, context, targetBeforeTaskId, preset\);/u);
	assert.match(viewSource, /const commitMobileCardDrag[\s\S]*?this\.completeKanbanCardDrop\(targetCell, dragged, context, targetBeforeTaskId, preset, true\);/u);
});

test('mobile touch scrolling composes with the shared board and cell scroll owners', () => {
	const mobileLayoutStart = viewSource.indexOf('private bindKanbanMobileLayout(');
	const mobileLayoutEnd = viewSource.indexOf('\n\tprivate clearKanbanMobileLayout(', mobileLayoutStart);
	const mobileLayoutBody = viewSource.slice(mobileLayoutStart, mobileLayoutEnd);
	assert.ok(mobileLayoutStart >= 0 && mobileLayoutEnd > mobileLayoutStart);
	assert.match(mobileLayoutBody, /const scrollCell = pointElement\?\.closest<HTMLElement>\('\.operon-kanban-cell\.is-scroll-limited'\)/u);
	assert.match(mobileLayoutBody, /if \(scrollCell && gridViewport\.contains\(scrollCell\)\)[\s\S]*?target: scrollCell/u);
	assert.match(mobileLayoutBody, /if \(viewportDirection === null \|\| !canScrollVertically\(gridViewport, viewportDirection\)\) return null;[\s\S]*?target: gridViewport/u);
	assert.match(mobileLayoutBody, /gesture\.startCell\?\.classList\.contains\('is-scroll-limited'\)[\s\S]*?remainingY = scrollElementBy\(gesture\.startCell, remainingY\);[\s\S]*?scrollElementBy\(gridViewport, remainingY\);/u);
	assert.match(mobileLayoutBody, /boardEl\.addClass\('is-mobile-card-scroll-active'\)[\s\S]*?gridViewport\.scrollTo\(\{ left: targetLeft, behavior: 'smooth' \}\)/u);
	assert.match(stylesSource, /\.operon-kanban-board\.is-mobile-card-scroll-active \.operon-kanban-grid-viewport \{\s*scroll-snap-type: none;/u);
	assert.match(stylesSource, /\.operon-kanban-cell\.is-scroll-limited \{[\s\S]*?overflow-y: auto;/u);
});
