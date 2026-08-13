import { App, Modal } from 'obsidian';

export interface ConfirmActionComparisonRow {
	label: string;
	currentValue: string;
	newValue: string;
	currentTotal?: string;
	newTotal?: string;
}

export interface ConfirmActionComparisonTable {
	requestedDeltaLabel: string;
	requestedDeltaValue: string;
	headers: {
		label: string;
		currentValue: string;
		newValue: string;
		currentTotal: string;
		newTotal: string;
	};
	rows: ConfirmActionComparisonRow[];
}

export interface ConfirmActionModalOptions {
	title: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	dismissText?: string;
	readOnly?: boolean;
	danger?: boolean;
	initialFocus?: 'confirm' | 'cancel';
	detailsTable?: Array<{ label: string; before: string; after: string }>;
	comparisonTable?: ConfirmActionComparisonTable;
}

export class ConfirmActionModal extends Modal {
	private readonly options: ConfirmActionModalOptions;
	private readonly onCloseResult: (confirmed: boolean) => void;
	private resolved = false;

	constructor(app: App, options: ConfirmActionModalOptions, onCloseResult: (confirmed: boolean) => void) {
		super(app);
		this.options = options;
		this.onCloseResult = onCloseResult;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('operon-confirm-action-modal');
		if (this.options.comparisonTable) {
			this.modalEl.addClass('operon-confirm-action-modal-wide');
		}
		contentEl.empty();
		this.titleEl.setText(this.options.title);
		if (this.options.comparisonTable) {
			this.renderComparisonTable(contentEl, this.options.comparisonTable);
		} else if (this.options.detailsTable?.length) {
			const table = contentEl.createDiv('operon-confirm-action-table');
			for (const row of this.options.detailsTable) {
				const item = table.createDiv('operon-confirm-action-table-row');
				item.createDiv({ cls: 'operon-confirm-action-table-label', text: row.label });
				if (row.after) {
					item.createDiv({ cls: 'operon-confirm-action-table-before', text: row.before });
					item.createDiv({ cls: 'operon-confirm-action-table-after', text: row.after });
					} else {
						item.createDiv({ cls: 'operon-confirm-action-table-value operon-confirm-action-table-value-full', text: row.before });
					}
				}
			}
			contentEl.createEl('p', { text: this.options.message });

			const actions = contentEl.createDiv('operon-confirm-action-buttons');

			if (this.options.readOnly) {
			const dismissButton = actions.createEl('button', { text: this.options.dismissText ?? 'Close' });
			dismissButton.addClass('mod-cta');
			dismissButton.addEventListener('click', () => {
				this.finish(false);
			});
			this.contentEl.ownerDocument.defaultView?.setTimeout(() => dismissButton.focus(), 0);
			return;
		}

		const cancelButton = actions.createEl('button', { text: this.options.cancelText ?? 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.finish(false);
		});

		const confirmButton = actions.createEl('button', { text: this.options.confirmText ?? 'Confirm' });
		confirmButton.addClass(this.options.danger ? 'mod-warning' : 'mod-cta');
		confirmButton.addEventListener('click', () => {
			this.finish(true);
		});
		const initialFocusButton = this.options.initialFocus === 'cancel' ? cancelButton : confirmButton;
		this.contentEl.ownerDocument.defaultView?.setTimeout(() => initialFocusButton.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onCloseResult(false);
		}
	}

	private finish(confirmed: boolean): void {
		this.resolved = true;
		this.close();
		this.onCloseResult(confirmed);
	}

	private renderComparisonTable(contentEl: HTMLElement, tableData: ConfirmActionComparisonTable): void {
		const summary = contentEl.createDiv('operon-confirm-action-summary');
		summary.createSpan({ cls: 'operon-confirm-action-summary-label', text: `${tableData.requestedDeltaLabel}:` });
		summary.createSpan({ cls: 'operon-confirm-action-summary-value', text: tableData.requestedDeltaValue });

		const tableWrap = contentEl.createDiv('operon-confirm-action-comparison');
		const table = tableWrap.createEl('table', { cls: 'operon-confirm-action-comparison-table' });
		const thead = table.createEl('thead');
		const headerRow = thead.createEl('tr');
		headerRow.createEl('th', { text: tableData.headers.label });
		headerRow.createEl('th', { text: tableData.headers.currentValue });
		headerRow.createEl('th', { text: tableData.headers.newValue });
		headerRow.createEl('th', { text: tableData.headers.currentTotal });
		headerRow.createEl('th', { text: tableData.headers.newTotal });

		const tbody = table.createEl('tbody');
		for (const row of tableData.rows) {
			const tr = tbody.createEl('tr');
			tr.createEl('td', { cls: 'operon-confirm-action-comparison-label', text: row.label });
			tr.createEl('td', { text: row.currentValue });
			tr.createEl('td', { text: row.newValue });
			tr.createEl('td', { text: row.currentTotal ?? '' });
			tr.createEl('td', { text: row.newTotal ?? '' });
		}
	}
}
