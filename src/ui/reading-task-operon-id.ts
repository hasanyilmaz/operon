import { isValidOperonId } from '../core/id-generator';
import { parseTaskLine } from '../core/parser';
import { buildReverseMapping } from '../core/yaml-fields';
import type { IndexedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';

export interface ReadingSectionInlineTaskResolution {
	lineTasks: Map<number, IndexedTask | null>;
	orderedTasks: Array<IndexedTask | null>;
	sawTaskLine: boolean;
}

export function extractReadingTaskOperonId(text: string, keyMappings: KeyMapping[] = []): string | null {
	const reverseMap = buildReverseMapping(keyMappings);
	const fieldRegex = /\{\{\s*([^{}]+?)\s*::\s*([^{}]*?)\s*\}\}/gu;
	let match: RegExpExecArray | null;
	while ((match = fieldRegex.exec(text)) !== null) {
		const sourceKey = match[1].trim();
		const canonicalKey = reverseMap.get(sourceKey) ?? sourceKey;
		if (canonicalKey !== 'operonId') continue;
		const value = match[2].trim();
		if (isValidOperonId(value)) return value;
	}
	return null;
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
): ReadingSectionInlineTaskResolution {
	const lineTasks = new Map<number, IndexedTask | null>();
	const orderedTasks: Array<IndexedTask | null> = [];
	let sawTaskLine = false;
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
		if (!parsed.operonId) {
			lineTasks.set(lineNumber, null);
			orderedTasks.push(null);
			continue;
		}

		const indexed = getTask(parsed.operonId);
		const resolved = indexed
			&& indexed.primary.format === 'inline'
			&& indexed.primary.filePath === sourcePath
			&& indexed.primary.lineNumber === lineNumber
			? indexed
			: null;
		lineTasks.set(lineNumber, resolved);
		orderedTasks.push(resolved);
	}

	return { lineTasks, orderedTasks, sawTaskLine };
}

function isMarkdownFenceLine(line: string): boolean {
	return /^\s*(?:`{3,}|~{3,})/.test(line);
}
