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
	onEscape?: () => boolean | void;
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
	refreshLayout(): void;
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
		paddingInlineStart: 'calc(var(--operon-file-content-inset, 0px) + var(--operon-file-fold-gutter, 14px))',
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
	'.cm-line.HyperMD-header .cm-fold-indicator': {
		marginInlineStart: 'var(--operon-file-fold-gutter, 14px)',
		marginInlineEnd: '2px',
	},
	'.cm-line.HyperMD-header .cm-fold-indicator .collapse-indicator': {
		color: 'color-mix(in srgb, var(--text-muted) 86%, var(--text-normal))',
		opacity: '1',
		'--collapse-icon-color': 'color-mix(in srgb, var(--text-muted) 86%, var(--text-normal))',
		'--nav-collapse-icon-color': 'color-mix(in srgb, var(--text-muted) 86%, var(--text-normal))',
	},
});

export interface FilePanelLineNumberBlock {
	lineNumber: number;
	top: number;
	height: number;
}

interface FilePanelViewportLineBlock {
	from: number;
	top: number;
	height: number;
}

export function buildFilePanelLineNumberBlocks(
	lineBlocks: readonly FilePanelViewportLineBlock[],
	resolveLineNumber: (position: number) => number,
	documentTop: number,
	railTop: number,
	lineNumberOffset = 0,
): FilePanelLineNumberBlock[] {
	return lineBlocks.map(lineBlock => ({
		lineNumber: resolveLineNumber(lineBlock.from) + lineNumberOffset,
		top: documentTop + lineBlock.top - railTop,
		height: lineBlock.height,
	}));
}

export function getEmbeddedMarkdownSourceEditorFilePath(view: EditorView): string {
	return embeddedMarkdownSourceEditorRecords.get(view)?.filePath ?? '';
}

export function refreshEmbeddedMarkdownSourceEditors(
	effect: StateEffect<unknown> | StateEffect<unknown>[],
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
		private filePanelLineNumberRefreshFrame: number | null = null;
		private filePanelLineNumberElements: HTMLElement[] = [];
		private filePanelLayoutGeneration = 0;
		private filePanelLayoutFrame: number | null = null;
		private filePanelLayoutTimer: number | null = null;
		private filePanelHorizontalScrollFrame: number | null = null;
		private filePanelHorizontalScrollTimer: number | null = null;
		private filePanelLastContentInset: number | null = null;

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
				if (scrollDOM.scrollLeft !== 0) scrollDOM.scrollLeft = 0;
			};
			if (this.isFilePanelSourceEditor()) {
				reset();
				if (this.filePanelHorizontalScrollFrame != null || this.filePanelHorizontalScrollTimer != null) return;
				const generation = this.filePanelLayoutGeneration;
				this.filePanelHorizontalScrollFrame = ownerWindow.requestAnimationFrame(() => {
					this.filePanelHorizontalScrollFrame = null;
					if (generation !== this.filePanelLayoutGeneration) return;
					reset();
				});
				this.filePanelHorizontalScrollTimer = ownerWindow.setTimeout(() => {
					this.filePanelHorizontalScrollTimer = null;
					if (generation !== this.filePanelLayoutGeneration) return;
					reset();
				}, 150);
				return;
			}

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
			const MutationObserverCtor = (ownerWindow as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;

			this.filePanelLayoutObserver?.disconnect();
			const observer = new MutationObserverCtor(() => this.queueFilePanelLayoutGuard());
			observer.observe(view.dom, { childList: true, subtree: true });
			this.filePanelLayoutObserver = observer;

			this.applyFilePanelLayoutGuard();
			this.queueFilePanelLayoutGuard(true);
		}

		private queueFilePanelLayoutGuard(includeLatePass = false): void {
			if (!this.isFilePanelSourceEditor()) return;
			const ownerWindow = getOwnerWindow(this.editor.cm.dom);
			const generation = this.filePanelLayoutGeneration;
			if (this.filePanelLayoutFrame == null) {
				this.filePanelLayoutFrame = ownerWindow.requestAnimationFrame(() => {
					this.filePanelLayoutFrame = null;
					if (generation !== this.filePanelLayoutGeneration) return;
					this.applyFilePanelLayoutGuard();
				});
			}
			if (includeLatePass && this.filePanelLayoutTimer == null) {
				this.filePanelLayoutTimer = ownerWindow.setTimeout(() => {
					this.filePanelLayoutTimer = null;
					if (generation !== this.filePanelLayoutGeneration) return;
					this.applyFilePanelLayoutGuard();
				}, 150);
			}
		}

		private applyFilePanelLayoutGuard(): void {
			const view = this.editor.cm;
			const scrollDOM = view.scrollDOM;
			const gutters = scrollDOM.querySelector<HTMLElement>('.cm-gutters');
			const content = view.contentDOM;

			if (scrollDOM.scrollLeft !== 0) scrollDOM.scrollLeft = 0;

			const overlapInset = gutters
				? Math.ceil(gutters.getBoundingClientRect().right - content.getBoundingClientRect().left + 8)
				: 0;
			const boundedInset = Math.max(0, Math.min(96, overlapInset));
			if (this.filePanelLastContentInset === boundedInset) return;
			this.filePanelLastContentInset = boundedInset;
			this.editorEl.setCssProps({
				'--operon-file-content-inset': `${boundedInset}px`,
			});
			this.queueFilePanelLineNumberRefresh();
		}

		refreshLayout(): void {
			if (!this.isFilePanelSourceEditor()) return;
			const view = this.editor.cm;
			view.requestMeasure();
			this.resetHorizontalScroll();
			this.queueFilePanelLayoutGuard();
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
			if (this.filePanelLineNumberRefreshFrame != null) return;
			this.filePanelLineNumberRefreshFrame = getOwnerWindow(this.editor.cm.dom).requestAnimationFrame(() => {
				this.filePanelLineNumberRefreshFrame = null;
				this.refreshFilePanelLineNumbers();
			});
		}

		private collectFilePanelLineNumberBlocks(): FilePanelLineNumberBlock[] {
			const view = this.editor.cm;
			const rail = this.filePanelLineNumberRail;
			if (!rail) return [];
			const railRect = rail.getBoundingClientRect();
			const lineBlocks = view.viewportLineBlocks;
			const lineNumberOffset = this.options.lineNumberOffset ?? 0;
			return buildFilePanelLineNumberBlocks(
				lineBlocks,
				position => view.state.doc.lineAt(position).number,
				view.documentTop,
				railRect.top,
				lineNumberOffset,
			);
		}

		private refreshFilePanelLineNumbers(): void {
			const layer = this.filePanelLineNumberLayer;
			if (!layer) return;
			const blocks = this.collectFilePanelLineNumberBlocks();
			for (let index = 0; index < blocks.length; index += 1) {
				const block = blocks[index];
				if (!block) continue;
				let lineNumberEl = this.filePanelLineNumberElements[index];
				if (!lineNumberEl) {
					lineNumberEl = createOwnerElement(layer, 'div');
					lineNumberEl.addClass('operon-task-editor-file-line-number');
					layer.appendChild(lineNumberEl);
					this.filePanelLineNumberElements.push(lineNumberEl);
				}
				const lineNumber = String(block.lineNumber);
				if (lineNumberEl.textContent !== lineNumber) lineNumberEl.textContent = lineNumber;
				const top = `${block.top}px`;
				const height = `${block.height}px`;
				if (lineNumberEl.style.getPropertyValue('--operon-file-line-number-top') !== top) {
					lineNumberEl.style.setProperty('--operon-file-line-number-top', top);
				}
				if (lineNumberEl.style.getPropertyValue('--operon-file-line-number-height') !== height) {
					lineNumberEl.style.setProperty('--operon-file-line-number-height', height);
				}
			}
			for (const lineNumberEl of this.filePanelLineNumberElements.splice(blocks.length)) {
				lineNumberEl.remove();
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
						const handled = this.options.onEscape?.();
						return handled ?? this.options.onEscape != null;
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
			this.cancelFilePanelScheduledWork();
			if (this.filePanelLineNumberScrollHandler) {
				this.editor.cm.scrollDOM.removeEventListener('scroll', this.filePanelLineNumberScrollHandler);
				this.filePanelLineNumberScrollHandler = null;
			}
			this.filePanelLayoutObserver?.disconnect();
			this.filePanelLayoutObserver = null;
			this.filePanelLineNumberRail?.remove();
			this.filePanelLineNumberRail = null;
			this.filePanelLineNumberElements = [];
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

		private cancelFilePanelScheduledWork(): void {
			this.filePanelLayoutGeneration += 1;
			const ownerWindow = getOwnerWindow(this.editor.cm.dom);
			if (this.filePanelLayoutFrame != null) ownerWindow.cancelAnimationFrame(this.filePanelLayoutFrame);
			if (this.filePanelLayoutTimer != null) ownerWindow.clearTimeout(this.filePanelLayoutTimer);
			if (this.filePanelHorizontalScrollFrame != null) ownerWindow.cancelAnimationFrame(this.filePanelHorizontalScrollFrame);
			if (this.filePanelHorizontalScrollTimer != null) ownerWindow.clearTimeout(this.filePanelHorizontalScrollTimer);
			if (this.filePanelLineNumberRefreshFrame != null) ownerWindow.cancelAnimationFrame(this.filePanelLineNumberRefreshFrame);
			this.filePanelLayoutFrame = null;
			this.filePanelLayoutTimer = null;
			this.filePanelHorizontalScrollFrame = null;
			this.filePanelHorizontalScrollTimer = null;
			this.filePanelLineNumberRefreshFrame = null;
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

	refreshLayout(): void {
		this.view?.refreshLayout();
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
