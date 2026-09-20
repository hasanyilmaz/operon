import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ui/task-editor-content.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true);
const editorClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'TaskEditorContent');
const methods = ['registerFileBodyViewportListener', 'unregisterFileBodyViewportListener', 'setFileBodyVisible', 'clearFileBodyPanelRender', 'syncFileBodyDraftFromEditor'].map(name => editorClass.members.find(node => node.name?.getText(ast) === name).getText(ast)).join('\n');
function fixture(wide, visible = true) {
 const media = { matches: wide, addEventListener(_name, fn) { this.listener = fn; }, removeEventListener(_name, fn) { assert.equal(this.listener, fn); this.listener = null; } };
 const window = { matchMedia: () => media };
 const code = ts.transpileModule('class TaskEditorContent { static FILE_BODY_WIDE_MEDIA_QUERY = "(min-width: 980px)"; ' + methods + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const Klass = new Function('window', 'cleanupOperonHoverTooltips', code + '; return TaskEditorContent;')(window, () => {});
 const host = new Klass();
 let focus = 0, layouts = 0, destroys = 0;
 Object.assign(host, { hasFileBodyContext: () => true, isFileBodyVisible: visible, fileBodyViewportInitialized: false,
  fileBodyDraft: 'saved body', persistedFileBodyDraft: 'saved body',
  fileBodyPanelEl: { ownerDocument: { activeElement: {} }, contains: () => true, empty() {} },
  fileBodyToggleButtonEl: { focus: () => { focus++; } }, mainPanelEl: { scrollTop: 42 },
  updateFileBodyLayout: () => { layouts++; }, cancelFileBodyEditorLayoutRefresh() {}, restoreMainPanelScroll: value => assert.equal(value, 42),
  handleFileBodyChanged: value => { host.fileBodyDraft = value; host.isFileBodyDirty = value !== host.persistedFileBodyDraft; },
  embeddedBodyEditor: { value: 'unsaved body', destroy: () => { destroys++; } },
  persistEditorState: () => { throw Error('Visibility must never save'); },
 });
 return { host, media, state: () => ({ focus, layouts, destroys }) };
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

test('wide-to-narrow hides body, preserves unsaved draft and returns focus without saving', () => {
 const { host, media, state } = fixture(true);
 host.registerFileBodyViewportListener(); media.matches = false; media.listener();
 assert.equal(host.isFileBodyVisible, false); assert.equal(host.fileBodyDraft, 'unsaved body');
 assert.equal(host.isFileBodyDirty, true); assert.equal(host.persistedFileBodyDraft, 'saved body');
 assert.equal(state().destroys, 1); assert.equal(state().focus, 1);
 media.matches = true; media.listener(); assert.equal(host.isFileBodyVisible, false);
 host.unregisterFileBodyViewportListener(); assert.equal(media.listener, null);
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
 assert.match(css, /@media \(min-width: 980px\)\s*\{\s*body \.operon-task-editor button\.operon-task-editor-file-panel-overlay-action\.operon-task-editor-file-panel-back\s*\{\s*display: none;/u);
});
