import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTaskLine } from '../src/core/parser';
import { serializeField } from '../src/core/serializer';
import { inlineToYamlValue, readYamlFields } from '../src/core/yaml-fields';
import {
	applyCompactTaskTextUserEdit,
	createCompactTaskTextDraft,
	projectCompactTaskTextForEditing,
	projectCompactTaskTextSingleLineBreakInsertion,
	resolveCompactTaskTextCommit,
} from '../src/core/compact-task-text';
import { CompactMarkdownEditorController } from '../src/ui/compact-markdown-editor-controller';
import { resolveCompactEditorKeyIntent } from '../src/ui/compact-editor-key-intent';
import { parseCompactTaskMarkdown } from '../src/ui/compact-task-markdown-renderer';
import { matchesTaskSearchQueryText } from '../src/systems/task-search';
import { FormatConverter } from '../src/systems/format-converter';
import type { OperonIndexer } from '../src/indexer/indexer';
import type { OperonSettings } from '../src/types/settings';
import { parseYaml, type App } from 'obsidian';
import type { KeyMapping } from '../src/types/settings';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function noteField(source: string, keyMappings: KeyMapping[] = []) {
	const task = parseTaskLine(source, 0, 'Tasks/Notes.md', keyMappings);
	assert.ok(task, `task must parse: ${source}`);
	assertions += 1;
	const field = task.fields.find(candidate => candidate.key === 'note');
	assert.ok(field, 'task must include a note field');
	assertions += 1;
	return field;
}

async function run(): Promise<void> {
	const taskNoteController = new CompactMarkdownEditorController('First line', 'task-note');
	const firstBreak = taskNoteController.applyUserInput('First line\nSecond line', {
		anchor: 23,
		head: 23,
	});
	assert.ok(firstBreak);
	assertions += 1;
	equal(firstBreak.displayValue, 'First line\nSecond line');
	deepEqual(taskNoteController.getCommit(), {
		shouldCommit: true,
		value: 'First line\nSecond line',
	});
	const secondBreak = taskNoteController.applyUserInput('First line\n\nSecond line', {
		anchor: 24,
		head: 24,
	});
	assert.ok(secondBreak);
	assertions += 1;
	equal(secondBreak.displayValue, 'First line\n\nSecond line');
	equal(taskNoteController.getCommit().value, 'First line\n\nSecond line');

	const pastedDraft = applyCompactTaskTextUserEdit(
		createCompactTaskTextDraft('Existing note', 'task-note'),
		'One\r\nTwo\rThree',
		'task-note',
	);
	equal(pastedDraft.displayValue, 'One\nTwo\nThree');
	deepEqual(resolveCompactTaskTextCommit(pastedDraft), {
		shouldCommit: true,
		value: 'One\nTwo\nThree',
	});
	equal(projectCompactTaskTextForEditing('A \n\n B', 'task-note'), 'A \n\n B');
	deepEqual(projectCompactTaskTextSingleLineBreakInsertion('AB', 1, 1), {
		displayValue: 'A B',
		selectionOffset: 2,
	});
	deepEqual(projectCompactTaskTextSingleLineBreakInsertion('A B', 1, 1), {
		displayValue: 'A B',
		selectionOffset: 2,
	});
	deepEqual(projectCompactTaskTextSingleLineBreakInsertion('A B', 2, 2), {
		displayValue: 'A B',
		selectionOffset: 2,
	});
	deepEqual(projectCompactTaskTextSingleLineBreakInsertion('A  B', 1, 3), {
		displayValue: 'A B',
		selectionOffset: 2,
	});

	equal(resolveCompactEditorKeyIntent({ key: 'Enter' }), 'submit');
	equal(resolveCompactEditorKeyIntent({ key: 'Enter', shiftKey: true }), 'submit');
	equal(resolveCompactEditorKeyIntent({ key: 'Enter', shiftKey: true, textPolicy: 'task-note' }), 'insert-line-break');
	equal(resolveCompactEditorKeyIntent({ key: 'Enter', shiftKey: true, metaKey: true, textPolicy: 'task-note' }), 'explicit-submit');
	equal(resolveCompactEditorKeyIntent({ key: 'Enter', shiftKey: true, textPolicy: 'task-note', isComposing: true }), 'none');
	equal(resolveCompactEditorKeyIntent({ key: 'Tab', textPolicy: 'task-note' }), 'focus-next');
	equal(resolveCompactEditorKeyIntent({ key: 'Escape', textPolicy: 'task-note' }), 'escape');

	const canonical = noteField(String.raw`- [ ] Review {{note:: A\nB\n\nC}}`);
	equal(canonical.value, 'A\nB\n\nC');
	equal(serializeField(canonical), String.raw`{{note:: A\nB\n\nC}}`);
	assert.ok(!serializeField(canonical).includes('\n'));
	assertions += 1;

	const literal = noteField(String.raw`- [ ] Review {{note:: Literal \\n text}}`);
	equal(literal.value, String.raw`Literal \n text`);
	equal(serializeField(literal), String.raw`{{note:: Literal \\n text}}`);

	const legacy = noteField(String.raw`- [ ] Review {{note:: Old\u000Avalue}}`);
	equal(legacy.value, 'Old\nvalue');
	equal(serializeField(legacy), String.raw`{{note:: Old\nvalue}}`);

	const generic = noteField(String.raw`- [ ] Review {{note:: No change}} {{fixtureTopic:: A\u000AB}}`);
	const genericTask = parseTaskLine(String.raw`- [ ] Review {{note:: No change}} {{fixtureTopic:: A\u000AB}}`, 0, 'Tasks/Notes.md', []);
	assert.ok(genericTask);
	assertions += 1;
	const genericField = genericTask.fields.find(field => field.key === 'fixtureTopic');
	assert.ok(genericField);
	assertions += 1;
	equal(generic.value, 'No change');
	equal(genericField.value, 'A\nB');
	equal(serializeField(genericField), String.raw`{{fixtureTopic:: A\u000AB}}`);

	const alias: KeyMapping = {
		canonicalKey: 'note',
		visiblePropertyName: 'Notes Alias',
		type: 'text',
		sync: 'yes',
		enabled: true,
		isSystem: true,
	};
	const mapped = noteField(String.raw`- [ ] Review {{Notes Alias:: Mapped\nvalue}}`, [alias]);
	equal(mapped.value, 'Mapped\nvalue');
	equal(serializeField(mapped, [alias]), String.raw`{{Notes Alias:: Mapped\nvalue}}`);

	equal(inlineToYamlValue('note', 'File\nnote'), 'File\nnote');
	deepEqual(readYamlFields({ note: 'File\nnote' }, []), { note: 'File\nnote' });

	const convertedNote = 'File\nnote with "quote" and C:\\path';
	const converter = new FormatConverter(
		{} as App,
		{
			getTask: () => ({
				operonId: 'note-roundtrip',
				description: 'Converted task',
				fieldValues: { note: convertedNote },
				tags: [],
			}),
		} as unknown as OperonIndexer,
		{ keyMappings: [] } as unknown as OperonSettings,
	);
	const convertedSource = converter.renderInlineToYaml('note-roundtrip');
	assert.ok(convertedSource);
	assertions += 1;
	const convertedFrontmatter = convertedSource.slice(4, convertedSource.lastIndexOf('\n---'));
	const convertedYaml = parseYaml(convertedFrontmatter) as Record<string, unknown>;
	equal(convertedYaml.note, convertedNote, 'Inline to File conversion must preserve multiline notes');

	const rendered = parseCompactTaskMarkdown('First\n\n[[Notes|Second]]');
	deepEqual(rendered, [
		{ type: 'text', value: 'First\n\n' },
		{ type: 'wikilink', target: 'Notes', label: 'Second' },
	]);
	equal(matchesTaskSearchQueryText('Before\nAfter\n\nFinal', 'before after'), true);
	equal(matchesTaskSearchQueryText('Before\nAfter\n\nFinal', 'after final'), true);
	equal(matchesTaskSearchQueryText('Before\nAfter\n\nFinal', 'missing'), false);

	const [taskEditorSource, noteActionSource, tooltipCss] = await Promise.all([
		readFile(path.join(process.cwd(), 'src/ui/task-editor-content.ts'), 'utf8'),
		readFile(path.join(process.cwd(), 'src/ui/task-note-action.ts'), 'utf8'),
		readFile(path.join(process.cwd(), 'styles.css'), 'utf8'),
	]);
	assert.match(taskEditorSource, /textPolicy: 'task-note'/u, 'desktop Notes must opt into multiline compact text');
	assert.match(taskEditorSource, /projectCompactTaskTextForEditing\(textarea\.value, 'task-note'\)/u, 'mobile Notes must preserve line breaks');
	assert.match(taskEditorSource, /event\.key !== 'Enter' \|\| event\.shiftKey/u, 'mobile Notes must reserve new lines for Shift+Enter');
	assert.match(noteActionSource, /textPolicy: 'task-note'/u, 'shared task-note popover must opt into multiline compact text');
	assert.match(tooltipCss, /\.operon-hover-tooltip-body\s*\{[\s\S]*?white-space: pre-wrap;/u, 'tooltip body must preserve note line breaks');
	assertions += 5;

	console.log(`Task note multiline tests passed: ${assertions} assertions`);
}

declare global {
	var __operonTaskNoteMultilineTestRun: Promise<void> | undefined;
}

globalThis.__operonTaskNoteMultilineTestRun = run();
