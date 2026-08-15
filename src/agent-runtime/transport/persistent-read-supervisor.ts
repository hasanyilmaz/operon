import type {
	AgentRuntimePersistentReadServerHandleV1,
	PersistentReadDescriptorV1,
} from './persistent-read-server';

const DEFAULT_RESTART_DELAYS_MS_V1 = [250, 1_000, 5_000, 15_000, 60_000] as const;
const DEFAULT_STABLE_RESET_MS_V1 = 60_000;

export type AgentRuntimePersistentReadSupervisorStateV1 =
	| 'idle'
	| 'starting'
	| 'available'
	| 'backoff'
	| 'unavailable'
	| 'closing'
	| 'closed';

export interface AgentRuntimePersistentReadSupervisorSnapshotV1 {
	readonly state: AgentRuntimePersistentReadSupervisorStateV1;
	readonly available: boolean;
	readonly reason?: string;
	readonly consecutiveFailures: number;
	readonly nextRetryAt?: number;
}

export interface AgentRuntimePersistentReadSupervisorOptionsV1 {
	readonly startServer: (
		isCurrent: () => boolean,
	) => Promise<AgentRuntimePersistentReadServerHandleV1>;
	readonly restartDelaysMs?: readonly number[];
	readonly stableResetMs?: number;
	readonly now?: () => number;
	readonly random?: () => number;
	readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimer?: (handle: unknown) => void;
}

export class AgentRuntimePersistentReadSupervisorV1 {
	private state: AgentRuntimePersistentReadSupervisorStateV1 = 'idle';
	private reason: string | undefined;
	private consecutiveFailures = 0;
	private nextRetryAt: number | undefined;
	private lifecycleGeneration = 0;
	private startPromise: Promise<void> | null = null;
	private currentHandle: AgentRuntimePersistentReadServerHandleV1 | null = null;
	private unsubscribeUnavailable: (() => void) | null = null;
	private retryTimer: unknown = null;
	private stableTimer: unknown = null;
	private closePromise: Promise<void> | null = null;
	private readonly restartDelaysMs: readonly number[];
	private readonly stableResetMs: number;
	private readonly now: () => number;
	private readonly random: () => number;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(private readonly options: AgentRuntimePersistentReadSupervisorOptionsV1) {
		this.restartDelaysMs = options.restartDelaysMs?.length
			? [...options.restartDelaysMs]
			: DEFAULT_RESTART_DELAYS_MS_V1;
		this.stableResetMs = Math.max(0, options.stableResetMs ?? DEFAULT_STABLE_RESET_MS_V1);
		this.now = options.now ?? (() => Date.now());
		this.random = options.random ?? (() => Math.random());
		this.setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
		this.clearTimer = options.clearTimer ?? (handle => window.clearTimeout(handle as number));
	}

	snapshot(): AgentRuntimePersistentReadSupervisorSnapshotV1 {
		return {
			state: this.state,
			available: this.state === 'available' && this.currentHandle?.available === true,
			...(this.reason ? { reason: this.reason } : {}),
			consecutiveFailures: this.consecutiveFailures,
			...(this.nextRetryAt !== undefined ? { nextRetryAt: this.nextRetryAt } : {}),
		};
	}

	bootstrapDescriptor(): PersistentReadDescriptorV1 | null {
		if (this.state !== 'available' || this.currentHandle?.available !== true) return null;
		return this.currentHandle.bootstrapDescriptor();
	}

	start(): Promise<void> {
		if (this.state === 'closing' || this.state === 'closed') return Promise.resolve();
		if (this.startPromise) return this.startPromise;
		if (this.state === 'available') return Promise.resolve();
		this.cancelRetryTimer();
		this.state = 'starting';
		this.nextRetryAt = undefined;
		const generation = this.lifecycleGeneration;
		const pending = this.startAttempt(generation);
		this.startPromise = pending;
		void pending.then(
			() => {
				if (this.startPromise === pending) this.startPromise = null;
			},
			() => {
				if (this.startPromise === pending) this.startPromise = null;
			},
		);
		return pending;
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.state = 'closing';
		this.lifecycleGeneration += 1;
		this.cancelRetryTimer();
		this.cancelStableTimer();
		this.unsubscribeUnavailable?.();
		this.unsubscribeUnavailable = null;
		const current = this.currentHandle;
		this.currentHandle = null;
		const pendingStart = this.startPromise;
		const closePromise = (async (): Promise<void> => {
			if (current) await current.close();
			if (pendingStart) await pendingStart.catch(() => undefined);
			this.state = 'closed';
			this.reason = undefined;
			this.nextRetryAt = undefined;
		})();
		this.closePromise = closePromise;
		return closePromise;
	}

	private async startAttempt(generation: number): Promise<void> {
		let handle: AgentRuntimePersistentReadServerHandleV1;
		try {
			handle = await this.options.startServer(() => this.isCurrentGeneration(generation));
		} catch {
			if (!this.isCurrentGeneration(generation)) return;
			this.scheduleRestart('persistent-read-server-start-failed', generation);
			return;
		}
		if (!this.isCurrentGeneration(generation)) {
			await handle.close();
			return;
		}
		if (!handle.available) {
			await handle.close();
			this.scheduleRestart(handle.reason ?? 'persistent-read-server-start-failed', generation);
			return;
		}
		this.currentHandle = handle;
		this.state = 'available';
		this.reason = undefined;
		this.nextRetryAt = undefined;
		this.unsubscribeUnavailable = handle.onUnavailable(reason => {
			void this.handleLateFailure(handle, reason, generation);
		});
		this.armStableReset(generation);
	}

	private async handleLateFailure(
		handle: AgentRuntimePersistentReadServerHandleV1,
		reason: string,
		generation: number,
	): Promise<void> {
		if (!this.isCurrentGeneration(generation) || this.currentHandle !== handle) return;
		this.unsubscribeUnavailable?.();
		this.unsubscribeUnavailable = null;
		this.cancelStableTimer();
		this.currentHandle = null;
		this.reason = sanitizeFailureReasonV1(reason);
		await handle.close();
		if (!this.isCurrentGeneration(generation)) return;
		this.scheduleRestart(reason, generation);
	}

	private scheduleRestart(reason: string, generation: number): void {
		if (!this.isCurrentGeneration(generation)) return;
		this.cancelStableTimer();
		this.reason = sanitizeFailureReasonV1(reason);
		this.consecutiveFailures += 1;
		const delayIndex = this.consecutiveFailures - 1;
		if (delayIndex >= this.restartDelaysMs.length) {
			this.state = 'unavailable';
			this.reason = `persistent-read-restart-exhausted:${this.reason}`;
			this.nextRetryAt = undefined;
			return;
		}
		const baseDelay = Math.max(0, this.restartDelaysMs[delayIndex] ?? 0);
		const jitterFactor = 0.8 + Math.min(1, Math.max(0, this.random())) * 0.4;
		const delayMs = Math.round(baseDelay * jitterFactor);
		this.state = 'backoff';
		this.nextRetryAt = this.now() + delayMs;
		this.retryTimer = this.setTimer(() => {
			this.retryTimer = null;
			if (!this.isCurrentGeneration(generation)) return;
			void this.start();
		}, delayMs);
	}

	private armStableReset(generation: number): void {
		this.cancelStableTimer();
		if (this.stableResetMs === 0) {
			this.consecutiveFailures = 0;
			return;
		}
		this.stableTimer = this.setTimer(() => {
			this.stableTimer = null;
			if (!this.isCurrentGeneration(generation) || this.state !== 'available') return;
			this.consecutiveFailures = 0;
		}, this.stableResetMs);
	}

	private cancelRetryTimer(): void {
		if (this.retryTimer === null) return;
		this.clearTimer(this.retryTimer);
		this.retryTimer = null;
	}

	private cancelStableTimer(): void {
		if (this.stableTimer === null) return;
		this.clearTimer(this.stableTimer);
		this.stableTimer = null;
	}

	private isCurrentGeneration(generation: number): boolean {
		return generation === this.lifecycleGeneration
			&& this.state !== 'closing'
			&& this.state !== 'closed';
	}
}

function sanitizeFailureReasonV1(reason: string): string {
	const normalized = reason.trim().toLowerCase();
	if (/^[a-z0-9][a-z0-9-]{0,95}$/u.test(normalized)) return normalized;
	return 'persistent-read-server-failed';
}
