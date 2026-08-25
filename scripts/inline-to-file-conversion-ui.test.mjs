import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const handlerStart = mainSource.indexOf('\tprivate async handleCreateFileTaskCommand(');
const handlerEnd = mainSource.indexOf('\n\tprivate async finishNativeFileTaskConversion(', handlerStart);
const handlerSource = mainSource.slice(handlerStart, handlerEnd);

test('cursor inline conversion persists, reindexes, and reacquires the exact task before opening the picker', () => {
	assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
	const persistAt = handlerSource.indexOf('await this.persistInlineEditorBufferAndReindex(file.path);');
	const reacquireAt = handlerSource.indexOf('const refreshedTask = this.indexer.getTask(operonId);');
	const reloadAt = handlerSource.indexOf('const refreshedInlineTask = await this.loadEditableParsedTask(refreshedTask);');
	const pickerAt = handlerSource.indexOf('this.openFileTaskTemplatePicker((selectedTemplate) => {');
	assert.ok(persistAt >= 0 && persistAt < reacquireAt);
	assert.ok(reacquireAt < reloadAt && reloadAt < pickerAt);
	assert.match(
		handlerSource,
		/try \{[\s\S]*?persistInlineEditorBufferAndReindex\(file\.path\)[\s\S]*?catch \(error\)[\s\S]*?inlineToFileTaskFailed/u,
	);
	assert.match(
		handlerSource,
		/refreshedTask\.primary\.format !== 'inline'[\s\S]*?refreshedTask\.primary\.filePath !== file\.path/u,
	);
	assert.match(handlerSource, /refreshedInlineTask\.operonId !== operonId/u);
	assert.match(
		handlerSource,
		/finishInlineTaskToFileTaskConversion\(file, refreshedInlineTask, selectedTemplate\)/u,
	);
});

test('standalone File Task creation remains outside the inline persistence branch', () => {
	const inlineBranchEnd = handlerSource.indexOf('\n\t\tconst sourceSeed =');
	const standaloneBranch = handlerSource.slice(inlineBranchEnd);
	assert.ok(inlineBranchEnd >= 0);
	assert.doesNotMatch(standaloneBranch, /persistInlineEditorBufferAndReindex/u);
	assert.match(standaloneBranch, /createFileTaskFromTemplateSelection/u);
});
