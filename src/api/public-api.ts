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

export function isOperonPublicAdoptInlineTaskInput(value: unknown): value is OperonPublicAdoptInlineTaskInput {
	return isRecord(value)
		&& typeof value.targetPath === 'string'
		&& typeof value.line === 'number'
		&& typeof value.expectedLine === 'string'
		&& hasOnlyOptionalStrings(value, ['statusId']);
}

export function isOperonPublicCreateTaskInput(value: unknown): value is OperonPublicCreateTaskInput {
	if (!isRecord(value) || (value.source !== 'inline' && value.source !== 'file') || typeof value.description !== 'string') return false;
	if (!hasOnlyOptionalStrings(value, ['statusId', 'fileTemplateId', 'targetDateKey', 'targetFolder', 'targetPath'])) return false;
	if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string'))) return false;
	if (value.fields !== undefined && !isStringRecord(value.fields)) return false;
	return value.properties === undefined || isRawPropertyRecord(value.properties);
}

export function isOperonPublicUpdateTaskInput(value: unknown): value is OperonPublicUpdateTaskInput {
	if (!isRecord(value) || !hasOnlyOptionalStrings(value, ['description'])) return false;
	if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every(tag => typeof tag === 'string'))) return false;
	if (value.fields !== undefined && !isStringRecord(value.fields)) return false;
	return value.properties === undefined || isRawPropertyRecord(value.properties);
}

export function isOperonPublicTransitionTaskInput(value: unknown): value is OperonPublicTransitionTaskInput {
	return isRecord(value) && hasOnlyOptionalStrings(value, ['status', 'statusId']);
}

export function isOperonPublicConvertTaskInput(value: unknown): value is OperonPublicConvertTaskInput {
	if (!isRecord(value)
		|| (value.target !== 'inline' && value.target !== 'file')
		|| !hasOnlyOptionalStrings(value, ['fileTemplateId', 'targetPath', 'targetFolder'])) return false;
	if (value.target === 'inline') {
		return typeof value.targetPath === 'string' && /\.md$/iu.test(value.targetPath.trim());
	}
	return true;
}

export function isOperonPublicFilterQueryInput(value: unknown): value is OperonPublicFilterQueryInput {
	return isRecord(value) && typeof value.filterSetId === 'string' && hasOnlyOptionalStrings(value, ['scopePath']);
}

export function isOperonPublicRelocateTaskInput(value: unknown): value is OperonPublicRelocateTaskInput {
	return isRecord(value) && typeof value.targetPath === 'string';
}

export interface PublicWritableKeyMapping {
	canonicalKey: string;
	sync: 'yes' | 'no' | 'auto';
	isInternal?: boolean;
}

/** Public mutations may write only explicitly synchronized, non-internal managed fields. */
export function isPublicManagedFieldWritable(
	key: string,
	mappings: readonly PublicWritableKeyMapping[],
): boolean {
	if (!key || key === 'operonId' || key === 'status' || key === '_checkbox') return false;
	const mapping = mappings.find(candidate => candidate.canonicalKey === key);
	return mapping?.sync === 'yes' && mapping.isInternal !== true;
}
