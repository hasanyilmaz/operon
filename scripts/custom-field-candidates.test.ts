import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { IndexedTask } from '../src/types/fields';
import type { KeyMapping } from '../src/types/settings';
import { parseTaskLine } from '../src/core/parser';
import { encodeVaultPropertyValue, decodeVaultPropertyList } from '../src/core/vault-property-codec';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { persistNativePropertySource } from '../src/indexer/native-property-persistence';
import { collectCustomFieldValueCandidates, collectNativeFieldValueCandidates, invalidateCustomFieldValueCandidateCache } from '../src/ui/custom-field-surfaces';

function fixture(type: 'text' | 'list' = 'text', mapped = true) {
 const mapping = { canonicalKey: 'testvalues1', visiblePropertyName: 'Test Values', type, isSystem: false, enabled: true, sync: 'yes' } as KeyMapping;
 const mappings = mapped ? [mapping] : [];
 const name = mapping.visiblePropertyName;
 const file = Object.assign(Object.create(TFile.prototype), { path: 'Synthetic.md', stat: { mtime: 1, size: 100 } });
 let frontmatter: Record<string, unknown> = {};
 const app = { vault: { getMarkdownFiles: () => [file], getAbstractFileByPath: () => file,
  read: () => { throw Error('Unexpected file read'); }, cachedRead: () => { throw Error('Unexpected file read'); } },
  metadataCache: { getFileCache: () => ({ frontmatter }) } } as unknown as App;
 const index = getNativePropertyIndex(app);
 index.configure({ keyMappings: mappings, inlinePropertyDefinitions: { version: 1, entries: [{ sourceName: name, type, encoding: 'vault-v1' }] } });
 index.setTypes({ [name.toLowerCase()]: type === 'list' ? 'multitext' : type });
 let tasks: IndexedTask[] = [];
 const set = (values: (string | (string | number)[])[]) => {
  const parsed = values.map((value, i) => parseTaskLine('- [ ] task {{operonId:: test00' + i + '}} {{' + name + ':: ' + encodeVaultPropertyValue(value, type) + '}}', i, file.path, mappings)!);
  tasks = parsed.map(item => ({ operonId: item.operonId!, primary: { filePath: file.path, format: 'inline', lineNumber: item.lineNumber },
   fieldValues: Object.fromEntries(item.fields.map(field => [field.key, field.value])) } as IndexedTask));
  const source = { frontmatter: null, order: [], inline: parsed };
  index.accept(file.path, source);
  return source;
 };
 const collect = () => collectNativeFieldValueCandidates(app, tasks, mappings, name, type);
 return { app, index, mapping, mappings, name, collect, set, tasks: () => tasks,
  yaml(value: unknown) { frontmatter = { [name]: value }; invalidateCustomFieldValueCandidateCache(app); } };
}

test('native custom text shares the inline values visible in chips and managed Table cells', () => {
 const f = fixture(); f.set(['111', '222']);
 assert.deepEqual(f.collect(), ['111', '222']);
 assert.deepEqual(f.collect(), collectCustomFieldValueCandidates(f.app, f.tasks(), f.mapping));
 assert.equal(f.index.counters.reads, 0);
});
test('mapped frontmatter values are included alongside inline values', () => {
 const f = fixture(); f.set(['111']); f.yaml('222'); assert.deepEqual(f.collect(), ['111', '222']);
});
test('native list suggestions preserve separators, quoted numbers, numeric members and links', () => {
 const f = fixture('list'); f.set([['a; b', '111', 111, '[[A|B]]', 'a; b']]); f.yaml(['c,d', 0]);
 const values = f.collect().flatMap(value => decodeVaultPropertyList(value));
 for (const expected of ['a; b', '111', 111, '[[A|B]]', 'c,d', 0]) assert.ok(values.includes(expected));
 assert.equal(values.length, 6); assert.equal(f.index.counters.reads, 0);
});
test('unmapped vault properties use the same inline and metadata pool', () => {
 const f = fixture('text', false); f.set(['inline']); f.yaml('file'); assert.deepEqual(f.collect(), ['file', 'inline']);
});
test('reopening uses current task and frontmatter values instead of Creator opening snapshot', () => {
 const f = fixture(); f.set(['old']); assert.deepEqual(f.collect(), ['old']);
 f.set(['new']); f.yaml('new-file'); assert.deepEqual(f.collect(), ['new', 'new-file']);
});
test('conflicting property aliases and type mismatches do not leak suggestions', () => {
 const f = fixture(); f.set(['111']);
 assert.deepEqual(collectNativeFieldValueCandidates(f.app, f.tasks(), [...f.mappings, { ...f.mapping, canonicalKey: 'other' }], f.name, 'text'), []);
 assert.deepEqual(collectNativeFieldValueCandidates(f.app, f.tasks(), f.mappings, f.name, 'list'), []);
 f.yaml(['wrong type']); assert.deepEqual(f.collect(), ['111']);
});
test('pending native task sources are not read synchronously or mistaken for valid suggestions', () => {
 const f = fixture(); f.set(['111']); f.index.markPending('Synthetic.md');
 assert.deepEqual(f.collect(), []); assert.equal(f.index.counters.reads, 0);
 f.index.finishPending('Synthetic.md'); assert.deepEqual(f.collect(), ['111']);
});
test('empty values and repeated values do not generate duplicate suggestions or writes', () => {
 const f = fixture(); f.set(['', '111', '111']); f.yaml('111');
 const before = JSON.stringify(f.tasks()); assert.deepEqual(f.collect(), ['111']);
 assert.equal(JSON.stringify(f.tasks()), before);
});

function compile(source: string, dependencies: Record<string, unknown>) {
 const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}
test('actual prepared Creator candidate callback queries the live shared pool on every opening', () => {
 const f = fixture(); f.set(['111']);
 const source = readFileSync('main.ts', 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 let callback = '';
 function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'candidates' && node.initializer.getText(ast).includes('collectNativeFieldValueCandidates')) callback = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
 }
 visit(ast); assert.ok(callback);
 const candidates = compile('return function () { return (' + callback + '); }', {
  propertyCatalog: { resolve: () => ({ type: 'text' }) }, collectNativeFieldValueCandidates,
 }).call({ app: f.app, settings: { keyMappings: f.mappings }, indexer: { getAllTasks: f.tasks } });
 assert.deepEqual(candidates(f.name), ['111']); f.set(['222']); assert.deepEqual(candidates(f.name), ['222']);
});
test('actual Editor native picker receives shared suggestions while keeping mutations in the draft', () => {
 const f = fixture(); f.set(['111', '222']);
 const source = readFileSync('src/ui/task-editor-content.ts', 'utf8');
 const ast = ts.createSourceFile('editor.ts', source, ts.ScriptTarget.Latest, true);
 let method = '';
 function visit(node: ts.Node) { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'openFilePropertyPicker') method = node.getText(ast); ts.forEachChild(node, visit); }
 visit(ast); assert.ok(method);
 let captured: any; let draft: unknown;
 const Host = compile('class Host { ' + method + ' }; return Host;', { collectNativeFieldValueCandidates,
  isEmptyFilePropertyValue: (value: unknown) => value === '', openTableFilePropertyPicker: (options: any) => { captured = options; return () => {}; } });
 const action = { addClass() {}, removeClass() {} };
 const host = new Host(); Object.assign(host, { app: f.app, settings: { keyMappings: f.mappings }, indexer: { getAllTasks: f.tasks }, propertyInteractionEpoch: 0,
  fileProperties: new Map([[f.name, { field: { type: 'text' }, value: '', baseline: { present: false } }]]),
  filePropertyRows: new Map([[f.name, { action, row: { querySelectorAll: () => [] } }]]),
  canEditFileProperty: () => true, setFilePropertyValue: (_name: string, value: unknown) => { draft = value; } });
 host.openFilePropertyPicker(f.name); assert.deepEqual(captured.candidates, ['111', '222']);
 assert.equal(draft, undefined); captured.onMutation({ kind: 'set', value: '111' }); assert.equal(draft, '111');
 assert.equal(f.index.counters.reads, 0);
});

test('hydrated sources become available again through existing reindex after property definitions change', () => {
 const f = fixture(); const source = f.set(['111']);
 f.index.restore('Synthetic.md', persistNativePropertySource(source), '1:100');
 assert.deepEqual(f.collect(), ['111']);
 f.index.configure({ keyMappings: f.mappings, inlinePropertyDefinitions: { version: 1, entries: [
  { sourceName: f.name, type: 'text', encoding: 'vault-v1' },
  { sourceName: 'Unrelated', type: 'text', encoding: 'vault-v1' },
 ] } });
 assert.deepEqual(f.collect(), []);
 f.index.accept('Synthetic.md', source);
 assert.deepEqual(f.collect(), ['111']); assert.equal(f.index.counters.reads, 0);
});
