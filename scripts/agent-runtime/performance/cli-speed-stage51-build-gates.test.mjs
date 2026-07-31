import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pluginRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../..',
);

test('Stage 5.1 promotes ordinary production and retains explicit candidate and rollback artifacts', () => {
	const source = readFileSync(path.join(pluginRoot, 'esbuild.config.mjs'), 'utf8');
	const buildConfig = readFileSync(path.join(pluginRoot, 'operon-build-config.mjs'), 'utf8');
	assert.match(buildConfig, /OPERON_PRODUCTION_PERSISTENT_READ = true/u);
	assert.match(source, /OPERON_PRODUCTION_PERSISTENT_READ/u);
	assert.match(source, /"production-agent-runtime-persistent-read-candidate"/u);
	assert.match(source, /"production-agent-runtime-persistent-read-disabled"/u);
	assert.match(
		source,
		/buildMode === "production-agent-runtime-persistent-read-candidate"/u,
	);
	assert.match(source, /"build\/stage51\/main-production\.js"/u);
	assert.match(source, /"build\/stage51\/main-disabled\.js"/u);
	assert.doesNotMatch(
		source,
		/const agentRuntimePersistentRead\s*=\s*buildMode\s*!==\s*"development"/u,
	);
});

test('production bundle guard rejects persistent server markers unless explicitly allowed', () => {
	const source = readFileSync(
		path.join(pluginRoot, 'scripts/check-agent-runtime-probe-bundle.mjs'),
		'utf8',
	);
	assert.match(source, /--allow-persistent-read/u);
	assert.match(source, /persistent-read-server-start-failed/u);
	assert.match(source, /persistent-read-descriptor-not-secure/u);
	assert.match(source, /persistent-read-socket-not-secure/u);
});

test('CLI build replaces the persistent client and rejects disabled-build leaks', () => {
	const source = readFileSync(path.join(pluginRoot, 'packages/operon-cli/build.mjs'), 'utf8');
	const buildConfig = readFileSync(path.join(pluginRoot, 'operon-build-config.mjs'), 'utf8');
	assert.match(buildConfig, /OPERON_PRODUCTION_CLI_PERSISTENT_READ = true/u);
	assert.match(source, /OPERON_PRODUCTION_CLI_PERSISTENT_READ/u);
	assert.match(source, /persistentReadOverride === undefined/u);
	assert.match(source, /persistentReadOverride === '1'/u);
	assert.match(source, /strip-persistent-read-client/u);
	assert.match(source, /persistentReadBuild \? \[\] : \[stripPersistentReadClientPlugin\]/u);
	assert.match(source, /strip-frame-timing/u);
	assert.match(source, /frameTimingBuild \? \[\] : \[stripFrameTimingPlugin\]/u);
	assert.match(source, /OPERON_CLI_DISABLED_PERSISTENT_READ_LEAK/u);
	assert.match(source, /OPERON_CLI_DISABLED_FRAME_TIMING_LEAK/u);
	for (const marker of [
		'frameTiming',
		'timeOriginMs',
		'submittedEpochMs',
		'serviceStartEpochMs',
		'serviceEndEpochMs',
		'clockOffsetMs',
	]) {
		assert.match(source, new RegExp(`'${marker}'`, 'u'));
	}
});
