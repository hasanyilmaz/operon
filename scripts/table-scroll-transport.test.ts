import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveTableProxyVerticalKeyScrollTop } from '../src/ui/table/table-gantt-split';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function match(actual: string, expected: RegExp, message?: string): void {
	assert.match(actual, expected, message);
	assertions += 1;
}

function doesNotMatch(actual: string, expected: RegExp, message?: string): void {
	assert.doesNotMatch(actual, expected, message);
	assertions += 1;
}

function resolveKey(
	key: string,
	options: Partial<Parameters<typeof resolveTableProxyVerticalKeyScrollTop>[0]> = {},
): number | null {
	return resolveTableProxyVerticalKeyScrollTop({
		key,
		shiftKey: false,
		scrollTop: 500,
		viewportHeight: 400,
		contentHeight: 4000,
		rowHeight: 38,
		...options,
	});
}

async function run(): Promise<void> {
	equal(resolveKey('ArrowUp'), 462);
	equal(resolveKey('ArrowDown'), 538);
	equal(resolveKey('PageUp'), 100);
	equal(resolveKey('PageDown'), 900);
	equal(resolveKey('Home'), 0);
	equal(resolveKey('End'), 3600);
	equal(resolveKey(' '), 900);
	equal(resolveKey(' ', { shiftKey: true }), 100);
	equal(resolveKey('ArrowUp', { scrollTop: 10 }), 0, 'keyboard scrolling clamps at the top');
	equal(resolveKey('PageDown', { scrollTop: 3500 }), 3600, 'keyboard scrolling clamps at the bottom');
	equal(resolveKey('Enter'), null, 'unrelated interaction keys remain untouched');
	equal(resolveKey('ArrowDown', { rowHeight: 44 }), 544, '44px density keeps one-row arrow steps');
	equal(resolveKey('End', { contentHeight: 120, viewportHeight: 400 }), 0, 'small tables cannot overscroll');

	const root = process.cwd();
	const workspaceSource = await readFile(path.join(root, 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embeddedSource = await readFile(path.join(root, 'src/ui/embed-table-processor.ts'), 'utf8');
	const splitSource = await readFile(path.join(root, 'src/ui/table/table-gantt-split.ts'), 'utf8');
	const headerSource = await readFile(path.join(root, 'src/ui/table/table-header-interactions.ts'), 'utf8');
	const stylesSource = await readFile(path.join(root, 'styles.css'), 'utf8');

	for (const source of [workspaceSource, embeddedSource]) {
		match(source, /const useProxyVerticalScroll = !Platform\.isPhone;/, 'desktop proxy is explicitly excluded from phones');
		match(source, /shell\.addClass\('is-table-proxy-scroll'\)/);
		match(source, /operon-table-proxy-header-scroller/);
		match(source, /operon-table-proxy-body-scroller/);
		match(source, /operon-table-proxy-scroll-column/);
		match(source, /operon-table-proxy-vertical-scroller/);
		match(source, /bindTableGanttPaneWheel\(bodyScroller, verticalScroller\)/, 'Table-only reuses the proven Gantt wheel path');
		match(source, /bindTableProxyVerticalKeyboard\(bodyScroller, verticalScroller, rowHeight\)/);
		match(source, /syncTableGanttCanvasOffsets\([^,]+, canvas\)/, 'Table-only reuses the compositor transform helper');
		match(source, /schedule(?:EmbedTable)?VisibleRowsRender[\s\S]{0,180}vertical-scroll/, 'row scheduling remains on the retained-window path');
		doesNotMatch(source, /nativeScrollImmediateRenders|retainedVirtualPaintCoverage|render-now/);
	}

	match(workspaceSource, /bindTableGanttPaneWheel\(tableBodyScroller, verticalScroller\);[\s\S]{0,100}bindTableGanttPaneWheel\(timelineBodyScroller, verticalScroller\);/, 'workspace Gantt wheel bindings remain intact');
	match(embeddedSource, /bindTableGanttPaneWheel\(tableBodyScroller, verticalScroller\);[\s\S]{0,100}bindTableGanttPaneWheel\(timelineBodyScroller, verticalScroller\);/, 'embedded Gantt wheel bindings remain intact');
	match(splitSource, /pane\.addEventListener\('wheel',[\s\S]*?event\.preventDefault\(\);[\s\S]*?passive: false/, 'Gantt wheel behavior remains blocking and unchanged');
	match(splitSource, /event\.target !== pane/, 'keyboard routing only owns the focused Table body');
	match(headerSource, /is-gantt-split, \.operon-table-shell\.is-table-proxy-scroll/);
	match(stylesSource, /\.operon-table-proxy-header-scroller\s*\{[\s\S]*?flex: 0 0 35px/);
	match(stylesSource, /\.operon-table-proxy-scroll-header-spacer\s*\{[\s\S]*?height: 35px/);
	match(stylesSource, /\.operon-table-gantt-pane-body\s*\{[\s\S]*?overflow-y: hidden/);
	match(stylesSource, /\.operon-table-body-scroller\s*\{[\s\S]*?overflow: auto/, 'phone fallback keeps the existing native scroller');

	console.log(`Table scroll transport tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableScrollTransportTestRun: Promise<void> | undefined;
}

globalThis.__operonTableScrollTransportTestRun = run();
