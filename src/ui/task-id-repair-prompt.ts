import type { App } from 'obsidian';
import { isValidOperonId } from '../core/id-generator';
import type { TaskIdRepairTarget } from '../core/task-id-repair-sources';
import { ConfirmActionModal } from './confirm-action-modal';

/** Confirmation never carries or replays the action that encountered the invalid ID. */
export async function requestTaskIdRepair<T>(
    app: App,
    target: TaskIdRepairTarget,
    regenerate: (snapshot: TaskIdRepairTarget) => Promise<T>,
): Promise<{ confirmed: false } | { confirmed: true; result: T }> {
    if (target.operonId && isValidOperonId(target.operonId)) return { confirmed: false };
    const snapshot = { ...target };
    const confirmed = await new Promise<boolean>(resolve => {
        new ConfirmActionModal(app, {
            title: 'Incompatible task ID',
            message: 'Task IDs must contain exactly 7 lowercase letters or numbers. Regenerate this ID to enable task actions.',
            confirmText: 'Regenerate ID',
            cancelText: 'Cancel',
            initialFocus: 'cancel',
        }, resolve).open();
    });
    if (!confirmed) return { confirmed: false };
    return { confirmed: true, result: await regenerate(snapshot) };
}
