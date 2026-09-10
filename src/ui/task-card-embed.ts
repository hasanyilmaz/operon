import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import type { IndexedTask } from '../types/fields';
import { Notice } from 'obsidian';
import { TaskCardControls, type TaskCardControlDependencies } from './task-card-controls';
import { isValidOperonId } from '../core/id-generator';
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
 controls?: Omit<TaskCardControlDependencies, 'app' | 'getSettings' | 'run'>;
	app: App;
	getSettings: () => OperonSettings;
	openEditor: (id: string) => void;
	openSource: (id: string) => void;
}

class TaskCardEmbedChild extends MarkdownRenderChild {
	private card!: HTMLElement;
	private header!: HTMLElement;
	private icon!: HTMLButtonElement;
 private controls: TaskCardControls | null = null;
	private title!: HTMLButtonElement;
	private message!: HTMLElement;
	private warning!: HTMLElement;
	private signature = '';
	private active = false;
 private layoutChild: MarkdownRenderChild | null = null;
 private layoutSignature = '';
 private canvasHost: TaskCardCanvasHost | null = null;
 private imageWrap!: HTMLElement;
 private image: HTMLImageElement | null = null;
 private imageSource: string | null = null;
 parsed: TaskCardParseResult;

	constructor(root: HTMLElement, private readonly source: string | { taskId: string }, private readonly owner: TaskCardEmbeds) { super(root); this.parsed = this.readOptions(); }

 private readOptions(defaults?: TaskCardLayoutOptions): TaskCardParseResult {
  if (typeof this.source === 'string') return parseTaskCardEmbed(this.source, defaults);
  return isValidOperonId(this.source.taskId)
   ? { options: { taskId: this.source.taskId, width: 320, align: 'left', wrap: false } }
   : { error: 'taskId' };
 }

	onload(): void {
		this.active = true;
		const root = this.containerEl;
		root.addClass('operon-task-card-embed');
		this.card = root.createDiv('operon-task-card');
  this.imageWrap = this.card.createDiv('operon-task-card-image');
  this.imageWrap.hidden = true;
		this.header = this.card.createDiv('operon-task-card-header');
		this.icon = this.header.createEl('button', { cls: 'operon-task-card-status', attr: { type: 'button' } });
		this.title = this.header.createEl('button', { cls: 'operon-task-card-title', attr: { type: 'button' } });
		this.message = this.card.createDiv({ cls: 'operon-task-card-message', attr: { role: 'status' } });
		this.warning = this.card.createDiv({ cls: 'operon-task-card-message', attr: { role: 'status', hidden: '' } });
  let suppressDescriptionClick = false;
  let clearDescriptionGesture = () => {};
  this.register(() => clearDescriptionGesture());
  this.registerDomEvent(this.title, 'pointerdown', event => {
   if (!root.closest('.operon-task-card-canvas-node') || event.button !== 0) return;
   clearDescriptionGesture(); suppressDescriptionClick = false;
   const doc = root.ownerDocument, win = getOwnerWindow(root), x = event.clientX, y = event.clientY;
   const moved = (next: PointerEvent) => {
    if (next.pointerId === event.pointerId && Math.hypot(next.clientX - x, next.clientY - y) >= 6) suppressDescriptionClick = true;
   };
   const cancel = () => { suppressDescriptionClick = true; clearDescriptionGesture(); };
   const end = (next: PointerEvent) => { if (next.pointerId === event.pointerId) { moved(next); clearDescriptionGesture(); } };
   doc.addEventListener('pointermove', moved, true); doc.addEventListener('pointerup', end, true);
   doc.addEventListener('pointercancel', cancel, true); win.addEventListener('blur', cancel);
   clearDescriptionGesture = () => {
    doc.removeEventListener('pointermove', moved, true); doc.removeEventListener('pointerup', end, true);
    doc.removeEventListener('pointercancel', cancel, true); win.removeEventListener('blur', cancel);
    clearDescriptionGesture = () => {};
   };
  });
  this.registerDomEvent(this.title, 'dblclick', event => {
   if (root.closest('.operon-task-card-canvas-node')) { event.preventDefault(); event.stopPropagation(); }
  });
		this.registerDomEvent(this.title, 'click', event => {
   if (root.closest('.operon-task-card-canvas-node')) {
    event.preventDefault(); event.stopPropagation();
    if (!suppressDescriptionClick || event.detail === 0) this.controls?.openDescription(this.title);
    return;
   }
			const selection = getOwnerWindow(root).getSelection();
			if (selection && !selection.isCollapsed && (root.contains(selection.anchorNode) || root.contains(selection.focusNode))) return;
			event.preventDefault();
			event.stopPropagation();
			if ('options' in this.parsed) this.owner.activate(this.parsed.options.taskId, event.metaKey || event.ctrlKey);
		});
		if (typeof this.source === 'string') this.canvasHost = new TaskCardCanvasHost(this.owner.deps.app, root, () => this.refresh());
		this.owner.attach(this);
	}

	refresh(resolution?: TaskCardResolution): void {
		if (!this.active) return;
		try {
   const preferences = normalizeTaskCardSettings(this.owner.deps.getSettings());
   const defaults = { width: preferences.taskCardWidth, align: preferences.taskCardAlign, wrap: preferences.taskCardWrap };
   this.parsed = this.readOptions(defaults);
   this.updateLayout(defaults);
			if ('error' in this.parsed) { this.showMessage('invalid', t('errors', `taskCard_${this.parsed.error}`)); return; }
			const result = resolution ?? this.owner.resolve(this.parsed.options.taskId);
			if (result.state !== 'ready') {
				this.showMessage(result.state, t('errors', `taskCard_${result.state}`, { id: this.parsed.options.taskId }));
				return;
			}
			const task = result.task;
   if (!this.controls && this.owner.deps.controls) {
    const deps = this.owner.deps.controls;
    this.controls = new TaskCardControls(this.containerEl, this.card, this.header, this.icon, task.operonId, { ...deps,
     app: this.owner.deps.app, getSettings: this.owner.deps.getSettings,
     getAllTasks: () => this.owner.getAllTasks(),
     getTask: id => this.owner.resolve(id).state === 'ready' ? deps.getTask(id) : undefined,
     run: (id, allowed, action) => this.owner.run(id, allowed, action),
    });
    this.addChild(this.controls);
   }
   const interactiveTask = this.owner.deps.controls?.getTask(task.operonId);
   if (interactiveTask) this.controls?.refresh(interactiveTask);
			const settings = this.owner.deps.getSettings();
			const icon = resolveTaskDisplayIcon(settings, task.fieldValues, task.checkbox);
			const color = resolveTaskStatusIconColor(task.fieldValues, settings) ?? '';
			const status = task.fieldValues.status || task.checkbox;
			const title = task.description || t('errors', 'taskCard_untitled');
			const hint = this.containerEl.closest('.operon-task-card-canvas-node') ? t('taskEditor', 'description') : t('errors', 'taskCard_open');
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
			this.icon.empty();
			setIcon(this.icon, icon);
			this.icon.style.color = color;
			setAccessibleLabelWithoutTooltip(this.icon, t('tooltips', 'cycleTaskStatus'));
			if (this.title.dataset.description !== title) {
				this.title.empty();
				renderCompactTaskMarkdown(this.title, { app: this.owner.deps.app, value: title, mode: 'visual-only' });
				this.title.dataset.description = title;
			}
			setAccessibleLabelWithoutTooltip(this.title, `${title}. ${hint}`);
			this.signature = signature;
			this.owner.layout.refresh();
		} catch { this.showMessage('error', t('errors', 'taskCard_error')); }
	}


 private updateLayout(defaults: TaskCardLayoutOptions): void {
  const canvas = typeof this.source !== 'string' || this.canvasHost?.refresh('options' in this.parsed ? this.parsed.options.taskId : '', defaults);
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
  if (this.controls) { this.removeChild(this.controls); this.controls = null; }
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
  this.canvasHost?.destroy();
  if (this.image) { this.image.onload = null; this.image.onerror = null; }
		this.owner.detach(this);
		this.containerEl.removeClass('operon-task-card-embed');
		delete this.containerEl.dataset.taskCardState;
	}
}

/** Registrations belong to one plugin instance, and expire with their Markdown child. */
export class TaskCardEmbeds {
	private readonly children = new Set<TaskCardEmbedChild>();
 private readonly refreshListeners = new Set<() => void>();
 onRefresh(listener: () => void): () => void { this.refreshListeners.add(listener); return () => { this.refreshListeners.delete(listener); }; }
 private readonly pending = new Set<string>();
 private allTasks: IndexedTask[] | null = null;
 getAllTasks(): IndexedTask[] { return this.allTasks ??= this.deps.controls?.getAllTasks() ?? []; }
 async run(id: string, allowed: () => boolean, action: () => Promise<boolean | void> | boolean | void): Promise<boolean> {
  if (this.pending.has(id)) return false;
  if (!allowed() || this.resolve(id).state !== 'ready') { new Notice(t('notifications', 'taskCardActionUnavailable')); return false; }
  this.pending.add(id);
  try { return (await action()) !== false; }
  catch { new Notice(t('notifications', 'taskCardActionUnavailable')); return false; }
  finally { this.pending.delete(id); this.refresh(); }
 }
	constructor(readonly deps: TaskCardEmbedDependencies, readonly layout: TaskCardLayoutService) {}

	render(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		ctx.addChild(new TaskCardEmbedChild(el, source, this));
	}

	mountCanvas(el: HTMLElement, taskId: string): MarkdownRenderChild {
		const child = new TaskCardEmbedChild(el, { taskId }, this);
		child.load();
		return child;
	}

	refreshRoot(root: HTMLElement): void { for (const child of this.children) if (child.containerEl === root) child.refresh(); }
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
  this.allTasks = null;
		const resolved = new Map<string, TaskCardResolution>();
		for (const child of this.children) {
			if ('options' in child.parsed) {
				const id = child.parsed.options.taskId;
				let result = resolved.get(id);
				if (!result) { result = this.resolve(id); resolved.set(id, result); }
				child.refresh(result);
			} else child.refresh();
		}
  for (const listener of this.refreshListeners) listener();
	}

	destroy(): void { this.refreshListeners.clear(); for (const child of [...this.children]) child.unload(); }
}
