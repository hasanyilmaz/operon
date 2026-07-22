import { setIcon, type App } from 'obsidian';
import { asHTMLElement, createOwnerElement } from '../core/dom-compat';
import { t } from '../core/i18n';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { snapshotFloatingRectAnchor } from './field-pickers/common';
import { bindOperonHoverTooltip, createNonInteractiveMarkdownLinkContent } from './operon-hover-tooltip';
import { showTextFieldPopover } from './text-field-popover';

export interface TaskNoteActionButtonOptions {
	owner: Node;
	noteValue: string;
	icon: string;
	label: string;
	tooltipTitle: string;
	taskColor?: string | null;
	neutral?: boolean;
	classNames?: string | readonly string[];
	onActivate: (anchor: HTMLButtonElement, anchorRect: DOMRect) => void;
}

export interface TaskNotePopoverOptions {
	app: App;
	anchor: HTMLElement | DOMRect;
	operonId: string;
	initialValue: string;
	taskDescription?: string;
	taskColor?: string | null;
	onCommit: (value: string) => Promise<boolean | void> | boolean | void;
	onClose?: () => void;
}

/**
 * Creates the common editable-note action while leaving row placement, reveal
 * behavior, drag shields, and surface-specific hover bridges to the caller.
 */
export function createTaskNoteActionButton(options: TaskNoteActionButtonOptions): HTMLButtonElement {
	const noteValue = normalizeTaskNotePopoverValue(options.noteValue);
	const button = createOwnerElement(options.owner, 'button');
	button.type = 'button';
	button.className = 'operon-live-preview-edit operon-live-preview-action operon-task-chip-action operon-task-note-action';
	button.classList.add(noteValue ? 'is-active' : 'is-empty');
	if (options.neutral === true) button.classList.add('is-neutral');
	addTaskNoteActionClassNames(button, options.classNames);
	if (options.taskColor) {
		button.style.setProperty('--operon-live-hover-border', options.taskColor);
		button.style.setProperty('--operon-task-chip-hover-accent', options.taskColor);
	}
	setIcon(button, options.icon);
	setAccessibleLabelWithoutTooltip(button, options.label);
	bindOperonHoverTooltip(button, {
		title: options.tooltipTitle,
		contentEl: noteValue ? createNonInteractiveMarkdownLinkContent(button, noteValue) : undefined,
		taskColor: options.taskColor ?? null,
		preferredHorizontal: 'right',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		options.onActivate(button, button.getBoundingClientRect());
	});
	return button;
}

/**
 * Opens the shared text-field editor with the task-note editing contract.
 * Note drafts preserve internal line breaks, may be cleared, and reuse one
 * active session key per task note.
 */
export function showTaskNotePopover(options: TaskNotePopoverOptions): () => void {
	const operonId = options.operonId.trim();
	const anchorEl = asHTMLElement(options.anchor);
	const stableAnchor = anchorEl
		? snapshotFloatingRectAnchor(anchorEl)
		: options.anchor;
	return showTextFieldPopover({
		app: options.app,
		anchor: stableAnchor,
		title: t('taskEditor', 'notes'),
		subtitle: options.taskDescription?.trim() || operonId,
		initialValue: options.initialValue,
		placeholder: t('taskEditor', 'notesPlaceholder'),
		taskColor: options.taskColor,
		sessionKey: `task-text:${operonId}:note`,
		allowEmptyCommit: true,
		normalizeValue: normalizeTaskNotePopoverValue,
		onCommit: options.onCommit,
		onClose: options.onClose,
	});
}

function normalizeTaskNotePopoverValue(value: string): string {
	return value.replace(/^\s+|\s+$/gu, '');
}

function addTaskNoteActionClassNames(button: HTMLElement, classNames: string | readonly string[] | undefined): void {
	if (!classNames) return;
	const names = typeof classNames === 'string' ? classNames.split(/\s+/u) : classNames;
	for (const name of names) {
		const normalized = name.trim();
		if (normalized) button.classList.add(normalized);
	}
}
