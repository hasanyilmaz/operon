import assert from 'node:assert/strict';
import { parseTaskLine } from '../src/core/parser';
import { serializePlainCheckboxTask } from '../src/core/plain-task-conversion';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function convert(source: string): string {
	const parsed = parseTaskLine(source, 7, 'Tasks/Inline.md', []);
	assert.ok(parsed, `source must parse: ${source}`);
	return serializePlainCheckboxTask(parsed, []);
}

async function run(): Promise<void> {
	equal(
		convert('  - [ ] 09:00 Plan launch #work {{operonId:: ABC1234}} {{status:: Core.Todo}}'),
		'  - [ ] Plan launch #work',
		'open tasks preserve indentation, description, and tags only',
	);
	equal(
		convert('\t- [x] Done task #finished {{operonId:: ABC1234}} {{customField:: value}}'),
		'\t- [x] Done task #finished',
		'done tasks stay done and remove custom metadata',
	);
	equal(
		convert('- [-] Cancelled task #later {{operonId:: ABC1234}} {{repeat:: every day}}'),
		'- [-] Cancelled task #later',
		'cancelled tasks retain their explicit cancelled checkbox marker',
	);
	equal(
		convert('- [ ] öaea ieaiea #calendar #dependencies #task-finder {{operonId:: 6flhkzl}} {{status:: Project.Brainstorming}} {{priority:: C}} {{taskColor:: 2563EB}} {{datetimeCreated:: 2026-08-14T12:22:10}} {{datetimeModified:: 2026-08-14T12:22:59}}'),
		'- [ ] öaea ieaiea #calendar #dependencies #task-finder',
		'Unicode descriptions and multiple tags convert without retaining Operon metadata',
	);
	console.log(`Plain task conversion: ${assertions}/${assertions} passed`);
}

globalThis.__operonPlainTaskConversionTestRun = run();

declare global {
	var __operonPlainTaskConversionTestRun: Promise<void> | undefined;
}
