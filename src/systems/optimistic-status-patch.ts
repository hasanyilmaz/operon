import { IndexedTask } from '../types/fields';
import { getNextWorkflowStatus } from '../types/pipeline';
import { OperonSettings } from '../types/settings';

export interface OptimisticTaskPatchInput {
	fieldValues?: Record<string, string | undefined>;
	checkbox?: IndexedTask['checkbox'];
}

export interface OptimisticStatusPatchResult {
	patch: OptimisticTaskPatchInput;
	nextStatus: string;
	nextCheckbox: IndexedTask['checkbox'];
}

function isCheckboxState(value: string | undefined): value is IndexedTask['checkbox'] {
	return value === 'open' || value === 'done' || value === 'cancelled';
}

export function normalizeOptimisticFieldValues(
	payload: Record<string, string | undefined> | undefined,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(payload ?? {})) {
		normalized[key] = value ?? '';
	}
	return normalized;
}

function resolveOptimisticCheckbox(
	patch: OptimisticTaskPatchInput,
): IndexedTask['checkbox'] | undefined {
	if (patch.checkbox) return patch.checkbox;
	const checkboxValue = patch.fieldValues?.['_checkbox'];
	return isCheckboxState(checkboxValue) ? checkboxValue : undefined;
}

export function applyOptimisticRenderPatch(
	task: IndexedTask,
	patch: OptimisticTaskPatchInput,
): IndexedTask {
	const normalized = normalizeOptimisticFieldValues(patch.fieldValues);
	const fieldValues = {
		...task.fieldValues,
		...normalized,
	};
	delete fieldValues['_checkbox'];
	return {
		...task,
		checkbox: resolveOptimisticCheckbox(patch) ?? task.checkbox,
		fieldValues,
	};
}

/**
 * An optimistic patch may outlive its TTL while the underlying writeback is
 * still in flight (large vaults, sync contention, mobile I/O). Expiring it in
 * that state would visually snap the item back to its pre-edit position until
 * the reindex lands, so pending patches are held until the writeback settles
 * and the TTL is refreshed.
 */
export function shouldExpireOptimisticTaskPatch(input: {
	nowMs: number;
	expiresAt: number;
	writebackPending?: boolean;
}): boolean {
	if (input.writebackPending === true) return false;
	return input.nowMs >= input.expiresAt;
}

export function isOptimisticTaskPatchPersisted(
	task: IndexedTask,
	patch: OptimisticTaskPatchInput,
): boolean {
	const normalized = normalizeOptimisticFieldValues(patch.fieldValues);
	const expectedCheckbox = resolveOptimisticCheckbox(patch);
	if (expectedCheckbox && task.checkbox !== expectedCheckbox) return false;
	return Object.entries(normalized).every(([key, value]) => {
		if (key === '_checkbox') return true;
		return (task.fieldValues[key] ?? '') === value;
	});
}

export function buildOptimisticStatusPatch(
	task: IndexedTask,
	settings: Pick<OperonSettings, 'pipelines'>,
): OptimisticStatusPatchResult | null {
	const nextWorkflow = getNextWorkflowStatus(settings.pipelines, task.fieldValues['status']);
	if (!nextWorkflow) return null;
	return {
		patch: {
			fieldValues: { status: nextWorkflow.value },
			checkbox: nextWorkflow.checkbox,
		},
		nextStatus: nextWorkflow.value,
		nextCheckbox: nextWorkflow.checkbox,
	};
}
