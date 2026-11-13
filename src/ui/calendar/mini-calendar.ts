import { setIcon } from 'obsidian';
import { t } from '../../core/i18n';
import type { DateDisplayFormat } from '../../types/settings';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { calendarMonthTarget, calendarNavigationLabels } from './calendar-month-picker';

export interface CalendarDateNavigationOptions {
	dateKey: string;
	locale: string | undefined;
	dateDisplayFormat: DateDisplayFormat;
	sidebar: boolean;
	onToday: () => void;
	onChooseMonth: (anchor: HTMLButtonElement) => void;
}

export interface MiniCalendarOptions extends Omit<CalendarDateNavigationOptions, 'sidebar'> {
	today: string;
	weekStart: 'monday' | 'sunday';
	showWeekNumbers: boolean;
	onShiftMonth: (delta: number) => void;
	onSelectDate: (dateKey: string) => void;
	weekNote?: { describe: (monday: string) => { label: string; description: string }; select: (monday: string) => void };
}

export function shiftCalendarMonth(dateKey: string, delta: number): string {
	const date = parseDateKey(dateKey);
	if (!date) return dateKey;
	const target = new Date(date.getFullYear(), date.getMonth() + delta, 1, 12);
	const targetKey = calendarMonthTarget(formatDateKey(date).padStart(10, '0'), target.getFullYear(), target.getMonth());
	target.setDate(Number(targetKey.slice(-2)));
	return formatDateKey(target);
}

export function renderCalendarDateNavigation(container: HTMLElement, options: CalendarDateNavigationOptions): void {
	const labels = calendarNavigationLabels(options.dateKey, options.dateDisplayFormat, options.locale);
	const group = container.createDiv('operon-calendar-date-navigation');
	group.classList.toggle('is-year-first', labels.yearFirst);
	const year = group.createEl('button', { text: labels.year, cls: 'operon-calendar-toolbar-button operon-calendar-year-button', attr: {
		type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': `${t('buttons', 'choose')}: ${labels.full}`,
	} });
	const date = group.createEl('button', { text: labels.date, cls: `operon-calendar-toolbar-button operon-calendar-date-button${options.sidebar ? ' operon-calendar-sidebar-month-nav-today' : ''}`, attr: { type: 'button', 'aria-label': labels.full } });
	if (!labels.yearFirst) group.insertBefore(date, year);
	bindOperonHoverTooltip(date, { content: t('calendar', 'mobileGoToToday'), taskColor: null });
	bindOperonHoverTooltip(year, { content: labels.full, taskColor: null });
	date.addEventListener('click', () => { options.onToday(); });
	year.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		options.onChooseMonth(year);
	});
}

export function renderMiniCalendar(container: HTMLElement, options: MiniCalendarOptions): void {
	const monthCard = container.createDiv('operon-calendar-sidebar-month');
	const anchorDate = options.dateKey;
	const anchorDateObject = parseDateKey(anchorDate) ?? parseDateKey(options.today);
	if (!anchorDateObject) return;
	const navRow = monthCard.createDiv('operon-calendar-sidebar-month-nav');
	createToolbarIconButton(navRow, ['step-back'], () => options.onShiftMonth(-1), t('calendar', 'previousMonth'), t('calendar', 'previousMonth'), 'operon-calendar-sidebar-month-nav-button');
	renderCalendarDateNavigation(navRow, { ...options, sidebar: true });
	createToolbarIconButton(navRow, ['step-forward'], () => options.onShiftMonth(1), t('calendar', 'nextMonth'), t('calendar', 'nextMonth'), 'operon-calendar-sidebar-month-nav-button');
	const showWeekNumbers = options.showWeekNumbers;
	const weekdayRow = monthCard.createDiv('operon-calendar-sidebar-month-weekdays');
	weekdayRow.classList.toggle('has-week-numbers', showWeekNumbers);
	if (showWeekNumbers) {
		weekdayRow.createDiv({
			text: 'W',
			cls: 'operon-calendar-sidebar-month-weeknum-header',
		});
	}
	const weekdayFormatter = new Intl.DateTimeFormat(options.locale, { weekday: 'short' });
	const weekdayOrder = options.weekStart === 'sunday'
		? [0, 1, 2, 3, 4, 5, 6]
		: [1, 2, 3, 4, 5, 6, 0];
	for (const weekdayIndex of weekdayOrder) {
		const weekdayDate = new Date(2026, 2, 1 + weekdayIndex);
		const weekdayLabel = weekdayFormatter.format(weekdayDate).replace('.', '');
		const normalizedWeekdayLabel = weekdayLabel
			? weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1).toLowerCase()
			: weekdayLabel;
		const weekdayEl = weekdayRow.createDiv({
			text: normalizedWeekdayLabel,
			cls: 'operon-calendar-sidebar-month-weekday',
		});
		weekdayEl.classList.toggle('is-weekend', weekdayIndex === 0 || weekdayIndex === 6);
	}

	const grid = monthCard.createDiv('operon-calendar-sidebar-month-grid');
	grid.classList.toggle('has-week-numbers', showWeekNumbers);
	const monthStart = new Date(anchorDateObject.getFullYear(), anchorDateObject.getMonth(), 1, 12, 0, 0, 0);
	const monthStartWeekday = monthStart.getDay();
	const weekStartOffset = options.weekStart === 'sunday'
		? monthStartWeekday
		: (monthStartWeekday + 6) % 7;
	const gridStart = new Date(monthStart);
	gridStart.setDate(gridStart.getDate() - weekStartOffset);
	const today = options.today;

	for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
		const weekStartDate = new Date(gridStart);
		weekStartDate.setDate(gridStart.getDate() + weekIndex * 7);
		if (showWeekNumbers) {
			if (options.weekNote) {
				const monday = new Date(weekStartDate);
				if (options.weekStart === 'sunday') monday.setDate(monday.getDate() + 1);
				const dateKey = formatDateKey(monday);
				const note = options.weekNote.describe(dateKey);
				const button = grid.createEl('button', { text: note.label, cls: 'operon-calendar-sidebar-month-weeknum',
					attr: { type: 'button', 'data-week-date': dateKey } });
				setAccessibleLabelWithoutTooltip(button, note.description);
				bindOperonHoverTooltip(button, { content: note.description, taskColor: null });
				button.addEventListener('click', () => options.weekNote?.select(dateKey));
			} else {
				grid.createDiv({ text: String(calendarWeekNumber(weekStartDate, options.weekStart)), cls: 'operon-calendar-sidebar-month-weeknum' });
			}
		}
		for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
			const current = new Date(weekStartDate);
			current.setDate(weekStartDate.getDate() + dayOffset);
			const dateKey = formatDateKey(current);
			const button = grid.createEl('button', {
				text: String(current.getDate()),
				cls: 'operon-calendar-sidebar-month-day',
				attr: { type: 'button', 'data-date-key': dateKey },
			});
			button.classList.toggle('is-weekend', current.getDay() === 0 || current.getDay() === 6);
			button.classList.toggle('is-outside-month', current.getMonth() !== anchorDateObject.getMonth());
			button.classList.toggle('is-anchor', dateKey === anchorDate);
			button.classList.toggle('is-today', dateKey === today);
			button.addEventListener('click', () => options.onSelectDate(dateKey));
		}
	}
}

export function calendarWeekNumber(date: Date, weekStart: 'monday' | 'sunday'): number {
	if (weekStart === 'monday') {
		const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
		const day = current.getUTCDay() || 7;
		current.setUTCDate(current.getUTCDate() + 4 - day);
		const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
		return Math.ceil((((current.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	}
	const current = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
	const yearStart = new Date(current.getFullYear(), 0, 1, 12, 0, 0, 0);
	const offset = yearStart.getDay();
	const firstWeekStart = new Date(yearStart);
	firstWeekStart.setDate(yearStart.getDate() - offset);
	return Math.floor((current.getTime() - firstWeekStart.getTime()) / (7 * 86400000)) + 1;
}

function parseDateKey(dateKey: string): Date | null {
	const [year, month, day] = dateKey.split('-').map(part => Number.parseInt(part, 10));
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
	return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function createToolbarIconButton(
	container: HTMLElement,
	icons: string[],
	onClick: () => void,
	ariaLabel: string,
	title?: string,
	extraClass?: string,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: `operon-calendar-toolbar-button is-icon-only${extraClass ? ` ${extraClass}` : ''}`,
		attr: { type: 'button' },
	});
	for (const iconName of icons) {
		const iconWrap = button.createSpan({ cls: 'operon-calendar-toolbar-icon' });
		setIcon(iconWrap, iconName);
	}
	setAccessibleLabelWithoutTooltip(button, ariaLabel);
	if (title) bindOperonHoverTooltip(button, { content: title, taskColor: null });
	button.addEventListener('click', onClick);
	return button;
}
