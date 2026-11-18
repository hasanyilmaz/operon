import { assertMiniCalendarGeometry } from './test-support/mini-calendar-geometry.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
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
const browser = await chromium.launch({ headless: true, executablePath: process.env.OPERON_TEST_BROWSER });
let scenarios = 0;
try {
 for (const touch of [false, true]) for (const width of [240, 320, 420]) {
  const context = await browser.newContext({ viewport: { width: 800, height: 760 }, hasTouch: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  page.setDefaultTimeout(5000);
  console.log(`Checking ${width}px touch=${touch}`);
  await page.setContent(`<style>
   * { box-sizing:border-box } body { margin:0; --font-ui-small:13px; --background-modifier-border:#555; --text-normal:#eee; --text-muted:#aaa; --text-faint:#777; --interactive-accent:#40a0ff; --text-accent:#40a0ff; --background-primary:#222; --background-secondary:#333; --layer-menu:65; font:13px sans-serif; background:#222; color:#eee }
   button { font:inherit; padding:4px 10px; min-height:28px } #panel { width:${width}px } #outside { position:absolute; left:550px; top:30px }
   </style><style>${readFileSync(path.join(root, 'styles.css'), 'utf8')}</style><div id="panel"></div><button id="outside">Outside</button>`);
  await page.evaluate(() => {
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
   document.win = window;
   window.createEl = (tag, options) => document.body.createEl(tag, options);
   window.createSpan = options => document.body.createSpan(options);
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async () => {
   window.settings = { miniCalendarViewMode: 'month', language: 'en', dateDisplayFormat: 'YYYY-MM-DD', calendarWeekStart: 'monday', calendarSidebarShowWeekNumbers: true };
   const root = document.getElementById('panel');
   window.app = { locale: 'en-US' };
   window.opened = [];
   window.view = new Subject.MiniCalendarView({ app, contentEl: root, containerEl: root }, () => settings, () => new Date(2026, 10, 13, 12), async request => { opened.push({kind: request.kind, date: request.dateKey}); });
   await view.onOpen();
  });
  await assertMiniCalendarGeometry(page);
  const geometry = await page.evaluate(() => {
   const root = document.getElementById('panel');
   const rect = root.getBoundingClientRect();
   return { fits: [...root.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= rect.right + 1), overflow: root.scrollWidth - root.clientWidth, days: root.querySelectorAll('[data-date-key]').length };
  });
  assert.equal(geometry.days, 42);
  assert.ok(geometry.fits && geometry.overflow <= 1, `${width}px touch=${touch} calendar overflow ${JSON.stringify(geometry)}`);
  const activate = locator => touch ? locator.tap() : locator.click();
  await activate(page.locator('.operon-calendar-sidebar-month-nav-button').last());
  await activate(page.locator('[data-date-key="2026-11-30"]'));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.dateKey), '2026-11-30');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(key);
  assert.equal(await page.locator('.is-anchor[data-date-key]').getAttribute('data-date-key'), '2026-11-30');
  await page.locator('.operon-calendar-date-button').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.is-anchor[data-date-key]').getAttribute('data-date-key'), '2026-11-13');
  assert.equal(await page.evaluate(() => opened.length), 1);
  await page.locator('[data-week-date="2026-11-09"]').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => opened.at(-1)), {kind: 'weekly', date: '2026-11-09'});
  assert.equal(await page.locator('.is-anchor[data-date-key]').getAttribute('data-date-key'), '2026-11-13');
  await page.locator('.operon-calendar-year-button').focus();
  await page.keyboard.press('Space');
  await page.locator('.operon-calendar-month-picker').waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(errors, []);
  await page.keyboard.press('Escape');
  await page.locator('.operon-calendar-month-picker').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('operon-calendar-year-button')), true);
  await activate(page.locator('.operon-calendar-year-button'));
  await activate(page.locator('#outside'));
  await page.locator('.operon-calendar-month-picker').waitFor({ state: 'detached' });
  await page.locator('.operon-calendar-year-button').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('operon-calendar-date-button')), true);
  await page.evaluate(() => view.onClose());
  assert.deepEqual(errors, []);
  scenarios++;
  await context.close();
 }
 console.log(JSON.stringify({ status: 'passed', scenarios, widths: [240, 320, 420], touch: [false, true] }));
} finally { await browser.close(); }
