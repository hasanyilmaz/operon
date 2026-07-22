import { parseRepeatRule } from '../core/repeat-rule';
import {
	RepeatFollowingOverride,
	RepeatSeriesEntry,
	RepeatTemporalTemplate,
} from '../storage/repeat-series-store';
import { IndexedTask } from '../types/fields';
import {
	buildRepeatSeriesContext,
	deriveTemporalTemplateFromTaskAtOccurrence,
	resolveOccurrenceDate,
} from './recurrence-domain';
import { renderRepeatSeriesTitle } from './recurring-file-naming';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

export type RecurrenceIdentityRepairRejectionReason =
	| 'not-yaml'
	| 'not-open'
	| 'invalid-series'
	| 'unsupported-repeat-mode'
	| 'invalid-date'
	| 'identity-already-aligned'
	| 'not-latest-materialized-task'
	| 'later-scheduled-task-exists'
	| 'missing-series-entry'
	| 'series-format-mismatch'
	| 'missing-following-override'
	| 'temporal-template-mismatch'
	| 'occurrence-collision'
	| 'scheduled-date-collision'
	| 'skip-date-conflict'
	| 'single-override-conflict'
	| 'naming-mismatch';

export interface RecurrenceIdentityRepairCandidate {
	operonId: string;
	seriesId: string;
	filePath: string;
	fromOccurrenceDate: string;
	toOccurrenceDate: string;
	repeat: string;
	additionalExpectedValues: Readonly<Record<string, string>>;
}

export type RecurrenceIdentityRepairEvaluation =
	| { candidate: RecurrenceIdentityRepairCandidate; reason: null }
	| { candidate: null; reason: RecurrenceIdentityRepairRejectionReason };

export interface RecurrenceIdentityRepairEvaluationInput {
	task: IndexedTask;
	seriesTasks: IndexedTask[];
	entry: RepeatSeriesEntry | null | undefined;
}

export interface RecurrenceIdentityRepairPlan {
	candidates: RecurrenceIdentityRepairCandidate[];
	evaluations: Array<{
		operonId: string;
		seriesId: string;
		result: RecurrenceIdentityRepairEvaluation;
	}>;
}

export function evaluateRecurrenceIdentityRepairCandidate(
	input: RecurrenceIdentityRepairEvaluationInput,
): RecurrenceIdentityRepairEvaluation {
	const { task, seriesTasks, entry } = input;
	if (task.primary.format !== 'yaml') return rejected('not-yaml');
	if (task.checkbox !== 'open') return rejected('not-open');

	const seriesId = normalizeOptional(task.fieldValues['repeatSeriesId']);
	if (!seriesId) return rejected('invalid-series');
	const rule = parseRepeatRule(task.fieldValues['repeat']);
	if (!rule || rule.mode !== 'schedule') {
		return rejected('unsupported-repeat-mode');
	}

	const scheduledDate = normalizeDate(task.fieldValues['dateScheduled']);
	const occurrenceDate = normalizeDate(task.fieldValues['repeatOccurrenceDate']);
	if (!scheduledDate || !occurrenceDate) return rejected('invalid-date');
	if (scheduledDate === occurrenceDate) return rejected('identity-already-aligned');

	const context = buildRepeatSeriesContext(seriesId, seriesTasks);
	if (!context || context.latestTask.operonId !== task.operonId) {
		return rejected('not-latest-materialized-task');
	}
	if (context.tasks.some(seriesTask => (
		seriesTask.operonId !== task.operonId
		&& normalizeDate(seriesTask.fieldValues['dateScheduled']) > scheduledDate
	))) {
		return rejected('later-scheduled-task-exists');
	}

	if (!entry || entry.seriesId !== seriesId) return rejected('missing-series-entry');
	if (entry.sourceFormat !== 'yaml') return rejected('series-format-mismatch');
	const followingOverride = entry.overrides.following.find(value => value.effectiveFrom === scheduledDate);
	if (!followingOverride) return rejected('missing-following-override');

	const reanchoredTemplate = deriveTemporalTemplateFromTaskAtOccurrence(task, scheduledDate);
	if (!followingOverrideMatchesTemplate(followingOverride, reanchoredTemplate)) {
		return rejected('temporal-template-mismatch');
	}

	const otherTasks = context.tasks.filter(seriesTask => seriesTask.operonId !== task.operonId);
	if (otherTasks.some(seriesTask => {
		const otherOccurrence = resolveOccurrenceDate(seriesTask);
		return otherOccurrence === occurrenceDate || otherOccurrence === scheduledDate;
	})) {
		return rejected('occurrence-collision');
	}
	if (otherTasks.some(seriesTask => normalizeDate(seriesTask.fieldValues['dateScheduled']) === scheduledDate)) {
		return rejected('scheduled-date-collision');
	}
	if (entry.skipDates.includes(occurrenceDate) || entry.skipDates.includes(scheduledDate)) {
		return rejected('skip-date-conflict');
	}
	if (entry.overrides.single[occurrenceDate] || entry.overrides.single[scheduledDate]) {
		return rejected('single-override-conflict');
	}

	if (entry.naming?.mode !== 'dateToken') return rejected('naming-mismatch');
	const expectedBasename = renderRepeatSeriesTitle(entry.naming, scheduledDate);
	if (getMarkdownBasename(task.primary.filePath) !== expectedBasename) {
		return rejected('naming-mismatch');
	}

	const repeat = normalizeOptional(task.fieldValues['repeat']);
	return {
		candidate: {
			operonId: task.operonId,
			seriesId,
			filePath: task.primary.filePath,
			fromOccurrenceDate: occurrenceDate,
			toOccurrenceDate: scheduledDate,
			repeat,
			additionalExpectedValues: {
				status: normalizeOptional(task.fieldValues['status']),
				dateCompleted: normalizeOptional(task.fieldValues['dateCompleted']),
				dateCancelled: normalizeOptional(task.fieldValues['dateCancelled']),
				dateScheduled: scheduledDate,
				dateStarted: normalizeOptional(task.fieldValues['dateStarted']),
				dateDue: normalizeOptional(task.fieldValues['dateDue']),
				datetimeStart: normalizeOptional(task.fieldValues['datetimeStart']),
				datetimeEnd: normalizeOptional(task.fieldValues['datetimeEnd']),
				estimate: normalizeOptional(task.fieldValues['estimate']),
				repeatSeriesId: seriesId,
				repeat,
			},
		},
		reason: null,
	};
}

export function buildRecurrenceIdentityRepairPlan(
	tasks: IndexedTask[],
	entries: RepeatSeriesEntry[],
): RecurrenceIdentityRepairPlan {
	const entryBySeriesId = new Map(entries.map(entry => [entry.seriesId, entry]));
	const tasksBySeriesId = new Map<string, IndexedTask[]>();
	for (const task of tasks) {
		const seriesId = normalizeOptional(task.fieldValues['repeatSeriesId']);
		if (!seriesId) continue;
		const bucket = tasksBySeriesId.get(seriesId);
		if (bucket) bucket.push(task);
		else tasksBySeriesId.set(seriesId, [task]);
	}

	const candidates: RecurrenceIdentityRepairCandidate[] = [];
	const evaluations: RecurrenceIdentityRepairPlan['evaluations'] = [];
	for (const [seriesId, seriesTasks] of tasksBySeriesId) {
		const context = buildRepeatSeriesContext(seriesId, seriesTasks);
		if (!context) continue;
		const task = context.latestTask;
		const result = evaluateRecurrenceIdentityRepairCandidate({
			task,
			seriesTasks,
			entry: entryBySeriesId.get(seriesId),
		});
		evaluations.push({ operonId: task.operonId, seriesId, result });
		if (result.candidate) candidates.push(result.candidate);
	}

	candidates.sort(compareCandidates);
	evaluations.sort((left, right) => (
		left.seriesId.localeCompare(right.seriesId)
		|| left.operonId.localeCompare(right.operonId)
	));
	return { candidates, evaluations };
}

function followingOverrideMatchesTemplate(
	override: RepeatFollowingOverride,
	template: RepeatTemporalTemplate,
): boolean {
	return override.mode === template.mode
		&& override.dateShiftDays === template.dateShiftDays
		&& override.startDateShiftDays === template.startDateShiftDays
		&& override.endDateShiftDays === template.endDateShiftDays
		&& override.startTime === template.startTime
		&& override.endTime === template.endTime
		&& override.estimate === template.estimate;
}

function compareCandidates(
	left: RecurrenceIdentityRepairCandidate,
	right: RecurrenceIdentityRepairCandidate,
): number {
	return left.filePath.localeCompare(right.filePath)
		|| left.operonId.localeCompare(right.operonId);
}

function rejected(reason: RecurrenceIdentityRepairRejectionReason): RecurrenceIdentityRepairEvaluation {
	return { candidate: null, reason };
}

function normalizeDate(value: string | null | undefined): string {
	const trimmed = normalizeOptional(value);
	return DATE_RE.test(trimmed) ? trimmed : '';
}

function normalizeOptional(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function getMarkdownBasename(filePath: string): string {
	const filename = filePath.slice(filePath.lastIndexOf('/') + 1);
	return filename.toLocaleLowerCase('en-US').endsWith('.md') ? filename.slice(0, -3) : filename;
}
