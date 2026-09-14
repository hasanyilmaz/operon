import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/ui/settings-tab.ts', import.meta.url), 'utf8');
const registry = await readFile(new URL('../src/ui/settings/settings-search-registry.ts', import.meta.url), 'utf8');
const locale = JSON.parse(await readFile(new URL('../i18n/locales/en.json', import.meta.url), 'utf8'));
const method = name => {
 const start = source.indexOf(`\tprivate ${name}(`);
 assert.ok(start >= 0);
 return source.slice(start, source.indexOf('\n\tprivate ', start + 1));
};
const compiled = await transform(`const t = (_ns, key) => key;
export default class Harness {
${method('buildSettingsSearchTabPage')}
${method('buildTaskCaptureSearchSections')}
getSettingsSearchTabPageName(tab) { return tab.id; }
getSettingsSearchTabDescription() { return ''; }
getSettingsSearchAliasesForEntries(entries) { return entries.flatMap(e => e.aliases); }
getSettingsSearchText(ref) { return ref.key; }
}`, { loader: 'ts', format: 'esm', target: 'es2022' });
const { default: Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const entriesFor = tabId => [...registry.matchAll(/(?:e|section)\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)',([^\n]*)/g)]
 .filter(m => m[2] === tabId)
 .map(m => ({ id: `${m[1]}.${m[3]}`, name: { key: m[5] }, desc: { key: m[6] }, aliases: [...m[7].matchAll(/'([^']+)'/g)].map(a => a[1]) }));

for (const [tabId, count] of [['tasksFileTasks',7],['tasksInlineTasks',2],['tasksTaskRouter',3]]) {
 test(`${tabId}: actual page tree indexes every existing entry once without rendering or saving`, () => {
  const harness = new Harness();
  const entries = entriesFor(tabId);
  assert.ok(entries.length > 0);
  const page = harness.buildSettingsSearchTabPage({id:tabId}, entries);
  assert.equal(page.type,'page');
  assert.equal(page.page,undefined);
  assert.equal(page.items.length,count);
  for (const entry of entries) {
   assert.equal(page.items.filter(item => item.aliases.includes(entry.name.key)).length,1,entry.id);
  }
  for (const item of page.items) {
   assert.ok(locale.settings[item.name], `translated title ${item.name}`);
   assert.equal(typeof item.render,'function');
  }
 });
}

test('daily and weekly searches resolve separate existing renderers', () => {
 const harness = new Harness();
 const calls = [];
 harness.renderFileDailyNotesSettings = el => calls.push(['daily',el]);
 harness.renderFileWeeklyNotesSettings = el => calls.push(['weekly',el]);
 const items = harness.buildSettingsSearchTabPage({id:'tasksFileTasks'}, entriesFor('tasksFileTasks')).items;
 for (const kind of ['daily','weekly']) {
  const matches = items.filter(item => item.aliases.includes(`${kind} notes`));
  assert.equal(matches.length,1);
  const el = { empty(){}, removeClass(value){ assert.equal(value,'setting-item'); }, addClass(...values){ assert.deepEqual(values,['operon-settings-tab-root','operon-settings-native-page-root']); } };
  matches[0].render({settingEl:el});
  assert.deepEqual(calls.at(-1),[kind,el]);
 }
});
