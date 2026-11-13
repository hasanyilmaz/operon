import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
const temp=await mkdtemp(path.join(tmpdir(),'operon-month-picker-'));
after(()=>rm(temp,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'src/ui/calendar/calendar-month-picker.ts')],outfile:path.join(temp,'subject.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')},banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'}});
const {calendarNavigationLabels,calendarMonthTarget}=await import(pathToFileURL(path.join(temp,'subject.mjs')).href);
await build({
 entryPoints: [path.join(root, 'src/ui/calendar/mini-calendar.ts')],
 outfile: path.join(temp, 'mini.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
 plugins: [{ name: 'ui-stubs', setup(builder) {
  builder.onResolve({ filter: /operon-hover-tooltip|accessibility-label|^obsidian$/ }, args => ({ path: args.path, namespace: 'stub' }));
  builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
   export const setIcon = () => {};
   export const setAccessibleLabelWithoutTooltip = (el, value) => el.setAttribute('aria-label', value);
   export const bindOperonHoverTooltip = (el, options) => { el.tooltip = options.content; };
  ` }));
 } }],
});
const { renderMiniCalendar, renderCalendarDateNavigation, shiftCalendarMonth, calendarWeekNumber } = await import(pathToFileURL(path.join(temp, 'mini.mjs')).href);
const source=readFileSync(path.join(root,'src/ui/calendar/calendar-view.ts'),'utf8');
const ast=ts.createSourceFile('view.ts',source,ts.ScriptTarget.Latest,true);
const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.members.some(m=>m.name?.getText(ast)==='renderCalendarDateNavigation'));
function method(name,deps={}){const node=cls.members.find(m=>m.name?.getText(ast)===name);assert.ok(node);const js=ts.transpileModule(`class Subject {${node.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(deps),`${js};return Subject.prototype.${name};`)(...Object.values(deps));}
class Element {
 constructor(text = '', cls = '') {
  this.textContent = text;
  this.children = [];
  this.attrs = {};
  this.events = {};
  this.isConnected = true;
  this.classes = new Set(cls.split(' '));
  this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
 }
 createDiv(options = {}) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options); }
 createSpan(options = {}) { return this.createDiv(options); }
 createEl(_tag, options = {}) {
  const child = new Element(options.text, options.cls);
  child.attrs = options.attr || {};
  this.children.push(child);
  return child;
 }
 insertBefore(el, before) { this.children.splice(this.children.indexOf(el), 1); this.children.splice(this.children.indexOf(before), 0, el); }
 addEventListener(name, fn) { this.events[name] = fn; }
 setAttribute(key, value) { this.attrs[key] = value; }
 focus() { this.focused = true; }
 click() { this.events.click?.({ preventDefault() {}, stopPropagation() {} }); }
}
const formats=[['YYYY-MM-DD',['2026','October 8']],['DD/MM/YYYY',['8 October','2026']],['MM/DD/YYYY',['October 8','2026']]];
for(const [format,texts] of formats)for(const sidebar of [true,false])test(`${sidebar?'sidebar':'toolbar'} ${format}: DOM order, today and year routes`,()=>{
 let picker,selected,today=0,closed=0;
 const state={anchorDate:'2026-10-08',presetId:'keep'};
 const ctx={getSettings:()=>({dateDisplayFormat:format}),ensureState:()=>state,handleTodayButtonClick:()=>today++,updateLeafState:v=>selected=v,closeActivePresetPicker(){this.activeMonthPickerClose?.();this.activeMonthPickerClose=null;this.activeMonthPickerAnchor=null;}};
 ctx.openCalendarMonthPicker = method('openCalendarMonthPicker', {
  getAppLocale: () => 'en-US',
  showCalendarMonthPicker(_anchor, options) { picker = options; return () => { closed++; options.onClose(); }; },
 });
 const render = method('renderCalendarDateNavigation', { renderCalendarDateNavigation, getAppLocale: () => 'en-US' });
 const root=new Element();render.call(ctx,root,state,{},sidebar);const buttons=root.children[0].children;
 assert.deepEqual(buttons.map(b=>b.textContent),texts);
 const year=buttons.find(b=>b.textContent==='2026'),date=buttons.find(b=>b!==year);
 assert.equal(date.tooltip,'Go to today');date.click();assert.equal(today,1);year.click();assert.equal(picker.dateKey,state.anchorDate);assert.equal(year.attrs['aria-expanded'],'true');
 year.click();assert.equal(closed,1);assert.equal(selected,undefined);
 assert.equal(year.attrs['aria-expanded'], 'false'); assert.equal(year.focused, true);
 state.anchorDate = '2026-12-31';
 year.click();assert.equal(picker.dateKey, '2026-12-31');picker.onSelect('2027-02-08');assert.deepEqual(selected,{anchorDate:'2027-02-08'});
 ctx.closeActivePresetPicker();
 assert.equal(ctx.activeMonthPickerAnchor, null);
 const replacement = new Element(); render.call(ctx, replacement, state, {}, sidebar);
 const nextYear = replacement.children[0].children.find(button => button.textContent === '2026');
 nextYear.click(); assert.equal(nextYear.attrs['aria-expanded'], 'true');
 ctx.closeActivePresetPicker(); assert.equal(closed, 3);
 assert.equal(nextYear.attrs['aria-expanded'], 'false');
});
for(const [from,year,month,to]of [['2026-01-31',2026,1,'2026-02-28'],['2024-01-31',2024,1,'2024-02-29'],['2024-02-29',2025,1,'2025-02-28'],['2026-12-08',2027,0,'2027-01-08'],['2026-10-08',2026,9,'2026-10-08']])test(`month target ${from} to ${to}`,()=>assert.equal(calendarMonthTarget(from,year,month),to));
for(const locale of ['en-US','de-DE','tr-TR'])test(`localized month with explicit day-first order ${locale}`,()=>{
 const label=calendarNavigationLabels('2026-10-08','DD/MM/YYYY',locale);assert.equal(label.date,`8 ${new Intl.DateTimeFormat(locale,{month:'long'}).format(new Date(2026,9,8))}`);assert.equal(label.yearFirst,false);
});
test('today preserves existing return-to-today and time-grid scroll behavior',async()=>{
 const calls=[];const ctx={updateLeafState:async s=>calls.push(s),isTimeGridCompatibleSurface:()=>true,scheduleInitialScroll:(...args)=>calls.push(args),renderGeneration:4};
 await method('handleTodayButtonClick',{localToday:()=> '2026-10-17'}).call(ctx,{anchorDate:'2026-10-08',presetId:'keep'},{});
 assert.equal(calls[0].anchorDate,'2026-10-17');assert.equal(calls[0].presetId,'keep');assert.equal(calls[1][3],true);
});

for (const [from, delta, expected] of [
 ['10000-01-31', 1, '10000-02-29'], ['9999-12-31', 1, '10000-01-31'], ['0100-01-31', 1, '100-02-28'], ['2026-02-31', 1, '2026-04-03'], ['2026-11-00', 1, '2026-11-30'],
 ['2026-01-31', 1, '2026-02-28'], ['2024-01-31', 1, '2024-02-29'],
 ['2026-01-31', -1, '2025-12-31'], ['2026-12-31', 1, '2027-01-31'],
]) test(`month arrow ${from} ${delta}`, () => assert.equal(shiftCalendarMonth(from, delta), expected));

function miniOptions(overrides = {}) {
 return { dateKey: '2026-11-13', today: '2026-11-13', locale: 'en-US', dateDisplayFormat: 'YYYY-MM-DD',
  weekStart: 'monday', showWeekNumbers: true, onToday() {}, onChooseMonth() {}, onShiftMonth() {}, onSelectDate() {}, ...overrides };
}
for (const weekStart of ['monday', 'sunday']) for (const showWeekNumbers of [true, false]) {
 test(`six-week grid ${weekStart}, week numbers ${showWeekNumbers}`, () => {
  const selected = [];
  const container = new Element();
  renderMiniCalendar(container, miniOptions({ weekStart, showWeekNumbers, onSelectDate: date => selected.push(date) }));
  const [nav, weekdays, grid] = container.children[0].children;
  assert.equal(weekdays.children.length, showWeekNumbers ? 8 : 7);
  assert.equal(weekdays.children[showWeekNumbers ? 1 : 0].textContent, weekStart === 'monday' ? 'Mon' : 'Sun');
  const days = grid.children.filter(el => el.classes.has('operon-calendar-sidebar-month-day'));
  assert.equal(days.length, 42);
  assert.equal(grid.children.length, showWeekNumbers ? 48 : 42);
  assert.equal(days.filter(el => el.classes.has('is-weekend')).length, 12);
  assert.equal(days.filter(el => el.classes.has('is-today')).length, 1);
  assert.equal(days.find(el => el.classes.has('is-anchor')).textContent, '13');
  assert.equal(days[0].classes.has('is-outside-month'), weekStart === 'monday');
  days[0].click();
  assert.deepEqual(selected, [weekStart === 'monday' ? '2026-10-26' : '2026-11-01']);
  assert.equal(nav.children.length, 3);
 });
}
test('week numbering preserves existing year-boundary conventions', () => {
 assert.equal(calendarWeekNumber(new Date(2021, 0, 1, 12), 'monday'), 53);
 assert.equal(calendarWeekNumber(new Date(2021, 0, 4, 12), 'monday'), 1);
 assert.equal(calendarWeekNumber(new Date(2021, 0, 3, 12), 'sunday'), 2);
});
test('separate instances route events independently and use current owner state', () => {
 const render = method('renderMiniMonth', { renderMiniCalendar, shiftCalendarMonth, getAppLocale: () => 'en-US', localToday: () => '2026-11-13' });
 const owners = ['2026-01-31', '2024-01-31'].map(anchorDate => {
  const owner = {
   state: { anchorDate, presetId: 'keep' },
   getSettings: () => ({ dateDisplayFormat: 'YYYY-MM-DD', calendarWeekStart: 'monday', calendarSidebarShowWeekNumbers: true }),
   ensureState() { return this.state; }, updateLeafState(state) { this.state = state; },
   openCalendarMonthPicker() {}, handleTodayButtonClick() {},
  };
  const container = new Element();
  render.call(owner, container, owner.state, {});
  return { owner, container };
 });
 owners[0].owner.state.anchorDate = '2026-03-31';
 owners[0].container.children[0].children[0].children[2].click();
 assert.equal(owners[0].owner.state.anchorDate, '2026-04-30');
 assert.equal(owners[1].owner.state.anchorDate, '2024-01-31');
 owners[1].container.children[0].children[0].children[2].click();
 assert.equal(owners[1].owner.state.anchorDate, '2024-02-29');
});
