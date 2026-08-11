import type { RawYamlPropertyMutation } from '../../core/raw-yaml-property';

export type TableTextEditRoute = 'picker' | 'popover';

const TASK_TEXT_POPOVER_EXCLUDED_KEYS = new Set([
	'description',
	'note',
	'taskIcon',
	'taskColor',
]);
const SPECIALIZED_TASK_TEXT_FIELD_KEYS = new Set([
	'status',
	'priority',
	'taskIcon',
	'taskColor',
]);

export function isTablePlainTextField(
	field?: { key: string; type: string; unavailable?: boolean } | null,
): boolean {
	return field?.type === 'text'
		&& field.unavailable !== true
		&& !SPECIALIZED_TASK_TEXT_FIELD_KEYS.has(field.key);
}

export function resolveTableTextEditRoute(
	value: string,
	supportsDirectTextEditing: boolean,
): TableTextEditRoute {
	return supportsDirectTextEditing && value.trim().length > 0 ? 'popover' : 'picker';
}

export function resolveTableTaskTextEditRoute(
	field: { key: string; type: string; unavailable?: boolean } | null | undefined,
	value: string,
): TableTextEditRoute {
	return resolveTableTextEditRoute(
		value,
		isTablePlainTextField(field)
			&& !!field
			&& !TASK_TEXT_POPOVER_EXCLUDED_KEYS.has(field.key),
	);
}

export function buildTableFilePropertyTextMutation(value: string): RawYamlPropertyMutation {
	const normalized = value.trim();
	return normalized.length > 0
		? { kind: 'set', value: normalized }
		: { kind: 'delete' };
}
