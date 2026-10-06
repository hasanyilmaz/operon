import { App, FuzzyMatch, FuzzySuggestModal, TFile } from 'obsidian';
import { t } from '../core/i18n';

export interface InlineTaskTargetFilePickerOptions {
 acceptFile?: (file: TFile) => boolean;
	excludedFilePath?: string | null;
	onChooseFile: (file: TFile) => void;
	onCancel?: () => void;
}

export class InlineTaskTargetFilePickerModal extends FuzzySuggestModal<TFile> {
	private readonly options: InlineTaskTargetFilePickerOptions;
	private resolved = false;

	constructor(app: App, options: InlineTaskTargetFilePickerOptions) {
		super(app);
		this.options = options;
		this.setPlaceholder(t('taskEditor', 'chooseInlineTaskTargetFile'));
		this.emptyStateText = t('taskEditor', 'noMatchingMarkdownFiles');
		this.setInstructions([
			{ command: '↑↓', purpose: t('taskEditor', 'instructionNavigate') },
			{ command: 'Enter', purpose: t('taskEditor', 'instructionChooseFile') },
			{ command: 'Esc', purpose: t('taskEditor', 'instructionCancel') },
		]);
	}

	getItems(): TFile[] {
		const excludedFilePath = this.options.excludedFilePath?.trim() ?? '';
		return this.app.vault.getMarkdownFiles()
			.filter(file => file.path !== excludedFilePath && this.options.acceptFile?.(file) !== false)
			.sort((left, right) => left.path.localeCompare(right.path));
	}

	getItemText(file: TFile): string {
		return `${file.basename} ${file.path}`;
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		const file = match.item;
		el.empty();
		el.createDiv({
			cls: 'operon-inline-task-target-file-picker-primary',
			text: file.basename,
		});
		el.createDiv({
			cls: 'operon-inline-task-target-file-picker-secondary',
			text: file.path,
		});
	}

	onChooseItem(file: TFile): void {
		this.resolved = true;
		this.options.onChooseFile(file);
		this.close();
	}

	onClose(): void {
		super.onClose();
		window.setTimeout(() => {
			if (!this.resolved) this.options.onCancel?.();
		}, 0);
	}
}
