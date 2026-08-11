import type { App } from 'obsidian';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import {
	isCompactTaskMarkdownLinkEventTarget,
	renderCompactTaskMarkdown,
} from '../compact-task-markdown-renderer';
import {
	bindOperonHoverTooltip,
	createCompactTaskMarkdownTooltipContent,
} from '../operon-hover-tooltip';
import { renderTableIconOnlyCell } from './table-icon-only-cell';

export interface TableInlineEditSession {
	finish(commit: boolean): void;
}

export interface TableTextValueDisplayOptions {
	value: string;
	textClassName?: string;
	wikilinks?: {
		app: App;
		sourcePath: string;
	};
}

export interface TableDescriptionCellOptions {
	value: string;
	editable: boolean;
	fieldLabel: string;
	editLabel: string;
	cellClassName?: string;
	textClassName?: string;
	inputClassName?: string;
	iconOnly?: {
		icon: string;
		color: string | null;
		title: string;
		content: string;
		ariaLabel: string;
	};
	wikilinks?: {
		app: App;
		sourcePath: string;
	};
	onCommit?: (value: string) => Promise<boolean> | boolean | void;
	onIconOnlyOpen?: () => void;
	onInlineEditStart?: (session: TableInlineEditSession) => void;
	onInlineEditFinish?: (session: TableInlineEditSession) => void;
}

function isInlineTextCellOverflowing(text: HTMLElement): boolean {
	return text.isConnected && text.scrollWidth > text.clientWidth + 1;
}

function clearInlineTextCellTooltip(cell: HTMLElement): void {
	bindOperonHoverTooltip(cell, { taskColor: null });
}

export function renderTableTextValueDisplay(
	cell: HTMLElement,
	options: TableTextValueDisplayOptions,
): void {
	cell.addClass('operon-table-description-cell');
	cell.addClass('operon-table-text-cell');
	const displayText = options.value.trim();
	const textClasses = [
		'operon-table-description-text',
		'operon-table-plain-text-value',
		options.textClassName,
		displayText ? '' : 'is-empty',
	].filter(Boolean).join(' ');
	const text = cell.createSpan({ cls: textClasses });
	let overflowTarget = text;
	if (displayText && options.wikilinks) {
		const markdownContent = text.createSpan({ cls: 'operon-table-description-markdown-content' });
		overflowTarget = markdownContent;
		renderCompactTaskMarkdown(markdownContent, {
			app: options.wikilinks.app,
			value: options.value,
			sourcePath: options.wikilinks.sourcePath,
			mode: 'interactive',
			containerClassName: 'operon-task-description-markdown',
		});
	} else {
		text.setText(displayText ? options.value : '--');
	}
	if (displayText) {
		bindOperonHoverTooltip(cell, {
			contentElFactory: () => createCompactTaskMarkdownTooltipContent(cell, options.value),
			taskColor: null,
			preferredHorizontal: 'center',
			shouldOpen: () => isInlineTextCellOverflowing(overflowTarget),
		});
	} else {
		clearInlineTextCellTooltip(cell);
	}
}

export function renderTableDescriptionCellContent(
	cell: HTMLElement,
	options: TableDescriptionCellOptions,
): void {
	cell.addClass('operon-table-description-cell');
	if (options.cellClassName) cell.addClass(options.cellClassName);
	let displayValue = options.value;
	let editing = false;

	const buildEditableAccessibleLabel = (value: string): string => {
		const valueLabel = value.trim();
		return valueLabel ? `${options.fieldLabel}: ${valueLabel}. ${options.editLabel}` : `${options.fieldLabel}. ${options.editLabel}`;
	};

	const shouldSyncEditableAccessibleLabel = (): boolean => options.iconOnly
		? !!options.onIconOnlyOpen
		: options.editable && !!options.onCommit;

	const clearEditableAccessibleLabel = (): void => {
		cell.removeAttribute('aria-label');
		cell.removeAttribute('aria-labelledby');
		delete cell.dataset.operonAccessibleLabelId;
	};

	const syncEditableAccessibleLabel = (value: string): void => {
		cell.removeAttribute('aria-readonly');
		setAccessibleLabelWithoutTooltip(cell, buildEditableAccessibleLabel(value));
	};

	const renderDisplay = (value: string): void => {
		displayValue = value;
		editing = false;
		cell.empty();
		cell.removeClass('is-editing');
		cell.removeClass('operon-table-icon-only-cell');
		const displayText = value.trim();
		if (options.iconOnly) {
			clearInlineTextCellTooltip(cell);
			cell.addClass('operon-table-icon-only-cell');
			if (displayText) {
				renderTableIconOnlyCell(cell, {
					...options.iconOnly,
					contentEl: createCompactTaskMarkdownTooltipContent(cell, value),
					focusable: options.onIconOnlyOpen ? false : undefined,
				});
			}
			if (shouldSyncEditableAccessibleLabel()) {
				syncEditableAccessibleLabel(displayValue);
			}
			return;
		}
		renderTableTextValueDisplay(cell, {
			value,
			textClassName: options.textClassName,
			wikilinks: options.wikilinks,
		});
		if (shouldSyncEditableAccessibleLabel()) {
			syncEditableAccessibleLabel(displayValue);
		}
	};

	const startEdit = (): void => {
		if (editing || !options.editable || !options.onCommit) return;
		editing = true;
		clearInlineTextCellTooltip(cell);
		cell.empty();
		clearEditableAccessibleLabel();
		cell.addClass('is-editing');
		const inputClasses = ['operon-table-description-input', options.inputClassName].filter(Boolean).join(' ');
		const input = cell.createEl('input', {
			cls: inputClasses,
			attr: {
				type: 'text',
			},
		});
		setAccessibleLabelWithoutTooltip(input, options.fieldLabel);
		input.value = displayValue;

		let finished = false;
		const finish = (commit: boolean): void => {
			if (finished) return;
			finished = true;
			const previousValue = displayValue;
			const nextValue = input.value.trim();
			if (!commit || nextValue === previousValue.trim()) {
				renderDisplay(previousValue);
				options.onInlineEditFinish?.(session);
				return;
			}
			renderDisplay(nextValue);
			options.onInlineEditFinish?.(session);
			void Promise.resolve(options.onCommit?.(nextValue)).then(result => {
				if (result === false) {
					renderDisplay(previousValue);
				}
			});
		};
		const session: TableInlineEditSession = { finish };

		input.addEventListener('click', event => event.stopPropagation());
		input.addEventListener('dblclick', event => event.stopPropagation());
		input.addEventListener('keydown', event => {
			event.stopPropagation();
			if (event.key === 'Escape') {
				event.preventDefault();
				finish(false);
				return;
			}
			if (event.key !== 'Enter') return;
			event.preventDefault();
			finish(true);
		});
		input.addEventListener('blur', () => finish(true));
		options.onInlineEditStart?.(session);
		window.requestAnimationFrame(() => {
			if (finished || !input.isConnected) return;
			input.focus();
			const end = input.value.length;
			input.setSelectionRange(end, end);
		});
	};

	renderDisplay(displayValue);
	if (options.iconOnly) {
		if (!options.onIconOnlyOpen) {
			cell.setAttribute('aria-readonly', 'true');
			return;
		}
		cell.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			options.onIconOnlyOpen?.();
		});
		cell.addEventListener('dblclick', event => event.stopPropagation());
		cell.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'F2') return;
			event.preventDefault();
			event.stopPropagation();
			options.onIconOnlyOpen?.();
		});
		return;
	}
	if (!options.editable || !options.onCommit) {
		cell.setAttribute('aria-readonly', 'true');
		return;
	}

	cell.addEventListener('click', event => {
		if (isCompactTaskMarkdownLinkEventTarget(event.target, cell)) return;
		event.preventDefault();
		event.stopPropagation();
		startEdit();
	});
	cell.addEventListener('dblclick', event => event.stopPropagation());
	cell.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'F2') return;
		if (isCompactTaskMarkdownLinkEventTarget(event.target, cell)) return;
		event.preventDefault();
		event.stopPropagation();
		startEdit();
	});
}
