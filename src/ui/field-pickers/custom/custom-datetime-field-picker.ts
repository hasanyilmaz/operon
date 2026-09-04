import type { App } from 'obsidian';
import type { DateDisplayFormat, OperonSettings } from '../../../types/settings';
import { showDatetimePicker } from '../datetime-picker';
import type { CustomFieldPickerBaseOptions } from './common';

export interface CustomDatetimeFieldPickerOptions extends CustomFieldPickerBaseOptions<'datetime'> {
	app?: App;
	settings: Pick<OperonSettings, 'timeFormat' | 'calendarWeekStart' | 'calendarSidebarShowWeekNumbers'>;
	dateDisplayFormat?: DateDisplayFormat;
	value?: string;
	onCommit: (canonicalKey: string, value: string) => void;
	onRemove?: (canonicalKey: string) => void;
	canRemove?: boolean;
}

export function showCustomDatetimeFieldPicker(
	anchor: HTMLElement | DOMRect,
	options: CustomDatetimeFieldPickerOptions,
): () => void {
	return showDatetimePicker(anchor, {
		app: options.app,
		settings: options.settings,
		dateDisplayFormat: options.dateDisplayFormat,
		fieldKey: options.canonicalKey,
		value: options.value,
		retainInputFocus: options.retainInputFocus,
		classNames: {
			useBaseClasses: false,
			panel: 'operon-custom-field-picker operon-custom-field-picker--datetime operon-custom-datetime-picker-panel',
			topRow: 'operon-custom-datetime-picker-top-row',
			query: 'operon-custom-field-picker-input operon-custom-datetime-picker-query',
			topTime: 'operon-custom-datetime-picker-top-time',
			timeInput: 'operon-custom-datetime-picker-time-input',
			controlsRow: 'operon-custom-datetime-picker-controls-row',
			dateSection: 'operon-custom-datetime-picker-control-section',
			dateLabel: 'operon-custom-datetime-picker-control-label',
			dayPickerHost: 'operon-custom-datetime-picker-day-picker-host',
			meridiem: 'operon-custom-datetime-picker-meridiem',
			meridiemButton: 'operon-custom-datetime-picker-meridiem-btn',
			dateResults: 'operon-custom-datetime-picker-date-results',
			dateItem: 'operon-custom-datetime-picker-date-item',
			dateItemLabel: 'operon-custom-datetime-picker-date-item-label',
			dateItemDate: 'operon-custom-datetime-picker-date-item-date',
			dateItemWeekday: 'operon-custom-datetime-picker-date-item-weekday',
			empty: 'operon-custom-datetime-picker-empty',
			timeResults: 'operon-custom-datetime-picker-time-results',
			timeItem: 'operon-custom-datetime-picker-time-item',
			timeNotice: 'operon-custom-datetime-picker-time-notice',
			actions: 'operon-custom-datetime-picker-actions',
			clearButton: 'operon-custom-datetime-picker-clear',
			todayButton: 'operon-custom-datetime-picker-today',
		},
		onSelect: value => options.onCommit(options.canonicalKey, value),
		canRemove: options.canRemove,
		onRemove: options.onRemove ? () => options.onRemove?.(options.canonicalKey) : undefined,
		onCancel: options.onCancel,
		onClose: options.onClose,
	});
}
