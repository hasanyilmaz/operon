import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TFile } from 'obsidian';
import { resolveAssigneeImageSource } from '../src/core/assignee-image-source';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';

function fixture(value: unknown) {
 const person = Object.assign(Object.create(TFile.prototype), { path: 'People/Mehmet.md', extension: 'md' });
 const photo = Object.assign(Object.create(TFile.prototype), { path: 'People/photo.png', extension: 'png' });
 const calls: string[][] = [];
 const app: any = {
  metadataCache: {
   getFirstLinkpathDest(target: string, source: string) { calls.push([target, source]); return target === 'Mehmet' ? person : target === 'photo.png' ? photo : null; },
   getFileCache() { return { frontmatter: { avatar: value } }; },
  },
  vault: { getResourcePath(file: TFile) { return 'resource:' + file.path; } },
 };
 return { app, calls };
}
test('assignee source resolves alias and image relative to the person note', () => {
 const { app, calls } = fixture('[[photo.png]]');
 assert.deepEqual(resolveAssigneeImageSource(app, '[[Mehmet|Meh]]', 'Daily.md', ' avatar '), {
  personPath: 'People/Mehmet.md', imagePath: 'People/photo.png', src: 'resource:People/photo.png',
 });
 assert.deepEqual(calls, [['Mehmet', 'Daily.md'], ['photo.png', 'People/Mehmet.md']]);
});
test('empty, unsupported, missing and plain-text sources retain canonical fallback', () => {
 for (const value of ['', null, undefined, ['photo.png'], {}, '[[missing.png]]', 'javascript:alert(1)']) {
  const { app } = fixture(value);
  assert.equal(resolveAssigneeImageSource(app, '[[Mehmet]]', 'Daily.md', 'avatar'), null);
 }
 const { app, calls } = fixture('[[photo.png]]');
 assert.equal(resolveAssigneeImageSource(app, 'Mehmet', 'Daily.md', 'avatar'), null);
 assert.equal(resolveAssigneeImageSource(app, '[[Mehmet]]', 'Daily.md', ''), null);
 assert.deepEqual(calls, []);
 assert.equal(resolveAssigneeImageSource(app, '[[Missing]]', 'Daily.md', 'avatar'), null);
});
test('direct image URL is resolved without fetching', () => {
 const { app } = fixture('https://example.com/photo.png');
 assert.equal(resolveAssigneeImageSource(app, '[[Mehmet]]', 'Daily.md', 'avatar')?.src, 'https://example.com/photo.png');
});
test('setting defaults empty, normalizes, and survives settings-package roundtrip', () => {
 assert.equal(DEFAULT_SETTINGS.assigneeImageProperty, '');
 assert.equal(migrateSettings({}).assigneeImageProperty, '');
 const settings = migrateSettings({ ...DEFAULT_SETTINGS, assigneeImageProperty: ' photo ' });
 assert.equal(settings.assigneeImageProperty, 'photo');
 const pack = buildOperonDataPackageFromSettings(settings);
 assert.equal(pack.ui.taskUiPreferences.assigneeImageProperty, 'photo');
 assert.equal(composeOperonSettingsFromDataPackage(pack, DEFAULT_SETTINGS).assigneeImageProperty, 'photo');
});

test('General Chip Settings is last and exposes a free-text searchable setting', () => {
 const ui = readFileSync('src/ui/settings-tab.ts', 'utf8');
 const order = ui.slice(ui.indexOf('const TASK_CHIPS_SETTINGS_PAGE_ORDER'), ui.indexOf('const TASK_CHIPS_SETTINGS_PAGE_META'));
 assert.match(order, /'taskCardChips',\s*'generalChipSettings',\s*\];/);
 assert.ok(ui.includes("entryIds: ['assigneeImageProperty']"));
 assert.ok(ui.includes("pageId === 'generalChipSettings'"));
 assert.ok(ui.includes('new TextValueSuggest(this.app, text.inputEl, () => collectFileTaskMigrationPropertyKeyCandidates(this.app))'));
 const registry = readFileSync('src/ui/settings/settings-search-registry.ts', 'utf8');
 assert.match(registry, /'ui', 'interfaceTaskChips', 'assigneeImageProperty'.*'text'/);
});
