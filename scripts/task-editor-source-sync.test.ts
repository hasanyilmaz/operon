import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mergeTaskEditorSource, taskEditorChangedKeys, type TaskEditorSourceState } from '../src/ui/task-editor-source-sync';
import { createTaskEditorMarkdownSource } from '../src/ui/task-editor-markdown-source';
import { TFile, type App, type EditorPosition, type MarkdownView } from 'obsidian';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { parseTaskLine } from '../src/core/parser';
import { serializeTask } from '../src/core/serializer';
import { materializeInlineOccurrenceLines } from '../src/systems/recurrence-service';
import { readFileTaskPropertyDocument, fileTaskPropertyIdentityMatches } from '../src/core/file-task-property-draft';
import { isManagedYamlCanonicalKey } from '../src/core/yaml-fields';
import { resolveWorkflowStatus } from '../src/types/pipeline';
import { readTaskEditorMarkdown } from '../src/ui/task-editor-markdown-source';
import { EditorState } from '@codemirror/state';
import { editorInfoField } from 'obsidian';
import { NativeLightboxLifecycle } from '../src/ui/native-lightbox-lifecycle';
import { lightboxBodyStart, nativeLightboxBodyExtension } from '../src/ui/native-lightbox-body';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { DEFAULT_FILENAME_RULE, filenameSuggestionAfterTitleEdit } from '../src/core/filename-rule';
import { t } from '../src/core/i18n';

const state = (fields: Record<string, string> = {}): TaskEditorSourceState => ({ description: 'before', checkbox: 'open', tags: ['one'], fieldValues: { operonId: 'task1', priority: 'A', note: 'old note', ...fields } });
const baseline = state();
for (const key of ['priority', 'note', 'status', 'dateScheduled', 'parentTask', 'contexts', 'estimate']) {
 test(`source refresh preserves local ${key} and accepts unrelated source changes`, () => {
  const draft = state({ [key]: 'local' }), latest = { ...state({ [key]: 'remote', unknown: 'retain' }), description: 'Markdown edit' };
  const merged = mergeTaskEditorSource(latest, draft, taskEditorChangedKeys(baseline, draft));
  assert.equal(merged.description, 'Markdown edit'); assert.equal(merged.fieldValues[key], 'local'); assert.equal(merged.fieldValues.unknown, 'retain');
  assert.equal(latest.fieldValues[key], 'remote');
 });
}
for (const clear of ['', undefined]) test(`explicit field clear ${String(clear)} survives remote update`, () => {
 const draft = state(); if (clear === undefined) delete draft.fieldValues.note; else draft.fieldValues.note = clear;
 const result = mergeTaskEditorSource(state({ note: 'remote' }), draft, taskEditorChangedKeys(baseline, draft));
 assert.equal(result.fieldValues.note, clear);
});
test('description, checkbox and empty tag list are independent edit intents', () => {
 const draft = { ...state(), description: 'local', checkbox: 'done' as const, tags: [] };
 assert.deepEqual(taskEditorChangedKeys(baseline, draft), ['_description', '_checkbox', '_tags']);
 const merged = mergeTaskEditorSource({ ...state({ priority: 'B' }), description: 'remote' }, draft, taskEditorChangedKeys(baseline, draft));
 assert.equal(merged.description, 'local'); assert.equal(merged.checkbox, 'done'); assert.deepEqual(merged.tags, []); assert.equal(merged.fieldValues.priority, 'B');
});
test('source-only and timestamp changes do not become user edits', () => {
 assert.deepEqual(taskEditorChangedKeys(baseline, state({ datetimeModified: 'now', pinned: 'true' })), []);
 assert.deepEqual(taskEditorChangedKeys(baseline, structuredClone(baseline)), []);
});

function nativeFixture(initial = '---\nid: task1\n---\nbody') {
 const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: 'task.md', name: 'task.md', basename: 'task', extension: 'md', stat: { mtime: 1, size: initial.length } });
 let disk = initial, writes = 0, transactions = 0, saves = 0;
 const views: MarkdownView[] = [];
 const app = { vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : null,
  read: async () => disk, process: async (_file: TFile, callback: (value: string) => string) => { disk = callback(disk); writes++; },
 } } as unknown as App;
 function addView(value = initial) {
  let text = value;
  const view = { file, editor: { getValue: () => text, offsetToPos: (offset: number) => {
   const prefix = text.slice(0, offset).split('\n'); return { line: prefix.length - 1, ch: prefix.at(-1)!.length };
  },
   transaction: (spec: { changes: { from: EditorPosition; to: EditorPosition; text: string }[]; selection?: unknown }) => {
    assert.equal(spec.selection, undefined, 'selection is mapped by the native editor');
    const offset = (pos: EditorPosition) => text.split('\n').slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
    for (const change of spec.changes) text = text.slice(0, offset(change.from)) + change.text + text.slice(change.to ? offset(change.to) : offset(change.from));
    transactions++;
   },
  }, save: async () => { disk = text; saves++; } } as unknown as MarkdownView;
  views.push(view); return { view, edit: (value: string) => { text = value; } };
 }
 return { app, file, views, addView, source: () => createTaskEditorMarkdownSource(app, file, () => views), disk: () => disk, changeDisk: (value: string) => { disk = value; }, counts: () => ({ writes, transactions, saves }) };
}

// Reproduce the native Properties guard observed in Obsidian: a selection
// mapped into the old frontmatter extent rejects an unmarked YAML edit.
function propertiesSourceFixture() {
 const initial = '---\noperonId: task1\nUp:\n  - "[[One]]"\nTier: A\nStatus: Planned\nScheduled: 2026-10-22\nEstimate: 1\nCustom: old\nNotes: ""\n---\nunsaved body';
 const f = nativeFixture(initial);
 f.addView();
 const editor = {} as MarkdownView['editor'];
 const view = { file: f.file, editor, getViewType: () => 'markdown', save: async () => {} } as unknown as MarkdownView;
 const lifecycle = new NativeLightboxLifecycle(f.app, { view } as never);
 let rejected = 0;
 let cm = EditorState.create({ doc: initial, extensions: [
  editorInfoField.init(() => ({ app: f.app, file: f.file, editor, hoverPopover: null })),
  nativeLightboxBodyExtension(f.app),
  EditorState.transactionFilter.of(transaction => {
   if (!transaction.docChanged || transaction.isUserEvent('set')) return transaction;
   const oldEnd = lightboxBodyStart(transaction.startState.doc) - 1;
   let yamlChange = false;
   transaction.changes.iterChangedRanges((from, to) => { if (from >= 3 && to < oldEnd) yamlChange = true; });
   if (yamlChange && transaction.newSelection.ranges.some(range => range.from <= oldEnd)) { rejected++; return []; }
   return transaction;
  }),
 ] });
 cm = cm.update({ selection: { anchor: lightboxBodyStart(cm.doc) } }).state;
 const origins: (string | undefined)[] = [];
 editor.getValue = () => cm.doc.toString();
 editor.offsetToPos = offset => { const line = cm.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; };
 editor.transaction = (spec, origin) => {
  origins.push(origin);
  cm = cm.update({ changes: spec.changes?.map(change => ({
   from: cm.doc.line(change.from.line + 1).from + change.from.ch,
   to: change.to ? cm.doc.line(change.to.line + 1).from + change.to.ch : cm.doc.line(change.from.line + 1).from + change.from.ch,
   insert: change.text,
  })), userEvent: origin }).state;
 };
 f.views.push(view);
 return { ...f, initial, lifecycle, origins, state: () => cm, rejected: () => rejected };
}

for (const [field, before, after] of [
 ['contexts', '  - "[[One]]"', '  - "[[One]]"\n  - "[[Two]]"'],
 ['priority', 'Tier: A', 'Tier: B'], ['status', 'Status: Planned', 'Status: Finished'],
 ['scheduled', 'Scheduled: 2026-10-22', 'Scheduled: 2026-10-23'],
 ['estimate', 'Estimate: 1', 'Estimate: 2'], ['additional', 'Custom: old', 'Custom: new'],
] as const) test(`native Properties permits ${field} save followed by shrinking empty-field normalization`, async () => {
 const f = propertiesSourceFixture();
 try {
  const port = await f.source();
  const changed = f.initial.replace(before, after);
  await port.write(f.initial, changed);
  const normalized = changed.replace('Notes: ""', 'Notes:');
  await port.write(changed, normalized);
  assert.equal(f.rejected(), 0);
  assert.deepEqual(f.origins, ['set', 'set']);
  assert.equal(await port.read(), normalized);
  assert.equal(f.disk(), normalized);
  assert.ok(f.views.every(view => view.editor.getValue() === normalized));
  assert.ok(f.state().selection.main.from >= lightboxBodyStart(f.state().doc));
  assert.ok(normalized.endsWith('unsaved body'));
  for (const userEvent of ['input.type', 'input.paste', 'delete.cut', 'input.replace.all']) {
   const blocked = f.state().update({ changes: { from: 4, to: 14, insert: 'lost' }, userEvent });
   assert.equal(blocked.newDoc.toString(), normalized, `${userEvent} must still protect YAML`);
  }
 } finally { f.lifecycle.dispose(); }
});

test('body-only source patches keep their existing native origin and preserve frontmatter', async () => {
 const f = propertiesSourceFixture();
 try {
  const port = await f.source();
  const next = f.initial.replace('unsaved body', 'inline task change');
  await port.write(f.initial, next);
  assert.deepEqual(f.origins, [undefined]);
  assert.equal(await port.read(), next);
 } finally { f.lifecycle.dispose(); }
});

test('trusted YAML origin cannot overwrite a newer body edit shared by both native views', async () => {
 const f = propertiesSourceFixture();
 try {
  const port = await f.source();
  for (const view of f.views) view.editor.transaction({ changes: [{ from: view.editor.offsetToPos(f.initial.length), text: ' newer' }] }, 'input.type');
  await assert.rejects(port.write(f.initial, f.initial.replace('Tier: A', 'Tier: B')), /changed during save/);
  assert.ok(f.views.every(view => view.editor.getValue() === f.initial + ' newer'));
  assert.deepEqual(f.origins, ['input.type']);
  assert.equal(f.counts().saves, 0);
  assert.equal(f.disk(), f.initial);
 } finally { f.lifecycle.dispose(); }
});

test('cancelled YAML source save never reaches the native Properties update', async () => {
 const f = propertiesSourceFixture();
 try {
  const port = await f.source();
  await assert.rejects(port.write(f.initial, f.initial.replace('Tier: A', 'Tier: B'), () => false), /changed during save/);
  assert.deepEqual(f.origins, []);
  assert.equal(f.counts().transactions, 0);
  assert.equal(f.disk(), f.initial);
 } finally { f.lifecycle.dispose(); }
});
test('native unsaved body is the source and YAML writes preserve it in all owned views', async () => {
 const f = nativeFixture(); f.addView('---\nid: task1\n---\nunsaved'); f.addView('---\nid: task1\n---\nunsaved');
 const source = await f.source(), before = await source.read();
 await source.write(before, before.replace('id:', 'operonId:'));
 assert.match(f.disk(), /unsaved$/); assert.equal(f.views[0].editor.getValue(), f.views[1].editor.getValue());
 assert.deepEqual(f.counts(), { transactions: 2, writes: 0, saves: 1 });
});
test('normal and native views sharing one live buffer receive a single patch', async () => {
 const f = nativeFixture(); const primary = f.addView();
 f.views.push({ ...primary.view } as MarkdownView);
 const port = await f.source(), before = await port.read(), next = before + '!';
 await port.write(before, next);
 assert.equal(primary.view.editor.getValue(), next);
 assert.equal(f.disk(), next);
 assert.deepEqual(f.counts(), { transactions: 1, writes: 0, saves: 1 });
});
test('synchronous native propagation cannot overwrite a newer secondary buffer', async () => {
 const f = nativeFixture(), primary = f.addView(), secondary = f.addView();
 const transaction = primary.view.editor.transaction.bind(primary.view.editor);
 primary.view.editor.transaction = (...args) => { transaction(...args); secondary.edit('newer native edit'); };
 const port = await f.source(), before = await port.read();
 await assert.rejects(port.write(before, before + '!'));
 assert.equal(secondary.view.editor.getValue(), 'newer native edit');
 assert.equal(f.counts().saves, 0);
});
test('no-op source open/read/write does not save or transact', async () => {
 const f = nativeFixture(); f.addView(); const port = await f.source(); const text = await port.read(); await port.write(text, text);
 assert.deepEqual(f.counts(), { transactions: 0, writes: 0, saves: 0 });
});
test('divergent normal and lightbox buffers fail without selecting a random source', async () => {
 const f = nativeFixture(); f.addView('one'); f.addView('two'); await assert.rejects(f.source(), /disagree/); assert.equal(f.counts().saves, 0);
});
test('edit during an operation rejects the write and keeps the newer native text', async () => {
 const f = nativeFixture(); const view = f.addView(); const port = await f.source(), text = await port.read(); view.edit('new user text');
 await assert.rejects(port.write(text, 'old write'), /changed/); assert.equal(view.view.editor.getValue(), 'new user text'); assert.equal(f.counts().saves, 0);
});
for (const action of ['close', 'navigate']) test(`${action} of an owning native view rejects late writes`, async () => {
 const f = nativeFixture(); const { view } = f.addView(); const port = await f.source(), text = await port.read();
 if (action === 'close') f.views.length = 0; else view.file = {} as TFile;
 await assert.rejects(port.write(text, 'late')); assert.equal(f.counts().transactions, 0);
});
test('disk-only source uses compare and swap and rejects an external disk edit', async () => {
 const f = nativeFixture(); const port = await f.source(), text = await port.read(); f.changeDisk('new disk');
 await assert.rejects(port.write(text, 'old disk')); assert.equal(f.disk(), 'new disk');
});
test('renamed file object remains owned and saves to its current location', async () => {
 const f = nativeFixture(); f.addView(); const port = await f.source(); f.file.path = 'renamed.md'; const before = await port.read(); await port.write(before, before + '!'); assert.equal(f.disk(), before + '!');
});
test('cancelled commit does not modify native or disk source', async () => {
 const f = nativeFixture(); f.addView(); const port = await f.source(); await assert.rejects(port.write(await port.read(), 'new', () => false)); assert.equal(f.counts().transactions, 0);
});
test('failed native save propagates failure instead of silently acknowledging', async () => {
 const f = nativeFixture(); const { view } = f.addView(); view.save = async () => { throw new Error('save failed'); };
 const port = await f.source(); await assert.rejects(port.write(await port.read(), 'next'), /save failed/);
});

// Execute the production methods, using bounded collaborators instead of loading the plugin UI.
function methods(file: string, names: string[], dependencies: Record<string, unknown> = {}) {
 const source = readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const klass = ast.statements.find(node => ts.isClassDeclaration(node) && names.every(name => node.members.some(member => member.name?.getText(ast) === name))) as ts.ClassDeclaration;
 assert.ok(klass, `class containing ${names}`);
 const selected = names.map(name => klass.members.find(member => member.name?.getText(ast) === name)!.getText(ast)).join('\n');
 const code = ts.transpileModule(`class Fixture { ${selected} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(dependencies), `${code}; return Fixture;`)(...Object.values(dependencies));
}
const Content = methods('src/ui/task-editor-content.ts', ['taskSourceState', 'refreshTaskSource', 'applyCanonicalSaveCommit'], {
 mergeTaskEditorSource, taskEditorChangedKeys,
 areStringArraysEqual: (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b),
 mergeCanonicalFieldValuesIntoDraft: (current: Record<string,string>, submitted: Record<string,string>, canonical: Record<string,string>) => mergeTaskEditorSource(state(canonical), state(current), taskEditorChangedKeys(state(submitted), state(current))).fieldValues,
});
function contentFixture() {
 const editor = new Content(); let refreshes = 0;
 Object.assign(editor, { taskOperonId: 'task1', sourceRefreshGeneration: 0, description: baseline.description, persistedDescription: baseline.description,
  checkbox: baseline.checkbox, persistedCheckbox: baseline.checkbox, tags: [...baseline.tags], persistedTags: [...baseline.tags],
  fieldValues: { ...baseline.fieldValues }, persistedFieldValues: { ...baseline.fieldValues }, existingTask: { filePath: 'old.md', lineNumber: 4 },
  readSource: async () => ({ state: { ...state({ priority: 'B', note: 'new note' }), description: 'remote' }, filePath: 'new.md', lineNumber: 17 }),
  getCompactTextSourcePath: () => 'old.md', syncExistingTaskCanonicalState() {}, refreshDesktopPropertyRows: () => refreshes++, refreshSchedulingDraftControls() {}, refreshMobileCoreButtons() {}, refreshFileTaskName() {},
 });
 return { editor, refreshes: () => refreshes };
}
test('live content refresh follows identity location, retains local draft and does not mark dirty', async () => {
 const { editor } = contentFixture(); editor.fieldValues.priority = 'local'; editor.editVersion = 7; editor.hasBeenEdited = true;
 await editor.refreshTaskSource(); assert.equal(editor.description, 'remote'); assert.equal(editor.fieldValues.priority, 'local');
 assert.equal(editor.persistedFieldValues.priority, 'B'); assert.equal(editor.fieldValues.note, 'new note');
 assert.equal(editor.existingTask.filePath, 'new.md'); assert.equal(editor.existingTask.lineNumber, 17); assert.equal(editor.editVersion, 7);
});
for (const guard of ['disposed', 'persistInFlight', 'sourceComposing', 'workflowActionPickerClose', 'closeFilePropertyPicker', 'mobilePickerOpenDepth']) test(`${guard} protects active editor interaction`, async () => {
 const { editor, refreshes } = contentFixture(); editor[guard] = true; await editor.refreshTaskSource(); assert.equal(editor.description, 'before'); assert.equal(refreshes(), 0);
 editor[guard] = false; await editor.refreshTaskSource(); assert.equal(editor.description, 'remote');
});
test('late source response cannot update a closed editor or win over a newer response', async () => {
 const { editor } = contentFixture(); const resolves: ((value: unknown) => void)[] = [];
 editor.readSource = () => new Promise(resolve => resolves.push(resolve)); const first = editor.refreshTaskSource(), second = editor.refreshTaskSource();
 resolves[1]({ state: { ...state(), description: 'new' }, filePath: 'x.md', lineNumber: 2 }); await second;
 resolves[0]({ state: { ...state(), description: 'old' }, filePath: 'x.md', lineNumber: 1 }); await first; assert.equal(editor.description, 'new');
 const third = editor.refreshTaskSource(); editor.disposed = true; resolves[2]({ state: state(), filePath: 'x.md', lineNumber: 0 }); await third; assert.equal(editor.description, 'new');
});
test('compact IME conflict defers source refresh without replacing its surface', async () => {
 const { editor } = contentFixture(); const surface = { setSourceValue: () => 'conflict' }; editor.descriptionCompactEditor = surface;
 await editor.refreshTaskSource(); assert.equal(editor.description, 'before'); assert.equal(editor.descriptionCompactEditor, surface);
 surface.setSourceValue = () => 'applied'; await editor.refreshTaskSource(); assert.equal(editor.description, 'remote');
});
test('save acknowledgement keeps typing made after submission', () => {
 const { editor } = contentFixture(); const submitted = state(); editor.description = 'typed during save'; editor.fieldValues.priority = 'C';
 editor.applyCanonicalSaveCommit({ ...state({ priority: 'B' }), description: 'committed' }, submitted);
 assert.equal(editor.description, 'typed during save'); assert.equal(editor.fieldValues.priority, 'C'); assert.equal(editor.persistedDescription, 'committed');
});
test('missing source keeps the complete draft and baseline', async () => {
 const { editor } = contentFixture(); editor.readSource = async () => { throw new Error('missing'); }; await editor.refreshTaskSource(); assert.equal(editor.description, 'before'); assert.deepEqual(editor.fieldValues, baseline.fieldValues);
});

// Rebase integration runs the real source scanner, parser and serializer against an unsaved native buffer.

const Main = methods('main.ts', ['readTaskEditorSource', 'saveSynchronizedTaskEditor', 'parsedTaskFromIndexed'], {
 TFile, scanFileWithMappings, readTaskEditorMarkdown, readFileTaskPropertyDocument, fileTaskPropertyIdentityMatches,
 isManagedYamlCanonicalKey, resolveWorkflowStatus, createTaskEditorMarkdownSource, mergeTaskEditorSource, serializeTask,
 localNow: () => '2026-01-01T10:00:00',
 buildTaskEditorOperonField: (key: string, value: string) => ({ key, value, rawValue: value, sourceKey: key, type: 'text', isCanonical: true, containerRange: { from: 0, to: 0 }, valueRange: { from: 0, to: 0 } }),
});
function mainFixture(content: string, format: 'inline' | 'yaml' = 'inline') {
 const f = nativeFixture(content), native = f.addView(), main = new Main();
 let task: unknown = { operonId: 'task001', description: 'stale index description', checkbox: 'open', tags: [], fieldValues: { operonId: 'task001', priority: 'A' }, primary: { filePath: f.file.path, lineNumber: 0, format }, datetimeModified: '', tier: 'hot' };
 let duplicate = false;
 Object.assign(main, { app: f.app, settings: { keyMappings: [], pipelines: [] }, indexer: { getTask: () => task, hasDuplicateOperonIdConflict: () => duplicate },
  getMarkdownViewsForPath: () => f.views, parseInlineTaskLine: (line: string, row: number, path: string) => parseTaskLine(line, row, path, []),
  getInlineWriteKeyName: (key: string) => key, writer: { withMarkdownSource: async (_source: unknown, operation: () => Promise<unknown>) => operation() }, showTaskEditorMutationOutcome() {},
 });
 return { ...f, native, main, duplicate: () => { duplicate = true; }, remove: () => { task = null; } };
}
const inline = '- [ ] original {{operonId:: task001}} {{priority:: A}}';
for (const remoteFirst of [true, false]) test(`native description plus editor priority survive either refresh order (${remoteFirst})`, async () => {
 const f = mainFixture(inline), baseline = (await f.main.readTaskEditorSource('task001')).state;
 const draft = { ...baseline, fieldValues: { ...baseline.fieldValues, priority: 'B' } };
 if (remoteFirst) f.native.edit(inline.replace('original', 'native text') + '\nunsaved body');
 const changedKeys = taskEditorChangedKeys(baseline, draft);
 if (!remoteFirst) f.native.edit(inline.replace('original', 'native text') + '\nunsaved body');
 const result = await f.main.saveSynchronizedTaskEditor({ taskLine: inline.replace('priority:: A', 'priority:: B'), isNew: false, inlineCompletionMode: 'keep-completed', fileBody: null, sourceSync: { operonId: 'task001', baseline, changedKeys } }, async (request: { markdownSource: { read(): Promise<string>; write(before: string, next: string): Promise<string> }; taskLine: string }, fresh: { description: string }) => {
  assert.equal(fresh.description, 'native text'); const before = await request.markdownSource.read();
  await request.markdownSource.write(before, request.taskLine + '\nunsaved body'); return true;
 });
 assert.ok(result); assert.match(f.disk(), /native text/); assert.match(f.disk(), /priority:: B/); assert.match(f.disk(), /unsaved body/);
 assert.equal(result.canonicalState.description, 'native text');
});
test('source scanner follows shifted inline line and rejects deleted or duplicate identities', async () => {
 const f = mainFixture('heading\n\n' + inline); assert.equal((await f.main.readTaskEditorSource('task001')).lineNumber, 2);
 f.native.edit(inline + '\n' + inline); await assert.rejects(f.main.readTaskEditorSource('task001'), /identity/);
 f.native.edit('- [ ] replacement {{operonId:: other01}}'); await assert.rejects(f.main.readTaskEditorSource('task001'), /identity/);
 f.native.edit(inline); f.duplicate(); await assert.rejects(f.main.readTaskEditorSource('task001'), /identity/);
});
test('file task source reads native YAML and leaves its body intact', async () => {
 const f = mainFixture('---\noperonId: task001\npriority: B\ncustom: keep\n---\nunsaved body', 'yaml');
 const snapshot = await f.main.readTaskEditorSource('task001'); assert.equal(snapshot.state.fieldValues.priority, 'B'); assert.equal(snapshot.state.description, 'task');
 assert.equal(f.counts().saves, 0); assert.match(f.native.view.editor.getValue(), /custom: keep/);
});
test('source failure never calls the domain writer or recreates a removed task', async () => {
 const f = mainFixture(inline); f.remove(); let saves = 0;
 const result = await f.main.saveSynchronizedTaskEditor({ sourceSync: { operonId: 'task001', baseline: state(), changedKeys: ['priority'] }, taskLine: inline, isNew: false }, async () => { saves++; return true; });
 assert.equal(result, false); assert.equal(saves, 0); assert.equal(f.counts().saves, 0);
});

test('two editor sessions merge against the current source rather than their shared old baseline', async () => {
 const f = mainFixture(inline), baseline = (await f.main.readTaskEditorSource('task001')).state;
 const save = async (line: string, changedKeys: string[]) => f.main.saveSynchronizedTaskEditor({ taskLine: line, isNew: false, fileBody: null, sourceSync: { operonId: 'task001', baseline, changedKeys } }, async (request: { markdownSource: { read(): Promise<string>; write(before: string, next: string): Promise<string> }; taskLine: string }) => {
  await request.markdownSource.write(await request.markdownSource.read(), request.taskLine); return true;
 });
 await save(inline.replace('priority:: A', 'priority:: B'), ['priority']);
 await save(inline.replace('original', 'second editor'), ['_description']);
 assert.match(f.disk(), /second editor/); assert.match(f.disk(), /priority:: B/);
});
test('same-field conflict keeps the local editor intent at the actual save boundary', async () => {
 const f = mainFixture(inline), baseline = (await f.main.readTaskEditorSource('task001')).state;
 f.native.edit(inline.replace('original', 'remote'));
 await f.main.saveSynchronizedTaskEditor({ taskLine: inline.replace('original', 'local'), isNew: false, sourceSync: { operonId: 'task001', baseline, changedKeys: ['_description'] } }, async (request: { taskLine: string }) => {
  assert.match(request.taskLine, /local/); assert.doesNotMatch(request.taskLine, /remote/); return false;
 });
 assert.match(f.native.view.editor.getValue(), /remote/); assert.equal(f.counts().saves, 0);
});
test('untouched mapped source fields use the new baseline while Additional expectations remain unchanged', async () => {
 const f = mainFixture(inline + ' {{custom:: old}}'), snapshot = await f.main.readTaskEditorSource('task001');
 f.native.edit(inline + ' {{custom:: new}}');
 const changes = [{ sourceName: 'Other', expected: { present: false }, mutation: { kind: 'set', value: 'typed' }, type: 'text' }];
 await f.main.saveSynchronizedTaskEditor({ taskLine: inline + ' {{custom:: old}}', isNew: false, inlineSourceFields: snapshot.parsed.fields, inlineProperties: changes, sourceSync: { operonId: 'task001', baseline: snapshot.state, changedKeys: ['priority'] } }, async (request: { inlineProperties: unknown; inlineSourceFields: { key: string; value: string }[] }) => {
  assert.equal(request.inlineProperties, changes);
  assert.equal(request.inlineSourceFields.find(field => field.key === 'custom')?.value, 'new'); return false;
 });
});
const InlineWriter = methods('main.ts', ['replaceInlineTaskById'], {});
test('inline native saves retain the existing exclusive permit and writer queue', async () => {
 const host = new InlineWriter(), permit = {}, source = { read: async () => inline };
 let called = 0;
 Object.assign(host, { settings: { keyMappings: [] }, indexer: { hasDuplicateOperonIdConflict: () => false, getTask: () => ({ primary: { filePath: 'task.md' } }) },
  writer: { runExclusiveTaskMutation: async (operation: (token: object) => Promise<boolean>) => operation(permit),
   applyExactMarkdownSourceMutation: async (path: string, before: string, after: string, allowed: () => boolean, token: unknown, origin: string) => {
    assert.equal(path, 'task.md'); assert.equal(before, inline); assert.equal(after, 'next'); assert.equal(allowed(), true); assert.equal(token, permit); assert.equal(origin, 'plugin'); called++; return { outcome: 'committed' };
   } }, replaceInlineTaskLineInContent: () => 'next', markInternalTaskWrite() {},
 });
 assert.equal(await host.replaceInlineTaskById('task.md', 'task001', 'next', 0, { source, inlineProperties: [{}] }), true); assert.equal(called, 1);
});

const Recurrence = methods('src/systems/recurrence-service.ts', ['materializeInlineOccurrence'], { TFile, parseTaskLine, materializeInlineOccurrenceLines });
for (const bound of [true, false]) test(`recurrence keeps its existing domain path with native source binding=${bound}`, async () => {
 const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: 'task.md', extension: 'md' });
 const host = new Recurrence(); let queued = 0, direct = 0, indexed = 0;
 Object.assign(host, { app: { vault: { getAbstractFileByPath: () => file, cachedRead: async () => inline,
  modify: async (_file: unknown, content: string) => { assert.match(content, /next001/); direct++; } } },
  writer: { hasMarkdownSource: () => bound, readTaskMarkdownSource: async () => inline + '\nunsaved body',
   applyExactMarkdownSourceMutation: async (_path: string, expected: string, next: string, _guard: unknown, _permit: unknown, origin: string) => {
    assert.match(expected, /unsaved body/); assert.match(next, /unsaved body/); assert.match(next, /next001/); assert.equal(origin, 'plugin'); queued++; return { outcome: 'committed' };
   } }, findTaskLine: () => 0, getSettings: () => ({ keyMappings: [], newOccurrencePosition: 'below' }),
  buildInlineTaskLine: () => inline.replace('task001', 'next001'), shouldReplaceCompletedInlineOccurrence: () => false,
  onBeforeCreatedTaskReindex() {}, indexer: { reindexFilePath: async () => { indexed++; } },
 });
 const result = await host.materializeInlineOccurrence({ sourceTask: { operonId: 'task001', primary: { filePath: file.path, lineNumber: 0 } }, fieldValues: { operonId: 'next001' } });
 assert.equal(result.taskId, 'next001'); assert.equal(indexed, 1); assert.equal(queued, bound ? 1 : 0); assert.equal(direct, bound ? 0 : 1);
});

test('a newly established source recurrence series is not replaced by a stale generated editor ID', async () => {
 const initial = inline + ' {{repeat:: every day}}', f = mainFixture(initial);
 const baseline = (await f.main.readTaskEditorSource('task001')).state;
 f.native.edit(initial + ' {{repeatSeriesId:: rssrc01}}');
 await f.main.saveSynchronizedTaskEditor({ taskLine: initial + ' {{repeatSeriesId:: rsdraft}}', isNew: false, sourceSync: { operonId: 'task001', baseline, changedKeys: ['repeatSeriesId'] } }, async (request: { taskLine: string }) => {
  assert.match(request.taskLine, /rssrc01/); assert.doesNotMatch(request.taskLine, /rsdraft/); return false;
 });
});

const InitialRender = methods('src/ui/task-editor-content.ts', ['whenInitialRenderReady', 'refreshDesktopFileProperties'], {});
test('initial presentation joins existing source and latest property work without new reads', async () => {
 const editor = new InitialRender();
 let sourceDone!: () => void, propertiesDone!: () => void, newerDone!: () => void, ready = false, reads = 0;
 editor.initialSourceRefresh = new Promise<void>(resolve => sourceDone = resolve);
 editor.loadDesktopFileProperties = () => { reads++; return new Promise<void>(resolve => propertiesDone = resolve); };
 editor.refreshDesktopFileProperties();
 const opening = editor.whenInitialRenderReady().then(() => { ready = true; });
 sourceDone(); await Promise.resolve(); assert.equal(ready, false);
 editor.loadDesktopFileProperties = () => { reads++; return new Promise<void>(resolve => newerDone = resolve); };
 editor.refreshDesktopFileProperties(); propertiesDone(); await Promise.resolve(); await Promise.resolve();
 assert.equal(ready, false); newerDone(); await opening; assert.equal(reads, 2);
});

const NameEditor = methods('src/ui/task-editor-content.ts', ['editsFileTaskTitle', 'editableName', 'setEditableName', 'renderFileTaskNameRow']);
const TitleIntent = methods('main.ts', ['applyTaskEditorSaveIntentToPayload']);
test('enabled editor name edits and clears the canonical mapped property, never the filename', () => {
 const editor = new NameEditor(), intent = new TitleIntent();
 Object.assign(editor, { settings: { fileTaskDisplayTitleEnabled: true }, onRenameFileTask() {}, description: 'slug', fieldValues: { fileTaskDisplayTitle: 'Before' } });
 for (const title of ['After', '']) {
  editor.setEditableName(title);
  assert.equal(editor.description, 'slug');
  assert.equal(editor.editableName, title);
  const payload: Record<string, string> = { operonId: 'task001' };
  intent.applyTaskEditorSaveIntentToPayload(payload, { fileTaskDisplayTitleChange: editor.fieldValues.fileTaskDisplayTitle });
  assert.deepEqual(payload, { operonId: 'task001', fileTaskDisplayTitle: title });
 }
});
test('disabled title setting and inline tasks retain description editing', () => {
 for (const file of [true, false]) {
  const editor = new NameEditor();
  Object.assign(editor, { settings: { fileTaskDisplayTitleEnabled: !file }, ...(file ? { onRenameFileTask() {} } : {}), description: 'slug', fieldValues: { fileTaskDisplayTitle: 'Before' } });
  editor.setEditableName('New filename');
  assert.equal(editor.description, 'New filename'); assert.equal(editor.fieldValues.fileTaskDisplayTitle, 'Before');
 }
});
test('external title refresh changes the field without invoking title-edit policy', async () => {
 const { editor } = contentFixture(); let suggestions = 0;
 editor.editsFileTaskTitle = true;
 editor.onFileTaskTitleChanged = () => { suggestions++; };
 editor.readSource = async () => ({ state: state({ fileTaskDisplayTitle: 'External title' }), filePath: 'old.md', lineNumber: 0 });
 await editor.refreshTaskSource();
 assert.equal(editor.fieldValues.fileTaskDisplayTitle, 'External title'); assert.equal(suggestions, 0);
});

const SavedTitleEditor = methods('src/ui/task-editor-content.ts', ['persistEditorState', 'editsFileTaskTitle', 'editableName', 'setEditableName', 'renameFileTask'], {
 t,
 localNow: () => '2026-10-25T02:00:00', parseRepeatRule: () => null,
 isManagedTaskFieldCanonicalKey: () => true,
 buildTaskEditorOperonField: (key: string, value: string) => ({ key, value, rawValue: value, sourceKey: key, type: 'text', isCanonical: true }),
 serializeTask, isTaskEditorSaveCommit: (value: object) => 'canonicalState' in value,
});
function savedTitleEditor() {
 const editor = new SavedTitleEditor(), events: string[] = [], policyTitles: string[] = [];
 const suggestion: { rendered: number; current: { filename: string; canCommit: () => boolean } | null } = { rendered: 0, current: null };
 const values = { operonId: 'task001', fileTaskDisplayTitle: 'Pre-existing drift' };
 Object.assign(editor, { settings: { ...DEFAULT_SETTINGS, fileTaskDisplayTitleEnabled: true }, onRenameFileTask() {},
  description: 'slug', persistedDescription: 'slug', fieldValues: { ...values }, persistedFieldValues: { ...values },
  checkbox: 'open', tags: [], inlineCompletionMode: 'keep-completed', checkboxBodyRevision: 0, fileBodyDraft: '',
  existingTask: { filePath: 'slug.md', fields: [] }, submittedFileProperties: new Set(), editVersion: 1, fileTaskTitleRevision: 0,
  syncDerivedRepeatFieldsFromDraft() {}, maybeApplyScheduledAutomationToEditorState() {},
  syncCheckboxWithWorkflowStatus: () => ({ ok: true }), hasSemanticDraftChanges: () => true,
  syncTrackingFieldsFromIndex() {}, getFilePropertyChanges: () => [], getInlinePropertyChanges: () => [],
  applyCanonicalSaveCommit: (canonical: { fieldValues: Record<string, string> }) => { editor.persistedFieldValues = { ...canonical.fieldValues }; },
  onSave: async (request: { fileTaskDisplayTitleChange?: string }) => {
   events.push('saved');
   return { canonicalState: { fieldValues: { ...editor.fieldValues } } };
  },
  onFileTaskTitleChanged: async (title: string) => {
   policyTitles.push(title);
   assert.equal(events.at(-1), 'saved', 'title must be committed before asking or renaming');
   events.push('policy');
   return filenameSuggestionAfterTitleEdit(title, 'slug', 'ask', DEFAULT_FILENAME_RULE);
  },
  getCurrentIndexedTask: () => ({ description: 'slug', primary: { filePath: 'slug.md' } }),
  getCompactTextSourcePath: () => 'slug.md',
  refreshFileTaskName() {},
  fileTaskNameRow: suggestion,
  renderFileTaskNameRow() { suggestion.current = null; },
  renderFileTaskRenameRow(value: { filename: string }, canCommit: () => boolean) { suggestion.rendered++; suggestion.current = { filename: value.filename, canCommit }; },
 });
 return { editor, events, policyTitles, suggestion };
}
test('suggestion follows a committed Operon edit, never pre-existing drift', async () => {
 const { editor, events, policyTitles, suggestion } = savedTitleEditor();
 await editor.persistEditorState();
 assert.equal(suggestion.rendered, 0); assert.deepEqual(events, ['saved']);
 editor.fieldValues.fileTaskDisplayTitle = 'Changed title';
 await editor.persistEditorState();
 assert.deepEqual(events, ['saved', 'saved', 'policy']); assert.equal(suggestion.rendered, 1);
 editor.fieldValues.fileTaskDisplayTitle = 'slug';
 await editor.persistEditorState();
 assert.equal(suggestion.rendered, 1, 'matching derived filename never creates a suggestion');
 editor.fieldValues.fileTaskDisplayTitle = '  Mobile saved title  ';
 await editor.persistEditorState();
 assert.equal(policyTitles.at(-1), 'Mobile saved title', 'mobile policy must receive the trimmed saved title');
 editor.settings.fileTaskDisplayTitleEnabled = false;
 editor.fieldValues.fileTaskDisplayTitle = 'Other title';
 await editor.persistEditorState();
 assert.equal(events.filter(event => event === 'policy').length, 3, 'disabled setting never runs title policy');
});

// These are the surviving UI revision guarantees, before rename dispatch.
test('a newer title invalidates an old Ask action and keeps the current derived or edited name', async () => {
 for (const filename of ['title-b', '02-custom-for-b']) {
  const { editor, suggestion } = savedTitleEditor(); const renamed: string[] = [];
  editor.onRenameFileTask = async (value: string) => { renamed.push(value); };
  editor.setEditableName('Title A'); await editor.persistEditorState();
  const old = suggestion.current!;
  editor.setEditableName('Title B');
  assert.equal(suggestion.current, null);
  await assert.rejects(editor.renameFileTask('title-a', old.canCommit), { message: t('taskEditor', 'fileTaskRenameFailed') });
  assert.deepEqual(renamed, []);
  await editor.persistEditorState();
  assert.equal(suggestion.current!.filename, 'title-b');
  await editor.renameFileTask(filename, suggestion.current!.canCommit);
  assert.deepEqual(renamed, [filename]);
 }
});
test('delayed save or suggestion for A cannot restore a prompt after B is entered', async () => {
 for (const boundary of ['save', 'suggestion']) {
  const { editor, suggestion } = savedTitleEditor();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const method = boundary === 'save' ? 'onSave' : 'onFileTaskTitleChanged';
  const original = editor[method]; let first = true;
  editor[method] = async (...args: unknown[]) => {
   const result = await original(...args);
   if (first) { first = false; entered(); await gate; }
   return result;
  };
  editor.setEditableName('Title A'); const saving = editor.persistEditorState();
  await ready; editor.setEditableName('Title B'); release(); await saving;
  assert.equal(suggestion.current, null);
  await editor.persistEditorState();
  assert.equal(suggestion.current!.filename, 'title-b');
 }
});
