import type { CapabilityIdV1, MutationKindV1 } from './capabilities';

export type MutationTargetPolicyV1 = 'forbidden' | 'required' | 'optional';
export type MutationConsentClassV1 =
	| 'standing-grant'
	| 'fresh-user-confirmation';
export type MutationRiskV1 = 'routine' | 'elevated' | 'destructive';
export type MutationRecoveryStrategyV1 =
	| 'graph-journal'
	| 'compare-and-set';
export type MutationPostflightAssertionV1 =
	| 'created-task-state'
	| 'adopted-task-state'
	| 'task-field-state'
	| 'recurrence-state'
	| 'relationship-state'
	| 'reminder-state-and-scheduler'
	| 'transition-effects'
	| 'pinned-state'
	| 'active-tracker-and-task-state'
	| 'timer-session-and-aggregates'
	| 'source-and-destination-state'
	| 'task-absence-and-linked-state';

/**
 * Canonical Public V1 mutation admission matrix.
 *
 * Capability publication, typed callers, Runtime acceptance tests, and both
 * public channels derive their family-level expectations from this table.
 * Adding a capability pair without a complete admission row is not allowed.
 */
export interface MutationAcceptanceDefinitionV1 {
	readonly mutationKind: MutationKindV1;
	readonly operations: readonly {
		readonly operation: string;
		readonly target: MutationTargetPolicyV1;
		readonly risks: readonly MutationRiskV1[];
		readonly consentByRisk: Readonly<Partial<Record<MutationRiskV1, MutationConsentClassV1>>>;
	}[];
	readonly capabilities: {
		readonly preview: CapabilityIdV1;
		readonly apply: CapabilityIdV1;
	};
	readonly recovery: MutationRecoveryStrategyV1;
	readonly entrypoints: {
		readonly cli: { readonly preview: string; readonly apply: string };
		readonly developerApi: { readonly preview: string; readonly apply: string };
	};
	readonly receiptValidatorId: string;
	readonly postflightValidatorId: string;
	readonly exactFinalStateAssertionId: MutationPostflightAssertionV1;
	readonly postflight: readonly MutationPostflightAssertionV1[];
	readonly channels: readonly ['cli', 'developer-api'];
	readonly admission: 'candidate-stable';
}

const MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1 = new Set([
	'mutation-intent',
	'mutation-plan-reference',
	'developer-mutation-preview-input',
	'developer-mutation-apply-input',
	'mutation-result',
]);

const MUTATION_FINAL_STATE_ASSERTION_IDS_V1 = new Set<MutationPostflightAssertionV1>([
	'created-task-state',
	'adopted-task-state',
	'task-field-state',
	'recurrence-state',
	'relationship-state',
	'reminder-state-and-scheduler',
	'transition-effects',
	'pinned-state',
	'active-tracker-and-task-state',
	'timer-session-and-aggregates',
	'source-and-destination-state',
	'task-absence-and-linked-state',
]);

function consentByRisk(
	risks: readonly MutationRiskV1[],
): Readonly<Partial<Record<MutationRiskV1, MutationConsentClassV1>>> {
	return Object.freeze(Object.fromEntries(risks.map(risk => [
		risk,
		risk === 'routine' ? 'standing-grant' : 'fresh-user-confirmation',
	])) as Partial<Record<MutationRiskV1, MutationConsentClassV1>>);
}

function mutationAcceptance(
	definition: Omit<
		MutationAcceptanceDefinitionV1,
		| 'operations'
		| 'channels'
		| 'admission'
		| 'entrypoints'
		| 'receiptValidatorId'
		| 'postflightValidatorId'
		| 'exactFinalStateAssertionId'
	> & {
		readonly operations: readonly Omit<
			MutationAcceptanceDefinitionV1['operations'][number],
			'consentByRisk'
		>[];
	},
): Readonly<MutationAcceptanceDefinitionV1> {
	return Object.freeze({
		...definition,
		operations: Object.freeze(definition.operations.map(operation => Object.freeze({
			...operation,
			risks: Object.freeze([...operation.risks]),
			consentByRisk: consentByRisk(operation.risks),
		}))),
		capabilities: Object.freeze({ ...definition.capabilities }),
		entrypoints: Object.freeze({
			cli: Object.freeze({
					preview: 'mutation-intent',
					apply: 'mutation-plan-reference',
				}),
				developerApi: Object.freeze({
					preview: 'developer-mutation-preview-input',
					apply: 'developer-mutation-apply-input',
				}),
			}),
			receiptValidatorId: 'mutation-result',
			postflightValidatorId: 'mutation-result',
			exactFinalStateAssertionId: definition.postflight[0],
		postflight: Object.freeze([...definition.postflight]),
		channels: Object.freeze(['cli', 'developer-api'] as const),
		admission: 'candidate-stable' as const,
	});
}

export const MUTATION_ACCEPTANCE_MATRIX_V1:
	readonly Readonly<MutationAcceptanceDefinitionV1>[] = Object.freeze([
		mutationAcceptance({
			mutationKind: 'task.create',
			operations: [{
				operation: 'create',
				target: 'forbidden',
				risks: ['routine', 'elevated'],
			}],
			capabilities: { preview: 'tasks.create.preview', apply: 'tasks.create.apply' },
			recovery: 'graph-journal',
			postflight: ['created-task-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.adopt',
			operations: [{
				operation: 'adopt-inline',
				target: 'forbidden',
				risks: ['routine'],
			}],
			capabilities: { preview: 'tasks.adopt.preview', apply: 'tasks.adopt.apply' },
			recovery: 'graph-journal',
			postflight: ['adopted-task-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.update',
			operations: [
				{ operation: 'update', target: 'required', risks: ['routine'] },
				{ operation: 'update-batch', target: 'forbidden', risks: ['routine'] },
			],
			capabilities: { preview: 'tasks.update.preview', apply: 'tasks.update.apply' },
			recovery: 'graph-journal',
			postflight: ['task-field-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.recurrence',
			operations: [{
				operation: 'update-recurrence',
				target: 'required',
				risks: ['routine'],
			}],
			capabilities: { preview: 'tasks.recurrence.preview', apply: 'tasks.recurrence.apply' },
			recovery: 'graph-journal',
			postflight: ['recurrence-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.relationship',
			operations: [{
				operation: 'replace-relationships',
				target: 'required',
				risks: ['routine'],
			}],
			capabilities: { preview: 'tasks.relationship.preview', apply: 'tasks.relationship.apply' },
			recovery: 'graph-journal',
			postflight: ['relationship-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.reminder-item',
			operations: [
				{ operation: 'add', target: 'required', risks: ['routine'] },
				{ operation: 'replace', target: 'required', risks: ['routine'] },
				{ operation: 'remove', target: 'required', risks: ['routine'] },
			],
			capabilities: { preview: 'tasks.reminder.preview', apply: 'tasks.reminder.apply' },
			recovery: 'graph-journal',
			postflight: ['reminder-state-and-scheduler'],
		}),
		mutationAcceptance({
			mutationKind: 'task.transition',
			operations: [{
				operation: 'transition',
				target: 'required',
				risks: ['elevated'],
			}],
			capabilities: { preview: 'tasks.transition.preview', apply: 'tasks.transition.apply' },
			recovery: 'graph-journal',
			postflight: ['transition-effects'],
		}),
		mutationAcceptance({
			mutationKind: 'task.pinned-state',
			operations: [{
				operation: 'set-pinned',
				target: 'required',
				risks: ['routine'],
			}],
			capabilities: { preview: 'tasks.pinned.preview', apply: 'tasks.pinned.apply' },
			recovery: 'compare-and-set',
			postflight: ['pinned-state'],
		}),
		mutationAcceptance({
			mutationKind: 'timer.control',
			operations: [
				{ operation: 'start', target: 'optional', risks: ['elevated'] },
				{ operation: 'stop', target: 'optional', risks: ['elevated'] },
			],
			capabilities: { preview: 'timers.control.preview', apply: 'timers.control.apply' },
			recovery: 'graph-journal',
			postflight: ['active-tracker-and-task-state'],
		}),
		mutationAcceptance({
			mutationKind: 'timer.session',
			operations: [
				{ operation: 'add-session', target: 'required', risks: ['routine'] },
				{ operation: 'update-session', target: 'required', risks: ['routine'] },
				{ operation: 'remove-session', target: 'required', risks: ['destructive'] },
			],
			capabilities: { preview: 'timers.session.preview', apply: 'timers.session.apply' },
			recovery: 'graph-journal',
			postflight: ['timer-session-and-aggregates'],
		}),
		mutationAcceptance({
			mutationKind: 'task.convert',
			operations: [{
				operation: 'convert',
				target: 'required',
				risks: ['elevated', 'destructive'],
			}],
			capabilities: { preview: 'tasks.convert.preview', apply: 'tasks.convert.apply' },
			recovery: 'graph-journal',
			postflight: ['source-and-destination-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.inline-relocate',
			operations: [{
				operation: 'relocate-inline',
				target: 'required',
				risks: ['routine', 'elevated'],
			}],
			capabilities: {
				preview: 'tasks.inline.relocate.preview',
				apply: 'tasks.inline.relocate.apply',
			},
			recovery: 'graph-journal',
			postflight: ['source-and-destination-state'],
		}),
		mutationAcceptance({
			mutationKind: 'task.delete',
			operations: [{
				operation: 'delete',
				target: 'required',
				risks: ['destructive'],
			}],
			capabilities: { preview: 'tasks.delete.preview', apply: 'tasks.delete.apply' },
			recovery: 'graph-journal',
			postflight: ['task-absence-and-linked-state'],
		}),
	]);

export function isCompleteMutationAcceptanceDefinitionV1(
	definition: MutationAcceptanceDefinitionV1,
): boolean {
	return definition.operations.length > 0
		&& definition.capabilities.preview.length > 0
		&& definition.capabilities.apply.length > 0
		&& definition.operations.every(operation => (
			operation.risks.length > 0
			&& operation.risks.every(risk => (
				operation.consentByRisk[risk] === (
					risk === 'routine' ? 'standing-grant' : 'fresh-user-confirmation'
				)
			))
			&& Object.keys(operation.consentByRisk).length === operation.risks.length
		))
		&& MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1.has(definition.entrypoints.cli.preview)
		&& MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1.has(definition.entrypoints.cli.apply)
		&& MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1.has(definition.entrypoints.developerApi.preview)
		&& MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1.has(definition.entrypoints.developerApi.apply)
		&& MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1.has(definition.receiptValidatorId)
		&& MUTATION_ACCEPTANCE_SCHEMA_ENTRYPOINT_IDS_V1.has(definition.postflightValidatorId)
		&& definition.recovery.length > 0
		&& MUTATION_FINAL_STATE_ASSERTION_IDS_V1.has(definition.exactFinalStateAssertionId)
		&& definition.postflight.includes(definition.exactFinalStateAssertionId)
		&& definition.postflight.length > 0
		&& definition.admission === 'candidate-stable';
}

export const COMPLETE_MUTATION_ACCEPTANCE_MATRIX_V1 = Object.freeze(
	MUTATION_ACCEPTANCE_MATRIX_V1.filter(isCompleteMutationAcceptanceDefinitionV1),
);
