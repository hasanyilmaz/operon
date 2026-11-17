import type { App } from 'obsidian';
import { inferObsidianPropertyType } from './property-type-registry';
import { CANONICAL_KEYS, TASK_STATS_CANONICAL_KEYS } from '../types/keys';
import { isRetiredKeyMapping, type KeyMapping } from '../types/settings';
import { getManagedYamlAliases } from './yaml-fields';
import { splitTaskListValue } from './task-field-patch';
import { nativeEditorPropertyType as propertyType, nativeEditorPropertyTypes, nativePropertyReadOnlyReason, nativePropertyValueReadOnlyReason, type NativePropertyReadOnlyReason } from './task-editor-native-properties';
import { resolveInlinePropertyDefinition, type InlinePropertyDefinitions, type InlinePropertyType } from './inline-property-definitions';
import type { PropertyEditorDocument } from './property-editor-document';

const builtinListNames = new Set(['aliases', 'tags', 'cssclasses']);
export const PROPERTY_EDITOR_TASK_ONLY_KEYS = new Set([
 'operonId', 'repeatSeriesId', 'parentTask', 'subtasks', 'blocking', 'blockedBy',
 'trackers', 'activeTracker', 'fileTaskDisplayTitle', 'duration', 'totalDuration', 'totalEstimate', 'progress', 'pinned', ...TASK_STATS_CANONICAL_KEYS,
]);
const protectedNames = new Set(['excalidraw-plugin', 'position',
 ...Array.from(PROPERTY_EDITOR_TASK_ONLY_KEYS, key => key.toLowerCase())]);

export interface PropertyEditorField {
 name: string;
 type: InlinePropertyType;
 mapping?: KeyMapping;
 reason?: NativePropertyReadOnlyReason;
 taskOnly?: boolean;
 control?: 'workflow' | 'native';
}

/** Project a legacy scalar into the picker while keeping the original YAML for conflict checks. */
export function propertyEditorPickerValue(field: PropertyEditorField, value: unknown): unknown {
 if (field.mapping?.canonicalKey === 'contexts' && field.type === 'list' && typeof value === 'string'
  && !/[\r\n]/u.test(value) && splitTaskListValue(value)[0] === value) return [value];
 return value;
}

export function resolvePropertyEditorField(
 name: string, document: PropertyEditorDocument, mappings: KeyMapping[], types: Readonly<Record<string, string>>, inferredTypes: Readonly<Record<string, string>> = {}, definitions?: InlinePropertyDefinitions, task = false,
): PropertyEditorField {
 const lower = name.toLowerCase();
 const matching = mappings.filter(mapping =>
  getManagedYamlAliases(mapping.canonicalKey, [mapping]).some(alias => alias.toLowerCase() === lower));
 const fallback = CANONICAL_KEYS.find(key => key.name.toLowerCase() === lower && !mappings.some(mapping => mapping.canonicalKey === key.name));
 const mapping = matching[0] ?? (lower === 'tags' ? { canonicalKey: 'tags', visiblePropertyName: name, type: 'list' as const, sync: 'yes' as const, enabled: true, isSystem: true } : fallback ? { canonicalKey: fallback.name, visiblePropertyName: fallback.name, type: fallback.type, sync: fallback.sync, enabled: true, isSystem: true, isInternal: fallback.internal } : undefined);
 const aliases = new Set([lower, ...(mapping ? getManagedYamlAliases(mapping.canonicalKey, [mapping]).map(alias => alias.toLowerCase()) : [])]);
 const declared = Object.entries(types).filter(([key]) => aliases.has(key.toLowerCase()));
 const declaredType = declared.length ? propertyType(declared[0][1]) : undefined;
 const ownType = inferObsidianPropertyType([document.frontmatter[name]]);
 const inferred = ownType === 'unknown' ? inferredTypes[name] ?? 'text' : ownType;
 const type = mapping?.type ?? (builtinListNames.has(lower) ? 'list' : declaredType ?? (!declared.length ? propertyType(inferred) : undefined));
 let control: 'workflow' | 'native';
 try { control = editorPropertyControl(mapping, definitions); }
 catch { return { name, type: type ?? 'text', mapping, reason: 'type-conflict' }; }
 const field: PropertyEditorField = { name, type: type ?? 'text', mapping, control };
 if (control === 'workflow' && mapping?.isSystem === false && type === 'checkbox') return { ...field, reason: 'unsupported' };
 if (lower.startsWith('_') || !task && protectedNames.has(lower) || document.readonlyNames?.has(name)
  || mapping && (!task && protectedNames.has(mapping.canonicalKey.toLowerCase()) || mapping.canonicalKey !== 'related' && isRetiredKeyMapping(mapping.canonicalKey))) {
  return { ...field, reason: 'unavailable', taskOnly: PROPERTY_EDITOR_TASK_ONLY_KEYS.has(mapping?.canonicalKey ?? name) };
 }
 if (matching.length > 1 || document.order.some(key => key !== name && aliases.has(key.toLowerCase()))
  || declared.some(([alias, raw], index) => propertyType(raw) !== type || declared.some(([other], otherIndex) => otherIndex !== index && alias.toLowerCase() === other.toLowerCase()))) return { ...field, reason: 'type-conflict' };
 if (control === 'native') return { ...field, reason: nativePropertyReadOnlyReason(name, document.frontmatter[name], types, mappings, nativeEditorPropertyTypes(types, mappings, definitions)) };
 if (!type) return { ...field, reason: declared.length ? 'unsupported' : 'automatic' };
 const value = propertyEditorPickerValue(field, document.frontmatter[name]);
 const stringList = builtinListNames.has(lower) || control === 'workflow' && type === 'list';
 const reason = stringList && Array.isArray(value) && value.some(item => typeof item !== 'string')
  ? 'type-conflict' : nativePropertyValueReadOnlyReason(value, type);
 if (!reason && control === 'workflow' && type === 'list' && mapping?.canonicalKey !== 'taskGallery' && Array.isArray(value)
  && JSON.stringify(splitTaskListValue(value.join('; '))) !== JSON.stringify(value)) return { ...field, reason: 'type-conflict' };
 return { ...field, reason };
}

/** Reuse the table/native property inference for fields not yet present in this note. */
export function inferVaultPropertyEditorTypes(app: App): Record<string, string> {
 const samples = new Map<string, unknown[]>();
 for (const file of app.vault.getMarkdownFiles()) for (const [name, value] of Object.entries(app.metadataCache.getFileCache(file)?.frontmatter ?? {})) {
  const values = samples.get(name) ?? []; values.push(value); samples.set(name, values);
 }
 return Object.fromEntries([...samples].map(([name, values]) => {
  const meaningful = values.filter(value => value !== null && value !== undefined && value !== '');
  const editable = meaningful.filter(value => !nativePropertyValueReadOnlyReason(value));
  const inferred = inferObsidianPropertyType(editable);
  return [name, meaningful.length && !editable.length ? 'unsupported' : inferred === 'unknown' ? 'text' : inferred];
 }));
}

/** One alias-aware pool for both editors. Eligibility is resolved separately from discovery. */
export function editorPropertyCandidateNames(mappings: readonly KeyMapping[], types: Readonly<Record<string, string>>, vaultNames: readonly string[], existingNames: readonly string[]): string[] {
 const names = [...existingNames, 'tags', ...mappings.filter(mapping => mapping.showInEditor !== false).map(mapping => mapping.visiblePropertyName || mapping.canonicalKey), ...Object.keys(types), ...vaultNames];
 const candidates = new Map<string, string>();
 for (const name of names) {
  const matching = mappings.filter(mapping => getManagedYamlAliases(mapping.canonicalKey, [mapping]).some(alias => alias.toLowerCase() === name.toLowerCase()));
  if (matching.length > 1 || matching[0]?.showInEditor === false) continue;
  const identity = (matching[0]?.canonicalKey ?? name).toLowerCase();
  if (!candidates.has(identity)) candidates.set(identity, name);
 }
 return [...candidates.values()].sort((a, b) => a.localeCompare(b));
}

/** Control routing follows the stored encoding, not which editor opened the file. */
export function editorPropertyControl(mapping: KeyMapping | undefined, definitions?: InlinePropertyDefinitions): 'workflow' | 'native' {
 if (!mapping) return 'native';
 return mapping.isSystem === false && resolveInlinePropertyDefinition(mapping.visiblePropertyName || mapping.canonicalKey, mapping.type, [mapping], definitions).encoding === 'vault-v1' ? 'native' : 'workflow';
}
