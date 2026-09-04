import { App } from 'obsidian';
import { parseLocalDatetime } from '../systems/tracker-utils';
import { OperonSettings } from '../types/settings';
import { formatUiDate } from './ui-date-format';
import { getAppLocale } from './obsidian-app';

type TimeFormatSettings = Pick<OperonSettings, 'timeFormat'>;
type TaskDatetimeDisplaySettings = Pick<OperonSettings, 'dateDisplayFormat' | 'timeFormat'>;

export function formatUiTimestamp(app: App, settings: TimeFormatSettings, value: string): string {
	const date = parseLocalDatetime(value);
	if (!date) return value;
	return new Intl.DateTimeFormat(getAppLocale(app), {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: settings.timeFormat === '12h',
	}).format(date);
}

export function formatUiTime(app: App, settings: TimeFormatSettings, value: string): string {
	const date = parseLocalDatetime(value);
	if (!date) return value;
	return new Intl.DateTimeFormat(getAppLocale(app), {
		hour: 'numeric',
		minute: '2-digit',
		hour12: settings.timeFormat === '12h',
	}).format(date);
}

export function formatUiTaskDatetime(app: App, settings: TaskDatetimeDisplaySettings, value: string): string {
	const trimmed = value.trim();
	const datePart = /^(\d{4}-\d{2}-\d{2})T/u.exec(trimmed)?.[1];
	if (!datePart) return value;
	const time = formatUiTime(app, settings, trimmed);
	if (time === trimmed) return value;
	return `${formatUiDate(datePart, settings)} ${time}`;
}

export function formatUiMinuteOfDay(app: App, settings: TimeFormatSettings, dateKey: string, minuteOfDay: number): string {
	const clamped = Math.max(0, Math.min(24 * 60, Math.round(minuteOfDay)));
	const displayMinute = clamped >= 24 * 60 ? (24 * 60) - 1 : clamped;
	const hours = String(Math.floor(displayMinute / 60)).padStart(2, '0');
	const minutes = String(displayMinute % 60).padStart(2, '0');
	return formatUiTime(app, settings, `${dateKey}T${hours}:${minutes}:00`);
}
