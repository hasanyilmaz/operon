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
const temp = await mkdtemp(path.join(tmpdir(), 'operon-table-repeat-'));
after(() => rm(temp, { recursive: true, force: true }));
await build({ stdin: { contents: `
 export { formatTableRepeatValue } from './src/ui/table/table-display';
 export { parseRepeatRule } from './src/core/repeat-rule';
 export { formatRepeatRuleSummaryI18n } from './src/core/repeat-rule-i18n';
 export * from './src/ui/table/table-text-edit-route';
 export * from './src/ui/table/table-column-color';
 export * from './src/ui/table/table-field-catalog';
 export { getTableTaskRawValue } from './src/ui/table/table-value-adapter';
 export { formatTableDetailedDatetimeValue } from './src/ui/table/table-datetime-format';
 export { resolveTableValueCellIcon } from './src/ui/table/table-icon-only-cell';
 export { createDefaultTablePreset, normalizeTablePreset } from './src/types/table';
 export { installI18nLocale, activateI18nLocale, resetI18nToEnglish } from './src/core/i18n';
 export { evaluateFilterSet } from './src/core/filter-evaluator';
 export { CANONICAL_KEYS } from './src/types/keys';
`, resolveDir: root }, outfile: path.join(temp, 'helpers.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const helpers = await import(pathToFileURL(path.join(temp, 'helpers.mjs')).href);
const { formatTableRepeatValue, parseRepeatRule, formatRepeatRuleSummaryI18n, isTablePlainTextField, resolveTableTaskTextEditRoute } = helpers;

// Execute the real TypeScript methods with lightweight host adapters; no Obsidian UI is opened.
function compile(file, name, deps = {}, className) {
 deps = { resolveTableFieldIcon: helpers.resolveTableFieldIcon, Platform: { isDesktopApp: true }, embedTableCellOpeners: new WeakMap(),
  isDesktopOpeningChip: key => { assert.ok(['repeat', 'repeatOccurrenceDate'].includes(key)); return false; }, ...deps };
 const source = read(file), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
 const nodes = className ? ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className).members : ast.statements;
 const node = nodes.find(n => n.name?.getText(ast) === name);
 assert.ok(node, name);
 const declaration = className ? `class Subject { ${node.getText(ast)} }` : node.getText(ast).replace(/^export\s+/u, '');
 const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
 return new Function(...Object.keys(deps), `${js}; return ${className ? `Subject.prototype.${name}` : name};`)(...Object.values(deps));
}
class Element {
 children = []; attrs = {}; dataset = {}; events = {}; cls = ''; textContent = '';
 constructor(options = {}) { this.cls = typeof options === 'string' ? options : options.cls ?? ''; this.textContent = options.text ?? ''; }
 createSpan(options) { const node = new Element(options); this.children.push(node); return node; }
 addClass(cls) { this.cls += ` ${cls}`; }
 setAttribute(key, value) { this.attrs[key] = value; }
 querySelector(selector) { return selector === 'svg' ? this.svg ?? null : null; }
 addEventListener(name, callback) { (this.events[name] ??= []).push(callback); }
 dispatch(name, overrides = {}) { for (const callback of this.events[name] ?? []) callback({ button: 0, detail: 1, target: this, preventDefault() {}, stopPropagation() {}, ...overrides }); }
}
const field = { key: 'repeat', type: 'text', icon: 'repeat' };
const settings = { keyMappings: [{ canonicalKey: 'repeat', icon: 'repeat', isSystem: true }], pipelines: [], priorities: [], colorPalette: [{ id: 'red', hex: '#ff0000' }, { id: 'blue', hex: '#0000ff' }], calendarWeekStart: 'monday', calendarSidebarShowWeekNumbers: true };
const raw = 'mode=done|freq=week|interval=1';
const task = { operonId: 'task-1', primary: { filePath: 'Tasks.md', format: 'inline' }, tags: [], fieldValues: { repeat: raw, repeatSeriesId: 'series-1', repeatOccurrenceDate: '2026-10-16', dateDue: '2026-10-16', datetimeRepeatEnd: '2027-01-01' } };
const label = (el, value) => { el.accessibleLabel = value; };
const chipFile = 'src/ui/table/table-cell-chip.ts', viewFile = 'src/ui/table/operon-table-view.ts';
const valueIcon = compile(chipFile, 'renderTableValueIconChipContent', { setIcon: (el, icon) => { el.svg = { icon }; } });
const renderChip = compile(chipFile, 'renderTableCellChipContent', {
 getTableTaskField: helpers.getTableTaskField, isTableDurationLikeTaskField: () => false,
 decorateTableDateValueChip: compile(chipFile, 'decorateTableDateValueChip', { isTableDateLikeFieldType: type => type === 'date' || type === 'datetime' }),
 formatTableDetailedDatetimeValue: helpers.formatTableDetailedDatetimeValue,
 isTableListChipField: () => false, resolveTableLocationCellVisual: () => null,
 isTableValueIconField: compile(chipFile, 'isTableValueIconField', { getTableTaskField: helpers.getTableTaskField, PROJECT_SERIAL_TABLE_FIELD_KEY: 'projectSerial' }),
 resolveTableValueCellIcon: helpers.resolveTableValueCellIcon,
 applyTableCellChipAccent: (el, key, value, options) => { el.accent = helpers.resolveTableColumnCellAccent(options.column, options.accentValue ?? value, options); },
 resolveTableExternalLink: () => null, formatTableRepeatValue, renderTableValueIconChipContent: valueIcon,
 setAccessibleLabelWithoutTooltip: label, bindOperonHoverTooltip: (el, options) => { el.tooltip = options; },
 resolveTableCellChipAccent: (key, value, options) => helpers.resolveTableColumnCellAccent(options.column, options.accentValue ?? value, options),
});
const pickerCalls = [];
const dispatchPicker = compile('src/ui/task-field-picker-dispatch.ts', 'openTaskFieldPicker', {
 showRepeatPicker: (anchor, options) => { pickerCalls.push({ anchor, options }); return () => {}; },
});
const decorate = compile(viewFile, 'decorateEditableTaskCell', {
 resolveTableParentTaskActivation: helpers.resolveTableParentTaskActivation, buildTableEditableCellKey: () => 'task-1:repeat',
 getTableTaskFieldLabel: () => 'Repeat', formatTableRepeatValue, t: () => 'Edit', setAccessibleLabelWithoutTooltip: label,
 getTableTaskField: () => field, resolveTableTaskTextEditRoute, snapshotFloatingRectAnchor: cell => cell,
 getExcludedTablePickerTaskIds: () => [], getTableManualDatePickerOptions: () => undefined,
 normalizeTablePickerPayload: value => value, openTaskFieldPicker: dispatchPicker,
 isCompactTaskMarkdownLinkEventTarget: () => false, getOwnerWindow: () => ({ setTimeout() {} }),
}, 'OperonTableView');
function harness(value = raw) {
 pickerCalls.length = 0;
 const commits = [], cell = new Element();
 const subject = { tableCellOpeners: new WeakMap(), app: {}, callbacks: { onUpdateTaskFields() {} }, indexer: { getAllTasks: () => [task] }, pendingCellKey: null,
 syncPendingCellState() {}, closeActivePicker() {}, commitTaskCellUpdate: (el, target, key, cellKey, payload) => commits.push(payload),
 openInlineTextPopover() { assert.fail('Repeat must not use text editing'); } };
 const target = { ...task, fieldValues: { ...task.fieldValues, repeat: value } };
 decorate.call(subject, cell, target, 'repeat', value, { settings }, true);
 return { cell, commits, subject, target };
}

for (const value of ['mode=schedule|freq=day|interval=1', raw, 'mode=schedule|freq=week|interval=2|days=mo,we,fr', 'mode=schedule|freq=month|interval=1|monthdays=1,15']) {
 test(`summary matches Task Editor: ${value}`, () => {
  const rule = parseRepeatRule(value); assert.ok(rule);
  assert.equal(formatTableRepeatValue(value), formatRepeatRuleSummaryI18n(rule));
  assert.notEqual(formatTableRepeatValue(value), value);
 });
}
test('empty and unsupported rules retain safe display fallback', () => {
 assert.equal(formatTableRepeatValue('  '), ''); assert.equal(formatTableRepeatValue(' unsupported rule '), 'unsupported rule');
});
test('repeat uses picker and color eligibility while other text remains plain', () => {
 assert.equal(isTablePlainTextField(field), false);
 for (const value of ['', raw, 'unsupported rule']) assert.equal(resolveTableTaskTextEditRoute(field, value), 'picker');
 assert.equal(helpers.isTableFieldColorModeEligible(field), true);
 const custom = { key: 'customText', type: 'text' };
 assert.equal(isTablePlainTextField(custom), true); assert.equal(resolveTableTaskTextEditRoute(custom, 'hello'), 'popover');
 assert.equal(helpers.isTableFieldColorModeEligible(custom), false);
});
test('detailed chip renders repeat icon, readable text, accessible name and tooltip', () => {
 const chip = new Element(); renderChip(chip, 'repeat', raw, { settings, column: { key: 'repeat', colorMode: 'noColor' } });
 assert.equal(chip.children[0].svg.icon, 'repeat'); assert.equal(chip.children[1].textContent, formatTableRepeatValue(raw));
 assert.match(chip.children[1].cls, /operon-table-cell-chip-label/u);
 assert.equal(chip.accessibleLabel, formatTableRepeatValue(raw)); assert.equal(chip.tooltip.content, chip.accessibleLabel);
 assert.equal(chip.accent, null); assert.deepEqual(chip.events, {});
});
test('random color uses serialized rule and normal Table color resolver', () => {
 const column = { key: 'repeat', colorMode: 'randomColors' }, chip = new Element();
 renderChip(chip, 'repeat', raw, { settings, column, accentValue: raw });
 assert.equal(chip.accent, helpers.resolveTableColumnCellAccent(column, raw, { settings }));
 assert.ok(chip.accent); assert.equal(chip.tooltip.taskColor, chip.accent);
});
test('pointerdown plus click opens once and forwards original recurrence context', () => {
 const { cell, target } = harness(); cell.dispatch('pointerdown'); cell.dispatch('click');
 assert.equal(pickerCalls.length, 1);
 const options = pickerCalls[0].options;
 assert.equal(options.value, raw); assert.equal(options.repeatSeriesId, target.fieldValues.repeatSeriesId);
 assert.equal(options.repeatOccurrenceDate, target.fieldValues.repeatOccurrenceDate);
 assert.equal(options.repeatEnd, target.fieldValues.datetimeRepeatEnd); assert.equal(options.dateDue, target.fieldValues.dateDue);
 assert.equal(options.taskFormat, 'inline'); assert.equal(cell.accessibleLabel.includes(formatTableRepeatValue(raw)), true);
});
test('keyboard and empty/unsupported values open Repeat picker', () => {
 for (const value of ['', raw, 'unsupported rule']) for (const key of ['Enter', ' ']) {
  const { cell } = harness(value); cell.dispatch('keydown', { key }); assert.equal(pickerCalls.length, 1); assert.equal(pickerCalls[0].options.value, value);
 }
});
test('pending commits block picker activation', () => {
 const { cell, subject } = harness(); subject.pendingCellKey = 'pending';
 cell.dispatch('pointerdown'); cell.dispatch('click'); cell.dispatch('keydown', { key: 'Enter' }); assert.equal(pickerCalls.length, 0);
});
test('Save and Clear preserve existing mutation payloads; close does not write', () => {
 const { cell, commits } = harness(); cell.dispatch('click'); const options = pickerCalls[0].options;
 options.onCancel?.(); options.onClose?.(); assert.deepEqual(commits, []);
 options.onSave({ repeat: 'mode=schedule|freq=day|interval=2', datetimeRepeatEnd: '', repeatOccurrenceDate: '2026-10-17' });
 assert.deepEqual(commits[0], { repeat: 'mode=schedule|freq=day|interval=2', datetimeRepeatEnd: '', repeatOccurrenceDate: '2026-10-17' });
 options.onClear(); assert.deepEqual(commits[1], { repeat: '', datetimeRepeatEnd: '', repeatSeriesId: '', repeatOccurrenceDate: '' });
});
test('standalone detailed render reuses shared chips; empty stays blank', () => {
 const render = compile(viewFile, 'renderValueCell', {
 isTableFilePropertyColumnKey: () => false, isTableProgressColumnKey: () => false, PROJECT_SERIAL_TABLE_FIELD_KEY: 'projectSerial',
 isTablePlainTextField, getTableTaskField: () => field,
 renderTableCellChips: (cell, key, value, options) => { cell.chips = { key, value, options }; },
 }, 'OperonTableView');
 for (const rootClass of ['operon-table-root']) for (const value of [raw, '']) {
  const cell = new Element(rootClass), subject = { isEditableTaskCell: () => true, decorateEditableTaskCell() {}, shouldUseIconOnlyColumn: () => false };
  render.call(subject, cell, task, { key: 'repeat' }, value, { settings, valueResolver: {} }, false);
  if (!value) assert.equal(cell.chips, undefined);
  else { assert.equal(cell.chips.value, raw); assert.match(cell.chips.options.chipClassName, /operon-table-editable-chip/u); assert.match(cell.chips.options.chipClassName, /operon-table-cell-chip/u); }
 }
});

test('embedded detailed cells use shared bordered chips and preserve blank cells', () => {
 const render = compile('src/ui/embed-table-processor.ts', 'renderEmbedTableCell', {
  applyTableColumnGeometryClass() {}, isTableAdminColumn: () => false, applyTableColumnAlignmentClass() {},
  resolveTableParentContextContentColumn: column => column, TABLE_TASK_TREE_COLUMN_KEY: '__tree',
  isTableFilePropertyColumnKey: () => false, isTableProgressColumnKey: () => false, PROJECT_SERIAL_TABLE_FIELD_KEY: 'projectSerial',
  isEditableTableTaskFieldKey: () => true, decorateEmbedTableEditableTaskCell() {}, shouldUseEmbedTableIconOnlyColumn: () => false,
  isTablePlainTextField, getTableTaskField: () => field,
  renderTableCellChips: (cell, key, value, options) => { cell.chips = { key, value, options }; },
 });
 for (const value of [raw, '']) {
  const cell = new Element();
  render({ createDiv: () => cell }, {}, task, { key: 'repeat' }, { settings, columnGeometry: { entries: [{}] }, valueResolver: { getDisplayValue: () => value } }, 0, {}, 1, false);
  if (!value) assert.equal(cell.chips, undefined);
  else { assert.equal(cell.chips.value, raw); assert.match(cell.chips.options.chipClassName, /operon-table-editable-chip/u); assert.match(cell.chips.options.chipClassName, /operon-table-cell-chip/u); }
 }
});
test('icon-only passes readable tooltip/accessibility and enables shared accent path', () => {
 let captured;
 const dependencies = {
 getTableTaskFieldLabel: () => 'Repeat', resolveTableLocationCellVisual: () => null, getTableTaskField: () => field,
 formatTableRepeatValue, TABLE_TASK_DATA_TYPE_COLUMN_KEY: '__dataType', formatTableCompactDuration: () => null,
 isTablePlainTextField, isTableTaskMediaField: () => false,
 renderTableIconOnlyCell: (cell, options) => { captured = options; return new Element(); },
 resolveTableIconOnlyCellIcon: (key, value, fallback) => fallback, resolveTableValueCellIcon: (key, value, settings, fallback) => fallback,
 resolveTableIconOnlyCellAccent: () => '#123456', bindTableCompactAssigneeImage() {},
 };
 for (const embedded of [false, true]) {
 const render = embedded ? compile('src/ui/embed-table-processor.ts', 'renderEmbedTableIconOnlyCell', dependencies) : compile(viewFile, 'renderIconOnlyCell', dependencies, 'OperonTableView');
 render.call({ callbacks: {} }, new Element(), task, { key: 'repeat' }, raw, { settings, valueResolver: { getRawValue: () => raw } }, {});
 assert.equal(captured.icon(), 'repeat'); assert.equal(captured.content, formatTableRepeatValue(raw));
 assert.equal(captured.ariaLabel, `Repeat: ${formatTableRepeatValue(raw)}`); assert.equal(captured.color, '#123456');
 assert.equal(captured.contentEl, undefined);
 }
});
test('shared CSS provides borders, ellipsis and row/cell hover without repeat-specific overrides', () => {
 const css = read('styles.css');
 assert.match(css, /\.operon-table-cell-chip-label\s*\{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/u);
 assert.ok(css.includes('.operon-table-root.operon-table-embed .operon-table-cell-chip'));
 assert.ok(css.includes('.operon-table-cell.is-editable:hover .operon-table-field-accent-chip'));
 assert.ok(css.includes('.is-operon-table-refresh-hover'));
 assert.doesNotMatch(css, /\.operon-table-repeat-chip/u);
});

test('embedded Table opens Repeat picker with pending guard and commits through its existing adapter', () => {
 pickerCalls.length = 0;
 const cell = new Element(), instance = { pendingCellKey: null }, commits = [];
 const deps = { app: {}, indexer: { getAllTasks: () => [task] } };
 const decorateEmbed = compile('src/ui/embed-table-processor.ts', 'decorateEmbedTableEditableTaskCell', {
  canWriteEmbedTable: () => true, resolveTableParentTaskActivation: helpers.resolveTableParentTaskActivation,
  findEmbedTableInstance: () => instance, buildTableEditableCellKey: () => 'task-1:repeat',
  getTableTaskFieldLabel: () => 'Repeat', formatTableRepeatValue, t: () => 'Edit', setAccessibleLabelWithoutTooltip: label,
  syncEmbedTablePendingCellState() {}, getTableTaskField: () => field, resolveTableTaskTextEditRoute,
  closeEmbedTableActivePicker() {}, openTaskFieldPicker: dispatchPicker, snapshotFloatingRectAnchor: value => value,
  getExcludedTablePickerTaskIds: () => [], getTableManualDatePickerOptions: () => undefined, normalizeTablePickerPayload: value => value,
  commitEmbedTableCellUpdate: (instance, deps, cell, task, key, cellKey, payload) => commits.push(payload),
  isCompactTaskMarkdownLinkEventTarget: () => false, getOwnerWindow: () => ({ setTimeout() {} }),
 });
 decorateEmbed(cell, task, 'repeat', raw, { settings }, deps, true);
 cell.dispatch('pointerdown'); cell.dispatch('click'); assert.equal(pickerCalls.length, 1);
 assert.equal(cell.accessibleLabel.includes(formatTableRepeatValue(raw)), true);
 assert.equal(pickerCalls[0].options.value, raw);
 pickerCalls[0].options.onSave({ repeat: raw, datetimeRepeatEnd: '' }); assert.deepEqual(commits, [{ repeat: raw, datetimeRepeatEnd: '' }]);
 pickerCalls[0].options.onClose(); assert.equal(instance.activePickerClose, null);
 instance.pendingCellKey = 'pending'; cell.dispatch('keydown', { key: 'Enter' }); assert.equal(pickerCalls.length, 1);
 instance.pendingCellKey = null; cell.dispatch('keydown', { key: ' ' }); assert.equal(pickerCalls.length, 2);
});

const referenceKey = 'repeatOccurrenceDate';
const referenceLabel = 'Repeat reference date';
const referenceValue = '2026-10-16';
const referenceSettings = { ...settings, dateDisplayFormat: 'DD/MM/YYYY' };
const referenceField = helpers.getTableTaskField(referenceKey, settings);

test('reference date is an editable scoped date column while canonical metadata remains internal', () => {
 assert.equal(referenceField.label, referenceLabel); assert.equal(referenceField.type, 'date');
 assert.equal(referenceField.icon, 'calendars'); assert.equal(referenceField.readonly, false);
 assert.equal(helpers.isEditableTableTaskFieldKey(referenceKey, settings), true);
 assert.equal(helpers.CANONICAL_KEYS.find(field => field.name === referenceKey).internal, true);
 assert.equal(helpers.getTableTaskField('repeatSeriesId', settings), null);
 assert.equal(helpers.normalizeTableTaskFieldKey(referenceLabel, settings), referenceKey);
 assert.equal(helpers.isTableFieldColorModeEligible(referenceField), true);
 assert.equal(resolveTableTaskTextEditRoute(referenceField, referenceValue), 'picker');
});
test('reference date column survives preset round-trip without being added to existing presets', () => {
 const preset = helpers.createDefaultTablePreset();
 assert.equal(preset.columns.some(column => column.key === referenceKey), false);
 const options = { availableFilterSetIds: [] };
 const old = helpers.normalizeTablePreset(JSON.parse(JSON.stringify(preset)), options);
 assert.equal(old.columns.some(column => column.key === referenceKey), false);
 const column = { key: referenceKey, widthPx: 180, displayMode: 'icon', colorMode: 'randomColors' };
 preset.columns.push(column);
 const restored = helpers.normalizeTablePreset(JSON.parse(JSON.stringify(preset)), options);
 assert.deepEqual(JSON.parse(JSON.stringify(restored.columns.find(entry => entry.key === referenceKey))), { ...column, kind: 'task' });
});
test('reference date reads only stored value; missing/empty values ignore all other dates', () => {
 for (const stored of [undefined, '', referenceValue]) {
  const fields = { repeat: raw, dateScheduled: '2026-10-01', dateDue: '2026-10-02', dateStarted: '2026-10-03', datetimeStart: '2026-10-04T12:00:00', [referenceKey]: stored };
  const before = JSON.stringify(fields);
  assert.equal(helpers.getTableTaskRawValue({ ...task, fieldValues: fields }, referenceKey), stored ?? '');
  assert.equal(JSON.stringify(fields), before);
 }
});
test('reference date detailed chip uses calendars, date format and shared date/color classes', () => {
 for (const [dateDisplayFormat, expected] of [['YYYY-MM-DD', referenceValue], ['DD/MM/YYYY', '16/10/2026'], ['MM/DD/YYYY', '10/16/2026']]) {
  for (const colorMode of ['noColor', 'randomColors', 'taskColor']) {
   const chip = new Element(), options = { settings: { ...settings, dateDisplayFormat }, task, column: { key: referenceKey, colorMode }, accentValue: referenceValue };
   renderChip(chip, referenceKey, referenceValue, options);
   assert.equal(chip.children[0].svg.icon, 'calendars'); assert.equal(chip.children[1].textContent, expected);
   assert.match(chip.cls, /operon-table-date-value-chip/u); assert.match(chip.children[1].cls, /operon-table-cell-chip-label/u);
   assert.equal(chip.accent, helpers.resolveTableColumnCellAccent(options.column, referenceValue, options));
   assert.deepEqual(chip.events, {});
  }
 }
});

function referenceHarness(embedded, value = referenceValue, editable = true, writable = true) {
 pickerCalls.length = 0;
 const cell = new Element(), commits = [], state = { pendingCellKey: null };
 const target = { ...task, fieldValues: { ...task.fieldValues, [referenceKey]: value } };
 const deps = {
  resolveTableParentTaskActivation: helpers.resolveTableParentTaskActivation,
  buildTableEditableCellKey: (task, key) => `${task.operonId}:${key}`,
  getTableTaskFieldLabel: helpers.getTableTaskFieldLabel, getTableTaskField: helpers.getTableTaskField,
  formatTableRepeatValue, t: () => 'Edit', setAccessibleLabelWithoutTooltip: label,
  resolveTableTaskTextEditRoute, snapshotFloatingRectAnchor: cell => cell,
  getExcludedTablePickerTaskIds: () => [], getTableManualDatePickerOptions: () => undefined,
  normalizeTablePickerPayload: value => value, openTaskFieldPicker: dispatchPicker,
  isCompactTaskMarkdownLinkEventTarget: () => false, getOwnerWindow: () => ({ setTimeout() {} }),
  canWriteEmbedTable: () => writable, findEmbedTableInstance: () => state,
  syncEmbedTablePendingCellState() {}, closeEmbedTableActivePicker() {},
  commitEmbedTableCellUpdate: (instance, deps, cell, task, key, cellKey, payload) => commits.push({ key, payload }),
 };
 const host = { tableCellOpeners: new WeakMap(), app: {}, indexer: { getAllTasks: () => [target] }, callbacks: writable ? { onUpdateTaskFields() {} } : {},
  syncPendingCellState() {}, closeActivePicker() {},
  commitTaskCellUpdate: (cell, task, key, cellKey, payload) => commits.push({ key, payload }),
 };
 Object.assign(state, host);
 if (embedded) compile('src/ui/embed-table-processor.ts', 'decorateEmbedTableEditableTaskCell', deps)(cell, target, referenceKey, value, { settings: referenceSettings }, host, editable);
 else compile(viewFile, 'decorateEditableTaskCell', deps, 'OperonTableView').call(state, cell, target, referenceKey, value, { settings: referenceSettings }, editable);
 return { cell, commits, state, target };
}
for (const embedded of [false, true]) {
 const surface = embedded ? 'embedded' : 'standalone';
 test(`${surface} reference date: pointer/keyboard opens Repeat once with original task context`, () => {
  for (const value of ['', referenceValue]) for (const event of ['pointer', 'click', 'Enter', ' ']) {
   const { cell, target } = referenceHarness(embedded, value);
   if (event === 'pointer') { cell.dispatch('pointerdown', { target: new Element() }); cell.dispatch('click'); }
   else if (event === 'click') cell.dispatch('click');
   else cell.dispatch('keydown', { key: event });
   assert.equal(pickerCalls.length, 1); const { options, anchor } = pickerCalls[0];
   assert.equal(anchor, cell); assert.equal(options.value, raw); assert.equal(options.repeatOccurrenceDate, value);
   assert.equal(options.repeatSeriesId, target.fieldValues.repeatSeriesId); assert.equal(options.repeatEnd, target.fieldValues.datetimeRepeatEnd);
   assert.equal(options.dateDue, target.fieldValues.dateDue); assert.equal(options.taskFormat, 'inline');
   assert.equal(cell.dataset.editCellKey, `task-1:${referenceKey}`);
  }
 });
 test(`${surface} reference date: read-only and pending saves block activation`, () => {
  for (const [editable, writable] of [[false, true], [true, false], [true, true]]) {
   const { cell, state } = referenceHarness(embedded, referenceValue, editable, writable);
   if (editable && writable) state.pendingCellKey = 'pending';
   else { assert.equal(cell.attrs['aria-readonly'], 'true'); assert.deepEqual(cell.events, {}); }
   cell.dispatch('pointerdown'); cell.dispatch('click'); cell.dispatch('keydown', { key: 'Enter' });
   assert.equal(pickerCalls.length, 0);
  }
 });
 test(`${surface} reference date: Cancel is write-free; Save/Clear use the recurrence mutation payload`, () => {
  const { cell, commits, state } = referenceHarness(embedded); cell.dispatch('click');
  const options = pickerCalls[0].options;
  options.onCancel?.(); options.onClose(); assert.deepEqual(commits, []); assert.equal(state.activePickerClose, null);
  const payload = { repeat: raw, datetimeRepeatEnd: '', repeatOccurrenceDate: '2026-10-20' };
  options.onSave(payload); assert.deepEqual(commits[0], { key: referenceKey, payload });
  options.onClear(); assert.deepEqual(commits[1], { key: referenceKey, payload: { repeat: '', datetimeRepeatEnd: '', repeatSeriesId: '', repeatOccurrenceDate: '' } });
 });
 test(`${surface} reference date: icon-only has calendars and formatted tooltip/accessibility; empty has no icon`, () => {
  let captured;
  const deps = {
   getTableTaskFieldLabel: helpers.getTableTaskFieldLabel, getTableTaskField: helpers.getTableTaskField,
   formatTableDetailedDatetimeValue: helpers.formatTableDetailedDatetimeValue,
   resolveTableLocationCellVisual: () => null, TABLE_TASK_DATA_TYPE_COLUMN_KEY: '__dataType',
   formatTableCompactDuration: () => null, isTablePlainTextField, isTableTaskMediaField: () => false,
   renderTableIconOnlyCell: (cell, options) => { captured = options; return new Element(); },
   resolveTableIconOnlyCellIcon: (key, value, fallback) => fallback, resolveTableValueCellIcon: helpers.resolveTableValueCellIcon,
   resolveTableIconOnlyCellAccent: () => '#123456', bindTableCompactAssigneeImage() {},
  };
  const render = embedded ? compile('src/ui/embed-table-processor.ts', 'renderEmbedTableIconOnlyCell', deps) : compile(viewFile, 'renderIconOnlyCell', deps, 'OperonTableView');
  for (const value of ['', referenceValue]) {
   captured = undefined;
   render.call({ callbacks: {} }, new Element(), task, { key: referenceKey }, value, { settings: referenceSettings, valueResolver: { getRawValue: () => value } }, {});
   if (!value) assert.equal(captured, undefined);
   else { assert.equal(captured.icon(), 'calendars'); assert.equal(captured.content, '16/10/2026'); assert.equal(captured.ariaLabel, `${referenceLabel}: 16/10/2026`); }
  }
 });
 test(`${surface} reference date: detailed surface uses common bordered chips and leaves blanks empty`, () => {
  const deps = {
   applyTableColumnGeometryClass() {}, isTableAdminColumn: () => false, applyTableColumnAlignmentClass() {},
   resolveTableParentContextContentColumn: column => column, TABLE_TASK_TREE_COLUMN_KEY: '__tree',
   isTableFilePropertyColumnKey: () => false, isTableProgressColumnKey: () => false, PROJECT_SERIAL_TABLE_FIELD_KEY: 'projectSerial',
   isEditableTableTaskFieldKey: helpers.isEditableTableTaskFieldKey, decorateEmbedTableEditableTaskCell() {}, shouldUseEmbedTableIconOnlyColumn: () => false,
   isTablePlainTextField, getTableTaskField: helpers.getTableTaskField,
   renderTableCellChips: (cell, key, value, options) => { cell.chips = { key, value, options }; },
  };
  const render = embedded ? compile('src/ui/embed-table-processor.ts', 'renderEmbedTableCell', deps) : compile(viewFile, 'renderValueCell', deps, 'OperonTableView');
  for (const value of ['', referenceValue]) {
   const cell = new Element(), renderState = { settings: referenceSettings, columnGeometry: { entries: [{}] }, valueResolver: { getDisplayValue: () => value } };
   if (embedded) render({ createDiv: () => cell }, {}, task, { key: referenceKey }, renderState, 0, {}, 1, false);
   else render.call({ isEditableTaskCell: () => true, decorateEditableTaskCell() {}, shouldUseIconOnlyColumn: () => false }, cell, task, { key: referenceKey }, value, renderState, false);
   if (!value) assert.equal(cell.chips, undefined);
   else { assert.equal(cell.chips.value, referenceValue); assert.match(cell.chips.options.chipClassName, /operon-table-editable-chip/u); assert.match(cell.chips.options.chipClassName, /operon-table-cell-chip/u); }
  }
 });
}

test('reference date label follows language changes even with unchanged key mappings', () => {
 try {
  helpers.installI18nLocale('tr', JSON.parse(read('i18n/locales/tr.json')));
  assert.equal(helpers.activateI18nLocale('tr'), true);
  assert.equal(helpers.getTableTaskField(referenceKey, settings).label, 'Tekrar referans tarihi');
 } finally { helpers.resetI18nToEnglish(); }
 assert.equal(helpers.getTableTaskField(referenceKey, settings).label, referenceLabel);
});

test('Repeat picker reference-date Save/Clear updates both Table values and active filter matches', () => {
 const condition = { id: 'condition', field: referenceKey, fieldType: 'date', operator: 'dateIs', value: '2026-11-01' };
 const filter = { id: 'filter', name: 'Reference date', rootGroup: { id: 'root', logic: 'all', children: [condition] }, sorts: [], conditions: [condition], matchLogic: 'all' };
 for (const embedded of [false, true]) {
  const { cell, target, commits } = referenceHarness(embedded);
  const matches = () => helpers.evaluateFilterSet(filter, [target]).length;
  assert.equal(matches(), 0); cell.dispatch('click');
  const options = pickerCalls[0].options;
  options.onSave({ repeat: raw, repeatOccurrenceDate: '2026-11-01', datetimeRepeatEnd: '' });
  Object.assign(target.fieldValues, commits[0].payload);
  assert.equal(helpers.getTableTaskRawValue(target, referenceKey), '2026-11-01');
  assert.equal(helpers.formatTableDetailedDatetimeValue(referenceKey, helpers.getTableTaskRawValue(target, referenceKey), referenceSettings), '01/11/2026');
  assert.equal(matches(), 1);
  options.onClear(); Object.assign(target.fieldValues, commits[1].payload);
  assert.equal(helpers.getTableTaskRawValue(target, referenceKey), ''); assert.equal(matches(), 0);
 }
});
