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
	if (task.primary.format !== 'inline') {
		new Notice(t('notifications', 'moveInlineTaskRequiresInlineSource'));
		return false;
	}
	if (targetLineNumber < 0 || targetLineNumber > editor.lastLine()) {
		new Notice(t('notifications', 'moveInlineTaskTargetRequiresBlankLine'));
		return false;
	}
	if (editor.getLine(targetLineNumber).trim()) {
		new Notice(t('notifications', 'moveInlineTaskTargetRequiresBlankLine'));
		return false;
	}

	const sourceFilePath = task.primary.filePath;
	return await deps.withDuplicateConflictAutoOpenSuppressed(async () => {
		if (sourceFilePath === targetFilePath) {
			const source = findInlineTaskLineInEditor(deps, editor, sourceFilePath, task.operonId, task.primary.lineNumber);
			if (!source || source.lineNumber === targetLineNumber) {
				new Notice(t('notifications', 'moveInlineTaskFailed'));
				return false;
			}
			editor.setLine(targetLineNumber, source.lineText);
			editor.setLine(source.lineNumber, '');
			await persistMarkdownViewAndReindex(view, targetFilePath, deps.indexer);
			new Notice(t('notifications', 'inlineTaskMovedHere'));
			deps.refreshViews();
			return true;
		}

		const sourceFile = deps.app.vault.getAbstractFileByPath(sourceFilePath);
		if (!(sourceFile instanceof TFile)) {
			new Notice(t('notifications', 'moveInlineTaskFailed'));
			return false;
		}

		const sourceContent = await deps.app.vault.cachedRead(sourceFile);
		const source = findInlineTaskLineInContent(deps, sourceContent, sourceFilePath, task.operonId, task.primary.lineNumber);
		if (!source?.lines) {
			new Notice(t('notifications', 'moveInlineTaskFailed'));
			return false;
		}

		editor.setLine(targetLineNumber, source.lineText);
		await persistMarkdownViewBuffer(view);
		source.lines[source.lineNumber] = '';
		await deps.app.vault.modify(sourceFile, source.lines.join('\n'));
		await deps.indexer.reindexFilesBatch([targetFilePath, sourceFilePath]);
		new Notice(t('notifications', 'inlineTaskMovedHere'));
		deps.refreshViews();
		return true;
	});
}

async function persistMarkdownViewBuffer(view: MarkdownView): Promise<void> {
	const savableView = view as MarkdownView & { save?: () => Promise<void> | void };
	if (typeof savableView.save === 'function') {
		await savableView.save();
	}
}

async function persistMarkdownViewAndReindex(
	view: MarkdownView,
	filePath: string,
	indexer: OperonIndexer,
): Promise<void> {
	if (view.file?.path === filePath) {
		await persistMarkdownViewBuffer(view);
	}
	await indexer.reindexFilePath(filePath);
}

function findInlineTaskLineInEditor(
	deps: MoveInlineTaskHereDependencies,
	editor: Editor,
	filePath: string,
	operonId: string,
	lineHint: number,
): InlineTaskLineMatch | null {
	if (lineHint >= 0 && lineHint <= editor.lastLine()) {
		const lineText = editor.getLine(lineHint);
		const hinted = deps.parseInlineTaskLine(lineText, lineHint, filePath);
		if (hinted?.operonId === operonId) {
			return { lineNumber: lineHint, lineText };
		}
	}

	for (let i = 0; i <= editor.lastLine(); i++) {
		const lineText = editor.getLine(i);
		const parsed = deps.parseInlineTaskLine(lineText, i, filePath);
		if (parsed?.operonId === operonId) {
			return { lineNumber: i, lineText };
		}
	}
	return null;
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
