import { normalizeInlineTaskParentFileHeadingKeyword } from '../types/settings';
import type {
	FileTaskParentFileTargetMode,
	FileTaskParentInlineTargetMode,
	InlineTaskParentFileTargetMode,
	InlineTaskParentInlineTargetMode,
} from '../types/settings';
import type { IndexedTask } from '../types/fields';

export interface TaskCreatorTargetDraftLike {
	fieldValues: Record<string, string>;
}

export interface TaskCreatorTargetResolverSettings {
	fileTaskParentInlineTargetMode: FileTaskParentInlineTargetMode;
	fileTaskParentFileTargetMode: FileTaskParentFileTargetMode;
	inlineTaskParentInlineTargetMode: InlineTaskParentInlineTargetMode;
	inlineTaskParentFileTargetMode: InlineTaskParentFileTargetMode;
	inlineTaskParentFileHeadingKeyword: string;
}

export type TaskCreatorParentTaskLookup = (operonId: string) => IndexedTask | null;
export type TaskCreatorSourceFolderResolver = (task: IndexedTask) => string | null;

export type TaskCreatorInlinePlacement =
	| {
		kind: 'default';
		parentTask: IndexedTask | null;
	}
	| {
		kind: 'below-inline-parent';
		parentTask: IndexedTask;
	}
	| {
		kind: 'inside-file-parent';
		parentTask: IndexedTask;
		headingKeyword: string;
	};

export type InlineTaskLineParser = (
	line: string,
	lineNumber: number,
	filePath: string,
) => { operonId: string | null } | null;

export function resolveTaskCreatorDraftParentId(draft: TaskCreatorTargetDraftLike): string {
	return (draft.fieldValues['parentTask'] ?? '').trim();
}

export function resolveTaskCreatorDraftParentTask(
	draft: TaskCreatorTargetDraftLike,
	getTaskById: TaskCreatorParentTaskLookup,
): IndexedTask | null {
	const parentTaskId = resolveTaskCreatorDraftParentId(draft);
	return parentTaskId ? getTaskById(parentTaskId) : null;
}

export function resolveIndexedTaskSourceFolderPath(task: Pick<IndexedTask, 'primary'>): string | null {
	const filePath = task.primary.filePath.trim();
	if (!filePath.endsWith('.md')) return null;
	const slashIndex = filePath.lastIndexOf('/');
	return slashIndex >= 0 ? filePath.slice(0, slashIndex) : '';
}

export function resolveTaskCreatorFileTargetFolderOverride(args: {
	draft: TaskCreatorTargetDraftLike;
	settings: TaskCreatorTargetResolverSettings;
	getTaskById: TaskCreatorParentTaskLookup;
	resolveSourceFolder: TaskCreatorSourceFolderResolver;
}): string | null {
	const parentTask = resolveTaskCreatorDraftParentTask(args.draft, args.getTaskById);
	if (!parentTask) return null;

	if (
		parentTask.primary.format === 'inline'
		&& args.settings.fileTaskParentInlineTargetMode === 'same-folder'
	) {
		return args.resolveSourceFolder(parentTask);
	}
	if (
		parentTask.primary.format === 'yaml'
		&& args.settings.fileTaskParentFileTargetMode === 'same-folder'
	) {
		return args.resolveSourceFolder(parentTask);
	}
	return null;
}

export function resolveTaskCreatorInlinePlacement(args: {
	draft: TaskCreatorTargetDraftLike;
	settings: TaskCreatorTargetResolverSettings;
	getTaskById: TaskCreatorParentTaskLookup;
}): TaskCreatorInlinePlacement {
	const parentTask = resolveTaskCreatorDraftParentTask(args.draft, args.getTaskById);
	if (
		parentTask?.primary.format === 'inline'
		&& args.settings.inlineTaskParentInlineTargetMode === 'below-parent'
	) {
		return {
			kind: 'below-inline-parent',
			parentTask,
		};
	}
	if (
		parentTask?.primary.format === 'yaml'
		&& args.settings.inlineTaskParentFileTargetMode === 'inside-parent-file'
	) {
		return {
			kind: 'inside-file-parent',
			parentTask,
			headingKeyword: normalizeInlineTaskParentFileHeadingKeyword(args.settings.inlineTaskParentFileHeadingKeyword),
		};
	}
	return {
		kind: 'default',
		parentTask,
	};
}

export function resolveInlineParentInsertionLineNumber(args: {
	content: string;
	parentTask: IndexedTask;
	parseInlineTaskLine: InlineTaskLineParser;
}): number | null {
	if (args.parentTask.primary.format !== 'inline') return null;

	const parentPath = args.parentTask.primary.filePath;
	const lines = args.content.split('\n');
	let parentLine = -1;
	const parentLineHint = args.parentTask.primary.lineNumber;

	if (parentLineHint >= 0 && parentLineHint < lines.length) {
		const hinted = args.parseInlineTaskLine(lines[parentLineHint], parentLineHint, parentPath);
		if (hinted?.operonId === args.parentTask.operonId) {
			parentLine = parentLineHint;
		}
	}

	if (parentLine === -1) {
		for (let index = 0; index < lines.length; index++) {
			const parsed = args.parseInlineTaskLine(lines[index], index, parentPath);
			if (parsed?.operonId === args.parentTask.operonId) {
				parentLine = index;
				break;
			}
		}
	}

	return parentLine === -1 ? null : parentLine + 1;
}

/** Native Markdown nesting for a newly created inline child only. */
export function indentNewInlineSubtask(parentLine: string, taskLine: string): string {
 const prefix = /^[ \t]*- \[[^\]]\]/.exec(parentLine);
 if (!prefix) return taskLine;
 const indentation = /^[ \t]*/.exec(parentLine)?.[0] ?? '';
 return indentation + '    ' + taskLine.replace(/^[ \t]*/, '');
}
