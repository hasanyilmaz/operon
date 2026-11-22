import { getDatePickerStrings, normalizeDatePickerSearch } from './date-nlp-fallback';
import type { DateParseCandidate, DatePickerLang } from './date-nlp';

export function automationDateLabel(expression: string, language: DatePickerLang): string {
	const strings = getDatePickerStrings(language);
	switch (expression) {
		case 'days:0': return strings.today;
		case 'days:1': return strings.tomorrow;
		case 'days:-1': return strings.yesterday;
		case 'nextWeekend': return strings.nextWeekend;
	}
	const days = Number(expression.slice(5));
	if (!expression.startsWith('days:') || !Number.isSafeInteger(days)) return expression;
	const weeks = days % 7 === 0;
	return new Intl.RelativeTimeFormat(language).format(weeks ? days / 7 : days, weeks ? 'week' : 'day');
}

export interface AutomationDateOption {
	label: string;
	expression?: string;
}

export function automationDateOptions(query: string, language: DatePickerLang, parsed: readonly DateParseCandidate[]): AutomationDateOption[] {
	const strings = getDatePickerStrings(language);
	const search = normalizeDatePickerSearch(query);
	const relative: AutomationDateOption[] = [];
	const add = (expression: string) => relative.push({ expression, label: automationDateLabel(expression, language) });
	for (const expression of ['days:0', 'days:1', 'nextWeekend', 'days:-1']) {
		if ((!search && expression !== 'days:-1') || (search && normalizeDatePickerSearch(automationDateLabel(expression, language)).includes(search))) add(expression);
	}

	// Match the NLP candidate's unit and direction. Two expressions can resolve to the same day today.
	const number = /\d+/u.exec(search);
	if (number && number[0].length <= 3 && Number(number[0]) > 0) {
		const amount = Number(number[0]);
		const formatter = new Intl.RelativeTimeFormat(language);
		for (const [unit, multiplier, future, past] of [
			['day', 1, strings.daysFromNow, strings.daysAgo],
			['week', 7, strings.weeksFromNow, strings.weeksAgo],
		] as const) {
			for (const sign of [1, -1]) {
				const label = sign > 0 ? future(amount) : past(amount);
				const aliases = [label, formatter.format(sign * amount, unit)];
				if (language === 'en' && amount === 1 && sign > 0) aliases.push('1 ' + unit + ' from now');
				if (parsed.some(item => item.kind === 'numeric-relative' && item.primaryLabel === label)
					|| aliases.some(alias => normalizeDatePickerSearch(alias) === search)) add('days:' + sign * amount * multiplier);
			}
		}
	}
	// An exact parsed phrase (for example "next week") takes precedence over
	// a partial quick suggestion ("Next weekend"). Keep prefix search for third-party guesses.
	const parsedPhrase = parsed.some(item => item.source === 'fallback' && item.kind === 'nlp');
	if (relative.length && (!search || !parsedPhrase || relative.some(item => normalizeDatePickerSearch(item.label) === search))) return relative;
	return parsed.map(item => ({ label: item.isoDate }));
}
