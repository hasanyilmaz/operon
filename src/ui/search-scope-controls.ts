import { setIcon } from 'obsidian';
import { t } from '../core/i18n';
import type { ProjectSearchCandidate, ProjectSearchMode } from '../systems/task-search';
import {
	TASK_FINDER_DEFAULT_SCOPE_ICONS,
	type OperonSettings,
	type TaskFinderDefaultScopeKey,
} from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import {
	getTaskSearchBoxScopeButtonTooltipContent,
	getTaskSearchBoxShortcutLabel,
	type TaskSearchBoxScopeState,
} from './task-search-box-integration';

export const SEARCH_SCOPE_CONTROL_GROUPS: TaskFinderDefaultScopeKey[][] = [
	['projectTasks', 'projectTree'],
	['overdue', 'happensToday', 'recentModified'],
	['includeInline', 'includeFile'],
	['includeCancelled', 'includeFinished'],
];

export interface SearchParentSelection {
	mode: ProjectSearchMode;
	parentId: string;
	parentName: string;
}

export interface SearchParentUiState {
	mode: ProjectSearchMode;
	query: string;
	candidates: ProjectSearchCandidate[];
	selectedParentId: string | null;
	dropdownVisible: boolean;
}

export interface SearchScopeControlClassNames {
	popover: string;
	tools: string;
	group: string;
	button: string;
	selectedParent: string;
	selectedParentLabel: string;
	selectedParentClear: string;
	dropdown: string;
	empty: string;
	item: string;
	itemName: string;
	itemMeta: string;
	more?: string;
}

type SearchParentClearControl =
	| { kind: 'icon'; icon: string }
	| { kind: 'text'; text: string };

export function hasTaskSearchScopeFilters(scope: TaskSearchBoxScopeState): boolean {
	return scope.showOverdue
		|| scope.showHappensToday
		|| scope.showRecentModified
		|| !scope.includeInline
		|| !scope.includeFile
		|| !scope.includeCancelled
		|| !scope.includeFinished;
}

export function isTaskSearchScopeKeyActive(scope: TaskSearchBoxScopeState, key: TaskFinderDefaultScopeKey): boolean {
	switch (key) {
		case 'projectTasks':
			return scope.projectMode === 'pc';
		case 'projectTree':
			return scope.projectMode === 'pt';
		case 'overdue':
			return scope.showOverdue;
		case 'happensToday':
			return scope.showHappensToday;
		case 'recentModified':
			return scope.showRecentModified;
		case 'includeInline':
			return scope.includeInline;
		case 'includeFile':
			return scope.includeFile;
		case 'includeCancelled':
			return scope.includeCancelled;
		case 'includeFinished':
			return scope.includeFinished;
	}
}

export function getTaskSearchScopeButtonLabel(key: TaskFinderDefaultScopeKey): string {
	switch (key) {
		case 'projectTasks':
			return t('modals', 'taskFinderProjectTasks');
		case 'projectTree':
			return t('modals', 'taskFinderProjectTree');
		case 'overdue':
			return t('modals', 'taskFinderOverdue');
		case 'happensToday':
			return t('modals', 'taskFinderHappensToday');
		case 'recentModified':
			return t('modals', 'taskFinderRecentModified');
		case 'includeInline':
			return t('modals', 'taskFinderIncludeInline');
		case 'includeFile':
			return t('modals', 'taskFinderIncludeFile');
		case 'includeCancelled':
			return t('modals', 'taskFinderIncludeCancelled');
		case 'includeFinished':
			return t('modals', 'taskFinderIncludeFinished');
	}
}

export function syncSearchScopeControlWrapClasses(options: {
	searchWrap: HTMLElement;
	scope: TaskSearchBoxScopeState;
	selection: SearchParentSelection | null;
	rawQuery: string;
	isDefaultScope: (scope: TaskSearchBoxScopeState) => boolean;
	addScopePopoverClass?: boolean;
}): void {
	const hasSearchQuery = options.rawQuery.trim().length > 0;
	const hasActiveScope = !options.isDefaultScope(options.scope) || !!options.selection;
	options.searchWrap.classList.toggle('has-value', hasSearchQuery || hasActiveScope);
	options.searchWrap.classList.toggle('has-search-query', hasSearchQuery);
	options.searchWrap.classList.toggle('has-active-scope', hasActiveScope);
	if (options.addScopePopoverClass) {
		options.searchWrap.addClass('has-scope-popover');
	}
}

export function limitSearchParentCandidates(
	candidates: readonly ProjectSearchCandidate[],
	limit: number,
): { visibleCandidates: ProjectSearchCandidate[]; hiddenCount: number } {
	const normalizedLimit = Math.max(1, Math.floor(limit));
	const visibleCandidates = candidates.slice(0, normalizedLimit);
	return {
		visibleCandidates,
		hiddenCount: Math.max(0, candidates.length - visibleCandidates.length),
	};
}

export function renderSearchScopePopover(options: {
	searchWrap: HTMLElement;
	scope: TaskSearchBoxScopeState;
	settings: Pick<OperonSettings, 'taskFinderShortcuts' | 'taskFinderRecentModifiedDays'>;
	selectedParent: SearchParentSelection | null;
	classNames: SearchScopeControlClassNames;
	onToggle: (key: TaskFinderDefaultScopeKey) => void;
	onClearParent: () => void;
	onRefocus: () => void;
	disabledKeys?: ReadonlySet<TaskFinderDefaultScopeKey>;
	groups?: readonly (readonly TaskFinderDefaultScopeKey[])[];
	unavailableTooltip: string;
	onPopoverCreated?: (popover: HTMLElement) => void;
	selectedParentClearControl?: SearchParentClearControl;
	stopClearPropagation?: boolean;
}): void {
	const disabledKeys = options.disabledKeys ?? new Set<TaskFinderDefaultScopeKey>();
	const popover = options.searchWrap.createDiv(options.classNames.popover);
	options.onPopoverCreated?.(popover);
	const tools = popover.createDiv(`operon-task-finder-tools ${options.classNames.tools}`);
	for (const group of options.groups ?? SEARCH_SCOPE_CONTROL_GROUPS) {
		const groupEl = tools.createDiv(`operon-task-finder-tool-group ${options.classNames.group}`);
		for (const key of group) {
			renderSearchScopeButton(groupEl, {
				key,
				scope: options.scope,
				settings: options.settings,
				buttonClassName: options.classNames.button,
				isDisabled: disabledKeys.has(key),
				unavailableTooltip: options.unavailableTooltip,
				onToggle: options.onToggle,
				onRefocus: options.onRefocus,
			});
		}
	}

	if (!options.selectedParent) return;
	const selectedParent = popover.createDiv(options.classNames.selectedParent);
	selectedParent.createSpan({
		cls: options.classNames.selectedParentLabel,
		text: options.selectedParent.parentName,
	});
	const clearControl = options.selectedParentClearControl ?? { kind: 'icon' as const, icon: 'x' };
	const clearButton = selectedParent.createEl('button', {
		cls: options.classNames.selectedParentClear,
		attr: { type: 'button' },
	});
	if (clearControl.kind === 'text') {
		clearButton.setText(clearControl.text);
	} else {
		setIcon(clearButton, clearControl.icon);
	}
	setAccessibleLabelWithoutTooltip(clearButton, t('tooltips', 'clearSearch'));
	clearButton.addEventListener('pointerdown', event => event.preventDefault());
	clearButton.addEventListener('click', event => {
		event.preventDefault();
		if (options.stopClearPropagation) {
			event.stopPropagation();
		}
		options.onClearParent();
		options.onRefocus();
	});
}

export function renderSearchScopeButtonStrip(options: {
	container: HTMLElement;
	scope: TaskSearchBoxScopeState;
	settings: Pick<OperonSettings, 'taskFinderShortcuts' | 'taskFinderRecentModifiedDays'>;
	keys: readonly TaskFinderDefaultScopeKey[];
	buttonClassName: string;
	onToggle: (key: TaskFinderDefaultScopeKey) => void;
	onRefocus: () => void;
	disabledKeys?: ReadonlySet<TaskFinderDefaultScopeKey>;
	unavailableTooltip: string;
}): void {
	const disabledKeys = options.disabledKeys ?? new Set<TaskFinderDefaultScopeKey>();
	for (const key of options.keys) {
		renderSearchScopeButton(options.container, {
			key,
			scope: options.scope,
			settings: options.settings,
			buttonClassName: options.buttonClassName,
			isDisabled: disabledKeys.has(key),
			unavailableTooltip: options.unavailableTooltip,
			onToggle: options.onToggle,
			onRefocus: options.onRefocus,
		});
	}
}

function renderSearchScopeButton(container: HTMLElement, options: {
	key: TaskFinderDefaultScopeKey;
	scope: TaskSearchBoxScopeState;
	settings: Pick<OperonSettings, 'taskFinderShortcuts' | 'taskFinderRecentModifiedDays'>;
	buttonClassName: string;
	isDisabled: boolean;
	unavailableTooltip: string;
	onToggle: (key: TaskFinderDefaultScopeKey) => void;
	onRefocus: () => void;
}): void {
	const isActive = isTaskSearchScopeKeyActive(options.scope, options.key);
	const button = container.createEl('button', {
		cls: `operon-task-finder-tool ${options.buttonClassName}`,
		attr: {
			type: 'button',
			'data-scope-key': options.key,
		},
	});
	button.classList.toggle('is-active', isActive);
	button.setAttribute('aria-pressed', String(isActive));
	button.classList.toggle('is-disabled', options.isDisabled);
	if (options.isDisabled) {
		button.setAttribute('aria-disabled', 'true');
	}
	button.addEventListener('pointerdown', event => event.preventDefault());
	button.addEventListener('click', () => {
		if (!options.isDisabled) {
			options.onToggle(options.key);
		}
		options.onRefocus();
	});
	const icon = button.createSpan('operon-task-finder-tool-icon');
	setIcon(icon, TASK_FINDER_DEFAULT_SCOPE_ICONS[options.key]);
	const label = getTaskSearchScopeButtonLabel(options.key);
	setAccessibleLabelWithoutTooltip(button, label);
	const shortcut = options.isDisabled ? '' : getTaskSearchBoxShortcutLabel(options.settings, options.key);
	bindOperonHoverTooltip(button, {
		title: shortcut ? `${label} ${shortcut}` : label,
		content: options.isDisabled
			? options.unavailableTooltip
			: getTaskSearchBoxScopeButtonTooltipContent(options.key, options.scope, options.settings),
		taskColor: null,
		preferredHorizontal: 'center',
	});
}

export function renderParentSearchDropdown(options: {
	searchWrap: HTMLElement;
	parentSearchUi: SearchParentUiState | null;
	highlightedIndex: number;
	classNames: SearchScopeControlClassNames;
	onSelect: (candidate: ProjectSearchCandidate) => void;
	candidateLimit?: number;
	noParentsText?: string;
	hiddenCountText?: (hiddenCount: number) => string;
}): void {
	options.searchWrap.querySelector<HTMLElement>(`.${options.classNames.dropdown}`)?.remove();
	if (!options.parentSearchUi?.dropdownVisible) return;
	const dropdown = options.searchWrap.createDiv(options.classNames.dropdown);
	if (options.parentSearchUi.candidates.length === 0) {
		dropdown.createDiv({
			cls: options.classNames.empty,
			text: options.noParentsText ?? t('notifications', 'kanbanParentSearchNoParents'),
		});
		return;
	}
	const limited = typeof options.candidateLimit === 'number'
		? limitSearchParentCandidates(options.parentSearchUi.candidates, options.candidateLimit)
		: { visibleCandidates: options.parentSearchUi.candidates, hiddenCount: 0 };
	limited.visibleCandidates.forEach((candidate, index) => {
		const item = dropdown.createEl('button', {
			cls: options.classNames.item,
			attr: { type: 'button' },
		});
		item.classList.toggle('is-active', index === options.highlightedIndex);
		item.addEventListener('pointerdown', event => event.preventDefault());
		item.addEventListener('click', () => {
			options.onSelect(candidate);
		});
		item.createDiv({
			cls: options.classNames.itemName,
			text: candidate.task.description,
		});
		item.createDiv({
			cls: options.classNames.itemMeta,
			text: options.parentSearchUi?.mode === 'pc'
				? String(candidate.directVisibleCount)
				: String(candidate.treeVisibleCount),
		});
	});
	if (limited.hiddenCount > 0 && options.classNames.more && options.hiddenCountText) {
		dropdown.createDiv({
			cls: options.classNames.more,
			text: options.hiddenCountText(limited.hiddenCount),
		});
	}
}

export function updateSearchParentHighlight(options: {
	root: HTMLElement;
	itemSelector: string;
	currentIndex: number;
	nextIndex: number;
}): number {
	const rows = Array.from(options.root.querySelectorAll<HTMLElement>(options.itemSelector));
	if (rows.length === 0) {
		return options.nextIndex;
	}
	const clampedIndex = Math.max(0, Math.min(options.nextIndex, rows.length - 1));
	if (clampedIndex === options.currentIndex) return options.currentIndex;
	const previousRow = rows[options.currentIndex];
	const nextRow = rows[clampedIndex];
	previousRow?.removeClass('is-active');
	nextRow?.addClass('is-active');
	nextRow?.scrollIntoView({ block: 'nearest' });
	return clampedIndex;
}
