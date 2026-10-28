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
 export * from './src/core/filter-group-clipboard';
 export * from './src/core/settings-backup-format';
 export { validateOperonSettingsBackupGroupsV1 } from './src/core/settings-backup-group-validation';
 export { DEFAULT_SETTINGS, normalizeFilterSet, cloneFilterSet } from './src/types/settings';
 export { getManagedCustomFieldOptions } from './src/core/managed-task-fields';
 export { getConfiguredKeyMappingIcon } from './src/core/key-mapping-icons';
 export { t } from './src/core/i18n';
 export { getTableTaskField } from './src/ui/table/table-field-catalog';
`, resolveDir: root }, outfile: path.join(temp, 'helpers.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const h = await import(pathToFileURL(path.join(temp, 'helpers.mjs')).href);
const modalFile = 'src/ui/filter-set-modal.ts';
function compile(name, deps = {}, method = false) {
 const source = read(modalFile), ast = ts.createSourceFile(modalFile, source, ts.ScriptTarget.Latest, true);
 const nodes = method ? ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'FilterSetModal').members : ast.statements;
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
}, true);
const subject = { keyMappings: h.DEFAULT_SETTINGS.keyMappings, getFilePropertyFieldOptions: () => [], getFieldOptions, getProjectSerialScopeOptions: () => [] };
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
 assert.match(read(modalFile), /const sortFieldOptions = this\.getFieldOptions\(false, true, true\)/);
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
 const compatibility = compile('getFilterGroupPasteCompatibilityIssue', { findFilterGroupPasteCompatibilityIssue: h.findFilterGroupPasteCompatibilityIssue, isFilePropertyColumnKey: () => false }, true);
 assert.equal(compatibility.call(subject, decoded.group), null);
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
 fire(name) { for (const cb of this.events[name] ?? []) cb({ preventDefault() {}, stopPropagation() {} }); }
 find(predicate) { return [this, ...this.children.flatMap(child => child.find(() => true))].filter(predicate); }
}
function modalHarness(cond = condition()) {
 const root = new Element(), draft = h.cloneFilterSet(filter(cond)), saved = [], popovers = [], fieldPickers = [];
 const state = { ...subject, filterSet: draft, options: {}, invalidRawConditionIds: new Set(),
  addClasses: (el, ...names) => el.addClass(...names), renderNodeMoveButtons() {}, renderQuickActions() {},
  measureControlContentWidth: () => 180, measureSelectContentWidth: () => 180,
  getFilterOperatorLabel: option => option.label, getPickerFieldOptions: fields => fields,
  openDateConditionPopover: (input, condition) => popovers.push({ input, condition }),
  createModalSelect: (parent, options, value, onChange) => { const select = parent.createDiv().createEl('select', { value }); select.onChange = onChange; return select; },
  flattenConditions: compile('flattenConditions', { isFilterGroupNode: node => Array.isArray(node.children) }, true),
  syncMirroredFilterFields: compile('syncMirroredFilterFields', {}, true),
  hasInvalidTrackedOnCondition: () => false, close() { this.closed = true; }, onSave: value => saved.push(structuredClone(value)),
 };
 const deps = {
  t: h.t, setIcon: (el, icon) => { el.icon = icon; }, bindOperonHoverTooltip() {},
  setAccessibleLabelWithoutTooltip: (el, value) => el.setAttribute('aria-label', value),
  getOperatorsForField: h.getOperatorsForField, NO_VALUE_OPERATORS: h.NO_VALUE_OPERATORS, NUMERIC_INPUT_DATE_OPERATORS: h.NUMERIC_INPUT_DATE_OPERATORS,
  TASK_DATA_TYPE_FIELD_KEY: '__taskDataType', isFilePropertyColumnKey: () => false,
  normalizeFilterDateInput: compile('normalizeFilterDateInput', { CANONICAL_FILTER_DATE_PATTERN: /^(\d{4})-(\d{2})-(\d{2})$/u }),
  showFilterConditionPicker: (el, options) => fieldPickers.push(options),
 };
 compile('renderConditionRow', deps, true).call(state, root, draft.rootGroup, draft.rootGroup.children[0], 0);
 compile('renderButtons', deps, true).call(state, root);
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
