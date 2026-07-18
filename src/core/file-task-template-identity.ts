import type { Pipeline } from '../types/pipeline';
import { composeStatusValue } from './workflow-status-value';
import { buildWorkflowStatusIdentityIndex, resolveConfiguredStatusIdentity } from './workflow-status-identity';

export const LEGACY_BUILTIN_EMPTY_FILE_TASK_TEMPLATE_ID = 'builtin-empty-file-task-template';
export const PIPELINE_MINIMAL_FILE_TASK_TEMPLATE_ID_PREFIX = 'builtin-minimal-file-task-template:';

export function buildPipelineMinimalFileTaskTemplateId(pipelineId: string): string {
	return `${PIPELINE_MINIMAL_FILE_TASK_TEMPLATE_ID_PREFIX}${pipelineId.trim()}`;
}

export function getPipelineIdFromMinimalFileTaskTemplateId(templateId: string | null | undefined): string | null {
	const normalized = templateId?.trim() ?? '';
	if (!normalized.startsWith(PIPELINE_MINIMAL_FILE_TASK_TEMPLATE_ID_PREFIX)) return null;
	const pipelineId = normalized.slice(PIPELINE_MINIMAL_FILE_TASK_TEMPLATE_ID_PREFIX.length).trim();
	return pipelineId || null;
}

export function resolvePipelineMinimalFileTaskTemplateStatusById(
	pipelineId: string,
	pipelines: readonly Pipeline[],
): string | null {
	const normalizedPipelineId = pipelineId.trim();
	const matchingPipelines = pipelines.filter(pipeline => pipeline.id.trim() === normalizedPipelineId);
	if (!normalizedPipelineId || matchingPipelines.length !== 1) return null;

	const pipeline = matchingPipelines[0];
	const pipelineName = pipeline.name.trim();
	const firstStatus = pipeline.statuses[0];
	const firstStatusLabel = firstStatus?.label.trim() ?? '';
	if (!pipelineName || pipelineName.includes('.') || !firstStatus?.id.trim() || !firstStatusLabel) return null;

	const identityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	if (identityIndex.pipelineCountById.get(normalizedPipelineId) !== 1) return null;
	if ((identityIndex.pipelineCandidatesByName.get(pipelineName) ?? []).length !== 1) return null;
	const resolution = resolveConfiguredStatusIdentity(
		composeStatusValue(pipelineName, firstStatusLabel),
		identityIndex,
	);
	if (
		resolution.kind !== 'configured'
		|| resolution.pipeline !== pipeline
		|| resolution.status !== firstStatus
	) {
		return null;
	}
	return resolution.value;
}
