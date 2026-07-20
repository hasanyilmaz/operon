import type { IndexedTask } from '../types/fields';
import { parseAbsoluteReminder, parseReminderRule, resolveReminderRule } from './reminder-rules';
import { splitTaskListValue } from './task-field-patch';

export type ReminderOccurrenceFieldKey = 'reminderDatetimes' | 'reminderRules';

export interface ReminderOccurrenceSource {
	fieldKey: ReminderOccurrenceFieldKey;
	index: number;
	rawValue: string;
}

export interface ReminderOccurrence {
	key: string;
	sourceLogicalKeys: string[];
	operonId: string;
	epochMs: number;
	localDatetime: string;
	sources: ReminderOccurrenceSource[];
}

export const REMINDER_ON_TIME_TOLERANCE_MS = 60_000;
export const REMINDER_MAX_CATCH_UP_MINUTES = 1_440;

export function buildReminderOccurrenceKey(operonId: string, epochMs: number): string {
	return `${operonId}@${epochMs}`;
}

function encodeLogicalIdentityPart(value: string): string {
	return `${value.length}:${value}`;
}

export function buildReminderSourceLogicalKey(
	operonId: string,
	localDatetime: string,
	fieldKey: ReminderOccurrenceFieldKey,
	canonicalToken: string,
): string {
	return [operonId, localDatetime, fieldKey, canonicalToken]
		.map(encodeLogicalIdentityPart)
		.join('|');
}

/** Build a source identity from legacy ledger data without depending on its original list index. */
export function buildReminderSourceLogicalKeyFromSource(
	operonId: string,
	localDatetime: string,
	source: ReminderOccurrenceSource,
): string {
	let canonicalToken = source.rawValue.trim();
	if (source.fieldKey === 'reminderDatetimes') {
		const parsed = parseAbsoluteReminder(source.rawValue);
		if (parsed.ok) canonicalToken = parsed.value.localDatetime;
	} else {
		const parsed = parseReminderRule(source.rawValue);
		if (parsed.ok) canonicalToken = parsed.value.canonical;
	}
	return buildReminderSourceLogicalKey(operonId, localDatetime, source.fieldKey, canonicalToken);
}

/** Build the authoritative resolved reminder set from one indexed task. */
export function buildReminderOccurrences(
	task: IndexedTask,
	isSystemFieldEnabled: (fieldKey: ReminderOccurrenceFieldKey) => boolean = () => true,
): ReminderOccurrence[] {
	if (task.checkbox !== 'open') return [];
	const byEpochMs = new Map<number, ReminderOccurrence>();

	const remember = (
		epochMs: number,
		localDatetime: string,
		source: ReminderOccurrenceSource,
		canonicalToken: string,
	): void => {
		const sourceLogicalKey = buildReminderSourceLogicalKey(
			task.operonId,
			localDatetime,
			source.fieldKey,
			canonicalToken,
		);
		const existing = byEpochMs.get(epochMs);
		if (existing) {
			existing.sources.push(source);
			if (!existing.sourceLogicalKeys.includes(sourceLogicalKey)) {
				existing.sourceLogicalKeys.push(sourceLogicalKey);
			}
			return;
		}
		byEpochMs.set(epochMs, {
			key: buildReminderOccurrenceKey(task.operonId, epochMs),
			sourceLogicalKeys: [sourceLogicalKey],
			operonId: task.operonId,
			epochMs,
			localDatetime,
			sources: [source],
		});
	};

	for (const [index, rawValue] of (isSystemFieldEnabled('reminderDatetimes')
		? splitTaskListValue(task.fieldValues.reminderDatetimes)
		: []).entries()) {
		const parsed = parseAbsoluteReminder(rawValue);
		if (!parsed.ok) continue;
		remember(parsed.value.epochMs, parsed.value.localDatetime, {
			fieldKey: 'reminderDatetimes',
			index,
			rawValue,
		}, parsed.value.localDatetime);
	}

	for (const [index, rawValue] of (isSystemFieldEnabled('reminderRules')
		? splitTaskListValue(task.fieldValues.reminderRules)
		: []).entries()) {
		const resolved = resolveReminderRule(rawValue, task.fieldValues);
		if (resolved.status !== 'resolved') continue;
		remember(resolved.epochMs, resolved.localDatetime, {
			fieldKey: 'reminderRules',
			index,
			rawValue,
		}, resolved.rule.canonical);
	}

	return [...byEpochMs.values()].sort((left, right) => left.epochMs - right.epochMs);
}

export function isReminderOccurrenceDue(
	epochMs: number,
	nowMs: number,
	catchUpWindowMinutes: number,
): boolean {
	if (epochMs > nowMs) return false;
	const configuredWindowMs = Math.max(0, catchUpWindowMinutes) * 60_000;
	return nowMs - epochMs <= Math.max(REMINDER_ON_TIME_TOLERANCE_MS, configuredWindowMs);
}
