import { getTaskIconActionLabel } from '../core/task-icon-action';
import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { OperonIndexer } from '../indexer/indexer';
import { TimeTracker } from '../systems/time-tracker';
import { FlowTimeBreakController, canSelectFlowTimeTask, type FlowTimeBreakState } from '../systems/flow-time-break';
import {
	FlowTimePendingDraft,
	FlowTimeRenderedState,
	buildFlowTimeRenderSignature,
	resolveFlowTimeRenderedState,
} from '../systems/flow-time-optimistic';
import {
	OptimisticTaskPatchInput,
	buildOptimisticStatusPatch,
	isOptimisticTaskPatchPersisted,
	normalizeOptimisticFieldValues,
} from '../systems/optimistic-status-patch';
import { IndexedTask } from '../types/fields';
import { OperonSettings, FlowTimeMode, resolveTaskDisplayIcon } from '../types/settings';
import { Pipeline } from '../types/pipeline';
import { resolveTaskStatusIconColorForTask } from '../core/task-color-source';
import { ActiveTrackerState, TrackerSource, TrackerStopReason } from '../types/tracker';
import { promptTaskFinderSelection, TASK_FINDER_SCOPE_TIME_TRACKER } from './task-finder-integrations';
import { renderQuickInlineTaskCreatorInput } from './task-creator-integrations';
import { bindTaskContextualHoverMenu, cleanupTaskContextualHoverMenus, hideTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionHandler } from '../core/contextual-menu-engine';
import type { QuickInlineTaskCreationResult } from './task-creator-integrations';
import type { TaskCreatorDraft } from './task-creator-modal';
import { WindowIntervalHandle, clearWindowInterval, setWindowInterval } from '../core/dom-compat';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import { enginePerfLog, enginePerfNow } from '../core/engine-perf';
import { localNow } from '../core/local-time';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { renderCompactTaskMarkdown } from './compact-task-markdown-renderer';
import { getFlowTimeTargetSeconds, resolveFlowTimeDialState } from '../systems/flow-time-dial-state';
import type { FlowTimeControls } from '../systems/flow-time-controls';
import { createFlowTimeDial, resolveFlowTimeDialAccent } from './flow-time-dial';

export const FLOW_TIME_VIEW_TYPE = 'operon-flow-time';

interface FlowTimeViewCallbacks {
	cycleStatus: (operonId: string) => Promise<void>;
	openTaskEditor: (operonId: string) => void;
	getPipelines: () => Pipeline[];
	getSettings: () => OperonSettings;
	saveSettings: () => Promise<void>;
	createTaskForTracker: (canUse: () => boolean) => Promise<string | null>;
	createInlineTaskFromQuickInput: (draft: TaskCreatorDraft) => Promise<QuickInlineTaskCreationResult | null>;
	shouldPromptForInlineTaskTarget: () => boolean;
	startTimerForTask: (operonId: string, source: TrackerSource, startOverride?: string | null) => Promise<boolean>;
	startUnassignedTimer: (source: TrackerSource) => Promise<boolean>;
	stopActiveTimer: (reason: TrackerStopReason) => Promise<boolean>;
	onContextualAction?: ContextualMenuActionHandler;
	isTaskPinned?: (taskId: string) => boolean;
	hasSubtasks?: (taskId: string) => boolean;
}

interface FlowTimeOptimisticTaskPatch extends OptimisticTaskPatchInput {
	expiresAt: number;
}

export class FlowTimeView extends ItemView {
	private readonly indexer: OperonIndexer;
	private readonly timeTracker: TimeTracker;
	private readonly callbacks: FlowTimeViewCallbacks;
	private unsubscribe: (() => void) | null = null;
	private unsubscribeBreak: (() => void) | null = null;
	private lastRenderSignature: string | null = null;
	private pendingTaskId: string | null = null;
	private notifiedTargetKey: string | null = null;
	private lastTargetReachedState: { activeStart: string; overtime: boolean } | null = null;
	private dial: ReturnType<typeof createFlowTimeDial> | null = null;
	private unsubscribeControls: (() => void) | null = null;
	private get breakState(): FlowTimeBreakState | null {
		return this.breakController.getSnapshot().breakState;
	}
	private pendingDraft: FlowTimePendingDraft | null = null;
	private pendingDraftTickerInterval: WindowIntervalHandle | null = null;
	private readonly optimisticTaskPatches = new Map<string, FlowTimeOptimisticTaskPatch>();
	private optimisticPatchCleanupTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		indexer: OperonIndexer,
		timeTracker: TimeTracker,
		callbacks: FlowTimeViewCallbacks,
		private readonly breakController: FlowTimeBreakController,
		private readonly timerControls: FlowTimeControls,
	) {
		super(leaf);
		this.indexer = indexer;
		this.timeTracker = timeTracker;
		this.callbacks = callbacks;
	}

	getViewType(): string {
		return FLOW_TIME_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('taskEditor', 'flowTime');
	}

	getIcon(): string {
		return 'hourglass';
	}

	async onOpen(): Promise<void> {
		this.unsubscribeControls = this.timerControls.subscribe(event => {
			if (event === 'mode') this.render();
			else {
				if (event === 'committed') this.syncTargetReachedStateAfterDurationChange(this.callbacks.getSettings());
				this.updateLiveElements();
			}
		});
		this.unsubscribeBreak = this.breakController.subscribe(event => {
			if (event === 'tick') this.updateLiveElements();
			else this.render();
		});
		this.unsubscribe = this.timeTracker.subscribe((event) => {
			if (event === 'tick') {
				this.updateLiveElements();
				return;
			}
			this.render();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		cleanupOperonHoverTooltips(this.contentEl);
		this.unsubscribeControls?.();
		this.unsubscribeControls = null;
		this.dial?.cancelDrag();
		this.dial = null;
		this.lastRenderSignature = null;
		this.unsubscribeBreak?.();
		this.unsubscribeBreak = null;
		this.stopPendingDraftTicker();
		this.clearOptimisticTaskPatches();
		hideTaskContextualHoverMenu(true);
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	render(): void {
		this.timerControls.syncContext();
		const container = this.contentEl;
		const settings = this.callbacks.getSettings();
		const mode = this.timerControls.mode;
		const renderedState = this.getRenderedState();
		const { active, task } = renderedState;
		const activeKey = active ? `${active.operonId ?? 'unassigned'}:${active.start}` : 'none';
		const breakKey = this.breakState ? `${this.breakState.taskId}:${this.breakState.startMs}:${this.breakState.targetSeconds}` : 'none';
		const pendingDraftKey = renderedState.pendingDraft
			? `${renderedState.pendingDraft.description}:${renderedState.pendingDraft.startedAtMs}`
			: 'none';
		const taskKey = task ? `${task.operonId}:${task.description}:${task.fieldValues['status'] ?? ''}:${task.fieldValues['priority'] ?? ''}:${task.fieldValues['taskIcon'] ?? ''}:${task.fieldValues['taskColor'] ?? ''}:${task.checkbox}` : 'none';
		const signature = buildFlowTimeRenderSignature({
			indexGeneration: this.indexer.getGeneration(),
			settingsValues: [
				String(this.breakController.getSnapshot().actionPending),
				mode,
				String(settings.flowTimePauseMinutes),
				String(settings.flowTimeUseLastSelectedDuration),
				String(settings.flowTimeDefaultSessionMinutes),
				String(settings.flowTimeShowNumericTimer),
				String(settings.flowTimeNotifyOnTargetReached),
				String(settings.flowTimePlayReminderSoundOnTargetReached),
				settings.fallbackTaskIconSource,
				settings.taskStatusIconColorSource, settings.taskIconClickAction,
				`${settings.fallbackStateIcons.open}:${settings.fallbackStateIcons.done}:${settings.fallbackStateIcons.cancelled}`,
				settings.pipelines.map(pipeline =>
					`${pipeline.name}:${pipeline.statuses.map(status => `${status.label}:${status.color}:${status.pipelineStatusIcon ?? ''}`).join(',')}`
				).join('|'),
				settings.priorities.map(priority => `${priority.label}:${priority.color}:${priority.priorityIcon ?? ''}`).join(','),
			],
			activeKey,
			breakKey,
			pendingDraftKey,
			taskKey,
			hasRenderedTask: !!task,
		});

		if (signature === this.lastRenderSignature) {
			this.updateLiveElements();
			return;
		}
		this.lastRenderSignature = signature;

		cleanupOperonHoverTooltips(container);
		cleanupTaskContextualHoverMenus(container);
		const dialWrap = this.dial ? container.querySelector<HTMLElement>('[data-role="dial-wrap"]') : null;
		for (const child of Array.from(container.children)) {
			if (child !== dialWrap) child.remove();
		}
		container.addClass('operon-flow-time-view');
		container.classList.toggle('is-flowtime', mode === 'flowtime');
		container.classList.toggle('is-tracktime', mode === 'tracktime');
		container.classList.toggle('is-break', !!this.breakState);
		container.classList.toggle('is-optimistic', renderedState.isOptimistic);
		this.applyAccentColor(container, task);

		const modeBar = this.renderModeBar(container, mode, active);
		const wrap = dialWrap ?? container.createDiv('operon-flow-time-dial-wrap');
		container.insertBefore(modeBar, wrap);
		if (!dialWrap) {
			this.dial?.cancelDrag();
			wrap.dataset.role = 'dial-wrap';
			this.dial = createFlowTimeDial(wrap, this.timerControls);
		}
		if (settings.flowTimeShowNumericTimer) {
			this.renderTimeControls(container, settings);
		}
		this.renderTaskBox(container, task, active, renderedState);
		this.updateLiveElements();
	}

	private renderModeBar(container: HTMLElement, mode: FlowTimeMode, active: ReturnType<TimeTracker['getActiveState']>): HTMLElement {
		const row = container.createDiv('operon-flow-time-mode-row');
		this.createModeButton(row, 'tracktime', mode === 'tracktime');
		this.renderBreakButton(row, active);
		this.createModeButton(row, 'flowtime', mode === 'flowtime');
		return row;
	}

	private createModeButton(container: HTMLElement, mode: FlowTimeMode, active: boolean): void {
		const label = mode === 'tracktime'
			? t('taskEditor', 'flowTimeModeTrackTime')
			: t('taskEditor', 'flowTimeModeFlowTime');
		const button = container.createEl('button', {
			cls: `operon-flow-time-mode-button${active ? ' is-active' : ''}`,
			text: label,
			attr: {
				type: 'button',
				'aria-pressed': String(active),
			},
		});
		button.addEventListener('click', asyncHandler('flow time mode save failed', () => this.timerControls.setMode(mode)));
	}

	private renderBreakButton(container: HTMLElement, active: ReturnType<TimeTracker['getActiveState']>): void {
		const slot = container.createDiv('operon-flow-time-break-slot');

		const isBreakActive = !!this.breakState;
		const state = this.breakController.getSnapshot();
		const choosing = canSelectFlowTimeTask(active, state);
		const primaryFinder = choosing && !isBreakActive;
		slot.classList.toggle('is-break-selection', isBreakActive);
		const disabled = state.actionPending || (!choosing && !isBreakActive && !active?.operonId);
		const label = primaryFinder ? t('commands', 'openTaskFinder') : isBreakActive ? t('taskEditor', 'flowTimeEndBreak') : t('taskEditor', 'flowTimeStartBreak');
		const button = slot.createEl('button', {
			cls: [
				'operon-flow-time-break-button',
				isBreakActive ? 'is-active' : '',
			].filter(Boolean).join(' '),
			attr: {
				type: 'button',
			},
		});
		button.disabled = disabled;
		setIcon(button, primaryFinder ? 'scan-search' : 'coffee');
		setAccessibleLabelWithoutTooltip(button, label);
		if (primaryFinder) bindOperonHoverTooltip(button, { title: label, content: t('commands', 'trackDifferentTask'), taskColor: null });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (disabled) return;
			runAsyncAction('flow time break action failed', async () => {
				if (primaryFinder) await this.selectWaitingTask();
				else await this.breakController.toggleBreak();
			});
		});
		if (choosing) {
			const divider = slot.createSpan('operon-flow-time-selection-divider'); divider.setAttribute('aria-hidden', 'true');
			if (isBreakActive) {
				const finder = slot.createEl('button', { cls: 'operon-flow-time-break-button', attr: { type: 'button' } });
				finder.disabled = state.actionPending; setIcon(finder, 'scan-search');
				setAccessibleLabelWithoutTooltip(finder, t('commands', 'openTaskFinder'));
				bindOperonHoverTooltip(finder, { title: t('commands', 'openTaskFinder'), content: t('commands', 'trackDifferentTask'), taskColor: null });
				finder.addEventListener('click', event => {
					event.preventDefault(); event.stopPropagation(); if (finder.disabled) return;
					runAsyncAction('flow time task selection failed', () => this.selectWaitingTask());
				});
			}
			const create = slot.createEl('button', { cls: 'operon-flow-time-break-button', attr: { type: 'button' } });
			create.disabled = state.actionPending; setIcon(create, 'list-plus');
			setAccessibleLabelWithoutTooltip(create, t('commands', 'openTaskCreator'));
			bindOperonHoverTooltip(create, { title: t('commands', 'openTaskCreator'), taskColor: null });
			create.addEventListener('click', event => {
				event.preventDefault(); event.stopPropagation(); if (create.disabled) return;
				runAsyncAction('flow time task creation failed', () => this.selectWaitingTask(true));
			});
		}

	}

	private renderTimeControls(container: HTMLElement, _settings: OperonSettings): void {
		const row = container.createDiv('operon-flow-time-time-row');
		const timeWrap = row.createDiv('operon-flow-time-time-wrap');
		const timeText = timeWrap.createDiv('operon-flow-time-time-text');
		timeText.dataset.role = 'time-text';
		const overtime = timeWrap.createDiv('operon-flow-time-overtime');
		overtime.dataset.role = 'overtime-label';

	}

	private renderTaskBox(
		container: HTMLElement,
		task: IndexedTask | null,
		active: ActiveTrackerState | null,
		renderedState: FlowTimeRenderedState,
	): void {
		const box = container.createDiv([
			'operon-flow-time-task-box',
			task || renderedState.pendingDraft ? 'has-task' : '',
			renderedState.isOptimistic ? 'is-optimistic' : '',
			renderedState.pendingDraft ? 'is-pending-draft' : '',
		].filter(Boolean).join(' '));

		if (!task && renderedState.pendingDraft) {
			const pendingIcon = box.createSpan('operon-flow-time-task-empty-icon');
			setIcon(pendingIcon, 'loader-circle');
			box.createSpan({
				cls: 'operon-flow-time-task-name',
				text: renderedState.pendingDraft.description,
			});
			this.renderTaskActionButton(box, active, { disabled: true });
			return;
		}

		if (!task) {
			const finderButton = box.createEl('button', {
				cls: 'operon-flow-time-task-finder-button operon-flow-time-task-empty-icon',
				attr: {
					type: 'button',
				},
			});
			setIcon(finderButton, 'scan-search');
			setAccessibleLabelWithoutTooltip(finderButton, t('commands', 'openTaskFinder'));
			bindOperonHoverTooltip(finderButton, { title: t('commands', 'openTaskFinder'), content: t('commands', 'trackDifferentTask'), taskColor: null });
			finderButton.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				runAsyncAction('flow time task selection failed', () => this.selectTask());
			});
			renderQuickInlineTaskCreatorInput(box, {
				placeholder: active?.isUnassigned ? t('taskEditor', 'flowTimeSelectTask') : t('taskEditor', 'flowTimeNoTask'),
				ariaLabel: t('taskEditor', 'flowTimeSelectTask'),
				className: 'operon-flow-time-quick-task-input',
				submitErrorContext: 'flow time quick task creation failed',
				submitInBackground: !this.callbacks.shouldPromptForInlineTaskTarget(),
				onSubmit: (draft) => this.createQuickInlineTask(draft),
			});
			this.renderTaskActionButton(box, active);
			return;
		}

		box.addEventListener('click', () => {
			if (task && (active || this.breakState)) {
				this.callbacks.openTaskEditor(task.operonId);
				return;
			}
			runAsyncAction('flow time task selection failed', () => this.selectTask());
		});

		const iconBtn = box.createEl('button', {
			cls: 'operon-flow-time-task-icon',
			attr: { type: 'button' },
		});
		this.renderTaskIcon(iconBtn, task);
		setAccessibleLabelWithoutTooltip(iconBtn, getTaskIconActionLabel(this.callbacks.getSettings(), task?.checkbox ?? 'open'));
		iconBtn.addEventListener('click', asyncHandler('flow time status cycle failed', async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.invokeFlowTimeStatusCycle(task);
		}));
		this.bindTaskContextMenu(iconBtn, task);

		const taskName = box.createSpan('operon-flow-time-task-name');
		renderCompactTaskMarkdown(taskName, {
			value: task.description || task.operonId,
			mode: 'visual-only',
		});

		this.renderTaskActionButton(box, active);
	}

	private renderTaskActionButton(
		container: HTMLElement,
		active: ActiveTrackerState | null,
		options: { disabled?: boolean } = {},
	): void {
		const isRunning = !!active;
		const action = container.createEl('button', {
			cls: `operon-flow-time-action${isRunning ? ' is-stop' : ' is-start'}`,
			attr: {
				type: 'button',
			},
		});
		action.disabled = options.disabled === true || this.breakController.getSnapshot().actionPending;
		setIcon(action, isRunning ? 'square' : 'play');
		setAccessibleLabelWithoutTooltip(
			action,
			isRunning ? t('taskEditor', 'stopTracker') : t('taskEditor', 'startTracker'),
		);
		action.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (action.disabled) return;
			runAsyncAction('flow time timer action failed', () => this.toggleTimerFromAction());
		});
	}

	private async invokeFlowTimeStatusCycle(task: IndexedTask): Promise<void> {
		const startedAt = enginePerfNow();
		const optimistic = buildOptimisticStatusPatch(task, this.callbacks.getSettings());
		let fallbackReason = 'none';
		let applied = false;
		if (optimistic) {
			applied = this.applyOptimisticTaskPatch(task.operonId, optimistic.patch);
			if (!applied) fallbackReason = 'patch-empty';
		} else {
			fallbackReason = 'next-status-unavailable';
		}
		enginePerfLog(
			'flowtime.optimisticStatus',
			`taskId=${task.operonId}`,
			`applied=${String(applied)}`,
			`nextStatus=${optimistic?.nextStatus ?? 'none'}`,
			`nextCheckbox=${optimistic?.nextCheckbox ?? 'none'}`,
			`renderMs=${Math.round(enginePerfNow() - startedAt)}`,
			`fallbackReason=${fallbackReason}`,
		);
		try {
			await this.callbacks.cycleStatus(task.operonId);
		} catch (error) {
			this.optimisticTaskPatches.delete(task.operonId);
			this.lastRenderSignature = null;
			this.render();
			throw error;
		}
		this.lastRenderSignature = null;
		this.render();
	}

	private applyOptimisticTaskPatch(taskId: string, patchInput: OptimisticTaskPatchInput): boolean {
		const task = this.indexer.getTask(taskId);
		if (!task) return false;
		const normalized = normalizeOptimisticFieldValues(patchInput.fieldValues);
		if (Object.keys(normalized).length === 0 && !patchInput.checkbox) return false;
		this.optimisticTaskPatches.set(taskId, {
			fieldValues: normalized,
			checkbox: patchInput.checkbox,
			expiresAt: Date.now() + 10000,
		});
		this.scheduleOptimisticTaskPatchCleanup();
		this.lastRenderSignature = null;
		this.render();
		return true;
	}

	private pruneOptimisticTaskPatches(now = Date.now()): void {
		let changed = false;
		for (const [taskId, patch] of this.optimisticTaskPatches.entries()) {
			const task = this.indexer.getTask(taskId);
			const isExpired = now >= patch.expiresAt;
			const isPersisted = !!task && isOptimisticTaskPatchPersisted(task, patch);
			if (!task || isExpired || isPersisted) {
				this.optimisticTaskPatches.delete(taskId);
				changed = true;
			}
		}
		if (changed) {
			this.scheduleOptimisticTaskPatchCleanup();
		}
	}

	private scheduleOptimisticTaskPatchCleanup(): void {
		if (this.optimisticPatchCleanupTimer !== null) {
			window.clearTimeout(this.optimisticPatchCleanupTimer);
			this.optimisticPatchCleanupTimer = null;
		}
		if (this.optimisticTaskPatches.size === 0) return;
		const nextExpiry = Math.min(...Array.from(this.optimisticTaskPatches.values()).map(patch => patch.expiresAt));
		this.optimisticPatchCleanupTimer = window.setTimeout(() => {
			this.optimisticPatchCleanupTimer = null;
			this.pruneOptimisticTaskPatches();
			this.lastRenderSignature = null;
			this.render();
		}, Math.max(0, nextExpiry - Date.now()));
	}

	private clearOptimisticTaskPatches(): void {
		this.optimisticTaskPatches.clear();
		if (this.optimisticPatchCleanupTimer !== null) {
			window.clearTimeout(this.optimisticPatchCleanupTimer);
			this.optimisticPatchCleanupTimer = null;
		}
	}

	private updateLiveElements(): void {
		const container = this.contentEl;
		const settings = this.callbacks.getSettings();
		const renderedState = this.getRenderedState();
		const active = renderedState.active;
		const task = renderedState.task;
		const breakState = this.breakState;
		const state = resolveFlowTimeDialState(
			this.timerControls.mode,
			breakState ? this.breakController.getElapsedSeconds() : active?.elapsedSeconds ?? 0,
			breakState?.targetSeconds ?? getFlowTimeTargetSeconds(this.timerControls.minutes),
		);
		container.classList.toggle('is-optimistic', renderedState.isOptimistic);
		const taskBox = container.querySelector<HTMLElement>('.operon-flow-time-task-box');
		taskBox?.classList.toggle('is-optimistic', renderedState.isOptimistic);
		taskBox?.classList.toggle('is-pending-draft', !!renderedState.pendingDraft);
		this.applyAccentColor(container, task);
		this.dial?.update(state, this.resolveAccentColor(task));

		const timeText = container.querySelector<HTMLElement>('[data-role="time-text"]');
		const overtimeLabel = container.querySelector<HTMLElement>('[data-role="overtime-label"]');
		if (timeText) {
			timeText.setText(`${state.overtime ? '+' : ''}${this.formatClock(state.displaySeconds)}`);
		}
		if (overtimeLabel) {
			overtimeLabel.setText(state.overtime ? t('taskEditor', 'flowTimeOvertime') : '');
		}
		this.notifyIfTargetReached(settings, active);
	}

	private applyAccentColor(container: HTMLElement, task: IndexedTask | null): void {
		const accentColor = this.resolveAccentColor(task);
		if (accentColor) {
			container.style.setProperty('--operon-flow-time-accent', accentColor);
		} else {
			container.style.removeProperty('--operon-flow-time-accent');
		}
	}

	private async toggleTimerFromAction(): Promise<void> {
		if (this.breakController.getSnapshot().actionPending) return;
		const active = this.timeTracker.getActiveState();
		if (active) {
			const stopped = await this.callbacks.stopActiveTimer('manual');
			if (stopped) {
				this.pendingTaskId = null;
				this.notifiedTargetKey = null;
				this.lastTargetReachedState = null;
				this.lastRenderSignature = null;
				this.render();
			}
			return;
		}
		if (this.breakController.getSnapshot().pendingTaskId) {
			await this.breakController.resumePending('flowtime');
			return;
		}
		const pendingTask = this.pendingTaskId ? this.indexer.getTask(this.pendingTaskId) : null;
		const started = await (pendingTask
			? this.callbacks.startTimerForTask(pendingTask.operonId, 'flowtime')
			: this.callbacks.startUnassignedTimer('flowtime'));
		if (started) this.pendingTaskId = null;
	}

	private async selectWaitingTask(create = false): Promise<void> {
		const session = this.unsubscribeBreak;
		const canUse = () => !!session && this.unsubscribeBreak === session && this.contentEl.isConnected;
		let created: string | null = null;
		const started = await this.breakController.selectPendingTask(async () => {
			if (create) { created = await this.callbacks.createTaskForTracker(canUse); return created; }
			return (await promptTaskFinderSelection(this.app, this.indexer, this.callbacks.getSettings, TASK_FINDER_SCOPE_TIME_TRACKER))?.operonId ?? null;
		}, 'flowtime', canUse);
		if (created && !started && canUse()) new Notice(t('notifications', 'creatorPostCreateFinalizeFailed'));
		if (started && canUse()) {
			this.pendingTaskId = null; this.pendingDraft = null; this.stopPendingDraftTicker();
			this.lastRenderSignature = null; this.render();
		}
	}

	private async selectTask(): Promise<void> {
		if (this.breakController.getSnapshot().actionPending) return;
		if (canSelectFlowTimeTask(this.timeTracker.getActiveState(), this.breakController.getSnapshot())) {
			await this.selectWaitingTask(); return;
		}
		const task = await promptTaskFinderSelection(
			this.app,
			this.indexer,
			this.callbacks.getSettings,
			TASK_FINDER_SCOPE_TIME_TRACKER,
		);
		if (!task) return;

		const active = this.timeTracker.getActiveState();
		const previousPendingTaskId = this.pendingTaskId;
		this.pendingTaskId = task.operonId;
		this.pendingDraft = null;
		const wasBreak = !!this.breakState;
		this.lastRenderSignature = null;
		this.render();
		if (wasBreak && this.applyDefaultFlowTimeDuration()) {
			await this.callbacks.saveSettings();
		}
		let started = false;
		try {
			started = await this.callbacks.startTimerForTask(task.operonId, 'flowtime');
		} catch (error) {
			this.pendingTaskId = previousPendingTaskId;
			this.lastRenderSignature = null;
			this.render();
			throw error;
		}
		if (started || active) {
			this.pendingTaskId = null;
		} else {
			this.pendingTaskId = previousPendingTaskId;
		}
		this.lastRenderSignature = null;
		this.render();
	}

	private async createQuickInlineTask(draft: TaskCreatorDraft): Promise<QuickInlineTaskCreationResult | null> {
		const promptForInlineTarget = this.callbacks.shouldPromptForInlineTaskTarget();
		if (!promptForInlineTarget) {
			this.pendingTaskId = null;
			this.pendingDraft = {
				description: draft.description,
				start: localNow(),
				startedAtMs: Date.now(),
			};
			this.startPendingDraftTicker();
			this.lastRenderSignature = null;
			this.render();
		}

		let result: QuickInlineTaskCreationResult | null = null;
		try {
			result = await this.callbacks.createInlineTaskFromQuickInput(draft);
		} catch (error) {
			if (!promptForInlineTarget) {
				this.pendingDraft = null;
				this.stopPendingDraftTicker();
				this.lastRenderSignature = null;
				this.render();
			}
			throw error;
		}
		if (!result) {
			if (!promptForInlineTarget) {
				this.pendingDraft = null;
				this.stopPendingDraftTicker();
				this.lastRenderSignature = null;
				this.render();
			}
			return null;
		}
		if (promptForInlineTarget) {
			this.pendingTaskId = null;
			this.pendingDraft = {
				description: draft.description,
				start: localNow(),
				startedAtMs: Date.now(),
			};
			this.startPendingDraftTicker();
			this.lastRenderSignature = null;
			this.render();
		}

		const wasBreak = !!this.breakState;
		if (wasBreak && this.applyDefaultFlowTimeDuration()) {
			await this.callbacks.saveSettings();
		}

		this.pendingTaskId = result.operonId;
		this.lastRenderSignature = null;
		this.render();
		let started = false;
		try {
			started = await this.callbacks.startTimerForTask(result.operonId, 'flowtime', this.pendingDraft?.start ?? null);
		} catch (error) {
			this.pendingTaskId = null;
			this.pendingDraft = null;
			this.stopPendingDraftTicker();
			this.lastRenderSignature = null;
			this.render();
			throw error;
		}
		if (started) {
			this.pendingTaskId = null;
			this.pendingDraft = null;
			this.stopPendingDraftTicker();
			this.notifiedTargetKey = null;
			this.lastTargetReachedState = null;
			this.lastRenderSignature = null;
			this.render();
		} else {
			this.pendingTaskId = null;
			this.pendingDraft = null;
			this.stopPendingDraftTicker();
			this.lastRenderSignature = null;
			this.render();
		}
		return result;
	}

	private startPendingDraftTicker(): void {
		if (this.pendingDraftTickerInterval) return;
		this.pendingDraftTickerInterval = setWindowInterval(() => {
			if (!this.pendingDraft) {
				this.stopPendingDraftTicker();
				return;
			}
			this.updateLiveElements();
		}, 1000);
	}

	private stopPendingDraftTicker(): void {
		if (!this.pendingDraftTickerInterval) return;
		clearWindowInterval(this.pendingDraftTickerInterval);
		this.pendingDraftTickerInterval = null;
	}

	private applyDefaultFlowTimeDuration(): boolean {
		const settings = this.callbacks.getSettings();
		if (!this.breakController.applyDefaultSessionDuration()) return false;
		this.syncTargetReachedStateAfterDurationChange(settings);
		this.lastRenderSignature = null;
		return true;
	}

	private notifyIfTargetReached(settings: OperonSettings, active: ActiveTrackerState | null): void {
		if (!active || settings.flowTimeMode !== 'flowtime') {
			this.notifiedTargetKey = null;
			this.lastTargetReachedState = null;
			return;
		}
		const targetSeconds = getFlowTimeTargetSeconds(settings.flowTimeSessionMinutes);
		const elapsed = active.elapsedSeconds;
		const isOvertime = elapsed >= targetSeconds;
		const previous = this.lastTargetReachedState;
		const activeStart = active.start;

		if (!previous || previous.activeStart !== activeStart) {
			this.lastTargetReachedState = { activeStart, overtime: isOvertime };
			this.notifiedTargetKey = isOvertime ? activeStart : null;
			return;
		}

		if (!previous.overtime && isOvertime) {
			const key = `${activeStart}:${targetSeconds}`;
			if (settings.flowTimeNotifyOnTargetReached && this.notifiedTargetKey !== key) {
				new Notice(t('taskEditor', 'flowTimeTargetReached'));
			}
			this.notifiedTargetKey = key;
		}

		this.lastTargetReachedState = { activeStart, overtime: isOvertime };
	}

	private syncTargetReachedStateAfterDurationChange(settings: OperonSettings): void {
		const active = this.timeTracker.getActiveState();
		if (!active || settings.flowTimeMode !== 'flowtime') {
			return;
		}
		const targetSeconds = getFlowTimeTargetSeconds(settings.flowTimeSessionMinutes);
		const elapsed = this.timeTracker.getActiveSessionSeconds(active.operonId ?? undefined);
		const isOvertime = elapsed >= targetSeconds;
		this.lastTargetReachedState = {
			activeStart: active.start,
			overtime: isOvertime,
		};
		if (isOvertime) {
			this.notifiedTargetKey = active.start;
		}
	}

	private getRenderedState(): FlowTimeRenderedState {
		this.pruneOptimisticTaskPatches();
		const active = this.timeTracker.getActiveState();
		const transition = this.timeTracker.getTransitionState();
		const pendingTask = this.resolvePendingTask();
		const taskId = transition?.taskId ?? active?.operonId ?? pendingTask?.operonId ?? null;
		const optimisticPatch = taskId ? this.optimisticTaskPatches.get(taskId) ?? null : null;
		return resolveFlowTimeRenderedState({
			active,
			transition,
			pendingTask,
			pendingDraft: this.breakController.getSnapshot().pendingTaskId ? null : this.pendingDraft,
			optimisticPatch,
			getTask: taskId => this.indexer.getTask(taskId),
		});
	}

	private resolvePendingTask(): IndexedTask | null {
		const taskId = this.breakController.getSnapshot().pendingTaskId ?? this.pendingTaskId;
		if (!taskId) return null;
		const task = this.indexer.getTask(taskId);
		if (!task) {
			this.pendingTaskId = null;
			return null;
		}
		return task;
	}

	private renderTaskIcon(container: HTMLElement, task: IndexedTask): void {
		container.empty();
		container.style.removeProperty('color');
		const statusColor = this.resolveStatusColor(task);
		if (statusColor) {
			container.style.color = statusColor;
			container.style.setProperty('--operon-flow-time-task-status-color', statusColor);
		} else {
			container.style.removeProperty('--operon-flow-time-task-status-color');
		}

		setIcon(container, resolveTaskDisplayIcon(this.callbacks.getSettings(), task.fieldValues, task.checkbox));
	}

	private bindTaskContextMenu(anchor: HTMLElement, task: IndexedTask): void {
		if (!this.callbacks.onContextualAction) return;
		bindTaskContextualHoverMenu(anchor, {
			surface: 'flowTimeTask',
			taskId: task.operonId,
			getTask: () => task,
			getSettings: this.callbacks.getSettings,
			onAction: this.callbacks.onContextualAction,
			isPinned: this.callbacks.isTaskPinned ? () => this.callbacks.isTaskPinned?.(task.operonId) === true : undefined,
			isTracking: () => this.timeTracker.isTimerRunning(task.operonId),
			hasSubtasks: this.callbacks.hasSubtasks ? () => this.callbacks.hasSubtasks?.(task.operonId) === true : undefined,
		});
	}

	private resolveAccentColor(task: IndexedTask | null): string | null {
		return resolveFlowTimeDialAccent(task?.fieldValues['taskColor']);
	}

	private resolveStatusColor(task: IndexedTask): string | null {
		return resolveTaskStatusIconColorForTask(task, this.callbacks.getSettings());
	}

	private formatClock(seconds: number): string {
		const total = Math.max(0, Math.floor(seconds));
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const secs = total % 60;
		if (hours > 0) {
			return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
		}
		return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	}
}
