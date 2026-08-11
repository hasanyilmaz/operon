import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexedTask } from '../src/types/fields';
import type { OperonSettings } from '../src/types/settings';
import { applyTableColumnCellAccent } from '../src/ui/table/table-cell-chip';
import { resolveTableRandomColumnColor } from '../src/ui/table/table-column-color';
import { renderTableFilePropertyValue } from '../src/ui/table/table-file-property-editor';
import type { TableFilePropertyField } from '../src/ui/table/table-file-property';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function ok(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

class FakeStyle {
	readonly values = new Map<string, string>();

	setProperty(name: string, value: string): void {
		this.values.set(name, value);
	}
}

class FakeElement {
	readonly classes = new Set<string>();
	readonly style = new FakeStyle();
	readonly children: FakeElement[] = [];
	readonly dataset: Record<string, string> = {};
	readonly attributes = new Map<string, string>();
	readonly ownerDocument = fakeDocument;
	tagName: string;
	className = '';
	id = '';
	textContent = '';
	disabled = false;

	constructor(tagName = 'SPAN') {
		this.tagName = tagName;
	}

	addClass(name: string): void {
		this.classes.add(name);
	}

	createSpan(value?: string | { cls?: string; text?: string }): FakeElement {
		const child = new FakeElement('SPAN');
		if (typeof value === 'string') child.addClasses(value);
		else if (value) {
			if (value.cls) child.addClasses(value.cls);
			if (value.text) child.textContent = value.text;
		}
		this.children.push(child);
		return child;
	}

	createEl(tagName: string, options?: { cls?: string; attr?: Record<string, string> }): FakeElement {
		const child = new FakeElement(tagName.toUpperCase());
		if (options?.cls) child.addClasses(options.cls);
		for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
		this.children.push(child);
		return child;
	}

	appendChild(child: FakeElement): FakeElement {
		this.children.push(child);
		return child;
	}

	insertAdjacentElement(_position: string, child: FakeElement): FakeElement {
		this.children.push(child);
		return child;
	}

	querySelector(): FakeElement | null {
		return this.children.find(child => child.dataset.operonAccessibleLabel === 'true') ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}

	addEventListener(): void {}

	private addClasses(value: string): void {
		for (const name of value.split(/\s+/u).filter(Boolean)) this.classes.add(name);
	}
}

const fakeDocument = {
	getElementById: (_id: string): FakeElement | null => null,
	win: { createSpan: (): FakeElement => new FakeElement('SPAN') },
};

function asHtmlElement(element: FakeElement): HTMLElement {
	return element as unknown as HTMLElement;
}

function findChildByClass(element: FakeElement, className: string): FakeElement | undefined {
	return element.children.find(child => child.classes.has(className));
}

function assertAccentContract(element: FakeElement, accent: string): void {
	equal(element.classes.has('operon-table-field-accent-chip'), true);
	for (const variable of [
		'--operon-table-field-accent',
		'--operon-inline-chip-icon-color',
		'--operon-task-chip-hover-accent',
		'--operon-live-hover-border',
	]) {
		equal(element.style.values.get(variable), accent);
	}
}

function countInFunction(source: string, functionName: string, needle: string): number {
	const functionMarker = `function ${functionName}(`;
	const methodMarker = `private ${functionName}(`;
	const functionStart = source.indexOf(functionMarker);
	const methodStart = source.indexOf(methodMarker);
	const start = functionStart >= 0 ? functionStart : methodStart;
	ok(start >= 0, `${functionName} must exist`);
	const nextMarker = functionStart >= 0 ? '\nfunction ' : '\n\tprivate ';
	const nextFunction = source.indexOf(nextMarker, start + 1);
	const body = source.slice(start, nextFunction >= 0 ? nextFunction : source.length);
	return body.split(needle).length - 1;
}

async function run(): Promise<void> {
	const settings = {
		colorPalette: [
			{ id: 'red', name: 'Red', hex: '#aa0000' },
			{ id: 'blue', name: 'Blue', hex: '#0000aa' },
		],
		pipelines: [{
			id: 'pipeline-flow',
			name: 'Flow',
			statuses: [{
				id: 'status-doing',
				label: 'Doing',
				color: '#334455',
				isFinished: false,
				isCancelled: false,
				isScheduledTarget: false,
				isTrackingTarget: false,
				propertyMapping: null,
			}],
		}],
		priorities: [{ id: 'priority-high', label: 'high', color: '#223344' }],
	} as OperonSettings;
	const task = {
		fieldValues: {
			taskColor: 'aa1122',
			priority: 'high',
			status: 'Flow.Doing',
		},
	} as unknown as IndexedTask;
	const columnKey = 'file.property:team';
	const textField = {
		key: columnKey,
		label: 'Team',
		type: 'text',
		group: 'fileProperty',
		icon: 'text',
		readonly: false,
		aliases: [],
		propertyName: 'team',
		sourceType: 'text',
		sourceFileCount: 1,
	} as TableFilePropertyField;

	const expectedByMode = {
		taskColor: '#aa1122',
		priorityColor: '#223344',
		statusColor: '#334455',
	} as const;
	for (const [colorMode, expected] of Object.entries(expectedByMode)) {
		const element = new FakeElement();
		const accent = applyTableColumnCellAccent(
			asHtmlElement(element),
			{ key: columnKey, colorMode: colorMode as keyof typeof expectedByMode },
			'Alpha',
			{ task, settings },
		);
		equal(accent, expected);
		assertAccentContract(element, expected);
	}

	const noColorElement = new FakeElement();
	equal(applyTableColumnCellAccent(
		asHtmlElement(noColorElement),
		{ key: columnKey, colorMode: 'noColor' },
		'Alpha',
		{ task, settings },
	), null);
	equal(noColorElement.classes.size, 0);
	equal(noColorElement.style.values.size, 0);

	const randomAccents: string[] = [];
	for (const value of ['Alpha', 'Beta']) {
		const element = new FakeElement();
		const accent = applyTableColumnCellAccent(
			asHtmlElement(element),
			{ key: columnKey, colorMode: 'randomColors' },
			value,
			{ task, settings },
		);
		ok(accent);
		equal(accent, resolveTableRandomColumnColor(columnKey, value, settings));
		assertAccentContract(element, accent);
		randomAccents.push(accent);
	}
	ok(randomAccents.length === 2);
	const emptyRandomElement = new FakeElement();
	equal(applyTableColumnCellAccent(
		asHtmlElement(emptyRandomElement),
		{ key: columnKey, colorMode: 'randomColors' },
		'',
		{ task, settings },
	), null);
	equal(emptyRandomElement.classes.size, 0);

	const iconOnlyElement = new FakeElement();
	equal(applyTableColumnCellAccent(
		asHtmlElement(iconOnlyElement),
		{ key: columnKey, colorMode: 'taskColor' },
		'',
		{ task, settings, decorateAsChip: false },
	), '#aa1122');
	equal(iconOnlyElement.classes.has('operon-table-field-accent-chip'), false);
	equal(iconOnlyElement.style.values.get('--operon-inline-chip-icon-color'), '#aa1122');

	for (const checkboxValue of ['', 'unsupported']) {
		const checkboxElement = new FakeElement();
		equal(applyTableColumnCellAccent(
			asHtmlElement(checkboxElement),
			{ key: columnKey, colorMode: 'statusColor' },
			checkboxValue,
			{ task, settings },
		), '#334455');
		assertAccentContract(checkboxElement, '#334455');
	}

	const listCell = new FakeElement('DIV');
	equal(renderTableFilePropertyValue({
		cell: asHtmlElement(listCell),
		field: { ...textField, type: 'list' },
		label: 'Team',
		cellValue: { present: true, rawValue: ['Alpha', 'Beta'], normalizedValue: 'Alpha; Beta' },
		column: { key: columnKey, kind: 'task', colorMode: 'randomColors' },
		task,
		settings,
		editable: true,
		onToggle: () => {},
	}), false);
	const listChipParent = findChildByClass(listCell, 'operon-table-cell-chip-list');
	ok(listChipParent);
	equal(listChipParent.children.length, 2);
	for (const [index, value] of ['Alpha', 'Beta'].entries()) {
		equal(
			listChipParent.children[index]?.style.values.get('--operon-table-field-accent'),
			resolveTableRandomColumnColor(columnKey, value, settings),
		);
	}

	const emptyCell = new FakeElement('DIV');
	equal(renderTableFilePropertyValue({
		cell: asHtmlElement(emptyCell),
		field: textField,
		label: 'Team',
		cellValue: { present: false, rawValue: undefined, normalizedValue: '' },
		column: { key: columnKey, kind: 'task', colorMode: 'randomColors' },
		task,
		settings,
		editable: false,
		onToggle: () => {},
	}), false);
	equal(findChildByClass(emptyCell, 'operon-table-empty-value')?.textContent, '--');
	equal(findChildByClass(emptyCell, 'operon-table-field-accent-chip'), undefined);

	const iconCell = new FakeElement('DIV');
	equal(renderTableFilePropertyValue({
		cell: asHtmlElement(iconCell),
		field: textField,
		label: 'Team',
		cellValue: { present: false, rawValue: undefined, normalizedValue: '' },
		column: { key: columnKey, kind: 'task', colorMode: 'taskColor', displayMode: 'icon' },
		task,
		settings,
		editable: false,
		onToggle: () => {},
	}), false);
	const propertyIcon = findChildByClass(iconCell, 'operon-table-file-property-icon');
	ok(propertyIcon);
	equal(propertyIcon.classes.has('operon-table-field-accent-chip'), false);
	equal(propertyIcon.style.values.get('--operon-inline-chip-icon-color'), '#aa1122');

	for (const rawValue of [undefined, 'unsupported']) {
		const checkboxCell = new FakeElement('DIV');
		equal(renderTableFilePropertyValue({
			cell: asHtmlElement(checkboxCell),
			field: { ...textField, type: 'checkbox', sourceType: 'checkbox' },
			label: 'Team',
			cellValue: { present: rawValue !== undefined, rawValue, normalizedValue: rawValue ?? '' },
			column: { key: columnKey, kind: 'task', colorMode: 'statusColor' },
			task,
			settings,
			editable: true,
			onToggle: () => {},
		}), true);
		const checkbox = findChildByClass(checkboxCell, 'operon-table-file-property-checkbox');
		ok(checkbox);
		assertAccentContract(checkbox, '#334455');
	}

	const rootDir = process.cwd();
	const [workspaceSource, embedSource, editorSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-file-property-editor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'styles.css'), 'utf8'),
	]);
	equal(countInFunction(workspaceSource, 'renderFilePropertyCell', 'renderTableFilePropertyValue('), 1);
	equal(countInFunction(embedSource, 'renderEmbedTableFilePropertyCell', 'renderTableFilePropertyValue('), 1);
	ok(editorSource.includes('}): HTMLButtonElement {'));
	ok((editorSource.match(/return button;/gu) ?? []).length >= 3);
	ok(cssSource.includes('color: var(--operon-inline-chip-icon-color, var(--text-muted));'));
	ok(cssSource.includes('.operon-table-file-property-checkbox.operon-table-field-accent-chip:not(:disabled):hover'));
	ok(cssSource.includes('border-color: var(--operon-task-chip-border);'));
	ok(cssSource.includes('.operon-table-file-property-checkbox.operon-table-field-accent-chip:not(:disabled):focus-visible {\n\t\toutline-color: ButtonText;'));

	console.log(`Table file-property color tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTableFilePropertyColorTestRun: Promise<void> | undefined;
}

globalThis.__operonTableFilePropertyColorTestRun = run();
