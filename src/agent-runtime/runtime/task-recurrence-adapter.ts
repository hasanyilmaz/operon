import {
	canonicalJsonV1,
	sha256HexV1,
	toJsonValueV1,
} from '../contracts/v1/canonical';
import {
	sameTaskSourceLocatorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import type {
	MutationPreviewRequestV1,
	RecurrenceExpectedStateV1,
	RecurrenceUpdateItemV1,
	UpdateTaskRecurrenceSpecV1,
} from '../contracts/v1/mutation';
import type { StructuredErrorCodeV1 } from '../contracts/v1/primitives';
import { normalizeTaskFieldPatch } from '../../core/task-field-patch';
import { parseRepeatRule } from '../../core/repeat-rule';
import {
	buildFollowingOverride,
	buildRepeatTemporalSnapshotFromFieldValues,
	hasRepeatTemporalChange,
	reanchorRepeatTemporalSnapshotToScheduledDate,
} from '../../systems/recurrence-edit-scope';
import { resolveRepeatTemporalAnchor } from '../../systems/recurrence-domain';
import type { RepeatFollowingOverride, RepeatSeriesEntry } from '../../storage/repeat-series-store';
import { canonicalizeLocalDatetime, toLocalDatetime } from '../../core/local-time';
import { runtimeTaskTargetDigestV1 } from './task-mutation-adapter';

const RECURRENCE_FIELDS = [
	'repeat',
	'datetimeRepeatEnd',
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
] as const;
const RECURRENCE_DATETIME_FIELDS = new Set([
	'datetimeRepeatEnd',
	'datetimeStart',
	'datetimeEnd',
]);
const TEMPORAL_FIELDS = new Set([
	'dateScheduled',
	'dateStarted',
	'dateDue',
	'datetimeStart',
	'datetimeEnd',
	'estimate',
]);

export interface RuntimeTaskRecurrenceSnapshotV1 {
	readonly operonId: string;
	readonly locator: TaskSourceLocatorV1;
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly sourceContent: string;
	readonly duplicate: boolean;
}

export interface RuntimeTaskRecurrencePreparationV1 {
	readonly kind: 'task-recurrence';
	readonly task: RuntimeTaskRecurrenceSnapshotV1;
	readonly sealedSpec: UpdateTaskRecurrenceSpecV1;
	/** Minimal canonical task-source patch, including datetimeModified. */
	readonly fieldValues: Readonly<Record<string, string>>;
	readonly sourceRevision: string;
	readonly targetDigest: string;
	readonly noChange: boolean;
	readonly summary: string;
	readonly followingOverride?: RepeatFollowingOverride;
	readonly repeatSeriesId?: string;
	readonly seriesBefore?: RepeatSeriesEntry | null;
	readonly seriesAfter?: RepeatSeriesEntry | null;
	readonly aggregateAncestorOperonIds?: readonly string[];
}

export type RuntimeTaskRecurrencePreparationResultV1 =
	| { ok: true; value: RuntimeTaskRecurrencePreparationV1 }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
		retryable?: boolean;
	};

export interface RuntimeTaskRecurrenceAdapterPortsV1 {
	getTask(operonId: string): RuntimeTaskRecurrenceSnapshotV1 | null;
	getAllRepeatSeriesIds(): ReadonlySet<string>;
	getRepeatSkipDates?(repeatSeriesId: string): readonly string[];
}

export interface RuntimeTaskRecurrencePostflightTaskV1 {
	readonly locator: TaskSourceLocatorV1;
	readonly fieldValues: Readonly<Record<string, string>>;
}

export function prepareRuntimeTaskRecurrenceMutationV1(
	request: MutationPreviewRequestV1,
	effectiveAt: string,
	ports: RuntimeTaskRecurrenceAdapterPortsV1,
): RuntimeTaskRecurrencePreparationResultV1 {
	if (
		request.mutationKind !== 'task.recurrence'
		|| request.spec.operation !== 'update-recurrence'
	) {
		return failure('mutation-kind-mismatch', 'Recurrence mutation expected.');
	}
	if (!request.target) return failure('invalid-request', 'Recurrence mutation requires an exact task.');
	const task = ports.getTask(request.target.operonId);
	if (!task) return failure('entity-not-found', 'The exact Operon task does not exist.');
	if (task.duplicate) return failure('duplicate-operon-id', 'Duplicate operonId instances block recurrence mutation.');
	if (!sameTaskSourceLocatorV1(task.locator, request.target.locator)) {
		return failure('stale-source', 'The exact task locator changed before recurrence preview.');
	}
	const specError = validateRecurrenceSpec(request.spec);
	if (specError) return failure('invalid-request', specError);

	const expected = buildExpectedState(task.fieldValues);
	if (request.spec.expected && !sameExpectedState(request.spec.expected, expected)) {
		return failure('stale-source', 'The expected recurrence state changed.');
	}
	for (const change of request.spec.changes) {
		if (
			change.expectedValue !== undefined
			&& !sameExpectedValue(change, task.fieldValues[change.field])
		) {
			return failure('stale-source', `The expected recurrence field changed: ${change.field}.`);
		}
	}

	const currentRule = parseRepeatRule(task.fieldValues['repeat']);
	const currentSeriesId = normalizeSeriesId(task.fieldValues['repeatSeriesId']);
	const currentOccurrenceDate = normalizeDate(task.fieldValues['repeatOccurrenceDate']);
	if (currentRule && (!currentSeriesId || !currentOccurrenceDate)) {
		return failure('invalid-request', 'The recurring task has incomplete series identity.');
	}
	if (request.spec.scope === 'this-task' && !currentRule) {
		return failure('invalid-request', 'This-task scope requires an existing recurring task.');
	}

	const payload = buildPayload(request.spec.changes);
	const requestedRepeat = Object.prototype.hasOwnProperty.call(payload, 'repeat')
		? payload['repeat']
		: task.fieldValues['repeat'] ?? '';
	const requestedRule = parseRepeatRule(requestedRepeat);
	if (requestedRepeat.trim() && !requestedRule) {
		return failure('invalid-request', 'The repeat value is not a valid normalized Operon recurrence rule.');
	}
	if (payload['datetimeRepeatEnd'] && !requestedRule) {
		return failure('invalid-request', 'datetimeRepeatEnd requires an active repeat rule.');
	}

	if (!currentRule && requestedRule) {
		const existingSeriesIds = ports.getAllRepeatSeriesIds();
		const seriesId = allocateRepeatSeriesId(request, existingSeriesIds);
		if (!seriesId) {
			return failure('invalid-request', 'The Runtime could not allocate a unique canonical repeatSeriesId.');
		}
		const merged = { ...task.fieldValues, ...payload };
		const occurrenceDate = resolveRepeatTemporalAnchor(requestedRule, merged);
		if (!occurrenceDate) {
			return failure('invalid-request', 'Starting recurrence requires a temporal anchor.');
		}
		payload['repeatSeriesId'] = seriesId;
		payload['repeatOccurrenceDate'] = occurrenceDate;
	}

	let fieldValues = normalizeTaskFieldPatch(
		{ ...task.fieldValues },
		payload,
		{
			getAllRepeatSeriesIds: () => new Set(ports.getAllRepeatSeriesIds()),
			getRepeatSkipDates: seriesId => [...(ports.getRepeatSkipDates?.(seriesId) ?? [])],
		},
	);
	let followingOverride: RepeatFollowingOverride | undefined;
	if (
		request.spec.scope === 'this-and-following'
		&& currentRule
		&& requestedRule
		&& request.spec.changes.some(change => TEMPORAL_FIELDS.has(change.field))
	) {
		const beforeSnapshot = buildRepeatTemporalSnapshotFromFieldValues(
			currentOccurrenceDate,
			{ ...task.fieldValues },
		);
		const afterFields = applyPatch(task.fieldValues, fieldValues);
		const afterSnapshot = buildRepeatTemporalSnapshotFromFieldValues(
			currentOccurrenceDate,
			afterFields,
		);
		if (!beforeSnapshot || !afterSnapshot) {
			return failure('invalid-request', 'Following recurrence edits require a complete temporal snapshot.');
		}
		if (hasRepeatTemporalChange(beforeSnapshot, afterSnapshot)) {
			const reanchored = reanchorRepeatTemporalSnapshotToScheduledDate(afterSnapshot);
			fieldValues = {
				...fieldValues,
				repeatOccurrenceDate: reanchored.occurrenceDate,
			};
			followingOverride = buildFollowingOverride(reanchored, toLocalDatetime(new Date(effectiveAt)));
		}
	}

	const changed = hasPatchChange(task.fieldValues, fieldValues);
	if (changed) {
		fieldValues = {
			...fieldValues,
			datetimeModified: toLocalDatetime(new Date(effectiveAt)),
		};
	}
	const sealedSpec: UpdateTaskRecurrenceSpecV1 = {
		operation: 'update-recurrence',
		scope: request.spec.scope,
		changes: request.spec.changes.map(change => sealChange(change, task.fieldValues[change.field])),
		expected,
	};
	const sourceRevision = sha256HexV1(task.sourceContent);
	return {
		ok: true,
		value: {
			kind: 'task-recurrence',
			task,
			sealedSpec,
			fieldValues: changed ? fieldValues : {},
			sourceRevision,
			targetDigest: runtimeTaskTargetDigestV1(task),
			noChange: !changed && !followingOverride,
			summary: request.spec.scope === 'this-task'
				? 'Update recurrence fields for this task only.'
				: 'Update recurrence fields for this task and following occurrences.',
			...(followingOverride ? { followingOverride } : {}),
		},
	};
}

function allocateRepeatSeriesId(
	request: MutationPreviewRequestV1,
	existingIds: ReadonlySet<string>,
): string {
	const seed = [
		request.idempotencyKey,
		request.target?.operonId ?? '',
		request.correlationId ?? request.requestId,
	].join('\0');
	for (let attempt = 0; attempt < 100; attempt++) {
		const candidate = `rs${sha256HexV1(`${seed}\0${attempt}`).slice(0, 5)}`;
		if (!existingIds.has(candidate)) return candidate;
	}
	return '';
}

export function verifyRuntimeTaskRecurrencePostflightV1(
	preparation: RuntimeTaskRecurrencePreparationV1,
	getTask: (operonId: string) => RuntimeTaskRecurrencePostflightTaskV1 | null,
	getFollowingOverride?: (
		seriesId: string,
		effectiveFrom: string,
	) => RepeatFollowingOverride | null,
): boolean {
	const task = getTask(preparation.task.operonId);
	if (!task || !sameTaskSourceLocatorV1(task.locator, preparation.task.locator)) return false;
	for (const [field, value] of Object.entries(preparation.fieldValues)) {
		if (field === 'datetimeModified') {
			if (!task.fieldValues[field]) return false;
			continue;
		}
		if ((task.fieldValues[field] ?? '') !== value) return false;
	}
	if (!preparation.followingOverride) return true;
	const seriesId = preparation.followingOverride
		? normalizeSeriesId(task.fieldValues['repeatSeriesId'])
		: '';
	if (!seriesId || !getFollowingOverride) return false;
	const observed = getFollowingOverride(seriesId, preparation.followingOverride.effectiveFrom);
	return !!observed && canonicalJsonV1(toJsonValueV1(observed))
		=== canonicalJsonV1(toJsonValueV1(preparation.followingOverride));
}

function validateRecurrenceSpec(spec: UpdateTaskRecurrenceSpecV1): string | null {
	if (spec.changes.length === 0 || spec.changes.length > RECURRENCE_FIELDS.length) {
		return 'Recurrence update requires one to eight field changes.';
	}
	const seen = new Set<string>();
	for (const change of spec.changes) {
		if (!(RECURRENCE_FIELDS as readonly string[]).includes(change.field)) {
			return `Recurrence field is not allowed: ${change.field}.`;
		}
		if (seen.has(change.field)) return `Recurrence field is duplicated: ${change.field}.`;
		seen.add(change.field);
		if (
			spec.scope === 'this-task'
			&& (change.field === 'repeat' || change.field === 'datetimeRepeatEnd')
		) return `This-task scope cannot change ${change.field}.`;
	}
	return null;
}

function buildExpectedState(fieldValues: Readonly<Record<string, string>>): RecurrenceExpectedStateV1 {
	const expectedValues: RecurrenceExpectedStateV1['fieldValues'] = {};
	for (const field of RECURRENCE_FIELDS) {
		const value = (fieldValues[field] ?? '').trim();
		if (!value) continue;
		if (field === 'estimate') {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) expectedValues.estimate = parsed;
		} else {
			expectedValues[field] = RECURRENCE_DATETIME_FIELDS.has(field)
				? canonicalizeLocalDatetime(value)
				: value;
		}
	}
	return {
		fieldValues: expectedValues,
		repeatSeriesId: normalizeSeriesId(fieldValues['repeatSeriesId']) || null,
		repeatOccurrenceDate: normalizeDate(fieldValues['repeatOccurrenceDate']) || null,
	};
}

function buildPayload(changes: readonly RecurrenceUpdateItemV1[]): Record<string, string> {
	return Object.fromEntries(changes.map(change => [
		change.field,
		'operation' in change
			? ''
			: change.valueType === 'number'
				? String(change.value)
				: change.valueType === 'datetime'
					? canonicalizeLocalDatetime(change.value)
					: change.value,
	]));
}

function sealChange(
	change: RecurrenceUpdateItemV1,
	currentValue: string | undefined,
): RecurrenceUpdateItemV1 {
	const trimmed = (currentValue ?? '').trim();
	if (change.valueType === 'number') {
		const { expectedValue: _expectedValue, ...unsealedChange } = change;
		if (!trimmed) return unsealedChange;
		const expectedValue = Number(trimmed);
		return Number.isFinite(expectedValue)
			? { ...unsealedChange, expectedValue }
			: unsealedChange;
	}
	const { expectedValue: _expectedValue, ...unsealedChange } = change;
	if (!trimmed) return unsealedChange;
	return {
		...unsealedChange,
		expectedValue: change.valueType === 'datetime'
			? canonicalizeLocalDatetime(trimmed)
			: trimmed,
	};
}

function sameExpectedValue(change: RecurrenceUpdateItemV1, currentValue: string | undefined): boolean {
	const current = (currentValue ?? '').trim();
	return change.valueType === 'number'
		? Number(current) === change.expectedValue
		: change.valueType === 'datetime'
			? canonicalizeLocalDatetime(current)
				=== canonicalizeLocalDatetime(change.expectedValue ?? '')
			: current === change.expectedValue;
}

function sameExpectedState(left: RecurrenceExpectedStateV1, right: RecurrenceExpectedStateV1): boolean {
	const canonicalize = (state: RecurrenceExpectedStateV1): RecurrenceExpectedStateV1 => ({
		...state,
		fieldValues: Object.fromEntries(Object.entries(state.fieldValues).map(([field, value]) => [
			field,
			typeof value === 'string' && RECURRENCE_DATETIME_FIELDS.has(field)
				? canonicalizeLocalDatetime(value)
				: value,
		])),
	});
	return canonicalJsonV1(toJsonValueV1(canonicalize(left)))
		=== canonicalJsonV1(toJsonValueV1(canonicalize(right)));
}

function applyPatch(
	current: Readonly<Record<string, string>>,
	patch: Readonly<Record<string, string>>,
): Record<string, string> {
	const next = { ...current };
	for (const [field, value] of Object.entries(patch)) {
		if (value.trim()) next[field] = value.trim();
		else delete next[field];
	}
	return next;
}

function hasPatchChange(
	current: Readonly<Record<string, string>>,
	patch: Readonly<Record<string, string>>,
): boolean {
	return Object.entries(patch).some(([field, value]) => (current[field] ?? '').trim() !== value.trim());
}

function normalizeSeriesId(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return /^rs[a-z0-9]{5}$/u.test(trimmed) ? trimmed : '';
}

function normalizeDate(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : '';
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): RuntimeTaskRecurrencePreparationResultV1 {
	return { ok: false, code, reason };
}
