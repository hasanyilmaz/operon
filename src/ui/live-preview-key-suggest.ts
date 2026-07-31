import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
	editorLivePreviewField,
} from 'obsidian';
import { EditorView } from '@codemirror/view';
import { getEditorViewFromEditor } from '../core/obsidian-app';
import { isTaskLineCandidate, parseTaskLine } from '../core/parser';
import { OperonSettings } from '../types/settings';
import { BeginEphemeralFieldSessionInput } from './live-preview-ephemeral-session';
import {
	buildTaskFieldSuggestions,
	debugTaskFieldSuggestion,
	isParsedTaskFieldSuggestionTarget,
	resolveTaskFieldSuggestions,
	TaskFieldSuggestionItem as SuggestionItem,
} from './task-field-suggest';
import { allowsOperonDocumentEditor } from './editor-augmentation-scope';

interface LivePreviewKeySuggestCallbacks {
	getSettings: () => OperonSettings;
	beginSession?: (input: BeginEphemeralFieldSessionInput) => string | void;
	removeTriggerToken?: (editor: Editor, start: EditorPosition, end: EditorPosition) => void;
	openInsertedField?: (canonicalKey: string, sessionId?: string) => void;
}

class OperonLivePreviewKeySuggest extends EditorSuggest<SuggestionItem> {
	private activeFile: TFile | null = null;
	private currentFieldValues: Record<string, string> = {};

	constructor(
		app: App,
		private readonly callbacks: LivePreviewKeySuggestCallbacks,
	) {
		super(app);
		this.limit = 8;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) return null;
		if (!this.isLivePreview(editor)) {
			debugTaskFieldSuggestion('live-preview', 'not-live-preview');
			return null;
		}
		this.activeFile = file;

		const line = editor.getLine(cursor.line);
		if (!isTaskLineCandidate(line)) {
			debugTaskFieldSuggestion('live-preview', 'not-task-line', { line: cursor.line });
			return null;
		}
		const settings = this.callbacks.getSettings();
		const parsed = parseTaskLine(line, cursor.line, file.path, settings.keyMappings);
		if (!parsed) {
			this.currentFieldValues = {};
			debugTaskFieldSuggestion('live-preview', 'not-task-line', { line: cursor.line });
			return null;
		}
		if (!isParsedTaskFieldSuggestionTarget(parsed)) {
			this.currentFieldValues = {};
			debugTaskFieldSuggestion('live-preview', 'not-operon-task', { line: cursor.line });
			return null;
		}
		this.currentFieldValues = Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));

		const beforeCaret = line.slice(0, cursor.ch);
		const resolution = resolveTaskFieldSuggestions(beforeCaret, settings, this.currentFieldValues);
		if (!resolution.trigger || resolution.items.length === 0) {
			if (resolution.suppressionReason) {
				debugTaskFieldSuggestion('live-preview', resolution.suppressionReason, {
					token: resolution.token,
					line: cursor.line,
				});
			}
			return null;
		}

		return {
			start: { line: cursor.line, ch: resolution.trigger.start },
			end: cursor,
			query: resolution.token,
		};
	}

	getSuggestions(context: EditorSuggestContext): SuggestionItem[] {
		return buildTaskFieldSuggestions(context.query, this.callbacks.getSettings(), this.currentFieldValues);
	}

	renderSuggestion(value: SuggestionItem, el: HTMLElement): void {
		el.addClass('operon-field-menu-item');
		el.setText(value.visibleName);
	}

	selectSuggestion(value: SuggestionItem, _evt: MouseEvent | KeyboardEvent): void {
		if (!this.context || !this.activeFile) return;

		const sessionId = this.callbacks.beginSession?.({
			canonicalKey: value.canonicalKey,
			visibleName: value.visibleName,
			filePath: this.activeFile.path,
			lineNumber: this.context.start.line,
			triggerRange: {
				start: this.context.start,
				end: this.context.end,
			},
			resumeCursor: this.context.start,
		});
		const editor = this.context.editor;
		if (this.callbacks.removeTriggerToken) {
			this.callbacks.removeTriggerToken(editor, this.context.start, this.context.end);
		} else {
			editor.replaceRange('', this.context.start, this.context.end);
			editor.setCursor(this.context.start);
		}
		this.close();
		window.setTimeout(() => this.callbacks.openInsertedField?.(value.canonicalKey, typeof sessionId === 'string' ? sessionId : undefined), 0);
	}

	private isLivePreview(editor: Editor): boolean {
		if (!allowsOperonDocumentEditor(editor)) return false;
		const cm = getEditorViewFromEditor(editor);
		if (!(cm instanceof EditorView)) return false;

		try {
			return cm.state.field(editorLivePreviewField);
		} catch {
			return false;
		}
	}
}

export function operonLivePreviewKeySuggestExtension(
	app: App,
	callbacks: LivePreviewKeySuggestCallbacks,
): EditorSuggest<SuggestionItem> {
	return new OperonLivePreviewKeySuggest(app, callbacks);
}
