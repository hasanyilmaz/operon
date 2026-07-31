import { Platform, TFile, normalizePath, type App } from 'obsidian';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type {
	CompactTaskTextCommit,
	CompactTaskTextDraft,
} from '../core/compact-task-text';
import { getOwnerWindow } from '../core/dom-compat';
import {
	CompactMarkdownEditorController,
	type CompactSourceSyncResult,
	type CompactTextSelection,
	normalizeCompactTextSelection,
} from './compact-markdown-editor-controller';
import {
	resolveCompactEditorKeyIntent,
	type CompactEditorKeyIntent,
} from './compact-editor-key-intent';
import { compactEditorSurfaceScopeExtension } from './editor-augmentation-scope';
import { EmbeddedMarkdownSourceEditor } from './embedded-markdown-source-editor';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { compactMarkdownUnderlineExtension } from './compact-markdown-underline-extension';

export interface CompactMarkdownEditorSurfaceOptions {
	app: App;
	sourceValue: string;
	sourcePath?: string;
	placeholder?: string;
	ariaLabel: string;
	onUserChange?: (draft: CompactTaskTextDraft) => void;
	onIntent: (intent: Exclude<CompactEditorKeyIntent, 'none'>) => void;
}

export interface CompactMarkdownEditorSurface {
	getDraft(): CompactTaskTextDraft;
	getCommit(): CompactTaskTextCommit;
	setSourceValue(value: string, sourcePath?: string): CompactSourceSyncResult;
	acceptCommittedValue(value: string, sourcePath?: string): void;
	focus(): void;
	focusEnd(): void;
	selectAll(): void;
	refreshLayout(): void;
	destroy(): void;
}

interface CompactEditorBackend {
	getValue(): string;
	getSelection(): CompactTextSelection;
	setValue(value: string, selection?: CompactTextSelection): void;
	focus(): void;
	focusEnd(): void;
	selectAll(): void;
	refreshLayout(): void;
	destroy(): void;
}

interface CompactEditorBackendCallbacks {
	onInput(value: string, selection: CompactTextSelection): void;
	onCompositionStart(): void;
	onCompositionEnd(value: string, selection: CompactTextSelection): void;
	onKeyDown(event: KeyboardEvent): boolean;
}

interface CompactEditorBackendInput {
	container: HTMLElement;
	options: CompactMarkdownEditorSurfaceOptions;
	displayValue: string;
	sourcePath: string;
	callbacks: CompactEditorBackendCallbacks;
}

export interface CompactMarkdownEditorSurfaceDependencies {
	isPhone: () => boolean;
	createEmbeddedBackend: (input: CompactEditorBackendInput) => CompactEditorBackend;
	createTextareaBackend: (input: CompactEditorBackendInput) => CompactEditorBackend;
}

const DEFAULT_DEPENDENCIES: CompactMarkdownEditorSurfaceDependencies = {
	isPhone: () => Platform.isPhone,
	createEmbeddedBackend,
	createTextareaBackend,
};

export function createCompactMarkdownEditorSurface(
	container: HTMLElement,
	options: CompactMarkdownEditorSurfaceOptions,
	dependencies: CompactMarkdownEditorSurfaceDependencies = DEFAULT_DEPENDENCIES,
): CompactMarkdownEditorSurface {
	const controller = new CompactMarkdownEditorController(options.sourceValue);
	let sourcePath = normalizeSourcePath(options.sourcePath);
	let backend: CompactEditorBackend | null = null;
	let suppressInput = false;
	let destroyed = false;

	const callbacks: CompactEditorBackendCallbacks = {
		onInput: (value, selection) => {
			if (destroyed || suppressInput) return;
			const result = controller.applyUserInput(value, selection);
			if (!result) return;
			syncBackendProjection(result.displayValue, result.selection);
			options.onUserChange?.(result.draft);
		},
		onCompositionStart: () => {
			if (!destroyed) controller.beginComposition();
		},
		onCompositionEnd: (value, selection) => {
			if (destroyed) return;
			const result = controller.endComposition(value, selection);
			if (!result) {
				syncBackendProjection(
					controller.getDraft().displayValue,
					normalizeCompactTextSelection(value, selection, false),
				);
				return;
			}
			syncBackendProjection(result.displayValue, result.selection);
			options.onUserChange?.(result.draft);
		},
		onKeyDown: event => {
			if (destroyed) return false;
			const intent = resolveCompactEditorKeyIntent({
				key: event.key,
				shiftKey: event.shiftKey,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				isComposing: event.isComposing,
				localCompositionActive: controller.isCompositionActive(),
				keyCode: getLegacyKeyboardEventKeyCode(event),
			});
			if (intent === 'none') return false;
			event.preventDefault();
			event.stopPropagation();
			options.onIntent(intent);
			return true;
		},
	};

	createBackendForCurrentSource();

	function createBackendForCurrentSource(): void {
		if (destroyed) return;
		backend?.destroy();
		backend = null;
		container.empty();
		const input: CompactEditorBackendInput = {
			container,
			options,
			displayValue: controller.getDraft().displayValue,
			sourcePath,
			callbacks,
		};
		if (!dependencies.isPhone()) {
			try {
				backend = dependencies.createEmbeddedBackend(input);
				return;
			} catch {
				container.empty();
			}
		}
		try {
			backend = dependencies.createTextareaBackend(input);
		} catch (error) {
			container.empty();
			throw error;
		}
	}

	function syncBackendProjection(value: string, selection: CompactTextSelection): void {
		if (!backend || backend.getValue() === value) return;
		suppressInput = true;
		try {
			backend.setValue(value, selection);
		} finally {
			suppressInput = false;
		}
	}

	function syncSourceProjection(): void {
		if (!backend) return;
		const displayValue = controller.getDraft().displayValue;
		if (backend.getValue() === displayValue) return;
		suppressInput = true;
		try {
			backend.setValue(displayValue);
		} finally {
			suppressInput = false;
		}
	}

	return {
		getDraft: () => controller.getDraft(),
		getCommit: () => controller.getCommit(),
		setSourceValue: (value, nextSourcePath) => {
			const result = controller.setSourceValue(value);
			if (result === 'conflict') return result;
			const normalizedPath = normalizeSourcePath(nextSourcePath ?? sourcePath);
			if (normalizedPath !== sourcePath) {
				sourcePath = normalizedPath;
				createBackendForCurrentSource();
			} else {
				syncSourceProjection();
			}
			return result;
		},
		acceptCommittedValue: (value, nextSourcePath) => {
			controller.acceptCommittedValue(value);
			const normalizedPath = normalizeSourcePath(nextSourcePath ?? sourcePath);
			if (normalizedPath !== sourcePath) {
				sourcePath = normalizedPath;
				createBackendForCurrentSource();
			} else {
				syncSourceProjection();
			}
		},
		focus: () => backend?.focus(),
		focusEnd: () => backend?.focusEnd(),
		selectAll: () => backend?.selectAll(),
		refreshLayout: () => backend?.refreshLayout(),
		destroy: () => {
			if (destroyed) return;
			destroyed = true;
			backend?.destroy();
			backend = null;
			container.empty();
		},
	};
}

function createEmbeddedBackend(input: CompactEditorBackendInput): CompactEditorBackend {
	const host = input.container.createDiv('operon-compact-markdown-editor-host');
	let editor: EmbeddedMarkdownSourceEditor | null = null;
	let compositionEndTimer: number | null = null;
	try {
		const eventExtension = createEmbeddedEventExtension(
			() => editor,
			input.callbacks,
			host,
			() => {
				if (compositionEndTimer === null) return;
				getOwnerWindow(host).clearTimeout(compositionEndTimer);
				compositionEndTimer = null;
			},
			timer => {
				if (compositionEndTimer !== null) {
					getOwnerWindow(host).clearTimeout(compositionEndTimer);
				}
				compositionEndTimer = timer;
			},
		);
		editor = new EmbeddedMarkdownSourceEditor(input.options.app, host, {
			value: input.displayValue,
			placeholder: input.options.placeholder,
			className: 'operon-compact-markdown-editor',
			file: resolveSourceFile(input.options.app, input.sourcePath),
			showLineNumbers: false,
			showActiveLine: false,
			ariaLabel: input.options.ariaLabel,
			ariaMultiline: false,
			additionalExtensions: [
				compactEditorSurfaceScopeExtension,
				compactMarkdownUnderlineExtension,
				eventExtension,
			],
			onChange: value => {
				if (!editor) return;
				input.callbacks.onInput(value, editor.selection);
			},
		});
	} catch (error) {
		if (compositionEndTimer !== null) {
			getOwnerWindow(host).clearTimeout(compositionEndTimer);
		}
		editor?.destroy();
		host.remove();
		throw error;
	}

	return {
		getValue: () => editor?.value ?? '',
		getSelection: () => editor?.selection ?? { anchor: 0, head: 0 },
		setValue: (value, selection) => editor?.setValue(value, selection),
		focus: () => editor?.focus(),
		focusEnd: () => editor?.focusEnd(),
		selectAll: () => editor?.selectAll(),
		refreshLayout: () => editor?.refreshLayout(),
		destroy: () => {
			if (compositionEndTimer !== null) {
				getOwnerWindow(host).clearTimeout(compositionEndTimer);
				compositionEndTimer = null;
			}
			editor?.destroy();
			editor = null;
			host.remove();
		},
	};
}

function createEmbeddedEventExtension(
	getEditor: () => EmbeddedMarkdownSourceEditor | null,
	callbacks: CompactEditorBackendCallbacks,
	host: HTMLElement,
	clearCompositionEndTimer: () => void,
	setCompositionEndTimer: (timer: number) => void,
): Extension {
	return Prec.highest(EditorView.domEventHandlers({
		keydown: event => callbacks.onKeyDown(event),
		compositionstart: () => {
			clearCompositionEndTimer();
			callbacks.onCompositionStart();
			return false;
		},
		compositionend: () => {
			const ownerWindow = getOwnerWindow(host);
			const timer = ownerWindow.setTimeout(() => {
				const editor = getEditor();
				if (!editor) return;
				callbacks.onCompositionEnd(editor.value, editor.selection);
			}, 0);
			setCompositionEndTimer(timer);
			return false;
		},
	}));
}

function createTextareaBackend(input: CompactEditorBackendInput): CompactEditorBackend {
	const editor = input.container.createEl('textarea', {
		cls: 'operon-compact-markdown-editor-fallback',
		attr: {
			rows: '1',
			spellcheck: 'true',
			placeholder: input.options.placeholder ?? '',
			'aria-multiline': 'false',
			enterkeyhint: 'done',
		},
	});
	let compositionEndTimer: number | null = null;
	setAccessibleLabelWithoutTooltip(editor, input.options.ariaLabel);
	editor.value = input.displayValue;
	editor.addEventListener('input', () => {
		input.callbacks.onInput(editor.value, readTextareaSelection(editor));
	});
	editor.addEventListener('compositionstart', () => {
		if (compositionEndTimer !== null) {
			getOwnerWindow(editor).clearTimeout(compositionEndTimer);
			compositionEndTimer = null;
		}
		input.callbacks.onCompositionStart();
	});
	editor.addEventListener('compositionend', () => {
		const ownerWindow = getOwnerWindow(editor);
		if (compositionEndTimer !== null) ownerWindow.clearTimeout(compositionEndTimer);
		compositionEndTimer = ownerWindow.setTimeout(() => {
			compositionEndTimer = null;
			input.callbacks.onCompositionEnd(editor.value, readTextareaSelection(editor));
		}, 0);
	});
	editor.addEventListener('keydown', event => input.callbacks.onKeyDown(event));

	return {
		getValue: () => editor.value,
		getSelection: () => readTextareaSelection(editor),
		setValue: (value, selection) => {
			editor.value = value;
			if (selection) {
				editor.setSelectionRange(selection.anchor, selection.head);
			}
		},
		focus: () => editor.focus(),
		focusEnd: () => {
			editor.focus();
			const end = editor.value.length;
			editor.setSelectionRange(end, end);
		},
		selectAll: () => {
			editor.focus();
			editor.select();
		},
		refreshLayout: () => undefined,
		destroy: () => {
			if (compositionEndTimer !== null) {
				getOwnerWindow(editor).clearTimeout(compositionEndTimer);
				compositionEndTimer = null;
			}
			editor.remove();
		},
	};
}

function readTextareaSelection(editor: HTMLTextAreaElement): CompactTextSelection {
	return {
		anchor: editor.selectionStart ?? 0,
		head: editor.selectionEnd ?? editor.selectionStart ?? 0,
	};
}

function resolveSourceFile(app: App, sourcePath: string): TFile | null {
	if (!sourcePath) return null;
	const source = app.vault.getAbstractFileByPath(sourcePath);
	return source instanceof TFile ? source : null;
}

function normalizeSourcePath(sourcePath: string | undefined): string {
	const trimmed = sourcePath?.trim() ?? '';
	return trimmed ? normalizePath(trimmed) : '';
}

function getLegacyKeyboardEventKeyCode(event: KeyboardEvent): number | undefined {
	return (event as unknown as { keyCode?: number }).keyCode;
}
