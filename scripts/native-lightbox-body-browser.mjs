import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.OPERON_TEST_PLAYWRIGHT || 'playwright');
const bundle = await build({ stdin: { contents: `
export {EditorState, EditorSelection, Transaction, StateEffect} from '@codemirror/state';
export {EditorView, keymap} from '@codemirror/view';
export {editorInfoField} from 'obsidian';
export * from './src/ui/native-lightbox-body';
export * from './src/ui/native-lightbox-layout';
export {NativeLightboxLifecycle} from './src/ui/native-lightbox-lifecycle';
`, resolveDir: root }, bundle: true, write: false, format: 'iife', globalName: 'Subject', platform: 'browser', logLevel: 'silent', alias: { obsidian: path.join(root, 'scripts/test-support/obsidian.ts') } });
const browser = await chromium.launch({ headless: true, ...(process.env.OPERON_TEST_BROWSER ? { executablePath: process.env.OPERON_TEST_BROWSER } : {}) });
let checks = 0;
try {
	const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<style>${readFileSync(path.join(root, 'styles.css'), 'utf8')}</style>
	<div class="operon-native-workspace"><div class="is-markdown"><div class="workspace-leaf-content" data-type="markdown"><div class="view-content">
	<div class="markdown-source-view" id="editor"></div>
	<div class="markdown-reading-view"><div class="markdown-preview-view"><div class="markdown-preview-sizer"><div class="mod-header"><div id="reading-properties" class="metadata-container">Secret properties</div></div><div><pre class="frontmatter" id="reading-yaml">title: Secret</pre></div><div><p>Reading body</p></div><div class="internal-embed"><div class="metadata-container" id="embed-properties">Embedded properties</div></div></div></div></div>
	</div></div></div></div><div id="ordinary"></div>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const S = Subject;
		window.app = {};
		window.info = { app, file: { path: 'Same.md' }, editor: {} };
		window.nativeView = { editor: info.editor, getViewType: () => 'markdown' };
		window.life = new S.NativeLightboxLifecycle(app, { view: nativeView });
		window.prefix = '---\ntitle: Secret\n---\n';
		window.createState = (doc, owned = true) => S.EditorState.create({ doc, extensions: [
			S.editorInfoField.init(() => owned ? info : { ...info, editor: {} }),
			S.nativeLightboxBodyExtension(app),
			S.keymap.of([{ key: 'Mod-a', run: view => { view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, userEvent: 'select' }); return true; } }]),
		] });
		window.editor = new S.EditorView({ parent: document.querySelector('#editor'), state: createState(prefix + 'Body\nSecond line') });
		window.normal = new S.EditorView({ parent: document.querySelector('#ordinary'), state: createState(prefix + 'Body', false) });
		// Native source view puts its metadata editor directly inside this sizer.
		const sizer = document.createElement('div'); sizer.className = 'cm-sizer';
		const properties = document.createElement('div'); properties.className = 'metadata-container'; properties.id = 'source-properties'; properties.textContent = 'Secret properties';
		editor.scrollDOM.appendChild(sizer); sizer.appendChild(properties);
	});
	await page.waitForTimeout(30);
	assert.equal(await page.locator('#editor .cm-content').innerText(), 'Body\nSecond line'); checks++;
	assert.match(await page.locator('#ordinary .cm-content').innerText(), /Secret/u); checks++;
	for (const id of ['reading-properties', 'source-properties', 'reading-yaml']) { assert.equal(await page.locator(`#${id}`).isVisible(), false); checks++; }
	assert.equal(await page.locator('#embed-properties').isVisible(), true); checks++;
	await page.locator('#editor .cm-content').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
	assert.equal(await page.evaluate(() => editor.state.selection.main.from), '---\ntitle: Secret\n---\n'.length); checks++;
	await page.keyboard.insertText('Edited body');
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\ntitle: Secret\n---\nEdited body'); checks++;
	await page.evaluate(() => editor.dispatch({ selection: { anchor: prefix.length }, userEvent: 'select' }));
	await page.keyboard.press('Backspace');
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\ntitle: Secret\n---\nEdited body'); checks++;
	await page.evaluate(() => editor.dispatch({ changes: [{ from: 11, to: 17, insert: 'Changed' }, { from: prefix.length, to: editor.state.doc.length, insert: 'Replaced' }], userEvent: 'input.replace.all' }));
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\ntitle: Secret\n---\nReplaced'); checks++;
	// Real native history uses filter:false. Body undo must keep all effects;
	// an older history entry that edits YAML must not bypass the boundary.
	await page.evaluate(() => editor.dispatch(editor.state.update({ changes: { from: prefix.length, to: editor.state.doc.length, insert: 'Edited body' }, userEvent: 'undo', filter: false })));
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\ntitle: Secret\n---\nEdited body'); checks++;
	await page.evaluate(() => editor.dispatch(editor.state.update({ changes: { from: 4, to: 17, insert: 'title: Lost' }, userEvent: 'undo', filter: false })));
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\ntitle: Secret\n---\nEdited body'); checks++;
	await page.evaluate(() => editor.dispatch({ changes: { from: 11, to: 17, insert: 'External' }, userEvent: 'set' }));
	assert.match(await page.evaluate(() => editor.state.doc.toString()), /title: External/u); checks++;
	assert.equal(await page.locator('#editor .cm-content').innerText(), 'Edited body'); checks++;
	assert.equal(await page.evaluate(() => {
		const first = editor.state.update({ changes: { from: editor.state.doc.length, insert: ' A' } });
		const second = { changes: { from: editor.state.doc.length, insert: ' B' } };
		const expected = editor.state.update(first, second).newDoc.toString();
		editor.dispatch(first, second);
		return editor.state.doc.toString() === expected;
	}), true, 'all native dispatch overload arguments are preserved'); checks++;
	await page.evaluate(() => {
		editor.setState(createState('---\n---'));
		window.firstEdit = editor.state.update({ changes: { from: 7, insert: 'Body' }, userEvent: 'input.type' });
		editor.dispatch(firstEdit);
		editor.dispatch(editor.state.update({ changes: firstEdit.changes.invert(firstEdit.startState.doc), userEvent: 'undo', filter: false }));
	});
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\n---'); checks++;
	await page.evaluate(() => editor.dispatch(editor.state.update({ changes: firstEdit.changes, userEvent: 'redo', filter: false })));
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\n---\nBody'); checks++;
	await page.evaluate(() => {
		editor.setState(createState(''));
		window.pastedDocument = editor.state.update({ changes: { from: 0, insert: prefix + 'Pasted body' }, userEvent: 'input.paste' });
		editor.dispatch(pastedDocument);
		editor.dispatch(editor.state.update({ changes: pastedDocument.changes.invert(pastedDocument.startState.doc), userEvent: 'undo', filter: false }));
	});
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), ''); checks++;
	await page.evaluate(() => editor.dispatch(editor.state.update({ changes: pastedDocument.changes, userEvent: 'redo', filter: false })));
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\ntitle: Secret\n---\nPasted body'); checks++;
	for (const doc of ['---\n---', '---\n---\n', '---\r\ntitle: Secret\r\n---\r\nBody', 'No YAML', '---\nUnclosed']) {
		await page.evaluate(doc => editor.setState(createState(doc)), doc);
		await page.waitForTimeout(10);
		if (doc === '---\n---' || doc === '---\n---\n') {
			await page.evaluate(() => { editor.focus(); editor.dispatch({ selection: { anchor: editor.state.doc.length } }); });
			await page.keyboard.insertText('New body');
			assert.equal(await page.evaluate(() => editor.state.doc.toString()), '---\n---\nNew body');
		} else assert.equal(await page.locator('#editor .cm-content').innerText(), doc.startsWith('---\r') ? 'Body' : doc);
		checks++;
	}
	await page.evaluate(() => {
		editor.setState(createState(prefix + 'Body'));
		life.dispose();
		editor.dispatch({ changes: { from: 0, to: prefix.length }, userEvent: 'delete' });
	});
	assert.equal(await page.evaluate(() => editor.state.doc.toString()), 'Body'); checks++;
	assert.equal(errors.length, 0, errors.join('\n')); checks++;
	await page.evaluate(() => { editor.destroy(); normal.destroy(); });
	assert.equal(await page.evaluate(() => {
		const lifecycle = new Subject.NativeLightboxLifecycle(app, { view: nativeView });
		const view = new Subject.EditorView({ parent: document.querySelector('#ordinary'), state: createState(prefix + 'Body', false) });
		const original = view.dispatch;
		let restored = true;
		for (let index = 0; index < 20; index++) {
			view.setState(createState(prefix + 'Body'));
			restored &&= view.dispatch !== original;
			view.setState(createState(prefix + 'Body', false));
			restored &&= view.dispatch === original;
		}
		view.destroy(); lifecycle.dispose();
		return restored;
	}), true); checks++;
	for (const side of ['left', 'right']) for (const width of [1400, 900, 450]) {
		await page.setViewportSize({ width, height: 900 });
		const result = await page.evaluate(({ side, width }) => {
			const input = { viewport: { width, height: 900 }, markdown: { width: 1260, height: 810 }, companion: { width: 557, height: 320 }, side, margin: 48, railWidth: 52 };
			const layout = Subject.resolveNativeLightboxLayout(input);
			const boxes = {};
			for (const key of ['markdown', 'companion', 'rail']) {
				const el = document.createElement('div'), rect = layout[key];
				el.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
				document.body.appendChild(el);
				const measured = el.getBoundingClientRect();
				boxes[key] = { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
				el.remove();
			}
			return { layout, boxes, preferredWidth: input.markdown.width };
		}, { side, width });
		for (const key of ['markdown', 'companion', 'rail']) assert.deepEqual(result.boxes[key], result.layout[key]);
		assert.equal(result.preferredWidth, 1260);
		assert.equal(result.boxes.companion.top, result.boxes.markdown.top);
		assert.equal(result.layout.fits, width > 450);
		checks++;
	}
	await page.close();
} finally { await browser.close(); }
console.log(JSON.stringify({ ok: true, checks }));
