import { App } from 'obsidian';
import { getCurrentLang } from '../../core/i18n';
import { getCommunityPlugin } from '../../core/obsidian-app';
import { isRecord, isUnknownFunction } from '../../core/unknown-value';
import { getDatePickerStrings, getQuickDateCandidates, parseFallbackDateCandidates } from './date-nlp-fallback';

export type DatePickerLang = 'en' | 'tr' | 'de' | 'fr';

export interface DateParseContext {
	fieldKey: string;
	language: DatePickerLang;
	referenceDate?: Date;
}

export interface DateParseCandidate {
	isoDate: string;
	primaryLabel: string;
	secondaryLabel?: string;
	source: 'nldates' | 'fallback' | 'quick';
	confidence: number;
	kind: 'nlp' | 'quick' | 'numeric-relative';
}

export interface DateNlpAdapter {
	parse(input: string, context: DateParseContext): DateParseCandidate[];
}

interface NldatesPlugin {
	parseDate: (text: string) => unknown;
}

interface DatePickerCandidateOptions {
	quickQuery?: string;
}

interface MomentLike {
	toDate: () => unknown;
}

export function resolveDatePickerLanguage(language?: string): DatePickerLang {
	if (language === 'tr') return 'tr';
	if (language === 'de') return 'de';
	if (language === 'fr') return 'fr';
	if (language === 'en') return 'en';
	// Date-picker natural-language parsing supports en/tr/de/fr.
	// Other UI locales fall back to English date phrases.
	const current = getCurrentLang();
	if (current === 'tr') return 'tr';
	if (current === 'de') return 'de';
	if (current === 'fr') return 'fr';
	return 'en';
}

export function getDatePickerLocaleStrings(language?: string) {
	return getDatePickerStrings(resolveDatePickerLanguage(language));
}

export function buildDatePickerCandidates(
	app: App | undefined,
	input: string,
	context: DateParseContext,
	options: DatePickerCandidateOptions = {},
): { parsed: DateParseCandidate[]; quick: DateParseCandidate[] } {
	const trimmed = input.trim();
	const quickQuery = options.quickQuery?.trim() ?? trimmed;
	const parsed: DateParseCandidate[] = [];
	const deterministic = trimmed ? parseFallbackDateCandidates(trimmed, context) : [];

	if (deterministic.length > 0) {
		parsed.push(...deterministic);
	} else if (trimmed) {
		const nldatesCandidate = parseWithNldates(app, trimmed, context);
		if (nldatesCandidate) parsed.push(nldatesCandidate);
		const fallback = parseFallbackDateCandidates(trimmed, context);
		parsed.push(...fallback);
	}

	return {
		parsed: dedupeCandidates(parsed),
		quick: dedupeCandidates(getQuickDateCandidates(context, quickQuery)),
	};
}

export function mergeDatePickerVisibleCandidates(
	parsedCandidates: DateParseCandidate[],
	quickCandidates: DateParseCandidate[],
	hiddenIsoDate = '',
): DateParseCandidate[] {
	const visibleCandidates: DateParseCandidate[] = [];
	const pushCandidate = (candidate: DateParseCandidate) => {
		if (hiddenIsoDate && candidate.isoDate === hiddenIsoDate) return;
		if (visibleCandidates.some(existing => existing.isoDate === candidate.isoDate)) return;
		visibleCandidates.push(candidate);
	};

	for (const candidate of parsedCandidates) {
		pushCandidate(candidate);
	}
	for (const candidate of quickCandidates) {
		pushCandidate(candidate);
	}

	return visibleCandidates;
}

function parseWithNldates(
	app: App | undefined,
	input: string,
	context: DateParseContext,
): DateParseCandidate | null {
	const plugin = resolveNldatesPlugin(app);
	if (!plugin) return null;

	try {
		const parsed = plugin.parseDate(input);
		const parsedRecord = isRecord(parsed) ? parsed : null;
		const dateValue = parsedRecord?.date;
		const momentValue = parsedRecord?.moment;
		const maybeMomentDate = isMomentLike(momentValue) ? momentValue.toDate() : null;
		const date = dateValue instanceof Date ? dateValue : maybeMomentDate;
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
		return {
			isoDate: toIsoDate(date),
			primaryLabel: formatLongDate(date, context.language),
			secondaryLabel: getDatePickerStrings(context.language).parsedFrom(input),
			source: 'nldates',
			confidence: 0.99,
			kind: 'nlp',
		};
	} catch {
		return null;
	}
}

function resolveNldatesPlugin(app: App | undefined): NldatesPlugin | null {
	const plugin = getCommunityPlugin(app, 'nldates-obsidian');
	if (!isNldatesPlugin(plugin)) return null;
	return {
		parseDate: (text: string): unknown => plugin.parseDate(text),
	};
}

function isNldatesPlugin(value: unknown): value is NldatesPlugin {
	return isRecord(value) && isUnknownFunction(value.parseDate);
}

function isMomentLike(value: unknown): value is MomentLike {
	return isRecord(value) && isUnknownFunction(value.toDate);
}

function dedupeCandidates(candidates: DateParseCandidate[]): DateParseCandidate[] {
	const byIso = new Map<string, { candidate: DateParseCandidate; order: number }>();
	for (const [order, candidate] of candidates.entries()) {
		const existing = byIso.get(candidate.isoDate);
		if (!existing || existing.candidate.confidence < candidate.confidence) {
			byIso.set(candidate.isoDate, { candidate, order: existing?.order ?? order });
		}
	}
	return [...byIso.values()]
		.sort((a, b) => a.order - b.order)
		.map(entry => entry.candidate);
}

function toIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function formatLongDate(date: Date, language: DatePickerLang): string {
	return new Intl.DateTimeFormat(datePickerLocale(language), {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}).format(date);
}

function datePickerLocale(language: DatePickerLang): string {
	if (language === 'tr') return 'tr-TR';
	if (language === 'de') return 'de-DE';
	if (language === 'fr') return 'fr-FR';
	return 'en-US';
}
