import type { KeyMapping } from '../types/settings';
import type { Pipeline } from '../types/pipeline';
import { t } from './i18n';
import {
	buildPipelineMinimalFileTaskTemplateId,
	resolvePipelineMinimalFileTaskTemplateStatusById,
} from './file-task-template-identity';
import { parseFrontmatterDocument, ParsedFrontmatterDocument } from './file-task-template-merge';

export interface PipelineMinimalFileTaskTemplateOption {
	id: string;
	name: string;
	path: null;
	kind: 'builtin-pipeline-minimal';
	pipelineId: string;
	description: string;
}

export interface FolderFileTaskTemplateOption {
	id: string;
	name: string;
	path: string;
	kind: 'folder';
}

export type FileTaskTemplateOption = PipelineMinimalFileTaskTemplateOption | FolderFileTaskTemplateOption;

function buildFolderTemplateOptionId(path: string): string {
	return `folder-file-task-template:${path}`;
}

export function resolvePipelineMinimalFileTaskTemplateStatus(
	option: PipelineMinimalFileTaskTemplateOption,
	pipelines: readonly Pipeline[],
): string | null {
	return resolvePipelineMinimalFileTaskTemplateStatusById(option.pipelineId, pipelines);
}

export function buildPipelineMinimalFileTaskTemplateOptions(
	pipelines: readonly Pipeline[],
): PipelineMinimalFileTaskTemplateOption[] {
	return pipelines.flatMap(pipeline => {
		const initialStatus = resolvePipelineMinimalFileTaskTemplateStatusById(pipeline.id, pipelines);
		if (!initialStatus) return [];
		return [{
			id: buildPipelineMinimalFileTaskTemplateId(pipeline.id),
			name: t('taskEditor', 'pipelineMinimalFileTaskTemplateName', { pipeline: pipeline.name }),
			path: null,
			kind: 'builtin-pipeline-minimal' as const,
			pipelineId: pipeline.id,
			description: t('taskEditor', 'pipelineMinimalFileTaskTemplateDescription', { status: initialStatus }),
		}];
	});
}

export function getFileTaskTemplateOptionSecondaryText(option: FileTaskTemplateOption): string {
	return option.kind === 'folder' ? option.path : option.description;
}

export function getTopLevelMarkdownFilesInFolder(
	folderPath: string,
	files: ReadonlyArray<{ path: string; basename?: string; parent?: { path: string } | null }>,
): Array<{ path: string; basename: string }> {
	const normalizedFolder = folderPath.trim();
	if (!normalizedFolder) return [];

	return files
		.filter((file): file is { path: string; basename: string; parent: { path: string } } =>
			typeof file.path === 'string'
			&& typeof file.basename === 'string'
			&& !!file.parent
			&& typeof file.parent.path === 'string'
			&& file.parent.path === normalizedFolder
			&& file.path.toLowerCase().endsWith('.md')
		)
		.sort((left, right) => left.path.localeCompare(right.path))
		.map(file => ({
			path: file.path,
			basename: file.basename,
		}));
}

export function buildFileTaskTemplateOptions(
	folderPath: string,
	files: ReadonlyArray<{ path: string; basename?: string; parent?: { path: string } | null }>,
	pipelines: readonly Pipeline[],
): FileTaskTemplateOption[] {
	const folderTemplates = getTopLevelMarkdownFilesInFolder(folderPath, files);
	return [
		...buildPipelineMinimalFileTaskTemplateOptions(pipelines),
		...folderTemplates.map(template => ({
			id: buildFolderTemplateOptionId(template.path),
			name: template.basename.trim(),
			path: template.path.trim(),
			kind: 'folder' as const,
		})),
	];
}

export function orderFileTaskTemplateOptionsByLastUsed(
	options: FileTaskTemplateOption[],
	lastUsedTemplateId: string | null | undefined,
): FileTaskTemplateOption[] {
	if (!lastUsedTemplateId) return options;
	const index = options.findIndex(option => option.id === lastUsedTemplateId);
	if (index <= 0) return options;

	const reordered = [...options];
	const [lastUsed] = reordered.splice(index, 1);
	reordered.splice(0, 0, lastUsed);
	return reordered;
}

export function resolveDefaultConvertFileTaskTemplateOption(
	folderPath: string,
	files: ReadonlyArray<{ path: string; basename?: string; parent?: { path: string } | null }>,
	pipelines: readonly Pipeline[],
): FileTaskTemplateOption | null {
	const options = buildFileTaskTemplateOptions(folderPath, files, pipelines);
	return options.find(option => option.kind === 'folder')
		?? options.find(option => option.kind === 'builtin-pipeline-minimal')
		?? null;
}

export function findFileTaskTemplateOptionById(
	options: FileTaskTemplateOption[],
	id: string | null | undefined,
): FileTaskTemplateOption | null {
	if (!id) return null;
	return options.find(option => option.id === id) ?? null;
}

export async function loadFileTaskTemplateDocument(
	app: {
		vault: {
			getAbstractFileByPath: (path: string) => { path?: unknown; extension?: unknown } | null;
			cachedRead: (file: { path: string }) => Promise<string>;
		};
	},
	option: FileTaskTemplateOption | null,
	keyMappings: KeyMapping[],
): Promise<ParsedFrontmatterDocument | null> {
	if (!option || option.kind !== 'folder') return null;

	const templateFile = app.vault.getAbstractFileByPath(option.path);
	if (
		!templateFile
		|| typeof templateFile.path !== 'string'
		|| templateFile.extension !== 'md'
	) {
		return null;
	}

	const content = await app.vault.cachedRead(templateFile as { path: string });
	return parseFrontmatterDocument(content, keyMappings);
}

export function templateDocumentContainsTemplaterSyntax(
	document: ParsedFrontmatterDocument | null | undefined,
): boolean {
	if (!document) return false;
	if (document.body.includes('<%')) return true;
	if (Object.values(document.managedFieldValues).some(value => value.includes('<%'))) return true;
	return document.sections.some(section => section.raw.includes('<%'));
}
