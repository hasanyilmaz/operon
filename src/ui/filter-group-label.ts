import { FILE_PROPERTY_UNSUPPORTED_GROUP_KEY } from '../core/filter-evaluator';
import { t } from '../core/i18n';
import { formatUiDate } from '../core/ui-date-format';
import type { OperonSettings } from '../types/settings';

export interface FilterGroupDateDisplay {
	dateKey: string | null;
	displayLabel: string;
}

export function getFilterGroupDisplayLabel(key: string, label: string): string {
	if (key === FILE_PROPERTY_UNSUPPORTED_GROUP_KEY) {
		return t('filterSets', 'filePropertyUnsupportedValue');
	}
	return label || t('filterSets', 'groupEmpty');
}

export function resolveFilterGroupDateDisplay(
	label: string,
	settings: Pick<OperonSettings, 'dateDisplayFormat'>,
): FilterGroupDateDisplay {
	const dateKey = /^\d{4}-\d{2}-\d{2}$/u.test(label) ? label : null;
	return {
		dateKey,
		displayLabel: dateKey ? formatUiDate(dateKey, settings) : label,
	};
}
