export type MarkDoneMutationRoute = 'semantic-coordinator' | 'direct-write';

export function resolveMarkDoneMutationRoute(
	desktopApp: boolean,
	coordinatorReady: boolean,
): MarkDoneMutationRoute {
	return desktopApp || coordinatorReady ? 'semantic-coordinator' : 'direct-write';
}
