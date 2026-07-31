import { createHash } from 'node:crypto';
import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const canonicalRoot = path.join(pluginRoot, 'contracts', 'agent-runtime', 'v1');
const manifestPath = path.join(canonicalRoot, 'schema-manifest.json');
const MANIFEST_SCHEMA_ID = 'urn:operon:schema:runtime:v1:schema-manifest.schema.json';

export async function buildRuntimeSchemaManifestV1(options = {}) {
	const root = options.canonicalRoot ?? canonicalRoot;
	const existingPath = options.manifestPath ?? path.join(root, 'schema-manifest.json');
	const existing = JSON.parse(await readFile(existingPath, 'utf8'));
	const schemaFiles = (await readdir(root))
		.filter(file => file.endsWith('.schema.json'))
		.sort();
	const documents = [];
	const byId = new Map();
	const byFile = new Map();
	for (const file of schemaFiles) {
		if (byFile.has(file)) throw new Error(`OPERON_SCHEMA_DUPLICATE_FILENAME:${file}`);
		const bytes = await readFile(path.join(root, file));
		const document = JSON.parse(bytes.toString('utf8'));
		if (
			document?.$schema !== 'https://json-schema.org/draft/2020-12/schema'
			|| typeof document?.$id !== 'string'
			|| !document.$id.startsWith('urn:operon:schema:runtime:v1:')
		) throw new Error(`OPERON_SCHEMA_DOCUMENT_INVALID:${file}`);
		if (byId.has(document.$id)) throw new Error(`OPERON_SCHEMA_DUPLICATE_ID:${document.$id}`);
		const item = {
			file,
			id: document.$id,
			sha256: sha256(bytes),
		};
		byId.set(document.$id, { ...item, document });
		byFile.set(file, item);
		documents.push(item);
	}
	for (const { document, file } of byId.values()) {
		walkRefs(document, ref => assertResolvableRef(ref, document.$id, file, byId));
	}
	const rawEntrypoints = Array.isArray(existing.entrypoints) ? existing.entrypoints : [];
	const seenSchemaIds = new Set();
	const entrypoints = rawEntrypoints.map(entrypoint => {
		if (
			typeof entrypoint?.schemaId !== 'string'
			|| typeof entrypoint?.ref !== 'string'
			|| seenSchemaIds.has(entrypoint.schemaId)
		) throw new Error(`OPERON_SCHEMA_ENTRYPOINT_INVALID:${entrypoint?.schemaId ?? 'unknown'}`);
		seenSchemaIds.add(entrypoint.schemaId);
		const resolved = resolveRef(entrypoint.ref, null, byId);
		if (!resolved) throw new Error(`OPERON_SCHEMA_ENTRYPOINT_REF_UNKNOWN:${entrypoint.schemaId}`);
		assertJsonPointer(resolved.document, resolved.fragment, entrypoint.ref);
		return {
			schemaId: entrypoint.schemaId,
			ref: entrypoint.ref,
			file: resolved.file,
			sha256: resolved.sha256,
			stability: 'stable',
			...(entrypoint.deprecation ? { deprecation: entrypoint.deprecation } : {}),
		};
	}).sort((left, right) => left.schemaId.localeCompare(right.schemaId));
	const contractPolicy = {
		inputs: 'strict',
		outputs: 'additive',
		deprecationRemoval: 'runtime-v2',
	};
	const aggregateSha256 = sha256(Buffer.from(
		JSON.stringify({
			contractPolicy,
			documents: documents.map(({ file, id, sha256: digest }) => ({
				file,
				id,
				sha256: digest,
			})),
			entrypoints,
		}),
		'utf8',
	));
	const manifest = {
		$schema: MANIFEST_SCHEMA_ID,
		manifestVersion: 1,
		contractVersion: 1,
		contractPolicy,
		documents,
		entrypoints,
		aggregateSha256,
	};
	const manifestSchema = byId.get(MANIFEST_SCHEMA_ID)?.document;
	if (!manifestSchema) throw new Error('OPERON_SCHEMA_MANIFEST_SCHEMA_MISSING');
	const ajv = new Ajv2020({ strict: true, strictRequired: false, strictTypes: false });
	const validateManifest = ajv.compile(manifestSchema);
	if (!validateManifest(manifest)) {
		throw new Error(`OPERON_SCHEMA_MANIFEST_INVALID:${JSON.stringify(validateManifest.errors)}`);
	}
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function checkRuntimeSchemaManifestV1(options = {}) {
	const target = options.manifestPath ?? manifestPath;
	const expected = await buildRuntimeSchemaManifestV1(options);
	const actual = await readFile(target, 'utf8');
	if (actual !== expected) throw new Error('OPERON_SCHEMA_MANIFEST_STALE');
	return true;
}

export async function writeRuntimeSchemaManifestV1(options = {}) {
	const target = options.manifestPath ?? manifestPath;
	const output = await buildRuntimeSchemaManifestV1(options);
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(temporary, output, { encoding: 'utf8', mode: 0o600 });
	await rename(temporary, target);
	return output;
}

function walkRefs(value, visit) {
	if (Array.isArray(value)) {
		for (const item of value) walkRefs(item, visit);
		return;
	}
	if (!value || typeof value !== 'object') return;
	if (typeof value.$ref === 'string') visit(value.$ref);
	for (const child of Object.values(value)) walkRefs(child, visit);
}

function assertResolvableRef(ref, baseId, file, byId) {
	if (ref.startsWith('#')) {
		const current = byId.get(baseId);
		assertJsonPointer(current.document, ref.slice(1), `${file}:${ref}`);
		return;
	}
	if (ref === 'https://json-schema.org/draft/2020-12/schema') return;
	const resolved = resolveRef(ref, baseId, byId);
	if (!resolved) throw new Error(`OPERON_SCHEMA_REF_UNKNOWN:${file}:${ref}`);
	assertJsonPointer(resolved.document, resolved.fragment, `${file}:${ref}`);
}

function resolveRef(ref, baseId, byId) {
	if (ref.startsWith('#')) {
		const current = byId.get(baseId);
		return current ? { ...current, fragment: ref.slice(1) } : null;
	}
	const hash = ref.indexOf('#');
	let id = hash < 0 ? ref : ref.slice(0, hash);
	if (id && !id.includes(':') && baseId?.startsWith('urn:')) {
		id = `${baseId.slice(0, baseId.lastIndexOf(':') + 1)}${id}`;
	}
	const target = byId.get(id);
	return target ? { ...target, fragment: hash < 0 ? '' : ref.slice(hash + 1) } : null;
}

function assertJsonPointer(document, fragment, label) {
	if (!fragment) return;
	if (!fragment.startsWith('/')) throw new Error(`OPERON_SCHEMA_FRAGMENT_INVALID:${label}`);
	let current = document;
	for (const rawSegment of fragment.slice(1).split('/')) {
		const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
		if (
			!current
			|| typeof current !== 'object'
			|| !Object.prototype.hasOwnProperty.call(current, segment)
		) throw new Error(`OPERON_SCHEMA_FRAGMENT_MISSING:${label}`);
		current = current[segment];
	}
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	const mode = process.argv[2];
	if (mode === '--write') await writeRuntimeSchemaManifestV1();
	else if (mode === '--check') await checkRuntimeSchemaManifestV1();
	else throw new Error('OPERON_SCHEMA_GENERATOR_USAGE: expected --write or --check');
}
