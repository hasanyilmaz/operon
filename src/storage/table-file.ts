import { isSafeVaultRelativeFolderPath, normalizeSettingsFolderPath } from '../core/settings-folder-rules';
import {
	TABLE_TASK_DATA_TYPE_COLUMN_KEY,
	isTableColumnColorModeLocked,
	normalizeTableCollapsedGroupKeys,
} from '../types/table';
import type {
	TableColumn,
	TableColumnAlignment,
	TableColumnColorMode,
	TableColumnDisplayMode,
	TableColumnKind,
	TableDensity,
	TableDisplayOptions,
	TableDurationDisplayMode,
	TablePreset,
	TablePresetSearchParent,
	TablePresetSearchScope,
	TablePresetSearchState,
	TableSortDirection,
	TableSortEmptyPlacement,
	TableSortRule,
	TableSummaryFunction,
	TableSummaryRule,
} from '../types/table';
import { isSafeTablePresetId } from '../types/table';
import {
	OPERON_TABLE_FILE_EXTENSION,
	OPERON_TABLE_FILE_FALLBACK_NAME,
	OPERON_TABLE_FILE_FORMAT,
	OPERON_TABLE_FILE_LEGACY_VERSION,
	OPERON_TABLE_FILE_PREVIOUS_VERSION,
	OPERON_TABLE_FILE_STEM_MAX_CODEPOINTS,
	OPERON_TABLE_FILE_VERSION,
	type DiscoveredOperonTableFile,
	type OperonTableFile,
	type OperonTableFileDescriptor,
	type OperonTableFileDiagnostic,
	type OperonTableFileDiagnosticCode,
	type OperonTableFileDiscoveryResult,
	type OperonTableFileParseResult,
	type OperonTableFilePathChange,
	type OperonTableFileReadCallback,
} from '../types/table-file';

const ROOT_FIELDS_V1 = [
	'format', 'version', 'id', 'name', 'filterSetId', 'columns', 'sortRules', 'groupBy', 'groupOrder',
	'subgroupBy', 'subgroupOrder', 'summaries', 'display', 'search',
] as const;
const ROOT_FIELDS_V2 = [
	'format', 'version', 'id', 'name', 'filterSetId', 'columns', 'sortRules', 'groupBy', 'groupOrder',
	'subgroupBy', 'subgroupOrder', 'collapsedGroupKeys', 'summaries', 'display', 'search',
] as const;
const ROOT_FIELDS_V3 = ROOT_FIELDS_V2;
const RETIRED_TABLE_TASK_TYPE_COLUMN_KEY = '__taskType';
const COLUMN_FIELDS = [
	'key', 'kind', 'label', 'widthPx', 'hidden', 'align', 'pinned', 'colorMode', 'durationDisplayMode', 'displayMode',
] as const;
const SORT_RULE_FIELDS = ['key', 'direction', 'empty'] as const;
const SUMMARY_RULE_FIELDS = ['key', 'function'] as const;
const DISPLAY_FIELDS = ['showSource', 'density'] as const;
const SEARCH_FIELDS = ['scope', 'parent'] as const;
const SEARCH_SCOPE_FIELDS = [
	'projectMode', 'showOverdue', 'showHappensToday', 'showRecentModified', 'includeInline', 'includeFile',
	'includeCancelled', 'includeFinished',
] as const;
const SEARCH_PARENT_FIELDS = ['mode', 'parentId', 'parentName'] as const;

const COLUMN_KINDS: readonly TableColumnKind[] = ['task', 'admin'];
const COLUMN_ALIGNMENTS: readonly TableColumnAlignment[] = ['left', 'center', 'right'];
const COLUMN_COLOR_MODES: readonly TableColumnColorMode[] = ['noColor', 'taskColor', 'statusColor', 'priorityColor', 'randomColors'];
const DURATION_DISPLAY_MODES: readonly TableDurationDisplayMode[] = ['sessions', 'total'];
const COLUMN_DISPLAY_MODES: readonly TableColumnDisplayMode[] = ['details', 'icon'];
const SORT_DIRECTIONS: readonly TableSortDirection[] = ['asc', 'desc'];
const EMPTY_PLACEMENTS: readonly TableSortEmptyPlacement[] = ['first', 'last'];
const DENSITIES: readonly TableDensity[] = ['compact', 'comfortable'];
const SUMMARY_FUNCTIONS: readonly TableSummaryFunction[] = [
	'Count', 'Filled', 'Empty', 'Unique', 'Sum', 'Average', 'Median', 'Min', 'Max', 'Range', 'Stddev',
	'Earliest', 'Latest', 'OpenCount', 'FinishedCount', 'CancelledCount', 'TerminalCount', 'CompletionRate',
	'TopValues', 'ListItemCount',
];
const INVALID_TABLE_FILE_STEM_CHARACTERS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const WINDOWS_RESERVED_FILE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function parseOperonTableFile(source: string, path?: string): OperonTableFileParseResult {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch {
		return invalidResult([diagnostic('invalid-json', 'The file is not valid JSON.', path)]);
	}

	if (!isRecord(value)) {
		return invalidResult([diagnostic('invalid-root', 'The file root must be a JSON object.', path)]);
	}

	const diagnostics: OperonTableFileDiagnostic[] = [];
	if (value.format !== OPERON_TABLE_FILE_FORMAT) {
		diagnostics.push(diagnostic('invalid-format', `format must be "${OPERON_TABLE_FILE_FORMAT}".`, path, 'format'));
	}
	const version = value.version;
	const supportedVersion = isSupportedTableFileVersion(version);
	if (!supportedVersion) {
		diagnostics.push(diagnostic(
			'unsupported-version',
			`version must be ${OPERON_TABLE_FILE_LEGACY_VERSION}, ${OPERON_TABLE_FILE_PREVIOUS_VERSION}, or ${OPERON_TABLE_FILE_VERSION}.`,
			path,
			'version',
		));
	}
	checkKnownFields(value, getRootFieldsForVersion(supportedVersion ? version : OPERON_TABLE_FILE_VERSION), '', diagnostics, path);

	const parsedPreset = readPreset(value, diagnostics, path, supportedVersion ? version : OPERON_TABLE_FILE_VERSION);
	const preset = supportedVersion && parsedPreset
		? version === OPERON_TABLE_FILE_VERSION
			? parsedPreset
			: migrateLegacyTableTaskDataTypeReferences(parsedPreset)
		: null;
	if (supportedVersion && version === OPERON_TABLE_FILE_VERSION && preset) {
		validateV3TableTaskDataTypeReferences(preset, diagnostics, path);
	}
	if (!preset || diagnostics.length > 0) return invalidResult(diagnostics);

	const file: OperonTableFile = {
		format: OPERON_TABLE_FILE_FORMAT,
		version: version as TableFileVersion,
		...preset,
	};
	return { status: 'valid', file, preset, diagnostics: [] };
}

export function buildOperonTableFile(preset: TablePreset): OperonTableFile {
	return {
		format: OPERON_TABLE_FILE_FORMAT,
		version: OPERON_TABLE_FILE_VERSION,
		...clonePreset(preset),
	};
}

export function serializeOperonTableFile(preset: TablePreset, space = 2): string {
	return `${JSON.stringify(buildOperonTableFile(preset), null, space)}\n`;
}

export function isOperonTableFilePath(path: string): boolean {
	return normalizeOperonTableFilePath(path).toLocaleLowerCase('en-US').endsWith(OPERON_TABLE_FILE_EXTENSION);
}

export function normalizeOperonTableFilePath(path: string): string {
	const parts: string[] = [];
	for (const part of path.replace(/\\/gu, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') {
			parts.pop();
		} else {
			parts.push(part);
		}
	}
	return parts.join('/');
}

export function getOperonTableFilePathKey(path: string): string {
	return normalizeOperonTableFilePath(path).toLocaleLowerCase('en-US');
}

export function sanitizeOperonTableFileStem(displayName: string): string {
	const sanitized = Array.from(displayName.replace(/\s+/gu, ' '))
		.filter(isValidOperonTableFileStemCharacter)
		.join('')
		.trim()
		.replace(/[. ]+$/gu, '');
	const truncated = Array.from(sanitized)
		.slice(0, OPERON_TABLE_FILE_STEM_MAX_CODEPOINTS)
		.join('')
		.replace(/[. ]+$/gu, '');

	return truncated && !WINDOWS_RESERVED_FILE_STEM.test(truncated)
		? truncated
		: OPERON_TABLE_FILE_FALLBACK_NAME;
}

function isValidOperonTableFileStemCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0) ?? 0;
	return codePoint > 31 && codePoint !== 127 && !INVALID_TABLE_FILE_STEM_CHARACTERS.has(character);
}

export function buildOperonTableFilePath(folderPath: string, displayName: string): string {
	const folder = normalizeOperonTableFilePath(folderPath);
	const filename = `${sanitizeOperonTableFileStem(displayName)}${OPERON_TABLE_FILE_EXTENSION}`;
	return folder ? `${folder}/${filename}` : filename;
}

/**
 * Normalizes a user-configured Table destination folder and rejects paths that
 * cannot safely resolve inside the vault. An empty value deliberately means
 * the vault root.
 */
export function resolveOperonTableCreationFolder(configuredFolder: string): string {
	const folder = normalizeSettingsFolderPath(configuredFolder);
	if (!folder) return '';
	if (!isSafeVaultRelativeFolderPath(folder)) {
		throw new Error('Table default folder must be a canonical vault-relative path.');
	}
	return folder;
}

export function buildUniqueOperonTableFilePath(
	folderPath: string,
	displayName: string,
	existingPaths: Iterable<string>,
): string {
	const folder = normalizeOperonTableFilePath(folderPath);
	const folderKey = getOperonTableFilePathKey(folder);
	const occupiedNames = new Set<string>();
	for (const existingPath of existingPaths) {
		const normalized = normalizeOperonTableFilePath(existingPath);
		if (getOperonTableFilePathKey(getOperonTableFileFolderPath(normalized)) !== folderKey) continue;
		occupiedNames.add(getOperonTableFilePathKey(getOperonTableFileName(normalized)));
	}

	const stem = sanitizeOperonTableFileStem(displayName);
	let suffix = 1;
	while (true) {
		const candidateStem = buildNumberedOperonTableFileStem(stem, suffix);
		const candidateName = `${candidateStem}${OPERON_TABLE_FILE_EXTENSION}`;
		if (!occupiedNames.has(getOperonTableFilePathKey(candidateName))) {
			return folder ? `${folder}/${candidateName}` : candidateName;
		}
		suffix += 1;
	}
}

function buildNumberedOperonTableFileStem(stem: string, suffix: number): string {
	if (suffix === 1) return stem;
	const suffixText = ` ${suffix}`;
	const maxBaseLength = Math.max(0, OPERON_TABLE_FILE_STEM_MAX_CODEPOINTS - Array.from(suffixText).length);
	const base = Array.from(stem).slice(0, maxBaseLength).join('').replace(/[. ]+$/gu, '');
	return `${base || OPERON_TABLE_FILE_FALLBACK_NAME}${suffixText}`;
}

export function deriveOperonTableNameFromPath(path: string): string {
	const filename = getOperonTableFileName(normalizeOperonTableFilePath(path));
	const stem = filename.toLocaleLowerCase('en-US').endsWith(OPERON_TABLE_FILE_EXTENSION)
		? filename.slice(0, -OPERON_TABLE_FILE_EXTENSION.length)
		: filename;
	return stem || OPERON_TABLE_FILE_FALLBACK_NAME;
}

export function classifyOperonTableFilePathChange(oldPath: string, newPath: string): OperonTableFilePathChange {
	const normalizedOldPath = normalizeOperonTableFilePath(oldPath);
	const normalizedNewPath = normalizeOperonTableFilePath(newPath);
	if (normalizedOldPath === normalizedNewPath) return 'unchanged';

	const moved = getOperonTableFileFolderPath(normalizedOldPath) !== getOperonTableFileFolderPath(normalizedNewPath);
	const renamed = getOperonTableFileName(normalizedOldPath) !== getOperonTableFileName(normalizedNewPath);
	if (moved && renamed) return 'rename-and-move';
	if (moved) return 'move';
	return 'rename';
}

function getOperonTableFileFolderPath(path: string): string {
	const slashIndex = path.lastIndexOf('/');
	return slashIndex < 0 ? '' : path.slice(0, slashIndex);
}

function getOperonTableFileName(path: string): string {
	const slashIndex = path.lastIndexOf('/');
	return slashIndex < 0 ? path : path.slice(slashIndex + 1);
}

export async function discoverOperonTableFiles<TDescriptor extends OperonTableFileDescriptor>(
	descriptors: readonly TDescriptor[],
	read: OperonTableFileReadCallback<TDescriptor>,
): Promise<OperonTableFileDiscoveryResult<TDescriptor>> {
	const candidates = descriptors
		.map((descriptor, index) => ({ descriptor, index, path: normalizeOperonTableFilePath(descriptor.path) }))
		.filter(candidate => isOperonTableFilePath(candidate.path))
		.sort(compareCandidates);
	const files: DiscoveredOperonTableFile<TDescriptor>[] = [];

	for (const candidate of candidates) {
		try {
			const result = parseOperonTableFile(await read(candidate.descriptor), candidate.path);
			files.push({
				descriptor: candidate.descriptor,
				path: candidate.path,
				status: result.status === 'valid' ? 'loaded' : 'invalid',
				file: result.file,
				preset: result.preset,
				diagnostics: [...result.diagnostics],
			});
		} catch (error) {
			files.push({
				descriptor: candidate.descriptor,
				path: candidate.path,
				status: 'invalid',
				file: null,
				preset: null,
				diagnostics: [diagnostic('read-failed', describeReadFailure(error), candidate.path)],
			});
		}
	}

	markDuplicateIds(files);
	return {
		files,
		presets: files.flatMap(file => file.status === 'loaded' && file.preset ? [file.preset] : []),
		diagnostics: files.flatMap(file => file.diagnostics),
	};
}

function readPreset(
	value: Record<string, unknown>,
	diagnostics: OperonTableFileDiagnostic[],
	path: string | undefined,
	version: TableFileVersion,
): TablePreset | null {
	const id = readNonEmptyString(value, 'id', diagnostics, path);
	if (id !== null && !isSafeTablePresetId(id)) {
		diagnostics.push(diagnostic('invalid-field', 'id must be an Operon Table preset ID.', path, 'id'));
	}
	const name = readNonEmptyString(value, 'name', diagnostics, path);
	const filterSetId = readNullableNonEmptyString(value, 'filterSetId', diagnostics, path);
	const columns = readArray(value, 'columns', readColumn, diagnostics, path);
	const sortRules = readArray(value, 'sortRules', readSortRule, diagnostics, path);
	const groupBy = readNullableNonEmptyString(value, 'groupBy', diagnostics, path);
	const groupOrder = readEnum(value, 'groupOrder', SORT_DIRECTIONS, diagnostics, path);
	const subgroupBy = readNullableNonEmptyString(value, 'subgroupBy', diagnostics, path);
	const subgroupOrder = readEnum(value, 'subgroupOrder', SORT_DIRECTIONS, diagnostics, path);
	const collapsedGroupKeys = version === OPERON_TABLE_FILE_LEGACY_VERSION
		? []
		: readCollapsedGroupKeys(value, diagnostics, path);
	const summaries = readArray(value, 'summaries', readSummaryRule, diagnostics, path);
	const display = readDisplay(value.display, diagnostics, path, 'display');
	const search = readSearch(value.search, diagnostics, path, 'search');
	if (id === null || name === null || filterSetId === undefined || !columns || !sortRules || groupBy === undefined
		|| !groupOrder || subgroupBy === undefined || !subgroupOrder || !collapsedGroupKeys || !summaries || !display || !search) return null;
	return { id, name, filterSetId, columns, sortRules, groupBy, groupOrder, subgroupBy, subgroupOrder, collapsedGroupKeys, summaries, display, search };
}

type TableFileVersion =
	| typeof OPERON_TABLE_FILE_LEGACY_VERSION
	| typeof OPERON_TABLE_FILE_PREVIOUS_VERSION
	| typeof OPERON_TABLE_FILE_VERSION;

function isSupportedTableFileVersion(value: unknown): value is TableFileVersion {
	return value === OPERON_TABLE_FILE_LEGACY_VERSION
		|| value === OPERON_TABLE_FILE_PREVIOUS_VERSION
		|| value === OPERON_TABLE_FILE_VERSION;
}

function getRootFieldsForVersion(version: TableFileVersion): readonly string[] {
	if (version === OPERON_TABLE_FILE_LEGACY_VERSION) return ROOT_FIELDS_V1;
	if (version === OPERON_TABLE_FILE_PREVIOUS_VERSION) return ROOT_FIELDS_V2;
	return ROOT_FIELDS_V3;
}

/**
 * V1/V2 `taskType` was the Table source-kind synthetic field. Migrate only
 * the persisted Table reference surfaces; unrelated preset data stays exact.
 */
function migrateLegacyTableTaskDataTypeReferences(preset: TablePreset): TablePreset {
	const migrateKey = (key: string): string => (
		key === 'taskType' || key === RETIRED_TABLE_TASK_TYPE_COLUMN_KEY
			? TABLE_TASK_DATA_TYPE_COLUMN_KEY
			: key
	);
	const seenColumns = new Set<string>();
	const columns = preset.columns.flatMap(column => {
		const key = migrateKey(column.key);
		if (key === TABLE_TASK_DATA_TYPE_COLUMN_KEY && seenColumns.has(key)) return [];
		if (key === TABLE_TASK_DATA_TYPE_COLUMN_KEY) seenColumns.add(key);
		return [{ ...column, key }];
	});
	const seenSortRules = new Set<string>();
	const sortRules = preset.sortRules.flatMap(rule => {
		const key = migrateKey(rule.key);
		if (key === TABLE_TASK_DATA_TYPE_COLUMN_KEY && seenSortRules.has(key)) return [];
		if (key === TABLE_TASK_DATA_TYPE_COLUMN_KEY) seenSortRules.add(key);
		return [{ ...rule, key }];
	});
	const seenSummaries = new Set<string>();
	const summaries = preset.summaries.flatMap(summary => {
		const key = migrateKey(summary.key);
		if (key === TABLE_TASK_DATA_TYPE_COLUMN_KEY && seenSummaries.has(key)) return [];
		if (key === TABLE_TASK_DATA_TYPE_COLUMN_KEY) seenSummaries.add(key);
		return [{ ...summary, key }];
	});
	const groupBy = preset.groupBy === null ? null : migrateKey(preset.groupBy);
	const migratedSubgroupBy = preset.subgroupBy === null ? null : migrateKey(preset.subgroupBy);
	const subgroupBy = migratedSubgroupBy === groupBy ? null : migratedSubgroupBy;
	return { ...preset, columns, sortRules, groupBy, subgroupBy, summaries };
}

function validateV3TableTaskDataTypeReferences(
	preset: TablePreset,
	diagnostics: OperonTableFileDiagnostic[],
	path: string | undefined,
): void {
	const validate = (key: string, field: string): void => {
		if (key !== RETIRED_TABLE_TASK_TYPE_COLUMN_KEY) return;
		diagnostics.push(diagnostic(
			'invalid-field',
			`${field} must use ${TABLE_TASK_DATA_TYPE_COLUMN_KEY}; ${RETIRED_TABLE_TASK_TYPE_COLUMN_KEY} is retired in version ${OPERON_TABLE_FILE_VERSION}.`,
			path,
			field,
		));
	};
	preset.columns.forEach((column, index) => validate(column.key, `columns[${index}].key`));
	preset.sortRules.forEach((rule, index) => validate(rule.key, `sortRules[${index}].key`));
	preset.summaries.forEach((summary, index) => validate(summary.key, `summaries[${index}].key`));
	if (preset.groupBy) validate(preset.groupBy, 'groupBy');
	if (preset.subgroupBy) validate(preset.subgroupBy, 'subgroupBy');
}

function readCollapsedGroupKeys(value: Record<string, unknown>, diagnostics: OperonTableFileDiagnostic[], path?: string): string[] | null {
	if (!hasOwn(value, 'collapsedGroupKeys')) {
		diagnostics.push(diagnostic('missing-field', 'collapsedGroupKeys is required.', path, 'collapsedGroupKeys'));
		return null;
	}
	if (!Array.isArray(value.collapsedGroupKeys)) {
		diagnostics.push(diagnostic('invalid-field', 'collapsedGroupKeys must be an array.', path, 'collapsedGroupKeys'));
		return null;
	}
	return normalizeTableCollapsedGroupKeys(value.collapsedGroupKeys);
}

function readColumn(value: unknown, field: string, diagnostics: OperonTableFileDiagnostic[], path?: string): TableColumn | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, COLUMN_FIELDS, field, diagnostics, path);
	const key = readNonEmptyString(value, 'key', diagnostics, path, field);
	const kind = readEnum(value, 'kind', COLUMN_KINDS, diagnostics, path, field);
	const label = readOptionalNonEmptyString(value, 'label', diagnostics, path, field);
	const widthPx = readOptionalFiniteNumber(value, 'widthPx', diagnostics, path, field);
	const hidden = readOptionalBoolean(value, 'hidden', diagnostics, path, field);
	const align = readOptionalEnum(value, 'align', COLUMN_ALIGNMENTS, diagnostics, path, field);
	const pinned = readOptionalBoolean(value, 'pinned', diagnostics, path, field);
	const colorMode = readOptionalEnum(value, 'colorMode', COLUMN_COLOR_MODES, diagnostics, path, field);
	const durationDisplayMode = readOptionalEnum(value, 'durationDisplayMode', DURATION_DISPLAY_MODES, diagnostics, path, field);
	const displayMode = readOptionalEnum(value, 'displayMode', COLUMN_DISPLAY_MODES, diagnostics, path, field);
	if (key === null || !kind || label === null || widthPx === null || hidden === null || align === null || pinned === null
		|| colorMode === null || durationDisplayMode === null || displayMode === null) return null;
	const column: TableColumn = { key, kind };
	if (label !== undefined) column.label = label;
	if (widthPx !== undefined) column.widthPx = widthPx;
	if (hidden !== undefined) column.hidden = hidden;
	if (align !== undefined) column.align = align;
	if (pinned !== undefined) column.pinned = pinned;
	if (colorMode !== undefined && !isTableColumnColorModeLocked(key)) column.colorMode = colorMode;
	if (durationDisplayMode !== undefined) column.durationDisplayMode = durationDisplayMode;
	if (displayMode !== undefined) column.displayMode = displayMode;
	return column;
}

function readSortRule(value: unknown, field: string, diagnostics: OperonTableFileDiagnostic[], path?: string): TableSortRule | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, SORT_RULE_FIELDS, field, diagnostics, path);
	const key = readNonEmptyString(value, 'key', diagnostics, path, field);
	const direction = readEnum(value, 'direction', SORT_DIRECTIONS, diagnostics, path, field);
	const empty = readEnum(value, 'empty', EMPTY_PLACEMENTS, diagnostics, path, field);
	return key !== null && direction && empty ? { key, direction, empty } : null;
}

function readSummaryRule(value: unknown, field: string, diagnostics: OperonTableFileDiagnostic[], path?: string): TableSummaryRule | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, SUMMARY_RULE_FIELDS, field, diagnostics, path);
	const key = readNonEmptyString(value, 'key', diagnostics, path, field);
	const summaryFunction = readEnum(value, 'function', SUMMARY_FUNCTIONS, diagnostics, path, field);
	return key !== null && summaryFunction ? { key, function: summaryFunction } : null;
}

function readDisplay(value: unknown, diagnostics: OperonTableFileDiagnostic[], path: string | undefined, field: string): TableDisplayOptions | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, DISPLAY_FIELDS, field, diagnostics, path);
	const showSource = readBoolean(value, 'showSource', diagnostics, path, field);
	const density = readEnum(value, 'density', DENSITIES, diagnostics, path, field);
	return showSource !== null && density ? { showSource, density } : null;
}

function readSearch(value: unknown, diagnostics: OperonTableFileDiagnostic[], path: string | undefined, field: string): TablePresetSearchState | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, SEARCH_FIELDS, field, diagnostics, path);
	const scope = readSearchScope(value.scope, diagnostics, path, `${field}.scope`);
	const parent = value.parent === null ? null : readSearchParent(value.parent, diagnostics, path, `${field}.parent`);
	return scope && (value.parent === null || parent) ? { scope, parent } : null;
}

function readSearchScope(value: unknown, diagnostics: OperonTableFileDiagnostic[], path: string | undefined, field: string): TablePresetSearchScope | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, SEARCH_SCOPE_FIELDS, field, diagnostics, path);
	const projectMode = value.projectMode === null ? null : readEnum(value, 'projectMode', ['pc', 'pt'] as const, diagnostics, path, field);
	const booleans = SEARCH_SCOPE_FIELDS.slice(1).map(key => readBoolean(value, key, diagnostics, path, field));
	if ((value.projectMode !== null && !projectMode) || booleans.some(item => item === null)) return null;
	const [showOverdue, showHappensToday, showRecentModified, includeInline, includeFile, includeCancelled, includeFinished] = booleans as boolean[];
	return { projectMode, showOverdue, showHappensToday, showRecentModified, includeInline, includeFile, includeCancelled, includeFinished };
}

function readSearchParent(value: unknown, diagnostics: OperonTableFileDiagnostic[], path: string | undefined, field: string): TablePresetSearchParent | null {
	if (!isRecordAt(value, field, diagnostics, path)) return null;
	checkKnownFields(value, SEARCH_PARENT_FIELDS, field, diagnostics, path);
	const mode = readEnum(value, 'mode', ['pc', 'pt'] as const, diagnostics, path, field);
	const parentId = readNonEmptyString(value, 'parentId', diagnostics, path, field);
	const parentName = readOptionalNonEmptyString(value, 'parentName', diagnostics, path, field);
	if (!mode || parentId === null || parentName === null) return null;
	return parentName === undefined ? { mode, parentId } : { mode, parentId, parentName };
}

function readArray<T>(
	value: Record<string, unknown>, key: string,
	reader: (entry: unknown, field: string, diagnostics: OperonTableFileDiagnostic[], path?: string) => T | null,
	diagnostics: OperonTableFileDiagnostic[], path?: string,
): T[] | null {
	if (!hasOwn(value, key)) {
		diagnostics.push(diagnostic('missing-field', `${key} is required.`, path, key));
		return null;
	}
	if (!Array.isArray(value[key])) {
		diagnostics.push(diagnostic('invalid-field', `${key} must be an array.`, path, key));
		return null;
	}
	const output: T[] = [];
	let valid = true;
	value[key].forEach((entry, index) => {
		const parsed = reader(entry, `${key}[${index}]`, diagnostics, path);
		if (parsed) output.push(parsed);
		else valid = false;
	});
	return valid ? output : null;
}

function readNonEmptyString(value: Record<string, unknown>, key: string, diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): string | null {
	const field = joinField(parent, key);
	if (!hasOwn(value, key)) {
		diagnostics.push(diagnostic('missing-field', `${field} is required.`, path, field));
		return null;
	}
	if (typeof value[key] !== 'string' || value[key].length === 0 || value[key].trim().length === 0) {
		diagnostics.push(diagnostic('invalid-field', `${field} must be a non-empty string.`, path, field));
		return null;
	}
	return value[key];
}

function readNullableNonEmptyString(value: Record<string, unknown>, key: string, diagnostics: OperonTableFileDiagnostic[], path?: string): string | null | undefined {
	if (!hasOwn(value, key)) {
		diagnostics.push(diagnostic('missing-field', `${key} is required.`, path, key));
		return undefined;
	}
	if (value[key] === null) return null;
	return readNonEmptyString(value, key, diagnostics, path) ?? undefined;
}

function readOptionalNonEmptyString(value: Record<string, unknown>, key: string, diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): string | undefined | null {
	return hasOwn(value, key) ? readNonEmptyString(value, key, diagnostics, path, parent) : undefined;
}

function readBoolean(value: Record<string, unknown>, key: string, diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): boolean | null {
	const field = joinField(parent, key);
	if (!hasOwn(value, key)) {
		diagnostics.push(diagnostic('missing-field', `${field} is required.`, path, field));
		return null;
	}
	if (typeof value[key] !== 'boolean') {
		diagnostics.push(diagnostic('invalid-field', `${field} must be a boolean.`, path, field));
		return null;
	}
	return value[key];
}

function readOptionalBoolean(value: Record<string, unknown>, key: string, diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): boolean | undefined | null {
	return hasOwn(value, key) ? readBoolean(value, key, diagnostics, path, parent) : undefined;
}

function readOptionalFiniteNumber(value: Record<string, unknown>, key: string, diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): number | undefined | null {
	if (!hasOwn(value, key)) return undefined;
	const field = joinField(parent, key);
	if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
		diagnostics.push(diagnostic('invalid-field', `${field} must be a finite number.`, path, field));
		return null;
	}
	return value[key];
}

function readEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[], diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): T | null {
	const field = joinField(parent, key);
	if (!hasOwn(value, key)) {
		diagnostics.push(diagnostic('missing-field', `${field} is required.`, path, field));
		return null;
	}
	if (typeof value[key] !== 'string' || !allowed.includes(value[key] as T)) {
		diagnostics.push(diagnostic('invalid-field', `${field} must be one of: ${allowed.join(', ')}.`, path, field));
		return null;
	}
	return value[key] as T;
}

function readOptionalEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[], diagnostics: OperonTableFileDiagnostic[], path?: string, parent = ''): T | undefined | null {
	return hasOwn(value, key) ? readEnum(value, key, allowed, diagnostics, path, parent) : undefined;
}

function checkKnownFields(value: Record<string, unknown>, allowed: readonly string[], parent: string, diagnostics: OperonTableFileDiagnostic[], path?: string): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (allowedSet.has(key)) continue;
		const field = joinField(parent, key);
		diagnostics.push(diagnostic('unknown-field', `${field} is not supported by version ${OPERON_TABLE_FILE_VERSION}.`, path, field));
	}
}

function isRecordAt(value: unknown, field: string, diagnostics: OperonTableFileDiagnostic[], path?: string): value is Record<string, unknown> {
	if (isRecord(value)) return true;
	diagnostics.push(diagnostic('invalid-field', `${field} must be an object.`, path, field));
	return false;
}

function markDuplicateIds<TDescriptor extends OperonTableFileDescriptor>(files: DiscoveredOperonTableFile<TDescriptor>[]): void {
	const byId = new Map<string, DiscoveredOperonTableFile<TDescriptor>[]>();
	for (const file of files) {
		if (file.status !== 'loaded' || !file.preset) continue;
		const matches = byId.get(file.preset.id) ?? [];
		matches.push(file);
		byId.set(file.preset.id, matches);
	}
	for (const [id, matches] of byId) {
		if (matches.length < 2) continue;
		const paths = matches.map(file => file.path).join(', ');
		for (const file of matches) {
			file.status = 'conflict';
			file.diagnostics.push(diagnostic('duplicate-id', `Table preset id "${id}" is duplicated across: ${paths}.`, file.path, 'id'));
		}
	}
}

function clonePreset(preset: TablePreset): TablePreset {
	return {
		...preset,
		columns: preset.columns.map(column => ({ ...column })),
		sortRules: preset.sortRules.map(rule => ({ ...rule })),
		collapsedGroupKeys: [...preset.collapsedGroupKeys],
		summaries: preset.summaries.map(summary => ({ ...summary })),
		display: { ...preset.display },
		search: { scope: { ...preset.search.scope }, parent: preset.search.parent ? { ...preset.search.parent } : null },
	};
}

function compareCandidates<TDescriptor extends OperonTableFileDescriptor>(
	left: { descriptor: TDescriptor; index: number; path: string },
	right: { descriptor: TDescriptor; index: number; path: string },
): number {
	return compareStrings(left.path, right.path)
		|| compareStrings(left.descriptor.path, right.descriptor.path)
		|| left.index - right.index;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function describeReadFailure(error: unknown): string {
	return error instanceof Error && error.message ? `Failed to read file: ${error.message}` : 'Failed to read file.';
}

function invalidResult(diagnostics: OperonTableFileDiagnostic[]): OperonTableFileParseResult {
	return { status: 'invalid', file: null, preset: null, diagnostics };
}

function diagnostic(code: OperonTableFileDiagnosticCode, message: string, path?: string, field?: string): OperonTableFileDiagnostic {
	return {
		code,
		severity: 'error',
		message,
		...(path === undefined ? {} : { path }),
		...(field === undefined ? {} : { field }),
	};
}

function joinField(parent: string, key: string): string {
	return parent ? `${parent}.${key}` : key;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key) === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
