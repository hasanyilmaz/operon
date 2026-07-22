import { Notice, setIcon, type App } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { createFloatingPanel, type FloatingPanelCloseReason } from './field-pickers/common';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export interface TextFieldPopoverOptions {
	app: App;
	anchor: HTMLElement | DOMRect;
	title: string;
	subtitle?: string;
	initialValue: string;
	placeholder?: string;
	taskColor?: string | null;
	sessionKey?: string;
	allowEmptyCommit?: boolean;
	onCommit: (value: string) => Promise<boolean | void> | boolean | void;
	onClose?: () => void;
	normalizeValue?: (value: string) => string;
}

interface TextFieldEditorSurface {
	getValue: () => string;
	setValue: (value: string) => void;
	focusEnd: () => void;
	destroy: () => void;
}

interface TextFieldPopoverSession {
	panel: HTMLElement;
	requestClose: () => void;
	bringToFront: () => void;
}

const TEXT_FIELD_POPOVER_BASE_Z_INDEX = 10090;
const activeTextFieldPopovers = new Map<string, TextFieldPopoverSession>();
let textFieldPopoverZIndex = TEXT_FIELD_POPOVER_BASE_Z_INDEX;

export function showTextFieldPopover(options: TextFieldPopoverOptions): () => void {
	const sessionKey = options.sessionKey?.trim();
	if (sessionKey) {
		const existing = activeTextFieldPopovers.get(sessionKey);
		if (existing?.panel.isConnected) {
			existing.bringToFront();
			return existing.requestClose;
		}
		activeTextFieldPopovers.delete(sessionKey);
	}

	const normalizeValue = options.normalizeValue ?? normalizeTextFieldPopoverValue;
	let committedValue = normalizeValue(options.initialValue);
	let editorSurface: TextFieldEditorSurface | null = null;
	let closePanel: () => void = () => undefined;
	let allowDirectClose = false;
	let saving = false;
	let closed = false;
	const requestClose = (): void => {
		if (saving || closed) return;
		const nextValue = readEditorValue();
		if (nextValue === null || !shouldCommitValue(nextValue)) {
			forceClose();
			return;
		}
		void commitAndClose(nextValue);
	};
	const shouldClose = (_reason: FloatingPanelCloseReason): boolean => {
		if (allowDirectClose) return true;
		if (saving || closed) return false;
		const nextValue = readEditorValue();
		if (nextValue === null || !shouldCommitValue(nextValue)) return true;
		void commitAndClose(nextValue);
		return false;
	};
	const { panel, close } = createFloatingPanel(
		options.anchor,
		'operon-floating-panel operon-text-field-popover-panel',
		() => {
			closed = true;
			editorSurface?.destroy();
			editorSurface = null;
			if (sessionKey && activeTextFieldPopovers.get(sessionKey)?.panel === panel) {
				activeTextFieldPopovers.delete(sessionKey);
			}
			options.onClose?.();
		},
		{
			shouldClose,
			closeOnWindowResize: false,
			repositionOnWindowResize: true,
			repositionOnPanelResize: true,
			repositionOnScroll: true,
		},
	);
	closePanel = close;
	const taskAccent = normalizeTaskFieldColor(options.taskColor);
	if (taskAccent) {
		panel.style.setProperty('--operon-text-field-popover-accent', taskAccent);
	}
	bringTextFieldPopoverToFront(panel);
	panel.addEventListener('pointerdown', () => bringTextFieldPopoverToFront(panel));

	const body = panel.createDiv('operon-text-field-popover-body');
	const closeButton = body.createEl('button', {
		cls: 'operon-text-field-popover-close',
		attr: {
			type: 'button',
		},
	});
	setAccessibleLabelWithoutTooltip(closeButton, t('buttons', 'close'));
	setIcon(closeButton, 'x');
	closeButton.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		requestClose();
	});

	const header = body.createDiv('operon-text-field-popover-header');
	header.createDiv({
		cls: 'operon-text-field-popover-title',
		text: options.title,
	});
	const subtitle = options.subtitle?.trim();
	if (subtitle) {
		header.createDiv({
			cls: 'operon-text-field-popover-subtitle',
			text: subtitle,
		});
	}
	const editorHost = body.createDiv('operon-text-field-popover-editor-host');
	editorSurface = createTextareaTextFieldEditorSurface(editorHost, options, requestClose);
	editorSurface.setValue(committedValue);
	getOwnerWindow(panel).requestAnimationFrame(() => editorSurface?.focusEnd());

	if (sessionKey) {
		activeTextFieldPopovers.set(sessionKey, {
			panel,
			requestClose,
			bringToFront: () => bringTextFieldPopoverToFront(panel),
		});
	}

	function readEditorValue(): string | null {
		if (!editorSurface) return null;
		return normalizeValue(editorSurface.getValue());
	}

	function shouldCommitValue(nextValue: string): boolean {
		if (nextValue === committedValue) return false;
		return options.allowEmptyCommit === true || !(committedValue.length > 0 && nextValue.length === 0);
	}

	function forceClose(): void {
		if (closed) return;
		allowDirectClose = true;
		closePanel();
	}

	async function commitAndClose(nextValue: string): Promise<void> {
		if (saving || closed) return;
		if (!shouldCommitValue(nextValue)) {
			forceClose();
			return;
		}
		saving = true;
		panel.addClass('is-saving');
		try {
			const result = await Promise.resolve(options.onCommit(nextValue));
			if (result === false) {
				new Notice(t('notifications', 'taskSaveFailed'));
				return;
			}
			committedValue = nextValue;
			forceClose();
		} catch (error: unknown) {
			console.error('Operon: failed to save text field popover changes', {
				error: error instanceof Error ? error.message : String(error),
			});
			new Notice(t('notifications', 'taskSaveFailed'));
		} finally {
			saving = false;
			panel.removeClass('is-saving');
		}
	}

	return requestClose;
}

function createTextareaTextFieldEditorSurface(
	container: HTMLElement,
	options: TextFieldPopoverOptions,
	requestClose: () => void,
): TextFieldEditorSurface {
	const editor = container.createEl('textarea', {
		cls: 'operon-text-field-popover-editor',
		attr: {
			rows: '6',
			spellcheck: 'true',
			placeholder: options.placeholder ?? '',
		},
	});
	setAccessibleLabelWithoutTooltip(editor, options.title);
	editor.addEventListener('keydown', event => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		requestClose();
	});

	return {
		getValue: () => editor.value,
		setValue: (value) => {
			editor.value = value;
		},
		focusEnd: () => {
			editor.focus();
			const end = editor.value.length;
			editor.setSelectionRange(end, end);
		},
		destroy: () => undefined,
	};
}

function normalizeTextFieldPopoverValue(value: string): string {
	return value.trim();
}

function bringTextFieldPopoverToFront(panel: HTMLElement): void {
	textFieldPopoverZIndex += 1;
	panel.style.zIndex = String(textFieldPopoverZIndex);
}
