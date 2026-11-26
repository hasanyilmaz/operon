import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const liveSource = readFileSync(path.join(root, 'src/ui/live-preview-conceal.ts'), 'utf8');
// Exercise the private pointer binder unchanged, without exposing a production API.
const binder = liveSource.match(/function bindLivePreviewChipHoverState\(element: HTMLElement\): void \{[\s\S]*?\n\}/)?.[0];
assert.ok(binder);
assert.match(liveSource, /if \(Platform.isDesktopApp\) bindDescendantFocusVisible\(tailWrap\)/);
assert.match(readFileSync(path.join(root, 'src/ui/reading-task-row.ts'), 'utf8'), /if \(!options\?.staticPreview && Platform.isDesktopApp\) bindDescendantFocusVisible\(row\)/);
const bundle = await build({stdin:{contents:`export * from './src/ui/descendant-focus-visible'; const LIVE_PREVIEW_CHIP_HOVER_CLASS='is-operon-chip-hovered'; ${binder}; export {bindLivePreviewChipHoverState};`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Subject',platform:'browser',logLevel:'silent'});
const css = readFileSync(process.env.OPERON_TEST_CSS || path.join(root, 'styles.css'), 'utf8');
const browser = await chromium.launch({headless:true,...(process.env.OPERON_TEST_BROWSER ? {executablePath:process.env.OPERON_TEST_BROWSER} : {})});
let scenarios = 0;
try {
 for (const surface of ['live', 'reading', 'filter']) for (const dark of [false,true]) for (const width of [420,1200]) {
  const page = await browser.newPage({viewport:{width,height:700}});
  try {
   await page.setContent(`<style>body{margin:0;--background-secondary:${dark?'#252525':'#eee'};--background-modifier-border:#555;--text-normal:#aaa;--interactive-accent:#ee7700;--background-modifier-hover:#333}button{min-width:36px;min-height:30px}#host{position:absolute;left:20px;top:100px;width:calc(100% - 40px)}#before{position:absolute;top:20px}#after{position:absolute;top:600px}.overlay{position:fixed;inset:0;background:#0009;z-index:99999}.overlay input{margin:150px 30px}</style><style>${css}</style><button id="before">Before</button><div id="host"></div><button id="after">After</button>`);
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.evaluate(surface => {
    document.win=window;
    const div=(parent,cls)=>{const el=document.createElement('div');el.className=cls;parent.append(el);return el;};
    const host=document.getElementById('host');
    if(surface==='filter')host.className='operon-filter-surface';
    const row=div(host,surface==='live'?'operon-live-preview-tail-wrap operon-task-chip-surface':'operon-reading-task-row operon-task-chip-surface');row.id='row';
    const wrap=surface==='live'?row:div(row,'operon-reading-task-tail-wrap');
    const actions=div(wrap,surface==='live'?'operon-live-preview-tail-actions':'operon-reading-task-actions');
    const source=document.createElement('button');source.id='source';source.textContent='Source';source.className='operon-live-preview-edit operon-live-preview-action operon-task-chip-action';
    const gear=document.createElement('button');gear.id='gear';gear.textContent='Settings';gear.className='operon-live-preview-edit operon-task-chip-action';
    actions.append(source,gear);
    if(surface==='live'){Subject.bindLivePreviewChipHoverState(gear);Subject.bindLivePreviewChipHoverState(source);}
    window.cleanup=Subject.bindDescendantFocusVisible(row);
    const close=()=>{document.querySelector('.overlay')?.remove();gear.focus();};
    gear.onclick=()=>{const overlay=div(document.body,'overlay');const input=document.createElement('input');input.value='Unsaved draft';overlay.append(input);input.focus();overlay.onclick=event=>{if(event.target===overlay)close();};overlay.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};};
   }, surface);
   const state=()=>page.evaluate(()=>{const gear=document.getElementById('gear'),row=document.getElementById('row');return {active:document.activeElement.id,hover:gear.matches(':hover'),rowHover:row.matches(':hover'),hoverClass:gear.classList.contains('is-operon-chip-hovered'),focusVisible:gear.matches(':focus-visible'),rowFocus:row.classList.contains('has-descendant-focus-visible'),opacity:Number(getComputedStyle(document.getElementById('source')).opacity),border:getComputedStyle(gear).borderColor};});
   const settled=async()=>{await page.waitForTimeout(180);return state();};
   await page.mouse.move(3,500);const idle=await settled();assert.equal(idle.opacity,0);
   await page.locator('#gear').hover();assert.ok((await settled()).opacity>0,'real pointer hover reveals Source');
   await page.locator('#gear').click();await page.mouse.click(3,500);const returned=await settled();
   assert.equal(returned.active,'gear','native focus return is retained');assert.equal(returned.rowHover,false);assert.equal(returned.focusVisible,false);
   assert.equal(returned.hoverClass,false,'pointer-return focus cannot recreate hover');assert.equal(returned.opacity,0,'pointer-return focus cannot reveal Source');assert.equal(returned.border,idle.border,'pointer-return focus does not retain an accent border');
   await page.locator('#gear').hover();assert.ok((await settled()).opacity>0);
   await page.mouse.move(3,500);assert.equal((await settled()).opacity,0,'leaving real hover hides Source even while Settings retains pointer focus');
   await page.locator('#before').focus();await page.keyboard.press('Tab');await settled();
   assert.equal(await page.evaluate(()=>document.activeElement.id),'source','hidden Source remains reachable with Tab');
   await page.keyboard.press('Tab');let keyboard=await settled();assert.equal(keyboard.active,'gear');assert.equal(keyboard.focusVisible,true);assert.equal(keyboard.rowFocus,true);assert.ok(keyboard.opacity>0);
   await page.keyboard.press('Enter');await page.keyboard.press('Escape');keyboard=await settled();assert.equal(keyboard.active,'gear');assert.equal(keyboard.focusVisible,true);assert.ok(keyboard.opacity>0,'keyboard return preserves accessible actions');
   await page.locator('#after').click();assert.equal((await settled()).opacity,0);
   await page.evaluate(()=>window.cleanup());assert.equal(await page.locator('#row').evaluate(el=>el.classList.contains('operon-focus-visible-scope')),false);
   scenarios++;
  } finally {await page.close();}
 }
 console.log(JSON.stringify({ok:true,scenarios}));
} finally {await browser.close();}
