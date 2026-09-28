import { App, Modal } from 'obsidian';
import { getOwnerWindow } from '../../core/dom-compat';
import {
	showSearchableOptionPicker,
	type SearchableOptionPickerItem,
} from '../field-pickers/searchable-option-picker';
import {
	showSearchableMultiOptionPicker,
	type SearchableMultiOptionPickerOptions,
} from '../field-pickers/list-picker';

export interface SettingsOptionPickerModalOptions<TOption extends SearchableOptionPickerItem> {
	title: string;
	value: string | null | undefined;
	options: readonly TOption[];
	placeholder: string;
	ariaLabel: string;
	noMatchesText: string;
	getSearchText?: (option: TOption) => string;
	onSelect: (option: TOption) => void;
}

export class SettingsOptionPickerModal<TOption extends SearchableOptionPickerItem> extends Modal {
	private readonly options: SettingsOptionPickerModalOptions<TOption>;
	private closePicker: (() => void) | null = null;
	private closing = false;

	constructor(app: App, options: SettingsOptionPickerModalOptions<TOption>) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-settings-option-picker-modal');
		this.titleEl.setText(this.options.title);
		this.render();
	}

	onClose(): void {
		this.closing = true;
		this.closePicker?.();
		this.closePicker = null;
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const hostEl = contentEl.createDiv('operon-settings-option-picker-host');
		const anchorEl = hostEl.createDiv('operon-settings-option-picker-anchor');
		const ownerWindow = getOwnerWindow(contentEl);
		ownerWindow.requestAnimationFrame(() => {
			if (!hostEl.isConnected || this.closing) return;
			this.closePicker = showSearchableOptionPicker(anchorEl, {
				value: this.options.value,
				options: this.options.options,
				placeholder: this.options.placeholder,
				ariaLabel: this.options.ariaLabel,
				noMatchesText: this.options.noMatchesText,
				getSearchText: this.options.getSearchText,
				floatingHost: hostEl,
				floatingScrollHost: hostEl,
				constrainToFloatingHost: true,
				matchWidth: Math.max(0, hostEl.getBoundingClientRect().width - 16),
				closeOnEscape: false,
				closeOnWindowResize: false,
				repositionOnWindowResize: true,
				shouldClose: reason => reason !== 'escape' && reason !== 'outside',
				onSelect: option => {
					this.options.onSelect(option);
					this.close();
				},
				onClose: () => {
					if (!this.closing) this.close();
				},
			});
		});
	}
}

export function openSettingsOptionPickerModal<TOption extends SearchableOptionPickerItem>(
	app: App,
	options: SettingsOptionPickerModalOptions<TOption>,
): SettingsOptionPickerModal<TOption> {
	const modal = new SettingsOptionPickerModal(app, options);
	modal.open();
	return modal;
}

export interface SettingsMultiOptionPickerModalOptions extends Omit<SearchableMultiOptionPickerOptions, 'floatingOptions' | 'onClose' | 'onPanelClose'> {
	onClose?: () => void;
}

export class SettingsMultiOptionPickerModal extends Modal {
	private readonly options: SettingsMultiOptionPickerModalOptions;
	private closePicker: (() => void) | null = null;
	private closing = false;
	private committed = false;

	constructor(app: App, options: SettingsMultiOptionPickerModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-settings-option-picker-modal');
		this.titleEl.setText(this.options.title);
		this.render();
	}

	onClose(): void {
		this.closing = true;
		this.closePicker?.();
		this.closePicker = null;
		this.contentEl.empty();
		if (!this.committed) this.options.onClose?.();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const hostEl = contentEl.createDiv('operon-settings-option-picker-host');
		const anchorEl = hostEl.createDiv('operon-settings-option-picker-anchor');
		const ownerWindow = getOwnerWindow(contentEl);
		const { onClose: _onClose, onSave, onQueryAction, ...pickerOptions } = this.options;
		ownerWindow.requestAnimationFrame(() => {
			if (!hostEl.isConnected || this.closing) return;
			this.closePicker = showSearchableMultiOptionPicker(anchorEl, {
				...pickerOptions,
				onSave: values => {
					this.committed = true;
					onSave(values);
				},
				onQueryAction: query => {
					this.committed = true;
					onQueryAction?.(query);
				},
				floatingOptions: {
					floatingHost: hostEl,
					floatingScrollHost: hostEl,
					constrainToFloatingHost: true,
					matchWidth: Math.max(0, hostEl.getBoundingClientRect().width - 16),
					closeOnWindowResize: false,
					repositionOnWindowResize: true,
					shouldClose: reason => reason !== 'escape' && reason !== 'outside',
				},
				onPanelClose: () => {
					if (!this.closing) this.close();
				},
			});
		});
	}
}

export function openSettingsMultiOptionPickerModal(
	app: App,
	options: SettingsMultiOptionPickerModalOptions,
): SettingsMultiOptionPickerModal {
	const modal = new SettingsMultiOptionPickerModal(app, options);
	modal.open();
	return modal;
}
