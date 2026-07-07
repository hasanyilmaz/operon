import { resolveKanbanDescendantSummaryFromStats, resolveTaskEditorProgressFromStats } from '../core/task-stats-read-model';
import type { IndexedTask, PlainCheckboxProgress } from '../types/fields';
import { t } from '../core/i18n';

export const CHECKBOX_PROGRESS_COLUMN_KEY = 'checkboxProgress';
export type TaskProgressTrackKind = 'subtasks' | 'checkboxes';

export interface TaskProgressDescendantSummary {
	done: number;
	open: number;
	total: number;
}

export interface TaskProgressTrack {
	kind: TaskProgressTrackKind;
	completed: number;
	total: number;
	percent: number;
	title: string;
	tooltip: string;
}

export interface TaskProgressSource {
	getTask: (operonId: string) => IndexedTask | null | undefined;
	getAllDescendantIds?: (operonId: string) => Iterable<string>;
	getChildIds?: (operonId: string) => Iterable<string>;
}

export interface TaskProgressLookup {
	resolveDescendantSummary(task: IndexedTask): TaskProgressDescendantSummary;
	resolveSubtaskTrack(task: IndexedTask): TaskProgressTrack | null;
	resolveCheckboxTrack(task: IndexedTask): TaskProgressTrack | null;
	resolveTrack(task: IndexedTask, kind: TaskProgressTrackKind): TaskProgressTrack | null;
	resolveRawValue(task: IndexedTask, key: string): string | null;
}

export function createTaskProgressLookup(tasks: readonly IndexedTask[]): TaskProgressLookup {
	const byId = new Map(tasks.map(task => [task.operonId, task] as const));
	const childrenByParent = new Map<string, string[]>();
	for (const task of tasks) {
		const parentId = task.fieldValues['parentTask']?.trim();
		if (!parentId) continue;
		const children = childrenByParent.get(parentId) ?? [];
		children.push(task.operonId);
		childrenByParent.set(parentId, children);
	}
	const summaryCache = new Map<string, TaskProgressDescendantSummary>();
	const source: TaskProgressSource = {
		getTask: operonId => byId.get(operonId) ?? null,
		getChildIds: operonId => childrenByParent.get(operonId) ?? [],
	};
	const resolveDescendantSummary = (task: IndexedTask): TaskProgressDescendantSummary => {
		const cached = summaryCache.get(task.operonId);
		if (cached) return cached;
		const summary = resolveTaskProgressDescendantSummary(task, source);
		summaryCache.set(task.operonId, summary);
		return summary;
	};
	const resolveSubtaskTrack = (task: IndexedTask): TaskProgressTrack | null => {
		return buildSubtaskProgressTrack(resolveDescendantSummary(task));
	};
	const resolveCheckboxTrack = (task: IndexedTask): TaskProgressTrack | null => {
		return buildPlainCheckboxProgressTrack(task.plainCheckboxProgress);
	};
	return {
		resolveDescendantSummary,
		resolveSubtaskTrack,
		resolveCheckboxTrack,
		resolveTrack(task, kind) {
			return kind === 'subtasks'
				? resolveSubtaskTrack(task)
				: resolveCheckboxTrack(task);
		},
		resolveRawValue(task, key) {
			if (key === 'progress') return formatTaskProgressRawValue(resolveSubtaskTrack(task));
			if (key === CHECKBOX_PROGRESS_COLUMN_KEY) return formatTaskProgressRawValue(resolveCheckboxTrack(task));
			return null;
		},
	};
}

export function resolveTaskProgressDescendantSummary(
	parentTask: IndexedTask,
	source: TaskProgressSource,
): TaskProgressDescendantSummary {
	const statsSummary = resolveKanbanDescendantSummaryFromStats(parentTask.fieldValues);
	const statsProgress = resolveTaskEditorProgressFromStats(parentTask.fieldValues);
	if (statsSummary && statsProgress && statsSummary.total === statsProgress.total) {
		return {
			done: statsProgress.done,
			open: statsSummary.open,
			total: statsSummary.total,
		};
	}

	const descendantIds = collectTaskProgressDescendantIds(parentTask.operonId, source);
	let done = 0;
	let open = 0;
	for (const descendantId of descendantIds) {
		const task = source.getTask(descendantId);
		if (task?.checkbox === 'done') done += 1;
		if (task?.checkbox === 'open') open += 1;
	}
	return {
		done,
		open,
		total: descendantIds.length,
	};
}

export function buildTaskProgressTracks(options: {
	includeSubtasks?: boolean;
	includeCheckboxes?: boolean;
	descendantSummary?: TaskProgressDescendantSummary | null;
	plainCheckboxProgress?: PlainCheckboxProgress | null;
}): TaskProgressTrack[] {
	const tracks: TaskProgressTrack[] = [];
	if (options.includeSubtasks) {
		const track = buildSubtaskProgressTrack(options.descendantSummary ?? null);
		if (track) tracks.push(track);
	}
	if (options.includeCheckboxes) {
		const track = buildPlainCheckboxProgressTrack(options.plainCheckboxProgress ?? null);
		if (track) tracks.push(track);
	}
	return tracks;
}

export function buildSubtaskProgressTrack(
	summary: TaskProgressDescendantSummary | null | undefined,
): TaskProgressTrack | null {
	const total = Math.max(0, summary?.total ?? 0);
	if (total <= 0) return null;
	const completed = Math.min(Math.max(summary?.done ?? 0, 0), total);
	const percent = Math.round((completed / total) * 100);
	return {
		kind: 'subtasks',
		completed,
		total,
		percent,
		title: t('tooltips', 'subtasks'),
		tooltip: t('tooltips', 'kanbanSubtaskProgressTooltip', {
			done: String(completed),
			total: String(total),
			percent: String(percent),
		}),
	};
}

export function buildPlainCheckboxProgressTrack(
	progress: PlainCheckboxProgress | null | undefined,
): TaskProgressTrack | null {
	const total = Math.max(0, progress?.total ?? 0);
	if (total <= 0) return null;
	const completed = Math.min(Math.max(progress?.completed ?? 0, 0), total);
	const percent = Math.round((completed / total) * 100);
	return {
		kind: 'checkboxes',
		completed,
		total,
		percent,
		title: t('tooltips', 'plainCheckboxes'),
		tooltip: t('tooltips', 'kanbanPlainCheckboxProgressTooltip', {
			done: String(completed),
			total: String(total),
			percent: String(percent),
		}),
	};
}

export function formatTaskProgressRawValue(track: TaskProgressTrack | null): string {
	return track ? String(track.percent) : '';
}

export function renderTaskProgressHorizontalTrack(
	container: HTMLElement,
	track: TaskProgressTrack,
	options: {
		className?: string;
		interactive?: boolean;
	},
): HTMLElement {
	const className = [
		'operon-task-progress-track',
		`is-${track.kind}`,
		'is-segmented',
		options.className ?? '',
	].filter(Boolean).join(' ');
	const el = options.interactive
		? container.createEl('button', { cls: className, attr: { type: 'button' } })
		: container.createSpan({ cls: className });
	renderTaskProgressSegments(el, track.percent);
	return el;
}

export function renderTaskProgressIconRing(
	container: HTMLElement,
	track: TaskProgressTrack,
	options: {
		className?: string;
	},
): HTMLElement {
	const ring = container.createSpan({
		cls: [
			'operon-task-progress-ring',
			`is-${track.kind}`,
			options.className ?? '',
		].filter(Boolean).join(' '),
	});
	ring.style.setProperty('--operon-task-progress-percent', `${Math.min(Math.max(track.percent, 0), 100)}%`);
	renderTaskProgressSegments(ring, track.percent, {
		segmentClassName: 'operon-task-progress-ring-segment',
		fillClassName: 'operon-task-progress-ring-segment-fill',
	});
	return ring;
}

export function renderTaskProgressSegments(
	trackEl: HTMLElement,
	percent: number,
	options: {
		segmentClassName?: string;
		fillClassName?: string;
	} = {},
): void {
	const segmentCount = 5;
	const segmentSize = 100 / segmentCount;
	const segmentClassName = options.segmentClassName ?? 'operon-task-progress-segment';
	const fillClassName = options.fillClassName ?? 'operon-task-progress-segment-fill';
	for (let index = 0; index < segmentCount; index += 1) {
		const segmentStart = index * segmentSize;
		const segmentFillPercent = Math.min(Math.max(((percent - segmentStart) / segmentSize) * 100, 0), 100);
		const segment = trackEl.createSpan(segmentClassName);
		segment.style.setProperty('--operon-task-progress-segment-index', String(index));
		segment.style.setProperty('--operon-task-progress-segment-percent', `${segmentFillPercent}%`);
		segment.style.setProperty('--operon-kanban-card-progress-segment-percent', `${segmentFillPercent}%`);
		segment.createSpan(fillClassName);
	}
}

function collectTaskProgressDescendantIds(
	parentId: string,
	source: TaskProgressSource,
): string[] {
	if (source.getAllDescendantIds) {
		return [...source.getAllDescendantIds(parentId)];
	}
	if (!source.getChildIds) return [];
	const result: string[] = [];
	const seen = new Set<string>();
	const stack = [...source.getChildIds(parentId)].reverse();
	while (stack.length > 0) {
		const childId = stack.pop();
		if (!childId || seen.has(childId)) continue;
		seen.add(childId);
		result.push(childId);
		const childIds = [...source.getChildIds(childId)];
		for (let index = childIds.length - 1; index >= 0; index -= 1) {
			const nextChildId = childIds[index];
			if (nextChildId) stack.push(nextChildId);
		}
	}
	return result;
}
