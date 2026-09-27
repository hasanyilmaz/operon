import { parseTaskLine, isTaskLineCandidate } from './parser';
import { ParsedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';
import { isManagedTaskFieldCanonicalKey } from './managed-task-fields';

export interface PlainCheckboxLine {
	lineNumber: number;
	rawLine: string;
	indent: string;
	listMarker: string;
	markerSpacing: string;
	marker: string;
	postMarkerSpacing: string;
	text: string;
	completed: boolean;
}

export type PlainCheckboxMoveLine = Pick<PlainCheckboxLine, 'lineNumber' | 'rawLine'>;

export type PlainCheckboxEditScope =
	| { kind: 'file' }
	| { kind: 'inline'; operonId: string };

export type PlainCheckboxContentPatchResult =
	| { ok: true; content: string; lineNumber: number }
	| { ok: false; reason: 'line-missing' | 'line-out-of-scope' | 'scope-missing' };

export interface PlainCheckboxDraftLine {
	sourceLineNumber: number | null;
	insertAfterLineNumber: number | null;
	indent: string;
	listMarker: string;
	markerSpacing: string;
	postMarkerSpacing: string;
	completed: boolean;
	text: string;
}

export function parsePlainMarkdownCheckboxLine(line: string): PlainCheckboxLine | null {
	const match = /^(\s*)((?:[-*+]|\d+[.)]))([ \t]+)\[([^\]]*)\]([ \t]*)(.*)$/.exec(line);
	if (!match) return null;

	const postMarkerSpacing = match[5] ?? '';
	const text = match[6] ?? '';
	if (!postMarkerSpacing && text) return null;

	const marker = match[4] ?? '';
	return {
		lineNumber: -1,
		rawLine: line,
		indent: match[1] ?? '',
		listMarker: match[2] ?? '-',
		markerSpacing: match[3] ?? ' ',
		marker,
		postMarkerSpacing,
		text,
		completed: marker.trim().length > 0,
	};
}

/** Internal policy only; public Runtime V1 retains its original ownership. */
export type PlainCheckboxOwnershipPolicy = 'legacy-v1' | 'contiguous';

export interface PlainCheckboxOwner {
	operonId: string;
	lineNumber: number;
}

export interface PlainCheckboxOwnershipScan {
	checkboxes: { line: PlainCheckboxLine; owner: PlainCheckboxOwner | null }[];
	/** Inclusive last owned checkbox line; the task line when its list is empty. */
	blocks: { owner: PlainCheckboxOwner; endLineNumber: number }[];
}

type PlainCheckboxSourceEntry =
	| { kind: 'task'; owner: PlainCheckboxOwner }
	| { kind: 'checkbox'; line: PlainCheckboxLine; owner: PlainCheckboxOwner | null };

/** One source traversal shared by collection, owner lookup, and block boundaries. */
function* iteratePlainCheckboxOwnership(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	policy: PlainCheckboxOwnershipPolicy,
): Iterable<PlainCheckboxSourceEntry> {
	const lines = content.split('\n');
	let inFencedCodeBlock = false;
	let owner: PlainCheckboxOwner | null = null;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (isMarkdownFenceLine(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			if (policy === 'contiguous') owner = null;
			continue;
		}
		if (inFencedCodeBlock) continue;

		// Preserve V1 parsing while treating CRLF as a line ending in the new policy.
		const logicalLine = policy === 'contiguous' && line.endsWith('\r') ? line.slice(0, -1) : line;
		const task = parseOperonTaskLineCandidate(logicalLine, index, filePath, keyMappings);
		if (task) {
			if (task.operonId) {
				owner = { operonId: task.operonId, lineNumber: index };
				yield { kind: 'task', owner };
			} else if (policy === 'contiguous') {
				owner = null;
			}
			continue;
		}

		const checkbox = parsePlainMarkdownCheckboxLine(logicalLine);
		if (!checkbox) {
			if (policy === 'contiguous') owner = null;
			continue;
		}
		yield { kind: 'checkbox', line: { ...checkbox, rawLine: line, lineNumber: index }, owner };
	}
}

/** Read-only, request-local ownership information; does not activate a new policy. */
export function scanPlainCheckboxOwnership(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	policy: PlainCheckboxOwnershipPolicy,
): PlainCheckboxOwnershipScan {
	const checkboxes: PlainCheckboxOwnershipScan['checkboxes'] = [];
	const blocks: PlainCheckboxOwnershipScan['blocks'] = [];
	let block: PlainCheckboxOwnershipScan['blocks'][number] | null = null;
	for (const entry of iteratePlainCheckboxOwnership(content, filePath, keyMappings, policy)) {
		if (entry.kind === 'task') {
			block = { owner: entry.owner, endLineNumber: entry.owner.lineNumber };
			blocks.push(block);
		} else {
			checkboxes.push({ line: entry.line, owner: entry.owner });
			if (block && entry.owner === block.owner) block.endLineNumber = entry.line.lineNumber;
		}
	}
	return { checkboxes, blocks };
}

export function collectPlainCheckboxLines(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	policy: PlainCheckboxOwnershipPolicy = 'legacy-v1',
): PlainCheckboxLine[] {
	const results: PlainCheckboxLine[] = [];
	const effectivePolicy = scope.kind === 'file' ? 'legacy-v1' : policy;
	for (const entry of iteratePlainCheckboxOwnership(content, filePath, keyMappings, effectivePolicy)) {
		if (entry.kind !== 'checkbox') continue;
		if (scope.kind === 'inline' && entry.owner?.operonId !== scope.operonId) continue;
		results.push(entry.line);
	}
	return results;
}

export function collectScopedPlainCheckboxMoveLines(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	targetLineNumber: number,
	policy: PlainCheckboxOwnershipPolicy = 'legacy-v1',
): PlainCheckboxMoveLine[] {
	return collectPlainCheckboxLines(content, filePath, keyMappings, scope, policy)
		.filter(line => line.lineNumber > targetLineNumber)
		.map(line => ({
			lineNumber: line.lineNumber,
			rawLine: line.rawLine,
		}));
}

export function canRemovePlainCheckboxMoveLines(
	lines: readonly string[],
	targetLineNumber: number,
	checkboxLines: readonly PlainCheckboxMoveLine[],
): boolean {
	const seenLineNumbers = new Set<number>();
	for (const checkboxLine of checkboxLines) {
		if (seenLineNumbers.has(checkboxLine.lineNumber)) return false;
		seenLineNumbers.add(checkboxLine.lineNumber);
		if (checkboxLine.lineNumber <= targetLineNumber || checkboxLine.lineNumber >= lines.length) return false;
		if (lines[checkboxLine.lineNumber] !== checkboxLine.rawLine) return false;
	}
	return true;
}

export function removePlainCheckboxMoveLinesFromContent(
	content: string,
	targetLineNumber: number,
	checkboxLines: readonly PlainCheckboxMoveLine[],
): string | null {
	const lines = content.split('\n');
	if (!canRemovePlainCheckboxMoveLines(lines, targetLineNumber, checkboxLines)) return null;

	const nextLines = [...lines];
	const descendingLines = [...checkboxLines]
		.sort((left, right) => right.lineNumber - left.lineNumber);
	for (const line of descendingLines) {
		nextLines.splice(line.lineNumber, 1);
	}
	return nextLines.join('\n');
}

export function updatePlainCheckboxLineContent(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	lineNumber: number,
	update: { completed?: boolean; text?: string },
	policy: PlainCheckboxOwnershipPolicy = 'legacy-v1',
): PlainCheckboxContentPatchResult {
	const lines = content.split('\n');
	const checkbox = findScopedCheckboxLine(content, filePath, keyMappings, scope, lineNumber, policy);
	if (!checkbox) {
		return {
			ok: false,
			reason: lineNumber >= 0 && lineNumber < lines.length ? 'line-out-of-scope' : 'line-missing',
		};
	}

	const completed = update.completed ?? checkbox.completed;
	const text = update.text ?? checkbox.text;
	lines[lineNumber] = formatPlainCheckboxLine(checkbox, completed, text) + (policy === 'contiguous' && checkbox.rawLine.endsWith('\r') ? '\r' : '');
	return {
		ok: true,
		content: lines.join('\n'),
		lineNumber,
	};
}

export function removePlainCheckboxLineContent(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	lineNumber: number,
	policy: PlainCheckboxOwnershipPolicy = 'legacy-v1',
): PlainCheckboxContentPatchResult {
	const lines = content.split('\n');
	const checkbox = findScopedCheckboxLine(content, filePath, keyMappings, scope, lineNumber, policy);
	if (!checkbox) {
		return {
			ok: false,
			reason: lineNumber >= 0 && lineNumber < lines.length ? 'line-out-of-scope' : 'line-missing',
		};
	}

	lines.splice(lineNumber, 1);
	return {
		ok: true,
		content: lines.join('\n'),
		lineNumber,
	};
}

export function insertPlainCheckboxLineContent(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	text = '',
	options: { afterLineNumber?: number } = {},
	policy: PlainCheckboxOwnershipPolicy = 'legacy-v1',
): PlainCheckboxContentPatchResult {
	const lines = content.split('\n');
	const scopedLines = collectPlainCheckboxLines(content, filePath, keyMappings, scope, policy);
	const afterLine = typeof options.afterLineNumber === 'number'
		? scopedLines.find(line => line.lineNumber === options.afterLineNumber) ?? null
		: null;
	if (typeof options.afterLineNumber === 'number' && !afterLine) {
		return { ok: false, reason: 'line-out-of-scope' };
	}
	const insertLineNumber = afterLine
		? afterLine.lineNumber + 1
		: resolvePlainCheckboxInsertLine(content, filePath, keyMappings, scope, scopedLines, policy);
	if (insertLineNumber === null) {
		return { ok: false, reason: 'scope-missing' };
	}

	const reference = afterLine ?? scopedLines[scopedLines.length - 1] ?? null;
	const nextLine = formatNewPlainCheckboxLine(reference, text);
	lines.splice(insertLineNumber, 0, nextLine);
	return {
		ok: true,
		content: lines.join('\n'),
		lineNumber: insertLineNumber,
	};
}

export function applyPlainCheckboxDraftContent(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	draftLines: PlainCheckboxDraftLine[],
	policy: PlainCheckboxOwnershipPolicy = 'legacy-v1',
): PlainCheckboxContentPatchResult {
	const lines = content.split('\n');
	const eol = policy === 'contiguous' && scope.kind === 'inline' && content.includes('\r\n') ? '\r' : '';
	const formatNew = (draft: PlainCheckboxDraftLine) => formatPlainCheckboxDraftLine(draft) + eol;
	const scopedLines = collectPlainCheckboxLines(content, filePath, keyMappings, scope, policy);
	const scopedByLineNumber = new Map(scopedLines.map(line => [line.lineNumber, line]));
	const draftBySourceLineNumber = new Map<number, PlainCheckboxDraftLine>();
	const newDraftsByAnchor = new Map<number, PlainCheckboxDraftLine[]>();
	const unanchoredNewDrafts: PlainCheckboxDraftLine[] = [];

	for (const draft of draftLines) {
		if (draft.sourceLineNumber !== null) {
			if (!scopedByLineNumber.has(draft.sourceLineNumber) || draftBySourceLineNumber.has(draft.sourceLineNumber)) {
				return {
					ok: false,
					reason: draft.sourceLineNumber >= 0 && draft.sourceLineNumber < lines.length ? 'line-out-of-scope' : 'line-missing',
				};
			}
			draftBySourceLineNumber.set(draft.sourceLineNumber, draft);
			continue;
		}

		const anchor = draft.insertAfterLineNumber;
		if (anchor !== null) {
			if (!scopedByLineNumber.has(anchor)) {
				return {
					ok: false,
					reason: anchor >= 0 && anchor < lines.length ? 'line-out-of-scope' : 'line-missing',
				};
			}
			const anchoredDrafts = newDraftsByAnchor.get(anchor) ?? [];
			anchoredDrafts.push(draft);
			newDraftsByAnchor.set(anchor, anchoredDrafts);
			continue;
		}

		unanchoredNewDrafts.push(draft);
	}

	let firstTouchedLineNumber = resolveFirstPlainCheckboxDraftTouchedLine(scopedLines, draftLines);
	const unanchoredInsertLine = unanchoredNewDrafts.length > 0
		? resolvePlainCheckboxInsertLine(content, filePath, keyMappings, scope, scopedLines, policy)
		: null;
	if (unanchoredNewDrafts.length > 0 && unanchoredInsertLine === null) {
		return { ok: false, reason: 'scope-missing' };
	}
	if (unanchoredInsertLine !== null) {
		firstTouchedLineNumber = Math.min(firstTouchedLineNumber, unanchoredInsertLine);
	}

	const operationLineNumbers = new Set<number>([
		...scopedByLineNumber.keys(),
		...newDraftsByAnchor.keys(),
	]);
	const sortedOperationLineNumbers = Array.from(operationLineNumbers).sort((a, b) => b - a);
	for (const lineNumber of sortedOperationLineNumbers) {
		const newDrafts = newDraftsByAnchor.get(lineNumber);
		if (newDrafts?.length) {
			lines.splice(lineNumber + 1, 0, ...newDrafts.map(formatNew));
		}

		const scopedLine = scopedByLineNumber.get(lineNumber);
		if (!scopedLine) continue;

		const draft = draftBySourceLineNumber.get(lineNumber);
		if (draft) {
			lines[lineNumber] = formatPlainCheckboxDraftLine(draft) + (eol && scopedLine.rawLine.endsWith('\r') ? eol : '');
		} else {
			lines.splice(lineNumber, 1);
		}
	}

	if (unanchoredInsertLine !== null && unanchoredNewDrafts.length > 0) {
		lines.splice(unanchoredInsertLine, 0, ...unanchoredNewDrafts.map(formatNew));
	}

	return {
		ok: true,
		content: lines.join('\n'),
		lineNumber: firstTouchedLineNumber,
	};
}

export function parseOperonTaskLineCandidate(
	line: string,
	lineNumber: number,
	filePath: string,
	keyMappings: KeyMapping[],
): ParsedTask | null {
	if (!isTaskLineCandidate(line)) return null;
	if (line.indexOf('{{') === -1) return null;

	const task = parseTaskLine(line, lineNumber, filePath, keyMappings);
	return task && (task.operonId || task.fields.some(field =>
		field.key === 'tags' || isManagedTaskFieldCanonicalKey(field.key, keyMappings)
	))
		? task
		: null;
}

function findScopedCheckboxLine(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	lineNumber: number,
	policy: PlainCheckboxOwnershipPolicy,
): PlainCheckboxLine | null {
	return collectPlainCheckboxLines(content, filePath, keyMappings, scope, policy)
		.find(line => line.lineNumber === lineNumber) ?? null;
}

function resolvePlainCheckboxInsertLine(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
	scope: PlainCheckboxEditScope,
	scopedLines: PlainCheckboxLine[],
	policy: PlainCheckboxOwnershipPolicy,
): number | null {
	const lastScopedLine = scopedLines[scopedLines.length - 1];
	if (lastScopedLine) return lastScopedLine.lineNumber + 1;

	if (scope.kind === 'file') {
		return getFileBodyStartLineNumber(content);
	}

	if (policy === 'contiguous') {
		const blocks = scanPlainCheckboxOwnership(content, filePath, keyMappings, policy).blocks.filter(block => block.owner.operonId === scope.operonId);
		return blocks.length === 1 ? blocks[0].endLineNumber + 1 : null;
	}
	const lines = content.split('\n');
	for (let index = 0; index < lines.length; index += 1) {
		const task = parseOperonTaskLineCandidate(lines[index] ?? '', index, filePath, keyMappings);
		if (task?.operonId === scope.operonId) return index + 1;
	}

	return null;
}

function formatPlainCheckboxLine(
	source: PlainCheckboxLine,
	completed: boolean,
	text: string,
): string {
	const marker = completed ? 'x' : ' ';
	const spacing = text ? (source.postMarkerSpacing || ' ') : '';
	return `${source.indent}${source.listMarker}${source.markerSpacing}[${marker}]${spacing}${text}`;
}

function formatPlainCheckboxDraftLine(draft: PlainCheckboxDraftLine): string {
	const marker = draft.completed ? 'x' : ' ';
	const text = normalizePlainCheckboxDraftText(draft.text);
	const spacing = text ? (draft.postMarkerSpacing || ' ') : '';
	return `${draft.indent}${draft.listMarker}${draft.markerSpacing}[${marker}]${spacing}${text}`;
}

function formatNewPlainCheckboxLine(reference: PlainCheckboxLine | null, text: string): string {
	if (!reference) return text ? `- [ ] ${text}` : '- [ ]';
	const listMarker = getNextListMarker(reference.listMarker);
	const spacing = text ? (reference.postMarkerSpacing || ' ') : '';
	return `${reference.indent}${listMarker}${reference.markerSpacing}[ ]${spacing}${text}`;
}

function resolveFirstPlainCheckboxDraftTouchedLine(
	scopedLines: PlainCheckboxLine[],
	draftLines: PlainCheckboxDraftLine[],
): number {
	const sourceLineNumbers = draftLines
		.map(line => line.sourceLineNumber ?? line.insertAfterLineNumber ?? null)
		.filter((lineNumber): lineNumber is number => typeof lineNumber === 'number');
	if (sourceLineNumbers.length > 0) {
		return Math.min(...sourceLineNumbers);
	}
	return scopedLines[0]?.lineNumber ?? 0;
}

function normalizePlainCheckboxDraftText(text: string): string {
	return text.replace(/[\r\n]+/gu, ' ');
}

function getNextListMarker(marker: string): string {
	const numbered = /^(\d+)([.)])$/.exec(marker);
	if (!numbered) return marker;
	return `${Number(numbered[1]) + 1}${numbered[2]}`;
}

function getFileBodyStartLineNumber(content: string): number {
	const lines = content.split('\n');
	if (lines[0]?.trim() !== '---') return 0;

	for (let index = 1; index < lines.length; index += 1) {
		if (lines[index]?.trim() !== '---') continue;
		const afterFrontmatter = index + 1;
		return lines[afterFrontmatter]?.trim() === ''
			? afterFrontmatter + 1
			: afterFrontmatter;
	}

	return 0;
}

function isMarkdownFenceLine(line: string): boolean {
	return /^\s*```/.test(line) || /^\s*~~~/.test(line);
}
