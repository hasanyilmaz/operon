import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('src/ui/task-editor-content.ts');
const styles = read('styles.css');
const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true);
const editor = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'TaskEditorContent');
const method = editor.members.find(node => node.name?.getText(ast) === 'renderTrackingSessionsSection').getText(ast);
const scope = '.operon-task-editor.operon-task-editor-phone-desktop:not(.operon-task-editor-mobile)';
const phoneStart = styles.indexOf('/* Phone desktop editor only.');
const workspaceStart = styles.indexOf('/* A native source and its task editor share one overlay');
const phoneStyles = styles.slice(phoneStart, workspaceStart < 0 ? undefined : workspaceStart);
const rules = [...phoneStyles.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(match => ({ selector: match[1].trim(), body: match[2] }));
const rule = text => {
 const result = rules.find(item => item.selector.includes(text));
 assert.ok(result, `missing phone geometry rule: ${text}`);
 return result.body;
};

test('phone geometry is isolated from tablet, desktop and legacy mobile', () => {
 assert.ok(rules.length >= 10);
 for (const item of rules) {
  assert.ok(item.selector.includes(scope), item.selector);
  assert.doesNotMatch(item.body, /!important|font-size|border-radius|background|color:/u);
 }
 assert.match(rule(scope), /--operon-task-editor-property-control-height: 26px/u);
 assert.match(styles, /\.operon-task-editor\.operon-task-editor-touch-desktop \{\s*--operon-task-editor-property-control-height: 44px;/u);
 assert.doesNotMatch(phoneStyles, /operon-task-editor-touch-picker|file-source-editor|description-textarea|note-textarea/u);
});

test('phone actions, values, nested controls and clear buttons use consistent boxes', () => {
 const actions = rule(':is(button.operon-editor-core-action-btn');
 for (const declaration of ['width: 26px', 'height: 26px', 'min-width: 26px', 'min-height: 26px', 'padding: 0']) assert.ok(actions.includes(declaration));
 const token = rule(':is(.operon-editor-value-token,');
 assert.match(token, /height: 26px/u);
 assert.match(token, /min-height: 26px/u);
 assert.match(token, /padding-block: 0/u);
 const inner = rule('.operon-editor-value-token :is(button');
 assert.match(inner, /height: 24px/u);
 assert.match(inner, /min-width: 0/u);
 const clear = rule('button:is(.operon-editor-value-clear');
 assert.match(clear, /flex: 0 0 20px/u);
 assert.match(clear, /width: 20px/u);
 assert.match(clear, /height: 20px/u);
 const serial = rule('.operon-editor-description-actions .operon-editor-project-serial');
 assert.match(serial, /width: auto/u);
 assert.match(serial, /height: 26px/u);
});

test('phone labels ellipsize without collapsing the entire multi-value list', () => {
 const labels = rule(':is(.operon-inline-compact-chip-label');
 for (const declaration of ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap', 'overflow-wrap: normal']) assert.ok(labels.includes(declaration));
 assert.doesNotMatch(phoneStyles, /picker-selected|contexts-selected|tags-selected/u);
 assert.match(rule('button.operon-editor-stats-counter'), /height: 26px/u);
 assert.match(rule('> .operon-editor-core-title-badge'), /flex: 0 0 100%/u);
 assert.match(rule('> .operon-editor-core-title-badge'), /height: 30px/u);
 assert.doesNotMatch(phoneStyles, /tracking-session-range|tracking-session-body|font-size/u);
});

class Element {
 children = [];
 attrs = {};
 events = {};
 ownerDocument = { activeElement: null };
 textContent = '';
 constructor(tag = 'div', options = {}) {
  this.tag = tag;
  this.cls = typeof options === 'string' ? options : options.cls ?? '';
  if (typeof options !== 'string') { this.textContent = options.text ?? ''; this.attrs = { ...options.attr }; }
 }
 createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
 createDiv(options) { return this.createEl('div', options); }
 createSpan(options) { return this.createEl('span', options); }
 setText(value) { this.textContent = value; }
 setAttr(key, value) { this.attrs[key] = value; }
 addEventListener(key, callback) { this.events[key] = callback; }
 empty() { this.children = []; }
 find(cls) { return this.children.find(child => child.cls.split(' ').includes(cls)) ?? this.children.map(child => child.find(cls)).find(Boolean); }
}

for (const device of ['phone', 'tablet', 'desktop']) for (const enabled of [false, true]) {
 test(`Sessions ${device}, mobile toggle ${enabled}: icon, name, disabled state and add/save action`, async () => {
  const assignments = ['usesMobileLayout', 'usesTouchDesktopLayout'].map(name => {
   const constructor = editor.members.find(ts.isConstructorDeclaration);
   return constructor.body.statements.find(node => ts.isExpressionStatement(node) && node.expression.left?.getText(ast) === `this.${name}`).getText(ast);
  }).join('\n');
  const flags = { isPhone: device === 'phone', isTablet: device === 'tablet' };
  new Function('settings', assignments).call(flags, { taskEditorUseMobileLayout: enabled });
  assert.equal(flags.usesMobileLayout, device === 'phone' && enabled);
  assert.equal(flags.usesTouchDesktopLayout, device === 'tablet' || device === 'phone' && !enabled);
  let modalOptions, opened = 0, saved = 0, syncs = 0;
  class SessionModal {
   constructor(_app, options) { modalOptions = options; }
   open() { opened++; }
  }
  const compiled = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const Harness = new Function('t', 'setIcon', 'setAccessibleLabelWithoutTooltip', 'cleanupOperonHoverTooltips', 'runAsyncAction', 'TrackerSessionEditModal', `${compiled};return Harness;`)(
   (_category, key) => key, (node, icon) => { node.icon = icon; }, (node, label) => node.setAttr('aria-label', label), () => {}, (_label, action) => action(), SessionModal,
  );
  const host = new Harness();
  Object.assign(host, flags, { app: {}, description: 'Task', desktopSectionLabel: () => 'Sessions', appendCanonicalIcon() {},
   bindTaskEditorTooltip(node, label) { node.tooltip = label; }, getCurrentTaskSessions: () => [], ensureTaskReadyForTracking: async () => 'task001',
   buildTrackerSessionTaskNoteOptions: () => ({}), syncTrackingFieldsFromIndex() { syncs++; }, timeTracker: { async addSession(id, start, end) { assert.deepEqual([id, start, end], ['task001', 10, 20]); saved++; return true; } },
  });
  const root = new Element(); host.renderTrackingSessionsSection(root);
  const button = root.find('operon-editor-tracking-sessions-add');
  assert.equal(button.icon, flags.usesMobileLayout ? 'plus' : 'clock-plus');
  assert.equal(button.children.some(child => child.textContent === 'addSession'), flags.usesMobileLayout);
  if (!flags.usesMobileLayout) { assert.equal(button.attrs['aria-label'], 'addSession'); assert.equal(button.tooltip, 'addSession'); }
  host.description = ''; host.refreshTrackingSessionsSection(); assert.equal(button.disabled, true);
  host.description = 'Task'; host.refreshTrackingSessionsSection(); assert.equal(button.disabled, false);
  await button.events.click(); assert.equal(opened, 1);
  assert.equal(modalOptions.title, 'addSession');
  assert.equal(modalOptions.contextTitle, 'Task');
  assert.equal(modalOptions.contextMeta, undefined);
  assert.equal(modalOptions.initialStart, undefined);
  assert.equal(modalOptions.initialEnd, undefined);
  assert.equal(await modalOptions.onSave(10, 20), undefined); assert.equal(saved, 1); assert.equal(syncs, 1);
 });
}
