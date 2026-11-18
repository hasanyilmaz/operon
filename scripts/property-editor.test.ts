import { canApplyFileTaskPropertyChanges, editorMappedProperties } from '../src/core/file-task-property-draft';
import { TaskWriter } from '../src/core/task-writer';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { mergeInlineEditorSource, patchInlineProperties, type InlinePropertyChange } from '../src/core/inline-property-source';
import { parseTaskLine } from '../src/core/parser';
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

test('editing preserves quoted YAML keys with escapes and whitespace before the colon', () => {
 const name = 'quoted "key" ' + '\\!'.repeat(8);
 const key = JSON.stringify(name);
 const content = '---\n' + key + ' : old # keep\nNext: unchanged\n---\nBody\n';
 const result = planPropertyEditorWrite(content, [], [change(name, 'old', 'new')]);
 assert.equal(result.status, 'ready');
 if (result.status !== 'ready') return;
 assert.equal(result.text, content.replace(' : old # keep', ' : new # keep'));
 assert.deepEqual(result.properties.order, [name, 'Next']);
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
 // Reserved source properties follow the same protection as the Task Editor writer.
 assert.equal(field('aliases', { aliases: 'aliases' }).reason, 'type-conflict');
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


test('empty removal preserves comments, exact unaffected bytes and YAML order', () => {
 const source = '\uFEFF---\r\n# top\r\n"Empty": [] # field comment\r\n# next comment\r\nCount: 0\r\nFlag: false\r\n---\r\nBody\r\n';
 const draft = new PropertyEditorDraft(read(source));
 assert.equal(draft.edited, false);
 assert.equal(draft.remove('Count', false), false);
 assert.equal(draft.remove('Flag', false), false);
 assert.equal(draft.remove('Empty', false), true);
 assert.deepEqual(draft.properties.order, ['Count', 'Flag']);
 const sent = draft.snapshot();
 const result = planPropertyEditorWrite(source, [], sent);
 assert.equal(result.status, 'ready');
 if (result.status !== 'ready') return;
 assert.equal(result.text, source.replace('"Empty": [] # field comment', '# field comment'));
 assert.equal(planPropertyEditorWrite(source.replace('[]', '[external]'), [], sent).status, 'conflict');
 draft.acknowledge(result.properties, sent);
 assert.equal(draft.edited, false);
 assert.equal(draft.properties.order.includes('Empty'), false);
});

test('remove and re-add while deletion saves preserves the new draft and rebases absence', () => {
 const source = '---\nEmpty: \nOther: preserved\n---\nBody';
 const draft = new PropertyEditorDraft(read(source));
 draft.remove('Empty', false);
 const sent = draft.snapshot();
 draft.set('Empty', 'new value', true);
 const removed = planPropertyEditorWrite(source, [], sent);
 assert.equal(removed.status, 'ready');
 if (removed.status !== 'ready') return;
 draft.acknowledge(removed.properties, sent);
 assert.equal(draft.properties.frontmatter.Empty, 'new value');
 assert.equal(draft.snapshot()[0].expected.present, false);
 const restored = planPropertyEditorWrite(removed.text, [], draft.snapshot());
 assert.equal(restored.status, 'ready');
 if (restored.status === 'ready') assert.equal(restored.properties.frontmatter.Empty, 'new value');
});

test('task mapped presence admits only unique editable canonical fields', () => {
 const mappings = DEFAULT_SETTINGS.keyMappings.map(mapping => mapping.canonicalKey === 'contexts' ? { ...mapping, visiblePropertyName: 'Up' } : mapping);
 const frontmatter = { operonId: 'abc123', Up: null, datetimeModified: null, datetimeCreated: null, trackers: null };
 const properties = editorMappedProperties(frontmatter, mappings);
 assert.deepEqual(Object.keys(properties), ['contexts']);
 const remove = { propertyName: 'Up', mappedKey: 'contexts', expected: { present: true, value: null }, value: null, remove: true };
 assert.equal(canApplyFileTaskPropertyChanges(frontmatter, [remove], mappings), true);
 assert.equal(canApplyFileTaskPropertyChanges({ ...frontmatter, Up: ['external'] }, [remove], mappings), false);
 assert.equal(canApplyFileTaskPropertyChanges(frontmatter, [{ ...remove, mappedKey: 'operonId', propertyName: 'operonId' }], mappings), false);
 assert.equal(editorMappedProperties({ Up: null, contexts: null }, mappings).contexts, undefined);
});

test('File Task empty removal uses the real compound writer and preserves comments', () => {
 const mappings = DEFAULT_SETTINGS.keyMappings.map(mapping => mapping.canonicalKey === 'contexts' ? { ...mapping, visiblePropertyName: 'Up' } : mapping);
 const idName = mappings.find(mapping => mapping.canonicalKey === 'operonId')!.visiblePropertyName;
 const source = '---\n' + idName + ': abc123\nUp: # retain\nOther: original # untouched\n---\nBody\n';
 const render = (TaskWriter.prototype as unknown as { renderFilePropertyDraft: (...args: unknown[]) => string | null }).renderFilePropertyDraft;
 const host = { keyMappings: mappings, hooks: {}, stringifyFrontmatterScalar: (TaskWriter.prototype as unknown as { stringifyFrontmatterScalar: (value: unknown) => string | null }).stringifyFrontmatterScalar };
 const change = { propertyName: 'Up', mappedKey: 'contexts', expected: { present: true, value: null }, value: null, remove: true };
 const result = render.call(host, source, 'abc123', {}, { changes: [change] }, 'merge');
 assert.equal(result, source.replace('Up: # retain', '# retain'));
 const nativeSource = source.replace('Up: # retain', 'Blank: # retain');
 assert.equal(render.call(host, nativeSource, 'abc123', {}, { changes: [{ propertyName: 'Blank', expected: {present:true,value:null}, value:null, remove:true, preserveSource:true }] }, 'merge'), nativeSource.replace('Blank: # retain', '# retain'));

 assert.equal(render.call(host, source.replace('Up: # retain', 'Up: external # retain'), 'abc123', {}, { changes: [change] }, 'merge'), null);
 const aliasSource = source.replace('Up: # retain', 'contexts: "[[week]]" # retain');
 const cleared = render.call(host, aliasSource, 'abc123', { contexts: '' }, { changes: [{ ...change, propertyName: 'contexts', expected: { present: true, value: '[[week]]' }, remove: false }] }, 'replace');
 assert.equal(cleared, source.replace('Up: # retain', 'contexts: # retain'));
 assert.equal(editorMappedProperties({ contexts: null }, mappings).contexts.name, 'contexts');

});

test('inline mapped removal preserves other fields and rejects stale or protected source', () => {
 const mappings = DEFAULT_SETTINGS.keyMappings;
 const line = '- [ ] Fixture {{operonId:: abc123}} {{contexts:: }} {{note:: Keep}}';
 const parsed = parseTaskLine(line, 0, '', mappings)!;
 const field = parsed.fields.find(field => field.key === 'contexts')!;
 const remove: InlinePropertyChange = { sourceName: field.sourceKey, mappedKey: 'contexts', type: 'list', expected: { present: true, rawValue: field.rawValue }, mutation: { kind: 'remove' } };
 const result = mergeInlineEditorSource(line, line, parsed.fields, mappings, undefined, [remove]);
 assert.ok(result);
 assert.equal(parseTaskLine(result, 0, '', mappings)!.fields.some(field => field.key === 'contexts'), false);
 assert.equal(parseTaskLine(result, 0, '', mappings)!.fields.find(field => field.key === 'note')!.value, 'Keep');
 assert.equal(mergeInlineEditorSource(line.replace('contexts:: ', 'contexts:: changed'), line, parsed.fields, mappings, undefined, [remove]), null);
 assert.throws(() => patchInlineProperties(line, '', 'abc123', [{ ...remove, sourceName: 'operonId', mappedKey: 'operonId' }], mappings));
});


test('legacy custom empties use the mapped path while typed custom empties use only the native path', () => {
 const mappings: KeyMapping[] = [...DEFAULT_SETTINGS.keyMappings, { canonicalKey:'legacyCustom',visiblePropertyName:'Custom',type:'text',sync:'yes',enabled:true,isSystem:false }];
 const property = editorMappedProperties({ Custom:null }, mappings).legacyCustom;
 assert.equal(property.name, 'Custom');
 const definitions = { version:1 as const,entries:[{ sourceName:'Custom',type:'text' as const,encoding:'vault-v1' as const }] };
 assert.equal(editorMappedProperties({ Custom:null }, mappings, {}, definitions).legacyCustom, undefined);
 const change = { propertyName:'Custom',mappedKey:'legacyCustom',expected:{present:true,value:null},value:null,remove:true };
 assert.equal(canApplyFileTaskPropertyChanges({Custom:null},[change],mappings),true);
 assert.equal(canApplyFileTaskPropertyChanges({Custom:null},[change],mappings,definitions),false);
});


test('empty built-in Tags retains its actual source name and supports explicit removal', () => {
 const properties=editorMappedProperties({Tags:[]},DEFAULT_SETTINGS.keyMappings);
 assert.equal(properties.tags.name,'Tags');
 assert.equal(canApplyFileTaskPropertyChanges({Tags:[]},[{propertyName:'Tags',mappedKey:'tags',expected:{present:true,value:[]},value:null,remove:true}],DEFAULT_SETTINGS.keyMappings),true);
 assert.equal(editorMappedProperties({Tags:[],tags:[]},DEFAULT_SETTINGS.keyMappings).tags,undefined);
});
