import { App, DropdownComponent, Modal, Notice, Setting } from 'obsidian';
import { APPEARANCE_SCHEME_LIGHT_OPTIONS, APPEARANCE_SCHEME_DARK_OPTIONS, addAppearanceSchemeOptions } from '../appearance-schemes';
import {
	KANBAN_SORT_FIELD_OPTIONS,
	KanbanAppearanceMode,
	KanbanPreset,
	KanbanSortDirection,
	KanbanSortEmptyPlacement,
	KanbanSortMode,
	KanbanSortRule,
	KanbanSwimlaneBy,
} from '../../types/kanban';
import { OperonSettings } from '../../types/settings';
import { CalendarFilterPickerModal } from '../calendar/calendar-filter-picker-modal';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import {
	KANBAN_TASK_COLOR_SOURCES,
	addTaskColorSourceOptions,
	normalizeTaskColorSource,
} from '../../core/task-color-source';
import { getNormalFilterSets } from '../../core/dynamic-file-task-filter';
import { t } from '../../core/i18n';
import { runSettingsAsync, settingsAsyncHandler } from '../settings/async-settings-action';
import { parsePresetNumber } from '../settings/preset-control-helpers';

interface KanbanPresetQuickSettingsModalOptions {
	getSettings: () => OperonSettings;
	preset: KanbanPreset | null;
	onSave: (preset: KanbanPreset) => Promise<void>;
}

export class KanbanPresetQuickSettingsModal extends Modal {
	private readonly options: KanbanPresetQuickSettingsModalOptions;
	private readonly draftPreset: KanbanPreset | null;

	constructor(app: App, options: KanbanPresetQuickSettingsModalOptions) {
		super(app);
		this.options = options;
		this.draftPreset = options.preset ? cloneKanbanPreset(options.preset) : null;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-kanban-preset-quick-settings-modal');
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		const preset = this.getPreset();
		contentEl.empty();
		this.titleEl.setText(preset
			? t('settings', 'kanbanPresetSettingsTitleForName', { name: this.getPresetDisplayName(preset) })
			: t('settings', 'kanbanPresetSettingsTitle'));

		if (!preset) {
			contentEl.createEl('p', { text: t('settings', 'activeKanbanPresetMissing') });
			return;
		}

		const presetCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionPreset'));
		const nameSetting = new Setting(presetCard)
			.setName(t('settings', 'kanbanPresetName'))
			.setDesc(t('settings', 'kanbanQuickPresetNameDesc'))
			.addText(text => {
				text.setValue(preset.name);
				text.inputEl.addClass('operon-kanban-preset-name-input');
				text.inputEl.addEventListener('input', () => {
					const rawValue = text.inputEl.value;
					void this.updatePreset(current => {
						current.name = rawValue;
					});
					this.titleEl.setText(t('settings', 'kanbanPresetSettingsTitleForName', {
						name: rawValue.trim() || t('settings', 'kanbanFallbackPresetName', { number: '1' }),
					}));
				});
				text.inputEl.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					text.inputEl.blur();
				});
			});
		nameSetting.settingEl.addClass('operon-kanban-preset-name-setting');

		const settings = this.options.getSettings();
		new Setting(presetCard)
			.setName(t('settings', 'kanbanPipeline'))
			.setDesc(t('settings', 'kanbanPipelineDesc'))
			.addDropdown(dropdown => {
				dropdown.addOption('', t('settings', 'kanbanNoPipeline'));
				for (const pipeline of settings.pipelines) {
					dropdown.addOption(pipeline.id, pipeline.name);
				}
				dropdown.setValue(preset.pipelineId ?? '');
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.pipelineId = value || null;
					});
				});
			});

		const filterSets = getNormalFilterSets(settings.filterSets);
		const currentFilter = filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		const filteringCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionFilteringLanes'));
		new Setting(filteringCard)
			.setName(t('settings', 'kanbanFilter'))
			.setDesc(currentFilter?.name ?? t('calendar', 'noFilter'))
			.addButton(button => {
				button.setButtonText(t('calendar', 'chooseFilter'));
				button.onClick(() => {
					new CalendarFilterPickerModal(this.app, {
						filterSets,
						onChooseFilter: settingsAsyncHandler('kanban preset filter selection failed', async (filterSetId) => {
							await this.updatePreset(current => {
								current.filterSetId = filterSetId;
							});
							this.render();
						}),
					}).open();
				});
			})
			.addButton(button => {
				button.setButtonText(t('calendar', 'clearFilter'));
				button.setDisabled(!preset.filterSetId);
				button.onClick(settingsAsyncHandler('kanban preset filter clear failed', async () => {
					await this.updatePreset(current => {
						current.filterSetId = null;
					});
					this.render();
				}));
			});

		new Setting(filteringCard)
			.setName(t('settings', 'kanbanSwimlaneField'))
			.setDesc(t('settings', 'kanbanSwimlaneFieldDesc'))
			.addDropdown(dropdown => {
				this.addSwimlaneOptions(dropdown);
				dropdown.setValue(preset.swimlaneBy ?? '');
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.swimlaneBy = this.parseSwimlaneBy(value);
					});
				});
			});

		const sortingCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionSorting'));
		this.renderSortSection(sortingCard, preset);

		const appearanceCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionAppearance'));
		new Setting(appearanceCard)
			.setName(t('settings', 'kanbanTaskColorSource'))
			.setDesc(t('settings', 'kanbanTaskColorSourceDesc'))
			.addDropdown(dropdown => {
				addTaskColorSourceOptions(dropdown, KANBAN_TASK_COLOR_SOURCES);
				dropdown.setValue(preset.colorSource);
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.colorSource = normalizeTaskColorSource(value, KANBAN_TASK_COLOR_SOURCES, 'taskColor');
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
						current.appearanceModeLight = value as KanbanAppearanceMode;
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
						current.appearanceModeDark = value as KanbanAppearanceMode;
					});
				});
			});

		const visibilityCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionVisibility'));
		new Setting(visibilityCard)
			.setName(t('settings', 'kanbanCollapseEmptyColumns'))
			.setDesc(t('settings', 'kanbanCollapseEmptyColumnsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.collapseEmptyColumns);
				toggle.onChange(async value => {
					await this.updatePreset(current => {
						current.collapseEmptyColumns = value;
					});
				});
			});

		new Setting(visibilityCard)
			.setName(t('settings', 'kanbanCollapseEmptySwimlanes'))
			.setDesc(t('settings', 'kanbanCollapseEmptySwimlanesDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.collapseEmptySwimlanes);
				toggle.onChange(async value => {
					await this.updatePreset(current => {
						current.collapseEmptySwimlanes = value;
					});
				});
			});

		new Setting(visibilityCard)
			.setName(t('settings', 'kanbanAutoCollapseFinishedColumns'))
			.setDesc(t('settings', 'kanbanAutoCollapseFinishedColumnsDesc'))
			.addToggle(toggle => {
				toggle.setValue(preset.autoCollapseFinishedColumns);
				toggle.onChange(async value => {
					await this.updatePreset(current => {
						current.autoCollapseFinishedColumns = value;
					});
				});
			});

		this.renderButtons(contentEl);
	}

	private createPresetSection(container: HTMLElement, title: string): HTMLElement {
		const section = container.createDiv('operon-kanban-preset-settings-section');
		section.createEl('h4', {
			cls: 'operon-kanban-preset-settings-section-title',
			text: title,
		});
		return section.createDiv('operon-kanban-preset-settings-card');
	}

	private renderButtons(container: HTMLElement): void {
		const row = container.createDiv('operon-kanban-preset-settings-footer');

		const cancelBtn = row.createEl('button', {
			cls: 'operon-kanban-preset-settings-footer-button',
			text: t('buttons', 'cancel'),
		});
		cancelBtn.type = 'button';
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = row.createEl('button', {
			cls: 'operon-kanban-preset-settings-footer-button mod-cta',
			text: t('buttons', 'save'),
		});
		saveBtn.type = 'button';
		saveBtn.addEventListener('click', settingsAsyncHandler('kanban preset save failed', async () => {
			const preset = this.getPreset();
			if (!preset) return;
			const name = preset.name.trim();
			if (!name) {
				new Notice(t('settings', 'kanbanPresetNameRequired'));
				return;
			}
			preset.name = name;
			await this.options.onSave(cloneKanbanPreset(preset));
			this.close();
		}));
	}

	private renderSortSection(container: HTMLElement, preset: KanbanPreset): void {
		container.createDiv({
			text: t('settings', 'kanbanSortingDesc'),
			cls: 'operon-kanban-preset-section-desc',
		});
		this.renderSortModeControl(container, preset);
		if (preset.sortMode === 'manual') {
			this.renderManualSortMessage(container);
			return;
		}

		const section = container.createDiv('operon-kanban-sort-rules');

		preset.sortRules.forEach((rule, index) => {
			const row = section.createDiv('operon-kanban-sort-row');

			row.createSpan({ cls: 'operon-kanban-sort-label', text: t('settings', 'kanbanSortBy') });

			const fieldSelect = row.createEl('select', { cls: 'operon-kanban-sort-select' });
			for (const option of KANBAN_SORT_FIELD_OPTIONS) {
				fieldSelect.add(new Option(this.getKanbanSortFieldLabel(option), option.value));
			}
			fieldSelect.value = rule.field;
			fieldSelect.addEventListener('change', settingsAsyncHandler('kanban preset sort field change failed', async () => {
				await this.updatePreset(current => {
					current.sortRules[index].field = fieldSelect.value as KanbanSortRule['field'];
				});
			}));

			const directionButton = row.createEl('button', { cls: 'operon-kanban-sort-toggle', text: this.formatSortDirection(rule.direction) });
			directionButton.addEventListener('click', settingsAsyncHandler('kanban preset sort direction change failed', async () => {
				await this.updatePreset(current => {
					current.sortRules[index].direction = current.sortRules[index].direction === 'asc' ? 'desc' : 'asc';
				});
				this.render();
			}));

			const emptyButton = row.createEl('button', { cls: 'operon-kanban-sort-toggle', text: this.formatSortEmpty(rule.empty) });
			bindOperonHoverTooltip(emptyButton, { content: t('settings', 'kanbanSortEmptyTooltip'), taskColor: null });
			emptyButton.addEventListener('click', settingsAsyncHandler('kanban preset sort empty placement change failed', async () => {
				await this.updatePreset(current => {
					current.sortRules[index].empty = current.sortRules[index].empty === 'last' ? 'first' : 'last';
				});
				this.render();
			}));

			const upButton = row.createEl('button', { cls: 'operon-kanban-sort-icon-button', text: '↑' });
			upButton.disabled = index === 0;
			upButton.addEventListener('click', settingsAsyncHandler('kanban preset sort move up failed', async () => {
				if (index === 0) return;
				await this.updatePreset(current => {
					const [moved] = current.sortRules.splice(index, 1);
					current.sortRules.splice(index - 1, 0, moved);
				});
				this.render();
			}));

			const downButton = row.createEl('button', { cls: 'operon-kanban-sort-icon-button', text: '↓' });
			downButton.disabled = index >= preset.sortRules.length - 1;
			downButton.addEventListener('click', settingsAsyncHandler('kanban preset sort move down failed', async () => {
				if (index >= preset.sortRules.length - 1) return;
				await this.updatePreset(current => {
					const [moved] = current.sortRules.splice(index, 1);
					current.sortRules.splice(index + 1, 0, moved);
				});
				this.render();
			}));

			const removeButton = row.createEl('button', { cls: 'operon-kanban-sort-icon-button', text: '✕' });
			removeButton.disabled = preset.sortRules.length <= 1;
			removeButton.addEventListener('click', settingsAsyncHandler('kanban preset sort remove failed', async () => {
				if (preset.sortRules.length <= 1) return;
				await this.updatePreset(current => {
					current.sortRules.splice(index, 1);
				});
				this.render();
			}));
		});

		const addRow = section.createDiv('operon-kanban-sort-add-row');
		const addButton = addRow.createEl('button', { text: t('settings', 'kanbanAddSortField') });
		addButton.addEventListener('click', settingsAsyncHandler('kanban preset sort add failed', async () => {
			await this.updatePreset(current => {
				current.sortRules.push({
					field: 'alphabetical',
					direction: 'asc',
					empty: 'last',
				});
			});
			this.render();
		}));
	}

	private renderSortModeControl(container: HTMLElement, preset: KanbanPreset): void {
		const row = container.createDiv('operon-kanban-sort-mode-row');
		row.createSpan({ text: t('settings', 'kanbanSortMode'), cls: 'operon-kanban-sort-label' });
		const controls = row.createDiv('operon-kanban-sort-mode-control');
		this.renderSortModeButton(controls, preset, 'automatic');
		this.renderSortModeButton(controls, preset, 'manual');
	}

	private renderSortModeButton(container: HTMLElement, preset: KanbanPreset, sortMode: KanbanSortMode): void {
		const button = container.createEl('button', {
			text: t('settings', sortMode === 'manual' ? 'kanbanSortModeManual' : 'kanbanSortModeAutomatic'),
			cls: 'operon-kanban-sort-mode-button',
			attr: {
				type: 'button',
				'aria-pressed': preset.sortMode === sortMode ? 'true' : 'false',
			},
		});
		button.classList.toggle('is-active', preset.sortMode === sortMode);
		button.addEventListener('click', settingsAsyncHandler('kanban preset sort mode change failed', async () => {
			if (preset.sortMode === sortMode) return;
			await this.updatePreset(current => {
				current.sortMode = sortMode;
			});
			this.render();
		}));
	}

	private renderManualSortMessage(container: HTMLElement): void {
		const message = container.createDiv('operon-kanban-manual-sort-message');
		message.createDiv({ text: t('settings', 'kanbanManualOrderingActive') });
		message.createDiv({ text: t('settings', 'kanbanManualOrderingDesc') });
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
					runSettingsAsync('kanban preset number commit failed', commit);
				});
				text.inputEl.addEventListener('keydown', event => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					runSettingsAsync('kanban preset number commit failed', async () => {
						await commit();
						text.inputEl.blur();
					});
				});
			});
	}

	private addSwimlaneOptions(dropdown: DropdownComponent): void {
		dropdown.addOption('', t('settings', 'kanbanNoSwimlane'));
		dropdown.addOption('priority', this.getSwimlaneLabel('priority'));
		dropdown.addOption('tags', this.getSwimlaneLabel('tags'));
		dropdown.addOption('contexts', this.getSwimlaneLabel('contexts'));
		dropdown.addOption('assignees', this.getSwimlaneLabel('assignees'));
		dropdown.addOption('dateDue', this.getSwimlaneLabel('dateDue'));
		dropdown.addOption('dateScheduled', this.getSwimlaneLabel('dateScheduled'));
	}

	private getSwimlaneLabel(value: KanbanSwimlaneBy): string {
		return t('settings', `kanbanSwimlane_${value}`);
	}

	private getKanbanSortFieldLabel(option: typeof KANBAN_SORT_FIELD_OPTIONS[number]): string {
		const key = `kanbanSortField_${option.value}`;
		const localized = t('settings', key);
		return localized === key ? option.label : localized;
	}

	private parseSwimlaneBy(value: string): KanbanSwimlaneBy | null {
		return value === 'priority'
			|| value === 'tags'
			|| value === 'contexts'
			|| value === 'assignees'
			|| value === 'dateDue'
			|| value === 'dateScheduled'
			? value
			: null;
	}

	private formatSortDirection(direction: KanbanSortDirection): string {
		return direction === 'desc' ? t('settings', 'kanbanSortDesc') : t('settings', 'kanbanSortAsc');
	}

	private formatSortEmpty(empty: KanbanSortEmptyPlacement): string {
		return empty === 'first' ? t('settings', 'kanbanSortEmptyFirst') : t('settings', 'kanbanSortEmptyLast');
	}

	private getPreset(): KanbanPreset | null {
		return this.draftPreset;
	}

	private getPresetDisplayName(preset: KanbanPreset): string {
		return preset.name.trim() || t('settings', 'kanbanFallbackPresetName', { number: '1' });
	}

	private async updatePreset(update: (preset: KanbanPreset) => void): Promise<void> {
		const preset = this.getPreset();
		if (!preset) return;
		update(preset);
	}
}

function cloneKanbanPreset(preset: KanbanPreset): KanbanPreset {
	return {
		...preset,
		sortRules: preset.sortRules.map(rule => ({ ...rule })),
	};
}
