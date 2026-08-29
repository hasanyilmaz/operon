import { setIcon } from 'obsidian';

import type { PresetFavorites } from '../../core/preset-favorites';
import type { TablePreset } from '../../types/table';
import { getFavoriteTablePresets } from './table-preset-visibility';
import type { TableToolbarSurfacePolicy } from './table-toolbar-surface-policy';
import { bindTableToolbarLayout } from './table-toolbar-layout';

export const TABLE_TOOLBAR_END_SLOT_ORDER = [
	'presetPicker',
	'groupSort',
	'filter',
	'settings',
	'gantt',
	'search',
	'export',
] as const;

type TableToolbarEndSlot = typeof TABLE_TOOLBAR_END_SLOT_ORDER[number];
type TableToolbarEndSlotRenderer = (end: HTMLElement) => void;

export interface TableToolbarCompositionSlots {
	renderRelatedViews?: (titleWrap: HTMLElement) => void;
	renderPresetPicker?: (end: HTMLElement) => void;
	renderGroupSort?: (end: HTMLElement) => void;
	renderFilter?: (end: HTMLElement) => void;
	renderSettings?: (end: HTMLElement) => void;
	renderGantt?: (end: HTMLElement) => void;
	renderSearch: (end: HTMLElement) => void;
	renderExport?: (end: HTMLElement) => void;
}

export interface TableToolbarCompositionOptions {
	root: HTMLElement;
	toolbarClassName?: string;
	surfaceTitle: string;
	activePreset: TablePreset;
	presets: readonly TablePreset[];
	favorites: PresetFavorites;
	policy: TableToolbarSurfacePolicy;
	onSelectPreset: (presetId: string) => void | Promise<void>;
	slots: TableToolbarCompositionSlots;
}

export interface TableToolbarCompositionResult {
	toolbar: HTMLElement;
	disposeLayout: () => void;
}

export function renderTableToolbarComposition(
	options: TableToolbarCompositionOptions,
): TableToolbarCompositionResult {
	const toolbar = options.root.createDiv('operon-table-toolbar');
	if (options.toolbarClassName) toolbar.addClass(options.toolbarClassName);
	const start = toolbar.createDiv('operon-table-toolbar-start');
	const center = toolbar.createDiv('operon-table-toolbar-center');
	const end = toolbar.createDiv('operon-table-toolbar-end operon-table-toolbar-controls');
	const titleWrap = start.createDiv('operon-table-title-wrap');
	const icon = titleWrap.createSpan('operon-table-title-icon');
	setIcon(icon, 'table-2');
	titleWrap.createSpan({
		cls: 'operon-table-title',
		text: options.policy.titleSource === 'preset'
			? options.activePreset.name.trim() || options.surfaceTitle
			: options.surfaceTitle,
	});
	if (options.policy.showRelatedViews) options.slots.renderRelatedViews?.(titleWrap);

	if (options.policy.showFavoritePresets) {
		for (const preset of getFavoriteTablePresets(options.presets, options.favorites)) {
			const button = center.createEl('button', {
				text: preset.name,
				cls: 'operon-table-toolbar-preset-button',
				attr: { type: 'button' },
			});
			button.classList.toggle('is-active', preset.id === options.activePreset.id);
			button.addEventListener('click', () => {
				void options.onSelectPreset(preset.id);
			});
		}
	}

	const endSlots: Partial<Record<TableToolbarEndSlot, TableToolbarEndSlotRenderer>> = {
		presetPicker: options.policy.showPresetPicker ? options.slots.renderPresetPicker : undefined,
		groupSort: options.slots.renderGroupSort,
		filter: options.slots.renderFilter,
		settings: options.slots.renderSettings,
		gantt: options.slots.renderGantt,
		search: options.slots.renderSearch,
		export: options.policy.showExport ? options.slots.renderExport : undefined,
	};
	for (const slot of TABLE_TOOLBAR_END_SLOT_ORDER) endSlots[slot]?.(end);

	return {
		toolbar,
		disposeLayout: bindTableToolbarLayout(toolbar, start, center, end),
	};
}
