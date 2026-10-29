import { calculateNextRepeatDate, parseRepeatRule, type RepeatRule } from './repeat-rule';

export type RepeatSkipDateResolver = (repeatSeriesId: string) => readonly string[];

/** The same occurrence shown by the repeat chip; deliberately not advanced to today. */
export function getTaskOccurrenceDate(
	fields: Readonly<Record<string, string>>,
	getSkipDates?: RepeatSkipDateResolver,
	rule: RepeatRule | null = parseRepeatRule(fields['repeat'] ?? ''),
): string {
	if (!rule || rule.mode === 'done' || (rule.mode === 'count' && (rule.count ?? 0) <= 1)) return '';
	const anchor = getTaskOccurrenceAnchor(fields);
	if (!anchor) return '';
	const seriesId = fields['repeatSeriesId']?.trim();
	return calculateNextRepeatDate(rule, {
		anchorDate: anchor,
		repeatEnd: fields['datetimeRepeatEnd'],
		skipDates: seriesId && getSkipDates ? getSkipDates(seriesId).map(extractRepeatDatePart).filter(Boolean) : [],
	}) ?? '';
}

export function getTaskOccurrenceAnchor(fields: Readonly<Record<string, string>>): string {
	return extractRepeatDatePart(fields['repeatOccurrenceDate'])
		|| extractRepeatDatePart(fields['dateScheduled'])
		|| extractRepeatDatePart(fields['dateDue'])
		|| extractRepeatDatePart(fields['dateStarted'])
		|| extractRepeatDatePart(fields['datetimeStart'])
		|| extractRepeatDatePart(fields['datetimeEnd']);
}

export function extractRepeatDatePart(value: string | null | undefined): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
	return '';
}
