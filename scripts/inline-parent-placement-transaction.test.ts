import assert from 'node:assert/strict';
import test from 'node:test';
import { commitInlineParentPlacementWrites } from '../src/systems/inline-parent-placement-transaction';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { SETTINGS_BACKUP_COMPATIBILITY_BY_KEY, assertSettingsBackupCompatibilityRegistryExhaustive } from '../src/core/settings-backup-compatibility';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';

const writes = [
 { filePath: 'Target.md', expectedContent: 'parent', nextContent: 'parent\nmoving' },
 { filePath: 'Source.md', expectedContent: 'moving\nchild', nextContent: 'child' },
];
function fixture() {
 const disk = new Map(writes.map(w => [w.filePath, w.expectedContent]));
 const buffers = new Map(disk);
 const calls: string[] = [];
 const port = {
  read: async (path: string) => disk.get(path)!,
  buffersMatch: (path: string, value: string) => buffers.get(path) === value,
  canCommit: () => true,
  write: async (path: string, before: string, after: string, guard: () => boolean) => {
   calls.push(path);
   if (!guard() || disk.get(path) !== before) return false;
   disk.set(path, after); return true;
  },
  synchronize: (path: string, before: string, after: string) => {
   if (buffers.get(path) !== before && buffers.get(path) !== after) return false;
   buffers.set(path, after); return true;
  },
 };
 return { disk, buffers, calls, port };
}
test('placement transaction writes destination first and synchronizes open buffers', async () => {
 const f = fixture(); assert.equal(await commitInlineParentPlacementWrites(writes, f.port), 'committed');
 assert.deepEqual(f.calls, ['Target.md', 'Source.md']);
 for (const write of writes) { assert.equal(f.disk.get(write.filePath), write.nextContent); assert.equal(f.buffers.get(write.filePath), write.nextContent); }
});
for (const fault of ['first-write', 'second-write', 'commit-guard', 'source-conflict'] as const) {
 test(`placement transaction restores exact contents after ${fault}`, async () => {
  const f = fixture(), original = f.port.write; let count = 0;
  f.port.write = async (...args) => {
   count++;
   if ((fault === 'first-write' && count === 1) || (fault === 'second-write' && count === 2)) throw new Error('write failed');
   if (fault === 'source-conflict' && args[0] === 'Source.md') return false;
   return original(...args);
  };
  if (fault === 'commit-guard') f.port.canCommit = () => count === 0;
  assert.equal(await commitInlineParentPlacementWrites(writes, f.port), 'rolled-back');
  for (const w of writes) { assert.equal(f.disk.get(w.filePath), w.expectedContent); assert.equal(f.buffers.get(w.filePath), w.expectedContent); }
 });
}
test('pre-existing dirty open editor or changed source causes zero writes', async () => {
 for (const kind of ['buffer', 'disk']) {
  const f=fixture(); (kind === 'buffer' ? f.buffers : f.disk).set('Source.md', 'user text');
  assert.equal(await commitInlineParentPlacementWrites(writes, f.port), 'rolled-back'); assert.deepEqual(f.calls, []);
 }
});
test('uncertain write is inspected once, never replayed', async () => {
 const f=fixture(), original=f.port.write;
 f.port.write=async (...args) => { const ok=await original(...args); if (ok) { f.port.synchronize(args[0],args[1],args[2]); throw new Error('lost ack'); } return ok; };
 assert.equal(await commitInlineParentPlacementWrites(writes,f.port),'committed'); assert.deepEqual(f.calls,['Target.md','Source.md']);
});
test('unverifiable write preserves external content and reports uncertainty', async () => {
 const f=fixture(); f.port.write=async (path) => { f.calls.push(path); f.disk.set(path,'external'); throw new Error('uncertain'); };
 assert.equal(await commitInlineParentPlacementWrites(writes,f.port),'outcome-unknown'); assert.equal(f.disk.get('Target.md'),'external'); assert.equal(f.disk.get('Source.md'),'moving\nchild'); assert.deepEqual(f.calls,['Target.md']);
});
test('rollback conflict never overwrites later user text', async () => {
 const f=fixture(), original=f.port.write;
 f.port.write=async (...args) => { if(args[0]==='Source.md') {f.disk.set('Target.md','later text'); throw new Error('fail');} return original(...args); };
 assert.equal(await commitInlineParentPlacementWrites(writes,f.port),'outcome-unknown'); assert.equal(f.disk.get('Target.md'),'later text'); assert.equal(f.disk.get('Source.md'),'moving\nchild');
});
test('destination edited between steps prevents source removal', async () => {
 const f=fixture(), original=f.port.synchronize;
 f.port.synchronize=(...args) => { const ok=original(...args); if(args[0]==='Target.md') f.disk.set('Target.md','later edit'); return ok; };
 assert.equal(await commitInlineParentPlacementWrites(writes,f.port),'outcome-unknown'); assert.equal(f.disk.get('Source.md'),'moving\nchild'); assert.deepEqual(f.calls,['Target.md']);
});
test('same-file operation commits exactly once', async () => {
 const f=fixture(); assert.equal(await commitInlineParentPlacementWrites(writes.slice(0,1), f.port),'committed'); assert.deepEqual(f.calls,['Target.md']);
});
test('new setting defaults off; only boolean true enables legacy migration', () => {
 assert.equal(DEFAULT_SETTINGS.keepInlineTasksWithParent, false);
 for(const raw of [undefined,null,false,0,1,'true',{},[]]) assert.equal(migrateSettings({keepInlineTasksWithParent:raw}).keepInlineTasksWithParent,false);
 assert.equal(migrateSettings({keepInlineTasksWithParent:true}).keepInlineTasksWithParent,true);
});
test('existing canonical package round-trips toggle in automation without changing version', () => {
 const settings={...DEFAULT_SETTINGS,keepInlineTasksWithParent:true,inlineTaskParentFileHeadingKeyword:'Work'};
 const pkg=buildOperonDataPackageFromSettings(settings);
 assert.equal(pkg.automation.taskAutomationPolicy.keepInlineTasksWithParent,true);
 assert.equal(pkg.schemaVersion,buildOperonDataPackageFromSettings(DEFAULT_SETTINGS).schemaVersion);
 const loaded=composeOperonSettingsFromDataPackage(pkg,DEFAULT_SETTINGS);
 assert.equal(loaded.keepInlineTasksWithParent,true); assert.equal(loaded.inlineTaskParentFileHeadingKeyword,'Work');
 const legacy=JSON.parse(JSON.stringify(pkg));delete legacy.automation.taskAutomationPolicy.keepInlineTasksWithParent;
 assert.equal(migrateSettings(composeOperonSettingsFromDataPackage(legacy,DEFAULT_SETTINGS)).keepInlineTasksWithParent,false);
});
test('backup registry and Settings Search include one boolean Task Router setting', () => {
 assertSettingsBackupCompatibilityRegistryExhaustive(DEFAULT_SETTINGS);
 assert.ok(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.keepInlineTasksWithParent);
 const entries=OPERON_SETTINGS_SEARCH_REGISTRY.filter(entry=>entry.key==='keepInlineTasksWithParent');
 assert.equal(entries.length,1); assert.equal(entries[0].tabId,'tasksTaskRouter'); assert.equal(entries[0].control,'toggle');
});

test('destination buffer changed inside source write guard never loses the moving task', async () => {
 const f=fixture(), original=f.port.write;
 f.port.write=async (...args) => {
  if(args[0]==='Source.md') {f.disk.set('Target.md','parent\nlater edit');f.buffers.set('Target.md','parent\nlater edit');}
  return original(...args);
 };
 assert.equal(await commitInlineParentPlacementWrites(writes,f.port),'outcome-unknown');
 assert.equal(f.disk.get('Source.md'),'moving\nchild');
 assert.equal(f.disk.get('Target.md'),'parent\nlater edit');
});
