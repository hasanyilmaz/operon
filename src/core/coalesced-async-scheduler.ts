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
	}

	private armTimer(): void {
		if (this.cancelled || this.timer !== null || !this.requested) return;
		this.timer = this.setTimer(() => {
			this.timer = null;
			void this.runPending();
		}, this.delayMs);
	}

	private async runPending(): Promise<void> {
		if (this.cancelled || this.running || !this.requested) return;
		this.running = true;
		this.requested = false;
		try {
			await this.runTask();
			this.consecutiveFailures = 0;
		} catch (error) {
			this.onError?.(error);
			this.consecutiveFailures++;
			if (this.consecutiveFailures <= this.maxRetries && !this.cancelled) {
				this.requested = true;
			}
		} finally {
			this.running = false;
			if (this.requested && !this.cancelled) this.armTimer();
		}
	}
}
