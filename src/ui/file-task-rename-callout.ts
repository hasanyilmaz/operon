import type { FileTaskRenameSuggestion } from '../core/filename-rule';
import { t } from '../core/i18n';
import { asyncHandler } from '../core/async-action';
import { Notice } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { TextFieldPopoverOptions } from './text-field-popover';

type FileTaskRenameControlsOptions = {
	variant: 'editor-row' | 'popover';
	currentFilename: string;
	rename: (filename: string) => Promise<void>;
	dismiss: () => void;
};

export function renderFileTaskRenameControls(
	host: HTMLElement,
	suggestion: FileTaskRenameSuggestion,
	options: FileTaskRenameControlsOptions,
): void {
	host.empty();
	const controls = host.createDiv(`operon-file-task-rename-controls is-${options.variant}`);
	if (options.variant === 'popover') {
		controls.createDiv({ cls: 'operon-file-task-rename-label', text: t('taskEditor', 'fileTaskFile') });
	}
	const changeLine = controls.createDiv('operon-file-task-rename-change-line');
	const diff = changeLine.createDiv('operon-file-task-rename-diff');
	diff.tabIndex = 0;
	diff.createSpan({
		cls: 'operon-file-task-rename-current',
		text: options.currentFilename,
	});
	const suggestionPair = diff.createSpan('operon-file-task-rename-suggestion-pair');
	suggestionPair.createSpan({
		cls: 'operon-file-task-rename-arrow',
		text: '\u2192',
		attr: { 'aria-hidden': 'true' },
	});
	const suggestionHost = suggestionPair.createSpan('operon-file-task-rename-suggestion-host');
	const actions = changeLine.createDiv('operon-file-task-rename-actions');
	const renameButton = actions.createEl('button', {
		cls: 'operon-file-task-rename-action',
		text: t('taskEditor', 'fileTaskRenameAction'),
		type: 'button',
	});
	actions.createSpan({
		cls: 'operon-file-task-rename-action-divider',
		text: '\u00b7',
		attr: { 'aria-hidden': 'true' },
	});
	const keepButton = actions.createEl('button', {
		cls: 'operon-file-task-rename-action',
		text: t('taskEditor', 'fileTaskKeep'),
		type: 'button',
	});
	const isCurrent = (): boolean => controls.parentElement === host;
	let input: HTMLInputElement | null = null;
	let suggestionButton: HTMLButtonElement | null = null;
	const setPending = (pending: boolean): void => {
		renameButton.disabled = pending;
		keepButton.disabled = pending;
		suggestionButton?.toggleAttribute('disabled', pending);
		if (input) input.disabled = pending;
	};
	const showSuggestion = (): void => {
		input = null;
		suggestionHost.empty();
		suggestionButton = suggestionHost.createEl('button', {
			cls: 'operon-file-task-rename-suggestion',
			text: suggestion.filename,
			type: 'button',
		});
		suggestionButton.setAttribute('aria-label', t('taskEditor', 'fileTaskRenameAction'));
		suggestionButton.addEventListener('click', () => openFilenameEditor());
	};
	const openFilenameEditor = (): void => {
		if (!isCurrent() || input) return;
		suggestionButton = null;
		suggestionHost.empty();
		input = suggestionHost.createEl('input', {
			cls: 'operon-file-task-rename-input',
			type: 'text',
			value: suggestion.filename,
			attr: { size: String(Math.max(1, Array.from(suggestion.filename).length)) },
		});
		input.setAttribute('aria-label', t('taskEditor', 'fileTaskFile'));
		input.title = `${t('taskEditor', 'fileTaskFile')}: ${options.currentFilename}`;
		if (suggestion.error) {
			input.setCustomValidity(suggestion.error);
			input.setAttribute('aria-invalid', 'true');
		}
		input.addEventListener('input', () => {
			input?.setCustomValidity('');
			input?.removeAttribute('aria-invalid');
		});
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				void renameFile();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				showSuggestion();
				diff.focus();
			}
		});
		input.focus();
		input.select();
	};
	const renameFile = async (): Promise<void> => {
		if (!isCurrent()) return;
		const filename = input?.value ?? suggestion.filename;
		if (input && !input.reportValidity()) return;
		if (!input && suggestion.error) {
			new Notice(suggestion.error);
			return;
		}
		setPending(true);
		try {
			await options.rename(filename);
			if (isCurrent()) options.dismiss();
		} catch (failure) {
			if (!isCurrent()) return;
			const message = failure instanceof Error ? failure.message : String(failure);
			if (input) {
				input.setCustomValidity(message);
				input.reportValidity();
			}
			new Notice(message);
		} finally {
			if (isCurrent()) setPending(false);
		}
	};
	renameButton.addEventListener('click', asyncHandler('File Task rename failed', renameFile));
	keepButton.addEventListener('click', () => {
		if (isCurrent()) options.dismiss();
	});
	diff.addEventListener('keydown', event => {
		if (event.key === 'Enter' || event.key === 'F2') {
			event.preventDefault();
			openFilenameEditor();
		}
	});
	showSuggestion();
	if (suggestion.error) new Notice(suggestion.error);
}

export function renderFileTaskRenameCallout(
	host: HTMLElement,
	currentFilename: string,
	suggestion: FileTaskRenameSuggestion,
	rename: (filename: string) => Promise<void>,
	dismiss: () => void,
): void {
	renderFileTaskRenameControls(host, suggestion, {
		variant: 'popover',
		currentFilename,
		rename,
		dismiss,
	});
}

export function createFileTaskTitleAfterCommit(
	task: Pick<IndexedTask, 'operonId' | 'primary'>,
	callbacks: {
		onFileTaskTitleChanged?: (operonId: string, title: string) => Promise<FileTaskRenameSuggestion | null>;
		onRenameFileTask?: (operonId: string, filename: string) => Promise<void>;
	},
): NonNullable<TextFieldPopoverOptions['onAfterCommit']> {
	return async (title, host, close) => {
		const suggestion = await callbacks.onFileTaskTitleChanged?.(task.operonId, title);
		if (!suggestion) return true;
		renderFileTaskRenameCallout(host, task.primary.filePath.split('/').pop() ?? '',
			suggestion, async filename => {
				if (!callbacks.onRenameFileTask) throw new Error(t('taskEditor', 'fileTaskRenameFailed'));
				await callbacks.onRenameFileTask(task.operonId, filename);
			}, close);
		return false;
	};
}
