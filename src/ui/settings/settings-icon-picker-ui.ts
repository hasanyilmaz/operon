import { App, Setting, getIcon } from 'obsidian';
import { t } from '../../core/i18n';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { runSettingsAsync } from './async-settings-action';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { openSettingsIconPickerModal } from './settings-icon-picker-modal';

export interface SettingsIconPickerRowOptions {
	app: App;
	containerEl: HTMLElement;
	name: string;
	desc: string;
	value: string;
	onChange: (value: string) => void | Promise<void>;
	placeholder?: string;
	ariaLabel?: string;
	tooltip?: string;
	settingClass?: string;
	controlClass?: string;
	errorContext?: string;
}

export interface SettingsIconPickerRowHandle {
	setting: Setting;
	buttonEl: HTMLButtonElement;
	setValue: (value: string) => void;
}

function formatIconPickerAriaLabel(name: string, value: string, placeholder: string): string {
	return value ? `${name}: ${value}` : `${name}: ${placeholder}`;
}

export function renderSettingsIconPickerRow(options: SettingsIconPickerRowOptions): SettingsIconPickerRowHandle {
	const placeholder = options.placeholder ?? t('settings', 'searchLucideIconPlaceholder');
	let currentValue = options.value.trim();

	const setting = new Setting(options.containerEl)
		.setName(options.name)
		.setDesc(options.desc);
	if (options.settingClass) setting.settingEl.addClass(options.settingClass);

	const buttonEl = setting.controlEl.createEl('button', {
		cls: `operon-settings-icon-picker-trigger ${options.controlClass ?? ''}`.trim(),
		attr: {
			type: 'button',
		},
	});
	const previewEl = buttonEl.createSpan('operon-settings-icon-picker-preview');
	const valueEl = buttonEl.createSpan('operon-settings-icon-picker-value');
	bindOperonHoverTooltip(buttonEl, {
		content: options.tooltip ?? placeholder,
		taskColor: null,
	});

	const refresh = (): void => {
		previewEl.empty();
		buttonEl.toggleClass('has-icon', false);
		previewEl.toggleClass('has-icon', false);

		const iconEl = currentValue ? getIcon(currentValue) : null;
		if (iconEl) {
			iconEl.addClass('operon-settings-icon-picker-preview-svg');
			previewEl.appendChild(iconEl);
			buttonEl.toggleClass('has-icon', true);
			previewEl.toggleClass('has-icon', true);
		}

		valueEl.setText(currentValue || placeholder);
		valueEl.toggleClass('is-placeholder', !currentValue);
		setAccessibleLabelWithoutTooltip(
			buttonEl,
			options.ariaLabel ?? formatIconPickerAriaLabel(options.name, currentValue, placeholder),
		);
	};

	const setValue = (value: string): void => {
		currentValue = value.trim();
		refresh();
	};

	const commitValue = async (value: string): Promise<void> => {
		const nextValue = value.trim();
		await options.onChange(nextValue);
		setValue(nextValue);
	};
	const openPicker = (): void => {
		openSettingsIconPickerModal(options.app, {
			title: options.name,
			value: currentValue,
			query: '',
			onSelect: iconId => {
				runSettingsAsync(options.errorContext ?? 'settings icon picker change failed', () => commitValue(iconId));
			},
			onClear: () => {
				runSettingsAsync(options.errorContext ?? 'settings icon picker clear failed', () => commitValue(''));
			},
		});
	};

	buttonEl.addEventListener('pointerdown', event => {
		event.preventDefault();
		event.stopPropagation();
		openPicker();
	});
	buttonEl.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		openPicker();
	});

	refresh();
	return { setting, buttonEl, setValue };
}
