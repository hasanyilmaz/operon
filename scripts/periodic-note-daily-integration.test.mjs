import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../main.ts', import.meta.url), 'utf8');

function extractMethod(methodName, nextMethodName) {
	const start = mainSource.indexOf(`\tprivate ${methodName}`);
	const end = mainSource.indexOf(`\n\tprivate ${nextMethodName}`, start + 1);
	assert.notEqual(start, -1, `${methodName} should exist`);
	assert.notEqual(end, -1, `${nextMethodName} should follow ${methodName}`);
	return mainSource.slice(start, end);
}

test('the existing Daily Note compatibility wrapper delegates to the shared periodic adapter', () => {
	const wrapper = extractMethod(
		'async resolveOrCreateCalendarDailyNoteResult',
		'async resolveOrCreatePeriodicNoteResult',
	);
	assert.match(wrapper, /return await this\.resolveOrCreatePeriodicNoteResult\('daily', dateKey\)/);

	const method = extractMethod(
		'async resolveOrCreatePeriodicNoteResult',
		'async resolvePeriodicParentConfigs',
	);
	assert.match(method, /await this\.resolveEffectivePeriodicNoteConfig\(kind\)/);
	assert.match(method, /this\.getPeriodicNoteService\(\)\.getOrCreate\(\{[\s\S]*?dateKey/);
	assert.match(method, /result\.status === 'existing'/);
	assert.match(method, /shouldFinalizeCreatedPath = result\.ok[\s\S]*?result\.status === 'created'/);
	assert.match(method, /if \(shouldFinalizeCreatedPath\) \{[\s\S]*?scheduleReindex\(filePath\)/);
});

test('Daily availability and configuration prefer Operon while retaining the Core fallback', () => {
	const availability = extractMethod(
		'isEffectiveDailyNotesAvailable',
		'async resolveEffectiveDailyNoteConfig',
	);
	assert.match(availability, /isPeriodicNoteKindAvailable\([\s\S]*?'daily'[\s\S]*?this\.settings[\s\S]*?isDailyNotesCoreAvailable/);

	const resolver = extractMethod(
		'async resolveEffectivePeriodicNoteConfig',
		'async resolveEffectiveDailyNoteConfig',
	);
	assert.match(resolver, /resolvePeriodicNoteConfigFromSettings\(\{/);
	assert.match(resolver, /kind,/);
	assert.match(resolver, /settings: this\.settings/);
	assert.match(resolver, /coreDailyNotesAvailable: coreAvailable/);
	assert.match(resolver, /loadCoreDailyNotes: async \(\) => \{[\s\S]*?await loadDailyNotesCoreConfig\(this\.app\)/);
	assert.match(resolver, /createAsOperonTask: this\.settings\.createDailyNotesAsOperonTask/);

	for (const methodName of [
		'applyCalendarDailyNoteParentSeedForCreatorSubmit',
		'queueCalendarDailyNoteParentSeedBackgroundEnsure',
		'resolveCalendarDailyNoteTaskCreatorParentSeed',
	]) {
		assert.equal(mainSource.includes(methodName), false, `${methodName} should be removed`);
	}
});

test('Runtime configured Daily routing uses the shared effective provider and fails closed', () => {
	const resolver = extractMethod(
		'async resolveAgentRuntimeInlineCreationPath',
		'async resolveAgentRuntimeInlineCreationTarget',
	);
	assert.match(resolver, /await this\.resolveEffectiveDailyNoteConfig\(\)/);
	assert.match(resolver, /if \(!resolvedConfig\.available\)[\s\S]*?unavailable or invalid/);
	assert.match(resolver, /resolvePeriodicNotePathFromDateKey\('daily', localToday\(\), config\)/);
	assert.match(resolver, /config\.template\.trim\(\) \|\| config\.createAsOperonTask/);
	assert.doesNotMatch(resolver, /loadDailyNotesCoreConfig/);
});

test('periodic parent realignment follows the shared provider path', () => {
	const method = extractMethod(
		'async maybeApplyPeriodicNoteParentRealignmentToPayload',
		'async ensureParentFolderPathExists',
	);
	assert.match(method, /await this\.resolvePeriodicParentConfigs\(\)/);
	assert.match(method, /this\.classifyIndexedPeriodicFileTask/);
	assert.match(method, /resolvePeriodicParentRealignment\(/);
	assert.match(method, /this\.resolveOrCreatePeriodicNoteParentTaskId\(/);
	assert.doesNotMatch(method, /loadDailyNotesCoreConfig/);
});

test('periodic creation failures use the shared localized Notice mapper', () => {
	const method = extractMethod(
		'showPeriodicNoteCreationError',
		'getPeriodicNoteService',
	);
	for (const key of [
		'periodicNoteRecoveryRequired',
		'periodicNoteTemplateUnavailable',
		'periodicNoteTargetConflict',
		'periodicNoteInvalidConfig',
		'periodicNoteCreationFailed',
	]) {
		assert.match(method, new RegExp(`'${key}'`));
	}
	assert.match(method, /kind === 'weekly'[\s\S]*?fileTaskWeeklyNotes[\s\S]*?fileTaskDailyNotes/);

	const dailyResult = extractMethod(
		'async resolveOrCreatePeriodicNoteResult',
		'async resolvePeriodicParentConfigs',
	);
	assert.match(dailyResult, /this\.showPeriodicNoteCreationError\(kind, result\.error\)/);
});

test('periodic deterministic rendering uses the target anchor date', () => {
	const method = extractMethod(
		'async resolvePeriodicNoteDeterministicContent',
		'async processPeriodicNoteTemplaterAtFinalPath',
	);
	assert.match(method, /date: input\.dateKey/);
	assert.match(method, /resolveCoreTemplateVariables\([\s\S]*?date: input\.dateKey/);
	assert.match(method, /resolveTemplatedFileTaskContent\(coreResolved, title, input\.now, input\.dateKey\)/);
});

test('legacy mutating Daily template helpers are no longer used', () => {
	assert.doesNotMatch(mainSource, /maybeProcessDailyNoteTemplateContent/);
	assert.doesNotMatch(mainSource, /loadDailyNoteTemplateSource/);
	assert.equal((mainSource.match(/\.getPeriodicNoteService\(\)\.getOrCreate\(/g) ?? []).length, 1);
});
