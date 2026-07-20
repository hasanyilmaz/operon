import { CANONICAL_KEY_MAP } from '../types/keys';
import { t } from '../core/i18n';
import { KeyMapping } from '../types/settings';

export interface TaskCreatorToolbarTooltipCopy {
	title: string;
	content?: string;
}

export function getKeyMappingDescription(mapping: KeyMapping): string {
	const translationKey = `keyMappingsDesc_${mapping.canonicalKey}`;
	const translated = t('settings', translationKey);
	if (translated !== translationKey) return translated;

	const configuredDescription = mapping.description?.trim();
	if (configuredDescription) return configuredDescription;

	return CANONICAL_KEY_MAP.get(mapping.canonicalKey)?.description
		?? t('settings', 'keyMappingsCustomDescriptionFallback');
}

export function getTaskCreatorToolbarTooltipCopy(
	key: string,
	keyMappings: readonly KeyMapping[],
): TaskCreatorToolbarTooltipCopy | null {
	const mapping = keyMappings.find(candidate => candidate.canonicalKey === key);
	if (mapping?.isSystem === false) {
		return {
			title: mapping.visiblePropertyName?.trim() || mapping.canonicalKey,
			content: truncateCustomTooltipDescription(mapping.description),
		};
	}

	const titleKey = `taskCreatorToolbarTooltip_${key}`;
	const title = t('settings', titleKey);
	if (title === titleKey) return null;

	const contentKey = `taskCreatorToolbarTooltipDesc_${key}`;
	const content = t('settings', contentKey);
	return {
		title,
		content: content === contentKey ? undefined : content,
	};
}

function truncateCustomTooltipDescription(description: string | undefined): string | undefined {
	const trimmed = description?.trim();
	if (!trimmed) return undefined;

	const words = trimmed.split(/\s+/u).filter(Boolean);
	if (words.length <= 5) return trimmed;
	return `${words.slice(0, 5).join(' ')}...`;
}
