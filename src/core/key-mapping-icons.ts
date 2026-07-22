import { KeyMapping } from '../types/settings';
import { normalizeTaskIconValue } from './task-icon-value';

export function getConfiguredKeyMappingIcon(
	canonicalKey: string,
	keyMappings: readonly KeyMapping[],
): string {
	return normalizeTaskIconValue(
		keyMappings.find(mapping => mapping.canonicalKey === canonicalKey)?.icon,
	);
}
