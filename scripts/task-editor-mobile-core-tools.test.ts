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
		legacy.slice(-2),
		['__convertToPlain', 'remove'],
		'legacy layouts gain the new built-in action exactly before Remove',
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
	deepEqual(custom.slice(-2), ['__convertToPlain', 'remove']);

	const deduplicated = keys([
		{ key: 'goToSource', visible: true },
		{ key: '__convertToPlain', visible: false },
		{ key: 'priority', visible: true },
		{ key: '__convertToPlain', visible: true },
		{ key: 'remove', visible: true },
	]);
	deepEqual(
		deduplicated.filter(key => key === '__convertToPlain'),
		['__convertToPlain'],
		'normalization never persists duplicate conversion actions',
	);
	deepEqual(deduplicated.slice(-2), ['__convertToPlain', 'remove']);

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
	deepEqual(collisionPreserved.slice(-2).map(item => item.key), ['__convertToPlain', 'remove']);

	console.log(`Task Editor mobile core tools: ${assertions}/${assertions} passed`);
}

globalThis.__operonTaskEditorMobileCoreToolsTestRun = run();

declare global {
	var __operonTaskEditorMobileCoreToolsTestRun: Promise<void> | undefined;
}
