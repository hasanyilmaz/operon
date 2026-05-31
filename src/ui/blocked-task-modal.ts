import { App, Modal, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { ActiveDependencyBlocker, DependencyStatusChangeAttempt } from '../core/dependency-graph';
import { IndexedTask } from '../types/fields';

export interface BlockedTaskModalOptions {
	task: IndexedTask;
	attempt: DependencyStatusChangeAttempt;
	blockers: ActiveDependencyBlocker[];
	onOpenTask: (operonId: string) => void | Promise<void>;
	onCopyOperonId: (operonId: string) => void | Promise<void>;
}

export class BlockedTaskModal extends Modal {
	private readonly options: BlockedTaskModalOptions;

	constructor(app: App, options: BlockedTaskModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-blocked-task-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('taskEditor', 'dependencyBlockedTitle'));

		contentEl.createEl('p', {
			cls: 'operon-blocked-task-intro',
			text: t('taskEditor', 'dependencyBlockedMessage'),
		});

		const summary = contentEl.createDiv('operon-blocked-task-summary');
		this.createSummaryRow(summary, t('taskEditor', 'dependencyAttemptedTask'), this.options.task.description || t('taskEditor', 'dependencyUntitledTask'));
		this.createSummaryRow(summary, t('taskEditor', 'dependencyAttemptedChange'), this.formatAttempt());

		contentEl.createEl('h3', {
			cls: 'operon-blocked-task-section-title',
			text: t('taskEditor', 'dependencyActiveBlockers'),
		});

		const list = contentEl.createDiv('operon-blocked-task-list');
		for (const blocker of this.options.blockers) {
			this.renderBlockerRow(list, blocker);
		}

		const actions = contentEl.createDiv('operon-blocked-task-actions');
		const closeButton = actions.createEl('button', {
			text: t('taskEditor', 'dependencyClose'),
			attr: { type: 'button' },
		});
		closeButton.addClass('mod-cta');
		closeButton.addEventListener('click', () => this.close());
		window.setTimeout(() => closeButton.focus(), 0);
	}

	private createSummaryRow(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv('operon-blocked-task-summary-row');
		row.createDiv({ cls: 'operon-blocked-task-summary-label', text: label });
		row.createDiv({ cls: 'operon-blocked-task-summary-value', text: value });
	}

	private renderBlockerRow(container: HTMLElement, blocker: ActiveDependencyBlocker): void {
		const row = container.createDiv('operon-blocked-task-row');
		row.toggleClass('is-missing', blocker.missing);

		const meta = row.createDiv('operon-blocked-task-row-meta');
		const title = meta.createDiv('operon-blocked-task-row-title');
		title.createSpan({
			text: blocker.task?.description || t('taskEditor', blocker.missing ? 'dependencyMissingTask' : 'dependencyUntitledTask'),
		});
		title.createSpan({ cls: 'operon-blocked-task-id', text: blocker.operonId });

		const details = meta.createDiv('operon-blocked-task-row-details');
		this.createDetail(details, t('taskEditor', 'dependencyBlockerStatus'), blocker.status || t('taskEditor', 'dependencyMissingTask'));
		if (blocker.dateScheduled) {
			this.createDetail(details, t('taskEditor', 'dependencyScheduled'), blocker.dateScheduled);
		}
		if (blocker.dateDue) {
			this.createDetail(details, t('taskEditor', 'dependencyDue'), blocker.dateDue);
		}
		this.createDetail(details, t('taskEditor', 'dependencySource'), blocker.sourcePath || t('taskEditor', 'dependencyMissingTask'));

		const actions = row.createDiv('operon-blocked-task-row-actions');
		const openButton = this.createActionButton(actions, t('taskEditor', 'dependencyOpenTask'), 'external-link', () => {
			void this.options.onOpenTask(blocker.operonId);
		});
		openButton.disabled = blocker.missing;
		this.createActionButton(actions, t('taskEditor', 'dependencyCopyOperonId'), 'clipboard-copy', () => {
			void this.options.onCopyOperonId(blocker.operonId);
		});
	}

	private createDetail(container: HTMLElement, label: string, value: string): void {
		const detail = container.createSpan('operon-blocked-task-detail');
		detail.createSpan({ cls: 'operon-blocked-task-detail-label', text: `${label}:` });
		detail.createSpan({ cls: 'operon-blocked-task-detail-value', text: value });
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		icon: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			attr: { type: 'button', 'aria-label': label },
			cls: 'operon-blocked-task-row-action',
		});
		const iconEl = button.createSpan('operon-blocked-task-row-action-icon');
		setIcon(iconEl, icon);
		button.createSpan({ text: label });
		button.addEventListener('click', onClick);
		return button;
	}

	private formatAttempt(): string {
		if (this.options.attempt.kind === 'checkbox') {
			return t('taskEditor', 'dependencyAttemptCheckbox', {
				from: this.options.attempt.previousCheckbox,
				to: this.options.attempt.nextCheckbox,
			});
		}
		const from = this.options.attempt.previousStatus || t('taskEditor', 'dependencyNoStatus');
		const to = this.options.attempt.nextStatus || t('taskEditor', 'dependencyNoStatus');
		return t('taskEditor', 'dependencyAttemptStatus', { from, to });
	}
}
