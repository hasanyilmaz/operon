import { bindOperonHoverTooltip, cleanupOperonHoverTooltips, closeBoundOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { setIcon } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import type { OperonSettings } from '../types/settings';
import { UpcomingTaskSelection } from '../core/upcoming-task-selection';
import { formatUpcomingCountdown, getUpcomingWakeDelay } from '../core/upcoming-task-countdown';
import { t } from '../core/i18n';
import { asyncHandler } from '../core/async-action';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

export class UpcomingTasksStatusBar {
	private selection = new UpcomingTaskSelection();
	private timer: number | null = null;
	private disposed = true;
	private listeners: Array<() => void> = [];
	private timeEl!: HTMLElement;
	private nameEl!: HTMLElement;
	private openEl!: HTMLElement;
	private actionPending = false;
	private selectedTaskId: string | null = null;
	private cachedSelectionKey = '';
	private cachedSelection: ReturnType<UpcomingTaskSelection['update']> | null = null;
	private tooltipKey = '';
	private description = '';
	private language = '';

	constructor(private rootEl: HTMLElement, private indexer: Pick<OperonIndexer, 'getAllTasks'> & Partial<Pick<OperonIndexer, 'getGeneration'>>,
		private getSettings: () => OperonSettings, private onTaskClick: (taskId: string, action: OperonSettings['upcomingStatusBarClickAction']) => void | Promise<void>,
		private clock: () => Date = () => new Date()) {}

	initialize(): void {
		this.disposed = false;
		this.rootEl.empty();
		this.rootEl.addClass('operon-upcoming-status-bar');
		const wrapper = this.rootEl.createDiv('operon-tracker-status-bar-wrap');
		this.openEl = wrapper.createDiv('operon-upcoming-status-open');
		this.openEl.tabIndex = 0;
		this.openEl.setAttribute('role', 'button');
		this.openEl.addEventListener('click', asyncHandler('upcoming status open failed', () => this.openSelectedTask()));
		this.openEl.addEventListener('keydown', asyncHandler('upcoming status open failed', async event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			await this.openSelectedTask();
		}));
		setIcon(this.openEl.createSpan('operon-tracker-status-bar-icon'), 'calendar-clock');
		this.timeEl = this.openEl.createSpan('operon-tracker-status-bar-time');
		this.openEl.createSpan({ cls: 'operon-tracker-status-bar-sep', text: '\u00b7' });
		this.nameEl = this.openEl.createSpan('operon-tracker-status-bar-task');
		const doc = this.rootEl.ownerDocument;
		for (const event of ['visibilitychange']) {
			const refresh = (): void => this.render();
			doc.addEventListener(event, refresh);
			this.listeners.push(() => doc.removeEventListener(event, refresh));
		}
		const win = doc.defaultView;
		if (win) for (const event of ['focus', 'pageshow']) {
			const refresh = (): void => this.render();
			win.addEventListener(event, refresh);
			this.listeners.push(() => win.removeEventListener(event, refresh));
		}
		this.render();
	}

	render(): void {
		if (this.disposed) return;
		this.clearTimer();
		const settings = this.getSettings();
		if (!settings.upcomingShowStatusBar) {
			this.rootEl.addClass('is-hidden');
			closeBoundOperonHoverTooltip(this.openEl);
			return;
		}
		this.rootEl.dataset.countdownDisplay = settings.upcomingCountdownDisplay;
		const seconds = settings.upcomingCountdownDisplay === 'seconds';
		const now = this.clock();
		const generation = this.indexer.getGeneration?.();
		const key = JSON.stringify([generation, Math.floor(now.getTime() / 60_000), settings.upcomingStatusBarExpiryAction, settings.upcomingDays, settings.upcomingShowAllDayTasks, settings.upcomingDailyGroupOrder, settings.pipelines, settings.priorities]);
		const expiredWithFutureCandidate = settings.upcomingStatusBarExpiryAction === 'next'
			&& this.cachedSelection?.selected?.timestamp !== null
			&& (this.cachedSelection?.selected?.timestamp ?? Infinity) <= now.getTime()
			&& this.cachedSelection?.next !== null;
		if (generation === undefined || !this.cachedSelection || key !== this.cachedSelectionKey || expiredWithFutureCandidate) {
			this.cachedSelection = this.selection.update(this.indexer.getAllTasks(), settings, now);
			this.cachedSelectionKey = key;
		}
		const { selected, next } = this.cachedSelection;
		this.selectedTaskId = selected?.operonId ?? null;
		this.rootEl.toggleClass('is-hidden', !selected);
		if (!selected) closeBoundOperonHoverTooltip(this.openEl);
		if (selected) {
			const label = formatUpcomingCountdown(selected.timestamp, now.getTime(), seconds);
			if (this.timeEl.textContent !== (label ?? '')) this.timeEl.textContent = label ?? '';
			this.timeEl.toggleClass('is-hidden', label === null);
			this.timeEl.toggleClass('is-due', label === '00:00' || label === '00:00:00');
			const description = selected.task.description || t('pinnedTasks', 'untitledTask');
			if (this.description !== description || this.language !== settings.language) {
				this.description = description;
				this.language = settings.language;
				renderCompactTaskMarkdown(this.nameEl, { value: description, mode: 'visual-only' });
			}
			const actionLabel = settings.upcomingStatusBarClickAction === 'start-timer' ? t('tooltips', 'startTimer') : settings.upcomingStatusBarClickAction === 'open-task' ? t('reminders', 'openTask') : t('tooltips', 'openTaskEditor');
			setAccessibleLabelWithoutTooltip(this.openEl, `${actionLabel}: ${description}${label === null ? '' : `, ${label}`}`);
			const tooltipKey = JSON.stringify([actionLabel, description]);
			if (tooltipKey !== this.tooltipKey) {
				this.tooltipKey = tooltipKey;
				bindOperonHoverTooltip(this.openEl, { title: actionLabel, content: description, taskColor: null });
			}
		}
		const doc = this.rootEl.ownerDocument;
		if (!doc.hidden) this.timer = doc.defaultView?.setTimeout(() => {
			this.timer = null;
			this.render();
		}, getUpcomingWakeDelay([...(selected ? [selected] : []), ...(next ? [next] : [])], now.getTime(), seconds)) ?? null;
	}

	private async openSelectedTask(): Promise<void> {
		if (this.disposed || !this.selectedTaskId || this.actionPending) return;
		this.actionPending = true;
		try { await this.onTaskClick(this.selectedTaskId, this.getSettings().upcomingStatusBarClickAction); }
		finally { this.actionPending = false; }
	}

	private clearTimer(): void {
		if (this.timer !== null) this.rootEl.ownerDocument.defaultView?.clearTimeout(this.timer);
		this.timer = null;
	}

	destroy(): void {
		this.disposed = true;
		this.selectedTaskId = null;
		this.clearTimer();
		for (const dispose of this.listeners.splice(0)) dispose();
		this.selection = new UpcomingTaskSelection();
		this.cachedSelection = null;
		this.cachedSelectionKey = '';
		cleanupOperonHoverTooltips(this.rootEl);
		this.tooltipKey = '';
		this.rootEl.empty();
	}
}
