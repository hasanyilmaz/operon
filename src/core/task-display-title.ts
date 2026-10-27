import type { IndexedTask } from '../types/fields';

export function getFileTaskDisplayTitle(
	description: string,
	fieldValues: Readonly<Record<string, string>>,
	format: IndexedTask['primary']['format'],
	displayTitleEnabled: boolean,
): string {
	if (!displayTitleEnabled || format !== 'yaml') return description;
	return fieldValues['fileTaskDisplayTitle']?.trim() || description;
}

export function getTaskDisplayTitle(
	task: Pick<IndexedTask, 'description' | 'fieldValues' | 'primary'>,
	displayTitleEnabled: boolean,
): string {
	return getFileTaskDisplayTitle(
		task.description,
		task.fieldValues,
		task.primary.format,
		displayTitleEnabled,
	);
}
