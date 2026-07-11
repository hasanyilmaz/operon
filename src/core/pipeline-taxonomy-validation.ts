export type PipelineTaxonomyIssueCode =
	| 'pipelines-not-array'
	| 'pipelines-empty'
	| 'pipeline-not-object'
	| 'pipeline-id-missing'
	| 'pipeline-name-missing'
	| 'pipeline-name-reserved-delimiter'
	| 'pipeline-statuses-empty'
	| 'status-not-object'
	| 'status-id-missing'
	| 'status-label-missing'
	| 'status-color-missing'
	| 'duplicate-pipeline-id'
	| 'duplicate-pipeline-name'
	| 'duplicate-status-id'
	| 'duplicate-status-label'
	| 'canonical-status-collision';

export interface PipelineTaxonomyIssue {
	code: PipelineTaxonomyIssueCode;
	path: string;
	value?: string;
	destructive: boolean;
}

export interface PipelineTaxonomyValidationResult {
	issues: PipelineTaxonomyIssue[];
	hasDestructiveIssues: boolean;
	hasIdentityIssues: boolean;
}

interface SeenCanonicalStatus {
	path: string;
	pipelineName: string;
	statusLabel: string;
}

export function validatePipelineTaxonomy(raw: unknown): PipelineTaxonomyValidationResult {
	const issues: PipelineTaxonomyIssue[] = [];
	const add = (issue: PipelineTaxonomyIssue): void => { issues.push(issue); };
	if (!Array.isArray(raw)) {
		add({ code: 'pipelines-not-array', path: 'taxonomy.pipelines.pipelines', destructive: true });
		return summarize(issues);
	}
	if (raw.length === 0) {
		add({ code: 'pipelines-empty', path: 'taxonomy.pipelines.pipelines', destructive: true });
		return summarize(issues);
	}

	const pipelineIds = new Map<string, string>();
	const pipelineNames = new Map<string, string>();
	const statusIds = new Map<string, string>();
	const canonicalStatuses = new Map<string, SeenCanonicalStatus>();

	for (const [pipelineIndex, entry] of raw.entries()) {
		const pipelinePath = `taxonomy.pipelines.pipelines[${pipelineIndex}]`;
		if (!isRecord(entry)) {
			add({ code: 'pipeline-not-object', path: pipelinePath, destructive: true });
			continue;
		}
		const pipelineId = text(entry.id);
		const pipelineName = text(entry.name);
		if (!pipelineId) {
			add({ code: 'pipeline-id-missing', path: `${pipelinePath}.id`, destructive: true });
		} else {
			const previous = pipelineIds.get(pipelineId);
			if (previous) add({ code: 'duplicate-pipeline-id', path: `${pipelinePath}.id`, value: pipelineId, destructive: true });
			else pipelineIds.set(pipelineId, pipelinePath);
		}
		if (!pipelineName) {
			add({ code: 'pipeline-name-missing', path: `${pipelinePath}.name`, destructive: true });
		} else {
			if (pipelineName.includes('.')) {
				add({ code: 'pipeline-name-reserved-delimiter', path: `${pipelinePath}.name`, value: pipelineName, destructive: false });
			}
			const previous = pipelineNames.get(pipelineName);
			if (previous) add({ code: 'duplicate-pipeline-name', path: `${pipelinePath}.name`, value: pipelineName, destructive: false });
			else pipelineNames.set(pipelineName, pipelinePath);
		}

		const statuses = entry.statuses;
		if (!Array.isArray(statuses) || statuses.length === 0) {
			add({ code: 'pipeline-statuses-empty', path: `${pipelinePath}.statuses`, destructive: true });
			continue;
		}
		const labels = new Map<string, string>();
		for (const [statusIndex, statusEntry] of statuses.entries()) {
			const statusPath = `${pipelinePath}.statuses[${statusIndex}]`;
			if (!isRecord(statusEntry)) {
				add({ code: 'status-not-object', path: statusPath, destructive: true });
				continue;
			}
			const statusId = text(statusEntry.id);
			const label = text(statusEntry.label);
			const color = text(statusEntry.color);
			if (!statusId) {
				add({ code: 'status-id-missing', path: `${statusPath}.id`, destructive: true });
			} else {
				const previous = statusIds.get(statusId);
				if (previous) add({ code: 'duplicate-status-id', path: `${statusPath}.id`, value: statusId, destructive: true });
				else statusIds.set(statusId, statusPath);
			}
			if (!label) {
				add({ code: 'status-label-missing', path: `${statusPath}.label`, destructive: true });
			} else {
				const previous = labels.get(label);
				if (previous) add({ code: 'duplicate-status-label', path: `${statusPath}.label`, value: label, destructive: false });
				else labels.set(label, statusPath);
			}
			if (!color) add({ code: 'status-color-missing', path: `${statusPath}.color`, destructive: true });

			if (pipelineName && label) {
				const canonical = `${pipelineName}.${label}`;
				const previous = canonicalStatuses.get(canonical);
				if (previous && (previous.pipelineName !== pipelineName || previous.statusLabel !== label)) {
					add({ code: 'canonical-status-collision', path: statusPath, value: canonical, destructive: false });
				} else if (!previous) {
					canonicalStatuses.set(canonical, { path: statusPath, pipelineName, statusLabel: label });
				}
			}
		}
	}

	return summarize(issues);
}

function summarize(issues: PipelineTaxonomyIssue[]): PipelineTaxonomyValidationResult {
	return {
		issues,
		hasDestructiveIssues: issues.some(issue => issue.destructive),
		hasIdentityIssues: issues.some(issue => !issue.destructive),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}
