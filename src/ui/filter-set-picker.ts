import type { App } from 'obsidian';
import { openSettingsOptionPickerModal } from './settings/settings-option-picker-modal';
import { t } from '../core/i18n';
import { isSpecialDynamicFilterSet } from '../core/dynamic-file-task-filter';
import type { FilterSet } from '../types/settings';
import { showSearchableOptionPicker } from './field-pickers/searchable-option-picker';

interface FilterSetPickerOptions {
	settingsApp?: App;
	filterSets: readonly FilterSet[];
	value: string | null | undefined;
	onChooseFilter: (filterSetId: string | null) => void;
}

/** Configure the shared picker without changing preset-picker behavior. */
export function showFilterSetPicker(anchor: HTMLElement, options: FilterSetPickerOptions): () => void {
	const noFilter = t('calendar', 'noFilter');
	const pickerOptions = {
		value: options.value ?? '',
		options: [
			{ value: '', label: noFilter, title: noFilter },
			...options.filterSets.filter(filter => !isSpecialDynamicFilterSet(filter)).map(filter => ({
				value: filter.id,
				label: filter.name.trim() || '—',
				title: filter.name.trim() || '—',
			})),
		],
		placeholder: t('calendar', 'filterPickerSearchPlaceholder'),
		ariaLabel: t('calendar', 'chooseFilter'),
		noMatchesText: t('calendar', 'noMatchingFilters'),
		getSearchText: (option: { label: string }) => option.label,
		onSelect: (option: { value: string }) => options.onChooseFilter(option.value || null),
		onClose: () => {
			observer.disconnect();
			if (anchor.isConnected) anchor.focus({ preventScroll: true });
		},
		closeOnWindowResize: false,
		repositionOnWindowResize: true,
		repositionOnScroll: true,
	};
	if (options.settingsApp) {
		const modal = openSettingsOptionPickerModal(options.settingsApp, {
			...pickerOptions,
			title: t('calendar', 'chooseFilter'),
		});
		return () => modal.close();
	}
	const observer = new MutationObserver(() => {
		if (!anchor.isConnected) close();
	});
	const close = showSearchableOptionPicker(anchor, pickerOptions);
	observer.observe(anchor.ownerDocument.body, { childList: true, subtree: true });
	return close;
}
