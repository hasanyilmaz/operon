import { Platform, type App } from 'obsidian';
import { getManagedYamlAliases } from '../core/yaml-fields';
import { parseListValue } from '../core/parser';
import { encodeVaultPropertyValue, type VaultPropertyValue } from '../core/vault-property-codec';
import { getNativePropertyIndex } from '../indexer/native-property-index';
import { nativePropertyValueReadOnlyReason } from '../core/task-editor-native-properties';
import { isRetiredKeyMapping, KeyMapping, OperonSettings, type FilterFieldType } from '../types/settings';
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
	checkbox: 'square-dashed',
};

interface VaultFrontmatterCandidateCache {
	fileCount: number;
	dirty: boolean;
	byFieldName: Map<string, Set<string>>;
	scalarByFieldName: Map<string, Set<string>>;
	typedByFieldName: Map<string, Map<string, VaultPropertyValue>>;
}

const vaultFrontmatterCandidateCaches = new WeakMap<object, VaultFrontmatterCandidateCache>();

export function isCustomFieldMapping(mapping: KeyMapping): boolean {
	return isManagedCustomFieldMapping(mapping);
}

export function isProjectedCustomFieldType(mapping: KeyMapping): boolean {
	return isManagedCustomFieldOptionType(mapping);
}

export function getCustomFieldLabel(mapping: Pick<KeyMapping, 'visiblePropertyName' | 'canonicalKey'>): string {
	return mapping.visiblePropertyName?.trim() || mapping.canonicalKey;
}

export function getCustomFieldIcon(mapping: Pick<KeyMapping, 'type' | 'icon'>): string {
	return mapping.icon?.trim() || getCustomFieldTypeFallbackIcon(mapping.type);
}

export function getNativePropertyIcon(mappings: readonly KeyMapping[], name: string, fallback: string): string {
 const identity = name.trim().toLowerCase();
 const matches = mappings.filter(mapping => isManagedCustomFieldMapping(mapping)
  && [mapping.canonicalKey, mapping.visiblePropertyName].some(alias => alias.trim().toLowerCase() === identity));
 return matches.length === 1 ? matches[0].icon?.trim() || fallback : fallback;
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
	| 'taskCardCompactChips'
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
 ...collect(settings.taskCardCompactChips),
			...collect(settings.taskWikilinkOverlayCompactChips),
		];
	}
	if (!Platform.isPhone) return [];
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
	const scalarOnly = mapping.type === 'number' || mapping.type === 'checkbox';
	const rememberValue = (rawValue: unknown): void => {
		if (scalarOnly && Array.isArray(rawValue)) return;
		const normalized = normalizeCustomFieldRawValue(rawValue);
		if (!normalized) return;
		if (mapping.type === 'list') {
			for (const item of parseListValue(normalized)) {
				if (item) candidates.add(item);
			}
			return;
		}
		candidates.add(normalized.trim());
	};

	for (const task of tasks) {
		// YAML projection loses native array/scalar distinctions; use raw metadata below.
		if (scalarOnly && task.primary?.format === 'yaml') continue;
		rememberValue((task.fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
	}

	const fieldNames = new Set<string>([mapping.canonicalKey.toLocaleLowerCase()]);
	const visiblePropertyName = mapping.visiblePropertyName?.trim();
	if (visiblePropertyName) fieldNames.add(visiblePropertyName.toLocaleLowerCase());
	const vaultIndex = getVaultFrontmatterCandidateIndex(app, scalarOnly);
	for (const fieldName of fieldNames) {
		for (const value of vaultIndex?.get(fieldName) ?? []) {
			rememberValue(value);
		}
	}

	return Array.from(candidates).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Native picker suggestions share the typed vault pool and ready task index. Never read sources or write drafts. */
export function collectNativeFieldValueCandidates(
 app: App, tasks: readonly IndexedTask[], mappings: readonly KeyMapping[], sourceName: string, type: FilterFieldType,
): string[] {
 if (type !== 'text' && type !== 'list') return [];
 const identity = sourceName.trim().toLowerCase();
 const matches = mappings.filter(mapping => [mapping.canonicalKey, mapping.visiblePropertyName]
  .some(name => name.trim().toLowerCase() === identity));
 if (matches.length > 1 || matches.length === 1 && matches[0].type !== type) return [];
 const aliases = [...new Set([sourceName, ...(matches.length ? getManagedYamlAliases(matches[0].canonicalKey, [matches[0]]) : [])]
  .map(name => name.trim().toLowerCase()))];
 const candidates = new Set<string>();
 const remember = (value: unknown): void => {
  if (value === undefined || value === null || nativePropertyValueReadOnlyReason(value, type)) return;
  if (type === 'list') {
   if (Array.isArray(value)) for (const member of value) candidates.add(encodeVaultPropertyValue([member], 'list'));
  } else if (typeof value === 'string' && value.trim()) candidates.add(value);
 };
 const index = getNativePropertyIndex(app);
 for (const task of tasks) {
  const row = index.getTask(task);
  if (!row.available) continue;
  const properties = aliases.flatMap(alias => row.properties.has(alias) ? [row.properties.get(alias)!] : []);
  if (properties.length === 1 && !properties[0].reason && properties[0].type === type) remember(properties[0].value);
 }
 for (const value of getVaultPropertyValueCandidates(app, aliases)) remember(value);
 return [...candidates].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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

/** Typed candidates share the editor's metadata-cache index and invalidation; no source reads. */
export function getVaultPropertyValueCandidates(app: Pick<App, 'metadataCache' | 'vault'>, names: readonly string[]): readonly VaultPropertyValue[] {
	getVaultFrontmatterCandidateIndex(app, false);
	const index = vaultFrontmatterCandidateCaches.get(app)?.typedByFieldName;
	return names.flatMap(name => [...(index?.get(name.trim().toLocaleLowerCase())?.values() ?? [])]);
}

function getVaultFrontmatterCandidateIndex(
	app: Pick<App, 'metadataCache' | 'vault'> | null | undefined,
	scalarOnly: boolean,
): Map<string, Set<string>> | null {
	if (!app) return null;
	const files = app.vault.getMarkdownFiles();
	const cacheKey = app;
	let cache = vaultFrontmatterCandidateCaches.get(cacheKey);
	if (cache && !cache.dirty && cache.fileCount === files.length) {
		return scalarOnly ? cache.scalarByFieldName : cache.byFieldName;
	}

	if (!cache) {
		cache = {
			fileCount: 0,
			dirty: false,
			byFieldName: new Map(),
			scalarByFieldName: new Map(),
			typedByFieldName: new Map(),
		};
		vaultFrontmatterCandidateCaches.set(cacheKey, cache);
	}

	cache.fileCount = files.length;
	cache.dirty = false;
	Object.assign(cache, buildVaultFrontmatterCandidateIndex(app, files));
	return scalarOnly ? cache.scalarByFieldName : cache.byFieldName;
}

function buildVaultFrontmatterCandidateIndex(
	app: Pick<App, 'metadataCache' | 'vault'>,
	files: ReturnType<App['vault']['getMarkdownFiles']>,
): Pick<VaultFrontmatterCandidateCache, 'byFieldName' | 'scalarByFieldName' | 'typedByFieldName'> {
	const byFieldName = new Map<string, Set<string>>();
	const scalarByFieldName = new Map<string, Set<string>>();
	const typedByFieldName = new Map<string, Map<string, VaultPropertyValue>>();
	for (const file of files) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) continue;
		for (const [key, rawValue] of Object.entries(fm)) {
			const normalizedKey = key.trim().toLocaleLowerCase();
			if (!normalizedKey) continue;
			const scalar = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
			if (scalar(rawValue) || Array.isArray(rawValue) && rawValue.every(item => typeof item === 'string' || typeof item === 'number' && Number.isFinite(item))) {
				const value = Array.isArray(rawValue) ? [...(rawValue as (string | number)[])] : rawValue;
				const typed = typedByFieldName.get(normalizedKey) ?? new Map<string, VaultPropertyValue>();
				typed.set(JSON.stringify(value), value);
				typedByFieldName.set(normalizedKey, typed);
			}
			let bucket = byFieldName.get(normalizedKey);
			if (!bucket) {
				bucket = new Set<string>();
				byFieldName.set(normalizedKey, bucket);
			}
			rememberVaultFrontmatterCandidateValue(bucket, rawValue);
			if (!Array.isArray(rawValue)) {
				const scalar = scalarByFieldName.get(normalizedKey) ?? new Set<string>();
				rememberVaultFrontmatterCandidateValue(scalar, rawValue);
				scalarByFieldName.set(normalizedKey, scalar);
			}
		}
	}
	return { byFieldName, scalarByFieldName, typedByFieldName };
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

/** Checkbox type icons are configurable; concrete boolean states are always explicit. */
export function getCheckboxPropertyIcon(value: unknown, fallback = 'square-dashed'): string {
	return value === true ? 'square-check-big' : value === false ? 'square' : fallback;
}

export function getCheckboxPropertyTypeIcon(keyMappings: readonly KeyMapping[], name: string): string {
	const mapping = keyMappings.find(item => item.type === 'checkbox'
		&& getManagedYamlAliases(item.canonicalKey, [item]).some(alias => alias.toLowerCase() === name.toLowerCase()));
	return mapping?.icon?.trim() || 'square-dashed';
}
