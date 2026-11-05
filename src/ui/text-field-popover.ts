import { registerLightboxSource } from './lightbox';
import { reanchorFloatingPanel, getFloatingRectAnchorOwner } from './field-pickers/common';
import { Notice, Platform, setIcon, type App } from 'obsidian';
import { asHTMLElement, getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { createFloatingPanel, type FloatingPanelCloseReason } from './field-pickers/common';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import {
	createCompactMarkdownEditorSurface,
	type CompactMarkdownEditorSurface,
	type CompactMarkdownEditorSurfaceOptions,
} from './compact-markdown-editor-surface';
import type { CompactTaskTextPolicy } from '../core/compact-task-text';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

export interface TextFieldPopoverOptions {
 rebindCommitOnReopen?: boolean;
	app: App;
	anchor: HTMLElement | DOMRect;
	title: string;
	subtitle?: string;
	subtitlePresentation?: 'plain' | 'compact-markdown';
	initialValue: string;
	placeholder?: string;
	taskColor?: string | null;
	sessionKey?: string;
	allowEmptyCommit?: boolean;
	onCommit: (value: string) => Promise<boolean | void> | boolean | void;
	onAfterCommit?: (value: string, container: HTMLElement, close: () => void) => Promise<boolean>;
	onClose?: () => void;
	lifecycleOwner?: Node;
	onFocusReturn?: () => void;
	normalizeValue?: (value: string) => string;
	editor?: {
		kind: 'compact-markdown';
  openLinksInLightbox?: boolean;
		sourcePath: string;
		textPolicy?: CompactTaskTextPolicy;
	};
}

interface TextFieldEditorSurface {
	getCommit: () => {
		shouldCommit: boolean;
		value: string;
	};
	focus: () => void;
 focusEnd: () => void;
	refreshLayout: () => void;
	destroy: () => void;
}

interface TextFieldPopoverSession {
 commitValue: TextFieldPopoverOptions['onCommit'];
 rebindCommitOnReopen: boolean;
	panel: HTMLElement;
	requestClose: () => void;
	requestCloseAndWait: () => Promise<boolean>;
	bringToFront: () => void;
	closeListeners: Set<() => void>;
	lifecycleOwners: Set<Node>;
	focusReturn: (() => void) | null;
}

export interface TextFieldPopoverDependencies {
	createPanel: typeof createFloatingPanel;
	createCompactEditorSurface: (
		container: HTMLElement,
		options: CompactMarkdownEditorSurfaceOptions,
	) => CompactMarkdownEditorSurface;
}

export interface TextFieldPopoverCloseHandle {
	(): void;
	requestCloseAndWait: () => Promise<boolean>;
}

const TEXT_FIELD_POPOVER_BASE_Z_INDEX = 10090;
const activeTextFieldPopovers = new Map<string, TextFieldPopoverSession>();
const DEFAULT_TEXT_FIELD_POPOVER_DEPENDENCIES: TextFieldPopoverDependencies = {
	createPanel: createFloatingPanel,
	createCompactEditorSurface: createCompactMarkdownEditorSurface,
};
let textFieldPopoverZIndex = TEXT_FIELD_POPOVER_BASE_Z_INDEX;

export function showTextFieldPopover(
	options: TextFieldPopoverOptions,
	dependencies: TextFieldPopoverDependencies = DEFAULT_TEXT_FIELD_POPOVER_DEPENDENCIES,
): TextFieldPopoverCloseHandle {
	const sessionKey = options.sessionKey?.trim();
	if (sessionKey) {
		const existing = activeTextFieldPopovers.get(sessionKey);
		if (existing?.panel.isConnected) {
   if (options.rebindCommitOnReopen || existing.rebindCommitOnReopen) {
    existing.commitValue = options.onCommit;
    existing.rebindCommitOnReopen = options.rebindCommitOnReopen === true;
    reanchorFloatingPanel(existing.panel, options.anchor);
   }
			if (options.onClose) existing.closeListeners.add(options.onClose);
			if (options.lifecycleOwner) existing.lifecycleOwners.add(options.lifecycleOwner);
			existing.focusReturn = options.onFocusReturn ?? null;
			existing.bringToFront();
			return createTextFieldPopoverCloseHandle(existing.requestClose, existing.requestCloseAndWait);
		}
		activeTextFieldPopovers.delete(sessionKey);
	}

	const normalizeValue = options.normalizeValue ?? normalizeTextFieldPopoverValue;
	const closeListeners = new Set<() => void>();
	if (options.onClose) closeListeners.add(options.onClose);
	const lifecycleOwners = new Set<Node>();
	if (options.lifecycleOwner) lifecycleOwners.add(options.lifecycleOwner);
	const session: TextFieldPopoverSession = {
  commitValue: options.onCommit, rebindCommitOnReopen: options.rebindCommitOnReopen === true,
		panel: null as unknown as HTMLElement,
		requestClose: () => undefined,
		requestCloseAndWait: async () => true,
		bringToFront: () => undefined,
		closeListeners,
		lifecycleOwners,
		focusReturn: options.onFocusReturn ?? null,
	};
	let editorSurface: TextFieldEditorSurface | null = null;
	let closePanel: () => void = () => undefined;
	let allowDirectClose = false;
	let saving = false;
	let closed = false;
	let editorHost: HTMLElement | null = null;
	let committedValue: string | undefined;
 let previewSource: ReturnType<typeof registerLightboxSource> | null = null;
	const closeAttemptWaiters = new Set<(closed: boolean) => void>();
	const requestClose = (): void => {
		if (previewSource?.suspended()) { settleCloseAttempt(false); return; }
  if (saving || closed) return;
		const commit = readEditorCommit();
		if (commit === null || !shouldCommitValue(commit)) {
			forceClose();
			return;
		}
		void commitAndClose(commit.value);
	};
	const shouldClose = (reason: FloatingPanelCloseReason): boolean => {
		if (allowDirectClose) return true;
		if (saving || closed || previewSource?.suspended()) return false;
		const commit = readEditorCommit();
		if (commit === null || !shouldCommitValue(commit)) return true;
		if (reason === 'anchor-detach') return false;
		void commitAndClose(commit.value);
		return false;
	};
	const { panel, close } = dependencies.createPanel(
		options.anchor,
		'operon-floating-panel operon-text-field-popover-panel',
		() => {
			closed = true;
   previewSource?.dispose();
			editorSurface?.destroy();
			editorSurface = null;
			if (sessionKey && activeTextFieldPopovers.get(sessionKey)?.panel === panel) {
				activeTextFieldPopovers.delete(sessionKey);
			}
			for (const listener of closeListeners) listener();
			closeListeners.clear();
			session.focusReturn?.();
			session.focusReturn = null;
			lifecycleOwners.clear();
			settleCloseAttempt(true);
		},
		{
			shouldClose,
			closeOnWindowResize: false,
			repositionOnWindowResize: true,
			repositionOnPanelResize: true,
			repositionOnScroll: true,
			shouldHandleEscape: options.editor
				? event => !previewSource?.suspended() && !editorHost?.contains(event.target as Node)
				: undefined,
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
		const subtitleEl = header.createDiv({
			cls: 'operon-text-field-popover-subtitle',
		});
		if (options.subtitlePresentation === 'compact-markdown') {
			renderCompactTaskMarkdown(subtitleEl, {
				value: subtitle,
				mode: 'visual-only',
			});
		} else {
			subtitleEl.textContent = subtitle;
		}
	}
	editorHost = body.createDiv('operon-text-field-popover-editor-host');
	const afterCommitHost = options.onAfterCommit ? body.createDiv('operon-text-field-popover-after-commit') : null;
	editorSurface = options.editor
		? createCompactTextFieldEditorSurface(
			editorHost,
			options,
			closeButton,
			requestClose,
			dependencies,
		)
		: createTextareaTextFieldEditorSurface(editorHost, options, requestClose, normalizeValue);
	if (Platform.isDesktopApp && options.editor?.openLinksInLightbox) {
  previewSource = registerLightboxSource(panel, asHTMLElement(options.anchor) ?? getFloatingRectAnchorOwner(options.anchor) ?? options.lifecycleOwner ?? null, {
   blocked: () => saving || readEditorCommit()?.shouldCommit === true,
   focus: () => editorSurface?.focus(),
   closeClean: () => { session.focusReturn = null; forceClose(); },
  });
 }
 getOwnerWindow(panel).requestAnimationFrame(() => {
  if (previewSource?.suspended() || closed) return;
		editorSurface?.refreshLayout();
		editorSurface?.focusEnd();
	});

	const requestCloseAndWait = (): Promise<boolean> => new Promise<boolean>(resolve => {
		if (closed) {
			resolve(true);
			return;
		}
		closeAttemptWaiters.add(resolve);
		requestClose();
	});

	if (sessionKey) {
		session.panel = panel;
		session.requestClose = requestClose;
		session.requestCloseAndWait = requestCloseAndWait;
		session.bringToFront = () => bringTextFieldPopoverToFront(panel);
		activeTextFieldPopovers.set(sessionKey, session);
	}

	function readEditorCommit(): ReturnType<TextFieldEditorSurface['getCommit']> | null {
		if (!editorSurface) return null;
		return editorSurface.getCommit();
	}

	function shouldCommitValue(commit: ReturnType<TextFieldEditorSurface['getCommit']>): boolean {
		if (committedValue !== undefined && commit.value === committedValue) return false;
		if (!commit.shouldCommit) return false;
		return options.allowEmptyCommit === true || commit.value.length > 0;
	}

	function forceClose(): void {
		if (closed) return;
		allowDirectClose = true;
		closePanel();
	}

	async function commitAndClose(nextValue: string): Promise<void> {
		if (saving || closed) return;
		saving = true;
		panel.addClass('is-saving');
		try {
			const result = await Promise.resolve(session.commitValue(nextValue));
			if (result === false) {
				new Notice(t('notifications', 'taskSaveFailed'));
				refocusEditor();
				settleCloseAttempt(false);
				return;
			}
			committedValue = nextValue;
			if (afterCommitHost && options.onAfterCommit
				&& !await options.onAfterCommit(nextValue, afterCommitHost, forceClose)) {
				settleCloseAttempt(false);
				return;
			}
			forceClose();
		} catch (error: unknown) {
			console.error('Operon: failed to save text field popover changes', {
				error: error instanceof Error ? error.message : String(error),
			});
			new Notice(t('notifications', 'taskSaveFailed'));
			refocusEditor();
			settleCloseAttempt(false);
		} finally {
			saving = false;
			panel.removeClass('is-saving');
		}
	}

	function refocusEditor(): void {
		getOwnerWindow(panel).requestAnimationFrame(() => {
			if (!closed) editorSurface?.focusEnd();
		});
	}

	function settleCloseAttempt(didClose: boolean): void {
		for (const resolve of closeAttemptWaiters) resolve(didClose);
		closeAttemptWaiters.clear();
	}

	return createTextFieldPopoverCloseHandle(requestClose, requestCloseAndWait);
}

function createTextFieldPopoverCloseHandle(
	requestClose: () => void,
	requestCloseAndWait: () => Promise<boolean>,
): TextFieldPopoverCloseHandle {
	return Object.assign(requestClose, { requestCloseAndWait });
}

export function requestCloseTextFieldPopoversForOwner(root: ParentNode): number {
	let requested = 0;
	for (const session of activeTextFieldPopovers.values()) {
		const ownsSurface = Array.from(session.lifecycleOwners).some(owner =>
			owner === root || root.contains(owner),
		);
		if (!ownsSurface) continue;
		requested += 1;
		session.requestClose();
	}
	return requested;
}

export async function requestCloseAllTextFieldPopovers(): Promise<{
	requested: number;
	closed: number;
}> {
	const sessions = Array.from(activeTextFieldPopovers.values());
	const results = await Promise.all(sessions.map(session => session.requestCloseAndWait()));
	return {
		requested: sessions.length,
		closed: results.filter(Boolean).length,
	};
}

function createTextareaTextFieldEditorSurface(
	container: HTMLElement,
	options: TextFieldPopoverOptions,
	requestClose: () => void,
	normalizeValue: (value: string) => string,
): TextFieldEditorSurface {
	const initialValue = normalizeValue(options.initialValue);
	const editor = container.createEl('textarea', {
		cls: 'operon-text-field-popover-editor',
		attr: {
			rows: '6',
			spellcheck: 'true',
			placeholder: options.placeholder ?? '',
		},
	});
	setAccessibleLabelWithoutTooltip(editor, options.title);
	editor.value = initialValue;
	editor.addEventListener('keydown', event => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		requestClose();
	});

	return {
		getCommit: () => {
			const value = normalizeValue(editor.value);
			return {
				shouldCommit: value !== initialValue,
				value,
			};
		},
		focus: () => editor.focus({preventScroll: true}),
		focusEnd: () => {
			editor.focus();
			const end = editor.value.length;
			editor.setSelectionRange(end, end);
		},
		refreshLayout: () => undefined,
		destroy: () => undefined,
	};
}

function createCompactTextFieldEditorSurface(
	container: HTMLElement,
	options: TextFieldPopoverOptions,
	closeButton: HTMLButtonElement,
	requestClose: () => void,
	dependencies: TextFieldPopoverDependencies,
): TextFieldEditorSurface {
	const editorOptions = options.editor;
	if (!editorOptions) {
		throw new Error('Operon: compact text field editor options are required');
	}
	container.addClass('operon-text-field-popover-cm-host');
	const surface = dependencies.createCompactEditorSurface(container, {
		app: options.app,
		sourceValue: options.initialValue,
		sourcePath: editorOptions.sourcePath,
		placeholder: options.placeholder,
		ariaLabel: options.title,
		textPolicy: editorOptions.textPolicy,
  openLinksInLightbox: editorOptions.openLinksInLightbox,
		onIntent: intent => {
			if (intent === 'focus-next' || intent === 'focus-previous') {
				closeButton.focus();
				return;
			}
			requestClose();
		},
	});
	return {
		getCommit: () => surface.getCommit(),
		focus: () => surface.focus({preventScroll: true}),
		focusEnd: () => surface.focusEnd(),
		refreshLayout: () => surface.refreshLayout(),
		destroy: () => surface.destroy(),
	};
}

function normalizeTextFieldPopoverValue(value: string): string {
	return value.trim();
}

function bringTextFieldPopoverToFront(panel: HTMLElement): void {
	textFieldPopoverZIndex += 1;
	panel.style.zIndex = String(textFieldPopoverZIndex);
}
