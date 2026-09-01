import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const taskEditorSource = readFileSync('src/ui/task-editor-content.ts', 'utf8');
const helperBody = extractFunctionBlock(mainSource, 'private async updatePluginUiTaskStatusAndRefresh(');
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
includes(helperBody, 'return timerStopped && taskWriteAttempted && taskWriteSucceeded', 'Timer completion requires the single callback write to succeed.');
equal(
	(helperBody.match(/updateTaskFieldsAndRefresh\(/gu) ?? []).length,
	2,
	'The helper has one ordinary write and one timer-bound write, with no retry write.',
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
includes(editorDirectBody, "freshTask.primary.format === 'inline'", 'The canonical direct save core retains its inline branch.');
includes(editorDirectBody, 'this.writer.writeTaskFields(', 'The canonical direct save core retains its YAML branch.');
for (const body of [editorInstanceDirectBody, editorDirectBody]) {
	includes(body, 'this.applyTaskEditorTimerPayloadToParsedTask(parsed, timerPayload)', 'Each Task Editor direct core merges timer fields before serialization.');
	excludes(body, 'applyUiSemanticTransition', 'Task Editor direct saves do not use Runtime semantic transitions.');
}
includes(editorDirectBody, 'this.updatePluginUiTaskStatusAndRefresh(freshTask.operonId, {', 'Task Editor recurring Skip also uses the terminal status helper.');

includes(updateBody, 'await this.maybeCreateRecurringOccurrence(', 'The shared writer retains recurrence materialization.');
includes(updateBody, 'await this.refreshAggregateTotalsAfterTaskMutation(', 'The shared writer retains aggregate refresh and auto-unpin handling.');
includes(updateBody, 'this.scheduleProjectSerialIndexReconcile()', 'The shared writer retains project serial reconciliation.');
includes(updateBody, 'this.refreshViews({', 'The shared writer retains view refresh.');
excludes(mainSource, 'private async applyUiSemanticTransition(', 'The obsolete Plugin UI Runtime wrapper is removed.');
excludes(mainSource, 'private async attemptUiSemanticTransition(', 'The obsolete Plugin UI Runtime attempt wrapper is removed.');
excludes(mainSource, 'resolveMarkDoneMutationRoute(', 'The desktop/mobile status routing policy is removed.');

console.log(`plugin-ui-status-mutation: ${assertions} assertions passed`);
