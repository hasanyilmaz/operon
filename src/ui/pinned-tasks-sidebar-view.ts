import { getTaskIconActionLabel } from '../core/task-icon-action';
import { getTaskDisplayTitle } from '../core/task-display-title';
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
import { bindPinnedTaskReorder, type PinnedTaskReorderController } from './pinned-task-reorder-interaction';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';

export const PINNED_TASKS_SIDEBAR_VIEW_TYPE = 'operon-pinned-tasks-sidebar';

export interface PinnedTasksSidebarCallbacks {
	openTaskEditor: (operonId: string) => void;
	openTaskSource?: (operonId: string) => void | Promise<void>;
	cycleStatus: (operonId: string) => void | Promise<void>;
	onContextualAction?: ContextualMenuActionHandler;
	hasSubtasks?: (taskId: string) => boolean;
	toggleTimer: (taskId: string) => Promise<boolean>;
	replaceActiveManualOrder?: (orderedTaskIds: string[]) => Promise<void>;
}

export class PinnedTasksSidebarView extends ItemView {
	private lastRenderSignature: string | null = null;
	private reorderController: PinnedTaskReorderController | null = null;

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

	async onClose(): Promise<void> {
		const reorderController = this.reorderController;
		this.reorderController = null;
		reorderController?.destroy();
	}

	markDirty(): void {
		this.lastRenderSignature = null;
	}

	render(): void {
		const container = this.contentEl;
		if (this.reorderController?.isActive()) return;
		const pinnedTasks = getPinnedTasksForDisplay(
			this.indexer,
			this.pinnedCache,
			this.settings.priorities,
			this.settings.pinnedTaskSortMode,
		);
		const activeTrackerId = this.timeTracker.getActiveOperonId();
		const signature = JSON.stringify([this.settings.language, pinnedTasks.map(task => task.operonId)]);
		if (signature === this.lastRenderSignature) {
			const rows = container.querySelectorAll<HTMLElement>('.operon-pinned-sidebar-row');
			pinnedTasks.forEach((task, index) => this.updateTaskRow(rows[index], task, activeTrackerId));
			return;
		}
		this.lastRenderSignature = signature;

		const previousList = container.querySelector<HTMLElement>(':scope > .operon-pinned-sidebar-list');
		const previousListScrollLeft = previousList?.scrollLeft ?? 0;
		const previousListScrollTop = previousList?.scrollTop ?? 0;
		const previousReorderController = this.reorderController;
		this.reorderController = null;
		previousReorderController?.destroy();
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
			this.renderTaskRow(list, task, activeTrackerId);
		}
		if (previousList) {
			const restoreScroll = (): void => {
				if (!list.isConnected || !container.contains(list)) return;
				list.scrollLeft = previousListScrollLeft;
				list.scrollTop = previousListScrollTop;
			};
			restoreScroll();
			const immediateScrollLeft = list.scrollLeft;
			const immediateScrollTop = list.scrollTop;
			list.ownerDocument.defaultView?.requestAnimationFrame(() => {
				if (!list.isConnected || !container.contains(list)) return;
				if (list.scrollLeft === immediateScrollLeft) list.scrollLeft = previousListScrollLeft;
				if (list.scrollTop === immediateScrollTop) list.scrollTop = previousListScrollTop;
			});
		}
		this.bindTaskReorder(list);
	}

	private renderTaskRow(container: HTMLElement, task: IndexedTask, activeTrackerId: string | null): void {
		const row = container.createDiv('operon-pinned-sidebar-row');
		row.dataset.operonPinnedTaskId = task.operonId;
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

		const statusBtn = row.createEl('button', {
			cls: `operon-pinned-status operon-pinned-sidebar-status operon-checkbox-${task.checkbox}`,
			attr: { type: 'button' },
		});
		statusBtn.addEventListener('click', asyncHandler('pinned sidebar status cycle failed', async (event) => {
			event.stopPropagation();
			await this.callbacks.cycleStatus(task.operonId);
		}));
		if (this.callbacks.onContextualAction) {
			bindTaskContextualHoverMenu(statusBtn, {
				surface: 'pinnedTask',
				taskId: task.operonId,
				getTask: () => this.indexer.getTask(task.operonId) ?? task,
				getSettings: () => this.settings,
				onAction: this.callbacks.onContextualAction,
				isPinned: () => this.pinnedCache.isPinned(task.operonId),
				isTracking: () => this.timeTracker.isTimerRunning(task.operonId),
				hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(task.operonId) === true : undefined,
			});
		}

		const description = row.createSpan('operon-pinned-sidebar-desc');
		description.setAttribute('role', 'button');
		description.setAttribute('tabindex', '0');
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

		const timerBtn = actions.createEl('button', {
			cls: 'operon-pinned-sidebar-action operon-pinned-sidebar-timer',
			attr: { type: 'button' },
		});
		this.updateTaskRow(row, task, activeTrackerId);
		timerBtn.addEventListener('click', asyncHandler('pinned sidebar timer toggle failed', async (event) => {
			event.stopPropagation();
			await this.callbacks.toggleTimer(task.operonId);
		}));
	}

	private updateTaskRow(row: HTMLElement, task: IndexedTask, activeTrackerId: string | null): void {
		row.draggable = this.isManualOrderEnabled();
		const title = getTaskDisplayTitle(task, this.settings.fileTaskDisplayTitleEnabled) || t('pinnedTasks', 'untitledTask');
		if (row.dataset.title !== title) {
			row.dataset.title = title;
			const description = row.querySelector<HTMLElement>('.operon-pinned-sidebar-desc')!;
			description.empty();
			renderCompactTaskMarkdown(description, { value: title, mode: 'visual-only' });
			setAccessibleLabelWithoutTooltip(description, t('tooltips', 'openTaskEditor'));
		}
		const icon = resolveTaskDisplayIcon(this.settings, task.fieldValues, task.checkbox);
		const iconColor = resolveTaskStatusIconColorForTask(task, this.settings) ?? '';
		const label = getTaskIconActionLabel(this.settings, task.checkbox);
		const status = JSON.stringify([task.checkbox, icon, iconColor, label]);
		if (row.dataset.status !== status) {
			row.dataset.status = status;
			const button = row.querySelector<HTMLButtonElement>('.operon-pinned-sidebar-status')!;
			button.className = `operon-pinned-status operon-pinned-sidebar-status operon-checkbox-${task.checkbox}`;
			button.style.color = iconColor;
			button.querySelector('svg')?.remove();
			setIcon(button, icon);
			setAccessibleLabelWithoutTooltip(button, label);
		}
		const color = resolveTaskColorSourceForTask(task, this.settings.pinnedDockColorSource, this.settings);
		const border = this.settings.pinnedDockColorSource === 'noColor' ? 'var(--background-modifier-border)' : color ?? '';
		if (row.dataset.border !== border) {
			row.dataset.border = border;
			row.style.setProperty('--operon-card-color', border);
			row.style.setProperty('--operon-pinned-sidebar-row-bg', color ? `color-mix(in srgb, ${color} 5%, transparent)` : '');
			row.style.setProperty('--operon-pinned-sidebar-row-hover-border', color ?? '');
		}
		const tracking = task.operonId === activeTrackerId;
		if (row.dataset.tracking !== String(tracking)) {
			row.dataset.tracking = String(tracking);
			row.toggleClass('operon-pinned-sidebar-row--tracking', tracking);
			const button = row.querySelector<HTMLButtonElement>('.operon-pinned-sidebar-timer')!;
			button.toggleClass('is-active', tracking);
			button.querySelector('svg')?.remove();
			setIcon(button, tracking ? 'square' : 'play');
			setAccessibleLabelWithoutTooltip(button, t('tooltips', tracking ? 'stopTimer' : 'startTimer'));
		}
	}

	private isManualOrderEnabled(): boolean {
		return this.settings.pinnedTaskSortMode === 'manual'
			&& typeof this.callbacks.replaceActiveManualOrder === 'function';
	}

	private bindTaskReorder(list: HTMLElement): void {
		let controller: PinnedTaskReorderController;
		controller = bindPinnedTaskReorder(list, {
			itemSelector: '.operon-pinned-sidebar-row',
			getAxis: () => 'vertical',
			isEnabled: () => this.isManualOrderEnabled(),
			onCommit: async (orderedTaskIds) => {
				const replaceActiveManualOrder = this.callbacks.replaceActiveManualOrder;
				if (!replaceActiveManualOrder) return;
				await replaceActiveManualOrder(orderedTaskIds);
			},
			onSettled: () => {
				if (this.reorderController !== controller) return;
				this.markDirty();
				this.render();
			},
			enableTouch: true,
		});
		this.reorderController = controller;
	}

}
