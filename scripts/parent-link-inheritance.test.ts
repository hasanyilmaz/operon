import { TaskWriter } from '../src/core/task-writer';
import { readLosslessYamlListField } from '../src/core/yaml-fields';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { resolveParentLinkInheritance } from '../src/core/subtask-inheritance';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { parseListValue } from '../src/core/parser';

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
