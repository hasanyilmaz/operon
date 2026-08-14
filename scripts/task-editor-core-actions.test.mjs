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
		/\.operon-editor-core-checkbox-popover-action,[\s\S]*?\.operon-editor-core-subtask-action,[\s\S]*?width: 34px;\s*padding: 0;\s*\}/u,
	);
});

test('Task Editor keeps its icon-only Remove behavior and contains no conversion action', () => {
	const removeControl = taskEditorSource.slice(
		taskEditorSource.indexOf('\tprivate renderRemoveControl('),
		taskEditorSource.indexOf('\n\tprivate async handleRemoveTaskClick('),
	);
	const removeHandler = taskEditorSource.slice(
		taskEditorSource.indexOf('\tprivate async handleRemoveTaskClick('),
		taskEditorSource.indexOf('\n\tprivate renderIconControl('),
	);
	assert.doesNotMatch(removeControl, /unlink|convertToPlain/u);
	assert.match(removeControl, /setAccessibleLabelWithoutTooltip\(button, t\('buttons', 'remove'\)\);/u);
	assert.match(removeControl, /this\.bindTaskEditorTooltip\(button, t\('buttons', 'remove'\)\);/u);
	assert.doesNotMatch(removeControl, /button\.createSpan/u, 'Remove must not regain visible button text');
	assert.match(removeHandler, /await this\.onRequestDelete\(this\.existingTask\)/u);
	assert.match(removeHandler, /this\.requestEditorClose\('force-after-delete'\)/u);
});

test('Task Editor desktop, mobile, settings, and close lifecycle contain no Convert to Plain route', () => {
	assert.doesNotMatch(taskEditorSource, /__convertToPlain|ConvertToPlain|onConvertToPlain|onInspectConvertToPlain/u);
	assert.doesNotMatch(settingsTypesSource, /__convertToPlain/u);
	assert.doesNotMatch(styles, /operon-editor-core-convert-to-plain-action/u);
	assert.doesNotMatch(read('src/ui/task-editor-modal.ts'), /force-after-convert-to-plain/u);
});

test('Command-only conversion uses direct atomic source mutation and never Task Editor persistence', () => {
	assert.match(mainSource, /id: 'convert-task-to-plain'/u);
	assert.match(mainSource, /TASK_FINDER_SCOPE_CONVERT_TASK_TO_PLAIN/u);
	assert.match(mainSource, /applyExactMarkdownSourceMutation\(/u);
	assert.match(mainSource, /private async finishPlainTaskConversion\(/u);
	assert.doesNotMatch(mainSource, /retryInlineEditorSave|retryEditorSave/u);
	assert.match(mainSource, /converted task source but immediate reindex failed/u);
	assert.match(mainSource, /converted task source but automatic unpin failed/u);
	assert.match(
		styles,
		/\.operon-editor-terminal-action-cluster > \.operon-editor-core-action-btn \{\s*width: 34px;\s*min-width: 34px;\s*height: 34px;\s*min-height: 34px;/u,
	);
});

test('File conversion modal locks every interactive control while its single apply is pending', () => {
	assert.match(convertFileModalSource, /cleanupOperonHoverTooltips\(this\.contentEl\);/u);
	assert.match(convertFileModalSource, /if \(!this\.completed && !this\.submitting\) this\.options\.onCancel\(\);/u);
	assert.match(convertFileModalSource, /event\.key === 'Escape' && !this\.submitting/u);
	assert.match(convertFileModalSource, /this\.setInteractiveControlsDisabled\(true\);/u);
	assert.match(convertFileModalSource, /this\.setInteractiveControlsDisabled\(false\);/u);
	assert.match(convertFileModalSource, /querySelectorAll<HTMLInputElement \| HTMLButtonElement>\('input, button'\)/u);
	assert.match(convertFileModalSource, /close\(\): void \{\s*if \(this\.submitting && !this\.completed\) return;/u);
});
