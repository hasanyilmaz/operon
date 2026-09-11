import { isValidOperonId } from '../core/id-generator';
import { parseTaskLine } from '../core/parser';
import { isReadableTaskFieldCanonicalKey } from '../core/managed-task-fields';
import { buildReverseMapping } from '../core/yaml-fields';
import type { IndexedTask, ParsedTask } from '../types/fields';
import { resolveWorkflowStatus, type Pipeline } from '../types/pipeline';
import type { KeyMapping } from '../types/settings';

export type ReadingResolvedTaskReason = 'missing-index' | 'stale-index' | 'unsafe-index' | 'invalid-id';

export interface ReadingResolvedTask {
	kind: 'indexed' | 'parsed-snapshot';
	task: IndexedTask;
	parsedTask?: ParsedTask;
	readOnly: boolean;
	needsReindex: boolean;
	reason?: ReadingResolvedTaskReason;
}

export interface ReadingSectionInlineTaskResolution {
	lineTasks: Map<number, ReadingResolvedTask | null>;
	orderedTasks: Array<ReadingResolvedTask | null>;
	sawTaskLine: boolean;
	needsReindex: boolean;
}

export function extractReadingTaskOperonId(text: string, keyMappings: KeyMapping[] = []): string | null {
	return extractReadingTaskIdentities(text, keyMappings).find(isValidOperonId) ?? null;
}

/** Compare displayed source identity without granting indexed mutation authority. */
export function extractReadingTaskDisplayId(text: string, keyMappings: KeyMapping[] = []): string | null {
	return extractReadingTaskIdentities(text, keyMappings)[0] ?? null;
}

function extractReadingTaskIdentities(text: string, keyMappings: KeyMapping[]): string[] {
	const identities: string[] = [];
	const reverseMap = buildReverseMapping(keyMappings);
	const fieldRegex = /\{\{\s*([^{}]+?)\s*::\s*([^{}]*?)\s*\}\}/gu;
	let match: RegExpExecArray | null;
	while ((match = fieldRegex.exec(text)) !== null) {
		const sourceKey = match[1].trim();
		const canonicalKey = reverseMap.get(sourceKey) ?? sourceKey;
		if (canonicalKey !== 'operonId') continue;
		const value = match[2].trim();
		identities.push(value);
	}
	return identities;
}

export function resolveReadingInlineTaskFromText(
	text: string,
	sourcePath: string,
	getTask: (operonId: string) => IndexedTask | null | undefined,
	keyMappings: KeyMapping[] = [],
): IndexedTask | null {
	const operonId = extractReadingTaskOperonId(text, keyMappings);
	if (!operonId) return null;

	const task = getTask(operonId);
	if (!task || task.primary.format !== 'inline' || task.primary.filePath !== sourcePath) {
		return null;
	}
	return task;
}

export function resolveReadingSectionInlineTasks(
	sectionText: string,
	sectionLineStart: number,
	sourcePath: string,
	getTask: (operonId: string) => IndexedTask | null | undefined,
	keyMappings: KeyMapping[] = [],
	pipelines: Pipeline[] = [],
): ReadingSectionInlineTaskResolution {
	const lineTasks = new Map<number, ReadingResolvedTask | null>();
	const orderedTasks: Array<ReadingResolvedTask | null> = [];
	let sawTaskLine = false;
	let needsReindex = false;
	let inFencedCodeBlock = false;

	for (const [offset, lineText] of sectionText.split('\n').entries()) {
		if (isMarkdownFenceLine(lineText)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (inFencedCodeBlock) continue;

		const lineNumber = sectionLineStart + offset;
		const parsed = parseTaskLine(lineText, lineNumber, sourcePath, keyMappings);
		if (!parsed) continue;

		sawTaskLine = true;
		if (!parsed.operonId || !isValidOperonId(parsed.operonId)) {
			// Keep plain checkboxes native. Metadata tasks retain their exact source
			// locator for explicit ID repair; never resolve an invalid ID via the index.
			const resolved: ReadingResolvedTask | null = parsed.fields.length > 0 ? {
				kind: 'parsed-snapshot',
				task: buildReadingDisplaySnapshot(parsed, keyMappings, pipelines),
				parsedTask: parsed,
				readOnly: true,
				needsReindex: false,
				reason: 'invalid-id',
			} : null;
			lineTasks.set(lineNumber, resolved);
			orderedTasks.push(resolved);
			continue;
		}

		const indexed = getTask(parsed.operonId);
		const resolved = resolveReadingParsedTask(parsed, indexed, keyMappings, pipelines);
		if (resolved?.needsReindex) needsReindex = true;
		lineTasks.set(lineNumber, resolved);
		orderedTasks.push(resolved);
	}

	return { lineTasks, orderedTasks, sawTaskLine, needsReindex };
}

function isMarkdownFenceLine(line: string): boolean {
	return /^\s*(?:`{3,}|~{3,})/.test(line);
}

export function createIndexedReadingResolvedTask(
	task: IndexedTask,
	parsedTask?: ParsedTask,
): ReadingResolvedTask {
	return {
		kind: 'indexed',
		task,
		parsedTask,
		readOnly: false,
		needsReindex: false,
	};
}

function resolveReadingParsedTask(
	parsed: ParsedTask,
	indexed: IndexedTask | null | undefined,
	keyMappings: KeyMapping[],
	pipelines: Pipeline[],
): ReadingResolvedTask | null {
	if (!parsed.operonId || !isValidOperonId(parsed.operonId)) return null;
	const snapshot = buildReadingParsedTaskSnapshot(parsed, keyMappings, pipelines, indexed);
	if (!snapshot) return null;
	if (
		indexed
		&& indexed.primary.format === 'inline'
		&& indexed.primary.filePath === parsed.filePath
		&& indexed.primary.lineNumber === parsed.lineNumber
	) {
		if (readingSnapshotMatchesIndexedTask(snapshot, indexed)) {
			return createIndexedReadingResolvedTask(indexed, parsed);
		}
		return {
			kind: 'parsed-snapshot',
			task: snapshot,
			parsedTask: parsed,
			readOnly: true,
			needsReindex: true,
			reason: 'stale-index',
		};
	}

	return {
		kind: 'parsed-snapshot',
		task: snapshot,
		parsedTask: parsed,
		readOnly: true,
		needsReindex: true,
		reason: resolveSnapshotReason(parsed, indexed),
	};
}

function readingSnapshotMatchesIndexedTask(snapshot: IndexedTask, indexed: IndexedTask): boolean {
	return snapshot.description === indexed.description
		&& snapshot.checkbox === indexed.checkbox
		&& snapshot.datetimeModified === indexed.datetimeModified
		&& areStringArraysEqual(snapshot.tags, indexed.tags)
		&& areStringRecordsEqual(snapshot.fieldValues, indexed.fieldValues);
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function areStringRecordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
	const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
	const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
	if (leftEntries.length !== rightEntries.length) return false;
	return leftEntries.every(([key, value], index) => {
		const rightEntry = rightEntries[index];
		return rightEntry !== undefined && key === rightEntry[0] && value === rightEntry[1];
	});
}

export function buildReadingParsedTaskSnapshot(
	parsed: ParsedTask,
	keyMappings: KeyMapping[] = [],
	pipelines: Pipeline[] = [],
	indexed?: IndexedTask | null,
): IndexedTask | null {
	if (!parsed.operonId || !isValidOperonId(parsed.operonId)) return null;
	return buildReadingDisplaySnapshot(parsed, keyMappings, pipelines, indexed);
}

/** Display-only snapshots do not grant mutation authority or create an index identity. */
function buildReadingDisplaySnapshot(
	parsed: ParsedTask,
	keyMappings: KeyMapping[],
	pipelines: Pipeline[],
	indexed?: IndexedTask | null,
): IndexedTask {
	const fieldValues: Record<string, string> = {};
	const inlineTags = new Set(parsed.tags.map(tag => tag.trim()).filter(Boolean));
	for (const field of parsed.fields) {
		const canonicalKey = field.key;
		if (canonicalKey === 'pinned') continue;
		if (canonicalKey === 'tags') {
			for (const tag of field.value.split(/[;,]/u)) {
				const cleaned = tag.trim().replace(/^#/u, '');
				if (cleaned) inlineTags.add(cleaned);
			}
			continue;
		}
		if (!isReadableTaskFieldCanonicalKey(canonicalKey, keyMappings)) continue;
		fieldValues[canonicalKey] = field.value;
	}

	const workflowState = resolveWorkflowStatus(pipelines, fieldValues['status']);
	let checkbox = parsed.checkbox;
	if (workflowState?.checkbox === 'done' || workflowState?.checkbox === 'cancelled') {
		checkbox = workflowState.checkbox;
	} else if (fieldValues['dateCancelled']) {
		checkbox = 'cancelled';
	} else if (fieldValues['dateCompleted']) {
		checkbox = 'done';
	} else if (workflowState) {
		checkbox = 'open';
	}

	return {
		operonId: parsed.operonId ?? '',
		description: parsed.description,
		checkbox,
		fieldValues,
		tags: Array.from(inlineTags),
		primary: { filePath: parsed.filePath, lineNumber: parsed.lineNumber, format: 'inline' },
		datetimeModified: fieldValues['datetimeModified'] ?? indexed?.datetimeModified ?? '',
		tier: checkbox === 'open' ? 'hot' : 'warm',
		plainCheckboxProgress: indexed?.plainCheckboxProgress,
	};
}

function resolveSnapshotReason(
	parsed: ParsedTask,
	indexed: IndexedTask | null | undefined,
): ReadingResolvedTaskReason {
	if (!indexed) return 'missing-index';
	if (indexed.primary.format !== 'inline' || indexed.primary.filePath !== parsed.filePath) {
		return 'unsafe-index';
	}
	return 'stale-index';
}
