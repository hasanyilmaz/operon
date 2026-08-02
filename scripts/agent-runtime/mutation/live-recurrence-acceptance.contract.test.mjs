import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const source = readFileSync(
	path.join(scriptDirectory, 'live-recurrence-acceptance.mjs'),
	'utf8',
);
const runnerPath = path.join(scriptDirectory, 'live-recurrence-acceptance.mjs');
const packageJson = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
const publishedLiveSource = readFileSync(
	path.join(pluginRoot, 'scripts/release/run-published-cli-live-acceptance.mjs'),
	'utf8',
);

test('recurrence acceptance is fixed to the reusable sanitized CLI vault', () => {
	assert.match(source, /vaultPath,\s*'\/private\/tmp\/cli-test-vault'/u);
	assert.match(source, /path\.join\(fixedTempRoot, 'cli-test-vault'\)/u);
	assert.doesNotMatch(source, /operon-agent-runtime-phase1/u);
	assert.match(source, /\['run', 'happy', 'prepare', 'recover'\]\.includes\(phase\)/u);
	assert.match(source, /phase === 'run' \? requiredVaultPath : realpathSync/u);
	assert.match(source, /vaultStat !== null && vaultStat\.isSymbolicLink\(\)/u);
	assert.doesNotMatch(source, /process\.argv\[3\]/u);
});

test('recurrence acceptance resets canonically before its repeatable orchestration', () => {
	assert.match(
		source,
		/const productionAcceptance = Boolean\(process\.env\.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT\)/u,
	);
	assert.match(source, /resetSanitizedVault\(productionAcceptance\);\s*waitForReadyRuntime\(\);/u);
	assert.match(
		source,
		/if \(productionAcceptance\) \{\s*resetSanitizedVault\(false\);\s*waitForReadyRuntime\(\);\s*\}/u,
	);
	assert.match(source, /if \(!useProductionArtifact\) delete resetEnvironment\.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT/u);
	assert.match(source, /\.\.\.\(useProductionArtifact \? \['--production'\] : \[\]\)/u);
	assert.match(source, /scripts\/agent-runtime\/create-sanitized-vault\.mjs/u);
	assert.match(source, /\['vault=cli-test-vault', 'reload'\]/u);
	assert.match(source, /'plugin:enable',\s*'id=operon',\s*'filter=community'/u);
	assert.match(source, /enable\.error\?\.code === 'ETIMEDOUT'/u);
	assert.match(source, /runPhase\('prepare'\)/u);
	assert.match(source, /reloadRuntime\(\)/u);
	assert.match(source, /wait\(30_500\)/u);
	assert.match(source, /runPhase\('recover'\)/u);
});

test('recurrence recovery uses a real probe interruption and the exact retained plan', () => {
	assert.equal(
		countOccurrences(source, "idempotencyKey: 'a12-probe-recurrence-interrupt-v1'"),
		1,
	);
	assert.equal(
		countOccurrences(source, "capability: 'tasks.recurrence.preview'"),
		2,
		'One capability declaration is expected in the happy helper and one in recovery prepare.',
	);
	assert.match(source, /status, 'outcome-unknown'/u);
	assert.match(source, /mutationMayHaveApplied, true/u);
	assert.match(source, /retryAllowed, false/u);
	assert.match(source, /'recover',\s*state\.planRef/u);
	assert.match(source, /samePlan: true/u);
	assert.match(source, /status, 'already-applied'/u);
	assert.match(source, /postflight\?\.status, 'receipt-replay'/u);
	assert.match(source, /must retain the exact 24-hour tombstone/u);
	assert.doesNotMatch(source, /storedPlan/u);
	assert.doesNotMatch(source, /applyRequest\s*=/u);
	assert.doesNotMatch(source, /writeFileSync\(plan/u);
	assert.equal(countOccurrences(source, 'writeFileSync('), 1);
	assert.match(source, /writeFileSync\(recoveryStatePath/u);
	assert.doesNotMatch(
		source,
		/writeFileSync\((?:sourcePath|repeatSeriesPath|settingsPath|requiredVaultPath)/u,
	);
});

test('recurrence acceptance fails closed before every happy-path live mutation', () => {
	assert.match(source, /assertRuntimeReady\(\);\s*const initial/u);
	assert.match(source, /vaultIdentity\?\.expectedMatch,\s*true/u);
	assert.match(source, /lifecyclePhase,\s*'ready'/u);
	assert.match(source, /v8PersistencePhase,\s*'idle'/u);
	assert.match(source, /assertRequestRootClean\(\);/u);
	assert.match(source, /operon-agent-runtime-uid-/u);
	assert.match(source, /readdirSync\(requestRoot\)\.length,\s*0/u);
	assert.match(source, /isSymbolicLink\(\), false/u);
	assert.match(source, /stat\.mode & 0o777, 0o700/u);
});

test('recurrence acceptance covers each exact scope without greedy cross-block matching', () => {
	const start = between("const started = mutate('start'", "let task = readTask('inln001', 'started')");
	const thisTask = between("const thisTask = mutate('this-task'", "task = readTask('inln001', 'this-task')");
	const following = between(
		"const following = mutate('this-and-following'",
		"task = readTask('inln001', 'this-and-following')",
	);
	const clear = between("const cleared = mutate('clear'", "task = readTask('inln001', 'cleared')");
	assert.match(start, /scope: 'this-and-following'/u);
	assert.match(start, /field: 'repeat'/u);
	assert.match(start, /repeatSeriesEffect: 'write'/u);
	assert.match(thisTask, /scope: 'this-task'/u);
	assert.match(thisTask, /field: 'dateDue'/u);
	assert.match(thisTask, /repeatSeriesEffect: 'none'/u);
	assert.match(following, /scope: 'this-and-following'/u);
	assert.match(following, /field: 'dateScheduled'/u);
	assert.match(following, /repeatSeriesEffect: 'write'/u);
	assert.match(clear, /operation: 'clear'/u);
	assert.match(clear, /field: 'repeat'/u);
	assert.match(clear, /repeatSeriesEffect: 'write'/u);
	assert.match(source, /\['plan', 'apply', planRef/u);
});

test('recurrence acceptance asserts source-series atomicity and this-task state immutability', () => {
	assert.match(source, /function assertRecurrenceAtomicity/u);
	assert.match(source, /Task source and repeat-series state must be sealed in the same atomic group/u);
	assert.match(source, /This-task recurrence must not seal a repeat-series write/u);
	assert.match(source, /must not rewrite repeat-series state/u);
	assert.match(source, /targets\?\.\[0\]\?\.locator, currentTask\.locator/u);
});

test('an invalid phase is rejected before the runner can contact the Runtime', () => {
	const rejected = spawnSync(
		process.execPath,
		[runnerPath, 'outside-vault'],
		{ encoding: 'utf8' },
	);
	assert.notEqual(rejected.status, 0);
	assert.match(rejected.stderr, /Expected run, happy, prepare or recover phase/u);
});

test('the recurrence contract stays in normal checks while live execution uses the verified published lane', () => {
	assert.match(
		packageJson.scripts['agent-runtime:mutation:characterization'],
		/live-recurrence-acceptance\.contract\.test\.mjs/u,
	);
	assert.equal(
		packageJson.scripts['agent-runtime:mutation:live:published'],
		'node scripts/release/run-published-cli-live-acceptance.mjs',
	);
	assert.match(source, /requirePublishedCliExecutable/u);
	assert.match(publishedLiveSource, /withVerifiedPublishedCli/u);
	assert.doesNotMatch(publishedLiveSource, /OPERON_CLI_EXECUTABLE/u);
});

function between(startMarker, endMarker) {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0, `Missing start marker: ${startMarker}`);
	assert.ok(end > start, `Missing end marker: ${endMarker}`);
	return source.slice(start, end);
}

function countOccurrences(value, needle) {
	return value.split(needle).length - 1;
}
