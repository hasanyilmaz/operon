import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const bundle = await build({ stdin: { contents: `
export {EditorState, Compartment} from '@codemirror/state';
export {EditorView} from '@codemirror/view';
export {editorInfoField, editorLivePreviewField} from 'obsidian';
export {DEFAULT_SETTINGS} from './src/types/settings';
export {nativeLightboxBodyExtension} from './src/ui/native-lightbox-body';
export {NativeLightboxLifecycle} from './src/ui/native-lightbox-lifecycle';
export {operonIndexRefreshEffect} from './src/ui/live-preview-conceal';
export {operonDynamicFileTaskFilterLivePreviewExtension} from './src/ui/dynamic-file-task-filter';
`, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'Subject', platform: 'browser', logLevel: 'silent',
alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') },
plugins: [{ name: 'filter-content-fixture', setup(builder) {
 builder.onLoad({ filter: /dynamic-file-task-filter\.ts$/ }, ({ path: filename }) => {
  if (filename !== path.join(root, 'src/ui/dynamic-file-task-filter.ts')) return;
  const source = readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const renderer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'renderDynamicFileTaskFilterSurface');
  assert.ok(renderer?.body);
  // Keep the real filter extension, context, block widget, host and placement.
  // Replace only task-row rendering, which is unrelated to the YAML boundary.
  const body = '{ instance.el.textContent = "Dynamic File Task Filter"; return true; }';
  return { contents: source.slice(0, renderer.body.getStart(ast)) + body + source.slice(renderer.body.end), loader: 'ts', resolveDir: path.dirname(filename) };
 });
} }] });
const browser = await chromium.launch({ headless: true, ...(process.env.OPERON_TEST_BROWSER ? { executablePath: process.env.OPERON_TEST_BROWSER } : {}) });
let checks = 0;
try {
 const page = await browser.newPage();
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.setContent(`<style>${readFileSync(path.join(root, 'styles.css'), 'utf8')}</style><div class="markdown-source-view" id="fixture"></div>`);
 await page.addScriptTag({ content: bundle.outputFiles[0].text });
 await page.evaluate(() => {
  document.win = window;
  window.createEl = tag => document.createElement(tag);
  HTMLElement.prototype.empty = function () { this.replaceChildren(); };
  window.setup = (doc, owned) => {
   const S = Subject, app = {}, info = { file: { path: 'File.md' }, editor: {} };
   const life = new S.NativeLightboxLifecycle(app, { view: { getViewType: () => 'markdown', editor: owned ? info.editor : {} } });
   const settings = structuredClone(S.DEFAULT_SETTINGS);
   settings.dynamicFileTaskFilterEnabled = true;
   settings.dynamicFileTaskFilterPlacement = 'body-top';
   const task = { operonId: 'root001', primary: { filePath: 'File.md', format: 'yaml' } };
   const deps = { getSettings: () => settings, indexer: { getFileTaskByPath: () => task } };
   const mode = new S.Compartment();
   const filter = S.operonDynamicFileTaskFilterLivePreviewExtension({ isDocumentEditor: () => true, getFilePath: () => 'File.md', getFilterDeps: () => deps, openDynamicFilterSettings() {} });
   const view = new S.EditorView({ parent: document.querySelector('#fixture'), state: S.EditorState.create({ doc, extensions: [S.editorInfoField.init(() => info), mode.of(S.editorLivePreviewField), S.nativeLightboxBodyExtension(app), filter] }) });
   // Native Obsidian supplies a cm-sizer around the CodeMirror content.
   const sizer = document.createElement('div'); sizer.className = 'cm-sizer';
   const contentContainer = view.contentDOM.parentElement; contentContainer.replaceWith(sizer); sizer.appendChild(contentContainer);
   window.current = { view, life, settings, mode };
  };
 });
 const host = page.locator('#fixture .operon-dynamic-file-task-filter-host');
 for (const owned of [true, false]) for (const doc of ['---\ntitle: Secret\n---\nBody', '---\n---', '---\n---\n', 'Body']) {
  await page.evaluate(({ doc, owned }) => setup(doc, owned), { doc, owned });
  for (const placement of ['body-top', 'body-bottom', 'body-top']) {
   await page.evaluate(placement => {
    current.settings.dynamicFileTaskFilterPlacement = placement;
    current.view.dispatch({ effects: Subject.operonIndexRefreshEffect.of() });
   }, placement);
   await page.waitForTimeout(80);
   assert.equal(await host.count(), 1, `${owned ? 'lightbox' : 'normal'} ${placement}: one filter for ${JSON.stringify(doc)}`);
   assert.equal(await host.isVisible(), true, `${placement} filter is visible`);
   assert.equal(await host.innerText(), 'Dynamic File Task Filter');
   assert.equal(await host.evaluate((element, placement) => element.classList.contains('operon-dynamic-file-task-filter-host--' + placement), placement), true);
   if (owned) assert.doesNotMatch(await page.locator('#fixture .cm-content').innerText(), /title: Secret/);
   else if (doc.includes('Secret')) assert.match(await page.locator('#fixture .cm-content').innerText(), /title: Secret/);
   assert.equal(await page.evaluate(() => current.view.state.doc.toString()), doc, 'render never writes the document');
   checks++;
  }
  await page.evaluate(() => current.view.dispatch({ effects: current.mode.reconfigure([]) }));
  await page.waitForTimeout(30);
  assert.equal(await host.count(), 0, 'native Source mode behavior remains unchanged'); checks++;
  await page.evaluate(() => current.view.dispatch({ effects: current.mode.reconfigure(Subject.editorLivePreviewField) }));
  await page.waitForTimeout(60);
  assert.equal(await host.isVisible(), true, 'filter returns in Live Preview'); checks++;
  await page.evaluate(() => { current.view.destroy(); current.life.dispose(); });
  assert.equal(await host.count(), 0, 'filter disposed'); checks++;
 }
 assert.deepEqual(errors, []); checks++;
 await page.close();
} finally { await browser.close(); }
console.log(JSON.stringify({ ok: true, checks }));
