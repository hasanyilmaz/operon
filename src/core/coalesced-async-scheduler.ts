import { clearWindowTimeout, setWindowTimeout } from './dom-compat';

export interface CoalescedAsyncSchedulerOptions {
	delayMs: number;
	maxRetries?: number;
	run: () => Promise<void>;
	onError?: (error: unknown) => void;
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
}

/**
 * Runs async maintenance after a coalescing delay without overlapping work.
 * Requests received during a run collapse into one delayed follow-up pass.
 */
export class CoalescedAsyncScheduler {
	private readonly delayMs: number;
	private readonly maxRetries: number;
	private readonly runTask: () => Promise<void>;
	private readonly onError: ((error: unknown) => void) | null;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private timer: unknown = null;
	private requested = false;
	private running = false;
	private cancelled = false;
	private consecutiveFailures = 0;
	private lastError: unknown = null;
	private flushRequested = false;
	private idleWaiters = new Set<{
		resolve: () => void;
		reject: (error: unknown) => void;
	}>();

	constructor(options: CoalescedAsyncSchedulerOptions) {
		this.delayMs = Math.max(0, options.delayMs);
		this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 0));
		this.runTask = options.run;
		this.onError = options.onError ?? null;
		this.setTimer = options.setTimeout ?? ((callback, delayMs) => setWindowTimeout(callback, delayMs));
		this.clearTimer = options.clearTimeout ?? (handle => clearWindowTimeout(handle as ReturnType<typeof setWindowTimeout>));
	}

	schedule(): void {
		if (this.cancelled) return;
		if (!this.running && this.timer === null && !this.requested) {
			this.consecutiveFailures = 0;
			this.lastError = null;
		}
		this.requested = true;
		if (this.running || this.timer !== null) return;
		this.armTimer();
	}

	cancel(): void {
		this.cancelled = true;
		this.requested = false;
		if (this.timer !== null) {
			this.clearTimer(this.timer);
			this.timer = null;
		}
		this.rejectIdleWaiters(new Error('Coalesced scheduler was cancelled'));
	}

	isIdle(): boolean {
		return !this.requested && !this.running && this.timer === null;
	}

	async whenIdle(): Promise<void> {
		if (this.cancelled) throw new Error('Coalesced scheduler was cancelled');
		if (this.isIdle()) {
			if (this.lastError) throw asError(this.lastError);
			return;
		}
		await new Promise<void>((resolve, reject) => {
			this.idleWaiters.add({ resolve, reject });
		});
	}

	async flushNow(): Promise<void> {
		if (this.cancelled) throw new Error('Coalesced scheduler was cancelled');
		if (this.isIdle()) {
			if (this.lastError) throw asError(this.lastError);
			return;
		}
		this.flushRequested = true;
		if (this.timer !== null) {
			this.clearTimer(this.timer);
			this.timer = null;
		}
		if (!this.running && this.requested) this.armTimer();
		await this.whenIdle();
	}

	private armTimer(): void {
		if (this.cancelled || this.timer !== null || !this.requested) return;
		this.timer = this.setTimer(() => {
			this.timer = null;
			void this.runPending();
		}, this.flushRequested ? 0 : this.delayMs);
	}

	private async runPending(): Promise<void> {
		if (this.cancelled || this.running || !this.requested) return;
		this.running = true;
		this.requested = false;
		try {
			await this.runTask();
			this.consecutiveFailures = 0;
			this.lastError = null;
		} catch (error) {
			this.lastError = error;
			this.onError?.(error);
			this.consecutiveFailures++;
			if (this.consecutiveFailures <= this.maxRetries && !this.cancelled) {
				this.requested = true;
			}
		} finally {
			this.running = false;
			if (this.requested && !this.cancelled) {
				this.armTimer();
			} else if (!this.cancelled) {
				this.flushRequested = false;
				this.settleIdleWaiters();
			}
		}
	}

	private settleIdleWaiters(): void {
		const waiters = [...this.idleWaiters];
		this.idleWaiters.clear();
		for (const waiter of waiters) {
			if (this.lastError) {
				waiter.reject(this.lastError);
			} else {
				waiter.resolve();
			}
		}
	}

	private rejectIdleWaiters(error: unknown): void {
		const waiters = [...this.idleWaiters];
		this.idleWaiters.clear();
		for (const waiter of waiters) waiter.reject(error);
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
