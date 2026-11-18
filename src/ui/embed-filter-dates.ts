import type { FilterGroup, FilterSet, FilterSetCondition } from '../types/settings';
import { decodeVaultPropertyValue } from '../core/vault-property-codec';

const EMBED_DATE_FIELDS = [
	'dateStarted',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
	'repeatOccurrenceDate',
] as const;

export type EmbedDateField = (typeof EMBED_DATE_FIELDS)[number];
export type EmbedDateOverrides = Partial<Record<EmbedDateField, string>>;

export function getEmbedDateField(key: string): EmbedDateField | undefined {
	const lowerKey = key.toLowerCase();
	return EMBED_DATE_FIELDS.find(field => field.toLowerCase() === lowerKey);
}

export function parseEmbedDate(raw: string): string | null {
	const unquoted = raw.replace(/^(["'])(.*)\1$/u, '$2');
	try {
		const date = decodeVaultPropertyValue(unquoted, 'date');
		return typeof date === 'string' ? date : null;
	} catch {
		return null;
	}
}

function omitDateConditions(group: FilterGroup, fields: ReadonlySet<string>): FilterGroup {
	const children: FilterGroup['children'] = [];
	for (const node of group.children) {
		if ('children' in node) {
			const remaining = omitDateConditions(node, fields);
			if (remaining.children.length || !node.children.length) children.push(remaining);
		} else if (!fields.has(node.field)) {
			children.push(node);
		}
	}
	return { ...group, children };
}

export function applyEmbedDateOverrides(
	filter: FilterSet,
	overrides?: Readonly<EmbedDateOverrides>,
): FilterSet {
	if (!overrides) return filter;

	const dates: FilterSetCondition[] = [];
	const overriddenFields = new Set<string>();
	for (const key of EMBED_DATE_FIELDS) {
		const date = overrides[key];
		if (!date) continue;
		const field = key === 'repeatOccurrenceDate' ? 'taskOccurrenceDate' : key;
		overriddenFields.add(key);
		overriddenFields.add(field);
		dates.push({ id: `embed-date:${key}`, field, fieldType: 'date', operator: 'dateIs', value: date });
	}
	if (!dates.length) return filter;

	const savedGroup = filter.rootGroup ?? {
		id: `derived_${filter.id}`,
		logic: filter.matchLogic,
		children: filter.conditions,
	};
	const remaining = omitDateConditions(savedGroup, overriddenFields);
	const rootGroup: FilterGroup = {
		id: `embed-dates:${filter.id}`,
		logic: 'all',
		children: remaining.children.length ? [...dates, remaining] : dates,
	};
	return {
		...filter,
		rootGroup,
		matchLogic: rootGroup.logic,
		conditions: remaining.children.length ? [] : dates,
	};
}
