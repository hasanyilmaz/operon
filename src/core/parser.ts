/**
 * Operon task line parser.
 * Parses Markdown checkbox lines with {{key:: value}} inline fields.
 *
 * Based on Spec Sections 3, 6, and 7.
 *
 * Performance: Uses character-level pre-check to reject non-task lines
 * before regex parsing (Architecture doc Section 4.4).
 */

import { CheckboxState } from '../types/keys';
import { OperonField, ParsedTagToken, ParsedTask, SourceRange, TimePrefix, WikiLink } from '../types/fields';
import { buildReverseMapping } from './yaml-fields';
import { KeyMapping } from '../types/settings';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';
import { getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from './managed-task-fields';

/**
 * Fast pre-check: is this line potentially a task line?
 * Checks for "- [" pattern at start (after optional whitespace).
 * Rejects most lines in < 1 microsecond.
 */
export function isTaskLineCandidate(line: string): boolean {
	let i = 0;
	// Skip leading whitespace (for indented tasks)
	while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) {
		i++;
	}
	// Check: - [ (dash, space, open bracket)
	return (
		i + 2 < line.length &&
		line.charCodeAt(i) === 45 &&     // '-'
		line.charCodeAt(i + 1) === 32 && // ' '
		line.charCodeAt(i + 2) === 91    // '['
	);
}

/**
 * Parse checkbox state from the bracket content.
 * Returns null if not a valid checkbox.
 */
function parseCheckbox(char: string): CheckboxState | null {
	switch (char) {
		case ' ': return 'open';
		case 'x': case 'X': return 'done';
		case '-': return 'cancelled';
		default: return null;
	}
}

/**
 * Extract Obsidian-native #tags from text.
 * Tags are outside {{}} containers. Only matches #word patterns.
 */
interface TextPart {
	text: string;
	range: SourceRange;
}

function extractTags(parts: TextPart[]): ParsedTagToken[] {
	const tags: ParsedTagToken[] = [];
	const tagRegex = /#([a-zA-Z0-9_\-/]+)/g;
	for (const part of parts) {
		let match;
		while ((match = tagRegex.exec(part.text)) !== null) {
			tags.push({
				tag: match[1],
				range: {
					from: part.range.from + match.index,
					to: part.range.from + match.index + match[0].length,
				},
			});
		}
	}
	return tags;
}

/**
 * Parse a time prefix from the beginning of description text.
 * Matches "HH:MM" or "HH:MM-HH:MM" patterns.
 */
function parseTimePrefix(text: string): { timePrefix: TimePrefix; rest: string; matchedLength: number } | null {
	const timeRangeRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+/;
	const singleTimeRegex = /^(\d{1,2}:\d{2})\s+/;
	const spacedRangePrefixRegex = /^(\d{1,2}:\d{2})\s+-\s+(\d{1,2}:\d{2})(?=\s|$)/;

	let match = timeRangeRegex.exec(text);
	if (match) {
		return {
			timePrefix: { startTime: match[1], endTime: match[2], raw: match[0].trimEnd() },
			rest: text.substring(match[0].length),
			matchedLength: match[0].length,
		};
	}

	// Treat spaced time ranges like "08:00 - 08:30" as plain description text.
	// This avoids splitting only the first clock token into a time prefix.
	if (spacedRangePrefixRegex.test(text)) {
		return null;
	}

	match = singleTimeRegex.exec(text);
	if (match) {
		return {
			timePrefix: { startTime: match[1], endTime: null, raw: match[0].trimEnd() },
			rest: text.substring(match[0].length),
			matchedLength: match[0].length,
		};
	}

	return null;
}

/**
 * Process escape sequences in a field value.
 * Handles: \} → }, \{ → {, \; → ;, \u000A → line break, \\ → \
 */
function unescapeValue(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i++) {
		if (value[i] === '\\' && i + 1 < value.length) {
			const next = value[i + 1];
			if (value.slice(i + 1, i + 6).toLowerCase() === 'u000a') {
				result += '\n';
				i += 5;
				continue;
			}
			if (next === '}' || next === '{' || next === ';' || next === '\\') {
				result += next;
				i++; // skip next char
				continue;
			}
		}
		result += value[i];
	}
	return result;
}

/**
 * Parse inline fields from a task line.
 * Extracts all {{key:: value}} containers, handling:
 * - Nested WikiLinks [[Note|Alias]]
 * - Escape sequences
 * - Only first :: splits key from value
 *
 * Returns fields in order found and the text portions between/around them.
 */
function extractFields(
	text: string,
	baseOffset: number,
	reverseMap: Map<string, string>,
	keyMappings: KeyMapping[],
): { fields: OperonField[]; textParts: TextPart[] } {
	const fields: OperonField[] = [];
	const textParts: TextPart[] = [];
	let i = 0;
	let lastEnd = 0;

	while (i < text.length - 1) {
		// Look for {{ opening
		if (text[i] === '{' && text[i + 1] === '{') {
			// Save text before this field
			textParts.push({
				text: text.substring(lastEnd, i),
				range: { from: baseOffset + lastEnd, to: baseOffset + i },
			});

			// Find matching }} considering escapes and nested [[]]
			const fieldStart = i + 2; // after {{
			let depth = 0; // track [[ nesting
			let j = fieldStart;
			let found = false;

			while (j < text.length - 1) {
				if (text[j] === '\\') {
					j += 2; // skip escaped char
					continue;
				}
				if (text[j] === '[' && j + 1 < text.length && text[j + 1] === '[') {
					depth++;
					j += 2;
					continue;
				}
				if (text[j] === ']' && j + 1 < text.length && text[j + 1] === ']') {
					depth--;
					j += 2;
					continue;
				}
				if (depth === 0 && text[j] === '}' && text[j + 1] === '}') {
					// Found closing }}
					const fieldContent = text.substring(fieldStart, j);
					const field = parseFieldContent(fieldContent, baseOffset + i, baseOffset + j + 2, reverseMap, keyMappings);
					if (field) {
						fields.push(field);
					}
					lastEnd = j + 2;
					i = lastEnd;
					found = true;
					break;
				}
				j++;
			}

			if (!found) {
				// Unclosed {{ — treat as text
				i++;
			}
		} else {
			i++;
		}
	}

	// Remaining text after last field
	textParts.push({
		text: text.substring(lastEnd),
		range: { from: baseOffset + lastEnd, to: baseOffset + text.length },
	});
	return { fields, textParts };
}

/**
 * Parse the content between {{ and }}.
 * Splits on first :: to get key and value.
 */
function parseFieldContent(
	content: string,
	containerFrom: number,
	containerTo: number,
	reverseMap: Map<string, string>,
	keyMappings: KeyMapping[],
): OperonField | null {
	// Find first :: separator
	const sepIndex = content.indexOf('::');
	if (sepIndex === -1) return null;

	const sourceKey = content.substring(0, sepIndex).trim();
	if (!sourceKey) return null;

	// Value is everything after :: (with optional leading space)
	let rawValue = content.substring(sepIndex + 2);
	let valueOffset = sepIndex + 2;
	if (rawValue.startsWith(' ')) {
		rawValue = rawValue.substring(1);
		valueOffset += 1;
	}

	let value = unescapeValue(rawValue);
	const key = reverseMap.get(sourceKey) ?? sourceKey;
	if (key === 'taskColor') {
		value = normalizeTaskColorValue(value);
	} else if (key === 'taskIcon') {
		value = normalizeTaskIconValue(value);
	}
	const fieldType = getManagedTaskFieldType(key, keyMappings) ?? 'text';

	return {
		sourceKey,
		key,
		value,
		rawValue,
		type: fieldType,
		isCanonical: isManagedTaskFieldCanonicalKey(key, keyMappings),
		containerRange: { from: containerFrom, to: containerTo },
		valueRange: {
			from: containerFrom + 2 + valueOffset,
			to: containerFrom + 2 + valueOffset + rawValue.length,
		},
	};
}

/**
 * Parse a semicolon-separated list value into individual items.
 * Handles escaped semicolons (\;).
 */
export function parseListValue(value: string): string[] {
	if (!value.trim()) return [];
	const items: string[] = [];
	let current = '';

	for (let i = 0; i < value.length; i++) {
		if (value[i] === '\\' && i + 1 < value.length && value[i + 1] === ';') {
			current += ';';
			i++; // skip ;
			continue;
		}
		if (value[i] === ';') {
			items.push(current.trim());
			current = '';
			// Skip optional space after semicolon
			if (i + 1 < value.length && value[i + 1] === ' ') {
				i++;
			}
			continue;
		}
		current += value[i];
	}

	const last = current.trim();
	if (last) items.push(last);
	return items;
}

/**
 * Extract WikiLinks from a field value.
 * Matches [[path]] and [[path|alias]] patterns.
 */
export function extractWikiLinks(value: string): WikiLink[] {
	const links: WikiLink[] = [];
	const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
	let match;
	while ((match = regex.exec(value)) !== null) {
		links.push({
			path: match[1],
			alias: match[2] ?? null,
			raw: match[0],
		});
	}
	return links;
}

/**
 * Parse a full task line into a ParsedTask object.
 *
 * @param line - The raw line text
 * @param lineNumber - Line number in the source file (0-based)
 * @param filePath - Source file path
 * @returns ParsedTask or null if line is not a valid task
 */
function findDescriptionRange(
	line: string,
	contentStart: number,
	metadataTailFrom: number | null,
): SourceRange {
	const tailStart = metadataTailFrom ?? line.length;
	let from = contentStart;
	while (from < tailStart && /\s/.test(line[from])) from++;
	let to = tailStart;
	while (to > from && /\s/.test(line[to - 1])) to--;
	return { from, to };
}

export function parseTaskLine(
	line: string,
	lineNumber: number,
	filePath: string,
	keyMappings: KeyMapping[] = [],
): ParsedTask | null {
	// Fast pre-check
	if (!isTaskLineCandidate(line)) return null;

	// Parse checkbox: match "- [x] " pattern (with optional leading whitespace)
	const checkboxRegex = /^(\s*)- \[(.)\](\s*)/;
	const cbMatch = checkboxRegex.exec(line);
	if (!cbMatch) return null;

	const checkbox = parseCheckbox(cbMatch[2]);
	if (!checkbox) return null;
	const checkboxRange = {
		from: cbMatch[1].length,
		to: cbMatch[0].length,
	};

	// Everything after "- [x] "
	let rest = line.substring(cbMatch[0].length);
	let contentStart = cbMatch[0].length;
	const reverseMap = buildReverseMapping(keyMappings);

	// Parse optional time prefix
	let timePrefix: TimePrefix | null = null;
	let timePrefixRange: SourceRange | null = null;
	const timeParsed = parseTimePrefix(rest);
	if (timeParsed) {
		timePrefix = timeParsed.timePrefix;
		timePrefixRange = {
			from: contentStart,
			to: contentStart + timeParsed.timePrefix.raw.length,
		};
		rest = timeParsed.rest;
		contentStart += timeParsed.matchedLength;
	}

	// Extract fields from rest of line
	const { fields, textParts } = extractFields(rest, contentStart, reverseMap, keyMappings);

	// Combine text parts to get description + tags
	const textContent = textParts.map(part => part.text).join('').trim();

	// Extract tags from text content
	const tagTokens = extractTags(textParts);
	const tags = tagTokens.map(token => token.tag);

	// Description is text content with tags removed, cleaned up
	let description = textContent;
	for (const tag of tags) {
		description = description.replace(`#${tag}`, '');
	}
	description = description.replace(/\s+/g, ' ').trim();

	// Find operonId
	const idField = fields.find(f => f.key === 'operonId');
	const operonId = idField?.value ?? null;
	const metadataStarts = [
		...fields.map(field => field.containerRange.from),
		...tagTokens.map(tag => tag.range.from),
	].sort((a, b) => a - b);
	let metadataTailFrom = metadataStarts.length > 0 ? metadataStarts[0] : null;
	const descriptionRange = findDescriptionRange(line, contentStart, metadataTailFrom);

	return {
		checkbox,
		checkboxRange,
		timePrefix,
		timePrefixRange,
		description,
		descriptionRange,
		tags,
		tagTokens,
		fields,
		metadataTailRange: metadataTailFrom === null ? null : { from: metadataTailFrom, to: line.length },
		operonId,
		filePath,
		lineNumber,
		rawLine: line,
	};
}

export function resolveInlineTaskDescriptionCursorCh(task: ParsedTask): number {
	return task.descriptionRange.to;
}

/**
 * Check if a line contains any Operon inline fields ({{key:: value}}).
 * Does NOT require operonId — any field makes it an Operon task.
 * (Spec Section 3.8: Checkbox vs Operon Task Rule)
 */
export function hasOperonFields(line: string): boolean {
	return /\{\{[^}]+::\s*[^}]*\}\}/.test(line);
}

/**
 * Batch-parse all task lines from file content.
 * Returns array of ParsedTask for all valid task lines.
 */
export function parseFileContent(content: string, filePath: string, keyMappings: KeyMapping[] = []): ParsedTask[] {
	const lines = content.split('\n');
	const tasks: ParsedTask[] = [];

	for (let i = 0; i < lines.length; i++) {
		// Character-level pre-check for performance
		if (!isTaskLineCandidate(lines[i])) continue;

		const task = parseTaskLine(lines[i], i, filePath, keyMappings);
		if (task && (task.operonId || task.fields.some(field =>
			field.key === 'tags' || isManagedTaskFieldCanonicalKey(field.key, keyMappings)
		))) {
			tasks.push(task);
		}
	}

	return tasks;
}
