import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { resolveAutomationWorkflowStatus } from '../types/pipeline';
import { resolveDailyNoteDateKeyFromPath, type DailyNotePathConfig } from './daily-note-path';

export const DAILY_NOTE_INLINE_TASK_DEFAULT_FRESHNESS_MS = 10 * 60 * 1000;

type DailyNoteInlineTaskDefaultSettings = Pick<
	OperonSettings,
	| 'inlineTaskDailyNoteAddStartDate'
	| 'inlineTaskDailyNoteAddScheduledDate'
	| 'pipelines'
	| 'defaultPipelineName'
>;

export interface DailyNoteInlineTaskDefaultPatchOptions {
	task: IndexedTask;
	dailyNoteDateKey: string;
	settings: DailyNoteInlineTaskDefaultSettings;
	now: string;
	freshnessMs?: number;
}

export interface DailyNoteInlineTaskDefaultDelta {
	before: IndexedTask | null;
	after: IndexedTask | null;
}

export interface DailyNoteInlineTaskDefaultWritePlan {
	operonId: string;
	payload: Record<string, string>;
}

export interface DailyNoteInlineTaskDefaultWritePlanOptions {
	changes: readonly DailyNoteInlineTaskDefaultDelta[];
	dailyNotesConfig: DailyNotePathConfig;
	settings: DailyNoteInlineTaskDefaultSettings;
	now: string;
	freshnessMs?: number;
}

export function isFreshlyCreatedOperonInlineTask(
	task: IndexedTask,
	now: string,
	freshnessMs = DAILY_NOTE_INLINE_TASK_DEFAULT_FRESHNESS_MS,
): boolean {
	if (!task.operonId.trim()) return false;
	if (task.primary.format !== 'inline') return false;

	const createdAt = parseLocalDateTimeToMs(task.fieldValues['datetimeCreated']);
	const nowMs = parseLocalDateTimeToMs(now);
	if (createdAt === null || nowMs === null) return false;

	const ageMs = nowMs - createdAt;
	return ageMs >= 0 && ageMs <= freshnessMs;
}

export function buildDailyNoteInlineTaskDefaultPatch(
	options: DailyNoteInlineTaskDefaultPatchOptions,
): Record<string, string> {
	const { task, dailyNoteDateKey, settings, now, freshnessMs } = options;
	if (!settings.inlineTaskDailyNoteAddStartDate && !settings.inlineTaskDailyNoteAddScheduledDate) return {};
	if (!isFreshlyCreatedOperonInlineTask(task, now, freshnessMs)) return {};

	const patch: Record<string, string> = {};
	if (settings.inlineTaskDailyNoteAddStartDate && isBlank(task.fieldValues['dateStarted'])) {
		patch['dateStarted'] = dailyNoteDateKey;
	}
	if (settings.inlineTaskDailyNoteAddScheduledDate && isBlank(task.fieldValues['dateScheduled'])) {
		patch['dateScheduled'] = dailyNoteDateKey;
	}
	if (patch['dateScheduled'] && !hasOwnFieldValue(task, 'status') && task.checkbox === 'open') {
		const workflow = resolveAutomationWorkflowStatus(
			settings.pipelines,
			undefined,
			settings.defaultPipelineName,
			'scheduled',
		);
		if (workflow) {
			patch['status'] = workflow.value;
		}
	}

	return patch;
}

export function buildDailyNoteInlineTaskDefaultWritePlans(
	options: DailyNoteInlineTaskDefaultWritePlanOptions,
): DailyNoteInlineTaskDefaultWritePlan[] {
	const { changes, dailyNotesConfig, settings, now, freshnessMs } = options;
	if (!settings.inlineTaskDailyNoteAddStartDate && !settings.inlineTaskDailyNoteAddScheduledDate) return [];

	const plans: DailyNoteInlineTaskDefaultWritePlan[] = [];
	for (const change of changes) {
		const task = change.before ? null : change.after;
		if (!task || task.primary.format !== 'inline') continue;

		const dailyNoteDateKey = resolveDailyNoteDateKeyFromPath(task.primary.filePath, dailyNotesConfig);
		if (!dailyNoteDateKey) continue;

		const patch = buildDailyNoteInlineTaskDefaultPatch({
			task,
			dailyNoteDateKey,
			settings,
			now,
			freshnessMs,
		});
		if (Object.keys(patch).length === 0) continue;

		plans.push({
			operonId: task.operonId,
			payload: {
				...patch,
				datetimeModified: now,
			},
		});
	}

	return plans;
}

function isBlank(value: string | null | undefined): boolean {
	return !(value ?? '').trim();
}

function hasOwnFieldValue(task: IndexedTask, key: string): boolean {
	return Object.keys(task.fieldValues).includes(key);
}

function parseLocalDateTimeToMs(value: string | null | undefined): number | null {
	const match = (value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u);
	if (!match) return null;

	const [, year, month, day, hour, minute, second = '0'] = match;
	const date = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	);
	if (
		date.getFullYear() !== Number(year)
		|| date.getMonth() !== Number(month) - 1
		|| date.getDate() !== Number(day)
		|| date.getHours() !== Number(hour)
		|| date.getMinutes() !== Number(minute)
		|| date.getSeconds() !== Number(second)
	) {
		return null;
	}

	return date.getTime();
}
