import {
	normalizeStructuredErrorV1,
	structuredErrorV1,
	type ConsistencyV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import { RUNTIME_RETRY_AFTER_MAX_MS_V1 } from '../contracts/v1/lifecycle';
import type {
	RuntimeAdmissionV1,
	RuntimeLifecyclePhaseV1,
} from './types';

const DEFAULT_BOOTING_RETRY_AFTER_MS = 250;
const DEFAULT_SETTLING_RETRY_AFTER_MS = 500;

export interface RuntimeLifecycleOptionsV1 {
	bootingRetryAfterMs?: number;
	settlingRetryAfterMs?: number;
}

export interface RuntimeSettlementOptionsV1 {
	preservesBestEffortCache?: boolean;
}

export class RuntimeLifecycleCoordinatorV1 {
	private phase: RuntimeLifecyclePhaseV1 = 'booting';
	private cacheReady = false;
	private startupReady = false;
	private settlementSequence = 0;
	private readonly settlements = new Map<number, RuntimeSettlementOptionsV1>();
	private readonly errors = new Map<string, StructuredErrorV1>();
	private readonly bootingRetryAfterMs: number;
	private readonly settlingRetryAfterMs: number;

	constructor(options: RuntimeLifecycleOptionsV1 = {}) {
		this.bootingRetryAfterMs = clampRetryAfterMs(
			options.bootingRetryAfterMs,
			DEFAULT_BOOTING_RETRY_AFTER_MS,
		);
		this.settlingRetryAfterMs = clampRetryAfterMs(
			options.settlingRetryAfterMs,
			DEFAULT_SETTLING_RETRY_AFTER_MS,
		);
	}

	getPhase(): RuntimeLifecyclePhaseV1 {
		return this.phase;
	}

	getRetryAfterMs(): number | undefined {
		if (this.getLastError()?.retryable === false) return undefined;
		if (this.phase === 'booting') return this.bootingRetryAfterMs;
		if (this.phase === 'cache-ready' || this.phase === 'settling') return this.settlingRetryAfterMs;
		return undefined;
	}

	getLastError(): StructuredErrorV1 | undefined {
		const all = [...this.errors.values()];
		const error = all.find(candidate => candidate.retryable === false) ?? all[0];
		return error ? cloneError(error) : undefined;
	}

	hasError(source: string): boolean {
		return this.errors.has(source);
	}

	markCacheReady(): void {
		if (this.phase === 'unloading') return;
		this.cacheReady = true;
		if (!this.startupReady) {
			this.phase = this.errors.size > 0 || this.hasBlockingBestEffortSettlement()
				? 'settling'
				: 'cache-ready';
		}
	}

	markReady(): void {
		if (this.phase === 'unloading') return;
		if (!this.startupReady && this.settlements.size === 0) {
			this.recordError(structuredErrorV1(
				'internal-error',
				'Runtime ready was requested without an active startup settlement.',
			), 'lifecycle-transition');
			return;
		}
		this.cacheReady = true;
		this.startupReady = true;
		this.phase = this.settlements.size > 0 || this.errors.size > 0 ? 'settling' : 'ready';
	}

	beginSettling(options: RuntimeSettlementOptionsV1 = {}): () => void {
		if (this.phase === 'unloading') return () => undefined;
		const token = ++this.settlementSequence;
		this.settlements.set(token, { ...options });
		if (this.cacheReady && (this.startupReady || this.hasBlockingBestEffortSettlement())) {
			this.phase = 'settling';
		}
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.settlements.delete(token);
			this.resolveSettledPhase();
		};
	}

	recordError(error: StructuredErrorV1, source = 'runtime'): void {
		if (this.phase === 'unloading') return;
		this.errors.set(source, cloneError(error));
		if (this.cacheReady || this.startupReady) this.phase = 'settling';
	}

	clearError(source = 'runtime'): void {
		if (this.phase === 'unloading') return;
		this.errors.delete(source);
		this.resolveSettledPhase();
	}

	beginUnloading(): void {
		this.phase = 'unloading';
		this.settlements.clear();
	}

	isReadAvailable(): boolean {
		return this.phase === 'cache-ready' || this.phase === 'settling' || this.phase === 'ready';
	}

	isWriteAvailable(): boolean {
		return this.phase === 'ready' && this.errors.size === 0;
	}

	admitRead(minimumConsistency: ConsistencyV1): RuntimeAdmissionV1 {
		if (minimumConsistency === 'offline-unverified') {
			return reject(
				'invalid-request',
				'The live Runtime does not satisfy offline-unverified consistency requests.',
				false,
			);
		}
		if (this.phase === 'unloading') {
			return reject('capability-unavailable', 'Runtime admission is closed because Operon is unloading.', false);
		}
		if (this.phase === 'booting') {
			return reject('capability-unavailable', 'Runtime is still booting.', true);
		}
		const currentError = this.getLastError();
		if (minimumConsistency === 'live-verified' && currentError) {
			return {
				ok: false,
				warnings: [],
				error: currentError,
			};
		}
		if (minimumConsistency === 'live-verified' && this.phase !== 'ready') {
			return reject('live-settling', 'Runtime has not reached a verified settled state.', true);
		}
		if (minimumConsistency === 'best-effort' && this.phase === 'settling') {
			if (
				this.cacheReady
				&& !currentError
				&& !this.hasBlockingBestEffortSettlement()
			) {
				return {
					ok: true,
					warnings: [{
						code: 'runtime-not-settled',
						message: 'The caller explicitly allowed a coherent cached result while startup reconciliation continues.',
					}],
				};
			}
			return reject(
				'live-settling',
				'Runtime cannot prove a coherent best-effort snapshot while semantic settlement is active.',
				true,
			);
		}
		if (minimumConsistency === 'best-effort' && (this.phase !== 'ready' || currentError)) {
			return {
				ok: true,
				warnings: [{
					code: 'runtime-not-settled',
					message: 'The caller explicitly allowed a best-effort result while Runtime state is not settled.',
				}],
			};
		}
		return { ok: true, warnings: [] };
	}

	admitWrite(): RuntimeAdmissionV1 {
		if (this.phase === 'ready' && this.errors.size === 0) return { ok: true, warnings: [] };
		if (this.phase === 'unloading') {
			return reject('capability-unavailable', 'Runtime admission is closed because Operon is unloading.', false);
		}
		const currentError = this.getLastError();
		if (currentError) {
			return {
				ok: false,
				warnings: [],
				error: currentError,
			};
		}
		return reject('live-settling', 'Runtime writes require the ready lifecycle phase.', true);
	}

	private resolveSettledPhase(): void {
		if (this.phase === 'unloading') return;
		if (this.settlements.size > 0) {
			if (
				!this.startupReady
				&& this.cacheReady
				&& this.errors.size === 0
				&& !this.hasBlockingBestEffortSettlement()
			) {
				this.phase = 'cache-ready';
			}
			return;
		}
		if (this.errors.size > 0) {
			this.phase = this.cacheReady || this.startupReady ? 'settling' : 'booting';
			return;
		}
		if (this.startupReady) {
			this.phase = 'ready';
		} else if (this.cacheReady) {
			this.phase = 'cache-ready';
		} else {
			this.phase = 'booting';
		}
	}

	private hasBlockingBestEffortSettlement(): boolean {
		for (const settlement of this.settlements.values()) {
			if (settlement.preservesBestEffortCache !== true) return true;
		}
		return false;
	}
}

function clampRetryAfterMs(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(Math.floor(value), RUNTIME_RETRY_AFTER_MAX_MS_V1));
}

function reject(
	code: StructuredErrorV1['code'],
	reason: string,
	retryable: boolean,
): RuntimeAdmissionV1 {
	return {
		ok: false,
		warnings: [],
		error: structuredErrorV1(code, reason, { retryable }),
	};
}

function cloneError(error: StructuredErrorV1): StructuredErrorV1 {
	return normalizeStructuredErrorV1(error);
}
