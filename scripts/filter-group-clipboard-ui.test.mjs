import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modalSource = read('src/ui/filter-condition-editor.ts');
const styles = read('styles.css');

const groupEditorStart = modalSource.indexOf('\tprivate renderGroupEditor(');
const groupEditorEnd = modalSource.indexOf('\n\tprivate renderNodeMoveButtons(', groupEditorStart);
const groupEditor = modalSource.slice(groupEditorStart, groupEditorEnd);

test('named group footers expose icon-only Copy group with Operon tooltip and accessibility', () => {
	assert.ok(groupEditorStart >= 0 && groupEditorEnd > groupEditorStart);
	const footerActions = groupEditor.slice(
		groupEditor.indexOf("const clipboardActions = footer.createDiv('operon-filter-group-clipboard-actions');"),
		groupEditor.indexOf("const pasteGroupBtn = clipboardActions.createEl('button');"),
	);
	assert.match(footerActions, /if \(!isRoot\) \{/u);
	assert.match(footerActions, /operon-filter-group-copy-button/u);
	assert.match(footerActions, /'operon-filter-modal-add-button',[\s\S]*?'operon-filter-group-clipboard-button'/u);
	assert.match(footerActions, /setIcon\(copyBtn, 'copy'\)/u);
	assert.match(footerActions, /setAccessibleLabelWithoutTooltip\(copyBtn, t\('filterSets', 'copyGroup'\)\)/u);
	assert.match(footerActions, /bindOperonHoverTooltip\(copyBtn, \{ content: t\('filterSets', 'copyGroup'\)/u);
	assert.match(footerActions, /copyFilterGroupToClipboard\(group\)/u);
	assert.equal((groupEditor.match(/operon-filter-group-copy-button/g) ?? []).length, 1);
	assert.ok(groupEditor.indexOf('operon-filter-group-copy-button') > groupEditor.indexOf("const footer = card.createDiv();"));
});

test('every rendered group footer exposes icon-only Paste group without changing Add Group', () => {
	assert.match(groupEditor, /addGroupBtn[\s\S]*?group\.children\.push\(\{\s*id: generateGroupId\(\),\s*logic: 'all',\s*children: \[\],/u);
	assert.match(groupEditor, /operon-filter-group-paste-button/u);
	assert.equal((groupEditor.match(/'operon-filter-modal-add-button'/g) ?? []).length, 4);
	assert.doesNotMatch(
		groupEditor,
		/this\.addClasses\((?:copyBtn|pasteGroupBtn),[^;]*?'is-icon'[^;]*?\);/u,
	);
	assert.match(groupEditor, /const pasteGroupBtn = clipboardActions\.createEl\('button'\)/u);
	assert.match(groupEditor, /setIcon\(pasteGroupBtn, 'clipboard-paste'\)/u);
	assert.match(groupEditor, /setAccessibleLabelWithoutTooltip\(pasteGroupBtn, t\('filterSets', 'pasteGroup'\)\)/u);
	assert.match(groupEditor, /bindOperonHoverTooltip\(pasteGroupBtn, \{ content: t\('filterSets', 'pasteGroup'\)/u);
	assert.match(groupEditor, /pasteFilterGroupFromClipboard\(group\.id\)/u);
});

test('paste mutates once only after decode and destination compatibility pass', () => {
	const start = modalSource.indexOf('\tprivate async pasteFilterGroupFromClipboard(');
	const end = modalSource.indexOf('\n\tprivate getFilterGroupPasteCompatibilityIssue(', start);
	const source = modalSource.slice(start, end);
	assert.ok(start >= 0 && end > start);
	assert.match(source, /navigator\.clipboard\.readText\(\)/u);
	assert.match(source, /if \(!decoded\.ok\)[\s\S]*?return;/u);
	assert.match(source, /getFilterGroupPasteCompatibilityIssue\(decoded\.group\)/u);
	assert.match(source, /if \(this\.filterGroupPasteInProgress\) return;/u);
	assert.match(source, /resolveFilterGroupPasteTarget\(/u);
	assert.match(source, /pasteTarget\.target\.children\.push\(decoded\.group\);\s*this\.options\.onChange\(\);\s*this\.render\(\);/u);
	assert.equal((source.match(/pasteTarget\.target\.children\.push/g) ?? []).length, 1);
});

test('group footer wraps icon actions on narrow surfaces', () => {
	assert.match(
		styles,
		/\.operon-filter-group-footer \{\s*display: flex;\s*align-items: center;\s*flex-wrap: wrap;/u,
	);
	assert.match(
		styles,
		/\.operon-filter-group-clipboard-actions \{[\s\S]*?margin-left: auto;[\s\S]*?\.operon-filter-group-clipboard-button \{\s*display: inline-flex;[\s\S]*?width: var\(--input-height\);[\s\S]*?padding: 0;/u,
	);
	assert.doesNotMatch(
		styles,
		/\.operon-filter-group-clipboard-actions > \.operon-filter-modal-button\.is-icon/u,
	);
	assert.match(
		styles,
		/@media \(max-width: 520px\) \{[\s\S]*?\.operon-filter-group-header \{\s*flex-wrap: wrap;[\s\S]*?\.operon-filter-group-heading \{[\s\S]*?flex-wrap: wrap;/u,
	);
});

// Exercise the renderer's actual numbering method without constructing an Obsidian modal.
const numberingStart = modalSource.indexOf('\tprivate buildFilterGroupNumberMap(');
const numberingEnd = modalSource.indexOf('\n\tprivate addClasses(', numberingStart);
const predicateStart = modalSource.indexOf('function isFilterGroupNode(');
const predicateEnd = modalSource.indexOf('\n}', predicateStart) + 2;
assert.ok(numberingStart >= 0 && numberingEnd > numberingStart);
assert.ok(predicateStart >= 0 && predicateEnd > predicateStart);
const numbering = runInNewContext(transformSync(`
${modalSource.slice(predicateStart, predicateEnd)}
class Numbering { ${modalSource.slice(numberingStart, numberingEnd)} }
new Numbering();
`, { loader: 'ts', target: 'es2022' }).code);
const condition = () => ({ key: 'status', operator: 'is', value: 'open' });
const group = (id, children = []) => ({ id, logic: 'all', children });

test('group labels describe ancestry and count sibling groups only, without changing saved data', () => {
	const deep = group('deep');
	const firstChild = group('first-child', [condition(), deep]);
	const secondChild = group('second-child');
	const first = group('first', [condition(), firstChild, condition(), secondChild]);
	const second = group('second');
	const root = group('root', [condition(), first, condition(), second]);
	const before = JSON.stringify(root);
	const numbers = numbering.buildFilterGroupNumberMap(root);
	assert.equal(numbers.get(root), undefined);
	assert.deepEqual([first, firstChild, deep, secondChild, second].map(g => numbers.get(g)),
		['1', '1.1', '1.1.1', '1.2', '2']);
	assert.equal(numbers.get(root.children[0]), undefined);
	assert.equal(JSON.stringify(root), before);
});

test('group labels recalculate after reorder, removal and pasted subtrees', () => {
	const child = group('child');
	const first = group('first', [child]);
	const second = group('second');
	const root = group('root', [first, second]);
	root.children.reverse();
	let numbers = numbering.buildFilterGroupNumberMap(root);
	assert.deepEqual([second, first, child].map(g => numbers.get(g)), ['1', '2', '2.1']);
	root.children.splice(0, 1);
	const pasted = structuredClone(first);
	pasted.id = 'pasted';
	root.children.push(condition(), pasted);
	numbers = numbering.buildFilterGroupNumberMap(root);
	assert.deepEqual([first, child, pasted, pasted.children[0]].map(g => numbers.get(g)),
		['1', '1.1', '2', '2.1']);
	assert.equal(numbers.get(second), undefined);
});
