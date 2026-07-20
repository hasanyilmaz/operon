import { Setting, setIcon, setTooltip } from 'obsidian';
import type { DropdownComponent, TextComponent, ToggleComponent } from 'obsidian';

interface BaseSettingOptions {
	settingClass?: string;
	controlClass?: string;
	disabled?: boolean;
}

function applySettingOptions(setting: Setting, options: BaseSettingOptions): Setting {
	if (options.settingClass) setting.settingEl.addClass(options.settingClass);
	return setting;
}

export function renderSettingsHeading(containerEl: HTMLElement, title: string, className?: string): Setting {
	const setting = new Setting(containerEl).setName(title).setHeading();
	if (className) setting.settingEl.addClass(className);
	return setting;
}

export function createSettingsAddButton(containerEl: HTMLElement, label: string): HTMLButtonElement {
	const button = containerEl.createEl('button', {
		cls: 'operon-settings-primary-button operon-settings-add-button',
		attr: { type: 'button' },
	});
	const iconEl = button.createSpan('operon-settings-add-button-icon');
	setIcon(iconEl, 'plus');
	button.createSpan({
		text: label,
		cls: 'operon-settings-add-button-label',
	});
	return button;
}

export interface NativeSettingsDocsActionOptions {
	label: string;
	onClick: () => void;
}

export interface NativeSettingsSectionOptions {
	action?: NativeSettingsDocsActionOptions;
}

export function renderNativeSettingsPageTitleAction(
	titlebarEl: HTMLElement,
	action: NativeSettingsDocsActionOptions,
): HTMLButtonElement {
	titlebarEl.addClass('operon-native-settings-page-titlebar-with-docs');
	const existingButton = titlebarEl.querySelector<HTMLButtonElement>('.operon-native-settings-page-title-docs-action');
	existingButton?.remove();

	const actionButton = titlebarEl.createEl('button', {
		cls: 'clickable-icon operon-native-settings-page-title-docs-action',
		attr: {
			type: 'button',
			'aria-label': action.label,
		},
	});
	setIcon(actionButton, 'circle-question-mark');
	setTooltip(actionButton, action.label);
	actionButton.addEventListener('click', () => {
		action.onClick();
	});
	return actionButton;
}

export function renderNativeSettingsSection(
	containerEl: HTMLElement,
	title: string,
	desc?: string,
	options?: NativeSettingsSectionOptions,
): HTMLElement {
	if (!containerEl.closest('.operon-settings-native-page-root')) {
		renderSettingsHeading(containerEl, title);
		return containerEl;
	}

	const sectionEl = containerEl.createDiv('operon-native-settings-section');
	const headingEl = sectionEl.createDiv('operon-native-settings-section-heading');
	headingEl.createEl('h2', {
		text: title,
		cls: 'operon-native-settings-section-title',
	});
	const action = options?.action;
	if (action) {
		const actionButton = headingEl.createEl('button', {
			cls: 'clickable-icon operon-native-settings-section-docs-action',
			attr: {
				type: 'button',
				'aria-label': action.label,
			},
		});
		setIcon(actionButton, 'circle-question-mark');
		setTooltip(actionButton, action.label);
		actionButton.addEventListener('click', () => {
			action.onClick();
		});
	}
	if (desc) {
		sectionEl.createEl('p', {
			text: desc,
			cls: 'operon-native-settings-section-desc',
		});
	}
	return sectionEl.createDiv('operon-native-settings-section-body');
}

export function renderNativeSettingsGroupedSection(
	containerEl: HTMLElement,
	title: string,
	desc?: string,
	options?: NativeSettingsSectionOptions,
): HTMLElement {
	const sectionBody = renderNativeSettingsSection(containerEl, title, desc, options);
	if (sectionBody.closest('.operon-settings-native-page-root')) {
		sectionBody.addClass('operon-native-settings-section-card');
	}
	return sectionBody;
}

export function renderSettingsInfoBox(containerEl: HTMLElement, title: string, description: string, searchTargetId?: string): HTMLElement {
	const infoBox = containerEl.createDiv('operon-settings-info-box');
	infoBox.createEl('strong', {
		text: title,
		cls: 'operon-settings-info-box-title',
	});
	const bodyEl = infoBox.createEl('p', {
		text: description,
		cls: 'operon-settings-info-box-body',
	});
	if (searchTargetId) bodyEl.dataset.operonSettingsSearchId = searchTargetId;
	return infoBox;
}

export function setSettingsControlHidden(setting: Setting | null, hidden: boolean): void {
	setting?.settingEl.toggleClass('operon-settings-hidden', hidden);
}

export interface SettingsCollapsibleSectionOptions {
	containerEl: HTMLElement;
	title: string;
	sectionId: string;
	expandedSectionIds: Set<string>;
	defaultOpen?: boolean;
	desc?: string;
}

function toSettingsDomId(prefix: string, id: string): string {
	return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function createSettingsCollapsibleSection(options: SettingsCollapsibleSectionOptions): HTMLElement {
	const defaultOpen = options.defaultOpen ?? false;
	const closedId = `__closed__${options.sectionId}`;
	const isOpen = options.expandedSectionIds.has(options.sectionId)
		? true
		: options.expandedSectionIds.has(closedId)
			? false
			: defaultOpen;

	const section = options.containerEl.createDiv('operon-settings-section');
	if (isOpen) section.addClass('is-open');

	const header = section.createEl('button', {
		cls: 'operon-settings-section-header',
		attr: {
			type: 'button',
			'aria-expanded': isOpen ? 'true' : 'false',
		},
	});
	const chevron = header.createSpan('operon-settings-section-chevron');
	setIcon(chevron, 'chevron-right');
	const titleWrap = header.createSpan('operon-settings-section-title-wrap');
	titleWrap.createSpan({ cls: 'operon-settings-section-title', text: options.title });
	if (options.desc) titleWrap.createSpan({ cls: 'operon-settings-section-subtitle', text: options.desc });

	const body = section.createDiv('operon-settings-section-body');
	body.id = toSettingsDomId('operon-settings-section-body', options.sectionId);
	body.toggleAttribute('inert', !isOpen);
	body.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
	header.setAttribute('aria-controls', body.id);
	const bodyInner = body.createDiv('operon-settings-section-body-inner');

	header.addEventListener('click', () => {
		const opening = !section.hasClass('is-open');
		section.toggleClass('is-open', opening);
		header.setAttribute('aria-expanded', opening ? 'true' : 'false');
		body.toggleAttribute('inert', !opening);
		body.setAttribute('aria-hidden', opening ? 'false' : 'true');
		if (opening) {
			options.expandedSectionIds.add(options.sectionId);
			options.expandedSectionIds.delete(closedId);
		} else {
			options.expandedSectionIds.delete(options.sectionId);
			options.expandedSectionIds.add(closedId);
		}
	});

	return bodyInner;
}

export interface ToggleSettingOptions {
	containerEl: HTMLElement;
	name: string;
	desc: string;
	value: boolean;
	onChange: (value: boolean) => void | Promise<void>;
	configure?: (toggle: ToggleComponent) => void;
	settingClass?: string;
	disabled?: boolean;
}

export function renderToggleSetting(options: ToggleSettingOptions): Setting {
	return applySettingOptions(new Setting(options.containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addToggle(toggle => {
			toggle.setValue(options.value);
			toggle.setDisabled(options.disabled === true);
			options.configure?.(toggle);
			toggle.onChange(value => {
				void options.onChange(value);
			});
		}), options);
}

export interface DropdownSettingOption<TValue extends string> {
	value: TValue;
	label: string;
}

export interface DropdownSettingOptions<TValue extends string> {
	containerEl: HTMLElement;
	name: string;
	desc: string;
	value: TValue;
	options: DropdownSettingOption<TValue>[];
	onChange: (value: TValue) => void | Promise<void>;
	configure?: (dropdown: DropdownComponent) => void;
	settingClass?: string;
	controlClass?: string;
	disabled?: boolean;
}

export function renderDropdownSetting<TValue extends string>(options: DropdownSettingOptions<TValue>): Setting {
	return applySettingOptions(new Setting(options.containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addDropdown(dropdown => {
			for (const item of options.options) {
				dropdown.addOption(item.value, item.label);
			}
			options.configure?.(dropdown);
			dropdown.setValue(options.value);
			if (options.controlClass) dropdown.selectEl.addClass(options.controlClass);
			dropdown.selectEl.disabled = options.disabled === true;
			dropdown.onChange(value => {
				void options.onChange(value as TValue);
			});
		}), options);
}

export interface TextSettingOptions {
	containerEl: HTMLElement;
	name: string;
	desc: string;
	value: string;
	onChange: (value: string, text: TextComponent) => void | Promise<void>;
	placeholder?: string;
	configure?: (text: TextComponent) => void;
	settingClass?: string;
	controlClass?: string;
	disabled?: boolean;
}

export function renderTextSetting(options: TextSettingOptions): Setting {
	return applySettingOptions(new Setting(options.containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addText(text => {
			if (options.placeholder) text.setPlaceholder(options.placeholder);
			text.setValue(options.value);
			const controlClass = options.controlClass ?? (options.configure ? null : 'operon-settings-input-wide');
			if (controlClass) text.inputEl.addClass(controlClass);
			text.inputEl.disabled = options.disabled === true;
			options.configure?.(text);
			text.onChange(value => {
				void options.onChange(value, text);
			});
		}), options);
}

export interface NumericTextSettingOptions {
	containerEl: HTMLElement;
	name: string;
	desc: string;
	value: number;
	min: number;
	max?: number;
	onChange: (value: number) => void | Promise<void>;
	configure?: (text: TextComponent) => void;
	settingClass?: string;
	controlClass?: string;
	disabled?: boolean;
}

export function renderNumericTextSetting(options: NumericTextSettingOptions): Setting {
	return renderTextSetting({
		containerEl: options.containerEl,
		name: options.name,
		desc: options.desc,
		value: String(options.value),
		settingClass: options.settingClass,
		controlClass: options.controlClass,
		disabled: options.disabled,
		configure: text => {
			text.inputEl.type = 'number';
			text.inputEl.min = String(options.min);
			if (typeof options.max === 'number') {
				text.inputEl.max = String(options.max);
			}
			options.configure?.(text);
		},
		onChange: value => {
			let parsed = parseInt(value, 10);
			if (isNaN(parsed)) return;
			parsed = Math.max(options.min, typeof options.max === 'number' ? Math.min(options.max, parsed) : parsed);
			void options.onChange(parsed);
		},
	});
}
