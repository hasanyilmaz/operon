import { setIcon } from 'obsidian';
import { localToday } from '../../core/local-time';
import { createButton } from './common';

export type DayPickerWeekStart = 'monday' | 'sunday';

export interface OperonDayPickerOptions {
	value?: string;
	weekStart: DayPickerWeekStart;
	showWeekNumbers: boolean;
	locale?: string;
	clearLabel: string;
	todayLabel: string;
	previousYearLabel: string;
	nextYearLabel: string;
	previousMonthLabel: string;
	nextMonthLabel: string;
	onSelect: (value: string) => void;
	onClear?: () => void;
	canClear?: boolean;
	showClear?: boolean;
	showToday?: boolean;
}

export interface OperonDayPickerController {
	setFocusedDate: (value: string) => void;
	setSelectedDate: (value: string | null | undefined) => void;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function renderOperonDayPicker(
	container: HTMLElement,
	options: OperonDayPickerOptions,
): OperonDayPickerController {
	let selectedDate = normalizeOperonDateKey(options.value);
	let focusedDate = parseDateKey(selectedDate ?? localToday()) ?? new Date();
	focusedDate = atLocalNoon(focusedDate);

	const root = container.createDiv('operon-day-picker');

	const render = (): void => {
		root.replaceChildren();
		renderHeader(root, options, focusedDate, nextDate => {
			focusedDate = nextDate;
			render();
		});
		renderWeekdays(root, options);
		renderGrid(root, options, focusedDate, selectedDate);
		renderFooter(root, options, todayDate => {
			focusedDate = todayDate;
			render();
		});
	};

	render();

	return {
		setFocusedDate: (value: string): void => {
			const parsed = parseDateKey(value);
			if (!parsed) return;
			focusedDate = parsed;
			render();
		},
		setSelectedDate: (value: string | null | undefined): void => {
			selectedDate = normalizeOperonDateKey(value);
			render();
		},
	};
}

function renderHeader(
	root: HTMLElement,
	options: OperonDayPickerOptions,
	focusedDate: Date,
	onNavigate: (date: Date) => void,
): void {
	const navRow = root.createDiv('operon-day-picker-nav-row');

	const yearGroup = navRow.createDiv('operon-day-picker-nav-group is-year');
	const previousYear = createIconButton(yearGroup, 'chevrons-left', options.previousYearLabel);
	const yearLabel = yearGroup.createDiv('operon-day-picker-nav-label');
	yearLabel.textContent = new Intl.DateTimeFormat(options.locale, { year: 'numeric' }).format(focusedDate);
	const nextYear = createIconButton(yearGroup, 'chevrons-right', options.nextYearLabel);

	previousYear.addEventListener('click', () => onNavigate(shiftMonth(focusedDate, -12)));
	nextYear.addEventListener('click', () => onNavigate(shiftMonth(focusedDate, 12)));

	const monthGroup = navRow.createDiv('operon-day-picker-nav-group is-month');
	const previousMonth = createIconButton(monthGroup, 'chevron-left', options.previousMonthLabel);
	const monthLabel = monthGroup.createDiv('operon-day-picker-nav-label');
	monthLabel.textContent = new Intl.DateTimeFormat(options.locale, {
		month: 'long',
		day: 'numeric',
	}).format(focusedDate);
	const nextMonth = createIconButton(monthGroup, 'chevron-right', options.nextMonthLabel);

	previousMonth.addEventListener('click', () => onNavigate(shiftMonth(focusedDate, -1)));
	nextMonth.addEventListener('click', () => onNavigate(shiftMonth(focusedDate, 1)));
}

function renderWeekdays(root: HTMLElement, options: OperonDayPickerOptions): void {
	const row = root.createDiv('operon-day-picker-weekdays');
	row.classList.toggle('has-week-numbers', options.showWeekNumbers);
	if (options.showWeekNumbers) {
		row.createDiv({ text: 'W', cls: 'operon-day-picker-weeknum-header' });
	}

	const formatter = new Intl.DateTimeFormat(options.locale, { weekday: 'short' });
	for (const weekdayIndex of getWeekdayOrder(options.weekStart)) {
		const weekdayDate = new Date(2026, 2, 1 + weekdayIndex, 12, 0, 0, 0);
		const rawLabel = formatter.format(weekdayDate).replace('.', '');
		const label = rawLabel
			? rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase()
			: rawLabel;
		const weekday = row.createDiv({
			text: label,
			cls: 'operon-day-picker-weekday',
		});
		weekday.classList.toggle('is-weekend', weekdayIndex === 0 || weekdayIndex === 6);
	}
}

function renderGrid(
	root: HTMLElement,
	options: OperonDayPickerOptions,
	focusedDate: Date,
	selectedDate: string | null,
): void {
	const grid = root.createDiv('operon-day-picker-grid');
	grid.classList.toggle('has-week-numbers', options.showWeekNumbers);
	const gridStart = getGridStart(focusedDate, options.weekStart);
	const today = localToday();
	const focusedMonth = focusedDate.getMonth();

	for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
		const weekStartDate = new Date(gridStart);
		weekStartDate.setDate(gridStart.getDate() + weekIndex * 7);

		if (options.showWeekNumbers) {
			grid.createDiv({
				text: String(getCalendarWeekNumber(weekStartDate, options.weekStart)),
				cls: 'operon-day-picker-weeknum',
			});
		}

		for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
			const current = new Date(weekStartDate);
			current.setDate(weekStartDate.getDate() + dayOffset);
			const dateKey = formatDateKey(current);
			const button = createButton(String(current.getDate()), 'operon-day-picker-day', grid);
			grid.appendChild(button);
			button.setAttribute('aria-pressed', String(dateKey === selectedDate));
			button.setAttribute('aria-label', formatFullDateLabel(current, options.locale));
			button.classList.toggle('is-weekend', current.getDay() === 0 || current.getDay() === 6);
			button.classList.toggle('is-outside-month', current.getMonth() !== focusedMonth);
			button.classList.toggle('is-selected', dateKey === selectedDate);
			button.classList.toggle('is-today', dateKey === today);
			button.addEventListener('click', () => {
				options.onSelect(dateKey);
			});
		}
	}
}

function renderFooter(
	root: HTMLElement,
	options: OperonDayPickerOptions,
	onToday: (date: Date) => void,
): void {
	const shouldShowClear = options.showClear !== false;
	const shouldShowToday = options.showToday !== false;
	if (!shouldShowClear && !shouldShowToday) return;

	const footer = root.createDiv('operon-day-picker-footer');
	footer.classList.toggle('has-single-action', Number(shouldShowClear) + Number(shouldShowToday) === 1);
	if (shouldShowClear) {
		const clearButton = createButton(options.clearLabel, 'operon-day-picker-footer-button is-clear', footer);
		footer.appendChild(clearButton);
		clearButton.disabled = !options.canClear || !options.onClear;
		clearButton.addEventListener('click', () => {
			if (clearButton.disabled) return;
			options.onClear?.();
		});
	}

	if (shouldShowToday) {
		const todayButton = createButton(options.todayLabel, 'operon-day-picker-footer-button is-today', footer);
		footer.appendChild(todayButton);
		todayButton.addEventListener('click', () => {
			onToday(parseDateKey(localToday()) ?? atLocalNoon(new Date()));
		});
	}
}

function createIconButton(owner: HTMLElement, icon: string, label: string): HTMLButtonElement {
	const button = createButton('', 'operon-day-picker-nav-button', owner);
	owner.appendChild(button);
	button.setAttribute('aria-label', label);
	button.setAttribute('title', label);
	setIcon(button, icon);
	return button;
}

function getWeekdayOrder(weekStart: DayPickerWeekStart): number[] {
	return weekStart === 'sunday'
		? [0, 1, 2, 3, 4, 5, 6]
		: [1, 2, 3, 4, 5, 6, 0];
}

function getGridStart(focusedDate: Date, weekStart: DayPickerWeekStart): Date {
	const monthStart = new Date(focusedDate.getFullYear(), focusedDate.getMonth(), 1, 12, 0, 0, 0);
	const monthStartWeekday = monthStart.getDay();
	const weekStartOffset = weekStart === 'sunday'
		? monthStartWeekday
		: (monthStartWeekday + 6) % 7;
	const gridStart = new Date(monthStart);
	gridStart.setDate(monthStart.getDate() - weekStartOffset);
	return gridStart;
}

function shiftMonth(date: Date, deltaMonths: number): Date {
	const year = date.getFullYear();
	const month = date.getMonth();
	const day = date.getDate();
	const targetMonthBase = new Date(year, month + deltaMonths, 1, 12, 0, 0, 0);
	const targetMonthLastDay = new Date(
		targetMonthBase.getFullYear(),
		targetMonthBase.getMonth() + 1,
		0,
		12,
		0,
		0,
		0,
	).getDate();
	return new Date(
		targetMonthBase.getFullYear(),
		targetMonthBase.getMonth(),
		Math.min(day, targetMonthLastDay),
		12,
		0,
		0,
		0,
	);
}

function getCalendarWeekNumber(date: Date, weekStart: DayPickerWeekStart): number {
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

export function normalizeOperonDateKey(value: string | null | undefined): string | null {
	const normalized = value?.trim() ?? '';
	return parseDateKey(normalized) ? normalized : null;
}

function parseDateKey(value: string | null | undefined): Date | null {
	const match = DATE_KEY_PATTERN.exec(value ?? '');
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day, 12, 0, 0, 0);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
}

function formatDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function formatFullDateLabel(date: Date, locale?: string): string {
	return new Intl.DateTimeFormat(locale, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}).format(date);
}

function atLocalNoon(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}
