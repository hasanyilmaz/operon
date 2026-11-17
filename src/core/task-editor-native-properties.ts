import type { KeyMapping } from '../types/settings';
import { resolveInlinePropertyDefinition, type InlinePropertyDefinitions, type InlinePropertyType } from './inline-property-definitions';
import { encodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { isEmptyFilePropertyValue, isSupportedRawYamlPropertyValue, isWritableRawYamlPropertyName } from './raw-yaml-property';

export function nativeEditorPropertyTypes(types: Readonly<Record<string, string>>, mappings: readonly KeyMapping[], definitions?: InlinePropertyDefinitions): Record<string, InlinePropertyType> {
 const result: Record<string, InlinePropertyType> = {};
 const names = new Map<string, string[]>();
 for (const name of Object.keys(types)) names.set(name.toLowerCase(), [...(names.get(name.toLowerCase()) ?? []), name]);
 for (const [name, raw] of Object.entries(types)) {
  if (names.get(name.toLowerCase())!.length !== 1) continue;
  const type = raw === 'multitext' ? 'list' : raw;
  if (!['text', 'list', 'number', 'checkbox', 'date', 'datetime'].includes(type)) continue;
  const mapped = mappings.filter(mapping => [mapping.canonicalKey, mapping.visiblePropertyName].some(alias => alias.toLowerCase() === name.toLowerCase()));
  if (mapped.length > 1 || mapped[0]?.isSystem !== false && !isWritableRawYamlPropertyName(name, mappings)) continue;
  if (mapped.length === 1 && Object.entries(types).some(([alias, declared]) => [mapped[0].canonicalKey, mapped[0].visiblePropertyName].some(key => key.toLowerCase() === alias.toLowerCase()) && ((declared === 'multitext' ? 'list' : declared) !== type || names.get(alias.toLowerCase())!.length !== 1))) continue;
  try {
   const definition = resolveInlinePropertyDefinition(name, type as InlinePropertyType, mappings, definitions);
   if (mapped.length && definition.encoding !== 'vault-v1') continue;
   result[name] = definition.type;
  } catch { /* Conflicting declarations remain read-only in the source projection. */ }
 }
 return result;
}

/** Presentation only: this reason never grants a write permission. */
export type NativePropertyReadOnlyReason = 'automatic' | 'type-conflict' | 'unsupported' | 'unavailable';

export function nativePropertyValueReadOnlyReason(value: unknown, type?: InlinePropertyType,
 baseReason?: NativePropertyReadOnlyReason): NativePropertyReadOnlyReason | undefined {
 if (value !== undefined && (!isSupportedRawYamlPropertyValue(value)
  || typeof value === 'number' && !Number.isFinite(value)
  || Array.isArray(value) && value.some(item => typeof item !== 'string' && typeof item !== 'number' || typeof item === 'number' && !Number.isFinite(item)))) return 'unsupported';
 if (baseReason) return baseReason;
 if (type && !isEmptyFilePropertyValue(value)) {
  try { encodeVaultPropertyValue(value as VaultPropertyValue, type); }
  catch { return 'type-conflict'; }
 }
 return undefined;
}

export function nativePropertyReadOnlyReason(
 name: string, value: unknown, declarations: Readonly<Record<string, string>>,
 mappings: readonly KeyMapping[], nativeTypes: Readonly<Record<string, InlinePropertyType>>,
): NativePropertyReadOnlyReason | undefined {
 if (nativePropertyValueReadOnlyReason(value) === 'unsupported') return 'unsupported';
 const aliases = new Set([name.toLowerCase()]);
 const mapped = mappings.filter(mapping => [mapping.canonicalKey, mapping.visiblePropertyName].some(alias => aliases.has(alias.toLowerCase())));
 for (const mapping of mapped) for (const alias of [mapping.canonicalKey, mapping.visiblePropertyName]) aliases.add(alias.toLowerCase());
 const assigned = Object.entries(declarations).filter(([alias]) => aliases.has(alias.toLowerCase()));
 if (mapped.length > 1 || assigned.some(([alias], index) => assigned.some(([other], otherIndex) => otherIndex !== index && other.toLowerCase() === alias.toLowerCase()))) return 'type-conflict';
 if (!assigned.length) return 'automatic';
 if (assigned.some(([, type]) => !['text', 'multitext', 'list', 'number', 'checkbox', 'date', 'datetime'].includes(type))) return 'unsupported';
 const typeName = Object.keys(nativeTypes).find(alias => aliases.has(alias.toLowerCase()));
 if (!typeName) return 'type-conflict';
 return nativePropertyValueReadOnlyReason(value, nativeTypes[typeName]);
}
