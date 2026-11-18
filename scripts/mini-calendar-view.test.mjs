import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'operon-mini-view-test-'));
after(() => rm(temporary, { recursive: true, force: true }));
await build({
 entryPoints: [path.join(root, 'src/ui/calendar/mini-calendar-view.ts')],
 outfile: path.join(temporary, 'subject.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
 plugins: [{ name: 'ui-ports', setup(builder) {
  builder.onResolve({ filter: /^(obsidian)$|operon-hover-tooltip|accessibility-label|field-pickers\/common|core\/i18n$|core\/obsidian-app$/ }, args => ({ path: args.path, namespace: 'ports' }));
  builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
   export { default as moment } from "moment";
   export class ItemView {
    constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = leaf.contentEl; this.containerEl = leaf.containerEl; }
    getState() { return {}; }
   }
   export const setIcon = () => {};
   export const t = (section, key) => key;
   export const getAppLocale = app => app.locale;
   export const closeBoundOperonHoverTooltips = () => {};
   export const cleanupOperonHoverTooltips = root => { root.tooltipCleanups = (root.tooltipCleanups ?? 0) + 1; };
   export const bindOperonHoverTooltip = () => {};
   export const setAccessibleLabelWithoutTooltip = (el, label) => el.setAttribute('aria-label', label);
   export const closeFloatingPanelsForRoot = () => {};
  `, resolveDir: root }));
  builder.onLoad({ filter: /calendar-month-picker\.ts$/ }, args => {
   const source = readFileSync(args.path, 'utf8');
   return { loader: 'ts', contents: source.slice(0, source.indexOf('export function showCalendarMonthPicker')) + `
    export function showCalendarMonthPicker(anchor, options) {
     const close = () => { anchor.picker = null; options.onClose(); };
     anchor.picker = { options, close };
     return close;
    }
   ` };
  });
 } }],
});
const { MiniCalendarView, openMiniCalendar, MINI_CALENDAR_VIEW_TYPE } = await import(pathToFileURL(path.join(temporary, 'subject.mjs')).href);

class Events {
 listeners = new Map();
 addEventListener(name, fn) {
  if (!this.listeners.has(name)) this.listeners.set(name, new Set());
  this.listeners.get(name).add(fn);
 }
 removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
 emit(name, event = {}) { for (const fn of this.listeners.get(name) ?? []) fn(event); }
 count() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}
class TestWindow extends Events {
 timers = new Map();
 nextTimer = 0;
 setTimeout(fn, delay) { const id = ++this.nextTimer; this.timers.set(id, { fn, delay }); return id; }
 clearTimeout(id) { this.timers.delete(id); }
 wake() { const [id, timer] = this.timers.entries().next().value; this.timers.delete(id); timer.fn(); }
}
class Element extends Events {
 constructor(doc, tag = 'div', options = {}) {
  super(); this.ownerDocument = doc; this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {};
  this.textContent = options.text ?? ''; this.isConnected = true;
  this.classes = new Set((options.cls ?? '').split(' '));
  this.classList = { contains: name => this.classes.has(name), toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  for (const [key, value] of Object.entries(options.attr ?? {})) this.setAttribute(key, value);
 }
 setAttribute(key, value) {
  this.attrs[key] = value;
  if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
 }
 addClass(name) { this.classes.add(name); }
 createEl(tag, options = {}) { const el = new Element(this.ownerDocument, tag, options); el.parent = this; this.children.push(el); return el; }
 createDiv(options = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
 createSpan(options = {}) { return this.createEl('span', typeof options === 'string' ? { cls: options } : options); }
 insertBefore(el, before) { this.children.splice(this.children.indexOf(el), 1); this.children.splice(this.children.indexOf(before), 0, el); }
 contains(el) { return this === el || this.children.some(child => child.contains(el)); }
 querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]); }
 empty() {
  if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
  const detach = el => { el.isConnected = false; el.children.forEach(detach); };
  this.children.forEach(detach); this.children = [];
 }
 focus() { this.ownerDocument.activeElement = this; }
 click() { this.focus(); this.emit('click', { preventDefault() {}, stopPropagation() {} }); }
 onWindowMigrated(callback) { this.migrate = callback; return () => { this.migrate = null; }; }
}
function document() {
 const doc = new Events(); doc.defaultView = new TestWindow(); doc.body = new Element(doc); doc.activeElement = doc.body; return doc;
}
async function fixture() {
 const doc = document();
 let now = new Date(2026, 10, 13, 12);
 const settings = { miniCalendarViewMode: 'month', dateDisplayFormat: 'YYYY-MM-DD', calendarWeekStart: 'monday', calendarSidebarShowWeekNumbers: true, language: 'en' };
 const leaf = { app: { locale: 'en-US' }, contentEl: new Element(doc), containerEl: new Element(doc) };
 const opened = [];
 const view = new MiniCalendarView(leaf, () => settings, () => new Date(now), async request => { opened.push(request); });
 leaf.view = view;
 await view.onOpen();
 return { view, leaf, doc, settings, opened, setNow(value) { now = value; } };
}
function buttons(view) { return view.contentEl.querySelectorAll('button'); }
function day(view, date) { return buttons(view).find(button => button.dataset.dateKey === date); }
function year(view) { return buttons(view).find(button => button.classes.has('operon-calendar-year-button')); }
function next(view) { return buttons(view).filter(button => button.classes.has('operon-calendar-sidebar-month-nav-button'))[1]; }
function today(view) { return buttons(view).find(button => button.classes.has('operon-calendar-date-button')); }
function selected(view) { return buttons(view).find(button => button.classes.has('is-anchor'))?.dataset.dateKey; }

test('new views start today and keep dates independent and out of workspace state', async () => {
 const first = await fixture(), second = await fixture();
 day(first.view, '2026-11-19').click();
 assert.equal(selected(first.view), '2026-11-19'); assert.equal(selected(second.view), '2026-11-13');
 assert.deepEqual(first.view.getState(), {});
 await first.view.onClose(); await first.view.onOpen();
 assert.equal(selected(first.view), '2026-11-13');
});
test('month, adjacent-day and today actions preserve focus inside the panel', async () => {
 const { view, doc } = await fixture();
 next(view).click(); assert.equal(selected(view), '2026-12-13');
 assert.ok(view.contentEl.contains(doc.activeElement));
 day(view, '2026-11-30').click(); assert.equal(selected(view), '2026-11-30');
 assert.equal(doc.activeElement.dataset.dateKey, '2026-11-30');
 assert.ok(view.contentEl.contains(doc.activeElement));
 today(view).click(); assert.equal(selected(view), '2026-11-13');
});
test('render skips unchanged state and settings refresh reads current settings', async () => {
 const { view, settings, leaf } = await fixture();
 const card = view.contentEl.children[0]; view.render(); assert.equal(view.contentEl.children[0], card);
 settings.calendarWeekStart = 'sunday'; settings.calendarSidebarShowWeekNumbers = false;
 settings.dateDisplayFormat = 'DD/MM/YYYY'; leaf.app.locale = 'tr-TR'; view.render();
 assert.notEqual(view.contentEl.children[0], card);
 assert.equal(view.contentEl.children[0].children[1].children.length, 7);
 assert.equal(today(view).textContent, '13 Kasım');
 assert.equal(selected(view), '2026-11-13');
});
test('picker toggle, external close and selection use current dates and restore focus', async () => {
 const { view, doc } = await fixture();
 const anchor = year(view); anchor.click(); assert.equal(anchor.attrs['aria-expanded'], 'true');
 anchor.click(); assert.equal(anchor.attrs['aria-expanded'], 'false');
 next(view).click(); const current = year(view); current.click();
 const picker = current.picker; assert.equal(picker.options.dateKey, '2026-12-13');
 picker.close(); assert.equal(doc.activeElement, current);
 picker.options.onSelect('2027-02-13'); assert.equal(selected(view), '2027-02-13');
 assert.ok(view.contentEl.contains(doc.activeElement));
});
test('midnight and wake-up refresh today without changing selected date', async () => {
 const { view, doc, setNow } = await fixture();
 const win = doc.defaultView;
 assert.equal(win.timers.size, 1);
 assert.equal([...win.timers.values()][0].delay, 12 * 60 * 60 * 1000);
 setNow(new Date(2026, 10, 14)); win.wake();
 assert.equal(selected(view), '2026-11-13');
 assert.ok(day(view, '2026-11-14').classes.has('is-today'));
 setNow(new Date(2026, 10, 16, 9)); win.emit('focus');
 assert.ok(day(view, '2026-11-16').classes.has('is-today')); assert.equal(win.timers.size, 1);
});
test('migration and close release old listeners, timers and picker', async () => {
 const { view, doc, leaf } = await fixture();
 const anchor = year(view); anchor.click();
 const newDoc = document(); leaf.contentEl.ownerDocument = newDoc;
 leaf.containerEl.migrate();
 assert.equal(doc.count(), 0); assert.equal(doc.defaultView.count(), 0); assert.equal(doc.defaultView.timers.size, 0);
 assert.equal(anchor.picker, null); assert.equal(newDoc.defaultView.timers.size, 1);
 await view.onClose();
 assert.equal(newDoc.count(), 0); assert.equal(newDoc.defaultView.count(), 0); assert.equal(newDoc.defaultView.timers.size, 0);
 assert.equal(leaf.contentEl.count(), 0); assert.equal(leaf.containerEl.migrate, null);
});
test('opening coalesces concurrent calls and reveals an existing moved panel without resetting its state', async () => {
 const { view, leaf } = await fixture();
 let created = 0, revealed = 0, loaded = 0, exists = false;
 let release;
 leaf.setViewState = async state => { assert.equal(state.type, MINI_CALENDAR_VIEW_TYPE); created++; await new Promise(resolve => { release = resolve; }); exists = true; };
 leaf.loadIfDeferred = async () => { loaded++; };
 const workspace = { getLeavesOfType: () => exists ? [leaf] : [], getLeftLeaf: () => leaf, revealLeaf: async target => { assert.equal(target, leaf); revealed++; } };
 const first = openMiniCalendar(workspace), second = openMiniCalendar(workspace);
 assert.equal(created, 1); release(); await Promise.all([first, second]);
 assert.equal(revealed, 1); assert.equal(loaded, 1);
 day(view, '2026-11-19').click();
 workspace.getLeftLeaf = () => { throw new Error('Moved view must be reused'); };
 await openMiniCalendar(workspace); assert.equal(selected(view), '2026-11-19'); assert.equal(created, 1);
});
test('failed opening can be retried', async () => {
 const { leaf } = await fixture();
 let available = false;
 leaf.loadIfDeferred = async () => {}; leaf.setViewState = async () => {};
 const workspace = { getLeavesOfType: () => [], getLeftLeaf: () => available ? leaf : null, revealLeaf: async () => {} };
 await assert.rejects(openMiniCalendar(workspace)); available = true; await openMiniCalendar(workspace);
});
test('arrow keys neither navigate mini calendar nor pass the large calendar target guard', async () => {
 const { view, doc } = await fixture(); next(view).click();
 const before = selected(view);
 for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) doc.emit('keydown', { key, target: doc.activeElement });
 assert.equal(selected(view), before);
 const source = readFileSync(path.join(root, 'src/ui/calendar/calendar-view.ts'), 'utf8');
 const ast = ts.createSourceFile('calendar.ts', source, ts.ScriptTarget.Latest, true);
 const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(ast) === 'isCalendarArrowNavigationTargetAllowed'));
 const member = owner.members.find(member => member.name?.getText(ast) === 'isCalendarArrowNavigationTargetAllowed');
 const code = ts.transpileModule(`class Subject { ${member.getText(ast)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
 const guard = new Function('asHTMLElement', 'getOwnerDocument', `${code}; return Subject.prototype.isCalendarArrowNavigationTargetAllowed;`)(target => target, () => doc);
 assert.equal(guard.call({ containerEl: new Element(doc) }, doc.activeElement), false);
});

test('header focus survives date-format reorder', async () => {
 const { view, doc, settings } = await fixture();
 year(view).focus(); settings.dateDisplayFormat = 'DD/MM/YYYY'; view.render();
 assert.equal(doc.activeElement, year(view));
 today(view).focus(); settings.dateDisplayFormat = 'YYYY-MM-DD'; view.render();
 assert.equal(doc.activeElement, today(view));
});


test('day and week selections open notes, while navigation only changes the date', async () => {
 const { view, settings, opened } = await fixture();
 const settle = () => new Promise(resolve => setImmediate(resolve));
 next(view).click(); today(view).click(); year(view).click();
 year(view).picker.close(); assert.equal(opened.length, 0);
 day(view, '2026-11-13').click(); await settle();
 day(view, '2026-11-13').click(); await settle();
 assert.deepEqual(opened.map(item => item.kind), ['daily', 'daily']);
 settings.calendarWeekStart = 'sunday'; view.render();
 const week = buttons(view).find(button => button.dataset.weekDate === '2026-11-02');
 assert.ok(week); week.click(); await settle();
 assert.equal(opened.at(-1).dateKey, '2026-11-02'); assert.equal(opened.at(-1).kind, 'weekly');
 assert.equal(selected(view), '2026-11-13');
 settings.calendarSidebarShowWeekNumbers = false; view.render();
 assert.equal(buttons(view).filter(button => button.dataset.weekDate).length, 0);
 await view.onClose(); assert.equal(opened.at(-1).isCurrent(), false);
});
