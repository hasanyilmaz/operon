import { scopeSettingsModal } from './settings/settings-scope';
import { App, Modal, Notice, Setting } from 'obsidian';
import { t } from '../core/i18n';
import {
	RepeatSeriesPropertyRemovalPickerModal,
	type RepeatSeriesPropertyRemovalPickerOption,
} from './repeat-series-property-removal-picker-modal';

export interface RepeatSeriesPropertyCleanupModalSavePayload {
	seriesId: string;
	rawValue: string;
}

export interface RepeatSeriesPropertyCleanupModalOptions {
	app: App;
	isNew: boolean;
	title: string;
	seriesId: string | null;
	seriesTitle: string;
	seriesPath: string | null;
	rawValue: string;
	seriesOptions: RepeatSeriesPropertyRemovalPickerOption[];
	onSave: (payload: RepeatSeriesPropertyCleanupModalSavePayload) => void | Promise<void>;
}

export class RepeatSeriesPropertyCleanupModal extends Modal {
	private selectedSeriesId: string | null;
	private selectedSeriesTitle: string;
	private selectedSeriesPath: string | null;
	private rawValue: string;
	private readonly opts: RepeatSeriesPropertyCleanupModalOptions;
	private seriesSetting: Setting | null = null;

	constructor(opts: RepeatSeriesPropertyCleanupModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.selectedSeriesId = opts.seriesId;
		this.selectedSeriesTitle = opts.seriesTitle;
		this.selectedSeriesPath = opts.seriesPath;
		this.rawValue = opts.rawValue;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-repeat-property-cleanup-modal-shell');
		this.contentEl.addClass('operon-repeat-property-cleanup-modal');
		this.renderModal();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderModal(): void {
		const c = this.contentEl;
		c.empty();
		c.createEl('h3', {
			cls: 'operon-repeat-property-cleanup-modal-title',
			text: this.opts.title,
		});
		c.createEl('p', {
			cls: 'operon-repeat-property-cleanup-modal-desc',
			text: t('settings', 'repeatYamlPropertyRemovalDesc'),
		});

		this.seriesSetting = new Setting(c)
			.setName(t('settings', 'repeatYamlPropertyRemovalSeries'))
			.addButton(button => {
				button.setButtonText(t('settings', 'repeatYamlPropertyRemovalChoose'));
				button.onClick(() => this.openSeriesPicker());
			});
		this.seriesSetting.settingEl.addClass('operon-repeat-property-cleanup-series-setting');
		this.refreshSeriesSetting();

		new Setting(c)
			.setName(t('settings', 'repeatYamlPropertyRemovalProperties'))
			.setDesc(t('settings', 'repeatYamlPropertyRemovalPropertiesDesc'))
			.addText(text => {
				text.inputEl.addClass('operon-repeat-property-cleanup-input');
				text.setPlaceholder(t('settings', 'repeatYamlPropertyRemovalInputPlaceholder'));
				text.setValue(this.rawValue);
				text.onChange(value => { this.rawValue = value; });
			})
			.settingEl.addClass('operon-repeat-property-cleanup-properties-setting');

		this.renderFooter(c);
	}

	private refreshSeriesSetting(): void {
		if (!this.seriesSetting) return;
		this.seriesSetting.setDesc(this.buildSeriesDescription());
	}

	private buildSeriesDescription(): string {
		if (!this.selectedSeriesId) {
			return t('settings', 'repeatYamlPropertyRemovalChooseSeries');
		}
		const title = this.selectedSeriesTitle.trim() || this.selectedSeriesId;
		if (!this.selectedSeriesPath) {
			return `${title} · ${t('settings', 'repeatYamlPropertyRemovalMissingSeries')}`;
		}
		return `${title} · ${this.selectedSeriesPath}`;
	}

	private openSeriesPicker(): void {
		if (!this.opts.seriesOptions.length) {
			new Notice(t('settings', 'repeatYamlPropertyRemovalNoSeries'));
			return;
		}
		scopeSettingsModal(new RepeatSeriesPropertyRemovalPickerModal(
			this.app,
			this.opts.seriesOptions,
			selection => {
				this.selectedSeriesId = selection.seriesId;
				this.selectedSeriesTitle = selection.title;
				this.selectedSeriesPath = selection.path;
				this.refreshSeriesSetting();
			},
		), this.modalEl).open();
	}

	private renderFooter(container: HTMLElement): void {
		const row = container.createDiv('operon-repeat-property-cleanup-modal-footer');

		const cancelBtn = row.createEl('button', { text: t('buttons', 'cancel') });
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = row.createEl('button', { cls: 'mod-cta', text: t('buttons', 'save') });
		saveBtn.addEventListener('click', () => {
			void this.handleSaveClick();
		});
	}

	private async handleSaveClick(): Promise<void> {
		if (!this.selectedSeriesId) {
			new Notice(t('settings', 'repeatYamlPropertyRemovalChooseSeries'));
			return;
		}
		await this.opts.onSave({
			seriesId: this.selectedSeriesId,
			rawValue: this.rawValue,
		});
		this.close();
	}
}
