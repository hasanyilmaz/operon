import { capturePropertyIconEdit, getSourcePropertyIcon } from '../src/core/property-icons';
import { buildEffectiveTableTaskFieldCatalog } from '../src/ui/table/table-field-catalog';
import { encodeTableFilePropertyColumnKey } from '../src/ui/table/table-file-property';
import { changeTaskEditorLayout, resolveTaskEditorLayout, type TaskEditorLayoutChange } from '../src/core/task-editor-layout';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
import { buildCustomFieldUsageSummaries } from '../src/core/managed-task-fields';
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTaskEditorSections, TASK_EDITOR_COMMAND_IDS, TASK_EDITOR_SECTION_IDS, type TaskEditorPropertyRef } from '../src/types/task-editor-sections';
import { DEFAULT_SETTINGS, migrateSettings, type KeyMapping } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';
import { SETTINGS_BACKUP_COMPATIBILITY_BY_KEY } from '../src/core/settings-backup-compatibility';

test('missing and malformed layouts preserve all default section identities', () => {
 for (const raw of [undefined, null, false, {}, 'notes']) {
  assert.deepEqual(normalizeTaskEditorSections(raw).map(item => item.id), [...TASK_EDITOR_SECTION_IDS]);
 }
 const input = [{ id: 'sessions', name: ' Work\n logs ' }, { id: 'sessions', name: 'Duplicate' }, { id: 'unknown', name: 'Wrong' }, null];
 const result = normalizeTaskEditorSections(input);
 assert.equal(result.length, TASK_EDITOR_SECTION_IDS.length);
 assert.deepEqual(result[0], { id: 'sessions', name: 'Work  logs' });
 assert.equal(result[1].id, 'description');
 assert.deepEqual(normalizeTaskEditorSections(result), result);
 assert.equal(input[0]?.name, ' Work\n logs ');
});

test('blank names fall back and long names are bounded without changing identity', () => {
 assert.equal(normalizeTaskEditorSections([{ id: 'notes', name: '   ' }])[0].name, '');
 assert.equal(normalizeTaskEditorSections([{ id: 'notes', name: 'a'.repeat(200) }])[0].name.length, 80);
});

test('section order and names survive canonical package save and reload', () => {
 const taskEditorSections = normalizeTaskEditorSections([{ id: 'sessions', name: 'Work log' }, { id: 'description', name: 'Summary' }]);
 const settings = migrateSettings({ ...DEFAULT_SETTINGS, taskEditorSections });
 const stored = buildOperonDataPackageFromSettings(settings);
 const restored = composeOperonSettingsFromDataPackage(stored, DEFAULT_SETTINGS);
 assert.deepEqual(restored.taskEditorSections, taskEditorSections);
 assert.deepEqual(restored.taskEditorMobileCoreTools, DEFAULT_SETTINGS.taskEditorMobileCoreTools);
 assert.deepEqual(restored.taskEditorWorkflowPickers, DEFAULT_SETTINGS.taskEditorWorkflowPickers);
 assert.deepEqual(buildOperonDataPackageFromSettings(restored).ui.taskUiPreferences, stored.ui.taskUiPreferences);
});

test('sections are discoverable by Settings Search and belong to backup preferences', () => {
 assert.equal(OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.key === 'taskEditorSections')?.tabId, 'interfaceTaskEditor');
 assert.ok(SETTINGS_BACKUP_COMPATIBILITY_BY_KEY.taskEditorSections);
});

test('property visibility search is owned by Mobile Task Editor', () => {
 assert.equal(OPERON_SETTINGS_SEARCH_REGISTRY.find(entry => entry.id === 'ui.taskEditorWorkflowPickers')?.tabId, 'mobileTaskEditor');
});

test('custom usage includes desktop even when both mobile surfaces hide the property', () => {
 const summaries = buildCustomFieldUsageSummaries({
  keyMappings: [{ canonicalKey: 'customExample', visiblePropertyName: 'Example', type: 'text', isSystem: false, showInEditor: true, sync: 'no', enabled: true }],
  filterSets: [], kanbanPresets: [], tasks: null,
  surfaces: { taskEditorWorkflowPickers: [{ key: 'customExample', visible: false }], taskEditorMobileCoreTools: [{ key: 'customExample', visible: false }] },
 });
 assert.ok(summaries[0].activeSurfaceKeys.includes('editor'));
});


test('retired Custom section is dropped while Additional order and name are preserved', () => {
 const rows = normalizeTaskEditorSections([{id:'custom',name:'Old custom'}, {id:'sessions',name:'Log'}, {id:'additional',name:'Extras'}]);
 assert.equal(rows.some(row => String(row.id) === 'custom'),false);
 assert.deepEqual(rows.slice(0,2),[{id:'sessions',name:'Log'},{id:'additional',name:'Extras'}]);
 assert.equal(rows.length,10);
});


test('section visibility defaults on, preserves opt-out and never hides Description', () => {
 const rows = normalizeTaskEditorSections([{id:'description',name:'Task',enabled:false},{id:'notes',name:'Memo',enabled:false},{id:'stats',enabled:'false'}]);
 assert.equal(rows.find(row=>row.id==='description')?.enabled,undefined);
 assert.equal(rows.find(row=>row.id==='notes')?.enabled,false);
 assert.ok(rows.filter(row=>row.id!=='notes').every(row=>row.enabled!==false));
 assert.deepEqual(normalizeTaskEditorSections(rows),rows);
});

test('section visibility survives canonical save and reload together with names and order', () => {
 const settings = {...DEFAULT_SETTINGS,taskEditorSections:normalizeTaskEditorSections([{id:'notes',name:'Memo',enabled:false}])};
 const restored = composeOperonSettingsFromDataPackage(buildOperonDataPackageFromSettings(settings), DEFAULT_SETTINGS);
 assert.deepEqual(restored.taskEditorSections,settings.taskEditorSections);
});

const mapped = (key: string): TaskEditorPropertyRef => ({ kind: 'mapped', key });
const vault = (name: string): TaskEditorPropertyRef => ({ kind: 'vault', name });
const mappingsWithUp = DEFAULT_SETTINGS.keyMappings.map(mapping => mapping.canonicalKey === 'contexts'
 ? { ...mapping, visiblePropertyName: 'Up' } : mapping);

test('explicit property lists override defaults across named groups and Additional', () => {
 let sections = normalizeTaskEditorSections(undefined);
 const change = (action: TaskEditorLayoutChange) => { sections = normalizeTaskEditorSections(changeTaskEditorLayout(sections, mappingsWithUp, action)); };
 const view = () => resolveTaskEditorLayout(sections, mappingsWithUp);
 assert.deepEqual(view().commandOrder, TASK_EDITOR_COMMAND_IDS);
 assert.deepEqual(view().fields.get('connections')?.slice(0,3), [mapped('contexts'), mapped('tags'), mapped('links')]);
 change({ type: 'add', id: 'custom:research', name: 'Research' });
 change({ type: 'assign', section: 'custom:research', field: vault('Up') });
 change({ type: 'assign', section: 'custom:research', field: vault('Reading Count') });
 change({ type: 'move-field', section: 'custom:research', field: vault('reading count'), delta: -1 });
 assert.deepEqual(view().fields.get('custom:research'), [vault('Reading Count'), mapped('contexts')]);
 assert.equal(view().fields.get('connections')?.some(field => view().identify(field) === 'mapped:contexts'), false);
 assert.equal(resolveTaskEditorLayout(sections, mappingsWithUp.map(mapping => mapping.canonicalKey === 'contexts'
  ? { ...mapping, visiblePropertyName: 'Parent reference' } : mapping)).position(mapped('contexts')).section, 'custom:research');
 change({ type: 'assign', section: 'additional', field: mapped('contexts') });
 assert.deepEqual(view().position(mapped('contexts')), { section: 'additional', rank: 0 });
 change({ type: 'assign', field: mapped('contexts') });
 assert.equal(view().assignment(mapped('contexts')), undefined);
 assert.equal(view().position(mapped('contexts')).section, 'additional');
 change({ type: 'assign', section: 'planning', field: vault('reading count') });
 assert.deepEqual(view().fields.get('custom:research'), []);
 assert.equal(view().position(vault('READING COUNT')).section, 'planning');
 change({ type: 'rename', id: 'custom:research', name: 'Briefing' });
 assert.equal(view().sections.find(section => section.id === 'custom:research')?.name, 'Briefing');
});

test('section deletion, visibility, and command ordering survive normalization', () => {
 let sections = normalizeTaskEditorSections(undefined);
 const change = (action: TaskEditorLayoutChange) => { sections = normalizeTaskEditorSections(changeTaskEditorLayout(sections, mappingsWithUp, action)); };
 change({ type: 'visibility', id: 'connections', enabled: false });
 assert.equal(resolveTaskEditorLayout(sections, mappingsWithUp).position(mapped('contexts')).section, 'connections');
 const protectedIds = ['description','notes','stats','commands','additional','sessions'] as const;
 for (const id of protectedIds) change({ type: 'remove-section', id });
 change({ type: 'visibility', id: 'description', enabled: false });
 change({ type: 'remove-section', id: 'connections' });
 change({ type: 'move-section', id: 'additional', delta: -1 });
 change({ type: 'move-command', id: 'remove', delta: -1 });
 const restored = composeOperonSettingsFromDataPackage(
  buildOperonDataPackageFromSettings({ ...DEFAULT_SETTINGS, taskEditorSections: sections }), DEFAULT_SETTINGS);
 const layout = resolveTaskEditorLayout(restored.taskEditorSections, mappingsWithUp);
 assert.deepEqual(restored.taskEditorSections, sections);
 assert.deepEqual(sections.find(section => section.id === 'connections'), { id: 'connections', name: '', removed: true });
 assert.ok(protectedIds.every(id => layout.sections.some(section => section.id === id)));
 assert.ok(layout.sections.findIndex(section => section.id === 'additional') < layout.sections.findIndex(section => section.id === 'activity'));
 assert.equal(layout.sections.find(section => section.id === 'description')?.enabled, undefined);
 assert.equal(layout.position(mapped('contexts')).section, 'additional');
 assert.equal(layout.position(mapped('note')).section, 'notes');
 assert.deepEqual(layout.commandOrder.slice(-2), ['remove', 'inlineSubtask']);
});

test('malformed imported placements keep one owner and preserve nonremovable commands', () => {
 const layout = resolveTaskEditorLayout([
  { id: 'overview', properties: [{ kind: 'vault', name: ' Count ' }, { kind: 'vault', name: 'count' }, null, { kind: 'mapped', key: 'note' }] },
  { id: 'connections', properties: [] },
  { id: 'planning', properties: [mapped('contexts'), vault('COUNT')] },
  { id: 'commands', removed: true, commandOrder: ['remove', 'nonsense', 'remove'] },
  { id: 'custom:lost', name: 'Recovered' },
 ], mappingsWithUp);
 assert.deepEqual(layout.fields.get('overview'), [vault('Count')]);
 assert.deepEqual(layout.fields.get('connections'), []);
 assert.deepEqual(layout.fields.get('planning'), [mapped('contexts')]);
 assert.equal(layout.position(vault('UP')).section, 'planning');
 assert.deepEqual(layout.commandOrder, ['remove', ...TASK_EDITOR_COMMAND_IDS.filter(id => id !== 'remove')]);
});

test('removing an imported owner also clears aliases in implicit defaults', () => {
 const original = normalizeTaskEditorSections([{ id:'custom:imported', name:'Imported', properties:[vault('Up')] }]);
 const removed = changeTaskEditorLayout(original, mappingsWithUp, { type:'remove-section', id:'custom:imported' });
 const layout = resolveTaskEditorLayout(removed, mappingsWithUp);
 assert.equal(layout.position(mapped('contexts')).section, 'additional');
 assert.equal(layout.assignment(mapped('contexts')),undefined);
});

test('sequential layout mutations rebase, commit only preferences, and retain the last layout on failure', async () => {
 const seed = buildOperonDataPackageFromSettings(DEFAULT_SETTINGS);
 const harness = new SettingsPreservationHarness({ initialRaw: JSON.stringify(seed), table: false });
 try {
  const storage = harness.createStorage();
  await storage.initialize();
  const initial = harness.package();
  const attempts = harness.canonicalAttempts;
  const firstReload = harness.createStorage();
  await firstReload.initialize();
  assert.equal(harness.canonicalAttempts, attempts);
  assert.deepEqual(initial.ui.taskUiPreferences.taskEditorSections, seed.ui.taskUiPreferences.taskEditorSections);
  const change = (action: TaskEditorLayoutChange) => storage.saveTaskEditorSections((sections, mappings) => changeTaskEditorLayout(sections, mappings, action));
  await Promise.all([
   change({ type: 'add', id: 'custom:project', name: 'Project' }),
   change({ type: 'assign', section: 'custom:project', field: mapped('contexts') }),
   change({ type: 'remove-section', id: 'overview' }),
  ]);
  const result = harness.package();
  const sections = storage.getSettings().taskEditorSections;
  assert.deepEqual(result.ui.taskUiPreferences.taskEditorSections, sections);
  assert.deepEqual(result, { ...initial, ui: { ...initial.ui, taskUiPreferences: { ...initial.ui.taskUiPreferences, taskEditorSections: sections } } });
  const raw = harness.raw();
  harness.writeFault = 'throw-before';
  await assert.rejects(change({ type: 'rename', id: 'custom:project', name: 'Rejected' }));
  assert.equal(harness.raw(), raw);
  assert.deepEqual(storage.getSettings().taskEditorSections, sections);
  harness.writeFault = 'none';
  const reload = harness.createStorage();
  await reload.initialize();
  assert.deepEqual(reload.getSettings().taskEditorSections, sections);
  assert.equal(harness.raw(), raw);
  harness.assertIsolation();
 } finally { await harness.dispose(); }
});

function requireIconEdit(settings: Parameters<typeof capturePropertyIconEdit>[0], field: TaskEditorPropertyRef) {
 const edit = capturePropertyIconEdit(settings, field);
 assert.ok(edit);
 return edit;
}

test('aliases share the canonical or custom icon and a removed mapping reveals the vault preference', () => {
 const custom: KeyMapping = { canonicalKey: 'readingCount', visiblePropertyName: 'Reading Count',
  type: 'number', sync: 'no', enabled: true, isSystem: false, icon: 'star' };
 const keyMappings = [...mappingsWithUp.map(mapping => mapping.canonicalKey === 'contexts' ? { ...mapping, icon: 'link-2' } : mapping), custom];
 const settings = migrateSettings({ ...DEFAULT_SETTINGS, keyMappings, vaultPropertyIcons: { 'reading count': 'book-open' } });
 assert.equal(getSourcePropertyIcon(settings, 'UP'), 'link-2');
 assert.equal(getSourcePropertyIcon(settings, 'reading count'), 'star');
 assert.equal(capturePropertyIconEdit(settings, vault('Reading Count')), null);
 const withoutMapping = { ...settings, keyMappings: settings.keyMappings.filter(mapping => mapping.canonicalKey !== custom.canonicalKey) };
 assert.equal(getSourcePropertyIcon(withoutMapping, 'Reading COUNT'), 'book-open');
 const ambiguous = { ...settings, keyMappings: [...settings.keyMappings, { ...custom, canonicalKey: 'secondCount', visiblePropertyName: 'reading count' }] };
 assert.equal(getSourcePropertyIcon(ambiguous, 'Reading Count', 'hash'), 'hash');
 assert.equal(capturePropertyIconEdit(ambiguous, vault('Reading Count')), null);

 const column = { key: encodeTableFilePropertyColumnKey('Reading Count')!, label: 'Reading Count',
  type: 'number' as const, group: 'fileProperty' as const, readonly: false, icon: 'hash', aliases: [] };
 const glyph = () => buildEffectiveTableTaskFieldCatalog(withoutMapping, [column]).find(field => field.key === column.key)?.icon;
 assert.equal(glyph(), 'book-open');
 withoutMapping.vaultPropertyIcons = { 'reading count': 'bookmark' };
 assert.equal(glyph(), 'bookmark');
 assert.equal(buildEffectiveTableTaskFieldCatalog(withoutMapping, [{ ...column, readOnlyReason: 'automatic' }]).find(field => field.key === column.key)?.icon, 'shield-alert');
});

test('icon writes preserve unrelated settings, serialize independent fields, and reject a stale target', async () => {
 const custom: KeyMapping = { canonicalKey: 'client', visiblePropertyName: 'Client', type: 'text', sync: 'no', enabled: true, isSystem: false };
 const seed = buildOperonDataPackageFromSettings(migrateSettings({ ...DEFAULT_SETTINGS, keyMappings: [...mappingsWithUp, custom] }));
 Object.assign(seed.ui.taskUiPreferences, { vaultPropertyIcons: { 'Other field': 'lucide-bookmark' }, futurePreference: { keep: true } });
 const harness = new SettingsPreservationHarness({ initialRaw: JSON.stringify(seed), table: false });
 try {
  const setup = harness.createStorage();
  await setup.initialize();
  setup.destroy();
  const initial = harness.package();
  const storage = harness.createStorage();
  const attempts = harness.canonicalAttempts;
  await storage.initialize();
  assert.equal(harness.canonicalAttempts, attempts);
  const live = storage.getSettings();
  const up = requireIconEdit(live, mapped('contexts'));
  const client = requireIconEdit(live, mapped('client'));
  const count = requireIconEdit(live, vault('Reading Count'));

  await Promise.all([
   storage.savePropertyIcon(up, 'lucide-link-2'),
   storage.savePropertyIcon(client, 'star'),
   storage.savePropertyIcon(count, 'book-open'),
  ]);
  const expected = structuredClone(initial);
  expected.taxonomy.keyMappings.system.find(mapping => mapping.canonicalKey === 'contexts')!.icon = 'link-2';
  expected.taxonomy.keyMappings.custom.find(mapping => mapping.canonicalKey === 'client')!.icon = 'star';
  expected.ui.taskUiPreferences.vaultPropertyIcons!['reading count'] = 'book-open';
  assert.deepEqual(harness.package(), expected);
  assert.equal(storage.keyMappings.getAll().find(mapping => mapping.canonicalKey === 'contexts')?.icon, 'link-2');
  const committed = harness.raw();
  await assert.rejects(storage.savePropertyIcon(up, 'alarm-clock'), /target changed/);
  const fresh = requireIconEdit(live, vault('READING COUNT'));
  harness.writeFault = 'throw-before';
  await assert.rejects(storage.savePropertyIcon(fresh, ''));
  assert.equal(harness.raw(), committed);
  assert.equal(getSourcePropertyIcon(live, 'reading count'), 'book-open');
  harness.writeFault = 'none';
  const reload = harness.createStorage();
  await reload.initialize();
  const opening = reload.getSettings();
  assert.equal(getSourcePropertyIcon(opening, 'UP'), 'link-2');
  assert.equal(getSourcePropertyIcon(opening, 'Client'), 'star');
  assert.equal(getSourcePropertyIcon(opening, 'READING COUNT'), 'book-open');

  const earlier = requireIconEdit(opening, mapped('contexts'));
  await reload.updateSettings({ keyMappings: opening.keyMappings.map(mapping =>
   mapping.canonicalKey === 'contexts' ? { ...mapping, visiblePropertyName: 'Parent Note' } : mapping) });
  await assert.rejects(reload.savePropertyIcon(earlier, 'calendar'), /target changed/);
  assert.equal(getSourcePropertyIcon(opening, 'Parent Note'), 'link-2');
  const renamed = requireIconEdit(opening, mapped('contexts'));
  await reload.savePropertyIcon(renamed, '');
  await reload.savePropertyIcon(requireIconEdit(opening, vault('Reading Count')), '');
  assert.equal(getSourcePropertyIcon(opening, 'Parent Note'), up.icon);
  assert.equal(getSourcePropertyIcon(opening, 'reading count', 'hash'), 'hash');
  harness.assertIsolation();
 } finally { await harness.dispose(); }
});

test('initial defaults omit vault icons and a default selection performs zero additional writes', async () => {
 const harness = new SettingsPreservationHarness({ initialRaw: null, table: false });
 try {
  const storage = harness.createStorage();
  await storage.initialize();
  assert.equal(harness.package().ui.taskUiPreferences.vaultPropertyIcons, undefined);
  const attempts = harness.canonicalAttempts;
  const edit = requireIconEdit(storage.getSettings(), vault('Reading Count'));
  assert.equal(await storage.savePropertyIcon(edit, ''), false);
  assert.equal(harness.canonicalAttempts, attempts);
  assert.equal(await storage.savePropertyIcon(edit, 'book-open'), true);
  assert.equal(harness.package().ui.taskUiPreferences.vaultPropertyIcons?.['reading count'], 'book-open');
 } finally { await harness.dispose(); }
});
