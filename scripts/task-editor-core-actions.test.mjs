import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const taskEditorSource = read('src/ui/task-editor-content.ts');
const styles = read('styles.css');
const settingsTypesSource = read('src/types/settings.ts');
const mainSource = read('main.ts');
const convertFileModalSource = read('src/ui/convert-to-plain-file-modal.ts');
const coreActionsSource = taskEditorSource.slice(
	taskEditorSource.indexOf('\tprivate renderCoreActionButtons('),
	taskEditorSource.indexOf('\n\tprivate async openTaskEditorCheckboxPopover('),
);

test('Task Editor subtask action stays icon-only with its localized accessible label and Operon tooltip', () => {
	assert.ok(coreActionsSource.length > 0, 'Task Editor core actions source should be discoverable');
	assert.match(
		coreActionsSource,
		/const subtaskLabel = t\('buttons', resolveSubtaskActionLabelKeyForKind\(this\.subtaskActionKind\)\);/u,
	);
	assert.match(
		coreActionsSource,
		/cls: 'operon-editor-core-action-btn operon-editor-core-subtask-action'/u,
	);
	assert.match(
		coreActionsSource,
		/getIcon\(resolveSubtaskActionIconForKind\(this\.subtaskActionKind\)\)/u,
	);
	assert.match(coreActionsSource, /setAccessibleLabelWithoutTooltip\(subtaskBtn, subtaskLabel\);/u);
	assert.match(coreActionsSource, /this\.bindTaskEditorTooltip\(subtaskBtn, subtaskLabel\);/u);
	assert.doesNotMatch(coreActionsSource, /subtaskBtn\.createSpan/u);
});

test('Task Editor subtask action uses the compact icon-button geometry', () => {
	assert.match(
		styles,
		/\.operon-editor-core-checkbox-popover-action,[\s\S]*?\.operon-editor-core-subtask-action,[\s\S]*?\.operon-editor-core-convert-to-plain-action,[\s\S]*?width: 34px;\s*padding: 0;\s*\}/u,
	);
});

test('Task Editor keeps Remove behavior separate while making Remove and conversion icon-only', () => {
	const removeControl = taskEditorSource.slice(
		taskEditorSource.indexOf('\tprivate renderRemoveControl('),
		taskEditorSource.indexOf('\n\tprivate getConvertToPlainLabel('),
	);
	const removeHandler = taskEditorSource.slice(
		taskEditorSource.indexOf('\tprivate async handleRemoveTaskClick('),
		taskEditorSource.indexOf('\n\tprivate renderIconControl('),
	);
	assert.match(removeControl, /operon-editor-core-convert-to-plain-action/u);
	assert.match(removeControl, /getIcon\('unlink'\)/u);
	assert.match(removeControl, /setAccessibleLabelWithoutTooltip\(convertButton, convertLabel\);/u);
	assert.match(removeControl, /this\.bindTaskEditorTooltip\(convertButton, convertLabel\);/u);
	assert.match(removeControl, /setAccessibleLabelWithoutTooltip\(button, t\('buttons', 'remove'\)\);/u);
	assert.match(removeControl, /this\.bindTaskEditorTooltip\(button, t\('buttons', 'remove'\)\);/u);
	assert.doesNotMatch(removeControl, /button\.createSpan/u, 'Remove must not regain visible button text');
	assert.match(removeHandler, /await this\.onRequestDelete\(this\.existingTask\)/u);
	assert.match(removeHandler, /this\.requestEditorClose\('force-after-delete'\)/u);
});

test('Task Editor conversion has format-specific labels and stays immediately before mobile Remove', () => {
	assert.match(taskEditorSource, /\? t\('taskEditor', 'convertToPlainFile'\)\s*:\s*t\('taskEditor', 'convertToPlainCheckbox'\)/u);
	assert.match(taskEditorSource, /case '__convertToPlain':[\s\S]*?this\.renderMobileConvertToPlainButton\(container\);/u);
	assert.match(settingsTypesSource, /'dateCancelled',\s*'__convertToPlain',\s*'remove'/u);
	assert.match(settingsTypesSource, /const convertToPlain = items\.find\(item => item\.key === '__convertToPlain'\);/u);
	assert.match(settingsTypesSource, /\.\.\.\(convertToPlain \? \[convertToPlain\] : \[\]\),\s*\.\.\.\(last \? \[last\] : \[\]\)/u);
});

test('Task Editor conversion uses the live inline buffer and verifies editor persistence before cleanup', () => {
	assert.match(mainSource, /const openView = this\.getMarkdownViewForPath\(task\.primary\.filePath\);/u);
	assert.match(mainSource, /if \(openView\) \{\s*content = openView\.editor\.getValue\(\);/u);
	assert.match(mainSource, /\{ expectedTaskLine: sourceTask\.rawLine, retryEditorSave: true \}/u);
	assert.match(mainSource, /retryInlineEditorSave\(\{/u);
	assert.match(mainSource, /if \(!options\.retryEditorSave\) \{/u);
	assert.match(mainSource, /private async finishTaskEditorPlainConversion\(/u);
	assert.match(mainSource, /converted task source but immediate reindex failed/u);
	assert.match(mainSource, /converted task source but automatic unpin failed/u);
	assert.match(
		styles,
		/\.operon-editor-terminal-action-cluster > \.operon-editor-core-action-btn \{\s*width: 34px;\s*min-width: 34px;\s*height: 34px;\s*min-height: 34px;/u,
	);
});

test('File conversion modal locks every interactive control while its single apply is pending', () => {
	assert.match(convertFileModalSource, /if \(!this\.completed && !this\.submitting\) this\.options\.onCancel\(\);/u);
	assert.match(convertFileModalSource, /event\.key === 'Escape' && !this\.submitting/u);
	assert.match(convertFileModalSource, /this\.setInteractiveControlsDisabled\(true\);/u);
	assert.match(convertFileModalSource, /this\.setInteractiveControlsDisabled\(false\);/u);
	assert.match(convertFileModalSource, /querySelectorAll<HTMLInputElement \| HTMLButtonElement>\('input, button'\)/u);
	assert.match(convertFileModalSource, /close\(\): void \{\s*if \(this\.submitting && !this\.completed\) return;/u);
});
