import { normalizeTaskCardSettings, type TaskCardSettings } from '../types/task-card';
import { resolveKanbanCardImageReference } from '../core/kanban-card-image-source';
import { TaskCardCanvasHost } from './task-card-canvas';
import type { TaskCardLayoutOptions } from './task-card-layout-model';
import { MarkdownRenderChild, setIcon, TFile, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { resolveTaskColorSource, resolveTaskStatusIconColor } from '../core/task-color-source';
import { resolveTaskDisplayIcon, type OperonSettings } from '../types/settings';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { TaskCardLayoutService } from './task-card-layout';
import { parseTaskCardEmbed, resolveTaskCard, type TaskCardParseResult, type TaskCardReader, type TaskCardResolution } from './task-card-embed-model';

interface TaskCardEmbedDependencies extends TaskCardReader {
	app: App;
	getSettings: () => OperonSettings;
	openEditor: (id: string) => void;
	openSource: (id: string) => void;
}

class TaskCardEmbedChild extends MarkdownRenderChild {
	private card!: HTMLElement;
	private header!: HTMLElement;
	private icon!: HTMLElement;
	private title!: HTMLButtonElement;
	private message!: HTMLElement;
	private warning!: HTMLElement;
	private signature = '';
	private active = false;
 private layoutChild: MarkdownRenderChild | null = null;
 private layoutSignature = '';
 private canvasHost!: TaskCardCanvasHost;
 private imageWrap!: HTMLElement;
 private image: HTMLImageElement | null = null;
 private imageSource: string | null = null;
 parsed: TaskCardParseResult;

	constructor(root: HTMLElement, private readonly source: string, private readonly owner: TaskCardEmbeds) { super(root); this.parsed = parseTaskCardEmbed(source); }

	onload(): void {
		this.active = true;
		const root = this.containerEl;
		root.addClass('operon-task-card-embed');
		this.card = root.createDiv('operon-task-card');
  this.imageWrap = this.card.createDiv('operon-task-card-image');
  this.imageWrap.hidden = true;
		this.header = this.card.createDiv('operon-task-card-header');
		this.icon = this.header.createSpan({ cls: 'operon-task-card-status', attr: { role: 'img' } });
		this.title = this.header.createEl('button', { cls: 'operon-task-card-title', attr: { type: 'button' } });
		this.message = this.card.createDiv({ cls: 'operon-task-card-message', attr: { role: 'status' } });
		this.warning = this.card.createDiv({ cls: 'operon-task-card-message', attr: { role: 'status', hidden: '' } });
		this.registerDomEvent(this.title, 'click', event => {
			const selection = getOwnerWindow(root).getSelection();
			if (selection && !selection.isCollapsed && (root.contains(selection.anchorNode) || root.contains(selection.focusNode))) return;
			event.preventDefault();
			event.stopPropagation();
			if ('options' in this.parsed) this.owner.activate(this.parsed.options.taskId, event.metaKey || event.ctrlKey);
		});
		this.canvasHost = new TaskCardCanvasHost(this.owner.deps.app, root, () => this.refresh());
		this.owner.attach(this);
	}

	refresh(resolution?: TaskCardResolution): void {
		if (!this.active) return;
		try {
   const preferences = normalizeTaskCardSettings(this.owner.deps.getSettings());
   const defaults = { width: preferences.taskCardWidth, align: preferences.taskCardAlign, wrap: preferences.taskCardWrap };
   this.parsed = parseTaskCardEmbed(this.source, defaults);
   this.updateLayout(defaults);
			if ('error' in this.parsed) { this.showMessage('invalid', t('errors', `taskCard_${this.parsed.error}`)); return; }
			const result = resolution ?? this.owner.resolve(this.parsed.options.taskId);
			if (result.state !== 'ready') {
				this.showMessage(result.state, t('errors', `taskCard_${result.state}`, { id: this.parsed.options.taskId }));
				return;
			}
			const task = result.task;
			const settings = this.owner.deps.getSettings();
			const icon = resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox);
			const color = resolveTaskStatusIconColor(task.fieldValues, settings) ?? '';
			const status = task.fieldValues.status || task.checkbox;
			const title = task.description || t('errors', 'taskCard_untitled');
			const hint = t('errors', 'taskCard_open');
   const accent = resolveTaskColorSource(task.fieldValues, preferences.taskCardColorSource, settings);
   const media = resolveKanbanCardImageReference(task.fieldValues, preferences.taskCardImageSource);
   let imageSource: string | null = null;
   if (media?.kind === 'http-url') imageSource = media.target;
   else if (media?.target) {
    const file = this.owner.deps.app.metadataCache.getFirstLinkpathDest(media.target, task.primary.filePath);
    if (file instanceof TFile) imageSource = this.owner.deps.app.vault.getResourcePath(file);
   }
			const signature = JSON.stringify([title, icon, color, status, hint, accent, imageSource, preferences.taskCardImageRatio, preferences.taskCardItemOrder, task.checkbox]);
			if (signature === this.signature) return;
   this.renderImage(imageSource, preferences);
   if (accent) this.card.style.setProperty('--operon-task-card-accent', accent);
   else this.card.style.removeProperty('--operon-task-card-accent');
   this.card.classList.toggle('is-done', task.checkbox === 'done');
   this.card.classList.toggle('is-cancelled', task.checkbox === 'cancelled');
   this.imageWrap.style.order = String(preferences.taskCardItemOrder.indexOf('image'));
   this.header.style.order = String(preferences.taskCardItemOrder.indexOf('header'));
			this.header.hidden = false;
			this.message.hidden = true;
			this.containerEl.dataset.taskCardState = 'ready';
			setIcon(this.icon, icon);
			this.icon.style.color = color;
			this.icon.setAttribute('aria-label', status);
			if (this.title.dataset.description !== title) {
				this.title.empty();
				renderCompactTaskMarkdown(this.title, { app: this.owner.deps.app, value: title, mode: 'visual-only' });
				this.title.dataset.description = title;
			}
			this.title.title = hint;
			this.signature = signature;
			this.owner.layout.refresh();
		} catch { this.showMessage('error', t('errors', 'taskCard_error')); }
	}


 private updateLayout(defaults: TaskCardLayoutOptions): void {
  const canvas = this.canvasHost.refresh('options' in this.parsed ? this.parsed.options.taskId : '', defaults);
  const options = 'options' in this.parsed ? this.parsed.options : defaults;
  const signature = JSON.stringify([canvas, options]);
  if (signature === this.layoutSignature) return;
  this.layoutSignature = signature;
  if (this.layoutChild) { this.removeChild(this.layoutChild); this.layoutChild = null; }
  this.warning.hidden = true;
  if (!canvas) {
   this.layoutChild = this.owner.layout.create(this.containerEl, this.card, options, 'operon', unavailable => {
    const text = unavailable ? t('errors', 'taskCard_layout') : '';
    if (this.warning.textContent !== text) this.warning.textContent = text;
    this.warning.hidden = !unavailable;
   });
   this.addChild(this.layoutChild);
  }
 }

 private renderImage(source: string | null, preferences: TaskCardSettings): void {
  this.imageWrap.dataset.ratio = preferences.taskCardImageRatio;
  if (source === this.imageSource) return;
  this.imageSource = source;
  if (this.image) { this.image.onload = null; this.image.onerror = null; this.image.remove(); this.image = null; }
  this.imageWrap.hidden = !source;
  if (!source) return;
  const image = this.image = this.imageWrap.createEl('img', { attr: { alt: '', decoding: 'async', loading: 'lazy', referrerpolicy: 'no-referrer' } });
  image.draggable = false;
  image.onload = () => { if (this.active && this.image === image) this.owner.layout.refresh(); };
  image.onerror = () => {
   if (!this.active || this.image !== image) return;
   this.imageWrap.hidden = true;
   this.owner.layout.refresh();
  };
  image.src = source;
 }

	private showMessage(state: string, text: string): void {
		const signature = JSON.stringify([state, text]);
		if (signature === this.signature) return;
		this.header.hidden = true;
  this.renderImage(null, normalizeTaskCardSettings(this.owner.deps.getSettings()));
  this.card.style.removeProperty('--operon-task-card-accent');
		this.message.hidden = false;
		this.message.textContent = text;
		this.containerEl.dataset.taskCardState = state;
		this.signature = signature;
		this.owner.layout.refresh();
	}

	onunload(): void {
		this.active = false;
  this.canvasHost.destroy();
  if (this.image) { this.image.onload = null; this.image.onerror = null; }
		this.owner.detach(this);
		this.containerEl.removeClass('operon-task-card-embed');
		delete this.containerEl.dataset.taskCardState;
	}
}

/** Registrations belong to one plugin instance, and expire with their Markdown child. */
export class TaskCardEmbeds {
	private readonly children = new Set<TaskCardEmbedChild>();
	constructor(readonly deps: TaskCardEmbedDependencies, readonly layout: TaskCardLayoutService) {}

	render(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		ctx.addChild(new TaskCardEmbedChild(el, source, this));
	}

	attach(child: TaskCardEmbedChild): void { this.children.add(child); child.refresh(); }
	detach(child: TaskCardEmbedChild): void { this.children.delete(child); }
	resolve(id: string): TaskCardResolution { return resolveTaskCard(this.deps, id); }

	activate(id: string, newTab: boolean): void {
		// Re-resolve after any rename, deletion or duplicate conflict since the last render.
		if (this.resolve(id).state !== 'ready') { this.refresh(); return; }
		if (newTab) this.deps.openSource(id);
		else this.deps.openEditor(id);
	}

	refresh(): void {
		const resolved = new Map<string, TaskCardResolution>();
		for (const child of this.children) {
			if ('options' in child.parsed) {
				const id = child.parsed.options.taskId;
				let result = resolved.get(id);
				if (!result) { result = this.resolve(id); resolved.set(id, result); }
				child.refresh(result);
			} else child.refresh();
		}
	}

	destroy(): void { for (const child of [...this.children]) child.unload(); }
}
