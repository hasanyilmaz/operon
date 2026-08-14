import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const modalSource = read('src/ui/tracker-session-edit-modal.ts');
const noteSource = read('src/ui/task-note-action.ts');
const taskEditorSource = read('src/ui/task-editor-content.ts');
const tableSource = read('src/ui/table/operon-table-view.ts');
const embedSource = read('src/ui/embed-table-processor.ts');
const historySource = read('src/ui/time-session-history-view.ts');
const mainSource = read('main.ts');
const styles = read('styles.css');

test('session modal keeps one right-aligned Note, Cancel, Save action order', () => {
	const noteIndex = modalSource.indexOf("cls: 'operon-tracker-session-modal-note'");
	const cancelIndex = modalSource.indexOf("cls: 'operon-tracker-session-modal-cancel'");
	const saveIndex = modalSource.indexOf("cls: 'operon-tracker-session-modal-save'");
	assert.ok(noteIndex > 0 && noteIndex < cancelIndex && cancelIndex < saveIndex);
	assert.match(modalSource, /taskNote: TrackerSessionTaskNoteOptions;/u);
	assert.match(modalSource, /setAccessibleLabelWithoutTooltip\(noteButton, t\('taskEditor', 'notes'\)\)/u);
	assert.match(modalSource, /bindOperonHoverTooltip\(noteButton,/u);
	assert.match(modalSource, /setIcon\(noteButton, this\.options\.taskNote\.icon \|\| 'notebook-pen'\)/u);
});

test('session modal delegates note editing to the canonical task-note popover', () => {
	assert.match(modalSource, /showTaskNotePopover\(\{/u);
	assert.match(modalSource, /operonId: this\.options\.taskNote\.operonId/u);
	assert.match(modalSource, /sourcePath: this\.options\.taskNote\.sourcePath/u);
	assert.match(modalSource, /lifecycleOwner: contentEl/u);
	assert.match(modalSource, /if \(result !== false\) currentNoteValue = value;/u);
	assert.match(modalSource, /if \(noteButton\.isConnected\) noteButton\.focus\(\)/u);
	assert.match(noteSource, /allowEmptyCommit: true/u);
	assert.match(noteSource, /sessionKey: `task-text:\$\{operonId\}:note`/u);
	assert.match(modalSource, /requestCloseAndWait\(\)/u);
	assert.match(modalSource, /if \(!await this\.closeOwnedTaskNotePopover\(\)\) \{[\s\S]*?this\.resetModalAction\(\);/u);
});

test('Add and Edit callers provide exact task-note persistence context', () => {
	assert.equal((taskEditorSource.match(/taskNote: this\.buildTrackerSessionTaskNoteOptions\(/gu) ?? []).length, 2);
	assert.equal((tableSource.match(/taskNote: this\.buildTrackerSessionTaskNoteOptions\(/gu) ?? []).length, 2);
	assert.equal((embedSource.match(/taskNote: buildEmbedTrackerSessionTaskNoteOptions\(/gu) ?? []).length, 2);
	assert.equal((historySource.match(/taskNote: \{/gu) ?? []).length, 1);
	assert.equal((mainSource.match(/taskNote: \{/gu) ?? []).length, 1);
	assert.match(taskEditorSource, /const outcome = await this\.flushPendingEditsOutcome\('explicit-save'\);/u);
	assert.doesNotMatch(taskEditorSource, /if \(value === previous\) return true;/u);
	assert.match(taskEditorSource, /this\.noteInputEl\.value = value;/u);
	assert.match(tableSource, /onUpdateTaskFields\?\.\(task\.operonId, \{ note: value \}\)/u);
	assert.match(embedSource, /updateTaskFields\?\.\(task\.operonId, \{ note: value \}\)/u);
	assert.match(historySource, /updateTaskFields\(session\.operonId, \{ note: value \}\)/u);
	assert.match(mainSource, /updateTaskFields: \(operonId, payload\) => this\.updateTableTaskFieldsAndRefresh\(operonId, payload\)/u);
});

test('footer geometry keeps Add right aligned and Edit delete isolated on the left', () => {
	assert.match(styles, /\.operon-tracker-session-modal-actions \{[\s\S]*?flex-wrap: wrap;/u);
	assert.match(styles, /\.operon-tracker-session-modal-actions-primary \{[\s\S]*?margin-inline-start: auto;/u);
	assert.match(styles, /button\.operon-tracker-session-modal-note \{[\s\S]*?width: 34px;[\s\S]*?min-width: 34px;/u);
	assert.match(styles, /button:is\([\s\S]*?\.operon-tracker-session-modal-note,[\s\S]*?\):is\(:hover, :focus-visible\)/u);
	assert.ok(modalSource.indexOf("cls: 'operon-tracker-session-modal-delete'") < modalSource.indexOf("const primaryActions = actions.createDiv"));
});

test('session Save and Delete lifecycle remains independent from note persistence', () => {
	assert.match(modalSource, /if \(!this\.beginModalAction\(\)\) return;/u);
	assert.equal((modalSource.match(/if \(!await this\.closeOwnedTaskNotePopover\(\)\)/gu) ?? []).length, 2);
	assert.match(modalSource, /this\.closeImmediately\(\);[\s\S]*?this\.options\.onSave\(start, end\)/u);
	assert.ok(modalSource.indexOf('if (!await this.closeOwnedTaskNotePopover())') < modalSource.indexOf('this.options.onSave(start, end)'));
	assert.ok(modalSource.lastIndexOf('if (!await this.closeOwnedTaskNotePopover())') < modalSource.indexOf('result = await this.options.onDelete?.()'));
	assert.match(modalSource, /result = await this\.options\.onDelete\?\.\(\);/u);
	assert.match(modalSource, /if \(result === false\) \{[\s\S]*?this\.resetModalAction\(\);/u);
	assert.match(modalSource, /noteButton\.disabled = disabled;/u);
});
