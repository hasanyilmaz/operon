import assert from 'node:assert/strict';
import { normalizeTaskEditorMobileCoreTools } from '../src/types/settings';

let assertions = 0;

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}

function keys(raw: unknown): string[] {
	return normalizeTaskEditorMobileCoreTools(raw as any, undefined, []).map(item => item.key);
}

async function run(): Promise<void> {
	const legacy = keys([
		{ key: 'goToSource', visible: true },
		{ key: 'priority', visible: false },
		{ key: 'remove', visible: true },
	]);
	deepEqual(
		legacy.slice(-1),
		['remove'],
		'Remove remains the final built-in action',
	);

	const custom = keys([
		{ key: 'goToSource', visible: true },
		{ key: 'dateDue', visible: true },
		{ key: 'priority', visible: true },
		{ key: 'remove', visible: true },
	]);
	const dateDueIndex = custom.indexOf('dateDue');
	const priorityIndex = custom.indexOf('priority');
	assert.ok(dateDueIndex >= 0 && priorityIndex > dateDueIndex, 'custom middle order remains intact');
	assertions += 1;
	deepEqual(custom.slice(-1), ['remove']);

	const deduplicated = keys([
		{ key: 'goToSource', visible: true },
		{ key: '__convertToPlain', visible: false },
		{ key: 'priority', visible: true },
		{ key: '__convertToPlain', visible: true },
		{ key: 'remove', visible: true },
	]);
	deepEqual(
		deduplicated.filter(key => key === '__convertToPlain'),
		[],
		'normalization removes every retired conversion action',
	);
	deepEqual(deduplicated.slice(-1), ['remove']);

	const collisionPreserved = normalizeTaskEditorMobileCoreTools([
		{ key: 'goToSource', visible: true },
		{ key: 'convertToPlain', visible: true },
		{ key: 'remove', visible: true },
	] as any, undefined, [{
		canonicalKey: 'convertToPlain',
		visiblePropertyName: 'User conversion field',
		type: 'text',
		sync: 'yes',
		enabled: true,
		isSystem: false,
	}]);
	deepEqual(
		collisionPreserved.filter(item => item.key === 'convertToPlain').map(item => item.key),
		['convertToPlain'],
		'legacy custom mappings named convertToPlain remain custom controls',
	);
	deepEqual(collisionPreserved.filter(item => item.key === '__convertToPlain'), []);
	deepEqual(collisionPreserved.slice(-1).map(item => item.key), ['remove']);

	console.log(`Task Editor mobile core tools: ${assertions}/${assertions} passed`);
}

globalThis.__operonTaskEditorMobileCoreToolsTestRun = run();

declare global {
	var __operonTaskEditorMobileCoreToolsTestRun: Promise<void> | undefined;
}
