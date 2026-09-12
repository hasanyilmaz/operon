import { parseYaml, stringifyYaml } from 'obsidian';
import { isValidOperonId } from './id-generator';
import { markdownBodyStartLine } from './markdown-body';
import { iterateMarkdownLinesOutsideFences } from './markdown-fenced-lines';
import { parseTaskLine } from './parser';
import { getManagedYamlAliases } from './yaml-fields';
import { applyYamlTaskFieldValues, normalizeYamlFrontmatterFormatting } from './task-writer-yaml';
import { patchInlineTaskIdRepairFields, planInlineTaskIdRepair, type TaskIdRepairSourceField } from './task-id-repair';
import { repairMarkdownTaskCardReferences } from './task-id-repair-embeds';
import { TaskIdReferenceRepair } from './task-id-repair-references';
import type { ParsedTask } from '../types/fields';
import type { KeyMapping } from '../types/settings';

export interface TaskIdRepairSource { filePath: string; content: string }
export type TaskIdRepairTarget =
	| (Pick<ParsedTask, 'filePath' | 'lineNumber' | 'rawLine' | 'operonId'> & { format: 'inline' })
	| { format: 'yaml'; filePath: string; expectedContent: string; operonId: string };
export interface TaskIdRepairSourceChange { filePath: string; before: string; after: string }
export type TaskIdRepairSourcesPlan =
	| { ok: true; changes: TaskIdRepairSourceChange[]; readSet: TaskIdRepairSource[]; previousId: string | null; nextId: string; ambiguousFilterIdentity: boolean }
	| { ok: false; reason: string };

type RepairValues = Partial<Record<TaskIdRepairSourceField, string>>;
interface SourceTask {
	filePath: string;
	format: 'inline' | 'yaml';
	lineNumber: number;
	identities: string[];
	parsed?: ParsedTask;
	frontmatter?: Record<string, unknown>;
	updates: RepairValues;
	yamlRawUpdates?: Record<string, unknown>;
}
const REFERENCE_FIELDS = ['parentTask', 'blocking', 'blockedBy', 'related'] as const;

function scalar(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	throw new Error('Unsupported task identity or reference value');
}

function yamlValues(data: Record<string, unknown>, key: string, mappings: KeyMapping[]): unknown[] {
	return getManagedYamlAliases(key, mappings).filter(alias => Object.prototype.hasOwnProperty.call(data, alias)).map(alias => data[alias]);
}

function sourceReference(task: SourceTask, key: typeof REFERENCE_FIELDS[number], mappings: KeyMapping[]): string | null {
	if (task.parsed) {
		const fields = task.parsed.fields.filter(field => field.key === key);
		if (fields.length > 1) throw new Error('Ambiguous task reference fields');
		return (key === 'parentTask' ? fields[0]?.value : fields[0]?.rawValue) ?? null;
	}
	const values = yamlValues(task.frontmatter ?? {}, key, mappings);
	if (values.length > 1) throw new Error('Ambiguous YAML reference aliases');
	if (values.length === 0) return null;
	return Array.isArray(values[0]) ? values[0].map(scalar).join('; ') : scalar(values[0]);
}

function prepareYamlReferenceUpdates(task: SourceTask, repair: TaskIdReferenceRepair, mappings: KeyMapping[]): void {
	const frontmatter = task.frontmatter ?? {};
	for (const key of REFERENCE_FIELDS) {
		const values = yamlValues(frontmatter, key, mappings);
		if (values.length > 1) throw new Error('Ambiguous YAML reference aliases');
		if (values.length === 0 || values[0] === null) continue;
		const previous = values[0];
		let changed = false;
		const replaceItem = (item: unknown): unknown => {
			const id = scalar(item);
			const next = repair.id(id.trim());
			if (next === id.trim()) return item;
			changed = true;
			return next;
		};
		let next: unknown = previous;
		if (Array.isArray(previous)) next = previous.map(replaceItem);
		else if (key === 'parentTask') next = replaceItem(previous);
		else {
			const text = scalar(previous);
			const transformed = repair.list(text, 'plain');
			if (transformed !== text) { next = transformed; changed = true; }
		}
		if (!changed) continue;
		(task.yamlRawUpdates ??= {})[key] = next;
		// The shared YAML field applier establishes the mapped key. Restore the
		// typed value below so unrelated array items never take a string round trip.
		task.updates[key] = repair.nextId;
	}
}

function renderYamlRepair(content: string, task: SourceTask, mappings: KeyMapping[]): string {
	const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
	if (!match || !task.frontmatter) throw new Error('Missing YAML source');
	if (yamlValues(task.frontmatter, 'datetimeModified', mappings).length > 1) throw new Error('Ambiguous YAML timestamp aliases');
	const mutable = { ...task.frontmatter };
	const formatting = applyYamlTaskFieldValues(mutable, task.updates, 'merge', mappings);
	for (const [key, value] of Object.entries(task.yamlRawUpdates ?? {})) {
		const aliases = getManagedYamlAliases(key, mappings).filter(alias => Object.prototype.hasOwnProperty.call(mutable, alias));
		if (aliases.length !== 1) throw new Error('Ambiguous YAML reference output');
		mutable[aliases[0]] = value;
	}
	return normalizeYamlFrontmatterFormatting(`${match[1]}${stringifyYaml(mutable).trimEnd()}${match[3]}${content.slice(match[0].length)}`, formatting);
}

/**
 * Plans one explicit identity repair across a complete, fresh Markdown read set.
 * No I/O occurs here. The coordinator must revalidate the read set and commit the
 * resulting changes together with the state-store reference plan.
 */
export function planTaskIdRepairSources(
	sources: readonly TaskIdRepairSource[],
	target: TaskIdRepairTarget,
	nextId: string,
	modifiedAt: string,
	keyMappings: KeyMapping[] = [],
): TaskIdRepairSourcesPlan {
	try {
		if (!isValidOperonId(nextId) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(modifiedAt)) throw new Error('Invalid repair values');
		if (target.operonId && isValidOperonId(target.operonId)) throw new Error('Task identity is already compatible');
		const byPath = new Map<string, string>();
		const tasks: SourceTask[] = [];
		for (const source of sources) {
			if (byPath.has(source.filePath)) throw new Error('Duplicate source path in repair inventory');
			byPath.set(source.filePath, source.content);
			const lines = source.content.split('\n');
			const bodyStart = markdownBodyStartLine(lines);
			if (bodyStart === null) throw new Error(`Unclosed frontmatter: ${source.filePath}`);
			if (bodyStart > 0) {
				const header = lines.slice(1, bodyStart - 1).join('\n');
				let yaml: unknown;
				try { yaml = parseYaml(header); }
				catch {
					const identities = [target.operonId?.trim(), nextId].filter((id): id is string => !!id);
					if (source.filePath === target.filePath || header.includes('\\') || header.includes("''") || /\s/u.test(target.operonId?.trim() ?? '') || identities.some(id => header.toLowerCase().includes(id.toLowerCase()))) {
						throw new Error(`Cannot regenerate ID: invalid YAML properties in ${source.filePath}. Fix that file's properties and try again.`);
					}
					// An unrelated malformed header must not prevent repairing inline tasks elsewhere.
					yaml = null;
				}

				if (yaml !== null && yaml !== undefined && (typeof yaml !== 'object' || Array.isArray(yaml))) throw new Error('Unsupported frontmatter root');
				const frontmatter = (yaml ?? {}) as Record<string, unknown>;
				const ids = yamlValues(frontmatter, 'operonId', keyMappings).map(scalar);
				if (ids.length > 0) tasks.push({ filePath: source.filePath, format: 'yaml', lineNumber: -1, identities: ids, frontmatter, updates: {} });
			}
			for (const [offset, rawLine] of iterateMarkdownLinesOutsideFences(lines.slice(bodyStart).join('\n'), true)) {
				const parsed = parseTaskLine(rawLine, bodyStart + offset, source.filePath, keyMappings);
				if (!parsed || parsed.fields.length === 0) continue;
				tasks.push({ filePath: source.filePath, format: 'inline', lineNumber: parsed.lineNumber,
					identities: parsed.fields.filter(field => field.key === 'operonId').map(field => field.value), parsed, updates: {} });
			}
		}
		const tasksByPath = new Map<string, SourceTask[]>();
		const tasksByIdentity = new Map<string, SourceTask[]>();
		for (const task of tasks) {
			const byFile = tasksByPath.get(task.filePath) ?? [];
			byFile.push(task);
			tasksByPath.set(task.filePath, byFile);
			for (const id of new Set(task.identities.map(value => value.trim()).filter(Boolean))) {
				const owners = tasksByIdentity.get(id) ?? [];
				owners.push(task);
				tasksByIdentity.set(id, owners);
			}
		}
		const content = byPath.get(target.filePath);
		if (content === undefined) throw new Error('Task source is missing');
		const selected = (tasksByPath.get(target.filePath) ?? []).filter(task => task.format === target.format
			&& (target.format === 'yaml' || task.lineNumber === target.lineNumber));
		if (selected.length !== 1 || selected[0].identities.length > 1) throw new Error('Ambiguous task source');
		const owner = selected[0];
		if (target.format === 'inline') {
			const sourcePlan = planInlineTaskIdRepair(content, target, nextId, modifiedAt, new Set(), keyMappings);
			if (!sourcePlan.ok) throw new Error(sourcePlan.reason);
		} else if (content !== target.expectedContent || owner.identities[0] !== target.operonId) {
			throw new Error('Task source changed');
		}
		const previousId = target.operonId;
		const normalizedPreviousId = previousId?.trim() ?? '';
		const matchesOwner = (id: string): boolean => !!normalizedPreviousId && id.trim() === normalizedPreviousId;
		if (tasks.some(task => task.identities.some(id => id.trim().toLowerCase() === nextId))) throw new Error('Replacement ID is occupied');
		if (normalizedPreviousId && tasks.filter(task => task.identities.some(matchesOwner)).length !== 1) throw new Error('Ambiguous task ID ownership');
		const ambiguousFilterIdentity = !!normalizedPreviousId && tasks.filter(task => task.identities.some(id => id.trim().toLowerCase() === normalizedPreviousId.toLowerCase())).length > 1;
		const repair = new TaskIdReferenceRepair(previousId, nextId);
		owner.updates.operonId = nextId;
		for (const task of tasks) {
			if (task.format === 'yaml') prepareYamlReferenceUpdates(task, repair, keyMappings);
			else for (const key of REFERENCE_FIELDS) {
				const value = sourceReference(task, key, keyMappings);
				if (value === null) continue;
				const transformed = key === 'parentTask' ? repair.id(value.trim()) : repair.list(value, task.parsed ? 'inline' : 'plain');
				if (transformed !== (key === 'parentTask' ? value.trim() : value)) task.updates[key] = transformed;
			}
			if (Object.keys(task.updates).length > 0) task.updates.datetimeModified = modifiedAt;
		}
		// A changed child also changes its parent's modification timestamp. Follow
		// source relationships, not an index that omits invalid or cold identities.
		const queue = tasks.filter(task => Object.keys(task.updates).length > 0);
		const visited = new Set<SourceTask>();
		for (let cursor = 0; cursor < queue.length; cursor++) {
			const task = queue[cursor];
			if (visited.has(task)) continue;
			visited.add(task);
			const parentId = sourceReference(task, 'parentTask', keyMappings)?.trim();
			if (!parentId) continue;
			const parents = tasksByIdentity.get(parentId) ?? [];
			if (parents.length > 1) throw new Error('Ambiguous parent task identity');
			if (parents[0]) { parents[0].updates.datetimeModified = modifiedAt; queue.push(parents[0]); }
		}
		const changes: TaskIdRepairSourceChange[] = [];
		for (const [filePath, before] of byPath) {
			const lines = before.split('\n');
			const changed = (tasksByPath.get(filePath) ?? []).filter(task => Object.keys(task.updates).length > 0);
			if (changed.some(task => task.identities.length > 1)) throw new Error('Ambiguous changed task identity');
			for (const task of changed.filter(task => task.format === 'inline')) {
				if (!task.parsed) throw new Error('Missing inline source');
				const patched = patchInlineTaskIdRepairFields(task.parsed, task.updates);
				if (patched === null) throw new Error('Ambiguous inline metadata');
				lines[task.lineNumber] = patched;
			}
			let after = lines.join('\n');
			for (const task of changed.filter(task => task.format === 'yaml')) {
				if (task.identities.length !== 1 || !task.identities[0]) throw new Error('Ambiguous YAML task identity');
				after = renderYamlRepair(after, task, keyMappings);
			}
			after = repairMarkdownTaskCardReferences(after, repair);
			if (after !== before) changes.push({ filePath, before, after });
		}
		return { ok: true, changes, readSet: sources.map(source => ({ ...source })), previousId, nextId, ambiguousFilterIdentity };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : 'Task ID repair source preparation failed' };
	}
}
