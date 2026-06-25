import { setIcon, type App } from 'obsidian';
import { normalizeColorPaletteHex, type ColorPaletteEntry } from '../../core/color-palette';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { runSettingsAsync, settingsAsyncHandler } from './async-settings-action';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { openSettingsColorPickerModal } from './settings-color-picker-modal';

type WorkflowActionKind = 'icon' | 'text';

export interface WorkflowEditorActionButtonOptions {
	containerEl: HTMLElement;
	label: string;
	icon?: string;
	text?: string;
	className?: string;
	disabled?: boolean;
	danger?: boolean;
	placeholder?: boolean;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface WorkflowColorSwatchOptions {
	app: App;
	containerEl: HTMLElement;
	value: string;
	palette?: ColorPaletteEntry[];
	label?: string;
	errorContext: string;
	onChange: (value: string) => void | Promise<void>;
}

export interface WorkflowColorSwatchHandle {
	wrapperEl: HTMLElement;
	swatchEl: HTMLButtonElement;
	setValue: (value: string) => void;
}

export interface WorkflowGridHeaderOptions {
	containerEl: HTMLElement;
	className: string;
	labels: string[];
	centered?: boolean;
}

export interface WorkflowInlineAddRowOptions {
	containerEl: HTMLElement;
	rowClass: string;
	inputClass: string;
	buttonLabel: string;
	placeholder: string;
	errorContext: string;
	buttonClassName?: string;
	onSubmit: (value: string, inputEl: HTMLInputElement) => void | Promise<void>;
}

export interface WorkflowInlineAddRowHandle {
	rowEl: HTMLElement;
	inputEl: HTMLInputElement;
	buttonEl: HTMLButtonElement;
}

export interface WorkflowInputOptions {
	containerEl: HTMLElement;
	type: 'text' | 'radio' | 'checkbox';
	label: string;
	className?: string;
	name?: string;
	tooltip?: string;
}

function bindWorkflowTooltip(targetEl: HTMLElement, content: string): void {
	bindOperonHoverTooltip(targetEl, {
		content,
		taskColor: null,
	});
}

function resolveActionKind(options: WorkflowEditorActionButtonOptions): WorkflowActionKind {
	return options.icon ? 'icon' : 'text';
}

function formatColorSwatchLabel(label: string | undefined, value: string): string {
	return label ? `${label}: ${value}` : value;
}

function normalizeWorkflowColorHex(value: string): string {
	return normalizeColorPaletteHex(value) ?? '#808080';
}

export function createWorkflowInput(options: WorkflowInputOptions): HTMLInputElement {
	const inputEl = options.containerEl.createEl('input', {
		cls: options.className,
		attr: {
			type: options.type,
		},
	});
	setAccessibleLabelWithoutTooltip(inputEl, options.label);
	if (options.name) inputEl.name = options.name;
	if (options.tooltip) bindWorkflowTooltip(inputEl, options.tooltip);
	return inputEl;
}

export function createWorkflowActionButton(options: WorkflowEditorActionButtonOptions): HTMLButtonElement {
	const buttonEl = options.containerEl.createEl('button', {
		cls: `operon-workflow-action-button ${options.className ?? ''}`.trim(),
		attr: {
			type: 'button',
		},
	});
	bindWorkflowTooltip(buttonEl, options.label);

	if (options.danger) buttonEl.classList.add('is-danger');
	if (options.placeholder) {
		buttonEl.classList.add('is-placeholder');
		buttonEl.setAttribute('aria-hidden', 'true');
		buttonEl.tabIndex = -1;
	}

	if (resolveActionKind(options) === 'icon' && options.icon) {
		setIcon(buttonEl, options.icon);
	} else if (options.text) {
		buttonEl.setText(options.text);
	}
	setAccessibleLabelWithoutTooltip(buttonEl, options.label);

	if (options.disabled || options.placeholder) {
		buttonEl.disabled = true;
		buttonEl.classList.add('is-disabled');
	}

	const onClick = options.onClick;
	if (!options.placeholder && onClick) {
		buttonEl.addEventListener('click', settingsAsyncHandler(options.errorContext ?? 'settings workflow action failed', async () => {
			if (buttonEl.disabled) return;
			await onClick();
		}));
	}

	return buttonEl;
}

export function createWorkflowColorSwatch(options: WorkflowColorSwatchOptions): WorkflowColorSwatchHandle {
	const wrapperEl = options.containerEl.createDiv('operon-settings-color-wrapper');
	let currentValue = normalizeWorkflowColorHex(options.value);

	const swatchEl = wrapperEl.createEl('button', {
		cls: 'operon-settings-color-swatch operon-workflow-color-swatch-button',
		attr: {
			type: 'button',
		},
	});

	const setValue = (value: string): void => {
		const normalized = normalizeWorkflowColorHex(value);
		currentValue = normalized;
		const nextLabel = formatColorSwatchLabel(options.label, normalized);
		swatchEl.style.backgroundColor = normalized;
		setAccessibleLabelWithoutTooltip(swatchEl, nextLabel);
		bindWorkflowTooltip(swatchEl, nextLabel);
	};

	const openPicker = (): void => {
		openSettingsColorPickerModal(options.app, {
			title: options.label,
			value: currentValue,
			palette: options.palette,
			onSelect: value => {
				const normalized = normalizeWorkflowColorHex(value);
				setValue(normalized);
				runSettingsAsync(options.errorContext, async () => {
					await options.onChange(normalized);
				});
			},
		});
	};

	setValue(currentValue);
	swatchEl.addEventListener('pointerdown', event => {
		event.preventDefault();
		event.stopPropagation();
		openPicker();
	});
	swatchEl.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		if (event.detail !== 0) return;
		openPicker();
	});

	return { wrapperEl, swatchEl, setValue };
}

export function createWorkflowGridHeader(options: WorkflowGridHeaderOptions): HTMLElement {
	const headerEl = options.containerEl.createDiv(options.className);
	for (const label of options.labels) {
		const cellEl = headerEl.createSpan({ text: label });
		if (options.centered !== false) cellEl.addClass('operon-settings-centered-cell');
	}
	return headerEl;
}

export function createWorkflowInlineAddRow(options: WorkflowInlineAddRowOptions): WorkflowInlineAddRowHandle {
	const rowEl = options.containerEl.createDiv(options.rowClass);
	const inputEl = rowEl.createEl('input', {
		cls: options.inputClass,
		attr: { type: 'text' },
	});
	inputEl.placeholder = options.placeholder;

	const buttonEl = rowEl.createEl('button', {
		cls: `operon-settings-primary-button ${options.buttonClassName ?? ''}`.trim(),
		attr: { type: 'button' },
	});
	buttonEl.setText(options.buttonLabel);

	const submit = async (): Promise<void> => {
		await options.onSubmit(inputEl.value, inputEl);
	};

	buttonEl.addEventListener('click', settingsAsyncHandler(options.errorContext, submit));
	inputEl.addEventListener('keydown', (event) => {
		if (event.key === 'Enter') runSettingsAsync(options.errorContext, submit);
	});

	return { rowEl, inputEl, buttonEl };
}
