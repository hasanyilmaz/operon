import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import {
	createCompactMarkdownEditorSurface,
	type CompactMarkdownEditorSurfaceDependencies,
} from '../src/ui/compact-markdown-editor-surface';

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
	let embeddedCalls = 0;
	let textareaCalls = 0;
	let destroyCalls = 0;
	let userChangeCalls = 0;
	let backendValue = '';
	let backendSelection = { anchor: 0, head: 0 };
	const backendInput = {
		current: null as Parameters<
			CompactMarkdownEditorSurfaceDependencies['createTextareaBackend']
		>[0] | null,
	};
	const dependencies: CompactMarkdownEditorSurfaceDependencies = {
		isPhone: () => true,
		createEmbeddedBackend: () => {
			embeddedCalls += 1;
			throw new Error('phone must not construct embedded editor');
		},
		createTextareaBackend: input => {
			textareaCalls += 1;
			backendInput.current = input;
			backendValue = input.displayValue;
			return {
				getValue: () => backendValue,
				getSelection: () => ({
					anchor: backendValue.length,
					head: backendValue.length,
				}),
				setValue: (value, selection) => {
					backendValue = value;
					if (selection) backendSelection = selection;
					input.callbacks.onInput(value, {
						anchor: value.length,
						head: value.length,
					});
				},
				focus: () => undefined,
				focusEnd: () => undefined,
				selectAll: () => undefined,
				refreshLayout: () => undefined,
				destroy: () => {
					destroyCalls += 1;
				},
			};
		},
	};
	const container = {
		empty: () => undefined,
	} as unknown as HTMLElement;
	const surface = createCompactMarkdownEditorSurface(container, {
		app: {} as App,
		sourceValue: 'Legacy\nnote',
		sourcePath: 'Tasks.md',
		ariaLabel: 'Notes',
		onIntent: () => undefined,
		onUserChange: () => {
			userChangeCalls += 1;
		},
	}, dependencies);

	equal(embeddedCalls, 0);
	equal(textareaCalls, 1);
	equal(backendValue, 'Legacy note');
	equal(userChangeCalls, 0);
	deepEqual(surface.getCommit(), {
		shouldCommit: false,
		value: 'Legacy\nnote',
	});
	equal(surface.setSourceValue('External\nvalue'), 'applied');
	equal(backendValue, 'External value');
	equal(userChangeCalls, 0, 'programmatic backend callback must stay suppressed');

	assert.ok(backendInput.current);
	assertions += 1;
	backendInput.current.callbacks.onInput(
		'External\nvalue!',
		{ anchor: 15, head: 15 },
	);
	equal(backendValue, 'External value!');
	equal(userChangeCalls, 1);
	equal(surface.setSourceValue('Conflicting source'), 'conflict');
	deepEqual(surface.getCommit(), {
		shouldCommit: true,
		value: 'External value!',
	});

	surface.acceptCommittedValue('External value!');
	deepEqual(surface.getCommit(), {
		shouldCommit: false,
		value: 'External value!',
	});
	backendValue = 'External value! ';
	backendInput.current.callbacks.onInput(
		backendValue,
		{ anchor: backendValue.length, head: backendValue.length },
	);
	equal(backendValue, 'External value! ', 'trailing space must remain available for the next word');
	deepEqual(surface.getCommit(), {
		shouldCommit: false,
		value: 'External value!',
	});
	backendValue = 'External value! next';
	backendInput.current.callbacks.onInput(
		backendValue,
		{ anchor: backendValue.length, head: backendValue.length },
	);
	equal(backendValue, 'External value! next');
	deepEqual(surface.getCommit(), {
		shouldCommit: true,
		value: 'External value! next',
	});
	surface.acceptCommittedValue('External value! next');
	backendValue = 'External value! next ';
	backendInput.current.callbacks.onInput(
		backendValue,
		{ anchor: backendValue.length, head: backendValue.length },
	);
	backendInput.current.callbacks.onCompositionStart();
	backendValue = 'External value! next\n';
	backendInput.current.callbacks.onCompositionEnd(
		backendValue,
		{ anchor: backendValue.length, head: backendValue.length },
	);
	equal(backendValue, 'External value! next ');
	deepEqual(backendSelection, {
		anchor: 'External value! next '.length,
		head: 'External value! next '.length,
	});
	equal(userChangeCalls, 4, 'canonical-equivalent composition must stay clean');
	deepEqual(surface.getCommit(), {
		shouldCommit: false,
		value: 'External value! next',
	});
	surface.destroy();
	surface.destroy();
	equal(destroyCalls, 1);

	let emptyCalls = 0;
	textareaCalls = 0;
	const fallbackContainer = {
		empty: () => {
			emptyCalls += 1;
		},
	} as unknown as HTMLElement;
	const fallbackDependencies: CompactMarkdownEditorSurfaceDependencies = {
		isPhone: () => false,
		createEmbeddedBackend: () => {
			throw new Error('private API unavailable');
		},
		createTextareaBackend: input => {
			textareaCalls += 1;
			let value = input.displayValue;
			return {
				getValue: () => value,
				getSelection: () => ({ anchor: value.length, head: value.length }),
				setValue: nextValue => {
					value = nextValue;
				},
				focus: () => undefined,
				focusEnd: () => undefined,
				selectAll: () => undefined,
				refreshLayout: () => undefined,
				destroy: () => undefined,
			};
		},
	};
	const fallbackSurface = createCompactMarkdownEditorSurface(fallbackContainer, {
		app: {} as App,
		sourceValue: 'Fallback',
		ariaLabel: 'Description',
		onIntent: () => undefined,
	}, fallbackDependencies);
	equal(textareaCalls, 1);
	assert.ok(emptyCalls >= 2, 'container must be cleaned before and after embedded failure');
	assertions += 1;
	deepEqual(fallbackSurface.getCommit(), {
		shouldCommit: false,
		value: 'Fallback',
	});
	fallbackSurface.destroy();

	let taskNoteValue = '';
	let taskNoteChanges = 0;
	const taskNoteInput = {
		current: null as Parameters<CompactMarkdownEditorSurfaceDependencies['createTextareaBackend']>[0] | null,
	};
	const taskNoteSurface = createCompactMarkdownEditorSurface(container, {
		app: {} as App,
		sourceValue: 'First\nSecond',
		ariaLabel: 'Notes',
		textPolicy: 'task-note',
		onIntent: () => undefined,
		onUserChange: () => {
			taskNoteChanges += 1;
		},
	}, {
		isPhone: () => true,
		createEmbeddedBackend: () => {
			throw new Error('phone must not construct embedded editor');
		},
		createTextareaBackend: input => {
			taskNoteInput.current = input;
			taskNoteValue = input.displayValue;
			return {
				getValue: () => taskNoteValue,
				getSelection: () => ({ anchor: taskNoteValue.length, head: taskNoteValue.length }),
				setValue: value => {
					taskNoteValue = value;
				},
				focus: () => undefined,
				focusEnd: () => undefined,
				selectAll: () => undefined,
				refreshLayout: () => undefined,
				destroy: () => undefined,
			};
		},
	});
	equal(taskNoteValue, 'First\nSecond', 'task notes must retain source line breaks in the editor');
	assert.ok(taskNoteInput.current);
	assertions += 1;
	let softBreakPrevented = false;
	let softBreakStopped = false;
	equal(taskNoteInput.current.callbacks.onKeyDown({
		key: 'Enter',
		shiftKey: true,
		metaKey: false,
		ctrlKey: false,
		isComposing: false,
		preventDefault: () => {
			softBreakPrevented = true;
		},
		stopPropagation: () => {
			softBreakStopped = true;
		},
	} as unknown as KeyboardEvent), false, 'Shift+Enter must be left to the native multiline editor');
	equal(softBreakPrevented, false);
	equal(softBreakStopped, false);
	taskNoteInput.current.callbacks.onInput('First\n\nSecond', { anchor: 13, head: 13 });
	equal(taskNoteValue, 'First\n\nSecond');
	equal(taskNoteChanges, 1);
	deepEqual(taskNoteSurface.getCommit(), {
		shouldCommit: true,
		value: 'First\n\nSecond',
	});
	taskNoteSurface.destroy();

	let embeddedTaskNoteValue = '';
	let embeddedTextareaCalls = 0;
	const embeddedTaskNoteInput = {
		current: null as Parameters<CompactMarkdownEditorSurfaceDependencies['createEmbeddedBackend']>[0] | null,
	};
	const embeddedTaskNoteSurface = createCompactMarkdownEditorSurface(container, {
		app: {} as App,
		sourceValue: 'Embedded\nNote',
		ariaLabel: 'Notes',
		textPolicy: 'task-note',
		onIntent: () => undefined,
	}, {
		isPhone: () => false,
		createEmbeddedBackend: input => {
			embeddedTaskNoteInput.current = input;
			embeddedTaskNoteValue = input.displayValue;
			return {
				getValue: () => embeddedTaskNoteValue,
				getSelection: () => ({ anchor: embeddedTaskNoteValue.length, head: embeddedTaskNoteValue.length }),
				setValue: value => { embeddedTaskNoteValue = value; },
				focus: () => undefined,
				focusEnd: () => undefined,
				selectAll: () => undefined,
				refreshLayout: () => undefined,
				destroy: () => undefined,
			};
		},
		createTextareaBackend: () => {
			embeddedTextareaCalls += 1;
			throw new Error('embedded task-note backend must not fall back');
		},
	});
	assert.ok(embeddedTaskNoteInput.current);
	assertions += 1;
	equal(embeddedTaskNoteInput.current.options.textPolicy, 'task-note');
	equal(embeddedTaskNoteInput.current.displayValue, 'Embedded\nNote');
	equal(embeddedTextareaCalls, 0);
	let embeddedSoftBreakPrevented = false;
	equal(embeddedTaskNoteInput.current.callbacks.onKeyDown({
		key: 'Enter',
		shiftKey: true,
		metaKey: false,
		ctrlKey: false,
		isComposing: false,
		preventDefault: () => { embeddedSoftBreakPrevented = true; },
		stopPropagation: () => undefined,
	} as unknown as KeyboardEvent), false);
	equal(embeddedSoftBreakPrevented, false);
	embeddedTaskNoteSurface.destroy();

	console.log(`Compact Markdown editor surface tests passed: ${assertions} assertions`);
}

declare global {
	var __operonCompactMarkdownEditorSurfaceTestRun: Promise<void> | undefined;
}

globalThis.__operonCompactMarkdownEditorSurfaceTestRun = run();
