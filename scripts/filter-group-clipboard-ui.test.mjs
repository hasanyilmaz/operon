import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const modalSource = read('src/ui/filter-set-modal.ts');
const styles = read('styles.css');

const groupEditorStart = modalSource.indexOf('\tprivate renderGroupEditor(');
const groupEditorEnd = modalSource.indexOf('\n\tprivate renderNodeMoveButtons(', groupEditorStart);
const groupEditor = modalSource.slice(groupEditorStart, groupEditorEnd);

test('named group headers expose icon-only Copy group with Operon tooltip and accessibility', () => {
	assert.ok(groupEditorStart >= 0 && groupEditorEnd > groupEditorStart);
	const nestedActions = groupEditor.slice(
		groupEditor.indexOf('\t\tif (!isRoot && parentGroup) {'),
		groupEditor.indexOf('\n\t\tif (collapsed) return;'),
	);
	assert.match(nestedActions, /operon-filter-group-copy-button/u);
	assert.match(nestedActions, /setIcon\(copyBtn, 'copy'\)/u);
	assert.match(nestedActions, /setAccessibleLabelWithoutTooltip\(copyBtn, t\('filterSets', 'copyGroup'\)\)/u);
	assert.match(nestedActions, /bindOperonHoverTooltip\(copyBtn, \{ content: t\('filterSets', 'copyGroup'\)/u);
	assert.match(nestedActions, /copyFilterGroupToClipboard\(group\)/u);
	assert.equal((groupEditor.match(/operon-filter-group-copy-button/g) ?? []).length, 1);
	assert.ok(groupEditor.indexOf('operon-filter-group-copy-button') < groupEditor.indexOf('if (collapsed) return;'));
});

test('every rendered group footer exposes icon-only Paste group without changing Add Group', () => {
	assert.match(groupEditor, /addGroupBtn[\s\S]*?group\.children\.push\(\{\s*id: generateGroupId\(\),\s*logic: 'all',\s*children: \[\],/u);
	assert.match(groupEditor, /operon-filter-group-paste-button/u);
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
	assert.match(source, /pasteTarget\.target\.children\.push\(decoded\.group\);\s*this\.syncMirroredFilterFields\(\);\s*this\.renderCurrentSurface\(\);/u);
	assert.equal((source.match(/pasteTarget\.target\.children\.push/g) ?? []).length, 1);
});

test('group footer wraps icon actions on narrow surfaces', () => {
	assert.match(
		styles,
		/\.operon-filter-group-footer \{\s*display: flex;\s*align-items: center;\s*flex-wrap: wrap;/u,
	);
	assert.match(
		styles,
		/@media \(max-width: 520px\) \{[\s\S]*?\.operon-filter-group-header \{\s*flex-wrap: wrap;[\s\S]*?\.operon-filter-group-heading \{[\s\S]*?flex-wrap: wrap;/u,
	);
});
