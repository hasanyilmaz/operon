import { buildWorkflowStatusIdentityIndex, resolveConfiguredStatusIdentity } from './workflow-status-identity';
import { normalizeSettingsFolderPath } from './settings-folder-rules';
import { isSafeVaultRelativePath } from './vault-path-safety';
import type { Pipeline } from '../types/pipeline';
import type { FileTaskPipelineLocationRule, OperonSettings } from '../types/settings';

export interface FileTaskPipelineLocationResolution {
	pipelineId: string | null;
	folder: string | null;
	kind: 'pipeline-rule' | 'unresolved';
}

export interface FileTaskArchiveLocationResolution {
	pipelineId: string | null;
	folder: string | null;
	kind: 'pipeline-rule' | 'general-fallback' | 'unconfigured' | 'unsafe-rule';
}

function compareText(left: string, right: string): number {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

/**
 * Captures only the archive routing inputs that can change the destination or
 * terminal eligibility of an already indexed File Task.  This stays separate
 * from the broader index signature so presentation-only pipeline edits do not
 * schedule an archive reconciliation.
 */
export function buildFileTaskArchiveReconciliationSignature(
	settings: Pick<OperonSettings, 'pipelines' | 'fileTaskArchiveFolder' | 'fileTaskArchivePipelineLocations'>,
): string {
	const archivePipelineLocations = (settings.fileTaskArchivePipelineLocations ?? [])
		.map(rule => ({
			pipelineId: rule.pipelineId,
			folder: normalizeSettingsFolderPath(rule.folder),
		}))
		.sort((left, right) => (
			compareText(left.pipelineId, right.pipelineId)
			|| compareText(left.folder, right.folder)
		));
	const pipelineSemantics = settings.pipelines.map(pipeline => ({
		id: pipeline.id,
		name: pipeline.name,
		statuses: pipeline.statuses
			.map(status => ({
				label: status.label,
				isFinished: status.isFinished,
				isCancelled: status.isCancelled,
			}))
			.sort((left, right) => (
				compareText(left.label, right.label)
				|| Number(left.isFinished) - Number(right.isFinished)
				|| Number(left.isCancelled) - Number(right.isCancelled)
			)),
	})).sort((left, right) => (
		compareText(left.id, right.id)
		|| compareText(left.name, right.name)
		|| compareText(JSON.stringify(left.statuses), JSON.stringify(right.statuses))
	));
	return JSON.stringify({
		fileTaskArchiveFolder: normalizeSettingsFolderPath(settings.fileTaskArchiveFolder),
		fileTaskArchivePipelineLocations: archivePipelineLocations,
		pipelineSemantics,
	});
}

/**
 * Resolves the configured pipeline by stable identity after the task's final
 * status has been assembled.  An unknown or ambiguous status is deliberately
 * not guessed; callers use their normal fallback destination in that case.
 */
export function resolveFileTaskPipelineLocation(
	settings: Pick<OperonSettings, 'pipelines' | 'fileTaskPipelineLocations'>,
	fieldValues: Readonly<Record<string, string>>,
): FileTaskPipelineLocationResolution {
	const pipelineId = resolveFileTaskPipelineId(settings.pipelines ?? [], fieldValues['status']);
	if (!pipelineId) return { pipelineId: null, folder: null, kind: 'unresolved' };
	const rule = (settings.fileTaskPipelineLocations ?? []).find(candidate => candidate.pipelineId === pipelineId);
	const rawFolder = rule?.folder.trim() ?? '';
	// Do not repair an unsafe stored rule into a different vault-relative path.
	// Migration/UI reject these already; this keeps programmatic callers fail-closed too.
	if (rule && rawFolder && !isSafeVaultRelativePath(rawFolder)) {
		return { pipelineId, folder: null, kind: 'unresolved' };
	}
	const folder = rule ? normalizeSettingsFolderPath(rawFolder) : null;
	return {
		pipelineId,
		folder,
		kind: rule ? 'pipeline-rule' : 'unresolved',
	};
}

/** Resolves terminal File Task archive policy without exposing it through Runtime V1. */
export function resolveFileTaskArchiveLocation(
	settings: Pick<OperonSettings, 'pipelines' | 'fileTaskArchiveFolder' | 'fileTaskArchivePipelineLocations'>,
	fieldValues: Readonly<Record<string, string>>,
): FileTaskArchiveLocationResolution {
	const pipelineId = resolveFileTaskPipelineId(settings.pipelines ?? [], fieldValues['status']);
	if (pipelineId) {
		const rule = (settings.fileTaskArchivePipelineLocations ?? []).find(candidate => candidate.pipelineId === pipelineId);
		if (rule) {
			const rawFolder = rule.folder.trim();
			if (!rawFolder || !isSafeVaultRelativePath(rawFolder)) {
				return { pipelineId, folder: null, kind: 'unsafe-rule' };
			}
			const folder = normalizeSettingsFolderPath(rawFolder);
			if (!folder) return { pipelineId, folder: null, kind: 'unsafe-rule' };
			return { pipelineId, folder, kind: 'pipeline-rule' };
		}
	}
	const fallback = normalizeSettingsFolderPath(settings.fileTaskArchiveFolder);
	if (!fallback) return { pipelineId, folder: null, kind: 'unconfigured' };
	if (!isSafeVaultRelativePath(fallback)) return { pipelineId, folder: null, kind: 'unsafe-rule' };
	return { pipelineId, folder: fallback, kind: 'general-fallback' };
}

export function resolveFileTaskPipelineId(
	pipelines: readonly Pipeline[],
	statusValue: string | null | undefined,
): string | null {
	const resolution = resolveConfiguredStatusIdentity(statusValue, buildWorkflowStatusIdentityIndex(pipelines));
	return resolution.kind === 'configured' ? resolution.pipeline.id : null;
}

/** The recurrence fallback remains meaningful only after final pipeline fields were checked. */
export function resolveFileTaskRecurrenceFallbackFolder(
	settings: Pick<OperonSettings, 'fileRepeatDestination' | 'fileRepeatCustomFolder' | 'fileTasksFolder'>,
	sourceFolder: string,
): string {
	const destination = settings.fileRepeatDestination ?? 'same-folder';
	if (destination === 'custom-folder' && settings.fileRepeatCustomFolder?.trim()) {
		return normalizeSettingsFolderPath(settings.fileRepeatCustomFolder);
	}
	if (destination === 'same-folder') return normalizeSettingsFolderPath(sourceFolder);
	return normalizeSettingsFolderPath(settings.fileTasksFolder);
}

/** Shared recurrence creation order: pipeline rule, recurrence destination, then general fallback. */
export function resolveRecurringFileTaskFolder(
	settings: Pick<
		OperonSettings,
		| 'pipelines'
		| 'fileTaskPipelineLocations'
		| 'fileRepeatDestination'
		| 'fileRepeatCustomFolder'
		| 'fileTasksFolder'
	>,
	fieldValues: Readonly<Record<string, string>>,
	sourceFolder: string,
): string {
	const pipeline = resolveFileTaskPipelineLocation(settings, fieldValues);
	return pipeline.folder ?? resolveFileTaskRecurrenceFallbackFolder(settings, sourceFolder);
}

export function normalizeFileTaskPipelineLocationRules(
	rules: readonly FileTaskPipelineLocationRule[],
): FileTaskPipelineLocationRule[] {
	return rules.map(rule => ({
		pipelineId: rule.pipelineId,
		folder: normalizeSettingsFolderPath(rule.folder),
	}));
}
