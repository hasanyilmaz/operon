import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const packageJson = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
const source = readFileSync(
	path.join(scriptDirectory, 'live-relationship-acceptance.mjs'),
	'utf8',
);

test('live relationship npm target runs the complete recovery scenario', () => {
	assert.equal(
		packageJson.scripts['agent-runtime:mutation:live:relationships'],
		'node scripts/agent-runtime/mutation/live-relationship-acceptance.mjs run',
	);
	assert.match(source, /const phase = process\.argv\[2\] \?\? 'run';/u);
	assert.match(source, /path\.basename\(vaultPath\),\s*'cli-test-vault'/u);
	assert.doesNotMatch(source, /operon-agent-runtime-phase1/u);
	assert.match(source, /\['run', 'happy', 'prepare', 'recover'\]\.includes\(phase\)/u);
	assert.match(
		source,
		/const productionAcceptance = Boolean\(process\.env\.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT\)/u,
	);
	assert.match(source, /resetSanitizedVault\(true\)/u);
	assert.match(source, /resetSanitizedVault\(false\)/u);
	assert.match(source, /delete resetEnvironment\.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT/u);
	assert.match(source, /runPhase\('happy'\)/u);
	assert.match(source, /runPhase\('prepare'\)/u);
	assert.match(source, /runObsidianLifecycle\(\)/u);
	assert.match(source, /wait\(30_500\)/u);
	assert.match(source, /runPhase\('recover'\)/u);
});
