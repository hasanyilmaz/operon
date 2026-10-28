import { kanbanAxisValueKey, projectKanbanLegacyAxes, resolveKanbanAxes, type KanbanAxis, type KanbanAxisValue } from '../core/kanban-axis-model';
import type { createKanbanPropertyAccess } from '../core/kanban-axis-properties';
import { normalizeKanbanLeafState, buildKanbanStatusCollapseScopeKey, buildKanbanLaneCollapseScopeKey, type KanbanLeafState, type KanbanPreset } from '../types/kanban';
import { KANBAN_NO_VALUE_KEY } from './kanban-query';
import type { OperonSettings } from '../types/settings';
import { resolveLegacyKanbanCellTarget, type KanbanCellTarget } from './kanban-cell-actions';
import { buildKanbanGroupingCellKey } from './kanban-grouping';

type Settings = Pick<OperonSettings, 'keyMappings' | 'priorities' | 'pipelines' | 'inlinePropertyDefinitions'>;
type Access = Pick<ReturnType<typeof createKanbanPropertyAccess>, 'resolve'>;

export function kanbanAxisGroupKey(axis: KanbanAxis | null, value: KanbanAxisValue | null, access: Access): string | null {
	if (!axis) return value === null ? JSON.stringify(['hidden-row']) : null;
	if (!value) return null;
	if (axis.kind === 'status') return JSON.stringify([JSON.stringify(['status', axis.pipelineId]), kanbanAxisValueKey(value)]);
	const field = access.resolve(axis.property);
	return field.ok ? JSON.stringify([field.field.identity, kanbanAxisValueKey(value)]) : null;
}

export function kanbanTargetCellKey(preset: KanbanPreset, target: KanbanCellTarget, settings: Settings, access: Access): string | null {
	const decoded = resolveKanbanAxes(preset, settings.keyMappings);
	if (!decoded.ok) return null;
	const column = kanbanAxisGroupKey(decoded.axes.columns, target.columns, access);
	const row = kanbanAxisGroupKey(decoded.axes.swimlanes, target.swimlanes, access);
	return column && row ? buildKanbanGroupingCellKey(column, row) : null;
}

/** Read compatibility only. No settings or order writes occur during rendering. */
export function resolveKanbanOrderAliases(preset: KanbanPreset, order: Record<string, string[]>, settings: Settings, access: Access): Record<string, string[]> {
	const result: Record<string, string[]> = Object.fromEntries(Object.entries(order).map(([key, ids]) => [key, [...ids]]));
	if (!projectKanbanLegacyAxes(preset, settings.keyMappings).ok) return result;
	for (const [key, ids] of Object.entries(order)) {
		if (key.startsWith('[')) continue;
		const separator = key.indexOf('::');
		if (separator < 0) continue;
		const resolved = resolveLegacyKanbanCellTarget(preset, key.slice(0, separator), key.slice(separator + 2), settings);
		if (!resolved) continue;
		const typed = kanbanTargetCellKey(preset, resolved.target, settings, access);
		if (typed && !(typed in result)) result[typed] = [...ids];
	}
	return result;
}

/** Bind old records to their original axes before an explicit preset edit changes them. */
export function preserveKanbanOrderForAxisEdit(preset: KanbanPreset, order: Record<string, string[]>, settings: Settings, access: Access): Record<string, string[]> {
	const aliases = resolveKanbanOrderAliases(preset, order, settings, access);
	const result: Record<string, string[]> = {};
	const scope = resolveKanbanAxes(preset, settings.keyMappings);
	for (const [key, ids] of Object.entries(aliases)) {
		// Uninterpretable legacy records remain recoverable but cannot leak into another field.
		result[key.startsWith('[') ? key : JSON.stringify(['legacy-order', scope.ok ? scope.axes : preset.id, key])] = [...ids];
	}
	return result;
}

export function kanbanAxisScope(preset: KanbanPreset, side: 'columns' | 'swimlanes', settings: Settings, access: Access): string {
	const result = resolveKanbanAxes(preset, settings.keyMappings);
	if (!result.ok) return JSON.stringify([preset.id, side, 'unavailable']);
	const axis = result.axes[side];
	const field = axis?.kind === 'property' ? access.resolve(axis.property) : null;
	return JSON.stringify([preset.id, side, field?.ok ? [field.field.identity, field.field.reference.type] : axis?.kind === 'property' ? axis.property : axis]);
}

/** Adapt visited collapse records only; reading a board never enumerates possible cells. */
export function normalizeKanbanAxisLeafState(raw: Partial<KanbanLeafState> | null | undefined, settings: OperonSettings, access: Access): KanbanLeafState {
	const preset = settings.kanbanPresets.find(p => p.id === raw?.presetId)
		?? settings.kanbanPresets.find(p => p.id === settings.kanbanDefaultPresetId) ?? settings.kanbanPresets[0];
	if (!preset) return normalizeKanbanLeafState(raw, { availablePresetIds: [], availableStatusIds: [], defaultPresetId: null });
	const state = { ...raw, collapsedStatusIdsByScope: { ...raw?.collapsedStatusIdsByScope }, collapsedLaneKeysByScope: { ...raw?.collapsedLaneKeysByScope } };
	const columnScope = kanbanAxisScope(preset, 'columns', settings, access), rowScope = kanbanAxisScope(preset, 'swimlanes', settings, access);
	const legacy = projectKanbanLegacyAxes(preset, settings.keyMappings);
	for (const side of ['columns', 'swimlanes'] as const) {
		const map = side === 'columns' ? state.collapsedStatusIdsByScope : state.collapsedLaneKeysByScope;
		const scope = side === 'columns' ? columnScope : rowScope;
		if (Object.prototype.hasOwnProperty.call(map, scope)) continue;
		const hasPriorScope = Object.keys(map).some(key => {
			if (key.startsWith(`${preset.id}::`)) return true;
			try { const parsed: unknown = JSON.parse(key); return Array.isArray(parsed) && parsed[0] === preset.id && parsed[1] === side; } catch { return false; }
		});
		map[scope] = [];
		if (!legacy.ok) continue;
		const oldScope = side === 'columns' ? buildKanbanStatusCollapseScopeKey(preset.id, legacy.pipelineId) : buildKanbanLaneCollapseScopeKey(preset.id, legacy.pipelineId, legacy.swimlaneBy);
		const old = oldScope && map[oldScope] || (!hasPriorScope && ((side === 'columns' ? raw?.collapsedStatusIdsByPreset?.[preset.id] : raw?.collapsedLaneKeysByPreset?.[preset.id])
			|| (raw?.presetId === preset.id ? side === 'columns' ? raw.collapsedStatusIds : raw.collapsedLaneKeys : [])));
		for (const id of Array.isArray(old) ? old.filter((value): value is string => typeof value === 'string') : []) {
			const target = resolveLegacyKanbanCellTarget(preset, side === 'columns' ? id : '', side === 'swimlanes' ? id : KANBAN_NO_VALUE_KEY, settings);
			if (!target) continue;
			const key = kanbanAxisGroupKey(target.axes[side], target.target[side], access);
			if (key) map[scope].push(key);
		}
	}
	return normalizeKanbanLeafState(state, { availablePresetIds: settings.kanbanPresets.map(p => p.id), defaultPresetId: settings.kanbanDefaultPresetId,
		availableStatusIds: [...new Set(Object.values(state.collapsedStatusIdsByScope).flat())],
		statusCollapseScopeKey: columnScope, laneCollapseScopeKey: rowScope,
		availableStatusCollapseScopeKeys: Object.keys(state.collapsedStatusIdsByScope), availableLaneCollapseScopeKeys: Object.keys(state.collapsedLaneKeysByScope) });
}
