import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareCreationTemplate, resolveCreationTemplateValue, type PreparedCreationTemplate, type CreationTemplateInputs } from '../src/core/task-creation-template';
import { CreationTemplateSession } from '../src/core/task-creation-template-session';
import { TaskCreationDraft } from '../src/core/task-creation-draft';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { buildPipelineMinimalFileTaskTemplateOptions, type FileTaskTemplateOption } from '../src/core/file-task-templates';
import type { CreationDraftPropertyContext } from '../src/core/task-creation-draft-properties';
import { resolveOperonTemplatePlaceholders } from '../src/core/operon-id-placeholders';
import { buildMergedFileTaskDraft, parseFrontmatterDocument, splitFrontmatterDocument } from '../src/core/file-task-template-merge';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { App, parseYaml, TFile } from 'obsidian';

const yamlRoundTripValues = [
 'Office: North wing', 'Office:', ':', '123', '01', '1e3', 'true', 'false', 'null', 'yes', 'NO', '~',
 '@leading', '*alias', '&anchor', '- item', '#entrance', '[value]', '{key: value}',
 'line one\nline two', 'line one\r\nline two', 'tab\tvalue', 'C:\\path\\file',
 'C:\\path "quoted"', "It's 'quoted'", 'Grüße 東京', ' leading and trailing ',
];
const mergeYamlFields = (fieldValues: Record<string, string>) => buildMergedFileTaskDraft({
 source: { description: 'round-trip', fieldValues: { operonId: 'n000123', ...fieldValues } },
 defaults: { operonId: 'n000123', datetimeModified: '2026-11-06T10:00:00' },
 keyMappings: DEFAULT_SETTINGS.keyMappings, bodyStrategy: 'preserve-source',
});

for (const value of yamlRoundTripValues) test(`managed text survives writer, YAML and scanner: ${JSON.stringify(value)}`, async () => {
 const draft = mergeYamlFields({ location: value });
 const native = parseYaml(splitFrontmatterDocument(draft.content).frontmatter ?? '');
 assert.equal(native.location, value);
 assert.equal(parseFrontmatterDocument(draft.content, DEFAULT_SETTINGS.keyMappings).managedFieldValues.location, value);
 const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: 'round-trip.md', basename: 'round-trip', stat: { mtime: 1, size: draft.content.length } });
 const scanned = await scanFileWithMappings(new App(), file, DEFAULT_SETTINGS.keyMappings, draft.content);
 assert.equal(scanned.yamlTask?.fieldValues.location, value);
 assert.equal(scanned.yamlTask?.description, 'round-trip');
});

test('managed text lists and tags retain string members', async () => {
 const members = yamlRoundTripValues.filter(value => value.trim() === value);
 const draft = mergeYamlFields({ contexts: members.join('; ') });
 const native = parseYaml(splitFrontmatterDocument(draft.content).frontmatter ?? '');
 assert.deepEqual(native.contexts, members);
 assert.equal(parseFrontmatterDocument(draft.content, DEFAULT_SETTINGS.keyMappings).managedFieldValues.contexts, members.join('; '));
 const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: 'round-trip.md', basename: 'round-trip', stat: { mtime: 1, size: draft.content.length } });
 const scanned = await scanFileWithMappings(new App(), file, DEFAULT_SETTINGS.keyMappings, draft.content);
 assert.equal(scanned.yamlTask?.fieldValues.contexts, members.join('; '));
 const tagsDraft = buildMergedFileTaskDraft({
  source: { description: 'tags', fieldValues: {}, tags: ['123', 'true', 'Office: North wing'], tagsPresent: true },
  defaults: { operonId: 'n000123', datetimeModified: '2026-11-06T10:00:00' },
  keyMappings: DEFAULT_SETTINGS.keyMappings, bodyStrategy: 'preserve-source',
 });
 assert.deepEqual(parseYaml(splitFrontmatterDocument(tagsDraft.content).frontmatter ?? '').tags, ['123', 'true', 'Office: North wing']);
});

for (const [encoded, expected] of [
 ['"one\\x20two\\u263A\\U0001F600"', 'one two☺😀'],
 ["'It''s C:\\path'", "It's C:\\path"],
 ['"line\\nnext" # retained comment', 'line\nnext'],
 ['|-\n  first\n  second', 'first\nsecond'],
 ['>\n  first\n  second', 'first second\n'],
 ['|+\n  first\n\n', 'first\n\n'],
] as const) test(`managed YAML reads complete scalar syntax: ${encoded}`, async () => {
 for (const following of ['', '\npriority: A']) {
  const content = `---\noperonId: n000123\nlocation: ${encoded}${following}\n---\nBody`;
  const parsed = parseFrontmatterDocument(content, DEFAULT_SETTINGS.keyMappings);
  const native = parseYaml(splitFrontmatterDocument(content).frontmatter ?? '');
  if (!following) assert.equal(native.location, expected);
  assert.equal(parsed.managedFieldValues.location, native.location);
  assert.equal(parsed.body, 'Body');
  const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: 'round-trip.md', basename: 'round-trip', stat: { mtime: 1, size: content.length } });
  const scanned = await scanFileWithMappings(new App(), file, DEFAULT_SETTINGS.keyMappings, content);
  assert.equal(scanned.yamlTask?.fieldValues.location, parsed.managedFieldValues.location);
 }
});

test('managed flow and block lists decode YAML quoting and multiline members', () => {
 for (const encoded of [
  '["one\\x20two", \'It\'\'s C:\\path\', "line\\nnext"]',
  '\n  - "one\\x20two"\n  - \'It\'\'s C:\\path\'\n  - |-\n    line\n    next',
 ]) {
  const parsed = parseFrontmatterDocument(`---\ncontexts: ${encoded}\n---\n`, DEFAULT_SETTINGS.keyMappings);
  assert.equal(parsed.managedFieldValues.contexts, "one two; It's C:\\path; line\nnext");
 }
});

test('merge preserves mapped block text, unknown sections, body and native typed values', () => {
 const mappings = DEFAULT_SETTINGS.keyMappings.map(mapping => mapping.canonicalKey === 'location' ? { ...mapping, visiblePropertyName: 'Venue' } : mapping);
 const original = '---\noperonId: n000123\nVenue: |-\n  first\n  second\nUnknown:\n  nested: [1, true, "001"]\n# keep unknown comment\nestimate: 42\ndateDue: 2026-11-07\ndatetimeStart: 2026-11-07T12:30:00\npriority: A\n---\n# Body\n\n[[Link]]\n';
 const source = parseFrontmatterDocument(original, mappings);
 const draft = buildMergedFileTaskDraft({
  source: { description: 'existing', fieldValues: { ...source.managedFieldValues, priority: 'B' }, frontmatterDocument: source },
  defaults: { operonId: 'n000123', datetimeModified: '2026-11-06T10:00:00' },
  keyMappings: mappings, bodyStrategy: 'preserve-source', preserveSourceKeyChoices: true,
 });
 assert.equal(splitFrontmatterDocument(draft.content).body, source.body);
 assert.ok(draft.content.includes('Venue: |-\n  first\n  second\nUnknown:\n  nested: [1, true, "001"]\n# keep unknown comment'));
 const native = parseYaml(splitFrontmatterDocument(draft.content).frontmatter ?? '');
 assert.equal(native.Venue, 'first\nsecond');
 assert.equal(native.estimate, 42);
 assert.equal(native.dateDue, '2026-11-07');
 assert.equal(native.datetimeStart, '2026-11-07T12:30:00');
 assert.deepEqual(native.Unknown, { nested: [1, true, '001'] });
 assert.deepEqual(draft.orderedYamlKeys.slice(0, 7), ['operonId', 'Venue', 'Unknown', 'estimate', 'dateDue', 'datetimeStart', 'priority']);
});

test('native number, checkbox, date and existing heterogeneous list values retain their types', () => {
 const mappings = [...DEFAULT_SETTINGS.keyMappings, {
  canonicalKey: 'reviewed', visiblePropertyName: 'Reviewed', type: 'checkbox' as const,
  sync: 'yes' as const, enabled: true, isSystem: false,
 }];
 const source = parseFrontmatterDocument('---\noperonId: n000123\ncontexts: [3, "3", true, "true"]\n---\nBody', mappings);
 const draft = buildMergedFileTaskDraft({
  source: { description: 'typed', frontmatterDocument: source, fieldValues: {
   ...source.managedFieldValues, estimate: ' 42 ', reviewed: 'false', dateDue: '2026-11-07',
   datetimeStart: '2026-11-07T12:30:00', reminderDatetimes: '2026-11-07T12:30:00; 2026-11-08T12:30:00',
  } },
  defaults: { operonId: 'n000123', datetimeModified: '2026-11-06T10:00:00' },
  keyMappings: mappings, bodyStrategy: 'preserve-source',
 });
 const native = parseYaml(splitFrontmatterDocument(draft.content).frontmatter ?? '');
 assert.equal(native.estimate, 42);
 assert.equal(native.Reviewed, false);
 assert.equal(native.dateDue, '2026-11-07');
 assert.equal(native.datetimeStart, '2026-11-07T12:30:00');
 assert.deepEqual(native.ReminderDatetimes, ['2026-11-07T12:30:00', '2026-11-08T12:30:00']);
 assert.deepEqual(native.contexts, [3, '3', true, 'true']);
 assert.ok(draft.content.includes('contexts: [3, "3", true, "true"]'));
});

test('appending modified time preserves managed and unknown block scalar boundaries', () => {
 for (const key of ['location', 'Unknown']) for (const header of ['|+', '>+', '|', '>', '|-', '>-']) {
  for (const trailing of ['', '\n', '\n\n']) for (const following of ['', '\npriority: A']) {
   const original = `---\noperonId: n000123\n${key}: ${header}\n  first${trailing}${following}\n---\nBody`;
   const source = parseFrontmatterDocument(original, DEFAULT_SETTINGS.keyMappings);
   const draft = buildMergedFileTaskDraft({
    source: { description: 'block', fieldValues: source.managedFieldValues, frontmatterDocument: source },
    defaults: { operonId: 'n000123', datetimeModified: '2026-11-06T10:00:00' },
    keyMappings: DEFAULT_SETTINGS.keyMappings, bodyStrategy: 'preserve-source',
   });
   const before = parseYaml(splitFrontmatterDocument(original).frontmatter ?? '');
   const after = parseYaml(splitFrontmatterDocument(draft.content).frontmatter ?? '');
   assert.equal(after[key], before[key], JSON.stringify({ key, header, trailing, following }));
   assert.equal(splitFrontmatterDocument(draft.content).body, 'Body');
  }
 }
});

const properties: CreationDraftPropertyContext = {
 keyMappings: DEFAULT_SETTINGS.keyMappings,
 propertyTypes: { Client: 'text', Values: 'multitext', Count: 'number', Reviewed: 'checkbox', Published: 'date', Appointment: 'datetime', Other: 'text' },
};
const inputs: CreationTemplateInputs = {
 title: 'My title', taskDescription: 'My description', note: 'My note', priority: 'High', status: 'Project.Ready',
 dateStarted: '2026-10-01', dateScheduled: '2026-10-02', dateDue: '2026-10-03',
};
const clock = { now: '2026-10-10T09:08:07', dateFormat: 'DD.MM.YYYY', timeFormat: 'HH:mm:ss' };
const folder = (id = 'A'): FileTaskTemplateOption => ({ id, kind: 'folder', path: `${id}.md`, name: id });
const yaml = (fields: string, body = '') => `---\n${fields}\n---\n${body}`;
const prepare = (content: string, overrides: Partial<Parameters<typeof prepareCreationTemplate>[0]> = {}) => prepareCreationTemplate({
 content, sourceId: 'A', revision: 1, properties, clock, inputs, ...overrides,
});
const ready = (content: string, overrides: Partial<Parameters<typeof prepareCreationTemplate>[0]> = {}): PreparedCreationTemplate => {
 const result = prepare(content, overrides); assert.equal(result.status, 'ready');
 if (result.status !== 'ready') throw new Error('Expected ready');
 return result;
};
const values = (result: PreparedCreationTemplate) => Object.fromEntries(result.fields.map(field => [field.sourceName, field.value]));
const fixture = (read: (path: string) => Promise<string>) => {
 const draft = new TaskCreationDraft(properties);
 const session = new CreationTemplateSession(draft, properties, DEFAULT_SETTINGS.pipelines, read);
 return { draft, session };
};

for (const [name, source, expected] of [
 ['Client', '"3"', '3'], ['Count', '0', 0], ['Reviewed', 'false', false],
 ['Published', '2026-10-10', '2026-10-10'], ['Appointment', '2026-10-10T09:08:07', '2026-10-10T09:08:07'],
 ['Values', '[3, "3", Ali, Ali]', [3, '3', 'Ali', 'Ali']], ['Values', '[]', []], ['Values', '[""]', ['']],
 ['Client', '""', ''], ['Client', '', null], ['Count', 'null', null], ['Reviewed', '', null],
] as const) test(`native YAML retains ${name}: ${source}`, () => {
 const result = ready(yaml(`${name}: ${source}`));
 assert.deepEqual(values(result)[name], expected); assert.deepEqual(result.diagnostics, []);
});

test('empty, comment-only and absent frontmatter preserve body without evaluating it', () => {
 for (const content of ['body <% unsafe %> {{operonId}}', '---\n---\nBody', '---\r\n---\r\nBody', yaml('# comment')]) {
  const result = ready(content); assert.deepEqual(result.fields, []); assert.equal(result.rawContent, content);
 }
 assert.equal(ready('Body {{date}}').body, 'Body {{date}}');
});

test('all existing value variables and Operon before Core date/time priority resolve once', () => {
 const result = resolveCreationTemplateValue('{{title}}|{{taskDescription}}|{{note}}|{{status}}|{{priority}}|{{dateStarted}}|{{dateScheduled}}|{{dateDue}}|{{date}}|{{time}}|{{datetime}}|{{date:DD.MM.YYYY}}|{{time:HH:mm:ss}}', inputs, clock);
 assert.equal(result, 'My title|My description|My note|Project.Ready|High|2026-10-01|2026-10-02|2026-10-03|2026-10-10|09:08|2026-10-10T09:08:07|10.10.2026|09:08:07');
});

test('raw and quoted placeholders resolve safely without injecting YAML, recursion, or new members', () => {
 const description = '"quoted": yes\nInjected: true\\tail {{date}} <% not executable %>';
 const result = ready(yaml('Client: {{taskDescription}}\nOther: "{{title}}"\nValues: ["{{note}}", {{taskDescription}}]'), {
  inputs: { ...inputs, taskDescription: description, title: 'Title: with "quotes"', note: 'a; b' },
 });
 assert.deepEqual(values(result), { Client: description, Other: 'Title: with "quotes"', Values: ['a; b', description] });
 assert.equal(result.fields.length, 3);
});

test('list syntax, block scalars, wikilinks and escaped characters retain native values', () => {
 const result = ready(yaml('Values:\n  - "[[Note|Alias]]"\n  - "a; b"\n  - "quote \\" and \\\\ slash"\n  - "line\\nnext"\nClient: |-\n  first\n  second'));
 assert.deepEqual(values(result), { Values: ['[[Note|Alias]]', 'a; b', 'quote " and \\ slash', 'line\nnext'], Client: 'first\nsecond' });
});

test('unknown variables remain literal and identity expressions are deferred without allocation', () => {
 const result = ready(yaml('Client: {{unknown}}\nOther: "prefix {{operonIdA}}"\noperonId: {{operonId}}\ndatetimeCreated: {{datetime}}\ndatetimeModified: {{datetime}}'));
 assert.deepEqual(values(result), { Client: '{{unknown}}' });
 assert.deepEqual(result.diagnostics.map(item => item.reason), ['identity', 'system', 'system', 'system']);
});

for (const source of [
 'Other: <% tp.date.now("YYYY") %>',
 'Other: "<% tp.date.now(\'YYYY\') %>"',
 'Values: [Ali, "<% tp.date.now(\'YYYY\') %>", Ali]',
 'Other: <%*\n  const a = "anything: {unsafe}";\n  tR += a;\n%>',
 'Other: |\n  <%*\n  tR += "x";\n  %>',
]) test(`Templater property is deferred in full: ${source.split('\n')[0]}`, () => {
 const content = yaml(`Client: retained\n${source}\nCount: 0`, '<% body remains intact %>');
 const result = ready(content);
 assert.deepEqual(values(result), { Client: 'retained', Count: 0 });
 assert.deepEqual(result.diagnostics.map(item => item.reason), ['templater']);
 assert.equal(result.rawContent, content); assert.equal(result.body, '<% body remains intact %>');
});

test('file-only and nested fields retain raw source and give per-field diagnostics', () => {
 const content = yaml('aliases: [name]\ncssclasses: [wide]\nClient: {nested: {a: b}}\nValues: [one, [two]]\nCount: 3');
 const result = ready(content);
 assert.equal(result.rawContent, content);
 assert.deepEqual(result.diagnostics.map(item => item.reason), ['file-only', 'file-only', 'unsupported', 'unsupported']);
 assert.deepEqual(values(result).Client, { nested: { a: 'b' } });
});

for (const body of ['Client: [unterminated', 'Client: a\nClient: b', '- a\n- b', 'Client: a\n  nested: invalid', '{{title}}: value', 'Client: <% unfinished']) {
 test(`invalid YAML fails explicitly: ${body}`, () => {
  assert.equal(prepare(yaml(body)).status, 'error');
 });
}

test('unclosed frontmatter fails rather than becoming a body-only template', () => {
 assert.equal(prepare('---\nClient: value').status, 'error');
});

test('Automatic, mismatched and alias-duplicate values do not become editable', () => {
 const result = ready(yaml('Unknown: value\nCount: words\nPriority: High\npriority: Low'));
 const draft = new TaskCreationDraft(properties); draft.replaceSource('template', 'A', result.fields);
 assert.equal(draft.getField('Unknown').readOnlyReason, 'automatic');
 assert.equal(draft.getField('Count').readOnlyReason, 'type-conflict');
 assert.equal(draft.getField('priority').readOnlyReason, 'type-conflict');
 assert.throws(() => draft.setValue('Unknown', 'new'), /read-only/);
});

test('read once, stable clock, update latest inputs, retain user member edit and removal', async () => {
 let reads = 0;
 const { draft, session } = fixture(async () => { reads++; return yaml('Published: {{date}}\nClient: {{taskDescription}}\nValues: ["{{title}}", Ali, Ali]'); });
 await session.select(folder(), clock, inputs);
 const members = draft.getField('Values').members;
 draft.editMember('Values', members[0].id, 'Mine'); draft.removeMember('Values', members[1].id);
 session.updateInputs({ ...inputs, taskDescription: 'New', title: 'Changed' });
 assert.equal(reads, 1); assert.equal(draft.getField('Published').value, '2026-10-10');
 assert.equal(draft.getField('Client').value, 'New'); assert.deepEqual(draft.getField('Values').value, ['Mine', 'Ali']);
 draft.setValue('Client', 'User'); session.updateInputs(inputs); assert.equal(draft.getField('Client').value, 'User');
});

test('selection switch drops only source values and gives the new selection its supplied time', async () => {
 const { draft, session } = fixture(async path => yaml(`Client: ${path}\nPublished: {{date}}\nValues: [${path}]`));
 draft.replaceSource('parent', 'P', [{ sourceName: 'priority', value: 'Parent' }]);
 await session.select(folder('A'), clock, inputs);
 draft.editMember('Values', draft.getField('Values').members[0].id, 'User');
 await session.select(folder('B'), { now: '2026-11-11T10:10:10' }, inputs);
 assert.equal(draft.getField('Client').value, 'B.md'); assert.equal(draft.getField('priority').value, 'Parent');
 assert.equal(draft.getField('Published').value, '2026-11-11');
 assert.deepEqual(draft.getField('Values').value, ['B.md', 'User']);
});

test('empty template applies defaults while user-cleared fields stay empty', async () => {
 const { draft, session } = fixture(async () => yaml('Client:\nValues: []'));
 draft.replaceSource('default', 'D', [{ sourceName: 'Client', value: 'Default' }]);
 await session.select(folder(), clock, inputs); assert.equal(draft.getField('Client').value, 'Default');
 draft.clearValue('Client'); session.updateInputs(inputs); assert.equal(draft.getField('Client').value, '');
});

test('explicit refresh reads again but preserves the clock and member identities', async () => {
 let reads = 0;
 const { draft, session } = fixture(async () => { reads++; return yaml('Published: {{date}}\nValues: ["{{title}}", Ali]'); });
 await session.select(folder(), clock, inputs);
 draft.removeMember('Values', draft.getField('Values').members[1].id);
 await session.refresh();
 assert.equal(reads, 2); assert.equal(draft.getField('Published').value, '2026-10-10');
 assert.deepEqual(draft.getField('Values').value, ['My title']);
});

test('deferred old reads and failures cannot replace newer selection', async () => {
 let finish!: (value: string) => void;
 const { draft, session } = fixture(path => path === 'A.md' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(yaml('Client: B')));
 const first = session.select(folder('A'), clock, inputs);
 await session.select(folder('B'), clock, inputs); finish(yaml('Client: A')); await first;
 assert.equal(draft.getField('Client').value, 'B'); assert.equal(session.snapshot().status, 'ready');
});

test('inputs changed while loading are used without a second source read', async () => {
 let finish!: (value: string) => void;
 const { draft, session } = fixture(() => new Promise(resolve => { finish = resolve; }));
 const loading = session.select(folder(), clock, inputs);
 session.updateInputs({ ...inputs, title: 'Latest' }); finish(yaml('Client: {{title}}')); await loading;
 assert.equal(draft.getField('Client').value, 'Latest');
});

test('cancel invalidates a pending read and keeps user and parent values', async () => {
 let finish!: (value: string) => void;
 const { draft, session } = fixture(() => new Promise(resolve => { finish = resolve; }));
 draft.setValue('Count', 0); draft.replaceSource('parent', 'P', [{ sourceName: 'Client', value: 'Parent' }]);
 const loading = session.select(folder(), clock, inputs); session.cancel(); finish(yaml('Other: old')); await loading;
 assert.equal(session.snapshot().status, 'empty'); assert.equal(draft.getField('Other').state, 'missing');
 assert.equal(draft.getField('Count').value, 0); assert.equal(draft.getField('Client').value, 'Parent');
});

for (const broken of ['read', 'yaml']) test(`failed selection clears previous template but retains user draft: ${broken}`, async () => {
 const { draft, session } = fixture(async path => {
  if (path === 'A.md') return yaml('Client: A');
  if (broken === 'read') throw new Error('gone');
  return yaml('Client: [');
 });
 await session.select(folder(), clock, inputs); draft.setValue('Count', 0);
 await session.select(folder('B'), clock, inputs);
 assert.equal(session.snapshot().status, 'error'); assert.equal(draft.getField('Client').state, 'missing'); assert.equal(draft.getField('Count').value, 0);
 await session.select(null, clock, inputs); assert.equal(session.snapshot().status, 'empty');
});

test('minimal pipeline uses configured initial status with no source read', async () => {
 const option = buildPipelineMinimalFileTaskTemplateOptions(DEFAULT_SETTINGS.pipelines)[0]; assert.ok(option);
 const { draft, session } = fixture(async () => { throw new Error('must not read'); });
 await session.select(option, clock, inputs);
 assert.equal(session.snapshot().status, 'ready'); assert.match(String(draft.getField('status').value), /\./);
 await session.select({ ...option, pipelineId: 'missing' }, clock, inputs);
 assert.equal(session.snapshot().status, 'error'); assert.equal(draft.getField('status').state, 'missing');
});

test('input and output objects are isolated and no persistence port exists or is called', async () => {
 const originalInputs = { ...inputs }; const originalClock = { ...clock };
 const { draft, session } = fixture(async () => yaml('Client: {{title}}'));
 await session.select(folder(), originalClock, originalInputs);
 originalClock.now = '2030-01-01T01:01:01'; originalInputs.title = 'external';
 const snapshot = session.snapshot(); assert.equal(snapshot.status, 'ready');
 if (snapshot.status === 'ready') snapshot.fields[0].value = 'mutated';
 assert.equal(draft.getField('Client').value, 'My title');
});

test('existing Operon content resolver still allocates IDs only in its existing path', () => {
 let allocations = 0;
 const content = resolveOperonTemplatePlaceholders(yaml('operonId: {{operonId}}\nnote: {{taskDescription}}'), {
  generateOperonId: () => { allocations++; return 'aaaaaaa'; },
  context: { ...inputs, date: '2026-10-10', time: '09:08', datetime: clock.now },
 });
 assert.equal(allocations, 1); assert.match(content, /operonId: aaaaaaa/); assert.match(content, /note: My description/);
});

test('normalized set lists omit blanks without invalid member identities', async () => {
 const { draft, session } = fixture(async () => yaml('contexts: [a, "", a, b]\ntags: ["#work", "", work]'));
 await session.select(folder(), clock, inputs);
 assert.deepEqual(draft.getField('contexts').value, ['a', 'b']);
 assert.deepEqual(draft.getField('tags').value, ['work']);
});

test('metadata unavailable stays read-only and literal legacy quotes stay literal', () => {
 const result = ready(yaml('Client: literal'), { properties: { ...properties, propertyTypes: null } });
 assert.deepEqual(result.diagnostics, [{ sourceName: 'Client', reason: 'unavailable', inline: 'unverified' }]);
 const mapping = { canonicalKey: 'Legacy', visiblePropertyName: 'Legacy', type: 'list' as const, enabled: true, sync: 'auto' as const, isSystem: false };
 const customContext = { ...properties, keyMappings: [...properties.keyMappings, mapping] };
 const legacy = ready(yaml('Legacy: \'"3"; Ali; Ali\''), { properties: customContext });
 const draft = new TaskCreationDraft(customContext); draft.replaceSource('template', 'A', legacy.fields);
 assert.deepEqual(draft.getField('Legacy').value, ['"3"', 'Ali', 'Ali']);
});

test('old read rejection after switching cannot clear successful newer fields', async () => {
 let rejectOld!: (error: Error) => void;
 const { draft, session } = fixture(path => path === 'A.md' ? new Promise((_resolve, reject) => { rejectOld = reject; }) : Promise.resolve(yaml('Client: B')));
 const old = session.select(folder(), clock, inputs);
 await session.select(folder('B'), clock, inputs); rejectOld(new Error('old failure')); await old;
 assert.equal(session.snapshot().status, 'ready'); assert.equal(draft.getField('Client').value, 'B');
});

test('source insertion and reorder do not retarget a removed or edited static member', async () => {
 let source = yaml('Values: [Ali, Bob, Dave]');
 const { draft, session } = fixture(async () => source);
 await session.select(folder(), clock, inputs);
 const members = draft.getField('Values').members;
 draft.removeMember('Values', members[0].id); draft.editMember('Values', members[1].id, 'User Bob');
 source = yaml('Values: [Dave, Carol, Ali, Bob]'); await session.refresh();
 assert.deepEqual(draft.getField('Values').value, ['Dave', 'Carol', 'User Bob']);
});

test('source expression members survive static insertions and input changes together', async () => {
 let source = yaml('Values: ["{{title}}", "{{note}}", Ali]');
 const { draft, session } = fixture(async () => source);
 await session.select(folder(), clock, inputs);
 draft.editMember('Values', draft.getField('Values').members[0].id, 'Mine');
 source = yaml('Values: [Carol, "{{title}}", "{{note}}", Ali]'); await session.refresh();
 session.updateInputs({ ...inputs, title: 'Changed', note: 'New note' });
 assert.deepEqual(draft.getField('Values').value, ['Carol', 'Mine', 'New note', 'Ali']);
});

test('inline diagnostic distinguishes exclusions from types which cannot yet be verified', () => {
 const result = ready(yaml('aliases: [a]\nClient: {a: b}\nOther: <% date %>\nUnknown: value\nCount: nope\noperonId: {{operonId}}'));
 assert.deepEqual(result.diagnostics.map(item => item.inline), ['skip', 'skip', 'skip', 'unverified', 'unverified', 'deferred']);
});

test('legacy list interpolation cannot turn an input semicolon into extra members', () => {
 const mapping = { canonicalKey: 'Legacy', visiblePropertyName: 'Legacy', type: 'list' as const, enabled: true, sync: 'auto' as const, isSystem: false };
 const customContext = { ...properties, keyMappings: [...properties.keyMappings, mapping] };
 const result = ready(yaml('Legacy: "{{title}}; Ali"'), { properties: customContext, inputs: { ...inputs, title: 'A; B' } });
 const draft = new TaskCreationDraft(customContext); draft.replaceSource('template', 'A', result.fields);
 assert.deepEqual(draft.getField('Legacy').value, ['A; B', 'Ali']);
});
