import type { TimeTracker, TimeTrackerEvent } from './time-tracker';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import type { ActiveTrackerState, TrackerSource } from '../types/tracker';
import { FlowTimeCompletionAlertTracker } from './flow-time-completion-alerts';

export interface FlowTimeBreakState {
	readonly taskId: string;
	readonly startMs: number;
	readonly targetSeconds: number;
}

export interface FlowTimeBreakSnapshot {
	readonly breakState: FlowTimeBreakState | null;
	readonly pendingTaskId: string | null;
	readonly actionPending: boolean;
}

export function canSelectFlowTimeTask(active: ActiveTrackerState | null, state: FlowTimeBreakSnapshot): boolean {
	return !active?.operonId && (!state.breakState || !active);
}

interface FlowTimeBreakDependencies {
	timeTracker: Pick<TimeTracker, 'getActiveState' | 'getTransitionState' | 'subscribe'>;
	getTask: (taskId: string) => IndexedTask | null | undefined;
	getSettings: () => OperonSettings;
	saveSettings: () => Promise<void>;
	stopActiveTimer: (canCommit: () => boolean) => Promise<boolean>;
	startTimerForTask: (taskId: string, source: TrackerSource, canCommit: () => boolean) => Promise<boolean>;
	playReminderSound: () => Promise<void>;
	/** The plugin supplies its stable window, rather than a transient pop-out. */
	scheduleTick: (tick: () => void) => () => void;
	now?: () => number;
}

type BreakEvent = 'state' | 'tick';

/** One ephemeral break per plugin instance, shared by FlowTime and status docks. */
export class FlowTimeBreakController {
	private breakState: FlowTimeBreakState | null = null;
	private pendingTaskId: string | null = null;
	private readonly listeners = new Set<(event: BreakEvent) => void>();
	private readonly completionAlerts = new FlowTimeCompletionAlertTracker();
	private readonly unsubscribeTracker: () => void;
	private stopTicker: (() => void) | null = null;
	private operation: { key: string; promise: Promise<boolean> } | null = null;
	private disposed = false;
	private startingTaskId: string | null = null;
	private selectionActive: ActiveTrackerState | null = null;
	private revision = 0;
	private lastSoundSettings = '';

	constructor(private readonly dependencies: FlowTimeBreakDependencies) {
		this.unsubscribeTracker = dependencies.timeTracker.subscribe(event => this.onTrackerEvent(event));
	}

	getSnapshot(): FlowTimeBreakSnapshot {
		return {
			breakState: this.breakState ? { ...this.breakState } : null,
			pendingTaskId: this.pendingTaskId,
			actionPending: this.operation !== null,
		};
	}

	getElapsedSeconds(): number {
		return this.breakState ? Math.max(0, Math.floor((this.now() - this.breakState.startMs) / 1000)) : 0;
	}

	subscribe(listener: (event: BreakEvent) => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	toggleBreak(): Promise<boolean> {
		// Keep a second coffee click from turning a still-pending start into an end.
		if (this.operation) return this.operation.key === 'break' ? this.operation.promise : Promise.resolve(false);
		if (this.breakState) return Promise.resolve(this.endBreak());
		return this.startBreak();
	}

	startBreak(): Promise<boolean> {
		const { timeTracker } = this.dependencies;
		const active = timeTracker.getActiveState();
		return this.runAction('break', async () => {
			if (!active?.operonId || !this.isSameActive(active) || this.breakState || timeTracker.getTransitionState()) return false;
			const taskId = active.operonId;
			const revision = this.revision;
			const isCurrent = () => !this.disposed && this.revision === revision;
			const stopped = await this.dependencies.stopActiveTimer(() => isCurrent() && this.isSameActive(active));
			if (!stopped || !isCurrent() || timeTracker.getActiveState() || timeTracker.getTransitionState()) return false;
			if (!this.dependencies.getTask(taskId)) return false;
			this.pendingTaskId = taskId;
			this.breakState = {
				taskId,
				startMs: this.now(),
				targetSeconds: Math.max(60, this.dependencies.getSettings().flowTimePauseMinutes * 60),
			};
			this.revision += 1;
			this.completionAlerts.reset();
			this.observeBreakSound();
			this.stopTicker = this.dependencies.scheduleTick(() => this.tick());
			return true;
		});
	}

	/** End the break without dropping the task or automatically resuming work. */
	endBreak(): boolean {
		if (this.disposed || this.operation || !this.breakState) return false;
		this.clearBreak();
		this.revision += 1;
		this.emit('state');
		return true;
	}

	resumePending(source: TrackerSource = 'flowtime'): Promise<boolean> {
		return this.runAction('resume', async () => {
			const { timeTracker } = this.dependencies;
			const taskId = this.pendingTaskId;
			if (!taskId || timeTracker.getActiveState() || timeTracker.getTransitionState()) return false;
			if (!this.dependencies.getTask(taskId)) { this.clearPending(); return false; }
			const revision = this.revision;
			const isCurrent = () => !this.disposed && this.revision === revision && this.pendingTaskId === taskId;
			return this.startPendingTask(taskId, source, isCurrent);
		});
	}

	/** Task selection is serialized; Cancel preserves the current waiting state. */
	selectPendingTask(pick: () => Promise<string | null>, source: TrackerSource, canUse: () => boolean = () => true): Promise<boolean> {
		return this.runAction('select', async () => {
			const { timeTracker } = this.dependencies;
			if (!canUse() || !canSelectFlowTimeTask(timeTracker.getActiveState(), this.getSnapshot()) || timeTracker.getTransitionState()) return false;
			const pending = this.pendingTaskId, revision = this.revision, breakState = this.breakState;
			this.selectionActive = timeTracker.getActiveState();
			const isCurrent = () => !this.disposed && canUse() && this.revision === revision && this.pendingTaskId === pending && this.breakState === breakState
				&& (this.selectionActive ? this.isSelectionActive() || this.isResumeStartingActive() : !timeTracker.getActiveState() || this.isResumeStartingActive());
			try {
				const selected = await pick();
				if (!selected || !isCurrent() || (timeTracker.getActiveState() && !this.isSelectionActive()) || timeTracker.getTransitionState() || !this.dependencies.getTask(selected)) return false;
				return await this.startPendingTask(selected, source, isCurrent);
			} finally { this.selectionActive = null; }
		});
	}

	private async startPendingTask(taskId: string, source: TrackerSource, isCurrent: () => boolean): Promise<boolean> {
		const { timeTracker } = this.dependencies, pending = this.pendingTaskId;
		const settings = this.dependencies.getSettings(), previousMinutes = settings.flowTimeSessionMinutes;
		if (this.applyDefaultSessionDuration()) {
			const nextMinutes = settings.flowTimeSessionMinutes;
			try { await this.dependencies.saveSettings(); }
			catch (error) {
				if (settings.flowTimeSessionMinutes === nextMinutes) settings.flowTimeSessionMinutes = previousMinutes;
				throw error;
			}
		}
		if (!isCurrent()) return false;
		this.startingTaskId = taskId;
		try {
			const started = await this.dependencies.startTimerForTask(taskId, source,
				() => isCurrent() && !!this.dependencies.getTask(taskId) && (!timeTracker.getActiveState() || this.isSelectionActive() || this.isResumeStartingActive()));
			if (started && pending !== null && this.pendingTaskId === pending && this.isActiveTask(taskId)) this.clearPending();
			return started;
		} finally { this.startingTaskId = null; }
	}

	/** Existing FlowTime duration preference, applied only by explicit user actions. */
	applyDefaultSessionDuration(): boolean {
		const settings = this.dependencies.getSettings();
		if (settings.flowTimeMode !== 'flowtime' || settings.flowTimeUseLastSelectedDuration
			|| settings.flowTimeSessionMinutes === settings.flowTimeDefaultSessionMinutes) return false;
		settings.flowTimeSessionMinutes = settings.flowTimeDefaultSessionMinutes;
		return true;
	}

	destroy(): void {
		this.disposed = true;
		this.unsubscribeTracker();
		this.clearPending();
		this.listeners.clear();
	}

	private runAction(key: string, action: () => Promise<boolean>): Promise<boolean> {
		if (this.disposed) return Promise.resolve(false);
		if (this.operation) return this.operation.key === key ? this.operation.promise : Promise.resolve(false);
		// Publish the lock before callbacks can synchronously emit tracker events.
		const promise = Promise.resolve().then(action).finally(() => {
			this.operation = null;
			if (!this.disposed) this.emit('state');
		});
		this.operation = { key, promise };
		this.emit('state');
		return promise;
	}

	private onTrackerEvent(event: TimeTrackerEvent): void {
		if (this.disposed || event !== 'state') return;
		if (this.operation?.key === 'select' && this.selectionActive && !this.dependencies.timeTracker.getActiveState()) {
			this.clearPending(); this.emit('state'); return;
		}
		if (this.dependencies.timeTracker.getActiveState() && !this.isResumeStartingActive() && !this.isSelectionActive()) {
			// Any committed work supersedes a break, including starts from another surface.
			this.clearPending();
			this.emit('state');
		}
	}

	private tick(): void {
		if (this.disposed || !this.breakState) return;
		if ((this.dependencies.timeTracker.getActiveState() && !this.isResumeStartingActive())
			|| !this.dependencies.getTask(this.breakState.taskId)) {
			this.clearPending();
			this.emit('state');
			return;
		}
		this.observeBreakSound();
		this.emit('tick');
	}

	private observeBreakSound(): void {
		if (!this.breakState) return;
		const settings = this.dependencies.getSettings();
		const soundSettings = `${settings.flowTimeMode}:${String(settings.flowTimePlayReminderSoundOnTargetReached)}`;
		const input = {
			kind: 'break' as const,
			occurrenceKey: `${this.breakState.taskId}:${this.breakState.startMs}`,
			elapsedSeconds: this.getElapsedSeconds(),
			targetSeconds: this.breakState.targetSeconds,
			enabled: settings.flowTimePlayReminderSoundOnTargetReached,
		};
		if (this.lastSoundSettings !== soundSettings) {
			this.lastSoundSettings = soundSettings;
			this.completionAlerts.sync(input);
			return;
		}
		if (!this.completionAlerts.observe(input)) return;
		void this.dependencies.playReminderSound().catch(error => {
			console.warn('Operon: FlowTime break reminder sound playback failed unexpectedly', error);
		});
	}

	private clearBreak(): void {
		this.breakState = null;
		this.completionAlerts.reset();
		this.stopTicker?.();
		this.stopTicker = null;
	}

	private clearPending(): void {
		this.clearBreak();
		this.pendingTaskId = null;
		this.revision += 1;
	}

	private isSameActive(expected: ActiveTrackerState): boolean {
		const active = this.dependencies.timeTracker.getActiveState();
		return active?.operonId === expected.operonId && active?.start === expected.start;
	}

	private isSelectionActive(): boolean {
		const active = this.dependencies.timeTracker.getActiveState();
		return this.operation?.key === 'select' && this.selectionActive?.operonId === null
			&& active?.operonId === null && active.start === this.selectionActive.start;
	}

	private isResumeStartingActive(): boolean {
		const active = this.dependencies.timeTracker.getActiveState();
		const transition = this.dependencies.timeTracker.getTransitionState();
		// TimeTracker allocates its record before committing the task's start fields.
		// Keep our guard valid for that allocation, but reject unrelated active work.
		return this.startingTaskId !== null && (this.operation?.key === 'resume' || this.operation?.key === 'select') && transition?.kind === 'starting'
			&& (!transition.previousActive || (this.selectionActive?.operonId === null
				&& transition.previousActive.operonId === null && transition.previousActive.start === this.selectionActive.start))
			&& transition.taskId === this.startingTaskId
			&& active?.operonId === this.startingTaskId && active?.start === transition.start;
	}

	private isActiveTask(taskId: string): boolean {
		return this.dependencies.timeTracker.getActiveState()?.operonId === taskId;
	}

	private now(): number { return this.dependencies.now?.() ?? Date.now(); }

	private emit(event: BreakEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}
