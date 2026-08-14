import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const taskEditorSource = read('src/ui/task-editor-content.ts');
const styles = read('styles.css');
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
		/\.operon-editor-core-checkbox-popover-action,\s*\.operon-editor-core-subtask-action \{\s*width: 34px;\s*padding: 0;\s*\}/u,
	);
});
