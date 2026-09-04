import type { App } from 'obsidian';
import type { DateDisplayFormat } from '../../../types/settings';
import { type ManualDatePickerOptions, showDatePicker } from '../date-picker';
import type { CustomFieldPickerBaseOptions } from './common';

export interface CustomDateFieldPickerOptions extends CustomFieldPickerBaseOptions<'date'> {
	app?: App;
	value?: string;
	dateDisplayFormat?: DateDisplayFormat;
	dayPicker?: ManualDatePickerOptions;
	onCommit: (canonicalKey: string, value: string) => void;
	onRemove?: (canonicalKey: string) => void;
	canRemove?: boolean;
}

export function showCustomDateFieldPicker(
	anchor: HTMLElement | DOMRect,
	options: CustomDateFieldPickerOptions,
): () => void {
	return showDatePicker(anchor, {
		app: options.app,
		fieldKey: options.canonicalKey,
		value: options.value,
		dateDisplayFormat: options.dateDisplayFormat,
		manualDatePicker: options.dayPicker,
		retainInputFocus: options.retainInputFocus,
		classNames: {
			useBaseClasses: false,
			panel: 'operon-custom-field-picker operon-custom-field-picker--date operon-custom-date-picker-panel',
			query: 'operon-custom-field-picker-input operon-custom-date-picker-query',
			results: 'operon-custom-date-picker-results',
			dayPickerHost: 'operon-custom-date-picker-day-picker-host',
			native: 'operon-custom-date-picker-native',
			item: 'operon-custom-date-picker-item',
			itemLabel: 'operon-custom-date-picker-item-label',
			itemDate: 'operon-custom-date-picker-item-date',
			itemWeekday: 'operon-custom-date-picker-item-weekday',
			empty: 'operon-custom-date-picker-empty',
			actions: 'operon-custom-date-picker-actions',
			removeButton: 'operon-custom-date-picker-remove',
			applyButton: 'operon-custom-date-picker-apply',
		},
		onSelect: value => options.onCommit(options.canonicalKey, value),
		canRemove: options.canRemove,
		onRemove: options.onRemove ? () => options.onRemove?.(options.canonicalKey) : undefined,
		onCancel: options.onCancel,
		onClose: options.onClose,
	});
}
