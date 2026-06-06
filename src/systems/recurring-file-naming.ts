import { t } from '../core/i18n';

const DATE_TOKEN_RE = /\b\d{4}-\d{2}-\d{2}\b/gu;
const WEEK_TOKEN_RE = /\b([Ww])(5[0-3]|[1-4]\d|[1-9])\b/gu;

export type RepeatSeriesNamingMode = 'plain' | 'dateToken' | 'weekToken' | 'dateWeekToken' | 'literal';

export interface RepeatSeriesNamingConfig {
	mode: RepeatSeriesNamingMode;
	template: string;
	weekTokenCase: 'upper' | 'lower' | null;
}

export function extractSingleDateToken(title: string): string | null {
	const matches = [...title.matchAll(DATE_TOKEN_RE)].map(match => match[0]);
	return matches.length === 1 ? matches[0] : null;
}

export function extractSingleWeekToken(
	title: string,
): { raw: string; case: 'upper' | 'lower'; value: number } | null {
	const matches = [...title.matchAll(WEEK_TOKEN_RE)];
	if (matches.length !== 1) return null;
	const raw = matches[0][0];
	return {
		raw,
		case: matches[0][1] === 'w' ? 'lower' : 'upper',
		value: Number.parseInt(matches[0][2] ?? '', 10),
	};
}

export function detectRepeatSeriesNamingConfig(title: string): RepeatSeriesNamingConfig {
	const normalizedTitle = title.trim() || t('taskEditor', 'untitledTaskFile');
	const dateMatches = [...normalizedTitle.matchAll(DATE_TOKEN_RE)].map(match => match[0]);
	const weekMatches = [...normalizedTitle.matchAll(WEEK_TOKEN_RE)];
	if (dateMatches.length > 1 || weekMatches.length > 1) {
		return {
			mode: 'literal',
			template: normalizedTitle,
			weekTokenCase: null,
		};
	}

	if (dateMatches.length === 1 && weekMatches.length === 1) {
		const dateToken = dateMatches[0];
		const weekToken = weekMatches[0][0];
		return {
			mode: 'dateWeekToken',
			template: normalizedTitle
				.replace(dateToken, '{{date}}')
				.replace(weekToken, '{{week}}'),
			weekTokenCase: weekMatches[0][1] === 'w' ? 'lower' : 'upper',
		};
	}

	if (dateMatches.length === 1) {
		return {
			mode: 'dateToken',
			template: normalizedTitle.replace(dateMatches[0], '{{date}}'),
			weekTokenCase: null,
		};
	}

	if (weekMatches.length === 1) {
		const weekToken = weekMatches[0][0];
		return {
			mode: 'weekToken',
			template: normalizedTitle.replace(weekToken, '{{week}}'),
			weekTokenCase: weekMatches[0][1] === 'w' ? 'lower' : 'upper',
		};
	}

	return {
		mode: 'plain',
		template: normalizedTitle,
		weekTokenCase: null,
	};
}

export function resolveLatestRepeatSeriesNamingConfig(
	title: string | null | undefined,
	fallback: RepeatSeriesNamingConfig | null = null,
): RepeatSeriesNamingConfig | null {
	const trimmed = (title ?? '').trim();
	if (trimmed) return detectRepeatSeriesNamingConfig(trimmed);
	return fallback ? { ...fallback } : null;
}

export function computeIsoWeekToken(
	dateKey: string,
	caseMode: 'upper' | 'lower' | null,
): string {
	const date = parseDateKey(dateKey);
	if (!date) return caseMode === 'lower' ? 'w1' : 'W1';
	const week = getIsoWeek(date);
	const prefix = caseMode === 'lower' ? 'w' : 'W';
	return `${prefix}${week}`;
}

export function renderRepeatSeriesTitle(
	config: RepeatSeriesNamingConfig,
	scheduledDate: string,
): string {
	switch (config.mode) {
		case 'dateToken':
			return config.template.replace('{{date}}', scheduledDate);
		case 'weekToken':
			return config.template.replace('{{week}}', computeIsoWeekToken(scheduledDate, config.weekTokenCase));
		case 'dateWeekToken':
			return config.template
				.replace('{{date}}', scheduledDate)
				.replace('{{week}}', computeIsoWeekToken(scheduledDate, config.weekTokenCase));
		case 'plain':
		case 'literal':
		default:
			return config.template;
	}
}

export function renderCompletedPlainArchiveTitle(
	config: RepeatSeriesNamingConfig,
	scheduledDate: string,
): string {
	return `${scheduledDate} - ${config.template}`;
}

export function resolveRecurringFileDisplayDate(
	fieldValues: Partial<Record<'dateScheduled' | 'repeatOccurrenceDate' | 'dateDue' | 'dateStarted' | 'datetimeStart' | 'datetimeEnd', string>>,
): string {
	const scheduled = normalizeDateKey(fieldValues['dateScheduled']);
	if (scheduled) return scheduled;
	return normalizeDateKey(fieldValues['repeatOccurrenceDate'])
		|| normalizeDateKey(fieldValues['dateDue'])
		|| normalizeDateKey(fieldValues['dateStarted'])
		|| normalizeDateKey(fieldValues['datetimeStart'])
		|| normalizeDateKey(fieldValues['datetimeEnd']);
}

function normalizeDateKey(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/u.test(trimmed)) return trimmed.slice(0, 10);
	return '';
}

function parseDateKey(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
	const [year, month, day] = value.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function getIsoWeek(date: Date): number {
	const target = new Date(date.getTime());
	const day = target.getUTCDay() || 7;
	target.setUTCDate(target.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
	return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
