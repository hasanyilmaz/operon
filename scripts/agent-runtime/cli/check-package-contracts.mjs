import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
	loadPublishedCliBinding,
	pluginRoot,
	verifyCanonicalPluginInputs,
} from './published-cli-v1.mjs';

const { binding } = await loadPublishedCliBinding();
await verifyCanonicalPluginInputs(binding);

const baseline = JSON.parse(await readFile(
	path.join(pluginRoot, 'contracts', 'agent-runtime', 'public-v1-baseline.json'),
	'utf8',
));
assert.equal(baseline.runtimeContract, binding.runtime.contractVersion);
assert.equal(baseline.cliContract, 1);

const packagedSchemas = binding.artifact.inventory
	.filter(item => item.path.startsWith('package/schemas/v1/'))
	.map(item => path.basename(item.path))
	.sort();
const canonicalSchemas = binding.runtime.canonicalSchemas
	.map(item => path.basename(item.path))
	.sort();
const externalSchemas = packagedSchemas.filter(file => (
	file !== 'schema-manifest.json' && !canonicalSchemas.includes(file)
));
assert.deepEqual(externalSchemas, [
	'cli-manifest.schema.json',
	'operon-cli-local.schema.json',
	'session.schema.json',
]);
assert.equal(packagedSchemas.length, 16);
assert.equal(binding.runtime.canonicalSchemas.length, 13);

const baselineDocuments = new Map();
for (const [key, document] of Object.entries(baseline.schemaDocuments ?? {})) {
	assert.equal(typeof document?.$id, 'string', `OPERON_CLI_BASELINE_SCHEMA_ID_MISSING:${key}`);
	assert.equal(baselineDocuments.has(document.$id), false, `OPERON_CLI_BASELINE_SCHEMA_ID_DUPLICATE:${document.$id}`);
	baselineDocuments.set(document.$id, { key, document });
}
assert.deepEqual(
	[...baselineDocuments.values()]
		.filter(item => item.key.startsWith('operon-cli/'))
		.map(item => path.basename(item.key))
		.sort(),
	externalSchemas,
);
for (const entrypoint of baseline.entrypoints ?? []) {
	const [id, fragment = ''] = entrypoint.ref.split('#', 2);
	const record = baselineDocuments.get(id);
	assert.ok(record, `OPERON_CLI_BASELINE_ENTRYPOINT_DOCUMENT_UNKNOWN:${entrypoint.schemaId}`);
	assert.notEqual(
		resolvePointer(record.document, fragment),
		undefined,
		`OPERON_CLI_BASELINE_ENTRYPOINT_MISSING:${entrypoint.schemaId}`,
	);
}
assert.equal(new Set((baseline.entrypoints ?? []).map(item => item.schemaId)).size, baseline.entrypoints.length);
assert.equal(new Set((baseline.errorRegistry ?? []).map(item => item.code)).size, baseline.errorRegistry.length);
assert.equal(binding.runtime.contractDigest, '407f3a222f8c59a9622038e99e9345d0d34882fd358149b38bce5354ae0ca92b');

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	package: `${binding.package.name}@${binding.package.version}`,
	runtimeSchemas: canonicalSchemas.length,
	externalSchemas: externalSchemas.length,
	entrypoints: baseline.entrypoints.length,
})}\n`);

function resolvePointer(document, fragment) {
	if (fragment === '') return document;
	if (!fragment.startsWith('/')) return undefined;
	let current = document;
	for (const raw of fragment.slice(1).split('/')) {
		const token = raw.replaceAll('~1', '/').replaceAll('~0', '~');
		if (!current || typeof current !== 'object' || !(token in current)) return undefined;
		current = current[token];
	}
	return current;
}
