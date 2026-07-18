import { App, Notice, Platform, setIcon, TFile } from 'obsidian';
import { asyncHandler, runAsyncAction } from '../core/async-action';
import { asHTMLElement, getActiveDocument, getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import {
	applyPlainCheckboxDraftContent,
	collectPlainCheckboxLines,
	parsePlainMarkdownCheckboxLine,
	PlainCheckboxDraftLine,
	PlainCheckboxEditScope,
	PlainCheckboxLine,
} from '../core/plain-checkbox-lines';
import { IndexedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { ConfirmActionModal } from './confirm-action-modal';
import { EmbeddedMarkdownSourceEditor } from './embedded-markdown-source-editor';
import { createFloatingPanel, type FloatingPanelCloseReason } from './field-pickers/common';
import {
	PLAIN_CHECKBOX_POPOVER_EDITOR_CLASS,
	PLAIN_CHECKBOX_POPOVER_EDITOR_HOST_CLASS,
	PLAIN_CHECKBOX_POPOVER_PANEL_CLASS,
} from './plain-checkbox-popover-scope';

export interface PlainCheckboxPopoverOptions {
	app: App;
	task: IndexedTask;
	keyMappings: KeyMapping[];
	taskColor?: string | null;
	seedEmptyDraft?: boolean;
	centerOnDesktop?: boolean;
	onDispose?: () => void;
}

interface PlainCheckboxDragState {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startLeft: number;
	startTop: number;
	width: number;
	height: number;
	hasMoved: boolean;
}

interface PlainCheckboxDraftItem extends PlainCheckboxDraftLine {
	id: string;
}

interface PlainCheckboxDraftState {
	items: PlainCheckboxDraftItem[];
	dirty: boolean;
	nextId: number;
	baselineSignature: string;
}

interface PlainCheckboxEditorSurface {
	getValue: () => string;
	setValue: (value: string) => void;
	focusEnd: () => void;
	insertIndent: (outdent: boolean) => void;
	destroy: () => void;
}

interface PlainCheckboxPopoverSession {
	panel: HTMLElement;
	requestClose: () => void;
	isPinned: () => boolean;
	bringToFront: () => void;
}

const PLAIN_CHECKBOX_POPOVER_DRAG_PIN_THRESHOLD = 4;
const PLAIN_CHECKBOX_POPOVER_BASE_Z_INDEX = 10080;
const PLAIN_CHECKBOX_INDENT_STEP = '\t';
const PLAIN_CHECKBOX_PHONE_MAX_WIDTH = 700;
const PLAIN_CHECKBOX_PHONE_INITIAL_TOP_RATIO = 0.10;
const PLAIN_CHECKBOX_PHONE_VIEWPORT_RATIO = 0.90;
const activePlainCheckboxPopovers = new Map<string, PlainCheckboxPopoverSession>();
let plainCheckboxPopoverZIndex = PLAIN_CHECKBOX_POPOVER_BASE_Z_INDEX;

export function bindPlainCheckboxPopoverTrigger(
	anchor: HTMLElement,
	options: PlainCheckboxPopoverOptions,
): void {
	anchor.setAttribute('role', 'button');
	anchor.setAttribute('tabindex', '0');
	anchor.setAttribute('aria-haspopup', 'dialog');

	anchor.addEventListener('click', asyncHandler('plain checkbox popover open failed', async event => {
		event.preventDefault();
		event.stopPropagation();
		await showPlainCheckboxPopover(anchor, options);
	}));
	anchor.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		runAsyncAction('plain checkbox popover open failed', async () => {
			await showPlainCheckboxPopover(anchor, options);
		});
	});
}

export async function showPlainCheckboxPopover(
	anchor: HTMLElement | DOMRect,
	options: PlainCheckboxPopoverOptions,
): Promise<void> {
	const file = resolveTaskFile(options.app, options.task);
	if (!file) {
		options.onDispose?.();
		new Notice(t('notifications', 'plainCheckboxEditorFileMissing'));
		return;
	}

	const scope = resolvePlainCheckboxScope(options.task);
	const sessionKey = resolvePlainCheckboxPopoverSessionKey(file, scope);
	const existingSession = activePlainCheckboxPopovers.get(sessionKey);
	const anchorEl = asHTMLElement(anchor);
	const anchorDocument = anchorEl?.ownerDocument ?? getActiveDocument();
	if (existingSession) {
		if (isPlainCheckboxPopoverSessionConnected(existingSession, anchorDocument)) {
			existingSession.bringToFront();
			options.onDispose?.();
			return;
		}
		activePlainCheckboxPopovers.delete(sessionKey);
	}

	let initialDraftState: PlainCheckboxDraftState;
	try {
		initialDraftState = await createPlainCheckboxDraftState(options, file, scope);
	} catch {
		options.onDispose?.();
		new Notice(t('notifications', 'plainCheckboxEditorLoadFailed'));
		return;
	}

	closeUnpinnedPlainCheckboxPopovers(sessionKey);

	let pinned = false;
	let draftState: PlainCheckboxDraftState = initialDraftState;
	let allowDirectClose = false;
	let discardConfirmOpen = false;
	let requestClose: () => void = () => undefined;
	let editorSurface: PlainCheckboxEditorSurface | null = null;
	const shouldCloseFromFloatingPanel = (reason: FloatingPanelCloseReason): boolean => {
		if (allowDirectClose) return true;
		if (pinned && reason !== 'window-resize') return false;
		if (!draftState.dirty) return true;
		requestClose();
		return false;
	};
	const anchorRect: DOMRect = anchorEl?.getBoundingClientRect() ?? anchor as DOMRect;
	const { panel, close } = createFloatingPanel(
		anchorRect,
		`operon-floating-panel ${PLAIN_CHECKBOX_POPOVER_PANEL_CLASS}`,
		() => {
			options.onDispose?.();
			editorSurface?.destroy();
			editorSurface = null;
			const activeSession = activePlainCheckboxPopovers.get(sessionKey);
			if (activeSession?.panel === panel) {
				activePlainCheckboxPopovers.delete(sessionKey);
			}
		},
		{
			closeOnWindowResize: false,
			repositionOnWindowResize: false,
			repositionOnPanelResize: false,
			repositionOnScroll: false,
			shouldClose: shouldCloseFromFloatingPanel,
		},
	);
	const taskAccent = normalizeTaskFieldColor(options.task.fieldValues['taskColor']);
	if (taskAccent) {
		panel.style.setProperty('--operon-plain-checkbox-popover-accent', taskAccent);
	}
	bringPlainCheckboxPopoverToFront(panel);
	panel.addEventListener('pointerdown', () => bringPlainCheckboxPopoverToFront(panel));

	const setPinned = (nextPinned: boolean): void => {
		if (pinned === nextPinned) return;
		pinned = nextPinned;
		panel.classList.toggle('is-pinned', pinned);
		bringPlainCheckboxPopoverToFront(panel);
	};

	const forceClose = (): void => {
		editorSurface?.destroy();
		editorSurface = null;
		allowDirectClose = true;
		close();
	};
	requestClose = (): void => {
		if (!draftState.dirty) {
			forceClose();
			return;
		}
		promptDiscardPlainCheckboxDraft(options.app, panel, () => {
			discardConfirmOpen = false;
			forceClose();
		}, () => {
			discardConfirmOpen = false;
		}, () => discardConfirmOpen, () => {
			discardConfirmOpen = true;
		});
	};
	activePlainCheckboxPopovers.set(sessionKey, {
		panel,
		requestClose,
		isPinned: () => pinned,
		bringToFront: () => bringPlainCheckboxPopoverToFront(panel),
	});
	const body = panel.createDiv('operon-plain-checkbox-popover-body');
	const controls = body.createDiv('operon-plain-checkbox-popover-left-controls');
	createPlainCheckboxDragHandle(controls, panel, () => setPinned(true));
	createPlainCheckboxIconButton(
		body,
		'operon-plain-checkbox-popover-close',
		'x',
		t('tooltips', 'plainCheckboxEditorClose'),
		requestClose,
	);
	const title = body.createDiv({
		cls: 'operon-plain-checkbox-popover-title',
		text: resolvePlainCheckboxPopoverTitle(options.task),
	});
	bindPlainCheckboxDragSurface(title, panel, () => setPinned(true));
	const editorHost = body.createDiv('operon-plain-checkbox-popover-editor-host');
	const footer = body.createDiv('operon-plain-checkbox-popover-footer');
	const addButton = footer.createEl('button', {
		cls: 'operon-plain-checkbox-popover-add',
		attr: { type: 'button' },
	});
	setIcon(addButton, 'plus');
	addButton.createSpan({ text: t('tooltips', 'plainCheckboxEditorAdd') });
	setAccessibleLabelWithoutTooltip(addButton, t('tooltips', 'plainCheckboxEditorAdd'));
	const cancelButton = footer.createEl('button', {
		cls: 'operon-plain-checkbox-popover-cancel',
		attr: { type: 'button' },
	});
	cancelButton.createSpan({ text: t('buttons', 'cancel') });
	setAccessibleLabelWithoutTooltip(cancelButton, t('buttons', 'cancel'));
	const saveButton = footer.createEl('button', {
		cls: 'operon-plain-checkbox-popover-save',
		attr: { type: 'button' },
	});
	setIcon(saveButton, 'save');
	saveButton.createSpan({ text: t('buttons', 'save') });
	setAccessibleLabelWithoutTooltip(saveButton, t('buttons', 'save'));

	const syncSaveButton = (): void => {
		saveButton.disabled = !draftState.dirty;
		saveButton.classList.toggle('is-dirty', draftState.dirty);
	};
	const markDirty = (): void => {
		draftState.dirty = true;
		syncSaveButton();
	};
	const renderDraft = (): void => {
		editorSurface?.setValue(formatPlainCheckboxEditorText(draftState));
		syncSaveButton();
	};

	editorSurface = createPlainCheckboxEditorSurface(editorHost, options, file, markDirty);
	addButton.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		draftState = parsePlainCheckboxEditorText(draftState, editorSurface?.getValue() ?? '');
		if (editorSurface) appendPlainCheckboxEditorLine(editorSurface, draftState);
		markDirty();
	});
	cancelButton.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		forceClose();
	});
	saveButton.addEventListener('click', asyncHandler('plain checkbox save failed', async event => {
		event.preventDefault();
		event.stopPropagation();
		if (!draftState.dirty) return;
		draftState = parsePlainCheckboxEditorText(draftState, editorSurface?.getValue() ?? '');
		const saved = await savePlainCheckboxDraft(options, file, scope, draftState);
		if (!saved) return;
		draftState = await createPlainCheckboxDraftState(options, file, scope);
		renderDraft();
	}));

	const shouldFocusInitialDraft = initialDraftState.items.length === 1
		&& initialDraftState.items[0]?.sourceLineNumber === null
		&& initialDraftState.items[0]?.text === '';
	renderDraft();
	schedulePlainCheckboxInitialPlacement(panel, anchorRect, Boolean(options.centerOnDesktop));
	if (shouldFocusInitialDraft) {
		getOwnerWindow(panel).requestAnimationFrame(() => editorSurface?.focusEnd());
	}
}

function closeUnpinnedPlainCheckboxPopovers(exceptSessionKey: string): void {
	for (const [sessionKey, session] of Array.from(activePlainCheckboxPopovers.entries())) {
		if (sessionKey === exceptSessionKey) continue;
		if (!session.panel.isConnected) {
			activePlainCheckboxPopovers.delete(sessionKey);
			continue;
		}
		if (session.isPinned()) continue;
		session.requestClose();
	}
}

function isPlainCheckboxPopoverSessionConnected(
	session: PlainCheckboxPopoverSession,
	ownerDocument: Document,
): boolean {
	return session.panel.isConnected && session.panel.ownerDocument === ownerDocument;
}

function createPlainCheckboxEditorSurface(
	container: HTMLElement,
	options: PlainCheckboxPopoverOptions,
	file: TFile,
	onChange: () => void,
): PlainCheckboxEditorSurface {
	try {
		return createEmbeddedPlainCheckboxEditorSurface(container, options, file, onChange);
	} catch {
		return createTextareaPlainCheckboxEditorSurface(container, onChange);
	}
}

function createEmbeddedPlainCheckboxEditorSurface(
	container: HTMLElement,
	options: PlainCheckboxPopoverOptions,
	file: TFile,
	onChange: () => void,
): PlainCheckboxEditorSurface {
	const host = container.createDiv(PLAIN_CHECKBOX_POPOVER_EDITOR_HOST_CLASS);
	let suppressChange = false;
	let editor: EmbeddedMarkdownSourceEditor | null = null;
	try {
		editor = new EmbeddedMarkdownSourceEditor(options.app, host, {
			value: '',
			className: PLAIN_CHECKBOX_POPOVER_EDITOR_CLASS,
			file,
			showLineNumbers: false,
			onChange: () => {
				if (!suppressChange) onChange();
			},
			onTab: (outdent) => {
				editor?.indentCurrentLine(outdent);
				onChange();
				return true;
			},
		});
	} catch (error) {
		host.remove();
		throw error;
	}

	return {
		getValue: () => editor?.value ?? '',
		setValue: (value) => {
			suppressChange = true;
			try {
				editor?.setValue(value);
			} finally {
				suppressChange = false;
			}
		},
		focusEnd: () => editor?.focusEnd(),
		insertIndent: (outdent) => {
			editor?.indentCurrentLine(outdent);
		},
		destroy: () => {
			editor?.destroy();
			editor = null;
		},
	};
}

function createTextareaPlainCheckboxEditorSurface(
	container: HTMLElement,
	onChange: () => void,
): PlainCheckboxEditorSurface {
	const editor = container.createEl('textarea', {
		cls: 'operon-plain-checkbox-popover-editor',
		attr: {
			rows: '8',
			spellcheck: 'true',
		},
	});
	setAccessibleLabelWithoutTooltip(editor, t('tooltips', 'plainCheckboxEditorText'));
	editor.addEventListener('input', onChange);
	editor.addEventListener('keydown', event => {
		if (event.key !== 'Tab') return;
		event.preventDefault();
		insertPlainCheckboxEditorIndent(editor, event.shiftKey);
		onChange();
	});

	return {
		getValue: () => editor.value,
		setValue: (value) => {
			editor.value = value;
		},
		focusEnd: () => focusPlainCheckboxEditorEnd(editor),
		insertIndent: (outdent) => {
			insertPlainCheckboxEditorIndent(editor, outdent);
		},
		destroy: () => undefined,
	};
}

async function createPlainCheckboxDraftState(
	options: PlainCheckboxPopoverOptions,
	file: TFile,
	scope: PlainCheckboxEditScope,
): Promise<PlainCheckboxDraftState> {
	const content = await options.app.vault.read(file);
	const lines = collectPlainCheckboxLines(content, file.path, options.keyMappings, scope);
	let nextId = 0;
	const items = lines.map(line => createPlainCheckboxDraftItemFromLine(line, ++nextId));
	if (items.length === 0 && options.seedEmptyDraft === true) {
		nextId += 1;
		items.push(createPlainCheckboxDraftItem(nextId, null));
	}
	return {
		items,
		dirty: false,
		nextId,
		baselineSignature: getPlainCheckboxScopeSignature(lines),
	};
}

async function savePlainCheckboxDraft(
	options: PlainCheckboxPopoverOptions,
	file: TFile,
	scope: PlainCheckboxEditScope,
	draftState: PlainCheckboxDraftState,
): Promise<boolean> {
	const content = await options.app.vault.read(file);
	const currentLines = collectPlainCheckboxLines(content, file.path, options.keyMappings, scope);
	if (getPlainCheckboxScopeSignature(currentLines) !== draftState.baselineSignature) {
		new Notice(t('notifications', 'plainCheckboxEditorStaleDraft'));
		return false;
	}
	const patch = applyPlainCheckboxDraftContent(
		content,
		file.path,
		options.keyMappings,
		scope,
		draftState.items,
	);
	if (!patch.ok) {
		new Notice(t('notifications', 'plainCheckboxEditorSaveFailed'));
		return false;
	}
	if (patch.content !== content) {
		await options.app.vault.modify(file, patch.content);
	}
	return true;
}

function createPlainCheckboxDraftItemFromLine(line: PlainCheckboxLine, idNumber: number): PlainCheckboxDraftItem {
	return {
		id: `plain-checkbox-${idNumber}`,
		sourceLineNumber: line.lineNumber,
		insertAfterLineNumber: null,
		indent: line.indent,
		listMarker: line.listMarker,
		markerSpacing: line.markerSpacing,
		postMarkerSpacing: line.postMarkerSpacing,
		completed: line.completed,
		text: line.text,
	};
}

function createPlainCheckboxDraftItemAfter(
	draftState: PlainCheckboxDraftState,
	reference: PlainCheckboxDraftItem | null,
): PlainCheckboxDraftItem {
	const idNumber = draftState.nextId + 1;
	draftState.nextId = idNumber;
	return createPlainCheckboxDraftItem(idNumber, reference);
}

function createPlainCheckboxDraftItem(
	idNumber: number,
	reference: PlainCheckboxDraftItem | null,
): PlainCheckboxDraftItem {
	return {
		id: `plain-checkbox-${idNumber}`,
		sourceLineNumber: null,
		insertAfterLineNumber: reference?.sourceLineNumber ?? reference?.insertAfterLineNumber ?? null,
		indent: reference?.indent ?? '',
		listMarker: reference ? getNextPlainCheckboxDraftListMarker(reference.listMarker) : '-',
		markerSpacing: reference?.markerSpacing ?? ' ',
		postMarkerSpacing: reference?.postMarkerSpacing ?? ' ',
		completed: false,
		text: '',
	};
}

function formatPlainCheckboxEditorText(draftState: PlainCheckboxDraftState): string {
	return draftState.items.map(formatPlainCheckboxEditorLine).join('\n');
}

function formatPlainCheckboxEditorLine(item: PlainCheckboxDraftItem): string {
	const marker = item.completed ? 'x' : ' ';
	const text = normalizePlainCheckboxEditorText(item.text);
	const spacing = item.postMarkerSpacing || ' ';
	return `${item.indent}${item.listMarker}${item.markerSpacing}[${marker}]${spacing}${text}`;
}

function parsePlainCheckboxEditorText(
	previousState: PlainCheckboxDraftState,
	value: string,
): PlainCheckboxDraftState {
	let nextId = previousState.nextId;
	const parsedLines: PlainCheckboxLine[] = [];
	for (const rawLine of value.split(/\r?\n/u)) {
		if (!rawLine.trim()) continue;
		const parsedLine = parsePlainMarkdownCheckboxLine(rawLine)
			?? createPlainCheckboxLineFromPlainEditorText(rawLine, previousState.items[parsedLines.length] ?? null);
		parsedLines.push(parsedLine);
	}

	const matchedItems = matchPlainCheckboxEditorLines(previousState.items, parsedLines);
	const items: PlainCheckboxDraftItem[] = [];
	let previousItem: PlainCheckboxDraftItem | null = null;
	for (let index = 0; index < parsedLines.length; index += 1) {
		const parsedLine = parsedLines[index];
		if (!parsedLine) continue;
		const existingItem = matchedItems[index] ?? null;
		const item = createPlainCheckboxDraftItemFromEditorLine(
			parsedLine,
			existingItem,
			previousItem,
			++nextId,
		);
		items.push(item);
		previousItem = item;
	}
	return {
		items,
		dirty: previousState.dirty,
		nextId,
		baselineSignature: previousState.baselineSignature,
	};
}

function matchPlainCheckboxEditorLines(
	previousItems: PlainCheckboxDraftItem[],
	nextLines: PlainCheckboxLine[],
): Array<PlainCheckboxDraftItem | null> {
	const assignments = Array.from({ length: nextLines.length }, (): PlainCheckboxDraftItem | null => null);
	const matches = collectPlainCheckboxEditorLineMatches(previousItems, nextLines);
	let previousCursor = 0;
	let nextCursor = 0;

	for (const match of [
		...matches,
		{ previousIndex: previousItems.length, nextIndex: nextLines.length },
	]) {
		assignPlainCheckboxEditorChunk(
			assignments,
			previousItems,
			previousCursor,
			match.previousIndex,
			nextCursor,
			match.nextIndex,
		);
		if (match.previousIndex < previousItems.length && match.nextIndex < nextLines.length) {
			assignments[match.nextIndex] = previousItems[match.previousIndex] ?? null;
		}
		previousCursor = match.previousIndex + 1;
		nextCursor = match.nextIndex + 1;
	}

	return assignments;
}

function collectPlainCheckboxEditorLineMatches(
	previousItems: PlainCheckboxDraftItem[],
	nextLines: PlainCheckboxLine[],
): Array<{ previousIndex: number; nextIndex: number }> {
	const previousSignatures = previousItems.map(getPlainCheckboxDraftLineSignature);
	const nextSignatures = nextLines.map(getPlainCheckboxParsedLineSignature);
	const dp = Array.from(
		{ length: previousItems.length + 1 },
		(): number[] => Array.from({ length: nextLines.length + 1 }, (): number => 0),
	);
	for (let previousIndex = previousItems.length - 1; previousIndex >= 0; previousIndex -= 1) {
		for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
			dp[previousIndex][nextIndex] = previousSignatures[previousIndex] === nextSignatures[nextIndex]
				? 1 + dp[previousIndex + 1][nextIndex + 1]
				: Math.max(dp[previousIndex + 1][nextIndex], dp[previousIndex][nextIndex + 1]);
		}
	}

	const matches: Array<{ previousIndex: number; nextIndex: number }> = [];
	let previousIndex = 0;
	let nextIndex = 0;
	while (previousIndex < previousItems.length && nextIndex < nextLines.length) {
		if (previousSignatures[previousIndex] === nextSignatures[nextIndex]) {
			matches.push({ previousIndex, nextIndex });
			previousIndex += 1;
			nextIndex += 1;
			continue;
		}
		if (dp[previousIndex + 1][nextIndex] >= dp[previousIndex][nextIndex + 1]) {
			previousIndex += 1;
		} else {
			nextIndex += 1;
		}
	}
	return matches;
}

function assignPlainCheckboxEditorChunk(
	assignments: Array<PlainCheckboxDraftItem | null>,
	previousItems: PlainCheckboxDraftItem[],
	previousStart: number,
	previousEnd: number,
	nextStart: number,
	nextEnd: number,
): void {
	const count = Math.min(previousEnd - previousStart, nextEnd - nextStart);
	for (let offset = 0; offset < count; offset += 1) {
		assignments[nextStart + offset] = previousItems[previousStart + offset] ?? null;
	}
}

function getPlainCheckboxDraftLineSignature(item: PlainCheckboxDraftItem): string {
	return [
		item.indent,
		item.listMarker,
		item.markerSpacing,
		item.completed ? '1' : '0',
		normalizePlainCheckboxEditorText(item.text),
	].join('\u0001');
}

function getPlainCheckboxParsedLineSignature(line: PlainCheckboxLine): string {
	return [
		line.indent,
		line.listMarker,
		line.markerSpacing,
		line.completed ? '1' : '0',
		normalizePlainCheckboxEditorText(line.text),
	].join('\u0001');
}

function createPlainCheckboxDraftItemFromEditorLine(
	line: PlainCheckboxLine,
	existingItem: PlainCheckboxDraftItem | null,
	previousItem: PlainCheckboxDraftItem | null,
	idNumber: number,
): PlainCheckboxDraftItem {
	const sourceLineNumber = existingItem?.sourceLineNumber ?? null;
	return {
		id: existingItem?.id ?? `plain-checkbox-${idNumber}`,
		sourceLineNumber,
		insertAfterLineNumber: sourceLineNumber === null
			? existingItem?.insertAfterLineNumber ?? previousItem?.sourceLineNumber ?? previousItem?.insertAfterLineNumber ?? null
			: null,
		indent: line.indent,
		listMarker: line.listMarker,
		markerSpacing: line.markerSpacing,
		postMarkerSpacing: line.postMarkerSpacing,
		completed: line.completed,
		text: line.text,
	};
}

function createPlainCheckboxLineFromPlainEditorText(
	rawLine: string,
	reference: PlainCheckboxDraftItem | null,
): PlainCheckboxLine {
	const match = /^(\s*)(.*)$/u.exec(rawLine);
	return {
		lineNumber: -1,
		rawLine,
		indent: match?.[1] ?? reference?.indent ?? '',
		listMarker: reference ? getNextPlainCheckboxDraftListMarker(reference.listMarker) : '-',
		markerSpacing: reference?.markerSpacing ?? ' ',
		marker: '',
		postMarkerSpacing: ' ',
		completed: false,
		text: match?.[2]?.trimStart() ?? rawLine.trim(),
	};
}

function appendPlainCheckboxEditorLine(
	editor: PlainCheckboxEditorSurface,
	draftState: PlainCheckboxDraftState,
): void {
	const item = createPlainCheckboxDraftItemAfter(draftState, draftState.items[draftState.items.length - 1] ?? null);
	draftState.items.push(item);
	const line = formatPlainCheckboxEditorLine(item);
	const value = editor.getValue();
	const separator = value && !value.endsWith('\n') ? '\n' : '';
	editor.setValue(`${value}${separator}${line}`);
	editor.focusEnd();
}

function insertPlainCheckboxEditorIndent(editor: HTMLTextAreaElement, outdent: boolean): void {
	const selectionStart = editor.selectionStart;
	const selectionEnd = editor.selectionEnd;
	const value = editor.value;
	const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
	const beforeLine = value.slice(0, lineStart);
	const selectedText = value.slice(lineStart, selectionEnd);
	const afterSelection = value.slice(selectionEnd);
	const nextSelectedText = outdent
		? selectedText.replace(/^(\t| {1,4})/u, '')
		: `${PLAIN_CHECKBOX_INDENT_STEP}${selectedText}`;
	editor.value = `${beforeLine}${nextSelectedText}${afterSelection}`;
	const delta = nextSelectedText.length - selectedText.length;
	const nextCursor = Math.max(lineStart, selectionStart + delta);
	editor.setSelectionRange(nextCursor, Math.max(nextCursor, selectionEnd + delta));
}

function focusPlainCheckboxEditorEnd(editor: HTMLTextAreaElement): void {
	editor.focus({ preventScroll: true });
	const end = editor.value.length;
	editor.setSelectionRange(end, end);
}

function normalizePlainCheckboxEditorText(text: string): string {
	return text.replace(/[\r\n]+/gu, ' ');
}

function getPlainCheckboxScopeSignature(lines: PlainCheckboxLine[]): string {
	return JSON.stringify(lines.map(line => [line.lineNumber, line.rawLine]));
}

function promptDiscardPlainCheckboxDraft(
	app: App,
	sourcePanel: HTMLElement,
	onDiscard: () => void,
	onCancel: () => void,
	isOpen: () => boolean,
	markOpen: () => void,
): void {
	if (isOpen()) return;
	markOpen();
	const modal = new ConfirmActionModal(app, {
		title: t('modals', 'plainCheckboxEditorDiscardTitle'),
		message: t('modals', 'plainCheckboxEditorDiscardMessage'),
		confirmText: t('modals', 'plainCheckboxEditorDiscardConfirm'),
		cancelText: t('buttons', 'cancel'),
		danger: true,
	}, (confirmed) => {
		if (confirmed) {
			onDiscard();
			return;
		}
		onCancel();
	});
	modal.open();
	elevatePlainCheckboxDiscardConfirmModal(modal, sourcePanel);
}

function elevatePlainCheckboxDiscardConfirmModal(
	modal: ConfirmActionModal,
	sourcePanel: HTMLElement,
): void {
	modal.modalEl.addClass('operon-plain-checkbox-popover-discard-modal');
	const modalContainer = findPlainCheckboxModalContainer(modal.modalEl);
	if (!modalContainer) return;
	const sourceZIndex = Number.parseInt(sourcePanel.style.zIndex, 10);
	const nextZIndex = Math.max(
		Number.isFinite(sourceZIndex) ? sourceZIndex + 1 : PLAIN_CHECKBOX_POPOVER_BASE_Z_INDEX + 1,
		plainCheckboxPopoverZIndex + 1,
	);
	plainCheckboxPopoverZIndex = nextZIndex;
	modalContainer.style.zIndex = String(nextZIndex);
}

function findPlainCheckboxModalContainer(modalEl: HTMLElement): HTMLElement | null {
	if (typeof modalEl.closest === 'function') {
		const closestContainer = modalEl.closest<HTMLElement>('.modal-container');
		if (closestContainer) return closestContainer;
	}
	const parentEl = modalEl.parentElement;
	if (parentEl?.classList?.contains('modal-container')) return parentEl;
	if (parentEl && typeof parentEl.closest === 'function') {
		return parentEl.closest<HTMLElement>('.modal-container');
	}
	return null;
}

function getNextPlainCheckboxDraftListMarker(marker: string): string {
	const numbered = /^(\d+)([.)])$/.exec(marker);
	if (!numbered) return marker;
	return `${Number(numbered[1]) + 1}${numbered[2]}`;
}

function resolveTaskFile(app: App, task: IndexedTask): TFile | null {
	const file = app.vault.getAbstractFileByPath(task.primary.filePath);
	return file instanceof TFile ? file : null;
}

function resolvePlainCheckboxScope(task: IndexedTask): PlainCheckboxEditScope {
	return task.primary.format === 'inline'
		? { kind: 'inline', operonId: task.operonId }
		: { kind: 'file' };
}

function resolvePlainCheckboxPopoverSessionKey(file: TFile, scope: PlainCheckboxEditScope): string {
	return scope.kind === 'inline'
		? `${file.path}#inline:${scope.operonId}`
		: `${file.path}#file`;
}

function resolvePlainCheckboxPopoverTitle(task: IndexedTask): string {
	return task.description.trim() || t('taskEditor', 'untitledTask');
}

function createPlainCheckboxIconButton(
	container: HTMLElement,
	className: string,
	icon: string,
	label: string,
	onClick: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: className,
		attr: { type: 'button' },
	});
	setPlainCheckboxButtonIconAndLabel(button, icon, label);
	button.addEventListener('pointerdown', stopPlainCheckboxControlEvent);
	button.addEventListener('mousedown', stopPlainCheckboxControlEvent);
	button.addEventListener('click', event => {
		stopPlainCheckboxControlEvent(event);
		onClick();
	});
	return button;
}

function createPlainCheckboxDragHandle(
	container: HTMLElement,
	panel: HTMLElement,
	onAutoPin: () => void,
): HTMLButtonElement {
	const button = container.createEl('button', {
		cls: 'operon-plain-checkbox-popover-drag-handle',
		attr: { type: 'button' },
	});
	setPlainCheckboxButtonIconAndLabel(button, 'move', t('tooltips', 'plainCheckboxEditorMove'));
	bindPlainCheckboxDragSurface(button, panel, onAutoPin);
	button.addEventListener('click', stopPlainCheckboxControlEvent);
	return button;
}

function bindPlainCheckboxDragSurface(
	surface: HTMLElement,
	panel: HTMLElement,
	onAutoPin: () => void,
): void {
	let dragState: PlainCheckboxDragState | null = null;

	const endDrag = (): void => {
		if (!dragState) return;
		if (surface.hasPointerCapture?.(dragState.pointerId)) {
			surface.releasePointerCapture?.(dragState.pointerId);
		}
		dragState = null;
		panel.removeClass('is-dragging');
		surface.removeClass('is-dragging');
	};

	surface.addEventListener('pointerdown', event => {
		if (event.button !== 0) return;
		stopPlainCheckboxControlEvent(event);
		bringPlainCheckboxPopoverToFront(panel);
		const rect = panel.getBoundingClientRect();
		panel.setCssProps({
			position: 'fixed',
			left: `${Math.round(rect.left)}px`,
			top: `${Math.round(rect.top)}px`,
		});
		dragState = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startLeft: rect.left,
			startTop: rect.top,
			width: rect.width,
			height: rect.height,
			hasMoved: false,
		};
		surface.setPointerCapture?.(event.pointerId);
		panel.addClass('is-dragging');
		surface.addClass('is-dragging');
	});
	surface.addEventListener('pointermove', event => {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		stopPlainCheckboxControlEvent(event);
		const deltaX = event.clientX - dragState.startClientX;
		const deltaY = event.clientY - dragState.startClientY;
		setPlainCheckboxPopoverPosition(
			panel,
			dragState.width,
			dragState.height,
			dragState.startLeft + deltaX,
			dragState.startTop + deltaY,
		);
		if (!dragState.hasMoved && Math.hypot(deltaX, deltaY) >= PLAIN_CHECKBOX_POPOVER_DRAG_PIN_THRESHOLD) {
			dragState.hasMoved = true;
			onAutoPin();
		}
	});
	surface.addEventListener('pointerup', event => {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		stopPlainCheckboxControlEvent(event);
		endDrag();
	});
	surface.addEventListener('pointercancel', event => {
		if (!dragState || event.pointerId !== dragState.pointerId) return;
		stopPlainCheckboxControlEvent(event);
		endDrag();
	});
	surface.addEventListener('lostpointercapture', endDrag);
}

function setPlainCheckboxButtonIconAndLabel(button: HTMLButtonElement, icon: string, label: string): void {
	button.empty();
	setIcon(button, icon);
	setAccessibleLabelWithoutTooltip(button, label);
}

function stopPlainCheckboxControlEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
}

function bringPlainCheckboxPopoverToFront(panel: HTMLElement): void {
	plainCheckboxPopoverZIndex += 1;
	panel.style.zIndex = String(plainCheckboxPopoverZIndex);
}

interface PlainCheckboxPopoverViewport {
	left: number;
	top: number;
	width: number;
	height: number;
	marginX: number;
	marginY: number;
}

function schedulePlainCheckboxInitialPlacement(panel: HTMLElement, anchorRect: DOMRect, centerOnDesktop: boolean): void {
	const ownerWindow = getOwnerWindow(panel);
	const position = (): void => {
		if (!panel.isConnected) return;
		if (isPhonePlainCheckboxPopover(panel)) {
			positionPlainCheckboxPhoneInitialPanel(panel);
			return;
		}
		positionPlainCheckboxAnchoredPanel(panel, anchorRect, centerOnDesktop);
	};
	ownerWindow.requestAnimationFrame(() => {
		position();
		ownerWindow.requestAnimationFrame(() => {
			position();
		});
	});
}

function positionPlainCheckboxAnchoredPanel(panel: HTMLElement, anchorRect: DOMRect, centerOnDesktop: boolean): void {
	const viewport = getPlainCheckboxPopoverViewport(panel);
	const rect = panel.getBoundingClientRect();
	const width = rect.width || Math.min(520, viewport.width * 0.92);
	const height = rect.height || Math.min(430, viewport.height * 0.82);
	const hasUsableAnchor = Number.isFinite(anchorRect.left)
		&& Number.isFinite(anchorRect.top)
		&& Number.isFinite(anchorRect.bottom)
		&& (anchorRect.width > 0 || anchorRect.height > 0)
		&& (anchorRect.left !== 0 || anchorRect.top !== 0 || anchorRect.bottom !== 0);

	let targetLeft = viewport.left + (viewport.width - width) / 2;
	let targetTop = viewport.top + (viewport.height - height) / 2;
	if (!centerOnDesktop && hasUsableAnchor) {
		targetLeft = anchorRect.left;
		targetTop = anchorRect.bottom + 6;
		const maxTop = viewport.top + viewport.height - viewport.marginY - height;
		if (targetTop > maxTop && anchorRect.top - height - 6 >= viewport.top + viewport.marginY) {
			targetTop = anchorRect.top - height - 6;
		}
	}

	setPlainCheckboxPopoverPosition(panel, width, height, targetLeft, targetTop, viewport);
}

function positionPlainCheckboxPhoneInitialPanel(panel: HTMLElement): void {
	const viewport = getPlainCheckboxPopoverViewport(panel);
	const rect = panel.getBoundingClientRect();
	const width = rect.width || Math.min(520, viewport.width * 0.92);
	const height = rect.height || Math.min(430, viewport.height * 0.82);
	const targetLeft = viewport.left + (viewport.width - width) / 2;
	const targetTop = viewport.top + viewport.height * PLAIN_CHECKBOX_PHONE_INITIAL_TOP_RATIO;
	setPlainCheckboxPopoverPosition(panel, width, height, targetLeft, targetTop, viewport);
}

function isPhonePlainCheckboxPopover(panel: HTMLElement): boolean {
	if (!Platform.isPhone) return false;
	return getPlainCheckboxPopoverViewport(panel).width <= PLAIN_CHECKBOX_PHONE_MAX_WIDTH;
}

function getPlainCheckboxPopoverViewport(panel: HTMLElement): PlainCheckboxPopoverViewport {
	const ownerWindow = getOwnerWindow(panel);
	const visualViewport = ownerWindow.visualViewport;
	const width = visualViewport?.width ?? ownerWindow.innerWidth;
	const height = visualViewport?.height ?? ownerWindow.innerHeight;
	const marginX = Math.max(12, width * ((1 - PLAIN_CHECKBOX_PHONE_VIEWPORT_RATIO) / 2));
	const marginY = Math.max(12, height * ((1 - PLAIN_CHECKBOX_PHONE_VIEWPORT_RATIO) / 2));
	return {
		left: visualViewport?.offsetLeft ?? 0,
		top: visualViewport?.offsetTop ?? 0,
		width,
		height,
		marginX,
		marginY,
	};
}

function setPlainCheckboxPopoverPosition(
	panel: HTMLElement,
	width: number,
	height: number,
	targetLeft: number,
	targetTop: number,
	viewport: PlainCheckboxPopoverViewport | null = null,
): void {
	const ownerWindow = getOwnerWindow(panel);
	const minLeft = viewport ? viewport.left + viewport.marginX : 12;
	const minTop = viewport ? viewport.top + viewport.marginY : 12;
	const maxLeft = viewport
		? viewport.left + viewport.width - viewport.marginX - width
		: ownerWindow.innerWidth - 12 - width;
	const maxTop = viewport
		? viewport.top + viewport.height - viewport.marginY - height
		: ownerWindow.innerHeight - 12 - height;
	panel.setCssProps({
		left: `${Math.round(clamp(targetLeft, minLeft, maxLeft))}px`,
		top: `${Math.round(clamp(targetTop, minTop, maxTop))}px`,
	});
}

function clamp(value: number, min: number, max: number): number {
	if (max < min) return (min + max) / 2;
	return Math.max(min, Math.min(value, max));
}
