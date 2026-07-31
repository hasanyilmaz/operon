import { IndexedTask } from '../types/fields';
import { KeyMapping } from '../types/settings';
import { buildReverseMapping } from './yaml-fields';

export interface ResolveFileTaskAutoParentInput {
	enabled: boolean;
	filePath: string | null | undefined;
	tasks: IndexedTask[];
	frontmatter?: Record<string, unknown> | null;
	keyMappings: KeyMapping[];
}

export interface ResolveLinkedFileTaskAutoParentInput {
	enabled: boolean;
	sourceFilePath: string | null | undefined;
	tasks: IndexedTask[];
	frontmatter?: Record<string, unknown> | null;
	keyMappings: KeyMapping[];
	existingParentTask?: string | null | undefined;
}

export interface ApplyLinkedFileTaskAutoParentSeedInput extends ResolveLinkedFileTaskAutoParentInput {
	fieldValues: Record<string, string>;
	fieldPresence?: Set<string>;
}

export function resolveFileTaskAutoParentOperonId({
	enabled,
	filePath,
	tasks,
	frontmatter,
	keyMappings,
}: ResolveFileTaskAutoParentInput): string | null {
	if (!enabled || !filePath) return null;

	const indexedYamlTask = tasks.find(task =>
		task.primary.format === 'yaml'
		&& task.primary.filePath === filePath
	);
	if (indexedYamlTask?.operonId) return indexedYamlTask.operonId;

	if (!frontmatter) return null;
	const rawOperonId = frontmatter['operonId'];
	if (
		(typeof rawOperonId === 'string' && rawOperonId.trim())
		|| (typeof rawOperonId === 'number' && Number.isSafeInteger(rawOperonId) && rawOperonId >= 0)
	) {
		return String(rawOperonId).trim();
	}

	const reverseMap = buildReverseMapping(keyMappings);
	for (const [yamlKey, value] of Object.entries(frontmatter)) {
		if ((reverseMap.get(yamlKey) ?? yamlKey) !== 'operonId') continue;
		if (typeof value !== 'string' || !value.trim()) continue;
		return value.trim();
	}

	return null;
}

export function resolveLinkedFileTaskAutoParentOperonId({
	enabled,
	sourceFilePath,
	tasks,
	frontmatter,
	keyMappings,
	existingParentTask,
}: ResolveLinkedFileTaskAutoParentInput): string | null {
	const existing = existingParentTask?.trim();
	if (existing) return existing;
	return resolveFileTaskAutoParentOperonId({
		enabled,
		filePath: sourceFilePath,
		tasks,
		frontmatter,
		keyMappings,
	});
}

export function applyLinkedFileTaskAutoParentSeed({
	enabled,
	sourceFilePath,
	tasks,
	frontmatter,
	keyMappings,
	existingParentTask,
	fieldValues,
	fieldPresence,
}: ApplyLinkedFileTaskAutoParentSeedInput): { fieldValues: Record<string, string>; fieldPresence: Set<string> } {
	const nextFieldValues = { ...fieldValues };
	const nextFieldPresence = new Set(fieldPresence ?? Object.keys(nextFieldValues));
	const resolvedParent = resolveLinkedFileTaskAutoParentOperonId({
		enabled,
		sourceFilePath,
		tasks,
		frontmatter,
		keyMappings,
		existingParentTask: existingParentTask ?? nextFieldValues['parentTask'],
	});

	if (resolvedParent && !(nextFieldValues['parentTask'] ?? '').trim()) {
		nextFieldValues['parentTask'] = resolvedParent;
		nextFieldPresence.add('parentTask');
	}

	return {
		fieldValues: nextFieldValues,
		fieldPresence: nextFieldPresence,
	};
}
