import { setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { TimeTracker } from '../systems/time-tracker';
import { formatDurationHuman } from '../systems/tracker-utils';
import { OperonSettings } from '../types/settings';
import { asyncHandler } from '../core/async-action';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

export class TimeTrackerStatusBar {
	private readonly rootEl: HTMLElement;
	private readonly timeTracker: TimeTracker;
	private readonly getSettings: () => OperonSettings;
	private readonly openTrackerView: () => Promise<void>;
	private unsubscribe: (() => void) | null = null;

	// Cached DOM nodes for surgical tick updates
	private durationEl: HTMLElement | null = null;
	private taskNameEl: HTMLElement | null = null;

	constructor(
		rootEl: HTMLElement,
		timeTracker: TimeTracker,
		getSettings: () => OperonSettings,
		openTrackerView: () => Promise<void>,
	) {
		this.rootEl = rootEl;
		this.timeTracker = timeTracker;
		this.getSettings = getSettings;
		this.openTrackerView = openTrackerView;
	}

	initialize(): void {
		this.rootEl.empty();
		this.rootEl.addClass('operon-tracker-status-bar');
		this.unsubscribe = this.timeTracker.subscribe((event) => {
			if (event === 'tick') {
				this.updateDuration();
				return;
			}
			this.render();
		});
		this.render();
	}

	render(): void {
		const settings = this.getSettings();
		const active = this.timeTracker.getActiveState();

		this.rootEl.empty();
		this.durationEl = null;
		this.taskNameEl = null;

		if (!settings.trackerShowStatusBarTimer) {
			this.rootEl.addClass('is-hidden');
			return;
		}

		this.rootEl.removeClass('is-hidden');
		const wrapper = this.rootEl.createDiv('operon-tracker-status-bar-wrap');
		wrapper.addEventListener('click', () => {
			void this.openTrackerView();
		});

		if (!active) {
			const label = wrapper.createSpan({
				cls: 'operon-tracker-status-bar-idle',
				text: t('taskEditor', 'trackerIdleLabel'),
			});
			label.setAttribute('aria-hidden', 'true');

			const play = wrapper.createEl('button', {
				cls: 'operon-tracker-status-bar-play',
				attr: { type: 'button' },
			});
			setIcon(play, 'play');
			setAccessibleLabelWithoutTooltip(play, t('taskEditor', 'startTracker'));
			play.addEventListener('click', asyncHandler('status bar tracker start failed', async (e) => {
				e.stopPropagation();
				const started = await this.timeTracker.startUnassigned('status-bar');
				if (!started) return;
				await this.openTrackerView();
			}));
			return;
		}

		// Timer icon
		const icon = wrapper.createSpan('operon-tracker-status-bar-icon');
		setIcon(icon, 'timer');

		// Duration (humanized)
		this.durationEl = wrapper.createSpan({
			cls: 'operon-tracker-status-bar-time',
			text: formatDurationHuman(this.timeTracker.getActiveSessionSeconds(active.operonId ?? undefined)),
		});

		// Dot separator
		wrapper.createSpan({ cls: 'operon-tracker-status-bar-sep', text: '·' });

		// Task name
		const taskName = active.task?.description || t('taskEditor', 'unassignedTracker');
		this.taskNameEl = wrapper.createSpan('operon-tracker-status-bar-task');
		renderCompactTaskMarkdown(this.taskNameEl, {
			value: taskName,
			mode: 'visual-only',
		});

		// Stop button
		const stop = wrapper.createEl('button', {
			cls: 'operon-tracker-status-bar-stop',
			attr: { type: 'button' },
		});
		setIcon(stop, 'square');
		setAccessibleLabelWithoutTooltip(stop, t('taskEditor', 'stopActiveTracker'));
		stop.addEventListener('click', asyncHandler('status bar tracker stop failed', async (e) => {
			e.stopPropagation();
			await this.timeTracker.stop('manual');
			await this.openTrackerView();
		}));
	}

	private updateDuration(): void {
		if (!this.durationEl) return;
		const active = this.timeTracker.getActiveState();
		if (!active) return;
		this.durationEl.setText(
			formatDurationHuman(this.timeTracker.getActiveSessionSeconds(active.operonId ?? undefined)),
		);
	}

	destroy(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.durationEl = null;
		this.taskNameEl = null;
		this.rootEl.empty();
	}
}
