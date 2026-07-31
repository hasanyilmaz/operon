export interface IndexV8MaintenanceSchedulerOptions<THandle> {
	run: () => Promise<IndexV8MaintenanceRunResult>;
	isActive: () => boolean;
	setTimeout: (callback: () => void, delayMs: number) => THandle;
	clearTimeout: (handle: THandle) => void;
	onError: (error: unknown) => void;
}

export type IndexV8MaintenanceRunResult = 'complete' | 'backlog' | 'restart-quiet';

export interface IndexV8MaintenanceHandle {
	/** Restart the 30-second quiet window after index or manifest activity. */
	request(): void;
	cancel(): void;
	drain(): Promise<void>;
}

const QUIET_WINDOW_MS = 30_000;
const BATCH_YIELD_MS = 250;
const BACKLOG_CONTINUATION_MS = 1_000;
const FAILURE_RETRY_MS = 15_000;
const MAX_BATCHES_PER_ACTIVATION = 8;

/** Schedule coalesced, bounded active-snapshot maintenance outside the commit path. */
export function startIndexV8CleanupMaintenance<THandle>(
	options: IndexV8MaintenanceSchedulerOptions<THandle>,
): IndexV8MaintenanceHandle {
	let cancelled = false;
	let handle: THandle | null = null;
	let activeRun: Promise<void> = Promise.resolve();
	let running = false;
	let requestPending = false;
	let resolveWait: (() => void) | null = null;

	const clearScheduled = (): void => {
		if (handle !== null) options.clearTimeout(handle);
		handle = null;
		resolveWait?.();
		resolveWait = null;
	};
	const wait = async (delayMs: number): Promise<void> => {
		await new Promise<void>(resolve => {
			resolveWait = resolve;
			handle = options.setTimeout(() => {
				handle = null;
				resolveWait = null;
				resolve();
			}, delayMs);
		});
	};
	const schedule = (delayMs: number): void => {
		clearScheduled();
		handle = options.setTimeout(() => {
			handle = null;
			activeRun = (async () => {
				running = true;
				let result: IndexV8MaintenanceRunResult = 'complete';
				try {
					for (let batch = 0; batch < MAX_BATCHES_PER_ACTIVATION; batch += 1) {
						if (cancelled || !options.isActive() || requestPending) break;
						result = await options.run();
						if (result !== 'backlog' || requestPending) break;
						if (batch < MAX_BATCHES_PER_ACTIVATION - 1) await wait(BATCH_YIELD_MS);
					}
				} catch (error) {
					options.onError(error);
					if (!cancelled && options.isActive()) schedule(FAILURE_RETRY_MS);
					return;
				} finally {
					running = false;
				}
				if (cancelled || !options.isActive()) return;
				if (requestPending || result === 'restart-quiet') {
					requestPending = false;
					schedule(QUIET_WINDOW_MS);
				} else if (result === 'backlog') {
					schedule(BACKLOG_CONTINUATION_MS);
				}
			})();
		}, delayMs);
	};
	const request = (): void => {
		if (cancelled) return;
		if (running) {
			requestPending = true;
			return;
		}
		schedule(QUIET_WINDOW_MS);
	};
	request();
	return {
		request,
		cancel: () => {
			cancelled = true;
			clearScheduled();
		},
		drain: async () => { await activeRun; },
	};
}
