import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const temp = await mkdtemp(path.join(tmpdir(), 'operon-repeat-date-filter-'));
after(() => rm(temp, { recursive: true, force: true }));
await build({ stdin: { contents: `
 export * from './src/core/filter-evaluator';
 export { decodeVaultPropertyList, encodeVaultPropertyValue } from './src/core/vault-property-codec';
 export * from './src/ui/field-pickers/automation-date-options';
 export * from './src/ui/field-pickers/datetime-time-grid';
 export { formatCompactDatetimeTime, formatUiTaskDatetime } from './src/core/ui-time-format';
 export { normalizeOperonDateKey } from './src/ui/field-pickers/day-picker';
 export * from './src/ui/field-pickers/date-nlp';
 export { buildReminderRuleCandidates } from './src/ui/field-pickers/reminder-picker-model';
 export { REMINDER_RULE_QUICK_OFFSETS, parseReminderRule, parseReminderOffsetInput } from './src/core/reminder-rules';
 export { formatReminderDisplayItem } from './src/ui/reminder-display';
 export { getVisiblePropertyName } from './src/core/yaml-fields';
 export { appendDatePickerCandidateRow } from './src/ui/field-pickers/date-picker-row';
 export * from './src/ui/task-data-field-picker';
 export { createEmptyQueryRanker } from './src/ui/field-pickers/empty-query-ranking';
 export { getCustomFieldMapping, getCustomFieldLabel, isProjectedCustomFieldType, collectCustomFieldValueCandidates, normalizeCustomFieldRawValue } from './src/ui/custom-field-surfaces';
 export * from './src/core/task-occurrence-date';
 export { parseRepeatRule, calculateNextRepeatDate } from './src/core/repeat-rule';
 export { createFilterPickerTrigger } from './src/ui/field-pickers/filter-condition-picker';
 export { buildInlineTaskCompactChipEntries } from './src/ui/compact-task-layout';
 export { localToday } from './src/core/local-time';
 export { resolveTaskDateTone } from './src/core/task-date-tone';
 export { formatUiDate } from './src/core/ui-date-format';
 export * from './src/core/filter-group-clipboard';
 export * from './src/core/settings-backup-format';
 export { validateOperonSettingsBackupGroupsV1 } from './src/core/settings-backup-group-validation';
 export { DEFAULT_SETTINGS, normalizeFilterSet, cloneFilterSet } from './src/types/settings';
 export { getManagedCustomFieldOptions } from './src/core/managed-task-fields';
 export { getConfiguredKeyMappingIcon } from './src/core/key-mapping-icons';
 export { t } from './src/core/i18n';
 export { buildTableTaskSearchMatcher } from './src/ui/table/table-search';
 export { formatTableDetailedDatetimeValue } from './src/ui/table/table-datetime-format';
 export { createTableValueResolver } from './src/ui/table/table-value-cache';
 export { resolveTableValueCellIcon } from './src/ui/table/table-icon-only-cell';
 export { getTableTaskField, isEditableTableTaskFieldKey } from './src/ui/table/table-field-catalog';
`, resolveDir: root }, outfile: path.join(temp, 'helpers.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const h = await import(pathToFileURL(path.join(temp, 'helpers.mjs')).href);
const editorFile = 'src/ui/filter-condition-editor.ts';
function compile(name, deps = {}, owner = '', sourceFile = editorFile) {
 const file = owner === 'FilterSetModal' ? 'src/ui/filter-set-modal.ts' : owner === 'AutomationActionRow' ? 'src/ui/automation-action-editor.ts' : sourceFile;
 const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const method = Boolean(owner);
 const nodes = method ? ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === owner).members : ast.statements;
 const node = nodes.find(node => node.name?.getText(ast) === name); assert.ok(node, name);
 const declaration = method ? `class Subject { ${node.getText(ast)} }` : node.getText(ast).replace(/^export\s+/u, '');
 const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
 return new Function(...Object.keys(deps), `${js}; return ${method ? `Subject.prototype.${name}` : name};`)(...Object.values(deps));
}
const key = 'repeatOccurrenceDate';
const today = '2026-10-16';
const getFieldOptions = compile('getFieldOptions', {
 t: h.t, PROJECT_SERIAL_SCOPE_FILTER_FIELD: 'projectSerialScope', TASK_DATA_TYPE_FIELD_KEY: '__taskDataType', PLAIN_CHECKBOXES_FILTER_FIELD_KEY: '__plainCheckboxes',
 buildFilterFieldPickerOption: compile('buildFilterFieldPickerOption', { getFilterFieldGroupLabel: group => group, getFilterFieldGroupOrder: () => 0 }),
 getFilterSetFieldPickerMappingCandidates: compile('getFilterSetFieldPickerMappingCandidates', { getManagedCustomFieldOptions: h.getManagedCustomFieldOptions }),
 resolveFilterFieldGroupForMapping: () => 'task', getConfiguredKeyMappingIcon: h.getConfiguredKeyMappingIcon,
 getFilterFieldTypeIcon: compile('getFilterFieldTypeIcon'), compareFilterFieldPickerOptions: compile('compareFilterFieldPickerOptions'),
}, 'FilterFieldCatalog');
const subject = { getPropertyIconSettings: () => h.DEFAULT_SETTINGS, keyMappings: h.DEFAULT_SETTINGS.keyMappings, getFilePropertyFieldOptions: () => [], getFieldOptions, getProjectSerialScopeOptions: () => [] };
const condition = (operator = 'dateIs', value = today) => ({ id: 'condition', field: key, fieldType: 'date', operator, value });
const filter = cond => ({ id: 'reference-filter', name: 'Reference date', rootGroup: { id: 'root', logic: 'all', children: [cond] }, sorts: [], matchLogic: 'all', conditions: [cond] });
const task = (date, repeat = '') => ({ operonId: 'task', description: 'Task', checkbox: 'open', tags: [], primary: { filePath: 'Task.md', format: 'inline', lineNumber: 0 }, fieldValues: { repeat, [key]: date, dateScheduled: today, dateDue: today, dateStarted: today } });
const matches = (cond, candidate, date = today) => h.evaluateFilterSet(filter(cond), [candidate], undefined, undefined, undefined, { today: date }).length === 1;

test('reference date shares the Table label/icon/type in conditions and sorting but not grouping', () => {
 const fields = getFieldOptions.call(subject, true);
 const options = fields.filter(field => field.field === key); assert.equal(options.length, 1);
 const table = h.getTableTaskField(key, h.DEFAULT_SETTINGS);
 assert.deepEqual([options[0].label, options[0].icon, options[0].type, options[0].group], [table.label, 'calendars', 'date', 'scheduling']);
 assert.equal(h.DEFAULT_SETTINGS.keyMappings.find(mapping => mapping.canonicalKey === key).isInternal, true);
 for (const happensOn of [false, true]) assert.equal(getFieldOptions.call(subject, false, happensOn).some(field => field.field === key), false);
 assert.deepEqual(getFieldOptions.call(subject, false, true, true).filter(field => field.field === key), options);
 assert.match(read('src/ui/filter-set-modal.ts'), /const sortFieldOptions = this\.fields\.getFieldOptions\(false, true, true\)/);
 assert.equal(fields.some(field => field.field === 'repeatSeriesId'), false);
});
test('reference date sorts file and inline tasks in both directions and survives settings normalization', () => {
 const tasks = ['2026-10-20','2026-10-01','2026-10-12'].map((date,index) => ({...task(date),operonId:String(index),primary:{...task(date).primary,format:index===1?'file':'inline'}}));
 for(const [order,expected] of [['asc',['1','2','0']],['desc',['0','2','1']]]) {
  const preset = h.normalizeFilterSet({...filter(condition()),sorts:[{field:key,order}]});
  assert.deepEqual(preset.sorts,[{field:key,order}]);
  assert.deepEqual(h.sortTasksBySpecs(tasks,preset.sorts).map(task=>task.operonId),expected);
 }
 assert.deepEqual(tasks.map(task=>task.operonId),['0','1','2']);
});
test('reference date offers the complete existing date operator set', () => {
 assert.deepEqual(h.getOperatorsForField(key, 'date'), h.DATE_OPERATORS);
 assert.deepEqual(h.getOperatorsForField(key, 'date'), h.getOperatorsForField('dateDue', 'date'));
});
const cases = [
 ['dateIs', today, today, '2026-10-15'], ['before', today, '2026-10-15', today], ['after', today, '2026-10-17', today],
 ['isToday', '', today, '2026-10-15'], ['notToday', '', '2026-10-15', today], ['beforeToday', '', '2026-10-15', today], ['afterToday', '', '2026-10-17', today],
 ['exactlyDaysAgo', '2', '2026-10-14', '2026-10-15'], ['exactlyDaysAway', '2', '2026-10-18', '2026-10-17'],
 ['underDaysAgo', '2', '2026-10-14', '2026-10-13'], ['underDaysAway', '2', '2026-10-18', '2026-10-19'],
 ['overDaysAgo', '2', '2026-10-13', '2026-10-14'], ['overDaysAway', '2', '2026-10-19', '2026-10-18'],
 ['thisWeek', '', '2026-10-12', '2026-10-19'], ['lastWeek', '', '2026-10-11', '2026-10-12'], ['nextWeek', '', '2026-10-19', '2026-10-18'],
 ['thisMonth', '', '2026-10-01', '2026-11-01'], ['lastMonth', '', '2026-09-30', '2026-10-01'], ['nextMonth', '', '2026-11-01', '2026-10-31'],
 ['dayOfWeekIs', '5', today, '2026-10-17'], ['dayOfWeekNot', '5', '2026-10-17', today],
 ['monthIs', '10', today, '2026-11-01'], ['monthNot', '10', '2026-11-01', today],
 ['hasAnyValue', '', today, ''], ['hasNoValue', '', '', today],
];
for (const [operator, target, yes, no] of cases) test(`stored reference date: ${operator} matches and excludes boundaries`, () => {
 const cond = condition(operator, target);
 assert.equal(matches(cond, task(yes)), true); assert.equal(matches(cond, task(no)), false);
 for (const repeat of ['', 'mode=schedule|freq=week|interval=1', 'mode=done|freq=day|interval=2']) {
  const candidate = task(yes, repeat), before = JSON.stringify(candidate);
  assert.equal(matches(cond, candidate), true); assert.equal(JSON.stringify(candidate), before);
 }
});
test('missing/empty references never fall back to other task dates or today', () => {
 for (const date of [undefined, '']) for (const repeat of ['', 'mode=done|freq=day|interval=1']) {
  const candidate = task(date, repeat);
  assert.equal(matches(condition('hasNoValue', ''), candidate), true);
  assert.equal(matches(condition('hasAnyValue', ''), candidate), false);
  for (const [operator, value] of cases.filter(row => row[0] !== 'hasNoValue')) assert.equal(matches(condition(operator, value), candidate), false, operator);
 }
});
test('relative date comparisons preserve leap day, year and local DST boundaries', () => {
 for (const [now, stored] of [['2024-03-01', '2024-02-29'], ['2026-01-01', '2025-12-31'], ['2026-03-30', '2026-03-29'], ['2026-10-26', '2026-10-25']]) {
  assert.equal(matches(condition('exactlyDaysAgo', '1'), task(stored), now), true);
 }
 for (const [now, op, expected, outside] of [
  ['2027-01-31', 'nextMonth', '2027-02-28', '2027-03-01'],
  ['2027-03-31', 'lastMonth', '2027-02-01', '2027-03-01'],
  ['2028-01-31', 'nextMonth', '2028-02-29', '2028-03-01'],
  ['2028-03-31', 'lastMonth', '2028-02-29', '2028-03-01'],
  ['2026-12-31', 'nextMonth', '2027-01-01', '2026-12-31'],
  ['2027-01-01', 'lastMonth', '2026-12-31', '2027-01-01'],
 ]) {
  for (const [day, wanted] of [[expected, true], [outside, false]]) {
   assert.equal(matches(condition(op), task(day), now), wanted, [now, op, day].join(' '));
   const timestamp = { ...condition(op), field: 'datetimeCreated', fieldType: 'datetime' };
   const candidate = task(day);
   candidate.fieldValues.datetimeCreated = day + 'T23:59:00';
   assert.equal(matches(timestamp, candidate, now), wanted, [now, op, candidate.fieldValues.datetimeCreated].join(' '));
  }
 }
});
test('condition normalization and clone/reopen preserve key, type, operator and value', () => {
 for (const [operator, value] of cases) {
  const original = filter(condition(operator, value));
  const reopened = h.normalizeFilterSet(JSON.parse(JSON.stringify(h.cloneFilterSet(original))));
  assert.equal(reopened.conditions[0].field, key); assert.equal(reopened.conditions[0].fieldType, 'date');
  assert.equal(reopened.conditions[0].operator, operator); assert.equal(reopened.conditions[0].value ?? '', value);
 }
});
test('group clipboard round-trip is compatible with the actual destination field list', () => {
 const original = filter(condition()).rootGroup;
 let nextId = 0;
 const decoded = h.decodeFilterGroupClipboard(h.encodeFilterGroupClipboard(original), {
  createGroupId: () => `group-${++nextId}`, createConditionId: () => `condition-${++nextId}`,
  isOperatorAllowed: (field, type, operator) => h.getOperatorsForField(field, type).some(option => option.id === operator),
 });
 assert.equal(decoded.ok, true);
 assert.notEqual(decoded.group.id, original.id);
 assert.equal(decoded.group.children[0].field, key); assert.equal(decoded.group.children[0].value, today);
 const compatibility = compile('getFilterGroupPasteCompatibilityIssue', { findFilterGroupPasteCompatibilityIssue: h.findFilterGroupPasteCompatibilityIssue, isFilePropertyColumnKey: () => false }, 'FilterConditionEditor');
 assert.equal(compatibility.call({ options: { fields: subject } }, decoded.group), null);
});
test('settings backup serialization, parsing and validation preserve the date condition', () => {
 const body = JSON.parse(read('scripts/settings-backup-fixtures/representative-body.json'));
 body.groups.filters.data.filterSets = [{ ...filter(condition()), id: body.groups.filters.data.filterSets[0].id }];
 const backup = h.buildOperonSettingsBackupV1(body);
 const parsed = h.parseOperonSettingsBackupV1(h.serializeOperonSettingsBackupV1(backup));
 assert.equal(parsed.ok, true);
 const decoded = h.validateOperonSettingsBackupGroupsV1(parsed.value.body.groups);
 assert.equal(decoded.ok, true, JSON.stringify(decoded.diagnostics));
 const restored = decoded.payloads.filters.filterSets[0];
 assert.equal(restored.conditions[0].field, key); assert.equal(restored.conditions[0].value, today);
 assert.equal(matches(restored.conditions[0], task(today)), true);
});

// Execute real modal render methods with host-only DOM adapters; no live Obsidian control.
class Element {
 children = []; attrs = {}; dataset = {}; events = {}; classes = new Set(); style = {}; textContent = ''; value = '';
 constructor(tag = 'div', options = {}) { this.tag = tag; if (typeof options === 'string') options = { cls: options }; this.addClass(options.cls ?? ''); this.textContent = options.text ?? ''; this.value = options.value ?? ''; }
 createEl(tag, options) { const child = new Element(tag, options); child.parentElement = this; this.children.push(child); return child; }
 createDiv(options) { return this.createEl('div', options); } createSpan(options) { return this.createEl('span', options); }
 addClass(...names) { names.flatMap(name => name.split(' ')).filter(Boolean).forEach(name => this.classes.add(name)); }
 removeClass(...names) { names.forEach(name => this.classes.delete(name)); } toggleClass(name, enabled) { if (enabled) this.addClass(name); else this.removeClass(name); }
 setText(value) { this.textContent = value; } setAttribute(key, value) { this.attrs[key] = value; } removeAttribute(key) { delete this.attrs[key]; }
 empty() { this.children = []; this.textContent = ''; }
 addEventListener(name, cb) { (this.events[name] ??= []).push(cb); }
 trigger(name) { this.fire(name); }
 fire(name) { for (const cb of this.events[name] ?? []) cb({ preventDefault() {}, stopPropagation() {} }); }
 find(predicate) { return [this, ...this.children.flatMap(child => child.find(() => true))].filter(predicate); }
}
function modalHarness(cond = condition()) {
 const root = new Element(), draft = h.cloneFilterSet(filter(cond)), saved = [], popovers = [], fieldPickers = [];
 const state = { ...subject, filterSet: draft, options: { fields: subject, onChange: () => state.syncMirroredFilterFields() }, invalidRawValues: new Map(),
  addClasses: (el, ...names) => el.addClass(...names), renderNodeMoveButtons() {}, renderQuickActions() {},
  measureControlContentWidth: () => 180, measureSelectContentWidth: () => 180,
  getFilterOperatorLabel: option => option.label, getPickerFieldOptions: fields => fields,
  openDateConditionPopover: (input, condition) => popovers.push({ input, condition }),
  createModalSelect: (parent, options, value, onChange) => { const select = parent.createDiv().createEl('select', { value }); select.onChange = onChange; return select; },
  syncMirroredFilterFields: compile('syncMirroredFilterFields', { flattenConditions: compile('flattenConditions', { isFilterGroupNode: node => Array.isArray(node.children) }) }, 'FilterSetModal'),
  hasInvalidTrackedOnCondition: () => false, close() { this.closed = true; }, onSave: value => saved.push(structuredClone(value)),
 };
 const deps = {
  createFilterPickerTrigger: h.createFilterPickerTrigger,
  getPickerFieldOptions: compile('getPickerFieldOptions'), t: h.t, setIcon: (el, icon) => { el.icon = icon; }, bindOperonHoverTooltip() {},
  setAccessibleLabelWithoutTooltip: (el, value) => el.setAttribute('aria-label', value),
  getOperatorsForField: h.getOperatorsForField, NO_VALUE_OPERATORS: h.NO_VALUE_OPERATORS, NUMERIC_INPUT_DATE_OPERATORS: h.NUMERIC_INPUT_DATE_OPERATORS,
  TASK_DATA_TYPE_FIELD_KEY: '__taskDataType', isFilePropertyColumnKey: () => false,
  normalizeFilterDateInput: compile('normalizeFilterDateInput', { CANONICAL_FILTER_DATE_PATTERN: /^(\d{4})-(\d{2})-(\d{2})$/u }),
  showFilterConditionPicker: (el, options) => fieldPickers.push(options),
 };
 compile('renderConditionRow', deps, 'FilterConditionEditor').call(state, root, draft.rootGroup, draft.rootGroup.children[0], 0);
 compile('renderButtons', deps, 'FilterSetModal').call(state, root);
 return { root, state, saved, popovers, fieldPickers, cond: draft.rootGroup.children[0] };
}
test('date operators render the shared date picker, numeric or no-value controls', () => {
 for (const [operator, value] of cases) {
  const { root, popovers, cond } = modalHarness(condition(operator, value));
  const inputs = root.find(el => el.tag === 'input');
  if (h.NO_VALUE_OPERATORS.has(operator)) { assert.equal(inputs.length, 0, operator); continue; }
  assert.equal(inputs.length, 1, operator); const input = inputs[0];
  if (h.NUMERIC_INPUT_DATE_OPERATORS.has(operator)) {
   assert.equal(input.type, 'number'); input.value = '2'; input.fire('input'); assert.equal(cond.value, '2');
  } else {
   assert.equal(input.type, 'text'); assert.equal(input.classes.has('operon-filter-date-popover-input'), true);
   input.fire('click'); assert.equal(popovers[0].condition, cond);
   input.value = '2026-11-01'; input.fire('input'); assert.equal(cond.value, '2026-11-01');
  }
 }
});
test('fixed filter dates and automation values use the standard picker and retain its canonical selection', () => {
 const settings = { ...h.DEFAULT_SETTINGS, calendarWeekStart: 1, calendarSidebarShowWeekNumbers: true };
 const opened = [];
 const pick = (_el, options) => opened.push(options);
 const openFilterDate = compile('openDateConditionPopover', { showDatePicker: pick, normalizeFilterDateInput: v => v || null }, 'FilterConditionEditor');
 const candidates = h.buildDatePickerCandidates(undefined, '', { fieldKey: 'dateScheduled', language: 'en', referenceDate: new Date(2026, 9, 16, 12) });
 const tomorrow = candidates.quick.find(entry => entry.primaryLabel === 'Tomorrow').isoDate;
 assert.equal(tomorrow, '2026-10-17');
 assert.equal(h.buildDatePickerCandidates(undefined, 'tomorrow', {fieldKey:'dateScheduled',language:'en',referenceDate:new Date(2026,9,16,12)}).parsed[0].isoDate, tomorrow);
 for (const field of ['dateScheduled', 'customDate', 'trackedOn', 'action']) {
  const draft = condition('dateIs', today), root = new Element();
  let changes = 0, input;
  const changed = () => { changes++; };
  const state = { options: {onChange: changed}, getPickerSettings: () => settings, getFilterOperatorLabel: () => 'date',
   openDateConditionPopover: openFilterDate };
  if (field === 'action') {
   draft.field = 'dateScheduled';
   compile('renderValue', { actionType: () => 'date', t: h.t, isFilePropertyColumnKey: () => false, showDatePicker: pick }, 'AutomationActionRow').call({
    action: draft, valueHost: root, ctx: {settings: () => settings, changed}, syncType() {},
   });
   input = root.children[0];
  } else if (field === 'trackedOn') {
   draft.field = field;
   compile('renderTrackedOnValue', {isValidTrackedOnCondition: () => true, DATE_OPERATORS: h.DATE_OPERATORS, t:h.t,
    setAccessibleLabelWithoutTooltip() {}}, 'FilterConditionEditor').call(state, root, draft);
   input = root.children[0];
  } else {
   draft.field = field;
   const row = modalHarness(draft);
   input = row.root.find(el => el.tag === 'input')[0];
   row.state.openDateConditionPopover = openFilterDate;
   row.state.getPickerSettings = () => settings;
   row.state.options.onChange = () => { draft.value = row.cond.value; changed(); };
  }
  const count = opened.length;
  input.fire('focus'); input.fire('click');
  assert.equal(opened.length, count+1);
  const options = opened.at(-1);
  assert.equal(options.fieldKey, draft.field);
  assert.equal(options.value, today);
  assert.equal(options.dateDisplayFormat, settings.dateDisplayFormat);
  assert.deepEqual(options.manualDatePicker, {weekStart:1, showWeekNumbers:true});
  options.onClose(); assert.equal(changes, 0);
  input.fire('click'); opened.at(-1).onSelect(tomorrow); opened.at(-1).onClose();
  assert.equal(draft.value, tomorrow); assert.equal(changes, 1);
  input.fire('click'); assert.equal(opened.at(-1).value, tomorrow); opened.at(-1).onRemove(); opened.at(-1).onClose();
  assert.ok(!draft.value); assert.equal(changes, 2);
 }
 const nextDay = '2026-10-17', candidate = task(tomorrow);
 assert.equal(matches(condition('dateIs', tomorrow), candidate, nextDay), true);
 assert.equal(matches(condition('exactlyDaysAway','1'), candidate, today), true);
 assert.equal(matches(condition('exactlyDaysAway','1'), candidate, nextDay), false);
});
test('choosing the new condition sets date type and exposes date operators', () => {
 const { root, cond, fieldPickers } = modalHarness({ id: 'condition', field: 'description', fieldType: 'text', operator: 'contains', value: 'old' });
 root.find(el => el.classes.has('operon-condition-field-picker-trigger'))[0].fire('click');
 const picker = fieldPickers[0], option = picker.fields.find(field => field.field === key);
 picker.onSelect(option);
 assert.equal(cond.field, key); assert.equal(cond.fieldType, 'date'); assert.equal(cond.operator, 'dateIs'); assert.equal(cond.value, undefined);
 const operators = root.find(el => el.tag === 'option').map(el => el.value);
 assert.deepEqual(operators, h.DATE_OPERATORS.map(option => option.id));
});
test('modal Save persists the date condition; Cancel leaves the original filter unchanged', () => {
 for (const save of [false, true]) {
  const original = condition(), before = structuredClone(original);
  const { root, saved, state, cond } = modalHarness(original); cond.value = '2026-11-01';
  const button = root.find(el => el.tag === 'button' && el.textContent === h.t('buttons', save ? 'save' : 'cancel'))[0];
  button.fire('click'); assert.equal(state.closed, true); assert.deepEqual(original, before);
  assert.equal(saved.length, save ? 1 : 0);
  if (save) { const reopened = h.normalizeFilterSet(saved[0]); assert.equal(reopened.conditions[0].value, '2026-11-01'); assert.equal(reopened.conditions[0].field, key); }
 }
});

const occurrenceCondition = (operator = 'dateIs', value = today) => ({ ...condition(operator, value), field: 'taskOccurrenceDate' });
const recurring = (anchor, repeat = 'mode=schedule|freq=day|interval=1') => task(anchor, repeat);
const occurrenceMatches = (candidate, operator, value, options = {}) => h.evaluateFilterSet(filter(occurrenceCondition(operator, value)), [candidate], undefined, undefined, undefined, { today, ...options }).length === 1;

test('occurrence option is date condition/sort only, with its own label and full date operators', () => {
 for (const args of [[true], [false, true, true]]) {
  const fields = getFieldOptions.call(subject, ...args).filter(f => f.field === 'taskOccurrenceDate');
  assert.equal(fields.length, 1); assert.equal(fields[0].label, 'Task Occurrence Date'); assert.equal(fields[0].type, 'date');
 }
 assert.equal(getFieldOptions.call(subject, false, true).some(f => f.field === 'taskOccurrenceDate'), false);
 assert.deepEqual(h.getOperatorsForField('taskOccurrenceDate', 'date'), h.DATE_OPERATORS);
});
function previousDay(date) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
for (const [operator, target, yes, no] of cases) test(`stored occurrence: ${operator} uses existing date boundaries`, () => {
 const make = date => date ? recurring(date) : task('');
 assert.equal(occurrenceMatches(make(yes), operator, target), true);
 assert.equal(occurrenceMatches(make(no), operator, target), false);
});
test('materialized chip date stays fixed across skip, end, count, done and rule changes', () => {
 const base = recurring('2026-10-09', 'mode=schedule|freq=week|interval=1|days=we,fr');
 base.fieldValues.repeatSeriesId = 'series';
 for (const extra of [{}, {datetimeRepeatEnd:'2026-10-08'}, {repeat:'mode=done|freq=day|interval=1'},
  {repeat:'mode=count|freq=day|interval=1|count=1'}, {repeat:'mode=count|freq=day|interval=1|count=2'},
  {repeat:'mode=schedule|freq=month|interval=3|monthdays=1'}, {repeat:'nonsense'}, {dateCompleted:'2026-10-10'}, {dateCancelled:'2026-10-10'}]) {
  const fields = Object.freeze({...base.fieldValues,...extra});
  const resolver = () => { throw new Error('Stored occurrence must not read series skips'); };
  assert.equal(h.getTaskOccurrenceDate(fields),'2026-10-09');
  const settings={...h.DEFAULT_SETTINGS,dateDisplayFormat:'DD/MM/YYYY'};
  const chip=h.buildInlineTaskCompactChipEntries(fields,[],settings,[],[{key:'repeat',visible:true}],undefined,{repeatSkipDateResolver:resolver}).find(e=>e.key==='repeat');
  assert.ok(chip); assert.equal(chip.tooltipTitle,'Recurrence Rule'); assert.ok(chip.tooltipContent.length>0);
  assert.equal(chip.label,h.formatUiDate('2026-10-09',settings));
  assert.equal(occurrenceMatches({...base,fieldValues:fields},'dateIs','2026-10-09',{getRepeatSkipDates:resolver}),true);
 }
 assert.equal(occurrenceMatches(base,'beforeToday',''),true);
 assert.equal(base.fieldValues.repeatOccurrenceDate,'2026-10-09');
});
test('missing or invalid stored dates do not invent a date from scheduled, due or creation fields', () => {
 for (const repeatOccurrenceDate of ['', 'invalid', '2026-02-30', '2025-02-29', '2026-13-01', '2026-10-09T10:30:00']) {
  const fields=Object.freeze({repeat:'mode=schedule|freq=day|interval=1',repeatOccurrenceDate,
   dateScheduled:'2026-10-20',dateDue:'2026-10-21',dateStarted:'2026-10-22',datetimeStart:'2026-10-23T10:00:00',
   datetimeEnd:'2026-10-23T11:00:00',datetimeCreated:'2026-10-24T10:00:00'});
  assert.equal(h.getTaskOccurrenceDate(fields),'');
  assert.equal(occurrenceMatches({...task(''),fieldValues:fields},'hasNoValue',''),true);
  const chip=h.buildInlineTaskCompactChipEntries(fields,[],h.DEFAULT_SETTINGS,[],[{key:'repeat',visible:true}])[0];
  assert.equal(chip.label,'No occurrence date'); assert.equal(chip.iconTone,'default');
  assert.equal(h.createTableValueResolver([{...task(''),fieldValues:fields}],h.DEFAULT_SETTINGS).getRawValue({...task(''),fieldValues:fields},'taskOccurrenceDate'),'');
 }
 assert.equal(h.getTaskOccurrenceDate({}),'');
 assert.equal(h.getTaskOccurrenceDate({repeatOccurrenceDate:'2024-02-29'}),'2024-02-29');
 assert.equal(h.getTaskOccurrenceDate({repeatOccurrenceDate:' 2026-10-09 '}),'2026-10-09');
});
test('file/inline sorting reads the stored occurrence, ignores pseudo-values and does not consult skips', () => {
 const tasks=Array.from({length:30},(_,i)=>({...recurring(`2026-10-${String(30-i).padStart(2,'0')}`),operonId:String(i)}));
 let reads=0;
 for(const [i,t] of tasks.entries()) {
  t.primary.format=i%2?'file':'inline';t.fieldValues.repeatSeriesId='s';t.fieldValues.taskOccurrenceDate='1900-01-01';
  const value=t.fieldValues.repeatOccurrenceDate;
  Object.defineProperty(t.fieldValues,'repeatOccurrenceDate',{get:()=>{reads++;return value;},enumerable:true});
 }
 const before=JSON.stringify(tasks);
 const options={getRepeatSkipDates:()=>{throw new Error('Unexpected skip lookup');}};
 for(const order of ['asc','desc']) {
  reads=0; const result=h.sortTasksBySpecs(tasks,[{field:'taskOccurrenceDate',order}],options);
  assert.equal(reads,tasks.length);
  assert.equal(result[0].operonId,order==='asc'?'29':'0');
 }
 assert.equal(JSON.stringify(tasks),before);
 const t=tasks[29];
 assert.equal(occurrenceMatches(t,'dateIs','2026-10-01',options),true);
 assert.equal(occurrenceMatches(t,'dateIs','2026-10-02',options),false);
});
test('computed field survives normalization, grouped sorting and backup round-trip alongside reference', () => {
 const cond=occurrenceCondition('hasAnyValue','');
 const fs=h.normalizeFilterSet({...filter(cond),sorts:[{field:'taskOccurrenceDate',order:'desc'},{field:'repeatOccurrenceDate',order:'asc'}]});
 const body=JSON.parse(read('scripts/settings-backup-fixtures/representative-body.json'));
 fs.id=body.groups.filters.data.filterSets[0].id;
 body.groups.filters.data.filterSets=[JSON.parse(JSON.stringify(fs))];
 const parsed=h.parseOperonSettingsBackupV1(h.serializeOperonSettingsBackupV1(h.buildOperonSettingsBackupV1(body)));
 assert.equal(parsed.ok,true);const decoded=h.validateOperonSettingsBackupGroupsV1(parsed.value.body.groups);assert.equal(decoded.ok,true,JSON.stringify(decoded.diagnostics));
 const restored=decoded.payloads.filters.filterSets[0];assert.deepEqual(restored.sorts,fs.sorts);assert.equal(restored.conditions[0].field,'taskOccurrenceDate');
 const candidates=[{...recurring('2026-10-01'),operonId:'early'},{...recurring('2026-10-02'),operonId:'late'}];
 assert.deepEqual(h.evaluateFilterSet(restored,candidates).map(t=>t.operonId),['late','early']);
});

test('repeat chip date tone matches Scheduled for past/today/future and terminal tasks', () => {
 const today=h.localToday();const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
 for(const date of [previousDay(today),today,tomorrow.toISOString().slice(0,10)]) for(const terminal of [{},{dateCompleted:today},{dateCancelled:today}]) {
  const fields={repeat:'mode=schedule|freq=day|interval=1',repeatOccurrenceDate:date,...terminal};
  const chip=h.buildInlineTaskCompactChipEntries(fields,[],h.DEFAULT_SETTINGS,[],[{key:'repeat',visible:true}])[0];
  assert.equal(chip.iconTone,h.resolveTaskDateTone('dateScheduled',date,fields));
  assert.equal(chip.iconTone,Object.keys(terminal).length?'default':date<today?'overdue':date===today?'today':'default');
 }
});


test('task occurrence Table column keeps the repeat picker and reads its own stored date', () => {
 const field = h.getTableTaskField('taskOccurrenceDate', h.DEFAULT_SETTINGS);
 assert.equal(field.label, 'Task Occurrence Date'); assert.equal(field.icon, 'repeat'); assert.equal(field.type, 'date'); assert.equal(field.readonly, true);
 assert.equal(h.isEditableTableTaskFieldKey('taskOccurrenceDate', h.DEFAULT_SETTINGS), true);
 for (const file of ['src/ui/table/operon-table-view.ts', 'src/ui/embed-table-processor.ts']) {
  assert.ok(read(file).includes("canonicalKey: key === 'repeatOccurrenceDate' || key === 'taskOccurrenceDate' ? 'repeat' : key,"));
 }
 assert.equal(h.resolveTableValueCellIcon('taskOccurrenceDate', '2026-10-16', h.DEFAULT_SETTINGS, field.icon), 'repeat');
 assert.equal(h.getTableTaskField('repeatOccurrenceDate', h.DEFAULT_SETTINGS).icon, 'calendars');
 const candidate = task('2026-10-09', 'mode=schedule|freq=week|interval=1|days=we,fr');
 candidate.fieldValues.repeatSeriesId = 'series';
 let calls = 0;
 const resolver = h.createTableValueResolver([candidate], h.DEFAULT_SETTINGS, { getRepeatSkipDates: () => { calls++; return ['2026-10-14']; } });
 assert.equal(resolver.getRawValue(candidate, 'taskOccurrenceDate'), '2026-10-09');
 assert.equal(resolver.getRawValue(candidate, 'taskOccurrenceDate'), '2026-10-09');
 assert.equal(calls, 0);
 assert.equal(resolver.getRawValue(candidate, 'repeatOccurrenceDate'), '2026-10-09');
});

test('task occurrence Table icon follows Scheduled tone including terminal tasks', () => {
 for (const date of ['2000-01-01', h.localToday(), '2099-01-01', '']) {
  for (const fields of [{}, {dateCompleted: '2026-01-01'}, {dateCancelled: '2026-01-01'}]) {
   assert.equal(h.resolveTaskDateTone('taskOccurrenceDate', date, fields), h.resolveTaskDateTone('dateScheduled', date, fields));
  }
 }
});


test('Table occurrence search and date formatting use the materialized date', () => {
 const candidate = task('2026-10-09', 'mode=schedule|freq=week|interval=1|days=we,fr');
 candidate.fieldValues.repeatSeriesId = 'series';
 const matcher = h.buildTableTaskSearchMatcher([candidate], h.DEFAULT_SETTINGS, [{key:'taskOccurrenceDate'}], {getRepeatSkipDates: () => ['2026-10-14']});
 assert.equal(matcher(candidate, '2026-10-09'), true);
 assert.equal(matcher(candidate, '2026-10-14'), false);
 const settings = {...h.DEFAULT_SETTINGS, dateDisplayFormat:'DD/MM/YYYY'};
 assert.equal(h.formatTableDetailedDatetimeValue('taskOccurrenceDate', '2026-10-16', settings), h.formatTableDetailedDatetimeValue('repeatOccurrenceDate', '2026-10-16', settings));
});

// A long interval made the old forecast hide an already missed materialized task.
test('missed materialized task remains overdue even when the successor is in the future', () => {
 const candidate=recurring('2026-10-09','mode=schedule|freq=month|interval=1|monthdays=9');
 assert.equal(occurrenceMatches(candidate,'beforeToday',''),true);
 assert.equal(occurrenceMatches(candidate,'dateIs','2026-11-09'),false);
 assert.equal(h.createTableValueResolver([candidate],h.DEFAULT_SETTINGS).getRawValue(candidate,'taskOccurrenceDate'),'2026-10-09');
 const chip=h.buildInlineTaskCompactChipEntries(candidate.fieldValues,[],h.DEFAULT_SETTINGS,[],[{key:'repeat',visible:true}])[0];
 assert.equal(chip.label,h.formatUiDate('2026-10-09',h.DEFAULT_SETTINGS));
 // The engine still computes a successor; changing its display must not change recurrence.
 assert.equal(h.calculateNextRepeatDate(h.parseRepeatRule(candidate.fieldValues.repeat),{anchorDate:'2026-10-09'}),'2026-11-09');
});

test('overdue plus open-state filter returns only the missed materialized task', () => {
 const dateCondition=occurrenceCondition('beforeToday','');
 const stateCondition={id:'state',field:'checkbox',fieldType:'checkbox',operator:'isOpen'};
 const fs=filter(dateCondition);fs.rootGroup.children.push(stateCondition);fs.conditions.push(stateCondition);
 const candidates=[
  {...recurring('2026-10-09'),operonId:'missed'},
  {...recurring('2026-10-09'),operonId:'completed',checkbox:'done'},
  {...recurring('2026-10-09'),operonId:'cancelled',checkbox:'cancelled'},
  {...recurring('2026-10-30'),operonId:'future'},
  {...recurring(''),operonId:'undated'},
 ];
 for(const candidate of candidates) candidate.fieldValues.repeatSeriesId='same-series';
 assert.deepEqual(h.evaluateFilterSet(fs,candidates,undefined,undefined,undefined,{today}).map(t=>t.operonId),['missed']);
 const resolver=h.createTableValueResolver(candidates,h.DEFAULT_SETTINGS);
 assert.equal(resolver.getRawValue(candidates[0],'taskOccurrenceDate'),'2026-10-09');
 assert.equal(resolver.getRawValue(candidates[3],'taskOccurrenceDate'),'2026-10-30');
});

 class PickerElement extends Element {
  classList = { add: name => this.addClass(name), remove: name => this.removeClass(name), contains: name => this.classes.has(name), toggle: (name, enabled) => this.toggleClass(name, enabled) };
  createEl(tag, options) { const child = new PickerElement(tag, options); this.children.push(child); return child; }
  appendChild(child) { if (!this.children.includes(child)) this.children.push(child); }
  ownerDocument = { defaultView: { requestAnimationFrame() {} } };
  setSelectionRange() {}
  querySelector() { return null; }
  replaceChildren() { this.empty(); }
  key(key) { for (const cb of this.events.keydown ?? []) cb({ key, preventDefault() {} }); }
 }

test('Date Action picker commits the selected meaning by mouse or keyboard and reopens the saved value', () => {
 const file = 'src/ui/field-pickers/date-picker.ts';
 let calendar, panel;
 const showDatePicker = compile('showDatePicker', {
  ...h, window: { requestAnimationFrame() {} }, resolvePickerApp() {}, getAppLocale: () => 'en',
  joinDatePickerClasses: (...names) => names.filter(Boolean).join(' '), baseDatePickerClass: name => name,
  createFloatingPanel: (_anchor, _classes, onClose) => {
   panel = new PickerElement();
   return { panel, close: onClose };
  },
  renderOperonDayPicker: (_host, options) => { calendar = options; return { setFocusedDate() {} }; },
  normalizeManualDateValue: value => h.normalizeOperonDateKey(value) ?? '',
  formatDatePickerInputDisplay: value => value,
 }, '', file);
 const render = compile('renderValue', { ...h, actionType: () => 'date', isFilePropertyColumnKey: () => false,
  resolveDatePickerLanguage: () => 'en', showDatePicker }, 'AutomationActionRow');
 for (const field of ['dateScheduled', 'file.property:Milestone']) {
  const action = { field, value: '' };
  const reopen = () => {
   const host = new PickerElement();
   render.call({ action, valueHost: host, ctx: { settings: () => h.DEFAULT_SETTINGS, changed() {} }, syncType() {} });
   const input = host.children[0];
   input.fire('focus');
   const query = panel.children[0];
   const type = value => { query.value = value; query.fire('input'); };
   assert.equal(calendar.showToday, false);
   return {input, query, type, buttons: () => panel.find(el => el.tag === 'button')};
  };
  let ui = reopen();
  ui.type('Tom');
  assert.deepEqual(ui.buttons().map(b => b.children[0]?.textContent), ['Tomorrow']);
  ui.buttons()[0].fire('mousedown');
  assert.equal(action.value, 'tomorrow');
  assert.equal(action.valueEncoding, 'relative-day-v1');
  ui = reopen();
  assert.equal(ui.input.value, 'Tomorrow');
  assert.equal(ui.query.value, 'Tomorrow');
  for (const [query, expected] of [['Next weekend','nextWeekend'], ['3 days from now','offsetDays:3'], ['1 w','weeks:1']]) {
   ui.type(query); ui.query.key('Enter');
   assert.equal(action.value, expected);
   ui = reopen();
  }
  ui.type('3');
  assert.deepEqual(ui.buttons().map(b => b.children[0].textContent), [
   '3 days from now', '3 weeks from now', '3 months from now', '3 days ago', '3 weeks ago', '3 months ago',
  ]);
  assert.ok(ui.buttons().every(b => b.children.length === 3));
  ui.buttons()[2].fire('mousedown');
  assert.equal(action.value, 'months:3');
  ui = reopen();
  assert.equal(ui.input.value, '3 months from now');
  calendar.onSelect('2026-11-23');
  assert.equal(action.value, '2026-11-23');
  assert.equal(action.valueEncoding, undefined);
  ui = reopen();
  assert.ok(ui.buttons().every(button => button.children[1].textContent !== action.value));
  ui.type('2026-12-04'); ui.query.key('Enter');
  assert.equal(action.value, '2026-12-04');
  assert.equal(action.valueEncoding, undefined);
  ui = reopen();
  ui.type('Tom'); ui.query.key('Enter');
  assert.equal(action.valueEncoding, 'relative-day-v1');
  reopen(); calendar.onClear();
  assert.equal(action.value, '');
  assert.equal(action.valueEncoding, undefined);
 }
});

test('Datetime Actions keep the day expression and wall time independent through the picker and editor', () => {
 const file = 'src/ui/field-pickers/datetime-picker.ts';
 let panel, calendar, timeBinding;
 const deps = { ...h,
  resolvePickerApp() {}, getAppLocale: () => 'en-US', resolveDatePickerLanguage: () => 'en',
  createButton: (text, cls, el) => el.createEl('button', {text, cls}),
  formatDatePickerInputDisplay: date => date, focusFloatingInput() {}, scrollChildIntoView() {},
  joinDatetimePickerClasses: (...names) => names.filter(Boolean).join(' '), baseDatetimePickerClass: name => name,
  bindTimeInput: (_el, binding) => { timeBinding = binding; },
  renderOperonDayPicker: (_el, opts) => { calendar = opts; return { setSelectedDate() {}, setFocusedDate() {} }; },
  createFloatingPanel: (_anchor, _cls, onClose) => { panel = new PickerElement(); return {panel, close: onClose}; },
  isDatetimePickerRejection: () => false,
 };
 const renderDatetimePickerContent = compile('renderDatetimePickerContent', deps, '', file);
 const showDatetimePicker = compile('showDatetimePicker', {...deps, renderDatetimePickerContent}, '', file);
 const render = compile('renderValue', {...deps, showDatetimePicker, actionType: field => field === 'reminderDatetimes' ? 'list' : 'datetime',
  isFilePropertyColumnKey: () => false}, 'AutomationActionRow');
 for (const timeFormat of ['12h', '24h']) {
  for (const field of ['datetimeStart', 'file.property:Meeting', 'reminderDatetimes']) {
   const fixed = value => field === 'reminderDatetimes' ? [value] : value;
   const action = {field, value: '2026-11-23T14:45:00'};
   const reopen = () => {
    const host = new PickerElement();
    render.call({ action, valueHost: host, ctx: { settings: () => ({...h.DEFAULT_SETTINGS, timeFormat}), changed() {} }, syncType() {} });
    const row = host.children[0];
    row.fire('focus');
    const [query, time] = panel.find(el => el.tag === 'input');
    const type = value => { query.value = value; query.fire('input'); };
    const button = label => panel.find(el => el.tag === 'button' && (el.textContent === label || el.children[0]?.textContent === label))[0];
    return {row, query, time, type, button};
   };
   action.value = '2026-11-23T14:45:31';
   let ui = reopen();
   calendar.onSelect('2026-11-25'); ui.time.key('Enter');
   assert.deepEqual(action.value, fixed('2026-11-25T14:45:31'));
   ui = reopen();
   ui.type('Tom'); ui.button('Tomorrow').fire('mousedown'); ui.time.key('Enter');
   assert.equal(action.value, 'tomorrow@14:45');
   assert.equal(action.valueEncoding, 'relative-day-v1');
   ui = reopen();
   assert.equal(ui.row.value, timeFormat === '12h' ? 'Tomorrow · 2:45 PM' : 'Tomorrow · 14:45');
   assert.equal(ui.query.value, 'Tomorrow');
   timeBinding.onChange(timeFormat === '12h' ? '1200' : '0000', 5);
   if (timeFormat === '12h') ui.button(h.t('taskEditor','datetimeAm')).fire('click');
   ui.time.key('Enter');
   assert.equal(action.value, 'tomorrow@00:00');
   ui = reopen();
   assert.equal(ui.row.value, timeFormat === '12h' ? 'Tomorrow · 12:00 AM' : 'Tomorrow · 00:00');
   timeBinding.onChange('1200', 5);
   if (timeFormat === '12h') ui.button(h.t('taskEditor','datetimePm')).fire('click');
   ui.time.key('Enter');
   assert.equal(action.value, 'tomorrow@12:00');
   ui = reopen();
   assert.equal(ui.row.value, timeFormat === '12h' ? 'Tomorrow · 12:00 PM' : 'Tomorrow · 12:00');
   calendar.onSelect('2026-12-02'); ui.time.key('Enter');
   assert.deepEqual(action.value, fixed('2026-12-02T12:00:00'));
   assert.equal(action.valueEncoding, undefined);
   ui = reopen();
   ui.type('3'); ui.button('3 months ago').fire('mousedown'); ui.time.key('Enter');
   assert.equal(action.value, 'months:-3@12:00');
   ui = reopen(); ui.type('2026-12-24'); ui.query.key('Enter'); ui.time.key('Enter');
   assert.deepEqual(action.value, fixed('2026-12-24T12:00:00'));
   assert.equal(action.valueEncoding, undefined);
   ui = reopen(); ui.button('Clear').fire('click'); assert.equal(action.value, '');
  }
 }
});


test('ReminderRules action row uses the reminder picker with five selectable anchors independently of task dates', () => {
 const file = 'src/ui/field-pickers/reminder-picker.ts';
 let panel;
 const deps = { ...h, createButton: (text, cls, host) => host.createEl('button', {text, cls}), nextReminderRulesPickerId: () => 1, requestFloatingInputFocus() {}, scrollChildIntoView() {},
  bindPickerListItemActivation: (button, cb) => button.addEventListener('click', cb),
  createFloatingPanel: (_anchor, _classes, onClose) => { panel = new PickerElement(); return { panel, close: onClose }; },
  setRuleDiagnostic: compile('setRuleDiagnostic', {}, '', file),
  getAnchorLabel: compile('getAnchorLabel', h, '', file),
 };
 deps.formatRuleCandidateLabel = compile('formatRuleCandidateLabel', deps, '', file);
 const picker = compile('showReminderRulesPicker', deps, '', file);
 const render = compile('renderValue', {...h, showReminderRulesPicker: picker, actionType: () => 'list', automationTypedListMapping: () => null}, 'AutomationActionRow');
 const host = new PickerElement(), action = { field: 'reminderRules', operation: 'remove', value: '' };
 render.call({ action, valueHost: host, ctx: { settings: () => h.DEFAULT_SETTINGS, changed() {} }, syncType() {} });
 const open = () => host.children[0].fire('click');
 const options = () => panel.find(el => el.attrs.role === 'option');
 open();
 assert.equal(options().length, 5);
 assert.ok(options().every(el => !el.disabled && el.children.length === 1));
 panel.find(el => el.attrs['data-offset'] === '30m')[0].fire('click');
 options()[4].fire('click');
 assert.deepEqual(action.value, ['dateDue.30m']);
 open();
 const input = panel.find(el => el.tag === 'input')[0];
 assert.equal(input.value, '30m');
 assert.equal(options()[4].attrs['aria-selected'], 'true');
 input.value = 'invalid'; input.fire('input');
 assert.equal(options().length, 0);
 input.value = '1h 15m'; input.fire('input'); input.key('Enter');
 assert.deepEqual(action.value, ['dateDue.1h15m']);
 open(); panel.find(el => el.tag === 'button' && el.textContent === h.t('buttons', 'clear'))[0].fire('click');
 assert.deepEqual(action.value, []);
});

test('dependency Actions search by title or ID, replace one member and reopen with its title', () => {
 const file = 'src/ui/field-pickers/dependency-task-picker.ts';
 const scoreDependencyMatch = compile('scoreDependencyMatch', {}, '', file);
 let panel;
 class DependencyElement extends PickerElement {
  style = { removeProperty() {}, setProperty() {} };
  createEl(tag, options) { const child = new DependencyElement(tag, options); this.children.push(child); return child; }
 }
 const picker = compile('showDependencyTaskPicker', {
  ...h, PAGE_SIZE: 20, buildCandidates: compile('buildCandidates', {}, '', file),
  rankCandidates: compile('rankCandidates', { scoreDependencyMatch }, '', file),
  splitTaskListValue: value => value ? value.split('; ') : [],
  normalizeDependencyPair: compile('normalizeDependencyPair', {splitTaskListValue: () => []}, '', 'src/core/task-field-patch.ts'),
  createFloatingPanel: (_anchor, _classes, close) => { panel = new DependencyElement(); return { panel, close }; },
  createButton: (text, cls, host) => host.createEl('button', {text, cls}),
  requestFloatingInputFocus() {}, scrollChildIntoView() {}, setAccessibleLabelWithoutTooltip() {},
  resolveBlockedByVisualStateForId() {}, resolveBlockedByVisualStateColor() {}, setIcon() {},
  renderCompactTaskMarkdown: (host, options) => host.setText(options.value),
  bindPickerListItemActivation: (el, cb) => el.addEventListener('click', cb),
 }, '', file);
 const render = compile('renderValue', {...h, actionType: () => 'list', automationTypedListMapping: () => null,
  showDependencyTaskPicker: picker}, 'AutomationActionRow');
 const initialTasks = ['old', 'first', 'second'].map((id, i) => ({...task(today), operonId: id, description: i ? 'Twin title' : 'Original'}));
 for (const field of ['blocking', 'blockedBy']) for (const operation of ['add', 'remove']) {
  let tasks = initialTasks;
  const listeners = new Set();
  const subscribeIndexUpdates = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const action = { field, operation, value: ['old'] };
  const row = draft => {
   const host = new DependencyElement();
   render.call({action: draft, valueHost: host, ctx: {tasks: () => tasks, subscribeIndexUpdates, settings: () => h.DEFAULT_SETTINGS, changed() {}}, syncType() {}});
   return host.children[0];
  };
  const button = row(action);
  assert.match(button.attrs['aria-label'], /Original/);
  button.fire('click');
  const input = panel.find(el => el.tag === 'input')[0];
  input.value = 'Twin'; input.fire('input');
  assert.equal(panel.find(el => el.textContent === 'Twin title').length, 2);
  tasks = [
   ...tasks.map(task => task.operonId === 'second' ? {...task, description: 'Renamed task'} : task),
   {...tasks[0], operonId: 'new-id', description: 'New task'},
  ];
  for (const listener of listeners) listener();
  assert.equal(panel.find(el => el.textContent === 'Twin title').length, 1);
  for (const [query, title] of [['New task', 'New task'], ['new-id', 'New task'], ['Renamed task', 'Renamed task'], ['second', 'Renamed task']]) {
   input.value = query; input.fire('input');
   assert.equal(panel.find(el => el.textContent === title).length, 1);
  }
  input.key('Enter');
  assert.equal(listeners.size, 0);
  assert.deepEqual(action, {field, operation, value: ['second']});
  assert.match(row(JSON.parse(JSON.stringify(action))).attrs['aria-label'], /Renamed task/);
  assert.match(row({...action, value: ['missing-id']}).attrs['aria-label'], /missing-id/);
 }
});

test('Actions route task type, image and gallery through the Creator pickers', () => {
 const file = 'src/ui/task-field-picker-dispatch.ts';
 let picker;
 const capture = (_anchor, options) => { picker = options; return () => {}; };
 const openManagedTaskDataFieldPicker = compile('openManagedTaskDataFieldPicker', {
  ...h, showCustomTextFieldPicker: capture, showCustomListFieldPicker: capture,
 }, '', file);
 const openTaskFieldPicker = compile('openTaskFieldPicker', { openManagedTaskDataFieldPicker }, '', file);
 for (const field of ['taskType', 'taskImage', 'taskGallery']) {
  const gallery = field === 'taskGallery';
  const type = gallery ? 'list' : 'text';
  const action = { field, operation: 'add', value: gallery ? ['old.png'] : 'old' };
  const candidate = field === 'taskType' ? 'Project' : 'image.png';
  const tasks = [{...task(today), fieldValues: {[field]: candidate}}];
  const render = compile('renderValue', {...h, actionType: () => type, openTaskFieldPicker, automationTypedListMapping: () => null}, 'AutomationActionRow');
  const host = new PickerElement();
  render.call({ action, valueHost: host, ctx: {settings: () => h.DEFAULT_SETTINGS, tasks: () => tasks, changed() {}}, syncType() {} });
  host.children[0].fire('click');
  assert.equal(picker.canonicalKey, field);
  assert.equal(picker.mediaReference, field !== 'taskType');
  assert.ok(picker.candidates.includes(candidate));
  if (gallery) {
   assert.equal(picker.singleValue, true);
   assert.deepEqual(picker.value, ['old.png']);
   picker.onCommitValues(field, ['album; cover.png']);
   assert.deepEqual(action.value, ['album; cover.png']);
  } else {
   const newValue = field === 'taskType' ? 'New type' : '[[New cover.png]]';
   picker.onCommit(field, newValue);
   assert.equal(action.value, newValue);
  }
 }
});

test('custom text and number Actions open Creator pickers with the saved value', () => {
 const source = 'src/ui/task-field-picker-dispatch.ts';
 let picker;
 const capture = (_anchor, options) => { picker = options; return () => {}; };
 const openCustomTaskFieldPicker = compile('openCustomTaskFieldPicker', {
  ...h, showCustomTextFieldPicker: capture, showCustomNumberFieldPicker: capture,
 }, '', source);
 const openTaskFieldPicker = compile('openTaskFieldPicker', { openCustomTaskFieldPicker }, '', source);
 for (const type of ['text', 'number']) {
  const field = 'custom-' + type;
  const mapping = { canonicalKey: field, visiblePropertyName: 'Custom ' + type, type, isSystem: false };
  const action = { field, operation: 'add', value: type === 'text' ? 'Previous' : '0' };
  const render = compile('renderValue', {...h, actionType: () => type, openTaskFieldPicker, automationTypedListMapping: () => null}, 'AutomationActionRow');
  const ctx = {settings: () => ({...h.DEFAULT_SETTINGS, keyMappings: [mapping]}), tasks: () => [{...task(today), fieldValues: {[field]: 'Existing'}}], changed() {}};
  const host = new PickerElement();
  render.call({ action, valueHost: host, ctx, syncType() {} });
  host.children[0].fire('click');
  assert.equal(picker.type, type);
  assert.equal(picker.value, action.value);
  if (type === 'text') assert.deepEqual(picker.candidates, ['Existing']);
  const value = type === 'text' ? 'New text' : '-2.5';
  picker.onCommit(field, value);
  assert.equal(action.value, value);
  host.children[0].fire('click');
  assert.equal(picker.value, value);
  picker.onRemove(field);
  assert.equal(action.value, '');
 }
});

test('ordinary custom list suggestions count tasks once per value and break ties alphabetically', () => {
 const mapping = {canonicalKey: 'topics', visiblePropertyName: 'Topics', type: 'list'};
 const tasks = ['B; B; B; A; Z', 'Z', 'Z'].map((topics, i) => ({...task(today), operonId: String(i), fieldValues: {topics}}));
 assert.deepEqual(h.collectCustomFieldValueCandidates(null, tasks, mapping, 'usage'), ['Z', 'A', 'B']);
 assert.deepEqual(h.collectCustomFieldValueCandidates(null, tasks, mapping), ['A', 'B', 'Z']);
});

test('Repeat Action picker reopens the rule and commits only its expression', () => {
 let picker;
 const render = compile('renderValue', {...h, actionType: () => 'text', automationTypedListMapping: () => null,
  formatRepeatRuleSummaryI18n: rule => rule.freq, showRepeatPicker: (_anchor, options) => { picker = options; return () => {}; }}, 'AutomationActionRow');
 const action = {field: 'repeat', operation: 'remove', value: 'mode=schedule|freq=day|interval=1'};
 const host = new PickerElement();
 render.call({action, valueHost: host, ctx: {settings: () => h.DEFAULT_SETTINGS, changed() {}}, syncType() {}});
 const button = host.children[0];
 button.fire('click');
 assert.equal(picker.ruleOnly, true);
 assert.equal(picker.value, action.value);
 const repeat = 'mode=done|freq=month|interval=1';
 picker.onSave({repeat, datetimeRepeatEnd: '', repeatOccurrenceDate: today, inlineCompletionMode: 'replace-completed'});
 assert.deepEqual(action, {field: 'repeat', operation: 'remove', value: repeat});
 assert.match(button.attrs['aria-label'], /month/);
 button.fire('click');
 assert.equal(picker.value, repeat);
 picker.onClear();
 assert.equal(action.value, '');
});

test('single-value list Actions commit the highlighted typed suggestion with Enter', () => {
 const file = 'src/ui/field-pickers/custom/custom-list-field-picker.ts';
 let panel;
 const show = compile('showCustomListFieldPicker', {
  ...h, CUSTOM_LIST_PAGE_SIZE: 20,
  normalizeCustomListValue: value => value.trim(), formatCustomListDisplayValue: value => value,
  buildCustomListSearchText: value => value.toLowerCase(), bindCustomListWikilinkPreview() {},
  bindPickerListItemActivation() {}, requestFloatingInputFocus() {}, scrollChildIntoView() {},
  createButton: (_label, _cls, parent) => parent.createEl('button'),
  createCustomFieldPanel: (_anchor, _options, close) => { panel = new PickerElement(); return {panel, close}; },
 }, '', file);
 for (const [query, move, expected] of [['2', 0, 2], ['2', 1, '2'], ['A;', 0, 'A; B'], ['', 1, '2'], ['New', 0, 'New']]) {
  let committed;
  show(new PickerElement(), {value: [], nativeValues: [], singleValue: true, candidates: ['2', '"2"', '"A; B"'],
   onCommitNativeValues: values => { committed = values; }});
  const input = panel.children[1];
  panel.children[2].style.removeProperty = () => {};
  input.value = query; input.fire('input');
  if (move) input.key('ArrowDown');
  input.key('Enter');
  assert.deepEqual(committed, [expected]);
 }
});
