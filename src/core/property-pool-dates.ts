import { getRelativeDatePresets, normalizeDatePickerSearch } from '../ui/field-pickers/date-nlp-fallback';
import { resolveDatePickerLanguage } from '../ui/field-pickers/date-nlp';

export const PROPERTY_POOL_DATE_KEYS = ['dateDue', 'dateScheduled', 'dateStarted', 'dateCompleted', 'dateCancelled'] as const;
export function isPropertyPoolDateRule(value: string): boolean {
	return /^(today|tomorrow|yesterday|thisWeek|nextWeek|lastWeek|thisWeekend|nextWeekend|lastWeekend|nextDay:[0-6]|lastDay:[0-6])$/.test(value);
}
export function propertyPoolDateContext(now = new Date()): string {
	return JSON.stringify([now.getFullYear(), now.getMonth(), now.getDate(), now.getTimezoneOffset(), Intl.DateTimeFormat().resolvedOptions().timeZone]);
}
export function propertyPoolDatePresets(key: string, now = new Date()) {
	const language = resolveDatePickerLanguage();
	const context = { fieldKey: key, referenceDate: now, language };
	const aliases = [getRelativeDatePresets({ ...context, language: 'en' }), getRelativeDatePresets({ ...context, language: 'tr' })];
	return getRelativeDatePresets(context).map(candidate => ({ ...candidate,
		searchText: [candidate.primaryLabel, ...aliases.flatMap(items => items.filter(item => item.rule === candidate.rule).map(item => item.primaryLabel))].join(' '),
	}));
}
export function resolvePropertyPoolDate(key: string, rule: string, now = new Date()): string | null {
	return getRelativeDatePresets({ fieldKey: key, language: 'en', referenceDate: now }).find(item => item.rule === rule)?.isoDate ?? null;
}

export function matchesPropertyPoolDateSearch(searchText: string, query: string): boolean {
	const text = normalizeDatePickerSearch(searchText);
	return normalizeDatePickerSearch(query).split(/\s+/).filter(Boolean).every(token => text.includes(token));
}

export function propertyPoolDateViewContext(): string {
	return `${propertyPoolDateContext()}:${resolveDatePickerLanguage()}`;
}
