import { App, Modal } from 'obsidian';
import { t } from '../../core/i18n';
import type { ColorPaletteEntry } from '../../core/color-palette';
import { getOwnerWindow } from '../../core/dom-compat';
import { showColorPicker } from '../field-pickers/color-picker';

interface SettingsColorPickerModalOptions {
	title?: string;
	value?: string;
	palette?: ColorPaletteEntry[];
	onSelect: (value: string) => void | Promise<void>;
	onClear?: () => void | Promise<void>;
}

export class SettingsColorPickerModal extends Modal {
	private readonly options: SettingsColorPickerModalOptions;
	private closePicker: (() => void) | null = null;
	private closing = false;

	constructor(app: App, options: SettingsColorPickerModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-settings-color-picker-modal');
		this.titleEl.setText(this.options.title ?? t('settings', 'colorPaletteSection'));
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

		const hostEl = contentEl.createDiv('operon-settings-color-picker-host');
		const anchorEl = hostEl.createDiv('operon-settings-color-picker-anchor');
		const ownerWindow = getOwnerWindow(contentEl);
		ownerWindow.requestAnimationFrame(() => {
			if (!hostEl.isConnected || this.closing) return;
			this.closePicker = showColorPicker(anchorEl, {
				value: this.options.value,
				palette: this.options.palette,
				floatingHost: hostEl,
				floatingScrollHost: hostEl,
				constrainToFloatingHost: true,
				retainInputFocus: true,
				onSelect: value => {
					void Promise.resolve(this.options.onSelect(value)).finally(() => this.close());
				},
				onClear: this.options.onClear
					? () => {
						void Promise.resolve(this.options.onClear?.()).finally(() => this.close());
					}
					: undefined,
				onClose: () => {
					if (!this.closing) this.close();
				},
			});
		});
	}
}

export function openSettingsColorPickerModal(app: App, options: SettingsColorPickerModalOptions): SettingsColorPickerModal {
	const modal = new SettingsColorPickerModal(app, options);
	modal.open();
	return modal;
}
