/**
 * Direct task writer for Operon.
 * Writes field values directly to a task's source file (inline or YAML).
 * No sync, no locks, no debounce — just a clean write to the single task instance.
 *
 * Replaces SyncEngine.scheduleSync() for systems that need to update
 * other tasks' files (dependency manager, AggregateCoordinator, etc.).
 */

import { App, normalizePath, parseYaml, stringifyYaml, TFile, TFolder } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';

import { parseTaskLine } from './parser';
import { serializeTask } from './serializer';
import { IndexedTask, OperonField } from '../types/fields';
import { KeyMapping } from '../types/settings';
import {
	applyYamlTaskFieldValues,
	normalizeYamlFrontmatterFormatting,
	tryPatchAggregateYamlFrontmatter,
	YamlFrontmatterFormattingPlan,
} from './task-writer-yaml';
import { getManagedYamlAliases, getVisiblePropertyName } from './yaml-fields';
import { resolveYamlTaskCreatedBackfillValue } from './yaml-task-file-stat-sync';
import { WriteQueue } from '../storage/write-queue';
import { enginePerfLog, enginePerfNow } from './engine-perf';
import { getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from './managed-task-fields';
import { normalizeTaskMediaReferenceList } from './task-media-reference';
import { parseDependencyIdList } from './dependency-graph';
import {
	analyzeTaskSourceRelationshipAuthority,
	type TaskSourceRelationshipRecord,
} from './task-source-relationship-authority';
import { CANONICAL_KEY_MAP, CANONICAL_KEYS, isInternalCanonicalKey } from '../types/keys';
import {
    isWritableRawYamlPropertyName,
    rawYamlPropertyExpectationsEqual,
    readRawYamlPropertyExpectation,
    type RawYamlPropertyExpectation,
    type RawYamlPropertyMutation,
    type RawYamlPropertyWriteResult,
} from './raw-yaml-property';

export interface TaskWriteOptions {
    mode?: 'merge' | 'replace';
    reindex?: 'scheduled' | 'none';
    touchAncestors?: boolean;
    yamlAggregateFastPath?: boolean;
}

export interface TaskWriterHooks {
	onBeforeWriteFile?: (filePath: string) => void;
	validateWritePath?: (filePath: string, allowAbsent: boolean) => Promise<boolean>;
    onDuplicateConflict?: (operonId: string) => void;
}

export type TaskWriterIndexerPort = Pick<OperonIndexer,
	| 'getTask'
	| 'hasDuplicateOperonIdConflict'
	| 'isPathIndexable'
	| 'reindexFilePath'
	| 'reindexFilesBatch'
	| 'scheduleReindex'
>;

export interface PlainFileTaskPropertyOption {
    canonicalKey: string;
    propertyName: string;
    description: string;
    internal: boolean;
}

export type PlainFileTaskCatalogResult =
    | {
        outcome: 'ready';
        filePath: string;
        expectedContent: string;
        properties: PlainFileTaskPropertyOption[];
    }
    | {
        outcome: 'missing' | 'unsupported' | 'conflict';
        filePath: string | null;
    };

export type DetachYamlTaskPropertiesResult = {
    outcome: 'detached' | 'missing' | 'unsupported' | 'conflict' | 'failed';
    filePath: string | null;
    file?: TFile;
    previousContent?: string;
    committedContent?: string;
};

export interface ExactMarkdownSourceMutationResult {
    outcome: 'committed' | 'conflict' | 'missing' | 'invalid-target' | 'failed';
    filePath: string;
    file?: TFile;
    previousContent?: string;
    committedContent?: string;
}

export type TaskSourceMutationGuard = () => boolean;

export interface TaskWriterExclusiveMutationPermit {
    readonly token: symbol;
}

interface TaskWriterSharedMutationPermit {
    readonly token: symbol;
}

export type TaskSourceMutation =
    | {
        kind: 'modify';
        filePath: string;
        expectedContent: string;
        nextContent: string;
    }
    | {
        kind: 'create';
        filePath: string;
        nextContent: string;
    }
    | {
        kind: 'trash';
        filePath: string;
        expectedContent: string;
    };

export interface TaskSourceMutationResult {
    outcome: 'committed' | 'conflict' | 'missing' | 'exists' | 'invalid-target';
    filePath: string;
    previousContent?: string;
    committedContent?: string;
	/** Internal marker for exact post-trash index settlement. */
	deleted?: boolean;
    /** Internal exact handle for immediate post-write indexing. */
    file?: TFile;
}

export interface GuardedTaskSourceFieldUpdate {
    operonId: string;
    format: 'inline' | 'yaml';
    lineNumber?: number;
    fieldValues: Record<string, string>;
}

export interface GuardedTaskSourceRenderResult {
    ok: boolean;
    content: string;
    reason: string;
}

type YamlFastPathState = 'aggregate' | 'fallback' | 'none';

class TaskWriterMutationGate {
    private activeShared = 0;
    private exclusiveActive = false;
    private exclusiveWaiters: Array<() => void> = [];
    private sharedWaiters: Array<() => void> = [];

    async runShared<T>(operation: () => Promise<T>): Promise<T> {
        await this.acquireShared();
        try {
            return await operation();
        } finally {
            this.activeShared -= 1;
            this.dispatch();
        }
    }

    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        await this.acquireExclusive();
        try {
            return await operation();
        } finally {
            this.exclusiveActive = false;
            this.dispatch();
        }
    }

    private async acquireShared(): Promise<void> {
        if (!this.exclusiveActive && this.exclusiveWaiters.length === 0) {
            this.activeShared += 1;
            return;
        }
        await new Promise<void>(resolve => this.sharedWaiters.push(resolve));
    }

    private async acquireExclusive(): Promise<void> {
        if (!this.exclusiveActive && this.activeShared === 0) {
            this.exclusiveActive = true;
            return;
        }
        await new Promise<void>(resolve => this.exclusiveWaiters.push(resolve));
    }

    private dispatch(): void {
        if (this.exclusiveActive || this.activeShared > 0) return;
        const exclusive = this.exclusiveWaiters.shift();
        if (exclusive) {
            this.exclusiveActive = true;
            exclusive();
            return;
        }
        const shared = this.sharedWaiters.splice(0);
        this.activeShared += shared.length;
        for (const resolve of shared) resolve();
    }
}

const PLAIN_FILE_TASK_DETACH_ABORT = new Error('plain-file-task-detach-abort');
const EXACT_MARKDOWN_SOURCE_MUTATION_ABORT = new Error('exact-markdown-source-mutation-abort');

interface TaskWriteResult {
    wrote: boolean;
    yamlFastPath: YamlFastPathState;
    fallbackReason: string;
}

export interface InlineTaskLinePatchResult {
    ok: boolean;
    content: string;
    fallbackReason: string;
}

export interface YamlTaskContentPatchResult {
    ok: boolean;
    content: string;
    fallbackReason: string;
}

export interface SameFileInlineYamlAggregateWriteResult {
    wrote: boolean;
    fallbackReason: string;
}

export interface AggregateSameFileWriteEntry {
    operonId: string;
    fieldValues: Record<string, string>;
}

export interface AggregateSameFileWriteResult {
    wroteOperonIds: string[];
    failedOperonIds: string[];
    lineNumbersShifted: boolean;
}

export type ConditionalTaskFieldWriteOutcome =
    | 'updated'
    | 'already-updated'
    | 'conflict'
    | 'missing';

export interface ConditionalTaskFieldWriteOptions {
    reindex?: 'scheduled' | 'none';
    allowMissingAfterReindex?: boolean;
    additionalExpectedValues?: Record<string, string>;
    fallbackLocation?: {
        filePath: string;
        format: 'inline' | 'yaml';
    };
}

function isSafeMarkdownTaskSourcePath(originalPath: string, normalizedPath: string): boolean {
    if (
        originalPath.length === 0
        || originalPath !== originalPath.trim()
        || originalPath.startsWith('/')
        || originalPath.startsWith('\\')
        || /^[a-zA-Z]:/u.test(originalPath)
        || originalPath.includes('\\')
        || originalPath.includes('\0')
        || originalPath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
        || originalPath !== normalizedPath
        || !normalizedPath.toLowerCase().endsWith('.md')
    ) return false;
    for (let index = 0; index < originalPath.length; index += 1) {
        const code = originalPath.charCodeAt(index);
        if (code <= 31 || code === 127) return false;
    }
    return true;
}

function findTaskLineIndex(
    lines: string[],
    filePath: string,
    operonId: string,
    lineHint: number,
    keyMappings: KeyMapping[],
): number {
    if (lineHint >= 0 && lineHint < lines.length) {
        const hinted = parseTaskLine(lines[lineHint], lineHint, filePath, keyMappings);
        if (hinted?.operonId === operonId) {
            return lineHint;
        }
    }

    const matches: number[] = [];
    for (let index = 0; index < lines.length; index++) {
        const parsed = parseTaskLine(lines[index], index, filePath, keyMappings);
        if (parsed?.operonId === operonId) {
            matches.push(index);
        }
    }
    if (matches.length === 0) return -1;

    let best = matches[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of matches) {
        const distance = Math.abs(index - lineHint);
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    }
    return best;
}

export function tryPatchInlineTaskLineContent(
    content: string,
    filePath: string,
    operonId: string,
    fieldValues: Record<string, string>,
    lineHint: number,
    mode: 'merge' | 'replace',
    keyMappings: KeyMapping[] = [],
): InlineTaskLinePatchResult {
    const lines = content.split('\n');
    const patch = tryPatchInlineTaskLines(
        lines,
        filePath,
        operonId,
        fieldValues,
        lineHint,
        mode,
        keyMappings,
    );
    return patch.ok
        ? { ok: true, content: lines.join('\n'), fallbackReason: 'none' }
        : { ok: false, content, fallbackReason: patch.fallbackReason };
}

function tryPatchInlineTaskLines(
    lines: string[],
    filePath: string,
    operonId: string,
    fieldValues: Record<string, string>,
    lineHint: number,
    mode: 'merge' | 'replace',
    keyMappings: KeyMapping[],
): { ok: true; fallbackReason: 'none' } | {
    ok: false;
    fallbackReason: 'inline-task-not-found' | 'inline-task-parse-failed';
} {
    const taskLineIndex = findTaskLineIndex(lines, filePath, operonId, lineHint, keyMappings);
    if (taskLineIndex === -1) {
        return { ok: false, fallbackReason: 'inline-task-not-found' };
    }

    const parsed = parseTaskLine(lines[taskLineIndex], taskLineIndex, filePath, keyMappings);
    if (!parsed) {
        return { ok: false, fallbackReason: 'inline-task-parse-failed' };
    }

    const canonicalFieldMap = new Map<string, OperonField>();
    const unmanagedFields: OperonField[] = [];
    for (const field of parsed.fields) {
        const canonicalKey = field.key;
        if (canonicalKey === 'pinned') continue;
        if (canonicalKey === 'tags') continue;
        const fieldType = getManagedTaskFieldType(canonicalKey, keyMappings);
        if (!fieldType) {
            unmanagedFields.push(field);
            continue;
        }
        canonicalFieldMap.set(canonicalKey, {
            ...field,
            key: canonicalKey,
            type: fieldType,
            isCanonical: true,
        });
    }
    parsed.fields = [...unmanagedFields, ...Array.from(canonicalFieldMap.values())];

    if ('_description' in fieldValues) {
        parsed.description = fieldValues['_description'];
    }
    if ('_tags' in fieldValues) {
        parsed.tags = fieldValues['_tags']
            ? fieldValues['_tags'].split(';').map(tag => tag.trim()).filter(Boolean)
            : [];
    }
    if ('_checkbox' in fieldValues) {
        parsed.checkbox = fieldValues['_checkbox'] as 'open' | 'done' | 'cancelled';
    }

	for (const [key, rawValue] of Object.entries(fieldValues)) {
		if (key.startsWith('_')) continue;
		if (key === 'pinned') continue;
		const fieldType = getManagedTaskFieldType(key, keyMappings);
		if (!fieldType) continue;
		const value = key === 'taskGallery'
			? normalizeTaskMediaReferenceList(rawValue)
			: rawValue;

        const existing = parsed.fields.find(f => f.key === key);
        if (value === '') {
            parsed.fields = parsed.fields.filter(f => f.key !== key);
        } else if (existing) {
            existing.value = value;
            existing.rawValue = value;
        } else if (value) {
            parsed.fields.push({
                sourceKey: key,
                key,
                value,
                rawValue: value,
                type: fieldType,
                isCanonical: true,
                containerRange: { from: 0, to: 0 },
                valueRange: { from: 0, to: 0 },
            });
        }
    }

    if (mode === 'replace') {
        const incomingKeys = new Set(
            Object.keys(fieldValues).filter(key => !key.startsWith('_'))
        );
        parsed.fields = parsed.fields.filter(f => {
            if (!isManagedTaskFieldCanonicalKey(f.key, keyMappings)) return true;
            if (incomingKeys.has(f.key)) return true;
            if (f.key === 'operonId' || f.key === 'datetimeCreated' || f.key === 'related') return true;
            return false;
        });
    }

    lines[taskLineIndex] = serializeTask(parsed, keyMappings);
    return { ok: true, fallbackReason: 'none' };
}

export function tryPatchYamlTaskContent(
    content: string,
    operonId: string,
    fieldValues: Record<string, string>,
    mode: 'merge' | 'replace',
    keyMappings: KeyMapping[],
): YamlTaskContentPatchResult {
    const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
    if (!match) {
        return { ok: false, content, fallbackReason: 'malformed-frontmatter' };
    }
    let frontmatter: unknown;
    try {
        frontmatter = parseYaml(match[2]);
    } catch {
        return { ok: false, content, fallbackReason: 'yaml-parse-failed' };
    }
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
        return { ok: false, content, fallbackReason: 'yaml-object-missing' };
    }
    const mutable = frontmatter as Record<string, unknown>;
    const operonAliases = getManagedYamlAliases('operonId', keyMappings);
    const exactIds = operonAliases
        .filter(key => Object.prototype.hasOwnProperty.call(mutable, key))
        .map(key => mutable[key])
        .filter(value => typeof value === 'string' || typeof value === 'number')
        .map(value => String(value).trim())
        .filter(Boolean);
    if (exactIds.length !== 1 || exactIds[0] !== operonId) {
        return { ok: false, content, fallbackReason: 'operonId-mismatch' };
    }
    const formattingPlan = applyYamlTaskFieldValues(
        mutable,
        fieldValues,
        mode,
        keyMappings,
    );
    const serialized = stringifyYaml(mutable).trimEnd();
    const rebuilt = `${match[1]}${serialized}${match[3]}${content.slice(match[0].length)}`;
    return {
        ok: true,
        content: normalizeYamlFrontmatterFormatting(rebuilt, formattingPlan),
        fallbackReason: 'none',
    };
}

export function tryDetachYamlTaskPropertiesContent(
    content: string,
    operonId: string,
    selectedCanonicalKeys: readonly string[],
    keyMappings: KeyMapping[],
): { ok: true; content: string } | { ok: false; content: string } {
    const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
    if (!match) return { ok: false, content };
    let frontmatter: unknown;
    try {
        frontmatter = parseYaml(match[2]);
    } catch {
        return { ok: false, content };
    }
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
        return { ok: false, content };
    }
    const mutable = frontmatter as Record<string, unknown>;
    const selected = new Set(selectedCanonicalKeys.map(key => key.trim()).filter(Boolean));
    if (!selected.has('operonId')) return { ok: false, content };
    const identityEntries = getManagedYamlAliases('operonId', keyMappings)
        .filter(yamlKey => Object.prototype.hasOwnProperty.call(mutable, yamlKey))
        .map(yamlKey => mutable[yamlKey])
        .filter(value => typeof value === 'string' || typeof value === 'number')
        .map(value => String(value).trim())
        .filter(Boolean);
    if (identityEntries.length !== 1 || identityEntries[0] !== operonId) {
        return { ok: false, content };
    }
    for (const canonicalKey of selected) {
        const aliases = getManagedYamlAliases(canonicalKey, keyMappings);
        if (!aliases.some(yamlKey => Object.prototype.hasOwnProperty.call(mutable, yamlKey))) {
            return { ok: false, content };
        }
    }
    for (const canonicalKey of selected) {
        for (const yamlKey of getManagedYamlAliases(canonicalKey, keyMappings)) {
            delete mutable[yamlKey];
        }
    }
    const serialized = stringifyYaml(mutable).trimEnd();
    return {
        ok: true,
        content: `${match[1]}${serialized}${match[3]}${content.slice(match[0].length)}`,
    };
}

export class TaskWriter {
    private app: App;
    private indexer: TaskWriterIndexerPort;
    private keyMappings: KeyMapping[];
    private hooks: TaskWriterHooks;
    private fileWriteQueue = new WriteQueue();
    private fileMutationGate = new TaskWriterMutationGate();
    private activeExclusiveMutationToken: symbol | null = null;
    private activeSharedMutationTokens = new Set<symbol>();
    private unsettledRelationshipTargets = new Map<string, Set<string>>();

    constructor(app: App, indexer: TaskWriterIndexerPort, keyMappings: KeyMapping[], hooks: TaskWriterHooks = {}) {
        this.app = app;
        this.indexer = indexer;
        this.keyMappings = keyMappings;
        this.hooks = hooks;
    }

    async runExclusiveTaskMutation<T>(
        operation: (permit: TaskWriterExclusiveMutationPermit) => Promise<T>,
    ): Promise<T> {
        return await this.fileMutationGate.runExclusive(async () => {
            const token = Symbol('task-writer-exclusive-mutation');
            this.activeExclusiveMutationToken = token;
            try {
                return await operation(Object.freeze({ token }));
            } finally {
                this.activeExclusiveMutationToken = null;
            }
        });
    }

    private async runSharedTaskMutation<T>(
        operation: (permit: TaskWriterSharedMutationPermit) => Promise<T>,
    ): Promise<T> {
        return await this.fileMutationGate.runShared(async () => {
            const token = Symbol('task-writer-shared-mutation');
            this.activeSharedMutationTokens.add(token);
            try {
                return await operation(Object.freeze({ token }));
            } finally {
                this.activeSharedMutationTokens.delete(token);
            }
        });
    }

    private async enqueueFileMutation<T>(
        key: string,
        operation: () => Promise<T>,
        permit?: TaskWriterExclusiveMutationPermit | TaskWriterSharedMutationPermit,
    ): Promise<T> {
        if (
            permit?.token === this.activeExclusiveMutationToken
            || (permit && this.activeSharedMutationTokens.has(permit.token))
        ) {
            return await this.fileWriteQueue.enqueue(key, operation);
        }
        return await this.fileMutationGate.runShared(async () => (
            await this.fileWriteQueue.enqueue(key, operation)
        ));
    }

    /** Update key mappings when settings change. */
    updateKeyMappings(keyMappings: KeyMapping[]): void {
        this.keyMappings = keyMappings;
    }

    /**
     * Read the exact managed YAML properties that can be removed when a file
     * task is converted back into a normal note. The returned source snapshot
     * is deliberately carried into the destructive write as an optimistic
     * concurrency guard; a picker must never clean a file that changed while
     * it was open.
     */
    async getPlainFileTaskPropertyCatalog(operonId: string): Promise<PlainFileTaskCatalogResult> {
        const task = this.indexer.getTask(operonId);
        if (!task) return { outcome: 'missing', filePath: null };
        if (this.blockDuplicateConflict(operonId)) {
            return { outcome: 'conflict', filePath: task.primary.filePath };
        }
        if (task.primary.format !== 'yaml') {
            return { outcome: 'unsupported', filePath: task.primary.filePath };
        }
        const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
        if (!(file instanceof TFile) || file.extension !== 'md') {
            return { outcome: 'missing', filePath: task.primary.filePath };
        }

        return await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            const content = await this.app.vault.read(file);
            const frontmatter = this.parseYamlFrontmatter(content);
            if (!frontmatter || !this.frontmatterHasExactSingleOperonId(frontmatter, operonId)) {
                return { outcome: 'conflict', filePath: file.path };
            }
            return {
                outcome: 'ready',
                filePath: file.path,
                expectedContent: content,
                properties: this.collectPlainFileTaskPropertyOptions(frontmatter),
            };
        });
    }

    /**
     * Remove selected managed YAML keys in one frontmatter transaction. This
     * is intentionally separate from normal task field writes: it removes the
     * identity itself and must not attempt any task lookup after that point.
     */
    async detachYamlTaskProperties(
        operonId: string,
        expectedContent: string,
        selectedCanonicalKeys: readonly string[],
        guard?: TaskSourceMutationGuard,
        permit?: TaskWriterExclusiveMutationPermit,
    ): Promise<DetachYamlTaskPropertiesResult> {
        const task = this.indexer.getTask(operonId);
        if (!task) return { outcome: 'missing', filePath: null };
        if (this.blockDuplicateConflict(operonId)) {
            return { outcome: 'conflict', filePath: task.primary.filePath };
        }
        if (task.primary.format !== 'yaml') {
            return { outcome: 'unsupported', filePath: task.primary.filePath };
        }
        const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
        if (!(file instanceof TFile) || file.extension !== 'md') {
            return { outcome: 'missing', filePath: task.primary.filePath };
        }
        const selected = new Set(selectedCanonicalKeys.map(key => key.trim()).filter(Boolean));
        if (!selected.has('operonId')) {
            return { outcome: 'unsupported', filePath: file.path };
        }

        try {
            return await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
                let plannedContent = '';
                try {
                    const committedContent = await this.app.vault.process(file, currentContent => {
                        if (currentContent !== expectedContent || (guard && !guard())) {
                            throw PLAIN_FILE_TASK_DETACH_ABORT;
                        }
                        const plan = tryDetachYamlTaskPropertiesContent(
                            currentContent,
                            operonId,
                            selectedCanonicalKeys,
                            this.keyMappings,
                        );
                        if (!plan.ok) throw PLAIN_FILE_TASK_DETACH_ABORT;
                        plannedContent = plan.content;
                        this.hooks.onBeforeWriteFile?.(file.path);
                        return plan.content;
                    });
                    return {
                        outcome: 'detached',
                        filePath: file.path,
                        file,
                        previousContent: expectedContent,
                        committedContent,
                    };
                } catch (error) {
                    if (error === PLAIN_FILE_TASK_DETACH_ABORT) {
                        return { outcome: 'conflict', filePath: file.path };
                    }
                    const persistedContent = await this.app.vault.read(file).catch(() => undefined);
                    if (plannedContent && persistedContent === plannedContent) {
                        return {
                            outcome: 'detached',
                            filePath: file.path,
                            file,
                            previousContent: expectedContent,
                            committedContent: persistedContent,
                        };
                    }
                    if (persistedContent !== undefined && persistedContent !== expectedContent) {
                        return { outcome: 'conflict', filePath: file.path, previousContent: persistedContent };
                    }
                    console.error('Operon: file task conversion cleanup failed.', error);
                    return { outcome: 'failed', filePath: file.path };
                }
            }, permit);
        } catch (error) {
            console.error('Operon: file task conversion cleanup failed.', error);
            return { outcome: 'failed', filePath: file.path };
        }
    }

    /** Atomically replace one Markdown file only when its full source matches. */
    async applyExactMarkdownSourceMutation(
        filePathInput: string,
        expectedContent: string,
        nextContent: string,
        guard?: TaskSourceMutationGuard,
        permit?: TaskWriterExclusiveMutationPermit,
    ): Promise<ExactMarkdownSourceMutationResult> {
        const filePath = normalizePath(filePathInput);
        if (!isSafeMarkdownTaskSourcePath(filePathInput, filePath)) {
            return { outcome: 'invalid-target', filePath };
        }
        try {
            return await this.enqueueFileMutation(this.getFileWriteQueueKey(filePath), async () => {
                if (this.hooks.validateWritePath && !(await this.hooks.validateWritePath(filePath, false))) {
                    return { outcome: 'invalid-target', filePath };
                }
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (!(file instanceof TFile) || file.extension !== 'md') {
                    return { outcome: 'missing', filePath };
                }
                try {
                    const committedContent = await this.app.vault.process(file, currentContent => {
                        if (currentContent !== expectedContent || (guard && !guard())) {
                            throw EXACT_MARKDOWN_SOURCE_MUTATION_ABORT;
                        }
                        this.hooks.onBeforeWriteFile?.(file.path);
                        return nextContent;
                    });
                    return {
                        outcome: 'committed',
                        filePath,
                        file,
                        previousContent: expectedContent,
                        committedContent,
                    };
                } catch (error) {
                    if (error === EXACT_MARKDOWN_SOURCE_MUTATION_ABORT) {
                        return { outcome: 'conflict', filePath };
                    }
                    const persistedContent = await this.app.vault.read(file).catch(() => undefined);
                    if (persistedContent === nextContent) {
                        return {
                            outcome: 'committed',
                            filePath,
                            file,
                            previousContent: expectedContent,
                            committedContent: persistedContent,
                        };
                    }
                    if (persistedContent !== undefined && persistedContent !== expectedContent) {
                        return { outcome: 'conflict', filePath, previousContent: persistedContent };
                    }
                    console.error('Operon: exact Markdown source mutation failed.', error);
                    return { outcome: 'failed', filePath };
                }
            }, permit);
        } catch (error) {
            console.error('Operon: exact Markdown source mutation failed.', error);
            return { outcome: 'failed', filePath };
        }
    }

    /**
     * Canonical source transaction used by Runtime-owned creation and source transitions. The
     * source comparison and write share TaskWriter's existing per-file queue,
     * so UI and agent mutations cannot race through independent locks.
     */
    async applyTaskSourceMutation(mutation: TaskSourceMutation): Promise<TaskSourceMutationResult> {
        const filePath = normalizePath(mutation.filePath);
        if (!isSafeMarkdownTaskSourcePath(mutation.filePath, filePath)) {
            return { outcome: 'invalid-target', filePath };
        }
        return await this.enqueueFileMutation(this.getFileWriteQueueKey(filePath), async () => {
            if (
                this.hooks.validateWritePath
                && !(await this.hooks.validateWritePath(filePath, mutation.kind === 'create'))
            ) {
                return { outcome: 'invalid-target', filePath };
            }
            const current = this.app.vault.getAbstractFileByPath(filePath);
            if (mutation.kind === 'create') {
                if (current) return { outcome: 'exists', filePath };
                const relationshipAuthority = this.analyzeSourceRelationshipAuthority(
                    mutation.nextContent,
                    filePath,
                );
                if (!relationshipAuthority.valid) {
                    return { outcome: 'conflict', filePath };
                }
                const slashIndex = filePath.lastIndexOf('/');
                if (slashIndex >= 0) {
                    const parent = this.app.vault.getAbstractFileByPath(filePath.slice(0, slashIndex));
                    if (!(parent instanceof TFolder)) return { outcome: 'missing', filePath };
                }
                if (
                    this.hooks.validateWritePath
                    && !(await this.hooks.validateWritePath(filePath, true))
                ) {
                    return { outcome: 'invalid-target', filePath };
                }
                this.hooks.onBeforeWriteFile?.(filePath);
                const createdFile = await this.app.vault.create(filePath, mutation.nextContent);
                this.recordSourceRelationshipTargets(relationshipAuthority.relationships);
                return {
                    outcome: 'committed',
                    filePath,
                    committedContent: mutation.nextContent,
                    file: createdFile,
                };
            }
            if (!(current instanceof TFile) || current.extension !== 'md') {
                return { outcome: 'missing', filePath };
            }
            const previousContent = await this.app.vault.read(current);
            if (previousContent !== mutation.expectedContent) {
                return { outcome: 'conflict', filePath, previousContent };
            }
            if (
                this.hooks.validateWritePath
                && !(await this.hooks.validateWritePath(filePath, false))
            ) {
                return { outcome: 'invalid-target', filePath };
            }
            const validatedCurrent = this.app.vault.getAbstractFileByPath(filePath);
            if (!(validatedCurrent instanceof TFile) || validatedCurrent.extension !== 'md') {
                return { outcome: 'missing', filePath };
            }
            const validatedContent = await this.app.vault.read(validatedCurrent);
            if (validatedContent !== mutation.expectedContent) {
                return { outcome: 'conflict', filePath, previousContent: validatedContent };
            }
            if (mutation.kind === 'trash') {
                this.hooks.onBeforeWriteFile?.(filePath);
                await this.app.fileManager.trashFile(validatedCurrent);
                return {
                    outcome: 'committed',
                    filePath,
                    previousContent: validatedContent,
					deleted: true,
                };
            }
            const relationshipAuthority = this.analyzeSourceRelationshipAuthority(
                mutation.nextContent,
                filePath,
            );
            if (!relationshipAuthority.valid) {
                return { outcome: 'conflict', filePath, previousContent: validatedContent };
            }
            this.hooks.onBeforeWriteFile?.(filePath);
            await this.app.vault.modify(validatedCurrent, mutation.nextContent);
            this.recordSourceRelationshipTargets(relationshipAuthority.relationships);
            return {
                outcome: 'committed',
                filePath,
                previousContent: validatedContent,
                committedContent: mutation.nextContent,
                file: validatedCurrent,
            };
        });
    }

    /**
     * Compare, create/update, and patch exact task fields as one per-source
     * queued commit. This is the Agent Runtime atomic task-source primitive.
     */
    async applyGuardedTaskSourceMutation(
        mutation: {
            filePath: string;
            expectedContent: string | null;
            nextContent: string;
            taskUpdates: readonly GuardedTaskSourceFieldUpdate[];
        },
    ): Promise<TaskSourceMutationResult> {
        const filePath = normalizePath(mutation.filePath);
        if (!isSafeMarkdownTaskSourcePath(mutation.filePath, filePath)) {
            return { outcome: 'invalid-target', filePath };
        }
        return await this.enqueueFileMutation(this.getFileWriteQueueKey(filePath), async () => {
            if (
                this.hooks.validateWritePath
                && !(await this.hooks.validateWritePath(filePath, mutation.expectedContent === null))
            ) {
                return { outcome: 'invalid-target', filePath };
            }
            const current = this.app.vault.getAbstractFileByPath(filePath);
            let committedFile: TFile;
            if (mutation.expectedContent === null) {
                if (current) return { outcome: 'exists', filePath };
            } else {
                if (!(current instanceof TFile) || current.extension !== 'md') {
                    return { outcome: 'missing', filePath };
                }
                const currentContent = await this.app.vault.read(current);
                if (currentContent !== mutation.expectedContent) {
                    return { outcome: 'conflict', filePath, previousContent: currentContent };
                }
            }

            const rendered = this.renderGuardedTaskSourceContent(
                filePath,
                mutation.nextContent,
                mutation.taskUpdates,
            );
            if (!rendered.ok) return { outcome: 'conflict', filePath };
            const committedContent = rendered.content;

            if (mutation.expectedContent === null) {
                const slashIndex = filePath.lastIndexOf('/');
                if (slashIndex >= 0) {
                    const parent = this.app.vault.getAbstractFileByPath(filePath.slice(0, slashIndex));
                    if (!(parent instanceof TFolder)) return { outcome: 'missing', filePath };
                }
                if (
                    this.hooks.validateWritePath
                    && !(await this.hooks.validateWritePath(filePath, true))
                ) {
                    return { outcome: 'invalid-target', filePath };
                }
                this.hooks.onBeforeWriteFile?.(filePath);
                committedFile = await this.app.vault.create(filePath, committedContent);
            } else {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (!(file instanceof TFile) || file.extension !== 'md') {
                    return { outcome: 'missing', filePath };
                }
                if (
                    this.hooks.validateWritePath
                    && !(await this.hooks.validateWritePath(filePath, false))
                ) {
                    return { outcome: 'invalid-target', filePath };
                }
                const validatedFile = this.app.vault.getAbstractFileByPath(filePath);
                if (!(validatedFile instanceof TFile) || validatedFile.extension !== 'md') {
                    return { outcome: 'missing', filePath };
                }
                const validatedContent = await this.app.vault.read(validatedFile);
                if (validatedContent !== mutation.expectedContent) {
                    return {
                        outcome: 'conflict',
                        filePath,
                        previousContent: validatedContent,
                    };
                }
                this.hooks.onBeforeWriteFile?.(filePath);
                await this.app.vault.modify(validatedFile, committedContent);
                committedFile = validatedFile;
            }
            return {
                outcome: 'committed',
                filePath,
                ...(mutation.expectedContent === null ? {} : { previousContent: mutation.expectedContent }),
                committedContent,
                file: committedFile,
            };
        });
    }

    /**
     * Pure companion to applyGuardedTaskSourceMutation. Runtime preview uses
     * this exact renderer so apply can compare-and-set the content that was
     * sealed without running a parallel task serialization path.
     */
    renderGuardedTaskSourceContent(
        filePath: string,
        content: string,
        taskUpdates: readonly GuardedTaskSourceFieldUpdate[],
    ): GuardedTaskSourceRenderResult {
        if (taskUpdates.every(update => update.format === 'inline')) {
            const lines = content.split('\n');
            for (const update of taskUpdates) {
                const patch = tryPatchInlineTaskLines(
                    lines,
                    filePath,
                    update.operonId,
                    update.fieldValues,
                    update.lineNumber ?? -1,
                    'merge',
                    this.keyMappings,
                );
                if (!patch.ok) {
                    return { ok: false, content, reason: patch.fallbackReason };
                }
            }
            return { ok: true, content: lines.join('\n'), reason: 'none' };
        }
        let renderedContent = content;
        for (const update of taskUpdates) {
            if (update.format === 'inline') {
                const patch = tryPatchInlineTaskLineContent(
                    renderedContent,
                    filePath,
                    update.operonId,
                    update.fieldValues,
                    update.lineNumber ?? -1,
                    'merge',
                    this.keyMappings,
                );
                if (!patch.ok) {
                    return {
                        ok: false,
                        content,
                        reason: patch.fallbackReason,
                    };
                }
                renderedContent = patch.content;
                continue;
            }
            const aggregatePatch = tryPatchAggregateYamlFrontmatter(
                renderedContent,
                update.operonId,
                update.fieldValues,
                this.keyMappings,
            );
            const patch = aggregatePatch.ok
                ? aggregatePatch
                : tryPatchYamlTaskContent(
                    renderedContent,
                    update.operonId,
                    update.fieldValues,
                    'merge',
                    this.keyMappings,
                );
            if (!patch.ok) {
                return {
                    ok: false,
                    content,
                    reason: `${aggregatePatch.fallbackReason}:${patch.fallbackReason}`,
                };
            }
            renderedContent = patch.content;
        }
        return { ok: true, content: renderedContent, reason: 'none' };
    }

    private stringifyFrontmatterScalar(value: unknown): string | null {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        return null;
    }

    /**
     * Write field values to a task's source file.
     * Looks up the task in the index, determines format (inline/yaml),
     * and writes directly to the file. Triggers reindex afterward.
     */
    async writeTaskFields(
        operonId: string,
        fieldValues: Record<string, string>,
        options: TaskWriteOptions = {},
    ): Promise<boolean> {
        const startedAt = enginePerfNow();
        const admitted = await this.runSharedTaskMutation(async permit => {
            const task = this.indexer.getTask(operonId);
            if (!task) {
                console.warn(`Operon TaskWriter [${operonId}]: task not found in index`);
                return null;
            }
            if (this.blockDuplicateConflict(operonId)) {
                console.warn(`Operon TaskWriter [${operonId}]: duplicate operonId conflict blocks direct write`);
                return null;
            }
            if (!this.taskRelationshipTargetsExist(fieldValues)) {
                console.warn(`Operon TaskWriter [${operonId}]: relationship target no longer exists`);
                return null;
            }

            const location = task.primary;
            const file = this.app.vault.getAbstractFileByPath(location.filePath);
            if (!(file instanceof TFile)) {
                console.warn(`Operon TaskWriter [${operonId}]: file not found: ${location.filePath}`);
                return null;
            }

            const mode = options.mode ?? 'merge';
            const modifiedTimestamp = (fieldValues['datetimeModified'] ?? '').trim();
            const ancestorIds = modifiedTimestamp && options.touchAncestors !== false
                ? this.collectAffectedAncestorIdsForWrite(task, fieldValues, mode)
                : new Set<string>();
            const writeResult = location.format === 'yaml'
                ? await this.writeYamlTask(file, operonId, fieldValues, mode, options, permit)
                : {
                    wrote: await this.writeInlineTask(
                        file,
                        operonId,
                        fieldValues,
                        location.lineNumber,
                        mode,
                        permit,
                    ),
                    yamlFastPath: 'none' as const,
                    fallbackReason: 'none',
                };
            if (!writeResult.wrote) {
                console.warn(`Operon TaskWriter [${operonId}]: task location could not be written: ${location.filePath}`);
                return null;
            }
            const relationshipMutation = ['parentTask', 'blocking', 'blockedBy']
                .some(key => Object.prototype.hasOwnProperty.call(fieldValues, key));
            if (relationshipMutation && (options.reindex ?? 'scheduled') === 'scheduled') {
                this.recordRelationshipTargets(operonId, fieldValues);
                await this.indexer.reindexFilePath(location.filePath, { notify: false });
                this.clearSettledRelationshipTargets(operonId);
            }
            return {
                task,
                location,
                modifiedTimestamp,
                ancestorIds,
                writeResult,
                relationshipMutation,
            };
        });
        if (!admitted) return false;
        const { location, modifiedTimestamp, ancestorIds, writeResult, relationshipMutation } = admitted;

        if (ancestorIds.size > 0 && modifiedTimestamp) {
            await this.touchAncestorModifiedTimestamps(ancestorIds, modifiedTimestamp);
        }

        if ((options.reindex ?? 'scheduled') === 'scheduled' && !relationshipMutation) {
            this.indexer.scheduleReindex(location.filePath);
        }
        enginePerfLog(
            'writeTaskFields',
            `${Math.round(enginePerfNow() - startedAt)}ms`,
            `task=${operonId}`,
            `file=${location.filePath}`,
            `fields=${Object.keys(fieldValues).join(',')}`,
            `yamlFastPath=${writeResult.yamlFastPath}`,
            `fallbackReason=${writeResult.fallbackReason}`,
        );
        return true;
    }

    private taskRelationshipTargetsExist(fieldValues: Record<string, string>): boolean {
        return this.getRelationshipTargetIds(fieldValues)
            .every(targetId => !!this.indexer.getTask(targetId));
    }

    private getRelationshipTargetIds(fieldValues: Record<string, string>): string[] {
        const targetIds: string[] = [];
        if (Object.prototype.hasOwnProperty.call(fieldValues, 'parentTask')) {
            const parentId = (fieldValues['parentTask'] ?? '').trim();
            if (parentId) targetIds.push(parentId);
        }
        for (const key of ['blocking', 'blockedBy'] as const) {
            if (!Object.prototype.hasOwnProperty.call(fieldValues, key)) continue;
            targetIds.push(...parseDependencyIdList(fieldValues[key] ?? ''));
        }
        return targetIds;
    }

    private recordRelationshipTargets(
        operonId: string,
        fieldValues: Record<string, string>,
        replace = false,
    ): void {
        const targetIds = this.getRelationshipTargetIds(fieldValues);
        if (replace) {
            if (targetIds.length > 0) {
                this.unsettledRelationshipTargets.set(operonId, new Set(targetIds));
            } else {
                this.unsettledRelationshipTargets.delete(operonId);
            }
            return;
        }
        if (targetIds.length === 0) return;
        const pending = this.unsettledRelationshipTargets.get(operonId) ?? new Set<string>();
        for (const targetId of targetIds) pending.add(targetId);
        this.unsettledRelationshipTargets.set(operonId, pending);
    }

    private clearSettledRelationshipTargets(operonId: string): void {
        const pending = this.unsettledRelationshipTargets.get(operonId);
        if (!pending) return;
        const indexed = this.indexer.getTask(operonId);
        if (!indexed) return;
        const current = new Set(this.getRelationshipTargetIds(indexed.fieldValues));
        if ([...pending].every(targetId => current.has(targetId))) {
            this.unsettledRelationshipTargets.delete(operonId);
        }
    }

    hasUnsettledRelationshipReference(targetOperonId: string): boolean {
        for (const [sourceOperonId, targets] of this.unsettledRelationshipTargets) {
            const indexed = this.indexer.getTask(sourceOperonId);
            const current = indexed
                ? new Set(this.getRelationshipTargetIds(indexed.fieldValues))
                : null;
            if (current && targets.size === current.size && [...targets].every(targetId => current.has(targetId))) {
                this.unsettledRelationshipTargets.delete(sourceOperonId);
                continue;
            }
            if (targets.has(targetOperonId)) return true;
        }
        return false;
    }

    private analyzeSourceRelationshipAuthority(content: string, filePath: string) {
        return analyzeTaskSourceRelationshipAuthority({
            content,
            filePath,
            keyMappings: this.keyMappings,
            pathIndexable: this.indexer.isPathIndexable(filePath),
            indexedTargetExists: operonId => (
                !this.indexer.hasDuplicateOperonIdConflict(operonId)
                && !!this.indexer.getTask(operonId)
            ),
        });
    }

    private recordSourceRelationshipTargets(relationships: readonly TaskSourceRelationshipRecord[]): void {
        for (const relationship of relationships) {
            if (relationship.targetIds.length > 0) {
                this.unsettledRelationshipTargets.set(
                    relationship.operonId,
                    new Set(relationship.targetIds),
                );
            } else {
                this.unsettledRelationshipTargets.delete(relationship.operonId);
            }
        }
    }

    /**
     * Change one managed task field only when the fresh source still contains
     * the expected value. The comparison and mutation share the same per-file
     * write queue, making interrupted rename retries safe and idempotent.
     */
    async writeTaskFieldIfCurrent(
        operonId: string,
        canonicalKey: string,
        expectedValue: string,
        nextValue: string,
        options: ConditionalTaskFieldWriteOptions = {},
    ): Promise<ConditionalTaskFieldWriteOutcome> {
        const task = this.indexer.getTask(operonId);
        if (task && this.blockDuplicateConflict(operonId)) {
            throw new Error(`Duplicate operonId conflict blocks conditional write for ${operonId}`);
        }
        if (!getManagedTaskFieldType(canonicalKey, this.keyMappings)) {
            throw new Error(`Conditional write does not support unmanaged field ${canonicalKey}`);
        }
        for (const expectedKey of Object.keys(options.additionalExpectedValues ?? {})) {
            if (!getManagedTaskFieldType(expectedKey, this.keyMappings)) {
                throw new Error(`Conditional write does not support unmanaged expected field ${expectedKey}`);
            }
        }

        const location = task?.primary ?? (options.fallbackLocation
            ? {
                ...options.fallbackLocation,
                lineNumber: -1,
            }
            : null);
        if (!location) return 'missing';
        const file = this.app.vault.getAbstractFileByPath(location.filePath);
        if (!(file instanceof TFile)) {
            if (options.allowMissingAfterReindex) return 'missing';
            throw new Error(`Conditional write source is not indexed or available for ${operonId}`);
        }
        const outcome = location.format === 'yaml'
            ? await this.writeYamlTaskFieldIfCurrent(
                file,
                operonId,
                canonicalKey,
                expectedValue,
                nextValue,
                options.additionalExpectedValues,
            )
            : await this.writeInlineTaskFieldIfCurrent(
                file,
                operonId,
                canonicalKey,
                expectedValue,
                nextValue,
                location.lineNumber,
                options.additionalExpectedValues,
            );
        if (outcome === 'missing' && !options.allowMissingAfterReindex) {
            throw new Error(`Conditional write could not confirm the current source for ${operonId}`);
        }
        if (outcome === 'updated' && (options.reindex ?? 'scheduled') === 'scheduled') {
            this.indexer.scheduleReindex(location.filePath);
        }
        return outcome;
    }

    /** Read fresh task source under the per-file queue without rewriting it. */
    async taskFieldsMatchCurrentSource(
        operonId: string,
        expectedValues: Record<string, string>,
    ): Promise<boolean> {
        const task = this.indexer.getTask(operonId);
        if (!task || this.blockDuplicateConflict(operonId)) return false;
        for (const expectedKey of Object.keys(expectedValues)) {
            if (!getManagedTaskFieldType(expectedKey, this.keyMappings)) return false;
        }
        const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
        if (!(file instanceof TFile)) return false;

        return await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            const content = await this.app.vault.read(file);
            if (task.primary.format === 'yaml') {
                const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
                if (!match) return false;
                const parsed: unknown = parseYaml(match[1]);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
                const frontmatter = parsed as Record<string, unknown>;
                if (!this.frontmatterMatchesOperonId(frontmatter, operonId)) return false;
                return Object.entries(expectedValues).every(([expectedKey, expectedValue]) => {
                    const resolution = this.readYamlFieldForConditionalWrite(frontmatter, expectedKey);
                    return resolution.kind !== 'ambiguous' && resolution.value === expectedValue;
                });
            }

            const lines = content.split('\n');
            const lineIndex = findTaskLineIndex(
                lines,
                file.path,
                operonId,
                task.primary.lineNumber,
                this.keyMappings,
            );
            if (lineIndex === -1) return false;
            let matchingTaskCount = 0;
            for (let index = 0; index < lines.length; index++) {
                if (parseTaskLine(lines[index], index, file.path, this.keyMappings)?.operonId === operonId) {
                    matchingTaskCount += 1;
                }
            }
            if (matchingTaskCount !== 1) return false;
            const parsed = parseTaskLine(lines[lineIndex], lineIndex, file.path, this.keyMappings);
            if (!parsed) return false;
            return Object.entries(expectedValues).every(([expectedKey, expectedValue]) => {
                const currentValues = new Set(parsed.fields
                    .filter(field => field.key === expectedKey)
                    .map(field => field.value));
                return currentValues.size <= 1 && (Array.from(currentValues)[0] ?? '') === expectedValue;
            });
        });
    }

    /** Atomically mutate one unmanaged YAML property when its raw value still matches the rendered cell. */
    async writeYamlFilePropertyIfCurrent(
        operonId: string,
        propertyName: string,
        expected: RawYamlPropertyExpectation,
        mutation: RawYamlPropertyMutation,
        options: { reindex?: 'scheduled' | 'none'; modifiedTimestamp?: string } = {},
    ): Promise<RawYamlPropertyWriteResult> {
        const task = this.indexer.getTask(operonId);
        if (!task) return { outcome: 'missing', filePath: null, current: { present: false, value: undefined } };
        if (this.blockDuplicateConflict(operonId)) {
            return { outcome: 'unsupported', filePath: task.primary.filePath, current: expected };
        }
        if (task.primary.format !== 'yaml' || !isWritableRawYamlPropertyName(propertyName, this.keyMappings)) {
            return { outcome: 'unsupported', filePath: task.primary.filePath, current: expected };
        }
        const file = this.app.vault.getAbstractFileByPath(task.primary.filePath);
        if (!(file instanceof TFile)) {
            return { outcome: 'missing', filePath: task.primary.filePath, current: { present: false, value: undefined } };
        }

        const modifiedTimestamp = options.modifiedTimestamp?.trim() ?? '';
        const result = await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            let output: RawYamlPropertyWriteResult = {
                outcome: 'missing',
                filePath: file.path,
                current: { present: false, value: undefined },
			};
			this.hooks.onBeforeWriteFile?.(file.path);
            await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
                if (!this.frontmatterMatchesOperonId(frontmatter, operonId)) return;
                const current = readRawYamlPropertyExpectation(frontmatter, propertyName);
                if (!current) {
                    output = { outcome: 'unsupported', filePath: file.path, current: expected };
                    return;
                }
                output = { outcome: 'conflict', filePath: file.path, current };
                const next = mutation.kind === 'delete'
                    ? { present: false, value: undefined } satisfies RawYamlPropertyExpectation
                    : { present: true, value: mutation.value } satisfies RawYamlPropertyExpectation;
                if (rawYamlPropertyExpectationsEqual(current, next)) {
                    output = { outcome: 'already-updated', filePath: file.path, current };
                    return;
                }
                if (!rawYamlPropertyExpectationsEqual(current, expected)) return;
                if (mutation.kind === 'delete') delete frontmatter[propertyName];
                else frontmatter[propertyName] = mutation.value;
                if (modifiedTimestamp) {
                    applyYamlTaskFieldValues(
                        frontmatter,
                        { datetimeModified: modifiedTimestamp },
                        'merge',
                        this.keyMappings,
                    );
                }
                output = { outcome: 'updated', filePath: file.path, current: next };
            });
            return output;
        });

        if (result.outcome === 'updated') {
            if (modifiedTimestamp) {
                try {
                    await this.touchTaskAncestorsModified(task, task, modifiedTimestamp);
                } catch (error: unknown) {
                    console.error(`Operon TaskWriter [${operonId}]: raw property saved but ancestor timestamp update failed`, error);
                }
            }
            if ((options.reindex ?? 'scheduled') === 'scheduled') this.indexer.scheduleReindex(file.path);
        }
        return result;
    }

    async writeInlineTaskAndAggregateYamlParent(
        childOperonId: string,
        childPayload: Record<string, string>,
        parentOperonId: string,
        parentPayload: Record<string, string>,
        options: { mode?: 'merge' | 'replace' } = {},
    ): Promise<SameFileInlineYamlAggregateWriteResult> {
        const startedAt = enginePerfNow();
        const childTask = this.indexer.getTask(childOperonId);
        const parentTask = this.indexer.getTask(parentOperonId);
        if (!childTask || !parentTask) {
            return { wrote: false, fallbackReason: 'task-missing' };
        }
        if (this.blockDuplicateConflict(childOperonId) || this.blockDuplicateConflict(parentOperonId)) {
            return { wrote: false, fallbackReason: 'duplicate-operon-id-conflict' };
        }
        if (childTask.primary.format !== 'inline' || parentTask.primary.format !== 'yaml') {
            return { wrote: false, fallbackReason: 'format-mismatch' };
        }
        if (childTask.primary.filePath !== parentTask.primary.filePath) {
            return { wrote: false, fallbackReason: 'file-mismatch' };
        }
        if (childTask.primary.lineNumber === undefined) {
            return { wrote: false, fallbackReason: 'line-missing' };
        }

        const file = this.app.vault.getAbstractFileByPath(childTask.primary.filePath);
        if (!(file instanceof TFile)) {
            return { wrote: false, fallbackReason: 'file-missing' };
        }

        const mode = options.mode ?? 'merge';
        const result = await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            const content = await this.app.vault.read(file);
            const inlinePatch = tryPatchInlineTaskLineContent(
                content,
                file.path,
                childOperonId,
                childPayload,
                childTask.primary.lineNumber ?? -1,
                mode,
                this.keyMappings,
            );
            if (!inlinePatch.ok) {
                return { wrote: false, fallbackReason: inlinePatch.fallbackReason };
            }

            const yamlPatch = tryPatchAggregateYamlFrontmatter(
                inlinePatch.content,
                parentOperonId,
                parentPayload,
                this.keyMappings,
            );
            if (!yamlPatch.ok) {
                return { wrote: false, fallbackReason: `parent-${yamlPatch.fallbackReason}` };
            }

            if (yamlPatch.content !== content) {
				this.hooks.onBeforeWriteFile?.(file.path);
				await this.app.vault.modify(file, yamlPatch.content);
            }
            return { wrote: true, fallbackReason: 'none' };
        });

        enginePerfLog(
            'writeTaskFieldsBatch',
            `${Math.round(enginePerfNow() - startedAt)}ms`,
            'sameFile=inline-yaml-aggregate',
            `file=${childTask.primary.filePath}`,
            `child=${childOperonId}`,
            `parent=${parentOperonId}`,
            `fields=child:${Object.keys(childPayload).join(',')}|parent:${Object.keys(parentPayload).join(',')}`,
            `fallbackReason=${result.fallbackReason}`,
        );
        return result;
    }

    /**
     * Write aggregate-maintained fields for several tasks that live in the same
     * file using one read + one modify. Inline lines are patched first while
     * their indexed line hints are still valid; the YAML frontmatter patch runs
     * last because it may add frontmatter lines and shift every line below it.
     * Entries that cannot be patched are reported back so the caller can fall
     * back to individual writes (which carry the full YAML fallback path).
     */
    async writeAggregateFieldsSameFile(
        filePath: string,
        entries: AggregateSameFileWriteEntry[],
    ): Promise<AggregateSameFileWriteResult> {
        const startedAt = enginePerfNow();
        const failedOperonIds: string[] = [];
        const inlineEntries: Array<AggregateSameFileWriteEntry & { lineHint: number }> = [];
        const yamlEntries: AggregateSameFileWriteEntry[] = [];
        for (const entry of entries) {
            const task = this.indexer.getTask(entry.operonId);
            if (!task || task.primary.filePath !== filePath || this.blockDuplicateConflict(entry.operonId)) {
                failedOperonIds.push(entry.operonId);
                continue;
            }
            if (task.primary.format === 'yaml') {
                yamlEntries.push(entry);
            } else {
                inlineEntries.push({ ...entry, lineHint: task.primary.lineNumber ?? -1 });
            }
        }

        const file = this.app.vault.getAbstractFileByPath(filePath);
        const wroteOperonIds: string[] = [];
        let lineNumbersShifted = false;
        if (!(file instanceof TFile)) {
            return {
                wroteOperonIds,
                failedOperonIds: entries.map(entry => entry.operonId),
                lineNumbersShifted,
            };
        }

        if (inlineEntries.length > 0 || yamlEntries.length > 0) {
            await this.enqueueFileMutation(this.getFileWriteQueueKey(filePath), async () => {
                const original = await this.app.vault.read(file);
                let content = original;
                for (const entry of inlineEntries) {
                    const patch = tryPatchInlineTaskLineContent(
                        content,
                        filePath,
                        entry.operonId,
                        entry.fieldValues,
                        entry.lineHint,
                        'merge',
                        this.keyMappings,
                    );
                    if (!patch.ok) {
                        failedOperonIds.push(entry.operonId);
                        continue;
                    }
                    content = patch.content;
                    wroteOperonIds.push(entry.operonId);
                }
                for (const entry of yamlEntries) {
                    const patch = tryPatchAggregateYamlFrontmatter(
                        content,
                        entry.operonId,
                        entry.fieldValues,
                        this.keyMappings,
                    );
                    if (!patch.ok) {
                        failedOperonIds.push(entry.operonId);
                        continue;
                    }
                    content = patch.content;
                    wroteOperonIds.push(entry.operonId);
                }
                if (wroteOperonIds.length > 0 && content !== original) {
                    lineNumbersShifted = content.split('\n').length !== original.split('\n').length;
					this.hooks.onBeforeWriteFile?.(file.path);
					await this.app.vault.modify(file, content);
                }
            });
        }

        enginePerfLog(
            'writeTaskFieldsBatch',
            `${Math.round(enginePerfNow() - startedAt)}ms`,
            'sameFile=aggregate-multi',
            `file=${filePath}`,
            `tasks=${entries.length}`,
            `wrote=${wroteOperonIds.length}`,
            `failed=${failedOperonIds.length}`,
            `lineNumbersShifted=${String(lineNumbersShifted)}`,
        );
        return { wroteOperonIds, failedOperonIds, lineNumbersShifted };
    }

    /**
     * Touch the modified timestamp of every ancestor affected by a task mutation.
     * Walks parentTask upward only; descendants and siblings are never touched.
     */
    async touchTaskAncestorsModified(
        beforeTask: IndexedTask | null | undefined,
        afterTask: IndexedTask | null | undefined,
        timestamp: string,
    ): Promise<void> {
        const normalizedTimestamp = timestamp.trim();
        if (!normalizedTimestamp) return;

        const ancestorIds = new Set<string>();
        const blockedIds = new Set<string>();
        if (beforeTask?.operonId) blockedIds.add(beforeTask.operonId);
        if (afterTask?.operonId) blockedIds.add(afterTask.operonId);

        this.collectAncestorIdsFromParentId(beforeTask?.fieldValues['parentTask'] ?? '', ancestorIds, blockedIds);
        this.collectAncestorIdsFromParentId(afterTask?.fieldValues['parentTask'] ?? '', ancestorIds, blockedIds);

        await this.touchAncestorModifiedTimestamps(ancestorIds, normalizedTimestamp);
    }

    private collectAffectedAncestorIdsForWrite(
        task: IndexedTask,
        fieldValues: Record<string, string>,
        mode: 'merge' | 'replace',
    ): Set<string> {
        const ancestorIds = new Set<string>();
        const blockedIds = new Set<string>([task.operonId]);
        const beforeParentId = task.fieldValues['parentTask'] ?? '';
        const afterParentId = this.resolveWrittenParentTaskId(task, fieldValues, mode);

        this.collectAncestorIdsFromParentId(beforeParentId, ancestorIds, blockedIds);
        this.collectAncestorIdsFromParentId(afterParentId, ancestorIds, blockedIds);

        return ancestorIds;
    }

    private resolveWrittenParentTaskId(
        task: IndexedTask,
        fieldValues: Record<string, string>,
        mode: 'merge' | 'replace',
    ): string {
        if (Object.prototype.hasOwnProperty.call(fieldValues, 'parentTask')) {
            return fieldValues['parentTask'] ?? '';
        }
        if (mode === 'replace') {
            return '';
        }
        return task.fieldValues['parentTask'] ?? '';
    }

    private collectAncestorIdsFromParentId(
        parentId: string | null | undefined,
        output: Set<string>,
        blockedIds: Set<string>,
    ): void {
        let currentId = (parentId ?? '').trim();
        const visited = new Set<string>();
        let depth = 0;

        while (currentId && depth < 100) {
            if (blockedIds.has(currentId)) return;
            if (visited.has(currentId)) return;

            visited.add(currentId);
            output.add(currentId);

            const currentTask = this.indexer.getTask(currentId);
            currentId = (currentTask?.fieldValues['parentTask'] ?? '').trim();
            depth++;
        }
    }

    private async touchAncestorModifiedTimestamps(
        ancestorIds: Set<string>,
        timestamp: string,
    ): Promise<void> {
        const touchedFilePaths = new Set<string>();
        const ancestorsByFile = new Map<string, string[]>();
        const missingAncestorIds: string[] = [];
        for (const ancestorId of ancestorIds) {
            const ancestorTask = this.indexer.getTask(ancestorId);
            if (!ancestorTask) {
                missingAncestorIds.push(ancestorId);
                continue;
            }
            ancestorTask.fieldValues['datetimeModified'] = timestamp;
            touchedFilePaths.add(ancestorTask.primary.filePath);
            const group = ancestorsByFile.get(ancestorTask.primary.filePath) ?? [];
            group.push(ancestorId);
            ancestorsByFile.set(ancestorTask.primary.filePath, group);
        }
        for (const ancestorId of missingAncestorIds) {
            await this.writeTaskFields(ancestorId, { datetimeModified: timestamp }, {
                reindex: 'none',
                touchAncestors: false,
            });
        }
        for (const [filePath, fileAncestorIds] of ancestorsByFile) {
            const written = new Set<string>();
            if (fileAncestorIds.length > 1) {
                const batch = await this.writeAggregateFieldsSameFile(
                    filePath,
                    fileAncestorIds.map(operonId => ({
                        operonId,
                        fieldValues: { datetimeModified: timestamp },
                    })),
                );
                for (const operonId of batch.wroteOperonIds) {
                    written.add(operonId);
                }
            }
            for (const operonId of fileAncestorIds) {
                if (written.has(operonId)) continue;
                await this.writeTaskFields(operonId, { datetimeModified: timestamp }, {
                    reindex: 'none',
                    touchAncestors: false,
                });
            }
        }
        if (touchedFilePaths.size > 0) {
            await this.indexer.reindexFilesBatch(Array.from(touchedFilePaths), { notify: false });
        }
    }

    /**
     * Write field values to a YAML frontmatter task.
     * Uses a single processFrontMatter call for atomicity — field writes,
     * date clearing, and tag updates all happen in one pass.
     */
    private async writeYamlTask(
        file: TFile,
        operonId: string,
        fieldValues: Record<string, string>,
        mode: 'merge' | 'replace',
        options: TaskWriteOptions,
        permit?: TaskWriterSharedMutationPermit,
    ): Promise<TaskWriteResult> {
        return await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            let yamlFastPath: YamlFastPathState = 'none';
            let fallbackReason = 'none';
            if (options.yamlAggregateFastPath && mode === 'merge') {
				const content = await this.app.vault.read(file);
                const patchResult = tryPatchAggregateYamlFrontmatter(content, operonId, fieldValues, this.keyMappings);
                if (patchResult.ok) {
                    if (patchResult.content !== content) {
						this.hooks.onBeforeWriteFile?.(file.path);
						await this.app.vault.modify(file, patchResult.content);
                    }
                    return {
                        wrote: true,
                        yamlFastPath: 'aggregate',
                        fallbackReason: 'none',
                    };
                }
                yamlFastPath = 'fallback';
                fallbackReason = patchResult.fallbackReason;
            }
            let formattingPlan: YamlFrontmatterFormattingPlan = {
                blankYamlKeys: new Set<string>(),
                removedYamlKeys: new Set<string>(),
            };
            const nextFieldValues: Record<string, string> = { ...fieldValues };
            let wroteTask = false;
			this.hooks.onBeforeWriteFile?.(file.path);
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
                if (!this.frontmatterMatchesOperonId(fm, operonId)) {
                    return;
                }
                wroteTask = true;
                if (!Object.prototype.hasOwnProperty.call(nextFieldValues, 'datetimeCreated')) {
                    const createdAliases = getManagedYamlAliases('datetimeCreated', this.keyMappings);
                    const hasExistingCreated = createdAliases.some((yamlKey) => {
                        const rawValue = fm[yamlKey];
                        const rawText = this.stringifyFrontmatterScalar(rawValue);
                        return rawText !== null && rawText.trim() !== '';
                    });
                    if (!hasExistingCreated) {
                        const createdFallback = resolveYamlTaskCreatedBackfillValue(file.stat.ctime);
                        if (createdFallback) {
                            nextFieldValues['datetimeCreated'] = createdFallback;
                        }
                    }
                }
                formattingPlan = applyYamlTaskFieldValues(fm, nextFieldValues, mode, this.keyMappings);
            });

            if (!wroteTask) {
                return { wrote: false, yamlFastPath, fallbackReason };
            }
            if (formattingPlan.blankYamlKeys.size > 0 || formattingPlan.removedYamlKeys.size > 0) {
                const content = await this.app.vault.read(file);
                const normalized = normalizeYamlFrontmatterFormatting(content, formattingPlan);
                if (normalized !== content) {
					this.hooks.onBeforeWriteFile?.(file.path);
                    await this.app.vault.modify(file, normalized);
                }
            }
            return { wrote: true, yamlFastPath, fallbackReason };
        }, permit);
    }

    /**
     * Write field values to an inline task line.
     */
    private async writeInlineTask(
        file: TFile,
        operonId: string,
        fieldValues: Record<string, string>,
        lineHint: number,
        mode: 'merge' | 'replace',
        permit?: TaskWriterSharedMutationPermit,
    ): Promise<boolean> {
        return await this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            const content = await this.app.vault.read(file);
            const patch = tryPatchInlineTaskLineContent(
                content,
                file.path,
                operonId,
                fieldValues,
                lineHint,
                mode,
                this.keyMappings,
            );
			if (!patch.ok) return false;
			if (patch.content !== content) {
				this.hooks.onBeforeWriteFile?.(file.path);
				await this.app.vault.modify(file, patch.content);
			}
            return true;
        }, permit);
    }

    private async writeYamlTaskFieldIfCurrent(
        file: TFile,
        operonId: string,
        canonicalKey: string,
        expectedValue: string,
        nextValue: string,
        additionalExpectedValues: Record<string, string> = {},
    ): Promise<ConditionalTaskFieldWriteOutcome> {
        return this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            let outcome: ConditionalTaskFieldWriteOutcome = 'missing';
            let didUpdate = false;
            let formattingPlan: YamlFrontmatterFormattingPlan = {
                blankYamlKeys: new Set<string>(),
                removedYamlKeys: new Set<string>(),
			};
			this.hooks.onBeforeWriteFile?.(file.path);
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
                if (!this.frontmatterMatchesOperonId(frontmatter, operonId)) return;
                for (const [expectedKey, expectedFieldValue] of Object.entries(additionalExpectedValues)) {
                    const expectedResolution = this.readYamlFieldForConditionalWrite(frontmatter, expectedKey);
                    if (expectedResolution.kind === 'ambiguous' || expectedResolution.value !== expectedFieldValue) {
                        outcome = 'conflict';
                        return;
                    }
                }
                const currentResolution = this.readYamlFieldForConditionalWrite(frontmatter, canonicalKey);
                if (currentResolution.kind === 'ambiguous') {
                    outcome = 'conflict';
                    return;
                }
                const currentValue = currentResolution.value;
                if (currentValue === nextValue) {
                    outcome = 'already-updated';
                    return;
                }
                if (currentValue !== expectedValue) {
                    outcome = 'conflict';
                    return;
                }
                formattingPlan = applyYamlTaskFieldValues(
                    frontmatter,
                    { [canonicalKey]: nextValue },
                    'merge',
                    this.keyMappings,
                );
                outcome = 'updated';
                didUpdate = true;
            });

            if (
                didUpdate
                && (formattingPlan.blankYamlKeys.size > 0 || formattingPlan.removedYamlKeys.size > 0)
            ) {
                const content = await this.app.vault.read(file);
                const normalized = normalizeYamlFrontmatterFormatting(content, formattingPlan);
				if (normalized !== content) {
					this.hooks.onBeforeWriteFile?.(file.path);
					await this.app.vault.modify(file, normalized);
				}
            }
            return outcome;
        });
    }

    private async writeInlineTaskFieldIfCurrent(
        file: TFile,
        operonId: string,
        canonicalKey: string,
        expectedValue: string,
        nextValue: string,
        lineHint: number,
        additionalExpectedValues: Record<string, string> = {},
    ): Promise<ConditionalTaskFieldWriteOutcome> {
        return this.enqueueFileMutation(this.getFileWriteQueueKey(file.path), async () => {
            let outcome: ConditionalTaskFieldWriteOutcome = 'missing';
			this.hooks.onBeforeWriteFile?.(file.path);
			await this.app.vault.process(file, content => {
                const lines = content.split('\n');
                const taskLineIndex = findTaskLineIndex(
                    lines,
                    file.path,
                    operonId,
                    lineHint,
                    this.keyMappings,
                );
                if (taskLineIndex === -1) return content;
				let matchingTaskCount = 0;
				for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
					if (parseTaskLine(lines[lineIndex], lineIndex, file.path, this.keyMappings)?.operonId === operonId) {
						matchingTaskCount += 1;
					}
				}
				if (matchingTaskCount > 1) {
					outcome = 'conflict';
					return content;
				}
                const parsed = parseTaskLine(
                    lines[taskLineIndex],
                    taskLineIndex,
                    file.path,
                    this.keyMappings,
                );
                if (!parsed) throw new Error(`Unable to parse inline task ${operonId} during conditional write`);

                const readCurrentValue = (fieldKey: string): string | null => {
                    const currentValues = new Set<string>();
                    for (const field of parsed.fields) {
                        if (field.key === fieldKey) currentValues.add(field.value);
                    }
                    if (currentValues.size > 1) return null;
                    return Array.from(currentValues)[0] ?? '';
                };
                for (const [expectedKey, expectedFieldValue] of Object.entries(additionalExpectedValues)) {
                    const currentExpectedValue = readCurrentValue(expectedKey);
                    if (currentExpectedValue === null || currentExpectedValue !== expectedFieldValue) {
                        outcome = 'conflict';
                        return content;
                    }
                }
                const currentValue = readCurrentValue(canonicalKey);
                if (currentValue === null) {
                    outcome = 'conflict';
                    return content;
                }
                if (currentValue === nextValue) {
                    outcome = 'already-updated';
                    return content;
                }
                if (currentValue !== expectedValue) {
                    outcome = 'conflict';
                    return content;
                }

                const patch = tryPatchInlineTaskLineContent(
                    content,
                    file.path,
                    operonId,
                    { [canonicalKey]: nextValue },
                    taskLineIndex,
                    'merge',
                    this.keyMappings,
                );
                if (!patch.ok) {
                    throw new Error(`Unable to patch inline task ${operonId}: ${patch.fallbackReason}`);
                }
                outcome = 'updated';
                return patch.content;
            });
            return outcome;
        });
    }

    private getFileWriteQueueKey(filePath: string): string {
        return `task-file:${filePath}`;
    }

    private parseYamlFrontmatter(content: string): Record<string, unknown> | null {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
        if (!match) return null;
        try {
            const parsed: unknown = parseYaml(match[1]);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : null;
        } catch {
            return null;
        }
    }

    private frontmatterHasExactSingleOperonId(frontmatter: Record<string, unknown>, operonId: string): boolean {
        const identityEntries = getManagedYamlAliases('operonId', this.keyMappings)
            .filter(yamlKey => Object.prototype.hasOwnProperty.call(frontmatter, yamlKey))
            .map(yamlKey => this.stringifyFrontmatterScalar(frontmatter[yamlKey]))
            .filter((value): value is string => value !== null);
        return identityEntries.length === 1 && identityEntries[0].trim() === operonId;
    }

	private collectPlainFileTaskPropertyOptions(
        frontmatter: Record<string, unknown>,
    ): PlainFileTaskPropertyOption[] {
        const candidateKeys = new Set<string>([
            ...CANONICAL_KEYS.map(key => key.name),
            ...this.keyMappings.map(mapping => mapping.canonicalKey),
        ]);
        const options: PlainFileTaskPropertyOption[] = [];
        for (const canonicalKey of candidateKeys) {
            if (!isManagedTaskFieldCanonicalKey(canonicalKey, this.keyMappings)) continue;
            const presentAliases = getManagedYamlAliases(canonicalKey, this.keyMappings)
                .filter(yamlKey => Object.prototype.hasOwnProperty.call(frontmatter, yamlKey));
            if (presentAliases.length === 0) continue;
            const mapping = this.keyMappings.find(candidate => candidate.canonicalKey === canonicalKey);
            const canonical = CANONICAL_KEY_MAP.get(canonicalKey);
            options.push({
                canonicalKey,
                propertyName: presentAliases[0] ?? getVisiblePropertyName(canonicalKey, this.keyMappings),
                description: mapping?.description?.trim() || canonical?.description || canonicalKey,
                internal: mapping?.isInternal === true || isInternalCanonicalKey(canonicalKey),
            });
        }
		return options.sort((left, right) => {
            if (left.canonicalKey === 'operonId') return -1;
            if (right.canonicalKey === 'operonId') return 1;
            return left.propertyName.localeCompare(right.propertyName);
		});
	}

    private blockDuplicateConflict(operonId: string): boolean {
        const indexer = this.indexer as OperonIndexer & {
            hasDuplicateOperonIdConflict?: (id: string) => boolean;
        };
        if (typeof indexer.hasDuplicateOperonIdConflict !== 'function') {
            return false;
        }
        if (!indexer.hasDuplicateOperonIdConflict(operonId)) {
            return false;
        }
        this.hooks.onDuplicateConflict?.(operonId);
        return true;
    }

    private frontmatterMatchesOperonId(frontmatter: Record<string, unknown>, operonId: string): boolean {
        const aliases = getManagedYamlAliases('operonId', this.keyMappings);
        for (const yamlKey of aliases) {
            const value = frontmatter[yamlKey];
            const rawText = this.stringifyFrontmatterScalar(value);
            if (rawText === null) continue;
            if (rawText.trim() === operonId) return true;
        }
        return false;
    }

    private readYamlFieldForConditionalWrite(
        frontmatter: Record<string, unknown>,
        canonicalKey: string,
    ): { kind: 'value'; value: string } | { kind: 'ambiguous' } {
        const values = new Set<string>();
        for (const yamlKey of getManagedYamlAliases(canonicalKey, this.keyMappings)) {
            if (!Object.prototype.hasOwnProperty.call(frontmatter, yamlKey)) continue;
            const rawValue = frontmatter[yamlKey];
            if (rawValue === null || rawValue === undefined) {
                values.add('');
                continue;
            }
            const scalar = this.stringifyFrontmatterScalar(rawValue);
            if (scalar === null) return { kind: 'ambiguous' };
            values.add(scalar);
        }
        if (values.size > 1) return { kind: 'ambiguous' };
        return { kind: 'value', value: Array.from(values)[0] ?? '' };
    }

    private buildReverseKeyMap(): Map<string, string> {
        const reverse = new Map<string, string>();
        for (const mapping of this.keyMappings) {
            if (!mapping.visiblePropertyName) continue;
            reverse.set(mapping.visiblePropertyName, mapping.canonicalKey);
        }
        return reverse;
    }
}
