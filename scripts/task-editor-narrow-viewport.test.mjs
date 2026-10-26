import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ui/task-editor-content.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true);
const editorClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'TaskEditorContent');
const methods = ['isWideSourceContextViewport', 'registerSourceContextViewportListener', 'unregisterSourceContextViewportListener'].map(name => editorClass.members.find(node => node.name?.getText(ast) === name).getText(ast)).join('\n');
function fixture(wide, visible = false) {
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
 owner.ResizeObserver = Observer;
 const Klass = new Function('getActiveWindow', 'ResizeObserver', 'cleanupOperonHoverTooltips', code + '; return TaskEditorContent;')(() => owner, Observer, () => {});
 const host = new Klass();
 let focus = 0, layouts = 0, destroys = 0;
 Object.assign(host, { rootEl: root, hasFileBodyContext: () => true, fileBodyContext: { format: 'yaml' }, isFileBodyVisible: visible, sourceContextWide: null,
  fileBodyDraft: 'saved body', persistedFileBodyDraft: 'saved body',
  fileBodyPanelEl: { ownerDocument: { activeElement: {} }, contains: () => true, empty() {} },
  fileBodyToggleButtonEl: { focus: () => { focus++; } }, mainPanelEl: { scrollTop: 42 },
  updateSourceContextLayout: () => { layouts++; }, cancelFileBodyEditorLayoutRefresh() {}, restoreMainPanelScroll: value => assert.equal(value, 42),
  handleFileBodyChanged: value => { host.fileBodyDraft = value; host.isFileBodyDirty = value !== host.persistedFileBodyDraft; },
  embeddedBodyEditor: { value: 'unsaved body', destroy: () => { destroys++; } },
 });
 const resize = width => { owner.innerWidth = width; container.clientWidth = width; media.listener(); };
 return { host, media, resize, owner, container, modal, observe: () => observeCallback(), state: () => ({ focus, layouts, destroys, disconnected }) };
}

for (const device of ['desktop', 'tablet', 'phone']) for (const format of ['yaml', 'inline']) {
 test(`${device} ${format}: constructor and resize/rerender paths keep the legacy body closed`, () => {
  const { host, resize, state } = fixture(true);
  host.isPhone = device === 'phone';
  host.isTablet = device === 'tablet';
  host.fileBodyContext.format = format;
  host.registerSourceContextViewportListener();
  assert.equal(host.setFileBodyVisible, undefined);
  if (!host.isPhone) {
   for (const width of [1000, 1400, 1500, 900]) {
    resize(width);
    assert.equal(host.setFileBodyVisible, undefined);
    assert.equal(host.sourceContextWide, width >= 1114);
   }
   host.unregisterSourceContextViewportListener(); host.registerSourceContextViewportListener();
   assert.equal(host.setFileBodyVisible, undefined);
   assert.ok(state().layouts >= 6, 'Closed-panel geometry continues to update');
  }
  assert.equal(host.fileBodyContext.format, format);
  assert.equal(host.fileBodyDraft, 'saved body');
  assert.equal(state().focus, 0);
  assert.equal(state().destroys, 0);
  host.unregisterSourceContextViewportListener();
 });
}

test('split requires exactly 480px after editor, gap, padding, borders and host limits', () => {
 const { host, container, owner, modal } = fixture(true);
 owner.innerWidth = 2000;
 container.clientWidth = 1113; assert.equal(host.isWideSourceContextViewport(), false);
 container.clientWidth = 1114; assert.equal(host.isWideSourceContextViewport(), true);
 modal.style.maxWidth = '1113px'; assert.equal(host.isWideSourceContextViewport(), false);
 modal.style.maxWidth = '1114px'; assert.equal(host.isWideSourceContextViewport(), true);
 container.style.paddingLeft = '10px'; assert.equal(host.isWideSourceContextViewport(), false);
});

test('container-only capacity changes update geometry without opening the legacy body', () => {
 const { host, owner, container, observe } = fixture(false);
 owner.innerWidth = 2000;
 host.registerSourceContextViewportListener(); assert.equal(host.setFileBodyVisible, undefined);
 container.clientWidth = 1114; observe(); assert.equal(host.sourceContextWide, true); assert.equal(host.setFileBodyVisible, undefined);
 container.clientWidth = 1113; observe(); assert.equal(host.sourceContextWide, false); assert.equal(host.setFileBodyVisible, undefined);
 host.unregisterSourceContextViewportListener();
});

test('modal padding and percentage or unknown theme max-width cannot shrink body below 480', () => {
 const { host, container, owner, modal } = fixture(true);
 owner.innerWidth = 2000; container.clientWidth = 1114;
 modal.style.paddingLeft = '16px'; modal.style.paddingRight = '16px';
 assert.equal(host.isWideSourceContextViewport(), false);
 container.clientWidth = 1146; assert.equal(host.isWideSourceContextViewport(), true);
 modal.style.maxWidth = '75%'; assert.equal(host.isWideSourceContextViewport(), false);
 container.clientWidth = 1600; assert.equal(host.isWideSourceContextViewport(), true);
 modal.style.maxWidth = 'calc(75% - 16px)'; assert.equal(host.isWideSourceContextViewport(), false);
 modal.style.maxWidth = 'none'; modal.style.paddingLeft = '200px';
 assert.equal(host.isWideSourceContextViewport(), false, 'Expanded modal preferred width is also a limit');
});

// Execute the production lifecycle and action methods with a small DOM adapter.
class PanelElement {
 children = [];
 classes = new Set();
 attrs = {};
 events = {};
 dataset = {};
 scrollTop = 42;
 ownerDocument = { defaultView: null };
 classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
 constructor(options = {}) {
  for (const name of (typeof options === 'string' ? options : options.cls ?? '').split(' ').filter(Boolean)) this.classes.add(name);
 }
 createEl(_tag, options) { const node = new PanelElement(options); this.children.push(node); return node; }
 createDiv(options) { return this.createEl('div', options); }
 empty() { this.children = []; }
 addClass(name) { this.classes.add(name); }
 toggleClass(name, on) { this.classList.toggle(name, on); }
 setAttr(name, value) { this.attrs[name] = value; }
 setText() {}
 addEventListener(name, callback) { this.events[name] = callback; }
 removeEventListener() {}
 closest() { return this.modal; }
 find(name) { return this.classes.has(name) ? this : this.children.map(child => child.find(name)).find(Boolean); }
}

function retirementFixture(device, format, wide) {
 const names = ['hasFileBodyContext', 'mountInto', 'updateSourceContextLayout', 'renderCoreActionButtons', 'refreshAfterExternalTaskMutation'];
 const extracted = names.map(name => editorClass.members.find(node => node.name?.getText(ast) === name).getText(ast)).join('\n');
 const code = ts.transpileModule(`class Harness { ${extracted} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const noOp = () => {};
 const globals = {
  cleanupOperonHoverTooltips: noOp, bindEditorInteractionState: () => noOp,
  getNativePropertyIndex: () => ({ observeDraftProperties: () => noOp }),
  TASK_EDITOR_MOBILE_PICKER_OPEN_EVENT: 'picker-open', TASK_EDITOR_MOBILE_PICKER_CLOSE_EVENT: 'picker-close',
  window: { addEventListener: noOp, removeEventListener: noOp },
  getOwnerWindow: () => globals.window,
  t: (_ns, key) => key, setIcon: noOp, getIcon: () => null,
  setAccessibleLabelWithoutTooltip: (el, label) => el.setAttr('aria-label', label),
  resolveSubtaskActionLabelKeyForKind: () => 'addSubtask', resolveSubtaskActionIconForKind: () => 'plus',
  runAsyncAction: (_label, action) => action(),
 };
 const Harness = new Function(...Object.keys(globals), `${code}; return Harness;`)(...Object.values(globals));
 const host = new Harness();
 const root = new PanelElement(); root.modal = new PanelElement();
 const calls = { rendered: 0, geometry: 0, checkbox: 0, subtasks: [], flush: 0, source: 0 };
 for (const name of ['destroyCompactTextEditors', 'clearMobileCoreToolbarState', 'clearInitialDescriptionFocusTimers',
  'applyThemeColor', 'refreshCompactTextEditorLayouts', 'scheduleMobileCoreToolbarOverflowState', 'bindTaskEditorTooltip',
  'renderCoreTrackerActionButton', 'syncTrackingFieldsFromIndex', 'clearDesktopSubtaskLayout', 'closeActiveWorkflowActionPicker',
  'clearFileBodyPanelRender']) host[name] = noOp;
 for (const name of ['schedulingDraftRefreshers', 'mobileCoreButtonRefreshers', 'filePropertyRows', 'desktopPropertyRows', 'workflowActionButtons']) host[name] = new Map();
 Object.assign(host, {
  isPhone: device === 'phone', isTablet: device === 'tablet', usesMobileLayout: false, usesTouchDesktopLayout: device !== 'desktop',
  fileBodyContext: { format, filePath: 'Tasks/Example.md' }, sourceContextWide: wide, isFileBodyVisible: false,
  timeTracker: { subscribe: noOp }, indexer: { subscribeIndexUpdates: noOp }, bodyDropdowns: [],
  settings: { taskEditorShowLineNumbers: true }, onSetShowLineNumbers: () => assert.fail('Hidden control must not save settings'),
  onSetHideScrollbars: noOp,
  registerSourceContextViewportListener() { calls.geometry++; host.updateSourceContextLayout(); },
  renderTaskEditorBody(container) { calls.rendered++; host.renderCoreActionButtons(container); },
  async openTaskEditorCheckboxPopover() { calls.checkbox++; },
  async requestSubtask(kind) { calls.subtasks.push(kind); },
  async flushPendingEdits() { calls.flush++; return true; },
  async refreshFileBodyDraftFromSource() { calls.source++; },
 });
 return { host, root, calls };
}

for (const device of ['desktop', 'tablet', 'phone']) for (const format of ['yaml', 'inline']) {
 test(`${device} ${format}: mounting and subtask refresh retain actions/context without legacy panel DOM`, async () => {
  const { host, root, calls } = retirementFixture(device, format, true);
  const context = host.fileBodyContext;
  const assertClosed = () => {
   for (const cls of ['operon-task-editor-file-panel', 'operon-task-editor-file-panel-backdrop', 'operon-editor-core-panel-toggle', 'operon-editor-core-line-numbers-action']) assert.equal(root.find(cls), undefined, cls);
   assert.equal(host.fileBodyContext, context);
   assert.ok(root.find('operon-editor-core-checkbox-popover-action'));
   assert.ok(root.find('operon-editor-core-subtask-action'));
   assert.equal(Boolean(root.find('operon-editor-core-scrollbars-action')), device !== 'phone');
   assert.equal(Boolean(root.find('operon-editor-core-inline-subtask-action')), format === 'yaml');
  };
  host.mountInto(root); assertClosed();
  await root.find('operon-editor-core-checkbox-popover-action').events.click();
  root.find('operon-editor-core-subtask-action').events.click();
  if (format === 'yaml') root.find('operon-editor-core-inline-subtask-action').events.click();
  assert.equal(calls.checkbox, 1);
  assert.deepEqual(calls.subtasks, format === 'yaml' ? [undefined, 'inline'] : [undefined]);
  await host.refreshAfterExternalTaskMutation(true); assertClosed();
  assert.equal(calls.flush, 1); assert.equal(calls.source, 1);
  host.mountInto(root); assertClosed();
  assert.equal(calls.rendered, 3);
  assert.equal(calls.geometry, device === 'phone' ? 0 : 2);
 });
}

for (const wide of [false, true]) {
 test(`closed-panel layout preserves context and ${wide ? 'wide' : 'narrow'} geometry classes`, () => {
  const { host, root } = retirementFixture('desktop', 'yaml', wide);
  host.mountInto(root);
  assert.ok(host.shellEl.classes.has('has-source-context'));
  assert.ok(root.modal.classes.has('operon-task-editor-modal-has-source-context'));
  assert.equal(root.modal.classes.has('operon-task-editor-modal-source-wide'), wide);
  assert.equal(root.modal.classes.has('operon-task-editor-modal-has-file-body'), false);
  assert.equal(host.shellEl.classes.has('is-file-body-visible'), false);
  assert.equal(host.shellEl.classes.has('is-file-body-overlay-visible'), false);
  assert.equal(host.mainPanelEl.scrollTop, 42);
 });
}

test('retired panel has no constructor, timers or controls; shared editors remain', () => {
 for (const name of ['isLegacyFileBodyPanelAvailable', 'renderFileBodyPanel', 'renderFileBodyToggle', 'setFileBodyVisible', 'scheduleFileBodyEditorLayoutRefresh', 'onSetShowLineNumbers']) {
  assert.equal(editorClass.members.some(node => node.name?.getText(ast) === name), false, name);
 }
 assert.equal(source.includes('new EmbeddedMarkdownSourceEditor'), false);
 assert.equal(source.includes('new Component()'), false);
 assert.ok(source.includes('createCompactMarkdownEditorSurface'));
 const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
 for (const selector of ['.operon-task-editor-file-panel', '.operon-editor-core-panel-toggle', '.operon-task-editor-title-file-toggle', '.operon-task-editor-file-bases-preview']) assert.equal(css.includes(selector), false, selector);
});
