import { parseYaml } from 'obsidian';
import { TaskWriter } from '../src/core/task-writer';
import { readLosslessYamlListField } from '../src/core/yaml-fields';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { resolveParentLinkInheritance, loadParentLinkListSource as loadListSource } from '../src/core/subtask-inheritance';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { parseListValue } from '../src/core/parser';

const loadParentLinkListSource = (parent: Parameters<typeof loadListSource>[0], settings: Parameters<typeof loadListSource>[1], readSource: (path: string) => Promise<string>) => loadListSource(parent, settings, async path => {
 const source = await readSource(path);
 const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
 return match ? parseYaml(match[1]) : null;
});

const settings = { ...DEFAULT_SETTINGS, inheritPropertiesOnParentLink: true, childTaskInheritanceFields: ['priority', 'contexts', 'assignees', 'tags', 'taskIcon'] };
const child = { operonId: 'child01', fieldValues: { priority: 'Own', contexts: 'A; B', assignees: '' }, tags: ['own'] };
const parent = { fieldValues: { priority: 'Parent', contexts: 'B; C', assignees: 'Alice', taskIcon: 'star' }, tags: ['own', 'parent'] };
const link = { parentTask: 'parent1' };

test('new parent fills blanks and unions lists without replacing child scalars', () => {
 assert.deepEqual(resolveParentLinkInheritance(child, link, settings, () => parent), { contexts: 'A; B; C', assignees: 'Alice', _tags: 'own; parent', taskIcon: 'star' });
 assert.equal(child.fieldValues.contexts, 'A; B');
 assert.deepEqual(link, { parentTask: 'parent1' });
});
test('disabled, same parent, unlink, unrelated edit, self and missing parent never inherit', () => {
 assert.deepEqual(resolveParentLinkInheritance(child, link, DEFAULT_SETTINGS, () => parent), {});
 for (const payload of ([{ parentTask: '' }, { priority: 'new' }, { parentTask: child.operonId }] as Record<string, string>[])) assert.deepEqual(resolveParentLinkInheritance(child, payload, settings, () => parent), {});
 assert.deepEqual(resolveParentLinkInheritance({ ...child, fieldValues: { ...child.fieldValues, parentTask: 'parent1' } }, link, settings, () => parent), {});
 assert.deepEqual(resolveParentLinkInheritance(child, link, settings, () => null), {});
});
test('reparenting merges new values once and preserves existing ordering', () => {
 const result = resolveParentLinkInheritance({ ...child, fieldValues: { ...child.fieldValues, parentTask: 'oldparent' } }, link, settings, () => parent);
 assert.equal(result.contexts, 'A; B; C');
 assert.deepEqual(resolveParentLinkInheritance({ ...child, fieldValues: { ...child.fieldValues, ...result, ...link } }, link, settings, () => parent), {});
});
test('draft values take precedence and only configured fields are inherited', () => {
 const result = resolveParentLinkInheritance(child, { ...link, contexts: 'Draft', priority: 'Draft priority' }, { ...settings, childTaskInheritanceFields: ['contexts', 'priority'] }, () => parent);
 assert.deepEqual(result, { contexts: 'Draft; B; C' });
});
test('escaped list delimiters and duplicate incoming values survive the union', () => {
 const result = resolveParentLinkInheritance(child, { ...link, contexts: 'A\\; B' }, settings, () => ({ ...parent, fieldValues: { contexts: 'A\\; B; C; C' } }));
 assert.deepEqual(parseListValue(result.contexts ?? ''), ['A; B', 'C']);
});
test('missing legacy preference defaults off and enabled preference round-trips in the existing package', () => {
 assert.equal(migrateSettings({}).inheritPropertiesOnParentLink, false);
 assert.equal(migrateSettings({ inheritPropertiesOnParentLink: 'true' }).inheritPropertiesOnParentLink, false);
 const packaged = buildOperonDataPackageFromSettings(settings);
 assert.equal(composeOperonSettingsFromDataPackage(packaged, DEFAULT_SETTINGS).inheritPropertiesOnParentLink, true);
});

 test('YAML list guards accept arrays and reject concurrent or malformed list values', () => {
 const writer = new TaskWriter({} as never, {} as never, DEFAULT_SETTINGS.keyMappings);
 const content = '---\noperonId: child01\ncontexts:\n  - A\n  - B\n---\nBody';
 const update = { operonId: 'child01', format: 'yaml' as const, fieldValues: { parentTask: 'parent1', contexts: 'A; B; C' }, expectedFieldValues: { contexts: 'A; B', parentTask: '' } };
 const result = writer.renderGuardedTaskSourceContent('Child.md', content, [update]);
 assert.equal(result.ok, true);
 assert.ok(result.content.includes('C'));
 assert.equal(writer.renderGuardedTaskSourceContent('Child.md', content.replace('  - B', '  - Changed'), [update]).ok, false);
 assert.equal(writer.renderGuardedTaskSourceContent('Child.md', content.replace('  - A\n  - B', '  - A; B'), [update]).ok, false);
 assert.equal(readLosslessYamlListField({ contexts: ['A', { nested: 'unsafe' }] }, 'contexts', DEFAULT_SETTINGS.keyMappings).ok, false);
 });

test('parent YAML native semicolon item stops inheritance before any child write', async () => {
 const parentTask = { ...parent, operonId: 'parent1', primary: { format: 'yaml' as const, filePath: 'Parent.md', lineNumber: 0 } };
 let writes = 0;
 await assert.rejects(async () => {
  const source = await loadParentLinkListSource(parentTask, settings, async () => '---\noperonId: parent1\ncontexts:\n  - A; B\n---\nParent');
  resolveParentLinkInheritance(child, link, settings, () => source);
  writes++;
 }, /ambiguous semicolon/);
 assert.equal(writes, 0);
});
test('ordinary native parent lists still merge into inline and YAML children', async () => {
 const parentTask = { ...parent, operonId: 'parent1', primary: { format: 'yaml' as const, filePath: 'Parent.md', lineNumber: 0 } };
 const source = await loadParentLinkListSource(parentTask, settings, async () => '---\noperonId: parent1\ncontexts:\n  - A\n  - B\n---\nParent');
 const result = resolveParentLinkInheritance({ ...child, fieldValues: { contexts: 'Own' } }, link, settings, () => source);
 assert.deepEqual(parseListValue(result.contexts), ['Own', 'A', 'B']);
 for (const format of ['inline', 'yaml'] as const) {
  const writer = new TaskWriter({} as never, {} as never, settings.keyMappings);
  const content = format === 'inline' ? '- [ ] Child {{operonId:: child01}} {{contexts:: Own}}' : '---\noperonId: child01\ncontexts: Own\n---\nBody';
  const saved = writer.renderGuardedTaskSourceContent('Child.md', content, [{ operonId: 'child01', format, fieldValues: { ...link, ...result }, expectedFieldValues: { contexts: 'Own' } }]);
  assert.equal(saved.ok, true);
  if (format === 'yaml') assert.deepEqual(parseYaml(saved.content.split('---')[1]).contexts, ['Own', 'A', 'B']);
 }
});
test('parent list source stops on read failure or changed identity and ignores deleted lists', async () => {
 const task = { ...parent, operonId: 'parent1', primary: { format: 'yaml' as const, filePath: 'Parent.md', lineNumber: 0 } };
 await assert.rejects(loadParentLinkListSource(task, settings, async () => { throw new Error('read failed'); }));
 await assert.rejects(loadParentLinkListSource(task, settings, async () => '---\noperonId: changed\n---\n'));
 const source = await loadParentLinkListSource(task, settings, async () => '---\noperonId: parent1\n---\n');
 assert.equal(resolveParentLinkInheritance(child, link, settings, () => source).contexts, undefined);
});
