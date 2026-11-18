import { CANONICAL_KEY_MAP } from '../types/keys';
import { resolvePropertyEditorField } from './property-editor-fields';
import { isEmptyFilePropertyValue } from './raw-yaml-property';
import { resolveInlinePropertyDefinition, type InlinePropertyDefinitions, type InlinePropertyType } from './inline-property-definitions';
import { encodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { getManagedYamlAliases } from './yaml-fields';
import { splitFrontmatterDocument } from './file-task-template-merge';
import { readOrderedYamlProperties } from './ordered-yaml-properties';
import { isSupportedRawYamlPropertyValue, isWritableRawYamlPropertyName, rawYamlPropertyExpectationsEqual, readRawYamlPropertyExpectation, type RawYamlPropertyExpectation, type RawYamlPropertyValue } from './raw-yaml-property';
import type { KeyMapping } from '../types/settings';

export interface FileTaskPropertyChange {
 remove?: boolean;
 /** Editor-only presence intent for a verified mapped property. */
 mappedKey?: string;
 /** Preserve source formatting for the editor's explicit empty-property removal. */
 preserveSource?: boolean;
 propertyName: string;
 nativeType?: InlinePropertyType;
 expected: RawYamlPropertyExpectation;
 value: RawYamlPropertyValue;
}

export type EditorMappedProperty = { name: string; expected: RawYamlPropertyExpectation; type: InlinePropertyType };
export function editorMappedProperties(frontmatter: Record<string, unknown>, mappings: readonly KeyMapping[], types: Readonly<Record<string, string>> = {}, definitions?: InlinePropertyDefinitions): Record<string, EditorMappedProperty> {
 const result = Object.create(null) as Record<string, EditorMappedProperty>;
 const document = { frontmatter, order: Object.keys(frontmatter) };
 for (const name of document.order) {
  const field = resolvePropertyEditorField(name, document, [...mappings], types);
  const expected = readRawYamlPropertyExpectation(frontmatter, name);
  if (field.mapping?.isSystem === false) {
   try { if (resolveInlinePropertyDefinition(name, field.type, mappings, definitions).encoding === 'vault-v1') continue; } catch { continue; }
  }
  const key = field.mapping?.canonicalKey ?? (name.toLowerCase() === 'tags' ? 'tags' : undefined);
  if (!key || field.reason || !expected?.present) continue;
  const definition = CANONICAL_KEY_MAP.get(key);
  if (definition?.internal || definition?.sync === 'auto' || key === 'datetimeCreated') continue;
  result[key] = { name, expected, type: field.type };
 }
 return result;
}

/** Read the real document rather than a potentially stale metadata-cache snapshot. */
export function readFileTaskPropertyDocument(content: string): { frontmatter: Record<string, unknown>; order: string[]; body: string } | null {
 const { frontmatter, body } = splitFrontmatterDocument(content);
 if (frontmatter === null) return null;
 const document = readOrderedYamlProperties(frontmatter + '\n');
 return document ? { ...document, body } : null;
}

export function canApplyFileTaskPropertyChanges(frontmatter: Record<string, unknown>, changes: readonly FileTaskPropertyChange[], mappings: readonly KeyMapping[], definitions?: InlinePropertyDefinitions): boolean {
 const seen = new Set<string>();
 return changes.length > 0 && changes.every(change => {
  if (seen.has(change.propertyName.toLowerCase())) return false;
  seen.add(change.propertyName.toLowerCase());
  if (Object.keys(frontmatter).some(name => name !== change.propertyName && name.toLowerCase() === change.propertyName.toLowerCase())) return false;
  if (!isSupportedRawYamlPropertyValue(change.value)) return false;
  if (change.preserveSource && (!change.remove || !isEmptyFilePropertyValue(change.value))) return false;
  if (change.mappedKey) {
   const property = editorMappedProperties(frontmatter, mappings, {}, definitions)[change.mappedKey];
   if (!property || property.name !== change.propertyName || !change.expected.present || !isEmptyFilePropertyValue(change.value)) return false;
  } else if (!isWritableRawYamlPropertyName(change.propertyName, mappings)) {
   const mapping = mappings.find(item => item.isSystem === false && [item.canonicalKey, item.visiblePropertyName].some(name => name.toLowerCase() === change.propertyName.toLowerCase()));
   if (!mapping || !change.nativeType) return false;
   const aliases = Object.keys(frontmatter).filter(name => [mapping.canonicalKey, mapping.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
   if (aliases.length > 1) return false;
   try {
    if (resolveInlinePropertyDefinition(change.propertyName, change.nativeType, mappings, definitions).encoding !== 'vault-v1') return false;
    encodeVaultPropertyValue(change.value as VaultPropertyValue, change.nativeType);
   } catch { return false; }
  }
  if (typeof change.value === 'number' && !Number.isFinite(change.value)) return false;
  if (Array.isArray(change.value) && change.value.some(value => typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) return false;
  const current = readRawYamlPropertyExpectation(frontmatter, change.propertyName);
  return current !== null && rawYamlPropertyExpectationsEqual(current, change.expected);
 });
}

export function fileTaskPropertyIdentityMatches(frontmatter: Record<string, unknown>, operonId: string, mappings: readonly KeyMapping[]): boolean {
 const keys = getManagedYamlAliases('operonId', [...mappings]).filter(key => Object.prototype.hasOwnProperty.call(frontmatter, key));
 if (keys.length !== 1) return false;
 const value = frontmatter[keys[0]];
 return (typeof value === 'string' || typeof value === 'number') && String(value).trim() === operonId;
}
