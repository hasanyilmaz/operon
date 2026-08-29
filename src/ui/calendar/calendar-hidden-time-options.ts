export interface CalendarHiddenTimeOption {
	value: string;
	label: string;
}

interface CalendarHiddenTimeOptionInput {
	boundary: 'start' | 'end';
	currentValue: string;
	otherValue: string;
}

const END_OF_DAY_VALUE = '23:59';

function parseClockMinutes(value: string): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const hour = Number.parseInt(match[1], 10);
	const minute = Number.parseInt(match[2], 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return (hour * 60) + minute;
}

function formatClockMinutes(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function buildCalendarHiddenTimeOptions(input: CalendarHiddenTimeOptionInput): CalendarHiddenTimeOption[] {
	const otherMinutes = parseClockMinutes(input.otherValue);
	const minimum = input.boundary === 'start' ? 0 : 30;
	const values: string[] = [];
	for (let minutes = minimum; minutes <= (23 * 60) + 30; minutes += 30) {
		const isValidForOtherBoundary = otherMinutes === null
			|| (input.boundary === 'start' ? minutes < otherMinutes : minutes > otherMinutes);
		if (isValidForOtherBoundary) values.push(formatClockMinutes(minutes));
	}
	if (input.boundary === 'end' && (otherMinutes === null || (23 * 60) + 59 > otherMinutes)) {
		values.push(END_OF_DAY_VALUE);
	}

	const currentMinutes = parseClockMinutes(input.currentValue);
	if (currentMinutes !== null && !values.includes(input.currentValue)) {
		values.push(input.currentValue);
		values.sort((left, right) => (parseClockMinutes(left) ?? 0) - (parseClockMinutes(right) ?? 0));
	}

	return values.map(value => ({ value, label: value }));
}
