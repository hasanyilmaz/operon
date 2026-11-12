import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStatusDockSections, STATUS_DOCK_SECTION_IDS, STATUS_DOCK_AVAILABLE_SECTION_IDS } from '../src/types/status-dock-sections';

test('absent or invalid settings use the eight enabled sections', () => {
 for (const value of [undefined, null, false, {}, 'tracker']) {
  assert.deepEqual(normalizeStatusDockSections(value), STATUS_DOCK_SECTION_IDS.map(id => ({ id, enabled: true })));
 }
 assert.deepEqual(STATUS_DOCK_AVAILABLE_SECTION_IDS, STATUS_DOCK_SECTION_IDS);
});

test('normalization preserves explicit order and disabled choices without changing its input', () => {
 const input = [{ id: 'upcoming', enabled: false }, { id: 'tracker', enabled: true }, { id: 'upcoming', enabled: true }, null, { id: 'unknown', enabled: false }];
 const before = JSON.stringify(input);
 const sections = normalizeStatusDockSections(input);
 assert.deepEqual(sections.slice(0, 2), [{ id: 'upcoming', enabled: false }, { id: 'tracker', enabled: true }]);
 assert.equal(sections.length, 8);
 assert.deepEqual(normalizeStatusDockSections(sections), sections);
 assert.equal(JSON.stringify(input), before);
});

test('Creator defaults immediately after Tracker and keeps an explicitly saved position', () => {
 const previous = [{ id: 'upcoming', enabled: false }, { id: 'tracker', enabled: false }, { id: 'ongoing', enabled: true }];
 const resolved = normalizeStatusDockSections(previous);
 assert.deepEqual(resolved.slice(0, 4), [previous[0], previous[1], { id: 'creator', enabled: true }, previous[2]]);
 assert.deepEqual(normalizeStatusDockSections([{ id: 'creator', enabled: false }, ...previous]).slice(0, 4), [
  { id: 'creator', enabled: false }, ...previous,
 ]);
});

test('normalization produces independent values and preserves all-disabled state', () => {
 const first = normalizeStatusDockSections(undefined);
 first[0].enabled = false;
 assert.equal(normalizeStatusDockSections(undefined)[0].enabled, true);
 assert.ok(normalizeStatusDockSections(STATUS_DOCK_SECTION_IDS.map(id => ({ id, enabled: false }))).every(section => !section.enabled));
});

import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { buildOperonSettingsBackupSelectedPatchV1 } from '../src/core/settings-backup-apply';

test('optional sections stay absent in old packages and backups without writing defaults', () => {
 const settings = migrateSettings({ ...DEFAULT_SETTINGS, upcomingShowStatusBar: false });
 assert.equal(settings.statusDockSections, undefined);
 const pkg = buildOperonDataPackageFromSettings(settings), before = JSON.stringify(pkg);
 assert.equal(pkg.ui.statusDock?.sections, undefined);
 const restored = composeOperonSettingsFromDataPackage(pkg, DEFAULT_SETTINGS);
 assert.equal(restored.statusDockSections, undefined);
 assert.equal(restored.upcomingShowStatusBar, false);
 assert.equal(JSON.stringify(pkg), before);
 assert.equal(buildOperonSettingsBackupSelectedPatchV1({ selectedGroups: ['general'], candidateSettings: settings }).statusDockSections, undefined);
});

test('explicit sections survive package and backup round trips without a general-domain duplicate', () => {
 const sections = normalizeStatusDockSections([{id:'ongoing',enabled:false},{id:'tracker',enabled:false}]);
 const settings = migrateSettings({...DEFAULT_SETTINGS, statusDockSections:sections, upcomingShowStatusBar:false});
 const pkg = buildOperonDataPackageFromSettings(settings);
 assert.deepEqual(pkg.ui.statusDock?.sections, sections);
 assert.equal('statusDockSections' in pkg.settings, false);
 assert.deepEqual(composeOperonSettingsFromDataPackage(pkg, DEFAULT_SETTINGS).statusDockSections, sections);
 assert.deepEqual(buildOperonSettingsBackupSelectedPatchV1({selectedGroups:['general'],candidateSettings:settings}).statusDockSections, sections);
});

test('an old saved order needs no startup write and the automatic timer preference persists separately', async () => {
 const fixture = new SettingsPreservationHarness();
 try {
  await fixture.createStorage().initialize();
  const pkg = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
  const sections = STATUS_DOCK_SECTION_IDS.filter(id => id !== 'creator').map(id => ({ id, enabled: id !== 'tracker' }));
  pkg.ui.statusDock = { sections };
  fixture.seed(fixture.canonicalPath, JSON.stringify(pkg));
  const writes = fixture.canonicalAttempts;
  const storage = fixture.createStorage(); await storage.initialize();
  const settings = storage.getSettings();
  assert.equal(fixture.canonicalAttempts, writes);
  assert.deepEqual(settings.statusDockSections, sections);
  assert.equal(settings.statusDockCreatorStartsTimer, undefined);
  await storage.saveStatusDockTimerPreference('statusDockCreatorStartsTimer', true);
  assert.equal(fixture.canonicalAttempts, writes);
  await storage.saveStatusDockTimerPreference('statusDockCreatorStartsTimer', false);
  assert.deepEqual(JSON.parse(await fixture.adapter.read(fixture.canonicalPath)), {
   ...pkg, ui: { ...pkg.ui, statusDock: { sections, creatorStartsTimer: false } },
  });
  const restarted = fixture.createStorage(); await restarted.initialize();
  assert.equal(restarted.getSettings().statusDockCreatorStartsTimer, false);
  assert.equal(fixture.canonicalAttempts, writes + 1);
  fixture.writeFault = 'throw-before';
  await assert.rejects(restarted.saveStatusDockTimerPreference('statusDockCreatorStartsTimer', true));
  assert.equal(restarted.getSettings().statusDockCreatorStartsTimer, false);
 } finally { await fixture.dispose(); }
});

test('real storage saves narrowly, serializes edits and preserves an old mobile preference', async () => {
 const fixture = new SettingsPreservationHarness();
 try {
  const storage = fixture.createStorage(); await storage.initialize();
  const before = JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
  const writes = fixture.canonicalAttempts;
  normalizeStatusDockSections(storage.getSettings().statusDockSections);
  await storage.saveStatusDockSections(current => current);
  assert.equal(fixture.canonicalAttempts, writes);
  await Promise.all([
   storage.saveStatusDockSections(current => current.map(s => s.id === 'tracker' ? {...s,enabled:false}:s)),
   storage.saveStatusDockSections(current => current.map(s => s.id === 'ongoing' ? {...s,enabled:false}:s)),
  ]);
  const result=storage.getSettings().statusDockSections!;
  assert.equal(result.find(s=>s.id==='tracker')!.enabled,false);
  assert.equal(result.find(s=>s.id==='ongoing')!.enabled,false);
  const after=JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
  assert.deepEqual(after.ui.statusDock.sections,result);
  if(before.ui.statusDock) { delete after.ui.statusDock.sections; } else { delete after.ui.statusDock; }
  assert.deepEqual(after,before);
  const saved=JSON.stringify(storage.getSettings().statusDockSections);
  await storage.reloadCanonicalSettingsPackage();
  assert.equal(JSON.stringify(storage.getSettings().statusDockSections),saved);
 } finally { await fixture.dispose(); }
});

for(const fault of ['throw-before','silent-before'] as const) test('failed sections save preserves memory and does not retry: '+fault,async()=>{
 const fixture=new SettingsPreservationHarness();
 try {
  const storage=fixture.createStorage();await storage.initialize();
  const before=await fixture.adapter.read(fixture.canonicalPath),writes=fixture.canonicalAttempts;
  fixture.writeFault=fault;
  await assert.rejects(storage.saveStatusDockSections(current=>current.map(s=>({...s,enabled:false}))));
  assert.equal(storage.getSettings().statusDockSections,undefined);
  assert.equal(await fixture.adapter.read(fixture.canonicalPath),before);
  assert.equal(fixture.canonicalAttempts,writes+1);
 }finally{await fixture.dispose();}
});

test('external section changes reject a stale save without overwriting the disk',async()=>{
 const fixture=new SettingsPreservationHarness();
 try {
  const storage=fixture.createStorage();await storage.initialize();
  const pkg=JSON.parse(await fixture.adapter.read(fixture.canonicalPath));
  pkg.ui.statusDock={...pkg.ui.statusDock,sections:normalizeStatusDockSections([{id:'upcoming',enabled:false}])};
  fixture.seed(fixture.canonicalPath,JSON.stringify(pkg));
  const before=await fixture.adapter.read(fixture.canonicalPath),writes=fixture.canonicalAttempts;
  await assert.rejects(storage.saveStatusDockSections(current=>current.map(s=>({...s,enabled:false}))));
  assert.equal(fixture.canonicalAttempts,writes);
  assert.equal(await fixture.adapter.read(fixture.canonicalPath),before);
  assert.equal(storage.getSettings().statusDockSections,undefined);
 }finally{await fixture.dispose();}
});
