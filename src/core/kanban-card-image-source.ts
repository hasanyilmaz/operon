import type { KanbanCardImageSource } from '../types/kanban';
import { t } from './i18n';
import {
	parseTaskMediaReferenceList,
	resolveTaskMediaReference,
	type TaskMediaReferenceResolution,
} from './task-media-reference';

const KANBAN_CARD_IMAGE_SOURCE_LABEL_KEYS: Record<KanbanCardImageSource, string> = {
	none: 'kanbanCardImageSource_none',
	taskImage: 'kanbanCardImageSource_taskImage',
	taskGalleryFirst: 'kanbanCardImageSource_taskGalleryFirst',
	taskGalleryLast: 'kanbanCardImageSource_taskGalleryLast',
};

export interface KanbanCardImageSourceDropdown {
	addOption(value: string, label: string): unknown;
}

export function addKanbanCardImageSourceOptions(dropdown: KanbanCardImageSourceDropdown): void {
	for (const source of Object.keys(KANBAN_CARD_IMAGE_SOURCE_LABEL_KEYS) as KanbanCardImageSource[]) {
		dropdown.addOption(source, t('settings', KANBAN_CARD_IMAGE_SOURCE_LABEL_KEYS[source]));
	}
}

/** Select one openable task-media reference for a Kanban card cover. */
export function resolveKanbanCardImageReference(
	fieldValues: Readonly<Record<string, string | undefined>>,
	source: KanbanCardImageSource,
): TaskMediaReferenceResolution | null {
	if (source === 'none') return null;
	if (source === 'taskImage') {
		const resolved = resolveTaskMediaReference(fieldValues['taskImage']);
		return resolved.isOpenable ? resolved : null;
	}

	const gallery = parseTaskMediaReferenceList(fieldValues['taskGallery'])
		.map(value => resolveTaskMediaReference(value))
		.filter(resolved => resolved.isOpenable);
	if (gallery.length === 0) return null;
	return source === 'taskGalleryLast' ? gallery[gallery.length - 1] : gallery[0];
}
