import {
	applyOperonSettingsBackupTableResourcesV1,
	type OperonSettingsBackupTableResourceApplyDependenciesV1,
	type OperonSettingsBackupTableResourceApplyResultV1,
} from './settings-backup-table-resource-apply';
import {
	preflightOperonSettingsBackupTableResourcesV1,
	type OperonSettingsBackupTableResourcePreflightInputV1,
	type OperonSettingsBackupTableResourceRestorePlanV1,
} from './settings-backup-table-resource-preflight';

export interface OperonSettingsBackupTableResourceCoordinatorDependenciesV1
	extends OperonSettingsBackupTableResourceApplyDependenciesV1 {
	/** Owns the lock order: restore lane, then Table lane, then canonical settings lane. */
	runExclusive<T>(operation: () => Promise<T>): Promise<T>;
	captureAdmission(): Promise<Pick<OperonSettingsBackupTableResourcePreflightInputV1, 'target' | 'availableFilterSetIds'>>;
}

export type OperonSettingsBackupTableResourceCoordinatorResultV1 =
	| { status: 'stale-plan'; result: null }
	| { status: 'applied'; result: OperonSettingsBackupTableResourceApplyResultV1 };

/**
 * Freshly re-preflight and apply a user-approved resource plan under one
 * caller-owned exclusive mutation lane. No resource write occurs for a stale
 * archive, target inventory, decision set, action list, or projection.
 */
export function coordinateOperonSettingsBackupTableResourceApplyV1(
	input: OperonSettingsBackupTableResourcePreflightInputV1 & {
		approvedPlan: OperonSettingsBackupTableResourceRestorePlanV1;
		appliedAt: string;
	},
	dependencies: OperonSettingsBackupTableResourceCoordinatorDependenciesV1,
): Promise<OperonSettingsBackupTableResourceCoordinatorResultV1> {
	return dependencies.runExclusive(async () => {
		const admission = await dependencies.captureAdmission();
		const fresh = preflightOperonSettingsBackupTableResourcesV1({ ...input, ...admission });
		if (fresh.classification !== 'ready' || !fresh.plan
			|| fresh.plan.planId !== input.approvedPlan.planId) {
			return { status: 'stale-plan', result: null };
		}
		const tableByArchivePath = new Map(input.bundle.tableFiles.map(file => [file.descriptor.path, file]));
		const encoder = new TextEncoder();
		const items = fresh.plan.actions.map(action => {
			const source = tableByArchivePath.get(action.archivePath);
			if (!source) throw new Error(`Validated Table resource is missing: ${action.archivePath}.`);
			return {
				id: action.id,
				path: action.path,
				sha256: action.sha256,
				bytes: encoder.encode(source.text),
				decision: action.kind,
			};
		});
		const result = await applyOperonSettingsBackupTableResourcesV1({
			plan: fresh.plan,
			appliedAt: input.appliedAt,
			items,
		}, dependencies);
		return { status: 'applied', result };
	});
}
