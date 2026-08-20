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
import { tryPatchInlineTaskLineContent, tryPatchYamlTaskContent } from '../src/core/task-writer';
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
import type { IndexedTask } from '../src/types/fields';
import { buildMergedFileTaskDraft, parseFrontmatterDocument } from '../src/core/file-task-template-merge';
import { filterTasksOnly } from '../src/core/filter-evaluator';
import {
	DEFAULT_SETTINGS,
	isChildTaskInheritanceEligibleFieldKey,
	normalizeChildTaskInheritanceFields,
	type OperonSettings,
} from '../src/types/settings';
import { parseYaml, type App } from 'obsidian';
import type { KeyMapping } from '../src/types/settings';
import {
	parseTaskMediaReferenceList,
	resolveTaskMediaReference,
	serializeTaskMediaReferenceList,
} from '../src/core/task-media-reference';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message ?? 'Values must be equal.');
	assertions += 1;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message ?? 'Values must be deeply equal.');
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
	const stage3Mappings = structuredClone(DEFAULT_SETTINGS.keyMappings);
	const stage3ReverseMap = buildReverseMapping(stage3Mappings);
	for (const [key, type] of [['taskType', 'text'], ['taskImage', 'text'], ['taskGallery', 'list']] as const) {
		equal(stage3Mappings.some(mapping => mapping.canonicalKey === key && mapping.isSystem === true), true);
		equal(isManagedTaskFieldCanonicalKey(key, stage3Mappings), true);
		equal(isManagedYamlCanonicalKey(key, stage3Mappings), true);
		equal(getManagedTaskFieldType(key, stage3Mappings), type);
		equal(stage3ReverseMap.has(key), true);
		const parsed = parseTaskLine(`- [ ] Canonical ${key} {{${key}:: value}}`, 0, 'Tasks/Notes.md', stage3Mappings);
		assert.ok(parsed);
		assertions += 1;
		equal(parsed.fields.find(field => field.key === key)?.isCanonical, true);
		equal(parsed.fields.find(field => field.key === key)?.type, type);
	}
	const editorCanonicalFields = [
		buildTaskEditorOperonField('taskImage', 'Assets/cover.png', stage3Mappings),
		buildTaskEditorOperonField('taskType', 'Project', stage3Mappings),
		buildTaskEditorOperonField('taskGallery', 'Assets/one.png; Assets/two.png', stage3Mappings),
	];
	for (const field of editorCanonicalFields) {
		equal(field.type, field.key === 'taskGallery' ? 'list' : 'text');
		equal(field.isCanonical, true);
	}
	const editorBase = parseTaskLine('- [ ] Editor producer', 0, 'Tasks/Notes.md', stage3Mappings);
	assert.ok(editorBase);
	assertions += 1;
	equal(
		serializeTask({ ...editorBase, fields: editorCanonicalFields }, stage3Mappings),
		'- [ ] Editor producer {{taskType:: Project}} {{taskImage:: Assets/cover.png}} {{taskGallery:: Assets/one.png; Assets/two.png}}',
		'Task Editor reconstruction must use canonical field order.',
	);
	const recurringClone = transformRecurringFileBody({
		sourceBody: '- [ ] Recurring child {{operonId:: child-old}} {{parentTask:: root-old}} {{repeatSeriesId:: series-child}} {{taskImage:: Assets/cover.png}} {{taskType:: Project}} {{taskGallery:: Assets/one.png; Assets/two.png}}',
		sourceFilePath: 'Tasks/Recurring.md',
		oldRootOperonId: 'root-old',
		newRootOperonId: 'root-new',
		oldRootFieldValues: {},
		newRootFieldValues: {},
		rootSeriesId: 'series-root',
		keyMappings: stage3Mappings,
		pipelines: structuredClone(DEFAULT_SETTINGS.pipelines),
		defaultPipelineName: DEFAULT_SETTINGS.defaultPipelineName,
		now: '2026-08-20T10:00:00',
		generateOperonId: () => 'child-new',
	});
	equal(recurringClone.clonedSubtaskCount, 1);
	for (const key of ['taskImage', 'taskType', 'taskGallery']) {
		equal(parseTaskLine(recurringClone.body, 0, 'Tasks/Recurring.md', stage3Mappings)?.fields.find(field => field.key === key)?.isCanonical, true);
	}
	const recurringImageIndex = recurringClone.body.indexOf('{{taskImage::');
	const recurringTypeIndex = recurringClone.body.indexOf('{{taskType::');
	const recurringGalleryIndex = recurringClone.body.indexOf('{{taskGallery::');
	equal(recurringTypeIndex >= 0 && recurringTypeIndex < recurringImageIndex && recurringImageIndex < recurringGalleryIndex, true, 'Recurring clone must use canonical task-data order.');
	const inheritedTaskDataFields = ['taskType', 'taskImage', 'taskGallery'];
	deepEqual(
		normalizeChildTaskInheritanceFields(inheritedTaskDataFields, stage3Mappings),
		inheritedTaskDataFields,
		'Task-data inheritance selections must normalize as active managed fields.',
	);
	for (const key of inheritedTaskDataFields) {
		equal(isChildTaskInheritanceEligibleFieldKey(key, stage3Mappings), true, `${key} must be selectable for parser-backed inheritance.`);
	}
	deepEqual(
		resolveSubtaskInitialFieldsFromParentValues(
			'parent-001',
			{ taskType: 'Project', taskImage: 'Assets/cover.png', taskGallery: 'Assets/one.png; Assets/two.png' },
			{
				...structuredClone(DEFAULT_SETTINGS),
				childTaskInheritanceFields: inheritedTaskDataFields,
			} as OperonSettings,
		),
		{
			parentTask: 'parent-001',
			taskType: 'Project',
			taskImage: 'Assets/cover.png',
			taskGallery: 'Assets/one.png; Assets/two.png',
		},
		'Parser-backed task-data selections must propagate through child inheritance.',
	);
	deepEqual(
		readYamlFields({ taskType: 'Project', taskImage: 'Assets/cover.png', taskGallery: ['Assets/one.png'] }, stage3Mappings),
		{ taskType: 'Project', taskImage: 'Assets/cover.png', taskGallery: 'Assets/one.png' },
	);
	const taskDataFrontmatter = {
		taskType: 'Project',
		taskImage: 'Assets/cover.png',
		taskGallery: ['Assets/one.png'],
	};
	applyYamlTaskFieldValues(taskDataFrontmatter, {
		taskType: 'Updated',
		taskImage: 'Assets/updated.png',
		taskGallery: 'Assets/two.png; Assets/two.png; Assets/three.png',
	}, 'replace', stage3Mappings);
	deepEqual(taskDataFrontmatter, {
		taskType: 'Updated',
		taskImage: 'Assets/updated.png',
		taskGallery: ['Assets/two.png', 'Assets/three.png'],
	});
	const rawTaskDataLine = '- [ ] Canonical {{taskImage:: Assets/cover.png}} {{taskType:: Project}} {{taskGallery:: Assets/one.png; Assets/two.png}}';
	equal(
		normalizeTaskLine(rawTaskDataLine, 0, 'Tasks/Notes.md', stage3Mappings),
		'- [ ] Canonical {{taskType:: Project}} {{taskImage:: Assets/cover.png}} {{taskGallery:: Assets/one.png; Assets/two.png}}',
		'Task-data fields must normalize in their canonical order.',
	);
	equal(
		normalizeTaskLine('- [ ] Ordered {{priority:: C}} {{status:: Project.Inbox}}', 0, 'Tasks/Notes.md', stage3Mappings),
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
		...stage3Mappings,
		customMapping,
	]);
	const filterPickerFields = filterPickerCandidates.map(candidate => candidate.mapping.canonicalKey);
	for (const key of ['taskType', 'taskImage', 'taskGallery']) {
		equal(filterPickerFields.includes(key), true, `${key} must be available in FilterSet pickers after Stage 3 admission.`);
	}
	equal(filterPickerFields.includes('status'), true, 'unrelated system mappings must remain available');
	equal(filterPickerCandidates.find(candidate => candidate.mapping.canonicalKey === 'clientReference')?.kind, 'custom');

	const galleryValue = '![[Assets/cover;v2.png|Cover]]; https://cdn.example.test/one.png; ![[Assets/cover;v2.png|Cover]]';
	const serializedGallery = serializeTaskMediaReferenceList([
		'![[Assets/cover;v2.png|Cover]]',
		'https://cdn.example.test/one.png',
		'![[Assets/cover;v2.png|Cover]]',
	]);
	equal(serializedGallery, '!\\[\\[Assets/cover\\;v2.png|Cover\\]\\]; https://cdn.example.test/one.png');
	deepEqual(parseTaskMediaReferenceList(serializedGallery), [
		'![[Assets/cover;v2.png|Cover]]',
		'https://cdn.example.test/one.png',
	]);
	const parsedGallery = parseTaskLine(
		`- [ ] Gallery {{taskGallery:: ${serializedGallery}}}`,
		0,
		'Tasks/Notes.md',
		stage3Mappings,
	);
	assert.ok(parsedGallery);
	assertions += 1;
	equal(parsedGallery.fields.find(field => field.key === 'taskGallery')?.value, serializedGallery);
	deepEqual(inlineToYamlValue('taskGallery', serializedGallery, stage3Mappings), [
		'![[Assets/cover;v2.png|Cover]]',
		'https://cdn.example.test/one.png',
	]);
	equal(inlineToYamlValue('taskImage', 'https://cdn.example.test/cover.png', stage3Mappings), 'https://cdn.example.test/cover.png');
	deepEqual(readYamlFields({ taskGallery: [
		'![[Assets/cover;v2.png|Cover]]',
		'https://cdn.example.test/one.png',
		'![[Assets/cover;v2.png|Cover]]',
	] }, stage3Mappings), { taskGallery: serializedGallery });
	const galleryCodecItems = [
		'![[Assets/cover;v2.png|Cover]]',
		'Assets/local-image.png',
		'https://cdn.example.test/remote-image.png',
		'![[Assets/cover;v2.png|Cover]]',
	];
	const galleryCodecValue = serializeTaskMediaReferenceList(galleryCodecItems);
	const expectedGalleryCodecItems = galleryCodecItems.slice(0, 3);
	const galleryConverter = new FormatConverter(
		{} as App,
		{
			getTask: () => ({
				operonId: 'gallery-converter',
				description: 'Gallery converter',
				fieldValues: { taskGallery: galleryCodecValue },
				tags: [],
			}),
		} as unknown as OperonIndexer,
		{ keyMappings: stage3Mappings } as unknown as OperonSettings,
	);
	const galleryConvertedSource = galleryConverter.renderInlineToYaml('gallery-converter');
	assert.ok(galleryConvertedSource);
	assertions += 1;
	const galleryConvertedFrontmatter = galleryConvertedSource.slice(4, galleryConvertedSource.lastIndexOf('\n---'));
	deepEqual(
		(parseYaml(galleryConvertedFrontmatter) as Record<string, unknown>).taskGallery,
		expectedGalleryCodecItems,
		'Format conversion must decode only taskGallery escaped separators into a YAML array.',
	);
	const singleGalleryConverter = new FormatConverter(
		{} as App,
		{
			getTask: () => ({
				operonId: 'single-gallery-converter',
				description: 'Single gallery converter',
				fieldValues: { taskGallery: 'Assets/single-image.png' },
				tags: [],
			}),
		} as unknown as OperonIndexer,
		{ keyMappings: stage3Mappings } as unknown as OperonSettings,
	);
	const singleGallerySource = singleGalleryConverter.renderInlineToYaml('single-gallery-converter');
	assert.ok(singleGallerySource);
	assertions += 1;
	const singleGalleryFrontmatter = singleGallerySource.slice(4, singleGallerySource.lastIndexOf('\n---'));
	deepEqual(
		(parseYaml(singleGalleryFrontmatter) as Record<string, unknown>).taskGallery,
		['Assets/single-image.png'],
		'The canonical taskGallery LIST must use a YAML array even for one media reference.',
	);
	const galleryTemplate = parseFrontmatterDocument([
		'---',
		'operonId: gallery-template',
		'taskGallery:',
		'  - "Assets/stale;image.png"',
		'---',
		'Gallery template body',
	].join('\n'), stage3Mappings);
	const mergedGalleryTemplate = buildMergedFileTaskDraft({
		source: {
			description: 'Gallery template',
			fieldValues: { taskGallery: galleryCodecValue },
			fieldPresence: new Set(['taskGallery']),
			tags: [],
			tagsPresent: false,
		},
		template: galleryTemplate,
		defaults: {
			operonId: 'gallery-template',
			status: 'Project.Inbox',
			priority: 'C',
			datetimeModified: '2026-08-20T10:00:00',
		},
		keyMappings: stage3Mappings,
		bodyStrategy: 'use-template',
	});
	const mergedGalleryDocument = parseFrontmatterDocument(mergedGalleryTemplate.content, stage3Mappings);
	equal(
		mergedGalleryDocument.managedFieldValues.taskGallery,
		galleryCodecValue,
		'File template merge must preserve taskGallery escaped separators through YAML write and inline return.',
	);
	const galleryFilter = structuredClone(DEFAULT_SETTINGS.filterSets[0]!);
	const galleryFilterCondition = {
		id: 'task-gallery-semicolon',
		field: 'taskGallery',
		fieldType: 'list' as const,
		operator: 'anyContains',
		value: 'cover;v2.png',
	};
	galleryFilter.rootGroup = { id: 'gallery-filter-root', logic: 'all', children: [galleryFilterCondition] };
	galleryFilter.conditions = [galleryFilterCondition];
	galleryFilter.sorts = [];
	const galleryFilterTasks: IndexedTask[] = [
		{
			operonId: 'gallery-match', description: 'matching media', checkbox: 'open',
			fieldValues: { taskGallery: galleryCodecValue }, tags: [],
			primary: { filePath: 'Tasks/Gallery.md', lineNumber: 0, format: 'inline' },
			datetimeModified: '2026-08-20T10:00:00', tier: 'hot',
		},
		{
			operonId: 'gallery-miss', description: 'other media', checkbox: 'open',
			fieldValues: { taskGallery: serializeTaskMediaReferenceList(['Assets/other.png']) }, tags: [],
			primary: { filePath: 'Tasks/Gallery.md', lineNumber: 1, format: 'inline' },
			datetimeModified: '2026-08-20T10:00:00', tier: 'hot',
		},
	];
	deepEqual(
		filterTasksOnly(galleryFilter, galleryFilterTasks).map(task => task.operonId),
		['gallery-match'],
		'FilterSet list evaluation must treat an escaped taskGallery semicolon as part of its media item.',
	);
	deepEqual(resolveTaskMediaReference('![[Assets/cover.png|Cover]]'), {
		rawValue: '![[Assets/cover.png|Cover]]', kind: 'wikilink', target: 'Assets/cover.png', isOpenable: true,
	});
	deepEqual(resolveTaskMediaReference('Assets/cover.png'), {
		rawValue: 'Assets/cover.png', kind: 'vault-path', target: 'Assets/cover.png', isOpenable: true,
	});
	deepEqual(resolveTaskMediaReference('https://cdn.example.test/cover.png'), {
		rawValue: 'https://cdn.example.test/cover.png', kind: 'http-url', target: 'https://cdn.example.test/cover.png', isOpenable: true,
	});
	deepEqual(resolveTaskMediaReference('javascript:alert(1)'), {
		rawValue: 'javascript:alert(1)', kind: 'unresolved', target: null, isOpenable: false,
	});

	const taskDataScalarCases = [
		{ key: 'taskType', type: 'text' as const, value: 'Reference {{ literal [[ token \\;\nnext}' },
		{ key: 'taskImage', type: 'text' as const, value: '![[Assets/cover.png|Cover]] literal {{ \\;\nnext]' },
	] as const;
	for (const testCase of taskDataScalarCases) {
		const source = parseTaskLine(`- [ ] Seed {{${testCase.key}:: value}}`, 0, 'Tasks/Notes.md', stage3Mappings);
		assert.ok(source);
		assertions += 1;
		const field = source.fields.find(candidate => candidate.key === testCase.key);
		assert.ok(field);
		assertions += 1;
		const serialized = serializeField({ ...field, value: testCase.value, type: testCase.type }, stage3Mappings);
		const reparsed = parseTaskLine(`- [ ] Before ${serialized} trailing description`, 0, 'Tasks/Notes.md', stage3Mappings);
		assert.ok(reparsed);
		assertions += 1;
		equal(reparsed.description, 'Before trailing description', `${testCase.key} must leave trailing description intact.`);
		equal(reparsed.fields.find(candidate => candidate.key === testCase.key)?.value, testCase.value);
		equal(inlineToYamlValue(testCase.key, reparsed.fields.find(candidate => candidate.key === testCase.key)?.value ?? '', stage3Mappings), testCase.value);
	}
	const galleryStructuralItems = [
		'Assets/trailing}',
		'Assets/trailing]',
		'Assets/{{literal[[draft]]}}.png',
		'Assets/one\\two;semi\nnext.png',
		'![[Assets/cover.png|Cover]]',
	];
	const structuralGalleryValue = serializeTaskMediaReferenceList(galleryStructuralItems);
	const structuralGallerySeed = parseTaskLine('- [ ] Seed {{taskGallery:: value}}', 0, 'Tasks/Notes.md', stage3Mappings);
	assert.ok(structuralGallerySeed);
	assertions += 1;
	const structuralGalleryField = structuralGallerySeed.fields.find(candidate => candidate.key === 'taskGallery');
	assert.ok(structuralGalleryField);
	assertions += 1;
	const structuralGallerySerialized = serializeField({
		...structuralGalleryField,
		value: structuralGalleryValue,
		type: 'list',
	}, stage3Mappings);
	const structuralGalleryParsed = parseTaskLine(
		`- [ ] Before ${structuralGallerySerialized} trailing description`,
		0,
		'Tasks/Notes.md',
		stage3Mappings,
	);
	assert.ok(structuralGalleryParsed);
	assertions += 1;
	equal(structuralGalleryParsed.description, 'Before trailing description', 'Gallery escaping must leave trailing description intact.');
	equal(structuralGalleryParsed.fields.find(candidate => candidate.key === 'taskGallery')?.value, structuralGalleryValue);
	deepEqual(
		inlineToYamlValue('taskGallery', structuralGalleryParsed.fields.find(candidate => candidate.key === 'taskGallery')?.value ?? '', stage3Mappings),
		galleryStructuralItems,
	);

	const inlineCreated = tryPatchInlineTaskLineContent(
		'- [ ] Inline {{operonId:: media-inline}}',
		'Tasks/Notes.md',
		'media-inline',
		{ taskType: 'Reference', taskImage: '![[Assets/cover.png]]', taskGallery: serializedGallery },
		0,
		'merge',
		stage3Mappings,
	);
	equal(inlineCreated.ok, true);
	if (inlineCreated.ok) {
		equal(inlineCreated.content, `- [ ] Inline {{operonId:: media-inline}} {{taskType:: Reference}} {{taskImage:: !\\[\\[Assets/cover.png\\]\\]}} {{taskGallery:: ${serializedGallery}}}`);
	}
	const inlineUpdated = inlineCreated.ok
		? tryPatchInlineTaskLineContent(inlineCreated.content, 'Tasks/Notes.md', 'media-inline', {
			taskGallery: 'Assets/two.png; Assets/two.png; Assets/three.png',
		}, 0, 'merge', stage3Mappings)
		: inlineCreated;
	equal(inlineUpdated.ok, true);
	if (inlineUpdated.ok) equal(inlineUpdated.content.includes('{{taskGallery:: Assets/two.png; Assets/three.png}}'), true);
	const inlineCleared = inlineUpdated.ok
		? tryPatchInlineTaskLineContent(inlineUpdated.content, 'Tasks/Notes.md', 'media-inline', {
			taskImage: '', taskGallery: '',
		}, 0, 'merge', stage3Mappings)
		: inlineUpdated;
	equal(inlineCleared.ok, true);
	if (inlineCleared.ok) {
		equal(inlineCleared.content.includes('taskImage'), false);
		equal(inlineCleared.content.includes('taskGallery'), false);
	}

	const fileCreated = tryPatchYamlTaskContent(
		'---\noperonId: media-file\n---\nFile task',
		'media-file',
		{ taskType: 'Reference', taskImage: 'https://cdn.example.test/cover.png', taskGallery: serializedGallery },
		'merge',
		stage3Mappings,
	);
	equal(fileCreated.ok, true);
	if (fileCreated.ok) {
		const fileCreatedFields = readYamlFields(parseYaml(fileCreated.content.split('---')[1] ?? '') as Record<string, unknown>, stage3Mappings);
		deepEqual(fileCreatedFields, {
			operonId: 'media-file', taskType: 'Reference', taskImage: 'https://cdn.example.test/cover.png', taskGallery: serializedGallery,
		});
	}
	const fileUpdated = fileCreated.ok
		? tryPatchYamlTaskContent(fileCreated.content, 'media-file', { taskGallery: 'Assets/two.png; Assets/two.png; Assets/three.png' }, 'merge', stage3Mappings)
		: fileCreated;
	equal(fileUpdated.ok, true);
	if (fileUpdated.ok) {
		const fileUpdatedYaml = parseYaml(fileUpdated.content.split('---')[1] ?? '') as Record<string, unknown>;
		deepEqual(fileUpdatedYaml.taskGallery, ['Assets/two.png', 'Assets/three.png']);
	}
	const fileCleared = fileUpdated.ok
		? tryPatchYamlTaskContent(fileUpdated.content, 'media-file', { taskImage: '', taskGallery: '' }, 'merge', stage3Mappings)
		: fileUpdated;
	equal(fileCleared.ok, true);
	if (fileCleared.ok) {
		const fileClearedFields = readYamlFields(parseYaml(fileCleared.content.split('---')[1] ?? '') as Record<string, unknown>, stage3Mappings);
		equal(fileClearedFields.taskImage, '');
		equal(fileClearedFields.taskGallery, '');
	}

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
