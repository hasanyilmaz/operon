import { assertMiniCalendarGeometry } from './test-support/mini-calendar-geometry.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const bundle = await build({
 stdin: { contents: "export { MiniCalendarView } from './src/ui/calendar/mini-calendar-view';", resolveDir: root },
 bundle: true, write: false, format: 'iife', globalName: 'Subject', platform: 'browser', logLevel: 'silent',
 plugins: [{ name: 'obsidian-host', setup(builder) {
  builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'host', namespace: 'host' }));
  builder.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
   export * from ${JSON.stringify(path.join(root, 'scripts/test-support/obsidian.ts'))};
   export class ItemView {
    constructor(leaf) { this.app = leaf.app; this.leaf = leaf; this.contentEl = leaf.contentEl; this.containerEl = leaf.containerEl; }
   }
  `, resolveDir: root }));
 } }],
});
async function installHost(page) { await page.evaluate(() => {
   Element.prototype.createEl = function(tag, options = {}) {
    const el = this.ownerDocument.createElement(tag);
    if (typeof options === 'string') el.className = options;
    else { if (options.cls) el.className = options.cls; if (options.text) el.textContent = options.text;
     for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value); }
    this.appendChild(el); return el;
   };
   Element.prototype.createDiv = function(options) { return this.createEl('div', options); };
   Element.prototype.createSpan = function(options) { return this.createEl('span', options); };
   Element.prototype.addClass = function(...names) { this.classList.add(...names); };
   Element.prototype.removeClass = function(...names) { this.classList.remove(...names); };
   Element.prototype.toggleClass = function(name, value) { this.classList.toggle(name, value); };
   Element.prototype.setCssStyles = function(styles) { Object.assign(this.style, styles); };
   Element.prototype.setCssProps = function(styles) { for (const [key, value] of Object.entries(styles)) this.style.setProperty(key, value); };
   Element.prototype.setText = function(text) { this.textContent = text; };
   Element.prototype.empty = function() { this.replaceChildren(); };
   Element.prototype.onWindowMigrated = function(callback) { this.migrate = callback; return () => { this.migrate = null; }; };
   document.win = window;
   window.createEl = (tag, options) => document.body.createEl(tag, options);
   window.createSpan = options => document.body.createSpan(options);
  });
}
const engine = process.env.OPERON_TEST_ENGINE || 'chromium';
const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
const css = readFileSync(path.join(root, 'styles.css'), 'utf8');
let scenarios = 0;
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function state(page) {
 return page.evaluate(() => {
  const scroll = document.querySelector('.operon-mini-calendar-scroll'), rect = scroll.getBoundingClientRect();
  const rows = [...scroll.querySelectorAll('.operon-mini-calendar-week')];
  const centers = rows.map(row => ({ date: row.dataset.weekStart, rect: row.getBoundingClientRect() }));
  const center = centers.find(row => row.rect.top <= rect.top + rect.height / 2 && row.rect.bottom > rect.top + rect.height / 2);
  const today = document.querySelector('[data-date-key="2027-01-13"]')?.closest('.operon-mini-calendar-week')?.getBoundingClientRect();
  return { center: center?.date, fraction: center ? (rect.top + rect.height / 2 - center.rect.top) / center.rect.height : null,
   top: scroll.scrollTop, height: rect.height, pitch: rows[0].getBoundingClientRect().height, count: rows.length,
   days: [...scroll.querySelectorAll('[data-date-key]')].map(button => button.dataset.dateKey),
   selected: view.anchorDate, reference: view.navigationDate, opened: opened.length,
   todayOffset: today ? today.top + today.height / 2 - rect.top - rect.height / 2 : null,
   overflow: document.getElementById('panel').scrollWidth - document.getElementById('panel').clientWidth,
   tabOutside: rows.filter(row => { const r = row.getBoundingClientRect(); return r.bottom <= rect.top || r.top >= rect.bottom; }).some(row => [...row.querySelectorAll('button')].some(button => button.tabIndex === 0)) };
 });
}
try {
 for (const touch of [false, true]) for (const width of [240, 320, 420]) for (const height of [240, 480, 720]) {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, hasTouch: touch, timezoneId: 'Europe/Berlin' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(4000);
  console.log(`${engine} ${width}x${height} touch=${touch}`);
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;--font-ui-small:13px;--background-modifier-border:#555;--text-normal:#eee;--text-muted:#aaa;--text-faint:#777;--interactive-accent:#40a0ff;--text-accent:#40a0ff;--background-primary:#222;--background-secondary:#333;--layer-menu:65;font:13px sans-serif}button{font:inherit;padding:4px 10px;min-height:28px}#panel{width:${width}px;height:${height}px}#outside{position:absolute;left:600px;top:20px}</style><style>${css}</style><div id="panel"></div><button id="outside">Outside</button>`);
  await installHost(page); await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async () => {
   window.settings = { language: 'en', dateDisplayFormat: 'YYYY-MM-DD', calendarWeekStart: 'monday', calendarSidebarShowWeekNumbers: true, weeklyNoteFormat: 'GGGG-[W]WW' };
   const root = document.getElementById('panel'); window.app = { locale: 'en-US' }; window.opened = []; window.now = new Date(2027, 0, 13, 12);
   window.view = new Subject.MiniCalendarView({ app, contentEl: root, containerEl: root }, () => settings, () => now, async request => { opened.push(request); });
   await view.onOpen();
  });
  await settle(page);
  await assertMiniCalendarGeometry(page, true);
  if (width === 320 && height === 480) {
   // Month tones stay anchored to the real current month across navigation and year boundaries.
   const tone = date => page.locator(`[data-date-key="${date}"]`).evaluate(button => ({
    color: getComputedStyle(button.firstElementChild).color,
    week: getComputedStyle(document.querySelector('[data-week-date]')).color,
   }));
   for (const [date, muted] of [['2026-11-02', false], ['2026-12-01', true], ['2027-01-04', false],
    ['2027-02-01', true], ['2027-02-06', true], ['2027-03-02', false], ['2027-12-02', true], ['2028-01-03', false]]) {
    await page.evaluate(date => view.navigate(date), date); await settle(page);
    const selected = await tone(date); assert.notEqual(selected.color, selected.week, `selected ${date}`);
    await page.evaluate(() => view.selectDate('2027-01-13')); await settle(page);
    const result = await tone(date); assert.equal(result.color === result.week, muted, date);
   }
   await page.evaluate(() => { view.navigate('2027-02-02'); view.selectDate('2027-01-13'); }); await settle(page);
   const before = await state(page);
   await page.evaluate(() => { window.toneCell = document.querySelector('[data-date-key="2027-02-02"]'); now = new Date(2027, 1, 1, 12); view.render(); }); await settle(page);
   const updated = await tone('2027-02-02'); assert.notEqual(updated.color, updated.week);
   assert.equal(await page.evaluate(() => toneCell === document.querySelector('[data-date-key="2027-02-02"]')), true);
   assert.equal((await state(page)).top, before.top);
   assert.equal((await state(page)).selected, '2027-01-13');
   await page.evaluate(() => { now = new Date(2027, 0, 13, 12); view.navigate('2027-01-13'); }); await settle(page);
   assert.equal((await state(page)).opened, 0);
  }
  let current = await state(page);
  assert.equal(current.center, '2027-01-11'); assert.ok(Math.abs(current.todayOffset) < 1, JSON.stringify(current));
  assert.equal(current.selected, '2027-01-13'); assert.equal(current.reference, '2027-01-13');
  assert.ok(current.overflow <= 1); assert.equal(current.tabOutside, false);
  if (touch) assert.ok(await page.locator('[data-date-key="2027-01-13"]').evaluate(el => el.getBoundingClientRect().height >= 44));
  const scroll = page.locator('.operon-mini-calendar-scroll');
  await scroll.hover(); await page.mouse.wheel(0, current.pitch * 4 + 9); await page.waitForTimeout(250);
  current = await state(page);
  assert.notEqual(current.center, '2027-01-11'); assert.equal(current.selected, '2027-01-13'); assert.equal(current.opened, 0);
  const reference = current.reference, position = {center:current.center,fraction:current.fraction};
  assert.equal(new Date(reference+'T12:00:00').getDay(), 3);
  await page.evaluate(h => { document.getElementById('panel').style.height = `${h}px`; }, height + 83); await settle(page);
  current = await state(page); assert.equal(current.center, position.center); assert.ok(Math.abs(current.fraction-position.fraction)<0.03);
  await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; }); await settle(page);
  await page.evaluate(() => { document.getElementById('panel').style.display = ''; }); await settle(page);
  assert.equal((await state(page)).center, position.center);
  // Navigate far enough to cross the bounded native runway in both directions.
  for (const direction of [1, -1]) for (let step=0;step<3;step++) {
   await scroll.evaluate((el, delta) => { el.scrollTop += delta; }, direction * 16000); await page.waitForTimeout(190);
   const next = await state(page);
   assert.equal(new Set(next.days).size, next.days.length);
   for (let i=1;i<next.days.length;i++) assert.equal((Date.parse(next.days[i])-Date.parse(next.days[i-1]))/86400000,1);
   assert.ok(next.count <= Math.ceil(next.height/next.pitch)*3+4, JSON.stringify(next));
   assert.equal(next.selected, '2027-01-13'); assert.equal(next.opened,0);
  }
  await page.locator('.operon-calendar-date-button').click(); await settle(page);
  current = await state(page); assert.ok(Math.abs(current.todayOffset)<1); assert.equal(current.opened,0);
  const y = current.top;
  await page.locator('[data-date-key="2027-01-14"]').focus(); await page.keyboard.press('Enter'); await settle(page);
  current = await state(page); assert.equal(current.selected,'2027-01-14'); assert.equal(current.opened,1); assert.equal(current.top,y);
  for (const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']) await page.keyboard.press(key);
  assert.equal((await state(page)).top,y);
  await page.keyboard.press('Space'); assert.equal(await page.evaluate(()=>opened.length),2);
  await page.evaluate(() => { now = new Date(2027,0,15,12); view.render(); }); await settle(page);
  assert.equal((await state(page)).top,y); assert.equal((await state(page)).selected,'2027-01-14');
  assert.ok(await page.locator('[data-date-key="2027-01-15"]').evaluate(el=>el.classList.contains('is-today')));
  // A year picker uses the current header; scrolling closes it and invalidates pending openings.
  await page.locator('.operon-calendar-year-button').click(); await page.locator('.operon-calendar-month-picker').waitFor();
  await scroll.evaluate(el => { el.scrollTop += 90; }); await settle(page);
  assert.equal(await page.locator('.operon-calendar-month-picker').count(),0);
  assert.equal(await page.evaluate(()=>opened.at(-1).isCurrent()),false);
  const modeReference=(await state(page)).reference;
  await page.evaluate(()=>{settings.miniCalendarViewMode='month';view.render();});
  assert.equal(await page.locator('[data-date-key]').count(),42);
  await page.evaluate(()=>{settings.miniCalendarViewMode='continuous';view.render();}); await settle(page);
  assert.equal((await state(page)).reference,modeReference);
  // Labeling and week-start preference do not change note identity.
  await page.evaluate(()=>{view.navigate('2027-02-01');}); await settle(page);
  assert.equal(await page.locator('[data-date-key="2027-02-01"] .operon-mini-month-label').textContent(),'Feb');
  assert.equal(await page.locator('[data-date-key="2027-02-01"] .operon-mini-day-number').count(),0);
  await page.locator('[data-date-key="2027-02-01"] .operon-mini-month-label').click();
  assert.equal(await page.evaluate(()=>opened.at(-1).dateKey),'2027-02-01');
  assert.equal(await page.evaluate(()=>opened.at(-1).kind),'daily');
  assert.equal(await page.locator('.is-outside-month').count(),0);
  await page.evaluate(()=>{settings.calendarWeekStart='sunday';view.render();}); await settle(page);
  const febWeek = page.locator('[data-week-date="2027-02-01"]'); await febWeek.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>opened.at(-1).dateKey),'2027-02-01');
  assert.equal(await page.evaluate(()=>opened.at(-1).kind),'weekly');
  await page.evaluate(()=>{settings.calendarSidebarShowWeekNumbers=false;view.render();}); await settle(page);
  assert.equal(await page.locator('[data-week-date]').count(),0);
  // Full supported year range, leap years and DST dates remain valid and centered.
  for(const date of ['0001-01-01','0099-12-31','2024-02-29','2027-03-28','2027-10-31','9999-12-31']) {
   await page.evaluate(date=>view.navigate(date),date);await settle(page);
   assert.equal((await state(page)).selected,date);assert.equal((await state(page)).reference,date);
   assert.equal(await page.locator(`[data-date-key="${date}"]`).count(),1);
  }
  await page.evaluate(()=>view.navigate('2027-01-13')); await settle(page);
  // Gesture cancellation is exercised independently of browser synthesis of compatibility clicks.
  await page.evaluate(()=>{
   const button=document.querySelector('[data-date-key="2027-01-13"]');window.beforeGesture=opened.length;
   const send=(type,x,id=1)=>button.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:x,clientY:150}));
   send('pointerdown',10);send('pointermove',30);send('pointerup',30);
   button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
   send('pointerdown',10);send('pointercancel',10);button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
   send('pointerdown',10);send('pointerdown',10,2);send('pointerup',10);send('pointerup',10,2);button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
  });
  assert.equal(await page.evaluate(()=>opened.length),await page.evaluate(()=>beforeGesture));
  if(touch) {
   await page.waitForTimeout(200); await page.locator('[data-date-key="2027-01-13"]').tap();
   assert.equal(await page.evaluate(()=>opened.length),await page.evaluate(()=>beforeGesture+1));
  }
  if (engine === 'chromium' && touch && width === 320 && height === 480) {
   await page.evaluate(()=>view.navigate('2027-01-13')); await settle(page); await page.waitForTimeout(200);
   const before = await page.evaluate(()=>opened.length);
   const box = await scroll.boundingBox(); const x=box.x+box.width/2, y=box.y+box.height*0.7;
   const cdp = await context.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let step=1;step<=8;step++) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*15}]});
    await page.waitForTimeout(16);
   }
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(25);
   // A touch that arrests momentum must not activate the cell underneath it.
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y-60}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(200);
   assert.notEqual((await state(page)).center,'2027-01-11');
   assert.equal(await page.evaluate(()=>opened.length),before);
   await cdp.detach();
  }
  if (!touch && width === 320 && height === 480) {
   await page.evaluate(()=>view.navigate('2027-01-13')); await settle(page);
   // Native Tab advances into visible rows; retained controls survive week-window reconciliation.
   await page.locator('[data-date-key="2027-01-13"]').focus();
   await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.dataset.dateKey),'2027-01-14');
   await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(()=>document.activeElement.dataset.dateKey),'2027-01-13');
   await scroll.evaluate(el=>{el.scrollTop+=5;}); await settle(page);
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.dateKey),'2027-01-13');
   await scroll.evaluate(el=>{el.scrollTop+=4000;}); await settle(page);
   assert.ok(await page.evaluate(()=>document.activeElement.classList.contains('operon-mini-calendar-scroll')));
   // Adoption models a pop-out window: the same view binds to its new owner window.
   const before = await state(page);
   await page.evaluate(()=>{
    window.previousScroller=view.scroller;
    const frame=document.createElement('iframe');frame.id='migration';frame.style.cssText='width:500px;height:850px';document.body.appendChild(frame);
    for(const style of document.querySelectorAll('style')) frame.contentDocument.head.appendChild(style.cloneNode(true));
   });
   const frame=page.frames().find(candidate=>candidate!==page.mainFrame());await installHost(frame);
   await page.evaluate(()=>{
    const child=document.getElementById('migration').contentWindow, root=document.getElementById('panel');
    Object.assign(child,{view,opened,settings,app});child.document.body.appendChild(child.document.adoptNode(root));root.migrate();
   });await settle(frame);
   const after=await state(frame);assert.equal(after.center,before.center);assert.ok(Math.abs(after.fraction-before.fraction)<0.03);
   assert.ok(await page.evaluate(()=>previousScroller.disposed));
   assert.ok(await frame.evaluate(()=>view.timerWindow===window));
   await frame.evaluate(()=>view.onClose());assert.ok(await frame.evaluate(()=>view.scroller===null && view.input===null));
  }
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>view.onClose());
  assert.equal(await page.locator('.operon-calendar-month-picker').count(),0);
  await context.close(); scenarios++;
 }
 console.log(JSON.stringify({status:'passed',engine,scenarios}));
} finally { await browser.close(); }
