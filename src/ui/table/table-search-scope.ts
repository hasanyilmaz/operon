import { setIcon } from 'obsidian';
import { filterTasksForCalendar } from '../../systems/calendar-filter-materialization';
import {
	buildProjectSearchCandidates,
	matchesTaskSearchQueryText,
	resolveProjectSearchVisibleTaskIds,
	type ProjectSearchCandidate,
	type ProjectSearchMode,
	type ProjectSearchResolvers,
} from '../../systems/task-search';
import type { PinnedCache } from '../../storage/pinned-cache';
import type { IndexedTask } from '../../types/fields';
import {
	type FilterSet,
	type OperonSettings,
	type TaskFinderDefaultScopeKey,
} from '../../types/settings';
import { t } from '../../core/i18n';
import {
	areTaskSearchBoxScopesEqual,
	getTaskSearchBoxRecentModifiedCutoff,
	TASK_SEARCH_BOX_DEFAULT_SCOPE,
	matchesTaskSearchBoxScope,
	type TaskSearchBoxScopeState,
} from '../task-search-box-integration';
import type { TableFilePropertyQueryContext } from './table-file-property';
import {
	SEARCH_SCOPE_CONTROL_GROUPS,
	getTaskSearchScopeButtonLabel,
	hasTaskSearchScopeFilters,
	isTaskSearchScopeKeyActive,
	limitSearchParentCandidates,
	renderParentSearchDropdown,
	renderSearchScopePopover,
	syncSearchScopeControlWrapClasses,
	type SearchParentSelection,
	type SearchParentUiState,
	type SearchScopeControlClassNames,
} from '../search-scope-controls';

export const TABLE_SEARCH_PARENT_MIN_QUERY_LENGTH = 2;
export const TABLE_TEXT_SEARCH_MIN_QUERY_LENGTH = 2;
export const TABLE_PARENT_SEARCH_MAX_CANDIDATES = 50;
export const TABLE_SEARCH_MAX_QUERY_LENGTH = 200;

// The search inputs enforce the cap via maxLength, so the visible text can never
// diverge from the query used for filtering; this clamp remains as the guard for
// programmatic and persisted values.
export function clampTableSearchQuery(value: string): string {
	return value.slice(0, TABLE_SEARCH_MAX_QUERY_LENGTH);
}
export const TABLE_SEARCH_BOX_DEFAULT_SCOPE: TaskSearchBoxScopeState = {
	...TASK_SEARCH_BOX_DEFAULT_SCOPE,
};

export const TABLE_SEARCH_BOX_DISABLED_KEYS = new Set<TaskFinderDefaultScopeKey>();
export const TABLE_SEARCH_SCOPE_GROUPS = SEARCH_SCOPE_CONTROL_GROUPS;
export type TableParentSearchSelection = SearchParentSelection;
export type TableParentSearchUiState = SearchParentUiState;

const TABLE_SEARCH_SCOPE_CONTROL_CLASSES: SearchScopeControlClassNames = {
	popover: 'operon-table-search-scope-popover',
	tools: 'operon-table-search-scope-tools',
	group: 'operon-table-search-scope-group',
	button: 'operon-table-search-scope-button',
	selectedParent: 'operon-table-search-selected-parent',
	selectedParentLabel: 'operon-table-search-selected-parent-label',
	selectedParentClear: 'operon-table-search-selected-parent-clear',
	dropdown: 'operon-table-parent-search-dropdown',
	empty: 'operon-table-parent-search-empty',
	item: 'operon-table-parent-search-item',
	itemName: 'operon-table-parent-search-item-name',
	itemMeta: 'operon-table-parent-search-item-meta',
	more: 'operon-table-parent-search-more',
};

export function cloneTableSearchBoxScopeState(scope = TABLE_SEARCH_BOX_DEFAULT_SCOPE): TaskSearchBoxScopeState {
	return { ...scope };
}

export function isDefaultTableSearchBoxScope(scope: TaskSearchBoxScopeState): boolean {
	return areTaskSearchBoxScopesEqual(scope, TABLE_SEARCH_BOX_DEFAULT_SCOPE);
}

export function hasTableSearchScopeFilters(scope: TaskSearchBoxScopeState): boolean {
	return hasTaskSearchScopeFilters(scope);
}

export function isTableSearchScopeActive(
	scope: TaskSearchBoxScopeState,
	selection: TableParentSearchSelection | null,
	rawQuery: string,
): boolean {
	return !isDefaultTableSearchBoxScope(scope)
		|| !!selection
		|| rawQuery.trim().length >= TABLE_TEXT_SEARCH_MIN_QUERY_LENGTH;
}

export function getTableActiveTextSearchQuery(
	rawQuery: string,
	parentSearchUi: TableParentSearchUiState | null,
): string {
	if (parentSearchUi && !parentSearchUi.selectedParentId) return '';
	return getTableNormalTextSearchQuery(rawQuery);
}

export function getTableNormalTextSearchQuery(rawQuery: string): string {
	const trimmedQuery = rawQuery.trim();
	return trimmedQuery.length >= TABLE_TEXT_SEARCH_MIN_QUERY_LENGTH ? trimmedQuery : '';
}

export function isTableActiveTextSearchClearing(previousRawQuery: string, nextRawQuery: string): boolean {
	return getTableNormalTextSearchQuery(previousRawQuery).length > 0
		&& getTableNormalTextSearchQuery(nextRawQuery).length === 0;
}

export function resolveTableSearchScopedTasks(options: {
	filterSet: FilterSet | null;
	tasks: IndexedTask[];
	priorities: { label: string; color?: string }[];
	pinnedCache: PinnedCache | null;
	scope: TaskSearchBoxScopeState;
	settings: Pick<OperonSettings, 'taskFinderRecentModifiedDays' | 'projectSerialScopes'>;
	filePropertyContext?: TableFilePropertyQueryContext;
}): IndexedTask[] {
	const recentModifiedCutoff = getTaskSearchBoxRecentModifiedCutoff(options.settings);
	return resolveTableSearchBaseScopeTasks(options)
		.filter(task => matchesTaskSearchBoxScope(task, options.scope, { recentModifiedCutoff }));
}

export function resolveTableSearchBaseScopeTasks(options: {
	filterSet: FilterSet | null;
	tasks: IndexedTask[];
	priorities: { label: string; color?: string }[];
	pinnedCache: PinnedCache | null;
	projectSerialScopes?: OperonSettings['projectSerialScopes'];
	filePropertyContext?: TableFilePropertyQueryContext;
}): IndexedTask[] {
	return filterTasksForCalendar(
		options.filterSet,
		options.tasks,
		options.priorities,
		options.pinnedCache,
		{
			projectSerialScopes: options.projectSerialScopes,
			projectSerialScopeTasks: options.tasks,
			filePropertyContext: options.filePropertyContext,
		},
	);
}

export function buildTableParentSearchCandidates(options: {
	scopedTasks: IndexedTask[];
	candidateTasks?: IndexedTask[];
	mode?: ProjectSearchMode;
	normalizedQuery: string;
	resolvers: ProjectSearchResolvers;
	settings: Pick<OperonSettings, 'keyMappings'>;
}): ProjectSearchCandidate[] {
	const visibleTaskIds = new Set(options.scopedTasks.map(task => task.operonId));
	const candidates = buildProjectSearchCandidates(
		options.candidateTasks ?? options.scopedTasks,
		'',
		options.resolvers,
		{
			sort: 'taskFinderRank',
			visibleTaskIds,
			visibilityMode: options.mode,
			keyMappings: options.settings.keyMappings,
		},
	);
	if (!options.normalizedQuery.trim()) return candidates;
	return candidates.filter(candidate => matchesTaskSearchQueryText(
		buildParentCandidateSearchText(candidate.task),
		options.normalizedQuery,
	));
}

export function limitTableParentSearchCandidates(
	candidates: readonly ProjectSearchCandidate[],
	limit = TABLE_PARENT_SEARCH_MAX_CANDIDATES,
): { visibleCandidates: ProjectSearchCandidate[]; hiddenCount: number } {
	return limitSearchParentCandidates(candidates, limit);
}

function buildParentCandidateSearchText(task: IndexedTask): string {
	const values = new Set<string>();
	const addValue = (value: string | null | undefined): void => {
		const normalized = (value ?? '').trim();
		if (normalized) values.add(normalized.toLocaleLowerCase());
	};
	addValue(task.description);
	addValue(task.operonId);
	addValue(task.fieldValues['note']);
	for (const value of Object.values(task.fieldValues)) {
		addValue(typeof value === 'string' ? value : String(value ?? ''));
	}
	for (const tag of task.tags) addValue(tag);
	return Array.from(values).join('\n');
}

export function resolveTableParentSearchVisibleTaskIds(
	parentId: string,
	mode: ProjectSearchMode,
	scopedTasks: IndexedTask[],
	resolvers: ProjectSearchResolvers,
): Set<string> {
	return resolveProjectSearchVisibleTaskIds(parentId, mode, scopedTasks, resolvers);
}

// A transiently empty visible set (e.g. an "overdue" quick scope excluding the whole
// subtree) must not invalidate the selection — the honest result is an empty table with
// the parent chip still active. Only a project-mode mismatch drops the selection here;
// explicit user actions clear it at their own call sites.
export function resolveTableParentSearchSelection(
	selection: TableParentSearchSelection | null,
	mode: ProjectSearchMode,
): TableParentSearchSelection | null {
	return selection?.mode === mode ? selection : null;
}

export function isTableSearchScopeKeyActive(scope: TaskSearchBoxScopeState, key: TaskFinderDefaultScopeKey): boolean {
	return isTaskSearchScopeKeyActive(scope, key);
}

export function getTableSearchScopeButtonLabel(key: TaskFinderDefaultScopeKey): string {
	return getTaskSearchScopeButtonLabel(key);
}

export function syncTableSearchWrapClasses(
	searchWrap: HTMLElement,
	scope: TaskSearchBoxScopeState,
	selection: TableParentSearchSelection | null,
	rawQuery: string,
): void {
	syncSearchScopeControlWrapClasses({
		searchWrap,
		scope,
		selection,
		rawQuery,
		isDefaultScope: isDefaultTableSearchBoxScope,
		addScopePopoverClass: true,
	});
}

export function renderTableSearchIcon(searchWrap: HTMLElement): HTMLElement {
	const searchIcon = searchWrap.createSpan('operon-table-search-icon');
	searchIcon.setAttribute('aria-hidden', 'true');
	setIcon(searchIcon, 'scan-search');
	if (!searchIcon.querySelector('svg')) {
		setIcon(searchIcon, 'search');
	}
	return searchIcon;
}

export function renderTableSearchScopePopover(options: {
	searchWrap: HTMLElement;
	scope: TaskSearchBoxScopeState;
	settings: Pick<OperonSettings, 'taskFinderShortcuts' | 'taskFinderRecentModifiedDays'>;
	selectedParent: TableParentSearchSelection | null;
	onToggle: (key: TaskFinderDefaultScopeKey) => void;
	onClearParent: () => void;
	onRefocus: () => void;
}): void {
	renderSearchScopePopover({
		searchWrap: options.searchWrap,
		scope: options.scope,
		settings: options.settings,
		selectedParent: options.selectedParent,
		classNames: TABLE_SEARCH_SCOPE_CONTROL_CLASSES,
		groups: TABLE_SEARCH_SCOPE_GROUPS,
		disabledKeys: TABLE_SEARCH_BOX_DISABLED_KEYS,
		unavailableTooltip: t('table', 'searchScopeUnavailable'),
		onToggle: options.onToggle,
		onClearParent: options.onClearParent,
		onRefocus: options.onRefocus,
		selectedParentClearControl: { kind: 'icon', icon: 'x' },
		stopClearPropagation: true,
	});
}

export function renderTableParentSearchDropdown(options: {
	searchWrap: HTMLElement;
	parentSearchUi: TableParentSearchUiState | null;
	highlightedIndex: number;
	onSelect: (candidate: ProjectSearchCandidate) => void;
}): void {
	renderParentSearchDropdown({
		searchWrap: options.searchWrap,
		parentSearchUi: options.parentSearchUi,
		highlightedIndex: options.highlightedIndex,
		classNames: TABLE_SEARCH_SCOPE_CONTROL_CLASSES,
		candidateLimit: TABLE_PARENT_SEARCH_MAX_CANDIDATES,
		noParentsText: t('notifications', 'kanbanParentSearchNoParents'),
		hiddenCountText: hiddenCount => t('table', 'parentSearchMoreResults', { count: hiddenCount.toLocaleString() }),
		onSelect: options.onSelect,
	});
}
