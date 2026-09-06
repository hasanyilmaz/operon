import { MarkdownRenderChild, setIcon, type App, type MarkdownPostProcessorContext } from 'obsidian';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { resolveTaskStatusIconColor } from '../core/task-color-source';
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

	constructor(root: HTMLElement, readonly parsed: TaskCardParseResult, private readonly owner: TaskCardEmbeds) { super(root); }

	onload(): void {
		this.active = true;
		const root = this.containerEl;
		root.addClass('operon-task-card-embed');
		this.card = root.createDiv('operon-task-card');
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
		this.owner.attach(this);
		const options = 'options' in this.parsed ? this.parsed.options : { width: 320, align: 'left' as const, wrap: false };
		this.addChild(this.owner.layout.create(root, this.card, options, 'operon', unavailable => {
			const text = unavailable ? t('errors', 'taskCard_layout') : '';
			if (this.warning.textContent !== text) this.warning.textContent = text;
			this.warning.hidden = !unavailable;
		}));
	}

	refresh(resolution?: TaskCardResolution): void {
		if (!this.active) return;
		try {
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
			const signature = JSON.stringify([title, icon, color, status, hint]);
			if (signature === this.signature) return;
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

	private showMessage(state: string, text: string): void {
		const signature = JSON.stringify([state, text]);
		if (signature === this.signature) return;
		this.header.hidden = true;
		this.message.hidden = false;
		this.message.textContent = text;
		this.containerEl.dataset.taskCardState = state;
		this.signature = signature;
		this.owner.layout.refresh();
	}

	onunload(): void {
		this.active = false;
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
		ctx.addChild(new TaskCardEmbedChild(el, parseTaskCardEmbed(source), this));
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
