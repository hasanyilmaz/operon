import { structuredErrorV1 } from '../contracts/v1/primitives';
import { RuntimeLifecycleCoordinatorV1 } from './lifecycle';

export class RuntimeSettlementBarrierV1 {
	private active: Promise<void> | null = null;
	private resolveActive: (() => void) | null = null;
	private rejectActive: ((error: unknown) => void) | null = null;
	private releaseLifecycle: (() => void) | null = null;
	private failure: unknown = null;

	constructor(
		private readonly lifecycle: RuntimeLifecycleCoordinatorV1,
		private readonly errorSource: string,
		private readonly publicFailureReason: string,
	) {}

	ensure(): void {
		if (this.active) return;
		this.failure = null;
		this.releaseLifecycle = this.lifecycle.beginSettling();
		this.active = new Promise<void>((resolve, reject) => {
			this.resolveActive = resolve;
			this.rejectActive = reject;
		});
		void this.active.catch(() => {});
	}

	current(): Promise<void> | null {
		return this.active;
	}

	recordFailure(error: unknown): void {
		this.failure ??= error;
	}

	settleIfIdle(idle: boolean): void {
		if (!idle || !this.active) return;
		const failure = this.failure;
		const resolve = this.resolveActive;
		const reject = this.rejectActive;
		this.clear();
		if (failure) {
			this.lifecycle.recordError(structuredErrorV1(
				'live-settling',
				this.publicFailureReason,
				{ retryable: true },
			), this.errorSource);
			reject?.(failure);
			return;
		}
		this.lifecycle.clearError(this.errorSource);
		resolve?.();
	}

	cancel(error: unknown): void {
		if (!this.active) return;
		const reject = this.rejectActive;
		this.clear();
		reject?.(error);
	}

	private clear(): void {
		this.active = null;
		this.resolveActive = null;
		this.rejectActive = null;
		this.failure = null;
		this.releaseLifecycle?.();
		this.releaseLifecycle = null;
	}
}
