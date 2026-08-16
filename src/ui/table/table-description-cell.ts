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
	fieldLabel: string;
	editLabel: string;
	cellClassName?: string;
	textClassName?: string;
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
	onOpen?: () => void;
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
		text.setText(displayText ? options.value : '');
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
	const displayValue = options.value;

	const buildEditableAccessibleLabel = (value: string): string => {
		const valueLabel = value.trim();
		return valueLabel ? `${options.fieldLabel}: ${valueLabel}. ${options.editLabel}` : `${options.fieldLabel}. ${options.editLabel}`;
	};

	const shouldSyncEditableAccessibleLabel = (): boolean => !!options.onOpen;

	const syncEditableAccessibleLabel = (value: string): void => {
		cell.removeAttribute('aria-readonly');
		setAccessibleLabelWithoutTooltip(cell, buildEditableAccessibleLabel(value));
	};

	const renderDisplay = (value: string): void => {
		cell.empty();
		cell.removeClass('operon-table-icon-only-cell');
		const displayText = value.trim();
		if (options.iconOnly) {
			clearInlineTextCellTooltip(cell);
			cell.addClass('operon-table-icon-only-cell');
			if (displayText) {
				renderTableIconOnlyCell(cell, {
					...options.iconOnly,
					contentEl: createCompactTaskMarkdownTooltipContent(cell, value),
					focusable: options.onOpen ? false : undefined,
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

	renderDisplay(displayValue);
	if (!options.onOpen) {
		cell.setAttribute('aria-readonly', 'true');
		return;
	}

	cell.addEventListener('click', event => {
		if (isCompactTaskMarkdownLinkEventTarget(event.target, cell)) return;
		event.preventDefault();
		event.stopPropagation();
		options.onOpen?.();
	});
	cell.addEventListener('dblclick', event => event.stopPropagation());
	cell.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'F2') return;
		if (isCompactTaskMarkdownLinkEventTarget(event.target, cell)) return;
		event.preventDefault();
		event.stopPropagation();
		options.onOpen?.();
	});
}
