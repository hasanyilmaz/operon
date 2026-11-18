import { Notice, type App } from 'obsidian';
import { getOwnerWindow } from '../../core/dom-compat';
import { t } from '../../core/i18n';
import { capturePropertyIconEdit, propertyIconEditMatches, type PropertyIconEdit, type PropertyIconSettings } from '../../core/property-icons';
import type { TaskEditorPropertyRef } from '../../types/task-editor-sections';
import { refreshMountedPropertyIcons } from '../property-icon-presentation';
import { openSettingsIconPickerModal } from './settings-icon-picker-modal';

interface PropertyIconPickerOptions {
	anchor: HTMLButtonElement;
	field: TaskEditorPropertyRef;
	label: string;
	fallback: string;
	settings: () => PropertyIconSettings;
	save: (edit: PropertyIconEdit, icon: string) => Promise<boolean>;
	onCommitted?: () => void;
	onClose?: () => void;
}

export function openPropertyIconPicker(app: App, options: PropertyIconPickerOptions): (() => void) | null {
	const { anchor, field, label, fallback, settings } = options;
	const edit = capturePropertyIconEdit(settings(), field);
	if (!edit) {
		new Notice(t('settings', 'propertyIconUnavailable', { name: label }));
		return null;
	}
	const save = async (icon: string): Promise<void> => {
		if (!await options.save(edit, icon)) return;
		refreshMountedPropertyIcons(app);
		options.onCommitted?.();
	};
	anchor.focus({ preventScroll: true });
	const modal = openSettingsIconPickerModal(app, {
		settingsScope: true,
		title: t('settings', 'propertyIconChange', { name: label }),
		value: edit.icon || fallback,
		onSelect: save,
		onClear: () => save(''),
		onSaveError: error => {
			console.error('Operon: Property icon save failed', error);
			new Notice(t('settings', propertyIconEditMatches(settings(), edit) ? 'propertyIconSaveFailed' : 'propertyIconUnavailable', { name: label }));
		},
		onClose: () => {
			options.onClose?.();
			getOwnerWindow(anchor).requestAnimationFrame(() => {
				const active = anchor.ownerDocument.activeElement;
				if (anchor.isConnected && (!active || active === anchor.ownerDocument.body || modal.modalEl.contains(active))) {
					anchor.focus({ preventScroll: true });
				}
			});
		},
	});
	return () => modal.close();
}
