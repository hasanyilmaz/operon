import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { createTaskCardEditorBridge, type TaskCardEditorBridge } from './task-card-layout-editor';
import { findTaskCardParagraphEnd, parseTaskCardLayoutOptions, resolveTaskCardLayout, type TaskCardLayoutOptions } from './task-card-layout-model';

interface LayoutProbeRegistration {
	registerCodeBlock: (language: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void) => void;
	registerExtension: (extension: Extension) => void;
	registerCleanup: (cleanup: () => void) => void;
}

// Scoped to the probe. Kept in this module so production tree shaking removes the CSS too.
let nextProbeId = 0;
const PROBE_STYLES = `
.operon-card-layout-probe-host.probe-live-anchor { height: 0; min-height: 0; width: 100%; padding: 0; border: 0; margin: 0; position: relative; overflow: visible; }
.probe-live-anchor .operon-card-layout-probe { position: absolute; top: 0; left: 0; width: var(--probe-width); z-index: 1; }
.probe-live-anchor.probe-align-right .operon-card-layout-probe { left: auto; right: 0; }
.cm-line.operon-card-layout-probe-reserve::before { content: ""; float: var(--probe-reserve-side); width: var(--probe-reserve-width); height: var(--probe-reserve-height); }
.operon-card-layout-probe-tail { margin: 0; padding: 0; border: 0; pointer-events: none; }

.operon-card-layout-probe { white-space: normal; }
.operon-card-layout-probe .probe-card {
 box-sizing: border-box; width: 100%; min-height: var(--probe-height); padding: 12px;
 border: 1px solid var(--interactive-accent); border-radius: 8px; background: var(--background-primary);
 display: flex; flex-direction: column; gap: 12px; overflow-wrap: anywhere;
}
.operon-card-layout-probe .probe-image { height: 96px; flex: none; border-radius: 8px; background: var(--background-secondary); }
.operon-card-layout-probe .probe-card.is-tall .probe-image { height: 220px; }
.operon-card-layout-probe .probe-description { font-size: var(--font-ui-small); color: var(--text-muted); }
.operon-card-layout-probe .probe-actions { margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; }
.operon-card-layout-probe .probe-error { color: var(--text-error); white-space: normal; }
.operon-card-layout-probe-host {
 box-sizing: border-box; width: var(--probe-width); max-width: 100%; min-width: 0;
 clear: both; margin-inline-start: 0; margin-inline-end: auto;
}
.operon-card-layout-probe-host.probe-align-right { margin-inline-start: auto; margin-inline-end: 0; }
.operon-card-layout-probe-host.probe-align-center { margin-inline-start: auto; margin-inline-end: auto; }
.operon-card-layout-probe-host.probe-wrapping { float: left; margin: 0 16px 0 0; }
.operon-card-layout-probe-host.probe-wrapping.probe-align-right { float: right; margin: 0 0 0 16px; }
.operon-card-layout-probe-boundary { clear: both; }
.operon-card-layout-probe-flow { display: flow-root; }
`;

/** Reference counts allow consecutive probes to share a flow container or boundary. */
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

function findLayoutHost(root: HTMLElement): HTMLElement | null {
	const parent = root.closest('.cm-content') ?? root.closest('.markdown-preview-sizer') ?? root.parentElement?.closest('.markdown-rendered');
	if (!parent) return null;
	let current = root;
	while (current.parentElement && current.parentElement !== parent) current = current.parentElement;
	return current.parentElement === parent ? current : null;
}

function findLiveParagraphRange(view: EditorView, host: HTMLElement): { start: number; end: number; atEnd: boolean; empty: boolean } | null {
	try {
		const position = view.posAtDOM(host);
		const document = view.state.doc;
		const lines = document.toString().split('\n');
		let start = document.lineAt(position).number - 1;
		// Native code block widgets map to their opening fence or the immediately following position.
		while (start >= 0 && !/^\s*(`{3,}|~{3,})operon-card-layout-probe\s*$/.test(lines[start])) start--;
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

class LayoutProbeChild extends MarkdownRenderChild {
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
	private diagnostic: HTMLElement | null = null;
	private readonly id = ++nextProbeId;
	private boundView: EditorView | null = null;

	constructor(
		root: HTMLElement,
		private readonly options: TaskCardLayoutOptions,
		private readonly bridge: TaskCardEditorBridge,
		private readonly children: Set<LayoutProbeChild>,
	) { super(root); }

	onload(): void {
		this.active = true;
		this.children.add(this);
		const root = this.containerEl;
		root.addClass('operon-card-layout-probe');
		const owner = getOwnerWindow(root) as Window & { CSSStyleSheet: typeof CSSStyleSheet; ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver };
		this.sheetDocument = root.ownerDocument;
		this.sheet = new owner.CSSStyleSheet();
		this.sheet.replaceSync(PROBE_STYLES);
		root.ownerDocument.adoptedStyleSheets = [...root.ownerDocument.adoptedStyleSheets, this.sheet];
		const card = root.createDiv('probe-card');
		card.style.setProperty('--probe-height', `${this.options.height}px`);
		card.createDiv({ cls: 'probe-image', attr: { 'aria-label': 'Synthetic image placeholder' } });
		card.createEl('strong', { text: 'Task card layout experiment' });
		card.createDiv({ cls: 'probe-description', text: 'Synthetic content. No task is connected. Test typing and scrolling beside this card in both modes.' });
		this.diagnostic = card.createDiv({ cls: 'probe-description', attr: { role: 'status' } });
		const actions = card.createDiv('probe-actions');
		const resize = actions.createEl('button', { text: 'Change image height', attr: { type: 'button' } });
		this.registerDomEvent(resize, 'click', () => {
			card.classList.toggle('is-tall');
			this.schedule();
		});
		const counter = actions.createEl('button', { text: 'Click test: 0', attr: { type: 'button' } });
		let count = 0;
		this.registerDomEvent(counter, 'click', () => { counter.textContent = `Click test: ${++count}`; });
		this.observer = new owner.ResizeObserver(() => this.schedule());
		this.observer.observe(card);
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
		const host = findLayoutHost(this.containerEl);
		if (!host?.parentElement) return;
		if (host !== this.host) {
			this.releaseHost();
			this.host = host;
			this.hostCleanup.push(acquireClass(host, 'operon-card-layout-probe-host'));
			this.hostCleanup.push(acquireClass(host, `probe-align-${this.options.align}`));
			this.hostCleanup.push(acquireClass(host.parentElement, 'operon-card-layout-probe-flow'));
			const oldWidth = host.style.getPropertyValue('--probe-width');
			const oldPriority = host.style.getPropertyPriority('--probe-width');
			this.hostCleanup.push(() => {
				if (oldWidth) host.style.setProperty('--probe-width', oldWidth, oldPriority);
				else host.style.removeProperty('--probe-width');
				host.classList.remove('probe-wrapping', 'probe-live-anchor');
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
		const paragraphRange = view ? findLiveParagraphRange(view, host) : null;
		const paragraphEnd = paragraphRange?.end ?? null;
		let boundary: Element | null = null;
		for (let sibling = host.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
			if (view && paragraphEnd !== null && !paragraphRange?.empty) {
				try {
					if (sibling.matches('.operon-card-layout-probe-tail')) continue;
					if (view.posAtDOM(sibling) >= paragraphEnd || !sibling.matches('.cm-line')) { boundary = sibling; break; }
				} catch { boundary = sibling; break; }
			} else if (!sibling.matches('p, .el-p')) { boundary = sibling; break; }
		}
		const wrap = layout.wrap && (!isLive || (paragraphRange !== null && !paragraphRange.empty));
		this.containerEl.dataset.probeState = isLive && paragraphEnd === null ? 'unresolved-editor-range' : wrap ? 'wrapping' : 'block';
		const diagnostic = isLive && paragraphEnd === null
			? 'Layout experiment cannot resolve this editor block. Requested wrapping is not available here.'
			: isLive && wrap
				? 'Editor decoration experiment: native Obsidian parity still requires verification.'
				: '';
		if (this.diagnostic && this.diagnostic.textContent !== diagnostic) this.diagnostic.textContent = diagnostic;
		if (boundary !== this.boundary) {
			this.boundaryCleanup?.();
			this.boundary = boundary;
			this.boundaryCleanup = boundary ? acquireClass(boundary, 'operon-card-layout-probe-boundary') : null;
		}
		host.classList.toggle('probe-live-anchor', isLive && wrap);
		if (view && wrap && paragraphRange) {
			const card = this.containerEl.querySelector('.probe-card');
			const cardRect = card?.getBoundingClientRect();
			const first = view.coordsAtPos(paragraphRange.start, 1);
			const end = view.coordsAtPos(paragraphRange.end, paragraphRange.atEnd ? -1 : 1);
			const oldTail = parent.querySelector(`[data-probe-tail="${this.id}"]`)?.getBoundingClientRect().height ?? 0;
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
		host.style.setProperty('--probe-width', `${layout.width}px`);
		host.classList.toggle('probe-wrapping', wrap && !isLive);
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
		this.containerEl.removeClass('operon-card-layout-probe');
		delete this.containerEl.dataset.probeState;
		for (const view of this.bridge.views) if (view.dom.isConnected) view.requestMeasure();
	}
}

export function registerTaskCardLayoutProbe(registration: LayoutProbeRegistration): void {
	const children = new Set<LayoutProbeChild>();
	const bridge = createTaskCardEditorBridge(() => { for (const child of children) child.schedule(); });
	registration.registerExtension(bridge.extension);
	registration.registerCodeBlock('operon-card-layout-probe', (source, el, ctx) => {
		let options: TaskCardLayoutOptions;
		try { options = parseTaskCardLayoutOptions(source); }
		catch (error) {
			el.createDiv({ text: error instanceof Error ? error.message : 'Invalid layout experiment options.' });
			return;
		}
		ctx.addChild(new LayoutProbeChild(el, options, bridge, children));
	});
	registration.registerCleanup(() => {
		for (const child of [...children]) child.unload();
		bridge.views.clear();
	});
}
