import {
	structuredErrorV1,
	type ContractWarningV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';
import { toJsonValueV1 } from '../contracts/v1/canonical';
import { RuntimeLifecycleCoordinatorV1 } from './lifecycle';
import {
	cloneRuntimeRevisionV1,
	equalRuntimeRevisionV1,
} from './revision';
import { measureRuntimeTimingSpanV1 } from './timing-probe';

declare const OPERON_AGENT_RUNTIME_PROBE_ENABLED: boolean;
import type {
	RuntimeReadPortsV1,
	RuntimeReadRequestV1,
	RuntimeReadResultV1,
	RuntimeReadTimingPortsV1,
	RuntimeRevisionSnapshotV1,
} from './types';

export class SingleFlightRuntimeBarrierV1 {
	private active: Promise<void> | null = null;

	run(operation: () => Promise<void>): Promise<void> {
		if (this.active) return this.active;
		const run = operation();
		let active: Promise<void>;
		active = run.then(
			() => {
				if (this.active === active) this.active = null;
			},
			error => {
				if (this.active === active) this.active = null;
				throw error;
			},
		);
		this.active = active;
		return active;
	}
}

export class RuntimeCoherentReadCoordinatorV1 {
	private readonly refreshBarrier = new SingleFlightRuntimeBarrierV1();
	private readonly settleBarrier = new SingleFlightRuntimeBarrierV1();

	constructor(
		private readonly lifecycle: RuntimeLifecycleCoordinatorV1,
		private readonly ports: RuntimeReadPortsV1,
	) {}

	async execute<T>(request: RuntimeReadRequestV1<T>): Promise<RuntimeReadResultV1<T>> {
		const boundary = new RuntimeReadBoundaryV1(
			request.deadlineAtMs,
			request.signal,
			this.ports,
		);
		const boundaryError = boundary.check();
		if (boundaryError) {
			return {
				ok: false,
				error: boundaryError,
				warnings: [],
				attempts: 0,
			};
		}
		const initialAdmission = this.lifecycle.admitRead(request.minimumConsistency);
		const maySettleVerifiedRead = request.minimumConsistency === 'live-verified'
			&& initialAdmission.error?.retryable === true
			&& this.lifecycle.isReadAvailable();
		if (!initialAdmission.ok && !maySettleVerifiedRead) {
			return {
				ok: false,
				error: initialAdmission.error!,
				warnings: initialAdmission.warnings,
				attempts: 0,
			};
		}
		const admission = maySettleVerifiedRead
			? { ok: true as const, warnings: [] }
			: initialAdmission;
		let admissionWarnings = [...admission.warnings];

		try {
			await this.measure(request, 'settings-refresh', undefined, () => (
				boundary.wait(this.refreshBarrier.run(() => this.ports.refreshSettings()))
			));
			if (request.minimumConsistency === 'live-verified') {
				await this.measure(request, 'pre-read-settlement', undefined, () => (
					boundary.wait(this.settleBarrier.run(() => this.ports.settle(request.requestId)))
				));
				const settledAdmission = this.lifecycle.admitRead(request.minimumConsistency);
				if (!settledAdmission.ok) {
					return {
						ok: false,
						error: settledAdmission.error!,
						warnings: mergeWarnings(admissionWarnings, settledAdmission.warnings),
						attempts: 0,
					};
				}
				admissionWarnings = mergeWarnings(admissionWarnings, settledAdmission.warnings);
			} else {
				const refreshedAdmission = this.lifecycle.admitRead(request.minimumConsistency);
				if (!refreshedAdmission.ok) {
					return {
						ok: false,
						error: refreshedAdmission.error!,
						warnings: mergeWarnings(admissionWarnings, refreshedAdmission.warnings),
						attempts: 0,
					};
				}
				admissionWarnings = mergeWarnings(admissionWarnings, refreshedAdmission.warnings);
			}
		} catch (error) {
			return runtimeFailure(error, admissionWarnings, 0);
		}

		let first;
		try {
			first = await this.runAttempt(request, boundary, 1);
		} catch (error) {
			return runtimeFailure(error, admissionWarnings, 0);
		}
		const firstPostAdmission = this.lifecycle.admitRead(request.minimumConsistency);
		admissionWarnings = mergeWarnings(admissionWarnings, firstPostAdmission.warnings);
		if (first.stable && firstPostAdmission.ok) {
			return {
				ok: true,
				value: first.value,
				revision: cloneRuntimeRevisionV1(first.after),
				warnings: admissionWarnings,
				attempts: 1,
			};
		}

		if (request.minimumConsistency === 'best-effort') {
			if (!firstPostAdmission.ok) {
				return {
					ok: false,
					error: firstPostAdmission.error!,
					revision: cloneRuntimeRevisionV1(first.after),
					warnings: admissionWarnings,
					attempts: 1,
				};
			}
			return {
				ok: true,
				value: first.value,
				revision: cloneRuntimeRevisionV1(first.after),
				warnings: mergeWarnings(admissionWarnings, [revisionDriftWarning()]),
				attempts: 1,
			};
		}

		try {
			const second = await this.measure(request, 'drift-retry', 2, async () => {
				await boundary.wait(this.settleBarrier.run(() => this.ports.settle(request.requestId)));
				const retryAdmission = this.lifecycle.admitRead(request.minimumConsistency);
				admissionWarnings = mergeWarnings(admissionWarnings, retryAdmission.warnings);
				if (!retryAdmission.ok) throw new RuntimeRetryAdmissionErrorV1(retryAdmission.error!);
				return await this.runAttempt(request, boundary, 2);
			});
			const secondPostAdmission = this.lifecycle.admitRead(request.minimumConsistency);
			admissionWarnings = mergeWarnings(admissionWarnings, secondPostAdmission.warnings);
			if (second.stable && secondPostAdmission.ok) {
				return {
					ok: true,
					value: second.value,
					revision: cloneRuntimeRevisionV1(second.after),
					warnings: admissionWarnings,
					attempts: 2,
				};
			}
			return {
				ok: false,
				error: liveSettlingError(),
				revision: cloneRuntimeRevisionV1(second.after),
				warnings: mergeWarnings(admissionWarnings, [revisionDriftWarning()]),
				attempts: 2,
			};
		} catch (error) {
			if (error instanceof RuntimeRetryAdmissionErrorV1) {
				return {
					ok: false,
					error: error.structuredError,
					revision: cloneRuntimeRevisionV1(first.after),
					warnings: admissionWarnings,
					attempts: 1,
				};
			}
			return runtimeFailure(error, admissionWarnings, 1);
		}
	}

	private async runAttempt<T>(
		request: RuntimeReadRequestV1<T>,
		boundary: RuntimeReadBoundaryV1,
		attempt: 1 | 2,
	): Promise<{
		before: RuntimeRevisionSnapshotV1;
		after: RuntimeRevisionSnapshotV1;
		value: T;
		stable: boolean;
	}> {
		const before = cloneRuntimeRevisionV1(await this.measure(
			request,
			'revision-before',
			attempt,
			() => boundary.wait(Promise.resolve(this.ports.sampleRevision(request.signal))),
		));
		const projected = await this.measure(
			request,
			'projection',
			attempt,
			() => boundary.wait(request.read(before, request.signal)),
		);
		const value = cloneRuntimeValueV1(projected);
		const after = cloneRuntimeRevisionV1(await this.measure(
			request,
			'revision-after',
			attempt,
			() => boundary.wait(Promise.resolve(this.ports.sampleRevision(request.signal))),
		));
		return {
			before,
			after,
			value,
			stable: request.isRevisionStable
				? request.isRevisionStable(before, after)
				: equalRuntimeRevisionV1(before, after),
		};
	}

	private measure<T>(
		request: RuntimeReadRequestV1<unknown>,
		span: 'settings-refresh'
			| 'pre-read-settlement'
			| 'revision-before'
			| 'projection'
			| 'revision-after'
			| 'drift-retry',
		attempt: number | undefined,
		operation: () => Promise<T> | T,
	): Promise<T> | T {
		const sink = request.requestId ? this.ports.timingSink : undefined;
		if (!OPERON_AGENT_RUNTIME_PROBE_ENABLED || !sink) return operation();
		return measureRuntimeTimingSpanV1(
			sink,
			{
				requestId: request.requestId ?? 'unlinked-read',
				flow: 'read',
				span,
				...(attempt === undefined ? {} : { attempt }),
			},
			operation,
			this.ports.timingNow,
		);
	}
}

class RuntimeRetryAdmissionErrorV1 extends Error {
	constructor(readonly structuredError: StructuredErrorV1) {
		super(structuredError.reason);
	}
}

function runtimeFailure(
	error: unknown,
	warnings: ContractWarningV1[],
	attempts: 0 | 1,
): RuntimeReadResultV1<never> {
	const boundaryError = error instanceof RuntimeReadBoundaryError ? error.structuredError : null;
	return {
		ok: false,
		error: boundaryError ?? structuredErrorV1(
			'internal-error',
			'Runtime freshness coordination failed.',
			{ retryable: false },
		),
		warnings,
		attempts,
	};
}

function cloneRuntimeValueV1<T>(value: T): T {
	return toJsonValueV1(value) as unknown as T;
}

function mergeWarnings(
	...groups: readonly ContractWarningV1[][]
): ContractWarningV1[] {
	const seen = new Set<string>();
	const merged: ContractWarningV1[] = [];
	for (const warning of groups.flat()) {
		const key = `${warning.code}\u0000${warning.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push({ ...warning });
	}
	return merged;
}

class RuntimeReadBoundaryV1 {
	constructor(
		private readonly deadlineAtMs: number | undefined,
		private readonly signal: AbortSignal | undefined,
		private readonly timing: RuntimeReadTimingPortsV1,
	) {}

	check(): StructuredErrorV1 | null {
		if (this.signal?.aborted) return abortedError();
		if (
			this.deadlineAtMs !== undefined
			&& (!Number.isFinite(this.deadlineAtMs) || this.deadlineAtMs <= this.timing.now())
		) {
			return deadlineError();
		}
		return null;
	}

	async wait<T>(operation: Promise<T>): Promise<T> {
		const currentError = this.check();
		if (currentError) throw new RuntimeReadBoundaryError(currentError);

		let timer: unknown;
		let timerSet = false;
		let abortListener: (() => void) | undefined;
		const boundary = new Promise<never>((_resolve, reject) => {
			if (this.deadlineAtMs !== undefined) {
				const remainingMs = Math.max(0, this.deadlineAtMs - this.timing.now());
				timer = this.timing.setTimer(
					() => reject(new RuntimeReadBoundaryError(deadlineError())),
					remainingMs,
				);
				timerSet = true;
			}
			if (this.signal) {
				abortListener = () => reject(new RuntimeReadBoundaryError(abortedError()));
				this.signal.addEventListener('abort', abortListener, { once: true });
			}
		});
		try {
			return await Promise.race([operation, boundary]);
		} finally {
			if (timerSet) this.timing.clearTimer(timer);
			if (this.signal && abortListener) this.signal.removeEventListener('abort', abortListener);
		}
	}
}

class RuntimeReadBoundaryError extends Error {
	constructor(readonly structuredError: StructuredErrorV1) {
		super(structuredError.reason);
	}
}

function deadlineError(): StructuredErrorV1 {
	return structuredErrorV1(
		'live-settling',
		'The coherent-read deadline elapsed before a verified result was available.',
	);
}

function abortedError(): StructuredErrorV1 {
	return structuredErrorV1('invalid-request', 'The coherent read was cancelled by the caller.');
}


function liveSettlingError(): StructuredErrorV1 {
	return structuredErrorV1('live-settling', 'Runtime state changed during both coherent-read attempts.');
}

function revisionDriftWarning(): ContractWarningV1 {
	return {
		code: 'runtime-revision-drift',
		message: 'A Runtime component revision changed while the result was being built.',
	};
}
