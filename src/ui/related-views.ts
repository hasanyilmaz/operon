import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { isSpecialDynamicFilterSetId } from '../core/dynamic-file-task-filter';
import { t } from '../core/i18n';
import type { OperonSettings, FilterSet } from '../types/settings';
import type {
	RelatedFilterablePreset,
	RelatedPresetViewType,
	RelatedViewCreateTarget,
	RelatedViewGroup,
	RelatedViewItem,
	RelatedViewOpenTarget,
	RelatedViewSource,
	RelatedViewType,
} from '../types/related-views';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';

type RelatedViewSettings = Pick<
	OperonSettings,
	'calendarPresets' | 'kanbanPresets' | 'tablePresets' | 'filterSets'
>;

interface RelatedViewsLauncherOptions {
	container: HTMLElement;
	settings: RelatedViewSettings;
	source: RelatedViewSource;
	buttonClass?: string;
	closeBeforeOpen?: () => void;
	onOpenRelatedView?: (target: RelatedViewOpenTarget) => void | Promise<void>;
	onCreateRelatedView?: (target: RelatedViewCreateTarget) => void | Promise<void>;
}

export function buildRelatedViewGroups(
	settings: RelatedViewSettings,
	source: RelatedViewSource,
): RelatedViewGroup[] {
	const activeFilterSetId = resolveRelatedViewFilterSetId(settings, source.preset);
	if (activeFilterSetId === undefined) return [];
	const groups: RelatedViewGroup[] = [
		...buildActiveFilterGroup(settings, activeFilterSetId),
		{
			type: 'calendar',
			items: buildRelatedViewItems(settings, 'calendar', settings.calendarPresets, activeFilterSetId, source),
		},
		{
			type: 'kanban',
			items: buildRelatedViewItems(settings, 'kanban', settings.kanbanPresets, activeFilterSetId, source),
		},
		{
			type: 'table',
			items: buildRelatedViewItems(settings, 'table', settings.tablePresets, activeFilterSetId, source),
		},
	];
	return groups.filter(group => group.items.length > 0);
}

export function buildRelatedCreateTargets(
	settings: RelatedViewSettings,
	source: RelatedViewSource,
): RelatedViewCreateTarget[] {
	const activeFilterSetId = resolveRelatedViewFilterSetId(settings, source.preset);
	if (activeFilterSetId === undefined) return [];
	return [
		{ type: 'calendar', variant: 'timeGrid', filterSetId: activeFilterSetId },
		{ type: 'calendar', variant: 'timeTrackerGrid', filterSetId: activeFilterSetId },
		{ type: 'calendar', variant: 'multiWeek', filterSetId: activeFilterSetId },
		{ type: 'kanban', variant: 'defaultPipeline', filterSetId: activeFilterSetId },
		{ type: 'table', variant: 'defaultTable', filterSetId: activeFilterSetId },
	];
}

export function buildTableRelatedViewGroups(
	settings: RelatedViewSettings,
	currentPreset: RelatedFilterablePreset,
): RelatedViewGroup[] {
	return buildRelatedViewGroups(settings, { type: 'table', preset: currentPreset });
}

export function buildTableRelatedCreateTargets(
	settings: RelatedViewSettings,
	currentPreset: RelatedFilterablePreset,
): RelatedViewCreateTarget[] {
	return buildRelatedCreateTargets(settings, { type: 'table', preset: currentPreset });
}

export function buildUniqueRelatedPresetName(
	baseName: string,
	presets: readonly { name: string }[],
): string {
	const rootName = baseName.trim() || baseName || 'Preset';
	const usedNames = new Set(presets
		.map(preset => normalizePresetNameForUniqueness(preset.name))
		.filter((name): name is string => !!name));
	const normalizedRootName = normalizePresetNameForUniqueness(rootName) ?? rootName.toLowerCase();
	if (!usedNames.has(normalizedRootName)) return rootName;
	for (let index = 2; ; index += 1) {
		const candidate = `${rootName} ${index}`;
		const normalizedCandidate = normalizePresetNameForUniqueness(candidate);
		if (!normalizedCandidate || !usedNames.has(normalizedCandidate)) return candidate;
	}
}

export function renderRelatedViewsLauncher(options: RelatedViewsLauncherOptions): HTMLButtonElement | null {
	if (!isRelatedViewsLauncherAvailable()) return null;
	const label = getRelatedViewsMenuLabel(options.settings, options.source);
	const buttonClasses = ['operon-related-views-button'];
	if (options.buttonClass) buttonClasses.unshift(options.buttonClass);
	const button = options.container.createEl('button', {
		cls: buttonClasses.join(' '),
		attr: {
			type: 'button',
			'aria-label': label,
			'aria-haspopup': 'menu',
			'aria-expanded': 'false',
		},
	});
	setIcon(button, 'external-link');
	if (!button.querySelector('svg')) {
		setIcon(button, 'square-arrow-out-up-right');
	}
	bindOperonHoverTooltip(button, {
		content: label,
		taskColor: null,
		preferredVertical: 'above',
	});
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		showRelatedViewsMenu(button, options);
	});
	return button;
}

export function isRelatedViewsLauncherAvailable(): boolean {
	return !(Platform.isMobile || Platform.isMobileApp || Platform.isPhone || Platform.isTablet);
}

function showRelatedViewsMenu(anchor: HTMLElement, options: RelatedViewsLauncherOptions): void {
	options.closeBeforeOpen?.();
	const menu = new Menu();
	anchor.setAttribute('aria-expanded', 'true');
	menu.onHide(() => {
		anchor.setAttribute('aria-expanded', 'false');
	});
	const groups = buildRelatedViewGroups(options.settings, options.source);
	if (groups.length === 0) {
		menu.addItem(item => item
			.setTitle(t('table', 'relatedViewsEmpty'))
			.setIcon('info')
			.setDisabled(true));
	} else {
		for (const [index, group] of groups.entries()) {
			if (index > 0) menu.addSeparator();
			menu.addItem(item => item
				.setTitle(getRelatedViewGroupLabel(group.type))
				.setIsLabel(true));
			for (const relatedView of group.items) {
				menu.addItem(item => item
					.setTitle(relatedView.name)
					.setIcon(getRelatedViewIcon(relatedView.type))
					.onClick(() => openRelatedView(options, relatedView)));
			}
		}
	}
	const createTargets = options.onCreateRelatedView
		? buildRelatedCreateTargets(options.settings, options.source)
		: [];
		if (createTargets.length > 0) {
			menu.addSeparator();
			menu.addItem(item => item
				.setTitle(getRelatedCreateGroupLabel(createTargets))
				.setIsLabel(true));
			for (const createTarget of createTargets) {
				menu.addItem(item => item
				.setTitle(getRelatedCreateLabel(createTarget))
				.setIcon(getRelatedCreateIcon(createTarget))
				.onClick(() => createRelatedView(options, createTarget)));
		}
	}
	menu.showAtPosition(getRelatedViewsMenuPosition(anchor), anchor.ownerDocument);
}

function getRelatedViewsMenuLabel(settings: RelatedViewSettings, source: RelatedViewSource): string {
	const hasActiveFilter = buildRelatedViewGroups(settings, source)
		.some(group => group.type === 'filter');
	return t('table', hasActiveFilter ? 'relatedViewsMenuLabelWithFilter' : 'relatedViewsMenuLabel');
}

function getRelatedCreateGroupLabel(targets: RelatedViewCreateTarget[]): string {
	return targets.some(target => !!target.filterSetId)
		? t('table', 'relatedViewsAddNewWithFilterGroup')
		: t('table', 'relatedViewsAddNewGroup');
}

function openRelatedView(options: RelatedViewsLauncherOptions, relatedView: RelatedViewItem): void {
	void Promise.resolve(options.onOpenRelatedView?.({
		type: relatedView.type,
		presetId: relatedView.presetId,
	})).catch(error => {
		console.error('Operon: failed to open related view target', error);
		new Notice(t('table', 'relatedViewsOpenFailed'));
	});
}

function createRelatedView(options: RelatedViewsLauncherOptions, target: RelatedViewCreateTarget): void {
	void Promise.resolve(options.onCreateRelatedView?.(target)).catch(error => {
		console.error('Operon: failed to create related view target', error);
		new Notice(t('table', 'relatedViewsCreateFailed'));
	});
}

function getRelatedViewGroupLabel(type: RelatedViewType): string {
	if (type === 'filter') return t('table', 'filter');
	if (type === 'calendar') return t('table', 'relatedViewsCalendarGroup');
	if (type === 'kanban') return t('table', 'relatedViewsKanbanGroup');
	return t('table', 'relatedViewsTableGroup');
}

function getRelatedCreateLabel(target: RelatedViewCreateTarget): string {
	if (target.type === 'calendar' && target.variant === 'timeGrid') return t('table', 'relatedViewsNewCalendarTimeGrid');
	if (target.type === 'calendar' && target.variant === 'timeTrackerGrid') return t('table', 'relatedViewsNewCalendarTimeTrackerGrid');
	if (target.type === 'calendar' && target.variant === 'multiWeek') return t('table', 'relatedViewsNewCalendarMultiWeek');
	if (target.type === 'kanban') return t('table', 'relatedViewsNewKanbanDefaultPipeline');
	return t('table', 'relatedViewsNewTableDefaultTable');
}

function getRelatedCreateIcon(target: RelatedViewCreateTarget): string {
	if (target.type === 'calendar') return 'calendar-plus';
	if (target.type === 'kanban') return 'square-kanban';
	return 'table-2';
}

function getRelatedViewIcon(type: RelatedViewType): string {
	if (type === 'filter') return 'list-filter';
	if (type === 'calendar') return 'calendar-days';
	if (type === 'kanban') return 'square-kanban';
	return 'table-2';
}

function getRelatedViewsMenuPosition(anchor: HTMLElement): { x: number; y: number } {
	const rect = anchor.getBoundingClientRect();
	return { x: rect.left, y: rect.bottom + 4 };
}

function buildActiveFilterGroup(
	settings: RelatedViewSettings,
	filterSetId: string | null,
): RelatedViewGroup[] {
	if (!filterSetId) return [];
	const filterSet = settings.filterSets.find(entry => entry.id === filterSetId);
	if (!filterSet) return [];
	return [{
		type: 'filter',
		items: [{
			type: 'filter',
			presetId: filterSet.id,
			name: getFilterSetDisplayName(filterSet),
		}],
	}];
}

function resolveRelatedViewFilterSetId(settings: RelatedViewSettings, preset: RelatedFilterablePreset): string | null | undefined {
	const filterSetId = preset.filterSetId?.trim() || null;
	if (!filterSetId) return null;
	if (isSpecialDynamicFilterSetId(filterSetId)) return undefined;
	return settings.filterSets.some(filterSet => filterSet.id === filterSetId) ? filterSetId : null;
}

function buildRelatedViewItems(
	settings: RelatedViewSettings,
	type: RelatedPresetViewType,
	presets: readonly RelatedFilterablePreset[],
	filterSetId: string | null,
	source: RelatedViewSource,
): RelatedViewItem[] {
	return presets
		.filter(preset => !(source.type === type && preset.id === source.preset.id))
		.filter(preset => resolveRelatedViewFilterSetId(settings, preset) === filterSetId)
		.map(preset => ({
			type,
			presetId: preset.id,
			name: getRelatedViewDisplayName(preset),
		}))
		.sort(compareRelatedViewItems);
}

function getRelatedViewDisplayName(preset: RelatedFilterablePreset): string {
	return preset.name.trim() || preset.id;
}

function getFilterSetDisplayName(filterSet: Pick<FilterSet, 'id' | 'name'>): string {
	return filterSet.name.trim() || filterSet.id;
}

function compareRelatedViewItems(left: RelatedViewItem, right: RelatedViewItem): number {
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function normalizePresetNameForUniqueness(name: string): string | null {
	const trimmed = name.trim();
	return trimmed ? trimmed.toLowerCase() : null;
}
