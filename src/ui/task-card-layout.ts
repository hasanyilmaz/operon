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
.operon-task-card-layout-host.card-live-anchor { height: 0; min-height: 0; width: var(--card-width); padding: 0; border: 0; margin: 0; position: relative; overflow: visible; }
.card-live-anchor .operon-task-card-layout { position: absolute; top: 0; left: 0; width: var(--card-width); z-index: 1; }
.card-live-anchor.card-align-right .operon-task-card-layout { left: auto; right: 0; }
/* A native hover shadow on a zero-height anchor becomes a stray horizontal line. */
.markdown-source-view.mod-cm6 .cm-embed-block.operon-task-card-layout-host.card-live-anchor:hover { box-shadow: none; }
/* Keep Obsidian's own source controls inside the same hover target, above the card. */
.markdown-source-view.mod-cm6 .cm-embed-block.operon-task-card-layout-host.card-live-anchor > .embed-actions {
 z-index: 2; background-color: var(--background-primary); border-radius: var(--radius-s);
}
.markdown-source-view.mod-cm6 .cm-embed-block.operon-task-card-layout-host.card-live-anchor > .embed-actions:focus-within { opacity: 1; }

.cm-line.operon-task-card-layout-reserve::before { content: ""; float: var(--card-reserve-side); width: var(--card-reserve-width); height: var(--card-reserve-height); }
.operon-task-card-layout-tail { margin: 0; padding: 0; border: 0; pointer-events: none; }

.operon-task-card-layout-host {
 box-sizing: border-box; width: var(--card-width); max-width: 100%; min-width: 0;
 clear: both; margin-left: var(--card-flow-left); margin-right: auto;
}
.operon-task-card-layout-host.card-align-right { margin-left: auto; margin-right: var(--card-flow-right); }
.operon-task-card-layout-host.card-align-center { margin-left: calc(var(--card-flow-left) + (var(--card-flow-width) - var(--card-width)) / 2); margin-right: 0; }
.operon-task-card-layout-host.card-wrapping { float: left; margin: 0 16px 0 var(--card-flow-left); }
.operon-task-card-layout-host.card-wrapping.card-align-right { float: right; margin: 0 var(--card-flow-right) 0 16px; }
/* Native Live Preview forces margin: 0 !important; use relative offsets in the text column. */
.markdown-source-view.mod-cm6 .cm-content > .operon-task-card-layout-host { width: var(--card-width); position: relative; margin: 0 !important; left: var(--card-flow-left); }
.markdown-source-view.mod-cm6 .cm-content > .operon-task-card-layout-host.card-align-right { left: calc(var(--card-flow-left) + max(0px, var(--card-flow-width) - var(--card-width))); }
.markdown-source-view.mod-cm6 .cm-content > .operon-task-card-layout-host.card-align-center { left: calc(var(--card-flow-left) + max(0px, (var(--card-flow-width) - var(--card-width)) / 2)); }
.operon-task-card-layout, .operon-task-card-layout .operon-task-card { min-width: 0; max-width: 100%; box-sizing: border-box; }
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

export function findLiveParagraphRange(view: EditorView, host: HTMLElement, language: string, source?: string, sectionStart?: number): { start: number; end: number; atEnd: boolean; empty: boolean } | null {
	try {
		let position: number | null = null;
		try { position = view.posAtDOM(host); } catch { /* Use a verified renderer section below. */ }
		const document = view.state.doc;
		const lines = document.toString().split('\n');
		let start = position === null ? -1 : document.lineAt(position).number - 1;
		// Native code block widgets map to their opening fence or the immediately following position.
		const opening = new RegExp('^ {0,3}(`{3,}|~{3,})' + language + '\\s*$');
		// Widgets may map to the end of the line immediately before their fence.
		if (position !== null && start + 1 < lines.length && opening.test(lines[start + 1])) start++;
		while (start >= 0 && !opening.test(lines[start])) start--;
		const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim();
		if (source !== undefined && Number.isInteger(sectionStart) && sectionStart! >= 0
			&& sectionStart! < lines.length && opening.test(lines[sectionStart!])) {
			const hint = sectionStart!;
			const marker = /^\s*(`{3,}|~{3,})/.exec(lines[hint])![1];
			let close = hint + 1;
			while (close < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[close])) close++;
			if (close < lines.length && normalize(lines.slice(hint + 1, close).join('\n')) === normalize(source)) start = hint;
		}
		if (start < 0) return null;
		const fence = /^\s*(`{3,}|~{3,})/.exec(lines[start])?.[1];
		if (!fence) return null;
		let end = start + 1;
		while (end < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[end])) end++;
		if (end === lines.length) return null;
		if (source !== undefined) {
			if (normalize(lines.slice(start + 1, end).join('\n')) !== normalize(source)) return null;
		} else if (position === null || position > document.line(end + 1).to + 1) return null;
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
		private readonly source?: string,
		private readonly sectionStart?: () => number | undefined,
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
			for (const element of new Set([host, this.containerEl, this.card])) {
				const value = element.style.getPropertyValue('width'), priority = element.style.getPropertyPriority('width');
				this.hostCleanup.push(() => { if (value) element.style.setProperty('width', value, priority); else element.style.removeProperty('width'); });
			}
			for (const property of ['--card-width', '--card-flow-width', '--card-flow-left', '--card-flow-right', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom']) {
				const value = host.style.getPropertyValue(property), priority = host.style.getPropertyPriority(property);
				this.hostCleanup.push(() => { if (value) host.style.setProperty(property, value, priority); else host.style.removeProperty(property); });
			}
			this.hostCleanup.push(() => host.classList.remove('card-wrapping', 'card-live-anchor'));
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
		const paddingLeft = parseFloat(parentStyle.paddingLeft || '0');
		const contentWidth = Math.max(0, parent.clientWidth - paddingLeft - parseFloat(parentStyle.paddingRight || '0'));
		// Measure an ordinary text block, not the wider widget/sizer. Prefer a
		// preceding block so the current float cannot influence the measurement.
		const selector = parent.matches('.cm-content')
			? '.cm-line:not(.HyperMD-table-row)'
			: 'p, h1, h2, h3, h4, h5, h6, .el-p, .el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6';
		let textLine: HTMLElement | null = null;
		for (let sibling = host.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
			if (sibling.matches(selector)) { textLine = sibling as HTMLElement; break; }
		}
		textLine ??= parent.querySelector<HTMLElement>(`:scope > :is(${selector})`);
		// Reading mode may put the readable width on the paragraph inside its section.
		const textBlock = textLine?.matches('.cm-line, p, h1, h2, h3, h4, h5, h6')
			? textLine : textLine?.querySelector<HTMLElement>('p, h1, h2, h3, h4, h5, h6') ?? textLine;
		const textRect = textBlock?.getBoundingClientRect();
		const parentRect = parent.getBoundingClientRect();
		// DOM rectangles include CSS zoom/transforms; widths and offsets below are
		// CSS layout pixels, just like clientWidth and the editor reservation.
		const scale = parent.offsetWidth > 0 && parentRect.width > 0 ? parentRect.width / parent.offsetWidth : 1;
		const inset = textRect && textRect.width > 0
			? Math.max(0, Math.min(contentWidth, (textRect.left - parentRect.left) / scale - parent.clientLeft - paddingLeft)) : 0;
		const available = textRect && textRect.width > 0 ? Math.min(contentWidth - inset, textRect.width / scale) : contentWidth;
		host.style.setProperty('--card-flow-left', `${inset}px`);
		host.style.setProperty('--card-flow-right', `${Math.max(0, contentWidth - inset - available)}px`);
		host.style.setProperty('--card-flow-width', `${available}px`);
		const layout = resolveTaskCardLayout(this.options, available);
		const view = [...this.bridge.views].find(candidate => candidate.contentDOM === parent);
		this.boundView = view ?? null;
		// A CM widget must have a live owning view and a recoverable source range.
		const isLive = parent.matches('.cm-content');
		const paragraphRange = view ? findLiveParagraphRange(view, host, this.language, this.source, this.sectionStart?.()) : null;
		const paragraphEnd = paragraphRange?.end ?? null;
		let boundary: Element | null = null;
		for (let sibling = host.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
			if (view && paragraphEnd !== null && !paragraphRange?.empty) {
				try {
					if (sibling.matches('.operon-task-card-layout-tail')) continue;
					if (view.posAtDOM(sibling) >= paragraphEnd || !sibling.matches('.cm-line')) { boundary = sibling; break; }
				} catch { boundary = sibling; break; }
			} else if (!sibling.matches('p, .el-p, h1, h2, h3, h4, h5, h6, .el-h1, .el-h2, .el-h3, .el-h4, .el-h5, .el-h6, ul, ol, .el-ul, .el-ol')) { boundary = sibling; break; }
		}
		const wrap = layout.wrap && !target.localOnly && (!isLive || (paragraphRange !== null && !paragraphRange.empty));
		// Minimal centers every native block with margin-inline: auto !important.
		// Own only this card's margins, at inline priority, so theme centering
		// cannot add a second offset or move a float outside the text column.
		const rightInset = Math.max(0, contentWidth - inset - available);
		const marginLeft = isLive ? '0px' : this.options.align === 'center'
			? `${inset + (available - layout.width) / 2}px`
			: this.options.align === 'right' ? (wrap ? '16px' : 'auto') : `${inset}px`;
		const marginRight = isLive ? '0px' : this.options.align === 'right'
			? `${rightInset}px` : wrap ? '16px' : 'auto';
		for (const [property, value] of [['margin-left', marginLeft], ['margin-right', marginRight], ['margin-top', '12px'], ['margin-bottom', isLive && wrap ? '0px' : '12px']]) {
			host.style.setProperty(property, value, 'important');
		}
		let first: ReturnType<EditorView['coordsAtPos']> = null;
		let end: ReturnType<EditorView['coordsAtPos']> = null;
		if (view && wrap && paragraphRange) {
			try {
				first = view.coordsAtPos(paragraphRange.start, 1);
				end = view.coordsAtPos(paragraphRange.end, paragraphRange.atEnd ? -1 : 1);
			} catch { /* Off-screen source positions can temporarily lack coordinates. */ }
			// CodeMirror does not provide coordinates for off-screen paragraphs.
			// Their source positions still support reservations; no tail is needed
			// when the boundary is below the rendered viewport.
			if (!first) {
				const anchor = host.getBoundingClientRect();
				first = { left: anchor.left, right: anchor.right, top: anchor.top, bottom: anchor.top };
			}
		}
		this.containerEl.dataset.cardLayoutState = isLive && paragraphEnd === null ? 'unresolved-editor-range' : wrap ? 'wrapping' : 'block';
		this.onUnavailable(this.options.wrap && !wrap);
		if (boundary !== this.boundary) {
			this.boundaryCleanup?.();
			this.boundary = boundary;
			this.boundaryCleanup = boundary ? acquireClass(boundary, 'operon-task-card-layout-boundary') : null;
		}
		host.style.setProperty('--card-width', `${layout.width}px`);
		// Constrain the rendered card too: native wrappers and intrinsic media sizes
		// must not expand it beyond the explicit embed width.
		for (const element of new Set([host, this.containerEl, this.card])) {
			element.style.setProperty('width', `${layout.width}px`, 'important');
		}
		host.classList.toggle('card-live-anchor', isLive && wrap);
		if (view && wrap && paragraphRange && first) {
			const cardRect = this.card.getBoundingClientRect();
			const oldTail = parent.querySelector(`[data-card-layout-tail="${this.id}"]`)?.getBoundingClientRect().height ?? 0;
			const boundaryTop = end ? (paragraphRange.atEnd ? end.bottom : end.top - oldTail) : Infinity;
			this.bridge.set(view, this.id, {
				reserveFrom: paragraphRange.start, boundaryFrom: paragraphRange.end, atEnd: paragraphRange.atEnd,
				width: layout.width + 16, height: Math.max(0, Math.ceil((cardRect.bottom - first.top) / scale + 12)),
				side: this.options.align === 'right' ? 'right' : 'left',
				tail: Math.max(0, Math.ceil((cardRect.bottom - boundaryTop) / scale + 12)),
			});
		} else if (view) this.bridge.set(view, this.id, null);
		const signature = `${available}:${layout.width}:${wrap}:${host.getBoundingClientRect().height}`;
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

	create(root: HTMLElement, card: HTMLElement, options: TaskCardLayoutOptions, language: string, onUnavailable: (unavailable: boolean) => void = () => {}, source?: string, sectionStart?: () => number | undefined): MarkdownRenderChild {
		return new TaskCardLayoutChild(root, options, this.bridge, this.children, ++this.nextId, card, language, onUnavailable, source, sectionStart);
	}

	refresh(): void {
		for (const child of this.children) child.schedule();
	}

	destroy(): void {
		for (const child of [...this.children]) child.unload();
	}
}
