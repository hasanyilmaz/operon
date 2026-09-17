import { enginePerfLog, enginePerfNow, isOperonEnginePerfDebugEnabled } from '../../core/engine-perf';

type TableLoadPhase = 'loadingShell' | 'read' | 'resolve' | 'render';
type TableLoadLabel = 'table.file.load' | 'table.preset.switch';

export interface TableLoadPerformanceDependencies {
	isEnabled: () => boolean;
	now: () => number;
	scheduleFrame: (callback: () => void) => void;
	emit: (label: string, values: Record<string, number | string>) => void;
}

/** Debug-only checkpoints; the frame sample is a scheduling boundary, not proof of paint. */
export function beginTableLoadPerformance(
	label: TableLoadLabel,
	owner: Window,
	dependencies?: TableLoadPerformanceDependencies,
): TableLoadPerformanceTrace | null {
	if (!(dependencies?.isEnabled ?? isOperonEnginePerfDebugEnabled)()) return null;
	return new TableLoadPerformanceTrace(label, dependencies ?? {
		isEnabled: isOperonEnginePerfDebugEnabled,
		now: enginePerfNow,
		scheduleFrame: callback => { owner.requestAnimationFrame(callback); },
		emit: (event, values) => enginePerfLog(event, values),
	});
}

class TableLoadPerformanceTrace {
	private readonly startedAt: number;
	private lastCheckpoint: number;
	private readonly phases: Partial<Record<TableLoadPhase, number>> = {};
	private finished = false;

	constructor(private readonly label: TableLoadLabel, private readonly dependencies: TableLoadPerformanceDependencies) {
		this.startedAt = this.lastCheckpoint = dependencies.now();
	}

	mark(phase: TableLoadPhase): void {
		if (this.finished) return;
		const now = this.dependencies.now();
		this.phases[phase] = now - this.lastCheckpoint;
		this.lastCheckpoint = now;
	}

	finish(status: 'loaded' | 'invalid' | 'failed', isCurrent: () => boolean): void {
		if (this.finished) return;
		this.finished = true;
		if (!this.dependencies.isEnabled() || !isCurrent()) return;
		const completedAt = this.dependencies.now();
		const values: Record<string, number | string> = { status, totalMs: completedAt - this.startedAt };
		for (const [phase, duration] of Object.entries(this.phases)) values[`${phase}Ms`] = duration;
		this.dependencies.emit(this.label, values);
		if (status !== 'loaded') return;
		this.dependencies.scheduleFrame(() => {
			if (!this.dependencies.isEnabled() || !isCurrent()) return;
			const frameAt = this.dependencies.now();
			this.dependencies.emit(`${this.label}.next-frame`, {
				totalMs: frameAt - this.startedAt,
				frameWaitMs: frameAt - completedAt,
			});
		});
	}
}
