import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ui/task-editor-content.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true);
const editorClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'TaskEditorContent');
const methods = ['isWideFileBodyViewport', 'registerFileBodyViewportListener', 'unregisterFileBodyViewportListener', 'setFileBodyVisible', 'clearFileBodyPanelRender', 'syncFileBodyDraftFromEditor'].map(name => editorClass.members.find(node => node.name?.getText(ast) === name).getText(ast)).join('\n');
function fixture(wide, visible = true) {
 const media = { listener: null };
 const owner = { innerWidth: wide ? 1400 : 1000,
  addEventListener(_name, fn) { media.listener = fn; }, removeEventListener(_name, fn) { assert.equal(media.listener, fn); media.listener = null; },
  getComputedStyle: element => element.style,
 };
 const container = { clientWidth: owner.innerWidth, style: { paddingLeft: '0px', paddingRight: '0px' } };
 const modal = { parentElement: container, ownerDocument: { defaultView: owner }, style: {
  getPropertyValue: key => ({ '--operon-task-editor-main-column-width': '568px', '--operon-task-editor-file-column-width': '652px', '--operon-task-editor-horizontal-padding': '40px', '--operon-task-editor-file-column-min-width': '480px', '--operon-task-editor-split-gap': '24px' })[key],
  paddingLeft: '0px', paddingRight: '0px', borderLeftWidth: '1px', borderRightWidth: '1px', maxWidth: 'none',
 } };
 const root = { closest: () => modal, ownerDocument: { defaultView: owner }, style: { paddingLeft: '20px', paddingRight: '20px' } };
 const code = ts.transpileModule('class TaskEditorContent { ' + methods + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 let disconnected = false; let observeCallback;
 const Observer = class { constructor(callback) { observeCallback = callback; } observe() {} disconnect() { disconnected = true; } };
 const Klass = new Function('getActiveWindow', 'ResizeObserver', 'cleanupOperonHoverTooltips', code + '; return TaskEditorContent;')(() => owner, Observer, () => {});
 const host = new Klass();
 let focus = 0, layouts = 0, destroys = 0;
 Object.assign(host, { rootEl: root, hasFileBodyContext: () => true, fileBodyContext: { format: 'yaml' }, isFileBodyVisible: visible, fileBodyWide: null,
  fileBodyDraft: 'saved body', persistedFileBodyDraft: 'saved body',
  fileBodyPanelEl: { ownerDocument: { activeElement: {} }, contains: () => true, empty() {} },
  fileBodyToggleButtonEl: { focus: () => { focus++; } }, mainPanelEl: { scrollTop: 42 },
  updateFileBodyLayout: () => { layouts++; }, cancelFileBodyEditorLayoutRefresh() {}, restoreMainPanelScroll: value => assert.equal(value, 42),
  handleFileBodyChanged: value => { host.fileBodyDraft = value; host.isFileBodyDirty = value !== host.persistedFileBodyDraft; },
  embeddedBodyEditor: { value: 'unsaved body', destroy: () => { destroys++; } },
 });
 const resize = width => { owner.innerWidth = width; container.clientWidth = width; media.listener(); };
 return { host, media, resize, owner, container, modal, observe: () => observeCallback(), state: () => ({ focus, layouts, destroys, disconnected }) };
}

test('narrow file-task startup shows Task Editor; manually opened body survives rerender registration', () => {
 const { host } = fixture(false);
 host.registerFileBodyViewportListener(); assert.equal(host.isFileBodyVisible, false);
 host.setFileBodyVisible(true); assert.equal(host.isFileBodyVisible, true);
 host.unregisterFileBodyViewportListener(); host.registerFileBodyViewportListener();
 assert.equal(host.isFileBodyVisible, true);
});

test('wide defaults remain unchanged for file and inline tasks', () => {
 for (const initial of [true, false]) {
  const { host } = fixture(true, initial); host.registerFileBodyViewportListener();
  assert.equal(host.isFileBodyVisible, initial);
 }
});

test('wide-to-narrow retains draft and focus; growing reopens file body automatically', () => {
 const { host, media, state, resize } = fixture(true);
 host.registerFileBodyViewportListener(); resize(1000);
 assert.equal(host.isFileBodyVisible, false); assert.equal(host.fileBodyDraft, 'unsaved body');
 assert.equal(host.isFileBodyDirty, true); assert.equal(host.persistedFileBodyDraft, 'saved body');
 assert.equal(state().destroys, 1); assert.equal(state().focus, 1);
 resize(1400); assert.equal(host.isFileBodyVisible, true);
 host.unregisterFileBodyViewportListener(); assert.equal(media.listener, null); assert.equal(state().disconnected, true);
});

test('body return button closes only its panel and restores toggle focus; hidden in wide layout', () => {
 const start = source.indexOf("const backButton = headerActions.createEl('button'");
 const end = source.indexOf("const saveButton = headerActions.createEl('button'", start);
 assert.ok(start > 0 && end > start);
 let click, focused = false, hidden = false;
 new Function('headerActions', 'setIcon', 'setAccessibleLabelWithoutTooltip', 't', source.slice(start, end)).call({
  bindTaskEditorTooltip() {}, setFileBodyVisible: value => { assert.equal(value, false); hidden = true; },
  fileBodyToggleButtonEl: { focus: () => { focused = true; } },
 }, { createEl: () => ({ addEventListener: (_event, handler) => { click = handler; } }) }, () => {}, () => {}, (_ns, key) => key);
 click(); assert.equal(hidden, true); assert.equal(focused, true);
 const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
 assert.ok(css.includes('--operon-task-editor-file-column-min-width: 480px;'));
 assert.match(css, /body \.operon-task-editor-modal\.operon-task-editor-modal-file-body-wide .*\.operon-task-editor-file-panel-back\s*\{\s*display: none;/u);
});


test('split requires exactly 480px after editor, gap, padding, borders and host limits', () => {
 const { host, container, owner, modal } = fixture(true);
 owner.innerWidth = 2000;
 container.clientWidth = 1113; assert.equal(host.isWideFileBodyViewport(), false);
 container.clientWidth = 1114; assert.equal(host.isWideFileBodyViewport(), true);
 modal.style.maxWidth = '1113px'; assert.equal(host.isWideFileBodyViewport(), false);
 modal.style.maxWidth = '1114px'; assert.equal(host.isWideFileBodyViewport(), true);
 container.style.paddingLeft = '10px'; assert.equal(host.isWideFileBodyViewport(), false);
});

test('manual close stays closed until capacity crosses back into wide; inline never auto-opens', () => {
 const { host, resize } = fixture(true);
 host.registerFileBodyViewportListener(); host.setFileBodyVisible(false);
 resize(1500); assert.equal(host.isFileBodyVisible, false);
 resize(1000); resize(1400); assert.equal(host.isFileBodyVisible, true);
 host.fileBodyContext.format = 'inline'; resize(1000); resize(1400);
 assert.equal(host.isFileBodyVisible, false);
});


test('container-only capacity changes reopen body without a window resize', () => {
 const { host, owner, container, observe } = fixture(false);
 owner.innerWidth = 2000;
 host.registerFileBodyViewportListener(); assert.equal(host.isFileBodyVisible, false);
 container.clientWidth = 1114; observe(); assert.equal(host.isFileBodyVisible, true);
 container.clientWidth = 1113; observe(); assert.equal(host.isFileBodyVisible, false);
});


test('modal padding and percentage or unknown theme max-width cannot shrink body below 480', () => {
 const { host, container, owner, modal } = fixture(true);
 owner.innerWidth = 2000; container.clientWidth = 1114;
 modal.style.paddingLeft = '16px'; modal.style.paddingRight = '16px';
 assert.equal(host.isWideFileBodyViewport(), false);
 container.clientWidth = 1146; assert.equal(host.isWideFileBodyViewport(), true);
 modal.style.maxWidth = '75%'; assert.equal(host.isWideFileBodyViewport(), false);
 container.clientWidth = 1600; assert.equal(host.isWideFileBodyViewport(), true);
 modal.style.maxWidth = 'calc(75% - 16px)'; assert.equal(host.isWideFileBodyViewport(), false);
 modal.style.maxWidth = 'none'; modal.style.paddingLeft = '200px';
 assert.equal(host.isWideFileBodyViewport(), false, 'Expanded modal preferred width is also a limit');
});
