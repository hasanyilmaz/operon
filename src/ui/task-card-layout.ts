import { MarkdownRenderChild } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { getOwnerWindow } from '../core/dom-compat';
import { createTaskCardEditorBridge, type TaskCardEditorBridge } from './task-card-layout-editor';
import { findTaskCardParagraphEnd, resolveTaskCardLayout, type TaskCardLayoutOptions } from './task-card-layout-model';

const LAYOUT_STYLES = `
/* Native LP widgets use paint containment, which clips this zero-height anchor's card.
   Override only active wrapping anchors, including the native hover overflow rule. */
.markdown-source-view.mod-cm6 .cm-content > [contenteditable=false].operon-task-card-layout-host.card-live-anchor {
 contain: none !important; overflow: visible;
}
.operon-task-card-layout-host.card-live-anchor { height: 0; min-height: 0; width: 100%; padding: 0; border: 0; margin: 0; position: relative; overflow: visible; }
.card-live-anchor .operon-task-card-layout { position: absolute; top: 0; left: 0; width: var(--card-width); z-index: 1; }
.card-live-anchor.card-align-right .operon-task-card-layout { left: auto; right: 0; }
.cm-line.operon-task-card-layout-reserve::before { content: ""; float: var(--card-reserve-side); width: var(--card-reserve-width); height: var(--card-reserve-height); }
.operon-task-card-layout-tail { margin: 0; padding: 0; border: 0; pointer-events: none; }

.operon-task-card-layout-host {
 box-sizing: border-box; width: var(--card-width); max-width: 100%; min-width: 0;
 clear: both; margin-inline-start: 0; margin-inline-end: auto;
}
.operon-task-card-layout-host.card-align-right { margin-inline-start: auto; margin-inline-end: 0; }
.operon-task-card-layout-host.card-align-center { margin-inline-start: auto; margin-inline-end: auto; }
.operon-task-card-layout-host.card-wrapping { float: left; margin: 0 16px 0 0; }
.operon-task-card-layout-host.card-wrapping.card-align-right { float: right; margin: 0 0 0 16px; }
.operon-task-card-layout-boundary { clear: both; }
.operon-task-card-layout-flow { display: flow-root; }
`;

/** Reference counts allow consecutive cards to share a flow container or boundary. */
const managedClasses = /* @__PURE__ */ new WeakMap<Element, Map<string, { count: number; existed: boolean }>>();
function acquireClass(element: Element, name: string): () => void {
	let entries = managedClasses.get(element);
	if (!entries) { entries = new Map(); managedClasses.set(element, entries); }
	const entry = entries.get(name) ?? { count: 0, existed: element.classList.contains(name) };
	entries.set(name, entry);
	entry.count++;
	element.classList.add(name);
	return () => {
		entry.count--;
		if (entry.count === 0) {
			if (!entry.existed) element.classList.remove(name);
			entries.delete(name);
		}
	};
}

function findLayoutHost(root: HTMLElement): { host: HTMLElement; localOnly: boolean } | null {
	// A nested rendered note owns its own flow, even when it is inside a CM widget.
	const parent = root.closest('.cm-content, .markdown-preview-sizer') ?? root.parentElement?.closest('.markdown-rendered');
	if (!parent) return null;
	let current = root;
	while (current.parentElement && current.parentElement !== parent) {
		const ancestor = current.parentElement;
		// Never resize or float an enclosing callout, list, table or transclusion.
		if (ancestor.matches('.callout, .callout-content, li, blockquote, td, th, .markdown-embed, .markdown-embed-content')) {
			return { host: root, localOnly: true };
		}
		current = ancestor;
	}
	return current.parentElement === parent ? { host: current, localOnly: false } : null;
}

function findLiveParagraphRange(view: EditorView, host: HTMLElement, language: string): { start: number; end: number; atEnd: boolean; empty: boolean } | null {
	try {
		const position = view.posAtDOM(host);
		const document = view.state.doc;
		const lines = document.toString().split('\n');
		let start = document.lineAt(position).number - 1;
		// Native code block widgets map to their opening fence or the immediately following position.
		const opening = new RegExp('^ {0,3}(`{3,}|~{3,})' + language + '\\s*$');
		while (start >= 0 && !opening.test(lines[start])) start--;
		if (start < 0) return null;
		const fence = /^\s*(`{3,}|~{3,})/.exec(lines[start])?.[1];
		if (!fence) return null;
		let end = start + 1;
		while (end < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[end])) end++;
		if (end === lines.length || position > document.line(end + 1).to + 1) return null;
		const boundary = findTaskCardParagraphEnd(lines, end + 1);
		let paragraph = end + 1;
		while (paragraph < boundary && !lines[paragraph].trim()) paragraph++;
		if (paragraph >= boundary) return { start: 0, end: 0, atEnd: false, empty: true };
		return { start: document.line(paragraph + 1).from, end: boundary === lines.length ? document.length : document.line(boundary + 1).from, atEnd: boundary === lines.length, empty: false };
	} catch { return null; }
}

class TaskCardLayoutChild extends MarkdownRenderChild {
	private frame = 0;
	private observer: ResizeObserver | null = null;
	private mutationObserver: MutationObserver | null = null;
	private host: HTMLElement | null = null;
	private boundary: Element | null = null;
	private boundaryCleanup: (() => void) | null = null;
	private hostCleanup: Array<() => void> = [];
	private lastSignature = '';
	private active = false;
	private sheet: CSSStyleSheet | null = null;
	private sheetDocument: Document | null = null;
	private observedParent: HTMLElement | null = null;
	private frameWindow: Window | null = null;
	private boundView: EditorView | null = null;

	constructor(
		root: HTMLElement,
		private readonly options: TaskCardLayoutOptions,
		private readonly bridge: TaskCardEditorBridge,
		private readonly children: Set<TaskCardLayoutChild>,
		private readonly id: number,
		private readonly card: HTMLElement,
		private readonly language: string,
		private readonly onUnavailable: (unavailable: boolean) => void,
	) { super(root); }

	onload(): void {
		this.active = true;
		this.children.add(this);
		const root = this.containerEl;
		root.addClass('operon-task-card-layout');
		const owner = getOwnerWindow(root) as Window & { CSSStyleSheet: typeof CSSStyleSheet; ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
		this.sheetDocument = root.ownerDocument;
		this.sheet = new owner.CSSStyleSheet();
		this.sheet.replaceSync(LAYOUT_STYLES);
		root.ownerDocument.adoptedStyleSheets = [...root.ownerDocument.adoptedStyleSheets, this.sheet];
		this.observer = new owner.ResizeObserver(() => this.schedule());
		this.observer.observe(this.card);
		this.registerDomEvent(owner, 'resize', () => this.schedule());
		this.schedule();
	}

	schedule(): void {
		if (!this.active || this.frame) return;
		this.frameWindow = getOwnerWindow(this.containerEl);
		this.frame = this.frameWindow.requestAnimationFrame(() => {
			this.frame = 0;
			this.frameWindow = null;
			this.refresh();
		});
	}

	private releaseHost(): void {
		if (this.boundView) this.bridge.set(this.boundView, this.id, null);
		this.boundView = null;
		if (this.observedParent) this.observer?.unobserve(this.observedParent);
		this.observedParent = null;
		this.boundaryCleanup?.();
		this.boundaryCleanup = null;
		this.boundary = null;
		for (const cleanup of this.hostCleanup.splice(0)) cleanup();
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.host = null;
		this.lastSignature = '';
	}

	private refresh(): void {
		if (!this.active || !this.containerEl.isConnected) return;
		const target = findLayoutHost(this.containerEl);
		const host = target?.host;
		if (!host?.parentElement || !target) return;
		if (host !== this.host) {
			this.releaseHost();
			this.host = host;
			this.hostCleanup.push(acquireClass(host, 'operon-task-card-layout-host'));
			this.hostCleanup.push(acquireClass(host, `card-align-${this.options.align}`));
			this.hostCleanup.push(acquireClass(host.parentElement, 'operon-task-card-layout-flow'));
			const oldWidth = host.style.getPropertyValue('--card-width');
			const oldPriority = host.style.getPropertyPriority('--card-width');
			this.hostCleanup.push(() => {
				if (oldWidth) host.style.setProperty('--card-width', oldWidth, oldPriority);
				else host.style.removeProperty('--card-width');
				host.classList.remove('card-wrapping', 'card-live-anchor');
			});
			this.observedParent = host.parentElement;
			this.observer?.observe(this.observedParent);
			const owner = getOwnerWindow(host) as Window & { CSSStyleSheet: typeof CSSStyleSheet; ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
			this.mutationObserver = new owner.MutationObserver(() => this.schedule());
			this.mutationObserver.observe(host.parentElement, { childList: true, subtree: true, characterData: true });
		}
		const parent = host.parentElement;
		if (!parent) return;
		const owner = getOwnerWindow(host) as Window & { CSSStyleSheet: typeof CSSStyleSheet; ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
		const parentStyle = owner.getComputedStyle(parent);
		const available = parent.clientWidth - parseFloat(parentStyle.paddingLeft || '0') - parseFloat(parentStyle.paddingRight || '0');
		const layout = resolveTaskCardLayout(this.options, available);
		const view = [...this.bridge.views].find(candidate => candidate.contentDOM === parent);
		this.boundView = view ?? null;
		// A CM widget must have a live owning view and a recoverable source range.
		const isLive = parent.matches('.cm-content');
		const paragraphRange = view ? findLiveParagraphRange(view, host, this.language) : null;
		const paragraphEnd = paragraphRange?.end ?? null;
		let boundary: Element | null = null;
		for (let sibling = host.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
			if (view && paragraphEnd !== null && !paragraphRange?.empty) {
				try {
					if (sibling.matches('.operon-task-card-layout-tail')) continue;
					if (view.posAtDOM(sibling) >= paragraphEnd || !sibling.matches('.cm-line')) { boundary = sibling; break; }
				} catch { boundary = sibling; break; }
			} else if (!sibling.matches('p, .el-p')) { boundary = sibling; break; }
		}
		const wrap = layout.wrap && !target.localOnly && (!isLive || (paragraphRange !== null && !paragraphRange.empty));
		this.containerEl.dataset.cardLayoutState = isLive && paragraphEnd === null ? 'unresolved-editor-range' : wrap ? 'wrapping' : 'block';
		this.onUnavailable(layout.wrap && (target.localOnly || (isLive && paragraphRange === null)));
		if (boundary !== this.boundary) {
			this.boundaryCleanup?.();
			this.boundary = boundary;
			this.boundaryCleanup = boundary ? acquireClass(boundary, 'operon-task-card-layout-boundary') : null;
		}
		host.style.setProperty('--card-width', `${layout.width}px`);
		host.classList.toggle('card-live-anchor', isLive && wrap);
		if (view && wrap && paragraphRange) {
			const cardRect = this.card.getBoundingClientRect();
			const first = view.coordsAtPos(paragraphRange.start, 1);
			const end = view.coordsAtPos(paragraphRange.end, paragraphRange.atEnd ? -1 : 1);
			const oldTail = parent.querySelector(`[data-card-layout-tail="${this.id}"]`)?.getBoundingClientRect().height ?? 0;
			const boundaryTop = end ? (paragraphRange.atEnd ? end.bottom : end.top - oldTail) : Infinity;
			this.bridge.set(view, this.id, {
				reserveFrom: paragraphRange.start, boundaryFrom: paragraphRange.end, atEnd: paragraphRange.atEnd,
				width: layout.width + 16, height: Math.max(0, Math.ceil((cardRect?.bottom ?? 0) - (first?.top ?? cardRect?.bottom ?? 0))),
				side: this.options.align === 'right' ? 'right' : 'left',
				tail: Math.max(0, Math.ceil((cardRect?.bottom ?? 0) - boundaryTop)),
			});
		} else if (view) this.bridge.set(view, this.id, null);
		const signature = `${layout.width}:${wrap}:${host.getBoundingClientRect().height}`;
		if (signature === this.lastSignature) return;
		this.lastSignature = signature;
		host.classList.toggle('card-wrapping', wrap && !isLive);
		view?.requestMeasure();
	}

	onunload(): void {
		this.active = false;
		this.children.delete(this);
		if (this.frame) this.frameWindow?.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.frameWindow = null;
		this.observer?.disconnect();
		this.releaseHost();
		if (this.sheet && this.sheetDocument) this.sheetDocument.adoptedStyleSheets = this.sheetDocument.adoptedStyleSheets.filter(sheet => sheet !== this.sheet);
		this.sheet = null;
		this.sheetDocument = null;
		this.containerEl.removeClass('operon-task-card-layout');
		delete this.containerEl.dataset.cardLayoutState;
		for (const view of this.bridge.views) if (view.dom.isConnected) view.requestMeasure();
	}
}

/** One bridge and ID space for real cards and the development-only probe. */
export class TaskCardLayoutService {
	private readonly children = new Set<TaskCardLayoutChild>();
	private readonly bridge = createTaskCardEditorBridge(() => this.refresh());
	private nextId = 0;
	readonly extension = this.bridge.extension;

	create(root: HTMLElement, card: HTMLElement, options: TaskCardLayoutOptions, language: string, onUnavailable: (unavailable: boolean) => void = () => {}): MarkdownRenderChild {
		return new TaskCardLayoutChild(root, options, this.bridge, this.children, ++this.nextId, card, language, onUnavailable);
	}

	refresh(): void {
		for (const child of this.children) child.schedule();
	}

	destroy(): void {
		for (const child of [...this.children]) child.unload();
	}
}
