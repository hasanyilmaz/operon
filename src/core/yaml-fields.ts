/**
 * YAML frontmatter field helpers for Operon.
 * Read/write task fields from/to YAML frontmatter with key mapping support.
 *
 * Moved from src/sync/yaml-sync.ts — these utilities are format-agnostic
 * and used by TaskWriter, indexer, and conversion systems.
 */

import { App, TFile } from 'obsidian';
import { isRetiredKeyMapping, KeyMapping } from '../types/settings';
import { CANONICAL_KEYS, LEGACY_CANONICAL_KEY_ALIASES } from '../types/keys';
import { normalizeTaskIconValue } from './task-icon-value';
import { formatTaskColorYamlValue, normalizeTaskColorValue } from './task-color-value';
import { getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from './managed-task-fields';

export function normalizeLegacyCreatedDatetime(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return `${trimmed}T00:00:01`;
	}
	return trimmed;
}

export function getVisiblePropertyName(
	canonicalKey: string,
	keyMappings: KeyMapping[],
): string {
	for (const mapping of keyMappings) {
		if (isRetiredKeyMapping(mapping.canonicalKey)) continue;
		if (mapping.canonicalKey !== canonicalKey) continue;
		if (!mapping.visiblePropertyName) continue;
		return mapping.visiblePropertyName;
	}
	return canonicalKey;
}

export function getManagedYamlAliases(
	canonicalKey: string,
	keyMappings: KeyMapping[],
): string[] {
	return [...new Set([
		getVisiblePropertyName(canonicalKey, keyMappings),
		canonicalKey,
		...(LEGACY_CANONICAL_KEY_ALIASES[canonicalKey] ?? []),
	])];
}

function hasNonEmptyYamlScalar(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(item => hasNonEmptyYamlScalar(item));
	if (typeof value === 'string') return value.trim().length > 0;
	return typeof value === 'number' || typeof value === 'boolean';
}

export function hasNonEmptyManagedYamlValue(
	frontmatter: Record<string, unknown> | null | undefined,
	canonicalKey: string,
	keyMappings: KeyMapping[],
): boolean {
	if (!frontmatter) return false;
	return getManagedYamlAliases(canonicalKey, keyMappings).some(alias =>
		Object.prototype.hasOwnProperty.call(frontmatter, alias)
		&& hasNonEmptyYamlScalar(frontmatter[alias])
	);
}

export function isManagedYamlCanonicalKey(
	canonicalKey: string,
	keyMappings: KeyMapping[],
): boolean {
	return isManagedTaskFieldCanonicalKey(canonicalKey, keyMappings);
}

function stringifyYamlScalar(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return null;
}

function isNumericYamlString(value: string): boolean {
	return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function isReadableYamlCanonicalKey(canonicalKey: string, keyMappings: KeyMapping[]): boolean {
	if (canonicalKey === 'related') return true;
	return isManagedYamlCanonicalKey(canonicalKey, keyMappings);
}

/**
 * Read field values from a YAML frontmatter.
 * Converts YAML arrays to semicolon-separated strings.
 */
export function readYamlFields(
    frontmatter: Record<string, unknown>,
    keyMappings: KeyMapping[],
): Record<string, string> {
    const fields: Record<string, string> = {};
    const reverseMap = buildReverseMapping(keyMappings);

    for (const [yamlKey, val] of Object.entries(frontmatter)) {
        if (yamlKey === 'position') continue; // Obsidian internal
        if (yamlKey === 'tags') continue; // handled via task.tags pseudo-key
        if (yamlKey === 'title') continue; // title is derived from the filename
        if (yamlKey === 'pinned') continue; // pinned state lives only in cache
        if (yamlKey.startsWith('_')) continue; // Skip pseudo-keys

        // Resolve visible property name back to canonical key
        const canonicalKey = reverseMap.get(yamlKey) ?? yamlKey;
        if (canonicalKey === 'pinned') continue;
        if (!isReadableYamlCanonicalKey(canonicalKey, keyMappings)) continue;

        if (val === null || val === undefined) continue;

        if (Array.isArray(val)) {
            // YAML list → semicolon-separated inline format
            fields[canonicalKey] = val
                .map(v => stringifyYamlScalar(v))
                .filter((v): v is string => v !== null)
                .join('; ');
        } else {
            const stringValue = stringifyYamlScalar(val);
            if (stringValue === null) continue;
            fields[canonicalKey] = canonicalKey === 'datetimeCreated'
                ? normalizeLegacyCreatedDatetime(stringValue)
                : canonicalKey === 'taskColor'
                    ? normalizeTaskColorValue(stringValue)
                : canonicalKey === 'taskIcon'
                    ? normalizeTaskIconValue(stringValue)
                    : stringValue;
        }
    }

    return fields;
}

/**
 * Write field values to YAML frontmatter via Obsidian's processFrontMatter API.
 * Preserves existing YAML key order (human-owned).
 * Applies key mappings (canonicalKey → visiblePropertyName) for export.
 */
export async function writeYamlFields(
    app: App,
    file: TFile,
    fieldValues: Record<string, string>,
    keyMappings: KeyMapping[],
): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [canonicalKey, value] of Object.entries(fieldValues)) {
            // Skip pseudo-keys (_description, _tags, _checkbox) — not real YAML fields
            if (canonicalKey.startsWith('_')) continue;
            if (canonicalKey === 'tags') continue; // Obsidian tags handled via _tags
            if (canonicalKey === 'pinned') continue;
            if (!isManagedYamlCanonicalKey(canonicalKey, keyMappings)) continue;

            // Apply key mapping: canonical → visible property name
            const yamlKey = getVisiblePropertyName(canonicalKey, keyMappings);

            // Convert list values to YAML array format
            const fieldType = getManagedTaskFieldType(canonicalKey, keyMappings);
            if (fieldType === 'list' && value) {
                fm[yamlKey] = value.split('; ').map(v => v.trim()).filter(v => v);
            } else if (fieldType === 'number' && value) {
                fm[yamlKey] = isNumericYamlString(value) ? Number(value) : value;
            } else if (canonicalKey === 'taskColor' && value) {
                fm[yamlKey] = formatTaskColorYamlValue(value);
            } else if (value) {
                fm[yamlKey] = value;
            }
        }
    });
}

/**
 * Convert inline field values to YAML-ready format.
 * Lists become arrays, other values stay as strings.
 */
export function inlineToYamlValue(
    canonicalKey: string,
    value: string,
    keyMappings: KeyMapping[] = [],
): unknown {
    const fieldType = getManagedTaskFieldType(canonicalKey, keyMappings);
    if (fieldType === 'list' && value) {
        return value.split('; ').map(v => v.trim()).filter(v => v);
    }
    return value;
}

/**
 * Build forward mapping: canonicalKey → visiblePropertyName.
 * Used when writing to YAML.
 */
export function buildForwardMapping(mappings: KeyMapping[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const m of mappings) {
		if (isRetiredKeyMapping(m.canonicalKey)) continue;
		if (m.visiblePropertyName) {
			map.set(m.canonicalKey, m.visiblePropertyName);
		}
	}
	return map;
}

/**
 * Build reverse mapping: visiblePropertyName → canonicalKey.
 * Used when reading from YAML.
 */
export function buildReverseMapping(mappings: KeyMapping[]): Map<string, string> {
	const map = new Map<string, string>();
	const setIfAbsent = (sourceKey: string, canonicalKey: string): void => {
		if (!sourceKey || map.has(sourceKey)) return;
		map.set(sourceKey, canonicalKey);
	};

	for (const key of CANONICAL_KEYS) {
		if (isRetiredKeyMapping(key.name)) continue;
		setIfAbsent(key.name, key.name);
	}
	for (const [canonicalKey, aliases] of Object.entries(LEGACY_CANONICAL_KEY_ALIASES)) {
		if (isRetiredKeyMapping(canonicalKey)) continue;
		for (const alias of aliases) {
			setIfAbsent(alias, canonicalKey);
		}
	}
	for (const m of mappings) {
		if (isRetiredKeyMapping(m.canonicalKey)) continue;
		setIfAbsent(m.canonicalKey, m.canonicalKey);
		if (m.visiblePropertyName) {
			setIfAbsent(m.visiblePropertyName, m.canonicalKey);
		}
		for (const alias of LEGACY_CANONICAL_KEY_ALIASES[m.canonicalKey] ?? []) {
			setIfAbsent(alias, m.canonicalKey);
		}
	}
	return map;
}
