import { getManagedYamlAliases, readYamlFields } from './yaml-fields';
import { IndexedTask } from '../types/fields';
import { getManagedTaskFieldType } from './managed-task-fields';
import { parseListValue } from './parser';
import { OperonIndexer } from '../indexer/indexer';
import {
	CHILD_TASK_INHERITANCE_TAGS_KEY,
	DEFAULT_CHILD_TASK_INHERITANCE_FIELDS,
	isChildTaskInheritanceEligibleFieldKey,
	normalizeChildTaskInheritanceFields,
	OperonSettings,
} from '../types/settings';
import { composeStatusValue, parseStatusValue } from '../types/pipeline';
import { normalizeTaskIconValue } from './task-icon-value';
import { normalizeTaskColorValue } from './task-color-value';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredPipelineNameIdentity,
	resolveWorkflowPipelineIdentity,
} from './workflow-status-identity';

export interface SubtaskInitialFields {
	parentTask?: string;
	status?: string;
	priority?: string;
	taskIcon?: string;
	taskColor?: string;
	tags?: string[];
	[key: string]: string | string[] | undefined;
}

function resolveInitialStatus(parentStatus: string | undefined, settings: OperonSettings): string | undefined {
	const pipelines = settings.pipelines ?? [];
	const identityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const explicitDefault = resolveConfiguredPipelineNameIdentity(settings.defaultPipelineName, identityIndex);
	if (explicitDefault.kind === 'ambiguous') return undefined;
	const defaultPipeline = explicitDefault.kind === 'configured' ? explicitDefault.pipeline : pipelines[0];
	let targetPipeline = defaultPipeline;
	if (settings.childTaskInheritanceStatusPipelineSource !== 'default' && parentStatus) {
		const identity = resolveWorkflowPipelineIdentity(
			parentStatus,
				identityIndex,
		);
		if (identity.kind === 'ambiguous') return undefined;
		if (identity.kind === 'configured') {
			targetPipeline = identity.pipeline;
		} else {
			const parsed = parseStatusValue(identity.value);
				if (!parsed) {
					targetPipeline = defaultPipeline;
				} else {
					const parsedPipeline = resolveConfiguredPipelineNameIdentity(parsed.pipeline, identityIndex);
					if (parsedPipeline.kind === 'ambiguous') return undefined;
					targetPipeline = parsedPipeline.kind === 'configured'
						? parsedPipeline.pipeline
						: defaultPipeline;
				}
		}
	}

	const firstStatus = targetPipeline?.statuses[0];
	if (!targetPipeline || !firstStatus) return undefined;
	return composeStatusValue(targetPipeline.name, firstStatus.label);
}

function resolveInheritanceFieldKeys(parentTaskId: string | null, settings: OperonSettings): string[] {
	if (!parentTaskId) return [...DEFAULT_CHILD_TASK_INHERITANCE_FIELDS];
	return normalizeChildTaskInheritanceFields(settings.childTaskInheritanceFields, settings.keyMappings);
}

function normalizeInheritedTags(tags: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const rawTag of tags ?? []) {
		const tag = rawTag.trim().replace(/^#/, '').trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		normalized.push(tag);
	}
	return normalized;
}

function applyInheritedField(
	inherited: SubtaskInitialFields,
	key: string,
	parentFields: Record<string, string>,
	parentTags: readonly string[] | null | undefined,
	settings: OperonSettings,
): void {
	if (key === CHILD_TASK_INHERITANCE_TAGS_KEY) {
		const normalizedTags = normalizeInheritedTags(parentTags);
		if (normalizedTags.length > 0) inherited.tags = normalizedTags;
		return;
	}
	if (key === 'status') {
		const inheritedStatus = resolveInitialStatus(parentFields.status, settings);
		if (inheritedStatus) inherited.status = inheritedStatus;
		return;
	}
	if (key === 'priority') {
		if (parentFields.priority?.trim()) {
			inherited.priority = parentFields.priority.trim();
		} else if (settings.defaultPriority?.trim()) {
			inherited.priority = settings.defaultPriority.trim();
		}
		return;
	}
	if (key === 'taskIcon') {
		const normalizedTaskIcon = normalizeTaskIconValue(parentFields.taskIcon);
		if (normalizedTaskIcon) inherited.taskIcon = normalizedTaskIcon;
		return;
	}
	if (key === 'taskColor') {
		const normalizedTaskColor = normalizeTaskColorValue(parentFields.taskColor);
		if (normalizedTaskColor) inherited.taskColor = normalizedTaskColor;
		return;
	}
	const value = parentFields[key]?.trim();
	if (value && isChildTaskInheritanceEligibleFieldKey(key, settings.keyMappings)) {
		inherited[key] = value;
	}
}

export function resolveSubtaskInitialFieldsFromParentValues(
	parentTaskId: string | null,
	parentFieldValues: Record<string, string> | null | undefined,
	settings: OperonSettings,
	parentTags?: readonly string[] | null,
): SubtaskInitialFields {
	const inherited: SubtaskInitialFields = {};
	const parentFields = parentFieldValues ?? {};
	if (parentTaskId) inherited.parentTask = parentTaskId;

	for (const key of resolveInheritanceFieldKeys(parentTaskId, settings)) {
		applyInheritedField(inherited, key, parentFields, parentTags, settings);
	}

	return inherited;
}

export function getSubtaskInitialFieldKeys(inherited: SubtaskInitialFields): string[] {
	return Object.keys(inherited).filter(key => {
		const value = inherited[key];
		return typeof value === 'string' && !!value.trim();
	});
}

export function getSubtaskInheritedFieldKeys(inherited: SubtaskInitialFields): string[] {
	return getSubtaskInitialFieldKeys(inherited).filter(key => key !== 'parentTask');
}

export function resolveSubtaskInitialFields(
	parentTaskId: string | null,
	indexer: OperonIndexer,
	settings: OperonSettings,
): SubtaskInitialFields {
	const parent = parentTaskId ? indexer.getTask(parentTaskId) : null;
	return resolveSubtaskInitialFieldsFromParentValues(parentTaskId, parent?.fieldValues, settings, parent?.tags);
}

/** Serialize the existing list grammar without changing literal backslashes. */
function serializeParentLinkList(items: string[]): string {
	// parseListValue only recognizes backslash-semicolon, not doubled backslashes.
	// Encode semicolons explicitly, then verify every item boundary before a write.
	const encoded = items.map(item => Array.from(item, character => character === ';' ? '\\;' : character).join('')).join('; ');
	const decoded = parseListValue(encoded);
	if (decoded.length !== items.length || decoded.some((item, index) => item !== items[index])) {
		throw new Error('Parent link list cannot be represented losslessly.');
	}
	return encoded;
}

/** Resolve only the additional fields for an explicit, changed parent assignment. */
export function resolveParentLinkInheritance(
	child: Pick<IndexedTask, 'operonId' | 'fieldValues' | 'tags'>,
	payload: Record<string, string>,
	settings: OperonSettings,
	getParent: (id: string) => Pick<IndexedTask, 'fieldValues' | 'tags'> | null | undefined,
): Record<string, string> {
	if (!settings.inheritPropertiesOnParentLink || !Object.prototype.hasOwnProperty.call(payload, 'parentTask')) return {};
	const parentId = payload.parentTask.trim();
	if (!parentId || parentId === child.operonId || parentId === (child.fieldValues.parentTask ?? '').trim()) return {};
	const parent = getParent(parentId);
	if (!parent) return {};
	const inherited = resolveSubtaskInitialFieldsFromParentValues(parentId, parent.fieldValues, settings, parent.tags);
	const additions: Record<string, string> = {};
	for (const [key, value] of Object.entries(inherited)) {
		if (key === 'parentTask' || value === undefined) continue;
		const payloadKey = key === 'tags' ? '_tags' : key;
		const current = payload[payloadKey] ?? (key === 'tags' ? child.tags.join('; ') : child.fieldValues[key] ?? '');
		if (key === 'tags' || getManagedTaskFieldType(key, settings.keyMappings) === 'list') {
			const existing = key === 'tags' ? normalizeInheritedTags(parseListValue(current)) : parseListValue(current);
			const incoming = Array.isArray(value) ? value : parseListValue(value);
			const seen = new Set(existing);
			const missing = incoming.filter(item => {
				if (seen.has(item)) return false;
				seen.add(item);
				return true;
			});
			if (missing.length) {
				additions[payloadKey] = serializeParentLinkList([...existing, ...missing]);
			}
		} else if (!current.trim() && typeof value === 'string' && value.trim()) {
			additions[key] = value;
		}
	}
	return additions;
}

/** Read native parent lists only for an explicit link; never infer item boundaries from the index. */
export async function loadParentLinkListSource(
 parent: Pick<IndexedTask, 'operonId' | 'primary' | 'fieldValues' | 'tags'>,
 settings: OperonSettings,
 readFrontmatter: (path: string) => Promise<unknown>,
): Promise<Pick<IndexedTask, 'fieldValues' | 'tags'>> {
 const keys = normalizeChildTaskInheritanceFields(settings.childTaskInheritanceFields, settings.keyMappings)
  .filter(key => key !== 'tags' && key !== 'taskGallery' && getManagedTaskFieldType(key, settings.keyMappings) === 'list');
 if (parent.primary.format !== 'yaml' || keys.length === 0) return parent;
 const raw = await readFrontmatter(parent.primary.filePath);
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Parent YAML source is unavailable.');
 const frontmatter = raw as Record<string, unknown>;
 const fields = readYamlFields(frontmatter, settings.keyMappings);
 if (fields.operonId !== parent.operonId) throw new Error('Parent YAML identity changed.');
 const listItems: Record<string, string[]> = {};
 for (const key of keys) {
  const aliases = getManagedYamlAliases(key, settings.keyMappings).filter(alias => Object.prototype.hasOwnProperty.call(frontmatter, alias));
  if (aliases.length > 1) throw new Error('Parent YAML list has ambiguous aliases.');
  const value = aliases.length ? frontmatter[aliases[0]] : null;
  if (value === null || value === undefined) listItems[key] = [];
  else if (Array.isArray(value)) {
   if (value.some(item => !['string', 'number', 'boolean'].includes(typeof item))) throw new Error('Parent YAML list contains unsupported items.');
   listItems[key] = value.map(String).map(item => item.trim()).filter(Boolean);
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') listItems[key] = parseListValue(String(value));
  else throw new Error('Parent YAML list contains an unsupported value.');
  if (listItems[key].some(item => item.includes(';'))) throw new Error('Parent YAML list item contains an ambiguous semicolon.');
 }
 // Use the same fresh source projection so absent/deleted lists cannot fall back to stale index values.
 return { ...parent, fieldValues: { ...parent.fieldValues, ...Object.fromEntries(keys.map(key => [key, serializeParentLinkList(listItems[key])])) } };
}
