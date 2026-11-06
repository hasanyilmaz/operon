import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { isWritableRawYamlPropertyName } from './raw-yaml-property';
import { getVisiblePropertyName } from './yaml-fields';

/** Only creation calls this helper. Reading or changing settings never rewrites existing files. */
export function newFileTaskTitleFields(
	title: string,
	fields: Readonly<Record<string, string>>,
	settings: Pick<OperonSettings, 'fileTaskDisplayTitleEnabled' | 'keyMappings'>,
): Record<string, string> {
	if (!settings.fileTaskDisplayTitleEnabled) return { ...fields };
	const name = getVisiblePropertyName('fileTaskDisplayTitle', settings.keyMappings);
	if (!isWritableRawYamlPropertyName(name, settings.keyMappings, 'fileTaskDisplayTitle')) {
		throw new Error('The File Task display title mapping is unavailable or conflicts with another property.');
	}
	return { ...fields, fileTaskDisplayTitle: title };
}

export function getFileTaskDisplayTitle(
	description: string,
	fieldValues: Readonly<Record<string, string>>,
	format: IndexedTask['primary']['format'],
	displayTitleEnabled: boolean,
): string {
	if (!displayTitleEnabled || format !== 'yaml') return description;
	const title = fieldValues['fileTaskDisplayTitle'];
	return typeof title === 'string' && title.trim() ? title : description;
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
