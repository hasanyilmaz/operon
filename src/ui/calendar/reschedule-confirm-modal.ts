import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { CalendarWritebackPlan } from '../../types/calendar';
import { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import { ConfirmActionModal } from '../confirm-action-modal';
import {
	buildCalendarReplacementDetails,
	shouldConfirmCalendarReplacement,
	summarizeTaskCalendarAssignment,
} from './calendar-modal-helpers';

export interface RescheduleConfirmModalOptions {
	task: IndexedTask;
	writebackPlan: CalendarWritebackPlan;
	onCloseResult: (confirmed: boolean) => void;
	title?: string;
	message?: string;
	settings?: Pick<OperonSettings, 'dateDisplayFormat'>;
}

export class RescheduleConfirmModal extends ConfirmActionModal {
	constructor(app: App, options: RescheduleConfirmModalOptions) {
		super(
			app,
			{
				title: options.title ?? t('calendar', 'rescheduleReplaceTitle'),
				message: options.message ?? t('calendar', 'rescheduleReplaceMessage'),
				confirmText: t('calendar', 'replacePlan'),
				cancelText: t('calendar', 'keepCurrentPlan'),
				detailsTable: buildCalendarReplacementDetails(
					options.task,
					options.writebackPlan,
					options.settings ? { settings: options.settings } : undefined,
				),
			},
			options.onCloseResult,
		);
	}
}

export function openRescheduleConfirmIfNeeded(
	app: App,
	task: IndexedTask,
	writebackPlan: CalendarWritebackPlan,
	onCloseResult: (confirmed: boolean) => void,
	settings?: Pick<OperonSettings, 'dateDisplayFormat'>,
): boolean {
	if (!shouldConfirmCalendarReplacement(task, writebackPlan)) {
		onCloseResult(true);
		return false;
	}

	new RescheduleConfirmModal(app, {
		task,
		writebackPlan,
		onCloseResult,
		...(settings ? { settings } : {}),
		message: summarizeTaskCalendarAssignment(
			task,
			settings ? { settings } : undefined,
		).length > 0
			? t('calendar', 'rescheduleOverwriteMessage')
			: t('calendar', 'rescheduleReplaceMessage'),
	}).open();
	return true;
}
