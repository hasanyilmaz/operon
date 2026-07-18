import { FILE_PROPERTY_UNSUPPORTED_GROUP_KEY } from '../core/filter-evaluator';
import { t } from '../core/i18n';

export function getFilterGroupDisplayLabel(key: string, label: string): string {
	if (key === FILE_PROPERTY_UNSUPPORTED_GROUP_KEY) {
		return t('filterSets', 'filePropertyUnsupportedValue');
	}
	return label || t('filterSets', 'groupEmpty');
}
