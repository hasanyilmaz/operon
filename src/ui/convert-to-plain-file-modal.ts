import { App, Modal, getIcon } from 'obsidian';
import { t } from '../core/i18n';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip } from './operon-hover-tooltip';
import type { TaskEditorConvertToPlainFileProperty } from './task-editor-content';

export interface ConvertToPlainFileModalOptions {
	properties: readonly TaskEditorConvertToPlainFileProperty[];
	taskColor: string;
	onSubmit: (selectedCanonicalKeys: string[]) => Promise<boolean>;
	onCancel: () => void;
}

/**
 * A dedicated confirmation surface for removing selected Operon metadata from
 * a file task without deleting its note or arbitrary YAML properties.
 */
export class ConvertToPlainFileModal extends Modal {
	private readonly options: ConvertToPlainFileModalOptions;
	private selected = new Set<string>(['operonId']);
	private query = '';
	private submitting = false;
	private completed = false;
	private listEl: HTMLElement | null = null;
	private submitButton: HTMLButtonElement | null = null;

	constructor(app: App, options: ConvertToPlainFileModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-convert-to-plain-file-modal');
		this.titleEl.setText(t('taskEditor', 'convertToPlainFileTitle'));
		const intro = this.contentEl.createDiv('operon-convert-to-plain-file-intro');
		intro.createEl('p', { text: t('taskEditor', 'convertToPlainFileDescription') });
		intro.createEl('p', { text: t('taskEditor', 'convertToPlainFileKeepDescription') });

		const search = this.contentEl.createEl('input', {
			cls: 'operon-convert-to-plain-file-search',
			attr: {
				type: 'search',
				placeholder: t('taskEditor', 'convertToPlainFileSearchPlaceholder'),
			},
		});
		setAccessibleLabelWithoutTooltip(search, t('taskEditor', 'convertToPlainFileSearchPlaceholder'));
		search.addEventListener('input', () => {
			this.query = search.value.trim().toLocaleLowerCase();
			this.renderPropertyList();
		});
		search.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
			}
			if (event.key === 'Escape' && !this.submitting) {
				event.preventDefault();
				this.close();
			}
		});

		this.listEl = this.contentEl.createDiv('operon-convert-to-plain-file-property-list');
		this.renderPropertyList();

		const footer = this.contentEl.createDiv('operon-convert-to-plain-file-footer');
		const cancel = footer.createEl('button', {
			text: t('buttons', 'cancel'),
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => {
			if (!this.submitting) this.close();
		});
		this.submitButton = footer.createEl('button', {
			text: t('taskEditor', 'convertToPlainFileRemoveSelected'),
			cls: 'mod-warning',
			attr: { type: 'button' },
		});
		this.submitButton.addEventListener('click', () => void this.submit());
		this.contentEl.ownerDocument.defaultView?.setTimeout(() => search.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.completed && !this.submitting) this.options.onCancel();
	}

	close(): void {
		if (this.submitting && !this.completed) return;
		super.close();
	}

	private renderPropertyList(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		const matches = this.options.properties.filter(option => this.matches(option));
		if (matches.length === 0) {
			this.listEl.createDiv({
				cls: 'operon-convert-to-plain-file-empty',
				text: t('taskEditor', 'convertToPlainFileNoProperties'),
			});
			return;
		}
		for (const option of matches) {
			this.renderProperty(option);
		}
	}

	private renderProperty(option: TaskEditorConvertToPlainFileProperty): void {
		if (!this.listEl) return;
		const locked = option.canonicalKey === 'operonId';
		const row = this.listEl.createEl('label', {
			cls: 'operon-convert-to-plain-file-property',
		});
		row.classList.toggle('is-locked', locked);
		const checkbox = row.createEl('input', {
			attr: { type: 'checkbox' },
		});
		checkbox.checked = this.selected.has(option.canonicalKey);
		checkbox.dataset.operonLocked = locked ? 'true' : 'false';
		checkbox.disabled = locked || this.submitting;
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selected.add(option.canonicalKey);
			else this.selected.delete(option.canonicalKey);
		});
		const copy = row.createDiv('operon-convert-to-plain-file-property-copy');
		copy.createDiv({
			cls: 'operon-convert-to-plain-file-property-name',
			text: option.propertyName,
		});
		const meta = copy.createDiv('operon-convert-to-plain-file-property-meta');
		meta.createSpan({ text: option.canonicalKey });
		if (option.internal) {
			meta.createSpan({
				cls: 'operon-convert-to-plain-file-property-internal',
				text: t('taskEditor', 'convertToPlainFileInternal'),
			});
		}
		if (locked) {
			const required = meta.createSpan({
				cls: 'operon-convert-to-plain-file-property-required',
			});
			const icon = getIcon('info');
			if (icon) required.appendChild(icon);
			setAccessibleLabelWithoutTooltip(required, t('taskEditor', 'convertToPlainFileRequired'));
			required.tabIndex = 0;
			bindOperonHoverTooltip(required, {
				content: t('taskEditor', 'convertToPlainFileRequired'),
				taskColor: this.options.taskColor,
			});
		}
		copy.createDiv({
			cls: 'operon-convert-to-plain-file-property-description',
			text: option.description,
		});
	}

	private matches(option: TaskEditorConvertToPlainFileProperty): boolean {
		if (!this.query) return true;
		return [option.propertyName, option.canonicalKey, option.description]
			.some(value => value.toLocaleLowerCase().includes(this.query));
	}

	private async submit(): Promise<void> {
		if (this.submitting) return;
		this.submitting = true;
		this.setInteractiveControlsDisabled(true);
		try {
			const committed = await this.options.onSubmit(Array.from(this.selected));
			if (!committed) return;
			this.completed = true;
			this.close();
		} finally {
			if (!this.completed) {
				this.submitting = false;
				this.setInteractiveControlsDisabled(false);
			}
		}
	}

	private setInteractiveControlsDisabled(disabled: boolean): void {
		for (const control of Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button'))) {
			if (!disabled && control instanceof HTMLInputElement && control.dataset.operonLocked === 'true') {
				control.disabled = true;
				continue;
			}
			control.disabled = disabled;
		}
	}
}
