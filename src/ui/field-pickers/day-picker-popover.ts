import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { getAppLocale } from '../../core/obsidian-app';
import { createFloatingPanel, type FloatingHostOptions, resolvePickerApp } from './common';
import { DayPickerWeekStart, renderOperonDayPicker } from './day-picker';
import { getDatePickerLocaleStrings, resolveDatePickerLanguage } from './date-nlp';

export interface OperonDayPickerPopoverOptions extends FloatingHostOptions {
	app?: App;
	value?: string;
	weekStart: DayPickerWeekStart;
	showWeekNumbers: boolean;
	canClear?: boolean;
	onSelect: (value: string) => void;
	onClear?: () => void;
	onClose?: () => void;
}

export function showOperonDayPickerPopover(
	anchor: HTMLElement | DOMRect,
	options: OperonDayPickerPopoverOptions,
): () => void {
	const app = resolvePickerApp(anchor, options.app);
	const strings = getDatePickerLocaleStrings(resolveDatePickerLanguage());
	const { panel, close } = createFloatingPanel(
		anchor,
		'operon-floating-panel operon-day-picker-popover-panel',
		() => options.onClose?.(),
		{
			floatingHost: options.floatingHost,
			floatingScrollHost: options.floatingScrollHost,
			constrainToFloatingHost: options.constrainToFloatingHost,
			repositionOnPanelResize: false,
		},
	);

	const host = panel.createDiv('operon-day-picker-popover-host');
	renderOperonDayPicker(host, {
		value: options.value,
		weekStart: options.weekStart,
		showWeekNumbers: options.showWeekNumbers,
		locale: getAppLocale(app),
		clearLabel: strings.clear,
		todayLabel: strings.today,
		previousYearLabel: t('calendar', 'previousYear'),
		nextYearLabel: t('calendar', 'nextYear'),
		previousMonthLabel: t('calendar', 'previousMonth'),
		nextMonthLabel: t('calendar', 'nextMonth'),
		canClear: options.canClear,
		onSelect: value => {
			options.onSelect(value);
			close();
		},
		onClear: options.onClear
			? () => {
				options.onClear?.();
				close();
			}
			: undefined,
	});

	return close;
}
