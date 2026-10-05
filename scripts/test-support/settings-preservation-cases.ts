import { DeveloperApiGrantControllerV1 } from '../../src/agent-runtime/developer-api/grant-controller';
import { createDeveloperApiGrantApprovalBinding, recordDeveloperApiGrantRequest } from '../../src/agent-runtime/developer-api/grants';
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
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
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

for (const stageFailure of ['prepare', 'commit'] as const) {
 add(`failed reload ${stageFailure} cannot re-arm old cached settings against a new disk source`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
   const external = fixture.package();
   external.settings.operonDocsFolder = 'External Settings';
   const raw = JSON.stringify(external, null, '\t');
   fixture.seed(fixture.canonicalPath, raw);
   await assert.rejects(store.reloadCanonicalDataPackage(DEFAULT_SETTINGS, {
    stage: async () => {
     if (stageFailure === 'prepare') throw new Error('Injected stage failure');
     return { commit: () => { throw new Error('Injected commit failure'); }, rollback: () => {} };
    },
   }));
   const attempts = fixture.canonicalAttempts;
   await assert.rejects(saveReleaseMarker(storage));
   assert.equal(fixture.canonicalAttempts, attempts);
   assertBytesEqual(fixture.raw(), raw);
  });
 });
}

add('a backup of external settings does not permit stale ordinary saves', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const external = fixture.package();
  external.settings.operonDocsFolder = 'New External Settings';
  const raw = JSON.stringify(external, null, '\t');
  fixture.seed(fixture.canonicalPath, raw);
  await storage.backupCanonicalSettingsPackage();
  await assert.rejects(saveReleaseMarker(storage));
  assertBytesEqual(fixture.raw(), raw);
 });
});

add('resume alone cannot permit writes after a failed initial read', async () => {
 await withSettingsFixture({}, async fixture => {
  fixture.readFault = 'undefined';
  const storage = fixture.createStorage();
  await storage.initialize();
  fixture.readFault = 'none';
  storage.resumeCanonicalSettingsWrites();
  await assert.rejects(saveReleaseMarker(storage));
  assertBytesEqual(fixture.raw(), fixture.initialRaw);
  assert.equal(fixture.canonicalAttempts, 0);
 });
});

add('even unchanged saves reject an external disk change', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const external = fixture.package();
  external.settings.operonDocsFolder = 'External Change';
  const raw = JSON.stringify(external, null, '\t');
  fixture.seed(fixture.canonicalPath, raw);
  const attempts = fixture.canonicalAttempts;
  await assert.rejects(store.updateDataPackage(current => current));
  assert.equal(fixture.canonicalAttempts, attempts);
  assertBytesEqual(fixture.raw(), raw);
 });
});

add('blocked startup and repeated saves issue one protection notification', async () => {
 await withSettingsFixture({}, async fixture => {
  fixture.readFault = 'undefined';
  let notices = 0;
  const storage = fixture.createStorage(() => { notices++; });
  await storage.initialize();
  await assert.rejects(saveReleaseMarker(storage));
  await assert.rejects(saveReleaseMarker(storage));
  assert.equal(notices, 1);
  assert.equal(fixture.canonicalAttempts, 0);
 });
});

add('fresh installation works through the native adapter rename path', async () => {
 await withSettingsFixture({ initialRaw: null, table: false }, async fixture => {
  Reflect.deleteProperty(fixture.adapter, 'writeExclusive');
  const storage = fixture.createStorage();
  await storage.initialize();
  assert.equal(fixture.package().schemaVersion, sourcePackage().schemaVersion);
  const raw = fixture.raw();
  await fixture.createStorage().initialize();
  assertBytesEqual(fixture.raw(), raw);
 });
});

add('a file arriving immediately before first publication is never replaced', async () => {
 await withSettingsFixture({ initialRaw: null, table: false }, async fixture => {
  Reflect.deleteProperty(fixture.adapter, 'writeExclusive');
  const rename = fixture.adapter.rename;
  const externalRaw = readSealedFixture('data-3.8.0.json');
  fixture.adapter.rename = async (from, to) => {
   if (to === fixture.canonicalPath) fixture.seed(to, externalRaw);
   return rename(from, to);
  };
  await outcome(() => fixture.createStorage().initialize());
  assertBytesEqual(fixture.raw(), externalRaw);
  assert.equal(fixture.canonicalAttempts, 0);
 });
});

add('an external candidate is not acknowledged as our rejected observed update', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const candidate = store.getDataPackage();
  candidate.settings.operonDocsFolder = 'External candidate';
  const raw = JSON.stringify(candidate, null, '\t');
  fixture.seed(fixture.canonicalPath, raw);
  const attempts = fixture.canonicalAttempts;
  const result = await store.replaceDataPackageObserved(candidate);
  assert.equal(result.status, 'commit-state-unknown');
  assert.equal(store.getDataPackage().settings.operonDocsFolder, 'Personal Docs');
  assert.equal(fixture.canonicalAttempts, attempts);
  assertBytesEqual(fixture.raw(), raw);
 });
});

add('equal external bytes at first-create conflict are not proof of our publication', async () => {
 await withSettingsFixture({ initialRaw: null, table: false }, async fixture => {
  Reflect.deleteProperty(fixture.adapter, 'writeExclusive');
  const rename = fixture.adapter.rename;
  fixture.adapter.rename = async (from, to) => {
   if (to === fixture.canonicalPath) fixture.seed(to, await fixture.adapter.read(from));
   return rename(from, to);
  };
  const storage = fixture.createStorage();
  await outcome(() => storage.initialize());
  assert.ok(storage.getCanonicalSettingsWriteSuspensionReason());
  assert.equal(fixture.canonicalAttempts, 0);
  assert.ok(fixture.raw());
 });
});

add('backup-failed reload cannot be resumed with stale cached settings', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const external = fixture.package();
  external.settings.operonDocsFolder = 'External invalid pipeline';
  external.taxonomy.pipelines.pipelines = [];
  const raw = JSON.stringify(external, null, '\t');
  fixture.seed(fixture.canonicalPath, raw);
  const write = fixture.adapter.write;
  fixture.adapter.write = async (path, contents) => {
   if (path.includes('.bak')) throw new Error('Injected backup failure');
   return write(path, contents);
  };
  const result = await store.reloadCanonicalDataPackage(DEFAULT_SETTINGS);
  assert.equal(result.diagnostics.pipelineTaxonomy.backupFailed, true);
  fixture.adapter.write = write;
  store.resumeWrites();
  await assert.rejects(saveReleaseMarker(storage));
  await store.backupCanonicalDataPackage();
  await assert.rejects(saveReleaseMarker(storage));
  assertBytesEqual(fixture.raw(), raw);
 });
});

for (const [name, invalid] of [
 ['null settings domain', { settings: null, preserve: 'unrecognized' }],
 ['array settings domain', { settings: [], preserve: 'unrecognized' }],
 ['empty settings envelope', { settings: {}, schemaVersion: 2 }],
 ['string schema version', { ...sourcePackage(), schemaVersion: '999' }],
 ['fractional schema version', { ...sourcePackage(), schemaVersion: 1.5 }],
 ['future settings version', { ...sourcePackage(), settings: { ...sourcePackage().settings, settingsVersion: 999 } }],
] as const) {
 add(`${name} is rejected before migration can replace the source`, async () => {
  const raw = JSON.stringify(invalid, null, '\t');
  await withSettingsFixture({ initialRaw: raw }, async fixture => {
   for (let boot = 0; boot < 2; boot++) {
    const storage = fixture.createStorage();
    await storage.initialize();
    await assert.rejects(saveReleaseMarker(storage));
   }
   assert.equal(fixture.canonicalAttempts, 0);
   assertBytesEqual(fixture.raw(), raw);
  });
 });
}

add('unreadable post-write verification suspends saves without promoting committed memory', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const previous = store.getDataPackage();
  const process = fixture.adapter.process;
  fixture.adapter.process = async (path, update) => {
   const result = await process(path, update);
   if (path === fixture.canonicalPath) fixture.readFault = 'unreadable';
   return result;
  };
  await assert.rejects(saveReleaseMarker(storage));
  assert.deepEqual(store.getDataPackage(), previous);
  const attempts = fixture.canonicalAttempts;
  fixture.readFault = 'none';
  await assert.rejects(saveReleaseMarker(storage));
  assert.equal(fixture.canonicalAttempts, attempts);
 });
});

// Exercise the grant entrypoints restored by issue #233 against the real settings store.
const settingsConsumer = { id: 'settings-preservation-consumer', name: 'Settings preservation', version: '1.0.0', instanceEpoch: 'fixture-instance' };
const grantController = (storage: OperonStorage): DeveloperApiGrantControllerV1 => new DeveloperApiGrantControllerV1({
 store: storage.getDeveloperApiGrantDataStore(),
 verifier: { verify: () => settingsConsumer, isCurrent: () => true },
});
const personalizedGrantSource = () => {
 const data = sourcePackage();
 data.integrations.developerApi = recordDeveloperApiGrantRequest(
  data.integrations.developerApi, settingsConsumer, ['tasks.query', 'tasks.read'], '2026-09-20T10:00:00.000Z',
 );
 return data;
};
for (const action of ['approve', 'deny', 'revoke'] as const) {
 const source = personalizedGrantSource();
 const binding = createDeveloperApiGrantApprovalBinding(source.integrations.developerApi.consumersById[settingsConsumer.id]!, settingsConsumer);
 assert.ok(binding);
 const act = async (controller: DeveloperApiGrantControllerV1): Promise<unknown> => {
  if (action === 'approve') return controller.approveBound({ binding, capabilities: ['tasks.read'], consumer: settingsConsumer });
  if (action === 'deny') return controller.denyPending(settingsConsumer.id);
  return controller.revoke(settingsConsumer.id);
 };
 add(`Developer API ${action} preserves all other package domains across restart`, async () => {
  await withSettingsFixture({ initialRaw: JSON.stringify(source) }, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const before = clone(fixture.package());
   const controller = grantController(storage);
   const attempts = fixture.canonicalAttempts;
   controller.list();
   controller.list();
   assert.equal(fixture.canonicalAttempts, attempts, 'Listing grants must not write settings');
   await act(controller);
   const after = clone(fixture.package());
   const grants = clone(after.integrations.developerApi);
   assert.notDeepEqual(grants, before.integrations.developerApi);
   after.integrations.developerApi = before.integrations.developerApi;
   assert.deepEqual(after, before, 'Grant action changed unrelated package domains');
   const expected = clone(source);
   expected.integrations.developerApi = grants;
   assertPersonalSettingsPreserved(fixture.package(), expected);
   const second = fixture.createStorage();
   await second.initialize();
   assert.deepEqual(fixture.package().integrations.developerApi, grants);
   assertPersonalSettingsPreserved(fixture.package(), expected);
  });
 });
 for (const readFault of ['null', 'undefined', 'throw', 'unreadable'] as const) {
  add(`Developer API ${action} cannot overwrite personalized settings after ${readFault} load`, async () => {
   await withSettingsFixture({ initialRaw: JSON.stringify(source) }, async fixture => {
    fixture.readFault = readFault;
    const storage = fixture.createStorage();
    await outcome(() => storage.initialize());
    const controller = grantController(storage);
    assert.deepEqual(controller.list(), []);
    assert.equal(await outcome(() => act(controller)), 'rejected');
    assertBytesEqual(fixture.raw(), fixture.initialRaw);
    assert.equal(fixture.canonicalAttempts, 0);
   });
  });
 }
 add(`Developer API ${action} refuses a stale disk preimage without overwriting external settings`, async () => {
  await withSettingsFixture({ initialRaw: JSON.stringify(source) }, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const controller = grantController(storage);
   controller.list();
   const external = fixture.package();
   external.settings.operonDocsFolder = 'External personal docs';
   const raw = JSON.stringify(external);
   fixture.seed(fixture.canonicalPath, raw);
   const attempts = fixture.canonicalAttempts;
   assert.equal(await outcome(() => act(controller)), 'rejected');
   assertBytesEqual(fixture.raw(), raw);
   assert.equal(fixture.canonicalAttempts, attempts);
  });
 });
 add(`Developer API ${action} write failure preserves the canonical settings preimage`, async () => {
  await withSettingsFixture({ initialRaw: JSON.stringify(source) }, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const controller = grantController(storage);
   const before = fixture.raw();
   fixture.writeFault = 'throw-before';
   assert.equal(await outcome(() => act(controller)), 'rejected');
   assertBytesEqual(fixture.raw(), before);
   assertPersonalSettingsPreserved(fixture.package(), source);
  });
 });
}

for (const trigger of ['external-value', 'formatting-only', 'transient-read', 'normalization'] as const) {
 add(`${trigger} before an unchanged save recovers only after adopting verified settings`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
   const external = fixture.package();
   if (trigger === 'external-value' || trigger === 'normalization') external.settings.operonDocsFolder = 'Synced Docs';
   if (trigger === 'normalization') Reflect.deleteProperty(external.ui, 'workspaceTweaks');
   const raw = JSON.stringify(external, null, trigger === 'formatting-only' ? 2 : '\t') + '\n';
   fixture.seed(fixture.canonicalPath, raw);
   if (trigger === 'transient-read') fixture.readFault = 'unreadable';
   const attempts = fixture.canonicalAttempts;
   await assert.rejects(store.updateDataPackage(current => current));
   fixture.readFault = 'none';
   assert.equal(store.canPersist(), false);
   assert.equal(fixture.canonicalAttempts, attempts, 'Preflight failure must not write');
   await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Rejected UI edit' }));
   await storage.reloadCanonicalSettingsPackage();
   assert.equal(store.canPersist(), true);
   assert.equal(storage.getSettings().operonDocsFolder, external.settings.operonDocsFolder);
   if (trigger === 'normalization') {
    assert.equal(fixture.canonicalAttempts, attempts + 1, 'Only existing normalization may write during reload');
    assert.ok(fixture.operations.some(operation => operation.kind === 'write' && operation.path.includes('.invalid-')));
   } else {
    assertBytesEqual(fixture.raw(), raw, 'Pure adoption must not rewrite the file');
    assert.equal(fixture.canonicalAttempts, attempts);
   }
   await storage.updateSettings({ releaseNotesLastShownVersion: 'after-recovery' });
   assert.equal(fixture.package().settings.operonDocsFolder, external.settings.operonDocsFolder, 'Rejected UI edit must never replay');
   assert.equal(fixture.package().settings.releaseNotesLastShownVersion, 'after-recovery');
   const committed = fixture.raw();
   await storage.reloadCanonicalSettingsPackage();
   assertBytesEqual(fixture.raw(), committed, 'Repeated reload must be idempotent');
  });
 });
}

for (const trigger of ['external-value', 'formatting-only', 'normalization', 'process-rejected', 'transient-read'] as const) {
 add(`${trigger} before a changed save recovers after verified reload without replay`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
   const external = fixture.package();
   if (trigger === 'external-value' || trigger === 'normalization') external.settings.operonDocsFolder = 'Synced Docs';
   if (trigger === 'normalization') Reflect.deleteProperty(external.ui, 'workspaceTweaks');
   const raw = trigger === 'process-rejected' || trigger === 'transient-read'
    ? fixture.raw()!
    : JSON.stringify(external, null, trigger === 'formatting-only' ? 2 : '\t');
   fixture.seed(fixture.canonicalPath, raw);
   const process = fixture.adapter.process;
   if (trigger === 'process-rejected') fixture.adapter.process = async () => { throw new Error('Rejected before transform'); };
   if (trigger === 'transient-read') fixture.readFault = 'unreadable';
   const attempts = fixture.canonicalAttempts;
   await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Rejected local edit' }));
   fixture.adapter.process = process;
   fixture.readFault = 'none';
   assert.equal(store.canPersist(), false);
   assert.equal(fixture.canonicalAttempts, attempts, 'No write started');
   assertBytesEqual(fixture.raw(), raw);
   await assert.rejects(storage.updateSettings({ releaseNotesLastShownVersion: 'blocked-before-reload' }));
   fixture.readFault = 'unreadable';
   await storage.reloadCanonicalSettingsPackage();
   assert.equal(store.canPersist(), false, 'An unreadable reload must not unlock writes');
   fixture.readFault = 'none';
   await storage.reloadCanonicalSettingsPackage();
   assert.equal(store.canPersist(), true);
   assert.equal(storage.getSettings().operonDocsFolder, external.settings.operonDocsFolder);
   assert.equal(fixture.canonicalAttempts, attempts + (trigger === 'normalization' ? 1 : 0));
   if (trigger !== 'normalization') assertBytesEqual(fixture.raw(), raw);
   const committed = fixture.raw();
   await storage.reloadCanonicalSettingsPackage();
   assertBytesEqual(fixture.raw(), committed, 'Second reload must be idempotent');
   await storage.updateSettings({ releaseNotesLastShownVersion: 'explicit-new-save' });
   assert.equal(fixture.package().settings.operonDocsFolder, external.settings.operonDocsFolder, 'The rejected edit must never replay');
   assert.equal(fixture.package().settings.releaseNotesLastShownVersion, 'explicit-new-save');
  });
 });
}

for (const failure of ['prepare', 'commit', 'rollback'] as const) {
 add(`recoverable reload ${failure} failure leaves a hard write suspension`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
   const raw = fixture.raw()! + '\n';
   fixture.seed(fixture.canonicalPath, raw);
   await assert.rejects(store.updateDataPackage(current => current));
   const attempts = fixture.canonicalAttempts;
   const previous = store.getDataPackage();
   await assert.rejects(store.reloadCanonicalDataPackage(DEFAULT_SETTINGS, {
    stage: async () => {
     assert.equal(store.canPersist(), false, 'Staging must not unlock ordinary writes');
     if (failure === 'prepare') throw new Error('Injected preparation failure');
     return {
      commit: () => {
       assert.equal(store.canPersist(), false, 'Runtime commit must precede unlocking');
       throw new Error('Injected commit failure');
      },
      rollback: () => { if (failure === 'rollback') throw new Error('Injected rollback failure'); },
     };
    },
   }));
   assert.deepEqual(store.getDataPackage(), previous);
   const reason = store.getWriteSuspensionReason();
   fixture.readFault = 'unreadable';
   await storage.reloadCanonicalSettingsPackage();
   fixture.readFault = 'none';
   await storage.reloadCanonicalSettingsPackage();
   assert.equal(store.canPersist(), false);
   assert.equal(store.getWriteSuspensionReason(), reason, 'Read failures must not downgrade the hard suspension');
   await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Must not save' }));
   assert.equal(fixture.canonicalAttempts, attempts);
   assertBytesEqual(fixture.raw(), raw);
  });
 });
}

for (const sourceFault of ['change', 'unreadable'] as const) {
 add(`source ${sourceFault} during reload staging prevents adoption and permits a later verified reload`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
   const previous = store.getDataPackage();
   const external = fixture.package();
   external.settings.operonDocsFolder = 'First Sync';
   fixture.seed(fixture.canonicalPath, JSON.stringify(external));
   await assert.rejects(store.updateDataPackage(current => current));
   const attempts = fixture.canonicalAttempts;
   let committed = false, rolledBack = false;
   await assert.rejects(store.reloadCanonicalDataPackage(DEFAULT_SETTINGS, {
    stage: async () => {
     if (sourceFault === 'change') {
      external.settings.operonDocsFolder = 'Second Sync';
      fixture.seed(fixture.canonicalPath, JSON.stringify(external));
     } else fixture.readFault = 'unreadable';
     return { commit: () => { committed = true; }, rollback: () => { rolledBack = true; } };
    },
   }), /changed during reload/);
   fixture.readFault = 'none';
   assert.equal(committed, false);
   assert.equal(rolledBack, true);
   assert.equal(store.canPersist(), false);
   assert.deepEqual(store.getDataPackage(), previous);
   assert.equal(fixture.canonicalAttempts, attempts);
   await storage.reloadCanonicalSettingsPackage();
   assert.equal(store.canPersist(), true);
   assert.equal(storage.getSettings().operonDocsFolder, external.settings.operonDocsFolder);
  });
 });
}

add('uncertain writes stay suspended after a failed read and a later valid reload', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const process = fixture.adapter.process;
  fixture.adapter.process = async (path, update) => {
   const result = await process(path, update);
   if (path === fixture.canonicalPath) fixture.readFault = 'unreadable';
   return result;
  };
  await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Uncertain commit' }));
  const reason = store.getWriteSuspensionReason();
  const attempts = fixture.canonicalAttempts;
  const raw = fixture.raw();
  await storage.reloadCanonicalSettingsPackage();
  fixture.readFault = 'none';
  fixture.adapter.process = process;
  await storage.reloadCanonicalSettingsPackage();
  assert.equal(store.canPersist(), false);
  assert.equal(store.getWriteSuspensionReason(), reason);
  await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Must stay blocked' }));
  assert.equal(fixture.canonicalAttempts, attempts);
  assertBytesEqual(fixture.raw(), raw);
 });
});

add('a later queued user save uses the adopted external settings', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const external = fixture.package();
  external.settings.operonDocsFolder = 'Queued Sync';
  fixture.seed(fixture.canonicalPath, JSON.stringify(external));
  await assert.rejects(store.updateDataPackage(current => current));
  await Promise.all([
   storage.reloadCanonicalSettingsPackage(),
   storage.updateSettings({ releaseNotesLastShownVersion: 'queued-user-save' }),
  ]);
  assert.equal(fixture.package().settings.operonDocsFolder, 'Queued Sync');
  assert.equal(fixture.package().settings.releaseNotesLastShownVersion, 'queued-user-save');
 });
});

for (const failure of ['backup', 'uncertain-write'] as const) {
 add(`recovery normalization ${failure} failure cannot be unlocked by later valid reads`, async () => {
  await withSettingsFixture({}, async fixture => {
   const storage = fixture.createStorage();
   await storage.initialize();
   const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
   const external = fixture.package();
   Reflect.deleteProperty(external.ui, 'workspaceTweaks');
   const raw = JSON.stringify(external);
   fixture.seed(fixture.canonicalPath, raw);
   await assert.rejects(store.updateDataPackage(current => current));
   const write = fixture.adapter.write;
   if (failure === 'backup') fixture.adapter.write = async (path, contents) => {
    if (path.includes('.bak')) throw new Error('Injected recovery backup failure');
    return write(path, contents);
   };
   else fixture.writeFault = 'partial-throw';
   await assert.rejects(storage.reloadCanonicalSettingsPackage());
   fixture.adapter.write = write;
   fixture.seed(fixture.canonicalPath, raw);
   const attempts = fixture.canonicalAttempts;
   const reason = store.getWriteSuspensionReason();
   fixture.readFault = 'unreadable';
   await storage.reloadCanonicalSettingsPackage();
   fixture.readFault = 'none';
   await assert.rejects(storage.reloadCanonicalSettingsPackage(), /writes are suspended/);
   assert.equal(store.canPersist(), false);
   assert.equal(store.getWriteSuspensionReason(), reason);
   await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Must not overwrite' }));
   assert.equal(fixture.canonicalAttempts, attempts);
   assertBytesEqual(fixture.raw(), raw);
  });
 });
}

add('reload discards directly mutated settings left dirty by a rejected save', async () => {
 await withSettingsFixture({}, async fixture => {
  const storage = fixture.createStorage();
  await storage.initialize();
  const store = storage.getDeveloperApiGrantDataStore() as OperonDataPackageStore;
  const external = fixture.package();
  external.settings.operonDocsFolder = 'Latest synced folder';
  fixture.seed(fixture.canonicalPath, JSON.stringify(external));
  await assert.rejects(store.updateDataPackage(current => current));
  storage.getSettings().operonDocsFolder = 'Dirty rejected edit';
  await assert.rejects(storage.saveSettings());
  await storage.reloadCanonicalSettingsPackage();
  assert.equal(storage.getSettings().operonDocsFolder, 'Latest synced folder');
  storage.getSettings().releaseNotesLastShownVersion = 'later-direct-save';
  await storage.saveSettings();
  assert.equal(fixture.package().settings.operonDocsFolder, 'Latest synced folder');
  assert.equal(fixture.package().settings.releaseNotesLastShownVersion, 'later-direct-save');
 });
});
