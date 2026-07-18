import {
	showSearchableOptionPicker,
	type SearchableOptionPickerItem,
	type SearchableOptionPickerOptions,
} from './searchable-option-picker';

export interface SearchableFieldPickerOption {
	field: string;
	label: string;
	secondaryLabel?: string;
	type?: string;
	icon?: string | null;
	group?: string | null;
	groupLabel?: string | null;
	groupOrder?: number;
}

type SearchableFieldPickerFloatingOptions = Pick<
	SearchableOptionPickerOptions<SearchableOptionPickerItem>,
	| 'floatingHost'
	| 'floatingScrollHost'
	| 'constrainToFloatingHost'
	| 'matchWidth'
	| 'closeOnWindowResize'
	| 'repositionOnWindowResize'
	| 'repositionOnPanelResize'
	| 'repositionOnScroll'
	| 'shouldClose'
>;

interface SearchableFieldPickerOptions<TField extends SearchableFieldPickerOption> extends SearchableFieldPickerFloatingOptions {
	value: string | null | undefined;
	getValue?: () => string | null | undefined;
	fields: readonly TField[];
	placeholder: string;
	ariaLabel: string;
	noMatchesText: string;
	onSelect: (option: TField) => void;
	onClose?: () => void;
	variantClassName?: string;
	getSearchText?: (option: TField) => string;
}

interface SearchableFieldPickerItem<TField extends SearchableFieldPickerOption> extends SearchableOptionPickerItem {
	fieldOption: TField;
}

export function showSearchableFieldPicker<TField extends SearchableFieldPickerOption>(
	anchor: HTMLElement | DOMRect,
	options: SearchableFieldPickerOptions<TField>,
): () => void {
	const pickerOptions: Array<SearchableFieldPickerItem<TField>> = options.fields.map(fieldOption => ({
		value: fieldOption.field,
		label: fieldOption.label || fieldOption.field,
		description: fieldOption.secondaryLabel,
		icon: fieldOption.icon,
		group: fieldOption.group,
		groupLabel: fieldOption.groupLabel,
		groupOrder: fieldOption.groupOrder,
		title: fieldOption.label && fieldOption.label !== fieldOption.field
			? `${fieldOption.label} (${fieldOption.field})`
			: fieldOption.label || fieldOption.field,
		fieldOption,
	}));

	return showSearchableOptionPicker(anchor, {
		value: options.value,
		getValue: options.getValue,
		options: pickerOptions,
		placeholder: options.placeholder,
		ariaLabel: options.ariaLabel,
		noMatchesText: options.noMatchesText,
		onSelect: item => options.onSelect(item.fieldOption),
		onClose: options.onClose,
		variantClassName: options.variantClassName,
		getSearchText: item => options.getSearchText?.(item.fieldOption) ?? `${item.label} ${item.description ?? ''} ${item.value}`,
		floatingHost: options.floatingHost,
		floatingScrollHost: options.floatingScrollHost,
		constrainToFloatingHost: options.constrainToFloatingHost,
		matchWidth: options.matchWidth,
		closeOnWindowResize: options.closeOnWindowResize,
		repositionOnWindowResize: options.repositionOnWindowResize,
		repositionOnPanelResize: options.repositionOnPanelResize,
		repositionOnScroll: options.repositionOnScroll,
		shouldClose: options.shouldClose,
	});
}
