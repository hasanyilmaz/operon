import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const mainSource = read('main.ts');
const calendarTypesSource = read('src/types/calendar.ts');
const kanbanTypesSource = read('src/types/kanban.ts');
const calendarViewSource = read('src/ui/calendar/calendar-view.ts');
const kanbanViewSource = read('src/ui/kanban/kanban-view.ts');
const englishLocale = JSON.parse(read('i18n/locales/en.json'));

test('direct mobile view commands use the approved ids and English labels', () => {
	assert.equal(englishLocale.commands.openMobileCalendar, 'Open Mobile Calendar');
	assert.equal(englishLocale.commands.openMobileKanban, 'Open Mobile Kanban');
	assert.match(mainSource, /id: 'open-mobile-calendar-view'[\s\S]*?openCalendarView\(\{ forceMobileLayout: true \}\)/u);
	assert.match(mainSource, /id: 'open-mobile-kanban-view'[\s\S]*?openKanbanView\(\{ forceMobileLayout: true \}\)/u);
});

test('existing Calendar and Kanban commands retain automatic opening behavior', () => {
	assert.match(mainSource, /id: 'open-calendar-view'[\s\S]*?this\.openCalendarView\(\)/u);
	assert.match(mainSource, /id: 'open-kanban-view'[\s\S]*?this\.openKanbanView\(\)/u);
});

test('leaf-state normalization preserves only an explicit mobile override', () => {
	assert.match(calendarTypesSource, /forceMobileLayout: state\?\.forceMobileLayout === true/u);
	assert.match(kanbanTypesSource, /forceMobileLayout: rawState\.forceMobileLayout === true/u);
	assert.match(calendarViewSource, /left\.forceMobileLayout === right\.forceMobileLayout/u);
	assert.match(kanbanTypesSource, /left\.forceMobileLayout === right\.forceMobileLayout/u);
});

test('explicit mobile commands override eligibility while automatic guards remain intact', () => {
	const calendarEligibility = calendarViewSource.slice(
		calendarViewSource.indexOf('\tprivate isMobileCalendarLayoutEligible('),
		calendarViewSource.indexOf('\n\tprivate resolveCalendarPresetFilter('),
	);
	assert.match(calendarEligibility, /if \(state\.forceMobileLayout\) return true;/u);
	assert.match(calendarEligibility, /settings\.calendarMobileEnabled !== true/u);
	assert.match(calendarEligibility, /!Platform\.isPhone/u);
	assert.match(calendarEligibility, /width <= settings\.calendarMobileMaxWidthPx/u);

	const kanbanEligibility = kanbanViewSource.slice(
		kanbanViewSource.indexOf('\tprivate isKanbanMobileLayoutEligible('),
		kanbanViewSource.indexOf('\n\tprivate setSearchQueryState('),
	);
	assert.match(kanbanEligibility, /if \(this\.ensureState\(\)\.forceMobileLayout\) return true;/u);
	assert.match(kanbanEligibility, /settings\.kanbanMobileLayoutChromeEnabled === true/u);
	assert.match(kanbanEligibility, /coarsePointer \|\| isKanbanMobilePlatform\(\)/u);
	assert.match(kanbanEligibility, /viewportWidth <= settings\.kanbanMobileLayoutMaxWidthPx/u);
});
