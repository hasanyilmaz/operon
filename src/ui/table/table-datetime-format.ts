import { parseLocalDatetime } from '../../systems/tracker-utils';
import type { OperonSettings } from '../../types/settings';
import type { TableSummaryFunction } from '../../types/table';
import { formatUiDate } from '../../core/ui-date-format';
import { getTableTaskField } from './table-field-catalog';

type TableDatetimeFormatSettings = Pick<OperonSettings, 'dateDisplayFormat' | 'keyMappings' | 'timeFormat'>;

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
	const fieldType = settings
		? getTableTaskField(key, settings)?.type
		: key === 'datetimeStart' || key === 'datetimeEnd' ? 'datetime' : null;
	if (fieldType === 'date') return settings ? formatUiDate(value, settings) : value;
	if (fieldType !== 'datetime') return value;

	const parsed = parseTableDatetime(value);
	if (!parsed) return value;
	const displayDate = settings ? formatUiDate(parsed.date, settings) : parsed.date;
	if (settings?.timeFormat !== '12h') {
		return `${displayDate} ${parsed.hourText}:${parsed.minute}:${parsed.second}`;
	}
	return `${displayDate} ${formatTwelveHour(parsed.hour)}:${parsed.minute}:${parsed.second} ${resolveDayPeriod(parsed.hour)}`;
}

export function formatTableTaskDateSummaryValue(
	key: string,
	value: string,
	summaryFunction: TableSummaryFunction,
	settings: TableDatetimeFormatSettings,
): string {
	if (summaryFunction !== 'TopValues') {
		return formatTableDetailedDatetimeValue(key, value, settings);
	}
	return value.split(', ').map(entry => {
		const countSeparatorIndex = entry.lastIndexOf(': ');
		if (countSeparatorIndex < 0) return entry;
		const rawValue = entry.slice(0, countSeparatorIndex);
		return `${formatTableDetailedDatetimeValue(key, rawValue, settings)}${entry.slice(countSeparatorIndex)}`;
	}).join(', ');
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
