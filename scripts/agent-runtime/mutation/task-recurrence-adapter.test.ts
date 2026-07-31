import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodeMutationPreviewRequestV1,
	type MutationPreviewRequestV1,
	type UpdateTaskRecurrenceSpecV1,
} from '../../../src/agent-runtime/contracts/v1';
import { toJsonValueV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import {
	prepareRuntimeTaskRecurrenceMutationV1,
	verifyRuntimeTaskRecurrencePostflightV1,
	type RuntimeTaskRecurrenceSnapshotV1,
} from '../../../src/agent-runtime/runtime/task-recurrence-adapter';

const effectiveAt = '2026-07-27T12:34:56.000Z';
const locator = { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 2 };

function snapshot(
	fieldValues: Readonly<Record<string, string>> = {},
): RuntimeTaskRecurrenceSnapshotV1 {
	return {
		operonId: 'task001',
		locator,
		fieldValues,
		sourceContent: '- [ ] Recurring task {{operonId:: task001}}',
		duplicate: false,
	};
}

function request(
	spec: UpdateTaskRecurrenceSpecV1,
): MutationPreviewRequestV1 {
	return {
		contractVersion: 1,
		requestId: 'recurrence-adapter',
		kind: 'mutation-preview',
		clientInstanceId: 'recurrence-adapter-test',
		idempotencyKey: 'recurrence-adapter-key',
		capability: 'tasks.recurrence.preview',
		mutationKind: 'task.recurrence',
		target: { operonId: 'task001', locator },
		spec,
		authorization: { basis: 'user-explicit-request' },
	};
}

function ports(task: RuntimeTaskRecurrenceSnapshotV1) {
	return {
		getTask: (operonId: string) => operonId === task.operonId ? task : null,
		getAllRepeatSeriesIds: () => new Set(['rsold01']),
		getRepeatSkipDates: () => [],
	};
}

function applyPatch(
	fields: Readonly<Record<string, string>>,
	patch: Readonly<Record<string, string>>,
): Record<string, string> {
	const next = { ...fields };
	for (const [key, value] of Object.entries(patch)) {
		if (value) next[key] = value;
		else delete next[key];
	}
	return next;
}

test('recurrence contract accepts the reduced preview shape and rejects this-task rule edits', () => {
	const valid = decodeMutationPreviewRequestV1(request({
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [{
			field: 'repeat',
			valueType: 'text',
			value: 'mode=schedule|freq=day|interval=1',
		}],
	}));
	assert.equal(valid.ok, true);

	const invalid = decodeMutationPreviewRequestV1(request({
		operation: 'update-recurrence',
		scope: 'this-task',
		changes: [{
			field: 'repeat',
			valueType: 'text',
			value: 'mode=schedule|freq=day|interval=1',
		}],
	}));
	assert.equal(invalid.ok, false);
	if (!invalid.ok) {
		assert.ok(invalid.issues.some(issue => (
			issue.path === '/spec/changes/0/field'
			&& issue.message.includes('cannot change repeat')
		)));
	}
});

test('starting recurrence allocates and seals canonical series identity', () => {
	const task = snapshot({ dateScheduled: '2026-07-28' });
	const result = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [{
			field: 'repeat',
			valueType: 'text',
			value: 'mode=schedule|freq=day|interval=1',
		}],
	}), effectiveAt, ports(task));

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.match(result.value.fieldValues.repeatSeriesId, /^rs[a-f0-9]{5}$/u);
	assert.equal(result.value.fieldValues.repeatOccurrenceDate, '2026-07-28');
	assert.deepEqual(result.value.sealedSpec.expected, {
		fieldValues: { dateScheduled: '2026-07-28' },
		repeatSeriesId: null,
		repeatOccurrenceDate: null,
	});
	assert.equal(result.value.sealedSpec.changes[0].expectedValue, undefined);
	assert.equal(
		Object.prototype.hasOwnProperty.call(result.value.sealedSpec.changes[0], 'expectedValue'),
		false,
		'Absent current values must omit expectedValue so the sealed plan remains JSON-safe.',
	);
	assert.doesNotThrow(() => toJsonValueV1(result.value.sealedSpec));
	const replay = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [{
			field: 'repeat',
			valueType: 'text',
			value: 'mode=schedule|freq=day|interval=1',
		}],
	}), effectiveAt, ports(task));
	assert.equal(replay.ok, true);
	if (replay.ok) {
		assert.equal(
			replay.value.fieldValues.repeatSeriesId,
			result.value.fieldValues.repeatSeriesId,
			'Apply-time preparation must reproduce the preview-sealed series identity.',
		);
	}
	const committed = applyPatch(task.fieldValues, result.value.fieldValues);
	assert.equal(verifyRuntimeTaskRecurrencePostflightV1(
		result.value,
		() => ({ locator, fieldValues: committed }),
	), true);
});

test('this-task temporal edits leave recurrence identity and series overrides untouched', () => {
	const task = snapshot({
		repeat: 'mode=schedule|freq=day|interval=1',
		repeatSeriesId: 'rsold01',
		repeatOccurrenceDate: '2026-07-27',
		dateScheduled: '2026-07-27',
	});
	const result = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-task',
		changes: [{
			field: 'dateDue',
			valueType: 'date',
			value: '2026-07-28',
		}],
	}), effectiveAt, ports(task));

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.fieldValues.dateDue, '2026-07-28');
	assert.equal(result.value.fieldValues.repeatSeriesId, undefined);
	assert.equal(result.value.fieldValues.repeatOccurrenceDate, undefined);
	assert.equal(result.value.followingOverride, undefined);
	const committed = applyPatch(task.fieldValues, result.value.fieldValues);
	assert.equal(committed.repeatSeriesId, 'rsold01');
	assert.equal(committed.repeatOccurrenceDate, '2026-07-27');
	assert.equal(verifyRuntimeTaskRecurrencePostflightV1(
		result.value,
		() => ({ locator, fieldValues: committed }),
		() => {
			throw new Error('this-task postflight must not read following overrides');
		},
	), true);
});

test('recurrence datetime edits canonicalize seconds and compare minute precision as equal', () => {
	const task = snapshot({
		repeat: 'mode=schedule|freq=day|interval=1',
		repeatSeriesId: 'rsold01',
		repeatOccurrenceDate: '2026-07-27',
		dateScheduled: '2026-07-27',
		datetimeStart: '2026-07-27T09:30:00',
	});
	const changed = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-task',
		changes: [{
			field: 'datetimeStart',
			valueType: 'datetime',
			value: '2026-07-27T10:15',
			expectedValue: '2026-07-27T09:30',
		}],
	}), effectiveAt, ports(task));
	assert.equal(changed.ok, true);
	if (!changed.ok) return;
	assert.equal(changed.value.fieldValues.datetimeStart, '2026-07-27T10:15:00');
	const committed = applyPatch(task.fieldValues, changed.value.fieldValues);
	assert.equal(verifyRuntimeTaskRecurrencePostflightV1(
		changed.value,
		() => ({ locator, fieldValues: committed }),
	), true);

	const noChangeTask = snapshot({
		...committed,
		datetimeEnd: '2026-07-27T11:30:00',
		datetimeRepeatEnd: '2026-08-31T12:45:00',
		estimate: '4500',
	});
	const noChange = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [
			{
				field: 'datetimeStart',
				valueType: 'datetime',
				value: '2026-07-27T10:15',
				expectedValue: '2026-07-27T10:15',
			},
			{
				field: 'datetimeEnd',
				valueType: 'datetime',
				value: '2026-07-27T11:30',
				expectedValue: '2026-07-27T11:30',
			},
			{
				field: 'datetimeRepeatEnd',
				valueType: 'datetime',
				value: '2026-08-31T12:45',
				expectedValue: '2026-08-31T12:45',
			},
		],
		expected: {
			fieldValues: {
				repeat: noChangeTask.fieldValues.repeat,
				dateScheduled: noChangeTask.fieldValues.dateScheduled,
				datetimeStart: '2026-07-27T10:15',
				datetimeEnd: '2026-07-27T11:30',
				datetimeRepeatEnd: '2026-08-31T12:45',
				estimate: 4500,
			},
			repeatSeriesId: 'rsold01',
			repeatOccurrenceDate: '2026-07-27',
		},
	}), effectiveAt, ports(noChangeTask));
	assert.equal(noChange.ok, true, JSON.stringify(noChange));
	if (noChange.ok) {
		assert.equal(noChange.value.noChange, true, JSON.stringify(noChange.value));
		assert.deepEqual(noChange.value.fieldValues, {});
		assert.equal(noChange.value.sealedSpec.changes[0].expectedValue, '2026-07-27T10:15:00');
		assert.equal(noChange.value.sealedSpec.expected?.fieldValues.datetimeEnd, '2026-07-27T11:30:00');
	}
});

test('this-and-following temporal edits reanchor occurrence identity and seal the following override', () => {
	const task = snapshot({
		repeat: 'mode=schedule|freq=week|interval=1|days=mo',
		repeatSeriesId: 'rsold01',
		repeatOccurrenceDate: '2026-07-27',
		dateScheduled: '2026-07-27',
		dateStarted: '2026-07-27',
		dateDue: '2026-07-27',
	});
	const result = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [{
			field: 'dateScheduled',
			valueType: 'date',
			value: '2026-07-29',
		}],
	}), effectiveAt, ports(task));

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.fieldValues.repeatOccurrenceDate, '2026-07-29');
	assert.equal(result.value.followingOverride?.effectiveFrom, '2026-07-29');
	assert.equal(result.value.followingOverride?.dateShiftDays, 0);
	assert.equal(result.value.sealedSpec.changes[0].expectedValue, '2026-07-27');
	const committed = applyPatch(task.fieldValues, result.value.fieldValues);
	assert.equal(verifyRuntimeTaskRecurrencePostflightV1(
		result.value,
		() => ({ locator, fieldValues: committed }),
		() => result.value.followingOverride ?? null,
	), true);
	assert.equal(verifyRuntimeTaskRecurrencePostflightV1(
		result.value,
		() => ({ locator, fieldValues: committed }),
		() => null,
	), false);
});

test('clearing repeat clears recurrence identity and end state', () => {
	const task = snapshot({
		repeat: 'mode=schedule|freq=day|interval=1',
		repeatSeriesId: 'rsold01',
		repeatOccurrenceDate: '2026-07-27',
		dateScheduled: '2026-07-27',
		datetimeRepeatEnd: '2026-08-31T23:59:59',
	});
	const result = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-and-following',
		changes: [{
			operation: 'clear',
			field: 'repeat',
			valueType: 'text',
		}],
	}), effectiveAt, ports(task));

	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.value.fieldValues.repeat, '');
	assert.equal(result.value.fieldValues.repeatSeriesId, '');
	assert.equal(result.value.fieldValues.repeatOccurrenceDate, '');
	assert.equal(result.value.fieldValues.datetimeRepeatEnd, '');
});

test('sealed expected recurrence state fails closed on drift', () => {
	const task = snapshot({
		repeat: 'mode=schedule|freq=day|interval=1',
		repeatSeriesId: 'rsold01',
		repeatOccurrenceDate: '2026-07-27',
		dateScheduled: '2026-07-27',
	});
	const result = prepareRuntimeTaskRecurrenceMutationV1(request({
		operation: 'update-recurrence',
		scope: 'this-task',
		changes: [{
			field: 'dateScheduled',
			valueType: 'date',
			value: '2026-07-28',
			expectedValue: '2026-07-26',
		}],
		expected: {
			fieldValues: {
				repeat: task.fieldValues.repeat,
				dateScheduled: '2026-07-26',
			},
			repeatSeriesId: 'rsold01',
			repeatOccurrenceDate: '2026-07-27',
		},
	}), effectiveAt, ports(task));

	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.code, 'stale-source');
});
