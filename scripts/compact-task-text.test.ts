import assert from 'node:assert/strict';
import {
	applyCompactTaskTextUserEdit,
	createCompactTaskTextDraft,
	normalizeCompactTaskText,
	resolveCompactTaskTextCommit,
} from '../src/core/compact-task-text';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	const normalizationCases: Array<[string, string]> = [
		['First\nSecond', 'First Second'],
		['First\r\nSecond', 'First Second'],
		['First\rSecond', 'First Second'],
		['First\u2028Second', 'First Second'],
		['First\u2029Second', 'First Second'],
		['First \r\n \n\t\u2028 Second', 'First Second'],
		['  First  second\tthird  ', 'First  second\tthird'],
		[' \n\t ', ''],
		['', ''],
	];
	for (const [source, expected] of normalizationCases) {
		equal(normalizeCompactTaskText(source), expected);
		equal(normalizeCompactTaskText(normalizeCompactTaskText(source)), expected);
	}

	const markdown = '[Docs](https://example.com/a_(b)#x)  [[Note|Alias]] **bold** *italic* `inline  code`';
	equal(normalizeCompactTaskText(markdown), markdown);

	const untouchedLegacyValues = [
		'First\nSecond',
		'First\r\nSecond',
		'First\rSecond',
		'First\u2028Second',
		'First\u2029Second',
		' \tFirst \r\n \n Second\t ',
		'Literal C:\\new folder',
	];
	for (const sourceValue of untouchedLegacyValues) {
		const draft = createCompactTaskTextDraft(sourceValue);
		equal(draft.sourceValue, sourceValue);
		equal(draft.persistableValue, sourceValue);
		equal(draft.userEdited, false);
		deepEqual(resolveCompactTaskTextCommit(draft), {
			shouldCommit: false,
			value: sourceValue,
		});
	}

	const sourceValue = 'First line\nSecond line';
	const sourceDraft = createCompactTaskTextDraft(sourceValue);
	const editedDraft = applyCompactTaskTextUserEdit(sourceDraft, 'First line\nSecond line!');
	equal(sourceDraft.userEdited, false, 'applying an edit must not mutate the source draft');
	equal(sourceDraft.persistableValue, sourceValue, 'source draft must remain lossless');
	deepEqual(resolveCompactTaskTextCommit(editedDraft), {
		shouldCommit: true,
		value: 'First line Second line!',
	});

	const migratedDraft = applyCompactTaskTextUserEdit(sourceDraft, 'First line Second line');
	deepEqual(resolveCompactTaskTextCommit(migratedDraft), {
		shouldCommit: true,
		value: 'First line Second line',
	});

	const singleLineSource = 'Already single line';
	const changedDraft = applyCompactTaskTextUserEdit(
		createCompactTaskTextDraft(singleLineSource),
		'Already single line changed',
	);
	const revertedDraft = applyCompactTaskTextUserEdit(changedDraft, singleLineSource);
	deepEqual(resolveCompactTaskTextCommit(revertedDraft), {
		shouldCommit: false,
		value: singleLineSource,
	});

	const trailingSpaceDraft = applyCompactTaskTextUserEdit(
		createCompactTaskTextDraft('Task'),
		'Task ',
	);
	equal(trailingSpaceDraft.displayValue, 'Task ');
	equal(trailingSpaceDraft.persistableValue, 'Task');
	deepEqual(resolveCompactTaskTextCommit(trailingSpaceDraft), {
		shouldCommit: false,
		value: 'Task',
	});
	const continuedDraft = applyCompactTaskTextUserEdit(trailingSpaceDraft, 'Task next');
	equal(continuedDraft.displayValue, 'Task next');
	deepEqual(resolveCompactTaskTextCommit(continuedDraft), {
		shouldCommit: true,
		value: 'Task next',
	});

	const clearedDraft = applyCompactTaskTextUserEdit(
		createCompactTaskTextDraft('Existing note'),
		' \r\n\t ',
	);
	deepEqual(resolveCompactTaskTextCommit(clearedDraft), {
		shouldCommit: true,
		value: '',
	});

	console.log(`Compact task text tests passed: ${assertions} assertions`);
}

declare global {
	var __operonCompactTaskTextTestRun: Promise<void> | undefined;
}

globalThis.__operonCompactTaskTextTestRun = run();
