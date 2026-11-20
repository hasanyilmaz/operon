import { TFile, type App } from 'obsidian';
import type { AutomationChangePlan, AutomationFieldChange } from '../core/automation-change-plan';
import type { FileTaskPropertyChange } from '../core/file-task-property-draft';
import { parseListValue } from '../core/parser';
import { parseDependencyIdList } from '../core/dependency-graph';
import { createInlinePropertyReadPlan, readParsedInlinePropertyProjection, type InlinePropertyChange } from '../core/inline-property-source';
import { isSupportedRawYamlPropertyValue } from '../core/raw-yaml-property';
import { parseTaskMediaReferenceList, serializeTaskMediaReferenceList } from '../core/task-media-reference';
import { readLosslessYamlListField } from '../core/yaml-fields';
import type { GuardedTaskSourceFieldUpdate, TaskWriter, TaskWriterExclusiveMutationPermit } from '../core/task-writer';
import type { IndexedTask, ParsedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import type { PinnedCache, PinnedCacheEntrySnapshot } from '../storage/pinned-cache';
import { executeTaskSourceRenameTransaction } from '../storage/task-source-rename-transaction';
import type { TableFilePropertyQueryContext } from '../ui/table/table-file-property';
import { executePluginUiConversionTransaction, type PluginUiConversionStep } from './plugin-ui-conversion-transaction';
import type { captureAutomationReadState } from './automation-read-state';
import { renderAutomationSource } from './automation-source-render';
import type { AutomationWork, AutomationYamlSources } from './manual-automation-run';

interface WritePorts {
	app: App;
	yamlSources: AutomationYamlSources;
	writer: TaskWriter;
	pins: PinnedCache;
	settings: OperonSettings;
	native?: TableFilePropertyQueryContext;
	allTasks: IndexedTask[];
	readState: ReturnType<typeof captureAutomationReadState>;
	withSources<T>(paths: string[], allowed: () => boolean, operation: (current: () => boolean) => Promise<T>): Promise<T>;
	getTask(id: string): IndexedTask | undefined;
	indexed(file: TFile): boolean;
	validPath(path: string, absent: boolean): Promise<boolean>;
	buffersMatch(path: string, content: string): boolean;
	sync(path: string, before: string, after: string): boolean;
	permit(): TaskWriterExclusiveMutationPermit | undefined;
	refresh(paths: Set<string>): Promise<void>;
	/** Capture only writes this instance attempts, including conditional rollback. */
	observeSource?(ids: ReadonlySet<string>, file: TFile, path: string, expected: string): Promise<() => void>;
	observePin?(id: string, pinned: boolean, stamp: string): void;
}
interface Source {
	file: TFile;
	path: string;
	destination: string;
	before: string;
	after: string;
}
type Pin = { expected: PinnedCacheEntrySnapshot; pinned: boolean };

function buildUpdate(task: IndexedTask, changes: AutomationFieldChange[], content: string, ports: WritePorts, row?: ParsedTask): GuardedTaskSourceFieldUpdate | null {
	const { format, lineNumber, filePath } = task.primary;
	const update: GuardedTaskSourceFieldUpdate = { operonId: task.operonId, format, lineNumber, fieldValues: {}, expectedFieldValues: {} };
	const yaml: FileTaskPropertyChange[] = [];
	const inline: InlinePropertyChange[] = [];
	for (const { field, before, after } of changes) {
		if (field === 'pinned' || field === 'sourcePath' || field === 'description' && format === 'yaml') continue;
		if (field.startsWith('file.property:')) {
			const definition = ports.native?.fields.find(option => option.key === field);
			const cell = ports.native?.getCell(task, field);
			if (!definition || definition.readonly || !cell || cell.nativeState !== 'ready' || cell.readOnlyReason) return null;
			const type = definition.type;
			if (type !== 'text' && type !== 'number' && type !== 'checkbox' && type !== 'list' && type !== 'datetime' && type !== 'date') return null;
			const name = cell.sourceName ?? definition.propertyName;
			if (format === 'inline') {
				if (!cell.inlineExpected) return null;
				inline.push({ sourceName: name, type, expected: cell.inlineExpected, mutation: after === null ? { kind: 'remove' } : { kind: 'set', value: after } });
			} else {
				if (cell.present && !isSupportedRawYamlPropertyValue(cell.rawValue)) return null;
				yaml.push({ propertyName: name, nativeType: type,
					expected: { present: cell.present, value: isSupportedRawYamlPropertyValue(cell.rawValue) ? cell.rawValue : undefined }, remove: after === null, value: after });
			}
			continue;
		}
		const mapping = ports.settings.keyMappings.find(item => item.isSystem === false && item.canonicalKey === field);
		if (row && mapping) {
			const { keyMappings, inlinePropertyDefinitions } = ports.settings;
			const name = mapping.visiblePropertyName;
			const plan = createInlinePropertyReadPlan(name, mapping.type, keyMappings, inlinePropertyDefinitions);
			if (!plan.encoding) return null;
			if (plan.encoding === 'vault-v1') {
				const [property] = readParsedInlinePropertyProjection(row, { [name]: mapping.type }, keyMappings, inlinePropertyDefinitions, () => plan).properties;
				if (property.state === 'conflict' || property.state === 'unsupported') return null;
				const previous = property.present ? property.value : mapping.type === 'list' ? [] : null;
				if (JSON.stringify(previous) !== JSON.stringify(before)) return null;
				const source = row.fields.find(token => plan.aliases.has(token.sourceKey.toLowerCase()));
				inline.push({ sourceName: source?.sourceKey ?? name, type: mapping.type,
					expected: { present: property.present, rawValue: property.rawValue },
					mutation: after === null ? { kind: 'remove' } : { kind: 'set', value: after } });
				continue;
			}
		}
		const key = ['tags', 'checkbox', 'description'].includes(field) ? '_' + field : field;
		update.fieldValues[key] = Array.isArray(after) ? field === 'taskGallery' ? serializeTaskMediaReferenceList(after.map(String)) : after.join('; ') : String(after ?? '');
		if (Array.isArray(after) && field !== 'taskGallery' && JSON.stringify(parseListValue(update.fieldValues[key])) !== JSON.stringify(after)) return null;
		// YAML Effective Modified can come from the file stat. The source revision guards that case.
		if (field === 'datetimeModified' && format === 'yaml' || field === 'checkbox') continue;
		if (format === 'yaml' && field !== 'tags' && Array.isArray(before)) {
			const source = ports.yamlSources.get(filePath);
			if (!source) return null;
			const expected = readLosslessYamlListField(source.frontmatter, field, ports.settings.keyMappings);
			if (!expected.ok) return null;
			const members = field === 'taskGallery' ? parseTaskMediaReferenceList(expected.value) : parseListValue(expected.value);
			if (members.length !== before.length || members.some((member, index) => member !== before[index])) return null;
			update.expectedFieldValues![key] = expected.value;
		} else {
			update.expectedFieldValues![key] = field === 'tags' ? task.tags.join('; ') : field === 'description' ? task.description : task.fieldValues[field] ?? '';
		}
	}
	if (format === 'yaml') {
		const expected = ports.writer.prepareIndexedYamlExpectedFields(content, update.expectedFieldValues!, task);
		if (!expected) return null;
		update.expectedFieldValues = expected;
	}
	if (yaml.length) update.filePropertyDraft = { changes: yaml };
	if (inline.length) update.inlinePropertyDraft = inline;
	return update;
}

function sourceStep(s: Source, ports: WritePorts, current: () => boolean, ids: ReadonlySet<string>): PluginUiConversionStep {
	const { app, writer } = ports;
	const owns = (path: string) => s.file.path === path && app.vault.getAbstractFileByPath(path) === s.file;
	const matches = async (path: string, text: string) => owns(path) && ports.buffersMatch(path, text) && await writer.readTaskMarkdownSource(s.file) === text;
	let confirmAfter: (() => void) | undefined;
	const change = async (from: string, to: string, before: string, after: string, permitted: () => boolean) => {
		const acknowledged = from !== to || before !== after ? await ports.observeSource?.(ids, s.file, to, after) : undefined;
		if (to === s.destination && after === s.after) confirmAfter = acknowledged;
		else confirmAfter = undefined;
		const write = async () => {
			if (before === after) return await matches(to, before);
			const guard = () => permitted() && owns(to) && ports.buffersMatch(to, before);
			const result = await writer.applyExactMarkdownSourceMutation(to, before, after, guard, ports.permit(), 'plugin');
			if (result.outcome !== 'committed') throw new Error('Automation source write did not settle');
			return ports.sync(to, before, after);
		};
		if (from === to) {
			const committed = await write();
			if (committed) acknowledged?.();
			return committed;
		}
		const eligible = () => permitted() && !Object.values(app.metadataCache.resolvedLinks).some(links => links[from]);
		if (!await ports.validPath(to, true) || !await matches(from, before)) return false;
		const committed = await executeTaskSourceRenameTransaction({ previousPath: from, candidatePath: to, currentPath: () => s.file.path,
			owns, occupied: path => !!app.vault.getAbstractFileByPath(path), read: () => app.vault.read(s.file),
			rename: path => app.fileManager.renameFile(s.file, path), canCommit: eligible,
			validate: value => value === before, validateCommitted: value => value === after,
			commit: async rename => await rename() && await write() });
		if (committed) acknowledged?.();
		return committed;
	};
	return { isBefore: () => matches(s.path, s.before), isAfter: async () => {
		const exact = await matches(s.destination, s.after);
		if (exact) confirmAfter?.();
		return exact;
	},
		apply: () => change(s.path, s.destination, s.before, s.after, current),
		rollback: () => change(s.destination, s.path, s.after, s.before, () => true) };
}

type WriteGroup = { ids: Set<string>; sources: Source[]; pins: Map<string, Pin> };

async function commitGroup(group: WriteGroup, ports: WritePorts, state: ReturnType<WritePorts['readState']['watch']>, current: () => boolean) {
	const paths = group.sources.map(source => source.path);
	let entered = false;
	return ports.withSources(paths, current, async allowed => {
		const steps = group.sources.map(source => {
			const step = sourceStep(source, ports, allowed, group.ids);
			const recordCommit = (confirmed: boolean) => {
				if (confirmed) state.sourceCommitted(source.file);
				return confirmed;
			};
			return { ...step, isAfter: async () => recordCommit(await step.isAfter()), apply: async () => {
				if (source.path !== source.destination || source.before !== source.after) { state.ownPath(source.path); state.ownPath(source.destination); }
				return recordCommit(await step.apply());
			} };
		});
		if (group.pins.size) {
			const stamp = new Date().toISOString();
			const matches = (after: boolean) => ports.pins.canPersistCanonical() && [...group.pins].every(([id, pin]) => {
				const entry = ports.pins.getCanonicalEntry(id);
				return after ? entry?.updatedAt === stamp && entry.pinned === pin.pinned
					: entry?.updatedAt === pin.expected?.updatedAt && entry?.pinned === pin.expected?.pinned;
			});
			steps.push({ isBefore: () => Promise.resolve(matches(false)), isAfter: () => Promise.resolve(matches(true)), irreversible: true,
				apply: async () => {
					for (const [id, pin] of group.pins) {
						state.ownPin(id, pin.pinned);
						ports.observePin?.(id, pin.pinned, stamp);
					}
					await ports.pins.applyAutomationPins(group.pins, stamp, allowed); return true;
				}, rollback: () => Promise.resolve(false) });
		}
		entered = true;
		return executePluginUiConversionTransaction(steps, allowed, true);
	}).catch(() => entered ? 'outcome-unknown' : 'not-applied');
}

/** Shared files and changes with a common originating task must settle together. */
export async function prepareAutomationWork(plan: AutomationChangePlan, ports: WritePorts): Promise<AutomationWork | null> {
	const tasks = new Map<string, IndexedTask>();
	const byId = new Map<string, AutomationFieldChange[]>();
	const parent = new Map<string, string>();
	function root(path: string): string {
		let key = path;
		while (parent.has(key)) key = parent.get(key)!;
		if (key !== path) parent.set(path, key);
		return key;
	}
	const taskFor = (id: string) => {
		const task = tasks.get(id) ?? ports.getTask(id);
		if (task) tasks.set(id, task);
		return task;
	};
	for (const change of plan.changes) {
		const task = taskFor(change.taskId);
		if (!task) return null;
		const list = byId.get(change.taskId) ?? [];
		list.push(change);
		byId.set(change.taskId, list);
		for (const origin of change.origins) {
			const from = taskFor(origin.taskId);
			if (!from) return null;
			const a = root(from.primary.filePath), b = root(task.primary.filePath);
			if (a !== b) parent.set(a, b);
		}
	}
	// Status changes may depend on a blocker closing in the same reconciled graph.
	const transitions = new Set([...byId].filter(([, changes]) => changes.some(c => c.field === 'status' || c.field === 'checkbox')).map(([id]) => id));
	if (transitions.size) {
		const join = (blocker: IndexedTask, dependent: IndexedTask) => {
			if (!transitions.has(dependent.operonId) || !byId.has(blocker.operonId)) return;
			const a = root(blocker.primary.filePath), b = root(dependent.primary.filePath);
			if (a !== b) parent.set(a, b);
		};
		for (const task of ports.allTasks) {
			for (const id of parseDependencyIdList(task.fieldValues.blocking)) { const other = tasks.get(id); if (other) join(task, other); }
			if (transitions.has(task.operonId)) for (const id of parseDependencyIdList(task.fieldValues.blockedBy)) { const other = tasks.get(id); if (other) join(other, task); }
		}
	}
	const groups = new Map<string, WriteGroup>();
	const files = new Map<string, IndexedTask[]>();
	for (const task of tasks.values()) {
		const path = task.primary.filePath;
		const members = files.get(path) ?? [];
		members.push(task);
		files.set(path, members);
	}
	const identity: string[] = [];
	for (const [path, members] of files) {
		const key = root(path);
		const group = groups.get(key) ?? { ids: new Set<string>(), sources: [], pins: new Map<string, Pin>() };
		groups.set(key, group);
		const file = ports.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || !ports.indexed(file) || ports.writer.hasMarkdownSource(file) || !await ports.validPath(path, false)) return null;
		const before = ports.yamlSources.get(path)?.content ?? await ports.app.vault.read(file);
		if (!ports.indexed(file) || !ports.buffersMatch(path, before)) return null;
		let destination = path;
		for (const task of members) {
			const changes = byId.get(task.operonId) ?? [];
			if (changes.length) group.ids.add(task.operonId);
			const rename = changes.find(c => c.field === 'sourcePath');
			if (rename) {
				destination = String(rename.after);
				if (ports.app.vault.getAbstractFileByPath(destination) || !await ports.validPath(destination, true)) return null;
			}
			const pin = changes.find(c => c.field === 'pinned');
			if (pin) {
				const expected = ports.pins.getCanonicalEntry(task.operonId);
				if (!ports.pins.canPersistCanonical() || (expected?.pinned ?? false) !== pin.before || typeof pin.after !== 'boolean') return null;
				group.pins.set(task.operonId, { expected, pinned: pin.after });
				identity.push(JSON.stringify([task.operonId, expected, pin.after]));
			}
		}
		const after = renderAutomationSource(path, before, members, ports.writer, ports.settings,
			(task, row) => buildUpdate(task, byId.get(task.operonId) ?? [], before, ports, row));
		if (after === null) return null;
		group.sources.push({ file, path, destination, before, after });
		identity.push(path, destination, before, after);
	}
	if (!ports.readState.ready()) return null;
	return { identity, apply: async permitted => {
		const state = ports.readState.watch();
		const current = () => permitted() && state.current();
		let applied = 0, uncertain = 0;
		const affected = new Set<string>();
		try {
			for (const group of groups.values()) {
				if (!current()) break;
				const outcome = await commitGroup(group, ports, state, current);
				for (const source of group.sources) { affected.add(source.path); affected.add(source.destination); }
				if (outcome !== 'committed') {
					if (outcome === 'outcome-unknown') uncertain = group.ids.size;
					break;
				}
				applied += group.ids.size;
				state.settled();
			}
		} finally { state.close(); }
		try { await ports.refresh(affected); } catch { return { applied, uncertain, refreshPending: true }; }
		return { applied, uncertain };
	} };
}
