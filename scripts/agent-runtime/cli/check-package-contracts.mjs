import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import {
	buildCliManifestDocumentV1,
	CLI_SCHEMA_ENTRYPOINTS_V1,
	contractProjectionV1,
} from '../../../packages/operon-cli/contract-manifest.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageRoot = path.join(pluginRoot, 'packages', 'operon-cli');
const targetRoot = path.join(packageRoot, 'schemas', 'v1');
const sourceRoots = [
	path.join(pluginRoot, 'contracts', 'agent-runtime', 'v1'),
	path.join(packageRoot, 'schema-source'),
];

const expectedFiles = new Map();
for (const sourceRoot of sourceRoots) {
	for (const file of await readdir(sourceRoot)) {
		if (!file.endsWith('.json')) continue;
		assert.ok(!expectedFiles.has(file), `Schema filename collision: ${file}`);
		expectedFiles.set(file, await readFile(path.join(sourceRoot, file)));
	}
}
const actualFiles = (await readdir(targetRoot)).filter(file => file.endsWith('.json')).sort();
assert.deepEqual(actualFiles, [...expectedFiles.keys()].sort(), 'CLI schema copy inventory is stale.');
for (const [file, expected] of expectedFiles) {
	assert.deepEqual(
		await readFile(path.join(targetRoot, file)),
		expected,
		`CLI schema copy is stale: ${file}`,
	);
}

const manifest = JSON.parse(await readFile(path.join(packageRoot, 'cli-manifest-v1.json'), 'utf8'));
assert.deepEqual(
	manifest.schemas.map(item => item.file).sort(),
	actualFiles,
	'CLI manifest schema inventory is stale.',
);
const documentsById = new Map();
const expectedSchemas = [];
for (const item of manifest.schemas) {
	const bytes = await readFile(path.join(targetRoot, item.file));
	assert.equal(digest(bytes), item.sha256, `CLI manifest digest is stale: ${item.file}`);
	const document = JSON.parse(bytes.toString('utf8'));
	expectedSchemas.push({
		file: item.file,
		...(typeof document.$id === 'string' ? { id: document.$id } : {}),
		sha256: digest(bytes),
	});
	if (typeof document.$id === 'string') {
		assert.equal(document.$id, item.id, `CLI manifest schema id is stale: ${item.file}`);
		assert.ok(!documentsById.has(document.$id), `Duplicate CLI schema id: ${document.$id}`);
		documentsById.set(document.$id, { file: item.file, sha256: item.sha256, document });
	}
}
for (const entrypoint of manifest.schemaEntrypoints) {
	const [id, fragment = ''] = entrypoint.ref.split('#', 2);
	const document = documentsById.get(id);
	assert.ok(document, `Unknown CLI schema entrypoint document: ${entrypoint.schemaId}`);
	assert.equal(document.file, entrypoint.file, `CLI entrypoint file is stale: ${entrypoint.schemaId}`);
	assert.equal(document.sha256, entrypoint.sha256, `CLI entrypoint digest is stale: ${entrypoint.schemaId}`);
	assert.notEqual(resolvePointer(document.document, fragment), undefined, `Missing CLI entrypoint: ${entrypoint.schemaId}`);
}
const runtimeManifest = JSON.parse(
	await readFile(path.join(targetRoot, 'schema-manifest.json'), 'utf8'),
);
const expectedEntrypoints = [
	...runtimeManifest.entrypoints,
	...CLI_SCHEMA_ENTRYPOINTS_V1,
].map(entrypoint => {
	const [id, fragment = ''] = entrypoint.ref.split('#', 2);
	const document = documentsById.get(id);
	assert.ok(document, `Unknown expected CLI schema document: ${entrypoint.schemaId}`);
	assert.notEqual(
		resolvePointer(document.document, fragment),
		undefined,
		`Missing expected CLI schema entrypoint: ${entrypoint.schemaId}`,
	);
	return {
		schemaId: entrypoint.schemaId,
		ref: entrypoint.ref,
		file: document.file,
		sha256: document.sha256,
		stability: entrypoint.stability ?? 'stable',
		...(entrypoint.deprecation ? { deprecation: entrypoint.deprecation } : {}),
	};
}).sort((left, right) => left.schemaId.localeCompare(right.schemaId));
const manifestBase = await loadManifestBase();
const expectedManifest = buildCliManifestDocumentV1(
	manifestBase,
	expectedSchemas.sort((left, right) => left.file.localeCompare(right.file)),
	expectedEntrypoints,
);
assert.equal(
	await readFile(path.join(packageRoot, 'cli-manifest-v1.json'), 'utf8'),
	`${JSON.stringify(expectedManifest, null, 2)}\n`,
	'Generated CLI manifest is stale against its source registry.',
);
assert.equal(
	manifest.contractDigest,
	digest(Buffer.from(JSON.stringify(contractProjectionV1(manifest)), 'utf8')),
	'CLI aggregate contract digest is stale.',
);

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

function digest(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function loadManifestBase() {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'operon-cli-manifest-check-'));
	const outfile = path.join(temporaryRoot, 'manifest-data.cjs');
	try {
		await build({
			entryPoints: [path.join(packageRoot, 'src', 'manifest-data.ts')],
			outfile,
			bundle: true,
			platform: 'node',
			format: 'cjs',
			target: 'node22',
			minify: true,
		});
		const module = createRequire(import.meta.url)(outfile);
		const packageDocument = JSON.parse(
			await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
		);
		return module.createCliManifestBaseV1(packageDocument.version);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}
