import { getDatePickerStrings, getRelativeDatePresets } from './date-nlp-fallback';
import type { DatePickerLang } from './date-nlp';

export function automationDateLabel(expression: string, language: DatePickerLang): string {
	const strings = getDatePickerStrings(language);
	// Older rules stored quick days and week offsets as a number of days.
	if (expression === 'days:0') return strings.today;
	if (expression === 'days:1') return strings.tomorrow;
	if (expression === 'days:-1') return strings.yesterday;
	const [unit, offset] = expression.split(':');
	const amount = Number(offset);
	if (Number.isInteger(amount)) {
		const n = Math.abs(amount);
		if (unit === 'months') return amount > 0 ? strings.monthsFromNow(n) : strings.monthsAgo(n);
		if (unit === 'weeks' || (unit === 'days' && n % 7 === 0)) {
			const weeks = unit === 'weeks' ? n : n / 7;
			return amount > 0 ? strings.weeksFromNow(weeks) : strings.weeksAgo(weeks);
		}
		if (unit === 'days' || unit === 'offsetDays') return amount > 0 ? strings.daysFromNow(n) : strings.daysAgo(n);
	}
	return getRelativeDatePresets({ fieldKey: '', language }).find(item => item.rule === expression)?.primaryLabel ?? expression;
}
