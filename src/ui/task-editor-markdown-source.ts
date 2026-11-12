import type { App, MarkdownView, TFile } from 'obsidian';
import type { TaskMarkdownSource } from '../core/task-markdown-source';
import { markdownBodyStartLine } from '../core/markdown-body';
import { getOwnerWindow } from '../core/dom-compat';

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
export function updateTaskEditorMarkdownView(view: MarkdownView, before: string, after: string, trustedFrontmatter = false): void {
	if (before === after) return;
	let start = 0, end = before.length, nextEnd = after.length;
	while (start < end && start < nextEnd && before[start] === after[start]) start++;
	while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
	const from = view.editor.offsetToPos(start);
	const bodyLine = markdownBodyStartLine(before.split(/\r?\n/u), true) ?? 0;
	// Obsidian's Properties guard compares the mapped caret with the old YAML
	// boundary. Mark trusted YAML patches as native document updates so shrinking
	// frontmatter is accepted; retain normal filtering for body-only patches.
	view.editor.transaction({ changes: [{ from, to: view.editor.offsetToPos(end), text: after.slice(start, nextEnd) }] }, trustedFrontmatter || from.line < bodyLine ? 'set' : undefined);
}

type NativeSaveView = MarkdownView & { lastSavedData?: string | null; saving?: boolean };

export class PropertyEditorSourceConflict extends Error {}

const normalizedLines = (text: string): string => text.replace(/\r\n/gu, '\n');

/** Take a verified snapshot before writing a note through the shared Markdown mutation queue. */
export async function capturePropertyEditorMarkdown(
 app: App, file: TFile, getViews: () => readonly MarkdownView[],
 rebaseLateView?: (text: string) => string | null, canSynchronize?: () => boolean,
 onValidatedWrite?: (stored: string, next: string) => ((committed: boolean) => void) | undefined,
): Promise<TaskMarkdownSource & { stored: string; readonly nativeConflict: boolean }> {
 const path = file.path;
 const stillOwnsFile = (): boolean => file.path === path && app.vault.getAbstractFileByPath(path) === file;
 const deadline = Date.now() + 5000;
 for (let savingView = getViews().find((view: NativeSaveView) => view.saving); savingView;
  savingView = getViews().find((view: NativeSaveView) => view.saving)) {
  if (!stillOwnsFile() || Date.now() >= deadline) throw new PropertyEditorSourceConflict('Native save is still pending');
  await new Promise(resolve => getOwnerWindow(savingView.containerEl).setTimeout(resolve, 25));
 }
 const views = getViews().map((view: NativeSaveView) => ({
  view, text: view.editor.getValue(), baseline: view.lastSavedData === undefined ? view.data : view.lastSavedData,
 }));
 const stillOwnsViews = (): boolean => {
  const current = getViews();
  return current.length === views.length && views.every(({ view, text }) =>
   current.includes(view) && view.file === file && !view.saving && view.editor.getValue() === text);
 };
 const stored = await app.vault.read(file);
 if (!stillOwnsFile() || !stillOwnsViews()) throw new PropertyEditorSourceConflict('Markdown source changed during capture');
 const disk = normalizedLines(stored);
 const dirty = new Set<string>();
 for (const { text, baseline } of views) {
  const buffer = normalizedLines(text);
  const saved = typeof baseline === 'string' ? normalizedLines(baseline) : null;
  if (buffer === disk || buffer === saved) continue;
  if (saved !== disk) throw new PropertyEditorSourceConflict('A native draft is based on an older file');
  dirty.add(buffer);
 }
 if (dirty.size > 1) throw new PropertyEditorSourceConflict('Native drafts disagree');
 const [draft] = dirty;
 const crlf = stored.includes('\r\n');
 if (draft !== undefined && crlf && stored.replace(/\r\n/gu, '').includes('\n')) throw new PropertyEditorSourceConflict('Native draft uses mixed line endings');
 const expected = draft === undefined ? stored : crlf ? draft.replace(/\n/gu, '\r\n') : draft;
 const current = (): boolean => stillOwnsFile() && stillOwnsViews();
 let nativeConflict = false;
 return {
  file, stored,
  get nativeConflict() { return nativeConflict; },
  async read() {
   if (!current()) throw new PropertyEditorSourceConflict('Markdown source changed during save');
   return expected;
  },
  async write(before, next, canCommit) {
   // TaskWriter may recover a disk commit after an exception. Native sync must
   // also finish before this editor can acknowledge the draft.
   nativeConflict = true;
   if (before !== expected || !current()) throw new PropertyEditorSourceConflict('Markdown source changed during save');
   let settleWrite: ((committed: boolean) => void) | undefined;
   try {
    // Persist first. A rejected write cannot leave uncommitted properties in native buffers.
    if (next !== stored) await app.vault.process(file, onDisk => {
     if (onDisk !== stored || !current() || canCommit?.() === false) throw new PropertyEditorSourceConflict('Markdown source changed during save');
     settleWrite = onValidatedWrite?.(onDisk, next);
     return next;
    });
    else if (!current() || canCommit?.() === false) throw new PropertyEditorSourceConflict('Markdown source changed during save');
   } catch (error) {
    const actual = await app.vault.read(file).catch(() => null);
    // Unknown acknowledgement retains the exact pending receipt until reconciliation.
    if (actual !== null) settleWrite?.(actual === next);
    if (next === stored || !stillOwnsFile() || actual !== next) throw error;
   }
   settleWrite?.(true);
   const verified = await app.vault.read(file);
   if (!stillOwnsFile() || verified !== next || canSynchronize?.() === false) throw new PropertyEditorSourceConflict('The saved source could not be verified');
   let synchronizationConflict = false;
   const remaining = getViews();
   for (const { view, text } of views) {
    if (view.file !== file || !remaining.includes(view)) continue;
    const live = view.editor.getValue();
    if (normalizedLines(live) === normalizedLines(next)) continue;
    const synced = live === text ? next
     : normalizedLines(text) === normalizedLines(expected) ? rebaseLateView?.(live) : null;
    if (!synced || view.saving) { synchronizationConflict = true; continue; }
    const buffer = live.includes('\r\n') ? synced : normalizedLines(synced);
    try {
     updateTaskEditorMarkdownView(view, live, buffer, true);
     if (view.editor.getValue() !== buffer) synchronizationConflict = true;
    } catch { synchronizationConflict = true; }
   }
   // A newly opened view was not part of the captured source. Keep any draft
   // it owns and require review if it does not already contain the saved text.
   if (getViews().some(view => !views.some(snapshot => snapshot.view === view)
    && (view.file !== file || normalizedLines(view.editor.getValue()) !== normalizedLines(next)))) synchronizationConflict = true;
   nativeConflict = synchronizationConflict || !stillOwnsFile() || canSynchronize?.() === false;
   return next;
  },
 };
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
