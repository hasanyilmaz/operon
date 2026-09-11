import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(tmpdir(), 'operon-id-repair-'));
try {
 const outfile = path.join(dir, 'test.mjs');
 await build({
  stdin: { contents: `export { planInlineTaskIdRepair } from ${JSON.stringify(path.join(root, 'src/core/task-id-repair'))}; export { parseTaskLine } from ${JSON.stringify(path.join(root, 'src/core/parser'))};`, resolveDir: root, loader: 'ts' },
  outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
  alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') },
 });
 const { planInlineTaskIdRepair: plan, parseTaskLine: parse } = await import(pathToFileURL(outfile).href);
 const sourcePath = 'Tasks.md';
 const now = '2026-09-11T15:00:00';
 const next = 'new1234';
 let count = 0;
 const test = (name, run) => { run(); count++; console.log('PASS', name); };
 const task = (line, lineNumber = 0, mappings = []) => parse(line, lineNumber, sourcePath, mappings);
 const repair = (line, content = line, occupied = new Set(), mappings = []) => plan(content, task(line, 0, mappings), next, now, occupied, mappings);
 const original = '- [ ] Keep **format** [[note|title]] #tag {{operonId:: m2r-body}} {{note:: m2r-body}} {{datetimeCreated:: 2026-09-01T10:00:00}}';
 test('repairs only identity and modified timestamp, preserving description and arbitrary fields', () => {
  const r = repair(original); assert.equal(r.ok, true);
  assert.equal(r.content, original.replace('{{operonId:: m2r-body}}', '{{operonId:: new1234}}') + ` {{datetimeModified:: ${now}}}`);
  assert.equal(r.previousId, 'm2r-body');
 });
 test('retains surrounding note and CRLF bytes', () => {
  const raw = original + '\r'; const content = 'Heading\r\n' + raw + '\nUnrelated\r\n';
  const r = plan(content, task(raw, 1), next, now, new Set()); assert.equal(r.ok, true);
  assert.equal(r.content, 'Heading\r\n' + original.replace('operonId:: m2r-body', 'operonId:: new1234') + ` {{datetimeModified:: ${now}}}\r\nUnrelated\r\n`);
 });
 test('replaces existing timestamp without duplicating or reordering fields', () => {
  const raw = '- [ ] A {{datetimeModified:: 2020-01-01T00:00:00}} {{operonId:: bad-id}}';
  assert.equal(repair(raw).content, `- [ ] A {{datetimeModified:: ${now}}} {{operonId:: ${next}}}`);
 });
 test('removes whitespace that would leave the replacement ID invalid', () => {
  const raw = '- [ ] A {{operonId::   bad-id   }}';
  assert.equal(repair(raw).content, `- [ ] A {{operonId:: ${next}}} {{datetimeModified:: ${now}}}`);
 });
 for (const raw of ['- [ ] A {{status:: task.todo}}', '- [ ] A {{operonId:: }}']) test('adds an ID to metadata task: ' + raw, () => {
  const r = repair(raw); assert.equal(r.ok, true); assert.equal(task(r.content).operonId, next);
 });
 for (const id of ['ABC1234', 'short', 'toolong88', 'm2r-body', 'äbc1234']) test('accepts repair of incompatible ID ' + id, () => assert.equal(repair(`- [ ] A {{operonId:: ${id}}}`).ok, true));
 test('ordinary checkbox does not acquire task identity', () => assert.equal(repair('- [ ] plain').reason, 'not-repairable'));
 test('valid existing identity is not regenerated', () => assert.equal(repair('- [ ] A {{operonId:: abc1234}}').reason, 'not-repairable'));
 test('changed source is rejected, even if same ID survives', () => assert.equal(repair(original, original.replace('Keep', 'Changed')).reason, 'source-changed'));
 test('does not search for a moved source task', () => assert.equal(repair(original, '\n' + original).reason, 'source-changed'));
 test('fenced example is not executable', () => assert.equal(plan('```\n' + original + '\n```', task(original, 1), next, now, new Set()).reason, 'not-repairable'));
 for (const [opening, middle, closing] of [['```md', '~~~', '```'], ['````md', '```', '````'], ['~~~md', '```', '~~~'], ['```md', '```not-a-close', '```']]) test('unmatched fence remains protected: ' + opening + '/' + middle, () => {
  const content = [opening, middle, original, closing].join('\n');
  assert.equal(plan(content, task(original, 2), next, now, new Set()).reason, 'not-repairable');
 });
 test('task after a matching longer close remains repairable', () => {
  const content = ['```md', 'example', '````', original].join('\n');
  assert.equal(plan(content, task(original, 3), next, now, new Set()).ok, true);
 });
 test('unclosed frontmatter is rejected', () => {
  const content = ['---', 'example: |', original].join('\n');
  assert.equal(plan(content, task(original, 2), next, now, new Set()).reason, 'not-repairable');
 });
 test('fence-like YAML content does not hide a real task in the body', () => {
  const content = ['---', 'example: |', '  ```', '---', original].join('\n');
  assert.equal(plan(content, task(original, 4), next, now, new Set()).ok, true);
 });
 test('frontmatter block scalar is not executable', () => assert.equal(plan('---\nexample: |\n  ' + original + '\n---\n', task('  ' + original, 2), next, now, new Set()).reason, 'not-repairable'));
 test('rejects occupied replacement identity', () => assert.equal(repair(original, original, new Set([next])).reason, 'invalid-replacement'));
 test('rejects invalid replacement identity', () => assert.equal(plan(original, task(original), 'bad-id', now, new Set()).reason, 'invalid-replacement'));
 test('rejects injected timestamp markup', () => assert.equal(plan(original, task(original), next, now + '}} {{status:: task.done', new Set()).reason, 'invalid-replacement'));
 test('rejects duplicate identity fields without guessing', () => assert.equal(repair(original + ' {{operonId:: other-bad}}').reason, 'ambiguous-fields'));
 test('rejects duplicate modified timestamp fields', () => assert.equal(repair(original + ' {{datetimeModified:: x}} {{datetimeModified:: y}}').reason, 'ambiguous-fields'));
 test('mapped ID field is repaired in place', () => {
  const mappings = [{ canonicalKey: 'operonId', visiblePropertyName: 'TaskIdentity' }];
  const raw = '- [ ] A {{TaskIdentity:: bad-id}}';
  const r = repair(raw, raw, new Set(), mappings); assert.equal(r.ok, true); assert.equal(r.content, `- [ ] A {{TaskIdentity:: ${next}}} {{datetimeModified:: ${now}}}`);
 });
 test('ambiguous mapped plus canonical identity is rejected', () => {
  const mappings = [{ canonicalKey: 'operonId', visiblePropertyName: 'TaskIdentity' }];
  const raw = '- [ ] A {{TaskIdentity:: bad-id}} {{operonId:: other-id}}';
  assert.equal(repair(raw, raw, new Set(), mappings).reason, 'ambiguous-fields');
 });
 console.log(`Task ID repair source plan: ${count}/${count} passed`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
