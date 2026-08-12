import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexedTask } from '../src/types/fields';
import type { OperonSettings } from '../src/types/settings';
import { buildWorkflowStatusIdentityIndex } from '../src/core/workflow-status-identity';
import { t } from '../src/core/i18n';
import {
	applyTableColumnCellAccent,
	decorateTableDateValueChip,
	formatTableCellListChipDisplayValue,
	formatTableListIconOnlyTooltipContent,
	isTableDateLikeFieldType,
	isTableListValueChipOverflowing,
	renderTableCellChips,
} from '../src/ui/table/table-cell-chip';
import { resolveTableRandomColumnColor } from '../src/ui/table/table-column-color';
import { renderTableFilePropertyValue } from '../src/ui/table/table-file-property-editor';
import type { TableFilePropertyField } from '../src/ui/table/table-file-property';
import { renderTableDescriptionCellContent } from '../src/ui/table/table-description-cell';
import { renderTableCompactDatetimeCell, renderTableIconOnlyCell } from '../src/ui/table/table-icon-only-cell';
import { renderTableProgressCell } from '../src/ui/table/table-progress-cell';

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

	setCssProps(properties: Record<string, string>): void {
		for (const [name, value] of Object.entries(properties)) this.style.setProperty(name, value);
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

	remove(): void {
		if (!this.parentElement) return;
		const index = this.parentElement.children.indexOf(this);
		if (index >= 0) this.parentElement.children.splice(index, 1);
		this.parentElement = null;
	}

	querySelector(selector?: string): FakeElement | null {
		if (!selector) return null;
		const className = selector.startsWith('.') ? selector.slice(1) : null;
		for (const child of this.children) {
			if (selector.toLowerCase() === child.tagName.toLowerCase()) return child;
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
	equal(
		element.style.values.get('--operon-task-chip-hover-border'),
		'color-mix(in srgb, var(--operon-table-field-accent) 62%, var(--background-modifier-border))',
	);
	equal(
		element.style.values.get('--operon-task-chip-focus-ring'),
		'color-mix(in srgb, var(--operon-task-chip-hover-border) 38%, transparent)',
	);
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
	(globalThis as typeof globalThis & {
		__operonTestSetIcon?: (target: FakeElement, name: string) => void;
	}).__operonTestSetIcon = target => {
		target.appendChild(new FakeElement('SVG'));
	};
	const settings = {
		keyMappings: [
			{
				canonicalKey: 'customDate',
				visiblePropertyName: 'Custom date',
				type: 'date',
				sync: 'yes',
				enabled: true,
				isSystem: false,
				customOrder: 0,
			},
			{
				canonicalKey: 'customDatetime',
				visiblePropertyName: 'Custom datetime',
				type: 'datetime',
				sync: 'yes',
				enabled: true,
				isSystem: false,
				customOrder: 1,
			},
		],
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
	const workflowStatusIdentityIndex = buildWorkflowStatusIdentityIndex(settings.pipelines);

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
	equal(
		formatTableListIconOnlyTooltipContent(['[[Folder/Cast.md|Cast label]]', '[[Crew.md]]', ' Plain ']),
		'Cast label\nCrew\nPlain',
	);

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
	ok(findDescendantByClass(dependencyWrapper, 'operon-table-cell-chip-icon'));
	const blockedByChip = findDescendantByClass(dependencyWrapper, 'operon-table-blocked-by-state-chip');
	ok(blockedByChip);
	assertAccentContract(blockedByChip, '#dc2626');

	const blockingCell = new FakeElement('DIV');
	renderTableCellChips(asHtmlElement(blockingCell), 'blocking', 'parent-1', {
		chipClassName: 'operon-table-cell-chip',
		column: { key: 'blocking', colorMode: 'taskColor' },
		task,
		settings,
		taskLookup: {
			getTask: () => ({
				operonId: 'parent-1',
				description: dependencyDescription,
				fieldValues: { status: '' },
			}) as unknown as IndexedTask,
		},
	});
	const blockingChip = findDescendantByClass(blockingCell, 'operon-table-cell-chip');
	ok(blockingChip);
	ok(findDescendantByClass(blockingCell, 'operon-table-cell-chip-icon'));
	equal(findDescendantByClass(blockingCell, 'operon-table-cell-chip-label')?.textContent, dependencyDescription);
	assertAccentContract(blockingChip, '#aa1122');

	const overdueDueCell = new FakeElement('DIV');
	renderTableCellChips(asHtmlElement(overdueDueCell), 'dateDue', '2000-01-01', {
		chipClassName: 'operon-table-cell-chip',
		column: { key: 'dateDue', colorMode: 'taskColor' },
		task,
		settings,
	});
	const overdueDueChip = findDescendantByClass(overdueDueCell, 'operon-table-date-state-chip');
	ok(overdueDueChip);
	equal(overdueDueChip.classes.has('is-overdue'), true);
	assertAccentContract(overdueDueChip, '#dc2626');

	const taskIconCell = new FakeElement('DIV');
	renderTableCellChips(asHtmlElement(taskIconCell), 'taskIcon', 'github', {
		chipClassName: 'operon-table-cell-chip',
		column: { key: 'taskIcon', colorMode: 'taskColor' },
		task,
		settings,
	});
	ok(findDescendantByClass(taskIconCell, 'operon-table-cell-chip-icon'));
	equal(findDescendantByClass(taskIconCell, 'operon-table-cell-chip-label')?.textContent, 'github');
	assertAccentContract(findDescendantByClass(taskIconCell, 'operon-table-cell-chip')!, '#aa1122');

	const taskColorCell = new FakeElement('DIV');
	renderTableCellChips(asHtmlElement(taskColorCell), 'taskColor', '#aa1122', {
		chipClassName: 'operon-table-cell-chip',
		column: { key: 'taskColor', colorMode: 'statusColor' },
		task,
		settings,
	});
	assertAccentContract(findDescendantByClass(taskColorCell, 'operon-table-cell-chip')!, '#aa1122');

	for (const [key, value, accent] of [
		['status', 'Flow.Doing', '#334455'],
		['priority', 'high', '#223344'],
	] as const) {
		const structuredTextCell = new FakeElement('DIV');
		renderTableCellChips(asHtmlElement(structuredTextCell), key, value, {
			chipClassName: 'operon-table-cell-chip',
			column: { key },
			task,
			settings,
		});
		const structuredTextChip = findDescendantByClass(structuredTextCell, 'operon-table-cell-chip');
		ok(structuredTextChip);
		equal(findDescendantByClass(structuredTextChip, 'operon-table-cell-chip-label')?.textContent, value);
		equal(structuredTextChip.classes.has('operon-table-date-value-chip'), false);
		assertAccentContract(structuredTextChip, accent);
	}

	for (const type of ['date', 'datetime'] as const) {
		equal(isTableDateLikeFieldType(type), true);
	}
	for (const type of [undefined, 'text', 'number', 'list']) {
		equal(isTableDateLikeFieldType(type), false);
	}
	const undecoratedTemporalChip = new FakeElement('SPAN');
	decorateTableDateValueChip(asHtmlElement(undecoratedTemporalChip), 'text');
	equal(undecoratedTemporalChip.classes.has('operon-table-date-value-chip'), false);

	for (const [key, value] of [
		['dateStarted', '2026-08-12'],
		['datetimeStart', '2026-08-12T10:30:00'],
		['customDate', '2026-08-12'],
		['customDatetime', '2026-08-12T10:30:00'],
	] as const) {
		for (const colorMode of ['noColor', 'taskColor', 'priorityColor', 'statusColor', 'randomColors'] as const) {
			const temporalCell = new FakeElement('DIV');
			renderTableCellChips(asHtmlElement(temporalCell), key, value, {
				chipClassName: 'operon-table-cell-chip',
				column: { key, colorMode },
				task,
				settings,
			});
			const temporalChip = findDescendantByClass(temporalCell, 'operon-table-cell-chip');
			ok(temporalChip, `${key}/${colorMode} must render a detailed chip`);
			equal(temporalChip.classes.has('operon-table-date-value-chip'), true, `${key}/${colorMode} must keep a neutral fill contract`);
			const expectedAccent = colorMode === 'noColor'
				? null
				: colorMode === 'taskColor'
					? '#aa1122'
					: colorMode === 'priorityColor'
						? '#223344'
						: colorMode === 'statusColor'
							? '#334455'
							: resolveTableRandomColumnColor(key, value, settings);
			if (expectedAccent) assertAccentContract(temporalChip, expectedAccent);
			else equal(temporalChip.classes.has('operon-table-field-accent-chip'), false);
		}
	}

	const compactDateCell = new FakeElement('DIV');
	const compactDateControl = renderTableIconOnlyCell(asHtmlElement(compactDateCell), {
		icon: 'calendar',
		title: 'Date',
		content: '2026-08-12',
		ariaLabel: 'Date: 2026-08-12',
		color: '#aa1122',
		showTooltip: false,
	});
	equal(compactDateCell.classes.has('operon-table-icon-only-cell'), true);
	equal((compactDateControl as unknown as FakeElement).style.values.get('--operon-table-icon-only-color'), '#aa1122');

	const compactDatetimeCell = new FakeElement('DIV');
	const compactDatetimeControl = renderTableCompactDatetimeCell(asHtmlElement(compactDatetimeCell), {
		value: '2026-08-12T10:30:00',
		timeFormat: '24h',
		title: 'Datetime',
		content: '2026-08-12 10:30',
		ariaLabel: 'Datetime: 2026-08-12 10:30',
		color: '#334455',
		showTooltip: false,
	});
	equal(compactDatetimeCell.classes.has('operon-table-icon-only-cell'), true);
	equal((compactDatetimeControl as unknown as FakeElement).classes.has('operon-table-compact-datetime'), true);
	equal((compactDatetimeControl as unknown as FakeElement).style.values.get('--operon-table-icon-only-color'), '#334455');

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
	for (const key of ['estimate', 'totalEstimate', 'totalDuration']) {
		const cell = new FakeElement('DIV');
		renderTableCellChips(asHtmlElement(cell), key, '3600', {
			chipClassName: 'operon-table-cell-chip operon-chip',
			column: { key, colorMode: 'noColor' },
			task,
			settings,
		});
		equal(cell.children[0]?.classes.has('operon-table-duration-like-chip'), true, `${key} must use the shared duration-like visual contract`);
	}

	const missingColorTask = {
		fieldValues: {
			taskColor: '',
			priority: 'uncolored-priority',
			status: 'Flow.Uncolored',
		},
	} as unknown as IndexedTask;
	for (const colorMode of ['taskColor', 'priorityColor', 'statusColor'] as const) {
		const element = new FakeElement();
		equal(applyTableColumnCellAccent(
			asHtmlElement(element),
			{ key: columnKey, colorMode },
			'Alpha',
			{ task: missingColorTask, settings },
		), null, `${colorMode} without a source color must behave like noColor`);
		equal(element.classes.size, 0);
		equal(element.style.values.size, 0);
	}

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

	const emptyDetailedPopoverCell = new FakeElement('DIV');
	renderTableDescriptionCellContent(asHtmlElement(emptyDetailedPopoverCell), {
		value: '',
		fieldLabel: 'Description',
		editLabel: 'Edit cell',
		onOpen: () => { textPopoverOpens += 1; },
	});
	equal(findDescendantByClass(emptyDetailedPopoverCell, 'operon-table-description-text')?.textContent, '');
	emptyDetailedPopoverCell.dispatch('keydown', { key: ' ' });
	equal(textPopoverOpens, 4, 'empty detailed text must remain keyboard editable without a dash');

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

	for (const editable of [true, false]) {
		const compactListCell = new FakeElement('DIV');
		equal(renderTableFilePropertyValue({
			cell: asHtmlElement(compactListCell),
			field: { ...textField, type: 'list', icon: 'users' },
			label: 'Cast',
			cellValue: {
				present: true,
				rawValue: ['[[Folder/Cast.md|Cast label]]', '[[Crew.md]]', 'Plain'],
				normalizedValue: '[[Folder/Cast.md|Cast label]]; [[Crew.md]]; Plain',
			},
			column: { key: columnKey, kind: 'task', colorMode: 'taskColor', displayMode: 'icon' },
			task,
			settings,
			editable,
			onToggle: () => {},
		}), false);
		equal(compactListCell.classes.has('operon-table-icon-only-cell'), true);
		const compactListIcon = findChildByClass(compactListCell, 'operon-table-icon-only-button');
		ok(compactListIcon);
		equal(findChildByClass(compactListCell, 'operon-table-file-property-icon'), undefined);
		equal(compactListIcon.tabIndex, editable ? -1 : 0);
		equal(compactListIcon.attributes.get('role'), 'img');
		equal(compactListIcon.style.values.get('--operon-table-icon-only-color'), '#aa1122');
		equal(
			compactListIcon.children.find(child => child.dataset.operonAccessibleLabel === 'true')?.textContent,
			'Cast: Cast label\nCrew\nPlain',
		);
		ok((compactListIcon.listeners.get('mouseenter')?.length ?? 0) > 0);
		equal(compactListIcon.listeners.has('keydown'), false);
	}

	for (const rawValue of [[], [''], ['   '], [null]]) {
		const emptyCompactListCell = new FakeElement('DIV');
		equal(renderTableFilePropertyValue({
			cell: asHtmlElement(emptyCompactListCell),
			field: { ...textField, type: 'list', icon: 'users' },
			label: 'Cast',
			cellValue: { present: true, rawValue, normalizedValue: '' },
			column: { key: columnKey, kind: 'task', colorMode: 'taskColor', displayMode: 'icon' },
			task,
			settings,
			editable: true,
			onToggle: () => {},
		}), false);
		equal(findChildByClass(emptyCompactListCell, 'operon-table-icon-only-button'), undefined);
		equal(findChildByClass(emptyCompactListCell, 'operon-table-file-property-icon'), undefined);
	}

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

	for (const type of ['date', 'datetime'] as const) {
		for (const colorMode of ['noColor', 'taskColor', 'priorityColor', 'statusColor', 'randomColors'] as const) {
			const temporalFilePropertyCell = new FakeElement('DIV');
			equal(renderTableFilePropertyValue({
				cell: asHtmlElement(temporalFilePropertyCell),
				field: { ...textField, type, sourceType: type },
				label: type === 'date' ? 'Review date' : 'Review time',
				cellValue: {
					present: true,
					rawValue: type === 'date' ? '2026-08-12' : '2026-08-12T10:30:00',
					normalizedValue: type === 'date' ? '2026-08-12' : '2026-08-12T10:30:00',
				},
				column: { key: columnKey, kind: 'task', colorMode },
				task,
				settings,
				editable: true,
				onToggle: () => {},
			}), false);
			const temporalFilePropertyChip = findChildByClass(temporalFilePropertyCell, 'operon-table-cell-chip');
			ok(temporalFilePropertyChip, `File Property ${type}/${colorMode} must render a detailed chip`);
			equal(temporalFilePropertyChip.classes.has('operon-table-date-value-chip'), true, `File Property ${type}/${colorMode} must keep a neutral fill contract`);
			const rawValue = type === 'date' ? '2026-08-12' : '2026-08-12T10:30:00';
			const expectedAccent = colorMode === 'noColor'
				? null
				: colorMode === 'taskColor'
					? '#aa1122'
					: colorMode === 'priorityColor'
						? '#223344'
						: colorMode === 'statusColor'
							? '#334455'
							: resolveTableRandomColumnColor(columnKey, rawValue, settings);
			if (expectedAccent) assertAccentContract(temporalFilePropertyChip, expectedAccent);
			else equal(temporalFilePropertyChip.classes.has('operon-table-field-accent-chip'), false);
		}
	}

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
		equal(findDescendantByClass(checkbox, 'operon-table-file-property-checkbox-label'), undefined);
	}

	const editableProgressLabels: string[] = [];
	for (const iconOnly of [false, true]) {
		const emptyProgressCell = new FakeElement('DIV');
		const activations: Array<{ kind: string; track: unknown; trigger: FakeElement; rect: DOMRect }> = [];
		const activationResolvers: Array<() => void> = [];
		renderTableProgressCell(asHtmlElement(emptyProgressCell), {
			task,
			column: { key: 'checkboxProgress', kind: 'task' },
			settings,
			valueResolver: {
				getProgressTrack: () => null,
				workflowStatusIdentityIndex,
			},
			iconOnly,
			onActivate: ({ kind, track, trigger, actionAnchorRect }) => {
				activations.push({
					kind,
					track,
					trigger: trigger as unknown as FakeElement,
					rect: actionAnchorRect,
				});
				return new Promise<void>(resolve => activationResolvers.push(resolve));
			},
		});
		const emptyShell = findDescendantByClass(emptyProgressCell, 'operon-table-progress-action-shell');
		const emptyButton = findDescendantByClass(emptyProgressCell, 'operon-table-progress-action');
		ok(emptyShell);
		ok(emptyButton);
		equal(emptyShell.classes.has('is-empty-mode'), true);
		equal(findDescendantByClass(emptyProgressCell, 'operon-table-progress-track'), undefined);
		equal(findDescendantByClass(emptyProgressCell, 'operon-table-progress-ring'), undefined);
		equal(findDescendantByClass(emptyProgressCell, 'operon-table-empty-value'), undefined);
		equal(emptyButton.attributes.get('aria-haspopup'), 'dialog');
		equal(emptyButton.attributes.has('aria-describedby'), false);
		const editableProgressLabel = emptyButton.querySelector('[data-operon-accessible-label="true"]')?.textContent ?? '';
		ok(editableProgressLabel.length > 0);
		ok(editableProgressLabel.includes(t('table', 'editCellAria')));
		editableProgressLabels.push(editableProgressLabel);
		emptyButton.dispatch('click');
		emptyButton.dispatch('click');
		equal(activations.length, 1);
		equal(activations[0]?.kind, 'checkboxes');
		equal(activations[0]?.track, null);
		equal(activations[0]?.trigger, emptyButton);
		equal(activations[0]?.rect.left, emptyButton.left);
		activationResolvers.shift()?.();
		await Promise.resolve();
		await Promise.resolve();
		emptyButton.dispatch('click');
		equal(activations.length, 2);
		activationResolvers.shift()?.();
	}

	const emptyReadOnlyProgressCell = new FakeElement('DIV');
	renderTableProgressCell(asHtmlElement(emptyReadOnlyProgressCell), {
		task,
		column: { key: 'checkboxProgress', kind: 'task' },
		settings,
		valueResolver: {
			getProgressTrack: () => null,
			workflowStatusIdentityIndex,
		},
		iconOnly: false,
	});
	equal(findDescendantByClass(emptyReadOnlyProgressCell, 'operon-table-progress-action'), undefined);
	equal(findDescendantByClass(emptyReadOnlyProgressCell, 'operon-table-empty-value'), undefined);
	const readOnlyProgressLabel = emptyReadOnlyProgressCell.querySelector('[data-operon-accessible-label="true"]')?.textContent ?? '';
	ok(readOnlyProgressLabel.length > 0);
	equal(readOnlyProgressLabel.includes(t('table', 'editCellAria')), false);
	equal(editableProgressLabels.every(label => label.length > readOnlyProgressLabel.length), true);

	const rootDir = process.cwd();
	const [mainSource, workspaceSource, embedSource, editorSource, descriptionSource, progressSource, chipSource, cssSource] = await Promise.all([
		readFile(path.join(rootDir, 'main.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-file-property-editor.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-description-cell.ts'), 'utf8'),
		readFile(path.join(rootDir, 'src/ui/table/table-progress-cell.ts'), 'utf8'),
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
	ok(cssSource.includes('.operon-table-file-property-checkbox.operon-table-field-accent-chip:not(:disabled):focus-visible {\n\t\toutline: 2px solid ButtonText;'));
	ok(cssSource.includes('--operon-table-detailed-value-max-width: 168px;'));
	ok(cssSource.includes('max-width: min(100%, var(--operon-table-detailed-value-max-width));'));
	ok(cssSource.includes('.operon-table-list-value-chip {\n\tflex: 0 0 auto;'));
	ok(cssSource.includes('max-width: var(--operon-table-detailed-value-max-width);'));
	ok(cssSource.includes('.operon-table-cell-chip-list {\n\tdisplay: flex;'));
	ok(cssSource.includes('--operon-table-chip-glow-size: 2px;'));
	ok(cssSource.includes('--operon-table-progress-segment-glow-size: 1px;'));
	ok(cssSource.includes('--operon-table-row-highlight-size: 1px;'));
	ok(cssSource.includes('--operon-task-chip-bg: transparent;'));
	ok(cssSource.includes('--operon-task-chip-hover-bg: transparent;'));
	ok(cssSource.includes('.operon-table-root .operon-table-cell-chip,'));
	ok(cssSource.includes('.operon-table-duration-like-chip'));
	ok(cssSource.includes('.operon-table-duration-session-list {\n\tdisplay: flex;'));
	ok(cssSource.includes('button.operon-table-duration-session-chip:hover,\nbutton.operon-table-duration-session-chip:focus-visible {\n\tborder-color: var(--operon-task-chip-hover-border);'));
	ok(cssSource.includes('button.operon-table-source-button:hover,\nbutton.operon-table-source-button:focus-visible {\n\tborder-color: var(--operon-task-chip-hover-border);'));
	ok(cssSource.includes('.operon-table-root .operon-table-cell-chip:is(:hover, .is-operon-chip-hovered, :focus-visible)'));
	ok(cssSource.includes('button.operon-table-task-icon-button:not(:disabled):not(.is-readonly):hover,'));
	ok(cssSource.includes('button.operon-table-task-type-button:hover,'));
	ok(cssSource.includes('.operon-table-icon-only-button:hover,\n.operon-table-icon-only-button:focus-visible {'));
	ok(cssSource.includes('button.operon-table-duration-session-chip:hover,\nbutton.operon-table-duration-session-chip:focus-visible {'));
	ok(cssSource.includes('button.operon-table-source-button:hover,\nbutton.operon-table-source-button:focus-visible {'));
	ok(cssSource.includes('.operon-table-progress-action-shell.is-details-mode:is(:hover, :focus-within) .operon-task-progress-segment'));
	ok(cssSource.includes('box-shadow: 0 0 0 var(--operon-table-progress-segment-glow-size, 1px) color-mix(in srgb, var(--operon-task-progress-color) 28%, transparent);'));
	ok(cssSource.includes('.operon-table-progress-action-shell.is-icon-mode:is(:hover, :focus-within)'));
	ok(!cssSource.includes('.operon-table-progress-action-shell:not(.is-empty-mode):is(:hover, :focus-within)'));
	ok(cssSource.includes('.operon-table-progress-action-shell.is-empty-mode:focus-within {\n\tbox-shadow: inset 0 0 0 var(--operon-table-chip-glow-size, 2px)'));
	ok(cssSource.includes('.operon-table-progress-cell.is-details-mode:not(:has(.operon-table-progress-action-shell)):hover > .operon-table-progress-wrap .operon-task-progress-segment'));
	ok(cssSource.includes('.operon-table-progress-cell:not(:has(.operon-table-progress-action-shell)):hover > .operon-table-progress-ring'));
	ok(cssSource.includes('.operon-table-root button.operon-table-file-property-checkbox:not(:disabled):hover,'));
	ok(cssSource.includes('button.operon-table-task-icon-button:disabled:hover,'));
	ok(cssSource.includes('.operon-table-root button.operon-table-file-property-checkbox:disabled:hover'));
	ok(cssSource.includes('.operon-table-root .operon-table-progress-action-shell:focus-within,'));
	ok(cssSource.includes('@media (hover: hover) and (pointer: fine) {'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-description-text:not(.is-empty)'));
	ok(cssSource.includes('.operon-table-root .operon-table-parent-task-chip,'));
	ok(cssSource.includes('.operon-table-root .operon-table-parent-task-cell:focus-visible :is(.operon-table-parent-task-chip, .operon-table-icon-only-button)'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-cell-chip:not(.operon-table-file-property-checkbox):not(.operon-table-parent-task-chip):not(.operon-table-field-accent-chip)'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-parent-task-chip'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-duration-like-chip'));
	ok(!cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-source-button {\n\t\tbackground: var(--background-modifier-hover);'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-icon-only-button'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-file-property-checkbox'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-progress-action-shell.is-details-mode .operon-task-progress-segment'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-field-accent-chip:not(.operon-table-file-property-checkbox)'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-file-property-checkbox:not(:disabled) {\n\t\tborder-color: var(--interactive-accent);'));
	ok(cssSource.includes('background: transparent;\n\t\tbackground-color: transparent;\n\t\tcolor: var(--text-normal);'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-task-icon-button:disabled,'));
	ok(cssSource.includes('body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-task-icon-button.is-readonly {'));
	ok(cssSource.includes('height: var(--operon-table-row-highlight-size, 1px);'));
	ok(cssSource.includes('width: calc(100% + var(--operon-table-chip-glow-size) + var(--operon-table-chip-glow-size));'));
	ok(cssSource.includes('margin: calc(-1 * var(--operon-table-chip-glow-size));'));
	ok(cssSource.includes('padding: var(--operon-table-chip-glow-size);'));
	ok(cssSource.includes('box-shadow: 0 0 0 var(--operon-table-chip-glow-size, 2px) var(--operon-task-chip-focus-ring);'));
	ok(cssSource.includes('@media (forced-colors: active) {'));
	ok(cssSource.includes('.operon-table-root .operon-table-parent-task-cell:focus-visible,'));
	ok(cssSource.includes('.operon-table-root .operon-table-list-value-chip:focus-visible,'));
	ok(cssSource.includes('background-color: transparent;'));
	ok(cssSource.includes('box-shadow: 0 0 0 var(--operon-table-chip-glow-size, 2px) color-mix(in srgb, var(--interactive-accent) 18%, transparent);'));
	ok(cssSource.includes('.operon-table-plain-text-value,'));
	ok(cssSource.includes('.operon-table-root .operon-table-date-value-chip,'), 'temporal neutral-fill selector must exist');
	ok(cssSource.includes('--operon-task-chip-bg: transparent;\n\t--operon-task-chip-hover-bg: transparent;\n\tbackground: transparent;\n\tbackground-color: transparent;'), 'temporal base and hover fill must stay transparent');
	ok(cssSource.includes('.operon-table-cell.is-editable:is(:hover, :focus-visible, :focus-within) .operon-table-date-value-chip'), 'editable temporal cells must retain neutral fill');
	ok(cssSource.includes('.operon-table-root .operon-table-date-value-chip:focus-visible,\n\t.operon-table-root .operon-table-cell.is-editable:is(:focus-visible, :focus-within) .operon-table-date-value-chip,'), 'temporal forced-colors selectors must exist');
	ok(cssSource.includes('outline: 2px solid ButtonText;\n\t\tbox-shadow: none;'), 'forced-colors focus must use a system outline');
	ok(cssSource.includes('.operon-table-icon-only-button:hover,\n.operon-table-icon-only-button:focus-visible {'), 'compact temporal shell must keep the shared transparent hover rule');
	ok(editorSource.includes('formatTableCellListChipDisplayValue(value)'));
	ok(editorSource.includes('formatTableListIconOnlyTooltipContent(renderValues)'));
	ok(editorSource.includes("options.field?.type === 'text' && options.field.unavailable !== true"));
	ok(editorSource.includes('renderTableTextValueDisplay(options.cell'));
	ok(editorSource.includes('renderTableIconOnlyCell(options.cell'));
	ok(chipSource.includes('bindOperonHoverTooltip(chip, {\n\t\tcontent: displayValue,'));
	ok(chipSource.includes('shouldOpen: () => isTableListValueChipOverflowing(chip),'));
	ok(chipSource.includes("key === 'status' || key === 'priority'"));
	ok(chipSource.includes('isTableListChipField(key, options) && !isTableDependencyField(key)'));
	ok(chipSource.includes("key === 'status' || key === 'priority' || key === 'blocking' || key === 'blockedBy'"));
	ok(workspaceSource.includes('renderTableCellChips('));
	ok(embedSource.includes('renderTableCellChips('));
	ok(workspaceSource.includes('isTablePlainTextField(getTableTaskField(column.key, renderState.settings))'));
	ok(embedSource.includes('isTablePlainTextField(getTableTaskField(column.key, renderState.settings))'));
	equal(workspaceSource.includes('operon-table-empty-value'), false);
	equal(embedSource.includes('operon-table-empty-value'), false);
	equal(editorSource.includes('operon-table-empty-value'), false);
	equal(descriptionSource.includes("text.setText(displayText ? options.value : '--')"), false);
	equal(progressSource.includes('operon-table-empty-value'), false);
	equal(cssSource.includes('.operon-table-empty-value'), false);
	equal((mainSource.match(/openCheckboxesForTaskId\(taskId, actionAnchor, actionAnchorRect, false\)/g) ?? []).length, 3);
	ok(mainSource.includes('centerOnDesktop = true'));
	ok(mainSource.includes('centerOnDesktop,'));
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
