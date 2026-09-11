import { MarkdownRenderChild, type MarkdownPostProcessorContext } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { TaskCardLayoutService } from './task-card-layout';
import { parseTaskCardLayoutOptions, type TaskCardLayoutProbeOptions } from './task-card-layout-model';

interface LayoutProbeRegistration {
	registerCodeBlock: (language: string, handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void) => void;
	registerCleanup: (cleanup: () => void) => void;
	layout: TaskCardLayoutService;
}

const PROBE_STYLES = `
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
`;

class LayoutProbeChild extends MarkdownRenderChild {
	private sheet: CSSStyleSheet | null = null;
	private sheetDocument: Document | null = null;

	constructor(root: HTMLElement, private readonly options: TaskCardLayoutProbeOptions, private readonly layout: TaskCardLayoutService) { super(root); }

	onload(): void {
		const root = this.containerEl;
		root.addClass('operon-card-layout-probe');
		const owner = getOwnerWindow(root) as Window & { CSSStyleSheet: typeof CSSStyleSheet };
		this.sheetDocument = root.ownerDocument;
		this.sheet = new owner.CSSStyleSheet();
		this.sheet.replaceSync(PROBE_STYLES);
		root.ownerDocument.adoptedStyleSheets = [...root.ownerDocument.adoptedStyleSheets, this.sheet];
		const card = root.createDiv('probe-card');
		card.style.setProperty('--probe-height', `${this.options.height}px`);
		card.createDiv({ cls: 'probe-image', attr: { 'aria-label': 'Synthetic image placeholder' } });
		card.createEl('strong', { text: 'Task card layout experiment' });
		card.createDiv({ cls: 'probe-description', text: 'Synthetic content. No task is connected. Test typing and scrolling beside this card in both modes.' });
		const actions = card.createDiv('probe-actions');
		const resize = actions.createEl('button', { text: 'Change image height', attr: { type: 'button' } });
		this.registerDomEvent(resize, 'click', () => { card.classList.toggle('is-tall'); this.layout.refresh(); });
		const counter = actions.createEl('button', { text: 'Click test: 0', attr: { type: 'button' } });
		let count = 0;
		this.registerDomEvent(counter, 'click', () => { counter.textContent = `Click test: ${++count}`; });
		this.addChild(this.layout.create(root, card, this.options, 'operon-card-layout-probe'));
	}

	onunload(): void {
		if (this.sheet && this.sheetDocument) this.sheetDocument.adoptedStyleSheets = this.sheetDocument.adoptedStyleSheets.filter(sheet => sheet !== this.sheet);
		this.sheet = null;
		this.sheetDocument = null;
		this.containerEl.removeClass('operon-card-layout-probe');
	}
}

export function registerTaskCardLayoutProbe(registration: LayoutProbeRegistration): void {
	const children = new Set<LayoutProbeChild>();
	registration.registerCodeBlock('operon-card-layout-probe', (source, el, ctx) => {
		let options: TaskCardLayoutProbeOptions;
		try { options = parseTaskCardLayoutOptions(source); }
		catch (error) { el.createDiv({ text: error instanceof Error ? error.message : 'Invalid layout experiment options.' }); return; }
		const child = new LayoutProbeChild(el, options, registration.layout);
		children.add(child);
		child.register(() => children.delete(child));
		ctx.addChild(child);
	});
	registration.registerCleanup(() => { for (const child of [...children]) child.unload(); });
}
