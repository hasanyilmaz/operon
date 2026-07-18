import { App, FuzzyMatch, FuzzySuggestModal } from 'obsidian';
import { t } from '../core/i18n';
import {
	FileTaskTemplateOption,
	getFileTaskTemplateOptionSecondaryText,
} from '../core/file-task-templates';

export class FileTaskTemplatePickerModal extends FuzzySuggestModal<FileTaskTemplateOption> {
	private readonly options: FileTaskTemplateOption[];
	private readonly onChooseResult: (value: FileTaskTemplateOption) => void;
	private readonly onCancel: () => void;
	private resolved = false;

	constructor(
		app: App,
		options: FileTaskTemplateOption[],
		onChooseResult: (value: FileTaskTemplateOption) => void,
		onCancel: () => void = () => {},
	) {
		super(app);
		this.options = options;
		this.onChooseResult = onChooseResult;
		this.onCancel = onCancel;
		this.setPlaceholder(t('taskEditor', 'chooseFileTaskTemplate'));
		this.emptyStateText = t('taskEditor', 'noMatchingTemplates');
		this.setInstructions([
			{ command: '↑↓', purpose: t('taskEditor', 'instructionNavigate') },
			{ command: 'Enter', purpose: t('taskEditor', 'instructionChooseTemplate') },
			{ command: 'Esc', purpose: t('taskEditor', 'instructionCancel') },
		]);
	}

	getItems(): FileTaskTemplateOption[] {
		return this.options;
	}

	getItemText(item: FileTaskTemplateOption): string {
		return `${item.name} ${getFileTaskTemplateOptionSecondaryText(item)}`;
	}

	renderSuggestion(match: FuzzyMatch<FileTaskTemplateOption>, el: HTMLElement): void {
		const option = match.item;
		el.empty();

		const primary = el.createDiv('operon-file-task-template-picker-primary');
		primary.setText(option.name);

		const secondary = el.createDiv('operon-file-task-template-picker-secondary');
		secondary.setText(getFileTaskTemplateOptionSecondaryText(option));
	}

	onChooseItem(item: FileTaskTemplateOption): void {
		this.resolved = true;
		this.close();
		window.setTimeout(() => this.onChooseResult(item), 0);
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			window.setTimeout(() => this.onCancel(), 0);
		}
	}
}
