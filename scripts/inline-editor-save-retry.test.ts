import assert from 'node:assert/strict';
import { retryInlineEditorSave } from '../src/core/inline-editor-save-retry';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	let attempts = 0;
	let fallbackWrites = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error('editor dispatch still active');
			},
			readPersistedContent: async () => 'old task',
		}),
		'persisted',
		'a transient save rejection retries before reporting failure',
	);
	equal(attempts, 2, 'the transient save path retries exactly once');
	equal(fallbackWrites, 0, 'a successful retry does not need a fallback write');

	attempts = 0;
	fallbackWrites = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => 'plain task',
		}),
		'persisted',
		'a false-negative save error succeeds only when disk has the exact new content',
	);
	equal(attempts, 2, 'the exact-content verification happens after one retry');
	equal(fallbackWrites, 0, 'already-persisted content does not need a fallback write');

	attempts = 0;
	fallbackWrites = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => 'operon task',
			fallback: {
				expectedPersistedContent: 'operon task',
				writeExpectedContent: async () => { fallbackWrites += 1; },
			},
		}),
		'persisted',
		'a persistent save error falls back only when disk has the expected pre-transaction content',
	);
	equal(attempts, 2, 'fallback writes happen after one retry');
	equal(fallbackWrites, 1, 'the guarded fallback writes exactly once');

	attempts = 0;
	fallbackWrites = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => 'external edit',
			fallback: {
				expectedPersistedContent: 'operon task',
				writeExpectedContent: async () => { fallbackWrites += 1; },
			},
		}),
		'failed',
		'a changed backing file blocks the fallback write',
	);
	equal(attempts, 2, 'drift does not retry indefinitely');
	equal(fallbackWrites, 0, 'drift never writes the editor buffer over external content');

	attempts = 0;
	fallbackWrites = 0;
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => 'operon task',
			fallback: {
				expectedPersistedContent: 'operon task',
				writeExpectedContent: async () => {
					fallbackWrites += 1;
					throw new Error('atomic preimage check rejected the write');
				},
			},
		}),
		'failed',
		'a rejected fallback remains failed when the backing source is still unchanged',
	);
	equal(attempts, 2, 'a rejected fallback does not retry the source write');
	equal(fallbackWrites, 1, 'a rejected fallback attempts one guarded write');

	attempts = 0;
	fallbackWrites = 0;
	let persistedContent = 'operon task';
	equal(
		await retryInlineEditorSave({
			expectedContent: 'plain task',
			save: async () => {
				attempts += 1;
				throw new Error('save failed');
			},
			readPersistedContent: async () => persistedContent,
			fallback: {
				expectedPersistedContent: 'operon task',
				writeExpectedContent: async () => {
					fallbackWrites += 1;
					persistedContent = 'plain task';
					throw new Error('write acknowledgement lost');
				},
			},
		}),
		'persisted',
		'an uncertain fallback acknowledgement succeeds only after exact disk verification',
	);
	equal(attempts, 2, 'uncertain fallback writes happen after one retry');
	equal(fallbackWrites, 1, 'the fallback never retries an uncertain write');

	console.log(`Inline editor save retry: ${assertions}/${assertions} passed`);
}

globalThis.__operonInlineEditorSaveRetryTestRun = run();

declare global {
	var __operonInlineEditorSaveRetryTestRun: Promise<void> | undefined;
}
