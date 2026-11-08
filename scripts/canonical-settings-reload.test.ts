import assert from 'node:assert/strict';
import test from 'node:test';
import { withSettingsFixture } from './test-support/settings-preservation-harness';
import { buildOperonDataPackageFromSettings, type OperonDataPackageV1 } from '../src/storage/operon-data-package';
import { DEFAULT_SETTINGS } from '../src/types/settings';
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
