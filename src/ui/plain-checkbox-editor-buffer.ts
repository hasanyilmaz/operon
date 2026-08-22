export const PLAIN_CHECKBOX_EDITOR_ROOT_LINE = '- operon-plain-checkbox-root';

const PLAIN_CHECKBOX_EDITOR_ROOT_PREFIX = `${PLAIN_CHECKBOX_EDITOR_ROOT_LINE}\n`;

export function projectPlainCheckboxEditorValue(value: string): string {
	return `${PLAIN_CHECKBOX_EDITOR_ROOT_PREFIX}${unprojectPlainCheckboxEditorValue(value)}`;
}

export function unprojectPlainCheckboxEditorValue(value: string): string {
	return value.startsWith(PLAIN_CHECKBOX_EDITOR_ROOT_PREFIX)
		? value.slice(PLAIN_CHECKBOX_EDITOR_ROOT_PREFIX.length)
		: value;
}
