import type { App, MarkdownView, TFile } from 'obsidian';
import type { TaskMarkdownSource } from '../core/task-markdown-source';

export async function readTaskEditorMarkdown(
	app: App, file: TFile, views: readonly MarkdownView[],
): Promise<string> {
	if (app.vault.getAbstractFileByPath(file.path) !== file) throw new Error('Task source is unavailable');
	const contents = new Set(views.map(view => {
		if (view.file !== file) throw new Error('Task source view changed');
		return view.editor.getValue();
	}));
	if (contents.size > 1) throw new Error('Task source views disagree');
	return contents.size ? [...contents][0] : app.vault.read(file);
}

/** Patch the native buffer without replacing its editor or selecting the task. */
export function updateTaskEditorMarkdownView(view: MarkdownView, before: string, after: string): void {
	if (before === after) return;
	let start = 0, end = before.length, nextEnd = after.length;
	while (start < end && start < nextEnd && before[start] === after[start]) start++;
	while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
	view.editor.transaction({ changes: [{ from: view.editor.offsetToPos(start), to: view.editor.offsetToPos(end), text: after.slice(start, nextEnd) }] });
}

/** Reuse the existing writer's operation-scoped source port, including unsaved body text. */
export async function createTaskEditorMarkdownSource(
	app: App, file: TFile, getViews: () => readonly MarkdownView[],
): Promise<TaskMarkdownSource> {
	const owners = [...getViews()];
	let ownedContent = await readTaskEditorMarkdown(app, file, owners);
	const read = async (): Promise<string> => {
		const currentViews = getViews();
		if (owners.some(view => !currentViews.includes(view))) throw new Error('Task source view closed');
		const current = await readTaskEditorMarkdown(app, file, currentViews);
		if (current !== ownedContent) throw new Error('Task source changed during save');
		return current;
	};
	return {
		file, read,
		async write(expected, next, canCommit) {
			if (await read() !== expected || canCommit?.() === false) throw new Error('Task source changed during save');
			if (expected === next) return next;
			const views = getViews();
			// Recheck after the await before making a synchronous native transaction.
			if (app.vault.getAbstractFileByPath(file.path) !== file || owners.some(view => !views.includes(view)) || views.some(view => view.file !== file || view.editor.getValue() !== expected)) throw new Error('Task source changed during save');
			if (views.length) {
				for (const view of views) {
					const current = view.editor.getValue();
					if (view.file !== file || current !== expected && current !== next) throw new Error('Task source changed during save');
					// Native views may share or synchronously mirror the same live buffer.
					if (current !== next) updateTaskEditorMarkdownView(view, expected, next);
				}
				if (views.some(view => view.editor.getValue() !== next)) throw new Error('Task source transaction was rejected');
				ownedContent = next;
				await views[0].save();
			} else {
				let written = false;
				await app.vault.process(file, current => {
					if (current !== expected || canCommit?.() === false) return current;
					written = true;
					return next;
				});
				if (!written) throw new Error('Task source changed during save');
				ownedContent = next;
			}
			return next;
		},
	};
}
