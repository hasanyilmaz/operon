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

test('selection conversion scans the full selected range but only writes converted task lines', () => {
	assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
	assert.match(handlerSource, /lineNumber >= selectedRange\.startLine/u);
	assert.match(handlerSource, /buildSelectedLineOperonTaskConversion\(/u);
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

test('plain bullet and numbered list fallback is not part of selection conversion', () => {
	assert.ok(conversionStart >= 0 && conversionEnd > conversionStart);
	assert.doesNotMatch(conversionSource, /extractMarkdownListItemDescription/u);
	assert.doesNotMatch(conversionSource, /listItemDescription/u);
	assert.match(conversionSource, /if \(checkboxItem\)[\s\S]*?return this\.finalizeBulkConvertedTaskNode\([\s\S]*?\}\n\n\t\treturn \{ kind: 'skipped' \};/u);
});
