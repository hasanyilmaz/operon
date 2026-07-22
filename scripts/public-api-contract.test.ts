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
	equal(isOperonPublicCreateTaskInput({ source: 'file', description: 'Valid', properties: { score: 2, flags: ['a', true] } }), true);
	equal(isOperonPublicAdoptInlineTaskInput({ targetPath: 'Daily.md', line: 1, expectedLine: '- [ ] Task' }), true);
	equal(isOperonPublicAdoptInlineTaskInput({ targetPath: 'Daily.md', line: '1', expectedLine: '- [ ] Task' }), false);
	equal(isOperonPublicUpdateTaskInput({ fields: { priority: 'High' } }), true);
	equal(isOperonPublicUpdateTaskInput({ fields: { priority: 2 } }), false);
	equal(isOperonPublicUpdateTaskInput({ description: 'One line' }), true);
	equal(isOperonPublicUpdateTaskInput({ description: 'First\nSecond' }), false);
	equal(isOperonPublicUpdateTaskInput({ description: 'First\rSecond' }), false);
	equal(isOperonPublicTransitionTaskInput({ statusId: 'todo' }), true);
	equal(isOperonPublicTransitionTaskInput({ statusId: 2 }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'inline', targetPath: 'Project.md' }), true);
	equal(isOperonPublicConvertTaskInput({ target: 'inline', targetPath: 'Board.canvas' }), false);
	equal(isOperonPublicConvertTaskInput({ target: 'inline' }), false);
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
		{ canonicalKey: 'repeatSeriesId', sync: 'yes' as const, isInternal: true },
		{ canonicalKey: 'derived', sync: 'no' as const },
	];
	equal(isPublicManagedFieldWritable('priority', mappings), true);
	equal(isPublicManagedFieldWritable('repeatSeriesId', mappings), false);
	equal(isPublicManagedFieldWritable('derived', mappings), false);
	equal(isPublicManagedFieldWritable('status', mappings), false);
	equal(isPublicManagedFieldWritable('operonId', mappings), false);
	equal(isPublicManagedFieldWritable('unknown', mappings), false);

	console.log(`Public API contract tests passed: ${assertions} assertions`);
}

declare global {
	var __operonPublicApiContractTestRun: Promise<void> | undefined;
}

globalThis.__operonPublicApiContractTestRun = run();
