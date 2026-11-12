import assert from 'node:assert/strict';
import test from 'node:test';
import { withSettingsFixture } from './test-support/settings-preservation-harness';
import { buildOperonDataPackageFromSettings, type OperonDataPackageV1 } from '../src/storage/operon-data-package';
import { DEFAULT_SETTINGS, type FilterSet } from '../src/types/settings';
import { captureFilterFolderRenames } from '../src/core/filter-folder-paths';
import { createDefaultTablePreset } from '../src/types/table';
import type { OperonStorage } from '../src/storage/operon-storage';

const initialRaw = () => JSON.stringify(buildOperonDataPackageFromSettings(structuredClone(DEFAULT_SETTINGS)));
const boundPreset = () => ({ ...createDefaultTablePreset(), id: 'tp_reload', filterSetId: 'fs_missing' });
async function bindPreset(storage: OperonStorage): Promise<void> {
 const preset = boundPreset();
 await storage.reconcileTablePresetFileAuthority({
  presetIds: [preset.id], fileBindings: [{ id: preset.id, path: 'Tables/Reload.table' }],
  tableDefaultPresetId: preset.id, initialized: true,
 }, [preset]);
}

for (const bound of [false, true]) test(`unchanged reload preserves disk and runtime without writes (missing filter preset: ${bound})`, async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  if (bound) await bindPreset(storage);
  const disk = fixture.raw(); const settings = JSON.stringify(storage.getSettings());
  const count = fixture.operations.length;
  for (let i = 0; i < 3; i++) {
   assert.equal((await storage.reloadCanonicalSettingsPackage()).changed, false);
   assert.equal(fixture.raw(), disk); assert.equal(JSON.stringify(storage.getSettings()), settings);
  }
  assert.deepEqual(fixture.operations.slice(count), []);
  if (bound) assert.equal(storage.getSettings().tablePresets[0].filterSetId, 'fs_missing');
 });
});

for (const kind of ['setting', 'binding', 'order', 'view', 'filter-return'] as const) test(`real ${kind} change is adopted once and then settles`, async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize(); await bindPreset(storage);
  const data = fixture.package();
  if (kind === 'setting') { data.settings.language = 'de'; data.settings.fileTaskDisplayTitleEnabled = true; }
  if (kind === 'binding') { assert.ok(data.views.tablePresets.fileBindings); data.views.tablePresets.fileBindings[0].path = 'Tables/Renamed.table'; }
  if (kind === 'order') data.views.tablePresets.presetIds = ['tp_unavailable', 'tp_reload'];
  if (kind === 'view') data.views.tablePresets.tableShowLineNumbers = !data.views.tablePresets.tableShowLineNumbers;
  if (kind === 'filter-return') {
   const template = structuredClone(storage.getSettings().filterSets[0]);
   assert.ok(template); template.id = 'fs_missing'; template.name = 'Returned filter';
   data.views.filters.filterIds.push(template.id);
   data.views.filters.itemsById[template.id] = template;
  }
  fixture.seed(fixture.canonicalPath, JSON.stringify(data));
  assert.equal((await storage.reloadCanonicalSettingsPackage()).changed, true);
  assert.equal((await storage.reloadCanonicalSettingsPackage()).changed, false);
  assert.equal(storage.getSettings().tablePresets[0].filterSetId, 'fs_missing');
  if (kind === 'setting') { assert.equal(storage.getSettings().language, 'de'); assert.equal(storage.getSettings().fileTaskDisplayTitleEnabled, true); }
  if (kind === 'binding') assert.equal(storage.getSettings().tablePresetFileBindings[0].path, 'Tables/Renamed.table');
  if (kind === 'order') assert.deepEqual(storage.getSettings().tablePresetOrderIds, ['tp_unavailable', 'tp_reload']);
  if (kind === 'view') assert.equal(storage.getSettings().tableShowLineNumbers, data.views.tablePresets.tableShowLineNumbers);
  if (kind === 'filter-return') assert.ok(storage.getSettings().filterSets.some(f => f.id === 'fs_missing'));
 });
});

test('temporarily unavailable preset remains absent without repeated reload changes', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize(); await bindPreset(storage);
  const settings = storage.getSettings();
  await storage.reconcileTablePresetFileAuthority({ presetIds: settings.tablePresetOrderIds, fileBindings: settings.tablePresetFileBindings, tableDefaultPresetId: settings.tableDefaultPresetId, initialized: true }, []);
  const disk = fixture.raw();
  for (let i = 0; i < 3; i++) assert.equal((await storage.reloadCanonicalSettingsPackage()).changed, false);
  assert.deepEqual(storage.getSettings().tablePresets, []); assert.equal(fixture.raw(), disk);
 });
});

test('stage still detects a runtime projection difference with an unchanged canonical package', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  storage.getSettings().tableShowLineNumbers = !fixture.package().views.tablePresets.tableShowLineNumbers;
  const disk = fixture.raw();
  assert.equal((await storage.reloadCanonicalSettingsPackage()).changed, true);
  assert.equal((await storage.reloadCanonicalSettingsPackage()).changed, false);
  assert.equal(fixture.raw(), disk);
 });
});

test('staged rollback retains the existing snapshot and recovery behavior', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  const before = JSON.stringify(storage.getSettings());
  const owner = storage as unknown as { stageCanonicalDataPackageReload(data: OperonDataPackageV1): { changed: boolean; commit(): void; rollback(): void } };
  const data = fixture.package(); data.views.tablePresets.tableShowLineNumbers = !data.views.tablePresets.tableShowLineNumbers;
  const stage = owner.stageCanonicalDataPackageReload(data); assert.equal(stage.changed, true);
  stage.commit(); assert.notEqual(JSON.stringify(storage.getSettings()), before);
  stage.rollback(); assert.equal(JSON.stringify(storage.getSettings()), before);
 });
});

const oldFolder = 'Test-321/External/ClientA';
const newFolder = 'Test-321/Internal/ClientA';
const folderCondition = { id: 'folder-321', field: 'folders', fieldType: 'folders', operator: 'isInFolderTree', value: oldFolder } as const;
const folderRenames = captureFilterFolderRenames(oldFolder, newFolder, [newFolder, newFolder + '/Sub', oldFolder + '-old']);
const folderFilter: FilterSet = {
 id: 'filter-321', name: 'Saved folder filter', rootGroup: { id: 'root', logic: 'all', children: [
  folderCondition,
  { id: 'nested', logic: 'any', children: [
   { ...folderCondition, id: 'sub', value: oldFolder + '/Sub' },
   { ...folderCondition, id: 'neighbor', value: oldFolder + '-old' },
   { id: 'text', field: 'description', fieldType: 'text', operator: 'contains', value: oldFolder },
  ] },
 ] },
 conditions: [folderCondition], matchLogic: 'all', sorts: [{ field: 'description', order: 'desc' }],
};

test('folder move saves only the matching paths once and retains nested filters on restart', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  await storage.filters.upsert(folderFilter);
  const before = fixture.package();
  const writes = fixture.canonicalCommits;
  assert.equal(await storage.renameSavedFilterFolders(folderRenames, () => true), true);
  const expected = structuredClone(before);
  const saved = expected.views.filters.itemsById[folderFilter.id];
  const [root, nested] = saved.rootGroup.children;
  assert.ok('value' in root && 'children' in nested && 'value' in nested.children[0]);
  root.value = newFolder;
  nested.children[0].value = newFolder + '/Sub';
  saved.conditions[0].value = newFolder;
  assert.deepEqual(fixture.package(), expected);
  assert.equal(fixture.canonicalCommits - writes, 1);
  assert.equal(storage.filters.getById(folderFilter.id)?.conditions[0].value, newFolder);
  assert.equal(await storage.renameSavedFilterFolders(folderRenames, () => true), false);
  assert.equal(fixture.canonicalCommits - writes, 1);
  const restarted = fixture.createStorage(); await restarted.initialize();
  assert.deepEqual(restarted.filters.getById(folderFilter.id), storage.filters.getById(folderFilter.id));
 });
});

test('ambiguous suffixes and unrelated folder names do not retarget saved paths', () => {
 const other = 'Another/' + oldFolder;
 assert.equal(captureFilterFolderRenames(oldFolder, newFolder, [newFolder, other]).has(oldFolder.toLowerCase()), false);
 assert.equal(captureFilterFolderRenames(oldFolder, newFolder, [newFolder, 'Another/' + newFolder]).size, 0);
 assert.equal(folderRenames.has('clienta'), false);
 assert.equal(folderRenames.has((oldFolder + '-old').toLowerCase()), false);
});

test('queued folder moves follow event order and skip writes for missing references', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  const attempts = fixture.canonicalAttempts;
  assert.equal(await storage.renameSavedFilterFolders(folderRenames, () => true), false);
  assert.equal(fixture.canonicalAttempts, attempts);
  await storage.filters.upsert(folderFilter);
  const finalFolder = 'Final/ClientA';
  const finalRenames = captureFilterFolderRenames(newFolder, finalFolder, [finalFolder, finalFolder + '/Sub']);
  assert.deepEqual(await Promise.all([
   storage.renameSavedFilterFolders(folderRenames, () => true),
   storage.renameSavedFilterFolders(finalRenames, () => true),
  ]), [true, true]);
  assert.equal(fixture.package().views.filters.itemsById[folderFilter.id].conditions[0].value, finalFolder);
 });
});

for (const failure of ['write', 'concurrent edit'] as const) test(`folder rename protects the saved filter on ${failure}`, async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  await storage.filters.upsert(folderFilter);
  const before = fixture.raw();
  let pendingEdit: Promise<void> | undefined;
  if (failure === 'write') fixture.writeFault = 'throw-before';
  else {
   const process = fixture.adapter.process;
   fixture.adapter.process = async (path, transform) => {
    if (path === fixture.canonicalPath && !pendingEdit) {
     pendingEdit = storage.filters.upsert({ ...folderFilter, name: 'Concurrent edit' });
    }
    return process(path, transform);
   };
  }
  await assert.rejects(storage.renameSavedFilterFolders(folderRenames, () => true));
  if (failure === 'write') assert.equal(fixture.raw(), before);
  else {
   await pendingEdit;
   assert.equal(fixture.package().views.filters.itemsById[folderFilter.id].name, 'Concurrent edit');
  }
  assert.equal(storage.filters.getById(folderFilter.id)?.conditions[0].value, oldFolder);
  assert.equal(fixture.package().views.filters.itemsById[folderFilter.id].conditions[0].value, oldFolder);
 });
});

test('an external settings change is not overwritten by a folder rename', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  await storage.filters.upsert(folderFilter);
  const external = fixture.package();
  external.settings.language = 'de';
  const bytes = JSON.stringify(external);
  fixture.seed(fixture.canonicalPath, bytes);
  const attempts = fixture.canonicalAttempts;
  await assert.rejects(storage.renameSavedFilterFolders(folderRenames, () => true));
  assert.equal(fixture.raw(), bytes);
  assert.equal(fixture.canonicalAttempts, attempts);
  assert.equal(storage.filters.getById(folderFilter.id)?.conditions[0].value, oldFolder);
 });
});

test('a malformed unrelated filter entry is preserved during folder rename', async () => {
 await withSettingsFixture({ initialRaw: initialRaw(), table: false }, async fixture => {
  const storage = fixture.createStorage(); await storage.initialize();
  await storage.filters.upsert(folderFilter);
  const data = fixture.package();
  data.views.filters.filterIds.push('malformed');
  Object.assign(data.views.filters.itemsById, { malformed: null });
  fixture.seed(fixture.canonicalPath, JSON.stringify(data));
  await storage.reloadCanonicalSettingsPackage();
  assert.equal(fixture.package().views.filters.itemsById.malformed, null);
  assert.equal(await storage.renameSavedFilterFolders(folderRenames, () => true), true);
  assert.equal(fixture.package().views.filters.itemsById.malformed, null);
  assert.equal(fixture.package().views.filters.itemsById[folderFilter.id].conditions[0].value, newFolder);
 });
});
