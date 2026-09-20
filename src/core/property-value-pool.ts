import { applyReminderListMutation } from './reminder-list-mutation';
import { parseReminderRule } from './reminder-rules';
import { PROPERTY_POOL_DATE_KEYS, isPropertyPoolDateRule, resolvePropertyPoolDate } from './property-pool-dates';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from './task-media-reference';
import { normalizeColorPaletteHex } from './color-palette';
import { normalizeTaskColorValue } from './task-color-value';
import type { OperonSettings } from '../types/settings';
import { isManagedCustomFieldMapping } from './managed-task-fields';
import { splitTaskListValue } from './task-field-patch';
import { composeStatusValue } from './workflow-status-value';

export const PROPERTY_POOL_KEYS = ['status', 'priority', 'tags', 'contexts', 'assignees', 'location', 'taskType', 'taskIcon', 'taskColor', 'estimate', 'links', 'taskImage', 'taskGallery', ...PROPERTY_POOL_DATE_KEYS, 'reminderRules'] as const;
// Escape real property keys so special shortcut groups never replace a custom field.
export const propertyPoolScopeKey = (key: string): string => key.startsWith('@') ? `@${key}` : key;
export const propertyPoolScopeField = (scope: string): string => scope.startsWith('@@') ? scope.slice(1) : scope;
export type PropertyPoolKey = typeof PROPERTY_POOL_KEYS[number];
export type PropertyPoolFieldType = 'text' | 'list' | 'number' | 'checkbox' | 'date';
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
	version: 5;
	shortcuts: Array<{ key: string; visible: boolean }>;
	favorites: PropertyPoolFavorite[];
}
export interface PropertyPoolValue extends PropertyPoolFavorite {
	searchText: string;
	resolvedDate?: string;
}

const ICONS: Record<PropertyPoolKey, string> = { status: 'workflow', priority: 'signal-high', tags: 'tags', contexts: 'map-pinned', assignees: 'users', location: 'map-pin', taskType: 'type', taskIcon: 'image', taskColor: 'palette', estimate: 'timer', links: 'link', taskImage: 'image', taskGallery: 'images', dateDue: 'calendar-clock', dateScheduled: 'calendar-days', dateStarted: 'calendar-plus', dateCompleted: 'calendar-check', dateCancelled: 'calendar-x', reminderRules: 'bell' };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function defaultPropertyPoolPreferences(): PropertyPoolPreferences {
	return { version: 5, shortcuts: legacyPropertyPoolShortcuts(PROPERTY_POOL_KEYS.map((key, index) => ({ key, visible: index < 6 }))), favorites: [] };
}

function legacyPropertyPoolShortcuts(shortcuts: PropertyPoolPreferences['shortcuts']): PropertyPoolPreferences['shortcuts'] {
	const ordered = [...shortcuts.filter(item => item.visible), ...shortcuts.filter(item => !item.visible)];
	const slots = [{ key: '@all', visible: true }, { key: '@favorites', visible: true }, ...ordered.slice(0, 7)];
	while (slots.length < 9) slots.push({ key: '', visible: false });
	return slots;
}

export function propertyPoolFavoriteId(value: PropertyPoolFavorite): string {
	const identity = value.key === 'priority' ? [value.priorityId]
		: value.key === 'status' ? [value.pipelineId, value.statusId] : [value.type, value.type === 'number' && value.value.trim() && Number.isFinite(Number(value.value)) ? String(Number(value.value)) : value.value];
	return JSON.stringify([value.key, ...identity]);
}

function storedPropertyPoolFavoriteId(value: PropertyPoolFavorite): string {
	return value.type === 'number' ? JSON.stringify([value.key, value.type, value.value]) : propertyPoolFavoriteId(value);
}

/** Preserve the raw section separately; an invalid/future section is never repaired on read. */
export function readPropertyPoolPreferences(raw: unknown): { writable: boolean; preferences: PropertyPoolPreferences } {
	const fallback = defaultPropertyPoolPreferences();
	if (raw === undefined) return { writable: true, preferences: fallback };
	if (!record(raw) || (raw.version !== 1 && raw.version !== 2 && raw.version !== 3 && raw.version !== 4 && raw.version !== 5) || !Array.isArray(raw.shortcuts) || !Array.isArray(raw.favorites)) return { writable: false, preferences: fallback };
	const keys = new Set<string>();
	for (const shortcut of raw.shortcuts) {
		if (!record(shortcut) || typeof shortcut.key !== 'string' || (raw.version !== 4 && raw.version !== 5 && !PROPERTY_POOL_KEYS.includes(shortcut.key as PropertyPoolKey)) || typeof shortcut.visible !== 'boolean' || (shortcut.key !== '' && keys.has(shortcut.key))) return { writable: false, preferences: fallback };
		keys.add(String(shortcut.key));
	}
	if ((raw.version === 4 || raw.version === 5) ? raw.shortcuts.length !== 9 : PROPERTY_POOL_KEYS.slice(0, 6).some(key => !keys.has(key)) || (raw.version === 1 && keys.size !== 6)) return { writable: false, preferences: fallback };
	const ids = new Set<string>();
	for (const favorite of raw.favorites) {
		if (!record(favorite) || !nonempty(favorite.key) || !nonempty(favorite.value) || !nonempty(favorite.label) || (typeof favorite.type !== 'string' || !['text', 'list', ...(raw.version !== 1 ? ['number', 'checkbox'] : []), ...((raw.version === 3 || raw.version === 4 || raw.version === 5) ? ['date'] : [])].includes(favorite.type))) return { writable: false, preferences: fallback };
		if (favorite.type === 'date' && !isPropertyPoolDateRule(String(favorite.value))) return { writable: false, preferences: fallback };
		if (favorite.type === 'number' && (!favorite.value.trim() || !Number.isFinite(Number(favorite.value)))) return { writable: false, preferences: fallback };
		if (favorite.type === 'checkbox' && favorite.value !== 'true' && favorite.value !== 'false') return { writable: false, preferences: fallback };
		if (favorite.key === 'priority' && !nonempty(favorite.priorityId)) return { writable: false, preferences: fallback };
		if (favorite.key === 'status' && (!nonempty(favorite.pipelineId) || !nonempty(favorite.statusId))) return { writable: false, preferences: fallback };
		// V2 previously admitted equivalent numeric spellings; retain those records without rewriting them.
		const id = storedPropertyPoolFavoriteId(favorite as unknown as PropertyPoolFavorite);
		if (ids.has(id)) return { writable: false, preferences: fallback };
		ids.add(id);
	}
	const preferences = JSON.parse(JSON.stringify(raw)) as PropertyPoolPreferences;
	preferences.version = 5;
	if (raw.version !== 4 && raw.version !== 5) preferences.shortcuts = legacyPropertyPoolShortcuts(preferences.shortcuts);
	if (raw.version === 4) preferences.shortcuts = preferences.shortcuts.map(item => ({ ...item, key: item.key === '@all' || item.key === '@favorites' ? item.key : propertyPoolScopeKey(item.key) }));
	return { writable: true, preferences };
}

export function propertyPoolFields(settings: Pick<OperonSettings, 'keyMappings'>): PropertyPoolField[] {
	const fields: PropertyPoolField[] = PROPERTY_POOL_KEYS.map(key => {
		const mapping = settings.keyMappings.find(item => item.canonicalKey === key && item.isSystem !== false);
		const type = PROPERTY_POOL_DATE_KEYS.some(dateKey => dateKey === key) ? 'date' : key === 'estimate' ? 'number' : ['tags', 'contexts', 'assignees', 'links', 'taskGallery', 'reminderRules'].includes(key) ? 'list' : 'text';
		return { key, label: mapping?.visiblePropertyName || key, icon: mapping?.icon || ICONS[key], type, operation: type === 'list' ? 'add' : 'replace' };
	});
	for (const mapping of settings.keyMappings) {
		if (!isManagedCustomFieldMapping(mapping) || !mapping.enabled || !['text', 'list', 'number', 'checkbox', 'date'].includes(mapping.type) || fields.some(field => field.key === mapping.canonicalKey)) continue;
		fields.push({ key: mapping.canonicalKey, label: mapping.visiblePropertyName || mapping.canonicalKey, icon: mapping.icon || (mapping.type === 'date' ? 'calendar' : mapping.type === 'number' ? 'hash' : mapping.type === 'checkbox' ? 'square-check' : mapping.type === 'list' ? 'list' : 'text'), type: mapping.type as PropertyPoolFieldType, operation: mapping.type === 'list' ? 'add' : 'replace' });
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
	if (!field || field.type !== favorite.type || (favorite.type === 'date' && !isPropertyPoolDateRule(favorite.value))) return null;
	if (favorite.key === 'reminderRules' && !parseReminderRule(favorite.value).ok) return null;
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
export function previewPropertyPoolValue(settings: Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines'>, favorite: PropertyPoolFavorite, before: string | string[], writable = true, now = new Date()): PropertyPoolPreview {
	const resolved = resolvePropertyPoolFavorite(settings, favorite);
	if (!writable || !resolved) return { before, after: before, changed: false, reason: writable ? 'unavailable' : 'read-only' };
	if (resolved.key === 'reminderRules') {
		const mutation = applyReminderListMutation({ fieldKey: 'reminderRules', currentValue: Array.isArray(before) ? before.join('; ') : before, mutation: { action: 'add', nextValue: resolved.value } });
		return { before, after: mutation.ok ? mutation.fieldValue : before, changed: mutation.ok && mutation.changed, reason: mutation.ok ? (mutation.changed ? null : 'already-present') : mutation.reason === 'duplicate' ? 'already-present' : 'unavailable' };
	}
	if (resolved.type !== 'list') {
		if (Array.isArray(before)) return { before, after: before, changed: false, reason: 'unavailable' };
		if (resolved.type === 'checkbox' && before && before !== 'true' && before !== 'false') return { before, after: before, changed: false, reason: 'unavailable' };
		if (resolved.type === 'number' && before.trim() && Number(before) === Number(resolved.value)) return { before, after: before, changed: false, reason: 'already-present' };
		if (resolved.key === 'taskColor') {
			const color = normalizeColorPaletteHex(resolved.value);
			if (!color) return { before, after: before, changed: false, reason: 'unavailable' };
			const same = normalizeColorPaletteHex(before) === color;
			return { before, after: same ? before : normalizeTaskColorValue(color), changed: !same, reason: same ? 'already-present' : null };
		}
		if (resolved.type === 'date') {
			const date = resolvePropertyPoolDate(resolved.key, resolved.value, now);
			return { before, after: date ?? before, changed: !!date && before !== date, reason: !date ? 'unavailable' : before === date ? 'already-present' : null };
		}
		return { before, after: resolved.value, changed: before !== resolved.value, reason: before === resolved.value ? 'already-present' : null };
	}
	const values = Array.isArray(before) ? [...before] : resolved.key === 'taskGallery' ? parseTaskMediaReferenceList(before) : splitTaskListValue(before);
	const normalize = (value: string) => resolved.key === 'tags' ? value.trim().replace(/^#+/, '') : value.trim();
	const duplicate = values.some(value => normalize(value) === normalize(resolved.value));
	const after = duplicate ? values : [...values, normalize(resolved.value)];
	return { before, after: Array.isArray(before) ? after : resolved.key === 'taskGallery' ? serializeTaskMediaReferenceList(after) : after.join('; '), changed: !duplicate, reason: duplicate ? 'already-present' : null };
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
			shortcuts: next.shortcuts.map(item => {
				// Complete slot records carry their own opaque metadata through reassignment and reordering.
				if (Object.keys(item).some(key => key !== 'key' && key !== 'visible')) return { ...item };
				const previous = item.key ? preferences.shortcuts.find(previous => previous.key === item.key) : undefined;
				return { ...previous, ...item };
			}),
			favorites: next.favorites.map(item => ({ ...preferences.favorites.find(previous => storedPropertyPoolFavoriteId(previous) === storedPropertyPoolFavoriteId(item)), ...item })),
		};
	} else if (edit.kind === 'shortcuts') {
		preferences.shortcuts = edit.shortcuts.map(shortcut => ({ ...shortcut }));
	} else {
		const id = propertyPoolFavoriteId(edit.favorite);
		if (!edit.saved) preferences.favorites = preferences.favorites.filter(item => propertyPoolFavoriteId(item) !== id);
		else if (!preferences.favorites.some(item => propertyPoolFavoriteId(item) === id)) preferences.favorites.push({ ...edit.favorite });
	}
	if (!readPropertyPoolPreferences(preferences).writable) throw new Error('Invalid Property Value Pool settings');
	return preferences;
}
