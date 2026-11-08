import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function nodeIn(file, name) {
 const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
 let found;
 function visit(node) { if (node.name?.getText(ast) === name) found = node; ts.forEachChild(node, visit); }
 visit(ast);
 assert.ok(found, name);
 return { ast, node: found };
}
function evaluate(text, deps, self) {
 const js = ts.transpileModule(`const subject = ${text}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `${js}; return subject;`).call(self, ...Object.values(deps));
}
function functionIn(file, name, deps) {
 const { ast, node } = nodeIn(file, name);
 return evaluate(node.getText(ast).replace(/^export /u, ''), deps);
}
const surfaces = [
 ['Reading title', 'reading-task-wikilink-overlay', 'createTaskFileLinkLabel'],
 ['Reading alias or empty title', 'reading-task-wikilink-overlay', 'prepareTaskFileLinkAnchor'],
 ['Live Preview title', 'live-preview-task-wikilink-overlay', 'TaskWikilinkLabelWidget'],
 ['Reading dependency', 'reading-task-row', 'attachReadingChipAction'],
 ['Live Preview dependency', 'live-preview-conceal', 'attachLivePreviewChipAction'],
 ['Card dependency', 'compact-card-chips', 'attachKanbanChipAction'],
 ['Overlay dependency', 'task-wikilink-overlay-chips', 'attachOverlayChipAction'],
];
function fixture(surface, { mac = true, desktop = true, field = 'blocking', iconOnly = false, blocked = false } = {}) {
 const calls = [], pending = [], notices = [];
 const anchor = {}, label = anchor, chip = anchor;
 const app = { workspace: { openLinkText: (...args) => { calls.push(['legacy', ...args]); } } };
 const callbacks = { app, getFilePath: () => 'Host.md' };
 const resolved = { resolvedFile: { path: 'Target.md' }, sourcePath: 'Host.md' };
 const platform = { isDesktopApp: desktop, isMacOS: mac };
 const route = functionIn('src/ui/lightbox-opening.ts', 'openTaskFileLinkWithModifier', {
  Platform: platform,
  isTaskSourceOpenModifierClick: functionIn('src/ui/task-source-open-modifier.ts', 'isTaskSourceOpenModifierClick', { Platform: platform }),
  openLightboxTarget: async (...args) => { calls.push(['tab', ...args]); return 'opened'; },
  Notice: class { constructor(message) { notices.push(message); } },
 });
 const deps = {
  callbacks, resolved, label, anchor, chip, sourcePath: 'Host.md',
  isCompactTaskMarkdownLinkEventTarget: target => target?.innerLink === true,
  entry: { key: field, linkTarget: 'Target.md', iconOnly },
  task: { operonId: 'task001', primary: { filePath: 'Host.md' }, fieldValues: {} },
  getCurrent: undefined, onCommit: undefined, isTargetReadOnly: () => blocked,
  fieldValues: {}, view: {}, getLivePreviewCurrentFieldValues: () => ({}), snapshotLivePreviewAnchor: () => ({}),
  shouldOpenIconOnlyChipPreview: () => true, openIconOnlyChipPreview: () => calls.push(['preview']),
  openTaskFileLinkWithModifier: (...args) => { pending.push(route(...args)); },
 };
 const { ast, node } = nodeIn(`src/ui/${surface[1]}.ts`, surface[2]);
 const handlers = {};
 function visit(n) {
  if (ts.isCallExpression(n) && n.expression.getText(ast).endsWith('.addEventListener')) {
   const type = n.arguments[0]?.text;
   const body = n.arguments[1]?.getText(ast);
   if (body?.includes('openLinkText') || body?.includes('openTaskFileLinkWithModifier')) handlers[type] = evaluate(body, deps, { callbacks, resolved });
  }
  ts.forEachChild(n, visit);
 }
 visit(node);
 assert.ok(handlers.click, surface[0]);
 return { calls, notices, anchor, app, handlers, async fire(extra = {}) {
  handlers.click({ type: 'click', button: 0, detail: 1, target: anchor, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {}, ...extra });
  await Promise.all(pending);
 } };
}
for (const surface of surfaces) {
 for (const mac of [true, false]) for (const field of surface[0].includes('dependency') ? ['blocking', 'blockedBy'] : ['blocking']) {
  test(`${surface[0]} / ${field} / ${mac ? 'macOS' : 'Windows-Linux'}: only platform modifier uses focused-tab route`, async () => {
   const f = fixture(surface, { mac, field });
   await f.fire();
   await f.fire({ [mac ? 'ctrlKey' : 'metaKey']: true });
   await f.fire({ [mac ? 'metaKey' : 'ctrlKey']: true });
   assert.deepEqual(f.calls.slice(0, 2), [['legacy', 'Target.md', 'Host.md', false], ['legacy', 'Target.md', 'Host.md', false]]);
   assert.deepEqual(f.calls[2], ['tab', f.app, f.anchor, { kind: 'local', linktext: 'Target.md', sourcePath: 'Host.md' }, 'tab']);
   assert.equal(f.calls.length, 3);
   assert.deepEqual(f.notices, []);
  });
 }
 test(`${surface[0]}: mobile and keyboard-generated clicks retain legacy behavior`, async () => {
  const mobile = fixture(surface, { desktop: false }); await mobile.fire({ metaKey: true, ctrlKey: true });
  assert.deepEqual(mobile.calls, [['legacy', 'Target.md', 'Host.md', false]]);
  const keyboard = fixture(surface); await keyboard.fire({ detail: 0, metaKey: true });
  assert.deepEqual(keyboard.calls, mobile.calls);
 });
 if (surface[0].includes('dependency')) {
  test(`${surface[0]}: icon-only preview remains first and unrelated fallback stays unchanged`, async () => {
   const icon = fixture(surface, { iconOnly: true }); await icon.fire({ metaKey: true });
   assert.deepEqual(icon.calls, [['preview']]);
   const unrelated = fixture(surface, { field: 'assignees' }); await unrelated.fire({ metaKey: true });
   assert.deepEqual(unrelated.calls, [['legacy', 'Target.md', 'Host.md', false]]);
  });
 } else {
  test(`${surface[0]}: Enter and Space keep existing navigation`, () => {
   const f = fixture(surface);
   for (const key of ['Enter', ' ']) f.handlers.keydown({ target: f.anchor, key, metaKey: true, ctrlKey: true, preventDefault() {}, stopPropagation() {} });
   assert.deepEqual(f.calls, Array.from({ length: 2 }, () => ['legacy', 'Target.md', 'Host.md', false]));
  });
 }
}
test('title descriptions with their own inner links do not also open the outer task', async () => {
 for (const surface of [surfaces[0], surfaces[2]]) {
  const f = fixture(surface); await f.fire({ target: { innerLink: true }, metaKey: true }); assert.deepEqual(f.calls, []);
 }
});
test('card interaction blocker remains ahead of dependency navigation', async () => {
 const f = fixture(surfaces[5], { blocked: true }); await f.fire({ metaKey: true }); assert.deepEqual(f.calls, []);
});
test('extra modifiers never select split or window placement', async () => {
 const f = fixture(surfaces[0]); await f.fire({ metaKey: true, altKey: true, shiftKey: true });
 assert.equal(f.calls.length, 1); assert.equal(f.calls[0].at(-1), 'tab');
});

for (const surface of surfaces) test(`${surface[0]}: modifier double-click opens only one tab`, async () => {
 const f = fixture(surface);
 await f.fire({ metaKey: true, detail: 1 });
 await f.fire({ metaKey: true, detail: 2 });
 assert.equal(f.calls.length, 1);
 assert.equal(f.calls[0][0], 'tab');
});
