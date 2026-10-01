import { isSettingsScope } from './settings/settings-scope';
import { App, getIcon, Modal, Notice, Setting } from 'obsidian';
import { t } from '../core/i18n';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import { CANONICAL_KEY_MAP } from '../types/keys';
import {
	getNextCustomKeyMappingOrder,
	hasDuplicateKeyMappingCanonicalKey,
	hasDuplicateKeyMappingVisiblePropertyName,
	isRetiredKeyMapping,
	KeyMapping,
	normalizeKeyMappingComparableName,
} from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { getCustomFieldTypeFallbackIcon } from './custom-field-surfaces';
import { openSettingsIconPickerModal } from './settings/settings-icon-picker-modal';

export const CREATABLE_CUSTOM_KEY_MAPPING_TYPES = ['text', 'list', 'number', 'date', 'datetime'] as const;
export type CreatableCustomKeyMappingType = typeof CREATABLE_CUSTOM_KEY_MAPPING_TYPES[number];

export interface CustomKeyMappingDraftInput {
	canonicalKey: string;
	type: string;
	visiblePropertyName: string;
	icon?: string;
	description?: string;
	hideInFileTaskView?: boolean;
	showInEditor?: boolean;
	showInCreator?: boolean;
	showInChips?: boolean;
	showInKanbanSwimlane?: boolean;
}

export type CustomKeyMappingValidationReason =
	| 'canonical-required'
	| 'canonical-invalid'
	| 'canonical-reserved'
	| 'canonical-duplicate'
	| 'type-invalid'
	| 'property-duplicate';

export type CustomKeyMappingBuildResult =
	| { ok: true; mapping: KeyMapping }
	| { ok: false; reason: CustomKeyMappingValidationReason };

const CUSTOM_CANONICAL_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function isCreatableCustomKeyMappingType(value: string): value is CreatableCustomKeyMappingType {
	return (CREATABLE_CUSTOM_KEY_MAPPING_TYPES as readonly string[]).includes(value);
}

export function buildCustomKeyMappingFromDraft(
	draft: CustomKeyMappingDraftInput,
	existingMappings: readonly KeyMapping[],
): CustomKeyMappingBuildResult {
	const canonicalKey = draft.canonicalKey.trim();
	if (!canonicalKey) return { ok: false, reason: 'canonical-required' };
	if (!CUSTOM_CANONICAL_KEY_RE.test(canonicalKey)) return { ok: false, reason: 'canonical-invalid' };
	if (isReservedCanonicalKeyName(canonicalKey)) return { ok: false, reason: 'canonical-reserved' };
	if (hasDuplicateKeyMappingCanonicalKey(canonicalKey, existingMappings)) return { ok: false, reason: 'canonical-duplicate' };
	if (!isCreatableCustomKeyMappingType(draft.type)) return { ok: false, reason: 'type-invalid' };

	const visiblePropertyName = draft.visiblePropertyName.trim() || canonicalKey;
	if (hasDuplicateKeyMappingVisiblePropertyName(visiblePropertyName, existingMappings)) {
		return { ok: false, reason: 'property-duplicate' };
	}

	const icon = normalizeTaskIconValue(draft.icon) || getCustomFieldTypeFallbackIcon(draft.type);
	const description = draft.description?.trim();
	const mapping: KeyMapping = {
		canonicalKey,
		visiblePropertyName,
		type: draft.type,
		sync: 'yes',
		enabled: true,
		hideInFileTaskView: draft.hideInFileTaskView === true,
		icon,
		isSystem: false,
		customOrder: getNextCustomKeyMappingOrder(existingMappings),
		showInEditor: draft.showInEditor !== false,
		showInCreator: draft.showInCreator !== false,
		showInChips: draft.showInChips === true,
		showInKanbanSwimlane: draft.showInKanbanSwimlane === true,
	};
	if (description) {
		mapping.description = description;
	}
	return { ok: true, mapping };
}

export function getCustomKeyMappingValidationMessage(reason: CustomKeyMappingValidationReason): string {
	switch (reason) {
		case 'canonical-required':
			return t('settings', 'keyMappingsCustomFieldCanonicalRequired');
		case 'canonical-invalid':
			return t('settings', 'keyMappingsCustomFieldCanonicalInvalid');
		case 'canonical-reserved':
			return t('settings', 'keyMappingsCustomFieldCanonicalReserved');
		case 'canonical-duplicate':
			return t('settings', 'keyMappingsCustomFieldCanonicalDuplicate');
		case 'type-invalid':
			return t('settings', 'keyMappingsCustomFieldTypeInvalid');
		case 'property-duplicate':
			return t('settings', 'keyMappingsCustomFieldPropertyDuplicate');
	}
}

export interface CustomKeyMappingModalOptions {
	app: App;
	keyMappings: readonly KeyMapping[];
	onSave: (mapping: KeyMapping) => void | Promise<void>;
}

export class CustomKeyMappingModal extends Modal {
	private readonly options: CustomKeyMappingModalOptions;
	private readonly draft: CustomKeyMappingDraftInput = {
		canonicalKey: '',
		type: 'text',
		visiblePropertyName: '',
		icon: '',
		description: '',
		hideInFileTaskView: false,
		showInEditor: true,
		showInCreator: true,
		showInChips: false,
		showInKanbanSwimlane: false,
	};
	private canonicalInputEl: HTMLInputElement | null = null;
	private propertyInputEl: HTMLInputElement | null = null;
	private iconButtonEl: HTMLButtonElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(options: CustomKeyMappingModalOptions) {
		super(options.app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-custom-key-mapping-modal-shell');
		this.contentEl.addClass('operon-custom-key-mapping-modal');
		this.titleEl.setText(t('settings', 'keyMappingsAddCustomFieldTitle'));
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'operon-custom-key-mapping-modal-desc',
			text: t('settings', 'keyMappingsAddCustomFieldDesc'),
		});
		this.errorEl = contentEl.createDiv('operon-custom-key-mapping-error');
		this.errorEl.toggleAttribute('hidden', true);

		const fieldCard = contentEl.createDiv('operon-custom-key-mapping-card');
		this.renderIdentityFields(fieldCard);
		this.renderIconField(fieldCard);
		this.renderDescriptionField(fieldCard);

		const surfaceCard = contentEl.createDiv('operon-custom-key-mapping-card');
		surfaceCard.createDiv({
			cls: 'operon-custom-key-mapping-card-title',
			text: t('settings', 'keyMappingsCustomFieldSurfacesTitle'),
		});
		this.renderToggle(surfaceCard, 'hideInFileTaskView', t('settings', 'keyMappingsHideLabel'), t('settings', 'keyMappingsHideTooltip'));
		this.renderToggle(surfaceCard, 'showInEditor', t('settings', 'keyMappingsShowInEditorLabel'), t('settings', 'keyMappingsShowInEditorTooltip'));
		this.renderToggle(surfaceCard, 'showInCreator', t('settings', 'keyMappingsShowInCreatorLabel'), t('settings', 'keyMappingsShowInCreatorTooltip'));
		this.renderToggle(surfaceCard, 'showInChips', t('settings', 'keyMappingsShowInChipsLabel'), t('settings', 'keyMappingsShowInChipsTooltip'));
		this.renderToggle(surfaceCard, 'showInKanbanSwimlane', t('settings', 'keyMappingsShowInKanbanSwimlaneLabel'), t('settings', 'keyMappingsShowInKanbanSwimlaneTooltip'));

		this.renderFooter(contentEl);
		window.requestAnimationFrame(() => this.canonicalInputEl?.focus());
	}

	private renderIdentityFields(container: HTMLElement): void {
		new Setting(container)
			.setName(t('settings', 'keyMappingsCustomFieldCanonicalLabel'))
			.setDesc(t('settings', 'keyMappingsCustomFieldCanonicalDesc'))
			.addText(text => {
				this.canonicalInputEl = text.inputEl;
				text.inputEl.addClass('operon-custom-key-mapping-canonical-input');
				text.setPlaceholder(t('settings', 'keyMappingsCustomCanonicalPlaceholder'));
				text.onChange(value => {
					this.draft.canonicalKey = value;
					this.clearValidationError();
					this.canonicalInputEl?.removeClass('is-error');
				});
			});

		new Setting(container)
			.setName(t('settings', 'keyMappingsCustomFieldTypeLabel'))
			.setDesc(t('settings', 'keyMappingsCustomFieldTypeDesc'))
			.addDropdown(dropdown => {
				for (const type of CREATABLE_CUSTOM_KEY_MAPPING_TYPES) {
					const typeLabel = t('settings', `keyMappingsType_${type}`);
					dropdown.addOption(type, typeLabel === `keyMappingsType_${type}` ? type : typeLabel);
				}
				dropdown.setValue(this.draft.type);
				dropdown.onChange(value => {
					if (!isCreatableCustomKeyMappingType(value)) return;
					this.draft.type = value;
					this.refreshIconPreview();
				});
			});

		new Setting(container)
			.setName(t('settings', 'keyMappingsCustomFieldPropertyLabel'))
			.setDesc(t('settings', 'keyMappingsCustomFieldPropertyDesc'))
			.addText(text => {
				this.propertyInputEl = text.inputEl;
				text.inputEl.addClass('operon-custom-key-mapping-property-input');
				text.setPlaceholder(t('settings', 'keyMappingsCustomFieldPropertyPlaceholder'));
				text.onChange(value => {
					this.draft.visiblePropertyName = value;
					this.clearValidationError();
					this.propertyInputEl?.removeClass('is-error');
				});
			});
	}

	private renderIconField(container: HTMLElement): void {
		const setting = new Setting(container)
			.setName(t('settings', 'keyMappingsCustomFieldIconLabel'))
			.setDesc(t('settings', 'keyMappingsCustomFieldIconDesc'));
		setting.controlEl.empty();
		this.iconButtonEl = setting.controlEl.createEl('button', {
			cls: 'operon-key-mapping-icon-trigger operon-custom-key-mapping-icon-trigger',
			attr: { type: 'button' },
		});
		setAccessibleLabelWithoutTooltip(this.iconButtonEl, t('settings', 'keyMappingsIconAria'));
		this.iconButtonEl.addEventListener('click', event => {
			event.preventDefault();
			this.openIconPicker();
		});
		this.refreshIconPreview();
	}

	private renderDescriptionField(container: HTMLElement): void {
		new Setting(container)
			.setName(t('settings', 'keyMappingsCustomFieldDescriptionLabel'))
			.addTextArea(text => {
				text.inputEl.addClass('operon-custom-key-mapping-description-input');
				text.setPlaceholder(t('settings', 'keyMappingsCustomFieldDescriptionPlaceholder'));
				text.onChange(value => {
					this.draft.description = value;
				});
			});
	}

	private renderToggle(container: HTMLElement, key: keyof Pick<CustomKeyMappingDraftInput, 'hideInFileTaskView' | 'showInEditor' | 'showInCreator' | 'showInChips' | 'showInKanbanSwimlane'>, label: string, desc: string): void {
		new Setting(container)
			.setName(label)
			.setDesc(desc)
			.addToggle(toggle => {
				toggle.setValue(this.draft[key] === true);
				toggle.onChange(value => {
					this.draft[key] = value;
				});
			});
	}

	private renderFooter(container: HTMLElement): void {
		const footer = container.createDiv('operon-custom-key-mapping-footer');
		const cancelButton = footer.createEl('button', {
			text: t('buttons', 'cancel'),
			attr: { type: 'button' },
		});
		cancelButton.addEventListener('click', () => this.close());

		const saveButton = footer.createEl('button', {
			cls: 'mod-cta',
			text: t('settings', 'keyMappingsAddCustomFieldSave'),
			attr: { type: 'button' },
		});
		saveButton.addEventListener('click', () => {
			void this.handleSaveClick();
		});
	}

	private openIconPicker(): void {
		openSettingsIconPickerModal(this.app, {
			settingsScope: isSettingsScope(this.modalEl),
			title: t('settings', 'keyMappingsCustomFieldIconLabel'),
			value: this.getPreviewIcon(),
			query: '',
			onSelect: iconId => {
				this.draft.icon = normalizeTaskIconValue(iconId);
				this.refreshIconPreview();
			},
			onClear: () => {
				this.draft.icon = '';
				this.refreshIconPreview();
			},
		});
	}

	private refreshIconPreview(): void {
		const button = this.iconButtonEl;
		if (!button) return;
		button.empty();
		setAccessibleLabelWithoutTooltip(button, t('settings', 'keyMappingsIconAria'));
		const iconEl = getIcon(this.getPreviewIcon());
		if (iconEl) {
			iconEl.addClass('operon-key-mapping-icon-preview');
			button.appendChild(iconEl);
			button.addClass('has-icon');
		} else {
			button.removeClass('has-icon');
		}
	}

	private getPreviewIcon(): string {
		const explicitIcon = normalizeTaskIconValue(this.draft.icon);
		if (explicitIcon) return explicitIcon;
		return isCreatableCustomKeyMappingType(this.draft.type)
			? getCustomFieldTypeFallbackIcon(this.draft.type)
			: 'text';
	}

	private async handleSaveClick(): Promise<void> {
		const result = buildCustomKeyMappingFromDraft(this.draft, this.options.keyMappings);
		if (!result.ok) {
			this.showValidationError(result.reason);
			return;
		}
		await this.options.onSave(result.mapping);
		this.close();
	}

	private showValidationError(reason: CustomKeyMappingValidationReason): void {
		const message = getCustomKeyMappingValidationMessage(reason);
		this.errorEl?.setText(message);
		this.errorEl?.toggleAttribute('hidden', false);
		this.canonicalInputEl?.toggleClass('is-error', reason.startsWith('canonical'));
		this.propertyInputEl?.toggleClass('is-error', reason === 'property-duplicate');
		new Notice(message);
	}

	private clearValidationError(): void {
		this.errorEl?.setText('');
		this.errorEl?.toggleAttribute('hidden', true);
	}
}

function isReservedCanonicalKeyName(canonicalKey: string): boolean {
	const normalized = normalizeKeyMappingComparableName(canonicalKey);
	if (isRetiredKeyMapping(canonicalKey)) return true;
	for (const key of CANONICAL_KEY_MAP.keys()) {
		if (normalizeKeyMappingComparableName(key) === normalized) return true;
	}
	return false;
}
