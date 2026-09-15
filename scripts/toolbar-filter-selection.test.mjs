import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

function method(source, name) {
 const start = source.indexOf(`\tprivate ${name}(`);
 const end = source.indexOf('\n\tprivate ', start + 1);
 assert.ok(start >= 0 && end > start);
 return source.slice(start, end);
}
for (const [kind, path] of [['Table', 'src/ui/table/operon-table-view.ts'], ['Kanban', 'src/ui/kanban/kanban-view.ts']]) {
 const source = readFileSync(path, 'utf8');
 const code = transformSync(`class Harness { ${method(source, `render${kind}FilterPopoverButton`)} ${method(source, `async select${kind}PresetFilter`)} }`, { loader: 'ts', target: 'es2022' }).code;
 const Harness = new Function('setIcon', 'setAccessibleLabelWithoutTooltip', 'bindOperonHoverTooltip', 't', `${code}; return Harness;`)(() => {}, () => {}, () => {}, (...args) => args.join('.'));
 test(`${kind}: click selects, contextmenu edits, and persistence changes only the filter link`, async () => {
  const handlers = {};
  const button = { classList: { toggle() {} }, toggleClass() {}, addEventListener(name, callback) { handlers[name] = callback; } };
  const container = { createDiv() { return { createEl() { return button; } }; } };
  const preset = { id: 'preset', filterSetId: 'old', name: 'Keep', columns: ['a'], other: { untouched: true } };
  const before = structuredClone(preset);
  const view = new Harness();
  let choices = 0, edits = 0, flushed = 0;
  view[`open${kind}FilterPicker`] = () => choices++;
  view[`open${kind}FilterPopover`] = () => edits++;
  view.closeActivePresetPicker = () => {};
  view.closeActiveFilterPopover = () => {};
  view[`render${kind}FilterPopoverButton`](container, preset, null);
  const event = { preventDefault() {}, stopPropagation() {} };
  handlers.click(event);
  assert.equal(choices, 1); assert.equal(edits, 0);
  handlers.contextmenu(event);
  assert.equal(choices, 1); assert.equal(edits, 1);
  const writes = [];
  view.surfaceToken = 'surface';
  view.callbacks = kind === 'Table'
   ? { onSavePresetPatch(patch, context) { writes.push({ patch, context }); return { async flush() { flushed++; } }; } }
   : { async onSelectPresetFilter(...args) { writes.push(args); } };
  await view[`select${kind}PresetFilter`](preset, 'new');
  await view[`select${kind}PresetFilter`](preset, null);
  if (kind === 'Table') {
   assert.deepEqual(writes, ['new', null].map(filterSetId => ({ patch: { id: 'preset', filterSetId }, context: { surfaceToken: 'surface' } })));
   assert.equal(flushed, 2);
  } else assert.deepEqual(writes, [['preset', 'old', 'new'], ['preset', 'old', null]]);
  assert.deepEqual(preset, before);
  view.callbacks = {};
  await assert.rejects(view[`select${kind}PresetFilter`](preset, 'new'), /unavailable/);
 });
}
