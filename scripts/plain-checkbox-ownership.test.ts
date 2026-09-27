import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { App, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import {
	collectPlainCheckboxLines, collectScopedPlainCheckboxMoveLines, scanPlainCheckboxOwnership,
	parsePlainMarkdownCheckboxLine, parseOperonTaskLineCandidate, updatePlainCheckboxLineContent,
	type PlainCheckboxEditScope, type PlainCheckboxLine,
} from '../src/core/plain-checkbox-lines';
import { scanFileWithMappings } from '../src/indexer/file-scanner';
import { evaluatePlainCheckboxesCondition } from '../src/core/plain-checkbox-filter';
import { guardRuntimeInlineRelocationV1 } from '../src/agent-runtime/runtime/source-transition-guards';
import { sha256HexV1 } from '../src/agent-runtime/contracts/v1/canonical';

const mappings = DEFAULT_SETTINGS.keyMappings;
const parent = '- [ ] Parent {{operonId:: parent1}}';
const child = '- [ ] Child {{operonId:: child01}}';
const own = { kind: 'inline', operonId: 'parent1' } as const;
const scan = (content: string) => scanPlainCheckboxOwnership(content, 'Tasks.md', mappings, 'contiguous');

// Frozen pre-change collector: differential compatibility oracle, intentionally test-only.
function legacy(content: string, scope: PlainCheckboxEditScope): PlainCheckboxLine[] {
	const results: PlainCheckboxLine[] = [];
	let fenced = false;
	let owner: string | null = null;
	for (const [index, line] of content.split('\n').entries()) {
		if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) { fenced = !fenced; continue; }
		if (fenced) continue;
		const task = parseOperonTaskLineCandidate(line, index, 'Tasks.md', mappings);
		if (task) { if (task.operonId) owner = task.operonId; continue; }
		const checkbox = parsePlainMarkdownCheckboxLine(line);
		if (!checkbox || (scope.kind === 'inline' && owner !== scope.operonId)) continue;
		results.push({ ...checkbox, lineNumber: index });
	}
	return results;
}

for (const boundary of ['', ' \t ', '# Heading', 'Ordinary text', '- ordinary list item', '```md\n- [ ] Hidden\n```', '~~~\n- [ ] Hidden\n~~~', child, '- [ ] Unidentified {{priority:: High}}']) {
	test(`contiguous ownership stops permanently at ${JSON.stringify(boundary)}`, () => {
		const content = [parent, '- [x] Own', boundary, '- [ ] Outside', '', '- [ ] Still outside'].join('\n');
		const result = scan(content);
		assert.deepEqual(collectPlainCheckboxLines(content, 'Tasks.md', mappings, own, 'contiguous').map(x => x.text), ['Own']);
		assert.equal(result.blocks[0].endLineNumber, 1);
		assert.equal(result.checkboxes[0].owner?.operonId, 'parent1');
		const outside = result.checkboxes.find(x => x.line.text === 'Outside');
		assert.equal(outside?.owner?.operonId ?? null, boundary === child ? 'child01' : null);
		assert.equal(result.checkboxes[result.checkboxes.length - 1]?.owner, null);
	});
}

test('nesting, outdents, tabs, numbered markers and states do not split ownership', () => {
	const rows = ['    - [ ] First', '\t* [x] Nested', '+ [/] Outdented', '  1. [-] Numbered', '2) [ ] Last'];
	const content = [parent, ...rows].join('\n');
	const result = scan(content);
	assert.deepEqual(result.checkboxes.map(x => x.line.rawLine), rows);
	assert.deepEqual(result.checkboxes.map(x => x.line.completed), [false, true, true, true, false]);
	assert.ok(result.checkboxes.every(x => x.owner?.operonId === 'parent1' && x.owner.lineNumber === 0));
	assert.equal(result.blocks[0].endLineNumber, 5);
	assert.deepEqual(collectScopedPlainCheckboxMoveLines(content, 'Tasks.md', mappings, own, 0, 'contiguous').map(x => x.rawLine), rows);
});

test('empty blocks, EOF, absent owners and task lines have unambiguous lookup results', () => {
	for (const content of [parent, `${parent}\n`, `${parent}\n\n- [ ] Detached`, `${parent}\n${child}`]) {
		const result = scan(content);
		assert.equal(result.blocks[0].endLineNumber, 0);
		assert.equal(result.checkboxes.find(x => x.line.lineNumber === 0), undefined);
		assert.ok(result.checkboxes.every(x => x.owner === null));
	}
	assert.deepEqual(scan(''), { checkboxes: [], blocks: [] });
	assert.equal(scan('- [ ] Unowned').checkboxes[0].owner, null);
});

test('block anchors distinguish repeated task IDs without inventing relationship resolution', () => {
	const result = scan([parent, '- [ ] A', parent, '- [ ] B', child].join('\n'));
	assert.deepEqual(result.blocks.map(x => [x.owner.lineNumber, x.endLineNumber]), [[0, 1], [2, 3], [4, 4]]);
	assert.deepEqual(result.checkboxes.map(x => x.owner?.lineNumber), [0, 2]);
});

test('CRLF and Unicode raw source are preserved without writing or formatting', () => {
	const content = [parent, '\t- [x] Überprüfen — iş', '', '- [ ] Dışarı'].join('\r\n');
	const before = content;
	const result = scan(content);
	assert.equal(result.checkboxes[0].line.rawLine, '\t- [x] Überprüfen — iş\r');
	assert.equal(result.checkboxes[1].owner, null);
	assert.equal(result.blocks[0].endLineNumber, 1);
	assert.equal(content, before);
	assert.deepEqual(collectPlainCheckboxLines(content, 'Tasks.md', mappings, own), legacy(content, own));
	assert.deepEqual(collectPlainCheckboxLines(content, 'Tasks.md', mappings, { kind: 'file' }, 'contiguous'), legacy(content, { kind: 'file' }));
});

test('unclosed fences hide checkbox-looking content through EOF', () => {
	const result = scan([parent, '- [ ] Own', '```', '- [ ] Hidden', child].join('\n'));
	assert.equal(result.checkboxes.length, 1);
	assert.equal(result.blocks.length, 1);
	assert.equal(result.blocks[0].endLineNumber, 1);
});

test('default and explicit legacy retain pre-change output; file scope is policy-independent', () => {
	const parts = ['', ' \t ', '# Header', 'text', child, '- [ ] No ID {{priority:: High}}', '```\n- [ ] Hidden\n~~~', '~~~\n- [ ] Hidden\n~~~'];
	for (const first of parts) for (const second of parts) {
		const content = ['- [ ] Before', parent, '- [x] One', first, '- [ ] Two', second, '- [/] Three'].join('\n');
		for (const scope of [own, { kind: 'inline', operonId: 'child01' } as const, { kind: 'file' } as const]) {
			assert.deepEqual(collectPlainCheckboxLines(content, 'Tasks.md', mappings, scope), legacy(content, scope));
			assert.deepEqual(collectPlainCheckboxLines(content, 'Tasks.md', mappings, scope, 'legacy-v1'), legacy(content, scope));
		}
		assert.deepEqual(collectPlainCheckboxLines(content, 'Tasks.md', mappings, { kind: 'file' }, 'contiguous'), legacy(content, { kind: 'file' }));
	}
});

test('default editing, scanner counts and filter operators remain legacy', async () => {
	const content = [parent, '- [x] Closed', '', '- [ ] Open'].join('\n');
	const file = { path: 'Tasks.md', basename: 'Tasks', stat: { mtime: 1, size: content.length } } as TFile;
	const result = await scanFileWithMappings({} as App, file, mappings, content);
	const progress = result.plainCheckboxProgress.byInlineTaskId.parent1;
	assert.deepEqual(progress, { total: 2, completed: 1 });
	assert.equal(evaluatePlainCheckboxesCondition({ plainCheckboxProgress: progress }, 'hasOpen'), true);
	assert.equal(evaluatePlainCheckboxesCondition({ plainCheckboxProgress: progress }, 'allClosed'), false);
	assert.equal(evaluatePlainCheckboxesCondition({ plainCheckboxProgress: progress }, 'exists'), true);
	assert.equal(updatePlainCheckboxLineContent(content, 'Tasks.md', mappings, own, 3, { completed: true }).ok, true);
	assert.equal(collectPlainCheckboxLines(content, 'Tasks.md', mappings, own, 'contiguous').length, 1);
});

test('Runtime relocation acknowledgement and carryover inputs retain the complete legacy scope', () => {
	const content = [parent, '- [x] Closed', '', '- [ ] Open'].join('\n');
	const beforeLocator = { representation: 'inline' as const, filePath: 'Tasks.md', lineNumber: 0 };
	const attached = collectScopedPlainCheckboxMoveLines(content, 'Tasks.md', mappings, own, 0, 'legacy-v1');
	assert.deepEqual(attached.map(x => x.lineNumber), [1, 3]);
	const result = guardRuntimeInlineRelocationV1({
		operonId: 'parent1', currentLocator: beforeLocator, sourceContent: content, destinationContent: '',
		parseOperonId: () => 'parent1', attachedCheckboxLineNumbers: attached.map(x => x.lineNumber),
		spec: { operation: 'relocate-inline', source: { locator: beforeLocator, lineDigest: sha256HexV1(parent), sourceRevision: { algorithm: 'sha256', contentDigest: sha256HexV1(content) } },
			destination: { locator: { representation: 'inline', filePath: 'Target.md', lineNumber: 0 }, lineDigest: sha256HexV1(''), sourceRevision: { algorithm: 'sha256', contentDigest: sha256HexV1('') }, mustBeBlank: true } },
	});
	assert.equal(result.ok, true);
	assert.deepEqual(result.value.requiredAcknowledgements, [`confirm:relocate-attached-checkboxes:${sha256HexV1('1,3').slice(0, 16)}`]);
	assert.equal(sha256HexV1(attached.map(x => x.rawLine).join('\n')), sha256HexV1('- [x] Closed\n- [ ] Open'));
});

test('both production Runtime scope collectors explicitly select legacy-v1', () => {
	const source = ts.createSourceFile('main.ts', readFileSync('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);
	const calls: ts.CallExpression[] = [];
	function walk(node: ts.Node, inside = false): void {
		if (ts.isMethodDeclaration(node)) inside = node.name.getText(source) === 'prepareAgentRuntimeSourceTransition';
		if (inside && ts.isCallExpression(node) && node.expression.getText(source) === 'collectScopedPlainCheckboxMoveLines') calls.push(node);
		ts.forEachChild(node, childNode => walk(childNode, inside));
	}
	walk(source);
	assert.equal(calls.length, 2);
	for (const call of calls) assert.equal(call.arguments[5]?.getText(source), "'legacy-v1'");
});
