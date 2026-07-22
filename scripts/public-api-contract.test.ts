import assert from 'node:assert/strict';
import {
	buildOperonPublicFilterEvaluationOptions,
	isOperonPublicAdoptInlineTaskInput,
	isOperonPublicConvertTaskInput,
	isOperonPublicCreateTaskInput,
	isOperonPublicFilterQueryInput,
	isOperonPublicRelocateTaskInput,
	isOperonPublicTransitionTaskInput,
	isOperonPublicUpdateTaskInput,
	isPublicManagedFieldWritable,
} from '../src/api/public-api';
import { getExcludedTablePickerTaskIds } from '../src/ui/table/table-editing';
import type { IndexedTask } from '../src/types/fields';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

async function run(): Promise<void> {
	equal(isOperonPublicCreateTaskInput({ source: 'inline', description: 'Valid' }), true);
	equal(isOperonPublicCreateTaskInput({ source: 'other', description: 'Invalid' }), false);
	equal(isOperonPublicCreateTaskInput(null), false);
	equal(isOperonPublicCreateTaskInput({ source: 'file', description: 'Invalid', tags: [42] }), false);
	equal(isOperonPublicCreateTaskInput({ source: 'inline', description: 'Invalid tag', tags: ['ok\n- [ ] injected'] }), false);
	equal(isOperonPublicCreateTaskInput({ source: 'file', description: 'Invalid tag', tags: ['ok\rinjected'] }), false);
	equal(isOperonPublicCreateTaskInput({ source: 'inline', description: 'Invalid tag', tags: ['client review'] }), false);
	equal(isOperonPublicCreateTaskInput({ source: 'inline', description: 'Valid tag', tags: ['#client-review', 'nested/tag'] }), true);
	equal(isOperonPublicCreateTaskInput({ source: 'file', description: 'Valid', properties: { score: 2, flags: ['a', true] } }), true);
	equal(isOperonPublicAdoptInlineTaskInput({ targetPath: 'Daily.md', line: 1, expectedLine: '- [ ] Task' }), true);
	equal(isOperonPublicAdoptInlineTaskInput({ targetPath: 'Daily.md', line: '1', expectedLine: '- [ ] Task' }), false);
	equal(isOperonPublicUpdateTaskInput({ fields: { priority: 'High' } }), true);
	equal(isOperonPublicUpdateTaskInput({ fields: { priority: 2 } }), false);
	equal(isOperonPublicUpdateTaskInput({ description: 'One line' }), true);
	equal(isOperonPublicUpdateTaskInput({ description: 'First\nSecond' }), false);
	equal(isOperonPublicUpdateTaskInput({ description: 'First\rSecond' }), false);
	equal(isOperonPublicUpdateTaskInput({ tags: ['valid', 'nested/tag'] }), true);
	equal(isOperonPublicUpdateTaskInput({ tags: ['ok\n- [ ] injected'] }), false);
	equal(isOperonPublicUpdateTaskInput({ tags: ['ok\rinjected'] }), false);
	equal(isOperonPublicUpdateTaskInput({ tags: ['client review'] }), false);
	equal(isOperonPublicUpdateTaskInput({ tags: ['#valid-tag'] }), true);
	equal(isOperonPublicTransitionTaskInput({ statusId: 'todo' }), true);
	equal(isOperonPublicTransitionTaskInput({ statusId: 2 }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'inline', targetPath: 'Project.md' }), true);
	equal(isOperonPublicConvertTaskInput({ target: 'inline', targetPath: 'Board.canvas' }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'inline' }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'inline', targetPath: 'Project.md', targetFolder: 'Tasks' }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'inline', targetPath: 'Project.md', fileTemplateId: 'minimal' }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'file', targetFolder: 'Tasks', fileTemplateId: 'minimal' }), true);
	equal(isOperonPublicConvertTaskInput({ target: 'file', targetPath: 'Task.md' }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'yaml' }), false);
	equal(isOperonPublicFilterQueryInput({ filterSetId: 'now', scopePath: 'Efforts/Projets' }), true);
	equal(isOperonPublicFilterQueryInput({ filterSetId: 1 }), false);
	equal(isOperonPublicRelocateTaskInput({ targetPath: 'Project.md' }), true);
	equal(isOperonPublicRelocateTaskInput({ targetPath: null }), false);

	const allTasks = [{ operonId: 'root' }, { operonId: 'child' }];
	const projectSerialScopes = [{ id: 'scope-1', parentOperonId: 'root' }];
	const filePropertyContext = { signature: 'file-properties-v1' };
	const filterEvaluationOptions = buildOperonPublicFilterEvaluationOptions(
		allTasks,
		projectSerialScopes,
		filePropertyContext,
	);
	equal(filterEvaluationOptions.projectSerialScopeTasks, allTasks);
	equal(filterEvaluationOptions.projectSerialScopes, projectSerialScopes);
	equal(filterEvaluationOptions.filePropertyContext, filePropertyContext);

	const mappings = [
		{ canonicalKey: 'priority', sync: 'yes' as const },
		{ canonicalKey: 'duration', sync: 'yes' as const },
		{ canonicalKey: 'directSubtaskCount', sync: 'yes' as const },
		{ canonicalKey: 'customEditable', sync: 'yes' as const },
		{ canonicalKey: 'repeatSeriesId', sync: 'yes' as const, isInternal: true },
		{ canonicalKey: 'derived', sync: 'no' as const },
	];
	const editableFields = new Set(['priority', 'customEditable']);
	const isEditableField = (key: string): boolean => editableFields.has(key);
	equal(isPublicManagedFieldWritable('priority', mappings, isEditableField), true);
	equal(isPublicManagedFieldWritable('customEditable', mappings, isEditableField), true);
	equal(isPublicManagedFieldWritable('duration', mappings, isEditableField), false);
	equal(isPublicManagedFieldWritable('directSubtaskCount', mappings, isEditableField), false);
	equal(isPublicManagedFieldWritable('repeatSeriesId', mappings, isEditableField), false);
	equal(isPublicManagedFieldWritable('derived', mappings, isEditableField), false);
	equal(isPublicManagedFieldWritable('status', mappings, isEditableField), false);
	equal(isPublicManagedFieldWritable('operonId', mappings, isEditableField), false);
	equal(isPublicManagedFieldWritable('unknown', mappings, isEditableField), false);

	const hierarchy = [
		{ operonId: 'root', fieldValues: {} },
		{ operonId: 'child', fieldValues: { parentTask: 'root' } },
		{ operonId: 'grandchild', fieldValues: { parentTask: 'child' } },
		{ operonId: 'unrelated', fieldValues: {} },
	] as IndexedTask[];
	const excludedParentTaskIds = new Set(getExcludedTablePickerTaskIds('parentTask', hierarchy[0]!, hierarchy));
	equal(excludedParentTaskIds.has('root'), true);
	equal(excludedParentTaskIds.has('child'), true);
	equal(excludedParentTaskIds.has('grandchild'), true);
	equal(excludedParentTaskIds.has('unrelated'), false);

	console.log(`Public API contract tests passed: ${assertions} assertions`);
}

declare global {
	var __operonPublicApiContractTestRun: Promise<void> | undefined;
}

globalThis.__operonPublicApiContractTestRun = run();
