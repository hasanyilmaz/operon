import { t } from './i18n';
import { parseLocalDatetime, parseTrackerList, splitTrackerRangeByMidnight } from '../systems/tracker-utils';

export type ContextualMenuActionId =
	| 'taskStatus'
	| 'pinToggle'
	| 'openEditor'
	| 'convertInlineToFileTask'
	| 'convertFileToInlineTask'
	| 'subtasks'
	| 'createSubtask'
	| 'checkboxes'
	| 'startTimer'
	| 'markDone'
	| 'cancelTask'
	| 'unschedule'
	| 'jumpToSource'
	| 'setAsTracked'
	| 'clearDueDate'
	| 'skipThisOccurrence';

export type ContextualMenuSurface =
	| 'readingRow'
	| 'livePreviewTask'
	| 'taskWikilinkOverlay'
	| 'pinnedTask'
	| 'trackerTask'
	| 'flowTimeTask'
	| 'filterTask'
	| 'tableTask'
	| 'kanbanCard'
	| 'calendarTimedItem'
	| 'calendarAllDayScheduledItem'
	| 'calendarDueMarker'
	| 'calendarFinishedMarker'
	| 'calendarSidebarTaskPoolTask'
	| 'calendarProjectedOccurrence'
	| 'calendarExternalItem';

export type ContextualMenuSurfaceActionMatrix = Partial<Record<ContextualMenuSurface, ContextualMenuActionId[]>>;

export const CONTEXTUAL_MENU_SURFACES: ContextualMenuSurface[] = [
	'readingRow',
	'livePreviewTask',
	'taskWikilinkOverlay',
	'pinnedTask',
	'trackerTask',
	'flowTimeTask',
	'filterTask',
	'tableTask',
	'kanbanCard',
	'calendarTimedItem',
	'calendarAllDayScheduledItem',
	'calendarDueMarker',
	'calendarFinishedMarker',
	'calendarSidebarTaskPoolTask',
	'calendarProjectedOccurrence',
	'calendarExternalItem',
];

export interface ContextualMenuSurfaceGroup {
	id: string;
	labelKey: string;
	surfaces: ContextualMenuSurface[];
}

export const CONTEXTUAL_MENU_SURFACE_GROUPS: ContextualMenuSurfaceGroup[] = [
	{
		id: 'taskLists',
		labelKey: 'contextualMenuSurfaceGroupTaskLists',
		surfaces: ['filterTask', 'calendarSidebarTaskPoolTask'],
	},
	{
		id: 'noteSurfaces',
		labelKey: 'contextualMenuSurfaceGroupNoteSurfaces',
		surfaces: ['livePreviewTask', 'readingRow', 'taskWikilinkOverlay'],
	},
	{
		id: 'planningBoards',
		labelKey: 'contextualMenuSurfaceGroupPlanningBoards',
		surfaces: ['kanbanCard', 'tableTask', 'pinnedTask'],
	},
	{
		id: 'timeTracking',
		labelKey: 'contextualMenuSurfaceGroupTimeTracking',
		surfaces: ['trackerTask', 'flowTimeTask', 'calendarTimedItem'],
	},
	{
		id: 'calendar',
		labelKey: 'contextualMenuSurfaceGroupCalendar',
		surfaces: ['calendarAllDayScheduledItem', 'calendarDueMarker', 'calendarFinishedMarker'],
	},
	{
		id: 'recurrence',
		labelKey: 'contextualMenuSurfaceGroupRecurrence',
		surfaces: ['calendarProjectedOccurrence'],
	},
	{
		id: 'external',
		labelKey: 'contextualMenuSurfaceGroupExternal',
		surfaces: ['calendarExternalItem'],
	},
];

export const CONFIGURABLE_CONTEXTUAL_MENU_SURFACE_GROUPS: ContextualMenuSurfaceGroup[] = CONTEXTUAL_MENU_SURFACE_GROUPS
	.map(group => ({
		...group,
		surfaces: group.surfaces.filter(surface =>
			surface !== 'calendarProjectedOccurrence'
			&& surface !== 'calendarExternalItem'),
	}))
	.filter(group => group.surfaces.length > 0);

export const CONTEXTUAL_MENU_SURFACE_LABEL_KEYS: Record<ContextualMenuSurface, string> = {
	readingRow: 'contextualMenuSurfaceReadingRow',
	livePreviewTask: 'contextualMenuSurfaceLivePreviewTask',
	taskWikilinkOverlay: 'contextualMenuSurfaceTaskWikilinkOverlay',
	pinnedTask: 'contextualMenuSurfacePinnedTask',
	trackerTask: 'contextualMenuSurfaceTrackerTask',
	flowTimeTask: 'contextualMenuSurfaceFlowTimeTask',
	filterTask: 'contextualMenuSurfaceFilterTask',
	tableTask: 'contextualMenuSurfaceTableTask',
	kanbanCard: 'contextualMenuSurfaceKanbanCard',
	calendarTimedItem: 'contextualMenuSurfaceCalendarTimedItem',
	calendarAllDayScheduledItem: 'contextualMenuSurfaceCalendarAllDayScheduledItem',
	calendarDueMarker: 'contextualMenuSurfaceCalendarDueMarker',
	calendarFinishedMarker: 'contextualMenuSurfaceCalendarFinishedMarker',
	calendarSidebarTaskPoolTask: 'contextualMenuSurfaceCalendarSidebarTaskPoolTask',
	calendarProjectedOccurrence: 'contextualMenuSurfaceCalendarProjectedOccurrence',
	calendarExternalItem: 'contextualMenuSurfaceCalendarExternalItem',
};

export interface ContextualMenuActionDefinition {
	id: ContextualMenuActionId;
	labelKey: string;
	compactLabel: string;
	descriptionKey: string;
	icon: string;
}

export interface ResolvedContextualMenuAction extends ContextualMenuActionDefinition {
	label: string;
	description: string;
}

export interface ContextualTaskActionSource {
	checkbox: 'open' | 'done' | 'cancelled';
	fieldValues: Record<string, string>;
	sourceFormat?: 'inline' | 'yaml';
	primary?: {
		format?: 'inline' | 'yaml';
	};
}

export interface ContextualMenuRepeatRef {
	seriesId: string;
	occurrenceDate: string;
	isLatestMaterialized: boolean;
	isProjected: boolean;
	projectionKind?: 'scheduled' | 'doneRolling';
}

export interface ContextualMenuCalendarItemSource {
	kind: 'timed' | 'allDayScheduled' | 'dueMarker' | 'finishedMarker';
	origin: 'materialized' | 'projected' | 'external';
	sourceTask: ContextualTaskActionSource | null;
	renderSnapshot: {
		checkbox: ContextualTaskActionSource['checkbox'];
		fieldValues: Record<string, string>;
		tags: string[];
	};
	repeatRef: ContextualMenuRepeatRef | null;
	startDateTime: string | null;
	endDateTime: string | null;
}

export interface ContextualMenuProjectedRef {
	seriesId: string;
	occurrenceDate: string;
	projectionKind?: 'scheduled' | 'doneRolling';
}

export interface ContextualMenuContext {
	surface: ContextualMenuSurface;
	taskId: string;
	task: ContextualTaskActionSource | null;
	now: string;
	isPinned?: boolean;
	hasSubtasks?: boolean;
	calendarItem?: ContextualMenuCalendarItemSource | null;
	projectedRef?: ContextualMenuProjectedRef | null;
}

export type ContextualMenuActionHandler = (
	taskId: string,
	actionId: ContextualMenuActionId,
	context?: ContextualMenuContext,
	invocation?: ContextualMenuActionInvocation,
) => void | Promise<void>;

export interface ContextualMenuActionInvocation {
	actionAnchor?: HTMLElement | null;
	actionAnchorRect?: DOMRect | null;
}

export interface ContextualMenuExecutionDeps {
	cycleStatus: (taskId: string) => void | Promise<void>;
	togglePin: (taskId: string) => void | Promise<void>;
	openEditor: (taskId: string) => void | Promise<void>;
	openSubtasks: (taskId: string) => void | Promise<void>;
	createSubtask: (taskId: string) => void | Promise<void>;
	openCheckboxes: (
		taskId: string,
		actionAnchor?: HTMLElement | null,
		actionAnchorRect?: DOMRect | null,
	) => void | Promise<void>;
	startTimer: (taskId: string) => void | Promise<void>;
	markDone: (taskId: string) => void | Promise<void>;
	cancelTask: (taskId: string) => void | Promise<void>;
	unschedule: (taskId: string) => void | Promise<void>;
	jumpToSource: (taskId: string) => void | Promise<void>;
	setAsTracked: (taskId: string, start: string, end: string) => void | Promise<void>;
	clearDueDate: (taskId: string) => void | Promise<void>;
	openProjectedOccurrenceLatestTaskEditor: (projected: ContextualMenuProjectedRef) => void | Promise<void>;
	skipProjectedOccurrence: (projected: ContextualMenuProjectedRef) => void | Promise<void>;
	convertInlineToFileTask: (taskId: string) => void | Promise<void>;
	convertFileToInlineTask: (taskId: string) => void | Promise<void>;
}

export const CONTEXTUAL_MENU_ACTIONS: ContextualMenuActionDefinition[] = [
	{
		id: 'taskStatus',
		labelKey: 'contextualMenuActionTaskStatus',
		compactLabel: 'St',
		descriptionKey: 'contextualMenuActionTaskStatusDesc',
		icon: 'kanban-square',
	},
	{
		id: 'pinToggle',
		labelKey: 'contextualMenuActionPinToggle',
		compactLabel: 'Pn',
		descriptionKey: 'contextualMenuActionPinToggleDesc',
		icon: 'pin',
	},
	{
		id: 'openEditor',
		labelKey: 'contextualMenuActionOpenEditor',
		compactLabel: 'Ed',
		descriptionKey: 'contextualMenuActionOpenEditorDesc',
		icon: 'square-pen',
	},
	{
		id: 'convertInlineToFileTask',
		labelKey: 'contextualMenuActionConvertInlineToFileTask',
		compactLabel: 'File',
		descriptionKey: 'contextualMenuActionConvertInlineToFileTaskDesc',
		icon: 'list-chevrons-up-down',
	},
	{
		id: 'convertFileToInlineTask',
		labelKey: 'contextualMenuActionConvertFileToInlineTask',
		compactLabel: 'Inl',
		descriptionKey: 'contextualMenuActionConvertFileToInlineTaskDesc',
		icon: 'list-chevrons-down-up',
	},
	{
		id: 'subtasks',
		labelKey: 'contextualMenuActionSubtasks',
		compactLabel: 'Sub',
		descriptionKey: 'contextualMenuActionSubtasksDesc',
		icon: 'list-tree',
	},
	{
		id: 'createSubtask',
		labelKey: 'contextualMenuActionCreateSubtask',
		compactLabel: 'Sb',
		descriptionKey: 'contextualMenuActionCreateSubtaskDesc',
		icon: 'list-plus',
	},
	{
		id: 'checkboxes',
		labelKey: 'contextualMenuActionCheckboxes',
		compactLabel: 'Cb',
		descriptionKey: 'contextualMenuActionCheckboxesDesc',
		icon: 'layout-list',
	},
	{
		id: 'startTimer',
		labelKey: 'contextualMenuActionStartTimer',
		compactLabel: 'Tr',
		descriptionKey: 'contextualMenuActionStartTimerDesc',
		icon: 'timer',
	},
	{
		id: 'markDone',
		labelKey: 'contextualMenuActionMarkDone',
		compactLabel: 'Dn',
		descriptionKey: 'contextualMenuActionMarkDoneDesc',
		icon: 'check',
	},
	{
		id: 'cancelTask',
		labelKey: 'contextualMenuActionCancelTask',
		compactLabel: 'Cn',
		descriptionKey: 'contextualMenuActionCancelTaskDesc',
		icon: 'ban',
	},
	{
		id: 'unschedule',
		labelKey: 'contextualMenuActionUnschedule',
		compactLabel: 'Un',
		descriptionKey: 'contextualMenuActionUnscheduleDesc',
		icon: 'calendar-x',
	},
	{
		id: 'jumpToSource',
		labelKey: 'contextualMenuActionJumpToSource',
		compactLabel: 'Go',
		descriptionKey: 'contextualMenuActionJumpToSourceDesc',
		icon: 'arrow-up-right',
	},
	{
		id: 'setAsTracked',
		labelKey: 'contextualMenuActionSetAsTracked',
		compactLabel: 'Lg',
		descriptionKey: 'contextualMenuActionSetAsTrackedDesc',
		icon: 'history',
	},
	{
		id: 'clearDueDate',
		labelKey: 'contextualMenuActionClearDueDate',
		compactLabel: 'Cd',
		descriptionKey: 'contextualMenuActionClearDueDateDesc',
		icon: 'calendar-minus',
	},
	{
		id: 'skipThisOccurrence',
		labelKey: 'contextualMenuActionSkipThisOccurrence',
		compactLabel: 'Sk',
		descriptionKey: 'contextualMenuActionSkipThisOccurrenceDesc',
		icon: 'skip-forward',
	},
];

export const CONFIGURABLE_CONTEXTUAL_MENU_ACTIONS: ContextualMenuActionDefinition[] = CONTEXTUAL_MENU_ACTIONS
	.filter(action => action.id !== 'skipThisOccurrence');

const DUE_MARKER_ALLOWED_ACTIONS = new Set<ContextualMenuActionId>([
	'taskStatus',
	'pinToggle',
	'openEditor',
	'convertInlineToFileTask',
	'convertFileToInlineTask',
	'subtasks',
	'createSubtask',
	'checkboxes',
	'startTimer',
	'markDone',
	'cancelTask',
	'jumpToSource',
	'clearDueDate',
]);

export function getContextualMenuActionLabel(action: Pick<ContextualMenuActionDefinition, 'labelKey'>): string {
	return t('settings', action.labelKey);
}

export function getContextualMenuActionDescription(action: Pick<ContextualMenuActionDefinition, 'descriptionKey'>): string {
	return t('settings', action.descriptionKey);
}

export function resolveContextualMenu(
	context: ContextualMenuContext,
	allowlist: ContextualMenuActionId[],
	surfaceActionMatrix?: ContextualMenuSurfaceActionMatrix,
): ResolvedContextualMenuAction[] {
	if (context.surface === 'calendarProjectedOccurrence') {
		return resolveActionsForIds(context, ['skipThisOccurrence']);
	}
	const matrixActionIds = getMatrixActionIds(context.surface, allowlist, surfaceActionMatrix);
	const actionIds = getSurfaceActionIds(context, matrixActionIds);
	return resolveActionsForIds(context, actionIds);
}

function resolveActionsForIds(
	context: ContextualMenuContext,
	actionIds: ContextualMenuActionId[],
): ResolvedContextualMenuAction[] {
	return actionIds
		.filter(actionId => isContextualMenuActionAvailable(actionId, context))
		.map(actionId => CONTEXTUAL_MENU_ACTIONS.find(action => action.id === actionId))
		.filter((action): action is ContextualMenuActionDefinition => !!action)
		.map(action => ({
			...action,
			label: resolveContextualMenuActionLabel(action, context),
			description: resolveContextualMenuActionDescription(action, context),
		}));
}

export function getContextualMenuSurfaceForCalendarItem(
	item: ContextualMenuCalendarItemSource,
): ContextualMenuSurface {
	if (item.origin === 'external') return 'calendarExternalItem';
	if (item.origin === 'projected') return 'calendarProjectedOccurrence';
	if (item.kind === 'timed') return 'calendarTimedItem';
	if (item.kind === 'allDayScheduled') return 'calendarAllDayScheduledItem';
	if (item.kind === 'dueMarker') return 'calendarDueMarker';
	return 'calendarFinishedMarker';
}

export async function executeContextualMenuAction(
	context: ContextualMenuContext,
	actionId: ContextualMenuActionId,
	deps: ContextualMenuExecutionDeps,
	invocation?: ContextualMenuActionInvocation,
): Promise<void> {
	if (actionId === 'skipThisOccurrence') {
		if (context.projectedRef) {
			await deps.skipProjectedOccurrence(context.projectedRef);
		}
		return;
	}

	if (actionId === 'openEditor' && context.projectedRef) {
		await deps.openProjectedOccurrenceLatestTaskEditor(context.projectedRef);
		return;
	}

	switch (actionId) {
		case 'taskStatus':
			await deps.cycleStatus(context.taskId);
			return;
		case 'pinToggle':
			await deps.togglePin(context.taskId);
			return;
		case 'openEditor':
			await deps.openEditor(context.taskId);
			return;
		case 'convertInlineToFileTask':
			if (getTaskSourceFormat(context) !== 'inline') return;
			await deps.convertInlineToFileTask(context.taskId);
			return;
		case 'convertFileToInlineTask':
			if (getTaskSourceFormat(context) !== 'yaml') return;
			await deps.convertFileToInlineTask(context.taskId);
			return;
		case 'subtasks':
			if (context.task?.checkbox !== 'open' || context.hasSubtasks !== true) return;
			await deps.openSubtasks(context.taskId);
			return;
		case 'createSubtask':
			if (context.task?.checkbox !== 'open') return;
			await deps.createSubtask(context.taskId);
			return;
		case 'checkboxes':
			if (context.task?.checkbox !== 'open') return;
			await deps.openCheckboxes(context.taskId, invocation?.actionAnchor, invocation?.actionAnchorRect);
			return;
		case 'startTimer':
			if (context.task?.checkbox !== 'open') return;
			await deps.startTimer(context.taskId);
			return;
		case 'markDone':
			if (context.task?.checkbox !== 'open') return;
			await deps.markDone(context.taskId);
			return;
		case 'cancelTask':
			if (context.task?.checkbox !== 'open') return;
			await deps.cancelTask(context.taskId);
			return;
		case 'unschedule':
			await deps.unschedule(context.taskId);
			return;
		case 'jumpToSource':
			await deps.jumpToSource(context.taskId);
			return;
		case 'setAsTracked': {
			const range = getTrackedRange(context);
			if (!range) return;
			await deps.setAsTracked(context.taskId, range.start, range.end);
			return;
		}
		case 'clearDueDate':
			if (!getDueValue(context)) return;
			await deps.clearDueDate(context.taskId);
			return;
	}
}

function resolveContextualMenuActionLabel(
	action: ContextualMenuActionDefinition,
	context: ContextualMenuContext,
): string {
	if (action.id === 'taskStatus') {
		const statusValue = (context.task?.fieldValues['status'] ?? '').trim();
		if (statusValue) return statusValue;
	}
	if (action.id === 'pinToggle') {
		return context.isPinned ? t('buttons', 'unpin') : t('buttons', 'pin');
	}
	if (action.id === 'setAsTracked' && context.surface === 'calendarTimedItem') {
		return t('settings', 'contextualMenuActionSetAsTrackedCalendarTimed');
	}
	return getContextualMenuActionLabel(action);
}

function resolveContextualMenuActionDescription(
	action: ContextualMenuActionDefinition,
	context: ContextualMenuContext,
): string {
	if (action.id === 'setAsTracked' && context.surface === 'calendarTimedItem') {
		return t('settings', 'contextualMenuActionSetAsTrackedCalendarTimedDesc');
	}
	return getContextualMenuActionDescription(action);
}

function getSurfaceActionIds(
	context: ContextualMenuContext,
	allowlist: ContextualMenuActionId[],
): ContextualMenuActionId[] {
	return allowlist.filter(actionId => isContextualMenuActionSupportedOnSurface(context.surface, actionId));
}

export function isContextualMenuActionSupportedOnSurface(
	surface: ContextualMenuSurface,
	actionId: ContextualMenuActionId,
): boolean {
	if (actionId === 'setAsTracked' && (
		surface === 'trackerTask'
		|| surface === 'flowTimeTask'
		|| surface === 'calendarAllDayScheduledItem'
		|| surface === 'calendarFinishedMarker'
		|| surface === 'calendarSidebarTaskPoolTask'
	)) {
		return false;
	}
	if (actionId === 'cancelTask' && surface === 'calendarFinishedMarker') {
		return false;
	}
	switch (surface) {
		case 'calendarExternalItem':
			return false;
		case 'calendarProjectedOccurrence':
			return actionId === 'skipThisOccurrence';
		case 'calendarDueMarker':
			return DUE_MARKER_ALLOWED_ACTIONS.has(actionId);
		default:
			return true;
	}
}

function getMatrixActionIds(
	surface: ContextualMenuSurface,
	allowlist: ContextualMenuActionId[],
	surfaceActionMatrix?: ContextualMenuSurfaceActionMatrix,
): ContextualMenuActionId[] {
	const surfaceAllowlist = surfaceActionMatrix?.[surface];
	if (!Array.isArray(surfaceAllowlist)) return [...allowlist];
	return allowlist.filter(actionId => surfaceAllowlist.includes(actionId));
}

function isContextualMenuActionAvailable(
	actionId: ContextualMenuActionId,
	context: ContextualMenuContext,
): boolean {
	const task = context.task;

	if (
		(actionId === 'markDone'
			|| actionId === 'startTimer'
			|| actionId === 'cancelTask'
			|| actionId === 'createSubtask'
			|| actionId === 'checkboxes')
		&& task?.checkbox !== 'open'
	) {
		return false;
	}
	if (actionId === 'subtasks') {
		return task?.checkbox === 'open' && context.hasSubtasks === true;
	}
	if (actionId === 'unschedule') {
		return hasSchedule(context);
	}
	if (actionId === 'setAsTracked') {
		const range = getTrackedRange(context);
		if (!range || range.end > context.now) return false;
		return !hasTrackedCoverageForScheduledRange(getTrackerValue(context), range.start, range.end);
	}
	if (actionId === 'convertInlineToFileTask') {
		return getTaskSourceFormat(context) === 'inline';
	}
	if (actionId === 'convertFileToInlineTask') {
		return getTaskSourceFormat(context) === 'yaml';
	}
	if (actionId === 'skipThisOccurrence') {
		return context.surface === 'calendarProjectedOccurrence'
			&& !!context.projectedRef
			&& !isDoneRollingProjectedContext(context);
	}
	if (actionId === 'clearDueDate') {
		return getDueValue(context).length > 0;
	}
	return true;
}

function getTaskSourceFormat(context: ContextualMenuContext): 'inline' | 'yaml' | null {
	return context.task?.sourceFormat
		?? context.task?.primary?.format
		?? context.calendarItem?.sourceTask?.sourceFormat
		?? context.calendarItem?.sourceTask?.primary?.format
		?? null;
}

function isDoneRollingProjectedContext(context: ContextualMenuContext): boolean {
	return context.calendarItem?.repeatRef?.projectionKind === 'doneRolling'
		|| context.projectedRef?.projectionKind === 'doneRolling';
}

function hasSchedule(context: ContextualMenuContext): boolean {
	const fieldValues = getFieldValues(context);
	return getDueValue(context).length > 0
		|| (fieldValues['dateScheduled'] ?? '').trim().length > 0
		|| getStartDateTime(context).length > 0
		|| getEndDateTime(context).length > 0;
}

function getTrackedRange(context: ContextualMenuContext): { start: string; end: string } | null {
	const fieldRange = getTaskFieldDateTimeRange(context);
	if (fieldRange) return fieldRange;
	const start = getStartDateTime(context);
	const end = getEndDateTime(context);
	if (!start || !end) return null;
	return { start, end };
}

function getTaskFieldDateTimeRange(context: ContextualMenuContext): { start: string; end: string } | null {
	const fieldValues = getFieldValues(context);
	const start = (fieldValues['datetimeStart'] ?? '').trim();
	const end = (fieldValues['datetimeEnd'] ?? '').trim();
	if (!start || !end) return null;
	return { start, end };
}

function getFieldValues(context: ContextualMenuContext): Record<string, string> {
	if (context.task) return context.task.fieldValues;
	if (context.calendarItem?.sourceTask) return context.calendarItem.sourceTask.fieldValues;
	return context.calendarItem?.renderSnapshot.fieldValues ?? {};
}

function getDueValue(context: ContextualMenuContext): string {
	return (getFieldValues(context)['dateDue'] ?? '').trim();
}

function getTrackerValue(context: ContextualMenuContext): string {
	return (getFieldValues(context)['trackers'] ?? '').trim();
}

function getStartDateTime(context: ContextualMenuContext): string {
	if (context.calendarItem?.startDateTime) return context.calendarItem.startDateTime.trim();
	return (getFieldValues(context)['datetimeStart'] ?? '').trim();
}

function getEndDateTime(context: ContextualMenuContext): string {
	if (context.calendarItem?.endDateTime) return context.calendarItem.endDateTime.trim();
	return (getFieldValues(context)['datetimeEnd'] ?? '').trim();
}

function hasTrackedCoverageForScheduledRange(trackers: string, start: string, end: string): boolean {
	if (!trackers || !start || !end) return false;
	const existingSessions = parseTrackerList(trackers);
	const neededRanges = splitTrackerRangeByMidnight(start, end)
		.map(fragment => ({ start: fragment.start, end: fragment.end }));
	return neededRanges.length > 0
		&& neededRanges.every(range => existingSessions.some(session => trackerSessionContainsRange(
			session.start,
			session.end,
			range.start,
			range.end,
		)));
}

function trackerSessionContainsRange(sessionStart: string, sessionEnd: string, rangeStart: string, rangeEnd: string): boolean {
	const parsedSessionStart = parseLocalDatetime(sessionStart);
	const parsedSessionEnd = parseLocalDatetime(sessionEnd);
	const parsedRangeStart = parseLocalDatetime(rangeStart);
	const parsedRangeEnd = parseLocalDatetime(rangeEnd);
	if (!parsedSessionStart || !parsedSessionEnd || !parsedRangeStart || !parsedRangeEnd) return false;
	return parsedSessionStart.getTime() <= parsedRangeStart.getTime()
		&& parsedSessionEnd.getTime() >= parsedRangeEnd.getTime();
}
