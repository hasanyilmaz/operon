import type { TaskFilterQueryRequestV1 } from '../contracts/v1/context';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../contracts/v1/canonical';
import type { FilterSet } from '../../types/settings';

export function savedFilterQueryDigestV1(
	filterSet: FilterSet,
	scope: TaskFilterQueryRequestV1['scope'],
): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1(compactDefinedJsonV1({
		filterSet,
		scope: scope ?? null,
	}))));
}

function compactDefinedJsonV1(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(compactDefinedJsonV1);
	if (!value || typeof value !== 'object') return value;
	const output: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (item !== undefined) output[key] = compactDefinedJsonV1(item);
	}
	return output;
}
