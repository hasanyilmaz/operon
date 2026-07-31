import assert from 'node:assert/strict';
import {
	resolveCompactEditorKeyIntent,
	type CompactEditorKeyIntent,
	type CompactEditorKeyIntentInput,
} from '../src/ui/compact-editor-key-intent';

let assertions = 0;

function assertIntent(
	input: CompactEditorKeyIntentInput,
	expected: CompactEditorKeyIntent,
	message?: string,
): void {
	assert.equal(resolveCompactEditorKeyIntent(input), expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	assertIntent({ key: 'Enter' }, 'submit');
	assertIntent({ key: 'Enter', shiftKey: true }, 'submit');
	assertIntent({ key: 'Enter', metaKey: true }, 'explicit-submit');
	assertIntent({ key: 'Enter', ctrlKey: true }, 'explicit-submit');
	assertIntent({ key: 'Enter', shiftKey: true, metaKey: true }, 'explicit-submit');
	assertIntent({ key: 'Enter', shiftKey: true, ctrlKey: true }, 'explicit-submit');
	assertIntent({ key: 'Escape' }, 'escape');
	assertIntent({ key: 'Tab' }, 'focus-next');
	assertIntent({ key: 'Tab', shiftKey: true }, 'focus-previous');
	assertIntent({ key: 'ArrowDown' }, 'none');

	const guardedInputs: CompactEditorKeyIntentInput[] = [
		{ key: 'Enter' },
		{ key: 'Enter', shiftKey: true },
		{ key: 'Enter', metaKey: true },
		{ key: 'Enter', ctrlKey: true },
		{ key: 'Escape' },
		{ key: 'Tab' },
		{ key: 'Tab', shiftKey: true },
	];
	for (const input of guardedInputs) {
		assertIntent({ ...input, isComposing: true }, 'none', `${input.key} must be ignored while the event is composing`);
		assertIntent({ ...input, localCompositionActive: true }, 'none', `${input.key} must be ignored during local composition`);
		assertIntent({ ...input, keyCode: 229 }, 'none', `${input.key} must honor the legacy IME keyCode guard`);
	}

	console.log(`Compact editor key intent tests passed: ${assertions} assertions`);
}

declare global {
	var __operonCompactEditorKeyIntentTestRun: Promise<void> | undefined;
}

globalThis.__operonCompactEditorKeyIntentTestRun = run();
