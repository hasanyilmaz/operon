import { App, Modal } from 'obsidian';
import { t } from '../../core/i18n';
import { getOwnerDocument, getOwnerWindow } from '../../core/dom-compat';

export type CalendarSlotActionId = 'pickTask' | 'createFileTask' | 'createInlineTask' | 'createTrackedSession';

export interface CalendarSlotActionOption {
	id: CalendarSlotActionId;
	label: string;
	iconLabel: string;
	disabled?: boolean;
	disabledReason?: string;
}

export interface SlotActionModalOptions {
	title?: string;
	selectionLabel?: string;
	actions?: CalendarSlotActionId[];
	inlineTaskEnabled: boolean;
	inlineTaskDisabledReason?: string;
	onChooseAction: (actionId: CalendarSlotActionId) => void;
	onCancel?: () => void;
	preventInitialFocusScroll?: boolean;
}

export function buildCalendarSlotActionOptions(
	options: Pick<SlotActionModalOptions, 'actions' | 'inlineTaskEnabled' | 'inlineTaskDisabledReason'>,
): CalendarSlotActionOption[] {
	const allowedActions = new Set<CalendarSlotActionId>(options.actions ?? ['pickTask', 'createFileTask', 'createInlineTask']);
	const allActions: CalendarSlotActionOption[] = [
		{
			id: 'pickTask',
			label: t('calendar', 'slotActionPickTask'),
			iconLabel: 'Ex',
		},
		{
			id: 'createFileTask',
			label: t('calendar', 'slotActionCreateFileTask'),
			iconLabel: 'Fi',
		},
		{
			id: 'createInlineTask',
			label: t('calendar', 'slotActionCreateInlineTask'),
			iconLabel: 'In',
			disabled: !options.inlineTaskEnabled,
			disabledReason: !options.inlineTaskEnabled
				? (options.inlineTaskDisabledReason ?? t('notifications', 'dailyNoteUnavailable'))
				: undefined,
		},
		{
			id: 'createTrackedSession',
			label: t('calendar', 'slotActionCreateTrackedSession'),
			iconLabel: 'TS',
		},
	];
	return allActions.filter(action => allowedActions.has(action.id));
}

export class SlotActionModal extends Modal {
	private readonly options: SlotActionModalOptions;
	private readonly actions: CalendarSlotActionOption[];
	private buttons: HTMLButtonElement[] = [];
	private resolved = false;

	constructor(app: App, options: SlotActionModalOptions) {
		super(app);
		this.options = options;
		this.actions = buildCalendarSlotActionOptions(options);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('operon-calendar-slot-action-modal');
		contentEl.empty();
		this.titleEl.setText(this.options.title ?? t('calendar', 'slotActionChooseCalendarAction'));

		if (this.options.selectionLabel) {
			contentEl.createDiv({
				cls: 'operon-calendar-slot-action-selection',
				text: this.options.selectionLabel,
			});
		}

		const list = contentEl.createDiv('operon-calendar-slot-action-list');
		this.buttons = this.actions.map(action => {
			const button = list.createEl('button', {
				cls: 'operon-calendar-slot-action-button',
				attr: {
					type: 'button',
					'data-action-id': action.id,
				},
			});
			button.disabled = action.disabled === true;
			const topRow = button.createDiv('operon-calendar-slot-action-top-row');
			const iconWrap = topRow.createDiv('operon-calendar-slot-action-icon');
			iconWrap.setText(action.iconLabel);
			topRow.createDiv({
				cls: 'operon-calendar-slot-action-label',
				text: action.label,
			});
			if (action.disabledReason) {
				button.createDiv({
					cls: 'operon-calendar-slot-action-disabled-reason',
					text: action.disabledReason,
				});
			}
			button.addEventListener('click', () => {
				if (action.disabled) return;
				this.finish(action.id);
			});
			return button;
		});

		contentEl.addEventListener('keydown', this.handleKeydown);

			const initialButton = this.buttons.find(button => !button.disabled) ?? this.buttons[0];
			getOwnerWindow(contentEl).setTimeout(() => {
				initialButton?.focus({ preventScroll: this.options.preventInitialFocusScroll === true });
			}, 0);
	}

	onClose(): void {
		this.contentEl.removeEventListener('keydown', this.handleKeydown);
		this.contentEl.empty();
		if (!this.resolved) {
			this.options.onCancel?.();
		}
	}

	private readonly handleKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
			return;
		}
		event.preventDefault();
		const enabledButtons = this.buttons.filter(button => !button.disabled);
		if (enabledButtons.length === 0) return;

		const activeElement = getOwnerDocument(this.contentEl).activeElement as HTMLButtonElement | null;
		const currentIndex = Math.max(0, enabledButtons.indexOf(activeElement ?? enabledButtons[0]));
		let nextIndex = currentIndex;

		if (event.key === 'ArrowDown') nextIndex = Math.min(enabledButtons.length - 1, currentIndex + 1);
		if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = enabledButtons.length - 1;

		enabledButtons[nextIndex]?.focus();
	};

	private finish(actionId: CalendarSlotActionId): void {
		this.resolved = true;
		this.close();
		this.options.onChooseAction(actionId);
	}
}
