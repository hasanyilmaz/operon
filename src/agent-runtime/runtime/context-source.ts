import { parseYaml } from 'obsidian';
import { sha256HexV1 } from '../contracts/v1/canonical';
import {
	type SourceRevisionV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import { parseTaskLine } from '../../core/parser';
import {
	buildReverseMapping,
	readLosslessYamlListField,
	readYamlFields,
} from '../../core/yaml-fields';
import { TASK_STATS_CANONICAL_KEYS } from '../../types/keys';
import type { IndexedTask } from '../../types/fields';
import type { KeyMapping } from '../../types/settings';

export interface RuntimeSourceSnapshotV1 {
	content: string;
	mtimeMs: number;
	sizeBytes: number;
	stable: boolean;
}

export interface RuntimeSourceReaderV1 {
	read(filePath: string): Promise<RuntimeSourceSnapshotV1 | null>;
	onMismatch?(filePath: string): Promise<void>;
}

export interface RuntimeSourceHydrationV1 {
	sourceRevision: SourceRevisionV1;
	sourceMarkdown?: string;
	sourceMarkdownScope?: 'task-line' | 'file-task';
}

export type RuntimeSourceHydrationResultV1 =
	| { ok: true; value: RuntimeSourceHydrationV1 }
	| { ok: false; reason: 'source-missing' | 'source-drift' | 'source-invalid' };

export type RuntimeLosslessSourceListFieldResultV1 =
	| { ok: true; value: string }
	| { ok: false };

type RuntimeSourceTaskV1 = Readonly<
	Omit<IndexedTask, 'fieldValues' | 'tags' | 'primary' | 'plainCheckboxProgress'>
	& {
		fieldValues: Readonly<Record<string, string>>;
		tags: readonly string[];
		primary: Readonly<IndexedTask['primary']>;
		plainCheckboxProgress?: Readonly<NonNullable<IndexedTask['plainCheckboxProgress']>>;
	}
>;

interface DigestCacheEntry {
	digest: string;
	verifiedTaskKeys: Set<string>;
}

const MAX_DIGEST_CACHE_ENTRIES = 1_024;
const INDEX_DERIVED_FIELD_KEYS = new Set<string>([
	'progress',
	'totalEstimate',
	'totalDuration',
	...TASK_STATS_CANONICAL_KEYS,
]);

/**
 * Exact-source verification for Agent Runtime reads.
 *
 * The cache stores only digests and verified locator keys. Source content is
 * request-local and is never retained across calls.
 */
export class RuntimeSourceHydratorV1 {
	private readonly digestCache = new Map<string, DigestCacheEntry>();

	constructor(private readonly reader: RuntimeSourceReaderV1) {}

	readSnapshot(filePath: string): Promise<RuntimeSourceSnapshotV1 | null> {
		return this.reader.read(filePath);
	}

	digestSnapshot(snapshot: RuntimeSourceSnapshotV1): string {
		return sha256HexV1(snapshot.content);
	}

	resolveLosslessListFieldAtLocator(options: {
		snapshot: RuntimeSourceSnapshotV1;
		locator: TaskSourceLocatorV1;
		canonicalKey: string;
		keyMappings: readonly KeyMapping[];
	}): RuntimeLosslessSourceListFieldResultV1 {
		if (!options.snapshot.stable) return { ok: false };
		if (options.locator.representation === 'inline') {
			const line = options.snapshot.content.split(/\r?\n/u)[options.locator.lineNumber];
			if (line === undefined) return { ok: false };
			const parsed = parseTaskLine(
				line,
				options.locator.lineNumber,
				options.locator.filePath,
				[...options.keyMappings],
			);
			if (!parsed) return { ok: false };
			const fields = parsed.fields.filter(field => field.key === options.canonicalKey);
			if (fields.length === 0) return { ok: true, value: '' };
			return fields.length === 1
				? { ok: true, value: fields[0].value }
				: { ok: false };
		}
		const frontmatter = parseFrontmatter(options.snapshot.content);
		if (!frontmatter) return { ok: false };
		return readLosslessYamlListField(
			frontmatter,
			options.canonicalKey,
			[...options.keyMappings],
		);
	}

	async resolveTaskAtLocator(options: {
		locator: TaskSourceLocatorV1;
		keyMappings: readonly KeyMapping[];
		resolveCheckbox(statusValue: string): IndexedTask['checkbox'];
	}): Promise<IndexedTask | null> {
		const source = await this.reader.read(options.locator.filePath);
		if (!source?.stable) return null;
		if (options.locator.representation === 'inline') {
			const line = source.content.split(/\r?\n/u)[options.locator.lineNumber];
			if (line === undefined) return null;
			const parsed = parseTaskLine(
				line,
				options.locator.lineNumber,
				options.locator.filePath,
				[...options.keyMappings],
			);
			if (!parsed?.operonId) return null;
			const fieldValues = Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
			return {
				operonId: parsed.operonId,
				description: parsed.description,
				checkbox: parsed.checkbox,
				fieldValues,
				tags: [...parsed.tags],
				primary: {
					format: 'inline',
					filePath: options.locator.filePath,
					lineNumber: options.locator.lineNumber,
				},
				datetimeModified: fieldValues['datetimeModified'] ?? '',
				tier: parsed.checkbox === 'open' ? 'hot' : 'warm',
			};
		}
		const frontmatter = parseFrontmatter(source.content);
		if (!frontmatter) return null;
		const fieldValues = readYamlFields(frontmatter, [...options.keyMappings]);
		const operonId = fieldValues['operonId']?.trim() ?? '';
		if (!operonId) return null;
		const statusValue = fieldValues['status'] ?? '';
		return {
			operonId,
			description: fileBasename(options.locator.filePath),
			checkbox: options.resolveCheckbox(statusValue),
			fieldValues,
			tags: normalizeYamlTags(frontmatter['tags']),
			primary: {
				format: 'yaml',
				filePath: options.locator.filePath,
				lineNumber: 0,
			},
			datetimeModified: fieldValues['datetimeModified'] ?? '',
			tier: options.resolveCheckbox(statusValue) === 'open' ? 'hot' : 'warm',
		};
	}

	async requestReindex(filePath: string): Promise<void> {
		await this.reader.onMismatch?.(filePath);
	}

	async hydrate(options: {
		task: RuntimeSourceTaskV1;
		keyMappings: readonly KeyMapping[];
		ramGeneration: number;
		includeSourceMarkdown: boolean;
		sourceSnapshot?: RuntimeSourceSnapshotV1 | null;
		sourceSnapshotDigest?: string;
		/** Request-local line index for repeated exact inline hydration from one source. */
		sourceLines?: readonly string[];
	}): Promise<RuntimeSourceHydrationResultV1> {
		const taskKey = buildTaskKey(options.task);
		const first = options.sourceSnapshot === undefined
			? await this.reader.read(options.task.primary.filePath)
			: options.sourceSnapshot;
		if (!first) {
			await this.reader.onMismatch?.(options.task.primary.filePath);
			return { ok: false, reason: 'source-missing' };
		}
		if (!first.stable) {
			await this.reader.onMismatch?.(options.task.primary.filePath);
			return { ok: false, reason: 'source-drift' };
		}

		const contentDigest = options.sourceSnapshotDigest ?? sha256HexV1(first.content);
		const cacheKey = buildCacheKey(
			options.task.primary.filePath,
			first.mtimeMs,
			first.sizeBytes,
			options.ramGeneration,
			contentDigest,
		);
		const cached = this.digestCache.get(cacheKey);
		const mustVerify = !cached?.verifiedTaskKeys.has(taskKey);
		if (mustVerify && !verifyTaskSource(
			options.task,
			first.content,
			options.keyMappings,
			options.sourceLines,
		)) {
			await this.reader.onMismatch?.(options.task.primary.filePath);
			return { ok: false, reason: 'source-invalid' };
		}

		const digest = cached?.digest ?? contentDigest;
		const entry = cached ?? { digest, verifiedTaskKeys: new Set<string>() };
		entry.verifiedTaskKeys.add(taskKey);
		this.touchCache(cacheKey, entry);

		const sourceRevision: SourceRevisionV1 = {
			algorithm: 'sha256',
			contentDigest: digest,
		};
		if (!options.includeSourceMarkdown) {
			return { ok: true, value: { sourceRevision } };
		}
		return options.task.primary.format === 'inline'
			? {
				ok: true,
				value: {
					sourceRevision,
					sourceMarkdown: readInlineSourceLine(
						options.task,
						first.content,
						options.sourceLines,
					),
					sourceMarkdownScope: 'task-line',
				},
			}
			: {
				ok: true,
				value: {
					sourceRevision,
					sourceMarkdown: first.content,
					sourceMarkdownScope: 'file-task',
				},
			};
	}

	invalidatePath(filePath: string): void {
		const prefix = `${filePath}\u0000`;
		for (const key of this.digestCache.keys()) {
			if (key.startsWith(prefix)) this.digestCache.delete(key);
		}
	}

	clear(): void {
		this.digestCache.clear();
	}

	private touchCache(key: string, entry: DigestCacheEntry): void {
		this.digestCache.delete(key);
		this.digestCache.set(key, entry);
		while (this.digestCache.size > MAX_DIGEST_CACHE_ENTRIES) {
			const oldestEntry = this.digestCache.keys().next();
			if (oldestEntry.done) break;
			const oldest = oldestEntry.value;
			this.digestCache.delete(oldest);
		}
	}
}

function verifyTaskSource(
	task: RuntimeSourceTaskV1,
	content: string,
	keyMappings: readonly KeyMapping[],
	sourceLines?: readonly string[],
): boolean {
	if (task.primary.format === 'inline') {
		const line = readInlineSourceLine(task, content, sourceLines);
		if (line === undefined) return false;
		const parsed = parseTaskLine(
			line,
			task.primary.lineNumber,
			task.primary.filePath,
			[...keyMappings],
		);
		if (
			parsed?.operonId !== task.operonId
			|| parsed.description !== task.description
			|| parsed.checkbox !== task.checkbox
			|| !sameStringArray(parsed.tags, task.tags)
		) return false;
		const sourceFields = Object.fromEntries(parsed.fields.map(field => [field.key, field.value]));
		return sameSourceFieldValues(task.fieldValues, sourceFields);
	}
	const frontmatter = parseFrontmatter(content);
	if (!frontmatter) return false;
	const reverse = buildReverseMapping([...keyMappings]);
	let matchingOperonId = false;
	for (const [propertyName, rawValue] of Object.entries(frontmatter)) {
		const canonicalKey = reverse.get(propertyName) ?? propertyName;
		if (canonicalKey !== 'operonId') continue;
		matchingOperonId = typeof rawValue === 'string' && rawValue.trim() === task.operonId;
		break;
	}
	if (!matchingOperonId) return false;
	const sourceFields = readYamlFields(frontmatter, [...keyMappings]);
	const sourceTags = normalizeYamlTags(frontmatter['tags']);
	return sameSourceFieldValues(task.fieldValues, sourceFields)
		&& sameStringArray(sourceTags, task.tags)
		&& task.description === fileBasename(task.primary.filePath);
}

function sameSourceFieldValues(
	indexed: Readonly<Record<string, string>>,
	source: Readonly<Record<string, string>>,
): boolean {
	for (const [key, value] of Object.entries(source)) {
		if (INDEX_DERIVED_FIELD_KEYS.has(key)) continue;
		if (key === 'datetimeCreated' || key === 'datetimeModified') continue;
		if ((indexed[key] ?? '') !== value) return false;
	}
	for (const [key, value] of Object.entries(indexed)) {
		if (source[key] !== undefined || value === '') continue;
		if (INDEX_DERIVED_FIELD_KEYS.has(key)) continue;
		if (key === 'datetimeCreated' || key === 'datetimeModified') continue;
		return false;
	}
	return true;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
	if (!match) return null;
	try {
		const parsed: unknown = parseYaml(match[1]);
		return isPlainRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object'
		&& value !== null
		&& !Array.isArray(value)
		&& Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeYamlTags(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
	if (typeof value !== 'string') return [];
	return value.split(/[;,]/u).map(item => item.trim()).filter(Boolean);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fileBasename(filePath: string): string {
	const leaf = filePath.replace(/\\/gu, '/').split('/').pop() ?? filePath;
	return leaf.replace(/\.md$/iu, '');
}

function readInlineSourceLine(
	task: RuntimeSourceTaskV1,
	content: string,
	sourceLines?: readonly string[],
): string | undefined {
	return (sourceLines ?? content.split(/\r?\n/u))[task.primary.lineNumber];
}

function buildTaskKey(task: RuntimeSourceTaskV1): string {
	const locator = toLocator(task);
	return locator.representation === 'inline'
		? `${task.operonId}\u0000inline\u0000${locator.filePath}\u0000${locator.lineNumber}`
		: `${task.operonId}\u0000file\u0000${locator.filePath}`;
}

function toLocator(task: RuntimeSourceTaskV1): TaskSourceLocatorV1 {
	return task.primary.format === 'inline'
		? {
			representation: 'inline',
			filePath: task.primary.filePath,
			lineNumber: task.primary.lineNumber,
		}
		: {
			representation: 'file',
			filePath: task.primary.filePath,
		};
}

function buildCacheKey(
	filePath: string,
	mtimeMs: number,
	sizeBytes: number,
	ramGeneration: number,
	contentDigest: string,
): string {
	return `${filePath}\u0000${mtimeMs}\u0000${sizeBytes}\u0000${ramGeneration}\u0000${contentDigest}`;
}
