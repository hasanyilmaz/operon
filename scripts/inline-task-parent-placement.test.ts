import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import type { IndexedTask } from '../src/types/fields';
import { parseTaskLine } from '../src/core/parser';
import { collectPlainCheckboxLines } from '../src/core/plain-checkbox-lines';
import { planInlineTaskParentPlacement, type InlineParentPlacementInput, type InlineParentPlacementPlan } from '../src/core/inline-task-parent-placement';

const mappings = DEFAULT_SETTINGS.keyMappings;
const taskLine = (id: string, parent = '', indent = '') => `${indent}- [ ] ${id} {{operonId:: ${id}}}${parent ? ` {{parentTask:: ${parent}}}` : ''}`;
const moving = (parent = 'parent1', indent = '') => taskLine('moving1', parent, indent);
const parentLine = taskLine('parent1');
const fileBody = (body: string) => `---\noperonId: parent1\n---\n${body}`;

function input(source: string, target: string, options: Partial<InlineParentPlacementInput> & { sameFile?: boolean; fileParent?: boolean } = {}): InlineParentPlacementInput {
	const parsed = source.split('\n').map((line, index) => parseTaskLine(line, index, 'Source.md', mappings)).find(item => item?.operonId === 'moving1');
	const task: IndexedTask = {
		operonId: 'moving1', description: 'moving1', checkbox: 'open', tags: [], tier: 'hot', datetimeModified: '',
		fieldValues: Object.fromEntries(parsed?.fields.map(field => [field.key, field.value]) ?? []),
		primary: { format: 'inline', filePath: 'Source.md', lineNumber: 999 },
	};
	return {
		enabled: true, task, sourceContent: source, updatedSourceContent: source, parentContent: target,
		parentTask: { ...task, operonId: 'parent1', fieldValues: {}, primary: { format: options.fileParent ? 'yaml' : 'inline', filePath: options.sameFile ? 'Source.md' : 'Target.md', lineNumber: 999 } },
		keyMappings: mappings, headingKeyword: 'Backlog', ...options,
	};
}

function requireMove(result: InlineParentPlacementPlan) {
	assert.equal(result.kind, 'move');
	if (result.kind !== 'move') throw new Error(JSON.stringify(result));
	return result;
}

function ownCheckboxes(content: string, id: string) {
	return collectPlainCheckboxLines(content, '', mappings, { kind: 'inline', operonId: id }).map(item => item.rawLine);
}

test('disabled and non-inline sources are no-ops, even without parseable content', () => {
	const args = input('', '');
	assert.deepEqual(planInlineTaskParentPlacement({ ...args, enabled: false }), { kind: 'not-needed' });
	assert.deepEqual(planInlineTaskParentPlacement({ ...args, task: { ...args.task, primary: { ...args.task.primary, format: 'yaml' } } }), { kind: 'not-needed' });
});

test('absent and explicitly cleared parents do not move', () => {
	for (const source of [moving(''), moving()]) {
		assert.deepEqual(planInlineTaskParentPlacement(input(source, '', { updatedSourceContent: moving(''), parentTask: null })), { kind: 'not-needed' });
	}
});

test('same parent in the same file does not rearrange a distant task', () => {
	const source = `${parentLine}\n- [ ] Parent checklist\n## Elsewhere\n${moving()}\n- [ ] Own checklist`;
	const args = input(source, '', { sameFile: true, updatedSourceContent: source.replace('moving1 {{', 'Updated {{') });
	assert.deepEqual(planInlineTaskParentPlacement(args), { kind: 'not-needed' });
});

for (const oldParent of ['', 'oldparent', 'parent1']) {
	for (const sameFile of [false, true]) {
		test(`placement matrix: old parent ${oldParent || 'absent'}, ${sameFile ? 'same' : 'different'} file`, () => {
			const source = [moving(oldParent), taskLine('boundary'), ...(sameFile ? [parentLine] : [])].join('\n');
			const result = planInlineTaskParentPlacement(input(source, parentLine, { sameFile, updatedSourceContent: source.replace(moving(oldParent), moving()) }));
			assert.equal(result.kind, sameFile && oldParent === 'parent1' ? 'not-needed' : 'move');
			if (result.kind === 'move') assert.equal(result.writes.length, sameFile ? 1 : 2);
		});
	}
}

test('cross-file move carries only the edited task and its owned checkboxes; children and prose remain', () => {
	const source = [moving(), '- [x] First', 'Comment stays', '## Checklist', '  2. [ ] Second', taskLine('child01', 'moving1', '    '), '        - [ ] Child checkbox', taskLine('other01'), '- [ ] Other checkbox', ''].join('\n');
	const target = [parentLine, '- [ ] Parent checkbox', taskLine('sibling'), '- [ ] Sibling checkbox', ''].join('\n');
	const updated = source.replace('moving1 {{', 'Changed title {{');
	const args = input(source, target, { updatedSourceContent: updated });
	const snapshot = JSON.stringify(args);
	const result = requireMove(planInlineTaskParentPlacement(args));
	assert.equal(JSON.stringify(args), snapshot, 'planning must not mutate inputs');
	assert.deepEqual(result.writes.map(write => write.filePath), ['Target.md', 'Source.md']);
	assert.equal(result.writes[0].expectedContent, target);
	assert.equal(result.writes[1].expectedContent, source);
	assert.equal(result.writes[1].nextContent, ['Comment stays', '## Checklist', taskLine('child01', 'moving1', '    '), '        - [ ] Child checkbox', taskLine('other01'), '- [ ] Other checkbox', ''].join('\n'));
	assert.equal(result.target.lineNumber, 2);
	assert.match(result.writes[0].nextContent, /    - \[ \] Changed title/);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), ['    - [x] First', '      2. [ ] Second']);
	for (const id of ['parent1', 'sibling']) assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, id), ownCheckboxes(target, id));
	for (const id of ['child01', 'other01']) assert.deepEqual(ownCheckboxes(result.writes[1].nextContent, id), ownCheckboxes(source, id));
});

for (const direction of ['up', 'down']) {
	test(`same-file ${direction} move resolves parent after removing task and non-adjacent checkboxes`, () => {
		const block = [moving('oldparent'), '- [x] Own', 'Text stays', '  - [ ] Nested own'];
		const destination = [parentLine, '- [ ] Parent own'];
		const sibling = [taskLine('sibling'), '- [ ] Sibling own'];
		const source = (direction === 'up' ? [...destination, ...sibling, ...block] : [...block, ...destination, ...sibling]).join('\n');
		const result = requireMove(planInlineTaskParentPlacement(input(source, 'ignored', { sameFile: true, updatedSourceContent: source.replace(moving('oldparent'), moving()) })));
		assert.equal(result.writes.length, 1);
		const after = result.writes[0].nextContent;
		assert.match(after, new RegExp('Parent own\\n    - \\[ \\] moving1'));
		for (const id of ['parent1', 'sibling']) assert.deepEqual(ownCheckboxes(after, id), ownCheckboxes(source, id));
		assert.deepEqual(ownCheckboxes(after, 'moving1'), ['    - [x] Own', '      - [ ] Nested own']);
		assert.ok(after.includes('Text stays'));
	});
}

test('already placed task produces no relocation write when adding its parent', () => {
	const source = `${parentLine}\n- [ ] Parent own\n${moving('', '    ')}\n    - [ ] Own`;
	assert.deepEqual(planInlineTaskParentPlacement(input(source, '', { sameFile: true, updatedSourceContent: source.replace(moving('', '    '), moving('parent1', '    ')) })), { kind: 'not-needed' });
});

test('file heading uses first case-insensitive keyword match after preserving existing checkbox owners', () => {
	const target = fileBody([taskLine('previous'), '## Sprint BACKLOG tasks', '- [ ] Existing', taskLine('sibling'), '- [ ] Sibling own', '## Backlog later'].join('\n'));
	const result = requireMove(planInlineTaskParentPlacement(input(`${moving()}\n- [ ] Own`, target, { fileParent: true, headingKeyword: '## backlog' })));
	assert.match(result.writes[0].nextContent, /Existing\n- \[ \] moving1/);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'previous'), ['- [ ] Existing']);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'sibling'), ['- [ ] Sibling own']);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), ['- [ ] Own']);
});

for (const keyword of ['', '  ', 'Sprint']) {
	test(`missing file heading is created with ${keyword.trim() || 'Backlog'} fallback`, () => {
		const target = fileBody('Existing text\n');
		const result = requireMove(planInlineTaskParentPlacement(input(moving(), target, { fileParent: true, headingKeyword: keyword })));
		assert.equal(result.writes[0].nextContent, `${target}\n## ${keyword.trim() || 'Backlog'}\n${moving()}`);
	});
}

test('same-file reparent to file task relocates under its heading and preserves frontmatter', () => {
	const source = fileBody(`${moving('oldparent')}\n- [ ] Own\n## Backlog\n${taskLine('sibling')}`);
	const result = requireMove(planInlineTaskParentPlacement(input(source, '', { sameFile: true, fileParent: true, updatedSourceContent: source.replace(moving('oldparent'), moving()) })));
	assert.equal(result.writes.length, 1);
	assert.equal(result.writes[0].nextContent, fileBody(`## Backlog\n${moving()}\n- [ ] Own\n${taskLine('sibling')}`));
});

test('file placement does not capture unowned leading checkboxes', () => {
	const target = fileBody('## Backlog\n- [ ] Unowned\n');
	const result = requireMove(planInlineTaskParentPlacement(input(moving(), target, { fileParent: true })));
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), []);
	assert.match(result.writes[0].nextContent, /Unowned\n- \[ \] moving1/);
});

test('checkbox ownership spanning past a heading section blocks placement instead of changing ownership', () => {
	const target = fileBody('## Backlog\nProse\n## Other\n- [ ] Must remain unowned');
	assert.deepEqual(planInlineTaskParentPlacement(input(moving(), target, { fileParent: true })), { kind: 'blocked', reason: 'unsafe-placement' });
});

test('headings in fenced code and frontmatter are not targets', () => {
	const target = ['---', 'operonId: parent1', '# Backlog', '---', '```md', '## Backlog', '```', '## Real Backlog', taskLine('sibling')].join('\n');
	const result = requireMove(planInlineTaskParentPlacement(input(moving(), target, { fileParent: true })));
	assert.equal(result.target.lineNumber, 8);
	assert.ok(result.writes[0].nextContent.startsWith(target.split('\n').slice(0, 8).join('\n')));
});

test('new heading cannot be created inside an unclosed fence or frontmatter', () => {
	for (const target of ['```md\ntext', '---\noperonId: parent1']) {
		assert.deepEqual(planInlineTaskParentPlacement(input(moving(), target, { fileParent: true })), { kind: 'blocked', reason: 'unsafe-placement' });
	}
});

test('fenced copies of task IDs and plain checkboxes remain untouched', () => {
	const fenced = `\`\`\`md\n${moving()}\n- [ ] Example\n\`\`\``;
	const source = `${moving()}\n- [ ] Own\n${fenced}`;
	const result = requireMove(planInlineTaskParentPlacement(input(source, `${parentLine}\n\`\`\`\n${parentLine}\n\`\`\``)));
	assert.equal(result.writes[1].nextContent, fenced);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), ['    - [ ] Own']);
});

test('a parent-like line in a fenced example is not an inline target', () => {
	assert.deepEqual(planInlineTaskParentPlacement(input(moving(), `\`\`\`\n${parentLine}\n\`\`\``)), { kind: 'blocked', reason: 'parent-unavailable' });
});

test('stale task/parent line hints do not select another task', () => {
	const args = input(`${taskLine('other01')}\n${moving()}`, `${taskLine('other02')}\n${parentLine}`);
	args.task.primary.lineNumber = 0;
	args.parentTask!.primary.lineNumber = 0;
	const result = requireMove(planInlineTaskParentPlacement(args));
	assert.equal(result.target.lineNumber, 2);
	assert.equal(result.writes[1].nextContent, taskLine('other01'));
});

test('missing, mismatching and self parents are blocked without a write plan', () => {
	const args = input(moving(), parentLine);
	for (const parentTask of [null, { ...args.parentTask!, operonId: 'wrong01' }]) {
		assert.deepEqual(planInlineTaskParentPlacement({ ...args, parentTask }), { kind: 'blocked', reason: 'parent-unavailable' });
	}
	assert.deepEqual(planInlineTaskParentPlacement(input(moving('moving1'), parentLine)), { kind: 'blocked', reason: 'parent-unavailable' });
	assert.deepEqual(planInlineTaskParentPlacement({ ...args, parentContent: undefined }), { kind: 'blocked', reason: 'parent-unavailable' });
});

test('duplicate source, target task and inline parent identities are blocked', () => {
	for (const [source, target] of [[`${moving()}\n${moving()}`, parentLine], [moving(), `${parentLine}\n${moving()}`], [moving(), `${parentLine}\n${parentLine}`]]) {
		assert.deepEqual(planInlineTaskParentPlacement(input(source, target)), { kind: 'blocked', reason: 'duplicate-task' });
	}
});

test('changed source identity and stale parent snapshots are blocked', () => {
	assert.deepEqual(planInlineTaskParentPlacement(input(moving(), parentLine, { updatedSourceContent: taskLine('newid01', 'parent1') })), { kind: 'blocked', reason: 'source-changed' });
	const args = input(moving(), parentLine);
	args.task.fieldValues['parentTask'] = 'stale01';
	assert.deepEqual(planInlineTaskParentPlacement(args), { kind: 'blocked', reason: 'source-changed' });
});

test('file placement preserves relative checkbox indentation including outdented owners', () => {
	const source = [moving('parent1', '        '), '- [ ] Outdented', '  - [x] Nested', '      + [ ] Deeper'].join('\n');
	const result = requireMove(planInlineTaskParentPlacement(input(source, fileBody('## Backlog'), { fileParent: true })));
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), ['- [ ] Outdented', '  - [x] Nested', '      + [ ] Deeper']);
});

test('tab-indented task and ordered checkboxes retain checkbox text, states and nesting', () => {
	const source = `${moving('parent1', '\t')}\n\t1. [X] Done\n\t\t2. [ ] Nested`;
	const result = requireMove(planInlineTaskParentPlacement(input(source, fileBody('## Backlog'), { fileParent: true })));
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), ['1. [X] Done', '    2. [ ] Nested']);
});

test('same file parent does not relocate a task under another heading', () => {
	const source = fileBody(`## Backlog\n${taskLine('sibling')}\n## Other\n${moving()}\n- [ ] Own`);
	assert.deepEqual(planInlineTaskParentPlacement(input(source, '', { sameFile: true, fileParent: true })), { kind: 'not-needed' });
});

test('edited checkbox draft travels with the task while unrelated draft edits remain in source', () => {
	const source = `${moving()}\n- [ ] Delete this\n${taskLine('sibling')}\n- [ ] Sibling own`;
	const updated = `${moving()}\n- [x] Newly edited\n  - [ ] Newly added\n${taskLine('sibling')}\n- [x] Sibling own`;
	const result = requireMove(planInlineTaskParentPlacement(input(source, parentLine, { updatedSourceContent: updated })));
	assert.equal(result.writes[1].expectedContent, source);
	assert.equal(result.writes[1].nextContent, `${taskLine('sibling')}\n- [x] Sibling own`);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'moving1'), ['    - [x] Newly edited', '      - [ ] Newly added']);
});

test('parent checkbox scope can cross prose and headings without being reassigned', () => {
	const target = `${parentLine}\nText\n## Checklist\n- [ ] First\nText\n- [x] Last\n${taskLine('sibling')}`;
	const result = requireMove(planInlineTaskParentPlacement(input(moving(), target)));
	assert.equal(result.target.lineNumber, 6);
	assert.deepEqual(ownCheckboxes(result.writes[0].nextContent, 'parent1'), ['- [ ] First', '- [x] Last']);
});

test('nested inline parent uses the existing child indentation and planning is idempotent', () => {
	const target = `${taskLine('parent1', '', '        ')}\n            - [ ] Parent own`;
	const args = input(`${moving()}\n  - [ ] Own`, target);
	const result = requireMove(planInlineTaskParentPlacement(args));
	const after = result.writes[0].nextContent;
	assert.equal(after.split('\n')[result.target.lineNumber], moving('parent1', '            '));
	assert.deepEqual(ownCheckboxes(after, 'moving1'), ['              - [ ] Own']);
	assert.deepEqual(planInlineTaskParentPlacement({ ...args, task: { ...args.task, primary: { ...args.task.primary, filePath: 'Target.md' } }, sourceContent: after, updatedSourceContent: after }), { kind: 'not-needed' });
});
