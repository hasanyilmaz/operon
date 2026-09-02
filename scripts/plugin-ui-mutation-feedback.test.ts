import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
	isPluginUiMutationCommitted,
	resolvePluginUiMutationNoticeKey,
	type PluginUiMutationOutcome,
} from '../src/systems/plugin-ui-mutation-feedback';

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
	let depth = 0;
	for (let index = bodyStart; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] !== '}') continue;
		depth -= 1;
		if (depth === 0) return source.slice(start, index + 1);
	}
	throw new Error(`${signature} body is not balanced.`);
}

const noticeCases: readonly [PluginUiMutationOutcome, string | null][] = [
	['committed', null],
	['cancelled', null],
	['duplicate-task', null],
	['source-missing', 'taskSourceUnavailable'],
	['source-changed', 'taskChangedElsewhere'],
	['invalid-task-data', 'taskFieldsInvalid'],
	['failed-before-commit', 'taskChangeNotApplied'],
	['committed-repair-scheduled', 'taskChangeAppliedRefreshPending'],
	['outcome-unknown', 'taskChangeOutcomeUnknown'],
	['delete-recovery-required', 'taskDeleteRecoveryRequired'],
];
for (const [outcome, noticeKey] of noticeCases) {
	equal(resolvePluginUiMutationNoticeKey(outcome), noticeKey, `${outcome} has the expected notice ownership.`);
}
equal(isPluginUiMutationCommitted('committed'), true, 'Committed mutations succeed.');
equal(isPluginUiMutationCommitted('committed-repair-scheduled'), true, 'Committed mutations with repair still succeed.');
equal(isPluginUiMutationCommitted('outcome-unknown'), false, 'Unknown outcomes are not treated as success.');

const mainSource = readFileSync('main.ts', 'utf8');
const trackerSource = readFileSync('src/systems/time-tracker.ts', 'utf8');
const kanbanViewSource = readFileSync('src/ui/kanban/kanban-view.ts', 'utf8');
const targetBodies = [
	extractFunctionBlock(mainSource, 'private async markTaskDoneById('),
	extractFunctionBlock(mainSource, 'private async cancelTaskById('),
	extractFunctionBlock(mainSource, 'async cycleTaskStatusById('),
	extractFunctionBlock(mainSource, 'async toggleTaskById('),
	extractFunctionBlock(mainSource, 'private async handleKanbanCardDrop('),
	extractFunctionBlock(mainSource, 'private async deleteTaskFromEditor('),
	extractFunctionBlock(mainSource, 'private async applyTaskEditorMutationWithFeedback('),
];
for (const body of targetBodies) {
	excludes(body, "t('notifications', 'taskSaveFailed')", 'Targeted mutation routes do not own the legacy generic save notice.');
}
const statusHelper = extractFunctionBlock(mainSource, 'private async updatePluginUiTaskStatusAndRefresh(');
includes(statusHelper, "return 'outcome-unknown'", 'Unknown status outcomes are classified explicitly.');
excludes(statusHelper, 'fallback', 'Unknown status outcomes have no fallback mutation.');
const editorFeedback = extractFunctionBlock(mainSource, 'private async applyTaskEditorMutationWithFeedback(');
includes(editorFeedback, 'taskFieldsMatchCurrentSource(', 'Task Editor failures use a read-only source postcondition.');
includes(editorFeedback, "outcome = 'committed-repair-scheduled'", 'Task Editor preserves a committed write when settlement needs repair.');
const deleteBody = extractFunctionBlock(mainSource, 'private async deleteTaskFromEditor(');
equal(
	(deleteBody.match(/executeTaskEditorDeleteTransaction</gu) ?? []).length,
	1,
	'Delete has exactly one transaction attempt.',
);
includes(deleteBody, "? 'outcome-unknown'", 'Delete maps a possibly committed target to an unknown outcome without replay.');
includes(deleteBody, ": 'delete-recovery-required'", 'Delete distinguishes incomplete companion recovery from target uncertainty.');
includes(deleteBody, "transaction.reason === 'target-clean-failure'", 'A clean target refusal is reported as a pre-commit failure.');
includes(deleteBody, 'this.schedulePluginUiTaskIndexRefresh(indexedTarget?.primary.filePath)', 'A missing delete source refreshes the relevant index scope.');
const kanbanDropBody = extractFunctionBlock(mainSource, 'private async handleKanbanCardDrop(');
includes(kanbanDropBody, 'this.schedulePluginUiTaskIndexRefresh()', 'A missing Kanban task triggers an index refresh before feedback.');
const taskEditorDirectSave = extractFunctionBlock(mainSource, 'private async applyEditedTaskDirectFromView(');
includes(taskEditorDirectSave, 'this.showTaskEditorMutationOutcome(request, outcome)', 'Recurring Task Editor status changes share the request-scoped notice owner.');
excludes(taskEditorDirectSave, 'this.showPluginUiMutationOutcome(outcome)', 'Recurring Task Editor status changes cannot emit a second unscoped notice.');
const trackerExternal = extractFunctionBlock(trackerSource, 'private async stopActiveWithExternalTaskMutationInternal(');
excludes(trackerExternal, 'new Notice(', 'The external timer transaction leaves notice ownership to its caller.');
includes(trackerExternal, "return 'task-committed-tracker-clear-failed'", 'Tracker cleanup failure preserves the committed task outcome.');
includes(kanbanViewSource, 'resolveKanbanDropNoticeKey(error)', 'Kanban drop uses structured failure-to-notice mapping.');

const requiredKeys = noticeCases.map(([, key]) => key).filter((key): key is string => key !== null);
requiredKeys.push('kanbanMoveStale', 'kanbanMoveNotApplied');
for (const localeFile of readdirSync('i18n/locales').filter(file => file.endsWith('.json'))) {
	const locale = JSON.parse(readFileSync(`i18n/locales/${localeFile}`, 'utf8')) as {
		notifications?: Record<string, string>;
	};
	for (const key of requiredKeys) {
		assert.ok(locale.notifications?.[key]?.trim(), `${localeFile} should define notifications.${key}.`);
		assertions += 1;
	}
}

console.log(`plugin-ui-mutation-feedback: ${assertions} assertions passed`);
