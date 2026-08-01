import { Plugin } from 'obsidian';

import type {
	DeveloperMutationPreviewInputV1,
	DeveloperMutationExecutionResultV1,
	OperonDeveloperApiAccessRequestV1,
	OperonDeveloperApiAccessorV1,
	OperonDeveloperApiV1,
} from '@stratejya/operon-cli/contracts/v1/developer-api';

const REQUESTED_CAPABILITIES = [
	'system.health',
	'system.capabilities',
	'tasks.read',
	'tasks.update.preview',
	'tasks.update.apply',
] as const;
const RECOVERY_CAPABILITIES = [] as const;

type RoutineUpdateResult =
	| Readonly<{ status: 'access-pending' | 'read-failed' | 'preview-failed' }>
	| Readonly<{
		status: 'recovery-required';
		recoveryRef: string;
		result: DeveloperMutationExecutionResultV1;
	}>
	| Readonly<{
		status: 'execution-failed';
		result: DeveloperMutationExecutionResultV1;
	}>
	| Readonly<{
		status: 'completed';
		recoveryRef: string;
		planDigest: string;
		result: DeveloperMutationExecutionResultV1;
		replay: DeveloperMutationExecutionResultV1;
	}>;

type TaskUpdatePreviewV1 = Extract<
	DeveloperMutationPreviewInputV1,
	{ mutationKind: 'task.update'; spec: { operation: 'update' } }
>;
type ExactTaskUpdateTargetV1 = TaskUpdatePreviewV1['target'];

interface ObsidianAppWithPluginRegistry {
	readonly plugins: {
		readonly getPlugin: (id: string) => unknown;
	};
}

export default class OperonDeveloperApiConsumerExample extends Plugin {
	onload(): void {
		this.addCommand({
			id: 'discover-operon-developer-api',
			name: 'Discover API access',
			callback: () => {
				void this.discover();
			},
		});
	}

	async discover(): Promise<void> {
		const api = this.connect();
		if (!api) return;

		const health = await api.system.health();
		const capabilities = api.system.capabilities();
		console.info('Operon Developer API ready', {
			sessionId: api.sessionId,
			health,
			capabilities,
		});
	}

	async runRoutineUpdate(
		target: ExactTaskUpdateTargetV1,
		note: string,
	): Promise<RoutineUpdateResult> {
		const api = this.connect();
		if (!api) return { status: 'access-pending' };

		const before = await api.tasks.get({
			contractVersion: 1,
			requestId: crypto.randomUUID(),
			kind: 'task-get',
			consistency: 'live-verified',
			selector: {
				kind: 'operon-id',
				operonId: target.operonId,
			},
		});
		if (!before.ok) return { status: 'read-failed' };

		const preview = await api.mutations.preview({
			capability: 'tasks.update.preview',
			mutationKind: 'task.update',
			target,
			spec: {
				operation: 'update',
				changes: [{
					field: 'note',
					valueType: 'text',
					value: note,
				}],
			},
		});
		if (!preview.ok) return { status: 'preview-failed' };

		const result = await api.mutations.apply({ plan: preview.plan });
		if (
			result.status === 'partial'
			|| result.status === 'outcome-unknown'
		) {
			return {
				status: 'recovery-required',
				recoveryRef: result.recovery.recoveryRef,
				result,
			};
		}
		if (result.status !== 'applied') {
			return { status: 'execution-failed', result };
		}

		const replay = await api.mutations.apply({ plan: preview.plan });
		return {
			status: 'completed',
			recoveryRef: preview.plan.recoveryRef,
			planDigest: preview.plan.planDigest,
			result,
			replay,
		};
	}

	async recoverAfterRestart(
		recoveryRef: string,
	): Promise<DeveloperMutationExecutionResultV1 | undefined> {
		// Recovery is a continuation, not a new mutation grant. Request no new
		// capabilities so a dispatched plan remains recoverable after revocation.
		const api = this.connect(RECOVERY_CAPABILITIES);
		if (!api) return undefined;

		const pending = await api.mutations.pendingRecoveries();
		if (!pending.ok) return undefined;
		if (!pending.recoveries.some(item => item.recoveryRef === recoveryRef)) {
			console.info('Recovery is not pending; exact recovery may return a terminal receipt replay.');
		}
		return api.mutations.recover({ recoveryRef });
	}

	private connect(
		requestedCapabilities: OperonDeveloperApiAccessRequestV1['requestedCapabilities']
			= REQUESTED_CAPABILITIES,
	): OperonDeveloperApiV1 | undefined {
		const hostApp = this.app as unknown as ObsidianAppWithPluginRegistry;
		const operon = hostApp.plugins.getPlugin('operon');
		if (!isDeveloperApiAccessor(operon)) {
			console.warn('Operon is disabled or the Developer API accessor is unavailable.');
			return undefined;
		}

		const access = operon.getDeveloperApiV1(this, {
			contractVersion: 1,
			runtimeApi: { min: 1, max: 1 },
			requestedCapabilities,
		});
		if (!access.ok) {
			console.warn(
				'Developer API access is not active. Review the exact request in Operon Settings.',
				access.status.grant,
				access.error,
			);
			return undefined;
		}
		return access.api;
	}
}

function isDeveloperApiAccessor(
	value: unknown,
): value is OperonDeveloperApiAccessorV1 {
	return typeof value === 'object'
		&& value !== null
		&& 'getDeveloperApiV1' in value
		&& typeof value.getDeveloperApiV1 === 'function';
}
