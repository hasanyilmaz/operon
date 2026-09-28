import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'src/ui/calendar/calendar-view.ts'), 'utf8');
const ast = ts.createSourceFile('calendar-view.ts', source, ts.ScriptTarget.Latest, true);
const view = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CalendarView');
const guard = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'isCalendarStatusIconTarget');
function compile(expression, scope, owner = {}) {
 const js = ts.transpileModule('const handler = ' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 return new Function('scope', 'with(scope){' + js + ';return handler;}').call(owner, scope);
}
function method(name) {
 const result = view.members.find(n => n.name?.getText(ast) === name);
 assert.ok(result, name);
 return result;
}
function listener(name, host, event) {
 let result;
 function visit(n) {
  if (ts.isCallExpression(n) && n.expression.getText(ast) === host + '.addEventListener' && n.arguments[0]?.text === event) result = n.arguments[1];
  ts.forEachChild(n, visit);
 }
 visit(method(name)); assert.ok(result, name + ':' + event);
 return result.getText(ast);
}
const dir = await mkdtemp(path.join(tmpdir(), 'operon-calendar-icon-'));
let shared;
try {
 const outfile = path.join(dir, 'shared.mjs');
 await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
export {asHTMLElement, getOwnerWindow} from './src/core/dom-compat';
export {resolveTaskIconAction} from './src/core/task-icon-action';
` }, outfile, bundle: true, platform: 'node', format: 'esm', target: ['node18'], logLevel: 'silent',
 alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
 shared = await import(pathToFileURL(outfile));
} finally { await rm(dir, { recursive: true, force: true }); }
const isCalendarStatusIconTarget = guard ? compile(guard.getText(ast), {}) : undefined;

// Separate constructors model the distinction the old HTML-only test DOM missed.
// Each fixture is a new realm, so no global HTMLElement constructor can hide it.
function realm() {
 const document = {};
 class Element {
  constructor(parent = null, classes = [], tag = 'div') {
   this.parentElement = parent; this.classes = new Set(classes); this.tag = tag;
   this.ownerDocument = document; this.dataset = {}; this.listeners = new Map(); this.children = [];
   this.style = { removeProperty() {} }; this.disabled = false;
  }
  closest(selectors) {
   const matches = selectors.split(',').some(s => s.trim().startsWith('.') ? this.classes.has(s.trim().slice(1)) : s.trim() === this.tag);
   return matches ? this : this.parentElement?.closest(selectors) ?? null;
  }
  createEl(tag, options) {
   const child = new HTMLElement(this, options.cls.split(' '), tag); this.children.push(child); return child;
  }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  dispatch(event) { for (const fn of this.listeners.get(event.type) ?? []) fn(event); }
 }
 class HTMLElement extends Element {}
 class SVGElement extends Element {}
 document.defaultView = { HTMLElement, SVGElement };
 const row = new HTMLElement(); const button = new HTMLElement(row, ['operon-calendar-status-button', 'operon-calendar-sidebar-task-pool-status'], 'button');
 const svg = new SVGElement(button); const path = new SVGElement(svg);
 return { row, button, svg, path, document, HTMLElement, SVGElement };
}
function event(target, extra = {}) {
 return { type: 'pointerdown', target, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: 10, clientY: 10,
  defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
}
const surfaces = [
 ['Task Pool', 'bindSidebarTaskPoolRowDrag', 'row'],
 ['timed grid', 'bindTimedItemInteraction', 'block'],
 ['all-day', 'bindScheduledAllDayItemInteraction', 'itemEl'],
 ['due and finished', 'bindDateMarkerAllDayItemInteraction', 'itemEl'],
 ['multi-week', 'bindMultiWeekInDayItemInteraction', 'itemEl'],
 ['mobile all-day', 'bindMobileAllDayPillInteraction', 'itemEl'],
 ['tracked session', 'bindTrackedSessionInteraction', 'block'],
];
for (const [surface, name, host] of surfaces) test(surface + ': SVG icon skips card gestures, body dragging and sidebar touch scrolling remain', () => {
 for (let windowIndex = 0; windowIndex < 2; windowIndex++) {
  const f = realm();
  assert.equal(shared.asHTMLElement(f.svg, f.row), null);
  assert.equal(shared.asHTMLElement(f.button, f.row), f.button);
  for (const pointerType of ['mouse', 'touch', 'pen']) for (const target of [f.button, f.svg, f.path, f.row]) {
   let starts = 0, scrollOnly = 0;
   const start = () => { starts++; };
   const settings = { calendarTouchTimeGridTaskMoveEnabled: true };
   const scope = { ...shared, isCalendarStatusIconTarget, row: f.row, block: f.row, itemEl: f.row, settings, isMobileTimeGridItem: false,
    isTouchLikePointer: e => e.pointerType !== 'mouse', isTouchPointer: e => e.pointerType !== 'mouse',
    isPrimaryTouchLikePointer: e => e.pointerType !== 'mouse' && e.isPrimary,
    startDragState: start, startDrag: start, startTrackedPendingPointerDrag: start, startTrackedPendingTouchDrag: start,
    startPendingTouchDrag: start, beginLongPressTouchGesture: start,
    startPendingTouch: (_event, allowed) => { if (allowed) starts++; else scrollOnly++; },
   };
   const handler = compile(listener(name, host, 'pointerdown'), scope, { hideCalendarHoverMenu() {}, getSettings: () => settings });
   handler(event(target, { pointerType }));
   assert.equal(starts, target === f.row ? 1 : 0, surface + ':' + pointerType);
   assert.equal(scrollOnly, name === 'bindSidebarTaskPoolRowDrag' && pointerType !== 'mouse' && target !== f.row ? 1 : 0);
   if (pointerType === 'mouse') { starts = 0; handler(event(target, { button: 2 })); assert.equal(starts, 0); }
  }
 }
});

for (const [name, host] of [['renderSidebarTaskPoolRow', 'container'], ['bindPrimaryItemClick', 'container'], ['bindTrackedSessionPrimaryClick', 'block']]) {
 test(name + ': Enter/Space on the icon preserves native activation; card keyboard opening remains', () => {
  for (const key of ['Enter', ' ']) for (let windowIndex = 0; windowIndex < 2; windowIndex++) {
   const f = realm();
   for (const target of [f.button, f.svg, f.path, f.row]) {
    let opens = 0;
    const owner = { callbacks: { onItemAction() { opens++; }, onTrackedSessionOpen() { opens++; } } };
    const scope = { isCalendarStatusIconTarget, task: { operonId: 'task' }, item: { taskId: 'task', origin: 'materialized' }, session: { ref: {} } };
    const e = event(target, { type: 'keydown', key });
    compile(listener(name, host, 'keydown'), scope, owner)(e);
    assert.equal(opens, target === f.row ? 1 : 0); assert.equal(e.defaultPrevented, target === f.row);
   }
  }
 });
}
const pipelines = [{ id: 'p', name: 'Work', statuses: ['Open', 'Doing', 'Finished', 'Cancelled'].map((label, i) => ({
 id: String(i), label, color: '', isFinished: label === 'Finished', isCancelled: label === 'Cancelled',
 isScheduledTarget: false, isTrackingTarget: false, propertyMapping: null,
})) }];
for (const name of ['renderCalendarStatusButton', 'renderSidebarTaskPoolStatusButton']) {
 test(name + ': icon click cycles exactly once using the preference, and leaves pointerdown for long press', () => {
  for (const taskIconClickAction of ['pipeline', 'state']) {
   const settings = { pipelines, taskIconClickAction }; const f = realm(); let actions = 0;
   const state = { fieldValues: { status: 'Work.Open' }, checkbox: 'open' };
   const scope = { setIcon() {}, setAccessibleLabelWithoutTooltip() {}, getTaskIconActionLabel: () => '' };
   const Probe = compile('class Probe {' + method(name).getText(ast) + '}', scope);
   const probe = new Probe();
   Object.assign(probe, { getSettings: () => settings, resolveStatusButtonIcon: () => 'check',
    resolveCalendarStatusColor: () => null, resolveCalendarStatusColorFromFieldValues: () => null,
    callbacks: { onStatusIconClick() {} }, invokeCalendarStatusClickCallback() {
     actions++; const next = shared.resolveTaskIconAction(settings, state.fieldValues.status, state.checkbox);
     state.checkbox = next.checkbox; state.fieldValues.status = next.status;
    },
   });
   const model = name === 'renderCalendarStatusButton' ? { taskId: 'task', origin: 'materialized', renderSnapshot: state } : { operonId: 'task', ...state };
   probe[name](f.row, model, settings, true);
   const button = f.row.children[0]; const svg = new f.SVGElement(button); const path = new f.SVGElement(svg);
   const down = event(path); button.dispatch(down);
   assert.equal(down.defaultPrevented, true); assert.equal(down.stopped, false, 'long-press trigger can observe pointerdown');
   const click = event(path, { type: 'click' }); button.dispatch(click);
   assert.equal(click.stopped, true); assert.equal(actions, 1);
   assert.equal(state.fieldValues.status, taskIconClickAction === 'pipeline' ? 'Work.Doing' : 'Work.Finished');
   assert.equal(state.checkbox, taskIconClickAction === 'pipeline' ? 'open' : 'done');
   if (taskIconClickAction === 'state') {
    button.dispatch(event(path, { type: 'click' })); assert.equal(state.checkbox, 'cancelled');
    button.dispatch(event(path, { type: 'click' })); assert.equal(state.checkbox, 'open'); assert.equal(actions, 3);
   }
  }
 });
}
test('projected/read-only/missing callback Calendar icons stay disabled with no status handler', () => {
 for (const variant of ['projected', 'readonly', 'no-callback']) {
  const f = realm(); let writes = 0;
  const scope = { setIcon() {}, setAccessibleLabelWithoutTooltip() {}, getTaskIconActionLabel: () => '' };
  const Probe = compile('class Probe {' + method('renderCalendarStatusButton').getText(ast) + '}', scope);
  const probe = new Probe();
  Object.assign(probe, { resolveStatusButtonIcon: () => '', resolveCalendarStatusColor: () => null,
   callbacks: variant === 'no-callback' ? {} : { onStatusIconClick() {} }, invokeCalendarStatusClickCallback() { writes++; },
  });
  probe.renderCalendarStatusButton(f.row, { taskId: 'task', origin: variant === 'projected' ? 'projected' : 'materialized', isStatusReadOnly: variant === 'readonly', renderSnapshot: { fieldValues: {}, checkbox: 'open' } }, {}, true);
  const button = f.row.children[0]; assert.equal(button.disabled, true);
  button.dispatch(event(button, { type: 'click' })); assert.equal(writes, 0);
 }
});
