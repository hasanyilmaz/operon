import { Component, Notice, type App, type WorkspaceContainer, type WorkspaceLeaf } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import type { TimeTracker } from '../systems/time-tracker';
import { canSelectFlowTimeTask, type FlowTimeBreakController } from '../systems/flow-time-break';
import { resolveStatusDockClickAction, type OperonSettings, type TaskFinderResultBehavior } from '../types/settings';
import { UpcomingTaskStatusModel } from '../core/upcoming-task-status';
import { getOwnerWindow } from '../core/dom-compat';
import { resolveFlowTimeRenderedState } from '../systems/flow-time-optimistic';
import type { ActiveTrackerState } from '../types/tracker';
import { getNativeLightboxLeaves } from './native-lightbox-lifecycle';
import { t } from '../core/i18n';
import { StatusDockWidget, type StatusDockAlert, type StatusDockSnapshot } from './status-dock-widget';

interface StatusDockDependencies {
	indexer: Pick<OperonIndexer, 'getTask' | 'getAllTasks' | 'getGeneration'>;
	timeTracker: TimeTracker;
	breakController: FlowTimeBreakController;
	getSettings: () => OperonSettings;
	openFlowTime: () => Promise<void>;
	openTask: (taskId: string, anchor: HTMLElement, behavior: TaskFinderResultBehavior) => Promise<void>;
	pickTrackerTask: () => Promise<string | null>;
	openConflicts: () => void;
	startTimerForTask: (taskId: string, canCommit: () => boolean) => Promise<boolean>;
	createTrackerTask: (canUse: () => boolean) => Promise<string | null>;
}
interface DockWindow {
	widget: StatusDockWidget;
	host: HTMLElement | null;
	leaf: WorkspaceLeaf | null;
	dispose: () => void;
}

/** Public workspace roots exclude sidebars; owned lightbox leaves never become hosts. */
export function isStatusDockLeaf(app: App, leaf: WorkspaceLeaf): boolean {
	const el = leaf.view.containerEl;
	return el.isConnected && !leaf.getContainer().win.closed && !getNativeLightboxLeaves(app).includes(leaf)
		&& !el.closest('.operon-task-media-lightbox')
		&& leaf.getRoot() === leaf.getContainer() && el.ownerDocument === leaf.getContainer().doc;
}

export class OperonStatusDock extends Component {
	private readonly windows = new Map<WorkspaceContainer, DockWindow>();
	private readonly recent = new Map<WorkspaceContainer, WorkspaceLeaf>();
	private readonly upcoming: UpcomingTaskStatusModel;
	private readonly owner: Window;
	private alert: StatusDockAlert = { state: 'hidden', count: 0 };
	private refreshTimer: number | null = null;
	private disposed = false;
	private visible = true;
	private action: Promise<void> | null = null;
	private presentation: ((state: StatusDockSnapshot) => StatusDockSnapshot) | null = null;

	constructor(private readonly app: App, private readonly dependencies: StatusDockDependencies) {
		super();
		this.owner = getOwnerWindow(app.workspace.containerEl);
		this.upcoming = new UpcomingTaskStatusModel(dependencies.indexer, () => ({ ...dependencies.getSettings(), upcomingCountdownDisplay: 'seconds' }), () => {},
			(callback, delay) => { const id = this.owner.setTimeout(callback, delay); return () => this.owner.clearTimeout(id); }, undefined, true);
	}

	onload(): void {
		const { workspace } = this.app;
		this.register(this.upcoming.subscribe(() => this.renderWidgets()));
		this.register(this.dependencies.timeTracker.subscribe(() => this.renderWidgets()));
		this.register(this.dependencies.breakController.subscribe(() => this.renderWidgets()));
		this.registerEvent(workspace.on('active-leaf-change', leaf => {
			if (leaf && isStatusDockLeaf(this.app, leaf)) this.recent.set(leaf.getContainer(), leaf);
			this.scheduleReconcile();
		}));
		this.registerEvent(workspace.on('layout-change', () => this.scheduleReconcile()));
		this.registerEvent(workspace.on('window-open', () => this.scheduleReconcile()));
		this.registerEvent(workspace.on('window-close', container => {
			this.removeWindow(container); this.scheduleReconcile();
		}));
		workspace.onLayoutReady(() => { if (!this.disposed) this.refresh(); });
		this.refresh();
	}

	refresh(): void {
		if (this.disposed) return;
		this.upcoming.refresh();
		this.reconcile();
	}

	toggleVisibility(): void {
		if (this.disposed) return;
		this.visible = !this.visible;
		for (const { widget } of this.windows.values()) widget.setVisible(this.visible);
	}

	setDuplicateAlert(state: StatusDockAlert['state'], count = 0): void {
		this.alert = { state, count };
		this.renderWidgets();
	}

	onunload(): void {
		this.disposed = true;
		this.presentation = null;
		if (this.refreshTimer !== null) this.owner.clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.upcoming.destroy();
		for (const container of [...this.windows.keys()]) this.removeWindow(container);
	}

	private scheduleReconcile(): void {
		if (this.disposed || this.refreshTimer !== null) return;
		this.refreshTimer = this.owner.setTimeout(() => { this.refreshTimer = null; this.reconcile(); }, 0);
	}

	private reconcile(): void {
		if (this.disposed) return;
		// Keep each dock owned by its window even when active leaves move.
		for (const [container, context] of this.windows) {
			if (context.widget.slot.ownerDocument !== container.doc) this.removeWindow(container);
		}
		const candidates = new Map<WorkspaceContainer, WorkspaceLeaf[]>();
		this.app.workspace.iterateAllLeaves(leaf => {
			if (!isStatusDockLeaf(this.app, leaf)) return;
			const container = leaf.getContainer();
			const leaves = candidates.get(container) ?? []; leaves.push(leaf); candidates.set(container, leaves);
		});
		for (const container of [...this.windows.keys()]) if (!candidates.has(container)) this.removeWindow(container);
		for (const [container, leaves] of candidates) {
			const mostRecent = this.app.workspace.getMostRecentLeaf(container);
			const remembered = this.recent.get(container);
			const leaf = mostRecent && leaves.includes(mostRecent) ? mostRecent
				: remembered && leaves.includes(remembered) ? remembered : leaves[0];
			this.recent.set(container, leaf);
			let context = this.windows.get(container);
			if (context && context.widget.slot.ownerDocument !== container.doc) { this.removeWindow(container); context = undefined; }
			if (!context) { context = this.createWindow(container); this.windows.set(container, context); }
			const host = container.doc.body;
			if (context.host !== host || context.widget.slot.parentElement !== host) {
				context.widget.closeTooltips();
				context.host = host; context.leaf = leaf;
				host.appendChild(context.widget.slot);
			}
			context.leaf = leaf;
			this.updateViewport(container, context.widget);
		}
		this.renderWidgets();
	}

	private createWindow(container: WorkspaceContainer): DockWindow {
		const widget = new StatusDockWidget(container.doc, {
			startTask: (taskId, anchor) => this.startCalendarTask(taskId, anchor),
			openTracker: anchor => this.openTracker(anchor),
			toggleTimer: () => this.toggleTimer(),
			toggleBreak: anchor => this.activateSecondaryAction(anchor),
			createTask: anchor => this.createTaskForTimer(anchor),
			findTask: anchor => this.selectTaskForTimer(anchor),
			openUpcoming: anchor => this.runAction(async () => {
				const task = this.upcoming.getSnapshot().task;
				if (task) await this.dependencies.openTask(task.operonId, anchor, resolveStatusDockClickAction(this.dependencies.getSettings().statusDockClickAction));
			}),
			openCurrentTask: (taskId, anchor) => this.runAction(async () => {
				const task = this.upcoming.getSnapshot().ongoing?.find(candidate => candidate.operonId === taskId);
				if (task) await this.dependencies.openTask(task.operonId, anchor, resolveStatusDockClickAction(this.dependencies.getSettings().statusDockClickAction));
			}),
			openNextUpcoming: anchor => this.runAction(async () => {
				const task = this.upcoming.getSnapshot().next?.task;
				if (task) await this.dependencies.openTask(task.operonId, anchor, resolveStatusDockClickAction(this.dependencies.getSettings().statusDockClickAction));
			}),
			openConflicts: this.dependencies.openConflicts,
		}, error => { console.warn('Operon: status dock action failed', error); new Notice(t('notifications', 'taskSaveFailed')); });
		widget.setVisible(this.visible);
		const context: DockWindow = { widget, host: null, leaf: null, dispose: () => {} };
		const resize = () => this.updateViewport(container, widget);
		const refresh = () => { if (!this.disposed) { this.upcoming.refresh(); this.scheduleReconcile(); } };
		container.win.addEventListener('resize', resize);
		container.win.addEventListener('focus', refresh);
		container.win.visualViewport?.addEventListener('resize', resize);
		container.win.visualViewport?.addEventListener('scroll', resize);
		container.doc.addEventListener('visibilitychange', refresh);
		context.dispose = () => {
			container.win.removeEventListener('resize', resize); container.win.removeEventListener('focus', refresh);
			container.doc.removeEventListener('visibilitychange', refresh);
			container.win.visualViewport?.removeEventListener('resize', resize);
			container.win.visualViewport?.removeEventListener('scroll', resize); widget.destroy();
		};
		return context;
	}

	private updateViewport(container: WorkspaceContainer, widget: StatusDockWidget): void {
		const viewport = container.win.visualViewport;
		const width = viewport?.width ?? container.win.innerWidth;
		widget.slot.style.left = `${viewport?.offsetLeft ?? 0}px`;
		widget.slot.style.width = `${width}px`;
		widget.slot.style.bottom = `${12 + Math.max(0, container.win.innerHeight - (viewport?.offsetTop ?? 0) - (viewport?.height ?? container.win.innerHeight))}px`;
		widget.setViewport(width, viewport?.height ?? container.win.innerHeight, viewport?.offsetLeft ?? 0, viewport?.offsetTop ?? 0);
	}

	private async startCalendarTask(taskId: string, anchor: HTMLElement): Promise<void> {
		const canStart = () => {
			const upcoming = this.upcoming.getSnapshot();
			return !this.disposed && anchor.isConnected && !getOwnerWindow(anchor).closed
				&& this.dependencies.getSettings().upcomingShowStatusBar
				&& (upcoming.task?.operonId === taskId || upcoming.next?.task.operonId === taskId
					|| upcoming.ongoing?.some(task => task.operonId === taskId) === true);
		};
		await this.runAction(async () => {
			if (!canStart() || this.dependencies.timeTracker.getActiveState()?.operonId === taskId) return;
			if (canSelectFlowTimeTask(this.dependencies.timeTracker.getActiveState(), this.dependencies.breakController.getSnapshot())) {
				await this.dependencies.breakController.selectPendingTask(async () => taskId, 'status-bar', canStart);
			} else await this.dependencies.startTimerForTask(taskId, canStart);
		});
	}

	private async openTracker(anchor: HTMLElement): Promise<void> {
		await this.runAction(async () => {
			const { timeTracker, breakController } = this.dependencies;
			const expected = timeTracker.getActiveState();
			const pending = breakController.getSnapshot().pendingTaskId;
			const taskId = expected?.operonId ?? pending;
			if (taskId) await this.dependencies.openTask(taskId, anchor, resolveStatusDockClickAction(this.dependencies.getSettings().statusDockClickAction));
		});
	}

	private removeWindow(container: WorkspaceContainer): void {
		this.windows.get(container)?.dispose(); this.windows.delete(container); this.recent.delete(container);
	}

	private snapshot(): StatusDockSnapshot {
		const { dependencies } = this;
		const breakSnapshot = dependencies.breakController.getSnapshot();
		const state = { settings: dependencies.getSettings(), active: dependencies.timeTracker.getActiveState(), breakSnapshot,
			breakSeconds: dependencies.breakController.getElapsedSeconds(),
			pendingDescription: breakSnapshot.pendingTaskId ? dependencies.indexer.getTask(breakSnapshot.pendingTaskId)?.description ?? null : null,
			upcoming: this.upcoming.getSnapshot(), alert: this.alert, actionPending: this.action !== null };
		return this.presentation?.(state) ?? state;
	}

	private renderWidgets(): void {
		if (this.disposed) return;
		const snapshot = this.snapshot();
		for (const { widget } of this.windows.values()) widget.update(snapshot);
	}

	private async createTaskForTimer(anchor: HTMLElement): Promise<void> {
		const canUse = () => !this.disposed && anchor.isConnected && !getOwnerWindow(anchor).closed;
		await this.runAction(async () => {
			let created: string | null = null;
			const started = await this.dependencies.breakController.selectPendingTask(async () => {
				created = await this.dependencies.createTrackerTask(canUse); return created;
			}, 'status-bar', canUse);
			if (created && !started && canUse()) new Notice(t('notifications', 'creatorPostCreateFinalizeFailed'));
		});
	}

	private async selectTaskForTimer(anchor: HTMLElement): Promise<void> {
		await this.runAction(async () => { await this.dependencies.breakController.selectPendingTask(this.dependencies.pickTrackerTask, 'status-bar',
			() => !this.disposed && anchor.isConnected && !getOwnerWindow(anchor).closed); });
	}

	private async activateSecondaryAction(anchor: HTMLElement): Promise<void> {
		const { breakController, timeTracker } = this.dependencies;
		if (!breakController.getSnapshot().breakState && canSelectFlowTimeTask(timeTracker.getActiveState(), breakController.getSnapshot())) {
			await this.selectTaskForTimer(anchor);
		} else {
			await this.runAction(async () => { await breakController.toggleBreak(); },
				this.previewTimerAction(breakController.getSnapshot().breakState ? 'end-break' : 'break'));
		}
	}

	private async toggleTimer(): Promise<void> {
		const { timeTracker, breakController, openFlowTime } = this.dependencies;
		const expected = timeTracker.getActiveState();
		await this.runAction(async () => {
			if (expected) {
				const stopped = await timeTracker.stop('manual', undefined, () => {
					const active = timeTracker.getActiveState();
					return !this.disposed && !breakController.getSnapshot().actionPending && active?.operonId === expected.operonId && active?.start === expected.start;
				});
				if (stopped && !this.disposed) await openFlowTime();
			} else if (breakController.getSnapshot().pendingTaskId) await breakController.resumePending('status-bar');
			else if (await timeTracker.startUnassigned('status-bar') && !this.disposed) await openFlowTime();
		}, this.previewTimerAction(expected ? 'stop' : 'start'));
	}

	/** Visual only: domain state and persistence are never changed before commit. */
	private previewTimerAction(kind: 'stop' | 'start' | 'break' | 'end-break'): (state: StatusDockSnapshot) => StatusDockSnapshot {
		const { timeTracker, breakController, indexer } = this.dependencies;
		const expected = timeTracker.getActiveState(), before = breakController.getSnapshot(), now = Date.now();
		const sameActive = (active: ActiveTrackerState | null | undefined) => active?.operonId === expected?.operonId && active?.start === expected?.start;
		const taskId = kind === 'start' ? before.pendingTaskId : expected?.operonId ?? before.pendingTaskId;
		let current = true;
		return state => {
			const next = state.breakSnapshot;
			if (next.pendingTaskId !== before.pendingTaskId || next.breakState?.startMs !== before.breakState?.startMs
				|| next.breakState?.taskId !== before.breakState?.taskId) current = false;
			if (state.active && !sameActive(state.active)) {
				const transition = timeTracker.getTransitionState();
				if (kind !== 'start' || transition?.kind !== 'starting' || transition.taskId !== taskId
					|| !sameActive(transition.previousActive) || state.active.start !== transition.start) current = false;
			}
			if (!current) return state;
			const task = taskId ? indexer.getTask(taskId) ?? null : null;
			if (taskId && !task) return state;
			const rendered = resolveFlowTimeRenderedState({ active: state.active, pendingTask: task, pendingDraft: null,
				transition: { kind: kind === 'start' ? 'starting' : 'stopping', taskId: taskId ?? null,
					start: new Date(now).toISOString(), source: 'status-bar', startedAtMs: now }, nowMs: now,
				getTask: id => indexer.getTask(id) });
			const breakState = kind === 'break' && taskId
				? { taskId, startMs: now, targetSeconds: Math.max(60, state.settings.flowTimePauseMinutes * 60) } : null;
			const pendingTaskId = kind === 'break' ? taskId ?? null : kind === 'end-break' ? before.pendingTaskId : null;
			return { ...state, active: rendered.active, breakSnapshot: { ...next, breakState, pendingTaskId }, breakSeconds: 0,
				pendingDescription: pendingTaskId ? task?.description ?? null : null };
		};
	}

	private async runAction(action: () => Promise<void>, presentation?: (state: StatusDockSnapshot) => StatusDockSnapshot): Promise<void> {
		if (this.disposed || this.action || this.dependencies.breakController.getSnapshot().actionPending) return;
		this.presentation = presentation ?? null;
		this.action = Promise.resolve().then(async () => { if (!this.disposed) await action(); });
		this.renderWidgets();
		try { await this.action; } finally { this.presentation = null; this.action = null; this.renderWidgets(); }
	}

}
