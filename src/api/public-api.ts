import { isReminderStorageKey } from '../types/keys';

export const OPERON_PUBLIC_API_VERSION = '1' as const;

export interface OperonPublicApiCapabilities {
	ready: boolean;
	adopt: boolean;
	create: boolean;
	update: boolean;
	transition: boolean;
	convert: boolean;
	filterQuery: boolean;
	relocate: boolean;
}

export interface OperonPublicMutationResult {
	ok: boolean;
	operonId: string | null;
	code: 'applied' | 'not-ready' | 'not-found' | 'invalid-input' | 'conflict' | 'rejected' | 'failed';
	message?: string;
}

export interface OperonPublicAdoptInlineTaskInput {
	targetPath: string;
	/** One-based source line, matching the public task projection. */
	line: number;
	/** Exact source-line precondition. Prevents adopting a stale or moved checkbox. */
	expectedLine: string;
	/** Optional stable configured status id. */
	statusId?: string;
}

export interface OperonPublicCreateTaskInput {
	source: 'inline' | 'file';
	description: string;
	/** Stable configured status id, independent from pipeline/status display language. */
	statusId?: string;
	tags?: string[];
	fields?: Record<string, string>;
	properties?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
	fileTemplateId?: string;
	targetDateKey?: string;
	targetFolder?: string;
	targetPath?: string;
}

export interface OperonPublicUpdateTaskInput {
	fields?: Record<string, string>;
	properties?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
	description?: string;
	tags?: string[];
}

export interface OperonPublicTransitionTaskInput {
	/** Exact configured `Pipeline.Status` value. */
	status?: string;
	/** Stable configured status id, independent from pipeline/status display language. */
	statusId?: string;
}

export interface OperonPublicConvertTaskInput {
	target: 'inline' | 'file';
	fileTemplateId?: string;
	targetPath?: string;
	targetFolder?: string;
}

export interface OperonPublicFilterQueryInput {
	filterSetId: string;
	/** Optional exact file or folder scope. Folder matching is segment-aware. */
	scopePath?: string;
}

export interface OperonPublicFilterQueryResult {
	ok: boolean;
	code: 'ok' | 'not-ready' | 'not-found' | 'invalid-input' | 'failed';
	operonIds: string[];
	message?: string;
}

export interface OperonPublicRelocateTaskInput {
	/** Target Markdown note. V1 supports inline-to-inline relocation only. */
	targetPath: string;
}

export interface OperonPublicApiV1 {
	version: typeof OPERON_PUBLIC_API_VERSION;
	capabilities(): OperonPublicApiCapabilities;
	adoptInlineTask(input: OperonPublicAdoptInlineTaskInput): Promise<OperonPublicMutationResult>;
	createTask(input: OperonPublicCreateTaskInput): Promise<OperonPublicMutationResult>;
	updateTask(operonId: string, input: OperonPublicUpdateTaskInput): Promise<OperonPublicMutationResult>;
	transitionTask(operonId: string, input: OperonPublicTransitionTaskInput): Promise<OperonPublicMutationResult>;
	convertTask(operonId: string, input: OperonPublicConvertTaskInput): Promise<OperonPublicMutationResult>;
	queryFilterSet(input: OperonPublicFilterQueryInput): Promise<OperonPublicFilterQueryResult>;
	relocateTask(operonId: string, input: OperonPublicRelocateTaskInput): Promise<OperonPublicMutationResult>;
}

type PublicRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PublicRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyOptionalStrings(value: PublicRecord, keys: readonly string[]): boolean {
	return keys.every(key => value[key] === undefined || typeof value[key] === 'string');
}

function hasOnlyKeys(value: PublicRecord, keys: readonly string[]): boolean {
	const allowed = new Set(keys);
	return Object.keys(value).every(key => allowed.has(key));
}

function isPublicDateKey(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isPublicVaultPath(value: unknown, options: { markdown: boolean; allowEmpty?: boolean }): value is string {
	if (typeof value !== 'string') return false;
	const normalized = value.trim();
	if (normalized !== value) return false;
	if (!normalized) return options.allowEmpty === true;
	if (/^[\\/]/u.test(normalized) || /^[a-zA-Z]:/u.test(normalized) || normalized.includes('\\')) return false;
	if (normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) return false;
	return !options.markdown || /\.md$/iu.test(normalized);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every(entry => typeof entry === 'string');
}

function isRawPropertyValue(value: unknown): boolean {
	return value === null
		|| typeof value === 'string'
		|| typeof value === 'number'
		|| typeof value === 'boolean'
		|| (Array.isArray(value) && value.every(entry => (
			entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
		)));
}

function isRawPropertyRecord(value: unknown): boolean {
	return isRecord(value) && Object.values(value).every(isRawPropertyValue);
}

function isPublicTagArray(value: unknown): value is string[] {
	return Array.isArray(value)
		&& value.every(entry => {
			if (typeof entry !== 'string' || /[\r\n]/u.test(entry)) return false;
			const normalized = entry.replace(/^#/, '').trim();
			return /^[a-zA-Z0-9_\-/]+$/u.test(normalized);
		});
}

/** Public descriptions must stay plain text so reparsing cannot create managed inline fields. */
export function isPublicTaskDescriptionSafe(value: unknown): value is string {
	return typeof value === 'string' && !/[\r\n]/u.test(value) && !value.includes('{{');
}

interface PublicDescriptionParseResult {
	description: string;
	tags: readonly string[];
	timePrefix: unknown;
	operonId: string | null;
	fields: readonly { key: string }[];
}

/** Inline descriptions must round-trip through the real parser without creating metadata. */
export function isPublicTaskDescriptionRoundTripSafe(
	value: unknown,
	parse: (line: string) => PublicDescriptionParseResult | null,
): value is string {
	if (!isPublicTaskDescriptionSafe(value) || !value || value !== value.trim()) return false;
	const probeOperonId = 'public-description-round-trip-probe';
	const parsed = parse(`- [ ] ${value} {{operonId:: ${probeOperonId}}}`);
	return parsed !== null
		&& parsed.operonId === probeOperonId
		&& parsed.description === value
		&& parsed.tags.length === 0
		&& parsed.timePrefix === null
		&& parsed.fields.every(field => field.key === 'operonId');
}

export function isOperonPublicAdoptInlineTaskInput(value: unknown): value is OperonPublicAdoptInlineTaskInput {
	return isRecord(value)
		&& hasOnlyKeys(value, ['targetPath', 'line', 'expectedLine', 'statusId'])
		&& isPublicVaultPath(value.targetPath, { markdown: true })
		&& typeof value.line === 'number'
		&& typeof value.expectedLine === 'string'
		&& hasOnlyOptionalStrings(value, ['statusId']);
}

export function isOperonPublicCreateTaskInput(value: unknown): value is OperonPublicCreateTaskInput {
	if (!isRecord(value) || (value.source !== 'inline' && value.source !== 'file')
		|| !isPublicTaskDescriptionSafe(value.description)) return false;
	if (!hasOnlyKeys(value, [
		'source', 'description', 'statusId', 'tags', 'fields', 'properties',
		'fileTemplateId', 'targetDateKey', 'targetFolder', 'targetPath',
	])) return false;
	if (!hasOnlyOptionalStrings(value, ['statusId', 'fileTemplateId', 'targetDateKey', 'targetFolder', 'targetPath'])) return false;
	if (value.targetDateKey !== undefined && !isPublicDateKey(value.targetDateKey)) return false;
	if (value.targetPath !== undefined && !isPublicVaultPath(value.targetPath, { markdown: true, allowEmpty: true })) return false;
	if (value.targetFolder !== undefined && !isPublicVaultPath(value.targetFolder, { markdown: false, allowEmpty: true })) return false;
	if (value.tags !== undefined && !isPublicTagArray(value.tags)) return false;
	if (value.fields !== undefined && !isStringRecord(value.fields)) return false;
	return value.properties === undefined || isRawPropertyRecord(value.properties);
}

export function isOperonPublicUpdateTaskInput(value: unknown): value is OperonPublicUpdateTaskInput {
	if (!isRecord(value) || !hasOnlyOptionalStrings(value, ['description'])) return false;
	if (!hasOnlyKeys(value, ['fields', 'properties', 'description', 'tags'])) return false;
	if (value.description !== undefined && !isPublicTaskDescriptionSafe(value.description)) return false;
	if (value.tags !== undefined && !isPublicTagArray(value.tags)) return false;
	if (value.fields !== undefined && !isStringRecord(value.fields)) return false;
	return value.properties === undefined || isRawPropertyRecord(value.properties);
}

export function isOperonPublicTransitionTaskInput(value: unknown): value is OperonPublicTransitionTaskInput {
	return isRecord(value)
		&& hasOnlyKeys(value, ['status', 'statusId'])
		&& hasOnlyOptionalStrings(value, ['status', 'statusId']);
}

export function isOperonPublicConvertTaskInput(value: unknown): value is OperonPublicConvertTaskInput {
	if (!isRecord(value)
		|| (value.target !== 'inline' && value.target !== 'file')
		|| !hasOnlyKeys(value, ['target', 'fileTemplateId', 'targetPath', 'targetFolder'])
		|| !hasOnlyOptionalStrings(value, ['fileTemplateId', 'targetPath', 'targetFolder'])) return false;
	if (value.target === 'inline') {
		return isPublicVaultPath(value.targetPath, { markdown: true })
			&& value.fileTemplateId === undefined
			&& value.targetFolder === undefined;
	}
	return value.targetPath === undefined
		&& (value.targetFolder === undefined || isPublicVaultPath(value.targetFolder, { markdown: false, allowEmpty: true }));
}

export function isOperonPublicFilterQueryInput(value: unknown): value is OperonPublicFilterQueryInput {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, ['filterSetId', 'scopePath'])
		|| typeof value.filterSetId !== 'string'
		|| !hasOnlyOptionalStrings(value, ['scopePath'])) return false;
	return value.scopePath === undefined || isPublicVaultPath(value.scopePath, { markdown: false, allowEmpty: true });
}

/** Keep public saved-filter queries aligned with the contexts used by Operon's UI surfaces. */
export function buildOperonPublicFilterEvaluationOptions<TTask, TProjectSerialScope, TFilePropertyContext>(
	allTasks: readonly TTask[],
	projectSerialScopes: readonly TProjectSerialScope[],
	filePropertyContext: TFilePropertyContext | null | undefined,
): {
	projectSerialScopes: readonly TProjectSerialScope[];
	projectSerialScopeTasks: readonly TTask[];
	filePropertyContext?: TFilePropertyContext;
} {
	return {
		projectSerialScopes,
		projectSerialScopeTasks: allTasks,
		...(filePropertyContext ? { filePropertyContext } : {}),
	};
}

export function isOperonPublicRelocateTaskInput(value: unknown): value is OperonPublicRelocateTaskInput {
	return isRecord(value)
		&& hasOnlyKeys(value, ['targetPath'])
		&& isPublicVaultPath(value.targetPath, { markdown: true });
}

export interface PublicWritableKeyMapping {
	canonicalKey: string;
	sync: 'yes' | 'no' | 'auto';
	isSystem?: boolean;
	isInternal?: boolean;
}

/** Fields whose invariants are owned by transitionTask rather than generic field writes. */
export function isPublicTransitionOwnedField(key: string): boolean {
	return key === 'status' || key === 'dateCompleted' || key === 'dateCancelled';
}

/** Creation and adoption seed only open workflow states; terminal invariants belong to transitionTask. */
export function isPublicInitialWorkflowStateAllowed(checkbox: 'open' | 'done' | 'cancelled'): boolean {
	return checkbox === 'open';
}

/** Initial create/adopt state must not smuggle terminal workflow metadata around transitionTask. */
export function isPublicInitialTaskStateAllowed(input: {
	checkbox: 'open' | 'done' | 'cancelled';
	statusCheckbox?: 'open' | 'done' | 'cancelled' | null;
	dateCompleted?: string;
	dateCancelled?: string;
}): boolean {
	return isPublicInitialWorkflowStateAllowed(input.checkbox)
		&& (!input.statusCheckbox || isPublicInitialWorkflowStateAllowed(input.statusCheckbox))
		&& !input.dateCompleted?.trim()
		&& !input.dateCancelled?.trim();
}

/** Public mutations may write only explicitly synchronized, non-internal managed fields. */
export function isPublicManagedFieldWritable(
	key: string,
	mappings: readonly PublicWritableKeyMapping[],
	isEditableField: (key: string) => boolean,
): boolean {
	if (!key || key === 'operonId' || key === '_checkbox' || isPublicTransitionOwnedField(key)) return false;
	const mapping = mappings.find(candidate => candidate.canonicalKey === key);
	return mapping?.sync === 'yes'
		&& mapping.isInternal !== true
		&& (isEditableField(key) || (mapping.isSystem === true && isReminderStorageKey(key)));
}
