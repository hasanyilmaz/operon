import type { App } from 'obsidian';
import { parseTaskMediaReferenceList } from '../core/task-media-reference';
import type { IndexedTask } from '../types/fields';
import { TASK_DATA_CANONICAL_KEY_SET } from '../types/keys';
import { isRetiredKeyMapping, type KeyMapping } from '../types/settings';

export type TaskDataFieldPickerType = 'text' | 'list';

export interface ManagedTaskDataFieldPicker {
	canonicalKey: 'taskType' | 'taskImage' | 'taskGallery';
	type: TaskDataFieldPickerType;
	label: string;
	mediaReference: boolean;
	mapping: KeyMapping;
}

const TASK_DATA_FIELD_PICKER_SPECS: Record<ManagedTaskDataFieldPicker['canonicalKey'], {
	type: TaskDataFieldPickerType;
	mediaReference: boolean;
}> = {
	taskType: { type: 'text', mediaReference: false },
	taskImage: { type: 'text', mediaReference: true },
	taskGallery: { type: 'list', mediaReference: true },
};

/**
 * Admits only the three canonical, system-owned task-data mappings to the
 * shared picker infrastructure. Custom-field admission remains unchanged.
 */
export function getManagedTaskDataFieldPicker(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[] | null | undefined,
): ManagedTaskDataFieldPicker | null {
	if (!TASK_DATA_CANONICAL_KEY_SET.has(canonicalKey)) return null;
	const key = canonicalKey as ManagedTaskDataFieldPicker['canonicalKey'];
	const spec = TASK_DATA_FIELD_PICKER_SPECS[key];
	const mapping = keyMappings?.find(candidate => candidate.canonicalKey === key) ?? null;
	if (
		!mapping
		|| mapping.isSystem !== true
		|| mapping.isInternal === true
		|| isRetiredKeyMapping(mapping.canonicalKey)
		|| mapping.type !== spec.type
	) return null;
	return {
		canonicalKey: key,
		type: spec.type,
		label: mapping.visiblePropertyName?.trim() || key,
		mediaReference: spec.mediaReference,
		mapping,
	};
}

/**
 * Reads media candidates with the same typed grammar used for persistence.
 * YAML arrays are kept item-wise so a literal semicolon never becomes a
 * separator merely because the value came from frontmatter.
 */
export function collectManagedTaskDataFieldValueCandidates(
	app: Pick<App, 'metadataCache' | 'vault'> | null | undefined,
	tasks: readonly IndexedTask[],
	field: ManagedTaskDataFieldPicker,
): string[] {
	const values = new Set<string>();
	const remember = (rawValue: unknown): void => {
		if (field.canonicalKey === 'taskGallery') {
			for (const value of normalizeTaskGalleryCandidateValues(rawValue)) values.add(value);
			return;
		}
		const value = normalizeTaskDataCandidateValue(rawValue);
		if (value) values.add(value);
	};
	for (const task of tasks) remember((task.fieldValues as Record<string, unknown>)[field.canonicalKey]);
	if (app) {
		const fieldNames = new Set([
			field.canonicalKey,
			field.mapping.visiblePropertyName,
		].map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
		for (const file of app.vault.getMarkdownFiles()) {
			const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!frontmatter) continue;
			for (const [name, value] of Object.entries(frontmatter)) {
				if (fieldNames.has(name.trim().toLocaleLowerCase())) remember(value);
			}
		}
	}
	return [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function normalizeTaskGalleryCandidateValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		const seen = new Set<string>();
		const items: string[] = [];
		for (const item of value) {
			for (const candidate of normalizeTaskGalleryArrayItem(item)) {
				if (seen.has(candidate)) continue;
				seen.add(candidate);
				items.push(candidate);
			}
		}
		return items;
	}
	if (typeof value !== 'string') return [];
	return parseTaskMediaReferenceList(value);
}

function normalizeTaskGalleryArrayItem(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(normalizeTaskGalleryArrayItem);
	const normalized = normalizeTaskDataCandidateValue(value);
	return normalized ? [normalized] : [];
}

function normalizeTaskDataCandidateValue(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}
