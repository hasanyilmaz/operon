import { IndexedTask } from '../types/fields';

export interface EstimateReallocationStep {
	operonId: string;
	label: string;
	estimateBeforeSeconds: number;
	subtractSeconds: number;
	estimateAfterSeconds: number;
}

export interface EstimateReallocationWriteStep {
	operonId: string;
	subtractSeconds: number;
	estimateBeforeSeconds: number;
	estimateAfterSeconds: number;
}

export interface CommittedEstimateReallocationWrite {
	beforeTask: IndexedTask;
	nextEstimate: string;
	subtractSeconds: number;
}

export interface EstimateReallocationWriteResult {
	complete: boolean;
	reason: 'complete' | 'invalid-request' | 'stale-request' | 'write-conflict' | 'write-error';
	committedWrites: CommittedEstimateReallocationWrite[];
	committedSubtractSeconds: number;
	error?: unknown;
}

export interface EstimateReallocationWriteRequest {
	childTask: IndexedTask;
	deltaSeconds: number;
	childEstimateBeforeSeconds: number;
	childEstimateAfterSeconds: number;
	appliedSeconds: number;
	uncoveredSeconds: number;
	steps: readonly EstimateReallocationWriteStep[];
}

type ConditionalEstimateWriteOutcome = 'updated' | 'already-updated' | 'conflict' | 'missing';

export interface EstimateReallocationPreviewRow {
	operonId: string;
	label: string;
	currentEstimateSeconds: number;
	newEstimateSeconds: number;
	currentTotalEstimateSeconds: number | null;
	newTotalEstimateSeconds: number | null;
}

export interface ManualEstimateReallocationProposal {
	deltaSeconds: number;
	childEstimateBeforeSeconds: number;
	childEstimateAfterSeconds: number;
	totalAvailableSeconds: number;
	appliedSeconds: number;
	uncoveredSeconds: number;
	steps: EstimateReallocationStep[];
	previewRows: EstimateReallocationPreviewRow[];
	coverage: 'full' | 'partial';
}

export function buildManualEstimateReallocationProposal(
	params: {
		childOperonId?: string;
		childLabel?: string;
		persistedChildEstimateSeconds: number;
		draftChildEstimateSeconds: number;
		directParentOperonId: string;
		getTaskById: (operonId: string) => IndexedTask | null;
		getChildIds: (operonId: string) => Iterable<string>;
	},
): ManualEstimateReallocationProposal | null {
	const deltaSeconds = params.draftChildEstimateSeconds - params.persistedChildEstimateSeconds;
	if (deltaSeconds <= 0) return null;

	const directParentOperonId = params.directParentOperonId.trim();
	if (!directParentOperonId) return null;

	const steps: EstimateReallocationStep[] = [];
	const visited = new Set<string>();
	let remainingDelta = deltaSeconds;
	let currentOperonId = directParentOperonId;

	while (currentOperonId && remainingDelta > 0 && !visited.has(currentOperonId)) {
		visited.add(currentOperonId);
		const currentTask = params.getTaskById(currentOperonId);
		if (!currentTask) break;

		const estimateBeforeSeconds = parseEstimateSeconds(currentTask.fieldValues['estimate']);
		const subtractSeconds = Math.min(estimateBeforeSeconds, remainingDelta);
		steps.push({
			operonId: currentTask.operonId,
			label: currentTask.description.trim() || currentTask.operonId,
			estimateBeforeSeconds,
			subtractSeconds,
			estimateAfterSeconds: estimateBeforeSeconds - subtractSeconds,
		});
		if (subtractSeconds > 0) {
			remainingDelta -= subtractSeconds;
		}

		currentOperonId = (currentTask.fieldValues['parentTask'] ?? '').trim();
	}

	const appliedSeconds = deltaSeconds - remainingDelta;
	if (appliedSeconds <= 0) return null;

	const previewRows: EstimateReallocationPreviewRow[] = [
		{
			operonId: params.childOperonId?.trim() || '',
			label: params.childLabel?.trim() || params.childOperonId?.trim() || 'Child task',
			currentEstimateSeconds: params.persistedChildEstimateSeconds,
			newEstimateSeconds: params.draftChildEstimateSeconds,
			currentTotalEstimateSeconds: null,
			newTotalEstimateSeconds: null,
		},
	];
	let cumulativeSubtractSeconds = 0;
	for (const step of steps) {
		cumulativeSubtractSeconds += step.subtractSeconds;
		const isParent = hasChildren(step.operonId, params.getChildIds);
		const currentTotalEstimateSeconds = isParent
			? computeCurrentTreeEstimateTotal(step.operonId, params.getTaskById, params.getChildIds)
			: null;
		previewRows.push({
			operonId: step.operonId,
			label: step.label,
			currentEstimateSeconds: step.estimateBeforeSeconds,
			newEstimateSeconds: step.estimateAfterSeconds,
			currentTotalEstimateSeconds,
			newTotalEstimateSeconds: currentTotalEstimateSeconds == null
				? null
				: Math.max(0, currentTotalEstimateSeconds + deltaSeconds - cumulativeSubtractSeconds),
		});
	}

	return {
		deltaSeconds,
		childEstimateBeforeSeconds: params.persistedChildEstimateSeconds,
		childEstimateAfterSeconds: params.draftChildEstimateSeconds,
		totalAvailableSeconds: steps.reduce((sum, step) => sum + step.estimateBeforeSeconds, 0),
		appliedSeconds,
		uncoveredSeconds: remainingDelta,
		steps,
		previewRows,
		coverage: remainingDelta === 0 ? 'full' : 'partial',
	};
}

export async function applyManualEstimateReallocationWrites(
	request: EstimateReallocationWriteRequest,
	deps: {
		getTaskById: (operonId: string) => IndexedTask | null;
		validateTaskSource: (task: IndexedTask, expectedEstimate: string) => Promise<boolean>;
		writeEstimate: (
			operonId: string,
			expectedEstimate: string,
			nextEstimate: string,
			expectedParentTask: string,
		) => Promise<ConditionalEstimateWriteOutcome>;
		resolveWriteError?: (write: CommittedEstimateReallocationWrite) => Promise<boolean>;
	},
): Promise<EstimateReallocationWriteResult> {
	const emptyResult = (
		reason: Exclude<EstimateReallocationWriteResult['reason'], 'complete'>,
		error?: unknown,
	): EstimateReallocationWriteResult => ({
		complete: false,
		reason,
		committedWrites: [],
		committedSubtractSeconds: 0,
		...(error === undefined ? {} : { error }),
	});
	if (
		!Number.isSafeInteger(request.deltaSeconds)
		|| !Number.isSafeInteger(request.childEstimateBeforeSeconds)
		|| !Number.isSafeInteger(request.childEstimateAfterSeconds)
		|| !Number.isSafeInteger(request.appliedSeconds)
		|| !Number.isSafeInteger(request.uncoveredSeconds)
		|| request.deltaSeconds <= 0
		|| request.childEstimateBeforeSeconds < 0
		|| request.childEstimateAfterSeconds - request.childEstimateBeforeSeconds !== request.deltaSeconds
		|| request.appliedSeconds <= 0
		|| request.uncoveredSeconds < 0
		|| request.appliedSeconds + request.uncoveredSeconds !== request.deltaSeconds
		|| parseEstimateSeconds(request.childTask.fieldValues['estimate']) !== request.childEstimateAfterSeconds
	) {
		return emptyResult('invalid-request');
	}

	const plannedSteps: CommittedEstimateReallocationWrite[] = [];
	const seenIds = new Set<string>();
	let expectedAncestorId = (request.childTask.fieldValues['parentTask'] ?? '').trim();
	let requestedSubtractSeconds = 0;
	for (const step of request.steps) {
		const operonId = step.operonId.trim();
		if (!operonId || seenIds.has(operonId) || operonId !== expectedAncestorId) {
			return emptyResult('stale-request');
		}
		seenIds.add(operonId);
		if (
			!Number.isSafeInteger(step.estimateBeforeSeconds)
			|| !Number.isSafeInteger(step.subtractSeconds)
			|| !Number.isSafeInteger(step.estimateAfterSeconds)
			|| step.estimateBeforeSeconds < 0
			|| step.subtractSeconds < 0
			|| step.estimateAfterSeconds < 0
			|| step.subtractSeconds > step.estimateBeforeSeconds
			|| step.estimateAfterSeconds !== step.estimateBeforeSeconds - step.subtractSeconds
		) {
			return emptyResult('invalid-request');
		}
		requestedSubtractSeconds += step.subtractSeconds;

		const beforeTask = deps.getTaskById(operonId);
		if (!beforeTask) {
			return emptyResult('stale-request');
		}
		expectedAncestorId = (beforeTask.fieldValues['parentTask'] ?? '').trim();
		const currentEstimate = Math.max(0, parseInt(beforeTask.fieldValues['estimate'] ?? '0', 10) || 0);
		if (currentEstimate !== step.estimateBeforeSeconds) {
			return emptyResult('stale-request');
		}
		plannedSteps.push({
			beforeTask,
			nextEstimate: step.estimateAfterSeconds > 0 ? String(step.estimateAfterSeconds) : '',
			subtractSeconds: step.subtractSeconds,
		});
	}
	if (requestedSubtractSeconds !== request.appliedSeconds) {
		return emptyResult('invalid-request');
	}
	const committedWrites: CommittedEstimateReallocationWrite[] = [];
	let precedingTask = request.childTask;
	let precedingExpectedEstimate = request.childTask.fieldValues['estimate'] ?? '';
	for (const write of plannedSteps) {
		const edgeTask = precedingTask;
		const edgeExpectedEstimate = precedingExpectedEstimate;
		try {
			if (!await deps.validateTaskSource(edgeTask, edgeExpectedEstimate)) {
				return {
					complete: false,
					reason: 'stale-request',
					committedWrites,
					committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
				};
			}
		} catch (error) {
			return {
				complete: false,
				reason: 'write-error',
				committedWrites,
				committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
				error,
			};
		}
		if (write.subtractSeconds <= 0) {
			precedingTask = write.beforeTask;
			precedingExpectedEstimate = write.beforeTask.fieldValues['estimate'] ?? '';
			continue;
		}

		let writeError: unknown;
		try {
			const outcome = await deps.writeEstimate(
				write.beforeTask.operonId,
				write.beforeTask.fieldValues['estimate'] ?? '',
				write.nextEstimate,
				write.beforeTask.fieldValues['parentTask'] ?? '',
			);
			if (outcome !== 'updated' && outcome !== 'already-updated') {
				return {
					complete: false,
					reason: 'write-conflict',
					committedWrites,
					committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
				};
			}
		} catch (error) {
			writeError = error;
			let resolvedAsCommitted = false;
			try {
				if (await deps.resolveWriteError?.(write)) {
					resolvedAsCommitted = true;
				}
			} catch {
				// Preserve the original write error as the actionable failure.
			}
			if (!resolvedAsCommitted) {
				return {
					complete: false,
					reason: 'write-error',
					committedWrites,
					committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
					error,
				};
			}
		}
		committedWrites.push(write);
		try {
			if (!await deps.validateTaskSource(edgeTask, edgeExpectedEstimate)) {
				return {
					complete: false,
					reason: 'stale-request',
					committedWrites,
					committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
					...(writeError === undefined ? {} : { error: writeError }),
				};
			}
		} catch (error) {
			return {
				complete: false,
				reason: 'write-error',
				committedWrites,
				committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
				error,
			};
		}
		precedingTask = write.beforeTask;
		precedingExpectedEstimate = write.nextEstimate;
	}
	return {
		complete: true,
		reason: 'complete',
		committedWrites,
		committedSubtractSeconds: committedWrites.reduce((sum, entry) => sum + entry.subtractSeconds, 0),
	};
}

function parseEstimateSeconds(raw: string | null | undefined): number {
	return Math.max(0, parseInt(raw ?? '0', 10) || 0);
}

function hasChildren(operonId: string, getChildIds: (operonId: string) => Iterable<string>): boolean {
	for (const _childId of getChildIds(operonId)) {
		return true;
	}
	return false;
}

function computeCurrentTreeEstimateTotal(
	rootOperonId: string,
	getTaskById: (operonId: string) => IndexedTask | null,
	getChildIds: (operonId: string) => Iterable<string>,
): number {
	let total = 0;
	const stack = [rootOperonId];
	const visited = new Set<string>();

	while (stack.length > 0) {
		const operonId = stack.pop()!;
		if (visited.has(operonId)) continue;
		visited.add(operonId);

		const task = getTaskById(operonId);
		if (!task) continue;
		total += parseEstimateSeconds(task.fieldValues['estimate']);

		for (const childId of getChildIds(operonId)) {
			stack.push(childId);
		}
	}

	return total;
}
