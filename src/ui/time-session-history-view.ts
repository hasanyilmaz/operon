import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { TimeTracker } from '../systems/time-tracker';
import { TrackerHistoryDayGroup, TrackerSession, TrackerSource } from '../types/tracker';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { formatDurationHuman, parseTrackerList } from '../systems/tracker-utils';
import { resolveWorkflowStatus } from '../types/pipeline';
import { resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import { buildTrackerSessionEditContext, TrackerSessionEditModal } from './tracker-session-edit-modal';
import { t } from '../core/i18n';
import { formatTaskNotice } from '../core/task-notice';
import { formatTrackerDayHeader, formatTrackerSessionRange } from './tracker-time-labels';
import { bindTaskContextualHoverMenu, hideTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { asyncHandler } from '../core/async-action';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export const TIME_SESSION_HISTORY_VIEW_TYPE = 'operon-time-session-history';

interface TimeSessionHistoryViewCallbacks {
	cycleStatus: (operonId: string) => Promise<void>;
	navigateToTask: (task: import('../types/fields').IndexedTask) => void;
	navigateToDailyNote: (dateKey: string) => void;
	openTaskEditor: (operonId: string) => void;
	getPipelines: () => import('../types/pipeline').Pipeline[];
	getSettings: () => OperonSettings;
	startTimerForTask: (operonId: string, source: TrackerSource) => Promise<boolean>;
	onContextualAction?: ContextualMenuActionHandler;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
}

export type TimeSessionHistoryTaskDescriptionClickAction = OperonSettings['trackerTaskDescriptionClickAction'];

export function formatTimeSessionHistoryTaskDescription(task: Pick<import('../types/fields').IndexedTask, 'description'>): string {
	return task.description || t('taskEditor', 'untitledTask');
}

export function getTimeSessionHistorySecondaryTaskActionAriaLabel(
	clickAction: TimeSessionHistoryTaskDescriptionClickAction,
): string {
	return clickAction === 'openTaskEditor'
		? t('settings', 'trackerClickJumpToSource')
		: t('settings', 'trackerClickOpenTaskEditor');
}

export class TimeSessionHistoryView extends ItemView {
	private readonly indexer: OperonIndexer;
	private readonly timeTracker: TimeTracker;
	private readonly callbacks: TimeSessionHistoryViewCallbacks;
	private unsubscribe: (() => void) | null = null;
	private lastRenderSignature: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		indexer: OperonIndexer,
		timeTracker: TimeTracker,
		callbacks: TimeSessionHistoryViewCallbacks,
	) {
		super(leaf);
		this.indexer = indexer;
		this.timeTracker = timeTracker;
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return TIME_SESSION_HISTORY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('taskEditor', 'timeSessionHistory');
	}

	getIcon(): string {
		return 'file-clock';
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.timeTracker.subscribe((event) => {
			if (event === 'tick') return;
			this.render();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		hideTaskContextualHoverMenu(true);
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	markDirty(): void {
		this.lastRenderSignature = null;
	}

	render(): void {
		const container = this.contentEl;

		// Build render signature to skip redundant full rebuilds
		const settings = this.callbacks.getSettings();
		const groups = this.timeTracker.getHistory(settings.trackerHistoryDays);
		const historyKey = groups
			.flatMap(g => g.sessions)
			.map(s => `${s.operonId}:${s.start}:${s.end}`)
			.join('|');
		const settingsKey = [
			String(settings.trackerHistoryDays),
			settings.trackerTaskDescriptionClickAction,
			settings.timeFormat,
			settings.fallbackTaskIconSource,
			settings.taskStatusIconColorSource,
			`${settings.fallbackStateIcons.open}:${settings.fallbackStateIcons.done}:${settings.fallbackStateIcons.cancelled}`,
			settings.pipelines.map(pipeline =>
				`${pipeline.name}:${pipeline.statuses.map(status => `${status.label}:${status.color}:${status.pipelineStatusIcon ?? ''}`).join(',')}`
			).join('|'),
			settings.priorities.map(priority => `${priority.label}:${priority.color}:${priority.priorityIcon ?? ''}`).join(','),
		].join(':');
		const signature = [String(this.indexer.getGeneration()), historyKey, settingsKey].join('§');

		if (signature === this.lastRenderSignature) {
			return;
		}
		this.lastRenderSignature = signature;

		hideTaskContextualHoverMenu(true);
		container.empty();
		container.addClass('operon-time-session-history-view');

		const historyWrap = container.createDiv('operon-time-session-history-history');
		if (groups.length === 0) {
			historyWrap.createDiv({ cls: 'operon-time-session-history-empty', text: t('taskEditor', 'trackerNoRecentSessions') });
			return;
		}

		for (const group of groups) {
			this.renderHistoryGroup(historyWrap, group);
		}
	}

	private renderHistoryGroup(container: HTMLElement, group: TrackerHistoryDayGroup): void {
		const section = container.createDiv('operon-time-session-history-day-group');
		const header = section.createDiv('operon-time-session-history-day-header');
		const dayLabel = header.createSpan({ cls: 'operon-time-session-history-day-label', text: formatTrackerDayHeader(this.app, group.date) });
		dayLabel.addEventListener('click', () => {
			this.callbacks.navigateToDailyNote(group.date);
		});
		header.createSpan({ cls: 'operon-time-session-history-day-total', text: formatDurationHuman(group.totalSeconds) });

		for (const session of group.sessions) {
			this.renderSessionCard(section, session);
		}
	}

	private renderSessionCard(container: HTMLElement, session: TrackerSession): void {
		const card = container.createDiv('operon-time-session-history-session-card');
		const isTerminalTask = this.isTerminalTask(session.task);
		if (isTerminalTask) {
			card.addClass('is-terminal-task');
		}
		this.applyTaskColorBorder(card, session.task);
		this.renderTaskIdentity(card, session.task);

		const body = card.createDiv('operon-time-session-history-session-body');
		const sessionMeta = formatTrackerSessionRange(
			this.app,
			this.callbacks.getSettings(),
			session.start,
			session.end,
		);
		body.createSpan({
			cls: 'operon-time-session-history-session-count',
			text: this.formatSessionCount(session),
		});
		const intervalButton = body.createEl('button', {
			cls: 'operon-time-session-history-session-interval-button',
			attr: {
				type: 'button',
			},
		});
		intervalButton.createSpan({
			cls: 'operon-time-session-history-session-interval-primary',
			text: formatDurationHuman(session.durationSeconds),
		});
		const intervalDetail = intervalButton.createSpan('operon-time-session-history-session-interval-detail');
		if (sessionMeta.icon) {
			const icon = intervalDetail.createSpan('operon-time-session-history-session-interval-icon');
			setIcon(icon, sessionMeta.icon);
		}
		intervalDetail.createSpan({
			cls: 'operon-time-session-history-session-interval-text',
			text: sessionMeta.fullText,
		});
		setAccessibleLabelWithoutTooltip(
			intervalButton,
			t('taskEditor', 'editTrackerSession', { range: sessionMeta.fullText }),
		);
		intervalButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			new TrackerSessionEditModal(this.app, {
				title: t('taskEditor', 'editSession'),
				...buildTrackerSessionEditContext({
					taskLabel: formatTimeSessionHistoryTaskDescription(session.task),
					start: session.start,
					end: session.end,
				}),
				initialStart: session.start,
				initialEnd: session.end,
				onSave: async (start, end) => {
					const updated = await this.timeTracker.updateSessionByRange(
						session.operonId,
						session.start,
						session.end,
						start,
						end,
						session.sessionIndex,
					);
					if (!updated) {
						new Notice(t('notifications', 'taskSaveFailed'));
					}
					if (updated !== false) {
						this.render();
						new Notice(formatTaskNotice('time-session-edited', {
							description: session.task.description,
							operonId: session.operonId,
						}));
					}
					return updated;
				},
				onDelete: async () => {
					const deleted = await this.timeTracker.deleteSessionByRange(
						session.operonId,
						session.start,
						session.end,
						session.sessionIndex,
					);
					if (!deleted) {
						new Notice(t('notifications', 'taskSaveFailed'));
						return false;
					}
					this.render();
				},
			}).open();
		});

		const actions = body.createDiv('operon-time-session-history-session-actions');
		const play = actions.createEl('button', {
			cls: 'operon-time-session-history-session-play',
			attr: { type: 'button' },
		});
		if (isTerminalTask) {
			play.addClass('is-terminal-task');
		}
		setIcon(play, 'play');
		setAccessibleLabelWithoutTooltip(play, t('taskEditor', 'replayTaskTimer'));
		play.addEventListener('click', asyncHandler('time session history replay failed', async () => {
			const started = await this.callbacks.startTimerForTask(session.operonId, 'history-play');
			if (started) {
				this.render();
			}
		}));
	}

	private formatSessionCount(session: TrackerSession): string {
		const sessionTotal = parseTrackerList(session.task.fieldValues['trackers'] ?? '').length;
		const sessionPosition = session.sessionIndex + 1;
		return `${sessionPosition}/${Math.max(sessionPosition, sessionTotal, 1)}`;
	}

	private isTerminalTask(task: import('../types/fields').IndexedTask): boolean {
		if (task.checkbox === 'done' || task.checkbox === 'cancelled') return true;
		if (task.fieldValues['dateCompleted']?.trim() || task.fieldValues['dateCancelled']?.trim()) return true;
		const workflow = resolveWorkflowStatus(this.callbacks.getPipelines(), task.fieldValues['status']);
		return workflow?.definition.isFinished === true || workflow?.definition.isCancelled === true;
	}

	private renderTaskIdentity(
		container: HTMLElement,
		task: import('../types/fields').IndexedTask,
	): void {
		const row = container.createDiv('operon-time-session-history-task-row');
		const iconBtn = row.createEl('button', {
			cls: 'operon-live-preview-status-icon operon-time-session-history-task-icon',
			attr: { type: 'button' },
		});
		this.renderTaskIcon(iconBtn, task);
		setAccessibleLabelWithoutTooltip(iconBtn, t('tooltips', 'cycleTaskStatus'));
		const statusColor = this.resolveStatusColor(task);
		if (statusColor) {
			iconBtn.style.setProperty('--operon-tracker-icon-hover-border', statusColor);
		}
		iconBtn.addEventListener('click', asyncHandler('time session history status cycle failed', async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.callbacks.cycleStatus(task.operonId);
			this.render();
		}));
		if (this.callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(iconBtn, {
				surface: 'trackerTask',
				taskId: task.operonId,
				getTask: () => task,
				getSettings: this.callbacks.getSettings,
				onAction: this.callbacks.onContextualAction,
				isPinned: this.callbacks.isTaskPinned ? () => this.callbacks.isTaskPinned?.(task.operonId) === true : undefined,
				hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(task.operonId) === true : undefined,
			});
		}

		const desc = row.createDiv('operon-time-session-history-task-desc');
		desc.setText(formatTimeSessionHistoryTaskDescription(task));
		desc.addEventListener('click', () => this.handleTaskDescriptionClick(task));
		desc.addClass('is-history');

		this.renderSecondaryTaskAction(row, task);
	}

	private handleTaskDescriptionClick(task: import('../types/fields').IndexedTask): void {
		const action = this.callbacks.getSettings().trackerTaskDescriptionClickAction;
		if (action === 'openTaskEditor') {
			this.callbacks.openTaskEditor(task.operonId);
			return;
		}
		this.callbacks.navigateToTask(task);
	}

	private renderSecondaryTaskAction(
		container: HTMLElement,
		task: import('../types/fields').IndexedTask,
	): void {
		const clickAction = this.callbacks.getSettings().trackerTaskDescriptionClickAction;
		const button = container.createEl('button', {
			cls: 'operon-time-session-history-session-settings',
			attr: {
				type: 'button',
			},
		});
		setIcon(button, clickAction === 'openTaskEditor' ? 'arrow-up-right' : 'settings-2');
		setAccessibleLabelWithoutTooltip(button, getTimeSessionHistorySecondaryTaskActionAriaLabel(clickAction));
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const currentClickAction = this.callbacks.getSettings().trackerTaskDescriptionClickAction;
			if (currentClickAction === 'openTaskEditor') {
				this.callbacks.navigateToTask(task);
				return;
			}
			this.callbacks.openTaskEditor(task.operonId);
		});
	}

	private renderTaskIcon(container: HTMLElement, task: import('../types/fields').IndexedTask): void {
		container.empty();
		container.style.removeProperty('color');
		const iconColor = this.resolveStatusColor(task);
		if (iconColor) container.style.color = iconColor;

		setIcon(container, resolveTaskDisplayIcon(this.callbacks.getSettings(), task.fieldValues, task.checkbox));
	}

	private applyTaskColorBorder(container: HTMLElement, task: import('../types/fields').IndexedTask): void {
		container.style.removeProperty('--operon-tracker-card-border');
		container.style.removeProperty('--operon-tracker-hover-color');
		const color = this.normalizeTaskColor(task.fieldValues['taskColor']);
		if (color) {
			container.style.setProperty('--operon-tracker-card-border', color);
			container.style.setProperty('--operon-tracker-hover-color', color);
		}
	}

	private resolveStatusColor(task: import('../types/fields').IndexedTask): string | null {
		return resolveTaskStatusIconColorForTask(task, this.callbacks.getSettings());
	}

	private normalizeTaskColor(taskColor: string | undefined): string | null {
		if (!taskColor) return null;
		const trimmed = taskColor.trim();
		if (!trimmed) return null;
		return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
	}
}
