import type { RuntimeSourceTransitionGroupV1 } from './task-mutation-adapter';

export type RuntimeSourceTransitionWriteOutcomeV1 =
	| 'committed'
	| 'conflict'
	| 'missing'
	| 'exists'
	| 'invalid-target';

export interface RuntimeSourceTransitionWriteResultV1 {
	readonly outcome: RuntimeSourceTransitionWriteOutcomeV1;
	readonly committedContent?: string;
}

export interface RuntimeSourceTransitionExecutionGroupV1 {
	readonly group: RuntimeSourceTransitionGroupV1;
	readonly status: 'committed' | 'failed' | 'outcome-unknown';
	readonly committedContent?: string;
	readonly reason?: string;
}

export interface RuntimeSourceTransitionExecutionV1 {
	readonly status: 'committed' | 'failed' | 'partial' | 'outcome-unknown';
	readonly groups: readonly RuntimeSourceTransitionExecutionGroupV1[];
	readonly affectedFilePaths: readonly string[];
	readonly reason?: string;
}

export interface RuntimeSourceTransitionExecutionPortsV1 {
	apply(group: RuntimeSourceTransitionGroupV1): Promise<RuntimeSourceTransitionWriteResultV1>;
	afterTrash(filePath: string): Promise<void>;
}

export async function executeRuntimeSourceTransitionGroupsV1(
	groups: readonly RuntimeSourceTransitionGroupV1[],
	options: {
		readonly rollbackCreatedTargetOnFailure: boolean;
	},
	ports: RuntimeSourceTransitionExecutionPortsV1,
): Promise<RuntimeSourceTransitionExecutionV1> {
	const results: RuntimeSourceTransitionExecutionGroupV1[] = [];
	const affectedFilePaths: string[] = [];
	for (const group of groups) {
		let result: RuntimeSourceTransitionWriteResultV1;
		try {
			result = await ports.apply(group);
		} catch {
			return {
				// A writer can throw after the filesystem commit but before returning its
				// acknowledgement. That remains ambiguous even for the first group.
				status: 'outcome-unknown',
				groups: [...results, {
					group,
					status: 'outcome-unknown',
					reason: 'Canonical source transition threw before returning a verified outcome.',
				}],
				affectedFilePaths,
				reason: 'Canonical source transition did not return a verified write outcome.',
			};
		}
		if (result.outcome !== 'committed') {
			const created = options.rollbackCreatedTargetOnFailure
				? groups.find(candidate => (
					candidate.action === 'create'
						&& affectedFilePaths.includes(candidate.filePath)
				))
				: undefined;
			if (created?.nextContent !== undefined) {
				const rollbackResult = await ports.apply({
					...created,
					action: 'trash',
					expectedContent: created.nextContent,
					nextContent: undefined,
				});
				if (rollbackResult.outcome === 'committed') {
					await ports.afterTrash(created.filePath);
					const createdIndex = results.findIndex(candidate => (
						candidate.group.filePath === created.filePath
					));
					if (createdIndex >= 0) {
						results[createdIndex] = {
							group: created,
							status: 'failed',
							reason: 'Created conversion target was rolled back after source replacement failed.',
						};
					}
					const affectedIndex = affectedFilePaths.indexOf(created.filePath);
					if (affectedIndex >= 0) affectedFilePaths.splice(affectedIndex, 1);
					return {
						status: 'failed',
						groups: [...results, {
							group,
							status: 'failed',
							reason: `Canonical source transition returned ${result.outcome}.`,
						}],
						affectedFilePaths,
						reason: 'Conversion source replacement failed and the created target was rolled back.',
					};
				}
				return {
					status: 'outcome-unknown',
					groups: [...results, {
						group,
						status: 'outcome-unknown',
						reason: 'Source replacement failed and the created conversion target could not be rolled back.',
					}],
					affectedFilePaths,
					reason: 'Conversion target may remain after source replacement failure.',
				};
			}
			return {
				status: affectedFilePaths.length > 0 ? 'partial' : 'failed',
				groups: [...results, {
					group,
					status: 'failed',
					reason: `Canonical source transition returned ${result.outcome}.`,
				}],
				affectedFilePaths,
				reason: 'Source transition stopped after an exact-content conflict.',
			};
		}
		if (group.action === 'trash') {
			try {
				await ports.afterTrash(group.filePath);
			} catch {
				return {
					status: 'outcome-unknown',
					groups: [...results, {
						group,
						status: 'outcome-unknown',
						reason: 'Source trash committed, but index deletion was not verified.',
					}],
					affectedFilePaths: [...affectedFilePaths, group.filePath],
					reason: 'Source trash committed without a verified index outcome.',
				};
			}
		}
		affectedFilePaths.push(group.filePath);
		results.push({
			group,
			status: 'committed',
			...(result.committedContent === undefined
				? {}
				: { committedContent: result.committedContent }),
		});
	}
	return {
		status: 'committed',
		groups: results,
		affectedFilePaths,
	};
}
