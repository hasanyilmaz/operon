export type TaskSourceModifyReconciliationMode = 'immediate' | 'deferred';

export interface TaskSourceModifyReconcilerOptions<TTimer> {
	readonly suppressionMs: number;
	readonly settleDelayMs?: number;
	readonly now: () => number;
	readonly setTimer: (callback: () => void, delayMs: number) => TTimer;
	readonly clearTimer: (timer: TTimer) => void;
	readonly reconcile: (
		filePath: string,
		mode: TaskSourceModifyReconciliationMode,
	) => Promise<void>;
	readonly onError?: (filePath: string, error: unknown) => void;
}

interface PendingTaskSourceReconciliation<TTimer> {
	readonly timer: TTimer;
	readonly dueAt: number;
}

/**
 * Preserves the short internal-write quiet period without dropping a real
 * source event that happens inside it. Deferred work is coalesced by path and
 * always rechecks an extended suppression deadline before reconciling.
 */
export class TaskSourceModifyReconciler<TTimer> {
	private readonly suppressUntilByPath = new Map<string, number>();
	private readonly pendingByPath = new Map<string, PendingTaskSourceReconciliation<TTimer>>();
	private readonly runningByPath = new Map<string, number>();
	private readonly waitersByPath = new Map<string, Set<() => void>>();
	private destroyed = false;

	constructor(private readonly options: TaskSourceModifyReconcilerOptions<TTimer>) {}

	markInternalWrite(filePath: string): void {
		if (this.destroyed || !filePath) return;
		const until = this.options.now() + Math.max(0, this.options.suppressionMs);
		this.suppressUntilByPath.set(
			filePath,
			Math.max(this.suppressUntilByPath.get(filePath) ?? 0, until),
		);
		if (this.pendingByPath.has(filePath)) this.scheduleDeferred(filePath);
	}

	handleModify(filePath: string): TaskSourceModifyReconciliationMode | null {
		if (this.destroyed || !filePath) return null;
		if (this.getSuppressionRemainingMs(filePath) > 0) {
			this.scheduleDeferred(filePath);
			return 'deferred';
		}
		this.suppressUntilByPath.delete(filePath);
		this.cancelPending(filePath);
		void this.runReconciliation(filePath, 'immediate');
		return 'immediate';
	}

	handleRename(oldPath: string, newPath: string): void {
		if (this.destroyed || !oldPath || !newPath || oldPath === newPath) return;
		const oldSuppression = this.suppressUntilByPath.get(oldPath) ?? 0;
		const newSuppression = this.suppressUntilByPath.get(newPath) ?? 0;
		const hadPending = this.pendingByPath.has(oldPath) || this.pendingByPath.has(newPath);
		this.cancelPending(oldPath);
		this.cancelPending(newPath);
		this.suppressUntilByPath.delete(oldPath);
		if (oldSuppression > 0 || newSuppression > 0) {
			this.suppressUntilByPath.set(newPath, Math.max(oldSuppression, newSuppression));
		}
		if (hadPending) this.scheduleDeferred(newPath);
		this.resolveWaitersIfIdle(oldPath);
	}

	handleDelete(filePath: string): void {
		if (!filePath) return;
		this.cancelPending(filePath);
		this.suppressUntilByPath.delete(filePath);
		this.resolveWaitersIfIdle(filePath);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const pending of this.pendingByPath.values()) {
			this.options.clearTimer(pending.timer);
		}
		this.pendingByPath.clear();
		this.suppressUntilByPath.clear();
		this.runningByPath.clear();
		for (const path of this.waitersByPath.keys()) this.resolveWaitersIfIdle(path);
	}

	/** Join source watcher work already scheduled for committed paths. */
	async awaitReconciliations(filePaths: readonly string[]): Promise<void> {
		const pending: Promise<void>[] = [];
		for (const filePath of new Set(filePaths)) {
			if (!this.pendingByPath.has(filePath) && !this.runningByPath.has(filePath)) continue;
			const waiters = this.waitersByPath.get(filePath) ?? new Set<() => void>();
			this.waitersByPath.set(filePath, waiters);
			pending.push(new Promise<void>(resolve => { waiters.add(resolve); }));
		}
		await Promise.all(pending);
	}

	getSuppressionRemainingMs(filePath: string): number {
		const until = this.suppressUntilByPath.get(filePath) ?? 0;
		return Math.max(0, until - this.options.now());
	}

	private scheduleDeferred(filePath: string): void {
		if (this.destroyed || !filePath) return;
		const settleDelayMs = Math.max(0, this.options.settleDelayMs ?? 0);
		const dueAt = this.options.now() + this.getSuppressionRemainingMs(filePath) + settleDelayMs;
		const current = this.pendingByPath.get(filePath);
		if (current?.dueAt === dueAt) return;
		if (current) this.options.clearTimer(current.timer);
		const timer = this.options.setTimer(() => {
			this.pendingByPath.delete(filePath);
			if (this.destroyed) return;
			if (this.getSuppressionRemainingMs(filePath) > 0) {
				this.scheduleDeferred(filePath);
				return;
			}
			this.suppressUntilByPath.delete(filePath);
			void this.runReconciliation(filePath, 'deferred');
		}, Math.max(0, dueAt - this.options.now()));
		this.pendingByPath.set(filePath, { timer, dueAt });
	}

	private cancelPending(filePath: string): void {
		const pending = this.pendingByPath.get(filePath);
		if (!pending) return;
		this.options.clearTimer(pending.timer);
		this.pendingByPath.delete(filePath);
	}

	private async runReconciliation(
		filePath: string,
		mode: TaskSourceModifyReconciliationMode,
	): Promise<void> {
		this.runningByPath.set(filePath, (this.runningByPath.get(filePath) ?? 0) + 1);
		try {
			await this.options.reconcile(filePath, mode);
		} catch (error) {
			this.options.onError?.(filePath, error);
		} finally {
			const remaining = (this.runningByPath.get(filePath) ?? 1) - 1;
			if (remaining > 0) {
				this.runningByPath.set(filePath, remaining);
			} else {
				this.runningByPath.delete(filePath);
			}
			this.resolveWaitersIfIdle(filePath);
		}
	}

	private resolveWaitersIfIdle(filePath: string): void {
		if (this.pendingByPath.has(filePath) || this.runningByPath.has(filePath)) return;
		const waiters = this.waitersByPath.get(filePath);
		if (!waiters) return;
		this.waitersByPath.delete(filePath);
		for (const resolve of waiters) resolve();
	}
}
