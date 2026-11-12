import { inferObsidianPropertyType } from '../../core/property-type-registry';
import type { NativePropertyReadOnlyReason } from '../../core/task-editor-native-properties';
import { encodeVaultPropertyValue } from '../../core/vault-property-codec';
import { App, TFile } from 'obsidian';
import { CANONICAL_KEYS, LEGACY_CANONICAL_KEY_ALIASES } from '../../types/keys';
import type { IndexedTask } from '../../types/fields';
import type { FilterFieldType, KeyMapping } from '../../types/settings';
import {
	FILE_PROPERTY_COLUMN_PREFIX,
	classifyFilePropertyCell,
	decodeFilePropertyColumnKey,
	encodeFilePropertyColumnKey,
	isEmptyFilePropertyValue,
	isFilePropertyColumnKey,
	isSupportedRawYamlPropertyValue,
	type FilePropertyCellValue,
	type FilePropertyQueryContext,
	type FilePropertyValueState,
	type RawYamlPropertyMutation,
	type RawYamlPropertyValue,
} from '../../core/raw-yaml-property';

export const TABLE_FILE_PROPERTY_COLUMN_PREFIX = FILE_PROPERTY_COLUMN_PREFIX;

const DEFAULT_DERIVED_SNAPSHOT_LIMIT = 8;
const DEFAULT_EXCLUDED_PROPERTY_NAMES = new Set([
	'aliases',
	'cssclasses',
	'position',
	'tags',
	'title',
	'pinned',
]);

export type { ObsidianPropertyTypeId } from '../../core/property-type-registry';
import type { ObsidianPropertyTypeId } from '../../core/property-type-registry';

export interface TableFilePropertyField {
	key: string;
	label: string;
	type: FilterFieldType;
	group: 'fileProperty';
	icon: string;
	readonly: boolean;
	aliases: string[];
	propertyName: string;
	sourceType: ObsidianPropertyTypeId;
	sourceFileCount: number;
	/** The key is preserved but its current File Property type is not available. */
	unavailable?: boolean;
 readOnlyReason?: NativePropertyReadOnlyReason;
}

export interface TableFilePropertyCellValue extends FilePropertyCellValue {
 nativeState?: 'ready' | 'unsupported';
 readOnlyReason?: NativePropertyReadOnlyReason;
 sourceName?: string;
 inlineExpected?: { present: boolean; rawValue?: string };
}

export type TableFilePropertyQueryContext = FilePropertyQueryContext<
	TableFilePropertyField,
	TableFilePropertyCellValue
>;

export interface TableFilePropertySnapshot extends TableFilePropertyQueryContext {
 loading?: boolean;
	revision: number;
}

export type TableFilePropertyValueState = FilePropertyValueState;

export interface TableFilePropertySnapshotOptions {
 nativeListCandidates?: boolean;
	keyMappings?: readonly KeyMapping[];
	excludePropertyNames?: readonly string[];
}

export interface TableFilePropertyTypeResolution {
	sourceType: ObsidianPropertyTypeId;
	tableType: FilterFieldType;
}

export interface TableFilePropertyTypeResolver {
	getRevision?(): string | number;
	resolve(propertyName: string, samples: readonly unknown[]): TableFilePropertyTypeResolution;
	invalidate?(): void;
}

export interface CachedTableFilePropertyTypeResolver extends TableFilePropertyTypeResolver {
	replaceTypes(types: Readonly<Record<string, ObsidianPropertyTypeId>>): void;
}

export interface TableFilePropertyIndex {
 getSourceRevision(path: string): string;
	getSnapshot(
		tasks: readonly IndexedTask[],
		indexGeneration: number,
		options?: TableFilePropertySnapshotOptions,
	): TableFilePropertySnapshot;
	invalidateFile(path: string): void;
	removeFile(path: string): void;
	renameFile(oldPath: string, newPath: string): void;
	invalidateTypes(): void;
	applyMutation(path: string, propertyName: string, mutation: RawYamlPropertyMutation): void;
	clear(): void;
}

export interface CreateTableFilePropertyIndexOptions {
	typeResolver?: TableFilePropertyTypeResolver;
	derivedSnapshotLimit?: number;
}

interface TableFilePropertyEntry {
	path: string;
	file: TFile;
	frontmatter: ReadonlyMap<string, unknown>;
}

interface TableFilePropertyIndexState {
	revision: number;
	typeRevision: number;
	dirtyPaths: Set<string>;
	pathRevisions: Map<string, number>;
	byPath: Map<string, TableFilePropertyEntry>;
	derivedSnapshots: Map<string, TableFilePropertySnapshot>;
}

const tableFilePropertyIndexes = new WeakMap<App, TableFilePropertyIndex>();

export function encodeTableFilePropertyColumnKey(propertyName: string): string | null {
	return encodeFilePropertyColumnKey(propertyName);
}

export function decodeTableFilePropertyColumnKey(columnKey: string): string | null {
	return decodeFilePropertyColumnKey(columnKey);
}

export function isTableFilePropertyColumnKey(columnKey: string): boolean {
	return isFilePropertyColumnKey(columnKey);
}

export function mapObsidianPropertyTypeToTableType(type: ObsidianPropertyTypeId): FilterFieldType {
	switch (type) {
		case 'multitext':
		case 'aliases':
		case 'tags':
			return 'list';
		case 'number':
			return 'number';
		case 'checkbox':
			return 'checkbox';
		case 'date':
			return 'date';
		case 'datetime':
			return 'datetime';
		case 'text':
		case 'unknown':
		default:
			return 'text';
	}
}

export { loadPropertyTypeRegistry as loadTableFilePropertyTypesFromConfig } from '../../core/property-type-registry';

export function createCachedTableFilePropertyTypeResolver(
	initialTypes: Readonly<Record<string, ObsidianPropertyTypeId>> = {},
): CachedTableFilePropertyTypeResolver {
	let revision = 0;
	let types = { ...initialTypes };
	return {
		getRevision: () => revision,
		resolve(propertyName, samples) {
			const sourceType = types[propertyName] ?? inferObsidianPropertyType(samples);
			return {
				sourceType,
				tableType: mapObsidianPropertyTypeToTableType(sourceType),
			};
		},
		invalidate() {
			revision += 1;
		},
		replaceTypes(nextTypes) {
			const next = { ...nextTypes };
			if (JSON.stringify(types) === JSON.stringify(next)) return;
			types = next;
			revision += 1;
		},
	};
}

export function normalizeTableFilePropertyValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		return value
			.map(item => normalizeTableFilePropertyValue(item).trim())
			.filter(Boolean)
			.join('; ');
	}
	return '';
}

export function classifyTableFilePropertyCell(
	field: Pick<TableFilePropertyField, 'type'>,
	cell: Pick<TableFilePropertyCellValue, 'present' | 'rawValue'>,
): TableFilePropertyValueState {
	return classifyFilePropertyCell(field, cell);
}

export function isEmptyTableFilePropertyValue(value: unknown): boolean {
	return isEmptyFilePropertyValue(value);
}

/** Read all cached Markdown properties, including notes that are not Operon tasks. */
export function createVaultFilePropertySnapshot(
	app: App,
	typeResolver: TableFilePropertyTypeResolver,
	options: TableFilePropertySnapshotOptions = {},
): TableFilePropertySnapshot {
	const entries = app.vault.getMarkdownFiles().map(file => ({
		path: file.path,
		file,
		frontmatter: new Map(Object.entries(app.metadataCache.getFileCache(file)?.frontmatter ?? {})),
	}));
	return buildTableFilePropertySnapshot(entries, 0, 0, typeResolver.getRevision?.() ?? 0, typeResolver, options);
}

export function createTableFilePropertyIndex(
	app: App,
	options: CreateTableFilePropertyIndexOptions = {},
): TableFilePropertyIndex {
	const state: TableFilePropertyIndexState = {
		revision: 0,
		typeRevision: 0,
		dirtyPaths: new Set(),
		pathRevisions: new Map(),
		byPath: new Map(),
		derivedSnapshots: new Map(),
	};
	const typeResolver = options.typeResolver ?? createInferredTableFilePropertyTypeResolver();
	const snapshotLimit = normalizeSnapshotLimit(options.derivedSnapshotLimit);
 let sourceEpoch = 0;

	const invalidateDerivedSnapshots = (): void => {
		state.derivedSnapshots.clear();
	};

	const index: TableFilePropertyIndex = {
 getSourceRevision: path => `${sourceEpoch}:${state.pathRevisions.get(path) ?? 0}`,
		getSnapshot(tasks, indexGeneration, snapshotOptions = {}) {
			const filePaths = collectYamlTaskFilePaths(tasks);
			const rawMetadataRevisions = filePaths.map(path => [path, state.pathRevisions.get(path) ?? 0] as const);
			const optionSignature = buildSnapshotOptionsSignature(snapshotOptions);
			const resolverRevision = typeResolver.getRevision?.() ?? 0;
			const cacheKey = JSON.stringify({
				indexGeneration,
				rawMetadataRevisions,
				typeRevision: state.typeRevision,
				resolverRevision,
				optionSignature,
				filePaths,
			});
			const cached = state.derivedSnapshots.get(cacheKey);
			if (cached) {
				state.derivedSnapshots.delete(cacheKey);
				state.derivedSnapshots.set(cacheKey, cached);
				return cached;
			}

			const entries = filePaths
				.map(path => getOrBuildFileEntry(app, state, path))
				.filter((entry): entry is TableFilePropertyEntry => entry !== null);
			const snapshot = buildTableFilePropertySnapshot(
				entries,
				state.revision,
				state.typeRevision,
				resolverRevision,
				typeResolver,
				snapshotOptions,
			);
			state.derivedSnapshots.set(cacheKey, snapshot);
			trimSnapshotCache(state.derivedSnapshots, snapshotLimit);
			return snapshot;
		},
		invalidateFile(path) {
			const normalizedPath = path.trim();
			if (!normalizedPath) return;
			state.revision += 1;
			state.pathRevisions.set(normalizedPath, (state.pathRevisions.get(normalizedPath) ?? 0) + 1);
			state.dirtyPaths.add(normalizedPath);
		},
		removeFile(path) {
			const normalizedPath = path.trim();
			if (!normalizedPath) return;
			state.revision += 1;
			state.dirtyPaths.delete(normalizedPath);
			state.pathRevisions.set(normalizedPath, (state.pathRevisions.get(normalizedPath) ?? 0) + 1);
			state.byPath.delete(normalizedPath);
			invalidateDerivedSnapshots();
		},
		renameFile(oldPath, newPath) {
			const normalizedOldPath = oldPath.trim();
			const normalizedNewPath = newPath.trim();
			if (!normalizedOldPath && !normalizedNewPath) return;
			state.revision += 1;
			const hadOldEntry = normalizedOldPath ? state.byPath.has(normalizedOldPath) : false;
			if (normalizedOldPath) {
				state.dirtyPaths.delete(normalizedOldPath);
				state.pathRevisions.set(normalizedOldPath, (state.pathRevisions.get(normalizedOldPath) ?? 0) + 1);
				state.byPath.delete(normalizedOldPath);
			}
			if (normalizedNewPath) {
    state.pathRevisions.set(normalizedNewPath, (state.pathRevisions.get(normalizedNewPath) ?? 0) + 1);
    if (hadOldEntry) state.dirtyPaths.add(normalizedNewPath);
   }
			invalidateDerivedSnapshots();
		},
		invalidateTypes() {
			state.typeRevision += 1;
			typeResolver.invalidate?.();
			invalidateDerivedSnapshots();
		},
		applyMutation(path, propertyName, mutation) {
			const normalizedPath = path.trim();
			const existing = state.byPath.get(normalizedPath);
			if (!existing || !propertyName) {
				index.invalidateFile(normalizedPath);
				return;
			}
			const frontmatter = new Map(existing.frontmatter);
			if (mutation.kind === 'delete') frontmatter.delete(propertyName);
			else frontmatter.set(propertyName, mutation.value);
			state.byPath.set(normalizedPath, { ...existing, frontmatter });
			state.revision += 1;
			state.pathRevisions.set(normalizedPath, (state.pathRevisions.get(normalizedPath) ?? 0) + 1);
			state.dirtyPaths.delete(normalizedPath);
			invalidateDerivedSnapshots();
		},
		clear() {
   sourceEpoch += 1;
			state.revision += 1;
			state.typeRevision += 1;
			state.dirtyPaths.clear();
			state.pathRevisions.clear();
			state.byPath.clear();
			state.derivedSnapshots.clear();
		},
	};
	return index;
}

export function getTableFilePropertyIndex(
	app: App,
	options: CreateTableFilePropertyIndexOptions = {},
): TableFilePropertyIndex {
	const existing = tableFilePropertyIndexes.get(app);
	if (existing) return existing;
	const created = createTableFilePropertyIndex(app, options);
	tableFilePropertyIndexes.set(app, created);
	return created;
}

export function clearTableFilePropertyIndex(app: App): void {
	const existing = tableFilePropertyIndexes.get(app);
	existing?.clear();
	tableFilePropertyIndexes.delete(app);
}

function collectYamlTaskFilePaths(tasks: readonly IndexedTask[]): string[] {
	const paths = new Set<string>();
	for (const task of tasks) {
		if (task.primary.format !== 'yaml') continue;
		const path = task.primary.filePath.trim();
		if (path) paths.add(path);
	}
	return Array.from(paths).sort((left, right) => left.localeCompare(right));
}

function getOrBuildFileEntry(
	app: App,
	state: TableFilePropertyIndexState,
	path: string,
): TableFilePropertyEntry | null {
	const existing = state.byPath.get(path);
	if (existing && !state.dirtyPaths.has(path)) return existing;
	state.dirtyPaths.delete(path);
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) || file.extension !== 'md') {
		state.byPath.delete(path);
		return null;
	}
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const entry: TableFilePropertyEntry = {
		path,
		file,
		frontmatter: new Map(frontmatter ? Object.entries(frontmatter) : []),
	};
	state.byPath.set(path, entry);
	return entry;
}

function buildTableFilePropertySnapshot(
	entries: readonly TableFilePropertyEntry[],
	revision: number,
	typeRevision: number,
	resolverRevision: string | number,
	typeResolver: TableFilePropertyTypeResolver,
	options: TableFilePropertySnapshotOptions,
): TableFilePropertySnapshot {
	const excludedNames = buildExcludedPropertyNames(options);
	const samplesByProperty = new Map<string, unknown[]>();
	const sourcePathsByProperty = new Map<string, Set<string>>();
	for (const entry of entries) {
		for (const [propertyName, value] of entry.frontmatter) {
			if (isExcludedPropertyName(propertyName, excludedNames)) continue;
			const samples = samplesByProperty.get(propertyName) ?? [];
			samples.push(value);
			samplesByProperty.set(propertyName, samples);
			const sourcePaths = sourcePathsByProperty.get(propertyName) ?? new Set<string>();
			sourcePaths.add(entry.path);
			sourcePathsByProperty.set(propertyName, sourcePaths);
		}
	}

	const fields = Object.freeze(Array.from(samplesByProperty, ([propertyName, samples]) => {
		if (!samples.some(isSupportedTableFilePropertyValue)) return null;
		const key = encodeTableFilePropertyColumnKey(propertyName);
		if (!key) return null;
		const resolution = typeResolver.resolve(propertyName, samples);
		return {
			key,
			label: propertyName,
			type: resolution.tableType,
			group: 'fileProperty' as const,
			icon: getTableFilePropertyTypeIcon(resolution.tableType),
			readonly: false,
			aliases: [propertyName, key, `note.${propertyName}`],
			propertyName,
			sourceType: resolution.sourceType,
			sourceFileCount: sourcePathsByProperty.get(propertyName)?.size ?? 0,
		};
	}).filter((field): field is TableFilePropertyField => field !== null)
		.sort(compareTableFilePropertyFields)
		.map(field => {
			Object.freeze(field.aliases);
			return Object.freeze(field);
		}));
	const candidatesByProperty = new Map(Array.from(samplesByProperty, ([propertyName, samples]) => [
		propertyName,
		buildTableFilePropertyCandidates(samples, options.nativeListCandidates === true && fields.some(field => field.propertyName === propertyName && field.type === 'list')),
	] as const));

	const entriesByPath = new Map(entries.map(entry => [entry.path, entry] as const));
	const sourceHash = hashTableFilePropertyEntries(entries);
	const signature = JSON.stringify({
		revision,
		typeRevision,
		resolverRevision,
		optionSignature: buildSnapshotOptionsSignature(options),
		fileCount: entries.length,
		fieldCount: fields.length,
		sourceHash,
	});
	return Object.freeze({
		revision,
		signature,
		fields,
		getCell(task: IndexedTask, columnKey: string) {
			const propertyName = decodeTableFilePropertyColumnKey(columnKey);
			if (!propertyName || task.primary.format !== 'yaml') return emptyCellValue();
			const entry = entriesByPath.get(task.primary.filePath);
			if (!entry || !entry.frontmatter.has(propertyName)) return emptyCellValue();
			const rawValue = entry.frontmatter.get(propertyName);
			return {
				present: true,
				rawValue,
				normalizedValue: normalizeTableFilePropertyValue(rawValue),
			};
		},
		getCandidates(columnKey: string) {
			const propertyName = decodeTableFilePropertyColumnKey(columnKey);
			return propertyName ? (candidatesByProperty.get(propertyName) ?? []) : [];
		},
	});
}

function buildTableFilePropertyCandidates(samples: readonly unknown[], nativeList = false): readonly string[] {
	const frequencies = new Map<string, number>();
	const add = (value: RawYamlPropertyValue): void => {
		if (Array.isArray(value)) {
			for (const item of value) add(item);
			return;
		}
		if (value === null) return;
		if (nativeList && (typeof value !== 'string' && typeof value !== 'number' || typeof value === 'number' && !Number.isFinite(value))) return;
		const normalized = nativeList ? encodeVaultPropertyValue([value as string | number], 'list') : String(value).trim();
		if (!normalized) return;
		frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
	};
	for (const sample of samples) {
		if (isSupportedRawYamlPropertyValue(sample)) add(sample);
	}
	return Object.freeze(Array.from(frequencies)
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
		.slice(0, 500)
		.map(([value]) => value));
}

function buildExcludedPropertyNames(options: TableFilePropertySnapshotOptions): Set<string> {
	const excluded = new Set(DEFAULT_EXCLUDED_PROPERTY_NAMES);
	for (const canonical of CANONICAL_KEYS) {
		excluded.add(canonical.name);
		for (const alias of LEGACY_CANONICAL_KEY_ALIASES[canonical.name] ?? []) excluded.add(alias);
	}
	for (const mapping of options.keyMappings ?? []) {
		excluded.add(mapping.canonicalKey);
		const visiblePropertyName = mapping.visiblePropertyName?.trim();
		if (visiblePropertyName) excluded.add(visiblePropertyName);
	}
	for (const propertyName of options.excludePropertyNames ?? []) {
		if (propertyName) excluded.add(propertyName);
	}
	return excluded;
}

function isExcludedPropertyName(propertyName: string, excludedNames: ReadonlySet<string>): boolean {
	return !propertyName || !propertyName.trim() || propertyName.startsWith('_') || excludedNames.has(propertyName);
}

function createInferredTableFilePropertyTypeResolver(): TableFilePropertyTypeResolver {
	return {
		resolve(_propertyName, samples) {
			const sourceType = inferObsidianPropertyType(samples);
			return {
				sourceType,
				tableType: mapObsidianPropertyTypeToTableType(sourceType),
			};
		},
	};
}




function compareTableFilePropertyFields(left: TableFilePropertyField, right: TableFilePropertyField): number {
	const labelResult = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
	return labelResult !== 0 ? labelResult : left.propertyName.localeCompare(right.propertyName);
}

function buildSnapshotOptionsSignature(options: TableFilePropertySnapshotOptions): string {
	return JSON.stringify({
		keyMappings: (options.keyMappings ?? []).map(mapping => [
			mapping.canonicalKey,
			mapping.visiblePropertyName ?? '',
		]),
		excludePropertyNames: [...(options.excludePropertyNames ?? [])],
  ...(options.nativeListCandidates ? { nativeListCandidates: true } : {}),
	});
}

function hashTableFilePropertyEntries(entries: readonly TableFilePropertyEntry[]): string {
	let hash = 2166136261;
	const append = (value: string): void => {
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		hash ^= 31;
		hash = Math.imul(hash, 16777619);
	};
	for (const entry of entries) {
		append(entry.path);
		for (const [propertyName, value] of entry.frontmatter) {
			append(propertyName);
			append(stablePropertyValue(value));
		}
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function stablePropertyValue(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return '[unserializable]';
	}
}

function emptyCellValue(): TableFilePropertyCellValue {
	return { present: false, rawValue: undefined, normalizedValue: '' };
}

function normalizeSnapshotLimit(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DERIVED_SNAPSHOT_LIMIT;
	return Math.max(1, Math.floor(value));
}

function trimSnapshotCache(cache: Map<string, TableFilePropertySnapshot>, limit: number): void {
	while (cache.size > limit) {
		const oldestEntry = cache.keys().next();
		if (oldestEntry.done) return;
		cache.delete(oldestEntry.value);
	}
}

// Reuse the existing registry monitor; open editors subscribe without another poller.
const propertyTypeListeners = new WeakMap<App, Set<() => void>>();
export function subscribePropertyTypeChanges(app: App, listener: () => void): () => void {
 let listeners = propertyTypeListeners.get(app);
 if (!listeners) { listeners = new Set(); propertyTypeListeners.set(app, listeners); }
 listeners.add(listener);
 return () => { listeners.delete(listener); };
}
export function notifyPropertyTypeChanges(app: App): void {
 for (const listener of propertyTypeListeners.get(app) ?? []) listener();
}

const isSupportedTableFilePropertyValue = isSupportedRawYamlPropertyValue;

export function getTableFilePropertyTypeIcon(type: FilterFieldType): string {
	switch (type) {
		case 'list':
		case 'tags':
			return 'list';
		case 'number':
			return 'hash';
		case 'checkbox':
			return 'square-dashed';
		case 'date':
			return 'calendar';
		case 'datetime':
			return 'clock-3';
		case 'text':
		default:
			return 'text';
	}
}
