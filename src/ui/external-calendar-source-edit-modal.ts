import { App, Modal, Notice, Setting } from 'obsidian';
import { ExternalCalendarSource } from '../types/settings';
import { t } from '../core/i18n';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';

export interface ExternalCalendarSourceEditModalOptions {
	app: App;
	source: ExternalCalendarSource;
	isNew: boolean;
	onSave: (updated: ExternalCalendarSource) => void | Promise<void>;
	onCancel?: () => void | Promise<void>;
	onSyncNow?: () => void | Promise<void>;
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const MIN_REFRESH_HOURS = 1;
const MAX_REFRESH_HOURS = 720;

/**
 * "Sync now" runs against the source as it is saved in settings, not against
 * the modal draft, so it must stay disabled while the draft URL differs from
 * the saved URL (otherwise it would silently fetch the old address).
 */
export function canSyncExternalCalendarSourceNow(input: {
	draftUrl: string;
	savedUrl: string;
	hasSyncHandler: boolean;
}): boolean {
	const draftUrl = input.draftUrl.trim();
	if (!input.hasSyncHandler || draftUrl.length === 0) return false;
	return draftUrl === input.savedUrl.trim();
}

export class ExternalCalendarSourceEditModal extends Modal {
	private readonly source: ExternalCalendarSource;
	private readonly opts: ExternalCalendarSourceEditModalOptions;
	private readonly savedUrl: string;
	private didSave = false;

	constructor(opts: ExternalCalendarSourceEditModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.source = opts.source;
		this.savedUrl = opts.isNew ? '' : opts.source.url;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-external-calendar-edit-modal-shell');
		this.contentEl.addClass('operon-external-calendar-edit-modal');
		this.renderModal();
	}

	onClose(): void {
		if (!this.didSave && this.opts.isNew) {
			void this.opts.onCancel?.();
		}
		this.contentEl.empty();
	}

	private renderModal(): void {
		const c = this.contentEl;
		let refreshSyncNowButtonState: () => void = () => {};
		c.empty();
		c.createEl('h3', {
			cls: 'operon-external-calendar-edit-modal-title',
			text: t('settings', 'externalCalendarEditTitle'),
		});

		c.createEl('p', {
			cls: 'operon-external-calendar-preset-note',
			text: t('settings', 'externalCalendarPresetVisibilityNote'),
		});

		this.source.enabled = true;

		const sourceCard = this.createExternalCalendarSection(c, t('settings', 'externalCalendarSectionSource'));
		const nameSetting = new Setting(sourceCard)
			.setName(t('settings', 'externalCalendarName'))
			.setDesc(t('settings', 'externalCalendarNameDesc'))
			.addText(text => {
				text.inputEl.addClass('operon-external-calendar-name-input');
				text.setValue(this.source.name);
				text.onChange(value => { this.source.name = value; });
			});
		nameSetting.settingEl.addClass('operon-external-calendar-name-setting');

		const urlSetting = new Setting(sourceCard)
			.setName(t('settings', 'externalCalendarUrl'))
			.setDesc(t('settings', 'externalCalendarUrlDesc'))
			.addText(text => {
				text.inputEl.addClass('operon-external-calendar-url-input');
				text.setValue(this.source.url);
				text.setPlaceholder(t('settings', 'externalCalendarUrlPlaceholder'));
				text.onChange(value => {
					this.source.url = value;
					refreshSyncNowButtonState();
				});
			});
		urlSetting.settingEl.addClass('operon-external-calendar-url-setting');

		const displayCard = this.createExternalCalendarSection(c, t('settings', 'externalCalendarSectionDisplayBehavior'));
		const hideCreatedSetting = new Setting(displayCard)
			.setName(t('settings', 'externalCalendarHideCreatedEvents'))
			.setDesc(t('settings', 'externalCalendarHideCreatedEventsDesc'))
			.addToggle(toggle => {
				toggle.setValue(this.source.hideCreatedEvents);
				toggle.onChange(value => { this.source.hideCreatedEvents = value; });
			});
		hideCreatedSetting.settingEl.addClass('operon-external-calendar-hide-created-setting');

		const colorSetting = new Setting(displayCard)
			.setName(t('settings', 'externalCalendarColor'))
			.setDesc(t('settings', 'externalCalendarColorDesc'))
			.addText(text => {
				text.inputEl.type = 'color';
				text.setValue(this.source.color);
				text.onChange(value => {
					if (HEX_COLOR_REGEX.test(value)) this.source.color = value;
				});
			});
		colorSetting.settingEl.addClass('operon-external-calendar-color-setting');

		const syncCard = this.createExternalCalendarSection(c, t('settings', 'externalCalendarSectionSync'));
		const refreshSetting = new Setting(syncCard)
			.setName(t('settings', 'externalCalendarRefreshHours'))
			.setDesc(t('settings', 'externalCalendarRefreshHoursDesc'))
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = String(MIN_REFRESH_HOURS);
				text.inputEl.max = String(MAX_REFRESH_HOURS);
				text.setValue(String(this.source.refreshIntervalHours));
				text.onChange(value => {
					const parsed = Number.parseInt(value, 10);
					if (Number.isFinite(parsed)) {
						this.source.refreshIntervalHours = Math.min(MAX_REFRESH_HOURS, Math.max(MIN_REFRESH_HOURS, parsed));
					}
				});
			})
			.addExtraButton(button => {
				button.setIcon('refresh-cw');
				if (button.extraSettingsEl) {
					const label = t('settings', 'externalCalendarSyncNow');
					setAccessibleLabelWithoutTooltip(button.extraSettingsEl, label);
					bindOperonHoverTooltip(button.extraSettingsEl, {
						content: label,
						taskColor: null,
					});
				}
				const canSyncNow = (): boolean => canSyncExternalCalendarSourceNow({
					draftUrl: this.source.url,
					savedUrl: this.savedUrl,
					hasSyncHandler: !!this.opts.onSyncNow,
				});
				refreshSyncNowButtonState = () => {
					button.setDisabled(!canSyncNow());
				};
				refreshSyncNowButtonState();
				button.onClick(async () => {
					if (!canSyncNow() || !this.opts.onSyncNow) return;
					await this.opts.onSyncNow();
				});
			});
		refreshSetting.settingEl.addClass('operon-external-calendar-refresh-setting');

		this.renderFooter(c);
	}

	private createExternalCalendarSection(container: HTMLElement, title: string): HTMLElement {
		const section = container.createDiv('operon-external-calendar-section');
		section.createEl('h4', {
			cls: 'operon-external-calendar-section-title',
			text: title,
		});
		return section.createDiv('operon-external-calendar-settings-card');
	}

	private renderFooter(container: HTMLElement): void {
		const row = container.createDiv('operon-external-calendar-edit-modal-footer');

		const cancelBtn = row.createEl('button', { text: t('buttons', 'cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = row.createEl('button', { cls: 'mod-cta', text: t('buttons', 'save') });
		saveBtn.addEventListener('click', () => {
			void this.handleSaveClick();
		});
	}

	private async handleSaveClick(): Promise<void> {
		const url = this.source.url.trim();
		if (!url) {
			new Notice(t('settings', 'externalCalendarUrlRequired'));
			return;
		}
		this.source.url = url;
		this.source.name = this.source.name.trim();
		this.source.enabled = true;
		this.didSave = true;
		await this.opts.onSave(this.source);
		this.close();
	}
}
