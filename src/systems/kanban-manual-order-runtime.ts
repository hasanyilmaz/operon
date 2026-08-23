import { hasManualKanbanSorting, KanbanPreset } from '../types/kanban';

export async function maybeCopyKanbanManualOrderForPresetDuplicate(
	sourcePreset: KanbanPreset,
	targetPresetId: string,
	copyManualOrder: (sourcePresetId: string, targetPresetId: string) => Promise<void>,
): Promise<void> {
	if (!hasManualKanbanSorting(sourcePreset)) return;
	await copyManualOrder(sourcePreset.id, targetPresetId);
}

export async function removeKanbanManualOrderForPresetDelete(
	presetId: string,
	removeManualOrder: (presetId: string) => Promise<void>,
): Promise<void> {
	await removeManualOrder(presetId);
}
