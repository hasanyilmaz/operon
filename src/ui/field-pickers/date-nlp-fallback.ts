import { DateParseCandidate, DateParseContext, DatePickerLang } from './date-nlp';

interface DatePickerStrings {
	searchPlaceholder: string;
	clear: string;
	apply: string;
	manualDate: string;
	parsedFrom: (input: string) => string;
	quickSuggestions: string;
	today: string;
	tomorrow: string;
	yesterday: string;
	thisWeek: string;
	nextWeek: string;
	lastWeek: string;
	thisWeekend: string;
	nextWeekend: string;
	lastWeekend: string;
	daysAgo: (count: number) => string;
	daysFromNow: (count: number) => string;
	weeksAgo: (count: number) => string;
	weeksFromNow: (count: number) => string;
	monthsAgo: (count: number) => string;
	monthsFromNow: (count: number) => string;
	weekdayNames: string[];
	nextWeekdayLabel: (name: string) => string;
	lastWeekdayLabel: (name: string) => string;
}

const STRINGS: Record<DatePickerLang, DatePickerStrings> = {
	en: {
		searchPlaceholder: 'Type a date like next tuesday',
		clear: 'Clear',
		apply: 'Apply',
		manualDate: 'Pick a date',
		parsedFrom: input => `Parsed from "${input}"`,
		quickSuggestions: 'Suggestions',
		today: 'Today',
		tomorrow: 'Tomorrow',
		yesterday: 'Yesterday',
		thisWeek: 'This week',
		nextWeek: 'Next week',
		lastWeek: 'Last week',
		thisWeekend: 'This weekend',
		nextWeekend: 'Next weekend',
		lastWeekend: 'Last weekend',
		daysAgo: count => `${count} days ago`,
		daysFromNow: count => `${count} days from now`,
		weeksAgo: count => `${count} weeks ago`,
		weeksFromNow: count => `${count} weeks from now`,
		monthsAgo: count => `${count} months ago`,
		monthsFromNow: count => `${count} months from now`,
		weekdayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
		nextWeekdayLabel: name => `Next ${name}`,
		lastWeekdayLabel: name => `Last ${name}`,
	},
	tr: {
		searchPlaceholder: 'Gelecek sali gibi bir tarih yazin',
		clear: 'Temizle',
		apply: 'Uygula',
		manualDate: 'Tarih sec',
		parsedFrom: input => `"${input}" ifadesinden cozuldu`,
		quickSuggestions: 'Oneriler',
		today: 'Bugun',
		tomorrow: 'Yarin',
		yesterday: 'Dun',
		thisWeek: 'Bu hafta',
		nextWeek: 'Gelecek hafta',
		lastWeek: 'Gecen hafta',
		thisWeekend: 'Bu hafta sonu',
		nextWeekend: 'Gelecek hafta sonu',
		lastWeekend: 'Gecen hafta sonu',
		daysAgo: count => `${count} gun once`,
		daysFromNow: count => `${count} gun sonra`,
		weeksAgo: count => `${count} hafta once`,
		weeksFromNow: count => `${count} hafta sonra`,
		monthsAgo: count => `${count} ay once`,
		monthsFromNow: count => `${count} ay sonra`,
		weekdayNames: ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'],
		nextWeekdayLabel: name => `Gelecek ${name.toLowerCase()}`,
		lastWeekdayLabel: name => `Gecen ${name.toLowerCase()}`,
	},
	de: {
		searchPlaceholder: 'Ein Datum wie nächsten Dienstag eingeben',
		clear: 'Löschen',
		apply: 'Übernehmen',
		manualDate: 'Datum wählen',
		parsedFrom: input => `Aus "${input}" erkannt`,
		quickSuggestions: 'Vorschläge',
		today: 'Heute',
		tomorrow: 'Morgen',
		yesterday: 'Gestern',
		thisWeek: 'Diese Woche',
		nextWeek: 'Nächste Woche',
		lastWeek: 'Letzte Woche',
		thisWeekend: 'Dieses Wochenende',
		nextWeekend: 'Nächstes Wochenende',
		lastWeekend: 'Letztes Wochenende',
		daysAgo: count => `vor ${count} Tagen`,
		daysFromNow: count => `in ${count} Tagen`,
		weeksAgo: count => `vor ${count} Wochen`,
		weeksFromNow: count => `in ${count} Wochen`,
		monthsAgo: count => `vor ${count} Monaten`,
		monthsFromNow: count => `in ${count} Monaten`,
		weekdayNames: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
		nextWeekdayLabel: name => `Nächster ${name}`,
		lastWeekdayLabel: name => `Letzter ${name}`,
	},
	fr: {
		searchPlaceholder: 'Saisir une date comme mardi prochain',
		clear: 'Effacer',
		apply: 'Appliquer',
		manualDate: 'Choisir une date',
		parsedFrom: input => `Reconnu à partir de « ${input} »`,
		quickSuggestions: 'Suggestions',
		today: "Aujourd'hui",
		tomorrow: 'Demain',
		yesterday: 'Hier',
		thisWeek: 'Cette semaine',
		nextWeek: 'La semaine prochaine',
		lastWeek: 'La semaine dernière',
		thisWeekend: 'Ce week-end',
		nextWeekend: 'Le week-end prochain',
		lastWeekend: 'Le week-end dernier',
		daysAgo: count => `il y a ${count} jours`,
		daysFromNow: count => `dans ${count} jours`,
		weeksAgo: count => `il y a ${count} semaines`,
		weeksFromNow: count => `dans ${count} semaines`,
		monthsAgo: count => `il y a ${count} mois`,
		monthsFromNow: count => `dans ${count} mois`,
		weekdayNames: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
		nextWeekdayLabel: name => `${name} prochain`,
		lastWeekdayLabel: name => `${name} dernier`,
	},
};

const ENGLISH_PHRASES: Record<string, (reference: Date) => Date> = {
	today: reference => cloneDate(reference),
	tomorrow: reference => addDays(reference, 1),
	yesterday: reference => addDays(reference, -1),
	'this week': reference => startOfWeek(reference),
	'next week': reference => addDays(startOfWeek(reference), 7),
	'last week': reference => addDays(startOfWeek(reference), -7),
	'this weekend': reference => saturdayOfWeek(reference),
	'next weekend': reference => addDays(saturdayOfWeek(reference), 7),
	'last weekend': reference => addDays(saturdayOfWeek(reference), -7),
};

const TURKISH_PHRASES: Record<string, (reference: Date) => Date> = {
	'bugun': reference => cloneDate(reference),
	'yarin': reference => addDays(reference, 1),
	'dun': reference => addDays(reference, -1),
	'bu hafta': reference => startOfWeek(reference),
	'gelecek hafta': reference => addDays(startOfWeek(reference), 7),
	'gecen hafta': reference => addDays(startOfWeek(reference), -7),
	'bu hafta sonu': reference => saturdayOfWeek(reference),
	'gelecek hafta sonu': reference => addDays(saturdayOfWeek(reference), 7),
	'gecen hafta sonu': reference => addDays(saturdayOfWeek(reference), -7),
};

// Keys are normalizeInput()-form (lowercased, umlauts stripped): nächste → nachste.
const GERMAN_PHRASES: Record<string, (reference: Date) => Date> = {
	'heute': reference => cloneDate(reference),
	'morgen': reference => addDays(reference, 1),
	'gestern': reference => addDays(reference, -1),
	'diese woche': reference => startOfWeek(reference),
	'nachste woche': reference => addDays(startOfWeek(reference), 7),
	'letzte woche': reference => addDays(startOfWeek(reference), -7),
	'dieses wochenende': reference => saturdayOfWeek(reference),
	'nachstes wochenende': reference => addDays(saturdayOfWeek(reference), 7),
	'letztes wochenende': reference => addDays(saturdayOfWeek(reference), -7),
};

const ENGLISH_WEEKDAYS = new Map<string, number>([
	['sunday', 0],
	['monday', 1],
	['tuesday', 2],
	['wednesday', 3],
	['thursday', 4],
	['friday', 5],
	['saturday', 6],
]);

const TURKISH_WEEKDAYS = new Map<string, number>([
	['pazar', 0],
	['pazartesi', 1],
	['sali', 2],
	['salı', 2],
	['carsamba', 3],
	['çarşamba', 3],
	['persembe', 4],
	['perşembe', 4],
	['cuma', 5],
	['cumartesi', 6],
]);

const GERMAN_WEEKDAYS = new Map<string, number>([
	['sonntag', 0],
	['montag', 1],
	['dienstag', 2],
	['mittwoch', 3],
	['donnerstag', 4],
	['freitag', 5],
	['samstag', 6],
	['sonnabend', 6],
]);

// Phrase keys are normalizeInput()-form: lowercase, accents stripped.
const FRENCH_PHRASES: Record<string, (reference: Date) => Date> = {
	"aujourd'hui": reference => cloneDate(reference),
	'demain': reference => addDays(reference, 1),
	'hier': reference => addDays(reference, -1),
	'cette semaine': reference => startOfWeek(reference),
	'la semaine prochaine': reference => addDays(startOfWeek(reference), 7),
	'la semaine derniere': reference => addDays(startOfWeek(reference), -7),
	'ce week-end': reference => saturdayOfWeek(reference),
	'le week-end prochain': reference => addDays(saturdayOfWeek(reference), 7),
	'le week-end dernier': reference => addDays(saturdayOfWeek(reference), -7),
};

const FRENCH_WEEKDAYS = new Map<string, number>([
	['dimanche', 0],
	['lundi', 1],
	['mardi', 2],
	['mercredi', 3],
	['jeudi', 4],
	['vendredi', 5],
	['samedi', 6],
]);

export function getDatePickerStrings(language: DatePickerLang): DatePickerStrings {
	return STRINGS[language];
}

export function getQuickDateCandidates(context: DateParseContext, query = ''): DateParseCandidate[] {
	const strings = STRINGS[context.language];
	const reference = context.referenceDate ?? normalizedToday();
	const lowered = normalizeInput(query);
	const base: DateParseCandidate[] = [
		buildQuickCandidate(strings.today, cloneDate(reference), context),
		buildQuickCandidate(strings.tomorrow, addDays(reference, 1), context),
		buildQuickCandidate(strings.yesterday, addDays(reference, -1), context),
		buildQuickCandidate(strings.thisWeek, startOfWeek(reference), context),
		buildQuickCandidate(strings.nextWeek, addDays(startOfWeek(reference), 7), context),
		buildQuickCandidate(strings.lastWeek, addDays(startOfWeek(reference), -7), context),
		buildQuickCandidate(strings.thisWeekend, saturdayOfWeek(reference), context),
		buildQuickCandidate(strings.nextWeekend, addDays(saturdayOfWeek(reference), 7), context),
		buildQuickCandidate(strings.lastWeekend, addDays(saturdayOfWeek(reference), -7), context),
	];

	const weekdayNames = strings.weekdayNames;
	for (let day = 0; day <= 6; day++) {
		base.push(buildQuickCandidate(strings.nextWeekdayLabel(weekdayNames[day]), nextWeekday(reference, day), context));
		base.push(buildQuickCandidate(strings.lastWeekdayLabel(weekdayNames[day]), previousWeekday(reference, day), context));
	}

	if (!lowered) return base.slice(0, 8);
	return base.filter(candidate => normalizeInput(candidate.primaryLabel).includes(lowered)).slice(0, 12);
}

export function parseFallbackDateCandidates(input: string, context: DateParseContext): DateParseCandidate[] {
	const normalized = normalizeInput(input);
	if (!normalized) return [];

	const strings = STRINGS[context.language];
	const reference = context.referenceDate ?? normalizedToday();

	const numeric = parseNumericRelativeCandidates(normalized, strings, context, reference);
	if (numeric.length > 0) return numeric;

	const absolute = parseAbsoluteDate(normalized, context);
	if (absolute) return [absolute];

	const phraseDate = parsePhraseDate(normalized, context.language, reference);
	if (phraseDate) {
		return [{
			isoDate: toIsoDate(phraseDate),
			primaryLabel: formatLongDate(phraseDate, context.language),
			secondaryLabel: strings.parsedFrom(input.trim()),
			source: 'fallback',
			confidence: 0.96,
			kind: 'nlp',
		}];
	}

	return [];
}

function parsePhraseDate(input: string, language: DatePickerLang, reference: Date): Date | null {
	const phrases = language === 'tr'
		? TURKISH_PHRASES
		: language === 'de'
		? GERMAN_PHRASES
		: language === 'fr'
		? FRENCH_PHRASES
		: ENGLISH_PHRASES;
	const direct = phrases[input];
	if (direct) return direct(reference);

	const weekdays = language === 'tr'
		? TURKISH_WEEKDAYS
		: language === 'de'
		? GERMAN_WEEKDAYS
		: language === 'fr'
		? FRENCH_WEEKDAYS
		: ENGLISH_WEEKDAYS;

	if (weekdays.has(input)) {
		return nextWeekday(reference, weekdays.get(input)!);
	}

	// French places the qualifier after the weekday ('mardi prochain'/'mardi dernier').
	if (language === 'fr') {
		const nextSuffix = ' prochain';
		const lastSuffix = ' dernier';
		if (input.endsWith(nextSuffix)) {
			const weekday = input.slice(0, -nextSuffix.length).trim();
			if (weekdays.has(weekday)) return nextWeekday(reference, weekdays.get(weekday)!);
		}
		if (input.endsWith(lastSuffix)) {
			const weekday = input.slice(0, -lastSuffix.length).trim();
			if (weekdays.has(weekday)) return previousWeekday(reference, weekdays.get(weekday)!);
		}
		return null;
	}

	// Prefixes are normalizeInput()-form: 'nächste ' → 'nachste '.
	const nextPrefix = language === 'tr' ? 'gelecek ' : language === 'de' ? 'nachste ' : 'next ';
	const lastPrefix = language === 'tr' ? 'gecen ' : language === 'de' ? 'letzte ' : 'last ';

	if (input.startsWith(nextPrefix)) {
		const weekday = input.slice(nextPrefix.length).trim();
		if (weekdays.has(weekday)) return nextWeekday(reference, weekdays.get(weekday)!);
	}
	if (input.startsWith(lastPrefix)) {
		const weekday = input.slice(lastPrefix.length).trim();
		if (weekdays.has(weekday)) return previousWeekday(reference, weekdays.get(weekday)!);
	}

	return null;
}

function parseNumericRelativeCandidates(
	input: string,
	strings: DatePickerStrings,
	context: DateParseContext,
	reference: Date,
): DateParseCandidate[] {
	const match = /^(\d{1,3})(?:\s+([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+))?$/.exec(input);
	if (!match) return [];

	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return [];
	const unitToken = match[2] ?? '';
	const includeDays = matchesUnit(unitToken, context.language, 'days');
	const includeWeeks = matchesUnit(unitToken, context.language, 'weeks');
	const includeMonths = matchesUnit(unitToken, context.language, 'months');

	const candidates: DateParseCandidate[] = [];
	if (includeDays) {
		candidates.push(buildRelativeCandidate(strings.daysFromNow(amount), addDays(reference, amount), context));
	}
	if (includeWeeks) {
		candidates.push(buildRelativeCandidate(strings.weeksFromNow(amount), addDays(reference, amount * 7), context));
	}
	if (includeMonths) {
		candidates.push(buildRelativeCandidate(strings.monthsFromNow(amount), addMonths(reference, amount), context));
	}
	if (includeDays) {
		candidates.push(buildRelativeCandidate(strings.daysAgo(amount), addDays(reference, -amount), context));
	}
	if (includeWeeks) {
		candidates.push(buildRelativeCandidate(strings.weeksAgo(amount), addDays(reference, -amount * 7), context));
	}
	if (includeMonths) {
		candidates.push(buildRelativeCandidate(strings.monthsAgo(amount), addMonths(reference, -amount), context));
	}

	return candidates;
}

function matchesUnit(token: string, language: DatePickerLang, unit: 'days' | 'weeks' | 'months'): boolean {
	if (!token) return true;
	const lowered = normalizeInput(token);
	const prefixes: Record<typeof unit, string[]> = language === 'tr'
		? {
			days: ['g', 'gu', 'gun'],
			weeks: ['h', 'ha', 'haf', 'hafta'],
			months: ['a', 'ay'],
		}
		: language === 'de'
		? {
			days: ['t', 'ta', 'tag', 'tage'],
			weeks: ['w', 'wo', 'woc', 'woche', 'wochen'],
			months: ['m', 'mo', 'mon', 'monat', 'monate'],
		}
		: language === 'fr'
		? {
			days: ['j', 'jo', 'jou', 'jour', 'jours'],
			weeks: ['s', 'se', 'sem', 'semaine', 'semaines'],
			months: ['m', 'mo', 'moi', 'mois'],
		}
		: {
			days: ['d', 'da', 'day', 'days'],
			weeks: ['w', 'we', 'wee', 'week', 'weeks'],
			months: ['m', 'mo', 'mon', 'month', 'months'],
		};
	return prefixes[unit].some(prefix => prefix.startsWith(lowered) || lowered.startsWith(prefix));
}

function parseAbsoluteDate(input: string, context: DateParseContext): DateParseCandidate | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
	const [year, month, day] = input.split('-').map(Number);
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return {
		isoDate: input,
		primaryLabel: formatLongDate(date, context.language),
		secondaryLabel: input,
		source: 'fallback',
		confidence: 0.98,
		kind: 'nlp',
	};
}

function buildQuickCandidate(label: string, date: Date, context: DateParseContext): DateParseCandidate {
	return {
		isoDate: toIsoDate(date),
		primaryLabel: label,
		secondaryLabel: formatLongDate(date, context.language),
		source: 'quick',
		confidence: 0.72,
		kind: 'quick',
	};
}

function buildRelativeCandidate(label: string, date: Date, context: DateParseContext): DateParseCandidate {
	return {
		isoDate: toIsoDate(date),
		primaryLabel: label,
		secondaryLabel: formatLongDate(date, context.language),
		source: 'fallback',
		confidence: 0.9,
		kind: 'numeric-relative',
	};
}

function normalizedToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

function cloneDate(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
	const next = cloneDate(date);
	next.setDate(next.getDate() + days);
	return next;
}

function addMonths(date: Date, months: number): Date {
	const next = cloneDate(date);
	next.setMonth(next.getMonth() + months);
	return next;
}

function startOfWeek(date: Date): Date {
	const next = cloneDate(date);
	const dayIndex = (next.getDay() + 6) % 7;
	next.setDate(next.getDate() - dayIndex);
	return next;
}

function saturdayOfWeek(date: Date): Date {
	return addDays(startOfWeek(date), 5);
}

function nextWeekday(date: Date, weekday: number): Date {
	const next = cloneDate(date);
	const current = next.getDay();
	let diff = (weekday - current + 7) % 7;
	if (diff === 0) diff = 7;
	next.setDate(next.getDate() + diff);
	return next;
}

function previousWeekday(date: Date, weekday: number): Date {
	const next = cloneDate(date);
	const current = next.getDay();
	let diff = (current - weekday + 7) % 7;
	if (diff === 0) diff = 7;
	next.setDate(next.getDate() - diff);
	return next;
}

function toIsoDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function formatLongDate(date: Date, language: DatePickerLang): string {
	return new Intl.DateTimeFormat(language === 'tr' ? 'tr-TR' : language === 'de' ? 'de-DE' : language === 'fr' ? 'fr-FR' : 'en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}).format(date);
}

function normalizeInput(input: string): string {
	return input
		.trim()
		.toLocaleLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ');
}
