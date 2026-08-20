import { TASK_STATS_CANONICAL_KEYS } from '../types/keys';
import { isRetiredKeyMapping, KeyMapping } from '../types/settings';
import { buildForwardMapping, buildReverseMapping, getManagedYamlAliases, isManagedYamlCanonicalKey } from './yaml-fields';
import { normalizeTaskIconValue } from './task-icon-value';
import { formatTaskColorYamlValue } from './task-color-value';
import { getManagedTaskFieldType } from './managed-task-fields';
import { parseTaskMediaReferenceList } from './task-media-reference';

export interface YamlFrontmatterFormattingPlan {
	blankYamlKeys: Set<string>;
	removedYamlKeys: Set<string>;
}

export interface AggregateYamlFrontmatterPatchResult {
	ok: boolean;
	content: string;
	fallbackReason: string;
}

const YAML_EMPTY_REMOVAL_KEYS = new Set(['activeTracker']);
const AGGREGATE_NUMERIC_YAML_KEYS = new Set([
	'progress',
	...TASK_STATS_CANONICAL_KEYS,
	'totalDuration',
	'totalEstimate',
]);
const AGGREGATE_YAML_FAST_PATH_KEYS = new Set([
	...AGGREGATE_NUMERIC_YAML_KEYS,
	'datetimeModified',
]);

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSimpleYamlScalar(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed === '') return '';
	if (/^[|>]/.test(trimmed)) return null;
	if (/\s+#/.test(trimmed)) return null;
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	if (trimmed.startsWith('[') || trimmed.startsWith('{')) return null;
	return trimmed;
}

function parseTopLevelYamlLine(line: string): { key: string; value: string } | null {
	if (!line.trim() || line.trimStart().startsWith('#')) return null;
	if (/^[\t ]/.test(line)) return null;
	const colonIndex = line.indexOf(':');
	if (colonIndex <= 0) return null;
	const key = line.slice(0, colonIndex).trim();
	if (!key) return null;
	return {
		key,
		value: line.slice(colonIndex + 1).trimStart(),
	};
}

function findYamlAliasLines(
	lines: string[],
	aliases: Set<string>,
): { lineIndexes: number[]; fallbackReason: string | null } {
	const lineIndexes: number[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const parsed = parseTopLevelYamlLine(line);
		if (!parsed) {
			const trimmed = line.trimStart();
			const indentedColonIndex = trimmed.indexOf(':');
			const indentedKey = indentedColonIndex > 0 ? trimmed.slice(0, indentedColonIndex).trim() : '';
			if (/^[\t ]/.test(line) && aliases.has(indentedKey)) {
				return { lineIndexes, fallbackReason: 'nested-key' };
			}
			continue;
		}
		if (!aliases.has(parsed.key)) continue;
		if (/^[|>]/.test(parsed.value.trim())) {
			return { lineIndexes, fallbackReason: 'block-scalar' };
		}
		if (parseSimpleYamlScalar(parsed.value) === null) {
			return { lineIndexes, fallbackReason: 'unsupported-scalar' };
		}
		lineIndexes.push(index);
	}
	if (lineIndexes.length > 1) {
		return { lineIndexes, fallbackReason: 'duplicate-alias' };
	}
	return { lineIndexes, fallbackReason: null };
}

function serializeAggregateYamlValue(canonicalKey: string, value: string): string | null {
	if (value === '') return '';
	if (AGGREGATE_NUMERIC_YAML_KEYS.has(canonicalKey)) {
		return /^-?\d+(\.\d+)?$/.test(value.trim()) ? value.trim() : null;
	}
	if (/[\r\n]/.test(value)) return null;
	return value.trim();
}

export function tryPatchAggregateYamlFrontmatter(
	content: string,
	operonId: string,
	payload: Record<string, string>,
	keyMappings: KeyMapping[],
): AggregateYamlFrontmatterPatchResult {
	const payloadKeys = Object.keys(payload);
	for (const key of payloadKeys) {
		if (!AGGREGATE_YAML_FAST_PATH_KEYS.has(key)) {
			return { ok: false, content, fallbackReason: 'unsupported-key' };
		}
	}

	const frontmatterMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
	if (!frontmatterMatch) {
		return { ok: false, content, fallbackReason: 'malformed-frontmatter' };
	}

	const [, openingFence, rawFrontmatter, closingFence] = frontmatterMatch;
	const newline = rawFrontmatter.includes('\r\n') ? '\r\n' : '\n';
	const lines = rawFrontmatter.length > 0 ? rawFrontmatter.split(/\r?\n/) : [];
	const forwardMap = buildForwardMapping(keyMappings);

	const operonAliases = new Set(getManagedYamlAliases('operonId', keyMappings));
	const operonMatch = findYamlAliasLines(lines, operonAliases);
	if (operonMatch.fallbackReason) {
		return { ok: false, content, fallbackReason: operonMatch.fallbackReason };
	}
	if (operonMatch.lineIndexes.length !== 1) {
		return { ok: false, content, fallbackReason: 'operonId-missing' };
	}
	const operonLine = parseTopLevelYamlLine(lines[operonMatch.lineIndexes[0]]);
	const parsedOperonId = operonLine ? parseSimpleYamlScalar(operonLine.value) : null;
	if (parsedOperonId !== operonId) {
		return { ok: false, content, fallbackReason: 'operonId-mismatch' };
	}

	const nextLines = [...lines];
	for (const [canonicalKey, value] of Object.entries(payload)) {
		const serialized = serializeAggregateYamlValue(canonicalKey, value);
		if (serialized === null) {
			return { ok: false, content, fallbackReason: 'invalid-value' };
		}
		const aliases = new Set(getManagedYamlAliases(canonicalKey, keyMappings));
		const aliasMatch = findYamlAliasLines(nextLines, aliases);
		if (aliasMatch.fallbackReason) {
			return { ok: false, content, fallbackReason: aliasMatch.fallbackReason };
		}

		const existingIndex = aliasMatch.lineIndexes[0];
		const preferredYamlKey = forwardMap.get(canonicalKey) ?? canonicalKey;
		const yamlKey = existingIndex !== undefined
			? parseTopLevelYamlLine(nextLines[existingIndex])?.key ?? preferredYamlKey
			: preferredYamlKey;
		const nextLine = serialized ? `${yamlKey}: ${serialized}` : `${yamlKey}:`;
		if (existingIndex !== undefined) {
			nextLines[existingIndex] = nextLine;
		} else if (serialized) {
			nextLines.push(nextLine);
		}
	}

	const nextFrontmatter = nextLines.join(newline);
	const patched = `${openingFence}${nextFrontmatter}${closingFence}${content.slice(frontmatterMatch[0].length)}`;
	return { ok: true, content: patched, fallbackReason: 'none' };
}

function hasYamlKey(frontmatter: Record<string, unknown>, yamlKey: string): boolean {
	return Object.prototype.hasOwnProperty.call(frontmatter, yamlKey) === true;
}

function isNumericYamlString(value: string): boolean {
	return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function hasMeaningfulYamlValue(value: unknown): boolean {
	if (value === '' || value === null || value === undefined) return false;
	if (Array.isArray(value) && value.length === 0) return false;
	return true;
}

function normalizeYamlValueForComparison(value: unknown): string | null {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
	if (Array.isArray(value)) {
		return value
			.map(item => normalizeYamlValueForComparison(item))
			.filter((item): item is string => item !== null && item !== '')
			.join('; ');
	}
	return null;
}

function yamlValuesEquivalent(left: unknown, right: unknown): boolean {
	const normalizedLeft = normalizeYamlValueForComparison(left);
	const normalizedRight = normalizeYamlValueForComparison(right);
	return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

function resolveManagedCanonicalKey(
	yamlKey: string,
	reverseMap: Map<string, string>,
	keyMappings: KeyMapping[],
): string | null {
	if (yamlKey === 'position' || yamlKey === 'tags' || yamlKey === 'title' || yamlKey.startsWith('_')) {
		return null;
	}
	if (yamlKey === 'pinned') {
		return 'pinned';
	}
	const mappedKey = reverseMap.get(yamlKey);
	if (mappedKey) {
		return isRetiredKeyMapping(mappedKey) || !isManagedYamlCanonicalKey(mappedKey, keyMappings)
			? null
			: mappedKey;
	}
	return isManagedYamlCanonicalKey(yamlKey, keyMappings) ? yamlKey : null;
}

function buildManagedFieldPayload(
	fieldValues: Record<string, string>,
	keyMappings: KeyMapping[],
): Record<string, string> {
	const payload: Record<string, string> = {};
	for (const [key, value] of Object.entries(fieldValues)) {
		if (key.startsWith('_')) continue;
		if (key === 'tags' || key === 'pinned') continue;
		if (!isManagedYamlCanonicalKey(key, keyMappings)) continue;
		payload[key] = value;
	}

	const checkbox = fieldValues['_checkbox'];
	if (checkbox === 'done') {
		payload['dateCancelled'] = '';
	} else if (checkbox === 'cancelled') {
		payload['dateCompleted'] = '';
	} else if (checkbox === 'open') {
		payload['dateCompleted'] = '';
		payload['dateCancelled'] = '';
	}

	return payload;
}

function pickExistingManagedValue(
	frontmatter: Record<string, unknown>,
	canonicalKey: string,
	aliasKeys: Iterable<string>,
	preferredYamlKey: string,
): unknown {
	if (hasYamlKey(frontmatter, preferredYamlKey) && hasMeaningfulYamlValue(frontmatter[preferredYamlKey])) {
		return frontmatter[preferredYamlKey];
	}
	if (
		preferredYamlKey !== canonicalKey
		&& hasYamlKey(frontmatter, canonicalKey)
		&& hasMeaningfulYamlValue(frontmatter[canonicalKey])
	) {
		return frontmatter[canonicalKey];
	}
	for (const yamlKey of aliasKeys) {
		if (hasYamlKey(frontmatter, yamlKey) && hasMeaningfulYamlValue(frontmatter[yamlKey])) {
			return frontmatter[yamlKey];
		}
	}
	if (hasYamlKey(frontmatter, preferredYamlKey)) {
		return frontmatter[preferredYamlKey];
	}
	if (preferredYamlKey !== canonicalKey && hasYamlKey(frontmatter, canonicalKey)) {
		return frontmatter[canonicalKey];
	}
	for (const yamlKey of aliasKeys) {
		if (hasYamlKey(frontmatter, yamlKey)) {
			return frontmatter[yamlKey];
		}
	}
	return undefined;
}

function coerceYamlStoredValue(
	canonicalKey: string,
	value: string,
	keyMappings: KeyMapping[],
	existingValue: unknown,
): unknown {
	if (canonicalKey === 'taskIcon') {
		return normalizeTaskIconValue(value);
	}
	if (canonicalKey === 'taskColor') {
		return formatTaskColorYamlValue(value);
	}
	const fieldType = getManagedTaskFieldType(canonicalKey, keyMappings);
	if (fieldType === 'list' && value) {
		return canonicalKey === 'taskGallery'
			? parseTaskMediaReferenceList(value)
			: value.split('; ').map(v => v.trim()).filter(v => v);
	}
	if (fieldType === 'number' && value) {
		return isNumericYamlString(value) ? Number(value) : value;
	}
	if (
		typeof existingValue === 'number'
		&& isNumericYamlString(value)
	) {
		return Number(value);
	}
	if (
		typeof existingValue === 'boolean'
		&& /^(true|false)$/i.test(value.trim())
	) {
		return value.trim().toLowerCase() === 'true';
	}
	return value;
}

export function applyYamlTaskFieldValues(
	frontmatter: Record<string, unknown>,
	fieldValues: Record<string, string>,
	mode: 'merge' | 'replace',
	keyMappings: KeyMapping[],
): YamlFrontmatterFormattingPlan {
	const forwardMap = buildForwardMapping(keyMappings);
	const reverseMap = buildReverseMapping(keyMappings);
	const managedPayload = buildManagedFieldPayload(fieldValues, keyMappings);
	const incomingKeys = new Set(Object.keys(managedPayload));
	const plan: YamlFrontmatterFormattingPlan = {
		blankYamlKeys: new Set<string>(),
		removedYamlKeys: new Set<string>(),
	};

	const writeBlankPlaceholder = (yamlKey: string): void => {
		plan.removedYamlKeys.delete(yamlKey);
		plan.blankYamlKeys.add(yamlKey);
		frontmatter[yamlKey] = '';
	};

	const removeYamlKey = (yamlKey: string): void => {
		plan.blankYamlKeys.delete(yamlKey);
		plan.removedYamlKeys.add(yamlKey);
		delete frontmatter[yamlKey];
	};

	const clearYamlKey = (canonicalKey: string, yamlKey: string): void => {
		if (YAML_EMPTY_REMOVAL_KEYS.has(canonicalKey)) {
			removeYamlKey(yamlKey);
			return;
		}
		writeBlankPlaceholder(yamlKey);
	};

	const clearManagedField = (
		canonicalKey: string,
		preferredYamlKey: string,
		aliasKeys: Iterable<string>,
	): void => {
		const hadExistingAlias = Array.from(aliasKeys).some(yamlKey => hasYamlKey(frontmatter, yamlKey));
		if (hadExistingAlias) {
			clearYamlKey(canonicalKey, preferredYamlKey);
		} else {
			removeYamlKey(preferredYamlKey);
		}
		for (const yamlKey of aliasKeys) {
			if (yamlKey === preferredYamlKey) continue;
			if (!hasYamlKey(frontmatter, yamlKey)) continue;
			removeYamlKey(yamlKey);
		}
	};

	const writeManagedField = (
		_canonicalKey: string,
		preferredYamlKey: string,
		aliasKeys: Iterable<string>,
		value: unknown,
	): void => {
		plan.blankYamlKeys.delete(preferredYamlKey);
		plan.removedYamlKeys.delete(preferredYamlKey);
		frontmatter[preferredYamlKey] = value;
		for (const yamlKey of aliasKeys) {
			if (yamlKey === preferredYamlKey) continue;
			if (!hasYamlKey(frontmatter, yamlKey)) continue;
			const aliasValue = frontmatter[yamlKey];
			if (!hasMeaningfulYamlValue(aliasValue) || yamlValuesEquivalent(aliasValue, value)) {
				removeYamlKey(yamlKey);
			}
		}
	};

	const existingManagedKeys = new Map<string, Set<string>>();
	for (const yamlKey of Object.keys(frontmatter)) {
		const canonicalKey = resolveManagedCanonicalKey(yamlKey, reverseMap, keyMappings);
		if (!canonicalKey || canonicalKey === 'pinned') continue;
		if (!existingManagedKeys.has(canonicalKey)) {
			existingManagedKeys.set(canonicalKey, new Set<string>());
		}
		existingManagedKeys.get(canonicalKey)?.add(yamlKey);
	}

	const canonicalKeysToNormalize = new Set<string>([
		...existingManagedKeys.keys(),
		...incomingKeys,
	]);

	for (const canonicalKey of canonicalKeysToNormalize) {
		const preferredYamlKey = forwardMap.get(canonicalKey) ?? canonicalKey;
		const aliasKeys = new Set<string>([
			...getManagedYamlAliases(canonicalKey, keyMappings),
			...(existingManagedKeys.get(canonicalKey) ?? []),
		]);
		const existingValue = pickExistingManagedValue(frontmatter, canonicalKey, aliasKeys, preferredYamlKey);
		const hasIncomingValue = Object.prototype.hasOwnProperty.call(managedPayload, canonicalKey) === true;
		const incomingValue = managedPayload[canonicalKey];

		if (canonicalKey === 'operonId') {
			if (hasIncomingValue && incomingValue.trim()) {
				writeManagedField(canonicalKey, preferredYamlKey, aliasKeys, incomingValue);
			} else if (existingValue !== undefined) {
				writeManagedField(canonicalKey, preferredYamlKey, aliasKeys, existingValue);
			}
			continue;
		}

		if (hasIncomingValue) {
			if (incomingValue === '') {
				clearManagedField(canonicalKey, preferredYamlKey, aliasKeys);
				continue;
			}
			writeManagedField(
				canonicalKey,
				preferredYamlKey,
				aliasKeys,
				coerceYamlStoredValue(canonicalKey, incomingValue, keyMappings, existingValue),
			);
			continue;
		}

		if (existingValue === undefined) continue;

		if (mode === 'replace') {
			clearManagedField(canonicalKey, preferredYamlKey, aliasKeys);
			continue;
		}

		if (existingValue === '') {
			clearManagedField(canonicalKey, preferredYamlKey, aliasKeys);
			continue;
		}

		writeManagedField(
			canonicalKey,
			preferredYamlKey,
			aliasKeys,
			canonicalKey === 'taskIcon' && typeof existingValue === 'string'
				? normalizeTaskIconValue(existingValue)
				: canonicalKey === 'taskColor' && typeof existingValue === 'string'
					? formatTaskColorYamlValue(existingValue)
				: existingValue,
		);
	}

	if ('_tags' in fieldValues) {
		const tagStr = fieldValues['_tags'];
		if (tagStr) {
			frontmatter['tags'] = tagStr.split(';').map(t => t.trim()).filter(t => t);
		} else {
			removeYamlKey('tags');
		}
	}

	return plan;
}

export function normalizeYamlFrontmatterFormatting(
	content: string,
	plan: YamlFrontmatterFormattingPlan,
): string {
	if (plan.blankYamlKeys.size === 0 && plan.removedYamlKeys.size === 0) return content;

	const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
	if (!match) return content;

	const [, openingFence, rawFrontmatter, closingFence] = match;
	let frontmatter = rawFrontmatter;
	for (const yamlKey of plan.blankYamlKeys) {
		const escapedKey = escapeRegex(yamlKey);
		frontmatter = frontmatter.replace(
			new RegExp(`^(${escapedKey}):\\s*(?:""|''|\\[\\]|null)\\s*$`, 'm'),
			'$1:',
		);
	}
	for (const yamlKey of plan.removedYamlKeys) {
		const escapedKey = escapeRegex(yamlKey);
		frontmatter = frontmatter.replace(
			new RegExp(`^${escapedKey}:\\s*.*(?:\\r?\\n)?`, 'm'),
			'',
		);
	}

	const rebuilt = `${openingFence}${frontmatter}${closingFence}`;
	return rebuilt + content.slice(match[0].length);
}
