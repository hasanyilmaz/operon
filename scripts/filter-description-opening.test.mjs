import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = file => fs.readFileSync(file, 'utf8');
function evaluate(node, deps) {
 const js = ts.transpileModule(node, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `return ${js}`)(...Object.values(deps));
}
function descriptionHandlers(callbacks, task, desktop = true) {
 const ast = ts.createSourceFile('row.ts', read('src/ui/reading-task-row.ts'), ts.ScriptTarget.Latest, true);
 const description = {};
 const handlers = {};
 function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'description.addEventListener') {
   handlers[node.arguments[0].text] = evaluate(node.arguments[1].getText(ast), {
    callbacks, task, description, Platform: { isDesktopApp: desktop },
    isCompactTaskMarkdownLinkEventTarget: target => target?.innerLink === true,
   });
  }
  ts.forEachChild(node, visit);
 }
 visit(ast);
 return { handlers, description };
}
const click = (target, extra = {}) => ({ type: 'click', target, button: 0, detail: 1, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {}, ...extra });
const key = (target, value, extra = {}) => ({ type: 'keydown', target, key: value, repeat: false, preventDefault() {}, stopPropagation() {}, ...extra });

for (const format of ['inline', 'yaml']) {
 test(`${format}: filter description forwards pointer event and anchor instead of replacing current tab`, () => {
  const task = { operonId: 'task001', primary: { format } };
  const calls = [];
  const f = descriptionHandlers({ navigateToTask: () => calls.push('legacy'), activateDescription: (...args) => calls.push(args) }, task);
  const event = click(f.description, { metaKey: true });
  f.handlers.click(event);
  assert.deepEqual(calls, [[task, event, f.description]]);
 });
 test(`${format}: keyboard opens once; nested links and repeated keys do not activate the row`, () => {
  let opens = 0;
  const f = descriptionHandlers({ activateDescription: () => opens++, navigateToTask: () => assert.fail('legacy') }, { primary: { format } });
  f.handlers.click(click({ innerLink: true }));
  f.handlers.keydown(key({}, 'Enter'));
  f.handlers.keydown(key(f.description, 'Enter', { repeat: true }));
  f.handlers.click(click(f.description, { detail: 2 }));
  assert.equal(opens, 0);
  f.handlers.keydown(key(f.description, 'Enter', { metaKey: true }));
  f.handlers.keydown(key(f.description, ' '));
  assert.equal(opens, 2);
 });
}
test('mobile and non-filter reading rows keep legacy navigation', () => {
 for (const desktop of [false, true]) {
  let legacy = 0;
  const callbacks = { navigateToTask: () => legacy++ };
  if (!desktop) callbacks.activateDescription = () => assert.fail('desktop callback on mobile');
  const f = descriptionHandlers(callbacks, {}, desktop);
  f.handlers.click(click(f.description, { metaKey: true }));
  f.handlers.keydown(key(f.description, 'Enter'));
  assert.equal(legacy, 2);
 }
});

function member(file, name, deps = {}) {
 const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
 let found;
 function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name?.getText(ast) === name) found = node;
  ts.forEachChild(node, visit);
 }
 visit(ast);
 assert.ok(found, name);
 const js = ts.transpileModule(`class Subject { ${found.getText(ast)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `${js}; return Subject.prototype.${name};`)(...Object.values(deps));
}
function namedFunction(file, name, deps = {}) {
 const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
 const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
 assert.ok(node, name);
 const js = ts.transpileModule(node.getText(ast).replace(/^export /u, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(deps), `${js}; return ${name};`)(...Object.values(deps));
}
function routingFixture(mac, format) {
 class TFile {}
 const calls = [], pending = [];
 let current = { operonId: 'task001', primary: { format, filePath: 'Moved.md' } }, duplicate = false, file = new TFile();
 const route = member('main.ts', 'activateFilterTaskDescription', {
  TFile, runAsyncAction: (_label, action) => pending.push(action()),
  isTaskSourceOpenModifierClick: namedFunction('src/ui/task-source-open-modifier.ts', 'isTaskSourceOpenModifierClick', { Platform: { isMacOS: mac } }),
 });
 const host = {
  indexer: { getTask: () => current }, app: { vault: { getAbstractFileByPath: path => { assert.equal(path, 'Moved.md'); return file; } } },
  redirectDuplicateOperonIdAction: () => duplicate,
  showPluginUiMutationOutcome: reason => calls.push(['missing', reason]),
  openEditorForId: (...args) => calls.push(['editor', ...args]),
  openTaskSourcePreview: (...args) => calls.push(['source', ...args]),
 };
 return { calls, pending, route: (task, event, anchor) => route.call(host, task, event, anchor), remove: () => { current = null; }, duplicate: () => { duplicate = true; }, removeFile: () => { file = null; } };
}
for (const mac of [true, false]) for (const format of ['inline', 'yaml']) {
 test(`${mac ? 'Mac' : 'Windows/Linux'}/${format}: end-to-end description event routes without changing editor preferences`, async () => {
  const f = routingFixture(mac, format);
  const stale = { operonId: 'task001', primary: { format, filePath: 'Old.md' } };
  const row = descriptionHandlers({ activateDescription: f.route, navigateToTask: () => assert.fail('replaced filter tab') }, stale);
  row.description.ownerDocument = { name: 'secondary-window' };
  const events = [click(row.description), click(row.description, mac ? { metaKey: true } : { ctrlKey: true }),
   click(row.description, mac ? { ctrlKey: true } : { metaKey: true }),
   key(row.description, 'Enter', { metaKey: true, ctrlKey: true }), key(row.description, ' '),
   click(row.description, { metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })];
  for (const event of events) row.handlers[event.type === 'click' ? 'click' : 'keydown'](event);
  await Promise.all(f.pending);
  assert.deepEqual(f.calls.map(c => c[0]), ['editor', 'source', 'editor', 'editor', 'editor', 'source']);
  for (const call of f.calls) {
   assert.equal(call[1], 'task001');
   if (call[0] === 'editor') { assert.equal(call[2], undefined, 'existing source-panel preference'); assert.equal(call[3], row.description); }
   else { assert.equal(call[2], row.description); assert.ok(events.includes(call[3])); }
  }
 });
}
for (const action of ['remove', 'removeFile', 'duplicate']) test(`${action}: stale or ambiguous task cannot open an editor or tab`, async () => {
 for (const modifier of [false, true]) {
  const f = routingFixture(true, 'inline'); f[action]();
  f.route({ operonId: 'task001' }, click({}, { metaKey: modifier }), {});
  await Promise.all(f.pending);
  assert.equal(f.calls.some(c => c[0] === 'editor' || c[0] === 'source'), false);
  assert.equal(f.calls.length, action === 'duplicate' ? 0 : 1);
 }
});
test('source opening reuses the current shared resolver with the originating anchor and modifier event', async () => {
 const activeDocument = { activeElement: null, body: {} }, anchor = { ownerDocument: { name: 'secondary' } }, event = click(anchor, { metaKey: true });
 let current = { operonId: 'task001', primary: { format: 'yaml', filePath: 'First.md' } };
 let received;
 const open = member('main.ts', 'openTaskSourcePreview', {
  Platform: { isDesktopApp: true }, getActiveDocument: () => activeDocument, asHTMLElement: () => null,
  getActiveLightboxShell: () => null,
  activateResolvedOpening: async (a, context, e) => { received = [a, e]; current = { ...current, primary: { ...current.primary, filePath: 'Latest.md' } }; assert.equal(context.resolve().primary.filePath, 'Latest.md'); },
  resolveChipOpening: (entry, context) => { assert.equal(entry.key, 'taskInfo.source'); return context.getTask(); },
 });
 await open.call({ app: {}, settings: {}, indexer: { getTask: () => current, getAllTasks: () => [current] } }, 'task001', anchor, event);
 assert.deepEqual(received, [anchor, event]);
});
test('dynamic filters preserve root navigation guard for both desktop activation and mobile legacy navigation', () => {
 let captured;
 const render = namedFunction('src/ui/dynamic-file-task-filter.ts', 'renderDynamicTaskFilterSurface', {
  renderFilterSurface: (_instance, _filter, deps) => { captured = deps; }, getFilterSortSpecs: () => [],
 });
 const calls = [];
 render({}, { operonId: 'root001' }, {}, {}, { activateDescription: (...args) => calls.push(args), navigateToTask: task => calls.push(task) }, {});
 for (const event of [click({}, { metaKey: true }), click({}), key({}, 'Enter')]) captured.activateDescription({ operonId: 'root001' }, event, {});
 captured.navigateToTask({ operonId: 'root001' }); assert.deepEqual(calls, []);
 const child = { operonId: 'child01' }, event = click({}), anchor = {};
 captured.activateDescription(child, event, anchor); captured.navigateToTask(child);
 assert.deepEqual(calls, [[child, event, anchor], child]);
});
test('invalid rows block the new description activation and preserve legacy callers without it', () => {
 const guard = namedFunction('src/ui/reading-task-row.ts', 'guardReadingTaskRowActions');
 let blocked = 0;
 const safe = guard({ activateDescription: () => assert.fail('unguarded'), navigateToTask() {} }, () => blocked++);
 safe.activateDescription({}, click({}), {}); assert.equal(blocked, 1);
 assert.equal(guard({}, () => {}).activateDescription, undefined);
});
test('all filter providers forward the activation without changing unrelated navigation', () => {
 const providers = [
  ['src/ui/filter-view.ts', 'this.navigateToTask', 'this.activateDescription', 3],
  ['src/ui/filter-set-modal.ts', 'this.deps.navigateToTask', 'this.deps.activateDescription', 1],
  ['src/ui/embed-filter-processor.ts', 'deps.navigateToTask', 'deps.activateDescription', 2],
  ['src/ui/settings-tab.ts', 'this.filterPreviewNavigateToTask', 'this.filterPreviewActivateDescription', 1],
 ];
 for (const [file, navigation, activation, expected] of providers) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true); let checked = 0;
  function visit(node) {
   if (ts.isObjectLiteralExpression(node)) {
    const prop = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'navigateToTask' && p.initializer.getText(ast) === navigation);
    if (prop) {
     const target = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'activateDescription');
     assert.ok(target, file); assert.equal(target.initializer.getText(ast), activation, file); checked++;
    }
   }
   ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(checked, expected, file);
 }
});

test('main wires only filter dependency providers and passes activation into FilterView and Settings', () => {
 const ast = ts.createSourceFile('main.ts', read('main.ts'), ts.ScriptTarget.Latest, true);
 const providers = [], constructors = [];
 function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'activateDescription') {
   let parent = node.parent;
   while (parent && !ts.isMethodDeclaration(parent)) parent = parent.parent;
   providers.push(parent?.name.getText(ast));
  }
  if (ts.isNewExpression(node) && ['FilterView', 'OperonSettingsTab'].includes(node.expression.getText(ast))) {
   const arg = node.arguments.at(-1);
   assert.match(arg.getText(ast), /this\.activateFilterTaskDescription\(task, event, anchor\)/u);
   constructors.push(node.expression.getText(ast));
  }
  ts.forEachChild(node, visit);
 }
 visit(ast);
 assert.deepEqual(providers.sort(), ['buildFilterModalEvalDeps', 'buildFilterSurfaceDeps']);
 assert.deepEqual(constructors.sort(), ['FilterView', 'OperonSettingsTab']);
});

test('filter lightboxes recognize existing modal owners without changing their backdrop policy', () => {
 const ast = ts.createSourceFile('lightbox.ts', read('src/ui/lightbox.ts'), ts.ScriptTarget.Latest, true);
 let declaration;
 function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'modalOwner') declaration = node;
  ts.forEachChild(node, visit);
 }
 visit(ast); assert.ok(declaration);
 const owner = {};
 const element = cls => ({ closest: selector => selector.split(',').map(s => s.trim()).includes(cls) ? owner : null });
 for (const cls of ['.operon-focus-modal', '.operon-filter-preview-modal-shell', '.operon-subtasks-filter-modal']) {
  for (const fromSource of [false, true]) {
   const deps = { Platform: { isDesktopApp: true }, parent: undefined, anchor: element(fromSource ? '' : cls), source: fromSource ? { owner: element(cls) } : undefined, asHTMLElement: value => value };
   assert.equal(evaluate(declaration.initializer.getText(ast), deps), owner);
   deps.Platform.isDesktopApp = false;
   assert.equal(evaluate(declaration.initializer.getText(ast), deps), undefined);
  }
 }
 assert.equal(evaluate(declaration.initializer.getText(ast), { Platform: { isDesktopApp: true }, parent: undefined, anchor: element('.unrelated-modal'), source: undefined, asHTMLElement: value => value }), undefined);
 const inherited = {};
 assert.equal(evaluate(declaration.initializer.getText(ast), { Platform: { isDesktopApp: true }, parent: { modalOwner: inherited }, anchor: element('.operon-filter-preview-modal-shell'), source: undefined, asHTMLElement: value => value }), inherited);
});

test('filter modal recognition keeps file-filter dimming exclusion and existing preview appearance', () => {
 const subtasks = read('src/ui/subtasks-filter-modal.ts');
 assert.equal(subtasks.match(/this.options.fileTaskPath \? null : applyDesktopModalBackdrop\(this.containerEl\)/gu)?.length, 2);
 const preview = read('src/ui/filter-set-modal.ts').split('class FilterPreviewModal extends Modal')[1];
 assert.ok(preview.includes("this.modalEl.addClass('operon-filter-preview-modal-shell')"));
 assert.doesNotMatch(preview, /applyDesktopModalBackdrop|registerDesktopBackdrop/u);
});
