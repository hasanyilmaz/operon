import { writeJsonSafely, writeTextSafely } from '../storage/storage-file-ops';
import { isRetiredKeyMapping, type KeyMapping } from '../types/settings';

export const OPERON_DOCS_PACKAGE_ID = 'operon-docs';
export const OPERON_DOCS_SCHEMA_VERSION = 1;
export const OPERON_DOCS_TARGET_ROOT = 'Operon/Docs';
export const OPERON_DOCS_MANIFEST_URL = 'https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/operon-docs/manifest.json';
export const OPERON_DOCS_RAW_BASE_URL = 'https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/operon-docs';

const DOCS_SYNC_STATE_VERSION = 1;
const DOCS_SYNC_STATE_FILE_NAME = 'docs-sync.json';
const MANAGED_DOC_PATH_RE = /^DOCS-\d{3} .+\.md$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const LOCALIZATION_SIGNATURE_VERSION = 1;
const OPERON_DOCS_SOURCE_KEY_TO_CANONICAL: Record<string, string> = {
	Up: 'contexts',
	Notes: 'note',
	Icon: 'taskIcon',
	Color: 'taskColor',
	Updated: 'datetimeModified',
	tags: 'tags',
};
const OPERON_DOCS_SOURCE_KEYS = Object.keys(OPERON_DOCS_SOURCE_KEY_TO_CANONICAL).sort((left, right) => left.localeCompare(right, 'en'));

export interface OperonDocsAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	process?: (path: string, fn: (data: string) => string) => Promise<string>;
	rename?: (oldPath: string, newPath: string) => Promise<void>;
}

export interface OperonDocsVaultLike {
	configDir: string;
	adapter: OperonDocsAdapter;
}

export interface OperonDocsAppLike {
	vault: OperonDocsVaultLike;
}

export type OperonDocsRequestText = (url: string) => Promise<string>;
export type OperonDocsHashText = (text: string) => Promise<string>;

export interface OperonDocsManifestSource {
	branch: string;
	docsBasePath: string;
	mediaBasePath: string;
}

export interface OperonDocsManifestFile {
	path: string;
	sha256: string;
	bytes: number;
}

export interface OperonDocsManifest {
	schemaVersion: typeof OPERON_DOCS_SCHEMA_VERSION;
	packageId: typeof OPERON_DOCS_PACKAGE_ID;
	generatedAt: string;
	source: OperonDocsManifestSource;
	files: OperonDocsManifestFile[];
}

export interface OperonDocsSyncStateEntry {
	path: string;
	targetPath: string;
	sourceSha256: string;
	sourceBytes: number;
	localSha256: string;
	localBytes: number;
	localizationSignature: string;
	writtenAt: string;
}

export interface OperonDocsSyncState {
	version: typeof DOCS_SYNC_STATE_VERSION;
	packageId: typeof OPERON_DOCS_PACKAGE_ID;
	lastSyncedAt: string | null;
	lastManifestGeneratedAt: string | null;
	manifestFileCount: number;
	localizationSignature: string;
	files: Record<string, OperonDocsSyncStateEntry>;
	staleManagedFiles: string[];
}

export type OperonDocsSyncWriteReason = 'missing' | 'local-edited' | 'remote-updated';

export interface OperonDocsSyncedFile {
	path: string;
	targetPath: string;
	sha256: string;
	bytes: number;
	reason: OperonDocsSyncWriteReason;
}

export interface OperonDocsSkippedFile {
	path: string;
	targetPath: string;
	sha256: string;
	bytes: number;
}

export type OperonDocsSyncWarningReason = 'frontmatter-key-collision';

export interface OperonDocsSyncWarning {
	path: string;
	reason: OperonDocsSyncWarningReason;
	sourceKey: string;
	canonicalKey: string;
	preferredKey: string;
	fallbackKey: string;
	message: string;
}

export interface OperonDocsSyncResult {
	status: 'success';
	manifestGeneratedAt: string;
	manifestFileCount: number;
	targetRoot: string;
	statePath: string;
	localizationSignature: string;
	written: OperonDocsSyncedFile[];
	skipped: OperonDocsSkippedFile[];
	staleManagedFiles: string[];
	warnings: OperonDocsSyncWarning[];
}

export interface OperonDocsFolderMovePreview {
	oldRoot: string;
	newRoot: string;
	statePath: string;
	files: Array<{
		path: string;
		sourcePath: string;
		targetPath: string;
	}>;
	stateFilePaths: string[];
}

export interface OperonDocsFolderMoveTransaction {
	movedFiles: readonly OperonDocsFolderMovePreview['files'][number][];
	rollback: () => Promise<void>;
}

export interface SyncOperonDocsOptions {
	app: OperonDocsAppLike;
	requestText: OperonDocsRequestText;
	keyMappings?: readonly KeyMapping[];
	hashText?: OperonDocsHashText;
	now?: () => Date;
	targetRoot?: string;
	pluginId?: string;
	statePath?: string;
	manifestUrl?: string;
	rawBaseUrl?: string;
}

interface PlannedWrite {
	file: OperonDocsManifestFile;
	targetPath: string;
	reason: OperonDocsSyncWriteReason;
	content: string;
	sha256: string;
	bytes: number;
}

interface LocalFileSnapshot {
	exists: boolean;
	sha256: string | null;
	bytes: number;
}

export async function syncOperonDocs(options: SyncOperonDocsOptions): Promise<OperonDocsSyncResult> {
	const adapter = options.app.vault.adapter;
	const now = (options.now ?? (() => new Date()))().toISOString();
	const targetRoot = normalizeVaultPath(options.targetRoot ?? OPERON_DOCS_TARGET_ROOT);
	if (!targetRoot) {
		throw new Error('Operon docs sync target root must not be empty');
	}
	const statePath = normalizeVaultPath(options.statePath ?? buildOperonDocsSyncStatePath(options.app.vault.configDir, options.pluginId));
	const rawBaseUrl = (options.rawBaseUrl ?? OPERON_DOCS_RAW_BASE_URL).replace(/\/+$/u, '');
	const hashText = options.hashText ?? hashTextSha256;
	const keyMappings = options.keyMappings ?? [];
	const localizationSignature = buildOperonDocsLocalizationSignature(keyMappings);

	const manifestText = await options.requestText(options.manifestUrl ?? OPERON_DOCS_MANIFEST_URL);
	const manifest = parseOperonDocsManifest(manifestText);
	const state = await readOperonDocsSyncState(adapter, statePath);
	const remotePaths = new Set(manifest.files.map(file => file.path));
	const staleManagedFiles = Object.keys(state.files)
		.filter(path => !remotePaths.has(path))
		.sort((left, right) => left.localeCompare(right, 'en'));
	const written: OperonDocsSyncedFile[] = [];
	const skipped: OperonDocsSkippedFile[] = [];
	const warnings: OperonDocsSyncWarning[] = [];
	const plannedWrites: PlannedWrite[] = [];
	const nextFiles: Record<string, OperonDocsSyncStateEntry> = { ...state.files };

	for (const file of manifest.files) {
		const targetPath = buildTargetPath(targetRoot, file.path);
		const previousEntry = state.files[file.path] ?? null;
		const expectedLocalSha = previousEntry?.sourceSha256 === file.sha256
			&& previousEntry.localizationSignature === localizationSignature
			? previousEntry.localSha256
			: null;
		const local = await readLocalFileSnapshot(adapter, targetPath, hashText);
		const needsWrite = !local.exists || !expectedLocalSha || local.sha256 !== expectedLocalSha;

			if (!needsWrite) {
				const localSha256 = local.sha256 ?? file.sha256;
				nextFiles[file.path] = buildStateEntry({
					file,
					targetPath,
					localSha256,
					localBytes: local.bytes,
					localizationSignature,
					writtenAt: previousEntry?.writtenAt ?? now,
				});
			skipped.push({
				path: file.path,
				targetPath,
				sha256: localSha256,
				bytes: local.bytes,
			});
			continue;
		}

		const reason = resolveWriteReason(local, previousEntry, file);
		const sourceContent = await options.requestText(buildOperonDocsRawFileUrl(file.path, rawBaseUrl));
		const sourceSha256 = await hashText(sourceContent);
		const sourceBytes = getUtf8ByteLength(sourceContent);
		if (sourceSha256 !== file.sha256) {
			throw new Error(`Operon docs sync hash mismatch for ${file.path}: expected ${file.sha256}, received ${sourceSha256}`);
		}
		if (sourceBytes !== file.bytes) {
			throw new Error(`Operon docs sync byte mismatch for ${file.path}: expected ${file.bytes}, received ${sourceBytes}`);
		}
		const localized = localizeOperonDocsFrontmatter(sourceContent, keyMappings, file.path);
		const localSha256 = await hashText(localized.content);
		const localBytes = getUtf8ByteLength(localized.content);
		warnings.push(...localized.warnings);
		plannedWrites.push({
			file,
			targetPath,
			reason,
			content: localized.content,
			sha256: localSha256,
			bytes: localBytes,
		});
	}

	for (const planned of plannedWrites) {
		await ensureParentFolderPath(adapter, planned.targetPath);
		await writeTextSafely(adapter, planned.targetPath, planned.content);
		nextFiles[planned.file.path] = buildStateEntry({
			file: planned.file,
			targetPath: planned.targetPath,
			localSha256: planned.sha256,
			localBytes: planned.bytes,
			localizationSignature,
			writtenAt: now,
		});
		written.push({
			path: planned.file.path,
			targetPath: planned.targetPath,
			sha256: planned.sha256,
			bytes: planned.bytes,
			reason: planned.reason,
		});
	}

	const nextState: OperonDocsSyncState = {
		version: DOCS_SYNC_STATE_VERSION,
		packageId: OPERON_DOCS_PACKAGE_ID,
		lastSyncedAt: now,
		lastManifestGeneratedAt: manifest.generatedAt,
		manifestFileCount: manifest.files.length,
		localizationSignature,
		files: sortStateFiles(nextFiles),
		staleManagedFiles,
	};
	await ensureParentFolderPath(adapter, statePath);
	await writeJsonSafely(adapter, statePath, nextState);

	return {
		status: 'success',
		manifestGeneratedAt: manifest.generatedAt,
		manifestFileCount: manifest.files.length,
		targetRoot,
		statePath,
		localizationSignature,
		written,
		skipped,
		staleManagedFiles,
		warnings,
	};
}

/**
 * Finds only docs that this plugin previously recorded as managed at the
 * configured root. Personal files and untracked DOCS-looking files are never
 * candidates for a destination change.
 */
export async function previewOperonDocsFolderMove(options: {
	app: OperonDocsAppLike;
	oldRoot: string;
	newRoot: string;
	pluginId?: string;
	statePath?: string;
}): Promise<OperonDocsFolderMovePreview> {
	const oldRoot = normalizeVaultPath(options.oldRoot);
	const newRoot = normalizeVaultPath(options.newRoot);
	if (!oldRoot || !newRoot) {
		throw new Error('Operon docs folder must not be empty');
	}
	const adapter = options.app.vault.adapter;
	const statePath = normalizeVaultPath(options.statePath ?? buildOperonDocsSyncStatePath(options.app.vault.configDir, options.pluginId));
	const state = await readOperonDocsSyncState(adapter, statePath);
	const files: OperonDocsFolderMovePreview['files'] = [];
	const stateFilePaths: string[] = [];

	for (const [path, entry] of Object.entries(state.files)) {
		const sourcePath = buildTargetPath(oldRoot, path);
		if (entry.targetPath !== sourcePath) continue;
		stateFilePaths.push(path);
		if (!(await adapter.exists(sourcePath))) continue;
		files.push({
			path,
			sourcePath,
			targetPath: buildTargetPath(newRoot, path),
		});
	}

	files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	stateFilePaths.sort((left, right) => left.localeCompare(right, 'en'));
	return { oldRoot, newRoot, statePath, files, stateFilePaths };
}

/**
 * Moves a preflighted set of managed docs and rewrites their recorded paths.
 * The returned rollback function is used if the settings write that follows
 * this relocation cannot be committed.
 */
export async function moveOperonDocsFolder(
	options: { app: OperonDocsAppLike },
	preview: OperonDocsFolderMovePreview,
): Promise<OperonDocsFolderMoveTransaction> {
	const adapter = options.app.vault.adapter;
	if (typeof adapter.rename !== 'function') {
		throw new Error('Operon docs folder move is unavailable in this vault');
	}

	for (const file of preview.files) {
		if (await adapter.exists(file.targetPath)) {
			throw new Error(`Operon docs destination conflict: ${file.targetPath}`);
		}
	}

	const stateRaw = await adapter.exists(preview.statePath)
		? await adapter.read(preview.statePath)
		: null;
	const state = await readOperonDocsSyncState(adapter, preview.statePath);
	const nextState: OperonDocsSyncState = {
		...state,
		files: { ...state.files },
	};
	for (const path of preview.stateFilePaths) {
		const entry = nextState.files[path];
		if (!entry) continue;
		nextState.files[path] = {
			...entry,
			targetPath: buildTargetPath(preview.newRoot, path),
		};
	}
	nextState.files = sortStateFiles(nextState.files);

	const movedFiles: OperonDocsFolderMovePreview['files'] = [];
	const rollback = async (): Promise<void> => {
		let rollbackError: Error | null = null;
		for (const file of [...movedFiles].reverse()) {
			try {
				if (await adapter.exists(file.targetPath) && !(await adapter.exists(file.sourcePath))) {
					await adapter.rename!(file.targetPath, file.sourcePath);
				}
			} catch (error) {
				rollbackError ??= error instanceof Error ? error : new Error(String(error));
			}
		}
		try {
			if (stateRaw !== null) {
				await writeTextSafely(adapter, preview.statePath, stateRaw);
			}
		} catch (error) {
			rollbackError ??= error instanceof Error ? error : new Error(String(error));
		}
		if (rollbackError) throw rollbackError;
	};

	try {
		for (const file of preview.files) {
			await adapter.rename(file.sourcePath, file.targetPath);
			movedFiles.push(file);
		}
		await writeTextSafely(adapter, preview.statePath, JSON.stringify(nextState, null, '\t'));
	} catch (error) {
		try {
			await rollback();
		} catch (rollbackError) {
			console.error('Operon docs folder move rollback failed', rollbackError);
		}
		throw error;
	}

	return { movedFiles, rollback };
}

export function buildOperonDocsRawFileUrl(path: string, rawBaseUrl = OPERON_DOCS_RAW_BASE_URL): string {
	return `${rawBaseUrl.replace(/\/+$/u, '')}/${encodeURIComponent(path)}`;
}

export function buildOperonDocsSyncStatePath(configDir: string, pluginId = 'operon'): string {
	return joinVaultPath(configDir, 'plugins', pluginId, 'state', DOCS_SYNC_STATE_FILE_NAME);
}

export function buildOperonDocsLocalizationSignature(keyMappings: readonly KeyMapping[] = []): string {
	const parts = OPERON_DOCS_SOURCE_KEYS.map(sourceKey => {
		const canonicalKey = OPERON_DOCS_SOURCE_KEY_TO_CANONICAL[sourceKey];
		const targetKey = resolveTargetFrontmatterKey(canonicalKey, keyMappings);
		return `${sourceKey}:${targetKey}`;
	});
	return `v${LOCALIZATION_SIGNATURE_VERSION}|${parts.join('|')}`;
}

export function localizeOperonDocsFrontmatter(
	content: string,
	keyMappings: readonly KeyMapping[] = [],
	path = '',
): { content: string; warnings: OperonDocsSyncWarning[] } {
	const frontmatter = splitLeadingFrontmatter(content);
	if (!frontmatter) {
		return { content, warnings: [] };
	}
	const warnings: OperonDocsSyncWarning[] = [];
	const lineParts = splitPreservingNewlines(frontmatter.body);
	const topLevelKeys = collectTopLevelYamlKeys(lineParts);
	const usedKeys = new Set<string>();
	const localizedParts = lineParts.map(part => {
		if (part.isNewline) return part.value;
		const sourceKey = getTopLevelYamlKey(part.value);
		if (!sourceKey) return part.value;
		const canonicalKey = OPERON_DOCS_SOURCE_KEY_TO_CANONICAL[sourceKey];
		if (!canonicalKey) {
			usedKeys.add(sourceKey);
			return part.value;
		}
		const preferredKey = resolveTargetFrontmatterKey(canonicalKey, keyMappings);
		const resolved = resolveCollisionSafeFrontmatterKey({
			path,
			sourceKey,
			canonicalKey,
			preferredKey,
			topLevelKeys,
			usedKeys,
		});
		usedKeys.add(resolved.key);
		if (resolved.warning) warnings.push(resolved.warning);
		return `${resolved.key}${part.value.slice(sourceKey.length)}`;
	});
	return {
		content: `${frontmatter.open}${localizedParts.join('')}${frontmatter.closeAndBody}`,
		warnings,
	};
}

export function parseOperonDocsManifest(raw: string): OperonDocsManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		throw new Error('Operon docs manifest is not valid JSON');
	}
	if (!isRecord(parsed)) {
		throw new Error('Operon docs manifest must be an object');
	}
	if (parsed.schemaVersion !== OPERON_DOCS_SCHEMA_VERSION) {
		throw new Error(`Unsupported Operon docs manifest schemaVersion: ${String(parsed.schemaVersion)}`);
	}
	if (parsed.packageId !== OPERON_DOCS_PACKAGE_ID) {
		throw new Error(`Unsupported Operon docs packageId: ${String(parsed.packageId)}`);
	}
	if (typeof parsed.generatedAt !== 'string' || !parsed.generatedAt.trim()) {
		throw new Error('Operon docs manifest generatedAt must be a non-empty string');
	}
	const source = parseManifestSource(parsed.source);
	const files = parseManifestFiles(parsed.files);
	return {
		schemaVersion: OPERON_DOCS_SCHEMA_VERSION,
		packageId: OPERON_DOCS_PACKAGE_ID,
		generatedAt: parsed.generatedAt,
		source,
		files,
	};
}

export async function hashTextSha256(text: string): Promise<string> {
	const cryptoApi = window.crypto;
	if (!cryptoApi?.subtle) {
		throw new Error('Web Crypto SHA-256 is not available');
	}
	const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return bytesToHex(new Uint8Array(digest));
}

function parseManifestSource(raw: unknown): OperonDocsManifestSource {
	if (!isRecord(raw)) {
		throw new Error('Operon docs manifest source must be an object');
	}
	const branch = requireNonEmptyString(raw.branch, 'source.branch');
	const docsBasePath = requireNonEmptyString(raw.docsBasePath, 'source.docsBasePath');
	const mediaBasePath = requireNonEmptyString(raw.mediaBasePath, 'source.mediaBasePath');
	return { branch, docsBasePath, mediaBasePath };
}

function parseManifestFiles(raw: unknown): OperonDocsManifestFile[] {
	if (!Array.isArray(raw)) {
		throw new Error('Operon docs manifest files must be an array');
	}
	if (raw.length === 0) {
		throw new Error('Operon docs manifest files must not be empty');
	}
	const seen = new Set<string>();
	const files: OperonDocsManifestFile[] = [];
	for (const entry of raw) {
		if (!isRecord(entry)) {
			throw new Error('Operon docs manifest file entry must be an object');
		}
		const path = requireNonEmptyString(entry.path, 'files[].path');
		validateManagedDocPath(path);
		if (seen.has(path)) {
			throw new Error(`Duplicate Operon docs manifest path: ${path}`);
		}
		seen.add(path);
		const sha256 = requireNonEmptyString(entry.sha256, `files[${path}].sha256`);
		if (!SHA256_RE.test(sha256)) {
			throw new Error(`Invalid Operon docs manifest sha256 for ${path}`);
		}
		const bytes = entry.bytes;
		if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) {
			throw new Error(`Invalid Operon docs manifest byte count for ${path}`);
		}
		files.push({ path, sha256, bytes });
	}
	return files;
}

function validateManagedDocPath(path: string): void {
	if (!MANAGED_DOC_PATH_RE.test(path)) {
		throw new Error(`Unsafe Operon docs manifest path: ${path}`);
	}
	if (path.includes('/') || path.includes('\\') || hasControlCharacter(path)) {
		throw new Error(`Unsafe Operon docs manifest path: ${path}`);
	}
	if (normalizeVaultPath(path) !== path) {
		throw new Error(`Unsafe Operon docs manifest path: ${path}`);
	}
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Operon docs manifest ${label} must be a non-empty string`);
	}
	return value;
}

interface LeadingFrontmatter {
	open: string;
	body: string;
	closeAndBody: string;
}

interface FrontmatterLinePart {
	value: string;
	isNewline: boolean;
}

interface ResolveCollisionSafeFrontmatterKeyOptions {
	path: string;
	sourceKey: string;
	canonicalKey: string;
	preferredKey: string;
	topLevelKeys: Map<string, number>;
	usedKeys: Set<string>;
}

function splitLeadingFrontmatter(content: string): LeadingFrontmatter | null {
	const openMatch = content.match(/^---(\r?\n)/u);
	if (!openMatch) return null;
	const open = openMatch[0];
	const closingPattern = `${openMatch[1]}---`;
	const closingIndex = content.indexOf(closingPattern, open.length);
	if (closingIndex < 0) return null;
	return {
		open,
		body: content.slice(open.length, closingIndex),
		closeAndBody: content.slice(closingIndex),
	};
}

function splitPreservingNewlines(value: string): FrontmatterLinePart[] {
	const chunks = value.split(/(\r?\n)/u);
	return chunks
		.filter(chunk => chunk.length > 0)
		.map(chunk => ({
			value: chunk,
			isNewline: chunk === '\n' || chunk === '\r\n',
		}));
}

function collectTopLevelYamlKeys(parts: FrontmatterLinePart[]): Map<string, number> {
	const keys = new Map<string, number>();
	for (const part of parts) {
		if (part.isNewline) continue;
		const key = getTopLevelYamlKey(part.value);
		if (!key) continue;
		keys.set(key, (keys.get(key) ?? 0) + 1);
	}
	return keys;
}

function getTopLevelYamlKey(line: string): string | null {
	if (!line || line.startsWith(' ') || line.startsWith('\t') || line.startsWith('#')) return null;
	const match = line.match(/^([^:#][^:]*):(?=\s|$)/u);
	return match ? match[1] : null;
}

function resolveTargetFrontmatterKey(canonicalKey: string, keyMappings: readonly KeyMapping[]): string {
	if (canonicalKey === 'tags') return 'tags';
	for (const mapping of keyMappings) {
		if (isRetiredKeyMapping(mapping.canonicalKey)) continue;
		if (mapping.canonicalKey !== canonicalKey) continue;
		const visiblePropertyName = mapping.visiblePropertyName.trim();
		return visiblePropertyName || canonicalKey;
	}
	return canonicalKey;
}

function resolveCollisionSafeFrontmatterKey(options: ResolveCollisionSafeFrontmatterKeyOptions): {
	key: string;
	warning: OperonDocsSyncWarning | null;
} {
	if (!hasFrontmatterKeyCollision(options.sourceKey, options.preferredKey, options.topLevelKeys, options.usedKeys)) {
		return { key: options.preferredKey, warning: null };
	}
	if (!hasFrontmatterKeyCollision(options.sourceKey, options.canonicalKey, options.topLevelKeys, options.usedKeys)) {
		return { key: options.canonicalKey, warning: null };
	}
	return {
		key: options.sourceKey,
		warning: {
			path: options.path,
			reason: 'frontmatter-key-collision',
			sourceKey: options.sourceKey,
			canonicalKey: options.canonicalKey,
			preferredKey: options.preferredKey,
			fallbackKey: options.sourceKey,
			message: `Kept source frontmatter key "${options.sourceKey}" because both "${options.preferredKey}" and "${options.canonicalKey}" already exist in the document frontmatter.`,
		},
	};
}

function hasFrontmatterKeyCollision(
	sourceKey: string,
	candidateKey: string,
	topLevelKeys: Map<string, number>,
	usedKeys: Set<string>,
): boolean {
	if (candidateKey === sourceKey) return usedKeys.has(candidateKey);
	if (usedKeys.has(candidateKey)) return true;
	return (topLevelKeys.get(candidateKey) ?? 0) > 0;
}

async function readOperonDocsSyncState(
	adapter: OperonDocsAdapter,
	statePath: string,
): Promise<OperonDocsSyncState> {
	if (!(await adapter.exists(statePath))) {
		return emptyState();
	}
	try {
		const raw = await adapter.read(statePath);
		const parsed = JSON.parse(raw) as unknown;
		return normalizeState(parsed);
	} catch {
		return emptyState();
	}
}

function normalizeState(raw: unknown): OperonDocsSyncState {
	if (!isRecord(raw) || raw.version !== DOCS_SYNC_STATE_VERSION || raw.packageId !== OPERON_DOCS_PACKAGE_ID) {
		return emptyState();
	}
	const files: Record<string, OperonDocsSyncStateEntry> = {};
	if (isRecord(raw.files)) {
		for (const [path, entry] of Object.entries(raw.files)) {
			const normalized = normalizeStateEntry(path, entry);
			if (normalized) {
				files[path] = normalized;
			}
		}
	}
	const staleManagedFiles = Array.isArray(raw.staleManagedFiles)
		? raw.staleManagedFiles
			.filter((path): path is string => typeof path === 'string' && MANAGED_DOC_PATH_RE.test(path))
			.sort((left, right) => left.localeCompare(right, 'en'))
		: [];
	return {
		version: DOCS_SYNC_STATE_VERSION,
		packageId: OPERON_DOCS_PACKAGE_ID,
		lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null,
		lastManifestGeneratedAt: typeof raw.lastManifestGeneratedAt === 'string' ? raw.lastManifestGeneratedAt : null,
		manifestFileCount: typeof raw.manifestFileCount === 'number' && Number.isInteger(raw.manifestFileCount) && raw.manifestFileCount >= 0
			? raw.manifestFileCount
			: Object.keys(files).length,
		localizationSignature: typeof raw.localizationSignature === 'string' ? raw.localizationSignature : '',
		files: sortStateFiles(files),
		staleManagedFiles,
	};
}

function normalizeStateEntry(path: string, raw: unknown): OperonDocsSyncStateEntry | null {
	if (!MANAGED_DOC_PATH_RE.test(path) || !isRecord(raw)) return null;
	const targetPath = typeof raw.targetPath === 'string' ? normalizeVaultPath(raw.targetPath) : '';
	const sourceSha256 = typeof raw.sourceSha256 === 'string' && SHA256_RE.test(raw.sourceSha256) ? raw.sourceSha256 : '';
	const localSha256 = typeof raw.localSha256 === 'string' && SHA256_RE.test(raw.localSha256) ? raw.localSha256 : '';
	const sourceBytes = typeof raw.sourceBytes === 'number' && Number.isInteger(raw.sourceBytes) && raw.sourceBytes >= 0 ? raw.sourceBytes : -1;
	const localBytes = typeof raw.localBytes === 'number' && Number.isInteger(raw.localBytes) && raw.localBytes >= 0 ? raw.localBytes : -1;
	const localizationSignature = typeof raw.localizationSignature === 'string' ? raw.localizationSignature : '';
	const writtenAt = typeof raw.writtenAt === 'string' ? raw.writtenAt : '';
	if (!targetPath || !sourceSha256 || !localSha256 || sourceBytes < 0 || localBytes < 0 || !writtenAt) return null;
	return {
		path,
		targetPath,
		sourceSha256,
		sourceBytes,
		localSha256,
		localBytes,
		localizationSignature,
		writtenAt,
	};
}

function emptyState(): OperonDocsSyncState {
	return {
		version: DOCS_SYNC_STATE_VERSION,
		packageId: OPERON_DOCS_PACKAGE_ID,
		lastSyncedAt: null,
		lastManifestGeneratedAt: null,
		manifestFileCount: 0,
		localizationSignature: '',
		files: {},
		staleManagedFiles: [],
	};
}

function buildStateEntry(options: {
	file: OperonDocsManifestFile;
	targetPath: string;
	localSha256: string;
	localBytes: number;
	localizationSignature: string;
	writtenAt: string;
}): OperonDocsSyncStateEntry {
	return {
		path: options.file.path,
		targetPath: options.targetPath,
		sourceSha256: options.file.sha256,
		sourceBytes: options.file.bytes,
		localSha256: options.localSha256,
		localBytes: options.localBytes,
		localizationSignature: options.localizationSignature,
		writtenAt: options.writtenAt,
	};
}

function resolveWriteReason(
	local: LocalFileSnapshot,
	previousEntry: OperonDocsSyncStateEntry | null,
	file: OperonDocsManifestFile,
): OperonDocsSyncWriteReason {
	if (!local.exists) return 'missing';
	if (previousEntry?.sourceSha256 && previousEntry.sourceSha256 !== file.sha256) return 'remote-updated';
	return 'local-edited';
}

async function readLocalFileSnapshot(
	adapter: OperonDocsAdapter,
	path: string,
	hashText: OperonDocsHashText,
): Promise<LocalFileSnapshot> {
	if (!(await adapter.exists(path))) {
		return { exists: false, sha256: null, bytes: 0 };
	}
	const content = await adapter.read(path);
	return {
		exists: true,
		sha256: await hashText(content),
		bytes: getUtf8ByteLength(content),
	};
}

async function ensureParentFolderPath(adapter: OperonDocsAdapter, filePath: string): Promise<void> {
	const normalized = normalizeVaultPath(filePath);
	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash <= 0) return;
	await ensureFolderPath(adapter, normalized.slice(0, lastSlash));
}

async function ensureFolderPath(adapter: OperonDocsAdapter, folderPath: string): Promise<void> {
	const normalized = normalizeVaultPath(folderPath);
	if (!normalized) return;
	const segments = normalized.split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (!(await adapter.exists(current))) {
			await adapter.mkdir(current);
		}
	}
}

function buildTargetPath(targetRoot: string, path: string): string {
	validateManagedDocPath(path);
	return joinVaultPath(targetRoot, path);
}

function sortStateFiles(files: Record<string, OperonDocsSyncStateEntry>): Record<string, OperonDocsSyncStateEntry> {
	const sorted: Record<string, OperonDocsSyncStateEntry> = {};
	for (const [path, entry] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right, 'en'))) {
		sorted[path] = entry;
	}
	return sorted;
}

function getUtf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, byte => {
		const hex = byte.toString(16);
		return hex.length === 1 ? `0${hex}` : hex;
	}).join('');
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		if (value.charCodeAt(index) < 32) return true;
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function joinVaultPath(...parts: string[]): string {
	return normalizeVaultPath(parts.join('/'));
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/gu, '/')
		.replace(/\/+/gu, '/')
		.replace(/^\/+|\/+$/gu, '');
}
