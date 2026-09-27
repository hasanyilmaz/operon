import type { IndexedTask, ParsedTask } from '../types/fields';
import { normalizeInlineTaskParentFileHeadingKeyword, type KeyMapping } from '../types/settings';
import { markdownBodyStartLine } from './markdown-body';
import { iterateMarkdownLinesOutsideFences } from './markdown-fenced-lines';
import { insertInlineTaskUnderFirstHeadingKeyword, MARKDOWN_HEADING_RE } from './markdown-heading-insertion';
import { measureMarkdownIndent } from './markdown-list-items';
import { collectPlainCheckboxLines, collectScopedPlainCheckboxMoveLines, parseOperonTaskLineCandidate } from './plain-checkbox-lines';
import { indentNewInlineSubtask, resolveInlineParentInsertionLineNumber } from './task-creator-target-resolver';

type PlacementTask = Pick<IndexedTask, 'operonId' | 'primary' | 'fieldValues'>;

export interface InlineParentPlacementWrite {
	filePath: string;
	expectedContent: string;
	nextContent: string;
}

export type InlineParentPlacementPlan =
	| { kind: 'not-needed' }
	| { kind: 'blocked'; reason: 'source-changed' | 'parent-unavailable' | 'duplicate-task' | 'unsafe-placement' }
	| {
		kind: 'move';
		/** Destination first; a same-file move is exactly one write. */
		writes: InlineParentPlacementWrite[];
		target: { filePath: string; lineNumber: number };
	};

export interface InlineParentPlacementInput {
	enabled: boolean;
	task: PlacementTask;
	sourceContent: string;
	/** The existing guarded writer/editor has already applied the complete user edit. */
	updatedSourceContent: string;
	/** Caller resolves a unique parent and validates its source identity before commit. */
	parentTask: IndexedTask | null;
	/** Required for a different parent file; unused for a same-file move. */
	parentContent?: string;
	keyMappings: KeyMapping[];
	headingKeyword: string;
}

/** No I/O, relationship traversal, settings persistence, or mutation callbacks. */
export function planInlineTaskParentPlacement(input: InlineParentPlacementInput): InlineParentPlacementPlan {
	const { task, keyMappings } = input;
	if (!input.enabled || task.primary.format !== 'inline') return { kind: 'not-needed' };
	const sourcePath = task.primary.filePath;
	const before = inlineTasks(input.sourceContent, sourcePath, keyMappings).filter(item => item.operonId === task.operonId);
	const updated = inlineTasks(input.updatedSourceContent, sourcePath, keyMappings).filter(item => item.operonId === task.operonId);
	if (before.length > 1 || updated.length > 1) return { kind: 'blocked', reason: 'duplicate-task' };
	if (before.length !== 1 || updated.length !== 1) return { kind: 'blocked', reason: 'source-changed' };
	const parentId = updated[0].fields.find(field => field.key === 'parentTask')?.value.trim() ?? '';
	if (!parentId) return { kind: 'not-needed' };
	const previousParentId = task.fieldValues['parentTask']?.trim() ?? '';
	if ((before[0].fields.find(field => field.key === 'parentTask')?.value.trim() ?? '') !== previousParentId) {
		return { kind: 'blocked', reason: 'source-changed' };
	}
	const parent = input.parentTask;
	if (!parent || parent.operonId !== parentId || parentId === task.operonId) {
		return { kind: 'blocked', reason: 'parent-unavailable' };
	}
	const sameFile = sourcePath === parent.primary.filePath;
	if (sameFile && parentId === previousParentId) return { kind: 'not-needed' };
	if (!sameFile && input.parentContent === undefined) return { kind: 'blocked', reason: 'parent-unavailable' };

	const sourceLines = input.updatedSourceContent.split('\n');
	const taskLine = updated[0].lineNumber;
	const checkboxes = collectScopedPlainCheckboxMoveLines(input.updatedSourceContent, sourcePath, keyMappings,
		{ kind: 'inline', operonId: task.operonId }, taskLine);
	const removed = new Set([taskLine, ...checkboxes.map(item => item.lineNumber)]);
	const remainingContent = sourceLines.filter((_, index) => !removed.has(index)).join('\n');
	const targetPath = parent.primary.filePath;
	const targetContent = sameFile ? remainingContent : input.parentContent!;
	const targetTasks = inlineTasks(targetContent, targetPath, keyMappings);
	if (targetTasks.some(item => item.operonId === task.operonId)) return { kind: 'blocked', reason: 'duplicate-task' };
	let targetLines = targetContent.split('\n');
	let insertionLine: number;
	let placedTaskLine: string;

	if (parent.primary.format === 'inline') {
		const parents = targetTasks.filter(item => item.operonId === parentId);
		if (parents.length > 1) return { kind: 'blocked', reason: 'duplicate-task' };
		if (parents.length !== 1) return { kind: 'blocked', reason: 'parent-unavailable' };
		const tasksByLine = new Map(targetTasks.map(item => [item.lineNumber, item]));
		// Resolve again after removal: both an editor draft and a same-file move can shift the parent.
		const anchor = resolveInlineParentInsertionLineNumber({ content: targetContent, parentTask: parent,
			parseInlineTaskLine: (_, lineNumber) => tasksByLine.get(lineNumber) ?? null });
		if (anchor === null) return { kind: 'blocked', reason: 'parent-unavailable' };
		const parentCheckboxes = collectScopedPlainCheckboxMoveLines(targetContent, targetPath, keyMappings,
			{ kind: 'inline', operonId: parentId }, anchor - 1);
		insertionLine = parentCheckboxes.length ? parentCheckboxes[parentCheckboxes.length - 1].lineNumber + 1 : anchor;
		placedTaskLine = indentNewInlineSubtask(targetLines[anchor - 1], sourceLines[taskLine]);
	} else {
		const heading = fileParentInsertion(targetContent, targetPath, keyMappings, input.headingKeyword, targetTasks);
		if (!heading) return { kind: 'blocked', reason: 'unsafe-placement' };
		targetLines = heading.lines;
		insertionLine = heading.lineNumber;
		placedTaskLine = sourceLines[taskLine].replace(/^[\t ]*/u, '');
	}

	const oldIndent = measureMarkdownIndent(sourceLines[taskLine]);
	const newIndent = measureMarkdownIndent(placedTaskLine);
	// An attached checkbox may be outdented relative to its owner. Shift the whole
	// checkbox group equally rather than flattening its internal nesting.
	const checkboxDelta = checkboxes.reduce((delta, item) => Math.max(delta, -measureMarkdownIndent(item.rawLine)), newIndent - oldIndent);
	const movedCheckboxes = checkboxes.map(item => shiftIndent(item.rawLine, checkboxDelta));
	const nextTarget = targetLines.slice(0, insertionLine).concat(placedTaskLine, movedCheckboxes, targetLines.slice(insertionLine)).join('\n');
	// Reuse the same owner calculation as Task Editor, including non-adjacent checkboxes.
	const actualCheckboxes = collectPlainCheckboxLines(nextTarget, targetPath, keyMappings, { kind: 'inline', operonId: task.operonId });
	if (actualCheckboxes.length !== movedCheckboxes.length
		|| actualCheckboxes.some((item, index) => item.rawLine !== movedCheckboxes[index])) {
		return { kind: 'blocked', reason: 'unsafe-placement' };
	}
	if (sameFile && nextTarget === input.updatedSourceContent) return { kind: 'not-needed' };
	return {
		kind: 'move',
		writes: sameFile
			? [{ filePath: sourcePath, expectedContent: input.sourceContent, nextContent: nextTarget }]
			: [{ filePath: targetPath, expectedContent: input.parentContent!, nextContent: nextTarget },
				{ filePath: sourcePath, expectedContent: input.sourceContent, nextContent: remainingContent }],
		target: { filePath: targetPath, lineNumber: insertionLine },
	};
}

function inlineTasks(content: string, filePath: string, keyMappings: KeyMapping[]): ParsedTask[] {
	const bodyStart = markdownBodyStartLine(content.split('\n'));
	if (bodyStart === null) return [];
	const tasks: ParsedTask[] = [];
	for (const [lineNumber, line] of iterateMarkdownLinesOutsideFences(content)) {
		if (lineNumber < bodyStart) continue;
		const task = parseOperonTaskLineCandidate(line, lineNumber, filePath, keyMappings);
		if (task?.operonId) tasks.push(task);
	}
	return tasks;
}

function fileParentInsertion(content: string, filePath: string, keyMappings: KeyMapping[], keyword: string,
	tasks: ParsedTask[]): { lines: string[]; lineNumber: number } | null {
	const lines = content.split('\n');
	const bodyStart = markdownBodyStartLine(lines);
	if (bodyStart === null) return null;
	const visible = new Map([...iterateMarkdownLinesOutsideFences(content)].filter(([index]) => index >= bodyStart));
	const normalized = normalizeInlineTaskParentFileHeadingKeyword(keyword);
	// Mask protected lines without changing offsets; the existing matcher chooses the first keyword heading.
	const preview = insertInlineTaskUnderFirstHeadingKeyword(lines.map((line, index) => visible.has(index) ? line : '').join('\n'), normalized, '');
	if (preview.headingWasCreated) {
		// An unclosed fence cannot receive a new Markdown heading.
		if (!new Map(iterateMarkdownLinesOutsideFences(`${content}\n`)).has(lines.length)) return null;
		if (lines[lines.length - 1]?.trim()) lines.push('');
		lines.push(`## ${normalized}`);
		return { lines, lineNumber: lines.length };
	}
	const headingLine = preview.headingLineNumber;
	const headingLevel = MARKDOWN_HEADING_RE.exec(lines[headingLine].trim())![1].length;
	const sectionEnd = [...visible].find(([index, line]) => index > headingLine
		&& (MARKDOWN_HEADING_RE.exec(line.trim())?.[1].length ?? Infinity) <= headingLevel)?.[0] ?? lines.length;
	const anchor = headingLine + 1;
	const nextTask = tasks.find(task => task.lineNumber >= anchor)?.lineNumber ?? lines.length;
	const existingCheckboxes = collectPlainCheckboxLines(content, filePath, keyMappings, { kind: 'file' })
		.filter(item => item.lineNumber >= anchor && item.lineNumber < nextTask);
	const lineNumber = existingCheckboxes.length ? existingCheckboxes[existingCheckboxes.length - 1].lineNumber + 1 : anchor;
	return lineNumber <= sectionEnd ? { lines, lineNumber } : null;
}

function shiftIndent(line: string, delta: number): string {
	if (delta >= 0) return ' '.repeat(delta) + line;
	const indent = measureMarkdownIndent(line);
	return ' '.repeat(Math.max(0, indent + delta)) + line.replace(/^[\t ]*/u, '');
}
