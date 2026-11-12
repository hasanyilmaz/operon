import type { FlowTimeMode, OperonSettings } from '../types/settings';
import type { FlowTimeBreakController } from './flow-time-break';
import { resolveDefaultFlowTimeSessionMinutes } from './flow-time-dial-state';
import type { TimeTracker } from './time-tracker';

export type FlowTimeTimerSettings = Pick<OperonSettings, 'flowTimeMode' | 'flowTimeSessionMinutes'>;

interface FlowTimeControlDependencies {
	getSettings: () => OperonSettings;
	saveSettings: (expected: Partial<FlowTimeTimerSettings>, values: Partial<FlowTimeTimerSettings>) => Promise<void>;
	timeTracker: Pick<TimeTracker, 'getActiveState' | 'getTransitionState' | 'subscribe'>;
	breakController: Pick<FlowTimeBreakController, 'getSnapshot' | 'subscribe'>;
}

interface TargetEdit {
	context: string;
	initialMinutes: number;
	minutes: number;
	onEnd: () => void;
}

type ControlEvent = 'preview' | 'committed' | 'mode';

/** Shared timer mode and work target for all timer surfaces in this plugin instance. */
export class FlowTimeControls {
	private edit: TargetEdit | null = null;
	private saving: TargetEdit | null = null;
	private pendingMode: { mode: FlowTimeMode; minutes: number | undefined } | null = null;
	private disposed = false;
	private readonly listeners = new Set<(event: ControlEvent) => void>();
	private readonly unsubscribeTracker: () => void;
	private readonly unsubscribeBreak: () => void;

	constructor(private readonly dependencies: FlowTimeControlDependencies) {
		this.unsubscribeTracker = dependencies.timeTracker.subscribe(event => {
			if (event !== 'tick') this.syncContext();
		});
		this.unsubscribeBreak = dependencies.breakController.subscribe(event => {
			if (event !== 'tick') this.syncContext();
		});
	}

	get mode(): FlowTimeMode {
		return this.pendingMode?.mode ?? this.dependencies.getSettings().flowTimeMode;
	}

	get minutes(): number {
		if (this.pendingMode?.minutes !== undefined) return this.pendingMode.minutes;
		const edit = this.edit ?? this.saving;
		const saved = this.dependencies.getSettings().flowTimeSessionMinutes;
		return edit && edit.initialMinutes === saved && edit.context === this.getEditableContext() ? edit.minutes : saved;
	}

	get editable(): boolean {
		return !this.disposed && !this.saving && !this.pendingMode && this.getEditableContext() !== null;
	}

	subscribe(listener: (event: ControlEvent) => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	async setMode(mode: FlowTimeMode): Promise<void> {
		const { breakController, getSettings, saveSettings, timeTracker } = this.dependencies;
		const settings = getSettings();
		if (this.disposed || this.pendingMode || this.saving || settings.flowTimeMode === mode) return;

		const { actionPending, breakState } = breakController.getSnapshot();
		const idle = !breakState && !actionPending && !timeTracker.getActiveState() && !timeTracker.getTransitionState();
		const expected: Partial<FlowTimeTimerSettings> = { flowTimeMode: settings.flowTimeMode };
		const values: Partial<FlowTimeTimerSettings> = { flowTimeMode: mode };
		if (mode === 'flowtime' && idle) {
			const minutes = resolveDefaultFlowTimeSessionMinutes(settings);
			if (minutes !== settings.flowTimeSessionMinutes) {
				expected.flowTimeSessionMinutes = settings.flowTimeSessionMinutes;
				values.flowTimeSessionMinutes = minutes;
			}
		}
		this.pendingMode = { mode, minutes: values.flowTimeSessionMinutes };
		this.cancel();
		this.emit('mode');
		try {
			await saveSettings(expected, values);
		} finally {
			this.pendingMode = null;
			this.emit('mode');
		}
	}

	begin(onEnd: () => void) {
		this.syncContext();
		const context = this.getEditableContext();
		if (this.disposed || this.edit || this.saving || this.pendingMode || context === null) return null;
		const initialMinutes = this.dependencies.getSettings().flowTimeSessionMinutes;
		const edit: TargetEdit = { context, initialMinutes, minutes: initialMinutes, onEnd };
		this.edit = edit;

		return {
			initialMinutes,
			preview: (minutes: number) => {
				this.syncContext();
				if (this.edit !== edit) return;
				const next = Math.max(1, Math.round(minutes));
				if (!Number.isFinite(next) || next === edit.minutes) return;
				edit.minutes = next;
				this.emit('preview');
			},
			commit: () => this.commit(edit),
			cancel: () => { if (this.edit === edit) this.cancel(); },
		};
	}

	syncContext(): void {
		const edit = this.edit;
		if (edit && (edit.context !== this.getEditableContext()
			|| edit.initialMinutes !== this.dependencies.getSettings().flowTimeSessionMinutes)) this.cancel();
	}

	destroy(): void {
		this.disposed = true;
		this.unsubscribeTracker();
		this.unsubscribeBreak();
		this.listeners.clear();
		this.cancel();
	}

	private getEditableContext(): string | null {
		const { breakController, getSettings, timeTracker } = this.dependencies;
		const { actionPending, breakState } = breakController.getSnapshot();
		if (getSettings().flowTimeMode !== 'flowtime' || breakState || actionPending || timeTracker.getTransitionState()) return null;
		const active = timeTracker.getActiveState();
		return active ? JSON.stringify([active.start, active.operonId]) : 'idle';
	}

	private cancel(): void {
		const edit = this.edit;
		if (!edit) return;
		this.edit = null;
		edit.onEnd();
		this.emit('preview');
	}

	private async commit(edit: TargetEdit): Promise<void> {
		this.syncContext();
		if (this.edit !== edit) return;
		if (edit.initialMinutes === edit.minutes) {
			this.cancel();
			return;
		}

		this.edit = null;
		this.saving = edit;
		edit.onEnd();
		let event: ControlEvent = 'preview';
		try {
			await this.dependencies.saveSettings(
				{ flowTimeSessionMinutes: edit.initialMinutes },
				{ flowTimeSessionMinutes: edit.minutes },
			);
			event = 'committed';
		} finally {
			this.saving = null;
			this.emit(event);
		}
	}

	private emit(event: ControlEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}
