import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const mainSource = read('main.ts');
const finderSource = read('src/ui/task-finder-integrations.ts');
const writerSource = read('src/core/task-writer.ts');

test('global command is localized and opens the dedicated all-task Task Finder scope', () => {
	assert.match(mainSource, /id: 'convert-task-to-plain',\s*name: t\('commands', 'convertTaskToPlain'\),\s*callback:/u);
	assert.match(mainSource, /promptTaskFinderSelection\([\s\S]*?TASK_FINDER_SCOPE_CONVERT_TASK_TO_PLAIN/u);
	assert.match(
		finderSource,
		/TASK_FINDER_SCOPE_CONVERT_TASK_TO_PLAIN[\s\S]*?showRecentModified: false,[\s\S]*?includeInline: true,[\s\S]*?includeFile: true,[\s\S]*?includeCancelled: true,[\s\S]*?includeFinished: true/u,
	);
});

test('command flow re-resolves identity, checks blockers, and blocks every dirty open source buffer', () => {
	assert.match(mainSource, /if \(this\.isTaskEditorModalOpen\(\)\)[\s\S]*?convertToPlainCloseTaskEditor/u);
	assert.match(mainSource, /getWorkspaceWindows\(this\.app\)\.some\(ownerWindow/u);
	assert.match(mainSource, /getFreshTaskForPlainConversion\(selectedTask\.operonId\)/u);
	assert.match(mainSource, /hasDuplicateOperonIdConflict\(operonId\)/u);
	assert.match(mainSource, /getConvertToPlainBlockers\(task\)/u);
	assert.match(mainSource, /getMarkdownViewsForPath\(file\.path\)/u);
	assert.match(mainSource, /views\.some\(view => view\.editor\.getValue\(\) !== content\)/u);
	assert.match(mainSource, /convertToPlainSourceDirty/u);
	assert.match(mainSource, /forceReindexKnownFileAfterMutation\(file, \{ notify: false \}, content\)/u);
});

test('blocker gate covers hierarchy, both dependency directions, timer, recurrence, and reminders', () => {
	const start = mainSource.indexOf('\tprivate getConvertToPlainBlockers(');
	const end = mainSource.indexOf('\n\tprivate showConvertToPlainBlockers(', start);
	const source = mainSource.slice(start, end);
	assert.ok(start >= 0 && end > start);
	assert.match(source, /fieldValues\['parentTask'\]/u);
	assert.match(source, /secondary\.getChildIds\(task\.operonId\)/u);
	assert.match(source, /fieldValues\['blocking'\]/u);
	assert.match(source, /fieldValues\['blockedBy'\]/u);
	assert.match(source, /timeTracker\.isTimerRunning\(task\.operonId\)/u);
	assert.match(source, /fieldValues\['repeat'\][\s\S]*?fieldValues\['repeatSeriesId'\][\s\S]*?fieldValues\['repeatOccurrenceDate'\]/u);
	assert.match(source, /parseListValue\(task\.fieldValues\['reminderDatetimes'\] \?\? ''\)/u);
	assert.match(source, /parseListValue\(task\.fieldValues\['reminderRules'\] \?\? ''\)/u);
});

test('inline branch confirms then commits through whole-source atomic CAS without Task Editor save', () => {
	const start = mainSource.indexOf('\tprivate async convertInlineTaskToPlainFromCommand(');
	const end = mainSource.indexOf('\n\tprivate openConvertToPlainFileCommandModal(', start);
	const source = mainSource.slice(start, end);
	assert.ok(start >= 0 && end > start);
	assert.match(source, /new ConfirmActionModal/u);
	assert.match(source, /danger: true,[\s\S]*?initialFocus: 'cancel'/u);
	assert.match(source, /planInlineTaskToPlain\(/u);
	assert.match(source, /applyExactMarkdownSourceMutation\(/u);
	assert.doesNotMatch(source, /TaskEditor|replaceInlineTaskById|persistMarkdownViewBuffer|MarkdownView\.save/u);
});

test('atomic writer compares the full source inside vault.process and aborts stale writes', () => {
	const start = writerSource.indexOf('    async applyExactMarkdownSourceMutation(');
	const end = writerSource.indexOf('\n    /**', start + 10);
	const source = writerSource.slice(start, end);
	assert.ok(start >= 0 && end > start);
	assert.match(source, /this\.app\.vault\.process\(file, currentContent => \{/u);
	assert.match(source, /if \(currentContent !== expectedContent \|\| \(guard && !guard\(\)\)\)/u);
	assert.match(source, /throw EXACT_MARKDOWN_SOURCE_MUTATION_ABORT/u);
});

test('conversion serializes timer transitions and task-source writes through a narrow exclusive lease', () => {
	assert.match(mainSource, /timeTracker\.runWithTransitionLock\(async \(\) =>/u);
	assert.match(mainSource, /writer\.runExclusiveTaskMutation\(async permit =>/u);
	assert.match(mainSource, /applyExactMarkdownSourceMutation\([\s\S]*?mutationGuard,[\s\S]*?permit/u);
	assert.match(mainSource, /detachYamlTaskProperties\([\s\S]*?mutationGuard,[\s\S]*?permit/u);
	assert.match(writerSource, /class TaskWriterMutationGate/u);
	assert.match(writerSource, /permit\?\.token === this\.activeExclusiveMutationToken/u);
	assert.match(writerSource, /activeSharedMutationTokens\.has\(permit\.token\)/u);
});

test('file branch reuses the picker and atomic YAML cleanup while retaining failed submissions', () => {
	assert.match(mainSource, /new ConvertToPlainFileModal\(this\.app/u);
	assert.match(mainSource, /getPlainFileTaskPropertyCatalog\(initial\.task\.operonId\)/u);
	assert.match(mainSource, /detachYamlTaskProperties\([\s\S]*?selectedCanonicalKeys/u);
	assert.match(mainSource, /if \(result\.outcome !== 'detached'[\s\S]*?return false;/u);
});

test('post-commit view divergence attempts exact rollback before authoritative completion', () => {
	assert.match(mainSource, /private async syncPlainConversionOpenViews\(/u);
	assert.match(mainSource, /applyExactMarkdownSourceMutation\([\s\S]*?committedContent,[\s\S]*?expectedContent/u);
	assert.match(mainSource, /return 'rolled-back'/u);
	assert.match(mainSource, /persistedContent === committedContent\)[\s\S]*?const retry = await this\.writer\.applyExactMarkdownSourceMutation/u);
	assert.match(mainSource, /if \(retry\.outcome === 'committed'\)[\s\S]*?return 'rolled-back';[\s\S]*?return 'unknown';/u);
	assert.match(mainSource, /persistedContent === expectedContent\) return 'rolled-back'/u);
	assert.match(mainSource, /restored\?\.primary\.filePath === file\.path\) return 'rolled-back'/u);
	assert.match(mainSource, /return 'unknown'/u);
});
