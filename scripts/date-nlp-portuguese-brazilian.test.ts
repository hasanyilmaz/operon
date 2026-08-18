import assert from 'node:assert/strict';
import {
	buildDatePickerCandidates,
	getDatePickerLocaleStrings,
	resolveDatePickerLanguage,
} from '../src/ui/field-pickers/date-nlp';
import { getQuickDateCandidates, parseFallbackDateCandidates } from '../src/ui/field-pickers/date-nlp-fallback';

let assertions = 0;

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message ?? '');
	assertions += 1;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message ?? '');
	assertions += 1;
}

async function run(): Promise<void> {
	const referenceDate = new Date(2026, 2, 18, 12, 0, 0, 0);
	const context = { fieldKey: 'dateScheduled', language: 'pt-BR' as const, referenceDate };
	const isoOf = (input: string) => parseFallbackDateCandidates(input, context).map(candidate => candidate.isoDate);

	equal(resolveDatePickerLanguage('pt-BR'), 'pt-BR');
	equal(resolveDatePickerLanguage(), 'en');
	const strings = getDatePickerLocaleStrings('pt-BR');
	equal(strings.searchPlaceholder, 'Digite uma data, como próxima terça-feira');
	equal(strings.manualDate, 'Escolher uma data');
	equal(strings.daysFromNow(1), 'daqui a 1 dia');
	equal(strings.monthsAgo(2), 'há 2 meses');

	deepEqual(isoOf('Hoje'), ['2026-03-18']);
	deepEqual(isoOf('Amanhã'), ['2026-03-19']);
	deepEqual(isoOf('Ontem'), ['2026-03-17']);
	deepEqual(isoOf('Esta semana'), ['2026-03-16']);
	deepEqual(isoOf('Próxima semana'), ['2026-03-23']);
	deepEqual(isoOf('Semana passada'), ['2026-03-09']);
	deepEqual(isoOf('Este fim de semana'), ['2026-03-21']);
	deepEqual(isoOf('Próximo fim de semana'), ['2026-03-28']);
	deepEqual(isoOf('Fim de semana passado'), ['2026-03-14']);

	deepEqual(isoOf('terça-feira'), ['2026-03-24']);
	deepEqual(isoOf('proxima terca-feira'), ['2026-03-24']);
	deepEqual(isoOf('terça-feira próxima'), ['2026-03-24']);
	deepEqual(isoOf('passada terça-feira'), ['2026-03-17']);
	deepEqual(isoOf('terça-feira passada'), ['2026-03-17']);
	deepEqual(isoOf('próximo domingo'), ['2026-03-22']);
	deepEqual(isoOf('domingo próximo'), ['2026-03-22']);
	deepEqual(isoOf('passado domingo'), ['2026-03-15']);
	deepEqual(isoOf('domingo passado'), ['2026-03-15']);
	deepEqual(isoOf('proximo segunda-feira'), [], 'masculine modifier rejects feminine weekday');
	deepEqual(isoOf('segunda-feira próximo'), [], 'masculine suffix rejects feminine weekday');
	deepEqual(isoOf('passada domingo'), [], 'feminine modifier rejects masculine weekday');
	deepEqual(isoOf('domingo passada'), [], 'feminine suffix rejects masculine weekday');
	deepEqual([
		'dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab',
	].map(alias => isoOf(alias)[0]), [
		'2026-03-22', '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-19', '2026-03-20', '2026-03-21',
	], 'all pt-BR weekday short aliases resolve to their next occurrence');

	deepEqual(isoOf('daqui a 3 dias'), ['2026-03-21']);
	deepEqual(isoOf('há 3 meses'), ['2025-12-18']);
	deepEqual(isoOf('3 semanas atrás'), ['2026-02-25']);
	deepEqual(isoOf('3 dias'), ['2026-03-21', '2026-03-15']);
	deepEqual(isoOf('1 mês'), ['2026-04-18', '2026-02-18']);
	deepEqual(isoOf('daqui a 3 diaa'), [], 'unknown pt-BR future unit fails closed');
	deepEqual(isoOf('há 3 sem'), [], 'partial pt-BR past unit fails closed');
	deepEqual(isoOf('3 mesx atrás'), [], 'unknown pt-BR suffix unit fails closed');
	deepEqual(isoOf('3 d'), [], 'partial unsigned unit fails closed');

	deepEqual(isoOf('15 agosto'), ['2026-08-15']);
	deepEqual(isoOf('15 ago'), ['2026-08-15']);
	deepEqual(isoOf('15 de agosto'), ['2026-08-15']);
	deepEqual(isoOf('15 de agosto de 2026'), ['2026-08-15']);
	deepEqual(isoOf('15 agosto de 2025'), ['2025-08-15'], 'an explicit past year remains valid');
	deepEqual(isoOf('15 janeiro'), ['2027-01-15']);
	deepEqual(isoOf('15 MARÇO'), ['2027-03-15'], 'case and accent normalization preserve pt-BR month parsing');
	deepEqual(
		parseFallbackDateCandidates('15 agosto', {
			fieldKey: 'dateScheduled',
			language: 'pt-BR',
			referenceDate: new Date(2026, 7, 15, 15, 0, 0, 0),
		}).map(candidate => candidate.isoDate),
		['2026-08-15'],
		'a yearless date compares by calendar day rather than the reference time',
	);
	deepEqual(isoOf('2026-08-15'), ['2026-08-15']);
	deepEqual(isoOf('15/08/2026'), ['2026-08-15']);
	deepEqual(isoOf('29 fevereiro de 2028'), ['2028-02-29'], 'explicit leap day is valid in leap years');
	deepEqual(isoOf('29 fevereiro de 2026'), [], 'explicit leap day is invalid outside leap years');
	deepEqual(isoOf('31/02/2026'), []);
	deepEqual(isoOf('15/08'), []);
	const leapBoundaryContext = {
		fieldKey: 'dateScheduled',
		language: 'pt-BR' as const,
		referenceDate: new Date(2023, 2, 1, 12, 0, 0, 0),
	};
	deepEqual(
		parseFallbackDateCandidates('29 fevereiro', leapBoundaryContext).map(candidate => candidate.isoDate),
		['2024-02-29'],
		'a yearless leap day at the closed 365-day boundary is accepted',
	);
	deepEqual(isoOf('next Tuesday'), []);
	deepEqual(isoOf('august 15'), []);

	const quickLabels = getQuickDateCandidates(context).map(candidate => candidate.primaryLabel);
	deepEqual(quickLabels.slice(0, 5), [
		'Hoje', 'Amanhã', 'Este fim de semana', 'Próxima semana', 'Próximo fim de semana',
	]);

	let nldatesCalls = 0;
	const app = {
		plugins: {
			getPlugin: () => ({
				parseDate: () => {
					nldatesCalls += 1;
					return { date: new Date(2026, 2, 24, 12, 0, 0, 0) };
				},
			}),
		},
	};
	const blocked = buildDatePickerCandidates(app as never, 'next Tuesday', context);
	deepEqual(blocked.parsed, [], 'pt-BR must fail closed before nldates');
	equal(nldatesCalls, 0, 'pt-BR never invokes nldates for unrecognized text');

	console.log(`Brazilian Portuguese date NLP tests passed: ${assertions} assertions`);
}

declare global {
	var __operonBrazilianPortugueseDateNlpTestRun: Promise<void> | undefined;
}

globalThis.__operonBrazilianPortugueseDateNlpTestRun = run();
