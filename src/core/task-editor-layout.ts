import type { KeyMapping } from '../types/settings';
import { getPropertyMappingAliases } from './property-icons';
import { vaultPropertyIconKey } from './task-icon-value';
import {
	defaultTaskEditorProperties, isTaskEditorPropertySection, isTaskEditorSectionRemovable,
	normalizeTaskEditorSections, TASK_EDITOR_COMMAND_IDS, taskEditorPropertyIdentity,
	type TaskEditorCommandId, type TaskEditorPropertyRef, type TaskEditorSection, type TaskEditorSectionId,
} from '../types/task-editor-sections';

const mapped = (key: string): TaskEditorPropertyRef => ({ kind: 'mapped', key });

export function createTaskEditorPropertyResolver(mappings: readonly KeyMapping[]) {
	const aliases = getPropertyMappingAliases(mappings);
	return (name: string): TaskEditorPropertyRef => {
		const mapping = aliases.get(vaultPropertyIconKey(name));
		return mapping ? mapped(mapping.canonicalKey) : { kind: 'vault', name };
	};
}

const additional = { section: 'additional', rank: Infinity } as const;
const notes = { section: 'notes', rank: 0 } as const;

export function resolveTaskEditorLayout(input: unknown, mappings: readonly KeyMapping[]) {
	const sections = normalizeTaskEditorSections(input).filter(section => !section.removed);
	const groups = sections.filter(section => isTaskEditorPropertySection(section.id));
	const referenceForName = createTaskEditorPropertyResolver(mappings);
	const identify = (field: TaskEditorPropertyRef) => taskEditorPropertyIdentity(field.kind === 'vault' ? referenceForName(field.name) : field);
	const assignments = new Map<string, { section: TaskEditorSectionId; rank: number }>();
	const fields = new Map<TaskEditorSectionId, TaskEditorPropertyRef[]>();
	// Explicit assignments own their field before an implicit default can claim it.
	for (const group of [...groups.filter(group => group.properties), ...groups.filter(group => !group.properties)]) {
		const ordered: TaskEditorPropertyRef[] = [];
		for (const field of group.properties ?? defaultTaskEditorProperties(group.id)) {
			const identity = identify(field);
			if (identity === taskEditorPropertyIdentity(mapped('note')) || assignments.has(identity)) continue;
			assignments.set(identity, { section: group.id, rank: ordered.length });
			ordered.push(field);
		}
		fields.set(group.id, ordered);
	}
	const assignment = (ref: TaskEditorPropertyRef) => assignments.get(identify(ref));
	const position = (ref: TaskEditorPropertyRef) => identify(ref) === taskEditorPropertyIdentity(mapped('note'))
		? notes : assignment(ref) ?? additional;
	return {
		sections, groups, fields, identify, position, assignment, referenceForName,
		commandOrder: sections.find(section => section.id === 'commands')?.commandOrder ?? TASK_EDITOR_COMMAND_IDS,
	};
}

export type TaskEditorLayout = ReturnType<typeof resolveTaskEditorLayout>;

export function moveTaskEditorLayoutItem<T>(items: readonly T[], index: number, delta: -1 | 1): readonly T[] {
	const next = index + delta;
	if (index < 0 || next < 0 || next >= items.length) return items;
	const result = [...items];
	[result[index], result[next]] = [result[next], result[index]];
	return result;
}

export type TaskEditorLayoutChange =
	| { type: 'add'; id: `custom:${string}`; name: string }
	| { type: 'rename'; id: TaskEditorSectionId; name: string }
	| { type: 'visibility'; id: TaskEditorSectionId; enabled: boolean }
	| { type: 'move-section'; id: TaskEditorSectionId; delta: -1 | 1 }
	| { type: 'remove-section'; id: TaskEditorSectionId }
	| { type: 'assign'; field: TaskEditorPropertyRef; section?: TaskEditorSectionId }
	| { type: 'move-field'; field: TaskEditorPropertyRef; section: TaskEditorSectionId; delta: -1 | 1 }
	| { type: 'move-command'; id: TaskEditorCommandId; delta: -1 | 1 };

export function changeTaskEditorLayout(current: TaskEditorSection[], mappings: readonly KeyMapping[], change: TaskEditorLayoutChange): TaskEditorSection[] {
	const layout = resolveTaskEditorLayout(current, mappings);
	if (change.type === 'add') return current.some(section => section.id === change.id) || !change.name.trim()
		? current : [...current, { id: change.id, name: change.name, properties: [] }];
	if (change.type === 'move-section') {
		const from = layout.sections.findIndex(section => section.id === change.id);
		const order = moveTaskEditorLayoutItem(layout.sections, from, change.delta);
		if (order === layout.sections) return current;
		let cursor = 0;
		return current.map(section => section.removed ? section : order[cursor++]);
	}
	if (change.type === 'remove-section') {
		const section = layout.sections.find(item => item.id === change.id);
		if (!section || !isTaskEditorSectionRemovable(section.id)) return current;
		const returning = new Set(layout.fields.get(section.id)?.map(layout.identify));
		return current.flatMap(item => {
			if (item.id === section.id) return item.id.startsWith('custom:') ? [] : [{ id: item.id, name: '', removed: true }];
			if (item.removed || !isTaskEditorPropertySection(item.id)) return [item];
			const before = item.properties ?? defaultTaskEditorProperties(item.id);
			const properties = before.filter(field => !returning.has(layout.identify(field)));
			return [properties.length === before.length ? item : { ...item, properties }];
		});
	}
	if (change.type === 'assign') {
		if (change.section && !layout.groups.some(group => group.id === change.section)) return current;
		if (layout.assignment(change.field)?.section === change.section) return current;
		const field = change.field.kind === 'vault' ? layout.referenceForName(change.field.name) : change.field;
		const identity = layout.identify(field);
		if (identity === taskEditorPropertyIdentity(mapped('note'))) return current;
		return current.map(section => {
			if (section.removed || !isTaskEditorPropertySection(section.id)) return section;
			const before = section.properties ?? defaultTaskEditorProperties(section.id);
			const after = before.filter(item => layout.identify(item) !== identity);
			if (section.id === change.section) after.push(field);
			else if (after.length === before.length) return section;
			return { ...section, properties: after };
		});
	}
	if (change.type === 'move-field') {
		const list = layout.fields.get(change.section);
		if (!list) return current;
		const identity = layout.identify(change.field);
		const properties = moveTaskEditorLayoutItem(list, list.findIndex(item => layout.identify(item) === identity), change.delta);
		return properties === list ? current
			: current.map(section => section.id === change.section ? { ...section, properties: [...properties] } : section);
	}
	if (change.type === 'move-command') {
		const order = moveTaskEditorLayoutItem(layout.commandOrder, layout.commandOrder.indexOf(change.id), change.delta);
		return order === layout.commandOrder ? current
			: current.map(section => section.id === 'commands' ? { ...section, commandOrder: [...order] } : section);
	}
	return current.map(section => {
		if (section.id !== change.id || section.removed) return section;
		if (change.type === 'visibility') return section.id === 'description' ? section : { ...section, enabled: change.enabled };
		return section.id.startsWith('custom:') && !change.name.trim() ? section : { ...section, name: change.name };
	});
}
