import { REMINDER_RULE_ANCHORS, REMINDER_RULE_QUICK_OFFSETS, canonicalizeReminderRuleList, parseReminderRule } from '../core/reminder-rules';
import { formatReminderDisplayItem } from './reminder-display';
import { getCurrentLang, t } from '../core/i18n';
import { propertyPoolDateViewContext, propertyPoolDatePresets, matchesPropertyPoolDateSearch } from '../core/property-pool-dates';
import { getTaskMediaReferenceAlias, parseTaskMediaReferenceList, resolveTaskMediaReference } from '../core/task-media-reference';
import { collectMappedLinkCandidates, rankLinkCandidates } from './field-pickers/links-picker';
import { parseExternalLinkValue } from './field-pickers/links-utils';
import { formatDurationHuman } from '../systems/tracker-utils';
import { getIcon, type App } from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { normalizeColorPaletteHex, resolveColorPalette } from '../core/color-palette';
import { collectManagedTaskDataFieldValueCandidates, getManagedTaskDataFieldPicker } from './task-data-field-picker';
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
	private dateContext = propertyPoolDateViewContext();
	private reminderLanguage = getCurrentLang();
	refreshDates(): boolean {
		const context = propertyPoolDateViewContext();
		const language = getCurrentLang();
		if (context === this.dateContext && language === this.reminderLanguage) return false;
		if (language !== this.reminderLanguage) {
			const reminders = this.cache.get('reminderRules');
			if (reminders) this.cache.set('reminderRules', reminders.map(value => this.reminderValue(value.value)));
			this.reminderLanguage = language;
		}
		this.dateContext = context;
		for (const [key, values] of this.cache) if (values[0]?.type === 'date') this.cache.delete(key);
		this.combinedEmpty = null;
		return true;
	}
	private readonly emptyRankers = new Map<string, (values: readonly PropertyPoolValue[]) => PropertyPoolValue[]>();
	private readonly mediaSources = new Map<string, Set<string>>();
	private combinedEmpty: PropertyPoolValue[] | null = null;
	private readonly cache = new Map<string, PropertyPoolValue[]>();
	private readonly settingsKey: string;
	constructor(private app: App, private settings: OperonSettings, private tasks: IndexedTask[]) { this.settingsKey = this.sourceSettingsKey(settings); }
	private sourceSettingsKey(settings: OperonSettings): string {
		return JSON.stringify([settings.colorPalette, settings.keyMappings, settings.priorities, settings.pipelines, settings.locationPlaceIconPropertyName, settings.locationPlaceColorPropertyName]);
	}
	matchesSettings(settings: OperonSettings): boolean { return this.settingsKey === this.sourceSettingsKey(settings); }
	clear(): void { this.cache.clear(); this.mediaSources.clear(); this.emptyRankers.clear(); this.combinedEmpty = null; }
	allValues(query = ''): PropertyPoolValue[] {
		this.refreshDates();
		if (!query.trim()) return this.combinedEmpty ??= propertyPoolFields(this.settings).flatMap(field => this.values(field.key));
		return propertyPoolFields(this.settings).flatMap(field => this.values(field.key, query));
	}
	dateValues(query = ''): PropertyPoolValue[] {
		return propertyPoolFields(this.settings).filter(field => field.type === 'date').flatMap(field => this.values(field.key, query));
	}
	resolveFavorite(favorite: PropertyPoolFavorite): PropertyPoolValue | null {
		const resolved = resolvePropertyPoolFavorite(this.settings, favorite);
		if (!resolved) return null;
		return this.values(favorite.key).find(value => propertyPoolFavoriteId(value) === propertyPoolFavoriteId(resolved)) ?? null;
	}
	/** Resolve the unchanged raw reference in every source and, optionally, its destination. */
	mediaTarget(favorite: PropertyPoolFavorite, destination?: string): string | null {
		const reference = resolveTaskMediaReference(favorite.value);
		if (!reference.isOpenable || !reference.target) return null;
		if (reference.kind === 'http-url') return reference.target;
		const sources = this.mediaSources.get(propertyPoolFavoriteId(favorite));
		if (!sources?.size) return null;
		const targets = new Set<string>();
		for (const source of [...sources, ...(destination === undefined ? [] : [destination])]) {
			const file = this.app.metadataCache.getFirstLinkpathDest(reference.target, source);
			if (!file || this.app.vault.getAbstractFileByPath(file.path) !== file) return null;
			targets.add(file.path);
		}
		return targets.size === 1 ? [...targets][0] : null;
	}
	private reminderValue(value: string): PropertyPoolValue {
		const label = formatReminderDisplayItem({ settings: this.settings, fieldKey: 'reminderRules', rawValue: value, fieldValues: {} }).text;
		const rule = parseReminderRule(value);
		return { key: 'reminderRules', type: 'list', value, label, searchText: `${label} ${value} ${rule.ok && rule.value.offset.canonical === '0m' ? t('reminders', 'quickOffsetOnTime') + ' On time' : ''}` };
	}
	values(key: string, query = ''): PropertyPoolValue[] {
		this.refreshDates();
		const field = propertyPoolFields(this.settings).find(item => item.key === key);
		if (!field) return [];
		let values = this.cache.get(key);
		if (!values) {
			const row = (value: string, label = value, extra: Partial<PropertyPoolValue> = {}): PropertyPoolValue => ({ key, type: field.type, value, label, searchText: `${label} ${value}`, ...extra });
			if (field.type === 'date') values = propertyPoolDatePresets(key).map(item => row(item.rule, `${field.label} · ${item.primaryLabel}`, { resolvedDate: item.isoDate, searchText: `${field.key} ${field.label} ${item.searchText}` }));
			else if (key === 'reminderRules') {
				const rules = [...REMINDER_RULE_ANCHORS.flatMap(anchor => REMINDER_RULE_QUICK_OFFSETS.map(offset => `${anchor}.${offset}`)), ...this.tasks.flatMap(task => canonicalizeReminderRuleList((task.fieldValues.reminderRules ?? '').split(';')).canonicalRules)];
				values = [...new Set(rules)].map(value => this.reminderValue(value));
			}
			else if (key === 'priority') values = this.settings.priorities.map(item => row(item.label, item.label, { priorityId: item.id }));
			else if (key === 'status') values = this.settings.pipelines.flatMap(pipeline => pipeline.statuses.map(status => row(composeStatusValue(pipeline.name, status.label), `${pipeline.name}.${status.label}`, { pipelineId: pipeline.id, statusId: status.id })));
			else if (key === 'tags') values = collectTagCandidates(this.app, []).map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'contexts') values = collectMappedContextCandidates(this.app, this.tasks, this.settings.keyMappings).map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'assignees') values = collectMappedAssigneeCandidates(this.app, this.tasks, this.settings.keyMappings, 'assignees').map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'location') values = getLocationPlaceIndex(this.app, this.settings).getSources().map(item => row(item.coordinate.canonical, item.basename, { searchText: `${item.basename} ${item.path} ${item.coordinate.canonical}` }));
			else if (key === 'estimate') {
				values = this.tasks.flatMap(task => {
					const raw = task.fieldValues.estimate?.trim() ?? '';
					const seconds = Number(raw);
					return /^\d+$/.test(raw) && Number.isSafeInteger(seconds) && seconds > 0 ? [row(String(seconds), formatDurationHuman(seconds))] : [];
				});
			}
			else if (key === 'links') values = collectMappedLinkCandidates(this.app, this.tasks, this.settings.keyMappings).map(item => row(item.rawValue, item.displayValue, { searchText: item.searchText }));
			else if (key === 'taskImage' || key === 'taskGallery') {
				const picker = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
				values = picker ? collectManagedTaskDataFieldValueCandidates(this.app, this.tasks, picker, (value, path) => {
					const id = propertyPoolFavoriteId(row(value));
					const sources = this.mediaSources.get(id) ?? new Set<string>(); sources.add(path); this.mediaSources.set(id, sources);
				}).map(value => {
					const reference = resolveTaskMediaReference(value);
					return row(value, getTaskMediaReferenceAlias(value) ?? reference.target?.split('/').pop() ?? value);
				}).filter(value => this.mediaTarget(value) !== null) : [];
			}
			else if (key === 'taskType') {
				const picker = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
				values = picker ? collectManagedTaskDataFieldValueCandidates(this.app, this.tasks, picker).map(value => row(value)) : [];
			} else if (key === 'taskIcon') {
				values = [...new Set(this.tasks.map(task => task.fieldValues.taskIcon?.trim()).filter((value): value is string => !!value))].filter(value => !!getIcon(value)).sort().map(value => row(value));
			} else if (key === 'taskColor') {
				const colors = new Map<string, PropertyPoolValue>();
				for (const entry of resolveColorPalette(this.settings.colorPalette)) {
					const hex = normalizeColorPaletteHex(entry.hex);
					if (!hex) continue;
					const previous = colors.get(hex);
					if (previous) previous.searchText += ` ${entry.name}`;
					else colors.set(hex, row(hex, entry.name));
				}
				for (const task of this.tasks) {
					const hex = normalizeColorPaletteHex(task.fieldValues.taskColor);
					if (hex && !colors.has(hex)) colors.set(hex, row(hex));
				}
				values = [...colors.values()];
			}
			else {
				const mapping = getCustomFieldMapping(this.settings.keyMappings, key);
				const candidates = mapping ? collectCustomFieldValueCandidates(this.app, this.tasks, mapping) : [];
				if (field.type === 'number') values = candidates.flatMap(value => value.trim() && Number.isFinite(Number(value)) ? [row(String(Number(value)))] : []);
				else if (field.type === 'checkbox') values = candidates.flatMap(value => /^(true|false)$/.test(value) ? [row(value)] : []);
				else values = (field.type === 'text' ? uniqueCustomTextCandidates(candidates) : candidates).map(value => row(value, field.type === 'text' ? formatCustomTextDisplayValue(value) : formatCustomListDisplayValue(value)));
			}
			const seen = new Set<string>();
			values = values.filter(value => { const id = propertyPoolFavoriteId(value); if (seen.has(id)) return false; seen.add(id); return true; });
			this.cache.set(key, values);
		}
		if (field.type === 'date' || key === 'reminderRules') {
			return values.filter(value => matchesPropertyPoolDateSearch(value.searchText, query));
		}
		if (key === 'priority' || key === 'status' || key === 'location' || key === 'taskColor') return values.filter(item => item.searchText.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
		if (key === 'links') {
			const byValue = new Map(values.map(value => [value.value, value]));
			return rankLinkCandidates(values.flatMap(value => { const parsed = parseExternalLinkValue(value.value); return parsed ? [parsed] : []; }), query).flatMap(value => byValue.get(value.rawValue) ?? []);
		}
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
			rank = createEmptyQueryRanker<PropertyPoolValue>(this.tasks, task => key === 'tags' ? task.tags.map(normalize) : (key === 'taskGallery' ? parseTaskMediaReferenceList(task.fieldValues[key]) : field.type === 'list' ? splitTaskListValue(task.fieldValues[key] ?? '') : [task.fieldValues[key] ?? '']).map(normalize), candidate => normalize(candidate.value));
			this.emptyRankers.set(key, rank);
		}
		return rank(values);
	}
}
