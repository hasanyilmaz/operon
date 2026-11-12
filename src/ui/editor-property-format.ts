import type { App } from 'obsidian';
import type { ReminderPickerFieldKey } from '../core/reminder-list-mutation';
import { formatUiTaskDatetime } from '../core/ui-time-format';
import type { OperonSettings } from '../types/settings';
export function scheduleTaskEditorReminderFocus(options: {
	ownerWindow: Window;
	fieldKey: ReminderPickerFieldKey;
	focusIndex: number;
	getWorkflowRows: () => HTMLElement | null;
	getActionButton: () => HTMLButtonElement | undefined;
	shouldFocus?: () => boolean;
}): void {
	options.ownerWindow.requestAnimationFrame(() => {
		if (options.shouldFocus && !options.shouldFocus()) return;
		const chip = options.focusIndex >= 0
			? Array.from(
				options.getWorkflowRows()?.querySelectorAll<HTMLElement>('.operon-editor-reminder-chip') ?? [],
			).find(candidate => (
				candidate.dataset.fieldKey === options.fieldKey
				&& candidate.dataset.reminderIndex === String(options.focusIndex)
			))
			: undefined;
		const target = chip?.isConnected ? chip : options.getActionButton();
		if (target?.isConnected) target.focus({ preventScroll: true });
	});
}

export function formatTaskEditorDatetime(app: App, settings: OperonSettings, value: string): string {
	return formatUiTaskDatetime(app, settings, value);
}

export function normalizeListValues(values: string[]): string[] {
	return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
