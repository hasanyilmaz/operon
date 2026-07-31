export type RuntimeTimingFlowV1 = 'read' | 'mutation-preview' | 'mutation-apply';

export type RuntimeTimingSpanNameV1 =
	| 'node-api-load'
	| 'secure-request-consume'
	| 'running-vault-identity'
	| 'settings-refresh'
	| 'pre-read-settlement'
	| 'revision-before'
	| 'projection'
	| 'revision-after'
	| 'drift-retry'
	| 'lock-wait'
	| 'receipt-health'
	| 'receipt-admission-open'
	| 'receipt-admission-probe-snapshot'
	| 'receipt-admission-validate-prune'
	| 'receipt-admission-commit'
	| 'receipt-admission-clone'
	| 'vault-identity'
	| 'receipt-lookup'
	| 'journal-lookup'
	| 'context-revision'
	| 'prepare'
	| 'creation-transaction-prepare'
	| 'journal-acquire'
	| 'commit'
	| 'reindex'
	| 'settlement'
	| 'semantic-postflight'
	| 'receipt-persist'
	| 'receipt-terminal-metadata-journal'
	| 'receipt-terminal-generation-plan'
	| 'receipt-terminal-fallback-scan'
	| 'receipt-terminal-validate-prune'
	| 'receipt-terminal-commit'
	| 'settlement-settings-reindex'
	| 'settlement-ram'
	| 'settlement-index-side-effects-flush'
	| 'settlement-index-side-effects'
	| 'settlement-project-serial-scheduler'
	| 'settlement-project-serial-store'
	| 'settlement-reminder-idle';

export interface RuntimeTimingSpanV1 {
	readonly requestId: string;
	readonly flow: RuntimeTimingFlowV1;
	readonly span: RuntimeTimingSpanNameV1;
	readonly durationMs: number;
	readonly attempt?: number;
}

export interface RuntimeTimingSinkV1 {
	emit(value: RuntimeTimingSpanV1): void;
}

declare const OPERON_AGENT_RUNTIME_PROBE_ENABLED: boolean;

const DEFAULT_TIMING_BUFFER_CAPACITY_V1 = 4_096;
const MAX_TIMING_BUFFER_CAPACITY_V1 = 65_536;

/**
 * Development-only bounded timing storage. Oldest spans are discarded first
 * so an unattended probe cannot grow the plugin heap without limit.
 */
export class RuntimeTimingProbeBufferV1 implements RuntimeTimingSinkV1 {
	private readonly values: RuntimeTimingSpanV1[] = [];

	constructor(
		private readonly capacity = DEFAULT_TIMING_BUFFER_CAPACITY_V1,
	) {
		if (
			!Number.isSafeInteger(capacity)
			|| capacity < 1
			|| capacity > MAX_TIMING_BUFFER_CAPACITY_V1
		) {
			throw new RangeError(
				`Runtime timing buffer capacity must be between 1 and ${MAX_TIMING_BUFFER_CAPACITY_V1}.`,
			);
		}
	}

	emit(value: RuntimeTimingSpanV1): void {
		if (this.values.length === this.capacity) this.values.shift();
		this.values.push(cloneRuntimeTimingSpanV1(value));
	}

	snapshot(): RuntimeTimingSpanV1[] {
		return this.values.map(cloneRuntimeTimingSpanV1);
	}

	drain(): RuntimeTimingSpanV1[] {
		const drained = this.snapshot();
		this.values.length = 0;
		return drained;
	}
}

export function measureRuntimeTimingSpanV1<T>(
	sink: RuntimeTimingSinkV1 | undefined,
	context: Omit<RuntimeTimingSpanV1, 'durationMs'>,
	operation: () => Promise<T> | T,
	now: () => number = defaultRuntimeTimingNowV1,
): Promise<T> | T {
	if (!OPERON_AGENT_RUNTIME_PROBE_ENABLED || !sink) return operation();
	const startedAt = runtimeTimingNowV1(now);
	try {
		const result = operation();
		return Promise.resolve(result).finally(() => {
			emitRuntimeTimingSpanV1(sink, {
				...context,
				durationMs: normalizeDurationMsV1(runtimeTimingNowV1(now) - startedAt),
			});
		});
	} catch (error) {
		emitRuntimeTimingSpanV1(sink, {
			...context,
			durationMs: normalizeDurationMsV1(runtimeTimingNowV1(now) - startedAt),
		});
		throw error;
	}
}

export function emitRuntimeTimingSpanV1(
	sink: RuntimeTimingSinkV1 | undefined,
	value: RuntimeTimingSpanV1,
): void {
	if (!sink) return;
	try {
		sink.emit(cloneRuntimeTimingSpanV1(value));
	} catch {
		// Diagnostics must never affect Runtime read or mutation behavior.
	}
}

export function defaultRuntimeTimingNowV1(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function cloneRuntimeTimingSpanV1(value: RuntimeTimingSpanV1): RuntimeTimingSpanV1 {
	return {
		requestId: value.requestId,
		flow: value.flow,
		span: value.span,
		durationMs: normalizeDurationMsV1(value.durationMs),
		...(value.attempt === undefined ? {} : { attempt: value.attempt }),
	};
}

function normalizeDurationMsV1(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.round(value * 1_000) / 1_000;
}

export function runtimeTimingNowV1(
	now: () => number = defaultRuntimeTimingNowV1,
): number {
	try {
		const value = now();
		return Number.isFinite(value) ? value : 0;
	} catch {
		return 0;
	}
}
