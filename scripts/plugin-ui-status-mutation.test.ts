import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeFileRecurrenceTerminalTransaction } from '../src/systems/file-recurrence-terminal-transaction';

let assertions = 0;

function equal<T>(actual: T, expected: T, message: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function includes(source: string, expected: string, message: string): void {
	assert.ok(source.includes(expected), message);
	assertions += 1;
}

function excludes(source: string, expected: string, message: string): void {
	assert.ok(!source.includes(expected), message);
	assertions += 1;
}

function extractFunctionBlock(source: string, signature: string): string {
	const start = source.indexOf(signature);
	assert.notEqual(start, -1, `${signature} should exist.`);
	assertions += 1;
	const parametersStart = source.indexOf('(', start);
	let parametersEnd = -1;
	let parameterDepth = 0;
	for (let index = parametersStart; index < source.length; index += 1) {
		if (source[index] === '(') parameterDepth += 1;
		if (source[index] !== ')') continue;
		parameterDepth -= 1;
		if (parameterDepth === 0) {
			parametersEnd = index;
			break;
		}
	}
	const bodyStart = source.indexOf('{', parametersEnd);
	assert.notEqual(bodyStart, -1, `${signature} should have a body.`);
	assertions += 1;
	let depth = 0;
	for (let index = bodyStart; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] !== '}') continue;
		depth -= 1;
		if (depth === 0) return source.slice(start, index + 1);
	}
	throw new Error(`${signature} body is not balanced.`);
}

const mainSource = readFileSync('main.ts', 'utf8');
const recurrenceSource = readFileSync('src/systems/recurrence-service.ts', 'utf8');
const taskEditorSource = readFileSync('src/ui/task-editor-content.ts', 'utf8');
const helperBody = extractFunctionBlock(mainSource, 'private async updatePluginUiTaskStatusAndRefresh(');
const mutationBody = extractFunctionBlock(mainSource, 'private async runPluginUiTaskMutation(');
const markDoneBody = extractFunctionBlock(mainSource, 'private async markTaskDoneById(');
const cancelBody = extractFunctionBlock(mainSource, 'private async cancelTaskById(');
const cycleBody = extractFunctionBlock(mainSource, 'async cycleTaskStatusById(');
const toggleBody = extractFunctionBlock(mainSource, 'async toggleTaskById(');
const kanbanBody = extractFunctionBlock(mainSource, 'private async handleKanbanCardDrop(');
const editorTimerBody = extractFunctionBlock(mainSource, 'private async applyTaskEditorSaveWithActiveTimer(');
const editorTimerMergeBody = extractFunctionBlock(mainSource, 'private applyTaskEditorTimerPayloadToParsedTask(');
const editorPersistBody = extractFunctionBlock(taskEditorSource, 'private async persistEditorState(');
const editorInstanceSaveBody = extractFunctionBlock(mainSource, 'private async applyEditedTaskInstanceFromView(');
const editorInstanceDirectBody = extractFunctionBlock(mainSource, 'private async applyEditedTaskInstanceDirectFromView(');
const editorSaveBody = extractFunctionBlock(mainSource, 'private async applyEditedTaskFromView(');
const editorDirectBody = extractFunctionBlock(mainSource, 'private async applyEditedTaskDirectFromView(');
const updateBody = extractFunctionBlock(mainSource, 'private async updateTaskFieldsAndRefresh(');
const calendarFeedbackBody = extractFunctionBlock(mainSource, 'private replaceCalendarRecurringCreationNoticeIfHidden(');
const inlineRecurrenceBody = extractFunctionBlock(mainSource, 'private async commitInlineTerminalRecurrenceMutation(');
const fileRecurrenceBody = extractFunctionBlock(mainSource, 'private async commitFileTerminalRecurrenceMutation(');
const fileRecurrenceSettlementBody = extractFunctionBlock(mainSource, 'private async settleFileTerminalRecurrenceCommit(');
const recurrencePlannerBody = extractFunctionBlock(recurrenceSource, 'planTerminalRecurrenceTransition(');
const runtimeRecurrenceWrapperBody = extractFunctionBlock(recurrenceSource, 'previewNextOccurrenceForAgentRuntime(');
const recurrencePreviewBody = extractFunctionBlock(recurrenceSource, 'private previewNextOccurrence(');
const ensureSeriesEntryBody = extractFunctionBlock(recurrenceSource, 'async ensureSeriesEntry(');

for (const [name, body] of [
	['Mark done', markDoneBody],
	['Cancel', cancelBody],
	['Status cycle', cycleBody],
	['Checkbox toggle', toggleBody],
	['Kanban drop', kanbanBody],
] as const) {
	includes(body, 'this.updatePluginUiTaskStatusAndRefresh(', `${name} uses the Plugin-native status writer.`);
	excludes(body, 'agentRuntimeMutationGateway', `${name} does not depend on Runtime readiness.`);
	excludes(body, 'Platform.', `${name} does not branch by platform.`);
	excludes(body, 'applyUiSemanticTransition', `${name} does not use the Runtime semantic coordinator.`);
}

equal(
	(mainSource.match(/updatePluginUiTaskStatusAndRefresh\(/gu) ?? []).length,
	7,
	'The helper has exactly six UI call sites plus its declaration.',
);
includes(helperBody, 'this.timeTracker.stopActiveWithExternalTaskMutation(', 'Terminal status writes finalize active timers transactionally.');
includes(helperBody, '{ ...payload, ...timerPayload }', 'Authoritative timer fields override stale UI payload fields.');
includes(helperBody, "timerResult === 'task-committed-tracker-clear-failed'", 'A committed task write survives active-tracker cleanup failure.');
includes(helperBody, "return 'committed-repair-scheduled'", 'Post-commit timer cleanup failure schedules repair instead of reporting save failure.');
includes(mutationBody, "return 'recurrence-blocked'", 'A blocked recurrence is classified without treating the terminal transition as committed.');
equal(
	(helperBody.match(/runPluginUiTaskMutation\(/gu) ?? []).length,
	2,
	'The helper has one ordinary classified write and one timer-bound classified write, with no retry write.',
);
excludes(helperBody, 'stopActiveTimer(', 'The Plugin-native helper has no independent timer-stop fallback.');
excludes(toggleBody, 'primary.format', 'Inline and File Task checkbox toggles share one route.');

includes(editorTimerBody, 'stopActiveWithExternalTaskMutation(', 'Task Editor terminal saves finalize the active timer through one callback.');
includes(editorTimerBody, 'taskWrite.result = await persist(authoritativeTimerPayload)', 'Task Editor invokes its direct save core exactly once from the timer callback.');
equal(
	(editorTimerBody.match(/persist\(authoritativeTimerPayload\)/gu) ?? []).length,
	1,
	'Task Editor makes exactly one timer-bound task write attempt.',
);
excludes(editorTimerBody, 'stopActiveTimer(', 'Task Editor does not fall through to a second timer path.');
excludes(editorPersistBody, "this.timeTracker.stop('terminal-status')", 'Task Editor does not write the task while preparing its save request.');
includes(editorPersistBody, 'this.syncTrackingFieldsFromIndex()', 'Task Editor still synchronizes stored tracker fields before serializing the draft.');
includes(editorTimerMergeBody, "['trackers', 'duration']", 'Task Editor protects authoritative tracker and duration fields.');
includes(editorInstanceSaveBody, 'this.applyTaskEditorSaveWithActiveTimer(', 'Instance-specific Task Editor saves use the timer-bound save helper.');
includes(editorSaveBody, 'this.applyTaskEditorSaveWithActiveTimer(', 'Canonical Task Editor saves use the timer-bound save helper.');
includes(editorDirectBody, 'this.parseInlineTaskLine(request.taskLine, 0, task.primary.filePath)', 'Task Editor direct saves preserve the serialized editor draft as their source.');
includes(editorDirectBody, 'const payload = this.buildFieldPayload(parsed)', 'Task Editor direct saves carry the selected terminal date from the serialized draft into the write payload.');
includes(editorDirectBody, "freshTask.primary.format === 'inline'", 'The canonical direct save core retains its inline branch.');
includes(editorDirectBody, 'this.writer.writeTaskFields(', 'The canonical direct save core retains its YAML branch.');
for (const body of [editorInstanceDirectBody, editorDirectBody]) {
	includes(body, 'this.applyTaskEditorTimerPayloadToParsedTask(parsed, timerPayload)', 'Each Task Editor direct core merges timer fields before serialization.');
	excludes(body, 'applyUiSemanticTransition', 'Task Editor direct saves do not use Runtime semantic transitions.');
	excludes(body, 'resolveTaskEditorSemanticTransition', 'Task Editor direct saves do not rebuild terminal dates through Runtime semantics.');
}
excludes(editorSaveBody, 'resolveTaskEditorSemanticTransition', 'The canonical Task Editor save route does not replace an explicit finish date through Runtime semantics.');
excludes(editorDirectBody, 'dateCompleted: localToday()', 'Task Editor direct saves never replace an explicit finish date with today.');
includes(editorDirectBody, 'this.updatePluginUiTaskStatusAndRefresh(freshTask.operonId, {', 'Task Editor recurring Skip also uses the terminal status helper.');

includes(updateBody, 'await this.maybeCreateRecurringOccurrence(', 'The shared writer retains recurrence materialization.');
includes(updateBody, 'await this.commitInlineTerminalRecurrenceMutation(', 'Inline terminal recurrence uses the guarded pre-commit path.');
includes(updateBody, 'await this.commitFileTerminalRecurrenceMutation(', 'File terminal recurrence uses the guarded pre-commit path.');
includes(updateBody, "inlineRecurrenceCommit.outcome === 'committed'", 'The shared writer distinguishes an already coalesced recurrence commit.');
includes(updateBody, 'const sourceTaskVerified = sourceTaskRetained', 'Postflight verifies retained or replaced terminal source settlement.');
includes(updateBody, "recurringSuccessor.checkbox !== 'open'", 'Postflight requires the materialized successor to remain open.');
includes(updateBody, 'options.onRecurrenceBlocked?.()', 'Unresolved recurrence reports its fail-closed outcome to the mutation classifier.');
includes(updateBody, 'forceReindexFilePathAfterMutation(task.primary.filePath, reindexOptions)', 'The coalesced source receives an authoritative post-write reindex.');
includes(updateBody, 'await this.refreshAggregateTotalsAfterTaskMutation(', 'The shared writer retains aggregate refresh and auto-unpin handling.');
equal(
	updateBody.indexOf('options.onRecurringOccurrenceCommitted?.(recurringSuccessor)')
		< updateBody.indexOf('this.refreshViews({'),
	true,
	'Calendar successor feedback runs after settlement but before the Calendar refresh is scheduled.',
);
includes(updateBody, 'this.scheduleProjectSerialIndexReconcile()', 'The shared writer retains project serial reconciliation.');
includes(updateBody, 'this.refreshViews({', 'The shared writer retains view refresh.');
excludes(mainSource, 'private async applyUiSemanticTransition(', 'The obsolete Plugin UI Runtime wrapper is removed.');
excludes(mainSource, 'private async attemptUiSemanticTransition(', 'The obsolete Plugin UI Runtime attempt wrapper is removed.');
excludes(mainSource, 'resolveMarkDoneMutationRoute(', 'The desktop/mobile status routing policy is removed.');

includes(inlineRecurrenceBody, 'this.writer.runExclusiveTaskMutation(', 'Inline completion and successor planning share one exclusive mutation lease.');
includes(inlineRecurrenceBody, 'this.writer.renderGuardedTaskSourceContent(', 'The terminal state is rendered without committing first.');
includes(inlineRecurrenceBody, 'this.recurrenceService.planTerminalRecurrenceTransition(', 'The shared recurrence planner runs before the source mutation.');
includes(inlineRecurrenceBody, 'this.writer.applyExactMarkdownSourceMutation(', 'Terminal state and successor commit through one exact source replacement.');
equal(
	(inlineRecurrenceBody.match(/applyExactMarkdownSourceMutation\(/gu) ?? []).length,
	1,
	'Inline recurrence has exactly one source write attempt.',
);
equal(
	inlineRecurrenceBody.indexOf('planTerminalRecurrenceTransition(')
		< inlineRecurrenceBody.indexOf('applyExactMarkdownSourceMutation('),
	true,
	'Inline recurrence is planned before the only source write begins.',
);
includes(inlineRecurrenceBody, "return { outcome: 'blocked' }", 'Unresolved recurrence fails closed before completion.');
includes(inlineRecurrenceBody, 'expectedCheckbox: task.checkbox', 'The sealed source must still contain the indexed checkbox state.');
includes(inlineRecurrenceBody, "task.checkbox === 'done'", 'An already completed inline task cannot materialize another successor during an unrelated edit.');
includes(inlineRecurrenceBody, "task.checkbox === 'cancelled'", 'An already cancelled inline task cannot materialize another successor during an unrelated edit.');
excludes(inlineRecurrenceBody, 'materializeNextOccurrence(', 'The atomic path cannot invoke the legacy post-completion materializer.');
includes(fileRecurrenceBody, 'this.writer.runExclusiveTaskMutation<', 'File completion and successor writes share one exclusive mutation lease.');
includes(fileRecurrenceBody, 'this.writer.renderGuardedTaskSourceContent(', 'File completion is rendered before any source mutation.');
includes(fileRecurrenceBody, 'expectedFieldValues: task.fieldValues', 'A stale File Task snapshot fails closed before recurrence planning.');
includes(fileRecurrenceBody, "task.checkbox === 'done'", 'An already completed File Task cannot materialize another successor during an unrelated edit.');
includes(fileRecurrenceBody, "task.checkbox === 'cancelled'", 'An already cancelled File Task cannot materialize another successor during an unrelated edit.');
includes(fileRecurrenceBody, 'allowMissingFileFolder: true', 'The UI planner may prepare a missing safe recurrence folder before writes.');
includes(fileRecurrenceBody, 'ensureFileRecurrenceTargetFolder(', 'The planned successor folder is created only through the guarded recurrence helper.');
includes(fileRecurrenceBody, 'executeFileRecurrenceTerminalTransaction({', 'File completion uses the tested successor-first transaction.');
includes(fileRecurrenceBody, 'archiveFilePath ?? preview.nextFilePath', 'Plain-name archives and normal successors share the same exact first-write boundary.');
equal(
	fileRecurrenceBody.indexOf('planTerminalRecurrenceTransition(')
		< fileRecurrenceBody.indexOf('executeFileRecurrenceTerminalTransaction({'),
	true,
	'File recurrence is fully planned before the transaction starts.',
);
equal(
	fileRecurrenceBody.indexOf('executeFileRecurrenceTerminalTransaction({')
		< fileRecurrenceBody.indexOf('this.suppressRawTaskCreationNotice(preview.nextOperonId)'),
	true,
	'Creation notices are suppressed only after the complete File transaction commits.',
);
excludes(fileRecurrenceBody, 'materializeNextOccurrence(', 'The File Task transaction cannot invoke the legacy post-completion materializer.');
includes(fileRecurrenceSettlementBody, 'forceReindexKnownFileAndResolveTaskAfterMutation(', 'Successor reindex and resolution share one authoritative index barrier.');
includes(fileRecurrenceSettlementBody, 'verifyRuntimeMaterializedRecurrenceSuccessorPostflightV1({', 'File successor settlement reuses the internal open/unique verifier.');
includes(fileRecurrenceSettlementBody, "successor.fieldValues['repeatOccurrenceDate']", 'Postflight verifies the exact planned occurrence date.');
includes(fileRecurrenceSettlementBody, 'commitAgentRuntimeRecurrenceState(', 'Repeat-series state advances only after source and successor settlement.');
equal(
	fileRecurrenceSettlementBody.indexOf('verifyRuntimeMaterializedRecurrenceSuccessorPostflightV1({')
		< fileRecurrenceSettlementBody.indexOf('commitAgentRuntimeRecurrenceState('),
	true,
	'Repeat-series state cannot advance before successor postflight.',
);
includes(updateBody, 'this.indexer.scheduleReindex(written.filePath)', 'A failed File Task postflight schedules every written source for repair.');
includes(mainSource, 'this.handleContextualMenuAction(taskId, actionId, context, invocation, leaf)', 'Calendar context-menu actions retain their owning leaf for filter feedback.');
includes(mainSource, 'this.handleCalendarStatusIconClick(taskId, leaf)', 'Calendar status clicks retain their owning leaf for filter feedback.');
includes(calendarFeedbackBody, 'filterTasksForCalendar(', 'Calendar successor visibility reuses the active Calendar filter evaluator.');
includes(calendarFeedbackBody, "new Notice(t('notifications', 'calendarRecurringOccurrenceHiddenByFilter'))", 'A hidden successor produces the dedicated Calendar notice.');
includes(calendarFeedbackBody, 'return true;', 'The hidden-successor notice replaces the ordinary creation notice.');

async function runFileRecurrenceTransactionTests(): Promise<void> {
	const transactionCalls: Array<{ kind: string; filePath: string; expectedContent?: string; nextContent?: string }> = [];
	const committedTransaction = await executeFileRecurrenceTerminalTransaction({
		first: { filePath: 'Tasks/Next.md', content: 'successor' },
		source: { filePath: 'Tasks/Current.md', expectedContent: 'open', content: 'done' },
		write: async mutation => {
			transactionCalls.push(mutation);
			return { outcome: 'committed', filePath: mutation.filePath };
		},
	});
	equal(committedTransaction.outcome, 'committed', 'A successful File recurrence transaction commits.');
	equal(transactionCalls.map(call => call.kind).join(','), 'create,modify', 'Successor/archive is written before the source transition.');
	equal(transactionCalls[1]?.expectedContent, 'open', 'The source transition uses the sealed exact preimage.');

	const rollbackCalls: Array<{ kind: string; filePath: string; expectedContent?: string }> = [];
	let rolledBackPath = '';
	const compensatedTransaction = await executeFileRecurrenceTerminalTransaction({
		first: { filePath: 'Tasks/Archive.md', content: 'terminal archive' },
		source: { filePath: 'Tasks/Recurring.md', expectedContent: 'open', content: 'successor' },
		write: async mutation => {
			rollbackCalls.push(mutation);
			return {
				outcome: mutation.kind === 'modify' ? 'conflict' : 'committed',
				filePath: mutation.filePath,
			};
		},
		onRollback: async filePath => { rolledBackPath = filePath; },
	});
	equal(compensatedTransaction.outcome, 'failed', 'A stale source fails the File recurrence transaction.');
	equal(
		compensatedTransaction.outcome === 'failed' ? compensatedTransaction.rollback : '',
		'committed',
		'An unchanged first artifact is compensated after source conflict.',
	);
	equal(rollbackCalls.map(call => call.kind).join(','), 'create,modify,trash', 'Compensation uses one exact trash after the failed source transition.');
	equal(rollbackCalls[2]?.expectedContent, 'terminal archive', 'Compensation requires the exact transaction-owned content.');
	equal(rolledBackPath, 'Tasks/Archive.md', 'Successful compensation settles the removed path in the index.');

	let createFailureCalls = 0;
	const createFailure = await executeFileRecurrenceTerminalTransaction({
		first: { filePath: 'Tasks/Next.md', content: 'successor' },
		source: { filePath: 'Tasks/Current.md', expectedContent: 'open', content: 'done' },
		write: async mutation => {
			createFailureCalls += 1;
			return { outcome: 'exists', filePath: mutation.filePath };
		},
	});
	equal(createFailure.outcome, 'failed', 'A target collision blocks the transaction.');
	equal(createFailureCalls, 1, 'A target collision never attempts the terminal source write.');

	const uncompensatedTransaction = await executeFileRecurrenceTerminalTransaction({
		first: { filePath: 'Tasks/Next.md', content: 'successor' },
		source: { filePath: 'Tasks/Current.md', expectedContent: 'open', content: 'done' },
		write: async mutation => ({
			outcome: mutation.kind === 'create' ? 'committed' : 'conflict',
			filePath: mutation.filePath,
		}),
	});
	equal(
		uncompensatedTransaction.outcome === 'failed' ? uncompensatedTransaction.rollback : '',
		'failed',
		'Unverifiable compensation remains failed instead of deleting a changed artifact.',
	);
}
includes(recurrencePlannerBody, "disposition: 'non-recurring'", 'The planner distinguishes non-recurring tasks.');
includes(recurrencePlannerBody, "disposition: 'series-ended'", 'The planner distinguishes a legitimate series end.');
includes(recurrencePlannerBody, "? 'materialize-inline'", 'The planner identifies inline materialization explicitly.');
includes(recurrencePlannerBody, ": 'materialize-file'", 'The planner identifies File Task materialization explicitly.');
includes(recurrencePlannerBody, "disposition: 'blocked'", 'Invalid or unresolved recurrence is fail-closed.');
includes(runtimeRecurrenceWrapperBody, 'this.planTerminalRecurrenceTransition(input)', 'Runtime preview reuses the shared internal planner.');
includes(recurrencePreviewBody, 'deriveDoneModeCompletionTemporalTemplate(', 'The shared planner re-anchors overdue done-mode timing before materialization.');
includes(ensureSeriesEntryBody, 'updateBaseTemporalTemplate(', 'The settled series state persists the corrected done-mode timing template.');
excludes(runtimeRecurrenceWrapperBody, 'RuntimeSemanticTransition', 'The compatibility wrapper does not alter Runtime V1 transition contracts.');

export const pluginUiStatusMutationTestRun = runFileRecurrenceTransactionTests()
	.then(() => console.log(`plugin-ui-status-mutation: ${assertions} assertions passed`));
