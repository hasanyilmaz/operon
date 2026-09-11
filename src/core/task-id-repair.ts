import { isValidOperonId } from './id-generator';
import { markdownBodyStartLine } from './markdown-body';
import { iterateMarkdownLinesOutsideFences } from './markdown-fenced-lines';
import { parseTaskLine } from './parser';
import type { ParsedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';

export type InlineTaskIdRepairPlan =
	| { ok: true; content: string; previousId: string | null; nextId: string }
	| { ok: false; reason: 'invalid-replacement' | 'source-changed' | 'ambiguous-fields' | 'not-repairable' };

/**
 * Pure source preparation for an explicitly requested repair. The caller must
 * establish vault-wide uniqueness, plan reference updates, and compare-and-set
 * the complete source together with those updates before reporting success.
 * Never resolve an incompatible ID by searching for a different matching line.
 */
export function planInlineTaskIdRepair(
	content: string,
	expected: Pick<ParsedTask, 'filePath' | 'lineNumber' | 'rawLine' | 'operonId'>,
	nextId: string,
	modifiedAt: string,
	occupiedIds: ReadonlySet<string>,
	keyMappings: KeyMapping[] = [],
): InlineTaskIdRepairPlan {
	if (!isValidOperonId(nextId) || occupiedIds.has(nextId)
		|| !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(modifiedAt)) {
		return { ok: false, reason: 'invalid-replacement' };
	}
	if (!Number.isSafeInteger(expected.lineNumber) || expected.lineNumber < 0) {
		return { ok: false, reason: 'source-changed' };
	}
	const lines = content.split('\n');
	if (lines[expected.lineNumber] !== expected.rawLine) return { ok: false, reason: 'source-changed' };
	const bodyStart = markdownBodyStartLine(lines);
	if (bodyStart === null || expected.lineNumber < bodyStart) {
		return { ok: false, reason: 'not-repairable' };
	}
	let sourceIsExecutable = false;
	for (const [lineNumber] of iterateMarkdownLinesOutsideFences(lines.slice(bodyStart).join('\n'), true)) {
		if (lineNumber + bodyStart === expected.lineNumber) { sourceIsExecutable = true; break; }
	}
	if (!sourceIsExecutable) return { ok: false, reason: 'not-repairable' };
	const parsed = parseTaskLine(expected.rawLine, expected.lineNumber, expected.filePath, keyMappings);
	if (!parsed || parsed.operonId !== expected.operonId) return { ok: false, reason: 'source-changed' };
	if ((parsed.operonId && isValidOperonId(parsed.operonId)) || parsed.fields.length === 0) {
		return { ok: false, reason: 'not-repairable' };
	}
	const line = patchInlineTaskIdRepairFields(parsed, { operonId: nextId, datetimeModified: modifiedAt });
	if (line === null) return { ok: false, reason: 'ambiguous-fields' };
	const verified = parseTaskLine(line, expected.lineNumber, expected.filePath, keyMappings);
	if (verified?.operonId !== nextId) return { ok: false, reason: 'ambiguous-fields' };
	lines[expected.lineNumber] = line;
	return { ok: true, content: lines.join('\n'), previousId: parsed.operonId, nextId };
}

export type TaskIdRepairSourceField = 'operonId' | 'parentTask' | 'blocking' | 'blockedBy' | 'related' | 'datetimeModified';

/** Values are already encoded inline field values; unrelated source bytes are retained. */
export function patchInlineTaskIdRepairFields(
	parsed: ParsedTask,
	values: Readonly<Partial<Record<TaskIdRepairSourceField, string>>>,
): string | null {
	const edits: Array<{ from: number; to: number; value: string }> = [];
	const additions: string[] = [];
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || /[\r\n]/u.test(value)) return null;
		const fields = parsed.fields.filter(field => field.key === key);
		if (fields.length > 1) return null;
		const field = fields[0];
		if (field) {
			// Whitespace is part of the parser's ID value; retaining it would
			// leave the replacement incompatible with the canonical ID contract.
			edits.push({ ...field.valueRange, value });
		} else {
			additions.push(`{{${key}:: ${value}}}`);
		}
	}
	let line = parsed.rawLine;
	for (const edit of edits.sort((a, b) => b.from - a.from)) {
		line = line.slice(0, edit.from) + edit.value + line.slice(edit.to);
	}
	if (additions.length > 0) {
		const suffix = line.endsWith('\r') ? '\r' : '';
		line = line.slice(0, line.length - suffix.length) + ' ' + additions.join(' ') + suffix;
	}
	return line;
}
