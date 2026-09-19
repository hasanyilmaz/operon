import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from './task-media-reference';
import { formatDurationHuman } from '../systems/tracker-utils';
import { previewPropertyPoolValue, resolvePropertyPoolFavorite, type PropertyPoolFavorite } from './property-value-pool';
import { parseListValue } from './parser';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';

export type PropertyPoolBlock = 'unavailable' | 'read-only' | 'already-present' | 'workflow' | 'conflict' | 'failed';
export interface PropertyPoolTaskPlan {
	id: string; path: string; format: string; favorite: PropertyPoolFavorite; signature: string;
	mediaTarget?: string;
	basis?: Record<string, string>;
	dropExpected?: Record<string, string>;
	before: Record<string, string>; after: Record<string, string>; label: string; reason: PropertyPoolBlock | null;
}
export interface PropertyPoolTaskResult { status: 'committed' | 'unchanged' | 'blocked' | 'conflict' | 'failed'; warning?: boolean }
export interface PropertyPoolTaskBridge {
	prepare(id: string, favorite: PropertyPoolFavorite): PropertyPoolTaskPlan | null;
	apply(plan: PropertyPoolTaskPlan, direction: 'drop' | 'undo' | 'redo', allowed: () => boolean): Promise<PropertyPoolTaskResult>;
}
export function propertyPoolTaskValue(task: IndexedTask, key: string): string {
	return key === '_tags' ? task.tags.join(';') : key === '_checkbox' ? task.checkbox : task.fieldValues[key] ?? '';
}
export function propertyPoolTaskSignature(settings: OperonSettings, favorite: PropertyPoolFavorite): string {
	return JSON.stringify([settings.keyMappings, favorite.key === 'taskColor' ? settings.colorPalette : null, resolvePropertyPoolFavorite(settings, favorite), settings.pipelines,
		settings.fileTaskPipelineLocations, settings.fileTaskAutoArchiveEnabled, settings.fileTaskArchiveFolder,
		settings.fileTaskArchivePipelineLocations, settings.fileTaskArchiveOnlyFromFileTasksFolder, settings.pinnedDockAutoUnpinFinished,
		favorite.key === 'estimate' ? [settings.defaultPipelineName, settings.createDailyNotesAsOperonTask, settings.createWeeklyNotesAsOperonTask] : null]);
}
export interface PropertyPoolMutationPort {
	read(id: string): IndexedTask | null;
	signature(value: PropertyPoolFavorite): string;
	prepare(id: string, value: PropertyPoolFavorite): PropertyPoolTaskPlan | null;
	blocked(task: IndexedTask, payload: Record<string, string>): boolean;
	write(id: string, next: Record<string, string>, expected: Record<string, string>, allowed: () => boolean): Promise<boolean>;
	matches(id: string, expected: Record<string, string>): Promise<boolean>;
	refresh(task: IndexedTask): Promise<boolean>;
}
export async function applyPropertyPoolTask(plan: PropertyPoolTaskPlan, direction: 'drop' | 'undo' | 'redo', allowed: () => boolean, port: PropertyPoolMutationPort): Promise<PropertyPoolTaskResult> {
	if (plan.reason) return { status: plan.reason === 'already-present' ? 'unchanged' : 'blocked' };
	const expected = { ...plan.basis, ...(direction === 'undo' ? plan.after : plan.before) };
	if (direction === 'drop') Object.assign(expected, plan.dropExpected);
	const next = { ...(direction === 'undo' ? plan.before : plan.after) };
	const task = port.read(plan.id);
	const current = () => {
		const fresh = port.read(plan.id);
		return allowed() && !!fresh && fresh.primary.filePath === plan.path && fresh.primary.format === plan.format
			&& port.signature(plan.favorite) === plan.signature && !port.blocked(fresh, next);
	};
	if (!task || !current()) return { status: 'conflict' };
	if (direction === 'drop') {
		const fresh = port.prepare(plan.id, plan.favorite);
		if (!fresh || fresh.reason || fresh.mediaTarget !== plan.mediaTarget || JSON.stringify(fresh.before) !== JSON.stringify(plan.before)
			|| JSON.stringify(fresh.after) !== JSON.stringify(plan.after) || JSON.stringify(fresh.basis) !== JSON.stringify(plan.basis) || JSON.stringify(fresh.dropExpected) !== JSON.stringify(plan.dropExpected)) return { status: 'conflict' };
	}
	// These source fields determine admission, even if metadata/index notification has not arrived yet.
	for (const key of ['repeat', 'repeatSeriesId', 'parentTask', 'status', 'dateCompleted', 'dateCancelled', 'blockedBy', 'blocking']) {
		if (!(key in expected)) expected[key] = task.fieldValues[key] ?? '';
	}
	if (plan.format === 'yaml') {
		// YAML checkbox is derived from the fully guarded status/date basis, never stored directly.
		delete expected._checkbox; delete next._checkbox;
	}
	let committed = false, warning = false;
	try { committed = await port.write(plan.id, next, expected, current); }
	catch (error) {
		console.error('Operon: property pool write settlement required', error); warning = true;
		try { committed = await port.matches(plan.id, next); } catch { /* Never replay an uncertain write. */ }
	}
	if (!committed) return { status: warning ? 'failed' : 'conflict' };
	try { warning = !await port.refresh(task) || warning; }
	catch (error) { warning = true; console.error('Operon: property pool refresh failed after commit', error); }
	return { status: 'committed', warning };
}
/** Preparation has no I/O. The bridge supplies the existing workflow normalization and admission rules. */
export function preparePropertyPoolTask(settings: OperonSettings, task: IndexedTask, favorite: PropertyPoolFavorite,
	normalize: (payload: Record<string, string>) => Record<string, string> | null,
	blocked: (payload: Record<string, string>) => boolean): PropertyPoolTaskPlan {
	const key = favorite.key === 'tags' ? '_tags' : favorite.key;
	const old = propertyPoolTaskValue(task, key);
	const input = favorite.type === 'list' ? (key === '_tags' ? task.tags : key === 'taskGallery' ? parseTaskMediaReferenceList(old) : parseListValue(old)) : old;
	const preview = previewPropertyPoolValue(settings, favorite, input);
	const value = key === 'taskGallery' && Array.isArray(preview.after) ? serializeTaskMediaReferenceList(preview.after) : Array.isArray(preview.after) ? preview.after.map(item => item.replace(/;/g, '\\;')).join('; ') : preview.after;
	const payload = normalize({ [key]: value });
	const before: Record<string, string> = {}, after: Record<string, string> = {};
	for (const [field, next] of Object.entries(payload ?? {})) {
		if (field === 'datetimeModified') continue;
		const previous = propertyPoolTaskValue(task, field);
		if (previous !== next) { before[field] = previous; after[field] = next; }
	}
	let dropExpected: Record<string, string> | undefined;
	if (task.primary.format === 'yaml' && favorite.type === 'number' && key in before && before[key].trim() && Number.isFinite(Number(before[key]))) {
		dropExpected = { [key]: before[key] };
		before[key] = String(Number(before[key]));
	}
	const scheduleKeys = ['estimate', 'datetimeStart', 'datetimeEnd', 'dateScheduled'];
	const affectsSchedule = favorite.key === 'estimate' || scheduleKeys.some(field => field in after);
	const basis = affectsSchedule ? Object.fromEntries(scheduleKeys.map(field => [field, task.fieldValues[field] ?? ''])) : undefined;
	const display = (field: string, value: string) => field === 'estimate' && Number(value) > 0 ? formatDurationHuman(Number(value)) : value || '—';
	const label = favorite.type === 'list' ? `+${favorite.label}` : `${display(key, old)} → ${favorite.label}`;
	const effects = affectsSchedule ? Object.entries(after).filter(([field]) => field !== key).map(([field, value]) => `${settings.keyMappings.find(mapping => mapping.canonicalKey === field)?.visiblePropertyName || field}: ${display(field, before[field])} → ${display(field, value)}`) : [];
	return { id: task.operonId, path: task.primary.filePath, format: task.primary.format, favorite: { ...favorite },
		signature: propertyPoolTaskSignature(settings, favorite), basis, dropExpected, before, after,
		label: [label, ...effects].join(' · '),
		reason: preview.reason ?? (favorite.type === 'list' && key !== 'taskGallery' && ((task.primary.format === 'yaml' || key === '_tags' || key === 'links') && favorite.value.includes(';') || /\\$/.test(old) || /\\$/.test(favorite.value)) ? 'unavailable'
			: !payload || blocked(payload) ? 'workflow' : Object.keys(after).length ? null : 'already-present') };
}
