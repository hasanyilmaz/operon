import { App, Modal, Setting } from 'obsidian';
import { t } from '../../core/i18n';
import { FilterSet } from '../../types/settings';
import { showFilterSetPicker } from '../filter-set-picker';
import { asyncHandler } from '../../core/async-action';

interface CalendarViewSettingsModalOptions {
	getFilterSets: () => FilterSet[];
	getCurrentFilterSetId: () => string | null;
	onChangeFilterSetId: (filterSetId: string | null) => Promise<void> | void;
}

export class CalendarViewSettingsModal extends Modal {
	private readonly options: CalendarViewSettingsModalOptions;

	constructor(app: App, options: CalendarViewSettingsModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-calendar-view-settings-modal');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('calendar', 'calendarViewSettingsTitle'));

		contentEl.createEl('p', {
			text: t('calendar', 'calendarViewSettingsHelp'),
			cls: 'operon-calendar-view-settings-help',
		});

		const filterSets = this.options.getFilterSets();
		const currentFilterSetId = this.options.getCurrentFilterSetId();
		const currentFilter = filterSets.find(entry => entry.id === currentFilterSetId) ?? null;

		new Setting(contentEl)
			.setName(t('calendar', 'currentFilter'))
			.setDesc(currentFilter?.name ?? t('calendar', 'noFilter'))
			.addButton(button => {
				button.setButtonText(t('calendar', 'chooseFilter'));
				button.setCta();
				button.onClick(() => {
					showFilterSetPicker(button.buttonEl, {
						value: currentFilterSetId,
						filterSets,
						onChooseFilter: asyncHandler('calendar view filter selection failed', async (filterSetId) => {
							await this.options.onChangeFilterSetId(filterSetId);
							this.close();
						}),
					});
				});
			})
			.addButton(button => {
				button.setButtonText(t('calendar', 'clearFilter'));
				button.setDisabled(currentFilterSetId === null);
				button.onClick(asyncHandler('calendar view filter clear failed', async () => {
					await this.options.onChangeFilterSetId(null);
					this.render();
				}));
			});
	}
}
