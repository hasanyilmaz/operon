import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState, Text, Transaction } from '@codemirror/state';
import { editorInfoField, type App, type Editor, type WorkspaceLeaf } from 'obsidian';
import { lightboxBodyStart, nativeLightboxBodyExtension } from '../src/ui/native-lightbox-body';
import { NativeLightboxLifecycle } from '../src/ui/native-lightbox-lifecycle';
import { markdownBodyStartLine } from '../src/core/markdown-body';
import { resolveNativeLightboxLayout } from '../src/ui/native-lightbox-layout';

const yaml = '---\ntitle: Secret\n---\n';
function fixture(doc = yaml + 'Body') {
	const app = {} as App, editor = {} as Editor;
	const info = { app, file: null, editor, hoverPopover: null };
	const view = { editor, getViewType: () => 'markdown' };
	const lifecycle = new NativeLightboxLifecycle(app, { view } as unknown as WorkspaceLeaf);
	const state = EditorState.create({ doc, extensions: [editorInfoField.init(() => info), nativeLightboxBodyExtension(app)] });
	return { app, lifecycle, state };
}

for (const [doc, start] of [
	['Body', 0], ['---\nNo ending fence', 0], ['---\n---\nBody', 8],
	['---\n---', 7], ['---\r\ntitle: Secret\r\n---\r\nBody', yaml.length],
	['\ufeff---\ntitle: Secret\n---\nBody', 0],
	['    ---\ncode\n    ---', 0], ['---\ntext: |\n  ---\n---\nBody', 22],
	['Body\n---\ncode\n---', 0], [yaml + '---\nMore body', yaml.length],
] as const) test(`frontmatter boundary preserves full-file coordinates: ${JSON.stringify(doc)}`, () => {
	assert.equal(lightboxBodyStart(Text.of(doc.split(/\r?\n/u))), start);
});

test('select all and search selection stop at the visible body; zero document changes', () => {
	const f = fixture();
	try {
		for (const userEvent of ['select', 'select.search', 'select.search.matches']) {
			const tr = f.state.update({ selection: { anchor: 0, head: f.state.doc.length }, userEvent });
			assert.equal(tr.newSelection.main.from, yaml.length);
			assert.equal(tr.docChanged, false);
		}
	} finally { f.lifecycle.dispose(); }
});

for (const userEvent of ['input.type', 'input.paste', 'delete.cut', 'delete.backward', 'input.replace', 'input.replace.all']) {
	test(`${userEvent} protects YAML while allowing body replacement`, () => {
		const f = fixture();
		try {
			const blocked = f.state.update({ changes: { from: 4, to: 9, insert: 'Lost' }, userEvent });
			assert.equal(blocked.newDoc.toString(), yaml + 'Body');
			const tr = f.state.update({ changes: { from: yaml.length, to: f.state.doc.length, insert: 'Edited' }, userEvent });
			assert.equal(tr.newDoc.toString(), yaml + 'Edited');
		} finally { f.lifecycle.dispose(); }
	});
}

test('typing and Backspace at the first body position do not consume the closing fence', () => {
	const f = fixture();
	try {
		assert.equal(f.state.update({ changes: { from: yaml.length, insert: 'New ' }, userEvent: 'input.type' }).newDoc.toString(), yaml + 'New Body');
		assert.equal(f.state.update({ changes: { from: yaml.length - 1, to: yaml.length }, userEvent: 'delete.backward' }).newDoc.toString(), yaml + 'Body');
	} finally { f.lifecycle.dispose(); }
});

test('native set, remote sync and programmatic Editor API updates can change YAML', () => {
	const f = fixture();
	try {
		for (const extra of [{ userEvent: 'set' }, {}, { annotations: Transaction.remote.of(true) }]) {
			assert.match(f.state.update({ changes: { from: 11, to: 17, insert: 'Updated' }, ...extra }).newDoc.toString(), /Updated/u);
		}
	} finally { f.lifecycle.dispose(); }
});

test('YAML-only files receive a separator only on their first body edit', () => {
	for (const doc of ['---\n---', '---\n---\n']) {
		const f = fixture(doc);
		try {
			assert.equal(f.state.update({}).newDoc.toString(), doc);
			assert.equal(f.state.update({ changes: { from: doc.length, insert: 'Body' }, userEvent: 'input.type' }).newDoc.toString(), '---\n---\nBody');
			assert.equal(f.state.update({ changes: { from: doc.length, insert: '\nBody' }, userEvent: 'input.paste' }).newDoc.toString(), doc + '\nBody');
		} finally { f.lifecycle.dispose(); }
	}
});

test('native navigation recomputes the body boundary without translating source coordinates', () => {
	const f = fixture();
	try {
		const next = f.state.update({ changes: { from: 0, to: f.state.doc.length, insert: 'Plain note' }, userEvent: 'set' }).state;
		assert.equal(next.update({ selection: { anchor: 0 } }).newSelection.main.from, 0);
		const back = next.update({ changes: { from: 0, to: next.doc.length, insert: yaml + 'Body' }, userEvent: 'set' }).state;
		assert.equal(back.update({ selection: { anchor: yaml.length + 2 } }).newSelection.main.from, yaml.length + 2);
	} finally { f.lifecycle.dispose(); }
});

test('the same file in an ordinary editor remains editable; disposal removes ownership', () => {
	const f = fixture();
	try {
		const ordinary = EditorState.create({ doc: yaml + 'Body', extensions: [editorInfoField, nativeLightboxBodyExtension(f.app)] });
		assert.equal(ordinary.update({ selection: { anchor: 0 }, userEvent: 'select' }).newSelection.main.from, 0);
		assert.equal(ordinary.update({ changes: { from: 0, to: yaml.length }, userEvent: 'delete' }).newDoc.toString(), 'Body');
		f.lifecycle.dispose();
		assert.equal(f.state.update({ changes: { from: 0, to: yaml.length }, userEvent: 'delete' }).newDoc.toString(), 'Body');
	} finally { f.lifecycle.dispose(); }
});

for (const side of ['left', 'right'] as const) test(`paired geometry anchors ${side}, shares top and clamps only Markdown`, () => {
	const input = { viewport: { width: 1400, height: 900 }, markdown: { width: 1260, height: 810 }, companion: { width: 557, height: 320 }, side, margin: 48, railWidth: 52 };
	const layout = resolveNativeLightboxLayout(input);
	assert.equal(layout.markdown?.width, 695);
	assert.equal(layout.markdown?.top, layout.companion?.top);
	assert.equal(layout.companion?.height, 320);
	assert.equal(layout.companion?.left, side === 'left' ? 48 : 795);
	assert.equal(layout.rail?.left, side === 'left' ? 605 : 743);
	assert.deepEqual(input.markdown, { width: 1260, height: 810 });
	const narrow = resolveNativeLightboxLayout({ ...input, viewport: { width: 450, height: 300 } });
	assert.equal(narrow.markdown?.width, 0);
	assert.equal(narrow.fits, false);
	assert.equal(narrow.companion?.width, 557);
	assert.equal(narrow.companion?.height, narrow.markdown?.height);
	const single = resolveNativeLightboxLayout({ ...input, companion: null });
	assert.equal(single.markdown?.left, 70);
	assert.equal(single.rail, null);
	const editor = resolveNativeLightboxLayout({ ...input, markdown: null });
	assert.equal(editor.companion?.left, layout.companion?.left);
});

test('native exact fence matching leaves existing shared-helper callers unchanged', () => {
 const lines = ['    ---', 'code', '    ---'];
 assert.equal(markdownBodyStartLine(lines), 3);
 assert.equal(markdownBodyStartLine(lines, true), 0);
});
