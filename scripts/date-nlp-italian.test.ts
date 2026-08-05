import assert from 'node:assert/strict';
import { getDatePickerStrings, getQuickDateCandidates, parseFallbackDateCandidates } from '../src/ui/field-pickers/date-nlp-fallback';

let assertions = 0;

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	const referenceDate = new Date(2026, 2, 18, 12, 0, 0, 0);
	const context = { fieldKey: 'dateScheduled', language: 'it' as const, referenceDate };
	const isoOf = (input: string) => parseFallbackDateCandidates(input, context).map(candidate => candidate.isoDate);

	deepEqual(isoOf('oggi'), ['2026-03-18']);
	deepEqual(isoOf('domani'), ['2026-03-19']);
	deepEqual(isoOf('dopodomani'), ['2026-03-20']);
	deepEqual(isoOf("l'altro ieri"), ['2026-03-16']);
	deepEqual(isoOf('l’altro ieri'), ['2026-03-16']);
	deepEqual(isoOf('la settimana prossima'), ['2026-03-23']);

	deepEqual(isoOf('martedì prossimo'), ['2026-03-24']);
	deepEqual(isoOf('prossimo martedi'), ['2026-03-24']);
	deepEqual(isoOf('venerdi scorso'), ['2026-03-13']);
	deepEqual(isoOf('domenica prossima'), ['2026-03-22']);
	deepEqual(isoOf('ultima domenica'), ['2026-03-15']);
	deepEqual(isoOf('domenica prossimo'), [], 'feminine Sunday rejects a masculine qualifier');
	deepEqual(isoOf('prossima martedì'), [], 'masculine Tuesday rejects a feminine qualifier');
	deepEqual(isoOf('scorsa venerdì'), [], 'masculine Friday rejects a feminine qualifier');

	equal(isoOf('15 gennaio').includes('2027-01-15'), true);
	equal(isoOf('5 dic').includes('2026-12-05'), true);
	const setResults = isoOf('3 set');
	equal(setResults.includes('2026-09-03'), true);
	equal(setResults.includes('2026-04-08'), false);
	const settResults = isoOf('3 sett');
	equal(settResults.includes('2026-09-03'), true);
	equal(settResults.includes('2026-04-08'), true);
	equal(isoOf('3 setti').includes('2026-09-03'), false);
	equal(isoOf('3 settimane').includes('2026-09-03'), false);

	const strings = getDatePickerStrings('it');
	equal(strings.daysFromNow(1), 'tra 1 giorno');
	equal(strings.daysAgo(2), '2 giorni fa');
	equal(strings.weeksFromNow(1), 'tra 1 settimana');
	equal(strings.weeksAgo(2), '2 settimane fa');
	equal(strings.monthsFromNow(1), 'tra 1 mese');
	equal(strings.monthsAgo(2), '2 mesi fa');

	const sundayLabels = getQuickDateCandidates(context, 'domenica').map(candidate => candidate.primaryLabel);
	equal(sundayLabels.includes('domenica prossima'), true);
	equal(sundayLabels.includes('domenica prossimo'), false);

	console.log(`Italian date NLP tests passed: ${assertions} assertions`);
}

declare global {
	var __operonItalianDateNlpTestRun: Promise<void> | undefined;
}

globalThis.__operonItalianDateNlpTestRun = run();
