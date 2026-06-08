import { App, Editor, Scope, TFile } from 'obsidian';
import { EditorSelection, Prec } from '@codemirror/state';
import type { StateEffect } from '@codemirror/state';
import {
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
	placeholder,
	tooltips,
} from '@codemirror/view';
import { createOwnerElement, getOwnerBody, getOwnerWindow } from '../core/dom-compat';

export interface EmbeddedMarkdownSourceEditorOptions {
	value?: string;
	placeholder?: string;
	className?: string;
	cursorOffset?: number;
	file?: TFile | null;
	lineNumberOffset?: number;
	showLineNumbers?: boolean;
	onBlur?: () => void;
	onChange?: (value: string) => void;
	onEscape?: () => void;
	onSubmit?: () => void;
	onTab?: (outdent: boolean) => boolean;
}

type EmbeddedMarkdownEditViewCtor = new (app: App, containerEl: HTMLElement, owner: EmbeddedMarkdownOwner) => EmbeddedMarkdownEditView;
type OperonEmbeddedMarkdownViewCtor = new (
	app: App,
	containerEl: HTMLElement,
	options?: EmbeddedMarkdownSourceEditorOptions,
) => EmbeddedMarkdownEditView;

interface EmbeddedMarkdownOwner {
	app: App;
	containerEl: HTMLElement;
	onMarkdownScroll: () => void;
	syncScroll: () => void;
	getViewType: () => 'markdown';
	getMode: () => 'source';
	getViewData: () => string;
	setViewData: (data: string, clear: boolean) => void;
	clear: () => void;
	hoverPopover: null;
	file: TFile | null;
	editor?: Editor;
	editMode?: unknown;
}

interface EmbeddedMarkdownEditView {
	app: App;
	containerEl: HTMLElement;
	editorEl: HTMLElement;
	owner: EmbeddedMarkdownOwner;
	editor: {
		cm: EditorView;
	};
	_loaded?: boolean;
	set(value: string, clear?: boolean): void;
	onUpdate(update: unknown, changed: boolean): void;
	buildLocalExtensions(): unknown[];
	destroy(): void;
	unload(): void;
}

interface EmbeddedMarkdownEmbed {
	editable?: boolean;
	editMode?: unknown;
	showEditor?: () => void;
	unload?: () => void;
}

interface EmbeddedMarkdownRegistry {
	embedByExtension?: {
		md?: (owner: { app: App; containerEl: HTMLElement }, file: unknown, sourcePath: string) => EmbeddedMarkdownEmbed | null | undefined;
	};
}

interface WorkspaceActiveEditorHost {
	activeEditor?: unknown;
}

interface EmbeddedMarkdownSourceEditorRecord {
	filePath: string;
}

export interface EmbeddedMarkdownSourceEditorRefreshScope {
	mode: 'global' | 'scoped';
	filePaths: string[];
}

export interface EmbeddedMarkdownSourceEditorRefreshResult {
	refreshedEditors: number;
	skippedEditors: number;
}

const markdownEditViewCtorCache = new WeakMap<App, EmbeddedMarkdownEditViewCtor>();
const embeddedMarkdownViewClassCache = new WeakMap<App, OperonEmbeddedMarkdownViewCtor>();
const activeEmbeddedMarkdownSourceEditors = new Set<EditorView>();
const embeddedMarkdownSourceEditorRecords = new WeakMap<EditorView, EmbeddedMarkdownSourceEditorRecord>();
const filePanelLayoutTheme = EditorView.theme({
	'&': {
		minWidth: '0',
		width: '100%',
	},
	'.cm-scroller': {
		alignItems: 'stretch',
		overflowX: 'hidden',
	},
	'.cm-gutters': {
		display: 'none',
		left: 'auto',
		flex: '0 0 auto',
		alignSelf: 'stretch',
		marginRight: '0',
		minWidth: '0',
		width: '0',
	},
	'.cm-content': {
		flex: '1 1 0',
		minWidth: '0',
		width: '100%',
		maxWidth: '100%',
		boxSizing: 'border-box',
		marginLeft: '0',
		transform: 'none',
		paddingInlineStart: 'var(--operon-file-content-inset, 0px)',
	},
	'.cm-line': {
		marginLeft: '0',
		marginInlineStart: '0',
		paddingLeft: '0',
		paddingInlineStart: '0',
		maxWidth: '100%',
		boxSizing: 'border-box',
		overflowWrap: 'anywhere',
	},
});

interface FilePanelLineNumberBlock {
	lineNumber: number;
	top: number;
	height: number;
}

export function getEmbeddedMarkdownSourceEditorFilePath(view: EditorView): string {
	return embeddedMarkdownSourceEditorRecords.get(view)?.filePath ?? '';
}

export function refreshEmbeddedMarkdownSourceEditors(
	effect: StateEffect<unknown>,
	scope?: EmbeddedMarkdownSourceEditorRefreshScope,
): EmbeddedMarkdownSourceEditorRefreshResult {
	const scopedFilePaths = scope?.mode === 'scoped'
		? new Set(scope.filePaths.map(filePath => filePath.trim()).filter(Boolean))
		: null;
	let refreshedEditors = 0;
	let skippedEditors = 0;

	for (const view of Array.from(activeEmbeddedMarkdownSourceEditors)) {
		if (!view.dom.isConnected) {
			activeEmbeddedMarkdownSourceEditors.delete(view);
			embeddedMarkdownSourceEditorRecords.delete(view);
			continue;
		}

		const filePath = getEmbeddedMarkdownSourceEditorFilePath(view);
		if (scopedFilePaths && (!filePath || !scopedFilePaths.has(filePath))) {
			skippedEditors++;
			continue;
		}

		try {
			view.dispatch({ effects: effect });
			refreshedEditors++;
		} catch {
			skippedEditors++;
		}
	}

	return { refreshedEditors, skippedEditors };
}

function isPrototypeTarget(value: unknown): value is object {
	return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function getPrototype(value: unknown): object | null {
	return isPrototypeTarget(value) ? Reflect.getPrototypeOf(value) : null;
}

function resolveEditViewCtorFromEditMode(editMode: unknown): EmbeddedMarkdownEditViewCtor | null {
	const editModeProto = getPrototype(editMode);
	const editViewProto = getPrototype(editModeProto);
	const ctor = (editViewProto as { constructor?: unknown } | null)?.constructor;
	return typeof ctor === 'function' ? ctor as unknown as EmbeddedMarkdownEditViewCtor : null;
}

function getActiveEditorHost(app: App): WorkspaceActiveEditorHost {
	return app.workspace;
}

function setWorkspaceActiveEditor(app: App, owner: EmbeddedMarkdownOwner): void {
	getActiveEditorHost(app).activeEditor = owner;
}

function clearWorkspaceActiveEditor(app: App, owner: EmbeddedMarkdownOwner): void {
	const workspace = getActiveEditorHost(app);
	if (workspace.activeEditor === owner) {
		workspace.activeEditor = null;
	}
}

function resolveEmbeddedMarkdownEditViewCtor(app: App): EmbeddedMarkdownEditViewCtor {
	const cached = markdownEditViewCtorCache.get(app);
	if (cached) return cached;

	const embedRegistry = (app as App & { embedRegistry?: EmbeddedMarkdownRegistry }).embedRegistry;

	const tempEmbed = embedRegistry?.embedByExtension?.md?.(
		{ app, containerEl: createOwnerElement(null, 'div') },
		null,
		'',
	);
	if (!tempEmbed?.showEditor || !tempEmbed?.unload) {
		throw new Error('Operon: embedded markdown editor is unavailable.');
	}

	try {
		tempEmbed.editable = true;
		tempEmbed.showEditor();
		const ctor = resolveEditViewCtorFromEditMode(tempEmbed.editMode);
		if (!ctor) {
			throw new Error('Operon: embedded markdown editor constructor is unavailable.');
		}
		markdownEditViewCtorCache.set(app, ctor);
		return ctor;
	} finally {
		tempEmbed.unload();
	}
}

function resolveEmbeddedMarkdownViewClass(app: App): OperonEmbeddedMarkdownViewCtor {
	const cached = embeddedMarkdownViewClassCache.get(app);
	if (cached) return cached;

	const BaseCtor = resolveEmbeddedMarkdownEditViewCtor(app);

	class OperonEmbeddedMarkdownView extends BaseCtor {
		private options: EmbeddedMarkdownSourceEditorOptions;
		private readonly hotkeyScope: Scope;
		private hotkeyScopeActive = false;
		private filePanelLayoutObserver: MutationObserver | null = null;
		private filePanelLineNumberRail: HTMLElement | null = null;
		private filePanelLineNumberSpacer: HTMLElement | null = null;
		private filePanelLineNumberLayer: HTMLElement | null = null;
		private filePanelLineNumberScrollHandler: (() => void) | null = null;

		constructor(sourceApp: App, containerEl: HTMLElement, options: EmbeddedMarkdownSourceEditorOptions = {}) {
			const owner: EmbeddedMarkdownOwner = {
				app: sourceApp,
				containerEl,
				onMarkdownScroll: () => {},
				syncScroll: () => {},
				getViewType: () => 'markdown',
				getMode: () => 'source',
				getViewData: () => '',
				setViewData: () => {},
				clear: () => {},
				hoverPopover: null,
				file: options.file ?? null,
			};
			super(sourceApp, containerEl, owner);
			this.options = options;
			this.hotkeyScope = new Scope(this.app.scope);
			this.owner.editMode = this;
			this.owner.editor = this.editor as unknown as Editor;
			this.owner.getViewData = () => this.value;
			this.owner.setViewData = (data: string, clear: boolean) => {
				this.set(data, clear);
			};
			this.owner.clear = () => {
				this.set('');
			};
			this.bindHorizontalScrollReset();

			if (options.className) {
				this.editorEl.addClass(options.className);
			}
			if (this.isFilePanelSourceEditor()) {
				if (this.shouldShowLineNumbers()) {
					this.installFilePanelLineNumberRail();
				} else {
					this.installFilePanelLineNumberSpacer();
				}
			}

			this.set(options.value ?? '');
			this.applyInitialCursorSelection();
			this.installFilePanelLayoutGuard();
			this.resetHorizontalScroll();
			this.queueFilePanelLineNumberRefresh();
			activeEmbeddedMarkdownSourceEditors.add(this.editor.cm);
			embeddedMarkdownSourceEditorRecords.set(this.editor.cm, {
				filePath: options.file?.path ?? '',
			});
			this.editor.cm.contentDOM.addEventListener('blur', () => {
				if (this._loaded) {
					this.options.onBlur?.();
				}
				this.deactivateHotkeyScope();
				clearWorkspaceActiveEditor(this.app, this.owner);
			});
			this.editor.cm.contentDOM.addEventListener('focusin', () => {
				this.activateHotkeyScope();
				setWorkspaceActiveEditor(this.app, this.owner);
				this.resetHorizontalScroll();
			});
		}

		private activateHotkeyScope(): void {
			if (this.hotkeyScopeActive) return;
			this.app.keymap.pushScope(this.hotkeyScope);
			this.hotkeyScopeActive = true;
		}

		private deactivateHotkeyScope(): void {
			if (!this.hotkeyScopeActive) return;
			this.app.keymap.popScope(this.hotkeyScope);
			this.hotkeyScopeActive = false;
		}

		private resetHorizontalScroll(): void {
			const scrollDOM = this.editor.cm.scrollDOM;
			const ownerWindow = getOwnerWindow(scrollDOM);
			const reset = () => {
				scrollDOM.scrollLeft = 0;
			};
			reset();
			ownerWindow.requestAnimationFrame(() => {
				reset();
				ownerWindow.requestAnimationFrame(() => {
					reset();
					ownerWindow.requestAnimationFrame(reset);
				});
			});
			for (const delayMs of [0, 24, 80, 180, 360, 720, 1200, 2000]) {
				ownerWindow.setTimeout(reset, delayMs);
			}
		}

		private bindHorizontalScrollReset(): void {
			const scrollDOM = this.editor.cm.scrollDOM;
			scrollDOM.addEventListener('scroll', () => {
				if (scrollDOM.scrollLeft > 0) {
					scrollDOM.scrollLeft = 0;
				}
			});
		}

		private isFilePanelSourceEditor(): boolean {
			return this.options.className?.split(/\s+/u).includes('operon-task-editor-file-source-editor') ?? false;
		}

		private shouldShowLineNumbers(): boolean {
			return this.options.showLineNumbers !== false;
		}

		private installFilePanelLayoutGuard(): void {
			if (!this.isFilePanelSourceEditor()) return;
			const view = this.editor.cm;
			const ownerWindow = getOwnerWindow(view.dom);
			const apply = () => this.applyFilePanelLayoutGuard();
			const MutationObserverCtor = (ownerWindow as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;

			this.filePanelLayoutObserver?.disconnect();
			const observer = new MutationObserverCtor(apply);
			observer.observe(view.dom, { childList: true, subtree: true });
			this.filePanelLayoutObserver = observer;

			apply();
			ownerWindow.requestAnimationFrame(() => {
				apply();
				ownerWindow.requestAnimationFrame(apply);
			});
			for (const delayMs of [0, 50, 150, 400, 1000, 2000]) {
				ownerWindow.setTimeout(apply, delayMs);
			}
		}

		private applyFilePanelLayoutGuard(): void {
			const view = this.editor.cm;
			const scrollDOM = view.scrollDOM;
			const gutters = scrollDOM.querySelector<HTMLElement>('.cm-gutters');
			const content = view.contentDOM;

			scrollDOM.scrollLeft = 0;

			const overlapInset = gutters
				? Math.ceil(gutters.getBoundingClientRect().right - content.getBoundingClientRect().left + 8)
				: 0;
			this.editorEl.setCssProps({
				'--operon-file-content-inset': `${Math.max(0, Math.min(96, overlapInset))}px`,
			});
			this.queueFilePanelLineNumberRefresh();
		}

		private installFilePanelLineNumberRail(): void {
			if (!this.isFilePanelSourceEditor()) return;
			const rail = createOwnerElement(this.containerEl, 'div');
			rail.addClass('operon-task-editor-file-line-numbers');
			rail.setAttr('aria-hidden', 'true');
			const layer = createOwnerElement(rail, 'div');
			layer.addClass('operon-task-editor-file-line-number-layer');
			rail.appendChild(layer);
			this.containerEl.insertBefore(rail, this.editorEl);
			this.filePanelLineNumberRail = rail;
			this.filePanelLineNumberLayer = layer;

			const scrollDOM = this.editor.cm.scrollDOM;
			this.filePanelLineNumberScrollHandler = () => this.queueFilePanelLineNumberRefresh();
			scrollDOM.addEventListener('scroll', this.filePanelLineNumberScrollHandler);
		}

		private installFilePanelLineNumberSpacer(): void {
			if (!this.isFilePanelSourceEditor()) return;
			const spacer = createOwnerElement(this.containerEl, 'div');
			spacer.addClass('operon-task-editor-file-line-number-spacer');
			spacer.setAttr('aria-hidden', 'true');
			this.containerEl.insertBefore(spacer, this.editorEl);
			this.filePanelLineNumberSpacer = spacer;
		}

		private applyInitialCursorSelection(): void {
			const cursorOffset = this.options.cursorOffset;
			if (typeof cursorOffset !== 'number' || cursorOffset < 0) return;
			const safeOffset = Math.max(0, Math.min(cursorOffset, this.editor.cm.state.doc.length));
			this.editor.cm.dispatch({
				selection: EditorSelection.range(safeOffset, safeOffset),
				effects: EditorView.scrollIntoView(safeOffset, { y: 'center', x: 'start' }),
			});
		}

		private queueFilePanelLineNumberRefresh(): void {
			if (!this.filePanelLineNumberRail || !this.filePanelLineNumberLayer) return;
			getOwnerWindow(this.editor.cm.dom).requestAnimationFrame(() => {
				this.refreshFilePanelLineNumbers();
			});
		}

		private collectFilePanelLineNumberBlocks(): FilePanelLineNumberBlock[] {
			const view = this.editor.cm;
			const rail = this.filePanelLineNumberRail;
			if (!rail) return [];
			const railRect = rail.getBoundingClientRect();
			const lineElements = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));
			const lineBlocks = view.viewportLineBlocks;
			const lineNumberOffset = this.options.lineNumberOffset ?? 0;
			const count = Math.min(lineBlocks.length, lineElements.length);
			const blocks: FilePanelLineNumberBlock[] = [];
			for (let index = 0; index < count; index += 1) {
				const lineEl = lineElements[index];
				const lineBlock = lineBlocks[index];
				if (!lineEl || !lineBlock) continue;
				const rect = lineEl.getBoundingClientRect();
				blocks.push({
					lineNumber: view.state.doc.lineAt(lineBlock.from).number + lineNumberOffset,
					top: rect.top - railRect.top,
					height: rect.height,
				});
			}
			return blocks;
		}

		private refreshFilePanelLineNumbers(): void {
			const layer = this.filePanelLineNumberLayer;
			if (!layer) return;
			layer.empty();
			for (const block of this.collectFilePanelLineNumberBlocks()) {
				const lineNumberEl = createOwnerElement(layer, 'div');
				lineNumberEl.addClass('operon-task-editor-file-line-number');
				lineNumberEl.textContent = String(block.lineNumber);
				lineNumberEl.setCssProps({
					'--operon-file-line-number-top': `${block.top}px`,
					'--operon-file-line-number-height': `${block.height}px`,
				});
				layer.appendChild(lineNumberEl);
			}
		}

		get value(): string {
			return this.editor.cm.state.doc.toString();
		}

		setValue(value: string): void {
			this.set(value);
		}

		override onUpdate(update: unknown, changed: boolean): void {
			super.onUpdate(update, changed);
			if (changed) {
				this.options.onChange?.(this.value);
			}
			this.queueFilePanelLineNumberRefresh();
		}

		override buildLocalExtensions(): unknown[] {
			const extensions = super.buildLocalExtensions();
			const isFilePanelSourceEditor = this.isFilePanelSourceEditor();
			if (!isFilePanelSourceEditor && this.shouldShowLineNumbers()) {
				extensions.push(lineNumbers({
					formatNumber: (lineNo) => String(lineNo + (this.options.lineNumberOffset ?? 0)),
				}));
			}
			extensions.push(EditorView.lineWrapping);
			if (isFilePanelSourceEditor) {
				extensions.push(filePanelLayoutTheme);
			}
			extensions.push(highlightActiveLine());
			if (!isFilePanelSourceEditor && this.shouldShowLineNumbers()) {
				extensions.push(highlightActiveLineGutter());
			}
			extensions.push(tooltips({ parent: getOwnerBody(this.editorEl) }));
			if (this.options.placeholder) {
				extensions.push(placeholder(this.options.placeholder));
			}
			extensions.push(Prec.highest(keymap.of([
				{
					key: 'Mod-Enter',
					run: () => {
						this.options.onSubmit?.();
						return true;
					},
				},
				{
					key: 'Escape',
					run: () => {
						this.options.onEscape?.();
						return this.options.onEscape != null;
					},
				},
				{
					key: 'Tab',
					run: () => this.options.onTab?.(false) ?? false,
				},
				{
					key: 'Shift-Tab',
					run: () => this.options.onTab?.(true) ?? false,
				},
			])));
			return extensions;
		}

		override destroy(): void {
			if (this.filePanelLineNumberScrollHandler) {
				this.editor.cm.scrollDOM.removeEventListener('scroll', this.filePanelLineNumberScrollHandler);
				this.filePanelLineNumberScrollHandler = null;
			}
			this.filePanelLayoutObserver?.disconnect();
			this.filePanelLayoutObserver = null;
			this.filePanelLineNumberRail?.remove();
			this.filePanelLineNumberRail = null;
			this.filePanelLineNumberSpacer?.remove();
			this.filePanelLineNumberSpacer = null;
			this.filePanelLineNumberLayer = null;
			activeEmbeddedMarkdownSourceEditors.delete(this.editor.cm);
			embeddedMarkdownSourceEditorRecords.delete(this.editor.cm);
			if (this._loaded) {
				this.unload();
			}
			this.deactivateHotkeyScope();
			clearWorkspaceActiveEditor(this.app, this.owner);
			this.containerEl.empty();
			super.destroy();
		}

		onunload(): void {
			this.destroy();
		}
	}

	const typedCtor: OperonEmbeddedMarkdownViewCtor = OperonEmbeddedMarkdownView;
	embeddedMarkdownViewClassCache.set(app, typedCtor);
	return typedCtor;
}

export class EmbeddedMarkdownSourceEditor {
	private view: EmbeddedMarkdownEditView | null = null;
	private containerEl: HTMLElement;

	constructor(
		private app: App,
		containerEl: HTMLElement,
		options: EmbeddedMarkdownSourceEditorOptions = {},
	) {
		this.containerEl = containerEl;
		const EmbeddedViewCtor = resolveEmbeddedMarkdownViewClass(app);
		this.view = new EmbeddedViewCtor(app, containerEl, options);
	}

	get value(): string {
		return this.view?.editor.cm.state.doc.toString() ?? '';
	}

	focus(): void {
		this.view?.editor.cm.contentDOM.focus();
	}

	focusEnd(): void {
		const view = this.view?.editor.cm;
		if (!view) return;
		const end = view.state.doc.length;
		view.dispatch({
			selection: EditorSelection.range(end, end),
			effects: EditorView.scrollIntoView(end, { y: 'nearest', x: 'start' }),
		});
		view.contentDOM.focus();
	}

	setValue(value: string): void {
		this.view?.set(value);
	}

	indentCurrentLine(outdent: boolean): void {
		const view = this.view?.editor.cm;
		if (!view) return;
		const line = view.state.doc.lineAt(view.state.selection.main.from);
		if (outdent) {
			const leadingIndent = /^(\t| {1,4})/u.exec(line.text)?.[0] ?? '';
			if (!leadingIndent) return;
			view.dispatch({
				changes: {
					from: line.from,
					to: line.from + leadingIndent.length,
					insert: '',
				},
			});
			return;
		}
		view.dispatch({
			changes: {
				from: line.from,
				insert: '\t',
			},
		});
	}

	destroy(): void {
		if (!this.view) return;
		this.view.destroy();
		this.view = null;
		this.containerEl.empty();
	}
}
