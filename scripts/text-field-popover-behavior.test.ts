import assert from 'node:assert/strict';
import { App } from 'obsidian';
import {
	showTextFieldPopover,
	type TextFieldPopoverDependencies,
	type TextFieldPopoverCloseHandle,
} from '../src/ui/text-field-popover';
import type { FloatingPanelOptions } from '../src/ui/field-pickers/common';
import { TrackerSessionEditModal } from '../src/ui/tracker-session-edit-modal';
import type {
	CompactMarkdownEditorSurface,
	CompactMarkdownEditorSurfaceOptions,
} from '../src/ui/compact-markdown-editor-surface';

class FakeStyle {
	readonly values = new Map<string, string>();
	zIndex = '';

	setProperty(name: string, value: string): void {
		this.values.set(name, value);
	}
}

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly classList = new Set<string>();
	readonly dataset: Record<string, string> = {};
	readonly style = new FakeStyle();
	readonly attributes = new Map<string, string>();
	readonly ownerDocument = fakeDocument;
	className = '';
	id = '';
	textContent = '';
	isConnected = true;
	tagName: string;
	parentElement: FakeElement | null = null;
	focusCount = 0;

	constructor(tagName = 'DIV') {
		this.tagName = tagName;
	}

	createDiv(value?: string | { cls?: string; text?: string }): FakeElement {
		return this.createChild('DIV', value);
	}

	createEl(tagName: string, value?: string | { cls?: string; text?: string; attr?: Record<string, string> }): FakeElement {
		const child = this.createChild(tagName.toUpperCase(), value);
		if (typeof value === 'object') {
			for (const [name, entry] of Object.entries(value.attr ?? {})) child.setAttribute(name, entry);
		}
		return child;
	}

	createSpan(value?: string | { cls?: string; text?: string }): FakeElement {
		return this.createChild('SPAN', value);
	}

	appendChild(child: FakeElement): FakeElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	insertAdjacentElement(_position: string, child: FakeElement): FakeElement {
		return this.appendChild(child);
	}

	querySelector(selector: string): FakeElement | null {
		if (selector.includes('data-operon-accessible-label')) {
			return this.children.find(child => child.dataset.operonAccessibleLabel === 'true') ?? null;
		}
		return null;
	}

	addClass(name: string): void {
		this.classList.add(name);
	}

	removeClass(name: string): void {
		this.classList.delete(name);
	}

	addEventListener(): void {}
	removeEventListener(): void {}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	removeAttribute(name: string): void {
		this.attributes.delete(name);
	}

	focus(): void {
		this.focusCount += 1;
	}

	private createChild(
		tagName: string,
		value?: string | { cls?: string; text?: string },
	): FakeElement {
		const child = new FakeElement(tagName);
		if (typeof value === 'string') child.className = value;
		else if (value) {
			child.className = value.cls ?? '';
			child.textContent = value.text ?? '';
		}
		return this.appendChild(child);
	}
}

const fakeWindow = {
	requestAnimationFrame(callback: FrameRequestCallback): number {
		callback(0);
		return 1;
	},
};
const fakeDocument = {
	defaultView: fakeWindow,
	win: {
		createSpan: () => new FakeElement('SPAN'),
	},
	getElementById: () => null,
};

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(next => {
		resolve = next;
	});
	return { promise, resolve };
}

async function flushAsync(): Promise<void> {
	await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
}

async function runTextFieldPopoverBehaviorTests(): Promise<void> {
	let assertions = 0;
	const equal = (actual: unknown, expected: unknown, message?: string): void => {
		assert.equal(actual, expected, message);
		assertions += 1;
	};

	for (const closeReason of ['handle', 'outside'] as const) {
		const commitAttempts = [deferred<boolean>(), deferred<boolean>()];
		const panels: Array<{ panel: FakeElement; options: FloatingPanelOptions; close: () => void }> = [];
		let commitCalls = 0;
		let closeCalls = 0;
		let focusCalls = 0;
		const editorSurface = {
			getCommit: () => ({ shouldCommit: true, value: '' }),
			focusEnd: () => { focusCalls += 1; },
			refreshLayout: () => undefined,
			destroy: () => undefined,
		};
		const dependencies: TextFieldPopoverDependencies = {
			createCompactEditorSurface: () => editorSurface as unknown as CompactMarkdownEditorSurface,
			createPanel: (_anchor, _className, onClose, options = {}) => {
				const panel = new FakeElement();
				let closed = false;
				const close = () => {
					if (closed) return;
					closed = true;
					panel.isConnected = false;
					closeCalls += 1;
					onClose?.();
				};
				panels.push({ panel, options, close });
				return { panel: panel as unknown as HTMLElement, close };
			},
		};
		const handle = showTextFieldPopover({
			app: new App(),
			anchor: {} as DOMRect,
			title: 'Notes',
			initialValue: 'before',
			allowEmptyCommit: true,
			editor: { kind: 'compact-markdown', sourcePath: 'Task.md' },
			onCommit: () => {
				const attempt = commitAttempts[commitCalls];
				commitCalls += 1;
				if (!attempt) throw new Error('Unexpected extra commit attempt');
				return attempt.promise;
			},
		}, dependencies);
		const closePromise = closeReason === 'handle'
			? handle.requestCloseAndWait()
			: (() => {
				equal(panels[0]?.options.shouldClose?.('outside'), false);
				return handle.requestCloseAndWait();
			})();
		equal(commitCalls, 1, `${closeReason} must start one empty-note commit`);
		commitAttempts[0]?.resolve(false);
		equal(await closePromise, false, `${closeReason} failure must retain the popover`);
		equal(closeCalls, 0);
		equal(focusCalls >= 2, true, 'initial focus and failure refocus are required');
		const retry = handle.requestCloseAndWait();
		equal(commitCalls, 2, 'retry must invoke persistence again');
		commitAttempts[1]?.resolve(true);
		equal(await retry, true);
		equal(closeCalls, 1);
	}

	{
		let commitCalls = 0;
		let closeCalls = 0;
		const dependencies: TextFieldPopoverDependencies = {
			createCompactEditorSurface: () => ({
				getCommit: () => ({ shouldCommit: false, value: 'unchanged' }),
				focusEnd: () => undefined,
				refreshLayout: () => undefined,
				destroy: () => undefined,
			}) as unknown as CompactMarkdownEditorSurface,
			createPanel: (_anchor, _className, onClose) => {
				const panel = new FakeElement();
				return {
					panel: panel as unknown as HTMLElement,
					close: () => {
						if (!panel.isConnected) return;
						panel.isConnected = false;
						closeCalls += 1;
						onClose?.();
					},
				};
			},
		};
		const handle = showTextFieldPopover({
			app: new App(),
			anchor: {} as DOMRect,
			title: 'Notes',
			initialValue: 'unchanged',
			editor: { kind: 'compact-markdown', sourcePath: 'Task.md' },
			onCommit: () => { commitCalls += 1; },
		}, dependencies);
		equal(await handle.requestCloseAndWait(), true);
		equal(commitCalls, 0, 'unchanged notes must not write');
		equal(closeCalls, 1);
	}

	{
		let commitCalls = 0;
		let closeCalls = 0;
		let focusCalls = 0;
		const dependencies: TextFieldPopoverDependencies = {
			createCompactEditorSurface: () => ({
				getCommit: () => ({ shouldCommit: true, value: 'after' }),
				focusEnd: () => { focusCalls += 1; },
				refreshLayout: () => undefined,
				destroy: () => undefined,
			}) as unknown as CompactMarkdownEditorSurface,
			createPanel: (_anchor, _className, onClose) => {
				const panel = new FakeElement();
				return {
					panel: panel as unknown as HTMLElement,
					close: () => {
						if (!panel.isConnected) return;
						panel.isConnected = false;
						closeCalls += 1;
						onClose?.();
					},
				};
			},
		};
		const handle = showTextFieldPopover({
			app: new App(),
			anchor: {} as DOMRect,
			title: 'Notes',
			initialValue: 'before',
			editor: { kind: 'compact-markdown', sourcePath: 'Task.md' },
			onCommit: () => {
				commitCalls += 1;
				if (commitCalls === 1) return Promise.reject(new Error('expected test failure'));
				return true;
			},
		}, dependencies);
		const originalConsoleError = console.error;
		console.error = () => undefined;
		try {
			equal(await handle.requestCloseAndWait(), false, 'thrown persistence must retain the popover');
			equal(closeCalls, 0);
			equal(focusCalls >= 2, true, 'thrown persistence must refocus the editor');
			equal(await handle.requestCloseAndWait(), true, 'a retry after throw must be allowed');
			equal(commitCalls, 2);
			equal(closeCalls, 1);
		} finally {
			console.error = originalConsoleError;
		}
	}

	{
		const capturedOptions = { current: null as CompactMarkdownEditorSurfaceOptions | null };
		let committedValue = '';
		let closeCalls = 0;
		const dependencies: TextFieldPopoverDependencies = {
			createCompactEditorSurface: (_container, options) => {
				capturedOptions.current = options;
				return {
					getCommit: () => ({ shouldCommit: true, value: 'First\nSecond' }),
					focusEnd: () => undefined,
					refreshLayout: () => undefined,
					destroy: () => undefined,
				} as unknown as CompactMarkdownEditorSurface;
			},
			createPanel: (_anchor, _className, onClose) => {
				const panel = new FakeElement();
				return {
					panel: panel as unknown as HTMLElement,
					close: () => {
						if (!panel.isConnected) return;
						panel.isConnected = false;
						closeCalls += 1;
						onClose?.();
					},
				};
			},
		};
		const handle = showTextFieldPopover({
			app: new App(),
			anchor: {} as DOMRect,
			title: 'Notes',
			initialValue: 'First',
			editor: {
				kind: 'compact-markdown',
				sourcePath: 'Task.md',
				textPolicy: 'task-note',
			},
			onCommit: value => {
				committedValue = value;
				return false;
			},
		}, dependencies);
		assert.ok(capturedOptions.current);
		assertions += 1;
		equal(capturedOptions.current.textPolicy, 'task-note');
		equal(await handle.requestCloseAndWait(), false, 'failed multiline note commit must retain popover');
		equal(committedValue, 'First\nSecond');
		equal(closeCalls, 0);
	}

	{
		const closeAttempt = deferred<boolean>();
		let requestCalls = 0;
		let modalCloseCalls = 0;
		const disabledStates: boolean[] = [];
		const handle = Object.assign(() => undefined, {
			requestCloseAndWait: () => {
				requestCalls += 1;
				return closeAttempt.promise;
			},
		}) as TextFieldPopoverCloseHandle;
		const modal = new TrackerSessionEditModal(new App(), {
			title: 'Edit session',
			onSave: () => undefined,
			taskNote: {
				operonId: 'task-1',
				sourcePath: 'Task.md',
				initialValue: '',
				onCommit: () => undefined,
			},
		});
		const internal = modal as unknown as {
			closeTaskNotePopover: TextFieldPopoverCloseHandle | null;
			setModalActionsDisabled: ((disabled: boolean) => void) | null;
		};
		internal.closeTaskNotePopover = handle;
		internal.setModalActionsDisabled = disabled => disabledStates.push(disabled);
		modal.onClose = () => { modalCloseCalls += 1; };
		modal.close();
		modal.close();
		equal(requestCalls, 1, 'concurrent modal closes must share one note close attempt');
		equal(disabledStates.join(','), 'true', 'the first close intent must lock modal actions');
		closeAttempt.resolve(true);
		await flushAsync();
		equal(modalCloseCalls, 1, 'one successful note close must close the modal once');
	}

	{
		const closeAttempts = [deferred<boolean>(), deferred<boolean>()];
		let requestCalls = 0;
		let modalCloseCalls = 0;
		const disabledStates: boolean[] = [];
		const handle = Object.assign(() => undefined, {
			requestCloseAndWait: () => {
				const attempt = closeAttempts[requestCalls];
				requestCalls += 1;
				if (!attempt) throw new Error('Unexpected extra modal close attempt');
				return attempt.promise;
			},
		}) as TextFieldPopoverCloseHandle;
		const modal = new TrackerSessionEditModal(new App(), {
			title: 'Edit session',
			onSave: () => undefined,
			taskNote: {
				operonId: 'task-1',
				sourcePath: 'Task.md',
				initialValue: '',
				onCommit: () => undefined,
			},
		});
		const internal = modal as unknown as {
			closeTaskNotePopover: TextFieldPopoverCloseHandle | null;
			setModalActionsDisabled: ((disabled: boolean) => void) | null;
		};
		internal.closeTaskNotePopover = handle;
		internal.setModalActionsDisabled = disabled => disabledStates.push(disabled);
		modal.onClose = () => { modalCloseCalls += 1; };
		modal.close();
		closeAttempts[0]?.resolve(false);
		await flushAsync();
		equal(modalCloseCalls, 0, 'failed note persistence must retain the session modal');
		equal(disabledStates.join(','), 'true,false', 'failure must unlock modal actions');
		modal.close();
		closeAttempts[1]?.resolve(true);
		await flushAsync();
		equal(requestCalls, 2, 'retry must request note persistence again');
		equal(modalCloseCalls, 1, 'successful retry must close the modal');
	}

	await flushAsync();
	console.log(`Text field popover behavior tests passed: ${assertions} assertions`);
}

globalThis.__operonTextFieldPopoverBehaviorTestRun = runTextFieldPopoverBehaviorTests();

declare global {
	var __operonTextFieldPopoverBehaviorTestRun: Promise<void> | undefined;
}

export {};
