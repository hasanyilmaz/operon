import { t } from './i18n';

export type TaskNoticeKind =
	| 'inline-created'
	| 'inline-moved'
	| 'file-created'
	| 'inline-to-file'
	| 'file-to-inline'
	| 'time-session-edited';

export type TaskNoticeCountKind =
	| 'inline-created-count'
	| 'file-created-count'
	| 'tasks-created-count';

export interface TaskNoticeNameParts {
	description?: string | null;
	fileBasename?: string | null;
	indexedDescription?: string | null;
	operonId?: string | null;
}

export interface TaskNoticeCreationInput {
	format: 'inline' | 'yaml';
	nameParts: TaskNoticeNameParts;
}

export type TaskNoticeCreationNotice =
	| {
		kind: 'single';
		taskKind: Extract<TaskNoticeKind, 'inline-created' | 'file-created'>;
		parts: TaskNoticeNameParts;
	}
	| {
		kind: 'bulk';
		countKind: TaskNoticeCountKind;
		count: number;
	};

const TASK_NOTICE_KEYS: Record<TaskNoticeKind, string> = {
	'inline-created': 'inlineTaskCreated',
	'inline-moved': 'inlineTaskMoved',
	'file-created': 'fileTaskCreated',
	'inline-to-file': 'inlineTaskConvertedToFileTask',
	'file-to-inline': 'fileTaskConvertedToInlineTask',
	'time-session-edited': 'timeSessionEdited',
};

const TASK_NOTICE_COUNT_KEYS: Record<TaskNoticeCountKind, string> = {
	'inline-created-count': 'inlineTasksCreatedCount',
	'file-created-count': 'fileTasksCreatedCount',
	'tasks-created-count': 'tasksCreatedCount',
};

function normalizeTaskNoticeName(value: string | null | undefined): string {
	return (value ?? '').replace(/\s*\r?\n+\s*/gu, ' ').trim();
}

export function resolveTaskNoticeName(parts: TaskNoticeNameParts): string {
	return normalizeTaskNoticeName(parts.description)
		|| normalizeTaskNoticeName(parts.fileBasename)
		|| normalizeTaskNoticeName(parts.indexedDescription)
		|| normalizeTaskNoticeName(parts.operonId);
}

export function formatTaskNotice(
	kind: TaskNoticeKind,
	parts: TaskNoticeNameParts,
): string {
	return t('notifications', TASK_NOTICE_KEYS[kind], {
		taskName: resolveTaskNoticeName(parts),
	});
}

export function formatTaskNoticeCount(
	kind: TaskNoticeCountKind,
	count: number,
): string {
	return t('notifications', TASK_NOTICE_COUNT_KEYS[kind], {
		count: String(count),
	});
}

export function buildTaskCreationNotices(
	tasks: readonly TaskNoticeCreationInput[],
	bulkThreshold = 4,
): TaskNoticeCreationNotice[] {
	if (tasks.length === 0) return [];
	if (tasks.length >= bulkThreshold) {
		const inlineCount = tasks.filter(task => task.format === 'inline').length;
		const fileCount = tasks.length - inlineCount;
		const countKind: TaskNoticeCountKind = inlineCount === tasks.length
			? 'inline-created-count'
			: fileCount === tasks.length
				? 'file-created-count'
				: 'tasks-created-count';
		return [{
			kind: 'bulk',
			countKind,
			count: tasks.length,
		}];
	}
	return tasks.map(task => ({
		kind: 'single',
		taskKind: task.format === 'inline' ? 'inline-created' : 'file-created',
		parts: task.nameParts,
	}));
}
