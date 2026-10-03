import { commitInlineParentPlacementWrites } from '../systems/inline-parent-placement-transaction';
import { App, Editor, MarkdownView, Notice, TFile } from 'obsidian';
import { t } from '../core/i18n';
import { OperonIndexer } from '../indexer/indexer';
import { IndexedTask } from '../types/fields';
import type { ProjectSerialDisplay } from '../core/project-serials';
import { OperonSettings } from '../types/settings';
import { TaskFinderModal, TaskFinderModalOptions } from './task-finder-modal';

export type TaskFinderSettingsGetter = () => OperonSettings;
export type TaskFinderTaskHandler = (operonId: string, task: IndexedTask) => void | Promise<void>;
export type InlineTaskLineParser = (
	lineText: string,
	lineNumber: number,
	filePath: string,
) => { operonId?: string | null } | null;

export interface MoveInlineTaskHereDependencies {
	app: App;
	indexer: OperonIndexer;
	getSettings: TaskFinderSettingsGetter;
	parseInlineTaskLine: InlineTaskLineParser;
	withDuplicateConflictAutoOpenSuppressed: <T>(operation: () => Promise<T>) => Promise<T>;
	refreshViews: () => void;
	getProjectSerialDisplay?: (operonId: string) => ProjectSerialDisplay | null;
	withTaskSources?: (paths: readonly string[], allowed: () => boolean,
		operation: (write: (path: string, expected: string, next: string, guard: () => boolean) => Promise<boolean>, current: () => boolean) => Promise<boolean>) => Promise<boolean>;
}

type InlineTaskLineMatch = {
	lineNumber: number;
	lineText: string;
	lines?: string[];
};

export const TASK_FINDER_SCOPE_CALENDAR_SCHEDULE: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: true,
	includeInline: true,
	includeFile: true,
	includeCancelled: false,
	includeFinished: false,
};

export const TASK_FINDER_SCOPE_KANBAN_PLACE: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: true,
	includeInline: true,
	includeFile: true,
	includeCancelled: false,
	includeFinished: false,
};

export const TASK_FINDER_SCOPE_CALENDAR_TRACKED_SESSION: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: true,
	includeInline: true,
	includeFile: true,
	includeCancelled: false,
	includeFinished: true,
};

export const TASK_FINDER_SCOPE_MOVE_INLINE_TASK: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: false,
	includeInline: true,
	includeFile: false,
	includeCancelled: true,
	includeFinished: true,
};

export const TASK_FINDER_SCOPE_CONVERT_FILE_TASK_TO_INLINE: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: false,
	includeInline: false,
	includeFile: true,
	includeCancelled: true,
	includeFinished: true,
};

export const TASK_FINDER_SCOPE_CONVERT_TASK_TO_PLAIN: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: false,
	includeInline: true,
	includeFile: true,
	includeCancelled: true,
	includeFinished: true,
};

export const TASK_FINDER_SCOPE_TIME_TRACKER: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: true,
	includeInline: true,
	includeFile: true,
	includeCancelled: false,
	includeFinished: false,
};

export const TASK_FINDER_SCOPE_TASK_WIKILINK_OVERLAY: TaskFinderModalOptions['initialScope'] = {
	showRecentModified: false,
	includeInline: true,
	includeFile: true,
	includeCancelled: false,
	includeFinished: false,
};

export function openTaskFinder(
	app: App,
	indexer: OperonIndexer,
	getSettings: TaskFinderSettingsGetter,
	onOpenTask: TaskFinderTaskHandler,
	options: TaskFinderModalOptions = {},
): void {
	new TaskFinderModal(app, indexer, getSettings, onOpenTask, options).open();
}

export async function promptTaskFinderSelection(
	app: App,
	indexer: OperonIndexer,
	getSettings: TaskFinderSettingsGetter,
	initialScope: TaskFinderModalOptions['initialScope'],
	options: Omit<TaskFinderModalOptions, 'initialScope' | 'onCancel'> = {},
): Promise<IndexedTask | null> {
	return await new Promise(resolve => {
		openTaskFinder(
			app,
			indexer,
			getSettings,
			(_operonId, task) => resolve(task),
			{
				...options,
				initialScope,
				onCancel: () => resolve(null),
			},
		);
	});
}

export function openMoveInlineTaskHereFinder(
	deps: MoveInlineTaskHereDependencies,
	editor: Editor,
	view: MarkdownView,
): void {
	const targetFilePath = view.file?.path ?? '';
	if (!targetFilePath) {
		new Notice(t('notifications', 'noActiveFile'));
		return;
	}
	const targetLineNumber = editor.getCursor().line;
	if (editor.getLine(targetLineNumber).trim()) {
		new Notice(t('notifications', 'moveInlineTaskTargetRequiresBlankLine'));
		return;
	}

	openTaskFinder(
		deps.app,
		deps.indexer,
		deps.getSettings,
		(_operonId, task) => {
			void moveInlineTaskToEditorLine(deps, task, editor, view, targetFilePath, targetLineNumber);
		},
		{
			initialScope: TASK_FINDER_SCOPE_MOVE_INLINE_TASK,
			getProjectSerialDisplay: deps.getProjectSerialDisplay,
		},
	);
}

export async function moveInlineTaskToEditorLine(
	deps: MoveInlineTaskHereDependencies,
	task: IndexedTask,
	editor: Editor,
	view: MarkdownView,
	targetFilePath: string,
	targetLineNumber: number,
): Promise<boolean> {
	if (task.primary.format !== 'inline') { new Notice(t('notifications', 'moveInlineTaskRequiresInlineSource')); return false; }
	if (targetLineNumber < 0 || targetLineNumber > editor.lastLine() || editor.getLine(targetLineNumber).trim()) {
		new Notice(t('notifications', 'moveInlineTaskTargetRequiresBlankLine')); return false;
	}
	const sourceFilePath = task.primary.filePath, targetFile = view.file;
	const allowed = () => view.file === targetFile && view.file?.path === targetFilePath;
	await persistMarkdownViewBuffer(view);
	const operation = async (write: (path: string, expected: string, next: string, guard: () => boolean) => Promise<boolean>, current: () => boolean) => {
		if (!current() || editor.getLine(targetLineNumber).trim()) return false;
		const sameFile = sourceFilePath === targetFilePath;
		const sourceFile = deps.app.vault.getAbstractFileByPath(sourceFilePath);
		if (!(sourceFile instanceof TFile)) return false;
		const targetBefore = editor.getValue();
		const sourceBefore = sameFile ? targetBefore : await deps.app.vault.read(sourceFile);
		const source = findInlineTaskLineInContent(deps, sourceBefore, sourceFilePath, task.operonId, task.primary.lineNumber);
		if (!source?.lines || sameFile && source.lineNumber === targetLineNumber || !current()) return false;
		const targetLines = targetBefore.split('\n');
		targetLines[targetLineNumber] = source.lineText;
		if (sameFile) targetLines[source.lineNumber] = '';
		else source.lines[source.lineNumber] = '';
		const writes = [{ filePath: targetFilePath, expectedContent: targetBefore, nextContent: targetLines.join('\n') },
			...(sameFile ? [] : [{ filePath: sourceFilePath, expectedContent: sourceBefore, nextContent: source.lines.join('\n') }])];
		const release = deps.indexer.beginExpectedDuplicateOperonIdTransition(task.operonId, [task.primary,
			{ filePath: targetFilePath, format: 'inline', lineNumber: targetLineNumber }]);
		try {
			const outcome = await commitInlineParentPlacementWrites(writes, {
				read: async path => {
					const file = deps.app.vault.getAbstractFileByPath(path);
					if (!(file instanceof TFile)) throw new Error('The task source is unavailable.');
					return deps.app.vault.read(file);
				},
				buffersMatch: (path, content) => path !== targetFilePath || allowed() && editor.getValue() === content,
				write,
				synchronize: (path, before, after) => {
					if (path !== targetFilePath) return true;
					if (!allowed() || editor.getValue() !== before && editor.getValue() !== after) return false;
					if (editor.getValue() !== after) editor.setValue(after);
					return true;
				},
				canCommit: current,
			});
			await deps.indexer.reindexFilesBatch([targetFilePath, sourceFilePath]);
			deps.refreshViews();
			if (outcome !== 'committed') { new Notice(t('notifications', 'moveInlineTaskFailed')); return false; }
			new Notice(t('notifications', 'inlineTaskMovedHere')); return true;
		} finally { release(); }
	};
	return deps.withDuplicateConflictAutoOpenSuppressed(() => deps.withTaskSources
		? deps.withTaskSources([sourceFilePath, targetFilePath], allowed, operation)
		: operation(async (path, expected, next, guard) => {
			const file = deps.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || !guard()) return false;
			let committed = false;
			await deps.app.vault.process(file, content => {
				if (content !== expected || !guard()) return content;
				committed = true; return next;
			});
			return committed;
		}, allowed));
}

async function persistMarkdownViewBuffer(view: MarkdownView): Promise<void> {
	const savableView = view as MarkdownView & { save?: () => Promise<void> | void };
	if (typeof savableView.save === 'function') {
		await savableView.save();
	}
}

function findInlineTaskLineInContent(
	deps: MoveInlineTaskHereDependencies,
	content: string,
	filePath: string,
	operonId: string,
	lineHint: number,
): InlineTaskLineMatch | null {
	const lines = content.split('\n');
	if (lineHint >= 0 && lineHint < lines.length) {
		const lineText = lines[lineHint] ?? '';
		const hinted = deps.parseInlineTaskLine(lineText, lineHint, filePath);
		if (hinted?.operonId === operonId) {
			return { lineNumber: lineHint, lineText, lines };
		}
	}

	for (let i = 0; i < lines.length; i++) {
		const lineText = lines[i] ?? '';
		const parsed = deps.parseInlineTaskLine(lineText, i, filePath);
		if (parsed?.operonId === operonId) {
			return { lineNumber: i, lineText, lines };
		}
	}
	return null;
}
