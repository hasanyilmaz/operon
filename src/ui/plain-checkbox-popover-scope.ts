export const PLAIN_CHECKBOX_POPOVER_PANEL_CLASS = 'operon-plain-checkbox-popover-panel';
export const PLAIN_CHECKBOX_POPOVER_EDITOR_HOST_CLASS = 'operon-plain-checkbox-popover-cm-host';
export const PLAIN_CHECKBOX_POPOVER_EDITOR_CLASS = 'operon-plain-checkbox-popover-cm-editor';

export function isPlainCheckboxPopoverEditorElement(element: Element): boolean {
	return element.closest([
		`.${PLAIN_CHECKBOX_POPOVER_PANEL_CLASS}`,
		`.${PLAIN_CHECKBOX_POPOVER_EDITOR_HOST_CLASS}`,
		`.${PLAIN_CHECKBOX_POPOVER_EDITOR_CLASS}`,
	].join(',')) !== null;
}
