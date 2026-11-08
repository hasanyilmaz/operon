import { CANONICAL_KEYS, CANONICAL_KEY_MAP } from '../types/keys';
import { normalizeChildTaskInheritanceFields, type KeyMapping, type OperonSettings } from '../types/settings';
import { getManagedYamlAliases } from './yaml-fields';
import { parseListValue } from './parser';
import { resolveSubtaskInitialFieldsFromParentValues } from './subtask-inheritance';
import { resolveInlinePropertyDefinition, type InlinePropertyDefinitions, type InlinePropertyType } from './inline-property-definitions';
import { nativeEditorPropertyTypes, nativePropertyReadOnlyReason, type NativePropertyReadOnlyReason } from './task-editor-native-properties';
import { decodeVaultPropertyValue, encodeVaultPropertyValue, type VaultPropertyValue } from './vault-property-codec';
import { isWritableRawYamlPropertyName } from './raw-yaml-property';

export interface CreationDraftPropertyContext {
	keyMappings: readonly KeyMapping[];
	/** Null means the registry could not be verified; an empty object means Automatic. */
	propertyTypes: Readonly<Record<string, string>> | null;
	inlineDefinitions?: InlinePropertyDefinitions;
}

export interface CreationDraftProperty {
	id: string;
	sourceName: string;
	canonicalKey?: string;
	type: InlinePropertyType | null;
	interpretation: 'canonical' | 'legacy-custom' | 'native';
	merge: 'scalar' | 'set' | 'sequence' | 'special' | 'system';
	readOnlyReason?: NativePropertyReadOnlyReason;
}

export interface CreationDraftFieldInput {
	sourceName: string;
	value: unknown;
	/** Stable keys supplied by the materializer for input-dependent list members. */
	memberKeys?: readonly string[];
}

const SYSTEM_KEYS = new Set(['operonId', 'datetimeCreated', 'datetimeModified']);
const SPECIAL_KEYS = new Set([
	'parentTask', 'blocking', 'blockedBy', 'related', 'repeat', 'datetimeRepeatEnd',
	'reminderDatetimes', 'reminderRules', 'trackers', 'taskGallery', 'status',
	'dateCompleted', 'dateCancelled', 'pinned', 'subtasks',
]);
const identity = (name: string): string => name.trim().toLowerCase();

/** In-memory catalog. No registry reads, inference, or interpretation persistence. */
export class CreationDraftProperties {
	private readonly context: CreationDraftPropertyContext;
	private readonly aliases = new Map<string, Set<string>>();
	private readonly conflictingKeys = new Set<string>();
	private readonly nativeTypes: Record<string, InlinePropertyType>;

	constructor(context: CreationDraftPropertyContext) {
		this.context = structuredClone(context);
		const mappings = this.context.keyMappings;
		for (const key of [...CANONICAL_KEYS.map(item => item.name), 'tags', 'subtasks', 'pinned']) {
			this.addAliases(key, getManagedYamlAliases(key, []));
		}
		for (const mapping of mappings) {
			this.addAliases(mapping.canonicalKey, getManagedYamlAliases(mapping.canonicalKey, [mapping]));
			if (mappings.filter(item => identity(item.canonicalKey) === identity(mapping.canonicalKey)).length > 1
				|| mapping.isSystem === false && mapping.canonicalKey !== 'fileTaskDisplayTitle'
					&& (CANONICAL_KEY_MAP.has(mapping.canonicalKey) || ['tags', 'subtasks', 'pinned'].includes(mapping.canonicalKey))) {
				this.conflictingKeys.add(mapping.canonicalKey);
			}
		}
		for (const keys of this.aliases.values()) {
			if (keys.size > 1) for (const key of keys) this.conflictingKeys.add(key);
		}
		this.nativeTypes = nativeEditorPropertyTypes(this.context.propertyTypes ?? {}, [...mappings], this.context.inlineDefinitions);
	}

	resolve(sourceName: string): CreationDraftProperty {
		const matches = [...(this.aliases.get(identity(sourceName)) ?? [])];
		const key = matches.length === 1 ? matches[0] : undefined;
		const mapping = this.context.keyMappings.find(item => item.canonicalKey === key);
		const canonical = key && !(key === 'fileTaskDisplayTitle' && mapping?.isSystem === false)
			? CANONICAL_KEY_MAP.get(key) : undefined;
		const descriptor: CreationDraftProperty = {
			id: key ? `managed:${key}` : `native:${identity(sourceName)}`,
			sourceName,
			canonicalKey: key,
			type: canonical?.type ?? mapping?.type ?? (key === 'tags' || key === 'subtasks' ? 'list' : key === 'pinned' ? 'checkbox' : null),
			interpretation: canonical || key === 'tags' || key === 'subtasks' || key === 'pinned' ? 'canonical' : mapping ? 'legacy-custom' : 'native',
			merge: 'scalar',
		};
		if (matches.length > 1 || key && this.conflictingKeys.has(key)) descriptor.readOnlyReason = 'type-conflict';
		if (canonical && (SYSTEM_KEYS.has(canonical.name) || canonical.internal && !SPECIAL_KEYS.has(canonical.name))) descriptor.merge = 'system';
		else if (key && SPECIAL_KEYS.has(key)) descriptor.merge = 'special';
		if (mapping && !canonical) {
			try {
				const definition = resolveInlinePropertyDefinition(sourceName, mapping.type, [...this.context.keyMappings], this.context.inlineDefinitions);
				if (definition.encoding === 'vault-v1') descriptor.interpretation = 'native';
			} catch { descriptor.readOnlyReason = 'type-conflict'; }
			const aliases = new Set(getManagedYamlAliases(mapping.canonicalKey, [mapping]).map(identity));
			const assigned = Object.entries(this.context.propertyTypes ?? {}).filter(([name]) => aliases.has(identity(name)));
			if (assigned.some(([, type]) => (type === 'multitext' ? 'list' : type) !== mapping.type)
				|| new Set(assigned.map(([name]) => identity(name))).size !== assigned.length) descriptor.readOnlyReason = 'type-conflict';
		}
		if (descriptor.interpretation === 'native' && !descriptor.readOnlyReason) {
			const typeName = Object.keys(this.nativeTypes).find(name =>
				identity(name) === identity(sourceName) || key !== undefined && this.aliases.get(identity(name))?.has(key));
			descriptor.type = typeName ? this.nativeTypes[typeName] : null;
			descriptor.readOnlyReason = this.context.propertyTypes === null ? 'unavailable'
				: nativePropertyReadOnlyReason(sourceName, undefined, this.context.propertyTypes, [...this.context.keyMappings], this.nativeTypes);
			if (!mapping && !isWritableRawYamlPropertyName(identity(sourceName), [...this.context.keyMappings])) descriptor.readOnlyReason = 'unsupported';
		}
		if (!sourceName.trim() || /[\r\n{}]|::/u.test(sourceName)) descriptor.readOnlyReason = 'unsupported';
		if (descriptor.merge === 'scalar' && descriptor.type === 'list') descriptor.merge = key === 'contexts' || key === 'tags' ? 'set' : 'sequence';
		return descriptor;
	}

	read(property: CreationDraftProperty, raw: unknown): { value?: VaultPropertyValue; readOnlyReason?: NativePropertyReadOnlyReason } {
		if (property.interpretation === 'native' && this.context.propertyTypes !== null && property.readOnlyReason !== 'type-conflict') {
			const reason = nativePropertyReadOnlyReason(property.sourceName, raw, this.context.propertyTypes, [...this.context.keyMappings], this.nativeTypes);
			if (reason) return { readOnlyReason: reason };
		}
		if (property.readOnlyReason) return { readOnlyReason: property.readOnlyReason };
		if (!property.type) return { readOnlyReason: 'unavailable' };
		// YAML's explicit blank is preserved here. Encoding into a task source is a later stage.
		if (raw === null) return { value: null };
		try {
			let value: unknown = raw;
			if (property.interpretation !== 'native' && typeof raw === 'string') {
				value = property.type === 'list' ? parseListValue(raw)
					: property.type === 'text' ? raw : decodeVaultPropertyValue(raw, property.type);
			}
			if (property.merge === 'set' && Array.isArray(value)) {
				if (!value.every(item => typeof item === 'string')) return { readOnlyReason: 'type-conflict' };
				value = value.map(item => this.memberIdentity(property, item)).filter(Boolean);
			}
			// The codec is the existing native type validator; it does not change the input.
			encodeVaultPropertyValue(value as VaultPropertyValue, property.type);
			return { value: structuredClone(value) as VaultPropertyValue };
		} catch {
			const unsupported = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
				|| Array.isArray(raw) && raw.some(item => typeof item !== 'string' && typeof item !== 'number');
			return { readOnlyReason: unsupported ? 'unsupported' : 'type-conflict' };
		}
	}

	memberIdentity(property: CreationDraftProperty, value: string): string {
		return property.canonicalKey === 'tags' ? value.trim().replace(/^#/, '').trim() : value.trim();
	}

	private addAliases(key: string, aliases: readonly string[]): void {
		for (const alias of aliases) {
			const keys = this.aliases.get(identity(alias)) ?? new Set<string>();
			keys.add(key);
			this.aliases.set(identity(alias), keys);
		}
	}
}

/** Preserve configured inheritance and pipeline rules, but do not promote defaults to parent values. */
export function creationDraftParentFields(
	parentTaskId: string | null,
	parentFields: Record<string, string> | null,
	parentTags: readonly string[] | null,
	settings: OperonSettings,
	nativeValues: ReadonlyMap<string, VaultPropertyValue> = new Map(),
): CreationDraftFieldInput[] {
	if (!parentTaskId) return [];
	const inherited = resolveSubtaskInitialFieldsFromParentValues(parentTaskId, parentFields, settings, parentTags);
	if (!parentFields?.priority?.trim() || !normalizeChildTaskInheritanceFields(settings.childTaskInheritanceFields, settings.keyMappings).includes('priority')) delete inherited.priority;
	const fields = Object.entries(inherited).filter(([, value]) => value !== undefined).map(([sourceName, value]) => ({
		sourceName, value: structuredClone(nativeValues.has(sourceName) ? nativeValues.get(sourceName) : value),
	}));
 for (const key of normalizeChildTaskInheritanceFields(settings.childTaskInheritanceFields, settings.keyMappings)) {
  if (!nativeValues.has(key) || fields.some(field => field.sourceName === key)) continue;
  fields.push({ sourceName: key, value: structuredClone(nativeValues.get(key)) });
 }
 return fields;
}
