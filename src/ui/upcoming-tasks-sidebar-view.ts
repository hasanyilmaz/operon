import { getTaskIconActionLabel } from '../core/task-icon-action';
import { bindTaskContextualHoverMenu, cleanupTaskContextualHoverMenus } from './contextual-hover-menu';
import { ItemView, WorkspaceLeaf, setIcon, type Workspace } from 'obsidian';
import { getUpcomingTasksForDisplay, type UpcomingTaskEntry } from '../core/upcoming-task-query';
import { findNextUpcomingEntry, formatUpcomingCountdown, getUpcomingWakeDelay, upcomingEntryKey } from '../core/upcoming-task-countdown';
import { asyncHandler } from '../core/async-action';
import { t } from '../core/i18n';
import { toLocalDate } from '../core/local-time';
import { resolveTaskColorSourceForTask, resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import type { OperonIndexer } from '../indexer/indexer';
import type { TimeTracker } from '../systems/time-tracker';
import { type OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { isTaskSourceOpenModifierClick } from './task-source-open-modifier';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { formatTrackerDayHeader } from './tracker-time-labels';
import type { PinnedTasksSidebarCallbacks } from './pinned-tasks-sidebar-view';

export const UPCOMING_TASKS_SIDEBAR_VIEW_TYPE = 'operon-upcoming-tasks-sidebar';
type UpcomingCallbacks = Pick<PinnedTasksSidebarCallbacks, 'openTaskEditor' | 'openTaskSource' | 'cycleStatus' | 'toggleTimer' | 'onContextualAction' | 'hasSubtasks'> & { isPinned?: (taskId: string) => boolean };
interface UpcomingRow {
	entry: UpcomingTaskEntry;
	row: HTMLElement;
	countdown: HTMLElement;
	timer: HTMLButtonElement;
	status: HTMLButtonElement;
}

export async function openUpcomingTasksSidebar(workspace: Workspace, side: OperonSettings['upcomingSidebarSide']): Promise<void> {
	const existing = workspace.getLeavesOfType(UPCOMING_TASKS_SIDEBAR_VIEW_TYPE)[0];
	const leaf = existing ?? (side === 'right' ? workspace.getRightLeaf(false) : workspace.getLeftLeaf(false));
	if (!leaf) return;
	await leaf.setViewState({ type: UPCOMING_TASKS_SIDEBAR_VIEW_TYPE, active: true });
	if (leaf.view instanceof UpcomingTasksSidebarView) leaf.view.render();
	await workspace.revealLeaf(leaf);
}

let upcomingMenuSequence = 0;

export class UpcomingTasksSidebarView extends ItemView {
	private readonly menuIdentity = `upcoming-${++upcomingMenuSequence}`;
	private signature: string | null = null;
	private rows: UpcomingRow[] = [];
	private pending = new Set<string>();
	private wakeTimer: number | null = null;
	private timerWindow: Window | null = null;
	private closed = true;
	private listeners: Array<() => void> = [];

	constructor(leaf: WorkspaceLeaf, private indexer: OperonIndexer, private settings: OperonSettings,
		private tracker: TimeTracker, private callbacks: UpcomingCallbacks, private clock: () => Date = () => new Date()) {
		super(leaf);
		this.register(() => this.stopListening());
	}
	getViewType(): string { return UPCOMING_TASKS_SIDEBAR_VIEW_TYPE; }
	getDisplayText(): string { return t('settings', 'tabUpcoming'); }
	getIcon(): string { return 'calendar-clock'; }

	async onOpen(): Promise<void> {
		this.stopListening();
		this.closed = false;
		const doc = this.contentEl.ownerDocument;
		const win = doc.defaultView;
		const refresh = (): void => this.render();
		doc.addEventListener('visibilitychange', refresh);
		this.listeners.push(() => doc.removeEventListener('visibilitychange', refresh));
		if (win) {
			for (const event of ['focus', 'pageshow']) {
				win.addEventListener(event, refresh);
				this.listeners.push(() => win.removeEventListener(event, refresh));
			}
		}
		const layout = this.app.workspace.on('layout-change', refresh);
		const active = this.app.workspace.on('active-leaf-change', refresh);
		this.listeners.push(() => this.app.workspace.offref(layout), () => this.app.workspace.offref(active));
		this.render();
	}
	async onClose(): Promise<void> {
		this.closed = true;
		this.stopListening();
		this.rows = [];
		this.signature = null;
	}
	markDirty(): void { this.signature = null; }

	render(): void {
		if (this.closed) return;
		const now = this.clock();
		const signature = JSON.stringify([
			this.indexer.getGeneration(), toLocalDate(now), this.settings.upcomingDays,
			this.settings.upcomingShowAllDayTasks, this.settings.upcomingDailyGroupOrder, this.settings.upcomingCountdownDisplay,
			this.settings.upcomingTaskColorSource, this.settings.priorities, this.settings.pipelines,
			this.settings.fallbackTaskIconSource, this.settings.taskStatusIconColorSource, this.settings.taskIconClickAction,
			this.settings.fallbackStateIcons, this.settings.language, this.settings.dateDisplayFormat, this.settings.timeFormat,
		]);
		if (signature !== this.signature) {
			this.rebuild(now);
			this.signature = signature;
		}
		this.updateCountdowns(now.getTime());
	}

	private rebuild(now: Date): void {
		const container = this.contentEl;
		const listBefore = container.querySelector<HTMLElement>('.operon-upcoming-list');
		const scrollTop = listBefore?.scrollTop ?? 0;
		const focused = container.ownerDocument.activeElement;
		const focusRow = this.rows.find(item => focused !== null && item.row.contains(focused));
		const focusAction = focusRow ? (focused === focusRow.timer ? 'timer' : focused === focusRow.status ? 'status' : 'description') : null;
		const focusKey = focusRow ? upcomingEntryKey(focusRow.entry) : null;
		const days = getUpcomingTasksForDisplay(this.indexer, this.settings, now);
		cleanupTaskContextualHoverMenus(container);
		container.empty();
		container.addClass('operon-pinned-sidebar-view');
		container.addClass('operon-upcoming-sidebar-view');
		this.rows = [];
		if (days.length === 0) {
			container.createDiv({ cls: 'operon-pinned-sidebar-empty', text: t('settings', 'upcomingEmpty') });
			return;
		}
		const list = container.createDiv('operon-pinned-sidebar-list operon-upcoming-list');
		for (const day of days) {
			const section = list.createDiv('operon-upcoming-day');
			const header = section.createDiv('operon-time-session-history-day-header');
			header.createSpan({ text: formatTrackerDayHeader(this.app, day.date) });
			for (const group of day.groups) {
				const groupEl = section.createDiv('operon-upcoming-group');
				groupEl.createDiv({ cls: 'operon-upcoming-group-label', text: t('settings', group.kind === 'timed' ? 'upcomingTimedGroup' : 'upcomingAllDayGroup') });
				for (const entry of group.entries) this.renderRow(groupEl, entry);
			}
		}
		list.scrollTop = scrollTop;
		if (focusKey && focusAction) {
			const target = this.rows.find(item => upcomingEntryKey(item.entry) === focusKey);
			const el = focusAction === 'description' ? target?.row.querySelector<HTMLElement>('.operon-pinned-sidebar-desc') : target?.[focusAction];
			el?.focus({ preventScroll: true });
		}
	}

	private renderRow(container: HTMLElement, entry: UpcomingTaskEntry): void {
		const task = entry.task;
		const row = container.createDiv('operon-pinned-sidebar-row operon-upcoming-row');
		row.toggleClass('is-all-day', entry.allDay);
		row.addEventListener('click', asyncHandler('upcoming task open failed', async event => {
			if (isTaskSourceOpenModifierClick(event) && this.callbacks.openTaskSource) {
				event.preventDefault();
				await this.callbacks.openTaskSource(task.operonId);
			} else this.callbacks.openTaskEditor(task.operonId);
		}));
		const color = resolveTaskColorSourceForTask(task, this.settings.upcomingTaskColorSource, this.settings);
		if (this.settings.upcomingTaskColorSource === 'noColor') row.setCssProps({ '--operon-card-color': 'var(--background-modifier-border)' });
		else if (color) row.setCssProps({ '--operon-card-color': color, '--operon-pinned-sidebar-row-bg': `color-mix(in srgb, ${color} 5%, transparent)`, '--operon-pinned-sidebar-row-hover-border': color });
		const status = row.createEl('button', { cls: `operon-pinned-status operon-pinned-sidebar-status operon-checkbox-${task.checkbox}`, attr: { type: 'button' } });
		const iconColor = resolveTaskStatusIconColorForTask(task, this.settings);
		if (iconColor) status.style.color = iconColor;
		setIcon(status, resolveTaskDisplayIcon(this.settings, task.fieldValues, task.checkbox));
		setAccessibleLabelWithoutTooltip(status, getTaskIconActionLabel(this.settings, task.checkbox));
		status.addEventListener('click', asyncHandler('upcoming status cycle failed', async event => {
			event.stopPropagation();
			await this.runTaskAction(task.operonId, () => this.callbacks.cycleStatus(task.operonId));
		}));
		if (this.callbacks.onContextualAction) bindTaskContextualHoverMenu(status, {
			surface: 'upcomingTask', menuKey: `${this.menuIdentity}:${upcomingEntryKey(entry)}`, taskId: task.operonId, getTask: () => task, getSettings: () => this.settings,
			onAction: this.callbacks.onContextualAction, isPinned: () => this.callbacks.isPinned?.(task.operonId) === true,
			hasSubtasks: () => this.callbacks.hasSubtasks?.(task.operonId) === true,
		});
		const description = row.createSpan('operon-pinned-sidebar-desc');
		renderCompactTaskMarkdown(description, { value: task.description || t('pinnedTasks', 'untitledTask'), mode: 'visual-only' });
		description.setAttribute('role', 'button');
		description.tabIndex = 0;
		setAccessibleLabelWithoutTooltip(description, t('tooltips', 'openTaskEditor'));
		description.addEventListener('keydown', event => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.openTaskEditor(task.operonId);
		});

		const actions = row.createDiv('operon-upcoming-actions');
		const timer = actions.createEl('button', { cls: 'operon-pinned-sidebar-action operon-pinned-sidebar-timer operon-upcoming-timer', attr: { type: 'button' } });
		timer.addEventListener('click', asyncHandler('upcoming tracking toggle failed', async event => {
			event.stopPropagation();
			await this.runTaskAction(task.operonId, () => this.callbacks.toggleTimer(task.operonId));
		}));
		const countdown = actions.createSpan('operon-upcoming-countdown');
		this.rows.push({ entry, row, countdown, timer, status });
	}

	private async runTaskAction(taskId: string, action: () => unknown): Promise<void> {
		if (this.pending.has(taskId)) return;
		this.pending.add(taskId);
		this.updateCountdowns(this.clock().getTime());
		try { await action(); }
		finally {
			this.pending.delete(taskId);
			this.render();
		}
	}

	private updateCountdowns(now: number): void {
		if (this.closed) return;
		this.contentEl.dataset.countdownDisplay = this.settings.upcomingCountdownDisplay;
		const seconds = this.settings.upcomingCountdownDisplay === 'seconds';
		const entries = this.rows.map(item => item.entry);
		const next = findNextUpcomingEntry(entries, now);
		for (const item of this.rows) {
			const label = formatUpcomingCountdown(item.entry.timestamp, now, seconds);
			if (item.countdown.textContent !== (label ?? '')) item.countdown.textContent = label ?? '';
			item.countdown.toggleClass('is-unavailable', label === null);
			item.countdown.toggleClass('is-next', item.entry === next);
			item.countdown.toggleClass('is-due', label === '00:00' || label === '00:00:00');
			item.row.toggleClass('has-fixed-countdown', label !== null && (item.entry === next || label === '00:00' || label === '00:00:00'));
			const active = this.tracker.isTimerRunning(item.entry.operonId);
			if (item.timer.dataset.tracking !== String(active)) {
				item.timer.dataset.tracking = String(active);
				setIcon(item.timer, active ? 'square' : 'play');
				setAccessibleLabelWithoutTooltip(item.timer, t('tooltips', active ? 'stopTimer' : 'startTimer'));
			}
			item.timer.toggleClass('is-active', active);
			item.row.toggleClass('operon-pinned-sidebar-row--tracking', active);
			item.timer.disabled = this.pending.has(item.entry.operonId);
			item.status.disabled = item.timer.disabled;
		}
		this.clearWakeTimer();
		const doc = this.contentEl.ownerDocument;
		if (doc.hidden) return;
		this.timerWindow = doc.defaultView;
		this.wakeTimer = this.timerWindow?.setTimeout(() => {
			this.wakeTimer = null;
			const current = this.clock();
			if (toLocalDate(current) !== toLocalDate(new Date(now))) this.render();
			else this.updateCountdowns(current.getTime());
		}, getUpcomingWakeDelay(entries, now, seconds)) ?? null;
	}

	private stopListening(): void {
		this.closed = true;
		cleanupTaskContextualHoverMenus(this.contentEl);
		this.clearWakeTimer();
		for (const dispose of this.listeners.splice(0)) dispose();
	}

	private clearWakeTimer(): void {
		if (this.wakeTimer !== null) this.timerWindow?.clearTimeout(this.wakeTimer);
		this.wakeTimer = null;
		this.timerWindow = null;
	}
}
