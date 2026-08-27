export interface TableTrailingIdleSchedulerDependencies {
	now: () => number;
	schedule: (callback: () => void, delayMs: number) => number;
	cancel: (timerId: number) => void;
}

export type TableTrailingIdleSchedulerTestDependencies = Partial<TableTrailingIdleSchedulerDependencies>;

function createDefaultDependencies(): TableTrailingIdleSchedulerDependencies {
	return {
		now: () => performance.now(),
		schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
		cancel: timerId => window.clearTimeout(timerId),
	};
}

export class TableTrailingIdleScheduler {
	private timerId: number | null = null;
	private lastActivityAt: number | null = null;
	private readonly dependencies: TableTrailingIdleSchedulerDependencies;

	constructor(
		private readonly delayMs: number,
		private readonly callback: () => void,
		dependencies: TableTrailingIdleSchedulerTestDependencies = {},
	) {
		this.dependencies = { ...createDefaultDependencies(), ...dependencies };
	}

	request(): void {
		this.lastActivityAt = this.dependencies.now();
		if (this.timerId !== null) return;
		this.arm(this.normalizedDelayMs());
	}

	cancel(): void {
		if (this.timerId !== null) this.dependencies.cancel(this.timerId);
		this.timerId = null;
		this.lastActivityAt = null;
	}

	private arm(delayMs: number): void {
		this.timerId = this.dependencies.schedule(() => this.handleTimer(), delayMs);
	}

	private handleTimer(): void {
		this.timerId = null;
		const lastActivityAt = this.lastActivityAt;
		if (lastActivityAt === null) return;
		const elapsedMs = this.dependencies.now() - lastActivityAt;
		const delayMs = this.normalizedDelayMs();
		if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
			this.arm(delayMs);
			return;
		}
		const remainingMs = delayMs - elapsedMs;
		if (remainingMs > 0) {
			this.arm(remainingMs);
			return;
		}
		this.lastActivityAt = null;
		this.callback();
	}

	private normalizedDelayMs(): number {
		return Number.isFinite(this.delayMs) ? Math.max(0, this.delayMs) : 0;
	}
}
