import { App, Modal, Notice, Setting } from 'obsidian';
import { t } from '../../core/i18n';
import { CalendarAppearanceMode, CalendarPreset } from '../../types/calendar';
import { APPEARANCE_SCHEME_LIGHT_OPTIONS, APPEARANCE_SCHEME_DARK_OPTIONS, addAppearanceSchemeOptions } from '../appearance-schemes';
import type { FilterSet, OperonSettings } from '../../types/settings';
import { showTimePicker } from '../field-pickers/time-picker';
import {
	CALENDAR_TASK_COLOR_SOURCES,
	normalizeTaskColorSource,
} from '../../core/task-color-source';
import { getNormalFilterSets } from '../../core/dynamic-file-task-filter';
import { runSettingsAsync, settingsAsyncHandler } from '../settings/async-settings-action';
import { parsePresetNumber } from '../settings/preset-control-helpers';
import { renderTaskColorSourceSelectButton, showTaskColorSourceSelectMenu } from '../task-color-source-select';
import { renderPresetFilterActions } from '../preset-filter-actions';
import type { FilterModalEvalDeps } from '../filter-set-modal';

interface CalendarPresetQuickSettingsModalOptions {
	getSettings: () => OperonSettings;
	preset: CalendarPreset | null;
	onSave: (preset: CalendarPreset) => Promise<void>;
	onSaveFilterSet: (filterSet: FilterSet) => Promise<void>;
	getFilterModalEvalDeps?: () => FilterModalEvalDeps | null;
}

export class CalendarPresetQuickSettingsModal extends Modal {
	private readonly options: CalendarPresetQuickSettingsModalOptions;
	private readonly draftPreset: CalendarPreset | null;

	constructor(app: App, options: CalendarPresetQuickSettingsModalOptions) {
		super(app);
		this.options = options;
		this.draftPreset = options.preset ? cloneCalendarPreset(options.preset) : null;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-calendar-preset-quick-settings-modal');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const preset = this.getPreset();
		contentEl.empty();
		this.titleEl.setText(preset
			? t('calendar', 'calendarPresetTitle', { name: this.getPresetDisplayName(preset) })
			: t('calendar', 'calendarPresetSettingsTitle'));

		if (!preset) {
			contentEl.createEl('p', { text: t('calendar', 'activeCalendarPresetMissing') });
			return;
		}

		contentEl.createEl('p', {
			text: t('calendar', 'calendarPresetQuickHelp'),
			cls: 'operon-calendar-preset-quick-settings-help',
		});

		const presetCard = this.createPresetSection(contentEl, t('calendar', 'calendarPresetSectionPreset'));

		const nameSetting = new Setting(presetCard)
			.setName(t('calendar', 'presetName'))
			.setDesc(t('calendar', 'presetNameDesc'))
			.addText(text => {
				text.setValue(preset.name);
				text.inputEl.addClass('operon-calendar-preset-name-input');
				text.inputEl.addEventListener('input', () => {
					const rawValue = text.inputEl.value;
					void this.updatePreset(current => {
						current.name = rawValue;
					});
					this.titleEl.setText(t('calendar', 'calendarPresetTitle', {
						name: rawValue.trim() || t('calendar', 'defaultPresetName'),
					}));
				});
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					text.inputEl.blur();
				});
		});
		nameSetting.settingEl.addClass('operon-calendar-preset-name-setting');

		new Setting(presetCard)
			.setName(t('calendar', 'calendarPresetType'))
			.setDesc(t('calendar', 'calendarPresetTypeDesc'))
			.addDropdown(dropdown => {
				dropdown.addOption('timeGrid', t('calendar', 'timeGrid'));
				dropdown.addOption('timeTrackerGrid', t('calendar', 'timeTrackerGrid'));
				dropdown.addOption('multiWeek', t('calendar', 'multiWeek'));
				dropdown.setValue(preset.surfaceType);
				dropdown.onChange(async value => {
					if (value !== 'timeGrid' && value !== 'timeTrackerGrid' && value !== 'multiWeek') return;
					await this.updatePreset(current => {
						current.surfaceType = value;
						current.weekCount = this.normalizeWeekCount(current.weekCount);
					});
					this.render();
				});
			});

		const rangeCard = this.createPresetSection(contentEl, t('calendar', 'calendarPresetSectionRangeLayout'));

		if (preset.surfaceType === 'multiWeek') {
			new Setting(rangeCard)
				.setName(t('calendar', 'weekCount'))
				.setDesc(t('calendar', 'weekCountDesc'))
				.addDropdown(dropdown => {
					dropdown.addOption('1', '1');
					dropdown.addOption('2', '2');
					dropdown.addOption('3', '3');
					dropdown.addOption('4', '4');
					dropdown.addOption('5', '5');
					dropdown.addOption('6', '6');
					dropdown.setValue(String(this.normalizeWeekCount(preset.weekCount)));
					dropdown.onChange(async value => {
						const nextValue = this.normalizeWeekCount(Number.parseInt(value, 10));
						await this.updatePreset(current => {
							current.weekCount = nextValue;
						});
						this.render();
					});
				});
			new Setting(rangeCard)
				.setName(t('calendar', 'focusedWeekNumber'))
				.setDesc(t('calendar', 'focusedWeekNumberDesc'))
				.addDropdown(dropdown => {
					const weekCount = this.normalizeWeekCount(preset.weekCount);
					for (let week = 1; week <= weekCount; week++) {
						dropdown.addOption(String(week), String(week));
					}
					dropdown.setValue(String(this.normalizeFocusedWeekNumber(preset.focusedWeekNumber, weekCount)));
					dropdown.onChange(async value => {
						const nextValue = this.normalizeFocusedWeekNumber(
							Number.parseInt(value, 10),
							this.normalizeWeekCount(preset.weekCount),
						);
						await this.updatePreset(current => {
							current.focusedWeekNumber = nextValue;
						});
						this.render();
					});
				});
		} else {
			this.addNumberSetting(rangeCard, t('calendar', 'visibleDayCount'), t('calendar', 'visibleDayCountDesc'), preset.dayCount, 1, 31, 1, async value => {
				await this.updatePreset(current => {
					current.dayCount = value;
				});
				this.render();
			});

			new Setting(rangeCard)
				.setName(t('calendar', 'todayPosition'))
				.setDesc(t('calendar', 'todayPositionDesc'))
				.addDropdown(dropdown => {
					for (let position = 1; position <= Math.max(1, preset.dayCount); position++) {
						dropdown.addOption(String(position), String(position));
					}
					dropdown.setValue(String(Math.min(preset.dayCount, preset.todayPosition)));
					dropdown.onChange(async value => {
						const nextValue = parsePresetNumber(value, preset.todayPosition, 1, Math.max(1, preset.dayCount), 1);
						await this.updatePreset(current => {
							current.todayPosition = Math.min(current.dayCount, nextValue);
						});
						this.render();
					});
				});

			new Setting(rangeCard)
				.setName(t('calendar', 'slotMinutes'))
				.setDesc(t('calendar', 'slotMinutesDesc'))
				.addDropdown(dropdown => {
					dropdown.addOption('15', '15');
					dropdown.addOption('30', '30');
					dropdown.addOption('60', '60');
					const currentValue = ['15', '30', '60'].includes(String(preset.slotMinutes))
						? String(preset.slotMinutes)
						: '30';
					dropdown.setValue(currentValue);
					dropdown.onChange(async value => {
						const nextValue = parsePresetNumber(value, preset.slotMinutes, 15, 60, 1);
						await this.updatePreset(current => {
							current.slotMinutes = nextValue <= 15 ? 15 : nextValue >= 60 ? 60 : 30;
						});
					});
				});
		}

		const settings = this.options.getSettings();
		const filterSets = getNormalFilterSets(settings.filterSets);
		const currentFilter = filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		const filterCard = this.createPresetSection(contentEl, t('calendar', 'calendarPresetSectionFiltering'));
		renderPresetFilterActions({
			app: this.app,
			setting: new Setting(filterCard)
				.setName(t('calendar', 'calendarFilter')),
			getSettings: this.options.getSettings,
			filterSets,
			currentFilter,
			selectedFilterSetId: preset.filterSetId,
			onSelectFilter: async (filterSetId) => {
				await this.updatePreset(current => {
					current.filterSetId = filterSetId;
				});
			},
			onSaveFilterSet: this.options.onSaveFilterSet,
			getFilterModalEvalDeps: this.options.getFilterModalEvalDeps,
			onRefresh: () => this.render(),
			errorContextPrefix: 'calendar preset',
		});

		if (preset.surfaceType === 'timeGrid' || preset.surfaceType === 'timeTrackerGrid') {
			new Setting(rangeCard)
				.setName(t('calendar', 'hiddenTime'))
				.setDesc(t('calendar', 'hiddenTimeDesc'))
				.addButton(button => {
					button.setButtonText(t('calendar', 'hiddenTimeStart', { time: preset.hiddenTimeStart }));
					button.onClick(() => {
						showTimePicker(button.buttonEl, {
							app: this.app,
							settings: this.options.getSettings(),
							value: preset.hiddenTimeStart,
							onSelect: settingsAsyncHandler('calendar preset hidden time start change failed', async (value) => {
								await this.updatePreset(current => {
									current.hiddenTimeStart = value;
								});
								this.render();
							}),
						});
					});
				})
				.addButton(button => {
					button.setButtonText(t('calendar', 'hiddenTimeEnd', { time: preset.hiddenTimeEnd }));
					button.onClick(() => {
						showTimePicker(button.buttonEl, {
							app: this.app,
							settings: this.options.getSettings(),
							value: preset.hiddenTimeEnd,
							onSelect: settingsAsyncHandler('calendar preset hidden time end change failed', async (value) => {
								await this.updatePreset(current => {
									current.hiddenTimeEnd = value;
								});
								this.render();
							}),
						});
					});
				});
		}

		const appearanceCard = this.createPresetSection(contentEl, t('calendar', 'calendarPresetSectionAppearance'));
		new Setting(appearanceCard)
			.setName(t('calendar', 'taskColorSource'))
			.setDesc(t('calendar', 'taskColorSourceDesc'))
			.addButton(button => {
				const currentSource = normalizeTaskColorSource(preset.colorSource, CALENDAR_TASK_COLOR_SOURCES, 'taskColor');
				renderTaskColorSourceSelectButton(button.buttonEl, currentSource);
				button.onClick(event => {
					event.preventDefault();
					showTaskColorSourceSelectMenu(button.buttonEl, {
						sources: CALENDAR_TASK_COLOR_SOURCES,
						currentSource,
						onSelect: settingsAsyncHandler('calendar preset task color source selection failed', async (source) => {
							await this.updatePreset(current => {
								current.colorSource = source;
							});
							this.render();
						}),
					});
				});
			});

		new Setting(appearanceCard)
			.setName(t('calendar', 'appearanceLight'))
			.setDesc(t('calendar', 'appearanceLightDesc'))
			.addDropdown(dropdown => {
				addAppearanceSchemeOptions(dropdown, APPEARANCE_SCHEME_LIGHT_OPTIONS);
				dropdown.setValue(preset.appearanceModeLight);
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.appearanceModeLight = value as CalendarAppearanceMode;
					});
				});
			});

		new Setting(appearanceCard)
			.setName(t('calendar', 'appearanceDark'))
			.setDesc(t('calendar', 'appearanceDarkDesc'))
			.addDropdown(dropdown => {
				addAppearanceSchemeOptions(dropdown, APPEARANCE_SCHEME_DARK_OPTIONS);
				dropdown.setValue(preset.appearanceModeDark);
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.appearanceModeDark = value as CalendarAppearanceMode;
					});
				});
			});

		const visibilityCard = this.createPresetSection(contentEl, t('calendar', 'calendarPresetSectionVisibility'));
		new Setting(visibilityCard)
			.setName(t('calendar', 'showWeekends'))
			.setDesc(t('calendar', 'showWeekendsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.showWeekends);
				toggle.onChange(async value => {
					await this.updatePreset(current => {
						current.showWeekends = value;
					});
				});
			});

		new Setting(visibilityCard)
			.setName(t('calendar', 'showFutureOccurrences'))
			.setDesc(t('calendar', 'showFutureOccurrencesDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.showProjectedOccurrences);
				toggle.onChange(async value => {
					await this.updatePreset(current => {
						current.showProjectedOccurrences = value;
					});
				});
			});

		new Setting(visibilityCard)
			.setName(t('calendar', 'showExternalCalendars'))
			.setDesc(t('calendar', 'showExternalCalendarsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.showExternalCalendars);
				toggle.onChange(async value => {
					await this.updatePreset(current => {
						current.showExternalCalendars = value;
					});
				});
			});

		const externalCalendars = this.options.getSettings().externalCalendars;
		if (externalCalendars.length > 0) {
			const externalCard = this.createPresetSection(
				contentEl,
				t('calendar', 'externalCalendarsSection'),
				'operon-calendar-preset-external-card',
			);
			for (const source of externalCalendars) {
				const isVisible = preset.externalCalendarVisibility[source.id] === true;
				new Setting(externalCard)
					.setName(source.name || source.url)
					.addToggle(toggle => {
						toggle.setValue(isVisible);
						toggle.onChange(async value => {
							await this.updatePreset(current => {
								current.externalCalendarVisibility[source.id] = value;
							});
						});
					});
			}
		}

		this.renderButtons(contentEl);
	}

	private createPresetSection(
		container: HTMLElement,
		title: string,
		cardClass = 'operon-calendar-preset-settings-card',
	): HTMLElement {
		const section = container.createDiv('operon-calendar-preset-settings-section');
		section.createEl('h4', {
			cls: 'operon-calendar-preset-settings-section-title',
			text: title,
		});
		return section.createDiv(cardClass);
	}

	private renderButtons(container: HTMLElement): void {
		const row = container.createDiv('operon-calendar-preset-settings-footer');

		const cancelBtn = row.createEl('button', {
			cls: 'operon-calendar-preset-settings-footer-button',
			text: t('buttons', 'cancel'),
		});
		cancelBtn.type = 'button';
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = row.createEl('button', {
			cls: 'operon-calendar-preset-settings-footer-button mod-cta',
			text: t('buttons', 'save'),
		});
		saveBtn.type = 'button';
		saveBtn.addEventListener('click', settingsAsyncHandler('calendar preset save failed', async () => {
			const preset = this.getPreset();
			if (!preset) return;
			const name = preset.name.trim();
			if (!name) {
				new Notice(t('calendar', 'presetNameRequired'));
				return;
			}
			preset.name = name;
			await this.options.onSave(cloneCalendarPreset(preset));
			this.close();
		}));
	}

	private addNumberSetting(
		container: HTMLElement,
		name: string,
		description: string,
		currentValue: number,
		min: number,
		max: number,
		step: number,
		onChange: (value: number) => Promise<void>,
	): void {
		new Setting(container)
			.setName(name)
			.setDesc(description)
			.addText(text => {
				text.inputEl.type = 'number';
				text.inputEl.min = String(min);
				text.inputEl.max = String(max);
				text.setValue(String(currentValue));
				let lastCommittedValue = currentValue;
				const commit = async (): Promise<void> => {
					const nextValue = parsePresetNumber(text.inputEl.value, lastCommittedValue, min, max, step);
					if (text.inputEl.value !== String(nextValue)) {
						text.setValue(String(nextValue));
					}
					if (nextValue === lastCommittedValue) return;
					await onChange(nextValue);
					lastCommittedValue = nextValue;
				};
				text.inputEl.addEventListener('blur', () => {
					runSettingsAsync('calendar preset number commit failed', commit);
				});
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					runSettingsAsync('calendar preset number commit failed', async () => {
						await commit();
						text.inputEl.blur();
					});
				});
			});
	}

	private getPreset(): CalendarPreset | null {
		return this.draftPreset;
	}

	private getPresetDisplayName(preset: CalendarPreset): string {
		return preset.name.trim() || t('calendar', 'defaultPresetName');
	}

	private normalizeWeekCount(value: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
		if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
		return Math.max(1, Math.min(6, Math.round(value))) as 1 | 2 | 3 | 4 | 5 | 6;
	}

	private normalizeFocusedWeekNumber(
		value: number | undefined,
		weekCount: 1 | 2 | 3 | 4 | 5 | 6,
	): 1 | 2 | 3 | 4 | 5 | 6 {
		if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
		return Math.max(1, Math.min(weekCount, Math.round(value))) as 1 | 2 | 3 | 4 | 5 | 6;
	}

	private async updatePreset(update: (preset: CalendarPreset) => void): Promise<void> {
		const preset = this.getPreset();
		if (!preset) return;
		update(preset);
		preset.surfaceType = preset.surfaceType === 'multiWeek' || preset.surfaceType === 'timeTrackerGrid'
			? preset.surfaceType
			: 'timeGrid';
		preset.weekCount = this.normalizeWeekCount(preset.weekCount);
		preset.focusedWeekNumber = this.normalizeFocusedWeekNumber(preset.focusedWeekNumber, preset.weekCount);
		preset.todayPosition = Math.max(1, Math.min(preset.dayCount, preset.todayPosition));
	}
}

function cloneCalendarPreset(preset: CalendarPreset): CalendarPreset {
	return {
		...preset,
		externalCalendarVisibility: { ...preset.externalCalendarVisibility },
	};
}
