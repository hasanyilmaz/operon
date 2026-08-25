import { parseYaml } from 'obsidian';

import { parseDependencyIdList } from './dependency-graph';
import { isValidOperonId } from './id-generator';
import { iterateMarkdownLinesOutsideFences } from './markdown-fenced-lines';
import { parseTaskLine } from './parser';
import { getManagedYamlAliases } from './yaml-fields';
import type { KeyMapping } from '../types/settings';

export interface TaskSourceRelationshipRecord {
	readonly operonId: string;
	readonly targetIds: readonly string[];
}

export interface TaskSourceRelationshipAuthorityAnalysis {
	readonly valid: boolean;
	readonly relationships: readonly TaskSourceRelationshipRecord[];
}

export interface TaskSourceRelationshipAuthorityInput {
	readonly content: string;
	readonly filePath: string;
	readonly keyMappings: readonly KeyMapping[];
	readonly pathIndexable: boolean;
	readonly indexedTargetExists: (operonId: string) => boolean;
}

/**
 * Validates relationship targets in a proposed source while allowing one exact,
 * indexable local identity to authorize another task in that same source.
 */
export function analyzeTaskSourceRelationshipAuthority(
	input: TaskSourceRelationshipAuthorityInput,
): TaskSourceRelationshipAuthorityAnalysis {
	const keyMappings = [...input.keyMappings];
	const localIdentityCounts = new Map<string, number>();
	const ambiguousIdentityIds = new Set<string>();
	const invalidLocalIdentityIds = new Set<string>();
	const relationships: TaskSourceRelationshipRecord[] = [];
	const allTargetIds: string[] = [];
	let invalidSource = false;
	const countIdentity = (operonId: string): void => {
		if (!isValidOperonId(operonId)) {
			const trimmedOperonId = operonId.trim();
			if (trimmedOperonId) invalidLocalIdentityIds.add(trimmedOperonId);
			return;
		}
		localIdentityCounts.set(operonId, (localIdentityCounts.get(operonId) ?? 0) + 1);
	};
	const recordRelationship = (operonId: string | null, fieldValues: Record<string, string>): void => {
		const targetIds = relationshipTargetIds(fieldValues);
		allTargetIds.push(...targetIds);
		if (targetIds.length > 0 && (!operonId || !isValidOperonId(operonId))) {
			invalidSource = true;
			return;
		}
		if (operonId && isValidOperonId(operonId)) {
			relationships.push({ operonId, targetIds });
		}
	};

	for (const [lineNumber, line] of iterateMarkdownLinesOutsideFences(input.content)) {
		const task = parseTaskLine(line, lineNumber, input.filePath, keyMappings);
		if (!task) continue;
		const fieldValues = Object.fromEntries(task.fields.map(field => [field.key, field.value]));
		const identityValues = task.fields
			.filter(field => field.key === 'operonId' && field.value.trim().length > 0)
			.map(field => field.value);
		const inlineIdentity = identityValues.length === 1
			&& task.operonId === identityValues[0]
			&& isValidOperonId(identityValues[0])
			? identityValues[0]
			: null;
		if (inlineIdentity) {
			countIdentity(inlineIdentity);
		} else {
			for (const operonId of new Set(identityValues)) {
				if (isValidOperonId(operonId)) ambiguousIdentityIds.add(operonId);
				else countIdentity(operonId);
			}
		}
		recordRelationship(inlineIdentity, fieldValues);
	}

	const frontmatter = parseFrontmatter(input.content);
	if (frontmatter) {
		const identityValues = getManagedYamlAliases('operonId', keyMappings)
			.filter(yamlKey => Object.prototype.hasOwnProperty.call(frontmatter, yamlKey))
			.map(yamlKey => yamlIdentityScalar(frontmatter[yamlKey]))
			.filter((value): value is string => value !== null && value.trim().length > 0);
		const distinctIdentityValues = [...new Set(identityValues)];
		const yamlIdentity = distinctIdentityValues.length === 1
			? distinctIdentityValues[0]
			: null;
		if (yamlIdentity) countIdentity(yamlIdentity);
		if (distinctIdentityValues.length > 1) {
			for (const operonId of distinctIdentityValues) {
				if (isValidOperonId(operonId)) ambiguousIdentityIds.add(operonId);
				else countIdentity(operonId);
			}
		}
		const fieldValues: Record<string, string> = {};
		for (const canonicalKey of ['parentTask', 'blocking', 'blockedBy'] as const) {
			const resolved = resolveYamlRelationshipField(frontmatter, canonicalKey, keyMappings);
			if (!resolved.ok) invalidSource = true;
			else if (resolved.value) fieldValues[canonicalKey] = resolved.value;
		}
		recordRelationship(yamlIdentity, fieldValues);
	}

	for (const [operonId, count] of localIdentityCounts) {
		if (count > 1) ambiguousIdentityIds.add(operonId);
	}
	const targetExists = (operonId: string): boolean => {
		if (invalidLocalIdentityIds.has(operonId)) return false;
		if (ambiguousIdentityIds.has(operonId)) return false;
		const localCount = localIdentityCounts.get(operonId);
		if (localCount !== undefined) return input.pathIndexable && localCount === 1;
		return input.indexedTargetExists(operonId);
	};
	return {
		valid: !invalidSource && allTargetIds.every(targetExists),
		relationships: input.pathIndexable ? relationships : [],
	};
}

function resolveYamlRelationshipField(
	frontmatter: Record<string, unknown>,
	canonicalKey: 'parentTask' | 'blocking' | 'blockedBy',
	keyMappings: readonly KeyMapping[],
): { readonly ok: true; readonly value: string } | { readonly ok: false } {
	const values: string[] = [];
	for (const alias of getManagedYamlAliases(canonicalKey, [...keyMappings])) {
		if (!Object.prototype.hasOwnProperty.call(frontmatter, alias)) continue;
		const normalized = normalizeYamlRelationshipValue(frontmatter[alias], canonicalKey);
		if (normalized === null) return { ok: false };
		if (normalized.trim()) values.push(normalized);
	}
	const distinctValues = [...new Set(values)];
	return distinctValues.length > 1
		? { ok: false }
		: { ok: true, value: distinctValues[0] ?? '' };
}

function normalizeYamlRelationshipValue(
	value: unknown,
	canonicalKey: 'parentTask' | 'blocking' | 'blockedBy',
): string | null {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (canonicalKey === 'parentTask' || !Array.isArray(value)) return null;
	const scalars: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
			return null;
		}
		scalars.push(String(item));
	}
	return scalars.join('; ');
}

function relationshipTargetIds(fieldValues: Record<string, string>): string[] {
	const targetIds: string[] = [];
	if (Object.prototype.hasOwnProperty.call(fieldValues, 'parentTask')) {
		const parentId = (fieldValues['parentTask'] ?? '').trim();
		if (parentId) targetIds.push(parentId);
	}
	for (const key of ['blocking', 'blockedBy'] as const) {
		if (!Object.prototype.hasOwnProperty.call(fieldValues, key)) continue;
		targetIds.push(...parseDependencyIdList(fieldValues[key] ?? ''));
	}
	return targetIds;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
	if (!match) return null;
	try {
		const parsed: unknown = parseYaml(match[1]);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: null;
	} catch {
		return null;
	}
}

function yamlIdentityScalar(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
	return null;
}
