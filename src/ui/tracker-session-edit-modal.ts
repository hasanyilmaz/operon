import { App, Modal } from 'obsidian';
import { t } from '../core/i18n';
import { localNow } from '../core/local-time';
import {
	formatDurationHuman,
	fromDatetimeLocalValue,
	parseLocalDatetime,
	toDatetimeLocalValue,
} from '../systems/tracker-utils';
import { ConfirmActionModal } from './confirm-action-modal';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import { getActiveWindow } from '../core/dom-compat';

export interface TrackerSessionEditModalOptions {
	title: string;
	initialStart?: string;
	initialEnd?: string;
	onSave: (start: string, end: string) => Promise<boolean | void> | boolean | void;
	onDelete?: () => Promise<boolean | void> | boolean | void;
}

export class TrackerSessionEditModal extends Modal {
	private readonly options: TrackerSessionEditModalOptions;

	constructor(app: App, options: TrackerSessionEditModalOptions) {
		super(app);
		this.modalEl.addClass('operon-tracker-session-edit-modal');
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('operon-tracker-session-modal');
		this.titleEl.setText(this.options.title);

		const startWrap = contentEl.createDiv('operon-tracker-session-modal-field');
		startWrap.createEl('label', { text: t('taskEditor', 'sessionStart') });
		const startRow = startWrap.createDiv('operon-tracker-session-modal-input-row');
		const startInput = startRow.createEl('input', {
			attr: {
				type: 'datetime-local',
				step: '1',
			},
		});
		startInput.value = toDatetimeLocalValue(this.options.initialStart);
		const startAdjustments = startRow.createDiv('operon-tracker-session-modal-adjustments');

		const endWrap = contentEl.createDiv('operon-tracker-session-modal-field');
		endWrap.createEl('label', { text: t('taskEditor', 'sessionEnd') });
		const endRow = endWrap.createDiv('operon-tracker-session-modal-input-row');
		const endInput = endRow.createEl('input', {
			attr: {
				type: 'datetime-local',
				step: '1',
			},
		});
		endInput.value = toDatetimeLocalValue(this.options.initialEnd);
		const endAdjustments = endRow.createDiv('operon-tracker-session-modal-adjustments');

		const durationPreview = contentEl.createDiv('operon-tracker-session-modal-preview');
		const errorEl = contentEl.createDiv('operon-tracker-session-modal-error');

		const actions = contentEl.createDiv('operon-tracker-session-modal-actions');
		const deleteButton = this.options.onDelete
			? actions.createEl('button', {
				text: t('taskEditor', 'deleteSessionConfirm'),
				cls: 'operon-tracker-session-modal-delete',
			})
			: null;
		const primaryActions = actions.createDiv('operon-tracker-session-modal-actions-primary');
		const cancelButton = primaryActions.createEl('button', { text: t('buttons', 'cancel') });
		const saveButton = primaryActions.createEl('button', {
			text: t('taskEditor', 'saveSession'),
			cls: 'mod-cta',
		});

		const getNormalizedValues = (): { start: string; end: string } => ({
			start: fromDatetimeLocalValue(startInput.value),
			end: fromDatetimeLocalValue(endInput.value),
		});

		const refresh = (): boolean => {
			const { start, end } = getNormalizedValues();
			const startDate = parseLocalDatetime(start);
			const endDate = parseLocalDatetime(end);
			const valid = !!startDate && !!endDate && endDate.getTime() > startDate.getTime();
			if (!start || !end) {
				durationPreview.setText('—');
				errorEl.setText('');
				saveButton.disabled = true;
				return false;
			}
			if (!valid) {
				durationPreview.setText('—');
				errorEl.setText(t('taskEditor', 'invalidSessionRange'));
				saveButton.disabled = true;
				return false;
			}

			const durationSeconds = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
			durationPreview.setText(formatDurationHuman(durationSeconds));
			errorEl.setText('');
			saveButton.disabled = false;
			return true;
		};

		const formatDateTimeLocal = (date: Date): string => {
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			const hours = String(date.getHours()).padStart(2, '0');
			const minutes = String(date.getMinutes()).padStart(2, '0');
			const seconds = String(date.getSeconds()).padStart(2, '0');
			return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
		};

		const adjustInputMinutes = (input: HTMLInputElement, deltaMinutes: number): void => {
			const rawValue = input.value.trim();
			const normalized = rawValue ? fromDatetimeLocalValue(rawValue) : localNow();
			const parsed = parseLocalDatetime(normalized);
			if (!parsed) return;
			parsed.setMinutes(parsed.getMinutes() + deltaMinutes);
			input.value = formatDateTimeLocal(parsed);
			refresh();
		};

		const createAdjustmentButton = (
			container: HTMLElement,
			label: string,
			input: HTMLInputElement,
			deltaMinutes: number,
		): HTMLButtonElement => {
			const button = container.createEl('button', {
				text: label,
				cls: 'operon-tracker-session-modal-adjust-button',
				attr: { type: 'button' },
			});
			button.addEventListener('click', () => {
				adjustInputMinutes(input, deltaMinutes);
			});
			return button;
		};

		const startPlusButton = createAdjustmentButton(startAdjustments, t('taskEditor', 'sessionAddFiveMinutes'), startInput, 5);
		const startMinusButton = createAdjustmentButton(startAdjustments, t('taskEditor', 'sessionSubtractFiveMinutes'), startInput, -5);
		const endPlusButton = createAdjustmentButton(endAdjustments, t('taskEditor', 'sessionAddFiveMinutes'), endInput, 5);
		const endMinusButton = createAdjustmentButton(endAdjustments, t('taskEditor', 'sessionSubtractFiveMinutes'), endInput, -5);

		const submit = async (): Promise<void> => {
			if (!refresh()) return;
			const { start, end } = getNormalizedValues();
			this.close();
			getActiveWindow().setTimeout(() => {
				void Promise.resolve(this.options.onSave(start, end)).catch((error: unknown) => {
					console.error('Operon: tracker session background save failed', error);
				});
			}, 0);
		};

		const setActionDisabled = (disabled: boolean) => {
			if (deleteButton) deleteButton.disabled = disabled;
			cancelButton.disabled = disabled;
			saveButton.disabled = disabled;
			startPlusButton.disabled = disabled;
			startMinusButton.disabled = disabled;
			endPlusButton.disabled = disabled;
			endMinusButton.disabled = disabled;
		};

		const remove = () => {
			if (!this.options.onDelete) return;
			const { start, end } = getNormalizedValues();
			new ConfirmActionModal(this.app, {
				title: t('taskEditor', 'deleteSessionTitle'),
				message: t('taskEditor', 'deleteSessionMessage', {
					range: `${start || this.options.initialStart || ''} - ${end || this.options.initialEnd || ''}`,
				}),
				confirmText: t('taskEditor', 'deleteSessionConfirm'),
				cancelText: t('buttons', 'cancel'),
			}, asyncHandler('tracker session delete failed', async confirmed => {
				if (!confirmed) return;
				setActionDisabled(true);
				const result = await this.options.onDelete?.();
				if (result === false) {
					setActionDisabled(false);
					refresh();
					return;
				}
				this.close();
			})).open();
		};

		startInput.addEventListener('input', refresh);
		endInput.addEventListener('input', refresh);
		startInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
					event.preventDefault();
					runAsyncAction('tracker session submit failed', submit);
				}
			});
		endInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
					event.preventDefault();
					runAsyncAction('tracker session submit failed', submit);
				}
			});

		cancelButton.addEventListener('click', () => this.close());
		deleteButton?.addEventListener('click', remove);
			saveButton.addEventListener('click', () => {
				runAsyncAction('tracker session submit failed', submit);
			});

		refresh();
		window.setTimeout(() => startInput.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
