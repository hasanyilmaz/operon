import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	buildRuntimeSchemaManifestV1,
	checkRuntimeSchemaManifestV1,
	writeRuntimeSchemaManifestV1,
} from './generate-schema-manifest.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = path.join(pluginRoot, 'contracts', 'agent-runtime', 'v1');

async function fixtureRoot() {
	const root = await mkdtemp(path.join(tmpdir(), 'operon-schema-manifest-'));
	await cp(sourceRoot, root, { recursive: true });
	return root;
}

test('runtime schema manifest generation is deterministic and check is read-only', async () => {
	const root = await fixtureRoot();
	const first = await buildRuntimeSchemaManifestV1({ canonicalRoot: root });
	const second = await buildRuntimeSchemaManifestV1({ canonicalRoot: root });
	assert.equal(first, second);
	await writeRuntimeSchemaManifestV1({ canonicalRoot: root });
	const before = await readFile(path.join(root, 'schema-manifest.json'), 'utf8');
	await checkRuntimeSchemaManifestV1({ canonicalRoot: root });
	const after = await readFile(path.join(root, 'schema-manifest.json'), 'utf8');
	assert.equal(after, before);
});

test('runtime schema manifest rejects duplicate ids', async () => {
	const root = await fixtureRoot();
	const common = JSON.parse(await readFile(path.join(root, 'common.schema.json'), 'utf8'));
	await writeFile(
		path.join(root, 'duplicate.schema.json'),
		`${JSON.stringify({ ...common, title: 'Duplicate' }, null, 2)}\n`,
	);
	await assert.rejects(
		buildRuntimeSchemaManifestV1({ canonicalRoot: root }),
		/OPERON_SCHEMA_DUPLICATE_ID/u,
	);
});

test('runtime schema manifest rejects missing entrypoint fragments', async () => {
	const root = await fixtureRoot();
	const manifestPath = path.join(root, 'schema-manifest.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.entrypoints[0].ref = `${manifest.documents[0].id}#/$defs/missing`;
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	await assert.rejects(
		buildRuntimeSchemaManifestV1({ canonicalRoot: root }),
		/OPERON_SCHEMA_FRAGMENT_MISSING/u,
	);
});

test('runtime schema manifest validates its generated shape against the canonical manifest schema', async () => {
	const root = await fixtureRoot();
	const schemaPath = path.join(root, 'schema-manifest.schema.json');
	const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
	schema.required.push('futureRequiredField');
	await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
	await assert.rejects(
		buildRuntimeSchemaManifestV1({ canonicalRoot: root }),
		/OPERON_SCHEMA_MANIFEST_INVALID/u,
	);
});
