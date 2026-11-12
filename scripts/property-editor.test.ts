import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml } from 'obsidian';
import type { App, MarkdownView, TFile } from 'obsidian';
import { planPropertyEditorWrite, readPropertyEditorDocument } from '../src/core/property-editor-document';
import { PropertyEditorDraft } from '../src/core/property-editor-draft';
import { resolvePropertyEditorField } from '../src/core/property-editor-fields';
import type { RawYamlPropertyValue } from '../src/core/raw-yaml-property';
import type { KeyMapping } from '../src/types/settings';
import { capturePropertyEditorMarkdown } from '../src/ui/task-editor-markdown-source';
import { resolveNativeLightboxLayout } from '../src/ui/native-lightbox-layout';

const note = '---\nFirst: one\nSecond: two\n---\n# Body\n';
const change = (name: string, expected: RawYamlPropertyValue | undefined, value: RawYamlPropertyValue) =>
 ({ name, expected: { present: expected !== undefined, value: expected }, value });
const read = (source: string) => readPropertyEditorDocument(source, [])!;

test('shared editor geometry keeps the reference width and top alignment on both sides', () => {
 for (const side of ['left', 'right'] as const) {
  const layout = resolveNativeLightboxLayout({
   viewport: { width: 1400, height: 900 }, markdown: { width: 1050, height: 804 },
   companion: { width: 557, height: 334 }, side, margin: 24, railWidth: 52,
  });
  assert.ok(layout.markdown && layout.companion && layout.rail);
  assert.equal(layout.companion.width,557);
  assert.equal(layout.markdown.top, layout.companion.top);
  assert.equal(side === 'left' ? layout.companion.left : layout.markdown.left, 24);
 }
});

test('editing and appending retain YAML key formatting, inline comments, CRLF and body bytes', () => {
 const content = '\uFEFF---\r\n# header\r\n"First": "old # value"  # keep\r\n# second\r\nSecond: two\r\n---\r\n# Body\r\n';
 const result = planPropertyEditorWrite(content, [], [change('First', 'old # value', 'new'), change('Last', undefined, false)]);
 assert.equal(result.status, 'ready');
 if (result.status !== 'ready') return;
 assert.equal(result.text, '\uFEFF---\r\n# header\r\n"First": new  # keep\r\n# second\r\nSecond: two\r\nLast: false\r\n---\r\n# Body\r\n');
 assert.deepEqual(result.properties.order, ['First', 'Second', 'Last']);
});

test('first confirmed property preserves the body, while empty addition cannot create frontmatter', () => {
 const body = '\uFEFF# Body\r\n- [ ] Inline task {{operonId:: sample1}}\r\n';
 assert.deepEqual(planPropertyEditorWrite(body, [], [change('Count', undefined, null)]), { status: 'ready', text: body, properties: read(body) });
 const result = planPropertyEditorWrite(body, [], [change('Count', undefined, 0)]);
 assert.equal(result.status, 'ready');
 if (result.status !== 'ready') return;
 assert.equal(result.text, '\uFEFF---\r\nCount: 0\r\n---\r\n' + body.slice(1));
});

test('a fresh different-field edit is retained, the same-field edit conflicts, and clearing keeps its key', () => {
 const content = note.replace('Second: two', 'Second: external').replace('# Body', '# Latest body');
 const result = planPropertyEditorWrite(content, [], [change('First', 'one', null)]);
 assert.equal(result.status, 'ready');
 if (result.status !== 'ready') return;
 assert.equal(result.text, content.replace('First: one', 'First:'));
 assert.deepEqual(result.properties.order, ['First', 'Second']);
 assert.equal(planPropertyEditorWrite(content, [], [change('Second', 'two', 'mine')]).status, 'conflict');
 assert.equal(planPropertyEditorWrite(content, [], [change('second', undefined, 'mine')]).status, 'conflict');
});

test('complex YAML with multiline comments remains readable and cannot be overwritten', () => {
 for (const value of ['"old\n  " # preserve-me', '"old\n  # old-secret"', '[old,\n  # preserve-me\n  next]']) {
  const content = '---\nFirst: ' + value + '\nSecond: kept\n---\nBody\n';
  const document = read(content);
  assert.ok(document.readonlyNames?.has('First'));
  assert.equal(planPropertyEditorWrite(content, [], [change('First', document.frontmatter.First as RawYamlPropertyValue, 'new')]).status, 'unsupported');
  const result = planPropertyEditorWrite(content, [], [change('Second', 'kept', 'new')]);
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.text, content.replace('Second: kept', 'Second: new'));
 }
});

test('the last property preserves the exact number of trailing line breaks in a multiline string', () => {
 const value = 'a\nb\n\n';
 const result = planPropertyEditorWrite(note, [], [change('Second', 'two', value)]);
 assert.equal(result.status, 'ready');
 if (result.status === 'ready') {
  const yaml = result.text.slice(4, result.text.indexOf('---', 4));
  assert.equal((parseYaml(yaml) as { Second: string }).Second, value);
 }
});

test('property mapping checks type declarations, protected fields and duplicate aliases', () => {
 const mappings = [
  { canonicalKey: 'status', visiblePropertyName: 'Workflow', type: 'text' },
  { canonicalKey: 'repeatSeriesId', visiblePropertyName: 'Series', type: 'text', isInternal: true },
 ] as KeyMapping[];
 const document = read('---\nWorkflow: Todo\nSeries: protected\naliases: [A]\n---\n');
 const field = (name: string, types: Record<string, string>) => resolvePropertyEditorField(name, document, mappings, types);
 assert.equal(field('Workflow', {}).mapping?.canonicalKey, 'status');
 assert.equal(field('Workflow', { Workflow: 'number' }).reason, 'type-conflict');
 assert.equal(field('Series', {}).reason, 'unavailable');
 assert.equal(field('aliases', { aliases: 'aliases' }).reason, undefined);
 assert.equal(field('status', {}).reason, 'type-conflict');
});

test('a second edit made during a save is kept and based on the committed value', () => {
 const draft = new PropertyEditorDraft(read(note));
 assert.equal(draft.set('First', 'sent', false), true);
 const sent = draft.snapshot();
 assert.equal(draft.set('First', 'later', true), true);
 draft.acknowledge(read(note.replace('First: one', 'First: sent')), sent);
 assert.deepEqual(draft.snapshot(), [change('First', 'sent', 'later')]);
 assert.equal(draft.properties.frontmatter.First, 'later');
 draft.discard();
 assert.equal(draft.edited, false);
 assert.equal(draft.properties.frontmatter.First, 'sent');
});

test('a picker keeps its original expectation when another save refreshes the source', () => {
 const draft = new PropertyEditorDraft(read(note));
 draft.refresh(read(note.replace('Second: two', 'Second: external')));
 draft.set('Second', 'mine', false, { present: true, value: 'two' });
 assert.deepEqual(draft.snapshot(), [change('Second', 'two', 'mine')]);
});

test('clearing an unsubmitted new property cancels the addition', () => {
 const draft = new PropertyEditorDraft(read(note));
 draft.set('New', 'value', false);
 draft.set('New', null, false);
 assert.equal(draft.edited, false);
 assert.deepEqual(draft.properties.order, ['First', 'Second']);
});

function sourceFixture() {
 let stored = note, writes = 0, unavailable = false, reject = false;
 let afterWrite = () => {};
 const file = { path: 'Note.md' } as TFile;
 const view = (initial = note, saved: string | null = note) => {
  let text = initial;
  return {
   file, lastSavedData: saved, data: saved, saving: false,
   editor: {
    getValue: () => text,
    offsetToPos: (ch: number) => ({ line: 0, ch }),
    transaction: ({ changes }: { changes: Array<{ from: { ch: number }; to: { ch: number }; text: string }> }) => {
     for (const entry of changes) text = text.slice(0, entry.from.ch) + entry.text + text.slice(entry.to.ch);
    },
   },
   setText: (next: string) => { text = next; },
  };
 };
 const owner = view(), tab = view(note.replace('# Body', '# Unsaved body'));
 const views = [owner, tab];
 const app = { vault: {
  getAbstractFileByPath: () => unavailable ? null : file,
  read: async () => stored,
  process: async (_file: TFile, transform: (text: string) => string) => {
   const result = transform(stored);
   if (reject) throw new Error('Write failed');
   stored = result;
   writes++;
   afterWrite();
   return stored;
  },
 } } as unknown as App;
 return { file, owner, tab,
  capture: (rebase?: (text: string) => string | null) => capturePropertyEditorMarkdown(app, file, () => views as unknown as MarkdownView[], rebase),
  onWrite: (callback: () => void) => { afterWrite = callback; },
  setDisk: (next: string) => { stored = next; },
  replaceFile: () => { unavailable = true; }, fail: () => { reject = true; },
  status: () => ({ stored, writes }),
 };
}

test('source adapter uses one verified draft, preserves unsaved body and synchronizes both editors', async () => {
 const f = sourceFixture(), source = await f.capture(), before = await source.read();
 assert.match(before, /# Unsaved body/u);
 const next = before.replace('First: one', 'First: changed');
 await source.write(before, next);
 assert.deepEqual(f.status(), { stored: next, writes: 1 });
 assert.equal(f.owner.editor.getValue(), next);
 assert.equal(f.tab.editor.getValue(), next);
});

test('failed or stale source writes leave both native editors untouched', async () => {
 for (const failure of ['write', 'disk', 'replacement', 'new buffer'] as const) {
  const f = sourceFixture(), source = await f.capture(), before = await source.read();
  if (failure === 'write') f.fail();
  if (failure === 'disk') f.setDisk(note.replace('First: one', 'First: external'));
  if (failure === 'replacement') f.replaceFile();
  if (failure === 'new buffer') f.tab.setText(note + 'Later');
  const prior = [f.owner.editor.getValue(), f.tab.editor.getValue()];
  await assert.rejects(source.write(before, before.replace('First: one', 'First: attempted')));
  assert.deepEqual([f.owner.editor.getValue(), f.tab.editor.getValue()], prior);
  assert.equal(f.status().writes, 0);
 }
});

test('an unknown baseline or a dirty mixed-line-ending source cannot be certified', async () => {
 const first = sourceFixture();
 first.tab.lastSavedData = null;
 first.tab.data = first.tab.editor.getValue();
 await assert.rejects(first.capture());
 const second = sourceFixture();
 const mixed = note.replace('---\n', '---\r\n');
 second.setDisk(mixed);
 second.tab.lastSavedData = mixed;
 await assert.rejects(second.capture());
 assert.equal(first.status().writes + second.status().writes, 0);
});

test('a body edit during write settles in the live buffer without reverting the committed property', async () => {
 const f = sourceFixture();
 const changes = [change('First', 'one', 'mine')];
 const source = await f.capture(text => {
  const plan = planPropertyEditorWrite(text, [], changes);
  return plan.status === 'ready' ? plan.text : null;
 });
 const before = await source.read();
 const next = before.replace('First: one', 'First: mine');
 f.onWrite(() => f.tab.setText(before + 'Later body edit\n'));
 await source.write(before, next);
 assert.equal(source.nativeConflict, false);
 assert.equal(f.tab.editor.getValue(), next + 'Later body edit\n');
 assert.equal(f.status().stored, next);
});

test('a same-field edit after the disk write starts remains intact and marks native sync as conflicted', async () => {
 const f = sourceFixture();
 const source = await f.capture(() => null), before = await source.read();
 f.onWrite(() => f.tab.setText(before.replace('First: one', 'First: other')));
 await source.write(before, before.replace('First: one', 'First: mine'));
 assert.equal(source.nativeConflict, true);
 assert.match(f.tab.editor.getValue(), /First: other/u);
});

for (const marker of ['|-', '|2-', '|-2', '>2-', '>']) test(`YAML ${marker} preserves comments below the scalar indentation`, () => {
 for (const newline of ['\n', '\r\n']) for (const indent of ['', '  ']) {
  const content = ['---', `${indent}Caption: ${marker} # header`, `${indent}  old text`, `${indent}  # string content`, `${indent} # user comment`, `${indent}   # another comment`, `${indent}Next: kept`, '---', '# Body', ''].join(newline);
  const before = read(content);
  const result = planPropertyEditorWrite(content, [], [change('Caption', before.frontmatter.Caption as string, 'new')]);
  assert.equal(result.status, 'ready');
  if (result.status === 'ready') assert.equal(result.text, ['---', `${indent}Caption: new # header`, `${indent} # user comment`, `${indent}   # another comment`, `${indent}Next: kept`, '---', '# Body', ''].join(newline));
 }
});

test('unsafe YAML integers cannot conceal a same-field conflict or be newly introduced', () => {
 for (const value of ['9007199254740992', '[0, 9007199254740993]']) {
  const source = `---\nCount: ${value}\nOther: kept\n---\nBody\n`;
  const before = read(source);
  assert.ok(resolvePropertyEditorField('Count', before, [], {}).reason);
  assert.equal(planPropertyEditorWrite(source.replace('9007199254740992', '9007199254740993'), [], [change('Count', before.frontmatter.Count as RawYamlPropertyValue, 1)]).status, 'unsupported');
  const other = planPropertyEditorWrite(source, [], [change('Other', 'kept', 'edited')]);
  assert.equal(other.status, 'ready');
  if (other.status === 'ready') assert.equal(other.text, source.replace('Other: kept', 'Other: edited'));
 }
 assert.equal(planPropertyEditorWrite('Body\n', [], [change('Count', undefined, 9007199254740992)]).status, 'unsupported');
 assert.equal(planPropertyEditorWrite('Body\n', [], [change('Count', undefined, Number.MAX_SAFE_INTEGER)]).status, 'ready');
});

test('cyclic YAML stays protected without recursive number inspection', () => {
 const document=read('---\nCycle: &cyc [*cyc]\nOther: kept\n---\nBody\n');
 assert.ok(document);assert.ok(document.readonlyNames?.has('Cycle'));
 assert.ok(resolvePropertyEditorField('Cycle',document,[],{}).reason);
});
