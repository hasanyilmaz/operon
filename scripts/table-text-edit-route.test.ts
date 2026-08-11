import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	buildTableFilePropertyTextMutation,
	isTablePlainTextField,
	resolveTableTaskTextEditRoute,
	resolveTableTextEditRoute,
} from '../src/ui/table/table-text-edit-route';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function ok(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

async function run(): Promise<void> {
	equal(resolveTableTextEditRoute('', true), 'picker');
	equal(resolveTableTextEditRoute('   ', true), 'picker');
	equal(resolveTableTextEditRoute('Alpha', true), 'popover');
	equal(resolveTableTextEditRoute('Alpha', false), 'picker');

	const customText = { key: 'client', type: 'text' };
	equal(resolveTableTaskTextEditRoute(customText, ''), 'picker');
	equal(resolveTableTaskTextEditRoute(customText, 'Alpha'), 'popover');
	equal(resolveTableTaskTextEditRoute({ ...customText, unavailable: true }, 'Alpha'), 'picker');
	for (const key of ['description', 'note', 'status', 'priority', 'taskIcon', 'taskColor']) {
		equal(resolveTableTaskTextEditRoute({ key, type: 'text' }, 'Alpha'), 'picker', `${key} must keep its special editor`);
		equal(resolveTableTaskTextEditRoute({ key, type: 'text' }, ''), 'picker', `${key} must keep its special editor when empty`);
	}
	equal(isTablePlainTextField({ key: 'taskIcon', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'taskColor', type: 'text' }), false);
	equal(resolveTableTaskTextEditRoute({ key: 'contexts', type: 'list' }, 'Alpha'), 'picker');

	deepEqual(buildTableFilePropertyTextMutation(' Alpha '), { kind: 'set', value: 'Alpha' });
	deepEqual(buildTableFilePropertyTextMutation(''), { kind: 'delete' });
	deepEqual(buildTableFilePropertyTextMutation('  \n '), { kind: 'delete' });

	const rootDir = process.cwd();
	const [workspaceSource, embedSource, editorSource, popoverSource, pickerDispatchSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-file-property-editor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/text-field-popover.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/task-field-picker-dispatch.ts'), 'utf8'),
	]);

	for (const source of [workspaceSource, embedSource]) {
		ok(source.includes("column.key === 'description' || column.key === 'note'"));
		ok(source.includes('resolveTableTaskTextEditRoute(field, value)'));
		ok(source.includes("editRoute === 'popover'"));
		ok(source.includes('isCompactTaskMarkdownLinkEventTarget(event.target, cell)'));
		ok(source.includes("event.key !== 'Enter' && event.key !== ' '"));
	}
	ok(workspaceSource.includes('this.openInlineTextPopover(cell, task, key, value, fieldLabel, cellKey, key, true)'));
	ok(embedSource.includes('openEmbedTableInlineTextPopover(activeInstance, deps, cell, task, key, value, fieldLabel, cellKey, key, true)'));
	ok(workspaceSource.includes('? renderState.getContextFilePropertyCandidates(column.key)'));
	ok(embedSource.includes('? renderState.getContextFilePropertyCandidates(column.key)'));
	ok(workspaceSource.includes('expected,\n\t\t\t\tmutation,'));
	ok(embedSource.includes('propertyName: field.propertyName, expected, mutation,'));

	ok(editorSource.includes("resolveTableTextEditRoute(normalizedValue, true) === 'popover'"));
	ok(editorSource.includes('allowEmptyCommit: true'));
	ok(editorSource.includes('buildTableFilePropertyTextMutation(value)'));
	ok(popoverSource.includes('options.allowEmptyCommit === true'));
	ok(pickerDispatchSource.includes("case 'taskIcon':\n\t\t\treturn showIconPicker"));
	ok(pickerDispatchSource.includes("case 'taskColor':\n\t\t\treturn showColorPicker"));

	console.log(`Table text edit route tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTableTextEditRouteTestRun: Promise<void> | undefined;
}

globalThis.__operonTableTextEditRouteTestRun = run();
