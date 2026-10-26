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
${method('buildTaskCaptureSearchSection')}
${method('buildTaskRouterSettingsItems')}
${method('buildTaskSettingsGroups')}
${method('isTaskSettingsEntryVisible')}
${method('renderPeriodicRoutingSettings')}
${method('renderPeriodicFileTaskSettings')}
buildDeclarativeSettingsDocsButton() { return () => {}; }
getSettingsSearchTabPageName(tab) { return tab.id; }
getSettingsSearchTabDescription() { return ''; }
getSettingsSearchAliasesForEntries(entries) { return entries.flatMap(e => e.aliases); }
getSettingsSearchAliases(entry) { return entry.aliases; }
getSettingsSearchText(ref) { return ref.key; }
}`, { loader: 'ts', format: 'esm', target: 'es2022' });
const { default: Harness } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const entriesFor = tabId => [...registry.matchAll(/(?:e|section)\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)',([^\n]*)/g)]
 .filter(m => m[2] === tabId)
 .map(m => ({ id: `${m[1]}.${m[3]}`, name: { key: m[5] }, desc: { key: m[6] }, aliases: [...m[7].matchAll(/'([^']+)'/g)].map(a => a[1]) }));

for (const [tabId, count] of [['tasksFileTasks',6],['tasksInlineTasks',4],['tasksTaskRouter',6]]) {
 test(`${tabId}: actual page tree indexes every existing entry once without rendering or saving`, () => {
  const harness = new Harness();
  const entries = entriesFor(tabId);
  assert.ok(entries.length > 0);
  const page = harness.buildSettingsSearchTabPage({id:tabId}, entries);
  assert.equal(page.type,'page');
  assert.equal(page.page,undefined);
  assert.equal(page.items.length,count);
  const leaves = page.items.flatMap(item => item.items ?? [item]);
  for (const entry of entries) {
   assert.equal(leaves.filter(item => item.name === entry.name.key).length,1,entry.id);
  }
  for (const item of leaves) {
   assert.ok(locale.settings[item.name], `translated title ${item.name}`);
   assert.equal(typeof item.render,'function');
  }
 });
}

test('daily and weekly searches resolve separate existing renderers', () => {
 const harness = new Harness();
 const calls = [];
 harness.renderPeriodicRoutingSettings = (el, key) => calls.push([key.includes('Weekly') || key.startsWith('weekly') ? 'weekly' : 'daily',el]);
 const items = harness.buildSettingsSearchTabPage({id:'tasksTaskRouter'}, entriesFor('tasksTaskRouter')).items.flatMap(group => group.items);
 for (const kind of ['daily','weekly']) {
  const matches = items.filter(item => item.aliases.includes(`${kind} notes`));
  assert.equal(matches.length,4);
  const el = { empty(){}, removeClass(value){ assert.equal(value,'setting-item'); }, addClass(...values){ assert.deepEqual(values,['operon-settings-tab-root','operon-settings-native-page-root']); } };
  for (const item of matches) item.render({settingEl:el});
  assert.deepEqual(calls.at(-1),[kind,el]);
 }
});

for (const tabId of ['tasksInlineTasks','tasksFileTasks','tasksTaskRouter']) {
 test(`${tabId}: sibling search text is isolated per setting`, () => {
  const entries=entriesFor(tabId);const page=new Harness().buildSettingsSearchTabPage({id:tabId},entries);
  const leaves=page.items.flatMap(g=>g.items);assert.equal(leaves.length,entries.length);
  for(const entry of entries){const item=leaves.find(i=>i.name===entry.name.key);assert.ok(item);assert.equal(item.desc,entry.desc.key);assert.deepEqual(item.aliases,entry.aliases);assert.equal(typeof item.visible,'function');}
 });
}

test('bulk Tasks action renders through its own searchable section without persisting settings', () => {
 const harness = new Harness(), calls = [];
 harness.renderTasksBulkConversion = el => calls.push(el);
 const page = harness.buildSettingsSearchTabPage({ id: 'tasksInlineTasks' }, entriesFor('tasksInlineTasks'));
 assert.deepEqual(page.items.map(group => group.heading), ['newInlineTaskCreationDefaults', 'dailyNoteInlineTaskDefaults', 'checkboxConversion', 'tasksBulkTitle']);
 const action = page.items.at(-1).items[0];
 const el = { empty(){}, removeClass(){}, addClass(){} };
 action.render({ settingEl: el }); assert.deepEqual(calls, [el]);
 assert.ok(action.aliases.includes('tasks emoji'));
});

 test('periodic controls stay available for every placement without changing preferences', () => {
  for (const mode of ['daily-notes', 'weekly-notes', 'active-file', 'specific-file', 'ask']) {
   const harness = new Harness();
   harness.settings = {inlineTaskSaveMode: mode, manageDailyNotesWithOperon: false, manageWeeklyNotesWithOperon: true, createDailyNotesAsOperonTask: true, createWeeklyNotesAsOperonTask: false};
   const before = JSON.stringify(harness.settings);
   const calls = [];
   harness.renderFileDailyNotesSettings = () => calls.push('daily');
   harness.renderFileWeeklyNotesSettings = () => calls.push('weekly');
   harness.renderBoundToggleSetting = (_el, _name, _desc, key) => calls.push(key);
   harness.renderPeriodicRoutingSettings({});
   harness.renderPeriodicFileTaskSettings({});
   assert.deepEqual(calls, ['daily', 'weekly', 'createDailyNotesAsOperonTask', 'createWeeklyNotesAsOperonTask']);
   for (const key of ['manageDailyNotesWithOperon', 'manageWeeklyNotesWithOperon', 'createDailyNotesAsOperonTask', 'createWeeklyNotesAsOperonTask']) assert.equal(harness.isTaskSettingsEntryVisible(key), true);
   assert.equal(harness.isTaskSettingsEntryVisible('dailyNoteFormat'), false);
   assert.equal(harness.isTaskSettingsEntryVisible('weeklyNoteFormat'), true);
   assert.equal(JSON.stringify(harness.settings), before);
  }
 });

test('Daily and Weekly headings and singular/plural search aliases remain discoverable', () => {
 assert.equal(locale.settings.periodicNotes, 'Daily and Weekly Notes');
 assert.equal(locale.settings.periodicNotesAsFileTasks, 'Daily and Weekly Notes as File Tasks');
 for (const kind of ['daily', 'weekly']) {
  for (const [tabId, expected] of [['tasksTaskRouter', 4], ['tasksFileTasks', 1]]) {
   const page = new Harness().buildSettingsSearchTabPage({id: tabId}, entriesFor(tabId));
   const items = page.items.flatMap(group => group.items);
   for (const query of [kind, `${kind} note`, `${kind} notes`]) assert.equal(items.filter(item => item.aliases.includes(query)).length, expected, `${tabId}: ${query}`);
  }
 }
});
