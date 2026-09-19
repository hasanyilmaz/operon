import { normalizeColorPaletteHex } from './color-palette';
import { normalizeTaskColorValue } from './task-color-value';
import type { OperonSettings } from '../types/settings';
import { isManagedCustomFieldMapping } from './managed-task-fields';
import { splitTaskListValue } from './task-field-patch';
import { composeStatusValue } from './workflow-status-value';

export const PROPERTY_POOL_KEYS = ['status', 'priority', 'tags', 'contexts', 'assignees', 'location', 'taskType', 'taskIcon', 'taskColor'] as const;
export type PropertyPoolKey = typeof PROPERTY_POOL_KEYS[number];
export type PropertyPoolFieldType = 'text' | 'list' | 'number' | 'checkbox';
export interface PropertyPoolField {
	key: string;
	label: string;
	icon: string;
	type: PropertyPoolFieldType;
	operation: 'replace' | 'add';
}
export interface PropertyPoolFavorite {
	key: string;
	type: PropertyPoolFieldType;
	value: string;
	label: string;
	priorityId?: string;
	pipelineId?: string;
	statusId?: string;
}
export interface PropertyPoolPreferences {
	version: 2;
	shortcuts: Array<{ key: PropertyPoolKey; visible: boolean }>;
	favorites: PropertyPoolFavorite[];
}
export interface PropertyPoolValue extends PropertyPoolFavorite {
	searchText: string;
}

const ICONS: Record<PropertyPoolKey, string> = { status: 'workflow', priority: 'signal-high', tags: 'tags', contexts: 'map-pinned', assignees: 'users', location: 'map-pin', taskType: 'type', taskIcon: 'image', taskColor: 'palette' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function defaultPropertyPoolPreferences(): PropertyPoolPreferences {
	return { version: 2, shortcuts: PROPERTY_POOL_KEYS.map((key, index) => ({ key, visible: index < 6 })), favorites: [] };
}

export function propertyPoolFavoriteId(value: PropertyPoolFavorite): string {
	const identity = value.key === 'priority' ? [value.priorityId]
		: value.key === 'status' ? [value.pipelineId, value.statusId] : [value.type, value.value];
	return JSON.stringify([value.key, ...identity]);
}

/** Preserve the raw section separately; an invalid/future section is never repaired on read. */
export function readPropertyPoolPreferences(raw: unknown): { writable: boolean; preferences: PropertyPoolPreferences } {
	const fallback = defaultPropertyPoolPreferences();
	if (raw === undefined) return { writable: true, preferences: fallback };
	if (!record(raw) || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.shortcuts) || !Array.isArray(raw.favorites)) return { writable: false, preferences: fallback };
	const keys = new Set<string>();
	for (const shortcut of raw.shortcuts) {
		if (!record(shortcut) || !PROPERTY_POOL_KEYS.includes(shortcut.key as PropertyPoolKey) || typeof shortcut.visible !== 'boolean' || keys.has(String(shortcut.key))) return { writable: false, preferences: fallback };
		keys.add(String(shortcut.key));
	}
	if (PROPERTY_POOL_KEYS.slice(0, 6).some(key => !keys.has(key)) || (raw.version === 1 && keys.size !== 6)) return { writable: false, preferences: fallback };
	const ids = new Set<string>();
	for (const favorite of raw.favorites) {
		if (!record(favorite) || !nonempty(favorite.key) || !nonempty(favorite.value) || !nonempty(favorite.label) || (typeof favorite.type !== 'string' || !['text', 'list', ...(raw.version === 2 ? ['number', 'checkbox'] : [])].includes(favorite.type))) return { writable: false, preferences: fallback };
		if (favorite.type === 'number' && (!favorite.value.trim() || !Number.isFinite(Number(favorite.value)))) return { writable: false, preferences: fallback };
		if (favorite.type === 'checkbox' && favorite.value !== 'true' && favorite.value !== 'false') return { writable: false, preferences: fallback };
		if (favorite.key === 'priority' && !nonempty(favorite.priorityId)) return { writable: false, preferences: fallback };
		if (favorite.key === 'status' && (!nonempty(favorite.pipelineId) || !nonempty(favorite.statusId))) return { writable: false, preferences: fallback };
		const id = propertyPoolFavoriteId(favorite as unknown as PropertyPoolFavorite);
		if (ids.has(id)) return { writable: false, preferences: fallback };
		ids.add(id);
	}
	const preferences = JSON.parse(JSON.stringify(raw)) as PropertyPoolPreferences;
	preferences.version = 2;
	for (const key of PROPERTY_POOL_KEYS) if (!keys.has(key)) preferences.shortcuts.push({ key, visible: false });
	return { writable: true, preferences };
}

export function propertyPoolFields(settings: Pick<OperonSettings, 'keyMappings'>): PropertyPoolField[] {
	const fields: PropertyPoolField[] = PROPERTY_POOL_KEYS.map(key => {
		const mapping = settings.keyMappings.find(item => item.canonicalKey === key && item.isSystem !== false);
		const type = ['tags', 'contexts', 'assignees'].includes(key) ? 'list' : 'text';
		return { key, label: mapping?.visiblePropertyName || key, icon: mapping?.icon || ICONS[key], type, operation: type === 'list' ? 'add' : 'replace' };
	});
	for (const mapping of settings.keyMappings) {
		if (!isManagedCustomFieldMapping(mapping) || !mapping.enabled || (mapping.type !== 'text' && mapping.type !== 'list') || fields.some(field => field.key === mapping.canonicalKey)) continue;
		fields.push({ key: mapping.canonicalKey, label: mapping.visiblePropertyName || mapping.canonicalKey, icon: mapping.icon || (mapping.type === 'list' ? 'list' : 'text'), type: mapping.type, operation: mapping.type === 'list' ? 'add' : 'replace' });
	}
	return fields;
}

export function searchPropertyPoolFields(settings: Pick<OperonSettings, 'keyMappings'>, query: string): PropertyPoolField[] {
	const token = query.trim().toLocaleLowerCase();
	if (Array.from(token).length < 2) return [];
	return propertyPoolFields(settings).filter(field => [field.key, field.label, ...(field.key === 'status' ? ['pipeline'] : [])].some(name => name.toLocaleLowerCase().startsWith(token)));
}

export function resolvePropertyPoolFavorite(settings: Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines'>, favorite: PropertyPoolFavorite): PropertyPoolFavorite | null {
	const field = propertyPoolFields(settings).find(item => item.key === favorite.key);
	if (!field || field.type !== favorite.type) return null;
	if (favorite.key === 'priority') {
		const priority = settings.priorities.find(item => item.id === favorite.priorityId);
		return priority ? { ...favorite, value: priority.label, label: priority.label } : null;
	}
	if (favorite.key === 'status') {
		const pipeline = settings.pipelines.find(item => item.id === favorite.pipelineId);
		const status = pipeline?.statuses.find(item => item.id === favorite.statusId);
		return pipeline && status ? { ...favorite, value: composeStatusValue(pipeline.name, status.label), label: `${pipeline.name}.${status.label}` } : null;
	}
	return { ...favorite };
}

export function filterPropertyPoolValues(values: readonly PropertyPoolValue[], query: string, favorites: readonly PropertyPoolFavorite[]): PropertyPoolValue[] {
	const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	const ids = new Set(favorites.map(propertyPoolFavoriteId));
	return values.filter(value => tokens.every(token => value.searchText.toLocaleLowerCase().includes(token)))
		.sort((a, b) => Number(ids.has(propertyPoolFavoriteId(b))) - Number(ids.has(propertyPoolFavoriteId(a))));
}

export interface PropertyPoolPreview {
	before: string | string[];
	after: string | string[];
	changed: boolean;
	reason: 'unavailable' | 'read-only' | 'already-present' | null;
}

/** Pure calculation only. The drop owner must revalidate and write via the existing task operation. */
export function previewPropertyPoolValue(settings: Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines'>, favorite: PropertyPoolFavorite, before: string | string[], writable = true): PropertyPoolPreview {
	const resolved = resolvePropertyPoolFavorite(settings, favorite);
	if (!writable || !resolved) return { before, after: before, changed: false, reason: writable ? 'unavailable' : 'read-only' };
	if (resolved.type !== 'list') {
		if (Array.isArray(before)) return { before, after: before, changed: false, reason: 'unavailable' };
		if (resolved.key === 'taskColor') {
			const color = normalizeColorPaletteHex(resolved.value);
			if (!color) return { before, after: before, changed: false, reason: 'unavailable' };
			const same = normalizeColorPaletteHex(before) === color;
			return { before, after: same ? before : normalizeTaskColorValue(color), changed: !same, reason: same ? 'already-present' : null };
		}
		return { before, after: resolved.value, changed: before !== resolved.value, reason: before === resolved.value ? 'already-present' : null };
	}
	const values = Array.isArray(before) ? [...before] : splitTaskListValue(before);
	const normalize = (value: string) => resolved.key === 'tags' ? value.trim().replace(/^#+/, '') : value.trim();
	const duplicate = values.some(value => normalize(value) === normalize(resolved.value));
	const after = duplicate ? values : [...values, normalize(resolved.value)];
	return { before, after: Array.isArray(before) ? after : after.join('; '), changed: !duplicate, reason: duplicate ? 'already-present' : null };
}

export type PropertyPoolEdit =
	| { kind: 'preferences'; preferences: PropertyPoolPreferences }
	| { kind: 'favorite'; favorite: PropertyPoolFavorite; saved: boolean }
	| { kind: 'shortcuts'; shortcuts: PropertyPoolPreferences['shortcuts'] };

export function editPropertyPoolPreferences(raw: unknown, edit: PropertyPoolEdit): PropertyPoolPreferences {
	const { writable, preferences } = readPropertyPoolPreferences(raw);
	if (!writable) throw new Error('Property Value Pool settings are unavailable');
	if (edit.kind === 'preferences') {
		if (!readPropertyPoolPreferences(edit.preferences).writable) throw new Error('Invalid Property Value Pool settings');
		const next = readPropertyPoolPreferences(edit.preferences).preferences;
		return {
			...preferences, ...next,
			shortcuts: next.shortcuts.map(item => ({ ...preferences.shortcuts.find(previous => previous.key === item.key), ...item })),
			favorites: next.favorites.map(item => ({ ...preferences.favorites.find(previous => propertyPoolFavoriteId(previous) === propertyPoolFavoriteId(item)), ...item })),
		};
	} else if (edit.kind === 'shortcuts') {
		preferences.shortcuts = edit.shortcuts.map(shortcut => ({ ...preferences.shortcuts.find(item => item.key === shortcut.key), ...shortcut }));
	} else {
		const id = propertyPoolFavoriteId(edit.favorite);
		if (!edit.saved) preferences.favorites = preferences.favorites.filter(item => propertyPoolFavoriteId(item) !== id);
		else if (!preferences.favorites.some(item => propertyPoolFavoriteId(item) === id)) preferences.favorites.push({ ...edit.favorite });
	}
	if (!readPropertyPoolPreferences(preferences).writable) throw new Error('Invalid Property Value Pool settings');
	return preferences;
}
