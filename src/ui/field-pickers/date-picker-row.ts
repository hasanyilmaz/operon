import type { DateParseCandidate, DatePickerLang } from './date-nlp';

interface DatePickerCandidateDisplay {
	label: string;
	isoDate: string;
	weekday: string;
}

export function appendDatePickerCandidateRow(
	button: HTMLElement,
	candidate: DateParseCandidate,
	language: DatePickerLang,
): void {
	const display = formatDatePickerCandidateDisplay(candidate, language);
	const label = button.createSpan('operon-date-picker-item-label');
	label.textContent = display.label;
	const date = button.createSpan('operon-date-picker-item-date');
	date.textContent = display.isoDate;
	const weekday = button.createSpan('operon-date-picker-item-weekday');
	weekday.textContent = display.weekday;
}

function formatDatePickerCandidateDisplay(
	candidate: DateParseCandidate,
	language: DatePickerLang,
): DatePickerCandidateDisplay {
	return {
		label: candidate.primaryLabel,
		isoDate: candidate.isoDate,
		weekday: formatIsoWeekday(candidate.isoDate, language),
	};
}

function formatIsoWeekday(isoDate: string, language: DatePickerLang): string {
	const date = parseIsoDateAtLocalNoon(isoDate);
	if (!date) return '';
	return new Intl.DateTimeFormat(datePickerLocale(language), {
		weekday: 'long',
	}).format(date);
}

function datePickerLocale(language: DatePickerLang): string {
	if (language === 'tr') return 'tr-TR';
	if (language === 'de') return 'de-DE';
	if (language === 'fr') return 'fr-FR';
	return 'en-US';
}

function parseIsoDateAtLocalNoon(isoDate: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}
