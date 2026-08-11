import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexedTask } from '../src/types/fields';
import type { OperonSettings } from '../src/types/settings';
import {
	applyTableColumnCellAccent,
	formatTableCellListChipDisplayValue,
	isTableListValueChipOverflowing,
	renderTableCellChips,
} from '../src/ui/table/table-cell-chip';
import { resolveTableRandomColumnColor } from '../src/ui/table/table-column-color';
import { renderTableFilePropertyValue } from '../src/ui/table/table-file-property-editor';
import type { TableFilePropertyField } from '../src/ui/table/table-file-property';
import { renderTableDescriptionCellContent } from '../src/ui/table/table-description-cell';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message === undefined) assert.equal(actual, expected);
	else assert.equal(actual, expected, message);
	assertions += 1;
}

function ok(value: unknown, message?: string): asserts value {
	if (message === undefined) assert.ok(value);
	else assert.ok(value, message);
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
	parentElement: FakeElement | null = null;
	tagName: string;
	className = '';
	id = '';
	textContent = '';
	disabled = false;
	scrollWidth = 0;
	clientWidth = 0;
	left = 0;
	right = 0;
	tabIndex = -1;
	readonly listeners = new Map<string, Array<(event: any) => void>>();

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
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	createEl(tagName: string, options?: { cls?: string; attr?: Record<string, string> }): FakeElement {
		const child = new FakeElement(tagName.toUpperCase());
		if (options?.cls) child.addClasses(options.cls);
		for (const [name, value] of Object.entries(options?.attr ?? {})) child.setAttribute(name, value);
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	appendChild(child: FakeElement): FakeElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	insertAdjacentElement(_position: string, child: FakeElement): FakeElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	querySelector(selector?: string): FakeElement | null {
		if (!selector) return null;
		const className = selector.startsWith('.') ? selector.slice(1) : null;
		for (const child of this.children) {
			if (className && child.classes.has(className)) return child;
			if (selector.includes('data-operon-accessible-label') && child.dataset.operonAccessibleLabel === 'true') return child;
			const nested = child.querySelector(selector);
			if (nested) return nested;
		}
		return null;
	}

	closest(selector: string): FakeElement | null {
		const className = selector.startsWith('.') ? selector.slice(1) : null;
		let current: FakeElement | null = this;
		while (current) {
			if (className && current.classes.has(className)) return current;
			current = current.parentElement;
		}
		return null;
	}

	getBoundingClientRect(): DOMRect {
		return { left: this.left, right: this.right } as DOMRect;
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

	removeClass(name: string): void {
		this.classes.delete(name);
	}

	empty(): void {
		this.children.length = 0;
		this.textContent = '';
	}

	setText(value: string): void {
		this.textContent = value;
	}

	addEventListener(type: string, listener: (event: any) => void): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, overrides: Record<string, unknown> = {}): void {
		const event = {
			target: this,
			key: '',
			preventDefault() {},
			stopPropagation() {},
			...overrides,
		};
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

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

function findDescendantByClass(element: FakeElement, className: string): FakeElement | undefined {
	if (element.classes.has(className)) return element;
	for (const child of element.children) {
		const match = findDescendantByClass(child, className);
		if (match) return match;
	}
	return undefined;
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
		keyMappings: [],
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
	} as unknown as OperonSettings;
	const task = {
		fieldValues: {
			taskColor: 'aa1122',
			priority: 'high',
			status: 'Flow.Doing',
		},
	} as unknown as IndexedTask;

	const wikilinkCases = new Map([
		['[[Folder/Note]]', 'Note'],
		['[[Folder/Note.md]]', 'Note'],
		['![[Folder/Note.md]]', 'Note'],
		['[[Folder/Note.md|Visible alias]]', 'Visible alias'],
		['[[Folder/Note.md|]]', 'Note'],
		['[[Folder/Note.md#Heading]]', 'Note#Heading'],
		['[[Folder/Note.md^block]]', 'Note^block'],
		['prefix [[Folder/Note.md]] suffix', 'prefix [[Folder/Note.md]] suffix'],
		['plain value', 'plain value'],
	]);
	for (const [rawValue, displayValue] of wikilinkCases) {
		equal(formatTableCellListChipDisplayValue(rawValue), displayValue);
	}

	const canonicalListCell = new FakeElement('DIV');
	renderTableCellChips(
		asHtmlElement(canonicalListCell),
		'contexts',
		'[[Folder/Note.md]]; [[Other|Alias]]',
		{
			chipClassName: 'operon-table-cell-chip',
			settings,
		},
	);
	const canonicalListWrapper = findChildByClass(canonicalListCell, 'operon-table-cell-chip-list');
	ok(canonicalListWrapper);
	equal(canonicalListWrapper.children.length, 2);
	equal(findDescendantByClass(canonicalListWrapper.children[0]!, 'operon-table-cell-chip-label')?.textContent, 'Note');
	equal(findDescendantByClass(canonicalListWrapper.children[1]!, 'operon-table-cell-chip-label')?.textContent, 'Alias');
	equal(findDescendantByClass(canonicalListWrapper, 'internal-link'), undefined);

	const singleListCell = new FakeElement('DIV');
	renderTableCellChips(asHtmlElement(singleListCell), 'contexts', 'One', {
		chipClassName: 'operon-table-cell-chip',
		settings,
	});
	equal(findChildByClass(singleListCell, 'operon-table-cell-chip-list')?.children.length, 1);

	const dependencyDescription = 'A dependency description that remains complete until CSS clips it';
	const dependencyCell = new FakeElement('DIV');
	renderTableCellChips(asHtmlElement(dependencyCell), 'blockedBy', 'parent-1', {
		chipClassName: 'operon-table-cell-chip',
		settings,
		taskLookup: {
			getTask: () => ({
				operonId: 'parent-1',
				description: dependencyDescription,
				fieldValues: { status: '' },
			}) as unknown as IndexedTask,
		},
	});
	const dependencyWrapper = findChildByClass(dependencyCell, 'operon-table-cell-chip-list');
	ok(dependencyWrapper);
	equal(findDescendantByClass(dependencyWrapper, 'operon-table-cell-chip-label')?.textContent, dependencyDescription);
	equal(findDescendantByClass(dependencyWrapper, 'operon-table-cell-chip-icon'), undefined);

	const overflowWrapper = new FakeElement('SPAN');
	overflowWrapper.addClass('operon-table-cell-chip-list');
	overflowWrapper.left = 0;
	overflowWrapper.right = 100;
	const overflowChip = new FakeElement('SPAN');
	overflowChip.left = 0;
	overflowChip.right = 80;
	const overflowLabel = overflowChip.createSpan('operon-table-cell-chip-label');
	overflowLabel.scrollWidth = 81;
	overflowLabel.clientWidth = 80;
	overflowWrapper.appendChild(overflowChip);
	equal(isTableListValueChipOverflowing(asHtmlElement(overflowChip)), false);
	overflowLabel.scrollWidth = 82;
	equal(isTableListValueChipOverflowing(asHtmlElement(overflowChip)), true);
	overflowLabel.scrollWidth = 80;
	overflowChip.right = 102;
	equal(isTableListValueChipOverflowing(asHtmlElement(overflowChip)), true);
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

	let textPopoverOpens = 0;
	const detailedPopoverCell = new FakeElement('DIV');
	renderTableDescriptionCellContent(asHtmlElement(detailedPopoverCell), {
		value: 'Detailed text',
		fieldLabel: 'Description',
		editLabel: 'Edit cell',
		onOpen: () => { textPopoverOpens += 1; },
	});
	equal(findDescendantByClass(detailedPopoverCell, 'operon-table-description-input'), undefined);
	detailedPopoverCell.dispatch('click');
	equal(textPopoverOpens, 1, 'detailed text must open the popover rather than an inline input');
	detailedPopoverCell.dispatch('keydown', { key: 'Enter' });
	equal(textPopoverOpens, 2);

	const emptyCompactPopoverCell = new FakeElement('DIV');
	renderTableDescriptionCellContent(asHtmlElement(emptyCompactPopoverCell), {
		value: '',
		fieldLabel: 'Note',
		editLabel: 'Edit cell',
		iconOnly: {
			icon: 'sticky-note',
			color: null,
			title: 'Note',
			content: '--',
			ariaLabel: 'Note: --',
		},
		onOpen: () => { textPopoverOpens += 1; },
	});
	equal(findDescendantByClass(emptyCompactPopoverCell, 'operon-table-icon-only-button'), undefined);
	emptyCompactPopoverCell.dispatch('click');
	equal(textPopoverOpens, 3, 'empty compact text must remain clickable without rendering an icon');

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
		equal(listChipParent.children[index]?.classes.has('operon-table-list-value-chip'), true);
		equal(findDescendantByClass(listChipParent.children[index]!, 'operon-table-cell-chip-label')?.textContent, value);
		equal(
			listChipParent.children[index]?.style.values.get('--operon-table-field-accent'),
			resolveTableRandomColumnColor(columnKey, value, settings),
		);
	}

	const wikilinkListCell = new FakeElement('DIV');
	equal(renderTableFilePropertyValue({
		cell: asHtmlElement(wikilinkListCell),
		field: { ...textField, type: 'list' },
		label: 'Team',
		cellValue: { present: true, rawValue: ['[[Folder/Cast.md|Cast label]]'], normalizedValue: '[[Folder/Cast.md|Cast label]]' },
		column: { key: columnKey, kind: 'task', colorMode: 'randomColors' },
		task,
		settings,
		editable: true,
		onToggle: () => {},
	}), false);
	const wikilinkListChip = findChildByClass(wikilinkListCell, 'operon-table-cell-chip-list')?.children[0];
	ok(wikilinkListChip);
	equal(findDescendantByClass(wikilinkListChip, 'operon-table-cell-chip-label')?.textContent, 'Cast label');
	equal(
		wikilinkListChip.style.values.get('--operon-table-field-accent'),
		resolveTableRandomColumnColor(columnKey, '[[Folder/Cast.md|Cast label]]', settings),
	);

	const detailedTextCell = new FakeElement('DIV');
	equal(renderTableFilePropertyValue({
		cell: asHtmlElement(detailedTextCell),
		field: textField,
		label: 'Team',
		cellValue: { present: true, rawValue: 'A long summary', normalizedValue: 'A long summary' },
		column: { key: columnKey, kind: 'task', colorMode: 'randomColors' },
		task,
		settings,
		editable: false,
		onToggle: () => {},
	}), false);
	equal(detailedTextCell.classes.has('operon-table-text-cell'), true);
	equal(findDescendantByClass(detailedTextCell, 'operon-table-plain-text-value')?.textContent, 'A long summary');
	equal(findChildByClass(detailedTextCell, 'operon-table-cell-chip'), undefined);
	equal(findChildByClass(detailedTextCell, 'operon-table-field-accent-chip'), undefined);

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
	equal(findChildByClass(iconCell, 'operon-table-icon-only-button'), undefined);
	equal(iconCell.classes.has('operon-table-icon-only-cell'), false);

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
	const [workspaceSource, embedSource, editorSource, chipSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-file-property-editor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-cell-chip.ts'), 'utf8'),
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
	ok(cssSource.includes('--operon-table-detailed-value-max-width: 168px;'));
	ok(cssSource.includes('max-width: min(100%, var(--operon-table-detailed-value-max-width));'));
	ok(cssSource.includes('.operon-table-list-value-chip {\n\tflex: 0 0 auto;'));
	ok(cssSource.includes('max-width: var(--operon-table-detailed-value-max-width);'));
	ok(cssSource.includes('.operon-table-cell-chip-list {\n\tdisplay: flex;'));
	ok(cssSource.includes('background-color: transparent;'));
	ok(cssSource.includes('box-shadow: 0 0 0 2px var(--operon-task-chip-focus-ring);'));
	ok(cssSource.includes('.operon-table-plain-text-value,'));
	ok(editorSource.includes('formatTableCellListChipDisplayValue(value)'));
	ok(editorSource.includes("options.field?.type === 'text' && options.field.unavailable !== true"));
	ok(editorSource.includes('renderTableTextValueDisplay(options.cell'));
	ok(editorSource.includes('renderTableIconOnlyCell(options.cell'));
	ok(chipSource.includes('bindOperonHoverTooltip(chip, {\n\t\tcontent: displayValue,'));
	ok(chipSource.includes('shouldOpen: () => isTableListValueChipOverflowing(chip),'));
	ok(workspaceSource.includes('renderTableCellChips('));
	ok(embedSource.includes('renderTableCellChips('));
	ok(workspaceSource.includes('isCompactTaskMarkdownLinkEventTarget(event.target, cell)'));
	ok(embedSource.includes('isCompactTaskMarkdownLinkEventTarget(event.target, cell)'));
	ok(workspaceSource.includes('contentEl: createCompactTaskMarkdownTooltipContent(cell, value)'));
	ok(embedSource.includes('contentEl: createCompactTaskMarkdownTooltipContent(cell, value)'));
	ok(editorSource.includes('contentEl: createCompactTaskMarkdownTooltipContent(options.cell, options.cellValue.normalizedValue)'));
	ok(workspaceSource.includes('onOpen: canOpenTextPopover'));
	ok(embedSource.includes('onOpen: canOpenTextPopover'));
	equal(workspaceSource.includes('onInlineEditStart:'), false);
	equal(embedSource.includes('onInlineEditStart:'), false);

	console.log(`Table file-property color tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTableFilePropertyColorTestRun: Promise<void> | undefined;
}

globalThis.__operonTableFilePropertyColorTestRun = run();
