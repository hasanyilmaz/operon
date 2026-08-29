import { shiftDatetimeByDays } from '../../core/scheduling-rules';
import { normalizeGanttDateKey, shiftGanttDateKey } from '../../systems/gantt-core';
import { getTaskRepeatOccurrenceDate } from '../../systems/recurrence-domain';
import type { IndexedTask } from '../../types/fields';

export type TableGanttDescendantShiftBlockedReason =
	| 'duplicate-task'
	| 'missing-task'
	| 'invalid-hierarchy'
	| 'hierarchy-cycle'
	| 'invalid-recurrence';

export interface TableGanttDescendantShiftEntry {
	task: IndexedTask;
	payload: Record<string, string>;
	changedKeys: string[];
	recurrenceSeriesId: string | null;
}

export interface TableGanttDescendantRecurrenceRequirement {
	seriesId: string;
	occurrenceDate: string;
	taskIds: string[];
}

export interface TableGanttDescendantShiftPlan {
	outcome: 'planned' | 'noop' | 'blocked';
	deltaDays: number;
	entries: TableGanttDescendantShiftEntry[];
	recurrenceRequirements: TableGanttDescendantRecurrenceRequirement[];
	skippedTerminalTaskIds: string[];
	skippedUndatedTaskIds: string[];
	blockedTaskId: string | null;
	blockedReason: TableGanttDescendantShiftBlockedReason | null;
}

export interface BuildTableGanttDescendantShiftPlanOptions {
	parentTaskId: string;
	deltaDays: number;
	directChildIds: Iterable<string>;
	descendantIds: Iterable<string>;
	getTask: (operonId: string) => IndexedTask | null;
	hasDuplicateTaskId?: (operonId: string) => boolean;
	hasHierarchyCycle?: () => boolean;
	requiresRecurrenceScope?: (task: IndexedTask) => boolean;
}

const SHIFTABLE_DATE_KEYS = ['dateStarted', 'dateScheduled', 'dateDue'] as const;
const SHIFTABLE_DATETIME_KEYS = ['datetimeStart', 'datetimeEnd'] as const;

function emptyPlan(
	outcome: TableGanttDescendantShiftPlan['outcome'],
	deltaDays: number,
): TableGanttDescendantShiftPlan {
	return {
		outcome,
		deltaDays,
		entries: [],
		recurrenceRequirements: [],
		skippedTerminalTaskIds: [],
		skippedUndatedTaskIds: [],
		blockedTaskId: null,
		blockedReason: null,
	};
}

function blockedPlan(
	deltaDays: number,
	taskId: string,
	reason: TableGanttDescendantShiftBlockedReason,
): TableGanttDescendantShiftPlan {
	return {
		...emptyPlan('blocked', deltaDays),
		blockedTaskId: taskId,
		blockedReason: reason,
	};
}

function isTerminalTask(task: IndexedTask): boolean {
	return task.checkbox === 'done'
		|| task.checkbox === 'cancelled'
		|| !!normalizeGanttDateKey(task.fieldValues['dateCompleted'])
		|| !!normalizeGanttDateKey(task.fieldValues['dateCancelled']);
}

function buildShiftPayload(task: IndexedTask, deltaDays: number): Record<string, string> {
	const payload: Record<string, string> = {};
	for (const key of SHIFTABLE_DATE_KEYS) {
		const current = normalizeGanttDateKey(task.fieldValues[key]);
		if (!current) continue;
		const shifted = shiftGanttDateKey(current, deltaDays);
		if (shifted && shifted !== current) payload[key] = shifted;
	}
	for (const key of SHIFTABLE_DATETIME_KEYS) {
		const current = (task.fieldValues[key] ?? '').trim();
		if (!isValidLocalDatetime(current)) continue;
		const shifted = shiftDatetimeByDays(current, deltaDays);
		if (shifted && shifted !== current) payload[key] = shifted;
	}
	return payload;
}

function isValidLocalDatetime(value: string): boolean {
	const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
	if (!match || !normalizeGanttDateKey(match[1])) return false;
	const hours = Number.parseInt(match[2], 10);
	const minutes = Number.parseInt(match[3], 10);
	const seconds = Number.parseInt(match[4] ?? '0', 10);
	return hours <= 23 && minutes <= 59 && seconds <= 59;
}

export function buildTableGanttDescendantShiftPlan(
	options: BuildTableGanttDescendantShiftPlanOptions,
): TableGanttDescendantShiftPlan {
	const deltaDays = Number.isSafeInteger(options.deltaDays) ? options.deltaDays : 0;
	const parentTaskId = options.parentTaskId.trim();
	const directChildIds = new Set(
		[...options.directChildIds].map(value => value.trim()).filter(value => value && value !== parentTaskId),
	);
	if (!parentTaskId || deltaDays === 0 || directChildIds.size === 0) return emptyPlan('noop', deltaDays);
	if (options.hasDuplicateTaskId?.(parentTaskId)) return blockedPlan(deltaDays, parentTaskId, 'duplicate-task');
	if (!options.getTask(parentTaskId)) return blockedPlan(deltaDays, parentTaskId, 'missing-task');
	if (options.hasHierarchyCycle?.()) return blockedPlan(deltaDays, parentTaskId, 'hierarchy-cycle');

	const descendantIds = [...new Set(
		[...options.descendantIds].map(value => value.trim()).filter(value => value && value !== parentTaskId),
	)].sort((left, right) => left.localeCompare(right));
	const descendantIdSet = new Set(descendantIds);
	for (const taskId of [...directChildIds].sort((left, right) => left.localeCompare(right))) {
		if (options.hasDuplicateTaskId?.(taskId)) return blockedPlan(deltaDays, taskId, 'duplicate-task');
		if (!options.getTask(taskId)) return blockedPlan(deltaDays, taskId, 'missing-task');
		if (!descendantIdSet.has(taskId)) return blockedPlan(deltaDays, taskId, 'invalid-hierarchy');
	}
	const entries: TableGanttDescendantShiftEntry[] = [];
	const skippedTerminalTaskIds: string[] = [];
	const skippedUndatedTaskIds: string[] = [];
	const recurrenceBySeries = new Map<string, TableGanttDescendantRecurrenceRequirement>();

	for (const taskId of descendantIds) {
		if (options.hasDuplicateTaskId?.(taskId)) return blockedPlan(deltaDays, taskId, 'duplicate-task');
		const task = options.getTask(taskId);
		if (!task) return blockedPlan(deltaDays, taskId, 'missing-task');
		if (isTerminalTask(task)) {
			skippedTerminalTaskIds.push(taskId);
			continue;
		}
		const payload = buildShiftPayload(task, deltaDays);
		const changedKeys = Object.keys(payload);
		if (changedKeys.length === 0) {
			skippedUndatedTaskIds.push(taskId);
			continue;
		}

		let recurrenceSeriesId: string | null = null;
		if (options.requiresRecurrenceScope?.(task)) {
			recurrenceSeriesId = (task.fieldValues['repeatSeriesId'] ?? '').trim();
			const explicitOccurrenceDate = (task.fieldValues['repeatOccurrenceDate'] ?? '').trim();
			if (explicitOccurrenceDate && !normalizeGanttDateKey(explicitOccurrenceDate)) {
				return blockedPlan(deltaDays, taskId, 'invalid-recurrence');
			}
			const occurrenceDate = getTaskRepeatOccurrenceDate(task);
			if (!recurrenceSeriesId || !normalizeGanttDateKey(occurrenceDate)) {
				return blockedPlan(deltaDays, taskId, 'invalid-recurrence');
			}
			const requirement = recurrenceBySeries.get(recurrenceSeriesId);
			if (requirement) {
				requirement.taskIds.push(taskId);
				if (occurrenceDate < requirement.occurrenceDate) requirement.occurrenceDate = occurrenceDate;
			} else {
				recurrenceBySeries.set(recurrenceSeriesId, {
					seriesId: recurrenceSeriesId,
					occurrenceDate,
					taskIds: [taskId],
				});
			}
		}

		entries.push({ task, payload, changedKeys, recurrenceSeriesId });
	}

	return {
		...emptyPlan(entries.length > 0 ? 'planned' : 'noop', deltaDays),
		entries,
		recurrenceRequirements: [...recurrenceBySeries.values()]
			.map(requirement => ({ ...requirement, taskIds: [...requirement.taskIds].sort() }))
			.sort((left, right) => left.seriesId.localeCompare(right.seriesId)),
		skippedTerminalTaskIds,
		skippedUndatedTaskIds,
	};
}
