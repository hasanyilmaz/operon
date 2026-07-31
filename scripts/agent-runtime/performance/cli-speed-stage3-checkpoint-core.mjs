import { createHash } from 'node:crypto';
import path from 'node:path';

export const STAGE3_CHECKPOINT_SCHEMA_VERSION = 1;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UNIT_STATUSES = new Set(['passed', 'failed']);

export function buildStage3CheckpointIdentity({
	vaultRealpath,
	profile,
	artifactDigests,
	fixtureGeneratorDigest,
	environmentIdentity,
	sessionIdentity,
	stage2MilestoneHash,
	baselineHash,
}) {
	if (typeof vaultRealpath !== 'string' || !path.isAbsolute(vaultRealpath)) {
		throw new Error('Checkpoint vaultRealpath must be an absolute path.');
	}
	assertJsonIdentityValue(profile, 'profile');
	assertDigestMap(artifactDigests);
	assertSha256(fixtureGeneratorDigest, 'fixtureGeneratorDigest');
	assertJsonIdentityValue(environmentIdentity, 'environmentIdentity');
	assertJsonIdentityValue(sessionIdentity, 'sessionIdentity');
	assertSha256(stage2MilestoneHash, 'stage2MilestoneHash');
	assertSha256(baselineHash, 'baselineHash');

	const fields = canonicalize({
		vaultRealpath,
		profile,
		artifactDigests: {
			production: artifactDigests.production,
			probe: artifactDigests.probe,
			cli: artifactDigests.cli,
		},
		fixtureGeneratorDigest,
		environmentIdentity,
		sessionIdentity,
		stage2MilestoneHash,
		baselineHash,
	});
	return Object.freeze({
		...fields,
		digest: sha256Canonical(fields),
	});
}

export function createStage3Checkpoint({ identity, requiredUnits }) {
	const verifiedIdentity = validateIdentity(identity);
	const normalizedRequiredUnits = normalizeUniqueIds(requiredUnits, 'required unit');
	return materializeCheckpoint({
		schemaVersion: STAGE3_CHECKPOINT_SCHEMA_VERSION,
		kind: 'operon-cli-stage3-checkpoint',
		identity: verifiedIdentity,
		requiredUnits: normalizedRequiredUnits,
		revision: 0,
		units: {},
	});
}

export function createCheckpoint(identity, requiredUnits) {
	return createStage3Checkpoint({ identity, requiredUnits });
}

export function commitCheckpointUnit(checkpoint, {
	expectedRevision,
	unit,
}) {
	const current = validateStage3Checkpoint(checkpoint);
	if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
		throw new Error(
			`Checkpoint revision mismatch: expected ${expectedRevision}, observed ${current.revision}.`,
		);
	}
	const normalizedUnit = normalizeUnit(unit);
	if (Object.hasOwn(current.units, normalizedUnit.id)) {
		throw new Error(`Duplicate checkpoint unit id: ${normalizedUnit.id}`);
	}
	const existingSampleIds = collectSampleIds(Object.values(current.units));
	for (const sample of normalizedUnit.samples) {
		if (existingSampleIds.has(sample.id)) {
			throw new Error(`Duplicate checkpoint sample id: ${sample.id}`);
		}
	}
	return materializeCheckpoint({
		...current,
		revision: current.revision + 1,
		units: {
			...current.units,
			[normalizedUnit.id]: normalizedUnit,
		},
	});
}

export function recordUnit(checkpoint, unit, expectedRevision = checkpoint?.revision) {
	return commitCheckpointUnit(checkpoint, { expectedRevision, unit });
}

export function mergeStage3Checkpoints(left, right, {
	expectedLeftRevision = left?.revision,
} = {}) {
	const base = validateStage3Checkpoint(left);
	const incoming = validateStage3Checkpoint(right);
	if (expectedLeftRevision !== base.revision) {
		throw new Error(
			`Checkpoint revision mismatch: expected ${expectedLeftRevision}, observed ${base.revision}.`,
		);
	}
	if (base.identity.digest !== incoming.identity.digest) {
		throw new Error('Checkpoint identity mismatch.');
	}
	if (!sameStringArray(base.requiredUnits, incoming.requiredUnits)) {
		throw new Error('Checkpoint required-unit set mismatch.');
	}
	const mergedUnits = { ...base.units };
	const sampleIds = collectSampleIds(Object.values(base.units));
	for (const unit of Object.values(incoming.units)) {
		if (Object.hasOwn(mergedUnits, unit.id)) {
			throw new Error(`Duplicate checkpoint unit id: ${unit.id}`);
		}
		for (const sample of unit.samples) {
			if (sampleIds.has(sample.id)) {
				throw new Error(`Duplicate checkpoint sample id: ${sample.id}`);
			}
			sampleIds.add(sample.id);
		}
		mergedUnits[unit.id] = unit;
	}
	return materializeCheckpoint({
		...base,
		revision: base.revision + 1,
		units: mergedUnits,
	});
}

export function validateStage3Checkpoint(value) {
	if (!isPlainObject(value)) throw new Error('Checkpoint must be an object.');
	if (value.schemaVersion !== STAGE3_CHECKPOINT_SCHEMA_VERSION) {
		throw new Error(`Unsupported checkpoint schemaVersion: ${String(value.schemaVersion)}`);
	}
	if (value.kind !== 'operon-cli-stage3-checkpoint') {
		throw new Error('Checkpoint kind is invalid.');
	}
	const identity = validateIdentity(value.identity);
	const requiredUnits = normalizeUniqueIds(value.requiredUnits, 'required unit');
	if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
		throw new Error('Checkpoint revision must be a non-negative safe integer.');
	}
	if (!isPlainObject(value.units)) throw new Error('Checkpoint units must be an object.');
	const units = {};
	for (const [key, rawUnit] of Object.entries(value.units)) {
		const unit = normalizeUnit(rawUnit);
		if (key !== unit.id) throw new Error(`Checkpoint unit key/id mismatch: ${key}`);
		if (Object.hasOwn(units, unit.id)) throw new Error(`Duplicate checkpoint unit id: ${unit.id}`);
		units[unit.id] = unit;
	}
	assertUniqueSamples(Object.values(units));
	return materializeCheckpoint({
		schemaVersion: STAGE3_CHECKPOINT_SCHEMA_VERSION,
		kind: 'operon-cli-stage3-checkpoint',
		identity,
		requiredUnits,
		revision: value.revision,
		units,
	});
}

export function evaluateCheckpointAuthority(checkpoint) {
	const value = validateStage3Checkpoint(checkpoint);
	return value.authority;
}

export function assessCheckpoint(checkpoint, expectedIdentity) {
	const value = validateStage3Checkpoint(checkpoint);
	const identity = validateIdentity(expectedIdentity);
	if (value.identity.digest !== identity.digest) throw new Error('Checkpoint identity mismatch.');
	return {
		...value.authority,
		revision: value.revision,
		summaries: Object.fromEntries(
			Object.entries(value.units).map(([id, unit]) => [id, unit.summary]),
		),
	};
}

export function summarizeCheckpointSamples(samples) {
	if (!Array.isArray(samples)) throw new Error('Checkpoint samples must be an array.');
	const metrics = new Map();
	let successes = 0;
	for (const sample of samples.map(normalizeSample)) {
		if (sample.ok) successes += 1;
		collectFiniteMetrics(sample.metrics, '', metrics);
	}
	return {
		attempts: samples.length,
		successes,
		metrics: Object.fromEntries(
			[...metrics.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([name, values]) => [name, summarizeNumbers(values)]),
		),
	};
}

export function mergeRawSampleEvidence(...sampleGroups) {
	const merged = [];
	const ids = new Set();
	for (const group of sampleGroups) {
		if (!Array.isArray(group)) throw new Error('Raw sample evidence groups must be arrays.');
		for (const rawSample of group) {
			const sample = normalizeSample(rawSample);
			if (ids.has(sample.id)) throw new Error(`Duplicate checkpoint sample id: ${sample.id}`);
			ids.add(sample.id);
			merged.push(sample);
		}
	}
	return {
		samples: merged,
		summary: summarizeCheckpointSamples(merged),
	};
}

export function isRetryablePreHandlerShardFailure(evidence, runStatus) {
	if (runStatus === 0 || evidence?.gate?.ok === true) return false;
	const failedSides = [evidence?.baseline, evidence?.candidate].filter(side => (
		side?.collection?.production?.status === 'failed'
	));
	if (failedSides.length !== 1) return false;
	const failure = failedSides[0].failure;
	const runtime = failure?.runtimeEvidence;
	if (
		failure?.name !== 'BenchmarkCliStatusError'
		|| !['live-settling', 'transport-unavailable'].includes(runtime?.failure?.code)
		|| failure?.timing?.handlerMs !== 0
		|| runtime?.command === 'mutation.apply'
		|| typeof runtime?.planRef === 'string'
		|| runtime?.status !== null
		|| runtime?.postflightStatus !== null
		|| runtime?.groupResults !== null
	) {
		return false;
	}
	for (const side of [evidence?.baseline, evidence?.candidate]) {
		for (const sample of side?.rawSamples ?? []) {
			const apply = sample.correctness?.apply;
			if (
				apply?.mutationMayHaveApplied === true
				|| ['partial', 'outcome-unknown'].includes(apply?.status)
			) return false;
		}
	}
	return true;
}

function materializeCheckpoint(value) {
	const units = Object.fromEntries(
		Object.entries(value.units)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([id, unit]) => [id, {
				...unit,
				summary: summarizeCheckpointSamples(unit.samples),
			}]),
	);
	const missingUnits = value.requiredUnits.filter(id => !Object.hasOwn(units, id));
	const failedUnits = Object.values(units)
		.filter(unit => unit.status === 'failed')
		.map(unit => unit.id);
	const incompleteUnits = Object.values(units)
		.filter(unit => unit.status === 'passed' && unit.summary.successes !== unit.summary.attempts)
		.map(unit => unit.id);
	return {
		schemaVersion: value.schemaVersion,
		kind: value.kind,
		identity: value.identity,
		requiredUnits: [...value.requiredUnits],
		revision: value.revision,
		units,
		authority: {
			authoritative: missingUnits.length === 0
				&& failedUnits.length === 0
				&& incompleteUnits.length === 0,
			missingUnits,
			failedUnits,
			incompleteUnits,
		},
	};
}

function normalizeUnit(value) {
	if (!isPlainObject(value)) throw new Error('Checkpoint unit must be an object.');
	const id = normalizeId(value.id, 'checkpoint unit');
	if (!UNIT_STATUSES.has(value.status)) {
		throw new Error(`Checkpoint unit ${id} has invalid status.`);
	}
	if (!Array.isArray(value.samples)) {
		throw new Error(`Checkpoint unit ${id} samples must be an array.`);
	}
	const samples = value.samples.map(normalizeSample);
	const localIds = new Set();
	for (const sample of samples) {
		if (localIds.has(sample.id)) throw new Error(`Duplicate checkpoint sample id: ${sample.id}`);
		localIds.add(sample.id);
	}
	if (value.status === 'passed' && samples.length === 0) {
		throw new Error(`Passed checkpoint unit ${id} must retain at least one raw evidence sample.`);
	}
	if (value.status === 'passed') {
		const sampleWithoutEvidence = samples.find(sample => !hasRawEvidence(sample.raw));
		if (sampleWithoutEvidence) {
			throw new Error(
				`Passed checkpoint unit ${id} sample ${sampleWithoutEvidence.id} must retain raw evidence.`,
			);
		}
	}
	if (value.status === 'failed' && !hasRawFailure(value.rawFailure)) {
		throw new Error(`Failed checkpoint unit ${id} must retain rawFailure.`);
	}
	const normalized = {
		id,
		status: value.status,
		samples,
	};
	if (value.status === 'failed') normalized.rawFailure = canonicalize(value.rawFailure);
	if (typeof value.completedAt === 'string' && value.completedAt.length > 0) {
		normalized.completedAt = value.completedAt;
	}
	return normalized;
}

function normalizeSample(value) {
	if (!isPlainObject(value)) throw new Error('Checkpoint sample must be an object.');
	const id = normalizeId(value.id, 'checkpoint sample');
	if (typeof value.ok !== 'boolean') throw new Error(`Checkpoint sample ${id} must declare ok.`);
	if (!isPlainObject(value.metrics)) {
		throw new Error(`Checkpoint sample ${id} metrics must be an object.`);
	}
	const normalized = {
		id,
		ok: value.ok,
		metrics: canonicalize(value.metrics),
	};
	if (Object.hasOwn(value, 'raw')) normalized.raw = canonicalize(value.raw);
	return normalized;
}

function validateIdentity(identity) {
	if (!isPlainObject(identity)) throw new Error('Checkpoint identity must be an object.');
	const rebuilt = buildStage3CheckpointIdentity(identity);
	if (identity.digest !== rebuilt.digest) throw new Error('Checkpoint identity digest mismatch.');
	return rebuilt;
}

function assertDigestMap(value) {
	if (!isPlainObject(value)) throw new Error('artifactDigests must be an object.');
	for (const name of ['production', 'probe', 'cli']) assertSha256(value[name], `artifactDigests.${name}`);
}

function assertSha256(value, label) {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new Error(`${label} must be a lowercase SHA-256 digest.`);
	}
}

function assertJsonIdentityValue(value, label) {
	if (
		(typeof value !== 'string' || value.length === 0)
		&& (!isPlainObject(value) || Object.keys(value).length === 0)
	) {
		throw new Error(`${label} must be a non-empty string or non-empty JSON object.`);
	}
	canonicalize(value);
}

function normalizeUniqueIds(values, label) {
	if (!Array.isArray(values) || values.length === 0) {
		throw new Error(`Checkpoint ${label}s must be a non-empty array.`);
	}
	const normalized = values.map(value => normalizeId(value, label)).sort();
	for (let index = 1; index < normalized.length; index += 1) {
		if (normalized[index] === normalized[index - 1]) {
			throw new Error(`Duplicate checkpoint ${label} id: ${normalized[index]}`);
		}
	}
	return normalized;
}

function normalizeId(value, label) {
	if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
		throw new Error(`${label} id must be a non-empty trimmed string.`);
	}
	return value;
}

function assertUniqueSamples(units) {
	collectSampleIds(units);
}

function collectSampleIds(units) {
	const ids = new Set();
	for (const unit of units) {
		for (const sample of unit.samples) {
			if (ids.has(sample.id)) throw new Error(`Duplicate checkpoint sample id: ${sample.id}`);
			ids.add(sample.id);
		}
	}
	return ids;
}

function collectFiniteMetrics(value, prefix, destination) {
	for (const [key, child] of Object.entries(value)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (Number.isFinite(child)) {
			const values = destination.get(name) ?? [];
			values.push(child);
			destination.set(name, values);
		} else if (isPlainObject(child)) {
			collectFiniteMetrics(child, name, destination);
		}
	}
}

function summarizeNumbers(values) {
	const sorted = [...values].sort((left, right) => left - right);
	return {
		samples: sorted.length,
		p50: nearestRank(sorted, 0.5),
		p95: nearestRank(sorted, 0.95),
		max: sorted.length > 0 ? sorted.at(-1) : null,
	};
}

function nearestRank(sorted, fraction) {
	if (sorted.length === 0) return null;
	return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function hasRawFailure(value) {
	if (typeof value === 'string') return value.length > 0;
	return isPlainObject(value) && Object.keys(value).length > 0;
}

function hasRawEvidence(value) {
	if (typeof value === 'string') return value.length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return isPlainObject(value) && Object.keys(value).length > 0;
}

function sameStringArray(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sha256Canonical(value) {
	return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function canonicalize(value) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isPlainObject(value)) throw new Error('Checkpoint data must contain JSON-safe values only.');
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map(key => [key, canonicalize(value[key])]),
	);
}

function isPlainObject(value) {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
