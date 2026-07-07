import { localToday } from '../core/local-time';
import { t } from '../core/i18n';
import { ProjectSearchMode } from '../systems/task-search';
import { IndexedTask } from '../types/fields';
import { OperonSettings, TaskFinderDefaultScopeKey, TaskFinderShortcutItem } from '../types/settings';

export interface TaskSearchBoxScopeState {
	projectMode: ProjectSearchMode | null;
	showOverdue: boolean;
	showHappensToday: boolean;
	showRecentModified: boolean;
	includeInline: boolean;
	includeFile: boolean;
	includeCancelled: boolean;
	includeFinished: boolean;
}

export interface TaskSearchBoxShortcutCommand {
	key: TaskFinderDefaultScopeKey;
	start: number;
	end: number;
	shortcut: string;
}

export interface TaskSearchBoxShortcutApplication {
	handled: boolean;
	query: string;
	scope: TaskSearchBoxScopeState;
	command: TaskSearchBoxShortcutCommand | null;
	disabled: boolean;
}

export const TASK_SEARCH_BOX_DEFAULT_SCOPE: TaskSearchBoxScopeState = {
	projectMode: null,
	showOverdue: false,
	showHappensToday: false,
	showRecentModified: false,
	includeInline: true,
	includeFile: true,
	includeCancelled: true,
	includeFinished: true,
};

export const KANBAN_SEARCH_BOX_DEFAULT_SCOPE: TaskSearchBoxScopeState = {
	...TASK_SEARCH_BOX_DEFAULT_SCOPE,
};

export function cloneTaskSearchBoxScopeState(scope: TaskSearchBoxScopeState): TaskSearchBoxScopeState {
	return { ...scope };
}

export function createTaskSearchBoxScopeState(
	overrides: Partial<TaskSearchBoxScopeState> = {},
): TaskSearchBoxScopeState {
	return {
		projectMode: overrides.projectMode ?? null,
		showOverdue: overrides.showOverdue ?? false,
		showHappensToday: overrides.showHappensToday ?? false,
		showRecentModified: overrides.showRecentModified ?? false,
		includeInline: overrides.includeInline ?? true,
		includeFile: overrides.includeFile ?? true,
		includeCancelled: overrides.includeCancelled ?? true,
		includeFinished: overrides.includeFinished ?? true,
	};
}

export function applyTaskSearchBoxShortcutCommand(
	rawQuery: string,
	scope: TaskSearchBoxScopeState,
	settings: Pick<OperonSettings, 'taskFinderShortcuts'>,
	options: {
		disabledKeys?: Iterable<TaskFinderDefaultScopeKey>;
		preserveTerminalStateScopes?: boolean;
	} = {},
): TaskSearchBoxShortcutApplication {
	const command = findTaskSearchBoxShortcutCommand(rawQuery, settings.taskFinderShortcuts ?? []);
	if (!command) {
		return {
			handled: false,
			query: rawQuery,
			scope,
			command: null,
			disabled: false,
		};
	}

	const nextQuery = removeTaskSearchBoxShortcutToken(rawQuery, command.start, command.end);
	const disabledKeys = new Set(options.disabledKeys ?? []);
	if (disabledKeys.has(command.key)) {
		return {
			handled: true,
			query: nextQuery,
			scope,
			command,
			disabled: true,
		};
	}

	return {
		handled: true,
		query: nextQuery,
		scope: toggleTaskSearchBoxScope(scope, command.key, {
			preserveTerminalStateScopes: options.preserveTerminalStateScopes,
		}),
		command,
		disabled: false,
	};
}

export function findTaskSearchBoxShortcutCommand(
	rawQuery: string,
	shortcuts: TaskFinderShortcutItem[],
): TaskSearchBoxShortcutCommand | null {
	const configured = shortcuts
		.map(item => ({ key: item.key, shortcut: item.shortcut.trim().toLocaleLowerCase() }))
		.filter((item): item is { key: TaskFinderDefaultScopeKey; shortcut: string } => /^[a-z0-9]{1,3}$/u.test(item.shortcut))
		.sort((left, right) => right.shortcut.length - left.shortcut.length);
	if (configured.length === 0) return null;

	const lowerQuery = rawQuery.toLocaleLowerCase();
	for (const item of configured) {
		const needle = `.${item.shortcut}`;
		let searchIndex = 0;
		while (searchIndex < lowerQuery.length) {
			const index = lowerQuery.indexOf(needle, searchIndex);
			if (index === -1) break;
			const previous = index === 0 ? '' : lowerQuery[index - 1];
			if (index === 0 || /\s/u.test(previous)) {
				return {
					key: item.key,
					start: index,
					end: index + needle.length,
					shortcut: item.shortcut,
				};
			}
			searchIndex = index + needle.length;
		}
	}
	return null;
}

export function removeTaskSearchBoxShortcutToken(rawQuery: string, start: number, end: number): string {
	const before = rawQuery.slice(0, start).replace(/\s+$/u, '');
	const after = rawQuery.slice(end).replace(/^\s+/u, '');
	return [before, after].filter(Boolean).join(' ');
}

export function resolveTaskSearchBoxTextQuery(rawQuery: string, minLength: number): string {
	const query = rawQuery.trim();
	return query.length >= minLength ? query : '';
}

export function toggleTaskSearchBoxScope(
	scope: TaskSearchBoxScopeState,
	key: TaskFinderDefaultScopeKey,
	options: {
		preserveTerminalStateScopes?: boolean;
	} = {},
): TaskSearchBoxScopeState {
	const next = cloneTaskSearchBoxScopeState(scope);
	switch (key) {
		case 'projectTasks':
			next.projectMode = next.projectMode === 'pc' ? null : 'pc';
			return next;
		case 'projectTree':
			next.projectMode = next.projectMode === 'pt' ? null : 'pt';
			return next;
		case 'overdue': {
			const enabled = !next.showOverdue;
			next.showOverdue = enabled;
			if (enabled) {
				next.showHappensToday = false;
				if (!options.preserveTerminalStateScopes) {
					next.includeCancelled = false;
					next.includeFinished = false;
				}
			}
			return next;
		}
		case 'happensToday': {
			const enabled = !next.showHappensToday;
			next.showHappensToday = enabled;
			if (enabled) {
				next.showOverdue = false;
				if (!options.preserveTerminalStateScopes) {
					next.includeCancelled = false;
					next.includeFinished = false;
				}
			}
			return next;
		}
		case 'recentModified':
			next.showRecentModified = !next.showRecentModified;
			return next;
		case 'includeInline':
			if (next.includeInline && !next.includeFile) return next;
			next.includeInline = !next.includeInline;
			return next;
		case 'includeFile':
			if (next.includeFile && !next.includeInline) return next;
			next.includeFile = !next.includeFile;
			return next;
		case 'includeCancelled':
			if (!next.includeCancelled && !options.preserveTerminalStateScopes) {
				next.showOverdue = false;
				next.showHappensToday = false;
			}
			next.includeCancelled = !next.includeCancelled;
			return next;
		case 'includeFinished':
			if (!next.includeFinished && !options.preserveTerminalStateScopes) {
				next.showOverdue = false;
				next.showHappensToday = false;
			}
			next.includeFinished = !next.includeFinished;
			return next;
	}
}

export function getTaskSearchBoxShortcutLabel(
	settings: Pick<OperonSettings, 'taskFinderShortcuts'>,
	key: TaskFinderDefaultScopeKey,
): string {
	const shortcut = settings.taskFinderShortcuts.find(item => item.key === key)?.shortcut ?? '';
	return shortcut ? `.${shortcut}` : '';
}

export function getTaskSearchBoxScopeButtonTooltipContent(
	key: TaskFinderDefaultScopeKey,
	scope: TaskSearchBoxScopeState,
	settings: Pick<OperonSettings, 'taskFinderRecentModifiedDays'>,
): string {
	switch (key) {
		case 'projectTasks':
			return t('modals', 'taskFinderProjectTasksTooltip');
		case 'projectTree':
			return t('modals', 'taskFinderProjectTreeTooltip');
		case 'overdue':
			return t('modals', 'taskFinderOverdueTooltip');
		case 'happensToday':
			return t('modals', 'taskFinderHappensTodayTooltip');
		case 'recentModified':
			return t('modals', 'taskFinderRecentModifiedTooltip', {
				period: getTaskSearchBoxRecentModifiedPeriodText(settings),
			});
		case 'includeInline':
			return t('modals', scope.includeInline ? 'taskFinderIncludeInlineTooltipActive' : 'taskFinderIncludeInlineTooltipInactive');
		case 'includeFile':
			return t('modals', scope.includeFile ? 'taskFinderIncludeFileTooltipActive' : 'taskFinderIncludeFileTooltipInactive');
		case 'includeCancelled':
			return t('modals', 'taskFinderIncludeCancelledTooltip');
		case 'includeFinished':
			return t('modals', 'taskFinderIncludeFinishedTooltip');
	}
}

export function getTaskSearchBoxRecentModifiedDays(settings: Pick<OperonSettings, 'taskFinderRecentModifiedDays'>): number {
	return Math.max(1, Math.min(7, Math.round(settings.taskFinderRecentModifiedDays || 3)));
}

export function getTaskSearchBoxRecentModifiedCutoff(
	settings: Pick<OperonSettings, 'taskFinderRecentModifiedDays'>,
	now = Date.now(),
): number {
	return now - getTaskSearchBoxRecentModifiedDays(settings) * 24 * 60 * 60 * 1000;
}

function getTaskSearchBoxRecentModifiedPeriodText(settings: Pick<OperonSettings, 'taskFinderRecentModifiedDays'>): string {
	const days = getTaskSearchBoxRecentModifiedDays(settings);
	if (days === 1) return t('modals', 'taskFinderRecentModifiedPeriodOne');
	return t('modals', 'taskFinderRecentModifiedPeriodMany', { days: String(days) });
}

export function isDefaultKanbanSearchBoxScope(scope: TaskSearchBoxScopeState): boolean {
	return areTaskSearchBoxScopesEqual(scope, KANBAN_SEARCH_BOX_DEFAULT_SCOPE);
}

export function areTaskSearchBoxScopesEqual(
	left: TaskSearchBoxScopeState,
	right: TaskSearchBoxScopeState,
): boolean {
	return left.projectMode === right.projectMode
		&& left.showOverdue === right.showOverdue
		&& left.showHappensToday === right.showHappensToday
		&& left.showRecentModified === right.showRecentModified
		&& left.includeInline === right.includeInline
		&& left.includeFile === right.includeFile
		&& left.includeCancelled === right.includeCancelled
		&& left.includeFinished === right.includeFinished;
}

export function matchesTaskSearchBoxScope(
	task: IndexedTask,
	scope: TaskSearchBoxScopeState,
	options: {
		recentModifiedCutoff?: number;
	} = {},
): boolean {
	if (scope.showOverdue && !getTaskOverdueDate(task)) return false;
	if (scope.showHappensToday && !getTaskHappensTodayPriority(task)) return false;
	if (scope.showRecentModified && getTaskModifiedTime(task) < (options.recentModifiedCutoff ?? 0)) return false;
	if (task.primary.format === 'inline' && !scope.includeInline) return false;
	if (task.primary.format === 'yaml' && !scope.includeFile) return false;
	if (task.checkbox === 'open') return true;
	if (scope.includeFinished && task.checkbox === 'done') return true;
	if (scope.includeCancelled && task.checkbox === 'cancelled') return true;
	return false;
}

export function getTaskModifiedTime(task: IndexedTask): number {
	return Date.parse(task.datetimeModified || task.fieldValues['datetimeModified'] || '') || 0;
}

export function getTaskOverdueDate(task: IndexedTask): string | null {
	const today = localToday();
	const scheduled = (task.fieldValues['dateScheduled'] ?? '').trim();
	const due = (task.fieldValues['dateDue'] ?? '').trim();
	const overdueDates = [scheduled, due].filter(value => isPastDateKey(value, today));
	if (overdueDates.length === 0) return null;
	return overdueDates.sort((left, right) => left.localeCompare(right))[0] ?? null;
}

export function getTaskHappensTodayPriority(task: IndexedTask): number {
	const due = (task.fieldValues['dateDue'] ?? '').trim();
	if (isTodayDateKey(due)) return 1;
	const scheduled = (task.fieldValues['dateScheduled'] ?? '').trim();
	if (isTodayDateKey(scheduled)) return 2;
	const started = (task.fieldValues['dateStarted'] ?? '').trim();
	if (isTodayDateKey(started)) return 3;
	return 0;
}

export function getTaskFinderPriorityRank(
	task: IndexedTask,
	priorityRank: Map<string, number>,
): number {
	const value = (task.fieldValues['priority'] ?? '').trim().toLocaleLowerCase();
	return value ? (priorityRank.get(value) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

function isPastDateKey(value: string, today: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && value < today;
}

function isTodayDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && value === localToday();
}
