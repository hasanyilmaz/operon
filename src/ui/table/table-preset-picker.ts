import { t } from '../../core/i18n';
import type { TablePreset } from '../../types/table';
import { showSearchableFieldPicker, type SearchableFieldPickerOption } from '../field-pickers/searchable-field-picker';

export interface TablePresetPickerOption extends SearchableFieldPickerOption {
	field: string;
	label: string;
	icon: string;
	preset: TablePreset;
}

interface ShowTablePresetPickerOptions {
	value: string | null | undefined;
	presets: readonly TablePreset[];
	onSelect: (presetId: string, preset: TablePreset) => void;
	onClose?: () => void;
	floatingHost?: HTMLElement;
	floatingScrollHost?: HTMLElement | Window;
	matchWidth?: number;
}

export function getTablePresetPickerLabel(preset: TablePreset): string {
	return preset.name.trim() || t('table', 'untitledPreset');
}

export function buildTablePresetPickerOptions(presets: readonly TablePreset[]): TablePresetPickerOption[] {
	return presets.map(preset => ({
		field: preset.id,
		label: getTablePresetPickerLabel(preset),
		icon: 'table-2',
		preset,
	}));
}

export function showTablePresetPicker(
	anchor: HTMLElement | DOMRect,
	options: ShowTablePresetPickerOptions,
): () => void {
	return showSearchableFieldPicker(anchor, {
		value: options.value,
		fields: buildTablePresetPickerOptions(options.presets),
		placeholder: t('table', 'presetPickerSearchPlaceholder'),
		ariaLabel: t('table', 'selectPreset'),
		noMatchesText: t('table', 'presetPickerNoMatches'),
		onSelect: option => options.onSelect(option.field, option.preset),
		onClose: options.onClose,
		variantClassName: 'operon-table-field-picker',
		floatingHost: options.floatingHost,
		floatingScrollHost: options.floatingScrollHost,
		matchWidth: options.matchWidth,
		repositionOnScroll: true,
		repositionOnWindowResize: true,
	});
}
