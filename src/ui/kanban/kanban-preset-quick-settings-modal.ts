import { App, DropdownComponent, Modal, Notice, Setting } from 'obsidian';
import { APPEARANCE_SCHEME_LIGHT_OPTIONS, APPEARANCE_SCHEME_DARK_OPTIONS, addAppearanceSchemeOptions } from '../appearance-schemes';
import {
	KANBAN_SORT_FIELD_OPTIONS,
	KanbanAppearanceMode,
	cloneKanbanColumnSortOverrides,
	KanbanPreset,
	KanbanSortDirection,
	KanbanSortEmptyPlacement,
	KanbanSortMode,
	KanbanSortRule,
	KanbanSwimlaneBy,
	isBuiltInKanbanSwimlaneBy,
	normalizeKanbanCardImageSource,
	normalizeKanbanCustomFieldReference,
} from '../../types/kanban';
import type { FilterSet, OperonSettings } from '../../types/settings';
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
import { getKanbanSwimlaneCustomFieldOptions, getManagedCustomFieldOptionMapping, getManagedCustomFieldOptions } from '../../core/managed-task-fields';
import { renderPresetFilterActions } from '../preset-filter-actions';
import type { FilterModalEvalDeps, FilterSetModalOptions } from '../filter-set-modal';
import { isPresetFavorite } from '../../core/preset-favorites';
import { createPresetFavoriteButton } from '../preset-favorite-button';
import { addKanbanCardImageSourceOptions } from '../../core/kanban-card-image-source';

interface KanbanPresetQuickSettingsModalOptions {
	getSettings: () => OperonSettings;
	preset: KanbanPreset | null;
	onSave: (preset: KanbanPreset) => Promise<void>;
	onToggleFavorite: (presetId: string) => Promise<void>;
	onSaveFilterSet: (filterSet: FilterSet) => Promise<void>;
	onToggleFilterFavorite?: (filterSetId: string) => Promise<void>;
	getFilterModalEvalDeps?: () => FilterModalEvalDeps | null;
	filterEditorPickerPresentation?: FilterSetModalOptions['pickerPresentation'];
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
						delete current.columnSortOverrides;
					});
					this.renderPreservingScroll();
				});
			});

		const filterSets = getNormalFilterSets(settings.filterSets);
		const currentFilter = filterSets.find(entry => entry.id === preset.filterSetId) ?? null;
		const filteringCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionFilteringLanes'));
		renderPresetFilterActions({
			app: this.app,
			setting: new Setting(filteringCard)
				.setName(t('settings', 'kanbanFilter')),
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
			onToggleFilterFavorite: this.options.onToggleFilterFavorite,
			getFilterModalEvalDeps: this.options.getFilterModalEvalDeps,
			filterEditorPickerPresentation: this.options.filterEditorPickerPresentation,
			onRefresh: () => this.render(),
			errorContextPrefix: 'kanban preset',
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
		this.renderSortSection(sortingCard, preset, null);
		const columnSortingCard = this.createPresetSection(contentEl, t('settings', 'kanbanPipelineColumnSorting'));
		this.renderPipelineColumnSortSection(columnSortingCard, preset);

		const appearanceCard = this.createPresetSection(contentEl, t('settings', 'kanbanPresetSectionAppearance'));
		new Setting(appearanceCard)
			.setName(t('settings', 'kanbanTaskColorSource'))
			.setDesc(t('settings', 'kanbanTaskColorSourceDesc'))
			.addDropdown(dropdown => {
				addTaskColorSourceOptions(dropdown, KANBAN_TASK_COLOR_SOURCES);
				dropdown.setValue(normalizeTaskColorSource(preset.colorSource, KANBAN_TASK_COLOR_SOURCES, 'noColor'));
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.colorSource = normalizeTaskColorSource(value, KANBAN_TASK_COLOR_SOURCES, 'noColor');
					});
				});
			});

		new Setting(appearanceCard)
			.setName(t('settings', 'kanbanCardImageSource'))
			.setDesc(t('settings', 'kanbanCardImageSourceDesc'))
			.addDropdown(dropdown => {
				addKanbanCardImageSourceOptions(dropdown);
				dropdown.setValue(normalizeKanbanCardImageSource(preset.cardImageSource));
				dropdown.onChange(async value => {
					await this.updatePreset(current => {
						current.cardImageSource = normalizeKanbanCardImageSource(value);
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
		const left = row.createDiv('operon-preset-settings-footer-management');
		const right = row.createDiv('operon-preset-settings-footer-primary');
		const preset = this.getPreset();
		const settings = this.options.getSettings();
		const isStoredPreset = preset !== null && settings.kanbanPresets.some(entry => entry.id === preset.id);
		const isFavorite = preset !== null && isPresetFavorite(settings.presetFavorites, 'kanban', preset.id);

		createPresetFavoriteButton({
			containerEl: left,
			className: 'operon-kanban-preset-settings-footer-button operon-preset-settings-footer-icon-button',
			active: isFavorite,
			disabled: !isStoredPreset,
			onClick: () => {
				if (!preset) return;
				void runSettingsAsync('kanban preset favorite failed', async () => {
					await this.options.onToggleFavorite(preset.id);
					this.renderPreservingScroll(true);
				});
			},
		});

		const cancelBtn = right.createEl('button', {
			cls: 'operon-kanban-preset-settings-footer-button',
			text: t('buttons', 'cancel'),
		});
		cancelBtn.type = 'button';
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = right.createEl('button', {
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

	private renderPreservingScroll(restoreFavoriteFocus = false): void {
		const scrollTop = this.contentEl.scrollTop;
		const scrollLeft = this.contentEl.scrollLeft;
		this.render();
		const restore = (): void => {
			this.contentEl.scrollTop = scrollTop;
			this.contentEl.scrollLeft = scrollLeft;
		};
		restore();
		if (restoreFavoriteFocus) {
			this.contentEl.querySelector<HTMLButtonElement>('.operon-preset-favorite-button')?.focus({ preventScroll: true });
		}
		this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(restore);
	}

	private renderSortSection(container: HTMLElement, preset: KanbanPreset, statusId: string | null): void {
		const configuration = this.getSortConfiguration(preset, statusId);
		if (!configuration) return;
		container.createDiv({
			text: statusId ? t('settings', 'kanbanColumnSortingDesc') : t('settings', 'kanbanSortingDesc'),
			cls: 'operon-kanban-preset-section-desc',
		});
		this.renderSortModeControl(container, preset, statusId, configuration);
		if (configuration.sortMode === 'manual') {
			this.renderManualSortMessage(container);
			return;
		}

		const section = container.createDiv('operon-kanban-sort-rules');

		configuration.sortRules.forEach((rule, index) => {
			const row = section.createDiv('operon-kanban-sort-row');

			row.createSpan({ cls: 'operon-kanban-sort-label', text: t('settings', 'kanbanSortBy') });

			const fieldSelect = row.createEl('select', { cls: 'operon-kanban-sort-select' });
			for (const option of this.getKanbanSortFieldOptions()) {
				fieldSelect.add(new Option(option.label, option.value));
			}
			fieldSelect.value = rule.field;
			fieldSelect.addEventListener('change', settingsAsyncHandler('kanban preset sort field change failed', async () => {
				await this.updatePreset(current => {
					this.updateSortConfiguration(current, statusId, target => {
						target.sortRules[index].field = fieldSelect.value;
					});
				});
			}));

			const directionButton = row.createEl('button', { cls: 'operon-kanban-sort-toggle', text: this.formatSortDirection(rule.direction) });
			directionButton.addEventListener('click', settingsAsyncHandler('kanban preset sort direction change failed', async () => {
				await this.updatePreset(current => {
					this.updateSortConfiguration(current, statusId, target => {
						target.sortRules[index].direction = target.sortRules[index].direction === 'asc' ? 'desc' : 'asc';
					});
				});
				this.render();
			}));

			const emptyButton = row.createEl('button', { cls: 'operon-kanban-sort-toggle', text: this.formatSortEmpty(rule.empty) });
			bindOperonHoverTooltip(emptyButton, { content: t('settings', 'kanbanSortEmptyTooltip'), taskColor: null });
			emptyButton.addEventListener('click', settingsAsyncHandler('kanban preset sort empty placement change failed', async () => {
				await this.updatePreset(current => {
					this.updateSortConfiguration(current, statusId, target => {
						target.sortRules[index].empty = target.sortRules[index].empty === 'last' ? 'first' : 'last';
					});
				});
				this.render();
			}));

			const upButton = row.createEl('button', { cls: 'operon-kanban-sort-icon-button', text: '↑' });
			upButton.disabled = index === 0;
			upButton.addEventListener('click', settingsAsyncHandler('kanban preset sort move up failed', async () => {
				if (index === 0) return;
				await this.updatePreset(current => {
					this.updateSortConfiguration(current, statusId, target => {
						const [moved] = target.sortRules.splice(index, 1);
						target.sortRules.splice(index - 1, 0, moved);
					});
				});
				this.render();
			}));

			const downButton = row.createEl('button', { cls: 'operon-kanban-sort-icon-button', text: '↓' });
			downButton.disabled = index >= configuration.sortRules.length - 1;
			downButton.addEventListener('click', settingsAsyncHandler('kanban preset sort move down failed', async () => {
				if (index >= configuration.sortRules.length - 1) return;
				await this.updatePreset(current => {
					this.updateSortConfiguration(current, statusId, target => {
						const [moved] = target.sortRules.splice(index, 1);
						target.sortRules.splice(index + 1, 0, moved);
					});
				});
				this.render();
			}));

			const removeButton = row.createEl('button', { cls: 'operon-kanban-sort-icon-button', text: '✕' });
			removeButton.disabled = configuration.sortRules.length <= 1;
			removeButton.addEventListener('click', settingsAsyncHandler('kanban preset sort remove failed', async () => {
				if (configuration.sortRules.length <= 1) return;
				await this.updatePreset(current => {
					this.updateSortConfiguration(current, statusId, target => {
						target.sortRules.splice(index, 1);
					});
				});
				this.render();
			}));
		});

		const addRow = section.createDiv('operon-kanban-sort-add-row');
		const addButton = addRow.createEl('button', { text: t('settings', 'kanbanAddSortField') });
		addButton.addEventListener('click', settingsAsyncHandler('kanban preset sort add failed', async () => {
			await this.updatePreset(current => {
				this.updateSortConfiguration(current, statusId, target => {
					target.sortRules.push({
						field: 'alphabetical',
						direction: 'asc',
						empty: 'last',
					});
				});
			});
			this.render();
		}));
	}

	private renderSortModeControl(
		container: HTMLElement,
		preset: KanbanPreset,
		statusId: string | null,
		configuration: Pick<KanbanPreset, 'sortMode' | 'sortRules'>,
	): void {
		new Setting(container)
			.setName(t('settings', 'kanbanSortMode'))
			.addDropdown(dropdown => {
				dropdown.addOption('automatic', t('settings', 'kanbanSortModeAutomatic'));
				dropdown.addOption('manual', t('settings', 'kanbanSortModeManual'));
				dropdown.setValue(configuration.sortMode);
				dropdown.onChange(async value => {
					const sortMode: KanbanSortMode = value === 'manual' ? 'manual' : 'automatic';
					if (configuration.sortMode === sortMode) return;
					await this.updatePreset(current => {
						this.updateSortConfiguration(current, statusId, target => {
							target.sortMode = sortMode;
						});
					});
					this.render();
				});
			});
	}

	private renderPipelineColumnSortSection(container: HTMLElement, preset: KanbanPreset): void {
		const pipeline = this.options.getSettings().pipelines.find(entry => entry.id === preset.pipelineId) ?? null;
		if (!pipeline) {
			container.createDiv({ text: t('settings', 'kanbanColumnSortingNoPipeline'), cls: 'operon-kanban-preset-section-desc' });
			return;
		}
		const configured = new Set((preset.columnSortOverrides ?? []).map(override => override.statusId));
		const available = pipeline.statuses.filter(status => !configured.has(status.id));
		let selectedStatusId = available[0]?.id ?? '';
		const addSetting = new Setting(container)
			.addButton(button => {
				button.setButtonText(t('settings', 'kanbanAddColumnSorting'));
				button.setDisabled(available.length === 0);
				button.onClick(async () => {
					if (!selectedStatusId || configured.has(selectedStatusId)) return;
					await this.updatePreset(current => {
						(current.columnSortOverrides ??= []).push({
							statusId: selectedStatusId,
							sortMode: current.sortMode,
							sortRules: current.sortRules.map(rule => ({ ...rule })),
						});
					});
					this.renderPreservingScroll();
				});
			})
			.addDropdown(dropdown => {
				for (const status of available) dropdown.addOption(status.id, status.label);
				dropdown.setValue(selectedStatusId);
				dropdown.setDisabled(available.length === 0);
				dropdown.onChange(value => { selectedStatusId = value; });
			});
		addSetting.settingEl.addClass('operon-kanban-column-sort-add-setting');
		if (available.length === 0) addSetting.setDesc(t('settings', 'kanbanColumnSortingAllConfigured'));

		for (const status of pipeline.statuses) {
			if (!configured.has(status.id)) continue;
			const block = container.createDiv('operon-kanban-column-sort-block');
			const header = new Setting(block).setName(status.label).setHeading();
			header.settingEl.addClass('operon-kanban-column-sort-header');
			header.addButton(button => {
				button.setButtonText(t('buttons', 'remove'));
				button.buttonEl.addClass('operon-kanban-column-sort-remove-button');
				button.onClick(() => {
					void this.updatePreset(current => {
						const overrides = (current.columnSortOverrides ?? []).filter(override => override.statusId !== status.id);
						if (overrides.length > 0) current.columnSortOverrides = overrides;
						else delete current.columnSortOverrides;
					});
					this.renderPreservingScroll();
				});
			});
			this.renderSortSection(block, preset, status.id);
		}
	}

	private getSortConfiguration(
		preset: KanbanPreset,
		statusId: string | null,
	): Pick<KanbanPreset, 'sortMode' | 'sortRules'> | null {
		return statusId
			? preset.columnSortOverrides?.find(override => override.statusId === statusId) ?? null
			: preset;
	}

	private updateSortConfiguration(
		preset: KanbanPreset,
		statusId: string | null,
		update: (configuration: Pick<KanbanPreset, 'sortMode' | 'sortRules'>) => void,
	): void {
		const configuration = this.getSortConfiguration(preset, statusId);
		if (configuration) update(configuration);
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
		for (const option of getKanbanSwimlaneCustomFieldOptions(this.options.getSettings().keyMappings)) {
			dropdown.addOption(option.field, option.label);
		}
	}

	private getSwimlaneLabel(value: KanbanSwimlaneBy): string {
		const customMapping = getManagedCustomFieldOptionMapping(value, this.options.getSettings().keyMappings);
		if (customMapping) return customMapping.visiblePropertyName?.trim() || customMapping.canonicalKey;
		const key = `kanbanSwimlane_${value}`;
		const localized = t('settings', key);
		return localized === key ? value : localized;
	}

	private getKanbanSortFieldOptions(): Array<{ value: KanbanSortRule['field']; label: string }> {
		return [
			...KANBAN_SORT_FIELD_OPTIONS.map(option => ({
				value: option.value,
				label: this.getKanbanSortFieldLabel(option),
			})),
			...getManagedCustomFieldOptions(this.options.getSettings().keyMappings).map(option => ({
				value: option.field,
				label: option.label,
			})),
		];
	}

	private getKanbanSortFieldLabel(option: typeof KANBAN_SORT_FIELD_OPTIONS[number]): string {
		const key = `kanbanSortField_${option.value}`;
		const localized = t('settings', key);
		return localized === key ? option.label : localized;
	}

	private parseSwimlaneBy(value: string): KanbanSwimlaneBy | null {
		if (isBuiltInKanbanSwimlaneBy(value)) return value;
		return normalizeKanbanCustomFieldReference(value);
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
		...(preset.columnSortOverrides?.length
			? { columnSortOverrides: cloneKanbanColumnSortOverrides(preset.columnSortOverrides) }
			: {}),
	};
}
