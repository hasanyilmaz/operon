import { parseLocalDatetime } from '../../systems/tracker-utils';
import type { OperonSettings } from '../../types/settings';
import { getTableTaskField } from './table-field-catalog';

type TableDatetimeFormatSettings = Pick<OperonSettings, 'keyMappings' | 'timeFormat'>;

const TABLE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/u;

interface ParsedTableDatetime {
	date: string;
	hour: number;
	hourText: string;
	minute: string;
	second: string;
}

export function formatTableDetailedDatetimeValue(
	key: string,
	value: string,
	settings?: TableDatetimeFormatSettings,
): string {
	const isDatetime = settings
		? getTableTaskField(key, settings)?.type === 'datetime'
		: key === 'datetimeStart' || key === 'datetimeEnd';
	if (!isDatetime) return value;

	const parsed = parseTableDatetime(value);
	if (!parsed) return value;
	if (settings?.timeFormat !== '12h') {
		return `${parsed.date} ${parsed.hourText}:${parsed.minute}:${parsed.second}`;
	}
	return `${parsed.date} ${formatTwelveHour(parsed.hour)}:${parsed.minute}:${parsed.second} ${resolveDayPeriod(parsed.hour)}`;
}

export function formatTableCompactDatetimeValue(
	value: string,
	timeFormat: Pick<OperonSettings, 'timeFormat'>['timeFormat'] = '24h',
): string {
	const parsed = parseTableDatetime(value);
	if (!parsed) return value.trim();
	if (timeFormat !== '12h') return `${parsed.hourText}:${parsed.minute}`;
	return `${String(formatTwelveHour(parsed.hour)).padStart(2, '0')}:${parsed.minute} ${resolveDayPeriod(parsed.hour)}`;
}

function parseTableDatetime(value: string): ParsedTableDatetime | null {
	const match = TABLE_DATETIME_RE.exec(value.trim());
	if (!match) return null;
	const [, date, hourText, minute, second] = match;
	if (!parseLocalDatetime(`${date}T${hourText}:${minute}:${second}`)) return null;
	return {
		date,
		hour: Number(hourText),
		hourText,
		minute,
		second,
	};
}

function formatTwelveHour(hour: number): number {
	return hour % 12 || 12;
}

function resolveDayPeriod(hour: number): 'AM' | 'PM' {
	return hour < 12 ? 'AM' : 'PM';
}
