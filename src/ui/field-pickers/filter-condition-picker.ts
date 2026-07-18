import { t } from '../../core/i18n';
import type { FilterFieldType } from '../../types/settings';
import { showSearchableFieldPicker } from './searchable-field-picker';
import type { SearchableFieldPickerOption } from './searchable-field-picker';

export interface FilterConditionPickerOption extends SearchableFieldPickerOption {
	type: FilterFieldType;
	searchText?: string;
}

interface FilterConditionPickerOptions {
	value: string;
	fields: readonly FilterConditionPickerOption[];
	onSelect: (option: FilterConditionPickerOption) => void;
	onClose?: () => void;
}

export function showFilterConditionPicker(anchor: HTMLElement | DOMRect, options: FilterConditionPickerOptions): () => void {
	return showSearchableFieldPicker(anchor, {
		value: options.value,
		fields: options.fields,
		placeholder: t('filterSets', 'conditionFieldSearchPlaceholder'),
		ariaLabel: t('filterSets', 'conditionFieldPickerLabel'),
		noMatchesText: t('filterSets', 'conditionFieldNoMatches'),
		getSearchText: option => option.searchText
			?? `${option.label} ${option.secondaryLabel ?? ''} ${option.field}`,
		onSelect: options.onSelect,
		onClose: options.onClose,
		variantClassName: 'operon-filter-condition-picker',
	});
}
