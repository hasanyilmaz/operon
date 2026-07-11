import type { Pipeline, StatusDefinition } from '../types/pipeline';
import { composeStatusValue } from './workflow-status-value';

export interface ConfiguredWorkflowStatusIdentity {
	kind: 'configured';
	value: string;
	pipeline: Pipeline;
	status: StatusDefinition;
	pipelineIndex: number;
	statusIndex: number;
}

export interface AmbiguousWorkflowStatusIdentity {
	kind: 'ambiguous';
	value: string;
	matches: readonly ConfiguredWorkflowStatusIdentity[];
}

export interface UnknownWorkflowStatusIdentity {
	kind: 'unknown';
	value: string;
}

export type WorkflowStatusIdentityResolution =
	| ConfiguredWorkflowStatusIdentity
	| AmbiguousWorkflowStatusIdentity
	| UnknownWorkflowStatusIdentity;

export interface ConfiguredWorkflowPipelineIdentity {
	kind: 'configured';
	value: string;
	pipeline: Pipeline;
	status: StatusDefinition;
	pipelineIndex: number;
}

export interface AmbiguousWorkflowPipelineIdentity {
	kind: 'ambiguous';
	value: string;
	matches: readonly ConfiguredWorkflowStatusIdentity[];
}

export interface UnknownWorkflowPipelineIdentity {
	kind: 'unknown';
	value: string;
}

export type WorkflowPipelineIdentityResolution =
	| ConfiguredWorkflowPipelineIdentity
	| AmbiguousWorkflowPipelineIdentity
	| UnknownWorkflowPipelineIdentity;

export interface WorkflowPipelineIdentityCandidate {
	pipeline: Pipeline;
	pipelineIndex: number;
}

export type WorkflowPipelineNameIdentityResolution =
	| { kind: 'configured'; value: string; pipeline: Pipeline; pipelineIndex: number }
	| { kind: 'ambiguous'; value: string; matches: readonly WorkflowPipelineIdentityCandidate[] }
	| { kind: 'unknown'; value: string };

export interface WorkflowStatusIdentityIndex {
	matchesByValue: ReadonlyMap<string, readonly ConfiguredWorkflowStatusIdentity[]>;
	pipelineCandidates: readonly WorkflowPipelineIdentityCandidate[];
	pipelineCandidatesByName: ReadonlyMap<string, readonly WorkflowPipelineIdentityCandidate[]>;
	pipelineCountById: ReadonlyMap<string, number>;
}

/**
 * Builds an exact, case-sensitive identity index for configured workflow values.
 *
 * The canonical value remains `Pipeline.Status`. Indexing the complete value,
 * rather than parsing at the first dot, also keeps existing dotted pipeline
 * names resolvable while Settings guides users away from creating new ones.
 */
export function buildWorkflowStatusIdentityIndex(
	pipelines: readonly Pipeline[],
): WorkflowStatusIdentityIndex {
	const matchesByValue = new Map<string, ConfiguredWorkflowStatusIdentity[]>();
	const pipelineCandidates: WorkflowPipelineIdentityCandidate[] = [];
	const pipelineCandidatesByName = new Map<string, WorkflowPipelineIdentityCandidate[]>();
	const pipelineCountById = new Map<string, number>();

	for (const [pipelineIndex, pipeline] of pipelines.entries()) {
		const pipelineCandidate = { pipeline, pipelineIndex };
		pipelineCandidates.push(pipelineCandidate);
		const namedCandidates = pipelineCandidatesByName.get(pipeline.name) ?? [];
		namedCandidates.push(pipelineCandidate);
		pipelineCandidatesByName.set(pipeline.name, namedCandidates);
		if (pipeline.id) {
			pipelineCountById.set(pipeline.id, (pipelineCountById.get(pipeline.id) ?? 0) + 1);
		}
		for (const [statusIndex, status] of pipeline.statuses.entries()) {
			const value = composeStatusValue(pipeline.name, status.label);
			const match: ConfiguredWorkflowStatusIdentity = {
				kind: 'configured',
				value,
				pipeline,
				status,
				pipelineIndex,
				statusIndex,
			};
			const existing = matchesByValue.get(value);
			if (existing) {
				existing.push(match);
			} else {
				matchesByValue.set(value, [match]);
			}
		}
	}

	return { matchesByValue, pipelineCandidates, pipelineCandidatesByName, pipelineCountById };
}

export function resolveConfiguredStatusIdentity(
	rawValue: string | null | undefined,
	index: WorkflowStatusIdentityIndex,
): WorkflowStatusIdentityResolution {
	const value = rawValue?.trim() ?? '';
	const matches = index.matchesByValue.get(value) ?? [];
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) return { kind: 'ambiguous', value, matches };
	return { kind: 'unknown', value };
}

export function resolveWorkflowPipelineIdentity(
	rawValue: string | null | undefined,
	index: WorkflowStatusIdentityIndex,
): WorkflowPipelineIdentityResolution {
	const resolution = resolveConfiguredStatusIdentity(rawValue, index);
	if (resolution.kind !== 'configured') return resolution;
	return {
		kind: 'configured',
		value: resolution.value,
		pipeline: resolution.pipeline,
		status: resolution.status,
		pipelineIndex: resolution.pipelineIndex,
	};
}

export function resolveConfiguredPipelineNameIdentity(
	rawName: string | null | undefined,
	index: WorkflowStatusIdentityIndex,
): WorkflowPipelineNameIdentityResolution {
	const value = rawName?.trim() ?? '';
	const matches = index.pipelineCandidatesByName.get(value) ?? [];
	if (matches.length === 1) {
		return {
			kind: 'configured',
			value,
			pipeline: matches[0].pipeline,
			pipelineIndex: matches[0].pipelineIndex,
		};
	}
	if (matches.length > 1) return { kind: 'ambiguous', value, matches };
	return { kind: 'unknown', value };
}
