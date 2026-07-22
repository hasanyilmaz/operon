import { App, Setting } from 'obsidian';
import { t } from '../core/i18n';
import { cloneFilterSet, type FilterSet, type OperonSettings } from '../types/settings';
import { CalendarFilterPickerModal } from './calendar/calendar-filter-picker-modal';
import { FilterSetModal, type FilterModalEvalDeps, type FilterSetModalOptions } from './filter-set-modal';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { settingsAsyncHandler } from './settings/async-settings-action';

interface PresetFilterActionsOptions {
	app: App;
	setting: Setting;
	getSettings: () => OperonSettings;
	filterSets: FilterSet[];
	currentFilter: FilterSet | null;
	selectedFilterSetId: string | null | undefined;
	onSelectFilter: (filterSetId: string | null) => Promise<void>;
	onSaveFilterSet: (filterSet: FilterSet) => Promise<void>;
	onToggleFilterFavorite?: (filterSetId: string) => Promise<void>;
	getFilterModalEvalDeps?: () => FilterModalEvalDeps | null;
	filterEditorPickerPresentation?: FilterSetModalOptions['pickerPresentation'];
	onRefresh: () => void;
	errorContextPrefix: string;
}

function generateFilterSetId(): string {
	return 'fs_' + Math.random().toString(36).slice(2, 9);
}

function generateFilterGroupId(): string {
	return 'fg_' + Math.random().toString(36).slice(2, 10);
}

function createEmptyFilterSet(): FilterSet {
	return {
		id: generateFilterSetId(),
		name: '',
		icon: 'filter',
		rootGroup: {
			id: generateFilterGroupId(),
			logic: 'all',
			children: [],
		},
		sorts: [],
		subgroupBy: undefined,
		subgroupOrder: undefined,
		matchLogic: 'all',
		conditions: [],
	};
}

function bindPresetFilterActionTooltip(buttonEl: HTMLButtonElement, tooltip: string): void {
	buttonEl.addClass('operon-preset-filter-action-button');
	setAccessibleLabelWithoutTooltip(buttonEl, tooltip);
	bindOperonHoverTooltip(buttonEl, {
		content: tooltip,
		taskColor: null,
		preferredVertical: 'above',
	});
}

export function renderPresetFilterActions(options: PresetFilterActionsOptions): void {
	const {
		app,
		setting,
		filterSets,
		currentFilter,
		selectedFilterSetId,
		onSelectFilter,
		onSaveFilterSet,
		getFilterModalEvalDeps,
		onRefresh,
		errorContextPrefix,
	} = options;
	const currentLabel = currentFilter?.name ?? t('calendar', 'noFilter');
	setting
		.setDesc(currentLabel)
		.addButton(button => {
			button.setButtonText(t('filterSets', 'presetFilterCreate'));
			bindPresetFilterActionTooltip(button.buttonEl, t('filterSets', 'presetFilterCreateTooltip'));
			button.onClick(settingsAsyncHandler(`${errorContextPrefix} filter create failed`, async () => {
				new FilterSetModal(
					app,
					createEmptyFilterSet(),
					options.getSettings().keyMappings,
					settingsAsyncHandler(`${errorContextPrefix} filter create save failed`, async (saved) => {
						await onSaveFilterSet(saved);
						await onSelectFilter(saved.id);
						onRefresh();
					}),
					getFilterModalEvalDeps?.() ?? undefined,
					{
						getSettings: options.getSettings,
						onToggleFavorite: options.onToggleFilterFavorite,
						pickerPresentation: options.filterEditorPickerPresentation,
					},
				).open();
			}));
		})
		.addButton(button => {
			button.setButtonText(t('filterSets', 'presetFilterEdit'));
			button.setDisabled(!currentFilter);
			bindPresetFilterActionTooltip(button.buttonEl, t('filterSets', 'presetFilterEditTooltip'));
			button.onClick(settingsAsyncHandler(`${errorContextPrefix} filter edit failed`, async () => {
				if (!currentFilter) return;
				new FilterSetModal(
					app,
					cloneFilterSet(currentFilter),
					options.getSettings().keyMappings,
					settingsAsyncHandler(`${errorContextPrefix} filter edit save failed`, async (saved) => {
						await onSaveFilterSet(saved);
						onRefresh();
					}),
					getFilterModalEvalDeps?.() ?? undefined,
					{
						getSettings: options.getSettings,
						onToggleFavorite: options.onToggleFilterFavorite,
						pickerPresentation: options.filterEditorPickerPresentation,
					},
				).open();
			}));
		})
		.addButton(button => {
			button.setButtonText(t('filterSets', 'presetFilterPick'));
			bindPresetFilterActionTooltip(button.buttonEl, t('filterSets', 'presetFilterPickTooltip'));
			button.onClick(() => {
				new CalendarFilterPickerModal(app, {
					filterSets,
					onChooseFilter: settingsAsyncHandler(`${errorContextPrefix} filter selection failed`, async (filterSetId) => {
						await onSelectFilter(filterSetId);
						onRefresh();
					}),
				}).open();
			});
		})
		.addButton(button => {
			button.setButtonText(t('filterSets', 'presetFilterClear'));
			button.setDisabled(!selectedFilterSetId);
			bindPresetFilterActionTooltip(button.buttonEl, t('filterSets', 'presetFilterClearTooltip'));
			button.onClick(settingsAsyncHandler(`${errorContextPrefix} filter clear failed`, async () => {
				if (!selectedFilterSetId) return;
				await onSelectFilter(null);
				onRefresh();
			}));
		});

	setting.settingEl.addClass('operon-preset-filter-setting');
	setting.settingEl.toggleClass('has-selected-filter', !!currentFilter);
}
