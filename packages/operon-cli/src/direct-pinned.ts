import type { TaskContextV1 } from '../../../src/agent-runtime/contracts/v1';
import { OPERON_ID_PATTERN_V1 } from '../../../src/agent-runtime/contracts/v1';
import type { GuidedMutationIntentV1 } from './guided-maintenance';

export const DIRECT_PINNED_ACTIONS_V1 = ['pin', 'unpin'] as const;
export type DirectPinnedActionV1 = typeof DIRECT_PINNED_ACTIONS_V1[number];

export type DirectPinnedCompileResultV1 =
	| {
		status: 'no-change';
		action: DirectPinnedActionV1;
		message: string;
	}
	| {
		status: 'ready';
		action: DirectPinnedActionV1;
		intent: GuidedMutationIntentV1;
	};

export function compileDirectPinnedIntentV1(options: {
	action: DirectPinnedActionV1;
	task: TaskContextV1;
}): DirectPinnedCompileResultV1 {
	const { action, task } = options;
	const operonId = task.identity.operonId;
	if (!DIRECT_PINNED_ACTIONS_V1.includes(action)) {
		throw new Error('DIRECT_PINNED_ACTION_UNAVAILABLE');
	}
	if (!OPERON_ID_PATTERN_V1.test(operonId) || !task.identity.mutationAllowed) {
		throw new Error('INVALID_OPERON_ID');
	}
	const pinned = action === 'pin';
	if (task.pinned === pinned) {
		return {
			status: 'no-change',
			action,
			message: pinned
				? 'The task is already pinned.'
				: 'The task is already unpinned.',
		};
	}
	return {
		status: 'ready',
		action,
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: `The user requested the direct human-readable Operon task ${action} action.`,
			target: {
				operonId,
				locator: structuredClone(task.locator),
			},
			spec: {
				operation: 'set-pinned',
				pinned,
			},
		},
	};
}
