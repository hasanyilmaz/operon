import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveMarkDoneMutationRoute } from '../src/core/mark-done-routing';

let assertions = 0;

function equal<T>(actual: T, expected: T, message: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function includes(source: string, expected: string, message: string): void {
	assert.ok(source.includes(expected), message);
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

equal(
	resolveMarkDoneMutationRoute(false, false),
	'direct-write',
	'Mobile without a coordinator uses the existing direct-write path.',
);
equal(
	resolveMarkDoneMutationRoute(true, true),
	'semantic-coordinator',
	'Desktop with a coordinator uses the semantic coordinator.',
);
equal(
	resolveMarkDoneMutationRoute(true, false),
	'semantic-coordinator',
	'Desktop without a coordinator remains fail-closed instead of downgrading.',
);
equal(
	resolveMarkDoneMutationRoute(false, true),
	'semantic-coordinator',
	'Mobile prefers a future coordinator when one is available.',
);

const mainSource = readFileSync('main.ts', 'utf8');
const routeSource = readFileSync('src/core/mark-done-routing.ts', 'utf8');
const markDoneBody = extractFunctionBlock(mainSource, 'private async markTaskDoneById(');
const contextMenuBody = extractFunctionBlock(mainSource, 'private async handleContextualMenuAction(');
const cancelBody = extractFunctionBlock(mainSource, 'private async cancelTaskById(');
const cycleBody = extractFunctionBlock(mainSource, 'async cycleTaskStatusById(');
const updateBody = extractFunctionBlock(mainSource, 'private async updateTaskFieldsAndRefresh(');

includes(markDoneBody, 'resolveMarkDoneMutationRoute(', 'Mark done uses the explicit routing policy.');
includes(markDoneBody, 'Platform.isDesktopApp', 'The routing decision binds the live platform identity.');
includes(
	markDoneBody,
	'this.agentRuntimeMutationGateway !== null',
	'The routing decision binds coordinator availability.',
);
includes(
	markDoneBody,
	"if (route === 'semantic-coordinator') {\n\t\t\t\t\treturn this.applyUiSemanticTransition(",
	'A coordinator attempt returns directly and cannot fall through to a second write.',
);
equal(
	(markDoneBody.match(/applyUiSemanticTransition\(/gu) ?? []).length,
	1,
	'Mark done has exactly one semantic coordinator call site.',
);
equal(
	(markDoneBody.match(/updateTaskFieldsAndRefresh\(/gu) ?? []).length,
	2,
	'The direct route retains one timer-bound and one ordinary write path.',
);
includes(markDoneBody, "this.applyCheckboxStateToFieldPayload(payload, 'done'", 'Direct write marks the checkbox done.');
includes(markDoneBody, "payload['status'] = toggleResolution.workflow.value", 'Direct write keeps the workflow transition.');
includes(markDoneBody, "changedKeys = ['_checkbox', 'dateCompleted', 'dateCancelled', 'datetimeModified'", 'Direct write preserves terminal dates and modification metadata.');
includes(markDoneBody, 'this.timeTracker.stopActiveWithExternalTaskMutation(', 'Direct write stops a running timer transactionally.');
includes(markDoneBody, 'return timerStopped && taskWriteAttempted && taskWriteSucceeded', 'Timer completion reports only one successful task write.');
includes(contextMenuBody, 'await this.markTaskDoneById(id);', 'Context-menu Mark done continues to use the central method.');
includes(updateBody, 'await this.maybeCreateRecurringOccurrence(', 'The shared write path retains recurrence materialization.');
includes(updateBody, 'await this.refreshAggregateTotalsAfterTaskMutation(', 'The shared write path retains aggregate refresh.');
includes(updateBody, 'this.refreshViews({', 'The shared write path retains view refresh.');
equal(routeSource.includes('primary.format'), false, 'Routing is identical for inline and File Tasks.');
equal(cancelBody.includes('resolveMarkDoneMutationRoute('), false, 'Cancel task routing is unchanged.');
equal(cycleBody.includes('resolveMarkDoneMutationRoute('), false, 'General status cycling is unchanged.');

console.log(`mobile-mark-done-routing: ${assertions} assertions passed`);
