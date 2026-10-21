import { ChangeSet, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension, type Text, type TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, type App, type MarkdownView } from 'obsidian';
import { markdownBodyStartLine } from '../core/markdown-body';
import { getEditorViewFromEditor } from '../core/obsidian-app';
import { bindNativeLightboxMethod, getNativeLightboxLeaves } from './native-lightbox-lifecycle';

const refreshBody = StateEffect.define<null>();

/** Offsets always refer to the complete native document, including frontmatter. */
export function lightboxBodyStart(doc: Text): number {
	const lines: string[] = [];
	for (let index = 1; index <= doc.lines; index++) {
		const line = doc.line(index);
		lines.push(line.text);
		if (index === 1 && line.text !== '---') return 0;
		if (index > 1 && line.text === '---') break;
	}
	const start = markdownBodyStartLine(lines, true);
	return start === null || start === 0 ? 0 : start < doc.lines ? doc.line(start + 1).from : doc.length;
}

function ownedMarkdown(app: App, state: EditorState): boolean {
	const info = state.field(editorInfoField, false);
	return !!info && getNativeLightboxLeaves(app).some(leaf => leaf.view.getViewType() === 'markdown'
		&& (!!info.editor && (leaf.view as MarkdownView).editor === info.editor));
}

function clampSelection(selection: EditorSelection, start: number): EditorSelection {
	return EditorSelection.create(selection.ranges.map(range => EditorSelection.range(
		Math.max(start, range.anchor), Math.max(start, range.head), range.goalColumn,
	)), selection.mainIndex);
}

function changesFrontmatter(transaction: Transaction, start: number): boolean {
	let touches = false;
	transaction.changes.iterChangedRanges(from => { if (from < start) touches = true; });
	return touches;
}

/** No file writes, mirrored documents or application-wide Markdown overrides. */
export function nativeLightboxBodyExtension(app: App): Extension {
	const isOwned = (state: EditorState): boolean => ownedMarkdown(app, state);
	// Protect frontmatter that existed when the native document was loaded or
	// refreshed. A body paste into a YAML-free note may itself create frontmatter;
	// that user's edit must remain undoable, including its new separator.
	const protectedStart = StateField.define<number>({
		create: state => lightboxBodyStart(state.doc),
		update: (start, transaction) => transaction.docChanged && (!transaction.annotation(Transaction.userEvent)
			|| transaction.isUserEvent('set') || transaction.annotation(Transaction.remote))
			? lightboxBodyStart(transaction.newDoc) : start,
	});
	const decorations = (state: EditorState): DecorationSet => {
		const start = isOwned(state) ? lightboxBodyStart(state.doc) : 0;
		// The body-top filter is a block widget at this exact boundary.
		// Exclude it from the YAML replacement instead of swallowing its DOM.
		return start ? Decoration.set([Decoration.replace({ block: true, inclusiveEnd: false }).range(0, start)]) : Decoration.none;
	};
	const field = StateField.define<DecorationSet>({
		create: decorations,
		update: (value, transaction) => transaction.docChanged || transaction.reconfigured
			|| transaction.effects.some(effect => effect.is(refreshBody)) ? decorations(transaction.state) : value,
		provide: value => [EditorView.decorations.from(value), EditorView.atomicRanges.of(view => view.state.field(value))],
	});
	return [
		protectedStart,
		field,
		EditorState.changeFilter.of(transaction => {
			if (!isOwned(transaction.startState)) return true;
			// Native reload uses "set"; unannotated Editor API updates are programmatic.
			// Neither is a body-edit gesture. Keep their complete documents intact.
			if (!transaction.annotation(Transaction.userEvent) || transaction.isUserEvent('set')
				|| transaction.annotation(Transaction.remote)) return true;
			const start = lightboxBodyStart(transaction.startState.doc);
			return start ? [0, start] : true;
		}),
		EditorState.transactionFilter.of(transaction => {
			if (!isOwned(transaction.startState)) return transaction;
			const oldStart = lightboxBodyStart(transaction.startState.doc);
			if (oldStart > 0 && oldStart === transaction.startState.doc.length && transaction.docChanged
				&& transaction.isUserEvent('input') && !transaction.isUserEvent('set')) {
				// A YAML-only file without a terminal newline still needs an editable
				// body. Add the separator only with the user's first body insertion.
				if (lightboxBodyStart(transaction.newDoc) === 0) {
					const changes = ChangeSet.of({ from: oldStart, insert: '\n' }, transaction.newDoc.length);
					return [transaction, { changes, selection: clampSelection(transaction.newSelection.map(changes), oldStart + 1), sequential: true }];
				}
			}
			const selection = clampSelection(transaction.newSelection, lightboxBodyStart(transaction.newDoc));
			return selection.eq(transaction.newSelection) ? transaction : [transaction, { selection, sequential: true }];
		}),
		ViewPlugin.fromClass(class {
			private restoreDispatch: (() => void) | null = null;
			private queued = false;
			private destroyed = false;
			constructor(private readonly view: EditorView) { this.synchronize(); }
			update(_update: ViewUpdate): void { this.synchronize(); }
			private synchronize(): void {
				if (!isOwned(this.view.state)) { this.restore(); return; }
				if (!this.restoreDispatch) {
					const view = this.view;
					const descriptor = Object.getOwnPropertyDescriptor(view, 'dispatch');
					const original = bindNativeLightboxMethod(view, 'dispatch');
					// Native history deliberately bypasses state filters. Guard only this
					// owned view, retaining the original history transaction and effects.
					const dispatch: EditorView['dispatch'] = (...input: (Transaction | readonly Transaction[] | TransactionSpec)[]): void => {
						const first = input[0];
						const transactions: readonly Transaction[] = input.length === 1 && first instanceof Transaction ? [first]
							: input.length === 1 && Array.isArray(first) ? first : [view.state.update(...input as TransactionSpec[])];
						if (isOwned(view.state) && transactions.some(transaction =>
							(transaction.isUserEvent('undo') || transaction.isUserEvent('redo'))
							&& changesFrontmatter(transaction, transaction.startState.field(protectedStart)))) return;
						Reflect.apply(original, view, [transactions]);
					};
					this.restoreDispatch = () => {
						if (view.dispatch !== dispatch) return;
						if (descriptor) Object.defineProperty(view, 'dispatch', descriptor);
						else Reflect.deleteProperty(view, 'dispatch');
					};
					view.dispatch = dispatch;
				}
				const selection = clampSelection(this.view.state.selection, lightboxBodyStart(this.view.state.doc));
				if (selection.eq(this.view.state.selection) || this.queued) return;
				this.queued = true;
				queueMicrotask(() => {
					this.queued = false;
					if (this.destroyed || !isOwned(this.view.state)) return;
					const current = clampSelection(this.view.state.selection, lightboxBodyStart(this.view.state.doc));
					if (!current.eq(this.view.state.selection)) this.view.dispatch({ selection: current, annotations: Transaction.addToHistory.of(false) });
				});
			}
			private restore(): void {
				this.restoreDispatch?.();
				this.restoreDispatch = null;
			}
			destroy(): void { this.destroyed = true; this.restore(); }
		}),
	];
}

export function refreshNativeLightboxBody(view: MarkdownView): void {
	const editor = view.editor && getEditorViewFromEditor(view.editor);
	editor?.dispatch({ effects: refreshBody.of(null), annotations: Transaction.addToHistory.of(false) });
}
