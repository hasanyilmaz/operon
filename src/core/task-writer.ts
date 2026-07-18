/**
 * Direct task writer for Operon.
 * Writes field values directly to a task's source file (inline or YAML).
 * No sync, no locks, no debounce — just a clean write to the single task instance.
 *
 * Replaces SyncEngine.scheduleSync() for systems that need to update
 * other tasks' files (dependency manager, AggregateCoordinator, etc.).
 */

import { App, parseYaml, TFile } from 'obsidian';
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
import { getManagedYamlAliases } from './yaml-fields';
import { resolveYamlTaskCreatedBackfillValue } from './yaml-task-file-stat-sync';
import { WriteQueue } from '../storage/write-queue';
import { enginePerfLog, enginePerfNow } from './engine-perf';
import { getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from './managed-task-fields';
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
    onDuplicateConflict?: (operonId: string) => void;
}

type YamlFastPathState = 'aggregate' | 'fallback' | 'none';

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
    const taskLineIndex = findTaskLineIndex(lines, filePath, operonId, lineHint, keyMappings);
    if (taskLineIndex === -1) {
        return { ok: false, content, fallbackReason: 'inline-task-not-found' };
    }

    const parsed = parseTaskLine(lines[taskLineIndex], taskLineIndex, filePath, keyMappings);
    if (!parsed) {
        return { ok: false, content, fallbackReason: 'inline-task-parse-failed' };
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

    for (const [key, value] of Object.entries(fieldValues)) {
        if (key.startsWith('_')) continue;
        if (key === 'pinned') continue;
        const fieldType = getManagedTaskFieldType(key, keyMappings);
        if (!fieldType) continue;

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
    return { ok: true, content: lines.join('\n'), fallbackReason: 'none' };
}

export class TaskWriter {
    private app: App;
    private indexer: OperonIndexer;
    private keyMappings: KeyMapping[];
    private hooks: TaskWriterHooks;
    private fileWriteQueue = new WriteQueue();

    constructor(app: App, indexer: OperonIndexer, keyMappings: KeyMapping[], hooks: TaskWriterHooks = {}) {
        this.app = app;
        this.indexer = indexer;
        this.keyMappings = keyMappings;
        this.hooks = hooks;
    }

    /** Update key mappings when settings change. */
    updateKeyMappings(keyMappings: KeyMapping[]): void {
        this.keyMappings = keyMappings;
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
        const task = this.indexer.getTask(operonId);
        if (!task) {
            console.warn(`Operon TaskWriter [${operonId}]: task not found in index`);
            return false;
        }
        if (this.blockDuplicateConflict(operonId)) {
            console.warn(`Operon TaskWriter [${operonId}]: duplicate operonId conflict blocks direct write`);
            return false;
        }

        const location = task.primary;
        const file = this.app.vault.getAbstractFileByPath(location.filePath);
        if (!(file instanceof TFile)) {
            console.warn(`Operon TaskWriter [${operonId}]: file not found: ${location.filePath}`);
            return false;
        }

        const mode = options.mode ?? 'merge';
        const modifiedTimestamp = (fieldValues['datetimeModified'] ?? '').trim();
        const ancestorIds = modifiedTimestamp && options.touchAncestors !== false
            ? this.collectAffectedAncestorIdsForWrite(task, fieldValues, mode)
            : new Set<string>();

        const writeResult = location.format === 'yaml'
            ? await this.writeYamlTask(file, operonId, fieldValues, mode, options)
            : {
                wrote: await this.writeInlineTask(file, operonId, fieldValues, location.lineNumber, mode),
                yamlFastPath: 'none' as const,
                fallbackReason: 'none',
            };
        if (!writeResult.wrote) {
            console.warn(`Operon TaskWriter [${operonId}]: task location could not be written: ${location.filePath}`);
            return false;
        }

        if (ancestorIds.size > 0 && modifiedTimestamp) {
            await this.touchAncestorModifiedTimestamps(ancestorIds, modifiedTimestamp);
        }

        if ((options.reindex ?? 'scheduled') === 'scheduled') {
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

        return await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
        const result = await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
        const result = await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
            await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(filePath), async () => {
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
    ): Promise<TaskWriteResult> {
        return await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
        });
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
    ): Promise<boolean> {
        return await this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
        });
    }

    private async writeYamlTaskFieldIfCurrent(
        file: TFile,
        operonId: string,
        canonicalKey: string,
        expectedValue: string,
        nextValue: string,
        additionalExpectedValues: Record<string, string> = {},
    ): Promise<ConditionalTaskFieldWriteOutcome> {
        return this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
        return this.fileWriteQueue.enqueue(this.getFileWriteQueueKey(file.path), async () => {
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
