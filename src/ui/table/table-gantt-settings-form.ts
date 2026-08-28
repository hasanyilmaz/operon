import { Setting } from 'obsidian';

import { t } from '../../core/i18n';
import { GANTT_SCALES, GANTT_UNIT_WIDTH_MULTIPLIERS } from '../../types/gantt';
import {
	TABLE_COLUMN_COLOR_MODES,
	TABLE_GANTT_VISIBILITIES,
	normalizeTableGanttSplitPercent,
	type TableGanttSettings,
} from '../../types/table';

export interface TableGanttSettingsFormOptions {
	container: HTMLElement;
	gantt: TableGanttSettings;
	includeEnabled: boolean;
	onChange: () => void;
}

export interface TableGanttSettingsFormHandle {
	setDisabled: (disabled: boolean) => void;
}

function capitalize(value: string): string {
	return value.length > 0 ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value;
}

export function renderTableGanttSettingsForm(options: TableGanttSettingsFormOptions): TableGanttSettingsFormHandle {
	const controls: Array<{ setDisabled: (disabled: boolean) => unknown }> = [];
	const addRow = (label: string): Setting => {
		const setting = new Setting(options.container).setName(label);
		setting.settingEl.addClass('operon-table-gantt-settings-row');
		return setting;
	};

	if (options.includeEnabled) {
		addRow(t('table', 'ganttEnabled')).addToggle(toggle => {
			controls.push(toggle);
			toggle.setValue(options.gantt.enabled).onChange(value => {
				options.gantt.enabled = value;
				options.onChange();
			});
		});
	}

	addRow(t('table', 'ganttSplitPercent')).addText(text => {
		controls.push(text);
		text.inputEl.type = 'number';
		text.inputEl.min = '20';
		text.inputEl.max = '80';
		text.inputEl.step = '0.01';
		text.setValue(String(options.gantt.splitPercent));
		text.onChange(value => {
			options.gantt.splitPercent = normalizeTableGanttSplitPercent(value, options.gantt.splitPercent);
			options.onChange();
		});
	});

	addRow(t('table', 'ganttScale')).addDropdown(dropdown => {
		controls.push(dropdown);
		for (const scale of GANTT_SCALES) dropdown.addOption(scale, t('table', `ganttScale${capitalize(scale)}`));
		dropdown.setValue(options.gantt.scale);
		dropdown.onChange(value => {
			if (!GANTT_SCALES.includes(value as TableGanttSettings['scale'])) return;
			options.gantt.scale = value as TableGanttSettings['scale'];
			options.onChange();
		});
	});

	addRow(t('table', 'ganttUnitWidth')).addDropdown(dropdown => {
		controls.push(dropdown);
		for (const multiplier of GANTT_UNIT_WIDTH_MULTIPLIERS) dropdown.addOption(String(multiplier), `${multiplier}x`);
		dropdown.setValue(String(options.gantt.unitWidthMultiplier));
		dropdown.onChange(value => {
			const multiplier = Number(value);
			if (!GANTT_UNIT_WIDTH_MULTIPLIERS.includes(multiplier as TableGanttSettings['unitWidthMultiplier'])) return;
			options.gantt.unitWidthMultiplier = multiplier as TableGanttSettings['unitWidthMultiplier'];
			options.onChange();
		});
	});

	addRow(t('table', 'ganttBarColor')).addDropdown(dropdown => {
		controls.push(dropdown);
		for (const mode of TABLE_COLUMN_COLOR_MODES) dropdown.addOption(mode, t('table', `ganttColor${capitalize(mode)}`));
		dropdown.setValue(options.gantt.barColorMode);
		dropdown.onChange(value => {
			if (!TABLE_COLUMN_COLOR_MODES.includes(value as TableGanttSettings['barColorMode'])) return;
			options.gantt.barColorMode = value as TableGanttSettings['barColorMode'];
			options.onChange();
		});
	});

	addRow(t('table', 'ganttWeekendVisibility')).addDropdown(dropdown => {
		controls.push(dropdown);
		for (const value of TABLE_GANTT_VISIBILITIES) {
			dropdown.addOption(value, t('table', `ganttVisibility${capitalize(value)}`));
		}
		dropdown.setValue(options.gantt.weekendVisibility);
		dropdown.onChange(value => {
			if (!TABLE_GANTT_VISIBILITIES.includes(value as TableGanttSettings['weekendVisibility'])) return;
			options.gantt.weekendVisibility = value as TableGanttSettings['weekendVisibility'];
			options.onChange();
		});
	});

	return {
		setDisabled: disabled => {
			for (const control of controls) control.setDisabled(disabled);
		},
	};
}
