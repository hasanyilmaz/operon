import { getDefaultKeyMappingIcon, type KeyMapping } from '../types/settings';
import type { TaskEditorPropertyRef } from '../types/task-editor-sections';
import { normalizeTaskIconValue, vaultPropertyIconKey } from './task-icon-value';
import { getManagedYamlAliases } from './yaml-fields';

export interface PropertyIconSettings {
	keyMappings: readonly KeyMapping[];
	vaultPropertyIcons?: Readonly<Record<string, string>>;
}

// Mapping name edits publish a new array. Share alias lookups across all property surfaces.
const aliasIndexes = new WeakMap<readonly KeyMapping[], ReadonlyMap<string, KeyMapping | null>>();

export function getPropertyMappingAliases(mappings: readonly KeyMapping[]): ReadonlyMap<string, KeyMapping | null> {
	let aliases = aliasIndexes.get(mappings);
	if (aliases) return aliases;
	const index = new Map<string, KeyMapping | null>();
	for (const mapping of mappings) {
		if (mapping.enabled === false) continue;
		for (const name of getManagedYamlAliases(mapping.canonicalKey, [mapping])) {
			const key = vaultPropertyIconKey(name);
			index.set(key, index.has(key) && index.get(key) !== mapping ? null : mapping);
		}
	}
	aliases = index;
	aliasIndexes.set(mappings, aliases);
	return aliases;
}

function readVaultIcon(settings: PropertyIconSettings, key: string): string {
	const icons = settings.vaultPropertyIcons;
	return icons && Object.prototype.hasOwnProperty.call(icons, key) ? normalizeTaskIconValue(icons[key]) : '';
}

/** Resolves a source property name. An active mapping owns the icon even when it uses the default. */
export function getSourcePropertyIcon(settings: PropertyIconSettings, name: string, fallback = ''): string {
	const key = vaultPropertyIconKey(name);
	const mapping = getPropertyMappingAliases(settings.keyMappings).get(key);
	const icon = mapping !== undefined ? normalizeTaskIconValue(mapping?.icon) : readVaultIcon(settings, key);
	return icon || fallback;
}

export interface PropertyIconEdit {
	ref: TaskEditorPropertyRef;
	icon: string;
	mappingIdentity?: string;
	defaultIcon?: string;
}

export function capturePropertyIconEdit(settings: PropertyIconSettings, ref: TaskEditorPropertyRef): PropertyIconEdit | null {
	if (ref.kind === 'vault') {
		const key = vaultPropertyIconKey(ref.name);
		if (!key || getPropertyMappingAliases(settings.keyMappings).has(key)) return null;
		return { ref: { kind: 'vault', name: key }, icon: readVaultIcon(settings, key) };
	}
	const owners = settings.keyMappings.filter(mapping => mapping.canonicalKey === ref.key);
	if (owners.length !== 1) return null;
	const mapping = owners[0];
	const defaultIcon = mapping.isSystem !== false ? getDefaultKeyMappingIcon(mapping.canonicalKey) : '';
	return {
		ref,
		icon: normalizeTaskIconValue(mapping.icon ?? defaultIcon),
		defaultIcon,
		mappingIdentity: JSON.stringify([mapping.visiblePropertyName, mapping.type, mapping.isSystem !== false, mapping.enabled !== false]),
	};
}

export function propertyIconEditMatches(settings: PropertyIconSettings, expected: PropertyIconEdit): boolean {
	const current = capturePropertyIconEdit(settings, expected.ref);
	return current !== null && current.icon === expected.icon && current.mappingIdentity === expected.mappingIdentity;
}
