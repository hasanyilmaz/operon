import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(tmpdir(), 'operon-id-reference-repair-'));
try {
 const outfile = path.join(dir, 'test.mjs');
 const modules = [['TaskIdReferenceRepair', 'src/core/task-id-repair-references'], ['buildOperonDataPackageFromSettings', 'src/storage/operon-data-package'], ['DEFAULT_SETTINGS', 'src/types/settings'], ['buildReminderSourceLogicalKey', 'src/core/reminder-scheduler-model']];
 await build({ stdin: { contents: modules.map(([name, file]) => `export { ${name} } from ${JSON.stringify(path.join(root, file))};`).join('\n'), resolveDir: root, loader: 'ts' }, outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
 const {TaskIdReferenceRepair, buildOperonDataPackageFromSettings, DEFAULT_SETTINGS, buildReminderSourceLogicalKey} = await import(pathToFileURL(outfile).href);
 const old = 'm2r-body', next = 'new1234', other = 'other01';
 const repair = new TaskIdReferenceRepair(old, next);
 let count = 0;
 const test = (name, run) => { run(); count++; console.log('PASS', name); };
 const immutable = (value, operation) => { const before = structuredClone(value); const result = operation(value); assert.deepEqual(value, before); return result; };
 test('rejects same or incompatible replacement identities', () => {
  for (const args of [[old, old], [old, 'ABC1234'], [' new1234 ', next]]) assert.throws(() => new TaskIdReferenceRepair(...args));
 });
 test('missing old identity never matches blank references but still checks replacement collisions', () => {
  const r = new TaskIdReferenceRepair(null,next);
  assert.equal(r.id(''),'');assert.equal(r.list(' ; '),' ; ');
  assert.throws(()=>r.id(next));
 });
 test('exact scalar matching preserves partial names and free text', () => {
  assert.equal(repair.id(old), next); assert.equal(repair.id('prefix-' + old), 'prefix-' + old); assert.equal(repair.id('[[m2r-body]]'), '[[m2r-body]]');
 });
 test('repairs both raw and normalized references for a whitespace-invalid source ID', () => {
  const r = new TaskIdReferenceRepair(' m2r-body ', next);
  assert.equal(r.id(' m2r-body '), next); assert.equal(r.id(old), next);
 });
 test('bare list replacement preserves surrounding whitespace and separators', () => {
  assert.equal(repair.list(` ${other};  ${old} ;x${old};`), ` ${other};  ${next} ;x${old};`);
 });
 test('wiki paths, aliases, embedded separators and escaped separators are not ID references', () => {
  const value = `[[${old}]];[[x;${old};y|${old}]];x\\;${old};${old}`;
  assert.equal(repair.list(value), `[[${old}]];[[x;${old};y|${old}]];x\\;${old};${next}`);
 });
 test('terminal backslash and unclosed wikilink text are preserved', () => {
  for (const value of ['path\\', `${old};path\\`, `[[x;${old}`, `${old};[[x`]) {
   assert.equal(repair.list(value), value.startsWith(old+';') ? next+value.slice(old.length) : value);
  }
 });
 test('ambiguous semicolon-containing ID is not guessed from a list', () => assert.throws(() => new TaskIdReferenceRepair('bad;id', next).list('bad;id;other')));
 test('dangling replacement references are collisions', () => {
  assert.throws(() => repair.id(next)); assert.throws(() => repair.ids([old, next])); assert.throws(() => repair.list(`${old};${next}`));
 });
 test('table references change without rewriting group, preset, path or filter identities', () => {
  const value = {id:old,name:old,filterSetId:old,collapsedGroupKeys:[old],expandedTaskTreeIds:[old,other],search:{scope:{},parent:{mode:'all',parentId:old,parentName:old}},future:{path:old}};
  assert.deepEqual(immutable(value,x=>repair.table(x)), {...value,expandedTaskTreeIds:[next,other],search:{scope:{},parent:{mode:'all',parentId:next,parentName:old}}});
 });
 const date='2026-09-11T10:00:00', epoch=123456;
 const record={key:`${old}@${epoch}`,operonId:old,epochMs:epoch,localDatetime:date,sourceLogicalKeys:[buildReminderSourceLogicalKey(old,date,'reminderRules',old)],sources:[{fieldKey:'reminderRules',index:0,rawValue:old}],state:'delivered',updatedAt:'keep'};
 console.log(`Task ID reference repair: ${count}/${count} passed`);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
