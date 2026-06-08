import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import { editorLivePreviewField, setIcon } from 'obsidian';
import { classifyClassicTaskConversionLine, ClassicTaskConversionKind } from '../core/classic-task-conversion';
import { createOwnerElement } from '../core/dom-compat';
import { OperonSettings } from '../types/settings';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { t } from '../core/i18n';
import { operonIndexRefreshEffect } from './live-preview-conceal';
import { isPlainCheckboxPopoverEditorElement } from './plain-checkbox-popover-scope';

interface ClassicTaskConvertCallbacks {
	getFilePath: (view: EditorView) => string;
	getSettings: () => OperonSettings;
	convertTasksEmojiLine: (lineNumber: number, view: EditorView) => void;
	upgradePlainCheckboxLine: (lineNumber: number, view: EditorView) => void;
}

class ClassicTaskConvertWidget extends WidgetType {
	constructor(
		private readonly kind: Exclude<ClassicTaskConversionKind, 'none'>,
		private readonly lineNumber: number,
		private readonly callbacks: ClassicTaskConvertCallbacks,
	) {
		super();
	}

	toDOM(view: EditorView): HTMLElement {
		const button = createOwnerElement(view.dom, 'span');
		button.className = `operon-live-preview-status-icon operon-classic-task-convert-icon is-${this.kind}`;
		button.setAttribute('role', 'button');
		button.setAttribute('tabindex', '0');
		const label = t('tooltips', this.kind === 'tasksEmoji'
			? 'convertTasksSyntaxToOperonTask'
			: 'convertCheckboxToOperonTask');
		setIcon(button, this.kind === 'tasksEmoji' ? 'circle-plus' : 'square-plus');
		setAccessibleLabelWithoutTooltip(button, label);
		bindOperonHoverTooltip(button, {
			content: label,
			taskColor: null,
		});

		const handleActivate = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			if (this.kind === 'tasksEmoji') {
				this.callbacks.convertTasksEmojiLine(this.lineNumber, view);
				return;
			}
			this.callbacks.upgradePlainCheckboxLine(this.lineNumber, view);
		};

		button.addEventListener('click', handleActivate);
		button.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			handleActivate(event);
		});
		return button;
	}

	eq(other: ClassicTaskConvertWidget): boolean {
		return this.kind === other.kind && this.lineNumber === other.lineNumber;
	}
}

export function operonLivePreviewClassicTaskConvertExtension(callbacks: ClassicTaskConvertCallbacks): Extension {
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet = Decoration.none;
		private lastLivePreview = false;

		constructor(view: EditorView) {
			this.lastLivePreview = this.isLivePreview(view);
			this.rebuild(view);
		}

		update(update: ViewUpdate): void {
			const hasRefresh = update.transactions.some(transaction =>
				transaction.effects.some(effect => effect.is(operonIndexRefreshEffect))
			);
			const nowLive = this.isLivePreview(update.view);
			const modeChanged = nowLive !== this.lastLivePreview;
			this.lastLivePreview = nowLive;

			if (modeChanged || hasRefresh || update.docChanged) {
				this.rebuild(update.view);
			}
		}

		private rebuild(view: EditorView): void {
			const decorations = new RangeSetBuilder<Decoration>();

			if (!this.isLivePreview(view)) {
				this.decorations = Decoration.none;
				return;
			}
			if (isPlainCheckboxPopoverEditorElement(view.dom)) {
				this.decorations = Decoration.none;
				return;
			}

			const filePath = callbacks.getFilePath(view);
			const settings = callbacks.getSettings();
			let inFencedCodeBlock = false;
			for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
				const line = view.state.doc.line(lineNumber);
				if (isMarkdownFenceLine(line.text)) {
					inFencedCodeBlock = !inFencedCodeBlock;
					continue;
				}
				if (inFencedCodeBlock) continue;
				if (!line.text.includes('- [')) continue;

				const kind = classifyClassicTaskConversionLine(line.text, filePath, settings.keyMappings);
				if (kind === 'none') continue;
				if (kind === 'tasksEmoji' && !settings.inlineTaskShowTasksEmojiConvertIcon) continue;
				if (kind === 'plainCheckbox' && !settings.inlineTaskShowPlainCheckboxConvertIcon) continue;

				decorations.add(
					line.from,
					line.from,
					Decoration.line({
						class: `operon-classic-task-convert-line operon-classic-task-convert-line-${kind}`,
					}),
				);
				decorations.add(
					line.to,
					line.to,
					Decoration.widget({
						widget: new ClassicTaskConvertWidget(kind, lineNumber - 1, callbacks),
						side: 1,
					}),
				);
			}

			this.decorations = decorations.finish();
		}

		private isLivePreview(view: EditorView): boolean {
			try {
				return view.state.field(editorLivePreviewField);
			} catch {
				return false;
			}
		}
	}, {
		decorations: pluginValue => pluginValue.decorations,
	});
}

function isMarkdownFenceLine(line: string): boolean {
	return /^\s*(?:`{3,}|~{3,})/.test(line);
}
