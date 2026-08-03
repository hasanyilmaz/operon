import type { CliCommandV1 } from '../contracts/v1/cli';

/**
 * Runtime commands that are read-only and may use the authenticated
 * persistent transport. Mutation preview/apply deliberately stay on the
 * one-shot path so their consent and recovery semantics remain separate.
 */
export const PERSISTENT_READ_COMMANDS_V1 = [
	'health',
	'capabilities',
	'diagnostics',
	'catalog',
	'entity.resolve',
	'task.get',
	'tasks.query',
	'tasks.finder',
	'relationships.get',
	'context.build',
	'timers.read',
] as const satisfies readonly CliCommandV1[];

export function isPersistentReadCommandV1(command: CliCommandV1): boolean {
	return (PERSISTENT_READ_COMMANDS_V1 as readonly string[]).includes(command);
}
