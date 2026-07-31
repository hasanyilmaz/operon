import { toLocalDatetime } from '../../core/local-time';
import {
	fromDatetimeLocalValue,
	projectTrackerSessionMutation,
	type TrackerSessionProjectionInput,
} from '../../systems/tracker-utils';
import {
	canonicalJsonV1,
	toJsonValueV1,
} from '../contracts/v1/canonical';
import {
	sameTaskSourceLocatorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import type {
	MutationPreviewRequestV1,
	TimerSessionSpecV1,
} from '../contracts/v1/mutation';
import type { StructuredErrorCodeV1 } from '../contracts/v1/primitives';
import { runtimeTaskTargetDigestV1 } from './task-mutation-adapter';

export interface RuntimeTimerSessionSnapshotV1 {
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly sourceContent: string;
	readonly duplicate: boolean;
}

export interface RuntimeTimerSessionPreparationV1 {
	readonly kind: 'timer-session';
	readonly task: RuntimeTimerSessionSnapshotV1;
	readonly sealedSpec: TimerSessionSpecV1;
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly targetDigest: string;
	readonly noChange: boolean;
	readonly aggregateAncestorOperonIds?: readonly string[];
}

export type RuntimeTimerSessionPreparationResultV1 =
	| { ok: true; value: RuntimeTimerSessionPreparationV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export interface RuntimeTimerSessionAdapterPortsV1 {
	getTask(operonId: string): RuntimeTimerSessionSnapshotV1 | null;
	splitSessionsAtMidnight(): boolean;
}

export interface RuntimeTimerSessionPostflightTaskV1 {
	readonly locator: TaskSourceLocatorV1;
	readonly fieldValues: Readonly<Record<string, string>>;
}

export function prepareRuntimeTimerSessionMutationV1(
	request: MutationPreviewRequestV1,
	effectiveAt: string,
	ports: RuntimeTimerSessionAdapterPortsV1,
): RuntimeTimerSessionPreparationResultV1 {
	if (request.mutationKind !== 'timer.session') {
		return failure('mutation-kind-mismatch', 'Expected timer.session.');
	}
	const spec = request.spec as TimerSessionSpecV1;
	if (!request.target) return failure('invalid-request', 'Exact task required.');
	const task = ports.getTask(request.target.operonId);
	if (!task) return failure('entity-not-found', 'Task not found.');
	if (task.duplicate) return failure('duplicate-operon-id', 'Duplicate operonId.');
	if (!sameTaskSourceLocatorV1(task.locator, request.target.locator)) {
		return failure('stale-source', 'Task locator changed.');
	}
	const input = reducedProjectionInput(spec);
	if (!input) return failure('invalid-request', 'Invalid timer session input.');
	const projection = projectTrackerSessionMutation(
		task.fieldValues['trackers'],
		input,
		ports.splitSessionsAtMidnight(),
	);
	if (!projection.ok) return failure('invalid-request', projection.reason);
	const value = projection.value;
	const sealedSpec: TimerSessionSpecV1 = {
		...input,
		expectedTrackers: value.currentTrackers,
		expectedDuration: value.currentDuration,
		...(value.selectedRawIndex === undefined
			? {}
			: {
				selectedRawIndex: value.selectedRawIndex,
				expectedStart: value.selectedStart,
				expectedEnd: value.selectedEnd,
			}),
		nextTrackers: value.nextTrackers,
		nextDuration: value.nextDuration,
		effectiveAt,
	};
	if (
		spec.expectedTrackers !== undefined
		&& canonicalJsonV1(toJsonValueV1(spec)) !== canonicalJsonV1(toJsonValueV1(sealedSpec))
	) return failure('stale-source', 'Tracker state changed.');
	const modifiedAt = toLocalDatetime(new Date(effectiveAt));
	const fieldValues: Record<string, string> = value.noChange
		? {}
		: {
			trackers: value.nextTrackers,
			duration: value.nextDuration > 0 ? String(value.nextDuration) : '',
			datetimeModified: modifiedAt,
		};
	return {
		ok: true,
		value: {
			kind: 'timer-session',
			task,
			sealedSpec,
			fieldValues,
			targetDigest: runtimeTaskTargetDigestV1(task),
			noChange: value.noChange,
		},
	};
}

export function verifyRuntimeTimerSessionPostflightV1(
	preparation: RuntimeTimerSessionPreparationV1,
	getTask: (operonId: string) => RuntimeTimerSessionPostflightTaskV1 | null,
): boolean {
	const task = getTask(preparation.task.operonId);
	if (!task || !sameTaskSourceLocatorV1(task.locator, preparation.task.locator)) return false;
	return (task.fieldValues['trackers'] ?? '').trim() === (preparation.sealedSpec.nextTrackers ?? '')
		&& Number(task.fieldValues['duration'] ?? '0') === preparation.sealedSpec.nextDuration;
}

function reducedProjectionInput(spec: TimerSessionSpecV1): TrackerSessionProjectionInput | null {
	switch (spec.operation) {
		case 'add-session': {
			const start = fromDatetimeLocalValue(spec.start);
			const end = fromDatetimeLocalValue(spec.end);
			return start && end ? { operation: spec.operation, start, end } : null;
		}
		case 'update-session': {
			const start = fromDatetimeLocalValue(spec.start);
			const end = fromDatetimeLocalValue(spec.end);
			return Number.isInteger(spec.sessionNumber) && start && end
				? { operation: spec.operation, sessionNumber: spec.sessionNumber!, start, end }
				: null;
		}
		case 'remove-session':
			return Number.isInteger(spec.sessionNumber)
				? { operation: spec.operation, sessionNumber: spec.sessionNumber! }
				: null;
	}
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): RuntimeTimerSessionPreparationResultV1 {
	return { ok: false, code, reason };
}
