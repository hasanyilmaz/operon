import { decodeVaultPropertyValue } from './vault-property-codec';

export type RepeatSkipDateResolver = (repeatSeriesId: string) => readonly string[];

/** The stored slot of this materialized task, not a forecast of its successor. */
export function getTaskOccurrenceDate(fields: Readonly<Record<string, string>>): string {
	const value = fields['repeatOccurrenceDate']?.trim();
	if (!value) return '';
	try {
		return decodeVaultPropertyValue(value, 'date') as string;
	} catch {
		return '';
	}
}

export function extractRepeatDatePart(value: string | null | undefined): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
	return '';
}
