import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';

// Execute the production renderer with UI ports; do not copy its control flow.
const source = readFileSync(new URL('../src/ui/settings-tab.ts', import.meta.url), 'utf8');
const start = source.indexOf('private renderDeveloperApiIntegrations(');
const end = source.indexOf('private renderReleaseNotesSettingsCard(', start);
assert.ok(start >= 0 && end > start);
const code = transformSync(`class Harness { ${source.slice(start, end)} }`, { loader: 'ts', target: 'es2022' }).code;

function fixture(grants = [], rejectApprove = false) {
 const buttons = [], inputs = [], confirmations = [], calls = [], pending = [], nodes = [];
 const node = (kind = '') => {
  const value = { kind, dataset: {}, isConnected: true, checked: false, text: '',
   createEl(tag, options) { const child = node(tag); child.text = options?.text ?? ''; if (tag === 'input') inputs.push(child); return child; },
   createDiv(options) { return node(typeof options === 'string' ? options : ''); },
   createSpan() {}, addClass() {}, empty() { this.emptied = true; },
   addEventListener(event, callback) { this[event] = callback; },
  };
  nodes.push(value); return value;
 };
 class Setting {
  constructor() { this.settingEl = node(); }
  setName() { return this; }
  setDesc() { return this; }
  addButton(configure) {
   const button = { buttonEl: node(), disabled: false,
    setButtonText(text) { this.text = text; return this; },
    setCta() { return this; }, setDisabled(disabled) { this.disabled = disabled; return this; },
    onClick(callback) { this.click = callback; return this; },
   };
   buttons.push(button); configure(button); return this;
  }
 }
 const run = (_label, callback) => { const promise = callback(); pending.push(promise.catch(error => calls.push(['error', error.message]))); };
 class ConfirmActionModal {
  constructor(_app, _options, answer) { this.answer = answer; }
  open() { confirmations.push(this.answer); }
 }
 const Harness = new Function('Setting', 'renderNativeSettingsGroupedSection', 't', 'buildDeveloperApiGrantApprovalUiState', 'settingsAsyncHandler', 'runSettingsAsync', 'ConfirmActionModal', `${code}; return Harness;`)(
  Setting, () => node(), (_namespace, key) => key, grant => grant.ui,
  (label, callback) => () => run(label, callback), run, ConfirmActionModal,
 );
 const harness = new Harness();
 harness.developerApiIntegration = {
  listGrants: () => grants,
  listAudit: async () => [],
  approve: async (...args) => { calls.push(['approve', ...args]); if (rejectApprove) throw new Error('rejected'); },
  deny: async id => { calls.push(['deny', id]); },
  revoke: async id => { calls.push(['revoke', id]); },
  clearAudit: async () => { calls.push(['clear']); },
 };
 harness.redisplayPreservingScroll = () => calls.push(['redisplay']);
 return { buttons, inputs, confirmations, calls, nodes,
  render: () => harness.renderDeveloperApiIntegrations(node()),
  flush: async () => { await Promise.all(pending); },
  button: key => { const found = buttons.find(button => button.text === key); assert.ok(found, key); return found; },
 };
}
const pendingGrant = (binding = { consumerId: 'test' }) => ({
 consumerId: 'test', consumerName: 'Test', consumerVersion: '1.0.0', state: 'pending', grantedCapabilities: [], approvalBinding: binding,
 ui: { initialSelectedCapabilities: ['tasks.read', 'tasks.query'], pendingApprovalCapabilities: ['tasks.read', 'tasks.query'], showsApprovalControls: true, showsDeny: true, showsRevoke: false },
});

test('render, rerender and checkbox changes do not mutate settings; approval uses only selected scope', async () => {
 const f = fixture([pendingGrant()]); f.render(); await f.flush();
 assert.deepEqual(f.calls, []);
 f.inputs[1].checked = false; f.inputs[1].change();
 assert.deepEqual(f.calls, []);
 f.button('developerApiApproveSelected').click(); await f.flush();
 assert.deepEqual(f.calls, [['approve', { consumerId: 'test' }, ['tasks.read']], ['redisplay']]);
 f.calls.length = 0; f.render(); await f.flush(); assert.deepEqual(f.calls, []);
});
test('missing approval binding and empty selection disable approval', async () => {
 const missing = fixture([pendingGrant(null)]); missing.render();
 assert.equal(missing.button('developerApiApproveSelected').disabled, true);
 missing.button('developerApiApproveSelected').click(); await missing.flush(); assert.deepEqual(missing.calls, []);
 const empty = fixture([pendingGrant()]); empty.render();
 for (const input of empty.inputs) { input.checked = false; input.change(); }
 assert.equal(empty.button('developerApiApproveSelected').disabled, true);
 empty.button('developerApiApproveSelected').click(); await empty.flush(); assert.deepEqual(empty.calls, []);
});
test('denial calls only the pending grant action; failed approval does not report success', async () => {
 const f = fixture([pendingGrant()], true); f.render();
 f.button('developerApiApproveSelected').click(); await f.flush();
 assert.deepEqual(f.calls, [['approve', { consumerId: 'test' }, ['tasks.read', 'tasks.query']], ['error', 'rejected']]);
 f.calls.length = 0; f.button('developerApiDeny').click(); await f.flush();
 assert.deepEqual(f.calls, [['deny', 'test'], ['redisplay']]);
});
test('revocation and audit clear require confirmation; cancelling causes no mutation', async () => {
 const grant = { ...pendingGrant(), state: 'active', ui: { initialSelectedCapabilities: [], showsApprovalControls: false, showsRevoke: true } };
 for (const [button, expected] of [['developerApiRevoke', ['revoke', 'test']], ['developerApiAuditClear', ['clear']]]) {
  const f = fixture([grant]); f.render(); await f.flush();
  f.button(button).click(); f.confirmations.pop()(false); await f.flush(); assert.deepEqual(f.calls, []);
  f.button(button).click(); f.confirmations.pop()(true); await f.flush(); assert.deepEqual(f.calls, [expected, ['redisplay']]);
 }
});
test('an audit response does not redraw a detached settings host', async () => {
 const f = fixture(); f.render();
 const host = f.nodes.find(node => node.kind === 'operon-developer-api-audit-list'); assert.ok(host);
 host.isConnected = false; await f.flush(); assert.equal(host.emptied, undefined); assert.deepEqual(f.calls, []);
});
