import { t } from '../../core/i18n';
import type { FilterFieldType } from '../../types/settings';
import type { SearchableFieldPickerOption } from '../field-pickers/searchable-field-picker';
import type { TableTaskField, TableTaskFieldGroup } from './table-field-catalog';

export interface TableFieldPickerOption extends SearchableFieldPickerOption {
	field: string;
	label: string;
	type: FilterFieldType;
	icon: string;
	group: TableTaskFieldGroup | null;
	groupLabel: string | null;
	groupOrder: number;
	tableField?: TableTaskField;
}

const TABLE_FIELD_GROUP_ORDER: TableTaskFieldGroup[] = [
	'task',
	'workflow',
	'scheduling',
	'dependencies',
	'custom',
	'source',
	'identity',
];

const TABLE_FIELD_GROUP_ORDER_INDEX = new Map<TableTaskFieldGroup, number>(
	TABLE_FIELD_GROUP_ORDER.map((group, index) => [group, index]),
);

export function buildTableFieldPickerOptions(
	catalog: readonly TableTaskField[],
	options: {
		excludedFieldKeys?: ReadonlySet<string>;
		noneLabel?: string;
	} = {},
): TableFieldPickerOption[] {
	const excludedFieldKeys = options.excludedFieldKeys ?? new Set<string>();
	const pickerOptions = catalog
		.filter(field => !excludedFieldKeys.has(field.key))
		.map(field => ({
			field: field.key,
			label: field.label,
			type: field.type,
			icon: field.icon,
			group: field.group,
			groupLabel: getTableFieldGroupLabel(field.group),
			groupOrder: getTableFieldGroupOrder(field.group),
			tableField: field,
		}))
		.sort(compareTableFieldPickerOptions);

	if (options.noneLabel) {
		return [{
			field: '',
			label: options.noneLabel,
			type: 'text',
			icon: 'minus',
			group: null,
			groupLabel: null,
			groupOrder: -1,
		}, ...pickerOptions];
	}

	return pickerOptions;
}

export function getTableFieldPickerLabel(
	catalog: readonly TableTaskField[],
	key: string | null | undefined,
	fallback: string,
): string {
	if (!key) return fallback;
	return catalog.find(field => field.key === key)?.label ?? key;
}

function compareTableFieldPickerOptions(left: TableFieldPickerOption, right: TableFieldPickerOption): number {
	if (left.groupOrder !== right.groupOrder) return left.groupOrder - right.groupOrder;
	const labelCompare = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
	if (labelCompare !== 0) return labelCompare;
	return left.field.localeCompare(right.field, undefined, { sensitivity: 'base' });
}

function getTableFieldGroupOrder(group: TableTaskFieldGroup): number {
	return TABLE_FIELD_GROUP_ORDER_INDEX.get(group) ?? Number.MAX_SAFE_INTEGER;
}

function getTableFieldGroupLabel(group: TableTaskFieldGroup): string {
	return t('table', `fieldGroup${capitalizeTableFieldGroup(group)}`);
}

function capitalizeTableFieldGroup(group: TableTaskFieldGroup): string {
	return group.charAt(0).toUpperCase() + group.slice(1);
}
