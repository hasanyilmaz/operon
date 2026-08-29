import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	TableProgrammaticScrollGuard,
	captureTableSearchFocusRange,
	resolveTableScrollUiDismissal,
	shouldReleaseTableSearchFocusLease,
} from '../src/ui/table/table-interaction-retention';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
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

async function run(): Promise<void> {
	const guard = new TableProgrammaticScrollGuard();
	const tableScroller = { scrollLeft: 48, scrollTop: 120 };
	guard.set(tableScroller, { scrollLeft: 0 });
	equal(tableScroller.scrollLeft, 0);
	equal(guard.isExpected(tableScroller), true, 'the first programmatic scroll event is retained');
	equal(guard.isExpected(tableScroller), true, 'multiple events from the same restoration epoch are retained');
	guard.set(tableScroller, { scrollTop: 0 });
	equal(tableScroller.scrollTop, 0);
	equal(guard.isExpected(tableScroller), true, 'horizontal and vertical restoration share one target epoch');
	tableScroller.scrollTop = 1;
	equal(guard.isExpected(tableScroller), false, 'a genuine position change ends the retained epoch');
	equal(guard.isExpected(tableScroller), false, 'a released target stays user-driven');

	const timelineScroller = { scrollLeft: 300, scrollTop: 0 };
	guard.set(timelineScroller, { scrollLeft: 640 });
	equal(guard.isExpected(timelineScroller), true, 'timeline restoration is tracked independently');
	equal(guard.isExpected(tableScroller), false, 'independent scrollers do not share expected positions');

	deepEqual(resolveTableScrollUiDismissal(true, false), {
		blurSearch: false,
		closeActivePicker: false,
	});
	deepEqual(resolveTableScrollUiDismissal(false, true), {
		blurSearch: true,
		closeActivePicker: false,
	});
	deepEqual(resolveTableScrollUiDismissal(false, false), {
		blurSearch: true,
		closeActivePicker: true,
	});

	deepEqual(captureTableSearchFocusRange({ selectionStart: 2, selectionEnd: 5, value: 'abcdef' }), {
		start: 2,
		end: 5,
	});
	deepEqual(captureTableSearchFocusRange({ selectionStart: null, selectionEnd: null, value: 'abc' }), {
		start: 3,
		end: 3,
	});
	const focusedInput: { isConnected: boolean; ownerDocument: { activeElement: object | null } } = {
		isConnected: true,
		ownerDocument: { activeElement: null },
	};
	focusedInput.ownerDocument.activeElement = focusedInput;
	equal(shouldReleaseTableSearchFocusLease(focusedInput), false, 'an active search lease remains held');
	focusedInput.ownerDocument.activeElement = {};
	equal(shouldReleaseTableSearchFocusLease(focusedInput), true, 'an intentional focus transfer releases the lease');
	focusedInput.isConnected = false;
	equal(shouldReleaseTableSearchFocusLease(focusedInput), false, 'DOM replacement does not release the lease');

	const root = process.cwd();
	const workspaceSource = await readFile(path.join(root, 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embeddedSource = await readFile(path.join(root, 'src/ui/embed-table-processor.ts'), 'utf8');
	const popoverSource = await readFile(path.join(root, 'src/ui/table/table-group-sort-popover.ts'), 'utf8');

	for (const source of [workspaceSource, embeddedSource]) {
		match(source, /programmaticScrollGuard\.isExpected\(/);
		match(source, /retainActivePickerOnScroll\s*=\s*true/);
		match(source, /captureTableSearchFocusRange\(searchInput\)/);
		match(source, /shouldReleaseTableSearchFocusLease\(searchInput\)/);
		doesNotMatch(source, /suppressActivePickerCloseOnScrollToken/);
	}
	match(workspaceSource, /programmaticScrollGuard\.isExpected\(timelineBodyScroller\)/);
	match(embeddedSource, /preserveFloatingPanels: instance\.keepActivePickerOnRender/);
	match(popoverSource, /repositionOnScroll: true/);
	match(popoverSource, /shouldClose: reason => reason !== 'window-blur'/);

	console.log(`Table interaction retention tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableInteractionRetentionTestRun: Promise<void> | undefined;
}

globalThis.__operonTableInteractionRetentionTestRun = run();
