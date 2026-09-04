import {
	DEFAULT_DATE_DISPLAY_FORMAT,
	normalizeDateDisplayFormat,
	type DateDisplayFormat,
	type OperonSettings,
} from '../types/settings';

export interface DateDisplayFormatOption {
	value: DateDisplayFormat;
	label: string;
}

export const DATE_DISPLAY_FORMAT_OPTIONS = [
	{ value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-09-03' },
	{ value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 03/09/2026' },
	{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY — 09/03/2026' },
] as const satisfies readonly DateDisplayFormatOption[];

type DateDisplaySettings = Pick<OperonSettings, 'dateDisplayFormat'>;

interface IsoDateParts {
	year: string;
	month: string;
	day: string;
}

export function getDateDisplayFormatDropdownOptions(): Record<DateDisplayFormat, string> {
	return Object.fromEntries(
		DATE_DISPLAY_FORMAT_OPTIONS.map(option => [option.value, option.label]),
	) as Record<DateDisplayFormat, string>;
}

export function formatUiDate(value: string, settings: DateDisplaySettings): string {
	const parts = parseIsoDate(value);
	if (!parts) return value;

	switch (normalizeDateDisplayFormat(settings.dateDisplayFormat)) {
		case 'DD/MM/YYYY':
			return `${parts.day}/${parts.month}/${parts.year}`;
		case 'MM/DD/YYYY':
			return `${parts.month}/${parts.day}/${parts.year}`;
		case DEFAULT_DATE_DISPLAY_FORMAT:
			return value;
	}
	return value;
}

export function formatUiDatePart(value: string, settings: DateDisplaySettings): string {
	const datePart = /^\d{4}-\d{2}-\d{2}$/u.test(value)
		? value
		: /^(\d{4}-\d{2}-\d{2})(?=[T ])/u.exec(value)?.[1];
	return datePart && parseIsoDate(datePart) ? formatUiDate(datePart, settings) : value;
}

function parseIsoDate(value: string): IsoDateParts | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	return { year: match[1], month: match[2], day: match[3] };
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
