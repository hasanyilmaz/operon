import type { App } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import { kanbanAxisValueKey, normalizeKanbanAxisValue, type KanbanAxisValue } from '../../core/kanban-axis-model';
import type { createKanbanPropertyAccess, KanbanPropertyDescriptor } from '../../core/kanban-axis-properties';
import { parseListValue } from '../../core/parser';
import { readYamlFields } from '../../core/yaml-fields';
import { getVaultPropertyValueCandidates } from '../custom-field-surfaces';
import { normalizeTagValue } from '../field-pickers/tag-picker';

/** Available values are global; counts are unique task counts from the scoped single-axis snapshot. */
export function collectKanbanAxisValueChoices(options: {
	app: App; tasks: readonly IndexedTask[]; field: KanbanPropertyDescriptor;
	access: ReturnType<typeof createKanbanPropertyAccess>; settings: OperonSettings;
	counts: ReadonlyMap<string, number>; label: (value: KanbanAxisValue) => string;
}): { value: KanbanAxisValue; label: string; count: number }[] {
	const { field, access, settings, counts, label, app } = options;
	const values = new Map<string, KanbanAxisValue>();
	const remember = (candidate: KanbanAxisValue) => {
		const value = normalizeKanbanAxisValue(candidate, field.reference);
		if (value) values.set(kanbanAxisValueKey(value), value);
	};
	remember({ kind: 'empty' });
	const key = field.reference.source === 'managed' ? field.reference.key : null;
	if (key === 'priority') for (const priority of settings.priorities) remember({ kind: 'priority', id: priority.id });
	else if (field.reference.type === 'checkbox') {
		remember({ kind: 'value', value: false }); remember({ kind: 'value', value: true });
	} else {
		for (const task of options.tasks) {
			const read = access.read(task, field.reference);
			if (read.state === 'ready' || read.state === 'empty') for (const value of read.values) remember(value);
		}
		if (key !== 'description') for (const raw of getVaultPropertyValueCandidates(app, field.aliases)) {
			// Match the editor/task reader's legacy scalar and list projection. Native lists remain typed.
			const projected = field.encoding === 'legacy' && key !== 'tags'
				? readYamlFields({ [field.label]: raw }, settings.keyMappings)[field.reference.key] : raw;
			const members = field.reference.type === 'list' && Array.isArray(projected) ? projected : [projected];
			const candidates = field.reference.type === 'list' && field.encoding === 'legacy'
				? members.flatMap(value => value === undefined ? [] : parseListValue(String(value))) : members;
			for (const candidate of candidates) {
				const value = key === 'tags' && typeof candidate === 'string' ? normalizeTagValue(candidate) : candidate;
				if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') remember({ kind: 'value', value });
			}
		}
		if (key === 'tags') {
			const tags = (app.metadataCache as unknown as { getTags?: () => Record<string, number> }).getTags?.() ?? {};
			for (const raw of Object.keys(tags)) { const value = normalizeTagValue(raw); if (value) remember({ kind: 'value', value }); }
		}
	}
	return [...values.values()].map(value => ({ value, label: label(value), count: counts.get(kanbanAxisValueKey(value)) ?? 0 }))
		.sort((a, b) => {
			if (a.count !== b.count) return b.count - a.count;
			if (field.reference.type === 'number' && a.value.kind === 'value' && b.value.kind === 'value') return Number(a.value.value) - Number(b.value.value);
			return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || kanbanAxisValueKey(a.value).localeCompare(kanbanAxisValueKey(b.value));
		});
}
