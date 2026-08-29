import { App, Modal } from 'obsidian';
import { t } from '../../core/i18n';
import {
	RepeatEditScopeChoice,
	formatRepeatTemporalSnapshot,
} from '../../systems/recurrence-edit-scope';

interface RepeatOccurrenceScopeModalOptions {
	title: string;
	beforeLabel: string;
	afterLabel: string;
	includeSkip?: boolean;
}

export class RepeatOccurrenceScopeModal extends Modal {
	private readonly options: RepeatOccurrenceScopeModalOptions;
	private readonly onCloseResult: (result: RepeatEditScopeChoice | null) => void;
	private selectedScope: RepeatEditScopeChoice = 'thisTask';
	private resolved = false;

	constructor(
		app: App,
		options: RepeatOccurrenceScopeModalOptions,
		onCloseResult: (result: RepeatEditScopeChoice | null) => void,
	) {
		super(app);
		this.options = options;
		this.onCloseResult = onCloseResult;
	}

	onOpen(): void {
		this.modalEl.addClass('operon-repeat-occurrence-scope-modal');
		this.titleEl.setText(this.options.title);
		this.contentEl.empty();

		const summary = this.contentEl.createDiv('operon-repeat-occurrence-scope-summary');
		this.renderSummaryRow(summary, t('taskEditor', 'repeatScopeCurrent'), this.options.beforeLabel);
		this.renderSummaryRow(summary, t('taskEditor', 'repeatScopePending'), this.options.afterLabel);

		const choices = this.contentEl.createDiv('operon-repeat-occurrence-scope-choices');
		this.renderChoice(
			choices,
			'thisTask',
			t('taskEditor', 'repeatScopeThisTask'),
			t('taskEditor', 'repeatScopeThisTaskDesc'),
		);
		this.renderChoice(
			choices,
			'thisAndFollowingTasks',
			t('taskEditor', 'repeatScopeThisAndFollowing'),
			t('taskEditor', 'repeatScopeThisAndFollowingDesc'),
		);
		if (this.options.includeSkip !== false) {
			this.renderChoice(
				choices,
				'skipThisTask',
				t('taskEditor', 'repeatScopeSkipThisTask'),
				t('taskEditor', 'repeatScopeSkipThisTaskDesc'),
			);
		}

		const actions = this.contentEl.createDiv('operon-repeat-occurrence-scope-actions');
		const cancelButton = actions.createEl('button', { text: t('buttons', 'cancel') });
		cancelButton.addEventListener('click', () => this.finish(null));

		const confirmButton = actions.createEl('button', {
			text: t('taskEditor', 'repeatScopeApply'),
			cls: 'mod-cta',
		});
		confirmButton.addEventListener('click', () => this.finish(this.selectedScope));
		window.setTimeout(() => confirmButton.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onCloseResult(null);
		}
	}

	private renderSummaryRow(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv('operon-repeat-occurrence-scope-summary-row');
		row.createSpan({ cls: 'operon-repeat-occurrence-scope-summary-label', text: `${label}:` });
		row.createSpan({
			cls: 'operon-repeat-occurrence-scope-summary-value',
			text: value,
		});
	}

	private renderChoice(
		container: HTMLElement,
		value: RepeatEditScopeChoice,
		label: string,
		description: string,
	): void {
		const row = container.createEl('label', { cls: 'operon-repeat-occurrence-scope-choice' });
		const input = row.createEl('input', {
			attr: {
				type: 'radio',
				name: 'operon-repeat-occurrence-scope',
			},
		});
		input.checked = this.selectedScope === value;
		input.addEventListener('change', () => {
			this.selectedScope = value;
		});
		const body = row.createDiv('operon-repeat-occurrence-scope-choice-body');
		body.createDiv({ cls: 'operon-repeat-occurrence-scope-choice-title', text: label });
		body.createDiv({ cls: 'operon-repeat-occurrence-scope-choice-description', text: description });
	}

	private finish(result: RepeatEditScopeChoice | null): void {
		this.resolved = true;
		this.close();
		this.onCloseResult(result);
	}
}

export async function promptRepeatOccurrenceScope(
	app: App,
	options: {
		title: string;
		beforeSnapshotLabel: string;
		afterSnapshotLabel: string;
		includeSkip?: boolean;
	},
): Promise<RepeatEditScopeChoice | null> {
	return await new Promise(resolve => {
		new RepeatOccurrenceScopeModal(app, {
			title: options.title,
			beforeLabel: options.beforeSnapshotLabel,
			afterLabel: options.afterSnapshotLabel,
			includeSkip: options.includeSkip,
		}, resolve).open();
	});
}

export function buildRepeatScopeModalLabels(input: {
	current: Parameters<typeof formatRepeatTemporalSnapshot>[0];
	pending: Parameters<typeof formatRepeatTemporalSnapshot>[0];
}): { beforeLabel: string; afterLabel: string } {
	const labels = {
		unavailable: t('taskEditor', 'repeatTemporalUnavailable'),
		allDay: t('taskEditor', 'repeatTemporalAllDay'),
	};
	return {
		beforeLabel: formatRepeatTemporalSnapshot(input.current, labels),
		afterLabel: formatRepeatTemporalSnapshot(input.pending, labels),
	};
}
