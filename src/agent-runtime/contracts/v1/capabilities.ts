export const CAPABILITY_IDS_V1 = [
	'system.health',
	'system.capabilities',
	'system.diagnostics',
	'catalog.read',
	'entities.resolve',
	'tasks.read',
	'tasks.query',
	'tasks.filter-query',
	'tasks.finder',
	'relationships.read',
	'context.build',
	'tasks.create.preview',
	'tasks.create.apply',
	'tasks.create.identity-placeholders',
	'tasks.adopt.preview',
	'tasks.adopt.apply',
	'tasks.update.preview',
	'tasks.update.apply',
	'tasks.recurrence.preview',
	'tasks.recurrence.apply',
	'tasks.relationship.preview',
	'tasks.relationship.apply',
	'tasks.reminder.preview',
	'tasks.reminder.apply',
	'tasks.transition.preview',
	'tasks.transition.apply',
	'tasks.pinned.preview',
	'tasks.pinned.apply',
	'timers.read',
	'timers.control.preview',
	'timers.control.apply',
	'timers.session.preview',
	'timers.session.apply',
	'tasks.convert.preview',
	'tasks.convert.apply',
	'tasks.inline.relocate.preview',
	'tasks.inline.relocate.apply',
	'tasks.delete.preview',
	'tasks.delete.apply',
] as const;

export type CapabilityIdV1 = typeof CAPABILITY_IDS_V1[number];
export type CapabilityModeV1 = 'read' | 'preview' | 'apply';
export type CapabilityAvailabilityV1 = 'contract-only' | 'available' | 'degraded' | 'unavailable';

export const MUTATION_KINDS_V1 = [
	'task.create',
	'task.adopt',
	'task.update',
	'task.recurrence',
	'task.relationship',
	'task.reminder-item',
	'task.transition',
	'task.pinned-state',
	'timer.control',
	'timer.session',
	'task.convert',
	'task.inline-relocate',
	'task.delete',
] as const;

export type MutationKindV1 = typeof MUTATION_KINDS_V1[number];

export interface CapabilityDefinitionV1 {
	readonly id: CapabilityIdV1;
	readonly mode: CapabilityModeV1;
	readonly mutationKind?: MutationKindV1;
	readonly destructive: boolean;
}

export interface CapabilityAdvertisementV1 {
	/** Additive wire identifier; use isCapabilityIdV1 before treating it as known authority. */
	readonly id: string;
	readonly availability: CapabilityAvailabilityV1;
	readonly stability: 'stable';
	readonly reason?: string;
	readonly deprecation?: {
		readonly announcedIn: string;
		readonly removal: 'runtime-v2';
		readonly replacement?: string;
	};
}

const READ_CAPABILITIES: CapabilityDefinitionV1[] = [
	'system.health',
	'system.capabilities',
	'system.diagnostics',
	'catalog.read',
	'entities.resolve',
	'tasks.read',
	'tasks.query',
	'tasks.filter-query',
	'tasks.finder',
	'relationships.read',
	'context.build',
	'timers.read',
].map(id => Object.freeze({ id: id as CapabilityIdV1, mode: 'read' as const, destructive: false }));

function mutationPair(
	base: string,
	mutationKind: MutationKindV1,
	destructive: boolean = false,
): CapabilityDefinitionV1[] {
	return [
		Object.freeze({ id: `${base}.preview` as CapabilityIdV1, mode: 'preview' as const, mutationKind, destructive }),
		Object.freeze({ id: `${base}.apply` as CapabilityIdV1, mode: 'apply' as const, mutationKind, destructive }),
	];
}

export const CAPABILITY_REGISTRY_V1: readonly CapabilityDefinitionV1[] = Object.freeze([
	...READ_CAPABILITIES,
	...mutationPair('tasks.create', 'task.create'),
	Object.freeze({ id: 'tasks.create.identity-placeholders', mode: 'preview' as const, destructive: false }),
	...mutationPair('tasks.adopt', 'task.adopt'),
	...mutationPair('tasks.update', 'task.update'),
	...mutationPair('tasks.recurrence', 'task.recurrence'),
	...mutationPair('tasks.relationship', 'task.relationship'),
	...mutationPair('tasks.reminder', 'task.reminder-item'),
	...mutationPair('tasks.transition', 'task.transition'),
	...mutationPair('tasks.pinned', 'task.pinned-state'),
	...mutationPair('timers.control', 'timer.control'),
	...mutationPair('timers.session', 'timer.session'),
	...mutationPair('tasks.convert', 'task.convert'),
	...mutationPair('tasks.inline.relocate', 'task.inline-relocate'),
	...mutationPair('tasks.delete', 'task.delete', true),
]);

const mutationCapabilityMap = Object.create(null) as Record<MutationKindV1, {
	preview: CapabilityIdV1;
	apply: CapabilityIdV1;
}>;
for (const mutationKind of MUTATION_KINDS_V1) {
	const definitions = CAPABILITY_REGISTRY_V1.filter(definition => definition.mutationKind === mutationKind);
	const preview = definitions.find(definition => definition.mode === 'preview')?.id;
	const apply = definitions.find(definition => definition.mode === 'apply')?.id;
	if (!preview || !apply) throw new Error(`OPERON_MUTATION_CAPABILITY_PAIR_INCOMPLETE:${mutationKind}`);
	mutationCapabilityMap[mutationKind] = Object.freeze({ preview, apply });
}
export const MUTATION_CAPABILITY_MAP_V1: Readonly<typeof mutationCapabilityMap> = Object.freeze(mutationCapabilityMap);

export function isCapabilityIdV1(value: string): value is CapabilityIdV1 {
	return (CAPABILITY_IDS_V1 as readonly string[]).includes(value);
}

export function isMutationKindV1(value: string): value is MutationKindV1 {
	return (MUTATION_KINDS_V1 as readonly string[]).includes(value);
}
