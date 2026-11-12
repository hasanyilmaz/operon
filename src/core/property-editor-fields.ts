import type { App } from 'obsidian';
import { inferObsidianPropertyType } from './property-type-registry';
import { CANONICAL_KEYS, TASK_STATS_CANONICAL_KEYS } from '../types/keys';
import { isRetiredKeyMapping, type KeyMapping } from '../types/settings';
import { getManagedYamlAliases } from './yaml-fields';
import { nativePropertyValueReadOnlyReason, type NativePropertyReadOnlyReason } from './task-editor-native-properties';
import type { InlinePropertyType } from './inline-property-definitions';
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
}

function propertyType(type: string): InlinePropertyType | undefined {
 switch (type) {
  case 'multitext': case 'aliases': case 'tags': case 'list': return 'list';
  case 'text': case 'number': case 'checkbox': case 'date': case 'datetime': return type;
  default: return undefined;
 }
}

export function resolvePropertyEditorField(
 name: string, document: PropertyEditorDocument, mappings: KeyMapping[], types: Readonly<Record<string, string>>, inferredTypes: Readonly<Record<string, string>> = {},
): PropertyEditorField {
 const lower = name.toLowerCase();
 const matching = mappings.filter(mapping =>
  getManagedYamlAliases(mapping.canonicalKey, [mapping]).some(alias => alias.toLowerCase() === lower));
 const fallback = CANONICAL_KEYS.find(key => key.name.toLowerCase() === lower && !mappings.some(mapping => mapping.canonicalKey === key.name));
 const mapping = matching[0] ?? (fallback ? { canonicalKey: fallback.name, visiblePropertyName: fallback.name, type: fallback.type, sync: fallback.sync, enabled: true, isSystem: true, isInternal: fallback.internal } : undefined);
 const aliases = new Set([lower, ...(mapping ? getManagedYamlAliases(mapping.canonicalKey, [mapping]).map(alias => alias.toLowerCase()) : [])]);
 const declared = Object.entries(types).filter(([key]) => aliases.has(key.toLowerCase()));
 const declaredType = declared.length ? propertyType(declared[0][1]) : undefined;
 const ownType = inferObsidianPropertyType([document.frontmatter[name]]);
 const inferred = ownType === 'unknown' ? inferredTypes[name] ?? 'text' : ownType;
 const type = mapping?.type ?? (builtinListNames.has(lower) ? 'list' : declaredType ?? (!declared.length ? propertyType(inferred) : undefined));
 const field: PropertyEditorField = { name, type: type ?? 'text', mapping };
 if (lower.startsWith('_') || protectedNames.has(lower) || document.readonlyNames?.has(name)
  || mapping && (protectedNames.has(mapping.canonicalKey.toLowerCase()) || mapping.canonicalKey !== 'related' && isRetiredKeyMapping(mapping.canonicalKey))) {
  return { ...field, reason: 'unavailable', taskOnly: PROPERTY_EDITOR_TASK_ONLY_KEYS.has(mapping?.canonicalKey ?? name) };
 }
 if (matching.length > 1 || document.order.some(key => key !== name && aliases.has(key.toLowerCase()))
  || declared.some(([, raw]) => propertyType(raw) !== type)) return { ...field, reason: 'type-conflict' };
 if (!type) return { ...field, reason: declared.length ? 'unsupported' : 'automatic' };
 const value = document.frontmatter[name];
 const stringList = builtinListNames.has(lower) || mapping?.canonicalKey === 'contexts';
 const reason = stringList && Array.isArray(value) && value.some(item => typeof item !== 'string')
  ? 'type-conflict' : nativePropertyValueReadOnlyReason(value, type);
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
