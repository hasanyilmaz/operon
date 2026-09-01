import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const taskEditorSource = read('src/ui/task-editor-content.ts');
const styles = read('styles.css');
const settingsTypesSource = read('src/types/settings.ts');
const mainSource = read('main.ts');
const convertFileModalSource = read('src/ui/convert-to-plain-file-modal.ts');
const aggregateCoordinatorSource = read('src/systems/aggregate-coordinator.ts');
const taskWriterSource = read('src/core/task-writer.ts');
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

test('Task Editor keeps its full-width Remove behavior and contains no conversion action', () => {
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
	assert.match(removeControl, /button\.createSpan\(\{ text: t\('buttons', 'remove'\) \}\);/u);
	assert.doesNotMatch(removeControl, /operon-editor-terminal-action-cluster|bindTaskEditorTooltip/u);
	assert.match(
		removeHandler,
		/await this\.onRequestDelete\([\s\S]*?this\.existingTask,[\s\S]*?expectedDirectChildCount/u,
	);
	assert.match(removeHandler, /this\.getDeleteDirectChildCount\?\.\(this\.existingTask\)/u);
	assert.match(removeHandler, /convertToPlainBlockerChildren[\s\S]*?clearParentTask/u);
	assert.match(removeHandler, /this\.requestEditorClose\('force-after-delete'\)/u);
});

test('Task Editor deletion uses the Plugin-local transaction while duplicate cleanup stays separate', () => {
	const deleteHandler = mainSource.slice(
		mainSource.indexOf('\n\tprivate async deleteTaskFromEditor('),
		mainSource.indexOf('\n\tprivate async handleConvertTaskToPlainCommand('),
	);
	assert.match(deleteHandler, /persistTaskEditorDeleteOpenSources\(/u);
	assert.match(deleteHandler, /executeTaskEditorDeleteTransaction<TaskWriterExclusiveMutationPermit>\(/u);
	assert.match(deleteHandler, /applyTaskEditorDeleteTarget\(prepared, permit\)/u);
	assert.match(deleteHandler, /settleCommittedTaskEditorDelete\(prepared\)/u);
	assert.doesNotMatch(deleteHandler, /previewAgentRuntimeMutation|applyAgentRuntimeMutation/u);
	assert.doesNotMatch(deleteHandler, /tasks\.delete\.preview|outcome-unknown/u);
	assert.doesNotMatch(deleteHandler, /timeTracker\.stop/u);
	assert.doesNotMatch(mainSource, /TASK_EDITOR_DELETE_INTERNAL_MUTATION_POLICY/u);
	assert.doesNotMatch(deleteHandler, /clearInlineTaskById|deleteYamlTaskByPath/u);
	assert.match(mainSource, /planTaskEditorDeleteDependencyCleanupV1\(/u);
	assert.match(mainSource, /clearedDeletedTaskDependencyReferences/u);
	const localDeletePlan = mainSource.slice(
		mainSource.indexOf('\n\tprivate resolveTaskEditorDeleteRelationPlan('),
		mainSource.indexOf('\n\tprivate async persistTaskEditorDeleteOpenSources('),
	);
	assert.doesNotMatch(localDeletePlan, /fieldValues\['related'\]/u);
	const duplicateDelete = mainSource.slice(
		mainSource.indexOf('\n\tprivate async confirmAndDeleteTaskInstance('),
		mainSource.indexOf('\n\tprivate async regenerateDuplicateTaskInstanceId('),
	);
	assert.match(duplicateDelete, /deleteInlineTaskById|deleteYamlTaskByPath/u);
	assert.doesNotMatch(duplicateDelete, /TASK_EDITOR_DELETE_INTERNAL_MUTATION_POLICY/u);
});

test('Task Editor delete persists matching open buffers and rejects divergent views before writing', () => {
	const openSourceSync = mainSource.slice(
		mainSource.indexOf('\n\tprivate async persistTaskEditorDeleteOpenSources('),
		mainSource.indexOf('\n\tprivate taskEditorDeleteOpenViewsMatch('),
	);
	assert.match(openSourceSync, /new Set\(views\.map\(view => view\.editor\.getValue\(\)\)\)/u);
	assert.match(openSourceSync, /bufferValues\.size !== 1/u);
	assert.match(openSourceSync, /await this\.persistMarkdownViewBuffer\(views\[0\]\)/u);
	assert.match(openSourceSync, /persistedContent !== bufferValue && persistedContent === initialContent/u);
	assert.match(openSourceSync, /this\.writer\.applyExactMarkdownSourceMutation\(/u);
	assert.match(openSourceSync, /views\.every\(view => view\.editor\.getValue\(\) === bufferValue\)/u);

	const deleteHandler = mainSource.slice(
		mainSource.indexOf('\n\tprivate async deleteTaskFromEditor('),
		mainSource.indexOf('\n\tprivate async handleConvertTaskToPlainCommand('),
	);
	assert.match(
		deleteHandler,
		/persistTaskEditorDeleteOpenSources\(relationPlan\.sourcePaths\)[\s\S]*?reindexFilesBatch\([\s\S]*?resolveTaskEditorDeleteRelationPlan/u,
	);
});

test('task removal refresh always touches affected parent and ancestor modification timestamps', () => {
	const removalRefresh = aggregateCoordinatorSource.slice(
		aggregateCoordinatorSource.indexOf('\n\tasync refreshAfterTaskRemoval('),
		aggregateCoordinatorSource.indexOf('\n\tasync refreshAfterTaskIds('),
	);
	assert.match(removalRefresh, /collectParentAndAncestors\(/u);
	assert.match(removalRefresh, /forceDatetimeModifiedIds: new Set\(affectedIds\)/u);
});

test('TaskWriter trash joins the exclusive Plugin transaction and checks the open-view guard before apply', () => {
	const sourceMutation = taskWriterSource.slice(
		taskWriterSource.indexOf('\n    async applyTaskSourceMutation('),
		taskWriterSource.indexOf('\n    /**\n     * Compare, create/update, and patch exact task fields', taskWriterSource.indexOf('\n    async applyTaskSourceMutation(')),
	);
	assert.match(sourceMutation, /guard\?: TaskSourceMutationGuard/u);
	assert.match(sourceMutation, /permit\?: TaskWriterExclusiveMutationPermit/u);
	assert.match(sourceMutation, /if \(guard && !guard\(\)\)/u);
	assert.match(sourceMutation, /\}, permit\);/u);
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
	assert.doesNotMatch(styles, /operon-editor-terminal-action-cluster/u);
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
