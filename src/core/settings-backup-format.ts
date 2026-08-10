import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import type { JsonValue } from '../agent-runtime/contracts/v1/primitives';
import {
	SETTINGS_BACKUP_GROUPS,
	type SettingsBackupProfileGroupId,
} from './settings-backup-compatibility';

export const OPERON_SETTINGS_BACKUP_FORMAT = 'operon-settings-backup' as const;
export const OPERON_SETTINGS_BACKUP_FORMAT_VERSION = 1 as const;
export const OPERON_SETTINGS_BACKUP_CANONICALIZATION = 'operon-backup-canonical-json-v1' as const;
export const OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES = 10 * 1024 * 1024;
export const OPERON_SETTINGS_BACKUP_MAX_CANONICAL_DEPTH = 64;
export const OPERON_SETTINGS_BACKUP_MAX_COLLECTION_ENTRIES = 100_000;

export const OPERON_SETTINGS_BACKUP_GROUP_NAMES: readonly SettingsBackupProfileGroupId[] = Object.freeze(
	SETTINGS_BACKUP_GROUPS.map(group => group.id),
);

export type OperonSettingsBackupGroupNameV1 = SettingsBackupProfileGroupId;

export const OPERON_SETTINGS_BACKUP_FOUNDATIONAL_GROUP_NAMES = [
	'general',
	'pipelines',
	'priorities',
	'system-key-mappings',
	'custom-keys',
] as const satisfies readonly SettingsBackupProfileGroupId[];

export type OperonSettingsBackupFoundationalGroupNameV1 =
	typeof OPERON_SETTINGS_BACKUP_FOUNDATIONAL_GROUP_NAMES[number];

export interface OperonSettingsBackupSourceV1 {
	pluginVersion: string;
	obsidianVersion: string;
	dataPackageSchemaVersion: number;
	settingsVersion: number;
}

export interface OperonSettingsBackupScopeV1 {
	configuration: 'portable';
	tableFiles: 'excluded' | 'included';
	externalCalendarUrls: 'excluded' | 'included';
	developerApiGrants: 'excluded';
	mobileIdentity: 'excluded';
	operationalState: 'excluded';
	runtime: 'excluded';
	cache: 'excluded';
}

export interface OperonSettingsBackupVersionedGroupV1 {
	codecVersion: number;
	data: JsonValue;
}

export type OperonSettingsBackupGroupsV1 =
	Partial<Record<OperonSettingsBackupGroupNameV1, OperonSettingsBackupVersionedGroupV1>>
	& Record<OperonSettingsBackupFoundationalGroupNameV1, OperonSettingsBackupVersionedGroupV1>;

export interface OperonSettingsBackupTableInventoryItemV1 {
	id: string;
	originalPath: string;
	sha256: string | null;
}

export interface OperonSettingsBackupTableInventoryV1 {
	mode: 'excluded' | 'included';
	items: OperonSettingsBackupTableInventoryItemV1[];
}

export interface OperonSettingsBackupBodyV1 {
	createdAt: string;
	source: OperonSettingsBackupSourceV1;
	scope: OperonSettingsBackupScopeV1;
	groups: OperonSettingsBackupGroupsV1;
	tableInventory?: OperonSettingsBackupTableInventoryV1;
}

export interface OperonSettingsBackupIntegrityV1 {
	algorithm: 'sha256';
	canonicalization: typeof OPERON_SETTINGS_BACKUP_CANONICALIZATION;
	value: string;
}

export interface OperonSettingsBackupV1 {
	format: typeof OPERON_SETTINGS_BACKUP_FORMAT;
	formatVersion: typeof OPERON_SETTINGS_BACKUP_FORMAT_VERSION;
	body: OperonSettingsBackupBodyV1;
	integrity: OperonSettingsBackupIntegrityV1;
}

export type OperonSettingsBackupDiagnosticCode =
	| 'invalid-json'
	| 'type'
	| 'required'
	| 'unknown-field'
	| 'prototype'
	| 'value'
	| 'unsupported-version'
	| 'integrity-failed'
	| 'migration-required'
	| 'partial-compatibility';

export interface OperonSettingsBackupDiagnostic {
	path: string;
	code: OperonSettingsBackupDiagnosticCode;
	severity: 'error' | 'warning';
	message: string;
}

export type OperonSettingsBackupParseClassification =
	| 'valid'
	| 'invalid'
	| 'unsupported'
	| 'integrity-failed';

export type OperonSettingsBackupParseResult =
	| {
		ok: true;
		classification: 'valid';
		value: OperonSettingsBackupV1;
		diagnostics: [];
	}
	| {
		ok: false;
		classification: Exclude<OperonSettingsBackupParseClassification, 'valid'>;
		value: null;
		diagnostics: OperonSettingsBackupDiagnostic[];
	};

export type OperonSettingsBackupCompatibilityClassification =
	| 'exact'
	| 'migration-required'
	| 'partial'
	| 'blocked';

export interface OperonSettingsBackupCompatibilitySupport {
	dataPackageSchemaVersions: readonly number[];
	/** Source settingsVersion is provenance; every profile group still uses its declared canonical codec. */
	currentSettingsVersion: number;
	minimumSettingsVersion: number;
	groupCodecVersions: Readonly<Record<OperonSettingsBackupGroupNameV1, number>>;
	groupMigrationSourceCodecVersions?: Partial<Record<OperonSettingsBackupGroupNameV1, readonly number[]>>;
}

export interface OperonSettingsBackupGroupCompatibility {
	group: OperonSettingsBackupGroupNameV1;
	classification: 'exact' | 'not-included' | 'migration-required' | 'unsupported';
	sourceCodecVersion: number | null;
	supportedCodecVersion: number;
}

export interface OperonSettingsBackupCompatibilityResult {
	classification: OperonSettingsBackupCompatibilityClassification;
	groups: OperonSettingsBackupGroupCompatibility[];
	diagnostics: OperonSettingsBackupDiagnostic[];
}

export class OperonSettingsBackupCanonicalJsonError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OperonSettingsBackupCanonicalJsonError';
	}
}

export function canonicalizeOperonSettingsBackupJson(value: unknown): string {
	return serializeCanonicalJson(value, '$', 0, {
		stack: new Set<object>(),
		collectionEntries: 0,
	});
}

export function computeOperonSettingsBackupBodyChecksum(body: OperonSettingsBackupBodyV1): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(body));
}

export function buildOperonSettingsBackupV1(body: OperonSettingsBackupBodyV1): OperonSettingsBackupV1 {
	// Validate JSON safety before returning a typed envelope to an exporter.
	canonicalizeOperonSettingsBackupJson(body);
	return {
		format: OPERON_SETTINGS_BACKUP_FORMAT,
		formatVersion: OPERON_SETTINGS_BACKUP_FORMAT_VERSION,
		body,
		integrity: {
			algorithm: 'sha256',
			canonicalization: OPERON_SETTINGS_BACKUP_CANONICALIZATION,
			value: computeOperonSettingsBackupBodyChecksum(body),
		},
	};
}

export function serializeOperonSettingsBackupV1(backup: OperonSettingsBackupV1): string {
	const parsed = parseOperonSettingsBackupV1(JSON.stringify(backup));
	if (!parsed.ok) {
		throw new OperonSettingsBackupCanonicalJsonError(
			`Cannot serialize invalid settings backup: ${parsed.diagnostics.map(item => item.message).join('; ')}`,
		);
	}
	return `${JSON.stringify(sortJsonForDisplay(parsed.value), null, 2)}\n`;
}

export function parseOperonSettingsBackupV1(source: string): OperonSettingsBackupParseResult {
	if (new TextEncoder().encode(source).byteLength > OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES) {
		return parseFailure('invalid', [diagnostic(
			'$',
			'value',
			`Backup exceeds the ${OPERON_SETTINGS_BACKUP_MAX_SOURCE_UTF8_BYTES} byte source limit.`,
		)]);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(source) as unknown;
	} catch (error) {
		return parseFailure('invalid', [diagnostic(
			'$',
			'invalid-json',
			`Backup is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		)]);
	}

	const diagnostics: OperonSettingsBackupDiagnostic[] = [];
	const root = inspectObject(raw, '$', ['format', 'formatVersion', 'body', 'integrity'], diagnostics);
	if (!root) return parseFailure('invalid', diagnostics);

	if (root.format !== OPERON_SETTINGS_BACKUP_FORMAT) {
		diagnostics.push(diagnostic('$.format', 'value', `Expected ${OPERON_SETTINGS_BACKUP_FORMAT}.`));
	}
	if (!isNonNegativeInteger(root.formatVersion)) {
		diagnostics.push(diagnostic('$.formatVersion', 'type', 'formatVersion must be a non-negative integer.'));
	} else if (root.formatVersion !== OPERON_SETTINGS_BACKUP_FORMAT_VERSION) {
		diagnostics.push(diagnostic(
			'$.formatVersion',
			'unsupported-version',
			`Unsupported settings backup format version: ${root.formatVersion}.`,
		));
	}

	const body = parseBody(root.body, diagnostics);
	const integrity = parseIntegrity(root.integrity, diagnostics);
	if (diagnostics.some(item => item.code === 'unsupported-version')) {
		return parseFailure('unsupported', diagnostics);
	}
	if (!body || !integrity || diagnostics.length > 0) return parseFailure('invalid', diagnostics);

	let checksum: string;
	try {
		checksum = computeOperonSettingsBackupBodyChecksum(body);
	} catch (error) {
		return parseFailure('invalid', [
			...diagnostics,
			diagnostic('$', 'value', error instanceof Error ? error.message : String(error)),
		]);
	}
	if (checksum !== integrity.value) {
		return parseFailure('integrity-failed', [diagnostic(
			'$.integrity.value',
			'integrity-failed',
			'Backup body checksum does not match the declared integrity value.',
		)]);
	}

	return {
		ok: true,
		classification: 'valid',
		value: {
			format: OPERON_SETTINGS_BACKUP_FORMAT,
			formatVersion: OPERON_SETTINGS_BACKUP_FORMAT_VERSION,
			body,
			integrity,
		},
		diagnostics: [],
	};
}

export function classifyOperonSettingsBackupV1(
	backup: OperonSettingsBackupV1,
	support: OperonSettingsBackupCompatibilitySupport,
): OperonSettingsBackupCompatibilityResult {
	const diagnostics: OperonSettingsBackupDiagnostic[] = [];
	let blocked = false;
	let migrationRequired = false;
	let partial = false;

	const schemaVersions = [...new Set(support.dataPackageSchemaVersions)]
		.filter(isNonNegativeInteger)
		.sort((left, right) => left - right);
	if (!schemaVersions.includes(backup.body.source.dataPackageSchemaVersion)) {
		blocked = true;
		diagnostics.push(diagnostic(
			'$.body.source.dataPackageSchemaVersion',
			'unsupported-version',
			`Unsupported data package schema version: ${backup.body.source.dataPackageSchemaVersion}.`,
		));
	} else if (backup.body.source.dataPackageSchemaVersion !== schemaVersions[schemaVersions.length - 1]) {
		migrationRequired = true;
		diagnostics.push(warning(
			'$.body.source.dataPackageSchemaVersion',
			'migration-required',
			`Data package schema version ${backup.body.source.dataPackageSchemaVersion} requires migration.`,
		));
	}

	const sourceSettingsVersion = backup.body.source.settingsVersion;
	if (
		sourceSettingsVersion > support.currentSettingsVersion
		|| sourceSettingsVersion < support.minimumSettingsVersion
	) {
		blocked = true;
		diagnostics.push(diagnostic(
			'$.body.source.settingsVersion',
			'unsupported-version',
			`Unsupported settings version: ${sourceSettingsVersion}.`,
		));
	} else if (sourceSettingsVersion < support.currentSettingsVersion) {
		migrationRequired = true;
		diagnostics.push(warning(
			'$.body.source.settingsVersion',
			'migration-required',
			`Settings version ${sourceSettingsVersion} requires migration.`,
		));
	}

	const groups = OPERON_SETTINGS_BACKUP_GROUP_NAMES.map(group => {
		const supportedCodecVersion = support.groupCodecVersions[group];
		const sourceGroup = backup.body.groups[group];
		if (!sourceGroup) {
			if (group === 'external-calendars' && backup.body.scope.externalCalendarUrls === 'excluded') {
				return {
					group,
					classification: 'not-included' as const,
					sourceCodecVersion: null,
					supportedCodecVersion,
				};
			}
			migrationRequired = true;
			diagnostics.push(warning(
				`$.body.groups.${group}`,
				'migration-required',
				`Missing optional ${group} group requires migration or target fallback.`,
			));
			return {
				group,
				classification: 'migration-required' as const,
				sourceCodecVersion: null,
				supportedCodecVersion,
			};
		}
		const sourceCodecVersion = sourceGroup.codecVersion;
		let classification: OperonSettingsBackupGroupCompatibility['classification'] = 'exact';
		if (sourceCodecVersion < supportedCodecVersion) {
			const migrationSources = support.groupMigrationSourceCodecVersions?.[group] ?? [];
			if (migrationSources.includes(sourceCodecVersion)) {
				classification = 'migration-required';
				migrationRequired = true;
				diagnostics.push(warning(
					`$.body.groups.${group}.codecVersion`,
					'migration-required',
					`${group} group codec version ${sourceCodecVersion} requires migration.`,
				));
			} else {
				classification = 'unsupported';
				if (isFoundationalGroup(group)) blocked = true;
				else partial = true;
				diagnostics.push((isFoundationalGroup(group) ? diagnostic : warning)(
					`$.body.groups.${group}.codecVersion`,
					'unsupported-version',
					`No migration is registered for ${group} group codec version ${sourceCodecVersion}.`,
				));
			}
		} else if (sourceCodecVersion > supportedCodecVersion) {
			classification = 'unsupported';
			if (isFoundationalGroup(group)) {
				blocked = true;
				diagnostics.push(diagnostic(
					`$.body.groups.${group}.codecVersion`,
					'unsupported-version',
					`Unsupported foundational ${group} group codec version: ${sourceCodecVersion}.`,
				));
			} else {
				partial = true;
				diagnostics.push(warning(
					`$.body.groups.${group}.codecVersion`,
					'partial-compatibility',
					`Unsupported optional ${group} group codec version ${sourceCodecVersion} must be skipped.`,
				));
			}
		}
		return { group, classification, sourceCodecVersion, supportedCodecVersion };
	});

	return {
		classification: blocked
			? 'blocked'
			: partial
				? 'partial'
				: migrationRequired
					? 'migration-required'
					: 'exact',
		groups,
		diagnostics,
	};
}

function parseBody(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupBodyV1 | null {
	const object = inspectObject(
		raw,
		'$.body',
		['createdAt', 'source', 'scope', 'groups', 'tableInventory'],
		diagnostics,
		['tableInventory'],
	);
	if (!object) return null;
	const createdAt = readString(object, 'createdAt', '$.body', diagnostics);
	if (createdAt && !isIsoDateTime(createdAt)) {
		diagnostics.push(diagnostic('$.body.createdAt', 'value', 'createdAt must be a valid ISO date-time.'));
	}
	const source = parseSource(object.source, diagnostics);
	const scope = parseScope(object.scope, diagnostics);
	const groups = parseGroups(object.groups, diagnostics);
	const tableInventory = object.tableInventory === undefined
		? undefined
		: parseTableInventory(object.tableInventory, diagnostics);
	if (!createdAt || !source || !scope || !groups || (object.tableInventory !== undefined && !tableInventory)) return null;
	validateScopeCoherence(scope, groups, tableInventory ?? undefined, diagnostics);
	return { createdAt, source, scope, groups, ...(tableInventory ? { tableInventory } : {}) };
}

function validateScopeCoherence(
	scope: OperonSettingsBackupScopeV1,
	groups: OperonSettingsBackupGroupsV1,
	tableInventory: OperonSettingsBackupTableInventoryV1 | undefined,
	diagnostics: OperonSettingsBackupDiagnostic[],
): void {
	const externalCalendars = groups['external-calendars'];
	if (scope.externalCalendarUrls === 'included' && !externalCalendars) {
		diagnostics.push(diagnostic('$.body.groups.external-calendars', 'required', 'External Calendar URLs are included but the sensitive group is missing.'));
	}
	if (scope.externalCalendarUrls === 'excluded' && externalCalendars) {
		diagnostics.push(diagnostic('$.body.groups.external-calendars', 'value', 'External Calendar URLs are excluded but the sensitive group is present.'));
	}
	if (scope.tableFiles === 'included' && tableInventory?.mode !== 'included') {
		diagnostics.push(diagnostic('$.body.tableInventory', 'required', 'Included Table files require an included Table inventory.'));
	}
	if (scope.tableFiles === 'excluded' && tableInventory?.mode === 'included') {
		diagnostics.push(diagnostic('$.body.tableInventory.mode', 'value', 'Table inventory cannot be included when Table files are excluded.'));
	}
}

function parseSource(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupSourceV1 | null {
	const object = inspectObject(
		raw,
		'$.body.source',
		['pluginVersion', 'obsidianVersion', 'dataPackageSchemaVersion', 'settingsVersion'],
		diagnostics,
	);
	if (!object) return null;
	const pluginVersion = readString(object, 'pluginVersion', '$.body.source', diagnostics);
	const obsidianVersion = readString(object, 'obsidianVersion', '$.body.source', diagnostics);
	const dataPackageSchemaVersion = readInteger(object, 'dataPackageSchemaVersion', '$.body.source', diagnostics);
	const settingsVersion = readInteger(object, 'settingsVersion', '$.body.source', diagnostics);
	if (!pluginVersion || !obsidianVersion || dataPackageSchemaVersion === null || settingsVersion === null) return null;
	return { pluginVersion, obsidianVersion, dataPackageSchemaVersion, settingsVersion };
}

function parseScope(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupScopeV1 | null {
	const path = '$.body.scope';
	const keys = [
		'configuration', 'tableFiles', 'externalCalendarUrls', 'developerApiGrants', 'mobileIdentity',
		'operationalState', 'runtime', 'cache',
	] as const;
	const object = inspectObject(raw, path, keys, diagnostics);
	if (!object) return null;
	const configuration = readLiteral(object, 'configuration', ['portable'], path, diagnostics);
	const tableFiles = readLiteral(object, 'tableFiles', ['excluded', 'included'], path, diagnostics);
	const externalCalendarUrls = readLiteral(object, 'externalCalendarUrls', ['excluded', 'included'], path, diagnostics);
	const developerApiGrants = readLiteral(object, 'developerApiGrants', ['excluded'], path, diagnostics);
	const mobileIdentity = readLiteral(object, 'mobileIdentity', ['excluded'], path, diagnostics);
	const operationalState = readLiteral(object, 'operationalState', ['excluded'], path, diagnostics);
	const runtime = readLiteral(object, 'runtime', ['excluded'], path, diagnostics);
	const cache = readLiteral(object, 'cache', ['excluded'], path, diagnostics);
	if (!configuration || !tableFiles || !externalCalendarUrls || !developerApiGrants || !mobileIdentity
		|| !operationalState || !runtime || !cache) return null;
	return {
		configuration,
		tableFiles,
		externalCalendarUrls,
		developerApiGrants,
		mobileIdentity,
		operationalState,
		runtime,
		cache,
	};
}

function parseGroups(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupGroupsV1 | null {
	const path = '$.body.groups';
	const optionalGroups = OPERON_SETTINGS_BACKUP_GROUP_NAMES.filter(group => !isFoundationalGroup(group));
	const object = inspectObject(
		raw,
		path,
		OPERON_SETTINGS_BACKUP_GROUP_NAMES,
		diagnostics,
		optionalGroups,
	);
	if (!object) return null;
	const groups: Partial<Record<OperonSettingsBackupGroupNameV1, OperonSettingsBackupVersionedGroupV1>> = {};
	for (const name of OPERON_SETTINGS_BACKUP_GROUP_NAMES) {
		if (!Object.prototype.hasOwnProperty.call(object, name)) continue;
		const groupPath = `${path}.${name}`;
		const group = inspectObject(object[name], groupPath, ['codecVersion', 'data'], diagnostics);
		if (!group) continue;
		const codecVersion = readInteger(group, 'codecVersion', groupPath, diagnostics);
		if (!Object.prototype.hasOwnProperty.call(group, 'data')) {
			diagnostics.push(diagnostic(`${groupPath}.data`, 'required', 'Required field is missing.'));
			continue;
		}
		try {
			canonicalizeOperonSettingsBackupJson(group.data);
		} catch (error) {
			diagnostics.push(diagnostic(
				`${groupPath}.data`,
				'value',
				error instanceof Error ? error.message : String(error),
			));
			continue;
		}
		if (codecVersion !== null) groups[name] = { codecVersion, data: group.data as JsonValue };
	}
	return OPERON_SETTINGS_BACKUP_FOUNDATIONAL_GROUP_NAMES.every(name => !!groups[name])
		? groups as OperonSettingsBackupGroupsV1
		: null;
}

function parseTableInventory(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupTableInventoryV1 | null {
	const path = '$.body.tableInventory';
	const object = inspectObject(raw, path, ['mode', 'items'], diagnostics);
	if (!object) return null;
	const mode = readLiteral(object, 'mode', ['excluded', 'included'], path, diagnostics);
	if (!Array.isArray(object.items)) {
		diagnostics.push(diagnostic(`${path}.items`, 'type', 'items must be an array.'));
		return null;
	}
	const items: OperonSettingsBackupTableInventoryItemV1[] = [];
	for (let index = 0; index < object.items.length; index++) {
		const itemPath = `${path}.items[${index}]`;
		const item = inspectObject(object.items[index], itemPath, ['id', 'originalPath', 'sha256'], diagnostics);
		if (!item) continue;
		const id = readString(item, 'id', itemPath, diagnostics);
		const originalPath = readString(item, 'originalPath', itemPath, diagnostics);
		let sha256: string | null = null;
		if (item.sha256 !== null) {
			sha256 = readString(item, 'sha256', itemPath, diagnostics);
			if (sha256 && !isSha256(sha256)) {
				diagnostics.push(diagnostic(`${itemPath}.sha256`, 'value', 'sha256 must be 64 lowercase hexadecimal characters.'));
			}
		}
		if (id && originalPath && (sha256 === null || isSha256(sha256))) items.push({ id, originalPath, sha256 });
	}
	if (!mode || items.length !== object.items.length) return null;
	return { mode, items };
}

function parseIntegrity(
	raw: unknown,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupIntegrityV1 | null {
	const path = '$.integrity';
	const object = inspectObject(raw, path, ['algorithm', 'canonicalization', 'value'], diagnostics);
	if (!object) return null;
	const algorithm = readLiteral(object, 'algorithm', ['sha256'], path, diagnostics);
	const canonicalization = readLiteral(
		object,
		'canonicalization',
		[OPERON_SETTINGS_BACKUP_CANONICALIZATION],
		path,
		diagnostics,
	);
	const value = readString(object, 'value', path, diagnostics);
	if (value && !isSha256(value)) {
		diagnostics.push(diagnostic(`${path}.value`, 'value', 'Integrity value must be 64 lowercase hexadecimal characters.'));
	}
	if (!algorithm || !canonicalization || !value || !isSha256(value)) return null;
	return { algorithm, canonicalization, value };
}

function inspectObject(
	value: unknown,
	path: string,
	allowedFields: readonly string[],
	diagnostics: OperonSettingsBackupDiagnostic[],
	optionalFields: readonly string[] = [],
): Record<string, unknown> | null {
	if (!isPlainRecord(value)) {
		diagnostics.push(diagnostic(path, 'type', 'Expected a plain JSON object.'));
		return null;
	}
	const allowed = new Set(allowedFields);
	for (const key of Object.keys(value)) {
		if (isForbiddenKey(key)) {
			diagnostics.push(diagnostic(`${path}.${key}`, 'prototype', 'Prototype-related keys are forbidden.'));
		} else if (!allowed.has(key)) {
			diagnostics.push(diagnostic(`${path}.${key}`, 'unknown-field', `Unknown field: ${key}.`));
		}
	}
	const optional = new Set(optionalFields);
	for (const key of allowedFields) {
		if (optional.has(key)) continue;
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
			diagnostics.push(diagnostic(`${path}.${key}`, 'required', 'Required field is missing.'));
		}
	}
	return value;
}

function readString(
	object: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): string | null {
	const value = object[key];
	if (typeof value !== 'string' || value.length === 0) {
		diagnostics.push(diagnostic(`${path}.${key}`, 'type', `${key} must be a non-empty string.`));
		return null;
	}
	return value;
}

function readInteger(
	object: Record<string, unknown>,
	key: string,
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): number | null {
	const value = object[key];
	if (!isNonNegativeInteger(value)) {
		diagnostics.push(diagnostic(`${path}.${key}`, 'type', `${key} must be a non-negative integer.`));
		return null;
	}
	return value;
}

function readLiteral<const T extends string>(
	object: Record<string, unknown>,
	key: string,
	allowed: readonly T[],
	path: string,
	diagnostics: OperonSettingsBackupDiagnostic[],
): T | null {
	const value = object[key];
	if (typeof value !== 'string' || !allowed.includes(value as T)) {
		diagnostics.push(diagnostic(`${path}.${key}`, 'value', `${key} must be one of: ${allowed.join(', ')}.`));
		return null;
	}
	return value as T;
}

interface CanonicalSerializationState {
	stack: Set<object>;
	collectionEntries: number;
}

function serializeCanonicalJson(
	value: unknown,
	path: string,
	depth: number,
	state: CanonicalSerializationState,
): string {
	if (depth > OPERON_SETTINGS_BACKUP_MAX_CANONICAL_DEPTH) {
		throw new OperonSettingsBackupCanonicalJsonError(
			`${path} exceeds the maximum canonical JSON depth of ${OPERON_SETTINGS_BACKUP_MAX_CANONICAL_DEPTH}.`,
		);
	}
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new OperonSettingsBackupCanonicalJsonError(`${path} contains a non-finite number.`);
		return JSON.stringify(Object.is(value, -0) ? 0 : value);
	}
	if (typeof value !== 'object') {
		throw new OperonSettingsBackupCanonicalJsonError(`${path} is not JSON-safe.`);
	}
	if (state.stack.has(value)) throw new OperonSettingsBackupCanonicalJsonError(`${path} contains a cycle.`);
	state.stack.add(value);
	try {
		if (Array.isArray(value)) {
			addCollectionEntries(value.length, path, state);
			for (let index = 0; index < value.length; index++) {
				if (!Object.prototype.hasOwnProperty.call(value, index)) {
					throw new OperonSettingsBackupCanonicalJsonError(`${path}[${index}] is a sparse array entry.`);
				}
			}
			return `[${value.map((item, index) => (
				serializeCanonicalJson(item, `${path}[${index}]`, depth + 1, state)
			)).join(',')}]`;
		}
		if (!isPlainRecord(value)) {
			throw new OperonSettingsBackupCanonicalJsonError(`${path} must be a plain JSON object.`);
		}
		const keys = Object.keys(value).sort(compareCodeUnits);
		addCollectionEntries(keys.length, path, state);
		for (const key of keys) {
			if (isForbiddenKey(key)) {
				throw new OperonSettingsBackupCanonicalJsonError(`${path}.${key} is a forbidden prototype-related key.`);
			}
		}
		return `{${keys.map(key => (
			`${JSON.stringify(key)}:${serializeCanonicalJson(value[key], `${path}.${key}`, depth + 1, state)}`
		)).join(',')}}`;
	} finally {
		state.stack.delete(value);
	}
}

function addCollectionEntries(
	count: number,
	path: string,
	state: CanonicalSerializationState,
): void {
	state.collectionEntries += count;
	if (state.collectionEntries > OPERON_SETTINGS_BACKUP_MAX_COLLECTION_ENTRIES) {
		throw new OperonSettingsBackupCanonicalJsonError(
			`${path} exceeds the maximum of ${OPERON_SETTINGS_BACKUP_MAX_COLLECTION_ENTRIES} total collection entries.`,
		);
	}
}

function sortJsonForDisplay(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonForDisplay);
	if (!isPlainRecord(value)) return Object.is(value, -0) ? 0 : value;
	return Object.fromEntries(
		Object.keys(value)
			.sort(compareCodeUnits)
			.map(key => [key, sortJsonForDisplay(value[key])]),
	);
}

function parseFailure(
	classification: Exclude<OperonSettingsBackupParseClassification, 'valid'>,
	diagnostics: OperonSettingsBackupDiagnostic[],
): OperonSettingsBackupParseResult {
	return { ok: false, classification, value: null, diagnostics };
}

function diagnostic(
	path: string,
	code: OperonSettingsBackupDiagnosticCode,
	message: string,
): OperonSettingsBackupDiagnostic {
	return { path, code, severity: 'error', message };
}

function warning(
	path: string,
	code: OperonSettingsBackupDiagnosticCode,
	message: string,
): OperonSettingsBackupDiagnostic {
	return { path, code, severity: 'warning', message };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as object | null;
	return prototype === Object.prototype || prototype === null;
}

function isForbiddenKey(key: string): boolean {
	return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function isFoundationalGroup(group: OperonSettingsBackupGroupNameV1): boolean {
	return group === 'general'
		|| group === 'pipelines'
		|| group === 'priorities'
		|| group === 'system-key-mappings'
		|| group === 'custom-keys';
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSha256(value: string): boolean {
	return /^[a-f0-9]{64}$/u.test(value);
}

function isIsoDateTime(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
		&& !Number.isNaN(Date.parse(value));
}

function compareCodeUnits(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
