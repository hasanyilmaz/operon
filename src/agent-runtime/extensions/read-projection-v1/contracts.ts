import type { CapabilityIdV1 } from '../../contracts/v1/capabilities';

/**
 * These are Developer API grant identities, not Runtime V1 capability ids.
 * Keeping the namespaces distinct prevents a base API grant from admitting
 * the narrower read-projection accessor implicitly.
 */
export const READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1 = [
	'read-projection.system.diagnostics',
	'read-projection.tasks.finder',
	'read-projection.entities.resolve',
	'read-projection.relationships.read',
	'read-projection.context.build',
	'read-projection.timers.read',
] as const;

export type ReadProjectionDeveloperCapabilityIdV1 =
	typeof READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1[number];

export const READ_PROJECTION_RUNTIME_CAPABILITY_BY_GRANT_V1: Readonly<
	Record<ReadProjectionDeveloperCapabilityIdV1, CapabilityIdV1>
> = Object.freeze({
	'read-projection.system.diagnostics': 'system.diagnostics',
	'read-projection.tasks.finder': 'tasks.finder',
	'read-projection.entities.resolve': 'entities.resolve',
	'read-projection.relationships.read': 'relationships.read',
	'read-projection.context.build': 'context.build',
	'read-projection.timers.read': 'timers.read',
});

export function isReadProjectionDeveloperCapabilityIdV1(
	value: string,
): value is ReadProjectionDeveloperCapabilityIdV1 {
	return (READ_PROJECTION_DEVELOPER_CAPABILITY_IDS_V1 as readonly string[]).includes(value);
}
