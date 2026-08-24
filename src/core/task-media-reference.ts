import { isSafeVaultRelativePath } from './vault-path-safety';
import { decodeTaskDataInlineValue, encodeTaskDataInlineValue } from './task-data-inline-codec';

export type TaskMediaReferenceKind = 'wikilink' | 'vault-path' | 'http-url' | 'unresolved';

export interface TaskMediaReferenceResolution {
	rawValue: string;
	kind: TaskMediaReferenceKind;
	target: string | null;
	isOpenable: boolean;
}

interface NamedTaskMediaReference {
	target: string;
	label: string;
}

/**
 * Resolve one stored task-media value without fetching it. Callers retain the
 * raw source text even when it is not an openable local or HTTP(S) reference.
 */
export function resolveTaskMediaReference(value: string | null | undefined): TaskMediaReferenceResolution {
	const rawValue = value ?? '';
	const trimmed = rawValue.trim();
	const wikilinkTarget = parseSafeWikiLinkTarget(trimmed);
	if (wikilinkTarget) {
		return { rawValue, kind: 'wikilink', target: wikilinkTarget, isOpenable: true };
	}
	const markdownLink = parseNamedTaskMediaReference(trimmed);
	if (markdownLink && isSafeVaultRelativePath(markdownLink.target)) {
		return { rawValue, kind: 'vault-path', target: markdownLink.target, isOpenable: true };
	}
	if (markdownLink && isSafeHttpUrl(markdownLink.target)) {
		return { rawValue, kind: 'http-url', target: markdownLink.target, isOpenable: true };
	}
	if (isSafeVaultRelativePath(trimmed)) {
		return { rawValue, kind: 'vault-path', target: trimmed, isOpenable: true };
	}
	if (isSafeHttpUrl(trimmed)) {
		return { rawValue, kind: 'http-url', target: trimmed, isOpenable: true };
	}
	return { rawValue, kind: 'unresolved', target: null, isOpenable: false };
}

/** Returns the user-assigned alias for a wikilink or Markdown media link. */
export function getTaskMediaReferenceAlias(value: string | null | undefined): string | null {
	const trimmed = (value ?? '').trim();
	const markdownLink = parseNamedTaskMediaReference(trimmed);
	if (markdownLink) return markdownLink.label;
	const wikilinkMatch = /^!?\[\[([^\]]+)\]\]$/u.exec(trimmed);
	if (!wikilinkMatch) return null;
	const body = wikilinkMatch[1]?.trim() ?? '';
	const pipeIndex = body.indexOf('|');
	if (pipeIndex < 0) return null;
	return body.slice(pipeIndex + 1).trim() || null;
}

/**
 * Parse the compact semicolon grammar used by `taskGallery`. Escaped
 * semicolons remain part of an item; output is ordered and deduplicated.
 */
export function parseTaskMediaReferenceList(value: string | null | undefined): string[] {
	const source = value ?? '';
	const rawItems: string[] = [];
	let item = '';
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === '\\' && index + 1 < source.length) {
			item += character + source[index + 1];
			index += 1;
			continue;
		}
		if (character === ';') {
			rawItems.push(item);
			item = '';
			continue;
		}
		item += character;
	}
	rawItems.push(item);

	const seen = new Set<string>();
	const values: string[] = [];
	for (const rawItem of rawItems) {
		const normalized = decodeTaskDataInlineValue(rawItem).trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		values.push(normalized);
	}
	return values;
}

/** Serializes task-gallery items to the canonical inline list representation. */
export function serializeTaskMediaReferenceList(values: Iterable<string>): string {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const value of values) {
		const item = value.trim();
		if (!item || seen.has(item)) continue;
		seen.add(item);
		normalized.push(encodeTaskDataInlineValue(item, true));
	}
	return normalized.join('; ');
}

export function normalizeTaskMediaReferenceList(value: string | null | undefined): string {
	return serializeTaskMediaReferenceList(parseTaskMediaReferenceList(value));
}

function parseSafeWikiLinkTarget(value: string): string | null {
	const match = /^!?\[\[([^\]]+)\]\]$/u.exec(value);
	if (!match) return null;
	const body = match[1]?.trim() ?? '';
	const pipeIndex = body.indexOf('|');
	const target = (pipeIndex < 0 ? body : body.slice(0, pipeIndex)).trim();
	return isSafeVaultRelativePath(target) ? target : null;
}

function parseNamedTaskMediaReference(value: string): NamedTaskMediaReference | null {
	const match = /^!?\[([^\]]+)\]\((.+)\)$/u.exec(value);
	if (!match) return null;
	const label = match[1]?.trim() ?? '';
	let target = match[2]?.trim() ?? '';
	if (target.startsWith('<') && target.endsWith('>')) {
		target = target.slice(1, -1).trim();
	}
	if (!label || !target || /[\r\n]/u.test(target)) return null;
	return { target, label };
}

function isSafeHttpUrl(value: string): boolean {
	if (!value || /\s/u.test(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}
