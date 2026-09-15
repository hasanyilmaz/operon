import assert from 'node:assert/strict';
import { OperonDataPackageStore } from '../../src/storage/operon-data-package-store';
import { buildOperonStoragePaths } from '../../src/storage/operon-storage-paths';
import { DEFAULT_SETTINGS } from '../../src/types/settings';
import {
 assertBytesEqual, assertPersonalSettingsPreserved, clone, readSealedFixture, sourcePackage,
 withSettingsFixture, type ReadFault, type WriteFault,
} from './settings-preservation-harness';
import type { OperonStorage } from '../../src/storage/operon-storage';

export interface SettingsPreservationCase {
 name: string;
 run(): Promise<void>;
}

/** These are safety assertions, never assertions that the known data loss is desirable. */
export const settingsPreservationCases: SettingsPreservationCase[] = [];
const add = (name: string, run: () => Promise<void>): void => {
 settingsPreservationCases.push({ name, run });
};
const outcome = async (operation: () => Promise<unknown>): Promise<'fulfilled' | 'rejected'> => {
 try { await operation(); return 'fulfilled'; } catch { return 'rejected'; }
};
const saveReleaseMarker = async (storage: OperonStorage): Promise<void> => {
 storage.getSettings().releaseNotesLastShownVersion = '3.9.1';
 await storage.saveSettings();
};

for (const version of ['3.8.0', '3.9.0'] as const) {
 add(`${version} sealed personalized settings survive startup save and second startup`, async () => {
  await withSettingsFixture({ version }, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   assertPersonalSettingsPreserved(fixture.package(), fixture.source);
   await saveReleaseMarker(storage);
   assertPersonalSettingsPreserved(fixture.package(), fixture.source);
   const committed = fixture.raw();
   const second = fixture.createStorage();
   await second.initialize();
   assertPersonalSettingsPreserved(fixture.package(), fixture.source);
   assertBytesEqual(fixture.raw(), committed, 'Second startup must be idempotent');
  });
 });
}

add('sealed fixtures retain personalized identities and differ only by supported 3.9 additions', async () => {
 const before = sourcePackage('3.8.0');
 const after = sourcePackage('3.9.0');
 readSealedFixture('Personal.table');
 assert.ok(before.views.filters.filterIds.includes('fs_personal_upgrade'));
 assert.deepEqual(before.ui.presetFavorites?.table, ['tp_personal_upgrade']);
 assert.ok(JSON.stringify(before.taxonomy.keyMappings).includes('reviewOwner'));
 assert.equal('assigneeImageProperty' in before.ui.taskUiPreferences, false);
 assert.equal('inheritPropertiesOnParentLink' in before.ui.taskCreationProfile, false);
 assert.equal(after.ui.taskUiPreferences.assigneeImageProperty, 'avatar');
 assert.equal(after.ui.taskCreationProfile.inheritPropertiesOnParentLink, true);
 assertPersonalSettingsPreserved(after, before);
});

for (const readFault of ['null', 'undefined', 'array', 'scalar'] as const satisfies readonly ReadFault[]) {
 add(`${readFault} from loadData cannot replace existing settings at startup or automatic save`, async () => {
  await withSettingsFixture({}, async fixture => {
   fixture.readFault = readFault;
   const storage = fixture.createStorage();
   await outcome(() => storage.initialize());
   assertPersonalSettingsPreserved(fixture.package(), fixture.source);
   await outcome(() => saveReleaseMarker(storage));
   assertPersonalSettingsPreserved(fixture.package(), fixture.source);
  });
 });
}

for (const readFault of ['throw', 'unreadable'] as const) {
 add(`${readFault} read keeps the exact canonical bytes and blocks automatic saves`, async () => {
  await withSettingsFixture({}, async fixture => {
   fixture.readFault = readFault;
   const storage = fixture.createStorage();
   await outcome(() => storage.initialize());
   assertBytesEqual(fixture.raw(), fixture.initialRaw, 'Startup wrote over unreadable settings');
   assert.equal(await outcome(() => saveReleaseMarker(storage)), 'rejected');
   assertBytesEqual(fixture.raw(), fixture.initialRaw);
   assert.equal(fixture.canonicalAttempts, 0, 'No canonical write may be attempted after an unreadable source');
  });
 });
}

for (const [label, raw] of [
 ['malformed JSON', '{"views":'],
 ['JSON null', 'null\n'],
 ['JSON array', '[]\n'],
 ['empty object', '{}\n'],
 ['unsupported future package', JSON.stringify({ ...sourcePackage(), schemaVersion: 999 })],
] as const) {
 add(`${label} is preserved across two startups without any canonical write`, async () => {
  await withSettingsFixture({ initialRaw: raw }, async fixture => {
   for (let boot = 0; boot < 2; boot++) {
    const storage = fixture.createStorage();
    await outcome(() => storage.initialize());
    assertBytesEqual(fixture.raw(), raw, `Boot ${boot + 1} overwrote the invalid source`);
    assert.equal(await outcome(() => saveReleaseMarker(storage)), 'rejected');
    assertBytesEqual(fixture.raw(), raw);
   }
   assert.equal(fixture.canonicalAttempts, 0);
  });
 });
}

add('a genuine empty first install can create settings and restart without a second semantic write', async () => {
 await withSettingsFixture({ initialRaw: null, table: false }, async fixture => {
  const first = fixture.createStorage();
  await first.initialize();
  assert.equal(fixture.package().schemaVersion, sourcePackage().schemaVersion);
  const committed = fixture.raw();
  const second = fixture.createStorage();
  await second.initialize();
  assertBytesEqual(fixture.raw(), committed);
 });
});

add('missing canonical file with prior index evidence is not a new installation', async () => {
 await withSettingsFixture({ initialRaw: null, table: false }, async fixture => {
  fixture.addSentinel(`${fixture.configDir}/plugins/operon/runtime/index-v8/manifest.json`, '{"existingInstallation":true}\n');
  const storage = fixture.createStorage();
  await outcome(() => storage.initialize());
  assertBytesEqual(fixture.raw(), null, 'Existing installation was replaced with new-user defaults');
  assert.equal(await outcome(() => saveReleaseMarker(storage)), 'rejected');
  assert.equal(fixture.canonicalAttempts, 0);
 });
});

add('custom Obsidian config directory preserves the same settings and write boundaries', async () => {
 await withSettingsFixture({ configDir: '.custom-config' }, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  await saveReleaseMarker(storage);
  assertPersonalSettingsPreserved(fixture.package(), fixture.source);
 });
});

add('normal saves reject a disk change made after successful initialization', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const external = fixture.package();
  external.settings.language = 'de';
  external.settings.operonDocsFolder = 'External Docs';
  const externalRaw = JSON.stringify(external, null, '\t') + '\n';
  fixture.seed(fixture.canonicalPath, externalRaw);
  const attempts = fixture.canonicalAttempts;
  assert.equal(await outcome(() => saveReleaseMarker(storage)), 'rejected', 'Stale save was acknowledged');
  assertBytesEqual(fixture.raw(), externalRaw);
  assert.equal(fixture.canonicalAttempts, attempts, 'Conflict must be discovered before writing');
  await outcome(() => saveReleaseMarker(storage));
  assertBytesEqual(fixture.raw(), externalRaw, 'Repeated stale save must not overwrite external settings');
 });
});

add('two loaded storage instances cannot silently overwrite one another', async () => {
 await withSettingsFixture({}, async fixture => {
  const older = fixture.createStorage();
  await older.initialize();
  const newer = fixture.createStorage();
  await newer.initialize();
  newer.getSettings().operonDocsFolder = 'Newer instance docs';
  await newer.saveSettings();
  const newerRaw = fixture.raw();
  assert.equal(await outcome(() => saveReleaseMarker(older)), 'rejected');
  assertBytesEqual(fixture.raw(), newerRaw);
 });
});

add('a data.json arriving after an absent initial read cannot be replaced by defaults', async () => {
 await withSettingsFixture({ initialRaw: null, table: false }, async fixture => {
  const store = new OperonDataPackageStore(fixture.adapter, buildOperonStoragePaths(fixture.configDir), fixture.pluginData);
  await store.initialize(DEFAULT_SETTINGS, 'en');
  const lateRaw = readSealedFixture('data-3.8.0.json');
  fixture.seed(fixture.canonicalPath, lateRaw);
  const result = await outcome(() => store.updateDataPackage(current => ({
   ...current, settings: { ...current.settings, releaseNotesLastShownVersion: '3.9.1' },
  })));
  assert.equal(result, 'rejected');
  assertBytesEqual(fixture.raw(), lateRaw);
  assert.equal(fixture.canonicalAttempts, 0);
 });
});

for (const fault of ['throw-before', 'silent-before', 'partial-throw', 'partial-success', 'commit-throw'] as const satisfies readonly WriteFault[]) {
 add(`${fault} save is classified from the disk before publishing committed state`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore();
   const before = clone(store.getDataPackage());
   const previousRaw = fixture.raw();
   const attempts = fixture.canonicalAttempts;
   fixture.writeFault = fault;
   const result = await outcome(() => store.updateDataPackage(current => ({
    ...current, settings: { ...current.settings, releaseNotesLastShownVersion: '3.9.1' },
   })));
   assert.equal(fixture.canonicalAttempts, attempts + 1, 'Never replay an uncertain write');
   if (fault === 'commit-throw') {
    assert.equal(result, 'fulfilled', 'A verified applied candidate must be recognized despite acknowledgement failure');
    assert.equal(store.getDataPackage().settings.releaseNotesLastShownVersion, '3.9.1');
    assertPersonalSettingsPreserved(fixture.package(), fixture.source);
   } else {
    assert.equal(result, 'rejected', 'Unverified write was reported as successful');
    assert.deepEqual(store.getDataPackage(), before, 'Unverified candidate became the committed memory snapshot');
    if (fault === 'throw-before' || fault === 'silent-before') {
     assertBytesEqual(fixture.raw(), previousRaw);
    } else {
     assert.equal(store.canPersist(), false, 'Indeterminate disk state must suspend subsequent writes');
     const damagedRaw = fixture.raw();
     assert.equal(await outcome(() => store.updateDataPackage(current => ({
      ...current, settings: { ...current.settings, releaseNotesLastShownVersion: 'must-not-write' },
     }))), 'rejected');
     assertBytesEqual(fixture.raw(), damagedRaw, 'Do not overwrite or blindly restore an indeterminate target');
     assert.equal(fixture.canonicalAttempts, attempts + 1);
    }
   }
  });
 });
}
