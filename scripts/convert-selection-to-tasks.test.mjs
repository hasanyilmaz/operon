import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

const handlerStart = mainSource.indexOf('\tprivate async handleConvertSelectionToOperonTasksCommand(');
const handlerEnd = mainSource.indexOf('\n\tprivate applyBulkSelectionLineChanges(', handlerStart);
const handlerSource = mainSource.slice(handlerStart, handlerEnd);

const conversionStart = mainSource.indexOf('\tprivate buildSelectedLineOperonTaskConversion(');
const conversionEnd = mainSource.indexOf('\n\tprivate finalizeBulkConvertedTaskNode(', conversionStart);
const conversionSource = mainSource.slice(conversionStart, conversionEnd);

const commandStart = mainSource.indexOf("\t\t\tthis.addCommand({\n\t\t\t\tid: 'convert-selection-to-tasks'");
const commandEnd = mainSource.indexOf("\n\t\t\t// Standalone file-task creation", commandStart);
const commandSource = mainSource.slice(commandStart, commandEnd);

test('selection conversion scans the full selected range but only writes converted lines', () => {
	assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
	assert.match(handlerSource, /lineNumber >= selectedRange\.startLine/u);
	assert.match(handlerSource, /buildSelectedLineOperonTaskConversion\(/u);
	assert.match(handlerSource, /includePlainListItems: options\.includePlainListItems/u);
	assert.match(handlerSource, /if \(result\.kind === 'converted'\)[\s\S]*?changes\.push\(/u);
	assert.doesNotMatch(handlerSource, /changes\.push\([\s\S]*?result\.kind === 'skipped'/u);
});

test('selection conversion keeps existing task conversion paths', () => {
	assert.ok(conversionStart >= 0 && conversionEnd > conversionStart);
	assert.match(conversionSource, /convertTasksEmojiLineToOperon\(/u);
	assert.match(conversionSource, /tasksEmojiConversion\.kind === 'converted'/u);
	assert.match(conversionSource, /extractMarkdownCheckboxListItem\(options\.line\)/u);
	assert.match(conversionSource, /existingParsed\?\.operonId/u);
	assert.match(conversionSource, /finalizeBulkConvertedTaskNode\(/u);
});

test('existing selection command keeps converting plain bullet and numbered list items', () => {
	assert.ok(commandStart >= 0 && commandEnd > commandStart);
	assert.match(
		commandSource,
		/id: 'convert-selection-to-tasks'[\s\S]*?includePlainListItems: true/u,
	);
	assert.match(conversionSource, /extractMarkdownListItemDescription\(options\.line\)/u);
	assert.match(conversionSource, /listItemDescription/u);
});

test('task-only selection command uses the same conversion flow without plain list fallback', () => {
	assert.ok(commandStart >= 0 && commandEnd > commandStart);
	assert.match(
		commandSource,
		/id: 'convert-task-lines-in-selection-to-tasks'[\s\S]*?name: 'Convert Task Lines in Selection to Operon Tasks'[\s\S]*?includePlainListItems: false/u,
	);
	assert.match(
		conversionSource,
		/if \(!options\.includePlainListItems\) return \{ kind: 'skipped' \};[\s\S]*?extractMarkdownListItemDescription/u,
	);
});
