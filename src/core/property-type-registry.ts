import { isSupportedRawYamlPropertyValue } from './raw-yaml-property';
import type { App } from 'obsidian';

export type ObsidianPropertyTypeId =
	| 'text'
	| 'multitext'
	| 'number'
	| 'checkbox'
	| 'date'
	| 'datetime'
	| 'aliases'
	| 'tags'
	| 'unknown';

export async function loadPropertyTypeRegistry(
	app: App,
): Promise<Record<string, ObsidianPropertyTypeId>> {
	const path = `${app.vault.configDir}/types.json`;
	if (app.vault.adapter.exists && !await app.vault.adapter.exists(path)) return {};
	const raw = await app.vault.adapter.read(path);
	const parsed: unknown = JSON.parse(raw);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid property type registry');
	const types = (parsed as { types?: unknown }).types;
	if (!types || typeof types !== 'object' || Array.isArray(types)) throw new Error('Invalid property type registry');
	const resolved: Record<string, ObsidianPropertyTypeId> = {};
	for (const [propertyName, type] of Object.entries(types)) {
		const normalizedType = normalizeObsidianPropertyTypeId(type);
		resolved[propertyName] = normalizedType ?? 'unknown';
	}
	return resolved;
}

function normalizeObsidianPropertyTypeId(value: unknown): ObsidianPropertyTypeId | null {
	if (
		value === 'text'
		|| value === 'multitext'
		|| value === 'number'
		|| value === 'checkbox'
		|| value === 'date'
		|| value === 'datetime'
		|| value === 'aliases'
		|| value === 'tags'
	) return value;
	return null;
}

export function inferObsidianPropertyType(samples: readonly unknown[]): ObsidianPropertyTypeId {
	const meaningful = samples.filter(value => (
		value !== null
		&& value !== undefined
		&& value !== ''
		&& isSupportedRawYamlPropertyValue(value)
	));
	if (meaningful.length === 0) return 'unknown';
	if (meaningful.every(value => typeof value === 'boolean')) return 'checkbox';
	if (meaningful.every(value => typeof value === 'number')) return 'number';
	if (meaningful.every(value => Array.isArray(value))) return 'multitext';
	return 'text';
}
