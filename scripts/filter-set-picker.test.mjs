import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { test } from 'node:test';

const result = await build({
 entryPoints: ['src/ui/filter-set-picker.ts'], bundle: true, write: false,
 format: 'esm', platform: 'node', plugins: [{ name: 'picker-test-boundaries', setup(build) {
  build.onResolve({ filter: /searchable-option-picker$|core\/i18n$|dynamic-file-task-filter$/ }, args => ({ path: args.path, namespace: 'stub' }));
  build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents:
   args.path.endsWith('searchable-option-picker')
    ? 'export function showSearchableOptionPicker(anchor, options) { globalThis.pickerOptions = options; return () => options.onClose(); }'
    : args.path.endsWith('i18n') ? 'export const t = (group, key) => key;'
    : 'export const isSpecialDynamicFilterSet = filter => filter.special === true;', loader: 'js' }));
 } }],
});
const { showFilterSetPicker } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('Choose shows and searches names, preserving distinct IDs and null selection', () => {
 let detached; let disconnected = false; let focused = false;
 const priorObserver = globalThis.MutationObserver;
 globalThis.MutationObserver = class {
  constructor(callback) { detached = callback; }
  observe() {}
  disconnect() { disconnected = true; }
 };
 try {
  const selections = [];
  const anchor = { isConnected: true, ownerDocument: { body: {} }, focus() { focused = true; } };
  const close = showFilterSetPicker(anchor, {
   value: 'fs_b', filterSets: [
    { id: 'fs_a', name: 'Daily' }, { id: 'fs_b', name: 'Daily' },
    { id: 'fs_hidden', name: 'Hidden', special: true },
   ], onChooseFilter: id => selections.push(id),
  });
  const options = globalThis.pickerOptions;
  assert.equal(options.value, 'fs_b');
  assert.deepEqual(options.options.map(row => row.label), ['noFilter', 'Daily', 'Daily']);
  assert.equal(options.getSearchText(options.options[1]), 'Daily');
  assert.equal(options.options[1].title, 'Daily');
  assert.equal(options.options[1].description, undefined);
  assert.deepEqual(selections, []);
  options.onSelect(options.options[2]);
  options.onSelect(options.options[0]);
  assert.deepEqual(selections, ['fs_b', null]);
  close();
  assert.equal(disconnected, true);
  assert.equal(focused, true);
  focused = false;
  anchor.isConnected = false;
  detached();
  assert.equal(focused, false);
  assert.deepEqual(selections, ['fs_b', null]);
 } finally {
  globalThis.MutationObserver = priorObserver;
  delete globalThis.pickerOptions;
 }
});
