import { CLI_COMMAND_CAPABILITY_V1 } from '../../../src/agent-runtime/contracts/v1/cli';
import {
	GRAPH_TRANSACTION_FEATURES_V1,
	SOURCE_TRANSITION_RECOVERY_FEATURES_V1,
	TYPED_CREATE_FEATURES_V1,
	COMPACT_UPDATE_BATCH_FEATURES_V1,
} from '../../../src/agent-runtime/contracts/v1/catalog';
import {
	commandDefinitionsForRouteV1,
	type OperonCliCommandIdForRouteV1,
	type OperonCliCommandRouteV1,
} from './command-registry';
import {
	CONTRACT_LIMITS_V1,
	ERROR_REGISTRY_V1,
} from '../../../src/agent-runtime/contracts/v1/primitives';
import { OPERON_CLI_PACKAGE_NAME } from './package-identity';

export const OPERON_CLI_MANIFEST_VERSION_V1 = 1 as const;
export const COMPACT_UPDATE_FEATURES_V1 = Object.freeze([
	'exact-id-target',
	'exact-description-target',
	'multi-field-update',
	'explicit-field-clear',
	'safe-auto-apply',
] as const);
export const RELATIONSHIP_UPDATE_FEATURES_V1 = Object.freeze([
	'exact-source-selector',
	'exact-id-targets',
	'whole-list-replace',
	'explicit-field-clear',
	'reciprocal-dependency',
	'compare-aware-graph-transaction',
	'safe-auto-apply',
] as const);
export const DIRECT_RECURRENCE_FEATURES_V1 = Object.freeze([
	'exact-source-selector',
	'multi-field-update',
	'explicit-field-clear',
	'scoped-temporal-update',
	'start-recurrence-default-scope',
	'compare-aware-recurrence-state',
	'safe-auto-apply',
] as const);
export const DIRECT_TRANSITION_ACTIONS_V1 = Object.freeze([
	'complete',
	'reopen',
	'cancel',
] as const);
export const DIRECT_REMINDER_FEATURES_V1 = Object.freeze([
	'exact-id-target',
	'exact-description-target',
	'single-item-add',
	'sealed-item-replace',
	'sealed-item-remove',
	'safe-auto-apply',
] as const);
export const DIRECT_PINNED_ACTIONS_V1 = Object.freeze(['pin', 'unpin'] as const);
export const DIRECT_PINNED_FEATURES_V1 = Object.freeze([
	'exact-id-target',
	'exact-description-target',
	'compare-aware-state',
	'safe-auto-apply',
] as const);
export const DIRECT_TIMER_SESSION_ACTIONS_V1 = Object.freeze([
	'add',
	'update',
	'remove',
] as const);
export const DIRECT_TIMER_SESSION_FEATURES_V1 = Object.freeze([
	'oldest-first-session-number',
	'expected-range-cas',
	'duration-recalculation',
	'parent-aggregate-update',
	'same-plan-recovery',
] as const);

export const OPERON_CLI_LOCAL_COMMANDS_V1 = commandIdsForRoute('local');
export const OPERON_CLI_RUNTIME_COMMANDS_V1 = commandIdsForRoute('runtime');
export const OPERON_CLI_CONVENIENCE_COMMANDS_V1 = commandIdsForRoute('convenience');

export const OPERON_CLI_MUTATION_CAPABILITIES_V1 = Object.freeze({
	'task.create': Object.freeze({
		preview: 'tasks.create.preview',
		apply: 'tasks.create.apply',
	}),
	'task.update': Object.freeze({
		preview: 'tasks.update.preview',
		apply: 'tasks.update.apply',
	}),
	'task.recurrence': Object.freeze({
		preview: 'tasks.recurrence.preview',
		apply: 'tasks.recurrence.apply',
	}),
	'task.relationship': Object.freeze({
		preview: 'tasks.relationship.preview',
		apply: 'tasks.relationship.apply',
	}),
	'task.reminder-item': Object.freeze({
		preview: 'tasks.reminder.preview',
		apply: 'tasks.reminder.apply',
	}),
	'task.transition': Object.freeze({
		preview: 'tasks.transition.preview',
		apply: 'tasks.transition.apply',
	}),
	'task.pinned-state': Object.freeze({
		preview: 'tasks.pinned.preview',
		apply: 'tasks.pinned.apply',
	}),
	'timer.control': Object.freeze({
		preview: 'timers.control.preview',
		apply: 'timers.control.apply',
	}),
	'timer.session': Object.freeze({
		preview: 'timers.session.preview',
		apply: 'timers.session.apply',
	}),
	'task.convert': Object.freeze({
		preview: 'tasks.convert.preview',
		apply: 'tasks.convert.apply',
	}),
	'task.inline-relocate': Object.freeze({
		preview: 'tasks.inline.relocate.preview',
		apply: 'tasks.inline.relocate.apply',
	}),
	'task.delete': Object.freeze({
		preview: 'tasks.delete.preview',
		apply: 'tasks.delete.apply',
	}),
});

export const OPERON_CLI_RUNTIME_CAPABILITIES_V1 = Object.freeze({
	...CLI_COMMAND_CAPABILITY_V1,
	'mutation.preview': 'mutation-kind-derived',
	'mutation.apply': 'mutation-kind-derived',
});

export const OPERON_CLI_CONVENIENCE_MUTATIONS_V1 = Object.freeze({
	'task.create': 'task.create',
	'task.update': 'task.update',
	'task.complete': 'task.transition',
	'task.reopen': 'task.transition',
	'task.cancel': 'task.transition',
	'task.pin': 'task.pinned-state',
	'task.unpin': 'task.pinned-state',
	'task.transition': 'task.transition',
	'task.delete': 'task.delete',
	'task.convert': 'task.convert',
	'task.relocate': 'task.inline-relocate',
	'reminder.add': 'task.reminder-item',
	'reminder.replace': 'task.reminder-item',
	'reminder.remove': 'task.reminder-item',
	'timer.start': 'timer.control',
	'timer.stop': 'timer.control',
	'timer.session.add': 'timer.session',
	'timer.session.update': 'timer.session',
	'timer.session.remove': 'timer.session',
});

export const OPERON_CLI_CONVENIENCE_TARGET_POLICIES_V1 = Object.freeze({
	'task.create': 'forbidden',
	'task.update': 'required',
	'task.complete': 'required',
	'task.reopen': 'required',
	'task.cancel': 'required',
	'task.pin': 'required',
	'task.unpin': 'required',
	'task.transition': 'required',
	'task.delete': 'required',
	'task.convert': 'required',
	'task.relocate': 'required',
	'reminder.add': 'required',
	'reminder.replace': 'required',
	'reminder.remove': 'required',
	'timer.start': 'optional',
	'timer.stop': 'optional',
	'timer.session.add': 'required',
	'timer.session.update': 'required',
	'timer.session.remove': 'required',
} as const);

const LOCAL_RESULT_SCHEMAS_V1 = Object.freeze({
	version: 'version-result',
	manifest: 'manifest-result',
	'schema.list': 'schema-list-result',
	'schema.get': 'schema-get-result',
	setup: 'setup-result',
	doctor: 'doctor-result',
	'profile.list': 'profile-list-result',
	'profile.default': 'profile-default-result',
	'profile.remove': 'profile-remove-result',
	'plan.show': 'plan-show-envelope',
	'plan.apply': 'plan-apply-local-result',
	'plan.recover': 'plan-recover-local-result',
	'plan.discard': 'plan-discard-result',
} as const);

export const OPERON_CLI_LOCAL_CONTRACTS_V1 = Object.freeze(
	Object.fromEntries(OPERON_CLI_LOCAL_COMMANDS_V1.map(command => [
		command,
		command === 'completion'
			|| command === 'task.find'
			? Object.freeze({ output: 'text-tty-only' as const })
			: Object.freeze({
				output: 'machine-readable' as const,
				resultSchema: LOCAL_RESULT_SCHEMAS_V1[command],
				...(command === 'plan.apply' || command === 'plan.recover'
					? {
						outputSchemas: [
							'cli-result',
							LOCAL_RESULT_SCHEMAS_V1[command],
						] as const,
					}
					: {}),
			}),
	])),
);

const OPERON_CLI_RUNTIME_SCHEMAS_V1 = Object.freeze({
	health: { requestSchema: null, resultSchema: 'runtime-health' },
	capabilities: { requestSchema: null, resultSchema: 'capability-advertisements' },
	diagnostics: { requestSchema: null, resultSchema: 'runtime-diagnostics' },
	catalog: { requestSchema: 'catalog-request', resultSchema: 'operon-catalog' },
	'entity.resolve': { requestSchema: 'entity-resolve-request', resultSchema: 'entity-resolution-result' },
	'task.get': { requestSchema: 'task-get-request', resultSchema: 'task-get-result' },
	'tasks.query': { requestSchema: 'task-query-request', resultSchema: 'task-query-result' },
	'tasks.finder': { requestSchema: 'task-finder-request', resultSchema: 'task-finder-result' },
	'relationships.get': { requestSchema: 'relationship-request', resultSchema: 'relationship-result' },
	'context.build': { requestSchema: 'context-request', resultSchema: 'context-pack' },
	'timers.read': { requestSchema: 'timer-read-request', resultSchema: 'timer-read-result' },
	'mutation.preview': { requestSchema: 'mutation-preview-request', resultSchema: 'mutation-preview-result' },
	'mutation.apply': { requestSchema: 'mutation-plan-reference', resultSchema: 'mutation-result' },
});

export const OPERON_CLI_RUNTIME_CONTRACTS_V1 = Object.freeze(
	Object.fromEntries(OPERON_CLI_RUNTIME_COMMANDS_V1.map(command => [
		command,
		Object.freeze({
			capability: OPERON_CLI_RUNTIME_CAPABILITIES_V1[command],
			...OPERON_CLI_RUNTIME_SCHEMAS_V1[command],
		}),
	])),
);

export const OPERON_CLI_CONVENIENCE_CONTRACTS_V1 = Object.freeze(
	Object.fromEntries(OPERON_CLI_CONVENIENCE_COMMANDS_V1.map(command => [
		command,
		Object.freeze({
			mutationKind: OPERON_CLI_CONVENIENCE_MUTATIONS_V1[command],
			targetPolicy: OPERON_CLI_CONVENIENCE_TARGET_POLICIES_V1[command],
			intentSchema: 'mutation-intent',
			previewResultSchema: 'mutation-preview-result',
			applyResultSchema: 'mutation-result',
			...(command === 'task.create'
				? {
					inputFormats: ['json', 'compact', 'compact-lines'] as const,
					compactGrammarVersion: 1 as const,
					compactBatchVersion: 1 as const,
					compactBatchInputFormat: 'compact-lines' as const,
					compactBatchMaxItems: 64 as const,
					typedCreateVersion: 1 as const,
					typedCreateFeatures: [...TYPED_CREATE_FEATURES_V1],
					temporalCreateVersion: 1 as const,
					temporalCreateKeys: [
						'reminderDatetimes',
						'reminderRules',
						'repeat',
						'datetimeRepeatEnd',
					] as const,
					graphTransactionVersion: 1 as const,
					graphTransactionFeatures: [...GRAPH_TRANSACTION_FEATURES_V1],
				}
				: {}),
			...(command === 'task.update'
				? {
					compactUpdateVersion: 1 as const,
					compactUpdateFeatures: [...COMPACT_UPDATE_FEATURES_V1],
					compactUpdateBatchVersion: 1 as const,
					compactUpdateBatchInputFormat: 'compact-lines' as const,
					compactUpdateBatchMaxItems: 64 as const,
					compactUpdateBatchFeatures: [...COMPACT_UPDATE_BATCH_FEATURES_V1],
					directRelationshipVersion: 1 as const,
					directRelationshipKeys: [
						'parentTask',
						'blocking',
						'blockedBy',
					] as const,
					directRelationshipFeatures: [...RELATIONSHIP_UPDATE_FEATURES_V1],
					directRecurrenceVersion: 1 as const,
					directRecurrenceKeys: [
						'repeat',
						'datetimeRepeatEnd',
						'dateScheduled',
						'dateStarted',
						'dateDue',
						'datetimeStart',
						'datetimeEnd',
						'estimate',
					] as const,
					directRecurrenceScopes: [
						'this-task',
						'this-and-following',
					] as const,
					directRecurrenceFeatures: [...DIRECT_RECURRENCE_FEATURES_V1],
				}
				: {}),
			...(command === 'task.transition'
				|| command === 'task.complete'
				|| command === 'task.reopen'
				|| command === 'task.cancel'
				? {
					directTransitionVersion: 1 as const,
					directTransitionActions: [...DIRECT_TRANSITION_ACTIONS_V1],
				}
				: {}),
				...(command === 'reminder.add'
				|| command === 'reminder.replace'
				|| command === 'reminder.remove'
				? {
					directReminderVersion: 1 as const,
					directReminderFeatures: [...DIRECT_REMINDER_FEATURES_V1],
				}
					: {}),
				...(command === 'task.pin' || command === 'task.unpin'
					? {
						directPinnedVersion: 1 as const,
						directPinnedActions: [...DIRECT_PINNED_ACTIONS_V1],
						directPinnedFeatures: [...DIRECT_PINNED_FEATURES_V1],
					}
					: {}),
				...(command === 'timer.session.add'
					|| command === 'timer.session.update'
					|| command === 'timer.session.remove'
					? {
						directTimerSessionVersion: 1 as const,
						directTimerSessionActions: [...DIRECT_TIMER_SESSION_ACTIONS_V1],
						directTimerSessionFeatures: [...DIRECT_TIMER_SESSION_FEATURES_V1],
					}
					: {}),
				...(command === 'task.convert'
					|| command === 'task.relocate'
					|| command === 'task.delete'
					? {
						sourceTransitionRecoveryVersion: 1 as const,
						sourceTransitionRecoveryFeatures: [
							...SOURCE_TRANSITION_RECOVERY_FEATURES_V1,
						],
					}
					: {}),
			}),
	])),
);

export function createCliManifestBaseV1(version: string) {
	return {
		manifestVersion: OPERON_CLI_MANIFEST_VERSION_V1,
		package: {
			name: OPERON_CLI_PACKAGE_NAME,
			version,
			executable: 'operon',
			node: '^22.0.0 || ^24.0.0 || ^26.0.0',
		},
		compatibility: {
			runtimeApi: { min: 1, max: 1 },
			cliContract: { min: 1, max: 1 },
		},
		commands: {
			local: OPERON_CLI_LOCAL_COMMANDS_V1,
			runtime: OPERON_CLI_RUNTIME_COMMANDS_V1,
			convenience: OPERON_CLI_CONVENIENCE_COMMANDS_V1,
		},
		runtimeCapabilities: OPERON_CLI_RUNTIME_CAPABILITIES_V1,
		convenienceMutations: OPERON_CLI_CONVENIENCE_MUTATIONS_V1,
		runtimeContracts: OPERON_CLI_RUNTIME_CONTRACTS_V1,
		localContracts: OPERON_CLI_LOCAL_CONTRACTS_V1,
		convenienceContracts: OPERON_CLI_CONVENIENCE_CONTRACTS_V1,
		mutationCapabilities: OPERON_CLI_MUTATION_CAPABILITIES_V1,
		projections: [
			'exact-task',
			'task-neighborhood',
			'project-analysis',
			'planning-workload',
			'creation-context',
			'mutation-preview',
			'placement-candidates',
		],
		exitCodes: {
			success: 0,
			usage: 2,
			unavailable: 3,
			refused: 4,
			runtimeFailure: 5,
			internal: 70,
			interrupted: 130,
		},
		contractPolicy: {
			inputs: 'strict',
			outputs: 'additive',
			unknownCapability: 'non-authorizing',
			unknownError: 'stop-and-inspect',
			deprecationRemoval: 'cli-2.0-or-runtime-v2',
		},
		deprecations: [],
		limits: {
			...CONTRACT_LIMITS_V1,
			sessionReadGroupMin: 2,
			sessionReadGroupMax: 8,
		},
		errorRegistry: ERROR_REGISTRY_V1.map(entry => ({
			...entry,
			exitCode: {
				usage: 2,
				unavailable: 3,
				refused: 4,
				'runtime-failure': 5,
				internal: 70,
			}[entry.exitClass],
		})),
		protocols: {
			sessionJsonl: {
				version: 1,
				invocation: 'operon session --jsonl',
				transport: 'jsonl-stdio',
				requestSchema: 'session-frame',
				readGroupSchema: 'session-read-group',
				resultSchema: 'session-result',
				failureSchema: 'session-failure',
				uncertainResultSchema: 'session-uncertain-result',
				readGroupMin: 2,
				readGroupMax: 8,
				readGroupCommands: [
					'health',
					'task.get',
					'tasks.query',
					'context.build',
				],
				ordinaryFrames: 'sequential',
				readGroups: 'concurrent-ordered',
				abortExitCode: 130,
			},
		},
		platforms: {
			darwin: 'supported',
			linux: 'acceptance-required',
			win32: 'acceptance-required',
			wsl: 'unsupported',
		},
	};
}

function commandIdsForRoute<Route extends OperonCliCommandRouteV1>(
	route: Route,
): readonly OperonCliCommandIdForRouteV1<Route>[] {
	return Object.freeze(commandDefinitionsForRouteV1(route).map(definition => (
		definition.id as OperonCliCommandIdForRouteV1<Route>
	)));
}
