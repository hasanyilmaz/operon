import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyContractDiffV1 } from './contract-evolution.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../../..');
const schemaRoot = path.join(pluginRoot, 'contracts', 'agent-runtime', 'v1');
const cliSchemaRoot = path.join(pluginRoot, 'packages', 'operon-cli', 'schema-source');
const baselinePath = path.join(pluginRoot, 'contracts', 'agent-runtime', 'public-v1-baseline.json');
const cliManifestPath = path.join(pluginRoot, 'packages', 'operon-cli', 'cli-manifest-v1.json');

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

export async function buildPublicV1Snapshot(options = {}) {
	const runtimeRoot = options.schemaRoot ?? schemaRoot;
	const cliRoot = options.cliSchemaRoot ?? cliSchemaRoot;
	const manifestFile = options.cliManifestPath ?? cliManifestPath;
	const schemaDocuments = {};
	const documentsById = new Map();
	await loadSchemaRoot(runtimeRoot, '');
	await loadSchemaRoot(cliRoot, 'operon-cli/');
	const runtimeManifest = JSON.parse(
		await readFile(path.join(runtimeRoot, 'schema-manifest.json'), 'utf8'),
	);
	const cliManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
	const schemaDirections = buildSchemaDirectionInventoryV1(
		documentsById,
		cliManifest.schemaEntrypoints,
	);
	return {
		baselineVersion: 1,
		runtimeContract: 1,
		cliContract: 1,
		schemaDocuments,
		schemaDirections,
		entrypoints: cliManifest.schemaEntrypoints,
		errorRegistry: cliManifest.errorRegistry,
		capabilities: cliManifest.runtimeCapabilities,
		exitCodes: cliManifest.exitCodes,
		deprecations: cliManifest.deprecations,
		contractPolicy: {
			runtime: runtimeManifest.contractPolicy,
			cli: cliManifest.contractPolicy,
		},
	};

	async function loadSchemaRoot(root, keyPrefix) {
		for (const file of (await readdir(root)).filter(name => name.endsWith('.schema.json')).sort()) {
			const document = JSON.parse(await readFile(path.join(root, file), 'utf8'));
			const key = `${keyPrefix}${file}`;
			schemaDocuments[key] = document;
			if (typeof document.$id !== 'string' || documentsById.has(document.$id)) {
				throw new Error(`OPERON_PUBLIC_V1_SCHEMA_ID_INVALID:${document.$id ?? key}`);
			}
			documentsById.set(document.$id, { key, document });
		}
	}
}

export function classifyPublicV1SnapshotDiffV1(baseline, current) {
	const changes = [];
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
		}));
	}
	changes.push(...classifyContractDiffV1({
		entrypoints: baseline.entrypoints,
		errorRegistry: baseline.errorRegistry,
		capabilities: baseline.capabilities,
		exitCodes: baseline.exitCodes,
		deprecations: baseline.deprecations,
	}, {
		entrypoints: current.entrypoints,
		errorRegistry: current.errorRegistry,
		capabilities: current.capabilities,
		exitCodes: current.exitCodes,
		deprecations: current.deprecations,
	}, { surface: 'cli' }));
	for (const [file, pointers] of Object.entries(baseline.schemaDirections ?? {})) {
		for (const [pointer, beforeDirection] of Object.entries(pointers)) {
			const afterDirection = current.schemaDirections?.[file]?.[pointer];
			if (
				afterDirection === undefined
				|| beforeDirection !== afterDirection
			) {
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
	return changes;
}

export async function checkPublicV1Baseline(options = {}) {
	const target = options.baselinePath ?? baselinePath;
	const baseline = JSON.parse(await readFile(target, 'utf8'));
	const current = await buildPublicV1Snapshot(options);
	const changes = classifyPublicV1SnapshotDiffV1(baseline, current);
	const blocking = changes.filter(change => change.classification !== 'additive');
	if (blocking.length > 0) {
		throw new Error(`OPERON_PUBLIC_V1_BREAKING_CHANGE:${JSON.stringify(blocking)}`);
	}
	return changes;
}

export async function writePublicV1Baseline(options = {}) {
	const target = options.baselinePath ?? baselinePath;
	const output = `${JSON.stringify(await buildPublicV1Snapshot(options), null, 2)}\n`;
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(temporary, output, { encoding: 'utf8', mode: 0o600 });
	await rename(temporary, target);
	return output;
}

function buildSchemaDirectionInventoryV1(documentsById, entrypoints) {
	const directionSets = new Map();
	for (const entrypoint of entrypoints ?? []) {
		const direction = entrypointDirection(entrypoint?.schemaId);
		const resolved = resolveSchemaRef(entrypoint?.ref, undefined, documentsById);
		if (!resolved) throw new Error(`OPERON_PUBLIC_V1_ENTRYPOINT_REF_UNKNOWN:${entrypoint?.schemaId}`);
		walkSchema(resolved, direction, new Set());
	}
	const inventory = {};
	for (const [key, directions] of [...directionSets.entries()].sort(([left], [right]) => (
		left.localeCompare(right)
	))) {
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
		if (node === undefined) {
			throw new Error(`OPERON_PUBLIC_V1_SCHEMA_POINTER_MISSING:${visitKey}`);
		}
		walkNode(node, resolved.key, resolved.document, resolved.pointer, direction, seen);
	}

	function walkNode(node, key, document, pointer, direction, seen) {
		if (!node || typeof node !== 'object') return;
		const normalized = normalizePointer(pointer);
		if (
			!Array.isArray(node)
			&& node.properties
			&& typeof node.properties === 'object'
			&& !Array.isArray(node.properties)
		) {
			const directionKey = `${key}#${normalized}`;
			const directions = directionSets.get(directionKey) ?? new Set();
			directions.add(direction);
			directionSets.set(directionKey, directions);
		}
		if (!Array.isArray(node) && typeof node.$ref === 'string') {
			const currentId = document.$id;
			const target = resolveSchemaRef(node.$ref, currentId, documentsById);
			if (target) walkSchema(target, direction, seen);
		}
		for (const [childKey, child] of Object.entries(node)) {
			if (!child || typeof child !== 'object') continue;
			walkNode(
				child,
				key,
				document,
				appendPointer(normalized, childKey),
				direction,
				seen,
			);
		}
	}
}

function entrypointDirection(schemaId) {
	if (INPUT_ENTRYPOINTS_V1.has(schemaId)) return 'input';
	if (RESPONSE_ENTRYPOINTS_V1.has(schemaId)) return 'response';
	throw new Error(`OPERON_PUBLIC_V1_ENTRYPOINT_DIRECTION_UNKNOWN:${schemaId ?? 'unknown'}`);
}

function resolveSchemaRef(ref, baseId, documentsById) {
	if (typeof ref !== 'string') return null;
	if (ref.startsWith('#')) {
		const current = documentsById.get(baseId);
		return current
			? { ...current, pointer: normalizePointer(ref.slice(1)) }
			: null;
	}
	const hash = ref.indexOf('#');
	let id = hash < 0 ? ref : ref.slice(0, hash);
	if (id && !id.includes(':') && baseId?.startsWith('urn:')) {
		id = `${baseId.slice(0, baseId.lastIndexOf(':') + 1)}${id}`;
	}
	const target = documentsById.get(id);
	return target
		? { ...target, pointer: normalizePointer(hash < 0 ? '' : ref.slice(hash + 1)) }
		: null;
}

function resolvePointer(document, pointer) {
	if (pointer === '/') return document;
	let current = document;
	for (const rawSegment of pointer.slice(1).split('/')) {
		const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
		if (
			!current
			|| typeof current !== 'object'
			|| !Object.prototype.hasOwnProperty.call(current, segment)
		) return undefined;
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
	if (direction === 'input' || direction === 'response') return direction;
	return undefined;
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	if (process.argv.includes('--write')) await writePublicV1Baseline();
	else if (process.argv.includes('--check')) await checkPublicV1Baseline();
	else throw new Error('Usage: check-public-v1-baseline.mjs --write|--check');
}
