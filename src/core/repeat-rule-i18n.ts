import { getCurrentLang, t } from './i18n';
import { formatRepeatRuleSummaryWithLabels } from './repeat-rule';
import type { RepeatRule, RepeatRuleSummaryLabels, RepeatWeekday } from './repeat-rule';

const WEEKDAY_KEYS: RepeatWeekday[] = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const WEEKDAY_LOCALE_SUFFIX: Record<RepeatWeekday, string> = {
	mo: 'Mo',
	tu: 'Tu',
	we: 'We',
	th: 'Th',
	fr: 'Fr',
	sa: 'Sa',
	su: 'Su',
};

const MONTH_KEYS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
] as const;

export function buildRepeatRuleSummaryLabels(): RepeatRuleSummaryLabels {
	const weekdayLabels = Object.fromEntries(
		WEEKDAY_KEYS.map(day => [day, t('taskEditor', `repeatWeekdayLong${WEEKDAY_LOCALE_SUFFIX[day]}`)]),
	) as Record<RepeatWeekday, string>;
	return {
		noRepeat: t('taskEditor', 'repeatSummaryNoRepeat'),
		every: {
			day: t('taskEditor', 'repeatSummaryEveryDay'),
			week: t('taskEditor', 'repeatSummaryEveryWeek'),
			month: t('taskEditor', 'repeatSummaryEveryMonth'),
			year: t('taskEditor', 'repeatSummaryEveryYear'),
		},
		everyInterval: {
			day: t('taskEditor', 'repeatSummaryEveryIntervalDay'),
			week: t('taskEditor', 'repeatSummaryEveryIntervalWeek'),
			month: t('taskEditor', 'repeatSummaryEveryIntervalMonth'),
			year: t('taskEditor', 'repeatSummaryEveryIntervalYear'),
		},
		whenDone: t('taskEditor', 'repeatSummaryWhenDone'),
		remaining: t('taskEditor', 'repeatSummaryRemaining'),
		weekOn: t('taskEditor', 'repeatSummaryWeekOn'),
		monthOnDay: t('taskEditor', 'repeatSummaryMonthOnDay'),
		monthOnPositionWeekday: t('taskEditor', 'repeatSummaryMonthOnPositionWeekday'),
		yearOnMonthDays: t('taskEditor', 'repeatSummaryYearOnMonthDays'),
		monthFallback: t('taskEditor', 'repeatSummaryMonthFallback'),
		ordinalDay: getCurrentLang() === 'tr' || getCurrentLang() === 'fr' || getCurrentLang() === 'de'
			? t('taskEditor', 'repeatSummaryOrdinalDay', { suffix: '' })
			: t('taskEditor', 'repeatSummaryOrdinalDay'),
		itemSeparator: t('taskEditor', 'repeatSummaryListItemSeparator'),
		twoItemSeparator: t('taskEditor', 'repeatSummaryListTwoItemSeparator'),
		finalItemSeparator: t('taskEditor', 'repeatSummaryListFinalItemSeparator'),
		countSeparator: t('taskEditor', 'repeatSummaryCountSeparator'),
		weekdayLabels,
		ordinalLabels: {
			1: t('taskEditor', 'repeatPositionFirst'),
			2: t('taskEditor', 'repeatPositionSecond'),
			3: t('taskEditor', 'repeatPositionThird'),
			4: t('taskEditor', 'repeatPositionFourth'),
			'-1': t('taskEditor', 'repeatPositionLast'),
		},
		monthLabels: MONTH_KEYS.map(month => t('taskEditor', `repeatMonth${month}`)),
	};
}

export function formatRepeatRuleSummaryI18n(rule: RepeatRule | null | undefined): string {
	return formatRepeatRuleSummaryWithLabels(rule, buildRepeatRuleSummaryLabels());
}
