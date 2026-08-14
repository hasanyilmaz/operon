import assert from 'node:assert/strict';
import { retryInlineEditorSave } from '../src/core/inline-editor-save-retry';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	let attempts = 0;
	let requested = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error('editor dispatch still active');
			},
			readPersistedContent: async () => 'old task',
			requestSave: () => { requested += 1; },
		}),
		'persisted',
		'a transient save rejection retries before reporting failure',
	);
	equal(attempts, 2, 'the transient save path retries exactly once');
	equal(requested, 0, 'a successful retry does not request deferred autosave');

	attempts = 0;
	requested = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => 'plain task',
			requestSave: () => { requested += 1; },
		}),
		'persisted',
		'a false-negative save error succeeds only when disk has the exact new content',
	);
	equal(attempts, 2, 'the exact-content verification happens after one retry');
	equal(requested, 0, 'already-persisted content does not schedule another save');

	attempts = 0;
	requested = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => 'operon task',
			requestSave: () => { requested += 1; },
		}),
		'failed',
		'a persistent save error remains fail-closed when disk has old content',
	);
	equal(attempts, 2, 'persistent errors do not retry indefinitely');
	equal(requested, 1, 'persistent errors return control to Obsidian autosave');

	console.log(`Inline editor save retry: ${assertions}/${assertions} passed`);
}

globalThis.__operonInlineEditorSaveRetryTestRun = run();

declare global {
	var __operonInlineEditorSaveRetryTestRun: Promise<void> | undefined;
}
