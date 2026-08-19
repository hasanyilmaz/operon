import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTaskLine } from '../src/core/parser';
import { normalizeTaskLine, serializeField, serializeTask } from '../src/core/serializer';
import {
	buildReverseMapping,
	inlineToYamlValue,
	isManagedYamlCanonicalKey,
	readYamlFields,
} from '../src/core/yaml-fields';
import { applyYamlTaskFieldValues } from '../src/core/task-writer-yaml';
import {
	getManagedTaskFieldType,
	isManagedTaskFieldCanonicalKey,
} from '../src/core/managed-task-fields';
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
import { getFilterSetFieldPickerMappingCandidates } from '../src/ui/filter-set-modal';
import { buildTaskEditorOperonField } from '../src/ui/task-editor-content';
import { resolveSubtaskInitialFieldsFromParentValues } from '../src/core/subtask-inheritance';
import { transformRecurringFileBody } from '../src/systems/recurrence-service';
import { matchesTaskSearchQueryText } from '../src/systems/task-search';
import { FormatConverter } from '../src/systems/format-converter';
import type { OperonIndexer } from '../src/indexer/indexer';
import {
	DEFAULT_SETTINGS,
	isChildTaskInheritanceEligibleFieldKey,
	normalizeChildTaskInheritanceFields,
	type OperonSettings,
} from '../src/types/settings';
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
	const stage2Mappings = structuredClone(DEFAULT_SETTINGS.keyMappings);
	const stage2ReverseMap = buildReverseMapping(stage2Mappings);
	for (const key of ['taskType', 'taskImage', 'taskGallery']) {
		equal(stage2Mappings.some(mapping => mapping.canonicalKey === key && mapping.isSystem === true), true);
		equal(isManagedTaskFieldCanonicalKey(key, stage2Mappings), false);
		equal(isManagedYamlCanonicalKey(key, stage2Mappings), false);
		equal(getManagedTaskFieldType(key, stage2Mappings), null);
		equal(stage2ReverseMap.has(key), false);
		const parsed = parseTaskLine(`- [ ] Deferred ${key} {{${key}:: value}}`, 0, 'Tasks/Notes.md', stage2Mappings);
		assert.ok(parsed);
		assertions += 1;
		equal(parsed.fields.find(field => field.key === key)?.isCanonical, false);
	}
	const editorDeferredFields = [
		buildTaskEditorOperonField('taskImage', 'Assets/cover.png', stage2Mappings),
		buildTaskEditorOperonField('taskType', 'Project', stage2Mappings),
		buildTaskEditorOperonField('taskGallery', 'Assets/one.png; Assets/two.png', stage2Mappings),
	];
	for (const field of editorDeferredFields) {
		equal(field.type, 'text', `Task Editor must preserve ${field.key} as a raw text field until Stage 3`);
		equal(field.isCanonical, false, `Task Editor must not re-canonicalize ${field.key} before Stage 3`);
	}
	const editorBase = parseTaskLine('- [ ] Editor producer', 0, 'Tasks/Notes.md', stage2Mappings);
	assert.ok(editorBase);
	assertions += 1;
	equal(
		serializeTask({ ...editorBase, fields: editorDeferredFields }, stage2Mappings),
		'- [ ] Editor producer {{taskImage:: Assets/cover.png}} {{taskType:: Project}} {{taskGallery:: Assets/one.png; Assets/two.png}}',
		'Task Editor reconstruction must preserve raw deferred-field order.',
	);
	const recurringClone = transformRecurringFileBody({
		sourceBody: '- [ ] Recurring child {{operonId:: child-old}} {{parentTask:: root-old}} {{repeatSeriesId:: series-child}} {{taskImage:: Assets/cover.png}} {{taskType:: Project}} {{taskGallery:: Assets/one.png; Assets/two.png}}',
		sourceFilePath: 'Tasks/Recurring.md',
		oldRootOperonId: 'root-old',
		newRootOperonId: 'root-new',
		oldRootFieldValues: {},
		newRootFieldValues: {},
		rootSeriesId: 'series-root',
		keyMappings: stage2Mappings,
		pipelines: structuredClone(DEFAULT_SETTINGS.pipelines),
		defaultPipelineName: DEFAULT_SETTINGS.defaultPipelineName,
		now: '2026-08-20T10:00:00',
		generateOperonId: () => 'child-new',
	});
	equal(recurringClone.clonedSubtaskCount, 1);
	for (const key of ['taskImage', 'taskType', 'taskGallery']) {
		equal(parseTaskLine(recurringClone.body, 0, 'Tasks/Recurring.md', stage2Mappings)?.fields.find(field => field.key === key)?.isCanonical, false);
	}
	const recurringImageIndex = recurringClone.body.indexOf('{{taskImage::');
	const recurringTypeIndex = recurringClone.body.indexOf('{{taskType::');
	const recurringGalleryIndex = recurringClone.body.indexOf('{{taskGallery::');
	equal(recurringImageIndex >= 0 && recurringImageIndex < recurringTypeIndex && recurringTypeIndex < recurringGalleryIndex, true, 'Recurring clone must preserve raw deferred-field order.');
	const storedDeferredInheritanceFields = ['taskType', 'taskImage', 'taskGallery'];
	deepEqual(
		normalizeChildTaskInheritanceFields(storedDeferredInheritanceFields, stage2Mappings),
		storedDeferredInheritanceFields,
		'Stored deferred inheritance selections must survive Stage 2 normalization unchanged.',
	);
	for (const key of storedDeferredInheritanceFields) {
		equal(isChildTaskInheritanceEligibleFieldKey(key, stage2Mappings), false, `${key} must remain absent from inheritance selection surfaces until Stage 3`);
	}
	deepEqual(
		resolveSubtaskInitialFieldsFromParentValues(
			'parent-001',
			{ taskType: 'Project', taskImage: 'Assets/cover.png', taskGallery: 'Assets/one.png; Assets/two.png' },
			{
				...structuredClone(DEFAULT_SETTINGS),
				childTaskInheritanceFields: storedDeferredInheritanceFields,
			} as OperonSettings,
		),
		{ parentTask: 'parent-001' },
		'Deferred stored inheritance selections must not activate data propagation before Stage 3.',
	);
	deepEqual(readYamlFields({ taskType: 'Project', taskImage: 'Assets/cover.png', taskGallery: ['Assets/one.png'] }, stage2Mappings), {});
	const deferredFrontmatter = {
		taskType: 'Project',
		taskImage: 'Assets/cover.png',
		taskGallery: ['Assets/one.png'],
	};
	applyYamlTaskFieldValues(deferredFrontmatter, {
		taskType: 'Updated',
		taskImage: 'Assets/updated.png',
		taskGallery: 'Assets/two.png',
	}, 'replace', stage2Mappings);
	deepEqual(deferredFrontmatter, {
		taskType: 'Project',
		taskImage: 'Assets/cover.png',
		taskGallery: ['Assets/one.png'],
	});
	const rawDeferredLine = '- [ ] Deferred {{taskImage:: Assets/cover.png}} {{taskType:: Project}} {{taskGallery:: Assets/one.png; Assets/two.png}}';
	equal(
		normalizeTaskLine(rawDeferredLine, 0, 'Tasks/Notes.md', stage2Mappings),
		rawDeferredLine,
		'raw deferred fields must preserve their source order until Stage 3 makes them managed',
	);
	equal(
		normalizeTaskLine('- [ ] Ordered {{priority:: C}} {{status:: Project.Inbox}}', 0, 'Tasks/Notes.md', stage2Mappings),
		'- [ ] Ordered {{status:: Project.Inbox}} {{priority:: C}}',
		'existing managed canonical fields must retain canonical ordering',
	);
	const customMapping: KeyMapping = {
		canonicalKey: 'clientReference',
		visiblePropertyName: 'Client',
		type: 'text',
		sync: 'yes',
		enabled: true,
		isSystem: false,
	};
	const filterPickerCandidates = getFilterSetFieldPickerMappingCandidates([
		...stage2Mappings,
		customMapping,
	]);
	const filterPickerFields = filterPickerCandidates.map(candidate => candidate.mapping.canonicalKey);
	for (const key of ['taskType', 'taskImage', 'taskGallery']) {
		equal(filterPickerFields.includes(key), false, `${key} must remain unavailable in FilterSet pickers until Stage 3`);
	}
	equal(filterPickerFields.includes('status'), true, 'unrelated system mappings must remain available');
	equal(filterPickerCandidates.find(candidate => candidate.mapping.canonicalKey === 'clientReference')?.kind, 'custom');

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
