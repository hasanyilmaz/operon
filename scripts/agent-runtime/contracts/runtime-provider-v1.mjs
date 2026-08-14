import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyContractDiffV1 } from './contract-evolution.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const schemaRoot = path.join(pluginRoot, 'contracts', 'agent-runtime', 'v1');
const baselinePath = path.join(pluginRoot, 'contracts', 'agent-runtime', 'public-v1-baseline.json');

const INPUT_ENTRYPOINTS_V1 = new Set([
	'catalog-request',
	'cli-invocation',
	'compatibility-offer',
	'context-request',
	'developer-api-access-request',
	'developer-mutation-apply-input',
	'developer-mutation-preview-input',
	'developer-mutation-recover-input',
	'entity-resolve-request',
	'mutation-apply-request',
	'mutation-intent',
	'mutation-plan-reference',
	'mutation-preview-request',
	'operon-cli-config',
	'relationship-request',
	'sealed-mutation-plan',
	'session-frame',
	'session-read-group',
	'task-finder-request',
	'task-get-request',
	'task-query-request',
	'timer-read-request',
]);

const RESPONSE_ENTRYPOINTS_V1 = new Set([
	'capability-advertisements',
	'capability-registry',
	'cli-client-error',
	'cli-result',
	'compatibility-selection',
	'context-pack',
	'developer-api-access-failure',
	'developer-api-channel-status',
	'developer-mutation-execution-result',
	'developer-mutation-pending-recoveries-result',
	'developer-mutation-preview-result',
	'doctor-result',
	'entity-resolution-result',
	'field-catalog',
	'manifest-result',
	'mutation-preview-result',
	'mutation-receipt',
	'mutation-result',
	'operon-catalog',
	'operon-cli-local-result',
	'plan-apply-local-result',
	'plan-discard-result',
	'plan-recover-local-result',
	'plan-show-envelope',
	'plan-show-result',
	'profile-default-result',
	'profile-list-result',
	'profile-remove-result',
	'relationship-result',
	'runtime-diagnostics',
	'runtime-health',
	'schema-get-result',
	'schema-list-result',
	'session-failure',
	'session-protocol',
	'session-result',
	'session-uncertain-result',
	'setup-result',
	'structured-error',
	'task-context',
	'task-finder-result',
	'task-get-result',
	'task-query-result',
	'task-source-locator',
	'timer-read-result',
	'version-result',
]);

/**
 * Builds the Runtime provider surface from Plugin-owned source only. It
 * intentionally does not load the published CLI binding or any CLI artifact.
 */
export async function buildRuntimeProviderV1Snapshot(options = {}) {
	const runtimeRoot = options.schemaRoot ?? schemaRoot;
	const schemaDocuments = {};
	const documentsById = new Map();
	for (const file of (await readdir(runtimeRoot)).filter(name => name.endsWith('.schema.json')).sort()) {
		const document = JSON.parse(await readFile(path.join(runtimeRoot, file), 'utf8'));
		if (typeof document?.$id !== 'string' || documentsById.has(document.$id)) {
			throw new Error(`OPERON_RUNTIME_PROVIDER_SCHEMA_ID_INVALID:${document?.$id ?? file}`);
		}
		schemaDocuments[file] = document;
		documentsById.set(document.$id, { key: file, document });
	}
	const manifest = JSON.parse(await readFile(path.join(runtimeRoot, 'schema-manifest.json'), 'utf8'));
	if (manifest.contractVersion !== 1 || !Array.isArray(manifest.entrypoints)) {
		throw new Error('OPERON_RUNTIME_PROVIDER_MANIFEST_INVALID');
	}
	return {
		baselineVersion: 1,
		runtimeContract: manifest.contractVersion,
		schemaDocuments,
		schemaDirections: buildSchemaDirectionInventoryV1(documentsById, manifest.entrypoints),
		entrypoints: manifest.entrypoints,
		capabilities: capabilityIds(schemaDocuments),
		contractPolicy: manifest.contractPolicy,
	};
}

export async function readRuntimeProviderV1Baseline(options = {}) {
	const source = JSON.parse(await readFile(options.baselinePath ?? baselinePath, 'utf8'));
	if (source?.baselineVersion !== 1 || source?.runtimeContract !== 1) {
		throw new Error('OPERON_RUNTIME_PROVIDER_BASELINE_INVALID');
	}
	const schemaDocuments = Object.fromEntries(Object.entries(source.schemaDocuments ?? {})
		.filter(([file]) => !file.startsWith('operon-cli/')));
	const cliDocumentNames = new Set(Object.keys(source.schemaDocuments ?? {})
		.filter(file => file.startsWith('operon-cli/'))
		.map(file => path.basename(file)));
	const schemaDirections = Object.fromEntries(Object.entries(source.schemaDirections ?? {})
		.filter(([file]) => Object.hasOwn(schemaDocuments, file)));
	const entrypoints = (source.entrypoints ?? []).filter(entrypoint => (
		typeof entrypoint?.file === 'string'
		&& !entrypoint.file.startsWith('operon-cli/')
		&& !cliDocumentNames.has(entrypoint.file)
	));
	if (Object.keys(schemaDocuments).length === 0 || entrypoints.length === 0) {
		throw new Error('OPERON_RUNTIME_PROVIDER_BASELINE_INVALID');
	}
	return {
		baselineVersion: 1,
		runtimeContract: source.runtimeContract,
		schemaDocuments,
		schemaDirections,
		entrypoints,
		capabilities: capabilityIds(schemaDocuments),
		contractPolicy: source.contractPolicy?.runtime,
	};
}

export async function inspectRuntimeProviderV1Baseline(options = {}) {
	const [baseline, current] = await Promise.all([
		readRuntimeProviderV1Baseline(options),
		buildRuntimeProviderV1Snapshot(options),
	]);
	return Object.freeze({
		baseline,
		current,
		changes: classifyRuntimeProviderV1SnapshotDiff(baseline, current),
	});
}

export function classifyRuntimeProviderV1SnapshotDiff(baseline, current) {
	if (!isRecord(baseline) || !isRecord(current)) {
		throw new Error('OPERON_RUNTIME_PROVIDER_SNAPSHOT_INVALID');
	}
	const changes = [];
	if (baseline.runtimeContract !== current.runtimeContract) {
		changes.push({
			kind: 'runtime-contract-changed',
			path: '/runtimeContract',
			classification: 'breaking',
			requiredMajor: 'runtime-v2',
		});
	}
	for (const [file, before] of Object.entries(baseline.schemaDocuments ?? {})) {
		const after = current.schemaDocuments?.[file];
		if (!after) {
			changes.push({
				kind: 'field-removed',
				path: `/schemaDocuments/${file}`,
				classification: 'breaking',
				requiredMajor: 'runtime-v2',
			});
			continue;
		}
		changes.push(...classifyContractDiffV1(before, after, {
			directionForPath: pointer => effectiveDirection(
				baseline.schemaDirections?.[file]?.[normalizePointer(pointer)],
			),
			surface: 'runtime',
		}));
	}
	changes.push(...classifyContractDiffV1(
		{ entrypoints: baseline.entrypoints },
		{ entrypoints: current.entrypoints },
		{ surface: 'runtime' },
	));
	changes.push(...classifyCapabilityIds(baseline.capabilities, current.capabilities));
	const addedEntrypointFiles = new Set((current.entrypoints ?? [])
		.filter(entrypoint => !(baseline.entrypoints ?? []).some(previous => previous.schemaId === entrypoint.schemaId))
		.map(entrypoint => entrypoint.file));
	for (const file of Object.keys(current.schemaDocuments ?? {})) {
		if (!Object.hasOwn(baseline.schemaDocuments ?? {}, file) && !addedEntrypointFiles.has(file)) {
			changes.push({
				kind: 'schema-document-added-without-entrypoint',
				path: `/schemaDocuments/${file}`,
				classification: 'unclassified',
				review: 'manual-contract-review-required',
			});
		}
	}
	for (const [file, pointers] of Object.entries(baseline.schemaDirections ?? {})) {
		for (const [pointer, beforeDirection] of Object.entries(pointers)) {
			if (current.schemaDirections?.[file]?.[pointer] !== beforeDirection) {
				changes.push({
					kind: 'schema-direction-changed',
					path: `/schemaDirections/${file}${pointer}`,
					classification: 'unclassified',
					review: 'manual-contract-review-required',
				});
			}
		}
	}
	if (JSON.stringify(baseline.contractPolicy) !== JSON.stringify(current.contractPolicy)) {
		changes.push({
			kind: 'contract-policy-changed',
			path: '/contractPolicy',
			classification: 'unclassified',
			review: 'manual-contract-review-required',
		});
	}
	return Object.freeze(changes);
}

export async function checkRuntimeProviderV1Baseline(options = {}) {
	const inspection = await inspectRuntimeProviderV1Baseline(options);
	const blocking = inspection.changes.filter(change => change.classification !== 'additive');
	if (blocking.length > 0) {
		throw new Error(`OPERON_RUNTIME_V2_REQUIRED:${JSON.stringify(blocking)}`);
	}
	return inspection.changes;
}

function buildSchemaDirectionInventoryV1(documentsById, entrypoints) {
	const directionSets = new Map();
	for (const entrypoint of entrypoints) {
		const direction = entrypointDirection(entrypoint?.schemaId);
		const resolved = resolveSchemaRef(entrypoint?.ref, undefined, documentsById);
		if (!resolved) throw new Error(`OPERON_RUNTIME_PROVIDER_ENTRYPOINT_REF_UNKNOWN:${entrypoint?.schemaId}`);
		walkSchema(resolved, direction, new Set());
	}
	const inventory = {};
	for (const [key, directions] of [...directionSets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const separator = key.indexOf('#');
		const file = key.slice(0, separator);
		const pointer = key.slice(separator + 1);
		inventory[file] ??= {};
		inventory[file][pointer] = directions.has('input') && directions.has('response')
			? 'mixed'
			: directions.has('input')
				? 'input'
				: 'response';
	}
	return inventory;

	function walkSchema(resolved, direction, seen) {
		const visitKey = `${resolved.key}#${resolved.pointer}|${direction}`;
		if (seen.has(visitKey)) return;
		seen.add(visitKey);
		const node = resolvePointer(resolved.document, resolved.pointer);
		if (node === undefined) throw new Error(`OPERON_RUNTIME_PROVIDER_SCHEMA_POINTER_MISSING:${visitKey}`);
		walkNode(node, resolved.key, resolved.document, resolved.pointer, direction, seen);
	}

	function walkNode(node, key, document, pointer, direction, seen) {
		if (!node || typeof node !== 'object') return;
		const normalized = normalizePointer(pointer);
		if (!Array.isArray(node) && isRecord(node.properties)) {
			const directionKey = `${key}#${normalized}`;
			const directions = directionSets.get(directionKey) ?? new Set();
			directions.add(direction);
			directionSets.set(directionKey, directions);
		}
		if (!Array.isArray(node) && typeof node.$ref === 'string') {
			const target = resolveSchemaRef(node.$ref, document.$id, documentsById);
			if (target) walkSchema(target, direction, seen);
		}
		for (const [childKey, child] of Object.entries(node)) {
			if (!child || typeof child !== 'object') continue;
			walkNode(child, key, document, appendPointer(normalized, childKey), direction, seen);
		}
	}
}

function entrypointDirection(schemaId) {
	if (INPUT_ENTRYPOINTS_V1.has(schemaId)) return 'input';
	if (RESPONSE_ENTRYPOINTS_V1.has(schemaId)) return 'response';
	throw new Error(`OPERON_RUNTIME_PROVIDER_ENTRYPOINT_DIRECTION_UNKNOWN:${schemaId ?? 'unknown'}`);
}

function resolveSchemaRef(ref, baseId, documentsById) {
	if (typeof ref !== 'string') return null;
	if (ref.startsWith('#')) {
		const current = documentsById.get(baseId);
		return current ? { ...current, pointer: normalizePointer(ref.slice(1)) } : null;
	}
	const hash = ref.indexOf('#');
	let id = hash < 0 ? ref : ref.slice(0, hash);
	if (id && !id.includes(':') && baseId?.startsWith('urn:')) {
		id = `${baseId.slice(0, baseId.lastIndexOf(':') + 1)}${id}`;
	}
	const target = documentsById.get(id);
	return target ? { ...target, pointer: normalizePointer(hash < 0 ? '' : ref.slice(hash + 1)) } : null;
}

function resolvePointer(document, pointer) {
	if (pointer === '/') return document;
	let current = document;
	for (const rawSegment of pointer.slice(1).split('/')) {
		const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
		if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

function normalizePointer(pointer) {
	return !pointer || pointer === '/' ? '/' : pointer;
}

function appendPointer(pointer, segment) {
	const escaped = segment.replaceAll('~', '~0').replaceAll('/', '~1');
	return pointer === '/' ? `/${escaped}` : `${pointer}/${escaped}`;
}

function effectiveDirection(direction) {
	if (direction === 'mixed') return 'input';
	return direction === 'input' || direction === 'response' ? direction : undefined;
}

function capabilityIds(schemaDocuments) {
	const values = schemaDocuments?.['capabilities.schema.json']?.$defs?.capabilityId?.['x-operon-knownValues'];
	if (!Array.isArray(values) || values.some(value => typeof value !== 'string') || new Set(values).size !== values.length) {
		throw new Error('OPERON_RUNTIME_PROVIDER_CAPABILITY_INVENTORY_INVALID');
	}
	return [...values].sort();
}

function classifyCapabilityIds(before, after) {
	if (!Array.isArray(before) || !Array.isArray(after)) {
		return [{
			kind: 'capability-semantics-changed',
			path: '/capabilities',
			classification: 'breaking',
			requiredMajor: 'runtime-v2',
		}];
	}
	const previous = new Set(before);
	const next = new Set(after);
	const changes = [];
	for (const capability of before) {
		if (!next.has(capability)) {
			changes.push({
				kind: 'capability-semantics-changed',
				path: `/capabilities/${capability}`,
				classification: 'breaking',
				requiredMajor: 'runtime-v2',
			});
		}
	}
	for (const capability of after) {
		if (!previous.has(capability)) {
			changes.push({
				kind: 'capability-added',
				path: `/capabilities/${capability}`,
				classification: 'additive',
				review: 'safe-default-required',
			});
		}
	}
	return changes;
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	if (!process.argv.includes('--check')) throw new Error('Usage: runtime-provider-v1.mjs --check');
	await checkRuntimeProviderV1Baseline();
}
