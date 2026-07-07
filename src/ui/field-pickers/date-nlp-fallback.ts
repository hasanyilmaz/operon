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

interface MonthAlias {
	month: number;
	aliases: string[];
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
	es: {
		searchPlaceholder: 'Escribir una fecha como próximo martes',
		clear: 'Limpiar',
		apply: 'Aplicar',
		manualDate: 'Elegir una fecha',
		parsedFrom: input => `Reconocido de "${input}"`,
		quickSuggestions: 'Sugerencias',
		today: 'Hoy',
		tomorrow: 'Mañana',
		yesterday: 'Ayer',
		thisWeek: 'Esta semana',
		nextWeek: 'La próxima semana',
		lastWeek: 'La semana pasada',
		thisWeekend: 'Este fin de semana',
		nextWeekend: 'El próximo fin de semana',
		lastWeekend: 'El fin de semana pasado',
		daysAgo: count => `hace ${count} días`,
		daysFromNow: count => `dentro de ${count} días`,
		weeksAgo: count => `hace ${count} semanas`,
		weeksFromNow: count => `dentro de ${count} semanas`,
		monthsAgo: count => `hace ${count} meses`,
		monthsFromNow: count => `dentro de ${count} meses`,
		weekdayNames: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
		nextWeekdayLabel: name => `Próximo ${name}`,
		lastWeekdayLabel: name => `${name} pasado`,
	},
	'zh-CN': {
		searchPlaceholder: '输入日期，如 下周二',
		clear: '清除',
		apply: '应用',
		manualDate: '选择日期',
		parsedFrom: input => `从“${input}”解析`,
		quickSuggestions: '建议',
		today: '今天',
		tomorrow: '明天',
		yesterday: '昨天',
		thisWeek: '本周',
		nextWeek: '下周',
		lastWeek: '上周',
		thisWeekend: '本周末',
		nextWeekend: '下周末',
		lastWeekend: '上周末',
		daysAgo: count => `${count}天前`,
		daysFromNow: count => `${count}天后`,
		weeksAgo: count => `${count}周前`,
		weeksFromNow: count => `${count}周后`,
		monthsAgo: count => `${count}个月前`,
		monthsFromNow: count => `${count}个月后`,
		weekdayNames: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
		nextWeekdayLabel: name => `下${name}`,
		lastWeekdayLabel: name => `上${name}`,
	},
	'zh-TW': {
		searchPlaceholder: '輸入日期，例如 下週二',
		clear: '清除',
		apply: '套用',
		manualDate: '選擇日期',
		parsedFrom: input => `從「${input}」解析`,
		quickSuggestions: '建議',
		today: '今天',
		tomorrow: '明天',
		yesterday: '昨天',
		thisWeek: '本週',
		nextWeek: '下週',
		lastWeek: '上週',
		thisWeekend: '本週末',
		nextWeekend: '下週末',
		lastWeekend: '上週末',
		daysAgo: count => `${count}天前`,
		daysFromNow: count => `${count}天後`,
		weeksAgo: count => `${count}週前`,
		weeksFromNow: count => `${count}週後`,
		monthsAgo: count => `${count}個月前`,
		monthsFromNow: count => `${count}個月後`,
		weekdayNames: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
		nextWeekdayLabel: name => `下${name}`,
		lastWeekdayLabel: name => `上${name}`,
	},
	ja: {
		searchPlaceholder: '日付を入力（例: 来週火曜日）',
		clear: 'クリア',
		apply: '適用',
		manualDate: '日付を選択',
		parsedFrom: input => `「${input}」から解析`,
		quickSuggestions: '候補',
		today: '今日',
		tomorrow: '明日',
		yesterday: '昨日',
		thisWeek: '今週',
		nextWeek: '来週',
		lastWeek: '先週',
		thisWeekend: '今週末',
		nextWeekend: '来週末',
		lastWeekend: '先週末',
		daysAgo: count => `${count}日前`,
		daysFromNow: count => `${count}日後`,
		weeksAgo: count => `${count}週間前`,
		weeksFromNow: count => `${count}週間後`,
		monthsAgo: count => `${count}ヶ月前`,
		monthsFromNow: count => `${count}ヶ月後`,
		weekdayNames: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
		nextWeekdayLabel: name => `来週${name}`,
		lastWeekdayLabel: name => `先週${name}`,
	},
	ru: {
		searchPlaceholder: 'Введите дату, например следующий вторник',
		clear: 'Очистить',
		apply: 'Применить',
		manualDate: 'Выбрать дату',
		parsedFrom: input => `Распознано из «${input}»`,
		quickSuggestions: 'Предложения',
		today: 'Сегодня',
		tomorrow: 'Завтра',
		yesterday: 'Вчера',
		thisWeek: 'Эта неделя',
		nextWeek: 'Следующая неделя',
		lastWeek: 'Прошлая неделя',
		thisWeekend: 'Эти выходные',
		nextWeekend: 'Следующие выходные',
		lastWeekend: 'Прошлые выходные',
		daysAgo: count => `${count} дн. назад`,
		daysFromNow: count => `через ${count} дн.`,
		weeksAgo: count => `${count} нед. назад`,
		weeksFromNow: count => `через ${count} нед.`,
		monthsAgo: count => `${count} мес. назад`,
		monthsFromNow: count => `через ${count} мес.`,
		weekdayNames: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
		nextWeekdayLabel: name => `Следующий ${name}`,
		lastWeekdayLabel: name => `Прошлый ${name}`,
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

// Phrase keys are normalizeInput()-form: lowercase, accents stripped (mañana → manana, próxima → proxima).
const SPANISH_PHRASES: Record<string, (reference: Date) => Date> = {
	'hoy': reference => cloneDate(reference),
	'manana': reference => addDays(reference, 1),
	'ayer': reference => addDays(reference, -1),
	'esta semana': reference => startOfWeek(reference),
	'proxima semana': reference => addDays(startOfWeek(reference), 7),
	'la proxima semana': reference => addDays(startOfWeek(reference), 7),
	'semana proxima': reference => addDays(startOfWeek(reference), 7),
	'semana pasada': reference => addDays(startOfWeek(reference), -7),
	'la semana pasada': reference => addDays(startOfWeek(reference), -7),
	'este fin de semana': reference => saturdayOfWeek(reference),
	'proximo fin de semana': reference => addDays(saturdayOfWeek(reference), 7),
	'el proximo fin de semana': reference => addDays(saturdayOfWeek(reference), 7),
	'fin de semana proximo': reference => addDays(saturdayOfWeek(reference), 7),
	'fin de semana pasado': reference => addDays(saturdayOfWeek(reference), -7),
	'el fin de semana pasado': reference => addDays(saturdayOfWeek(reference), -7),
};

const SPANISH_WEEKDAYS = new Map<string, number>([
	['domingo', 0],
	['lunes', 1],
	['martes', 2],
	['miercoles', 3],
	['miércoles', 3],
	['jueves', 4],
	['viernes', 5],
	['sabado', 6],
	['sábado', 6],
]);

// Phrase keys are normalizeInput()-form: lowercase, and 'й' normalized away to
// 'и' (NFKD decomposes й into и + combining breve U+0306, which normalizeInput's
// diacritic strip removes) — этой → этои, следующей → следующеи, прошлой → прошлои.
const RUSSIAN_PHRASES: Record<string, (reference: Date) => Date> = {
	'сегодня': reference => cloneDate(reference),
	'завтра': reference => addDays(reference, 1),
	'вчера': reference => addDays(reference, -1),
	'эта неделя': reference => startOfWeek(reference),
	'на этои неделе': reference => startOfWeek(reference),
	'следующая неделя': reference => addDays(startOfWeek(reference), 7),
	'на следующеи неделе': reference => addDays(startOfWeek(reference), 7),
	'прошлая неделя': reference => addDays(startOfWeek(reference), -7),
	'на прошлои неделе': reference => addDays(startOfWeek(reference), -7),
	'эти выходные': reference => saturdayOfWeek(reference),
	'следующие выходные': reference => addDays(saturdayOfWeek(reference), 7),
	'прошлые выходные': reference => addDays(saturdayOfWeek(reference), -7),
};

// Feminine weekdays (среда/пятница/суббота) also get their accusative form mapped
// to the same day, since 'в прошлую <weekday>'/'в следующую <weekday>' (preposition
// 'в' + accusative) is the natural phrasing, distinct from the bare nominative form.
const RUSSIAN_WEEKDAYS = new Map<string, number>([
	['воскресенье', 0],
	['понедельник', 1],
	['вторник', 2],
	['среда', 3],
	['среду', 3],
	['четверг', 4],
	['пятница', 5],
	['пятницу', 5],
	['суббота', 6],
	['субботу', 6],
]);

// Chinese relative-date phrases. Keys cover both Simplified and Traditional
// variants so one map serves zh-CN and zh-TW. Chinese has no inter-word spaces,
// so matching is whole-string equality rather than prefix + space + token.
const CHINESE_PHRASES: Record<string, (reference: Date) => Date> = {
	'今天': reference => cloneDate(reference),
	'今日': reference => cloneDate(reference),
	'明天': reference => addDays(reference, 1),
	'明日': reference => addDays(reference, 1),
	'后天': reference => addDays(reference, 2),
	'後天': reference => addDays(reference, 2),
	'昨天': reference => addDays(reference, -1),
	'昨日': reference => addDays(reference, -1),
	'前天': reference => addDays(reference, -2),
	'这周': reference => startOfWeek(reference),
	'這週': reference => startOfWeek(reference),
	'本周': reference => startOfWeek(reference),
	'本週': reference => startOfWeek(reference),
	'这星期': reference => startOfWeek(reference),
	'這星期': reference => startOfWeek(reference),
	'下周': reference => addDays(startOfWeek(reference), 7),
	'下週': reference => addDays(startOfWeek(reference), 7),
	'下星期': reference => addDays(startOfWeek(reference), 7),
	'上周': reference => addDays(startOfWeek(reference), -7),
	'上週': reference => addDays(startOfWeek(reference), -7),
	'上星期': reference => addDays(startOfWeek(reference), -7),
	'这周末': reference => saturdayOfWeek(reference),
	'這週末': reference => saturdayOfWeek(reference),
	'本周末': reference => saturdayOfWeek(reference),
	'本週末': reference => saturdayOfWeek(reference),
	'下周末': reference => addDays(saturdayOfWeek(reference), 7),
	'下週末': reference => addDays(saturdayOfWeek(reference), 7),
	'上周末': reference => addDays(saturdayOfWeek(reference), -7),
	'上週末': reference => addDays(saturdayOfWeek(reference), -7),
};

// Weekday day-characters → JS getDay() index (0 = Sunday). 日/天 both mean Sunday.
const CHINESE_WEEKDAY_CHARS: Record<string, number> = {
	'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0,
};

// Japanese relative-date phrases. Japanese is spaceless, so matching is whole-string
// equality. Kanji forms plus the most common kana spellings (きょう/あした/…).
const JAPANESE_PHRASES: Record<string, (reference: Date) => Date> = {
	'今日': reference => cloneDate(reference),
	'きょう': reference => cloneDate(reference),
	'本日': reference => cloneDate(reference),
	'明日': reference => addDays(reference, 1),
	'あした': reference => addDays(reference, 1),
	'あす': reference => addDays(reference, 1),
	'明後日': reference => addDays(reference, 2),
	'あさって': reference => addDays(reference, 2),
	'昨日': reference => addDays(reference, -1),
	'きのう': reference => addDays(reference, -1),
	'一昨日': reference => addDays(reference, -2),
	'おととい': reference => addDays(reference, -2),
	'今週': reference => startOfWeek(reference),
	'来週': reference => addDays(startOfWeek(reference), 7),
	'先週': reference => addDays(startOfWeek(reference), -7),
	'今週末': reference => saturdayOfWeek(reference),
	'来週末': reference => addDays(saturdayOfWeek(reference), 7),
	'先週末': reference => addDays(saturdayOfWeek(reference), -7),
};

// Weekday day-characters → JS getDay() index (0 = Sunday). 日 means Sunday (日曜日).
const JAPANESE_WEEKDAY_CHARS: Record<string, number> = {
	'日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6,
};

const MONTH_ALIASES: Record<DatePickerLang, MonthAlias[]> = {
	en: [
		{ month: 1, aliases: ['january', 'jan'] },
		{ month: 2, aliases: ['february', 'feb'] },
		{ month: 3, aliases: ['march', 'mar'] },
		{ month: 4, aliases: ['april', 'apr'] },
		{ month: 5, aliases: ['may'] },
		{ month: 6, aliases: ['june', 'jun'] },
		{ month: 7, aliases: ['july', 'jul'] },
		{ month: 8, aliases: ['august', 'aug'] },
		{ month: 9, aliases: ['september', 'sept', 'sep'] },
		{ month: 10, aliases: ['october', 'oct'] },
		{ month: 11, aliases: ['november', 'nov'] },
		{ month: 12, aliases: ['december', 'dec'] },
	],
	tr: [
		{ month: 1, aliases: ['ocak', 'oca'] },
		{ month: 2, aliases: ['subat', 'şubat', 'sub'] },
		{ month: 3, aliases: ['mart', 'mar'] },
		{ month: 4, aliases: ['nisan', 'nis'] },
		{ month: 5, aliases: ['mayis', 'mayıs', 'may'] },
		{ month: 6, aliases: ['haziran', 'haz'] },
		{ month: 7, aliases: ['temmuz', 'tem'] },
		{ month: 8, aliases: ['agustos', 'ağustos', 'agu', 'ağu'] },
		{ month: 9, aliases: ['eylul', 'eylül', 'eyl'] },
		{ month: 10, aliases: ['ekim', 'eki'] },
		{ month: 11, aliases: ['kasim', 'kasım', 'kas'] },
		{ month: 12, aliases: ['aralik', 'aralık', 'ara'] },
	],
	de: [
		{ month: 1, aliases: ['januar', 'jan'] },
		{ month: 2, aliases: ['februar', 'feb'] },
		{ month: 3, aliases: ['marz', 'märz', 'mar', 'mär'] },
		{ month: 4, aliases: ['april', 'apr'] },
		{ month: 5, aliases: ['mai'] },
		{ month: 6, aliases: ['juni', 'jun'] },
		{ month: 7, aliases: ['juli', 'jul'] },
		{ month: 8, aliases: ['august', 'aug'] },
		{ month: 9, aliases: ['september', 'sept', 'sep'] },
		{ month: 10, aliases: ['oktober', 'okt'] },
		{ month: 11, aliases: ['november', 'nov'] },
		{ month: 12, aliases: ['dezember', 'dez'] },
	],
	fr: [
		{ month: 1, aliases: ['janvier', 'janv', 'jan'] },
		{ month: 2, aliases: ['fevrier', 'février', 'fev', 'fév'] },
		{ month: 3, aliases: ['mars', 'mar'] },
		{ month: 4, aliases: ['avril', 'avr'] },
		{ month: 5, aliases: ['mai'] },
		{ month: 6, aliases: ['juin', 'ju'] },
		{ month: 7, aliases: ['juillet', 'juil', 'jul'] },
		{ month: 8, aliases: ['aout', 'août'] },
		{ month: 9, aliases: ['septembre', 'sept', 'sep'] },
		{ month: 10, aliases: ['octobre', 'oct'] },
		{ month: 11, aliases: ['novembre', 'nov'] },
		{ month: 12, aliases: ['decembre', 'décembre', 'dec', 'déc'] },
	],
	es: [
		{ month: 1, aliases: ['enero', 'ene'] },
		{ month: 2, aliases: ['febrero', 'feb'] },
		{ month: 3, aliases: ['marzo', 'mar'] },
		{ month: 4, aliases: ['abril', 'abr'] },
		{ month: 5, aliases: ['mayo', 'may'] },
		{ month: 6, aliases: ['junio', 'jun'] },
		{ month: 7, aliases: ['julio', 'jul'] },
		{ month: 8, aliases: ['agosto', 'ago'] },
		{ month: 9, aliases: ['septiembre', 'setiembre', 'sept', 'sep'] },
		{ month: 10, aliases: ['octubre', 'oct'] },
		{ month: 11, aliases: ['noviembre', 'nov'] },
		{ month: 12, aliases: ['diciembre', 'dic'] },
	],
	// Chinese month-day input is parsed by the dedicated Chinese path (digits + 月/日),
	// so these aliases exist mainly to satisfy the Record type.
	'zh-CN': [
		{ month: 1, aliases: ['一月'] },
		{ month: 2, aliases: ['二月'] },
		{ month: 3, aliases: ['三月'] },
		{ month: 4, aliases: ['四月'] },
		{ month: 5, aliases: ['五月'] },
		{ month: 6, aliases: ['六月'] },
		{ month: 7, aliases: ['七月'] },
		{ month: 8, aliases: ['八月'] },
		{ month: 9, aliases: ['九月'] },
		{ month: 10, aliases: ['十月'] },
		{ month: 11, aliases: ['十一月'] },
		{ month: 12, aliases: ['十二月'] },
	],
	'zh-TW': [
		{ month: 1, aliases: ['一月'] },
		{ month: 2, aliases: ['二月'] },
		{ month: 3, aliases: ['三月'] },
		{ month: 4, aliases: ['四月'] },
		{ month: 5, aliases: ['五月'] },
		{ month: 6, aliases: ['六月'] },
		{ month: 7, aliases: ['七月'] },
		{ month: 8, aliases: ['八月'] },
		{ month: 9, aliases: ['九月'] },
		{ month: 10, aliases: ['十月'] },
		{ month: 11, aliases: ['十一月'] },
		{ month: 12, aliases: ['十二月'] },
	],
	// Japanese month-day input is parsed by the dedicated Japanese path (digits + 月/日),
	// so these aliases exist mainly to satisfy the Record type.
	ja: [
		{ month: 1, aliases: ['1月'] },
		{ month: 2, aliases: ['2月'] },
		{ month: 3, aliases: ['3月'] },
		{ month: 4, aliases: ['4月'] },
		{ month: 5, aliases: ['5月'] },
		{ month: 6, aliases: ['6月'] },
		{ month: 7, aliases: ['7月'] },
		{ month: 8, aliases: ['8月'] },
		{ month: 9, aliases: ['9月'] },
		{ month: 10, aliases: ['10月'] },
		{ month: 11, aliases: ['11月'] },
		{ month: 12, aliases: ['12月'] },
	],
	ru: [
		{ month: 1, aliases: ['январь', 'января', 'янв'] },
		{ month: 2, aliases: ['февраль', 'февраля', 'фев'] },
		{ month: 3, aliases: ['март', 'марта', 'мар'] },
		{ month: 4, aliases: ['апрель', 'апреля', 'апр'] },
		{ month: 5, aliases: ['май', 'мая'] },
		{ month: 6, aliases: ['июнь', 'июня', 'июн'] },
		{ month: 7, aliases: ['июль', 'июля', 'июл'] },
		{ month: 8, aliases: ['август', 'августа', 'авг'] },
		{ month: 9, aliases: ['сентябрь', 'сентября', 'сен', 'сент'] },
		{ month: 10, aliases: ['октябрь', 'октября', 'окт'] },
		{ month: 11, aliases: ['ноябрь', 'ноября', 'ноя', 'нояб'] },
		{ month: 12, aliases: ['декабрь', 'декабря', 'дек'] },
	],
};

export function getDatePickerStrings(language: DatePickerLang): DatePickerStrings {
	return STRINGS[language];
}

export function getQuickDateCandidates(context: DateParseContext, query = ''): DateParseCandidate[] {
	const strings = STRINGS[context.language];
	const reference = context.referenceDate ?? normalizedToday();
	const lowered = normalizeInput(query);
	const referenceIso = toIsoDate(reference);
	const today = buildQuickCandidate(strings.today, cloneDate(reference), context);
	const tomorrow = buildQuickCandidate(strings.tomorrow, addDays(reference, 1), context);
	const yesterday = buildQuickCandidate(strings.yesterday, addDays(reference, -1), context);
	const thisWeek = buildQuickCandidate(strings.thisWeek, startOfWeek(reference), context);
	const nextWeek = buildQuickCandidate(strings.nextWeek, addDays(startOfWeek(reference), 7), context);
	const lastWeek = buildQuickCandidate(strings.lastWeek, addDays(startOfWeek(reference), -7), context);
	const thisWeekend = buildQuickCandidate(strings.thisWeekend, saturdayOfWeek(reference), context);
	const nextWeekend = buildQuickCandidate(strings.nextWeekend, addDays(saturdayOfWeek(reference), 7), context);
	const lastWeekend = buildQuickCandidate(strings.lastWeekend, addDays(saturdayOfWeek(reference), -7), context);
	const defaultBase: DateParseCandidate[] = [
		today,
		tomorrow,
		thisWeek,
		nextWeek,
		thisWeekend,
		nextWeekend,
	];
	const base: DateParseCandidate[] = [
		today,
		tomorrow,
		yesterday,
		thisWeek,
		nextWeek,
		lastWeek,
		thisWeekend,
		nextWeekend,
		lastWeekend,
	];

	const weekdayNames = strings.weekdayNames;
	for (let day = 0; day <= 6; day++) {
		base.push(buildQuickCandidate(strings.nextWeekdayLabel(weekdayNames[day]), nextWeekday(reference, day), context));
		base.push(buildQuickCandidate(strings.lastWeekdayLabel(weekdayNames[day]), previousWeekday(reference, day), context));
	}

	if (!lowered) return sortCandidatesByReference(defaultBase.filter(candidate => candidate.isoDate >= referenceIso), reference);
	return sortCandidatesByReference(base.filter(candidate => normalizeInput(candidate.primaryLabel).includes(lowered)), reference).slice(0, 12);
}

export function parseFallbackDateCandidates(input: string, context: DateParseContext): DateParseCandidate[] {
	const normalized = normalizeInput(input);
	if (!normalized) return [];

	const strings = STRINGS[context.language];
	const reference = context.referenceDate ?? normalizedToday();

	// Chinese grammar is spaceless and orders dates month→day, so it uses a
	// dedicated parser instead of the Latin-script numeric/day-month regexes.
	if (context.language === 'zh-CN' || context.language === 'zh-TW') {
		const chinese = parseChineseCandidates(normalized, strings, context, reference);
		if (chinese.length > 0) {
			return sortCandidatesByReference(dedupeDateCandidates(chinese), reference);
		}
		const absolute = parseAbsoluteDate(normalized, context);
		if (absolute) return [absolute];
		return [];
	}

	// Japanese is likewise spaceless and orders dates month→day, so it uses a
	// dedicated parser instead of the Latin-script numeric/day-month regexes.
	if (context.language === 'ja') {
		const japanese = parseJapaneseCandidates(normalized, strings, context, reference);
		if (japanese.length > 0) {
			return sortCandidatesByReference(dedupeDateCandidates(japanese), reference);
		}
		const absolute = parseAbsoluteDate(normalized, context);
		if (absolute) return [absolute];
		return [];
	}

	const numeric = parseNumericRelativeCandidates(normalized, strings, context, reference);
	const dayMonth = parseDayMonthCandidates(normalized, strings, context, reference);
	if (numeric.length > 0 || dayMonth.length > 0) {
		return sortCandidatesByReference(dedupeDateCandidates([...numeric, ...dayMonth]), reference);
	}

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

function parseChineseCandidates(
	input: string,
	strings: DatePickerStrings,
	context: DateParseContext,
	reference: Date,
): DateParseCandidate[] {
	const candidates: DateParseCandidate[] = [];
	const pushNlpDate = (date: Date, confidence = 0.96): void => {
		candidates.push({
			isoDate: toIsoDate(date),
			primaryLabel: formatLongDate(date, context.language),
			secondaryLabel: strings.parsedFrom(input),
			source: 'fallback',
			confidence,
			kind: 'nlp',
		});
	};

	// Whole-string relative phrase: 今天 / 明天 / 下周 / 本周末 …
	const phrase = CHINESE_PHRASES[input];
	if (phrase) {
		pushNlpDate(phrase(reference));
		return candidates;
	}

	// Weekday: optional 下/上/这/本 prefix + 周/週/星期/礼拜 + day char (下周二, 周五, 本週日).
	const weekdayMatch = /^(下个|下個|下一|下|上个|上個|上一|上|这个|這個|这|這|本)?(?:周|週|星期|礼拜|禮拜)([一二三四五六日天])$/.exec(input);
	if (weekdayMatch) {
		const weekday = CHINESE_WEEKDAY_CHARS[weekdayMatch[2]];
		if (weekday !== undefined) {
			const prefix = weekdayMatch[1] ?? '';
			if (prefix === '') {
				pushNlpDate(nextWeekday(reference, weekday));
			} else if (prefix.startsWith('下')) {
				pushNlpDate(addDays(weekdayInCurrentWeek(reference, weekday), 7));
			} else if (prefix.startsWith('上')) {
				pushNlpDate(addDays(weekdayInCurrentWeek(reference, weekday), -7));
			} else {
				pushNlpDate(weekdayInCurrentWeek(reference, weekday));
			}
			return candidates;
		}
	}

	// Numeric relative: number + unit + optional direction (3天后, 2周前, 1个月后, 5天).
	// 后/後 → future, 前 → past, no direction → both, mirroring the Latin path.
	// Days use 天 only; 日 is reserved as the day-of-month marker (15日 = the 15th).
	const relativeMatch = /^(\d{1,3})(个月|個月|周|週|星期|礼拜|禮拜|天)(后|後|前)?$/.exec(input);
	if (relativeMatch) {
		const amount = Number(relativeMatch[1]);
		const unit = relativeMatch[2];
		const direction = relativeMatch[3] ?? '';
		if (Number.isFinite(amount) && amount > 0) {
			const isMonth = unit === '个月' || unit === '個月';
			const isDay = unit === '天';
			const wantFuture = direction === '' || direction === '后' || direction === '後';
			const wantPast = direction === '' || direction === '前';
			const shift = (sign: number): Date =>
				isMonth ? addMonths(reference, sign * amount)
				: isDay ? addDays(reference, sign * amount)
				: addDays(reference, sign * amount * 7);
			const futureLabel = isMonth ? strings.monthsFromNow(amount) : isDay ? strings.daysFromNow(amount) : strings.weeksFromNow(amount);
			const pastLabel = isMonth ? strings.monthsAgo(amount) : isDay ? strings.daysAgo(amount) : strings.weeksAgo(amount);
			if (wantFuture) candidates.push(buildRelativeCandidate(futureLabel, shift(1), context));
			if (wantPast) candidates.push(buildRelativeCandidate(pastLabel, shift(-1), context));
			return candidates;
		}
	}

	// Month + day: 3月15日 / 3月15 → this year or next year within the open window.
	const monthDayMatch = /^(\d{1,2})月(\d{1,2})[日号號]?$/.exec(input);
	if (monthDayMatch) {
		return chineseDateInWindow(Number(monthDayMatch[1]), Number(monthDayMatch[2]), input, strings, context, reference);
	}

	// Day only: 15日 / 15号 → this month or next month within the open window.
	const dayMatch = /^(\d{1,2})[日号號]$/.exec(input);
	if (dayMatch) {
		const day = Number(dayMatch[1]);
		const refMonth = reference.getMonth() + 1;
		const refYear = reference.getFullYear();
		const thisMonth = chineseDateInWindow(refMonth, day, input, strings, context, reference);
		const nextMonth = refMonth === 12
			? chineseDateInWindow(1, day, input, strings, context, reference, refYear + 1)
			: chineseDateInWindow(refMonth + 1, day, input, strings, context, reference);
		return dedupeDateCandidates([...thisMonth, ...nextMonth]);
	}

	return candidates;
}

function parseJapaneseCandidates(
	input: string,
	strings: DatePickerStrings,
	context: DateParseContext,
	reference: Date,
): DateParseCandidate[] {
	const candidates: DateParseCandidate[] = [];
	const pushNlpDate = (date: Date, confidence = 0.96): void => {
		candidates.push({
			isoDate: toIsoDate(date),
			primaryLabel: formatLongDate(date, context.language),
			secondaryLabel: strings.parsedFrom(input),
			source: 'fallback',
			confidence,
			kind: 'nlp',
		});
	};

	// Whole-string relative phrase: 今日 / 明日 / 来週 / 今週末 …
	const phrase = JAPANESE_PHRASES[input];
	if (phrase) {
		pushNlpDate(phrase(reference));
		return candidates;
	}

	// Weekday: optional 来週/先週/今週 (+ optional の) prefix + day char + 曜(日) (来週火曜日, 金曜日, 今週の月曜).
	const weekdayMatch = /^(来週|先週|今週)?の?([日月火水木金土])曜日?$/.exec(input);
	if (weekdayMatch) {
		const weekday = JAPANESE_WEEKDAY_CHARS[weekdayMatch[2]];
		if (weekday !== undefined) {
			const prefix = weekdayMatch[1] ?? '';
			if (prefix === '') {
				pushNlpDate(nextWeekday(reference, weekday));
			} else if (prefix === '来週') {
				pushNlpDate(addDays(weekdayInCurrentWeek(reference, weekday), 7));
			} else if (prefix === '先週') {
				pushNlpDate(addDays(weekdayInCurrentWeek(reference, weekday), -7));
			} else {
				pushNlpDate(weekdayInCurrentWeek(reference, weekday));
			}
			return candidates;
		}
	}

	// Numeric relative: number + unit + optional direction (3日後, 2週間前, 1ヶ月後, 5週間).
	// 後 → future, 前 → past, no direction → both, mirroring the Latin path.
	// 日 only counts as a duration when an explicit direction is present; bare 5日
	// is reserved as the day-of-month marker (5日 = the 5th).
	const relativeMatch = /^(\d{1,3})(ヶ月|ケ月|カ月|か月|週間|週|日)(後|前)?$/.exec(input);
	if (relativeMatch) {
		const amount = Number(relativeMatch[1]);
		const unit = relativeMatch[2];
		const direction = relativeMatch[3] ?? '';
		const isMonth = unit === 'ヶ月' || unit === 'ケ月' || unit === 'カ月' || unit === 'か月';
		const isDay = unit === '日';
		// Bare 日 without a direction is a day-of-month, not "N days" — fall through.
		if (!(isDay && direction === '') && Number.isFinite(amount) && amount > 0) {
			const wantFuture = direction === '' || direction === '後';
			const wantPast = direction === '' || direction === '前';
			const shift = (sign: number): Date =>
				isMonth ? addMonths(reference, sign * amount)
				: isDay ? addDays(reference, sign * amount)
				: addDays(reference, sign * amount * 7);
			const futureLabel = isMonth ? strings.monthsFromNow(amount) : isDay ? strings.daysFromNow(amount) : strings.weeksFromNow(amount);
			const pastLabel = isMonth ? strings.monthsAgo(amount) : isDay ? strings.daysAgo(amount) : strings.weeksAgo(amount);
			if (wantFuture) candidates.push(buildRelativeCandidate(futureLabel, shift(1), context));
			if (wantPast) candidates.push(buildRelativeCandidate(pastLabel, shift(-1), context));
			return candidates;
		}
	}

	// Month + day: 3月15日 / 3月15 → this year or next year within the open window.
	const monthDayMatch = /^(\d{1,2})月(\d{1,2})日?$/.exec(input);
	if (monthDayMatch) {
		return chineseDateInWindow(Number(monthDayMatch[1]), Number(monthDayMatch[2]), input, strings, context, reference);
	}

	// Day only: 15日 → this month or next month within the open window.
	const dayMatch = /^(\d{1,2})日$/.exec(input);
	if (dayMatch) {
		const day = Number(dayMatch[1]);
		const refMonth = reference.getMonth() + 1;
		const refYear = reference.getFullYear();
		const thisMonth = chineseDateInWindow(refMonth, day, input, strings, context, reference);
		const nextMonth = refMonth === 12
			? chineseDateInWindow(1, day, input, strings, context, reference, refYear + 1)
			: chineseDateInWindow(refMonth + 1, day, input, strings, context, reference);
		return dedupeDateCandidates([...thisMonth, ...nextMonth]);
	}

	return candidates;
}

// Build month-day candidates that fall inside the open [reference, reference+365] window,
// trying the reference year and the following year (or an explicit year when provided).
function chineseDateInWindow(
	month: number,
	day: number,
	input: string,
	strings: DatePickerStrings,
	context: DateParseContext,
	reference: Date,
	explicitYear?: number,
): DateParseCandidate[] {
	if (month < 1 || month > 12 || day < 1 || day > 31) return [];
	const referenceDate = cloneDate(reference);
	const latestDate = addDays(referenceDate, 365);
	const years = explicitYear !== undefined
		? [explicitYear]
		: [referenceDate.getFullYear(), referenceDate.getFullYear() + 1];
	const byIso = new Map<string, DateParseCandidate>();
	for (const year of years) {
		const date = new Date(year, month - 1, day, 12, 0, 0, 0);
		if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) continue;
		if (date.getTime() < referenceDate.getTime() || date.getTime() > latestDate.getTime()) continue;
		const isoDate = toIsoDate(date);
		byIso.set(isoDate, {
			isoDate,
			primaryLabel: formatLongDate(date, context.language),
			secondaryLabel: strings.parsedFrom(input),
			source: 'fallback',
			confidence: 0.97,
			kind: 'nlp',
		});
	}
	return [...byIso.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

// Locate a weekday (0 = Sunday) within the Monday-started week of the reference date.
function weekdayInCurrentWeek(date: Date, weekday: number): Date {
	const monday = startOfWeek(date);
	const offsetFromMonday = weekday === 0 ? 6 : weekday - 1;
	return addDays(monday, offsetFromMonday);
}

function parsePhraseDate(input: string, language: DatePickerLang, reference: Date): Date | null {
	const phrases = language === 'tr'
		? TURKISH_PHRASES
		: language === 'de'
		? GERMAN_PHRASES
		: language === 'fr'
		? FRENCH_PHRASES
		: language === 'es'
		? SPANISH_PHRASES
		: language === 'ru'
		? RUSSIAN_PHRASES
		: ENGLISH_PHRASES;
	const direct = phrases[input];
	if (direct) return direct(reference);

	const weekdays = language === 'tr'
		? TURKISH_WEEKDAYS
		: language === 'de'
		? GERMAN_WEEKDAYS
		: language === 'fr'
		? FRENCH_WEEKDAYS
		: language === 'es'
		? SPANISH_WEEKDAYS
		: language === 'ru'
		? RUSSIAN_WEEKDAYS
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

	// Spanish weekdays are masculine, so 'próximo'/'pasado' work as either prefix or suffix
	// ('próximo lunes', 'lunes pasado', 'lunes próximo'). Keys are normalizeInput()-form.
	if (language === 'es') {
		const nextPrefix = 'proximo ';
		const lastPrefix = 'pasado ';
		const nextSuffix = ' proximo';
		const lastSuffix = ' pasado';
		if (input.startsWith(nextPrefix)) {
			const weekday = input.slice(nextPrefix.length).trim();
			if (weekdays.has(weekday)) return nextWeekday(reference, weekdays.get(weekday)!);
		}
		if (input.startsWith(lastPrefix)) {
			const weekday = input.slice(lastPrefix.length).trim();
			if (weekdays.has(weekday)) return previousWeekday(reference, weekdays.get(weekday)!);
		}
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

	// Russian weekdays are gendered (masculine: понедельник/вторник/четверг/воскресенье,
	// feminine: среда/пятница/суббота), so 'следующий/следующая' and 'прошлый/прошлая'
	// both need checking, with or without the leading 'в' preposition. Prefixes are
	// normalizeInput()-form: masculine 'следующий'/'прошлый' end in 'й', which NFKD
	// normalization turns into 'и' (see RUSSIAN_PHRASES comment above) — следующий →
	// следующии, прошлый → прошлыи. Feminine forms end in 'ая'/'ую' and are unaffected.
	if (language === 'ru') {
		const nextPrefixes = ['в следующии ', 'в следующую ', 'следующии ', 'следующая '];
		const lastPrefixes = ['в прошлыи ', 'в прошлую ', 'прошлыи ', 'прошлая '];
		for (const prefix of nextPrefixes) {
			if (!input.startsWith(prefix)) continue;
			const weekday = input.slice(prefix.length).trim();
			if (weekdays.has(weekday)) return nextWeekday(reference, weekdays.get(weekday)!);
		}
		for (const prefix of lastPrefixes) {
			if (!input.startsWith(prefix)) continue;
			const weekday = input.slice(prefix.length).trim();
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

function parseDayMonthCandidates(
	input: string,
	strings: DatePickerStrings,
	context: DateParseContext,
	reference: Date,
): DateParseCandidate[] {
	const match = /^(\d{1,2})\s+([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF]+)$/.exec(input);
	if (!match) return [];

	const day = Number(match[1]);
	if (!Number.isFinite(day) || day <= 0 || day > 31) return [];
	const monthToken = normalizeInput(match[2] ?? '');
	if (!monthToken) return [];

	const referenceDate = cloneDate(reference);
	const latestDate = addDays(referenceDate, 365);
	const monthNumbers = resolveMonthNumbers(monthToken, context.language);
	const byIso = new Map<string, DateParseCandidate>();

	for (const month of monthNumbers) {
		for (const year of [referenceDate.getFullYear(), referenceDate.getFullYear() + 1]) {
			const date = new Date(year, month - 1, day, 12, 0, 0, 0);
			if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) continue;
			if (date.getTime() < referenceDate.getTime() || date.getTime() > latestDate.getTime()) continue;
			const isoDate = toIsoDate(date);
			byIso.set(isoDate, {
				isoDate,
				primaryLabel: formatLongDate(date, context.language),
				secondaryLabel: strings.parsedFrom(input),
				source: 'fallback',
				confidence: 0.97,
				kind: 'nlp',
			});
		}
	}

	return [...byIso.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

function resolveMonthNumbers(monthToken: string, language: DatePickerLang): number[] {
	const languageAliases = language === 'en'
		? MONTH_ALIASES.en
		: [...MONTH_ALIASES[language], ...MONTH_ALIASES.en];
	const months = new Set<number>();

	for (const entry of languageAliases) {
		for (const alias of entry.aliases) {
			const normalizedAlias = normalizeInput(alias);
			if (normalizedAlias.startsWith(monthToken) || monthToken.startsWith(normalizedAlias)) {
				months.add(entry.month);
				break;
			}
		}
	}

	return [...months].sort((a, b) => a - b);
}

function parseNumericRelativeCandidates(
	input: string,
	strings: DatePickerStrings,
	context: DateParseContext,
	reference: Date,
): DateParseCandidate[] {
	const match = /^(\d{1,3})(?:\s+([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF]+))?$/.exec(input);
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

function dedupeDateCandidates(candidates: DateParseCandidate[]): DateParseCandidate[] {
	const byIsoDate = new Map<string, DateParseCandidate>();
	for (const candidate of candidates) {
		if (!byIsoDate.has(candidate.isoDate)) byIsoDate.set(candidate.isoDate, candidate);
	}
	return [...byIsoDate.values()];
}

function sortCandidatesByReference(candidates: DateParseCandidate[], reference: Date): DateParseCandidate[] {
	const referenceIso = toIsoDate(reference);
	return [...candidates].sort((a, b) => {
		const aFuture = a.isoDate >= referenceIso;
		const bFuture = b.isoDate >= referenceIso;
		if (aFuture !== bFuture) return aFuture ? -1 : 1;
		return aFuture ? a.isoDate.localeCompare(b.isoDate) : b.isoDate.localeCompare(a.isoDate);
	});
}

function matchesUnit(token: string, language: DatePickerLang, unit: 'days' | 'weeks' | 'months'): boolean {
	if (!token) return true;
	const lowered = normalizeInput(token);
	const prefixes: Record<typeof unit, string[]> = language === 'tr'
		? {
			days: ['g', 'gu', 'gun'],
			weeks: ['h', 'ha', 'haf', 'haft', 'hafta'],
			months: ['a', 'ay'],
		}
		: language === 'de'
		? {
			days: ['t', 'ta', 'tag', 'tage'],
			weeks: ['w', 'wo', 'woc', 'woch', 'woche', 'wochen'],
			months: ['m', 'mo', 'mon', 'mona', 'monat', 'monate'],
		}
		: language === 'fr'
		? {
			days: ['j', 'jo', 'jou', 'jour', 'jours'],
			weeks: ['s', 'se', 'sem', 'sema', 'semai', 'semain', 'semaine', 'semaines'],
			months: ['m', 'mo', 'moi', 'mois'],
		}
		: language === 'es'
		? {
			days: ['d', 'di', 'dia', 'dias'],
			weeks: ['s', 'se', 'sem', 'sema', 'seman', 'semana', 'semanas'],
			months: ['m', 'me', 'mes', 'mese', 'meses'],
		}
		: language === 'ru'
		// 'дней' ends in 'й', which normalizeInput() turns into 'и' (see RUSSIAN_PHRASES
		// comment) — the token being matched here is normalized, so the list entry must be too.
		? {
			days: ['д', 'дн', 'день', 'дня', 'днеи'],
			weeks: ['н', 'не', 'нед', 'неделя', 'недели', 'недель'],
			months: ['м', 'ме', 'мес', 'месяц', 'месяца', 'месяцев'],
		}
		: {
			days: ['d', 'da', 'day', 'days'],
			weeks: ['w', 'we', 'wee', 'week', 'weeks'],
			months: ['m', 'mo', 'mon', 'mont', 'month', 'months'],
		};
	return prefixes[unit].includes(lowered);
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
	return new Intl.DateTimeFormat(datePickerLocaleTag(language), {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}).format(date);
}

function datePickerLocaleTag(language: DatePickerLang): string {
	if (language === 'tr') return 'tr-TR';
	if (language === 'de') return 'de-DE';
	if (language === 'fr') return 'fr-FR';
	if (language === 'es') return 'es-ES';
	if (language === 'zh-CN') return 'zh-CN';
	if (language === 'zh-TW') return 'zh-TW';
	if (language === 'ja') return 'ja-JP';
	if (language === 'ru') return 'ru-RU';
	return 'en-US';
}

function normalizeInput(input: string): string {
	return input
		.trim()
		.toLocaleLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ');
}
