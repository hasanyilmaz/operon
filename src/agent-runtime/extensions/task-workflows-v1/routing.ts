import type { TaskWorkflowCapabilityIdV1 } from './contracts';

type TaskWorkflowPreviewCapabilityV1 = Extract<
	TaskWorkflowCapabilityIdV1,
	| 'tasks.create.identity-placeholders'
	| 'tasks.create.periodic-note.preview'
	| 'tasks.update.periodic-note.preview'
	| 'tasks.adopt.preview'
>;

type TaskWorkflowApplyCapabilityV1 = Extract<
	TaskWorkflowCapabilityIdV1,
	| 'tasks.create.identity-placeholders'
	| 'tasks.create.periodic-note.apply'
	| 'tasks.update.periodic-note.apply'
	| 'tasks.adopt.apply'
>;

export function resolveTaskWorkflowPreviewCapabilityV1(
	value: unknown,
): TaskWorkflowPreviewCapabilityV1 | undefined {
	if (!isRecord(value)) return undefined;
	switch (value.capability) {
		case 'tasks.create.identity-placeholders':
		case 'tasks.create.periodic-note.preview':
		case 'tasks.update.periodic-note.preview':
		case 'tasks.adopt.preview':
			return value.capability;
		default:
			return undefined;
	}
}

export function resolveTaskWorkflowApplyCapabilityV1(
	value: unknown,
): TaskWorkflowApplyCapabilityV1 | undefined {
	if (!isRecord(value) || !isRecord(value.plan)) return undefined;
	switch (value.plan.capability) {
		case 'tasks.create.identity-placeholders':
			return 'tasks.create.identity-placeholders';
		case 'tasks.create.periodic-note.preview':
			return 'tasks.create.periodic-note.apply';
		case 'tasks.update.periodic-note.preview':
			return 'tasks.update.periodic-note.apply';
		case 'tasks.adopt.preview':
			return 'tasks.adopt.apply';
		default:
			return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
