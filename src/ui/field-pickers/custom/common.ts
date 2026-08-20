import { createFloatingPanel } from '../common';

export type CustomFieldPickerType = 'text' | 'list' | 'number' | 'date' | 'datetime';

export interface CustomFieldPickerBaseOptions<T extends CustomFieldPickerType> {
	canonicalKey: string;
	type: T;
	label: string;
	placeholder?: string;
	/** Narrows text/list handling to safe task-media reference values. */
	mediaReference?: boolean;
	retainInputFocus?: boolean;
	onCancel?: () => void;
	onClose?: () => void;
}

export interface CustomScalarFieldPickerOptions<T extends CustomFieldPickerType> extends CustomFieldPickerBaseOptions<T> {
	value?: string;
	onCommit: (canonicalKey: string, value: string) => void;
	onRemove?: (canonicalKey: string) => void;
	canRemove?: boolean;
}

export function createCustomFieldPanel<T extends CustomFieldPickerType>(
	anchor: HTMLElement | DOMRect,
	options: CustomFieldPickerBaseOptions<T>,
	onDismiss: () => void,
): ReturnType<typeof createFloatingPanel> {
	const { panel, close } = createFloatingPanel(
		anchor,
		`operon-floating-panel operon-custom-field-picker operon-custom-field-picker--${options.type} operon-custom-${options.type}-picker-panel`,
		onDismiss,
		{ retainInputFocus: options.retainInputFocus },
	);
	panel.dataset.operonCustomFieldKey = options.canonicalKey;
	panel.dataset.operonCustomFieldType = options.type;
	if (options.mediaReference) panel.dataset.operonMediaReference = 'true';
	return { panel, close };
}
