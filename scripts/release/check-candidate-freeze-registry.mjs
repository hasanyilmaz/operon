#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPublishedCliBinding, verifyCanonicalPluginInputs } from '../agent-runtime/cli/published-cli-v1.mjs';
import { readRegularFileNoFollow, sha256 } from './check-accepted-freeze.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../..');
const registryRelativePath = 'contracts/agent-runtime/public-v1-release-freezes.json';
const mutableAliases = new Set([
	'contracts/agent-runtime/published-cli-v1.json',
	'contracts/agent-runtime/published-cli-v1.schema.json',
]);

const registryBytes = await readRegularFileNoFollow(path.join(pluginRoot, registryRelativePath), pluginRoot);
assert.equal(
	sha256(registryBytes),
	'15c3714c98e8d233af7ab5d5ed8ed2ac4dd331e1fd14103a0e527a5c61a81013',
	'OPERON_PUBLIC_V1_CANDIDATE_REGISTRY_DRIFT',
);
const registry = JSON.parse(registryBytes.toString('utf8'));
assert.deepEqual(Object.keys(registry).sort(), ['currentPluginVersion', 'kind', 'registryVersion', 'releases']);
assert.equal(registry.registryVersion, 1);
assert.equal(registry.kind, 'operon-public-v1-release-freeze-registry');
assert.equal(registry.currentPluginVersion, '3.2.0');
assert.deepEqual(
	registry.releases.map(release => release.pluginVersion),
	['3.0.2', '3.1.0', '3.1.1', '3.2.0'],
);
for (const release of registry.releases) {
	assert.deepEqual(Object.keys(release).sort(), ['cliVersion', 'evidenceKind', 'files', 'pluginVersion']);
	for (const identity of release.files) {
		assert.deepEqual(Object.keys(identity).sort(), ['bytes', 'path', 'sha256']);
		if (mutableAliases.has(identity.path)) continue;
		const bytes = await readRegularFileNoFollow(path.join(pluginRoot, identity.path), pluginRoot);
		assert.equal(bytes.byteLength, identity.bytes, `OPERON_PUBLIC_V1_CANDIDATE_BYTES_DRIFT:${identity.path}`);
		assert.equal(sha256(bytes), identity.sha256, `OPERON_PUBLIC_V1_CANDIDATE_HASH_DRIFT:${identity.path}`);
	}
}
const { binding } = await loadPublishedCliBinding();
await verifyCanonicalPluginInputs(binding);
assert.equal(binding.package.version, '1.1.0');
assert.equal(binding.source.tag, 'cli-v1.1.0');
assert.equal(binding.provenance.publishRunAttempt, 2);

console.log('Operon 3.2.0 / CLI 1.1.0 candidate evidence registry verified.');
