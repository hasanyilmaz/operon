import assert from 'node:assert/strict';
import {
	CompactMarkdownEditorController,
	normalizeCompactTextSelection,
} from '../src/ui/compact-markdown-editor-controller';

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
	const legacySource = 'First line\nSecond line';
	const controller = new CompactMarkdownEditorController(legacySource);
	equal(controller.getDraft().sourceValue, legacySource);
	equal(controller.getDraft().displayValue, 'First line Second line');
	equal(controller.getDraft().persistableValue, legacySource);
	deepEqual(controller.getCommit(), {
		shouldCommit: false,
		value: legacySource,
	});

	const edited = controller.applyUserInput(
		'First line\nSecond line!',
		{ anchor: 23, head: 23 },
	);
	assert.ok(edited);
	assertions += 1;
	equal(edited.displayValue, 'First line Second line!');
	deepEqual(edited.selection, { anchor: 23, head: 23 });
	deepEqual(controller.getCommit(), {
		shouldCommit: true,
		value: 'First line Second line!',
	});
	equal(controller.setSourceValue('External update'), 'conflict');
	equal(controller.getDraft().sourceValue, legacySource);

	controller.acceptCommittedValue('First line Second line!');
	deepEqual(controller.getCommit(), {
		shouldCommit: false,
		value: 'First line Second line!',
	});
	equal(controller.setSourceValue('External update'), 'applied');
	equal(controller.getDraft().sourceValue, 'External update');

	const programmaticLegacy = 'External\nmultiline';
	equal(controller.setSourceValue(programmaticLegacy), 'applied');
	equal(controller.getDraft().displayValue, 'External multiline');
	equal(controller.getDraft().persistableValue, programmaticLegacy);
	deepEqual(controller.getCommit(), {
		shouldCommit: false,
		value: programmaticLegacy,
	});

	controller.beginComposition();
	equal(controller.isCompositionActive(), true);
	const intermediate = controller.applyUserInput(
		'日本\n語',
		{ anchor: 4, head: 4 },
	);
	equal(intermediate, null);
	equal(controller.getDraft().sourceValue, programmaticLegacy);
	equal(controller.setSourceValue('External during composition'), 'conflict');
	const composed = controller.endComposition(
		'日本\n語',
		{ anchor: 4, head: 4 },
	);
	assert.ok(composed);
	assertions += 1;
	equal(controller.isCompositionActive(), false);
	equal(composed.displayValue, '日本 語');
	deepEqual(composed.selection, { anchor: 4, head: 4 });
	deepEqual(controller.getCommit(), {
		shouldCommit: true,
		value: '日本 語',
	});

	deepEqual(
		normalizeCompactTextSelection(
			'  Alpha \r\n Beta',
			{ anchor: 9, head: 16 },
		),
		{ anchor: 5, head: 10 },
	);

	const reverted = new CompactMarkdownEditorController('Already single');
	reverted.applyUserInput('Already single changed', { anchor: 22, head: 22 });
	reverted.applyUserInput('Already single', { anchor: 14, head: 14 });
	deepEqual(reverted.getCommit(), {
		shouldCommit: false,
		value: 'Already single',
	});
	equal(reverted.setSourceValue('External after revert'), 'applied');

	const spaced = new CompactMarkdownEditorController('Task');
	const trailingSpace = spaced.applyUserInput('Task ', { anchor: 5, head: 5 });
	assert.ok(trailingSpace);
	assertions += 1;
	equal(trailingSpace.displayValue, 'Task ');
	deepEqual(trailingSpace.selection, { anchor: 5, head: 5 });
	deepEqual(spaced.getCommit(), {
		shouldCommit: false,
		value: 'Task',
	});
	const continued = spaced.applyUserInput('Task next', { anchor: 9, head: 9 });
	assert.ok(continued);
	assertions += 1;
	equal(continued.displayValue, 'Task next');
	deepEqual(spaced.getCommit(), {
		shouldCommit: true,
		value: 'Task next',
	});

	const sameSourceRefresh = new CompactMarkdownEditorController('Baseline');
	sameSourceRefresh.applyUserInput('Dirty draft', { anchor: 11, head: 11 });
	equal(sameSourceRefresh.setSourceValue('Baseline'), 'applied');
	equal(sameSourceRefresh.getDraft().displayValue, 'Dirty draft');
	deepEqual(sameSourceRefresh.getCommit(), {
		shouldCommit: true,
		value: 'Dirty draft',
	});

	const activeComposition = new CompactMarkdownEditorController('Baseline');
	activeComposition.beginComposition();
	equal(activeComposition.setSourceValue('Baseline'), 'conflict');
	const canceledComposition = activeComposition.endComposition(
		'Baseline',
		{ anchor: 8, head: 8 },
	);
	equal(canceledComposition, null);
	deepEqual(activeComposition.getCommit(), {
		shouldCommit: false,
		value: 'Baseline',
	});

	deepEqual(
		normalizeCompactTextSelection('A  B', { anchor: 2, head: 2 }),
		{ anchor: 2, head: 2 },
	);
	deepEqual(
		normalizeCompactTextSelection('A\nB', { anchor: 2, head: 2 }),
		{ anchor: 2, head: 2 },
	);
	deepEqual(
		normalizeCompactTextSelection(
			'A\r\nLONGTEXT\r\nC',
			{ anchor: 3, head: 13 },
		),
		{ anchor: 2, head: 11 },
	);
	deepEqual(
		normalizeCompactTextSelection(
			'A  \n  BCCCCCCCC  \n  D',
			{ anchor: 7, head: 19 },
		),
		{ anchor: 3, head: 12 },
	);

	console.log(`Compact Markdown editor controller tests passed: ${assertions} assertions`);
}

declare global {
	var __operonCompactMarkdownEditorControllerTestRun: Promise<void> | undefined;
}

globalThis.__operonCompactMarkdownEditorControllerTestRun = run();
