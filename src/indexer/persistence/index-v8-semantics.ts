import { buildWorkflowStatusSemanticsSignature } from '../../core/workflow-status-semantics';
import { isRetiredKeyMapping, type OperonSettings } from '../../types/settings';
import { INDEX_WARM_THRESHOLD_DAYS } from '../index-tier';

const INDEX_V8_SEMANTICS_VERSION = 2;

/**
 * Build the V8 compatibility signature from settings that can change indexed
 * content, source inclusion, workflow checkbox state, or derived RAM tiers.
 */
export function buildIndexV8SemanticsSignature(settings: OperonSettings): string {
	return JSON.stringify({
		version: INDEX_V8_SEMANTICS_VERSION,
		workflow: JSON.parse(buildWorkflowStatusSemanticsSignature(settings.pipelines)) as unknown,
		keyMappings: settings.keyMappings
			.filter(mapping => !isRetiredKeyMapping(mapping.canonicalKey))
			.map(mapping => ({
				canonicalKey: mapping.canonicalKey,
				visiblePropertyName: mapping.visiblePropertyName,
				type: mapping.type,
			})),
		exclusions: {
			fileTaskTemplateFolder: normalizeFolder(settings.fileTaskTemplateFolder),
			excludedFolders: Array.from(new Set(
				settings.excludedFolders.map(normalizeFolder).filter(Boolean),
			)).sort(compareText),
		},
		tier: {
			warmThresholdDays: INDEX_WARM_THRESHOLD_DAYS,
		},
	});
}

export function hasIndexV8WorkflowSemanticsMismatch(
	expectedSignature: string,
	cachedSignature: string,
): boolean {
	try {
		const expected = JSON.parse(expectedSignature) as { workflow?: unknown };
		const cached = JSON.parse(cachedSignature) as { workflow?: unknown };
		return JSON.stringify(expected.workflow) !== JSON.stringify(cached.workflow);
	} catch {
		return true;
	}
}

function normalizeFolder(value: string): string {
	return value.trim().replace(/^\/+|\/+$/g, '');
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}
