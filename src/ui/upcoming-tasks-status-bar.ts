import { bindOperonHoverTooltip, cleanupOperonHoverTooltips, closeBoundOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { setIcon } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import type { OperonSettings } from '../types/settings';
import { UpcomingTaskStatusModel } from '../core/upcoming-task-status';
import { t } from '../core/i18n';
import { asyncHandler } from '../core/async-action';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

/** Legacy mobile/native surface; desktop docks consume the same selection model. */
export class UpcomingTasksStatusBar {
	private readonly model: UpcomingTaskStatusModel;
	private readonly listeners: Array<() => void> = [];
	private timeEl!: HTMLElement;
	private nameEl!: HTMLElement;
	private openEl!: HTMLElement;
	private tooltipKey = '';
	private description = '';
	private language = '';

	constructor(private readonly rootEl: HTMLElement,
		indexer: Pick<OperonIndexer, 'getAllTasks'> & Partial<Pick<OperonIndexer, 'getGeneration'>>,
		private readonly getSettings: () => OperonSettings,
		onTaskClick: (taskId: string, action: OperonSettings['upcomingStatusBarClickAction']) => void | Promise<void>,
		clock: () => Date = () => new Date()) {
		this.model = new UpcomingTaskStatusModel(indexer, getSettings, onTaskClick, (callback, delay) => {
			const doc = rootEl.ownerDocument;
			const win = doc.defaultView;
			if (!win || doc.hidden) return () => {};
			const timer = win.setTimeout(callback, delay);
			return () => win.clearTimeout(timer);
		}, clock);
	}

	initialize(): void {
		this.rootEl.empty();
		this.rootEl.addClass('operon-upcoming-status-bar');
		const wrapper = this.rootEl.createDiv('operon-tracker-status-bar-wrap');
		this.openEl = wrapper.createDiv('operon-upcoming-status-open');
		this.openEl.tabIndex = 0;
		this.openEl.setAttribute('role', 'button');
		this.openEl.addEventListener('click', asyncHandler('upcoming status open failed', () => this.model.openSelected()));
		this.openEl.addEventListener('keydown', asyncHandler('upcoming status open failed', async event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			await this.model.openSelected();
		}));
		setIcon(this.openEl.createSpan('operon-tracker-status-bar-icon'), 'calendar-clock');
		this.timeEl = this.openEl.createSpan('operon-tracker-status-bar-time');
		this.openEl.createSpan({ cls: 'operon-tracker-status-bar-sep', text: '\u00b7' });
		this.nameEl = this.openEl.createSpan('operon-tracker-status-bar-task');
		this.listeners.push(this.model.subscribe(() => this.renderSnapshot()));
		const doc = this.rootEl.ownerDocument;
		const refresh = () => this.render();
		doc.addEventListener('visibilitychange', refresh);
		this.listeners.push(() => doc.removeEventListener('visibilitychange', refresh));
		const win = doc.defaultView;
		if (win) for (const event of ['focus', 'pageshow']) {
			win.addEventListener(event, refresh);
			this.listeners.push(() => win.removeEventListener(event, refresh));
		}
		this.render();
	}

	render(): void { this.model.refresh(); }

	private renderSnapshot(): void {
		const settings = this.getSettings();
		const { task, countdown: label, due } = this.model.getSnapshot();
		this.rootEl.dataset.countdownDisplay = settings.upcomingCountdownDisplay;
		this.rootEl.toggleClass('is-hidden', !task);
		if (!task) { closeBoundOperonHoverTooltip(this.openEl); return; }
		if (this.timeEl.textContent !== (label ?? '')) this.timeEl.textContent = label ?? '';
		this.timeEl.toggleClass('is-hidden', label === null);
		this.timeEl.toggleClass('is-due', due);
		const description = task.description || t('pinnedTasks', 'untitledTask');
		if (this.description !== description || this.language !== settings.language) {
			this.description = description;
			this.language = settings.language;
			this.nameEl.empty();
			renderCompactTaskMarkdown(this.nameEl, { value: description, mode: 'visual-only' });
		}
		const actionLabel = settings.upcomingStatusBarClickAction === 'start-timer' ? t('tooltips', 'startTimer')
			: settings.upcomingStatusBarClickAction === 'open-task' ? t('reminders', 'openTask') : t('tooltips', 'openTaskEditor');
		setAccessibleLabelWithoutTooltip(this.openEl, `${actionLabel}: ${description}${label === null ? '' : `, ${label}`}`);
		const tooltipKey = JSON.stringify([actionLabel, description]);
		if (tooltipKey !== this.tooltipKey) {
			this.tooltipKey = tooltipKey;
			bindOperonHoverTooltip(this.openEl, { title: actionLabel, content: description, taskColor: null });
		}
	}

	destroy(): void {
		this.model.destroy();
		for (const dispose of this.listeners.splice(0)) dispose();
		cleanupOperonHoverTooltips(this.rootEl);
		this.rootEl.empty();
	}
}
