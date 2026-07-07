import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { getPinnedTasksForDisplay } from '../core/pinned-task-query';
import { asyncHandler } from '../core/async-action';
import { t } from '../core/i18n';
import { resolveTaskColorSourceForTask, resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import { OperonIndexer } from '../indexer/indexer';
import { TimeTracker } from '../systems/time-tracker';
import { PinnedCache } from '../storage/pinned-cache';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import { IndexedTask } from '../types/fields';
import { OperonSettings, resolveTaskDisplayIcon } from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindTaskContextualHoverMenu } from './contextual-hover-menu';
import { isTaskSourceOpenModifierClick } from './task-source-open-modifier';

export const PINNED_TASKS_SIDEBAR_VIEW_TYPE = 'operon-pinned-tasks-sidebar';

export interface PinnedTasksSidebarCallbacks {
	openTaskEditor: (operonId: string) => void;
	openTaskSource?: (operonId: string) => void | Promise<void>;
	cycleStatus: (operonId: string) => void | Promise<void>;
	onContextualAction?: ContextualMenuActionHandler;
	hasSubtasks?: (taskId: string) => boolean;
	toggleTimer: (taskId: string) => Promise<boolean>;
}

export class PinnedTasksSidebarView extends ItemView {
	private lastRenderSignature: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private indexer: OperonIndexer,
		private settings: OperonSettings,
		private timeTracker: TimeTracker,
		private callbacks: PinnedTasksSidebarCallbacks,
		private pinnedCache: PinnedCache,
	) {
		super(leaf);
	}

	getViewType(): string {
		return PINNED_TASKS_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('pinnedTasks', 'title');
	}

	getIcon(): string {
		return 'pin';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	markDirty(): void {
		this.lastRenderSignature = null;
	}

	render(): void {
		const container = this.contentEl;
		const pinnedTasks = getPinnedTasksForDisplay(this.indexer, this.pinnedCache, this.settings.priorities);
		const activeTrackerId = this.timeTracker.getActiveOperonId();
		const colorSettingsSignature = [
			this.settings.pinnedDockColorSource,
			this.settings.priorities.map(priority => `${priority.label}:${priority.color}:${priority.priorityIcon ?? ''}`).join(','),
			this.settings.pipelines.map(pipeline =>
				`${pipeline.name}:${pipeline.statuses.map(status => `${status.label}:${status.color}:${status.pipelineStatusIcon ?? ''}`).join(',')}`
			).join('|'),
		].join('~');
		const signature = [
			String(this.indexer.getGeneration()),
			String(this.pinnedCache.getGeneration()),
			colorSettingsSignature,
			this.settings.fallbackTaskIconSource,
			this.settings.taskStatusIconColorSource,
			`${this.settings.fallbackStateIcons.open}:${this.settings.fallbackStateIcons.done}:${this.settings.fallbackStateIcons.cancelled}`,
			activeTrackerId ?? '',
			pinnedTasks.map(task =>
				`${task.operonId}:${task.description}:${task.fieldValues['taskIcon'] ?? ''}:${task.fieldValues['taskColor'] ?? ''}:${task.fieldValues['status'] ?? ''}:${task.fieldValues['priority'] ?? ''}:${task.checkbox}`
			).join('|'),
		].join('§');

		if (signature === this.lastRenderSignature) return;
		this.lastRenderSignature = signature;

		container.empty();
		container.addClass('operon-pinned-sidebar-view');

		if (pinnedTasks.length === 0) {
			container.createDiv({
				cls: 'operon-pinned-sidebar-empty',
				text: t('pinnedTasks', 'empty'),
			});
			return;
		}

		const list = container.createDiv('operon-pinned-sidebar-list');
		for (const task of pinnedTasks) {
			this.renderTaskRow(list, task);
		}
	}

	private renderTaskRow(container: HTMLElement, task: IndexedTask): void {
		const row = container.createDiv('operon-pinned-sidebar-row');
		row.addEventListener('click', (event) => {
			if (isTaskSourceOpenModifierClick(event) && this.callbacks.openTaskSource) {
				event.preventDefault();
				event.stopPropagation();
				void Promise.resolve(this.callbacks.openTaskSource(task.operonId)).catch(error => {
					console.error('Operon: failed to open pinned sidebar task source', error);
				});
				return;
			}
			this.callbacks.openTaskEditor(task.operonId);
		});

		this.applyTaskColor(row, task);

		const statusBtn = row.createEl('button', {
			cls: `operon-pinned-status operon-pinned-sidebar-status operon-checkbox-${task.checkbox}`,
			attr: { type: 'button' },
		});
		const iconColor = resolveTaskStatusIconColorForTask(task, this.settings);
		if (iconColor) statusBtn.style.color = iconColor;
		else statusBtn.style.removeProperty('color');
		setIcon(statusBtn, resolveTaskDisplayIcon(this.settings, task.fieldValues, task.checkbox));
		setAccessibleLabelWithoutTooltip(statusBtn, t('tooltips', 'cycleTaskStatus'));
		statusBtn.addEventListener('click', asyncHandler('pinned sidebar status cycle failed', async (event) => {
			event.stopPropagation();
			await this.callbacks.cycleStatus(task.operonId);
		}));
		if (this.callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(statusBtn, {
				surface: 'pinnedTask',
				taskId: task.operonId,
				getTask: () => task,
				getSettings: () => this.settings,
				onAction: this.callbacks.onContextualAction,
				isPinned: () => this.pinnedCache.isPinned(task.operonId),
				hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(task.operonId) === true : undefined,
			});
		}

		const description = row.createSpan({
			cls: 'operon-pinned-sidebar-desc',
			text: task.description || t('pinnedTasks', 'untitledTask'),
		});
		description.setAttribute('role', 'button');
		description.setAttribute('tabindex', '0');
		setAccessibleLabelWithoutTooltip(description, t('tooltips', 'openTaskEditor'));
		description.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			this.callbacks.openTaskEditor(task.operonId);
		});

		const actions = row.createDiv('operon-pinned-sidebar-actions');
		const unpinBtn = actions.createEl('button', {
			cls: 'operon-pinned-sidebar-action operon-pinned-sidebar-unpin',
			attr: { type: 'button' },
		});
		setIcon(unpinBtn, 'pin-off');
		setAccessibleLabelWithoutTooltip(unpinBtn, t('contextMenu', 'unpinTask'));
		unpinBtn.addEventListener('click', asyncHandler('pinned sidebar unpin failed', async (event) => {
			event.stopPropagation();
			await this.pinnedCache.unpin(task.operonId);
		}));

		const isTracking = this.timeTracker.isTimerRunning(task.operonId);
		row.toggleClass('operon-pinned-sidebar-row--tracking', isTracking);
		const timerBtn = actions.createEl('button', {
			cls: `operon-pinned-sidebar-action operon-pinned-sidebar-timer${isTracking ? ' is-active' : ''}`,
			attr: { type: 'button' },
		});
		setIcon(timerBtn, isTracking ? 'square' : 'play');
		setAccessibleLabelWithoutTooltip(timerBtn, t('tooltips', isTracking ? 'stopTimer' : 'startTimer'));
		timerBtn.addEventListener('click', asyncHandler('pinned sidebar timer toggle failed', async (event) => {
			event.stopPropagation();
			await this.callbacks.toggleTimer(task.operonId);
		}));
	}

	private applyTaskColor(row: HTMLElement, task: IndexedTask): void {
		const color = resolveTaskColorSourceForTask(task, this.settings.pinnedDockColorSource, this.settings);
		if (this.settings.pinnedDockColorSource === 'noColor') {
			row.setCssProps({ '--operon-card-color': 'var(--background-modifier-border)' });
		} else if (color) {
			row.setCssProps({ '--operon-card-color': color });
			row.setCssProps({
				'--operon-pinned-sidebar-row-bg': `color-mix(in srgb, ${color} 5%, transparent)`,
				'--operon-pinned-sidebar-row-hover-border': color,
			});
		}
	}

}
