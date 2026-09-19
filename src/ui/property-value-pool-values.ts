import type { App } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { composeStatusValue } from '../core/workflow-status-value';
import { getLocationPlaceIndex } from '../core/location-source-resolver';
import { splitTaskListValue } from '../core/task-field-patch';
import { propertyPoolFields, propertyPoolFavoriteId, resolvePropertyPoolFavorite, type PropertyPoolFavorite, type PropertyPoolValue } from '../core/property-value-pool';
import { collectCustomFieldValueCandidates, getCustomFieldMapping } from './custom-field-surfaces';
import { collectMappedContextCandidates, rankContextCandidates, formatContextDisplay } from './field-pickers/contexts-picker';
import { collectMappedAssigneeCandidates, rankAssigneeCandidates, formatAssigneeDisplay } from './field-pickers/assignees-picker';
import { collectTagCandidates, rankTagCandidates, normalizeTagValue } from './field-pickers/tag-picker';
import { formatCustomTextDisplayValue, uniqueCustomTextCandidates } from './field-pickers/custom/custom-text-field-picker';
import { formatCustomListDisplayValue } from './field-pickers/custom/custom-list-field-picker';
import { createEmptyQueryRanker } from './field-pickers/empty-query-ranking';

/** One snapshot per search session; recreate on index/metadata/taxonomy invalidation. No listeners or writes. */
export class PropertyPoolValueSession {
	private readonly emptyRankers = new Map<string, (values: readonly PropertyPoolValue[]) => PropertyPoolValue[]>();
	private combinedEmpty: PropertyPoolValue[] | null = null;
	private readonly cache = new Map<string, PropertyPoolValue[]>();
	private readonly settingsKey: string;
	constructor(private app: App, private settings: OperonSettings, private tasks: IndexedTask[]) { this.settingsKey = this.sourceSettingsKey(settings); }
	private sourceSettingsKey(settings: OperonSettings): string {
		return JSON.stringify([settings.keyMappings, settings.priorities, settings.pipelines, settings.locationPlaceIconPropertyName, settings.locationPlaceColorPropertyName]);
	}
	matchesSettings(settings: OperonSettings): boolean { return this.settingsKey === this.sourceSettingsKey(settings); }
	clear(): void { this.cache.clear(); this.emptyRankers.clear(); this.combinedEmpty = null; }
	allValues(query = ''): PropertyPoolValue[] {
		if (!query.trim()) return this.combinedEmpty ??= propertyPoolFields(this.settings).flatMap(field => this.values(field.key));
		return propertyPoolFields(this.settings).flatMap(field => this.values(field.key, query));
	}
	resolveFavorite(favorite: PropertyPoolFavorite): PropertyPoolFavorite | null {
		const resolved = resolvePropertyPoolFavorite(this.settings, favorite);
		if (!resolved) return null;
		return this.values(favorite.key).find(value => propertyPoolFavoriteId(value) === propertyPoolFavoriteId(resolved)) ?? null;
	}
	values(key: string, query = ''): PropertyPoolValue[] {
		const field = propertyPoolFields(this.settings).find(item => item.key === key);
		if (!field) return [];
		let values = this.cache.get(key);
		if (!values) {
			const row = (value: string, label = value, extra: Partial<PropertyPoolValue> = {}): PropertyPoolValue => ({ key, type: field.type, value, label, searchText: `${label} ${value}`, ...extra });
			if (key === 'priority') values = this.settings.priorities.map(item => row(item.label, item.label, { priorityId: item.id }));
			else if (key === 'status') values = this.settings.pipelines.flatMap(pipeline => pipeline.statuses.map(status => row(composeStatusValue(pipeline.name, status.label), `${pipeline.name}.${status.label}`, { pipelineId: pipeline.id, statusId: status.id })));
			else if (key === 'tags') values = collectTagCandidates(this.app, []).map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'contexts') values = collectMappedContextCandidates(this.app, this.tasks, this.settings.keyMappings).map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'assignees') values = collectMappedAssigneeCandidates(this.app, this.tasks, this.settings.keyMappings, 'assignees').map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'location') values = getLocationPlaceIndex(this.app, this.settings).getSources().map(item => row(item.coordinate.canonical, item.basename, { searchText: `${item.basename} ${item.path} ${item.coordinate.canonical}` }));
			else {
				const mapping = getCustomFieldMapping(this.settings.keyMappings, key);
				const candidates = mapping ? collectCustomFieldValueCandidates(this.app, this.tasks, mapping) : [];
				values = (field.type === 'text' ? uniqueCustomTextCandidates(candidates) : candidates).map(value => row(value, field.type === 'text' ? formatCustomTextDisplayValue(value) : formatCustomListDisplayValue(value)));
			}
			const seen = new Set<string>();
			values = values.filter(value => { const id = propertyPoolFavoriteId(value); if (seen.has(id)) return false; seen.add(id); return true; });
			this.cache.set(key, values);
		}
		if (key === 'priority' || key === 'status' || key === 'location') return values.filter(item => item.searchText.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
		if (query.trim() && (key === 'tags' || key === 'contexts' || key === 'assignees')) {
			const candidates = values.map(item => ({ rawValue: item.value, displayValue: item.label, searchText: item.searchText }));
			const ranked = key === 'tags' ? rankTagCandidates(candidates, query) : key === 'contexts' ? rankContextCandidates(candidates, query) : rankAssigneeCandidates(candidates, query);
			const byValue = new Map(values.map(value => [value.value, value]));
			return ranked.flatMap(item => { const value = byValue.get(item.rawValue); return value ? [value] : []; });
		}
		if (query.trim()) return values.filter(item => item.searchText.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
		let rank = this.emptyRankers.get(key);
		if (!rank) {
			const normalize = (value: string) => key === 'tags' ? normalizeTagValue(value)
				: key === 'contexts' ? formatContextDisplay(value).toLowerCase()
					: key === 'assignees' ? formatAssigneeDisplay(value).toLowerCase()
						: field.type === 'list' ? value.trim() : value.trim().toLocaleLowerCase();
			rank = createEmptyQueryRanker<PropertyPoolValue>(this.tasks, task => key === 'tags' ? task.tags.map(normalize) : (field.type === 'list' ? splitTaskListValue(task.fieldValues[key] ?? '') : [task.fieldValues[key] ?? '']).map(normalize), candidate => normalize(candidate.value));
			this.emptyRankers.set(key, rank);
		}
		return rank(values);
	}
}
