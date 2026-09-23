import { REMINDER_RULE_ANCHORS, resolveReminderRule } from './reminder-rules';
import { buildReminderRuleCandidates } from '../ui/field-pickers/reminder-picker-model';
import type { PreparedPeriodicNotePlan } from './periodic-note-service';
import type { PeriodicNoteEffectiveConfig } from './periodic-note-config';
import { buildOperonPeriodicNoteConfig } from './periodic-note-settings';
import { propertyPoolDateContext } from './property-pool-dates';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from './task-media-reference';
import { formatDurationHuman } from '../systems/tracker-utils';
import { previewPropertyPoolValue, resolvePropertyPoolFavorite, type PropertyPoolFavorite } from './property-value-pool';
import { parseListValue } from './parser';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';

export type PropertyPoolBlock = 'unavailable' | 'read-only' | 'already-present' | 'workflow' | 'conflict' | 'failed' | 'reminder-missing' | 'reminder-invalid' | 'reminder-past' | 'reminder-duplicate';
export interface PropertyPoolTaskPlan {
	id: string; path: string; format: string; favorite: PropertyPoolFavorite; signature: string;
	mediaTarget?: string;
	group?: { label: string; canvasPath: string; values: PropertyPoolFavorite[] };
	dateContext?: string;
	reminderEpoch?: number;
	periodic?: { kind: 'daily' | 'weekly'; dateKey: string; path: string; parentId: string | null; config: PeriodicNoteEffectiveConfig; prepared?: PreparedPeriodicNotePlan };
	basis?: Record<string, string>;
	dropExpected?: Record<string, string>;
	before: Record<string, string>; after: Record<string, string>; label: string; reason: PropertyPoolBlock | null;
}
export interface PropertyPoolTaskResult { status: 'committed' | 'unchanged' | 'blocked' | 'conflict' | 'failed'; warning?: boolean; uncertain?: boolean; periodicNote?: { kind: 'daily' | 'weekly'; path: string } }
export interface CanvasGroupTaskBridge {
	prepare(id: string, label: string, canvasPath: string): PropertyPoolTaskPlan | null;
	apply(plan: PropertyPoolTaskPlan, direction: 'drop' | 'undo' | 'redo', allowed: () => boolean): Promise<PropertyPoolTaskResult>;
}
export interface PropertyPoolTaskBridge {
	prepare(id: string, favorite: PropertyPoolFavorite): PropertyPoolTaskPlan | null | Promise<PropertyPoolTaskPlan | null>;
	apply(plan: PropertyPoolTaskPlan, direction: 'drop' | 'undo' | 'redo', allowed: () => boolean): Promise<PropertyPoolTaskResult>;
}
export function propertyPoolTaskValue(task: IndexedTask, key: string): string {
	return key === '_tags' ? task.tags.join(';') : key === '_checkbox' ? task.checkbox : task.fieldValues[key] ?? '';
}
export function propertyPoolTaskSignature(settings: OperonSettings, favorite: PropertyPoolFavorite): string {
	return JSON.stringify([settings.keyMappings, favorite.key === 'taskColor' ? settings.colorPalette : null, resolvePropertyPoolFavorite(settings, favorite), settings.pipelines,
		settings.fileTaskPipelineLocations, settings.fileTaskAutoArchiveEnabled, settings.fileTaskArchiveFolder,
		settings.fileTaskArchivePipelineLocations, settings.fileTaskArchiveOnlyFromFileTasksFolder, settings.pinnedDockAutoUnpinFinished,
		(favorite.key === 'estimate' || favorite.type === 'date') ? [settings.defaultPipelineName, buildOperonPeriodicNoteConfig('daily', settings), buildOperonPeriodicNoteConfig('weekly', settings), settings.inlineTaskSaveMode] : null]);
}
export interface PropertyPoolMutationPort {
	read(id: string): IndexedTask | null;
	signature(value: PropertyPoolFavorite): string;
	prepare(id: string, value: PropertyPoolFavorite): PropertyPoolTaskPlan | null | Promise<PropertyPoolTaskPlan | null>;
	blocked(task: IndexedTask, payload: Record<string, string>): boolean;
	write(id: string, next: Record<string, string>, expected: Record<string, string>, allowed: () => boolean): Promise<boolean>;
	matches(id: string, expected: Record<string, string>): Promise<boolean>;
	refresh(task: IndexedTask): Promise<boolean>;
}
export function propertyPoolPeriodicSnapshot(plan: PropertyPoolTaskPlan): string {
    const item = plan.periodic;
    return JSON.stringify(item ? [item.kind, item.dateKey, item.path, item.parentId, item.config, item.prepared?.templatePath, item.prepared?.templateRevision] : null);
}
export function propertyPoolExpectedFields(plan: PropertyPoolTaskPlan, task: IndexedTask, direction: 'drop' | 'undo' | 'redo'): Record<string, string> {
    const expected = { ...plan.basis, ...(direction === 'undo' ? plan.after : plan.before) };
    if (direction === 'drop') Object.assign(expected, plan.dropExpected);
    for (const key of ['repeat', 'repeatSeriesId', 'parentTask', 'status', 'dateCompleted', 'dateCancelled', 'blockedBy', 'blocking']) {
        if (!(key in expected)) expected[key] = task.fieldValues[key] ?? '';
    }
    if (plan.format === 'yaml') delete expected._checkbox;
    return expected;
}
export async function applyPropertyPoolTask(plan: PropertyPoolTaskPlan, direction: 'drop' | 'undo' | 'redo', allowed: () => boolean, port: PropertyPoolMutationPort): Promise<PropertyPoolTaskResult> {
	if (plan.reason) {
		if (plan.group && plan.reason === 'already-present') {
			const task = port.read(plan.id);
			const current = () => { const fresh = port.read(plan.id); return allowed() && fresh?.primary.filePath === plan.path && fresh.primary.format === plan.format && port.signature(plan.favorite) === plan.signature; };
			try { return { status: task && current() && await port.matches(plan.id, propertyPoolExpectedFields(plan, task, direction)) && current() ? 'unchanged' : 'conflict' }; } catch { return { status: 'failed' }; }
		}
		return { status: plan.reason === 'already-present' ? 'unchanged' : 'blocked' };
	}
	const next = { ...(direction === 'undo' ? plan.before : plan.after) };
	const task = port.read(plan.id);
	const current = () => {
		const fresh = port.read(plan.id);
		return allowed() && (direction !== 'drop' || !plan.dateContext || propertyPoolDateContext() === plan.dateContext) && !!fresh && fresh.primary.filePath === plan.path && fresh.primary.format === plan.format
			&& (direction === 'undo' || plan.reminderEpoch === undefined || reminderStillCurrent(plan, fresh))
			&& port.signature(plan.favorite) === plan.signature && !port.blocked(fresh, next);
	};
	if (!task || !current()) return { status: 'conflict' };
	const expected = propertyPoolExpectedFields(plan, task, direction);
	if (direction === 'drop') {
		const fresh = await port.prepare(plan.id, plan.favorite);
		if (!fresh || fresh.reason || fresh.reminderEpoch !== plan.reminderEpoch || fresh.dateContext !== plan.dateContext || propertyPoolPeriodicSnapshot(fresh) !== propertyPoolPeriodicSnapshot(plan) || fresh.mediaTarget !== plan.mediaTarget || JSON.stringify(fresh.before) !== JSON.stringify(plan.before)
			|| JSON.stringify(fresh.after) !== JSON.stringify(plan.after) || JSON.stringify(fresh.basis) !== JSON.stringify(plan.basis) || JSON.stringify(fresh.dropExpected) !== JSON.stringify(plan.dropExpected)) return { status: 'conflict' };
	}
	const writeNext = { ...next };
	if (plan.format === 'yaml') {
		// Keep the semantic checkbox in `next` for commit-time workflow checks.
		// YAML checkbox is derived from the fully guarded status/date basis, never stored directly.
		delete expected._checkbox; delete writeNext._checkbox;
	}
	let committed = false, warning = false, uncertain = false;
	try { committed = await port.write(plan.id, writeNext, expected, current); }
	catch (error) {
		console.error('Operon: property pool write settlement required', error); warning = true;
		try { committed = await port.matches(plan.id, writeNext); } catch { /* Never replay an uncertain write. */ }
		if (!committed && plan.group) {
			uncertain = true;
			try { uncertain = !await port.matches(plan.id, expected); } catch { /* Preserve position and guarded history until source can be verified. */ }
		}
	}
	if (!committed) return { status: warning ? 'failed' : 'conflict', ...(uncertain ? { uncertain: true } : {}) };
	try { warning = !await port.refresh(task) || warning; }
	catch (error) { warning = true; console.error('Operon: property pool refresh failed after commit', error); }
	return { status: 'committed', warning };
}
function reminderStillCurrent(plan: PropertyPoolTaskPlan, task: IndexedTask): boolean {
	const resolution = resolveReminderRule(plan.favorite.value, task.fieldValues);
	return resolution.status === 'resolved' && resolution.epochMs === plan.reminderEpoch && resolution.epochMs > Date.now();
}
/** Preparation has no I/O. The bridge supplies the existing workflow normalization and admission rules. */
export function preparePropertyPoolTask(settings: OperonSettings, task: IndexedTask, favorite: PropertyPoolFavorite,
	normalize: (payload: Record<string, string>) => Record<string, string> | null,
	blocked: (payload: Record<string, string>) => boolean, values: readonly PropertyPoolFavorite[] = [favorite]): PropertyPoolTaskPlan {
	const key = favorite.key === 'tags' ? '_tags' : favorite.key;
	const old = propertyPoolTaskValue(task, key);
	const input = favorite.type === 'list' && key !== 'reminderRules' ? (key === '_tags' ? task.tags : key === 'taskGallery' ? parseTaskMediaReferenceList(old) : parseListValue(old)) : old;
	const now = new Date();
	let preview = previewPropertyPoolValue(settings, favorite, input, true, now);
	const added: string[] = [];
	let invalid = values.length === 0 || values.some(value => value.key !== favorite.key || value.type !== favorite.type) || (favorite.type !== 'list' && values.length !== 1);
	if (favorite.type === 'list' && key !== 'reminderRules') {
		let after = input;
		for (const value of values) {
			const item = previewPropertyPoolValue(settings, value, after, true, now);
			if (item.reason && item.reason !== 'already-present') invalid = true;
			if (item.changed) added.push(value.label);
			after = item.after;
		}
		preview = { ...preview, after, changed: added.length > 0, reason: invalid ? 'unavailable' : added.length ? null : 'already-present' };
	}
	// The historic list grammar decodes only backslash-semicolon, not doubled backslashes.
	// Preserve literal backslashes and reject any encoding that loses an item boundary.
	const value = key === 'taskGallery' && Array.isArray(preview.after) ? serializeTaskMediaReferenceList(preview.after)
		: Array.isArray(preview.after) ? preview.after.map(item => Array.from(item, character => character === ';' ? '\\;' : character).join('')).join('; ') : preview.after;
	if (key !== 'taskGallery' && Array.isArray(preview.after)) {
		const items = preview.after, decoded = parseListValue(value);
		if (decoded.length !== items.length || decoded.some((item, index) => item !== items[index])) invalid = true;
	}
	let reminderReason: PropertyPoolBlock | null = null;
	let reminderEpoch: number | undefined;
	let reminderTime: string | undefined;
	if (key === 'reminderRules') {
		const resolution = resolveReminderRule(favorite.value, task.fieldValues);
		if (resolution.status !== 'resolved') reminderReason = resolution.status === 'missing-anchor' ? 'reminder-missing' : 'reminder-invalid';
		else {
			reminderEpoch = resolution.epochMs; reminderTime = resolution.localDatetime;
			const candidate = buildReminderRuleCandidates(resolution.rule.offset.canonical, { fieldValues: task.fieldValues, reminderRules: old.split(';'), reminderDatetimes: (task.fieldValues.reminderDatetimes ?? '').split(';'), nowEpochMs: now.getTime() }).candidates.find(item => item.canonicalRule === resolution.rule.canonical);
			reminderReason = !candidate ? 'reminder-duplicate' : candidate.isPast ? 'reminder-past' : null;
		}
	}
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
	const basisKeys = [...(key === 'reminderRules' ? [...REMINDER_RULE_ANCHORS, 'reminderDatetimes', 'status', '_checkbox'] : []), ...(affectsSchedule ? scheduleKeys : []), ...(favorite.type === 'date' ? ['status', '_checkbox', 'dateCompleted', 'dateCancelled'] : [])];
	const basis = basisKeys.length ? Object.fromEntries(basisKeys.map(field => [field, propertyPoolTaskValue(task, field)])) : undefined;
	const display = (field: string, value: string) => field === 'estimate' && Number(value) > 0 ? formatDurationHuman(Number(value)) : value || '—';
	const label = favorite.type === 'list' ? (key === 'reminderRules' ? `+${favorite.label}` : added.map(value => `+${value}`).join('; ')) : `${display(key, old)} → ${favorite.type === 'date' ? value : favorite.label}`;
	const effects = affectsSchedule || favorite.type === 'date' || key === 'status' ? Object.entries(after).filter(([field]) => field !== key).map(([field, value]) => `${settings.keyMappings.find(mapping => mapping.canonicalKey === field)?.visiblePropertyName || field}: ${display(field, before[field])} → ${display(field, value)}`) : [];
	return { id: task.operonId, path: task.primary.filePath, format: task.primary.format, favorite: { ...favorite },
		signature: propertyPoolTaskSignature(settings, favorite), ...(favorite.type === 'date' ? { dateContext: propertyPoolDateContext(now) } : {}), basis, dropExpected, before, after, ...(reminderEpoch === undefined ? {} : { reminderEpoch }),
		label: [label, ...(reminderTime ? [reminderTime] : []), ...effects].join(' · '),
		reason: invalid ? 'unavailable' : reminderReason ?? preview.reason ?? (favorite.type === 'list' && key !== 'taskGallery' && key !== 'reminderRules' && ((task.primary.format === 'yaml' || key === '_tags' || key === 'links') && values.some(value => value.value.includes(';')) || /\\$/.test(old) || values.some(value => /\\$/.test(value.value))) ? 'unavailable'
			: !payload || blocked(payload) ? 'workflow' : Object.keys(after).length ? null : 'already-present') };
}
