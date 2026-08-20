import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	buildTableFilePropertyTextMutation,
	isTablePlainTextField,
	resolveTableParentTaskActivation,
	resolveTableTaskTextEditRoute,
	resolveTableTextEditRoute,
} from '../src/ui/table/table-text-edit-route';
import { bindTableParentTaskCellActivation } from '../src/ui/table/table-parent-task-cell';
import { formatTableParentTaskTooltipContent } from '../src/ui/table/table-parent-task-tooltip-content';

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

class FakeParentCell {
	private readonly listeners = new Map<string, Array<(event: any) => void>>();

	addEventListener(type: string, listener: (event: any) => void): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, event: Record<string, unknown> = {}): { prevented: boolean; stopped: boolean } {
		const state = { prevented: false, stopped: false };
		const payload = {
			button: 0,
			detail: type === 'click' ? 1 : 0,
			key: '',
			metaKey: false,
			ctrlKey: false,
			target: this,
			preventDefault: () => { state.prevented = true; },
			stopPropagation: () => { state.stopped = true; },
			...event,
		};
		for (const listener of this.listeners.get(type) ?? []) listener(payload);
		return state;
	}
}

function bindParentHarness(options: {
	parentTaskId?: string;
	parentExists?: boolean;
	canOpenEditor?: boolean;
	canOpenSource?: boolean;
} = {}) {
	const cell = new FakeParentCell();
	const calls: Array<[string, string?]> = [];
	bindTableParentTaskCellActivation(cell as unknown as HTMLElement, {
		parentTaskId: options.parentTaskId ?? 'parent-raw-id',
		parentExists: options.parentExists ?? true,
		canOpenEditor: options.canOpenEditor ?? true,
		canOpenSource: options.canOpenSource ?? true,
		isSourceModifier: event => event.metaKey,
		shouldIgnoreTarget: () => false,
		onOpenPicker: () => { calls.push(['picker']); },
		onOpenEditor: id => { calls.push(['editor', id]); },
		onOpenSource: id => { calls.push(['source', id]); },
	});
	return { cell, calls };
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
	for (const key of ['description', 'note', 'status', 'priority', 'parentTask', 'taskIcon', 'taskColor', 'taskType', 'taskImage']) {
		equal(resolveTableTaskTextEditRoute({ key, type: 'text' }, 'Alpha'), 'picker', `${key} must keep its special editor`);
		equal(resolveTableTaskTextEditRoute({ key, type: 'text' }, ''), 'picker', `${key} must keep its special editor when empty`);
	}
	equal(isTablePlainTextField({ key: 'taskIcon', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'taskColor', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'parentTask', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'taskImage', type: 'text' }), false);
	equal(isTablePlainTextField({ key: 'taskType', type: 'text' }), true);
	equal(resolveTableTaskTextEditRoute({ key: 'contexts', type: 'list' }, 'Alpha'), 'picker');

	const parentActivationBase = {
		parentTaskId: 'parent-raw-id',
		parentExists: true,
		canOpenEditor: true,
		canOpenSource: true,
	};
	equal(resolveTableParentTaskActivation({ ...parentActivationBase, sourceModifier: false }), 'editor');
	equal(resolveTableParentTaskActivation({ ...parentActivationBase, sourceModifier: true }), 'source');
	equal(resolveTableParentTaskActivation({ ...parentActivationBase, parentTaskId: '', sourceModifier: false }), 'picker');
	equal(resolveTableParentTaskActivation({ ...parentActivationBase, parentExists: false, sourceModifier: false }), 'picker');
	equal(resolveTableParentTaskActivation({ ...parentActivationBase, canOpenEditor: false, sourceModifier: false }), 'picker');
	equal(resolveTableParentTaskActivation({ ...parentActivationBase, canOpenSource: false, sourceModifier: true }), 'editor');

	const pointerHarness = bindParentHarness();
	const pointerState = pointerHarness.cell.dispatch('pointerdown');
	pointerHarness.cell.dispatch('click');
	deepEqual(pointerHarness.calls, [['editor', 'parent-raw-id']]);
	equal(pointerState.prevented, true);
	equal(pointerState.stopped, true);

	const clickOnlyHarness = bindParentHarness();
	clickOnlyHarness.cell.dispatch('click');
	deepEqual(clickOnlyHarness.calls, [['editor', 'parent-raw-id']]);

	const modifierHarness = bindParentHarness();
	modifierHarness.cell.dispatch('pointerdown', { metaKey: true });
	modifierHarness.cell.dispatch('click', { metaKey: true });
	deepEqual(modifierHarness.calls, [['source', 'parent-raw-id']]);

	for (const key of ['Enter', ' ']) {
		const keyboardHarness = bindParentHarness();
		const keyboardState = keyboardHarness.cell.dispatch('keydown', { key });
		deepEqual(keyboardHarness.calls, [['editor', 'parent-raw-id']]);
		equal(keyboardState.prevented, true);
		equal(keyboardState.stopped, true);
	}

	for (const parentOptions of [{ parentTaskId: '' }, { parentExists: false }]) {
		const pickerHarness = bindParentHarness(parentOptions);
		pickerHarness.cell.dispatch('pointerdown');
		pickerHarness.cell.dispatch('click');
		deepEqual(pickerHarness.calls, [['picker']]);
	}

	const ignoredHarness = bindParentHarness();
	ignoredHarness.cell.dispatch('pointerdown', { button: 2 });
	deepEqual(ignoredHarness.calls, []);
	ok(formatTableParentTaskTooltipContent('parent-raw-id', '⌘').includes('parent-raw-id\n⌘+Click'));
	ok(formatTableParentTaskTooltipContent('parent-raw-id', 'Ctrl').includes('parent-raw-id\nCtrl+Click'));

	deepEqual(buildTableFilePropertyTextMutation(' Alpha '), { kind: 'set', value: 'Alpha' });
	deepEqual(buildTableFilePropertyTextMutation(''), { kind: 'delete' });
	deepEqual(buildTableFilePropertyTextMutation('  \n '), { kind: 'delete' });

	const rootDir = process.cwd();
	const [workspaceSource, embedSource, editorSource, popoverSource, pickerDispatchSource, cellChipSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-file-property-editor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/text-field-popover.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/task-field-picker-dispatch.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-cell-chip.ts'), 'utf8'),
	]);

	for (const source of [workspaceSource, embedSource]) {
		ok(source.includes("column.key === 'description' || column.key === 'note'"));
		ok(source.includes('resolveTableTaskTextEditRoute(field, value)'));
		ok(source.includes("editRoute === 'popover'"));
		ok(source.includes('isCompactTaskMarkdownLinkEventTarget(event.target, cell)'));
		ok(source.includes("event.key !== 'Enter' && event.key !== ' '"));
		ok(source.includes("key === 'parentTask' ? (task.fieldValues['parentTask'] ?? '').trim() : ''"));
		ok(source.includes('isSourceModifier: isTaskSourceOpenModifierClick'));
		ok(source.includes('bindTableParentTaskCellActivation(cell, {'));
		ok(source.includes('!!renderState.valueResolver.taskLookup.getTask(rawParentTaskId)'));
		ok(source.includes('formatTableParentTaskTooltipContent(rawParentTaskId, getTaskSourceOpenModifierLabel())'));
		ok(source.includes("focusable: !editable && column.key !== 'parentTask'"));
		ok(!source.includes("cell.setAttribute('role', 'button')"));
	}
	ok(workspaceSource.includes('onOpenEditor: id => this.callbacks.onOpenTaskEditor?.(id)'));
	ok(workspaceSource.includes('onOpenSource: id => this.callbacks.onOpenTaskSource?.(id)'));
	ok(embedSource.includes('onOpenEditor: deps.openTaskEditor'));
	ok(embedSource.includes('onOpenSource: deps.openTaskSource'));
	ok(cellChipSource.includes('bindTableParentTaskTooltip('));
	ok(cellChipSource.includes('options.taskLookup?.getTask(parentTaskId)'));
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
	ok(pickerDispatchSource.includes("case 'taskType':\n\t\tcase 'taskImage':\n\t\tcase 'taskGallery':\n\t\t\treturn openManagedTaskDataFieldPicker(options)"));
	ok(pickerDispatchSource.includes('serializeTaskMediaReferenceList(values)'));

	console.log(`Table text edit route tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTableTextEditRouteTestRun: Promise<void> | undefined;
}

globalThis.__operonTableTextEditRouteTestRun = run();
