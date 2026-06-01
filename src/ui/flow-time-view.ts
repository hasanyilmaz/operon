import { ItemView, Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { OperonIndexer } from '../indexer/indexer';
import { TimeTracker } from '../systems/time-tracker';
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
import { parseStatusValue, Pipeline } from '../types/pipeline';
import { ActiveTrackerState, TrackerSource, TrackerStopReason } from '../types/tracker';
import { promptTaskFinderSelection, TASK_FINDER_SCOPE_TIME_TRACKER } from './task-finder-integrations';
import { renderQuickInlineTaskCreatorInput } from './task-creator-integrations';
import { bindTaskContextualHoverMenu, hideTaskContextualHoverMenu } from './contextual-hover-menu';
import type { ContextualMenuActionId } from '../core/contextual-menu-engine';
import type { QuickInlineTaskCreationResult } from './task-creator-integrations';
import type { TaskCreatorDraft } from './task-creator-modal';
import { WindowIntervalHandle, clearWindowInterval, getOwnerDocument, setWindowInterval } from '../core/dom-compat';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import { enginePerfLog, enginePerfNow } from '../core/engine-perf';
import { localNow } from '../core/local-time';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export const FLOW_TIME_VIEW_TYPE = 'operon-flow-time';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FLOW_TIME_MINUTES_MIN = 1;

interface FlowTimeViewCallbacks {
	cycleStatus: (operonId: string) => Promise<void>;
	openTaskEditor: (operonId: string) => void;
	getPipelines: () => Pipeline[];
	getSettings: () => OperonSettings;
	saveSettings: () => Promise<void>;
	createInlineTaskFromQuickInput: (draft: TaskCreatorDraft) => Promise<QuickInlineTaskCreationResult | null>;
	shouldPromptForInlineTaskTarget: () => boolean;
	startTimerForTask: (operonId: string, source: TrackerSource, startOverride?: string | null) => Promise<boolean>;
	startUnassignedTimer: (source: TrackerSource) => Promise<boolean>;
	stopActiveTimer: (reason: TrackerStopReason) => Promise<boolean>;
	onContextualAction?: (taskId: string, actionId: ContextualMenuActionId) => void | Promise<void>;
	isTaskPinned?: (taskId: string) => boolean;
}

interface DialState {
	mode: FlowTimeMode;
	displaySeconds: number;
	angleDegrees: number;
	fillAngleDegrees: number;
	clockwise: boolean;
	overtime: boolean;
	isRunning: boolean;
	accentColor: string | null;
}

interface FlowTimeBreakState {
	taskId: string;
	startMs: number;
	targetSeconds: number;
}

interface FlowTimeOptimisticTaskPatch extends OptimisticTaskPatchInput {
	expiresAt: number;
}

export class FlowTimeView extends ItemView {
	private readonly indexer: OperonIndexer;
	private readonly timeTracker: TimeTracker;
	private readonly callbacks: FlowTimeViewCallbacks;
	private unsubscribe: (() => void) | null = null;
	private lastRenderSignature: string | null = null;
	private pendingTaskId: string | null = null;
	private notifiedTargetKey: string | null = null;
	private lastTargetReachedState: { activeStart: string; overtime: boolean } | null = null;
	private isDialDragging = false;
	private cleanupDialDrag: (() => void) | null = null;
	private breakState: FlowTimeBreakState | null = null;
	private breakTickerInterval: WindowIntervalHandle | null = null;
	private pendingDraft: FlowTimePendingDraft | null = null;
	private pendingDraftTickerInterval: WindowIntervalHandle | null = null;
	private readonly optimisticTaskPatches = new Map<string, FlowTimeOptimisticTaskPatch>();
	private optimisticPatchCleanupTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		indexer: OperonIndexer,
		timeTracker: TimeTracker,
		callbacks: FlowTimeViewCallbacks,
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
		this.finishDialDrag();
		this.clearBreakState(false);
		this.stopPendingDraftTicker();
		this.clearOptimisticTaskPatches();
		hideTaskContextualHoverMenu(true);
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	render(): void {
		const container = this.contentEl;
		const settings = this.callbacks.getSettings();
		let renderedState = this.getRenderedState();
		if (renderedState.active && this.breakState) {
			this.clearBreakState(false);
			renderedState = this.getRenderedState();
		}
		const { active, task } = renderedState;
		const activeKey = active ? `${active.operonId ?? 'unassigned'}:${active.start}` : 'none';
		const breakKey = this.breakState ? `${this.breakState.taskId}:${this.breakState.startMs}:${this.breakState.targetSeconds}` : 'none';
		const pendingDraftKey = renderedState.pendingDraft
			? `${renderedState.pendingDraft.description}:${renderedState.pendingDraft.startedAtMs}`
			: 'none';
		const taskKey = task ? `${task.operonId}:${task.description}:${task.fieldValues['status'] ?? ''}:${task.fieldValues['taskIcon'] ?? ''}:${task.fieldValues['taskColor'] ?? ''}:${task.checkbox}` : 'none';
		const signature = buildFlowTimeRenderSignature({
			indexGeneration: this.indexer.getGeneration(),
			settingsValues: [
				settings.flowTimeMode,
				String(settings.flowTimeSessionMinutes),
				String(settings.flowTimePauseMinutes),
				String(settings.flowTimeUseLastSelectedDuration),
				String(settings.flowTimeDefaultSessionMinutes),
				String(settings.flowTimeShowNumericTimer),
				String(settings.flowTimeNotifyOnTargetReached),
				settings.fallbackTaskIconSource,
				`${settings.fallbackStateIcons.open}:${settings.fallbackStateIcons.done}:${settings.fallbackStateIcons.cancelled}`,
				settings.pipelines.map(pipeline =>
					`${pipeline.name}:${pipeline.statuses.map(status => `${status.label}:${status.pipelineStatusIcon ?? ''}`).join(',')}`
				).join('|'),
				settings.priorities.map(priority => `${priority.label}:${priority.priorityIcon ?? ''}`).join(','),
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

		hideTaskContextualHoverMenu(true);
		container.empty();
		container.addClass('operon-flow-time-view');
		container.classList.toggle('is-flowtime', settings.flowTimeMode === 'flowtime');
		container.classList.toggle('is-tracktime', settings.flowTimeMode === 'tracktime');
		container.classList.toggle('is-break', !!this.breakState);
		container.classList.toggle('is-optimistic', renderedState.isOptimistic);
		this.applyAccentColor(container, task);

		this.renderModeBar(container, settings, active);
		const dialWrap = container.createDiv('operon-flow-time-dial-wrap');
		dialWrap.dataset.role = 'dial-wrap';
		this.renderDial(dialWrap, this.buildDialState(settings, active, task));
		if (settings.flowTimeShowNumericTimer) {
			this.renderTimeControls(container, settings);
		}
		this.renderTaskBox(container, task, active, renderedState);
		this.updateLiveElements();
	}

	private renderModeBar(container: HTMLElement, settings: OperonSettings, active: ReturnType<TimeTracker['getActiveState']>): void {
		const row = container.createDiv('operon-flow-time-mode-row');
		this.createModeButton(row, 'tracktime', settings.flowTimeMode === 'tracktime');
		this.renderBreakButton(row, active);
		this.createModeButton(row, 'flowtime', settings.flowTimeMode === 'flowtime');
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
		button.addEventListener('click', () => {
			const settings = this.callbacks.getSettings();
			if (settings.flowTimeMode === mode) return;
			settings.flowTimeMode = mode;
			const hasActiveTimer = !!this.timeTracker.getActiveState();
			if (mode === 'flowtime' && !this.breakState && !hasActiveTimer) {
				this.applyDefaultFlowTimeDuration();
			}
			this.lastRenderSignature = null;
			runAsyncAction('flow time mode save failed', () => this.callbacks.saveSettings());
			this.render();
		});
	}

	private renderBreakButton(container: HTMLElement, active: ReturnType<TimeTracker['getActiveState']>): void {
		const slot = container.createDiv('operon-flow-time-break-slot');

		const isBreakActive = !!this.breakState;
		const disabled = !isBreakActive && !active?.operonId;
		const label = isBreakActive ? t('taskEditor', 'flowTimeEndBreak') : t('taskEditor', 'flowTimeStartBreak');
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
		setIcon(button, 'coffee');
		setAccessibleLabelWithoutTooltip(button, label);
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			if (disabled) return;
			if (this.breakState) {
				this.endBreakAndClearTask();
				return;
			}
			runAsyncAction('flow time break start failed', () => this.startBreakFromActiveTask());
		});
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
		setAccessibleLabelWithoutTooltip(iconBtn, t('tooltips', 'cycleTaskStatus'));
		iconBtn.addEventListener('click', asyncHandler('flow time status cycle failed', async (event) => {
			event.preventDefault();
			event.stopPropagation();
			await this.invokeFlowTimeStatusCycle(task);
		}));
		this.bindTaskContextMenu(iconBtn, task);

		box.createSpan({
			cls: 'operon-flow-time-task-name',
			text: task.description || task.operonId,
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
		action.disabled = options.disabled === true;
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

	private updateLiveElements(redrawDial = true): void {
		const container = this.contentEl;
		const settings = this.callbacks.getSettings();
		const renderedState = this.getRenderedState();
		const active = renderedState.active;
		const task = renderedState.task;
		const state = this.buildDialState(settings, active, task);
		container.classList.toggle('is-optimistic', renderedState.isOptimistic);
		const taskBox = container.querySelector<HTMLElement>('.operon-flow-time-task-box');
		taskBox?.classList.toggle('is-optimistic', renderedState.isOptimistic);
		taskBox?.classList.toggle('is-pending-draft', !!renderedState.pendingDraft);
		this.applyAccentColor(container, task);
		const dialWrap = container.querySelector<HTMLElement>('[data-role="dial-wrap"]');
		if (dialWrap) {
			if (redrawDial && !this.isDialDragging) {
				this.renderDial(dialWrap, state);
			} else {
				this.updateDialGeometry(dialWrap, state);
			}
		}

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

	private updateDialGeometry(container: HTMLElement, state: DialState): void {
		container.style.setProperty('--operon-flow-time-accent', state.accentColor ?? 'var(--interactive-accent)');
		const svg = container.querySelector<SVGSVGElement>('.operon-flow-time-dial');
		const wedge = container.querySelector<SVGPathElement>('.operon-flow-time-wedge');
		const hand = container.querySelector<SVGLineElement>('.operon-flow-time-hand');
		if (svg) {
			svg.classList.toggle('is-overtime', state.overtime);
		}
		if (wedge) {
			wedge.setAttribute('d', this.describeWedge(120, 120, 70, 0, state.fillAngleDegrees, state.clockwise));
		}
		if (hand) {
			const handEnd = this.pointOnCircle(120, 120, 96, state.angleDegrees);
			hand.setAttribute('x2', String(handEnd.x));
			hand.setAttribute('y2', String(handEnd.y));
		}
	}

	private applyAccentColor(container: HTMLElement, task: IndexedTask | null): void {
		const accentColor = this.resolveAccentColor(task);
		if (accentColor) {
			container.style.setProperty('--operon-flow-time-accent', accentColor);
		} else {
			container.style.removeProperty('--operon-flow-time-accent');
		}
	}

	private renderDial(container: HTMLElement, state: DialState): void {
		container.empty();
		container.style.setProperty('--operon-flow-time-accent', state.accentColor ?? 'var(--interactive-accent)');
		const ownerDocument = getOwnerDocument(container);
		const svg = ownerDocument.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('class', `operon-flow-time-dial${state.overtime ? ' is-overtime' : ''}`);
		svg.setAttribute('viewBox', '0 0 240 240');
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-hidden', 'true');

		const ticks = ownerDocument.createElementNS(SVG_NS, 'g');
		ticks.setAttribute('class', 'operon-flow-time-ticks');
		for (let i = 0; i < 60; i++) {
			const major = i % 5 === 0;
			const outer = this.pointOnCircle(120, 120, 106, i * 6);
			const inner = this.pointOnCircle(120, 120, major ? 91 : 98, i * 6);
			const line = ownerDocument.createElementNS(SVG_NS, 'line');
			line.setAttribute('class', major ? 'is-major' : 'is-minor');
			line.setAttribute('x1', String(inner.x));
			line.setAttribute('y1', String(inner.y));
			line.setAttribute('x2', String(outer.x));
			line.setAttribute('y2', String(outer.y));
			ticks.appendChild(line);
		}
		svg.appendChild(ticks);

		const face = ownerDocument.createElementNS(SVG_NS, 'circle');
		face.setAttribute('class', 'operon-flow-time-face');
		face.setAttribute('cx', '120');
		face.setAttribute('cy', '120');
		face.setAttribute('r', '70');
		svg.appendChild(face);

		const wedge = ownerDocument.createElementNS(SVG_NS, 'path');
		wedge.setAttribute('class', 'operon-flow-time-wedge');
		wedge.setAttribute('d', this.describeWedge(120, 120, 70, 0, state.fillAngleDegrees, state.clockwise));
		svg.appendChild(wedge);

		const handEnd = this.pointOnCircle(120, 120, 96, state.angleDegrees);
		const hand = ownerDocument.createElementNS(SVG_NS, 'line');
		hand.setAttribute('class', 'operon-flow-time-hand');
		hand.setAttribute('x1', '120');
		hand.setAttribute('y1', '120');
		hand.setAttribute('x2', String(handEnd.x));
		hand.setAttribute('y2', String(handEnd.y));
		svg.appendChild(hand);

		const hubOuter = ownerDocument.createElementNS(SVG_NS, 'circle');
		hubOuter.setAttribute('class', 'operon-flow-time-hub-outer');
		hubOuter.setAttribute('cx', '120');
		hubOuter.setAttribute('cy', '120');
		hubOuter.setAttribute('r', '21');
		svg.appendChild(hubOuter);

		const hub = ownerDocument.createElementNS(SVG_NS, 'circle');
		hub.setAttribute('class', 'operon-flow-time-hub');
		hub.setAttribute('cx', '120');
		hub.setAttribute('cy', '120');
		hub.setAttribute('r', '15');
		svg.appendChild(hub);

		svg.addEventListener('pointerdown', (event) => this.handleDialPointer(event, svg));
		container.appendChild(svg);

	}

	private buildDialState(
		settings: OperonSettings,
		active: ActiveTrackerState | null,
		task: IndexedTask | null,
	): DialState {
		if (this.breakState) {
			const elapsed = this.getBreakElapsedSeconds();
			if (settings.flowTimeMode === 'tracktime') {
				return this.buildForwardDialState(settings.flowTimeMode, elapsed, task, true);
			}
			return this.buildCountdownDialState(
				settings.flowTimeMode,
				elapsed,
				this.breakState.targetSeconds,
				task,
			);
		}
		const elapsed = active ? active.elapsedSeconds : 0;
		const targetSeconds = Math.max(60, settings.flowTimeSessionMinutes * 60);
		if (settings.flowTimeMode === 'flowtime') {
			return this.buildCountdownDialState(settings.flowTimeMode, elapsed, targetSeconds, task, !!active);
		}

		return this.buildForwardDialState(settings.flowTimeMode, elapsed, task, !!active);
	}

	private buildForwardDialState(
		mode: FlowTimeMode,
		elapsed: number,
		task: IndexedTask | null,
		isRunning: boolean,
	): DialState {
		const angle = this.secondsToForwardAngle(elapsed);
		return {
			mode,
			displaySeconds: elapsed,
			angleDegrees: angle,
			fillAngleDegrees: angle,
			clockwise: true,
			overtime: false,
			isRunning,
			accentColor: this.resolveAccentColor(task),
		};
	}

	private buildCountdownDialState(
		mode: FlowTimeMode,
		elapsed: number,
		targetSeconds: number,
		task: IndexedTask | null,
		isRunning = true,
	): DialState {
		const remaining = targetSeconds - elapsed;
		if (remaining < 0) {
			const overtimeSeconds = Math.abs(remaining);
			const angle = -this.secondsToForwardAngle(overtimeSeconds);
			return {
				mode,
				displaySeconds: overtimeSeconds,
				angleDegrees: angle,
				fillAngleDegrees: angle,
				clockwise: false,
				overtime: true,
				isRunning,
				accentColor: this.resolveAccentColor(task),
			};
		}
		const displaySeconds = Math.max(0, remaining);
		const angle = this.secondsToForwardAngle(displaySeconds);
		return {
			mode,
			displaySeconds,
			angleDegrees: angle,
			fillAngleDegrees: angle,
			clockwise: true,
			overtime: false,
			isRunning,
			accentColor: this.resolveAccentColor(task),
		};
	}

	private async toggleTimerFromAction(): Promise<void> {
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
		const pendingTask = this.pendingTaskId ? this.indexer.getTask(this.pendingTaskId) : null;
		const wasBreak = !!this.breakState;
		this.clearBreakState(false);
		if (wasBreak && this.applyDefaultFlowTimeDuration()) {
			await this.callbacks.saveSettings();
		}
		const started = await (pendingTask
			? this.callbacks.startTimerForTask(pendingTask.operonId, 'flowtime')
			: this.callbacks.startUnassignedTimer('flowtime'));
		if (started) {
			this.pendingTaskId = null;
		}
	}

	private async selectTask(): Promise<void> {
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
		this.clearBreakState(false);
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
		this.clearBreakState(false);
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

	private setSessionMinutes(minutes: number, persist = true, redraw = true): void {
		const settings = this.callbacks.getSettings();
		settings.flowTimeSessionMinutes = this.clampMinutes(minutes);
		this.syncTargetReachedStateAfterDurationChange(settings);
		this.lastRenderSignature = null;
		if (persist) {
			runAsyncAction('flow time duration save failed', () => this.callbacks.saveSettings());
		}
		if (redraw) {
			this.render();
		} else {
			this.updateLiveElements(false);
		}
	}

	private async startBreakFromActiveTask(): Promise<void> {
		const settings = this.callbacks.getSettings();
		const active = this.timeTracker.getActiveState();
		if (!active?.operonId || this.breakState) return;

		const taskId = active.operonId;
		const previousPendingTaskId = this.pendingTaskId;
		this.pendingTaskId = taskId;
		this.lastRenderSignature = null;

		let stopped = false;
		try {
			stopped = await this.callbacks.stopActiveTimer('manual');
		} catch (error) {
			this.pendingTaskId = previousPendingTaskId;
			this.lastRenderSignature = null;
			this.render();
			throw error;
		}
		if (!stopped) {
			this.pendingTaskId = previousPendingTaskId;
			this.lastRenderSignature = null;
			this.render();
			return;
		}

		this.pendingTaskId = taskId;
		this.breakState = {
			taskId,
			startMs: Date.now(),
			targetSeconds: Math.max(60, settings.flowTimePauseMinutes * 60),
		};
		this.notifiedTargetKey = null;
		this.lastTargetReachedState = null;
		this.lastRenderSignature = null;
		this.startBreakTicker();
		this.render();
	}

	private startBreakTicker(): void {
		if (this.breakTickerInterval) return;
		this.breakTickerInterval = setWindowInterval(() => {
			if (!this.breakState) {
				this.stopBreakTicker();
				return;
			}
			this.updateLiveElements();
		}, 1000);
	}

	private stopBreakTicker(): void {
		if (!this.breakTickerInterval) return;
		clearWindowInterval(this.breakTickerInterval);
		this.breakTickerInterval = null;
	}

	private clearBreakState(render = true): void {
		if (!this.breakState) return;
		this.breakState = null;
		this.stopBreakTicker();
		if (render) {
			this.lastRenderSignature = null;
			this.render();
		}
	}

	private endBreakAndClearTask(): void {
		if (!this.breakState) return;
		this.clearBreakState(false);
		this.pendingTaskId = null;
		this.notifiedTargetKey = null;
		this.lastTargetReachedState = null;
		this.lastRenderSignature = null;
		this.render();
	}

	private getBreakElapsedSeconds(): number {
		if (!this.breakState) return 0;
		return Math.max(0, Math.floor((Date.now() - this.breakState.startMs) / 1000));
	}

	private applyDefaultFlowTimeDuration(): boolean {
		const settings = this.callbacks.getSettings();
		if (settings.flowTimeMode !== 'flowtime' || settings.flowTimeUseLastSelectedDuration) return false;
		if (settings.flowTimeSessionMinutes === settings.flowTimeDefaultSessionMinutes) return false;
		settings.flowTimeSessionMinutes = settings.flowTimeDefaultSessionMinutes;
		this.syncTargetReachedStateAfterDurationChange(settings);
		this.lastRenderSignature = null;
		return true;
	}

	private handleDialPointer(event: PointerEvent, svg: SVGSVGElement): void {
		if (this.callbacks.getSettings().flowTimeMode !== 'flowtime') return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		event.preventDefault();
		this.finishDialDrag(false);
		this.isDialDragging = true;
		let previousAngle = this.getPointerClockwiseAngle(event, svg);
		let accumulatedDegrees = 0;
		const startMinutes = this.callbacks.getSettings().flowTimeSessionMinutes;
		const pointerId = event.pointerId;
		try {
			svg.setPointerCapture(pointerId);
		} catch {
			// Pointer capture is best-effort; cancel/blur cleanup below still guards stale drag state.
		}
		const update = (pointerEvent: PointerEvent) => {
			if (pointerEvent.pointerId !== pointerId) return;
			const angle = this.getPointerClockwiseAngle(pointerEvent, svg);
			let delta = angle - previousAngle;
			if (delta > 180) delta -= 360;
			if (delta < -180) delta += 360;
			previousAngle = angle;
			accumulatedDegrees += delta;
			this.setSessionMinutes(startMinutes + accumulatedDegrees / 6, false, false);
		};
		const onMove = (pointerEvent: PointerEvent) => update(pointerEvent);
		const onEnd = (pointerEvent: PointerEvent) => {
			if (pointerEvent.pointerId !== pointerId) return;
			this.finishDialDrag();
		};
		const onBlur = () => this.finishDialDrag();
		this.cleanupDialDrag = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onEnd);
			window.removeEventListener('pointercancel', onEnd);
			window.removeEventListener('blur', onBlur);
			try {
				if (svg.hasPointerCapture(pointerId)) {
					svg.releasePointerCapture(pointerId);
				}
			} catch {
				// Ignore capture release failures from detached SVGs.
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onEnd);
		window.addEventListener('pointercancel', onEnd);
		window.addEventListener('blur', onBlur);
	}

	private finishDialDrag(persist = true): void {
		const cleanup = this.cleanupDialDrag;
		if (!cleanup) {
			this.isDialDragging = false;
			return;
		}
		this.cleanupDialDrag = null;
		cleanup();
		this.isDialDragging = false;
		if (persist) {
			runAsyncAction('flow time dial save failed', () => this.callbacks.saveSettings());
		}
	}

	private getPointerClockwiseAngle(event: PointerEvent, svg: SVGSVGElement): number {
		const rect = svg.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const centerX = rect.width / 2;
		const centerY = rect.height / 2;
		return (Math.atan2(y - centerY, x - centerX) * 180 / Math.PI + 90 + 360) % 360;
	}

	private notifyIfTargetReached(settings: OperonSettings, active: ActiveTrackerState | null): void {
		if (!active || settings.flowTimeMode !== 'flowtime') {
			this.notifiedTargetKey = null;
			this.lastTargetReachedState = null;
			return;
		}
		const targetSeconds = Math.max(60, settings.flowTimeSessionMinutes * 60);
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
		const targetSeconds = Math.max(60, settings.flowTimeSessionMinutes * 60);
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
			pendingDraft: this.pendingDraft,
			optimisticPatch,
			getTask: taskId => this.indexer.getTask(taskId),
		});
	}

	private resolvePendingTask(): IndexedTask | null {
		if (!this.pendingTaskId) return null;
		const task = this.indexer.getTask(this.pendingTaskId);
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
		});
	}

	private resolveAccentColor(task: IndexedTask | null): string | null {
		return this.normalizeTaskColor(task?.fieldValues['taskColor']) ?? null;
	}

	private resolveStatusColor(task: IndexedTask): string | null {
		const statusValue = task.fieldValues['status'];
		if (!statusValue) return null;
		const parsed = parseStatusValue(statusValue);
		if (!parsed) return null;
		const pipeline = this.callbacks.getPipelines().find(candidate => candidate.name === parsed.pipeline);
		const status = pipeline?.statuses.find(candidate => candidate.label === parsed.status);
		return status?.color ?? null;
	}

	private normalizeTaskColor(taskColor: string | undefined): string | null {
		if (!taskColor) return null;
		const trimmed = taskColor.trim();
		if (!trimmed) return null;
		return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
	}

	private clampMinutes(minutes: number): number {
		return Math.max(FLOW_TIME_MINUTES_MIN, Math.round(minutes));
	}

	private secondsToForwardAngle(seconds: number): number {
		return ((Math.max(0, seconds) % 3600) / 3600) * 360;
	}

	private pointOnCircle(cx: number, cy: number, radius: number, angleDegrees: number): { x: number; y: number } {
		const radians = (angleDegrees - 90) * Math.PI / 180;
		return {
			x: cx + radius * Math.cos(radians),
			y: cy + radius * Math.sin(radians),
		};
	}

	private describeWedge(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, clockwise: boolean): string {
		const normalizedDelta = clockwise
			? ((endAngle - startAngle) % 360 + 360) % 360
			: ((startAngle - endAngle) % 360 + 360) % 360;
		if (normalizedDelta < 0.01) {
			return `M ${cx} ${cy} L ${cx} ${cy - radius} Z`;
		}
		const adjustedEnd = normalizedDelta > 359.5
			? (clockwise ? startAngle + 359.5 : startAngle - 359.5)
			: endAngle;
		const start = this.pointOnCircle(cx, cy, radius, startAngle);
		const end = this.pointOnCircle(cx, cy, radius, adjustedEnd);
		const largeArc = normalizedDelta > 180 ? '1' : '0';
		const sweep = clockwise ? '1' : '0';
		return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x} ${end.y} Z`;
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
