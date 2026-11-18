import { setIcon } from 'obsidian';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { t } from '../../core/i18n';
import { normalizeDateDisplayFormat, type DateDisplayFormat } from '../../types/settings';
import { createFloatingPanel } from '../field-pickers/common';

export function calendarMonthTarget(dateKey: string, year: number, month: number): string {
	const day = Number(dateKey.split('-')[2]);
	const end = new Date(0);
	end.setFullYear(year, month + 1, 0);
	return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, end.getDate())).padStart(2, '0')}`;
}

export function calendarNavigationLabels(dateKey: string, format: DateDisplayFormat, locale: string | undefined): {
	year: string; date: string; full: string; yearFirst: boolean;
} {
	const [year, month, day] = dateKey.split('-').map(Number);
	const value = new Date(0);
	value.setFullYear(year, month - 1, day);
	value.setHours(12, 0, 0, 0);
	const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(value);
	const normalized = normalizeDateDisplayFormat(format);
	const date = normalized === 'DD/MM/YYYY' ? `${day} ${monthName}` : `${monthName} ${day}`;
	const yearFirst = normalized === 'YYYY-MM-DD';
	return { year: String(year), date, full: yearFirst ? `${year} ${date}` : `${date} ${year}`, yearFirst };
}

export function showCalendarMonthPicker(anchor: HTMLElement, options: {
	dateKey: string;
	locale: string | undefined;
	onSelect: (dateKey: string) => void;
	onClose: () => void;
}): () => void {
	const originalYear = Number(options.dateKey.slice(0, 4));
	const originalMonth = Number(options.dateKey.slice(5, 7)) - 1;
	let year = originalYear;
	let selected = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-calendar-month-picker', options.onClose, {
		floatingHost: anchor.ownerDocument.body,
		floatingScrollHost: anchor.ownerDocument.defaultView ?? window,
		outsideClickExclusions: [anchor],
		matchWidth: 280,
		closeOnWindowResize: false,
		repositionOnScroll: true,
		repositionOnWindowResize: true,
	});
	panel.setAttribute('role', 'dialog');
	setAccessibleLabelWithoutTooltip(panel, t('calendar', 'title'));
	const years = panel.createDiv('operon-calendar-month-picker-years');
	const months = panel.createDiv('operon-calendar-month-picker-months');
	const labelButton = (button: HTMLButtonElement, text: string): void => {
		button.createSpan('operon-calendar-month-choice-label').createSpan({ cls: 'operon-calendar-month-choice-text', text });
	};
	const yearButtons: HTMLButtonElement[] = [];
	const monthButtons: HTMLButtonElement[] = [];
	const refresh = (): void => {
		previous.disabled = year <= 1;
		next.disabled = year >= 9999;
		yearButtons.forEach((button, index) => {
			const value = year + index - 1;
			const text = button.querySelector<HTMLElement>('.operon-calendar-month-choice-text');
			if (text) text.textContent = String(value);
			button.disabled = value < 1 || value > 9999;
			button.setAttribute('aria-pressed', String(index === 1));
		});
		monthButtons.forEach((button, index) => {
			button.setAttribute('aria-pressed', String(year === originalYear && index === originalMonth));
			setAccessibleLabelWithoutTooltip(button, `${button.dataset.monthLabel ?? ''} ${year}`);
		});
	};
	const arrow = (icon: string, label: string, delta: number): HTMLButtonElement => {
		const button = years.createEl('button', { cls: 'operon-calendar-toolbar-button', attr: { type: 'button', 'aria-label': label } });
		setIcon(button, icon);
		setAccessibleLabelWithoutTooltip(button, label);
		button.addEventListener('click', () => { year += delta; refresh(); });
		return button;
	};
	const previous = arrow('chevron-left', t('calendar', 'previousYear'), -1);
	for (let offset = -1; offset <= 1; offset++) {
		const button = years.createEl('button', { cls: 'operon-calendar-toolbar-button', attr: { type: 'button' } });
		labelButton(button, '');
		button.addEventListener('click', () => { year += offset; refresh(); });
		yearButtons.push(button);
	}
	const next = arrow('chevron-right', t('calendar', 'nextYear'), 1);
	for (let month = 0; month < 12; month++) {
		const value = new Date(2024, month, 1, 12);
		const button = months.createEl('button', {
			cls: 'operon-calendar-toolbar-button',
			attr: { type: 'button' },
		});
		labelButton(button, new Intl.DateTimeFormat(options.locale, { month: 'short' }).format(value));
		button.dataset.monthLabel = new Intl.DateTimeFormat(options.locale, { month: 'long' }).format(value);
		button.addEventListener('click', () => {
			if (selected) return;
			selected = true;
			const target = calendarMonthTarget(options.dateKey, year, month);
			close();
			options.onSelect(target);
		});
		monthButtons.push(button);
	}
	refresh();
	yearButtons[1]?.focus({ preventScroll: true });
	return close;
}
