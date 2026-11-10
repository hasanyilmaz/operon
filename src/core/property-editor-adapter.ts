import type { KeyMapping } from '../types/settings';
import type { PropertyEditorDocument } from './property-editor-document';
import { resolvePropertyEditorField, type PropertyEditorField } from './property-editor-fields';
import { isEmptyFilePropertyValue, readRawYamlPropertyExpectation, type RawYamlPropertyValue } from './raw-yaml-property';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from './task-media-reference';
import { splitTaskListValue } from './task-field-patch';
import { formatTaskColorYamlValue, normalizeTaskColorValue } from './task-color-value';
import { decodeVaultPropertyValue, encodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { getManagedYamlAliases, getVisiblePropertyName } from './yaml-fields';

/** The only conversion boundary between typed note YAML and shared field controls. */
export class PropertyEditorAdapter {
 readonly fields = new Map<string, PropertyEditorField>();
 readonly values: Record<string, string> = Object.create(null) as Record<string, string>;
 readonly tags: string[] = [];
 constructor(readonly document: PropertyEditorDocument, private readonly mappings: KeyMapping[], private readonly types: Readonly<Record<string, string>>, private readonly inferredTypes: Readonly<Record<string, string>> = {}) {
  for (const name of document.order) {
   const field = this.resolve(name);
   this.fields.set(name, field);
   if (!field.mapping || field.reason) continue;
   const key = field.mapping.canonicalKey;
   try {
    const encoded = this.encode(field, document.frontmatter[name]);
    if (key === 'tags') this.tags.push(...splitTaskListValue(encoded));
    else this.values[key] = encoded;
   } catch { field.reason = 'type-conflict'; }
  }
 }
 resolve(name: string): PropertyEditorField {
  return resolvePropertyEditorField(name, this.document, this.mappings, this.types, this.inferredTypes);
 }
 private encode(field: PropertyEditorField, value: unknown): string {
  if (value == null || value === '') return '';
  const key = field.mapping?.canonicalKey;
  if (key === 'taskColor' && typeof value === 'string') return normalizeTaskColorValue(value);
  if (field.mapping?.isSystem === false || key === 'related') return encodeVaultPropertyValue(value as VaultPropertyValue, field.type);
  if (field.type === 'list') {
   if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid mapped list');
   const text = key === 'taskGallery' ? serializeTaskMediaReferenceList(value) : value.join('; ');
   const decoded = key === 'taskGallery' ? parseTaskMediaReferenceList(text) : splitTaskListValue(text);
   if (JSON.stringify(decoded) !== JSON.stringify(value)) throw new Error('Ambiguous mapped list');
   return text;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('Unsupported scalar');
  return String(value);
 }
 private decode(field: PropertyEditorField, value: string): RawYamlPropertyValue {
  if (!value && field.type !== 'text' && field.type !== 'list') return null;
  if (field.mapping?.canonicalKey === 'taskColor') return formatTaskColorYamlValue(value);
  if (field.mapping?.isSystem === false || field.mapping?.canonicalKey === 'related') return decodeVaultPropertyValue(value, field.type);
  if (field.type === 'list') return field.mapping?.canonicalKey === 'taskGallery' ? parseTaskMediaReferenceList(value) : splitTaskListValue(value);
  if (field.type === 'text') return value;
  return decodeVaultPropertyValue(value, field.type);
 }
 /** Validate the whole dependent patch before a host mutates its persistent draft. */
 changes(values: Record<string, string>, tags: readonly string[], firstName?: string): { name: string; value: RawYamlPropertyValue }[] | null {
  const next: Record<string, string> = { ...values, tags: tags.join('; ') };
  const before: Record<string, string> = { ...this.values, tags: this.tags.join('; ') };
  const keys = [...new Set([...Object.keys(next), ...Object.keys(before)])];
  if (firstName) {
   const firstKey = this.resolve(firstName).mapping?.canonicalKey;
   if (firstKey) keys.sort((a, b) => a === firstKey ? -1 : b === firstKey ? 1 : 0);
  }
  const groups = [
   ['dateScheduled','datetimeStart','datetimeEnd','estimate'],
   ['status','dateCompleted','dateCancelled'],
   ['repeat','datetimeRepeatEnd','repeatOccurrenceDate'],
  ];
  for (const group of groups) {
   if (!group.some(key => (next[key] ?? '') !== (before[key] ?? ''))) continue;
   if ([...this.fields.values()].some(field => field.reason && group.includes(field.mapping?.canonicalKey ?? ''))) return null;
  }
  const changes: { name: string; value: RawYamlPropertyValue }[] = [];
  try {
   for (const key of keys) {
    if ((next[key] ?? '') === (before[key] ?? '')) continue;
    const aliases = new Set(getManagedYamlAliases(key, this.mappings).map(name => name.toLowerCase()));
    const existing = this.document.order.filter(name => aliases.has(name.toLowerCase()));
    if (existing.length > 1) return null;
    const name = existing[0] ?? (firstName && this.resolve(firstName).mapping?.canonicalKey === key ? firstName : getVisiblePropertyName(key, this.mappings));
    const field = this.resolve(name);
    if (field.reason || field.mapping?.canonicalKey !== key) return null;
    const value = this.decode(field, next[key] ?? '');
    // A rule may clear an absent dependent field. It must not create an empty key.
    if (!existing.length && isEmptyFilePropertyValue(value)) continue;
    if (!readRawYamlPropertyExpectation(this.document.frontmatter, name)) return null;
    const candidate = { ...this.document, frontmatter: { ...this.document.frontmatter, [name]: value } };
    if (resolvePropertyEditorField(name, candidate, this.mappings, this.types, this.inferredTypes).reason) return null;
    changes.push({ name, value });
   }
  } catch { return null; }
  return changes;
 }
}
