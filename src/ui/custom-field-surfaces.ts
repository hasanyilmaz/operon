import type { App } from 'obsidian';
import { splitTaskListValue } from '../core/task-field-patch';
import { isRetiredKeyMapping, KeyMapping, OperonSettings } from '../types/settings';
import { IndexedTask } from '../types/fields';
import {
	compareManagedCustomFieldMappings,
	getManagedCustomKeyMapping,
	isManagedCustomFieldMapping,
	isManagedCustomFieldOptionType,
	normalizeManagedFieldValue,
} from '../core/managed-task-fields';

export type CustomFieldSurface = 'editor' | 'creator' | 'chips';

const CUSTOM_FIELD_TYPE_FALLBACK_ICONS: Record<KeyMapping['type'], string> = {
	text: 'text',
	number: 'hash',
	date: 'calendar',
	datetime: 'clock-3',
	list: 'list',
	checkbox: 'square-check',
};

interface VaultFrontmatterCandidateCache {
	fileCount: number;
	dirty: boolean;
	byFieldName: Map<string, Set<string>>;
}

const vaultFrontmatterCandidateCaches = new WeakMap<object, VaultFrontmatterCandidateCache>();

export function isCustomFieldMapping(mapping: KeyMapping): boolean {
	return isManagedCustomFieldMapping(mapping);
}

export function isProjectedCustomFieldType(mapping: KeyMapping): boolean {
	return isManagedCustomFieldOptionType(mapping);
}

export function getCustomFieldLabel(mapping: KeyMapping): string {
	return mapping.visiblePropertyName?.trim() || mapping.canonicalKey;
}

export function getCustomFieldIcon(mapping: KeyMapping): string {
	return mapping.icon?.trim() || getCustomFieldTypeFallbackIcon(mapping.type);
}

export function getCustomFieldTypeFallbackIcon(type: KeyMapping['type']): string {
	return CUSTOM_FIELD_TYPE_FALLBACK_ICONS[type] || 'text';
}

export function getCustomFieldMapping(
	keyMappings: readonly KeyMapping[] | null | undefined,
	canonicalKey: string,
): KeyMapping | null {
	const mapping = getManagedCustomKeyMapping(canonicalKey, keyMappings);
	return mapping && isCustomFieldMapping(mapping) ? mapping : null;
}

export function isManagedSurfaceField(
	keyMappings: readonly KeyMapping[] | null | undefined,
	canonicalKey: string,
): boolean {
	if (!isKeyMappingArray(keyMappings)) return false;
	return keyMappings.some(mapping => mapping.canonicalKey === canonicalKey && !isRetiredKeyMapping(mapping.canonicalKey));
}

type CustomSurfaceItem = { key: string; visible: boolean };

type CustomSurfaceSettings = Pick<OperonSettings, 'keyMappings'> & Partial<Pick<
	OperonSettings,
	| 'taskCreatorToolbar'
	| 'taskEditorWorkflowPickers'
	| 'taskEditorMobileCoreTools'
	| 'inlineTaskCompactChips'
	| 'taskFinderCompactChips'
	| 'filterTaskCompactChips'
	| 'kanbanTaskCompactChips'
	| 'taskWikilinkOverlayCompactChips'
>>;

export function getCustomSurfaceKeyMappings(
	settings: CustomSurfaceSettings | null | undefined,
	surface: CustomFieldSurface,
): KeyMapping[] {
	const keyMappings = Array.isArray(settings?.keyMappings) ? settings.keyMappings : [];
	try {
		const customMappings = keyMappings
			.filter(mapping => isCustomFieldMapping(mapping))
			.filter(mapping => isProjectedCustomFieldType(mapping))
			.sort(compareManagedCustomFieldMappings);
		const customByKey = new Map(customMappings.map(mapping => [mapping.canonicalKey, mapping] as const));
		const surfaceItems = getCustomSurfaceItems(settings, surface);
		const ordered: KeyMapping[] = [];
		const seen = new Set<string>();

		for (const item of surfaceItems) {
			const mapping = customByKey.get(item.key);
			if (!mapping || seen.has(mapping.canonicalKey)) continue;
			seen.add(mapping.canonicalKey);
			if (item.visible) ordered.push(mapping);
		}

		for (const mapping of customMappings) {
			if (seen.has(mapping.canonicalKey)) continue;
			if (getCustomSurfaceFallbackVisibility(mapping, surface)) ordered.push(mapping);
		}

		return ordered;
	} catch {
		return [];
	}
}

function getCustomSurfaceItems(
	settings: CustomSurfaceSettings | null | undefined,
	surface: CustomFieldSurface,
): CustomSurfaceItem[] {
	const collect = (items: unknown): CustomSurfaceItem[] => {
		if (!Array.isArray(items)) return [];
		return items.filter((item): item is CustomSurfaceItem =>
			!!item
			&& typeof item === 'object'
			&& typeof (item as CustomSurfaceItem).key === 'string'
			&& typeof (item as CustomSurfaceItem).visible === 'boolean');
	};
	if (!settings) return [];
	if (surface === 'creator') return collect(settings.taskCreatorToolbar);
	if (surface === 'chips') {
		return [
			...collect(settings.inlineTaskCompactChips),
			...collect(settings.taskFinderCompactChips),
			...collect(settings.filterTaskCompactChips),
			...collect(settings.kanbanTaskCompactChips),
			...collect(settings.taskWikilinkOverlayCompactChips),
		];
	}
	return [
		...collect(settings.taskEditorWorkflowPickers),
		...collect(settings.taskEditorMobileCoreTools),
	];
}

function getCustomSurfaceFallbackVisibility(mapping: KeyMapping, surface: CustomFieldSurface): boolean {
	if (surface === 'editor') return mapping.showInEditor !== false;
	if (surface === 'creator') return mapping.showInCreator !== false;
	return mapping.showInChips === true;
}

export function collectCustomFieldValueCandidates(
	app: Pick<App, 'metadataCache' | 'vault'> | null | undefined,
	tasks: readonly IndexedTask[],
	mapping: Pick<KeyMapping, 'canonicalKey' | 'visiblePropertyName' | 'type'>,
): string[] {
	const candidates = new Set<string>();
	const rememberValue = (rawValue: unknown): void => {
		const normalized = normalizeCustomFieldRawValue(rawValue);
		if (!normalized) return;
		if (mapping.type === 'list') {
			for (const item of splitTaskListValue(normalized)) {
				if (item) candidates.add(item);
			}
			return;
		}
		candidates.add(normalized.trim());
	};

	for (const task of tasks) {
		rememberValue((task.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
	}

	const fieldNames = new Set<string>([mapping.canonicalKey.toLocaleLowerCase()]);
	const visiblePropertyName = mapping.visiblePropertyName?.trim();
	if (visiblePropertyName) fieldNames.add(visiblePropertyName.toLocaleLowerCase());
	const vaultIndex = getVaultFrontmatterCandidateIndex(app);
	for (const fieldName of fieldNames) {
		for (const value of vaultIndex?.get(fieldName) ?? []) {
			rememberValue(value);
		}
	}

	return Array.from(candidates).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function normalizeCustomFieldRawValue(value: unknown): string {
	return normalizeManagedFieldValue(value);
}

export function invalidateCustomFieldValueCandidateCache(
	app: Pick<App, 'metadataCache' | 'vault'> | null | undefined,
): void {
	if (!app) return;
	const cache = vaultFrontmatterCandidateCaches.get(app);
	if (cache) cache.dirty = true;
}

function getVaultFrontmatterCandidateIndex(
	app: Pick<App, 'metadataCache' | 'vault'> | null | undefined,
): Map<string, Set<string>> | null {
	if (!app) return null;
	const files = app.vault.getMarkdownFiles();
	const cacheKey = app;
	let cache = vaultFrontmatterCandidateCaches.get(cacheKey);
	if (cache && !cache.dirty && cache.fileCount === files.length) {
		return cache.byFieldName;
	}

	if (!cache) {
		cache = {
			fileCount: 0,
			dirty: false,
			byFieldName: new Map(),
		};
		vaultFrontmatterCandidateCaches.set(cacheKey, cache);
	}

	cache.fileCount = files.length;
	cache.dirty = false;
	cache.byFieldName = buildVaultFrontmatterCandidateIndex(app, files);
	return cache.byFieldName;
}

function buildVaultFrontmatterCandidateIndex(
	app: Pick<App, 'metadataCache' | 'vault'>,
	files: ReturnType<App['vault']['getMarkdownFiles']>,
): Map<string, Set<string>> {
	const byFieldName = new Map<string, Set<string>>();
	for (const file of files) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const [key, rawValue] of Object.entries(fm)) {
			const normalizedKey = key.trim().toLocaleLowerCase();
			if (!normalizedKey) continue;
			let bucket = byFieldName.get(normalizedKey);
			if (!bucket) {
				bucket = new Set<string>();
				byFieldName.set(normalizedKey, bucket);
			}
			rememberVaultFrontmatterCandidateValue(bucket, rawValue);
		}
	}
	return byFieldName;
}

function rememberVaultFrontmatterCandidateValue(bucket: Set<string>, rawValue: unknown): void {
	if (Array.isArray(rawValue)) {
		for (const item of rawValue) rememberVaultFrontmatterCandidateValue(bucket, item);
		return;
	}
	const normalized = normalizeCustomFieldRawValue(rawValue);
	if (normalized) bucket.add(normalized);
}

function isKeyMappingArray(value: readonly KeyMapping[] | null | undefined): value is readonly KeyMapping[] {
	return Array.isArray(value);
}
